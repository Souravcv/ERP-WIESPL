// Enquiry Register: ENQ-0001 numbers, maker-checker review and the one-time move of old enquiries to the new form
// (owner's change list, 29 Oct 2026).
// Review: Draft → Submitted (maker) → Approved / Rejected with a reason (checker, never the maker) → Resubmitted → …
// An approved enquiry is read-only (PUT / DELETE refused in index.js) until a checker reopens it (back to Draft).
import { db, tx, audit } from './db.js';
import { getRow, updateRow, HttpError, toList } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { notify } from './notify.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
export const CHECK_FN = 'enquiry_check';

// One running number for all years, never used twice (a deleted enquiry's number is not given again).
export function nextEnquiryNo() {
  const taken = db.prepare('SELECT 1 FROM enquiries WHERE enquiry_no = ?');
  let seq = db.prepare("SELECT seq FROM counters WHERE name = 'enquiry_no' AND fy = 'all'").get()?.seq || 0;
  let no;
  do { seq++; no = `ENQ-${String(seq).padStart(4, '0')}`; } while (taken.get(no));
  db.prepare("INSERT INTO counters (name, fy, seq) VALUES ('enquiry_no', 'all', ?) ON CONFLICT(name, fy) DO UPDATE SET seq = excluded.seq").run(seq);
  return no;
}

const SUBMIT_NEEDS = [['hospital_name', 'Hospital Name'], ['client_name', 'Client Name'], ['enquiry_by', 'Salesperson'], ['type_of_work', 'Type of Work']];
const filled = v => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');

export function reviewEnquiry(id, action, body = {}, user) {
  const e = getRow('enquiries', id);
  const st = e.review_status || 'Draft';
  const isChecker = hasFunction(user.role, CHECK_FN);
  const note = String(body.reason || body.note || '').trim();
  const log = (what, patch, text) => {
    const entry = { at: stamp(), by: user.name, action: what, ...(text ? { note: text } : {}) };
    const out = updateRow('enquiries', id, { ...patch, review_log: [...(Array.isArray(e.review_log) ? e.review_log : []), entry] }, user, { system: true });
    audit(user.name, 'enquiries', Number(id), `review: ${what}`, text || '');
    return out;
  };
  const ref = `${e.enquiry_no || '#' + e.id}${e.hospital_name ? ' – ' + e.hospital_name : ''}`;
  return tx(() => {
    switch (action) {
      case 'submit': {
        if (!['Draft', 'Rejected'].includes(st)) throw new HttpError(400, `You cannot submit this enquiry. Its review status is ${st}.`);
        const missing = SUBMIT_NEEDS.filter(([k]) => !filled(e[k])).map(([, label]) => label);
        if (missing.length) throw new HttpError(400, `Before you submit, fill in these fields: ${missing.join(', ')}.`);
        const next = st === 'Rejected' ? 'Resubmitted' : 'Submitted';
        const out = log(next, { review_status: next, submitted_by: user.name, approved_by: null }, note);
        notify({ fn: CHECK_FN, kind: 'enquiries', title: `Enquiry to check: ${ref}`, body: `${next} by ${user.name}`, link: `#/view/enquiries/${e.id}` }, user);
        return out;
      }
      case 'approve': case 'reject': {
        if (!isChecker) throw new HttpError(403, 'Only a checker can approve or reject an enquiry.');
        if (!['Submitted', 'Resubmitted'].includes(st)) throw new HttpError(400, `This enquiry is not waiting for a check. Its review status is ${st}.`);
        // Maker-checker: the person who made or submitted the enquiry cannot check it.
        if ([e.submitted_by, e.created_by].includes(user.name)) throw new HttpError(403, 'You made or submitted this enquiry. A different user must check it.');
        if (action === 'reject' && !note) throw new HttpError(400, 'Write the reason for the rejection.');
        const out = action === 'approve'
          ? log('Approved', { review_status: 'Approved', approved_by: `${user.name} (${stamp()})`, reject_reason: null }, note)
          : log('Rejected', { review_status: 'Rejected', approved_by: null, reject_reason: note }, note);
        if (e.submitted_by) notify({ userNames: [e.submitted_by], kind: 'decision', title: `Enquiry ${action === 'approve' ? 'approved' : 'rejected'}: ${ref}`, body: `by ${user.name}${note ? ' · ' + note : ''}`, link: `#/view/enquiries/${e.id}` }, user);
        return out;
      }
      case 'reopen': {
        if (!isChecker) throw new HttpError(403, 'Only a checker can reopen an approved enquiry.');
        if (st !== 'Approved') throw new HttpError(400, 'Only an approved enquiry can be reopened.');
        return log('Reopened', { review_status: 'Draft', approved_by: null }, note);
      }
      default: throw new HttpError(400, 'Unknown review action');
    }
  });
}

// Approved = read-only for everyone until a checker reopens it.
export function assertEditable(id) {
  const st = db.prepare('SELECT review_status FROM enquiries WHERE id = ?').get(Number(id))?.review_status;
  if (st === 'Approved') throw new HttpError(409, 'This enquiry is approved. It is read-only. A checker must reopen it before you can change it.');
}

// Once: old enquiries into the new form. Doctor's name / phone → Client Name / Phone, District into City / Place,
// one Type of Work text → a list, old "Verified by" into the review history, the two "send to client" actions,
// and the checker right for the General Manager.
export function setupEnquiries() {
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_enquiries_no ON enquiries (enquiry_no)'); } catch (e) { console.error('Enquiry numbers are not unique:', e.message); }
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'enquiry_form_v1'").get()) return;
  const defaultActions = JSON.stringify([{ action: 'Send to client by Email', owner: '', due: '', status: 'Open' }, { action: 'Send to client by WhatsApp', owner: '', due: '', status: 'Open' }]);
  const upd = db.prepare(`UPDATE enquiries SET client_name = ?, client_phone = ?, place = ?, type_of_work = ?, review_status = ?, review_log = ?, actions = ? WHERE id = ?`);
  tx(() => {
    for (const e of db.prepare('SELECT * FROM enquiries').all()) {
      const place = [e.place, e.district].map(x => String(x ?? '').trim()).filter(Boolean)
        .filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ') || null;
      const works = toList(e.type_of_work);
      let log = []; try { log = JSON.parse(e.review_log || '[]'); } catch { /* none */ }
      if (e.verified_by || e.verified_date) log.unshift({ at: e.verified_date || '', by: e.verified_by || '', action: 'Verified (old field)' });
      upd.run(e.client_name ?? e.doctor_name ?? null, e.client_phone ?? e.doctor_phone ?? null, place, works.length ? JSON.stringify(works) : null,
        e.review_status || 'Draft', log.length ? JSON.stringify(log) : null, e.actions && e.actions !== '[]' ? e.actions : defaultActions, e.id);
    }
    const r = db.prepare("SELECT perms FROM roles WHERE name = 'manager'").get();
    if (r) {
      let p = {}; try { p = JSON.parse(r.perms || '{}'); } catch { /* default */ }
      p.functions = [...new Set([...(p.functions || []), CHECK_FN])];
      db.prepare("UPDATE roles SET perms = ? WHERE name = 'manager'").run(JSON.stringify(p));
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('enquiry_form_v1', '\"1\"')").run();
  });
}
