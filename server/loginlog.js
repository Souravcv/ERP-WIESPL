// Login / logout log for HR (against buddy punching: one person clocking in for others by signing in to their accounts
// on one phone). Each sign-in, sign-out and failed sign-in is kept with the time, the network (IP), the phone / browser
// (a CRM device cookie, kept 2 years, plus the browser's own description). HR sees the log and the warnings:
// - one device signed in to several accounts within 30 minutes (strong: the same browser);
// - the same network and the same kind of phone within 10 minutes (weaker: a private tab gets a new device cookie,
//   but several iPhones in one office Wi-Fi also look alike, so HR judges these);
// - one device used to clock in two people on the same day (also flagged on the day itself, see hr.js).
// No password is ever logged.
import crypto from 'node:crypto';
import { db } from './db.js';

const DEV = 'wiespl_dev';
const now = () => new Date().toLocaleString('sv-SE').slice(0, 19);
const at = s => Date.parse(String(s).replace(' ', 'T'));

export function migrateLoginLog() {
  db.exec(`CREATE TABLE IF NOT EXISTS login_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, user_id INTEGER, username TEXT, name TEXT,
      ip TEXT, device_id TEXT, device TEXT, agent TEXT);
    CREATE INDEX IF NOT EXISTS ix_login_events_at ON login_events(at);
    CREATE INDEX IF NOT EXISTS ix_login_events_device ON login_events(device_id);`);
}

// The caller's address. Behind the tunnel (ngrok / Cloudflare) the proxy adds the real address as the LAST entry of
// X-Forwarded-For; the first entry is whatever the phone sent, so it could be faked.
export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return (xff.at(-1) || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
}

// "iPhone · Safari", "Android 14 (SM-A146B) · Chrome", "Windows · Edge", "WIESPL app (Android)".
export function deviceLabel(ua = '') {
  ua = String(ua);
  const android = ua.match(/Android\s([\d.]+)(?:;\s*([^;)]+))?/);
  const model = android?.[2] && !/^(K|wv|Linux|U)$/i.test(android[2].trim()) ? ` (${android[2].trim()})` : '';
  const os = /iPhone/.test(ua) ? `iPhone${(ua.match(/OS (\d+)[_\d]* like Mac/) || [])[1] ? ' iOS ' + ua.match(/OS (\d+)/)[1] : ''}` : /iPad/.test(ua) ? 'iPad'
    : android ? `Android ${android[1].split('.')[0]}${model}` : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Other';
  if (/;\s*wv\)/.test(ua) || /WIESPL/i.test(ua)) return `WIESPL app (${os})`;
  const br = /EdgA?\/|EdgiOS/.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\/|Opera/.test(ua) ? 'Opera' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// This phone / browser: its device cookie (made now if it has none) and its description.
export function deviceOf(req, res) {
  let id = readCookie(req, DEV);
  if (!id || !/^[\w-]{10,40}$/.test(id)) {
    id = crypto.randomBytes(12).toString('base64url');
    res?.append?.('Set-Cookie', `${DEV}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${2 * 365 * 86400}${req.secure ? '; Secure' : ''}`);
  }
  return { id, label: deviceLabel(req.headers['user-agent']) };
}

// Who a request's session belongs to (for the sign-out, which runs before the login check).
export function sessionUser(req) {
  const token = readCookie(req, 'wiespl_sid');
  return token ? db.prepare('SELECT u.id, u.username, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token) : null;
}

export function recordLogin(req, res, kind, user) {
  try {
    const d = deviceOf(req, res);
    db.prepare('INSERT INTO login_events (at, kind, user_id, username, name, ip, device_id, device, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(now(), kind, user?.id || null, String(user?.username || '').slice(0, 80) || null, user?.name || null, clientIp(req), d.id, d.label, String(req.headers['user-agent'] || '').slice(0, 300));
  } catch (e) { console.error('login log', e.message); }
}

// Groups of events (sorted by time) on one key where different accounts follow each other within `gapMin` minutes.
function clusters(events, keyOf, gapMin) {
  const by = new Map();
  for (const e of events) { const k = keyOf(e); if (k) (by.get(k) || by.set(k, []).get(k)).push(e); }
  const out = [];
  for (const [key, list] of by) {
    let cur = [];
    const flush = () => { if (new Set(cur.map(e => e.username.toLowerCase())).size > 1) out.push({ key, events: cur }); cur = []; };
    for (const e of list) {
      if (cur.length && at(e.at) - at(cur.at(-1).at) > gapMin * 60e3) flush();
      cur.push(e);
    }
    flush();
  }
  return out;
}

// The log of the last `days` days and the warnings, each with the clock-ins made by those people near that time.
export function loginReport(days = 7) {
  const n = Math.min(Math.max(Number(days) || 7, 1), 90);
  const from = new Date(Date.now() - n * 864e5).toLocaleString('sv-SE').slice(0, 19);
  const events = db.prepare('SELECT id, at, kind, username, name, ip, device_id, device FROM login_events WHERE at >= ? ORDER BY at, id').all(from);
  const logins = events.filter(e => e.kind === 'login' && e.username);
  const clockInsNear = (names, a, b) => db.prepare(`SELECT e.name, a.check_in, a.in_device, a.id FROM attendance a JOIN employees e ON e.id = a.employee_id JOIN users u ON lower(u.username) = lower(e.login)
      WHERE a.check_in BETWEEN ? AND ? AND lower(u.username) IN (${names.map(() => '?').join(',')}) ORDER BY a.check_in`)
    .all(new Date(at(a) - 30 * 60e3).toLocaleString('sv-SE').slice(0, 19), new Date(at(b) + 30 * 60e3).toLocaleString('sv-SE').slice(0, 19), ...names.map(x => x.toLowerCase()));
  const warn = (level, why, c) => {
    const names = [...new Set(c.events.map(e => e.username))];
    const first = c.events[0].at, last = c.events.at(-1).at;
    return { level, why, from: first, to: last, accounts: [...new Set(c.events.map(e => e.name || e.username))], device: c.events[0].device, ip: c.events[0].ip,
      clock_ins: clockInsNear(names, first, last).map(r => ({ name: r.name, at: r.check_in.slice(11, 16), attendance_id: r.id })) };
  };
  const strong = clusters(logins, e => e.device_id, 30).map(c => warn('high', 'One phone / browser signed in to several accounts within 30 minutes', c));
  const seen = new Set(strong.flatMap(w => w.accounts.map(a => `${w.from.slice(0, 13)}|${a}`)));
  const weak = clusters(logins, e => (e.ip && e.device ? `${e.ip}|${e.device}` : null), 10)
    .filter(c => new Set(c.events.map(e => e.device_id)).size > 1)
    .map(c => warn('check', 'Same network and same kind of phone within 10 minutes (could be colleagues on the office Wi-Fi)', c))
    .filter(w => !w.accounts.every(a => seen.has(`${w.from.slice(0, 13)}|${a}`)));
  // clock-ins from one device for different people on one day
  const shared = db.prepare(`SELECT a.date, a.in_device_id, a.in_device, GROUP_CONCAT(e.name || ' ' || substr(a.check_in, 12, 5), ', ') people, COUNT(DISTINCT a.employee_id) n
      FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.in_device_id IS NOT NULL AND a.date >= ? GROUP BY a.date, a.in_device_id HAVING n > 1 ORDER BY a.date DESC`).all(from.slice(0, 10));
  return { days: n, events: events.reverse().slice(0, 1000), warnings: [...strong, ...weak].sort((a, b) => b.from.localeCompare(a.from)), shared_clock_ins: shared };
}
