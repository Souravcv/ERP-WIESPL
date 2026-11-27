// Challan check (owner, 27 Nov 2026): after a delivery challan is posted, the person the store assigns checks the
// material against the challan (right item, right quantity, not damaged) before it goes. The store chooses the checker
// on the challan; the last one chosen is the default for the next. A problem goes back to the store.
import { db, getSettings, setSettings, audit } from './db.js';
import { HttpError, getRow, updateRow } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { notify } from './notify.js';

const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const isStore = user => hasFunction(user.role, 'stock_post');

// Called when a challan is saved (server/hooks.js): a challan that has just been posted waits for its check.
export function markToCheck(row, existing) {
  const status = row.status ?? existing?.status;
  if (status !== 'Dispatched' || existing?.status === 'Dispatched' || (row.check_status ?? existing?.check_status)) return null;
  row.check_status = 'To check';
  if (!(row.checker ?? existing?.checker)) row.checker = getSettings().challan_checker || null;
  return row.checker ?? existing?.checker ?? null;
}
export function tellChecker(ch, actor) {
  if (!ch || ch.check_status !== 'To check') return 0;
  const to = ch.checker ? [ch.checker] : db.prepare("SELECT name FROM users WHERE active = 1").all().map(u => u.name).filter(n => {
    const u = db.prepare('SELECT role FROM users WHERE name = ? AND active = 1').get(n); return u && isStore(u) && !['admin'].includes(u.role);
  });
  return notify({ userNames: to, kind: 'challan', title: ch.checker ? `Check the material: challan ${ch.challan_no}` : `Challan ${ch.challan_no} posted: choose who checks the material`,
    body: [ch.project_id_label, `${(ch.lines || []).filter(l => Number(l.qty) > 0).length} line(s)`].filter(Boolean).join(' · '), link: `#/view/challans/${ch.id}` }, actor);
}

// The store chooses (or changes) who checks; remembered as the default for the next challans.
export function assignChecker(id, body, user) {
  if (!isStore(user)) throw new HttpError(403, 'The store chooses who checks the challan');
  const ch = getRow('challans', id);
  const who = String(body?.checker || '').trim();
  if (!who || !db.prepare('SELECT 1 FROM users WHERE name = ? AND active = 1').get(who)) throw new HttpError(400, 'Choose a person');
  const out = updateRow('challans', ch.id, { checker: who, check_status: ch.check_status && ch.check_status !== 'Checked – OK' ? ch.check_status : (ch.status === 'Dispatched' || ch.status === 'Delivered' ? 'To check' : ch.check_status) }, user, { system: true });
  setSettings({ challan_checker: who });
  audit(user.name, 'challans', ch.id, 'checker', who);
  tellChecker(out, user);
  return out;
}

// The check: every line OK / short / wrong item / damaged, with a note; any problem goes back to the store.
const RESULTS = ['OK', 'Short', 'Wrong item', 'Damaged'];
export function checkChallan(id, body, user) {
  const ch = getRow('challans', id);
  if (ch.checker !== user.name && !isStore(user)) throw new HttpError(403, ch.checker ? `${ch.checker} checks this challan (or the store)` : 'The store chooses who checks this challan first');
  if (!['Dispatched', 'Delivered'].includes(ch.status)) throw new HttpError(409, 'Only a posted challan is checked');
  const lines = (ch.lines || []);
  const out = [];
  for (const l of body?.lines || []) {
    const i = Number(l.i);
    if (!lines[i]) continue;
    const result = RESULTS.includes(l.result) ? l.result : 'OK';
    if (result !== 'OK' && !String(l.note || '').trim()) throw new HttpError(400, `Line ${i + 1}: say what is wrong`);
    out.push({ i, result, note: String(l.note || '').trim() || null });
  }
  if (out.length !== lines.filter(l => Number(l.qty) > 0).length) throw new HttpError(400, 'Check every line of the challan');
  const bad = out.filter(x => x.result !== 'OK');
  const row = updateRow('challans', ch.id, { check_status: bad.length ? 'Checked – problem' : 'Checked – OK', check_lines: JSON.stringify(out), checked_by: `${user.name} (${now()})`,
    check_notes: String(body?.notes || '').trim() || null }, user, { system: true });
  audit(user.name, 'challans', ch.id, 'material checked', bad.length ? `${bad.length} problem(s)` : 'OK');
  if (bad.length) notify({ fn: 'stock_post', kind: 'challan', title: `Challan ${ch.challan_no}: ${bad.length} line(s) not right`,
    body: bad.map(x => `${lines[x.i].description || ''}: ${x.result} – ${x.note}`).join(' · ').slice(0, 480), link: `#/view/challans/${ch.id}` }, user);
  return row;
}

// My tasks: the challans waiting for my check (the store also sees the ones nobody is assigned to).
export function myChallanChecks(user) {
  const rows = db.prepare("SELECT id, challan_no, date, checker, project_id FROM challans WHERE check_status = 'To check' AND status IN ('Dispatched', 'Delivered') ORDER BY date, id").all();
  const proj = id => (id ? db.prepare("SELECT COALESCE(NULLIF(project_no, ''), code) || ' ' || name n FROM projects WHERE id = ?").get(id)?.n : '') || '';
  return rows.filter(r => r.checker === user.name || (!r.checker && isStore(user)))
    .map(r => ({ title: r.checker ? `Check the material of challan ${r.challan_no}` : `Challan ${r.challan_no}: choose who checks it`, sub: [proj(r.project_id), r.date].filter(Boolean).join(' · '), link: `#/view/challans/${r.id}` }));
}
