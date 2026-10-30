// 3D showcase for the Control Panels page: an OT wall with the inside (surgeon / OR) panel, the hermetic door and the
// outside 10" panel. Both screens are live: drawn on a canvas every frame (clock, values, music, gases, recording …)
// and used as textures. Tapping a module plays that screen; the fumigation sequence plays on both panels.
// three.js r128 from jsDelivr (same as the OT 3D); without WebGL the inside screen is shown flat, still animated.

import { buildSurgery, OR_STORY } from './orsurgery3d.js';
export { OR_STORY };

const CDN = ['https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'];
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('3D library did not load')); document.head.append(s); });
let loading = null;
function loadThree() {
  if (window.THREE?.OrbitControls) return Promise.resolve();
  loading ||= (async () => { if (!window.THREE) await loadScript(CDN[0]); await loadScript(CDN[1]); })().catch(e => { loading = null; throw e; });
  return loading;
}

// ---------------------------------------------------------------- the screens (2D canvas)
const FONT = '"Segoe UI", system-ui, sans-serif';
const C = { bg0: '#06101c', bg1: '#0e2340', tile: '#11284a', line: '#25476f', text: '#eef4ff', dim: '#8ea7c7', blue: '#3b82f6', green: '#34c759', amber: '#f5a524', red: '#ef4444', cyan: '#22d3ee', yellow: '#facc15' };
const fmt = s => `${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function painter(canvas) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const rr = (x, y, w, h, r, fill, stroke, lw = 2) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  const tx = (s, x, y, size, color = C.text, weight = 600, align = 'left') => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y); };
  const dot = (x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const pill = (x, y, label, color, align = 'left') => { ctx.font = `600 17px ${FONT}`; const w = ctx.measureText(label).width + 40; const X = align === 'right' ? x - w : x; rr(X, y, w, 32, 16, color + '22', color + '88', 1.5); dot(X + 16, y + 16, 5, color); tx(label, X + 28, y + 22, 17, color, 600); return w; };
  return { ctx, W, H, rr, tx, dot, pill };
}

function frame(P, title, sub) {
  const { ctx, W, H } = P;
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  P.tx('W', 36, 62, 40, C.blue, 900); P.tx('IESPL', 70, 62, 30, C.green, 800);
  P.tx(title, 190, 56, 26, C.text, 600); if (sub) P.tx(sub, 190, 82, 16, C.dim, 500);
  const d = new Date();
  P.tx(d.toLocaleTimeString('en-GB'), W - 36, 58, 30, C.text, 700, 'right');
  P.tx(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), W - 36, 84, 16, C.dim, 500, 'right');
}

function home(P, t, S) {
  const { ctx, W, H } = P, or = S.ver >= 3, ivf = S.ver === 2, ahu = [0, 2, 3].includes(S.ver);
  frame(P, or ? 'Digital OR' : ivf ? 'IVF Lab Control Panel' : 'Surgeon Control Panel', `OT 1 · ${['Surgeon Panel with AHU', 'Surgeon Panel', 'IVF Lab with AHU', 'OR Panel with AHU', 'OR Panel'][S.ver]}`);
  let x = 36; x += P.pill(x, 98, 'HEPA Healthy', C.green) + 10; x += P.pill(x, 98, 'Connected', C.cyan) + 10; if (ahu) P.pill(x, 98, 'System ON', C.green);
  const lights = [0, 1, 2, 3].filter(i => ((t * 0.6 + i * 0.7) % 5) < 3.6).length;
  const tiles = [
    ['🌡️', 'Temperature', `${(21 + 0.3 * Math.sin(t * 0.4)).toFixed(1)}°C`, C.amber, ahu ? 'Set 21.0' : 'Display'],
    ['💧', 'Humidity', `${Math.round(52 + 2 * Math.sin(t * 0.3))}%`, C.cyan, ahu ? 'Set 50 %' : 'Display'],
    ['💡', 'Lighting', `${lights}/4 on`, C.yellow, 'All lights'],
    ['⏱️', 'Stopwatch', fmt(t + 754), C.text, 'Surgery timer'],
    ['🎵', 'Music', 'Playing', C.green, 'Gayatri Mantra'],
    ivf ? ['🧪', 'VOC', `${Math.round(38 + 4 * Math.sin(t * 0.5))} ppb`, C.green, 'Air quality OK'] : ['🫁', 'MGPS', '7/7 FULL', C.green, 'All gases'],
    ['🧽', 'Clean', 'Protocol', C.blue, '11 steps'],
    or ? ['🏥', 'OR MODE', '7 modules', C.blue, 'Recording · PI · DICOM'] : ['🩻', 'DICOM', 'Viewer', C.blue, 'CT · MRI · X-ray'],
  ];
  const gx = 36, gy = 150, gap = 18, w = (W - 72 - gap * 3) / 4, h = (H - gy - 30 - gap) / 2, lit = Math.floor(t * 0.8) % 8;
  tiles.forEach(([icon, label, value, color, small], i) => {
    const X = gx + (i % 4) * (w + gap), Y = gy + Math.floor(i / 4) * (h + gap);
    const g = ctx.createLinearGradient(X, Y, X, Y + h); g.addColorStop(0, '#163259'); g.addColorStop(1, C.tile);
    P.rr(X, Y, w, h, 22, g, i === lit ? C.blue : C.line, i === lit ? 3 : 1.5);
    P.tx(icon, X + 24, Y + 60, 40, C.text, 400); P.tx(label, X + 24, Y + 100, 21, C.dim, 600);
    P.tx(value, X + 24, Y + 150, 38, color, 800); P.tx(small, X + 24, Y + 182, 16, C.dim, 500);
    if (label === 'Music') for (let b = 0; b < 12; b++) { const bh = 10 + 26 * Math.abs(Math.sin(t * 3 + b * 0.9)); P.rr(X + w - 140 + b * 10, Y + h - 24 - bh, 6, bh, 3, C.green); }
    if (label === 'Lighting') for (let b = 0; b < 4; b++) P.dot(X + w - 120 + b * 28, Y + 52, 9, ((t * 0.6 + b * 0.7) % 5) < 3.6 ? C.yellow : '#334');
    if (label === 'Stopwatch') { ctx.beginPath(); ctx.arc(X + w - 50, Y + 52, 22, -Math.PI / 2, -Math.PI / 2 + ((t % 60) / 60) * Math.PI * 2); ctx.strokeStyle = C.blue; ctx.lineWidth = 5; ctx.stroke(); }
  });
}

function gauge(P, cx, cy, r, value, min, max, color, label, unit, setTo) {
  const { ctx } = P, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, f = (value - min) / (max - min);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.strokeStyle = '#1d3a60'; ctx.lineWidth = 26; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * f); ctx.strokeStyle = color; ctx.lineWidth = 26; ctx.stroke();
  const a = a0 + (a1 - a0) * f; P.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 20, '#fff');
  ctx.lineCap = 'butt';
  P.tx(label, cx, cy - 40, 22, C.dim, 600, 'center'); P.tx(`${value.toFixed(1)}${unit}`, cx, cy + 22, 64, C.text, 800, 'center');
  P.tx(`Set-point ${setTo}${unit}`, cx, cy + 62, 20, color, 600, 'center');
  P.tx(`${min}${unit}`, cx - r + 10, cy + r - 6, 18, C.dim, 500, 'center'); P.tx(`${max}${unit}`, cx + r - 10, cy + r - 6, 18, C.dim, 500, 'center');
}
function climate(P, t, S) {
  frame(P, 'Temperature & humidity', 'Set-points go to the AHU through the room controller');
  const k = ease(Math.min(1, (t - S.since) / 2.2)), w = P.W;
  gauge(P, w * 0.28, 400, 190, 19 + (22 - 19) * k, 16, 24, C.amber, 'TEMPERATURE', '°C', 22);
  gauge(P, w * 0.72, 400, 190, 47 + (50 - 47) * k, 45, 55, C.cyan, 'HUMIDITY', '%', 50);
  const p = 0.6 + 0.4 * Math.sin(t * 4);
  P.rr(w / 2 - 170, 630, 340, 60, 30, `rgba(59,130,246,${p})`); P.tx(k < 1 ? 'Sending to the AHU…' : '✓ Set-point confirmed', w / 2, 669, 24, '#fff', 700, 'center');
}
function lightsScreen(P, t) {
  frame(P, 'Light control', 'Four theatre lighting zones and All Lights');
  const { ctx, W } = P;
  for (let i = 0; i < 4; i++) {
    const on = ((t * 0.6 + i * 0.7) % 5) < 3.6, cx = 200 + i * 290, cy = 360;
    if (on) { const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 160); g.addColorStop(0, 'rgba(250,204,21,.55)'); g.addColorStop(1, 'rgba(250,204,21,0)'); ctx.fillStyle = g; ctx.fillRect(cx - 160, cy - 160, 320, 320); }
    P.dot(cx, cy, 70, on ? C.yellow : '#1d3456'); P.tx('💡', cx, cy + 22, 60, C.text, 400, 'center');
    P.tx(`Light ${i + 1}`, cx, cy + 130, 26, C.text, 700, 'center');
    P.rr(cx - 50, cy + 150, 100, 44, 22, on ? C.green : '#2b3f5c'); P.dot(on ? cx + 28 : cx - 28, cy + 172, 17, '#fff');
  }
  P.rr(W / 2 - 160, 640, 320, 56, 28, C.blue); P.tx('ALL LIGHTS', W / 2, 677, 24, '#fff', 800, 'center');
}
function timer(P, t, S) {
  frame(P, 'Surgery stopwatch', 'Start / Pause · Lap · Reset');
  const { ctx, W } = P, s = t - S.since + 1834;
  ctx.beginPath(); ctx.arc(W / 2, 360, 210, 0, Math.PI * 2); ctx.strokeStyle = '#1d3a60'; ctx.lineWidth = 16; ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, 360, 210, -Math.PI / 2, -Math.PI / 2 + ((s % 60) / 60) * Math.PI * 2); ctx.strokeStyle = C.blue; ctx.lineWidth = 16; ctx.stroke();
  P.tx(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${fmt(s)}`, W / 2, 380, 92, C.text, 800, 'center');
  P.tx(`.${String(Math.floor((s % 1) * 100)).padStart(2, '0')}`, W / 2, 440, 40, C.dim, 600, 'center');
  const laps = Math.min(5, Math.floor((t - S.since) / 2.5));
  P.tx('LAPS', 1000, 180, 20, C.dim, 700);
  for (let i = 0; i < laps; i++) P.tx(`Lap ${laps - i}   ${fmt(1834 + (laps - i) * 2.5)}`, 1000, 220 + i * 40, 22, i ? C.dim : C.green, 600);
  ['RESET', 'PAUSE', 'LAP'].forEach((b, i) => { P.rr(W / 2 - 300 + i * 210, 610, 180, 60, 30, i === 1 ? C.blue : '#1d3a60'); P.tx(b, W / 2 - 210 + i * 210, 649, 22, '#fff', 700, 'center'); });
}
function music(P, t) {
  frame(P, 'Music', 'Built-in tracks and songs from the tablet');
  const { ctx, W } = P, cx = 330, cy = 400;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.8);
  P.dot(0, 0, 200, '#0b0f17'); for (let r = 80; r < 200; r += 14) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2; ctx.stroke(); }
  const g = ctx.createLinearGradient(-70, -70, 70, 70); g.addColorStop(0, C.amber); g.addColorStop(1, C.red); ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  P.tx('ॐ', 0, 22, 60, '#fff', 700, 'center'); ctx.restore();
  P.tx('Gayatri Mantra', 640, 300, 48, C.text, 800); P.tx('Default track · plays in the background', 640, 340, 22, C.dim, 500);
  const p = ((t * 0.02) % 1); P.rr(640, 390, 520, 10, 5, '#1d3a60'); P.rr(640, 390, 520 * p, 10, 5, C.green); P.dot(640 + 520 * p, 395, 12, '#fff');
  for (let b = 0; b < 26; b++) { const bh = 14 + 90 * Math.abs(Math.sin(t * 2.6 + b * 0.55) * Math.cos(t * 1.3 + b * 0.2)); P.rr(640 + b * 20, 600 - bh, 12, bh, 6, b % 3 ? C.green : C.cyan); }
  ['⏮', '⏸', '⏭', '🔁'].forEach((s, i) => { P.dot(690 + i * 110, 680, 34, i === 1 ? C.blue : '#1d3a60'); P.tx(s, 690 + i * 110, 693, 30, '#fff', 400, 'center'); });
  if (W) { /* keep W used */ }
}
const GASES = ['Oxygen', 'Vacuum', 'N₂O', 'AGSS', 'Air 4 bar', 'Air 7 bar', 'CO₂'];
function mgps(P, t, S) {
  frame(P, 'MGPS · medical gases', 'Live from the room controller’s gas sensors');
  const { W } = P, cyc = (t - S.since) % 10, empty = cyc > 5 && cyc < 8.5, blink = Math.floor(t * 4) % 2;
  GASES.forEach((g, i) => {
    const y = 120 + i * 76, bad = empty && i === 0;
    P.rr(60, y, W - 120, 62, 16, bad ? (blink ? '#5a1414' : '#3a0f12') : C.tile, bad ? C.red : C.line, bad ? 3 : 1.5);
    P.tx('🫁', 90, y + 44, 30, C.text, 400); P.tx(g, 150, y + 42, 26, C.text, 700);
    P.rr(420, y + 24, 520, 14, 7, '#1d3a60'); P.rr(420, y + 24, bad ? 30 : 470 + 30 * Math.sin(t + i), 14, 7, bad ? C.red : C.green);
    P.rr(W - 230, y + 14, 140, 36, 18, bad ? C.red : C.green); P.tx(bad ? 'EMPTY' : 'FULL', W - 160, y + 40, 20, '#fff', 800, 'center');
  });
  if (empty) { P.rr(W / 2 - 260, 660, 520, 50, 25, C.red); P.tx('🔊  Voice alarm: “Oxygen”', W / 2, 694, 24, '#fff', 800, 'center'); }
}
const STEPS = ['Remove soiled linen / waste', 'Disinfect high-touch surfaces', 'Door knobs and switches', 'Sweep & mop floor', 'Anaesthesia machine / carts', 'Monitors / IV poles', 'Positioners, arm boards', 'Change bin liners', 'Hand hygiene', 'Ventilate room', 'Final walkthrough'];
function clean(P, t, S) {
  frame(P, 'Clean protocol', 'Disinfectant and a photo for every step');
  const { W } = P, done = S.fum ? 11 : Math.min(11, Math.floor((t - S.since) * 1.6));
  STEPS.forEach((s, i) => {
    const col = i < 6 ? 0 : 1, y = 130 + (i % 6) * 84, x = 50 + col * (W / 2 - 20), ok = i < done;
    P.rr(x, y, W / 2 - 70, 70, 16, ok ? '#123a2a' : C.tile, ok ? C.green : C.line, 1.5);
    P.dot(x + 38, y + 35, 20, ok ? C.green : '#2b3f5c'); if (ok) P.tx('✓', x + 38, y + 44, 24, '#fff', 800, 'center');
    P.tx(`${i + 1}. ${s}`, x + 74, y + 43, 21, C.text, 600); P.tx(ok ? '📷' : '', x + W / 2 - 120, y + 46, 26, C.text, 400);
  });
  P.rr(50, 640, W - 100, 14, 7, '#1d3a60'); P.rr(50, 640, (W - 100) * done / 11, 14, 7, C.green);
  P.tx(done === 11 ? (S.fum ? 'Report submitted · fumigation requested' : 'All 11 done · Submit → UV fumigation') : `${done} / 11 completed`, 50, 695, 24, done === 11 ? C.green : C.dim, 700);
}
function dicom(P, t) {
  const { ctx, W, H } = P;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const n = Math.floor(t * 8) % 48, k = Math.sin((n / 48) * Math.PI), cx = 560, cy = 380;
  ctx.save(); ctx.filter = 'blur(1.5px)';
  ctx.beginPath(); ctx.ellipse(cx, cy, 330, 250, 0, 0, Math.PI * 2); ctx.fillStyle = '#5d5d5d'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy, 300, 222, 0, 0, Math.PI * 2); ctx.fillStyle = '#7b7b7b'; ctx.fill();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * 140, cy - 10, 95 + 25 * k, 150 + 30 * k, s * 0.15, 0, Math.PI * 2); ctx.fillStyle = '#121212'; ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(cx + 30, cy + 20, 70 * (1 - k * 0.4) + 20, 60, 0.4, 0, Math.PI * 2); ctx.fillStyle = '#9a9a9a'; ctx.fill();
  P.dot(cx, cy + 175, 34, '#e9e9e9'); P.dot(cx, cy + 175, 14, '#555');
  for (let i = -5; i <= 5; i++) { if (!i) continue; ctx.beginPath(); ctx.ellipse(cx + i * 58, cy + 40 - Math.abs(i) * 6, 8, 70 - Math.abs(i) * 4, i * 0.25, 0, Math.PI * 2); ctx.fillStyle = 'rgba(230,230,230,.6)'; ctx.fill(); }
  ctx.restore();
  P.tx('WIESPL DICOM', 30, 46, 24, C.cyan, 800); P.tx('CT CHEST · Demo study', 30, 76, 18, '#ccc', 500);
  P.tx(`Slice ${n + 1} / 48`, W - 30, 46, 22, '#fff', 700, 'right'); P.tx('W 1500  L -600 · Cine 10 fps', W - 30, 76, 18, '#ccc', 500, 'right');
  P.rr(1000, 140, 240, 470, 16, 'rgba(20,30,45,.85)');
  ['Window / level', 'Zoom · Fit', 'Rotate · Flip', 'Invert', 'Grid · Crosshair', 'Metadata'].forEach((s, i) => P.tx(s, 1024, 190 + i * 70, 20, i === 0 ? C.cyan : '#ddd', 600));
  P.rr(30, H - 50, 940, 10, 5, '#333'); P.rr(30, H - 50, 940 * (n + 1) / 48, 10, 5, C.cyan);
}
// ---------------------------------------------------------------- real surgical videos (data/media/or, login only)
let videoList = null;
export function orVideos() {
  videoList ||= fetch('api/media/or').then(r => (r.ok ? r.json() : [])).catch(() => []).then(names => names.slice(0, 4).map(n => {
    const v = Object.assign(document.createElement('video'), { src: `api/media/or/${encodeURIComponent(n)}`, muted: true, loop: true, playsInline: true, preload: 'auto' });
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.addEventListener('loadedmetadata', () => { try { v.currentTime = Math.min(30, v.duration * 0.2); } catch { /* ignore */ } }, { once: true });
    return v;
  }));
  return videoList;
}
const ready = v => v && v.readyState >= 2 && v.videoWidth;
function cover(ctx, v, x, y, w, h) { const s = Math.max(w / v.videoWidth, h / v.videoHeight), sw = w / s, sh = h / s; ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, x, y, w, h); }

function feed(P, x, y, w, h, t, kind, video) {
  const { ctx } = P;
  ctx.save(); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 14); else ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2;
  if (kind !== 'vitals' && ready(video)) { cover(ctx, video, x, y, w, h); ctx.restore(); return; }
  if (kind === 'endo') {
    const g = ctx.createRadialGradient(cx + 30 * Math.sin(t), cy + 20 * Math.cos(t * 0.7), 10, cx, cy, h * 0.48); g.addColorStop(0, '#ffd2c4'); g.addColorStop(0.45, '#d4655a'); g.addColorStop(0.85, '#5a1414'); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, h * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x + w * 0.85, y + h * 0.15); ctx.lineTo(cx + 40 * Math.sin(t * 1.3), cy + 10); ctx.stroke();
  } else if (kind === 'surg') {
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#2c6e74'); g.addColorStop(1, '#0f3a40'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e8b4a4'; ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.18, h * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7fb3d5'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * (w * 0.25 + 10 * Math.sin(t * 2 + s)), cy + 20, 26, 46, s * 0.6, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'over') {
    ctx.fillStyle = '#16404a'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#2f7d8c'; ctx.fillRect(x + w * 0.2, y + h * 0.15, w * 0.6, h * 0.7);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#6aa6d8'; ctx.beginPath(); ctx.arc(x + w * (0.2 + i * 0.2) + 8 * Math.sin(t + i), y + (i % 2 ? h * 0.12 : h * 0.88), 22, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = '#04110b'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = C.green; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i <= w; i += 4) { const p = ((i / w) * 3 + t * 0.9) % 1; const v = p > 0.42 && p < 0.47 ? -h * 0.32 * Math.sin((p - 0.42) / 0.05 * Math.PI) : 6 * Math.sin(p * 30); ctx.lineTo(x + i, y + h * 0.4 + v); }
    ctx.stroke(); P.tx(`HR ${Math.round(74 + 3 * Math.sin(t * 0.5))}`, x + 20, y + h - 60, 28, C.green, 800); P.tx('SpO₂ 98 %', x + 20, y + h - 22, 24, C.cyan, 700);
  }
  ctx.restore();
}
// OR Screen layouts: full · quad (4 equal) · pip (picture in picture) · side (side by side) · report (live + CT) · conf (video conference)
const SOURCES = [['endo', 'Endo Cam · 4K'], ['surg', 'Surgical Cam · 1080p'], ['over', 'Overhead'], ['lap', 'Laparoscope'], ['vitals', 'Vitals / X-ray']];
const LAYOUT_NAME = { full: 'Full screen', quad: '4 equal screens', pip: 'Picture in picture', side: 'Side by side', report: 'Live + report', conf: 'Video conference' };
function ctSlice(P, x, y, w, h, t) {
  const { ctx } = P, k = Math.sin(((Math.floor(t * 8) % 48) / 48) * Math.PI), cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) / 560;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.ellipse(cx, cy, 250 * s, 190 * s, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b6b6b'; ctx.fill();
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + d * 105 * s, cy - 8 * s, (72 + 18 * k) * s, (112 + 22 * k) * s, d * 0.15, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); }
  P.dot(cx, cy + 130 * s, 26 * s, '#eee'); ctx.restore();
  P.tx('CT CHEST · Patient 1042', x + 16, y + 34, 18, C.cyan, 700); P.tx(`Slice ${Math.floor(t * 8) % 48 + 1} / 48`, x + 16, y + h - 18, 16, '#ccc', 600);
}
function label(P, x, y, l) { P.rr(x + 12, y + 12, P.ctx.measureText(l).width + 40, 30, 15, 'rgba(0,0,0,.6)'); P.tx(l, x + 24, y + 33, 17, '#fff', 600); }
export function orscreen(P, t, S) {
  const L = S.layout || 'quad', vids = S.videos || [], { W, H, ctx } = P;
  frame(P, `OR Screen · ${LAYOUT_NAME[L]}`, 'Patient 1042 · Lap. cholecystectomy · Dr. surgeon · OT 1');
  const src = (i, x, y, w, h) => { const [k, l] = SOURCES[i]; feed(P, x, y, w, h, t + i, k, vids[i]); ctx.font = `600 17px ${FONT}`; label(P, x, y, l); };
  const X = 24, Y = 104, w = W - 48, h = H - 124;
  if (L === 'full') { src(0, X, Y, w, h); src(4, X + w - 330, Y + h - 190, 310, 170); }
  else if (L === 'quad') { const ww = (w - 16) / 2, hh = (h - 16) / 2; [0, 1, 2, 4].forEach((s, i) => src(s, X + (i % 2) * (ww + 16), Y + Math.floor(i / 2) * (hh + 16), ww, hh)); }
  else if (L === 'pip') { src(0, X, Y, w, h); P.rr(X + w - 432, Y + 18, 414, 240, 16, null, '#fff', 4); src(1, X + w - 430, Y + 20, 410, 236); src(4, X + w - 430, Y + h - 200, 410, 180); }
  else if (L === 'side') { const ww = (w - 16) / 2; src(0, X, Y, ww, h); src(3, X + ww + 16, Y, ww, h); }
  else if (L === 'report') { const ww = w * 0.6; src(0, X, Y, ww, h); ctSlice(P, X + ww + 16, Y, w - ww - 16, h * 0.62, t); P.rr(X + ww + 16, Y + h * 0.62 + 14, w - ww - 16, h * 0.38 - 14, 14, C.tile); P.tx('📄 Pre-op report', X + ww + 36, Y + h * 0.62 + 56, 20, C.text, 700); P.tx('Gallbladder · calculi', X + ww + 36, Y + h * 0.62 + 92, 18, C.dim, 500); P.tx('Hb 13.2 · fit for GA', X + ww + 36, Y + h * 0.62 + 122, 18, C.dim, 500); }
  else if (L === 'conf') { const ww = w * 0.7; src(0, X, Y, ww, h); P.rr(X + 14, Y + 50, 96, 30, 15, C.red); P.tx('● LIVE', X + 62, Y + 72, 16, '#fff', 800, 'center');
    ['Dr. Mentor', 'Students (12)', 'Family'].forEach((n, i) => { const yy = Y + i * (h / 3); P.rr(X + ww + 16, yy, w - ww - 16, h / 3 - 12, 14, C.tile, Math.floor(t / 2) % 3 === i ? C.green : C.line, 3); P.dot(X + ww + 70, yy + h / 6 - 6, 34, ['#6366f1', '#0ea5e9', '#f97316'][i]); P.tx(n, X + ww + 116, yy + h / 6, 20, C.text, 600); }); }
  const rec = S.rec !== false;
  if (rec) { if (Math.floor(t * 2) % 2) P.dot(W - 330, 104 + 26, 9, C.red); P.rr(W - 350, 108, 300, 40, 20, 'rgba(0,0,0,.6)'); P.tx(`REC ${fmt(t + 1260)} · ${S.big ? '4K' : '1080p'}`, W - 316, 136, 19, C.red, 800); }
  if (S.big) { P.rr(X + 20, H - 92, 560, 60, 30, 'rgba(0,0,0,.7)', C.red, 2); P.tx('💾 Saving to Patient 1042 / 2026-10-30 · USB + server', X + 44, H - 54, 19, '#fff', 700); }
}
function pi(P, t) {
  frame(P, 'PI · patient information', "Today's patients for OT 1");
  const { W } = P, pick = Math.floor(t / 1.5) % 6;
  [['Patient 1042', 'Cataract · Right eye', '09:00'], ['Patient 1043', 'Knee replacement', '10:30'], ['Patient 1047', 'Lap. cholecystectomy', '12:00'], ['Patient 1051', 'Spine fixation', '13:30'], ['Patient 1055', 'Hernia repair', '15:00'], ['Patient 1058', 'Thyroidectomy', '16:30']].forEach(([n, p, time], i) => {
    const x = 40 + (i % 3) * ((W - 80) / 3), y = 130 + Math.floor(i / 3) * 280, w = (W - 80) / 3 - 24, on = i === pick;
    P.rr(x, y, w, 250, 20, on ? '#173d6b' : C.tile, on ? C.blue : C.line, on ? 3 : 1.5);
    P.dot(x + 60, y + 70, 36, ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'][i]); P.tx(n.slice(-2), x + 60, y + 80, 26, '#fff', 800, 'center');
    P.tx(n, x + 112, y + 64, 24, C.text, 700); P.tx(`MRD ${n.slice(-4)}`, x + 112, y + 92, 18, C.dim, 500);
    P.tx(p, x + 28, y + 150, 21, C.text, 600); P.tx(`🕘 ${time}`, x + 28, y + 186, 20, C.dim, 500); P.tx('📄 3 reports · 🩻 1 study', x + 28, y + 220, 18, C.cyan, 500);
  });
}
function store(P, t) {
  frame(P, 'Store · hospital inventory', 'Order consumables for this OT');
  const { W } = P;
  [['Surgical gloves 7.5', 0.82], ['Sterile drapes', 0.64], ['Sutures 3-0', 0.18], ['Gauze swabs', 0.71], ['IV cannula 20G', 0.09], ['Syringes 10 ml', 0.55]].forEach(([n, f], i) => {
    const y = 130 + i * 78, c = f < 0.12 ? C.red : f < 0.25 ? C.amber : C.green;
    P.rr(50, y, W - 100, 64, 16, C.tile, C.line, 1.5); P.tx(n, 80, y + 41, 23, C.text, 600);
    P.rr(480, y + 26, 460, 12, 6, '#1d3a60'); P.rr(480, y + 26, 460 * f, 12, 6, c);
    P.tx(f < 0.12 ? 'Out of stock' : f < 0.25 ? 'Low stock' : 'In stock', W - 80, y + 41, 19, c, 700, 'right');
  });
  const k = Math.min(1, ((t % 6) - 2) / 0.5);
  if (k > 0) { P.rr(W - 470, 640 + (1 - k) * 80, 420, 60, 30, C.blue); P.tx('✓ Order placed · High priority', W - 260, 678 + (1 - k) * 80, 21, '#fff', 700, 'center'); }
}
function video(P, t, S) {
  frame(P, 'Video conference', 'Surgery Room 1 · 4 participants');
  const { W, H } = P;
  feed(P, 30, 110, 800, 480, t, 'endo', S?.videos?.[0]); P.rr(46, 126, 110, 32, 16, C.red); P.tx('● LIVE', 101, 149, 18, '#fff', 800, 'center');
  ['Dr. Mentor', 'Student', 'Family'].forEach((n, i) => {
    const y = 110 + i * 162, talk = Math.floor(t / 2) % 3 === i;
    P.rr(850, y, 400, 146, 16, C.tile, talk ? C.green : C.line, talk ? 4 : 1.5); P.dot(930, y + 73, 42, ['#6366f1', '#0ea5e9', '#f97316'][i]);
    P.tx(n[0] + (n.split(' ')[1]?.[0] || ''), 930, y + 84, 28, '#fff', 800, 'center'); P.tx(n, 990, y + 80, 22, C.text, 600);
  });
  ['🎤', '📷', '🖥️', '💬', '📞'].forEach((s, i) => { P.dot(380 + i * 90, H - 60, 32, i === 4 ? C.red : '#1d3a60'); P.tx(s, 380 + i * 90, H - 50, 26, '#fff', 400, 'center'); });
}
function anatomy(P, t) {
  const { ctx, W, H } = P;
  const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 700); g.addColorStop(0, '#16324f'); g.addColorStop(1, '#050b14'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  P.tx('Anatomy · 3D atlas', 30, 50, 26, C.text, 700); P.tx('2,200+ structures · offline', 30, 80, 18, C.dim, 500);
  const sx = Math.cos(t * 0.6), cx = 520;
  ctx.save(); ctx.translate(cx, 370); ctx.scale(0.35 + 0.65 * Math.abs(sx), 1);
  ctx.fillStyle = 'rgba(140,190,255,.16)'; ctx.strokeStyle = 'rgba(160,210,255,.6)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, -250, 52, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-110, -185, 220, 300, 60); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 34; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(140,190,255,.18)';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 120, -160); ctx.lineTo(s * 165, 40); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s * 55, 110); ctx.lineTo(s * 70, 320); ctx.stroke(); }
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(235,240,255,.55)';
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(0, -140 + i * 22, 85 - i * 3, 9, 0, 0, Math.PI); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, -195); ctx.lineTo(0, 110); ctx.stroke();
  const beat = 1 + 0.12 * Math.max(0, Math.sin(t * 7)) ** 8;
  ctx.save(); ctx.translate(18, -70); ctx.scale(beat, beat); ctx.fillStyle = '#ef4444'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 30;
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.bezierCurveTo(-55, -10, -30, -55, 0, -28); ctx.bezierCurveTo(30, -55, 55, -10, 0, 30); ctx.fill(); ctx.restore();
  ctx.restore();
  ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 30, 300); ctx.lineTo(820, 230); ctx.stroke();
  P.rr(820, 170, 400, 200, 18, 'rgba(15,30,50,.9)', C.red, 2);
  P.tx('Heart', 850, 220, 34, C.text, 800); P.tx('Cor · Cardiovascular system', 850, 256, 20, C.dim, 500);
  P.tx('Region: thorax', 850, 296, 20, C.text, 500); P.tx('Focus · Hide · Study · Quiz', 850, 336, 19, C.cyan, 600);
}
function locked(P, t, S) {
  const { W, H } = P, blink = Math.floor(t * 3) % 2;
  P.ctx.fillStyle = blink ? '#4a0d0d' : '#2a0707'; P.ctx.fillRect(0, 0, W, H);
  P.tx('⚠', W / 2, 250, 120, C.red, 400, 'center');
  P.tx(S.fum === 'countdown' ? 'Please vacate the operating theatre' : 'UV fumigation running', W / 2, 360, 46, '#fff', 800, 'center');
  P.tx(S.fum === 'countdown' ? `Starting in ${fmt(Math.ceil(S.fumLeft))}` : `Do not enter · ${fmt(Math.ceil(S.fumLeft))} left`, W / 2, 430, 32, '#ffb4b4', 600, 'center');
  P.tx('Screen locked while fumigation runs', W / 2, 600, 22, '#ffb4b4', 500, 'center');
}
const SCREENS = { home, climate, lights: lightsScreen, timer, music, mgps, clean, dicom, orscreen, pi, store, video, anatomy, outside: home };

function drawInside(P, t, S) {
  if (S.fum === 'countdown' || S.fum === 'active') return locked(P, t, S);
  if (S.fum === 'requested') return clean(P, t, S);
  (SCREENS[S.screen] || home)(P, t, S);
  if (S.fum === 'night') { P.ctx.fillStyle = 'rgba(0,0,10,.55)'; P.ctx.fillRect(0, 0, P.W, P.H); }
  const on = t - S.since; // power-on line when a screen changes
  if (on < 0.35) { const k = on / 0.35; P.ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - k)})`; P.ctx.fillRect(0, 0, P.W, P.H); }
}
function drawOutside(P, t, S) {
  const { ctx, W, H } = P, ahu = [0, 2, 3].includes(S.ver), f = S.fum, blink = Math.floor(t * 3) % 2;
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, f === 'night' ? '#050a12' : C.bg1); g.addColorStop(1, C.bg0); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  P.tx('OT 1 · Status Monitor', 26, 46, 26, C.text, 700); P.tx(new Date().toLocaleTimeString('en-GB'), W - 26, 46, 26, C.text, 700, 'right');
  const pa = 6.4 + 0.5 * Math.sin(t * 0.7);
  [['Temp', `${(21 + 0.3 * Math.sin(t * 0.4)).toFixed(1)}°C`, C.amber], ['R/H', `${Math.round(52 + 2 * Math.sin(t * 0.3))}%`, C.cyan], ['Pressure', `${pa.toFixed(1)} Pa`, C.green]].forEach(([l, v, c], i) => {
    const x = 26 + i * 254; P.rr(x, 72, 236, 150, 18, C.tile, C.line, 1.5); P.tx(l, x + 20, 108, 20, C.dim, 600); P.tx(v, x + 20, 176, 46, c, 800);
    if (l === 'Pressure') P.tx('● positive', x + 20, 206, 16, C.green, 600);
  });
  const btns = ahu ? [['System', true, C.green], ['Defumigation', f === 'defum', C.blue], ['Night', f === 'night', '#a78bfa']] : [];
  btns.forEach(([l, on, c], i) => { const x = 26 + i * 254; P.rr(x, 240, 236, 64, 32, on ? c : '#1d3a60'); P.tx(`${l} ${on ? 'ON' : 'OFF'}`, x + 118, 281, 22, '#fff', 700, 'center'); });
  if (!ahu) P.tx('Live status · no AHU switching on this version', 26, 280, 20, C.dim, 500);
  P.tx(`Fumigation  ${f === 'countdown' || f === 'active' ? fmt(Math.ceil(S.fumLeft)) : '--:--'}`, 26, 352, 22, C.dim, 600);
  if (f === 'requested') {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H); P.rr(90, 110, W - 180, 280, 24, '#13233b', C.amber, 3);
    P.tx('Fumigation Requested', W / 2, 180, 34, C.amber, 800, 'center'); P.tx('Check the room is empty', W / 2, 222, 22, C.dim, 500, 'center');
    P.rr(150, 270, 230, 70, 35, blink ? C.green : '#1f8f45'); P.tx('CONFIRM', 265, 315, 26, '#fff', 800, 'center');
    P.rr(W - 380, 270, 230, 70, 35, '#3a4b63'); P.tx('REJECT', W - 265, 315, 26, '#fff', 800, 'center');
  }
  if (f === 'countdown' || f === 'active') {
    P.rr(20, 380, W - 40, 100, 18, blink ? C.red : '#7f1d1d');
    P.tx(f === 'countdown' ? 'COUNTDOWN – EVACUATE IMMEDIATELY' : 'DANGER – FUMIGATION ACTIVE – DO NOT ENTER', W / 2, 442, 26, '#fff', 900, 'center');
  } else if (f === 'defum') { P.rr(20, 380, W - 40, 100, 18, '#1e3a8a'); P.tx('Defumigation: clearing the room', W / 2, 442, 28, '#fff', 800, 'center'); }
  else if (f === 'night') { P.rr(20, 380, W - 40, 100, 18, '#312e81'); P.tx('Night mode until the next session', W / 2, 442, 28, '#fff', 800, 'center'); }
  else { P.pill(26, 400, 'Connected', C.cyan); P.pill(200, 400, 'HEPA Healthy', C.green); }
}

const FUM = [['requested', 3.5], ['countdown', 5], ['active', 6], ['defum', 4], ['night', 3.5]];

// ---------------------------------------------------------------- the 3D scene
export async function panelShowcase(box, { onStep } = {}) {
  const inC = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
  const outC = Object.assign(document.createElement('canvas'), { width: 800, height: 500 });
  const PI = painter(inC), PO = painter(outC);
  const t0 = performance.now(), now = () => (performance.now() - t0) / 1000;
  const S = { screen: 'home', since: 0, ver: 0, fum: null, fumStart: 0, fumLeft: 0, videos: [] };
  const OS = { layout: 'full', videos: [], big: false }; // the OR Screen in the surgery scene
  let step = -1, mode = 'panels', surgery = null;
  const orC = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 }), PS = painter(orC);
  orVideos().then(v => { S.videos = v; OS.videos = v; syncVideos(); });
  function syncVideos() {
    const need = mode === 'surgery' || ['orscreen', 'video'].includes(S.screen);
    S.videos.forEach((v, i) => { if (need && (mode === 'surgery' || i === 0 || S.screen === 'orscreen')) v.play().catch(() => {}); else v.pause(); });
  }
  const fumTick = t => {
    if (S.fumStart == null || !S.fumRun) return;
    let e = t - S.fumStart, i = 0;
    while (i < FUM.length && e >= FUM[i][1]) { e -= FUM[i][1]; i++; }
    if (i >= FUM.length) { S.fumRun = false; S.fum = null; S.since = t; if (step !== -1) { step = -1; onStep?.(-1); } return; }
    S.fum = FUM[i][0]; S.fumLeft = FUM[i][1] - e;
    if (i !== step) { step = i; onStep?.(i); }
  };
  const paint = () => { const t = now(); fumTick(t); drawInside(PI, t, S); drawOutside(PO, t, S); };
  const api = { setVersion() {}, show() {}, focus() {}, playFumigation() {}, dispose() {} };
  const base = {
    setVersion(i) { S.ver = i; S.since = now(); },
    show(screen) { S.screen = screen; S.since = now(); syncVideos(); },
    playFumigation() { S.fumRun = true; S.fumStart = now(); step = -1; },
  };

  let ok = true;
  try { await loadThree(); const c = document.createElement('canvas'); ok = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { ok = false; }
  if (!box.isConnected) return api;
  if (!ok) { // flat, still animated
    inC.className = 'pn3-flat'; box.replaceChildren(inC);
    const iv = setInterval(() => { if (!box.isConnected) return clearInterval(iv); paint(); }, 60);
    return Object.assign(api, base, { dispose: () => clearInterval(iv) });
  }

  const T = window.THREE;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  box.replaceChildren(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.Fog(0x0b1626, 9, 22);
  const cam = new T.PerspectiveCamera(46, 1, 0.05, 60);
  const controls = new T.OrbitControls(cam, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 0.6, maxDistance: 5.6, minPolarAngle: 0.95, maxPolarAngle: 1.72, minAzimuthAngle: -1.05, maxAzimuthAngle: 1.05, rotateSpeed: 0.6 });

  // reflections: a dark studio with two soft boxes
  const pm = new T.PMREMGenerator(renderer), env = new T.Scene();
  env.add(new T.Mesh(new T.BoxGeometry(12, 12, 12), new T.MeshBasicMaterial({ color: 0x15253a, side: T.BackSide })));
  for (const [x, y, z, s] of [[-3, 4, 4, 4], [4, 2, 3, 3]]) { const m = new T.Mesh(new T.PlaneGeometry(s, s), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1, 0); env.add(m); }
  scene.environment = pm.fromScene(env, 0.04).texture;

  scene.add(new T.HemisphereLight(0xcfdcff, 0x1a2638, 0.4));
  const sun = new T.DirectionalLight(0xffffff, 0.7); sun.position.set(2.5, 4, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 1, far: 12 }); sun.shadow.bias = -0.0005; scene.add(sun);
  for (const x of [-0.88, 0.45, 1.4]) { // ceiling downlights washing the wall
    const sp = new T.SpotLight(0xfff1dc, 1.05, 5, 0.38, 0.8, 1.6); sp.position.set(x, 3, 0.55); sp.target.position.set(x, 0.6, -0.05); scene.add(sp, sp.target);
  }

  const std = (color, rough, metal = 0, extra = {}) => new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const add = (geo, mat, x, y, z, shadow = true) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m; };
  // wall (PPGL panels with seams), coving, glossy conductive vinyl floor
  add(new T.BoxGeometry(6.4, 3, 0.15), std(0xcfd8e3, 0.42, 0.15), 0, 1.5, -0.075, false);
  for (const x of [-2.6, -1.9, 1.15, 2.3]) add(new T.BoxGeometry(0.008, 3, 0.004), std(0xb7c2cf, 0.5), x, 1.5, 0.002, false);
  add(new T.BoxGeometry(6.4, 0.09, 0.07), std(0xd6dde6, 0.3, 0.2), 0, 0.045, 0.03, false);
  const floor = add(new T.PlaneGeometry(6.4, 14), std(0x7f8fa3, 0.2, 0.3), 0, 0, 7, false); floor.rotation.x = -Math.PI / 2;
  const band = add(new T.PlaneGeometry(6.4, 0.12), std(0x2563c9, 0.25, 0.2), 0, 0.002, 0.32, false); band.rotation.x = -Math.PI / 2; // vinyl border inlay
  // an OT corner: side walls, ceiling with glowing LED panels over the downlights
  for (const s of [-1, 1]) add(new T.BoxGeometry(0.15, 3, 14), std(0xc5cfdb, 0.45, 0.12), s * 3.2, 1.5, 7, false);
  const ceil = add(new T.PlaneGeometry(6.4, 14), std(0xdfe5ec, 0.6), 0, 3, 7, false); ceil.rotation.x = Math.PI / 2;
  for (const x of [-0.88, 0.45, 1.4]) for (const z of [0.7, 2.4, 4.1, 5.8]) { const led = add(new T.PlaneGeometry(0.58, 0.58), new T.MeshBasicMaterial({ color: 0xffffff }), x, 2.995, z, false); led.rotation.x = Math.PI / 2; }
  add(new T.BoxGeometry(6.4, 0.07, 0.07), std(0xd6dde6, 0.3, 0.2), 0, 2.965, 0.03, false); // ceiling coving
  // hermetic sliding door: SS leaf with a vision panel and a frame
  add(new T.BoxGeometry(1.32, 2.2, 0.06), std(0xaeb8c4, 0.35, 0.8), 0.45, 1.1, 0.03);
  add(new T.BoxGeometry(1.2, 2.1, 0.05), std(0xd2d9e1, 0.28, 0.9), 0.45, 1.05, 0.07);
  add(new T.BoxGeometry(0.42, 0.42, 0.01), std(0x223448, 0.05, 0.2, { transparent: true, opacity: 0.85 }), 0.45, 1.55, 0.1, false);
  add(new T.BoxGeometry(0.03, 0.5, 0.04), std(0xe5e9ee, 0.2, 1), 0.92, 1.05, 0.12);

  // a flush touch panel: white frame, screen, WIESPL blue / green swoosh, moving glass sheen
  const sheenC = Object.assign(document.createElement('canvas'), { width: 256, height: 64 });
  { const c = sheenC.getContext('2d'), g = c.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 64); }
  const sheenTex = new T.CanvasTexture(sheenC); sheenTex.wrapS = T.RepeatWrapping;
  const rounded = (w, h, r, d) => { const s = new T.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 8 }); };
  const screens = [];
  function panel(canvas, w, h, x, y) {
    const g = new T.Group(); g.position.set(x, y, 0.005); scene.add(g);
    const m = 0.045, frameM = new T.MeshPhysicalMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15 });
    const f = new T.Mesh(rounded(w + m * 2, h + m * 2.6, 0.03, 0.028), frameM); f.position.y = -m * 0.3; f.castShadow = true; g.add(f);
    const tex = new T.CanvasTexture(canvas); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    const scr = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false })); scr.position.z = 0.0335; g.add(scr);
    const sh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: sheenTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false })); sh.position.z = 0.034; g.add(sh);
    const sw = (c, dx, ww) => { const s = new T.Mesh(new T.BoxGeometry(ww, 0.006, 0.002), new T.MeshBasicMaterial({ color: c })); s.position.set(dx, -h / 2 - m * 0.75, 0.034); g.add(s); };
    sw(0x2563c9, -w * 0.12, w * 0.5); sw(0x5cb85c, w * 0.2, w * 0.24);
    const glow = new T.PointLight(0x7fb0ff, 0.5, 1.6, 2); glow.position.set(0, 0, 0.5); g.add(glow);
    screens.push(scr); return { g, tex, scr };
  }
  const W32 = 0.708, H32 = 0.398;
  const inside = panel(inC, W32, H32, -0.88, 1.45), outside = panel(outC, 0.222, 0.139, 1.4, 1.42);

  // floating tags over the two panels
  const tag = (txt, cls) => { const d = document.createElement('div'); d.className = `pn3-tag ${cls}`; d.textContent = txt; box.append(d); return d; };
  const tagIn = tag('Inside the OT · 32"', 'in'), tagOut = tag('At the door · 10"', 'out');
  const project = (v, el) => { const p = v.clone().project(cam); const r = box.getBoundingClientRect(); el.style.transform = `translate(${(p.x + 1) / 2 * r.width}px, ${(1 - p.y) / 2 * r.height}px) translate(-50%, -100%)`; el.style.opacity = p.z < 1 ? '' : '0'; };

  // camera moves
  const views = () => {
    const asp = box.clientWidth / Math.max(1, box.clientHeight), narrow = asp < 1.1, k = Math.max(1, 1.6 / asp), s = inside.g.scale.x;
    if (mode === 'surgery') { // narrow screens step back from the same target
      const kk = Math.max(1, 1.45 / asp);
      return Object.fromEntries(Object.entries(surgery.views).map(([n, [p, tg]]) => [n, [tg.clone().add(p.clone().sub(tg).multiplyScalar(n === 'screen' ? Math.min(kk, 1.6) : kk)), tg.clone()]]));
    }
    return {
      overview: narrow ? [new T.Vector3(0.3, 1.55, 3.3 * k), new T.Vector3(0.24, 1.4, 0)] : [new T.Vector3(1.35 + 0.3 * k, 1.5, 3.3 * k + 0.6), new T.Vector3(-0.1, 1.35, 0)],
      inside: [new T.Vector3(-0.88 + 0.18, 1.42, (narrow ? 1.6 : 1.05) * s), new T.Vector3(-0.88, 1.38, 0)],
      both: [new T.Vector3(0.45, 1.45, 2.05 * k + 0.2), new T.Vector3(0.42, 1.4, 0)],
      outside: [new T.Vector3(1.32, 1.45, narrow ? 0.62 : 0.42), new T.Vector3(1.4, 1.42, 0)],
    };
  };
  let fly = null, lastUser = -10, where = 'overview';
  const goTo = (name, dur = 1.4) => { const v = views()[name]; if (!v) return; where = name; const [p, tg] = v; fly = { t: now(), dur, p0: cam.position.clone(), t0: controls.target.clone(), p, tg }; };
  controls.addEventListener('start', () => { lastUser = now(); fly = null; });
  cam.position.set(2.2, 2.6, 8.5); controls.target.set(0.1, 1.2, 0);

  // tap a screen to look at it
  const ray = new T.Raycaster(), ptr = new T.Vector2();
  let down = null;
  const pick = e => { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, cam); return ray.intersectObjects(mode === 'surgery' ? surgery.screens : screens)[0]?.object; };
  const onDown = e => { down = [e.clientX, e.clientY]; };
  const onUp = e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; const o = pick(e); if (o && mode === 'surgery') return goTo(o === surgery.screens[0] ? (where === 'screen' ? 'wide' : 'screen') : (where === 'pendant' ? 'wide' : 'pendant')); if (o) goTo(o === inside.scr ? (where === 'inside' ? 'overview' : 'inside') : (where === 'outside' ? 'overview' : 'outside')); };
  const onMove = e => { renderer.domElement.style.cursor = pick(e) ? 'pointer' : ''; };
  renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp); renderer.domElement.addEventListener('pointermove', onMove);

  const resize = () => { const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(box); resize();
  let visible = true; const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }); io.observe(box);

  // intro: the panels slide out of the wall while the camera comes in
  inside.g.scale.setScalar(0.001); outside.g.scale.setScalar(0.001);
  let target = 1, scaleNow = 0.001, introT = now(), lastPaint = 0, prev = now(), raf = 0, dead = false;
  goTo('overview', 2.2);
  function loop() {
    if (dead) return;
    if (!box.isConnected) return dispose();
    raf = requestAnimationFrame(loop);
    const t = now(), dt = Math.min(0.1, t - prev); prev = t;
    if (!visible) return;
    if (mode === 'surgery') {
      if (t - lastPaint > 0.045) { lastPaint = t; orscreen(PS, t, OS); surgery.tick(t, Math.max(dt, 0.016)); }
      if (fly) { const k = Math.min(1, (t - fly.t) / fly.dur), e = ease(k); cam.position.lerpVectors(fly.p0, fly.p, e); controls.target.lerpVectors(fly.t0, fly.tg, e); if (k >= 1) fly = null; }
      else if (t - lastUser > 6 && where === 'wide') { const off = cam.position.clone().sub(controls.target); off.applyAxisAngle(new T.Vector3(0, 1, 0), Math.cos(t * 0.2) * 0.3 * dt * 0.5); cam.position.copy(controls.target).add(off); }
      controls.update(); renderer.render(surgery.scene, cam); return;
    }
    if (t - lastPaint > 0.05) { lastPaint = t; paint(); inside.tex.needsUpdate = true; outside.tex.needsUpdate = true; }
    sheenTex.offset.x = ((t * 0.12) % 1.6) - 0.8;
    const intro = Math.min(1, (t - introT) / 1.3), back = 1 + 2.2 * (intro - 1) ** 3 + 1.2 * (intro - 1) ** 2;
    scaleNow += (target - scaleNow) * Math.min(1, dt * 5);
    inside.g.scale.setScalar(Math.max(0.001, back * scaleNow)); outside.g.scale.setScalar(Math.max(0.001, back));
    inside.g.position.z = 0.005 + (1 - intro) * 0.4; outside.g.position.z = 0.005 + (1 - intro) * 0.4;
    if (fly) {
      const k = Math.min(1, (t - fly.t) / fly.dur), e = ease(k);
      cam.position.lerpVectors(fly.p0, fly.p, e); controls.target.lerpVectors(fly.t0, fly.tg, e);
      if (k >= 1) fly = null;
    } else if (t - lastUser > 6 && where === 'overview') { // gentle idle sway
      const off = cam.position.clone().sub(controls.target); off.applyAxisAngle(new T.Vector3(0, 1, 0), Math.cos(t * 0.25) * 0.25 * dt * 0.5); cam.position.copy(controls.target).add(off);
    }
    controls.update();
    renderer.render(scene, cam);
    project(new T.Vector3(-0.88, 1.45 + (H32 / 2 + 0.09) * inside.g.scale.y, 0.05), tagIn);
    project(new T.Vector3(1.4, 1.42 + 0.14, 0.05), tagOut);
  }
  loop();

  function dispose() {
    if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose();
    scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose(); }); });
    surgery?.dispose(); S.videos.forEach(v => v.pause());
    pm.dispose(); renderer.dispose(); renderer.forceContextLoss?.();
  }
  return Object.assign(api, {
    setVersion(i) { base.setVersion(i); target = i >= 3 ? 43 / 32 : 1; tagIn.textContent = `Inside the OT · ${i >= 3 ? '32" or 43"' : i === 2 ? '22" or 32"' : '32"'}`; if (where === 'inside') setTimeout(() => goTo('inside', 0.9), 300); },
    show(screen) { base.show(screen); goTo(screen === 'outside' ? 'outside' : 'inside', 1.1); },
    focus: name => goTo(name),
    playFumigation() { if (mode !== 'panels') this.setMode('panels'); base.playFumigation(); goTo('both', 1.2); },
    async setMode(m) {
      if (m === mode) return;
      if (m === 'surgery' && !surgery) {
        const vids = await orVideos();
        surgery = buildSurgery(T, { orCanvas: orC, endoVideo: vids[0] || null });
        surgery.scene.environment = scene.environment;
      }
      mode = m; syncVideos();
      tagIn.style.display = tagOut.style.display = m === 'panels' ? '' : 'none';
      Object.assign(controls, m === 'surgery' ? { minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity, minPolarAngle: 0.55, maxPolarAngle: 1.62, maxDistance: 6.5, minDistance: 0.5 } : { minAzimuthAngle: -1.05, maxAzimuthAngle: 1.05, minPolarAngle: 0.95, maxPolarAngle: 1.72, maxDistance: 5.6, minDistance: 0.6 });
      if (m === 'surgery') { cam.position.set(4.5, 3, 5); controls.target.set(0, 1.1, -0.5); goTo('wide', 1.8); } else { cam.position.set(2.2, 2.6, 8.5); controls.target.set(0.1, 1.2, 0); goTo('overview', 1.6); }
    },
    story(i) {
      const s = OR_STORY[i]; if (!s || !surgery) return;
      OS.layout = s.layout; OS.big = !!s.big; surgery.setLook(s.look); goTo(s.view, 1.6);
    },
    hasVideos: () => S.videos.length > 0,
    dispose,
  });
}
