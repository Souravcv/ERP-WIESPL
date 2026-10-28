// Lot-wise stores (WIESPL Stores policy): every receipt is a lot — a GRN line (with the supplier's batch no, rack and
// IQC status), a return, production or the opening stock. Every issue, transfer and scrap takes from the oldest lot
// first (FIFO), so each lot shows which projects used it until it is exhausted, and consumption is valued at the rate of
// the lots it came from (for the project-wise entry in Tally). The allocation is worked out again for an item whenever
// its movements change, so back-dated, edited, deleted or imported entries are always in step.
import { db, tx, audit } from './db.js';
import { getRow, updateRow, HttpError } from './crud.js';
import { hasFunction, canView } from '../public/js/schema.js';
import { round2 } from '../public/js/calc.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const now = () => new Date().toLocaleString('sv-SE').slice(0, 19);
const IN_TYPES = ['INWARD', 'RETURN', 'PRODUCED'];
const OUT_TYPES = ['OUTWARD', 'TRANSFER', 'SCRAP'];
export const QC = ['Pending', 'Accepted', 'Partly accepted', 'Rejected', 'Hold'];

export function setupLots() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_lots (item_id INTEGER NOT NULL, lot_id INTEGER NOT NULL, qty REAL, rejected REAL, issued REAL, balance REAL,
      superseded INTEGER DEFAULT 0, PRIMARY KEY (item_id, lot_id));
    CREATE TABLE IF NOT EXISTS lot_allocations (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, out_id INTEGER NOT NULL, lot_id INTEGER, qty REAL);
    CREATE INDEX IF NOT EXISTS ix_lot_alloc_out ON lot_allocations(out_id);
    CREATE INDEX IF NOT EXISTS ix_lot_alloc_lot ON lot_allocations(lot_id);
    CREATE INDEX IF NOT EXISTS ix_lot_alloc_item ON lot_allocations(item_id);
    CREATE TABLE IF NOT EXISTS lot_sig (item_id INTEGER PRIMARY KEY, sig TEXT);`);
}

// A fingerprint of an item's movements: when it changes, its lots are worked out again.
const SIG = `COUNT(*) || ':' || MAX(id) || ':' || ROUND(SUM(qty), 4) || ':' || COALESCE(MAX(updated_at), '') || ':' || ROUND(SUM(COALESCE(qc_rejected, 0)), 4)
  || ':' || SUM(CASE WHEN qc_status = 'Hold' THEN id ELSE 0 END) || ':' || SUM(CAST(replace(date, '-', '') AS INTEGER) % 9973)`;

function rebuild(itemId) {
  const it = db.prepare('SELECT id, opening_stock FROM items WHERE id = ?').get(itemId);
  db.prepare('DELETE FROM stock_lots WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM lot_allocations WHERE item_id = ?').run(itemId);
  if (!it) return;
  const moves = db.prepare(`SELECT id, type, date, qty, qc_status, qc_rejected FROM stock_moves WHERE item_id = ?
    ORDER BY date, CASE WHEN type = 'OPENING' THEN 0 WHEN type IN ('INWARD', 'RETURN', 'PRODUCED') OR (type = 'ADJUST' AND qty >= 0) THEN 1 ELSE 2 END, id`).all(itemId);
  const lots = [];
  const hasOpening = moves.some(m => m.type === 'OPENING');
  if (!hasOpening && Number(it.opening_stock) > 0) lots.push({ lot_id: 0, qty: Number(it.opening_stock), rejected: 0, issued: 0, hold: false });
  const allocs = [];
  for (const m of moves) {
    const q = Number(m.qty) || 0;
    if (m.type === 'OPENING') {
      // A 1 April opening stock sets the stock: the lots before it are closed.
      for (const l of lots) l.superseded = 1;
      lots.push({ lot_id: m.id, qty: q, rejected: 0, issued: 0, hold: false });
    } else if (IN_TYPES.includes(m.type) || (m.type === 'ADJUST' && q >= 0)) {
      if (q > 0) lots.push({ lot_id: m.id, qty: q, rejected: Math.min(q, Number(m.qc_rejected) || 0), issued: 0, hold: m.qc_status === 'Hold' });
    } else if (OUT_TYPES.includes(m.type) || (m.type === 'ADJUST' && q < 0)) {
      let need = Math.abs(q);
      for (const l of lots) {
        if (need <= 1e-9) break;
        if (l.superseded || l.hold) continue;
        const free = l.qty - l.rejected - l.issued;
        if (free <= 1e-9) continue;
        const take = Math.min(free, need);
        l.issued += take; need -= take;
        allocs.push([m.id, l.lot_id, round2(take)]);
      }
      if (need > 1e-9) allocs.push([m.id, null, round2(need)]); // more issued than the lots hold
    }
  }
  const insL = db.prepare('INSERT INTO stock_lots (item_id, lot_id, qty, rejected, issued, balance, superseded) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const l of lots) insL.run(itemId, l.lot_id, round2(l.qty), round2(l.rejected), round2(l.issued), l.superseded ? 0 : round2(l.qty - l.rejected - l.issued), l.superseded ? 1 : 0);
  const insA = db.prepare('INSERT INTO lot_allocations (item_id, out_id, lot_id, qty) VALUES (?, ?, ?, ?)');
  for (const a of allocs) insA.run(itemId, ...a);
}

// Bring the lots of every item (or the given ones) up to date with their movements.
export function ensureLots(itemIds = null) {
  const where = itemIds ? `WHERE item_id IN (${itemIds.map(Number).filter(Boolean).join(',') || 0})` : '';
  const sigs = db.prepare(`SELECT item_id, ${SIG} sig FROM stock_moves ${where} GROUP BY item_id`).all();
  const known = new Map(db.prepare('SELECT item_id, sig FROM lot_sig').all().map(r => [r.item_id, r.sig]));
  const stale = sigs.filter(s => known.get(s.item_id) !== s.sig);
  if (!stale.length) return 0;
  tx(() => {
    const up = db.prepare('INSERT INTO lot_sig (item_id, sig) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET sig = excluded.sig');
    for (const s of stale) { rebuild(s.item_id); up.run(s.item_id, s.sig); }
  });
  return stale.length;
}

const lotLabel = r => r.lot_id === 0 ? 'Opening stock (old)' : `${r.type === 'INWARD' ? 'GRN' : r.type === 'OPENING' ? 'Opening' : r.type === 'RETURN' ? 'Return' : r.type === 'PRODUCED' ? 'Production' : r.type} ${r.doc_no || '#' + r.lot_id}${r.batch_no ? ' · batch ' + r.batch_no : ''}`;
const statusOf = (r, low) => r.superseded ? 'CLOSED (1 April opening)' : r.balance <= 0.0001 ? 'EXHAUSTED' : r.qc_status === 'Hold' ? 'HOLD'
  : r.qc_status === 'Pending' ? 'IQC PENDING' : low ? 'LOW STOCK' : 'ACTIVE';

// 1. Material inward register (lot-wise) with what is left of each lot.
export function lotRegister(q = {}) {
  ensureLots();
  const where = ['1 = 1'], args = [];
  if (q.from) { where.push("COALESCE(m.date, '0000') >= ?"); args.push(q.from); }
  if (q.to) { where.push("COALESCE(m.date, '0000') <= ?"); args.push(q.to); }
  if (q.item) { where.push('l.item_id = ?'); args.push(Number(q.item)); }
  if (q.q) { where.push('(i.name LIKE ? OR i.code LIKE ? OR m.doc_no LIKE ? OR m.batch_no LIKE ? OR m.po_no LIKE ? OR v.name LIKE ? OR m.supplier LIKE ?)'); args.push(...Array(7).fill(`%${q.q}%`)); }
  const rows = db.prepare(`SELECT l.*, m.type, m.date, m.doc_no, m.po_no, m.batch_no, COALESCE(m.rack, i.location) rack, m.qc_status, m.rate, m.invoice_no, COALESCE(v.name, m.supplier) vendor,
      i.code, i.name item, i.uom, i.reorder_level, (SELECT SUM(balance) FROM stock_lots x WHERE x.item_id = l.item_id) item_balance
    FROM stock_lots l JOIN items i ON i.id = l.item_id LEFT JOIN stock_moves m ON m.id = l.lot_id LEFT JOIN vendors v ON v.id = m.vendor_id
    WHERE ${where.join(' AND ')} ORDER BY COALESCE(m.date, '0000') DESC, l.lot_id DESC LIMIT ?`).all(...args, Math.min(Number(q.limit) || 10000, 20000));
  const out = rows.map(r => ({ ...r, lot: lotLabel(r), value: round2((r.qty || 0) * (r.rate || 0)), balance_value: round2((r.balance || 0) * (r.rate || 0)),
    status: statusOf(r, r.reorder_level > 0 && r.item_balance <= r.reorder_level) }));
  return q.status ? out.filter(r => r.status === q.status) : out;
}

// 2. One lot from receipt to exhaustion: every issue, the project, and the balance after it.
export function lotTrail(lotId, itemId) {
  ensureLots([itemId]);
  const lot = db.prepare(`SELECT l.*, m.type, m.date, m.doc_no, m.po_no, m.batch_no, COALESCE(m.rack, i.location) rack, m.qc_status, m.qc_rejected, m.qc_by, m.qc_at, m.qc_remarks, m.rate,
      COALESCE(v.name, m.supplier) vendor, m.invoice_no, i.code, i.name item, i.uom FROM stock_lots l JOIN items i ON i.id = l.item_id LEFT JOIN stock_moves m ON m.id = l.lot_id
      LEFT JOIN vendors v ON v.id = m.vendor_id WHERE l.lot_id = ? AND l.item_id = ?`).get(Number(lotId), Number(itemId));
  if (!lot) throw new HttpError(404, 'Lot not found');
  const uses = db.prepare(`SELECT a.qty, o.id, o.type, o.date, o.doc_no, o.issued_to, o.to_location, o.requested_by, o.purpose, o.reason, p.name project, COALESCE(p.project_no, p.code) project_no
    FROM lot_allocations a JOIN stock_moves o ON o.id = a.out_id LEFT JOIN projects p ON p.id = o.project_id
    WHERE a.lot_id IS ? AND a.item_id = ? ORDER BY o.date, o.id`).all(Number(lotId) || 0, Number(itemId));
  let bal = round2((lot.qty || 0) - (lot.rejected || 0));
  return { lot: { ...lot, lot: lotLabel(lot) }, uses: uses.map(u => ({ ...u, balance: (bal = round2(bal - u.qty)) })) };
}

// 3. Project-wise consumption (issues, transfers, scrap) valued at the rate of the lots it came from (FIFO).
export function projectConsumption(q = {}) {
  ensureLots();
  const where = ["o.type IN ('OUTWARD', 'TRANSFER', 'SCRAP')"], args = [];
  if (q.from) { where.push('o.date >= ?'); args.push(q.from); }
  if (q.to) { where.push('o.date <= ?'); args.push(q.to); }
  if (q.project) { where.push('o.project_id = ?'); args.push(Number(q.project)); }
  const rows = db.prepare(`SELECT o.date, o.type, o.doc_no, o.project_id, COALESCE(p.project_no, p.code) project_no, p.name project, o.issued_to, i.code, i.name item, i.uom,
      a.qty, a.lot_id, lm.doc_no lot_doc, lm.type lot_type, lm.batch_no, COALESCE(lm.rate, i.rate, 0) rate
    FROM lot_allocations a JOIN stock_moves o ON o.id = a.out_id JOIN items i ON i.id = a.item_id LEFT JOIN projects p ON p.id = o.project_id
    LEFT JOIN stock_moves lm ON lm.id = a.lot_id WHERE ${where.join(' AND ')} ORDER BY o.date, o.id`).all(...args);
  return rows.map(r => ({ ...r, lot: r.lot_id == null ? 'not in any lot (issued beyond stock)' : r.lot_id === 0 ? 'Opening stock (old)' : `${r.lot_type === 'INWARD' ? 'GRN' : r.lot_type} ${r.lot_doc || ''}${r.batch_no ? ' · batch ' + r.batch_no : ''}`,
    value: round2(r.qty * r.rate), scrap: r.type === 'SCRAP' }));
}

// Lots an issue slip / transfer took its material from (printed on the slip).
export function lotsForDoc(type, docNo) {
  const ids = db.prepare('SELECT id, item_id FROM stock_moves WHERE type = ? AND doc_no = ?').all(type, docNo);
  ensureLots([...new Set(ids.map(r => r.item_id))]);
  const out = {};
  for (const r of ids) out[r.id] = db.prepare(`SELECT a.qty, a.lot_id, lm.type, lm.doc_no, lm.batch_no FROM lot_allocations a LEFT JOIN stock_moves lm ON lm.id = a.lot_id WHERE a.out_id = ?`).all(r.id)
    .map(a => ({ qty: a.qty, lot: a.lot_id == null ? 'beyond stock' : a.lot_id === 0 ? 'opening' : `${a.type === 'INWARD' ? 'GRN' : a.type} ${a.doc_no || ''}${a.batch_no ? ' (' + a.batch_no + ')' : ''}` }));
  return out;
}

// ---------------------------------------------------------------- incoming inspection (IQC)
export function iqcPending() {
  return db.prepare(`SELECT m.id, m.date, m.doc_no, m.po_no, m.qty, m.uom, m.batch_no, COALESCE(m.rack, i.location) rack, m.qc_status, i.code, i.name item, i.uom item_uom,
      COALESCE(v.name, m.supplier) vendor, CAST(julianday('now', 'localtime') - julianday(m.date) AS INTEGER) age
    FROM stock_moves m JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id
    WHERE m.type = 'INWARD' AND m.qc_status IN ('Pending', 'Hold') ORDER BY m.date, m.id`).all();
}

// Record the inspection of GRN lines: accepted, partly accepted (with the rejected qty), rejected or on hold.
export function inspect(body, user) {
  if (!hasFunction(user.role, 'iqc_inspect')) throw new HttpError(403, 'Your login may not record incoming inspection (IQC)');
  const status = body?.status;
  if (!QC.includes(status) || status === 'Pending') throw new HttpError(400, 'Choose Accepted, Partly accepted, Rejected or Hold');
  const ids = (body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Choose the GRN lines');
  return tx(() => {
    for (const id of ids) {
      const m = getRow('stock_moves', id);
      if (m.type !== 'INWARD') throw new HttpError(400, 'Only GRN lines are inspected');
      const rejected = status === 'Rejected' ? Number(m.qty) : status === 'Partly accepted' ? Number(body.rejected?.[id] ?? body.rejected_qty) : 0;
      if (status === 'Partly accepted' && !(rejected > 0 && rejected < Number(m.qty))) throw new HttpError(400, `${m.item_id_label}: enter the rejected quantity (more than 0, less than ${m.qty})`);
      if (!String(body.remarks || '').trim() && ['Rejected', 'Partly accepted', 'Hold'].includes(status)) throw new HttpError(400, 'Write why (the defect / reason)');
      updateRow('stock_moves', id, { qc_status: status, qc_rejected: rejected || null, qc_by: user.name, qc_at: now(), qc_remarks: String(body.remarks || '').trim() || null }, user, { system: true });
    }
    audit(user.name, 'stock_moves', ids[0], `IQC ${status}`, `${ids.length} GRN line(s)`);
    return { done: ids.length };
  });
}

// ---------------------------------------------------------------- system health
// Checks that show where the data and the process are out of step (what an audit would find), each with a count, a
// few examples and where to fix it.
export function health(user) {
  if (!hasFunction(user.role, 'view_audit')) throw new HttpError(403, 'Only managers / admin see the system health page');
  ensureLots();
  const t = today();
  const c = (title, area, fix, sql, args = [], link = null) => {
    let rows = [];
    try { rows = db.prepare(sql).all(...args); } catch (e) { return { title, area, fix, count: -1, error: e.message, rows: [] }; }
    return { title, area, fix, link, count: rows.length, rows: rows.slice(0, 8) };
  };
  return { at: now(), checks: [
    c('GRN lines waiting for IQC more than 2 days', 'Quality', 'Store → Lots, IQC & FIFO → IQC pending',
      "SELECT m.doc_no || ' · ' || i.name || ' (' || m.date || ')' x FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.type = 'INWARD' AND m.qc_status = 'Pending' AND m.date < date(?, '-2 days')", [t], '#/lots?tab=iqc'),
    c('Items issued more than received (negative stock)', 'Stores', 'Stock Summary → Negative stock: record the missing GRN / opening stock, or correct the issue',
      "SELECT i.code || ' ' || i.name || ': −' || ROUND(SUM(a.qty), 2) x FROM lot_allocations a JOIN items i ON i.id = a.item_id WHERE a.lot_id IS NULL GROUP BY a.item_id ORDER BY SUM(a.qty) DESC", [], '#/stock-summary?only=negative'),
    c('GRN lines without a price', 'Stores / Accounts', 'Stock Movements → the GRN → Edit GRN',
      "SELECT doc_no || ' · ' || date x FROM stock_moves WHERE type = 'INWARD' AND (rate IS NULL OR rate = 0) AND doc_no NOT LIKE 'MTN%' GROUP BY doc_no, date", [], '#/stock-movements?type=INWARD'),
    c('GRNs after 24 Oct without a PO', 'Stores / Purchase', 'Stock Movements → GRNs without a PO → Attach PO',
      "SELECT doc_no || ' · ' || date x FROM stock_moves WHERE type = 'INWARD' AND po_id IS NULL AND import_batch IS NULL AND date >= '2026-10-24' GROUP BY doc_no, date", [], '#/stock-movements?type=INWARD&po=without'),
    c('POs where received ≠ GRNs', 'Purchase', 'Open the PO and its GRNs',
      `SELECT p.po_no x FROM purchase_orders p WHERE p.status NOT IN ('Archived (old)', 'Cancelled', 'Draft') AND ABS(COALESCE((SELECT SUM(COALESCE(json_extract(j.value, '$.received'), 0)) FROM json_each(p.lines) j), 0)
        - COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.po_id = p.id AND m.type = 'INWARD'), 0)) > 0.01`),
    c('Same PO number twice', 'Purchase', 'Cancel the copy that is not valid',
      "SELECT a.po_no || ' and ' || b.po_no x FROM purchase_orders a JOIN purchase_orders b ON b.id > a.id AND CAST(a.po_no AS INT) = CAST(b.po_no AS INT) AND substr(a.date, 1, 4) = substr(b.date, 1, 4) WHERE a.status NOT IN ('Archived (old)', 'Cancelled') AND b.status NOT IN ('Archived (old)', 'Cancelled')"),
    c('Approved POs without a payment schedule', 'Accounts', 'PO → Commercial step: payment terms',
      "SELECT po_no x FROM purchase_orders WHERE status IN ('Approved', 'Sent', 'Partially Received') AND (payment_schedule IS NULL OR payment_schedule IN ('', '[]'))"),
    c('Approvals waiting more than 3 days', 'Everyone', 'Approval Requests',
      "SELECT doc_type || ' ' || COALESCE(doc_ref, '') || ' – ' || COALESCE(stage, '') x FROM approvals WHERE status = 'Pending' AND created_at < datetime('now', 'localtime', '-3 days')", [], '#/list/approvals'),
    c('Draft issue slips / challans older than 2 days', 'Stores', 'Post or cancel them',
      "SELECT 'Draft #' || id || ' ' || COALESCE(doc_kind, '') x FROM stock_drafts WHERE status = 'Draft' AND date < date(?, '-2 days') UNION ALL SELECT challan_no FROM challans WHERE status = 'Draft' AND date < date(?, '-2 days')", [t, t]),
    c('Challans dispatched more than 7 days, not confirmed delivered', 'Logistics', 'Challan → Delivered (who received it)',
      "SELECT challan_no x FROM challans WHERE status = 'Dispatched' AND date < date(?, '-7 days')", [t]),
    c('Duplicate items (same name)', 'Stores', 'Item → Merge into another item',
      "SELECT GROUP_CONCAT(code, ', ') || ' · ' || MIN(name) x FROM items GROUP BY lower(trim(name)) HAVING COUNT(*) > 1"),
    c('Active projects without client or work order no', 'Projects', 'Project → client / work order no',
      "SELECT COALESCE(code, '') || ' ' || name x FROM projects WHERE COALESCE(status, 'Active') = 'Active' AND (customer_id IS NULL OR COALESCE(project_no, '') = '')"),
    c('Work orders without a project', 'Projects', 'Work order → Details → Project', "SELECT boq_no || ' ' || title x FROM boqs WHERE project_id IS NULL"),
    c('Logins not linked to an employee (no attendance)', 'HR', 'HR → Employees → CRM Login',
      "SELECT u.name x FROM users u WHERE u.active = 1 AND u.role <> 'admin' AND NOT EXISTS (SELECT 1 FROM employees e WHERE lower(e.login) = lower(u.username))"),
    c('Dispatch plans past their date, not dispatched', 'Logistics', 'Dispatch Plans → Mark dispatched or move the date',
      "SELECT plan_no || ' · ' || planned_date x FROM dispatch_plans WHERE status IN ('Planned', 'Material ready') AND planned_date < ?", [t], '#/list/dispatch_plans'),
  ] };
}
