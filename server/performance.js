// Worker performance (owner, Nov 2026): who did what each day (Daily Team Work, entered by the in-charge / supervisor) and,
// with the attendance, each person's and each department's working days, output and quality, and who is doing well.
// What a person sees: everyone (perf_all: GM, HR, production, planning); their whole department (work_log: in-charge);
// otherwise their own figures, their department's totals, the department's top 3 and their own rank.
// Score = output 50 % + attendance 30 % + quality 20 %, over the parts that have data (no target given: no output part).
import { db, tx, audit } from './db.js';
import { HttpError } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { isOffDay } from './hrpolicy.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
export const SCORE_PARTS = { output: 50, attendance: 30, quality: 20 };

const meOf = user => db.prepare("SELECT * FROM employees WHERE lower(trim(login)) = lower(?) AND COALESCE(status, 'Active') = 'Active'").get(user.username || '') || null;
const notLinked = user => new HttpError(404, `Your login “${user.username}” is not linked to an employee. Ask HR to enter it as the CRM login on your employee record.`);

function scopeOf(user) {
  const me = meOf(user);
  if (hasFunction(user.role, 'perf_all')) return { kind: 'all', me };
  if (!me) throw notLinked(user);
  return { kind: hasFunction(user.role, 'work_log') ? 'department' : 'self', me };
}

export function scoreOf({ achievement, attendance, quality }) {
  const parts = [[achievement == null ? null : Math.min(achievement, 100), SCORE_PARTS.output], [attendance == null ? null : Math.min(attendance, 100), SCORE_PARTS.attendance], [quality, SCORE_PARTS.quality]].filter(([v]) => v != null);
  const w = parts.reduce((s, [, x]) => s + x, 0);
  return w ? Math.round(parts.reduce((s, [v, x]) => s + v * x, 0) / w) : null;
}

// One person's figures over the period.
function personRow(e, from, to, holidays) {
  const end = to > today() ? today() : to;
  const attendance = db.prepare('SELECT date, status, hours, net_hours, timing FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?').all(e.id, from, end);
  const logs = db.prepare('SELECT date, target, done, rejected, hours FROM work_logs WHERE employee_id = ? AND date BETWEEN ? AND ?').all(e.id, from, end);
  const onLeave = new Set(attendance.filter(a => ['On Leave', 'Holiday', 'Week Off'].includes(a.status)).map(a => a.date));
  const logged = new Set(logs.map(l => l.date));
  const start = e.joining_date && e.joining_date > from ? e.joining_date : from;
  // Today counts only once the person has clocked in or has work recorded: the day is not over yet.
  const seenToday = attendance.some(a => a.date === today() && a.status !== 'Absent') || logged.has(today());
  let working = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isOffDay(e, d, holidays) && !onLeave.has(d) && (d !== today() || seenToday)) working++;
  // A working day: attended (a half day counts ½), or work recorded for that day by the in-charge.
  let present = 0;
  const att = new Set();
  for (const a of attendance) {
    const v = ['Present', 'Working'].includes(a.status) ? 1 : a.status === 'Half Day' ? 0.5 : 0;
    if (v) { present += v; att.add(a.date); }
  }
  for (const d of logged) if (!att.has(d)) present += 1;
  const hasTarget = logs.filter(l => Number(l.target) > 0);
  const target = hasTarget.reduce((s, l) => s + Number(l.target), 0);
  const doneVsTarget = hasTarget.reduce((s, l) => s + (Number(l.done) || 0), 0);
  const done = logs.reduce((s, l) => s + (Number(l.done) || 0), 0), rejected = logs.reduce((s, l) => s + (Number(l.rejected) || 0), 0);
  const achievement = pct(doneVsTarget, target), attendancePct = working ? Math.min(100, pct(present, working)) : null;
  const quality = done + rejected > 0 ? pct(done, done + rejected) : null;
  return { id: e.id, name: e.name, department: e.department || 'Not set', designation: e.designation || '', working_days: working, present_days: r1(present), attendance: attendancePct,
    late_marks: attendance.filter(a => a.timing === 'Late mark').length, work_days: logged.size, work_hours: r1(logs.reduce((s, l) => s + (Number(l.hours) || 0), 0)),
    target: r1(target), done: r1(done), rejected: r1(rejected), achievement, quality, score: scoreOf({ achievement, attendance: attendancePct, quality }) };
}

const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.done - a.done || a.name.localeCompare(b.name);
function departmentRow(name, rows) {
  const scored = rows.filter(r => r.score != null).sort(byScore);
  const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const withTarget = rows.filter(r => r.achievement != null);
  const avg = (list, k) => (list.length ? Math.round(list.reduce((s, r) => s + r[k], 0) / list.length) : null);
  return { name, people: rows.length, present_days: r1(sum('present_days')), working_days: sum('working_days'), attendance: pct(sum('present_days'), sum('working_days')),
    work_days: sum('work_days'), done: r1(sum('done')), rejected: r1(sum('rejected')), target: r1(sum('target')), achievement: avg(withTarget, 'achievement'),
    quality: sum('done') + sum('rejected') > 0 ? pct(sum('done'), sum('done') + sum('rejected')) : null, score: avg(scored, 'score'),
    top: scored[0] ? { name: scored[0].name, score: scored[0].score } : null };
}

export function report(user, q = {}) {
  const scope = scopeOf(user);
  const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : `${t.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : t;
  if (from > to) throw new HttpError(400, 'The From date is after the To date');
  const holidays = new Map(db.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?').all(from, to).map(h => [h.date, h.name]));
  // Everyone's rows are worked out, then cut down to what this person may see.
  const everyone = db.prepare("SELECT * FROM employees WHERE COALESCE(status, 'Active') = 'Active' ORDER BY name").all().map(e => personRow(e, from, to, holidays));
  const myDept = scope.me?.department || 'Not set';
  const names = [...new Set(everyone.map(r => r.department))].sort();
  const departments = (scope.kind === 'all' ? names : [myDept]).map(n => departmentRow(n, everyone.filter(r => r.department === n))).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const wanted = scope.kind === 'all' ? String(q.department || '') : myDept;
  const inDept = everyone.filter(r => r.department === myDept).sort(byScore);
  const me = scope.me ? everyone.find(r => r.id === scope.me.id) : null;
  const rank = me && me.score != null ? inDept.filter(r => r.score != null).findIndex(r => r.id === me.id) + 1 : null;
  const out = { scope: scope.kind, from, to, parts: SCORE_PARTS, me, rank, of: inDept.filter(r => r.score != null).length, department: scope.me ? myDept : null, departments };
  if (scope.kind === 'self') out.top = inDept.filter(r => r.score > 0).slice(0, 3).map(r => ({ name: r.name, designation: r.designation, score: r.score }));
  else out.people = everyone.filter(r => !wanted || r.department === wanted).sort(byScore);
  if (me) out.my_work = db.prepare(`SELECT w.date, w.work, w.target, w.done, w.rejected, w.uom, w.hours, w.remark, o.order_no FROM work_logs w LEFT JOIN production_orders o ON o.id = w.order_id
    WHERE w.employee_id = ? AND w.date BETWEEN ? AND ? ORDER BY w.date DESC, w.id DESC LIMIT 200`).all(me.id, from, to > t ? t : to);
  return out;
}

// ---------------------------------------------------------------- Daily Team Work
function logScope(user, department) {
  if (!hasFunction(user.role, 'work_log')) throw new HttpError(403, 'Only the in-charge or supervisor enters the daily work');
  const all = hasFunction(user.role, 'perf_all');
  const me = meOf(user);
  if (!all && !me) throw notLinked(user);
  const dept = all ? department || me?.department || '' : me.department || 'Not set';
  if (!all && department && department !== dept) throw new HttpError(403, `You enter the work of your own department (${dept})`);
  return { all, dept };
}
const teamOf = dept => db.prepare("SELECT id, name, designation, department FROM employees WHERE COALESCE(status, 'Active') = 'Active' AND COALESCE(department, 'Not set') = ? ORDER BY name").all(dept);

export function team(user, q = {}) {
  const { all, dept } = logScope(user, q.department);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : today();
  const departments = all ? db.prepare("SELECT DISTINCT COALESCE(department, 'Not set') d FROM employees WHERE COALESCE(status, 'Active') = 'Active' ORDER BY 1").all().map(r => r.d) : [dept];
  const logs = db.prepare('SELECT employee_id, work, order_id, target, done, rejected, uom, hours, remark FROM work_logs WHERE date = ? AND department = ? ORDER BY id').all(date, dept);
  const orders = db.prepare("SELECT id, order_no, description FROM production_orders WHERE status IN ('Released', 'In production') ORDER BY id DESC LIMIT 300").all().map(o => ({ id: o.id, label: `${o.order_no} · ${String(o.description || '').slice(0, 50)}` }));
  return { date, department: dept, departments, employees: dept ? teamOf(dept) : [], logs, orders };
}

// The day's work of one department, saved as a whole (a correction replaces what was there). An in-charge may enter today
// and the last 7 days; supervisors any past day.
export function saveTeam(user, body = {}) {
  const { all, dept } = logScope(user, body.department);
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose the date');
  if (date > today()) throw new HttpError(400, 'The date cannot be in the future');
  if (!all && date < addDays(today(), -7)) throw new HttpError(403, 'Work older than 7 days is corrected by the production supervisor or HR');
  if (!dept) throw new HttpError(400, 'Choose the department');
  const members = new Set(teamOf(dept).map(e => e.id));
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(r => String(r.work || '').trim() || num(r.done) != null || num(r.target) != null);
  rows.forEach((r, i) => {
    const who = `Row ${i + 1}`;
    if (!members.has(Number(r.employee_id))) throw new HttpError(400, `${who}: choose a person of ${dept}`);
    if (!String(r.work || '').trim()) throw new HttpError(400, `${who}: write the work done`);
    for (const k of ['target', 'done', 'rejected', 'hours']) if (num(r[k]) != null && num(r[k]) < 0) throw new HttpError(400, `${who}: ${k} cannot be negative`);
    if (num(r.hours) != null && num(r.hours) > 24) throw new HttpError(400, `${who}: more than 24 hours in a day`);
  });
  const ins = db.prepare(`INSERT INTO work_logs (date, employee_id, department, work, order_id, target, done, rejected, uom, hours, remark, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`);
  return tx(() => {
    const had = db.prepare('DELETE FROM work_logs WHERE date = ? AND department = ?').run(date, dept).changes;
    for (const r of rows) ins.run(date, Number(r.employee_id), dept, String(r.work).trim().slice(0, 200), num(r.order_id), num(r.target), num(r.done), num(r.rejected), String(r.uom || '').trim().slice(0, 20) || null, num(r.hours), String(r.remark || '').trim().slice(0, 300) || null, user.name);
    audit(user.name, 'work_logs', null, `daily work ${date}`, `${dept}: ${rows.length} row(s)${had ? `, replaced ${had}` : ''}`);
    return { saved: rows.length, date, department: dept };
  });
}
