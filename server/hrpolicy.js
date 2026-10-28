// The WIESPL HR Policy in the attendance and leave register: office 9:00–18:00 Monday to Saturday, late marks (3 free
// a month, then half a day each), half day for 1½–4 h late / early, a day cut beyond 4 h, the sandwich rule (weekly
// offs and holidays between absences or leave are unpaid), the leave types with their eligibility, the privilege
// leave (PL) credited quarterly after confirmation, comp-off for work on an off day (taken in the same month or paid),
// leave without pay up to 10 days a year, and an alert to HR when someone stays away without leave.
import { db, getSettings } from './db.js';
import { getRow, HttpError } from './crud.js';
import { hasFunction, UNPAID_LEAVE } from '../public/js/schema.js';
import { notify } from './notify.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export function policy() {
  const s = getSettings();
  const n = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  return { lateFree: n(s.hr_late_marks_free, 3), shortLeaves: n(s.hr_short_leaves_month, 2), shortLeaveMin: 90, halfDayMin: n(s.hr_half_day_late_minutes, 240),
    plYear: n(s.hr_pl_per_year, 24), lwpMax: n(s.hr_lwp_max_days, 10), serviceYears: 3 };
}

export const isWeeklyOff = (emp, date) => {
  const wd = new Date(date + 'T00:00:00').getDay(); // 0 Sunday
  const off = emp.weekly_off || 'Sunday';
  return (off.includes('Sunday') && wd === 0) || (off.includes('Saturday') && wd === 6);
};
const holidaysIn = (from, to) => new Map(db.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?').all(from, to).map(h => [h.date, h.name]));
export const isOffDay = (emp, date, hol = holidaysIn(date, date)) => hol.has(date) || isWeeklyOff(emp, date);

// Leave year April–March; PL is credited at the start of each quarter (Apr, Jul, Oct, Jan).
export const leaveYear = d => { const y = Number(d.slice(0, 4)) - (d.slice(5, 7) < '04' ? 1 : 0); return { from: `${y}-04-01`, to: `${y + 1}-03-31` }; };
const monthStart = (d, add = 0) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00'); x.setMonth(x.getMonth() + add); return x.toLocaleString('sv-SE').slice(0, 10); };
const monthsFrom = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// PL credited by the quarter that holds `asOf`: a full quarter's share once confirmed before it starts, the remaining
// months' share in the quarter of confirmation, nothing on probation.
export function plCredit(emp, asOf) {
  if (emp.employment_type !== 'Confirmed') return 0;
  const P = policy(), perMonth = P.plYear / 12, fy = leaveYear(asOf), conf = emp.confirmation_date || null;
  let credit = 0;
  for (let q = 0; q < 4; q++) {
    const qs = monthStart(fy.from, q * 3), qe = addDays(monthStart(fy.from, q * 3 + 3), -1);
    if (qs > asOf) break;
    if (!conf || conf <= qs) credit += perMonth * 3;
    else if (conf <= qe && conf <= asOf) credit += perMonth * (monthsFrom(conf, qe) + 1);
  }
  return r2(credit);
}

const serviceYears = (emp, on) => (emp.joining_date ? (Date.parse(on) - Date.parse(emp.joining_date)) / (365.25 * 864e5) : 0);
const ACTIVE = "status IN ('Approved', 'Pending Approval')";
const taken = (empId, type, from, to, exceptId, statusSql = ACTIVE) =>
  db.prepare(`SELECT COALESCE(SUM(days), 0) d, COUNT(*) n FROM leave_requests WHERE employee_id = ? AND type = ? AND from_date BETWEEN ? AND ? AND id <> ? AND ${statusSql}`).get(empId, type, from, to, exceptId || 0);

// Off days worked (approved by HR) in a month, and comp-off taken in it.
export function compOff(empId, month, exceptId) {
  const earned = db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'Half Day' THEN 0.5 ELSE 1 END), 0) n FROM attendance WHERE employee_id = ? AND substr(date, 1, 7) = ? AND timing = 'Worked on off day (comp-off)' AND review = 'Approved'").get(empId, month).n;
  const used = taken(empId, 'Comp-off', `${month}-01`, `${month}-31`, exceptId).d;
  return { earned, used, left: r2(earned - used) };
}

// Days a leave takes: working days (weekly offs and holidays inside are not leave; the register applies the sandwich
// rule to them), every calendar day for maternity, none for a short leave.
export function leaveDays(emp, type, from, to, half) {
  if (type === 'Short leave (up to 1½ h)') return 0;
  if (type === 'Maternity') return Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const hol = holidaysIn(from, to);
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isOffDay(emp, d, hol)) n++;
  return half === 'Yes' && n ? 0.5 : n;
}

// What the policy says about a leave request: its days, the balance line, and anything that is not allowed.
export function checkLeave(lv, exceptId) {
  const emp = getRow('employees', lv.employee_id);
  const P = policy(), from = lv.from_date, to = lv.to_date || lv.from_date;
  const days = leaveDays(emp, lv.type, from, to, lv.half_day);
  const fy = leaveYear(from), yrs = serviceYears(emp, from), confirmed = emp.employment_type === 'Confirmed';
  const problems = [];
  let note = '';
  const need = (ok, msg) => { if (!ok) problems.push(msg); };
  const special = (max, gender) => {
    need(confirmed, `${lv.type} leave is for confirmed employees`);
    need(yrs >= P.serviceYears, `${lv.type} leave needs ${P.serviceYears} years of service (${emp.name}: ${yrs.toFixed(1)})`);
    if (gender) need(emp.gender === gender, `${lv.type} leave is for ${gender.toLowerCase()} employees (set the gender on the employee)`);
    need(days <= max, `${lv.type} leave is up to ${max} days (asked ${days})`);
  };
  if (lv.type !== 'Short leave (up to 1½ h)' && lv.type !== 'Maternity' && !days) problems.push('Those dates are weekly offs / holidays');
  switch (lv.type) {
    case 'Privilege Leave (PL)': {
      if (!confirmed) { problems.push(`PL starts after confirmation (${emp.name} is ${emp.employment_type || 'not marked confirmed'}): take comp-off or leave without pay`); break; }
      const credit = plCredit(emp, from), used = taken(emp.id, lv.type, fy.from, fy.to, exceptId).d, avail = r2(credit - used);
      need(days <= avail, `PL balance is ${avail} day(s) (credited ${credit} up to this quarter, ${used} taken or asked); next quarter's PL cannot be taken now`);
      note = `PL ${avail} available → ${r2(avail - days)} after`;
      break;
    }
    case 'Comp-off': {
      need(from.slice(0, 7) === to.slice(0, 7), 'Comp-off is taken within one month');
      const c = compOff(emp.id, from.slice(0, 7), exceptId);
      need(days <= c.left, `Comp-off is taken in the same month as the off day worked (HR-approved): ${c.left} available in ${from.slice(0, 7)}`);
      note = `Comp-off ${c.left} available in ${from.slice(0, 7)}`;
      break;
    }
    case 'Short leave (up to 1½ h)': {
      need(from === to, 'A short leave is for one day');
      const n = taken(emp.id, lv.type, `${from.slice(0, 7)}-01`, `${from.slice(0, 7)}-31`, exceptId).n;
      need(n < P.shortLeaves, `Only ${P.shortLeaves} short leaves a month (${n} already this month)`);
      note = `Short leave ${n + 1} of ${P.shortLeaves} this month: covers up to 1½ h late / early`;
      break;
    }
    case 'Leave without pay': {
      const used = taken(emp.id, lv.type, fy.from, fy.to, exceptId).d;
      need(used + days <= P.lwpMax, `Leave without pay is up to ${P.lwpMax} days a year (${used} taken or asked)`);
      note = `LWP ${r2(used + days)} of ${P.lwpMax} this year`;
      break;
    }
    case 'Maternity':
      special(112, 'Female');
      need(taken(emp.id, lv.type, '1900-01-01', '2999-12-31', exceptId, "status = 'Approved'").n < 2, 'Maternity leave is for up to 2 confinements');
      break;
    case 'Paternity':
      special(4, 'Male');
      need(taken(emp.id, lv.type, '1900-01-01', '2999-12-31', exceptId, "status = 'Approved'").n < 2, 'Paternity leave is for up to 2 confinements');
      break;
    case 'Adoption':
      special(4);
      need(Date.parse(from) - Date.parse(today()) >= 7 * 864e5 || !!exceptId, 'Adoption leave is applied at least 1 week before');
      break;
    case 'Marriage':
      special(10);
      need(emp.married_at_joining !== 'Yes', 'Marriage leave is for those unmarried at joining');
      need(!taken(emp.id, lv.type, '1900-01-01', '2999-12-31', exceptId).n, 'Marriage leave is once in service');
      break;
  }
  return { days, note, problems };
}

// Before a leave request is saved: days and balance, and the policy (HR may allow an exception with a reason).
export function prepLeave(row, existing, user) {
  const lv = { ...(existing || {}), ...row };
  if (!lv.employee_id || !lv.from_date) return;
  if (!lv.to_date) row.to_date = lv.to_date = lv.from_date;
  if (lv.to_date < lv.from_date) throw new HttpError(400, '“To” is before “From”');
  if (['Cancelled', 'Rejected'].includes(lv.status)) return;
  if (!['employee_id', 'type', 'from_date', 'to_date', 'half_day', 'hr_exception'].some(k => k in row)) return;
  const c = checkLeave(lv, existing?.id);
  row.days = c.days;
  row.balance_note = c.note || null;
  if (c.problems.length) {
    const hr = user && hasFunction(user.role, 'hr_manage');
    if (!(hr && String(lv.hr_exception || '').trim())) throw new HttpError(400, `${c.problems.join('. ')}.${hr ? ' To allow it anyway, write the reason under HR Exception.' : ' Ask HR if this is an exception.'}`);
    row.balance_note = `${c.note ? c.note + ' · ' : ''}HR exception: ${c.problems.join('; ')}`;
  }
}

// Every employee's leave position on a date (balances page, and the phone for one person).
export function balances(asOf = today(), empId = null) {
  const P = policy(), fy = leaveYear(asOf), m = asOf.slice(0, 7);
  const emps = db.prepare(`SELECT * FROM employees WHERE COALESCE(status, 'Active') = 'Active' ${empId ? 'AND id = ?' : ''} ORDER BY name`).all(...(empId ? [empId] : []));
  return { as_of: asOf, year: fy, policy: P, rows: emps.map(e => {
    const credit = plCredit(e, asOf);
    const plTaken = taken(e.id, 'Privilege Leave (PL)', fy.from, fy.to, 0, "status = 'Approved'").d, plPending = taken(e.id, 'Privilege Leave (PL)', fy.from, fy.to, 0, "status = 'Pending Approval'").d;
    const c = compOff(e.id, m);
    const late = db.prepare("SELECT COUNT(*) n FROM attendance WHERE employee_id = ? AND substr(date, 1, 7) = ? AND timing = 'Late mark'").get(e.id, m).n;
    return { employee_id: e.id, code: e.emp_code, name: e.name, department: e.department, employment_type: e.employment_type || '', confirmation_date: e.confirmation_date, joining_date: e.joining_date,
      service_years: Math.round(serviceYears(e, asOf) * 10) / 10, pl_credit: credit, pl_taken: plTaken, pl_pending: plPending, pl_available: r2(credit - plTaken - plPending),
      pl_year_end: e.employment_type === 'Confirmed' ? r2(plCredit(e, fy.to) - plTaken - plPending) : 0,
      comp_off_earned: c.earned, comp_off_taken: c.used, comp_off_left: c.left,
      lwp: taken(e.id, 'Leave without pay', fy.from, fy.to, 0).d, lwp_max: P.lwpMax,
      short_leaves: taken(e.id, 'Short leave (up to 1½ h)', `${m}-01`, `${m}-31`, 0).n, short_max: P.shortLeaves,
      late_marks: late, late_free: P.lateFree };
  }) };
}

// ---------------------------------------------------------------- month register
// One code a day: P present · P* late mark (free) · H* late mark beyond the free ones (half day) · H half day ·
// A absent · L paid leave · HL half-day leave · CO comp-off · OD on duty · LWP leave without pay · HO holiday ·
// WO weekly off · W worked on an off day (comp-off earned) · S weekly off / holiday between absences or leave (unpaid).
const PAY = { P: 1, 'P*': 1, 'H*': 0.5, H: 0.5, A: 0, L: 1, HL: 0.5, CO: 1, OD: 1, LWP: 0, HO: 1, WO: 1, W: 1, S: 0, '': 0 };
const SANDWICH = new Set(['A', 'L', 'LWP']);

export function monthRegister(ym) {
  const month = /^\d{4}-\d{2}$/.test(ym || '') ? ym : today().slice(0, 7);
  const first = `${month}-01`, last = addDays(monthStart(first, 1), -1), from = addDays(first, -10), to = addDays(last, 10);
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const hol = holidaysIn(from, to), t = today(), P = policy();
  const emps = db.prepare("SELECT id, emp_code, name, department, weekly_off, joining_date, leaving_date FROM employees WHERE COALESCE(status, 'Active') = 'Active' OR leaving_date >= ? ORDER BY name").all(first);
  const rows = emps.map(e => {
    const att = new Map(db.prepare('SELECT date, status, review, check_in, timing FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?').all(e.id, from, to).map(a => [a.date, a]));
    const leaves = db.prepare("SELECT type, from_date, to_date, half_day FROM leave_requests WHERE employee_id = ? AND status = 'Approved' AND from_date <= ? AND to_date >= ?").all(e.id, to, from);
    const code = d => {
      const a = att.get(d), off = hol.has(d) || isWeeklyOff(e, d);
      const lv = leaves.find(l => l.from_date <= d && l.to_date >= d && l.type !== 'Short leave (up to 1½ h)' && (!off || l.type === 'Maternity'));
      const q = a?.review === 'To review' ? '?' : '';
      if (a?.check_in) {
        if (a.timing === 'Worked on off day (comp-off)') return 'W' + q;
        if (a.status === 'Half Day') return 'H' + q;
        if (a.status === 'Absent') return 'A' + q;
        return (a.timing === 'Late mark' ? 'P*' : 'P') + q;
      }
      if (lv) return UNPAID_LEAVE.includes(lv.type) ? 'LWP' : lv.type === 'Comp-off' ? 'CO' : lv.type === 'On duty (outside)' ? 'OD' : lv.half_day === 'Yes' ? 'HL' : 'L';
      if (hol.has(d)) return 'HO';
      if (isWeeklyOff(e, d)) return 'WO';
      if (d > t || (e.joining_date && d < e.joining_date) || (e.leaving_date && d > e.leaving_date)) return '';
      return 'A';
    };
    const wide = new Map();
    for (let d = from; d <= to; d = addDays(d, 1)) wide.set(d, code(d));
    const bare = c => c.replace('?', '');
    // Sandwich: an off day whose nearest working days before and after are both absent / on leave is unpaid.
    const near = (d, step) => { for (let x = addDays(d, step), i = 0; i < 10; x = addDays(x, step), i++) { const c = bare(wide.get(x) ?? ''); if (!['HO', 'WO'].includes(c)) return c; } return ''; };
    const codes = days.map(d => {
      const c = wide.get(d);
      return ['HO', 'WO'].includes(c) && SANDWICH.has(near(d, -1)) && SANDWICH.has(near(d, 1)) ? 'S' : c;
    });
    // Late marks: the first few a month are free, each one after that is half a day.
    let late = 0;
    for (let i = 0; i < codes.length; i++) if (bare(codes[i]) === 'P*' && ++late > P.lateFree) codes[i] = codes[i].replace('P*', 'H*');
    const n = k => codes.filter(x => bare(x) === k).length;
    const worked = n('W'), co = n('CO');
    return { employee_id: e.id, code: e.emp_code, name: e.name, department: e.department, codes,
      present: n('P') + n('P*'), late_marks: late, late_half: n('H*'), half: n('H') + n('H*'), absent: n('A'), leave: n('L') + n('HL') / 2 + n('CO') + n('OD'), lwp: n('LWP'), sandwich: n('S'),
      off_worked: worked, comp_off_taken: co, pay_extra: Math.max(0, worked - co),
      paid_days: r2(codes.reduce((s, c) => s + (PAY[bare(c)] ?? 0), 0)), to_review: codes.filter(x => x.endsWith('?')).length };
  });
  return { month, days, holidays: Object.fromEntries([...hol].filter(([d]) => d >= first && d <= last)), rows, late_free: P.lateFree };
}

// ---------------------------------------------------------------- alerts and setup
// Someone who uses attendance and stays away on working days without leave: HR and the reporting manager are told on
// the 2nd day (first warning letter) and the 7th (the policy treats it as leaving); once per absence.
export function absenceAlerts() {
  const t = today();
  const s = getSettings();
  let sent = {};
  try { sent = JSON.parse(s.hr_absence_alerts || '{}') || {}; } catch { sent = {}; }
  const hol = holidaysIn(addDays(t, -40), t);
  let changed = false;
  for (const e of db.prepare("SELECT id, name, emp_code, reporting_to, weekly_off FROM employees WHERE COALESCE(status, 'Active') = 'Active'").all()) {
    if (!db.prepare('SELECT 1 FROM attendance WHERE employee_id = ? AND check_in IS NOT NULL AND date >= ?').get(e.id, addDays(t, -30))) continue;
    let n = 0, start = null;
    for (let d = addDays(t, -1), i = 0; i < 30; d = addDays(d, -1), i++) {
      if (isOffDay(e, d, hol)) continue;
      const a = db.prepare('SELECT check_in, status FROM attendance WHERE employee_id = ? AND date = ?').get(e.id, d);
      const lv = db.prepare("SELECT 1 FROM leave_requests WHERE employee_id = ? AND status IN ('Approved', 'Pending Approval') AND from_date <= ? AND to_date >= ? AND type <> 'Short leave (up to 1½ h)'").get(e.id, d, d);
      if (a?.check_in || a?.status === 'On Leave' || lv) break;
      n++; start = d;
    }
    const level = n >= 7 ? 7 : n >= 2 ? 2 : 0;
    const key = level ? `${start}:${level}` : null;
    if (!level || sent[e.id] === key) continue;
    notify({ fn: 'hr_manage', userNames: e.reporting_to ? [e.reporting_to] : [], kind: 'attendance',
      title: level === 7 ? `⛔ ${e.name}: ${n} working days absent without leave` : `⚠ ${e.name}: absent ${n} working days without leave`,
      body: level === 7 ? `Since ${start}. HR Policy: 7 days away without information is treated as leaving – HR to act (final letter).` : `Since ${start}. HR Policy: issue the first warning letter; no reply in 2 days leads to the final letter.`,
      link: '#/hr/month' }, { name: 'Attendance' });
    sent[e.id] = key; changed = true;
  }
  if (changed) db.prepare("INSERT INTO settings (key, value) VALUES ('hr_absence_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(JSON.stringify(sent)));
}

const HOLIDAYS_2026 = [['2026-01-26', 'Republic Day'], ['2026-03-19', 'Gudhi Padwa'], ['2026-05-01', 'Maharashtra Day'], ['2026-08-15', 'Independence Day'], ['2026-09-14', 'Ganesh Chaturthi'],
  ['2026-10-20', 'Dussehra'], ['2026-11-07', 'Diwali'], ['2026-11-08', 'Diwali'], ['2026-11-09', 'Diwali'], ['2026-11-10', 'Diwali'], ['2026-11-11', 'Diwali']];

// Once: the 2026 holiday list of the HR Policy, and the policy timings (9:00–18:00) for employees still on the old default.
export function setupHrPolicy() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'hr_policy_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM holidays WHERE date BETWEEN '2026-01-01' AND '2026-12-31'").get()) {
    const ins = db.prepare("INSERT INTO holidays (date, name, optional) VALUES (?, ?, 'No')");
    for (const [d, n] of HOLIDAYS_2026) ins.run(d, n);
  }
  db.prepare("UPDATE employees SET shift_start = '09:00' WHERE shift_start = '09:30' AND COALESCE(shift_end, '18:00') = '18:00'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('hr_policy_v1', '\"1\"')").run();
}
