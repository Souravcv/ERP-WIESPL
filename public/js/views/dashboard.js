import { h, api, money, fmtDate, badge, tip, state, fail } from '../ui.js';
import { fyOf } from '../calc.js';
import { canView, hasFunction } from '../schema.js';
import { storeDashboard } from './storedash.js';
import { accountsDashboard } from './accountsdash.js';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
// An enquiry's Type of Work from raw SQL: a JSON list (or older plain text) → "MOT, ICU".
const workText = v => { try { const a = JSON.parse(v); if (Array.isArray(a)) return a.join(', '); } catch { /* plain text */ } return v || ''; };

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

// Visitors who started the client enquiry form but did not send it (follow up if they left a phone number).
function webLeadsCard() {
  const box = h('div.card', h('h2', '🌐 Website form: started but not sent'), h('div.muted', 'Loading…'));
  api('/web-leads').then(rows => {
    box.lastChild.replaceWith(rows.length ? h('table.data', h('thead', h('tr', ['Last active', 'Reached step', 'Interested in', 'Name / phone'].map(t => h('th', t)))),
      h('tbody', rows.slice(0, 15).map(r => h('tr', h('td.nowrap', r.updated_at), h('td', r.step + 1), h('td.clip', r.types.join(', ') || '—'), h('td', [r.name, r.phone].filter(Boolean).join(' · ') || h('span.muted', 'not given yet'))))))
      : h('div.muted', 'None in the last 30 days. Share the form from Enquiry Register → 🔗 Client enquiry form.'));
  }).catch(() => box.remove());
  return box;
}

// Each person sees the dashboard of their work: sales / CRM, store, or both (as tabs).
export async function dashboardView(root) {
  const role = state.user.role;
  const views = [canView('enquiries', role) && ['crm', '📈 Sales & CRM'], canView('items', role) && ['store', '🏬 Store'],
    (canView('invoices', role) || hasFunction(role, 'po_commercial')) && ['accounts', '💼 Accounts'],
    canView('projects', role) && canView('purchase_orders', role) && ['projects', '🏗️ Projects'], canView('service_tickets', role) && ['service', '🛠️ Service']].filter(Boolean);
  if (!views.length) { root.replaceChildren(h('div.page-head', h('h1', '📊 Dashboard')), h('div.card', h('p', `Welcome, ${state.user.name}. Use the menu on the left.`))); return; }
  let tab = sessionStorage.getItem('dash-tab');
  if (!views.some(v => v[0] === tab)) {
    const pref = { accounts: 'accounts', store: 'store', service: 'service', engineer: 'service' }[role];
    tab = views.some(v => v[0] === pref) ? pref : views[0][0];
  }
  if (tab === 'crm') return crmDashboard(root, views);
  if (tab === 'service') {
    const sbox = h('div');
    root.replaceChildren(tabsOf(views, 'service', root), sbox);
    const { serviceView } = await import('./service.js');
    await serviceView(sbox, { embedded: true });
    return;
  }
  if (tab === 'projects') {
    // Pick a project: its POs, approvals, received, bills, payments, requisitions, BOQs, store issues and sales.
    const pbox = h('div');
    root.replaceChildren(tabsOf(views, 'projects', root), pbox);
    const { projectAnalysisView } = await import('./projectanalysis.js');
    await projectAnalysisView(pbox, sessionStorage.getItem('dash-project') || null);
    return;
  }
  if (tab === 'accounts') {
    const abox = h('div', h('div.muted', 'Loading…'));
    root.replaceChildren(h('div.page-head', h('h1', '💼 Accounts Dashboard'), h('div.actions', h('a.btn', { href: '#/list/purchase_orders' }, '🛒 Purchase Orders'), h('a.btn', { href: '#/list/invoices' }, '💳 Invoices'))),
      tabsOf(views, 'accounts', root), abox);
    await accountsDashboard(abox).catch(e => { abox.replaceChildren(h('div.card', e.message)); fail(e); });
    return;
  }
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
    webLeadsCard(),
    h('div.card', h('h2', 'Latest enquiries'), d.recent.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Enquiry No', 'Date', 'Hospital', 'Client', 'Place', 'Work', 'Status'].map(t => h('th', t)))),
      h('tbody', d.recent.map(e => h('tr.clickable', { onclick: () => (location.hash = `#/view/enquiries/${e.id}`) },
        h('td', e.enquiry_no), h('td', fmtDate(e.date)), h('td', e.hospital_name || ''), h('td', e.client_name || ''), h('td', e.place || ''), h('td', workText(e.type_of_work)), h('td', badge(e.status))))))) : h('div.muted', 'No enquiries yet. Add one, or import your Excel register from Admin → Import.')),
  );
}
