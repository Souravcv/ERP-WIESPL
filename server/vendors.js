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
  return { from, rows };
}
