// Project analysis: one project's purchasing at a glance — POs with approval / received / billed / paid, vendors,
// open requisitions, BOQ procurement, store issues, and the sales side.
import { h, api, badge, fmtDate, refOptions } from '../ui.js';
import { inr } from '../calc.js';
import { itemPicker } from './form.js';

const rs = v => `₹ ${inr(v || 0, 0)}`;

export async function projectAnalysisView(root, projectId) {
  const projects = await refOptions('projects');
  // On the dashboard tab the choice is remembered and the tab redrawn; on its own page the address changes.
  const onDashboard = !location.hash.startsWith('#/project-analysis');
  const picker = itemPicker(projects, projectId ? Number(projectId) : null, { onPick: id => {
    if (!id) return;
    try { sessionStorage.setItem('dash-project', id); } catch { /* private window */ }
    if (onDashboard) projectAnalysisView(root, id); else location.hash = `#/project-analysis/${id}`;
  } });
  const head = h('div.page-head', h('h1', '📈 Project analysis'), h('div.actions', h('span', { style: { minWidth: '320px', display: 'inline-block' } }, picker)));
  if (!projectId) { root.replaceChildren(head, h('div.card', h('p', 'Choose a project to see its purchase orders, approvals, material received, vendor bills and payments, requisitions, BOQs and store issues.'))); return; }
  const d = await api(`/projects/${projectId}/analysis`);
  const t = d.totals;
  const k = (label, v, sub, color) => h('div.kpi', h('div.label', label), h('div.value', { style: color ? { color } : {} }, v), sub ? h('div.sub', sub) : null);
  const today = new Date().toLocaleString('sv-SE').slice(0, 10);
  root.replaceChildren(head,
    h('div.muted', { style: { marginBottom: '10px' } }, [d.project.no, d.project.name, d.project.customer, d.project.stage && `Stage: ${d.project.stage}`].filter(Boolean).join('   ·   '),
      ' ', h('a', { href: `#/view/projects/${d.project.id}` }, 'open project ›')),
    h('div.kpis',
      k('Purchase orders', t.pos, `${rs(t.value)} total`),
      k('Approved', rs(t.approved_value), `${t.pending} waiting for approval (${rs(t.pending_value)})${t.drafts ? ` · ${t.drafts} draft` : ''}`),
      k('Material received', rs(t.received_value), t.value ? `${Math.round(t.received_value / t.value * 100)}% of PO value` : ''),
      k('Vendor bills', rs(t.billed)),
      k('Paid to vendors', rs(t.paid)),
      k('Still to pay', rs(t.to_pay), t.due_now ? `${rs(t.due_now)} due now` : 'on approved POs', t.due_now ? 'var(--bad)' : null),
      k('Advance at risk', rs(t.advance_at_risk), 'paid, material not received yet', t.advance_at_risk ? 'var(--warn)' : null),
      k('Store issues', rs(d.project.material_cost), 'material issued to this project'),
      k('Other expenses', rs(t.expenses), 'expense vouchers paid for this project'),
      k('Sales order', rs(d.sales.order_value), `invoiced ${rs(d.sales.invoiced)} · received ${rs(d.sales.received)}`)),
    h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, `🛒 Purchase orders (${d.pos.length})`)),
      d.pos.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['PO', 'Date', 'Vendor', 'Status', 'Value', 'Received', 'Billed', 'Paid', 'To pay', 'Next payment'].map(x => h('th', x)))),
        h('tbody', d.pos.map(p => h('tr.clickable', { onclick: () => (location.hash = `#/view/purchase_orders/${p.id}`) },
          h('td.nowrap', p.po_no), h('td.nowrap', fmtDate(p.date)), h('td', p.vendor || ''), h('td', badge(p.status), p.stage ? h('div.muted', { style: { fontSize: '11px' } }, `waiting: ${p.stage}`) : null),
          h('td.num', rs(p.total)), h('td.num', `${p.received_pct}%`), h('td.num', p.billed ? rs(p.billed) : ''), h('td.num', p.paid ? rs(p.paid) : ''), h('td.num', p.balance ? rs(p.balance) : ''),
          h('td.nowrap', { style: { color: p.next_due && p.next_due.date <= today ? 'var(--bad)' : '' } }, p.next_due ? `${fmtDate(p.next_due.date)} ${p.next_due.amount ? rs(p.next_due.amount) : ''}` : '')))))) : h('p.muted', { style: { padding: '0 16px 12px' } }, 'No POs for this project yet.')),
    h('div.grid2', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' } },
      h('div.card', h('h2', '🏭 By vendor'), d.vendors.length ? h('table.data', h('thead', h('tr', ['Vendor', 'POs', 'Value', 'Paid'].map(x => h('th', x)))),
        h('tbody', d.vendors.map(v => h('tr', h('td', v.vendor || ''), h('td.num', v.pos), h('td.num', rs(v.value)), h('td.num', rs(v.paid)))))) : h('p.muted', 'None')),
      h('div.card', h('h2', '📑 BOQs (procurement)'), d.boms.length ? h('table.data', h('thead', h('tr', ['BOQ', 'Status', 'Components', 'Procured', 'Sent'].map(x => h('th', x)))),
        h('tbody', d.boms.map(b => h('tr.clickable', { onclick: () => (location.hash = `#/bom/${b.id}`) }, h('td', `${b.bom_no} ${b.client || ''}`), h('td', badge(b.status)), h('td.num', b.lines), h('td.num', b.procured), h('td.num', `${b.sent} (${b.progress}%)`))))) : h('p.muted', 'None')),
      h('div.card', h('h2', '📝 Open requisitions'), d.requisitions.length ? h('table.data', h('thead', h('tr', ['Req', 'Date', 'Status', 'Required by'].map(x => h('th', x)))),
        h('tbody', d.requisitions.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/requisitions/${r.id}`) }, h('td', r.req_no), h('td', fmtDate(r.date)), h('td', badge(r.status)), h('td', fmtDate(r.required_by)))))) : h('p.muted', 'None'))));
}
