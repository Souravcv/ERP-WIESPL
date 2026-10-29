// In-app pop-up notifications: one row per recipient, polled by the browser.
import { db } from './db.js';
import { hasFunction, NOTIFY_FUNCTIONS, APPROVAL_FLOWS, ENTITIES } from '../public/js/schema.js';

const activeUsers = () => db.prepare('SELECT id, name, role FROM users WHERE active = 1').all();

// Send to everyone whose role has `fn` (and to `userNames`), never to the person who caused it.
export function notify({ fn, userNames = [], kind, title, body = '', link = '' }, actor) {
  const to = activeUsers().filter(u => u.name !== actor?.name && ((fn && hasFunction(u.role, fn)) || userNames.includes(u.name)));
  const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body, link, by_user) VALUES (?, ?, ?, ?, ?, ?)');
  for (const u of to) ins.run(u.id, kind || null, String(title).slice(0, 200), String(body || '').slice(0, 500), link || null, actor?.name || null);
  return to.length;
}

const DOC_LINK = { boqs: id => `#/boq/${id}`, boms: id => `#/bom/${id}` };
const docLink = (entity, id) => (DOC_LINK[entity] ? DOC_LINK[entity](id) : `#/view/${entity}/${id}`);

// A new requisition / PO / BOQ / work order was created.
export function notifyNew(entity, row, actor) {
  const fn = NOTIFY_FUNCTIONS[entity];
  if (!fn || !row) return 0;
  const ent = ENTITIES[entity];
  const ref = row.req_no || row.po_no || row.bom_no || row.boq_no || `#${row.id}`;
  const about = {
    requisitions: () => [row.project_name || row.project_id_label, `${(row.lines || []).filter(l => l.description || l.item_id).length} material(s)`],
    purchase_orders: () => [row.vendor_id_label, row.project_note],
    boms: () => [row.client, row.project_id_label],
    boqs: () => [row.title, row.project_id_label],
  }[entity]();
  return notify({ fn, kind: entity, title: `New ${ent.singular}: ${ref}`, body: [...about.filter(Boolean), `by ${actor?.name || 'system'}`].join(' · '), link: docLink(entity, row.id) }, actor);
}

const APPROVAL_LINK = { Quotation: id => `#/quotation/${id}`, 'Purchase Order': id => `#/view/purchase_orders/${id}`, Requisition: id => `#/view/requisitions/${id}`,
  Payment: id => `#/view/vendor_payments/${id}`, Expense: id => `#/view/expenses/${id}`, 'Credit Note': id => `#/view/credit_notes/${id}`, 'Sales Order': id => `#/view/sales_orders/${id}`, Leave: id => `#/view/leave_requests/${id}`, Confirmation: id => `#/view/probation_reviews/${id}`, 'Schedule Baseline': id => `#/view/schedule_baselines/${id}`, 'Production Plan': id => `#/view/production_plans/${id}` };

// An approval step is waiting: tell everyone allowed to approve it.
export function notifyApprovalRequest(ap, actor) {
  const step = (APPROVAL_FLOWS[ap.doc_type] || []).find(s => s.stage === ap.stage);
  if (!step) return 0;
  return notify({ fn: step.fn, kind: 'approval', title: `Approval needed: ${ap.doc_type} ${ap.doc_ref || ''} – ${ap.stage}`,
    body: [ap.title, ap.amount ? `₹ ${Number(ap.amount).toLocaleString('en-IN')}` : '', `requested by ${ap.requested_by}`].filter(Boolean).join(' · '), link: `#/view/approvals/${ap.id}` }, actor);
}

// Approved / rejected: tell the person who asked.
export function notifyDecision(ap, decision, final, actor) {
  if (!ap.requested_by) return 0;
  const link = APPROVAL_LINK[ap.doc_type]?.(ap.doc_id) || `#/view/approvals/${ap.id}`;
  const what = decision === 'Rejected' ? 'rejected' : final ? 'fully approved' : `approved (${ap.stage}), next step started`;
  return notify({ userNames: [ap.requested_by], kind: 'decision', title: `${ap.doc_type} ${ap.doc_ref || ''} ${what}`, body: `by ${actor.name}${ap.comments ? ' · ' + ap.comments : ''}`, link }, actor);
}

export function listFor(user, { since = 0, limit = 30 } = {}) {
  const rows = db.prepare('SELECT id, at, kind, title, body, link, by_user, read_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT ?')
    .all(user.id, Number(since) || 0, Math.min(Number(limit) || 30, 100));
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
  const last = db.prepare('SELECT MAX(id) m FROM notifications WHERE user_id = ?').get(user.id).m || 0;
  return { rows, unread, last };
}

export function markRead(user, ids) {
  const at = new Date().toLocaleString('sv-SE').slice(0, 16);
  if (ids === 'all') db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(at, user.id);
  else for (const id of [].concat(ids || [])) db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL').run(at, user.id, Number(id));
  return { ok: true };
}

// Keep the table small: drop notifications older than 90 days.
export function purgeOld() {
  db.prepare("DELETE FROM notifications WHERE at < datetime('now', '-90 days')").run();
}
