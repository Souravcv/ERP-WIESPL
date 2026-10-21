import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { db, migrate, getSettings, setSettings, audit, RESTORE_FILE } from './db.js';
import * as stock from './stock.js';
import * as importer from './importer.js';
import * as dispatch from './dispatch.js';
import { seed } from './seed.js';
import {
  authenticate, requireRole, createSession, destroySession, verifyPassword, hashPassword, publicUser,
  loginAllowed, loginFailed, loginSucceeded, purgeExpiredSessions,
} from './auth.js';
import { listRows, getRow, insertRow, updateRow, deleteRow, canRemove, options, entityOr404, HttpError } from './crud.js';
import * as notify from './notify.js';
import { publicRouter, unfinishedLeads, briefFor } from './public.js';
import { migratePhotos, listPhotos, addPhoto, removePhoto } from './photos.js';
import { tx } from './db.js';
import { nextItemCode } from './hooks.js';
import * as wf from './workflows.js';
import * as flow from './boqflow.js';
import { myTasks } from './tasks.js';
import * as pay from './payments.js';
import * as bankreco from './bankreco.js';
import * as recv from './receivables.js';
import { exportEntity, importEnquiries } from './excel.js';
import { ENTITIES, canWrite, canView, canDelete, hasFunction, STOCK_SQL } from '../public/js/schema.js';
import * as roles from './roles.js';
import { fyOf } from '../public/js/calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

migrate();
seed();
roles.seedRoles();
dispatch.migrateProjectBoqs();
importer.fixPoNumbers();
importer.linkInwardPOs();
purgeExpiredSessions();
notify.purgeOld();

const app = express();
app.disable('x-powered-by');
// Behind Render's proxy: real client IPs (login lock-out) and HTTPS detection (secure cookie).
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

const api = express.Router();
const wrap = fn => async (req, res, next) => {
  try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); } catch (e) { next(e); }
};

// ---------------------------------------------------------------- auth
api.post('/login', wrap((req, res) => {
  const { username = '', password = '' } = req.body || {};
  const key = `${String(username).toLowerCase()}|${req.ip}`;
  if (!loginAllowed(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const u = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND active = 1').get(String(username).trim());
  if (!u || !verifyPassword(password, u.pass_hash)) { loginFailed(key); throw new HttpError(401, 'Wrong username or password'); }
  loginSucceeded(key);
  createSession(res, u.id);
  audit(u.name, 'users', u.id, 'login');
  return { user: publicUser(u) };
}));
api.post('/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });
// Client enquiry form (enquire.html): no login.
api.use('/public', publicRouter());

api.use(authenticate);

api.get('/me', wrap(req => {
  const r = roles.listRoles().find(x => x.name === req.user.role);
  return { user: { ...publicUser(req.user), role_label: r?.label || req.user.role }, settings: getSettings(), perms: r?.perms || null };
}));
api.post('/me/password', wrap(req => {
  const { current, password } = req.body || {};
  if (!verifyPassword(current, req.user.pass_hash)) throw new HttpError(400, 'Current password is wrong');
  if (!password || String(password).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(password), req.user.id);
  audit(req.user.name, 'users', req.user.id, 'password change');
  return { ok: true };
}));

// ---------------------------------------------------------------- pop-up notifications
api.get('/notifications', wrap(req => notify.listFor(req.user, req.query)));
api.post('/notifications/read', wrap(req => notify.markRead(req.user, req.body?.ids)));
api.get('/web-leads', wrap(req => { if (!canView('enquiries', req.user.role)) throw new HttpError(403, 'No access'); return unfinishedLeads(); }));

// ---------------------------------------------------------------- users & settings (admin)
api.get('/users', wrap(() => db.prepare('SELECT * FROM users ORDER BY active DESC, name').all().map(publicUser)));
api.get('/people', wrap(() => db.prepare('SELECT name, role FROM users WHERE active = 1 ORDER BY name').all()));
api.post('/users', requireRole(), wrap(req => {
  const { username, name, role, email, phone, password } = req.body || {};
  if (!username || !name || !roles.roleExists(role)) throw new HttpError(400, 'Username, name and a valid role are required');
  if (!password || password.length < 8) throw new HttpError(400, 'Initial password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username)) throw new HttpError(409, 'Username already exists');
  const info = db.prepare('INSERT INTO users (username, name, role, email, phone, pass_hash, must_change) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(username.trim(), name.trim(), role, email || null, phone || null, hashPassword(password));
  audit(req.user.name, 'users', Number(info.lastInsertRowid), 'create', username);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
}));
api.put('/users/:id', requireRole(), wrap(req => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) throw new HttpError(404, 'User not found');
  const { name = u.name, role = u.role, email = u.email, phone = u.phone, active = !!u.active, password } = req.body || {};
  if (!roles.roleExists(role)) throw new HttpError(400, 'Invalid role');
  if (u.id === req.user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'You cannot remove your own admin access');
  db.prepare('UPDATE users SET name = ?, role = ?, email = ?, phone = ?, active = ? WHERE id = ?').run(name, role, email, phone, active ? 1 : 0, u.id);
  if (password) {
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(req.user.name, 'users', u.id, 'update', `${role}${active ? '' : ' (disabled)'}${password ? ' + password reset' : ''}`);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
}));
api.delete('/users/:id', requireRole(), wrap(req => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'You cannot delete your own login');
  if (u.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(u.id).n === 0) throw new HttpError(400, 'This is the last administrator; make someone else admin first');
  // Records they made keep their name (created by / prepared by); only the login goes.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  audit(req.user.name, 'users', u.id, 'delete', `${u.username} (${u.name})`);
  return { ok: true };
}));
api.get('/settings', wrap(() => getSettings()));
// real photos of each OT part, shown to clients on the enquiry form
migratePhotos();
api.get('/part-photos', requireRole(), wrap(() => listPhotos()));
api.post('/part-photos', requireRole(), express.raw({ type: () => true, limit: '9mb' }), wrap(req => addPhoto(String(req.query.part || ''), String(req.query.name || ''), String(req.query.caption || ''), req.body, req.user)));
api.delete('/part-photos/:id', requireRole(), wrap(req => removePhoto(req.params.id)));
api.put('/settings', requireRole(), wrap(req => { setSettings(req.body || {}); audit(req.user.name, 'settings', null, 'update', Object.keys(req.body || {}).join(', ')); return getSettings(); }));
// Document numbering: continue a series from your own book number (e.g. challans already at 1250 on paper).
const DOC_SERIES = [
  { key: 'challan', label: 'Delivery Challan', prefix: 'DC', table: 'challans', col: 'challan_no' },
  { key: 'challan_ret', label: 'Returnable Challan', prefix: 'RE', table: 'challans', col: 'challan_no' },
];
function docSeries(fy) {
  return DOC_SERIES.map(s => {
    const last = db.prepare('SELECT seq FROM counters WHERE name = ? AND fy = ?').get(s.key, fy)?.seq || 0;
    const used = db.prepare(`SELECT ${s.col} n FROM ${s.table} WHERE ${s.col} LIKE ?`).all(`${s.prefix}-%/20${fy}`)
      .reduce((m, r) => Math.max(m, Number(String(r.n).match(new RegExp(`^${s.prefix}-(\\d+)/`))?.[1]) || 0), 0);
    return { key: s.key, label: s.label, prefix: s.prefix, fy, last, used, next: Math.max(last, used) + 1, example: `${s.prefix}-${String(Math.max(last, used) + 1).padStart(3, '0')}/20${fy}` };
  });
}
api.get('/admin/doc-numbers', requireRole(), wrap(req => docSeries(req.query.fy || fyOf())));
api.put('/admin/doc-numbers', requireRole(), wrap(req => {
  const fy = req.body?.fy || fyOf();
  const s = docSeries(fy).find(x => x.key === req.body?.key);
  if (!s) throw new HttpError(400, 'Unknown document series');
  const next = Number(req.body?.next);
  if (!Number.isInteger(next) || next < 1 || next > 999999) throw new HttpError(400, 'Enter a whole number, e.g. 1251');
  if (next <= s.used) throw new HttpError(400, `${s.prefix}-${String(s.used).padStart(3, '0')}/20${fy} is already used in the CRM, so the next number must be ${s.used + 1} or higher`);
  db.prepare('INSERT INTO counters (name, fy, seq) VALUES (?, ?, ?) ON CONFLICT(name, fy) DO UPDATE SET seq = excluded.seq').run(s.key, fy, next - 1);
  audit(req.user.name, 'settings', null, 'document number', `${s.label}: next ${s.prefix}-${next}/20${fy} (was ${s.next})`);
  return docSeries(fy).find(x => x.key === s.key);
}));
api.get('/audit', wrap(req => {
  if (!hasFunction(req.user.role, 'view_audit')) throw new HttpError(403, 'You do not have permission to see the activity log');
  const { entity, record_id } = req.query;
  if (entity && record_id) return db.prepare('SELECT * FROM audit WHERE entity = ? AND record_id = ? ORDER BY id DESC LIMIT 200').all(entity, Number(record_id));
  return db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 1000').all();
}));

// ---------------------------------------------------------------- dashboard
api.get('/dashboard', wrap(req => {
  const fy = req.query.fy || fyOf();
  const [a, b] = fy.split('-');
  const from = `20${a}-04-01`, to = `20${b}-03-31`;
  const today = new Date().toLocaleString('sv-SE').slice(0, 10);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const enqCounts = all('SELECT status, COUNT(*) n FROM enquiries WHERE date BETWEEN ? AND ? GROUP BY status', from, to);
  const total = enqCounts.reduce((s, r) => s + r.n, 0);
  const won = enqCounts.find(r => r.status === 'Won')?.n || 0;
  const lost = enqCounts.filter(r => ['Lost', 'Regret'].includes(r.status)).reduce((s, r) => s + r.n, 0);
  return {
    fy, from, to,
    kpi: {
      enquiries: total, won, lost, conversion: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      open_quote_value: one("SELECT COALESCE(SUM(grand_total),0) v FROM quotations WHERE status IN ('Approved','Sent','Pending Approval')").v,
      order_value: one("SELECT COALESCE(SUM(order_value),0) v FROM sales_orders WHERE status <> 'Cancelled' AND date BETWEEN ? AND ?", from, to).v,
      receivable: recv.ageing().totals.total,
      collected: one("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status = 'Received' AND date BETWEEN ? AND ?", from, to).v,
      active_projects: one("SELECT COUNT(*) n FROM projects WHERE status = 'Active'").n,
      open_tickets: one("SELECT COUNT(*) n FROM service_tickets WHERE status NOT IN ('Resolved','Closed')").n,
      pending_approvals: one("SELECT COUNT(*) n FROM approvals WHERE status = 'Pending'").n,
      pending_material: one("SELECT COUNT(*) n FROM material_approvals WHERE status IN ('Submitted','Resubmit')").n,
    },
    enquiry_status: enqCounts,
    monthly: all(`SELECT substr(e.date,1,7) month, COUNT(*) enquiries,
        SUM(CASE WHEN e.status = 'Won' THEN 1 ELSE 0 END) won
      FROM enquiries e WHERE e.date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`, from, to),
    by_person: all(`SELECT COALESCE(NULLIF(trim(enquiry_by),''),'(blank)') person, COUNT(*) n,
        SUM(CASE WHEN status = 'Won' THEN 1 ELSE 0 END) won FROM enquiries WHERE date BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC LIMIT 10`, from, to),
    by_work: all(`SELECT COALESCE(NULLIF(trim(type_of_work),''),'(blank)') work, COUNT(*) n FROM enquiries WHERE date BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC LIMIT 8`, from, to),
    followups_due: all(`SELECT 'enquiry' kind, id, enquiry_no ref, COALESCE(hospital_name, doctor_name, place) title, next_followup due, enquiry_by who, status
        FROM enquiries WHERE next_followup IS NOT NULL AND next_followup <= date(?, '+7 day') AND status NOT IN ('Won','Lost','Regret')
      UNION ALL
      SELECT 'followup', f.id, e.enquiry_no, f.notes, f.next_date, f.assigned_to, f.status
        FROM followups f LEFT JOIN enquiries e ON e.id = f.enquiry_id WHERE f.status = 'Open' AND f.next_date IS NOT NULL AND f.next_date <= date(?, '+7 day')
      ORDER BY due LIMIT 30`, today, today),
    approvals: all("SELECT id, doc_type, doc_ref, title, amount, requested_by, requested_at FROM approvals WHERE status = 'Pending' ORDER BY id DESC LIMIT 20"),
    low_stock: all(`SELECT * FROM (SELECT t.id, t.code, t.name, t.uom, t.reorder_level, ${STOCK_SQL.replaceAll('{t}', 't')} AS stock
        FROM items t) WHERE reorder_level > 0 AND stock <= reorder_level ORDER BY name LIMIT 20`),
    stock_value: one(`SELECT COALESCE(SUM(v), 0) v FROM (SELECT ${STOCK_SQL.replaceAll('{t}', 't')} * COALESCE(t.rate, 0) AS v FROM items t)`).v,
    pending_po: one("SELECT COUNT(*) n FROM purchase_orders WHERE status IN ('Pending Approval')").n,
    pending_req: one("SELECT COUNT(*) n FROM requisitions WHERE status = 'Submitted'").n,
    projects: all("SELECT stage, COUNT(*) n FROM projects WHERE status = 'Active' GROUP BY stage"),
    recent: all('SELECT id, enquiry_no, date, hospital_name, doctor_name, place, type_of_work, status FROM enquiries ORDER BY id DESC LIMIT 8'),
    today,
  };
}));

// ---------------------------------------------------------------- workflow actions
const need = (entity) => (req, res, next) => canWrite(entity, req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

api.post('/enquiries/:id/quotation', need('quotations'), wrap(req => wf.quotationFromEnquiry(req.params.id, req.user)));
// structured detailed-form data for the techno-commercial sheet
api.get('/enquiries/:id/brief-data', wrap(req => {
  if (!canView('enquiries', req.user.role)) throw new HttpError(403, 'No access');
  const b = db.prepare('SELECT data, submitted_at, submitted_by FROM design_briefs WHERE enquiry_id = ?').get(Number(req.params.id));
  let data = null; try { data = JSON.parse(b?.data || 'null'); } catch { /* none */ }
  return { data, submitted_at: b?.submitted_at || null, submitted_by: b?.submitted_by || null };
}));
api.post('/enquiries/:id/brief', need('enquiries'), wrap(req => { const e = db.prepare('SELECT id FROM enquiries WHERE id = ?').get(req.params.id); if (!e) throw new HttpError(404, 'Enquiry not found'); let d = {}; const l = db.prepare('SELECT data FROM web_leads WHERE enquiry_id = ?').get(e.id); try { d = JSON.parse(l?.data || '{}'); } catch { /* none */ } return { token: briefFor(e.id, d) }; }));
api.post('/quotations/:id/submit', need('quotations'), wrap(req => wf.submitForApproval('Quotation', req.params.id, req.user)));
api.post('/quotations/:id/revise', need('quotations'), wrap(req => wf.reviseQuotation(req.params.id, req.user)));
api.post('/quotations/:id/convert', need('sales_orders'), wrap(req => wf.convertToSalesOrder(req.params.id, req.body, req.user)));
api.post('/purchase_orders/:id/submit', need('purchase_orders'), wrap(req => wf.submitForApproval('Purchase Order', req.params.id, req.user)));
api.post('/purchase_orders/:id/commercial', wrap(req => wf.poCommercial(req.params.id, req.body, req.user)));
// Accounts marks scheduled vendor payments as paid (also after the PO is approved and locked).
api.post('/purchase_orders/:id/payments', wrap(req => {
  if (!hasFunction(req.user.role, 'po_commercial')) throw new HttpError(403, 'Only commercial / accounts can update the payment schedule');
  if (!Array.isArray(req.body?.payment_schedule)) throw new HttpError(400, 'Send the payment schedule');
  return updateRow('purchase_orders', req.params.id, { payment_schedule: req.body.payment_schedule }, req.user, { system: true });
}));
// Terms of the vendor's last PO (and the vendor's contact), to start a new PO to the same vendor.
api.get('/purchase_orders/last-terms', wrap(req => {
  if (!canView('purchase_orders', req.user.role)) throw new HttpError(403, 'No access');
  const vid = Number(req.query.vendor_id);
  const v = db.prepare('SELECT contact_person, phone FROM vendors WHERE id = ?').get(vid);
  const po = db.prepare('SELECT * FROM purchase_orders WHERE vendor_id = ? AND id <> ? ORDER BY date DESC, id DESC LIMIT 1').get(vid, Number(req.query.exclude) || 0);
  const out = { vendor_contact: v?.contact_person || null, vendor_phone: v?.phone || null, from_po: po?.po_no || null };
  if (po) {
    for (const k of ['term_advance', 'term_balance', 'term_delivery', 'term_warranty', 'term_freight', 'term_validity', 'term_invoice', 'term_jurisdiction', 'terms', 'charges_gst']) out[k] = po[k];
    out.vendor_contact = po.vendor_contact || out.vendor_contact; out.vendor_phone = po.vendor_phone || out.vendor_phone;
    // The pattern of the payment schedule (when / %), without this PO's dates and amounts.
    let sched = []; try { sched = JSON.parse(po.payment_schedule || '[]'); } catch { /* none */ }
    out.payment_schedule = sched.map(p => ({ trigger: p.trigger || 'Fixed date', days: p.days ?? null, description: p.description || '', percent: p.percent ?? null, amount: null, due_date: '', status: 'Due' }));
  }
  return out;
}));
api.post('/requisitions/:id/submit', need('requisitions'), wrap(req => wf.submitForApproval('Requisition', req.params.id, req.user)));
api.post('/requisitions/:id/convert', need('purchase_orders'), wrap(req => wf.requisitionToPO(req.params.id, req.body, req.user)));

// ---------------------------------------------------------------- work order BOQ & delivery challans
api.post('/boqs/upload', need('boqs'), express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  const r = await dispatch.createBoqFromFile({ title: req.query.title, project_id: req.query.project_id, filename: req.query.name, mime: req.headers['x-file-type'] }, req.body, req.user);
  notify.notifyNew('boqs', r.boq, req.user);
  return r;
}));
api.post('/boqs/:id/import', need('boqs'), express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  if (!req.body?.length) throw new HttpError(400, 'Upload the work order .xlsx');
  const r = await dispatch.importBoq(req.params.id, req.body, req.query.mode, req.user);
  roles.saveAttachment('boqs', req.params.id, { filename: req.query.name || 'Work order.xlsx', mime: req.headers['x-file-type'], note: 'Work order (imported)' }, req.body, req.user);
  return r;
}));
// Issuing stock reserved for another project's Final BOQ needs a confirmation (allowReserved).
function reservedCheck(body, lines, ctx) {
  if (body?.allowReserved) return;
  const msg = flow.reservedConflicts(lines, ctx);
  if (msg) throw Object.assign(new HttpError(409, msg), { code: 'RESERVED' });
}
const projectOf = (table, id) => (id ? db.prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(Number(id))?.project_id : null) || null;
api.post('/boqs/:id/dispatch', need('challans'), wrap(req => {
  reservedCheck(req.body, req.body?.picks, { projectId: projectOf('boqs', req.params.id) });
  return dispatch.dispatchFromBoq(req.params.id, req.body, req.user);
}));
api.post('/boms/upload', need('boms'), express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  const r = await dispatch.createBomFromFile({ client: req.query.client, project_id: req.query.project_id, work_order_id: req.query.work_order_id, filename: req.query.name, mime: req.headers['x-file-type'] }, req.body, req.user);
  notify.notifyNew('boms', r.bom, req.user);
  return r;
}));
api.post('/boms/:id/import', need('boms'), express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  if (!req.body?.length) throw new HttpError(400, 'Upload the bill of material .xlsx');
  bomEditable(req.params.id, req.user);
  const r = await dispatch.importBom(req.params.id, req.body, req.query.mode, req.user);
  roles.saveAttachment('boms', req.params.id, { filename: req.query.name || 'Bill of material.xlsx', mime: req.headers['x-file-type'], note: 'Bill of material (imported)' }, req.body, req.user);
  return r;
}));
api.post('/boms/:id/dispatch', need('challans'), wrap(req => {
  reservedCheck(req.body, req.body?.picks, { projectId: projectOf('boms', req.params.id), bomId: req.params.id });
  return dispatch.dispatchFromBom(req.params.id, req.body, req.user);
}));
api.post('/challans/:id/dispatch', need('challans'), wrap(req => {
  const c = db.prepare('SELECT project_id, bom_id, lines FROM challans WHERE id = ?').get(Number(req.params.id));
  if (c) { let lines = []; try { lines = JSON.parse(c.lines || '[]'); } catch { /* none */ } reservedCheck(req.body, lines, { projectId: c.project_id, bomId: c.bom_id }); }
  return dispatch.dispatchChallan(req.params.id, req.body, req.user);
}));

// ---------------------------------------------------------------- work order → BOQ → design review → Final → store check
// Components of a Final BOQ are locked; during design review only reviewers may change them.
function bomEditable(bomId, user) {
  const bom = db.prepare('SELECT bom_no, status, finalized_at FROM boms WHERE id = ?').get(Number(bomId));
  if (!bom) return;
  if (flow.isLocked(bom)) throw new HttpError(409, `${bom.bom_no} is Final and locked. Use “Reopen” (BOQ – make Final permission) to change it.`);
  if (bom.status === 'Design Review' && !hasFunction(user.role, 'boq_review')) throw new HttpError(403, `${bom.bom_no} is in design review; only reviewers can change its components`);
}
api.get('/my-tasks', wrap(req => myTasks(req.user)));
// ---------------------------------------------------------------- payables: payments, expenses, bills, reports
const PAY_DOC = { vendor_payments: 'Payment', expenses: 'Expense' };
for (const entity of Object.keys(PAY_DOC)) {
  api.post(`/${entity}/:id/submit`, need(entity), wrap(req => tx(() => { pay.prepareSubmit(entity, req.params.id, req.user); return wf.submitForApproval(PAY_DOC[entity], req.params.id, req.user); })));
  api.post(`/${entity}/:id/paid`, wrap(req => pay.markPaid(entity, req.params.id, req.body, req.user)));
  api.post(`/${entity}/:id/reverse`, wrap(req => pay.reverse(entity, req.params.id, req.body, req.user)));
}
api.get('/vendor_payments/:id/check', wrap(req => { const r = getRow('vendor_payments', req.params.id); const c = pay.checkPayment(r); return { blockers: c.blockers, notes: c.notes, off_terms: c.offTerms, gm: pay.needsGm({ ...r, off_terms: c.offTerms ? 'Yes' : 'No' }), money: c.m }; }));
api.post('/vendor_bills/:id/override', wrap(req => pay.overrideBill(req.params.id, req.body, req.user)));
const payView = req => { if (!canView('vendor_payments', req.user.role)) throw new HttpError(403, 'No access to payments'); };
api.get('/payables', wrap(req => { payView(req); return pay.payables(req.query); }));
api.get('/vendor-ledger/:id', wrap(req => { payView(req); return pay.vendorLedger(req.params.id); }));
api.get('/payments-register', wrap(req => { payView(req); return pay.register(req.query); }));
const recoRight = req => { if (!hasFunction(req.user.role, 'pay_record')) throw new HttpError(403, 'Bank reconciliation is done by accounts (“mark as paid” permission)'); };
api.post('/bank-reco/preview', express.raw({ type: () => true, limit: '20mb' }), wrap(req => { recoRight(req); return bankreco.preview(req.body); }));
api.post('/bank-reco/confirm', wrap(req => { recoRight(req); return bankreco.confirm(req.body, req.user); }));
// ---------------------------------------------------------------- receivables: invoices, receipts, credit notes, reports
api.post('/invoices/:id/issue', need('invoices'), wrap(req => recv.issueInvoice(req.params.id, req.user)));
api.post('/invoices/:id/cancel', wrap(req => recv.cancelInvoice(req.params.id, req.body, req.user)));
api.post('/payments/:id/reverse', wrap(req => recv.reverseReceipt(req.params.id, req.body, req.user)));
api.post('/payments/:id/form16a', wrap(req => recv.form16aReceived(req.params.id, req.user)));
api.post('/credit_notes/:id/submit', need('credit_notes'), wrap(req => tx(() => { recv.prepareCreditNote(req.params.id, req.user); return wf.submitForApproval('Credit Note', req.params.id, req.user); })));
const arView = req => { if (!canView('invoices', req.user.role)) throw new HttpError(403, 'No access to invoices'); };
api.get('/receivables/ageing', wrap(req => { arView(req); return recv.ageing(req.query); }));
api.get('/customer-statement/:id', wrap(req => { arView(req); return recv.customerStatement(req.params.id, req.query); }));
api.get('/receipts-register', wrap(req => { arView(req); return recv.receiptsRegister(req.query); }));
// Everything about one project's purchasing: POs (approval, received, billed, paid), vendors, requisitions, BOQs, store, sales.
api.get('/projects/:id/analysis', wrap(req => {
  if (!canView('projects', req.user.role) || !canView('purchase_orders', req.user.role)) throw new HttpError(403, 'No access');
  const project = getRow('projects', req.params.id);
  const LIVE = ['Cancelled', 'Rejected'];
  const pos = listRows('purchase_orders', { project_id: project.id, limit: 5000 }).map(p => {
    // Received = material in (GRN) at the PO rate incl. GST; advance at risk = paid beyond that.
    const m = pay.poMoney(p.id);
    const next = (p.payment_schedule || []).filter(x => x.status !== 'Paid' && x.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    return { id: p.id, po_no: p.po_no, date: p.date, vendor: p.vendor_id_label, status: p.status, stage: p.approval_stage, total: p.total || 0,
      received_pct: p.total ? Math.min(100, Math.round(m.received_incl / p.total * 100)) : 0, received_value: m.received_incl, billed: m.billed, paid: m.paid,
      advance_at_risk: m.advance_at_risk, balance: LIVE.includes(p.status) ? 0 : p.balance || 0, next_due: next ? { date: next.due_date, amount: next.amount, what: next.description } : null };
  });
  const live = pos.filter(p => !LIVE.includes(p.status));
  const approved = live.filter(p => !['Draft', 'Pending Approval'].includes(p.status));
  const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
  const byVendor = {};
  for (const p of live) { const v = byVendor[p.vendor] ||= { vendor: p.vendor, pos: 0, value: 0, paid: 0 }; v.pos++; v.value += p.total; v.paid += p.paid; }
  const sales = recv.projectSales(project);
  return {
    project: { id: project.id, name: project.name, no: project.project_no || project.code, customer: project.customer_id_label, stage: project.stage, status: project.status, material_cost: project.material_cost || 0 },
    totals: { pos: live.length, value: sum(live, 'total'), approved_value: sum(approved, 'total'), pending: live.filter(p => p.status === 'Pending Approval').length,
      pending_value: sum(live.filter(p => p.status === 'Pending Approval'), 'total'), drafts: live.filter(p => p.status === 'Draft').length,
      received_value: sum(live, 'received_value'), billed: sum(live, 'billed'), paid: sum(live, 'paid'), to_pay: sum(approved, 'balance'), advance_at_risk: sum(live, 'advance_at_risk'),
      expenses: db.prepare("SELECT COALESCE(SUM(amount), 0) v FROM expenses WHERE project_id = ? AND status = 'Paid'").get(project.id).v,
      due_now: sum(live.filter(p => p.next_due && p.next_due.date <= new Date().toLocaleString('sv-SE').slice(0, 10)), 'balance') },
    pos, vendors: Object.values(byVendor).sort((a, b) => b.value - a.value),
    requisitions: db.prepare("SELECT id, req_no, date, status, required_by FROM requisitions WHERE project_id = ? AND status NOT IN ('Closed', 'Rejected') ORDER BY id DESC").all(project.id),
    boms: listRows('boms', { project_id: project.id }).map(b => ({ id: b.id, bom_no: b.bom_no, client: b.client, status: b.status, lines: b.lines, procured: b.procured_lines, sent: b.sent_lines, progress: b.progress })),
    sales,
  };
}));
api.post('/sales_orders/:id/work-order', need('boqs'), wrap(req => flow.workOrderFromSalesOrder(req.params.id, req.user)));
api.get('/boqs/:id/bom-preview', wrap(req => { if (!canView('boms', req.user.role)) throw new HttpError(403, 'No access'); return flow.matchPreview(req.params.id); }));
api.post('/boqs/:id/generate-bom', need('boms'), wrap(req => flow.generateBom(req.params.id, req.body, req.user)));
api.post('/boms/:id/copy-from', need('boms'), wrap(req => { bomEditable(req.params.id, req.user); return flow.copyFromBom(req.params.id, req.body, req.user); }));
api.post('/boms/:id/submit-review', need('boms'), wrap(req => flow.submitReview(req.params.id, req.user)));
api.post('/boms/:id/review', wrap(req => flow.reviewSection(req.params.id, req.body, req.user)));
api.post('/boms/:id/final', wrap(req => flow.makeFinal(req.params.id, req.body, req.user)));
api.post('/boms/:id/reopen', wrap(req => flow.reopen(req.params.id, req.body, req.user)));
api.get('/boms/:id/stock-check', wrap(req => { if (!canView('boms', req.user.role)) throw new HttpError(403, 'No access'); return { ...flow.stockCheck(req.params.id), reviews: flow.reviewsOf(getRow('boms', req.params.id)) }; }));
api.post('/boms/:id/requisition-shortage', need('requisitions'), wrap(req => {
  const r = flow.requisitionShortage(req.params.id, req.user);
  if (!r.requisition) throw new HttpError(400, 'Nothing to requisition: everything is reserved from stock or already on a requisition / PO');
  return r;
}));
api.post('/material_lists/import-preview', need('material_lists'), express.raw({ type: () => true, limit: '60mb' }), wrap(req => {
  if (!req.body?.length) throw new HttpError(400, 'Upload the bill of material .xlsx');
  return flow.importPreview(req.body);
}));
api.post('/material_lists/import', need('material_lists'), wrap(req => flow.importLists(req.body, req.user)));
api.get('/store/boq-check', wrap(req => { if (!canView('boms', req.user.role)) throw new HttpError(403, 'No access'); return flow.storeOverview(); }));
api.post('/challans/:id/deliver', need('challans'), wrap(req => dispatch.deliverChallan(req.params.id, req.body, req.user)));

// ---------------------------------------------------------------- store
api.post('/stock/entry', need('stock_moves'), wrap(req => {
  const body = { ...req.body, allowWithoutPo: false, allowNegative: !!req.body?.allowNegative && hasFunction(req.user.role, 'allow_negative') };
  if (['OUTWARD', 'TRANSFER', 'SCRAP'].includes(body.type)) {
    reservedCheck(body, body.lines, { projectId: body.project_id || projectOf('boms', body.bom_id) || projectOf('boqs', body.boq_id), bomId: body.bom_id });
  }
  // Outward against a BOQ: the delivery challan is created automatically with the issue.
  const challanOk = () => { if (!canWrite('challans', req.user.role)) throw new HttpError(403, 'You do not have permission to create delivery challans'); };
  if (body.type === 'OUTWARD' && (body.boq_id || body.bom_id)) {
    challanOk();
    const r = body.bom_id ? dispatch.issueAgainstBom(body, req.user) : dispatch.issueAgainstBoq(body, req.user);
    return { doc_no: r.challan.challan_no, challan: r.challan, count: r.challan.lines.length, type: 'OUTWARD' };
  }
  // Outward / transfer with "also make a delivery challan": issue slip and challan are saved together.
  if (body.make_challan && ['OUTWARD', 'TRANSFER'].includes(body.type)) {
    challanOk();
    return tx(() => {
      const r = stock.stockEntry(body, req.user);
      return { ...r, challan: dispatch.challanForIssue(body, r, req.user) };
    });
  }
  return stock.stockEntry(body, req.user);
}));
api.get('/stock/available/:itemId', wrap(req => ({ stock: stock.stockOf(Number(req.params.itemId)) })));
api.get('/stock/summary', wrap(req => stock.stockSummary(req.query)));
api.get('/dashboard/accounts', wrap(req => { if (!canView('invoices', req.user.role) && !hasFunction(req.user.role, 'po_commercial')) throw new HttpError(403, 'No access to accounts'); return stock.accountsDashboard(); }));
api.post('/products/import-boq', need('products'), express.raw({ type: () => true, limit: '30mb' }), wrap(req => importer.importProductBoq(req.body, req.query.set, req.user)));
api.get('/dashboard/store', wrap(req => { if (!canView('items', req.user.role)) throw new HttpError(403, 'No access to the store'); return stock.storeDashboard(req.query); }));
api.get('/items/next-code', wrap(req => ({ code: nextItemCode(req.query.category) })));
api.post('/stock/opening', wrap(req => {
  if (!hasFunction(req.user.role, 'stock_opening')) throw new HttpError(403, 'You do not have permission to create opening stock');
  return stock.carryForwardOpening(req.body?.fy, req.user);
}));
api.get('/reports/po-lines', wrap(req => stock.poLines(req.query)));
api.get('/export/stock-summary', wrap(async (req, res) => {
  const { from, to, rows } = stock.stockSummary(req.query);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stock Summary');
  const cols = [['code', 'Item Code', 10], ['name', 'Item Name', 40], ['category', 'Category', 16], ['abc', 'ABC', 5], ['fsn', 'FSN', 7], ['rate', 'Price', 10], ['uom', 'UOM', 7],
    ['opening', 'Opening', 9], ['inward', 'Inward', 9], ['outward', 'Outward', 9], ['transfer', 'Transfer', 9], ['return', 'Return', 9], ['scrap', 'Scrap', 8], ['adjust', 'Adjust', 8],
    ['closing', 'Closing', 9], ['closing_value', 'Closing Value', 14], ['inward_value', 'Inward Value', 14], ['consumption_value', 'Consumption Value', 16], ['last_out', 'Last Outward', 12], ['days_since_out', 'Days Since', 9]];
  ws.addRow([`Stock Summary ${from} to ${to}`]).font = { bold: true, size: 13 };
  const hdr = ws.addRow(cols.map(c => c[1]));
  hdr.font = { bold: true };
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[2]; });
  for (const r of rows) ws.addRow(cols.map(c => r[c[0]] ?? ''));
  ws.addRow(cols.map(c => c[0] === 'name' ? 'TOTAL' : ['closing_value', 'inward_value', 'consumption_value'].includes(c[0]) ? rows.reduce((s, r) => s + (r[c[0]] || 0), 0) : ''));
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="stock-summary-${to}.xlsx"`);
  res.end(Buffer.from(await wb.xlsx.writeBuffer()));
}));

// ---------------------------------------------------------------- Excel import (preview → commit) and backup
api.get('/import/template/:kind', wrap(async (req, res) => {
  const buf = await importer.templateFile(req.params.kind);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="WIESPL-import-${req.params.kind}.xlsx"`);
  res.end(Buffer.from(buf));
}));
const IMPORT_RIGHTS = { items: 'items', opening: 'stock_moves', stock: 'stock_moves', vendors: 'vendors', projects: 'projects', purchase_orders: 'purchase_orders', requisitions: 'requisitions' };
api.post('/import/preview/:kind', express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  const ent = IMPORT_RIGHTS[req.params.kind];
  if (!ent) throw new HttpError(404, 'Unknown import type');
  if (!canWrite(ent, req.user.role)) throw new HttpError(403, 'You do not have permission to import this');
  if (!req.body?.length) throw new HttpError(400, 'Upload an .xlsx file');
  return importer.preview(req.params.kind, req.body, req.user);
}));
// Old WIESPL PO Excel files, one per call (the import page sends a whole folder file by file).
api.post('/import/po-file', express.raw({ type: () => true, limit: '30mb' }), wrap(async req => {
  if (!canWrite('purchase_orders', req.user.role) || !hasFunction(req.user.role, 'import')) throw new HttpError(403, 'Importing POs needs write access to Purchase Orders and the "Import from Excel" permission');
  if (!req.body?.length) throw new HttpError(400, 'Upload a PO .xlsx');
  const name = String(req.query.name || 'PO.xlsx');
  const r = await importer.importPoFile(req.body, name, req.user);
  audit(req.user.name, 'import', null, 'PO file', `${name}: ${r.map(x => `${x.po_no || ''} ${x.action}`).join(', ')}`);
  return r;
}));
api.post('/import/commit', wrap(req => importer.commit(req.body?.token, req.body?.mode || 'skip', req.user, {
  createMissing: !!req.body?.createMissing, sync: req.body?.sync, removeItems: req.body?.removeItems, canSync: hasFunction(req.user.role, 'import'),
})));

api.get('/admin/backup', requireRole(), wrap(async (req, res) => {
  const file = path.join(os.tmpdir(), `wiespl-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  audit(req.user.name, 'backup', null, 'download');
  res.download(file, `wiespl-crm-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(file, { force: true }, () => {}));
}));
api.post('/admin/restore', requireRole(), express.raw({ type: () => true, limit: '500mb' }), wrap(req => {
  const buf = req.body;
  if (!buf?.length || buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') throw new HttpError(400, 'This is not a WIESPL CRM backup (.db) file');
  const tmp = RESTORE_FILE + '.check';
  fs.writeFileSync(tmp, buf);
  try {
    const check = new DatabaseSync(tmp, { readOnly: true });
    const ok = check.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'enquiries', 'items')").get().c === 3;
    const admins = ok ? check.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1").get().c : 0;
    check.close();
    if (!ok) throw new HttpError(400, 'This file is not a WIESPL CRM database');
    if (!admins) throw new HttpError(400, 'The backup has no active admin user, so nobody could log in after restoring it');
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e.status ? e : new HttpError(400, 'Could not read the backup: ' + e.message); }
  fs.renameSync(tmp, RESTORE_FILE);
  audit(req.user.name, 'backup', null, 'restore scheduled');
  return { ok: true, message: 'Backup accepted. Restart the CRM to finish restoring: close the CRM window and run start-crm.bat again (on Render: Manual Deploy → Restart service). The current data is kept in the backups folder.' };
}));
api.post('/approvals/:id/decide', wrap(req => wf.decide(req.params.id, req.body?.decision, req.body?.comments, req.user)));
api.post('/sales_orders/:id/project', need('projects'), wrap(req => wf.projectFromSalesOrder(req.params.id, req.user)));
api.post('/sales_orders/:id/invoice', need('invoices'), wrap(req => recv.invoiceFromSalesOrder(req.params.id, req.body, req.user)));
api.get('/sales_orders/:id/billing', wrap(req => { if (!canView('invoices', req.user.role)) throw new HttpError(403, 'No access to invoices'); return recv.soBilling(req.params.id); }));

// Status moves that are allowed outside the edit form, per document state.
const TRANSITIONS = {
  quotations: { Approved: ['Sent', 'Lost'], Sent: ['Won', 'Lost'], Rejected: ['Draft'], Lost: ['Draft'] },
  purchase_orders: { Draft: ['Cancelled'], Approved: ['Sent', 'Cancelled'], Sent: ['Cancelled'], Rejected: ['Draft', 'Cancelled'], 'Partially Received': ['Closed'] },
  requisitions: { Draft: ['Closed'], Rejected: ['Draft', 'Closed'], Approved: ['Closed'], 'Converted to PO': ['Closed'] },
  challans: { Draft: ['Cancelled'] },
};
api.post('/:entity/:id/status', wrap(req => {
  const { entity, id } = req.params;
  const map = TRANSITIONS[entity];
  if (!map) throw new HttpError(404, 'Not supported');
  if (!canWrite(entity, req.user.role)) throw new HttpError(403, 'You do not have permission for this action');
  const row = getRow(entity, id);
  const to = req.body?.status;
  if (!(map[row.status] || []).includes(to)) throw new HttpError(400, `Cannot change status from ${row.status} to ${to}`);
  return updateRow(entity, id, { status: to }, req.user, { system: true });
}));

// ---------------------------------------------------------------- excel
api.get('/export/:entity', wrap(async (req, res) => {
  entityOr404(req.params.entity);
  const buf = await exportEntity(req.params.entity, req.query);
  const fname = `${req.params.entity}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.end(Buffer.from(buf));
}));
api.post('/import/enquiries', need('enquiries'), express.raw({ type: () => true, limit: '25mb' }), wrap(async req => {
  if (!req.body?.length) throw new HttpError(400, 'Upload an .xlsx file');
  return importEnquiries(req.body, req.user);
}));

// ---------------------------------------------------------------- roles & permissions (admin)
const viewable = req => { entityOr404(req.params.entity); if (!canView(req.params.entity, req.user.role)) throw new HttpError(403, 'You do not have access to this module'); };
api.get('/roles', wrap(() => roles.listRoles()));
api.post('/roles', requireRole(), wrap(req => roles.saveRole(null, req.body, req.user)));
api.put('/roles/:name', requireRole(), wrap(req => roles.saveRole(req.params.name, req.body, req.user)));
api.delete('/roles/:name', requireRole(), wrap(req => { roles.deleteRole(req.params.name, req.user); return { ok: true }; }));

// ---------------------------------------------------------------- file attachments (work orders, drawings, CAD …)
api.get('/attachments/:entity/:id', wrap(req => { viewable(req); return roles.listAttachments(req.params.entity, req.params.id); }));
api.post('/attachments/:entity/:id', express.raw({ type: () => true, limit: '200mb' }), wrap(req => {
  if (!canWrite(req.params.entity, req.user.role)) throw new HttpError(403, 'You do not have permission to add files here');
  return roles.saveAttachment(req.params.entity, req.params.id, { filename: req.query.name, mime: req.headers['x-file-type'], note: req.query.note }, req.body, req.user);
}));
api.get('/files/:id', wrap((req, res) => {
  const a = roles.attachmentFile(req.params.id);
  if (!canView(a.entity, req.user.role)) throw new HttpError(403, 'You do not have access to this file');
  const inline = req.query.inline && /^(image\/|application\/pdf|text\/plain)/.test(a.mime || '');
  res.setHeader('Content-Type', inline ? a.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.sendFile(a.full);
}));
api.delete('/files/:id', wrap(req => {
  const a = roles.attachmentFile(req.params.id);
  roles.deleteAttachment(req.params.id, req.user, canDelete(a.entity, req.user.role));
  return { ok: true };
}));

// ---------------------------------------------------------------- generic CRUD for every module
// Documents locked once they enter approval; changes go through Revise / status actions.
const LOCKED = {
  quotations: ['Pending Approval', 'Approved', 'Sent', 'Won', 'Lost', 'Superseded'],
  purchase_orders: ['Pending Approval', 'Approved', 'Sent', 'Partially Received', 'Received', 'Closed', 'Cancelled'],
  requisitions: ['Submitted', 'Approved', 'Converted to PO', 'Closed'],
  challans: ['Dispatched', 'Delivered', 'Cancelled'],
  // Once submitted, a payment / expense changes only through approve / reject / paid / reverse.
  vendor_payments: ['Pending Approval', 'Approved', 'Paid', 'Reversed'],
  expenses: ['Pending Approval', 'Approved', 'Paid', 'Reversed'],
  // An issued invoice is corrected only by a credit note; a receipt only by the GM's reversal.
  invoices: ['Issued', 'Partially Paid', 'Retention Held', 'Paid', 'Cancelled'],
  payments: ['Received', 'Reversed'],
  credit_notes: ['Pending Approval', 'Approved'],
};

api.get('/:entity/options', wrap(req => { entityOr404(req.params.entity); return options(req.params.entity, req.query.q); }));
api.get('/:entity', wrap(req => { viewable(req); return listRows(req.params.entity, req.query); }));
api.get('/:entity/:id', wrap(req => { viewable(req); return getRow(req.params.entity, req.params.id); }));
api.post('/:entity', wrap(req => {
  const ent = entityOr404(req.params.entity);
  if (!canWrite(req.params.entity, req.user.role) || ent.noCreate) throw new HttpError(403, 'You do not have permission to create this');
  if (req.params.entity === 'bom_items') bomEditable(req.body?.bom_id, req.user);
  if (req.params.entity === 'boms' && ['Design Review', 'Final'].includes(req.body?.status)) throw new HttpError(400, 'Save the BOQ as Draft; Design Review and Final are set with the buttons on the BOQ');
  const row = insertRow(req.params.entity, req.body || {}, req.user);
  notify.notifyNew(req.params.entity, row, req.user);
  if (req.params.entity === 'bom_items') flow.touchReview(row.bom_id, [row.department], req.user);
  return row;
}));
api.put('/:entity/:id', wrap(req => {
  const { entity, id } = req.params;
  entityOr404(entity);
  if (!canWrite(entity, req.user.role)) throw new HttpError(403, 'You do not have permission to edit this');
  if (LOCKED[entity]) {
    const st = db.prepare(`SELECT status FROM ${entity} WHERE id = ?`).get(Number(id))?.status;
    if (LOCKED[entity].includes(st)) throw new HttpError(409, `This document is ${st} and locked.${entity === 'quotations' ? ' Use Revise to make changes.' : ''}`);
  }
  const body = { ...(req.body || {}) };
  if (entity === 'bom_items') {
    const cur = db.prepare('SELECT bom_id, department FROM bom_items WHERE id = ?').get(Number(id));
    bomEditable(cur?.bom_id, req.user);
    if (body.bom_id && Number(body.bom_id) !== cur?.bom_id) bomEditable(body.bom_id, req.user);
    const row = updateRow(entity, id, body, req.user);
    flow.touchReview(row.bom_id, [cur?.department, row.department], req.user);
    return row;
  }
  if (entity === 'boms') {
    // Reviews and the Final stamp only change through the review / Final / Reopen actions.
    delete body.reviews;
    const cur = db.prepare('SELECT status, finalized_at FROM boms WHERE id = ?').get(Number(id));
    const to = body.status;
    const FLOW = ['Design Review', 'Final'];
    if (to !== undefined && to !== cur?.status && (FLOW.includes(to) || (FLOW.includes(cur?.status) && !cur?.finalized_at))) {
      throw new HttpError(400, 'Use the BOQ buttons for design review and Final');
    }
    if (cur?.finalized_at) {
      // A Final BOQ: only its progress (In Progress / Completed / On Hold), remarks and required-by date may change.
      const stored = db.prepare('SELECT * FROM boms WHERE id = ?').get(Number(id));
      const keys = new Set(ENTITIES.boms.fields.filter(f => !f.computed && !f.readonly).map(f => f.key));
      const extra = Object.keys(body).filter(k => keys.has(k) && !['status', 'remarks', 'required_by'].includes(k) && String(body[k] ?? '') !== String(stored[k] ?? ''));
      if (extra.length) throw new HttpError(409, `This BOQ is Final and locked (${extra.join(', ')}). Use “Reopen” to change it.`);
      if (to !== undefined && to !== cur.status && !['Final', 'In Progress', 'Completed', 'On Hold'].includes(to)) throw new HttpError(400, `A Final BOQ cannot go back to ${to}; use “Reopen”`);
    }
  }
  return updateRow(entity, id, body, req.user);
}));
api.delete('/:entity/:id', wrap(req => {
  const { entity, id } = req.params;
  const ent = entityOr404(entity);
  const row = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Record not found');
  if (entity === 'bom_items') bomEditable(row.bom_id, req.user);
  if (PAY_DOC[entity] && !['Draft', 'Rejected'].includes(row.status)) throw new HttpError(409, `A ${row.status.toLowerCase()} ${ENTITIES[entity].singular.toLowerCase()} cannot be deleted${row.status === 'Paid' ? '; the GM can reverse it with a reason' : ''}`);
  if (entity === 'payments') throw new HttpError(409, 'A receipt cannot be deleted; the GM can reverse it with a reason (e.g. cheque bounced)');
  if (entity === 'invoices' && row.status !== 'Draft') throw new HttpError(409, `An issued invoice cannot be deleted${hasFunction(req.user.role, 'pay_final') ? '; cancel it (with a reason) or make a credit note' : '; the GM can cancel it, or make a credit note'}`);
  if (entity === 'credit_notes' && !['Draft', 'Rejected'].includes(row.status)) throw new HttpError(409, `A ${row.status.toLowerCase()} credit note cannot be deleted`);
  if (entity === 'vendor_bills' && db.prepare("SELECT 1 FROM vendor_payments WHERE bill_id = ? AND status <> 'Draft'").get(row.id)) throw new HttpError(409, 'Payments are recorded against this bill; it cannot be deleted (record a debit note instead)');
  if (entity === 'boms' && flow.isLocked(row)) throw new HttpError(409, `${row.bom_no} is Final; Reopen it before deleting`);
  const full = canDelete(entity, req.user.role) || (['bom_items', 'boq_items'].includes(entity) && canWrite(entity, req.user.role));
  if (!canRemove(entity, row, req.user, full && canWrite(entity, req.user.role))) {
    throw new HttpError(403, `Only the person who created this ${ent.singular.toLowerCase()} (while it is a Draft) or someone with full access to ${ent.label} can delete it`);
  }
  deleteRow(entity, id, req.user);
  roles.removeAttachmentsOf(entity, id);
  if (entity === 'bom_items') flow.touchReview(row.bom_id, [row.department], req.user);
  return { ok: true };
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error: ' + err.message : err.message });
});

// Daily store check of Final BOQs (new shortages → Draft requisition, order-by reminders); checked every 30 minutes.
setTimeout(() => flow.dailyTick(), 60 * 1000);
setInterval(() => flow.dailyTick(), 30 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  WIESPL CRM running`);
  console.log(`    This PC:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`    Office network: http://${ip}:${PORT}`);
  console.log('');
});

export { ENTITIES };
