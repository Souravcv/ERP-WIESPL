// Accounts dashboard: vendor payments due (from PO payment schedules), POs waiting for the commercial step,
// receivables and collections.
import { h, api, fmtDate, tip } from '../ui.js';
import { inr } from '../calc.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = m => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const rs = v => {
  const n = Math.abs(v || 0);
  return `₹ ${n >= 1e7 ? (v / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? (v / 1e5).toFixed(2) + ' L' : n >= 1e3 ? (v / 1e3).toFixed(1) + ' K' : Math.round(v || 0)}`;
};

// One series per chart, so no legend box is needed: the title names it.
function monthChart(title, rows) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return h('div.card', h('h2', title),
    h('div.gchart', rows.map(r => {
      const bar = h('div.gbar.s-in', { style: { height: `${Math.max(r.value ? 2 : 0, (r.value / max) * 100)}%`, width: '55%', maxWidth: '40px' } });
      tip(bar, `${monLabel(r.month)}: ₹ ${inr(r.value)}`);
      return h('div.ggroup', h('div.gbars', bar), h('div.glabel', monLabel(r.month)));
    })),
    h('details', h('summary.muted', 'Show as table'), h('table.data', h('tbody', rows.map(r => h('tr', h('td', monLabel(r.month)), h('td.num', inr(r.value))))))));
}

export async function accountsDashboard(box) {
  const d = await api('/dashboard/accounts');
  const p = d.payables, r = d.receivables;
  const kpi = (label, value, sub, href) => h(href ? 'a.kpi' : 'div.kpi', href ? { href } : {}, h('div.label', label), h('div.value', value), sub ? h('div.sub', sub) : null);
  box.replaceChildren(
    h('div.kpis',
      kpi('Vendor payments overdue', rs(p.overdue), `${p.overdue_n} payment(s)`, '#/list/purchase_orders'),
      kpi('Due in next 30 days', rs(p.next30), `${p.next30_n} payment(s)`, '#/list/purchase_orders'),
      kpi('All open vendor payments', rs(p.open), p.no_date ? `${p.no_date} without a due date` : 'scheduled on POs'),
      kpi('Waiting for commercial step', d.pos.waiting_commercial.length, 'POs to price & schedule', '#/list/approvals?status=Pending'),
      kpi('Receivable (tax invoices)', rs(r.outstanding), `${rs(r.overdue)} overdue`, '#/list/invoices'),
      kpi('Collected this FY', rs(r.collected_fy), `POs approved this FY ${rs(d.pos.approved_fy_value)}`, '#/list/payments')),
    d.pos.without_schedule ? h('p', { style: { color: 'var(--warn)' } }, `⚠ ${d.pos.without_schedule} approved PO(s) have no payment schedule yet – open the PO and add the due dates so payments can be planned.`) : null,
    h('div.grid.cols-2', monthChart('Vendor payments due – next 6 months (₹)', p.by_month), monthChart('Collections from customers – last 6 months (₹)', r.collected_by_month)),
    h('div.grid.cols-2',
      h('div.card', h('h2', 'Upcoming vendor payments'), p.upcoming.length ? h('table.data', h('thead', h('tr', ['Due', 'PO', 'Vendor', 'Payment', 'Amount'].map((x, i) => h('th' + (i === 4 ? '.num' : ''), x)))),
        h('tbody', p.upcoming.map(x => h('tr.clickable', { onclick: () => (location.hash = `#/view/purchase_orders/${x.po_id}`) },
          h('td.nowrap', { style: { color: x.due_date && x.due_date < d.today ? 'var(--bad)' : '' } }, x.due_date ? fmtDate(x.due_date) : '—', x.due_date && x.due_date < d.today ? ' ⚠' : ''),
          h('td', x.po_no), h('td.clip', x.vendor || ''), h('td.clip', x.description), h('td.num', inr(x.amount)))))) : h('div.muted', 'No payments scheduled. They are entered on each PO in the Commercial step.')),
      h('div.card', h('h2', 'POs waiting for the commercial step'), d.pos.waiting_commercial.length ? h('table.data', h('tbody', d.pos.waiting_commercial.map(x => h('tr.clickable', { onclick: () => (location.hash = `#/view/purchase_orders/${x.id}`) },
        h('td', x.po_no), h('td.clip', x.vendor || ''), h('td.num', inr(x.total)))))) : h('div.muted', 'Nothing waiting'),
        h('h2', { style: { marginTop: '16px' } }, 'Overdue customer invoices'), r.overdue_list.length ? h('table.data', h('tbody', r.overdue_list.map(x => h('tr.clickable', { onclick: () => (location.hash = `#/view/invoices/${x.id}`) },
          h('td', x.invoice_no), h('td.clip', x.customer || ''), h('td.nowrap', fmtDate(x.due_date)), h('td.num', inr(x.balance)))))) : h('div.muted', 'No overdue invoices'))),
  );
}
