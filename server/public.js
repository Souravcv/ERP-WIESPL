// Client-facing enquiry form (no login): progress is saved as the visitor goes, and on submit an
// enquiry is created in the Enquiry Register with a lead score, and sales get a pop-up.
import crypto from 'node:crypto';
import express from 'express';
import { db, getSettings } from './db.js';
import { insertRow, HttpError } from './crud.js';
import { saveAttachment } from './roles.js';
import { notify } from './notify.js';
import { briefText, cleanBrief, newRoom, SPECIALTIES } from '../public/js/brief-fields.js';
import { VIDEOS } from '../public/js/explainers.js';
import { publicPhotos, photoFile } from './photos.js';

const SPEC_OK = SPECIALTIES.filter(s => s !== 'Other');
const OPTS = {
  door_type: ['sliding', 'swing', 'autoswing'], door_size: ['1200', '1500', '1800'], floor_type: ['conductive', 'homogeneous'],
  surgeon_arms: [1, 2], anaes_arms: [1, 2], light_domes: [1, 2, 3], light_camera: ['yes', 'no'], laf_size: ['4 × 6 ft', '4 × 8 ft', '6 × 8 ft', '8 × 10 ft', '10 × 10 ft'],
  xray_plates: [2, 3], storage_count: [1, 2], passbox_count: [1, 2, 3, 4], scrub_bays: [1, 2, 3], scrub_tap: ['sensor', 'foot', 'elbow'],
  passage_finish: ['wood', 'ss', 'ppgi', 'glass'], passage_colour: null,
};
const cleanOpts = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => k in OPTS && (OPTS[k] ? OPTS[k].includes(v) : typeof v === 'string' && v.length < 30)));
const OPT_LABEL = { sliding: 'Sliding door', swing: 'Swing door', autoswing: 'Automatic swing door', conductive: 'Antistatic conductive vinyl', homogeneous: 'Homogeneous vinyl' };
const optsText = o => [
  o.door_type && `door: ${OPT_LABEL[o.door_type]}${o.door_size ? ` ${o.door_size} × 2100 mm` : ''}`, o.floor_type && `floor: ${OPT_LABEL[o.floor_type]}`,
  o.surgeon_arms && `surgeon pendant: ${o.surgeon_arms === 2 ? 'double' : 'single'} arm`, o.anaes_arms && `anaesthesia pendant: ${o.anaes_arms === 2 ? 'double' : 'single'} arm`,
  o.light_domes && `OT light: ${['', 'single', 'double', 'triple'][o.light_domes]} dome${o.light_camera === 'yes' ? ' with camera' : ''}`, o.laf_size && `plenum ${o.laf_size}`,
  o.xray_plates && `${o.xray_plates}-plate X-ray viewer`, o.storage_count && `${o.storage_count} storage cabinet(s)`, o.passbox_count && `${o.passbox_count} pass box(es)`,
  o.scrub_bays && `${o.scrub_bays}-bay scrub (${o.scrub_tap || 'sensor'})`, o.passage_finish && `passage walls: ${{ wood: 'wooden finish', ss: 'SS 304', ppgi: 'PPGL', glass: 'glass' }[o.passage_finish]}${o.passage_colour ? ` (${o.passage_colour})` : ''}`,
].filter(Boolean).join(' · ');
const VIDEO_NAMES = Object.fromEntries(Object.entries(VIDEOS).map(([k, v]) => [k, v.title]));

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const SYSTEM_USER = { name: 'Website form', role: 'admin' };

// ---------------------------------------------------------------- what the visitor can pick
export const PROJECT_TYPES = {
  ot: 'Modular OT', icu: 'ICU', nicu: 'NICU', picu: 'PICU', cathlab: 'Cath Lab', isolation: 'Isolation Room',
  ivf: 'IVF Lab', cssd: 'CSSD', cleanroom: 'Clean Room', other: 'Other',
};
const TIMELINES = { '1m': 'Within 1 month', '3m': '1–3 months', '6m': '3–6 months', '6p': 'More than 6 months', explore: 'Just exploring' };
const BUDGETS = { u50: 'Under ₹50 lakh', '50_100': '₹50 lakh – 1 crore', '100_200': '₹1 – 2 crore', '200_500': '₹2 – 5 crore', '500p': 'Above ₹5 crore', guide: 'Need guidance' };

// Small in-memory limit per IP so the open form cannot be flooded.
const hits = new Map();
function limit(req, key, max, minutes) {
  const k = `${key}|${req.ip}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter(t => now - t < minutes * 60e3);
  if (list.length >= max) throw new HttpError(429, 'Too many requests. Please try again in a few minutes.');
  list.push(now);
  hits.set(k, list);
}

const clip = (v, n = 200) => (v == null ? '' : String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n));
const digits = v => String(v || '').replace(/[^\d+]/g, '');

// Keep only known keys and sane values from what the browser sends.
function cleanData(d = {}) {
  const arr = (v, ok) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && (!ok || ok.includes(x))).slice(0, 40) : []);
  const n = v => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x < 1e6 ? Math.round(x) : null; };
  return {
    types: arr(d.types, Object.keys(PROJECT_TYPES)), other_type: clip(d.other_type, 80),
    build: ['new', 'renovation', 'unsure'].includes(d.build) ? d.build : null,
    ots: n(d.ots), beds: n(d.beds), area: n(d.area), area_unsure: !!d.area_unsure,
    specialties: arr(d.specialties).map(s => clip(s, 40)), features: arr(d.features).map(s => clip(s, 40)), features_unsure: !!d.features_unsure,
    timeline: TIMELINES[d.timeline] ? d.timeline : null, budget: BUDGETS[d.budget] ? d.budget : null,
    name: clip(d.name, 80), hospital: clip(d.hospital, 120), city: clip(d.city, 60), phone: clip(digits(d.phone), 16),
    whatsapp: !!d.whatsapp, email: clip(d.email, 120), best_time: clip(d.best_time, 40), contact_by: clip(d.contact_by, 20), notes: clip(d.notes, 1000),
    viewed_3d: !!d.viewed_3d, panel_colour: clip(d.panel_colour, 30),
    videos: Object.fromEntries(Object.entries(d.videos && typeof d.videos === 'object' ? d.videos : {}).filter(([k]) => VIDEO_NAMES[k]).map(([k, v]) => [k, Math.max(0, Math.min(100, Math.round(Number(v) || 0)))]).filter(([, v]) => v > 0)),
    opts: cleanOpts(d.opts),
    wall_finish: clip(d.wall_finish, 12), wall_colour: clip(d.wall_colour, 30), floor_main: clip(d.floor_main, 30), floor_border: clip(d.floor_border, 30),
  };
}

// 0–100: how soon, how big, how far along (drawing, decided budget, features).
export function leadScore(d) {
  let s = 0;
  s += { '1m': 30, '3m': 24, '6m': 14, '6p': 6, explore: 2 }[d.timeline] || 0;
  s += { u50: 8, '50_100': 14, '100_200': 18, '200_500': 22, '500p': 25, guide: 6 }[d.budget] || 0;
  const size = (d.ots || 0) * 2 + (d.beds || 0) * 0.5 + d.types.length;
  s += Math.min(20, Math.round(size * 2));
  if (d.build === 'new') s += 6; else if (d.build === 'renovation') s += 5;
  if (d.has_drawing) s += 8;
  s += Math.min(6, d.features.length);
  if (d.viewed_3d) s += 2;
  s += Math.min(4, Object.values(d.videos || {}).filter(p => p >= 50).length); // watched explainer videos
  if (d.email) s += 1;
  if (d.whatsapp) s += 2;
  return Math.min(100, s);
}
const grade = s => (s >= 60 ? 'Hot' : s >= 35 ? 'Warm' : 'Cold');

export function summaryText(d) {
  const types = d.types.map(t => (t === 'other' && d.other_type ? `Other: ${d.other_type}` : PROJECT_TYPES[t]));
  return [
    `Project: ${types.join(', ') || '—'}`,
    d.build && `Construction: ${{ new: 'New construction', renovation: 'Renovation of an existing space', unsure: 'Not sure yet' }[d.build]}`,
    (d.ots || d.beds) && `Size: ${[d.ots && `${d.ots} OT(s)`, d.beds && `${d.beds} bed(s)`].filter(Boolean).join(', ')}`,
    `Area: ${d.area ? `about ${d.area} sq ft` : d.area_unsure ? 'not sure' : '—'}`,
    d.specialties.length && `Specialty: ${d.specialties.join(', ')}`,
    `Features: ${d.features.length ? d.features.join(', ') : d.features_unsure ? 'needs guidance' : '—'}`,
    d.timeline && `Timeline: ${TIMELINES[d.timeline]}`,
    d.budget && `Budget: ${BUDGETS[d.budget]}`,
    `Contact: ${[d.phone, d.whatsapp && '(WhatsApp)', d.email].filter(Boolean).join(' ')}${d.best_time ? ` · best time: ${d.best_time}` : ''}${d.contact_by ? ` · prefers ${d.contact_by}` : ''}`,
    d.viewed_3d && `Explored the 3D view${d.wall_finish ? ` · walls: ${WALL_NAME[d.wall_finish] || d.wall_finish}${d.wall_colour && ['glass', 'wood'].includes(d.wall_finish) ? ` (${d.wall_colour})` : ''}` : ''}${d.floor_main ? ` · floor: ${d.floor_main} with ${d.floor_border} border` : ''}`,
    Object.keys(d.opts || {}).length && `Choices: ${optsText(d.opts)}`,
    Object.keys(d.videos || {}).length && `Watched: ${Object.entries(d.videos).map(([k, p]) => `${VIDEO_NAMES[k]} (${p}%)`).join(', ')}`,
    d.notes && `Notes: ${d.notes}`,
  ].filter(Boolean).join('\n');
}

// "Modular OT | 4500000 | 8500000 | per OT" lines in Settings → shown only when the company switches it on.
function estimate(d) {
  const s = getSettings();
  if (s.web_show_estimate !== 'Yes') return null;
  let lo = 0, hi = 0;
  for (const line of s.web_estimates || []) {
    const [label, a, b, per] = String(line).split('|').map(x => x.trim());
    const key = Object.entries(PROJECT_TYPES).find(([, v]) => v.toLowerCase() === String(label).toLowerCase())?.[0];
    if (!key || !d.types.includes(key)) continue;
    const count = /bed/i.test(per || '') ? d.beds || 1 : /ot/i.test(per || '') ? d.ots || 1 : 1;
    lo += (Number(a) || 0) * count; hi += (Number(b) || 0) * count;
  }
  return lo && hi ? { low: lo, high: hi } : null;
}

export function publicConfig() {
  const s = getSettings();
  return {
    company: s.company_name, short: s.company_short || 'WIESPL', tagline: s.tagline || '', phone: s.phone, email: s.email, website: s.website,
    trust: s.web_trust || [], next_steps: s.web_next_steps || '', brochure_url: s.web_brochure_url || '', whatsapp: s.web_whatsapp || '',
  };
}

// ---------------------------------------------------------------- routes (mounted before login is required)
export function publicRouter() {
  const r = express.Router();
  const wrap = fn => async (req, res, next) => { try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); } catch (e) { next(e); } };

  r.get('/config', wrap(() => publicConfig()));
  r.get('/part-photos', wrap(() => publicPhotos()));
  r.get('/part-photo/:id', (req, res, next) => { try { const p = photoFile(req.params.id); res.set('Cache-Control', 'public, max-age=86400'); res.type(p.mime).sendFile(p.full); } catch (e) { next(e); } });

  // Progress, saved after every step (also when the visitor never finishes).
  r.post('/lead', express.json({ limit: '50kb' }), wrap(req => {
    limit(req, 'lead', 120, 10);
    const d = cleanData(req.body?.data);
    const step = Math.max(0, Math.min(20, Number(req.body?.step) || 0));
    let token = /^[A-Za-z0-9_-]{20,64}$/.test(req.body?.token || '') ? req.body.token : null;
    const row = token && db.prepare('SELECT id, enquiry_id FROM web_leads WHERE token = ?').get(token);
    if (row?.enquiry_id) return { token, submitted: true };
    if (row) db.prepare("UPDATE web_leads SET data = ?, step = ?, name = ?, phone = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(JSON.stringify(d), step, d.name || null, d.phone || null, row.id);
    else {
      token = crypto.randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO web_leads (token, data, step, name, phone, ip) VALUES (?, ?, ?, ?, ?, ?)').run(token, JSON.stringify(d), step, d.name || null, d.phone || null, String(req.ip || '').slice(0, 60));
    }
    return { token };
  }));

  r.post('/lead/submit', express.json({ limit: '50kb' }), wrap(req => {
    limit(req, 'submit', 6, 60);
    const d = cleanData(req.body?.data);
    d.has_drawing = !!req.body?.data?.has_drawing;
    if (!d.types.length) throw new HttpError(400, 'Please choose what you are planning');
    if (!d.name) throw new HttpError(400, 'Please enter your name');
    if (d.phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Please enter a valid phone number');
    const token = /^[A-Za-z0-9_-]{20,64}$/.test(req.body?.token || '') ? req.body.token : null;
    const lead = token && db.prepare('SELECT * FROM web_leads WHERE token = ?').get(token);
    if (lead?.enquiry_id) {
      const e = db.prepare('SELECT enquiry_no FROM enquiries WHERE id = ?').get(lead.enquiry_id);
      return { ref: e?.enquiry_no, already: true, estimate: estimate(d), brief: briefFor(lead.enquiry_id, d) };
    }
    const score = leadScore(d);
    const types = d.types.map(t => (t === 'other' && d.other_type ? d.other_type : PROJECT_TYPES[t]));
    const enq = insertRow('enquiries', {
      date: today(), status: 'New', source: 'Website', enquiry_by: 'Website',
      hospital_name: d.hospital || null, place: d.city || null, district: d.city || null,
      doctor_name: d.name, doctor_phone: d.phone, email: d.email || null, whatsapp: d.whatsapp ? 'Yes' : 'No', best_time: d.best_time || null,
      type_of_work: types.join(', '), capacity: [d.ots && `${d.ots} OT`, d.beds && `${d.beds} beds`, d.area && `${d.area} sq ft`].filter(Boolean).join(', ') || null,
      lead_score: score, lead_grade: grade(score), web_summary: summaryText(d), next_followup: today(),
      remarks: d.notes || null,
    }, SYSTEM_USER, { system: true });
    if (lead) db.prepare("UPDATE web_leads SET data = ?, enquiry_id = ?, submitted_at = datetime('now','localtime'), name = ?, phone = ? WHERE id = ?").run(JSON.stringify(d), enq.id, d.name, d.phone, lead.id);
    else db.prepare("INSERT INTO web_leads (token, data, step, name, phone, ip, enquiry_id, submitted_at) VALUES (?, ?, 99, ?, ?, ?, ?, datetime('now','localtime'))")
      .run(token || crypto.randomBytes(18).toString('base64url'), JSON.stringify(d), d.name, d.phone, String(req.ip || '').slice(0, 60), enq.id);
    notify({ fn: 'notify_enquiry', kind: 'enquiries', title: `🌐 New ${grade(score).toLowerCase()} website enquiry: ${types.join(', ')}${d.city ? ` – ${d.city}` : ''}`,
      body: `${d.name}${d.hospital ? `, ${d.hospital}` : ''} · ${d.phone}${d.whatsapp ? ' (WhatsApp)' : ''} · score ${score}`, link: `#/view/enquiries/${enq.id}` }, SYSTEM_USER);
    return { ref: enq.enquiry_no, score, estimate: estimate(d), brief: briefFor(enq.id, d) };
  }));

  // Layout / drawing chosen on the form, sent right after submitting.
  const OK_FILE = /\.(pdf|jpe?g|png|webp|heic|dwg|dxf|doc|docx|xls|xlsx|zip)$/i;
  r.post('/lead/file', express.raw({ type: () => true, limit: '25mb' }), wrap(req => {
    limit(req, 'file', 10, 60);
    const lead = db.prepare('SELECT * FROM web_leads WHERE token = ?').get(String(req.query.token || ''));
    if (!lead?.enquiry_id) throw new HttpError(400, 'Send the enquiry first');
    if (Date.now() - new Date(String(lead.submitted_at).replace(' ', 'T')).getTime() > 3 * 3600e3) throw new HttpError(400, 'This upload link has expired');
    const n = db.prepare("SELECT COUNT(*) n FROM attachments WHERE entity = 'enquiries' AND record_id = ? AND uploaded_by = 'Website form'").get(lead.enquiry_id).n;
    if (n >= 5) throw new HttpError(400, 'Up to 5 files can be attached');
    const name = clip(req.query.name, 150);
    if (!OK_FILE.test(name)) throw new HttpError(400, 'Allowed: PDF, images, AutoCAD (DWG / DXF), Word, Excel or ZIP');
    return saveAttachment('enquiries', lead.enquiry_id, { filename: name, mime: 'application/octet-stream', note: 'Layout / drawing sent with the website enquiry' }, req.body, SYSTEM_USER);
  }));
  // ---- detailed requirement brief (second form), opened with its own link
  const briefRow = req => { const t = String(req.query.t || req.body?.t || ''); const b = /^[A-Za-z0-9_-]{20,64}$/.test(t) && db.prepare('SELECT * FROM design_briefs WHERE token = ?').get(t); if (!b) throw new HttpError(404, 'This link is not valid. Please ask WIESPL for a new one.'); return b; };
  r.get('/brief', wrap(req => {
    limit(req, 'brief', 120, 10);
    const b = briefRow(req);
    const e = db.prepare('SELECT enquiry_no, hospital_name, place, doctor_name, doctor_phone, type_of_work FROM enquiries WHERE id = ?').get(b.enquiry_id) || {};
    let data = null; try { data = JSON.parse(b.data || 'null'); } catch { /* start again */ }
    return { ref: e.enquiry_no, enquiry: { hospital: e.hospital_name, city: e.place, doctor: e.doctor_name, phone: e.doctor_phone, types: e.type_of_work }, data, submitted_at: b.submitted_at, files: db.prepare("SELECT filename FROM attachments WHERE entity = 'enquiries' AND record_id = ? AND uploaded_by = 'Website form' ORDER BY id").all(b.enquiry_id) };
  }));
  r.post('/brief', express.json({ limit: '120kb' }), wrap(req => {
    limit(req, 'brief-save', 240, 10);
    const b = briefRow(req);
    db.prepare("UPDATE design_briefs SET data = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(JSON.stringify(cleanBrief(req.body?.data)), b.id);
    return { ok: true };
  }));
  // drawings / site photos from the detailed form go onto the enquiry
  r.post('/brief/file', express.raw({ type: () => true, limit: '25mb' }), wrap(req => {
    limit(req, 'brief-file', 20, 60);
    const b = briefRow(req);
    const n = db.prepare("SELECT COUNT(*) n FROM attachments WHERE entity = 'enquiries' AND record_id = ? AND uploaded_by = 'Website form'").get(b.enquiry_id).n;
    if (n >= 15) throw new HttpError(400, 'Up to 15 files can be attached');
    const name = clip(req.query.name, 150);
    if (!OK_FILE.test(name)) throw new HttpError(400, 'Allowed: PDF, images, AutoCAD (DWG / DXF), Word, Excel or ZIP');
    return saveAttachment('enquiries', b.enquiry_id, { filename: name, mime: 'application/octet-stream', note: 'Drawing / site photo from the detailed requirement form' }, req.body, SYSTEM_USER);
  }));
  r.post('/brief/submit', express.json({ limit: '120kb' }), wrap(req => {
    limit(req, 'brief-submit', 10, 60);
    const b = briefRow(req);
    const d = cleanBrief(req.body?.data);
    if (!d.rooms.length) throw new HttpError(400, 'Add at least one OT');
    const text = briefText(d);
    db.prepare("UPDATE design_briefs SET data = ?, updated_at = datetime('now','localtime'), submitted_at = datetime('now','localtime'), submitted_by = ? WHERE id = ?").run(JSON.stringify(d), [d.project.filled_by, d.project.filler_name].filter(Boolean).join(': ') || null, b.id);
    db.prepare('UPDATE enquiries SET design_brief = ? WHERE id = ?').run(text, b.enquiry_id);
    const e = db.prepare('SELECT enquiry_no, hospital_name FROM enquiries WHERE id = ?').get(b.enquiry_id) || {};
    notify({ fn: 'notify_enquiry', kind: 'enquiries', title: `📋 Detailed requirements received: ${e.enquiry_no || ''}${e.hospital_name ? ' – ' + e.hospital_name : ''}`,
      body: `${d.rooms.length} OT(s) · filled by ${d.project.filled_by || 'client'}${d.project.filler_name ? ' (' + d.project.filler_name + ')' : ''}`, link: `#/view/enquiries/${b.enquiry_id}` }, SYSTEM_USER);
    return { ok: true, ref: e.enquiry_no };
  }));
  return r;
}

const WALL_NAME = { ss: 'SS 304', ppgi: 'PPGL', glass: 'Toughened glass', ssglass: 'SS 304 + glass', wood: 'Wooden finish (HPL)' };
// One brief link per enquiry, started with what the client already told us on the first form.
export function briefFor(enquiryId, d) {
  const old = db.prepare('SELECT token FROM design_briefs WHERE enquiry_id = ?').get(enquiryId);
  if (old) return old.token;
  const token = crypto.randomBytes(18).toString('base64url');
  const e = db.prepare('SELECT hospital_name, place, doctor_name, doctor_phone, capacity FROM enquiries WHERE id = ?').get(enquiryId) || {};
  const n = Math.max(1, Math.min(12, Number(d?.ots) || Number(String(e.capacity || '').match(/(\d+)\s*OT/i)?.[1]) || 1));
  const specs = (d?.specialties || []).filter(s => SPEC_OK.includes(s));
  const rooms = Array.from({ length: n }, (_, i) => {
    const r = newRoom(i, null);
    if (specs.length) Object.assign(r, newRoom(i, { ...r, specialty: specs[i % specs.length], laf: undefined, air7: undefined, co2: undefined }), { name: `OT ${i + 1}` });
    if (d?.wall_finish && WALL_NAME[d.wall_finish]) { r.wall = WALL_NAME[d.wall_finish]; r.wall_colour = d.wall_colour || r.wall_colour; }
    if (d?.floor_main) { r.floor_main = d.floor_main; r.floor_border = d.floor_border || r.floor_border; }
    const o = d?.opts || {};
    if (o.door_type) r.door = { sliding: 'Hermetic sliding (automatic)', swing: 'Single leaf swing', autoswing: 'Automatic swing' }[o.door_type];
    if (o.door_size) r.door_size = `${o.door_size} × 2100 mm`;
    if (o.floor_type) r.floor_type = OPT_LABEL[o.floor_type];
    if (o.surgeon_arms) r.pendant_surgeon = o.surgeon_arms === 2 ? 'Double arm' : 'Single arm';
    if (o.anaes_arms) r.pendant_anaes = o.anaes_arms === 2 ? 'Double arm' : 'Single arm';
    if (o.light_domes) r.ot_light = ['', 'Single dome', 'Double dome', 'Triple dome'][o.light_domes];
    if (o.light_camera) r.camera = o.light_camera === 'yes' ? 'Yes' : 'No';
    if (o.laf_size) r.laf = o.laf_size;
    if (o.xray_plates) r.xray = `${o.xray_plates}-plate LED`;
    if (o.storage_count) r.storage = o.storage_count;
    if (o.passbox_count) r.passbox = o.passbox_count;
    if (o.scrub_bays) r.scrub = `${o.scrub_bays} bay`;
    if (o.scrub_tap) r.scrub_type = { sensor: 'Sensor', foot: 'Foot-operated', elbow: 'Elbow' }[o.scrub_tap];
    if (o.passage_finish) r.passage_wall = { wood: 'Wooden finish (HPL)', ss: 'SS 304', ppgi: 'PPGL', glass: 'Toughened glass' }[o.passage_finish];
    if (d?.features?.includes('SHRM – Smart Heat Recovery (WIESPL patent)')) r.shrm = 'Yes';
    return r;
  });
  const data = cleanBrief({ project: { hospital: e.hospital_name, city: e.place, doctor: e.doctor_name, phone: e.doctor_phone, build: { new: 'New construction', renovation: 'Renovation of an existing OT' }[d?.build] }, rooms });
  db.prepare('INSERT INTO design_briefs (token, enquiry_id, data) VALUES (?, ?, ?)').run(token, enquiryId, JSON.stringify(data));
  return token;
}

// Visitors who started the form but did not finish (for sales to follow up).
export function unfinishedLeads() {
  return db.prepare(`SELECT id, created_at, updated_at, step, name, phone, data FROM web_leads
    WHERE enquiry_id IS NULL AND updated_at >= datetime('now', '-30 days') ORDER BY id DESC LIMIT 100`).all()
    .map(l => { let d = {}; try { d = JSON.parse(l.data || '{}'); } catch { /* ignore */ } return { ...l, data: undefined, summary: summaryText(cleanData(d)).split('\n').slice(0, 4).join(' · '), types: (d.types || []).map(t => PROJECT_TYPES[t] || t) }; });
}
