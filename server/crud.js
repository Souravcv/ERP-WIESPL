import { db, audit, tx, getSettings } from './db.js';
import { ENTITIES } from '../public/js/schema.js';
import { beforeSave, afterSave } from './hooks.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toLocaleString('sv-SE').slice(0, 19);
const sub = (sql, alias) => sql.replaceAll('{t}', alias);

export function entityOr404(name) {
  const ent = ENTITIES[name];
  if (!ent) throw new HttpError(404, `Unknown module: ${name}`);
  return ent;
}

function selectSql(name) {
  const ent = ENTITIES[name];
  const cols = ['t.*'];
  const joins = [];
  ent.fields.forEach((f, i) => {
    if (f.computed) cols.push(`${sub(f.computed, 't')} AS ${f.key}`);
    if (f.type === 'ref' && !f.computed) {
      const a = `r${i}`;
      cols.push(`${sub(ENTITIES[f.ref].display, a)} AS ${f.key}_label`);
      joins.push(`LEFT JOIN ${f.ref} ${a} ON ${a}.id = t.${f.key}`);
    }
  });
  return `SELECT ${cols.join(', ')} FROM ${name} t ${joins.join(' ')}`;
}

function decode(name, row) {
  if (!row) return row;
  for (const f of ENTITIES[name].fields) {
    if ((f.type === 'json' || f.type === 'lines') && typeof row[f.key] === 'string') {
      try { row[f.key] = JSON.parse(row[f.key]); } catch { row[f.key] = f.type === 'lines' ? [] : {}; }
    }
  }
  return row;
}

export function listRows(name, query = {}) {
  const ent = entityOr404(name);
  const where = [], params = [];
  if (query.q) {
    const like = `%${String(query.q).trim()}%`;
    where.push('(' + ent.search.map(k => `t.${k} LIKE ?`).join(' OR ') + ')');
    ent.search.forEach(() => params.push(like));
  }
  // Exact filters on stored fields, e.g. ?status=Open&enquiry_id=4
  for (const f of ent.fields) {
    if (f.computed || query[f.key] === undefined || query[f.key] === '') continue;
    where.push(`t.${f.key} = ?`);
    params.push(query[f.key]);
  }
  if (query.from) { where.push('t.date >= ?'); params.push(query.from); }
  if (query.to) { where.push('t.date <= ?'); params.push(query.to); }
  const hasDate = ent.fields.some(f => f.key === 'date');
  const limit = Math.min(parseInt(query.limit) || 5000, 20000);
  const sql = `${selectSql(name)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${hasDate ? 't.date DESC, ' : ''}t.id DESC LIMIT ${limit}`;
  const rows = db.prepare(sql).all(...params).map(r => decode(name, r));
  if (!query.full) {
    // Big JSON blobs (quotation data) are not needed in lists.
    for (const r of rows) for (const f of ent.fields) if (f.type === 'json') delete r[f.key];
  }
  return rows;
}

export function getRow(name, id) {
  entityOr404(name);
  const row = db.prepare(`${selectSql(name)} WHERE t.id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Record not found');
  return decode(name, row);
}

export function options(name, q) {
  const ent = entityOr404(name);
  const disp = sub(ent.display, 't');
  const rows = q
    ? db.prepare(`SELECT t.id, ${disp} AS label FROM ${name} t WHERE ${disp} LIKE ? ORDER BY t.id DESC LIMIT 500`).all(`%${q}%`)
    : db.prepare(`SELECT t.id, ${disp} AS label FROM ${name} t ORDER BY t.id DESC LIMIT 2000`).all();
  return rows;
}

function coerce(f, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return f.type === 'lines' ? '[]' : null;
  switch (f.type) {
    case 'number': case 'money': {
      const n = Number(String(v).replace(/,/g, ''));
      if (!Number.isFinite(n)) throw new HttpError(400, `${f.label} must be a number`);
      return n;
    }
    case 'ref': {
      const n = Number(v);
      if (!Number.isInteger(n)) throw new HttpError(400, `${f.label} is invalid`);
      return n;
    }
    case 'yn': return v === true || v === 'Yes' ? 'Yes' : v === false || v === 'No' ? 'No' : null;
    case 'json': case 'lines': return typeof v === 'string' ? v : JSON.stringify(v);
    case 'date': {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${f.label} must be a date`);
      return s;
    }
    default: return String(v);
  }
}

// Keep only known, writable fields. `system` writes (hooks/workflows) may set read-only fields.
function clean(name, data, { system = false } = {}) {
  const out = {};
  for (const f of ENTITIES[name].fields) {
    if (f.computed) continue;
    if (f.readonly && !system) continue;
    if (!(f.key in data)) continue;
    out[f.key] = coerce(f, data[f.key]);
  }
  return out;
}

export function insertRow(name, data, user, opts = {}) {
  entityOr404(name);
  // One transaction, so a failed validation does not consume a document number.
  return tx(() => insertRowTx(name, data, user, opts));
}

function insertRowTx(name, data, user, opts) {
  let row = clean(name, data, opts);
  for (const f of ENTITIES[name].fields) {
    if (f.computed || f.default === undefined || (row[f.key] !== undefined && row[f.key] !== null)) continue;
    row[f.key] = f.default === 'today' ? now().slice(0, 10)
      : f.default === 'me' ? (user?.name || null)
      : String(f.default).startsWith('setting:') ? coerce(f, getSettings()[f.default.slice(8)] ?? null)
      : coerce(f, f.default);
  }
  row = beforeSave(name, row, null, user) || row;
  for (const f of ENTITIES[name].fields) {
    if (f.required && !f.readonly && (row[f.key] === null || row[f.key] === undefined || row[f.key] === '')) {
      throw new HttpError(400, `${f.label} is required`);
    }
  }
  row.created_by = user?.name || 'system';
  row.created_at = now();
  const keys = Object.keys(row).filter(k => row[k] !== undefined);
  const info = db.prepare(`INSERT INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map(k => row[k]));
  const id = Number(info.lastInsertRowid);
  afterSave(name, id, user);
  audit(user?.name, name, id, 'create', ENTITIES[name].singular);
  return getRow(name, id);
}

export function updateRow(name, id, data, user, opts = {}) {
  entityOr404(name);
  return tx(() => updateRowTx(name, id, data, user, opts));
}

function updateRowTx(name, id, data, user, opts) {
  const existing = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(Number(id));
  if (!existing) throw new HttpError(404, 'Record not found');
  let row = clean(name, data, opts);
  // Required fields must not be blanked on update either.
  for (const f of ENTITIES[name].fields) {
    if (f.required && f.key in row && (row[f.key] === null || row[f.key] === '')) throw new HttpError(400, `${f.label} is required`);
  }
  row = beforeSave(name, row, existing, user) || row;
  row.updated_at = now();
  const keys = Object.keys(row).filter(k => row[k] !== undefined);
  db.prepare(`UPDATE ${name} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => row[k]), Number(id));
  afterSave(name, Number(id), user);
  const changed = keys.filter(k => k !== 'updated_at' && String(existing[k] ?? '') !== String(row[k] ?? ''));
  if (changed.length) audit(user?.name, name, Number(id), 'update', changed.join(', '));
  return getRow(name, id);
}

// Lines that belong to a document and go with it when it is deleted.
const CHILDREN = { boqs: ['boq_items', 'boq_id'], boms: ['bom_items', 'bom_id'] };
const APPROVAL_DOC = { quotations: 'Quotation', purchase_orders: 'Purchase Order', requisitions: 'Requisition' };
const lineRefCount = (key, ids) => ids.length ? db.prepare(`SELECT
    (SELECT COUNT(*) FROM challans c, json_each(c.lines) j WHERE c.status <> 'Cancelled' AND CAST(json_extract(j.value, '$.${key}') AS INTEGER) IN (${ids.join(',')}))
  + (SELECT COUNT(*) FROM purchase_orders c, json_each(c.lines) j WHERE c.status <> 'Cancelled' AND CAST(json_extract(j.value, '$.${key}') AS INTEGER) IN (${ids.join(',')}))
  + (SELECT COUNT(*) FROM requisitions c, json_each(c.lines) j WHERE c.status NOT IN ('Rejected', 'Closed') AND CAST(json_extract(j.value, '$.${key}') AS INTEGER) IN (${ids.join(',')})) n`).get().n : 0;

export function deleteRow(name, id, user) {
  const ent0 = entityOr404(name);
  const existing = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(Number(id));
  if (!existing) throw new HttpError(404, 'Record not found');
  const child = CHILDREN[name];
  if ((name === 'bom_items' || name === 'boq_items') && lineRefCount(name === 'bom_items' ? 'bom_item_id' : 'boq_item_id', [Number(id)])) {
    throw new HttpError(409, 'Cannot delete: this line is already on a challan, requisition or PO');
  }
  // Refuse to orphan linked records; say which ones, so they can be dealt with first.
  for (const [other, ent] of Object.entries(ENTITIES)) {
    if (child && other === child[0]) continue;
    for (const f of ent.fields.filter(f => f.type === 'ref' && f.ref === name)) {
      const rows = db.prepare(`SELECT ${ENTITIES[other].display.replaceAll('{t}', 't')} AS label FROM ${other} t WHERE t.${f.key} = ? LIMIT 6`).all(Number(id));
      if (rows.length) throw new HttpError(409, `Cannot delete: linked ${ent.label}: ${rows.map(r => r.label).join(', ')}${rows.length > 5 ? ' …' : ''}. Delete or change those first.`);
    }
  }
  tx(() => {
    if (child) {
      const ids = db.prepare(`SELECT id FROM ${child[0]} WHERE ${child[1]} = ?`).all(Number(id)).map(r => r.id);
      if (lineRefCount(name === 'boms' ? 'bom_item_id' : 'boq_item_id', ids)) throw new HttpError(409, `Cannot delete: material of this ${ent0.singular} is on challans, requisitions or POs`);
      db.prepare(`DELETE FROM ${child[0]} WHERE ${child[1]} = ?`).run(Number(id));
    }
    // A dispatched challan takes the store issue it made with it (stock comes back).
    let undone = 0;
    if (name === 'challans' && ['Dispatched', 'Delivered'].includes(existing.status)) {
      undone = db.prepare("DELETE FROM stock_moves WHERE type = 'OUTWARD' AND doc_no = ? AND purpose LIKE 'Delivery challan%'").run(existing.challan_no).changes;
    }
    if (APPROVAL_DOC[name]) db.prepare('DELETE FROM approvals WHERE doc_type = ? AND doc_id = ?').run(APPROVAL_DOC[name], Number(id));
    db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(Number(id));
    afterSave(name, null, user, existing);
    const label = ['name', 'enquiry_no', 'quote_no', 'so_no', 'po_no', 'req_no', 'challan_no', 'bom_no', 'boq_no', 'invoice_no', 'ticket_no', 'code', 'submittal_no', 'doc_no'].map(k => existing[k]).find(Boolean);
    audit(user?.name, name, Number(id), 'delete', `${label || ''}${existing.status ? ` (${existing.status})` : ''}${undone ? ` – ${undone} stock issue line(s) reversed` : ''}`);
  });
  return existing;
}

// Full access may delete anything; others may delete their own drafts (e.g. a requisition saved twice by mistake).
export function canRemove(name, row, user, canDeleteFn) {
  if (canDeleteFn) return true;
  return !!row && row.created_by === user.name && ['Draft', 'Rejected'].includes(row.status);
}
