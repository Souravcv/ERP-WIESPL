// Finished operation theatres inside the CAD drawing's 3D: every OT found in the drawing is fitted out where it stands,
// with the finishes chosen for it (or the WIESPL standard until something is chosen): panel walls on the walls the
// drawing really has, doors in the openings, seamless vinyl floor with its border, ceiling with the laminar air flow
// and LED panels, OT light, pendants, table, anaesthesia machine and the surgeon's control panel. Kept light (shared
// materials, no shadows) so a floor with twenty OTs still turns smoothly on an office PC or a phone.
import { OT_FINISHES, FLOOR_COLOURS } from '../ot3d.js';

const floorHex = name => parseInt((FLOOR_COLOURS.find(c => c[0] === name) || FLOOR_COLOURS[0])[1].slice(1), 16);

// materials and textures shared by all the OTs of one viewer
export function makeFitKit(T) {
  const cache = new Map();
  const get = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const seam = (() => { // a 1.2 m panel with a slim dark joint at its edge (repeated along the wall by its UVs)
    const c = document.createElement('canvas'); c.width = 256; c.height = 8;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 8); g.fillStyle = 'rgba(40,52,68,.55)'; g.fillRect(0, 0, 3, 8);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t;
  })();
  // studio reflections only on metal: painted panels and vinyl keep their true colour
  const std = (color, metal = 0.1, rough = 0.5, extra = {}) => new T.MeshStandardMaterial({ color, metalness: metal, roughness: rough, envMapIntensity: metal > 0.5 ? 1 : 0.18, ...extra });
  const kit = {
    panel(f) {
      const F = OT_FINISHES.find(x => x.key === f.wall) || OT_FINISHES[0];
      const colour = (F.colours.find(c => c[0] === f.wall_colour) || F.colours[0])[1];
      const ss = OT_FINISHES[0].colours[0][1];
      return {
        low: get(`p-low-${F.key}-${colour}`, () => (F.combo ? std(ss, 0.85, 0.3, { map: seam }) : std(colour, F.metal, F.rough, { map: seam }))),
        high: get(`p-high-${F.key}-${colour}`, () => std(colour, F.metal, F.rough, { map: seam })),
        combo: !!F.combo,
      };
    },
    floor: name => get(`f-${name}`, () => std(floorHex(name), 0, 0.55)),
    inlay: get('inlay', () => std(0x2a3a52, 0, 0.6)),
    ss: get('ss', () => std(0xdfe4ea, 0.9, 0.28)),
    ssDark: get('ssDark', () => std(0x8f9aa7, 0.8, 0.35)),
    white: get('white', () => std(0xf4f6f9, 0.05, 0.45)),
    ceiling: get('ceiling', () => std(0xf3f5f8, 0.05, 0.6, { side: T.DoubleSide })),
    dark: get('dark', () => std(0x1f2833, 0.3, 0.45)),
    mattress: get('mattress', () => std(0x1c4466, 0, 0.75)),
    glass: get('glass', () => std(0xcfe7ff, 0.1, 0.05, { transparent: true, opacity: 0.35, depthWrite: false })),
    led: get('led', () => new T.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false })),
    ledCool: get('ledCool', () => new T.MeshBasicMaterial({ color: 0xe8f4ff, toneMapped: false })),
    screen: get('screen', () => new T.MeshBasicMaterial({ color: 0x2f7fd8, toneMapped: false })),
    viewer: get('viewer', () => new T.MeshBasicMaterial({ color: 0xf5f9ff, toneMapped: false })),
    door: kind => get(`door-${kind}`, () => std(kind === 'swing' ? 0xe9edf2 : 0xd6dce3, kind === 'swing' ? 0.2 : 0.8, 0.32)),
    dispose() { for (const m of cache.values()) m.dispose(); seam.dispose(); cache.clear(); },
  };
  return kit;
}

// a box whose texture repeats once every 1.2 m along its length (the panel joints)
function panelBox(T, len, h, t, along) {
  const g = new T.BoxGeometry(along === 'x' ? len : t, h, along === 'x' ? t : len);
  const uv = g.attributes.uv, n = len / 1.2;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n);
  return g;
}

// room: { x0, x1, z0, z1 } in scene metres; finish: the OT's choices; rayDist(ox, oz, dx, dz, max): distance to the
// nearest wall of the drawing. Returns { group, ceiling }: the ceiling is a separate group, shown only from inside.
export function fitOtRoom(T, kit, room, finish, wallH, rayDist) {
  const group = new T.Group(), ceiling = new T.Group();
  const { x0, x1, z0, z1 } = room, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const H = Math.min(wallH, 3.0), long = w >= d, span = long ? w : d, across = long ? d : w;
  const add = (parent, geo, mat, x, y, z, ry = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; parent.add(m); return m; };
  const B = (a, b, c) => new T.BoxGeometry(a, b, c);
  // local frame: u along the room's long side, v across; returns scene x, z
  const at = (u, v) => (long ? [cx + u, cz + v] : [cx + v, cz + u]);
  const rotLong = long ? 0 : Math.PI / 2;

  // ---- floor: border colour all round, main colour in the field, dark inlay line between them
  const band = Math.min(0.45, Math.min(w, d) * 0.08);
  add(group, B(w, 0.012, d), kit.floor(finish.floor_border), cx, 0.006, cz);
  add(group, B(w - band * 2 + 0.05, 0.013, d - band * 2 + 0.05), kit.inlay, cx, 0.0065, cz);
  add(group, B(w - band * 2, 0.014, d - band * 2), kit.floor(finish.floor_main), cx, 0.007, cz);

  // ---- walls: panels only where the drawing has a wall; the openings get doors
  const P = kit.panel(finish), DADO = 1.2, DOOR_H = 2.1, T_PANEL = 0.04;
  const sides = [
    { along: 'x', a: x0, b: x1, fixed: z0, n: 1 }, { along: 'x', a: x0, b: x1, fixed: z1, n: -1 },
    { along: 'z', a: z0, b: z1, fixed: x0, n: 1 }, { along: 'z', a: z0, b: z1, fixed: x1, n: -1 },
  ];
  let longest = null;
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
    const put = (from, to, y0, y1, mat) => {
      const len = to - from; if (len < 0.05 || y1 - y0 < 0.02) return;
      const g = panelBox(T, len, y1 - y0, T_PANEL, s.along), mid = (from + to) / 2;
      add(group, g, mat, s.along === 'x' ? mid : plane, (y0 + y1) / 2, s.along === 'x' ? plane : mid);
    };
    const wallRun = (from, to, y0 = 0) => {
      if (P.combo) { put(from, to, y0, Math.max(y0, DADO), P.low); put(from, to, Math.max(y0, DADO), H, P.high); } else put(from, to, y0, H, P.high);
    };
    runs.forEach((r, i) => {
      const from = Math.max(s.a, r.a - 0.1), to = Math.min(s.b, r.b + 0.1);
      wallRun(from, to);
      if (!longest || to - from > longest.len) longest = { s, from, to, len: to - from, plane };
      const next = runs[i + 1];
      if (next) { // the opening up to the next run: a door if it is door-sized
        const g0 = to, g1 = Math.max(s.a, next.a - 0.1), gap = g1 - g0;
        if (gap >= 0.7 && gap <= 3.2) { put(g0, g1, DOOR_H, H, P.high); door(s, g0, g1, plane); }
      }
    });
  }

  function door(s, g0, g1, plane) {
    const kind = finish.door || 'sliding', gap = g1 - g0, mat = kit.door(kind), mid = (g0 + g1) / 2;
    const xz = (t, off = 0) => (s.along === 'x' ? [t, plane + s.n * off] : [plane + s.n * off, t]);
    if (kind === 'sliding') { // parked open beside the opening, on its track
      const leafW = Math.min(gap, 1.6), t0 = g1 + 0.02 <= s.b - leafW ? g1 + 0.02 : g0 - leafW - 0.02;
      const [lx, lz] = xz(t0 + leafW / 2, 0.05);
      const leaf = add(group, panelBox(T, leafW, DOOR_H, 0.05, s.along), mat, lx, DOOR_H / 2, lz);
      leaf.userData.door = true;
      const [vx, vz] = xz(t0 + leafW / 2, 0.08); // vision panel
      add(group, B(s.along === 'x' ? 0.4 : 0.01, 0.55, s.along === 'x' ? 0.01 : 0.4), kit.glass, vx, 1.45, vz);
      const [rx, rz] = xz(mid + (t0 > mid ? leafW / 2 : -leafW / 2), 0.06);
      add(group, B(s.along === 'x' ? gap + leafW : 0.06, 0.1, s.along === 'x' ? 0.06 : gap + leafW), kit.ssDark, rx, DOOR_H + 0.08, rz);
    } else { // swing: hinged at one jamb, standing open into the room
      const leafW = Math.min(gap, 1.2), [hx, hz] = xz(g0, 0.02);
      const pivot = new T.Group(); pivot.position.set(hx, 0, hz); group.add(pivot);
      const leaf = add(pivot, B(0.05, DOOR_H, leafW), mat, 0, DOOR_H / 2, leafW / 2);
      leaf.userData.door = true;
      add(pivot, B(0.012, 0.5, 0.35), kit.glass, s.along === 'x' ? -0.03 : 0.03, 1.45, leafW / 2);
      pivot.rotation.y = s.along === 'x' ? (s.n > 0 ? 0 : Math.PI) : (s.n > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  // ---- ceiling: flat panels, the laminar air flow over the table, LED panels round it
  const ceil = add(ceiling, new T.PlaneGeometry(w, d), kit.ceiling, cx, H, cz); ceil.rotation.x = Math.PI / 2;
  const lafL = Math.min(3.05, span - 1.2), lafW = Math.min(2.44, across - 1.2);
  if (lafL > 0.8 && lafW > 0.8) {
    const [lx, lz] = at(0, 0);
    add(ceiling, B(long ? lafL + 0.12 : lafW + 0.12, 0.1, long ? lafW + 0.12 : lafL + 0.12), kit.ss, lx, H - 0.05, lz);
    add(ceiling, B(long ? lafL : lafW, 0.02, long ? lafW : lafL), kit.ledCool, lx, H - 0.105, lz);
    for (const [u, v] of [[-(lafL / 2 + 0.75), 0], [lafL / 2 + 0.75, 0], [0, -(lafW / 2 + 0.6)], [0, lafW / 2 + 0.6]]) {
      if (Math.abs(u) > span / 2 - 0.4 || Math.abs(v) > across / 2 - 0.4) continue;
      const [px, pz] = at(u, v);
      add(ceiling, B(0.6, 0.02, 0.6), kit.led, px, H - 0.012, pz);
    }
  }

  // ---- equipment, all along the long axis of the room
  const kitGroup = new T.Group(); kitGroup.position.set(cx, 0, cz); kitGroup.rotation.y = rotLong; group.add(kitGroup);
  const E = (geo, mat, u, y, v) => add(kitGroup, geo, mat, u, y, v);
  // operating table
  E(B(0.6, 0.12, 0.45), kit.ssDark, 0, 0.06, 0);
  E(B(0.32, 0.62, 0.3), kit.ss, 0, 0.43, 0);
  E(B(2.0, 0.08, 0.55), kit.ss, 0, 0.78, 0);
  E(B(1.9, 0.07, 0.5), kit.mattress, 0, 0.855, 0);
  // OT light: canopy, tube, two heads
  E(new T.CylinderGeometry(0.16, 0.16, 0.06, 20), kit.white, 0, H - 0.03, 0);
  E(new T.CylinderGeometry(0.03, 0.03, 0.75, 10), kit.ss, 0, H - 0.4, 0);
  for (const v of [-0.42, 0.42]) {
    E(B(0.05, 0.05, Math.abs(v)), kit.ss, 0, H - 0.78, v / 2);
    E(new T.CylinderGeometry(0.03, 0.03, 0.55, 8), kit.ss, 0, H - 1.05, v);
    E(new T.CylinderGeometry(0.24, 0.33, 0.12, 24), kit.white, 0, 1.92, v);
    E(new T.CylinderGeometry(0.28, 0.28, 0.01, 24), kit.led, 0, 1.855, v);
  }
  // pendants: surgeon's on one side, anaesthesia on the other, when the room is wide enough
  const sideOff = Math.min(1.55, across / 2 - 0.45);
  if (sideOff > 0.9) for (const [v, kind] of [[sideOff, 'surgeon'], [-sideOff, 'anaes']]) {
    const u = kind === 'anaes' ? -0.75 : 0.35;
    E(new T.CylinderGeometry(0.1, 0.1, 0.06, 16), kit.white, u, H - 0.03, v);
    E(B(0.08, 0.6, 0.08), kit.ss, u, H - 0.33, v);
    E(B(0.36, 1.0, 0.36), kit.white, u, 1.55, v);
    for (const y of [1.15, 1.6]) E(B(0.5, 0.03, 0.42), kit.ss, u, y, v);
    if (kind === 'anaes') E(B(0.02, 0.32, 0.45), kit.dark, u + 0.27, 1.85, v); // monitor
  }
  // anaesthesia machine at the head end, an instrument trolley at the foot
  if (span > 4) {
    E(B(0.55, 1.25, 0.5), kit.white, -1.35, 0.63, -0.75 * Math.sign(sideOff || 1));
    E(B(0.03, 0.3, 0.38), kit.screen, -1.07, 1.12, -0.75 * Math.sign(sideOff || 1));
    E(B(0.9, 0.04, 0.5), kit.ss, 1.45, 0.86, 0.8); E(B(0.9, 0.04, 0.5), kit.ss, 1.45, 0.3, 0.8);
    for (const [a, b] of [[-0.42, -0.22], [0.42, -0.22], [-0.42, 0.22], [0.42, 0.22]]) E(B(0.025, 0.86, 0.025), kit.ss, 1.45 + a, 0.43, 0.8 + b);
  }

  // ---- surgeon's control panel and X-ray viewer, flush on the longest wall
  if (longest && longest.len > 2.2) {
    const { s, from, to, plane } = longest, mid = (from + to) / 2, off = s.n * 0.03;
    const xz = t => (s.along === 'x' ? [t, plane + off] : [plane + off, t]);
    const flat = (len, h) => (s.along === 'x' ? B(len, h, 0.02) : B(0.02, h, len));
    const [px, pz] = xz(mid - 0.5);
    add(group, flat(1.15, 0.78), kit.dark, px, 1.45, pz);
    add(group, flat(1.02, 0.62), kit.screen, ...(s.along === 'x' ? [px, 1.45, pz + s.n * 0.012] : [px + s.n * 0.012, 1.45, pz]));
    const [vx, vz] = xz(mid + 0.65);
    add(group, flat(0.8, 0.55), kit.viewer, vx, 1.5, vz);
  }
  return { group, ceiling };
}
