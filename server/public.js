// Client-facing enquiry form (no login): progress is saved as the visitor goes, and on submit an
// enquiry is created in the Enquiry Register with a lead score, and sales get a pop-up.
import crypto from 'node:crypto';
import express from 'express';
import { db, getSettings } from './db.js';
import { insertRow, HttpError } from './crud.js';
import { saveAttachment } from './roles.js';
import { notify } from './notify.js';

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
    viewed_3d: !!d.viewed_3d,
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
    d.viewed_3d && 'Explored the 3D view',
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
      return { ref: e?.enquiry_no, already: true, estimate: estimate(d) };
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
    return { ref: enq.enquiry_no, score, estimate: estimate(d) };
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
  return r;
}

// Visitors who started the form but did not finish (for sales to follow up).
export function unfinishedLeads() {
  return db.prepare(`SELECT id, created_at, updated_at, step, name, phone, data FROM web_leads
    WHERE enquiry_id IS NULL AND updated_at >= datetime('now', '-30 days') ORDER BY id DESC LIMIT 100`).all()
    .map(l => { let d = {}; try { d = JSON.parse(l.data || '{}'); } catch { /* ignore */ } return { ...l, data: undefined, summary: summaryText(cleanData(d)).split('\n').slice(0, 4).join(' · '), types: (d.types || []).map(t => PROJECT_TYPES[t] || t) }; });
}
