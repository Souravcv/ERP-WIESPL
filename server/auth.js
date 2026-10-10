import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 7;
const COOKIE = 'wiespl_sid';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export const publicUser = u => u && ({ id: u.id, username: u.username, name: u.name, role: u.role, email: u.email, phone: u.phone, must_change: !!u.must_change, active: !!u.active });

export function authenticate(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
    if (row && row.active && new Date(row.expires_at) > new Date()) req.user = row;
  }
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

export const requireRole = (...roles) => (req, res, next) =>
  req.user.role === 'admin' || roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

// Small in-memory brute-force guard: 10 failed attempts per username+IP per 15 minutes.
const failures = new Map();
export function loginAllowed(key) {
  const f = failures.get(key);
  return !f || f.until < Date.now() || f.count < 10;
}
export function loginFailed(key) {
  const f = failures.get(key);
  if (!f || f.until < Date.now()) failures.set(key, { count: 1, until: Date.now() + 15 * 60e3 });
  else f.count++;
}
export function loginSucceeded(key) { failures.delete(key); }

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
