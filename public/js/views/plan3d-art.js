// Pictures painted in code for the fitted-out rooms of the CAD drawing's 3D (no image files to download):
// the backlit sky-ceiling panels of the sterile corridor, the printed picture-glass panel of the OT, the OT door's
// vision panel with the WIESPL logo, and a four-way ceiling air diffuser. Each draws on a canvas 2D context.
// The real WIESPL mark (public/img/wiespl-mark.webp) is drawn where the logo appears; a texture made before it has
// loaded is painted again once it arrives.

const MARK = new Image(); let markReady = false; const waiting = [];
MARK.onload = () => { markReady = true; for (const f of waiting.splice(0)) f(); };
MARK.src = '/img/wiespl-mark.webp';
export const markImage = () => (markReady ? MARK : null);
export const whenMark = f => { if (markReady) f(); else waiting.push(f); };

// a little randomness that is the same every time, so a picture never changes between views
const rng = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// looking straight up through a sunlit tree canopy (as on WIESPL corridor sky ceilings)
export function drawCanopy(g, w, h) {
  const r = rng(11), sx = w * 0.47, sy = h * 0.56;
  const sky = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.75);
  sky.addColorStop(0, '#ffffff'); sky.addColorStop(0.12, '#fffbe0'); sky.addColorStop(0.35, '#cfe9ff'); sky.addColorStop(1, '#7fb6e8');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // trunks rise from the edges towards the sun
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + r() * 0.4, R = Math.max(w, h) * 0.75;
    const x0 = sx + Math.cos(a) * R, y0 = sy + Math.sin(a) * R, x1 = sx + Math.cos(a) * R * (0.18 + r() * 0.12), y1 = sy + Math.sin(a) * R * (0.18 + r() * 0.12);
    const wd = 16 + r() * 20, nx = -Math.sin(a), ny = Math.cos(a), bend = (r() - 0.5) * 60;
    const bark = g.createLinearGradient(x0 + nx * wd, y0 + ny * wd, x0 - nx * wd, y0 - ny * wd); bark.addColorStop(0, '#5a3d1e'); bark.addColorStop(0.5, '#a8793f'); bark.addColorStop(1, '#4a3016');
    g.fillStyle = bark; g.beginPath(); g.moveTo(x0 + nx * wd, y0 + ny * wd);
    g.quadraticCurveTo((x0 + x1) / 2 + nx * (wd * 0.6 + bend), (y0 + y1) / 2 + ny * (wd * 0.6 + bend), x1 + nx * 2, y1 + ny * 2);
    g.lineTo(x1 - nx * 2, y1 - ny * 2);
    g.quadraticCurveTo((x0 + x1) / 2 - nx * (wd * 0.6 - bend), (y0 + y1) / 2 - ny * (wd * 0.6 - bend), x0 - nx * wd, y0 - ny * wd); g.fill();
    g.strokeStyle = 'rgba(70,45,20,.8)'; g.lineWidth = 3;
    for (let k = 0; k < 3; k++) { const t = 0.35 + r() * 0.45, bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t, ba = a + Math.PI + (r() - 0.5) * 1.6; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * 70, by + Math.sin(ba) * 70); g.stroke(); }
  }
  // leaves: dense at the edges, thin near the sun, yellower where the light comes through
  const greens = ['#4f8f2a', '#6aa833', '#8cc43c', '#b5d84a', '#d9ea5c', '#eef37a'];
  for (let i = 0; i < 9000; i++) {
    const x = r() * w, y = r() * h, d = Math.hypot(x - sx, y - sy) / Math.max(w, h);
    if (r() > Math.min(1, d * 2.1)) continue;
    const warm = Math.max(0, 1 - d * 1.8), c = greens[Math.min(5, Math.floor(r() * 3 + warm * 4))];
    g.globalAlpha = 0.55 + r() * 0.4; g.fillStyle = c; g.beginPath(); g.ellipse(x, y, 3 + r() * 6, 2 + r() * 4, r() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // sun rays and glow
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) { const a = r() * Math.PI * 2, L = Math.max(w, h) * (0.3 + r() * 0.5); g.strokeStyle = 'rgba(255,250,215,.06)'; g.lineWidth = 6 + r() * 18; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L); g.stroke(); }
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.22); glow.addColorStop(0, 'rgba(255,255,240,1)'); glow.addColorStop(1, 'rgba(255,255,240,0)'); g.fillStyle = glow; g.fillRect(0, 0, w, h);
  g.restore();
}

// pink blossom branches against a deep blue sky
export function drawBlossom(g, w, h) {
  const r = rng(29);
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1747c9'); sky.addColorStop(0.6, '#2f7be0'); sky.addColorStop(1, '#8fc4f2');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 9; i++) { const cx = w * (0.45 + r() * 0.6), cy = h * (0.72 + r() * 0.3); for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(cx + k * 26 - 60, cy + Math.sin(k * 1.7) * 10, 50, 16, 0, 0, Math.PI * 2); g.fill(); } }
  // branches hang in from the top, flowers along them
  const flowers = [];
  const branch = (x, y, a, len, wd, depth) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    g.strokeStyle = '#3b2418'; g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * len * 0.3, (y + y2) / 2 + (r() - 0.5) * len * 0.3, x2, y2); g.stroke();
    for (let k = 0; k < len / 9; k++) { const t = r(); flowers.push([x + (x2 - x) * t + (r() - 0.5) * 30, y + (y2 - y) * t + (r() - 0.5) * 30]); }
    if (depth > 0) for (let k = 0; k < 3; k++) branch(x2, y2, a + (r() - 0.5) * 1.3, len * (0.55 + r() * 0.2), Math.max(1, wd * 0.6), depth - 1);
  };
  for (let i = 0; i < 4; i++) branch(w * (0.05 + i * 0.22), -10, Math.PI / 2 + (r() - 0.5) * 0.9, h * 0.32, 9, 3);
  const pinks = ['#f06f9f', '#f59cbf', '#fbc3d8', '#e44f86', '#ffd9e6'];
  for (const [fx, fy] of flowers) for (let k = 0; k < 5; k++) {
    const x = fx + (r() - 0.5) * 22, y = fy + (r() - 0.5) * 22, s = 3 + r() * 4;
    g.fillStyle = pinks[Math.floor(r() * pinks.length)];
    for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 0.7, s * 0.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#b8325f'; g.beginPath(); g.arc(x, y, s * 0.25, 0, Math.PI * 2); g.fill();
  }
}

// an avenue of flowering trees on a carpet of pink petals, printed on toughened glass (two panes, a fine joint)
export function drawAvenue(g, w, h) {
  const r = rng(53), vx = w * 0.5, vy = h * 0.52;
  const mist = g.createRadialGradient(vx, vy, 0, vx, vy, w * 0.55); mist.addColorStop(0, '#fbfff6'); mist.addColorStop(0.25, '#e9f1dc'); mist.addColorStop(1, '#a6b48a');
  g.fillStyle = mist; g.fillRect(0, 0, w, h);
  // petals on the ground, smaller towards the far end
  const ground = g.createLinearGradient(0, vy, 0, h); ground.addColorStop(0, '#f3d6dc'); ground.addColorStop(1, '#d9708f'); g.fillStyle = ground; g.fillRect(0, vy, w, h - vy);
  const petal = ['#e76d93', '#f39ab5', '#c9466f', '#fbc4d3', '#f7b0c6'];
  for (let i = 0; i < 7000; i++) { const t = r() ** 1.6, y = vy + (h - vy) * t, x = vx + (r() - 0.5) * w * (0.2 + t * 1.6), s = 1 + t * 6; g.fillStyle = petal[Math.floor(r() * petal.length)]; g.globalAlpha = 0.6 + r() * 0.4; g.beginPath(); g.ellipse(x, y, s * 1.4, s * 0.7, r() * Math.PI, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  // rows of trunks on both sides, closer = bigger
  for (let k = 7; k >= 0; k--) {
    const t = (k + 1) / 8.5, sc = 1 - t * 0.92;
    for (const side of [-1, 1]) {
      const x = vx + side * w * (0.06 + 0.4 * sc), base = vy + (h - vy) * sc * 0.82, tw = 6 + 60 * sc, th = (base - vy) + h * 0.5 * sc;
      const bark = g.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0); bark.addColorStop(0, '#3e2614'); bark.addColorStop(0.45, '#8c6038'); bark.addColorStop(1, '#2e1c0e');
      g.fillStyle = bark; g.beginPath(); g.moveTo(x - tw / 2, base); g.lineTo(x - tw * 0.32, base - th); g.lineTo(x + tw * 0.32, base - th); g.lineTo(x + tw / 2, base); g.fill();
      g.strokeStyle = 'rgba(30,18,8,.35)'; g.lineWidth = 1 + sc * 2; for (let b = 0; b < 4; b++) { const bx = x - tw * 0.3 + r() * tw * 0.6; g.beginPath(); g.moveTo(bx, base); g.lineTo(bx + (r() - 0.5) * 6, base - th); g.stroke(); }
    }
  }
  // the canopy: pink and a little green, joining over the path
  const bloom = ['#f2a5bf', '#e9849f', '#fbd2df', '#c95a7e', '#9db06a', '#f7c0d1'];
  for (let i = 0; i < 6500; i++) {
    const y = r() * vy * 1.05, spread = 1 - y / (vy * 1.05), x = r() * w;
    if (Math.abs(x - vx) < w * 0.08 * (1 - spread) && r() > 0.25) continue; // the light at the end of the avenue
    g.fillStyle = bloom[Math.floor(r() * bloom.length)]; g.globalAlpha = 0.5 + r() * 0.45; g.beginPath(); g.arc(x, y, 2 + r() * 7 * (0.4 + spread), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  const shine = g.createLinearGradient(0, 0, w, h); shine.addColorStop(0.35, 'rgba(255,255,255,0)'); shine.addColorStop(0.5, 'rgba(255,255,255,.12)'); shine.addColorStop(0.65, 'rgba(255,255,255,0)');
  g.fillStyle = shine; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(w / 2 - 1, 0, 2, h); // the joint between the two glass panes
}

// the WIESPL mark: blue and green swoosh with the name under it
export function logo(g, x, y, s, mirror = false, text = '#24306e') {
  g.save(); g.translate(x, y); if (mirror) g.scale(-1, 1);
  const m = markImage(); if (m) g.drawImage(m, -s * 0.55, -s * 1.02, s * 1.1, s * 1.1); // the mark is square with room round the swoosh
  g.fillStyle = text; g.font = `italic 800 ${s * 0.42}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.fillText('WIESPL', 0, s * 0.05);
  g.restore();
}

// the OT door's vision panel: black rounded frame, clear glass, the WIESPL mark at the foot (transparent outside)
export function drawVision(g, w, h) {
  g.clearRect(0, 0, w, h);
  const rim = w * 0.07, rr = w * 0.16;
  g.fillStyle = '#111418'; g.beginPath(); g.roundRect(0, 0, w, h, rr); g.fill();
  const glass = g.createLinearGradient(0, 0, w, h); glass.addColorStop(0, 'rgba(205,225,240,.42)'); glass.addColorStop(0.5, 'rgba(235,245,255,.30)'); glass.addColorStop(1, 'rgba(190,210,230,.42)');
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.roundRect(rim, rim, w - rim * 2, h - rim * 2, rr * 0.7); g.fill();
  g.globalCompositeOperation = 'source-over'; g.fillStyle = glass; g.beginPath(); g.roundRect(rim, rim, w - rim * 2, h - rim * 2, rr * 0.7); g.fill();
  logo(g, w * 0.28, h - rim - w * 0.06, w * 0.19, false); logo(g, w * 0.72, h - rim - w * 0.06, w * 0.19, true); // read from both sides, as on site
}

// a square four-way ceiling diffuser: nested louvres round a centre plate
export function drawDiffuser(g, w, h) {
  g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const m = (i / n) * w * 0.42 + w * 0.04;
    g.strokeStyle = 'rgba(52,64,80,.8)'; g.lineWidth = w * 0.024; g.strokeRect(m, m, w - m * 2, h - m * 2);
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = w * 0.008; g.strokeRect(m + w * 0.014, m + w * 0.014, w - m * 2 - w * 0.028, h - m * 2 - w * 0.028);
  }
  g.fillStyle = '#dfe4ea'; g.fillRect(w * 0.42, h * 0.42, w * 0.16, h * 0.16);
  g.strokeStyle = '#8a96a6'; g.lineWidth = w * 0.03; g.strokeRect(w * 0.015, h * 0.015, w * 0.97, h * 0.97);
  g.strokeStyle = 'rgba(70,82,98,.4)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
}

// the surgeon's control panel screen, as the WIESPL OR control panel's home screen looks: clock, surgery timer,
// HEPA / config / MGPS buttons and the lighting, temperature, humidity and music tiles
export function drawPanelScreen(g, w, h) {
  const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#0f3550'); bg.addColorStop(1, '#2c4a63'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const tile = (x, y, tw, th) => { g.fillStyle = 'rgba(255,255,255,.07)'; g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, tw, th, 14); g.fill(); g.stroke(); };
  const txt = (s, x, y, size, wt = 700, col = '#fff') => { g.fillStyle = col; g.font = `${wt} ${size}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.fillText(s, x, y); };
  // clock
  const cx = w * 0.14, cy = h * 0.3, r = h * 0.17; g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#222'; g.lineWidth = 2; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); g.lineTo(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97); g.stroke(); }
  g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - r * 0.45, cy - r * 0.2); g.stroke(); g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.55, cy - r * 0.35); g.stroke();
  // timer
  tile(w * 0.27, h * 0.1, w * 0.46, h * 0.4); txt('WIESPL OR CONTROL PANEL', w * 0.5, h * 0.18, h * 0.035); txt('00:00', w * 0.5, h * 0.36, h * 0.12, 800);
  for (const [dx, l] of [[-0.04, 'RESET'], [0.04, 'START']]) { g.fillStyle = '#0d7a63'; g.beginPath(); g.arc(w * (0.5 + dx), h * 0.43, h * 0.03, 0, Math.PI * 2); g.fill(); txt(l, w * (0.5 + dx), h * 0.49, h * 0.018); }
  // HEPA, config, MGPS
  tile(w * 0.75, h * 0.1, w * 0.22, h * 0.4);
  [['HEPA', 0.18], ['CONFIG', 0.3], ['MGPS', 0.42]].forEach(([l, y]) => { g.fillStyle = '#e9f7ee'; g.strokeStyle = '#3aa46a'; g.lineWidth = 3; g.beginPath(); g.arc(w * 0.86, h * y, h * 0.035, 0, Math.PI * 2); g.fill(); g.stroke(); txt(l, w * 0.86, h * (y + 0.06), h * 0.018); });
  // the four tiles
  [['LIGHTING', '4'], ['TEMP', '21.3°C'], ['HUMIDITY', '44.6%'], ['MUSIC', 'OFF']].forEach(([l, v], i) => { const x = w * (0.03 + i * 0.24); tile(x, h * 0.55, w * 0.22, h * 0.27); txt(l, x + w * 0.11, h * 0.64, h * 0.04); txt(v, x + w * 0.11, h * 0.76, h * 0.05, 800); });
  // the WIESPL mark
  const m = markImage(); if (m) g.drawImage(m, w * 0.8, h * 0.78, h * 0.2, h * 0.2);
}

// a calm mountain lake at first light: another picture-glass scene
export function drawLake(g, w, h) {
  const r = rng(71);
  const sky = g.createLinearGradient(0, 0, 0, h * 0.55); sky.addColorStop(0, '#2a6fd0'); sky.addColorStop(0.7, '#9fd0f5'); sky.addColorStop(1, '#fde9c8'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 7; i++) { const cx = r() * w, cy = h * (0.08 + r() * 0.18); for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(cx + k * 30, cy + Math.sin(k) * 7, 44, 15, 0, 0, Math.PI * 2); g.fill(); } }
  const ridge = (base, amp, c1, c2, snow, seed) => { const q = rng(seed), pts = []; for (let x = 0; x <= w; x += w / 18) pts.push([x, h * base - (Math.abs(Math.sin(x * 0.006 + seed)) * 0.7 + q() * 0.3) * h * amp]);
    const gr = g.createLinearGradient(0, h * (base - amp), 0, h * 0.58); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.beginPath(); g.moveTo(0, h * 0.58); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(w, h * 0.58); g.fill();
    if (snow) { g.fillStyle = 'rgba(255,255,255,.92)'; for (const [x, y] of pts) if (y < h * (base - amp * 0.55)) { g.beginPath(); g.moveTo(x - 26, y + 30); g.lineTo(x, y); g.lineTo(x + 26, y + 30); g.quadraticCurveTo(x, y + 22, x - 26, y + 30); g.fill(); } } };
  ridge(0.44, 0.24, '#7c8fb2', '#5b6f8f', true, 3); ridge(0.53, 0.13, '#3f6b55', '#2c4e3d', false, 7);
  const lake = g.createLinearGradient(0, h * 0.58, 0, h); lake.addColorStop(0, '#5aa2dc'); lake.addColorStop(1, '#1d5a9e'); g.fillStyle = lake; g.fillRect(0, h * 0.58, w, h * 0.42);
  g.save(); g.globalAlpha = 0.35; g.translate(0, h * 1.16); g.scale(1, -1); g.drawImage(g.canvas, 0, 0, w, h * 0.58, 0, 0, w, h * 0.58); g.restore();
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2; for (let i = 0; i < 60; i++) { const y = h * (0.62 + r() * 0.36), x = r() * w; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30 + r() * 60, y); g.stroke(); }
  for (let i = 0; i < 14; i++) { const x = (i / 14) * w + r() * 30, b = h * (0.6 + r() * 0.04), th = h * (0.12 + r() * 0.1); g.fillStyle = '#1f3d2c'; g.beginPath(); g.moveTo(x, b - th); g.lineTo(x - th * 0.22, b); g.lineTo(x + th * 0.22, b); g.fill(); }
}

// morning sun through a green forest
export function drawForest(g, w, h) {
  const r = rng(97), sx = w * 0.62, sy = h * 0.28;
  const bg = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.8); bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.25, '#cfe8a8'); bg.addColorStop(0.7, '#5f9a4a'); bg.addColorStop(1, '#2f5a2a'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 3; k++) for (let i = 0; i < 18; i++) {
    const x = r() * w, tw = (6 + r() * 10) * (1 + k * 1.2), sh = ['rgba(70,90,60,.45)', 'rgba(60,45,30,.75)', 'rgba(45,30,18,.95)'][k];
    g.fillStyle = sh; g.fillRect(x - tw / 2, 0, tw, h);
  }
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) { const a = Math.PI * (0.35 + r() * 0.45), L = h * 1.3; g.strokeStyle = 'rgba(255,250,210,.07)'; g.lineWidth = 10 + r() * 30; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L); g.stroke(); }
  g.restore();
  const leaf = ['#9bc94f', '#6fae3b', '#c9e070', '#4f8a2e'];
  for (let i = 0; i < 5000; i++) { const y = r() * h * 0.45, x = r() * w; g.fillStyle = leaf[Math.floor(r() * 4)]; g.globalAlpha = 0.5 + r() * 0.4; g.beginPath(); g.ellipse(x, y, 3 + r() * 6, 2 + r() * 4, r() * 3, 0, Math.PI * 2); g.fill(); }
  const ground = g.createLinearGradient(0, h * 0.78, 0, h); ground.addColorStop(0, 'rgba(120,160,70,.0)'); ground.addColorStop(1, '#4e7a2e'); g.globalAlpha = 1; g.fillStyle = ground; g.fillRect(0, h * 0.78, w, h * 0.22);
  for (let i = 0; i < 1500; i++) { g.fillStyle = leaf[Math.floor(r() * 4)]; g.globalAlpha = 0.7; g.fillRect(r() * w, h * (0.86 + r() * 0.14), 2, 4 + r() * 6); }
  g.globalAlpha = 1;
}

// open blue sky with soft clouds: the third sky-ceiling design
export function drawSky(g, w, h) {
  const r = rng(113);
  const sky = g.createLinearGradient(0, 0, w, h); sky.addColorStop(0, '#1a5fd8'); sky.addColorStop(0.6, '#4b9ae8'); sky.addColorStop(1, '#a9d6fb'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const cx = r() * w, cy = r() * h, sc = 0.6 + r() * 1.2;
    for (let k = 0; k < 9; k++) { const gr = g.createRadialGradient(cx + (k - 4) * 22 * sc, cy + Math.sin(k * 1.3) * 12 * sc, 0, cx + (k - 4) * 22 * sc, cy + Math.sin(k * 1.3) * 12 * sc, 42 * sc); gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  }
}

// brushed stainless steel: fine horizontal grain, with a panel joint at the left edge when seam is set
export function brushed(seam) {
  return (g, w, h) => {
    const r = rng(7); g.fillStyle = '#d9dee4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < h * 3; i++) { const y = r() * h, l = 20 + r() * w * 0.6, x = r() * w; g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${0.08 + r() * 0.12})` : `rgba(90,100,112,${0.05 + r() * 0.08})`; g.fillRect(x, y, l, 1); g.fillRect(x - w, y, l, 1); }
    if (seam) { g.fillStyle = 'rgba(40,50,64,.55)'; g.fillRect(0, 0, 3, h); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(3, 0, 1, h); }
  };
}

// seamless vinyl: a fine speckle on near-white, so the floor colour shows through with some life in it
export function drawVinyl(g, w, h) {
  const r = rng(19); g.fillStyle = '#f3f3f1'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.05; i++) { const v = r(); g.fillStyle = v > 0.6 ? `rgba(255,255,255,${0.3 + r() * 0.4})` : `rgba(70,70,70,${0.05 + r() * 0.12})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
}

// a soft dark patch: the shadow where equipment meets the floor
export function drawBlob(g, w, h) {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.clearRect(0, 0, w, h); g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

// an LED ceiling panel: even light inside a slim aluminium frame
export function drawLedPanel(g, w, h) {
  g.fillStyle = '#c9ced4'; g.fillRect(0, 0, w, h);
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#eef3f8');
  g.fillStyle = gr; g.fillRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
}

// a patient monitor: ECG, SpO2 and breathing traces with their numbers, on black
export function drawVitals(g, w, h) {
  g.fillStyle = '#05080c'; g.fillRect(0, 0, w, h);
  const trace = (y, col, f) => { g.strokeStyle = col; g.lineWidth = Math.max(2, h * 0.012); g.beginPath(); for (let x = 0; x <= w * 0.7; x += 2) { const v = f(x / (w * 0.7)); x ? g.lineTo(x + w * 0.03, y - v * h * 0.08) : g.moveTo(x + w * 0.03, y - v * h * 0.08); } g.stroke(); };
  trace(h * 0.25, '#38e06b', p => { const k = (p * 5) % 1; return k > 0.42 && k < 0.47 ? 2.2 : k > 0.47 && k < 0.5 ? -1 : Math.sin(k * 6.28) * 0.1; });
  trace(h * 0.52, '#33d6ff', p => Math.max(0, Math.sin(p * 31)) * 0.9);
  trace(h * 0.78, '#ffd23f', p => Math.sin(p * 12) * 0.6);
  const num = (t, y, col, s) => { g.fillStyle = col; g.font = `700 ${h * s}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'right'; g.fillText(t, w * 0.97, y); };
  num('72', h * 0.3, '#38e06b', 0.2); num('98', h * 0.57, '#33d6ff', 0.2); num('120/80', h * 0.83, '#ffd23f', 0.12);
}

// an endoscope camera picture on the surgeon's monitor: the round, pink field of view on black
export function drawScope(g, w, h) {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const r = Math.min(w, h) * 0.44, cx = w / 2, cy = h / 2, gr = g.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
  gr.addColorStop(0, '#f6c3b4'); gr.addColorStop(0.5, '#d9786a'); gr.addColorStop(1, '#7a2a28');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(150,40,40,.5)'; g.lineWidth = 3; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(cx + (i - 4) * r * 0.2, cy - r * 0.7); g.quadraticCurveTo(cx + (i - 4) * r * 0.25, cy, cx + (i - 4) * r * 0.18, cy + r * 0.7); g.stroke(); }
  g.fillStyle = '#9aa3ad'; g.beginPath(); g.moveTo(w, h * 0.75); g.lineTo(cx + r * 0.1, cy + r * 0.05); g.lineTo(cx + r * 0.14, cy + r * 0.13); g.lineTo(w, h * 0.86); g.fill(); // an instrument
}

// 600 mm ceiling tiles with fine joints
export function drawCeilingTile(g, w, h) {
  g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,132,148,.55)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
}

// the X-ray viewer: two films (chest) on a bright, even light panel
export function drawXray(g, w, h) {
  g.fillStyle = '#f7fbff'; g.fillRect(0, 0, w, h);
  for (const x0 of [w * 0.04, w * 0.52]) {
    const fw = w * 0.44, fh = h * 0.9, y0 = h * 0.05, cx = x0 + fw / 2;
    g.fillStyle = '#15191e'; g.fillRect(x0, y0, fw, fh);
    const body = g.createRadialGradient(cx, y0 + fh * 0.5, fw * 0.1, cx, y0 + fh * 0.5, fw * 0.55); body.addColorStop(0, 'rgba(150,160,170,.5)'); body.addColorStop(1, 'rgba(60,66,72,.2)');
    g.fillStyle = body; g.beginPath(); g.ellipse(cx, y0 + fh * 0.52, fw * 0.4, fh * 0.44, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(20,24,28,.85)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * fw * 0.17, y0 + fh * 0.5, fw * 0.13, fh * 0.3, s * 0.1, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(215,222,230,.75)'; g.lineWidth = Math.max(1.5, w * 0.006);
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) { const y = y0 + fh * (0.22 + i * 0.07); g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * fw * 0.32, y - fh * 0.02, cx + s * fw * 0.36, y + fh * 0.06); g.stroke(); }
    g.fillStyle = 'rgba(225,230,236,.85)'; g.fillRect(cx - fw * 0.02, y0 + fh * 0.12, fw * 0.04, fh * 0.75);
  }
}

// the perforated steel face of the laminar air flow plenum
export function drawPerforated(g, w, h) {
  g.fillStyle = '#b8c2ce'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(38,48,60,.75)'; const step = w / 32;
  for (let y = step / 2; y < h; y += step) for (let x = (Math.round(y / step) % 2 ? step : step / 2); x < w; x += step) { g.beginPath(); g.arc(x, y, step * 0.22, 0, Math.PI * 2); g.fill(); }
}

// the return-air grille low on a riser: horizontal blades in an SS frame
export function drawGrille(g, w, h) {
  g.fillStyle = '#c9d0d8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2b333d'; g.fillRect(w * 0.08, h * 0.06, w * 0.84, h * 0.88);
  for (let y = h * 0.1; y < h * 0.9; y += h * 0.075) { g.fillStyle = '#e3e8ee'; g.fillRect(w * 0.1, y, w * 0.8, h * 0.035); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(w * 0.1, y + h * 0.035, w * 0.8, h * 0.01); }
}

// a canvas texture from one of the painters above
export function artTexture(T, draw, w, h, alpha = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  if (!markReady) whenMark(() => { const g = c.getContext('2d'); g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true; }); t.encoding = T.sRGBEncoding; t.anisotropy = 8; if (alpha) t.premultiplyAlpha = false;
  return t;
}
