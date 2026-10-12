// Store dashboard: this FY's opening / inward / outward / closing (qty and value), the last 6 months,
// challans, requisitions and POs, ABC / FSN and what the store should look at.
import { h, api, money, badge, tip } from '../ui.js';
import { inr } from '../calc.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = m => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const short = v => {
  const n = Math.abs(v);
  if (n >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return String(Math.round(v * 100) / 100);
};
const rs = v => `₹ ${short(v)}`;
const qn = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); // quantities in full (L could be read as litres)

// Inward vs outward per month, one measure per chart (never two scales on one axis).
function pairChart(rows, inKey, outKey, fmt, title) {
  const max = Math.max(1, ...rows.flatMap(r => [r[inKey], r[outKey]]));
  const col = (r, key, cls, name) => {
    const bar = h('div.gbar.' + cls, { style: { height: `${Math.max(r[key] ? 2 : 0, (r[key] / max) * 100)}%` } });
    tip(bar, `${monLabel(r.month)} · ${name}: ${fmt(r[key])}`);
    return bar;
  };
  return h('div.card', h('h2', title),
    h('div.legend', h('span', h('i.sw.s-in'), 'Inward'), h('span', h('i.sw.s-out'), 'Outward (issue + transfer)')),
    h('div.gchart', rows.map(r => h('div.ggroup', h('div.gbars', col(r, inKey, 's-in', 'Inward'), col(r, outKey, 's-out', 'Outward')), h('div.glabel', monLabel(r.month))))),
    h('details', h('summary.muted', 'Show as table'), h('table.data', h('thead', h('tr', h('th', 'Month'), h('th.num', 'Inward'), h('th.num', 'Outward'))),
      h('tbody', rows.map(r => h('tr', h('td', monLabel(r.month)), h('td.num', fmt(r[inKey])), h('td.num', fmt(r[outKey]))))))));
}

function statusBars(title, rows, href) {
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!total) return h('div.card', h('h2', title), h('div.muted', 'None yet'));
  const max = Math.max(...rows.map(r => r.n));
  return h('div.card', h('h2', `${title} `, h('span.muted', `(${total})`)),
    h('div.bars', rows.map(r => {
      const row = h('a.bar-row', { href: href(r.status), style: { color: 'inherit', textDecoration: 'none' } },
        h('span.name', badge(r.status || '—')), h('span.track', h('span.fill', { style: { width: `${(r.n / max) * 100}%`, display: 'block' } })), h('span.val', r.n));
      tip(row, `${r.status || '—'}: ${r.n}`);
      return row;
    })));
}

export async function storeDashboard(box) {
  const d = await api('/dashboard/store');
  const t = d.totals, a = d.attention;
  const kpi = (label, value, sub, href) => h(href ? 'a.kpi' : 'div.kpi', href ? { href } : {}, h('div.label', label), h('div.value', value), sub ? h('div.sub', sub) : null);
  const fy = `${d.from.slice(0, 4)}-${d.to.slice(2, 4)}`;
  const tips = [
    a.negative && [`${a.negative} item(s) show negative stock – an inward or opening entry is missing; check and correct them.`, '#/stock-summary?only=negative'],
    a.low && [`${a.low} item(s) are at or below their minimum level – raise a requisition.`, '#/stock-summary?only=low'],
    a.non_moving && [`${a.non_moving} item(s) worth ${rs(a.non_moving_value)} have not been issued this year (non-moving). Use them on projects, return to vendor or scrap.`, '#/stock-summary'],
    a.no_price && [`${a.no_price} item(s) in stock have no price, so the stock value is understated – enter their price in the item master.`, '#/list/items'],
    a.no_min_level && [`${a.no_min_level} fast-moving item(s) have no minimum stock level – set one so low stock is flagged in time.`, '#/list/items'],
    d.pending_grn && [`${d.pending_grn} approved PO(s) still have material to receive – check with the vendors.`, '#/po-tracker?state=pending'],
  ].filter(Boolean);
  box.replaceChildren(
    h('p.muted', `Financial year ${fy}: ${d.from.split('-').reverse().join('/')} to ${d.to.split('-').reverse().join('/')}. Values at item price.`),
    h('div.kpis',
      kpi('Total items', t.items, `${t.in_stock} in stock`, '#/list/items'),
      kpi('Opening stock (1 April)', qn(t.opening_qty), rs(t.opening_value), '#/stock-summary'),
      kpi('Inward this FY', qn(t.inward_qty), rs(t.inward_value), '#/list/stock_moves?type=INWARD'),
      kpi('Outward this FY', qn(t.outward_qty), `${rs(t.outward_value)} · issue + transfer`, '#/list/stock_moves?type=OUTWARD'),
      kpi('Closing stock', qn(t.closing_qty), rs(t.closing_value), '#/stock-summary'),
      kpi('Returns / scrap', `${qn(t.return_qty)} / ${qn(t.scrap_qty)}`, 'qty this FY')),
    h('div.grid.cols-2', pairChart(d.monthly, 'in_qty', 'out_qty', qn, 'Last 6 months – quantity'), pairChart(d.monthly, 'in_value', 'out_value', v => rs(v), 'Last 6 months – value (₹)')),
    h('div.grid.cols-3',
      statusBars('Delivery challans', d.challans, s => `#/list/challans?status=${encodeURIComponent(s)}`),
      statusBars('Material requisitions', d.requisitions, s => `#/list/requisitions?status=${encodeURIComponent(s)}`),
      statusBars('Purchase orders', d.purchase_orders, s => `#/list/purchase_orders?status=${encodeURIComponent(s)}`)),
    h('div.card', h('h2', '🔍 Store analysis – what to improve'),
      tips.length ? h('ul', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.7 } }, tips.map(([text, href]) => h('li', h('a', { href }, text)))) : h('div.muted', 'Nothing needs attention. 👍'),
      h('div.grid.cols-2', { style: { marginTop: '12px' } },
        h('div', h('b', 'ABC (consumption value this FY)'), h('table.data', h('thead', h('tr', h('th', 'Class'), h('th.num', 'Items'), h('th.num', 'Consumption'))),
          h('tbody', d.abc.map(x => h('tr', h('td', x.cls), h('td.num', x.n), h('td.num', inr(x.value))))))),
        h('div', h('b', 'FSN (movement this FY)'), h('table.data', h('thead', h('tr', h('th', 'Class'), h('th.num', 'Items'), h('th.num', 'Stock value'))),
          h('tbody', d.fsn.map(x => h('tr', h('td', { FAST: 'Fast moving', SLOW: 'Slow moving', 'NON-M': 'Non-moving' }[x.cls]), h('td.num', x.n), h('td.num', inr(x.value))))))))),
    h('div.grid.cols-2',
      h('div.card', h('h2', 'Most consumed this FY'), d.top_consumed.length ? h('table.data', h('thead', h('tr', h('th', 'Item'), h('th.num', 'Qty out'), h('th.num', 'Value'))),
        h('tbody', d.top_consumed.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/items/${r.id}`) }, h('td.clip', `${r.code} · ${r.name}`), h('td.num', `${qn(r.qty)} ${r.uom || ''}`), h('td.num', inr(r.value)))))) : h('div.muted', 'No issues yet')),
      h('div.card', h('h2', 'Highest stock value'), d.top_stock.length ? h('table.data', h('thead', h('tr', h('th', 'Item'), h('th.num', 'In stock'), h('th.num', 'Value'), h('th', 'FSN'))),
        h('tbody', d.top_stock.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/items/${r.id}`) }, h('td.clip', `${r.code} · ${r.name}`), h('td.num', `${qn(r.qty)} ${r.uom || ''}`), h('td.num', inr(r.value)), h('td', r.fsn))))) : h('div.muted', 'No stock'))),
  );
}
