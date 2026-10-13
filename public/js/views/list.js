import { h, api, state, display, fail, download, toast, confirmBox, clearRefCache, busy, modal } from '../ui.js';
import { ENTITIES, fieldMap, canWrite, canDelete } from '../schema.js';
import { inr } from '../calc.js';

export const recordHref = (entity, id) => (ENTITIES[entity].editor === 'quotation' ? `#/quotation/${id}` : ENTITIES[entity].editor === 'boq' ? `#/boq/${id}`
  : ENTITIES[entity].editor === 'bom' ? `#/bom/${id}` : `#/view/${entity}/${id}`);

// Lists with an Excel import (opens Import with the right kind chosen).
const IMPORTABLE = { vendors: 'vendors', items: 'items', projects: 'projects', purchase_orders: 'purchase_orders', requisitions: 'requisitions', stock_moves: 'items', enquiries: 'enquiries' };

const NUMERIC = ['money', 'number'];

// `selected` (a Set of ids) adds tick boxes, e.g. to delete several records at once.
export function table(entity, rows, { columns, pageSize = 50, totals = true, selected = null, onSelect } = {}) {
  const ent = ENTITIES[entity];
  const fm = fieldMap(entity);
  const cols = (columns || ent.list).map(k => fm[k]).filter(Boolean);
  let sortKey = null, dir = 1, page = 0;
  const wrap = h('div');

  function render() {
    let data = rows;
    if (sortKey) {
      const f = fm[sortKey];
      const val = r => (f.type === 'ref' ? r[`${sortKey}_label`] : r[sortKey]) ?? '';
      data = [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        return (NUMERIC.includes(f.type) ? (Number(x) || 0) - (Number(y) || 0) : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
    }
    const pages = Math.max(1, Math.ceil(data.length / pageSize));
    page = Math.min(page, pages - 1);
    const slice = data.slice(page * pageSize, (page + 1) * pageSize);
    const moneyCols = cols.filter(c => c.type === 'money');
    const tick = (on, change) => h('input', { type: 'checkbox', checked: on, style: { width: 'auto' }, onclick: e => e.stopPropagation(), onchange: e => { change(e.target.checked); onSelect?.(); } });
    const thead = h('thead', h('tr', selected ? h('th', tick(slice.length > 0 && slice.every(r => selected.has(r.id)), on => { for (const r of slice) on ? selected.add(r.id) : selected.delete(r.id); render(); })) : null, cols.map(c => h('th' + (NUMERIC.includes(c.type) ? '.num' : ''), {
      onclick: () => { dir = sortKey === c.key ? -dir : 1; sortKey = c.key; render(); },
      title: 'Sort',
    }, c.label, sortKey === c.key ? (dir > 0 ? ' ▲' : ' ▼') : ''))));
    const tbody = h('tbody', slice.map(r => h('tr.clickable', { onclick: () => (location.hash = recordHref(entity, r.id)) },
      selected ? h('td', tick(selected.has(r.id), on => (on ? selected.add(r.id) : selected.delete(r.id)))) : null,
      cols.map(c => h('td' + (NUMERIC.includes(c.type) ? '.num' : c.type === 'textarea' ? '.clip' : ''), display(c, r))))));
    const tfoot = totals && moneyCols.length && rows.length > 1
      ? h('tfoot', h('tr', selected ? h('td') : null, cols.map((c, i) => h('td' + (c.type === 'money' ? '.num' : ''),
        c.type === 'money' ? inr(data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)) : i === 0 ? `Total (${data.length})` : ''))))
      : null;
    wrap.replaceChildren(
      rows.length ? h('div.table-wrap', h('table.data', thead, tbody, tfoot)) : h('div.empty', 'No records yet'),
      pages > 1 ? h('div.pager', `${data.length} records · page ${page + 1} of ${pages}`,
        h('button.btn.small', { disabled: page === 0, onclick: () => { page--; render(); } }, '‹ Prev'),
        h('button.btn.small', { disabled: page >= pages - 1, onclick: () => { page++; render(); } }, 'Next ›')) : null,
    );
  }
  render();
  return wrap;
}

export async function newRecord(entity, preset = {}) {
  if (ENTITIES[entity].editor === 'boq') { const { newBoqDialog } = await import('./dispatch.js'); return newBoqDialog(preset); }
  if (ENTITIES[entity].editor === 'bom') { const { newBomDialog } = await import('./bom.js'); return newBomDialog(preset); }
  if (ENTITIES[entity].editor === 'quotation') {
    const q = preset.enquiry_id ? await api(`/enquiries/${preset.enquiry_id}/quotation`, { method: 'POST' }) : await api('/quotations', { method: 'POST', body: { status: 'Draft', ...preset, data: { rooms: [], lines: [], optionals: [], terms: state.settings.terms, client_scope: state.settings.client_scope, scope_matrix: state.settings.scope_matrix, letter_intro: state.settings.letter_intro, boq_title: 'WIESPL ESTIMATE FOR LAMINAR AIR FLOW, CONTROL PANEL WITH MODULAR OT - PPGL' }, subject: state.settings.default_subject } });
    location.hash = `#/quotation/${q.id}`;
    return;
  }
  const qs = new URLSearchParams(preset).toString();
  location.hash = `#/edit/${entity}/new${qs ? '?' + qs : ''}`;
}

// Link to the client-facing enquiry form (enquire.html) to send on WhatsApp / email / website.
async function shareForm() {
  const url = `${location.origin}/enquire.html`;
  const text = `Planning a Modular OT, ICU or NICU? Tell us about your project in 2 minutes and see it in 3D: ${url}`;
  const input = h('input', { value: url, readOnly: true, onclick: e => e.target.select() });
  await modal('Client enquiry form', h('div.grid',
    h('p', 'Send this link to doctors and hospitals. What they fill in comes into the Enquiry Register as a new enquiry (source: Website, with a Hot / Warm / Cold lead score), and sales get a pop-up.'),
    h('label', 'Link', input),
    location.hostname === 'localhost' || /^(192\.168|10\.|172\.)/.test(location.hostname) ? h('p', { style: { color: 'var(--warn)' } }, '⚠ This address only works inside your office network. For clients outside, use the Render (internet) address of the CRM.') : null,
    h('div.toolbar', h('a.btn.primary', { href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, '💬 Share on WhatsApp'),
      h('button.btn', { onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { input.select(); toast('Press Ctrl+C to copy'); } } }, '📋 Copy link'),
      h('a.btn', { href: url, target: '_blank', rel: 'noopener' }, '👀 Open the form'))),
  [{ label: 'Close', value: true }]);
}

// A WIESPL estimate (ANNEXURE III, e.g. "SS 304_MOT.xlsx") becomes a standard BOQ with prices for quotations.
async function importEstimate() {
  const set = h('input', { value: 'SS 304 MOT' });
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const ok = await modal('Import estimate Excel as a standard BOQ', h('div.grid',
    h('p', 'Reads the estimate sheet (Sr. No. | Particulars | Rate | Installation | Basic Rate | GST | Qty | UOM). Rates, installation %, GST % (e.g. 28% for AC / AHU) and "As per basis of design" quantities are kept. In a quotation, choose this standard BOQ under “⚡ Load standard BOQ”.'),
    h('label', 'Name of this standard BOQ', set), h('label', 'Estimate Excel', file),
    h('p.muted', 'Importing again under the same name replaces that standard BOQ (quotations already made are not changed).')),
  [{ label: 'Cancel', value: false }, { label: 'Import', cls: 'primary', value: true }]);
  if (!ok) return;
  if (!file.files[0]) throw new Error('Choose the Excel file');
  const r = await api(`/products/import-boq?set=${encodeURIComponent(set.value)}`, { method: 'POST', raw: await file.files[0].arrayBuffer() });
  toast(`Standard BOQ "${r.set}": ${r.items} priced items, ${r.lines - r.items} headings; GST ${r.gst_rates.join('% / ')}%`);
  location.hash = `#/list/products?boq_set=${encodeURIComponent(r.set)}&t=${Date.now()}`;
}

export async function listView(root, entity) {
  const ent = ENTITIES[entity];
  if (!ent) throw new Error('Unknown module');
  const fm = fieldMap(entity);
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = h('input.grow', { placeholder: `Search ${ent.label.toLowerCase()}…`, type: 'search', value: params.get('q') || '' });
  const statusSel = ent.statusField
    ? h('select', h('option', { value: '' }, 'All statuses'), fm[ent.statusField].options.map(o => h('option', { value: o }, o)))
    : null;
  if (statusSel) statusSel.value = params.get('status') || '';
  const hasDate = !!fm.date;
  const from = hasDate ? h('input', { type: 'date', title: 'From date' }) : null;
  const to = hasDate ? h('input', { type: 'date', title: 'To date' }) : null;
  const body = h('div.card.flush');
  const full = canDelete(entity, state.user.role);
  const selected = full ? new Set() : null;
  const delBtn = h('button.btn.danger', { style: { display: 'none' } });
  const syncDel = () => { delBtn.style.display = selected?.size ? '' : 'none'; delBtn.textContent = `🗑 Delete ${selected?.size || 0} selected`; };
  delBtn.onclick = busy(async () => {
    if (!(await confirmBox(`Delete ${selected.size} ${ent.label.toLowerCase()}? Their approvals and files are removed too. Records that other documents still use are kept and listed.`, 'Delete'))) return;
    const failed = [];
    let ok = 0;
    for (const id of [...selected]) {
      try { await api(`/${entity}/${id}`, { method: 'DELETE' }); ok++; selected.delete(id); } catch (e) { failed.push(e.message); }
    }
    clearRefCache(entity);
    toast(`${ok} deleted${failed.length ? ` · ${failed.length} not deleted: ${failed[0]}` : ''}`, !!failed.length);
    load();
  });

  const query = () => {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    if (statusSel?.value) p.set(ent.statusField, statusSel.value);
    if (from?.value) p.set('from', from.value);
    if (to?.value) p.set('to', to.value);
    // other filters from the link, e.g. #/list/boqs?project_id=3
    for (const [k, v] of params) if (fm[k] && !p.has(k) && k !== ent.statusField && k !== 'q') p.set(k, v);
    return p.toString();
  };
  let timer;
  async function load() {
    try {
      const rows = await api(`/${entity}?${query()}`);
      for (const id of selected || []) if (!rows.some(r => r.id === id)) selected.delete(id);
      body.replaceChildren(table(entity, rows, { selected, onSelect: syncDel }));
      syncDel();
    } catch (e) { fail(e); }
  }
  const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  for (const el of [q, statusSel, from, to].filter(Boolean)) el.addEventListener('input', reload);

  root.replaceChildren(
    h('div.page-head', h('h1', `${ent.icon} ${ent.label}`), h('div.actions',
      h('button.btn', { onclick: () => download(`/api/export/${entity}?${query()}`) }, '⬇ Export Excel'),
      delBtn,
      entity === 'enquiries' ? h('button.btn', { onclick: busy(shareForm) }, '🔗 Client enquiry form') : null,
      entity === 'products' && canWrite(entity, state.user.role) ? h('button.btn', { onclick: busy(importEstimate) }, '📥 Import estimate Excel') : null,
      IMPORTABLE[entity] && canWrite(entity, state.user.role) ? h('a.btn', { href: `#/import?kind=${IMPORTABLE[entity]}` }, '📥 Import Excel') : null,
      canWrite(entity, state.user.role) && !ent.noCreate ? h('button.btn.primary', { onclick: () => newRecord(entity).catch(fail) }, `+ New ${ent.singular}`) : null)),
    h('div.toolbar', q, statusSel, from ? h('span.muted', 'From') : null, from, to ? h('span.muted', 'to') : null, to),
    body,
  );
  await load();
}
