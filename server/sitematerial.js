// Site material (Projects → Site Material): every item sent to a project's site is accounted for (owner, 21 Nov 2026).
//   Sent to site = installed (billed / measured, entered by the office) + returned to the store + still at site
//                  (supervisor's last count) + allowed wastage (% per category) → anything else is Unaccounted.
// The site supervisor (project's Site Engineer) confirms each challan on arrival (short / damaged, photo), counts the
// high-value items weekly and sends leftovers back; the store weighs scrap that comes back (Scrap Register); the Projects
// head enters the installed quantities, approves material above the BOQ and signs the site closure before handover.
// Material issued to a department (Production …) is factory material, not site material.
import { db, tx, getSettings, setSettings, audit } from './db.js';
import { HttpError, getRow, insertRow, updateRow } from './crud.js';
import { canView, canWrite, hasFunction, COMPANY_DEPARTMENTS } from '../public/js/schema.js';
import { saveAttachment } from './roles.js';
import { notify } from './notify.js';
import { compute as computeSchedule } from './schedule.js';

db.exec(`CREATE TABLE IF NOT EXISTS site_installed (project_id INTEGER NOT NULL, item_id INTEGER NOT NULL, qty REAL, note TEXT, by_user TEXT, at TEXT,
  PRIMARY KEY (project_id, item_id))`);

const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const parse = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const DEPT_KEYS = COMPANY_DEPARTMENTS.map(d => d.toLowerCase());
// a slip to a department (or the store itself) is factory material, not material at the site
const toDept = t => { const s = String(t || '').trim().toLowerCase(); return !!s && (s === 'store' || s === 'main store' || DEPT_KEYS.some(k => s === k || s.startsWith(`${k} `) || s.startsWith(`${k}-`))); };

export const mayView = user => ['projects', 'challans', 'stock_moves'].some(e => canView(e, user.role)) || hasFunction(user.role, 'site_material');
const needView = user => { if (!mayView(user)) throw new HttpError(403, 'No access to site material'); };
const isHead = user => hasFunction(user.role, 'site_recon');
const project = pid => {
  const p = db.prepare(`SELECT p.id, p.name, p.project_no, p.code, p.status, p.progress, p.engineer, p.site, p.site_distance, p.site_store,
      p.recon_supervisor_sign, p.recon_head_sign, c.name client FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`).get(Number(pid));
  if (!p) throw new HttpError(404, 'Project not found');
  // work done: the Project Planner's weighted progress when it has a schedule; else the project's own figure (0 = not known)
  const acts = db.prepare('SELECT COUNT(*) n FROM schedule_activities WHERE project_id = ?').get(p.id).n;
  if (acts) { try { p.progress = computeSchedule(p.id, { save: false }).summary.progress; } catch { p.progress = Number(p.progress) || null; } }
  else p.progress = Number(p.progress) || null;
  return p;
};
// the supervisor of a site: the project's Site Engineer (or anyone with the site material right when none is set)
const isSupervisor = (p, user) => (p.engineer ? p.engineer === user.name : false);
// only that site's engineer (or the Projects head) confirms and counts; with no engineer set, anyone with the site right
const mayAct = (p, user) => isSupervisor(p, user) || isHead(user) || (!p.engineer && hasFunction(user.role, 'site_material'));

export const allowances = () => { const s = getSettings().site_wastage; return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };

// One project, item by item.
export function reconcile(pid, user) {
  needView(user);
  const p = project(pid);
  const prices = hasFunction(user.role, 'see_stock_value');
  const items = new Map(db.prepare('SELECT id, code, name, uom, rate, category, site_watch FROM items').all().map(i => [i.id, i]));
  const allow = allowances();
  const rows = new Map();
  const row = id => {
    if (!rows.has(id)) rows.set(id, { item_id: id, required: 0, sent: 0, spare: 0, short: 0, damaged: 0, returned: 0, installed: null, at_site: null, counted_on: null });
    return rows.get(id);
  };
  // the material budget: the project's BOQs
  for (const b of db.prepare(`SELECT bi.item_id, SUM(bi.qty) q FROM bom_items bi JOIN boms b ON b.id = bi.bom_id
      WHERE b.project_id = ? AND COALESCE(b.status, '') <> 'Cancelled' AND bi.item_id IS NOT NULL AND bi.qty > 0 GROUP BY bi.item_id`).all(p.id)) row(b.item_id).required = r3(b.q);
  // sent to the site (issues and transfers for the project, not to a department) and returned from it
  // (material at a job-work vendor for the project is the vendor's, not the site's)
  const vendors = new Set(db.prepare('SELECT LOWER(TRIM(name)) n FROM vendors').all().map(v => v.n));
  for (const m of db.prepare("SELECT type, item_id, qty, issued_to, to_location FROM stock_moves WHERE project_id = ? AND type IN ('OUTWARD', 'TRANSFER', 'RETURN')").all(p.id)) {
    if (!m.item_id || vendors.has(String((m.type === 'TRANSFER' ? m.to_location : m.issued_to) || '').trim().toLowerCase())) continue;
    if (m.type === 'RETURN') { if (!toDept(m.issued_to) || /site/i.test(m.issued_to || '')) row(m.item_id).returned = r3(row(m.item_id).returned + Number(m.qty || 0)); }
    else if (!toDept(m.type === 'TRANSFER' ? m.to_location : m.issued_to)) row(m.item_id).sent = r3(row(m.item_id).sent + Number(m.qty || 0));
  }
  // challans: spares, short / damaged on arrival, labels; and what still waits for the site's confirmation
  const challans = db.prepare("SELECT id, challan_no, date, status, lines, receipt, received_by, delivered_date, overrun_ok, vendor_id FROM challans WHERE project_id = ? AND status <> 'Cancelled' ORDER BY date DESC, id DESC").all(p.id);
  let unlabelled = 0;
  for (const c of challans) {
    const lines = parse(c.lines), rec = parse(c.receipt);
    lines.forEach((l, i) => {
      if (!l.item_id || !(Number(l.qty) > 0) || c.status === 'Draft') return;
      const x = row(Number(l.item_id));
      if (l.spare === 'Spare') x.spare = r3(x.spare + Number(l.qty));
      if (!String(l.pack || '').trim()) unlabelled++;
      const r = rec.find(z => Number(z.i) === i);
      if (r) { const gap = r3(Number(l.qty) - (Number(r.received) || 0)); if (gap > 0) x[r.condition === 'Damaged' ? 'damaged' : 'short'] = r3(x[r.condition === 'Damaged' ? 'damaged' : 'short'] + gap); }
    });
  }
  // installed / billed (office) and the supervisor's last count
  for (const r of db.prepare('SELECT item_id, qty, note, by_user, at FROM site_installed WHERE project_id = ?').all(p.id)) Object.assign(row(r.item_id), { installed: r.qty, installed_note: r.note, installed_by: r.by_user });
  const checks = db.prepare('SELECT id, date, kind, checked_by, lines FROM site_checks WHERE project_id = ? ORDER BY date DESC, id DESC').all(p.id);
  for (const c of [...checks].reverse()) for (const l of parse(c.lines)) {
    if (!l.item_id || l.at_site === '' || l.at_site == null) continue;
    Object.assign(row(Number(l.item_id)), { at_site: Number(l.at_site), counted_on: c.date });
  }
  const list = [...rows.values()].filter(x => x.sent || x.required || x.returned).map(x => {
    const it = items.get(x.item_id) || {};
    const pct = Number(allow[it.category]) || 0;
    const allowed = r3(Math.max(0, x.sent - x.spare) * pct / 100);
    const atSite = x.at_site ?? 0;
    // the supervisor answers for what arrived (sent − short / damaged in transit)
    const accountable = r3(x.sent - x.short - x.damaged);
    const unaccounted = x.installed == null ? null : r3(accountable - x.returned - x.installed - atSite - allowed);
    const overBoq = x.required ? r3(Math.max(0, x.sent - x.required * (1 + pct / 100))) : (x.sent && !x.required ? x.sent : 0);
    const usedPct = x.at_site != null && (x.required || x.sent) ? Math.round(100 * Math.max(0, accountable - x.returned - atSite) / (x.required || x.sent)) : null;
    const flags = [];
    if (!x.required && x.sent) flags.push('Not in the BOQ');
    else if (overBoq > 0) flags.push(`Above BOQ by ${overBoq}`);
    if (unaccounted != null && unaccounted > 0.0005) flags.push('Unaccounted');
    if (it.site_watch && usedPct != null && p.progress != null && usedPct > p.progress + 25) flags.push(`Used ${usedPct}% vs work done ${p.progress}%`);
    if (x.spare && x.installed != null && x.returned + 1e-9 < x.spare && unaccounted > 0) flags.push('Spares not back');
    return { ...x, code: it.code, name: it.name, uom: it.uom, category: it.category, watch: !!it.site_watch, allowance_pct: pct, allowed, accountable, unaccounted, over_boq: overBoq, used_pct: usedPct,
      rate: prices ? Number(it.rate) || 0 : null, unaccounted_value: prices && unaccounted > 0 ? Math.round(unaccounted * (Number(it.rate) || 0)) : null,
      sent_value: prices ? Math.round(x.sent * (Number(it.rate) || 0)) : null, flags };
  }).sort((a, b) => (b.watch - a.watch) || (b.flags.length - a.flags.length) || String(a.name).localeCompare(String(b.name)));
  const scrap = db.prepare("SELECT material, SUM(weight_kg) kg FROM scrap_register WHERE project_id = ? AND kind = 'Received from site' GROUP BY material ORDER BY material").all(p.id);
  const lastCheck = checks.find(c => c.kind !== 'Site closure count') || null;
  const closure = checks.find(c => c.kind === 'Site closure count') || null;
  const pending = challans.filter(c => c.status === 'Dispatched').length;
  const totals = {
    items: list.length, flagged: list.filter(r => r.flags.length).length, no_installed: list.filter(r => r.installed == null && r.sent).length,
    sent_value: prices ? list.reduce((s, r) => s + (r.sent_value || 0), 0) : null,
    unaccounted_value: prices ? list.reduce((s, r) => s + (r.unaccounted_value || 0), 0) : null,
    unaccounted_items: list.filter(r => r.unaccounted > 0.0005).length,
  };
  return { project: p, prices, head: isHead(user), supervisor: isSupervisor(p, user), can_act: mayAct(p, user), can_store: canWrite('scrap_register', user.role),
    has_boq: list.some(r => r.required), rows: list, challans: challans.map(c => ({ ...c, lines: parse(c.lines), receipt: parse(c.receipt) })), checks: checks.map(c => ({ ...c, lines: parse(c.lines) })),
    scrap, last_check: lastCheck, closure, pending_receipt: pending, unlabelled, allowances: allow,
    days_since_count: lastCheck ? Math.round((Date.parse(today()) - Date.parse(lastCheck.date)) / 864e5) : null, totals };
}

// All projects with material at site: the overview.
export function overview(user) {
  needView(user);
  const ids = db.prepare(`SELECT DISTINCT p.id FROM projects p WHERE COALESCE(p.status, '') <> 'Cancelled' AND (EXISTS (SELECT 1 FROM stock_moves m WHERE m.project_id = p.id AND m.type IN ('OUTWARD', 'TRANSFER'))
    OR EXISTS (SELECT 1 FROM challans c WHERE c.project_id = p.id AND c.status <> 'Cancelled') OR EXISTS (SELECT 1 FROM boms b WHERE b.project_id = p.id)) ORDER BY p.id DESC`).all();
  const rows = ids.map(({ id }) => {
    const r = reconcile(id, user);
    return { id, no: r.project.project_no || r.project.code, name: r.project.name, status: r.project.status, engineer: r.project.engineer, distance: r.project.site_distance, has_boq: r.has_boq,
      items: r.totals.items, flagged: r.totals.flagged, no_installed: r.totals.no_installed, sent_value: r.totals.sent_value, unaccounted_value: r.totals.unaccounted_value,
      pending_receipt: r.pending_receipt, days_since_count: r.days_since_count, closed: !!r.project.recon_head_sign };
  });
  return { rows, prices: hasFunction(user.role, 'see_stock_value') };
}

// Wastage per supervisor across projects (only items whose installed quantity is entered).
export function supervisors(user) {
  needView(user);
  const prices = hasFunction(user.role, 'see_stock_value');
  const by = new Map();
  for (const { id } of db.prepare("SELECT id FROM projects WHERE COALESCE(status, '') <> 'Cancelled'").all()) {
    const r = reconcile(id, user);
    const done = r.rows.filter(x => x.installed != null && x.sent);
    if (!done.length) continue;
    const name = r.project.engineer || '(no site engineer set)';
    const s = by.get(name) || { name, projects: 0, items: 0, sent_qty_value: 0, lost_value: 0, unaccounted_value: 0, pcts: [] };
    s.projects++; s.items += done.length;
    for (const x of done) {
      const rate = Number(x.rate) || 0;
      const lost = Math.max(0, x.accountable - x.returned - x.installed - (x.at_site ?? 0)); // wastage + unaccounted
      s.sent_qty_value += x.sent * rate; s.lost_value += lost * rate; s.unaccounted_value += Math.max(0, x.unaccounted || 0) * rate;
      if (x.sent) s.pcts.push(100 * lost / x.sent);
    }
    by.set(name, s);
  }
  const rows = [...by.values()].map(s => ({ name: s.name, projects: s.projects, items: s.items,
    wastage_pct: s.sent_qty_value ? Math.round(1000 * s.lost_value / s.sent_qty_value) / 10 : (s.pcts.length ? Math.round(10 * s.pcts.reduce((a, b) => a + b, 0) / s.pcts.length) / 10 : 0),
    unaccounted_value: prices ? Math.round(s.unaccounted_value) : null })).sort((a, b) => b.wastage_pct - a.wastage_pct);
  return { rows, prices };
}

// The site confirms a challan on arrival: received quantity per line, OK / Short / Damaged.
export function receive(challanId, body, user) {
  const ch = getRow('challans', challanId);
  if (!ch.project_id) throw new HttpError(400, 'This challan has no project');
  const p = project(ch.project_id);
  if (!mayAct(p, user)) throw new HttpError(403, `Only the site engineer of ${p.name} (or the Projects head) confirms what arrived`);
  if (ch.status !== 'Dispatched') throw new HttpError(409, ch.status === 'Delivered' ? 'This challan is already confirmed' : `This challan is ${ch.status}`);
  const lines = ch.lines || [];
  const rec = [];
  for (const r of body?.lines || []) {
    const i = Number(r.i), l = lines[i];
    if (!l) continue;
    const got = Number(r.received);
    if (!(got >= 0)) throw new HttpError(400, `Line ${i + 1}: enter the quantity received`);
    if (got > Number(l.qty) + 1e-9) throw new HttpError(400, `Line ${i + 1}: received ${got} is more than the challan's ${l.qty}`);
    const condition = got + 1e-9 < Number(l.qty) ? (r.condition === 'Damaged' ? 'Damaged' : 'Short') : (r.condition === 'Damaged' ? 'Damaged' : 'OK');
    if (condition !== 'OK' && !String(r.note || '').trim()) throw new HttpError(400, `Line ${i + 1}: say what is short or damaged`);
    rec.push({ i, received: got, condition, note: String(r.note || '').trim() || null });
  }
  if (rec.length !== lines.filter(l => Number(l.qty) > 0).length) throw new HttpError(400, 'Confirm every line of the challan');
  const by = String(body?.received_by || user.name).trim();
  const row = updateRow('challans', ch.id, { status: 'Delivered', receipt: JSON.stringify(rec), received_by: `${by} (confirmed in the CRM ${now()})`, delivered_date: body?.date || today() }, user, { system: true });
  const bad = rec.filter(r => r.condition !== 'OK');
  if (bad.length) notify({ fn: 'site_recon', userNames: db.prepare("SELECT name FROM users WHERE active = 1 AND role IN ('store', 'purchase_head')").all().map(u => u.name), kind: 'site',
    title: `${ch.challan_no}: ${bad.length} line${bad.length === 1 ? '' : 's'} short / damaged at ${p.name}`,
    body: bad.map(r => `${lines[r.i].description || ''}: ${r.condition} – got ${r.received} of ${lines[r.i].qty} (${r.note})`).join(' · '), link: `#/site-material/${p.id}?tab=challans` }, user);
  return row;
}

// The supervisor's count at site (weekly; a visit or video check by the Projects head; the closure count).
const KINDS = ['Weekly count', 'Visit check', 'Video check', 'Site closure count'];
export function addCheck(pid, body, user) {
  const p = project(pid);
  if (!mayAct(p, user)) throw new HttpError(403, `Only the site engineer of ${p.name} (or the Projects head) counts the site`);
  const kind = KINDS.includes(body?.kind) ? body.kind : 'Weekly count';
  const lines = (body?.lines || []).filter(l => l.item_id && l.at_site !== '' && l.at_site != null).map(l => ({ item_id: Number(l.item_id), uom: l.uom || null, used: l.used === '' || l.used == null ? null : Number(l.used), at_site: Number(l.at_site), note: l.note || null }));
  if (!lines.length) throw new HttpError(400, 'Enter what is at site for at least one item');
  if (lines.some(l => !(l.at_site >= 0))) throw new HttpError(400, 'Quantities at site cannot be negative');
  return insertRow('site_checks', { project_id: p.id, date: body.date || today(), kind, checked_by: body.checked_by || user.name, lines, remarks: body.remarks || null }, user, { system: true });
}
export function photo(entity, id, query, buf, user) {
  if (!['challans', 'site_checks'].includes(entity)) throw new HttpError(400, 'Not here');
  const r = getRow(entity, id);
  const p = project(r.project_id);
  if (!mayAct(p, user)) throw new HttpError(403, 'Only the site engineer or the Projects head adds site photos');
  if (!buf?.length) throw new HttpError(400, 'Choose a photo');
  return saveAttachment(entity, r.id, { filename: query.name || 'site photo.jpg', mime: query.type, note: query.note || 'Site photo' }, buf, user);
}

// Office: installed / billed quantity per item (from the client's measurement sheet), and the wastage allowance.
export function setInstalled(pid, body, user) {
  if (!isHead(user)) throw new HttpError(403, 'The installed / billed quantities are entered by the Projects head (Roles → “Site material reconciliation”)');
  const p = project(pid);
  if (p.recon_head_sign) throw new HttpError(409, 'The site is closed and signed; reopen it first');
  const up = db.prepare(`INSERT INTO site_installed (project_id, item_id, qty, note, by_user, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, item_id) DO UPDATE SET qty = excluded.qty, note = excluded.note, by_user = excluded.by_user, at = excluded.at`);
  const del = db.prepare('DELETE FROM site_installed WHERE project_id = ? AND item_id = ?');
  let n = 0;
  tx(() => { for (const l of body?.lines || []) {
    if (!l.item_id) continue;
    if (l.qty === '' || l.qty == null) { del.run(p.id, Number(l.item_id)); continue; }
    const q = Number(l.qty);
    if (!(q >= 0)) throw new HttpError(400, 'Installed quantities cannot be negative');
    up.run(p.id, Number(l.item_id), q, l.note || null, user.name, now()); n++;
  } });
  audit(user.name, 'projects', p.id, 'installed quantities', `${n} item(s)`);
  return reconcile(p.id, user);
}
export function setAllowances(body, user) {
  if (!isHead(user)) throw new HttpError(403, 'The wastage allowance is set by the Projects head');
  const out = {};
  for (const [k, v] of Object.entries(body?.allowances || {})) { if (v === '' || v == null) continue; const n = Number(v); if (!(n >= 0 && n <= 50)) throw new HttpError(400, `${k}: enter 0 to 50 %`); out[k] = n; }
  setSettings({ site_wastage: out });
  audit(user.name, 'settings', null, 'site wastage allowance', JSON.stringify(out));
  return { allowances: out };
}

// Site closure before handover: the supervisor signs, then the Projects head (all challans confirmed, a closure count,
// every installed quantity entered). Unaccounted material above the alert value goes to the MD / GM.
export function sign(pid, body, user) {
  const r = reconcile(pid, user);
  const p = r.project;
  const as = body?.as === 'head' ? 'head' : body?.as === 'reopen' ? 'reopen' : 'supervisor';
  if (as === 'reopen') {
    if (!isHead(user)) throw new HttpError(403, 'Only the Projects head reopens a closed site');
    db.prepare('UPDATE projects SET recon_head_sign = NULL, recon_supervisor_sign = NULL WHERE id = ?').run(p.id);
    audit(user.name, 'projects', p.id, 'site material reopened', body?.reason || '');
    return reconcile(p.id, user);
  }
  const problems = [];
  if (r.pending_receipt) problems.push(`${r.pending_receipt} challan(s) not yet confirmed at site`);
  if (!r.closure) problems.push('No site closure count yet (what is left at site when the work ends)');
  if (r.totals.no_installed) problems.push(`${r.totals.no_installed} item(s) without the installed / billed quantity`);
  const value = r.rows.reduce((s, x) => s + Math.max(0, x.unaccounted || 0) * (Number(db.prepare('SELECT rate FROM items WHERE id = ?').get(x.item_id)?.rate) || 0), 0);
  const note = String(body?.note || '').trim();
  if (as === 'supervisor') {
    if (!isSupervisor(p, user) && !isHead(user)) throw new HttpError(403, p.engineer ? `${p.engineer} (the site engineer) signs first` : 'Set the project\'s Site Engineer first');
    if (problems.length) throw new HttpError(409, `Not ready to sign:\n${problems.join('\n')}`);
    db.prepare('UPDATE projects SET recon_supervisor_sign = ? WHERE id = ?').run(`${user.name} (${now()})${note ? ': ' + note : ''}`, p.id);
  } else {
    if (!isHead(user)) throw new HttpError(403, 'The Projects head signs the closure');
    if (!p.recon_supervisor_sign) throw new HttpError(409, 'The site engineer signs first');
    if (problems.length) throw new HttpError(409, `Not ready to sign:\n${problems.join('\n')}`);
    const unacc = r.rows.filter(x => x.unaccounted > 0.0005);
    if (unacc.length && !note) throw new HttpError(400, `${unacc.length} item(s) are unaccounted: write what was decided (explained / written off / recovered)`);
    db.prepare('UPDATE projects SET recon_head_sign = ? WHERE id = ?').run(`${user.name} (${now()})${unacc.length ? ` · ${unacc.length} unaccounted item(s), ₹${Math.round(value)}` : ''}${note ? ': ' + note : ''}`, p.id);
    const alert = Number(getSettings().site_unaccounted_alert) || 0;
    if (unacc.length && value > alert) notify({ userNames: db.prepare("SELECT name FROM users WHERE active = 1 AND role IN ('md', 'manager')").all().map(u => u.name), kind: 'site',
      title: `${p.name}: site closed with ₹${Math.round(value).toLocaleString('en-IN')} unaccounted material`, body: `${unacc.length} item(s). ${note}`, link: `#/site-material/${p.id}` }, user);
  }
  audit(user.name, 'projects', p.id, `site material signed (${as})`, note);
  return reconcile(p.id, user);
}

// A project is handed over (Completed) only after its site material is closed, when material went to its site.
export function completionCheck(projectId, user) {
  if (!projectId) return;
  const p = db.prepare('SELECT recon_head_sign FROM projects WHERE id = ?').get(Number(projectId));
  if (!p || p.recon_head_sign) return;
  const sent = db.prepare("SELECT COUNT(*) n FROM challans WHERE project_id = ? AND status IN ('Dispatched', 'Delivered')").get(Number(projectId)).n;
  if (sent && !['admin'].includes(user?.role)) throw new HttpError(409, 'Close the site material first (Projects → Site Material → Closure): the site engineer and the Projects head sign the reconciliation before handover.');
}

// Dispatch rules for a challan going to a site: it names the project; more than the project's BOQ (plus the wastage
// allowance) needs the Projects head (or the "issue more" right) with a reason.
export function challanCheck(ch, lines, body, user) {
  if (!ch.project_id && !ch.vendor_id) throw new HttpError(400, 'Choose the project this material goes to (or the vendor, for job work). Material for a site is always counted against its project.');
  if (!ch.project_id) return null;
  const hasBoq = db.prepare("SELECT 1 FROM boms WHERE project_id = ? AND COALESCE(status, '') <> 'Cancelled'").get(ch.project_id);
  if (!hasBoq) return null;
  const allow = allowances();
  const want = new Map();
  for (const l of lines) if (l.item_id && !l.bom_item_id && !l.boq_item_id) want.set(Number(l.item_id), r3((want.get(Number(l.item_id)) || 0) + Number(l.qty)));
  if (!want.size) return null;
  const over = [];
  for (const [id, q] of want) {
    const it = db.prepare('SELECT code, name, uom, category FROM items WHERE id = ?').get(id) || {};
    const need = db.prepare(`SELECT COALESCE(SUM(bi.qty), 0) q FROM bom_items bi JOIN boms b ON b.id = bi.bom_id WHERE b.project_id = ? AND COALESCE(b.status, '') <> 'Cancelled' AND bi.item_id = ?`).get(ch.project_id, id).q;
    const sent = db.prepare(`SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE project_id = ? AND item_id = ? AND type IN ('OUTWARD', 'TRANSFER')`).get(ch.project_id, id).q
      - db.prepare(`SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE project_id = ? AND item_id = ? AND type = 'RETURN'`).get(ch.project_id, id).q;
    const limit = r3(need * (1 + (Number(allow[it.category]) || 0) / 100));
    if (sent + q > limit + 1e-9) over.push(`${it.code || ''} ${it.name || id}: ${need ? `BOQ ${r3(need)}${limit > need ? ` (+ allowance = ${limit})` : ''}` : 'not in the BOQ'}, already at site ${r3(sent)}, this challan ${q} ${it.uom || ''}`);
  }
  if (!over.length) return null;
  const ok = hasFunction(user.role, 'site_recon') || hasFunction(user.role, 'allow_negative');
  const reason = String(body?.overrun_reason || '').trim();
  if (!body?.force || !ok || !reason) {
    throw Object.assign(new HttpError(409, `More than the project's BOQ:\n${over.join('\n')}\n${ok ? 'Give the reason to send it anyway.' : 'The Projects head approves material above the BOQ.'}`), { code: 'OVER_BOQ', canOverride: ok });
  }
  return `${user.name} (${now()}): ${reason} — ${over.join('; ')}`.slice(0, 1500);
}

// Scrap yard: received by weight (from sites / the factory) − sold.
export function scrapYard(user) {
  if (!canView('scrap_register', user.role)) throw new HttpError(403, 'No access to the scrap register');
  const rows = db.prepare(`SELECT material, SUM(CASE WHEN kind = 'Sold' THEN 0 ELSE weight_kg END) received, SUM(CASE WHEN kind = 'Sold' THEN weight_kg ELSE 0 END) sold,
      SUM(CASE WHEN kind = 'Sold' THEN COALESCE(amount, 0) ELSE 0 END) sold_value FROM scrap_register GROUP BY material ORDER BY material`).all()
    .map(r => ({ ...r, received: r3(r.received), sold: r3(r.sold), in_yard: r3(r.received - r.sold), sold_value: Math.round(r.sold_value || 0) }));
  const byProject = db.prepare(`SELECT p.id, COALESCE(NULLIF(p.project_no, ''), p.code) no, p.name, s.material, SUM(s.weight_kg) kg FROM scrap_register s JOIN projects p ON p.id = s.project_id
    WHERE s.kind = 'Received from site' GROUP BY p.id, s.material ORDER BY p.id DESC`).all();
  return { rows, by_project: byProject };
}
