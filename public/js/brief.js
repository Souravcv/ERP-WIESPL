// Detailed OT requirement brief: one card per OT with the NABH norms for its specialty and the design figures
// (air changes, cfm, TR) worked out as it is filled. Saved as you type; "Send" puts it on the enquiry in the CRM.
import { PROJECT, ROOM, SITE, WALL_COLOURS, newRoom, roomCalc, suggestLaf } from './brief-fields.js';
import { NABH_SOURCE } from './nabh.js';
import { openExplainer } from './ot3d.js';
import { videoSecs, fmtSecs } from './explainers.js';

// "? Learn more" beside a field opens its explainer video; "Add" from the video fills the field
const LEARN = {
  shrm: { video: 'shrm', add: r => { r.shrm = 'Yes'; } },
  passbox: { video: 'passbox', add: r => { r.passbox = Math.max(1, Number(r.passbox) || 0); } },
  door: { video: 'doors', add: r => { r.door = 'Hermetic sliding (automatic)'; } },
  laf: { video: 'laf' }, hepa_at: { video: 'laf' }, ahu_at: { video: 'ahu' },
};

const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]+)?(.*)$/i);
  const el = document.createElement(name);
  for (const p of rest.match(/[.#][^.#]+/g) || []) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const token = new URLSearchParams(location.search).get('t') || '';
const api = async (path, body) => {
  const res = await fetch('/api/public' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again');
  return data;
};

let B = { project: {}, rooms: [], site: {} }, info = {}, cur = 0, saveTimer, sent = null;
const watched = (key, pct) => { B.watched = { ...(B.watched || {}) }; B.watched[key] = Math.max(B.watched[key] || 0, pct); save(); };
const learn = (key, obj) => openExplainer(LEARN[key].video, { onWatch: watched, onAdd: LEARN[key].add ? () => { LEARN[key].add(obj); save(); draw(); } : null });
const saved = t => { $('bf-saved').textContent = t; };
const save = () => {
  saved('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { try { await api('/brief', { t: token, data: B }); saved('✓ Saved'); } catch (e) { saved('⚠ Not saved: ' + e.message); } }, 700);
};

// ---------------------------------------------------------------- one input per field
function input(f, obj, onChange) {
  const set = v => { if (v === '' || v == null) delete obj[f.key]; else obj[f.key] = f.type === 'number' ? Number(v) : v; save(); onChange?.(); };
  const opts = typeof f.options === 'function' ? f.options(obj) : f.options;
  let ctl;
  if (f.type === 'select') {
    ctl = h('select', { onchange: e => set(e.target.value) }, h('option', { value: '' }, '—'), (opts || []).map(o => h('option', { value: o, ...(obj[f.key] === o ? { selected: true } : {}) }, o)));
  } else if (f.type === 'yn') {
    ctl = h('div.eq-chips', ['Yes', 'No'].map(o => { const b = h('button.eq-chip', { type: 'button', 'aria-pressed': String(obj[f.key] === o), onclick: () => { set(obj[f.key] === o ? '' : o); ctl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.textContent === obj[f.key]))); } }, o); return b; }));
  } else if (f.type === 'textarea') {
    ctl = h('textarea', { rows: 3, oninput: e => set(e.target.value) }); ctl.value = obj[f.key] || '';
  } else {
    ctl = h('input', { type: f.type === 'number' ? 'number' : 'text', inputmode: f.type === 'number' ? 'decimal' : null, min: f.type === 'number' ? 0 : null, value: obj[f.key] ?? '', oninput: e => set(e.target.value) });
  }
  const lm = LEARN[f.key] && B.rooms.includes(obj) ? h('button.bf-learn', { type: 'button', onclick: e => { e.preventDefault(); learn(f.key, obj); } }, '? Learn more') : null;
  return h('label.eq-field' + (f.type === 'textarea' ? '.wide' : ''), h('span', f.label, f.unit ? h('small', ` (${f.unit})`) : null, lm), ctl, f.hint ? h('small.bf-hint', f.hint) : null);
}
const grid = (fields, obj, onChange) => h('div.bf-grid', fields.filter(f => !f.show || f.show(obj)).map(f => input(f, obj, onChange)));

// ---------------------------------------------------------------- the OT cards
function checks(r, c) {
  const L = [];
  const add = (cls, text) => L.push(h('li.' + cls, text));
  add('ok', `${c.norms.title}: air at the supply grille ${c.cls}.`);
  add('ok', `Design ${Math.round(c.acph)} air changes per hour (NABH minimum 20, of which 4 fresh air).`);
  if (c.lafOk === true) add('ok', `Plenum ${r.laf} covers the table with 1 ft to spare on every side.`);
  else if (c.lafOk === false) add('warn', `Plenum ${r.laf} is smaller than an 80-inch table plus 1 ft each side (about 8.7 × 3.7 ft). Check against the table you will use.`);
  else add('warn', 'Choose the laminar flow plenum size.');
  if (r.hepa_at && !/Terminal/.test(r.hepa_at)) add('warn', 'NABH prefers terminal HEPA filters in the OT ceiling; HEPA at the AHU only where that is not feasible.');
  else add('ok', 'Terminal HEPA filters, 99.97% at 0.3 µm.');
  add(r.door && !/Hermetic/.test(r.door) ? 'warn' : 'ok', r.door && !/Hermetic/.test(r.door) ? 'Swing doors: keep them closed so the OT stays at +2.5 Pa or more.' : 'Hermetic door helps hold positive pressure (NABH: at least 2.5 Pa, day and night).');
  add('ok', `Temperature ${c.temp}, humidity ${c.rh}.`);
  if (r.shrm === 'Yes') add('ok', 'SHRM: humidity control without the electric heater bank of the standard design (12 kW per OT).');
  if (r.scrub === 'None') add('warn', 'WHO: surgical hand preparation is needed before every case; plan a scrub station in the passage.');
  add('info', 'NABH: validate every 6 months to ISO 14644 (temperature & RH, particle count, air changes, velocity, pressure, HEPA).');
  return h('ul.bf-check', L);
}
function roomCard() {
  const r = B.rooms[cur];
  const calc = h('div');
  const drawCalc = () => {
    const c = roomCalc(r);
    calc.replaceChildren(
      h('div.bf-calc',
        [['NABH', `Type ${c.type}`], ['Floor area', c.area ? `${c.area} sq ft` : '—'], ['Wall area', c.wallArea ? `${c.wallArea} sq ft` : '—'], ['AHU', c.cfm ? `≈ ${c.cfm} cfm` : '—'], ['Cooling', c.tr ? `≈ ${c.tr} TR` : '—'], ['Fresh air', c.fresh ? `≈ ${c.fresh} cfm` : '—']]
          .map(([k, v]) => h('div', h('small', k), h('b', v)))),
      checks(r, c));
  };
  drawCalc();
  const body = h('div');
  const drawBody = () => body.replaceChildren(...ROOM.map(([title, fields]) => h('fieldset.bf-set', h('legend', title), grid(fields, r, () => {
    if (fields.some(f => f.key === 'specialty' || f.key === 'wall')) { refreshDefaults(r); drawBody(); }
    drawCalc(); drawTabs();
  }))));
  drawBody();
  return h('div.bf-room', calc, body,
    h('div.bf-row',
      B.rooms.length > 1 ? h('button.eq-btn', { type: 'button', onclick: () => { for (let i = 0; i < B.rooms.length; i++) if (i !== cur) B.rooms[i] = { ...newRoom(i, r), name: B.rooms[i].name, specialty: B.rooms[i].specialty, laf: B.rooms[i].laf }; save(); alertMsg(`Settings of ${r.name} copied to the other OTs (their names, specialties and plenum sizes kept).`); } }, '⧉ Copy to the other OTs') : null,
      B.rooms.length > 1 ? h('button.eq-btn', { type: 'button', onclick: () => { if (!confirm(`Remove ${r.name}?`)) return; B.rooms.splice(cur, 1); cur = Math.max(0, cur - 1); save(); draw(); } }, '🗑 Remove this OT') : null));
}
// a new specialty suggests its plenum size and gases; a new wall finish resets its colour
const lastSpec = new WeakMap();
function refreshDefaults(r) {
  const prev = lastSpec.get(r);
  if (prev && prev.specialty !== r.specialty) { const d = newRoom(0, { specialty: r.specialty }); r.laf = suggestLaf(r.specialty); r.air7 = d.air7; r.co2 = d.co2; }
  if (prev && prev.wall !== r.wall) r.wall_colour = (WALL_COLOURS[r.wall] || [])[0];
  lastSpec.set(r, { specialty: r.specialty, wall: r.wall });
}
const tabs = h('div.bf-tabs');
function drawTabs() {
  tabs.replaceChildren(...B.rooms.map((r, i) => h('button.eq-chip', { type: 'button', 'aria-pressed': String(i === cur), onclick: () => { cur = i; draw(); } }, `${r.name || `OT ${i + 1}`}${r.specialty ? ' · ' + r.specialty : ''}`)),
    B.rooms.length < 30 ? h('button.eq-chip.unsure', { type: 'button', onclick: () => { B.rooms.push(newRoom(B.rooms.length, B.rooms[cur])); cur = B.rooms.length - 1; save(); draw(); } }, '＋ Add OT') : null);
}
let toastEl = null;
const alertMsg = t => { toastEl?.remove(); toastEl = h('div.eq-feedback.show', t); $('bf-rooms')?.prepend(toastEl); setTimeout(() => toastEl?.remove(), 4000); };

// ---------------------------------------------------------------- page
function draw() {
  for (const r of B.rooms) refreshDefaults(r);
  drawTabs();
  const main = $('bf-main');
  main.replaceChildren(
    h('section.eq-card',
      h('div.eq-step', info.ref ? `Enquiry ${info.ref}` : 'Your enquiry'),
      h('h1', 'Detailed OT requirements'),
      h('p.eq-sub', 'Fill what you know; leave the rest blank and our engineer will suggest it. Everything is saved as you type, so you can come back to this link later.'),
      h('button.eq-btn', { type: 'button', style: { marginBottom: '12px' }, onclick: () => openExplainer('delivery', { onWatch: watched }) }, `🎬 What you receive from WIESPL · ${fmtSecs(videoSecs('delivery'))}`),
      sent ? h('div.eq-feedback.show', `✅ Sent to WIESPL${sent.ref ? ` (enquiry ${sent.ref})` : ''}. You can still change anything and send again.`) : null,
      h('h2.bf-h', '1 · Project'), grid(PROJECT, B.project),
      h('h2.bf-h', '2 · Operation theatres'),
      h('div#bf-rooms', tabs, roomCard()),
      h('h2.bf-h', '3 · Site & scope of work'), grid(SITE, B.site),
      h('p.eq-skip', `Norms: ${NABH_SOURCE}. Design figures follow the WIESPL basis of design and are confirmed after the site survey.`),
      h('div.eq-err', { id: 'bf-err' }),
      h('div.eq-nav', h('button.eq-btn', { type: 'button', onclick: () => print() }, '🖨 Print / PDF'),
        h('button.eq-btn.primary', { type: 'button', onclick: send }, sent ? 'Send again' : 'Send to WIESPL'))));
}

async function send(e) {
  const btn = e.currentTarget, err = $('bf-err');
  if (!B.rooms.length) { err.textContent = 'Add at least one OT.'; return; }
  btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
  try { clearTimeout(saveTimer); sent = await api('/brief/submit', { t: token, data: B }); saved('✓ Sent'); draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Send to WIESPL'; }
}

(async () => {
  try { const c = await api('/config'); $('eq-company').textContent = c.short || c.company || 'WIESPL'; } catch { /* keep the default name */ }
  try {
    info = await api(`/brief?t=${encodeURIComponent(token)}`);
    B = { project: {}, site: {}, rooms: [], ...(info.data || {}) };
    for (const k of ['hospital', 'city', 'doctor', 'phone']) if (!B.project[k] && info.enquiry?.[k]) B.project[k] = info.enquiry[k];
    if (!B.rooms.length) B.rooms.push(newRoom(0));
    if (info.submitted_at) sent = { ref: info.ref };
    draw();
  } catch (e) {
    $('bf-main').replaceChildren(h('section.eq-card', h('h1', 'Link not valid'), h('p.eq-sub', e.message)));
  }
})();
