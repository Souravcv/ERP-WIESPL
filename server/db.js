import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITIES } from '../public/js/schema.js';
import { fyOf } from '../public/js/calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.WIESPL_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_FILE = path.join(DATA_DIR, 'wiespl.db');
export const RESTORE_FILE = path.join(DATA_DIR, 'restore-pending.db');

// A backup uploaded through Admin → Backup & Restore is swapped in here, before the database opens.
// The database it replaces is kept in data/backups/.
if (fs.existsSync(RESTORE_FILE)) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (fs.existsSync(DB_FILE)) fs.renameSync(DB_FILE, path.join(dir, `before-restore-${stamp}.db`));
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(DB_FILE + ext)) fs.rmSync(DB_FILE + ext);
  fs.renameSync(RESTORE_FILE, DB_FILE);
  console.log(`\n  Backup restored. The previous database was saved in ${dir}\n`);
}

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SQL_TYPE = { number: 'REAL', money: 'REAL', ref: 'INTEGER' };

function columnsOf(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      email TEXT, phone TEXT, pass_hash TEXT NOT NULL, must_change INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS counters (name TEXT NOT NULL, fy TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (name, fy));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now','localtime')), user TEXT, entity TEXT, record_id INTEGER,
      action TEXT, summary TEXT);
  `);
  for (const [name, ent] of Object.entries(ENTITIES)) {
    const stored = ent.fields.filter(f => !f.computed);
    db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id INTEGER PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT, created_by TEXT)`);
    const have = columnsOf(name);
    for (const f of stored) {
      if (!have.has(f.key)) db.exec(`ALTER TABLE ${name} ADD COLUMN ${f.key} ${SQL_TYPE[f.type] || 'TEXT'}`);
    }
    for (const f of stored.filter(f => f.type === 'ref' || f.key === 'status' || f.key === 'date')) {
      db.exec(`CREATE INDEX IF NOT EXISTS ix_${name}_${f.key} ON ${name}(${f.key})`);
    }
  }
  // Stock: older versions used IN / OUT; the store module now uses the Smart Store movement types.
  db.exec(`
    UPDATE stock_moves SET type = 'INWARD' WHERE type = 'IN';
    UPDATE stock_moves SET type = 'OUTWARD' WHERE type = 'OUT';
    CREATE INDEX IF NOT EXISTS ix_stock_item_date ON stock_moves(item_id, type, date);
    CREATE INDEX IF NOT EXISTS ix_stock_doc ON stock_moves(type, doc_no);
    CREATE INDEX IF NOT EXISTS ix_items_code ON items(code);
    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT, perms TEXT, builtin INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY, entity TEXT NOT NULL, record_id INTEGER NOT NULL, filename TEXT NOT NULL, mime TEXT, size INTEGER,
      stored TEXT NOT NULL, note TEXT, uploaded_by TEXT, at TEXT DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS ix_attach_rec ON attachments(entity, record_id);
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now','localtime')), user TEXT, kind TEXT, file_hash TEXT, summary TEXT);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, at TEXT DEFAULT (datetime('now','localtime')),
      kind TEXT, title TEXT NOT NULL, body TEXT, link TEXT, by_user TEXT, read_at TEXT);
    CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, id);
    CREATE INDEX IF NOT EXISTS ix_bom_items_bom ON bom_items(bom_id, sort);
    CREATE TABLE IF NOT EXISTS web_leads (
      id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')),
      step INTEGER, data TEXT, name TEXT, phone TEXT, ip TEXT, enquiry_id INTEGER, submitted_at TEXT);
  `);
  // Client work orders were called "BOQ" before the BOQ / bill of material module existed: BOQ-001/2026-27 → WO-001/2026-27.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migrated_wo_numbers'").get()) {
    db.exec(`UPDATE boqs SET boq_no = 'WO-' || substr(boq_no, 5) WHERE boq_no LIKE 'BOQ-%';
      INSERT INTO settings (key, value) VALUES ('migrated_wo_numbers', '"1"')`);
  }
}

// Re-entrant: nested calls join the outer transaction.
let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth--; }
}

// Next running number for a document series within the financial year of `date`.
export function nextSeq(name, date) {
  const fy = fyOf(date);
  const row = db.prepare('SELECT seq FROM counters WHERE name = ? AND fy = ?').get(name, fy);
  const seq = (row?.seq || 0) + 1;
  db.prepare('INSERT INTO counters (name, fy, seq) VALUES (?, ?, ?) ON CONFLICT(name, fy) DO UPDATE SET seq = excluded.seq').run(name, fy, seq);
  return { seq, fy };
}

export function bumpSeq(name, fy, seq) {
  db.prepare('INSERT INTO counters (name, fy, seq) VALUES (?, ?, ?) ON CONFLICT(name, fy) DO UPDATE SET seq = MAX(seq, excluded.seq)').run(name, fy, seq);
}

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export function setSettings(obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) st.run(k, JSON.stringify(v));
}

export function audit(user, entity, recordId, action, summary = '') {
  db.prepare('INSERT INTO audit (user, entity, record_id, action, summary) VALUES (?, ?, ?, ?, ?)')
    .run(user || 'system', entity, recordId ?? null, action, String(summary).slice(0, 500));
}
