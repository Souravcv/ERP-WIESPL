// Finished operation theatres inside the CAD drawing's 3D: every OT found in the drawing is fitted out where it stands,
// with the finishes chosen for it (or the WIESPL standard until something is chosen): panel walls on the walls the
// drawing really has, with coved vinyl at their foot; doors in the openings (hermetic sliding and double-leaf swing are
// both built, the chosen one shows); seamless vinyl floor with its border; tiled ceiling with the laminar air flow plenum
// flush in it and LED panels round it; OT light, pendants, table, anaesthesia machine, trolley, storage cabinet,
// surgeon's control panel, X-ray viewer, return-air risers and a picture-glass panel. Kept light (shared materials and
// textures, soft painted shadows under the equipment) so a floor with twenty OTs still turns smoothly on an office PC.
import { OT_FINISHES, FLOOR_COLOURS } from '../ot3d.js';
import { artTexture, drawAvenue, drawLake, drawForest, drawVision, drawGrille, drawPanelScreen, drawXray, drawPerforated, drawCeilingTile, brushed, drawVinyl, drawBlob, drawLedPanel, drawVitals, drawScope, drawScrubTimer, drawSky } from './plan3d-art.js';

// the printed picture-glass scenes a client can choose from
export const PICTURES = [['avenue', 'Blossom avenue', drawAvenue], ['lake', 'Mountain lake', drawLake], ['forest', 'Sunlit forest', drawForest]];
const VIVID = { Beige: 0xd4b47c, Grey: 0x76869b, 'Sky blue': 0x2f86cf, 'Aqua green': 0x22a88e, 'Navy blue': 0x173a73, 'Light grey': 0xbfc8d3 };
// the glass wall colours, a little deeper in the 3D than their swatches so they read under bright OT light
const WALL_VIVID = { 'Ivory white': 0xe6d6ae, 'Sky blue': 0x4b94d4, 'Mint green': 0x55bb92 };
const floorHex = name => VIVID[name] ?? parseInt((FLOOR_COLOURS.find(c => c[0] === name) || FLOOR_COLOURS[0])[1].slice(1), 16);
const doorKind = f => (f.door === 'sliding' || !f.door ? 'sliding' : 'swing'); // automatic swing looks like swing
// KLEENCLAD antimicrobial cladding in the client film: RAL 7035 light grey, matte (low glare under OT lights)
export const KLEENCLAD = 0xcbd0cc;

// materials and textures shared by all the OTs of one viewer
export function makeFitKit(T) {
  const mats = new Map(), texs = new Map();
  const get = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
  const tex = (key, draw, w, h, rep) => { if (!texs.has(key)) { const t = artTexture(T, draw, w, h); if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } texs.set(key, t); } return texs.get(key); };
  const seam = tex('seam', (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(40,52,68,.5)'; g.fillRect(0, 0, 3, h); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(3, 0, 1, h); }, 256, 8, [1, 1]);
  const brushedSeam = tex('brushedSeam', brushed(true), 256, 256, [1, 3]), brushedPlain = tex('brushed', brushed(false), 256, 256, [1, 1]);
  // studio reflections only on metal and glass: painted panels and vinyl keep their true colour
  const std = (color, metal = 0.1, rough = 0.5, extra = {}) => new T.MeshStandardMaterial({ color, metalness: metal, roughness: rough, envMapIntensity: metal > 0.5 ? 1 : 0.2, ...extra });
  const basic = extra => new T.MeshBasicMaterial({ toneMapped: false, ...extra });
  const kit = {
    panel(f) {
      if (f.wall === 'kleenclad') { const m = get('p-kleenclad', () => std(KLEENCLAD, 0, 0.88, { envMapIntensity: 0.04 })); return { low: m, high: m, combo: false }; }
      const F = OT_FINISHES.find(x => x.key === f.wall) || OT_FINISHES[0];
      const C = F.colours.find(c => c[0] === f.wall_colour) || F.colours[0], colour = (F.key === 'glass' || F.key === 'ssglass') ? WALL_VIVID[C[0]] ?? C[1] : C[1];
      const ss = () => std(0xffffff, 0.85, 0.32, { map: brushedSeam });
      const make = () => (F.metal > 0.5 ? ss() : F.key === 'glass' || F.key === 'ssglass'
        ? new T.MeshPhysicalMaterial({ color: colour, metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.4, map: seam })
        : std(colour, F.metal, F.rough, { map: seam }));
      return { low: get(`p-low-${F.key}-${colour}`, () => (F.combo ? ss() : make())), high: get(`p-high-${F.key}-${colour}`, make), combo: !!F.combo };
    },
    floor: name => get(`f-${name}`, () => std(floorHex(name), 0, 0.42, { map: tex('vinyl', drawVinyl, 256, 256, [6, 6]), envMapIntensity: 0.18 })),
    inlay: get('inlay', () => std(0x2a3a52, 0, 0.5)),
    ss: get('ss', () => std(0xffffff, 0.85, 0.3, { map: brushedPlain })),
    ssDark: get('ssDark', () => std(0x9aa4b0, 0.8, 0.35, { map: brushedPlain })),
    white: get('white', () => std(0xf1f3f5, 0.05, 0.38)),
    grey: get('grey', () => std(0xd3d8de, 0.1, 0.45)),
    ceiling: get('ceiling', () => std(0xf6f7f8, 0, 0.8, { side: T.DoubleSide, envMapIntensity: 0.05 })), // seamless: one smooth surface, no grid
    plenumSS: get('plenumSS', () => std(0xffffff, 0.85, 0.3, { map: brushedPlain })), // the plenum is the one stainless steel part
    frontGlass: get('frontGlass', () => new T.MeshPhysicalMaterial({ color: 0x6fa6d6, metalness: 0, roughness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.3 })),
    board: get('board', () => std(0xfdfdfd, 0, 0.18, { envMapIntensity: 0.4 })),
    cabinet: get('cabinet', () => std(0xf1f3f4, 0.05, 0.45)),
    cabInside: get('cabInside', () => std(0xaeb8c2, 0, 0.8)),
    cabShadow: get('cabShadow', () => std(0x6f7b88, 0, 0.9)),
    cabGlass: get('cabGlass', () => new T.MeshPhysicalMaterial({ color: 0xe8f4f6, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.3, depthWrite: false })),
    supply: ['supply-a', 'supply-b', 'supply-c'].map((k, i) => get(k, () => std([0xf7f8f9, 0x8fc1e3, 0x5d8fc0][i], 0, 0.6))),
    pictureTall: key => { const P = PICTURES.find(p => p[0] === key) || PICTURES[0]; return get(`pict-${P[0]}`, () => std(0xffffff, 0, 0.12, { map: tex(`pict-${P[0]}`, P[2], 1024, 1240), envMapIntensity: 0.45 })); },
    dark: get('dark', () => std(0x1f2630, 0.3, 0.45)),
    rubber: get('rubber', () => std(0x2b2f36, 0, 0.85)),
    mattress: get('mattress', () => std(0x27384d, 0, 0.72)),
    glass: get('glass', () => std(0xd6ecff, 0.1, 0.05, { transparent: true, opacity: 0.28, depthWrite: false, envMapIntensity: 1.2 })),
    // window glass with the electrostatic (switchable) privacy film: clear when the film is off, frosted white when on
    outside: get('outside', () => basic({ map: tex('outside', drawSky, 1024, 640) })), // the view through a window
    smartGlass: get('smartGlass', () => new T.MeshPhysicalMaterial({ color: 0xeaf6ff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.16, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false, side: T.DoubleSide })),
    setSmartFilm(on) {
      const m = kit.smartGlass;
      if (on) { m.color.setHex(0xf3f6f8); m.opacity = 0.94; m.roughness = 0.85; m.clearcoat = 0.2; m.envMapIntensity = 0.1; }
      else { m.color.setHex(0xeaf6ff); m.opacity = 0.16; m.roughness = 0.03; m.clearcoat = 1; m.envMapIntensity = 1.4; }
      m.depthWrite = on; m.needsUpdate = true;
    },
    scrubTimer: get('scrubTimer', () => basic({ map: tex('scrubTimer', drawScrubTimer, 256, 128) })),
    led: get('led', () => basic({ color: 0xfffbf0 })),
    ledCool: get('ledCool', () => basic({ color: 0xeaf4ff })),
    ledPanel: get('ledPanel', () => basic({ map: tex('ledPanel', drawLedPanel, 128, 128) })),
    screen: get('screen', () => basic({ color: 0x235f9e })),
    vitals: get('vitals', () => basic({ map: tex('vitals', drawVitals, 512, 320) })),
    scope: get('scope', () => basic({ map: tex('scope', drawScope, 512, 320) })),
    socket: get('socket', () => std(0xfafafa, 0, 0.35)),
    blob: get('blob', () => new T.MeshBasicMaterial({ map: tex('blob', drawBlob, 128, 128), transparent: true, depthWrite: false, opacity: 0.75 })),
    blobSoft: get('blobSoft', () => new T.MeshBasicMaterial({ map: tex('blob', drawBlob, 128, 128), transparent: true, depthWrite: false, opacity: 0.35 })),
    gas: c => get(`gas-${c}`, () => std(c, 0.1, 0.4)),
    picture: key => { const P = PICTURES.find(p => p[0] === key) || PICTURES[0]; return get(`pic-${P[0]}`, () => std(0xffffff, 0, 0.12, { map: tex(`pic-${P[0]}`, P[2], 1536, 768), envMapIntensity: 0.45 })); },
    vision: get('vision', () => std(0xffffff, 0, 0.1, { map: tex('vision', drawVision, 256, 352), transparent: true, depthWrite: false, side: T.DoubleSide })),
    grille: get('grille', () => std(0xffffff, 0.6, 0.4, { map: tex('grille', drawGrille, 128, 128) })),
    panelUi: get('panelUi', () => basic({ map: tex('panelUi', drawPanelScreen, 1024, 600) })),
    xray: get('xray', () => basic({ map: tex('xray', drawXray, 512, 352) })),
    perforated: get('perforated', () => std(0xffffff, 0.55, 0.38, { map: tex('perf', drawPerforated, 256, 256, [8, 6]) })),
    // the swing door in a soft powder-coated finish (as on WIESPL sites), the sliding door in steel
    door: kind => get(`door-${kind}`, () => (kind === 'swing' ? std(0xe1e7de, 0.15, 0.4) : std(0xffffff, 0.8, 0.32, { map: brushedPlain }))),
    // the client film: no stainless steel except the plenum (door frames, shelves, cabinets in matte powder coat; the
    // sliding door in matte HPL). filmLook(false) puts everything back as it was.
    filmLook(on) {
      const set = (m, look) => { if (!m) return; m.userData.normal ||= { color: m.color.getHex(), metalness: m.metalness, roughness: m.roughness, map: m.map, env: m.envMapIntensity }; const n = m.userData.normal, v = on ? look : n;
        m.color.setHex(v.color); m.metalness = v.metalness; m.roughness = v.roughness; m.map = on ? null : n.map; m.envMapIntensity = on ? 0.15 : n.env; m.needsUpdate = true; };
      set(kit.ss, { color: 0xe2e5e8, metalness: 0.15, roughness: 0.55 });
      set(kit.ssDark, { color: 0xb9c0c8, metalness: 0.15, roughness: 0.55 });
      set(kit.door('sliding'), { color: 0xe4e8e5, metalness: 0.05, roughness: 0.6 });
    },
    dispose() { for (const m of mats.values()) m.dispose(); for (const t of texs.values()) t.dispose(); mats.clear(); texs.clear(); },
  };
  return kit;
}

// a plane w × d whose texture repeats every tile metres (ceiling tiles)
function tiledPlane(T, w, d, tile) {
  const g = new T.PlaneGeometry(w, d), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (d / tile));
  return g;
}

// Show other finishes on an OT already fitted out (the tour does this while it explains the options): the wall
// panels, floor, coving and picture glass take the materials of finish, and the chosen kind of door shows.
export function restyle(kit, group, finish) {
  const P = kit.panel(finish), kind = doorKind(finish);
  group.traverse(m => {
    const part = m.userData.part; if (!part) return;
    if (part.startsWith('door:')) { m.visible = part === `door:${kind}`; return; }
    m.material = part === 'wallLow' ? P.low : part === 'wallHigh' ? P.high : part === 'floorMain' ? kit.floor(finish.floor_main) : part === 'floorBorder' ? kit.floor(finish.floor_border) : part === 'picture' ? kit.picture(finish.picture) : m.material;
  });
}

// Everything in an OT that never moves or changes is merged into one mesh per material (needs three.js
// BufferGeometryUtils): a few dozen draw calls per OT instead of hundreds, so the view turns and the tour moves smoothly.
// Restyled parts (walls, floor, coving, picture) are merged by part, so restyle still finds them; the doors and the
// instanced LEDs are left as they are.
export function mergeStatic(T, root) {
  const U = T.BufferGeometryUtils; if (!U?.mergeBufferGeometries) return;
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert(), M = new T.Matrix4(), buckets = new Map(), done = [];
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.door) return;
    for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData.part) return;
    const part = o.userData.part || '', key = part + '|' + o.material.uuid + (o.castShadow ? ':c' : '');
    const g = o.geometry.clone(); g.applyMatrix4(M.multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, part, list: [] });
    buckets.get(key).list.push(g); done.push(o);
  });
  for (const o of done) { o.parent.remove(o); o.geometry.dispose(); }
  for (const { mat, cast, part, list } of buckets.values()) {
    const merged = list.length > 1 ? U.mergeBufferGeometries(list, false) : list[0];
    if (merged !== list[0]) list.forEach(g => g.dispose());
    if (!merged) continue;
    const m = new T.Mesh(merged, mat); m.castShadow = cast; m.receiveShadow = true; if (part) m.userData.part = part; root.add(m);
  }
}

// a box whose texture repeats once every 1.2 m along its length (the panel joints)
function panelBox(T, len, h, t, along) {
  const g = new T.BoxGeometry(along === 'x' ? len : t, h, along === 'x' ? t : len);
  const uv = g.attributes.uv, n = len / 1.2;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n);
  return g;
}

// a door leaf w wide and h high, its width along local x, its foot at y = 0, with the vision panel through it;
// handle: SS pull handles on both faces near the leaf's +x edge
function doorLeaf(T, kit, mat, w, h, handle = false) {
  const g = new T.Group(), ww = Math.min(0.4, w * 0.45), wh = 0.55, wy = 1.45, t = 0.05, side = (w - ww) / 2;
  const piece = (pw, ph, x, y) => { if (pw < 0.01 || ph < 0.01) return; const m = new T.Mesh(new T.BoxGeometry(pw, ph, t), mat); m.position.set(x, y, 0); m.castShadow = true; m.userData.door = true; g.add(m); };
  piece(side, h, -(ww / 2 + side / 2), h / 2); piece(side, h, ww / 2 + side / 2, h / 2);
  piece(ww, h - (wy + wh / 2), 0, (h + wy + wh / 2) / 2); piece(ww, wy - wh / 2, 0, (wy - wh / 2) / 2);
  const v = new T.Mesh(new T.BoxGeometry(ww + 0.04, wh + 0.04, t + 0.012), kit.vision); v.position.set(0, wy, 0); g.add(v);
  if (handle) for (const z of [t / 2 + 0.035, -t / 2 - 0.035]) {
    const x = w / 2 - 0.13, bar = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.36, 12), kit.ss); bar.position.set(x, 1.05, z); g.add(bar);
    for (const y of [0.9, 1.2]) { const st = new T.Mesh(new T.BoxGeometry(0.02, 0.02, 0.035), kit.ss); st.position.set(x, y, z * 0.75); g.add(st); }
  }
  return g;
}

// room: { x0, x1, z0, z1 } in scene metres; finish: the OT's choices; rayDist(ox, oz, dx, dz, max): distance to the
// nearest wall of the drawing. Returns { group, ceiling, spots }: the ceiling is a separate group, shown only from
// inside; spots says where things are (doors, plenum, light, pendants, panel, picture glass, risers), for the tour.
// opt.fx: the drawing's own lines in scene coordinates ({ door, plenum, grille }): doors are put where and as the
// drawing shows them (a straight track: sliding, parked on the drawn side; arcs: swing), the plenum and the return-air
// grilles where they are drawn. opt.chosen: the client chose this OT's door, so it wins over the drawing.
// opt.layout 'entry': laid out round the main door (the client film): the wall facing the door is full-height glass
// with a picture from floor to ceiling in its middle, storage on the right, the surgeon's wall on the left.
export function fitOtRoom(T, kit, room, finish, wallH, rayDist, opt = {}) {
  const group = new T.Group(), ceiling = new T.Group();
  const { x0, x1, z0, z1 } = room, w = x1 - x0, d = z1 - z0, cx0 = (x0 + x1) / 2, cz0 = (z0 + z1) / 2;
  const H = Math.min(wallH, 3.0), long = w >= d, span = long ? w : d, across = long ? d : w;
  const fx = opt.fx || {};
  const within = (segs, m) => { const out = []; if (!segs) return out; for (let i = 0; i < segs.length; i += 4) { const a = segs[i], b = segs[i + 1], c = segs[i + 2], e = segs[i + 3]; if (Math.min(a, c) > x1 + m || Math.max(a, c) < x0 - m || Math.min(b, e) > z1 + m || Math.max(b, e) < z0 - m) continue; out.push(a, b, c, e); } return out; };
  const doorSegs = within(fx.door, 0.6);
  let plen = null; // the plenum as drawn: the outline of its lines inside the room
  { const p = within(fx.plenum, -0.15); if (p.length) { let a = 1e9, b = -1e9, c = 1e9, e = -1e9; for (let i = 0; i < p.length; i += 4) { a = Math.min(a, p[i], p[i + 2]); b = Math.max(b, p[i], p[i + 2]); c = Math.min(c, p[i + 1], p[i + 3]); e = Math.max(e, p[i + 1], p[i + 3]); }
    if (b - a > 1.2 && b - a < 4.2 && e - c > 1.2 && e - c < 4.2) plen = { x: (a + b) / 2, z: (c + e) / 2, sx: b - a, sz: e - c }; } }
  const cx = plen ? plen.x : cx0, cz = plen ? plen.z : cz0; // the table and everything round it stand under the plenum
  const add = (parent, geo, mat, x, y, z, ry = 0, cast = false) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = cast; parent.add(m); return m; };
  const B = (a, b, c) => new T.BoxGeometry(a, b, c), Cy = (a, b, h, n = 16) => new T.CylinderGeometry(a, b, h, n);
  // local frame: u along the room's long side, v across; returns scene x, z
  const at = (u, v) => (long ? [cx + u, cz + v] : [cx + v, cz + u]);
  const rotLong = long ? 0 : Math.PI / 2;
  // faces: every stretch of panelled wall (runs, under and over windows, over doors, closed-off doorways) for the film's
  // shading; foot: false where there is no wall down to the floor (a doorway)
  const spots = { H, long, span, across, center: [cx, cz], at, doors: [], pendants: [], risers: [], kit: [], picture: null, panel: null, laf: null, runs: null, faces: [], tPanel: 0.04 };
  const RX = (x0 + x1) / 2, RZ = (z0 + z1) / 2; // the room's own middle (floor and ceiling)

  // ---- floor: border colour all round, main colour in the field, dark inlay line between them
  const band = Math.min(0.45, Math.min(w, d) * 0.08);
  add(group, B(w, 0.012, d), kit.floor(finish.floor_border), RX, 0.006, RZ).userData.part = 'floorBorder';
  add(group, B(w - band * 2 + 0.05, 0.013, d - band * 2 + 0.05), kit.inlay, RX, 0.0065, RZ);
  add(group, B(w - band * 2, 0.014, d - band * 2), kit.floor(finish.floor_main), RX, 0.007, RZ).userData.part = 'floorMain';

  // ---- walls: panels only where the drawing has a wall; the openings get doors
  const P = kit.panel(finish), DADO = 1.2, DOOR_H = 2.1, T_PANEL = 0.04, SILL = 0.9, HEAD = 2.1;
  const openings = []; // doors and windows found in the walls, built once all walls are known
  const sides = [
    { along: 'x', a: x0, b: x1, fixed: z0, n: 1 }, { along: 'x', a: x0, b: x1, fixed: z1, n: -1 },
    { along: 'z', a: z0, b: z1, fixed: x0, n: 1 }, { along: 'z', a: z0, b: z1, fixed: x1, n: -1 },
  ];
  let longest = null; const allRuns = [], parked = [];
  // the return-air grilles drawn in the room: groups of lines near a wall, each one a riser on the nearest wall
  const drawnGrilles = () => {
    const g = within(fx.grille, -0.05), groups = [];
    for (let i = 0; i < g.length; i += 4) { const x = (g[i] + g[i + 2]) / 2, z = (g[i + 1] + g[i + 3]) / 2; let c = groups.find(q => Math.hypot(q.x - x, q.z - z) < 0.8); if (!c) groups.push(c = { x, z, n: 0, sx: 0, sz: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }); c.n++; c.sx += x; c.sz += z;
      c.x0 = Math.min(c.x0, g[i], g[i + 2]); c.x1 = Math.max(c.x1, g[i], g[i + 2]); c.z0 = Math.min(c.z0, g[i + 1], g[i + 3]); c.z1 = Math.max(c.z1, g[i + 1], g[i + 3]); }
    return groups.filter(c => c.n >= 6).map(c => ({ x: c.sx / c.n, z: c.sz / c.n, sx: c.x1 - c.x0, sz: c.z1 - c.z0 }));
  };
  // the slanted wall a grille sits on (its face towards the room), if there is one
  const slantAt = gpt => {
    const Wl = fx.walls; if (!Wl) return null; let best = null;
    for (let i = 0; i < Wl.length; i += 4) {
      const a = Wl[i], b = Wl[i + 1], dx = Wl[i + 2] - a, dz = Wl[i + 3] - b, L = Math.hypot(dx, dz);
      if (L < 0.5 || L > 2.6) continue;
      const ang = Math.atan2(Math.abs(dz), Math.abs(dx)); if (ang < 0.45 || ang > 1.12) continue; // about 45°
      const k = Math.max(0, Math.min(1, ((gpt.x - a) * dx + (gpt.z - b) * dz) / (L * L))), px = a + dx * k, pz = b + dz * k;
      if (Math.hypot(gpt.x - px, gpt.z - pz) > 0.8) continue;
      const mx = a + dx / 2, mz = b + dz / 2, dc = Math.hypot(mx - RX, mz - RZ);
      if (!best || dc < best.dc) best = { mx, mz, L, ux: dx / L, uz: dz / L, dc, xa: Math.min(a, a + dx), xb: Math.max(a, a + dx), za: Math.min(b, b + dz), zb: Math.max(b, b + dz) };
    }
    return best;
  };
  const grilles = drawnGrilles(), slants = grilles.map(slantAt);
  // a wall's stretch in front of a slanted riser corner is left to the corner's own face
  const inSlant = (sd, t) => slants.some(sl => sl && (sd.along === 'x' ? t > sl.xa - 0.05 && t < sl.xb + 0.05 && Math.min(Math.abs(sl.za - sd.fixed), Math.abs(sl.zb - sd.fixed)) < 0.6 : t > sl.za - 0.05 && t < sl.zb + 0.05 && Math.min(Math.abs(sl.xa - sd.fixed), Math.abs(sl.xb - sd.fixed)) < 0.6));
  // each wall is found from well inside the room, so a recess, a built-in cabinet or a column box drawn into the room
  // is seen where it is; a step in the wall's face starts a new run, and each run's panels stand on its own face
  const median = v => [...v].sort((p, q) => p - q)[v.length >> 1];
  for (const s of sides) {
    const step = 0.2, samples = [], inset = Math.max(0.3, Math.min(1.2, (s.along === 'x' ? d : w) / 2 - 0.3));
    for (let t = s.a + step / 2; t < s.b; t += step) {
      const px = s.along === 'x' ? t : s.fixed + s.n * inset, pz = s.along === 'x' ? s.fixed + s.n * inset : t;
      const dist = rayDist(px, pz, s.along === 'x' ? 0 : -s.n, s.along === 'x' ? -s.n : 0, inset + 0.6);
      samples.push({ t, wall: dist < inset + 0.45 && !inSlant(s, t), face: inset - dist });
    }
    const runs = [];
    for (const p of samples) {
      if (!p.wall) continue;
      const last = runs[runs.length - 1];
      if (last && p.t - last.b <= 0.45 && Math.abs(p.face - median(last.faces)) < 0.12) { last.b = p.t; last.faces.push(p.face); }
      else if (last && p.t - last.b <= 0.45 && last.faces.length === 1) { last.b = p.t; last.faces = [p.face]; } // a lone sample on a corner: not a run of its own
      else runs.push({ a: p.t, b: p.t, faces: [p.face] });
    }
    if (!runs.length) continue;
    for (const r of runs) r.plane = s.fixed + s.n * (median(r.faces) + T_PANEL / 2 + 0.005); // just inside the wall face
    const main = runs.reduce((p, q) => (q.b - q.a > p.b - p.a ? q : p));
    s.plane = main.plane; s.runs = runs;
    runs.forEach((r, i) => {
      const plane = r.plane;
      const put = (from, to, y0, y1, mat, part, off = 0, thick = T_PANEL) => {
        const len = to - from; if (len < 0.05 || y1 - y0 < 0.02) return;
        const g = panelBox(T, len, y1 - y0, thick, s.along), mid = (from + to) / 2, p = plane + s.n * off;
        const m = add(group, g, mat, s.along === 'x' ? mid : p, (y0 + y1) / 2, s.along === 'x' ? p : mid); if (part) m.userData.part = part;
        (s.meshes ||= []).push(m); return m;
      };
      const from = Math.max(s.a, r.a - 0.1), to = Math.min(s.b, r.b + 0.1);
      put(from, to, 0, DADO, P.low, 'wallLow'); put(from, to, DADO, H, P.high, 'wallHigh');
      put(from, to, 0, 0.1, kit.floor(finish.floor_border), 'floorBorder', T_PANEL / 2 + 0.006, 0.012); // coved vinyl skirting
      allRuns.push({ s, from, to, len: to - from, plane }); spots.faces.push({ s, from, to, plane, foot: true });
      const next = runs[i + 1];
      if (next) { // the opening up to the next run: a window when the drawing tags it W…, else a door if it is door-sized
        const g0 = to, g1 = Math.max(s.a, next.a - 0.1), gap = g1 - g0, tag = tagAt(s, (g0 + g1) / 2);
        if (tag && /^[WV]/i.test(tag.t) && gap >= 0.4 && gap <= 6) {
          put(g0, g1, 0, Math.min(SILL, DADO), P.low, 'wallLow'); put(g0, g1, HEAD, H, P.high, 'wallHigh');
          put(g0, g1, 0, 0.1, kit.floor(finish.floor_border), 'floorBorder', T_PANEL / 2 + 0.006, 0.012); // coved vinyl skirting
          spots.faces.push({ s, from: g0, to: g1, plane, foot: true });
          openings.push({ kind: 'window', s, g0, g1, plane, tag });
        } else {
          const drawn = drawnDoor(s, g0, g1);
          if (gap >= 0.7 && gap <= 3.2 && (drawn || tag || !doorSegs.length)) {
            put(g0, g1, DOOR_H, H, P.high, 'wallHigh'); const face = { s, from: g0, to: g1, plane, foot: false }; spots.faces.push(face);
            openings.push({ kind: 'door', s, g0, g1, plane, drawn, tag, face });
          }
        }
      }
    });
  }
  // the main door is the one from the passage / corridor (the others, e.g. into a lab, are secondary swing doors)
  {
    const doorOps = openings.filter(o => o.kind === 'door');
    const outside = o => { const mid = (o.g0 + o.g1) / 2, [x, z] = o.s.along === 'x' ? [mid, o.plane] : [o.plane, mid], nx = o.s.along === 'x' ? 0 : o.s.n, nz = o.s.along === 'x' ? o.s.n : 0; return [x - nx * 2, z - nz * 2]; };
    let main = null;
    if (doorOps.length > 1 && fx.passages?.length) {
      const score = o => { const [x, z] = outside(o); return Math.min(...fx.passages.map(p => Math.hypot(p.x - x, p.z - z))); };
      main = doorOps.reduce((p, q) => (score(q) < score(p) ? q : p));
      if (score(main) > 10) main = null;
    }
    main ||= doorOps.find(o => o.drawn?.kind === 'sliding' && !o.tag) || doorOps.reduce((p, q) => (!p || q.g1 - q.g0 > p.g1 - p.g0 ? q : p), null);
    for (const o of doorOps) { if (o === main || opt.otherDoors) door(o.s, o.g0, o.g1, o.plane, o.drawn, o === main); else closeOff(o); }
    for (const o of openings) if (o.kind === 'window') windowAt(o);
    const m = spots.doors.find(dd => dd.main);
    if (m) scrubStation(m);
  }
  spots.runs = allRuns;

  // an opening that gets no door: panelled up like the wall round it, so the OT has its one main door
  function closeOff(o) {
    const { s, g0, g1, plane } = o, len = g1 - g0, mid = (g0 + g1) / 2;
    const at = (y0, y1, mat, part, off = 0, thick = T_PANEL) => { const g = panelBox(T, len, y1 - y0, thick, s.along), p = plane + s.n * off; const m = add(group, g, mat, s.along === 'x' ? mid : p, (y0 + y1) / 2, s.along === 'x' ? p : mid); m.userData.part = part; (s.meshes ||= []).push(m); };
    at(0, DADO, P.low, 'wallLow'); at(DADO, DOOR_H, P.high, 'wallHigh');
    at(0, 0.1, kit.floor(finish.floor_border), 'floorBorder', T_PANEL / 2 + 0.006, 0.012);
    const [ax, az] = s.along === 'x' ? [g0, plane] : [plane, g0], [bx, bz] = s.along === 'x' ? [g1, plane] : [plane, g1];
    (spots.closed ||= []).push([ax, az, bx, bz]); // walls for walking: nobody walks through it
    if (o.face) o.face.foot = true;
  }

  // the door / window number written next to an opening in the drawing (D2, W10 …), if any
  function tagAt(s, t) {
    if (!fx.tags?.length) return null;
    const [x, z] = s.along === 'x' ? [t, s.fixed] : [s.fixed, t];
    let best = null;
    for (const g of fx.tags) { const dd = Math.hypot(g.x - x, g.z - z); if (dd < 1.6 && (!best || dd < best.d)) best = { ...g, d: dd }; }
    return best;
  }

  // a window: clear glass between sill and head in a slim steel frame, with the switchable privacy film (kit.setSmartFilm)
  function windowAt(o) {
    const { s, g0, g1, plane } = o, len = g1 - g0, mid = (g0 + g1) / 2, hgt = HEAD - SILL;
    const xz = (t, off = 0) => (s.along === 'x' ? [t, plane + s.n * off] : [plane + s.n * off, t]);
    const [gx, gz] = xz(mid, -0.01);
    add(group, s.along === 'x' ? B(len, hgt, 0.012) : B(0.012, hgt, len), kit.smartGlass, gx, SILL + hgt / 2, gz).userData.part = 'smartGlass';
    for (const t of [g0 + 0.02, g1 - 0.02]) { const [fxx, fzz] = xz(t, -0.01); add(group, s.along === 'x' ? B(0.04, hgt, 0.06) : B(0.06, hgt, 0.04), kit.ss, fxx, SILL + hgt / 2, fzz); }
    for (const y of [SILL, HEAD]) { const [fxx, fzz] = xz(mid, -0.01); add(group, s.along === 'x' ? B(len, 0.04, 0.06) : B(0.06, 0.04, len), kit.ss, fxx, y, fzz); }
    { const face = T_PANEL / 2, tw = 0.05, bar = (l, h2, t, y, along) => { const [bx, bz] = xz(t, face + 0.006); add(group, (along ? s.along === 'x' : s.along !== 'x') ? B(l, h2, 0.012) : B(0.012, h2, l), kit.ss, bx, y, bz); };
      for (const t of [g0 - tw / 2, g1 + tw / 2]) bar(tw, hgt + tw * 2, t, SILL + hgt / 2, true);
      bar(len + tw * 2, tw, mid, HEAD + tw / 2, true);
      const [sx2, sz2] = xz(mid, face + 0.03); add(group, s.along === 'x' ? B(len + tw * 2 + 0.04, 0.03, 0.06) : B(0.06, 0.03, len + tw * 2 + 0.04), kit.ss, sx2, SILL - 0.015, sz2); } // the sill
    { const [vx, vz] = xz(mid, -0.45), view = add(group, new T.PlaneGeometry(len + 1.4, hgt + 1.2), kit.outside, vx, SILL + hgt / 2, vz); // the sky outside, facing in
      view.rotation.y = s.along === 'x' ? (s.n > 0 ? 0 : Math.PI) : (s.n > 0 ? Math.PI / 2 : -Math.PI / 2); view.receiveShadow = false; }
    (spots.windows ||= []).push({ x: gx, z: gz, w: len, tag: o.tag?.t });
  }

  // the WIESPL scrub station outside the main door, where the drawing has its hand-wash basins (they are left out of
  // the drawn furniture: spots.scrub is their outline); without basins drawn there, nothing is added
  function scrubStation(m) {
    const segs = fx.furniture; if (!segs?.length) return;
    const ox = m.x - m.inX * 1.2, oz = m.z - m.inZ * 1.2, inRoom = (x, z) => x > x0 - 0.1 && x < x1 + 0.1 && z > z0 - 0.1 && z < z1 + 0.1;
    const pts = [];
    for (let i = 0; i < segs.length; i += 4) { const a = segs[i], b = segs[i + 1], c = segs[i + 2], e = segs[i + 3]; const mx = (a + c) / 2, mz = (b + e) / 2; if (Math.hypot(mx - ox, mz - oz) < 3.2 && !inRoom(a, b) && !inRoom(c, e)) pts.push([a, b, c, e]); }
    if (!pts.length) return;
    // groups of touching lines; the one nearest the door that is basin-sized
    const groups = [];
    for (const p of pts) { const g = groups.find(q => q.some(r => Math.min(Math.hypot(r[0] - p[0], r[1] - p[1]), Math.hypot(r[2] - p[2], r[3] - p[3]), Math.hypot(r[0] - p[2], r[1] - p[3]), Math.hypot(r[2] - p[0], r[3] - p[1])) < 0.35)); if (g) g.push(p); else groups.push([p]); }
    const boxOf = g => { let a = 1e9, b = -1e9, c = 1e9, e = -1e9; for (const p of g) { a = Math.min(a, p[0], p[2]); b = Math.max(b, p[0], p[2]); c = Math.min(c, p[1], p[3]); e = Math.max(e, p[1], p[3]); } return { x0: a, x1: b, z0: c, z1: e }; };
    const cands = groups.filter(g => g.length >= 6).map(boxOf).filter(bx => Math.max(bx.x1 - bx.x0, bx.z1 - bx.z0) >= 0.45 && Math.max(bx.x1 - bx.x0, bx.z1 - bx.z0) <= 3.5 && Math.min(bx.x1 - bx.x0, bx.z1 - bx.z0) <= 1.0);
    if (!cands.length) return;
    // basins near each other (two sinks side by side) make one station
    const near = cands.sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - ox, (p.z0 + p.z1) / 2 - oz) - Math.hypot((q.x0 + q.x1) / 2 - ox, (q.z0 + q.z1) / 2 - oz))[0];
    const bx = cands.filter(c => Math.hypot((c.x0 + c.x1) / 2 - (near.x0 + near.x1) / 2, (c.z0 + c.z1) / 2 - (near.z0 + near.z1) / 2) < 1.6).reduce((p, q) => ({ x0: Math.min(p.x0, q.x0), x1: Math.max(p.x1, q.x1), z0: Math.min(p.z0, q.z0), z1: Math.max(p.z1, q.z1) }));
    spots.scrub = { ...bx };
    const alongX = bx.x1 - bx.x0 >= bx.z1 - bx.z0, len = Math.max(1.2, Math.min(2.6, alongX ? bx.x1 - bx.x0 : bx.z1 - bx.z0));
    const cxs = (bx.x0 + bx.x1) / 2, czs = (bx.z0 + bx.z1) / 2;
    // its back goes to the nearer wall
    const dA = alongX ? rayDist(cxs, czs, 0, -1, 2) : rayDist(cxs, czs, -1, 0, 2), dB = alongX ? rayDist(cxs, czs, 0, 1, 2) : rayDist(cxs, czs, 1, 0, 2);
    const back = dA <= dB ? -1 : 1, wallD = Math.min(dA, dB, 1.5), D = 0.6;
    const g = new T.Group(); g.position.set(alongX ? cxs : cxs + back * (wallD - D / 2 - 0.02), 0, alongX ? czs + back * (wallD - D / 2 - 0.02) : czs);
    g.rotation.y = alongX ? (back < 0 ? 0 : Math.PI) : (back < 0 ? Math.PI / 2 : -Math.PI / 2); group.add(g); // its front (local +z) away from the wall
    const S = (geo, mat, x, y, z) => { const o2 = new T.Mesh(geo, mat); o2.position.set(x, y, z); o2.castShadow = true; o2.receiveShadow = true; g.add(o2); return o2; };
    // local frame: x along the trough, -z towards the wall behind it
    S(B(len, 0.86, D * 0.6), kit.ss, 0, 0.43, -D * 0.2);                 // the cabinet under the trough
    S(B(len, 0.08, D), kit.ss, 0, 0.9, 0);                               // the rim
    S(B(len - 0.12, 0.05, D - 0.14), kit.dark, 0, 0.925, 0.01);          // the deep trough seen from above
    S(B(len, 0.75, 0.04), kit.ss, 0, 1.33, -D / 2 + 0.02);               // splash-back
    const taps = Math.max(1, Math.min(3, Math.floor(len / 0.6)));
    for (let k = 0; k < taps; k++) {
      const x = -len / 2 + len * (k + 0.5) / taps;
      S(Cy(0.016, 0.016, 0.34, 10), kit.ss, x, 1.12, -D / 2 + 0.07);      // sensor gooseneck
      S(B(0.03, 0.03, 0.18), kit.ss, x, 1.28, -D / 2 + 0.15);
      S(B(0.08, 0.05, 0.04), kit.dark, x, 1.22, -D / 2 + 0.05);           // the sensor eye
      S(B(0.1, 0.16, 0.06), kit.white, x + 0.22, 1.42, -D / 2 + 0.05);    // soap / antiseptic dispenser
    }
    S(B(Math.min(0.5, len - 0.2), 0.22, 0.03), kit.dark, 0, 1.86, -D / 2 + 0.03); // the digital scrub timer
    { const t2 = new T.Mesh(new T.PlaneGeometry(Math.min(0.46, len - 0.24), 0.18), kit.scrubTimer); t2.position.set(0, 1.86, -D / 2 + 0.05); g.add(t2); }
    for (const x of [-len / 2 + 0.2, len / 2 - 0.2]) S(B(0.12, 0.05, 0.12), kit.ssDark, x, 0.05, -D * 0.05); // knee / foot pedals
    spots.scrubAt = { x: g.position.x, z: g.position.z, fx: Math.sin(g.rotation.y), fz: Math.cos(g.rotation.y), len }; // fx, fz: the way it faces
  }
  const planeAt = (sd, t) => (sd.runs || []).find(r => t >= r.a - 0.15 && t <= r.b + 0.15)?.plane ?? sd.plane;

  // what the drawing shows in an opening: a straight line along the wall (a sliding door, parked where the line goes on
  // past the opening) or arcs (a swing door); null when nothing is drawn there
  function drawnDoor(s, g0, g1) {
    if (!doorSegs.length) return null;
    const par = []; let arcs = 0;
    for (let i = 0; i < doorSegs.length; i += 4) {
      const ta = s.along === 'x' ? doorSegs[i] : doorSegs[i + 1], pa = (s.along === 'x' ? doorSegs[i + 1] : doorSegs[i]) - s.fixed;
      const tb = s.along === 'x' ? doorSegs[i + 2] : doorSegs[i + 3], pb = (s.along === 'x' ? doorSegs[i + 3] : doorSegs[i + 2]) - s.fixed;
      if (Math.abs(pa) > 0.6 && Math.abs(pb) > 0.6) continue;
      const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
      if (Math.abs(pa - pb) < 0.05 && hi - lo > 0.3) { if (hi > g0 && lo < g1) par.push([lo, hi]); }
      else if (hi > g0 - 0.15 && lo < g1 + 0.15) arcs++;
    }
    if (par.length) { const lo = Math.min(...par.map(p => p[0])), hi = Math.max(...par.map(p => p[1])); return { kind: 'sliding', park: hi - g1 >= g0 - lo ? 'hi' : 'lo', beyond: Math.max(hi - g1, g0 - lo) }; }
    return arcs >= 2 ? { kind: 'swing' } : null;
  }

  // both kinds of door are built in each opening; the chosen one shows (restyle switches them)
  // the main door takes the chosen kind (hermetic sliding as standard); a secondary door stays as the drawing shows it
  // (a swing door when nothing says otherwise) and is not switched by restyle
  function door(s, g0, g1, plane, drawn, isMain) {
    const gap = g1 - g0, mid = (g0 + g1) / 2, kind = isMain ? (drawn && !opt.chosen && !fx.tags?.length ? drawn.kind : doorKind(finish)) : (drawn?.kind || 'swing');
    const xz = (t, off = 0) => (s.along === 'x' ? [t, plane + s.n * off] : [plane + s.n * off, t]);
    const [dx, dz] = xz(mid), info = { x: dx, z: dz, inX: s.along === 'x' ? 0 : s.n, inZ: s.along === 'x' ? s.n : 0, gap, kind, main: !!isMain, side: s };
    const partOf = k => (isMain ? `door:${k}` : `fixed:${k}`);
    spots.doors.push(info);
    // the steel frame round the opening
    // (slim, so it stays within the wall's depth and does not stand out into the corridor)
    for (const t of [g0, g1]) { const [jx, jz] = xz(t, -0.04); add(group, s.along === 'x' ? B(0.06, DOOR_H + 0.06, 0.13) : B(0.13, DOOR_H + 0.06, 0.06), kit.ss, jx, (DOOR_H + 0.06) / 2, jz); }
    { const [jx, jz] = xz(mid, -0.04); add(group, s.along === 'x' ? B(gap + 0.12, 0.06, 0.13) : B(0.13, 0.06, gap + 0.12), kit.ss, jx, DOOR_H + 0.03, jz); }
    // hermetic sliding: parked open beside the opening, on its track; setOpen(0) slides it shut
    const slide = new T.Group(); slide.userData.part = partOf('sliding'); slide.visible = kind === 'sliding'; group.add(slide);
    const leafW = Math.min(gap, 1.6), fitsHi = g1 + 0.02 <= s.b - leafW, t0 = drawn?.park === 'lo' || (!drawn?.park && !fitsHi) ? g0 - leafW - 0.02 : g1 + 0.02;
    parked.push({ s, a: t0 - 0.08, b: t0 + leafW + 0.08 });
    const slider = new T.Group(); slide.add(slider);
    { const [lx, lz] = xz(t0 + leafW / 2, 0.05); const leaf = doorLeaf(T, kit, kit.door('sliding'), leafW, DOOR_H); leaf.position.set(lx, 0, lz); if (s.along === 'z') leaf.rotation.y = Math.PI / 2; slider.add(leaf); }
    { const [rx, rz] = xz(mid + (t0 > mid ? leafW / 2 : -leafW / 2), 0.06); add(slide, B(s.along === 'x' ? gap + leafW : 0.06, 0.1, s.along === 'x' ? 0.06 : gap + leafW), kit.ssDark, rx, DOOR_H + 0.08, rz); }
    const shut = mid - (t0 + leafW / 2);
    // swing: one leaf, or two meeting in the middle when the opening is wide (as WIESPL fits them), standing open into the room
    const swing = new T.Group(); swing.userData.part = partOf('swing'); swing.visible = kind === 'swing'; group.add(swing);
    const pair = gap >= 1.15, lw = pair ? gap / 2 - 0.01 : Math.min(gap, 1.2), openAng = s.along === 'x' ? (s.n > 0 ? 0 : Math.PI) : (s.n > 0 ? Math.PI / 2 : -Math.PI / 2);
    const hinges = (pair ? [[g0, 1], [g1, -1]] : [[g0, 1]]).map(([t, dir]) => {
      const [hx, hz] = xz(t, 0.02), pivot = new T.Group(); pivot.position.set(hx, 0, hz); swing.add(pivot);
      const leaf = doorLeaf(T, kit, kit.door('swing'), lw, DOOR_H, true); leaf.position.set(0, 0, lw / 2); leaf.rotation.y = -Math.PI / 2; pivot.add(leaf);
      const shutAng = s.along === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI); // lying along the wall, towards the other jamb
      let turn = openAng - shutAng; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      pivot.rotation.y = openAng;
      return k => { pivot.rotation.y = shutAng + turn * k; };
    });
    info.setOpen = k => { k = Math.max(0, Math.min(1, k)); const o = shut * (1 - k); slider.position.set(s.along === 'x' ? o : 0, 0, s.along === 'x' ? 0 : o); hinges.forEach(f => f(k)); };
  }

  // ---- ceiling in 600 mm tiles; the laminar air flow plenum flush in it, LED panels round it
  const ceil = add(ceiling, new T.PlaneGeometry(w, d), kit.ceiling, RX, H, RZ); ceil.rotation.x = Math.PI / 2;
  const lafL = plen ? (long ? plen.sx : plen.sz) : Math.min(3.05, span - 1.2), lafW = plen ? (long ? plen.sz : plen.sx) : Math.min(2.44, across - 1.2);
  if (lafL > 0.8 && lafW > 0.8) {
    const [lx, lz] = at(0, 0), sx = long ? lafL : lafW, sz = long ? lafW : lafL, y = H - 0.004;
    // SS frame, LED light strips inside it, then the perforated diffuser face: all in the plane of the ceiling
    add(ceiling, B(sx + 0.16, 0.006, sz + 0.16), kit.plenumSS, lx, y, lz);
    for (const [bw, bd, ox, oz] of [[sx + 0.02, 0.05, 0, sz / 2 + 0.035], [sx + 0.02, 0.05, 0, -sz / 2 - 0.035], [0.05, sz, sx / 2 + 0.035, 0], [0.05, sz, -sx / 2 - 0.035, 0]]) add(ceiling, B(bw, 0.006, bd), kit.ledCool, lx + ox, y - 0.002, lz + oz);
    add(ceiling, B(sx, 0.006, sz), kit.perforated, lx, y - 0.003, lz);
    spots.laf = { x: lx, z: lz, sx, sz, y: H - 0.02 };
    for (const [u, v] of [[-(lafL / 2 + 0.75), 0], [lafL / 2 + 0.75, 0], [0, -(lafW / 2 + 0.6)], [0, lafW / 2 + 0.6]]) {
      if (Math.abs(u) > span / 2 - 0.4 || Math.abs(v) > across / 2 - 0.4) continue;
      const [px, pz] = at(u, v);
      add(ceiling, B(0.6, 0.008, 0.6), kit.ledPanel, px, H - 0.005, pz);
    }
  }

  // ---- equipment, all along the long axis of the room
  const kitGroup = new T.Group(); kitGroup.position.set(cx, 0, cz); kitGroup.rotation.y = rotLong; group.add(kitGroup);
  const E = (geo, mat, u, y, v, cast = true) => add(kitGroup, geo, mat, u, y, v, 0, cast);
  const shadow = (sw, sd, u, v, soft = false) => { const m = new T.Mesh(new T.PlaneGeometry(sw, sd), soft ? kit.blobSoft : kit.blob); m.rotation.x = -Math.PI / 2; m.position.set(u, 0.016, v); kitGroup.add(m); };
  // operating table: base, column, top with head, torso and leg sections, side rails
  shadow(2.5, 1.1, 0, 0);
  E(B(0.78, 0.1, 0.5), kit.ssDark, 0, 0.05, 0);
  E(B(0.3, 0.62, 0.22), kit.grey, 0, 0.41, 0);
  E(B(2.05, 0.06, 0.52), kit.ss, 0, 0.75, 0);
  for (const [len, u] of [[0.42, -0.83], [0.86, -0.15], [0.66, 0.64]]) E(B(len - 0.02, 0.08, 0.5), kit.mattress, u, 0.82, 0);
  for (const v of [-0.28, 0.28]) E(B(1.95, 0.025, 0.02), kit.ss, 0, 0.765, v);
  // OT light: ceiling canopy, central axis, two arms each ending in a dome with its ring of LEDs and a centre handle
  E(Cy(0.17, 0.17, 0.05, 32), kit.white, 0, H - 0.025, 0, false);
  E(Cy(0.04, 0.04, 0.45), kit.white, 0, H - 0.27, 0);
  const domeShape = [[0.001, 0.13], [0.12, 0.13], [0.25, 0.11], [0.32, 0.06], [0.34, 0.01], [0.33, -0.005], [0.001, -0.005]].map(([r, y]) => new T.Vector2(r, y));
  [[0.45, 0.85, 1.92], [Math.PI + 0.35, 0.72, 2.02]].forEach(([ang, len, hy], n) => {
    const arm = new T.Group(); arm.position.set(0, H - 0.5, 0); arm.rotation.y = ang; kitGroup.add(arm);
    const tube = (r, l, x, y, z, rz = 0) => { const m = new T.Mesh(Cy(r, r, l, 14), kit.white); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; arm.add(m); };
    tube(0.03, len, len / 2, 0, 0, Math.PI / 2);
    { const j = new T.Mesh(new T.SphereGeometry(0.045, 16, 12), kit.white); j.position.set(len, 0, 0); arm.add(j); }
    const drop = (H - 0.5) - (hy + 0.2); tube(0.024, drop, len, -drop / 2, 0);
    const head = new T.Group(); head.position.set(len, hy - (H - 0.5), 0); head.rotation.z = n ? -0.12 : 0.12; arm.add(head);
    { const yoke = new T.Mesh(B(0.04, 0.2, 0.04), kit.white); yoke.position.set(0, 0.2, 0); head.add(yoke); }
    const shell = new T.Mesh(new T.LatheGeometry(domeShape, 48), kit.white); shell.castShadow = true; head.add(shell);
    const face = new T.Mesh(new T.CircleGeometry(0.33, 40), kit.grey); face.rotation.x = Math.PI / 2; face.position.y = -0.004; head.add(face);
    const leds = new T.InstancedMesh(new T.CircleGeometry(0.026, 12), kit.led, 26), q = new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0)), M = new T.Matrix4();
    for (let i = 0; i < 26; i++) { const inner = i < 8, a = (inner ? i / 8 : (i - 8) / 18) * Math.PI * 2, r = inner ? 0.1 : 0.22; M.compose(new T.Vector3(Math.cos(a) * r, -0.007, Math.sin(a) * r), q, new T.Vector3(1, 1, 1)); leds.setMatrixAt(i, M); }
    head.add(leds);
    const handle = new T.Mesh(Cy(0.028, 0.028, 0.12, 14), kit.ssDark); handle.position.y = -0.07; head.add(handle);
  });
  // pendants: surgeon's on one side, anaesthesia on the other. Each hangs on a two-part arm from a ceiling mount nearer
  // the middle; its head carries gas outlets, power sockets and data ports, two shelves with rails, a drawer and a
  // monitor on its own arm (the endoscope picture for the surgeon, the patient's vitals for the anaesthetist)
  const bar = (a, b, y, r, mat = kit.white) => { const du = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(du, dv) || 0.01, g = new T.Group(); g.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); g.rotation.y = Math.atan2(-dv, du); const m = new T.Mesh(Cy(r, r, L, 18), mat); m.rotation.z = Math.PI / 2; m.castShadow = true; g.add(m); kitGroup.add(g); };
  const sideOff = Math.min(1.55, across / 2 - 0.45);
  if (sideOff > 0.9) for (const [v, kind] of [[sideOff, 'surgeon'], [-sideOff, 'anaes']]) {
    const u = kind === 'anaes' ? -0.75 : 0.35, sv = Math.sign(v), du = kind === 'anaes' ? -1 : 1;
    { const [px, pz] = at(u, v); spots.pendants.push({ x: px, z: pz, kind, u, v }); }
    shadow(0.8, 0.8, u, v, true);
    const mount = [u + du * 0.3, v * 0.3], joint = [u + du * 0.55, v * 0.68], armY = H - 0.42, faceV = v - sv * 0.151;
    E(Cy(0.17, 0.17, 0.03, 32), kit.white, mount[0], H - 0.015, mount[1], false); // ceiling mount
    E(Cy(0.09, 0.11, 0.32, 24), kit.white, mount[0], H - 0.19, mount[1]);
    bar(mount, joint, armY, 0.055); E(Cy(0.085, 0.085, 0.2, 24), kit.white, joint[0], armY - 0.05, joint[1]); // first arm and its joint
    bar(joint, [u, v], armY - 0.12, 0.05); E(Cy(0.08, 0.08, 0.2, 24), kit.white, u, armY - 0.14, v);          // second arm to the head
    E(Cy(0.04, 0.04, armY - 0.24 - 1.95), kit.white, u, (armY - 0.24 + 1.95) / 2, v);
    E(Cy(0.012, 0.012, 0.03, 10), kit.dark, joint[0], armY + 0.06, joint[1], false); // brake button
    // the head: column with aluminium corner rails
    E(B(0.36, 0.95, 0.3), kit.grey, u, 1.475, v);
    for (const [a1, b1] of [[-0.17, -0.14], [0.17, -0.14], [-0.17, 0.14], [0.17, 0.14]]) E(B(0.026, 0.95, 0.026), kit.ssDark, u + a1, 1.475, v + b1, false);
    E(B(0.37, 0.03, 0.31), kit.white, u, 1.96, v); E(B(0.37, 0.03, 0.31), kit.white, u, 0.99, v);
    // gas outlets in two rows (O2 white, N2O blue, air black, vacuum yellow, AGSS magenta, air 7 bar grey), each a coloured ring
    E(B(0.3, 0.17, 0.008), kit.socket, u, 1.8, faceV, false);
    [[0xffffff, -0.09, 1.84], [0x2f6fd0, 0, 1.84], [0x222222, 0.09, 1.84], [0xe8c22e, -0.09, 1.76], [kind === 'anaes' ? 0xb0307a : 0xe8c22e, 0, 1.76], [0x8a939e, 0.09, 1.76]].forEach(([c, du2, y]) => {
      const ring = new T.Mesh(new T.TorusGeometry(0.02, 0.007, 8, 20), kit.gas(c)); ring.position.set(u + du2, y, faceV - sv * 0.006); kitGroup.add(ring);
      E(Cy(0.009, 0.009, 0.01, 10), kit.dark, u + du2, y, faceV - sv * 0.006, false).rotation.x = Math.PI / 2;
    });
    // power sockets and data ports
    E(B(0.3, 0.1, 0.008), kit.socket, u, 1.63, faceV, false);
    for (const k of [-0.09, 0, 0.09]) { E(B(0.07, 0.07, 0.006), kit.white, u + k, 1.63, faceV - sv * 0.006, false); for (const [dx, dy] of [[-0.012, 0.01], [0.012, 0.01], [0, -0.014]]) E(B(0.007, 0.012, 0.004), kit.dark, u + k + dx, 1.63 + dy, faceV - sv * 0.01, false); }
    for (const k of [-0.06, 0, 0.06]) E(B(0.03, 0.022, 0.006), kit.gas(0x2f6fd0), u + k, 1.55, faceV - sv * 0.004, false);
    // shelves with front rails, a drawer between them, a grip on the side
    for (const y of [1.1, 1.42]) { E(B(0.54, 0.022, 0.44), kit.ss, u, y, v); bar([u - 0.27, v - sv * 0.22], [u + 0.27, v - sv * 0.22], y + 0.03, 0.008, kit.ss); }
    E(B(0.4, 0.11, 0.3), kit.white, u, 1.33, v); E(B(0.14, 0.015, 0.012), kit.ssDark, u, 1.33, v - sv * 0.156, false);
    E(Cy(0.013, 0.013, 0.32, 10), kit.ssDark, u + du * 0.22, 1.5, v, false);
    // what stands on the shelves
    if (kind === 'surgeon') { E(B(0.36, 0.12, 0.3), kit.white, u, 1.17, v); E(B(0.12, 0.05, 0.006), kit.dark, u - 0.08, 1.17, v - sv * 0.153, false); E(B(0.34, 0.09, 0.3), kit.dark, u, 1.48, v); E(B(0.2, 0.008, 0.004), kit.ledCool, u, 1.47, v - sv * 0.152, false); }
    else { for (const k of [-0.13, 0.13]) { E(B(0.2, 0.1, 0.22), kit.white, u + k, 1.16, v); E(B(0.1, 0.03, 0.004), kit.screen, u + k, 1.17, v - sv * 0.112, false); }
      E(Cy(0.008, 0.008, 0.62, 8), kit.ss, u - du * 0.15, 2.27, v, false); for (const a2 of [0, 1.57, 3.14, 4.71]) E(B(0.1, 0.008, 0.008), kit.ss, u - du * 0.15 + Math.cos(a2) * 0.05, 2.57, v + Math.sin(a2) * 0.05, false); } // IV pole
    // the monitor on its arm, turned to the table
    bar([u, v], [u, v - sv * 0.4], 2.03, 0.02, kit.ssDark);
    E(B(0.6, 0.38, 0.035), kit.dark, u, 2.12, v - sv * 0.42);
    { const m = new T.Mesh(new T.PlaneGeometry(0.56, 0.34), kind === 'surgeon' ? kit.scope : kit.vitals); m.position.set(u, 2.12, v - sv * 0.44); m.rotation.y = sv > 0 ? Math.PI : 0; kitGroup.add(m); }
  }
  // anaesthesia machine at the head end, an instrument trolley at the foot
  if (span > 4) {
    spots.kit = [at(-1.35, -0.75), at(1.45, 0.8)]; // the tour keeps them out of its views
    const mu = -1.35, mv = -0.75;
    shadow(1.0, 0.9, mu, mv);
    E(B(0.62, 0.1, 0.52), kit.rubber, mu, 0.08, mv);
    E(B(0.58, 0.8, 0.5), kit.white, mu, 0.55, mv);
    E(B(0.66, 0.03, 0.56), kit.ss, mu, 0.965, mv);
    E(B(0.5, 0.48, 0.34), kit.grey, mu - 0.05, 1.22, mv);
    E(B(0.08, 0.16, 0.1), kit.gas(0x7b4fa3), mu + 0.18, 1.06, mv - 0.15); E(B(0.08, 0.16, 0.1), kit.gas(0xe0b030), mu + 0.18, 1.06, mv + 0.15);
    E(B(0.04, 0.32, 0.44), kit.dark, mu + 0.05, 1.68, mv); { const m = new T.Mesh(new T.PlaneGeometry(0.39, 0.27), kit.vitals); m.position.set(mu + 0.073, 1.68, mv); m.rotation.y = Math.PI / 2; kitGroup.add(m); }
    shadow(1.2, 0.8, 1.45, 0.8);
    E(B(0.9, 0.03, 0.5), kit.ss, 1.45, 0.86, 0.8); E(B(0.9, 0.03, 0.5), kit.ss, 1.45, 0.3, 0.8);
    for (const [a, b] of [[-0.42, -0.22], [0.42, -0.22], [-0.42, 0.22], [0.42, 0.22]]) { E(Cy(0.012, 0.012, 0.86, 8), kit.ss, 1.45 + a, 0.43, 0.8 + b); E(new T.SphereGeometry(0.03, 10, 8), kit.rubber, 1.45 + a, 0.03, 0.8 + b, false); }
  }

  // ---- the longest stretch of each wall run with no sliding leaf parked in front of it
  const freeSpan = run => {
    let spans = [[run.from, run.to]];
    for (const p of parked) if (p.s === run.s) spans = spans.flatMap(([a1, b1]) => (p.b <= a1 || p.a >= b1 ? [[a1, b1]] : [[a1, p.a], [p.b, b1]].filter(([x, y]) => y - x > 0.05)));
    return spans.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] || [run.from, run.from];
  };
  for (const r of allRuns) { r.free = freeSpan(r); r.freeLen = r.free[1] - r.free[0]; }
  if (allRuns.length) longest = allRuns.reduce((p, q) => (q.freeLen > p.freeLen ? q : p));
  const used = new Set(), inOf = s => [s.along === 'x' ? 0 : s.n, s.along === 'x' ? s.n : 0];
  const bestRun = side => allRuns.filter(r => r.s === side && !used.has(r)).sort((p, q) => q.freeLen - p.freeLen)[0] || null;

  // things flush on a wall run: at(t, off) = scene x, z at t along the wall, off in front of its panels
  // the longest part of a run's free span with no riser in it
  const clearOf = run => {
    let spans = [[run.free[0], run.free[1]]];
    for (const q of spots.riserSpans || []) if (q.s === run.s) spans = spans.flatMap(([a1, b1]) => (q.b + 0.15 <= a1 || q.a - 0.15 >= b1 ? [[a1, b1]] : [[a1, q.a - 0.15], [q.b + 0.15, b1]].filter(([x, y]) => y - x > 0.05)));
    return spans.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] || run.free;
  };
  const onRun = run => { const { s: sd, plane } = run, [inX, inZ] = inOf(sd), base = plane + sd.n * (T_PANEL / 2);
    const xz = (t, off = 0) => (sd.along === 'x' ? [t, base + sd.n * off] : [base + sd.n * off, t]);
    const box = (len, h, dep, mat, t, y, off) => { const [x, z] = xz(t, off); return add(group, sd.along === 'x' ? B(len, h, dep) : B(dep, h, len), mat, x, y, z); };
    const plane2 = (len, h, mat, t, y, off) => { const [x, z] = xz(t, off); return add(group, new T.PlaneGeometry(len, h), mat, x, y, z, Math.atan2(inX, inZ)); };
    const [f0, f1] = clearOf(run); return { s: sd, inX, inZ, xz, box, plane2, from: f0, to: f1, len: f1 - f0, mid: (f0 + f1) / 2 }; };
  // the surgeon's control panel and the X-ray viewer (and, on the surgeon's wall, a writing board)
  const surgeonWall = (run, board) => {
    const W2 = onRun(run), c = W2.mid, order = board ? [['board', c - 1.2], ['panel', c + 0.15], ['xray', c + 1.3]] : [['panel', c - 0.5], ['xray', c + 0.65]];
    for (const [what, t] of order) {
      if (what === 'panel') { W2.box(1.15, 0.78, 0.02, kit.dark, t, 1.45, 0.01); W2.plane2(1.02, 0.62, kit.panelUi, t, 1.45, 0.022); const [x, z] = W2.xz(t, 0.01); spots.panel = { x, z, y: 1.45, inX: W2.inX, inZ: W2.inZ }; }
      if (what === 'xray') { W2.box(0.86, 0.6, 0.02, kit.ssDark, t, 1.5, 0.01); W2.plane2(0.8, 0.55, kit.xray, t, 1.5, 0.022); }
      if (what === 'board') boardAt(W2, t);
    }
  };
  // a writing board (white, with a marker tray)
  const boardAt = (W2, t) => { W2.box(1.24, 0.94, 0.02, kit.ssDark, t, 1.45, 0.01); W2.box(1.2, 0.9, 0.01, kit.board, t, 1.45, 0.021); W2.box(1.0, 0.025, 0.05, kit.ssDark, t, 0.99, 0.035); const [x, z] = W2.xz(t, 0.01); spots.board = { x, z, inX: W2.inX, inZ: W2.inZ }; };
  // a printed picture on glass; tall: from the coving to the ceiling
  const pictureOn = (run, tall) => {
    const W2 = onRun(run), pw = Math.min(tall ? 2.4 : 3.6, run.freeLen - (tall ? 1.0 : 0.8)), ph = tall ? H - 0.14 : Math.min(1.6, H - 1.25), y = tall ? 0.1 + ph / 2 : 0.85 + ph / 2;
    if (pw < 0.8) return;
    W2.box(pw + 0.04, ph + 0.04, 0.01, tall ? kit.frontGlass : kit.ssDark, W2.mid, y, 0.003);
    W2.plane2(pw, ph, tall ? kit.pictureTall(finish.picture || 'lake') : kit.picture(finish.picture), W2.mid, y, 0.01).userData.part = tall ? 'pictureTall' : 'picture';
    const [x, z] = W2.xz(W2.mid, 0.01); spots.picture = { x, z, y, w: pw, inX: W2.inX, inZ: W2.inZ };
  };
  // built-in storage cabinets: n of them side by side, two doors each: the upper 60 % of each door is glass, with the
  // shelves and supplies seen through it, the lower 40 % a solid panel
  const cabinetsOn = (run, most = 4) => {
    const W2 = onRun(run), dw = 0.73, doors = Math.max(2, Math.min(most, Math.floor((W2.len - 0.2) / dw))), cw = doors * dw, ch = 1.9, y0 = 0.2, top = y0 + ch, glassFrom = y0 + ch * 0.4;
    if (W2.len < 1.5) return;
    const tc = W2.mid, tA = tc - cw / 2;
    W2.box(cw + 0.1, 0.05, 0.05, kit.cabinet, tc, top + 0.025, 0.025); W2.box(cw + 0.1, 0.05, 0.05, kit.cabinet, tc, y0 - 0.025, 0.025); // the surround
    for (const k of [-1, 1]) W2.box(0.05, ch + 0.1, 0.05, kit.cabinet, tc + k * (cw / 2 + 0.025), y0 + ch / 2, 0.025);
    W2.plane2(cw, ch, kit.cabInside, tc, y0 + ch / 2, 0.004); // the inside of the recess
    for (const [i, yy] of [glassFrom + 0.05, glassFrom + 0.42, glassFrom + 0.8].entries()) { // shelves with what is kept on them
      W2.box(cw - 0.02, 0.016, 0.04, kit.cabinet, tc, yy, 0.02); W2.box(cw - 0.02, 0.03, 0.004, kit.cabShadow, tc, yy - 0.023, 0.006);
      let x = tA + 0.06;
      for (let j = 0; x < tA + cw - 0.12; j++) { const bw = 0.09 + ((i * 7 + j * 3) % 5) * 0.025, bh = 0.12 + ((i + j * 2) % 4) * 0.045; W2.box(bw, bh, 0.03, kit.supply[(i + j) % 3], x + bw / 2, yy + 0.008 + bh / 2, 0.018); x += bw + 0.025; }
    }
    for (let k = 0; k < doors; k++) { // each door: 60 % glass above a solid panel
      const td = tA + dw * (k + 0.5), w0 = dw - 0.012;
      W2.box(w0, glassFrom - y0, 0.022, kit.cabinet, td, (y0 + glassFrom) / 2, 0.05);
      W2.box(w0, 0.05, 0.022, kit.cabinet, td, top - 0.025, 0.05);
      for (const e of [-1, 1]) W2.box(0.045, top - glassFrom, 0.022, kit.cabinet, td + e * (w0 / 2 - 0.0225), (glassFrom + top) / 2, 0.05);
      W2.box(w0 - 0.09, top - glassFrom - 0.05, 0.006, kit.cabGlass, td, (glassFrom + top - 0.05) / 2, 0.05);
      W2.box(0.018, 0.32, 0.03, kit.ssDark, td + (k % 2 ? -1 : 1) * (w0 / 2 - 0.06), glassFrom, 0.075); // handle
    }
    const [x, z] = W2.xz(tc, 0.05); spots.cabinet = { x, z, y: y0 + ch / 2, w: cw, inX: W2.inX, inZ: W2.inZ };
  };
  // a return-air riser with its grille low down, at t along a wall run's side
  const riserAt = (sd, t, wide = 0.36) => {
    if (sd.plane == null) return;
    const [inX, inZ] = inOf(sd), base = planeAt(sd, t) + sd.n * (T_PANEL / 2), [rx, rz] = sd.along === 'x' ? [t, base] : [base, t], deep = 0.22;
    spots.riserSpans ||= []; spots.riserSpans.push({ s: sd, a: t - wide / 2, b: t + wide / 2 });
    add(group, sd.along === 'x' ? B(wide, H, deep) : B(deep, H, wide), kit.ss, rx + inX * (deep / 2 - 0.02), H / 2, rz + inZ * (deep / 2 - 0.02));
    add(group, sd.along === 'x' ? B(wide - 0.06, 0.42, 0.01) : B(0.01, 0.42, wide - 0.06), kit.grille, rx + inX * (deep - 0.015), 0.38, rz + inZ * (deep - 0.015));
    spots.risers.push({ x: rx + inX * deep, z: rz + inZ * deep, y: 0.38, inX, inZ });
  };
  const slantRiser = (sl, gw) => {
    let nx = -sl.uz, nz = sl.ux; if ((RX - sl.mx) * nx + (RZ - sl.mz) * nz < 0) { nx = -nx; nz = -nz; }
    const ry = -Math.atan2(sl.uz, sl.ux), at = off => [sl.mx + nx * off, sl.mz + nz * off], L = sl.L + 0.06;
    { const [x, z] = at(0.03); add(group, B(L, DADO, 0.04), P.low, x, DADO / 2, z, ry).userData.part = 'wallLow'; add(group, B(L, H - DADO, 0.04), P.high, x, (DADO + H) / 2, z, ry).userData.part = 'wallHigh'; }
    { const [x, z] = at(0.056); add(group, B(L, 0.1, 0.012), kit.floor(finish.floor_border), x, 0.05, z, ry).userData.part = 'floorBorder'; }
    const w2 = Math.max(0.3, Math.min(sl.L - 0.3, gw, 0.75));
    { const [x, z] = at(0.054); add(group, B(w2 + 0.05, 0.48, 0.006), kit.ssDark, x, 0.4, z, ry); }
    { const [x, z] = at(0.058); add(group, B(w2, 0.42, 0.008), kit.grille, x, 0.4, z, ry); }
    const [x, z] = at(0.08); spots.risers.push({ x, z, y: 0.4, inX: nx, inZ: nz, slant: true });
  };
  const flushRiser = (sd, t, wide) => {
    const [inX, inZ] = inOf(sd), base = planeAt(sd, t) + sd.n * (T_PANEL / 2), xz = off => (sd.along === 'x' ? [t, base + sd.n * off] : [base + sd.n * off, t]);
    spots.riserSpans ||= []; spots.riserSpans.push({ s: sd, a: t - wide / 2, b: t + wide / 2 });
    { const [x, z] = xz(0.004); add(group, sd.along === 'x' ? B(wide, 0.48, 0.006) : B(0.006, 0.48, wide), kit.ssDark, x, 0.4, z); }
    { const [x, z] = xz(0.009); add(group, sd.along === 'x' ? B(wide - 0.05, 0.42, 0.006) : B(0.006, 0.42, wide - 0.05), kit.grille, x, 0.4, z); }
    const [x, z] = xz(0.03); spots.risers.push({ x, z, y: 0.4, inX, inZ });
  };
  // no return-air grilles drawn: a riser across each corner of the room, as WIESPL builds them (a slanted face with its
  // grille low down), where both walls meet with no door, window or parked door leaf near the corner
  if (!grilles.length) {
    const LEG = 0.45, near = (sd, lo, hi) => openings.some(o => o.s === sd && o.g1 > lo && o.g0 < hi) || parked.some(p => p.s === sd && p.b > lo && p.a < hi);
    const walled = (sd, lo, hi) => (sd.runs || []).some(r => r.a - 0.3 <= lo && r.b + 0.3 >= hi);
    for (const A of sides.filter(q => q.along === 'x')) for (const Bs of sides.filter(q => q.along === 'z')) {
      if (A.plane == null || Bs.plane == null) continue;
      const dx = Bs.n, dz = A.n; // from the corner into the room
      const zc = planeAt(A, Bs.fixed + dx * 0.3) + dz * (T_PANEL / 2), xc = planeAt(Bs, A.fixed + dz * 0.3) + dx * (T_PANEL / 2); // the panel faces
      const xa = Math.min(xc, xc + dx * (LEG + 0.25)), xb = Math.max(xc, xc + dx * (LEG + 0.25)), za = Math.min(zc, zc + dz * (LEG + 0.25)), zb = Math.max(zc, zc + dz * (LEG + 0.25));
      if (!walled(A, xa, xb) || !walled(Bs, za, zb) || near(A, xa, xb) || near(Bs, za, zb)) continue;
      const p1 = [xc + dx * LEG, zc], p2 = [xc, zc + dz * LEG], len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      slantRiser({ mx: (p1[0] + p2[0]) / 2, mz: (p1[1] + p2[1]) / 2, L: len, ux: (p2[0] - p1[0]) / len, uz: (p2[1] - p1[1]) / len }, 0.5);
      spots.riserSpans ||= []; spots.riserSpans.push({ s: A, a: Math.min(xc, p1[0]) - 0.05, b: Math.max(xc, p1[0]) + 0.05 }, { s: Bs, a: Math.min(zc, p2[1]) - 0.05, b: Math.max(zc, p2[1]) + 0.05 });
    }
  }
  for (const [gi, gpt] of grilles.entries()) {
    const sl = slants[gi];
    if (sl) { slantRiser(sl, Math.hypot(gpt.sx, gpt.sz)); continue; }
    const near = sides.filter(sd => sd.plane != null).map(sd => ({ sd, dist: Math.abs((sd.along === 'x' ? gpt.z : gpt.x) - sd.plane) })).sort((p, q) => p.dist - q.dist)[0];
    if (near && near.dist < 1.2) { const sd = near.sd, t = Math.max(sd.a + 0.3, Math.min(sd.b - 0.3, sd.along === 'x' ? gpt.x : gpt.z)); flushRiser(sd, t, Math.max(0.3, Math.min(0.8, sd.along === 'x' ? gpt.sx : gpt.sz))); }
  }

  if (opt.layout === 'entry' && spots.doors.length) {
    // ---- laid out round the main door: glass wall facing it, storage on the right, the surgeon's wall on the left
    const entry = spots.doors.find(dd => dd.main) || spots.doors.reduce((p, q) => (q.gap > p.gap ? q : p));
    const loc = sd => (sd.along === 'z' ? [-sd.n, 0] : [0, -sd.n]), is = (sd, v) => { const l = loc(sd); return Math.abs(l[0] - v[0]) < 0.5 && Math.abs(l[1] - v[1]) < 0.5; };
    const f2 = [entry.inX, entry.inZ], right = [-f2[1], f2[0]];
    const front = sides.find(sd => is(sd, f2)), rightSide = sides.find(sd => is(sd, right)), leftSide = sides.find(sd => is(sd, [-right[0], -right[1]]));
    spots.entry = entry;
    if (front?.meshes) for (const m of front.meshes) if (m.userData.part === 'wallLow' || m.userData.part === 'wallHigh') { m.material = kit.frontGlass; m.userData.part = 'wallFront'; }
    const fr = front && bestRun(front); if (fr) { used.add(fr); pictureOn(fr, true); spots.front = { ...spots.picture }; }
    const rr = rightSide && bestRun(rightSide); if (rr && rr.freeLen >= 1.6) { used.add(rr); cabinetsOn(rr); }
    const lr = leftSide && bestRun(leftSide); if (lr && lr.freeLen >= 2.0) {
      used.add(lr); const all = clearOf(lr)[1] - clearOf(lr)[0] >= 3.6; surgeonWall(lr, all);
      const lr2 = !all && bestRun(leftSide); if (lr2) { const W3 = onRun(lr2); if (W3.len >= 1.45) { used.add(lr2); boardAt(W3, W3.mid); } } // the writing board on the next stretch of the same wall
    }
  } else {
    // ---- the standard layout: control panel on the longest wall, picture glass facing it, storage on a third
    if (longest && longest.freeLen > 2.2) {
      used.add(longest); surgeonWall(longest, false);
      if (!grilles.length && !spots.risers.length) { // no grilles drawn and no free corner: risers at both ends of this wall
        const { s: sd, plane } = longest, [from, to] = longest.free, [inX, inZ] = inOf(sd), off = sd.n * 0.03;
        const xz = t => (sd.along === 'x' ? [t, plane + off] : [plane + off, t]);
        const perp = sd.along === 'x' ? [sides[2], sides[3]] : [sides[0], sides[1]];
        const lo = Math.max(from, (perp[0].plane ?? perp[0].fixed) + 0.05), hi = Math.min(to, (perp[1].plane ?? perp[1].fixed) - 0.05);
        const ax = sd.along === 'x' ? 1 : 0, az = 1 - ax;
        const clear = t => { const [qx0, qz0] = xz(t), qx = qx0 + inX * 1.0, qz = qz0 + inZ * 1.0; return [0, 0.17, -0.17].every(k => rayDist(qx, qz, -inX + ax * k, -inZ + az * k, 1.25) >= 0.97); };
        const slideTo = (t, dir) => { for (let i = 0; i < 10 && !clear(t); i++) t += dir * 0.15; return clear(t) ? t : null; };
        if (hi - lo > 3.6) for (const t of [slideTo(lo + 0.25, 1), slideTo(hi - 0.25, -1)]) if (t != null) riserAt(sd, t);
      }
    }
    const pick = allRuns.filter(r => !used.has(r) && r.freeLen >= 2.4)
      .map(r => ({ r, score: r.freeLen + (longest && r.s.along === longest.s.along && r.s.fixed !== longest.s.fixed ? 5 : 0) })).sort((p, q) => q.score - p.score)[0]?.r;
    if (pick) { used.add(pick); pictureOn(pick, false); }
    const store = allRuns.filter(r => !used.has(r) && r.freeLen >= 1.7).sort((p, q) => q.freeLen - p.freeLen)[0];
    if (store) { used.add(store); cabinetsOn(store, 3); }
  }
  return { group, ceiling, spots };
}
