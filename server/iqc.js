// Incoming inspection (IQC) by material group: each item category can have its own inspector (Settings → IQC
// inspectors: "Electrical (BGM) | Omkar Sathe"). A GRN tells that inspector, its lines wait in their My tasks until
// inspected, and the IQC report of a GRN is printed from the inspection results. Lines of a category without an
// inspector go to everyone allowed to inspect (function iqc_inspect), as before.
import { db, getSettings, setSettings } from './db.js';
import { HttpError } from './crud.js';
import { hasFunction, canView } from '../public/js/schema.js';
import { notify } from './notify.js';

const norm = s => String(s || '').trim().toLowerCase();
// "Category | Person" lines → Map(category → person)
export function routing() {
  const raw = getSettings().iqc_routing;
  const lines = Array.isArray(raw) ? raw : String(raw || '').split('\n');
  const map = new Map();
  for (const l of lines) { const [c, p] = String(l).split('|').map(x => x.trim()); if (c && p) map.set(norm(c), p); }
  return map;
}
export const inspectorOf = category => routing().get(norm(category)) || null;

// The owner's direction (20 Nov 2026): electrical and electronic material is inspected by Omkar Sathe. Set once, editable.
export function seedRouting() {
  const s = getSettings();
  if (s.iqc_routing_v1) return;
  const omkar = db.prepare("SELECT name FROM users WHERE active = 1 AND lower(name) LIKE 'omkar%' ORDER BY id LIMIT 1").get()?.name;
  if (omkar && !s.iqc_routing) setSettings({ iqc_routing: [`Electrical (BGM) | ${omkar}`, `R&D (Electronic) | ${omkar}`] });
  setSettings({ iqc_routing_v1: '1' });
}

const mayIqc = user => hasFunction(user.role, 'iqc_inspect') || canView('stock_moves', user.role);
export const mayInspect = user => hasFunction(user.role, 'iqc_inspect');

// GRN lines waiting for inspection, each with the inspector it is for; mine = only the ones for this person
// (their own category, or a category without an inspector).
export function pending(user, { mine = false } = {}) {
  if (!mayIqc(user)) throw new HttpError(403, 'No access to incoming inspection');
  const map = routing();
  const rows = db.prepare(`SELECT m.id, m.date, m.doc_no, m.po_no, m.qty, m.uom, m.batch_no, COALESCE(m.rack, i.location) rack, m.qc_status, i.code, i.name item, i.uom item_uom, i.category,
      COALESCE(v.name, m.supplier) vendor, m.invoice_no, CAST(julianday('now', 'localtime') - julianday(m.date) AS INTEGER) age
    FROM stock_moves m JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id
    WHERE m.type = 'INWARD' AND m.qc_status IN ('Pending', 'Hold') ORDER BY m.date, m.doc_no, m.id`).all()
    .map(r => ({ ...r, inspector: map.get(norm(r.category)) || null }));
  // A named inspector sees their own groups only; other inspectors see the groups nobody is named for.
  const named = [...map.values()].some(p => norm(p) === norm(user.name));
  return mine ? rows.filter(r => (r.inspector ? norm(r.inspector) === norm(user.name) : !named && mayInspect(user))) : rows;
}

// For My tasks: one item per GRN with lines waiting for this person.
export function myIqcItems(user) {
  if (!mayInspect(user)) return [];
  const byGrn = new Map();
  for (const r of pending(user, { mine: true })) {
    const k = `${r.doc_no}|${r.date}`;
    const g = byGrn.get(k) || { doc_no: r.doc_no, date: r.date, vendor: r.vendor, n: 0, cats: new Set(), age: r.age, hold: 0 };
    g.n++; g.cats.add(r.category || 'other'); if (r.qc_status === 'Hold') g.hold++; g.age = Math.max(g.age, r.age);
    byGrn.set(k, g);
  }
  return [...byGrn.values()].map(g => ({
    title: `IQC of GRN ${g.doc_no}: ${g.n} line${g.n === 1 ? '' : 's'}${g.hold ? ` (${g.hold} on hold)` : ''}`,
    sub: [g.vendor, [...g.cats].join(', '), `received ${g.date.split('-').reverse().join('-')}`].filter(Boolean).join(' · '),
    link: `#/lots?tab=iqc&mine=1&q=${encodeURIComponent(g.doc_no)}`, late: g.age > 2, due: g.date,
  }));
}

// After a GRN: tell each inspector of its categories; categories without one go to everyone who inspects.
export function notifyGrn(docNo, date, user) {
  try {
    const rows = db.prepare(`SELECT i.category, i.name FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.type = 'INWARD' AND m.doc_no = ? AND m.date = ? AND m.qc_status = 'Pending'`).all(docNo, date);
    if (!rows.length) return 0;
    const map = routing(), by = new Map();
    for (const r of rows) { const who = map.get(norm(r.category)) || ''; by.set(who, [...(by.get(who) || []), r]); }
    const supplier = db.prepare("SELECT COALESCE(v.name, m.supplier) s FROM stock_moves m LEFT JOIN vendors v ON v.id = m.vendor_id WHERE m.type = 'INWARD' AND m.doc_no = ? AND m.date = ? LIMIT 1").get(docNo, date)?.s;
    let told = 0;
    for (const [who, list] of by) {
      const msg = { kind: 'iqc', title: `🔍 IQC needed: GRN ${docNo} – ${list.length} item${list.length === 1 ? '' : 's'}`,
        body: [supplier, list.slice(0, 3).map(x => x.name).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '')].filter(Boolean).join(' · '),
        link: `#/lots?tab=iqc&mine=1&q=${encodeURIComponent(docNo)}` };
      // a group without its own inspector: everyone allowed to inspect who is not named for other groups
      const general = () => db.prepare('SELECT name, role FROM users WHERE active = 1').all().filter(u => hasFunction(u.role, 'iqc_inspect') && ![...map.values()].some(p => norm(p) === norm(u.name))).map(u => u.name);
      told += notify({ ...msg, userNames: who ? [who] : general() }, user);
    }
    return told;
  } catch (e) { console.error('IQC notify', e.message); return 0; }
}

// The IQC report of one GRN: what was received, accepted and rejected, by whom, with the remarks.
export function report(docNo, date, user) {
  if (!mayIqc(user)) throw new HttpError(403, 'No access to incoming inspection');
  const lines = db.prepare(`SELECT m.id, m.date, m.doc_no, m.po_no, m.invoice_no, m.invoice_date, m.qty, m.uom, m.batch_no, m.qc_status, m.qc_rejected, m.qc_by, m.qc_at, m.qc_remarks,
      i.code, i.name item, i.uom item_uom, i.category, COALESCE(v.name, m.supplier) vendor, p.name project
    FROM stock_moves m JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.type = 'INWARD' AND m.doc_no = ?${date ? ' AND m.date = ?' : ''} ORDER BY m.id`).all(...(date ? [docNo, date] : [docNo]));
  if (!lines.length) throw new HttpError(404, `GRN ${docNo} not found`);
  const map = routing();
  return { doc_no: docNo, date: lines[0].date, vendor: lines[0].vendor, po_no: lines[0].po_no, invoice_no: lines[0].invoice_no, invoice_date: lines[0].invoice_date,
    lines: lines.map(l => ({ ...l, accepted: l.qc_status === 'Rejected' ? 0 : ['Accepted', 'Partly accepted'].includes(l.qc_status) ? Math.round((Number(l.qty) - (Number(l.qc_rejected) || 0)) * 1000) / 1000 : null, inspector: map.get(norm(l.category)) || null })),
    inspectors: [...new Set(lines.map(l => l.qc_by).filter(Boolean))], open: lines.filter(l => ['Pending', 'Hold'].includes(l.qc_status)).length };
}

// GRNs inspected lately (for printing their reports again).
export function recent(user, days = 30) {
  if (!mayIqc(user)) throw new HttpError(403, 'No access to incoming inspection');
  return db.prepare(`SELECT m.doc_no, m.date, COALESCE(MAX(v.name), MAX(m.supplier)) vendor, COUNT(*) lines, SUM(m.qc_status = 'Rejected') rejected, SUM(m.qc_status = 'Partly accepted') partly,
      SUM(m.qc_status IN ('Pending', 'Hold')) open, MAX(m.qc_at) last, GROUP_CONCAT(DISTINCT m.qc_by) by_
    FROM stock_moves m LEFT JOIN vendors v ON v.id = m.vendor_id
    WHERE m.type = 'INWARD' AND m.qc_at >= datetime('now', 'localtime', ?) GROUP BY m.doc_no, m.date ORDER BY last DESC LIMIT 200`).all(`-${Number(days) || 30} days`);
}
