// Material tracker of a project: every material it needs, from the BOQ shortage to the PO and its receipt, with the
// date it is needed (by the dispatch day of the site plan, else the BOQ's required-by date) and the date the vendor
// promised. One status per line, worst first, so late material is seen before it stops the site.
import { db, audit } from './db.js';
import { getRow, HttpError } from './crud.js';
import { canView, canWrite, hasFunction } from '../public/js/schema.js';
import { stockCheck, isLocked } from './boqflow.js';
import { stockOf } from './stock.js';
import { lastFollowups } from './pofollow.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const addDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const parse = s => { try { return JSON.parse(s || '[]') || []; } catch { return []; } };
const APPROVED = ['Approved', 'Sent', 'Partially Received', 'Received', 'Closed'];
const DEFAULT_LEAD_DAYS = 7;

// worst first: what will stop the site comes to the top
export const STATES = ['Not ordered', 'Overdue', 'Promised late', 'No date from vendor', 'Requisition, no PO yet', 'PO not approved', 'On track', 'Part received', 'Received'];

export const mayView = user => canView('purchase_orders', user.role) || canView('projects', user.role);
export const mayEdit = user => canWrite('purchase_orders', user.role) || hasFunction(user.role, 'po_check');

// the day material must be in the store: the day before the site plan's dispatch day, else the BOQ's required-by date
export function neededBy(projectId) {
  const site = db.prepare("SELECT plan_start FROM schedule_activities WHERE project_id = ? AND journey_step = 's26'").get(projectId)?.plan_start;
  if (site) return { date: addDays(site, -1), from: `the day before dispatch (${site.split('-').reverse().join('-')}, from the site plan)` };
  const bom = db.prepare("SELECT required_by FROM boms WHERE project_id = ? AND required_by IS NOT NULL AND required_by <> '' ORDER BY required_by LIMIT 1").get(projectId)?.required_by;
  if (bom) return { date: bom, from: 'the BOQ required-by date' };
  return { date: null, from: 'no site plan or BOQ date yet: set a needed-by date on the lines' };
}

export function projectMaterials(projectId, user) {
  if (!mayView(user)) throw new HttpError(403, 'No access to material tracking');
  const p = getRow('projects', projectId), pid = Number(projectId), t = today();
  const ros = neededBy(pid);
  const rows = [], follow = lastFollowups();
  // 1. purchase order lines for this project
  const pos = db.prepare(`SELECT p.*, v.name vendor FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE p.status NOT IN ('Cancelled', 'Archived (old)') AND (p.project_id = ? OR p.lines LIKE '%"project_id"%') ORDER BY p.date, p.id`).all(pid);
  for (const po of pos) {
    let heading = '';
    parse(po.lines).forEach((l, i) => {
      if (l.description) heading = l.description;
      const qty = Number(l.qty) || 0;
      if (!qty) return;
      const lp = l.project_id ? Number(l.project_id) : po.project_id;
      if (lp !== pid) return;
      const received = Number(l.received) || 0, approved = APPROVED.includes(po.status);
      const need = l.need_by || ros.date || null, promised = l.promised || po.delivery_date || null;
      const state = received >= qty - 1e-9 ? 'Received' : !approved ? 'PO not approved' : received > 0 && promised && promised >= t ? 'Part received'
        : !promised ? 'No date from vendor' : promised < t ? 'Overdue' : need && promised > need ? 'Promised late' : received > 0 ? 'Part received' : 'On track';
      rows.push({ kind: 'po', po_id: po.id, line: i, po_no: po.po_no, po_date: po.date, po_status: po.status, vendor: po.vendor,
        item: [l.description || heading, l.spec && !l.description ? String(l.spec).split('\n')[0] : ''].filter(Boolean).join(' – '), uom: l.uom, qty, received,
        need_by: need, need_set: !!l.need_by, promised, promised_set: !!l.promised, state, follow: follow.get(po.id) || null,
        late_days: state === 'Received' ? 0 : need && promised && promised > need ? days(need, promised) : promised && promised < t ? days(promised, t) : 0 });
    });
  }
  // 2. requisitions not on a PO yet
  for (const r of db.prepare("SELECT id, req_no, date, required_by, status, lines FROM requisitions WHERE project_id = ? AND status IN ('Submitted', 'Approved')").all(pid)) {
    for (const l of parse(r.lines)) {
      if (!(Number(l.qty) > 0)) continue;
      const need = r.required_by || ros.date || null;
      rows.push({ kind: 'req', req_id: r.id, req_no: r.req_no, item: l.description || l.item_id_label || '', uom: l.uom, qty: Number(l.qty), received: 0, need_by: need,
        promised: null, state: 'Requisition, no PO yet', req_status: r.status, late_days: need && need < t ? days(need, t) : 0 });
    }
  }
  // 3. BOQ shortages nobody has asked for yet
  for (const b of db.prepare("SELECT id FROM boms WHERE project_id = ? AND status IN ('Final', 'In Progress')").all(pid)) {
    const bom = getRow('boms', b.id);
    if (!isLocked(bom)) continue;
    for (const r of stockCheck(b.id).rows.filter(x => x.to_requisition > 0)) {
      const need = ros.date || bom.required_by || null;
      const orderBy = need ? addDays(need, -(r.lead_days ?? DEFAULT_LEAD_DAYS)) : r.order_by;
      rows.push({ kind: 'boq', bom_id: b.id, bom_no: bom.bom_no, item: [r.component, r.dimensions].filter(Boolean).join(' '), uom: r.uom, qty: r.to_requisition, received: 0,
        need_by: need, order_by: orderBy, lead_days: r.lead_days, promised: null, state: 'Not ordered', late_days: orderBy && orderBy < t ? days(orderBy, t) : 0 });
    }
  }
  rows.sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || b.late_days - a.late_days || String(a.need_by || '9').localeCompare(String(b.need_by || '9')));
  const count = Object.fromEntries(STATES.map(s => [s, rows.filter(r => r.state === s).length]));
  return { project: { id: p.id, name: p.name, no: p.project_no || p.code }, needed_by: ros, today: t, rows, count, can_edit: mayEdit(user), to_link: unlinkedPos(pid),
    ready: rows.length > 0 && rows.every(r => r.state === 'Received'), store: storeReadiness(pid) };
}

// the needed-by and promised dates of one PO line: tracking dates, kept even on an approved PO
export function setLineDates(poId, line, body, user) {
  if (!mayEdit(user)) throw new HttpError(403, 'Only purchase can change PO dates');
  const po = getRow('purchase_orders', poId);
  const lines = Array.isArray(po.lines) ? po.lines : parse(po.lines);
  const l = lines[Number(line)];
  if (!l) throw new HttpError(404, 'PO line not found');
  const ok = v => v === null || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  const changes = [];
  for (const k of ['need_by', 'promised']) if (k in (body || {})) {
    if (!ok(body[k])) throw new HttpError(400, 'Dates are YYYY-MM-DD');
    const v = body[k] || null;
    if ((l[k] || null) !== v) {
      changes.push(`${k === 'need_by' ? 'needed by' : 'promised'} ${v || '—'}`);
      if (v) l[k] = v; else delete l[k];
      if (k === 'promised' && v && !l.promised_first) l.promised_first = v; // the first date the vendor gave: the vendor is measured against it
    }
  }
  if (!changes.length) return { ok: true };
  db.prepare('UPDATE purchase_orders SET lines = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(lines), new Date().toLocaleString('sv-SE').slice(0, 19), po.id);
  audit(user.name, 'purchase_orders', po.id, 'update', `line ${Number(line) + 1}: ${changes.join(', ')}`);
  return { ok: true };
}

// ---------------------------------------------------------------- linking POs to their project
// Most POs carry the project only as text ("WIESPL / 1011 / 08 /2026-27 Dr. Chandramother – Lucknow"). A PO is matched
// to a project by its work order number (1011 / 08 / 2026-27), else by a word of the hospital's name, and purchase links it
// with one click (a tracking link: allowed on an approved PO too).
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const woOf = s => { const m = String(s || '').match(/(\d{3,4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/); return m ? `${Number(m[1])}/${Number(m[2])}/${m[3]}` : null; };
const STOP = new Set(['hospital', 'hospitals', 'wiespl', 'order', 'work', 'research', 'center', 'centre', 'referral', 'medical', 'passage', 'mother']);
const nameKeys = p => String(p.name || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 5 && !STOP.has(w));
export function suggestProject(note, projects) {
  const wo = woOf(note);
  if (wo) { const p = projects.find(x => woOf(x.name) === wo || woOf(x.project_no) === wo); if (p) return { id: p.id, why: `work order ${wo}` }; }
  const n = norm(note);
  if (!n) return null;
  const hits = projects.map(p => ({ p, k: nameKeys(p).filter(w => n.includes(w)) })).filter(x => x.k.length).sort((a, b) => b.k.length - a.k.length);
  return hits.length && (hits.length === 1 || hits[0].k.length > hits[1].k.length) ? { id: hits[0].p.id, why: `name: ${hits[0].k.join(', ')}` } : null;
}
const openProjects = () => db.prepare("SELECT id, project_no, name FROM projects WHERE COALESCE(status, '') NOT IN ('Cancelled')").all();
// open POs with no project, with the project they look like
export function unlinkedPos(projectId = null) {
  const projects = openProjects();
  return db.prepare(`SELECT p.id, p.po_no, p.date, p.status, p.project_note, v.name vendor FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE p.project_id IS NULL AND p.status NOT IN ('Cancelled', 'Archived (old)', 'Closed') AND COALESCE(p.lines, '') NOT LIKE '%"project_id"%' ORDER BY p.date DESC, p.id DESC`).all()
    .map(p => ({ ...p, suggest: suggestProject(p.project_note, projects) })).filter(p => !projectId || p.suggest?.id === Number(projectId));
}
export function linkPo(poId, body, user) {
  if (!mayEdit(user)) throw new HttpError(403, 'Only purchase can link POs to projects');
  const po = getRow('purchase_orders', poId);
  const pid = body?.project_id ? Number(body.project_id) : null;
  if (pid) getRow('projects', pid);
  db.prepare('UPDATE purchase_orders SET project_id = ?, updated_at = ? WHERE id = ?').run(pid, new Date().toLocaleString('sv-SE').slice(0, 19), po.id);
  audit(user.name, 'purchase_orders', po.id, 'update', pid ? `linked to project ${pid}` : 'project link removed');
  return { ok: true };
}

// projects with something to track, for the picker
export function trackedProjects(user) {
  if (!mayView(user)) throw new HttpError(403, 'No access to material tracking');
  const sug = new Map();
  for (const p of unlinkedPos()) if (p.suggest) sug.set(p.suggest.id, (sug.get(p.suggest.id) || 0) + 1);
  const linked = new Map(db.prepare("SELECT project_id, COUNT(*) n FROM purchase_orders WHERE project_id IS NOT NULL AND status NOT IN ('Cancelled', 'Archived (old)') GROUP BY project_id").all().map(r => [r.project_id, r.n]));
  return { projects: db.prepare("SELECT id, COALESCE(NULLIF(project_no, ''), code) no, name, status FROM projects WHERE COALESCE(status, '') NOT IN ('Completed', 'Cancelled') ORDER BY id DESC").all()
    .map(p => ({ ...p, pos: linked.get(p.id) || 0, to_link: sug.get(p.id) || 0 })), unlinked: unlinkedPos().length };
}

// ---------------------------------------------------------------- store check before the one-time dispatch
// Is every material of the project's Final BOQ(s) in the store, received AND passed by incoming QC? Only shows; it blocks nothing.
// A line is ready when the store holds what it still needs (stock reserved for it) from lots that are not on IQC Pending / Hold
// and not rejected. Else it is listed as missing with why: no store item, not ordered, on order, in store but QC pending, ...
export function storeReadiness(projectId) {
  const pid = Number(projectId);
  const boms = db.prepare("SELECT id FROM boms WHERE project_id = ? AND status IN ('Final', 'In Progress')").all(pid).map(b => getRow('boms', b.id)).filter(isLocked);
  if (!boms.length) return { has_boq: false, lines: 0, ready: 0, missing: [], complete: false };
  // quantity of each item sitting in the store that is not usable yet: IQC pending / on hold, or rejected
  const unusable = new Map();
  for (const m of db.prepare("SELECT item_id, qty, qc_status, qc_rejected FROM stock_moves WHERE type = 'INWARD' AND item_id IS NOT NULL AND (qc_status IN ('Pending', 'Hold') OR COALESCE(qc_rejected, 0) > 0)").all()) {
    const u = ['Pending', 'Hold'].includes(m.qc_status) ? Number(m.qty) || 0 : Number(m.qc_rejected) || 0;
    unusable.set(m.item_id, { qty: (unusable.get(m.item_id)?.qty || 0) + u, hold: unusable.get(m.item_id)?.hold || m.qc_status === 'Hold', pending: unusable.get(m.item_id)?.pending || m.qc_status === 'Pending' });
  }
  const pool = new Map(); // QC-passed stock of an item still to give to this project's lines
  const poolOf = id => { if (!pool.has(id)) pool.set(id, Math.max(0, stockOf(id) - (unusable.get(id)?.qty || 0))); return pool.get(id); };
  const missing = []; let lines = 0, ready = 0;
  for (const bom of boms) for (const r of stockCheck(bom.id).rows) {
    if (!(r.still_needed > 0)) continue; // already sent
    lines++;
    let have = 0;
    if (r.item_id && !r.in_house) { have = Math.min(r.reserved, poolOf(r.item_id)); pool.set(r.item_id, poolOf(r.item_id) - have); }
    const short = Math.round((r.still_needed - have) * 1000) / 1000;
    if (short <= 1e-9) { ready++; continue; }
    const u = r.item_id && unusable.get(r.item_id);
    const why = r.in_house ? 'Made in-house: not in the store yet' : !r.item_id ? 'No store item linked to this BOQ line'
      : r.reserved > have && u?.hold ? 'In the store, but IQC is on Hold' : r.reserved > have && u?.pending ? 'In the store, but IQC (incoming QC) is pending'
      : r.reserved > have && u ? 'In the store, but part was rejected by IQC'
      : r.on_order > 0 ? 'Ordered, not received yet' : 'Not ordered';
    missing.push({ bom_id: bom.id, bom_no: bom.bom_no, item: [r.component, r.dimensions].filter(Boolean).join(' '), uom: r.uom, needed: r.still_needed, in_store: Math.round(have * 1000) / 1000, short, why });
  }
  return { has_boq: true, lines, ready, missing, complete: lines > 0 && !missing.length, boqs: boms.map(b => b.bom_no) };
}
