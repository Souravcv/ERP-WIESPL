// Real photos of each OT part (pass box, door, pendants …), uploaded in Settings and shown to clients
// in the part panel beside the 3D view of the enquiry form.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR } from './db.js';
import { HttpError } from './crud.js';

const DIR = path.join(DATA_DIR, 'uploads', 'part_photos');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PART = /^[a-z_]{2,40}$/;

export function migratePhotos() {
  db.exec(`CREATE TABLE IF NOT EXISTS part_photos (
    id INTEGER PRIMARY KEY, part TEXT NOT NULL, filename TEXT, mime TEXT, size INTEGER, stored TEXT NOT NULL, caption TEXT,
    uploaded_by TEXT, at TEXT DEFAULT (datetime('now','localtime')))`);
}

export const listPhotos = () => db.prepare('SELECT id, part, filename, caption, size, uploaded_by, at FROM part_photos ORDER BY part, id').all();

// { pass box: [{ id, caption }] } for the public form
export function publicPhotos() {
  const out = {};
  for (const p of db.prepare('SELECT id, part, caption FROM part_photos ORDER BY id').all()) (out[p.part] ||= []).push({ id: p.id, caption: p.caption || '' });
  return out;
}

export function addPhoto(part, filename, caption, buf, user) {
  if (!PART.test(part || '')) throw new HttpError(400, 'Choose which part the photo shows');
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!TYPES[ext]) throw new HttpError(400, 'Photos must be JPG, PNG or WebP');
  if (!buf?.length) throw new HttpError(400, 'The file is empty');
  if (buf.length > 8 * 1048576) throw new HttpError(400, 'Each photo can be up to 8 MB');
  if (db.prepare('SELECT COUNT(*) n FROM part_photos WHERE part = ?').get(part).n >= 12) throw new HttpError(400, 'Up to 12 photos per part');
  fs.mkdirSync(DIR, { recursive: true });
  const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(DIR, stored), buf);
  const id = Number(db.prepare('INSERT INTO part_photos (part, filename, mime, size, stored, caption, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(part, String(filename).slice(0, 150), TYPES[ext], buf.length, stored, String(caption || '').slice(0, 160) || null, user.name).lastInsertRowid);
  return { id };
}

export function removePhoto(id) {
  const p = db.prepare('SELECT * FROM part_photos WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'Photo not found');
  fs.rmSync(path.join(DIR, p.stored), { force: true });
  db.prepare('DELETE FROM part_photos WHERE id = ?').run(p.id);
  return { ok: true };
}

export function photoFile(id) {
  const p = db.prepare('SELECT * FROM part_photos WHERE id = ?').get(Number(id));
  const full = p && path.join(DIR, p.stored);
  if (!p || !full.startsWith(DIR) || !fs.existsSync(full)) throw new HttpError(404, 'Photo not found');
  return { full, mime: p.mime };
}
