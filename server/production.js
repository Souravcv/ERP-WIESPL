// Production planning & daily review (Production Policy Vol 2 and the formats workbook): production orders released
// only against an approved drawing + verified BOM + project code + material, the monthly plan with its weekly split,
// the supervisor's daily report (planned vs done per order and stage, delay codes), and the reviews built from them:
// daily review, weekly / monthly plan vs actual with achievement %, monthly closing and the delay analysis.
import { db, getSettings, audit } from './db.js';
import { getRow, updateRow, HttpError } from './crud.js';
import { hasFunction, PROD_STAGES, PROD_FINISHED } from '../public/js/schema.js';
import { notify } from './notify.js';
import { isOffDay } from './hrpolicy.js';
import { fqcAccepted, overdueNcrs } from './quality.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v === '' || v == null ? null : Number(v));
const parse = (v, d) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || 'null') ?? d; } catch { return d; } };
const OPEN = ['Draft', 'Released', 'In production', 'On hold'];
const monthEnd = ym => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0); return `${ym}-${String(d.getDate()).padStart(2, '0')}`; };
const nextMonth = ym => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 1); return d.toLocaleString('sv-SE').slice(0, 7); };
const working = d => !isOffDay({}, d);

// Weeks of a month as on the plan: 1–7, 8–14, 15–21, 22–28, 29–end.
export const weekOf = d => Math.min(5, Math.ceil(Number(d.slice(8, 10)) / 7));
export function weeksOf(ym) {
  const end = monthEnd(ym), last = Number(end.slice(8, 10));
  return [1, 2, 3, 4, 5].map(n => ({ n, from: `${ym}-${String(n * 7 - 6).padStart(2, '0')}`, to: n === 5 ? end : `${ym}-${String(n * 7).padStart(2, '0')}` })).filter(w => Number(w.from.slice(8)) <= last);
}
const workDays = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (working(d)) n++; return n; };

// A plan line's quantity for week n: as entered, else the target spread over the working days of the weeks.
function weekPlan(line, ym) {
  const weeks = weeksOf(ym);
  const given = weeks.map(w => num(line['w' + w.n]));
  if (given.some(v => v != null)) return given.map(v => v || 0);
  const t = Number(line.target) || 0, days = weeks.map(w => workDays(w.from, w.to)), all = days.reduce((s, d) => s + d, 0) || 1;
  let left = t;
  return days.map((d, i) => { const q = i === days.length - 1 ? left : r2((t * d) / all); left = r2(left - q); return q; });
}

// ---------------------------------------------------------------- hooks
const orderLabel = id => { const o = id && db.prepare('SELECT order_no, description, uom FROM production_orders WHERE id = ?').get(Number(id)); return o; };

export function prepOrder(row, existing) {
  const qty = row.qty ?? existing?.qty;
  if (qty != null && !(Number(qty) > 0)) throw new HttpError(400, 'Quantity must be more than 0');
  const target = row.target_date ?? existing?.target_date, start = row.planned_start ?? existing?.planned_start;
  if (start && target && start > target) throw new HttpError(400, 'Planned start is after the target completion');
  if (existing && 'qty' in row && Number(row.qty) !== Number(existing.qty)) row.progress = Math.min(100, Math.round((100 * (Number(existing.qty_done) || 0)) / Number(row.qty)));
}

export function prepPlan(row, existing) {
  const ym = String(row.month ?? existing?.month ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new HttpError(400, 'Month as YYYY-MM, e.g. 2026-11');
  row.month = ym;
  const other = db.prepare("SELECT plan_no FROM production_plans WHERE month = ? AND id <> ?").get(ym, existing?.id || 0);
  if (other) throw new HttpError(409, `${other.plan_no} is already the plan for ${ym}; revise that one`);
  if (!existing || 'month' in row) row.plan_no = `PP-${ym}`;
  if ('lines' in row) {
    const seen = new Set();
    const lines = parse(row.lines, []).filter(l => l.order_id || l.description || Number(l.target)).map(l => {
      const o = orderLabel(l.order_id);
      if (l.order_id && !o) throw new HttpError(400, `Production order #${l.order_id} not found`);
      if (l.order_id && seen.has(Number(l.order_id))) throw new HttpError(400, `${o.order_no} is twice in the plan`);
      if (l.order_id) seen.add(Number(l.order_id));
      const w = [1, 2, 3, 4, 5].map(n => num(l['w' + n]));
      let target = num(l.target);
      if (target == null && w.some(v => v != null)) target = r2(w.reduce((s, v) => s + (v || 0), 0));
      if (target != null && target < 0) throw new HttpError(400, 'A target cannot be negative');
      return { ...l, order_id: l.order_id ? Number(l.order_id) : null, order_id_label: o ? `${o.order_no} · ${o.description}` : null,
        description: l.description || o?.description || '', uom: l.uom || o?.uom || '', target };
    });
    row.lines = JSON.stringify(lines);
  }
}

export function prepReport(row, existing) {
  if ('lines' in row) {
    row.lines = JSON.stringify(parse(row.lines, []).filter(l => l.order_id || Number(l.done) || Number(l.planned)).map(l => {
      const o = orderLabel(l.order_id);
      return { ...l, order_id: l.order_id ? Number(l.order_id) : null, order_id_label: o ? `${o.order_no} · ${o.description}` : null, uom: l.uom || o?.uom || '' };
    }));
  }
}

// An order's finished qty, furthest stage, hours and per-stage totals from the submitted daily reports.
export function recalcOrder(id) {
  const o = db.prepare('SELECT id, qty, status, completed_on FROM production_orders WHERE id = ?').get(Number(id));
  if (!o) return;
  const rows = db.prepare(`SELECT r.date, json_extract(j.value, '$.stage') stage, CAST(json_extract(j.value, '$.done') AS REAL) done, CAST(json_extract(j.value, '$.hours') AS REAL) hours
    FROM production_reports r, json_each(COALESCE(NULLIF(r.lines, ''), '[]')) j WHERE r.status = 'Submitted' AND CAST(json_extract(j.value, '$.order_id') AS INTEGER) = ? ORDER BY r.date`).all(o.id);
  const per = new Map();
  let hours = 0, finished = 0, finishedOn = null, far = -1;
  for (const r of rows) {
    hours += r.hours || 0;
    if (!(r.done > 0)) continue;
    per.set(r.stage, (per.get(r.stage) || 0) + r.done);
    far = Math.max(far, PROD_STAGES.indexOf(r.stage));
    if (r.stage === PROD_FINISHED) { finished += r.done; if (finished >= o.qty - 1e-9 && !finishedOn) finishedOn = r.date; }
  }
  const patch = {
    qty_done: r2(finished), hours_used: r2(hours), progress: Math.min(100, Math.round((100 * finished) / (Number(o.qty) || 1))),
    stage: far >= 0 ? PROD_STAGES[far] : null,
    stage_summary: PROD_STAGES.filter(s => per.has(s)).map(s => `${s}: ${r2(per.get(s))}`).join('\n') || null,
  };
  if (['Released', 'In production', 'Completed'].includes(o.status)) {
    if (finishedOn) Object.assign(patch, { status: 'Completed', completed_on: finishedOn });
    else Object.assign(patch, { status: rows.some(r => r.done > 0) ? 'In production' : 'Released', completed_on: null });
  }
  const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE production_orders SET ${sets} WHERE id = ?`).run(...Object.values(patch), o.id);
}
const ordersOf = r => [...new Set(parse(r?.lines, []).map(l => Number(l.order_id)).filter(Boolean))];

// After a report changes (or is deleted): the orders on it, before and after, are worked out again.
const lastLines = new Map();
export function beforeReport(existing) { if (existing) lastLines.set(existing.id, ordersOf(existing)); }
export function afterReport(id, deleted) {
  const r = deleted || db.prepare('SELECT id, lines FROM production_reports WHERE id = ?').get(id);
  const ids = new Set([...(lastLines.get(r?.id) || []), ...ordersOf(r)]);
  lastLines.delete(r?.id);
  for (const o of ids) recalcOrder(o);
}

// ---------------------------------------------------------------- actions
const mayRelease = user => { if (!hasFunction(user.role, 'production_release')) throw new HttpError(403, 'Your role may not release / hold / close production orders'); };

export function orderAction(id, action, body = {}, user) {
  mayRelease(user);
  const o = getRow('production_orders', id);
  const why = String(body.reason || '').trim();
  if (action === 'release') {
    if (o.status !== 'Draft') throw new HttpError(409, `This order is ${o.status}`);
    const miss = [];
    if (!o.project_id) miss.push('the project (project code)');
    if (o.drawing_ok !== 'Yes') miss.push('the approved drawing');
    if (o.bom_ok !== 'Yes') miss.push('the verified BOM');
    if (!o.material_ok || o.material_ok === 'Not available') miss.push('the material (available, or partly with the date for the rest)');
    if (o.material_ok === 'Partly – rest by date' && !String(o.material_note || '').trim()) miss.push('the material note (what is short and when it comes)');
    if (miss.length) throw new HttpError(400, `Not released. Production does not start without:\n• ${miss.join('\n• ')}`);
    const out = updateRow('production_orders', id, { status: 'Released', released_by: `${user.name} (${stamp()})`, released_on: today(), hold_reason: null }, user, { system: true });
    if (o.responsible) notify({ userNames: [o.responsible], kind: 'production', title: `Released: ${o.order_no} – ${o.description}`, body: `${o.qty} ${o.uom || ''}, target ${o.target_date}`, link: `#/view/production_orders/${id}` }, user);
    audit(user.name, 'production_orders', o.id, 'released', o.order_no);
    recalcOrder(id);
    return getRow('production_orders', id);
  }
  if (action === 'hold') {
    if (!['Released', 'In production', 'Draft'].includes(o.status)) throw new HttpError(409, `This order is ${o.status}`);
    if (!why) throw new HttpError(400, 'Write why the order is put on hold');
    return updateRow('production_orders', id, { status: 'On hold', hold_reason: `${today()}: ${why} (${user.name})` }, user, { system: true });
  }
  if (action === 'resume') {
    if (o.status !== 'On hold') throw new HttpError(409, 'Only an order on hold can be resumed');
    updateRow('production_orders', id, { status: o.released_on ? 'Released' : 'Draft' }, user, { system: true });
    recalcOrder(id);
    return getRow('production_orders', id);
  }
  if (action === 'cancel') {
    if (['Completed', 'Cancelled'].includes(o.status)) throw new HttpError(409, `This order is ${o.status}`);
    if (!why) throw new HttpError(400, 'Write why the order is cancelled');
    return updateRow('production_orders', id, { status: 'Cancelled', hold_reason: `${today()}: cancelled – ${why} (${user.name})` }, user, { system: true });
  }
  if (action === 'close') {
    // Close short (e.g. client reduced the quantity): completed with what was made.
    if (!['Released', 'In production'].includes(o.status)) throw new HttpError(409, `This order is ${o.status}`);
    if (!why) throw new HttpError(400, 'Write why the order is closed short');
    return updateRow('production_orders', id, { status: 'Completed', completed_on: today(), hold_reason: `${today()}: closed at ${o.qty_done || 0} of ${o.qty} – ${why} (${user.name})` }, user, { system: true });
  }
  throw new HttpError(400, 'Unknown action');
}

// Suggested plan lines for a month: every open order with its balance; the target is the balance when the order is due
// by the month end (else left for the planner).
export function fillPlan(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new HttpError(400, 'Month as YYYY-MM');
  const end = monthEnd(ym);
  return db.prepare(`SELECT id, order_no, description, uom, qty, COALESCE(qty_done, 0) done, target_date, planned_hours, COALESCE(hours_used, 0) hours_used, status, priority
    FROM production_orders WHERE status IN ('Draft', 'Released', 'In production') AND COALESCE(planned_start, date) <= ? ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, target_date`).all(end)
    .map(o => {
      const balance = r2(o.qty - o.done);
      return { order_id: o.id, order_id_label: `${o.order_no} · ${o.description}`, description: o.description, uom: o.uom, balance, target: o.target_date <= end ? balance : null,
        planned_hours: o.planned_hours ? r2(Math.max(0, o.planned_hours - o.hours_used) * (o.target_date <= end ? 1 : 0)) || null : null,
        remark: [o.status === 'Draft' ? 'not released yet' : '', o.target_date <= end ? `due ${o.target_date}` : `due ${o.target_date} (later)`].filter(Boolean).join(', ') };
    }).filter(l => l.balance > 0);
}

export function planAction(id, action, user) {
  const p = getRow('production_plans', id);
  if (action === 'revise') {
    if (!hasFunction(user.role, 'production_plan_approve') && !hasFunction(user.role, 'production_release')) throw new HttpError(403, 'Your role may not revise the plan');
    if (p.status !== 'Approved') throw new HttpError(409, 'Only an approved plan is revised');
    return updateRow('production_plans', id, { status: 'Draft', rev: (Number(p.rev) || 0) + 1, approved_by: null, approval_stage: null,
      remarks: [p.remarks, `${today()}: revision ${(Number(p.rev) || 0) + 1} started by ${user.name}`].filter(Boolean).join('\n') }, user, { system: true });
  }
  throw new HttpError(400, 'Unknown action');
}

// Planned qty for each open order on a date: what is left of this week's plan ÷ working days left in the week.
export function suggestDay(date = today()) {
  const ym = date.slice(0, 7), plan = db.prepare("SELECT lines FROM production_plans WHERE month = ? AND status <> 'Rejected'").get(ym);
  const lines = parse(plan?.lines, []);
  const w = weekOf(date), wk = weeksOf(ym).find(x => x.n === w);
  let daysLeft = 0;
  for (let d = date; d <= wk.to; d = addDays(d, 1)) if (working(d)) daysLeft++;
  const done = new Map(db.prepare(`SELECT CAST(json_extract(j.value, '$.order_id') AS INTEGER) o, SUM(CAST(json_extract(j.value, '$.done') AS REAL)) q
    FROM production_reports r, json_each(COALESCE(NULLIF(r.lines, ''), '[]')) j WHERE r.status = 'Submitted' AND r.date BETWEEN ? AND ? AND r.date < ? AND json_extract(j.value, '$.stage') = ? GROUP BY 1`)
    .all(wk.from, wk.to, date, PROD_FINISHED).map(r => [r.o, r.q]));
  const orders = db.prepare("SELECT id, order_no, description, uom, stage FROM production_orders WHERE status IN ('Released', 'In production') ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, target_date").all();
  return orders.map(o => {
    const pl = lines.find(l => Number(l.order_id) === o.id);
    const left = pl ? Math.max(0, weekPlan(pl, ym)[w - 1] - (done.get(o.id) || 0)) : 0;
    return { order_id: o.id, order_id_label: `${o.order_no} · ${o.description}`, stage: PROD_FINISHED, planned: left > 0 && daysLeft ? Math.ceil(left / daysLeft) : null, done: null, uom: o.uom };
  });
}

export function submitReport(id, user) {
  const r = getRow('production_reports', id);
  if (r.status !== 'Draft') throw new HttpError(409, `Already ${r.status}`);
  // Lines filled in for the day's plan but left untouched (no planned, done or hours) are dropped.
  const touched = l => ['planned', 'done', 'hours', 'rejected'].some(k => l[k] != null && l[k] !== '') || l.delay_code;
  const lines = (r.lines || []).filter(touched);
  if (!lines.length) throw new HttpError(400, 'Add the work done first');
  const bad = [];
  lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    if (!l.order_id) bad.push(`${n}: choose the production order`);
    if (!l.stage) bad.push(`${n}: choose the stage`);
    if (l.done == null || l.done === '' || Number(l.done) < 0) bad.push(`${n}: enter the quantity done (0 if nothing)`);
    if (Number(l.planned) > 0 && Number(l.done || 0) < Number(l.planned) && !l.delay_code) bad.push(`${n}: made ${Number(l.done) || 0} of ${l.planned} planned – give the delay code`);
    if (l.delay_code?.startsWith('X01') && !String(l.remark || '').trim()) bad.push(`${n}: “Other” delay – write the reason in the remark`);
  });
  const st = new Map(db.prepare(`SELECT id, status, order_no FROM production_orders WHERE id IN (${lines.map(() => '?').join(',') || 'NULL'})`).all(...lines.map(l => Number(l.order_id) || 0)).map(o => [o.id, o]));
  for (const l of lines) {
    const o = st.get(Number(l.order_id));
    if (o && !['Released', 'In production', 'Completed'].includes(o.status) && Number(l.done) > 0) bad.push(`${o.order_no} is ${o.status}: production starts only after release`);
  }
  // Quality policy: nothing counts as finished before final QC has accepted it.
  const fin = new Map();
  for (const l of lines.filter(l => l.stage === PROD_FINISHED && Number(l.done) > 0)) fin.set(Number(l.order_id), (fin.get(Number(l.order_id)) || 0) + Number(l.done));
  for (const [oid, q] of fin) {
    const o = st.get(oid);
    const before = db.prepare(`SELECT COALESCE(SUM(CAST(json_extract(j.value, '$.done') AS REAL)), 0) q FROM production_reports r, json_each(COALESCE(NULLIF(r.lines, ''), '[]')) j
      WHERE r.status = 'Submitted' AND r.id <> ? AND CAST(json_extract(j.value, '$.order_id') AS INTEGER) = ? AND json_extract(j.value, '$.stage') = ?`).get(r.id, oid, PROD_FINISHED).q;
    const ok = fqcAccepted(oid);
    if (before + q > ok + 1e-9) bad.push(`${o?.order_no || '#' + oid}: final QC has accepted ${r2(ok)}; with this report ${r2(before + q)} would be finished. Record the final QC inspection first.`);
  }
  if (bad.length) throw new HttpError(400, [...new Set(bad)].join('\n'));
  const out = updateRow('production_reports', id, { status: 'Submitted', submitted_by: `${user.name} (${stamp()})`, lines }, user, { system: true });
  const delays = lines.filter(l => l.delay_code);
  if (delays.length) notify({ fn: 'production_plan_approve', kind: 'production', title: `Production ${r.date}: ${delays.length} line(s) behind plan`,
    body: delays.map(l => `${l.order_id_label || ''}: ${Number(l.done) || 0}/${l.planned} – ${l.delay_code}${l.remark ? ' (' + l.remark + ')' : ''}`).join('\n'), link: `#/view/production_reports/${id}` }, user);
  return out;
}

export function reopenReport(id, body = {}, user) {
  mayRelease(user);
  const r = getRow('production_reports', id);
  if (r.status !== 'Submitted') throw new HttpError(409, 'Only a submitted report is reopened');
  const why = String(body.reason || '').trim();
  if (!why) throw new HttpError(400, 'Write why the report is reopened');
  return updateRow('production_reports', id, { status: 'Draft', submitted_by: null, remarks: [r.remarks, `${today()}: reopened by ${user.name} – ${why}`].filter(Boolean).join('\n') }, user, { system: true });
}

// ---------------------------------------------------------------- reviews
const reportLines = (from, to) => db.prepare(`SELECT r.id report_id, r.report_no, r.date, r.shift, r.supervisor, r.status, CAST(json_extract(j.value, '$.order_id') AS INTEGER) order_id,
    json_extract(j.value, '$.stage') stage, CAST(json_extract(j.value, '$.planned') AS REAL) planned, CAST(json_extract(j.value, '$.done') AS REAL) done,
    CAST(json_extract(j.value, '$.rejected') AS REAL) rejected, CAST(json_extract(j.value, '$.hours') AS REAL) hours, CAST(json_extract(j.value, '$.workers') AS REAL) workers,
    json_extract(j.value, '$.delay_code') delay_code, json_extract(j.value, '$.remark') remark, json_extract(j.value, '$.uom') uom
  FROM production_reports r, json_each(COALESCE(NULLIF(r.lines, ''), '[]')) j WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.id`).all(from, to);
const orderMap = () => new Map(db.prepare(`SELECT o.*, p.name project, COALESCE(NULLIF(p.project_no, ''), p.code) project_no FROM production_orders o LEFT JOIN projects p ON p.id = o.project_id`).all().map(o => [o.id, o]));

// Monthly plan vs actual with the weekly split (formats: weekly review + monthly closing).
export function monthReview(ym = today().slice(0, 7)) {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new HttpError(400, 'Month as YYYY-MM');
  const weeks = weeksOf(ym), end = monthEnd(ym), from = `${ym}-01`;
  const plan = db.prepare("SELECT id, plan_no, status, rev, approved_by, lines FROM production_plans WHERE month = ?").get(ym);
  const lines = parse(plan?.lines, []);
  const orders = orderMap();
  const done = reportLines(from, end).filter(l => l.status === 'Submitted');
  const t = today(), curWeek = t.slice(0, 7) === ym ? weekOf(t) : t > end ? 6 : 0;
  const ids = new Set([...lines.map(l => Number(l.order_id)).filter(Boolean), ...done.filter(l => l.done > 0).map(l => l.order_id)]);
  const rows = [...ids].map(id => {
    const o = orders.get(id) || {}, pl = lines.find(l => Number(l.order_id) === id);
    const wp = pl ? weekPlan(pl, ym) : weeks.map(() => 0);
    const fin = done.filter(l => l.order_id === id && l.stage === PROD_FINISHED);
    const wa = weeks.map(w => r2(fin.filter(l => l.date >= w.from && l.date <= w.to).reduce((s, l) => s + (l.done || 0), 0)));
    const target = pl ? Number(pl.target) || 0 : 0, actual = r2(wa.reduce((s, v) => s + v, 0));
    const dueTill = r2(wp.slice(0, Math.min(curWeek, weeks.length)).reduce((s, v) => s + v, 0));
    const delays = {};
    for (const l of done.filter(l => l.order_id === id && l.delay_code)) delays[l.delay_code.slice(0, 3)] = (delays[l.delay_code.slice(0, 3)] || 0) + 1;
    return { order_id: id, order_no: o.order_no, project: o.project, project_no: o.project_no, category: o.category, description: o.description, uom: o.uom, order_qty: o.qty,
      done_total: o.qty_done || 0, balance: r2((o.qty || 0) - (o.qty_done || 0)), target_date: o.target_date, status: o.status, late: o.status !== 'Completed' && o.target_date < t,
      responsible: o.responsible, planned: !!pl, target, week_plan: wp, week_actual: wa, actual, due_till_now: dueTill, behind: r2(Math.max(0, dueTill - wa.slice(0, Math.min(curWeek, weeks.length)).reduce((s, v) => s + v, 0))),
      achievement: target && curWeek ? Math.round((100 * Math.min(actual, target)) / target) : null, hours: r2(done.filter(l => l.order_id === id).reduce((s, l) => s + (l.hours || 0), 0)),
      planned_hours: pl ? num(pl.planned_hours) : null, delays: Object.entries(delays).map(([k, n]) => `${k}×${n}`).join(', ') };
  }).sort((a, b) => (b.planned - a.planned) || String(a.target_date).localeCompare(String(b.target_date)));
  const planned = rows.filter(r => r.planned);
  const target = r2(planned.reduce((s, r) => s + r.target, 0)), actual = r2(planned.reduce((s, r) => s + Math.min(r.actual, r.target || r.actual), 0));
  // On-time completion: orders due this month up to today, completed by their target date.
  const due = [...orders.values()].filter(o => o.target_date >= from && o.target_date <= end && o.target_date < t && o.status !== 'Cancelled');
  const onTime = due.filter(o => o.status === 'Completed' && o.completed_on && o.completed_on <= o.target_date);
  const all = done;
  return { month: ym, weeks: weeks.map(w => ({ ...w, working_days: workDays(w.from, w.to) })), current_week: curWeek,
    plan: plan ? { id: plan.id, plan_no: plan.plan_no, status: plan.status, rev: plan.rev, approved_by: plan.approved_by } : null, rows,
    totals: { target, actual, achievement: target && curWeek ? Math.round((100 * actual) / target) : null, week_plan: weeks.map((w, i) => r2(planned.reduce((s, r) => s + r.week_plan[i], 0))),
      week_actual: weeks.map((w, i) => r2(rows.reduce((s, r) => s + r.week_actual[i], 0))), unplanned: rows.filter(r => !r.planned).length,
      orders_due: due.length, on_time: onTime.length, on_time_pct: due.length ? Math.round((100 * onTime.length) / due.length) : null,
      hours: r2(all.reduce((s, l) => s + (l.hours || 0), 0)), rejected: r2(all.reduce((s, l) => s + (l.rejected || 0), 0)), done_all: r2(all.reduce((s, l) => s + (l.done || 0), 0)),
      reports: new Set(all.map(l => l.report_id)).size, days_reported: new Set(all.map(l => l.date)).size, working_days: workDays(from, end < t ? end : t < from ? from : t) } };
}

// Daily review: what each report planned and made, the shortfalls with their delay codes, and the open orders not
// worked on that day.
export function dayReview(date = today()) {
  const orders = orderMap();
  const lines = reportLines(date, date).map(l => { const o = orders.get(l.order_id) || {}; return { ...l, order_no: o.order_no, description: o.description, project: o.project, short: r2(Math.max(0, (l.planned || 0) - (l.done || 0))) }; });
  const reports = db.prepare("SELECT id, report_no, shift, supervisor, manpower, status FROM production_reports WHERE date = ? ORDER BY id").all(date);
  const worked = new Set(lines.filter(l => l.done > 0).map(l => l.order_id));
  const idle = [...orders.values()].filter(o => ['Released', 'In production'].includes(o.status) && !worked.has(o.id)).map(o => ({ id: o.id, order_no: o.order_no, description: o.description, target_date: o.target_date }));
  const planned = r2(lines.reduce((s, l) => s + (l.planned || 0), 0)), made = r2(lines.filter(l => l.planned > 0).reduce((s, l) => s + Math.min(l.done || 0, l.planned), 0));
  return { date, working: working(date), reports, lines, idle,
    totals: { planned, done: r2(lines.reduce((s, l) => s + (l.done || 0), 0)), achievement: planned ? Math.round((100 * made) / planned) : null, hours: r2(lines.reduce((s, l) => s + (l.hours || 0), 0)),
      manpower: reports.reduce((s, r) => s + (Number(r.manpower) || 0), 0), rejected: r2(lines.reduce((s, l) => s + (l.rejected || 0), 0)), delays: lines.filter(l => l.delay_code).length,
      drafts: reports.filter(r => r.status === 'Draft').length } };
}

// Delay analysis (format “Delay Analysis”): how often each code held production back and the quantity lost.
export function delayAnalysis({ from, to } = {}) {
  const f = from || today().slice(0, 8) + '01', t = to || today();
  const orders = orderMap();
  const lines = reportLines(f, t).filter(l => l.status === 'Submitted' && l.delay_code);
  const by = new Map();
  for (const l of lines) {
    const x = by.get(l.delay_code) || { code: l.delay_code, times: 0, short: 0, orders: new Set(), days: new Set(), notes: [] };
    x.times++; x.short = r2(x.short + Math.max(0, (l.planned || 0) - (l.done || 0))); x.orders.add(l.order_id); x.days.add(l.date);
    if (l.remark && x.notes.length < 5) x.notes.push(`${l.date}: ${l.remark}`);
    by.set(l.delay_code, x);
  }
  const codes = [...by.values()].map(x => ({ ...x, orders: [...x.orders].map(id => orders.get(id)?.order_no || `#${id}`), days: x.days.size })).sort((a, b) => b.times - a.times);
  const total = codes.reduce((s, c) => s + c.times, 0);
  const group = { M: 'Material', D: 'Design / drawing', P: 'Production', Q: 'Quality', C: 'Client', X: 'Other' };
  const groups = Object.entries(group).map(([k, label]) => ({ label, times: codes.filter(c => c.code[0] === k).reduce((s, c) => s + c.times, 0) })).filter(g => g.times);
  return { from: f, to: t, codes: codes.map(c => ({ ...c, share: total ? Math.round((100 * c.times) / total) : 0 })), groups, total,
    lines: lines.map(l => ({ ...l, order_no: orders.get(l.order_id)?.order_no, description: orders.get(l.order_id)?.description, short: r2(Math.max(0, (l.planned || 0) - (l.done || 0))) })).reverse() };
}

// Orders board: open orders by status with progress; KPIs of the month.
export function board() {
  const t = today(), ym = t.slice(0, 7);
  const orders = [...orderMap().values()].filter(o => OPEN.includes(o.status) || (o.status === 'Completed' && String(o.completed_on || '') >= `${ym}-01`))
    .map(o => ({ id: o.id, order_no: o.order_no, project: o.project, project_no: o.project_no, category: o.category, description: o.description, qty: o.qty, uom: o.uom, qty_done: o.qty_done || 0,
      progress: o.progress || 0, stage: o.stage, target_date: o.target_date, dispatch_date: o.dispatch_date, priority: o.priority, responsible: o.responsible, status: o.status,
      late: o.status !== 'Completed' && o.target_date < t, checks: { drawing: o.drawing_ok === 'Yes', bom: o.bom_ok === 'Yes', material: o.material_ok || '' }, hold_reason: o.hold_reason, completed_on: o.completed_on }))
    .sort((a, b) => (a.status === 'Completed') - (b.status === 'Completed') || ({ High: 0, Medium: 1, Low: 2 }[a.priority] ?? 1) - ({ High: 0, Medium: 1, Low: 2 }[b.priority] ?? 1) || String(a.target_date).localeCompare(String(b.target_date)));
  const yest = (() => { let d = addDays(t, -1); for (let i = 0; i < 7 && !working(d); i++) d = addDays(d, -1); return d; })();
  const plan = db.prepare('SELECT plan_no, status FROM production_plans WHERE month = ?').get(ym), next = db.prepare('SELECT plan_no, status FROM production_plans WHERE month = ?').get(nextMonth(ym));
  return { orders, kpi: { open: orders.filter(o => o.status !== 'Completed').length, draft: orders.filter(o => o.status === 'Draft').length, running: orders.filter(o => ['Released', 'In production'].includes(o.status)).length,
    late: orders.filter(o => o.late).length, hold: orders.filter(o => o.status === 'On hold').length, completed_month: orders.filter(o => o.status === 'Completed').length },
    plan: plan || null, next_plan: next || null, next_month: nextMonth(ym), last_working_day: yest,
    last_day_reported: !!db.prepare("SELECT 1 FROM production_reports WHERE date = ? AND status = 'Submitted'").get(yest) };
}

// ---------------------------------------------------------------- reminders (hourly, from 10:00)
// The previous working day without a submitted daily report; late orders; next month's plan not approved by the 20th / 25th.
export function dailyProduction() {
  const t = today(), s = getSettings();
  let sent; try { sent = JSON.parse(s.prod_alerts || '{}') || {}; } catch { sent = {}; }
  if (sent.day === t) return;
  const b = board();
  const running = b.orders.some(o => ['Released', 'In production'].includes(o.status));
  const notes = [];
  if (working(t) && running && !b.last_day_reported) notes.push(`No submitted daily production report for ${b.last_working_day}.`);
  if (b.kpi.late) notes.push(`${b.kpi.late} production order(s) past the target date: ${b.orders.filter(o => o.late).slice(0, 6).map(o => o.order_no).join(', ')}`);
  const late = overdueNcrs();
  if (late.length) notes.push(`${late.length} NCR / CAPA past the 30-day target: ${late.slice(0, 6).join(', ')}`);
  const dom = Number(t.slice(8, 10));
  const planDue = dom >= 20 && b.next_plan?.status !== 'Approved' && (!b.next_plan || b.next_plan.status !== 'Pending Approval' || dom >= 25);
  const planKey = `${b.next_month}:${dom >= 25 ? 25 : 20}`;
  if (planDue && sent.plan !== planKey) {
    notes.push(`The production plan for ${b.next_month} is ${b.next_plan ? b.next_plan.status.toLowerCase() : 'not made yet'} – it is due before the 25th.`);
    sent.plan = planKey;
  }
  if (notes.length) notify({ fn: 'production_release', kind: 'production', title: notes.length === 1 ? notes[0].slice(0, 120) : `Production: ${notes.length} things need attention`, body: notes.join('\n'), link: '#/production/orders' });
  sent.day = t;
  db.prepare("INSERT INTO settings (key, value) VALUES ('prod_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(JSON.stringify(sent)));
}
