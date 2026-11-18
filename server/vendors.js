// Vendor management (WIESPL Supply Chain Manual ch. 4A–4C, Phase 1 formats): vendor codes (VND-EL-001), approval
// status (Approved / Preferred / Conditional / Under review / Blacklisted), the half-yearly evaluation scorecard with
// on-time delivery and quality worked out from POs, GRNs and IQC, the complaint / SCAR register (raised by itself when
// IQC rejects material), vendor audits, and the approved vendor list with each vendor's performance.
import { db, tx, audit, nextSeq } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction, VENDOR_GROUPS, VENDOR_WEIGHTS } from '../public/js/schema.js';
import { round2 } from '../public/js/calc.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const groupOf = v => String(v || '').slice(0, 2).toUpperCase();
export const vendorCode = (group, seq) => `VND-${VENDOR_GROUPS[groupOf(group)] ? groupOf(group) : 'GN'}-${String(seq).padStart(3, '0')}`;

// Score → rating band and the status it suggests (manual 4B).
export const bandOf = total => total == null ? null : total >= 90 ? 'Preferred' : total >= 80 ? 'Approved' : total >= 70 ? 'Conditional' : 'Under review';
export const weighted = r => {
  const parts = Object.entries(VENDOR_WEIGHTS).map(([k, w]) => (r[k] == null || r[k] === '' ? null : Math.max(0, Math.min(100, Number(r[k]))) * w / 100));
  return parts.some(p => p == null) ? null : round2(parts.reduce((a, b) => a + b, 0));
};

// Group from what the vendor is and what it has supplied (for vendors entered before codes).
const GUESS = [
  ['EL', /electric|cable|wire|panel board|switch|mcb|vfd|drive|sensor|plc|hmi|relay|contactor|lugs|led|light|controls?\b|power/i],
  ['HV', /hvac|ahu|duct|insulation|hepa|filter|refrigerat|aircon|air con|compressor|odu|cooling|chiller|damper|grill|fan\b|blower|carrier|daikin/i],
  ['ST', /steel|ispat|sheet|ppgl|ppgi|coil|\bss\b|\bms\b|stainless|alumin|metal|pipe|angle|channel/i],
  ['HW', /hardware|tools?\b|screw|bolt|nut|rivet|fastener|washer|anchor|weld/i],
  ['OT', /pendant|ot light|medical|surgical|mgps|medi-?equip|operation theatre|scrub|x-?ray/i],
  ['PN', /door|glass|interior|panel|partition|coving|vinyl|flooring|laminat|puf/i],
  ['CO', /packing|packaging|wooden box|plast|consumable|chemical|gas|paint|cleaning|tape/i],
  ['SV', /laser|engrav|coating|printing|service|fabricat|job work|transport|logistic|calibrat|testing/i],
  ['CV', /civil|construct|contractor|infra|builder/i],
];
function guessGroup(v) {
  const text = [v.name, v.category, ...db.prepare("SELECT json_extract(j.value, '$.description') d FROM purchase_orders p, json_each(p.lines) j WHERE p.vendor_id = ? LIMIT 60").all(v.id).map(r => r.d)].join(' ');
  for (const [g, re] of GUESS) if (re.test(text)) return g;
  return 'GN';
}

// Once: every existing vendor gets a group and a code, and counts as Approved (a current supplier) until its first
// evaluation.
export function setupVendors() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'vendors_v1'").get()) return;
  tx(() => {
    for (const v of db.prepare('SELECT id, name, category, code_group, vendor_code, vendor_status FROM vendors ORDER BY id').all()) {
      const g = groupOf(v.code_group) || guessGroup(v);
      const label = `${g} – ${VENDOR_GROUPS[g]}`;
      let code = v.vendor_code;
      if (!code) { const { seq } = nextSeq('vendor_code', '2026-04-01'); code = vendorCode(g, seq); }
      db.prepare("UPDATE vendors SET code_group = ?, vendor_code = ?, vendor_status = COALESCE(vendor_status, 'Approved'), approved_by = COALESCE(approved_by, 'Existing vendor at go-live'), approved_on = COALESCE(approved_on, ?) WHERE id = ?")
        .run(label, code, today(), v.id);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('vendors_v1', '\"1\"')").run();
  });
}

// Approve, prefer, make conditional, put under review or blacklist a vendor (Purchase Head / GM).
export function setStatus(id, body, user) {
  if (!hasFunction(user.role, 'vendor_approve')) throw new HttpError(403, 'Only the Purchase Head / GM approve or blacklist vendors');
  const v = getRow('vendors', id);
  const status = body?.status;
  if (!['Approved', 'Preferred', 'Conditional', 'Under review', 'Blacklisted'].includes(status)) throw new HttpError(400, 'Choose a status');
  const reason = String(body.reason || '').trim();
  if (['Blacklisted', 'Under review', 'Conditional'].includes(status) && !reason) throw new HttpError(400, 'Write the reason (it is kept with the vendor)');
  const patch = { vendor_status: status };
  if (['Approved', 'Preferred', 'Conditional'].includes(status)) Object.assign(patch, { approved_by: user.name, approved_on: today(), valid_till: body.valid_till || v.valid_till || null });
  if (status === 'Blacklisted') patch.blacklist_reason = `${reason} (${user.name}, ${today()})`;
  else if (reason) patch.status_note = `${status}: ${reason} (${user.name}, ${today()})`;
  const out = updateRow('vendors', id, patch, user, { system: true });
  audit(user.name, 'vendors', Number(id), `vendor ${status}`, reason);
  return out;
}

// What the data says for a period: on-time delivery (GRN on or before the PO delivery date), quality (IQC accepted share
// of what was inspected), complaint response (SCARs closed by their target date).
export function suggestScores(vendorId, from, to) {
  from = from || `${Number(today().slice(0, 4)) - (today().slice(5, 7) < '04' ? 1 : 0)}-04-01`;
  to = to || today();
  const grn = db.prepare(`SELECT m.date, m.qty, m.qc_status, m.qc_rejected, p.delivery_date FROM stock_moves m JOIN purchase_orders p ON p.id = m.po_id
    WHERE m.type = 'INWARD' AND p.vendor_id = ? AND m.date BETWEEN ? AND ?`).all(Number(vendorId), from, to);
  const dated = grn.filter(g => g.delivery_date);
  const onTime = dated.filter(g => g.date <= g.delivery_date).length;
  const inspected = grn.filter(g => g.qc_status && g.qc_status !== 'Pending' && g.qc_status !== 'Hold');
  const insQty = inspected.reduce((a, g) => a + (Number(g.qty) || 0), 0);
  const okQty = inspected.reduce((a, g) => a + (Number(g.qty) || 0) - (Number(g.qc_rejected) || 0), 0);
  const scars = db.prepare("SELECT status, target_date, closed_on FROM vendor_complaints WHERE vendor_id = ? AND date BETWEEN ? AND ?").all(Number(vendorId), from, to);
  const closedInTime = scars.filter(s => s.status === 'Closed' && (!s.target_date || (s.closed_on && s.closed_on <= s.target_date))).length;
  const out = {
    delivery: dated.length ? Math.round(onTime / dated.length * 100) : null,
    quality: insQty ? Math.round(okQty / insQty * 100) : null,
    response: scars.length ? Math.round(closedInTime / scars.length * 100) : null,
  };
  out.note = [`${from} to ${to}`, dated.length ? `on time ${onTime} of ${dated.length} GRN lines with a PO delivery date` : 'no GRN against a PO with a delivery date',
    insQty ? `IQC accepted ${round2(okQty)} of ${round2(insQty)} inspected` : 'nothing inspected yet', scars.length ? `${closedInTime} of ${scars.length} complaints closed in time` : 'no complaints'].join(' · ');
  return { from, to, ...out };
}

// "Fill from data" on an evaluation: the period's on-time delivery, quality and complaint response, and how they were found.
export function fillEvaluation(id, user) {
  const e = getRow('vendor_evaluations', id);
  if (e.status === 'Final') throw new HttpError(409, 'This evaluation is final');
  const s = suggestScores(e.vendor_id, e.from_date, e.to_date);
  const patch = { data_note: s.note, from_date: e.from_date || s.from, to_date: e.to_date || s.to };
  for (const k of ['delivery', 'quality', 'response']) if (s[k] != null) patch[k] = s[k];
  return updateRow('vendor_evaluations', id, patch, user, { system: true });
}

// After an evaluation is made final: the vendor's rating, band, last review, and the status it earns (a blacklisted
// vendor stays blacklisted).
export function afterEvaluation(id, user) {
  const e = getRow('vendor_evaluations', id);
  if (e.status !== 'Final' || e.total == null) return;
  const v = getRow('vendors', e.vendor_id);
  const patch = { rating: e.total, rating_band: e.band, last_review: e.to_date || e.date || today() };
  if (v.vendor_status !== 'Blacklisted') patch.vendor_status = e.band === 'Under review' ? 'Under review' : e.band;
  db.prepare('UPDATE vendors SET rating = ?, rating_band = ?, last_review = ?, vendor_status = COALESCE(?, vendor_status) WHERE id = ?')
    .run(patch.rating, patch.rating_band, patch.last_review, patch.vendor_status || null, v.id);
  audit(user?.name || 'system', 'vendors', v.id, 'evaluation', `${e.eval_no}: ${e.total}% ${e.band}`);
}

// IQC rejected material: a complaint / SCAR is opened against the vendor (once per GRN line).
export function scarFromIqc(move, status, remarks, user) {
  if (!['Rejected', 'Partly accepted'].includes(status) || !move.vendor_id) return null;
  if (db.prepare('SELECT 1 FROM vendor_complaints WHERE grn_move_id = ?').get(move.id)) return null;
  const qty = status === 'Rejected' ? move.qty : move.qc_rejected;
  return insertRow('vendor_complaints', { date: today(), vendor_id: move.vendor_id, po_id: move.po_id || null, grn_no: move.doc_no, grn_move_id: move.id,
    item: (move.item_id_label || '').split(' · ').slice(1).join(' · ') || move.item_id_label, issue_type: 'Quality (IQC rejection)', qty_affected: qty,
    description: `IQC ${status.toLowerCase()}: ${qty} ${move.uom || ''} rejected. ${remarks || ''}`.trim(), status: 'Open', raised_by: user.name }, user, { system: true });
}

// On-time in-full (OTIF) per vendor per month. Each GRN (one GRN number against one PO) is measured against the first
// date the vendor promised — the PO line's promised_first, else the PO's first_promised, else its delivery date — and
// the quantity ordered on the PO line. A GRN is OTIF when every line it brings came on or before that date and the PO
// line was complete after it (all GRNs on that line up to this one, against the quantity ordered). GRN lines with no
// date or no PO line to compare with are not measured; GRNs with nothing measured are counted as "no promised date".
export const OTIF_TARGET = 85;
const monthsBack = (n, end = today()) => {
  let y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
  const out = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); if (--m === 0) { m = 12; y--; } }
  return out;
};
const pctOf = (a, n) => (n ? Math.round(a / n * 100) : null);
export function otif(q = {}) {
  const months = monthsBack(Math.max(1, Math.min(24, Number(q.months) || 12)), q.to || today());
  const from = `${months[0]}-01`, to = q.to || today();
  // every GRN line against a PO up to the end of the window (earlier ones count towards "complete")
  const moves = db.prepare(`SELECT m.id, m.date, m.doc_no, m.qty, m.item_id, m.po_line, m.po_id, p.vendor_id FROM stock_moves m JOIN purchase_orders p ON p.id = m.po_id
    WHERE m.type = 'INWARD' AND p.vendor_id IS NOT NULL AND m.date <= ? ORDER BY m.date, m.id`).all(to);
  const pos = new Map();
  const poOf = id => {
    if (!pos.has(id)) {
      const p = db.prepare('SELECT id, first_promised, delivery_date, lines FROM purchase_orders WHERE id = ?').get(id);
      let lines = [];
      try { lines = Array.isArray(p.lines) ? p.lines : JSON.parse(p.lines || '[]'); } catch { lines = []; }
      pos.set(id, { ...p, lines: Array.isArray(lines) ? lines : [], got: new Map() });
    }
    return pos.get(id);
  };
  const grns = new Map(); // `${po}|${doc}` → the GRN's verdict
  for (const m of moves) {
    const po = poOf(m.po_id);
    let i = Number.isInteger(m.po_line) && po.lines[m.po_line] ? m.po_line : -1;
    if (i < 0 && m.item_id) i = po.lines.findIndex(l => l.item_id && Number(l.item_id) === Number(m.item_id));
    const got = (po.got.get(i) || 0) + (Number(m.qty) || 0);
    if (i >= 0) po.got.set(i, got);
    if (m.date < from) continue;
    const key = `${m.po_id}|${m.doc_no || m.id}`;
    if (!grns.has(key)) grns.set(key, { vendor_id: m.vendor_id, month: m.date.slice(0, 7), lines: 0, late: 0, short: 0 });
    const g = grns.get(key);
    const l = po.lines[i];
    const due = (l && l.promised_first) || po.first_promised || po.delivery_date || null;
    const ordered = l ? Number(l.qty) || 0 : 0;
    if (!due || !(ordered > 0)) continue;
    g.lines++;
    if (m.date > due) g.late++;
    if (got < ordered - 1e-6) g.short++;
  }
  const vendors = new Map();
  for (const g of grns.values()) {
    if (!vendors.has(g.vendor_id)) vendors.set(g.vendor_id, { vendor_id: g.vendor_id, grns: 0, ot: 0, inf: 0, otif: 0, undated: 0, by: {} });
    const v = vendors.get(g.vendor_id);
    if (!g.lines) { v.undated++; continue; }
    const b = v.by[g.month] || (v.by[g.month] = { n: 0, otif: 0 });
    const ot = !g.late, inf = !g.short;
    v.grns++; b.n++;
    if (ot) v.ot++;
    if (inf) v.inf++;
    if (ot && inf) { v.otif++; b.otif++; }
  }
  const names = new Map(db.prepare('SELECT id, name, vendor_code, vendor_status FROM vendors').all().map(r => [r.id, r]));
  const rows = [...vendors.values()].map(v => {
    const n = names.get(v.vendor_id) || {};
    const trend = months.map(mo => (v.by[mo] ? { month: mo, n: v.by[mo].n, otif: v.by[mo].otif, pct: pctOf(v.by[mo].otif, v.by[mo].n) } : { month: mo, n: 0, otif: 0, pct: null }));
    const last = [...trend].reverse().find(t => t.n);
    const pct = pctOf(v.otif, v.grns);
    return { vendor_id: v.vendor_id, name: n.name || `Vendor ${v.vendor_id}`, vendor_code: n.vendor_code || '', vendor_status: n.vendor_status || '',
      grns: v.grns, otif: v.otif, pct, on_time: pctOf(v.ot, v.grns), in_full: pctOf(v.inf, v.grns), undated: v.undated, trend,
      last_month: last ? last.month : null, last_pct: last ? last.pct : null, below: pct != null && pct < OTIF_TARGET };
  });
  // worst first; vendors with nothing measured go last
  rows.sort((a, b) => (a.pct == null) - (b.pct == null) || (a.pct ?? 0) - (b.pct ?? 0) || b.grns - a.grns || a.name.localeCompare(b.name));
  const total = rows.reduce((a, r) => ({ grns: a.grns + r.grns, otif: a.otif + r.otif, undated: a.undated + r.undated }), { grns: 0, otif: 0, undated: 0 });
  const overall = months.map(mo => {
    const n = rows.reduce((a, r) => a + r.trend.find(t => t.month === mo).n, 0), ok = rows.reduce((a, r) => a + r.trend.find(t => t.month === mo).otif, 0);
    return { month: mo, n, otif: ok, pct: pctOf(ok, n) };
  });
  return { target: OTIF_TARGET, from, to, months, rows, overall, total: { ...total, pct: pctOf(total.otif, total.grns) } };
}

// Every vendor with its code, status, rating and what the data says (approved vendor list + performance dashboard).
export function performance(q = {}) {
  const from = q.from || `${Number(today().slice(0, 4)) - (today().slice(5, 7) < '04' ? 1 : 0)}-04-01`;
  const rows = db.prepare(`SELECT v.id, v.vendor_code, v.name, v.code_group, v.category, v.city, v.vendor_status, v.rating, v.rating_band, v.last_review, v.valid_till, v.critical, v.approved_on,
      (SELECT COUNT(*) FROM purchase_orders p WHERE p.vendor_id = v.id AND p.status NOT IN ('Archived (old)', 'Cancelled', 'Rejected', 'Draft') AND p.date >= ?) pos,
      (SELECT COALESCE(SUM(p.total), 0) FROM purchase_orders p WHERE p.vendor_id = v.id AND p.status NOT IN ('Archived (old)', 'Cancelled', 'Rejected', 'Draft') AND p.date >= ?) po_value,
      (SELECT COUNT(*) FROM vendor_complaints c WHERE c.vendor_id = v.id AND c.status <> 'Closed') open_scars
    FROM vendors v ORDER BY v.vendor_code`).all(from, from);
  for (const r of rows) {
    const s = suggestScores(r.id, from, today());
    Object.assign(r, { otd: s.delivery, quality: s.quality, due_review: !r.last_review || r.last_review < new Date(Date.now() - 183 * 864e5).toLocaleString('sv-SE').slice(0, 10),
      expired: r.valid_till && r.valid_till < today() });
  }
  const o = otif({ months: q.months });
  const byVendor = new Map(o.rows.map(r => [r.vendor_id, r]));
  for (const r of rows) { const x = byVendor.get(r.id); r.otif = x ? x.pct : null; r.otif_below = !!(x && x.below); }
  return { from, rows, otif: o };
}
