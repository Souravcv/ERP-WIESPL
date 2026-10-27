// Stock movements by slip: one row per GRN / issue slip / transfer with all its items together, tabs per type like the
// stock entry, and editing a GRN (supplier, invoice, quantities, prices) to attach the PO it came against.
import { h, api, state, toast, fail, modal, refOptions, money, fmtDate, badge, busy, clearRefCache } from '../ui.js';
import { MOVE_TYPES, hasFunction } from '../schema.js';
import { inr, round2 } from '../calc.js';
import { itemPicker } from './form.js';

const qs = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const TABS = [['', 'All'], ['INWARD', '📥 Inward (GRN)'], ['OUTWARD', '📤 Issue / Outward'], ['TRANSFER', '🔀 Transfer (MTN)'], ['RETURN', '↩️ Return'],
  ['SCRAP', '🗑️ Scrap'], ['ADJUST', '⚖️ Adjustment'], ['PRODUCED', '🏭 Production'], ['OPENING', '🏁 Opening']];
const PRICED = ['INWARD', 'OPENING'];
const printUrl = r => `#/print/stockdoc/${r.type}?doc=${encodeURIComponent(r.doc_no || '')}`;
const editUrl = r => `#/grn-edit?doc=${encodeURIComponent(r.doc_key)}&date=${r.date}`;
const party = r => ({
  INWARD: [r.vendor || r.supplier, r.invoice_no && `inv. ${r.invoice_no}`],
  TRANSFER: [r.to_location && `→ ${r.to_location}`, r.project],
}[r.type] || [r.project, r.issued_to]).filter(Boolean).join(' · ') + (r.projects > 1 ? ` (+${r.projects - 1} projects)` : '');

export async function stockMovementsView(root) {
  const p = qs();
  let type = TABS.some(t => t[0] === p.type) ? p.type : '';
  const mayEdit = hasFunction(state.user.role, 'stock_post');
  const f = {
    q: h('input.grow', { type: 'search', placeholder: 'Search slip no, supplier, invoice, PO, project or item…', value: p.q || '' }),
    from: h('input', { type: 'date', value: p.from || '' }), to: h('input', { type: 'date', value: p.to || '' }),
    po: h('select', { style: { width: 'auto' } }, h('option', { value: '' }, 'With and without PO'), h('option', { value: 'without' }, 'GRNs without a PO'), h('option', { value: 'with' }, 'GRNs against a PO')),
  };
  f.po.value = p.po || '';
  const tabs = h('div.tabs');
  const out = h('div');
  const open = new Set();

  async function lines(r, cell) {
    try {
      const d = await api(`/stock/doc?type=${r.type}&doc=${encodeURIComponent(r.doc_key)}&date=${r.date}`);
      const priced = PRICED.includes(r.type);
      cell.replaceChildren(h('div', { style: { padding: '6px 0 10px' } },
        h('table.data', h('thead', h('tr', ['#', 'Item', 'Qty', 'UOM', priced ? 'Rate' : null, priced ? 'Value' : null, r.type === 'INWARD' ? 'PO' : 'Project', 'Remark'].filter(x => x !== null).map((x, i) => h('th' + (['Qty', 'Rate', 'Value'].includes(x) ? '.num' : ''), x)))),
          h('tbody', d.moves.map((m, i) => h('tr', h('td.muted', i + 1), h('td', h('a', { href: `#/view/items/${m.item_id}` }, m.item_id_label)), h('td.num', m.qty), h('td', m.uom || ''),
            priced ? h('td.num', inr(m.rate)) : null, priced ? h('td.num', inr(m.value)) : null,
            h('td', r.type === 'INWARD' ? (m.po_no || h('span', { style: { color: 'var(--warn)' } }, 'no PO')) : m.project_id_label || ''), h('td', m.remarks || ''))))),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
          h('a.btn.small', { href: printUrl(r), target: '_blank' }, '🖨 Print'),
          r.type === 'INWARD' && mayEdit ? h('a.btn.small.primary', { href: editUrl(r) }, r.with_po ? '✏ Edit GRN / change PO' : '📎 Attach PO / edit GRN') : null)));
    } catch (e) { fail(e); }
  }

  async function load() {
    try {
      const qp = new URLSearchParams(Object.entries({ type, q: f.q.value, from: f.from.value, to: f.to.value, po: type === 'INWARD' || !type ? f.po.value : '' }).filter(([, v]) => v)).toString();
      const { rows, counts } = await api(`/stock/docs?${qp}`);
      tabs.replaceChildren(...TABS.map(([t, l]) => h('button', { class: t === type ? 'active' : '', onclick: () => { type = t; open.clear(); load(); } },
        l, h('span.muted', { style: { marginLeft: '4px', fontSize: '11px' } }, t ? counts[t] || 0 : Object.values(counts).reduce((a, b) => a + b, 0)))));
      const priced = !type || PRICED.includes(type);
      const noPo = rows.filter(r => r.type === 'INWARD' && !r.with_po).length;
      const body = [];
      for (const r of rows) {
        const key = `${r.type}|${r.doc_key}|${r.date}`;
        const exp = open.has(key);
        const cell = h('td', { colspan: 9 });
        body.push(h('tr.clickable', { onclick: () => { exp ? open.delete(key) : open.add(key); load(); } },
          h('td', exp ? '▾' : '▸'), h('td.nowrap', fmtDate(r.date)), h('td.nowrap', h('b', r.doc_no || '—')),
          !type ? h('td.nowrap', MOVE_TYPES[r.type]?.label || r.type) : null,
          h('td.clip', { title: party(r) }, party(r)),
          type === 'INWARD' || !type ? h('td.nowrap', r.type !== 'INWARD' ? '' : r.with_po ? r.po_no : h('span', { style: { color: 'var(--warn)' } }, 'no PO')) : null,
          h('td.num', `${r.items} item${r.items === 1 ? '' : 's'}`), priced ? h('td.num', PRICED.includes(r.type) ? inr(r.value) : '') : null, h('td.muted', r.created_by || '')));
        if (exp) { body.push(h('tr', cell)); lines(r, cell); }
      }
      out.replaceChildren(
        h('p.muted', `${rows.length}${rows.length >= 300 ? '+' : ''} slips${noPo && (type === 'INWARD' || !type) ? ` · ${noPo} GRN(s) without a PO: open one and use “Attach PO”` : ''}. Click a slip to see its items.`),
        rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
          h('thead', h('tr', h('th'), h('th', 'Date'), h('th', 'No'), !type ? h('th', 'Type') : null, h('th', type === 'INWARD' ? 'Supplier · invoice' : 'Project / to'),
            type === 'INWARD' || !type ? h('th', 'PO') : null, h('th.num', 'Items'), priced ? h('th.num', 'Value') : null, h('th', 'By'))),
          h('tbody', body)))) : h('div.empty', 'No slips match'));
    } catch (e) { fail(e); }
  }
  let timer;
  for (const el of Object.values(f)) el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  root.replaceChildren(
    h('div.page-head', h('h1', '🔁 Stock Movements'), h('div.actions',
      h('a.btn.primary', { href: '#/stock-entry' }, '+ Stock Entry'), h('a.btn', { href: '#/list/stock_drafts?status=Draft' }, '📝 Drafts'),
      h('a.btn', { href: '#/list/stock_moves' }, '☰ Item-wise list'), h('a.btn', { href: '#/stock-summary' }, '📊 Stock Summary'))),
    tabs, h('div.toolbar', f.q, f.po, h('span.muted', 'From'), f.from, h('span.muted', 'to'), f.to), out);
  await load();
}

// ---------------------------------------------------------------- edit a GRN / attach its PO
export async function grnEditView(root) {
  const p = qs();
  const [d, vendors, allPos] = await Promise.all([api(`/stock/doc?type=INWARD&doc=${encodeURIComponent(p.doc)}&date=${p.date}`), refOptions('vendors'), api('/purchase_orders?limit=5000')]);
  const m0 = d.moves[0];
  const head = { date: m0.date, vendor_id: m0.vendor_id, supplier: m0.supplier || '', invoice_no: m0.invoice_no || '', invoice_date: m0.invoice_date || '', po_id: m0.po_id || null };
  const lines = d.moves.map(m => ({ id: m.id, item_id: m.item_id, label: m.item_id_label, uom: m.uom, qty: m.qty, rate: m.rate, po_line: m.po_id === head.po_id ? m.po_line : null }));
  const poChoices = allPos.filter(x => !['Draft', 'Cancelled', 'Rejected', 'Pending Approval'].includes(x.status))
    .map(x => ({ id: x.id, label: `${x.po_no} · ${x.vendor_id_label || ''}${x.status === 'Archived (old)' ? ' · old' : x.status === 'Approved' || x.status === 'Sent' ? '' : ' · ' + x.status}`, vendor_id: x.vendor_id }));
  let po = head.po_id ? await api(`/purchase_orders/${head.po_id}`) : null;
  const body = h('div');
  const field = (label, el, hint) => h('label', label, hint ? h('span.hint', hint) : null, el);
  const v = (k, el) => { el.value = head[k] ?? ''; el.oninput = el.onchange = () => { head[k] = el.value; }; return el; };

  // PO lines this item may have come against (same item first), and the default when nothing is chosen.
  const poLines = () => (po?.lines || []).map((l, i) => ({ i, l })).filter(x => Number(x.l.qty) > 0);
  const lineLabel = ({ i, l }) => `${i + 1}. ${[l.description, String(l.spec || '').split('\n')[0]].filter(Boolean).join(' – ').slice(0, 80)} · ordered ${l.qty} ${l.uom || ''}, received ${l.received || 0}`;
  const guess = ln => { const c = poLines(); return (c.find(x => Number(x.l.item_id) === Number(ln.item_id) && (Number(x.l.received) || 0) < Number(x.l.qty)) || c.find(x => Number(x.l.item_id) === Number(ln.item_id)))?.i ?? null; };

  async function setPo(id) {
    head.po_id = id || null;
    po = id ? await api(`/purchase_orders/${id}`) : null;
    if (po && !head.vendor_id) head.vendor_id = po.vendor_id;
    for (const ln of lines) ln.po_line = po ? guess(ln) : null;
    render();
  }

  function render() {
    const total = h('b');
    const sum = () => { total.textContent = money(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)); };
    const opts = poLines();
    body.replaceChildren(
      h('div.card', h('div.form-grid',
        field('GRN No', h('input', { value: d.doc_no, disabled: true })), field('Date', v('date', h('input', { type: 'date' }))),
        field('Against PO', itemPicker(poChoices, head.po_id, { onPick: id => setPo(id).catch(fail) }), 'type the PO number; old (archived) POs are listed too'),
        field('Supplier', itemPicker(vendors, head.vendor_id ? Number(head.vendor_id) : null, { onPick: id => { head.vendor_id = id; } })),
        field('Supplier name (if not in list)', v('supplier', h('input'))), field('Supplier Invoice No', v('invoice_no', h('input'))),
        field('Invoice Date', v('invoice_date', h('input', { type: 'date' }))))),
      po ? h('p.muted', `PO ${po.po_no}${po.revision ? ` Rev. ${po.revision}` : ''} · ${po.vendor_id_label || ''} · `, badge(po.status), ' — choose the PO line each item came against; the PO’s received quantities are updated when you save.') : h('p.muted', 'No PO attached. Choose the PO above to link this GRN to it.'),
      h('div.card.flush', h('div.table-wrap', h('table.data.lines',
        h('thead', h('tr', h('th', '#'), h('th', 'Item'), h('th', 'Qty *'), h('th', 'UOM'), h('th', 'Price / piece'), h('th.num', 'Value'), po ? h('th', 'PO line') : null)),
        h('tbody', lines.map((ln, i) => {
          const val = h('td.num', inr((Number(ln.qty) || 0) * (Number(ln.rate) || 0)));
          const upd = () => { val.textContent = inr((Number(ln.qty) || 0) * (Number(ln.rate) || 0)); sum(); };
          const sel = po ? h('select', h('option', { value: '' }, '(match by item)'), opts.map(o => h('option', { value: o.i }, lineLabel(o)))) : null;
          if (sel) { sel.value = ln.po_line ?? ''; sel.onchange = () => { ln.po_line = sel.value === '' ? null : Number(sel.value); }; }
          return h('tr', h('td.muted', i + 1), h('td', ln.label),
            h('td', h('input', { type: 'number', step: 'any', value: ln.qty, style: { width: '90px' }, oninput: e => { ln.qty = e.target.value; upd(); } })), h('td', ln.uom || ''),
            h('td', h('input', { type: 'number', step: 'any', value: ln.rate ?? '', style: { width: '110px' }, oninput: e => { ln.rate = e.target.value; upd(); } })), val,
            sel ? h('td', sel) : null);
        })),
        h('tfoot', h('tr', h('td', { colspan: 5 }, 'Total'), h('td.num', total), po ? h('td') : null))))));
    sum();
  }

  async function save(allowNegative = false) {
    const payload = { doc: p.doc, date: p.date, ...head, po_id: head.po_id || null, allowNegative,
      lines: lines.map(l => ({ id: l.id, qty: Number(l.qty), rate: l.rate === '' || l.rate == null ? null : Number(l.rate), po_line: l.po_line })) };
    if (!head.po_id) payload.po_no = null;
    try {
      const r = await api('/stock/grn', { method: 'PUT', body: payload });
      clearRefCache('items');
      toast(`GRN ${r.doc_no} saved${r.pos.length ? ` against PO ${r.pos.map(x => x.po_no).join(', ')}` : ''}`);
      location.hash = `#/stock-movements?type=INWARD&q=${encodeURIComponent(r.doc_no)}`;
    } catch (e) {
      if (/Not enough stock/.test(e.message) && !allowNegative && hasFunction(state.user.role, 'allow_negative')) {
        const ok = await modal('Not enough stock', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message), [{ label: 'Cancel', value: false }, { label: 'Save anyway', cls: 'danger solid', value: true }]);
        if (ok) return save(true);
        return;
      }
      throw e;
    }
  }
  root.replaceChildren(
    h('div.page-head', h('h1', `✏ GRN ${d.doc_no}`), h('div.actions',
      h('a.btn', { href: `#/print/stockdoc/INWARD?doc=${encodeURIComponent(d.doc_no)}`, target: '_blank' }, '🖨 Print'),
      h('a.btn', { href: '#/stock-movements?type=INWARD' }, 'Cancel'),
      h('button.btn.primary', { onclick: busy(() => save()) }, '💾 Save GRN'))),
    h('p.muted', 'Changing a quantity changes the stock. Moving the GRN to another PO takes the quantities off the old PO and puts them on the new one.'),
    body);
  render();
}
