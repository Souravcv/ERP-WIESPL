// Store check: every Final BOQ, what the store has reserved for it, what is short, late (past its order-by date)
// and still to requisition. One click raises the Draft requisition for a BOQ's shortage.
import { h, api, state, toast, badge, fmtDate, busy } from '../ui.js';
import { canWrite } from '../schema.js';

export async function storeCheckView(root) {
  const list = await api('/store/boq-check');
  const canReq = canWrite('requisitions', state.user.role);
  const n = v => (v == null ? '' : Math.round(v * 1000) / 1000);
  const k = (label, v, sub) => h('div.kpi', h('div.label', label), h('div.value', v), sub ? h('div.sub', sub) : null);
  const sum = key => list.reduce((s, b) => s + (b[key] || 0), 0);
  root.replaceChildren(
    h('div.page-head', h('h1', '📦 BOQ Store Check'), h('div.actions', h('button.btn', { onclick: () => storeCheckView(root) }, '↻ Refresh'))),
    h('p.muted', 'Final BOQs in order of the date their material is required. Store stock is reserved for them in that order; “to requisition” is what is short and not yet on a requisition or PO. Order-by = required-by − the item’s lead time.'),
    h('div.kpis', k('Final BOQs', list.length), k('Reserved components', sum('reserved_lines')), k('Short', sum('short_lines')),
      k('To requisition', sum('to_requisition_lines'), 'not on a requisition / PO yet'), k('Late ⚠', sum('late_lines'), 'past order-by date')),
    list.length ? list.map(b => h('div.card', { style: { marginBottom: '14px' } },
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        h('h2', { style: { margin: 0 } }, h('a', { href: `#/bom/${b.id}` }, b.bom_no), ` · ${b.client || ''}`), badge(b.status),
        h('span.muted', [b.project, b.required_by && `required by ${fmtDate(b.required_by)}`].filter(Boolean).join(' · ')),
        h('span', { style: { marginLeft: 'auto' } }, `${b.reserved_lines} reserved · ${b.short_lines} short · ${b.to_requisition_lines} to requisition${b.late_lines ? ` · ${b.late_lines} late ⚠` : ''}`),
        canReq && b.to_requisition_lines ? h('button.btn.primary', { onclick: busy(async () => {
          const r = await api(`/boms/${b.id}/requisition-shortage`, { method: 'POST' });
          toast(`Requisition ${r.requisition.req_no} (Draft) for ${r.requisition.lines.length} material(s)`);
          location.hash = `#/view/requisitions/${r.requisition.id}`;
        }) }, '📝 Requisition shortage') : null),
      b.todo.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Dept', 'Component', 'Store item', 'Still needed', 'Reserved', 'Short', 'On order', 'To requisition', 'Order by'].map(x => h('th', x)))),
        h('tbody', b.todo.map(r => h('tr', h('td.muted', r.department), h('td', [r.component, r.dimensions].filter(Boolean).join(' ')), h('td', { style: { fontSize: '12px' } }, r.item_label || h('span.muted', 'not linked')),
          h('td.num', `${n(r.still_needed)} ${r.uom || ''}`), h('td.num', n(r.reserved)), h('td.num', n(r.shortage)), h('td.num', n(r.on_order) || ''),
          h('td.num', { style: { fontWeight: 600 } }, n(r.to_requisition) || ''), h('td.nowrap', { style: { color: r.late ? 'var(--bad)' : '' } }, fmtDate(r.order_by), r.late ? ' ⚠ late' : ''))))))
        : h('p.muted', '✓ Everything is reserved from stock or already on requisitions / POs.'))) : h('div.empty', 'No Final BOQs yet. A BOQ appears here when it is made Final after design review.'));
}
