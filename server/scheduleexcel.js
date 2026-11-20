// Project Planner → ⬇ Excel (Gantt): the schedule as a client-ready workbook, in the layout of the master execution
// Gantts sent to hospitals (LHPL Chinchwad R3), but with the dates worked out by the planner:
//   1. Master Gantt – KPIs on top, every phase / activity with zone, scope, links, dates, weight, progress, float,
//      critical, delay reason, and weekly bars (done / critical / client scope / today)
//   2. Milestones & Hold Points – forecast vs baseline and the acceptance evidence
//   3. Zone-wise Release – per OT / room, when each phase finishes there (staggered handover)
//   4. Baseline vs Current – variance per activity with the delay reason
//   5. Plan Checks – what is overdue, not started, without an owner, without evidence, or wrong in the links
import ExcelJS from 'exceljs';
import { plannerData } from './schedule.js';

// Dates as UTC midnight: Excel stores days without a time zone (a local IST midnight shows as the day before).
const D = s => (s ? new Date(`${s}T00:00:00Z`) : null);
const day = s => D(s)?.getTime();
const iso = d => d.toISOString().slice(0, 10);
const monday = s => { const d = D(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; };
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const NAVY = 'FF1F3A5F', GREY = 'FFF2F4F7', PHASE = 'FFDCE6F2';
const BAR = { done: 'FF6AA84F', critical: 'FFE06666', client: 'FFF6B26B', normal: 'FF6FA8DC', today: 'FFFFF2CC' };
const thin = { style: 'thin', color: { argb: 'FFD0D5DD' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

// "OT1–OT5" → OT1 … OT5; "OT2, OT3" → both; "All" / blank → none (common work)
function zonesOf(z) {
  const out = [];
  for (const part of String(z || '').split(/[,/]+/).map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Za-z ]*?)\s*(\d+)\s*[–-]\s*(?:[A-Za-z ]*?)\s*(\d+)$/);
    if (m && Number(m[3]) >= Number(m[2]) && Number(m[3]) - Number(m[2]) < 30) for (let i = Number(m[2]); i <= Number(m[3]); i++) out.push(`${m[1].trim()}${i}`);
    else if (!/^all$/i.test(part)) out.push(part);
  }
  return out;
}

function header(ws, cols) {
  const row = ws.getRow(ws.rowCount + 1);
  cols.forEach((c, i) => { const cell = row.getCell(i + 1); cell.value = c; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill(NAVY); cell.alignment = { vertical: 'middle', wrapText: true }; cell.border = box; });
  row.height = 30;
  return row.number;
}

export async function scheduleWorkbook(projectId, user) {
  const d = plannerData(projectId, user); // also checks the right to see schedules
  const { project: p, rows, summary: s, problems } = d;
  const acts = rows.filter(r => r.kind !== 'Phase');
  const totalW = acts.reduce((a, r) => a + (Number(r.weight) > 0 ? Number(r.weight) : Math.max(Number(r.duration) || 0, r.kind === 'Milestone' ? 0 : 1)), 0) || 1;
  const wOf = r => (r.kind === 'Phase' ? null : (Number(r.weight) > 0 ? Number(r.weight) : Math.max(Number(r.duration) || 0, r.kind === 'Milestone' ? 0 : 1)) / totalW);
  const today = s.today;
  const title = `${p.no || ''} ${p.name}`.trim();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WIESPL CRM';

  // ---------------------------------------------------------------- 1. Master Gantt
  const ws = wb.addWorksheet('Master Gantt', { pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }, properties: { tabColor: { argb: NAVY } } });
  const COLS = [['Sr', 6], ['Phase', 16], ['Activity / Deliverable', 46], ['Zone', 10], ['Scope', 9], ['Responsible', 15], ['After', 9], ['Start', 11], ['Finish', 11], ['Days', 6],
    ['Actual Start', 11], ['Actual Finish', 11], ['Weight', 8], ['Progress', 9], ['Status', 11], ['Float', 6], ['Critical', 8], ['Delay Reason', 20], ['Execution / constraints', 40]];
  const first = monday(s.start || today), lastDay = [s.finish, s.base_finish].filter(Boolean).sort().at(-1) || today;
  const weeks = [];
  for (const w = new Date(first); w <= D(lastDay) && weeks.length < 80; w.setUTCDate(w.getUTCDate() + 7)) weeks.push(new Date(w));
  ws.columns = [...COLS.map(([, width]) => ({ width })), ...weeks.map(() => ({ width: 4.2 }))];
  ws.mergeCells(1, 1, 1, COLS.length + weeks.length);
  Object.assign(ws.getCell(1, 1), { value: `${title.toUpperCase()} – MASTER EXECUTION SCHEDULE${p.customer ? ` · ${p.customer}` : ''}` });
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell(1, 1).fill = fill(NAVY);
  ws.getRow(1).height = 24;
  // KPI boxes: label and value in one merged block each, so nothing is cut off whatever the column widths are
  const kpi = (r, c1, c2, label, value) => {
    ws.mergeCells(r, c1, r, c2);
    const a = ws.getCell(r, c1);
    a.value = { richText: [{ text: `${label}  `, font: { bold: true, size: 9, color: { argb: 'FF475467' } } }, { text: String(value ?? ''), font: { bold: true, size: 11 } }] };
    a.fill = fill(GREY); a.border = box; a.alignment = { vertical: 'middle' };
  };
  const nice = v => (v ? v.split('-').reverse().join('-').replace(/-(\d\d)-/, (m, mo) => `-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]}-`) : '—');
  const variance = s.variance;
  const cnt = st => acts.filter(r => r.status === st).length;
  kpi(2, 1, 3, 'FORECAST HANDOVER', nice(s.finish)); kpi(2, 4, 7, 'BASELINE HANDOVER', s.base_finish ? nice(s.base_finish) : 'no baseline yet');
  kpi(2, 8, 12, 'VARIANCE', variance == null ? '—' : variance > 0 ? `${variance} working days late` : variance < 0 ? `${-variance} days ahead` : 'on baseline');
  kpi(2, 13, 15, 'WEIGHTED PROGRESS', `${(s.progress || 0).toFixed(1)}%`); kpi(2, 16, 19, 'STATUS DATE', nice(today));
  kpi(3, 1, 3, 'DONE / IN PROGRESS / NOT STARTED', `${cnt('Done')} / ${cnt('In progress')} / ${cnt('Not started')}`); kpi(3, 4, 7, 'CRITICAL OPEN', s.critical);
  kpi(3, 8, 12, 'OVERDUE', s.overdue); kpi(3, 13, 15, 'CLIENT ITEMS DUE IN 14 DAYS', s.client_open); kpi(3, 16, 19, 'SITE', p.site || p.site_address || '');
  ws.getRow(2).height = 20; ws.getRow(3).height = 20;
  ws.addRow([]);
  const hr = header(ws, [...COLS.map(c => c[0]), ...weeks.map(w => w)]);
  weeks.forEach((w, i) => {
    const c = ws.getCell(hr, COLS.length + 1 + i);
    c.numFmt = 'dd-mmm'; c.alignment = { textRotation: 90, horizontal: 'center' }; c.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
    if (day(iso(w)) <= day(today) && day(today) < day(iso(w)) + 7 * 864e5) { c.fill = fill('FFB45309'); }
  });
  ws.getRow(hr).height = 46;
  let phase = '';
  for (const r of rows) {
    if (r.kind === 'Phase') phase = r.name;
    const late = r.late_days > 0 && r.status !== 'Done';
    const row = ws.addRow([r.kind === 'Phase' ? '' : r.sr, r.kind === 'Phase' ? '' : phase, r.kind === 'Milestone' ? `◆ ${r.name}` : r.name, r.zone || '', r.kind === 'Phase' ? '' : r.party || '',
      r.responsible || '', r.after || '', D(r.plan_start), D(r.plan_finish), r.kind === 'Phase' ? r.duration || null : r.kind === 'Milestone' ? 0 : Number(r.duration) || null,
      D(r.actual_start), D(r.actual_finish), wOf(r), (Number(r.progress) || 0) / 100, r.status === 'Done' ? 'Completed' : r.status,
      r.total_float ?? null, r.critical === 'Yes' ? 'CRITICAL' : '', r.delay_reason || (late ? `${r.late_days} d late` : ''),
      [r.critical === 'Yes' && r.kind !== 'Phase' ? 'CRITICAL •' : '', r.remark || '', r.evidence ? `Evidence: ${r.evidence}` : '', r.crew ? `Crew ${r.crew}${r.crew_note ? ` (${r.crew_note})` : ''}` : ''].filter(Boolean).join(' ')]);
    for (const c of [8, 9, 11, 12]) row.getCell(c).numFmt = 'dd-mmm-yy';
    row.getCell(13).numFmt = '0.0%'; row.getCell(14).numFmt = '0%';
    row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= COLS.length) { c.border = box; c.alignment = { vertical: 'top', wrapText: n === 3 || n === 19 }; } });
    if (r.kind === 'Phase') row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= COLS.length) { c.fill = fill(PHASE); c.font = { bold: true }; } });
    if (r.critical === 'Yes' && r.kind !== 'Phase') row.getCell(17).font = { bold: true, color: { argb: 'FFC00000' } };
    if (late) row.getCell(18).font = { color: { argb: 'FFC00000' } };
    // weekly bars
    const a = day(r.plan_start), b = day(r.plan_finish);
    if (a && b) weeks.forEach((w, i) => {
      const ws0 = w.getTime(), we = ws0 + 6 * 864e5;
      if (b < ws0 || a > we) return;
      const c = row.getCell(COLS.length + 1 + i);
      const color = r.status === 'Done' ? BAR.done : r.kind === 'Phase' ? 'FF3D5A80' : r.critical === 'Yes' ? BAR.critical : r.party === 'Client' ? BAR.client : BAR.normal;
      c.fill = fill(color);
      if (r.kind === 'Milestone') { c.value = '◆'; c.fill = fill('FFFFFFFF'); c.font = { color: { argb: color }, bold: true }; c.alignment = { horizontal: 'center' }; }
    });
    weeks.forEach((w, i) => { const c = row.getCell(COLS.length + 1 + i); c.border = { left: thin, right: thin }; });
  }
  ws.addRow([]);
  const legend = ws.addRow(['', 'Legend', 'Blue = WIESPL work · Red = critical path · Orange = client scope · Green = completed · ◆ = milestone / hold point · brown week = status date. Dates are worked out by the CRM planner from the links (After) and the working calendar.']);
  legend.getCell(2).font = { bold: true }; legend.getCell(3).font = { italic: true, size: 9 };
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: hr }];
  ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: COLS.length } };

  // ---------------------------------------------------------------- 2. Milestones & Hold Points
  const ms = wb.addWorksheet('Milestones & Hold Points', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ms.columns = [{ width: 7 }, { width: 46 }, { width: 10 }, { width: 16 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 44 }, { width: 36 }];
  ms.addRow([`CRITICAL MILESTONES & HOLD POINTS · ${title}`]).font = { bold: true, size: 13 };
  const mh = header(ms, ['ID', 'Milestone / hold point', 'Scope', 'Responsible', 'Forecast', 'Baseline', 'Variance (days)', 'Status', 'Acceptance / evidence', 'Remark']);
  acts.filter(r => r.kind === 'Milestone' || r.evidence).forEach((r, i) => {
    const row = ms.addRow([`M${String(i + 1).padStart(2, '0')}`, r.name, r.party || '', r.responsible || '', D(r.plan_finish), D(r.base_finish),
      r.base_finish ? Math.round((day(r.actual_finish || r.plan_finish) - day(r.base_finish)) / 864e5) : null, r.status === 'Done' ? 'Achieved' : 'Open',
      r.evidence || '— add the evidence (what proves it is done)', r.remark || '']);
    for (const c of [5, 6]) row.getCell(c).numFmt = 'dd-mmm-yy';
    row.eachCell({ includeEmpty: true }, c => { c.border = box; c.alignment = { vertical: 'top', wrapText: true }; });
    if (!r.evidence) row.getCell(9).font = { italic: true, color: { argb: 'FF98A2B3' } };
    if (r.status === 'Done') row.getCell(8).font = { bold: true, color: { argb: 'FF2E7D32' } };
  });
  ms.views = [{ state: 'frozen', ySplit: mh }];

  // ---------------------------------------------------------------- 3. Zone-wise release
  const zones = [...new Set(acts.flatMap(r => zonesOf(r.zone)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const zs = wb.addWorksheet('Zone-wise Release', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  zs.addRow([`ZONE-WISE (OT-WISE) RELEASE PLAN · ${title}`]).font = { bold: true, size: 13 };
  if (!zones.length) zs.addRow(['Give the activities a Zone (OT1, OT2 … or OT1–OT5) in the planner to get the OT-wise release plan here.']).font = { italic: true };
  else {
    const phases = [];
    let ph = '(no phase)';
    const byZone = new Map(zones.map(z => [z, new Map()]));
    for (const r of rows) {
      if (r.kind === 'Phase') { ph = r.name; continue; }
      for (const z of zonesOf(r.zone)) {
        if (!phases.includes(ph)) phases.push(ph);
        const m = byZone.get(z), cur = m.get(ph);
        if (!cur || r.plan_finish > cur.finish) m.set(ph, { finish: r.plan_finish, done: (cur?.done ?? true) && r.status === 'Done' });
        else if (r.status !== 'Done') cur.done = false;
      }
    }
    zs.columns = [{ width: 14 }, ...phases.map(() => ({ width: 18 })), { width: 18 }];
    const zh = header(zs, ['Zone', ...phases, 'Ready for handover']);
    for (const z of zones) {
      const m = byZone.get(z), all = [...m.values()];
      const row = zs.addRow([z, ...phases.map(ph2 => D(m.get(ph2)?.finish)), D(all.map(x => x.finish).sort().at(-1))]);
      row.eachCell({ includeEmpty: true }, (c, n) => { c.border = box; if (n > 1) c.numFmt = 'dd-mmm-yy'; });
      row.getCell(1).font = { bold: true };
      phases.forEach((ph2, i) => { if (m.get(ph2)?.done) row.getCell(i + 2).fill = fill('FFD9EAD3'); });
    }
    zs.addRow([]);
    zs.addRow(['Each date is when the last activity of that phase finishes in that zone (green = done). Work for "All" zones is not counted per zone.']).font = { italic: true, size: 9 };
    zs.views = [{ state: 'frozen', xSplit: 1, ySplit: zh }];
  }

  // ---------------------------------------------------------------- 4. Baseline vs Current
  const bs = wb.addWorksheet('Baseline vs Current', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  bs.columns = [{ width: 6 }, { width: 46 }, { width: 9 }, ...Array(6).fill({ width: 12 }), { width: 10 }, { width: 30 }, { width: 36 }];
  bs.addRow([`BASELINE vs CURRENT · ${title}${d.baselines?.length ? ` · baseline ${d.baselines.find(b => b.status === 'Approved')?.rev || d.baselines[0].rev}` : ' · no baseline frozen yet'}`]).font = { bold: true, size: 13 };
  const bh = header(bs, ['Sr', 'Activity', 'Scope', 'Baseline Start', 'Baseline Finish', 'Forecast Start', 'Forecast Finish', 'Actual Start', 'Actual Finish', 'Late (working days)', 'Delay Reason', 'Remark']);
  for (const r of acts) {
    const row = bs.addRow([r.sr, r.name, r.party || '', D(r.base_start), D(r.base_finish), D(r.plan_start), D(r.plan_finish), D(r.actual_start), D(r.actual_finish), r.late_days || 0, r.delay_reason || '', r.remark || '']);
    for (const c of [4, 5, 6, 7, 8, 9]) row.getCell(c).numFmt = 'dd-mmm-yy';
    row.eachCell({ includeEmpty: true }, c => { c.border = box; c.alignment = { vertical: 'top', wrapText: true }; });
    if (r.late_days > 0) { row.getCell(10).font = { bold: true, color: { argb: 'FFC00000' } }; if (!r.delay_reason) { row.getCell(11).value = '— give the delay reason'; row.getCell(11).font = { italic: true, color: { argb: 'FFC00000' } }; } }
  }
  bs.views = [{ state: 'frozen', xSplit: 2, ySplit: bh }];

  // ---------------------------------------------------------------- 5. Plan Checks
  const cs = wb.addWorksheet('Plan Checks');
  cs.columns = [{ width: 32 }, { width: 7 }, { width: 50 }, { width: 50 }];
  cs.addRow([`PLAN CHECKS on ${today.split('-').reverse().join('-')} · ${title}`]).font = { bold: true, size: 13 };
  header(cs, ['Check', 'Sr', 'Activity', 'Detail']);
  const checks = [];
  for (const x of problems || []) checks.push(['Links / numbers', '', '', x]);
  for (const r of acts) {
    if (r.status !== 'Done' && r.plan_finish && r.plan_finish < today) checks.push(['Overdue', r.sr, r.name, `finish ${r.plan_finish}, ${Math.round(Number(r.progress) || 0)}% done`]);
    if (!r.actual_start && r.plan_start && r.plan_start < today && r.status === 'Not started') checks.push(['Should have started', r.sr, r.name, `planned start ${r.plan_start}: enter the actual start or the delay reason`]);
    if (r.late_days > 0 && r.status !== 'Done' && !r.delay_reason) checks.push(['Late without a reason', r.sr, r.name, `${r.late_days} working days behind the baseline`]);
    if (!r.responsible && r.status !== 'Done') checks.push(['No one responsible', r.sr, r.name, 'give the activity an owner']);
    if (r.kind === 'Milestone' && !r.evidence) checks.push(['Milestone without evidence', r.sr, r.name, 'write what proves it is done (signed checklist, test sheet …)']);
    if (r.status === 'Done' && !r.actual_finish) checks.push(['Done without an actual finish', r.sr, r.name, 'enter the actual finish date']);
    if (Number(r.progress) > 0 && !r.actual_start && r.status !== 'Done') checks.push(['Progress without an actual start', r.sr, r.name, `${r.progress}% done but no actual start`]);
  }
  if (!s.baselined) checks.push(['No baseline', '', '', 'Freeze the baseline (📌) once the client agrees the plan, so delays can be measured']);
  if (!checks.length) checks.push(['All clear', '', '', 'No problems found']);
  for (const c of checks) { const row = cs.addRow(c); row.eachCell({ includeEmpty: true }, x => { x.border = box; x.alignment = { vertical: 'top', wrapText: true }; }); }

  return { buffer: await wb.xlsx.writeBuffer(), filename: `${(p.no || 'Project').replace(/[\\/:*?"<>|]+/g, '-')} ${p.name} – Master Gantt ${today}.xlsx`.replace(/\s+/g, ' ') };
}
export const _test = { zonesOf };
