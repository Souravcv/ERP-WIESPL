// Store-led material flow: material requests (anyone → store), the store's split into issue / MTN drafts and purchase
// requisitions, production entries (finished goods made from the production stock), and lead times from PO to GRN.
import { db, tx, audit } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { stockOf } from './stock.js';
import { freeStock } from './boqflow.js';
import { submitForApproval } from './workflows.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const projectOf = (table, id) => (id ? db.prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(Number(id))?.project_id : null) || null;
export const PRODUCTION = 'Production';

// ---------------------------------------------------------------- draft issue slips / dispatch challans / MTNs
const DRAFT_KEYS = ['type', 'date', 'doc_no', 'po_id', 'project_id', 'issued_to', 'requested_by', 'from_location', 'to_location', 'purpose', 'remarks', 'boq_id', 'bom_id',
  'make_challan', 'challan', 'vendor_id', 'ship_to', 'vehicle_no', 'transporter', 'driver', 'challan_type', 'lines'];
export function draftRow(body) {
  const type = body?.type;
  if (!['OUTWARD', 'TRANSFER'].includes(type)) throw new HttpError(400, 'Only issue slips, dispatch challans and material transfer notes are saved as drafts');
  const lines = (body.lines || []).filter(l => l.item_id && Number(l.qty)).map(l => { const { poPending, boqPending, ...rest } = l; return rest; });
  if (!lines.length) throw new HttpError(400, 'Add at least one item with a quantity');
  if (type === 'TRANSFER' && !body.to_location) throw new HttpError(400, 'Enter where the material is transferred to');
  const challan = !!(body.make_challan || body.bom_id || body.boq_id);
  const payload = Object.fromEntries(DRAFT_KEYS.filter(k => body[k] !== undefined && body[k] !== '').map(k => [k, body[k]]));
  payload.lines = lines;
  const it = db.prepare('SELECT code, name, uom FROM items WHERE id = ?');
  const items = lines.map(l => { const x = it.get(Number(l.item_id)); return `${x?.code || ''} ${x?.name || 'item ' + l.item_id} × ${l.qty} ${l.uom || x?.uom || ''}`.trim(); }).join('\n');
  return { type, doc_kind: type === 'OUTWARD' ? (challan ? 'Dispatch challan' : 'Issue slip') : (challan ? 'MTN with delivery challan' : 'Material Transfer Note (MTN)'),
    date: body.date || today(), project_id: body.project_id || projectOf('boms', body.bom_id) || projectOf('boqs', body.boq_id) || null,
    issued_to: body.issued_to || null, to_location: body.to_location || null, item_count: lines.length, items, payload, remarks: body.remarks || null };
}

// ---------------------------------------------------------------- material requests
export function submitMR(id, user) {
  const mr = getRow('material_requests', id);
  if (!['Draft', 'Rejected'].includes(mr.status)) throw new HttpError(400, `Only a Draft can be sent to the store (this one is ${mr.status})`);
  if (!(mr.lines || []).some(l => Number(l.qty) > 0 && (l.item_id || l.description))) throw new HttpError(400, 'Add the materials with quantities first');
  return updateRow('material_requests', id, { status: 'Submitted' }, user, { system: true });
}

// What the store sees: every line with the stock, the free stock (not reserved for Final BOQs) and a suggested split.
export function mrStock(id) {
  const mr = getRow('material_requests', id);
  return (mr.lines || []).map((l, i) => {
    // need = not issued yet; part of it may already be on a purchase requisition (to_purchase), still to be issued when it arrives.
    const qty = Number(l.qty) || 0, done = Number(l.issued) || 0, onOrder = Number(l.to_purchase) || 0;
    const need = r3(Math.max(0, qty - done));
    const stock = l.item_id ? r3(stockOf(Number(l.item_id))) : 0;
    const free = l.item_id ? r3(Math.max(0, freeStock(Number(l.item_id)))) : 0;
    const issue = l.item_id ? r3(Math.min(need, free)) : 0;
    return { line: i, item_id: l.item_id || null, description: l.description || '', uom: l.uom || '', site: l.site || mr.site || '', qty, issued: done, to_purchase: onOrder,
      need, stock, free, issue, purchase: r3(Math.max(0, need - issue - onOrder)) };
  });
}

// The store's decision: issue what it has (a draft issue slip, or an MTN to the production stock), send the rest to
// the Purchase Head as a requisition. Both keep the site of every line.
export function processMR(id, body = {}, user) {
  if (!hasFunction(user.role, 'stock_post')) throw new HttpError(403, 'Material requests are processed by the store (Roles & Permissions → “Post draft issue slips …”)');
  const mr = getRow('material_requests', id);
  if (!['Submitted', 'Partly Issued', 'Sent to Purchase'].includes(mr.status)) throw new HttpError(400, `This request is ${mr.status}`);
  const plan = mrStock(id);
  const pick = new Map((body.lines || []).map(x => [Number(x.line), x]));
  const issue = [], buy = [];
  for (const p of plan) {
    const want = pick.get(p.line);
    const iq = r3(Math.max(0, Number(want?.issue ?? p.issue) || 0));
    const pq = r3(Math.max(0, Number(want?.purchase ?? p.purchase) || 0));
    if (iq + pq > p.need - p.to_purchase + Math.min(iq, p.to_purchase) + 1e-9) throw new HttpError(400, `${p.description || 'Line ' + (p.line + 1)}: issue ${iq} + purchase ${pq} is more than the ${p.need} still to give (${p.to_purchase} already on a requisition)`);
    if (iq > 0 && !p.item_id) throw new HttpError(400, `${p.description}: pick the store item to issue it`);
    if (iq > 0) issue.push({ ...p, qty: iq });
    if (pq > 0) buy.push({ ...p, qty: pq });
  }
  if (!issue.length && !buy.length) throw new HttpError(400, 'Nothing to issue or purchase');
  const production = String(mr.purpose || '').startsWith('Production');
  return tx(() => {
    const lines = (mr.lines || []).map(l => ({ ...l }));
    const notes = [];
    let draft = null, req = null;
    if (issue.length) {
      const body2 = production
        ? { type: 'TRANSFER', date: today(), from_location: 'Store', to_location: PRODUCTION, requested_by: mr.requested_by, purpose: `${mr.mr_no} – production`, remarks: `Against ${mr.mr_no}` }
        : { type: 'OUTWARD', date: today(), project_id: mr.project_id || null, issued_to: mr.site || mr.department || '', requested_by: mr.requested_by, purpose: `${mr.mr_no}${mr.site ? ' – ' + mr.site : ''}`, remarks: `Against ${mr.mr_no}` };
      body2.lines = issue.map(p => ({ item_id: p.item_id, qty: p.qty, uom: p.uom, remark: p.site && p.site !== mr.site ? `Site: ${p.site}` : '' }));
      draft = insertRow('stock_drafts', { ...draftRow(body2), status: 'Draft', prepared_by: user.name, mr_id: mr.id }, user, { system: true });
      for (const p of issue) {
        // Issuing beyond the unplanned part uses up what was on order for this line.
        const l = lines[p.line], onOrder = Number(l.to_purchase) || 0;
        l.to_purchase = r3(Math.max(0, onOrder - Math.max(0, p.qty - (p.need - onOrder))));
        l.issued = r3((Number(l.issued) || 0) + p.qty);
      }
      notes.push(`${production ? 'MTN to production stock' : 'Issue slip'} draft #${draft.id}: ${issue.length} item(s) – post it to issue`);
    }
    if (buy.length) {
      req = insertRow('requisitions', {
        project_id: mr.project_id || null, project_name: mr.site || null, department: mr.department === 'Production' ? 'Production' : 'Store', required_by: mr.needed_by || null, status: 'Draft',
        requested_by: mr.requested_by, remarks: `From material request ${mr.mr_no} (${mr.requested_by || ''}); not in store stock.`,
        lines: buy.map(p => ({ item_id: p.item_id, description: p.description, qty: p.qty, uom: p.uom, site: p.site || '', remark: `${mr.mr_no}` })),
      }, user, { system: true });
      submitForApproval('Requisition', req.id, user);
      req = getRow('requisitions', req.id);
      for (const p of buy) lines[p.line].to_purchase = r3((Number(lines[p.line].to_purchase) || 0) + p.qty);
      notes.push(`Purchase requisition ${req.req_no}: ${buy.length} item(s) sent to the Purchase Head`);
    }
    const allIssued = lines.every(l => !(Number(l.qty) > 0) || (Number(l.issued) || 0) >= Number(l.qty) - 1e-9);
    const status = allIssued ? 'Issued' : lines.some(l => Number(l.to_purchase) > 0) ? 'Sent to Purchase' : 'Partly Issued';
    const out = updateRow('material_requests', id, {
      lines, status, requisition_id: req?.id || mr.requisition_id || null, processed_by: `${user.name} (${stamp()})`,
      store_note: [mr.store_note, `${today()}: ${notes.join('; ')}`].filter(Boolean).join('\n'),
    }, user, { system: true });
    audit(user.name, 'material_requests', mr.id, 'processed', notes.join('; '));
    return { request: out, draft, requisition: req };
  });
}

export function rejectMR(id, body = {}, user) {
  if (!hasFunction(user.role, 'stock_post')) throw new HttpError(403, 'Only the store can return a request');
  const mr = getRow('material_requests', id);
  if (mr.status !== 'Submitted') throw new HttpError(400, `This request is ${mr.status}`);
  const why = String(body.reason || '').trim();
  if (!why) throw new HttpError(400, 'Write why it is returned');
  return updateRow('material_requests', id, { status: 'Rejected', store_note: [mr.store_note, `${today()}: returned by ${user.name}: ${why}`].filter(Boolean).join('\n') }, user, { system: true });
}

// ---------------------------------------------------------------- production
// Production stock per item: received on MTNs to Production − returned to the store − used in posted production entries.
export function productionStock() {
  const rows = new Map();
  const add = (itemId, k, q) => { const r = rows.get(itemId) || { item_id: itemId, received: 0, returned: 0, used: 0 }; r[k] += Number(q) || 0; rows.set(itemId, r); };
  for (const m of db.prepare("SELECT item_id, SUM(qty) q FROM stock_moves WHERE type = 'TRANSFER' AND lower(to_location) LIKE 'production%' GROUP BY item_id").all()) add(m.item_id, 'received', m.q);
  for (const m of db.prepare("SELECT item_id, SUM(qty) q FROM stock_moves WHERE type = 'RETURN' AND lower(COALESCE(issued_to, '')) LIKE 'production%' GROUP BY item_id").all()) add(m.item_id, 'returned', m.q);
  for (const m of db.prepare(`SELECT CAST(json_extract(j.value, '$.item_id') AS INTEGER) item_id, SUM(CAST(json_extract(j.value, '$.qty') AS REAL)) q
      FROM production_entries p, json_each(p.lines) j WHERE p.status = 'Posted' AND json_extract(j.value, '$.item_id') IS NOT NULL GROUP BY 1`).all()) add(m.item_id, 'used', m.q);
  const it = db.prepare('SELECT code, name, uom, rate FROM items WHERE id = ?');
  return [...rows.values()].map(r => { const x = it.get(r.item_id) || {}; return { ...r, code: x.code, name: x.name, uom: x.uom, rate: x.rate || 0, balance: r3(r.received - r.returned - r.used) }; })
    .filter(r => r.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
export const productionBalance = itemId => productionStock().find(r => r.item_id === Number(itemId))?.balance || 0;

// A new entry without materials gets the same material per piece as the last posted entry of that finished good.
export function prefillProduction(row) {
  const lines = typeof row.lines === 'string' ? JSON.parse(row.lines || '[]') : row.lines || [];
  if (lines.some(l => l.item_id && Number(l.qty)) || !row.fg_item_id || !(Number(row.qty) > 0)) return;
  const last = db.prepare("SELECT qty, lines FROM production_entries WHERE fg_item_id = ? AND status = 'Posted' AND qty > 0 ORDER BY date DESC, id DESC LIMIT 1").get(Number(row.fg_item_id));
  if (!last) return;
  const k = Number(row.qty) / last.qty;
  row.lines = JSON.stringify(JSON.parse(last.lines || '[]').filter(l => l.item_id && Number(l.qty)).map(l => ({ ...l, qty: r3(Number(l.qty) * k) })));
}

// Post: the finished goods go into store stock (valued at the material used); the material leaves the production stock.
export function postProduction(id, body = {}, user) {
  if (!hasFunction(user.role, 'production_post')) throw new HttpError(403, 'Your role may not post production entries');
  const p = getRow('production_entries', id);
  if (p.status !== 'Draft') throw new HttpError(409, `Already ${p.status}`);
  if (!(Number(p.qty) > 0)) throw new HttpError(400, 'Enter the quantity made');
  const used = (p.lines || []).filter(l => l.item_id && Number(l.qty) > 0);
  if (!used.length && !body.noMaterial) throw new HttpError(400, 'Enter the raw material used (or confirm that no material was used)');
  const need = {};
  for (const l of used) need[l.item_id] = (need[l.item_id] || 0) + Number(l.qty);
  const stock = new Map(productionStock().map(r => [r.item_id, r]));
  const short = Object.entries(need).filter(([itemId, q]) => q > (stock.get(Number(itemId))?.balance || 0) + 1e-9)
    .map(([itemId, q]) => { const s = stock.get(Number(itemId)); const x = db.prepare('SELECT name, uom FROM items WHERE id = ?').get(Number(itemId)); return `${x?.name || itemId}: used ${q}, in production stock ${r3(s?.balance || 0)} ${x?.uom || ''}`; });
  if (short.length && !(body.allowShort && hasFunction(user.role, 'allow_negative'))) {
    throw Object.assign(new HttpError(409, `Not enough in the production stock:\n${short.join('\n')}\n\nRaise a material request to the store (MTN to production) first.`), { code: 'SHORT_PRODUCTION' });
  }
  const rate = id2 => db.prepare('SELECT rate FROM items WHERE id = ?').get(Number(id2))?.rate || 0;
  const cost = used.reduce((s, l) => s + Number(l.qty) * rate(l.item_id), 0);
  const unit = r2(cost / Number(p.qty));
  return tx(() => {
    insertRow('stock_moves', { type: 'PRODUCED', date: p.date, doc_no: p.entry_no, item_id: p.fg_item_id, qty: Number(p.qty), rate: unit || rate(p.fg_item_id), uom: p.uom || null,
      project_id: p.project_id || null, issued_to: p.for_site || null, purpose: `Made in production (${p.shift || ''})`, remarks: p.remarks || null }, user, { system: true });
    const out = updateRow('production_entries', id, { status: 'Posted', unit_cost: unit, posted_by: `${user.name} (${stamp()})` }, user, { system: true });
    audit(user.name, 'production_entries', p.id, 'posted', `${p.qty} × ${p.fg_item_id_label || p.fg_item_id}`);
    return out;
  });
}

// Finished goods made per day (posted entries), with totals per day and per item.
export function dailyOutput({ from, to } = {}) {
  const f = from || today().slice(0, 8) + '01', t = to || today();
  const rows = db.prepare(`SELECT p.date, p.fg_item_id, i.code, i.name, i.uom, SUM(p.qty) qty, COUNT(*) entries, SUM(p.qty * COALESCE(p.unit_cost, 0)) value
    FROM production_entries p LEFT JOIN items i ON i.id = p.fg_item_id WHERE p.status = 'Posted' AND p.date BETWEEN ? AND ? GROUP BY p.date, p.fg_item_id ORDER BY p.date DESC, i.name`).all(f, t);
  const days = new Map();
  for (const r of rows) { const d = days.get(r.date) || { date: r.date, pieces: 0, items: 0, value: 0 }; d.pieces = r3(d.pieces + r.qty); d.items++; d.value = r2(d.value + r.value); days.set(r.date, d); }
  const byItem = new Map();
  for (const r of rows) { const x = byItem.get(r.fg_item_id) || { item_id: r.fg_item_id, code: r.code, name: r.name, uom: r.uom, qty: 0, days: 0 }; x.qty = r3(x.qty + r.qty); x.days++; byItem.set(r.fg_item_id, x); }
  const dayList = [...days.values()];
  return { from: f, to: t, rows, days: dayList, items: [...byItem.values()].sort((a, b) => b.qty - a.qty),
    totals: { pieces: r3(dayList.reduce((s, d) => s + d.pieces, 0)), value: r2(dayList.reduce((s, d) => s + d.value, 0)), working_days: dayList.length,
      per_day: dayList.length ? r3(dayList.reduce((s, d) => s + d.pieces, 0) / dayList.length) : 0 } };
}

// ---------------------------------------------------------------- lead time (PO date → GRN date)
// An item's lead time = average days from PO date to its receipt (GRN), over its last 5 receipts against a PO.
export function refreshLeadTime(itemId) {
  const rows = db.prepare(`SELECT julianday(m.date) - julianday(p.date) d FROM stock_moves m JOIN purchase_orders p ON p.id = m.po_id
    WHERE m.type = 'INWARD' AND m.item_id = ? AND m.date >= p.date ORDER BY m.date DESC, m.id DESC LIMIT 5`).all(Number(itemId));
  if (!rows.length) return null;
  const days = Math.max(1, Math.round(rows.reduce((s, r) => s + r.d, 0) / rows.length));
  db.prepare('UPDATE items SET lead_days = ? WHERE id = ?').run(days, Number(itemId));
  return days;
}
export function backfillLeadTimes() {
  let n = 0;
  for (const r of db.prepare("SELECT DISTINCT item_id FROM stock_moves WHERE type = 'INWARD' AND po_id IS NOT NULL").all()) if (refreshLeadTime(r.item_id) != null) n++;
  return n;
}
