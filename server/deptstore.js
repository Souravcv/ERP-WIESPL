// Department stores (Store → Department Stores): material the main store has transferred to a department (or sent to a
// job-work vendor / place) is still traced there. Per place: what came in (transfer / job work out), what came back
// (return to store, job work in), what was used (production entries, for Production) and the balance it holds — and
// the slips behind it. A place is a department when its name starts with one (e.g. "Production - Lokmanya").
import { db, tx } from './db.js';
import { stockEntry } from './stock.js';
import { HttpError } from './crud.js';
import { canView, canWrite, hasFunction, COMPANY_DEPARTMENTS } from '../public/js/schema.js';

const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const norm = s => String(s || '').trim().toLowerCase();
const DEPTS = COMPANY_DEPARTMENTS.map(d => ({ name: d, key: norm(d) }));
// The place a location text belongs to: the department it starts with, else the text itself.
export function placeOf(text) {
  const t = norm(text);
  if (!t || t === 'store' || t === 'main store') return null;
  const d = DEPTS.find(x => t === x.key || t.startsWith(`${x.key} `) || t.startsWith(`${x.key}-`) || t.startsWith(`${x.key} -`));
  return d ? d.name : String(text).trim();
}
const mayView = user => { if (!canView('stock_moves', user.role) && !hasFunction(user.role, 'production_post')) throw new HttpError(403, 'No access to the store'); };

// Every movement that puts material at a place or takes it back, as { place, item_id, kind, qty, move }.
function flows() {
  const out = [];
  const moves = db.prepare(`SELECT m.id, m.type, m.date, m.doc_no, m.item_id, m.qty, m.from_location, m.to_location, m.issued_to, m.supplier, v.name vendor, p.name project
    FROM stock_moves m LEFT JOIN vendors v ON v.id = m.vendor_id LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.type IN ('TRANSFER', 'JOB_OUT', 'JOB_IN', 'RETURN', 'OUTWARD', 'MOVE')`).all();
  for (const m of moves) {
    if (m.type === 'TRANSFER' || m.type === 'JOB_OUT') { const p = placeOf(m.to_location); if (p) out.push({ place: p, item_id: m.item_id, kind: 'in', qty: m.qty, m }); }
    else if (m.type === 'MOVE') {
      const a = placeOf(m.from_location), b = placeOf(m.to_location);
      if (a) out.push({ place: a, item_id: m.item_id, kind: 'out', qty: m.qty, m });
      if (b) out.push({ place: b, item_id: m.item_id, kind: 'in', qty: m.qty, m });
    } else if (m.type === 'JOB_IN') { const p = placeOf(m.vendor || m.supplier); if (p) out.push({ place: p, item_id: m.item_id, kind: 'back', qty: m.qty, m }); }
    else if (m.type === 'RETURN') { const p = placeOf(m.issued_to); if (p && DEPTS.some(d => d.name === p)) out.push({ place: p, item_id: m.item_id, kind: 'back', qty: m.qty, m }); }
    else if (m.type === 'OUTWARD') { const p = placeOf(m.issued_to); if (p && DEPTS.some(d => d.name === p)) out.push({ place: p, item_id: m.item_id, kind: 'issued', qty: m.qty, m }); }
  }
  // what production used from its stock (posted production entries)
  for (const u of db.prepare(`SELECT p.id, p.entry_no, p.date, CAST(json_extract(j.value, '$.item_id') AS INTEGER) item_id, CAST(json_extract(j.value, '$.qty') AS REAL) qty
      FROM production_entries p, json_each(COALESCE(NULLIF(p.lines, ''), '[]')) j WHERE p.status = 'Posted' AND json_extract(j.value, '$.item_id') IS NOT NULL`).all()) {
    out.push({ place: 'Production', item_id: u.item_id, kind: 'used', qty: u.qty, m: { id: null, type: 'PRODUCED', date: u.date, doc_no: u.entry_no, production_id: u.id } });
  }
  return out;
}

const isDept = name => DEPTS.some(d => d.name === name);

// All places with what they hold (departments first).
export function places(user) {
  mayView(user);
  const prices = hasFunction(user.role, 'see_stock_value');
  const rate = new Map(db.prepare('SELECT id, rate FROM items').all().map(i => [i.id, Number(i.rate) || 0]));
  const by = new Map();
  for (const f of flows()) {
    const p = by.get(f.place) || { place: f.place, department: isDept(f.place), items: new Map(), last: '' };
    const it = p.items.get(f.item_id) || { in: 0, back: 0, out: 0, used: 0, issued: 0 };
    it[f.kind] = r3(it[f.kind] + Number(f.qty || 0));
    p.items.set(f.item_id, it);
    if (f.m.date > p.last) p.last = f.m.date;
    by.set(f.place, p);
  }
  const rows = [...by.values()].map(p => {
    const list = [...p.items.entries()].map(([id, x]) => ({ id, bal: r3(x.in - x.back - x.out - x.used) }));
    const holding = list.filter(x => x.bal > 0);
    return { place: p.place, department: p.department, items_held: holding.length, items_ever: list.length, last: p.last,
      value: prices ? Math.round(holding.reduce((s, x) => s + x.bal * (rate.get(x.id) || 0), 0)) : null };
  });
  // every department is listed, even with nothing yet
  for (const d of DEPTS) if (!rows.some(r => r.place === d.name)) rows.push({ place: d.name, department: true, items_held: 0, items_ever: 0, last: '', value: prices ? 0 : null });
  rows.sort((a, b) => (b.department - a.department) || b.items_held - a.items_held || a.place.localeCompare(b.place));
  return { rows, prices };
}

// One place: its inventory item by item and the slips behind it.
export function placeDetail(place, user) {
  mayView(user);
  const prices = hasFunction(user.role, 'see_stock_value');
  const fl = flows().filter(f => f.place === place);
  const items = new Map(db.prepare('SELECT id, code, name, uom, rate, category FROM items').all().map(i => [i.id, i]));
  const by = new Map();
  for (const f of fl) {
    const x = by.get(f.item_id) || { item_id: f.item_id, in: 0, back: 0, out: 0, used: 0, issued: 0, last: '' };
    x[f.kind] = r3(x[f.kind] + Number(f.qty || 0));
    if (f.m.date > x.last) x.last = f.m.date;
    by.set(f.item_id, x);
  }
  const rows = [...by.values()].map(x => {
    const it = items.get(x.item_id) || {};
    const balance = r3(x.in - x.back - x.out - x.used);
    return { ...x, code: it.code, name: it.name, uom: it.uom, category: it.category, balance, value: prices ? Math.round(Math.max(0, balance) * (Number(it.rate) || 0)) : null };
  }).filter(x => x.name).sort((a, b) => (b.balance > 0) - (a.balance > 0) || String(a.name).localeCompare(String(b.name)));
  const KIND = { in: 'Received', back: 'Returned to store', out: 'Moved to another department / place', used: 'Used (production)', issued: 'Issued to the department' };
  const trail = fl.filter(f => f.m.date).sort((a, b) => String(b.m.date).localeCompare(String(a.m.date)) || (b.m.id || 0) - (a.m.id || 0)).slice(0, 400)
    .map(f => ({ date: f.m.date, kind: KIND[f.kind], type: f.m.type, doc_no: f.m.doc_no, item: [items.get(f.item_id)?.code, items.get(f.item_id)?.name].filter(Boolean).join(' · '), qty: f.qty, uom: items.get(f.item_id)?.uom,
      where: f.m.type === 'MOVE' ? `${f.m.from_location} → ${f.m.to_location}` : f.m.type === 'RETURN' ? 'Store' : f.m.to_location || f.m.issued_to || f.m.vendor || f.m.supplier || '', project: f.m.project || '', production_id: f.m.production_id || null }));
  return { place, department: isDept(place), prices, rows, trail,
    totals: { held: rows.filter(r => r.balance > 0).length, value: prices ? rows.reduce((s, r) => s + (r.value || 0), 0) : null } };
}

// Material a department / place sends on (owner, 21 Nov 2026): to the main store it is a return (store stock goes up);
// to another department or place it is a department transfer (the main store's stock does not change). A department
// can send only what it holds.
export function deptMove(body, user) {
  if (!canWrite('stock_moves', user.role)) throw new HttpError(403, 'Only the store can move material between departments');
  const from = placeOf(body?.from), toText = String(body?.to || '').trim();
  if (!from) throw new HttpError(400, 'Choose the department / place the material comes from');
  const to = placeOf(toText);
  if (to === from) throw new HttpError(400, 'From and To are the same');
  const lines = (body.lines || []).filter(l => l.item_id && Number(l.qty) > 0);
  if (!lines.length) throw new HttpError(400, 'Add at least one item with a quantity');
  const held = new Map(placeDetail(from, user).rows.map(r => [r.item_id, r.balance]));
  const want = new Map();
  for (const l of lines) want.set(Number(l.item_id), r3((want.get(Number(l.item_id)) || 0) + Number(l.qty)));
  const short = [...want].filter(([id, q]) => q > (held.get(id) || 0) + 1e-9).map(([id, q]) => {
    const it = db.prepare('SELECT code, name, uom FROM items WHERE id = ?').get(id) || {};
    return `${it.code || ''} ${it.name || id}: ${from} holds ${r3(held.get(id) || 0)} ${it.uom || ''}, moving ${q}`;
  });
  if (short.length) throw new HttpError(409, `More than ${from} holds:\n${short.join('\n')}`);
  const common = { date: body.date, project_id: body.project_id || null, requested_by: body.requested_by || null, remarks: body.remarks || null,
    lines: lines.map(l => ({ item_id: Number(l.item_id), qty: Number(l.qty), uom: l.uom || null, remark: l.remark || null, project_id: l.project_id || null })) };
  return tx(() => (!to
    ? stockEntry({ ...common, type: 'RETURN', issued_to: from, reason: `Transferred back to store from ${from}`, purpose: `From ${from} to the main store` }, user)
    : stockEntry({ ...common, type: 'MOVE', from_location: from, to_location: toText, purpose: body.purpose || `${from} → ${toText}` }, user)));
}
