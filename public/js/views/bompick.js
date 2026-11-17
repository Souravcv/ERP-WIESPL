// BOQ components → store items, and (for a PO / requisition) which of them to order and how many.
// Each component shows its store item, or the best match (preselected when it is a clear match by name and size), the
// other look-alikes to pick with one click, and "+ New item" when the store has nothing like it. Links are saved on the BOQ.
import { h, api, toast, modal, refOptions, clearRefCache } from '../ui.js';
import { itemPicker, quickItem } from './form.js';

// forOrder: tick / untick lines and change quantities (qtys: component id → default qty). Resolves null (cancelled) or the
// chosen lines [{ id, item_id, qty }].
export async function pickBomComponents(bomId, { ids = null, qtys = null, forOrder = false, title = 'Store items of the BOQ' } = {}) {
  const [m, items0] = await Promise.all([api(`/boms/${bomId}/item-matches${ids ? `?ids=${ids.join(',')}` : ''}`), refOptions('items')]);
  let items = items0;
  if (!m.rows.length) { toast('No components with a quantity'); return null; }
  const state = new Map(m.rows.map(r => [r.id, { on: true, qty: qtys?.[r.id] ?? r.qty, item: r.item_id || (r.confident ? r.candidates[0]?.id : null) || null }]));
  const count = h('b');
  const recount = () => {
    const s = [...state.values()];
    count.textContent = `${forOrder ? `${s.filter(x => x.on).length} of ${s.length} ticked · ` : ''}${s.filter(x => x.item).length} of ${s.length} with a store item`;
  };
  const itemCell = r => {
    const st = state.get(r.id);
    const box = h('div');
    const draw = () => {
      const picker = itemPicker(items, st.item, { onPick: id => { st.item = id; recount(); draw(); } });
      const chips = !st.item && r.candidates.length ? h('div.bp-chips', h('span.muted', 'Looks like: '), r.candidates.slice(0, 3).map(c => h('button.bp-chip', { type: 'button', title: `match ${c.score}`, onclick: () => { st.item = c.id; recount(); draw(); } }, c.label))) : null;
      const auto = st.item && !r.item_id && r.confident && st.item === r.candidates[0]?.id ? h('span.bp-auto', 'matched by name and size') : null;
      const add = h('button.btn.small', { type: 'button', title: 'Not in the store yet: add it to the item master (it gets an item code)', onclick: async () => {
        const it = await quickItem({ name: [r.component, r.dimensions].filter(Boolean).join(' '), spec: [r.spec, r.make && `Make: ${r.make}`].filter(Boolean).join('\n'), uom: r.uom });
        if (!it) return;
        clearRefCache('items'); items = await refOptions('items');
        st.item = it.id; recount(); draw();
      } }, '＋ New item');
      box.replaceChildren(h('div.bp-pick', picker, st.item ? null : add), auto, chips);
    };
    draw();
    return box;
  };
  const rows = m.rows.map(r => {
    const st = state.get(r.id);
    const tick = forOrder ? h('input', { type: 'checkbox', checked: true, onchange: e => { st.on = e.target.checked; recount(); } }) : null;
    const qty = forOrder ? h('input', { type: 'number', step: 'any', value: st.qty ?? '', style: { width: '90px' }, oninput: e => { st.qty = e.target.value === '' ? null : Number(e.target.value); } }) : null;
    return h('tr', forOrder ? h('td', tick) : null,
      h('td', h('b', r.component), r.dimensions ? ` ${r.dimensions}` : '', r.spec ? h('div.muted.bp-spec', String(r.spec).split('\n')[0]) : null, r.section ? h('div.muted', { style: { fontSize: '11px' } }, `${r.section} ${r.sr_no || ''}`) : null),
      h('td.nowrap', forOrder ? [qty, ' ', r.uom || ''] : `${r.qty ?? ''} ${r.uom || ''}`),
      h('td', itemCell(r)));
  });
  const all = forOrder ? h('label.muted', h('input', { type: 'checkbox', checked: true, onchange: e => { rows.forEach(tr => { const c = tr.querySelector('input[type=checkbox]'); c.checked = e.target.checked; }); state.forEach(s => { s.on = e.target.checked; }); recount(); } }), ' all') : null;
  recount();
  const ok = await modal(title, h('div',
    h('p.muted', forOrder ? 'Tick the materials to order, change the quantity, and give each its store item (its item code). The best match by name and size is already chosen; check it.' : 'Give each component its store item (its item code): stock, requisitions, POs and GRNs then follow it. The best match by name and size is already chosen; check it.'),
    m.bom.locked ? h('p.muted', 'This BOQ is Final: only the store item links change.') : null,
    h('div', count),
    h('div.table-wrap', { style: { maxHeight: '58vh' } }, h('table.data.bp-table', h('thead', h('tr', forOrder ? h('th', all) : null, ['Material', forOrder ? 'Qty' : 'BOQ qty', 'Store item (item code)'].map(x => h('th', x)))), h('tbody', rows)))),
  [{ label: 'Cancel', value: false }, { label: forOrder ? 'Add the ticked materials' : 'Save the links', cls: 'primary', value: true }], { wide: true });
  if (!ok) return null;
  const links = Object.fromEntries(m.rows.filter(r => (state.get(r.id).item || null) !== (r.item_id || null)).map(r => [r.id, state.get(r.id).item || null]));
  if (Object.keys(links).length) {
    try { const r = await api(`/boms/${bomId}/link-items`, { method: 'POST', body: { links } }); toast(`${r.linked} component(s) linked to store items`); }
    catch (e) { if (!forOrder) throw e; toast(`The links were not saved on the BOQ (${e.message}); they are used on this document`, true); }
  }
  return m.rows.filter(r => !forOrder || state.get(r.id).on).map(r => ({ id: r.id, item_id: state.get(r.id).item || null, qty: state.get(r.id).qty }));
}
