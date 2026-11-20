// Company policies (Admin → Company Policies): the admin keeps each policy (text + the PDF attached to it), sends it
// to everyone or to chosen roles, each person reads it on "📜 Company Policies" and confirms "I have read it", and
// the admin sees who has and has not read it.
import { db, audit } from './db.js';
import { getRow, updateRow, insertRow, HttpError } from './crud.js';
import { canWrite } from '../public/js/schema.js';
import { notify } from './notify.js';
import { listAttachments } from './roles.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const rolesOf = p => (!p.sent_to || p.sent_to === 'Everyone' ? null : String(p.sent_to).split(',').map(x => x.trim()).filter(Boolean));
// Whether a sent policy is for this role (the admin sees every policy).
export const forRole = (p, role) => role === 'admin' || (p.status === 'Sent' && (!rolesOf(p) || rolesOf(p).includes(role)));
const audience = p => db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all().filter(u => u.role !== 'admin' && (!rolesOf(p) || rolesOf(p).includes(u.role)));
const mayManage = user => user.role === 'admin' || canWrite('company_policies', user.role);

export function send(id, body, user) {
  if (!mayManage(user)) throw new HttpError(403, 'Only the administrator sends company policies');
  const p = getRow('company_policies', id);
  const roles = Array.isArray(body?.roles) ? body.roles.filter(Boolean) : [];
  const sentTo = roles.length ? roles.join(',') : 'Everyone';
  const out = updateRow('company_policies', p.id, { status: 'Sent', sent_to: sentTo, sent_at: stamp(), sent_by: user.name }, user, { system: true });
  const people = audience(out);
  const n = notify({ userNames: people.map(u => u.name), kind: 'policy', title: `📜 Company policy: ${p.title}${p.version ? ` (${p.version})` : ''}`,
    body: `${String(p.summary || '').slice(0, 200)} · please read it and press “I have read it”`, link: '#/policies' }, user);
  audit(user.name, 'company_policies', p.id, 'sent', `${sentTo} · ${n} people`);
  return { ...out, told: n };
}

// The policies sent to me, newest first, with their files and whether I have read them.
export function mine(user) {
  const rows = db.prepare("SELECT * FROM company_policies WHERE status = 'Sent' ORDER BY COALESCE(sent_at, '') DESC, id DESC").all().filter(p => forRole(p, user.role));
  const read = new Map(db.prepare('SELECT policy_id, read_at FROM policy_reads WHERE user_name = ?').all(user.name).map(r => [r.policy_id, r.read_at]));
  const manage = mayManage(user);
  return {
    manage,
    policies: rows.map(p => {
      const out = { ...p, files: listAttachments('company_policies', p.id), read_at: read.get(p.id) || null };
      if (manage) {
        const people = audience(p), got = new Set(db.prepare('SELECT user_name FROM policy_reads WHERE policy_id = ?').all(p.id).map(r => r.user_name));
        out.readers = { total: people.length, read: people.filter(u => got.has(u.name)).length, pending: people.filter(u => !got.has(u.name)).map(u => u.name) };
      }
      return out;
    }),
  };
}

export function markRead(id, user) {
  const p = getRow('company_policies', id);
  if (!forRole(p, user.role)) throw new HttpError(403, 'This policy was not sent to you');
  if (!db.prepare('SELECT 1 FROM policy_reads WHERE policy_id = ? AND user_name = ?').get(p.id, user.name)) {
    insertRow('policy_reads', { policy_id: p.id, user_name: user.name, role: user.role, read_at: stamp() }, user, { system: true });
  }
  return { ok: true, read_at: stamp() };
}

// Who has read one policy and who has not (admin).
export function readers(id, user) {
  if (!mayManage(user)) throw new HttpError(403, 'Only the administrator sees who has read a policy');
  const p = getRow('company_policies', id);
  const got = new Map(db.prepare('SELECT user_name, read_at FROM policy_reads WHERE policy_id = ?').all(p.id).map(r => [r.user_name, r.read_at]));
  return audience(p).map(u => ({ name: u.name, role: u.role, read_at: got.get(u.name) || null }));
}
