// Finished operation theatres inside the CAD drawing's 3D: every OT found in the drawing is fitted out where it stands,
// with the finishes chosen for it (or the WIESPL standard until something is chosen): panel walls on the walls the
// drawing really has, with coved vinyl at their foot; doors in the openings (hermetic sliding and double-leaf swing are
// both built, the chosen one shows); seamless vinyl floor with its border; tiled ceiling with the laminar air flow plenum
// flush in it and LED panels round it; OT light, pendants, table, anaesthesia machine, trolley, storage cabinet,
// surgeon's control panel, X-ray viewer, return-air risers and a picture-glass panel. Kept light (shared materials and
// textures, soft painted shadows under the equipment) so a floor with twenty OTs still turns smoothly on an office PC.
import { OT_FINISHES, FLOOR_COLOURS } from '../ot3d.js';
import { artTexture, drawAvenue, drawLake, drawForest, drawVision, drawGrille, drawPanelScreen, drawXray, drawPerforated, drawCeilingTile, brushed, drawVinyl, drawBlob, drawLedPanel, drawVitals, drawScope } from './plan3d-art.js';

// the printed picture-glass scenes a client can choose from
export const PICTURES = [['avenue', 'Blossom avenue', drawAvenue], ['lake', 'Mountain lake', drawLake], ['forest', 'Sunlit forest', drawForest]];
const VIVID = { Beige: 0xd4b47c, Grey: 0x76869b, 'Sky blue': 0x2f86cf, 'Aqua green': 0x22a88e, 'Navy blue': 0x173a73, 'Light grey': 0xbfc8d3 };
// the glass wall colours, a little deeper in the 3D than their swatches so they read under bright OT light
const WALL_VIVID = { 'Ivory white': 0xe6d6ae, 'Sky blue': 0x4b94d4, 'Mint green': 0x55bb92 };
const floorHex = name => VIVID[name] ?? parseInt((FLOOR_COLOURS.find(c => c[0] === name) || FLOOR_COLOURS[0])[1].slice(1), 16);
const doorKind = f => (f.door === 'sliding' || !f.door ? 'sliding' : 'swing'); // automatic swing looks like swing

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
    ceiling: get('ceiling', () => std(0xffffff, 0.02, 0.65, { side: T.DoubleSide, map: tex('tile', drawCeilingTile, 128, 128, [1, 1]) })),
    dark: get('dark', () => std(0x1f2630, 0.3, 0.45)),
    rubber: get('rubber', () => std(0x2b2f36, 0, 0.85)),
    mattress: get('mattress', () => std(0x27384d, 0, 0.72)),
    glass: get('glass', () => std(0xd6ecff, 0.1, 0.05, { transparent: true, opacity: 0.28, depthWrite: false, envMapIntensity: 1.2 })),
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
export function fitOtRoom(T, kit, room, finish, wallH, rayDist) {
  const group = new T.Group(), ceiling = new T.Group();
  const { x0, x1, z0, z1 } = room, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const H = Math.min(wallH, 3.0), long = w >= d, span = long ? w : d, across = long ? d : w;
  const add = (parent, geo, mat, x, y, z, ry = 0, cast = false) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = cast; parent.add(m); return m; };
  const B = (a, b, c) => new T.BoxGeometry(a, b, c), Cy = (a, b, h, n = 16) => new T.CylinderGeometry(a, b, h, n);
  // local frame: u along the room's long side, v across; returns scene x, z
  const at = (u, v) => (long ? [cx + u, cz + v] : [cx + v, cz + u]);
  const rotLong = long ? 0 : Math.PI / 2;
  const spots = { H, long, span, across, center: [cx, cz], at, doors: [], pendants: [], risers: [], kit: [], picture: null, panel: null, laf: null };

  // ---- floor: border colour all round, main colour in the field, dark inlay line between them
  const band = Math.min(0.45, Math.min(w, d) * 0.08);
  add(group, B(w, 0.012, d), kit.floor(finish.floor_border), cx, 0.006, cz).userData.part = 'floorBorder';
  add(group, B(w - band * 2 + 0.05, 0.013, d - band * 2 + 0.05), kit.inlay, cx, 0.0065, cz);
  add(group, B(w - band * 2, 0.014, d - band * 2), kit.floor(finish.floor_main), cx, 0.007, cz).userData.part = 'floorMain';

  // ---- walls: panels only where the drawing has a wall; the openings get doors
  const P = kit.panel(finish), DADO = 1.2, DOOR_H = 2.1, T_PANEL = 0.04;
  const sides = [
    { along: 'x', a: x0, b: x1, fixed: z0, n: 1 }, { along: 'x', a: x0, b: x1, fixed: z1, n: -1 },
    { along: 'z', a: z0, b: z1, fixed: x0, n: 1 }, { along: 'z', a: z0, b: z1, fixed: x1, n: -1 },
  ];
  let longest = null; const allRuns = [], parked = [];
  for (const s of sides) {
    const step = 0.2, samples = [];
    for (let t = s.a + step / 2; t < s.b; t += step) {
      const px = s.along === 'x' ? t : s.fixed + s.n * 0.3, pz = s.along === 'x' ? s.fixed + s.n * 0.3 : t;
      const dist = rayDist(px, pz, s.along === 'x' ? 0 : -s.n, s.along === 'x' ? -s.n : 0, 0.9);
      samples.push({ t, wall: dist < 0.75, face: 0.3 - dist });
    }
    // runs of wall, with small breaks in the CAD lines closed up
    const runs = [];
    for (const p of samples) {
      const last = runs[runs.length - 1];
      if (p.wall) { if (last && p.t - last.b <= 0.45) { last.b = p.t; last.faces.push(p.face); } else runs.push({ a: p.t, b: p.t, faces: [p.face] }); }
    }
    if (!runs.length) continue;
    const faces = runs.flatMap(r => r.faces).sort((p, q) => p - q), face = faces[Math.floor(faces.length / 2)];
    const plane = s.fixed + s.n * (face + T_PANEL / 2 + 0.005); // just inside the wall face
    s.plane = plane;
    const put = (from, to, y0, y1, mat, part, off = 0, thick = T_PANEL) => {
      const len = to - from; if (len < 0.05 || y1 - y0 < 0.02) return;
      const g = panelBox(T, len, y1 - y0, thick, s.along), mid = (from + to) / 2, p = plane + s.n * off;
      const m = add(group, g, mat, s.along === 'x' ? mid : p, (y0 + y1) / 2, s.along === 'x' ? p : mid); if (part) m.userData.part = part;
    };
    const wallRun = (from, to) => {
      put(from, to, 0, DADO, P.low, 'wallLow'); put(from, to, DADO, H, P.high, 'wallHigh');
      put(from, to, 0, 0.1, kit.floor(finish.floor_border), 'floorBorder', T_PANEL / 2 + 0.006, 0.012); // coved vinyl skirting
    };
    runs.forEach((r, i) => {
      const from = Math.max(s.a, r.a - 0.1), to = Math.min(s.b, r.b + 0.1);
      wallRun(from, to);
      allRuns.push({ s, from, to, len: to - from, plane });
      const next = runs[i + 1];
      if (next) { // the opening up to the next run: a door if it is door-sized
        const g0 = to, g1 = Math.max(s.a, next.a - 0.1), gap = g1 - g0;
        if (gap >= 0.7 && gap <= 3.2) { put(g0, g1, DOOR_H, H, P.high, 'wallHigh'); door(s, g0, g1, plane); }
      }
    });
  }

  // both kinds of door are built in each opening; the chosen one shows (restyle switches them)
  function door(s, g0, g1, plane) {
    const gap = g1 - g0, mid = (g0 + g1) / 2, kind = doorKind(finish);
    const xz = (t, off = 0) => (s.along === 'x' ? [t, plane + s.n * off] : [plane + s.n * off, t]);
    const [dx, dz] = xz(mid), info = { x: dx, z: dz, inX: s.along === 'x' ? 0 : s.n, inZ: s.along === 'x' ? s.n : 0, gap, kind: finish.door || 'sliding' };
    spots.doors.push(info);
    // the steel frame round the opening
    // (slim, so it stays within the wall's depth and does not stand out into the corridor)
    for (const t of [g0, g1]) { const [jx, jz] = xz(t, -0.04); add(group, s.along === 'x' ? B(0.06, DOOR_H + 0.06, 0.13) : B(0.13, DOOR_H + 0.06, 0.06), kit.ss, jx, (DOOR_H + 0.06) / 2, jz); }
    { const [jx, jz] = xz(mid, -0.04); add(group, s.along === 'x' ? B(gap + 0.12, 0.06, 0.13) : B(0.13, 0.06, gap + 0.12), kit.ss, jx, DOOR_H + 0.03, jz); }
    // hermetic sliding: parked open beside the opening, on its track; setOpen(0) slides it shut
    const slide = new T.Group(); slide.userData.part = 'door:sliding'; slide.visible = kind === 'sliding'; group.add(slide);
    const leafW = Math.min(gap, 1.6), t0 = g1 + 0.02 <= s.b - leafW ? g1 + 0.02 : g0 - leafW - 0.02;
    parked.push({ s, a: t0 - 0.08, b: t0 + leafW + 0.08 });
    const slider = new T.Group(); slide.add(slider);
    { const [lx, lz] = xz(t0 + leafW / 2, 0.05); const leaf = doorLeaf(T, kit, kit.door('sliding'), leafW, DOOR_H); leaf.position.set(lx, 0, lz); if (s.along === 'z') leaf.rotation.y = Math.PI / 2; slider.add(leaf); }
    { const [rx, rz] = xz(mid + (t0 > mid ? leafW / 2 : -leafW / 2), 0.06); add(slide, B(s.along === 'x' ? gap + leafW : 0.06, 0.1, s.along === 'x' ? 0.06 : gap + leafW), kit.ssDark, rx, DOOR_H + 0.08, rz); }
    const shut = mid - (t0 + leafW / 2);
    // swing: one leaf, or two meeting in the middle when the opening is wide (as WIESPL fits them), standing open into the room
    const swing = new T.Group(); swing.userData.part = 'door:swing'; swing.visible = kind === 'swing'; group.add(swing);
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
  const ceil = add(ceiling, tiledPlane(T, w, d, 0.6), kit.ceiling, cx, H, cz); ceil.rotation.x = Math.PI / 2;
  const lafL = Math.min(3.05, span - 1.2), lafW = Math.min(2.44, across - 1.2);
  if (lafL > 0.8 && lafW > 0.8) {
    const [lx, lz] = at(0, 0), sx = long ? lafL : lafW, sz = long ? lafW : lafL, y = H - 0.004;
    // SS frame, LED light strips inside it, then the perforated diffuser face: all in the plane of the ceiling
    add(ceiling, B(sx + 0.16, 0.006, sz + 0.16), kit.ss, lx, y, lz);
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
    for (const p of parked) if (p.s === run.s) spans = spans.flatMap(([a, b]) => (p.b <= a || p.a >= b ? [[a, b]] : [[a, p.a], [p.b, b]].filter(([x, y]) => y - x > 0.05)));
    return spans.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] || [run.from, run.from];
  };
  for (const r of allRuns) { r.free = freeSpan(r); r.freeLen = r.free[1] - r.free[0]; }
  if (allRuns.length) longest = allRuns.reduce((a, b) => (b.freeLen > a.freeLen ? b : a));
  const used = new Set();

  // ---- surgeon's control panel and X-ray viewer, flush on the longest wall
  if (longest && longest.freeLen > 2.2) {
    used.add(longest);
    const { s, plane } = longest, [from, to] = longest.free, mid = (from + to) / 2, off = s.n * 0.03;
    const xz = t => (s.along === 'x' ? [t, plane + off] : [plane + off, t]);
    const flat = (len, h) => (s.along === 'x' ? B(len, h, 0.02) : B(0.02, h, len));
    const [px, pz] = xz(mid - 0.5);
    add(group, flat(1.15, 0.78), kit.dark, px, 1.45, pz);
    const inX = s.along === 'x' ? 0 : s.n, inZ = s.along === 'x' ? s.n : 0, face = Math.atan2(inX, inZ);
    add(group, new T.PlaneGeometry(1.02, 0.62), kit.panelUi, px + inX * 0.012, 1.45, pz + inZ * 0.012, face);
    const [vx, vz] = xz(mid + 0.65);
    add(group, flat(0.86, 0.6), kit.ssDark, vx, 1.5, vz);
    add(group, new T.PlaneGeometry(0.8, 0.55), kit.xray, vx + inX * 0.012, 1.5, vz + inZ * 0.012, face);
    spots.panel = { x: px, z: pz, y: 1.45, inX, inZ };
    // return-air risers at both ends of this wall: SS boxes with a grille low down
    const perp = s.along === 'x' ? [sides[2], sides[3]] : [sides[0], sides[1]]; // the walls at its two ends, where they really are
    const lo = Math.max(from, (perp[0].plane ?? perp[0].fixed) + 0.05), hi = Math.min(to, (perp[1].plane ?? perp[1].fixed) - 0.05);
    // nothing of the drawing (a column, a nib of wall) may stand in front of a riser: slide it along the wall until clear
    const ax = s.along === 'x' ? 1 : 0, az = 1 - ax;
    const clear = t => { const [fx, fz] = xz(t), qx = fx + inX * 1.0, qz = fz + inZ * 1.0; return [0, 0.17, -0.17].every(k => rayDist(qx, qz, -inX + ax * k, -inZ + az * k, 1.25) >= 0.97); };
    const slideTo = (t, dir) => { for (let i = 0; i < 10 && !clear(t); i++) t += dir * 0.15; return clear(t) ? t : null; };
    if (hi - lo > 3.6) for (const t of [slideTo(lo + 0.25, 1), slideTo(hi - 0.25, -1)]) {
      if (t == null) continue;
      const [rx, rz] = xz(t), deep = 0.22, wide = 0.36;
      add(group, s.along === 'x' ? B(wide, H, deep) : B(deep, H, wide), kit.ss, rx + inX * (deep / 2 - 0.02), H / 2, rz + inZ * (deep / 2 - 0.02));
      add(group, s.along === 'x' ? B(wide - 0.06, 0.42, 0.01) : B(0.01, 0.42, wide - 0.06), kit.grille, rx + inX * (deep - 0.015), 0.38, rz + inZ * (deep - 0.015));
      spots.risers.push({ x: rx + inX * deep, z: rz + inZ * deep, y: 0.38, inX, inZ });
    }
  }
  // ---- printed picture glass on another wall, the one facing the control panel if it is long enough
  const pick = allRuns.filter(r => !used.has(r) && r.freeLen >= 2.4)
    .map(r => ({ r, score: r.freeLen + (longest && r.s.along === longest.s.along && r.s.fixed !== longest.s.fixed ? 5 : 0) })).sort((p, q) => q.score - p.score)[0]?.r;
  if (pick) {
    used.add(pick);
    const { s, plane } = pick, [from, to] = pick.free, mid = (from + to) / 2, pw = Math.min(pick.freeLen - 0.8, 3.6), ph = Math.min(1.6, H - 1.25), y = 0.85 + ph / 2;
    const off = s.n * (T_PANEL / 2 + 0.012), [gx, gz] = s.along === 'x' ? [mid, plane + off] : [plane + off, mid];
    const inX = s.along === 'x' ? 0 : s.n, inZ = s.along === 'x' ? s.n : 0;
    add(group, s.along === 'x' ? B(pw + 0.04, ph + 0.04, 0.01) : B(0.01, ph + 0.04, pw + 0.04), kit.ssDark, gx - inX * 0.004, y, gz - inZ * 0.004); // a slim frame
    add(group, new T.PlaneGeometry(pw, ph), kit.picture(finish.picture), gx + inX * 0.002, y, gz + inZ * 0.002, Math.atan2(inX, inZ)).userData.part = 'picture';
    spots.picture = { x: gx, z: gz, y, w: pw, inX, inZ };
  }
  // ---- an SS storage cabinet flush in a third wall: two doors with glass and handles
  const store = allRuns.filter(r => !used.has(r) && r.freeLen >= 1.7).sort((p, q) => q.freeLen - p.freeLen)[0];
  if (store) {
    const { s, plane } = store, [from, to] = store.free, mid = (from + to) / 2, cw = 1.2, ch = 1.8, y = 0.3 + ch / 2;
    const inX = s.along === 'x' ? 0 : s.n, inZ = s.along === 'x' ? s.n : 0, base = plane + s.n * (T_PANEL / 2);
    const pos = (t, off) => (s.along === 'x' ? [t, base + s.n * off] : [base + s.n * off, t]);
    const box = (a, h, dep, mat, t, yy, off) => { const [x, z] = pos(t, off); return add(group, s.along === 'x' ? B(a, h, dep) : B(dep, h, a), mat, x, yy, z); };
    box(cw + 0.06, ch + 0.06, 0.02, kit.ss, mid, y, 0.01);
    for (const k of [-1, 1]) {
      const t = mid + k * (cw / 4);
      box(cw / 2 - 0.02, ch - 0.02, 0.02, kit.ss, t, y, 0.028);
      box(0.36, 0.95, 0.006, kit.glass, t, y + 0.25, 0.04);
      box(0.02, 0.2, 0.03, kit.ssDark, mid + k * 0.06, y, 0.05);
    }
    const [sx, sz] = pos(mid, 0.05); spots.cabinet = { x: sx, z: sz, y, inX, inZ };
  }
  return { group, ceiling, spots };
}
