import { h, api, state, toast, fail, modal, confirmBox, fieldInput, refOptions, clearRefCache, badge, money, fmtDate, today, busy, reservedRetry } from '../ui.js';
import { ENTITIES, canWrite, canDelete, hasFunction, APPROVAL_FLOWS, FUNCTIONS, ITEM_CATEGORIES, UOMS } from '../schema.js';
import { linesTotals, inr, round2 } from '../calc.js';
import { table, newRecord, recordHref } from './list.js';
import { newBoqDialog } from './dispatch.js';
import { newBomDialog } from './bom.js';

const LOCKED = {
  purchase_orders: ['Pending Approval', 'Approved', 'Sent', 'Partially Received', 'Received', 'Closed', 'Cancelled'],
  requisitions: ['Submitted', 'Approved', 'Converted to PO', 'Closed'],
  challans: ['Dispatched', 'Delivered', 'Cancelled'],
};
// Full access may delete anything (also locked documents); anyone else only their own draft.
export const mayDelete = (entity, row) => canDelete(entity, state.user.role)
  || (canWrite(entity, state.user.role) && row.created_by === state.user.name && ['Draft', 'Rejected'].includes(row.status));

// New material that is not in the item master yet: add it from the requisition / PO line.
export async function quickItem(preset = {}) {
  const f = { name: h('input', { value: preset.name || '' }), category: h('select', ITEM_CATEGORIES.map(c => h('option', c))), uom: h('select', UOMS.map(u => h('option', u))),
    rate: h('input', { type: 'number', step: 'any', placeholder: 'optional' }), hsn: h('input', { placeholder: 'optional' }), description: h('textarea', { rows: 2 }) };
  f.description.value = preset.spec || '';
  if (preset.uom && UOMS.includes(preset.uom)) f.uom.value = preset.uom;
  const it = await modal('Add new item to the item master', h('div.grid',
    h('p.muted', 'The item code is given automatically (finished goods FG…, everything else the next number). Opening stock is 0 until it is received (GRN).'),
    h('div.form-grid', h('label.span-2', 'Item name *', f.name), h('label', 'Category', f.category), h('label', 'UOM', f.uom), h('label', 'Price (₹)', f.rate), h('label', 'HSN', f.hsn),
      h('label.span-2', 'Specification', f.description))),
  [{ label: 'Cancel', value: null }, { label: 'Add item', cls: 'primary', action: async () => {
    if (!f.name.value.trim()) throw new Error('Enter the item name');
    return api('/items', { method: 'POST', body: { name: f.name.value.trim(), category: f.category.value, uom: f.uom.value, rate: f.rate.value === '' ? null : Number(f.rate.value), hsn: f.hsn.value || null, description: f.description.value || null } });
  } }]);
  if (it) { clearRefCache('items'); toast(`Item ${it.code} · ${it.name} added`); }
  return it;
}
const stepOf = (docType, stage) => (APPROVAL_FLOWS[docType] || []).find(s => s.stage === stage) || (APPROVAL_FLOWS[docType] || [])[0];
export const canApprove = (docType, stage) => !!stepOf(docType, stage) && hasFunction(state.user.role, stepOf(docType, stage).fn);
export const resolveDefault = d => d === 'today' ? today() : d === 'me' ? state.user.name
  : typeof d === 'string' && d.startsWith('setting:') ? state.settings[d.slice(8)] ?? '' : d;

// Searchable item picker: type a code or part of the name ("1001", "diffuser").
let pickerId = 0;
export function itemPicker(items, value, { readonly, onPick } = {}) {
  const id = 'items-dl-' + ++pickerId;
  const byLabel = new Map(items.map(o => [o.label, o.id]));
  const inp = h('input', { list: id, readOnly: readonly, placeholder: 'Item code or name…', style: { minWidth: '220px' } });
  inp.value = items.find(o => o.id === value)?.label || '';
  inp.onchange = () => {
    const picked = byLabel.get(inp.value) ?? (items.find(o => o.label.split(' · ')[0] === inp.value.trim())?.id);
    if (picked) inp.value = items.find(o => o.id === picked).label;
    onPick?.(picked || null);
  };
  return h('span', { style: { display: 'contents' } }, inp, h('datalist', { id }, items.map(o => h('option', { value: o.label }))));
}

// ---------------------------------------------------------------- line items (PO / invoice / requisition)
function linesEditor(f, value, { readonly, onTotals }) {
  let lines = Array.isArray(value) ? value.map(l => ({ ...l })) : [];
  const amounts = f.amounts !== false;
  const wrap = h('div');
  const totalsBox = h('div.totals');
  let items = [];

  function totals() {
    if (!amounts) return;
    const t = linesTotals(lines);
    totalsBox.replaceChildren(h('span', 'Taxable value'), h('span.right', inr(t.subtotal)), h('span', 'GST'), h('span.right', inr(t.tax)),
      h('span.grand', 'Total'), h('span.right.grand', inr(t.total)));
    onTotals?.(t);
  }
  function render() {
    const head = h('tr', h('th', '#'), f.itemRef ? h('th', 'Inventory item') : null, f.columns.map(c => h('th', { style: { minWidth: c.width + 'px' } }, c.label)),
      amounts ? h('th.num', 'Amount') : null, f.itemRef && amounts ? h('th.num', 'Received') : null, readonly ? null : h('th'));
    let sr = 0;
    const rows = lines.map((l, i) => {
      const amount = amounts ? h('td.num', inr((Number(l.qty) || 0) * (Number(l.rate) || 0))) : null;
      const cells = f.columns.map(c => {
        const inp = c.type === 'select' ? h('select', { disabled: readonly }, c.options.map(o => h('option', o)))
          : c.type === 'textarea' || (c.key === 'description' && !f.schedule)
            ? h('textarea', { rows: c.type === 'textarea' ? 2 : 1, readOnly: readonly, style: { minHeight: '32px' } })
            : h('input', { type: ['number', 'money'].includes(c.type) ? 'number' : c.type === 'date' ? 'date' : 'text', step: 'any', readOnly: readonly });
        inp.value = l[c.key] ?? (c.type === 'select' ? c.options[0] : '');
        if (c.type === 'select' && l[c.key] == null) l[c.key] = c.options[0];
        inp.oninput = inp.onchange = () => {
          l[c.key] = ['number', 'money'].includes(c.type) ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
          if (amount) amount.textContent = inr((Number(l.qty) || 0) * (Number(l.rate) || 0));
          totals();
        };
        return h('td', inp);
      });
      let itemCell = null;
      if (f.itemRef) {
        const addNew = !readonly && canWrite('items', state.user.role) && !l.item_id
          ? h('button.icon-btn', { type: 'button', title: 'New material: add it to the item master', onclick: busy(async () => {
            const it = await quickItem({ name: l.description, spec: l.spec, uom: l.uom });
            if (!it) return;
            items = await refOptions('items');
            Object.assign(l, { item_id: it.id, description: l.description || it.name, uom: l.uom || it.uom });
            render();
          }) }, '＋') : null;
        itemCell = h('td.nowrap', addNew, itemPicker(items, l.item_id, { readonly, onPick: async itemId => {
          l.item_id = itemId;
          if (!itemId) return;
          const it = await api(`/items/${itemId}`);
          Object.assign(l, { description: l.description || it.name, uom: it.uom || l.uom, hsn: l.hsn || it.hsn || '' });
          if (amounts) Object.assign(l, { rate: l.rate || it.rate || 0, gst: l.gst ?? it.gst_rate ?? 18 });
          render();
        } }), l.bom_item_id ? h('div.muted', { style: { fontSize: '11px' } }, '📑 from BOQ') : null);
      }
      const label = l.description ? String(++sr) : '';
      return h('tr', h('td.muted', label), itemCell, cells, amount, f.itemRef && amounts ? h('td.num', l.received ?? 0) : null,
        readonly ? null : h('td.nowrap',
          f.schedule ? null : h('button.icon-btn', { type: 'button', title: 'Add a size / sub-line below', onclick: () => { lines.splice(i + 1, 0, { description: '', spec: '', qty: 1, uom: l.uom || 'Nos', rate: 0, gst: l.gst ?? 18 }); render(); } }, '↳'),
          h('button.icon-btn.del', { type: 'button', title: 'Remove line', onclick: () => { lines.splice(i, 1); render(); } }, '✕')));
    });
    wrap.replaceChildren(
      f.hint && !readonly ? h('div.muted', { style: { fontSize: '12px', marginBottom: '4px' } }, f.hint) : null,
      h('div.table-wrap', h('table.data.lines', h('thead', head), h('tbody', rows))),
      readonly ? null : h('button.btn.small', { type: 'button', style: { marginTop: '6px' }, onclick: () => { lines.push(f.schedule ? { due_date: '', description: '', percent: null, amount: null, status: 'Due' } : { description: '', qty: 1, uom: 'Nos', rate: 0, gst: 18 }); render(); } }, f.schedule ? '+ Add payment' : '+ Add line'),
      amounts ? totalsBox : null);
    totals();
  }
  if (f.itemRef) refOptions('items').then(o => { items = o; render(); }).catch(fail); else render();
  return { el: wrap, get: () => lines, set: next => { lines = next.map(l => ({ ...l })); render(); } };
}

// PO: choosing a requisition copies its materials into the PO (prices, HSN and GST from the item master).
async function fillFromRequisition(reqId, inputs) {
  if (!reqId) return;
  const r = await api(`/requisitions/${reqId}`);
  const reqLines = (r.lines || []).filter(l => l.description || l.item_id || Number(l.qty));
  if (!reqLines.length) { toast('That requisition has no materials'); return; }
  const current = inputs.lines.get().filter(l => l.description || l.item_id || l.spec);
  let keep = [];
  if (current.length) {
    const choice = await modal(`Materials from ${r.req_no}`, h('p', `The PO already has ${current.length} line(s). Replace them with the ${reqLines.length} material(s) from the requisition, or add the materials below them?`),
      [{ label: 'Cancel', value: null }, { label: 'Add below', value: 'add' }, { label: 'Replace', cls: 'primary', value: 'replace' }]);
    if (!choice) return;
    if (choice === 'add') keep = current;
  }
  const mapped = await Promise.all(reqLines.map(async l => {
    const it = l.item_id ? await api(`/items/${l.item_id}`).catch(() => null) : null;
    return { item_id: l.item_id || null, description: l.description || it?.name || '', hsn: it?.hsn || '', spec: l.spec || '',
      qty: l.qty ?? null, uom: l.uom || it?.uom || 'Nos', rate: it?.rate || 0, gst: it?.gst_rate ?? 18, ...(l.bom_item_id ? { bom_item_id: l.bom_item_id } : {}) };
  }));
  inputs.lines.set([...keep, ...mapped]);
  if (r.project_id && inputs.project_id && !inputs.project_id.get()) inputs.project_id.set(r.project_id);
  if (r.bom_id && inputs.bom_id && !inputs.bom_id.get()) inputs.bom_id.set(r.bom_id);
  toast(`${mapped.length} material(s) copied from ${r.req_no}. You can add or change lines before saving.`);
}

// Requisition / PO "against a BOQ": copy the components still to be procured
// (BOQ qty − already on POs − on open requisitions − what was sent from existing stock).
export function toProcure(b) {
  const fromStock = Math.max(0, (b.dispatched || 0) - (b.received || 0));
  return Math.max(0, Math.round(((b.qty || 0) - (b.on_po || 0) - (b.req_open || 0) - fromStock) * 1000) / 1000);
}
export function bomRows(rows) {
  rows.sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id));
  let comp = '';
  for (const r of rows) { if (r.component) comp = r.component; r.component_name = r.component || comp; }
  return rows;
}
async function fillFromBom(bomId, inputs, entity, onlyIds) {
  if (!bomId) return;
  const [bom, rows] = await Promise.all([api(`/boms/${bomId}`), api(`/bom_items?bom_id=${bomId}&limit=20000`)]);
  const need = bomRows(rows).filter(b => (onlyIds ? onlyIds.includes(b.id) : true) && toProcure(b) > 0);
  if (!need.length) { toast(`Everything in ${bom.bom_no} is already on requisitions / POs`); return; }
  const current = inputs.lines.get().filter(l => l.description || l.item_id || l.spec);
  let keep = [];
  if (current.length) {
    const choice = await modal(`Components from ${bom.bom_no}`, h('p', `There are already ${current.length} line(s). Replace them with the ${need.length} component(s) still to be procured, or add them below?`),
      [{ label: 'Cancel', value: null }, { label: 'Add below', value: 'add' }, { label: 'Replace', cls: 'primary', value: 'replace' }]);
    if (!choice) return;
    if (choice === 'add') keep = current;
  }
  const items = new Map();
  for (const id of new Set(need.map(b => b.item_id).filter(Boolean))) items.set(id, await api(`/items/${id}`).catch(() => null));
  const lines = need.map(b => {
    const it = items.get(b.item_id);
    const spec = [b.spec, b.moc && `MOC: ${b.moc}`, b.make && `Make: ${b.make}`, b.drawing_no && `Drg: ${b.drawing_no}`].filter(Boolean).join('\n');
    const base = { item_id: b.item_id || null, bom_item_id: b.id, description: [b.component_name, b.dimensions].filter(Boolean).join(' '), spec, qty: toProcure(b), uom: b.uom || it?.uom || 'Nos' };
    return entity === 'purchase_orders' ? { ...base, hsn: it?.hsn || '', rate: it?.rate || 0, gst: it?.gst_rate ?? 18 } : { ...base, remark: [b.section, b.sr_no].filter(Boolean).join(' ') };
  });
  inputs.lines.set([...keep, ...lines]);
  if (bom.project_id && inputs.project_id && !inputs.project_id.get()) inputs.project_id.set(bom.project_id);
  toast(`${lines.length} component(s) copied from ${bom.bom_no}. Change quantities or remove lines before saving.`);
}

// ---------------------------------------------------------------- approval progress (PO: technical → commercial → GM)
function approvalStrip(docType, row) {
  const flow = APPROVAL_FLOWS[docType];
  if (!flow || flow.length < 2) return null;
  return h('div.card', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px' } },
    h('b', 'Approvals:'), h('span.badge.good', `Prepared: ${row.prepared_by || row.created_by || '-'}`),
    flow.map(s => {
      const who = row[s.field];
      const waiting = row.approval_stage === s.stage;
      return [h('span.muted', '→'), h('span.badge' + (who ? '.good' : waiting ? '.warn' : ''), `${s.stage}: ${who || (waiting ? 'waiting' : '—')}`)];
    }));
}

// ---------------------------------------------------------------- PO commercial step: prices, GST, payment terms, due dates
const PAID_LATER = ['Approved', 'Sent', 'Partially Received', 'Received', 'Closed'];
function commercialPanel(po, reload) {
  const atStep = po.status === 'Pending Approval' && po.approval_stage === 'Commercial';
  if (!hasFunction(state.user.role, 'po_commercial') || !(atStep || PAID_LATER.includes(po.status))) return null;
  const schedField = ENTITIES.purchase_orders.fields.find(f => f.key === 'payment_schedule');
  const sched = linesEditor(schedField, po.payment_schedule || [], { readonly: false });
  const lines = (po.lines || []).map(l => ({ ...l }));
  const totalsBox = h('div.totals');
  const showTotals = () => {
    const t = linesTotals(lines);
    totalsBox.replaceChildren(h('span', 'Taxable value'), h('span.right', inr(t.subtotal)), h('span', 'GST'), h('span.right', inr(t.tax)), h('span.grand', 'Total'), h('span.right.grand', inr(Math.round(t.total))));
  };
  const terms = {};
  const term = (k, label) => { terms[k] = h('input', { value: po[k] || '' }); return h('label', label, terms[k]); };
  let heading = '';
  const priceTable = atStep ? h('div.table-wrap', h('table.data.lines', h('thead', h('tr', ['#', 'Item', 'Qty', 'UOM', 'Rate (₹) *', 'GST %', 'Amount'].map(x => h('th', x)))),
    h('tbody', lines.map((l, i) => {
      if (l.description) heading = l.description;
      if (!(Number(l.qty) > 0)) return h('tr', h('td'), h('td', { colspan: 6, style: { fontWeight: 600 } }, l.description || ''));
      const amt = h('td.num', inr((Number(l.qty) || 0) * (Number(l.rate) || 0)));
      const inp = (k, w) => { const x = h('input', { type: 'number', step: 'any', value: l[k] ?? '', style: { width: w } }); x.oninput = () => { l[k] = x.value === '' ? null : Number(x.value); amt.textContent = inr((Number(l.qty) || 0) * (Number(l.rate) || 0)); showTotals(); }; return h('td', x); };
      return h('tr', h('td', i + 1), h('td', [l.description || heading, !l.description && l.spec ? String(l.spec).split('\n')[0] : ''].filter(Boolean).join(' – ')), h('td.num', l.qty), h('td', l.uom || ''), inp('rate', '110px'), inp('gst', '70px'), amt);
    })))) : null;
  showTotals();
  const body = () => ({ lines: lines.map(l => ({ rate: l.rate, gst: l.gst })), payment_schedule: sched.get(), ...Object.fromEntries(Object.entries(terms).map(([k, el]) => [k, el.value])) });
  const saveCommercial = busy(async () => { await api(`/purchase_orders/${po.id}/commercial`, { method: 'POST', body: body() }); toast('Prices and payment terms saved'); reload(); });
  const approve = busy(async () => {
    if (lines.some(l => Number(l.qty) > 0 && !(Number(l.rate) > 0))) throw new Error('Enter the rate on every line before approving');
    if (!sched.get().some(p => p.due_date)) throw new Error('Add at least one payment with its due date (Payment schedule), so payments can be planned');
    await api(`/purchase_orders/${po.id}/commercial`, { method: 'POST', body: body() });
    const ap = (await api(`/approvals?doc_type=${encodeURIComponent('Purchase Order')}&doc_id=${po.id}&status=Pending`))[0];
    if (!ap) throw new Error('The approval request for this step was not found');
    await api(`/approvals/${ap.id}/decide`, { method: 'POST', body: { decision: 'Approved', comments: 'Prices, payment terms and due dates entered' } });
    toast('PO approved'); window.dispatchEvent(new Event('approvals-changed')); reload();
  });
  const saveSchedule = busy(async () => { await api(`/purchase_orders/${po.id}/payments`, { method: 'POST', body: { payment_schedule: sched.get().filter(p => p.due_date || p.amount || p.percent || p.description) } }); toast('Payment schedule saved'); reload(); });
  return h('div.card', { style: { borderLeft: '4px solid #1f4e9a' } },
    h('h2', atStep ? '💰 Commercial step: enter prices, payment terms and due dates' : '💰 Payment schedule'),
    atStep ? h('p.muted', 'The material and quantities were checked by the Purchase Head and approved by the GM. Enter the vendor rates and GST, the payment terms, and when each payment is due, then approve.') : h('p.muted', 'Mark payments as Paid (with the date) so the accounts dashboard shows what is still due.'),
    priceTable, atStep ? totalsBox : null,
    atStep ? h('div.form-grid', { style: { marginTop: '10px' } }, term('term_advance', 'Payment – Advance'), term('term_balance', 'Payment – Balance'), term('term_delivery', 'Delivery'), term('term_freight', 'Freight')) : null,
    h('div', { style: { marginTop: '10px' } }, h('b', 'Payment schedule (due dates)'), sched.el),
    h('div.toolbar', { style: { marginTop: '10px' } }, atStep ? [h('button.btn', { onclick: saveCommercial }, '💾 Save'), h('button.btn.good', { onclick: approve }, '✔ Save & approve PO')] : h('button.btn.primary', { onclick: saveSchedule }, '💾 Save payment schedule')));
}

// Sales questionnaire (MD, 13 Oct 2026): is the client cost-sensitive or quality-sensitive, what budget and taste,
// so the proposal can be tailored. Internal only; saved on the enquiry.
const PROFILE_QS = [
  ['priority', 'What matters most to them?', [['Lowest price', -2], ['Value for money', 0], ['Best quality and brand', 2]]],
  ['makes', 'Have they asked for specific makes / imported brands?', [['Not bothered', -1], ['Some preference', 0], ['Yes, premium brands', 2]]],
  ['compare', 'How will they compare quotations?', [['Mainly on price', -2], ['Price and specification', 0], ['Quality and references', 2]]],
  ['nabh', 'NABH accreditation?', [['Not planned', -1], ['Planned', 1], ['Already accredited', 2]]],
  ['look', 'What finish do they expect?', [['Functional is fine', -1], ['Good finish', 0], ['A showpiece OT', 2]]],
  ['payment', 'Payment comfort', [['Needs long credit / financing', -1], ['Staged payments', 0], ['Comfortable with advance', 1]]],
];
const TASTES = ['Premium look', 'Minimal & functional', 'Organic / health-conscious', 'Latest technology', 'Energy saving', 'Vastu-compliant layout', 'Fast delivery', 'Low maintenance'];
async function profileDialog(row, reload) {
  const before = String(row.profile_answers || '').split('\n'); // earlier answers, as saved
  const ans = {}, picks = new Set((row.client_taste || '').split(/\s*[,;]\s*/).filter(t => TASTES.includes(t)));
  const qs = PROFILE_QS.map(([k, q, opts]) => { const sel = h('select', h('option', { value: '' }, '—'), opts.map(([l]) => h('option', l))); ans[k] = sel; const old = before.find(x => x.startsWith(q + ' ')); if (old) sel.value = old.slice(q.length + 1); return h('label', q, sel); });
  const budget = h('select', ENTITIES.enquiries.fields.find(x => x.key === 'budget_range').options.map(o => h('option', { value: o }, o || '—'))); budget.value = row.budget_range || '';
  const maker = h('select', ENTITIES.enquiries.fields.find(x => x.key === 'decision_maker').options.map(o => h('option', { value: o }, o || '—'))); maker.value = row.decision_maker || '';
  const tastes = h('div.toolbar', TASTES.map(t => { const b = h('button.btn.small' + (picks.has(t) ? '.primary' : ''), { type: 'button', onclick: () => { if (picks.has(t)) picks.delete(t); else picks.add(t); b.classList.toggle('primary', picks.has(t)); } }, t); return b; }));
  const other = h('input', { placeholder: 'Anything else about their taste (e.g. likes the Delhi SS + glass OT)' });
  const inst = h('input', { value: row.institution_name || '' }), board = h('textarea', { rows: 3 }), fin = h('textarea', { rows: 2 });
  board.value = row.board_members || ''; fin.value = row.financial_status || '';
  const ok = await modal('🧭 Client profile questionnaire (internal)', h('div.grid',
    h('p.muted', 'For WIESPL sales only. The answers tell whether the client is cost-sensitive or quality-sensitive, so the proposal can be tailored. Nothing here is shown to the client.'),
    h('div.form-grid', qs, h('label', 'Budget range', budget), h('label', 'Decision maker', maker)),
    h('div', h('b', 'Taste & priorities'), tastes, other),
    h('h3', 'Institution (MIS)'), h('div.form-grid', h('label', 'Institution / trust / group', inst), h('label.span-2', 'Board of Directors / trustees', board), h('label.span-2', 'Financial strength / purchasing power', fin))),
  [{ label: 'Cancel', value: false }, { label: 'Save profile', cls: 'primary', value: true }]);
  if (!ok) return;
  let score = 0; const lines = [];
  for (const [k, q, opts] of PROFILE_QS) { const v = ans[k].value; const o = opts.find(x => x[0] === v); if (o) { score += o[1]; lines.push(`${q} ${v}`); } }
  const profile = lines.length ? (score >= 4 ? 'Quality-sensitive' : score <= -3 ? 'Cost-sensitive' : 'Balanced') : row.client_profile || '';
  const tip = { 'Quality-sensitive': 'Lead with SS 304 / SS + glass, SHRM, iSmart, premium pendants and references of finished OTs.', 'Cost-sensitive': 'Lead with PPGL walls and standard makes; show the options and what each adds; emphasise value and running cost.', Balanced: 'Offer a recommended package plus one step up and one step down.' }[profile];
  const taste = [...picks, other.value.trim()].filter(Boolean).join(', ');
  await api(`/enquiries/${row.id}`, { method: 'PUT', body: {
    client_profile: profile || null, budget_range: budget.value || null, decision_maker: maker.value || null, client_taste: taste || null,
    institution_name: inst.value.trim() || null, board_members: board.value.trim() || null, financial_status: fin.value.trim() || null,
    profile_answers: [...lines, lines.length ? `Score ${score} → ${profile}` : null, tip ? `Proposal approach: ${tip}` : null].filter(Boolean).join('\n') || null,
  } });
  toast(profile ? `Saved: ${profile}` : 'Saved');
  reload();
}

// Second, detailed form (room sizes, specialty, finishes, equipment, gases, site scope) for the surgeon / hospital team,
// or for sales to fill during the visit. What is sent lands in "Detailed requirements" on this enquiry.
async function briefDialog(row) {
  const { token } = await api(`/enquiries/${row.id}/brief`, { method: 'POST' });
  const url = `${location.origin}/brief.html?t=${encodeURIComponent(token)}`;
  const text = `Dear ${row.doctor_name || 'Doctor'}, please fill the detailed OT requirements for ${row.hospital_name || 'your hospital'} (about 5 minutes): ${url}`;
  const input = h('input', { value: url, readOnly: true, onclick: e => e.target.select() });
  const phone = String(row.doctor_phone || '').replace(/\D/g, '');
  await modal('Detailed requirement form', h('div.grid',
    h('p', 'Send this link to the surgeon or hospital team, or open it yourself and fill it during the meeting. It asks for each OT: size, specialty (with the NABH norms), wall / floor finish, doors, pendants, OT light, gas outlets, scrub, SHRM and the site scope. The answers come back into this enquiry under “Detailed requirements”, and you get a pop-up.'),
    h('label', 'Link (works only for this enquiry)', input),
    location.hostname === 'localhost' || /^(192\.168|10\.|172\.)/.test(location.hostname) ? h('p', { style: { color: 'var(--warn)' } }, '⚠ This address only works inside your office network. For clients outside, use the Render (internet) address of the CRM.') : null,
    h('div.toolbar', h('a.btn.primary', { href: `https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, '💬 Send on WhatsApp'),
      h('button.btn', { onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { input.select(); toast('Press Ctrl+C to copy'); } } }, '📋 Copy link'),
      h('a.btn', { href: url, target: '_blank', rel: 'noopener' }, '✍️ Open and fill it now'))),
  [{ label: 'Close', value: true }]);
}

// ---------------------------------------------------------------- actions per module
function actionsFor(entity, row, reload, ctx = {}) {
  const id = row.id;
  const post = (path, body) => api(path, { method: 'POST', body });
  const go = (p, then) => async () => { try { const r = await p(); then?.(r); } catch (e) { fail(e); } };
  const can = e => canWrite(e, state.user.role);
  const status = (s, confirmText) => go(async () => { if (confirmText && !(await confirmBox(confirmText))) return; await post(`/${entity}/${id}/status`, { status: s }); reload(); });
  // Unsaved changes on screen (e.g. quantities just typed) are saved before submitting.
  const submit = busy(async () => {
    if (ctx.save) await ctx.save({ quiet: true });
    await post(`/${entity}/${id}/submit`);
    toast('Sent for approval');
    window.dispatchEvent(new Event('approvals-changed'));
    reload();
  });
  const A = [];
  switch (entity) {
    case 'customers':
      if (can('enquiries')) A.push(h('button.btn', { onclick: () => newRecord('enquiries', { customer_id: id }) }, '+ New Enquiry'));
      if (can('contacts')) A.push(h('button.btn', { onclick: () => newRecord('contacts', { customer_id: id }) }, '+ Contact'));
      if (can('service_tickets')) A.push(h('button.btn', { onclick: () => newRecord('service_tickets', { customer_id: id }) }, '+ Service Ticket'));
      break;
    case 'enquiries':
      if (can('quotations')) A.push(h('button.btn.primary', { onclick: go(() => post(`/enquiries/${id}/quotation`), q => (location.hash = `#/quotation/${q.id}`)) }, '🧾 Create Quotation'));
      if (can('followups')) A.push(h('button.btn', { onclick: () => newRecord('followups', { enquiry_id: id, ...(row.customer_id ? { customer_id: row.customer_id } : {}) }) }, '📞 Log Follow-up'));
      if (can('enquiries')) A.push(h('button.btn', { onclick: busy(() => briefDialog(row).catch(fail)) }, '📋 Detailed requirement form'));
      if (can('enquiries')) A.push(h('button.btn', { onclick: () => profileDialog(row, reload).catch(fail) }, '🧭 Client profile questionnaire'));
      A.push(h('a.btn', { href: `#/print/techsheet/${id}`, target: '_blank' }, '📄 Techno-commercial sheet'));
      if (!row.customer_id && can('customers') && row.hospital_name) {
        A.push(h('button.btn', { onclick: go(async () => {
          const c = await api('/customers', { method: 'POST', body: { name: row.hospital_name, place: row.place, district: row.district, contact_person: row.doctor_name, phone: row.doctor_phone } });
          await api(`/enquiries/${id}`, { method: 'PUT', body: { customer_id: c.id } });
          clearRefCache('customers');
          toast('Customer created and linked');
          reload();
        }) }, '🏥 Save hospital as Customer'));
      }
      break;
    case 'approvals': {
      const link = { Quotation: `#/quotation/${row.doc_id}`, 'Purchase Order': `#/view/purchase_orders/${row.doc_id}`, Requisition: `#/view/requisitions/${row.doc_id}` }[row.doc_type];
      if (link) A.push(h('a.btn', { href: link }, `Open ${row.doc_type}`));
      if (row.status === 'Pending' && canApprove(row.doc_type, row.stage)) {
        const decide = decision => go(async () => {
          const c = h('textarea', { placeholder: 'Comments (optional)' });
          const ok = await modal(`${decision === 'Approved' ? 'Approve' : 'Reject'} ${row.doc_ref}${row.stage ? ' – ' + row.stage : ''}`, h('label', 'Comments', c),
            [{ label: 'Cancel', value: false }, { label: decision === 'Approved' ? 'Approve' : 'Reject', cls: decision === 'Approved' ? 'good' : 'danger solid', value: true }]);
          if (!ok) return;
          await post(`/approvals/${id}/decide`, { decision, comments: c.value });
          toast(decision);
          window.dispatchEvent(new Event('approvals-changed'));
          reload();
        });
        A.push(h('button.btn.good', { onclick: decide('Approved') }, '✔ Approve'), h('button.btn.danger.solid', { onclick: decide('Rejected') }, '✖ Reject'));
      } else if (row.status === 'Pending') {
        A.push(h('span.muted', `Waiting for someone allowed to: ${FUNCTIONS[stepOf(row.doc_type, row.stage)?.fn] || 'approve'}`));
      }
      break;
    }
    case 'sales_orders':
      if (row.quotation_id) A.push(h('a.btn', { href: `#/quotation/${row.quotation_id}` }, 'Quotation'));
      if (can('projects')) A.push(h('button.btn', { onclick: go(() => post(`/sales_orders/${id}/project`), p => (location.hash = `#/view/projects/${p.id}`)) }, '🏗️ Create Project'));
      if (row.quotation_id && can('boqs')) A.push(h('button.btn', { title: 'Work order with every quotation line and quantity; then ⚙️ Generate BOQ', onclick: go(() => post(`/sales_orders/${id}/work-order`), r => { toast(`Work order ${r.boq.boq_no}: ${r.lines} line(s) from the quotation`); location.hash = `#/boq/${r.boq.id}`; }) }, '📂 Create Work Order'));
      if (can('invoices')) A.push(h('button.btn.primary', { onclick: go(async () => {
        const pct = h('input', { type: 'number', value: 50, min: 1, max: 100 });
        const type = h('select', h('option', 'Proforma Invoice'), h('option', 'Tax Invoice'));
        const desc = h('input', { placeholder: 'e.g. 50% advance against PO' });
        const ok = await modal('Create invoice from Sales Order', h('div.grid',
          h('p.muted', `Order value ${money(row.order_value)} + GST ${row.gst_rate}%. Payment terms: ${row.payment_terms || '-'}`),
          h('label', 'Percent of order value', pct), h('label', 'Invoice type', type), h('label', 'Line description (optional)', desc)),
          [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', value: true }]);
        if (!ok) return;
        const inv = await post(`/sales_orders/${id}/invoice`, { percent: Number(pct.value), type: type.value, description: desc.value || undefined });
        location.hash = `#/view/invoices/${inv.id}`;
      }) }, '💳 Create Invoice'));
      break;
    case 'boq_items':
      if (row.boq_id) A.push(h('a.btn', { href: `#/boq/${row.boq_id}` }, '📑 Open BOQ'));
      break;
    case 'challans': {
      const st = row.status;
      A.push(h('a.btn', { href: `#/print/challan/${id}`, target: '_blank' }, '🖨 Print Challan'));
      if (row.issue_no) A.push(h('a.btn', { href: `#/print/stockdoc/${row.issue_type || 'OUTWARD'}?doc=${encodeURIComponent(row.issue_no)}`, target: '_blank' }, '🖨 Issue Slip'));
      if (row.bom_id) A.push(h('a.btn', { href: `#/bom/${row.bom_id}` }, '📑 BOQ status'));
      if (row.boq_id) A.push(h('a.btn', { href: `#/boq/${row.boq_id}` }, '📂 Work order status'));
      if (can(entity) && st === 'Draft') A.push(h('button.btn.good', { onclick: go(async () => {
        const stockLines = (row.lines || []).filter(l => l.item_id).length;
        if (!(await confirmBox(`Dispatch ${row.challan_no}? The material is marked as sent against the work order${stockLines ? ` and ${stockLines} store item(s) are issued from stock` : ''}. The challan cannot be edited afterwards.`, 'Dispatch'))) return;
        try {
          if ((await reservedRetry(b => post(`/challans/${id}/dispatch`, b))) === null) return;
        } catch (e) {
          if (!/Not enough stock|More than the work order/.test(e.message) || !hasFunction(state.user.role, 'allow_negative')) throw e;
          if (!(await modal('Please check', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message), [{ label: 'Cancel', value: false }, { label: 'Dispatch anyway', cls: 'danger solid', value: true }]))) return;
          await post(`/challans/${id}/dispatch`, { allowNegative: true, force: true, allowReserved: true });
        }
        toast('Dispatched');
        reload();
      }) }, '🚚 Dispatch'));
      if (can(entity) && st === 'Dispatched') A.push(h('button.btn.good', { onclick: go(async () => {
        const who = h('input', { placeholder: 'Name of the person at site who received it' });
        const date = h('input', { type: 'date', value: today() });
        const ok = await modal(`Delivered – ${row.challan_no}`, h('div.grid', h('label', 'Received by', who), h('label', 'Delivered on', date),
          h('p.muted', 'Tip: attach the signed challan copy below as proof of delivery.')), [{ label: 'Cancel', value: false }, { label: '✓ Mark delivered', cls: 'good', value: true }]);
        if (!ok) return;
        await post(`/challans/${id}/deliver`, { received_by: who.value, delivered_date: date.value });
        toast('Marked delivered');
        reload();
      }) }, '✓ Mark Delivered'));
      if (can(entity) && st === 'Draft') A.push(h('button.btn.danger', { onclick: status('Cancelled', 'Cancel this challan?') }, 'Cancel'));
      break;
    }
    case 'projects':
      if (can('boqs')) A.push(h('button.btn.primary', { onclick: go(() => newBoqDialog({ project_id: id })) }, '📂 New Work Order (upload)'));
      if (can('boms')) A.push(h('button.btn', { onclick: go(() => newBomDialog({ project_id: id })) }, '📑 New BOQ (bill of material)'));
      if (can('requisitions')) A.push(h('button.btn', { onclick: () => newRecord('requisitions', { project_id: id }) }, '📝 Requisition'));
      if (can('stock_moves')) A.push(h('a.btn', { href: `#/stock-entry?type=OUTWARD&project=${id}` }, '📤 Issue Material'));
      if (can('purchase_orders')) A.push(h('button.btn', { onclick: () => newRecord('purchase_orders', { project_id: id }) }, '🛒 Purchase Order'));
      if (can('material_approvals')) A.push(h('button.btn', { onclick: () => newRecord('material_approvals', { project_id: id }) }, '🧱 Submittal'));
      if (can('service_tickets')) A.push(h('button.btn', { onclick: () => newRecord('service_tickets', { project_id: id, ...(row.customer_id ? { customer_id: row.customer_id } : {}) }) }, '🛠️ Service Ticket'));
      break;
    case 'requisitions': {
      const st = row.status;
      A.push(h('a.btn', { href: `#/print/requisition/${id}`, target: '_blank' }, '🖨 Print'));
      if (can(entity) && ['Draft', 'Rejected'].includes(st)) A.push(h('button.btn.primary', { onclick: submit }, 'Submit to Purchase Head'));
      if (can('purchase_orders') && st === 'Approved') A.push(h('button.btn.good', { onclick: go(async () => {
        const vendors = await refOptions('vendors');
        let vendorId = null;
        const picker = itemPicker(vendors, null, { onPick: v => { vendorId = v; } });
        const ok = await modal(`Create PO from ${row.req_no}`, h('div.grid', h('p.muted', 'Lines and quantities are copied; prices come from the item master. You can edit the PO before submitting it.'), h('label', 'Vendor', picker)),
          [{ label: 'Cancel', value: false }, { label: 'Create PO', cls: 'good', value: true }]);
        if (!ok) return;
        if (!vendorId) throw new Error('Pick a vendor from the list');
        const po = await post(`/requisitions/${id}/convert`, { vendor_id: vendorId });
        location.hash = `#/view/purchase_orders/${po.id}`;
      }) }, '🛒 Convert to PO'));
      if (can(entity) && st === 'Rejected') A.push(h('button.btn', { onclick: status('Draft') }, 'Back to Draft'));
      if (can(entity) && ['Draft', 'Approved', 'Converted to PO', 'Rejected'].includes(st)) A.push(h('button.btn.danger', { onclick: status('Closed', 'Close this requisition?') }, 'Close'));
      break;
    }
    case 'purchase_orders': {
      const st = row.status;
      A.push(h('a.btn', { href: `#/print/po/${id}`, target: '_blank' }, '🖨 Print PO'));
      if (can(entity) && ['Draft', 'Rejected'].includes(st)) A.push(h('button.btn.primary', { onclick: submit }, 'Submit for Approval'));
      if (can(entity) && st === 'Approved') A.push(h('button.btn', { onclick: status('Sent') }, 'Mark as Sent'));
      if (can('stock_moves') && ['Approved', 'Sent', 'Partially Received'].includes(st)) A.push(h('a.btn.good', { href: `#/stock-entry?type=INWARD&po=${id}` }, '📦 Receive Goods (GRN)'));
      if (can(entity) && st === 'Partially Received') A.push(h('button.btn', { onclick: status('Closed', 'Close this PO even though some quantity is still pending?') }, 'Short-close'));
      if (can(entity) && st === 'Rejected') A.push(h('button.btn', { onclick: status('Draft') }, 'Back to Draft'));
      if (can(entity) && ['Draft', 'Approved', 'Sent', 'Rejected'].includes(st)) A.push(h('button.btn.danger', { onclick: status('Cancelled', 'Cancel this PO?') }, 'Cancel PO'));
      break;
    }
    case 'invoices':
      A.push(h('a.btn', { href: `#/print/invoice/${id}`, target: '_blank' }, '🖨 Print Invoice'));
      if (can('payments') && row.status !== 'Draft' && row.status !== 'Cancelled' && row.balance > 0) A.push(h('button.btn.primary', { onclick: () => newRecord('payments', { invoice_id: id, customer_id: row.customer_id, amount: round2(row.balance) }) }, '💰 Record Payment'));
      break;
    case 'items':
      if (can('stock_moves')) {
        A.push(h('a.btn', { href: `#/stock-entry?type=INWARD&item=${id}` }, '📥 Inward'));
        A.push(h('a.btn', { href: `#/stock-entry?type=OUTWARD&item=${id}` }, '📤 Issue'));
      }
      break;
    case 'stock_moves':
      if (row.doc_no) A.push(h('a.btn', { href: `#/print/stockdoc/${row.type}?doc=${encodeURIComponent(row.doc_no)}`, target: '_blank' }, '🖨 Print Slip'));
      break;
  }
  return A;
}

// Opening / in / out / closing for the item this financial year.
function itemSummary(itemId) {
  const box = h('div.card', h('div.muted', 'Loading stock summary…'));
  api(`/stock/summary?item_id=${itemId}`).then(({ from, to, rows }) => {
    const r = rows[0];
    if (!r) { box.remove(); return; }
    const tile = (label, v, sub) => h('div.kpi', h('div.label', label), h('div.value', { style: { fontSize: '20px' } }, v), sub ? h('div.sub', sub) : null);
    box.replaceChildren(h('h2', `Stock summary ${fmtDate(from)} – ${fmtDate(to)}`), h('div.kpis', { style: { marginBottom: 0 } },
      tile('Opening', r.opening, r.uom), tile('Inward', r.inward, money(r.inward_value)), tile('Outward', r.outward), tile('Transfer', r.transfer),
      tile('Return', r.return), tile('Scrap', r.scrap), r.adjust ? tile('Adjust', r.adjust) : null,
      tile('Closing', h('span', { style: { color: r.closing < 0 ? 'var(--bad)' : r.low ? 'var(--warn)' : '' } }, r.closing), money(r.closing_value)),
      tile('Class', `${r.abc} · ${r.fsn}`, r.last_out ? `last issued ${fmtDate(r.last_out)}` : 'never issued')));
  }).catch(() => box.remove());
  return box;
}

// ---------------------------------------------------------------- page
export async function recordView(root, entity, id) {
  const ent = ENTITIES[entity];
  if (!ent) throw new Error('Unknown module');
  if (ent.editor === 'quotation' && id !== 'new') { location.hash = `#/quotation/${id}`; return; }
  if (ent.editor === 'boq' && id !== 'new' && !/details=1/.test(location.hash)) { location.hash = `#/boq/${id}`; return; }
  if (ent.editor === 'bom' && id !== 'new' && !/details=1/.test(location.hash)) { location.hash = `#/bom/${id}`; return; }
  if (entity === 'stock_moves' && id === 'new') { location.hash = '#/stock-entry'; return; }
  let isNew = id === 'new';
  const presets = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  let row = {};
  if (isNew) {
    for (const f of ent.fields) if (f.default !== undefined) row[f.key] = resolveDefault(f.default);
    for (const [k, v] of Object.entries(presets)) row[k] = /_id$/.test(k) || k === 'amount' ? Number(v) : v;
  } else {
    row = await api(`/${entity}/${id}`);
  }
  const locked = !isNew && LOCKED[entity]?.includes(row.status);
  const writable = canWrite(entity, state.user.role) && !locked && !(isNew && ent.noCreate);
  const inputs = {};
  const conditional = [];

  const grid = h('div.form-grid');
  for (const f of ent.fields) {
    if (f.hidden || f.type === 'json') continue;
    if (isNew && (f.readonly || f.computed) && row[f.key] == null) continue;
    if (f.type === 'lines') {
      const ed = linesEditor(f, row[f.key], {
        readonly: !writable,
        // POs round the grand total on the server (round-off line), so only the pre-tax figures update live there.
        onTotals: t => { for (const k of inputs.round_off ? ['subtotal', 'tax'] : ['subtotal', 'tax', 'total']) if (inputs[k]) inputs[k].el.value = t[k]; },
      });
      inputs[f.key] = ed;
      grid.append(h('div.span-all', h('label', f.label), ed.el));
      continue;
    }
    const w = fieldInput(f, row[f.key], { readonly: !writable });
    inputs[f.key] = w;
    const lbl = h('label', f.label, f.required ? ' *' : '', f.hint ? h('span.hint', f.hint) : null, w.el);
    if (f.span === 2) lbl.classList.add('span-2');
    if (f.type === 'ref' && row[f.key] && !isNew) {
      lbl.append(h('a', { href: recordHref(f.ref, row[f.key]), style: { fontWeight: 400 } }, 'open ›'));
    }
    if (f.showIf) conditional.push([f, lbl]);
    grid.append(lbl);
  }
  // Fields that only apply to some movement types (e.g. supplier & invoice for Inward).
  const applyShowIf = () => {
    for (const [f, lbl] of conditional) {
      const [ctrl, values] = Object.entries(f.showIf)[0];
      lbl.style.display = values.includes(inputs[ctrl]?.get() ?? row[ctrl]) ? '' : 'none';
    }
  };
  for (const ctrl of new Set(conditional.map(([f]) => Object.keys(f.showIf)[0]))) inputs[ctrl]?.el.addEventListener('change', applyShowIf);
  applyShowIf();
  if (entity === 'items' && isNew && inputs.code && inputs.category) {
    const showNext = () => api(`/items/next-code?category=${encodeURIComponent(inputs.category.get() || '')}`).then(r => { inputs.code.el.placeholder = `${r.code} (given automatically)`; }).catch(() => {});
    inputs.category.el.addEventListener('change', showNext);
    showNext();
  }
  if (entity === 'purchase_orders' && writable && inputs.requisition_id) {
    inputs.requisition_id.el.addEventListener('change', () => fillFromRequisition(inputs.requisition_id.get(), inputs).catch(fail));
    // Opened as "new PO" from a requisition link: fill straight away.
    if (isNew && presets.requisition_id) fillFromRequisition(Number(presets.requisition_id), inputs).catch(fail);
  }
  if (['purchase_orders', 'requisitions'].includes(entity) && writable && inputs.bom_id) {
    inputs.bom_id.el.addEventListener('change', () => fillFromBom(inputs.bom_id.get(), inputs, entity).catch(fail));
    if (isNew && presets.bom_id) fillFromBom(Number(presets.bom_id), inputs, entity, presets.bom_items ? presets.bom_items.split(',').map(Number) : null).catch(fail);
  }

  let saving = false;
  async function save({ quiet = false } = {}) {
    if (saving) return; // a second click / held Ctrl+S while saving must not create a second record
    saving = true;
    try { return await doSave(quiet); } finally { saving = false; }
  }
  async function doSave(quiet) {
    const bad = ent.fields.find(f => inputs[f.key]?.invalid?.());
    if (bad) throw new Error(`${bad.label}: pick one from the list (type part of the name and choose it)`);
    const body = {};
    for (const f of ent.fields) {
      if (!inputs[f.key] || f.readonly || f.computed) continue;
      body[f.key] = inputs[f.key].get();
    }
    // Presets for readonly-but-settable links (e.g. new payment against invoice) still need sending.
    if (isNew) for (const k of Object.keys(presets)) if (!(k in body) && ent.fields.some(f => f.key === k)) body[k] = row[k];
    const missing = ent.fields.find(f => f.required && !f.readonly && inputs[f.key] && (body[f.key] === null || body[f.key] === ''));
    if (missing) throw new Error(`${missing.label} is required`);
    const wasNew = isNew;
    const saved = isNew
      ? await api(`/${entity}`, { method: 'POST', body })
      : await api(`/${entity}/${id}`, { method: 'PUT', body });
    clearRefCache(entity);
    if (isNew) {
      // From here on this page edits the saved record, so saving again never makes a copy.
      isNew = false; id = saved.id;
      window.history.replaceState(null, '', recordHref(entity, saved.id));
      if (newFiles.pending().length) await newFiles.uploadTo(saved.id).catch(e => fail(new Error(`Saved, but a file could not be uploaded: ${e.message}`)));
    }
    if (quiet) return saved;
    toast('Saved');
    if (wasNew) {
      // When created from another record (e.g. follow-up from an enquiry), go back to it.
      const back = Object.entries(presets).find(([k]) => k.endsWith('_id'));
      const parentField = back && ent.fields.find(f => f.key === back[0]);
      const target = parentField && ['followups', 'payments', 'contacts', 'material_approvals'].includes(entity)
        ? recordHref(parentField.ref, back[1])
        : recordHref(entity, saved.id);
      if (location.hash === target) recordView(root, entity, saved.id); else location.hash = target;
    } else recordView(root, entity, id);
    return saved;
  }

  async function remove() {
    const warn = locked ? ` It is ${row.status}${entity === 'challans' && ['Dispatched', 'Delivered'].includes(row.status) ? ' – the store issue made with it is reversed and the material shows as pending again' : ''}.` : '';
    if (!(await confirmBox(`Delete ${title.replace(/^[^:]*: /, '')}?${warn} Its approvals and files are removed too. This cannot be undone.`, 'Delete'))) return;
    await api(`/${entity}/${id}`, { method: 'DELETE' });
    clearRefCache(entity);
    toast('Deleted');
    location.hash = `#/list/${entity}`;
  }

  const newFiles = pendingAttachments(entity);
  const r = row;
  const title = isNew ? `New ${ent.singular}` : `${ent.singular}: ${r.enquiry_no || r.quote_no || r.so_no || r.po_no || r.req_no || r.challan_no || r.bom_no || r.boq_no || r.invoice_no || r.ticket_no || r.submittal_no || r.doc_no || r.project_no || r.code || r.name || r.doc_ref || fmtDate(r.date) || '#' + r.id}${entity === 'items' && r.name ? ' · ' + r.name : ''}`;
  const statusVal = ent.statusField && r[ent.statusField];
  root.replaceChildren(
    h('div.page-head',
      h('a.btn.small', { href: `#/list/${entity}` }, '‹ Back'),
      h('h1', `${ent.icon} ${title}`), statusVal ? badge(statusVal) : null,
      r.approval_stage ? h('span.badge.warn', `waiting: ${r.approval_stage}`) : null,
      locked ? h('span.muted', '🔒 locked') : null,
      h('div.actions',
        isNew ? [] : actionsFor(entity, r, () => recordView(root, entity, id), { save: writable ? save : null }),
        writable ? h('button.btn.primary', { onclick: busy(() => save()) }, '💾 Save') : null,
        !isNew && mayDelete(entity, r) ? h('button.btn.danger', { onclick: busy(remove) }, '🗑 Delete') : null)),
    !isNew && entity === 'purchase_orders' ? approvalStrip('Purchase Order', r) : null,
    !isNew && entity === 'purchase_orders' ? commercialPanel(r, () => recordView(root, entity, id)) : null,
    !isNew && entity === 'items' ? itemSummary(r.id) : null,
    h('div.card', grid),
    isNew ? null : h('div.muted', { style: { fontSize: '12px', marginBottom: '12px' } },
      `Created ${r.created_at || ''} by ${r.created_by || '-'}${r.updated_at ? ` · last updated ${r.updated_at}` : ''}`),
    isNew ? (writable ? newFiles.el : null) : attachments(entity, r.id, canWrite(entity, state.user.role)),
    isNew ? null : related(entity, r),
    isNew || !hasFunction(state.user.role, 'view_audit') ? null : changeHistory(entity, id),
  );
  // Ctrl+S saves
  root.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && writable) { e.preventDefault(); if (!e.repeat) save().catch(fail); } };
}

// ---------------------------------------------------------------- files: work orders, drawings, CAD (dwg/dxf), PDFs, photos …
const ATTACH_TITLES = { boqs: 'Work order files, drawings & documents', boms: 'BOQ files, drawings & CAD', challans: 'Signed challan / proof of delivery', projects: 'Work order & project documents', material_approvals: 'Drawings, CAD & documents', purchase_orders: 'Vendor quotation / PO documents', requisitions: 'Attachments', vendors: 'Vendor documents (GST certificate, cheque …)' };
const fileSize = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const PREVIEWABLE = /\.(pdf|png|jpe?g|gif|webp|txt)$/i;

// Files picked while creating a record (e.g. a drawing on a new material approval); uploaded on Save.
function pendingAttachments(entity) {
  const files = [];
  const list = h('div.muted', 'No files chosen');
  const input = h('input', { type: 'file', multiple: true });
  const note = h('input', { placeholder: 'Note (optional), e.g. "Layout Rev 2"', style: { flex: 1, minWidth: '200px' } });
  const draw = () => list.replaceChildren(...(files.length ? files.map((f, i) => h('div', '📎 ', f.name, ' ', h('span.muted', `(${fileSize(f.size)})`), ' ',
    h('button.icon-btn.del', { title: 'Remove', onclick: () => { files.splice(i, 1); draw(); } }, '✕'))) : [h('span', 'No files chosen')]));
  input.onchange = () => { for (const f of input.files) { if (f.size > 200 * 1048576) { fail(new Error(`${f.name} is larger than 200 MB`)); continue; } files.push(f); } input.value = ''; draw(); };
  return {
    pending: () => files,
    async uploadTo(recordId) {
      for (const f of files) {
        const res = await fetch(`/api/attachments/${entity}/${recordId}?name=${encodeURIComponent(f.name)}&note=${encodeURIComponent(note.value)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': f.type || 'application/octet-stream' }, body: f });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload of ${f.name} failed`);
      }
    },
    el: h('div.card', h('h2', `📎 ${ATTACH_TITLES[entity] || 'Files'}`), h('div.toolbar', input, note),
      h('p.muted', { style: { fontSize: '12px', margin: '0 0 8px' } }, 'Drawings, AutoCAD (.dwg / .dxf), PDF, photos, Word / Excel … up to 200 MB each. They are uploaded when you click Save.'), list),
  };
}

export function attachments(entity, recordId, writable) {
  const list = h('div', h('div.muted', 'Loading…'));
  const file = h('input', { type: 'file', multiple: true });
  const note = h('input', { placeholder: 'Note (optional), e.g. "Work order R3", "Approved layout Rev 2"', style: { flex: 1, minWidth: '200px' } });
  async function load() {
    const rows = await api(`/attachments/${entity}/${recordId}`).catch(() => null);
    if (!rows) { list.replaceChildren(h('div.muted', 'Could not load files')); return; }
    list.replaceChildren(rows.length ? h('table.data', h('tbody', rows.map(a => h('tr',
      h('td', '📎 ', PREVIEWABLE.test(a.filename) ? h('a', { href: `/api/files/${a.id}?inline=1`, target: '_blank' }, a.filename) : h('a', { href: `/api/files/${a.id}` }, a.filename),
        a.note ? h('div.muted', a.note) : null),
      h('td.num.muted', fileSize(a.size)), h('td.muted.nowrap', `${a.uploaded_by || ''} · ${fmtDate(a.at)}`),
      h('td.nowrap', h('a.btn.small', { href: `/api/files/${a.id}` }, '⬇ Download'),
        writable ? h('button.icon-btn.del', { title: 'Remove file', onclick: async () => {
          if (!(await confirmBox(`Remove ${a.filename}?`, 'Remove'))) return;
          try { await api(`/files/${a.id}`, { method: 'DELETE' }); load(); } catch (e) { fail(e); }
        } }, '✕') : null))))) : h('div.muted', 'No files yet'));
  }
  async function upload() {
    if (!file.files.length) throw new Error('Choose one or more files first');
    for (const f of file.files) {
      if (f.size > 200 * 1048576) throw new Error(`${f.name} is larger than 200 MB`);
      const res = await fetch(`/api/attachments/${entity}/${recordId}?name=${encodeURIComponent(f.name)}&note=${encodeURIComponent(note.value)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': f.type || 'application/octet-stream' }, body: f });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload of ${f.name} failed`);
    }
    toast(`${file.files.length} file(s) uploaded`);
    file.value = ''; note.value = '';
    load();
  }
  load();
  return h('div.card', h('h2', `📎 ${ATTACH_TITLES[entity] || 'Files'}`),
    writable ? h('div.toolbar', file, note, h('button.btn.primary', { onclick: () => upload().catch(fail) }, '⬆ Upload')) : null,
    writable ? h('p.muted', { style: { fontSize: '12px', margin: '0 0 8px' } }, 'Any file type: PDF, Word, Excel, AutoCAD (.dwg / .dxf), images, ZIP … up to 200 MB each.') : null,
    list);
}

function related(entity, row) {
  const box = h('div');
  for (const [other, key] of ENTITIES[entity].related || []) {
    const addBtn = other === 'stock_moves'
      ? h('a.btn.small', { href: `#/stock-entry?${entity === 'items' ? 'item' : entity === 'projects' ? 'type=OUTWARD&project' : 'type=INWARD&vendor'}=${row.id}` }, '+ Add')
      : h('button.btn.small', { onclick: () => newRecord(other, { [key]: row.id }).catch(fail) }, '+ Add');
    const sec = h('div.card', h('div.page-head', { style: { marginBottom: '8px' } }, h('h2', `${ENTITIES[other].icon} ${ENTITIES[other].label}`),
      canWrite(other, state.user.role) && !ENTITIES[other].noCreate ? h('div.actions', addBtn) : null),
      h('div.muted', 'Loading…'));
    box.append(sec);
    api(`/${other}?${key}=${row.id}`).then(rows => {
      sec.lastChild.replaceWith(rows.length ? table(other, rows, { pageSize: 15 }) : h('div.muted', 'None yet'));
    }).catch(() => sec.lastChild.replaceWith(h('div.muted', 'Could not load')));
  }
  return box;
}

function changeHistory(entity, id) {
  const box = h('details.card', h('summary', 'Change history'), h('div.timeline', 'Loading…'));
  box.addEventListener('toggle', async () => {
    if (!box.open) return;
    const rows = await api(`/audit?entity=${entity}&record_id=${id}`).catch(() => []);
    box.lastChild.replaceChildren(...(rows.length ? rows.map(a => h('div', h('b', a.action), ` · ${a.user} · ${a.at}`, a.summary ? h('div.muted', a.summary) : null)) : [h('div.muted', 'No history')]));
  });
  return box;
}
