// Who may call which route, on a COPY of the data. Starts the server on the copy, opens sessions for test logins written into
// the copy (no passwords involved) and calls the routes as each role. It refuses to run on the real data folder.
//   WIESPL_DATA_DIR=<folder with a copy of wiespl.db> node tools/test-route-access.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.WIESPL_DATA_DIR;
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
if (!DIR || !fs.existsSync(path.join(DIR, 'wiespl.db'))) { console.error('Set WIESPL_DATA_DIR to a folder with a copy of wiespl.db'); process.exit(2); }
if (same(DIR, path.join(ROOT, 'data')) || same(DIR, 'C:/Users/WIESPL/ERP-WIESPL/data')) { console.error('This is a real data folder: use a copy'); process.exit(2); }

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---------------------------------------------------------------- every route has a rule on purpose
// A route line must show its check, or be listed here with where the rule is. A new route fails this test until decided.
const SELF = ['GET /me', 'POST /me/password', 'GET /notifications', 'POST /notifications/read', 'GET /my-tasks', 'GET /my-drafts', 'GET /performance', 'GET /performance/team', 'POST /performance/team',
  'GET /hr/me', 'POST /hr/clock-in', 'POST /hr/check', 'POST /hr/going-out', 'POST /hr/back', 'POST /hr/clock-out', 'POST /hr/leave']; // own data, or scope worked out for the person
const ALL_OFFICE = ['GET /people', 'GET /brand/stamp', 'GET /signatures', 'GET /signatures/:id', 'GET /settings']; // name pickers; printing any document (/settings is filtered per role)
const INSIDE = ['POST /purchase_orders/:id/commercial', 'POST /boqs/:id/departments', 'POST /iqc', 'GET /health', 'POST /vendors/:id/status', 'GET /planner/portfolio', 'GET /projects/:id/schedule', 'PUT /projects/:id/schedule',
  'POST /projects/:id/schedule/template', 'POST /projects/:id/schedule/baseline', 'POST /boms/:id/review', 'POST /boms/:id/final', 'POST /boms/:id/reopen', 'POST /material_requests/:id/process', 'POST /material_requests/:id/reject',
  'POST /production_entries/:id/post', 'POST /invoices/:id/cancel', 'POST /payments/:id/reverse', 'POST /payments/:id/form16a', 'POST /vendor_bills/:id/override', 'POST /separations/:id/act/:action', 'POST /attendance/:id/review',
  'POST /service_work_orders/:id/to-store', 'POST /amc_contracts/:id/proforma', 'POST /costing_sheets/:id/to-quotation', 'POST /costing_sheets/:id/proforma', 'POST /approvals/:id/decide', 'PUT /signatures/:id', 'DELETE /signatures/:id',
  'DELETE /files/:id', 'DELETE /:entity/:id', 'POST /login', 'POST /logout']; // checked in the function the route calls or further down its handler (login: before the session)
const known = new Set([...SELF, ...ALL_OFFICE, ...INSIDE]);
const src = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8').split(/\r?\n/);
const SHOWN = /requireRole\(|need\(|canView\(|canWrite\(|hasFunction\(|viewable\(|pickable\(|\b(recoRight|payView|arView|lotView|prodView|planView|qaView|hrView|storeView|itemView)\(req\)/;
const undecided = [];
src.forEach((line, i) => {
  const m = line.match(/^\s*api\.(get|post|put|delete)\((['`])([^'`]+)\2/);
  if (!m) return;
  const key = `${m[1].toUpperCase()} ${m[3]}`;
  if (known.has(key) || m[3].includes('${')) return;
  // the check may be on the following lines of a longer handler
  const body = src.slice(i, i + 6).join('\n');
  if (!SHOWN.test(body)) undecided.push(key);
});
ok(!undecided.length, `every route shows its check or is on the list${undecided.length ? ': ' + undecided.join(', ') : ''}`);

// ---------------------------------------------------------------- calls as each role
const ROLES = ['admin', 'manager', 'sales', 'accounts', 'store', 'engineer', 'purchase', 'purchase_head', 'technical', 'production', 'service', 'hr', 'planning', 'worker', 'incharge'];
const db = new DatabaseSync(path.join(DIR, 'wiespl.db'));
const tokens = {};
for (const role of ROLES) {
  const name = `rt_${role}`;
  db.prepare('DELETE FROM users WHERE username = ?').run(name);
  const id = Number(db.prepare("INSERT INTO users (username, name, role, pass_hash, active, must_change) VALUES (?, ?, ?, 'no-login', 1, 0)").run(name, `RT ${role}`, role).lastInsertRowid);
  tokens[role] = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(tokens[role], id, new Date(Date.now() + 864e5).toISOString());
}
const firstId = t => db.prepare(`SELECT id FROM ${t} ORDER BY id LIMIT 1`).get()?.id;
const payId = firstId('vendor_payments');
db.close();

const PORT = Number(process.env.TEST_PORT) || 3917;
const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, WIESPL_DATA_DIR: DIR, PORT: String(PORT) }, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
const base = `http://localhost:${PORT}/api`;
for (let i = 0; ; i++) {
  try { await fetch(base + '/me'); break; } catch { if (i > 150) { console.error('The server did not start'); process.exit(2); } await new Promise(r => setTimeout(r, 200)); }
}
const call = (role, url, opts = {}) => fetch(base + url, { ...opts, headers: { ...opts.headers, ...(role ? { cookie: `wiespl_sid=${tokens[role]}` } : {}) } });
const status = async (role, url, opts) => (await call(role, url, opts)).status;
const json = async (role, url) => (await call(role, url)).json();
const OFFICE = ROLES.filter(r => !['worker', 'incharge'].includes(r));

// [route, the office roles that may call it (default permissions as stored in the copy)]
const roleSees = async () => Object.fromEntries((await json('admin', '/roles')).map(r => [r.name, r.perms]));
const perms = await roleSees();
const view = (role, m) => role === 'admin' || (perms[role]?.modules?.[{ boq_items: 'boqs', bom_items: 'boms' }[m] || m] || 'none') !== 'none';
const write = (role, m) => role === 'admin' || ['edit', 'full'].includes(perms[role]?.modules?.[m]);
const fn = (role, f) => role === 'admin' || (perms[role]?.functions || []).includes(f);
const allowed = async (url, rule, label = url) => {
  const wrong = [];
  for (const role of OFFICE) {
    const s = await status(role, url);
    const may = rule(role);
    if (may ? s === 403 : s !== 403) wrong.push(`${role} got ${s}`);
  }
  ok(!wrong.length, `${label}${wrong.length ? ': ' + wrong.join(', ') : ''}`);
};
const admin = r => r === 'admin';
await allowed('/users', admin);
await allowed('/roles', admin);
await allowed('/dashboard', r => view(r, 'enquiries'));
await allowed('/stock/summary', r => view(r, 'items'));
await allowed('/stock/available/1', r => view(r, 'items'));
await allowed('/export/stock-summary', r => view(r, 'items'));
await allowed('/items/next-code?category=Hardware', r => write(r, 'items'));
await allowed('/reports/po-lines', r => view(r, 'purchase_orders'));
await allowed('/media/or', r => view(r, 'enquiries'));
await allowed('/media/or/none.mp4', r => view(r, 'enquiries'));
for (const m of ['employees', 'vendor_payments', 'invoices', 'enquiries', 'items', 'work_tasks']) await allowed(`/export/${m}`, r => view(r, m));
for (const k of ['items', 'vendors', 'purchase_orders']) await allowed(`/import/template/${k}`, r => write(r, k === 'items' ? 'items' : k) || fn(r, 'import'));
if (payId) await allowed(`/vendor_payments/${payId}/check`, r => view(r, 'vendor_payments'));

// logged-out: nothing
for (const u of ['/users', '/roles', '/settings', '/dashboard', '/items/options', '/export/items']) ok(await status(null, u) === 401, `${u}: logged out is refused`);

// pick lists: every list a form of the role points to opens, the rest do not
const SCHEMA = await import(new URL('../public/js/schema.js', import.meta.url));
const { ENTITIES } = SCHEMA;
const wrongLists = [];
for (const role of ['sales', 'store', 'hr', 'production', 'service', 'accounts']) {
  const seen = Object.keys(ENTITIES).filter(k => view(role, k));
  const need = new Set(seen);
  for (const k of seen) for (const f of ENTITIES[k].fields) { if (f.ref) need.add(f.ref); if (f.itemRef) need.add('items'); for (const c of f.columns || []) if (c.ref) need.add(c.ref); }
  for (const k of Object.keys(ENTITIES)) {
    const s = await status(role, `/${k}/options`);
    if (need.has(k) ? s !== 200 : s !== 403) wrongLists.push(`${role} ${k} ${s}`);
  }
}
ok(!wrongLists.length, `pick lists follow the forms of each role${wrongLists.length ? ': ' + wrongLists.join(', ') : ''}`);
ok(await status('store', '/employees/options') === 403 && await status('sales', '/employees/options') === 403, 'store and sales cannot list the employees');
ok(await status('hr', '/employees/options') === 200 && await status('hr', '/vendors/options') === 403, 'HR lists the employees, not the vendors');
ok(await status('worker', '/customers/options') === 200 && await status('worker', '/employees/options') === 403, 'worker: lists of the task form only');
ok(await status('worker', '/dashboard') === 403 && await status('worker', '/export/items') === 403, 'worker: still stopped by the guard');
ok(await status('admin', '/nothing/options') === 404, 'unknown list: not found');

// settings: printing still works, the rest is the admin's
const PRINT = ['company_name', 'reg_address', 'gstin', 'bank_details', 'pan', 'terms', 'po_term_delivery', 'po_delivery_address', 'letter_intro'];
const PRIVATE = ['web_estimates', 'hr_absence_alerts', 'hr_file_alerts'];
for (const role of ['store', 'sales', 'manager']) {
  const s = await json(role, '/settings');
  const m = (await json(role, '/me')).settings;
  ok(PRINT.every(k => k in s) && PRINT.every(k => k in m), `${role}: settings for printed documents and forms are there`);
  ok(PRIVATE.every(k => !(k in s)) && PRIVATE.every(k => !(k in m)), `${role}: margins, limits, HR rules and web form are not`);
}
ok('web_estimates' in (await json('admin', '/settings')), 'admin: all settings');
ok('hr_bond_template' in (await json('hr', '/settings')) && !('hr_bond_template' in (await json('store', '/settings'))), 'bond text: HR yes, store no');
ok(Object.keys((await json('worker', '/me')).settings).join() === 'company_name', 'worker: company name only');
ok(await status('store', '/settings', { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } }) === 403, 'store cannot change settings');

// dashboard: tiles of the modules the role opens
const gm = await json('manager', '/dashboard'), sales = await json('sales', '/dashboard');
ok(gm.kpi.receivable !== undefined && gm.kpi.open_tickets !== undefined && gm.pending_po !== undefined && gm.stock_value !== undefined, 'GM: every tile');
ok(sales.kpi.receivable === undefined && sales.kpi.collected === undefined && sales.kpi.open_tickets === undefined && sales.pending_po === undefined && sales.pending_req === undefined, 'sales: no receivable, service or purchase figures');
ok(sales.kpi.enquiries !== undefined && sales.kpi.open_quote_value !== undefined && sales.kpi.order_value !== undefined && Array.isArray(sales.followups_due) && Array.isArray(sales.low_stock), 'sales: enquiries, quotes, orders, follow-ups stay');

// the Excel export of tasks follows the task rules
const ExcelJS = (await import('exceljs')).default;
const tasksIn = async role => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await (await call(role, '/export/work_tasks')).arrayBuffer()));
  return wb.worksheets[0].rowCount;
};
const db2 = new DatabaseSync(path.join(DIR, 'wiespl.db'));
db2.prepare("INSERT INTO work_tasks (task_no, title, assigned_to, assigned_by, status) VALUES ('RT-1', 'Route test task', 'RT hr', 'RT hr', 'Open')").run();
db2.close();
ok(await tasksIn('hr') > await tasksIn('store'), 'tasks export: the person who assigns sees more than someone who does not');

// import commit: the file's module decides, also with someone else's preview token
const xlsx = await (async () => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Vendors'); ws.addRow(['Vendor Name', 'GSTIN', 'PAN', 'Address', 'City', 'State', 'Pincode', 'Contact Person', 'Phone', 'Email']); ws.addRow(['RT Vendor', '', '', '', 'Pune', 'Maharashtra', '', '', '', '']); return Buffer.from(await wb.xlsx.writeBuffer()); })();
const pv = await call('admin', '/import/preview/vendors', { method: 'POST', body: xlsx, headers: { 'content-type': 'application/octet-stream' } });
const prev = await pv.json();
ok(pv.status === 200 && prev.token, 'admin previews a vendor file');
if (prev.token) ok(await status('hr', '/import/commit', { method: 'POST', body: JSON.stringify({ token: prev.token, mode: 'skip' }), headers: { 'content-type': 'application/json' } }) === 403, 'HR cannot commit it, even with the token');

// the printed PO: its vendor's address for whoever sees the PO, without opening the vendor master
const poId = (await json('admin', '/purchase_orders?limit=1'))[0]?.id;
if (poId) {
  await allowed(`/purchase_orders/${poId}/vendor`, r => view(r, 'purchase_orders'), 'vendor of a printed PO');
  const pv2 = await json('technical', `/purchase_orders/${poId}/vendor`);
  ok(pv2.name && 'state' in pv2 && !Object.keys(pv2).some(k => /bank|ifsc|account|pan/i.test(k)), 'technical gets name, address and state of the PO vendor, no bank details or PAN');
  ok(await status('technical', '/vendors/options') === 200 && await status('technical', `/vendors/${(await json('admin', '/vendors?limit=1'))[0]?.id}`) === 403, 'technical still cannot open the vendor master');
}

// the older checks are still there
ok(await status('store', '/payables') === 403 && await status('sales', '/receipts-register') === 403 && await status('store', '/audit') === 403, 'older report checks unchanged');
ok(await status('sales', '/people') === 200 && await status('sales', '/signatures') === 200, 'name pickers and signatures: any office role');
stop();
console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
process.exit(process.exitCode || 0);
