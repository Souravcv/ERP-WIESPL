// Detailed OT requirement brief (second form, filled by the surgeon / hospital team or WIESPL sales).
// Follows the WIESPL Basis of Design (Annexure II) and estimate (Annexure III). Shared by brief.js (browser)
// and server/public.js (summary text for the Enquiry Register), so it must not touch the DOM.
import { otNorms, otType } from './nabh.js';

export const SPECIALTIES = ['General surgery', 'Orthopaedics', 'Cardiac', 'Neuro', 'Transplant', 'Gynae / Obstetrics', 'Ophthalmic', 'ENT', 'Urology', 'Robotic', 'Day care', 'Other'];
export const WALLS = ['SS 304', 'PPGI', 'Toughened glass', 'Wooden finish (HPL)'];
export const WALL_COLOURS = { 'SS 304': ['Natural steel'], PPGI: ['Off-white'], 'Toughened glass': ['Ivory white', 'Sky blue', 'Mint green'], 'Wooden finish (HPL)': ['Light oak', 'Walnut'] };
export const FLOORS = ['Beige', 'Grey', 'Sky blue', 'Aqua green', 'Navy blue', 'Light grey'];
const YN = ['Yes', 'No'];
const SCOPE = ['WIESPL', 'Hospital', 'Not decided'];

// field: { key, label, type: text | number | select | yn | textarea, options, def, hint, unit, show(room) }
export const PROJECT = [
  { key: 'filled_by', label: 'Filled by', type: 'select', options: ['Surgeon', 'Hospital team', 'WIESPL sales', 'Consultant / architect'] },
  { key: 'filler_name', label: 'Your name' },
  { key: 'hospital', label: 'Hospital' }, { key: 'city', label: 'City' }, { key: 'doctor', label: 'Surgeon / contact person' }, { key: 'phone', label: 'Mobile' },
  { key: 'build', label: 'Construction', type: 'select', options: ['New construction', 'Renovation of an existing OT', 'Not sure'] },
  { key: 'floor_level', label: 'Which floor is the OT on?', hint: 'e.g. 2nd floor, terrace above' },
  { key: 'nabh', label: 'NABH accreditation', type: 'select', options: ['Planned', 'Already accredited', 'Not planned'] },
  { key: 'target', label: 'Target date to start surgeries', hint: 'Month / year' },
];

export const ROOM = [
  ['Room', [
    { key: 'name', label: 'OT name', def: i => `OT ${i + 1}` },
    { key: 'specialty', label: 'Specialty', type: 'select', options: SPECIALTIES, def: () => 'General surgery' },
    { key: 'length', label: 'Length', type: 'number', unit: 'ft', def: () => 20 },
    { key: 'width', label: 'Width', type: 'number', unit: 'ft', def: () => 20 },
    { key: 'height', label: 'Clear height', type: 'number', unit: 'ft', def: () => 10, hint: 'Floor to slab; the false ceiling sits at about 9–10 ft' },
    { key: 'cases', label: 'Surgeries per day', type: 'number' },
    { key: 'persons', label: 'People in the OT during surgery', type: 'number', def: () => 6 },
    { key: 'equip_kw', label: 'Equipment load', type: 'number', unit: 'kW', def: () => 2 },
  ]],
  ['Air system (HVAC)', [
    { key: 'laf', label: 'Laminar flow plenum', type: 'select', options: ['4 × 6 ft', '4 × 8 ft', '6 × 8 ft', '8 × 10 ft', 'Not sure'], def: (i, r) => suggestLaf(r?.specialty), hint: 'Suggested from the specialty; NABH wants the filter area 1 ft beyond every side of the table' },
    { key: 'hepa_at', label: 'HEPA filters', type: 'select', options: ['Terminal (in the OT ceiling)', 'At the AHU'], def: () => 'Terminal (in the OT ceiling)' },
    { key: 'ahu_at', label: 'AHU location', type: 'select', options: ['Terrace', 'Room next to the OT', 'Above the ceiling', 'Not sure'] },
    { key: 'shrm', label: 'SHRM – Smart Heat Recovery (WIESPL patent)', type: 'yn', def: () => 'Yes', hint: 'Humidity control without electric heaters: lower power bills' },
    { key: 'ismart', label: 'iSmart remote monitoring', type: 'yn', def: () => 'Yes' },
    { key: 'fumigation', label: 'Fumigation system', type: 'yn' },
  ]],
  ['Walls, ceiling & floor', [
    { key: 'wall', label: 'Wall panels', type: 'select', options: WALLS, def: () => 'SS 304' },
    { key: 'wall_colour', label: 'Wall colour', type: 'select', options: r => WALL_COLOURS[r.wall] || [], def: (i, r) => (WALL_COLOURS[r?.wall] || [''])[0], show: r => (WALL_COLOURS[r.wall] || []).length > 1 },
    { key: 'ceiling', label: 'Ceiling panels', type: 'select', options: ['SS 304', 'PPGI'], def: () => 'SS 304' },
    { key: 'floor_main', label: 'Floor main colour', type: 'select', options: FLOORS, def: () => 'Beige' },
    { key: 'floor_border', label: 'Floor border colour', type: 'select', options: FLOORS, def: () => 'Grey' },
    { key: 'picture_glass', label: 'Picture glass panel (digital wallpaper)', type: 'yn', def: () => 'Yes' },
    { key: 'lead', label: 'Lead lining (C-arm / X-ray use)', type: 'yn' },
  ]],
  ['Doors, glazing & storage', [
    { key: 'door', label: 'Main door', type: 'select', options: ['Hermetic sliding (automatic)', 'Double leaf swing', 'Single leaf swing'], def: () => 'Hermetic sliding (automatic)' },
    { key: 'door_size', label: 'Door size', type: 'select', options: ['1200 × 2100 mm', '1500 × 2100 mm', '1800 × 2100 mm'], def: () => '1500 × 2100 mm' },
    { key: 'passbox', label: 'Pass boxes', type: 'number', def: () => 1 },
    { key: 'storage', label: 'SS storage cabinets', type: 'number', def: () => 2 },
    { key: 'xray', label: 'X-ray viewer', type: 'select', options: ['2-plate LED', '3-plate LED', 'Digital (PACS) screen', 'None'], def: () => '2-plate LED' },
    { key: 'writing_board', label: 'Magnetic writing board', type: 'yn', def: () => 'Yes' },
  ]],
  ['Equipment', [
    { key: 'pendant_surgeon', label: "Surgeon's pendant", type: 'select', options: ['Double arm', 'Single arm', 'None'], def: () => 'Double arm' },
    { key: 'pendant_anaes', label: 'Anaesthesia pendant', type: 'select', options: ['Single arm', 'Double arm', 'None'], def: () => 'Single arm' },
    { key: 'ot_light', label: 'OT light', type: 'select', options: ['Double dome', 'Triple dome', 'Single dome', 'None (existing)'], def: () => 'Double dome' },
    { key: 'camera', label: 'Camera in the OT light', type: 'yn' },
    { key: 'ot_table', label: 'OT table', type: 'select', options: ['Electro-hydraulic', 'Orthopaedic (with traction)', 'Existing table', 'None'], def: () => 'Electro-hydraulic' },
    { key: 'control', label: "Surgeon's control panel", type: 'yn', def: () => 'Yes' },
    { key: 'outside_panel', label: 'Control panel outside the OT', type: 'yn', def: () => 'Yes' },
    { key: 'leds', label: 'LED ceiling lights (2 × 2 ft)', type: 'number', def: () => 8 },
  ]],
  ['Medical gases (outlets in this OT)', [
    { key: 'o2', label: 'Oxygen', type: 'number', def: () => 2 }, { key: 'n2o', label: 'Nitrous oxide', type: 'number', def: () => 1 },
    { key: 'air4', label: 'Air 4 bar', type: 'number', def: () => 2 }, { key: 'air7', label: 'Air 7 bar (tools)', type: 'number', def: (i, r) => (['Orthopaedics', 'Neuro'].includes(r?.specialty) ? 1 : 0) },
    { key: 'vac', label: 'Vacuum', type: 'number', def: () => 2 }, { key: 'co2', label: 'CO₂', type: 'number', def: (i, r) => (['General surgery', 'Gynae / Obstetrics', 'Urology', 'Robotic'].includes(r?.specialty) ? 1 : 0) },
    { key: 'agss', label: 'AGSS (anaesthetic gas scavenging)', type: 'number', def: () => 1 },
    { key: 'scrub', label: 'Scrub sink (in the passage)', type: 'select', options: ['2 bay', '3 bay', '1 bay', 'None'], def: () => '2 bay' },
    { key: 'scrub_type', label: 'Scrub tap', type: 'select', options: ['Sensor', 'Foot-operated', 'Elbow'], def: () => 'Sensor' },
  ]],
  ['Notes', [{ key: 'notes', label: 'Anything special about this OT', type: 'textarea' }]],
];

export const SITE = [
  { key: 'ahu_space', label: 'Space for the AHU and outdoor units', hint: 'e.g. terrace above the OT, shaft next to the OT' },
  { key: 'duct_run', label: 'Distance from AHU to the OT', type: 'number', unit: 'm' },
  { key: 'power', label: 'Power supply', type: 'select', options: ['3-phase available', 'Single phase only', 'Not sure'] },
  { key: 'dg', label: 'DG back-up for the OT', type: 'yn' }, { key: 'ups', label: 'UPS for the OT', type: 'yn' },
  { key: 'existing_floor', label: 'Existing floor', type: 'select', options: ['Mosaic / Kota stone', 'Tiles', 'Concrete', 'Not sure'], hint: 'Vinyl is laid on a 2 mm self-levelling base' },
  { key: 'civil_by', label: 'Civil work by', type: 'select', options: SCOPE }, { key: 'electrical_by', label: 'Electrical cabling by', type: 'select', options: SCOPE },
  { key: 'mgps_by', label: 'MGPS / gas manifold by', type: 'select', options: SCOPE },
  { key: 'drawing', label: 'Architectural drawing available', type: 'yn' },
  { key: 'remarks', label: 'Other remarks', type: 'textarea' },
];

export function suggestLaf(spec) {
  if (otType(spec) === 'A') return '8 × 10 ft';
  if (spec === 'Ophthalmic') return '4 × 8 ft';
  if (['ENT', 'Gynae / Obstetrics', 'Urology', 'Day care'].includes(spec)) return '4 × 6 ft';
  return '6 × 8 ft';
}

export function newRoom(i, from) {
  const r = {};
  for (const [, fields] of ROOM) for (const f of fields) { const v = from?.[f.key] ?? f.def?.(i, r); if (v != null && v !== '') r[f.key] = v; }
  if (from) r.name = `OT ${i + 1}`;
  return r;
}

// Design figures as in the WIESPL Basis of Design (50 air changes for Type A, about 42 for Type B).
export function roomCalc(r) {
  const L = Number(r.length) || 0, Wd = Number(r.width) || 0, Ht = Math.min(Number(r.height) || 10, 10);
  const vol = L * Wd * Math.max(8, Ht - 1); // air volume under the false ceiling
  const type = otType(r.specialty);
  const acph = type === 'A' ? 50 : 41.67; // 3000 / 2500 cfm for a 20 × 20 × 9 ft OT, as in the basis of design
  const cfm = vol ? Math.max(1500, Math.ceil((vol * acph) / 60 / 250 - 0.01) * 250) : 0;
  const tr = cfm ? Math.max(3, Math.round((cfm / (cfm > 2500 ? 375 : 417)) * 2) / 2) : 0; // 2500 cfm = 6 TR, 3000 cfm = 8 TR (basis of design)
  const fresh = vol ? Math.ceil((vol * 5) / 60 / 10) * 10 : 0;
  const [pa, pb] = String(r.laf || '').match(/\d+/g)?.map(Number) || [];
  const lafOk = pa ? Math.max(pa, pb) >= 8.7 && Math.min(pa, pb) >= 3.7 : null; // 80-inch table + 1 ft each side
  const norms = otNorms(r.specialty);
  return {
    type, acph, cfm, tr, fresh, area: L * Wd, wallArea: Math.round(2 * (L + Wd) * Math.min(Ht, 10)), lafOk, norms,
    temp: r.specialty === 'Orthopaedics' ? '18 ± 2 °C (joint replacement)' : '20 ± 2 °C (NABH 21 ± 3 °C)',
    rh: 'not more than 55% (NABH 20–60%)', cls: type === 'A' ? 'ISO 5 (Class 100)' : 'ISO 6 (Class 1000), designed to Class 100 at the plenum',
  };
}

const show = (f, r) => !f.show || f.show(r);
const val = (f, v) => (v == null || v === '' ? null : `${v}${f.unit ? ' ' + f.unit : ''}`);
export function briefText(d = {}) {
  const out = [];
  const p = d.project || {};
  out.push('PROJECT', ...PROJECT.map(f => val(f, p[f.key]) && `  ${f.label}: ${val(f, p[f.key])}`).filter(Boolean));
  (d.rooms || []).forEach((r, i) => {
    const c = roomCalc(r);
    out.push('', `${r.name || `OT ${i + 1}`} · ${r.specialty || '—'} · NABH Type ${c.type}`,
      `  Size: ${r.length || '?'} × ${r.width || '?'} × ${r.height || '?'} ft · design ${Math.round(c.acph)} air changes · about ${c.cfm} cfm AHU · ${c.tr} TR · fresh air ${c.fresh} cfm · ${c.temp}`);
    for (const [title, fields] of ROOM) {
      const vals = fields.filter(f => show(f, r) && f.key !== 'name' && f.key !== 'specialty' && !['length', 'width', 'height'].includes(f.key)).map(f => val(f, r[f.key]) && `${f.label}: ${val(f, r[f.key])}`).filter(Boolean);
      if (vals.length) out.push(`  ${title}: ${vals.join(' · ')}`);
    }
  });
  const s = d.site || {};
  const sv = SITE.map(f => val(f, s[f.key]) && `  ${f.label}: ${val(f, s[f.key])}`).filter(Boolean);
  if (sv.length) out.push('', 'SITE & SCOPE', ...sv);
  return out.join('\n');
}

// Keep only known keys with short values (the brief comes from an open link).
export function cleanBrief(d = {}) {
  const clip = (v, n) => (v == null ? undefined : typeof v === 'number' ? (Number.isFinite(v) && Math.abs(v) < 1e6 ? v : undefined) : String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n) || undefined);
  const pick = (src, fields) => { const o = {}; for (const f of fields) { const v = clip(src?.[f.key], f.type === 'textarea' ? 1500 : 120); if (v !== undefined) o[f.key] = f.type === 'number' ? (Number.isFinite(Number(v)) ? Number(v) : undefined) : v; } return o; };
  const roomFields = ROOM.flatMap(([, f]) => f);
  return { project: pick(d.project, PROJECT), rooms: (Array.isArray(d.rooms) ? d.rooms : []).slice(0, 30).map(r => pick(r, roomFields)), site: pick(d.site, SITE) };
}
