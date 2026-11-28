// Geofenced attendance and HR. The phone sends its GPS position (and a selfie) at clock-in, at presence checks during
// the day and at clock-out; the server measures the distance to the work location (Haversine), decides inside / outside
// the fence and flags what HR should look at: late, outside the fence, too few checks, impossible jumps, a changed network,
// a fake-GPS app (reported by the Android app), no clock-out. Leave requests go through approval and mark the days On Leave.
import { db, tx, audit, getSettings } from './db.js';
import { getRow, insertRow, updateRow, listRows, HttpError } from './crud.js';
import { hasFunction, OUT_REASONS } from '../public/js/schema.js';
import { saveAttachment } from './roles.js';
import { submitForApproval } from './workflows.js';
import { notify } from './notify.js';
import { isWeeklyOff, isOffDay, policy, balances, monthRegister } from './hrpolicy.js';
export { prepLeave, monthRegister } from './hrpolicy.js';

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
    maxAccuracy: n(s.hr_max_accuracy_m, 150), pingMinutes: n(s.hr_auto_ping_minutes, 15), photos: s.hr_photos === 'On' };
}
// Selfies at clock-in / out and photo checks during the day: only for field staff, and only while the setting
// "Field staff photos" is On (Off by default since 20 Nov 2026; the location checks stay).
export const needsPhoto = emp => emp?.field_staff === 'Yes' && rules().photos;

// The person's own shift (Employees → Shift Start / End; "2:00 PM" is read too), else the company day 09:30–18:00.
// own = the shift differs from the company day: then its length is the working day (clock-out lock, full / half day),
// otherwise the HR settings (hours + break) apply as before.
const clock = t => {
  const m = String(t || '').trim().match(/^(\d{1,2})[:.](\d{2})\s*(?:([ap])\.?\s*m\.?)?$/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  if (m[3]) { const pm = /p/i.test(m[3]); hh = hh === 12 ? (pm ? 12 : 0) : hh + (pm ? 12 : 0); }
  return hh < 24 && mm < 60 ? hh * 60 + mm : null;
};
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
export function shiftOf(emp) {
  const s = getSettings();
  const brk = s.hr_break_minutes === '' || s.hr_break_minutes == null ? 30 : Number(s.hr_break_minutes) || 0;
  const companyNeed = (Number(s.hr_required_hours) || 8) * 60 + brk;
  let start = clock(emp?.shift_start), stop = clock(emp?.shift_end);
  if (start == null) start = 570;
  if (stop == null || stop <= start) stop = start === 570 ? 1080 : Math.min(start + companyNeed, 23 * 60 + 59);
  const own = !(start === 570 && stop === 1080);
  const need = own ? stop - start : companyNeed;                       // clock-in → clock-out, break included
  const work = own ? need - (need >= 360 ? brk : 0) : null;             // working minutes of an own shift
  return { start, stop, len: stop - start, own, need, work, from: hm(start), to: hm(stop) };
}

// Approved leave that touches a date (a short or half-day leave shortens the day; others free it).
export const leavesOn = (empId, date) => db.prepare("SELECT type, half_day FROM leave_requests WHERE employee_id = ? AND status = 'Approved' AND from_date <= ? AND to_date >= ?").all(empId, date, date);
const SHORT = 'Short leave (up to 1½ h)';
const isHalf = l => l.half_day === 'Yes' && l.type !== SHORT;
const partLeave = l => l.type === SHORT || isHalf(l);
// Minutes of the day an approved short / half-day leave covers (late in or early out).
function leaveAllowance(emp, date, lv = leavesOn(emp.id, date)) {
  const sh = shiftOf(emp), P = policy();
  return Math.max(0, ...lv.map(l => (l.type === SHORT ? P.shortLeaveMin : isHalf(l) ? Math.round(sh.need / 2) : 0)));
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

// Every active work location with a position (for choosing the site at clock-in and for following a move to another site).
export function activeSites() {
  return db.prepare("SELECT id, name, kind, lat, lng, radius_m FROM work_locations WHERE COALESCE(active, 'Yes') = 'Yes' AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY name").all();
}

// Inside = the distance, less the GPS uncertainty (up to 100 m), is within the radius.
function fence(loc, p) {
  const d = Math.round(haversine(p.lat, p.lng, loc.lat, loc.lng));
  const radius = Number(loc.radius_m) || 200;
  return { distance: d, inside: d - Math.min(Number(p.accuracy) || 0, 100) <= radius, radius };
}
// Sites assigned to the employee on a date (site assignments).
function assignedIds(emp, date) {
  return new Set(db.prepare("SELECT location_id FROM site_assignments WHERE employee_id = ? AND from_date <= ? AND (to_date IS NULL OR to_date = '' OR to_date >= ?)").all(emp.id, date, date).map(r => r.location_id));
}
// The work location to clock in at, from the phone's position, out of every active location (office, factory, client
// site): of those the person stands in, the one assigned to them today first, then their usual location, then the
// nearest; when they stand in none, the nearest of all (inside: false). The same order as the phone screen.
export function pickSite(emp, date, p) {
  const today = assignedIds(emp, date);
  const all = activeSites().map(l => ({ loc: l, ...fence(l, p), rank: today.has(l.id) ? 0 : l.id === emp.default_location_id ? 1 : 2 }));
  return all.filter(x => x.inside).sort((a, b) => a.rank - b.rank || a.distance - b.distance)[0] || all.sort((a, b) => a.distance - b.distance)[0] || null;
}
const km = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
function siteList(list, emp, date) {
  const today = assignedIds(emp, date);
  return list.map(l => ({ id: l.id, name: l.name, kind: l.kind, lat: l.lat, lng: l.lng, radius_m: l.radius_m, rank: today.has(l.id) ? 0 : l.id === emp.default_location_id ? 1 : 2 }));
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
  // The operator's part of the address: IPv4 a.b, IPv6 the first two groups (mobile data changes the rest all the time).
  const net = s => { const x = String(s || '').replace(/^::ffff:/, ''); return x.includes(':') ? x.split(':').slice(0, 2).join(':') : x.split('.').slice(0, 2).join('.'); };
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

// Periods outside the fence from the checks: one starts at the employee's "Going out" or the first check outside, and
// ends at "Back", or at a check inside after being seen outside, or at clock-out / the end of the day. Short GPS
// blips (under 5 min, not told by the employee) are left out. HR's reason, deduction and note are kept.
export function outingsOf(pings, end, previous) {
  const at = s => Date.parse(String(s).replace(' ', 'T'));
  const out = [];
  let cur = null, seenOut = false;
  const close = to => { cur.to = to || cur.from; out.push(cur); cur = null; seenOut = false; };
  for (const p of pings) {
    if (p.kind === 'Going out') { if (!cur) cur = { from: p.at, reason: p.note || '', by: p.note ? 'Employee' : '' }; else if (!cur.reason) Object.assign(cur, { reason: p.note || '', by: 'Employee' }); seenOut = false; continue; }
    if (p.kind === 'Back') { if (cur) close(p.at); continue; }
    // arrived at another site: the time since leaving the last one was travel to it
    if (p.kind === 'Site change') { if (cur) { if (!cur.reason || cur.by !== 'Employee') Object.assign(cur, { reason: p.note || 'Travel', by: 'Auto' }); close(p.at); } continue; }
    if (p.inside === 'No') { if (!cur) cur = { from: p.at, reason: '', by: '' }; seenOut = true; if (p.kind === 'Out') close(p.at); continue; }
    if (cur && (p.kind === 'Out' || (p.inside === 'Yes' && (seenOut || !cur.by)))) close(p.at);
  }
  if (cur) { cur.open = true; close(end); }
  let prev = [];
  try { prev = Array.isArray(previous) ? previous : JSON.parse(previous || '[]') || []; } catch { prev = []; }
  const list = out.map(o => {
    const minutes = Math.max(0, Math.round((at(o.to) - at(o.from)) / 60e3));
    const was = prev.find(x => x.from === hhmm(o.from));
    const row = { from: hhmm(o.from), to: o.open && !o.to ? '' : hhmm(o.to), minutes, reason: o.reason, by: o.by, deduct: was?.deduct ?? '', note: was?.note ?? '' };
    if (was?.by === 'HR') Object.assign(row, { reason: was.reason, by: 'HR' });
    return row;
  }).filter(o => o.by || o.minutes >= 5 || o.deduct);
  // rows HR added by hand (no matching period) stay
  for (const x of prev) if (x.by === 'HR' && !list.some(o => o.from === x.from)) list.push(x);
  return list.sort((a, b) => String(a.from).localeCompare(String(b.from)));
}

function counts(attId) {
  return db.prepare("SELECT COUNT(*) checks, SUM(inside = 'Yes') inside_n, SUM(kind = 'Photo check') photos, MAX(at) last FROM attendance_pings WHERE attendance_id = ?").get(attId);
}


// Hours, status and flags of a day (also for a day that ended without a clock-out).
export function evaluate(attId) {
  const a = getRow('attendance', attId);
  if (['On Leave', 'Holiday', 'Week Off'].includes(a.status) && !a.check_in) return a;
  const emp = getRow('employees', a.employee_id);
  const R = rules(), sh = shiftOf(emp);
  // full / half day by hours: an own shorter shift needs its own hours
  const fullDay = sh.own ? Math.min(R.fullDay, sh.work / 60) : R.fullDay, halfDay = sh.own ? Math.min(R.halfDay, fullDay / 2) : R.halfDay;
  const flags = new Set(String(a.flags || '').split('\n').filter(Boolean).filter(x => !/^(late|left early|few presence checks|no clock-out|short day|worked on a weekly off)/.test(x)));
  const pings = db.prepare('SELECT kind, at, inside, flags, note FROM attendance_pings WHERE attendance_id = ? ORDER BY id').all(a.id);
  for (const p of pings) if (p.flags) for (const x of p.flags.split('; ')) flags.add(x);
  let hours = 0, short = null, timing = '';
  const off = isOffDay(emp, a.date);
  if (a.check_in) {
    const end = a.check_out || (a.date < today() ? (pings.at(-1)?.at || null) : now());
    hours = end ? r1((Date.parse(String(end).replace(' ', 'T')) - Date.parse(String(a.check_in).replace(' ', 'T'))) / 3600e3) : 0;
    const start = sh.start, stop = sh.stop;
    const lateIn = Math.max(0, mins(hhmm(a.check_in)) - start), earlyOut = a.check_out ? Math.max(0, stop - mins(hhmm(a.check_out))) : 0;
    // an approved short / half-day leave covers that much late in + early out: no late flag for it
    const covered = off ? 0 : leaveAllowance(emp, a.date);
    if (lateIn + earlyOut - covered > R.grace) {
      if (lateIn > R.grace) flags.add(`late (in at ${hhmm(a.check_in)})`);
      if (earlyOut > R.grace) flags.add(`left early (out at ${hhmm(a.check_out)})`);
    }
    if (!a.check_out && a.date < today()) flags.add('no clock-out');
    if (off) {
      timing = 'Worked on off day (comp-off)';
      flags.add('worked on a weekly off / holiday: comp-off once HR approves (take it this month, or it is paid)');
    } else {
      // HR Policy: up to 15 min is on time; 15 min–1½ h a late mark; up to 4 h half a day; beyond 4 h a day's leave or
      // salary. An approved short leave covers 1½ h, a half-day leave half the shift.
      // An own short shift: the "half day" limit is at most half of it.
      const P = policy(), halfMin = sh.own ? Math.min(P.halfDayMin, Math.round(sh.need / 2)) : P.halfDayMin;
      short = Math.max(0, lateIn + earlyOut - covered);
      timing = short <= R.grace ? 'On time' : short <= Math.min(P.shortLeaveMin, halfMin) ? 'Late mark' : short <= halfMin ? 'Half day (late / early)' : 'Full day cut (over 4 h late / early)';
    }
    if (R.photos && emp.field_staff === 'Yes' && hours >= R.checkEvery) {
      const need = Math.floor(hours / R.checkEvery), got = pings.filter(p => p.kind === 'Photo check').length;
      if (got < need) flags.add(`few presence checks (${got} of ${need} photo checks)`);
    }
  }
  const working = a.check_in && !a.check_out && a.date === today();
  // Less than a half day counts as absent; the flag sends it to HR, who can correct it.
  const byHours = hours >= fullDay ? 'Present' : hours >= halfDay ? 'Half Day' : 'Absent';
  // A normal day is judged by the policy timing; a day without clock-out, or work on an off day, by its hours.
  const status = working ? 'Working' : !a.check_in || !a.check_out || off ? byHours
    : timing === 'Half day (late / early)' ? 'Half Day' : timing.startsWith('Full day cut') ? 'Absent' : 'Present';
  if (a.check_in && hours < halfDay && !working) flags.add(`short day (${hours} h)`);
  // Minutes away: from each check outside the fence to the next check (or the end of the day).
  // Outside periods (going out is not clocking out): hours stay clock-in to clock-out; HR sees each period with its reason.
  const end = a.check_out || (a.date < today() ? pings.at(-1)?.at : now());
  const outings = outingsOf(pings, end, a.outings);
  // travel from one site to the next (found by the site change) is work time, not time away
  const away = outings.filter(o => o.by !== 'Auto').reduce((s, o) => s + (Number(o.minutes) || 0), 0);
  const deduct = outings.reduce((s, o) => s + (Number(o.deduct) || 0), 0);
  for (const x of [...flags]) if (/^(away from the site|outside the site)/.test(x)) flags.delete(x);
  if (away >= 15) {
    const why = {};
    const own = outings.filter(o => o.by !== 'Auto');
    for (const o of own) why[o.reason || 'no reason given'] = (why[o.reason || 'no reason given'] || 0) + o.minutes;
    flags.add(`outside the site ${own.length} time(s), ${away} min (${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  }
  const c = counts(a.id);
  const list = [...flags];
  // Late / early alone is settled by the policy (late marks), so it does not wait for HR.
  const needsLook = list.filter(x => !/^(late|left early)/.test(x));
  const review = a.review === 'Approved' || a.review === 'Rejected' ? a.review : list.includes(MOCK) || ((needsLook.length || a.mode === 'Travel / outstation') && !working) ? 'To review' : '';
  return updateRow('attendance', a.id, { hours, status, short_min: short, timing: timing || null, flags: list.join('\n') || null, review, away_minutes: away || null,
    outings: JSON.stringify(outings), deduct_minutes: deduct || null, net_hours: r1(Math.max(0, hours - deduct / 60)), checks: c.checks || 0, checks_inside: c.inside_n || 0, photo_checks: c.photos || 0, last_check: c.last ? hhmm(c.last) : null }, { name: 'system' }, { system: true });
}

// ---------------------------------------------------------------- the phone
export function clockIn(user, body = {}, ip, device = null) {
  const emp = employeeOf(user);
  const t = today();
  const existing = db.prepare('SELECT id, check_in, status FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, t);
  if (existing?.check_in) throw new HttpError(409, `You clocked in already today at ${hhmm(existing.check_in)}`);
  const p = position(body);
  const travel = body.mode === 'Travel / outstation';
  let f = null, notice = null;
  const inFlags = [];
  if (!travel) {
    // The server works out the site from the position itself (the screen only suggests): the nearest work location
    // the person stands in, their sites for today first. A site chosen on the screen is kept when they are at it.
    const best = pickSite(emp, t, p);
    if (!best) throw new HttpError(409, 'No work location has a position in the CRM yet: ask HR to set the office / site location, or choose Travel / outstation with a note');
    let chosen = null;
    if (body.site_id) {
      const loc = activeSites().find(l => l.id === Number(body.site_id));
      if (!loc) throw new HttpError(400, 'That site has no position in the CRM: choose another site, or ask HR to set its location');
      chosen = { loc, ...fence(loc, p) };
    }
    if (chosen?.inside || (chosen && !best.inside)) f = chosen;
    else {
      f = best;
      if (chosen && best.inside) { inFlags.push(`chose ${chosen.loc.name} (${km(chosen.distance)} away) but was at ${best.loc.name}`); notice = `You are at ${best.loc.name}, not ${chosen.loc.name}: clocked in at ${best.loc.name}`; }
    }
    // Not within any work location: the clock-in is still recorded, at the site chosen or the nearest one, for HR to check.
    if (!f.inside) {
      inFlags.push(`clocked in outside every work location (${f.loc.name} is ${km(f.distance)} away)`);
      notice = `You are ${km(f.distance)} from ${f.loc.name}, outside every work location. Clock-in recorded; HR will check this day.`;
    }
    if (!allowedSites(emp, t).some(l => l.id === f.loc.id)) inFlags.push(`site not assigned to them (${f.loc.name})`);
  } else if (!String(body.note || '').trim()) throw new HttpError(400, 'Write where you are going / why (travel or outstation work)');
  if (needsPhoto(emp) && !body.photo) throw new HttpError(400, 'Take a selfie to clock in');
  return tx(() => {
    const att = existing ? getRow('attendance', existing.id) : insertRow('attendance', { date: t, employee_id: emp.id }, user, { system: true });
    updateRow('attendance', att.id, { check_in: now(), location_id: f?.loc.id || null, mode: travel ? 'Travel / outstation' : 'Site / office', in_distance_m: f?.distance ?? null, in_ip: ip || null,
      in_device: device?.label || null, in_device_id: device?.id || null,
      note: String(body.note || '').trim() || null, status: 'Working', review: '', site_moves: f ? `${now().slice(11, 16)} ${f.loc.name} (clock in)` : null }, user, { system: true });
    const photoId = savePhoto(att.id, 'Clock in', body.photo, user);
    addPing(getRow('attendance', att.id), emp, 'In', p, f, ip, photoId, [...inFlags, ...sharedDevice(att.id, emp, device, user)]);
    audit(user.name, 'attendance', att.id, 'clock in', f ? `${f.loc.name} ${f.distance} m` : 'travel');
    return { attendance: forPhone(evaluate(att.id)), site: f?.loc.name || null, distance: f?.distance ?? null, inside: f ? f.inside : null, notice };
  });
}

// Buddy punching: the same phone / browser already clocked in someone else today → both days go to HR review.
function sharedDevice(attId, emp, device, user) {
  if (!device?.id) return [];
  const others = db.prepare("SELECT a.id, a.check_in, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.date = ? AND a.in_device_id = ? AND a.employee_id <> ? AND a.check_in IS NOT NULL").all(today(), device.id, emp.id);
  if (!others.length) return [];
  for (const o of others) {
    const flag = `same phone used to clock in ${emp.name} at ${now().slice(11, 16)}`;
    const cur = getRow('attendance', o.id);
    if (!String(cur.flags || '').includes(flag)) updateRow('attendance', o.id, { flags: [cur.flags, flag].filter(Boolean).join('\n'), review: cur.review === 'Approved' ? cur.review : 'To review' }, user, { system: true });
  }
  notify({ fn: 'hr_manage', kind: 'attendance', title: `📱 One phone, ${others.length + 1} people clocked in: ${[...others.map(o => o.name), emp.name].join(', ')}`,
    body: `${device.label || 'same device'} · ${now().slice(11, 16)} · the days are sent to HR review`, link: '#/hr/loginlog' }, { name: 'Attendance' });
  return [`same phone as ${others.map(o => `${o.name} (in at ${hhmm(o.check_in)})`).join(', ')}`];
}

function openDay(emp) {
  const a = db.prepare("SELECT id FROM attendance WHERE employee_id = ? AND date = ? AND check_in IS NOT NULL AND check_out IS NULL").get(emp.id, today());
  if (!a) throw new HttpError(409, 'You have not clocked in today');
  return getRow('attendance', a.id);
}
const siteOf = att => (att.location_id ? db.prepare('SELECT id, name, lat, lng, radius_m FROM work_locations WHERE id = ?').get(att.location_id) : null);

// People move during the day (office first, then a site, or back): when a check finds the person outside their
// current site but inside another work location, the day moves to that site. The move is logged on the day, the time
// on the road is "Travel to <site>", a "going out" ends, and HR / the reporting manager are told. A site that is not
// assigned to the person is allowed and flagged for HR. Returns the site and fence to judge this check by.
function followSite(att, emp, p, ip, user) {
  const loc = siteOf(att);
  const f = loc ? fence(loc, p) : null;
  if (!f || f.inside || att.mode === 'Travel / outstation') return { att, loc, f };
  const there = activeSites().filter(l => l.id !== loc.id).map(l => ({ loc: l, ...fence(l, p) })).filter(x => x.inside).sort((a, b) => a.distance - b.distance)[0];
  if (!there) return { att, loc, f };
  const assigned = allowedSites(emp, att.date).some(l => l.id === there.loc.id);
  const flags = assigned ? [] : [`site not assigned to them (${there.loc.name})`];
  insertRow('attendance_pings', { attendance_id: att.id, employee_id: emp.id, at: now(), kind: 'Site change', lat: p.lat, lng: p.lng, accuracy_m: p.accuracy, distance_m: there.distance,
    inside: 'Yes', ip: ip || null, note: `Travel to ${there.loc.name}`, flags: flags.join('; ') || null }, { name: emp.name }, { system: true });
  updateRow('attendance', att.id, { location_id: there.loc.id, site_moves: [att.site_moves, `${now().slice(11, 16)} ${there.loc.name} (moved from ${loc.name})`].filter(Boolean).join('\n'),
    out_since: null, out_reason: null, away_since: null }, user, { system: true });
  audit(emp.name, 'attendance', att.id, 'site change', `${loc.name} → ${there.loc.name}`);
  notify({ fn: 'hr_manage', userNames: emp.reporting_to ? [emp.reporting_to] : [], kind: 'attendance', title: `📍 ${emp.name} moved from ${loc.name} to ${there.loc.name}`,
    body: `at ${now().slice(11, 16)}${assigned ? '' : ' · this site is not assigned to them'}`, link: `#/view/attendance/${att.id}` }, { name: 'Attendance' });
  return { att: getRow('attendance', att.id), loc: there.loc, f: { distance: there.distance, inside: true, radius: there.radius }, moved: there.loc.name };
}

// A presence check: automatic (every few minutes while the page is open, every 30 min from the Android app even when the
// phone is locked, and at once when the app sees the phone leave the site radius) or with a photo (every few hours).
export function check(user, body = {}, ip) {
  const emp = employeeOf(user);
  const att = openDay(emp);
  const p = position(body);
  const kind = body.photo ? 'Photo check' : body.reason === 'geofence-exit' ? 'Geofence exit' : 'Auto';
  // A plain check within 20 s of the last one adds nothing (e.g. the button pressed again and again).
  const last = db.prepare('SELECT at FROM attendance_pings WHERE attendance_id = ? ORDER BY id DESC LIMIT 1').get(att.id);
  if (kind === 'Auto' && last && Date.parse(now().replace(' ', 'T')) - Date.parse(String(last.at).replace(' ', 'T')) < 20e3) return { recorded: true, at: now().slice(11, 16) };
  const r = tx(() => {
    const prev = db.prepare('SELECT inside FROM attendance_pings WHERE attendance_id = ? ORDER BY id DESC LIMIT 1').get(att.id);
    const photoId = savePhoto(att.id, 'Presence check', body.photo, user);
    const s = followSite(att, emp, p, ip, user);
    addPing(s.att, emp, kind, p, s.f, ip, photoId);
    // The shift is over and the person has clearly left the site without clocking out: close the day at the last
    // time they were seen at the site and flag it for HR. The phone then gets 409 and stops the location checks.
    if (s.f && !s.f.inside && !s.moved && (prev?.inside === 'No' || s.f.distance > 500) && hhmm(now()) >= dayOverAt(emp, att)) {
      const seen = db.prepare("SELECT MAX(at) at FROM attendance_pings WHERE attendance_id = ? AND inside = 'Yes'").get(att.id)?.at;
      const out = seen && seen >= att.check_in ? seen : now();
      const note = `no clock-out: closed automatically after the shift (last at the site ${hhmm(out)})`;
      insertRow('attendance_pings', { attendance_id: att.id, employee_id: emp.id, at: now(), kind: 'Out', lat: p.lat, lng: p.lng, accuracy_m: p.accuracy, distance_m: s.f.distance,
        inside: 'No', ip: ip || null, note: 'Closed automatically: shift over, away from the site', flags: note }, { name: emp.name }, { system: true });
      updateRow('attendance', att.id, { check_out: out, out_distance_m: s.f.distance, out_since: null, out_reason: null, away_since: null }, user, { system: true });
      audit('system', 'attendance', att.id, 'auto clock out', note);
      evaluate(att.id);
      return { closed: hhmm(out) };
    }
    evaluate(att.id);
    if (s.f && !s.moved) awayAlert(getRow('attendance', att.id), emp, s.loc, s.f, prev?.inside === 'No', user);
    // The phone is told only that the check was recorded (and the new site after a move): being inside is for HR.
    return { recorded: true, at: now().slice(11, 16), ...(s.moved ? { site: s.moved } : {}) };
  });
  if (r.closed) throw new HttpError(409, `Your shift is over and you had left the site, so the day was closed at ${r.closed} (you did not clock out). Location checks have stopped. Please clock out yourself next time.`);
  return r;
}

// When the working day is over for the location checks: the time the person may clock out (their shift end, or
// 8 h + break after a late start; shorter with an approved short / half-day leave), else the shift end.
const dayOverAt = (emp, att) => earliestOut(emp, att) || shiftOf(emp).to;

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
    notify({ ...to, kind: 'attendance', title: att.out_reason ? `🚶 ${emp.name} is out for ${att.out_reason} (${d} from ${loc.name})` : `⚠ ${emp.name} is away from ${loc.name} (${d}), no reason given`,
      body: `${att.out_since ? 'went out at ' + hhmm(att.out_since) + ' · ' : att.away_since ? 'since ' + hhmm(att.away_since) + ' · ' : ''}checked at ${now().slice(11, 16)}`, link }, { name: 'Attendance' });
    updateRow('attendance', att.id, { alert_at: now(), away_since: att.away_since || now() }, user, { system: true });
  } else if (att.away_since) {
    const mins = Math.round((Date.parse(now().replace(' ', 'T')) - Date.parse(String(att.away_since).replace(' ', 'T'))) / 60e3);
    notify({ ...to, kind: 'attendance', title: `${emp.name} is back at ${loc.name}`, body: `away about ${mins} min`, link }, { name: 'Attendance' });
    updateRow('attendance', att.id, { away_since: null }, user, { system: true });
  }
}

// The employee steps out (material, other site, lunch …): the day keeps running; HR is told the reason.
export function goingOut(user, body = {}, ip) {
  const emp = employeeOf(user);
  const att = openDay(emp);
  if (att.out_since) throw new HttpError(409, `You are already out since ${hhmm(att.out_since)} (${att.out_reason}): press Back at site when you return`);
  const reason = OUT_REASONS.includes(body.reason) ? body.reason : null;
  if (!reason) throw new HttpError(400, 'Choose why you are going out');
  const note = [reason, String(body.note || '').trim()].filter(Boolean).join(': ');
  let p = null;
  try { p = position(body); } catch { p = null; }   // the reason counts even without a GPS fix
  return tx(() => {
    if (p) addPing(att, emp, 'Going out', p, siteOf(att) ? fence(siteOf(att), p) : null, ip, null);
    else insertRow('attendance_pings', { attendance_id: att.id, employee_id: emp.id, at: now(), kind: 'Going out', ip: ip || null }, { name: emp.name }, { system: true });
    db.prepare("UPDATE attendance_pings SET note = ? WHERE id = (SELECT MAX(id) FROM attendance_pings WHERE attendance_id = ?)").run(reason, att.id);
    updateRow('attendance', att.id, { out_since: now(), out_reason: note }, user, { system: true });
    notify({ fn: 'hr_manage', userNames: emp.reporting_to ? [emp.reporting_to] : [], kind: 'attendance', title: `🚶 ${emp.name} going out: ${note}`, body: `at ${now().slice(11, 16)}`, link: `#/view/attendance/${att.id}` }, { name: 'Attendance' });
    evaluate(att.id);
    return { recorded: true, at: now().slice(11, 16) };
  });
}
export function backAtSite(user, body = {}, ip) {
  const emp = employeeOf(user);
  const att = openDay(emp);
  let p = null;
  try { p = position(body); } catch { p = null; }
  return tx(() => {
    const s = p ? followSite(att, emp, p, ip, user) : null;
    if (p) addPing(s.att, emp, 'Back', p, s.f, ip, null);
    else insertRow('attendance_pings', { attendance_id: att.id, employee_id: emp.id, at: now(), kind: 'Back', ip: ip || null }, { name: emp.name }, { system: true });
    updateRow('attendance', att.id, { out_since: null, out_reason: null }, user, { system: true });
    evaluate(att.id);
    return { recorded: true, at: now().slice(11, 16), ...(s?.moved ? { site: s.moved } : {}) };
  });
}

// When this person's day is complete: from clock-in, not before the shift start, 8 working hours + the 30-minute break
// (09:30 → 18:00). An approved short or half-day leave shortens it; a full-day leave or on-duty day and off-day work have
// no limit. Null = may clock out at any time. Someone in very late can still close the day at night.
export function earliestOut(emp, att) {
  const s = getSettings();
  if (s.hr_clock_out_lock === 'No' || !att.check_in || isOffDay(emp, att.date)) return null;
  // the person's own shift: e.g. 09:30–14:00 may clock out at 14:00 (it was always 8 h + break before)
  const sh = shiftOf(emp);
  const lv = leavesOn(emp.id, att.date);
  if (lv.some(l => !partLeave(l))) return null;
  const from = Math.max(mins(hhmm(att.check_in)), sh.start);
  return hm(Math.min(from + sh.need - leaveAllowance(emp, att.date, lv), 23 * 60 + 30));
}

const clockOutWait = (emp, att) => {
  const from = att?.check_in && !att.check_out ? earliestOut(emp, att) : null;
  if (!from || hhmm(now()) >= from) return {};
  const [h, m] = from.split(':').map(Number), [nh, nm] = hhmm(now()).split(':').map(Number);
  return { out_from: from, out_wait_ms: ((h - nh) * 60 + m - nm) * 60000 };
};

export function clockOut(user, body = {}, ip) {
  const emp = employeeOf(user);
  const att = openDay(emp);
  const from = earliestOut(emp, att);
  if (from && hhmm(now()) < from) throw new HttpError(400, `Your hours are not complete: you can clock out at ${from}. To leave early, apply for a short leave or half day and ask HR to approve it.`);
  const p = position(body);
  if (needsPhoto(emp) && !body.photo) throw new HttpError(400, 'Take a selfie to clock out');
  return tx(() => {
    const photoId = savePhoto(att.id, 'Clock out', body.photo, user);
    // clocking out at another site than the morning's: the day moves there first
    const { att: cur, f } = followSite(att, emp, p, ip, user);
    addPing(cur, emp, 'Out', p, f, ip, photoId, f && !f.inside ? ['clocked out outside the site'] : []);
    updateRow('attendance', att.id, { check_out: now(), out_distance_m: f?.distance ?? null, out_since: null, out_reason: null }, user, { system: true });
    audit(user.name, 'attendance', att.id, 'clock out', f ? `${f.distance} m` : '');
    return { attendance: forPhone(evaluate(att.id)) };
  });
}

// The employee's own copy of a day: no distances, site-check results or HR notes.
const HR_ONLY = ['flags', 'in_device', 'in_device_id', 'in_distance_m', 'out_distance_m', 'checks_inside', 'away_minutes', 'away_since', 'alert_at', 'in_ip', 'remarks', 'outings', 'deduct_minutes', 'net_hours'];
const forPhone = att => att && Object.fromEntries(Object.entries(att).filter(([k]) => !HR_ONLY.includes(k)));

// What the phone shows: today, where the person may clock in, their month, their leave.
export function myDay(user) {
  const emp = employeeOf(user);
  const t = today();
  const row = db.prepare('SELECT id FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, t);
  const att = row ? getRow('attendance', row.id) : null;
  const month = db.prepare("SELECT date, status, check_in, check_out, hours, review, timing FROM attendance WHERE employee_id = ? AND date >= ? ORDER BY date DESC").all(emp.id, t.slice(0, 8) + '01');
  const leaves = db.prepare('SELECT id, leave_no, type, from_date, to_date, days, status, balance_note FROM leave_requests WHERE employee_id = ? ORDER BY id DESC LIMIT 10').all(emp.id);
  const sh = shiftOf(emp), lvToday = leavesOn(emp.id, t);
  const part = lvToday.length && lvToday.every(partLeave);
  const cover = part ? leaveAllowance(emp, t, lvToday) : 0;
  return { employee: { id: emp.id, name: emp.name, code: emp.emp_code, field_staff: emp.field_staff, photos: needsPhoto(emp), shift_start: sh.from, shift_end: sh.to },
    // an approved short / half-day leave today: the person still clocks in (later) or out (earlier)
    leave_today: lvToday.length ? { type: lvToday[0].type, half: lvToday.some(isHalf), part: !!part, minutes: cover, come_by: part ? hm(sh.start + cover) : null, go_from: part ? hm(sh.stop - cover) : null } : null,
    // with the position and radius, so the phone can preselect the nearest site at clock-in (rank: 0 assigned today, 1 usual location)
    today: t, attendance: forPhone(att), sites: siteList(allowedSites(emp, t), emp, t),
    // other active sites, also selectable at clock-in (HR sees when a site is not assigned)
    other_sites: siteList(activeSites().filter(l => !allowedSites(emp, t).some(a => a.id === l.id)), emp, t),
    rules: rules(), ...clockOutWait(emp, att), month, leaves, balance: balances(t, emp.id).rows[0] || null, holiday: db.prepare('SELECT name FROM holidays WHERE date = ?').get(t)?.name || null, weekly_off: isWeeklyOff(emp, t) };
}

// ---------------------------------------------------------------- leave
export function applyLeave(user, body = {}) {
  const emp = employeeOf(user);
  if (!body.from_date || !String(body.reason || '').trim()) throw new HttpError(400, 'Enter the dates and the reason');
  return tx(() => {
    const lv = insertRow('leave_requests', { employee_id: emp.id, type: body.type || 'Privilege Leave (PL)', from_date: body.from_date, to_date: body.to_date || body.from_date, half_day: body.half_day === 'Yes' ? 'Yes' : 'No', reason: body.reason, status: 'Draft' }, user, { system: true });
    submitForApproval('Leave', lv.id, user);
    return getRow('leave_requests', lv.id);
  });
}
// Approved leave marks its working days On Leave (every day for maternity); a day already worked is judged again (a
// short or half-day leave covers part of it). A cancelled or rejected leave takes its marks back.
export function markLeave(leaveId, user) {
  const lv = getRow('leave_requests', leaveId);
  const marked = db.prepare("SELECT id FROM attendance WHERE employee_id = ? AND status = 'On Leave' AND check_in IS NULL AND note LIKE ?").all(lv.employee_id, `%${lv.leave_no}%`);
  const worked = () => db.prepare('SELECT id FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? AND check_in IS NOT NULL').all(lv.employee_id, lv.from_date, lv.to_date);
  if (['Cancelled', 'Rejected'].includes(lv.status)) {
    for (const a of marked) db.prepare('DELETE FROM attendance WHERE id = ?').run(a.id);
    for (const a of worked()) evaluate(a.id);   // the leave no longer covers late / early
    return;
  }
  // A half day is half leave, half work: the day is not marked On Leave (that hid the clock-in button); the
  // register shows HL until the person clocks in, then the worked half with the leave covering the rest.
  if (lv.status === 'Approved' && isHalf(lv)) {
    for (const a of marked) db.prepare('DELETE FROM attendance WHERE id = ?').run(a.id);
    for (const a of worked()) evaluate(a.id);
    return;
  }
  if (lv.status !== 'Approved') return;
  const emp = getRow('employees', lv.employee_id);
  for (let d = lv.from_date; d <= lv.to_date; d = addDays(d, 1)) {
    const a = db.prepare('SELECT id, check_in FROM attendance WHERE employee_id = ? AND date = ?').get(lv.employee_id, d);
    if (a?.check_in) { evaluate(a.id); continue; }
    if (lv.type === 'Short leave (up to 1½ h)' || (lv.type !== 'Maternity' && isOffDay(emp, d))) continue;
    const note = `${lv.type} ${lv.leave_no}${lv.half_day === 'Yes' ? ' (half day)' : ''}`;
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

// Reminders at the person's own shift times, as a pop-up in the CRM (on the phone it shows when the CRM is open):
// "Please clock in" at the shift start (later by an approved short / half-day leave) to anyone not clocked in, and
// "Please clock out" once their hours are complete to anyone still clocked in. Once a day each; not on off days or
// full-day leave; not more than 2 hours late (e.g. after a restart); only people who use attendance (clocked in during
// the last 30 days, or joined in that time), so office logins that never clock in get no pop-ups. Runs every minute.
const userOfEmp = emp => (emp.login ? db.prepare('SELECT name FROM users WHERE lower(username) = lower(?) AND active = 1').get(String(emp.login).trim()) : null);
export function shiftReminders(at = now()) {
  const t = at.slice(0, 10), nowMin = mins(at.slice(11, 16));
  let sent = {};
  try { const raw = getSettings().hr_shift_reminders; sent = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {}; } catch { sent = {}; }
  if (sent.date !== t) sent = { date: t, in: [], out: [] };
  const before = JSON.stringify(sent);
  const hol = db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(t);
  const since = addDays(t, -30);
  const users = db.prepare("SELECT * FROM employees e WHERE COALESCE(status, 'Active') = 'Active' AND COALESCE(login, '') <> '' AND (joining_date >= ? OR EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.check_in IS NOT NULL AND a.date >= ?))").all(since, since);
  for (const emp of users) {
    if (hol || isWeeklyOff(emp, t)) continue;
    const u = userOfEmp(emp);
    if (!u) continue;
    const lv = leavesOn(emp.id, t);
    if (lv.some(l => !partLeave(l))) continue;              // on leave for the whole day
    const sh = shiftOf(emp), cover = leaveAllowance(emp, t, lv);
    const a = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, t);
    // clock in: at the shift start (+ the leave they have for coming late)
    const inAt = sh.start + (lv.length ? cover : 0);
    if (!a?.check_in && nowMin >= inAt && nowMin < inAt + 120 && !sent.in.includes(emp.id)) {
      notify({ userNames: [u.name], kind: 'attendance', title: '⏰ Please clock in', body: `Your shift starts at ${hm(inAt)}. Open My Attendance and press “Clock in”.`, link: '#/attend' }, { name: 'Attendance' });
      sent.in.push(emp.id);
    }
    // clock out: when the hours are complete (the clock-out button opens), else at the shift end
    if (a?.check_in && !a.check_out && !sent.out.includes(emp.id)) {
      const outAt = mins(earliestOut(emp, a) || hm(sh.stop));
      if (nowMin >= outAt && nowMin < outAt + 120) {
        notify({ userNames: [u.name], kind: 'attendance', title: '🏁 Please clock out', body: `Your work time is over (${hm(outAt)}). Before you leave, open My Attendance and press “Clock out”.`, link: '#/attend' }, { name: 'Attendance' });
        sent.out.push(emp.id);
      }
    }
  }
  if (JSON.stringify(sent) !== before) db.prepare("INSERT INTO settings (key, value) VALUES ('hr_shift_reminders', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(JSON.stringify(sent)));
  return sent;
}

// Days left open (no clock-out) are closed at night and flagged.
export function closeOpenDays() {
  for (const r of db.prepare("SELECT id FROM attendance WHERE check_in IS NOT NULL AND check_out IS NULL AND date < ?").all(today())) evaluate(r.id);
}

export function pingsOf(attId) {
  return db.prepare('SELECT at, kind, lat, lng, accuracy_m, distance_m, inside, ip, photo_id, flags FROM attendance_pings WHERE attendance_id = ? ORDER BY id').all(Number(attId));
}

// Today across the company: who is working where, who has not come, exceptions.
// Who is on duty right now and where they last were, for safety and for seeing who is on which site. Only people clocked
// in today appear with a location: nobody's position is shown after clock-out. "Current" means the last check received,
// so a person whose check is overdue is marked as out of date rather than shown as if live.
export function liveLocations() {
  const t = today(), R = rules(), nowMs = Date.parse(now().replace(' ', 'T'));
  const staleAfter = R.pingMinutes * 2 + 5;
  const emps = db.prepare("SELECT id, emp_code, name, department, designation, mobile, emergency_contact FROM employees WHERE COALESCE(status, 'Active') = 'Active' ORDER BY name").all();
  const dayOf = db.prepare("SELECT a.id, a.check_in, a.check_out, a.status, a.mode, a.location_id, a.out_since, a.out_reason, l.name site FROM attendance a LEFT JOIN work_locations l ON l.id = a.location_id WHERE a.employee_id = ? AND a.date = ?");
  const lastOf = db.prepare('SELECT at, lat, lng, accuracy_m, distance_m, inside, flags FROM attendance_pings WHERE attendance_id = ? AND lat IS NOT NULL ORDER BY id DESC LIMIT 1');
  const people = [], absent = [];
  for (const e of emps) {
    const a = dayOf.get(e.id, t);
    const contact = { employee_id: e.id, code: e.emp_code, name: e.name, department: e.department, designation: e.designation, mobile: e.mobile, emergency_contact: e.emergency_contact };
    if (!a?.check_in || a.check_out) { absent.push({ ...contact, state: a?.check_out ? `Clocked out ${hhmm(a.check_out)}` : a?.status === 'On Leave' ? 'On leave' : 'Not clocked in' }); continue; }
    const p = lastOf.get(a.id);
    const minutes = p ? Math.max(0, Math.round((nowMs - Date.parse(String(p.at).replace(' ', 'T'))) / 60000)) : null;
    people.push({ ...contact, attendance_id: a.id, site_id: a.location_id, site: a.site || (a.mode === 'Travel / outstation' ? 'Travel / outstation' : 'No site'), check_in: hhmm(a.check_in), out_since: a.out_since ? hhmm(a.out_since) : null, out_reason: a.out_reason || null,
      lat: p?.lat ?? null, lng: p?.lng ?? null, accuracy: p?.accuracy_m ?? null, last_at: hhmm(p?.at), minutes, inside: p?.inside || null, distance: p?.distance_m ?? null, stale: minutes == null || minutes > staleAfter, fake: /fake gps/i.test(p?.flags || '') });
  }
  const sites = db.prepare("SELECT id, name, kind, lat, lng, radius_m FROM work_locations WHERE lat IS NOT NULL AND lng IS NOT NULL ORDER BY name").all();
  return { at: hhmm(now()), ping_minutes: R.pingMinutes, stale_after: staleAfter, people, absent, sites,
    totals: { on_duty: people.length, at_site: people.filter(p => p.inside === 'Yes' && !p.stale).length, away: people.filter(p => p.inside === 'No').length, out_of_date: people.filter(p => p.stale).length, no_location: people.filter(p => p.lat == null).length } };
}

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
