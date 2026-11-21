// Basis of Design (BOD) sheet of an enquiry (management discussion, Nov 2026), made by itself from
//  - the OT list on the enquiry (name, kind, specialty) and the CAD drawing (OT labels with a size, read when the drawing was uploaded),
//  - the sizes already in the detailed requirement form,
// using the same design figures as the detailed form (roomCalc: air changes, supply cfm, TR, fresh air, NABH norms).
// Technical Sales checks it and confirms it; it can be downloaded as an Excel sheet.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { db, audit } from './db.js';
import { HttpError } from './crud.js';
import { planFile } from './plans.js';
import { roomSize, isOt } from '../public/js/ot-labels.js';
import { roomCalc } from '../public/js/brief-fields.js';
import { otNorms } from '../public/js/nabh.js';

const FT = 3.28084, r1 = v => Math.round(v * 10) / 10;
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const parse = (v, d) => { try { const x = typeof v === 'string' ? JSON.parse(v) : v; return x ?? d; } catch { return d; } };
const num = x => { const n = parseInt(String(x).match(/\d+/)?.[0], 10); return Number.isFinite(n) ? n : null; };
const sameOt = (a, b) => { const A = String(a || '').trim().toUpperCase(), B = String(b || '').trim().toUpperCase(); if (!A || !B) return false; if (A === B) return true; const x = num(A), y = num(B); return x != null && x === y && isOt(a) === isOt(b) || (x != null && x === y && /\d/.test(A) && /\d/.test(B)); };

// the OT labels (with a size) of the enquiry's CAD drawings, the way the CAD viewer finds them
export function otsFromDrawings(enquiryId) {
  const out = [], ducts = [];
  for (const a of db.prepare("SELECT id, filename FROM attachments WHERE entity = 'enquiries' AND record_id = ? AND (lower(filename) LIKE '%.dwg' OR lower(filename) LIKE '%.dxf') ORDER BY id").all(enquiryId)) {
    let plan; try { plan = JSON.parse(fs.readFileSync(planFile(a.id), 'utf8')); } catch { continue; }
    const seen = new Set();
    for (const t of plan.texts || []) {
      const first = String(t.t || '').split('\n').filter(Boolean)[0] || '';
      if (!/[A-Za-z]{2,}/.test(first) || !isOt(first)) continue;
      const key = `${Math.round(t.x * 10)}_${Math.round(t.y * 10)}`; if (seen.has(key)) continue; seen.add(key);
      let sz = roomSize(t.t);
      if (!sz) { const q = (plan.texts || []).filter(u => u !== t && Math.abs(u.x - t.x) < 2.5 && Math.abs(u.y - t.y) < 1.2).map(u => ({ u, s: roomSize(u.t) })).filter(v => v.s)
        .sort((p, q2) => Math.hypot(p.u.x - t.x, p.u.y - t.y) - Math.hypot(q2.u.x - t.x, q2.u.y - t.y))[0]; if (q) sz = { ...q.s, name: first.trim() }; }
      out.push({ name: (sz?.name || first).trim(), w: sz?.w || null, d: sz?.d || null, file: a.filename });
    }
    let m = 0; for (const [name, l] of Object.entries(plan.layers || {})) if (/DUCT/i.test(name)) for (let i = 0; i < (l.segs || []).length; i += 4) m += Math.hypot(l.segs[i + 2] - l.segs[i], l.segs[i + 3] - l.segs[i + 1]);
    if (m > 0) ducts.push({ file: a.filename, metres: Math.round(m) });
  }
  return { ots: out, ducts };
}

export function build(enquiryId) {
  const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(Number(enquiryId));
  if (!e) throw new HttpError(404, 'Enquiry not found');
  const list = parse(e.ot_list, []).filter(r => String(r?.name || '').trim());
  const brief = parse(db.prepare('SELECT data FROM design_briefs WHERE enquiry_id = ? ORDER BY id DESC LIMIT 1').get(e.id)?.data, {});
  const { ots: cad, ducts } = otsFromDrawings(e.id);
  // the rows: the OT list first; else what the CAD drawing holds; else the rooms of the detailed form
  const base = list.length ? list : cad.length ? cad.map(c => ({ name: c.name })) : (brief.rooms || []).map(r => ({ name: r.name, specialty: r.specialty }));
  const used = new Set(), rows = base.map((r, i) => {
    const c = cad.find((x, k) => !used.has(k) && sameOt(x.name, r.name)); if (c) used.add(cad.indexOf(c));
    const b = (brief.rooms || []).find(x => sameOt(x.name, r.name));
    let L = Number(r.length) || 0, W = Number(r.width) || 0, H = Number(r.height) || 0, from = L && W ? 'OT list' : '';
    if (!(L && W) && c?.w) { L = r1(c.w * FT); W = r1(c.d * FT); from = `CAD (${c.file})`; }
    if (!(L && W) && b?.length && b?.width) { L = Number(b.length); W = Number(b.width); from = 'Detailed form'; }
    if (!H) H = Number(b?.height) || 10;
    const room = { ...(b || {}), name: r.name, specialty: r.specialty || b?.specialty || 'General surgery', length: L, width: W, height: H };
    const k = roomCalc(room);
    const perim = 2 * (L + W);
    return { no: i + 1, name: r.name, kind: r.kind || '', specialty: room.specialty, type: k.type, from: from || 'No size yet', length: L || null, width: W || null, height: H,
      size_m: L ? `${r1(L / FT)} × ${r1(W / FT)} m` : '', area: Math.round(L * W), acph: Math.round(k.acph * 10) / 10, cfm: k.cfm, tr: k.tr, fresh: k.fresh,
      temp: k.temp, rh: k.rh, cls: k.cls, walls: Math.round(perim * Math.min(H, 10)), ceiling: Math.round(L * W), floor: Math.round(L * W), coving: Math.round(2 * perim + 4 * H),
      plenum: L ? 'Min 8.7 × 3.7 ft (80-inch table + 1 ft each side, NABH)' : '', lafOk: k.lafOk, ready: !!(L && W) };
  });
  const totals = rows.reduce((t, r) => ({ cfm: t.cfm + r.cfm, tr: t.tr + r.tr, walls: t.walls + r.walls, ceiling: t.ceiling + r.ceiling, floor: t.floor + r.floor, coving: t.coving + r.coving, fresh: t.fresh + r.fresh }), { cfm: 0, tr: 0, walls: 0, ceiling: 0, floor: 0, coving: 0, fresh: 0 });
  return { enquiry: { id: e.id, no: e.enquiry_no, hospital: e.hospital_name, place: e.place, client: e.client_name }, rows, totals, ducts,
    missing: rows.filter(r => !r.ready).map(r => r.name), cad_ots: cad.length, confirmed: e.bod_at ? { at: e.bod_at, by: e.bod_by } : null,
    standard: otNorms(['General surgery']).rows, basis: 'Air changes 50 per hour for Type A and about 42 for Type B (WIESPL basis of design); NABH 2018 OT air-conditioning guideline for the other figures. Heights default to 10 ft where not given.' };
}

export function confirm(id, user) {
  const b = build(id);
  if (!b.rows.length) throw new HttpError(409, 'Add the OTs to the OT list of the enquiry (or upload the CAD drawing) first');
  if (b.missing.length) throw new HttpError(409, `No size yet for: ${b.missing.join(', ')}. Enter the size in the OT list, or put the name and size in the CAD drawing.`);
  db.prepare('UPDATE enquiries SET bod_at = ?, bod_by = ? WHERE id = ?').run(stamp(), user.name, Number(id));
  audit(user.name, 'enquiries', Number(id), 'basis of design', `${b.rows.length} OT(s) confirmed`);
  return { at: stamp(), by: user.name };
}

export async function workbook(id) {
  const b = build(id), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Basis of Design');
  ws.addRow(['BASIS OF DESIGN']).font = { bold: true, size: 14 };
  ws.addRow([`${b.enquiry.no || ''} · ${b.enquiry.hospital || ''}${b.enquiry.place ? ', ' + b.enquiry.place : ''}`]);
  ws.addRow([b.confirmed ? `Confirmed by ${b.confirmed.by} on ${b.confirmed.at}` : 'Not confirmed yet']); ws.addRow([]);
  const head = ['#', 'OT', 'Kind', 'Specialty', 'NABH type', 'Size from', 'Length (ft)', 'Width (ft)', 'Height (ft)', 'Size (m)', 'Floor (sq ft)', 'Air changes / h', 'Supply (cfm)', 'Fresh air (cfm)', 'AC capacity (TR)', 'Plenum (HEPA ceiling)', 'Temperature', 'Humidity', 'Air class', 'Wall panels (sq ft)', 'Ceiling (sq ft)', 'Coving (rft)'];
  const hr = ws.addRow(head); hr.font = { bold: true }; hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }; c.alignment = { wrapText: true, vertical: 'top' }; });
  for (const r of b.rows) ws.addRow([r.no, r.name, r.kind, r.specialty, r.type, r.from, r.length, r.width, r.height, r.size_m, r.area, r.acph, r.cfm, r.fresh, r.tr, r.plenum, r.temp, r.rh, r.cls, r.walls, r.ceiling, r.coving]);
  const t = ws.addRow(['', 'Total', '', '', '', '', '', '', '', '', b.totals.floor, '', b.totals.cfm, b.totals.fresh, b.totals.tr, '', '', '', '', b.totals.walls, b.totals.ceiling, b.totals.coving]); t.font = { bold: true };
  for (const d of b.ducts) ws.addRow(['', `Ducting drawn in ${d.file} (whole drawing): about ${d.metres} m of duct lines`]);
  ws.addRow([]); ws.addRow(['Standard design data (the same for every OT)']).font = { bold: true };
  for (const [k, v] of b.standard) ws.addRow(['', k, v]);
  ws.addRow([]); ws.addRow(['', b.basis]);
  ws.columns.forEach((c, i) => { c.width = [5, 22, 16, 18, 9, 22, 10, 10, 10, 14, 11, 11, 11, 11, 11, 34, 26, 26, 30, 13, 13, 11][i] || 14; });
  return wb;
}
