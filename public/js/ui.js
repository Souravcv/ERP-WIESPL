import { inr } from './calc.js';

export const state = { user: null, settings: {}, people: [] };

// Views pass optional children as `cond ? el : null`; make replaceChildren skip those like h() does
// instead of rendering the text "null".
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false));
};

// h('div.card#x', {onclick}, children...) - tiny element builder; strings are always text, never HTML.
export function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]+)?(.*)$/i);
  const el = document.createElement(name);
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: {} };
  if (raw) { opts.body = raw; opts.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { location.hash = '#/login'; window.dispatchEvent(new Event('logged-out')); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
export function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isErr ? 5000 : 2500);
}
export const fail = e => toast(e.message || String(e), true);

// Run an async action from a button once at a time (double clicks, or holding Ctrl+S, must not save twice).
export function busy(fn) {
  let running = false;
  return async function (e) {
    if (running) return;
    running = true;
    const btn = e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
    if (btn) btn.disabled = true;
    try { return await fn.apply(this, arguments); } catch (err) { fail(err); } finally { running = false; if (btn) btn.disabled = false; }
  };
}

export function modal(title, body, buttons = [], { wide = false } = {}) {
  return new Promise(resolve => {
    const close = v => { back.remove(); resolve(v); };
    const back = h('div.modal-back', { onclick: e => e.target === back && close(null) },
      h('div.modal' + (wide ? '.wide' : ''), h('h2', title), body,
        h('div.foot', buttons.map(b => h('button.btn' + (b.cls ? '.' + b.cls : ''), { type: 'button', onclick: async e => {
          if (!b.action) return close(b.value ?? null);
          const btn = e.currentTarget;
          if (btn.disabled) return;
          btn.disabled = true;
          try { const v = await b.action(); if (v !== false) close(v); } catch (err) { fail(err); } finally { btn.disabled = false; }
        } }, b.label)))));
    document.body.append(back);
    back.querySelector('input, select, textarea')?.focus();
  });
}
export const confirmBox = (msg, label = 'Yes') =>
  modal('Please confirm', h('p', msg), [{ label: 'Cancel', value: false }, { label, cls: 'primary', value: true }]);

export const money = v => (v == null || v === '' ? '' : '₹ ' + inr(v));
export const fmtDate = s => {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
export const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);

const STATUS_TONE = {
  good: ['Won', 'Delivered', 'Approved', 'Paid', 'Completed', 'Received', 'Done', 'Closed', 'Resolved', 'Approved with Comments', 'Active', 'Yes'],
  warn: ['Pending', 'Partly Dispatched', 'Pending Approval', 'In Process', 'Negotiation', 'Partially Paid', 'Partially Received', 'Submitted', 'In Progress', 'Waiting for Parts', 'Resubmit', 'On Hold', 'Open', 'High'],
  bad: ['Lost', 'Rejected', 'Cancelled', 'Regret', 'Critical', 'Overdue'],
  info: ['New', 'Quoted', 'Sent', 'Issued', 'In Execution', 'Draft', 'Dispatched'],
};
export function badge(s) {
  if (!s) return '';
  const tone = Object.keys(STATUS_TONE).find(k => STATUS_TONE[k].includes(s)) || '';
  return h('span.badge' + (tone ? '.' + tone : ''), s);
}

// Display value of a field in lists / read-only views
export function display(f, row) {
  const v = row[f.key];
  switch (f.type) {
    case 'ref': return row[`${f.key}_label`] || '';
    case 'money': return v == null ? '' : inr(v);
    case 'date': return fmtDate(v);
    case 'select': return ['status', 'stage', 'priority', 'delivery_status'].includes(f.key) ? badge(v) : (v ?? '');
    case 'number': return v == null ? '' : (Number.isInteger(v) ? v : Math.round(v * 100) / 100);
    default: return v ?? '';
  }
}

const refCache = new Map();
export async function refOptions(entity, force = false) {
  if (!force && refCache.has(entity)) return refCache.get(entity);
  const p = api(`/${entity}/options`);
  refCache.set(entity, p);
  p.catch(() => refCache.delete(entity));
  return p;
}
export const clearRefCache = entity => (entity ? refCache.delete(entity) : refCache.clear());

let dlCount = 0;
// Input widget for a schema field. Returns { el, get() }.
export function fieldInput(f, value, { readonly = false, onChange } = {}) {
  const ro = readonly || f.readonly || !!f.computed;
  const common = { name: f.key, readOnly: ro, required: !!f.required && !ro, onchange: onChange, oninput: onChange };
  let el, get;
  switch (f.type) {
    case 'textarea':
      el = h('textarea', { ...common, rows: f.rows || 3 }); el.value = value ?? ''; get = () => el.value; break;
    case 'select': case 'yn': {
      const opts = f.type === 'yn' ? ['', 'Yes', 'No'] : f.options;
      el = h('select', { ...common, disabled: ro }, opts.map(o => h('option', { value: o }, o || '—')));
      if (value != null && value !== '' && !opts.includes(value)) el.append(h('option', { value }, value));
      el.value = value ?? ''; get = () => el.value; break;
    }
    case 'ref': {
      // Searchable: type part of the name / number and pick from the list (vendors, projects, POs …).
      const id = 'dl-' + ++dlCount;
      let list = [], cur = value ?? null;
      const inp = h('input', { name: f.key, readOnly: ro, required: !!f.required && !ro, list: ro ? null : id, autocomplete: 'off', placeholder: ro ? '' : 'Type to search…' });
      const dl = h('datalist', { id });
      el = h('span.ref-input', inp, dl);
      const show = () => { inp.value = cur == null ? '' : (list.find(o => o.id === cur)?.label ?? ''); inp.classList.remove('invalid'); };
      refOptions(f.ref).then(l => { list = l; dl.replaceChildren(...l.map(o => h('option', { value: o.label }))); if (document.activeElement !== inp) show(); }).catch(fail);
      const resolve = () => {
        const t = inp.value.trim();
        if (!t) { cur = null; inp.classList.remove('invalid'); return; }
        const hit = list.find(o => o.label === t) || (() => { const m = list.filter(o => o.label.toLowerCase().includes(t.toLowerCase())); return m.length === 1 ? m[0] : null; })();
        if (hit) { cur = hit.id; inp.value = hit.label; inp.classList.remove('invalid'); } else { cur = null; inp.classList.add('invalid'); }
      };
      inp.addEventListener('change', () => { resolve(); onChange?.(); });
      inp.addEventListener('blur', resolve);
      get = () => cur;
      el.invalid = () => inp.value.trim() !== '' && cur == null;
      el.setValue = v => { cur = v == null || v === '' ? null : Number(v); show(); };
      el.style.display = 'contents';
      break;
    }
    case 'person': {
      const id = 'dl-' + ++dlCount;
      // CRM users plus the names used in the registers (e.g. Saurabh, Pratiksha, Ashwin/Jai)
      const names = [...new Set([...state.people.map(p => p.name), ...(f.suggest || [])])];
      el = h('span', h('input', { ...common, list: id, autocomplete: 'off' }), h('datalist', { id }, names.map(n => h('option', { value: n }))));
      const inp = el.firstChild; inp.value = value ?? ''; get = () => inp.value; el.style.display = 'contents'; break;
    }
    case 'number': case 'money':
      el = h('input', { ...common, type: 'number', step: 'any', inputmode: 'decimal' }); el.value = value ?? ''; get = () => (el.value === '' ? null : Number(el.value)); break;
    case 'date':
      el = h('input', { ...common, type: 'date' }); el.value = value ?? ''; get = () => el.value || null; break;
    default: {
      if (f.suggest) {
        const id = 'dl-' + ++dlCount;
        el = h('span', h('input', { ...common, list: id }), h('datalist', { id }, f.suggest.map(s => h('option', { value: s }))));
        el.style.display = 'contents';
        el.firstChild.value = value ?? ''; get = () => el.firstChild.value;
      } else {
        el = h('input', { ...common, type: f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text' });
        el.value = value ?? ''; get = () => el.value;
      }
    }
  }
  return { el, get, set: v => (el.setValue ? el.setValue(v) : (el.value = v ?? '')), invalid: () => !!el.invalid?.() };
}

// Hover tooltip shared by charts
let tipEl;
export function tip(el, text) {
  el.addEventListener('mousemove', e => {
    tipEl ??= document.body.appendChild(h('div.tip'));
    tipEl.textContent = text; tipEl.style.display = 'block';
    tipEl.style.left = Math.min(e.clientX + 12, innerWidth - tipEl.offsetWidth - 8) + 'px';
    tipEl.style.top = e.clientY + 14 + 'px';
  });
  el.addEventListener('mouseleave', () => tipEl && (tipEl.style.display = 'none'));
}

export function download(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a); a.click(); a.remove();
}
