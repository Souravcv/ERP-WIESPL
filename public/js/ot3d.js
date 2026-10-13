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
  ahu_pre: { label: '1 · Pre-filter', hint: 'First stage: catches dust and larger particles from fresh and return air.' },
  ahu_fine: { label: '2 · Fine filter', hint: 'Second stage: removes finer dust so the HEPA filters last longer.' },
  ahu_coil: { label: '3 · Cooling coil', hint: 'Cools the air and removes moisture, keeping the OT at about 20–22 °C and below 55% humidity.' },
  ahu_fan: { label: '4 · Blower', hint: 'Pushes the air through the ducts and HEPA filters at the right speed (variable, with a quiet night mode).' },
  ahu_heat: { label: '5 · Heater & UV lamp', hint: 'Re-heats the air for exact humidity control; the UV lamp keeps the coil free of germs.' },
  odu: { label: 'Outdoor unit', hint: 'The compressor outside the building. Copper pipes carry refrigerant to the cooling coil in the AHU.' },
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
  const info = k => opts.info[k] || PARTS[k];

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
  const M = {
    ss: new T.MeshStandardMaterial({ color: 0xdfe4ea, map: brushed, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.1 }),
    ssDark: new T.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.85, roughness: 0.35 }),
    chrome: new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
    panel: new T.MeshStandardMaterial({ color: 0xe4eaf1, metalness: 0.12, roughness: 0.42, envMapIntensity: 0.35 }),
    cut: new T.MeshStandardMaterial({ color: 0xcfd8e2, metalness: 0.2, roughness: 0.5, envMapIntensity: 0.4 }),
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
  const anatomyTags = new Set(['ahu_pre', 'ahu_fine', 'ahu_coil', 'ahu_fan', 'ahu_heat', 'odu']);
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
  const floorTex = tex(512, 512, (g, w, h) => { g.fillStyle = '#5f84a8'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '40,60,90'},${Math.random() * 0.09})`; g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); } }, [W / 3, D / 3]);
  const flooring = comp('flooring');
  put(flooring.group, new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.25 }), 0, 0, 0, -Math.PI / 2);
  flooring.anchor.set(W / 2 - 1.2, 0.05, D / 2 - 1.2);
  // panel walls: 1.2 m wide panels with slim seams
  const panelWall = (len, axis, fixed, h, thick = 0.06) => {
    const n = Math.round(len / 1.2), pw = len / n;
    for (let i = 0; i < n; i++) {
      const c = -len / 2 + pw * (i + 0.5);
      const p = put(panels.group, B(pw - 0.008, h, thick), M.panel);
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
      put(panels.group, axis === 'x' ? B(len, cutH, t) : B(t, cutH, len), m, axis === 'x' ? 0 : c, cutH / 2, axis === 'x' ? c : 0);
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
  // ground outside the room catches soft shadows
  const ground = new T.Mesh(new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.002; ground.receiveShadow = true; scene.add(ground);

  // ------------------------------------------------------------ terrace: AHU with its stages, outdoor unit, ducts
  const ahu = comp('ahu');
  extras.push(put(ahu.group, B(W + 1.2, 0.08, 3.4), C(0xb9c3cf, { rough: 0.9, opacity: 0.55 }), 0.3, H + 0.6, -D / 2 - 1.75));
  const AX = isWard ? -1.5 : 0, AY = H + 1.27, AZ = -D / 2 - 1.85;
  const ahuBody = new T.Group(); ahuBody.position.set(AX, AY, AZ); ahu.group.add(ahuBody); extras.push(ahuBody);
  // casing: solid back, top, bottom and ends; see-through front so the stages show
  put(ahuBody, B(2.7, 0.06, 1.2), M.ahu, 0, -0.62, 0); put(ahuBody, B(2.7, 0.06, 1.2), M.ahu, 0, 0.62, 0);
  put(ahuBody, B(2.7, 1.3, 0.05), M.ahu, 0, 0, -0.58); put(ahuBody, B(0.05, 1.3, 1.2), M.ahu, -1.33, 0, 0); put(ahuBody, B(0.05, 1.3, 1.2), M.ahu, 1.33, 0, 0);
  put(ahuBody, B(2.7, 1.3, 0.02), M.glass, 0, 0, 0.6);
  for (const x of [-1.33, -0.75, -0.2, 0.55, 1.33]) put(ahuBody, B(0.04, 1.32, 1.22), M.ssDark, x, 0, 0);
  put(ahuBody, B(2.8, 0.14, 1.3), M.dark, 0, -0.72, 0);
  const pleat = tex(128, 128, (g, w, h) => { g.fillStyle = '#f2f2ea'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#c9c9bd'; g.fillRect(x, 0, 3, h); } });
  const fine = tex(128, 128, (g, w, h) => { g.fillStyle = '#e9eef7'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 5) { g.fillStyle = '#b4c1d6'; g.fillRect(x, 0, 2, h); } });
  const fins = tex(128, 128, (g, w, h) => { g.fillStyle = '#c7d0da'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 3) { g.fillStyle = '#8e9aa8'; g.fillRect(x, 0, 1, h); } g.strokeStyle = '#b8743f'; g.lineWidth = 5; for (let y = 12; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } });
  const stage = (key, x, mat, w = 0.08) => { const c = comp(key); put(c.group, B(w, 1.1, 1.0), mat); c.group.position.set(AX + x, AY, AZ); c.anchor.set(AX + x, AY + 0.82, AZ + 0.6); extras.push(c.group); };
  stage('ahu_pre', -1.05, new T.MeshStandardMaterial({ map: pleat, roughness: 0.9 }));
  stage('ahu_fine', -0.48, new T.MeshStandardMaterial({ map: fine, roughness: 0.9 }));
  stage('ahu_coil', 0.12, new T.MeshStandardMaterial({ map: fins, metalness: 0.6, roughness: 0.4 }), 0.22);
  { // blower wheel (spins)
    const c = comp('ahu_fan'); c.group.position.set(AX + 0.85, AY - 0.05, AZ); extras.push(c.group);
    put(c.group, Cy(0.36, 0.36, 0.5, 28, true), M.ssDark, 0, 0, 0, Math.PI / 2);
    const wheel = new T.Group(); c.group.add(wheel);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const b = put(wheel, B(0.03, 0.2, 0.42), M.chrome, Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0); b.rotation.z = a + 0.4; }
    put(wheel, Cy(0.06, 0.06, 0.46, 12), M.dark, 0, 0, 0, Math.PI / 2);
    spinning.push([wheel, 'z', 9]);
    c.anchor.set(AX + 0.85, AY + 0.82, AZ + 0.6);
  }
  { // heater rods + UV lamp
    const c = comp('ahu_heat'); c.group.position.set(AX + 1.18, AY, AZ); extras.push(c.group);
    for (let i = 0; i < 4; i++) put(c.group, Cy(0.018, 0.018, 0.95, 10), C(0xd9532b, { emissive: 0xff5a1f, ei: 0.6, metal: 0.6 }), 0, -0.35 + i * 0.22, 0, Math.PI / 2);
    put(c.group, Cy(0.022, 0.022, 0.9, 10), new T.MeshBasicMaterial({ color: 0xb48cff, toneMapped: false }), -0.08, 0.45, 0, Math.PI / 2);
    c.anchor.set(AX + 1.18, AY + 0.82, AZ + 0.6);
  }
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
  }
  // rectangular flanged ducts with moving arrows (blue = clean supply air, orange = return air)
  const duct = (pts, w, h, color) => {
    const g = new T.Group(); ahu.group.add(g); extras.push(g);
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
    // LAF plenum: steel box, perforated diffuser over the HEPA filters, LED edge, glass air-curtain skirt
    const laf = comp('laf'), hepa = comp('hepa');
    put(laf.group, RB(2.5, 1.9, 0.26, 0.03), M.ss, 0, H - 0.13, 0, -Math.PI / 2);
    const perf = tex(512, 384, (g, w, h) => { g.fillStyle = '#eef1f4'; g.fillRect(0, 0, w, h); g.fillStyle = '#b9c2cc'; for (let y = 6; y < h; y += 9) for (let x = (y / 9) % 2 ? 6 : 10; x < w; x += 9) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); } g.strokeStyle = '#9aa5b2'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); });
    put(hepa.group, new T.PlaneGeometry(2.3, 1.7), new T.MeshStandardMaterial({ map: perf, metalness: 0.5, roughness: 0.35 }), 0, H - 0.262, 0, Math.PI / 2);
    for (const [x, z, w, d] of [[0, 0.93, 2.42, 0.035], [0, -0.93, 2.42, 0.035], [1.23, 0, 0.035, 1.82], [-1.23, 0, 0.035, 1.82]]) put(laf.group, B(w, 0.02, d), M.led, x, H - 0.265, z);
    for (const [x, z, w, d] of [[0, 0.97, 2.5, 0.01], [0, -0.97, 2.5, 0.01], [1.27, 0, 0.01, 1.94], [-1.27, 0, 0.01, 1.94]]) put(laf.group, B(w, 0.25, d), M.glass, x, H - 0.39, z);
    laf.anchor.set(-1.25, H - 0.08, 0.98); hepa.anchor.set(1.05, H - 0.32, 0.7);
    laf.view = [V(3.3, 1.35, 3.5), V(0, 1.75, 0)]; hepa.view = [V(1.6, 0.95, 1.8), V(0, 2.75, 0)];
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
    // wall gas & power panel
    put(gas.group, RB(0.62, 0.36, 0.04, 0.02), M.white, -W / 2 + 0.06, 1.45, 1.95, 0, Math.PI / 2);
    outlets(gas.group, -W / 2 + 0.085, 1.5, 1.95, 'x', 4, 0.12); sockets(gas.group, -W / 2 + 0.085, 1.33, 1.95, 3, 'x');
    gas.view = [V(-1.3, 1.6, 2.4), V(-3, 1.45, 1.95)];
    // hermetic sliding door (glides open and shut)
    const door = comp('doors');
    const dx = -1.5, dz = -D / 2 + 0.04;
    put(door.group, B(1.85, 0.32, 0.18), M.ss, dx + 0.45, 2.38, dz + 0.1);
    put(door.group, B(1.3, 2.22, 0.03), M.dark, dx, 1.11, dz + 0.02);
    const leaf = new T.Group(); leaf.position.set(dx + 0.38, 0, dz + 0.1); door.group.add(leaf);
    put(leaf, RB(1.25, 2.15, 0.06, 0.02), M.ss, 0, 1.1, 0);
    put(leaf, RB(0.42, 0.42, 0.065, 0.2), M.glass, 0, 1.55, 0.002);
    put(leaf, new T.TorusGeometry(0.21, 0.012, 8, 32), M.chrome, 0, 1.55, 0.035);
    put(leaf, B(0.05, 0.45, 0.05), M.chrome, -0.52, 1.05, 0.06);
    put(door.group, B(1.6, 0.03, 0.08), M.ssDark, dx + 0.38, 0.015, dz + 0.1);
    door.anchor.set(dx + 0.38, 2.6, dz + 0.2);
    door.view = [V(-0.9, 1.55, -0.6), V(-1.2, 1.25, -3)];
    door.leaf = leaf;
    // surgeon's control panel
    const ctl = comp('control');
    const ui = tex(640, 400, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0d2036'); gr.addColorStop(1, '#081422'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#9fc4ec'; g.font = '24px sans-serif'; g.fillText('WIESPL  ·  OT 1', 24, 38); g.fillText('10:42', w - 92, 38);
      const tile = (x, y, label, value, color) => { g.fillStyle = '#132e4c'; g.fillRect(x, y, 186, 120); g.fillStyle = color; g.font = 'bold 50px sans-serif'; g.fillText(value, x + 16, y + 70); g.fillStyle = '#9fb8d6'; g.font = '20px sans-serif'; g.fillText(label, x + 16, y + 104); };
      tile(24, 60, 'TEMPERATURE', '21.5°', '#5ab0ff'); tile(226, 60, 'HUMIDITY', '50%', '#5ee09a'); tile(428, 60, 'PRESSURE', '+12Pa', '#ffd166');
      ['LIGHTS', 'GASES', 'TIMER', 'MUSIC', 'CALL'].forEach((t, i) => { g.fillStyle = i === 2 ? '#1f6feb' : '#1a3b60'; g.fillRect(24 + i * 120, 210, 108, 74); g.fillStyle = '#eaf2fb'; g.font = 'bold 20px sans-serif'; g.fillText(t, 36 + i * 120, 254); });
      g.fillStyle = '#0f2a44'; g.fillRect(24, 300, w - 48, 74); g.fillStyle = '#5ee09a'; g.font = 'bold 30px sans-serif'; g.fillText('SURGERY  00:47:12', 40, 348);
    });
    put(ctl.group, RB(1.05, 0.68, 0.04, 0.02), M.ss, 0.95, 1.5, -D / 2 + 0.07);
    put(ctl.group, new T.PlaneGeometry(0.97, 0.6), new T.MeshBasicMaterial({ map: ui, toneMapped: false }), 0.95, 1.5, -D / 2 + 0.093);
    ctl.anchor.set(0.95, 1.95, -D / 2 + 0.1);
    ctl.view = [V(0.95, 1.55, -1.4), V(0.95, 1.5, -3)];
    // room pressure gauge
    const pr = comp('pressure');
    const gauge = tex(160, 160, g => { g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 80, 76, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 3; for (let a = 0; a <= 10; a++) { const t = Math.PI * (0.8 + a * 0.14); g.beginPath(); g.moveTo(80 + Math.cos(t) * 60, 80 + Math.sin(t) * 60); g.lineTo(80 + Math.cos(t) * 70, 80 + Math.sin(t) * 70); g.stroke(); } g.strokeStyle = '#c0392b'; g.lineWidth = 5; g.beginPath(); g.moveTo(80, 80); g.lineTo(122, 52); g.stroke(); g.fillStyle = '#333'; g.font = '16px sans-serif'; g.fillText('Pa', 70, 128); });
    put(pr.group, Cy(0.12, 0.12, 0.05, 28), M.ssDark, -0.25, 2.15, -D / 2 + 0.07, Math.PI / 2);
    put(pr.group, new T.CircleGeometry(0.105, 28), new T.MeshBasicMaterial({ map: gauge }), -0.25, 2.15, -D / 2 + 0.097);
    pr.anchor.set(-0.25, 2.38, -D / 2 + 0.1);
    // automation: ceiling sensor + wall display
    const au = comp('automation');
    put(au.group, new T.SphereGeometry(0.08, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, -1.2, H, -1.4, Math.PI);
    put(au.group, new T.CircleGeometry(0.018, 12), new T.MeshBasicMaterial({ color: 0x2ecc71, toneMapped: false }), -1.2, H - 0.081, -1.4, Math.PI / 2);
    const mini = tex(200, 140, g => { g.fillStyle = '#0d2036'; g.fillRect(0, 0, 200, 140); g.fillStyle = '#5ee09a'; g.font = 'bold 30px sans-serif'; g.fillText('ALL OK', 30, 60); g.fillStyle = '#9fc4ec'; g.font = '18px sans-serif'; g.fillText('online', 62, 105); });
    put(au.group, RB(0.3, 0.21, 0.03, 0.015), M.ssDark, 0.12, 1.55, -D / 2 + 0.065);
    put(au.group, new T.PlaneGeometry(0.27, 0.18), new T.MeshBasicMaterial({ map: mini, toneMapped: false }), 0.12, 1.55, -D / 2 + 0.082);
    au.anchor.set(-1.2, H - 0.18, -1.4);
    // X-ray viewer
    const xr = comp('xray');
    const film = tex(256, 320, g => { g.fillStyle = '#0b0e12'; g.fillRect(0, 0, 256, 320); const gr = g.createRadialGradient(128, 150, 20, 128, 160, 150); gr.addColorStop(0, 'rgba(210,220,230,.85)'); gr.addColorStop(1, 'rgba(30,35,40,.2)'); g.fillStyle = gr; g.beginPath(); g.ellipse(90, 170, 55, 110, 0, 0, Math.PI * 2); g.ellipse(166, 170, 55, 110, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(230,235,240,.6)'; g.lineWidth = 4; for (let y = 70; y < 280; y += 22) { g.beginPath(); g.ellipse(128, y, 100, 14, 0, Math.PI * 0.05, Math.PI * 0.95); g.stroke(); } });
    put(xr.group, RB(1.05, 0.66, 0.05, 0.02), M.ss, -W / 2 + 0.06, 1.6, 0.25, 0, Math.PI / 2);
    for (const dzz of [-0.25, 0.25]) put(xr.group, new T.PlaneGeometry(0.44, 0.56), new T.MeshBasicMaterial({ map: film, toneMapped: false }), -W / 2 + 0.088, 1.6, 0.25 + dzz, 0, Math.PI / 2);
    xr.anchor.set(-W / 2 + 0.1, 2.0, 0.25);
    xr.view = [V(-1.4, 1.6, 0.4), V(-3, 1.6, 0.25)];
    // pass box with interlock lights
    const pb = comp('passbox');
    put(pb.group, RB(0.62, 0.62, 0.18, 0.03), M.ss, -W / 2 + 0.1, 1.15, -1.3, 0, Math.PI / 2);
    put(pb.group, RB(0.5, 0.5, 0.02, 0.02), M.glass, -W / 2 + 0.2, 1.15, -1.3, 0, Math.PI / 2);
    put(pb.group, new T.CircleGeometry(0.02, 10), new T.MeshBasicMaterial({ color: 0x2ecc71, toneMapped: false }), -W / 2 + 0.205, 1.5, -1.12, 0, Math.PI / 2);
    put(pb.group, new T.CircleGeometry(0.02, 10), new T.MeshBasicMaterial({ color: 0xe74c3c, toneMapped: false }), -W / 2 + 0.205, 1.5, -1.2, 0, Math.PI / 2);
    pb.anchor.set(-W / 2 + 0.15, 1.6, -1.3);
    // scrub station
    const sc = comp('scrub');
    put(sc.group, RB(1.25, 0.5, 0.55, 0.04), M.ss, -W / 2 + 0.33, 0.95, -2.25, 0, Math.PI / 2);
    put(sc.group, RB(1.05, 0.12, 0.38, 0.05), M.chrome, -W / 2 + 0.38, 1.17, -2.25, 0, Math.PI / 2);
    for (const dzz of [-0.3, 0.3]) { put(sc.group, Cy(0.018, 0.018, 0.32, 10), M.chrome, -W / 2 + 0.15, 1.38, -2.25 + dzz); put(sc.group, Cy(0.015, 0.015, 0.2, 10), M.chrome, -W / 2 + 0.25, 1.53, -2.25 + dzz, 0, 0, Math.PI / 2); }
    put(sc.group, B(0.03, 0.9, 1.2), M.ss, -W / 2 + 0.08, 1.7, -2.25);
    sc.anchor.set(-W / 2 + 0.45, 1.6, -2.25);
    // storage cabinet with shelves and consumables
    const st = comp('storage');
    put(st.group, RB(1.3, 1.95, 0.38, 0.02), M.ss, 2.1, 1.3, -D / 2 + 0.24);
    for (const y of [0.75, 1.2, 1.65]) put(st.group, B(1.18, 0.02, 0.3), M.chrome, 2.1, y, -D / 2 + 0.25);
    for (const [x, y, c] of [[1.75, 0.82, 0x6aa9e9], [2.0, 0.84, 0xf0f2f5], [2.35, 0.8, 0x91d18b], [1.85, 1.27, 0xf6c66b], [2.3, 1.29, 0xf0f2f5]]) put(st.group, B(0.18, 0.12, 0.2), C(c, { rough: 0.7 }), x, y, -D / 2 + 0.26);
    put(st.group, B(1.2, 1.8, 0.02), M.glass, 2.1, 1.3, -D / 2 + 0.44);
    st.anchor.set(2.1, 2.45, -D / 2 + 0.3);
    // fumigation fogger
    const fu = comp('fumigation');
    put(fu.group, RB(0.42, 0.34, 0.3, 0.05), M.blue, 2.25, 0.17, 2.1);
    put(fu.group, Cy(0.035, 0.06, 0.24, 14), M.dark, 2.25, 0.46, 2.1);
    fu.anchor.set(2.25, 0.8, 2.1);
    // return-air risers in the back corners, grille low down
    const ris = comp('risers');
    const grille = tex(128, 192, g => { g.fillStyle = '#d9dee4'; g.fillRect(0, 0, 128, 192); g.fillStyle = '#626d7a'; for (let y = 10; y < 190; y += 12) g.fillRect(8, y, 112, 5); });
    for (const x of [-2.55, 2.55]) {
      put(ris.group, RB(0.62, H, 0.3, 0.02), M.panel, x, H / 2, -D / 2 + 0.2);
      put(ris.group, new T.PlaneGeometry(0.5, 0.62), new T.MeshStandardMaterial({ map: grille, metalness: 0.5, roughness: 0.4 }), x, 0.5, -D / 2 + 0.352);
    }
    ris.anchor.set(2.55, 1.2, -D / 2 + 0.35);
    // the air cycle: supply duct to the plenum, return ducts from the risers
    duct([V(AX + 0.5, AY + 0.1, AZ + 0.62), V(AX + 0.5, AY + 0.1, -1.0), V(0, AY + 0.1, -0.2), V(0, H + 0.28, 0)], 0.62, 0.42, 0x3aa0ff);
    duct([V(-2.55, H, -D / 2 + 0.2), V(-2.55, H + 0.55, -D / 2 + 0.2), V(-2.55, H + 0.55, AZ + 0.35), V(AX - 1.1, AY - 0.35, AZ + 0.35)], 0.5, 0.3, 0xff8c42);
    duct([V(2.55, H, -D / 2 + 0.2), V(2.55, H + 0.55, -D / 2 + 0.2), V(2.55, H + 0.55, AZ), V(AX + 1.4, AY - 0.1, AZ)], 0.5, 0.3, 0xff8c42);
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
        const bed = new T.Group(); bed.position.set(x, 0, -1.85); room.add(bed);
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
      if (i < shown - 1) put(room, B(0.01, 2.0, 2.0), curtain, x + span / 2, 1.25, -1.9);
      put(hp.group, RB(0.6, 0.6, 0.04, 0.02), M.white, x, H - 0.02, -1.5, Math.PI / 2);
      put(hp.group, new T.PlaneGeometry(0.5, 0.5), M.ledCool, x, H - 0.045, -1.5, Math.PI / 2);
    }
    put(room, B(W - 2.8, 0.03, 0.03), M.chrome, -0.6, 2.28, -0.85);
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
  box.append(el('div', 'hint3d', opts.moreBeds ? `Showing 6 of ${opts.moreBeds + 6} beds · drag to turn` : 'Drag to turn · tap a part'), card);
  const narrow = box.clientWidth < 600;
  let onlyMine = false, anatomy = false, allLabels = !narrow;
  const ANATOMY_LABELS = new Set([...anatomyTags, 'ahu', 'laf', 'hepa', 'risers']);
  const applyVisibility = () => {
    for (const [key, c] of Object.entries(comps)) {
      const always = ['panels', 'flooring', 'table', 'risers', 'ahu'].includes(key) || anatomyTags.has(key);
      if (!anatomyTags.has(key)) c.group.visible = always || !onlyMine || picked.has(key);
      const shown = anatomyTags.has(key) ? anatomy : c.group.visible;
      const hide = !shown || (key === 'ahu' && !anatomy) || (anatomy ? !ANATOMY_LABELS.has(key) : (!allLabels && !picked.has(key)));
      tags[key]?.classList.toggle('hidden', hide);
    }
    for (const g of extras) g.visible = anatomy;
    ceiling.visible = !anatomy;
    if (air) air.points.visible = (air.on || anatomy) && comps.laf.group.visible;
  };
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
  const flyTo = ([p, t], ms = 1100) => { anim = { p0: camera.position.clone(), t0: controls.target.clone(), p, t, start: performance.now(), ms }; };
  const fly = name => flyTo(viewOf(name));
  { const [p, t] = viewOf('overview'); camera.position.copy(p); controls.target.copy(t); }

  // Guided tour: the visitor's choices first, then how the clean air flows
  const AIR_STORY = { icon: '🌬️', label: 'How the clean air flows', hint: isWard
    ? 'The AHU on the terrace filters and cools the air (blue arrows); it enters through HEPA diffusers over the beds and leaves through the return riser (orange) back to the AHU.'
    : 'The outdoor unit and AHU filter, cool and dry the air (pre-filter → fine filter → coil → blower). It comes down through the HEPA plenum over the table (blue), sweeps the surgical area and leaves low down through the return risers (orange) back to the AHU.' };
  const tourStops = () => {
    const order = isWard ? ['bedhead', 'mgps', 'warmers', 'nurse', 'pressure', 'hepa', 'doors'] : ['laf', 'hepa', 'otlight', 'pendants', 'mgps', 'control', 'doors', 'xray'];
    const have = order.filter(k => comps[k] && info(k) && comps[k].group.visible);
    const chosen = have.filter(k => picked.has(k));
    const list = (chosen.length >= 2 ? chosen : have.slice(0, 5)).map(k => ({ key: k, view: comps[k].view || [comps[k].anchor.clone().add(V(1.6, 0, 2.0)), comps[k].anchor.clone()] }));
    list.push({ story: AIR_STORY, view: viewOf('anatomy'), anatomy: true });
    return list;
  };
  function stopTour() { if (tour) { clearTimeout(tour.timer); tour = null; tourBtn?.setAttribute('aria-pressed', 'false'); } }
  const navBtn = (t, fn) => { const x = el('button', null, t); x.type = 'button'; x.style.cssText = 'border:1px solid #c9d4e6;background:#fff;color:#15202f;border-radius:8px;padding:5px 12px;cursor:pointer;font-weight:600'; x.onclick = fn; return x; };
  const goStop = i => {
    const stops = tour.stops; tour.i = Math.max(0, Math.min(stops.length - 1, i));
    const s = stops[tour.i];
    if (!!s.anatomy !== anatomy) { anatomy = !!s.anatomy; applyVisibility(); }
    flyTo(s.view, 1300);
    const last = tour.i === stops.length - 1;
    const nav = el('div'); nav.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    nav.append(navBtn('‹', () => { clearTimeout(tour.timer); goStop(tour.i - 1); }),
      navBtn(last ? 'Done' : 'Next ›', () => { clearTimeout(tour.timer); if (last) { stopTour(); card.hidden = true; anatomy = false; applyVisibility(); fly('overview'); } else goStop(tour.i + 1); }));
    const step = `Tour ${tour.i + 1} of ${stops.length}`;
    if (s.story) showInfo(s.story, { step, nav }); else showKey(s.key, { step, nav });
    clearTimeout(tour.timer);
    if (!last) tour.timer = setTimeout(() => tour && goStop(tour.i + 1), 6500);
  };

  // tap a part of the room
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (tour) clearTimeout(tour.timer); });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(Object.values(comps).map(c => c.group), true).find(i => { let o = i.object; while (o) { if (!o.visible) return false; o = o.parent; } return !!info(i.object.userData.key); });
    if (hit) { stopTour(); showKey(hit.object.userData.key); } else if (!tour) card.hidden = true;
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
    if (comps.doors?.leaf && comps.doors.group.visible) { doorT += dt; const s = (Math.sin(doorT * 0.6) + 1) / 2; comps.doors.leaf.position.x = -1.5 + 0.38 + s * 0.95; }
    controls.update();
    renderer.render(scene, camera);
    const w = box.clientWidth, h = box.clientHeight;
    const placed = [];
    for (const key of order) {
      const t = tags[key];
      if (t.classList.contains('hidden') || (tour && tour.stops[tour.i]?.key !== key && !tour.stops[tour.i]?.anatomy)) { t.style.display = 'none'; continue; }
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
  raf = requestAnimationFrame(loop);
  const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', vis);

  return {
    controls: [
      { label: '▶ Take the tour', pressed: false, ref: b => { tourBtn = b; }, run: () => { if (tour) { stopTour(); card.hidden = true; return false; } tour = { stops: tourStops(), i: 0 }; goStop(0); return true; } },
      { label: '🔬 Anatomy: how air flows', pressed: false, run: () => { stopTour(); anatomy = !anatomy; applyVisibility(); fly(anatomy ? 'anatomy' : 'overview'); if (anatomy) showInfo({ icon: '🔬', label: 'How the clean air flows', hint: 'Blue arrows: filtered, cooled air from the AHU to the HEPA filters. Orange arrows: used air going back from the room. Tap the numbered AHU stages to see what each one does.' }); else card.hidden = true; return anatomy; } },
      { label: 'Show only my choices', pressed: false, run: () => { onlyMine = !onlyMine; applyVisibility(); return onlyMine; } },
      { label: 'All labels', pressed: allLabels, run: () => { allLabels = !allLabels; applyVisibility(); return allLabels; } },
      ...(isWard ? [] : [{ label: 'Clean air flow', pressed: !!air?.on, run: () => { air.on = !air.on; applyVisibility(); return air.on; } }]),
      { label: isWard ? '👁 Bed-side view' : "👁 Surgeon's view", run: () => { stopTour(); fly('eye'); } },
      { label: '↺ Overview', run: () => { stopTour(); card.hidden = true; if (anatomy) { anatomy = false; applyVisibility(); } fly('overview'); } },
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
