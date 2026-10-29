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
const sub = t => h('h4', { style: { margin: '10px 0 4px', fontSize: '12px' } }, t);

// The NCR's root cause methods as printed: each method used, with its picture where it has one.
async function rcaParts(r) {
  const used = String(r.rca_methods || '').split(', ').filter(Boolean);
  if (!used.length) return [];
  const { fishbone, processMap, pareto } = await import('./rca.js');
  const out = [];
  if (used.includes('5 Why')) out.push(sub('5 Why'), tbl(r.whys || [], [['why', 'Why?'], ['because', 'Because']]));
  if (used.includes('Fishbone')) out.push(sub('Fishbone (6M)'), fishbone(String(r.description || '').split('\n')[0].replace(/^QC-\S+\s*(·[^:]*)?:\s*/, ''), r.fishbone || []),
    tbl(r.fishbone || [], [['category', '6M'], ['cause', 'Possible cause'], ['check', 'Checked'], ['evidence', 'Evidence']]));
  if (used.includes('Pareto')) {
    const p = await api(`/ncrs/${r.id}/pareto`).catch(() => null);
    out.push(sub('Pareto'), p ? pareto(p.category, [p.mine.category]) : null, h('p', { style: { margin: '4px 0', fontSize: '11px' } }, h('b', 'Conclusion: '), r.pareto_note || ''));
  }
  if (used.includes('Process mapping')) out.push(sub('Process mapping'), processMap(r.process_steps || []));
  if (used.includes('FMEA')) out.push(sub('FMEA'), tbl([...(r.fmea || [])].sort((a, b) => (b.rpn ?? 0) - (a.rpn ?? 0)), [['step', 'Step'], ['mode', 'Failure mode'], ['effect', 'Effect'], ['cause', 'Cause'], ['control', 'Control'],
    ['s', 'S', x => x.s ?? '', 1], ['o', 'O', x => x.o ?? '', 1], ['d', 'D', x => x.d ?? '', 1], ['rpn', 'RPN', x => x.rpn ?? '', 1], ['action', 'Action'], ['owner', 'Who'], ['rpn2', 'RPN after', x => x.rpn2 ?? '', 1]]));
  return out;
}

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
  if (kind === 'qcreport') {
    const q = await api(`/qc_inspections/${id}`);
    const o = await api(`/production_orders/${q.order_id}`);
    return { title: `${q.qc_no} QC inspection report`, doc: h('div.doc', page(companyHead(s, `QC INSPECTION REPORT – ${String(q.kind || '').toUpperCase()}`),
      grid([['QC No', q.qc_no], ['Date', fmtDate(q.date)], ['Production Order', o.order_no], ['Project (code)', o.project_id_label], ['Product', `${o.description} (${o.category})`], ['Stage', q.stage],
        ['Drawing / Rev', q.drawing_rev], ['Material Batch', q.material_batch], ['Production Batch', q.production_batch], ['Inspector', q.inspector],
        ['Inspected', `${n(q.qty_inspected)} ${o.uom || ''}`], ['Accepted', n(q.qty_accepted)], ['Rework', n(q.qty_rework)], ['Rejected', n(q.qty_rejected)], ['Result', q.result], ['Status', `${q.status}${q.done_by ? ' – ' + q.done_by : ''}`]]),
      tbl(q.checks || [], [['check', 'Check'], ['standard', 'Standard / tolerance'], ['measured', 'Measured / observed'], ['result', 'Result', r => (r.result === 'Not OK' ? '✘ Not OK' : r.result === 'OK' ? '✔ OK' : r.result || '')], ['remark', 'Remark']]),
      q.defect ? h('p', h('b', `Defect${q.defect_category ? ' (' + q.defect_category + ')' : ''}: `), q.defect) : null,
      q.ncr_id ? h('p', h('b', 'NCR raised: '), q.ncr_id_label || `#${q.ncr_id}`) : null,
      q.remarks ? h('p', h('b', 'Remarks: '), q.remarks) : null,
      signRow(['Inspector (QC)', ''], ['Production Supervisor', ''], ['Quality Head', ''])))};
  }
  if (kind === 'ncr') {
    const r = await api(`/ncrs/${id}`);
    const box = (title, text) => [h('h3', { style: { margin: '10px 0 4px', fontSize: '12px' } }, title), h('div', { style: { border: '1px solid #999', padding: '6px', minHeight: '34px', whiteSpace: 'pre-wrap', fontSize: '11px' } }, text || '')];
    return { title: `${r.ncr_no} NCR / CAPA`, doc: h('div.doc', page(companyHead(s, 'NON-CONFORMANCE REPORT & CAPA'),
      grid([['NCR No', r.ncr_no], ['Date', fmtDate(r.date)], ['Found At', r.source], ['Category', r.category], ['Production Order', r.order_id_label], ['Project', r.project_id_label],
        ['Qty Affected', `${n(r.qty)} ${r.uom || ''}`], ['Segregated', r.segregated], ['Disposition', r.disposition], ['Status', r.status], ['Responsible', r.responsible], ['CAPA Target', fmtDate(r.target_date)]]),
      box('1. Non-conformance', r.description),
      h('h3', { style: { margin: '10px 0 4px', fontSize: '12px' } }, '2. Root cause analysis'),
      grid([['Main method', r.rca_method], ['Methods used', r.rca_methods], ['Analysis check', r.rca_status]]),
      ...(await rcaParts(r)),
      box('Root cause', r.root_cause), box('3. Correction (immediate)', r.correction), box('4. Corrective action', r.corrective_action), box('5. Preventive action', r.preventive_action),
      (r.capa_tasks || []).length ? [h('h3', { style: { margin: '10px 0 4px', fontSize: '12px' } }, 'CAPA tasks'), tbl(await api(`/ncrs/${id}/tasks`), [['task_no', 'Task'], ['title', 'What'], ['assigned_to', 'Who'], ['status', 'Status']])] : null,
      grid([['Rework man-hours', n(r.rework_hours)], ['Rework cost (₹)', n(r.rework_cost)], ['Scrap / rejection value (₹)', n(r.scrap_value)], ['Closed', r.closed_by ? `${r.closed_by}` : '']]),
      box('6. Verification of effectiveness', r.verification),
      signRow(['Raised By (QC)', ''], ['Responsible', ''], ['Quality Head (closure)', ''])))};
  }
  throw new Error('Unknown document');
}
