// 3D cut-away of a WIESPL modular OT (or ICU / NICU ward), built from what the visitor picked.
// Realistic materials (reflective stainless steel, soft shadows), an "anatomy" view of the complete clean-air cycle
// (outdoor unit → AHU stages → supply duct → HEPA plenum → laminar flow → return risers → AHU) and a guided tour.
// three.js comes from the jsDelivr CDN; without it (offline / no WebGL) a plain list is shown instead.
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

// Parts of the system that are not on the feature list but are explained in the 3D view.
const PARTS = {
  risers: { label: 'Return air risers', hint: 'Used air leaves the OT low down near the floor, so contaminated air is drawn away from the patient and back to the AHU.' },
  ahu_pre: { label: '1 · Pre-filter', hint: 'Washable flange-type filter (90% down to 10 microns, as NABH asks): catches dust and larger particles from fresh and return air.' },
  ahu_fine: { label: '2 · Fine filter', hint: 'Second washable filter (99% down to 5 microns): removes finer dust so the HEPA filters at the OT last much longer.' },
  ahu_coil: { label: '3 · Cooling coil', hint: 'Chilled by the outdoor unit: cools the air and wrings out moisture, so the OT stays at 21 ± 3 °C (18 ± 2 °C for joint replacement) and 20–60% RH.' },
  shrm: { label: '4 · SHRM (WIESPL patent)', icon: '♻️', hint: 'Smart Heat Recovery Management: after the coil has dried the air, SHRM re-warms it with heat recovered inside the system instead of electric heaters. Humidity is held precisely with no extra electrical load, cutting power and running costs.' },
  ahu_fan: { label: '5 · Blower (VFD)', hint: 'Pushes the air through the ducts and HEPA filters. A variable-frequency drive holds the set air velocity and slows down at night (NABH allows air changes to drop to 25% when the OT is not in use).' },
  ahu_heat: { label: '6 · UV lamps', hint: 'UV-C lamps keep the coil and drain pan free of germs. Without SHRM an electric heater bank (shown red) sits here to re-heat the air.' },
  odu: { label: 'Outdoor unit', hint: 'The compressor outside the building. Copper pipes carry refrigerant to the cooling coil in the AHU.' },
  ducts: { label: 'Supply & return ducts', hint: 'Insulated GI ducts: blue arrows carry clean air to the HEPA plenum, orange arrows bring room air back to the AHU.' },
  velocity: { label: 'Air velocity sensor', icon: '📟', hint: 'Measures how fast the clean air leaves the plenum. NABH recommends 25–35 feet per minute over the table; the reading shows on the surgeon’s panel and the AHU blower adjusts to hold it.' },
  passage: { label: 'Clean passage', hint: 'Staff reach the OT through a clean passage; scrubbing is done here, outside the theatre.' },
  table: { label: 'Operating table', hint: 'Sits directly under the laminar flow plenum, inside the column of clean air.' },
};

function fallback(box, opts, keys) {
  box.replaceChildren();
  Object.assign(box.style, { height: 'auto', minHeight: '0', padding: '14px', background: 'var(--surface-2)' });
  box.append(el('p', null, 'The 3D view needs an internet connection and a recent browser. Here is what a WIESPL room includes:'));
  const ul = el('ul'); ul.style.paddingLeft = '18px';
  for (const k of keys) {
    const i = opts.info[k] || PARTS[k]; if (!i) continue;
    const li = el('li'); li.append(el('b', null, i.label + (opts.features.includes(k) ? '  ✓' : '')), document.createTextNode(` – ${i.hint}`)); ul.append(li);
  }
  box.append(ul);
  return { dispose() {} };
}

// Wall panel finishes, chosen by tapping a wall. Colours: [name, swatch, tint over the texture].
export const WALL_FINISHES = [
  { key: 'ss', name: 'Stainless steel (SS 304)', hint: 'Brushed SS 304 skin on 50 mm PUF panels. Natural steel: no colour to choose.', colours: [['Natural steel', 0xd3d9df]], metal: 0.85, rough: 0.3 },
  { key: 'ppgi', name: 'PPGI', hint: 'Pre-painted galvanised steel panels with an antibacterial coat, in one off-white shade.', colours: [['Off-white', 0xeceee8]], metal: 0.1, rough: 0.35 },
  { key: 'glass', name: 'Toughened glass', hint: 'Back-painted 8 mm toughened glass panels: seamless, glossy and easy to wipe.', colours: [['Ivory white', 0xece3cc], ['Sky blue', 0x6fa8dc], ['Mint green', 0x7cc7a4]], metal: 0, rough: 0.12 },
  { key: 'wood', name: 'Wooden finish (HPL)', hint: 'High-pressure laminate with a warm wood look, as in WIESPL passages and lobbies.', colours: [['Light oak', 0xc9a57c, 0xffffff], ['Walnut', 0x8a6142, 0x9c7c64]], metal: 0.05, rough: 0.5 },
];
// Seamless vinyl floor: the client picks two colours (main field and border).
export const FLOOR_COLOURS = [['Beige', '#cbc6b9'], ['Grey', '#a7b3c0'], ['Sky blue', '#8fb0cf'], ['Aqua green', '#8cc7b5'], ['Navy blue', '#3e5f8a'], ['Light grey', '#d5dae0']];
const finishOf = (key, colour) => { const f = WALL_FINISHES.find(x => x.key === key) || WALL_FINISHES[0]; return [f, f.colours.find(c => c[0] === colour) || f.colours[0]]; };

// Scenic digital wallpaper (mountains, lake, meadow) as used on WIESPL OT and passage walls.
function drawLandscape(g, w, h) {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.55); sky.addColorStop(0, '#1d5fd6'); sky.addColorStop(1, '#8cc8ff'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 6; i++) { const cx = Math.random() * w, cy = h * (0.06 + Math.random() * 0.18); for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(cx + k * 18, cy + Math.sin(k) * 6, 30, 14, 0, 0, Math.PI * 2); g.fill(); } }
  const ridge = (y0, amp, col, snow) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h * 0.58); const pts = []; for (let x = 0; x <= w; x += w / 14) { const y = h * y0 - Math.abs(Math.sin(x * 0.011 + y0 * 9)) * h * amp - Math.random() * h * 0.03; pts.push([x, y]); g.lineTo(x, y); } g.lineTo(w, h * 0.58); g.fill(); if (snow) { g.fillStyle = 'rgba(255,255,255,.9)'; for (const [x, y] of pts) { g.beginPath(); g.moveTo(x - 22, y + 26); g.lineTo(x, y); g.lineTo(x + 22, y + 26); g.fill(); } } };
  ridge(0.42, 0.22, '#6b7f9e', true); ridge(0.5, 0.14, '#4d6a55', false);
  const lake = g.createLinearGradient(0, h * 0.58, 0, h * 0.8); lake.addColorStop(0, '#2c73c9'); lake.addColorStop(1, '#174f99'); g.fillStyle = lake; g.fillRect(0, h * 0.58, w, h * 0.22);
  g.save(); g.globalAlpha = 0.35; g.translate(0, h * 1.16); g.scale(1, -1); g.drawImage(g.canvas, 0, 0, w, h * 0.58, 0, 0, w, h * 0.58); g.restore();
  const grass = g.createLinearGradient(0, h * 0.78, 0, h); grass.addColorStop(0, '#5fb53a'); grass.addColorStop(1, '#2f7d22'); g.fillStyle = grass; g.beginPath(); g.moveTo(0, h * 0.8); g.quadraticCurveTo(w * 0.5, h * 0.74, w, h * 0.82); g.lineTo(w, h); g.lineTo(0, h); g.fill();
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,${200 + Math.random() * 55},${0.6 + Math.random() * 0.4})`; g.beginPath(); g.arc(Math.random() * w, h * (0.84 + Math.random() * 0.16), 1.5 + Math.random() * 3, 0, Math.PI * 2); g.fill(); }
}

export async function mount3D(box, opts) {
  const isWard = !opts.types.some(t => ['ot', 'cathlab'].includes(t));
  const nicu = opts.types.includes('nicu') && !opts.types.some(t => ['icu', 'picu'].includes(t));
  const OT_KEYS = ['laf', 'hepa', 'otlight', 'pendants', 'mgps', 'doors', 'control', 'xray', 'scrub', 'passbox', 'storage', 'automation', 'pressure', 'fumigation', 'panels', 'flooring', 'ahu', 'lead'];
  const WARD_KEYS = ['bedhead', 'mgps', 'hepa', 'nurse', 'pressure', 'handwash', 'doors', 'storage', 'automation', 'fumigation', 'panels', 'flooring', 'ahu', 'warmers'];
  const keys = isWard ? WARD_KEYS : OT_KEYS;
  if (!webgl()) return fallback(box, opts, keys);
  try { await loadThree(); } catch { return fallback(box, opts, keys); }
  if (!box.isConnected) return { dispose() {} };
  const T = window.THREE;
  const small = Math.min(box.clientWidth, box.clientHeight) < 520 || /Mobi|Android/i.test(navigator.userAgent);
  const info = k => (anatomyTags.has(k) && PARTS[k]) || opts.info[k] || PARTS[k];

  // ------------------------------------------------------------ renderer, environment, lights
  box.replaceChildren();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  box.append(renderer.domElement);
  const scene = new T.Scene();
  // Soft studio reflections for the stainless steel, made from a few glowing panels around a grey room.
  {
    const envScene = new T.Scene();
    envScene.add(new T.Mesh(new T.BoxGeometry(20, 12, 20), new T.MeshBasicMaterial({ color: 0x9aa4b2, side: T.BackSide })));
    const soft = (w, h, x, y, z, ry, rx, c = 0xffffff) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); envScene.add(m); };
    soft(8, 1.6, 0, 5.8, 0, 0, Math.PI / 2, 0xfff8ee); soft(4, 5, -9.8, 2, 0, Math.PI / 2); soft(4, 5, 9.8, 2, 3, -Math.PI / 2, 0, 0xe8f0ff); soft(6, 2, 0, 3, -9.8, 0);
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.03).texture;
    pm.dispose();
  }
  const camera = new T.PerspectiveCamera(42, 1, 0.05, 120);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.497, minDistance: 1.2, maxDistance: 24, rotateSpeed: 0.8 });
  scene.add(new T.HemisphereLight(0xf2f6ff, 0x7d8ca3, 0.5));
  const sun = new T.DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 13, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 }); sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new T.DirectionalLight(0xdfe9ff, 0.35); fill.position.set(-9, 6, -5); scene.add(fill);

  // ------------------------------------------------------------ materials & geometry helpers
  const tex = (w, h, draw, rep) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; };
  const brushed = tex(256, 256, (g, w, h) => { g.fillStyle = '#cfd6de'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1600; i++) { const y = Math.random() * h; g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '90,100,115'},${Math.random() * 0.05})`; g.fillRect(0, y, w, 0.6 + Math.random()); } }, [3, 3]);
  const wood = tex(512, 512, (g, w, h) => { g.fillStyle = '#c9a57c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${Math.random() > 0.5 ? '120,80,40' : '235,205,170'},${0.08 + Math.random() * 0.1})`; g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, h * 0.3, x - 6, h * 0.7, x + 3, h); g.stroke(); } g.fillStyle = 'rgba(80,55,30,.35)'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h); }, [2, 1]);
  const M = {
    ss: new T.MeshStandardMaterial({ color: 0xdfe4ea, map: brushed, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.1 }),
    ssDark: new T.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.85, roughness: 0.35 }),
    chrome: new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
    panel: new T.MeshStandardMaterial({ color: 0xd3d9df, metalness: 0.85, roughness: 0.3, envMapIntensity: 0.9 }),
    cut: new T.MeshStandardMaterial({ color: 0xd3d9df, metalness: 0.2, roughness: 0.5, envMapIntensity: 0.4 }),
    trim: new T.MeshStandardMaterial({ color: 0xe9edf2, metalness: 0.2, roughness: 0.4 }),
    seam: new T.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.4, roughness: 0.5 }),
    white: new T.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.05, roughness: 0.45, envMapIntensity: 0.45 }),
    grey: new T.MeshStandardMaterial({ color: 0x5d6876, metalness: 0.3, roughness: 0.55 }),
    dark: new T.MeshStandardMaterial({ color: 0x252c36, metalness: 0.4, roughness: 0.45 }),
    rubber: new T.MeshStandardMaterial({ color: 0x1e2a38, metalness: 0, roughness: 0.75 }),
    mattress: new T.MeshStandardMaterial({ color: 0x1c4466, metalness: 0, roughness: 0.75, envMapIntensity: 0.3 }),
    glass: new T.MeshStandardMaterial({ color: 0xcfe7ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.22, envMapIntensity: 1.5, depthWrite: false }),
    led: new T.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false }),
    ledCool: new T.MeshBasicMaterial({ color: 0xeef6ff, toneMapped: false }),
    puf: new T.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.85 }),
    leadSheet: new T.MeshStandardMaterial({ color: 0x4f5762, metalness: 0.6, roughness: 0.45 }),
    duct: new T.MeshStandardMaterial({ color: 0xa9b6c4, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide }),
    ahu: new T.MeshStandardMaterial({ color: 0x6f93bb, metalness: 0.35, roughness: 0.42 }),
    copper: new T.MeshStandardMaterial({ color: 0xc8794a, metalness: 0.9, roughness: 0.3 }),
    blue: new T.MeshStandardMaterial({ color: 0x2f7fd8, metalness: 0.2, roughness: 0.45 }),
  };
  const look = { wall: { finish: 'ss', colour: 'Natural steel' }, floor: { main: 'Beige', border: 'Grey' } };
  const setFinish = (key, colour) => {
    const [f, c] = finishOf(key, colour);
    look.wall = { finish: f.key, colour: c[0] };
    for (const m of [M.panel, M.cut]) {
      m.color.setHex(f.key === 'wood' ? c[2] : c[1]); m.metalness = f.metal; m.roughness = f.rough;
      m.map = f.key === 'ss' ? brushed : f.key === 'wood' ? wood : null;
      m.envMapIntensity = f.key === 'ss' ? 0.9 : f.key === 'glass' ? 0.55 : 0.35; m.needsUpdate = true;
    }
  };
  setFinish(opts.wall?.finish, opts.wall?.colour);
  const mats = [];
  const C = (color, o = {}) => { const m = new T.MeshStandardMaterial({ color, metalness: o.metal ?? 0.1, roughness: o.rough ?? 0.5, transparent: o.opacity != null, opacity: o.opacity ?? 1, depthWrite: o.opacity == null, emissive: o.emissive ?? 0, emissiveIntensity: o.ei ?? 1, side: o.side ?? T.FrontSide }); mats.push(m); return m; };
  const put = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = !mat.transparent; parent.add(m); return m; };
  const B = (w, h, d) => new T.BoxGeometry(w, h, d);
  const Cy = (r1, r2, h, seg = 24, open = false, ts = 0, tl = Math.PI * 2) => new T.CylinderGeometry(r1, r2, h, seg, 1, open, ts, tl);
  // Box with rounded edges (consoles, cabinets, AHU casing …); built in the XY plane, d along Z.
  const RB = (w, h, d, r = 0.03) => {
    r = Math.max(0.002, Math.min(r, w / 2 - 0.002, h / 2 - 0.002));
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const bev = Math.min(r, d / 4);
    const g = new T.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.9, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -(d - 2 * bev) / 2);
    return g;
  };
  const V = (x, y, z) => new T.Vector3(x, y, z);

  // ------------------------------------------------------------ registry of explainable parts
  const comps = {};
  const comp = key => (comps[key] ||= { group: Object.assign(new T.Group(), { name: key }), anchor: new T.Vector3(), view: null });
  const extras = [];      // only in the anatomy view (above the ceiling)
  const anatomyTags = new Set(['ahu_pre', 'ahu_fine', 'ahu_coil', 'shrm', 'ahu_fan', 'ahu_heat', 'odu', 'ducts']);
  const AHU_KEYS = new Set(['ahu', 'ahu_pre', 'ahu_fine', 'ahu_coil', 'shrm', 'ahu_fan', 'ahu_heat']);
  const spinning = [];    // blower wheel, ODU fan
  const flows = [];       // animated arrows along the ducts
  const W = isWard ? 9 : 6, D = 6, H = 3;
  const room = new T.Group(); scene.add(room);

  // gas outlets (O2 white, N2O blue, air black, vacuum yellow, CO2 grey) and power sockets
  const GAS = [0xffffff, 0x2a62c9, 0x1b1b1b, 0xf2c200, 0x8a8f96];
  const outlets = (parent, x, y, z, face = 'z', n = 4, gap = 0.1) => {
    for (let i = 0; i < n; i++) {
      const o = new T.Group();
      put(o, Cy(0.034, 0.034, 0.025, 16), M.chrome, 0, 0, 0, Math.PI / 2);
      put(o, Cy(0.022, 0.022, 0.03, 14), C(GAS[i % GAS.length], { rough: 0.35 }), 0, 0, 0.006, Math.PI / 2);
      const d = (i - (n - 1) / 2) * gap;
      if (face === 'z') o.position.set(x + d, y, z); else { o.position.set(x, y, z + d); o.rotation.y = Math.PI / 2; }
      parent.add(o);
    }
  };
  const sockets = (parent, x, y, z, n = 2, face = 'z') => {
    for (let i = 0; i < n; i++) { const g = put(parent, B(0.07, 0.07, 0.015), M.white, 0, y, 0); const d = (i - (n - 1) / 2) * 0.09; if (face === 'z') g.position.set(x + d, y, z); else { g.position.set(x, y, z + d); g.rotation.y = Math.PI / 2; } }
  };

  // ------------------------------------------------------------ room shell: modular panels, coving, floor, ceiling
  const panels = comp('panels');
  const flooring = comp('flooring');
  // seamless vinyl: border colour round the edge with a darker inlay line, main colour in the field under the table
  const paintFloor = (g, w, h, main, border) => {
    const hex = n => (FLOOR_COLOURS.find(c => c[0] === n) || FLOOR_COLOURS[0])[1];
    const speck = (x0, y0, ww, hh, base, n) => { g.fillStyle = base; g.fillRect(x0, y0, ww, hh); for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '60,70,85'},${Math.random() * 0.14})`; g.fillRect(x0 + Math.random() * ww, y0 + Math.random() * hh, 2, 2); } };
    const rr = (x, y, ww, hh, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, ww, hh, r); else g.rect(x, y, ww, hh); };
    speck(0, 0, w, h, hex(border), 26000);
    const band = isWard ? 0.06 : 0.17, inner = band + 0.035;
    g.strokeStyle = 'rgba(30,45,70,.35)'; g.lineWidth = 10; rr(w * band, h * band, w * (1 - 2 * band), h * (1 - 2 * band), 40); g.stroke();
    g.save(); rr(w * inner, h * inner, w * (1 - 2 * inner), h * (1 - 2 * inner), 30); g.clip(); speck(0, 0, w, h, hex(main), 22000); g.restore();
  };
  const floorTex = tex(1024, 1024, (g, w, h) => paintFloor(g, w, h, opts.floor?.main || look.floor.main, opts.floor?.border || look.floor.border));
  const setFloor = (main, border) => {
    look.floor = { main: FLOOR_COLOURS.some(c => c[0] === main) ? main : look.floor.main, border: FLOOR_COLOURS.some(c => c[0] === border) ? border : look.floor.border };
    paintFloor(floorTex.image.getContext('2d'), floorTex.image.width, floorTex.image.height, look.floor.main, look.floor.border); floorTex.needsUpdate = true;
  };
  setFloor(opts.floor?.main, opts.floor?.border);
  put(flooring.group, new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.25 }), 0, 0, 0, -Math.PI / 2);
  flooring.anchor.set(W / 2 - 1.2, 0.05, D / 2 - 1.2);
  const slabTex = tex(512, 512, (g, w, h) => { g.fillStyle = '#6f7884'; g.fillRect(0, 0, w, h); g.fillStyle = '#58606b'; for (let x = 40; x < w; x += 92) for (let y = 40; y < h; y += 92) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); } });
  put(flooring.group, B(W + 0.14, 0.18, D + 0.14), new T.MeshStandardMaterial({ map: slabTex, metalness: 0.35, roughness: 0.55 }), 0, -0.095, 0);
  // panel walls: 1.2 m wide panels with slim seams
  const panelWall = (len, axis, fixed, h, thick = 0.06) => {
    const n = Math.round(len / 1.2), pw = len / n;
    for (let i = 0; i < n; i++) {
      const c = -len / 2 + pw * (i + 0.5);
      const p = put(panels.group, B(pw - 0.008, h, thick), M.panel); p.userData.wall = true;
      if (axis === 'x') p.position.set(c, h / 2, fixed); else { p.position.set(fixed, h / 2, c); p.rotation.y = Math.PI / 2; }
    }
  };
  panelWall(W, 'x', -D / 2, H); panelWall(D, 'z', -W / 2, H);
  put(panels.group, B(W, H, 0.01), M.seam, 0, H / 2, -D / 2 - 0.035);
  put(panels.group, B(0.01, H, D), M.seam, -W / 2 - 0.035, H / 2, 0);
  // cut-away walls showing what a WIESPL panel is made of: steel skin, PUF insulation, (lead), steel skin
  const lead = opts.features.includes('lead') || opts.types.includes('cathlab');
  const cutH = 0.75;
  const layered = (len, axis, fixed) => {
    const layers = [[M.cut, 0.012], [M.puf, 0.07], ...(lead ? [[M.leadSheet, 0.01]] : []), [M.panel, 0.012]];
    let off = 0;
    for (const [m, t] of layers) {
      const c = fixed - off - t / 2; // layers stack inwards from the outside face
      put(panels.group, axis === 'x' ? B(len, cutH, t) : B(t, cutH, len), m, axis === 'x' ? 0 : c, cutH / 2, axis === 'x' ? c : 0).userData.wall = true;
      off += t;
    }
  };
  layered(W, 'x', D / 2); layered(D, 'z', W / 2);
  // rounded coving where floor meets wall and wall meets wall
  { const c = put(panels.group, Cy(0.09, 0.09, W, 12, false, 0, Math.PI / 2), M.panel, 0, 0, -D / 2 + 0.03); c.rotation.set(Math.PI, 0, Math.PI / 2); }
  { const c = put(panels.group, Cy(0.09, 0.09, D, 12, false, 0, Math.PI / 2), M.panel, -W / 2 + 0.03, 0, 0); c.rotation.set(Math.PI / 2, 0, Math.PI); }
  { const c = put(panels.group, Cy(0.09, 0.09, H, 12, false, 0, Math.PI / 2), M.panel, -W / 2 + 0.03, H / 2, -D / 2 + 0.03); c.rotation.y = Math.PI; }
  panels.anchor.set(-W / 2 + 0.08, 2.35, -D / 4);
  if (lead) { const l = comp('lead'); l.anchor.set(W / 2 - 0.04, cutH + 0.05, D / 4); }
  // modular ceiling: only seen from inside / below (from above it is see-through)
  const ceiling = new T.Group(); room.add(ceiling);
  const cm = put(ceiling, new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5, metalness: 0.1, side: T.BackSide }), 0, H, 0, -Math.PI / 2);
  cm.castShadow = false;
  {
    const ch = 0.42; const chamMat = M.panel;
    const back = put(ceiling, new T.PlaneGeometry(W, ch * Math.SQRT2), chamMat, 0, H - ch / 2, -D / 2 + 0.03 + ch / 2, -Math.PI / 4, 0, 0);
    const left = put(ceiling, new T.PlaneGeometry(ch * Math.SQRT2, D), chamMat, -W / 2 + 0.03 + ch / 2, H - ch / 2, 0, -Math.PI / 2, Math.PI / 4, 0);
    left.rotation.set(-Math.PI / 2, Math.PI / 4, 0); back.castShadow = left.castShadow = false;
    const ledSpots = isWard ? [[-3, 1.2], [0, 1.2], [3, 1.2], [-3, -0.4], [3, -0.4]] : [[-2.0, 1.8], [2.0, 1.8], [-2.0, -1.6], [2.0, -1.6]];
    for (const [x, z] of ledSpots) { put(ceiling, B(0.62, 0.02, 0.62), M.white, x, H - 0.011, z).castShadow = false; put(ceiling, new T.PlaneGeometry(0.56, 0.56), M.ledCool, x, H - 0.022, z, Math.PI / 2).castShadow = false; }
  }
  // ground outside the room catches soft shadows
  const FLOAT = 0.85; // the room floats above the studio floor, like a product shot
  const ground = new T.Mesh(new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -FLOAT; ground.receiveShadow = true; scene.add(ground);
  const blob = tex(256, 256, g => { const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, 'rgba(20,30,45,0.45)'); gr.addColorStop(0.55, 'rgba(20,30,45,0.18)'); gr.addColorStop(1, 'rgba(20,30,45,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
  const shadowBlob = new T.Mesh(new T.PlaneGeometry(W * 1.7, D * 1.7), new T.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
  shadowBlob.rotation.x = -Math.PI / 2; shadowBlob.position.y = -FLOAT + 0.003; scene.add(shadowBlob);

  // ------------------------------------------------------------ terrace: AHU with its stages, outdoor unit, ducts
  const ahu = comp('ahu');
  extras.push(put(ahu.group, B(W + 1.2, 0.08, 3.4), C(0xb9c3cf, { rough: 0.9, opacity: 0.55 }), 0.3, H + 0.6, -D / 2 - 1.75));
  const AX = isWard ? -1.5 : 0, AY = H + 1.27, AZ = -D / 2 - 1.85;
  const ahuBody = new T.Group(); ahuBody.position.set(AX, AY, AZ); ahu.group.add(ahuBody); extras.push(ahuBody);
  // casing: solid back, top, bottom and ends; see-through front so the stages show
  put(ahuBody, B(2.7, 0.06, 1.2), M.ahu, 0, -0.62, 0); put(ahuBody, B(2.7, 0.06, 1.2), M.ahu, 0, 0.62, 0);
  put(ahuBody, B(2.7, 1.3, 0.05), M.ahu, 0, 0, -0.58); put(ahuBody, B(0.05, 1.3, 1.2), M.ahu, -1.33, 0, 0); put(ahuBody, B(0.05, 1.3, 1.2), M.ahu, 1.33, 0, 0);
  put(ahuBody, B(2.7, 1.3, 0.02), M.glass, 0, 0, 0.6);
  for (const x of [-1.33, -0.62, 0.22, 1.33]) put(ahuBody, B(0.04, 1.32, 1.22), M.ssDark, x, 0, 0);
  put(ahuBody, B(2.8, 0.14, 1.3), M.dark, 0, -0.72, 0);
  const pleat = tex(128, 128, (g, w, h) => { g.fillStyle = '#f2f2ea'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#c9c9bd'; g.fillRect(x, 0, 3, h); } });
  const fine = tex(128, 128, (g, w, h) => { g.fillStyle = '#e9eef7'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 5) { g.fillStyle = '#b4c1d6'; g.fillRect(x, 0, 2, h); } });
  const fins = tex(128, 128, (g, w, h) => { g.fillStyle = '#c7d0da'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 3) { g.fillStyle = '#8e9aa8'; g.fillRect(x, 0, 1, h); } g.strokeStyle = '#b8743f'; g.lineWidth = 5; for (let y = 12; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } });
  // every stage remembers where it sits, so a double tap can pull the AHU apart (exploded view)
  const ahuParts = [];
  const part = (c, x, y = 0) => { c.group.position.set(AX + x, AY + y, AZ); c.anchor.set(AX + x, AY + 0.82, AZ + 0.6); extras.push(c.group); ahuParts.push({ c, x, base: c.group.position.clone() }); };
  const stage = (key, x, mat, w = 0.08) => { const c = comp(key); put(c.group, B(w, 1.1, 1.0), mat); put(c.group, B(w + 0.03, 1.14, 0.03), M.ssDark, 0, 0, 0.5); part(c, x); return c; };
  stage('ahu_pre', -1.12, new T.MeshStandardMaterial({ map: pleat, roughness: 0.9 }));
  stage('ahu_fine', -0.82, new T.MeshStandardMaterial({ map: fine, roughness: 0.9 }));
  stage('ahu_coil', -0.4, new T.MeshStandardMaterial({ map: fins, metalness: 0.6, roughness: 0.4 }), 0.22);
  { // SHRM: WIESPL's patented heat-recovery coil (does the re-heating without an electric heater)
    const c = stage('shrm', 0.02, new T.MeshStandardMaterial({ map: fins, color: 0xbfe8c9, metalness: 0.55, roughness: 0.4 }), 0.2);
    for (let i = 0; i < 5; i++) put(c.group, Cy(0.022, 0.022, 0.98, 10), M.copper, 0.12, -0.42 + i * 0.21, 0, Math.PI / 2);
    const badge = tex(256, 96, g => { g.fillStyle = '#1e7d3a'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#fff'; g.font = 'bold 50px sans-serif'; g.fillText('SHRM', 58, 64); });
    put(c.group, new T.PlaneGeometry(0.34, 0.13), new T.MeshBasicMaterial({ map: badge, toneMapped: false }), 0, 0.42, 0.53);
  }
  { // blower wheel (spins)
    const c = comp('ahu_fan'); part(c, 0.66, -0.05);
    put(c.group, Cy(0.36, 0.36, 0.5, 28, true), M.ssDark, 0, 0, 0, Math.PI / 2);
    const wheel = new T.Group(); c.group.add(wheel);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const b = put(wheel, B(0.03, 0.2, 0.42), M.chrome, Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0); b.rotation.z = a + 0.4; }
    put(wheel, Cy(0.06, 0.06, 0.46, 12), M.dark, 0, 0, 0, Math.PI / 2);
    spinning.push([wheel, 'z', 9]);
  }
  { // UV lamps, plus the electric heater bank only when SHRM is not chosen
    const c = comp('ahu_heat'); part(c, 1.16);
    if (!opts.features.includes('shrm')) for (let i = 0; i < 4; i++) put(c.group, Cy(0.018, 0.018, 0.95, 10), C(0xd9532b, { emissive: 0xff5a1f, ei: 0.6, metal: 0.6 }), 0, -0.3 + i * 0.2, 0, Math.PI / 2);
    for (const y of [0.45, -0.45]) put(c.group, Cy(0.022, 0.022, 0.9, 10), new T.MeshBasicMaterial({ color: 0xb48cff, toneMapped: false }), -0.06, y, 0, Math.PI / 2);
  }
  ahuParts.push({ c: { group: ahuBody, anchor: new T.Vector3() }, x: 0, base: ahuBody.position.clone(), casing: true });
  ahu.anchor.set(AX - 0.9, AY + 0.9, AZ);
  { // outdoor unit with spinning fan and copper pipes to the coil
    const c = comp('odu'); extras.push(c.group);
    const ox = isWard ? 2.6 : 2.4, oz = -D / 2 - 2.1, oy = H + 1.12;
    put(c.group, RB(1.2, 1.0, 0.5, 0.05), C(0xe8ebee, { metal: 0.2, rough: 0.4 }), ox, oy, oz);
    put(c.group, Cy(0.36, 0.36, 0.02, 32), M.dark, ox - 0.15, oy, oz + 0.26, Math.PI / 2);
    const fan = new T.Group(); fan.position.set(ox - 0.15, oy, oz + 0.28); c.group.add(fan);
    for (let i = 0; i < 3; i++) { const arm = new T.Group(); arm.rotation.z = i * Math.PI * 2 / 3; fan.add(arm); put(arm, B(0.1, 0.3, 0.01), M.grey, 0, 0.16, 0); }
    spinning.push([fan, 'z', 7]);
    const pipe = new T.CatmullRomCurve3([V(ox - 0.6, oy - 0.25, oz), V(ox - 1.4, oy - 0.3, oz + 0.05), V(AX + 0.6, AY - 0.25, AZ - 0.55), V(AX + 0.12, AY - 0.25, AZ - 0.55)]);
    put(c.group, new T.TubeGeometry(pipe, 40, 0.02, 8), M.copper);
    put(c.group, new T.TubeGeometry(new T.CatmullRomCurve3(pipe.points.map(p => p.clone().add(V(0, 0.08, 0)))), 40, 0.015, 8), M.copper);
    c.anchor.set(ox, oy + 0.7, oz);
    ahuParts.push({ c: { group: c.group, anchor: new T.Vector3() }, x: 0, base: c.group.position.clone(), odu: true }); // steps aside when the AHU is taken apart
  }
  // rectangular flanged ducts with moving arrows (blue = clean supply air, orange = return air)
  const duct = (pts, w, h, color) => {
    const g = new T.Group(); comp('ducts').group.add(g); extras.push(g);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
      const m = put(g, B(w, h, len + h * 0.5), M.duct); m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b);
      const f = put(g, B(w + 0.06, h + 0.06, 0.04), M.ssDark); f.position.copy(a); f.lookAt(b);
    }
    const total = pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]), 0);
    const n = Math.max(5, Math.round(total / 0.45));
    const cone = new T.InstancedMesh(new T.ConeGeometry(Math.min(w, h) * 0.32, Math.min(w, h) * 0.75, 12), new T.MeshBasicMaterial({ color, toneMapped: false }), n);
    cone.frustumCulled = false;
    g.add(cone);
    flows.push({ pts, total, mesh: cone, n, off: 0 });
  };

  // ------------------------------------------------------------ the OT
  let air = null;
  if (!isWard) {
    // operating table: base, column, four sections with mattress and side rails
    const table = comp('table');
    const tg = table.group;
    put(tg, RB(0.75, 0.42, 0.12, 0.04), M.dark, 0, 0.06, 0, -Math.PI / 2);
    put(tg, Cy(0.11, 0.13, 0.62, 24), M.ss, 0, 0.42, 0);
    put(tg, RB(0.6, 0.36, 0.08, 0.03), M.ssDark, 0, 0.74, 0, -Math.PI / 2);
    for (const [x, len, tilt] of [[-0.72, 0.42, 0.06], [-0.18, 0.62, 0], [0.42, 0.56, 0], [0.86, 0.3, -0.12]]) {
      const sg = new T.Group(); sg.position.set(x, 0.82, 0); sg.rotation.z = tilt; tg.add(sg);
      put(sg, B(len, 0.05, 0.54), M.ss);
      put(sg, RB(len - 0.02, 0.5, 0.07, 0.03), M.mattress, 0, 0.06, 0, -Math.PI / 2);
      put(sg, B(len, 0.025, 0.02), M.chrome, 0, -0.01, 0.29); put(sg, B(len, 0.025, 0.02), M.chrome, 0, -0.01, -0.29);
    }
    table.anchor.set(0.7, 1.05, 0.3);
    // equipment around the table for scale: anaesthesia workstation, IV stands, monitor & instrument trolleys
    const props = comp('props');
    const wheels = (g, w, d) => { for (const [ex, ez] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) put(g, Cy(0.045, 0.045, 0.035, 14), M.rubber, ex, 0.045, ez, Math.PI / 2); };
    const screen = (fn) => tex(256, 170, fn);
    const vitals = screen((g, w, h) => { g.fillStyle = '#071220'; g.fillRect(0, 0, w, h); ['#3ce07a', '#ffd166', '#5ab0ff'].forEach((c, r) => { g.strokeStyle = c; g.lineWidth = 2.5; g.beginPath(); for (let k = 0; k < 180; k++) { const t = (k + r * 13) % 45; g.lineTo(k, 30 + r * 45 + (t === 10 ? -18 : t === 12 ? 16 : Math.sin(k / 6) * 3)); } g.stroke(); g.fillStyle = c; g.font = 'bold 24px sans-serif'; g.fillText(['72', '120/80', '98%'][r], 186, 40 + r * 45); }); });
    { // anaesthesia workstation
      const a = new T.Group(); a.position.set(1.3, 0, -1.15); a.rotation.y = -0.6; props.group.add(a);
      put(a, RB(0.62, 0.82, 0.55, 0.04), M.white, 0, 0.55, 0);
      put(a, B(0.64, 0.05, 0.57), M.blue, 0, 0.2, 0); put(a, B(0.64, 0.05, 0.57), M.blue, 0, 0.98, 0);
      for (const y of [0.42, 0.62, 0.82]) put(a, B(0.5, 0.012, 0.02), M.grey, 0, y, 0.285);
      put(a, RB(0.66, 0.05, 0.58, 0.02), M.ssDark, 0, 1.0, 0);
      for (const dx of [-0.18, 0.0]) put(a, RB(0.12, 0.24, 0.12, 0.03), C(dx ? 0x3a7bd5 : 0xf2c200, { rough: 0.4 }), dx, 1.15, 0.12);
      put(a, Cy(0.02, 0.02, 0.5, 10), M.chrome, 0.2, 1.25, -0.18);
      put(a, RB(0.46, 0.32, 0.04, 0.02), M.dark, 0.2, 1.55, -0.12);
      put(a, new T.PlaneGeometry(0.42, 0.28), new T.MeshBasicMaterial({ map: vitals, toneMapped: false }), 0.2, 1.55, -0.098);
      put(a, Cy(0.012, 0.012, 0.5, 8), M.chrome, -0.33, 0.95, 0, 0, 0, Math.PI / 2);
      wheels(a, 0.5, 0.42);
    }
    const ivStand = (x, z) => {
      const s = new T.Group(); s.position.set(x, 0, z); props.group.add(s);
      for (let i = 0; i < 5; i++) put(s, B(0.3, 0.02, 0.025), M.chrome, Math.cos(i * 1.2566) * 0.15, 0.06, Math.sin(i * 1.2566) * 0.15, 0, -i * 1.2566, 0);
      for (let i = 0; i < 5; i++) put(s, Cy(0.025, 0.025, 0.03, 10), M.rubber, Math.cos(i * 1.2566) * 0.3, 0.03, Math.sin(i * 1.2566) * 0.3, Math.PI / 2);
      put(s, Cy(0.012, 0.012, 1.9, 10), M.chrome, 0, 1.0, 0);
      put(s, B(0.36, 0.012, 0.012), M.chrome, 0, 1.92, 0);
      put(s, RB(0.12, 0.2, 0.04, 0.02), C(0xdcefff, { opacity: 0.75 }), 0.12, 1.72, 0);
    };
    ivStand(-0.95, -0.95); ivStand(1.05, 1.15);
    { // monitor trolley
      const m = new T.Group(); m.position.set(-1.55, 0, -0.35); m.rotation.y = 0.5; props.group.add(m);
      put(m, RB(0.5, 0.06, 0.42, 0.02), M.white, 0, 0.12, 0); put(m, Cy(0.03, 0.03, 0.85, 10), M.ssDark, 0, 0.55, 0);
      put(m, RB(0.48, 0.2, 0.38, 0.03), M.white, 0, 0.98, 0); put(m, B(0.5, 0.03, 0.4), M.blue, 0, 0.89, 0);
      put(m, RB(0.42, 0.3, 0.05, 0.02), M.dark, 0, 1.28, 0.02);
      put(m, new T.PlaneGeometry(0.38, 0.26), new T.MeshBasicMaterial({ map: vitals, toneMapped: false }), 0, 1.28, 0.047);
      wheels(m, 0.4, 0.34);
    }
    { // instrument (Mayo) trolley
      const t = new T.Group(); t.position.set(0.95, 0, 0.85); props.group.add(t);
      put(t, B(0.7, 0.02, 0.45), M.ss, 0, 0.9, 0); put(t, B(0.7, 0.02, 0.45), M.ss, 0, 0.35, 0);
      for (const [ex, ez] of [[-0.33, -0.2], [0.33, -0.2], [-0.33, 0.2], [0.33, 0.2]]) put(t, Cy(0.012, 0.012, 0.85, 8), M.chrome, ex, 0.47, ez);
      put(t, B(0.5, 0.03, 0.3), C(0x2f6f8f, { rough: 0.8 }), 0, 0.925, 0);
      wheels(t, 0.6, 0.38);
    }
    // LAF plenum: steel box, perforated diffuser over the HEPA filters, LED edge, glass air-curtain skirt
    const laf = comp('laf'), hepa = comp('hepa');
    put(laf.group, RB(2.5, 1.9, 0.26, 0.03), M.ss, 0, H - 0.13, 0, -Math.PI / 2);
    const perf = tex(512, 384, (g, w, h) => { g.fillStyle = '#eef1f4'; g.fillRect(0, 0, w, h); g.fillStyle = '#b9c2cc'; for (let y = 6; y < h; y += 9) for (let x = (y / 9) % 2 ? 6 : 10; x < w; x += 9) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); } g.strokeStyle = '#9aa5b2'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); });
    put(hepa.group, new T.PlaneGeometry(2.3, 1.7), new T.MeshStandardMaterial({ map: perf, metalness: 0.5, roughness: 0.35 }), 0, H - 0.262, 0, Math.PI / 2);
    for (const [x, z, w, d] of [[0, 0.93, 2.42, 0.035], [0, -0.93, 2.42, 0.035], [1.23, 0, 0.035, 1.82], [-1.23, 0, 0.035, 1.82]]) put(laf.group, B(w, 0.02, d), M.led, x, H - 0.265, z);
    for (const [x, z, w, d] of [[0, 0.97, 2.5, 0.01], [0, -0.97, 2.5, 0.01], [1.27, 0, 0.01, 1.94], [-1.27, 0, 0.01, 1.94]]) put(laf.group, B(w, 0.25, d), M.glass, x, H - 0.39, z);
    laf.anchor.set(-1.25, H - 0.08, 0.98); hepa.anchor.set(1.05, H - 0.32, 0.7);
    laf.view = [V(3.3, 1.35, 3.5), V(0, 1.75, 0)]; hepa.view = [V(1.6, 0.95, 1.8), V(0, 2.75, 0)];
    { // small air-velocity sensor hanging from the plenum edge
      const vs = comp('velocity'), sx0 = 1.08, sz0 = 0.8, top = H - 0.27;
      put(vs.group, RB(0.09, 0.06, 0.05, 0.012), M.white, sx0, top - 0.03, sz0);
      put(vs.group, Cy(0.006, 0.006, 0.14, 8), M.chrome, sx0, top - 0.13, sz0);
      put(vs.group, new T.SphereGeometry(0.016, 14, 10), M.ssDark, sx0, top - 0.205, sz0);
      put(vs.group, new T.PlaneGeometry(0.012, 0.012), new T.MeshBasicMaterial({ color: 0x2ecc71, toneMapped: false }), sx0, top - 0.03, sz0 + 0.0255);
      vs.anchor.set(sx0, top - 0.24, sz0);
      vs.view = [V(1.75, 2.0, 1.55), V(sx0, top - 0.12, sz0)];
    }
    // laminar air: soft particles falling straight down, spreading out once they pass the table
    const n = small ? 420 : 760, pos = new Float32Array(n * 3), vel = new Float32Array(n);
    const reset = (i, anyY) => { pos[i * 3] = (Math.random() - 0.5) * 2.25; pos[i * 3 + 1] = anyY ? 0.6 + Math.random() * 2.1 : H - 0.28; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.65; vel[i] = 0.45 + Math.random() * 0.35; };
    for (let i = 0; i < n; i++) reset(i, true);
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3));
    const dot = tex(32, 32, g => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
    const points = new T.Points(pg, new T.PointsMaterial({ color: 0x9fd8ff, size: 0.026, map: dot, transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending }));
    room.add(points);
    air = { on: opts.features.includes('laf') || opts.features.includes('hepa'), points, vel, n, reset };
    // OT light: ceiling axis, articulated arms and two LED domes that light the table
    const light = comp('otlight');
    const axisX = 0.15, axisZ = -0.25;
    put(light.group, Cy(0.16, 0.16, 0.05, 32), M.white, axisX, H - 0.03, axisZ);
    put(light.group, Cy(0.05, 0.05, 0.55, 16), M.white, axisX, H - 0.3, axisZ);
    const dome = (len, ang, drop, r, y) => {
      const arm = new T.Group(); arm.position.set(axisX, H - 0.55, axisZ); arm.rotation.y = ang; light.group.add(arm);
      put(arm, Cy(0.035, 0.035, len, 12), M.white, len / 2, 0, 0, 0, 0, Math.PI / 2);
      put(arm, Cy(0.05, 0.05, 0.08, 16), M.white, len, 0, 0);
      const spring = new T.Group(); spring.position.set(len, 0, 0); spring.rotation.z = -0.55; arm.add(spring);
      put(spring, Cy(0.03, 0.03, drop, 12), M.white, drop / 2, 0, 0, 0, 0, Math.PI / 2);
      const head = new T.Group(); head.position.set(len + Math.cos(0.55) * drop, y - (H - 0.55), 0); arm.add(head);
      put(head, Cy(0.02, 0.02, -(y - (H - 0.55)) - Math.sin(0.55) * drop + 0.05, 10), M.white, 0, (-(y - (H - 0.55)) - Math.sin(0.55) * drop) / 2 + 0.02, 0);
      const prof = [[0.001, 0], [r * 0.55, 0.0], [r * 0.95, 0.04], [r, 0.09], [r * 0.97, 0.12], [r * 0.3, 0.12], [0.001, 0.12]].map(([px, py]) => new T.Vector2(px, py));
      put(head, new T.LatheGeometry(prof, 40), M.white, 0, 0.12, 0, Math.PI, 0, 0);
      const ring = new T.InstancedMesh(new T.CircleGeometry(0.028, 12), M.led, 24);
      const m4 = new T.Matrix4(), q4 = new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0));
      for (let i = 0; i < 24; i++) { const rr = i < 8 ? r * 0.3 : r * 0.68, a = (i < 8 ? i / 8 : (i - 8) / 16) * Math.PI * 2; m4.compose(V(Math.cos(a) * rr, -0.002, Math.sin(a) * rr), q4, V(1, 1, 1)); ring.setMatrixAt(i, m4); }
      head.add(ring);
      put(head, Cy(0.03, 0.03, 0.12, 12), M.ssDark, 0, -0.06, 0);
      const sp = new T.SpotLight(0xfff4e0, 0.9, 4, 0.55, 0.6, 1.5); sp.position.set(0, -0.05, 0); head.add(sp);
      const tgt = new T.Object3D(); tgt.position.set(0, -2, 0); head.add(tgt); sp.target = tgt;
    };
    dome(0.75, 0.9, 0.55, 0.36, 2.15); dome(0.62, -2.3, 0.45, 0.3, 2.25);
    light.anchor.set(axisX, 2.55, axisZ + 0.55);
    light.view = [V(1.7, 1.35, 1.6), V(0.2, 2.05, -0.1)];
    // ceiling pendants: surgeon (with monitor) and anaesthesia, with gas outlets and sockets
    const pend = comp('pendants'), gas = comp('mgps');
    const pendant = (x, z, ang, kind) => {
      const g = new T.Group(); g.position.set(x, H, z); pend.group.add(g);
      put(g, Cy(0.13, 0.13, 0.05, 28), M.white, 0, -0.025, 0);
      put(g, Cy(0.07, 0.07, 0.42, 20), M.white, 0, -0.26, 0);
      const arm = new T.Group(); arm.position.set(0, -0.48, 0); arm.rotation.y = ang; g.add(arm);
      put(arm, RB(0.9, 0.11, 0.16, 0.04), M.white, 0.45, 0, 0);
      put(arm, Cy(0.08, 0.08, 0.14, 20), M.ssDark, 0.9, -0.02, 0);
      const cons = new T.Group(); cons.position.set(0.9, -0.62, 0); arm.add(cons);
      put(cons, Cy(0.03, 0.03, 0.5, 12), M.chrome, 0, 0.45, 0);
      put(cons, RB(0.34, 1.0, 0.34, 0.06), M.white, 0, -0.05, 0);
      put(cons, B(0.36, 0.02, 0.36), M.ssDark, 0, 0.47, 0); put(cons, B(0.36, 0.02, 0.36), M.ssDark, 0, -0.56, 0);
      for (const yy of [-0.15, 0.2]) put(cons, B(0.55, 0.025, 0.42), M.glass, 0, yy, 0.05);
      outlets(cons, 0, 0.33, 0.172, 'z', 4, 0.075);
      sockets(cons, 0, 0.05, 0.172, 2);
      if (kind === 'surgeon') {
        const mon = new T.Group(); mon.position.set(0, 0.0, 0.28); cons.add(mon);
        put(mon, Cy(0.02, 0.02, 0.2, 10), M.ssDark, 0, 0, 0, Math.PI / 2);
        put(mon, RB(0.62, 0.38, 0.04, 0.02), M.dark, 0, 0.05, 0.12);
        const ecg = tex(256, 160, (c2, w, h) => { c2.fillStyle = '#081320'; c2.fillRect(0, 0, w, h); c2.strokeStyle = '#3ce07a'; c2.lineWidth = 3; c2.beginPath(); for (let k = 0; k < w; k++) { const t = k % 64; const yy = t === 20 ? 40 : t === 22 ? 110 : t === 24 ? 60 : 80; if (k === 0) c2.moveTo(k, yy); else c2.lineTo(k, yy); } c2.stroke(); c2.fillStyle = '#3ce07a'; c2.font = 'bold 28px sans-serif'; c2.fillText('HR 72', 12, 150); c2.fillStyle = '#5ab0ff'; c2.fillText('SpO2 99', 130, 150); });
        put(mon, new T.PlaneGeometry(0.57, 0.33), new T.MeshBasicMaterial({ map: ecg, toneMapped: false }), 0, 0.05, 0.142);
      }
    };
    pendant(-1.85, 1.1, 0.25, 'surgeon'); pendant(1.95, -1.25, Math.PI + 0.2, 'anaesthesia');
    pend.anchor.set(-1.1, 2.55, 1.15); gas.anchor.set(-W / 2 + 0.1, 1.75, 1.95);
    pend.view = [V(0.6, 1.6, 3.0), V(-1.0, 1.6, 1.0)];
    // ---- everything on the walls is flush (as in WIESPL OTs): only a thin frame stands proud of the panel
    const BZ = -D / 2 + 0.03, LX = -W / 2 + 0.03;       // back wall face (z), left wall face (x)
    const onBack = (g, geo, mat, x, y, dz = 0.004) => put(g, geo, mat, x, y, BZ + dz);
    const onLeft = (g, geo, mat, z, y, dx = 0.004) => put(g, geo, mat, LX + dx, y, z, 0, Math.PI / 2, 0);
    const flat = (w, h) => new T.PlaneGeometry(w, h);
    const frame = (w, h, t = 0.008) => B(w, h, t);
    // surgeon's control panel: WIESPL frame (white with blue / green swoosh) and the touch screen inside
    const ctl = comp('control');
    const bezel = tex(600, 420, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f6fd1'; g.beginPath(); g.moveTo(0, h * 0.86); g.quadraticCurveTo(w * 0.45, h * 0.7, w, h * 0.9); g.lineTo(w, h); g.lineTo(0, h); g.fill();
      g.fillStyle = '#5cbf4a'; g.beginPath(); g.moveTo(0, h * 0.93); g.quadraticCurveTo(w * 0.5, h * 0.8, w, h * 0.96); g.lineTo(w, h); g.lineTo(0, h); g.fill();
      g.fillStyle = '#1f6fd1'; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(w * 0.3, h * 0.08, w * 0.55, 0); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w * 0.18, h * 0.86, 44, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#d0d8e2'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#1f4e9a'; g.font = 'bold 26px sans-serif'; g.fillText('WIESPL', w * 0.18 - 46, h * 0.86 + 9);
    });
    const ui = tex(640, 400, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2a2f9c'); gr.addColorStop(1, '#3d2a8a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#c9d4ff'; g.lineWidth = 3; g.beginPath(); g.arc(70, 70, 40, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(70, 70); g.lineTo(70, 42); g.moveTo(70, 70); g.lineTo(92, 78); g.stroke();
      g.fillStyle = '#e6ebff'; g.font = '22px sans-serif'; g.fillText('04:48', 40, 140);
      const tile = (x, y, a, b) => { g.strokeStyle = 'rgba(220,228,255,.55)'; g.lineWidth = 2; g.strokeRect(x, y, 120, 110); g.fillStyle = '#ffffff'; g.font = 'bold 30px sans-serif'; g.fillText(a, x + 14, y + 52); g.font = '20px sans-serif'; g.fillStyle = '#d8deff'; g.fillText(b, x + 14, y + 90); };
      tile(190, 60, '19.9°C', 'Temp'); tile(320, 60, '47.3%', 'RH'); tile(450, 60, '💡', 'Lighting'); tile(190, 190, '⏱', 'Timer'); tile(320, 190, '♫', 'Music'); tile(450, 190, '⏻', 'Exhaust');
      g.fillStyle = '#d8deff'; g.font = '20px sans-serif'; g.fillText('WIESPL', 40, 370);
    });
    onBack(ctl.group, frame(1.2, 0.84), M.dark, -1.9, 1.5, 0.006);
    onBack(ctl.group, flat(1.17, 0.81), new T.MeshBasicMaterial({ map: bezel }), -1.9, 1.5, 0.0105);
    onBack(ctl.group, flat(0.78, 0.48), new T.MeshBasicMaterial({ map: ui, toneMapped: false }), -1.81, 1.6, 0.012);
    ctl.anchor.set(-1.9, 2.05, BZ + 0.05);
    ctl.view = [V(-1.9, 1.55, -1.1), V(-1.9, 1.5, -3)];
    // room pressure gauge and the automation display next to it (flush)
    const pr = comp('pressure');
    const gauge = tex(160, 160, g => { g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 80, 76, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 3; for (let a = 0; a <= 10; a++) { const t = Math.PI * (0.8 + a * 0.14); g.beginPath(); g.moveTo(80 + Math.cos(t) * 60, 80 + Math.sin(t) * 60); g.lineTo(80 + Math.cos(t) * 70, 80 + Math.sin(t) * 70); g.stroke(); } g.strokeStyle = '#c0392b'; g.lineWidth = 5; g.beginPath(); g.moveTo(80, 80); g.lineTo(122, 52); g.stroke(); g.fillStyle = '#333'; g.font = '16px sans-serif'; g.fillText('Pa', 70, 128); });
    onBack(pr.group, frame(0.26, 0.26), M.dark, -1.05, 1.62, 0.006);
    onBack(pr.group, flat(0.22, 0.22), new T.MeshBasicMaterial({ map: gauge }), -1.05, 1.62, 0.0105);
    pr.anchor.set(-1.05, 1.85, BZ + 0.05);
    const au = comp('automation');
    const mini = tex(200, 140, g => { g.fillStyle = '#0d2036'; g.fillRect(0, 0, 200, 140); g.fillStyle = '#5ee09a'; g.font = 'bold 30px sans-serif'; g.fillText('ALL OK', 30, 60); g.fillStyle = '#9fc4ec'; g.font = '18px sans-serif'; g.fillText('online', 62, 105); });
    onBack(au.group, frame(0.26, 0.19), M.dark, -1.05, 1.28, 0.006);
    onBack(au.group, flat(0.23, 0.16), new T.MeshBasicMaterial({ map: mini, toneMapped: false }), -1.05, 1.28, 0.0105);
    put(au.group, new T.SphereGeometry(0.07, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, -1.2, H - 0.002, -1.4, Math.PI);
    au.anchor.set(-1.2, H - 0.18, -1.4);
    // digital wallpaper: a calm landscape panel, as in WIESPL OTs and passages
    const mural = tex(1024, 560, drawLandscape);
    onBack(panels.group, frame(2.1, 1.22), M.ssDark, 0.05, 1.82, 0.004);
    onBack(panels.group, flat(2.04, 1.16), new T.MeshStandardMaterial({ map: mural, roughness: 0.15, metalness: 0.05, envMapIntensity: 0.6 }), 0.05, 1.82, 0.0085);
    // gas outlet strip under the mural, sockets low on the wall
    const gasW = comp('mgps');
    onBack(gasW.group, frame(0.95, 0.2), M.white, 0.05, 1.02, 0.006);
    outlets(gasW.group, -0.2, 1.02, BZ + 0.012, 'z', 5, 0.11);
    sockets(gasW.group, 0.38, 1.02, BZ + 0.012, 2);
    for (const x of [-2.6, -1.4, 1.25, 2.4]) put(panels.group, B(0.16, 0.08, 0.01), M.white, x, 0.45, BZ + 0.005);
    gasW.anchor.set(0.05, 1.25, BZ + 0.05);
    gasW.view = [V(0.2, 1.4, -1.0), V(0.05, 1.2, -3)];
    // flush SS storage cabinets with slim glass slits
    const st = comp('storage');
    for (const [x, w] of [[1.55, 0.78], [2.4, 0.78]]) {
      onBack(st.group, frame(w, 2.0, 0.01), M.ssDark, x, 1.15, 0.005);
      for (const s of [-1, 1]) {
        const dx = x + s * w / 4;
        onBack(st.group, frame(w / 2 - 0.02, 1.96, 0.008), M.ss, dx, 1.15, 0.011);
        onBack(st.group, flat(0.06, 1.15), M.glass, dx - s * 0.08, 1.2, 0.016);
        onBack(st.group, frame(0.12, 0.05, 0.02), M.chrome, dx - s * 0.12, 2.0, 0.02);
      }
    }
    st.anchor.set(1.95, 2.35, BZ + 0.05);
    st.view = [V(1.9, 1.5, -1.0), V(1.95, 1.2, -3)];
    // low return-air grilles (flush); the riser ducts run inside the wall
    const ris = comp('risers');
    const grille = tex(128, 192, g => { g.fillStyle = '#d9dee4'; g.fillRect(0, 0, 128, 192); g.fillStyle = '#4a5462'; for (let y = 10; y < 190; y += 12) g.fillRect(8, y, 112, 6); });
    const gMat = new T.MeshStandardMaterial({ map: grille, metalness: 0.6, roughness: 0.35 });
    onBack(ris.group, frame(0.52, 0.72), M.ssDark, -2.6, 0.5, 0.004); onBack(ris.group, flat(0.48, 0.68), gMat, -2.6, 0.5, 0.0085);
    onLeft(ris.group, frame(0.52, 0.72), M.ssDark, 2.55, 0.5, 0.004); onLeft(ris.group, flat(0.48, 0.68), gMat, 2.55, 0.5, 0.0085);
    ris.anchor.set(-2.6, 1.0, BZ + 0.05);
    // hermetic sliding door in the left wall, into the clean passage
    const door = comp('doors');
    const dz0 = -1.55;
    put(door.group, B(0.16, 0.3, 1.9), M.ss, LX + 0.08, 2.4, dz0 + 0.45);                    // operator housing
    onLeft(door.group, frame(1.32, 2.22, 0.01), M.dark, dz0, 1.11, 0.005);                    // opening
    const leaf = new T.Group(); leaf.position.set(LX + 0.05, 0, dz0 + 0.38); door.group.add(leaf);
    put(leaf, RB(1.28, 2.16, 0.05, 0.015), M.ss, 0, 1.1, 0, 0, Math.PI / 2, 0);
    put(leaf, RB(0.36, 0.46, 0.055, 0.03), M.glass, 0.003, 1.5, 0, 0, Math.PI / 2, 0);
    put(leaf, B(0.05, 0.42, 0.04), M.chrome, 0.04, 1.05, 0.5);
    door.anchor.set(LX + 0.1, 2.62, dz0 + 0.2);
    door.view = [V(-1.0, 1.6, -0.9), V(-3, 1.2, -1.4)];
    door.leaf = leaf; door.slide = { axis: 'z', base: dz0 + 0.38, amp: 0.95 };
    // X-ray viewer and pass box, flush in the left wall
    const xr = comp('xray');
    const film = tex(256, 320, g => { g.fillStyle = '#0b0e12'; g.fillRect(0, 0, 256, 320); const gr = g.createRadialGradient(128, 150, 20, 128, 160, 150); gr.addColorStop(0, 'rgba(210,220,230,.85)'); gr.addColorStop(1, 'rgba(30,35,40,.2)'); g.fillStyle = gr; g.beginPath(); g.ellipse(90, 170, 55, 110, 0, 0, Math.PI * 2); g.ellipse(166, 170, 55, 110, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(230,235,240,.6)'; g.lineWidth = 4; for (let y = 70; y < 280; y += 22) { g.beginPath(); g.ellipse(128, y, 100, 14, 0, Math.PI * 0.05, Math.PI * 0.95); g.stroke(); } });
    onLeft(xr.group, frame(1.06, 0.68), M.ss, 1.45, 1.6, 0.005);
    for (const dz of [-0.25, 0.25]) onLeft(xr.group, flat(0.46, 0.6), new T.MeshBasicMaterial({ map: film, toneMapped: false }), 1.45 + dz, 1.6, 0.011);
    xr.anchor.set(LX + 0.05, 2.02, 1.45);
    xr.view = [V(-1.2, 1.6, 1.5), V(-3, 1.6, 1.45)];
    const pb = comp('passbox');
    onLeft(pb.group, frame(0.66, 0.66, 0.01), M.ss, 0.15, 1.15, 0.005);
    onLeft(pb.group, flat(0.5, 0.5), M.glass, 0.15, 1.15, 0.012);
    onLeft(pb.group, flat(0.03, 0.03), new T.MeshBasicMaterial({ color: 0x2ecc71, toneMapped: false }), 0.36, 1.42, 0.012);
    onLeft(pb.group, flat(0.03, 0.03), new T.MeshBasicMaterial({ color: 0xe74c3c, toneMapped: false }), 0.42, 1.42, 0.012);
    pb.anchor.set(LX + 0.05, 1.6, 0.15);
    pb.view = [V(-1.3, 1.5, 0.4), V(-3, 1.15, 0.15)];
    // fumigation fogger
    const fu = comp('fumigation');
    put(fu.group, RB(0.42, 0.34, 0.3, 0.05), M.blue, 2.25, 0.17, 2.1);
    put(fu.group, Cy(0.035, 0.06, 0.24, 14), M.dark, 2.25, 0.46, 2.1);
    fu.anchor.set(2.25, 0.8, 2.1);
    // ---- clean passage outside the door, with the scrub station (scrubbing is done outside the OT)
    const PW = 2.3, PX = -W / 2 - PW / 2 - 0.03;
    const passage = comp('passage');
    const woodMat = new T.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05 });
    put(passage.group, new T.PlaneGeometry(PW, D), new T.MeshStandardMaterial({ map: tex(512, 512, (g, w, h) => { g.fillStyle = '#b9c4cf'; g.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '70,85,105'},${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); } }, [1, 2]), roughness: 0.4 }), PX, 0.001, 0, -Math.PI / 2);
    put(passage.group, B(PW + 0.1, 0.18, D + 0.14), flooring.group.children[1]?.material || M.dark, PX, -0.095, 0);
    put(passage.group, B(0.06, 0.75, D), woodMat, -W / 2 - PW - 0.03, 0.375, 0);                 // outer wall, cut away
    put(passage.group, B(0.01, 0.75, D), M.puf, -W / 2 - PW + 0.005, 0.375, 0);
    put(passage.group, B(PW, H, 0.06), woodMat, PX, H / 2, -D / 2);                              // end wall …
    put(passage.group, flat(PW - 0.2, 2.3), new T.MeshStandardMaterial({ map: tex(1024, 1100, drawLandscape), roughness: 0.15, metalness: 0.05 }), PX, 1.35, -D / 2 + 0.035); // … with a mural
    put(passage.group, B(0.03, H, D), woodMat, -W / 2 - 0.045, H / 2, 0);                        // OT wall seen from the passage
    for (let i = -2; i <= 2; i++) put(passage.group, flat(0.55, 0.55), M.led, PX, H - 0.01, i * 1.2, Math.PI / 2);
    passage.anchor.set(PX, 2.2, -D / 2 + 0.4);
    passage.view = [V(PX - 0.75, 1.7, 3.3), V(-W / 2 - 0.25, 1.0, 0.9)];
    const sc = comp('scrub');
    const sx = -W / 2 - 0.05, sz = 1.2;
    put(sc.group, RB(1.3, 0.55, 0.55, 0.04), M.ss, sx - 0.3, 0.92, sz, 0, Math.PI / 2, 0);
    put(sc.group, RB(1.1, 0.12, 0.4, 0.05), M.chrome, sx - 0.33, 1.15, sz, 0, Math.PI / 2, 0);
    put(sc.group, B(0.02, 0.85, 1.3), M.ss, sx - 0.02, 1.62, sz);
    for (const dz of [-0.32, 0.32]) { put(sc.group, Cy(0.016, 0.016, 0.28, 10), M.chrome, sx - 0.1, 1.42, sz + dz); put(sc.group, Cy(0.014, 0.014, 0.2, 10), M.chrome, sx - 0.2, 1.55, sz + dz, 0, 0, Math.PI / 2); put(sc.group, Cy(0.02, 0.02, 0.02, 10), new T.MeshBasicMaterial({ color: 0x2ecc71, toneMapped: false }), sx - 0.03, 1.3, sz + dz, 0, 0, Math.PI / 2); }
    sc.anchor.set(sx - 0.4, 1.6, sz);
    sc.view = [V(PX - 0.75, 1.7, 3.3), V(sx - 0.2, 1.0, sz - 0.3)];
    // the air cycle: supply duct to the plenum, return ducts from the low grilles up inside the walls
    duct([V(AX + 0.5, AY + 0.1, AZ + 0.62), V(AX + 0.5, AY + 0.1, -1.0), V(0, AY + 0.1, -0.2), V(0, H + 0.28, 0)], 0.62, 0.42, 0x3aa0ff);
    duct([V(-2.6, 0.5, -D / 2 - 0.2), V(-2.6, H + 0.55, -D / 2 - 0.2), V(-2.6, H + 0.55, AZ + 0.35), V(AX - 1.1, AY - 0.35, AZ + 0.35)], 0.48, 0.28, 0xff8c42);
    duct([V(-W / 2 - 0.2, 0.5, 2.55), V(-W / 2 - 0.2, H + 0.75, 2.55), V(-W / 2 - 0.2, H + 0.75, AZ), V(AX - 1.35, AY - 0.1, AZ)], 0.4, 0.26, 0xff8c42);
  }

  // ------------------------------------------------------------ ICU / NICU ward
  if (isWard) {
    const total = Math.max(1, opts.beds || 4), shown = Math.min(total, 6);
    const head = comp('bedhead'), gas = comp('mgps'), hp = comp('hepa');
    const war = nicu || opts.types.includes('nicu') || opts.features.includes('warmers') ? comp('warmers') : null;
    const span = Math.min(1.95, (W - 3.4) / shown);
    const curtain = C(0x9fc6e8, { opacity: 0.55, rough: 0.9, side: T.DoubleSide });
    for (let i = 0; i < shown; i++) {
      const x = -W / 2 + 1.35 + i * span;
      if (nicu) {
        const inc = new T.Group(); inc.position.set(x, 0, -1.95); war.group.add(inc);
        put(inc, RB(0.95, 0.6, 0.55, 0.04), M.white, 0, 0.42, 0);
        for (const [ddx, ddz] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) put(inc, Cy(0.04, 0.04, 0.05, 12), M.rubber, ddx, 0.05, ddz, Math.PI / 2);
        put(inc, B(0.06, 0.12, 0.06), M.grey, 0, 0.1, 0);
        put(inc, B(0.85, 0.05, 0.45), C(0xf3d7e3, { rough: 0.8 }), 0, 0.75, 0);
        put(inc, new T.CylinderGeometry(0.3, 0.3, 0.88, 28, 1, true, 0, Math.PI), M.glass, 0, 0.73, 0, 0, 0, Math.PI / 2);
        for (const s of [-1, 1]) put(inc, new T.CircleGeometry(0.3, 24, 0, Math.PI), M.glass, s * 0.44, 0.73, 0, 0, s * Math.PI / 2);
        for (const ddx of [-0.2, 0.2]) put(inc, new T.TorusGeometry(0.06, 0.012, 8, 20), M.white, ddx, 0.86, 0.27);
        put(inc, RB(0.3, 0.2, 0.05, 0.02), M.dark, 0.32, 1.2, -0.05);
      } else {
        const bed = new T.Group(); bed.position.set(x, 0, -1.85); comp('props').group.add(bed);
        put(bed, RB(0.95, 2.0, 0.12, 0.04), M.ssDark, 0, 0.5, 0, -Math.PI / 2);
        put(bed, RB(0.88, 1.9, 0.14, 0.06), M.mattress, 0, 0.62, 0.0, -Math.PI / 2);
        const back = put(bed, RB(0.88, 0.7, 0.12, 0.05), M.mattress, 0, 0.8, -0.62, -Math.PI / 2 + 0.45);
        void back;
        put(bed, RB(0.95, 0.42, 0.05, 0.03), M.white, 0, 0.78, -1.0); put(bed, RB(0.95, 0.32, 0.05, 0.03), M.white, 0, 0.7, 1.0);
        for (const s of [-1, 1]) put(bed, B(0.02, 0.18, 1.0), M.chrome, s * 0.48, 0.78, 0.0);
        for (const [ddx, ddz] of [[-0.4, -0.85], [0.4, -0.85], [-0.4, 0.85], [0.4, 0.85]]) { put(bed, Cy(0.02, 0.02, 0.38, 8), M.chrome, ddx, 0.27, ddz); put(bed, Cy(0.05, 0.05, 0.04, 14), M.rubber, ddx, 0.06, ddz, 0, 0, Math.PI / 2); }
        put(bed, Cy(0.012, 0.012, 1.8, 8), M.chrome, 0.62, 0.9, -0.9); put(bed, Cy(0.15, 0.15, 0.015, 16), M.chrome, 0.62, 0.02, -0.9);
        put(bed, RB(0.1, 0.18, 0.04, 0.02), C(0xd8ecff, { opacity: 0.7 }), 0.68, 1.7, -0.9);
        if (war) put(war.group, RB(0.4, 0.4, 0.4, 0.04), M.white, x + 0.7, 0.2, -2.35);
      }
      // bed-head panel with gases, sockets, light strip and patient monitor
      put(head.group, RB(Math.min(1.4, span - 0.15), 0.34, 0.08, 0.03), M.white, x, 1.42, -D / 2 + 0.07);
      put(head.group, B(Math.min(1.3, span - 0.25), 0.025, 0.02), M.led, x, 1.6, -D / 2 + 0.115);
      outlets(gas.group, x - 0.2, 1.4, -D / 2 + 0.115, 'z', 4, 0.09); sockets(head.group, x + 0.4, 1.4, -D / 2 + 0.115, 2);
      const mon = tex(200, 130, g => { g.fillStyle = '#071220'; g.fillRect(0, 0, 200, 130); g.strokeStyle = '#3ce07a'; g.lineWidth = 2.5; g.beginPath(); for (let k = 0; k < 200; k++) { const t = k % 50; g.lineTo(k, t === 15 ? 20 : t === 17 ? 80 : 50); } g.stroke(); g.fillStyle = '#3ce07a'; g.font = 'bold 22px sans-serif'; g.fillText('72', 10, 120); g.fillStyle = '#5ab0ff'; g.fillText('98%', 120, 120); });
      put(head.group, RB(0.44, 0.3, 0.05, 0.02), M.dark, x, 1.98, -D / 2 + 0.12);
      put(head.group, new T.PlaneGeometry(0.4, 0.26), new T.MeshBasicMaterial({ map: mon, toneMapped: false }), x, 1.98, -D / 2 + 0.147);
      if (i < shown - 1) put(comp('props').group, B(0.01, 2.0, 2.0), curtain, x + span / 2, 1.25, -1.9);
      put(hp.group, RB(0.6, 0.6, 0.04, 0.02), M.white, x, H - 0.02, -1.5, Math.PI / 2);
      put(hp.group, new T.PlaneGeometry(0.5, 0.5), M.ledCool, x, H - 0.045, -1.5, Math.PI / 2);
    }
    put(room, B(W - 2.8, 0.03, 0.03), M.chrome, -0.6, 2.28, -0.85);
    // continuous bed-head strip along the wall (as in WIESPL NICUs / ICUs)
    put(head.group, RB(W - 3.0, 0.24, 0.05, 0.03), M.white, -0.6 - 0.1, 1.42, -D / 2 + 0.055);
    put(head.group, B(W - 3.1, 0.035, 0.012), M.blue, -0.7, 1.3, -D / 2 + 0.083);
    head.anchor.set(-W / 2 + 1.35, 1.75, -D / 2 + 0.15); gas.anchor.set(-W / 2 + 1.35 + span, 1.6, -D / 2 + 0.2); hp.anchor.set(-W / 2 + 1.35 + span, H - 0.1, -1.5);
    head.view = [V(-1.6, 1.7, 0.6), V(-2.6, 1.4, -2.6)];
    war?.anchor.set(-W / 2 + 1.35, nicu ? 1.35 : 0.6, nicu ? -1.95 : -2.35);
    if (war && nicu) war.view = [V(-1.8, 1.5, 0.3), V(-2.6, 0.8, -1.95)];
    if (total > shown) opts.moreBeds = total - shown;
    // curved nurse station
    const ns = comp('nurse');
    put(ns.group, new T.CylinderGeometry(1.5, 1.5, 1.05, 40, 1, false, Math.PI * 0.15, Math.PI * 0.7), M.white, -0.4, 0.52, 2.9);
    put(ns.group, new T.CylinderGeometry(1.56, 1.56, 0.04, 40, 1, false, Math.PI * 0.15, Math.PI * 0.7), C(0x9cb6cf, { rough: 0.4 }), -0.4, 1.06, 2.9);
    for (const a of [-0.45, 0, 0.45]) { const m = put(ns.group, RB(0.5, 0.32, 0.03, 0.015), M.dark, -0.4 + Math.sin(a) * 1.15, 1.3, 2.9 - Math.cos(a) * 1.15); m.lookAt(-0.4, 1.3, 4.5); }
    ns.anchor.set(-0.4, 1.6, 1.7);
    ns.view = [V(1.6, 1.7, 0.4), V(-0.4, 1.1, 2.4)];
    // isolation room: glass walls, sliding glass door, its own pressure gauge
    const iso = comp('pressure');
    put(iso.group, B(0.04, H, 2.7), M.glass, W / 2 - 2.5, H / 2, -1.65);
    put(iso.group, B(1.35, H, 0.04), M.glass, W / 2 - 1.85, H / 2, -0.3);
    put(iso.group, B(0.06, H, 0.06), M.ss, W / 2 - 2.5, H / 2, -0.3);
    put(iso.group, RB(0.9, 2.1, 0.03, 0.02), M.glass, W / 2 - 0.65, 1.05, -0.32);
    put(iso.group, Cy(0.1, 0.1, 0.04, 24), M.ssDark, W / 2 - 2.47, 2.25, -0.9, 0, 0, Math.PI / 2);
    put(iso.group, RB(0.95, 2.0, 0.12, 0.04), M.ssDark, W / 2 - 1.25, 0.5, -1.9, -Math.PI / 2); put(iso.group, RB(0.88, 1.9, 0.14, 0.06), M.mattress, W / 2 - 1.25, 0.62, -1.9, -Math.PI / 2);
    iso.anchor.set(W / 2 - 1.25, 2.65, -0.4);
    iso.view = [V(W / 2 - 1.2, 1.7, 1.6), V(W / 2 - 1.3, 1.1, -1.8)];
    // hand-wash, door, storage, automation, fumigation
    const hw = comp('handwash');
    put(hw.group, RB(0.5, 0.4, 0.8, 0.04), M.ss, -W / 2 + 0.3, 0.9, 1.3); put(hw.group, Cy(0.015, 0.015, 0.3, 10), M.chrome, -W / 2 + 0.12, 1.25, 1.3);
    hw.anchor.set(-W / 2 + 0.35, 1.45, 1.3);
    const door = comp('doors');
    put(door.group, B(0.18, 0.3, 1.8), M.ss, -W / 2 + 0.1, 2.38, -0.55);
    put(door.group, RB(1.0, 2.1, 0.06, 0.02), M.ss, -W / 2 + 0.12, 1.06, -0.3, 0, Math.PI / 2);
    put(door.group, RB(0.42, 0.42, 0.065, 0.2), M.glass, -W / 2 + 0.122, 1.5, -0.3, 0, Math.PI / 2);
    door.anchor.set(-W / 2 + 0.15, 2.65, -0.4);
    const st = comp('storage'); put(st.group, RB(1.0, 1.85, 0.36, 0.02), M.ss, W / 2 - 0.25, 0.93, 1.7, 0, Math.PI / 2); st.anchor.set(W / 2 - 0.3, 2.0, 1.7);
    const au = comp('automation'); put(au.group, RB(0.32, 0.22, 0.03, 0.015), M.dark, 1.5, 1.6, -D / 2 + 0.065); au.anchor.set(1.5, 1.85, -D / 2 + 0.1);
    const fu = comp('fumigation'); put(fu.group, RB(0.42, 0.34, 0.3, 0.05), M.blue, -W / 2 + 0.6, 0.17, 2.5); fu.anchor.set(-W / 2 + 0.6, 0.7, 2.5);
    duct([V(AX + 0.5, AY + 0.1, AZ + 0.62), V(AX + 0.5, H + 0.45, -D / 2 + 0.2), V(AX + 0.5, H + 0.45, -1.5), V(W / 2 - 1.6, H + 0.45, -1.5)], 0.55, 0.38, 0x3aa0ff);
    duct([V(W / 2 - 0.4, H, -D / 2 + 0.25), V(W / 2 - 0.4, H + 0.5, -D / 2 + 0.25), V(W / 2 - 0.4, H + 0.5, AZ), V(AX + 1.4, AY - 0.1, AZ)], 0.45, 0.28, 0xff8c42);
    const ris = comp('risers'); put(ris.group, RB(0.55, H, 0.28, 0.02), M.panel, W / 2 - 0.4, H / 2, -D / 2 + 0.18); ris.anchor.set(W / 2 - 0.4, 1.2, -D / 2 + 0.3);
  }

  for (const [key, c] of Object.entries(comps)) {
    c.group.traverse(o => { o.userData.key = key; });
    if (!c.group.parent) room.add(c.group);
  }
  for (const g of extras) g.visible = false;

  // ------------------------------------------------------------ labels, info card, guided tour
  const picked = new Set(opts.features);
  const tags = {};
  const card = el('div', 'info'); card.hidden = true;
  let tour = null, tourBtn = null;
  const showInfo = (i, extra = {}) => {
    card.replaceChildren();
    if (extra.step) card.append(el('div', 'yes', extra.step));
    card.append(el('b', null, `${i.icon ? i.icon + '  ' : ''}${i.label}`), el('div', null, i.hint));
    if (extra.mine) card.append(el('div', 'yes', '✓ In your plan'));
    if (extra.nav) card.append(extra.nav);
    const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { card.hidden = true; stopTour(); }; card.append(x);
    card.hidden = false;
  };
  const showKey = (key, extra) => showInfo(info(key) || { label: key, hint: '' }, { ...extra, mine: picked.has(key) });
  for (const key of Object.keys(comps)) {
    if (!info(key)) continue;
    const t = el('button', 'tag' + (picked.has(key) ? ' on' : ''));
    t.type = 'button'; t.append(el('i'), document.createTextNode(info(key).label));
    t.onclick = e => { e.stopPropagation(); stopTour(); showKey(key); };
    tags[key] = t; box.append(t);
  }
  const hintEl = el('div', 'hint3d', opts.moreBeds ? `Showing 6 of ${opts.moreBeds + 6} beds · drag to turn` : 'Drag to turn · tap any part, a wall or the floor');
  // finish picker on the right: tap a wall (SS / PPGI / glass / wood) or the floor (two vinyl colours)
  const fin = el('div', 'finish'); fin.hidden = true;
  const emit = () => opts.onFinish?.({ wall: { ...look.wall }, floor: { ...look.floor } });
  const swatch = (hex, name, on, fn) => { const b = el('button', 'sw' + (on ? ' on' : '')); b.type = 'button'; b.title = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', String(on)); b.style.background = typeof hex === 'number' ? '#' + hex.toString(16).padStart(6, '0') : hex; b.onclick = fn; return b; };
  const openFinish = what => {
    card.hidden = true; stopTour();
    fin.replaceChildren();
    if (what === 'wall') {
      fin.append(el('b', null, '🧱 Wall panels'), el('div', 'sub', 'Choose the finish for the OT walls.'));
      for (const f of WALL_FINISHES) {
        const on = look.wall.finish === f.key;
        const row = el('div', 'opt' + (on ? ' on' : ''));
        const head = el('button', 'opt-h', f.name); head.type = 'button'; head.setAttribute('aria-pressed', String(on));
        head.onclick = () => { setFinish(f.key); emit(); openFinish('wall'); };
        row.append(head);
        if (on) {
          row.append(el('div', 'hint', f.hint));
          const sws = el('div', 'sws');
          if (f.colours.length > 1) for (const c of f.colours) sws.append(swatch(c[1], c[0], look.wall.colour === c[0], () => { setFinish(f.key, c[0]); emit(); openFinish('wall'); }));
          sws.append(el('span', 'one', f.key === 'ss' ? 'No colour: natural steel' : f.colours.length > 1 ? look.wall.colour : `One colour: ${f.colours[0][0]}`));
          row.append(sws);
        }
        fin.append(row);
      }
    } else {
      fin.append(el('b', null, '⬛ Floor'), el('div', 'sub', 'Seamless antistatic vinyl. Pick two colours.'));
      for (const [k, label] of [['main', 'Main colour (under the table)'], ['border', 'Border colour']]) {
        const sws = el('div', 'sws');
        for (const [n, hex] of FLOOR_COLOURS) sws.append(swatch(hex, n, look.floor[k] === n, () => { setFloor(k === 'main' ? n : look.floor.main, k === 'border' ? n : look.floor.border); emit(); openFinish('floor'); }));
        sws.append(el('span', 'one', look.floor[k]));
        fin.append(el('div', 'lbl', label), sws);
      }
    }
    const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { fin.hidden = true; }; fin.append(x);
    fin.hidden = false;
  };
  box.append(hintEl, card, fin);
  let onlyMine = false, anatomy = false, allLabels = false, build = 1, buildPlay = null, anatBtn = null;
  let exploded = 0, explodeTo = 0, exAnim = null, ahuFocus = false; // ahuFocus: close-up on the AHU (ducts hidden so nothing blocks it)
  const ANATOMY_LABELS = new Set([...anatomyTags, 'ahu', 'laf', 'hepa', 'risers']);
  const applyVisibility = () => {
    for (const [key, c] of Object.entries(comps)) {
      const always = ['panels', 'flooring', 'table', 'risers', 'ahu', 'velocity'].includes(key) || anatomyTags.has(key);
      if (!anatomyTags.has(key)) c.group.visible = (always || key === 'props' || !onlyMine || picked.has(key)) && !c.buildHidden;
      const shown = anatomyTags.has(key) ? anatomy : c.group.visible;
      // labels stay out of the way: only with "All labels", or the numbered stages of a dismantled AHU
      const hide = !shown || (key === 'ahu' && !anatomy) || (explodeTo ? !(AHU_KEYS.has(key) && key !== 'ahu') : !allLabels || (anatomy && !ANATOMY_LABELS.has(key)));
      tags[key]?.classList.toggle('hidden', hide);
    }
    for (const g of extras) g.visible = anatomy;
    if (comps.ducts) comps.ducts.group.visible = !ahuFocus;
    ceiling.visible = !anatomy && build > 0.9;
    if (air) air.points.visible = (air.on || anatomy) && comps.laf.group.visible && build > 0.985;
  };
  const PHASE = { flooring: 0, velocity: 2, table: 1, props: 1, warmers: 1, nurse: 1, fumigation: 1, laf: 2, hepa: 2, otlight: 2, pendants: 2 };
  const built = Object.entries(comps).filter(([k]) => !anatomyTags.has(k) && k !== 'ahu')
    .map(([k, c]) => ({ c, phase: PHASE[k] ?? 3, base: c.group.position.clone() }));
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const applyBuild = t => {
    build = Math.max(0, Math.min(1, t));
    for (const a of built) {
      const p = Math.max(0, Math.min(1, (build * 4.6 - a.phase) / 1.25)), e = easeOut(p), g = a.c.group;
      g.position.copy(a.base); g.scale.set(1, 1, 1);
      if (a.phase === 0) g.position.y -= (1 - e) * 1.4;
      else if (a.phase === 1) g.position.y += (1 - e) * 1.6;
      else if (a.phase === 2) g.position.y += (1 - e) * 3.2;
      else g.scale.y = Math.max(0.001, e); // walls and everything on them rise from the floor
      a.c.buildHidden = p <= 0;
    }
    applyVisibility();
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(build * 100));
  };
  const slider = el('input', 'build-range'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '100';
  slider.setAttribute('aria-label', 'Build the room');
  slider.oninput = () => { buildPlay = null; controls.autoRotate = false; applyBuild(Number(slider.value) / 100); };
  const buildBox = el('label', 'build-bar'); buildBox.append(el('span', null, '🧱 Build'), slider);
  box.append(buildBox);
  const playBuild = (ms = 3600) => { stopTour(); applyBuild(0); buildPlay = { start: performance.now(), ms }; controls.autoRotate = true; controls.autoRotateSpeed = 1.6; };
  applyVisibility();

  const views = {
    overview: isWard ? [V(6.4, 5.4, 7.4), V(0, 0.9, -0.3)] : [V(6.6, 5.3, 7.2), V(0, 1.05, -0.1)],
    eye: isWard ? [V(-1, 1.65, 2.4), V(-1.5, 1.2, -2.2)] : [V(2.4, 1.7, 2.5), V(-0.4, 1.35, -0.8)],
    anatomy: isWard ? [V(9.5, 10, 8.5), V(0, 2.2, -2.6)] : [V(8.6, 8.8, 7.6), V(0, 2.2, -2.2)],
  };
  let anim = null;
  const fit = () => { const a = Math.max(0.3, box.clientWidth / Math.max(1, box.clientHeight)); return a < 1.3 ? Math.min(1.75, (1.3 / a) ** 0.55) : 1; };
  const scaled = ([p, t], s) => [t.clone().add(p.clone().sub(t).multiplyScalar(s)), t.clone()];
  const viewOf = name => (['overview', 'anatomy'].includes(name) ? scaled(views[name], fit()) : views[name]);
  const flyTo = ([p, t], ms = 1100) => { if (buildPlay) { buildPlay = null; applyBuild(1); } controls.autoRotate = false; anim = { p0: camera.position.clone(), t0: controls.target.clone(), p, t, start: performance.now(), ms }; };
  const fly = name => flyTo(viewOf(name));
  { const [p, t] = viewOf('overview'); camera.position.copy(p); controls.target.copy(t); }

  // Guided tour: the visitor's choices first, then how the clean air flows
  const AIR_STORY = { icon: '🌬️', label: 'How the clean air flows', hint: isWard
    ? 'The AHU on the terrace filters and cools the air (blue arrows); it enters through HEPA diffusers over the beds and leaves through the return riser (orange) back to the AHU.'
    : 'The outdoor unit and AHU filter, cool and dry the air (pre-filter → fine filter → coil → blower). It comes down through the HEPA plenum over the table (blue), sweeps the surgical area and leaves low down through the return risers (orange) back to the AHU.' };
  const tourStops = () => {
    const order = isWard ? ['bedhead', 'mgps', 'warmers', 'nurse', 'pressure', 'hepa', 'doors'] : ['laf', 'hepa', 'velocity', 'otlight', 'pendants', 'control', 'mgps', 'storage', 'xray', 'passbox', 'doors', 'scrub'];
    const have = order.filter(k => comps[k] && info(k) && comps[k].group.visible);
    const chosen = have.filter(k => picked.has(k) || (k === 'velocity' && picked.has('laf')));
    const list = (chosen.length >= 2 ? chosen : have.slice(0, 5)).map(k => ({ key: k, view: comps[k].view || [comps[k].anchor.clone().add(V(1.6, 0, 2.0)), comps[k].anchor.clone()] }));
    list.push({ story: AIR_STORY, view: viewOf('anatomy'), anatomy: true });
    return list;
  };
  function stopTour() { if (tour) { clearTimeout(tour.timer); tour = null; tourBtn?.setAttribute('aria-pressed', 'false'); } }
  const navBtn = (t, fn) => { const x = el('button', null, t); x.type = 'button'; x.style.cssText = 'border:1px solid #c9d4e6;background:#fff;color:#15202f;border-radius:8px;padding:5px 12px;cursor:pointer;font-weight:600'; x.onclick = fn; return x; };
  const goStop = i => {
    const stops = tour.stops; tour.i = Math.max(0, Math.min(stops.length - 1, i));
    const s = stops[tour.i];
    if (!!s.anatomy !== anatomy) setAnatomy(!!s.anatomy);
    flyTo(s.view, 1300);
    const last = tour.i === stops.length - 1;
    const nav = el('div'); nav.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    nav.append(navBtn('‹', () => { clearTimeout(tour.timer); goStop(tour.i - 1); }),
      navBtn(last ? 'Done' : 'Next ›', () => { clearTimeout(tour.timer); if (last) { stopTour(); card.hidden = true; setAnatomy(false); fly('overview'); } else goStop(tour.i + 1); }));
    const step = `Tour ${tour.i + 1} of ${stops.length}`;
    if (s.story) showInfo(s.story, { step, nav }); else showKey(s.key, { step, nav });
    clearTimeout(tour.timer);
    if (!last) tour.timer = setTimeout(() => tour && goStop(tour.i + 1), 6500);
  };

  // AHU: one tap flies in close, a double tap takes it apart so every stage can be seen (and tapped)
  const setAnatomy = on => { anatomy = on; ahuFocus = false; if (!on) explodeTo = 0; anatBtn?.setAttribute('aria-pressed', String(on)); applyVisibility(); };
  const ahuView = () => (explodeTo ? [V(AX + 0.3, AY + 0.9, AZ + 11.2), V(AX + 0.1, AY - 0.05, AZ + 1.4)] : [V(AX + 1.7, AY + 1.0, AZ + 5.0), V(AX, AY - 0.1, AZ + 0.1)]);
  const ahuClose = key => {
    stopTour(); fin.hidden = true;
    if (build < 1) { buildPlay = null; applyBuild(1); }
    if (!anatomy) setAnatomy(true);
    ahuFocus = true; applyVisibility();
    flyTo(scaled(ahuView(), fit()), 1200);
    const i = info(key) || info('ahu');
    showInfo(i, { step: explodeTo ? '💥 Exploded view · double-tap again to put it back' : '❄️ AHU close-up · double-tap it to take it apart', mine: picked.has(key) });
  };
  const toggleExplode = key => { explodeTo = explodeTo ? 0 : 1; applyVisibility(); ahuClose(explodeTo ? 'ahu' : key); if (explodeTo) showInfo({ icon: '💥', label: 'Inside the AHU', hint: 'Air moves left to right: pre-filter → fine filter → cooling coil → SHRM heat recovery → blower → UV lamps, then into the supply duct to the HEPA plenum. Tap any part to see what it does.' }, { step: 'Exploded view · double-tap to put it back' }); };
  // a short blue outline round whatever was tapped
  const sel = new T.BoxHelper(undefined, 0x2f7fd8); sel.visible = false; sel.material.depthTest = false; sel.material.transparent = true; sel.renderOrder = 10; scene.add(sel);
  let selT = 0;
  const flash = key => { const g = comps[key]?.group; if (!g || ['panels', 'flooring', 'props'].includes(key)) return; sel.setFromObject(g); sel.visible = true; selT = 2.2; };

  // tap a part of the room
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  let down = null, lastTap = 0, lastKey = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (tour) clearTimeout(tour.timer); });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(Object.values(comps).map(c => c.group), true).find(i => { let o = i.object; while (o) { if (!o.visible) return false; o = o.parent; } return !!info(i.object.userData.key); });
    const now = performance.now();
    if (hit) {
      const key = hit.object.userData.key, dbl = now - lastTap < 400 && AHU_KEYS.has(lastKey);
      stopTour();
      if (AHU_KEYS.has(key)) { if (dbl) toggleExplode(key); else if (explodeTo && key !== 'ahu') { showKey(key, { step: 'Exploded view · double-tap to put it back' }); flash(key); } else ahuClose(key); }
      else if (key === 'panels' && hit.object.userData.wall) openFinish('wall');
      else if (key === 'flooring') openFinish('floor');
      else { fin.hidden = true; showKey(key); flash(key); }
      lastKey = key;
    } else if (!tour) { card.hidden = true; lastKey = null; }
    lastTap = now;
  });

  // ------------------------------------------------------------ size & animation loop
  const resize = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(box); resize();
  const v = new T.Vector3(), m4 = new T.Matrix4(), q = new T.Quaternion(), up = V(0, 1, 0), dir = new T.Vector3(), one = V(1, 1, 1), at = new T.Vector3();
  const order = Object.keys(tags).sort((a, b) => Number(picked.has(b)) - Number(picked.has(a)));
  let raf = 0, last = performance.now(), doorT = 0;
  const pointAt = (f, d) => { let s = d; for (let i = 0; i < f.pts.length - 1; i++) { const a = f.pts[i], b = f.pts[i + 1], len = a.distanceTo(b); if (s <= len) { dir.subVectors(b, a).normalize(); return at.copy(a).addScaledVector(dir, s); } s -= len; } return at.copy(f.pts[f.pts.length - 1]); };
  const loop = now => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (anim) {
      const k = Math.min(1, (now - anim.start) / anim.ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(anim.p0, anim.p, e); controls.target.lerpVectors(anim.t0, anim.t, e);
      if (k >= 1) anim = null;
    }
    if (buildPlay) { const k = Math.min(1, (now - buildPlay.start) / buildPlay.ms); applyBuild(k); if (k >= 1) { buildPlay = null; controls.autoRotate = false; } }
    if (air?.points.visible) {
      const p = air.points.geometry.attributes.position.array;
      for (let i = 0; i < air.n; i++) {
        const y = p[i * 3 + 1] - air.vel[i] * dt;
        if (y < 1.05) { const x = p[i * 3], z = p[i * 3 + 2], r = Math.hypot(x, z) || 0.01; p[i * 3] += (x / r) * 0.7 * dt; p[i * 3 + 2] += (z / r) * 0.5 * dt; }
        p[i * 3 + 1] = y;
        if (y < 0.55 || Math.abs(p[i * 3]) > 1.9 || Math.abs(p[i * 3 + 2]) > 1.5) air.reset(i, false);
      }
      air.points.geometry.attributes.position.needsUpdate = true;
    }
    if (anatomy) {
      for (const [o, ax, sp] of spinning) o.rotation[ax] += sp * dt;
      for (const f of flows) {
        f.off = (f.off + dt * 0.9) % (f.total / f.n);
        for (let i = 0; i < f.n; i++) {
          const pnt = pointAt(f, (f.off + (i * f.total) / f.n) % f.total);
          q.setFromUnitVectors(up, dir);
          m4.compose(pnt, q, one); f.mesh.setMatrixAt(i, m4);
        }
        f.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (exploded !== explodeTo) {
      if (!exAnim || exAnim.to !== explodeTo) exAnim = { from: exploded, to: explodeTo, start: now };
      const k = Math.min(1, (now - exAnim.start) / 900);
      exploded = k >= 1 ? explodeTo : exAnim.from + (explodeTo - exAnim.from) * easeOut(k);
      if (k >= 1) exAnim = null;
      for (const p of ahuParts) {
        const g = p.c.group;
        if (p.casing) g.position.set(p.base.x, p.base.y + exploded * 0.25, p.base.z - exploded * 2.4);
        else if (p.odu) g.position.set(p.base.x + exploded * 3.6, p.base.y, p.base.z - exploded * 2.6);
        else { g.position.set(p.base.x + p.x * 1.9 * exploded, p.base.y, p.base.z + exploded * 1.6); p.c.anchor.set(g.position.x, AY + 0.82, g.position.z + 0.6); }
      }
    }
    if (selT > 0) { selT -= dt; sel.material.opacity = Math.min(1, selT); if (selT <= 0) sel.visible = false; }
    if (comps.doors?.leaf && comps.doors.group.visible) { doorT += dt; const s = (Math.sin(doorT * 0.6) + 1) / 2; const sl = comps.doors.slide || { axis: 'x', base: -1.12, amp: 0.95 }; comps.doors.leaf.position[sl.axis] = sl.base + s * sl.amp; }
    controls.update();
    renderer.render(scene, camera);
    const w = box.clientWidth, h = box.clientHeight;
    // keep labels clear of the build slider and the hint
    const br = box.getBoundingClientRect(), keepOut = el => { const r = el.getBoundingClientRect(); return [r.left - br.left, r.top - br.top, r.right - br.left, r.bottom - br.top]; };
    const placed = [keepOut(buildBox), keepOut(hintEl)];
    const tk = tour && !tour.stops[tour.i]?.anatomy ? tour.stops[tour.i]?.key : null; // on the tour only the current stop is labelled
    for (const key of order) {
      const t = tags[key];
      if (build < 0.999 || (tk ? key !== tk : t.classList.contains('hidden'))) { t.style.display = 'none'; continue; }
      v.copy(comps[key].anchor).project(camera);
      const tw = (t._w ||= t.offsetWidth || 120), th = 24;
      const x0 = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      const x = Math.min(Math.max(x0, tw / 2 + 4), Math.max(tw / 2 + 4, w - tw / 2 - 4));
      const hits = r => placed.some(p => r[0] < p[2] + 4 && r[2] > p[0] - 4 && r[1] < p[3] + 2 && r[3] > p[1] - 2);
      let rect = null, yy = y;
      if (!(v.z > 1 || x0 < -20 || x0 > w + 20 || y < 10 || y > h + 10)) for (const dy of [0, 27, -27, 54, -54]) { const r = [x - tw / 2, y + dy - th, x + tw / 2, y + dy]; if (!hits(r) && r[1] > 0 && r[3] < h) { rect = r; yy = y + dy; break; } }
      t.style.display = rect ? '' : 'none';
      if (rect) { placed.push(rect); t.style.left = `${x}px`; t.style.top = `${yy}px`; }
      t.classList.toggle('dim', !picked.has(key) && !anatomyTags.has(key));
    }
  };
  if (!opts.noIntro) playBuild();
  raf = requestAnimationFrame(loop);
  const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', vis);

  return {
    setFinish(key, colour) { setFinish(key, colour); },
    setFloor(main, border) { setFloor(main, border); },
    openFinish,
    controls: [
      { label: '🧱 Build it again', run: () => { playBuild(); } },
      { label: '▶ Take the tour', pressed: false, ref: b => { tourBtn = b; }, run: () => { if (tour) { stopTour(); card.hidden = true; return false; } buildPlay = null; controls.autoRotate = false; applyBuild(1); tour = { stops: tourStops(), i: 0 }; goStop(0); return true; } },
      { label: '🎨 Walls & floor', run: () => { if (anatomy) setAnatomy(false); fly('overview'); openFinish('wall'); } },
      { label: '🔬 Anatomy: how air flows', pressed: false, ref: b => { anatBtn = b; }, run: () => { stopTour(); fin.hidden = true; if (build < 1) { buildPlay = null; applyBuild(1); } const on = ahuFocus || !anatomy; explodeTo = 0; setAnatomy(on); fly(anatomy ? 'anatomy' : 'overview'); if (anatomy) showInfo({ icon: '🔬', label: 'How the clean air flows', hint: 'Blue arrows: filtered, cooled air from the AHU to the HEPA filters. Orange arrows: used air going back from the room. Tap the AHU for a close-up; double-tap it to take it apart.' }); else card.hidden = true; return anatomy; } },
      { label: '❄️ AHU close-up', run: () => { if (explodeTo) { explodeTo = 0; applyVisibility(); } ahuClose('ahu'); } },
      { label: '💥 Take the AHU apart', run: () => { if (!anatomy) setAnatomy(true); toggleExplode('ahu'); } },
      { label: isWard ? '👁 Bed-side view' : "👁 Surgeon's view", run: () => { stopTour(); if (anatomy) setAnatomy(false); fly('eye'); } },
      ...(isWard ? [] : [{ label: '🚿 Passage & scrub', run: () => { stopTour(); if (anatomy) setAnatomy(false); flyTo(comps.passage.view, 1300); showKey('scrub'); } }]),
      ...(isWard ? [] : [{ label: 'Clean air flow', pressed: !!air?.on, run: () => { air.on = !air.on; applyVisibility(); return air.on; } }]),
      { label: '🏷 Labels', pressed: allLabels, run: () => { allLabels = !allLabels; applyVisibility(); return allLabels; } },
      { label: 'Show only my choices', pressed: false, run: () => { onlyMine = !onlyMine; applyVisibility(); return onlyMine; } },
      { label: '↺ Overview', run: () => { stopTour(); card.hidden = true; fin.hidden = true; if (anatomy) setAnatomy(false); fly('overview'); } },
    ],
    dispose() {
      stopTour(); cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); if (o.material?.map) o.material.map.dispose?.(); });
      for (const m of [...Object.values(M), ...mats]) m.dispose();
      scene.environment?.dispose?.();
      renderer.dispose(); renderer.forceContextLoss?.();
    },
  };
}
