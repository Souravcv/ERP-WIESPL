// Company stamp and personal signatures, printed on documents only where an approval has been given.
// Kept in the data folder (never in public/) and served only to logged-in users, so they cannot be downloaded from outside.
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, getSettings, setSettings, audit } from './db.js';
import { HttpError } from './crud.js';

const DIR = path.join(DATA_DIR, 'uploads', 'brand');
const STAMP = path.join(DIR, 'stamp.png');
const sigFile = id => path.join(DIR, `signature-${Number(id)}.png`);

export function migrateSignatures() {
  db.exec(`CREATE TABLE IF NOT EXISTS user_signatures (
    user_id INTEGER PRIMARY KEY, updated_at TEXT DEFAULT (datetime('now','localtime')), updated_by TEXT)`);
}

// PNG or JPEG only, up to 2 MB (the browser sends a cleaned-up PNG)
function checkImage(buf) {
  if (!buf?.length) throw new HttpError(400, 'The image is empty');
  if (buf.length > 2 * 1048576) throw new HttpError(400, 'The image must be smaller than 2 MB');
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!png && !jpg) throw new HttpError(400, 'Use a PNG or JPG image');
}

export function stampFile() {
  if (!fs.existsSync(STAMP)) throw new HttpError(404, 'No company stamp uploaded');
  return STAMP;
}
export function saveStamp(buf, user) {
  checkImage(buf);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(STAMP, buf);
  setSettings({ stamp_version: String(Date.now()) });
  audit(user.name, 'settings', null, 'stamp', 'Company stamp uploaded');
  return { ok: true };
}
export function removeStamp(user) {
  fs.rmSync(STAMP, { force: true });
  setSettings({ stamp_version: '' });
  audit(user.name, 'settings', null, 'stamp', 'Company stamp removed');
  return { ok: true };
}

// who has a signature: [{ user_id, name, v }] (v changes when it is replaced, so prints never show an old one)
export const listSignatures = () => db.prepare(`SELECT s.user_id, u.name, u.username, s.updated_at AS v FROM user_signatures s JOIN users u ON u.id = s.user_id ORDER BY u.name`).all();

export function signatureFile(id) {
  const f = sigFile(id);
  if (!fs.existsSync(f)) throw new HttpError(404, 'No signature');
  return f;
}
// your own signature; an admin may also set one for a person who does not use the CRM (written to the activity log)
export function saveSignature(userId, buf, user) {
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(Number(userId));
  if (!target) throw new HttpError(404, 'User not found');
  if (target.id !== user.id && user.role !== 'admin') throw new HttpError(403, 'You can only set your own signature');
  checkImage(buf);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(sigFile(target.id), buf);
  db.prepare("INSERT INTO user_signatures (user_id, updated_at, updated_by) VALUES (?, datetime('now','localtime'), ?) ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at, updated_by = excluded.updated_by").run(target.id, user.name);
  audit(user.name, 'users', target.id, 'signature', target.id === user.id ? 'Own signature saved' : `Signature of ${target.name} saved by ${user.name}`);
  return { ok: true };
}
export function removeSignature(userId, user) {
  const id = Number(userId);
  if (id !== user.id && user.role !== 'admin') throw new HttpError(403, 'You can only remove your own signature');
  fs.rmSync(sigFile(id), { force: true });
  db.prepare('DELETE FROM user_signatures WHERE user_id = ?').run(id);
  audit(user.name, 'users', id, 'signature', 'Signature removed');
  return { ok: true };
}
export const stampVersion = () => getSettings().stamp_version || '';
