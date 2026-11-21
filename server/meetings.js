// Meetings: the heads' meeting after a purchase order is published (and any other meeting). Scheduled from the sales order, minutes typed
// in the meeting record, then "Hold" saves them, marks who came, and sends them to everyone invited.
import { db, audit } from './db.js';
import { HttpError, insertRow, updateRow, getRow } from './crud.js';
import { notify } from './notify.js';
import { MANDATORY_HEADS, OPTIONAL_HEADS } from './orderdocs.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const parse = (v, d) => { try { const x = typeof v === 'string' ? JSON.parse(v) : v; return x ?? d; } catch { return d; } };
const LABEL = Object.fromEntries([...MANDATORY_HEADS, ...OPTIONAL_HEADS]);
const names = m => parse(m.attendees, []).map(a => a.name).filter(Boolean);

export function scheduleForOrder(soId, body, user) {
  const so = getRow('sales_orders', soId);
  if (!so.published_at) throw new HttpError(409, "Publish the purchase order first (Accounts & Finance: Accept & Publish), then schedule the heads' meeting");
  const date = String(body?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose the date of the meeting');
  const optional = (Array.isArray(body?.optional) ? body.optional : []).filter(r => OPTIONAL_HEADS.some(([k]) => k === r));
  const wanted = [...MANDATORY_HEADS.map(([k]) => [k, 'Mandatory']), ...optional.map(k => [k, 'Optional'])];
  const users = db.prepare(`SELECT name, role FROM users WHERE active = 1 AND role IN (${wanted.map(() => '?').join(',')}) ORDER BY name`).all(...wanted.map(([k]) => k));
  const attendees = wanted.flatMap(([role, need]) => users.filter(u => u.role === role).map(u => ({ name: u.name, post: LABEL[role], need, attended: '' })));
  const missing = MANDATORY_HEADS.filter(([k]) => !users.some(u => u.role === k)).map(([, l]) => l);
  const cust = so.customer_id ? db.prepare('SELECT name FROM customers WHERE id = ?').get(so.customer_id)?.name : '';
  const m = insertRow('meetings', { title: `Heads' meeting: ${cust || so.so_no}`, kind: "Heads' meeting (new order)", date, time: String(body?.time || '').slice(0, 20) || null, venue: String(body?.venue || '').slice(0, 200) || null,
    sales_order_id: so.id, enquiry_id: so.enquiry_id || null, attendees, status: 'Scheduled', scheduled_by: user.name }, user, { system: true });
  const n = notify({ userNames: attendees.map(a => a.name), kind: 'meeting', title: `Meeting on ${date}${m.time ? ' at ' + m.time : ''}: ${m.title}`, body: `${m.venue ? m.venue + ' · ' : ''}Order ${so.so_no}. Agenda is in the meeting record.`, link: `#/view/meetings/${m.id}` }, user);
  audit(user.name, 'meetings', m.id, 'schedule', `${attendees.length} invited`);
  return { id: m.id, invited: attendees.length, notified: n, missing_heads: missing };
}

export function hold(id, body, user) {
  const m = getRow('meetings', id);
  if (m.status === 'Held') throw new HttpError(409, 'The minutes are already saved');
  if (m.status === 'Cancelled') throw new HttpError(409, 'This meeting was cancelled');
  if (!String(m.minutes || '').trim()) throw new HttpError(409, 'Type the minutes of the meeting first, and save the meeting');
  const came = new Set(Array.isArray(body?.attended) ? body.attended : []);
  const attendees = parse(m.attendees, []).map(a => ({ ...a, attended: came.has(a.name) ? 'Yes' : 'No' }));
  updateRow('meetings', id, { attendees, status: 'Held', held_at: stamp(), minutes_by: user.name }, user, { system: true });
  const open = parse(m.decisions, []).filter(d => String(d.action || '').trim()).length;
  const n = notify({ userNames: attendees.map(a => a.name), kind: 'meeting', title: `Minutes saved: ${m.title}`, body: `${open} action point(s). Open the meeting to read the minutes.`, link: `#/view/meetings/${m.id}` }, user);
  audit(user.name, 'meetings', Number(id), 'minutes', `${came.size} of ${attendees.length} came`);
  return { notified: n, came: came.size, invited: attendees.length };
}

export function cancel(id, user) {
  const m = getRow('meetings', id);
  if (m.status !== 'Scheduled') throw new HttpError(409, `This meeting is ${m.status}`);
  updateRow('meetings', id, { status: 'Cancelled' }, user, { system: true });
  notify({ userNames: names(m), kind: 'meeting', title: `Meeting cancelled: ${m.title}`, body: `It was planned for ${m.date}.`, link: `#/view/meetings/${m.id}` }, user);
  audit(user.name, 'meetings', Number(id), 'cancel', m.title);
  return { cancelled: true };
}
