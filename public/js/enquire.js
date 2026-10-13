// Client enquiry wizard: one question per screen, contact details last, progress saved as the visitor goes.
// On submit the CRM creates an enquiry (with a lead score) and sales get a pop-up.
import { mount3D } from './ot3d.js';

const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]+)?(.*)$/i);
  const el = document.createElement(name);
  for (const p of rest.match(/[.#][^.#]+/g) || []) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // only used with our own static SVG icons
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const api = async (path, body, raw) => {
  const res = await fetch('/api/public' + path, raw ? { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: raw } : body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again');
  return data;
};

// ---------------------------------------------------------------- choices
const ICON = {
  ot: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M32 6v10"/><path d="M14 30a18 14 0 0 1 36 0z"/><path d="M24 36l-3 6M40 36l3 6M32 36v7"/><rect x="10" y="48" width="44" height="6" rx="2"/><path d="M18 54v6M46 54v6"/></svg>',
  icu: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="40" y="8" width="18" height="14" rx="2"/><path d="M43 17l3-4 3 6 3-4 3 2"/><path d="M6 40h52v8H6z"/><path d="M6 30v26M58 40v16"/><rect x="10" y="33" width="12" height="7" rx="3"/></svg>',
  nicu: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M10 36a22 16 0 0 1 44 0z"/><rect x="8" y="36" width="48" height="8" rx="2"/><path d="M16 44v12M48 44v12M12 56h40"/><circle cx="27" cy="31" r="3"/><path d="M30 32h10"/></svg>',
  picu: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 42h52v7H6z"/><path d="M6 32v24M58 42v14"/><circle cx="20" cy="30" r="6"/><circle cx="15" cy="24" r="2.5"/><circle cx="25" cy="24" r="2.5"/><path d="M38 14l4 4 8-8"/></svg>',
  cathlab: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 10a22 22 0 1 0 30 30"/><rect x="40" y="6" width="12" height="9" rx="2"/><rect x="40" y="38" width="12" height="9" rx="2"/><path d="M6 54h52M16 54v6M48 54v6"/></svg>',
  isolation: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="12" y="8" width="30" height="48" rx="2"/><path d="M36 32h2"/><path d="M50 18c0 0 8 3 8 10 0 9-8 13-8 13s-8-4-8-13c0-7 8-10 8-10z"/></svg>',
  ivf: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M24 6v18L10 50a6 6 0 0 0 5 8h34a6 6 0 0 0 5-8L40 24V6"/><path d="M20 6h24"/><circle cx="28" cy="44" r="3"/><circle cx="38" cy="48" r="2"/></svg>',
  cssd: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="8" y="10" width="48" height="44" rx="4"/><circle cx="32" cy="32" r="12"/><path d="M32 24v8l5 4"/><path d="M16 58v-4M48 58v-4"/></svg>',
  cleanroom: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="8" y="8" width="48" height="10" rx="2"/><path d="M16 24v14M26 24v20M36 24v14M46 24v20"/><path d="M8 56h48"/></svg>',
  other: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="32" cy="32" r="24"/><path d="M32 20v24M20 32h24"/></svg>',
};
const TYPES = [
  ['ot', 'Modular OT', 'Operation theatre'], ['icu', 'ICU', 'Intensive care'], ['nicu', 'NICU', 'Newborn care'], ['picu', 'PICU', 'Children\'s ICU'],
  ['cathlab', 'Cath Lab', 'Cardiac / X-ray'], ['isolation', 'Isolation Room', 'Infection control'], ['ivf', 'IVF Lab', 'Embryology'], ['cssd', 'CSSD', 'Sterilisation'],
  ['cleanroom', 'Clean Room', 'Pharma / lab'], ['other', 'Something else', 'Tell us below'],
];
const OT_SPECIALTY = ['General surgery', 'Orthopaedics', 'Cardiac', 'Neuro', 'Gynae / Obstetrics', 'Ophthalmic', 'ENT', 'Urology', 'Transplant', 'Robotic', 'Day care'];
const ICU_TYPE = ['Medical ICU', 'Surgical ICU', 'Cardiac ICU', 'Neuro ICU', 'Burns ICU', 'Covid / isolation ICU', 'NICU Level II', 'NICU Level III', 'PICU'];
const HIGH_LAF = ['Orthopaedics', 'Cardiac', 'Neuro', 'Transplant', 'Robotic'];
// [key, label, hint, icon, for which projects]
const FEATURES = [
  ['laf', 'Laminar air flow', 'A gentle downward flow of filtered air over the table keeps the surgical area particle-free.', '🌬️', ['ot', 'cathlab', 'ivf', 'cleanroom']],
  ['hepa', 'HEPA filtration', 'Filters that trap 99.99% of dust and bacteria from the air coming into the room.', '🧪', ['ot', 'icu', 'nicu', 'picu', 'cathlab', 'isolation', 'ivf', 'cssd', 'cleanroom']],
  ['panels', 'Modular wall & ceiling panels', 'Smooth, joint-free SS / PPGL panels instead of plaster and paint: easy to clean, nothing for germs to hide in.', '🧱', ['*']],
  ['doors', 'Hermetic sliding doors', 'Air-tight automatic doors that keep the room pressure and sterility.', '🚪', ['ot', 'icu', 'nicu', 'picu', 'cathlab', 'isolation', 'ivf']],
  ['pendants', 'Surgeon & anaesthesia pendants', 'Ceiling arms carrying gases, power and equipment, so there are no cables on the floor.', '🦾', ['ot', 'cathlab']],
  ['otlight', 'LED OT light', 'Bright, shadow-free light over the operating table.', '💡', ['ot']],
  ['bedhead', 'Bed-head panels / ICU pendants', 'Gas outlets, power sockets and a monitor shelf at every bed.', '🛏️', ['icu', 'nicu', 'picu', 'isolation']],
  ['warmers', 'Incubator & warmer bays', 'Power and gas points planned for incubators, warmers and phototherapy.', '👶', ['nicu']],
  ['mgps', 'Medical gas pipeline (MGPS)', 'Oxygen, air, vacuum and N₂O piped to the pendants and walls.', '🫧', ['ot', 'icu', 'nicu', 'picu', 'cathlab', 'isolation']],
  ['control', "Surgeon's control panel", 'One touch screen for temperature, humidity, lights, timers and gas alarms.', '🖥️', ['ot', 'cathlab']],
  ['automation', 'OT automation & remote monitoring', 'See room conditions and alarms on your phone; records for NABH audits.', '📱', ['ot', 'icu', 'nicu', 'picu', 'cathlab', 'isolation', 'cleanroom']],
  ['pressure', 'Positive / negative pressure control', 'Protects patients (positive) or contains infection (negative), switchable.', '🔁', ['icu', 'nicu', 'picu', 'isolation', 'ot']],
  ['xray', 'X-ray film viewer', 'Wall-mounted LED viewer for X-ray films.', '🩻', ['ot', 'cathlab']],
  ['lead', 'Lead-lined walls & doors', 'Radiation protection for Cath Lab and X-ray rooms.', '🛡️', ['cathlab', 'ot']],
  ['scrub', 'Scrub station', 'Hands-free surgical hand-wash outside the OT.', '🚿', ['ot', 'cathlab']],
  ['handwash', 'Hand-wash stations', 'Touch-free hand-wash points for staff and visitors.', '🧼', ['icu', 'nicu', 'picu', 'isolation']],
  ['nurse', 'Nurse station', 'Central desk with view of all beds and monitors.', '🧑‍⚕️', ['icu', 'nicu', 'picu']],
  ['passbox', 'Pass box', 'Pass instruments and samples in and out without opening the door.', '📦', ['ot', 'ivf', 'cssd', 'cleanroom', 'isolation']],
  ['flooring', 'Antistatic seamless flooring', 'Conductive vinyl floor without joints: safe and easy to disinfect.', '⬛', ['*']],
  ['storage', 'SS storage cabinets', 'Flush stainless steel wall cabinets for consumables.', '🗄️', ['ot', 'icu', 'nicu', 'picu', 'cathlab', 'cssd']],
  ['fumigation', 'Fumigation system', 'Disinfects the room between cases.', '💨', ['ot', 'icu', 'nicu', 'picu', 'isolation', 'cssd']],
  ['ahu', 'AHU & air conditioning', 'The air handling unit that cools, filters and pressurises the room — the heart of the system.', '❄️', ['*']],
];
const TIMELINES = [['1m', 'Within 1 month'], ['3m', '1–3 months'], ['6m', '3–6 months'], ['6p', 'More than 6 months'], ['explore', 'Just exploring']];
const BUDGETS = [['u50', 'Under ₹50 lakh'], ['50_100', '₹50 lakh – 1 crore'], ['100_200', '₹1 – 2 crore'], ['200_500', '₹2 – 5 crore'], ['500p', 'Above ₹5 crore'], ['guide', 'Need guidance']];
const BEST_TIME = ['Morning', 'Afternoon', 'Evening', 'Any time'];
const typeName = t => TYPES.find(x => x[0] === t)?.[1] || t;

// ---------------------------------------------------------------- state (kept in this browser so a visitor can come back)
const KEY = 'wiespl-enquiry-v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
const S = { step: 0, token: null, done: null, files: [], ...saved, data: { types: [], specialties: [], features: [], whatsapp: true, ...(saved.data || {}) } };
S.files = []; // files cannot be kept between visits
const D = S.data;
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ step: S.step, token: S.token, data: D, done: S.done })); } catch { /* ignore */ } };
let syncTimer;
const sync = () => {
  persist();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => { try { const r = await api('/lead', { token: S.token, step: S.step, data: D }); S.token = r.token; persist(); } catch { /* offline: saved locally */ } }, 600);
};
let config = { trust: [] };

// ---------------------------------------------------------------- steps (shown only when they apply)
const has = (...t) => t.some(x => D.types.includes(x));
const needsOts = () => has('ot', 'cathlab');
const needsBeds = () => has('icu', 'nicu', 'picu', 'isolation');
const can3D = () => has('ot', 'icu', 'nicu', 'picu', 'cathlab', 'isolation');
const featuresFor = () => FEATURES.filter(f => f[4].includes('*') || f[4].some(t => D.types.includes(t)));
const STEPS = [
  { id: 'types', render: stepTypes, valid: () => D.types.length > 0 && (!D.types.includes('other') || D.types.length > 1 || (D.other_type || '').trim()) },
  { id: 'build', render: stepBuild, valid: () => !!D.build },
  { id: 'size', render: stepSize },
  { id: 'specialty', render: stepSpecialty, when: () => needsOts() || needsBeds() },
  { id: 'features', render: stepFeatures },
  { id: '3d', render: step3D, when: can3D },
  { id: 'plan', render: stepPlan },
  { id: 'files', render: stepFiles },
  { id: 'contact', render: stepContact, valid: () => (D.name || '').trim() && String(D.phone || '').replace(/\D/g, '').length >= 10 },
];
const active = () => STEPS.filter(s => !s.when || s.when());

function feedback(text) {
  const f = document.querySelector('.eq-feedback');
  if (!f) return;
  f.textContent = text;
  f.classList.toggle('show', !!text);
}

function card(step, total, title, sub, body, { next = 'Next', canNext = true, onNext, skip } = {}) {
  const nextBtn = h('button.eq-btn.primary', { type: 'button', disabled: !canNext, onclick: () => (onNext ? onNext() : go(1)) }, next);
  return h('section.eq-card',
    h('div.eq-step', `Step ${step} of ${total}`), h('h1', title), sub ? h('p.eq-sub', sub) : null,
    body, h('div.eq-feedback'), h('div.eq-err', { id: 'eq-err' }),
    h('div.eq-nav', step > 1 ? h('button.eq-btn', { type: 'button', onclick: () => go(-1) }, '‹ Back') : null,
      skip ? h('button.eq-btn.link', { type: 'button', onclick: () => go(1) }, skip) : null, nextBtn));
}
const setNext = ok => { const b = document.querySelector('.eq-btn.primary'); if (b) b.disabled = !ok; };
const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };

function stepTypes(n, total) {
  const other = h('input', { placeholder: 'e.g. Dialysis unit, Burns unit', value: D.other_type || '', oninput: e => { D.other_type = e.target.value; setNext(STEPS[0].valid()); sync(); } });
  const otherBox = h('label.eq-field', { style: { marginTop: '12px', display: D.types.includes('other') ? '' : 'none' } }, 'What are you planning?', other);
  const cards = h('div.eq-cards.wide', TYPES.map(([k, label, small]) => {
    const b = h('button.eq-pick', { type: 'button', 'aria-pressed': String(D.types.includes(k)), onclick: () => {
      toggle(D.types, k);
      b.setAttribute('aria-pressed', String(D.types.includes(k)));
      otherBox.style.display = D.types.includes('other') ? '' : 'none';
      setNext(STEPS[0].valid()); summary(); sync();
      feedback(D.types.includes('nicu') ? 'NICUs need gentle, filtered air and warmer-ready bed bays: we will plan for that.'
        : D.types.includes('ot') && D.types.length > 1 ? 'Planning a complete critical-care block? Great, we can design it all together.'
          : D.types.includes('ot') ? 'Great choice. You can see a modular OT in 3D in a few steps.' : '');
    } }, h('span', { html: ICON[k] }), h('b', label), h('small', small));
    return b;
  }));
  return card(n, total, 'What are you planning?', 'Choose one or more.', [
    h('div.eq-hello', '👋 Takes about 2 minutes. No technical knowledge needed: pick what fits, or choose “I\'m not sure” and we will guide you.'),
    cards, otherBox], { canNext: STEPS[0].valid() });
}

function stepBuild(n, total) {
  const opt = (k, title, sub, icon) => h('button.eq-pick', { type: 'button', 'aria-pressed': String(D.build === k), onclick: () => {
    D.build = k; sync(); summary();
    feedback(k === 'renovation' ? 'Renovations are everyday work for us: we will survey your existing space first.' : k === 'new' ? 'Perfect, starting early lets us plan ducts, gases and electricals with your architect.' : 'No problem, we will help you decide.');
    setTimeout(() => go(1), 450);
  } }, h('span', { style: { fontSize: '30px' } }, icon), h('span', h('b', title), h('small', sub)));
  return card(n, total, 'Is it a new building or an existing space?', null,
    h('div.eq-big', opt('new', 'New construction', 'Building is being planned or built', '🏗️'), opt('renovation', 'Renovation', 'Upgrading an existing OT / ward', '🛠️'),
      opt('unsure', 'I\'m not sure yet', 'We will help you decide', '🤔')),
    { canNext: !!D.build });
}

function stepper(label, small, key, max) {
  const out = h('output', D[key] ?? 0);
  const set = v => { D[key] = Math.max(0, Math.min(max, v)); out.textContent = D[key]; summary(); sync(); };
  return h('div.eq-num', h('div.lbl', h('b', label), h('small', small)),
    h('div.eq-stepper', h('button', { type: 'button', 'aria-label': `Fewer ${label}`, onclick: () => set((D[key] || 0) - 1) }, '−'), out,
      h('button', { type: 'button', 'aria-label': `More ${label}`, onclick: () => set((D[key] || 0) + 1) }, '+')));
}
function stepSize(n, total) {
  if (needsOts() && D.ots == null) D.ots = 1;
  if (needsBeds() && D.beds == null) D.beds = 6;
  const area = h('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: 'e.g. 400', value: D.area || '', oninput: e => { D.area = e.target.value ? Number(e.target.value) : null; D.area_unsure = false; unsure.setAttribute('aria-pressed', 'false'); summary(); sync(); } });
  const unsure = h('button.eq-chip.unsure', { type: 'button', 'aria-pressed': String(!!D.area_unsure), onclick: () => { D.area_unsure = !D.area_unsure; unsure.setAttribute('aria-pressed', String(D.area_unsure)); if (D.area_unsure) { D.area = null; area.value = ''; } summary(); sync(); } }, 'I\'m not sure');
  return card(n, total, 'How big is the project?', 'A rough idea is enough.', [
    needsOts() ? stepper(has('cathlab') && !has('ot') ? 'Cath labs' : 'Operation theatres', 'number of rooms', 'ots', 40) : null,
    needsBeds() ? stepper(has('nicu') && !has('icu', 'picu') ? 'NICU beds / incubators' : 'ICU / ward beds', 'total beds', 'beds', 200) : null,
    h('div.eq-label', 'Approximate area (sq ft)'), h('div.eq-row2', area, h('div', { style: { paddingTop: '6px' } }, unsure)),
    h('p.eq-skip', { style: { marginTop: '8px' } }, 'One standard OT is about 20 × 20 ft (400 sq ft).')]);
}

function stepSpecialty(n, total) {
  const list = [...(needsOts() ? OT_SPECIALTY : []), ...(needsBeds() ? ICU_TYPE.filter(t => (has('nicu') || !t.startsWith('NICU')) && (has('picu') || t !== 'PICU')) : [])];
  const chips = h('div.eq-chips', [...list, 'Not sure yet'].map(s => {
    const b = h('button.eq-chip' + (s === 'Not sure yet' ? '.unsure' : ''), { type: 'button', 'aria-pressed': String(D.specialties.includes(s)), onclick: () => {
      toggle(D.specialties, s); b.setAttribute('aria-pressed', String(D.specialties.includes(s))); summary(); sync();
      const high = D.specialties.find(x => HIGH_LAF.includes(x));
      feedback(high ? `Great: ${high.toLowerCase()} OTs usually need laminar air flow with HEPA filters. We will include those options.`
        : D.specialties.some(x => x.startsWith('NICU')) ? 'Level III NICUs need more gas points and power per bed: we plan bays to suit.'
          : D.specialties.length ? 'Noted. This helps us size the air system correctly.' : '');
    } }, s);
    return b;
  }));
  return card(n, total, needsOts() ? 'Which specialty will use it?' : 'What kind of ICU?', 'Pick all that apply.', chips, { skip: 'Skip' });
}

function stepFeatures(n, total) {
  const feats = featuresFor();
  const unsure = h('button.eq-chip.unsure', { type: 'button', 'aria-pressed': String(!!D.features_unsure), onclick: () => { D.features_unsure = !D.features_unsure; unsure.setAttribute('aria-pressed', String(D.features_unsure)); summary(); sync(); feedback(D.features_unsure ? 'No problem: our engineer will recommend what your rooms need.' : ''); } }, 'I\'m not sure – please suggest');
  const list = h('div.eq-feats', feats.map(([k, label, hint, icon]) => {
    const b = h('button.eq-feat', { type: 'button', 'aria-pressed': String(D.features.includes(label)), onclick: () => {
      toggle(D.features, label); b.setAttribute('aria-pressed', String(D.features.includes(label))); summary(); sync();
      feedback(D.features.length >= 6 ? 'That is a complete, NABH-ready setup. You will see it in 3D next.' : k === 'laf' && D.features.includes(label) ? 'Laminar flow + HEPA is the standard for infection-sensitive surgery.' : '');
    } }, h('span.ico', icon), h('span', h('b', label), h('small', hint)));
    return b;
  }));
  return card(n, total, 'Which features interest you?', 'Tap to add. Each one has a one-line explanation.', [h('div', { style: { marginBottom: '12px' } }, unsure), list]);
}

let viewer = null;
function step3D(n, total) {
  const box = h('div.eq-3d', h('div.loading', 'Loading 3D view…'));
  D.viewed_3d = true; sync();
  const bar = h('div.eq-3dbar');
  const legend = h('div.eq-legend', h('span', h('i', { style: { background: '#1e7d3a' } }), 'in your plan'), h('span', h('i', { style: { background: '#9aa7ba' } }), 'available'), h('span', 'Drag to turn · pinch or scroll to zoom · tap a label'));
  setTimeout(async () => {
    viewer?.dispose?.();
    viewer = await mount3D(box, { types: D.types, features: D.features.map(l => FEATURES.find(f => f[1] === l)?.[0]).filter(Boolean), ots: D.ots, beds: D.beds, info: Object.fromEntries(FEATURES.map(f => [f[0], { label: f[1], hint: f[2] }])) });
    if (viewer?.controls) {
      const chip = (label, fn, pressed) => { const b = h('button.eq-chip', { type: 'button', 'aria-pressed': String(!!pressed), onclick: () => { const on = fn(); if (on !== undefined) b.setAttribute('aria-pressed', String(on)); } }, label); return b; };
      bar.replaceChildren(...viewer.controls.map(c => chip(c.label, c.run, c.pressed)));
    }
  }, 30);
  return card(n, total, has('ot', 'cathlab') ? 'Look inside your OT' : `Look inside your ${has('nicu') && !has('icu', 'picu') ? 'NICU' : has('picu') && !has('icu') ? 'PICU' : 'ICU'}`, 'This is how a WIESPL room is put together. Items you picked are marked in green; tap any label to learn what it does.',
    [box, bar, legend], { next: 'Looks good – next' });
}

function stepPlan(n, total) {
  const group = (items, key, after) => h('div.eq-chips', items.map(([k, label]) => {
    const b = h('button.eq-chip' + (k === 'guide' || k === 'explore' ? '.unsure' : ''), { type: 'button', 'aria-pressed': String(D[key] === k), onclick: () => {
      D[key] = D[key] === k ? null : k;
      b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b && D[key] === k)));
      summary(); sync(); after?.();
    } }, label);
    return b;
  }));
  return card(n, total, 'When would you like to start, and what budget are you working with?', 'Ranges are fine. This only helps us suggest the right options.', [
    h('div.eq-label', 'Timeline'), group(TIMELINES, 'timeline', () => feedback(D.timeline === '1m' ? 'Understood, we will prioritise your enquiry.' : '')),
    h('div.eq-label', 'Budget'), group(BUDGETS, 'budget', () => feedback(D.budget === 'guide' ? 'Sure: we will share options at different price points.' : ''))], { skip: 'Skip' });
}

function stepFiles(n, total) {
  const input = h('input', { type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.zip', style: { display: 'none' } });
  const list = h('ul.eq-files');
  const draw = () => list.replaceChildren(...S.files.map((f, i) => h('li', h('span', `📎 ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`), h('button', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: () => { S.files.splice(i, 1); D.has_drawing = S.files.length > 0; draw(); } }, '✕'))));
  const add = files => {
    for (const f of files) {
      if (S.files.length >= 5) break;
      if (f.size > 25 * 1048576) { $('eq-err').textContent = `${f.name} is larger than 25 MB`; continue; }
      S.files.push(f);
    }
    D.has_drawing = S.files.length > 0; draw(); sync();
    if (S.files.length) feedback('Thanks, a layout helps us send an accurate proposal.');
  };
  input.onchange = () => add(input.files);
  const drop = h('div.eq-drop', { role: 'button', tabindex: '0', onclick: () => input.click(), onkeydown: e => (e.key === 'Enter' || e.key === ' ') && input.click(),
    ondragover: e => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: e => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); } },
  h('div', { style: { fontSize: '30px' } }, '📐'), h('b', 'Tap to add a layout, drawing or photo'), h('span.eq-skip', 'PDF, image, AutoCAD (DWG / DXF) · up to 25 MB each'));
  draw();
  return card(n, total, 'Do you have a layout or drawing?', 'Optional. A floor plan, a hand sketch or a photo of the space all help.', [drop, input, list], { skip: S.files.length ? null : 'I don\'t have one', next: S.files.length ? 'Next' : 'Next' });
}

function stepContact(n, total) {
  const field = (key, label, attrs = {}, req) => h('label.eq-field', label, req ? h('span.req', ' *') : null,
    h('input', { value: D[key] || '', ...attrs, oninput: e => { D[key] = e.target.value; summary(); sync(); setNext(STEPS.at(-1).valid()); } }));
  const wa = h('input', { type: 'checkbox', ...(D.whatsapp !== false ? { checked: true } : {}), onchange: e => { D.whatsapp = e.target.checked; sync(); } });
  const times = h('div.eq-chips', BEST_TIME.map(t => { const b = h('button.eq-chip', { type: 'button', 'aria-pressed': String(D.best_time === t), onclick: () => { D.best_time = D.best_time === t ? '' : t; b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b && D.best_time === t))); sync(); } }, t); return b; }));
  const notes = h('textarea', { rows: 3, placeholder: 'Anything else we should know (optional)', oninput: e => { D.notes = e.target.value; sync(); } });
  notes.value = D.notes || '';
  return card(n, total, 'Where should we send your proposal?', 'Only your name and phone are needed.', [
    h('div.eq-row2', field('name', 'Your name', { autocomplete: 'name', placeholder: 'Dr. …' }, true), field('phone', 'Mobile number', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '98xxxxxxxx' }, true)),
    h('label.eq-check', wa, 'I use WhatsApp on this number'),
    h('div.eq-row2', field('hospital', 'Hospital / clinic', { autocomplete: 'organization' }), field('city', 'City', { autocomplete: 'address-level2' })),
    field('email', 'Email (optional)', { type: 'email', autocomplete: 'email' }),
    h('div.eq-label', 'Best time to call'), times,
    h('label.eq-field', { style: { marginTop: '14px' } }, 'Notes', notes),
    h('p.eq-skip', '🔒 We use these details only to reply to your enquiry.')],
  { next: 'Send my enquiry', canNext: !!STEPS.at(-1).valid(), onNext: submit });
}

// ---------------------------------------------------------------- navigation, summary, submit
function go(delta) {
  const list = active();
  let i = Math.max(0, list.findIndex(s => s.id === STEPS[S.step]?.id));
  if (delta > 0 && list[i]?.valid && !list[i].valid()) { const e = $('eq-err'); if (e) e.textContent = 'Please choose an option to continue.'; return; }
  i = Math.max(0, Math.min(list.length - 1, i + delta));
  S.step = STEPS.indexOf(list[i]);
  sync();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function summaryItems() {
  const types = D.types.map(t => (t === 'other' ? D.other_type || 'Other' : typeName(t)));
  const size = [D.ots && needsOts() && `${D.ots} ${has('ot') ? 'OT' : 'room'}${D.ots > 1 ? 's' : ''}`, D.beds && needsBeds() && `${D.beds} beds`, D.area && `${D.area} sq ft`].filter(Boolean).join(' · ');
  return [
    types.length && ['Project', types.join(', ')], D.build && ['Type', { new: 'New build', renovation: 'Renovation', unsure: 'Not sure' }[D.build]], size && ['Size', size],
    D.specialties.length && ['Specialty', D.specialties.join(', ')], (D.features.length || D.features_unsure) && ['Features', D.features.length ? `${D.features.length} selected` : 'needs advice'],
    D.timeline && ['Timeline', TIMELINES.find(t => t[0] === D.timeline)[1]], D.budget && ['Budget', BUDGETS.find(t => t[0] === D.budget)[1]],
  ].filter(Boolean);
}
function summary() {
  const items = summaryItems();
  const short = [D.ots && needsOts() ? `${D.ots} ${has('ot') ? 'OT' : 'room'}${D.ots > 1 ? 's' : ''}` : null, ...D.types.filter(t => t !== 'ot' || !needsOts()).map(typeName), D.specialties[0], { new: 'New build', renovation: 'Renovation' }[D.build]].filter(Boolean);
  const box = h('div.eq-sumcard', h('h2', '🏥 Your project'), items.length ? h('ul', items.map(([k, v]) => h('li', h('span', k), h('b', v)))) : h('div.empty', 'Your answers will appear here.'));
  const trust = config.trust?.length ? h('div.eq-sumcard', h('h2', `Why ${config.short || 'us'}`), h('ul.eq-trust', config.trust.map(t => h('li', t)))) : null;
  $('eq-side').replaceChildren(box, trust);
  const pill = $('eq-pill');
  pill.hidden = !items.length || !!S.done;
  document.body.classList.toggle('has-pill', !pill.hidden);
  pill.textContent = `🏥 Your project: ${short.join(' · ') || items.map(i => i[1]).join(' · ')}  ▴`;
  pill.onclick = () => {
    const sheet = h('div.eq-sheet', { onclick: e => e.target === sheet && sheet.remove() }, h('div', box.cloneNode(true), trust ? trust.cloneNode(true) : null, h('button.eq-btn', { type: 'button', style: { width: '100%' }, onclick: () => sheet.remove() }, 'Close')));
    document.body.append(sheet);
  };
}

async function submit() {
  const err = $('eq-err');
  const btn = document.querySelector('.eq-btn.primary');
  if (!STEPS.at(-1).valid()) { err.textContent = 'Please enter your name and a 10-digit mobile number.'; return; }
  btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
  try {
    clearTimeout(syncTimer);
    if (!S.token) { const r0 = await api('/lead', { step: S.step, data: D }); S.token = r0.token; }
    const r = await api('/lead/submit', { token: S.token, data: { ...D, has_drawing: S.files.length > 0 } });
    let uploaded = 0;
    for (const f of S.files) {
      try { await fetch(`/api/public/lead/file?token=${encodeURIComponent(S.token)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f }).then(x => { if (x.ok) uploaded++; }); } catch { /* keep going */ }
    }
    S.done = { ref: r.ref, estimate: r.estimate, uploaded, files: S.files.length };
    persist();
    render();
  } catch (e) {
    err.textContent = e.message; btn.disabled = false; btn.textContent = 'Send my enquiry';
  }
}

const inrShort = v => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} crore` : `₹${Math.round(v / 1e5)} lakh`);
// 'Dr. Asha Patil' → 'Dr. Asha', 'Rahul Shah' → 'Rahul'
const greetName = n => {
  const m = String(n).trim().match(/^(?:(dr|prof)\.?\s+)?(\S+)/i);
  if (!m) return n;
  return m[1] ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}. ${m[2]}` : m[2];
};
function thanks() {
  const d = S.done;
  const wa = config.whatsapp ? `https://wa.me/${config.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello, I just sent enquiry ${d.ref || ''} on your website.`)}` : null;
  return h('section.eq-card.eq-done',
    h('div.big', '✅'), h('h1', `Thank you${D.name ? ', ' + greetName(D.name) : ''}!`),
    d.ref ? h('div.eq-ref', `Enquiry no. ${d.ref}`) : null,
    h('p.eq-sub', config.next_steps || 'Our team will call you within 24 hours.'),
    d.files && d.uploaded < d.files ? h('p.eq-err', 'Some files could not be uploaded; please send them on WhatsApp or email.') : null,
    d.estimate ? h('div.eq-range', h('div', 'Projects like yours typically fall between'), h('b', `${inrShort(d.estimate.low)} – ${inrShort(d.estimate.high)}`), h('div.eq-skip', 'Indicative only. Your exact price depends on the layout and the features you choose.')) : null,
    h('div.eq-actions',
      config.brochure_url ? h('a.eq-btn', { href: config.brochure_url, target: '_blank', rel: 'noopener' }, '📄 Download brochure') : null,
      wa ? h('a.eq-btn', { href: wa, target: '_blank', rel: 'noopener' }, '💬 WhatsApp us') : null,
      config.phone ? h('a.eq-btn', { href: `tel:${String(config.phone).split(/[,/]/)[0].replace(/[^\d+]/g, '')}` }, '📞 Call') : null,
      h('button.eq-btn', { type: 'button', onclick: () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } location.reload(); } }, 'Start a new enquiry')));
}

function render() {
  const main = $('eq-main');
  if (viewer && STEPS[S.step]?.id !== '3d') { viewer.dispose?.(); viewer = null; }
  if (S.done) { main.replaceChildren(thanks()); $('eq-bar').style.width = '100%'; summary(); return; }
  const list = active();
  let i = list.findIndex(s => s.id === STEPS[S.step]?.id);
  if (i < 0) { i = 0; S.step = STEPS.indexOf(list[0]); }
  $('eq-bar').style.width = `${Math.round((i / list.length) * 100)}%`;
  main.replaceChildren(list[i].render(i + 1, list.length));
  summary();
}

(async () => {
  try {
    config = await api('/config');
    $('eq-company').textContent = config.short || config.company || 'WIESPL';
    if (config.tagline) $('eq-tagline').textContent = config.tagline;
    const tel = String(config.phone || '').split(/[,/]/)[0].replace(/[^\d+]/g, '');
    if (tel) { $('eq-call').href = `tel:${tel}`; $('eq-call').hidden = false; }
  } catch { /* the form still works */ }
  render();
})();
