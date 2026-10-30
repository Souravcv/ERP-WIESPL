// Enquiry Register: W/EQ/26-27/0001 numbers, the fields the CRM must have, and the one-time moves of old enquiries (owner's change list,
// 29 Oct 2026). No approval step: an enquiry is saved and used as it is.
import { db, tx } from './db.js';
import { toList, HttpError } from './crud.js';
import { ENTITIES } from '../public/js/schema.js';
import { fyOf } from '../public/js/calc.js';

// W/EQ/26-27/0001: a running number per financial year, never used twice (a deleted enquiry's number is not given again).
export const enquiryNo = (fy, seq) => `W/EQ/${fy}/${String(seq).padStart(4, '0')}`;
export function nextEnquiryNo(date) {
  const fy = fyOf(date);
  const taken = db.prepare('SELECT 1 FROM enquiries WHERE enquiry_no = ?');
  let seq = db.prepare("SELECT seq FROM counters WHERE name = 'enquiry_no' AND fy = ?").get(fy)?.seq || 0;
  let no;
  do { seq++; no = enquiryNo(fy, seq); } while (taken.get(no));
  db.prepare("INSERT INTO counters (name, fy, seq) VALUES ('enquiry_no', ?, ?) ON CONFLICT(name, fy) DO UPDATE SET seq = excluded.seq").run(fy, seq);
  return no;
}

// Fields that must be filled when an enquiry is saved from the CRM (website enquiries and Excel imports may lack them).
export function checkMandatory(body, existing = {}) {
  const missing = ENTITIES.enquiries.fields.filter(f => f.mandatory && f.type !== 'lines')
    .filter(f => { const v = f.key in body ? body[f.key] : existing[f.key]; return v == null || String(v).trim() === ''; }).map(f => f.label);
  if (missing.length) throw new HttpError(400, `Fill in these fields: ${missing.join(', ')}.`);
  let acts = 'actions' in body ? body.actions : existing.actions;
  if (typeof acts === 'string') { try { acts = JSON.parse(acts); } catch { acts = []; } }
  acts = (Array.isArray(acts) ? acts : []).filter(a => Object.values(a || {}).some(v => String(v ?? '').trim() && v !== 'Open'));
  if (!acts.length) throw new HttpError(400, 'Required Actions: add at least one action.');
  const bad = acts.findIndex(a => !String(a.action || '').trim() || !String(a.owner || '').trim() || !a.due);
  if (bad >= 0) throw new HttpError(400, `Required Actions, row ${bad + 1}: fill in the action, the owner and the due date.`);
}

// Once: ENQ-0001 numbers (29 Oct 2026) → W/EQ/26-27/0001 (same number, the FY of the enquiry date).
function renumberEnq() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'enquiry_no_weq_v1'").get()) return;
  tx(() => {
    const rows = db.prepare("SELECT id, date, enquiry_no FROM enquiries WHERE enquiry_no GLOB 'ENQ-[0-9]*'").all();
    const upd = db.prepare('UPDATE enquiries SET enquiry_no = ? WHERE id = ?');
    const top = {};
    for (const r of rows) {
      const fy = fyOf(r.date), n = Number(r.enquiry_no.slice(4));
      upd.run(enquiryNo(fy, n), r.id);
      top[fy] = Math.max(top[fy] || 0, n);
    }
    // carry the old running number on, so no W/EQ number is used twice
    const old = db.prepare("SELECT seq FROM counters WHERE name = 'enquiry_no' AND fy = 'all'").get()?.seq || 0;
    const cur = fyOf();
    top[cur] = Math.max(top[cur] || 0, old);
    for (const [fy, n] of Object.entries(top)) db.prepare("INSERT INTO counters (name, fy, seq) VALUES ('enquiry_no', ?, ?) ON CONFLICT(name, fy) DO UPDATE SET seq = MAX(seq, excluded.seq)").run(fy, n);
    db.prepare("INSERT INTO settings (key, value) VALUES ('enquiry_no_weq_v1', '\"1\"')").run();
    if (rows.length) console.log(`  Enquiry numbers: ${rows.length} ENQ-… changed to W/EQ/…`);
  });
}

// Once: old enquiries into the new form. Doctor's name / phone → Client Name / Phone, District into City / Place,
// one Type of Work text → a list, and the two "send to client" actions. The old columns (doctor_*, district,
// verified_*) stay in the table, out of the form.
export function setupEnquiries() {
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_enquiries_no ON enquiries (enquiry_no)'); } catch (e) { console.error('Enquiry numbers are not unique:', e.message); }
  renumberEnq();
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
