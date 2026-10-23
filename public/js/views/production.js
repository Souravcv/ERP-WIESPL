// Production: finished goods made per day, and the production stock (raw material received from the store on MTNs,
// less what was returned and what the production entries used).
import { h, api, fmtDate, today, state } from '../ui.js';
import { canWrite } from '../schema.js';
import { inr } from '../calc.js';
import { newRecord } from './list.js';

const TABS = [['daily', '📅 Daily output'], ['stock', '📦 Production stock']];
const kpi = (l, v, sub) => h('div.kpi', h('div.label', l), h('div.value', v), sub ? h('div.sub', sub) : null);

export async function productionView(root, tab = 'daily') {
  const role = state.user.role;
  const head = h('div.page-head', h('h1', '🏭 Production'), h('div.actions',
    canWrite('material_requests', role) ? h('button.btn', { onclick: () => newRecord('material_requests', { department: 'Production', purpose: 'Production (to production stock)' }) }, '🙋 Material request to store') : null,
    h('a.btn', { href: '#/list/production_entries' }, '📋 All entries'),
    canWrite('production_entries', role) ? h('button.btn.primary', { onclick: () => newRecord('production_entries', {}) }, '+ Finished goods made') : null));
  const tabs = h('div.tabs', TABS.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { location.hash = `#/production/${k}`; } }, l)));
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(head, tabs, box);
  if (tab === 'stock') return stock(box);
  return daily(box);
}

async function daily(box) {
  const from = h('input', { type: 'date', value: today().slice(0, 8) + '01' }), to = h('input', { type: 'date', value: today() });
  const out = h('div');
  const load = async () => {
    const d = await api(`/production/daily?from=${from.value}&to=${to.value}`);
    const t = d.totals;
    out.replaceChildren(
      h('div.kpis', kpi('Pieces made', inr(t.pieces, 0), `${fmtDate(d.from)} – ${fmtDate(d.to)}`), kpi('Working days', t.working_days), kpi('Average per day', inr(t.per_day, 1), 'pieces'),
        kpi('Material value', `₹ ${inr(t.value, 0)}`, 'raw material used in them')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' } },
        h('div.card', h('h2', 'Per day'), d.days.length ? h('table.data', h('thead', h('tr', ['Date', 'Pieces', 'Items', 'Value'].map(x => h('th', x)))),
          h('tbody', d.days.map(x => h('tr', h('td', fmtDate(x.date)), h('td.num', inr(x.pieces, 0)), h('td.num', x.items), h('td.num', `₹ ${inr(x.value, 0)}`))))) : h('p.muted', 'Nothing posted in this period')),
        h('div.card', h('h2', 'Per finished good'), d.items.length ? h('table.data', h('thead', h('tr', ['Item', 'Made', 'Days', 'Per day'].map(x => h('th', x)))),
          h('tbody', d.items.map(x => h('tr', h('td', `${x.code || ''} ${x.name || ''}`), h('td.num', `${inr(x.qty, 0)} ${x.uom || ''}`), h('td.num', x.days), h('td.num', inr(x.qty / Math.max(1, t.working_days), 1)))))) : h('p.muted', 'None'))),
      h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, 'Day by day')),
        h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Finished good', 'Qty', 'Entries', 'Material value'].map(x => h('th', x)))),
          h('tbody', d.rows.map(r => h('tr', h('td.nowrap', fmtDate(r.date)), h('td', `${r.code || ''} ${r.name || ''}`), h('td.num', `${inr(r.qty, 0)} ${r.uom || ''}`), h('td.num', r.entries), h('td.num', `₹ ${inr(r.value, 0)}`))))))));
  };
  from.onchange = load; to.onchange = load;
  box.replaceChildren(h('div.toolbar', h('span.muted', 'From'), from, h('span.muted', 'to'), to, h('button.btn', { onclick: () => window.print() }, '🖨 Print')), out);
  await load();
}

async function stock(box) {
  const rows = await api('/production/stock');
  const value = rows.reduce((s, r) => s + Math.max(0, r.balance) * (r.rate || 0), 0);
  box.replaceChildren(
    h('p.muted', 'Raw material in production = received from the store on Material Transfer Notes (to “Production”) − returned to the store − used in posted production entries. Ask the store for more with a material request.'),
    h('div.kpis', kpi('Items in production', rows.filter(r => r.balance > 0).length), kpi('Value', `₹ ${inr(value, 0)}`, 'at item price'), kpi('Short / negative', rows.filter(r => r.balance < 0).length, 'used more than received')),
    h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Item', 'Received (MTN)', 'Returned', 'Used', 'In production', 'Value'].map(x => h('th', x)))),
      h('tbody', rows.map(r => h('tr', h('td', `${r.code || ''} ${r.name}`), h('td.num', inr(r.received, 2)), h('td.num', r.returned ? inr(r.returned, 2) : ''), h('td.num', r.used ? inr(r.used, 2) : ''),
        h('td.num', { style: { fontWeight: 600, color: r.balance < 0 ? 'var(--bad)' : '' } }, `${inr(r.balance, 2)} ${r.uom || ''}`), h('td.num', `₹ ${inr(Math.max(0, r.balance) * (r.rate || 0), 0)}`))))))));
}
