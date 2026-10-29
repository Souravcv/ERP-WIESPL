import { h, api, state, toast, fail, modal, confirmBox, fieldInput, refOptions, clearRefCache, badge, money, fmtDate, today, busy, reservedRetry } from '../ui.js';
import { ENTITIES, canWrite, canView, canDelete, hasFunction, APPROVAL_FLOWS, FUNCTIONS, ITEM_CATEGORIES, UOMS, WO_DEPARTMENTS } from '../schema.js';
import { linesTotals, inr, round2, poTotals, PO_CHARGES } from '../calc.js';
import { table, newRecord, recordHref } from './list.js';
import { newBoqDialog } from './dispatch.js';
import { newBomDialog } from './bom.js';

const LOCKED = {
  purchase_orders: ['Pending Approval', 'Approved', 'Sent', 'Partially Received', 'Received', 'Closed', 'Cancelled', 'Archived (old)'],
  requisitions: ['Submitted', 'Approved', 'Converted to PO', 'Closed'],
  challans: ['Dispatched', 'Delivered', 'Cancelled'],
  vendor_payments: ['Pending Approval', 'Approved', 'Paid', 'Reversed'],
  expenses: ['Pending Approval', 'Approved', 'Paid', 'Reversed'],
  invoices: ['Issued', 'Partially Paid', 'Retention Held', 'Paid', 'Cancelled'],
  payments: ['Received', 'Reversed'],
  credit_notes: ['Pending Approval', 'Approved'],
  sales_orders: ['Pending Approval', 'Approved', 'In Execution', 'Completed', 'Cancelled'],
  production_plans: ['Pending Approval', 'Approved'],
  production_reports: ['Submitted'],
  production_orders: ['Completed', 'Cancelled'],
  qc_inspections: ['Done'],
  ncrs: ['Closed', 'Cancelled'],
};
// Money documents are never deleted once they count (the server refuses too): reverse / cancel / credit note instead.
const KEEP = { payments: () => true, attendance: r => !!r.check_in, attendance_pings: () => true, invoices: r => r.status !== 'Draft', credit_notes: r => !['Draft', 'Rejected'].includes(r.status),
  vendor_payments: r => !['Draft', 'Rejected'].includes(r.status), expenses: r => !['Draft', 'Rejected'].includes(r.status),
  production_reports: r => r.status === 'Submitted', qc_inspections: r => r.status === 'Done', ncrs: r => r.status !== 'Open' };
// Full access may delete anything else (also locked documents); anyone else only their own draft.
export const mayDelete = (entity, row) => !KEEP[entity]?.(row) && (canDelete(entity, state.user.role)
  || (canWrite(entity, state.user.role) && row.created_by === state.user.name && ['Draft', 'Rejected'].includes(row.status)));

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
export const canApprove = (docType, stage, ap = null) => !!stepOf(docType, stage) && (hasFunction(state.user.role, stepOf(docType, stage).fn) || (!!ap?.also_by && ap.also_by === state.user.name));
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
function linesEditor(f, value, { readonly, onTotals, extras }) {
  let lines = Array.isArray(value) ? value.map(l => ({ ...l })) : [];
  const amounts = f.amounts !== false;
  const wrap = h('div');
  const totalsBox = h('div.totals');
  let items = [];

  function totals() {
    if (!amounts) return;
    // PO: items + charges (freight, packing …) → taxable value, GST with its %, round off, grand total in ₹.
    if (f.poTotals && extras) {
      const t = poTotals({ ...extras(), lines });
      totalsBox.replaceChildren(
        h('span', 'Items'), h('span.right', '₹ ' + inr(t.items)),
        ...t.charges.flatMap(c => [h('span', c.label), h('span.right', '₹ ' + inr(c.amount))]),
        h('span', 'Taxable value'), h('span.right', '₹ ' + inr(t.subtotal)),
        ...(t.rates.length ? t.rates.map(r => [h('span', `GST @ ${r}%`), h('span.right', '₹ ' + inr(t.byRate[r].tax))]).flat() : [h('span', 'GST'), h('span.right', '₹ 0.00')]),
        t.round_off ? [h('span', 'Round off'), h('span.right', '₹ ' + inr(t.round_off))] : null,
        h('span.grand', 'Grand Total'), h('span.right.grand', '₹ ' + inr(t.total)));
      onTotals?.(t);
      return;
    }
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
        // A reference column (e.g. the site / project of a requisition line): a list of that module's records.
        if (c.type === 'ref') {
          const name = id => (refs[c.ref] || []).find(o => o.id === Number(id))?.label || '';
          if (c.split && l.split?.length > 1) {
            return h('td', h('div', { style: { fontSize: '12px', lineHeight: 1.5 } }, l.split.map(s => h('div', `${name(s.project_id) || s.site || '—'}: ${s.qty}`))),
              readonly ? null : h('button.btn.small', { type: 'button', onclick: () => splitEditor(l, c) }, '✎ Projects & qty'));
          }
          const sel = h('select', { disabled: readonly }, h('option', { value: '' }, c.blank || '—'), (refs[c.ref] || []).map(o => h('option', { value: o.id }, o.label)));
          sel.value = l[c.key] ?? '';
          sel.onchange = () => { l[c.key] = sel.value ? Number(sel.value) : null; };
          return h('td.nowrap', sel, c.split && !readonly ? h('button.icon-btn', { type: 'button', title: 'Same material for several projects: one line, give each project its quantity', onclick: () => splitEditor(l, c) }, '⇉') : null);
        }
        const inp = c.type === 'select' ? h('select', { disabled: readonly }, c.options.map(o => h('option', o)))
          : c.type === 'textarea' || (c.key === 'description' && !f.schedule)
            ? h('textarea', { rows: c.type === 'textarea' ? 2 : 1, readOnly: readonly, style: { minHeight: '32px' } })
            : h('input', { type: ['number', 'money'].includes(c.type) ? 'number' : c.type === 'date' ? 'date' : 'text', step: 'any', readOnly: readonly });
        inp.value = l[c.key] ?? (c.type === 'select' ? c.options[0] : '');
        if (c.key === 'qty' && l.split?.length > 1) { inp.readOnly = true; inp.title = 'Total of the projects: change it with "Projects & qty"'; }
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
          if (f.costKey && !Number(l[f.costKey])) l[f.costKey] = it.rate || 0;
          render();
        } }), l.bom_item_id ? h('div.muted', { style: { fontSize: '11px' } }, '📑 from BOQ') : null);
      }
      const label = l.description || f.newLine ? String(++sr) : '';
      return h('tr', h('td.muted', label), itemCell, cells, amount, f.itemRef && amounts ? h('td.num', l.received ?? 0) : null,
        readonly ? null : h('td.nowrap',
          f.schedule || f.newLine ? null : h('button.icon-btn', { type: 'button', title: 'Add a size / sub-line below', onclick: () => { lines.splice(i + 1, 0, { description: '', spec: '', qty: 1, uom: l.uom || 'Nos', rate: 0, gst: l.gst ?? 18 }); render(); } }, '↳'),
          h('button.icon-btn.del', { type: 'button', title: 'Remove line', onclick: () => { lines.splice(i, 1); render(); } }, '✕')));
    });
    wrap.replaceChildren(
      f.hint && !readonly ? h('div.muted', { style: { fontSize: '12px', marginBottom: '4px' } }, f.hint) : null,
      h('div.table-wrap', h('table.data.lines', h('thead', head), h('tbody', rows))),
      readonly ? null : h('button.btn.small', { type: 'button', style: { marginTop: '6px' }, onclick: () => { lines.push(f.newLine ? { ...f.newLine } : f.schedule ? { due_date: '', description: '', percent: null, amount: null, status: 'Due' } : { description: '', qty: 1, uom: 'Nos', rate: 0, gst: 18 }); render(); wrap.dispatchEvent(new Event('input', { bubbles: true })); } }, f.schedule ? '+ Add payment' : f.addLabel || '+ Add line'),
      amounts ? totalsBox : null);
    totals();
  }
  // Several projects on one line: a project and its quantity per row; the line's quantity is their total.
  async function splitEditor(l, c) {
    const opts = refs[c.ref] || [];
    let rows = l.split?.length ? l.split.map(s => ({ ...s })) : [{ project_id: l.project_id || null, qty: Number(l.qty) || null }, { project_id: null, qty: null }];
    const box = h('div'), total = h('b');
    const draw = () => {
      total.textContent = round2(rows.reduce((a, r) => a + (Number(r.qty) || 0), 0));
      box.replaceChildren(h('table.data', h('thead', h('tr', h('th', 'Project'), h('th', 'Qty'), h('th'))), h('tbody', rows.map((r, i) => {
        const sel = h('select', h('option', { value: '' }, '— choose project —'), opts.map(o => h('option', { value: o.id, selected: Number(r.project_id) === o.id }, o.label)));
        sel.onchange = () => { r.project_id = sel.value ? Number(sel.value) : null; };
        const q = h('input', { type: 'number', step: 'any', min: 0, value: r.qty ?? '', style: { width: '100px' }, oninput: e => { r.qty = e.target.value === '' ? null : Number(e.target.value); total.textContent = round2(rows.reduce((a, x) => a + (Number(x.qty) || 0), 0)); } });
        return h('tr', h('td', sel), h('td', q), h('td', h('button.icon-btn.del', { type: 'button', onclick: () => { rows.splice(i, 1); draw(); } }, '✕')));
      }))), h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' } },
        h('button.btn.small', { type: 'button', onclick: () => { rows.push({ project_id: null, qty: null }); draw(); } }, '+ Project'), h('span', 'Total quantity: ', total, ` ${l.uom || ''}`)));
    };
    draw();
    const ok = await modal(`${l.description || 'Material'}: projects and quantity`, h('div.grid', h('p.muted', 'One line for the material; each project gets its own quantity. The line quantity is the total, and the material received is booked to each project.'), box),
      [{ label: 'Cancel', value: false }, { label: 'Apply', cls: 'primary', value: true }]);
    if (!ok) return;
    const good = rows.filter(r => r.project_id && Number(r.qty) > 0);
    if (good.length > 1) {
      l.split = good.map(r => ({ project_id: r.project_id, qty: Number(r.qty) }));
      l.qty = round2(good.reduce((a, r) => a + Number(r.qty), 0));
      l.project_id = null;
      l.site = good.map(r => `${(opts.find(o => o.id === r.project_id)?.label || '').trim()}: ${r.qty}`).join(', ');
    } else if (good.length === 1) {
      delete l.split; l.project_id = good[0].project_id; l.qty = Number(good[0].qty); if (/: \d/.test(l.site || '')) l.site = '';
    } else { delete l.split; }
    render();
  }
  const refs = {};
  const refCols = [...new Set(f.columns.filter(c => c.type === 'ref').map(c => c.ref))];
  Promise.all([f.itemRef ? refOptions('items').then(o => { items = o; }) : null, ...refCols.map(r => refOptions(r).then(o => { refs[r] = o; }))]).then(render).catch(fail);
  return { el: wrap, get: () => lines, set: next => { lines = next.map(l => ({ ...l })); render(); }, refresh: totals };
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
      qty: l.qty ?? null, uom: l.uom || it?.uom || 'Nos', rate: it?.rate || 0, gst: it?.gst_rate ?? 18, ...(l.bom_item_id ? { bom_item_id: l.bom_item_id } : {}),
      ...(l.bom_id ? { bom_id: l.bom_id } : {}), ...(l.project_id ? { project_id: l.project_id } : {}), ...(l.site ? { site: l.site } : {}), ...(l.split?.length ? { split: l.split.map(s => ({ ...s })) } : {}) };
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
  // Charges (freight, packing, installation, transport, other) can be set or corrected at this step.
  const charges = {};
  const charge = (k, label, attrs = { type: 'number', step: 'any' }) => { charges[k] = h('input', { ...attrs, value: po[k] ?? '' }); charges[k].oninput = () => showTotals(); return h('label', label, charges[k]); };
  const chargeVals = () => Object.fromEntries(Object.entries(charges).map(([k, el]) => [k, el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value]));
  const showTotals = () => {
    const t = poTotals({ ...po, ...chargeVals(), lines });
    totalsBox.replaceChildren(h('span', 'Items'), h('span.right', '₹ ' + inr(t.items)),
      ...t.charges.flatMap(c => [h('span', c.label), h('span.right', '₹ ' + inr(c.amount))]),
      h('span', 'Taxable value'), h('span.right', '₹ ' + inr(t.subtotal)),
      ...t.rates.flatMap(r => [h('span', `GST @ ${r}%`), h('span.right', '₹ ' + inr(t.byRate[r].tax))]),
      h('span.grand', 'Grand Total'), h('span.right.grand', '₹ ' + inr(t.total)));
  };
  const terms = {};
  const term = (k, label) => { terms[k] = h('input', { value: po[k] || '' }); return h('label', label, terms[k]); };
  const chargeGrid = atStep ? h('div.form-grid', { style: { marginTop: '10px' } }, ...PO_CHARGES.map(([k, l]) => charge(k, `${l} (₹)`)),
    charge('other_charges_label', 'Other charges – name', { type: 'text' }), charge('charges_gst', 'GST % on charges')) : null;
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
  const body = () => ({ lines: lines.map(l => ({ rate: l.rate, gst: l.gst })), payment_schedule: sched.get(), ...chargeVals(), ...Object.fromEntries(Object.entries(terms).map(([k, el]) => [k, el.value])) });
  const saveCommercial = busy(async () => { await api(`/purchase_orders/${po.id}/commercial`, { method: 'POST', body: body() }); toast('Prices and payment terms saved'); reload(); });
  const approve = busy(async () => {
    if (lines.some(l => Number(l.qty) > 0 && !(Number(l.rate) > 0))) throw new Error('Enter the rate on every line before approving');
    if (!sched.get().some(p => p.due_date || p.trigger === 'After inward (GRN)')) throw new Error('Add at least one payment with its due date, or “After inward (GRN)” with the days (Payment schedule), so payments can be planned');
    await api(`/purchase_orders/${po.id}/commercial`, { method: 'POST', body: body() });
    const ap = (await api(`/approvals?doc_type=${encodeURIComponent('Purchase Order')}&doc_id=${po.id}&status=Pending`))[0];
    if (!ap) throw new Error('The approval request for this step was not found');
    await api(`/approvals/${ap.id}/decide`, { method: 'POST', body: { decision: 'Approved', comments: 'Prices, payment terms and due dates entered' } });
    toast('PO approved'); window.dispatchEvent(new Event('approvals-changed')); reload();
  });
  const saveSchedule = busy(async () => { await api(`/purchase_orders/${po.id}/payments`, { method: 'POST', body: { payment_schedule: sched.get().filter(p => p.due_date || p.amount || p.percent || p.description) } }); toast('Payment schedule saved'); reload(); });
  return h('div.card', { style: { borderLeft: '4px solid #1f4e9a' } },
    h('h2', atStep ? '💰 Commercial approval: prices, charges, payment terms and due dates' : '💰 Payment schedule'),
    atStep ? h('p.muted', 'Purchase and Technical have approved the vendor, material and specifications. Enter the vendor rates and GST, any freight / packing / installation / transport charges, the payment terms and when each payment is due (a date, or N days after the material is received), then approve. The GM gives the final approval after this.')
      : h('p.muted', 'Payments recorded under 💸 Vendor Payments mark these lines Paid automatically; “After inward” lines get their due date when the material is received (GRN).'),
    priceTable, chargeGrid, atStep ? totalsBox : null,
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
  const text = `Dear ${row.client_name || 'Doctor'}, please fill the detailed OT requirements for ${row.hospital_name || 'your hospital'} (about 5 minutes): ${url}`;
  const input = h('input', { value: url, readOnly: true, onclick: e => e.target.select() });
  const phone = String(row.client_phone || '').replace(/\D/g, '');
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
      if (can('service_tickets')) A.push(h('button.btn', { onclick: () => newRecord('service_tickets', { customer_id: id, hospital: row.name, city: row.place }) }, '+ Complaint'));
      if (can('costing_sheets')) A.push(h('button.btn', { onclick: () => newRecord('costing_sheets', { customer_id: id, hospital: row.name, site: row.place }) }, '🧮 Costing sheet'));
      if (canView('invoices', state.user.role)) A.push(h('a.btn', { href: `#/receivables/statement/${id}` }, '📒 Statement'));
      break;
    case 'enquiries': {
      if (can('costing_sheets')) A.push(h('button.btn', { onclick: () => newRecord('costing_sheets', { enquiry_id: id, customer_id: row.customer_id || undefined, hospital: row.hospital_name, site: row.place, title: [(row.type_of_work || []).join(', '), row.hospital_name].filter(Boolean).join(' – ') }) }, '🧮 Costing sheet'));
      if (can('quotations')) A.push(h('button.btn.primary', { onclick: go(() => post(`/enquiries/${id}/quotation`), q => (location.hash = `#/quotation/${q.id}`)) }, '🧾 Create Quotation'));
      if (can('followups')) A.push(h('button.btn', { onclick: () => newRecord('followups', { enquiry_id: id, ...(row.customer_id ? { customer_id: row.customer_id } : {}) }) }, '📞 Log Follow-up'));
      if (can('enquiries')) A.push(h('button.btn', { onclick: busy(() => briefDialog(row).catch(fail)) }, '📋 Detailed requirement form'));
      if (can('enquiries')) A.push(h('button.btn', { onclick: () => profileDialog(row, reload).catch(fail) }, '🧭 Client profile questionnaire'));
      A.push(h('a.btn', { href: `#/print/techsheet/${id}`, target: '_blank' }, '📄 Techno-commercial sheet'));
      if (!row.customer_id && can('customers') && row.hospital_name) {
        A.push(h('button.btn', { onclick: go(async () => {
          const c = await api('/customers', { method: 'POST', body: { name: row.hospital_name, place: row.place, state: row.state || undefined, pincode: row.pin_code || undefined, contact_person: row.client_name, phone: row.client_phone } });
          await api(`/enquiries/${id}`, { method: 'PUT', body: { customer_id: c.id } });
          clearRefCache('customers');
          toast('Customer created and linked');
          reload();
        }) }, '🏥 Save hospital as Customer'));
      }
      break;
    }
    case 'vendors': {
      const st = row.vendor_status;
      const may = hasFunction(state.user.role, 'vendor_approve');
      const setStatus = (status, needReason) => go(async () => {
        const reason = h('textarea', { rows: 3, placeholder: needReason ? 'Reason (required)' : 'Note (optional)' });
        const till = h('input', { type: 'date', value: row.valid_till || '' });
        if (!(await modal(`${row.name}: ${status}`, h('div.grid', h('label', needReason ? 'Reason *' : 'Note', reason), ['Approved', 'Preferred', 'Conditional'].includes(status) ? h('label', 'Approval valid till', till) : null,
          status === 'Blacklisted' ? h('p', { style: { color: 'var(--bad)' } }, 'A blacklisted vendor cannot get a PO submitted for approval.') : null),
          [{ label: 'Cancel', value: false }, { label: status, cls: status === 'Blacklisted' ? 'danger solid' : 'primary', value: true }]))) return;
        await post(`/vendors/${id}/status`, { status, reason: reason.value, valid_till: till.value || null }); toast(`${row.name}: ${status}`); reload();
      });
      if (may && st !== 'Approved') A.push(h('button.btn.good', { onclick: setStatus('Approved') }, '✔ Approve vendor'));
      if (may && st !== 'Preferred') A.push(h('button.btn', { onclick: setStatus('Preferred') }, '★ Preferred'));
      if (may && st !== 'Conditional') A.push(h('button.btn', { onclick: setStatus('Conditional', true) }, '◐ Conditional'));
      if (may && st !== 'Under review') A.push(h('button.btn', { onclick: setStatus('Under review', true) }, '⚠ Under review'));
      if (may && st !== 'Blacklisted') A.push(h('button.btn.danger', { onclick: setStatus('Blacklisted', true) }, '⛔ Blacklist'));
      if (can('vendor_evaluations')) A.push(h('button.btn', { onclick: () => newRecord('vendor_evaluations', { vendor_id: id }) }, '📊 Evaluate'));
      if (can('vendor_complaints')) A.push(h('button.btn', { onclick: () => newRecord('vendor_complaints', { vendor_id: id }) }, '⚠️ Complaint / SCAR'));
      if (can('vendor_audits')) A.push(h('button.btn', { onclick: () => newRecord('vendor_audits', { vendor_id: id }) }, '🔍 Audit'));
      break;
    }
    case 'vendor_evaluations': {
      if (row.status !== 'Final' && can(entity)) A.push(h('button.btn', { title: 'On-time delivery, quality (IQC) and complaint response from the GRNs, POs and complaints of the period', onclick: go(async () => {
        await post(`/vendor_evaluations/${id}/fill`);
        toast('Scores filled from the data: check them, fill the others'); reload();
      }) }, '⚡ Fill from data'));
      if (row.status !== 'Final' && hasFunction(state.user.role, 'vendor_approve')) A.push(h('button.btn.good', { onclick: go(async () => {
        if (!(await confirmBox(`Make ${row.eval_no} final? ${row.vendor_id_label} gets ${row.total ?? '—'}% (${row.band || '—'}) and its status follows the rating.`))) return;
        await post(`/vendor_evaluations/${id}/final`); toast('Evaluation final'); reload();
      }) }, '✔ Make final'));
      if (row.band) A.push(h('b', { style: { color: row.total >= 80 ? 'var(--good)' : row.total >= 70 ? 'var(--warn)' : 'var(--bad)' } }, `${row.total}% · ${row.band}`));
      break;
    }
    case 'approvals': {
      const docEnt = APPROVAL_DOCS[row.doc_type];
      if (docEnt && ENTITIES[docEnt].print) A.push(h('a.btn', { href: `#/print/${ENTITIES[docEnt].print}/${row.doc_id}${docEnt === 'purchase_orders' ? '?internal=1' : ''}`, target: '_blank' }, `🖨 Print ${row.doc_type}`));
      if (docEnt) A.push(h('a.btn', { href: recordHref(docEnt, row.doc_id), title: 'Open the document itself (to edit it)' }, `Open ${row.doc_type} ›`));
      if (row.status === 'Pending' && canApprove(row.doc_type, row.stage, row)) {
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
    case 'sales_orders': {
      if (row.quotation_id) A.push(h('a.btn', { href: `#/quotation/${row.quotation_id}` }, 'Quotation'));
      const approved = ['Approved', 'In Execution', 'Completed'].includes(row.status);
      if (['Draft', 'Rejected'].includes(row.status) && can('sales_orders')) A.push(h('button.btn.primary', { onclick: submit }, '📤 Submit to GM'));
      if (row.status === 'Approved' && can('sales_orders')) A.push(h('button.btn.good', { onclick: status('In Execution') }, '▶ In execution'));
      if (row.status === 'In Execution' && can('sales_orders')) A.push(h('button.btn.good', { onclick: status('Completed', 'Mark this sales order Completed?') }, '✔ Completed'));
      if (approved && can('sales_orders')) A.push(h('button.btn', { title: 'Change value, GST, milestones or retention: back to Draft and to the GM again', onclick: go(async () => {
        if (!(await confirmBox('Revise this approved sales order? It goes back to Draft; after your changes, Submit it to the GM again.'))) return;
        await post(`/sales_orders/${id}/revise`); toast('Back to Draft'); reload();
      }) }, '↩ Revise'));
      if (!approved) { if (row.status !== 'Cancelled') A.push(h('span.muted', 'Invoices, project and work order are made once the GM has approved it')); break; }
      if (can('projects')) A.push(h('button.btn', { onclick: go(() => post(`/sales_orders/${id}/project`), p => (location.hash = `#/view/projects/${p.id}`)) }, '🏗️ Create Project'));
      if (row.quotation_id && can('boqs')) A.push(h('button.btn', { title: 'Work order with every quotation line and quantity; then ⚙️ Generate BOQ', onclick: go(() => post(`/sales_orders/${id}/work-order`), r => { toast(`Work order ${r.boq.boq_no}: ${r.lines} line(s) from the quotation`); location.hash = `#/boq/${r.boq.id}`; }) }, '📂 Create Work Order'));
      if (can('invoices')) A.push(h('button.btn.primary', { onclick: go(async () => {
        const b = await api(`/sales_orders/${id}/billing`);
        const type = h('select', h('option', 'Tax Invoice'), h('option', 'Proforma Invoice'));
        const pick = h('select', [...b.milestones.map(m => h('option', { value: m.no },
          `${m.no}. ${m.description} – ${m.percent}% = ₹ ${inr(m.amount, 0)}${m.invoices.length ? '  ✓ ' + m.invoices.map(x => `${x.no}${x.type === 'Proforma Invoice' ? ' (PI)' : ''}`).join(', ') : ''}`)),
          h('option', { value: 0 }, 'Running bill / other (enter % or amount)')]);
        const first = b.milestones.find(m => !m.invoices.some(x => x.type === 'Tax Invoice'));
        pick.value = first ? first.no : 0;
        const pct = h('input', { type: 'number', min: 0, max: 100, placeholder: '%' });
        const amt = h('input', { type: 'number', min: 0, placeholder: 'Basic amount ₹ (before GST)' });
        const desc = h('input', { placeholder: 'e.g. RA bill 2 – work done up to 15 Oct' });
        const other = h('div.form-grid', h('label', '% of order value', pct), h('label', 'or basic amount', amt));
        const sync = () => { other.style.display = pick.value === '0' ? '' : 'none'; };
        pick.onchange = sync; sync();
        const ok = await modal('Create invoice from Sales Order', h('div.grid',
          h('p.muted', `Order ₹ ${inr(b.so.order_value, 0)} + GST ${b.so.gst_rate}% = ₹ ${inr(b.so.total_value, 0)} · invoiced ₹ ${inr(b.so.invoiced, 0)} · still to invoice ₹ ${inr(b.so.to_invoice, 0)}${b.so.retention_pct ? ` · retention ${b.so.retention_pct}%` : ''}`),
          b.pct_total !== 100 && b.milestones.length ? h('p', { style: { color: 'var(--warn)' } }, `The milestones add up to ${b.pct_total}%, not 100%. Check them on the sales order.`) : null,
          h('label', 'Milestone', pick), other, h('label', 'Invoice type', type), h('label', 'Description (optional)', desc),
          h('p.muted', 'A proforma asks for the advance; money received against it is an advance on the order and is adjusted against the tax invoices. A tax invoice gets its number when you Issue it.')),
          [{ label: 'Cancel', value: false }, { label: 'Create draft', cls: 'primary', value: true }]);
        if (!ok) return;
        const inv = await post(`/sales_orders/${id}/invoice`, { milestone_no: Number(pick.value) || undefined, percent: Number(pct.value) || undefined, amount: Number(amt.value) || undefined, type: type.value, description: desc.value || undefined });
        location.hash = `#/view/invoices/${inv.id}`;
      }) }, '💳 Create Invoice'));
      if (can('payments')) A.push(h('button.btn', { onclick: () => newRecord('payments', { kind: 'Advance (against sales order)', sales_order_id: id, customer_id: row.customer_id }) }, '💰 Advance received'));
      if (canView('invoices', state.user.role)) A.push(h('a.btn', { href: `#/receivables/statement/${row.customer_id}` }, '📒 Customer statement'));
      break;
    }
    case 'boq_items':
      if (row.boq_id) A.push(h('a.btn', { href: `#/boq/${row.boq_id}` }, '📑 Open BOQ'));
      break;
    case 'work_tasks': {
      const set = st => go(async () => { await api(`/work_tasks/${id}`, { method: 'PUT', body: { status: st } }); toast(`Task ${st.toLowerCase()}`); reload(); });
      if (row.status === 'To do' || row.status === 'Waiting') A.push(h('button.btn', { onclick: set('In progress') }, '▶ Start'));
      if (!['Done', 'Cancelled'].includes(row.status)) A.push(h('button.btn.good', { onclick: set('Done') }, '✔ Done'));
      if (row.status === 'Done') A.push(h('button.btn', { onclick: set('In progress') }, '↺ Reopen'));
      A.push(h('a.btn', { href: '#/taskboard' }, '🗂️ Task board'));
      break;
    }
    case 'attendance': {
      A.push(h('button.btn', { onclick: go(async () => {
        const pings = await api(`/hr/attendance/${id}/pings`);
        const d = m => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
        await modal(`Location checks – ${row.employee_id_label || ''}, ${fmtDate(row.date)}`, pings.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Time', 'Kind', 'Distance', 'GPS ±', 'Inside', 'Map', 'Photo', 'Flags'].map(x => h('th', x)))),
          h('tbody', pings.map(p => h('tr', h('td.nowrap', String(p.at).slice(11, 16)), h('td', p.kind), h('td.num', d(p.distance_m)), h('td.num', p.accuracy_m != null ? `${p.accuracy_m} m` : ''),
            h('td', { style: { color: p.inside === 'No' ? 'var(--bad)' : 'var(--good)' } }, p.inside || ''), h('td', h('a', { href: `https://www.google.com/maps?q=${p.lat},${p.lng}`, target: '_blank' }, 'map')),
            h('td', p.photo_id ? h('a', { href: `/api/files/${p.photo_id}?inline=1`, target: '_blank' }, h('img', { src: `/api/files/${p.photo_id}?inline=1`, style: { height: '48px', borderRadius: '6px' } })) : ''),
            h('td', { style: { fontSize: '11px', color: 'var(--warn)' } }, p.flags || '')))))) : h('p', 'No location checks'), [{ label: 'Close', value: true }], { wide: true });
      }) }, '📍 Location checks & photos'));
      if (row.review === 'To review' && hasFunction(state.user.role, 'hr_manage')) {
        A.push(h('button.btn.primary', { onclick: go(async () => { const { reviewButtons } = await import('./hrview.js'); reviewButtons(row, reload).click(); }) }, '🔎 Review this day'));
      }
      break;
    }
    case 'work_locations':
      if (row.lat != null && row.lng != null) A.push(h('a.btn', { href: `https://www.google.com/maps?q=${row.lat},${row.lng}`, target: '_blank' }, '🗺 Open in Maps'));
      if (can('work_locations')) A.push(h('button.btn', { title: 'Stand at the centre of the site and press this', onclick: go(async () => {
        if (!window.isSecureContext || !navigator.geolocation) throw new Error('Location works only on the https address of the CRM (on a phone)');
        const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(x => res(x.coords), e => rej(new Error(e.message || 'Location not available')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
        if (!(await confirmBox(`Set ${row.name} to your position now (±${Math.round(p.accuracy)} m)?`, 'Set location'))) return;
        await api(`/work_locations/${id}`, { method: 'PUT', body: { lat: Number(p.latitude.toFixed(6)), lng: Number(p.longitude.toFixed(6)), maps_link: null } }); toast('Location set'); reload();
      }) }, '📍 Use my location here'));
      if (can('site_assignments')) A.push(h('button.btn', { onclick: () => newRecord('site_assignments', { location_id: id, project_id: row.project_id || undefined }) }, '🗓️ Assign people'));
      break;
    case 'employees': {
      A.push(h('a.btn', { href: `#/list/attendance?employee_id=${id}` }, '🕘 Attendance'));
      if (can('site_assignments')) A.push(h('button.btn', { onclick: () => newRecord('site_assignments', { employee_id: id }) }, '🗓️ Assign to a site'));
      if (can('leave_requests')) A.push(h('button.btn', { onclick: () => newRecord('leave_requests', { employee_id: id }) }, '🌴 Leave'));
      // the employee file: joining, probation, assets, bond, exit
      const openOr = (entity, pre, label) => h('button.btn', { onclick: go(async () => {
        const rows = await api(`/${entity}?employee_id=${id}&limit=5`);
        if (rows.length) location.hash = `#/view/${entity}/${rows[0].id}`; else newRecord(entity, pre);
      }) }, label);
      if (can('onboardings')) A.push(openOr('onboardings', { employee_id: id, joining_date: row.joining_date || undefined }, '🧾 Onboarding file'));
      if (can('probation_reviews')) A.push(h('a.btn', { href: `#/list/probation_reviews?employee_id=${id}` }, '📋 Probation reviews'));
      if (can('asset_issues')) A.push(h('button.btn', { onclick: () => newRecord('asset_issues', { employee_id: id }) }, '💻 Issue asset'), h('a.btn', { href: `#/list/asset_issues?employee_id=${id}` }, 'Assets held'));
      if (row.bond_signed_on || row.bond_amount) A.push(h('a.btn', { href: `#/print/bond/${id}`, target: '_blank' }, '🖨 Employment bond'));
      else if (can('employees')) A.push(h('a.btn', { href: `#/print/bond/${id}`, target: '_blank', title: 'Fill the bond amount / period on this employee first' }, '🖨 Bond (blank amount)'));
      if (can('separations') && row.status !== 'Left') A.push(openOr('separations', { employee_id: id }, '🚪 Exit / resignation'));
      break;
    }
    case 'onboardings':
      A.push(h('a.btn', { href: `#/print/onboarding/${id}`, target: '_blank' }, '🖨 Joining checklist'), h('a.btn', { href: `#/view/employees/${row.employee_id}` }, '🧑‍💼 Employee'));
      if (row.progress != null) A.push(h('b', { style: { color: row.status === 'Completed' ? 'var(--good)' : 'var(--warn)' } }, `${row.progress}% done`));
      break;
    case 'probation_reviews': {
      const st = row.status;
      A.push(h('a.btn', { href: `#/print/probation/${id}`, target: '_blank' }, '🖨 Review form'));
      if (can(entity) && ['Due', 'Done', 'Rejected'].includes(st) && ['Confirm', 'Extend probation', 'Not suitable – separate'].includes(row.recommendation)) A.push(h('button.btn.primary', { onclick: submit }, `📤 Send “${row.recommendation}” to management`));
      if (st === 'Approved' && ['Confirm', 'Extend probation'].includes(row.recommendation)) A.push(h('a.btn.good', { href: `#/print/confirmation/${id}`, target: '_blank' }, row.recommendation === 'Confirm' ? '🖨 Confirmation letter' : '🖨 Extension letter'));
      break;
    }
    case 'asset_issues':
      if (can(entity) && row.status === 'Issued') A.push(h('button.btn.good', { onclick: go(async () => {
        const d = h('input', { type: 'date', value: today() }), c = h('input', { placeholder: 'Condition on return' });
        if (!(await modal(`Returned: ${row.asset_type} ${row.serial_no || ''}`, h('div.form-grid', h('label', 'Returned on', d), h('label', 'Condition', c)), [{ label: 'Cancel', value: false }, { label: 'Returned', cls: 'good', value: true }]))) return;
        await api(`/asset_issues/${id}`, { method: 'PUT', body: { status: 'Returned', returned_on: d.value, received_by: state.user.name, remarks: [row.remarks, c.value && `Returned: ${c.value}`].filter(Boolean).join('\n') } });
        toast('Marked returned'); reload();
      }) }, '↩ Returned'));
      break;
    case 'separations': {
      const st = row.status;
      const hr = hasFunction(state.user.role, 'hr_manage');
      const act = (action, body) => post(`/separations/${id}/act/${action}`, body);
      const ask = (title, fields, label) => modal(title, h('div.form-grid', ...fields.map(([l, el]) => h('label', l, el))), [{ label: 'Cancel', value: false }, { label, cls: 'primary', value: true }]);
      if (hr && st === 'Notice period' && row.type === 'Resignation' && !row.accepted_on) A.push(h('button.btn.primary', { onclick: go(async () => {
        const d = h('input', { type: 'date', value: today() }), r = h('input', { type: 'date', value: row.relieving_date || '' });
        if (!(await ask('Accept the resignation', [['Letter date', d], ['Relieving date', r]], 'Accept'))) return;
        await act('accept', { date: d.value, relieving_date: r.value }); toast('Accepted: print the acceptance letter'); reload();
      }) }, '✔ Accept resignation'));
      if (row.accepted_on) A.push(h('a.btn', { href: `#/print/acceptance/${id}`, target: '_blank' }, '🖨 Acceptance letter'));
      if (hr && st === 'Notice period') A.push(h('button.btn.good', { onclick: go(async () => {
        const d = h('input', { type: 'date', value: row.relieving_date || today() });
        const open = (row.checklist || []).filter(c => c.item && !c.done).length;
        if (!(await ask(`Relieve ${row.employee_id_label}`, [['Last working day', d], ['', h('p.muted', `${open ? open + ' clearance point(s) still open. ' : ''}The employee is marked Left; site assignments end. Close the CRM login under Users.`)]], 'Relieve'))) return;
        await act('relieve', { date: d.value }); toast('Relieved'); reload();
      }) }, '🚪 Relieve'));
      if (hr && st === 'Notice period') A.push(h('button.btn', { onclick: go(async () => { if (!(await confirmBox('The employee withdraws the resignation (with management\'s consent)?'))) return; await act('withdraw'); reload(); }) }, 'Withdrawn'));
      if (['Relieved', 'F&F settled'].includes(st)) A.push(h('a.btn', { href: `#/print/relieving/${id}`, target: '_blank', onclick: e => {
        if (row.shortfall_days && row.notice_waived !== 'Yes' && !Number(row.notice_recovery) && !confirm('Notice not served and not recovered: the HR Policy withholds the relieving / experience letter. Print anyway?')) e.preventDefault();
      } }, '🖨 Relieving & experience letter'));
      A.push(h('a.btn', { href: `#/print/exitinterview/${id}`, target: '_blank' }, '🖨 Exit interview'), h('a.btn', { href: `#/print/fnf/${id}`, target: '_blank' }, '🖨 Full & final'));
      if ((hr || hasFunction(state.user.role, 'pay_record')) && st === 'Relieved') A.push(h('button.btn.good', { onclick: go(async () => {
        const d = h('input', { type: 'date', value: today() }), r = h('input', { placeholder: 'UTR / cheque no' });
        if (!(await ask(`Full & final paid: ₹ ${inr(row.net_payable || 0)}`, [['Paid on', d], ['Reference', r]], 'Paid'))) return;
        await act('settle', { date: d.value, ref: r.value }); toast('Full & final settled'); reload();
      }) }, '💸 F&F paid'));
      break;
    }
    case 'leave_requests':
      if (can(entity) && ['Draft', 'Rejected'].includes(row.status)) A.push(h('button.btn.primary', { onclick: submit }, '📤 Submit for approval'));
      if ((hasFunction(state.user.role, 'hr_manage') || hasFunction(state.user.role, 'leave_approve')) && ['Draft', 'Pending Approval', 'Approved'].includes(row.status)) A.push(h('button.btn.danger', { onclick: go(async () => {
        if (!(await confirmBox(`Cancel ${row.leave_no}? Its days come off the register.`))) return;
        await post(`/leave_requests/${id}/cancel`); toast('Leave cancelled'); reload();
      }) }, 'Cancel leave'));
      break;
    case 'service_tickets': {
      const pre = { ticket_id: id, hospital: row.hospital, customer_id: row.customer_id || undefined, amc_id: row.amc_id || undefined };
      if (can('service_reports')) A.push(h('button.btn.primary', { onclick: () => newRecord('service_reports', { ...pre, call_type: row.amc_id ? 'AMC Service Visit' : row.under_warranty === 'Yes' ? 'Warranty' : 'Break Down Call', problem: row.complaint, contact_name: row.contact_person, mobile: row.contact_no }) }, '📋 Service report'));
      if (can('service_work_orders')) A.push(h('button.btn', { onclick: () => newRecord('service_work_orders', { ticket_id: id, hospital: row.hospital, customer_id: row.customer_id || undefined, amc_id: row.amc_id || undefined, location: row.city }) }, '🧰 Parts (work order)'));
      if (can('costing_sheets')) A.push(h('button.btn', { onclick: () => newRecord('costing_sheets', { kind: 'Service', ticket_id: id, hospital: row.hospital, customer_id: row.customer_id || undefined, amc_id: row.amc_id || undefined, site: row.city, title: `Service – ${row.equipment || 'system'} – ${row.hospital || ''}` }) }, '🧮 Service costing'));
      if (can('rca_reports')) A.push(h('button.btn', { onclick: () => newRecord('rca_reports', pre) }, '🔍 RCA'));
      break;
    }
    case 'amc_contracts':
      if (can('service_tickets')) A.push(h('button.btn', { onclick: () => newRecord('service_tickets', { amc_id: id, hospital: row.hospital, customer_id: row.customer_id || undefined, city: row.city, contact_person: row.contact_person, contact_no: row.mobile, under_warranty: 'Yes' }) }, '🛠️ New complaint'));
      if (can('service_reports')) A.push(h('button.btn.primary', { onclick: () => newRecord('service_reports', { amc_id: id, hospital: row.hospital, customer_id: row.customer_id || undefined, call_type: row.cover_status === 'In Warranty' ? 'Warranty' : 'AMC Service Visit', contact_name: row.contact_person, mobile: row.mobile, email: row.email }) }, '📋 Service visit report'));
      if (can('amc_contracts') && row.amc_amount > 0) A.push(h('button.btn', { onclick: go(async () => {
        if (!(await confirmBox(`Make a proforma invoice for the AMC of ${row.hospital}: ₹ ${inr(row.amc_amount)} incl. GST?`, 'Make PI'))) return;
        const inv = await post(`/amc_contracts/${id}/proforma`); toast(`Proforma ${inv.invoice_no} made`); location.hash = `#/view/invoices/${inv.id}`;
      }) }, '🧾 AMC proforma invoice'));
      break;
    case 'service_work_orders':
      A.push(h('a.btn', { href: `#/print/swo/${id}`, target: '_blank' }, '🖨 Print'));
      if (!row.mr_id && can('material_requests')) A.push(h('button.btn.primary', { onclick: go(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        if (!(await confirmBox('Send these parts to the store as a material request? The store issues what it has and sends the rest to purchase.', 'Send to store'))) return;
        const r = await post(`/service_work_orders/${id}/to-store`); toast(`Material request ${r.request.mr_no} sent to the store`); reload();
      }) }, '📦 Send to store'));
      if (row.mr_id) A.push(h('a.btn', { href: `#/view/material_requests/${row.mr_id}` }, '🙋 Its material request'));
      break;
    case 'service_reports':
      A.push(h('a.btn', { href: `#/print/servicereport/${id}`, target: '_blank' }, '🖨 Print service report'));
      break;
    case 'rca_reports':
      A.push(h('a.btn', { href: `#/print/rca/${id}`, target: '_blank' }, '🖨 Print RCA'));
      break;
    case 'costing_sheets':
      A.push(h('a.btn', { href: `#/print/costing/${id}`, target: '_blank' }, row.kind === 'Service' ? '🖨 Service quotation' : '🖨 Quotation (selling prices)'));
      if (row.kind === 'Sales' && can('quotations')) A.push(h('button.btn.primary', { onclick: go(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        const qs = (await api('/quotations?status=Draft&limit=200')).filter(q => !row.customer_id || !q.customer_id || q.customer_id === row.customer_id);
        if (!qs.length) { toast('No Draft quotation for this customer: make the quotation first (CRM → Quotations)'); return; }
        const sel = h('select', qs.map(q => h('option', { value: q.id }, `${q.quote_no} · ${q.customer_id_label || ''} · ${q.subject || ''}`)));
        if (!(await modal('Add to quotation', h('div.grid', h('p.muted', `The lines go in at selling price (cost + ${row.margin_pct}%), plus transport ₹ ${inr(row.transport || 0)}, under the heading “${row.title}”.`), h('label', 'Draft quotation', sel)),
          [{ label: 'Cancel', value: false }, { label: '➕ Add lines', cls: 'primary', value: true }]))) return;
        const r = await post(`/costing_sheets/${id}/to-quotation`, { quotation_id: Number(sel.value) }); toast(`Added to ${r.quotation.quote_no}`); location.hash = `#/quotation/${r.quotation.id}`;
      }) }, '➕ Add to quotation'));
      if (!row.invoice_id && can('costing_sheets')) A.push(h('button.btn', { onclick: go(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        if (!(await confirmBox(`Make a proforma invoice of ₹ ${inr(row.grand_total)} (selling prices) for ${row.hospital || 'the customer'}?`, 'Make PI'))) return;
        const inv = await post(`/costing_sheets/${id}/proforma`); toast(`Proforma ${inv.invoice_no} made`); location.hash = `#/view/invoices/${inv.id}`;
      }) }, '🧾 Proforma invoice'));
      break;
    case 'material_requests': {
      const st = row.status, store = hasFunction(state.user.role, 'stock_post');
      A.push(h('a.btn', { href: `#/print/mr/${id}`, target: '_blank' }, '🖨 Print'));
      if (['Draft', 'Rejected'].includes(st) && can('material_requests')) A.push(h('button.btn.primary', { onclick: busy(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        await post(`/material_requests/${id}/submit`); toast('Sent to the store'); reload();
      }) }, '📤 Send to store'));
      if (['Submitted', 'Partly Issued', 'Sent to Purchase'].includes(st) && store) A.push(h('button.btn.good', { onclick: go(async () => {
        // The store's split: issue what is in stock, send the rest to purchase.
        const plan = await api(`/material_requests/${id}/stock`);
        const inputs = plan.map(p => ({ p, issue: h('input', { type: 'number', step: 'any', min: 0, value: p.issue, style: { width: '80px' } }), buy: h('input', { type: 'number', step: 'any', min: 0, value: p.purchase, style: { width: '80px' } }) }));
        const production = String(row.purpose || '').startsWith('Production');
        const ok = await modal(`Process ${row.mr_no} – ${row.requested_by || ''}`, h('div.grid',
          h('p.muted', `Issue = goes out on a draft ${production ? 'Material Transfer Note to the production stock' : 'issue slip'} (post it to reduce stock). Purchase = goes to the Purchase Head as a requisition with the site on each line. Free stock leaves out what is reserved for Final BOQs.`),
          h('div.table-wrap', h('table.data', h('thead', h('tr', ['Material', 'Site', 'Asked', 'Issued', 'On order', 'In stock', 'Free', 'Issue now', 'Purchase'].map(x => h('th', x)))),
            h('tbody', inputs.map(({ p, issue, buy }) => h('tr', h('td', p.description || '—', p.item_id ? null : h('div.muted', { style: { fontSize: '11px' } }, 'not a store item: purchase only')), h('td', p.site || ''),
              h('td.num', `${p.qty} ${p.uom}`), h('td.num', p.issued || ''), h('td.num', p.to_purchase || ''), h('td.num', p.stock), h('td.num', { style: { color: p.free < p.need ? 'var(--warn)' : '' } }, p.free),
              h('td', p.item_id ? issue : '—'), h('td', buy))))))),
          [{ label: 'Cancel', value: false }, { label: '✔ Issue & send to purchase', cls: 'good', value: true }], { wide: true });
        if (!ok) return;
        const r = await post(`/material_requests/${id}/process`, { lines: inputs.map(({ p, issue, buy }) => ({ line: p.line, issue: Number(issue.value) || 0, purchase: Number(buy.value) || 0 })) });
        toast([r.draft && `Draft #${r.draft.id} made (post it to issue)`, r.requisition && `Requisition ${r.requisition.req_no} sent to the Purchase Head`].filter(Boolean).join(' · '));
        if (r.draft && (await confirmBox(`Open draft #${r.draft.id} to post it now?`, 'Open draft'))) { location.hash = `#/view/stock_drafts/${r.draft.id}`; return; }
        reload();
      }) }, st === 'Submitted' ? '📦 Process (issue / purchase)' : '📦 Issue now'));
      if (st === 'Submitted' && store) A.push(h('button.btn.danger', { onclick: go(async () => {
        const why = h('textarea', { rows: 3, placeholder: 'e.g. not needed / use item X instead / wrong quantity' });
        if (!(await modal('Return this request?', h('label', 'Reason *', why), [{ label: 'Back', value: false }, { label: '↩ Return', cls: 'danger solid', value: true }]))) return;
        await post(`/material_requests/${id}/reject`, { reason: why.value }); toast('Returned to the requester'); reload();
      }) }, '↩ Return'));
      if (st !== 'Draft') A.push(h('a.btn', { href: `#/list/stock_drafts?mr_id=${id}` }, '📝 Its issue slips / MTNs'));
      break;
    }
    case 'production_orders': {
      const st = row.status, rel = hasFunction(state.user.role, 'production_release');
      const act = async (action, body) => { await post(`/production_orders/${id}/act/${action}`, body); reload(); };
      const why = async (title, label) => { const r = h('input', { placeholder: 'Reason' }); return (await modal(title, h('label', 'Reason', r), [{ label: 'Cancel', value: false }, { label, cls: 'primary', value: true }])) && r.value.trim() ? r.value.trim() : null; };
      if (rel && st === 'Draft') A.push(h('button.btn.primary', { onclick: go(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        if (!(await confirmBox(`Release ${row.order_no} to production? Checked: approved drawing ${row.drawing_ok === 'Yes' ? '✔' : '✘'}, BOM ${row.bom_ok === 'Yes' ? '✔' : '✘'}, material ${row.material_ok || '✘'}.`, 'Release'))) return;
        await act('release'); toast('Released to production');
      }) }, '🚦 Release to production'));
      if (rel && ['Draft', 'Released', 'In production'].includes(st)) A.push(h('button.btn', { onclick: go(async () => { const r = await why(`Put ${row.order_no} on hold`, 'Hold'); if (r) await act('hold', { reason: r }); }) }, '⏸ Hold'));
      if (rel && st === 'On hold') A.push(h('button.btn', { onclick: go(() => act('resume')) }, '▶ Resume'));
      if (rel && ['Released', 'In production'].includes(st)) A.push(h('button.btn', { onclick: go(async () => { const r = await why(`Close ${row.order_no} at ${row.qty_done || 0} of ${row.qty}`, 'Close short'); if (r) await act('close', { reason: r }); }) }, '⏹ Close short'));
      if (rel && !['Completed', 'Cancelled'].includes(st)) A.push(h('button.btn.danger', { onclick: go(async () => { const r = await why(`Cancel ${row.order_no}`, 'Cancel order'); if (r) await act('cancel', { reason: r }); }) }, 'Cancel order'));
      if (can('production_reports') && ['Released', 'In production'].includes(st)) A.push(h('button.btn', { onclick: () => { location.hash = '#/production/day'; } }, '📋 Daily report'));
      if (can('qc_inspections') && ['Released', 'In production', 'Completed'].includes(st)) A.push(h('button.btn', { onclick: go(async () => {
        const kind = h('select', ['In-process (IPQC)', 'Final (FQC)', 'Dispatch QC'].map(k => h('option', k))), stage = h('select', ['', 'Laser cutting', 'Shearing', 'CNC bending', 'Fabrication / welding', 'PUF foaming', 'Powder coating', 'Assembly'].map(k => h('option', k)));
        if (row.stage && [...stage.options].some(o => o.value === row.stage)) stage.value = row.stage;
        const qty = h('input', { type: 'number', step: 'any', placeholder: 'Qty to inspect' });
        if (!(await modal(`QC inspection – ${row.order_no}`, h('div.form-grid', h('label', 'Inspection', kind), h('label', 'Stage (in-process)', stage), h('label', 'Qty inspected', qty)), [{ label: 'Cancel', value: false }, { label: 'Start', cls: 'primary', value: true }]))) return;
        const q = await api('/qc_inspections', { method: 'POST', body: { order_id: id, kind: kind.value, stage: kind.value.startsWith('In-process') ? stage.value : '', qty_inspected: qty.value === '' ? null : Number(qty.value) } });
        location.hash = `#/view/qc_inspections/${q.id}`;
      }) }, '🔍 QC inspection'));
      A.push(h('a.btn', { href: `#/print/prodorder/${id}`, target: '_blank' }, '🖨 Production release note'));
      break;
    }
    case 'production_plans': {
      const st = row.status;
      if (can(entity) && ['Draft', 'Rejected'].includes(st)) {
        A.push(h('button.btn', { onclick: go(async () => {
          if (ctx.save) await ctx.save({ quiet: true });
          const cur = (await api(`/production_plans/${id}`)).lines || [];
          const add = (await api(`/production/fill-plan?month=${row.month}`)).filter(l => !cur.some(c => Number(c.order_id) === l.order_id));
          if (!add.length) { toast('Every open order is already in the plan'); return; }
          await api(`/production_plans/${id}`, { method: 'PUT', body: { lines: [...cur, ...add] } });
          toast(`${add.length} open order(s) added`); reload();
        }) }, '⤓ Add open orders'));
        A.push(h('button.btn.primary', { onclick: submit }, '📤 Submit for approval'));
      }
      if (st === 'Approved' && (hasFunction(state.user.role, 'production_plan_approve') || hasFunction(state.user.role, 'production_release'))) A.push(h('button.btn', { onclick: go(async () => {
        if (!(await confirmBox(`Revise ${row.plan_no}? It goes back to Draft (revision ${(row.rev || 0) + 1}) and needs approval again.`, 'Revise'))) return;
        await post(`/production_plans/${id}/act/revise`); reload();
      }) }, '✎ Revise'));
      A.push(h('a.btn', { href: `#/production/plan?month=${row.month}` }, '📊 Plan vs actual'), h('a.btn', { href: `#/print/prodplan/${id}`, target: '_blank' }, '🖨 Print plan'));
      break;
    }
    case 'production_reports': {
      const st = row.status;
      if (can(entity) && st === 'Draft') {
        A.push(h('button.btn', { onclick: go(async () => {
          if (ctx.save) await ctx.save({ quiet: true });
          const cur = (await api(`/production_reports/${id}`)).lines || [];
          const add = (await api(`/production/suggest-day?date=${row.date}`)).filter(l => !cur.some(c => Number(c.order_id) === l.order_id));
          if (!add.length) { toast('Every released order is already on the report'); return; }
          await api(`/production_reports/${id}`, { method: 'PUT', body: { lines: [...cur, ...add] } });
          toast(`${add.length} order(s) added with today’s plan`); reload();
        }) }, '⤓ Add released orders'));
        A.push(h('button.btn.primary', { onclick: go(async () => {
          if (ctx.save) await ctx.save({ quiet: true });
          await post(`/production_reports/${id}/submit`); toast('Daily report submitted'); reload();
        }) }, '📤 Submit report'));
      }
      if (st === 'Submitted' && hasFunction(state.user.role, 'production_release')) A.push(h('button.btn', { onclick: go(async () => {
        const r = h('input', { placeholder: 'Reason' });
        if (!(await modal(`Reopen ${row.report_no}`, h('label', 'Why (e.g. quantity typed wrong)', r), [{ label: 'Cancel', value: false }, { label: 'Reopen', cls: 'primary', value: true }])) || !r.value.trim()) return;
        await post(`/production_reports/${id}/reopen`, { reason: r.value.trim() }); reload();
      }) }, '↺ Reopen'));
      A.push(h('a.btn', { href: `#/production/day?date=${row.date}` }, '📊 Day review'), h('a.btn', { href: `#/print/prodday/${id}`, target: '_blank' }, '🖨 Print'));
      break;
    }
    case 'qc_inspections':
      if (row.status === 'Draft' && hasFunction(state.user.role, 'qc_inspect')) {
        A.push(h('button.btn', { onclick: go(async () => {
          if (ctx.save) await ctx.save({ quiet: true });
          const q = await api(`/qc_inspections/${id}`);
          await api(`/qc_inspections/${id}`, { method: 'PUT', body: { checks: (q.checks || []).map(c => ({ ...c, result: c.result || 'OK' })) } });
          toast('Unanswered checks set to OK'); reload();
        }) }, '✔ Rest OK'));
        A.push(h('button.btn.primary', { onclick: go(async () => {
          if (ctx.save) await ctx.save({ quiet: true });
          const rw = Number(row.qty_rework) || 0, rj = Number(row.qty_rejected) || 0;
          if (!(await confirmBox(`Record ${row.qc_no}: ${row.qty_accepted ?? '?'} accepted${rw ? ', ' + rw + ' rework' : ''}${rj ? ', ' + rj + ' rejected' : ''}?${rw + rj ? ' An NCR is raised.' : ''} It cannot be changed afterwards.`, 'Record'))) return;
          const r = await post(`/qc_inspections/${id}/done`);
          toast(r.ncr_id ? 'Recorded – NCR raised' : 'Inspection recorded'); reload();
        }) }, '📝 Record inspection'));
      }
      if (row.ncr_id) A.push(h('a.btn', { href: `#/view/ncrs/${row.ncr_id}` }, `🚩 ${String(row.ncr_id_label || 'NCR').split(' · ')[0]}`));
      A.push(h('a.btn', { href: `#/print/qcreport/${id}`, target: '_blank' }, '🖨 QC report'));
      break;
    case 'ncrs': {
      const st = row.status, head = hasFunction(state.user.role, 'ncr_close');
      const act = async (action, body) => { if (ctx.save) await ctx.save({ quiet: true }); await post(`/ncrs/${id}/act/${action}`, body); reload(); };
      if (can(entity) && st === 'Open') A.push(h('button.btn', { onclick: go(() => act('investigate')) }, '🔎 Start investigation'));
      if (can(entity) && ['Open', 'Under investigation'].includes(st)) A.push(h('button.btn.primary', { onclick: go(() => act('action')) }, '🛠 CAPA decided – start action'));
      if (head && st === 'Action in progress') A.push(h('button.btn.good', { onclick: go(async () => { if (!(await confirmBox(`Close ${row.ncr_no}? The action has been verified as effective.`, 'Close NCR'))) return; await act('close'); toast('NCR closed'); }) }, '✔ Verify & close'));
      if (head && !['Closed', 'Cancelled'].includes(st)) A.push(h('button.btn.danger', { onclick: go(async () => {
        const r = h('input', { placeholder: 'Reason' });
        if (!(await modal(`Cancel ${row.ncr_no}`, h('label', 'Why (e.g. raised in error)', r), [{ label: 'Back', value: false }, { label: 'Cancel NCR', cls: 'danger solid', value: true }])) || !r.value.trim()) return;
        await act('cancel', { reason: r.value.trim() });
      }) }, 'Cancel NCR'));
      if (row.inspection_id) A.push(h('a.btn', { href: `#/view/qc_inspections/${row.inspection_id}` }, '🔍 Inspection'));
      // Root cause pictures from what is on the form now (saved first).
      const fresh = async () => { if (ctx.save) await ctx.save({ quiet: true }); return api(`/ncrs/${id}`); };
      const show = (title, body) => modal(title, body, [{ label: 'Close', value: true }], { wide: true });
      A.push(h('button.btn', { onclick: go(async () => { const n = await fresh(); const { fishbone } = await import('./rca.js'); await show(`Fishbone – ${n.ncr_no}`, fishbone(String(n.description || '').split('\n')[0].replace(/^QC-\S+\s*(·[^:]*)?:\s*/, ''), n.fishbone || [])); }) }, '🐟 Fishbone'));
      A.push(h('button.btn', { onclick: go(async () => { const n = await fresh(); const { processMap } = await import('./rca.js'); await show(`Process map – ${n.ncr_no}`, (n.process_steps || []).length ? processMap(n.process_steps) : h('p.muted', 'Add the process steps first (section 4).')); }) }, '🗺 Process map'));
      A.push(h('button.btn', { onclick: go(async () => {
        await fresh();
        const [p, { pareto }] = await Promise.all([api(`/ncrs/${id}/pareto`), import('./rca.js')]);
        const views = [['category', 'NCR category', [p.mine.category]], ['cause', 'Confirmed cause (6M)', p.mine.causes], ['product', 'Product', [p.mine.product]], ['check', 'Failed QC check', []]];
        const box = h('div'), tabs = h('div.tabs');
        const pick = k => { const v = views.find(x => x[0] === k); tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.k === k)); box.replaceChildren(pareto(p[k], v[2])); };
        tabs.append(...views.map(([k, l]) => h('button', { 'data-k': k, onclick: () => pick(k) }, l)));
        pick('category');
        await show(`Pareto – ${p.ncr_no} (since ${fmtDate(p.from)})`, h('div', h('p.muted', 'This NCR is outlined in red. Dark bars are the vital few that make up 80%. Write what it shows in “Pareto conclusion”.'), tabs, box));
      }) }, '📊 Pareto'));
      if ((row.capa_tasks || []).length) A.push(h('button.btn', { onclick: go(async () => {
        const ts = await api(`/ncrs/${id}/tasks`);
        await show(`CAPA tasks – ${row.ncr_no}`, h('table.data', h('thead', h('tr', ['Task', 'Assigned to', 'Status'].map(x => h('th', x)))),
          h('tbody', ts.map(t => h('tr', h('td', h('a', { href: `#/view/work_tasks/${t.id}` }, `${t.task_no} · ${t.title}`)), h('td', t.assigned_to), h('td', badge(t.status)))))));
      }) }, '📋 CAPA tasks'));
      A.push(h('a.btn', { href: `#/print/ncr/${id}`, target: '_blank' }, '🖨 NCR / CAPA report'));
      break;
    }
    case 'production_entries':
      if (row.status === 'Draft' && hasFunction(state.user.role, 'production_post')) A.push(h('button.btn.good', { onclick: go(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        if (!(await confirmBox(`Post ${row.entry_no}? ${row.qty} ${row.uom || ''} of ${row.fg_item_id_label || 'the finished good'} go into store stock and the material used leaves the production stock.`, 'Post'))) return;
        try { await post(`/production_entries/${id}/post`, {}); }
        catch (e) {
          if (/Enter the raw material used/.test(e.message)) { if (!(await confirmBox('No raw material is entered. Post anyway (nothing used from the production stock)?', 'Post anyway'))) return; await post(`/production_entries/${id}/post`, { noMaterial: true }); }
          else if (/Not enough in the production stock/.test(e.message) && hasFunction(state.user.role, 'allow_negative')) {
            if (!(await modal('Production stock is short', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message), [{ label: 'Cancel', value: false }, { label: 'Post anyway', cls: 'danger solid', value: true }]))) return;
            await post(`/production_entries/${id}/post`, { allowShort: true });
          } else throw e;
        }
        toast('Posted: finished goods in stock'); reload();
      }) }, '✔ Post (finished goods into stock)'));
      if (row.status === 'Posted') A.push(h('a.btn', { href: `#/print/stockdoc/PRODUCED?doc=${encodeURIComponent(row.entry_no)}`, target: '_blank' }, '🖨 Production note'));
      A.push(h('a.btn', { href: '#/production' }, '🏭 Daily output & production stock'));
      break;
    case 'stock_drafts':
      if (row.status === 'Draft' && hasFunction(state.user.role, 'stock_post')) A.push(h('button.btn.good', { onclick: go(async () => {
        if (!(await confirmBox(`Post ${row.doc_kind.toLowerCase()} draft #${id}? ${row.item_count} item(s) leave the stock and the number is given. It cannot be changed afterwards.`, 'Post'))) return;
        const { postDraft, postedDialog } = await import('./stock.js');
        const r = await postDraft(id);
        if (r) { await postedDialog(r); reload(); }
      }) }, '✔ Post (reduce stock)'));
      if (row.status === 'Draft' && !hasFunction(state.user.role, 'stock_post')) A.push(h('span.muted', 'Waiting for the store to post it'));
      if (row.status === 'Draft' && can('stock_moves')) A.push(h('a.btn', { href: `#/stock-entry?draft=${id}` }, '✎ Edit'));
      if (row.status === 'Draft' && can('stock_moves')) A.push(h('button.btn.danger', { onclick: go(async () => {
        if (!(await confirmBox(`Cancel draft #${id}? Nothing was issued, so the stock is not affected.`, 'Cancel draft'))) return;
        await post(`/stock/drafts/${id}/cancel`); toast('Draft cancelled'); reload();
      }) }, '✖ Cancel draft'));
      if (row.status === 'Posted' && row.doc_no) A.push(h('a.btn', { href: `#/print/stockdoc/${row.type}?doc=${encodeURIComponent(row.doc_no)}`, target: '_blank' }, '🖨 Issue / transfer slip'));
      if (row.challan_id) A.push(h('a.btn', { href: `#/view/challans/${row.challan_id}` }, '🚚 Challan'));
      break;
    case 'dispatch_plans': {
      const st = row.status, open = !['Dispatched', 'Delivered', 'Cancelled'].includes(st);
      if (row.boq_id) A.push(h('a.btn', { href: `#/boq/${row.boq_id}` }, '📂 Work order (master)'));
      if (row.project_id) A.push(h('a.btn', { href: `#/planner/${row.project_id}` }, '📅 Project Gantt'));
      if (can(entity) && open) A.push(h('button.btn', { title: 'Add the work-order material still to send', onclick: go(async () => {
        const dept = h('select', ['All departments', ...WO_DEPARTMENTS, '(not assigned)'].map(x => h('option', x)));
        if (!(await modal('Fill from the work order', h('div.grid', h('p', 'Adds every work-order line still pending (with its pending quantity) to this plan. Remove what is not going on this dispatch.'), h('label', 'Department', dept)),
          [{ label: 'Cancel', value: false }, { label: 'Add pending material', cls: 'primary', value: true }]))) return;
        const r = await post(`/dispatch_plans/${id}/fill`, { department: dept.value === 'All departments' ? '' : dept.value });
        toast(`${r.added} line(s) added`); reload();
      }) }, '📥 Fill from work order'));
      if (can(entity) && st === 'Planned') A.push(h('button.btn', { onclick: status('Material ready') }, '✔ Material ready'));
      if (can(entity) && open) A.push(h('button.btn.good', { onclick: go(async () => {
        const ch = (await api(`/challans?project_id=${row.project_id}`)).filter(c => c.status !== 'Cancelled').map(c => ({ id: c.id, label: `${c.challan_no} · ${fmtDate(c.date)} · ${c.status}` }));
        let pick = null;
        const { itemPicker } = await import('./form.js');
        if (!(await modal('Dispatched', h('div.grid', h('p', 'Which delivery challan did this material go on? (Make the challan from the work order or the stock entry first.)'),
          h('label', 'Delivery challan', itemPicker(ch, null, { onPick: x => { pick = x; } }))), [{ label: 'Cancel', value: false }, { label: 'Mark dispatched', cls: 'good', value: true }]))) return;
        await api(`/dispatch_plans/${id}`, { method: 'PUT', body: { status: 'Dispatched', challan_id: pick } }); toast('Dispatched: the Gantt milestone is done'); reload();
      }) }, '🚚 Mark dispatched'));
      if (can(entity) && open) A.push(h('button.btn.danger', { onclick: status('Cancelled', 'Cancel this dispatch plan? Its milestone is taken off the Gantt.') }, 'Cancel plan'));
      if (row.late === 'Yes') A.push(h('b', { style: { color: 'var(--bad)' } }, '⚠ planned date passed'));
      break;
    }
    case 'challans': {
      const st = row.status;
      A.push(h('a.btn', { href: `#/print/challan/${id}`, target: '_blank' }, '🖨 Print Challan'));
      if (row.issue_no) A.push(h('a.btn', { href: `#/print/stockdoc/${row.issue_type || 'OUTWARD'}?doc=${encodeURIComponent(row.issue_no)}`, target: '_blank' }, '🖨 Issue Slip'));
      if (row.bom_id) A.push(h('a.btn', { href: `#/bom/${row.bom_id}` }, '📑 BOQ status'));
      if (row.boq_id) A.push(h('a.btn', { href: `#/boq/${row.boq_id}` }, '📂 Work order status'));
      if (can(entity) && st === 'Draft' && !hasFunction(state.user.role, 'stock_post')) A.push(h('span.muted', 'Draft: the store dispatches it (issues the stock)'));
      if (can(entity) && st === 'Draft' && hasFunction(state.user.role, 'stock_post')) A.push(h('button.btn.good', { onclick: go(async () => {
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
    case 'schedule_baselines':
    case 'schedule_activities':
      A.push(h('a.btn.primary', { href: `#/planner/${row.project_id}` }, '📅 Open the planner'));
      break;
    case 'projects':
      if (canView('schedule_activities', state.user.role)) A.push(h('a.btn.primary', { href: `#/planner/${id}` }, '📅 Planner (Gantt)'));
      A.push(h('a.btn', { href: `#/project-analysis/${id}` }, '📈 Purchase analysis'));
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
      A.push(h('a.btn', { href: `#/print/po/${id}`, target: '_blank', title: 'For the vendor: no project or site on it' }, '🖨 Print PO (vendor)'));
      A.push(h('a.btn', { href: `#/print/po/${id}?internal=1`, target: '_blank', title: 'With projects / sites and the split per project' }, '🖨 Internal copy'));
      if (st === 'Archived (old)') { A.push(h('span.muted', 'Old PO, kept to look up: not counted in payables, analysis or receipts')); break; }
      if (can(entity) && ['Draft', 'Rejected'].includes(st)) A.push(h('button.btn.primary', { onclick: submit }, 'Submit for Approval'));
      if (can(entity) && st === 'Approved') A.push(h('button.btn', { onclick: status('Sent') }, 'Mark as Sent'));
      if (can('stock_moves') && ['Approved', 'Sent', 'Partially Received'].includes(st)) A.push(h('a.btn.good', { href: `#/stock-entry?type=INWARD&po=${id}` }, '📦 Receive Goods (GRN)'));
      if (can(entity) && st === 'Partially Received') A.push(h('button.btn', { onclick: status('Closed', 'Close this PO even though some quantity is still pending?') }, 'Short-close'));
      if (can(entity) && ['Approved', 'Sent', 'Partially Received'].includes(st)) A.push(h('button.btn', { title: 'Change quantities, rates, terms or add items: back to Draft as the next revision, then the approvals again', onclick: go(async () => {
        const rec = (row.lines || []).some(l => Number(l.received) > 0);
        if (!(await confirmBox(`Revise PO ${row.po_no}? It goes back to Draft as Rev. ${(Number(row.revision) || 0) + 1}; after your changes, submit it for approval again.${rec ? ' Material already received stays on its lines (those lines cannot be removed or reduced below what came in); after approval the PO is Partially Received again.' : ''}`))) return;
        await post(`/purchase_orders/${id}/revise`); toast('Back to Draft for the revision'); reload();
      }) }, '↩ Revise PO'));
      if (can(entity) && st === 'Rejected') A.push(h('button.btn', { onclick: status('Draft') }, 'Back to Draft'));
      if (can(entity) && ['Draft', 'Approved', 'Sent', 'Rejected'].includes(st)) A.push(h('button.btn.danger', { onclick: status('Cancelled', 'Cancel this PO?') }, 'Cancel PO'));
      // Money on this PO: vendor bill, payment request (advance per terms / against a bill), debit note.
      if (['Approved', 'Sent', 'Partially Received', 'Received', 'Closed'].includes(st)) {
        if (can('vendor_bills')) A.push(h('button.btn', { onclick: () => newRecord('vendor_bills', { po_id: id }) }, '🧾 Vendor bill'));
        if (can('vendor_payments')) A.push(h('button.btn', { onclick: () => newRecord('vendor_payments', { po_id: id }) }, '💸 Payment request'));
        if (can('debit_notes')) A.push(h('button.btn', { onclick: () => newRecord('debit_notes', { po_id: id }) }, '↩️ Debit note'));
      }
      break;
    }
    case 'vendor_bills':
      if (row.po_id && can('vendor_payments') && row.status !== 'Paid') A.push(h('button.btn.primary', { onclick: () => newRecord('vendor_payments', { po_id: row.po_id, bill_id: id, kind: 'Against bill', amount: round2(row.balance) }) }, '💸 Pay this bill'));
      if (row.po_id && can('debit_notes')) A.push(h('button.btn', { onclick: () => newRecord('debit_notes', { po_id: row.po_id, bill_id: id }) }, '↩️ Debit note'));
      if (/^Bills /.test(row.match_note || '') && !row.override_by && hasFunction(state.user.role, 'pay_final')) A.push(h('button.btn', { onclick: go(async () => {
        const why = h('textarea', { rows: 3, placeholder: 'Why may this be paid although less material was received? (e.g. installation service, material delivered direct to site)' });
        if (!(await modal('Override the 3-way check (GM)', h('div.grid', h('p', row.match_note), h('label', 'Reason *', why)), [{ label: 'Cancel', value: false }, { label: 'Override', cls: 'danger solid', value: true }]))) return;
        await post(`/vendor_bills/${id}/override`, { reason: why.value }); toast('Override recorded'); reload();
      }) }, '✔ Override 3-way (GM)'));
      break;
    case 'vendor_payments':
    case 'expenses': {
      const st = row.status;
      const role = state.user.role;
      if (['Draft', 'Rejected'].includes(st) && can(entity)) A.push(h('button.btn.primary', { onclick: busy(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        if (entity === 'vendor_payments') {
          // Show the check against the PO before sending it for approval.
          const c = await api(`/vendor_payments/${id}/check`);
          if (c.blockers.length) { await modal('This payment cannot be submitted', h('ul', c.blockers.map(b => h('li', { style: { whiteSpace: 'pre-wrap' } }, b))), [{ label: 'OK', value: true }]); return; }
          const ok = await modal('Submit payment for approval', h('div.grid',
            h('ul', c.notes.map(n => h('li', n))),
            c.off_terms ? h('p', { style: { color: 'var(--bad)' } }, 'Outside the PO terms: the reason in “Why” is required, and the GM approves it too.') : null,
            h('p.muted', `Approval: Accounts${c.gm ? ' → GM' : ''}. It is paid (with UTR) only after approval.`)),
          [{ label: 'Cancel', value: false }, { label: '📤 Submit', cls: 'primary', value: true }]);
          if (!ok) return;
        }
        await post(`/${entity}/${id}/submit`);
        toast('Sent for approval'); window.dispatchEvent(new Event('approvals-changed')); reload();
      }) }, '📤 Submit for approval'));
      if (st === 'Approved' && hasFunction(role, 'pay_record')) A.push(h('button.btn.good', { onclick: go(async () => {
        const date = h('input', { type: 'date', value: today() });
        const mode = h('select', ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'DD', 'Other'].map(x => h('option', x))); mode.value = row.mode || 'NEFT / RTGS';
        const ref = h('input', { placeholder: 'UTR / cheque no' });
        const amt = row.net_amount ?? row.amount;
        if (!(await modal(`Mark ${row.payment_no || row.voucher_no} as paid – ₹ ${inr(amt)}`, h('div.grid',
          row.tds_amount ? h('p.muted', `Gross ₹ ${inr(row.amount)} − TDS ₹ ${inr(row.tds_amount)} = ₹ ${inr(amt)} to the ${entity === 'expenses' ? 'payee' : 'vendor'}`) : null,
          h('div.form-grid', h('label', 'Paid on', date), h('label', 'Mode', mode), h('label', 'UTR / Cheque No', ref)),
          h('p.muted', 'Attach the bank advice / payment screenshot below (📎) after saving.')), [{ label: 'Cancel', value: false }, { label: '💸 Paid', cls: 'good', value: true }]))) return;
        await post(`/${entity}/${id}/paid`, { date: date.value, mode: mode.value, reference: ref.value }); toast('Recorded as paid'); reload();
      }) }, '💸 Mark as paid'));
      if (st === 'Paid' && hasFunction(role, 'pay_final')) A.push(h('button.btn.danger', { onclick: go(async () => {
        const why = h('textarea', { rows: 3, placeholder: 'e.g. payment bounced / paid to wrong account / entered twice' });
        if (!(await modal('Reverse this payment?', h('div.grid', h('p', 'It stays in the history as Reversed and no longer counts as paid.'), h('label', 'Reason *', why)), [{ label: 'Cancel', value: false }, { label: '↩ Reverse', cls: 'danger solid', value: true }]))) return;
        await post(`/${entity}/${id}/reverse`, { reason: why.value }); toast('Reversed'); reload();
      }) }, '↩ Reverse (GM)'));
      break;
    }
    case 'invoices': {
      const st = row.status, tax = row.type === 'Tax Invoice', role = state.user.role;
      A.push(h('a.btn', { href: `#/print/invoice/${id}`, target: '_blank' }, st === 'Draft' ? '🖨 Preview' : '🖨 Print Invoice'));
      if (st === 'Draft' && can('invoices')) A.push(h('button.btn.primary', { onclick: busy(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        const r = await api(`/invoices/${id}`);
        const ok = await modal(`Issue this ${tax ? 'tax invoice' : 'proforma'}?`, h('div.grid',
          h('p', `₹ ${inr(r.total)} to ${r.customer_id_label || ''}, dated ${fmtDate(r.date)}.`),
          tax ? h('p.muted', `It gets the next invoice number and is locked: after this it is corrected only by a credit note.${Number(r.retention_pct) > 0 ? ` Retention ${r.retention_pct}% (₹ ${inr(r.total * r.retention_pct / 100)}) is held until the retention date.` : ''}`) : h('p.muted', 'Money received against it is recorded as an advance on the sales order.')),
          [{ label: 'Cancel', value: false }, { label: '✔ Issue', cls: 'primary', value: true }]);
        if (!ok) return;
        const out = await post(`/invoices/${id}/issue`); toast(`Issued ${out.invoice_no}`); reload();
      }) }, '✔ Issue invoice'));
      if (can('payments') && !['Draft', 'Cancelled', 'Paid'].includes(st) && row.balance > 0.5) {
        A.push(h('button.btn.good', { onclick: () => newRecord('payments', tax ? { kind: 'Against invoice', invoice_id: id, customer_id: row.customer_id, amount: round2(row.due_now > 0.5 ? row.due_now : row.balance) }
          : { kind: 'Advance (against sales order)', invoice_id: id, sales_order_id: row.sales_order_id, customer_id: row.customer_id, amount: round2(row.balance) }) }, tax ? '💰 Money received' : '💰 Advance received'));
      }
      if (tax && can('credit_notes') && !['Draft', 'Cancelled'].includes(st)) A.push(h('button.btn', { onclick: () => newRecord('credit_notes', { invoice_id: id }) }, '↩️ Credit note'));
      if (!['Draft', 'Cancelled'].includes(st) && hasFunction(role, 'pay_final')) A.push(h('button.btn.danger', { onclick: go(async () => {
        const why = h('textarea', { rows: 3, placeholder: 'e.g. raised on the wrong customer / duplicate' });
        if (!(await modal('Cancel this invoice (GM)?', h('div.grid', h('p', 'Only while nothing is received or credited on it. It stays in the register as Cancelled; its number is not reused.'), h('label', 'Reason *', why)),
          [{ label: 'Back', value: false }, { label: '✖ Cancel invoice', cls: 'danger solid', value: true }]))) return;
        await post(`/invoices/${id}/cancel`, { reason: why.value }); toast('Invoice cancelled'); reload();
      }) }, '✖ Cancel (GM)'));
      if (row.customer_id) A.push(h('a.btn', { href: `#/receivables/statement/${row.customer_id}` }, '📒 Statement'));
      break;
    }
    case 'payments': {
      const role = state.user.role;
      if (row.status === 'Received' && row.tds_amount > 0 && row.form16a !== 'Yes' && can('payments')) A.push(h('button.btn', { onclick: go(async () => {
        await post(`/payments/${id}/form16a`); toast('Form 16A marked received'); reload();
      }) }, '📄 Form 16A received'));
      if (row.status === 'Received' && hasFunction(role, 'pay_final')) A.push(h('button.btn.danger', { onclick: go(async () => {
        const why = h('textarea', { rows: 3, placeholder: 'e.g. cheque bounced / entered on the wrong invoice / entered twice' });
        if (!(await modal('Reverse this receipt?', h('div.grid', h('p', 'It stays in the history as Reversed and no longer counts against the invoice.'), h('label', 'Reason *', why)),
          [{ label: 'Back', value: false }, { label: '↩ Reverse', cls: 'danger solid', value: true }]))) return;
        await post(`/payments/${id}/reverse`, { reason: why.value }); toast('Reversed'); reload();
      }) }, '↩ Reverse (GM)'));
      if (row.customer_id) A.push(h('a.btn', { href: `#/receivables/statement/${row.customer_id}` }, '📒 Statement'));
      break;
    }
    case 'credit_notes':
      if (['Draft', 'Rejected'].includes(row.status) && can('credit_notes')) A.push(h('button.btn.primary', { onclick: busy(async () => {
        if (ctx.save) await ctx.save({ quiet: true });
        if (!(await confirmBox(`Send credit note of ₹ ${inr(row.total)} on ${row.invoice_id_label || 'the invoice'} to the GM for approval?`))) return;
        await post(`/credit_notes/${id}/submit`); toast('Sent to the GM'); window.dispatchEvent(new Event('approvals-changed')); reload();
      }) }, '📤 Submit to GM'));
      if (row.status === 'Approved') A.push(h('a.btn', { href: `#/print/creditnote/${id}`, target: '_blank' }, '🖨 Print Credit Note'));
      break;
    case 'items':
      if (can('stock_moves')) {
        A.push(h('a.btn', { href: `#/stock-entry?type=INWARD&item=${id}` }, '📥 Inward'));
        A.push(h('a.btn', { href: `#/stock-entry?type=OUTWARD&item=${id}` }, '📤 Issue'));
      }
      if (can('items') && hasFunction(state.user.role, 'stock_post')) A.push(h('button.btn', { title: 'This item was entered twice: move its stock and history to the other item and remove this one', onclick: go(async () => {
        const { itemPicker } = await import('./form.js');
        const all = (await api('/items?limit=20000')).filter(x => x.id !== Number(id));
        const opts = all.map(x => ({ id: x.id, label: `${x.code} · ${x.name}` }));
        const same = all.filter(x => String(x.name).trim().toLowerCase() === String(row.name).trim().toLowerCase());
        let into = same.length === 1 ? same[0].id : null;
        if (!(await modal(`Merge ${row.code} into another item`, h('div.grid',
          h('p', `${row.code} · ${row.name} (stock ${row.stock ?? 0} ${row.uom || ''}) is removed. Its stock movements, PO / requisition / challan / BOQ lines and opening stock move to the item you keep.`),
          same.length ? h('p.muted', `Same name: ${same.map(x => x.code).join(', ')}`) : null,
          h('label', 'Keep this item', itemPicker(opts, into, { onPick: x => { into = x; } }))),
          [{ label: 'Cancel', value: false }, { label: 'Merge', cls: 'danger solid', value: true }]))) return;
        if (!into) throw new Error('Choose the item to keep');
        const r = await post(`/items/${id}/merge`, { into });
        toast(`Merged into ${r.kept.code}: stock now ${r.stock}`); location.hash = `#/view/items/${r.kept.id}`;
      }) }, '🔗 Merge into another item'));
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

  // A sectioned form (ent.sectioned, e.g. enquiries): each 'section' field starts a card that opens and closes, with
  // its number, a short description, a one-line summary and how much is filled; a progress bar on top.
  const sectioned = !!ent.sectioned;
  const secs = [];
  let grid = h('div.form-grid'), target = grid;
  if (sectioned) grid = h('div.sec-form');
  for (const f of ent.fields) {
    if (f.hidden || f.type === 'json') continue;
    if (f.type === 'section' && sectioned && !f.sub) {
      const body = h('div.form-grid'), sum = h('span.sec-sum'), count = h('span.sec-count');
      const det = h('details.card.sec', { open: !f.collapsed }, h('summary', h('span.sec-no', String(secs.length + 1)), h('span.sec-head', h('span.sec-title', f.label), sum), count),
        f.hint ? h('p.sec-hint', f.hint) : null, body);
      secs.push({ f, det, body, sum, count, keys: [] });
      grid.append(det);
      target = body;
      continue;
    }
    if (f.type === 'section') { target.append(h('div.span-all.sub-head', { style: { borderTop: '1px solid var(--border)', marginTop: '10px', paddingTop: '10px' } }, h('div', { style: { fontWeight: 700, fontSize: f.sub ? '14px' : '15px' } }, f.label), f.hint ? h('div.muted', { style: { fontSize: '12.5px', marginTop: '2px' } }, f.hint) : null)); continue; }
    if (isNew && (f.readonly || f.computed) && row[f.key] == null) continue;
    secs.at(-1)?.keys.push(f.key);
    if (f.type === 'lines') {
      const ed = linesEditor(f, row[f.key], {
        readonly: !writable,
        onTotals: t => { for (const k of ['subtotal', 'tax', 'round_off', 'total', 'gst_label']) if (inputs[k] && t[k] !== undefined) inputs[k].el.value = t[k]; },
        // PO charges and their GST %, read live from the form.
        extras: f.poTotals ? () => Object.fromEntries([...PO_CHARGES.map(([k]) => k), 'other_charges_label', 'charges_gst'].map(k => [k, inputs[k]?.get?.() ?? row[k]])) : null,
      });
      inputs[f.key] = ed;
      target.append(h('div.span-all', h('label', f.label), ed.el));
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
    target.append(lbl);
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
  // Sectioned form: summary line and "filled" count per section (its summary fields count as the key data), progress on top.
  let progress = null;
  if (sectioned) {
    const fm = Object.fromEntries(ent.fields.map(f => [f.key, f]));
    const valOf = k => (inputs[k] ? inputs[k].get() : row[k]);
    const has = v => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');
    const show = (k, v) => (Array.isArray(v) ? (fm[k].type === 'lines' ? `${v.length} row(s)` : v.join(', ')) : fm[k].type === 'yn' ? `${fm[k].label}: ${v}` : fm[k].type === 'date' ? fmtDate(v) : String(v));
    for (const s of secs.filter(s => !s.body.childElementCount)) { s.det.remove(); secs.splice(secs.indexOf(s), 1); }
    secs.forEach((s, i) => { s.det.querySelector('.sec-no').textContent = String(i + 1); });
    const bar = h('div.progress-fill'), txt = h('span');
    progress = h('div.card.sec-progress', h('div.progress-row', h('b', 'Form progress'), txt), h('div.progress', { role: 'progressbar', 'aria-label': 'Form progress' }, bar));
    const refresh = () => {
      let done = 0, counted = 0;
      for (const s of secs) {
        const keys = s.keys.filter(k => !fm[k].readonly || has(valOf(k)));
        const key = (s.f.summary || keys).filter(k => s.keys.includes(k));
        const filled = keys.filter(k => has(valOf(k))).length;
        s.count.textContent = keys.length ? `${filled} / ${keys.length}` : '';
        const shown = (s.f.summary || []).filter(k => s.keys.includes(k) && has(valOf(k))).map(k => show(k, valOf(k)));
        s.sum.textContent = shown.length ? shown.join(' · ') : (s.f.summary ? 'Not filled in' : '');
        if (!key.length) continue;
        counted++;
        const ok = key.every(k => has(valOf(k)));
        if (ok) done++;
        s.det.classList.toggle('sec-done', ok);
      }
      const pct = counted ? Math.round((done / counted) * 100) : 0;
      bar.style.width = `${pct}%`;
      progress.querySelector('[role=progressbar]').setAttribute('aria-valuenow', String(pct));
      txt.textContent = `${done} of ${counted} sections complete`;
    };
    grid.addEventListener('input', refresh);
    grid.addEventListener('change', refresh);
    grid.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(refresh); });
    refresh();
  }
  if (entity === 'items' && isNew && inputs.code && inputs.category) {
    const showNext = () => api(`/items/next-code?category=${encodeURIComponent(inputs.category.get() || '')}`).then(r => { inputs.code.el.placeholder = `${r.code} (given automatically)`; }).catch(() => {});
    inputs.category.el.addEventListener('change', showNext);
    showNext();
  }
  if (entity === 'purchase_orders' && inputs.lines?.refresh) {
    // Charges change the totals at once.
    for (const k of [...PO_CHARGES.map(([k]) => k), 'other_charges_label', 'charges_gst']) inputs[k]?.el.addEventListener('input', () => inputs.lines.refresh());
    inputs.lines.refresh();
  }
  if (entity === 'purchase_orders' && writable && isNew && inputs.vendor_id) {
    // New PO: choosing the vendor brings the terms of its last PO (payment, delivery, warranty …) and its contact person.
    inputs.vendor_id.el.addEventListener('change', async () => {
      const vid = inputs.vendor_id.get();
      if (!vid) return;
      const t = await api(`/purchase_orders/last-terms?vendor_id=${vid}`).catch(() => null);
      if (!t) return;
      for (const k of ['vendor_contact', 'vendor_phone']) if (t[k] && inputs[k] && !inputs[k].get()) inputs[k].set(t[k]);
      if (!t.from_po) return;
      for (const k of ['term_advance', 'term_balance', 'term_delivery', 'term_warranty', 'term_freight', 'term_validity', 'term_invoice', 'term_jurisdiction', 'terms', 'charges_gst']) if (t[k] != null && t[k] !== '' && inputs[k]) inputs[k].set(t[k]);
      if (t.payment_schedule?.length && inputs.payment_schedule && !(inputs.payment_schedule.get() || []).length) inputs.payment_schedule.set(t.payment_schedule);
      inputs.lines?.refresh?.();
      toast(`Terms copied from this vendor's last PO ${t.from_po}. Change them if this quotation says otherwise.`);
    });
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
    // Format and range checks given in the schema (e.g. PIN Code 6 digits, RH 40–60 %); the server checks them again.
    for (const f of ent.fields.filter(f => f.key in body && body[f.key] != null && body[f.key] !== '')) {
      if (f.pattern && !new RegExp(`^(?:${f.pattern})$`).test(String(body[f.key]).trim())) throw new Error(`${f.label}: ${f.hint || 'the value is not correct.'}`);
      if ((f.min != null && body[f.key] < f.min) || (f.max != null && body[f.key] > f.max)) throw new Error(`${f.label}: use a value ${f.max != null ? `from ${f.min ?? 0} to ${f.max}` : `of ${f.min} or more`}.`);
    }
    if (entity === 'enquiries' && body.rh_min != null && body.rh_max != null && body.rh_min > body.rh_max) throw new Error('RH: the minimum must not be more than the maximum.');
    const wasNew = isNew;
    const saved = isNew
      ? await api(`/${entity}`, { method: 'POST', body })
      : await api(`/${entity}/${id}`, { method: 'PUT', body });
    keep.drop();
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
  const keep = keepUnsaved(entity, ent, isNew ? 'new' : id, row, inputs, writable, () => { inputs.lines?.refresh?.(); applyShowIf(); });
  grid.addEventListener('input', keep.touch);
  grid.addEventListener('change', keep.touch);
  const r = row;
  const title = isNew ? `New ${ent.singular}` : `${ent.singular}: ${r.enquiry_no || r.quote_no || r.so_no || r.po_no || r.req_no || r.challan_no || r.bom_no || r.boq_no || r.invoice_no || r.receipt_no || r.cn_no || (['invoices', 'credit_notes'].includes(entity) && r.status === 'Draft' ? 'draft #' + r.id : null) || r.order_no || r.plan_no || r.report_no || r.qc_no || r.ncr_no || r.ticket_no || r.submittal_no || r.doc_no || r.project_no || r.code || r.name || r.doc_ref || fmtDate(r.date) || '#' + r.id}${entity === 'items' && r.name ? ' · ' + r.name : ''}`;
  const statusVal = ent.statusField && r[ent.statusField];
  root.replaceChildren(
    h('div.page-head',
      h('a.btn.small', { href: `#/list/${entity}` }, '‹ Back'),
      h('h1', `${ent.icon} ${title}`), statusVal ? badge(statusVal) : null,
      r.approval_stage ? h('span.badge.warn', `waiting: ${r.approval_stage}`) : null,
      locked ? h('span.muted', '🔒 locked') : null,
      h('div.actions',
        isNew ? [] : actionsFor(entity, r, () => recordView(root, entity, id), { save: writable ? save : null }),
        // A new work location: fill its position from the phone standing at the site, then save.
        isNew && entity === 'work_locations' && writable ? h('button.btn', { title: 'Stand at the centre of the site and press this', onclick: busy(async () => {
          if (!window.isSecureContext || !navigator.geolocation) throw new Error('Location works only on the https address of the CRM (open it on the phone through the https link)');
          const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(x => res(x.coords), e => rej(new Error(e.code === 1 ? 'Location is blocked: allow location for this site in the browser settings' : 'No GPS fix: step outside and try again')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
          inputs.lat.el.value = p.latitude.toFixed(6); inputs.lng.el.value = p.longitude.toFixed(6);
          if (inputs.maps_link) inputs.maps_link.el.value = '';
          toast(`Position filled (±${Math.round(p.accuracy)} m): enter the name and save`);
        }) }, '📍 Use my location here') : null,
        writable ? h('button.btn.primary', { onclick: busy(() => save()) }, '💾 Save') : null,
        !isNew && mayDelete(entity, r) ? h('button.btn.danger', { onclick: busy(remove) }, '🗑 Delete') : null)),
    keep.el,
    !isNew && entity === 'approvals' && APPROVAL_DOCS[r.doc_type] ? approvalDoc(r, () => recordView(root, entity, id)) : null,
    !isNew && entity === 'purchase_orders' ? approvalStrip('Purchase Order', r) : null,
    !isNew && entity === 'purchase_orders' && r.requisition_id ? requisitionCard(r.requisition_id) : null,
    !isNew && entity === 'purchase_orders' ? commercialPanel(r, () => recordView(root, entity, id)) : null,
    !isNew && entity === 'items' ? itemSummary(r.id) : null,
    progress,
    sectioned ? grid : h('div.card', grid),
    isNew ? null : h('div.muted', { style: { fontSize: '12px', marginBottom: '12px' } },
      `Created ${r.created_at || ''} by ${r.created_by || '-'}${r.updated_at ? ` · last updated ${r.updated_at}` : ''}`),
    isNew ? (writable ? newFiles.el : null) : attachments(entity, r.id, canWrite(entity, state.user.role)),
    isNew ? null : related(entity, r),
    isNew || !hasFunction(state.user.role, 'view_audit') ? null : changeHistory(entity, id),
  );
  // Ctrl+S saves
  root.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && writable) { e.preventDefault(); if (!e.repeat) save().catch(fail); } };
}

// ---------------------------------------------------------------- the document inside its approval request
const APPROVAL_DOCS = { Quotation: 'quotations', 'Purchase Order': 'purchase_orders', Requisition: 'requisitions', 'Sales Order': 'sales_orders', Payment: 'vendor_payments',
  Expense: 'expenses', Leave: 'leave_requests', 'Schedule Baseline': 'schedule_baselines', 'Credit Note': 'credit_notes', Confirmation: 'probation_reviews', 'Production Plan': 'production_plans' };
const shown = (f, v, row) => {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  if (f.type === 'ref') return row[f.key + '_label'] || `#${v}`;
  if (f.type === 'money') return money(v);
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'yn') return v === 'Yes' || v === true ? 'Yes' : 'No';
  return typeof v === 'object' ? null : String(v);
};
function approvalDoc(ap, reload) {
  const entity = APPROVAL_DOCS[ap.doc_type];
  const ent = ENTITIES[entity];
  const box = h('div.card', h('p.muted', `Loading ${ap.doc_type} …`));
  api(`/${entity}/${ap.doc_id}`).then(doc => {
    const skip = new Set(['status', 'approval_stage', 'notes_internal']);
    const info = ent.fields.filter(f => !f.hidden && f.type !== 'lines' && f.type !== 'json' && !skip.has(f.key)).map(f => [f.label, shown(f, doc[f.key], doc), f]).filter(x => x[1]);
    const long = info.filter(([, v, f]) => f.type === 'textarea' || String(v).length > 60);
    const short = info.filter(x => !long.includes(x));
    const linesFields = ent.fields.filter(f => f.type === 'lines' && Array.isArray(doc[f.key]) && doc[f.key].some(l => l.description || l.item_id || Number(l.qty)));
    const table = f => {
      const cols = f.columns.filter(c => doc[f.key].some(l => l[c.key] != null && l[c.key] !== ''));
      const amounts = f.amounts !== false && cols.some(c => c.key === 'rate');
      return h('div', { style: { marginTop: '10px' } }, h('b', f.label), h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', '#'), f.itemRef ? h('th', 'Item') : null, cols.map(c => h('th', c.label)), amounts ? h('th.num', 'Amount') : null)),
        h('tbody', doc[f.key].filter(l => l.description || l.item_id || Number(l.qty)).map((l, i) => h('tr', h('td.muted', i + 1), f.itemRef ? h('td', l.item_id_label || '') : null,
          cols.map(c => h('td', { style: { whiteSpace: c.type === 'textarea' ? 'pre-wrap' : '', fontSize: c.type === 'textarea' ? '12px' : '' } },
            c.type === 'ref' ? (c.split && l.split?.length > 1 ? l.site : l[c.key + '_label'] || (l[c.key] ? `#${l[c.key]}` : '')) : c.type === 'money' ? inr(l[c.key]) : l[c.key] ?? '')),
          amounts ? h('td.num', inr((Number(l.qty) || 0) * (Number(l.rate) || 0))) : null))))));
    };
    box.replaceChildren(
      h('h2', { style: { marginTop: 0 } }, `${ent.icon} ${ap.doc_type} ${ap.doc_ref || ''}`, ' ', badge(doc.status), doc.approval_stage ? h('span.badge.warn', { style: { marginLeft: '6px' } }, `waiting: ${doc.approval_stage}`) : null),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px 18px' } },
        short.map(([k, v]) => h('div', h('div.muted', { style: { fontSize: '11px' } }, k), h('div', { style: { fontWeight: 500 } }, v)))),
      long.length ? h('div', { style: { marginTop: '8px' } }, long.map(([k, v]) => h('div', { style: { marginTop: '4px' } }, h('span.muted', { style: { fontSize: '11px' } }, k + ': '), h('span', { style: { whiteSpace: 'pre-wrap' } }, v)))) : null,
      linesFields.map(table));
    const extra = [];
    if (entity === 'purchase_orders') {
      extra.push(approvalStrip('Purchase Order', doc));
      if (doc.requisition_id) extra.push(requisitionCard(doc.requisition_id));
      extra.push(commercialPanel(doc, reload));
    }
    box.after(...extra.filter(Boolean), attachments(entity, doc.id, false));
  }).catch(e => box.replaceChildren(h('p', ap.title || ''), h('p.muted', `(The ${ap.doc_type} itself is not open to your role: ${e.message})`)));
  return box;
}

// The requisition a PO was made from, in full, inside the PO (no need to open it).
function requisitionCard(reqId) {
  const box = h('details.card', { open: true }, h('summary', h('b', '📝 Requisition'), ' loading…'));
  api(`/requisitions/${reqId}`).then(r => {
    const lines = (r.lines || []).filter(l => l.description || l.item_id || Number(l.qty));
    const info = [['Date', fmtDate(r.date)], ['Project', r.project_id_label || r.project_name], ['Requested by', r.requested_by], ['Department', r.department], ['Required by', fmtDate(r.required_by)],
      ['Approved by', r.approved_by], ['Remarks', r.remarks]].filter(x => x[1]);
    box.replaceChildren(h('summary', h('b', `📝 Requisition ${r.req_no}`), ' ', badge(r.status), ' ', h('a', { href: `#/view/requisitions/${r.id}`, style: { fontWeight: 400, marginLeft: '8px' } }, 'open ›')),
      h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', margin: '8px 0' } }, info.map(([k, v]) => h('div', h('div.muted', { style: { fontSize: '11px' } }, k), h('div', v)))),
      lines.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['#', 'Material', 'Specification', 'Qty', 'UOM', 'Site / project', 'Remark'].map(x => h('th', x)))),
        h('tbody', lines.map((l, i) => h('tr', h('td.muted', i + 1), h('td', l.description || l.item_id_label || ''), h('td', { style: { whiteSpace: 'pre-wrap', fontSize: '12px' } }, l.spec || ''),
          h('td.num', l.qty ?? ''), h('td', l.uom || ''), h('td', l.site || l.project_id_label || ''), h('td', l.remark || '')))))) : h('p.muted', 'No materials on it.'));
  }).catch(e => box.replaceChildren(h('summary', `📝 Requisition: ${e.message}`)));
  return box;
}

// ---------------------------------------------------------------- unsaved changes kept while typing
// What is typed in a form is kept in this browser every second (a refresh, a closed tab or an expired login does not
// lose a half-filled PO); opening the form again offers it back. Saving or "Discard" clears it.
function keepUnsaved(entity, ent, recId, row, inputs, writable, after) {
  const query = recId === 'new' ? new URLSearchParams(location.hash.split('?')[1] || '').toString() : '';
  const key = `wiespl-unsaved:${state.user?.username || state.user?.name}:${entity}:${recId}${query ? '?' + query : ''}`;
  const el = h('div');
  const collect = () => Object.fromEntries(ent.fields.filter(f => inputs[f.key] && !f.readonly && !f.computed).map(f => [f.key, inputs[f.key].get()]));
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const drop = () => { try { localStorage.removeItem(key); } catch { /* private window */ } el.replaceChildren(); };
  let timer = null;
  const touch = () => {
    if (!writable) return;
    clearTimeout(timer);
    timer = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify({ at: new Date().toLocaleString('sv-SE').slice(0, 19), data: collect() })); } catch { /* storage full or blocked */ } }, 1000);
  };
  const d = writable && read();
  const old = d && (Date.now() - Date.parse(String(d.at).replace(' ', 'T')) > 14 * 864e5 || (row.updated_at && d.at < row.updated_at));
  if (old) drop();
  else if (d && JSON.stringify(d.data) !== JSON.stringify(collect())) {
    const n = Array.isArray(d.data.lines) ? d.data.lines.filter(l => l.description || l.item_id || Number(l.qty)).length : 0;
    el.append(h('div.card', { style: { borderLeft: '4px solid var(--warn)', borderRadius: 0, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', `💾 You have unsaved changes to this ${ent.singular.toLowerCase()} from ${fmtDate(d.at.slice(0, 10))} ${d.at.slice(11, 16)}${n ? ` (${n} line${n === 1 ? '' : 's'})` : ''}.`),
      h('button.btn.small.primary', { onclick: () => { for (const [k, v] of Object.entries(d.data)) inputs[k]?.set?.(v); after(); el.replaceChildren(); toast('Unsaved changes brought back: check them and press Save'); } }, '↩ Restore'),
      h('button.btn.small', { onclick: drop }, 'Discard')));
  }
  return { el, touch, drop };
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
      h('td.nowrap', /\.(dwg|dxf)$/i.test(a.filename) ? h('a.btn.small.primary', { href: `#/plan3d/${a.id}?n=${encodeURIComponent(a.filename)}`, title: 'Show this CAD drawing in 3D' }, '🧊 3D') : null, h('a.btn.small', { href: `/api/files/${a.id}` }, '⬇ Download'),
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
