// Production prints (formats workbook): production release note, monthly production plan, daily production report and
// the monthly closing (plan vs actual per week, achievement, delays).
import { h, api, fmtDate } from '../ui.js';
import { inr } from '../calc.js';
import { companyHead, grid, signRow, page } from './print.js';

const n = v => (v == null || v === '' ? '' : inr(v, Number(v) % 1 ? 2 : 0));
const tbl = (rows, cols, foot) => h('table', { style: { marginTop: '6px', fontSize: '11px' } }, h('thead', h('tr', h('th', '#'), cols.map(c => h('th', c[1])))),
  h('tbody', rows.map((r, i) => h('tr', h('td', i + 1), cols.map(c => h('td', { style: { whiteSpace: 'pre-wrap', textAlign: c[3] ? 'right' : '' } }, c[2] ? c[2](r) : r[c[0]] ?? ''))))),
  foot ? h('tfoot', h('tr', h('th', ''), foot.map(f => h('th', { style: { textAlign: 'right' } }, f ?? '')))) : null);
const yn = v => (v === 'Yes' ? '✔ Yes' : '✘ No');

export async function prodDoc(kind, id, s) {
  if (kind === 'prodorder') {
    const o = await api(`/production_orders/${id}`);
    return { title: `${o.order_no} release note`, doc: h('div.doc', page(companyHead(s, 'PRODUCTION RELEASE NOTE / PRODUCTION ORDER'),
      grid([['Production Order No', o.order_no], ['Date', fmtDate(o.date)], ['Project (code)', o.project_id_label], ['Client Work Order', o.work_order_id_label], ['BOQ / BOM', o.bom_id_label], ['Product Category', o.category],
        ['What is made', o.description], ['Quantity', `${n(o.qty)} ${o.uom || ''}`], ['Drawing No / Rev', [o.drawing_no, o.drawing_rev].filter(Boolean).join(' / ')], ['Priority', o.priority],
        ['Planned Start', fmtDate(o.planned_start)], ['Target Completion', fmtDate(o.target_date)], ['Tentative Dispatch', fmtDate(o.dispatch_date)], ['Responsible', o.responsible],
        ['Main Machine / Line', o.machine], ['Planned Man-hours', n(o.planned_hours)], ['Status', o.status], ['Released By', o.released_by]]),
      h('h3', 'Release check (Production Policy: no production without these)'),
      tbl([['Approved drawing (latest revision)', yn(o.drawing_ok), [o.drawing_no, o.drawing_rev].filter(Boolean).join(' rev ')], ['BOM verified', yn(o.bom_ok), o.bom_id_label || ''],
        ['Project code', o.project_id ? '✔ Yes' : '✘ No', o.project_id_label || ''], ['Material', o.material_ok || '✘ Not checked', o.material_note || '']].map(([a, b, c]) => ({ a, b, c })),
      [['a', 'Check'], ['b', 'Status'], ['c', 'Details']]),
      o.stage_summary ? [h('h3', 'Progress'), grid([['Finished', `${n(o.qty_done)} of ${n(o.qty)} ${o.uom || ''} (${o.progress || 0}%)`], ['Furthest stage', o.stage], ['Man-hours used', n(o.hours_used)], ['Completed On', fmtDate(o.completed_on)]]),
        h('div', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', marginTop: '4px' } }, o.stage_summary)] : null,
      o.remarks ? h('p', h('b', 'Remarks: '), o.remarks) : null,
      signRow(['Planning', ''], ['Production Head', ''], ['Stores', ''], ['Quality', ''])))};
  }
  if (kind === 'prodplan') {
    const p = await api(`/production_plans/${id}`);
    const lines = (p.lines || []).filter(l => l.order_id || l.description);
    const wk = k => lines.reduce((sum, l) => sum + (Number(l['w' + k]) || 0), 0);
    return { title: `${p.plan_no} monthly production plan`, doc: h('div.doc', page(companyHead(s, `MONTHLY PRODUCTION PLAN – ${p.month}`),
      grid([['Plan No', p.plan_no], ['Revision', p.rev || 0], ['Prepared By', p.prepared_by], ['Status', p.status], ['Approved By', p.approved_by]]),
      tbl(lines, [['order_id_label', 'Production order'], ['description', 'Product'], ['uom', 'UOM'], ['balance', 'Balance', r => n(r.balance), 1], ['target', 'Target', r => n(r.target), 1],
        ...[1, 2, 3, 4, 5].map(k => ['w' + k, 'W' + k, r => n(r['w' + k]), 1]), ['planned_hours', 'Man-hrs', r => n(r.planned_hours), 1], ['remark', 'Remark']],
      ['', '', '', '', n(lines.reduce((sum, l) => sum + (Number(l.target) || 0), 0)), ...[1, 2, 3, 4, 5].map(k => n(wk(k))), n(lines.reduce((sum, l) => sum + (Number(l.planned_hours) || 0), 0)), '']),
      h('p', { style: { fontSize: '11px' } }, 'Weeks: W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–28, W5 = 29–end of month. Made before the 25th of the previous month.'),
      p.remarks ? h('p', h('b', 'Remarks: '), p.remarks) : null,
      signRow(['Prepared (Planning)', ''], ['Production Head', ''], ['Approved (GM)', ''])))};
  }
  if (kind === 'prodday') {
    const r = await api(`/production_reports/${id}`);
    const lines = r.lines || [];
    const sum = k => lines.reduce((x, l) => x + (Number(l[k]) || 0), 0);
    return { title: `${r.report_no} daily production report`, doc: h('div.doc', page(companyHead(s, 'DAILY PRODUCTION REPORT'),
      grid([['Report No', r.report_no], ['Date', fmtDate(r.date)], ['Shift', r.shift], ['Supervisor', r.supervisor], ['Workers Present', r.manpower], ['Status', `${r.status}${r.submitted_by ? ' – ' + r.submitted_by : ''}`],
        ['Achieved', r.achievement != null ? `${r.achievement}% of plan` : '']]),
      tbl(lines, [['order_id_label', 'Production order'], ['stage', 'Stage'], ['planned', 'Planned', l => n(l.planned), 1], ['done', 'Done', l => n(l.done), 1], ['rejected', 'Rej./rework', l => n(l.rejected), 1],
        ['uom', 'UOM'], ['workers', 'Workers', l => n(l.workers), 1], ['hours', 'Man-hrs', l => n(l.hours), 1], ['delay_code', 'Delay code'], ['remark', 'Remark']],
      ['', '', n(sum('planned')), n(sum('done')), n(sum('rejected')), '', '', n(sum('hours')), '', '']),
      r.remarks ? h('p', h('b', 'Remarks / issues: '), h('span', { style: { whiteSpace: 'pre-wrap' } }, r.remarks)) : null,
      signRow(['Supervisor', ''], ['Production Head', ''])))};
  }
  if (kind === 'prodmonth') {
    const m = await api(`/production/month?month=${encodeURIComponent(id)}`);
    const d = await api(`/production/delays?from=${id}-01&to=${m.weeks.at(-1).to}`);
    const t = m.totals;
    return { title: `Production monthly closing ${m.month}`, doc: h('div.doc', page(companyHead(s, `MONTHLY PRODUCTION CLOSING – ${m.month}`),
      grid([['Plan', m.plan ? `${m.plan.plan_no} rev ${m.plan.rev || 0} (${m.plan.status})` : 'No plan'], ['Achievement', t.achievement != null ? `${t.achievement}% (${n(t.actual)} of ${n(t.target)})` : ''],
        ['Orders due this month', t.orders_due], ['Completed on time', t.on_time_pct != null ? `${t.on_time} (${t.on_time_pct}%)` : ''], ['Man-hours reported', n(t.hours)], ['Rejected / rework qty', n(t.rejected)],
        ['Days reported', `${t.days_reported} of ${t.working_days} working days`], ['Orders worked, not in the plan', t.unplanned]]),
      tbl(m.rows, [['order_no', 'Order'], ['description', 'Product'], ['uom', 'UOM'], ['target', 'Target', r => n(r.target), 1],
        ...m.weeks.map((w, i) => ['w' + w.n, `W${w.n} plan / actual`, r => `${n(r.week_plan[i])} / ${n(r.week_actual[i])}`, 1]), ['actual', 'Actual', r => n(r.actual), 1],
        ['achievement', 'Ach. %', r => (!r.planned ? 'not planned' : r.achievement != null ? r.achievement + '%' : '–'), 1], ['balance', 'Order balance', r => n(r.balance), 1], ['delays', 'Delays']],
      ['', '', '', n(t.target), ...m.weeks.map((w, i) => `${n(t.week_plan[i])} / ${n(t.week_actual[i])}`), n(t.actual), t.achievement != null ? t.achievement + '%' : '', '', '']),
      h('h3', 'Delay analysis'),
      d.codes.length ? tbl(d.codes, [['code', 'Delay code'], ['times', 'Times', r => r.times, 1], ['share', 'Share', r => r.share + '%', 1], ['short', 'Qty short', r => n(r.short), 1], ['orders', 'Orders', r => r.orders.join(', ')], ['notes', 'Remarks', r => r.notes.join('\n')]])
        : h('p', 'No delays reported.'),
      signRow(['Production Head', ''], ['Planning', ''], ['GM Operations', ''])))};
  }
  throw new Error('Unknown document');
}
