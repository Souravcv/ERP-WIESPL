// Production: the orders board (released against drawing + BOM + material), the monthly plan vs actual per week, the
// daily review of the supervisors' reports, the delay analysis; and the finished goods made per day and the
// production stock (raw material received from the store on MTNs, less what was returned and what the entries used).
import { h, api, fmtDate, today, state, badge, fail, toast } from '../ui.js';
import { canWrite, canView } from '../schema.js';
import { inr } from '../calc.js';
import { newRecord } from './list.js';

const TABS = [['orders', '🧾 Orders', 'production_orders'], ['plan', '🗓️ Plan vs actual', 'production_orders'], ['day', '📋 Daily review', 'production_orders'], ['delays', '⏱ Delay analysis', 'production_orders'],
  ['quality', '🔍 Quality', 'qc_inspections'], ['daily', '📅 Finished goods output', 'production_entries'], ['stock', '📦 Production stock', 'production_entries']];
const kpi = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, String(v ?? '–')), sub ? h('div.sub', sub) : null);
const q = v => (v == null || v === '' ? '' : inr(v, Number(v) % 1 ? 2 : 0));
const param = k => new URLSearchParams(location.hash.split('?')[1] || '').get(k);
const pct = (v, good = 95, ok = 80) => (v == null ? null : v >= good ? 'var(--good)' : v >= ok ? 'var(--warn)' : 'var(--bad)');
const bar = p => h('div', { style: { background: 'var(--border)', borderRadius: '4px', height: '8px', width: '90px', display: 'inline-block', verticalAlign: 'middle' } },
  h('div', { style: { width: `${Math.min(100, p || 0)}%`, height: '100%', borderRadius: '4px', background: p >= 100 ? 'var(--good)' : 'var(--bar)' } }));
const orderLink = (id, no) => h('a', { href: `#/view/production_orders/${id}` }, no || `#${id}`);
const card = (title, ...c) => h('div.card', title ? h('h2', title) : null, ...c);
const tableOf = (cols, rows, foot) => h('div.table-wrap', h('table.data', h('thead', h('tr', cols.map(c => h('th', c)))), h('tbody', rows), foot ? h('tfoot', foot) : null));

// Today's daily report of this supervisor (the draft, or a new one filled with the released orders and today's plan).
async function openDayReport(date = today()) {
  const mine = (await api(`/production_reports?date=${date}`)).find(r => r.date === date && r.status === 'Draft' && r.supervisor === state.user.name);
  if (mine) { location.hash = `#/view/production_reports/${mine.id}`; return; }
  const lines = await api(`/production/suggest-day?date=${date}`);
  const r = await api('/production_reports', { method: 'POST', body: { date, supervisor: state.user.name, lines } });
  location.hash = `#/view/production_reports/${r.id}`;
}
// A month's plan (opened, or made with every open order).
async function openPlan(month) {
  const p = (await api(`/production_plans?month=${month}`)).find(x => x.month === month);
  if (p) { location.hash = `#/view/production_plans/${p.id}`; return; }
  const lines = await api(`/production/fill-plan?month=${month}`);
  const r = await api('/production_plans', { method: 'POST', body: { month, lines } });
  toast(`Plan ${r.plan_no} made with ${lines.length} open order(s): set the targets and weeks`);
  location.hash = `#/view/production_plans/${r.id}`;
}

export async function productionView(root, tab) {
  const role = state.user.role;
  const tabs = TABS.filter(t => canView(t[2], role));
  if (!tabs.length) { root.replaceChildren(h('div.empty', 'No access to production')); return; }
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  const planning = canView('production_orders', role);
  const head = h('div.page-head', h('h1', '🏭 Production'), h('div.actions',
    planning && canWrite('production_reports', role) ? h('button.btn.primary', { onclick: () => openDayReport().catch(fail) }, '📋 Today’s daily report') : null,
    planning && canWrite('production_orders', role) ? h('button.btn', { onclick: () => newRecord('production_orders', {}) }, '+ Production order') : null,
    canWrite('material_requests', role) ? h('button.btn', { onclick: () => newRecord('material_requests', { department: 'Production', purpose: 'Production (to production stock)' }) }, '🙋 Material request to store') : null,
    canWrite('production_entries', role) && ['daily', 'stock'].includes(tab) ? h('button.btn', { onclick: () => newRecord('production_entries', {}) }, '+ Finished goods made') : null));
  const bar2 = h('div.tabs', tabs.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { location.hash = `#/production/${k}`; } }, l)));
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(head, bar2, box);
  if (tab === 'orders') return orders(box);
  if (tab === 'plan') return plan(box);
  if (tab === 'day') return day(box);
  if (tab === 'delays') return delays(box);
  if (tab === 'quality') return quality(box);
  if (tab === 'stock') return stock(box);
  return daily(box);
}

// ---------------------------------------------------------------- orders board
async function orders(box) {
  const b = await api('/production/board');
  const k = b.kpi, role = state.user.role;
  const notes = [];
  if (!b.last_day_reported && b.orders.some(o => ['Released', 'In production'].includes(o.status))) notes.push(h('div', '⚠ No submitted daily report for ', h('a', { href: `#/production/day?date=${b.last_working_day}` }, fmtDate(b.last_working_day)), '.'));
  if (!b.plan) notes.push(h('div', `⚠ No production plan for this month. `, canWrite('production_plans', role) ? h('a', { href: '#', onclick: e => { e.preventDefault(); openPlan(today().slice(0, 7)).catch(fail); } }, 'Make it now') : null));
  if (Number(today().slice(8, 10)) >= 20 && b.next_plan?.status !== 'Approved') notes.push(h('div', `🗓 Plan for ${b.next_month}: ${b.next_plan ? b.next_plan.status : 'not made yet'} – due before the 25th. `,
    canWrite('production_plans', role) ? h('a', { href: '#', onclick: e => { e.preventDefault(); openPlan(b.next_month).catch(fail); } }, b.next_plan ? 'Open it' : 'Make it now') : null));
  const filter = h('select', ['Open', 'Not released', 'In production', 'Late', 'On hold', 'Completed this month', 'All'].map(x => h('option', x)));
  const list = h('div');
  const show = () => {
    const f = filter.value;
    const rows = b.orders.filter(o => f === 'All' || (f === 'Open' && o.status !== 'Completed') || (f === 'Not released' && o.status === 'Draft') || (f === 'In production' && ['Released', 'In production'].includes(o.status))
      || (f === 'Late' && o.late) || (f === 'On hold' && o.status === 'On hold') || (f === 'Completed this month' && o.status === 'Completed'));
    list.replaceChildren(rows.length ? h('div.card.flush', tableOf(['Order', 'Project', 'Product', 'Done / Qty', 'Progress', 'Stage', 'Target', 'Dispatch', 'Priority', 'Responsible', 'Release check', 'Status'],
      rows.map(o => h('tr', h('td.nowrap', orderLink(o.id, o.order_no)), h('td', { title: o.project_no || '' }, o.project || ''), h('td', h('div', o.description), h('div.muted', { style: { fontSize: '12px' } }, o.category)),
        h('td.num.nowrap', `${q(o.qty_done)} / ${q(o.qty)} ${o.uom || ''}`), h('td.nowrap', bar(o.progress), ` ${o.progress}%`), h('td', o.stage || '—'),
        h('td.nowrap', { style: { color: o.late ? 'var(--bad)' : '' } }, fmtDate(o.target_date), o.late ? ' ⚠' : ''), h('td.nowrap', fmtDate(o.dispatch_date)), h('td', badge(o.priority)), h('td', o.responsible || ''),
        h('td.nowrap', { title: `Drawing ${o.checks.drawing ? 'approved' : 'missing'}, BOM ${o.checks.bom ? 'verified' : 'not verified'}, material ${o.checks.material || 'not checked'}` },
          `${o.checks.drawing ? '✔' : '✘'} Dwg  ${o.checks.bom ? '✔' : '✘'} BOM  ${o.checks.material === 'Available' ? '✔' : o.checks.material.startsWith('Partly') ? '◐' : '✘'} Mat`),
        h('td', badge(o.status), o.hold_reason && o.status === 'On hold' ? h('div.muted', { style: { fontSize: '11px' } }, o.hold_reason) : null))))) : h('p.muted', 'No orders here.'));
  };
  filter.onchange = show;
  box.replaceChildren(
    h('div.kpis', kpi('Open orders', k.open), kpi('Not released', k.draft, 'drawing / BOM / material pending', k.draft ? 'var(--warn)' : null), kpi('Released / in production', k.running),
      kpi('Late', k.late, 'past the target date', k.late ? 'var(--bad)' : null), kpi('On hold', k.hold, '', k.hold ? 'var(--warn)' : null), kpi('Completed this month', k.completed_month, '', 'var(--good)')),
    notes.length ? h('div.card', { style: { borderLeft: '4px solid var(--warn)' } }, ...notes) : null,
    h('div.toolbar', h('span.muted', 'Show'), filter, h('a.btn', { href: '#/list/production_orders' }, '📋 All orders')), list);
  show();
}

// ---------------------------------------------------------------- monthly plan vs actual (weekly review + monthly closing)
async function plan(box) {
  const month = h('input', { type: 'month', value: param('month') || today().slice(0, 7) });
  const out = h('div');
  const load = async () => {
    const m = await api(`/production/month?month=${month.value}`);
    const t = m.totals, role = state.user.role;
    const head = m.plan ? h('div', 'Plan ', h('a', { href: `#/view/production_plans/${m.plan.id}` }, m.plan.plan_no), ` rev ${m.plan.rev || 0} · `, badge(m.plan.status), m.plan.approved_by ? h('span.muted', ` · approved by ${m.plan.approved_by}`) : null)
      : h('div', '⚠ No plan for this month. ', canWrite('production_plans', role) ? h('button.btn.small', { onclick: () => openPlan(month.value).catch(fail) }, '🗓 Make the plan') : null);
    const cur = m.current_week;
    const cell = (r, i) => {
      const w = m.weeks[i], p = r.week_plan[i], a = r.week_actual[i];
      const behind = w.n < cur && a < p;
      return h('td.num.nowrap', { style: { background: w.n === cur ? 'var(--hover, rgba(0,0,0,.04))' : '', color: behind ? 'var(--bad)' : '' } }, p || a ? `${q(p)} / ${q(a)}` : '');
    };
    out.replaceChildren(
      h('div.card', head),
      h('div.kpis', kpi('Target (planned orders)', q(t.target)), kpi('Made against plan', q(t.actual)), kpi('Achievement', t.achievement != null ? t.achievement + '%' : '–', 'target > 95%', pct(t.achievement)),
        kpi('On-time completion', t.on_time_pct != null ? t.on_time_pct + '%' : '–', `${t.on_time} of ${t.orders_due} due so far`, pct(t.on_time_pct)), kpi('Man-hours', q(t.hours), `${t.days_reported} day(s) reported of ${t.working_days}`),
        kpi('Rejected / rework', q(t.rejected), t.done_all ? `${Math.round((100 * t.rejected) / (t.done_all + t.rejected))}% of all made (target < 2%)` : '', t.done_all && t.rejected / (t.done_all + t.rejected) > 0.02 ? 'var(--bad)' : null)),
      h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, 'Plan / actual per week (finished qty)'),
        h('div.muted', { style: { fontSize: '12px' } }, m.weeks.map(w => `W${w.n} ${fmtDate(w.from)}–${fmtDate(w.to)} (${w.working_days} days)`).join(' · '), '. Red = behind plan in a past week.')),
        m.rows.length ? tableOf(['Order', 'Product', 'Target', ...m.weeks.map(w => `W${w.n}${w.n === cur ? ' (now)' : ''}`), 'Actual', 'Ach. %', 'Behind now', 'Order balance', 'Target date', 'Man-hrs', 'Delays'],
          m.rows.map(r => h('tr', h('td.nowrap', orderLink(r.order_id, r.order_no), r.planned ? null : h('div.muted', { style: { fontSize: '11px' } }, 'not in plan')), h('td', r.description, h('div.muted', { style: { fontSize: '12px' } }, r.project || '')),
            h('td.num', q(r.target)), m.weeks.map((w, i) => cell(r, i)), h('td.num', q(r.actual)), h('td.num', { style: { color: pct(r.achievement) || '' } }, r.achievement != null ? r.achievement + '%' : ''),
            h('td.num', { style: { color: r.behind ? 'var(--bad)' : '' } }, r.behind ? q(r.behind) : ''), h('td.num', `${q(r.balance)} ${r.uom || ''}`),
            h('td.nowrap', { style: { color: r.late ? 'var(--bad)' : '' } }, fmtDate(r.target_date)), h('td.num', q(r.hours)), h('td', r.delays || ''))),
          h('tr', h('th', 'Total'), h('th'), h('th.num', q(t.target)), m.weeks.map((w, i) => h('th.num', `${q(t.week_plan[i])} / ${q(t.week_actual[i])}`)), h('th.num', q(t.actual)), h('th.num', t.achievement != null ? t.achievement + '%' : ''), h('th', { colSpan: 5 })))
          : h('p.muted', { style: { padding: '0 16px 12px' } }, 'Nothing planned or made this month.')));
  };
  month.onchange = () => { load().catch(fail); };
  box.replaceChildren(h('div.toolbar', h('span.muted', 'Month'), month, h('button.btn', { onclick: () => window.open(`#/print/prodmonth/${month.value}`, '_blank') }, '🖨 Monthly closing report')), out);
  await load();
}

// ---------------------------------------------------------------- daily review
async function day(box) {
  const date = h('input', { type: 'date', value: param('date') || today() });
  const out = h('div');
  const load = async () => {
    const d = await api(`/production/day?date=${date.value}`);
    const t = d.totals;
    out.replaceChildren(
      h('div.kpis', kpi('Planned', q(t.planned)), kpi('Done', q(t.done)), kpi('Achievement', t.achievement != null ? t.achievement + '%' : '–', 'done ÷ planned', pct(t.achievement)), kpi('Workers', t.manpower || '–'),
        kpi('Man-hours', q(t.hours)), kpi('Lines behind plan', t.delays, 'with a delay code', t.delays ? 'var(--warn)' : null), kpi('Rejected / rework', q(t.rejected), '', t.rejected ? 'var(--bad)' : null)),
      d.reports.length ? h('div.card', h('h2', 'Reports'), h('div', d.reports.map(r => h('div', h('a', { href: `#/view/production_reports/${r.id}` }, r.report_no), ` · ${r.shift} · ${r.supervisor || ''} · ${r.manpower || 0} workers · `, badge(r.status)))))
        : h('div.card', { style: { borderLeft: '4px solid var(--warn)' } }, d.working ? '⚠ No daily production report for this day. ' : 'Off day (Sunday / holiday). ',
          canWrite('production_reports', state.user.role) ? h('button.btn.small', { onclick: () => openDayReport(date.value).catch(fail) }, '📋 Make the report') : null),
      d.lines.length ? h('div.card.flush', tableOf(['Order', 'Product', 'Stage', 'Planned', 'Done', 'Short', 'Rej.', 'Workers', 'Man-hrs', 'Delay code', 'Remark', 'Report'],
        d.lines.map(l => h('tr', h('td.nowrap', orderLink(l.order_id, l.order_no)), h('td', l.description || ''), h('td', l.stage || ''), h('td.num', q(l.planned)), h('td.num', q(l.done)),
          h('td.num', { style: { color: l.short ? 'var(--bad)' : '' } }, l.short ? q(l.short) : ''), h('td.num', q(l.rejected)), h('td.num', q(l.workers)), h('td.num', q(l.hours)),
          h('td', l.delay_code || ''), h('td', l.remark || ''), h('td.nowrap', h('a', { href: `#/view/production_reports/${l.report_id}` }, l.report_no), l.status === 'Draft' ? ' (draft)' : ''))))) : null,
      d.idle.length ? card(`Released orders not worked on (${d.idle.length})`, h('div', d.idle.map(o => h('div', orderLink(o.id, o.order_no), ` · ${o.description} · target ${fmtDate(o.target_date)}`)))) : null);
  };
  const step = n => { const x = new Date(date.value + 'T00:00:00'); x.setDate(x.getDate() + n); date.value = x.toLocaleString('sv-SE').slice(0, 10); load().catch(fail); };
  date.onchange = () => { load().catch(fail); };
  box.replaceChildren(h('div.toolbar', h('button.btn.small', { onclick: () => step(-1) }, '◀'), date, h('button.btn.small', { onclick: () => step(1) }, '▶')), out);
  await load();
}

// ---------------------------------------------------------------- delay analysis
async function delays(box) {
  const from = h('input', { type: 'date', value: today().slice(0, 8) + '01' }), to = h('input', { type: 'date', value: today() });
  const out = h('div');
  const load = async () => {
    const d = await api(`/production/delays?from=${from.value}&to=${to.value}`);
    const max = Math.max(1, ...d.codes.map(c => c.times));
    out.replaceChildren(
      h('div.kpis', kpi('Delays reported', d.total), ...d.groups.map(g => kpi(g.label, g.times, `${Math.round((100 * g.times) / (d.total || 1))}%`))),
      d.codes.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' } },
        card('By delay code', h('div', { style: { display: 'grid', gap: '6px' } }, d.codes.map(c => h('div.bar-row', { style: { gridTemplateColumns: '190px 1fr 60px' }, title: c.notes.join('\n') },
          h('span.name', c.code), h('div.track', h('div.fill', { style: { width: `${(100 * c.times) / max}%` } })), h('span.val', `${c.times} · ${c.share}%`))))),
        card('Quantity lost', h('table.data', h('thead', h('tr', ['Code', 'Times', 'Days', 'Qty short', 'Orders'].map(x => h('th', x)))),
          h('tbody', d.codes.map(c => h('tr', h('td', c.code), h('td.num', c.times), h('td.num', c.days), h('td.num', q(c.short)), h('td', c.orders.join(', '))))))))
        : h('p.muted', 'No delays reported in this period.'),
      d.lines.length ? h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, 'Every delay')),
        tableOf(['Date', 'Order', 'Stage', 'Planned', 'Done', 'Short', 'Code', 'Remark'], d.lines.map(l => h('tr', h('td.nowrap', h('a', { href: `#/view/production_reports/${l.report_id}` }, fmtDate(l.date))),
          h('td', orderLink(l.order_id, l.order_no), ' ', l.description || ''), h('td', l.stage || ''), h('td.num', q(l.planned)), h('td.num', q(l.done)), h('td.num', q(l.short)), h('td', l.delay_code), h('td', l.remark || ''))))) : null);
  };
  from.onchange = to.onchange = () => { load().catch(fail); };
  box.replaceChildren(h('div.toolbar', h('span.muted', 'From'), from, h('span.muted', 'to'), to), out);
  await load();
}

// ---------------------------------------------------------------- quality (QEMS dashboard: rejection, rework, NCR / CAPA)
async function quality(box) {
  const from = h('input', { type: 'date', value: today().slice(0, 8) + '01' }), to = h('input', { type: 'date', value: today() });
  const out = h('div');
  const low = (v, target) => (v == null ? null : v <= target ? 'var(--good)' : v <= target * 2 ? 'var(--warn)' : 'var(--bad)');
  const p = v => (v == null ? '–' : v + '%');
  const load = async () => {
    const d = await api(`/production/quality?from=${from.value}&to=${to.value}`);
    const t = d.totals, max = Math.max(1, ...d.pareto.map(x => x.count));
    out.replaceChildren(
      h('div.kpis', kpi('Incoming rejection', p(t.incoming_rejection_pct), `IQC, ${t.incoming_lots} GRN line(s) · target < 2%`, low(t.incoming_rejection_pct, 2)),
        kpi('Internal rejection', p(t.internal_rejection_pct), 'in-process + final · target < 2%', low(t.internal_rejection_pct, 2)), kpi('Rework', p(t.rework_pct), 'target < 1%', low(t.rework_pct, 1)),
        kpi('First-pass yield', p(t.fpy), 'accepted first time', pct(t.fpy)), kpi('NCR open', t.ncr_open, `${t.ncr_raised} raised in the period`, t.ncr_open ? 'var(--warn)' : null),
        kpi('CAPA overdue', t.ncr_overdue, 'past 30 days', t.ncr_overdue ? 'var(--bad)' : null), kpi('CAPA closed on time', p(t.capa_on_time_pct), `${t.capa_closed} closed · target > 95%`, pct(t.capa_on_time_pct)),
        kpi('Cost of poor quality', `₹ ${inr(t.rework_cost + t.scrap_value, 0)}`, `rework ₹ ${inr(t.rework_cost, 0)} (${q(t.rework_hours)} h) + scrap ₹ ${inr(t.scrap_value, 0)}`),
        kpi('Inspection compliance', p(t.inspection_compliance_pct), `${t.completed_orders} order(s) completed · with final QC`, pct(t.inspection_compliance_pct, 100, 90))),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' } },
        card('By inspection', h('table.data', h('thead', h('tr', ['Inspection', 'Count', 'Inspected', 'Rework', 'Rejected', 'FPY'].map(x => h('th', x)))),
          h('tbody', d.kinds.map(k => h('tr', h('td', k.kind), h('td.num', k.inspections), h('td.num', q(k.inspected)), h('td.num', q(k.rework)), h('td.num', q(k.rejected)), h('td.num', p(k.fpy))))))),
        card('NCR by category (Pareto)', d.pareto.length ? h('div', { style: { display: 'grid', gap: '6px' } }, d.pareto.map(x => h('div.bar-row', { style: { gridTemplateColumns: '150px 1fr 40px' } },
          h('span.name', x.category), h('div.track', h('div.fill', { style: { width: `${(100 * x.count) / max}%` } })), h('span.val', x.count))))
          : h('p.muted', 'No NCR in this period.')),
        d.stages.length ? card('In-process by stage', h('table.data', h('thead', h('tr', ['Stage', 'Inspected', 'Rework', 'Rejected', 'FPY'].map(x => h('th', x)))),
          h('tbody', d.stages.map(x => h('tr', h('td', x.stage), h('td.num', q(x.inspected)), h('td.num', q(x.rework)), h('td.num', q(x.rejected)), h('td.num', p(x.fpy))))))) : null),
      d.open.length ? h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, `Open NCR / CAPA (${d.open.length})`)),
        tableOf(['NCR', 'Date', 'Found at', 'Category', 'Order', 'Non-conformance', 'Qty', 'Disposition', 'Responsible', 'Target', 'Status'], d.open.map(n => h('tr',
          h('td.nowrap', h('a', { href: `#/view/ncrs/${n.id}` }, n.ncr_no)), h('td.nowrap', fmtDate(n.date)), h('td', n.source), h('td', n.category), h('td.nowrap', n.order_no || ''),
          h('td', { style: { maxWidth: '320px' } }, String(n.description || '').split('\n')[0]), h('td.num', q(n.qty)), h('td', n.disposition || ''), h('td', n.responsible || ''),
          h('td.nowrap', { style: { color: n.overdue ? 'var(--bad)' : '' } }, fmtDate(n.target_date), n.overdue ? ' ⚠' : ''), h('td', badge(n.status)))))) : null,
      d.inspections.length ? h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, 'Inspections')),
        tableOf(['QC No', 'Date', 'Inspection', 'Stage', 'Order', 'Inspected', 'Accepted', 'Rework', 'Rejected', 'Result', 'Inspector'], d.inspections.map(r => h('tr',
          h('td.nowrap', h('a', { href: `#/view/qc_inspections/${r.id}` }, r.qc_no)), h('td.nowrap', fmtDate(r.date)), h('td', r.kind), h('td', r.stage || ''), h('td.nowrap', orderLink(r.order_id, r.order_no)),
          h('td.num', q(r.inspected)), h('td.num', q(r.accepted)), h('td.num', q(r.rework)), h('td.num', q(r.rejected)), h('td', badge(r.result)), h('td', r.inspector || ''))))) : h('p.muted', 'No inspections recorded in this period.'));
  };
  from.onchange = to.onchange = () => { load().catch(fail); };
  box.replaceChildren(h('div.toolbar', h('span.muted', 'From'), from, h('span.muted', 'to'), to, h('a.btn', { href: '#/list/qc_inspections' }, '🔍 All inspections'), h('a.btn', { href: '#/list/ncrs' }, '🚩 All NCRs')), out);
  await load();
}

// ---------------------------------------------------------------- finished goods output and production stock
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
  box.replaceChildren(h('div.toolbar', h('span.muted', 'From'), from, h('span.muted', 'to'), to, h('a.btn', { href: '#/list/production_entries' }, '📋 All entries'), h('button.btn', { onclick: () => window.print() }, '🖨 Print')), out);
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
