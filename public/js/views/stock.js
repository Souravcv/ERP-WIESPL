// Store screens: multi-line stock entry, stock summary, PO line tracker.
import { h, api, state, toast, fail, modal, confirmBox, refOptions, clearRefCache, money, fmtDate, today, download, badge } from '../ui.js';
import { MOVE_TYPES, ITEM_CATEGORIES, canWrite, hasFunction } from '../schema.js';
import { inr, round2, fyOf } from '../calc.js';
import { itemPicker } from './form.js';

const qs = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const ENTRY_TYPES = ['INWARD', 'OUTWARD', 'TRANSFER', 'RETURN', 'SCRAP', 'OPENING', 'ADJUST'];
const TITLES = { INWARD: '📥 Inward (GRN)', OUTWARD: '📤 Issue / Outward', TRANSFER: '🔀 Material Transfer', RETURN: '↩️ Return Material', SCRAP: '🗑️ Scrap', OPENING: '🏁 Opening Stock', ADJUST: '⚖️ Adjustment' };
const field = (label, el, hint) => h('label', label, hint ? h('span.hint', hint) : null, el);
const suggest = (list, attrs = {}) => {
  const id = 'sg-' + Math.random().toString(36).slice(2);
  return h('span', { style: { display: 'contents' } }, h('input', { list: id, ...attrs }), h('datalist', { id }, list.map(v => h('option', { value: v }))));
};

// ---------------------------------------------------------------- Stock entry (one slip, many items)
export async function stockEntryView(root) {
  const p = qs();
  let type = ENTRY_TYPES.includes(p.type) ? p.type : 'OUTWARD';
  const [items, vendors, projects] = await Promise.all([api('/items?limit=20000'), refOptions('vendors'), refOptions('projects')]);
  const itemById = new Map(items.map(i => [i.id, i]));
  const itemOpts = items.map(i => ({ id: i.id, label: `${i.code} · ${i.name}` }));
  const header = {};
  let lines = [];
  let po = null;

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
  if (p.item) lines.push({ item_id: Number(p.item), qty: '' });
  if (p.project) header.project_id = Number(p.project);
  if (p.vendor) header.vendor_id = Number(p.vendor);
  if (!lines.length) lines.push({ item_id: null, qty: '' });

  function headerFields() {
    const v = (k, el) => { el.value = header[k] ?? ''; el.oninput = el.onchange = () => { header[k] = el.value; }; return el; };
    const sv = (k, list) => { const w = suggest(list); v(k, w.firstChild); return w; };
    const pick = (k, opts, label) => field(label, itemPicker(opts, header[k] ? Number(header[k]) : null, { onPick: id => { header[k] = id; } }));
    const date = v('date', h('input', { type: 'date' }));
    if (!header.date) { header.date = type === 'OPENING' ? `20${fyOf(today()).slice(0, 2)}-04-01` : today(); date.value = header.date; }
    const F = [field('Date *', date), field({ INWARD: 'GRN No', OUTWARD: 'Issue No', TRANSFER: 'Transfer No', RETURN: 'Return No', SCRAP: 'Scrap No' }[type] || 'Doc No', v('doc_no', h('input', { placeholder: 'Auto (001/2026-27)' })))];
    if (type === 'INWARD') {
      if (po) F.push(field('Against PO', h('input', { value: `${po.po_no} · ${po.vendor_id_label}`, readOnly: true })));
      F.push(pick('vendor_id', vendors, 'Supplier'), field('Supplier name (if not in list)', v('supplier', h('input'))),
        field('Supplier Invoice No', v('invoice_no', h('input'))), field('Invoice Date', v('invoice_date', h('input', { type: 'date' }))));
      if (!po) F.push(field('PO No (text)', v('po_no', h('input', { placeholder: 'e.g. 020/2026-27 or Verbal' }))));
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
      const rate = h('input', { type: 'number', step: 'any', value: l.rate ?? (priced ? '' : it?.rate ?? ''), placeholder: priced ? 'required' : String(it?.rate ?? ''), style: { width: '110px' } });
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
        h('td', itemPicker(itemOpts, l.item_id, { onPick: id => { l.item_id = id; if (!priced) l.rate = null; render(); } }),
          l.note ? h('div.muted', { style: { fontSize: '12px' } }, `PO: ${l.note} (ordered ${l.ordered}, received ${l.received})`) : null),
        stockCell, h('td', qty), h('td', rate), value,
        h('td', h('input', { value: l.remark || '', placeholder: 'remark', oninput: e => { l.remark = e.target.value; } })),
        h('td', h('button.icon-btn.del', { title: 'Remove', onclick: () => { lines.splice(i, 1); if (!lines.length) lines.push({ item_id: null, qty: '' }); render(); } }, '✕')));
    });
    body.replaceChildren(
      h('div.card', h('div.form-grid', headerFields())),
      h('div.card.flush', h('div.table-wrap', h('table.data.lines',
        h('thead', h('tr', h('th', '#'), h('th', 'Item *'), h('th.num', 'In stock'), h('th', type === 'ADJUST' ? 'Qty (+/-) *' : 'Qty *'), h('th', priced ? 'Price / piece *' : 'Price / piece'), h('th.num', 'Value'), h('th', 'Remark'), h('th'))),
        h('tbody', rows))),
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px' } },
          h('button.btn.small', { onclick: () => { lines.push({ item_id: null, qty: '' }); render(); } }, '+ Add item'),
          h('span', { style: { marginLeft: 'auto' } }, 'Total value: ', totalValue))));
    recalc();
  }

  async function save(allowNegative = false) {
    const payload = { ...header, type, lines: lines.filter(l => l.item_id && l.qty !== '' && Number(l.qty)).map(l => ({ ...l, rate: l.rate ?? (['INWARD', 'OPENING'].includes(type) ? null : itemById.get(l.item_id)?.rate ?? null) })), allowNegative };
    if (lines.some(l => !l.item_id && Number(l.qty))) throw new Error('Pick an item on every line that has a quantity');
    if (type === 'TRANSFER' && !header.to_location) throw new Error('Enter where the material is transferred to');
    try {
      const r = await api('/stock/entry', { method: 'POST', body: payload });
      clearRefCache('items');
      await modal('Saved', h('div.grid', h('p', `${MOVE_TYPES[type].label} ${r.doc_no} saved with ${r.count} item(s).`)), [
        { label: '🖨 Print slip', action: () => { window.open(`#/print/stockdoc/${type}?doc=${encodeURIComponent(r.doc_no)}`, '_blank'); return true; } },
        { label: 'New entry', cls: 'primary', value: true }]);
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

  const tabs = h('div.tabs', ENTRY_TYPES.map(t => h('button', { class: t === type ? 'active' : '', disabled: !!po && t !== 'INWARD', onclick: () => { type = t; lines = lines.map(l => ({ ...l, rate: null })); header.doc_no = ''; draw(); } }, TITLES[t])));
  function draw() {
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', ENTRY_TYPES[i] === type));
    render();
  }
  root.replaceChildren(
    h('div.page-head', h('h1', '🔁 Stock Entry'), h('div.actions',
      h('a.btn', { href: '#/stock-summary' }, '📊 Stock Summary'), h('a.btn', { href: '#/list/stock_moves' }, 'All movements'),
      canWrite('stock_moves', state.user.role) ? h('button.btn.primary', { onclick: () => save().catch(fail) }, '💾 Save Entry') : null)),
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
  const pending = h('input', { type: 'checkbox', style: { width: 'auto' } });
  const out = h('div');
  async function load() {
    try {
      const rows = await api(`/reports/po-lines?q=${encodeURIComponent(q.value)}${pending.checked ? '&pending=1' : ''}`);
      const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
      out.replaceChildren(rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['PO No', 'Date', 'Vendor', 'Project', 'Item', 'UOM', 'Ordered', 'Approved', 'Received', 'Pending', 'Rate', 'Value', 'Status'].map((t, i) => h('th' + (i >= 6 && i <= 11 ? '.num' : ''), t)))),
        h('tbody', rows.slice(0, 1000).map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/purchase_orders/${r.po_id}`) },
          h('td.nowrap', r.po_no), h('td.nowrap', fmtDate(r.date)), h('td.clip', r.vendor || ''), h('td.clip', r.project || ''), h('td.clip', { title: r.item }, r.item), h('td', r.uom || ''),
          h('td.num', r.ordered), h('td.num', r.approved), h('td.num', r.received), h('td.num', { style: { fontWeight: 600, color: r.pending > 0 ? 'var(--warn)' : '' } }, r.pending),
          h('td.num', inr(r.rate)), h('td.num', inr(r.value)), h('td', badge(r.status))))),
        h('tfoot', h('tr', h('td', { colspan: 6 }, `${rows.length} lines`), h('td.num', round2(sum('ordered'))), h('td.num', round2(sum('approved'))), h('td.num', round2(sum('received'))), h('td.num', round2(sum('pending'))), h('td'), h('td.num', inr(sum('value'))), h('td'))))))
        : h('div.empty', 'No PO lines match'));
    } catch (e) { fail(e); }
  }
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  pending.addEventListener('change', load);
  root.replaceChildren(h('div.page-head', h('h1', '🔎 PO Tracker'), h('div.actions', h('a.btn', { href: '#/list/purchase_orders' }, 'Purchase Orders'))),
    h('p.muted', 'Every line of every purchase order: how much was ordered, approved, received and is still pending. Receiving goods (GRN against a PO) updates it automatically.'),
    h('div.toolbar', q, h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 400 } }, pending, 'Pending only')), out);
  await load();
}
