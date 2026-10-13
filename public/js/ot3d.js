// 3D cut-away of a WIESPL modular OT (or ICU / NICU ward), built from what the visitor picked.
// Drag to turn, pinch / scroll to zoom, tap a label or a part to see what it does.
// Uses three.js from the jsDelivr CDN; without it (offline / no WebGL) a plain list is shown instead.
const CDN = ['https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'];
let loading = null;
const loadScript = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = bad; document.head.append(s); });
function loadThree() {
  if (window.THREE?.OrbitControls) return Promise.resolve();
  loading ||= (async () => { if (!window.THREE) await loadScript(CDN[0]); await loadScript(CDN[1]); })().catch(e => { loading = null; throw e; });
  return loading;
}
const webgl = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch { return false; } };

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function fallback(box, opts, keys) {
  box.replaceChildren();
  box.style.height = 'auto'; box.style.minHeight = '0'; box.style.padding = '14px'; box.style.background = 'var(--surface-2)';
  box.append(el('p', null, 'The 3D view needs an internet connection and a recent browser. Here is what a WIESPL room includes:'));
  const ul = el('ul'); ul.style.paddingLeft = '18px';
  for (const k of keys) {
    const i = opts.info[k]; if (!i) continue;
    const li = el('li'); li.append(el('b', null, i.label + (opts.features.includes(k) ? '  ✓' : '')), document.createTextNode(` – ${i.hint}`)); ul.append(li);
  }
  box.append(ul);
  return { dispose() {} };
}

export async function mount3D(box, opts) {
  const isWard = !opts.types.some(t => ['ot', 'cathlab'].includes(t));
  const nicu = opts.types.includes('nicu') && !opts.types.some(t => ['icu', 'picu'].includes(t));
  const OT_KEYS = ['laf', 'hepa', 'panels', 'flooring', 'otlight', 'pendants', 'mgps', 'doors', 'control', 'xray', 'scrub', 'passbox', 'storage', 'automation', 'pressure', 'fumigation', 'ahu', 'lead'];
  const WARD_KEYS = ['bedhead', 'mgps', 'hepa', 'panels', 'flooring', 'doors', 'nurse', 'pressure', 'handwash', 'storage', 'automation', 'fumigation', 'ahu', ...(nicu || opts.types.includes('nicu') ? ['warmers'] : [])];
  const keys = isWard ? WARD_KEYS : OT_KEYS;
  if (!webgl()) return fallback(box, opts, keys);
  try { await loadThree(); } catch { return fallback(box, opts, keys); }
  if (!box.isConnected) return { dispose() {} };
  const T = window.THREE;

  // ------------------------------------------------------------ renderer, camera, lights
  box.replaceChildren();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  box.append(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 2.5; controls.maxDistance = 22;
  scene.add(new T.HemisphereLight(0xffffff, 0xb8c4d6, 0.85));
  const sun = new T.DirectionalLight(0xffffff, 0.65); sun.position.set(6, 10, 7); scene.add(sun);
  const fill = new T.DirectionalLight(0xdfe8ff, 0.3); fill.position.set(-8, 5, -4); scene.add(fill);

  // ------------------------------------------------------------ helpers
  const mats = {};
  const mat = (color, o = {}) => {
    const k = `${color}|${JSON.stringify(o)}`;
    return (mats[k] ||= new T.MeshStandardMaterial({ color, metalness: o.metal ?? 0.1, roughness: o.rough ?? 0.6, transparent: o.opacity != null, opacity: o.opacity ?? 1,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1, side: o.side ?? T.FrontSide, depthWrite: o.opacity == null || o.opacity > 0.5 }));
  };
  const SS = () => mat(0xc8d0d9, { metal: 0.6, rough: 0.35 });
  const comps = {}; // key → { group, anchor }
  const comp = key => (comps[key] ||= { group: Object.assign(new T.Group(), { name: key }), anchor: new T.Vector3() });
  const add = (parent, geo, material, x, y, z, rot) => { const m = new T.Mesh(geo, material); m.position.set(x, y, z); if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0); parent.add(m); return m; };
  const boxM = (parent, w, h, d, material, x, y, z, rot) => add(parent, new T.BoxGeometry(w, h, d), material, x, y, z, rot);
  const cyl = (parent, r1, r2, h, material, x, y, z, rot, seg = 20) => add(parent, new T.CylinderGeometry(r1, r2, h, seg), material, x, y, z, rot);
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; };
  const outlets = (parent, x, y, z, axis = 'z', n = 4) => {
    const colors = [0xffffff, 0x2b6cd8, 0x222222, 0xf2c200, 0x2e9e4a];
    for (let i = 0; i < n; i++) {
      const o = cyl(parent, 0.035, 0.035, 0.03, mat(colors[i % colors.length], { rough: 0.4 }), 0, 0, 0, axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2], 14);
      if (axis === 'z') o.position.set(x + (i - (n - 1) / 2) * 0.11, y, z); else o.position.set(x, y, z + (i - (n - 1) / 2) * 0.11);
    }
  };
  const air = { on: opts.features.includes('laf') || opts.features.includes('hepa'), points: null, speed: [] };
  const extras = []; // things only shown "above the ceiling"

  // ------------------------------------------------------------ room shell (cut away at the front so you can look in)
  const W = isWard ? 9 : 6, D = 6, H = 3;
  const room = new T.Group(); scene.add(room);
  const wallTex = tex(512, 256, (g, w, h) => { g.fillStyle = '#eef2f6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c3cbd6'; g.lineWidth = 3; for (let x = 0; x <= w; x += w / 5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w, h * 0.5); g.stroke(); });
  wallTex.wrapS = wallTex.wrapT = T.RepeatWrapping;
  const wallMat = len => { const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(len / 6, 1); return new T.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.15 }); };
  const panels = comp('panels');
  boxM(panels.group, W, H, 0.1, wallMat(W), 0, H / 2, -D / 2);              // back wall
  boxM(panels.group, 0.1, H, D, wallMat(D), -W / 2, H / 2, 0);              // left wall
  // Cut-away walls show their layers: steel skin, PUF insulation core, lead sheet (if chosen)
  const lead = opts.features.includes('lead') || opts.types.includes('cathlab');
  const cut = (w, d, x, z, alongX) => {
    const h0 = 0.9, layers = [[0xdfe5ec, 0.012], [0xf1c24f, 0.07], ...(lead ? [[0x5b6470, 0.01]] : []), [0xdfe5ec, 0.012]];
    let off = 0;
    for (const [c, t] of layers) { if (alongX) boxM(panels.group, w, h0, t, mat(c), x, h0 / 2, z + off); else boxM(panels.group, t, h0, d, mat(c), x + off, h0 / 2, z); off += t; }
  };
  cut(W, 0, 0, D / 2 - 0.05, true); cut(0, D, W / 2 - 0.05, 0, false);
  panels.anchor.set(-W / 2 + 0.05, 2.3, -D / 4);
  if (lead) { const l = comp('lead'); l.anchor.set(W / 2 - 0.05, 0.95, D / 4); boxM(l.group, 0.02, 0.02, 0.02, mat(0x5b6470), W / 2, 0.92, D / 4); }
  // coving: rounded joints where the walls meet the floor
  const cove = mat(0xd6dde6, { rough: 0.5 });
  cyl(panels.group, 0.07, 0.07, W, cove, 0, 0.0, -D / 2 + 0.05, [0, 0, Math.PI / 2], 12);
  cyl(panels.group, 0.07, 0.07, D, cove, -W / 2 + 0.05, 0.0, 0, [Math.PI / 2, 0, 0], 12);
  // floor
  const flooring = comp('flooring');
  const floorTex = tex(256, 256, (g, w, h) => { g.fillStyle = '#7f97b2'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
  floorTex.wrapS = floorTex.wrapT = T.RepeatWrapping; floorTex.repeat.set(W / 2, D / 2);
  add(flooring.group, new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.05 }), 0, 0, 0, [-Math.PI / 2, 0, 0]);
  flooring.anchor.set(W / 2 - 1, 0.05, D / 2 - 1);
  // ceiling (see-through) and the ground outside
  const ceiling = add(room, new T.PlaneGeometry(W, D), mat(0xffffff, { opacity: 0.16, side: T.DoubleSide }), 0, H, 0, [Math.PI / 2, 0, 0]);
  add(room, new T.CircleGeometry(11, 48), mat(0x9fb0c6, { rough: 0.95, opacity: 0.35 }), 0, -0.01, 0, [-Math.PI / 2, 0, 0]);

  // ------------------------------------------------------------ AHU and ducts (the "anatomy" above the ceiling)
  const ahu = comp('ahu');
  const ahuZ = -D / 2 - 1.6, ahuY = H + 1.3;
  boxM(ahu.group, 2.4, 1.2, 1.1, mat(0x5f84ad, { metal: 0.3, rough: 0.5 }), 0, ahuY, ahuZ);
  const grill = tex(128, 128, (g, w, h) => { g.fillStyle = '#2b3c52'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8fa4bd'; g.lineWidth = 4; for (let r = 10; r < 60; r += 12) { g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.stroke(); } });
  add(ahu.group, new T.PlaneGeometry(0.8, 0.8), new T.MeshStandardMaterial({ map: grill }), 0.6, ahuY, ahuZ + 0.56);
  boxM(ahu.group, 0.6, 0.15, 0.4, mat(0x3d4f63), -0.8, ahuY - 0.68, ahuZ); // base
  ahu.anchor.set(0, ahuY + 0.75, ahuZ);
  const duct = mat(0xb7c3d0, { metal: 0.55, rough: 0.4 });
  const ductRun = (pts, size = 0.45) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const len = a.distanceTo(b); const mid = a.clone().add(b).multiplyScalar(0.5); const g = new T.BoxGeometry(size, size * 0.7, len); const m = new T.Mesh(g, duct); m.position.copy(mid); m.lookAt(b); extras.push(m); ahu.group.add(m); } };
  const V = (x, y, z) => new T.Vector3(x, y, z);
  if (isWard) { ductRun([V(-0.6, ahuY, ahuZ + 0.55), V(-0.6, H + 0.55, ahuZ + 0.6), V(-0.6, H + 0.55, -D / 2 + 0.6), V(W / 2 - 1.2, H + 0.55, -D / 2 + 0.6)]); }
  else { ductRun([V(-0.5, ahuY, ahuZ + 0.55), V(-0.5, H + 0.6, ahuZ + 0.6), V(-0.5, H + 0.6, -0.2), V(0, H + 0.6, 0), V(0, H + 0.15, 0)]); ductRun([V(0.9, ahuY - 0.3, ahuZ + 0.55), V(0.9, H + 0.35, -D / 2 - 0.4), V(W / 2 - 0.4, H + 0.35, -D / 2 - 0.4)], 0.35); }
  for (const m of extras) m.visible = false;
  const ahuBody = ahu.group.children.slice(0, 3);

  // ------------------------------------------------------------ OT
  if (!isWard) {
    // operating table
    const tbl = new T.Group(); room.add(tbl);
    cyl(tbl, 0.28, 0.34, 0.08, mat(0x3a4656), 0, 0.04, 0);
    cyl(tbl, 0.16, 0.16, 0.66, mat(0xd7dde4, { metal: 0.5 }), 0, 0.41, 0);
    boxM(tbl, 2.0, 0.08, 0.56, mat(0x2d3b4c), 0, 0.78, 0);
    boxM(tbl, 1.9, 0.07, 0.5, mat(0x2f6e8e, { rough: 0.8 }), 0, 0.85, 0);
    // LAF plenum with HEPA filters, and the clean air it blows down
    const laf = comp('laf'), hepa = comp('hepa');
    boxM(laf.group, 2.5, 0.22, 1.9, SS(), 0, H - 0.11, 0);
    const hepaTex = tex(256, 192, (g, w, h) => { g.fillStyle = '#f7f9fb'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c7cfd9'; g.lineWidth = 2; for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.strokeStyle = '#8f9bab'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); });
    add(hepa.group, new T.PlaneGeometry(2.3, 1.7), new T.MeshStandardMaterial({ map: hepaTex, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.05 }), 0, H - 0.225, 0, [Math.PI / 2, 0, 0]);
    for (const [x, z, w, d] of [[0, 0.92, 2.4, 0.05], [0, -0.92, 2.4, 0.05], [1.22, 0, 0.05, 1.8], [-1.22, 0, 0.05, 1.8]]) boxM(laf.group, w, 0.03, d, mat(0xffffff, { emissive: 0xfff6dd, ei: 0.9 }), x, H - 0.23, z);
    laf.anchor.set(-1.25, H - 0.05, 0.95); hepa.anchor.set(1.0, H - 0.3, 0.7);
    const n = 420, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 2.2; pos[i * 3 + 1] = 0.9 + Math.random() * 1.85; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.6; air.speed.push(0.35 + Math.random() * 0.35); }
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3));
    air.points = new T.Points(pg, new T.PointsMaterial({ color: 0x5aa9ff, size: 0.035, transparent: true, opacity: 0.75, depthWrite: false }));
    air.points.visible = air.on; room.add(air.points);
    // OT light
    const light = comp('otlight');
    cyl(light.group, 0.07, 0.07, 0.3, SS(), 0.5, H - 0.15, -0.4);
    cyl(light.group, 0.025, 0.025, 0.8, SS(), 0.5, H - 0.6, -0.4);
    for (const [x, y, z, r] of [[0.05, 2.12, 0.15, 0.34], [0.85, 2.22, -0.55, 0.28]]) {
      add(light.group, new T.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf2f4f7, { metal: 0.2, rough: 0.3 }), x, y, z);
      add(light.group, new T.CircleGeometry(r * 0.85, 28), mat(0xffffff, { emissive: 0xfff3d0, ei: 1.2 }), x, y - 0.001, z, [Math.PI / 2, 0, 0]);
      boxM(light.group, 0.03, 0.03, Math.hypot(x - 0.5, z + 0.4), SS(), (x + 0.5) / 2, y + 0.06, (z - 0.4) / 2, [0, Math.atan2(x - 0.5, z + 0.4), 0]);
    }
    light.anchor.set(0.05, 2.45, 0.15);
    // pendants (surgeon & anaesthesia) with gas outlets
    const pend = comp('pendants'), gas = comp('mgps');
    const pendant = (x, z, armX) => {
      cyl(pend.group, 0.09, 0.09, 0.35, SS(), x, H - 0.17, z);
      boxM(pend.group, Math.abs(armX), 0.09, 0.12, mat(0xe3e8ee, { metal: 0.3 }), x + armX / 2, H - 0.42, z);
      boxM(pend.group, 0.34, 1.05, 0.34, mat(0xe9edf2, { metal: 0.25, rough: 0.4 }), x + armX, 1.85, z);
      boxM(pend.group, 0.5, 0.03, 0.4, mat(0xd1d8e0, { metal: 0.4 }), x + armX, 1.42, z);
      cyl(pend.group, 0.035, 0.035, 0.85, SS(), x + armX, 2.45, z);
      outlets(gas.group, x + armX, 2.05, z + 0.175, 'z', 4);
    };
    pendant(-1.95, 1.25, 0.55); pendant(2.0, -1.35, -0.6);
    pend.anchor.set(-1.4, 2.5, 1.25); gas.anchor.set(-1.4, 2.12, 1.45);
    // wall gas panel
    boxM(gas.group, 0.03, 0.3, 0.6, mat(0xf0f3f6), -W / 2 + 0.07, 1.45, 1.9); outlets(gas.group, -W / 2 + 0.09, 1.45, 1.9, 'x', 4);
    // hermetic sliding door on the back wall
    const door = comp('doors');
    boxM(door.group, 1.7, 2.3, 0.08, mat(0xb3bdc8, { metal: 0.5 }), -1.6, 1.15, -D / 2 + 0.07);
    boxM(door.group, 0.85, 2.15, 0.06, mat(0xdde3ea, { metal: 0.55, rough: 0.3 }), -1.25, 1.08, -D / 2 + 0.13);
    boxM(door.group, 0.32, 0.32, 0.065, mat(0xa9d1f5, { opacity: 0.55, metal: 0.1, rough: 0.1 }), -1.25, 1.55, -D / 2 + 0.14);
    boxM(door.group, 0.04, 0.5, 0.05, mat(0x8995a5, { metal: 0.6 }), -0.9, 1.05, -D / 2 + 0.18);
    door.anchor.set(-1.25, 2.4, -D / 2 + 0.2);
    // surgeon's control panel (touch screen)
    const ctl = comp('control');
    const screen = tex(512, 320, (g, w, h) => {
      g.fillStyle = '#0f1c2e'; g.fillRect(0, 0, w, h); g.fillStyle = '#49a7ff'; g.font = 'bold 54px sans-serif'; g.fillText('22.0°C', 28, 92); g.fillStyle = '#7ce0a0'; g.fillText('50%', 290, 92);
      g.fillStyle = '#c9d6e8'; g.font = '26px sans-serif'; g.fillText('TEMP', 30, 130); g.fillText('HUMIDITY', 292, 130); g.fillText('PRESSURE +12 Pa', 30, 180);
      ['LIGHTS', 'GASES', 'TIMER', 'MUSIC'].forEach((t, i) => { g.fillStyle = '#1f3555'; g.fillRect(24 + i * 120, 220, 108, 70); g.fillStyle = '#e6eef9'; g.font = 'bold 22px sans-serif'; g.fillText(t, 34 + i * 120, 263); });
    });
    boxM(ctl.group, 0.95, 0.6, 0.05, mat(0x2c3540), 0.85, 1.5, -D / 2 + 0.08);
    add(ctl.group, new T.PlaneGeometry(0.88, 0.53), new T.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.9 }), 0.85, 1.5, -D / 2 + 0.106);
    ctl.anchor.set(0.85, 1.9, -D / 2 + 0.12);
    // room pressure gauge
    const pr = comp('pressure');
    const gauge = tex(128, 128, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#c0392b'; g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(98, 40); g.stroke(); });
    cyl(pr.group, 0.12, 0.12, 0.05, mat(0x30363e), -0.3, 2.15, -D / 2 + 0.08, [Math.PI / 2, 0, 0]);
    add(pr.group, new T.CircleGeometry(0.105, 24), new T.MeshStandardMaterial({ map: gauge }), -0.3, 2.15, -D / 2 + 0.106);
    pr.anchor.set(-0.3, 2.35, -D / 2 + 0.1);
    // automation: sensor + small display
    const au = comp('automation');
    add(au.group, new T.SphereGeometry(0.09, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffffff), -1.2, H - 0.001, -1.3, [Math.PI, 0, 0]);
    add(au.group, new T.CircleGeometry(0.03, 12), mat(0x2ecc71, { emissive: 0x2ecc71 }), -1.2, H - 0.095, -1.3, [Math.PI / 2, 0, 0]);
    boxM(au.group, 0.3, 0.2, 0.03, mat(0x1b2a3d, { emissive: 0x13416b, ei: 0.8 }), 0.2, 1.55, -D / 2 + 0.08);
    au.anchor.set(-1.2, H - 0.15, -1.3);
    // X-ray viewer on the left wall
    const xr = comp('xray');
    boxM(xr.group, 0.06, 0.6, 1.0, mat(0xf9fbff, { emissive: 0xe8f1ff, ei: 0.9 }), -W / 2 + 0.08, 1.55, 0.2);
    for (const dz of [-0.24, 0.24]) boxM(xr.group, 0.065, 0.45, 0.38, mat(0x3b4a5c, { opacity: 0.75 }), -W / 2 + 0.085, 1.55, 0.2 + dz);
    xr.anchor.set(-W / 2 + 0.1, 1.95, 0.2);
    // pass box and scrub station on the left wall
    const pb = comp('passbox');
    boxM(pb.group, 0.12, 0.62, 0.62, SS(), -W / 2 + 0.1, 1.15, -1.25);
    boxM(pb.group, 0.03, 0.5, 0.5, mat(0xa9d1f5, { opacity: 0.6 }), -W / 2 + 0.17, 1.15, -1.25);
    pb.anchor.set(-W / 2 + 0.15, 1.6, -1.25);
    const sc = comp('scrub');
    boxM(sc.group, 0.55, 0.45, 1.2, SS(), -W / 2 + 0.33, 0.95, -2.25);
    boxM(sc.group, 0.4, 0.12, 1.0, mat(0x9aa6b4, { metal: 0.7, rough: 0.25 }), -W / 2 + 0.35, 1.14, -2.25);
    for (const dz of [-0.3, 0.3]) cyl(sc.group, 0.02, 0.02, 0.35, SS(), -W / 2 + 0.2, 1.35, -2.25 + dz);
    sc.anchor.set(-W / 2 + 0.4, 1.55, -2.25);
    // SS storage cabinet
    const st = comp('storage');
    boxM(st.group, 1.25, 1.85, 0.36, SS(), 2.15, 1.25, -D / 2 + 0.23);
    boxM(st.group, 1.15, 1.7, 0.02, mat(0xa9d1f5, { opacity: 0.45 }), 2.15, 1.25, -D / 2 + 0.42);
    st.anchor.set(2.15, 2.35, -D / 2 + 0.3);
    // fumigation fogger
    const fu = comp('fumigation');
    boxM(fu.group, 0.4, 0.35, 0.3, mat(0x2e86de, { rough: 0.5 }), 2.2, 0.18, 2.1);
    cyl(fu.group, 0.04, 0.06, 0.2, mat(0x34495e), 2.2, 0.45, 2.1);
    fu.anchor.set(2.2, 0.75, 2.1);
    // return-air risers
    for (const x of [-2.5, 2.5]) boxM(ahu.group, 0.55, 0.75, 0.04, mat(0xdde3ea, { metal: 0.4 }), x, 0.55, -D / 2 + 0.07);
  }

  // ------------------------------------------------------------ ICU / NICU ward
  if (isWard) {
    const total = Math.max(1, opts.beds || 4), shown = Math.min(total, 6);
    const head = comp('bedhead'), gas = comp('mgps'), hp = comp('hepa');
    const war = nicu || opts.types.includes('nicu') || opts.features.includes('warmers') ? comp('warmers') : null;
    const span = Math.min(1.9, (W - 3) / shown);
    for (let i = 0; i < shown; i++) {
      const x = -W / 2 + 1.4 + i * span;
      const bed = new T.Group(); room.add(bed);
      if (nicu) {
        boxM(war.group, 0.95, 0.75, 0.6, mat(0xe9edf2, { metal: 0.2 }), x, 0.38, -1.95);
        add(war.group, new T.CylinderGeometry(0.33, 0.33, 0.85, 20, 1, false, 0, Math.PI), mat(0xbfe1ff, { opacity: 0.45, rough: 0.1, side: T.DoubleSide }), x, 0.77, -1.95, [0, 0, Math.PI / 2]);
        boxM(war.group, 0.7, 0.04, 0.42, mat(0xffffff), x, 0.77, -1.95);
      } else {
        boxM(bed, 0.95, 0.42, 1.95, mat(0x8a96a6, { metal: 0.4 }), x, 0.42, -1.85);
        boxM(bed, 0.88, 0.14, 1.85, mat(0x6fb3d2, { rough: 0.9 }), x, 0.68, -1.85);
        boxM(bed, 0.95, 0.5, 0.05, mat(0xd8dee6), x, 0.75, -2.85);
        if (war) boxM(war.group, 0.3, 0.3, 0.3, mat(0xe9edf2), x + 0.6, 0.15, -2.3);
      }
      boxM(head.group, Math.min(1.3, span - 0.2), 0.32, 0.08, mat(0xf3f5f8, { metal: 0.2 }), x, 1.45, -D / 2 + 0.09);
      outlets(gas.group, x, 1.45, -D / 2 + 0.14, 'z', 4);
      boxM(head.group, 0.42, 0.3, 0.06, mat(0x1b2a3d, { emissive: 0x0f5132, ei: 0.7 }), x, 1.95, -D / 2 + 0.12);
      add(hp.group, new T.PlaneGeometry(0.6, 0.6), mat(0xffffff, { emissive: 0xffffff, ei: 0.25 }), x, H - 0.005, -1.6, [Math.PI / 2, 0, 0]);
    }
    head.anchor.set(-W / 2 + 1.4, 1.75, -D / 2 + 0.15); gas.anchor.set(-W / 2 + 1.4 + span, 1.6, -D / 2 + 0.2); hp.anchor.set(-W / 2 + 1.4, H - 0.1, -1.6);
    war?.anchor.set(-W / 2 + 1.4, nicu ? 1.3 : 0.5, nicu ? -1.95 : -2.3);
    if (total > shown) opts.moreBeds = total - shown;
    // nurse station
    const ns = comp('nurse');
    boxM(ns.group, 2.4, 0.95, 0.6, mat(0xf4f6f9, { rough: 0.5 }), -0.6, 0.48, 1.6);
    boxM(ns.group, 0.6, 0.95, 1.2, mat(0xf4f6f9, { rough: 0.5 }), 0.9, 0.48, 1.3);
    boxM(ns.group, 0.5, 0.32, 0.04, mat(0x1b2a3d, { emissive: 0x13416b, ei: 0.8 }), -0.6, 1.15, 1.5);
    ns.anchor.set(-0.6, 1.5, 1.6);
    // isolation cubicle with glass walls and a pressure gauge
    const iso = comp('pressure');
    const glass = mat(0xbfe1ff, { opacity: 0.3, rough: 0.1, side: T.DoubleSide });
    boxM(iso.group, 0.04, H, 2.6, glass, W / 2 - 2.4, H / 2, -1.7);
    boxM(iso.group, 2.35, H, 0.04, glass, W / 2 - 1.2, H / 2, -0.4);
    cyl(iso.group, 0.11, 0.11, 0.04, mat(0x30363e), W / 2 - 2.36, 2.2, -0.9, [0, 0, Math.PI / 2]);
    boxM(iso.group, 0.95, 0.42, 1.9, mat(0x8a96a6, { metal: 0.4 }), W / 2 - 1.2, 0.42, -1.9);
    iso.anchor.set(W / 2 - 1.2, 2.6, -0.5);
    // hand-wash, door, storage, automation, fumigation
    const hw = comp('handwash');
    boxM(hw.group, 0.5, 0.35, 0.8, SS(), -W / 2 + 0.3, 0.9, 1.3); hw.anchor.set(-W / 2 + 0.35, 1.4, 1.3);
    const door = comp('doors');
    boxM(door.group, 0.07, 2.2, 1.5, mat(0xb3bdc8, { metal: 0.5 }), -W / 2 + 0.07, 1.1, -0.5);
    boxM(door.group, 0.05, 2.1, 0.75, mat(0xdde3ea, { metal: 0.55 }), -W / 2 + 0.12, 1.05, -0.2);
    door.anchor.set(-W / 2 + 0.15, 2.35, -0.3);
    const st = comp('storage'); boxM(st.group, 1.0, 1.8, 0.35, SS(), W / 2 - 0.5, 0.9, 1.6, [0, Math.PI / 2, 0]); st.anchor.set(W / 2 - 0.5, 1.95, 1.6);
    const au = comp('automation'); boxM(au.group, 0.3, 0.2, 0.03, mat(0x1b2a3d, { emissive: 0x13416b, ei: 0.8 }), 1.6, 1.6, -D / 2 + 0.08); au.anchor.set(1.6, 1.85, -D / 2 + 0.1);
    const fu = comp('fumigation'); boxM(fu.group, 0.4, 0.35, 0.3, mat(0x2e86de), -W / 2 + 0.6, 0.18, 2.5); fu.anchor.set(-W / 2 + 0.6, 0.7, 2.5);
  }

  for (const [key, c] of Object.entries(comps)) {
    c.group.traverse(o => { o.userData.key = key; });
    if (!c.group.parent) room.add(c.group);
  }

  // ------------------------------------------------------------ labels, info card, toggles
  const picked = new Set(opts.features);
  const tags = {};
  const info = el('div', 'info'); info.hidden = true;
  const showInfo = key => {
    const i = opts.info[key] || { label: key, hint: '' };
    info.replaceChildren(el('b', null, i.label), el('div', null, i.hint), picked.has(key) ? el('div', 'yes', '✓ In your plan') : el('div', 'yes', ''));
    const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { info.hidden = true; }; info.append(x);
    info.hidden = false;
  };
  for (const key of Object.keys(comps)) {
    if (!opts.info[key]) continue;
    const t = el('button', 'tag' + (picked.has(key) ? ' on' : ''));
    t.type = 'button'; t.append(el('i'), document.createTextNode(opts.info[key].label));
    t.onclick = e => { e.stopPropagation(); showInfo(key); };
    tags[key] = t; box.append(t);
  }
  const hint = el('div', 'hint3d', opts.moreBeds ? `Showing 6 of ${opts.moreBeds + 6} beds · drag to turn` : 'Drag to turn · tap a part');
  box.append(hint, info);
  const narrow = box.clientWidth < 600;
  let onlyMine = false, anatomy = false, allLabels = !narrow;
  const applyVisibility = () => {
    for (const [key, c] of Object.entries(comps)) {
      const base = ['panels', 'flooring'].includes(key);
      c.group.visible = base || !onlyMine || picked.has(key);
      if (tags[key]) tags[key].classList.toggle('hidden', !c.group.visible || (key === 'ahu' && !anatomy) || (!allLabels && !picked.has(key) && !(anatomy && key === 'ahu')));
    }
    for (const m of extras) m.visible = anatomy;
    for (const m of ahuBody) m.visible = anatomy;
    ceiling.visible = !anatomy;
    if (air.points) air.points.visible = air.on && (comps.laf?.group.visible ?? true);
  };
  applyVisibility();

  const target = new T.Vector3(0, 1.1, 0);
  const views = {
    overview: isWard ? [V(6.2, 5.2, 7.2), V(0, 0.9, -0.3)] : [V(6.8, 5.6, 7.6), V(0, 1.1, 0)],
    eye: isWard ? [V(-1, 1.7, 2.6), V(-1.5, 1.2, -2.2)] : [V(1.5, 1.7, 1.9), V(0, 1.1, 0)],
    top: isWard ? [V(0.01, 12, 6), V(0, 2, -1)] : [V(0.01, 9.5, 5.5), V(0, 2.4, -1)],
  };
  let anim = null;
  const fit = () => { const a = Math.max(0.3, box.clientWidth / Math.max(1, box.clientHeight)); return a < 1.3 ? Math.min(1.75, (1.3 / a) ** 0.55) : 1; };
  const viewPos = name => { const [p, t] = views[name]; return name === 'eye' ? [p, t] : [t.clone().add(p.clone().sub(t).multiplyScalar(fit())), t]; };
  const fly = (name) => { const [p, t] = viewPos(name); anim = { p0: camera.position.clone(), t0: controls.target.clone(), p, t, start: performance.now() }; };

  // tap a part of the room
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(Object.values(comps).map(c => c.group).filter(g => g.visible), true).find(i => i.object.visible && opts.info[i.object.userData.key]);
    if (hit) showInfo(hit.object.userData.key); else info.hidden = true;
  });

  // ------------------------------------------------------------ size & loop
  const resize = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(box); resize();
  { const [p, t] = viewPos('overview'); camera.position.copy(p); controls.target.copy(t); }
  const v = new T.Vector3();
  let raf = 0, last = performance.now();
  const loop = now => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (anim) {
      const k = Math.min(1, (now - anim.start) / 900), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(anim.p0, anim.p, e); controls.target.lerpVectors(anim.t0, anim.t, e);
      if (k >= 1) anim = null;
    }
    if (air.points?.visible) {
      const p = air.points.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) - air.speed[i] * dt; if (y < 0.9) y = H - 0.25; p.setY(i, y); }
      p.needsUpdate = true;
    }
    controls.update();
    renderer.render(scene, camera);
    const w = box.clientWidth, h = box.clientHeight;
    const placed = [];
    for (const key of order) {
      const t = tags[key];
      if (t.classList.contains('hidden')) continue;
      v.copy(comps[key].anchor).project(camera);
      const tw = (t._w ||= t.offsetWidth || 120), th = 24;
      const x0 = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      const x = Math.min(Math.max(x0, tw / 2 + 4), Math.max(tw / 2 + 4, w - tw / 2 - 4)); // keep the whole label on screen
      const hits = r => placed.some(p => r[0] < p[2] + 4 && r[2] > p[0] - 4 && r[1] < p[3] + 2 && r[3] > p[1] - 2);
      // move a label up or down a little if it would sit on another one; hide it only if there is no room
      let rect = null, yy = y;
      if (!(v.z > 1 || x0 < -20 || x0 > w + 20 || y < 10 || y > h + 10)) for (const dy of [0, 27, -27, 54, -54]) { const r = [x - tw / 2, y + dy - th, x + tw / 2, y + dy]; if (!hits(r) && r[1] > 0 && r[3] < h) { rect = r; yy = y + dy; break; } }
      t.style.display = rect ? '' : 'none';
      if (rect) { placed.push(rect); t.style.left = `${x}px`; t.style.top = `${yy}px`; }
      t.classList.toggle('dim', !picked.has(key));
    }
  };
  const order = Object.keys(tags).sort((a, b) => Number(picked.has(b)) - Number(picked.has(a)));
  raf = requestAnimationFrame(loop);
  const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', vis);

  return {
    controls: [
      { label: 'Show only my choices', pressed: false, run: () => { onlyMine = !onlyMine; applyVisibility(); return onlyMine; } },
      { label: 'All labels', pressed: allLabels, run: () => { allLabels = !allLabels; applyVisibility(); return allLabels; } },
      { label: 'See above the ceiling', pressed: false, run: () => { anatomy = !anatomy; applyVisibility(); fly(anatomy ? 'top' : 'overview'); return anatomy; } },
      ...(isWard ? [] : [{ label: 'Clean air flow', pressed: air.on, run: () => { air.on = !air.on; applyVisibility(); return air.on; } }]),
      { label: isWard ? '👁 Bed-side view' : "👁 Surgeon's view", run: () => { fly('eye'); } },
      { label: '↺ Overview', run: () => { fly('overview'); } },
    ],
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); });
      for (const m of Object.values(mats)) { m.map?.dispose?.(); m.dispose(); }
      renderer.dispose(); renderer.forceContextLoss?.();
    },
  };
}
