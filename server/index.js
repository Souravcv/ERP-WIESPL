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
import { tx } from './db.js';
import * as wf from './workflows.js';
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
api.get('/settings', wrap(() => getSettings()));
api.put('/settings', requireRole(), wrap(req => { setSettings(req.body || {}); audit(req.user.name, 'settings', null, 'update', Object.keys(req.body || {}).join(', ')); return getSettings(); }));
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
      receivable: one("SELECT COALESCE(SUM(i.total - (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id = i.id)),0) v FROM invoices i WHERE i.status IN ('Issued','Partially Paid') AND i.type = 'Tax Invoice'").v,
      collected: one('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date BETWEEN ? AND ?', from, to).v,
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
api.post('/quotations/:id/submit', need('quotations'), wrap(req => wf.submitForApproval('Quotation', req.params.id, req.user)));
api.post('/quotations/:id/revise', need('quotations'), wrap(req => wf.reviseQuotation(req.params.id, req.user)));
api.post('/quotations/:id/convert', need('sales_orders'), wrap(req => wf.convertToSalesOrder(req.params.id, req.body, req.user)));
api.post('/purchase_orders/:id/submit', need('purchase_orders'), wrap(req => wf.submitForApproval('Purchase Order', req.params.id, req.user)));
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
api.post('/boqs/:id/dispatch', need('challans'), wrap(req => dispatch.dispatchFromBoq(req.params.id, req.body, req.user)));
api.post('/boms/upload', need('boms'), express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  const r = await dispatch.createBomFromFile({ client: req.query.client, project_id: req.query.project_id, work_order_id: req.query.work_order_id, filename: req.query.name, mime: req.headers['x-file-type'] }, req.body, req.user);
  notify.notifyNew('boms', r.bom, req.user);
  return r;
}));
api.post('/boms/:id/import', need('boms'), express.raw({ type: () => true, limit: '60mb' }), wrap(async req => {
  if (!req.body?.length) throw new HttpError(400, 'Upload the bill of material .xlsx');
  const r = await dispatch.importBom(req.params.id, req.body, req.query.mode, req.user);
  roles.saveAttachment('boms', req.params.id, { filename: req.query.name || 'Bill of material.xlsx', mime: req.headers['x-file-type'], note: 'Bill of material (imported)' }, req.body, req.user);
  return r;
}));
api.post('/boms/:id/dispatch', need('challans'), wrap(req => dispatch.dispatchFromBom(req.params.id, req.body, req.user)));
api.post('/challans/:id/dispatch', need('challans'), wrap(req => dispatch.dispatchChallan(req.params.id, req.body, req.user)));
api.post('/challans/:id/deliver', need('challans'), wrap(req => dispatch.deliverChallan(req.params.id, req.body, req.user)));

// ---------------------------------------------------------------- store
api.post('/stock/entry', need('stock_moves'), wrap(req => {
  const body = { ...req.body, allowWithoutPo: false, allowNegative: !!req.body?.allowNegative && hasFunction(req.user.role, 'allow_negative') };
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
api.post('/import/commit', wrap(req => importer.commit(req.body?.token, req.body?.mode || 'skip', req.user, { createMissing: !!req.body?.createMissing })));

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
api.post('/sales_orders/:id/invoice', need('invoices'), wrap(req => wf.invoiceFromSalesOrder(req.params.id, req.body, req.user)));

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
};

api.get('/:entity/options', wrap(req => { entityOr404(req.params.entity); return options(req.params.entity, req.query.q); }));
api.get('/:entity', wrap(req => { viewable(req); return listRows(req.params.entity, req.query); }));
api.get('/:entity/:id', wrap(req => { viewable(req); return getRow(req.params.entity, req.params.id); }));
api.post('/:entity', wrap(req => {
  const ent = entityOr404(req.params.entity);
  if (!canWrite(req.params.entity, req.user.role) || ent.noCreate) throw new HttpError(403, 'You do not have permission to create this');
  const row = insertRow(req.params.entity, req.body || {}, req.user);
  notify.notifyNew(req.params.entity, row, req.user);
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
  return updateRow(entity, id, req.body || {}, req.user);
}));
api.delete('/:entity/:id', wrap(req => {
  const { entity, id } = req.params;
  const ent = entityOr404(entity);
  const row = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Record not found');
  const full = canDelete(entity, req.user.role) || (['bom_items', 'boq_items'].includes(entity) && canWrite(entity, req.user.role));
  if (!canRemove(entity, row, req.user, full && canWrite(entity, req.user.role))) {
    throw new HttpError(403, `Only the person who created this ${ent.singular.toLowerCase()} (while it is a Draft) or someone with full access to ${ent.label} can delete it`);
  }
  deleteRow(entity, id, req.user);
  roles.removeAttachmentsOf(entity, id);
  return { ok: true };
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error: ' + err.message : err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  WIESPL CRM running`);
  console.log(`    This PC:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`    Office network: http://${ip}:${PORT}`);
  console.log('');
});

export { ENTITIES };
