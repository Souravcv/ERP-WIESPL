// Roles & permissions (stored in the database, editable by the admin) and file attachments.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, audit, DATA_DIR } from './db.js';
import { HttpError } from './crud.js';
import { ROLE_INFO, ENTITIES, FUNCTIONS, ACCESS_LEVELS, DEFAULT_FUNCTIONS, defaultPermissions, setPermissions } from '../public/js/schema.js';

const parse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Keep only known modules / levels / functions.
function cleanPerms(p = {}) {
  const modules = {};
  for (const name of Object.keys(ENTITIES)) modules[name] = ACCESS_LEVELS[p.modules?.[name]] ? p.modules[name] : 'none';
  const functions = (p.functions || []).filter(f => FUNCTIONS[f]);
  return { modules, functions };
}

export function loadRoles() {
  const map = {};
  for (const r of db.prepare('SELECT name, perms FROM roles').all()) {
    const p = parse(r.perms);
    // Modules added in later versions get the built-in default for that role.
    const d = defaultPermissions(r.name);
    for (const m of Object.keys(ENTITIES)) if (!p.modules?.[m]) (p.modules ||= {})[m] = ROLE_INFO[r.name] ? d.modules[m] : 'none';
    map[r.name] = { modules: p.modules, functions: p.functions || [] };
  }
  setPermissions(map);
  return map;
}

export function seedRoles() {
  const ins = db.prepare('INSERT OR IGNORE INTO roles (name, label, description, perms, builtin) VALUES (?, ?, ?, ?, 1)');
  for (const [name, info] of Object.entries(ROLE_INFO)) ins.run(name, info.label, info.description, JSON.stringify(defaultPermissions(name)));
  // Pop-up notification switches arrived later: give the built-in roles their defaults once (admins can change them after).
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'roles_notify_v1'").get()) {
    for (const r of db.prepare('SELECT name, perms FROM roles WHERE builtin = 1').all()) {
      const p = parse(r.perms);
      const add = (DEFAULT_FUNCTIONS[r.name] || []).filter(fn => fn.startsWith('notify_') && !(p.functions || []).includes(fn));
      if (add.length) db.prepare('UPDATE roles SET perms = ? WHERE name = ?').run(JSON.stringify({ ...p, functions: [...(p.functions || []), ...add] }), r.name);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('roles_notify_v1', '\"1\"')").run();
  }
  // PO approval became Purchase Head check → GM → Commercial (prices, payment terms, due dates).
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'roles_po_flow_v2'").get()) {
    for (const [name, fn] of [['purchase_head', 'po_check'], ['accounts', 'po_commercial'], ['manager', 'po_check'], ['manager', 'po_commercial']]) {
      const r = db.prepare('SELECT perms FROM roles WHERE name = ?').get(name);
      if (!r) continue;
      const p = parse(r.perms);
      p.functions = [...new Set([...(p.functions || []).filter(f => f !== 'po_technical'), fn])];
      db.prepare('UPDATE roles SET perms = ? WHERE name = ?').run(JSON.stringify(p), name);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('roles_po_flow_v2', '\"1\"')").run();
  }
  // The store does not work in the CRM: hide CRM modules from the built-in Store role once.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'roles_store_crm_v1'").get()) {
    const r = db.prepare("SELECT perms FROM roles WHERE name = 'store'").get();
    if (r) {
      const p = parse(r.perms);
      p.modules ||= {};
      for (const [k, e] of Object.entries(ENTITIES)) if (e.group === 'CRM') p.modules[k] = 'none';
      db.prepare("UPDATE roles SET perms = ? WHERE name = 'store'").run(JSON.stringify(p));
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('roles_store_crm_v1', '\"1\"')").run();
  }
  loadRoles();
}

export const roleExists = name => !!db.prepare('SELECT 1 FROM roles WHERE name = ?').get(name);

export function listRoles() {
  const counts = Object.fromEntries(db.prepare('SELECT role, COUNT(*) n FROM users WHERE active = 1 GROUP BY role').all().map(r => [r.role, r.n]));
  const perms = loadRoles();
  return db.prepare('SELECT name, label, description, builtin FROM roles ORDER BY builtin DESC, label').all()
    .map(r => ({ ...r, builtin: !!r.builtin, users: counts[r.name] || 0, perms: r.name === 'admin' ? null : perms[r.name] }));
}

export function saveRole(name, body, user) {
  const label = String(body?.label || '').trim();
  if (!label) throw new HttpError(400, 'Give the role a name');
  const description = String(body?.description || '').trim() || null;
  const perms = cleanPerms(body?.perms);
  if (name) {
    if (!roleExists(name)) throw new HttpError(404, 'Role not found');
    if (name === 'admin') { db.prepare('UPDATE roles SET label = ?, description = ? WHERE name = ?').run(label, description, name); }
    else db.prepare("UPDATE roles SET label = ?, description = ?, perms = ?, updated_at = datetime('now','localtime') WHERE name = ?").run(label, description, JSON.stringify(perms), name);
    audit(user.name, 'roles', null, 'update', name);
  } else {
    let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'role';
    for (let i = 2; roleExists(slug); i++) slug = `${slug.replace(/_\d+$/, '')}_${i}`;
    db.prepare('INSERT INTO roles (name, label, description, perms, builtin) VALUES (?, ?, ?, ?, 0)').run(slug, label, description, JSON.stringify(perms));
    audit(user.name, 'roles', null, 'create', slug);
    name = slug;
  }
  loadRoles();
  return listRoles().find(r => r.name === name);
}

export function deleteRole(name, user) {
  if (name === 'admin') throw new HttpError(400, 'The Administrator role cannot be deleted');
  const n = db.prepare('SELECT COUNT(*) n FROM users WHERE role = ?').get(name).n;
  if (n) throw new HttpError(409, `${n} user(s) still have this role. Give them another role first.`);
  db.prepare('DELETE FROM roles WHERE name = ?').run(name);
  audit(user.name, 'roles', null, 'delete', name);
  loadRoles();
}

// ---------------------------------------------------------------- attachments (work orders, drawings, CAD, PDFs …)
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const safeName = s => String(s || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150);

export function listAttachments(entity, recordId) {
  return db.prepare('SELECT id, filename, mime, size, note, uploaded_by, at FROM attachments WHERE entity = ? AND record_id = ? ORDER BY id DESC').all(entity, Number(recordId));
}

export function saveAttachment(entity, recordId, { filename, mime, note }, buf, user) {
  if (!ENTITIES[entity]) throw new HttpError(404, 'Unknown module');
  if (!db.prepare(`SELECT 1 FROM ${entity} WHERE id = ?`).get(Number(recordId))) throw new HttpError(404, 'Record not found');
  if (!buf?.length) throw new HttpError(400, 'The file is empty');
  const name = safeName(filename);
  const dir = path.join(UPLOAD_DIR, entity);
  fs.mkdirSync(dir, { recursive: true });
  const stored = path.join(entity, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`);
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  const id = Number(db.prepare('INSERT INTO attachments (entity, record_id, filename, mime, size, stored, note, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(entity, Number(recordId), name, mime || 'application/octet-stream', buf.length, stored, note || null, user.name).lastInsertRowid);
  audit(user.name, entity, Number(recordId), 'attach', name);
  return { id, filename: name, size: buf.length };
}

export function attachmentFile(id) {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(id));
  if (!a) throw new HttpError(404, 'File not found');
  const full = path.join(UPLOAD_DIR, a.stored);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) throw new HttpError(404, 'The file is missing from the server');
  return { ...a, full };
}

// Files of a record that was deleted.
export function removeAttachmentsOf(entity, recordId) {
  for (const a of db.prepare('SELECT id, stored FROM attachments WHERE entity = ? AND record_id = ?').all(entity, Number(recordId))) {
    fs.rmSync(path.join(UPLOAD_DIR, a.stored), { force: true });
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  }
}

export function deleteAttachment(id, user, canDeleteAny) {
  const a = attachmentFile(id);
  if (a.uploaded_by !== user.name && !canDeleteAny) throw new HttpError(403, 'Only the person who uploaded it (or a manager) can remove this file');
  fs.rmSync(a.full, { force: true });
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  audit(user.name, a.entity, a.record_id, 'remove file', a.filename);
}
