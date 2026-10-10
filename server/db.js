import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITIES } from '../public/js/schema.js';
import { fyOf } from '../public/js/calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.WIESPL_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'wiespl.db'));
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
