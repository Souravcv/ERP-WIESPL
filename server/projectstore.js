// Store per project (Store → Project Store, Purchase → Project Store): for one project, item by item, what its BOQs need,
// what is on order for it, what came in for it, what was sent to the site, what the store still holds for it and what
// is pending — plus its slips, POs, challans and material requests.
import { db } from './db.js';
import { HttpError, listRows } from './crud.js';
import { canView, hasFunction } from '../public/js/schema.js';
import { round2 } from '../public/js/calc.js';

const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const parse = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
const IN = ['INWARD', 'JOB_IN', 'PRODUCED', 'OPENING', 'RETURN', 'ADJUST'];
const OUT = ['OUTWARD', 'TRANSFER', 'SCRAP', 'JOB_OUT'];
const mayView = user => ['stock_moves', 'purchase_orders', 'projects'].some(e => canView(e, user.role));

// Projects with anything in the store or on order, newest first (for the picker).
export function projectList(user) {
  if (!mayView(user)) throw new HttpError(403, 'No access to the store');
  return db.prepare(`SELECT p.id, COALESCE(NULLIF(p.project_no, ''), p.code) no, p.name, p.status,
      (SELECT COUNT(*) FROM stock_moves m WHERE m.project_id = p.id) moves
    FROM projects p ORDER BY CASE WHEN COALESCE(p.status, '') IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END, p.id DESC`).all();
}

export function projectStore(projectId, user) {
  if (!mayView(user)) throw new HttpError(403, 'No access to the store');
  const pid = Number(projectId);
  const p = db.prepare('SELECT p.id, p.name, p.project_no, p.code, c.name client, p.status FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?').get(pid);
  if (!p) throw new HttpError(404, 'Project not found');
  const prices = hasFunction(user.role, 'see_stock_value');
  const rows = new Map();
  const item = new Map(db.prepare('SELECT id, code, name, uom, rate FROM items').all().map(i => [i.id, i]));
  const row = (itemId, name, uom) => {
    const key = itemId ? `i${itemId}` : `n${String(name || '').toLowerCase().trim()}`;
    if (!rows.has(key)) {
      const it = itemId ? item.get(Number(itemId)) : null;
      rows.set(key, { item_id: itemId ? Number(itemId) : null, code: it?.code || '', name: it?.name || name || '', uom: it?.uom || uom || '', rate: it?.rate || 0,
        required: 0, sent_boq: 0, ordered: 0, received_po: 0, came_in: 0, went_out: 0 });
    }
    return rows.get(key);
  };
  // 1. what the project's BOQs need, and what has gone on challans against them
  const boms = db.prepare("SELECT id, bom_no, status FROM boms WHERE project_id = ? AND COALESCE(status, '') <> 'Cancelled'").all(pid);
  for (const b of boms) {
    let comp = '';
    for (const r of listRows('bom_items', { bom_id: b.id, limit: 20000 }).sort((a, c) => (a.sort ?? a.id) - (c.sort ?? c.id))) {
      if (r.component) comp = r.component;
      if (!(Number(r.qty) > 0)) continue;
      const x = row(r.item_id, r.component || comp, r.uom);
      x.required = r3(x.required + Number(r.qty));
      x.sent_boq = r3(x.sent_boq + (Number(r.dispatched) || 0));
    }
  }
  // 2. ordered for the project on POs (a line for several projects counts its share)
  const pos = db.prepare(`SELECT p.id, p.po_no, p.date, p.status, p.total, p.project_id, p.lines, v.name vendor FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE p.status NOT IN ('Cancelled', 'Archived (old)', 'Rejected') AND (p.project_id = ? OR p.lines LIKE '%"project_id"%') ORDER BY p.date DESC, p.id DESC`).all(pid);
  const poList = [];
  for (const po of pos) {
    let mine = 0;
    for (const l of parse(po.lines)) {
      if (!(Number(l.qty) > 0)) continue;
      const parts = l.split?.length > 1 ? l.split.map(s => ({ project_id: s.project_id, qty: Number(s.qty) || 0, received: Number(s.received) || 0 }))
        : [{ project_id: l.project_id || po.project_id, qty: Number(l.qty), received: Number(l.received) || 0 }];
      for (const s of parts.filter(s => Number(s.project_id) === pid)) {
        const x = row(l.item_id, l.description, l.uom);
        x.ordered = r3(x.ordered + s.qty);
        x.received_po = r3(x.received_po + Math.min(s.qty, s.received));
        mine++;
      }
    }
    if (mine) poList.push({ id: po.id, po_no: po.po_no, date: po.date, vendor: po.vendor, status: po.status, lines: mine, total: prices ? po.total : null });
  }
  // 3. what came into the store for the project and what left it (issue, transfer, challan, scrap, job work)
  for (const m of db.prepare('SELECT type, item_id, qty FROM stock_moves WHERE project_id = ?').all(pid)) {
    const x = row(m.item_id, null, null);
    const q = Number(m.qty) || 0;
    if (IN.includes(m.type)) x.came_in = r3(x.came_in + q);
    else if (OUT.includes(m.type)) x.went_out = r3(x.went_out + q);
  }
  const list = [...rows.values()].map(x => {
    const inStore = r3(x.came_in - x.went_out);
    const toReceive = r3(Math.max(0, x.ordered - x.received_po));
    const toSend = x.required ? r3(Math.max(0, x.required - Math.max(x.sent_boq, x.went_out))) : 0;
    const short = x.required ? r3(Math.max(0, toSend - Math.max(0, inStore) - toReceive)) : 0;
    return { ...x, in_store: inStore, to_receive: toReceive, to_send: toSend, short, value: prices ? round2(Math.max(0, inStore) * (x.rate || 0)) : null, rate: prices ? x.rate : null,
      state: x.required && toSend <= 0 ? 'Sent' : short > 0 ? 'Short' : toReceive > 0 ? 'On order' : inStore > 0 ? 'In store' : x.required ? 'Ready' : 'Done' };
  }).sort((a, b) => ['Short', 'On order', 'In store', 'Ready', 'Sent', 'Done'].indexOf(a.state) - ['Short', 'On order', 'In store', 'Ready', 'Sent', 'Done'].indexOf(b.state) || a.name.localeCompare(b.name));
  // 4. the project's slips, challans and material requests
  const slips = db.prepare(`SELECT m.type, COALESCE(NULLIF(m.doc_no, ''), '#' || m.id) doc_key, MAX(m.doc_no) doc_no, m.date, COUNT(*) items, ROUND(SUM(m.qty), 3) qty,
      MAX(COALESCE(v.name, m.supplier, m.to_location, m.issued_to)) party
    FROM stock_moves m LEFT JOIN vendors v ON v.id = m.vendor_id WHERE m.project_id = ? GROUP BY m.type, doc_key, m.date ORDER BY m.date DESC LIMIT 300`).all(pid);
  const challans = canView('challans', user.role) ? db.prepare("SELECT id, challan_no, date, status, challan_type, json_array_length(COALESCE(NULLIF(lines, ''), '[]')) items FROM challans WHERE project_id = ? ORDER BY date DESC, id DESC").all(pid) : [];
  const mrs = canView('material_requests', user.role) ? db.prepare(`SELECT id, mr_no, date, status, requested_by, purpose FROM material_requests WHERE project_id = ?
      OR EXISTS (SELECT 1 FROM json_each(COALESCE(NULLIF(lines, ''), '[]')) j WHERE CAST(json_extract(j.value, '$.project_id') AS INTEGER) = ?) ORDER BY date DESC, id DESC`).all(pid, pid) : [];
  const sum = k => r3(list.reduce((s, x) => s + (Number(x[k]) || 0), 0));
  return {
    project: { id: p.id, name: p.name, no: p.project_no || p.code, client: p.client, status: p.status }, prices,
    boqs: boms.map(b => b.bom_no), rows: list, pos: poList, slips, challans, mrs,
    totals: { items: list.length, short: list.filter(x => x.state === 'Short').length, on_order: list.filter(x => x.to_receive > 0).length,
      in_store: list.filter(x => x.in_store > 0).length, to_send: list.filter(x => x.to_send > 0).length, value: prices ? round2(list.reduce((s, x) => s + (x.value || 0), 0)) : null,
      came_in: sum('came_in'), went_out: sum('went_out') },
  };
}
