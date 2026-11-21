// Enquiry handover (management discussion, Nov 2026): Marketing saves, then presses "Submit to Sales"; Sales contacts the client
// within 24 hours and records it (a tick with the mode: call, email, WhatsApp or visit; no call recording, for client privacy).
import { db, audit } from './db.js';
import { HttpError } from './crud.js';
import { checkMandatory } from './enquiries.js';
import { notify } from './notify.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
export const CONTACT_MODES = ['Call', 'Email', 'WhatsApp', 'Visit', 'Other'];
const get = id => { const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(Number(id)); if (!e) throw new HttpError(404, 'Enquiry not found'); return e; };
const hours = (from, to = stamp()) => Math.round((Date.parse(to.replace(' ', 'T')) - Date.parse(String(from).replace(' ', 'T'))) / 36e5);

export function submitToSales(id, user) {
  const e = get(id);
  if (e.submitted_at) throw new HttpError(409, `Already submitted to Sales on ${e.submitted_at}.`);
  checkMandatory({}, e); // the enquiry must be complete before it goes on
  const at = stamp();
  db.prepare('UPDATE enquiries SET submitted_at = ?, submitted_by = ? WHERE id = ?').run(at, user.name, e.id);
  audit(user.name, 'enquiries', e.id, 'submit', 'Submitted to Sales');
  const n = notify({ fn: 'notify_enquiry', kind: 'enquiry', title: `Enquiry ${e.enquiry_no || e.id} submitted to Sales`,
    body: `${e.hospital_name || e.client_name || ''}${e.place ? ', ' + e.place : ''}. Contact the client within 24 hours.`, link: `#/view/enquiries/${e.id}` }, user);
  return { submitted_at: at, notified: n };
}

export function recordContact(id, body, user) {
  const e = get(id);
  const mode = CONTACT_MODES.includes(body?.mode) ? body.mode : null;
  if (!mode) throw new HttpError(400, `Choose how the client was contacted: ${CONTACT_MODES.join(', ')}.`);
  const note = String(body.note || '').slice(0, 300);
  if (e.contact_at && !body.again) throw new HttpError(409, `The client was already contacted on ${e.contact_at}.`);
  const at = stamp();
  db.prepare('UPDATE enquiries SET contact_at = ?, contact_mode = ?, contact_by = ?, contact_note = ? WHERE id = ?').run(at, mode, user.name, note || null, e.id);
  audit(user.name, 'enquiries', e.id, 'contact', `${mode}${note ? ': ' + note : ''}`);
  const h = e.submitted_at ? hours(e.submitted_at, at) : null;
  return { contact_at: at, hours: h, late: h != null && h > 24 };
}

// Enquiries submitted to Sales and not yet contacted: for the alert on the dashboard and the daily reminder
export function waitingForContact() {
  return db.prepare("SELECT id, enquiry_no, hospital_name, client_name, submitted_at FROM enquiries WHERE submitted_at IS NOT NULL AND contact_at IS NULL ORDER BY submitted_at")
    .all().map(e => ({ ...e, hours: hours(e.submitted_at), late: hours(e.submitted_at) > 24 }));
}
