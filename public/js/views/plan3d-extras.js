// Extras for the CAD drawing viewer (plan3d.js):
// - room sizes read from the drawing's labels ("OPERATION THEATER 01  7722 x 6692 MM")
// - an OT from the drawing opened as the detailed WIESPL OT 3D at its real size
// - quantities per OT (floor, wall panels, ceiling, coving) the way the WIESPL basis of design counts them,
//   copied to Excel or sent to the enquiry's detailed requirement form
import { h, api, toast, fail, modal } from '../ui.js';

const FT = 3.28084;

// "OPERATION THEATER 01\n7722 x 6692 MM" → { name: 'OPERATION THEATER 01', w: 7.722, d: 6.692 } (metres); null when no size
export function roomSize(text) {
  const s = String(text || '');
  const m = s.match(/(\d{3,6})\D{0,3}[xX×]\s*(\d{3,5})\s*MM/i);
  if (!m) return null;
  let a = m[1], b = Number(m[2]), extra = '';
  if (Number(a) > 20000) { extra = a.slice(0, -4); a = a.slice(-4); } // "THEATER 065853x" → room "06", 5853 mm
  a = Number(a);
  if (a < 1500 || a > 20000 || b < 1500 || b > 20000) return null;
  const name = (s.slice(0, m.index).split('\n').filter(Boolean).pop() || '').replace(/\s+/g, ' ').trim() + extra;
  return { name: name || s.split('\n')[0].trim(), w: a / 1000, d: b / 1000 };
}
export const isOt = name => /THEAT|\bOT\b|OPERATION|CATH|HYBRID|PROCEDURE/i.test(name) && !/STORE|DOOR|CORRIDOR|COORDINATOR|STATION|PHARMACY|MANAGER|RECOVERY|HOLDING|CHANGE|TOILET|SCRUB|STERILE|DUTY|LOUNGE|WAITING/i.test(name);
const ft = m => m * FT;
const fmtFt = m => { const t = Math.round(ft(m) * 12); return `${Math.floor(t / 12)}'-${t % 12}"`; };
const r1 = v => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- OT from the drawing → WIESPL OT 3D
let cssLoaded = false;
export async function openOtRoom(room) {
  if (!cssLoaded) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/ot3d.css'; document.head.append(l); cssLoaded = true; }
  const [{ mount3D }, { PART_UI }] = await Promise.all([import('../ot3d.js'), import('../parts.js')]);
  const box = h('div.eq-3d', h('div.loading', 'Loading the OT…'));
  const bar = h('div.toolbar.p3-otbar');
  const close = () => { viewer?.dispose?.(); wrap.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const wrap = h('div.vmodal', { onclick: e => { if (e.target === wrap) close(); } },
    h('div.vmodal-in',
      h('div.p3-othead', h('b', `🏥 ${room.name}`), h('span', `${r1(room.w)} × ${r1(room.d)} m · ${fmtFt(room.w)} × ${fmtFt(room.d)} · from the drawing`)),
      box, bar, h('button.vmodal-x', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, '×')));
  document.body.append(wrap); document.addEventListener('keydown', esc);
  const features = ['laf', 'hepa', 'pendant_surgeon', 'pendant_anaes', 'otlight', 'control', 'automation', 'pressure', 'doors', 'xray', 'passbox', 'storage', 'scrub', 'panels', 'flooring', 'ahu', 'shrm'];
  const info = Object.fromEntries(Object.entries(PART_UI).map(([k, p]) => [k, { label: p.title, hint: p.text, icon: p.icon }]));
  let viewer = null;
  try { viewer = await mount3D(box, { types: ['ot'], features, info, room: { w: room.w, d: room.d } }); } catch (e) { box.replaceChildren(h('p', `⚠ ${e.message}`)); return; }
  if (!wrap.isConnected) { viewer?.dispose?.(); return; }
  bar.replaceChildren(...(viewer.controls || []).map(c => { const b = h('button.btn.small', { type: 'button', onclick: () => { const on = c.run(); if (on !== undefined) b.classList.toggle('primary', !!on); } }, c.label); if (c.pressed) b.classList.add('primary'); c.ref?.(b); return b; }));
}

// ---------------------------------------------------------------- quantities from the drawing
// rooms: [{ name, w, d }] with sizes in metres; layers: [{ name, role, metres }]; meta: the drawing's record
export async function quantitiesDialog({ rooms, layers, heightM, meta }) {
  let onlyOt = true, H = heightM;
  const table = h('div');
  const height = h('input', { type: 'number', min: 2, max: 6, step: 0.05, value: H, style: { width: '80px' }, oninput: e => { H = Math.max(1, Number(e.target.value) || 3); draw(); } });
  const only = h('input', { type: 'checkbox', checked: true, onchange: e => { onlyOt = e.target.checked; draw(); } });
  const list = () => rooms.filter(r => !onlyOt || isOt(r.name));
  const calc = r => { const L = ft(r.w), B = ft(r.d), Hf = ft(H); return { floor: L * B, walls: 2 * (L + B) * Hf, ceiling: L * B, coving: 4 * (L + B) + 4 * Hf }; };
  let lastRows = [];
  function draw() {
    const rs = list(), tot = { floor: 0, walls: 0, ceiling: 0, coving: 0 };
    lastRows = rs.map(r => { const c = calc(r); for (const k in tot) tot[k] += c[k]; return [r.name, `${r1(r.w)} × ${r1(r.d)} m`, `${fmtFt(r.w)} × ${fmtFt(r.d)}`, Math.round(c.floor), Math.round(c.walls), Math.round(c.ceiling), Math.round(c.coving)]; });
    const head = ['Room', 'Size (m)', 'Size (ft)', 'Floor sq ft', 'Wall panels sq ft', 'Ceiling sq ft', 'Coving rft'];
    table.replaceChildren(
      rs.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', head.map(x => h('th', x)))),
        h('tbody', lastRows.map(r => h('tr', r.map((v, i) => (i > 2 ? h('td.num', v.toLocaleString('en-IN')) : h('td', v)))))),
        h('tfoot', h('tr', h('th', { colspan: 3 }, `Total · ${rs.length} room(s)`), ...['floor', 'walls', 'ceiling', 'coving'].map(k => h('th.num', Math.round(tot[k]).toLocaleString('en-IN'))))))) : h('p.muted', 'No rooms with a size (like "7722 x 6692 MM") in their label.'),
      layers.length ? [h('h3', { style: { marginTop: '14px' } }, 'Whole drawing, by layer'),
        h('div.table-wrap', h('table.data', h('thead', h('tr', ['Layer', 'What it is', 'Line length (m)', 'Wall run ≈ (m)', `Panel area at ${r1(H)} m (sq ft)`].map(x => h('th', x)))),
          h('tbody', layers.map(l => { const run = l.role === 'wall' || l.role === 'column' ? l.metres / 2 : l.metres; return h('tr', h('td', l.name), h('td', l.role), h('td.num', Math.round(l.metres).toLocaleString('en-IN')), h('td.num', Math.round(run).toLocaleString('en-IN')), h('td.num', Math.round(run * FT * H * FT).toLocaleString('en-IN'))); }))))] : null);
  }
  draw();
  const copy = async () => {
    const head = ['Room', 'Size (m)', 'Size (ft)', 'Floor sq ft', 'Wall panels sq ft', 'Ceiling sq ft', 'Coving rft'];
    const tsv = [head, ...lastRows].map(r => r.join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); toast('Copied: paste into Excel'); } catch { toast('Could not copy here: select the table and press Ctrl+C'); }
  };
  const send = async () => {
    const ots = list().filter(r => isOt(r.name));
    if (!ots.length) { toast('No operation theatres in the list'); return; }
    // the same name on two floors of one sheet ("OPERATION THEATER 01" twice) becomes "… (2)" so neither overwrites the other
    const count = {};
    const named = ots.map(o => { count[o.name] = (count[o.name] || 0) + 1; return { ...o, name: count[o.name] > 1 ? `${o.name} (${count[o.name]})` : o.name }; });
    const r = await api(`/enquiries/${meta.record_id}/brief-rooms`, { method: 'POST', body: { rooms: named.map(o => ({ name: o.name, length: ft(o.w), width: ft(o.d), height: ft(H) })) } });
    toast(`Detailed form: ${r.added} OT(s) added, ${r.updated} updated`);
    sent.replaceChildren(h('a.btn.small', { href: `brief.html?t=${encodeURIComponent(r.token)}`, target: '_blank', rel: 'noopener' }, '📋 Open the detailed form'));
  };
  const sent = h('span');
  const canSend = meta?.entity === 'enquiries' && meta.canWrite;
  await modal('📐 Quantities from the drawing', h('div.grid',
    h('p.muted', 'From the room labels that carry a size (e.g. "7722 x 6692 MM"), counted like the WIESPL basis of design: wall panels = perimeter × height, ceiling = floor = length × width, coving = floor and ceiling edges + 4 corners. Doors and glass are not deducted; check against the drawing before quoting.'),
    h('div.toolbar', h('label', 'OT height ', height, ' m'), h('label', only, ' Only operation theatres'),
      h('button.btn.small', { type: 'button', onclick: () => copy().catch(fail) }, '📋 Copy for Excel'),
      canSend ? h('button.btn.small.primary', { type: 'button', onclick: () => send().catch(fail) }, '➕ Send OT sizes to the detailed form') : null, sent),
    table),
  [{ label: 'Close', value: true }], { wide: true });
}
