// Rooms in the CAD drawing viewer: finds the outline of an OT from the walls around its label, for tapping and
// highlighting it. Its finishes are chosen in its own 3D (openOtStudio in plan3d-extras.js).

// occ: room edges in scene coordinates (x1, z1, x2, z2 …: walls, columns, glass and doors, so a door gap closes the room);
// points: [x, z] places inside the room's label to start from; want: [a, b] size in metres from the label, or null.
// Rays go out in the four directions, several parallel rays per side. The start point whose outline fits the label's size wins.
export function findRoom(occ, points, want) {
  // a rectangle of the label's size with lines along most of its outline wins; otherwise the room as its walls enclose
  // it (labels are sometimes out of date), then the best weak fit of the label's size
  const fit = want ? fitSize(occ, points, want) : null;
  if (fit && fit.cover >= 0.8) return fit;
  for (const p of points) { const r = floodRoom(occ, p, want); if (r) return r; }
  if (fit) return fit;
  let best = null;
  for (const [cx, cz] of points) {
    const r = probe(occ, cx, cz, want);
    if (!best || r.err < best.err) best = r;
    if (r.walls) break;
  }
  return best;
}

// The walls around the label, traced on a 10 cm grid: everything reachable from the label without crossing a line
// (walls, glass, doors) is the room. Its bounding box is accepted when the room is closed and about the label's size.
function floodRoom(occ, [cx, cz], want, R = 9, cell = 0.1) {
  const n = Math.ceil((R * 2) / cell), ox = cx - R, oz = cz - R, grid = new Uint8Array(n * n);
  const mark = (x, z) => { const i = Math.floor((x - ox) / cell), j = Math.floor((z - oz) / cell); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < n && b < n) grid[b * n + a] = 1; } };
  for (let k = 0; k < occ.length; k += 4) {
    const x1 = occ[k], z1 = occ[k + 1], x2 = occ[k + 2], z2 = occ[k + 3];
    if (Math.max(x1, x2) < ox || Math.min(x1, x2) > ox + R * 2 || Math.max(z1, z2) < oz || Math.min(z1, z2) > oz + R * 2) continue;
    const L = Math.hypot(x2 - x1, z2 - z1), steps = Math.max(1, Math.ceil(L / (cell * 0.5)));
    for (let t = 0; t <= steps; t++) mark(x1 + ((x2 - x1) * t) / steps, z1 + ((z2 - z1) * t) / steps);
  }
  let start = -1; // the label may sit on a line: start from the nearest free cell
  for (let r = 0; r < 6 && start < 0; r++) for (let di = -r; di <= r && start < 0; di++) for (let dj = -r; dj <= r && start < 0; dj++) { const i = Math.floor((cx - ox) / cell) + di, j = Math.floor((cz - oz) / cell) + dj; if (i > 0 && j > 0 && i < n - 1 && j < n - 1 && !grid[j * n + i]) start = j * n + i; }
  if (start < 0) return null;
  const seen = new Uint8Array(n * n), queue = [start]; seen[start] = 1;
  let i0 = n, i1 = 0, j0 = n, j1 = 0, count = 0;
  while (queue.length) {
    const c = queue.pop(), i = c % n, j = (c / n) | 0; count++;
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) return null; // leaked out: not a closed room
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    for (const d of [1, -1, n, -n]) { const q = c + d; if (!seen[q] && !grid[q]) { seen[q] = 1; queue.push(q); } }
  }
  // the marks are three cells wide: the room's faces are one cell further out than the cells reached
  const x0 = ox + (i0 - 1) * cell, x1 = ox + (i1 + 2) * cell, z0 = oz + (j0 - 1) * cell, z1 = oz + (j1 + 2) * cell, w = x1 - x0, h = z1 - z0;
  if (w < 2 || h < 2 || count * cell * cell < 0.6 * w * h) return null;
  if (want) { const area = want[0] * want[1]; if (w * h < area * 0.6 || w * h > area * 1.7) return null; }
  return { x0, x1, z0, z1, walls: true, err: 0, traced: true };
}

// The label gives the exact size: look for wall lines that far apart around the label, in both directions.
// The score is how much of the rectangle's outline really has a line along it.
function fitSize(occ, points, [a, b]) {
  const R = 14, TOL = 0.12, ON = 0.03, [px, pz] = points[0];
  const vs = [], hs = []; // [position, from, to]
  for (let i = 0; i < occ.length; i += 4) {
    const x1 = occ[i], z1 = occ[i + 1], x2 = occ[i + 2], z2 = occ[i + 3];
    if (Math.max(x1, x2) < px - R || Math.min(x1, x2) > px + R || Math.max(z1, z2) < pz - R || Math.min(z1, z2) > pz + R) continue;
    if (Math.abs(x2 - x1) < 0.02 && Math.abs(z2 - z1) > 0.3) vs.push([(x1 + x2) / 2, Math.min(z1, z2), Math.max(z1, z2)]);
    else if (Math.abs(z2 - z1) < 0.02 && Math.abs(x2 - x1) > 0.3) hs.push([(z1 + z2) / 2, Math.min(x1, x2), Math.max(x1, x2)]);
  }
  const unique = l => [...new Set(l.map(s => Math.round(s[0] * 50) / 50))].sort((p, q) => p - q);
  const xs = unique(vs), zs = unique(hs);
  const along = (lines, at, from, to) => { // length of [from, to] covered by lines at this position
    const parts = lines.filter(s => Math.abs(s[0] - at) < ON && s[2] > from && s[1] < to).map(s => [Math.max(s[1], from), Math.min(s[2], to)]).sort((p, q) => p[0] - q[0]);
    let sum = 0, end = from;
    for (const [p, q] of parts) { if (q > end) { sum += q - Math.max(p, end); end = q; } }
    return sum;
  };
  let best = null;
  for (const [A, B] of [[a, b], [b, a]]) for (const x0 of xs) for (const x1 of xs) {
    if (Math.abs(x1 - x0 - A) > TOL) continue;
    for (const z0 of zs) for (const z1 of zs) {
      if (Math.abs(z1 - z0 - B) > TOL) continue;
      if (!points.some(([x, z]) => x > x0 && x < x1 && z > z0 && z < z1)) continue; // the label must be in the room
      const cover = (along(hs, z0, x0, x1) + along(hs, z1, x0, x1) + along(vs, x0, z0, z1) + along(vs, x1, z0, z1)) / (2 * (x1 - x0 + z1 - z0));
      const score = cover - 0.03 * Math.hypot((x0 + x1) / 2 - px, (z0 + z1) / 2 - pz); // a room label sits near the middle of its room
      if (!best || score > best.score) best = { x0, x1, z0, z1, cover, score, walls: true, err: 0 };
    }
  }
  return best && best.cover > 0.35 ? best : null;
}

function probe(occ, cx, cz, want) {
  const R = 16, s = [];
  for (let i = 0; i < occ.length; i += 4) {
    if (Math.max(occ[i], occ[i + 2]) < cx - R || Math.min(occ[i], occ[i + 2]) > cx + R || Math.max(occ[i + 1], occ[i + 3]) < cz - R || Math.min(occ[i + 1], occ[i + 3]) > cz + R) continue;
    s.push(occ[i], occ[i + 1], occ[i + 2], occ[i + 3]);
  }
  const cast = (ox, oz, dx, dz) => {
    let best = R;
    for (let i = 0; i < s.length; i += 4) {
      const ax = s[i], az = s[i + 1], ex = s[i + 2] - ax, ez = s[i + 3] - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  };
  const median = a => a.sort((p, q) => p - q)[a.length >> 1];
  const SAMPLES = [0.15, 0.3, 0.5, 0.7, 0.85];
  let l = cast(cx, cz, -1, 0), r = cast(cx, cz, 1, 0), u = cast(cx, cz, 0, -1), d = cast(cx, cz, 0, 1);
  for (let k = 0; k < 2; k++) {
    const zs = SAMPLES.map(f => cz - u + (u + d) * f), xs = SAMPLES.map(f => cx - l + (l + r) * f);
    const nl = median(zs.map(z => cast(cx, z, -1, 0))), nr = median(zs.map(z => cast(cx, z, 1, 0)));
    const nu = median(xs.map(x => cast(x, cz, 0, -1))), nd = median(xs.map(x => cast(x, cz, 0, 1)));
    l = nl; r = nr; u = nu; d = nd;
  }
  let x0 = cx - l, x1 = cx + r, z0 = cz - u, z1 = cz + d;
  const w = x1 - x0, h = z1 - z0;
  if (want) {
    const [a, b] = want, same = Math.abs(w - a) + Math.abs(h - b), turned = Math.abs(w - b) + Math.abs(h - a);
    const [A, B] = same <= turned ? [a, b] : [b, a];
    // a side that agrees with the label keeps its walls; a side that does not uses the label's size around the label
    const okW = Math.abs(w - A) < 0.5, okH = Math.abs(h - B) < 0.5;
    if (!okW) { x0 = cx - A / 2; x1 = cx + A / 2; }
    if (!okH) { z0 = cz - B / 2; z1 = cz + B / 2; }
    return { x0, x1, z0, z1, walls: okW && okH, err: Math.min(same, turned) };
  }
  if (w < 2 || h < 2 || w > 15 || h > 15) return { x0: cx - 2.5, x1: cx + 2.5, z0: cz - 2.5, z1: cz + 2.5, walls: false, err: 99 };
  return { x0, x1, z0, z1, walls: true, err: 0 };
}

// the finish a room starts with when it is first chosen
export const DEFAULT_FINISH = { wall: 'glass', wall_colour: 'Mint green', floor_type: 'conductive', floor_main: 'Sky blue', floor_border: 'Navy blue', door: 'sliding' };
// the same choices as named in the detailed requirement form
export const BRIEF_NAMES = {
  wall: { ss: 'SS 304', ppgi: 'PPGL', glass: 'Toughened glass', ssglass: 'SS 304 + glass' },
  floor_type: { conductive: 'Antistatic conductive vinyl', homogeneous: 'Homogeneous vinyl' },
  door: { sliding: 'Hermetic sliding (automatic)', swing: 'Single leaf swing', autoswing: 'Automatic swing' },
};

// the glow around the chosen room: bright rail along the wall tops and a soft floor; pulse(t) makes it breathe
export function highlightMeshes(T, room, wallH) {
  const g = new T.Group();
  const { x0, x1, z0, z1 } = room, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rail = new T.MeshBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0.95 });
  const glow = new T.MeshBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0.2, depthWrite: false });
  const y = wallH + 0.05, t = 0.09;
  for (const [bw, bd, x, z] of [[w + t, t, cx, z0], [w + t, t, cx, z1], [t, d + t, x0, cz], [t, d + t, x1, cz]]) { const m = new T.Mesh(new T.BoxGeometry(bw, t, bd), rail); m.position.set(x, y, z); g.add(m); }
  const f = new T.Mesh(new T.PlaneGeometry(w, d), glow); f.rotation.x = -Math.PI / 2; f.position.set(cx, 0.03, cz); g.add(f);
  g.userData.pulse = time => { const k = 0.5 + 0.5 * Math.sin(time / 320); glow.opacity = 0.03 + 0.09 * k; rail.opacity = 0.7 + 0.3 * k; };
  return g;
}

// every OT is marked on the drawing: tinted floor and a rail on the walls (blue; green once its finishes are chosen)
// floor = false when the OT is shown fitted out: then only the rail marks it
export function otMark(T, room, wallH, chosen, floor = true) {
  const g = new T.Group(), color = chosen ? 0x1e9e5a : 0x2563c9;
  const { x0, x1, z0, z1 } = room, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (floor) {
    const f = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
    f.rotation.x = -Math.PI / 2; f.position.set(cx, 0.02, cz); g.add(f);
  }
  const rail = new T.MeshBasicMaterial({ color }), t = 0.08, y = wallH + 0.03;
  for (const [bw, bd, x, z] of [[w + t, t, cx, z0], [w + t, t, cx, z1], [t, d + t, x0, cz], [t, d + t, x1, cz]]) { const m = new T.Mesh(new T.BoxGeometry(bw, t, bd), rail); m.position.set(x, y, z); g.add(m); }
  return g;
}

export const disposeGroup = g => g.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
