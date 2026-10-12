import { h, api, money, fmtDate, badge, tip, state, fail } from '../ui.js';
import { fyOf } from '../calc.js';
import { canView } from '../schema.js';
import { storeDashboard } from './storedash.js';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

// Horizontal single-hue bars (magnitude only); value printed at the end, hover shows the full label.
function hbars(rows, label, value, href) {
  if (!rows.length) return h('div.muted', 'No data yet');
  const max = Math.max(...rows.map(value), 1);
  return h('div.bars', rows.map(r => {
    const row = h(href ? 'a.bar-row' : 'div.bar-row', href ? { href: href(r), style: { color: 'inherit', textDecoration: 'none' } } : null,
      h('span.name', label(r)), h('span.track', h('span.fill', { style: { width: `${(value(r) / max) * 100}%`, display: 'block' } })), h('span.val', value(r)));
    tip(row, `${label(r)}: ${value(r)}`);
    return row;
  }));
}

function monthly(rows, fy) {
  const start = 2000 + Number(fy.split('-')[0]);
  const keyOf = i => `${i < 9 ? start : start + 1}-${String(((i + 3) % 12) + 1).padStart(2, '0')}`;
  const data = MONTHS.map((m, i) => ({ m, ...(rows.find(r => r.month === keyOf(i)) || { enquiries: 0, won: 0 }) }));
  const max = Math.max(...data.map(d => d.enquiries), 1);
  const chart = h('div.colchart', data.map(d => {
    const col = h('div.col', d.enquiries ? h('span.v', d.enquiries) : null, h('div.b', { style: { height: `${(d.enquiries / max) * 85}%` } }));
    tip(col, `${d.m}: ${d.enquiries} enquiries, ${d.won} won`);
    return col;
  }));
  return h('div', chart, h('div.collabels', data.map(d => h('span', d.m))));
}

// Each person sees the dashboard of their work: sales / CRM, store, or both (as tabs).
export async function dashboardView(root) {
  const role = state.user.role;
  const views = [canView('enquiries', role) && ['crm', '📈 Sales & CRM'], canView('items', role) && ['store', '🏬 Store']].filter(Boolean);
  if (!views.length) { root.replaceChildren(h('div.page-head', h('h1', '📊 Dashboard')), h('div.card', h('p', `Welcome, ${state.user.name}. Use the menu on the left.`))); return; }
  let tab = sessionStorage.getItem('dash-tab');
  if (!views.some(v => v[0] === tab)) tab = role === 'store' || !views.some(v => v[0] === 'crm') ? 'store' : views[0][0];
  if (tab === 'crm') return crmDashboard(root, views);
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(h('div.page-head', h('h1', '📊 Store Dashboard'), h('div.actions', h('a.btn', { href: '#/stock-summary' }, '📊 Stock Summary'), h('a.btn.primary', { href: '#/stock-entry' }, '🔁 Stock Entry'))),
    tabsOf(views, 'store', root), box);
  await storeDashboard(box).catch(e => { box.replaceChildren(h('div.card', e.message)); fail(e); });
}
function tabsOf(views, active, root) {
  if (views.length < 2) return null;
  return h('div.tabs', views.map(([k, label]) => h('button', { class: k === active ? 'active' : '', onclick: () => { sessionStorage.setItem('dash-tab', k); dashboardView(root); } }, label)));
}

async function crmDashboard(root, views) {
  const cur = fyOf();
  const fySel = h('select', { style: { width: 'auto' } }, [0, 1, 2].map(n => {
    const [a] = cur.split('-').map(Number);
    const fy = `${String(a - n).padStart(2, '0')}-${String(a - n + 1).padStart(2, '0')}`;
    return h('option', { value: fy }, `FY 20${fy}`);
  }));
  fySel.value = sessionStorage.getItem('dash-fy') || cur;
  fySel.onchange = () => { sessionStorage.setItem('dash-fy', fySel.value); dashboardView(root); };
  const d = await api(`/dashboard?fy=${fySel.value}`);
  const k = d.kpi;
  const kpi = (label, value, sub, href) => h('a.kpi', { href }, h('div.label', label), h('div.value', value), sub ? h('div.sub', sub) : null);

  root.replaceChildren(
    h('div.page-head', h('h1', '📊 Dashboard'), h('div.actions', fySel,
      h('a.btn.primary', { href: '#/edit/enquiries/new' }, '+ New Enquiry'))),
    tabsOf(views, 'crm', root),
    h('div.kpis',
      kpi('Enquiries this FY', k.enquiries, `${k.won} won · ${k.lost} lost/regret`, '#/list/enquiries'),
      kpi('Win rate', k.conversion == null ? '—' : `${k.conversion}%`, 'won ÷ (won + lost)', '#/list/enquiries?status=Won'),
      kpi('Quotes in pipeline', money(k.open_quote_value).replace('.00', ''), 'approved / sent / pending', '#/list/quotations'),
      kpi('Orders booked (basic)', money(k.order_value).replace('.00', ''), `FY ${d.fy}`, '#/list/sales_orders'),
      kpi('Receivable', money(k.receivable).replace('.00', ''), `collected ${money(k.collected).replace('.00', '')}`, '#/list/invoices'),
      kpi('Pending approvals', k.pending_approvals, `${k.pending_material} client submittals awaiting`, '#/list/approvals?status=Pending'),
      kpi('Active projects', k.active_projects, null, '#/list/projects?status=Active'),
      kpi('Open service tickets', k.open_tickets, null, '#/list/service_tickets'),
      kpi('Stock value', money(d.stock_value).replace('.00', ''), `${d.low_stock.length} items below minimum`, '#/stock-summary'),
      kpi('Purchase pipeline', d.pending_po, `POs waiting for approval · ${d.pending_req} requisitions`, '#/list/approvals?status=Pending'),
    ),
    h('div.grid.cols-2',
      h('div.card', h('h2', 'Enquiries per month'), monthly(d.monthly, d.fy)),
      h('div.card', h('h2', 'Follow-ups due (next 7 days & overdue)'),
        d.followups_due.length ? h('table.data', h('tbody', d.followups_due.map(f => h('tr.clickable', {
          onclick: () => (location.hash = f.kind === 'enquiry' ? `#/view/enquiries/${f.id}` : `#/view/followups/${f.id}`),
        }, h('td.nowrap', fmtDate(f.due), f.due < d.today ? [' ', badge('Overdue')] : null), h('td', f.ref || ''), h('td.clip', f.title || ''), h('td', f.who || ''))))) : h('div.muted', 'Nothing due. 🎉')),
    ),
    h('div.grid.cols-3',
      h('div.card', h('h2', 'Enquiries by status'), hbars(d.enquiry_status.sort((a, b) => b.n - a.n), r => r.status || '(blank)', r => r.n, r => `#/list/enquiries?status=${encodeURIComponent(r.status || '')}`)),
      h('div.card', h('h2', 'Enquiries by sales person'), hbars(d.by_person, r => r.person, r => r.n)),
      h('div.card', h('h2', 'Type of work'), hbars(d.by_work, r => r.work, r => r.n)),
    ),
    h('div.grid.cols-3',
      h('div.card', h('h2', 'Waiting for approval'), d.approvals.length ? h('table.data', h('tbody', d.approvals.map(a => h('tr.clickable', { onclick: () => (location.hash = `#/view/approvals/${a.id}`) },
        h('td', a.doc_type), h('td', a.doc_ref), h('td.num', money(a.amount)), h('td', a.requested_by))))) : h('div.muted', 'No pending approvals')),
      h('div.card', h('h2', 'Projects by stage'), hbars(d.projects, r => r.stage, r => r.n)),
      h('div.card', h('h2', 'Low stock'), d.low_stock.length ? h('table.data', h('tbody', d.low_stock.map(i => h('tr.clickable', { onclick: () => (location.hash = `#/view/items/${i.id}`) },
        h('td', i.name), h('td.num', `${i.stock} ${i.uom || ''}`), h('td.num.muted', `min ${i.reorder_level}`))))) : h('div.muted', 'All items above reorder level')),
    ),
    h('div.card', h('h2', 'Latest enquiries'), d.recent.length ? h('table.data', h('thead', h('tr', ['Enquiry No', 'Date', 'Hospital', 'Doctor', 'Place', 'Work', 'Status'].map(t => h('th', t)))),
      h('tbody', d.recent.map(e => h('tr.clickable', { onclick: () => (location.hash = `#/view/enquiries/${e.id}`) },
        h('td', e.enquiry_no), h('td', fmtDate(e.date)), h('td', e.hospital_name || ''), h('td', e.doctor_name || ''), h('td', e.place || ''), h('td', e.type_of_work || ''), h('td', badge(e.status)))))) : h('div.muted', 'No enquiries yet. Add one, or import your Excel register from Admin → Import.')),
  );
}
