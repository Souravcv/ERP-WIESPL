// Control Panels & OR App: a live 3D showcase of the panels (views/panels3d.js) above the five WIESPL versions side
// by side, what each app does, the fumigation sequence and the client demo — for sales to explain and print.
// Data in ../panels.js (shared with the forms and the product master).
import { h } from '../ui.js';
import { PANELS, FEATURE_GROUPS, FEATURE_NOTE, HARDWARE, valueText, SURGEON_APP, OR_APP, FUMIGATION_STEPS, FUMIGATION_SAFETY, DEMO_FLOW, REQUIREMENTS } from '../panels.js';
import { panelShowcase } from './panels3d.js';

const KEY = 'wiespl-panels-pick';
const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// numbers that count up when they come into view
function countUp(el, to, suffix = '') {
  if (still()) { el.textContent = to.toLocaleString('en-IN') + suffix; return; }
  const io = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return; io.disconnect();
    const t0 = performance.now();
    const tick = () => { const k = Math.min(1, (performance.now() - t0) / 1200), e = 1 - (1 - k) ** 3; el.textContent = Math.round(to * e).toLocaleString('en-IN') + suffix; if (k < 1) requestAnimationFrame(tick); };
    tick();
  });
  io.observe(el);
}
// cards lean towards the pointer
const tilt = el => {
  if (still()) return el;
  el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.transform = `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`; el.style.setProperty('--gx', `${(x + 0.5) * 100}%`); el.style.setProperty('--gy', `${(y + 0.5) * 100}%`); });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  return el;
};
const stagger = (els, step = 60) => els.map((el, i) => { if (el) el.style.animationDelay = `${i * step}ms`; return el; });

export async function panelsView(root) {
  let pick = null;
  try { pick = localStorage.getItem(KEY) || null; } catch { /* storage blocked */ }
  let tab = 'versions', show3d = null, fumBtn = null, stepEls = [];
  const verIdx = () => Math.max(0, PANELS.findIndex(p => p.key === pick));

  // ---------------------------------------------------------------- 3D stage
  const stage = h('div.pn3-stage', h('div.pn3-loading', h('span.pn3-spin'), 'Building the 3D panels…'));
  const verBar = h('div.pn3-vers');
  const chips = h('div.pn3-chips');
  const caption = h('div.pn3-cap');
  const appFor = () => (verIdx() >= 3 ? OR_APP : SURGEON_APP);
  function drawChips(active = 'home') {
    const mods = appFor().modules;
    chips.replaceChildren(...mods.map(([icon, name, text, scr]) => h('button.pn3-chip' + (scr === active ? '.on' : ''), { type: 'button', title: text, onclick: () => playScreen(scr, name, text) }, h('span', icon), name)));
  }
  function drawVers() {
    verBar.replaceChildren(...PANELS.map((p, i) => h('button.pn3-ver' + (verIdx() === i && pick ? '.on' : !pick && i === 0 ? '.on' : ''), { type: 'button', onclick: () => choose(p.key) }, h('b', `V${i + 1}`), h('span', p.short))));
  }
  function playScreen(scr, name, text) {
    show3d?.show(scr); drawChips(scr);
    caption.replaceChildren(h('b', name), h('span', text)); caption.classList.remove('pop'); void caption.offsetWidth; caption.classList.add('pop');
  }
  function choose(key) {
    pick = key; try { localStorage.setItem(KEY, key); } catch { /* ignore */ }
    show3d?.setVersion(verIdx()); show3d?.show('home'); drawVers(); drawChips('home');
    const p = PANELS[verIdx()]; caption.replaceChildren(h('b', `V${verIdx() + 1} · ${p.name}`), h('span', `${p.text} ${p.displays}.`)); caption.classList.remove('pop'); void caption.offsetWidth; caption.classList.add('pop');
    if (tab === 'versions') draw();
  }
  const hero = h('section.pn3',
    stage,
    h('div.pn3-top', verBar),
    h('div.pn3-side',
      h('button.pn3-btn', { type: 'button', onclick: () => show3d?.focus('overview'), title: 'See the whole wall' }, '👁 Overview'),
      h('button.pn3-btn', { type: 'button', onclick: () => show3d?.focus('inside') }, '🖥️ Inside panel'),
      h('button.pn3-btn', { type: 'button', onclick: () => show3d?.focus('outside') }, '🚪 Outside panel'),
      fumBtn = h('button.pn3-btn.danger', { type: 'button', onclick: () => playFum() }, '☢️ Play fumigation')),
    h('div.pn3-bottom', caption, chips),
    h('div.pn3-hint', 'Drag to look around · tap a screen to zoom in'));
  drawVers(); drawChips();
  caption.replaceChildren(h('b', 'Live panels'), h('span', 'Every screen is running: tap a module below to play it on the panel.'));

  function playFum() {
    if (!show3d) return;
    show3d.playFumigation(); fumBtn.disabled = true; fumBtn.textContent = '☢️ Running…';
    hero.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'center' });
  }
  const onStep = i => {
    stepEls.forEach((el, j) => { el.classList.toggle('on', j === i); el.classList.toggle('done', i >= 0 && j < i); });
    if (i >= 0) { const [t, d] = FUMIGATION_STEPS[Math.min(i, FUMIGATION_STEPS.length - 1)] || []; const label = ['Fumigation requested', 'Countdown: evacuate', 'Fumigation active', 'Defumigation', 'Night mode'][i]; caption.replaceChildren(h('b', `☢️ ${label}`), h('span', i === 4 ? 'Night mode until the next session.' : d || t)); }
    if (i === -1 && fumBtn) { fumBtn.disabled = false; fumBtn.textContent = '☢️ Play fumigation'; caption.replaceChildren(h('b', '✓ Room ready'), h('span', 'The sequence is done. Play it again any time.')); }
  };

  // ---------------------------------------------------------------- stats
  const stat = (n, suffix, label, icon) => { const num = h('b', '0'); countUp(num, n, suffix); return h('div.pn-stat', h('span.pn-stat-ico', icon), num, h('span', label)); };
  const stats = h('div.pn-stats', stagger([stat(5, '', 'panel versions', '🖥️'), stat(17, '', 'app screens', '📱'), stat(7, '', 'gases watched', '🫁'), stat(2200, '+', 'anatomy structures', '🫀'), stat(3, '', 'languages', '🌐')], 90));

  // ---------------------------------------------------------------- tabs
  const cell = (v, i, row) => { const td = h('td.pn-v' + (v === false ? '.no' : v === true || v === 'a' ? '.yes' : '.part') + (pick && PANELS[i].key === pick ? '.pick' : ''), valueText(v)); td.style.animationDelay = `${row * 18 + i * 30}ms`; return td; };
  const head = () => h('thead', h('tr', h('th', 'Feature'), PANELS.map(p => h('th.pn-col' + (pick === p.key ? '.pick' : ''), { onclick: () => choose(p.key), title: 'Show on the 3D panel' }, h('b', `V${PANELS.indexOf(p) + 1}`), h('small', p.short)))));
  const matrix = groups => { let row = 0; return h('div.table-wrap', h('table.data.pn-table', head(),
    h('tbody', groups.flatMap(([g, rows]) => [h('tr.pn-group', h('td', { colspan: 6 }, g)),
      ...rows.map(([name, hint, vals]) => { row++; return h('tr', h('td', h('b', name), hint ? h('small.pn-hint', hint) : null), vals.map((v, i) => cell(v, i, row))); })])))); };

  const versions = () => h('div.pn-cards', stagger(PANELS.map((p, i) => tilt(h('button.pn-card' + (pick === p.key ? '.on' : ''), { type: 'button', onclick: () => { choose(p.key); hero.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'center' }); } },
    h('span.pn-tag', `V${i + 1}`), h('b', p.name), h('span', p.text),
    h('span.pn-meta', `🖥️ ${p.displays}`), h('span.pn-meta', p.ahu ? '❄️ AHU control from the panel' : '— No AHU control'),
    h('span.pn-meta', `🏷️ Product code ${p.code}`), h('span.pn-go', 'See it in 3D →'))))));

  const appCard = app => h('div.card.pn-in', h('h2', app.title), h('p.muted', app.sub),
    h('div.pn-mods', stagger(app.modules.map(([icon, name, text, scr]) => tilt(h('button.pn-mod', { type: 'button', onclick: () => { if (app === OR_APP && verIdx() < 3) choose('v4'); else if (app === SURGEON_APP && verIdx() >= 3) choose('v1'); playScreen(scr, name, text); hero.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'center' }); } },
      h('span.pn-ico', icon), h('div', h('b', name), h('p', text), h('span.pn-go', '▶ Play on the panel'))))), 50)));

  const sections = {
    versions: () => stagger([
      h('div.card.pn-in', h('h2', 'The five standard versions'), h('p.muted', 'Tap a version to see it on the 3D panel. Each one is in the product master, so it can go into a quotation or BOQ with its full specification.'), versions()),
      h('div.card.pn-in', h('h2', 'Features by version'), h('p.muted', '✓ included · If fitted: shown when the sensor is installed · Optional: on request · — not included'), matrix(FEATURE_GROUPS), h('p.muted', { style: { marginTop: '8px' } }, FEATURE_NOTE)),
      h('div.card.pn-in', h('h2', 'Hardware by version'), matrix(HARDWARE)),
    ], 120),
    apps: () => stagger([appCard(SURGEON_APP), appCard(OR_APP)], 120),
    safety: () => {
      stepEls = FUMIGATION_STEPS.map(([t, d], i) => h('li.pn-fstep', h('span.pn-fnum', String(i + 1)), h('div', h('b', t), h('span', d))));
      return stagger([
        h('div.card.pn-in', h('div.pn-fhead', h('div', h('h2', 'Fumigation safety sequence'), h('p.muted', 'The outside panel checks the room controller every 5 seconds and shows the state to everyone at the door.')),
          h('button.btn.primary', { type: 'button', onclick: () => playFum() }, '▶ Play it on the 3D panels')),
        h('ol.pn-fsteps', stepEls), h('p.pn-safe', '🛡️ ', FUMIGATION_SAFETY)),
        h('div.card.pn-in', h('h2', 'What the site needs'), h('div.pn-reqs', stagger(REQUIREMENTS.map(([k, v]) => h('div.pn-req', h('b', k), h('span', v))), 60))),
      ], 120);
    },
    demo: () => stagger([
      h('div.card.pn-in', h('h2', '🎬 10-minute demo: Surgeon Control Panel'), h('ol.pn-demo', stagger(DEMO_FLOW.surgeon.map(s => h('li', s)), 70))),
      h('div.card.pn-in', h('h2', '🎬 10-minute demo: Digital OR (OR Panel)'), h('ol.pn-demo', stagger(DEMO_FLOW.or.map(s => h('li', s)), 70)), h('p.pn-safe', '💡 ', DEMO_FLOW.tip)),
    ], 120),
  };
  const TABS = [['versions', '🖥️ Versions & features'], ['apps', '📱 What the apps do'], ['safety', '🛡️ Fumigation & site needs'], ['demo', '🎬 Client demo']];

  const body = h('div');
  const tabs = h('div.tabs.pn-tabs');
  function draw() {
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button' + (tab === k ? '.active' : ''), { type: 'button', onclick: () => { tab = k; draw(); } }, l)));
    body.replaceChildren(...sections[tab]());
  }
  const print = () => {
    const pr = document.getElementById('print-root');
    const keep = tab; const all = [];
    for (const k of Object.keys(sections)) { tab = k; all.push(...sections[k]()); }
    tab = keep;
    pr.replaceChildren(h('div.doc.pn-print', h('div.page',
      h('div.pn-phead', h('img', { src: 'logo.jpeg', alt: 'WIESPL', style: { height: '42px' } }), h('div', h('b', 'WIESPL Control Panel Range'), h('span', 'Surgeon Panel · IVF Lab · Digital OR'))), ...all)));
    pr.classList.remove('hidden');
    const done = () => { pr.classList.add('hidden'); pr.replaceChildren(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  };
  draw();
  root.replaceChildren(
    h('div.page-head', h('h1', '🖥️ Control Panels & OR App'), h('span.muted', 'Surgeon Panel · IVF Lab · Digital OR'),
      h('div.actions', h('button.btn', { type: 'button', onclick: print }, '🖨️ Print / PDF for the client'))),
    hero, stats, tabs, body);

  show3d = await panelShowcase(stage, { onStep });
  if (pick) show3d.setVersion(verIdx());
}
