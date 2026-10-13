// The big panel beside the 3D (right column on a computer, under the model on a phone) for the part the
// client tapped: photos, what it is, facts, every choice that is possible for it (applied live to the 3D),
// a small demo (open the pass box, swing a pendant …) and its explainer video.
import { PART_UI, PART_ALIAS, DOOR_TYPES, FLOOR_TYPES, LAF_SIZE_LIST } from './parts.js';
import { OT_FINISHES, WALL_FINISHES, FLOOR_COLOURS } from './ot3d.js';
import { VIDEOS, videoSecs, fmtSecs } from './explainers.js';
import { suggestLaf } from './brief-fields.js';

const hex = n => '#' + Number(n).toString(16).padStart(6, '0');
// a picture of each finish, drawn with CSS
const finishLook = (f, colour) => {
  const c = (f.colours.find(x => x[0] === colour) || f.colours[0])[1];
  if (f.key === 'ss') return 'repeating-linear-gradient(90deg, rgba(255,255,255,.18) 0 2px, rgba(80,90,105,.08) 2px 4px), linear-gradient(135deg, #eef1f4, #b9c2cc 45%, #e4e8ec 60%, #a8b2bd)';
  if (f.key === 'glass') return `linear-gradient(120deg, rgba(255,255,255,.65) 0 18%, rgba(255,255,255,0) 32%), linear-gradient(180deg, ${hex(c)}, ${hex(c)})`;
  if (f.combo) return `linear-gradient(170deg, rgba(255,255,255,.55) 0 10%, rgba(255,255,255,0) 22%), linear-gradient(to top, #c9d0d8 0 40%, #8e98a4 40% 42%, ${hex(c)} 42%)`;
  if (f.key === 'wood') return `repeating-linear-gradient(90deg, rgba(80,50,25,.18) 0 1px, transparent 1px 22px), repeating-linear-gradient(88deg, rgba(120,80,40,.12) 0 3px, transparent 3px 9px), ${hex(c)}`;
  return `linear-gradient(180deg, ${hex(c)}, #dfe2dc)`;
};

export function partPanel(rawKey, ctx) {
  const { h, viewer, D, photos = {}, onClose, has, setFeature, saveOpt } = ctx;
  const key = PART_ALIAS[rawKey] || rawKey;
  const P = PART_UI[key];
  if (!P) return null;
  const o = (D.opts ||= {});
  const box = h('section.eq-part', { 'aria-label': P.title });
  const redraw = () => box.replaceWith(partPanel(rawKey, ctx));
  const chips = (list, cur, pick) => h('div.eq-chips', list.map(([v, label]) => h('button.eq-chip', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => { pick(v); redraw(); } }, label)));
  const btn = (label, fn, cls = '') => h('button.eq-btn' + cls, { type: 'button', onclick: fn }, label);
  const section = (title, ...kids) => h('div.eq-part-sec', h('h3', title), ...kids);

  // header: name, in my plan, close
  const head = h('div.eq-part-head', h('span.ico', P.icon || '•'), h('div', h('b', P.title), P.feature ? h('small', has(P.feature) ? '✓ In your plan' : 'Not in your plan yet') : null),
    h('button.x', { type: 'button', 'aria-label': 'Close', onclick: onClose }, '×'));
  const plan = P.feature ? btn(has(P.feature) ? '✓ In my plan – remove' : '＋ Add to my plan', () => { setFeature(P.feature, !has(P.feature)); viewer?.setPicked?.(P.feature, has(P.feature)); redraw(); }, has(P.feature) ? '.on' : '.primary') : null;

  // real photos (uploaded in the CRM)
  const pics = (photos[key] || []);
  const gallery = pics.length ? h('div.eq-part-pics', pics.map(p => h('button', { type: 'button', 'aria-label': p.caption || P.title, onclick: () => lightbox(h, pics, pics.indexOf(p), P.title) },
    h('img', { src: `/api/public/part-photo/${p.id}`, alt: p.caption || P.title, loading: 'lazy' }), p.caption ? h('span', p.caption) : null))) : null;

  const body = [];
  const K = P.kind;
  if (K === 'wall' || K === 'passage') {
    const list = K === 'wall' ? OT_FINISHES : WALL_FINISHES.filter(f => !f.combo);
    const cur = K === 'wall' ? { f: D.wall_finish || 'ss', c: D.wall_colour } : { f: o.passage_finish || 'wood', c: o.passage_colour };
    body.push(section(K === 'wall' ? 'Choose the wall finish' : 'Choose the passage wall finish', h('div.eq-finishes', list.map(f => {
      const on = cur.f === f.key, colour = on ? cur.c : null;
      const apply = c => {
        if (K === 'wall') { D.wall_finish = f.key; D.wall_colour = c || f.colours[0][0]; viewer?.setFinish?.(f.key, D.wall_colour); if (!has('panels')) setFeature('panels', true); }
        else { o.passage_finish = f.key; o.passage_colour = c || f.colours[0][0]; viewer?.setPassage?.(f.key, o.passage_colour); }
        saveOpt(); redraw();
      };
      return h('div.eq-finish' + (on ? '.on' : ''),
        h('button.look', { type: 'button', style: { background: photos[`wall_${f.key}`]?.length && K === 'wall' ? `center / cover no-repeat url(/api/public/part-photo/${photos[`wall_${f.key}`][0].id})` : finishLook(f, colour) }, onclick: () => (K === 'wall' && photos[`wall_${f.key}`]?.length ? lightbox(h, photos[`wall_${f.key}`], 0, f.name) : apply(colour)), 'aria-label': f.name }),
        h('div.txt', h('b', f.name, on ? ' ✓' : ''), h('small', f.hint),
          f.colours.length > 1 ? h('div.sws', f.colours.map(([n, x]) => h('button.sw' + (on && (cur.c || f.colours[0][0]) === n ? '.on' : ''), { type: 'button', title: n, 'aria-label': n, style: { background: hex(x) }, onclick: () => apply(n) })), h('span', on ? cur.c || f.colours[0][0] : `${f.colours.length} colours`)) : h('small.one', f.key === 'ss' ? 'No colour: natural steel' : `Colour: ${f.colours[0][0]}`)));
    }))));
    if (K === 'passage') body.push(btn('👁 Look at the passage', () => viewer?.focus?.('passage')));
  }
  if (K === 'floor') {
    const ft = o.floor_type || 'conductive';
    body.push(section('Type of flooring', h('div.eq-finishes', FLOOR_TYPES.map(([v, label, hint]) => h('div.eq-finish' + (ft === v ? '.on' : ''), h('div.txt', h('b', label, ft === v ? ' ✓' : ''), h('small', hint)), h('button.eq-chip', { type: 'button', 'aria-pressed': String(ft === v), onclick: () => { o.floor_type = v; saveOpt(); redraw(); } }, ft === v ? 'Selected' : 'Choose'))))));
    const main = D.floor_main || 'Beige', border = D.floor_border || 'Grey';
    const col = n => (FLOOR_COLOURS.find(c => c[0] === n) || FLOOR_COLOURS[0])[1];
    body.push(section('Colours', h('div.eq-floorlook', { style: { background: col(border) } }, h('i', { style: { background: col(main) } })),
      ...[['main', 'Main colour (under the table)'], ['border', 'Border colour']].map(([k, label]) => h('div', h('small', label), h('div.sws', FLOOR_COLOURS.map(([n, x]) => h('button.sw' + ((k === 'main' ? main : border) === n ? '.on' : ''), { type: 'button', title: n, 'aria-label': n, style: { background: x },
        onclick: () => { if (k === 'main') D.floor_main = n; else D.floor_border = n; D.floor_main ||= main; D.floor_border ||= border; viewer?.setFloor?.(D.floor_main, D.floor_border); saveOpt(); redraw(); } })), h('span', k === 'main' ? main : border))))));
  }
  if (K === 'passbox') {
    const n = o.passbox_count || 1;
    const status = h('div.eq-part-status', 'Both doors closed. Tap a door to open it.');
    const act = a => { const r = viewer?.passbox?.(a); if (!r) return; status.textContent = r.msg || `${r.inner ? 'OT-side door open' : 'OT-side door closed'} · ${r.outer ? 'passage-side door open' : 'passage-side door closed'} · UV ${r.uv ? 'ON (sterilising)' : 'off'}`; status.classList.toggle('warn', !!r.msg); };
    body.push(section('Size', h('p', 'Internal 497 × 497 × 497 mm (standard). Bigger sizes on request.'),
      h('div.eq-num', h('div.lbl', h('b', 'Pass boxes in this OT')), h('div.eq-stepper', h('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => { o.passbox_count = Math.max(1, n - 1); saveOpt(); redraw(); } }, '−'), h('output', n), h('button', { type: 'button', 'aria-label': 'More', onclick: () => { o.passbox_count = Math.min(4, n + 1); saveOpt(); redraw(); } }, '+')))));
    body.push(section('Try it', h('div.eq-part-acts', btn('🚪 OT-side door', () => { viewer?.focus?.('passbox'); act('inner'); }), btn('🚪 Passage-side door', () => { viewer?.focus?.('passbox', 'out'); act('outer'); }), btn('🟣 UV lamp', () => act('uv'))),
      status, h('div.eq-part-acts', btn('👁 From the OT', () => viewer?.focus?.('passbox')), btn('👁 From the passage', () => viewer?.focus?.('passbox', 'out')))));
  }
  if (K === 'door') {
    const t = o.door_type || 'sliding';
    body.push(section('Type of door', h('div.eq-finishes', DOOR_TYPES.map(([v, label, hint]) => h('div.eq-finish' + (t === v ? '.on' : ''), h('div.txt', h('b', label, t === v ? ' ✓' : ''), h('small', hint)),
      h('button.eq-chip', { type: 'button', 'aria-pressed': String(t === v), onclick: () => { o.door_type = v; viewer?.setDoor?.({ type: v, mode: v === 'swing' ? 'closed' : 'auto' }); viewer?.focus?.('doors'); if (!has('doors')) setFeature('doors', true); saveOpt(); redraw(); } }, t === v ? 'Selected' : 'Choose'))))));
    body.push(section('Size', chips([['1200', '1200 × 2100 mm'], ['1500', '1500 × 2100 mm'], ['1800', '1800 × 2100 mm']], o.door_size || '1500', v => { o.door_size = v; saveOpt(); })));
    body.push(section('Try it', h('div.eq-part-acts', btn('Open', () => { viewer?.focus?.('doors'); viewer?.setDoor?.({ mode: 'open' }); }), btn('Close', () => viewer?.setDoor?.({ mode: 'closed' })), t !== 'swing' ? btn('Automatic (sensor)', () => viewer?.setDoor?.({ mode: 'auto' })) : null)));
  }
  if (K === 'pendant') {
    const ok = key === 'pendant_surgeon' ? 'surgeon_arms' : 'anaes_arms', arms = o[ok] || (key === 'pendant_surgeon' ? 2 : 1);
    body.push(section('Arms', chips([[1, 'Single arm'], [2, 'Double arm']], arms, v => { o[ok] = v; viewer?.setPendant?.(key, v); if (!has(key)) setFeature(key, true); saveOpt(); })),
      section('Try it', h('div.eq-part-acts', btn('↻ Swing the arm', () => { viewer?.focus?.(key); viewer?.swingPendant?.(key); }))));
  }
  if (K === 'light') {
    const d = o.light_domes || 2;
    body.push(section('Domes', chips([[1, 'Single dome'], [2, 'Double dome'], [3, 'Triple dome']], d, v => { o.light_domes = v; viewer?.setLights?.(v, o.light_off !== true); saveOpt(); })),
      section('Camera', chips([['no', 'No camera'], ['yes', 'Camera in the light']], o.light_camera || 'no', v => { o.light_camera = v; saveOpt(); })),
      section('Try it', h('div.eq-part-acts', btn(o.light_off ? '💡 Switch on' : '💡 Switch off', () => { o.light_off = !o.light_off; viewer?.setLights?.(d, !o.light_off); viewer?.focus?.('otlight'); redraw(); }))));
  }
  if (K === 'laf' && key === 'laf') {
    const sug = suggestLaf((D.specialties || []).find(Boolean));
    const cur = o.laf_size || sug;
    body.push(section('Plenum size', h('p', `Suggested for your specialty: ${sug}.`), chips(LAF_SIZE_LIST.map(s => [s, s]), cur, v => { o.laf_size = v; viewer?.setLaf?.(v); viewer?.focus?.('laf'); saveOpt(); })),
      section('Try it', h('div.eq-part-acts', btn('🌬 Show the clean air', () => { viewer?.setAir?.(true); viewer?.focus?.('laf'); }))));
  }
  if (K === 'xray') body.push(section('Plates', chips([[2, '2-plate'], [3, '3-plate']], o.xray_plates || 2, v => { o.xray_plates = v; viewer?.setXray?.(v); viewer?.focus?.('xray'); saveOpt(); })));
  if (K === 'storage') body.push(section('Cabinets', chips([[1, '1 cabinet'], [2, '2 cabinets']], o.storage_count || 2, v => { o.storage_count = v; viewer?.setStorage?.(v); viewer?.focus?.('storage'); saveOpt(); })));
  if (K === 'scrub') body.push(section('Bays', chips([[1, '1 bay'], [2, '2 bays'], [3, '3 bays']], o.scrub_bays || 2, v => { o.scrub_bays = v; saveOpt(); })),
    section('Taps', chips([['sensor', 'Sensor'], ['foot', 'Foot-operated'], ['elbow', 'Elbow']], o.scrub_tap || 'sensor', v => { o.scrub_tap = v; saveOpt(); })), btn('👁 Look at the scrub station', () => viewer?.focus?.('scrub')));
  if (K === 'ahu') {
    body.push(section('SHRM (WIESPL patent)', h('p', has('shrm') ? 'Included: humidity is controlled with recovered heat, so the electric heater bank is not needed.' : 'Not included: an electric heater bank re-heats the air (shown red inside the AHU).'),
      chips([[true, 'With SHRM'], [false, 'Without SHRM']], has('shrm'), v => { setFeature('shrm', v); viewer?.setShrm?.(v); })),
    section('Look inside', h('div.eq-part-acts', btn('💥 Take the AHU apart', () => viewer?.explode?.(true)), btn('Put it back', () => viewer?.explode?.(false)))));
  }

  // explainer video(s)
  const vids = [...new Set([P.video, K === 'ahu' ? 'shrm' : null, K === 'ahu' ? 'ahu' : null].filter(Boolean))].filter(v => VIDEOS[v]);
  const vidBtns = vids.length ? h('div.eq-part-acts', vids.map(v => btn(`🎬 ${VIDEOS[v].title} · ${fmtSecs(videoSecs(v))}`, () => viewer?.explain?.(v)))) : null;

  box.append(...[head, gallery, h('p.eq-part-text', P.text), P.facts?.length ? h('ul.eq-part-facts', P.facts.map(x => h('li', x))) : null, vidBtns, ...body, plan ? h('div.eq-part-plan', plan) : null].filter(Boolean));
  return box;
}

function lightbox(h, pics, i, title) {
  const show = k => { i = (k + pics.length) % pics.length; img.src = `/api/public/part-photo/${pics[i].id}`; cap.textContent = pics[i].caption || title; };
  const img = h('img', { alt: title }), cap = h('div.cap');
  const wrap = h('div.eq-lightbox', { onclick: e => { if (e.target === wrap) wrap.remove(); } },
    h('button.x', { type: 'button', 'aria-label': 'Close', onclick: () => wrap.remove() }, '×'),
    pics.length > 1 ? h('button.prev', { type: 'button', 'aria-label': 'Previous photo', onclick: () => show(i - 1) }, '‹') : null, img,
    pics.length > 1 ? h('button.next', { type: 'button', 'aria-label': 'Next photo', onclick: () => show(i + 1) }, '›') : null, cap);
  document.body.append(wrap); show(i);
}
