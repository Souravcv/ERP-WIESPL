// Enquiry Register: ENQ-0001 numbers and the one-time move of old enquiries to the new form (owner's change list,
// 29 Oct 2026). No approval step: an enquiry is saved and used as it is.
import { db, tx } from './db.js';
import { toList } from './crud.js';

// One running number for all years, never used twice (a deleted enquiry's number is not given again).
export function nextEnquiryNo() {
  const taken = db.prepare('SELECT 1 FROM enquiries WHERE enquiry_no = ?');
  let seq = db.prepare("SELECT seq FROM counters WHERE name = 'enquiry_no' AND fy = 'all'").get()?.seq || 0;
  let no;
  do { seq++; no = `ENQ-${String(seq).padStart(4, '0')}`; } while (taken.get(no));
  db.prepare("INSERT INTO counters (name, fy, seq) VALUES ('enquiry_no', 'all', ?) ON CONFLICT(name, fy) DO UPDATE SET seq = excluded.seq").run(seq);
  return no;
}

// Once: old enquiries into the new form. Doctor's name / phone → Client Name / Phone, District into City / Place,
// one Type of Work text → a list, and the two "send to client" actions. The old columns (doctor_*, district,
// verified_*) stay in the table, out of the form.
export function setupEnquiries() {
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_enquiries_no ON enquiries (enquiry_no)'); } catch (e) { console.error('Enquiry numbers are not unique:', e.message); }
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'enquiry_form_v1'").get()) return;
  const defaultActions = JSON.stringify([{ action: 'Send to client by Email', owner: '', due: '', status: 'Open' }, { action: 'Send to client by WhatsApp', owner: '', due: '', status: 'Open' }]);
  const upd = db.prepare('UPDATE enquiries SET client_name = ?, client_phone = ?, place = ?, type_of_work = ?, actions = ? WHERE id = ?');
  tx(() => {
    for (const e of db.prepare('SELECT * FROM enquiries').all()) {
      const place = [e.place, e.district].map(x => String(x ?? '').trim()).filter(Boolean)
        .filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ') || null;
      const works = toList(e.type_of_work);
      upd.run(e.client_name ?? e.doctor_name ?? null, e.client_phone ?? e.doctor_phone ?? null, place, works.length ? JSON.stringify(works) : null,
        e.actions && e.actions !== '[]' ? e.actions : defaultActions, e.id);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('enquiry_form_v1', '\"1\"')").run();
  });
}
