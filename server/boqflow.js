// Work order → BOQ → design review → Final → store check → requisition.
//  1. Generate a BOQ from a work order: each work-order line is matched to a Standard Material List and its
//     components are multiplied by the line's quantity (lines without a list are copied for design to detail).
//  2. Design review: every department with components in the BOQ reviews (and may edit) its section.
//  3. Final: the BOQ is locked, store stock is reserved for it and a Draft requisition is raised for the shortage.
//  4. Store check: required − reserved stock − already on requisitions / POs = still to requisition, with order-by dates.
import { db, tx, audit } from './db.js';
import { insertRow, updateRow, getRow, listRows, HttpError } from './crud.js';
import { hasFunction, DEPARTMENTS } from '../public/js/schema.js';
import { notify, notifyNew } from './notify.js';
import { stockOf } from './stock.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const firstLine = s => String(s || '').split('\n')[0].trim();
const parse = (v, d) => { if (v == null || v === '') return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return d; } };
const DEFAULT_LEAD_DAYS = 7;
// BOQs whose material is reserved in the store.
const ACTIVE = ['Final', 'In Progress'];

export const isLocked = bom => !!bom?.finalized_at;
const deptOf = b => b.department || 'Design';

// ---------------------------------------------------------------- 1. generate from a work order
const lists = () => db.prepare("SELECT * FROM material_lists WHERE COALESCE(active, 'Yes') <> 'No' ORDER BY id").all()
  .map(l => ({ ...l, lines: parse(l.lines, []), words: String(l.match_words || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean) }));

// Best list for a work-order line: most (and longest) match words found in its section / heading / description.
function bestList(line, all) {
  const text = `${line.section || ''} ${line.heading || ''} ${line.description || ''}`.toLowerCase();
  let best = null, score = 0;
  for (const l of all) {
    const s = l.words.filter(w => text.includes(w)).reduce((a, w) => a + w.length, 0);
    if (s > score) { best = l; score = s; }
  }
  return best;
}

const woItems = boqId => db.prepare("SELECT * FROM boq_items WHERE boq_id = ? AND COALESCE(kind, 'Item') = 'Item' ORDER BY COALESCE(sort, id), id").all(Number(boqId));

// Preview for the "Generate BOQ" window: every work-order line with its chosen or suggested list.
export function matchPreview(boqId) {
  const wo = getRow('boqs', boqId);
  const all = lists();
  const byId = new Map(all.map(l => [l.id, l]));
  const rows = woItems(boqId).map(line => {
    const chosen = line.material_list_id && byId.get(line.material_list_id);
    const sug = chosen || bestList(line, all);
    return { id: line.id, section: line.section, sr_no: line.sr_no, description: firstLine(line.description), uom: line.uom, qty: line.qty,
      list_id: sug?.id || null, list_label: sug ? `${sug.code ? sug.code + ' · ' : ''}${sug.name}` : null, how: chosen ? 'chosen' : sug ? 'matched' : 'none',
      components: sug ? sug.lines.length : 0 };
  });
  const existing = db.prepare('SELECT id, bom_no, status FROM boms WHERE work_order_id = ? ORDER BY id').all(wo.id);
  return { work_order: { id: wo.id, boq_no: wo.boq_no, title: wo.title, project_id: wo.project_id }, rows, lists: all.map(l => ({ id: l.id, label: `${l.code ? l.code + ' · ' : ''}${l.name}`, components: l.lines.length })), existing };
}

export function generateBom(boqId, body = {}, user) {
  const wo = getRow('boqs', boqId);
  const all = lists();
  const byId = new Map(all.map(l => [l.id, l]));
  const choice = body.mapping || {}; // work-order line id → list id (null = no list)
  const lines = woItems(boqId);
  if (!lines.length) throw new HttpError(400, 'This work order has no material lines yet. Import the work order Excel first.');
  return tx(() => {
    const bom = insertRow('boms', {
      client: String(body.client || '').trim() || wo.title, project_id: wo.project_id, work_order_id: wo.id, customer_id: wo.customer_id,
      required_by: body.required_by || null, status: 'Draft', prepared_by: user.name,
      remarks: `Generated from work order ${wo.boq_no} on ${today()}. Review each department's section, then make it Final.`,
    }, user, { system: true });
    let sort = 0, matched = 0, unmatched = 0, components = 0;
    const srBySection = {};
    const add = (line, comp) => {
      const section = line.section || 'General';
      srBySection[section] = (srBySection[section] || 0) + 1;
      insertRow('bom_items', { bom_id: bom.id, sort: ++sort, sr_no: String(srBySection[section]), section, wo_line_id: line.id, ...comp }, user, { system: true });
      components++;
    };
    for (const line of lines) {
      const picked = line.id in choice || String(line.id) in choice ? (choice[line.id] ?? choice[String(line.id)]) : (line.material_list_id || bestList(line, all)?.id || null);
      const list = picked ? byId.get(Number(picked)) : null;
      if (Number(picked || 0) !== Number(line.material_list_id || 0)) db.prepare('UPDATE boq_items SET material_list_id = ? WHERE id = ?').run(list?.id || null, line.id);
      const woQty = Number(line.qty) || 0;
      const ref = `WO ${line.sr_no || ''}`.trim();
      if (list && list.lines.some(c => c.description || c.item_id)) {
        matched++;
        for (const c of list.lines.filter(c => c.description || c.item_id)) {
          add(line, {
            component: c.description || null, spec: c.spec || null, dimensions: c.dimensions || null, qty: r3((Number(c.qty) || 0) * woQty), uom: c.uom || null,
            moc: c.moc || null, make: c.make || null, item_id: c.item_id || null, department: c.department || list.department || 'Design',
            remark: `${ref} · ${list.name}${line.qty == null ? ' · WO qty TBD' : ''}`.slice(0, 200),
          });
        }
      } else {
        unmatched++;
        const desc = String(line.description || '');
        add(line, {
          component: firstLine(desc).slice(0, 160) || '(work-order line)', spec: desc.includes('\n') ? desc.slice(desc.indexOf('\n') + 1).trim().slice(0, 2000) : null,
          qty: line.qty ?? null, uom: line.uom || null, item_id: line.item_id || null, department: 'Design',
          remark: `${ref} · no standard list – design to detail`,
        });
      }
    }
    const departments = [...new Set(db.prepare('SELECT department FROM bom_items WHERE bom_id = ?').all(bom.id).map(deptOf))];
    audit(user.name, 'boms', bom.id, 'generate', `from ${wo.boq_no}: ${components} components, ${matched} lines matched, ${unmatched} without list`);
    const out = getRow('boms', bom.id);
    notifyNew('boms', out, user);
    return { bom: out, components, matched, unmatched, departments };
  });
}

// Copy the components of an earlier BOQ (e.g. a similar OT), multiplied by `factor`.
export function copyFromBom(bomId, body = {}, user) {
  const bom = getRow('boms', bomId);
  if (isLocked(bom)) throw new HttpError(409, `${bom.bom_no} is Final; Reopen it first`);
  const from = getRow('boms', body.from_bom_id);
  const factor = Number(body.factor) || 1;
  const src = db.prepare('SELECT * FROM bom_items WHERE bom_id = ? ORDER BY COALESCE(sort, id), id').all(from.id);
  if (!src.length) throw new HttpError(400, `${from.bom_no} has no components`);
  return tx(() => {
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM bom_items WHERE bom_id = ?').get(bom.id).m;
    for (const s of src) {
      insertRow('bom_items', {
        bom_id: bom.id, sort: ++sort, department: s.department || 'Design', section: s.section, sr_no: s.sr_no, component: s.component, spec: s.spec,
        dimensions: s.dimensions, qty: s.qty == null ? null : r3(s.qty * factor), qty_text: factor === 1 ? s.qty_text : null, uom: s.uom, moc: s.moc,
        drawing_no: s.drawing_no, make: s.make, item_id: s.item_id, remark: [s.remark, `copied from ${from.bom_no}${factor !== 1 ? ' ×' + factor : ''}`].filter(Boolean).join(' · ').slice(0, 200),
      }, user, { system: true });
    }
    audit(user.name, 'boms', bom.id, 'copy', `${src.length} components from ${from.bom_no} ×${factor}`);
    return { copied: src.length };
  });
}

// ---------------------------------------------------------------- 2. design review per department
const bomDepartments = bomId => [...new Set(db.prepare('SELECT department FROM bom_items WHERE bom_id = ?').all(Number(bomId)).map(deptOf))]
  .sort((a, b) => (DEPARTMENTS.indexOf(a) + 1 || 99) - (DEPARTMENTS.indexOf(b) + 1 || 99));

// Reviews for the departments that have components now (a department added later starts as Pending).
export function reviewsOf(bom) {
  const saved = parse(bom.reviews, {});
  return Object.fromEntries(bomDepartments(bom.id).map(d => [d, saved[d] || { status: 'Pending' }]));
}

export function submitReview(bomId, user) {
  const bom = getRow('boms', bomId);
  if (!['Draft', 'On Hold', 'Approved'].includes(bom.status) || isLocked(bom)) throw new HttpError(400, `Only a Draft BOQ can go to design review (this one is ${bom.status})`);
  if (!db.prepare('SELECT 1 FROM bom_items WHERE bom_id = ?').get(bom.id)) throw new HttpError(400, 'Add components first');
  const reviews = Object.fromEntries(bomDepartments(bom.id).map(d => [d, { status: 'Pending' }]));
  const row = updateRow('boms', bom.id, { status: 'Design Review', reviews }, user, { system: true });
  notify({ fn: 'boq_review', kind: 'boms', title: `BOQ for design review: ${bom.bom_no}`, body: `${bom.client || ''} · sections: ${Object.keys(reviews).join(', ')} · by ${user.name}`, link: `#/bom/${bom.id}` }, user);
  return row;
}

export function reviewSection(bomId, body = {}, user) {
  if (!hasFunction(user.role, 'boq_review')) throw new HttpError(403, 'Your role may not review BOQs (Roles & Permissions → “BOQ – review”)');
  const bom = getRow('boms', bomId);
  if (bom.status !== 'Design Review') throw new HttpError(400, `${bom.bom_no} is not in design review (${bom.status})`);
  const reviews = reviewsOf(bom);
  const dept = body.department;
  if (!reviews[dept]) throw new HttpError(400, `This BOQ has no ${dept} components`);
  const decision = body.decision === 'Changes needed' ? 'Changes needed' : 'Reviewed';
  reviews[dept] = { status: decision, by: user.name, at: stamp(), comments: String(body.comments || '').slice(0, 500) || undefined };
  const row = updateRow('boms', bom.id, { reviews }, user, { system: true });
  audit(user.name, 'boms', bom.id, 'review', `${dept}: ${decision}${body.comments ? ' – ' + body.comments : ''}`);
  if (Object.values(reviews).every(r => r.status === 'Reviewed')) {
    notify({ fn: 'boq_final', kind: 'boms', title: `BOQ reviewed by all departments: ${bom.bom_no}`, body: `${bom.client || ''} · ready to be made Final`, link: `#/bom/${bom.id}` }, user);
  } else if (decision === 'Changes needed') {
    notify({ userNames: [bom.prepared_by].filter(Boolean), kind: 'boms', title: `Changes needed in ${bom.bom_no} (${dept})`, body: `${body.comments || ''} · by ${user.name}`, link: `#/bom/${bom.id}` }, user);
  }
  return { bom: row, reviews };
}

// A component changed during review: its department has to review again.
export function touchReview(bomId, departments, user) {
  const bom = db.prepare('SELECT id, status, reviews FROM boms WHERE id = ?').get(Number(bomId));
  if (!bom || bom.status !== 'Design Review') return;
  const reviews = parse(bom.reviews, {});
  let changed = false;
  for (const d of departments.map(x => x || 'Design')) {
    if (reviews[d]?.status === 'Reviewed') { reviews[d] = { status: 'Pending', note: `changed by ${user.name} after review` }; changed = true; }
  }
  if (changed) db.prepare('UPDATE boms SET reviews = ? WHERE id = ?').run(JSON.stringify(reviews), bom.id);
}

// ---------------------------------------------------------------- 3. Final (freeze) and reopen
export function makeFinal(bomId, body = {}, user) {
  if (!hasFunction(user.role, 'boq_final')) throw new HttpError(403, 'Your role may not make BOQs Final (Roles & Permissions → “BOQ – make Final”)');
  const bom = getRow('boms', bomId);
  if (isLocked(bom)) throw new HttpError(400, `${bom.bom_no} is already Final`);
  if (!['Design Review', 'Draft', 'Approved', 'On Hold'].includes(bom.status)) throw new HttpError(400, `Cannot make a ${bom.status} BOQ Final`);
  const reviews = reviewsOf(bom);
  const open = Object.entries(reviews).filter(([, r]) => r.status !== 'Reviewed').map(([d, r]) => `${d} (${r.status})`);
  if (open.length && !body.force) throw new HttpError(400, `Not reviewed yet: ${open.join(', ')}. Every department has to review its section first.`);
  if (!db.prepare('SELECT 1 FROM bom_items WHERE bom_id = ? AND COALESCE(qty, 0) > 0').get(bom.id)) throw new HttpError(400, 'No component has a quantity');
  return tx(() => {
    updateRow('boms', bom.id, { status: 'Final', finalized_by: user.name, finalized_at: stamp(), approved_by: bom.approved_by || user.name, reviews }, user, { system: true });
    audit(user.name, 'boms', bom.id, 'final', open.length ? `made Final without review of ${open.join(', ')}` : 'all departments reviewed');
    const r = requisitionShortage(bom.id, user, { auto: true });
    const short = r.check.rows.filter(x => x.shortage > 0).length;
    notify({ fn: 'notify_store_check', kind: 'boms', title: `BOQ Final: ${bom.bom_no} – store check`,
      body: [bom.client, `${r.check.summary.reserved_lines} item(s) reserved from stock`, short ? `${short} short` : 'all in stock',
        r.requisition ? `requisition ${r.requisition.req_no} (Draft) waiting for store` : null].filter(Boolean).join(' · '),
      link: r.requisition ? `#/view/requisitions/${r.requisition.id}` : `#/bom/${bom.id}` }, user);
    return { bom: getRow('boms', bom.id), requisition: r.requisition, check: r.check.summary };
  });
}

export function reopen(bomId, body = {}, user) {
  if (!hasFunction(user.role, 'boq_final')) throw new HttpError(403, 'Your role may not reopen Final BOQs');
  const bom = getRow('boms', bomId);
  if (!isLocked(bom)) throw new HttpError(400, `${bom.bom_no} is not Final`);
  const reviews = Object.fromEntries(Object.keys(reviewsOf(bom)).map(d => [d, { status: 'Pending' }]));
  const row = updateRow('boms', bom.id, { status: 'Design Review', finalized_by: null, finalized_at: null, reviews }, user, { system: true });
  audit(user.name, 'boms', bom.id, 'reopen', String(body.reason || '').slice(0, 300));
  notify({ fn: 'boq_review', kind: 'boms', title: `BOQ reopened for changes: ${bom.bom_no}`, body: `${body.reason || ''} · by ${user.name}. Stock is no longer reserved until it is Final again.`, link: `#/bom/${bom.id}` }, user);
  return row;
}

// ---------------------------------------------------------------- 4. stock check, reservation, requisition
// Stock is reserved for Final / In Progress BOQs in order of required-by date, then the order they were made Final.
// Material received on a PO raised for a component stays with that component.
function allocate() {
  const boms = db.prepare(`SELECT id, bom_no, required_by, finalized_at FROM boms WHERE status IN (${ACTIVE.map(() => '?').join(',')}) AND finalized_at IS NOT NULL`).all(...ACTIVE);
  const lines = [];
  for (const b of boms) for (const r of listRows('bom_items', { bom_id: b.id, limit: 20000 })) {
    if (!r.item_id || !(r.qty > 0)) continue;
    const still = Math.max(0, r3(r.qty - (r.dispatched || 0)));
    const own = Math.min(still, Math.max(0, r3((r.received || 0) - (r.dispatched || 0))));
    lines.push({ id: r.id, item_id: r.item_id, bom: b, still, own, general: r3(still - own) });
  }
  const pool = new Map();
  const items = [...new Set(lines.map(l => l.item_id))];
  for (const it of items) pool.set(it, Math.max(0, r3(stockOf(it) - lines.filter(l => l.item_id === it).reduce((s, l) => s + l.own, 0))));
  lines.sort((a, b) => (a.bom.required_by || '9999').localeCompare(b.bom.required_by || '9999') || String(a.bom.finalized_at).localeCompare(String(b.bom.finalized_at)) || a.bom.id - b.bom.id || a.id - b.id);
  const res = new Map();
  for (const l of lines) {
    const alloc = Math.min(l.general, pool.get(l.item_id));
    pool.set(l.item_id, r3(pool.get(l.item_id) - alloc));
    res.set(l.id, r3(l.own + alloc));
  }
  return { reserved: res, free: pool };
}

// Free (unreserved) stock of an item.
export function freeStock(itemId, alloc = allocate()) {
  return alloc.free.has(itemId) ? alloc.free.get(itemId) : Math.max(0, stockOf(itemId));
}

export function stockCheck(bomId) {
  const bom = getRow('boms', bomId);
  const active = ACTIVE.includes(bom.status) && isLocked(bom);
  const alloc = allocate();
  const free = new Map(); // for a BOQ that is not Final yet: what it could take from free stock
  const lead = new Map(db.prepare('SELECT id, lead_days FROM items').all().map(i => [i.id, i.lead_days]));
  const t = today();
  let comp = '';
  const rows = listRows('bom_items', { bom_id: bom.id, limit: 20000 }).sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id)).map(r => {
    if (r.component) comp = r.component;
    const name = r.component || comp;
    const still = Math.max(0, r3((r.qty || 0) - (r.dispatched || 0)));
    let reserved = 0, freeNow = null;
    if (r.item_id) {
      if (active) reserved = alloc.reserved.get(r.id) || 0;
      else {
        if (!free.has(r.item_id)) free.set(r.item_id, freeStock(r.item_id, alloc));
        reserved = Math.min(still, free.get(r.item_id));
        free.set(r.item_id, r3(free.get(r.item_id) - reserved));
      }
      freeNow = freeStock(r.item_id, alloc);
    }
    const shortage = r3(still - reserved);
    const onOrder = r3((r.req_open || 0) + Math.max(0, (r.on_po || 0) - (r.received || 0)));
    const toReq = Math.max(0, r3(shortage - onOrder));
    const days = lead.get(r.item_id) ?? DEFAULT_LEAD_DAYS;
    let orderBy = null;
    if (bom.required_by && shortage > 0) { const d = new Date(bom.required_by + 'T00:00:00'); d.setDate(d.getDate() - days); orderBy = d.toLocaleString('sv-SE').slice(0, 10); }
    return {
      id: r.id, department: deptOf(r), section: r.section, sr_no: r.sr_no, component: name, dimensions: r.dimensions, spec: r.spec, uom: r.uom, qty: r.qty,
      item_id: r.item_id, item_label: r.item_id_label, in_store: r.in_store ?? null, free_stock: freeNow, dispatched: r.dispatched || 0,
      still_needed: still, reserved, shortage, on_order: onOrder, to_requisition: toReq, lead_days: r.item_id ? days : null, order_by: orderBy,
      late: !!(orderBy && toReq > 0 && orderBy < t),
      state: still <= 0 ? 'Sent' : shortage <= 0 ? (active ? 'Reserved' : 'In stock') : toReq <= 0 ? 'On order' : r.item_id ? 'Short' : 'Short (no store item)',
    };
  }).filter(r => (r.qty || 0) > 0);
  const summary = {
    bom_no: bom.bom_no, status: bom.status, active, required_by: bom.required_by, lines: rows.length,
    reserved_lines: rows.filter(r => r.reserved > 0).length, in_stock_lines: rows.filter(r => r.still_needed > 0 && r.shortage <= 0).length,
    short_lines: rows.filter(r => r.shortage > 0).length, to_requisition_lines: rows.filter(r => r.to_requisition > 0).length,
    late_lines: rows.filter(r => r.late).length, no_item_lines: rows.filter(r => !r.item_id).length,
  };
  return { summary, rows };
}

// Draft requisition for everything still to requisition (store checks it and submits it to the Purchase Head).
export function requisitionShortage(bomId, user, { auto = false } = {}) {
  const bom = getRow('boms', bomId);
  const check = stockCheck(bomId);
  const need = check.rows.filter(r => r.to_requisition > 0);
  if (!need.length) return { requisition: null, check };
  const fmt = d => d ? d.split('-').reverse().join('-') : '';
  const lines = need.map(r => ({
    item_id: r.item_id || null, bom_item_id: r.id, description: [r.component, r.dimensions].filter(Boolean).join(' ').slice(0, 200),
    spec: r.spec || '', qty: r.to_requisition, uom: r.uom || 'Nos',
    remark: [r.department, r.section, r.order_by && `order by ${fmt(r.order_by)}`].filter(Boolean).join(' · '),
  }));
  const req = insertRow('requisitions', {
    project_id: bom.project_id, bom_id: bom.id, required_by: bom.required_by || null, department: 'Store', status: 'Draft',
    requested_by: auto ? `Auto – ${bom.bom_no}` : user.name, lines,
    remarks: auto ? `Raised automatically when ${bom.bom_no} was made Final: material not in free store stock and not already on a requisition / PO. Store: check the quantities and Submit.`
      : `Shortage of ${bom.bom_no} after store check.`,
  }, user, { system: true });
  audit(user.name, 'boms', bom.id, 'requisition', `${req.req_no}: ${lines.length} material(s)${auto ? ' (auto)' : ''}`);
  return { requisition: req, check: stockCheck(bomId) };
}

// Store screen: every Final / In Progress BOQ with what is reserved, short, late and still to requisition.
export function storeOverview() {
  const boms = db.prepare(`SELECT id FROM boms WHERE status IN (${ACTIVE.map(() => '?').join(',')}) AND finalized_at IS NOT NULL ORDER BY COALESCE(required_by, '9999'), id`).all(...ACTIVE);
  return boms.map(b => {
    const bom = getRow('boms', b.id);
    const c = stockCheck(b.id);
    return { id: bom.id, bom_no: bom.bom_no, client: bom.client, project: bom.project_id_label, required_by: bom.required_by, status: bom.status, finalized_at: bom.finalized_at,
      ...c.summary, todo: c.rows.filter(r => r.to_requisition > 0 || r.late) };
  });
}
