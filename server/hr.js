// Geofenced attendance and HR. The phone sends its GPS position (and a selfie) at clock-in, at presence checks during
// the day and at clock-out; the server measures the distance to the work location (Haversine), decides inside / outside
// the fence and flags what HR should look at: late, outside the fence, too few checks, impossible jumps, a changed network,
// a fake-GPS app (reported by the Android app), no clock-out. Leave requests go through approval and mark the days On Leave.
import { db, tx, audit, getSettings } from './db.js';
import { getRow, insertRow, updateRow, listRows, HttpError } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { saveAttachment } from './roles.js';
import { submitForApproval } from './workflows.js';
import { notify } from './notify.js';

const now = () => new Date().toLocaleString('sv-SE').slice(0, 19);       // local 'YYYY-MM-DD HH:MM:SS'
const today = () => now().slice(0, 10);
const hhmm = s => String(s || '').slice(11, 16);
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
const mins = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };

export function rules() {
  const s = getSettings();
  const n = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  return { fullDay: n(s.hr_full_day_hours, 8), halfDay: n(s.hr_half_day_hours, 4), grace: n(s.hr_grace_minutes, 15), checkEvery: n(s.hr_check_every_hours, 3),
    maxAccuracy: n(s.hr_max_accuracy_m, 150), pingMinutes: n(s.hr_auto_ping_minutes, 30) };
}

// Distance in metres between two points on the earth (Haversine).
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => (Number(x) * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "lat, lng" or a Google Maps link (…@18.62,73.74,17z / …?q=18.62,73.74 / !3d18.62!4d73.74) → [lat, lng]
export function parseLatLng(text) {
  const s = String(text || '');
  const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

export function employeeOf(user) {
  const e = db.prepare("SELECT id FROM employees WHERE lower(trim(login)) = lower(?) AND COALESCE(status, 'Active') = 'Active'").get(user.username || '');
  if (!e) throw new HttpError(404, `Your login “${user.username}” is not linked to an employee. Ask HR to enter it as the CRM login on your employee record.`);
  return getRow('employees', e.id);
}

// Where this employee may clock in on a date: the sites assigned to them, their usual location, and every office / works.
export function allowedSites(emp, date) {
  const ids = new Set(db.prepare("SELECT location_id FROM site_assignments WHERE employee_id = ? AND from_date <= ? AND (to_date IS NULL OR to_date = '' OR to_date >= ?)").all(emp.id, date, date).map(r => r.location_id));
  if (emp.default_location_id) ids.add(emp.default_location_id);
  for (const r of db.prepare("SELECT id FROM work_locations WHERE kind IN ('Office', 'Factory / works') AND COALESCE(active, 'Yes') = 'Yes'").all()) ids.add(r.id);
  return [...ids].map(id => db.prepare("SELECT id, name, kind, lat, lng, radius_m FROM work_locations WHERE id = ? AND COALESCE(active, 'Yes') = 'Yes'").get(id)).filter(l => l && l.lat != null && l.lng != null);
}

// Inside = the distance, less the GPS uncertainty (up to 100 m), is within the radius.
function fence(loc, p) {
  const d = Math.round(haversine(p.lat, p.lng, loc.lat, loc.lng));
  const radius = Number(loc.radius_m) || 200;
  return { distance: d, inside: d - Math.min(Number(p.accuracy) || 0, 100) <= radius, radius };
}
function nearest(sites, p) {
  return sites.map(l => ({ loc: l, ...fence(l, p) })).sort((a, b) => a.distance - b.distance)[0] || null;
}

function position(body) {
  const lat = Number(body?.lat), lng = Number(body?.lng), accuracy = Number(body?.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) throw new HttpError(400, 'No GPS position: allow location for this site in the phone, switch on GPS and try again');
  const max = rules().maxAccuracy;
  if (Number.isFinite(accuracy) && accuracy > max) throw new HttpError(400, `GPS is too rough (±${Math.round(accuracy)} m, needs ±${max} m or better): step outside or near a window, wait a few seconds and try again`);
  // mock: the Android app saw Location.isMock() (a fake-GPS app is feeding the position)
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, mock: body.mock === true };
}
const MOCK = 'fake GPS app detected';

// Signs of a faked position: an impossibly perfect fix, a jump faster than a vehicle, the network changing mid-day.
function spoofFlags(p, prev, ip, inIp) {
  const f = [];
  if (p.mock) f.push(MOCK);
  if (p.accuracy != null && p.accuracy < 2) f.push('GPS accuracy suspiciously perfect');
  if (prev) {
    const km = haversine(prev.lat, prev.lng, p.lat, p.lng) / 1000;
    const h = Math.max((Date.parse(now().replace(' ', 'T')) - Date.parse(String(prev.at).replace(' ', 'T'))) / 3600e3, 1 / 60);
    if (km > 2 && km / h > 120) f.push(`moved ${km.toFixed(1)} km in ${Math.round(h * 60)} min`);
  }
  const net = s => String(s || '').split('.').slice(0, 2).join('.');
  if (ip && inIp && net(ip) !== net(inIp)) f.push('network changed since clock-in');
  return f;
}

function savePhoto(attId, kind, dataUrl, user) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw new HttpError(400, 'The photo could not be read: take it again');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2.5e6) throw new HttpError(400, 'The photo is too large');
  return saveAttachment('attendance', attId, { filename: `${kind.toLowerCase().replace(/\s+/g, '-')}-${now().slice(11, 16).replace(':', '')}.jpg`, mime: m[1], note: `${kind} photo` }, buf, user).id;
}

function addPing(att, emp, kind, p, f, ip, photoId, extraFlags = []) {
  const prev = db.prepare('SELECT lat, lng, at FROM attendance_pings WHERE attendance_id = ? ORDER BY id DESC LIMIT 1').get(att.id);
  const flags = [...extraFlags, ...spoofFlags(p, prev, ip, att.in_ip), ...(f && !f.inside ? [`outside the fence (${f.distance} m)`] : [])];
  // A faked position goes to HR at once (the first time in the day), not only when the day is closed.
  if (p.mock && !String(att.flags || '').includes(MOCK)) notify({ fn: 'hr_manage', kind: 'attendance', title: `Fake GPS app detected: ${emp.name}`, body: `${kind} at ${now().slice(11, 16)} · the day is sent to HR review`, link: `#/view/attendance/${att.id}` }, { name: emp.name });
  insertRow('attendance_pings', { attendance_id: att.id, employee_id: emp.id, at: now(), kind, lat: p.lat, lng: p.lng, accuracy_m: p.accuracy, distance_m: f ? f.distance : null,
    inside: f ? (f.inside ? 'Yes' : 'No') : null, ip: ip || null, photo_id: photoId, flags: flags.join('; ') || null }, { name: emp.name }, { system: true });
  return flags;
}

function counts(attId) {
  return db.prepare("SELECT COUNT(*) checks, SUM(inside = 'Yes') inside_n, SUM(kind = 'Photo check') photos, MAX(at) last FROM attendance_pings WHERE attendance_id = ?").get(attId);
}

const isWeeklyOff = (emp, date) => {
  const wd = new Date(date + 'T00:00:00').getDay(); // 0 Sunday
  const off = emp.weekly_off || 'Sunday';
  return (off.includes('Sunday') && wd === 0) || (off.includes('Saturday') && wd === 6);
};

// Hours, status and flags of a day (also for a day that ended without a clock-out).
export function evaluate(attId) {
  const a = getRow('attendance', attId);
  if (['On Leave', 'Holiday', 'Week Off'].includes(a.status) && !a.check_in) return a;
  const emp = getRow('employees', a.employee_id);
  const R = rules();
  const flags = new Set(String(a.flags || '').split('\n').filter(Boolean).filter(x => !/^(late|left early|few presence checks|no clock-out|short day)/.test(x)));
  const pings = db.prepare('SELECT kind, at, inside, flags FROM attendance_pings WHERE attendance_id = ? ORDER BY id').all(a.id);
  for (const p of pings) if (p.flags) for (const x of p.flags.split('; ')) flags.add(x);
  let hours = 0;
  if (a.check_in) {
    const end = a.check_out || (a.date < today() ? (pings.at(-1)?.at || null) : now());
    hours = end ? r1((Date.parse(String(end).replace(' ', 'T')) - Date.parse(String(a.check_in).replace(' ', 'T'))) / 3600e3) : 0;
    if (mins(hhmm(a.check_in)) > mins(emp.shift_start || '09:30') + R.grace) flags.add(`late (in at ${hhmm(a.check_in)})`);
    if (a.check_out && mins(hhmm(a.check_out)) < mins(emp.shift_end || '18:00') - R.grace) flags.add(`left early (out at ${hhmm(a.check_out)})`);
    if (!a.check_out && a.date < today()) flags.add('no clock-out');
    if (emp.field_staff === 'Yes' && hours >= R.checkEvery) {
      const need = Math.floor(hours / R.checkEvery), got = pings.filter(p => p.kind === 'Photo check').length;
      if (got < need) flags.add(`few presence checks (${got} of ${need} photo checks)`);
    }
  }
  const working = a.check_in && !a.check_out && a.date === today();
  // Less than a half day counts as absent; the flag sends it to HR, who can correct it.
  const status = working ? 'Working' : hours >= R.fullDay ? 'Present' : hours >= R.halfDay ? 'Half Day' : 'Absent';
  if (a.check_in && hours < R.halfDay && !working) flags.add(`short day (${hours} h)`);
  // Minutes away: from each check outside the fence to the next check (or the end of the day).
  let away = 0;
  const end = a.check_out || (a.date < today() ? pings.at(-1)?.at : now());
  pings.forEach((p, i) => {
    if (p.inside !== 'No') return;
    const to = pings[i + 1]?.at || end;
    if (to) away += Math.max(0, (Date.parse(String(to).replace(' ', 'T')) - Date.parse(String(p.at).replace(' ', 'T'))) / 60e3);
  });
  away = Math.round(away);
  for (const x of [...flags]) if (/^away from the site/.test(x)) flags.delete(x);
  if (away >= 15) flags.add(`away from the site about ${away} min`);
  const c = counts(a.id);
  const list = [...flags];
  const review = a.review === 'Approved' || a.review === 'Rejected' ? a.review : list.includes(MOCK) || ((list.length || a.mode === 'Travel / outstation') && !working) ? 'To review' : '';
  return updateRow('attendance', a.id, { hours, status, flags: list.join('\n') || null, review, away_minutes: away || null, checks: c.checks || 0, checks_inside: c.inside_n || 0, photo_checks: c.photos || 0, last_check: c.last ? hhmm(c.last) : null }, { name: 'system' }, { system: true });
}

// ---------------------------------------------------------------- the phone
export function clockIn(user, body = {}, ip) {
  const emp = employeeOf(user);
  const t = today();
  const existing = db.prepare('SELECT id, check_in, status FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, t);
  if (existing?.check_in) throw new HttpError(409, `You clocked in already today at ${hhmm(existing.check_in)}`);
  const p = position(body);
  const travel = body.mode === 'Travel / outstation';
  let f = null;
  if (!travel) {
    const sites = allowedSites(emp, t);
    if (!sites.length) throw new HttpError(409, 'No work location is set for you today: ask HR / the service coordinator to assign your site (or choose Travel / outstation with a note)');
    f = nearest(sites, p);
    if (!f.inside) throw new HttpError(409, `You are ${f.distance >= 1000 ? (f.distance / 1000).toFixed(1) + ' km' : f.distance + ' m'} from ${f.loc.name} (allowed ${f.radius} m). Clock in at the site, or choose Travel / outstation with a note.`);
  } else if (!String(body.note || '').trim()) throw new HttpError(400, 'Write where you are going / why (travel or outstation work)');
  if (emp.field_staff === 'Yes' && !body.photo) throw new HttpError(400, 'Take a selfie to clock in');
  return tx(() => {
    const att = existing ? getRow('attendance', existing.id) : insertRow('attendance', { date: t, employee_id: emp.id }, user, { system: true });
    updateRow('attendance', att.id, { check_in: now(), location_id: f?.loc.id || null, mode: travel ? 'Travel / outstation' : 'Site / office', in_distance_m: f?.distance ?? null, in_ip: ip || null,
      note: String(body.note || '').trim() || null, status: 'Working', review: '' }, user, { system: true });
    const photoId = savePhoto(att.id, 'Clock in', body.photo, user);
    addPing(getRow('attendance', att.id), emp, 'In', p, f, ip, photoId);
    audit(user.name, 'attendance', att.id, 'clock in', f ? `${f.loc.name} ${f.distance} m` : 'travel');
    return { attendance: forPhone(evaluate(att.id)), site: f?.loc.name || null };
  });
}

function openDay(emp) {
  const a = db.prepare("SELECT id FROM attendance WHERE employee_id = ? AND date = ? AND check_in IS NOT NULL AND check_out IS NULL").get(emp.id, today());
  if (!a) throw new HttpError(409, 'You have not clocked in today');
  return getRow('attendance', a.id);
}
const siteOf = att => (att.location_id ? db.prepare('SELECT id, name, lat, lng, radius_m FROM work_locations WHERE id = ?').get(att.location_id) : null);

// A presence check: automatic (every few minutes while the page is open, every 30 min from the Android app even when the
// phone is locked, and at once when the app sees the phone leave the site radius) or with a photo (every few hours).
export function check(user, body = {}, ip) {
  const emp = employeeOf(user);
  const att = openDay(emp);
  const p = position(body);
  const loc = siteOf(att);
  const f = loc ? fence(loc, p) : null;
  const kind = body.photo ? 'Photo check' : body.reason === 'geofence-exit' ? 'Geofence exit' : 'Auto';
  return tx(() => {
    const prev = db.prepare('SELECT inside FROM attendance_pings WHERE attendance_id = ? ORDER BY id DESC LIMIT 1').get(att.id);
    const photoId = savePhoto(att.id, 'Presence check', body.photo, user);
    addPing(att, emp, kind, p, f, ip, photoId);
    evaluate(att.id);
    if (f) awayAlert(getRow('attendance', att.id), emp, loc, f, prev?.inside === 'No', user);
    // The phone is told only that the check was recorded: whether it was inside the site is for HR.
    return { recorded: true, at: now().slice(11, 16) };
  });
}

// Someone left the site: alert HR and their reporting manager once they are clearly away (two checks outside in a
// row, or more than 1 km), at most once an hour; tell them again when the person is back at the site.
function awayAlert(att, emp, loc, f, prevOutside, user) {
  const link = `#/view/attendance/${att.id}`;
  const to = { fn: 'hr_manage', userNames: emp.reporting_to ? [emp.reporting_to] : [] };
  const d = f.distance >= 1000 ? `${(f.distance / 1000).toFixed(1)} km` : `${f.distance} m`;
  if (!f.inside) {
    const clear = prevOutside || f.distance > 1000;
    const recent = att.alert_at && Date.parse(now().replace(' ', 'T')) - Date.parse(String(att.alert_at).replace(' ', 'T')) < 60 * 60e3;
    if (!clear || recent) return;
    notify({ ...to, kind: 'attendance', title: `⚠ ${emp.name} is away from ${loc.name} (${d})`, body: `${att.away_since ? 'since ' + hhmm(att.away_since) + ' · ' : ''}checked at ${now().slice(11, 16)}`, link }, { name: 'Attendance' });
    updateRow('attendance', att.id, { alert_at: now(), away_since: att.away_since || now() }, user, { system: true });
  } else if (att.away_since) {
    const mins = Math.round((Date.parse(now().replace(' ', 'T')) - Date.parse(String(att.away_since).replace(' ', 'T'))) / 60e3);
    notify({ ...to, kind: 'attendance', title: `${emp.name} is back at ${loc.name}`, body: `away about ${mins} min`, link }, { name: 'Attendance' });
    updateRow('attendance', att.id, { away_since: null }, user, { system: true });
  }
}

export function clockOut(user, body = {}, ip) {
  const emp = employeeOf(user);
  const att = openDay(emp);
  const p = position(body);
  if (emp.field_staff === 'Yes' && !body.photo) throw new HttpError(400, 'Take a selfie to clock out');
  const loc = siteOf(att);
  const f = loc ? fence(loc, p) : null;
  return tx(() => {
    const photoId = savePhoto(att.id, 'Clock out', body.photo, user);
    addPing(att, emp, 'Out', p, f, ip, photoId, f && !f.inside ? ['clocked out outside the site'] : []);
    updateRow('attendance', att.id, { check_out: now(), out_distance_m: f?.distance ?? null }, user, { system: true });
    audit(user.name, 'attendance', att.id, 'clock out', f ? `${f.distance} m` : '');
    return { attendance: forPhone(evaluate(att.id)) };
  });
}

// The employee's own copy of a day: no distances, site-check results or HR notes.
const HR_ONLY = ['flags', 'in_distance_m', 'out_distance_m', 'checks_inside', 'away_minutes', 'away_since', 'alert_at', 'in_ip', 'remarks'];
const forPhone = att => att && Object.fromEntries(Object.entries(att).filter(([k]) => !HR_ONLY.includes(k)));

// What the phone shows: today, where the person may clock in, their month, their leave.
export function myDay(user) {
  const emp = employeeOf(user);
  const t = today();
  const row = db.prepare('SELECT id FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, t);
  const att = row ? getRow('attendance', row.id) : null;
  const month = db.prepare("SELECT date, status, check_in, check_out, hours, review FROM attendance WHERE employee_id = ? AND date >= ? ORDER BY date DESC").all(emp.id, t.slice(0, 8) + '01');
  const leaves = db.prepare('SELECT id, leave_no, type, from_date, to_date, days, status FROM leave_requests WHERE employee_id = ? ORDER BY id DESC LIMIT 10').all(emp.id);
  return { employee: { id: emp.id, name: emp.name, code: emp.emp_code, field_staff: emp.field_staff, shift_start: emp.shift_start, shift_end: emp.shift_end },
    today: t, attendance: forPhone(att), sites: allowedSites(emp, t).map(l => ({ id: l.id, name: l.name, kind: l.kind, lat: l.lat, lng: l.lng, radius_m: l.radius_m })),
    rules: rules(), month, leaves, holiday: db.prepare('SELECT name FROM holidays WHERE date = ?').get(t)?.name || null, weekly_off: isWeeklyOff(emp, t) };
}

// ---------------------------------------------------------------- leave
const leaveDays = (from, to, half) => (half === 'Yes' ? 0.5 : Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1));
export function prepLeave(row, existing) {
  const from = row.from_date ?? existing?.from_date, to = row.to_date ?? existing?.to_date;
  if (from && to && to < from) throw Object.assign(new Error('“To” is before “From”'), { status: 400 });
  if (from && to) row.days = leaveDays(from, to, row.half_day ?? existing?.half_day);
}
export function applyLeave(user, body = {}) {
  const emp = employeeOf(user);
  if (!body.from_date || !String(body.reason || '').trim()) throw new HttpError(400, 'Enter the dates and the reason');
  return tx(() => {
    const lv = insertRow('leave_requests', { employee_id: emp.id, type: body.type || 'Casual', from_date: body.from_date, to_date: body.to_date || body.from_date, half_day: body.half_day === 'Yes' ? 'Yes' : 'No', reason: body.reason, status: 'Draft' }, user, { system: true });
    submitForApproval('Leave', lv.id, user);
    return getRow('leave_requests', lv.id);
  });
}
// Approved leave marks its days On Leave (a day already worked keeps its attendance).
export function markLeave(leaveId, user) {
  const lv = getRow('leave_requests', leaveId);
  if (lv.status !== 'Approved') return;
  for (let d = lv.from_date; d <= lv.to_date; d = addDays(d, 1)) {
    const a = db.prepare('SELECT id, check_in FROM attendance WHERE employee_id = ? AND date = ?').get(lv.employee_id, d);
    if (a?.check_in) continue;
    const note = `${lv.type} leave ${lv.leave_no}${lv.half_day === 'Yes' ? ' (half day)' : ''}`;
    if (a) updateRow('attendance', a.id, { status: 'On Leave', note, review: '' }, user, { system: true });
    else insertRow('attendance', { date: d, employee_id: lv.employee_id, status: 'On Leave', note }, user, { system: true });
  }
}

// ---------------------------------------------------------------- HR
export function review(attId, body = {}, user) {
  if (!hasFunction(user.role, 'hr_manage')) throw new HttpError(403, 'Only HR reviews attendance');
  const decision = body.decision;
  if (!['Approved', 'Rejected'].includes(decision)) throw new HttpError(400, 'Approve or reject');
  const patch = { review: decision, reviewed_by: `${user.name} (${now().slice(0, 16)})`, remarks: body.remarks || null };
  if (body.status) patch.status = body.status; // HR may correct the day (e.g. Present after a phone problem)
  const out = updateRow('attendance', attId, patch, user, { system: true });
  audit(user.name, 'attendance', Number(attId), `review ${decision}`, body.remarks || '');
  return out;
}

// Days left open (no clock-out) are closed at night and flagged.
export function closeOpenDays() {
  for (const r of db.prepare("SELECT id FROM attendance WHERE check_in IS NOT NULL AND check_out IS NULL AND date < ?").all(today())) evaluate(r.id);
}

export function pingsOf(attId) {
  return db.prepare('SELECT at, kind, lat, lng, accuracy_m, distance_m, inside, ip, photo_id, flags FROM attendance_pings WHERE attendance_id = ? ORDER BY id').all(Number(attId));
}

// Today across the company: who is working where, who has not come, exceptions.
export function todayBoard(date = today()) {
  const emps = db.prepare("SELECT id, emp_code, name, department, field_staff, weekly_off FROM employees WHERE COALESCE(status, 'Active') = 'Active' ORDER BY name").all();
  const holiday = db.prepare('SELECT name FROM holidays WHERE date = ?').get(date)?.name || null;
  const rows = emps.map(e => {
    const a = db.prepare('SELECT a.*, l.name site, l.lat slat, l.lng slng FROM attendance a LEFT JOIN work_locations l ON l.id = a.location_id WHERE a.employee_id = ? AND a.date = ?').get(e.id, date);
    const last = a ? db.prepare('SELECT at, lat, lng, distance_m, inside FROM attendance_pings WHERE attendance_id = ? ORDER BY id DESC LIMIT 1').get(a.id) : null;
    const state = a?.check_in ? (a.check_out ? 'Clocked out' : 'Working') : a?.status === 'On Leave' ? 'On leave' : holiday ? 'Holiday' : isWeeklyOff(e, date) ? 'Week off' : 'Not in';
    return { employee_id: e.id, code: e.emp_code, name: e.name, department: e.department, field: e.field_staff === 'Yes', state, attendance_id: a?.id || null, site: a?.site || (a?.mode === 'Travel / outstation' ? 'Travel / outstation' : null),
      check_in: hhmm(a?.check_in), check_out: hhmm(a?.check_out), hours: a?.hours || 0, last_at: hhmm(last?.at), last_inside: last?.inside || null, last_distance: last?.distance_m ?? null,
      last_lat: last?.lat ?? null, last_lng: last?.lng ?? null, flags: a?.flags || '', review: a?.review || '' };
  });
  const n = s => rows.filter(r => r.state === s).length;
  return { date, holiday, rows, totals: { employees: rows.length, working: n('Working'), out: n('Clocked out'), not_in: n('Not in'), leave: n('On leave'), outside: rows.filter(r => r.state === 'Working' && r.last_inside === 'No').length,
    to_review: db.prepare("SELECT COUNT(*) n FROM attendance WHERE review = 'To review'").get().n } };
}

// Month register: one code per employee per day, with totals (P present, H half day, A absent, L leave, HO holiday, WO week off).
export function monthRegister(ym) {
  const month = /^\d{4}-\d{2}$/.test(ym || '') ? ym : today().slice(0, 7);
  const first = `${month}-01`, days = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
  const hol = new Map(db.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?').all(first, days.at(-1)).map(h => [h.date, h.name]));
  const emps = db.prepare("SELECT id, emp_code, name, department, weekly_off, joining_date, leaving_date FROM employees WHERE COALESCE(status, 'Active') = 'Active' OR leaving_date >= ? ORDER BY name").all(first);
  const t = today();
  const rows = emps.map(e => {
    const att = new Map(db.prepare('SELECT date, status, review, flags FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?').all(e.id, first, days.at(-1)).map(a => [a.date, a]));
    const codes = days.map(d => {
      const a = att.get(d);
      if (a?.status === 'On Leave') return 'L';
      if (a && ['Present', 'Working'].includes(a.status)) return a.review === 'To review' ? 'P?' : 'P';
      if (a?.status === 'Half Day') return a.review === 'To review' ? 'H?' : 'H';
      if (hol.has(d)) return 'HO';
      if (isWeeklyOff(e, d)) return 'WO';
      if (d > t || (e.joining_date && d < e.joining_date)) return '';
      return 'A';
    });
    const c = k => codes.filter(x => x.replace('?', '') === k).length;
    return { employee_id: e.id, code: e.emp_code, name: e.name, department: e.department, codes, present: c('P'), half: c('H'), absent: c('A'), leave: c('L'), paid_days: c('P') + c('H') / 2 + c('L') + c('HO') + c('WO'), to_review: codes.filter(x => x.endsWith('?')).length };
  });
  return { month, days, holidays: Object.fromEntries(hol), rows };
}
