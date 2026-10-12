// Store screens: multi-line stock entry, stock summary, PO line tracker.
import { h, api, state, toast, fail, modal, confirmBox, refOptions, clearRefCache, money, fmtDate, today, download, badge, busy } from '../ui.js';
import { MOVE_TYPES, ITEM_CATEGORIES, canWrite, canView, hasFunction } from '../schema.js';
import { inr, round2, fyOf } from '../calc.js';
import { itemPicker, bomRows } from './form.js';

const qs = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const ENTRY_TYPES = ['INWARD', 'OUTWARD', 'TRANSFER', 'RETURN', 'SCRAP', 'ADJUST'];
const TITLES = { INWARD: '📥 Inward (GRN)', OUTWARD: '📤 Issue / Outward', TRANSFER: '🔀 Material Transfer', RETURN: '↩️ Return Material', SCRAP: '🗑️ Scrap', OPENING: '🏁 Opening Stock', ADJUST: '⚖️ Adjustment' };
const field = (label, el, hint) => h('label', label, hint ? h('span.hint', hint) : null, el);
const suggest = (list, attrs = {}) => {
  const id = 'sg-' + Math.random().toString(36).slice(2);
  return h('span', { style: { display: 'contents' } }, h('input', { list: id, ...attrs }), h('datalist', { id }, list.map(v => h('option', { value: v }))));
};

// What has come in against a PO so far, line by line (✓ = fully received).
function poStatus(po) {
  let heading = '';
  const rows = (po.lines || []).map(l => {
    if (l.description) heading = l.description;
    const qty = Number(l.qty) || 0;
    if (!qty) return null;
    const rec = Number(l.received) || 0, pend = round2(Math.max(0, qty - rec));
    return h('tr', h('td', { style: { color: pend ? 'var(--muted)' : 'var(--good)', fontSize: '16px' } }, pend ? (rec ? '◐' : '○') : '✓'),
      h('td', [l.description || heading, !l.description && l.spec ? String(l.spec).split('\n')[0] : ''].filter(Boolean).join(' – ')),
      h('td', l.uom || ''), h('td.num', qty), h('td.num', rec), h('td.num', { style: { fontWeight: 600, color: pend ? 'var(--warn)' : '' } }, pend));
  }).filter(Boolean);
  return h('div.card', h('h2', `PO ${po.po_no} – ${po.vendor_id_label || ''}: received so far`, ' ', badge(po.status)),
    h('table.data', h('thead', h('tr', ['', 'Item', 'UOM', 'Ordered', 'Received', 'Pending'].map((x, i) => h('th' + (i >= 3 ? '.num' : ''), x)))), h('tbody', rows)),
    h('p.muted', { style: { fontSize: '12px', margin: '6px 0 0' } }, 'Lines still pending are pre-filled below with the pending quantity. Change the quantities to what actually arrived.'));
}

// ---------------------------------------------------------------- Stock entry (one slip, many items)
export async function stockEntryView(root) {
  const p = qs();
  let type = ENTRY_TYPES.includes(p.type) ? p.type : 'OUTWARD';
  const [items, vendors, projects, allPos, boqOpts, bomOpts] = await Promise.all([api('/items?limit=20000'), refOptions('vendors'), refOptions('projects'),
    canView('purchase_orders', state.user.role) ? api('/purchase_orders').catch(() => []) : [],
    canView('boqs', state.user.role) ? api('/boqs?status=Open').then(r => r.map(b => ({ id: b.id, label: `${b.boq_no} · ${b.title}` }))).catch(() => []) : [],
    canView('boms', state.user.role) ? api('/boms').then(r => r.filter(b => b.status !== 'Completed').map(b => ({ id: b.id, label: `${b.bom_no} · ${b.client || ''}` }))).catch(() => []) : []]);
  const openPos = allPos.filter(x => ['Approved', 'Sent', 'Partially Received'].includes(x.status)).map(x => ({ id: x.id, label: `${x.po_no} · ${x.vendor_id_label || ''}` }));
  const itemById = new Map(items.map(i => [i.id, i]));
  const itemOpts = items.map(i => ({ id: i.id, label: `${i.code} · ${i.name}` }));
  const header = {};
  let lines = [];
  let po = null;
  let boq = null;
  let bom = null;
  let makeChallan = false;
  // Pending material of the chosen work order / BOQ: offered as suggestions on each line, nothing is filled in by itself.
  const pendingOpts = [];
  const ch = {}; // delivery challan details (ship-to address, vehicle …)

  if (p.po) {
    po = await api(`/purchase_orders/${p.po}`);
    type = 'INWARD';
    Object.assign(header, { po_id: po.id, vendor_id: po.vendor_id, project_id: po.project_id });
    let heading = '';
    po.lines.forEach((l, i) => {
      if (l.description) heading = l.description;
      const pending = round2((Number(l.qty) || 0) - (Number(l.received) || 0));
      if (!(Number(l.qty) > 0) || pending <= 0) return;
      lines.push({ item_id: l.item_id || null, qty: pending, rate: l.rate, po_line: i, note: [l.description || heading, !l.description && l.spec ? String(l.spec).split('\n')[0] : ''].filter(Boolean).join(' – '), ordered: l.qty, received: l.received || 0, gst: l.gst, hsn: l.hsn });
    });
  }
  if (p.boq) {
    type = 'OUTWARD';
    boq = await api(`/boqs/${p.boq}`);
    Object.assign(header, { boq_id: boq.id, project_id: boq.project_id });
    const boqRows = (await api(`/boq_items?boq_id=${boq.id}&limit=20000`)).sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id));
    for (const b of boqRows) {
      if (b.kind === 'Heading' || ['Dispatched', 'Delivered'].includes(b.delivery_status)) continue;
      const note = `${b.section} ${b.sr_no || ''} – ${[b.heading, String(b.description).split('\n')[0]].filter(Boolean).join(' › ').slice(0, 110)}`;
      pendingOpts.push({ id: b.id, label: `${note} · pending ${b.pending ?? 'qty TBD'} ${b.uom || ''}`, item_id: b.item_id || null, pending: b.pending, uom: b.uom, note });
    }
    if (!pendingOpts.length) toast('Everything in this work order has already been sent');
  }
  if (p.bom) {
    type = 'OUTWARD';
    bom = await api(`/boms/${p.bom}`);
    Object.assign(header, { bom_id: bom.id, project_id: bom.project_id });
    for (const b of bomRows(await api(`/bom_items?bom_id=${bom.id}&limit=20000`))) {
      if (!(b.pending > 0)) continue;
      const note = `${b.section || ''} ${b.sr_no || ''} – ${[b.component_name, b.dimensions].filter(Boolean).join(' ').slice(0, 110)}`;
      pendingOpts.push({ id: b.id, label: `${note} · pending ${b.pending} ${b.uom || ''}`, item_id: b.item_id || null, pending: b.pending, uom: b.uom, note });
    }
    if (!pendingOpts.length) toast('Everything in this BOQ has already been sent');
  }
  if (p.item) lines.push({ item_id: Number(p.item), qty: '' });
  if (p.project) header.project_id = Number(p.project);
  if (p.vendor) header.vendor_id = Number(p.vendor);
  if (!lines.length) lines.push({ item_id: null, qty: '' });

  // Line picker: type part of the material and choose from what is still pending on the BOQ / work order.
  const linkKey = () => (bom ? 'bom_item_id' : 'boq_item_id');
  function materialPicker(l) {
    const used = new Set(lines.filter(x => x !== l).map(x => x[linkKey()]).filter(Boolean));
    const opts = pendingOpts.filter(o => !used.has(o.id));
    return h('span', { style: { display: 'contents' } }, itemPicker(opts, l[linkKey()] || null, { onPick: id => {
      const o = pendingOpts.find(x => x.id === id);
      l[linkKey()] = o ? o.id : null;
      if (o) Object.assign(l, { item_id: l.item_id || o.item_id, qty: o.pending ?? l.qty, uom: o.uom, boqPending: o.pending });
      render();
    } }), l[linkKey()] && l.boqPending != null ? h('div.muted', { style: { fontSize: '12px' } }, `pending ${l.boqPending} ${l.uom || ''}`) : null,
    !pendingOpts.length ? h('div.muted', 'nothing pending') : null);
  }

  function headerFields() {
    const v = (k, el) => { el.value = header[k] ?? ''; el.oninput = el.onchange = () => { header[k] = el.value; }; return el; };
    const sv = (k, list) => { const w = suggest(list); v(k, w.firstChild); return w; };
    const pick = (k, opts, label) => field(label, itemPicker(opts, header[k] ? Number(header[k]) : null, { onPick: id => { header[k] = id; } }));
    const date = v('date', h('input', { type: 'date' }));
    if (!header.date) { header.date = type === 'OPENING' ? `20${fyOf(today()).slice(0, 2)}-04-01` : today(); date.value = header.date; }
    const F = [field('Date *', date), field({ INWARD: 'GRN No', OUTWARD: 'Issue No', TRANSFER: 'Transfer No', RETURN: 'Return No', SCRAP: 'Scrap No' }[type] || 'Doc No', v('doc_no', h('input', { placeholder: 'Auto (001/2026-27)' })))];
    if (type === 'INWARD') {
      // Choosing a PO reloads the slip with that PO's pending lines.
      F.push(field('Against PO', itemPicker(openPos, po?.id ?? null, { onPick: id => { location.hash = id ? `#/stock-entry?type=INWARD&po=${id}` : '#/stock-entry?type=INWARD'; } }), 'approved POs with material pending'));
      F.push(pick('vendor_id', vendors, 'Supplier'), field('Supplier name (if not in list)', v('supplier', h('input'))),
        field('Supplier Invoice No', v('invoice_no', h('input'))), field('Invoice Date', v('invoice_date', h('input', { type: 'date' }))));
      if (!po) F.push(field('PO No (text)', v('po_no', h('input', { placeholder: 'e.g. 020/2026-27 or Verbal' }))));
    }
    if (type === 'OUTWARD' && !boq && bomOpts.length) F.push(field('Against BOQ (makes the delivery challan)', itemPicker(bomOpts, bom?.id ?? null, { onPick: id => { location.hash = id ? `#/stock-entry?type=OUTWARD&bom=${id}` : '#/stock-entry?type=OUTWARD'; } }), 'components still to send are listed below'));
    if (type === 'OUTWARD' && !bom && boqOpts.length) F.push(field('Against Work Order (makes the delivery challan)', itemPicker(boqOpts, boq?.id ?? null, { onPick: id => { location.hash = id ? `#/stock-entry?type=OUTWARD&boq=${id}` : '#/stock-entry?type=OUTWARD'; } }), 'pending work order material is listed below'));
    if (['OUTWARD', 'TRANSFER'].includes(type) && !boq && !bom) {
      const box = h('input', { type: 'checkbox', checked: makeChallan, style: { width: 'auto' }, onchange: e => { makeChallan = e.target.checked; ch.challan_type ||= type === 'TRANSFER' ? 'Returnable' : 'Non-Returnable'; render(); } });
      F.push(h('label.span-2', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600 } }, box, `Also make a delivery challan (issue slip and challan are both printed)`));
    }
    if (boq || bom || makeChallan) {
      const cv = (k, el) => { el.value = ch[k] ?? ''; el.oninput = el.onchange = () => { ch[k] = el.value; }; return el; };
      F.push(h('label.span-2', 'Ship to (address on the challan)', h('span.hint', 'leave blank to use the project site address'), cv('ship_to', h('textarea', { rows: 3, placeholder: 'Hospital / site name\nAddress\nCity' }))),
        field('Site contact / phone', cv('site_contact', h('input'))), field('Vehicle No', cv('vehicle_no', h('input', { placeholder: 'MH14 AB 1234' }))),
        field('Transporter', cv('transporter', h('input'))), field('LR / Docket No', cv('lr_no', h('input'))), field('Driver', cv('driver', h('input', { placeholder: 'name / phone' }))),
        field('E-way Bill No', cv('eway_bill', h('input'))));
      if (makeChallan) F.push(field('Challan type', cv('challan_type', h('select', ['Non-Returnable', 'Returnable'].map(x => h('option', x))))));
    }
    if (['OUTWARD', 'RETURN', 'TRANSFER', 'SCRAP'].includes(type)) F.push(pick('project_id', projects, 'Project'));
    if (['OUTWARD', 'RETURN', 'SCRAP'].includes(type)) F.push(field(type === 'RETURN' ? 'Returned from (site / department)' : 'Issued to (site / department)', v('issued_to', h('input', { placeholder: 'e.g. D.Y Patil Pune, Production, BGM' }))));
    if (['OUTWARD', 'TRANSFER'].includes(type)) F.push(field('Requested By', sv('requested_by', state.people.map(x => x.name))), field('Purpose', v('purpose', h('input'))));
    if (type === 'TRANSFER') F.push(field('From', sv('from_location', ['Store', 'Production'])), field('To *', sv('to_location', ['Production', 'VRS Engineering', 'Shree Perforater', 'Site'])));
    if (type === 'RETURN') F.push(field('Original Issue No', v('against_issue_no', h('input'))));
    if (['RETURN', 'SCRAP', 'ADJUST'].includes(type)) F.push(field('Reason', sv('reason', type === 'SCRAP' ? ['Rusting', 'Expiry', 'Faulty', 'Cut', 'Damaged'] : ['Faulty', 'Rework', 'Excess', 'Physical count'])));
    F.push(h('label.span-2', 'Remarks', v('remarks', h('input'))));
    if (type === 'TRANSFER' && !header.from_location) header.from_location = 'Store';
    return F;
  }

  const body = h('div');
  function render() {
    const priced = ['INWARD', 'OPENING'].includes(type);
    const totalValue = h('b');
    const recalc = () => { totalValue.textContent = money(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate ?? itemById.get(l.item_id)?.rate) || 0), 0)); };
    const rows = lines.map((l, i) => {
      const it = itemById.get(l.item_id);
      const stockCell = h('td.num', it ? `${round2(it.stock)} ${it.uom || ''}` : '');
      const short = () => ['OUTWARD', 'TRANSFER', 'SCRAP'].includes(type) && it && Number(l.qty) > it.stock;
      const qty = h('input', { type: 'number', step: 'any', value: l.qty ?? '', style: { width: '90px' } });
      const rate = h('input', { type: 'number', step: 'any', value: l.rate ?? '', placeholder: 'required', style: { width: '110px' } });
      const value = h('td.num');
      const upd = () => {
        value.textContent = inr((Number(l.qty) || 0) * (Number(l.rate ?? it?.rate) || 0));
        qty.style.borderColor = short() ? 'var(--bad)' : '';
        qty.title = short() ? `Only ${round2(it.stock)} in stock` : '';
        recalc();
      };
      qty.oninput = () => { l.qty = qty.value === '' ? '' : Number(qty.value); upd(); };
      rate.oninput = () => { l.rate = rate.value === '' ? null : Number(rate.value); upd(); };
      upd();
      return h('tr',
        h('td.muted', i + 1),
        (boq || bom) ? h('td', { style: { minWidth: '280px' } }, materialPicker(l)) : null,
        h('td', itemPicker(itemOpts, l.item_id, { onPick: id => { l.item_id = id; if (!priced) l.rate = null; render(); } }),
          l.note ? h('div.muted', { style: { fontSize: '12px' } }, `PO: ${l.note} (ordered ${l.ordered}, received ${l.received})`) : null,
          null),
        stockCell, h('td', qty), priced ? h('td', rate) : null, priced ? value : null,
        h('td', h('input', { value: l.remark || '', placeholder: 'remark', oninput: e => { l.remark = e.target.value; } })),
        h('td', h('button.icon-btn.del', { title: 'Remove', onclick: () => { lines.splice(i, 1); if (!lines.length) lines.push({ item_id: null, qty: '' }); render(); } }, '✕')));
    });
    body.replaceChildren(
      h('div.card', h('div.form-grid', headerFields())),
      po && type === 'INWARD' ? poStatus(po) : null,
      h('div.card.flush', h('div.table-wrap', h('table.data.lines',
        h('thead', h('tr', h('th', '#'), (boq || bom) ? h('th', `${bom ? 'BOQ' : 'Work order'} material being sent *`) : null, h('th', (boq || bom) ? 'Store item *' : 'Item *'), h('th.num', 'In stock'), h('th', type === 'ADJUST' ? 'Qty (+/-) *' : 'Qty *'), priced ? h('th', 'Price / piece *') : null, priced ? h('th.num', 'Value') : null, h('th', 'Remark'), h('th'))),
        h('tbody', rows))),
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px' } },
          h('button.btn.small', { onclick: () => { lines.push({ item_id: null, qty: '' }); render(); } }, '+ Add item'),
          priced ? h('span', { style: { marginLeft: 'auto' } }, 'Total value: ', totalValue) : null)));
    recalc();
  }

  async function save(allowNegative = false) {
    // Outward slips carry no price on screen; the item price is still stored for the consumption value in the stock summary.
    const payload = { ...header, ...((boq || bom) ? ch : {}), type, lines: lines.filter(l => l.item_id && l.qty !== '' && Number(l.qty)).map(l => ({ ...l, rate: ['INWARD', 'OPENING'].includes(type) ? l.rate ?? null : itemById.get(l.item_id)?.rate ?? null })), allowNegative };
    if (makeChallan && !boq && !bom && ['OUTWARD', 'TRANSFER'].includes(type)) Object.assign(payload, { make_challan: true, challan: ch });
    if ((boq || bom) && lines.some(l => Number(l.qty) && !l[linkKey()])) throw new Error(`Pick the ${bom ? 'BOQ' : 'work order'} material on every line (type part of its name and choose it)`);
    if (lines.some(l => !l.item_id && Number(l.qty))) throw new Error('Pick an item on every line that has a quantity');
    if (type === 'TRANSFER' && !header.to_location) throw new Error('Enter where the material is transferred to');
    try {
      const r = await api('/stock/entry', { method: 'POST', body: payload });
      clearRefCache('items');
      const against = bom ? bom.bom_no : boq ? boq.boq_no : null;
      const open = url => { window.open(url, '_blank'); return false; }; // keep the dialog open to print the other one too
      await modal('Saved', h('div.grid', h('p', r.challan && against
        ? `Issued ${r.count} item(s) against ${against}. Delivery challan ${r.challan.challan_no} was created automatically and the ${bom ? 'BOQ' : 'work order'} now shows this material as sent.`
        : `${MOVE_TYPES[type].label} ${r.doc_no} saved with ${r.count} item(s).${r.challan ? ` Delivery challan ${r.challan.challan_no} made with it.` : ''}`)), [
        { label: '🖨 Print issue slip', action: () => open(`#/print/stockdoc/${type}?doc=${encodeURIComponent(r.doc_no)}`) },
        r.challan ? { label: '🖨 Print challan', action: () => open(`#/print/challan/${r.challan.id}`) } : null,
        r.challan && against ? { label: bom ? '📑 Open BOQ' : '📂 Open work order', action: () => { location.hash = bom ? `#/bom/${bom.id}` : `#/boq/${boq.id}`; return true; } } : null,
        { label: 'New entry', cls: 'primary', value: true }].filter(Boolean));
      if (r.challan && /^#\/bo[mq]\//.test(location.hash)) return;
      location.hash = `#/stock-entry?type=${type}&t=${Date.now()}`;
    } catch (e) {
      if (/Not enough stock/.test(e.message) && !allowNegative) {
        const may = hasFunction(state.user.role, 'allow_negative');
        const ok = await modal('Not enough stock', h('div', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message),
          h('p', may ? 'Save anyway? Stock will go negative for these items.' : 'Reduce the quantity, record the inward first, or ask someone allowed to issue more than the available stock.')),
          may ? [{ label: 'Cancel', value: false }, { label: 'Save anyway', cls: 'danger solid', value: true }] : [{ label: 'OK', value: false }]);
        if (ok) return save(true);
        return;
      }
      throw e;
    }
  }

  const tabs = h('div.tabs', ENTRY_TYPES.map(t => h('button', { class: t === type ? 'active' : '', disabled: (!!po && t !== 'INWARD') || ((!!boq || !!bom) && t !== 'OUTWARD'), onclick: () => { type = t; lines = lines.map(l => ({ ...l, rate: null })); header.doc_no = ''; draw(); } }, TITLES[t])));
  function draw() {
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', ENTRY_TYPES[i] === type));
    render();
  }
  root.replaceChildren(
    h('div.page-head', h('h1', '🔁 Stock Entry'), h('div.actions',
      h('a.btn', { href: '#/stock-summary' }, '📊 Stock Summary'), h('a.btn', { href: '#/list/stock_moves' }, 'All movements'),
      canWrite('stock_moves', state.user.role) ? h('a.btn', { href: '#/import?kind=items', title: 'Upload the WIESPL Smart Store workbook (items, opening stock and all inward / outward / transfer / return / scrap entries), or a stock movements sheet' }, '📥 Import Excel') : null,
      canWrite('stock_moves', state.user.role) ? h('button.btn.primary', { onclick: busy(() => save()) }, '💾 Save Entry') : null)),
    h('p.muted', 'Closing stock = Opening + Inward − Outward − Transfer + Return − Scrap. One slip can hold many items; numbers like 001/2026-27 are given automatically per type and restart every April.'),
    tabs, body);
  render();
}

// ---------------------------------------------------------------- Stock summary
export async function stockSummaryView(root) {
  const p = qs();
  const fy = fyOf(today());
  const f = {
    from: h('input', { type: 'date', value: p.from || `20${fy.slice(0, 2)}-04-01` }), to: h('input', { type: 'date', value: p.to || today() }),
    category: h('select', h('option', { value: '' }, 'All categories'), ITEM_CATEGORIES.map(c => h('option', c))),
    only: h('select', h('option', { value: '' }, 'All items'), h('option', { value: 'instock' }, 'In stock'), h('option', { value: 'low' }, 'Below minimum'), h('option', { value: 'negative' }, 'Negative stock')),
    q: h('input.grow', { type: 'search', placeholder: 'Search code or name…', value: p.q || '' }),
  };
  const out = h('div');
  const query = () => new URLSearchParams(Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]).filter(([, v]) => v))).toString();
  let page = 0, data = null, sort = null;
  const COLS = [['code', 'Code'], ['name', 'Item'], ['category', 'Category'], ['abc', 'ABC'], ['fsn', 'FSN'], ['uom', 'UOM'], ['rate', 'Price', 1], ['opening', 'Opening', 1], ['inward', 'Inward', 1],
    ['outward', 'Outward', 1], ['transfer', 'Transfer', 1], ['return', 'Return', 1], ['scrap', 'Scrap', 1], ['closing', 'Closing', 1], ['closing_value', 'Closing Value', 1], ['last_out', 'Last Issued']];
  function draw() {
    let rows = data.rows;
    if (sort) rows = [...rows].sort((a, b) => (typeof a[sort.k] === 'number' ? a[sort.k] - b[sort.k] : String(a[sort.k] ?? '').localeCompare(String(b[sort.k] ?? ''), undefined, { numeric: true })) * sort.d);
    const per = 100, pages = Math.max(1, Math.ceil(rows.length / per));
    page = Math.min(page, pages - 1);
    const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
    out.replaceChildren(
      h('div.kpis',
        h('div.kpi', h('div.label', 'Items'), h('div.value', rows.length)),
        h('div.kpi', h('div.label', 'Closing stock value'), h('div.value', money(sum('closing_value')).replace('.00', ''))),
        h('div.kpi', h('div.label', 'Inward value'), h('div.value', money(sum('inward_value')).replace('.00', ''))),
        h('div.kpi', h('div.label', 'Consumption value'), h('div.value', money(sum('consumption_value')).replace('.00', '')), h('div.sub', 'outward + transfer')),
        h('div.kpi', h('div.label', 'Below minimum'), h('div.value', rows.filter(r => r.low).length)),
        h('div.kpi', h('div.label', 'Negative stock'), h('div.value', rows.filter(r => r.closing < 0).length))),
      h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', COLS.map(([k, l, n]) => h('th' + (n ? '.num' : ''), { onclick: () => { sort = { k, d: sort?.k === k ? -sort.d : 1 }; draw(); } }, l, sort?.k === k ? (sort.d > 0 ? ' ▲' : ' ▼') : '')))),
        h('tbody', rows.slice(page * per, (page + 1) * per).map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/items/${r.id}`) },
          COLS.map(([k, , n]) => {
            const v = r[k];
            if (k === 'closing') return h('td.num', { style: { color: v < 0 ? 'var(--bad)' : r.low ? 'var(--warn)' : '', fontWeight: 600 } }, v);
            if (k === 'closing_value' || k === 'rate') return h('td.num', inr(v));
            if (k === 'last_out') return h('td.nowrap', v ? fmtDate(v) : h('span.muted', 'never'));
            if (k === 'name') return h('td.clip', { title: v }, v);
            return h('td' + (n ? '.num' : ''), v === 0 && n ? h('span.muted', '0') : v ?? '');
          })))),
        h('tfoot', h('tr', COLS.map(([k]) => h('td.num', k === 'closing_value' ? inr(sum('closing_value')) : k === 'code' ? 'Total' : '')))))),
        pages > 1 ? h('div.pager', `${rows.length} items · page ${page + 1} of ${pages}`,
          h('button.btn.small', { disabled: page === 0, onclick: () => { page--; draw(); } }, '‹ Prev'),
          h('button.btn.small', { disabled: page >= pages - 1, onclick: () => { page++; draw(); } }, 'Next ›')) : null));
  }
  async function load() { try { data = await api(`/stock/summary?${query()}`); page = 0; draw(); } catch (e) { fail(e); } }
  let timer;
  for (const el of Object.values(f)) el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  const canCarry = hasFunction(state.user.role, 'stock_opening');
  root.replaceChildren(
    h('div.page-head', h('h1', '📊 Stock Summary'), h('div.actions',
      h('a.btn', { href: '#/stock-entry' }, '🔁 Stock Entry'),
      h('button.btn', { onclick: () => download(`/api/export/stock-summary?${query()}`) }, '⬇ Export Excel'),
      canCarry ? h('button.btn', { onclick: () => carryForward().catch(fail) }, '🏁 1 April Opening Stock') : null)),
    h('div.toolbar', f.q, f.category, f.only, h('span.muted', 'From'), f.from, h('span.muted', 'to'), f.to),
    h('p.muted', 'ABC: items making up 70% of consumption value are A, the next 20% B, the rest C. FSN: issued in 4+ months = FAST, 1–3 = SLOW, none = NON-M (non-moving).'),
    out);
  await load();

  async function carryForward() {
    const sel = h('select', [0, 1].map(n => { const [a] = fy.split('-').map(Number); const v = `${String(a + n).padStart(2, '0')}-${String(a + n + 1).padStart(2, '0')}`; return h('option', { value: v }, `FY 20${v} (1 April 20${v.slice(0, 2)})`); }));
    const ok = await modal('Create 1 April opening stock', h('div.grid',
      h('p', 'For every item, the closing stock on 31 March becomes an "Opening Stock" entry dated 1 April. Stock from then on counts from this opening. Items that already have an opening entry on that date are skipped.'),
      h('label', 'Financial year', sel)), [{ label: 'Cancel', value: false }, { label: 'Create opening entries', cls: 'primary', value: true }]);
    if (!ok) return;
    const r = await api('/stock/opening', { method: 'POST', body: { fy: sel.value } });
    toast(`Opening stock dated ${fmtDate(r.date)}: ${r.created} items created, ${r.skipped} skipped`);
    load();
  }
}

// ---------------------------------------------------------------- PO tracker
export async function poTrackerView(root) {
  const q = h('input.grow', { type: 'search', placeholder: 'Search PO no, vendor, item or project…', value: qs().q || '' });
  const pending = h('select', { style: { width: 'auto' } }, h('option', { value: '' }, 'All lines'), h('option', { value: 'pending' }, 'Pending (not fully received)'), h('option', { value: 'procured' }, 'Procured (fully received)'), h('option', { value: 'Not approved yet' }, 'PO not approved yet'));
  pending.value = qs().state || '';
  const out = h('div');
  async function load() {
    try {
      const rows = await api(`/reports/po-lines?q=${encodeURIComponent(q.value)}${pending.value ? '&state=' + encodeURIComponent(pending.value) : ''}`);
      const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
      const cnt = st => rows.filter(r => r.line_status === st).length;
      out.replaceChildren(rows.length ? h('div.kpis', h('div.kpi', h('div.label', 'PO lines'), h('div.value', rows.length)), h('div.kpi', h('div.label', '✓ Procured'), h('div.value', cnt('Procured'))),
        h('div.kpi', h('div.label', '◐ Partly received'), h('div.value', cnt('Partly received'))), h('div.kpi', h('div.label', '○ Pending'), h('div.value', cnt('Pending'))), h('div.kpi', h('div.label', 'Not approved yet'), h('div.value', cnt('Not approved yet')))) : null,
      rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['PO No', 'Date', 'Vendor', 'Project / BOQ', 'Item', 'UOM', 'Ordered', 'Approved', 'Received', 'Pending', 'Rate', 'Value', 'Procurement', 'PO Status'].map((t, i) => h('th' + (i >= 6 && i <= 11 ? '.num' : ''), t)))),
        h('tbody', rows.slice(0, 1000).map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/purchase_orders/${r.po_id}`) },
          h('td.nowrap', r.po_no), h('td.nowrap', fmtDate(r.date)), h('td.clip', r.vendor || ''), h('td.clip', [r.project, r.bom_no].filter(Boolean).join(' · ')), h('td.clip', { title: r.item }, r.item), h('td', r.uom || ''),
          h('td.num', r.ordered), h('td.num', r.approved), h('td.num', r.received), h('td.num', { style: { fontWeight: 600, color: r.pending > 0 ? 'var(--warn)' : '' } }, r.pending),
          h('td.num', inr(r.rate)), h('td.num', inr(r.value)), h('td.nowrap', { style: { color: r.line_status === 'Procured' ? 'var(--good)' : r.line_status === 'Pending' ? 'var(--warn)' : '' } }, { Procured: '✓ ', 'Partly received': '◐ ', Pending: '○ ' }[r.line_status] || '', r.line_status), h('td', badge(r.status))))),
        h('tfoot', h('tr', h('td', { colspan: 6 }, `${rows.length} lines`), h('td.num', round2(sum('ordered'))), h('td.num', round2(sum('approved'))), h('td.num', round2(sum('received'))), h('td.num', round2(sum('pending'))), h('td'), h('td.num', inr(sum('value'))), h('td'), h('td'))))))
        : h('div.empty', 'No PO lines match'));
    } catch (e) { fail(e); }
  }
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  pending.addEventListener('change', load);
  root.replaceChildren(h('div.page-head', h('h1', '🔎 PO Tracker'), h('div.actions', h('a.btn', { href: '#/list/purchase_orders' }, 'Purchase Orders'))),
    h('p.muted', 'Every line of every purchase order: ordered, approved, received and still pending. A GRN against the PO (or with its PO number typed in) updates it automatically.'),
    h('div.toolbar', q, pending), out);
  await load();
}
