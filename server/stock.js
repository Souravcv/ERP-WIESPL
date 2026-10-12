// Store module: multi-line stock entries, stock summary (Smart Store formulas), PO tracking, opening stock.
import { db, tx, nextSeq, audit } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { MOVE_TYPES, STOCK_SQL } from '../public/js/schema.js';
import { round2, fyOf } from '../public/js/calc.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const fyStart = fy => `20${fy.slice(0, 2)}-04-01`;
const OUT_TYPES = ['OUTWARD', 'TRANSFER', 'SCRAP'];
const APPROVED_PO = ['Approved', 'Sent', 'Partially Received', 'Closed', 'Received'];

export function stockOf(itemId) {
  return db.prepare(`SELECT ${STOCK_SQL.replaceAll('{t}', 't')} AS stock FROM items t WHERE t.id = ?`).get(itemId)?.stock ?? 0;
}

// ---------------------------------------------------------------- multi-line entry (GRN / issue slip / transfer ...)
const HEADER_KEYS = ['vendor_id', 'supplier', 'invoice_no', 'invoice_date', 'po_id', 'po_no', 'project_id', 'issued_to', 'requested_by',
  'from_location', 'to_location', 'against_issue_no', 'reason', 'purpose', 'remarks'];

export function stockEntry(body, user) {
  const type = body?.type;
  if (!MOVE_TYPES[type]) throw new HttpError(400, 'Choose a movement type');
  const date = body.date || today();
  const lines = (body.lines || []).filter(l => l.item_id && Number(l.qty));
  if (!lines.length) throw new HttpError(400, 'Add at least one item with a quantity');
  if (type === 'INWARD' && lines.some(l => !(Number(l.rate) >= 0) || l.rate === '' || l.rate == null)) throw new HttpError(400, 'Enter the price per piece for every inward line');

  // Stock check for issues / transfers / scrap (total per item across the slip).
  if (OUT_TYPES.includes(type) && !body.allowNegative) {
    const need = {};
    for (const l of lines) need[l.item_id] = (need[l.item_id] || 0) + Math.abs(Number(l.qty));
    const short = [];
    for (const [itemId, qty] of Object.entries(need)) {
      const have = stockOf(Number(itemId));
      if (qty > have + 1e-9) {
        const it = db.prepare('SELECT code, name FROM items WHERE id = ?').get(Number(itemId));
        short.push(`${it?.code || ''} ${it?.name || itemId}: available ${round2(have)}, requested ${qty}`);
      }
    }
    if (short.length) throw Object.assign(new HttpError(409, `Not enough stock:\n${short.join('\n')}`), { code: 'SHORT_STOCK' });
  }

  return tx(() => {
    const docNo = body.doc_no || (() => { const { seq, fy } = nextSeq(`stock_${type}`, date); return `${String(seq).padStart(3, '0')}/20${fy}`; })();
    const header = Object.fromEntries(HEADER_KEYS.filter(k => body[k] !== undefined && body[k] !== '').map(k => [k, body[k]]));
    let po = null;
    // A PO number typed by hand that matches a PO in the CRM counts as "against that PO", so the PO tracker shows it.
    if (type === 'INWARD' && !header.po_id && header.po_no) {
      const typed = String(header.po_no).trim();
      const hit = db.prepare("SELECT id FROM purchase_orders WHERE (po_no = ? OR po_no = ?) AND status IN ('Approved', 'Sent', 'Partially Received') ORDER BY id DESC LIMIT 1")
        .get(typed, typed.replace(/^(\d{1,3})\//, (m, d) => d.padStart(3, '0') + '/'));
      if (hit) header.po_id = hit.id;
    }
    // Goods are only received against a purchase order.
    if (type === 'INWARD' && !header.po_id && !body.allowWithoutPo) {
      throw new HttpError(400, header.po_no ? `PO ${header.po_no} is not an approved PO in the CRM (approved / sent / partly received). Check the number or approve the PO first.` : 'Inward needs a purchase order: choose it under “Against PO” (or type its PO number)');
    }
    if (type === 'INWARD' && header.po_id) {
      po = getRow('purchase_orders', header.po_id);
      if (!['Approved', 'Sent', 'Partially Received'].includes(po.status)) throw new HttpError(400, `PO ${po.po_no} is ${po.status}; only approved POs can be received`);
      header.po_no = po.po_no;
      header.vendor_id = header.vendor_id || po.vendor_id;
    }
    const created = [];
    for (const l of lines) {
      const row = insertRow('stock_moves', {
        ...header, type, date, doc_no: docNo, item_id: Number(l.item_id), qty: Number(l.qty),
        rate: l.rate === '' || l.rate == null ? null : Number(l.rate), uom: l.uom || null,
        remarks: [l.remark, header.remarks].filter(Boolean).join(' · ') || null,
        hsn: l.hsn || null, gst_rate: l.gst ?? null,
      }, user, { system: true });
      created.push(row.id);
      if (po) {
        // Which PO line: the one chosen on the GRN, else the first line of the same item that is still pending.
        let idx = Number.isInteger(l.po_line) && po.lines[l.po_line] ? l.po_line : -1;
        if (idx < 0) idx = po.lines.findIndex(x => x.item_id && Number(x.item_id) === Number(l.item_id) && (Number(x.received) || 0) < (Number(x.qty) || 0));
        if (idx < 0) idx = po.lines.findIndex(x => x.item_id && Number(x.item_id) === Number(l.item_id));
        if (idx >= 0) po.lines[idx].received = round2((Number(po.lines[idx].received) || 0) + Number(l.qty));
      }
    }
    if (po) {
      const ordered = po.lines.filter(x => Number(x.qty) > 0);
      const all = ordered.every(x => (Number(x.received) || 0) >= Number(x.qty));
      updateRow('purchase_orders', po.id, { lines: po.lines, status: all ? 'Closed' : 'Partially Received' }, user, { system: true });
    }
    audit(user.name, 'stock_moves', null, `${type} ${docNo}`, `${lines.length} line(s)`);
    return { doc_no: docNo, type, count: created.length, ids: created };
  });
}

// ---------------------------------------------------------------- stock summary
export function stockSummary(q = {}) {
  const from = q.from || fyStart(fyOf(q.to || today()));
  const to = q.to || today();
  const items = db.prepare('SELECT id, code, name, category, uom, rate, gst_rate, reorder_level, opening_stock, location FROM items').all();
  const moves = db.prepare(`SELECT item_id, type, date, qty, rate FROM stock_moves WHERE date <= ? ORDER BY item_id, date, CASE type WHEN 'OPENING' THEN 0 ELSE 1 END, id`).all(to);
  const byItem = new Map();
  for (const m of moves) (byItem.get(m.item_id) || byItem.set(m.item_id, []).get(m.item_id)).push(m);

  const rows = items.map(it => {
    const r = { id: it.id, code: it.code, name: it.name, category: it.category, uom: it.uom, rate: it.rate || 0, reorder_level: it.reorder_level || 0, location: it.location,
      opening: 0, inward: 0, outward: 0, transfer: 0, return: 0, scrap: 0, adjust: 0, closing: 0,
      inward_value: 0, consumption_value: 0, last_out: null, months: new Set() };
    let bal = Number(it.opening_stock) || 0;
    let started = false;
    for (const m of byItem.get(it.id) || []) {
      const pre = m.date < from || (m.type === 'OPENING' && m.date === from);
      if (!pre && !started) { r.opening = bal; started = true; }
      const qty = Number(m.qty) || 0;
      if (OUT_TYPES.slice(0, 2).includes(m.type) && (!r.last_out || m.date > r.last_out)) r.last_out = m.date;
      if (pre) { bal = m.type === 'OPENING' ? qty : bal + qty * (MOVE_TYPES[m.type]?.sign ?? 0); continue; }
      switch (m.type) {
        case 'OPENING': r.adjust += qty - bal; bal = qty; break;
        case 'INWARD': r.inward += qty; r.inward_value += qty * (m.rate ?? it.rate ?? 0); bal += qty; break;
        case 'OUTWARD': r.outward += qty; r.consumption_value += qty * (m.rate ?? it.rate ?? 0); r.months.add(m.date.slice(0, 7)); bal -= qty; break;
        case 'TRANSFER': r.transfer += qty; r.consumption_value += qty * (m.rate ?? it.rate ?? 0); r.months.add(m.date.slice(0, 7)); bal -= qty; break;
        case 'RETURN': r.return += qty; bal += qty; break;
        case 'SCRAP': r.scrap += qty; bal -= qty; break;
        case 'ADJUST': r.adjust += qty; bal += qty; break;
      }
    }
    if (!started) r.opening = bal;
    r.closing = round2(bal);
    r.closing_value = round2(r.closing * r.rate);
    r.inward_value = round2(r.inward_value);
    r.consumption_value = round2(r.consumption_value);
    r.days_since_out = r.last_out ? Math.round((new Date(to) - new Date(r.last_out)) / 864e5) : null;
    // FSN, as in the workbook: issued in 4+ active months = FAST, 1-3 = SLOW, none = NON-M
    r.fsn = r.months.size >= 4 ? 'FAST' : r.months.size >= 1 ? 'SLOW' : 'NON-M';
    delete r.months;
    for (const k of ['opening', 'inward', 'outward', 'transfer', 'return', 'scrap', 'adjust']) r[k] = round2(r[k]);
    r.low = r.reorder_level > 0 && r.closing <= r.reorder_level;
    return r;
  });

  // ABC on consumption value: top items up to 70% of value = A, next to 90% = B, rest C.
  const total = rows.reduce((s, r) => s + r.consumption_value, 0);
  for (const r of rows) {
    if (!r.consumption_value || !total) { r.abc = 'C'; continue; }
    const cum = rows.reduce((s, x) => s + (x.consumption_value >= r.consumption_value ? x.consumption_value : 0), 0);
    r.abc = cum / total <= 0.7 ? 'A' : cum / total <= 0.9 ? 'B' : 'C';
  }

  let out = rows;
  if (q.item_id) out = out.filter(r => r.id === Number(q.item_id));
  if (q.category) out = out.filter(r => r.category === q.category);
  if (q.q) { const s = String(q.q).toLowerCase(); out = out.filter(r => `${r.code} ${r.name} ${r.location || ''}`.toLowerCase().includes(s)); }
  if (q.only === 'low') out = out.filter(r => r.low);
  if (q.only === 'instock') out = out.filter(r => r.closing > 0);
  if (q.only === 'negative') out = out.filter(r => r.closing < 0);
  out.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  return { from, to, rows: out };
}

// ---------------------------------------------------------------- PO line tracker
export function poLines(q = {}) {
  const pos = db.prepare(`SELECT p.*, v.name vendor, COALESCE(NULLIF(pr.project_no,''), pr.code) || ' ' || pr.name project, bm.bom_no bom_no
    FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN projects pr ON pr.id = p.project_id LEFT JOIN boms bm ON bm.id = p.bom_id
    WHERE p.status <> 'Cancelled' ORDER BY p.date DESC, p.id DESC`).all();
  const s = String(q.q || '').toLowerCase().trim();
  const rows = [];
  for (const p of pos) {
    let lines = [];
    try { lines = JSON.parse(p.lines || '[]'); } catch { /* ignore */ }
    let heading = '';
    lines.forEach((l, i) => {
      if (l.description) heading = l.description;
      const qty = Number(l.qty) || 0;
      if (!qty) return;
      const approved = APPROVED_PO.includes(p.status) ? qty : 0;
      const received = Number(l.received) || 0;
      const item = [l.description || heading, l.spec && !l.description ? String(l.spec).split('\n')[0] : ''].filter(Boolean).join(' – ');
      const lineStatus = !approved ? (p.status === 'Closed' ? 'Short-closed' : 'Not approved yet') : received >= approved - 1e-9 ? 'Procured' : received > 0 ? 'Partly received' : 'Pending';
      rows.push({
        po_id: p.id, po_no: p.po_no, date: p.date, vendor: p.vendor, project: p.project, bom_no: p.bom_no, status: p.status, line_status: lineStatus, line: i, item,
        uom: l.uom, ordered: qty, approved, received, pending: round2(Math.max(0, approved - received)),
        rate: Number(l.rate) || 0, value: round2(qty * (Number(l.rate) || 0)), received_value: round2(received * (Number(l.rate) || 0)),
      });
    });
  }
  return rows.filter(r => (!s || `${r.po_no} ${r.vendor} ${r.item} ${r.project} ${r.bom_no || ''}`.toLowerCase().includes(s)) && (!q.pending || r.pending > 0)
    && (!q.state || (q.state === 'procured' ? r.line_status === 'Procured' : q.state === 'pending' ? ['Pending', 'Partly received'].includes(r.line_status) : r.line_status === q.state)));
}

// ---------------------------------------------------------------- 1 April opening stock
// Creates an OPENING entry on 1 April of `fy` for every item, equal to its closing stock on 31 March.
export function carryForwardOpening(fy, user) {
  if (!/^\d{2}-\d{2}$/.test(fy || '')) throw new HttpError(400, 'Financial year must look like 26-27');
  const date = fyStart(fy);
  if (date > today()) throw new HttpError(400, `FY 20${fy} has not started yet. Create its opening stock on or after ${date.split('-').reverse().join('/')}, once all March entries are in.`);
  const prevDay = new Date(new Date(date) - 864e5).toISOString().slice(0, 10);
  const { rows } = stockSummary({ from: '0000-01-01', to: prevDay });
  const has = db.prepare("SELECT 1 FROM stock_moves WHERE item_id = ? AND type = 'OPENING' AND date = ?");
  const ins = db.prepare(`INSERT INTO stock_moves (type, date, doc_no, item_id, qty, uom, rate, remarks, created_by, created_at)
    VALUES ('OPENING', ?, ?, ?, ?, ?, ?, 'Carried forward from 31 March', ?, ?)`);
  let created = 0, skipped = 0;
  tx(() => {
    for (const r of rows) {
      if (has.get(r.id, date)) { skipped++; continue; }
      ins.run(date, `OPN/20${fy}`, r.id, r.closing, r.uom, r.rate, user.name, new Date().toLocaleString('sv-SE').slice(0, 19));
      created++;
    }
  });
  audit(user.name, 'stock_moves', null, 'opening carry-forward', `FY 20${fy}: ${created} items, ${skipped} already had an opening entry`);
  return { date, created, skipped };
}
