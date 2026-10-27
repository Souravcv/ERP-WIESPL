// Store module: multi-line stock entries, stock summary (Smart Store formulas), PO tracking, opening stock.
import { db, tx, nextSeq, audit } from './db.js';
import { insertRow, updateRow, getRow, listRows, HttpError } from './crud.js';
import { poInwardDues } from './hooks.js';
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
    // Next number of the series; a number already in the CRM (e.g. imported from Smart Store) is skipped.
    const docNo = body.doc_no || (() => {
      for (;;) {
        const { seq, fy } = nextSeq(`stock_${type}`, date);
        const no = `${String(seq).padStart(3, '0')}/20${fy}`;
        if (!db.prepare('SELECT 1 FROM stock_moves WHERE type = ? AND doc_no = ?').get(type, no)) return no;
      }
    })();
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
      // Which PO line: the one chosen on the GRN, else the first line of the same item that is still pending.
      const idx = po ? poLineFor(po, l.item_id, Number.isInteger(l.po_line) ? l.po_line : null) : -1;
      // A PO for several sites: the material received belongs to the project of its PO line.
      const lineProject = l.project_id || (idx >= 0 && po.lines[idx].project_id) || header.project_id || (type === 'INWARD' && po?.project_id) || null;
      const row = insertRow('stock_moves', {
        ...header, type, date, doc_no: docNo, item_id: Number(l.item_id), qty: Number(l.qty),
        rate: l.rate === '' || l.rate == null ? null : Number(l.rate), uom: l.uom || null,
        remarks: [l.remark, header.remarks].filter(Boolean).join(' · ') || null,
        hsn: l.hsn || null, gst_rate: l.gst ?? null, project_id: lineProject ? Number(lineProject) : null, po_line: idx >= 0 ? idx : null,
      }, user, { system: true });
      created.push(row.id);
      if (idx >= 0) po.lines[idx].received = round2((Number(po.lines[idx].received) || 0) + Number(l.qty));
    }
    if (po) {
      const ordered = po.lines.filter(x => Number(x.qty) > 0);
      const all = ordered.every(x => (Number(x.received) || 0) >= Number(x.qty));
      updateRow('purchase_orders', po.id, { lines: po.lines, status: all ? 'Closed' : 'Partially Received' }, user, { system: true });
      poInwardDues(po.id, date); // "N days after inward" payments become due
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
        case 'PRODUCED': r.inward += qty; r.produced = (r.produced || 0) + qty; bal += qty; break;
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
  // "slow moving", "fast", "non moving" in the search text filter by FSN class; the rest searches code / name.
  let text = String(q.q || '').toLowerCase();
  let fsn = q.fsn || null;
  const said = [[/\bnon[\s-]*(moving|m)\b|\bnon[\s-]*mov\w*/, 'NON-M'], [/\bslow(\s*moving)?\b/, 'SLOW'], [/\bfast(\s*moving)?\b/, 'FAST']].find(([re]) => re.test(text));
  if (said) { fsn = fsn || said[1]; text = text.replace(said[0], ' ').replace(/\bmoving\b|\bitems?\b|\bstocks?\b/g, ' ').trim(); }
  if (fsn) out = out.filter(r => r.fsn === fsn);
  if (q.abc) out = out.filter(r => r.abc === q.abc);
  if (text) out = out.filter(r => `${r.code} ${r.name} ${r.location || ''}`.toLowerCase().includes(text));
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
    WHERE p.status NOT IN ('Cancelled', 'Archived (old)') ORDER BY p.date DESC, p.id DESC`).all();
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

// ---------------------------------------------------------------- store dashboard
// FY totals (opening / inward / outward / closing in qty and value), the last 6 months month by month,
// document counts, ABC / FSN and what needs attention.
export function storeDashboard(q = {}) {
  const to = today();
  const from = fyStart(fyOf(to));
  const { rows } = stockSummary({ from, to });
  const sum = (k, f = r => r[k]) => round2(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));
  const totals = {
    items: rows.length, in_stock: rows.filter(r => r.closing > 0).length,
    opening_qty: sum('opening'), opening_value: sum(null, r => r.opening * r.rate),
    inward_qty: sum('inward'), inward_value: sum('inward_value'),
    outward_qty: round2(sum('outward') + sum('transfer')), outward_value: sum('consumption_value'),
    return_qty: sum('return'), scrap_qty: sum('scrap'),
    closing_qty: sum('closing'), closing_value: sum('closing_value'),
  };
  // last 6 months, including this one
  const months = [];
  const d = new Date(to.slice(0, 7) + '-01T00:00:00');
  for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  const flows = db.prepare(`SELECT substr(m.date, 1, 7) mo, CASE WHEN m.type = 'INWARD' THEN 'in' ELSE 'out' END k,
      SUM(m.qty) q, SUM(m.qty * COALESCE(m.rate, i.rate, 0)) v
    FROM stock_moves m JOIN items i ON i.id = m.item_id
    WHERE m.date >= ? AND m.date <= ? AND m.type IN ('INWARD', 'OUTWARD', 'TRANSFER') GROUP BY 1, 2`).all(months[0] + '-01', to);
  const monthly = months.map(mo => {
    const f = k => flows.find(x => x.mo === mo && x.k === k) || {};
    return { month: mo, in_qty: round2(f('in').q || 0), in_value: round2(f('in').v || 0), out_qty: round2(f('out').q || 0), out_value: round2(f('out').v || 0) };
  });
  const byStatus = t => db.prepare(`SELECT COALESCE(status, '') status, COUNT(*) n FROM ${t} GROUP BY 1 ORDER BY n DESC`).all();
  const count = (k, v) => rows.filter(r => r[k] === v).length;
  const nonMoving = rows.filter(r => r.fsn === 'NON-M' && r.closing > 0);
  return {
    from, to, totals, monthly,
    challans: byStatus('challans'), requisitions: byStatus('requisitions'), purchase_orders: byStatus('purchase_orders'),
    pending_grn: db.prepare("SELECT COUNT(*) n FROM purchase_orders WHERE status IN ('Approved', 'Sent', 'Partially Received')").get().n,
    abc: ['A', 'B', 'C'].map(c => ({ cls: c, n: count('abc', c), value: round2(rows.filter(r => r.abc === c).reduce((s, r) => s + r.consumption_value, 0)) })),
    fsn: ['FAST', 'SLOW', 'NON-M'].map(c => ({ cls: c, n: count('fsn', c), value: round2(rows.filter(r => r.fsn === c).reduce((s, r) => s + r.closing_value, 0)) })),
    attention: {
      low: rows.filter(r => r.low).length, negative: rows.filter(r => r.closing < 0).length,
      non_moving: nonMoving.length, non_moving_value: round2(nonMoving.reduce((s, r) => s + r.closing_value, 0)),
      no_price: rows.filter(r => r.closing > 0 && !r.rate).length,
      no_min_level: rows.filter(r => r.fsn === 'FAST' && !r.reorder_level).length,
    },
    top_consumed: [...rows].filter(r => r.consumption_value > 0).sort((a, b) => b.consumption_value - a.consumption_value).slice(0, 8)
      .map(r => ({ id: r.id, code: r.code, name: r.name, qty: round2(r.outward + r.transfer), uom: r.uom, value: r.consumption_value })),
    top_stock: [...rows].filter(r => r.closing_value > 0).sort((a, b) => b.closing_value - a.closing_value).slice(0, 8)
      .map(r => ({ id: r.id, code: r.code, name: r.name, qty: r.closing, uom: r.uom, value: r.closing_value, fsn: r.fsn })),
  };
}

// ---------------------------------------------------------------- accounts dashboard
// Vendor payments due (PO payment schedules), receivables, collections, POs waiting for the commercial step.
export function accountsDashboard() {
  const t = today();
  const from = fyStart(fyOf(t));
  const pos = db.prepare(`SELECT p.id, p.po_no, p.date, p.total, p.status, p.approval_stage, p.payment_schedule, v.name vendor
    FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE p.status NOT IN ('Cancelled', 'Rejected', 'Draft', 'Archived (old)')`).all();
  const dues = [];
  for (const p of pos) {
    let sch = [];
    try { sch = JSON.parse(p.payment_schedule || '[]'); } catch { /* ignore */ }
    for (const s of sch) {
      const amount = round2(Number(s.amount) || (Number(s.percent) || 0) * (p.total || 0) / 100);
      dues.push({ po_id: p.id, po_no: p.po_no, vendor: p.vendor, due_date: s.due_date || null, description: s.description || '', amount, status: s.status || 'Due', paid_on: s.paid_on || null });
    }
  }
  const open = dues.filter(d => d.status !== 'Paid');
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const months = [];
  const d0 = new Date(t.slice(0, 7) + '-01T00:00:00');
  for (let i = 0; i < 6; i++) { const x = new Date(d0.getFullYear(), d0.getMonth() + i, 1); months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  const pastMonths = [];
  for (let i = 5; i >= 0; i--) { const x = new Date(d0.getFullYear(), d0.getMonth() - i, 1); pastMonths.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  const coll = db.prepare("SELECT substr(date, 1, 7) mo, SUM(amount) v FROM payments WHERE status = 'Received' AND date >= ? GROUP BY 1").all(pastMonths[0] + '-01');
  // Issued tax invoices with money still to come (after receipts, TDS, credit notes, advances); retention not yet due is not overdue.
  const inv = listRows('invoices', { type: 'Tax Invoice' }).filter(i => !['Draft', 'Cancelled', 'Paid'].includes(i.status) && i.balance > 0.5)
    .map(i => ({ id: i.id, invoice_no: i.invoice_no, date: i.date, due_date: i.due_date, total: i.total, customer: i.customer_id_label, balance: i.balance, due_now: i.due_now }));
  const sum = (rows, k = 'amount') => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  return {
    today: t, from,
    payables: {
      overdue: sum(open.filter(d => d.due_date && d.due_date < t)), overdue_n: open.filter(d => d.due_date && d.due_date < t).length,
      next30: sum(open.filter(d => d.due_date && d.due_date >= t && d.due_date <= in30)), next30_n: open.filter(d => d.due_date && d.due_date >= t && d.due_date <= in30).length,
      open: sum(open), no_date: open.filter(d => !d.due_date).length,
      paid_fy: sum(dues.filter(d => d.status === 'Paid' && (d.paid_on || d.due_date || '') >= from)),
      by_month: months.map(m => ({ month: m, value: sum(open.filter(d => (d.due_date || '').startsWith(m))) })),
      upcoming: open.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).slice(0, 15),
    },
    pos: {
      waiting_commercial: pos.filter(p => p.status === 'Pending Approval' && p.approval_stage === 'Commercial').map(p => ({ id: p.id, po_no: p.po_no, vendor: p.vendor, total: p.total })),
      approved_fy_value: round2(pos.filter(p => ['Approved', 'Sent', 'Partially Received', 'Received', 'Closed'].includes(p.status) && p.date >= from).reduce((s, p) => s + (p.total || 0), 0)),
      without_schedule: pos.filter(p => ['Approved', 'Sent', 'Partially Received'].includes(p.status) && (!p.payment_schedule || p.payment_schedule === '[]')).length,
    },
    receivables: {
      outstanding: sum(inv, 'balance'), overdue: sum(inv.filter(i => i.due_date && i.due_date < t), 'due_now'),
      overdue_list: inv.filter(i => i.due_date && i.due_date < t && i.due_now > 0.5).map(i => ({ ...i, balance: i.due_now })).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 10),
      collected_fy: round2(db.prepare("SELECT COALESCE(SUM(amount), 0) v FROM payments WHERE status = 'Received' AND date >= ?").get(from).v),
      collected_by_month: pastMonths.map(m => ({ month: m, value: round2(coll.find(c => c.mo === m)?.v || 0) })),
    },
  };
}

// ---------------------------------------------------------------- movements as documents
// One row per slip: all the items of one GRN / issue slip / transfer together (same type, number and date).
const DOC_KEY = "COALESCE(NULLIF(m.doc_no, ''), '#' || m.id)";
export function stockDocs(q = {}) {
  const where = ['1 = 1'], args = [];
  if (q.type) { where.push('m.type = ?'); args.push(q.type); }
  if (q.from) { where.push('m.date >= ?'); args.push(q.from); }
  if (q.to) { where.push('m.date <= ?'); args.push(q.to); }
  if (q.po === 'without') where.push("m.type = 'INWARD' AND m.po_id IS NULL");
  if (q.po === 'with') where.push('m.po_id IS NOT NULL');
  if (q.q) {
    where.push(`(m.doc_no LIKE ? OR m.supplier LIKE ? OR m.invoice_no LIKE ? OR m.po_no LIKE ? OR m.issued_to LIKE ? OR m.to_location LIKE ? OR v.name LIKE ? OR p.name LIKE ? OR i.name LIKE ? OR i.code LIKE ?)`);
    args.push(...Array(10).fill(`%${q.q}%`));
  }
  const rows = db.prepare(`SELECT m.type, ${DOC_KEY} doc_key, MAX(NULLIF(m.doc_no, '')) doc_no, m.date, COUNT(*) items, ROUND(SUM(m.qty), 3) qty,
      ROUND(SUM(COALESCE(m.qty, 0) * COALESCE(m.rate, 0)), 2) value, MAX(v.name) vendor, MAX(m.supplier) supplier, MAX(m.invoice_no) invoice_no,
      GROUP_CONCAT(DISTINCT m.po_no) po_no, COUNT(m.po_id) with_po, MAX(p.name) project, COUNT(DISTINCT m.project_id) projects, MAX(m.issued_to) issued_to,
      MAX(m.to_location) to_location, MAX(m.created_by) created_by, MIN(m.id) first_id
    FROM stock_moves m LEFT JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id LEFT JOIN projects p ON p.id = m.project_id
    WHERE ${where.join(' AND ')} GROUP BY m.type, doc_key, m.date ORDER BY m.date DESC, first_id DESC LIMIT ?`).all(...args, Math.min(Number(q.limit) || 300, 2000));
  const counts = Object.fromEntries(db.prepare("SELECT type, COUNT(DISTINCT type || COALESCE(NULLIF(doc_no, ''), '#' || id) || date) n FROM stock_moves GROUP BY type").all().map(r => [r.type, r.n]));
  return { rows, counts };
}

// The lines of one slip; doc_key is the number, or '#id' for a single entry without a number.
function docMoves(type, docKey, date) {
  const byId = /^#(\d+)$/.exec(docKey || '');
  const rows = byId ? db.prepare('SELECT id FROM stock_moves WHERE id = ? AND type = ?').all(Number(byId[1]), type)
    : db.prepare('SELECT id FROM stock_moves WHERE type = ? AND doc_no = ? AND date = ? ORDER BY id').all(type, docKey, date);
  return rows.map(r => getRow('stock_moves', r.id));
}
export function stockDoc(q) {
  const moves = docMoves(q.type, q.doc, q.date);
  if (!moves.length) throw new HttpError(404, 'No such slip');
  const poIds = [...new Set(moves.map(m => m.po_id).filter(Boolean))];
  const pos = poIds.map(id => getRow('purchase_orders', id));
  return { type: q.type, doc_no: moves[0].doc_no, date: moves[0].date, moves, pos };
}

// PO line a received item belongs to: the line saved on the GRN, else a line of that store item (pending first), else
// the line whose name matches the item's name best (POs imported from Excel have names, not store items). The match
// is remembered on the PO line, so the next GRN finds it directly.
const STOP = new Set(['make', 'with', 'and', 'for', 'the', 'of', 'type', 'nos', 'no', 'mm', 'size', 'model', 'pcs', 'set', 'per']);
const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w)));
export function poLineFor(po, itemId, saved = null, wantPending = true) {
  if (Number.isInteger(saved) && po.lines[saved]) return saved;
  const same = x => x.item_id && Number(x.item_id) === Number(itemId);
  const open = x => (Number(x.received) || 0) < (Number(x.qty) || 0);
  let i = po.lines.findIndex(x => same(x) && (wantPending ? open(x) : (Number(x.received) || 0) > 0));
  if (i < 0) i = po.lines.findIndex(same);
  if (i >= 0 || !itemId) return i;
  const it = db.prepare('SELECT name, code FROM items WHERE id = ?').get(Number(itemId));
  const a = words(it?.name);
  let best = -1, top = 0;
  po.lines.forEach((l, k) => {
    if (!(Number(l.qty) > 0) || (l.item_id && Number(l.item_id) !== Number(itemId))) return;
    const b = words(`${l.description || ''} ${String(l.spec || '').split('\n')[0]} ${l.vendor_code || ''}`);
    let hit = 0;
    for (const w of a) if (b.has(w)) hit++;
    const score = hit / Math.max(1, Math.min(a.size, b.size)) + (open(l) ? 0.01 : 0);
    if (score > top) { top = score; best = k; }
  });
  if (best < 0 || top < 0.3) return -1;
  if (!po.lines[best].item_id) po.lines[best].item_id = Number(itemId);
  return best;
}
const lineOf = poLineFor;

// GRN lines that point at a PO but were never counted on it (linked later, e.g. by an import): add them to the PO lines.
export function addReceipts(poId, moves, user = { name: 'system' }) {
  const po = getRow('purchase_orders', poId);
  if (!po || !moves.length) return 0;
  let n = 0;
  for (const m of moves) {
    const i = poLineFor(po, m.item_id, Number.isInteger(m.po_line) ? m.po_line : null);
    if (i < 0) continue;
    po.lines[i].received = round2((Number(po.lines[i].received) || 0) + Number(m.qty));
    db.prepare('UPDATE stock_moves SET po_line = ? WHERE id = ?').run(i, m.id);
    n++;
  }
  const patch = { lines: po.lines };
  if (['Approved', 'Sent', 'Partially Received'].includes(po.status)) patch.status = fullyIn(po) ? 'Closed' : anyIn(po) ? 'Partially Received' : po.status;
  updateRow('purchase_orders', po.id, patch, user, { system: true });
  return n;
}

// Once: live POs that show nothing received although GRNs point at them get their receipts counted.
export function repairPoReceipts() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'po_receipts_v1'").get()) return 0;
  let n = 0;
  for (const p of db.prepare("SELECT id, lines FROM purchase_orders WHERE status IN ('Approved', 'Sent', 'Partially Received', 'Closed')").all()) {
    let rec = 0;
    try { rec = JSON.parse(p.lines || '[]').reduce((s, l) => s + (Number(l.received) || 0), 0); } catch { continue; }
    if (rec > 0) continue;
    const moves = db.prepare("SELECT id, item_id, qty, po_line FROM stock_moves WHERE po_id = ? AND type = 'INWARD'").all(p.id);
    if (moves.length) n += addReceipts(p.id, moves);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('po_receipts_v1', '\"1\"')").run();
  return n;
}
const PO_OPEN = ['Approved', 'Sent', 'Partially Received', 'Closed', 'Received'];
const fullyIn = po => po.lines.filter(x => Number(x.qty) > 0).every(x => (Number(x.received) || 0) >= Number(x.qty) - 1e-9);
const anyIn = po => po.lines.some(x => (Number(x.received) || 0) > 0);

// Edit a GRN: supplier / invoice details, quantities and prices, and which PO (and PO line) each item came against.
// The received quantities move from the old PO lines to the new ones, so the PO tracker stays right.
export function editGrn(body, user) {
  const moves = docMoves('INWARD', body.doc, body.date);
  if (!moves.length) throw new HttpError(404, 'No such GRN');
  const lines = new Map((body.lines || []).map(l => [Number(l.id), l]));
  for (const id of lines.keys()) if (!moves.some(m => m.id === id)) throw new HttpError(400, 'A line does not belong to this GRN');
  const newPoId = body.po_id ? Number(body.po_id) : null;
  return tx(() => {
    const pos = new Map();
    const poOf = id => pos.get(id) || pos.set(id, getRow('purchase_orders', id)).get(id);
    const was = new Map();
    // 1. Take the old receipt off its PO lines.
    for (const m of moves) {
      if (!m.po_id) continue;
      const po = poOf(m.po_id);
      if (!was.has(po.id)) was.set(po.id, fullyIn(po));
      const i = lineOf(po, m.item_id, m.po_line, false);
      if (i >= 0) po.lines[i].received = round2(Math.max(0, (Number(po.lines[i].received) || 0) - Number(m.qty)));
    }
    let newPo = null;
    if (newPoId) {
      newPo = poOf(newPoId);
      if (!was.has(newPo.id)) was.set(newPo.id, fullyIn(newPo));
      if (!PO_OPEN.includes(newPo.status) && newPo.status !== 'Archived (old)') throw new HttpError(400, `PO ${newPo.po_no} is ${newPo.status}; attach an approved PO`);
    }
    // 2. Stock check: a smaller quantity must not take the stock below zero.
    if (!body.allowNegative) {
      const short = [];
      for (const m of moves) {
        const l = lines.get(m.id);
        const less = l && l.qty !== undefined ? Number(m.qty) - Number(l.qty) : 0;
        if (less > 1e-9 && stockOf(m.item_id) - less < -1e-9) short.push(`${m.item_id_label}: in stock ${round2(stockOf(m.item_id))}, reducing the GRN by ${round2(less)}`);
      }
      if (short.length) throw Object.assign(new HttpError(409, `Not enough stock:\n${short.join('\n')}`), { code: 'SHORT_STOCK' });
    }
    // 3. Save each line and put its quantity on the new PO line.
    const head = {};
    for (const k of ['vendor_id', 'supplier', 'invoice_no', 'invoice_date', 'date']) if (body[k] !== undefined) head[k] = body[k] === '' ? null : body[k];
    if (!head.date) delete head.date;
    for (const m of moves) {
      const l = lines.get(m.id) || {};
      const qty = l.qty !== undefined && l.qty !== '' ? Number(l.qty) : Number(m.qty);
      if (!(qty > 0)) throw new HttpError(400, `Enter a quantity for ${m.item_id_label}`);
      const rate = l.rate !== undefined && l.rate !== '' && l.rate != null ? Number(l.rate) : m.rate;
      let poLine = null;
      if (newPo) {
        poLine = lineOf(newPo, m.item_id, Number.isInteger(l.po_line) ? l.po_line : null);
        if (poLine >= 0) newPo.lines[poLine].received = round2((Number(newPo.lines[poLine].received) || 0) + qty);
        else poLine = null;
      }
      const project = m.project_id || (poLine != null && newPo.lines[poLine].project_id) || newPo?.project_id || null;
      updateRow('stock_moves', m.id, { ...head, qty, rate, po_id: newPo?.id || null, po_no: newPo ? newPo.po_no : (newPoId === null && body.po_no !== undefined ? body.po_no || null : m.po_no),
        po_line: poLine, vendor_id: head.vendor_id ?? m.vendor_id ?? newPo?.vendor_id ?? null, project_id: project }, user, { system: true });
    }
    // 4. PO status follows what has come in (an old archived PO keeps its status).
    for (const po of pos.values()) {
      const patch = { lines: po.lines };
      if (['Approved', 'Sent', 'Partially Received'].includes(po.status) || (po.status === 'Closed' && was.get(po.id))) {
        patch.status = fullyIn(po) ? 'Closed' : anyIn(po) ? 'Partially Received' : (po.status === 'Sent' ? 'Sent' : 'Approved');
      }
      updateRow('purchase_orders', po.id, patch, user, { system: true });
      if (newPo && po.id === newPo.id) poInwardDues(po.id, moves[0].date);
    }
    audit(user.name, 'stock_moves', moves[0].id, `GRN ${moves[0].doc_no} edited`, newPo ? `against PO ${newPo.po_no}` : 'no PO');
    return stockDoc({ type: 'INWARD', doc: body.doc, date: head.date || body.date });
  });
}

// ---------------------------------------------------------------- merge a duplicate item
// The same material entered twice (two codes): everything that refers to the duplicate — stock movements, POs,
// requisitions, challans, BOQs, work orders, drafts, material lists … — moves to the item that is kept, its opening
// stock is added, and the duplicate is removed. The stock of the kept item is then the sum of both.
const ITEM_COLS = [['stock_moves', 'item_id'], ['boq_items', 'item_id'], ['bom_items', 'item_id'], ['material_lists', 'makes_item_id'], ['production_entries', 'fg_item_id']];
const ITEM_LINES = ['purchase_orders', 'requisitions', 'challans', 'invoices', 'material_lists', 'service_work_orders', 'costing_sheets', 'material_requests', 'production_entries', 'dispatch_plans'];
export function mergeItems(fromId, intoId, user) {
  fromId = Number(fromId); intoId = Number(intoId);
  if (!intoId || fromId === intoId) throw new HttpError(400, 'Choose the other item to keep');
  const from = db.prepare('SELECT * FROM items WHERE id = ?').get(fromId), into = db.prepare('SELECT * FROM items WHERE id = ?').get(intoId);
  if (!from || !into) throw new HttpError(404, 'Item not found');
  return tx(() => {
    const moved = {};
    // Opening stock entries on the same date become one (the stock counts only the latest opening of an item).
    for (const o of db.prepare("SELECT id, date, qty FROM stock_moves WHERE item_id = ? AND type = 'OPENING'").all(fromId)) {
      const keep = db.prepare("SELECT id FROM stock_moves WHERE item_id = ? AND type = 'OPENING' AND date = ? ORDER BY id DESC LIMIT 1").get(intoId, o.date);
      if (keep) { db.prepare('UPDATE stock_moves SET qty = qty + ? WHERE id = ?').run(Number(o.qty) || 0, keep.id); db.prepare('DELETE FROM stock_moves WHERE id = ?').run(o.id); moved.opening = (moved.opening || 0) + 1; }
    }
    for (const [t, c] of ITEM_COLS) {
      const n = Number(db.prepare(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`).run(intoId, fromId).changes);
      if (n) moved[t] = (moved[t] || 0) + n;
    }
    const swap = list => { let hit = 0; for (const l of list || []) if (l && Number(l.item_id) === fromId) { l.item_id = intoId; hit++; } return hit; };
    for (const t of ITEM_LINES) {
      for (const r of db.prepare(`SELECT id, lines FROM ${t} WHERE lines LIKE ?`).all(`%"item_id":${fromId}%`)) {
        let lines; try { lines = JSON.parse(r.lines); } catch { continue; }
        const hit = swap(lines);
        if (hit) { db.prepare(`UPDATE ${t} SET lines = ? WHERE id = ?`).run(JSON.stringify(lines), r.id); moved[t] = (moved[t] || 0) + hit; }
      }
    }
    for (const r of db.prepare('SELECT id, payload FROM stock_drafts WHERE payload LIKE ?').all(`%"item_id":${fromId}%`)) {
      let p; try { p = JSON.parse(r.payload); } catch { continue; }
      if (swap(p.lines)) { db.prepare('UPDATE stock_drafts SET payload = ? WHERE id = ?').run(JSON.stringify(p), r.id); moved.stock_drafts = (moved.stock_drafts || 0) + 1; }
    }
    const patch = { opening_stock: round2((Number(into.opening_stock) || 0) + (Number(from.opening_stock) || 0)) };
    for (const k of ['hsn', 'gst_rate', 'location', 'description', 'preferred_vendor_id', 'lead_days', 'reorder_level']) if ((into[k] == null || into[k] === '') && from[k] != null && from[k] !== '') patch[k] = from[k];
    updateRow('items', intoId, patch, user, { system: true });
    db.prepare('DELETE FROM items WHERE id = ?').run(fromId);
    audit(user.name, 'items', intoId, `merged ${from.code} ${from.name}`, JSON.stringify(moved));
    return { kept: getRow('items', intoId), moved, stock: stockOf(intoId) };
  });
}
