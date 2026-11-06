// 🎬 The explainer tour of a CAD drawing's 3D, made to be sent to a client: a title card with the WIESPL logo and the
// project's name, then the camera walks at eye height from the sterile corridor, through an OT's door and round the
// theatre, stopping at each thing WIESPL supplies while a voice explains it and captions run, and a closing card with
// WIESPL's address. Where the voice names the options (sky-ceiling designs, wall finishes, picture-glass scenes, floor
// colours) the 3D changes to show each one as it is named, and a row of chips marks the one on screen.
// The corridor along the way gets panelled walls with coved vinyl skirting, backlit sky-ceiling panels, ceiling
// diffusers and a vinyl floor; air is shown leaving the diffusers and falling from the laminar air flow plenum.
// It can be saved as a video (MP4 where the browser can make one, otherwise WebM) with the voice, a soft music bed and
// the captions burnt in. The route comes from the drawing: the OT chosen (or the one whose door opens onto the longest
// corridor), its door and the corridor outside it. Voice clips: public/audio/tour/<key>.mp3 (tools/tour-voice.mjs).
import { h } from '../ui.js';
import { TOUR_LINES } from './plan3d-tour-lines.js';
import { artTexture, drawCanopy, drawBlossom, drawSky, drawDiffuser, drawCeilingTile, drawVinyl, markImage } from './plan3d-art.js';
import { KLEENCLAD } from './plan3d-otfit.js';

const EYE = 1.6, TITLE = 5.5, END_CARD = 7;
const clamp01 = x => Math.max(0, Math.min(1, x));
const ease = k => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const angLerp = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
const lerpPose = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: angLerp(a.yaw, b.yaw, k), pitch: a.pitch + (b.pitch - a.pitch) * k });
// camera pose at (x, y, z) looking at (tx, ty, tz); yaw / pitch as the walk-through uses them (forward = -sin, -cos)
const look = (x, y, z, tx, ty, tz) => { const dx = tx - x, dz = tz - z; return { x, y, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(ty - y, Math.hypot(dx, dz) || 1e-6) }; };
const DOOR_NAME = { sliding: 'Hermetic sliding door', swing: 'Single leaf swing door', autoswing: 'Automatic swing door' };
const FONT = '"Segoe UI", system-ui, sans-serif';
const LOGO = new Image(); LOGO.src = '/logo.jpeg'; // the full logo with "Turnkey Solutions for Healthcare!", for the cards
const COMPANY = ['Western India Electromedical Systems Pvt. Ltd.', 'Sct. No. 4, Plot No. 14, Narsimha Colony, Tathawade, Chinchwad, Pune, Maharashtra – 411033', 'sales@wiespl.com   |   www.wiespl.com'];

// "3000MM WIDE STERILE CORRIDOR", "Passage 2.60m wide", "2.16 M. WIDE CORRIDOR" → width in metres
export function corridorWidth(text) {
  const s = String(text || ''), mm = s.match(/(\d{3,4})\s*MM\.?\s*WIDE/i), m = s.match(/(\d+(?:\.\d+)?)\s*M\.?\s*WIDE/i);
  const w = mm ? Number(mm[1]) / 1000 : m ? Number(m[1]) : null;
  return w && w >= 0.9 && w <= 6 ? w : null;
}

// a 1.2 m wall panel with a slim joint at its edge, repeated along the wall by the box's UVs
function seamTexture(T) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 8); g.fillStyle = 'rgba(40,52,68,.5)'; g.fillRect(0, 0, 3, 8);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t;
}
const scaleUv = (g, sx, sy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; };

// ctx: { T, scene, camera, renderer, stage, rayDist(ox, oz, dx, dz, max, segs), walls() (what a person cannot
// walk through), ots(), selected(), corridors() [{ name, x, z, width }], finishOf(o), finishText(f), wallH(),
// indoor(on), preview(o, finish patch | null), resize(), done(o, early), title }
export function createTour(ctx) {
  const { T, camera, renderer, stage } = ctx;
  let run = null;

  // ---------------------------------------------------------------- where to walk
  function route(hero) {
    const segs = ctx.walls(), ray = (x, z, dx, dz, max) => ctx.rayDist(x, z, dx, dz, max, segs);
    const fitted = ctx.ots().filter(o => o.fit), sel = hero || ctx.selected();
    const pool = sel?.fit ? [sel] : fitted;
    let best = null;
    for (const o of pool) for (const d of hero && o.fit.spots.doors.some(q => q.main) ? o.fit.spots.doors.filter(q => q.main) : o.fit.spots.doors) {
      const ax = d.inZ, az = -d.inX, qx = d.x - d.inX * 1.3, qz = d.z - d.inZ * 1.3;
      if (ray(d.x - d.inX * 0.3, d.z - d.inZ * 0.3, -d.inX, -d.inZ, 8) < 1.2) continue; // no room to stand outside this door
      const f1 = ray(qx, qz, ax, az, 30), f2 = ray(qx, qz, -ax, -az, 30);
      const label = ctx.corridors().filter(c => Math.hypot(c.x - qx, c.z - qz) < 14).sort((p, q) => Math.hypot(p.x - qx, p.z - qz) - Math.hypot(q.x - qx, q.z - qz))[0] || null;
      // a real corridor or passage beats a lobby, and an operation theatre beats a cath lab or procedure room
      const score = Math.min(f1, 14) + Math.min(f2, 14) + (label ? (/CORRIDOR|PASSAGE/i.test(label.name) ? 8 : 3) : 0) + (/OPERATION|THEAT|\bOT\b/i.test(o.name) ? 5 : 0);
      if (!best || score > best.score) best = { o, d, ax, az, f1, f2, label, score };
    }
    const o = best?.o || (sel?.fit ? sel : fitted[0]);
    if (!o) return null;
    if (!best) return { o, d: null };
    const { d, ax, az, f1, f2, label } = best, dir = f1 >= f2 ? 1 : -1, free = Math.max(f1, f2), other = Math.min(f1, f2);
    const ux = ax * dir, uz = az * dir; // from the door towards the start of the walk
    // the corridor's width, measured a little along from the door (the door's own gap would let the ray through)
    const s = Math.min(1.4, Math.max(0.3, free - 0.5)), px = d.x - d.inX * 1.3 + ux * s, pz = d.z - d.inZ * 1.3 + uz * s;
    const toOt = ray(px, pz, d.inX, d.inZ, 6), away = Math.min(ray(px, pz, -d.inX, -d.inZ, 6), 3.5);
    const width = Math.max(1.2, Math.min(5, toOt + away)), k = Math.max(0.9, 1.3 + width / 2 - toOt);
    const cx = d.x - d.inX * k, cz = d.z - d.inZ * k; // the corridor's middle, opposite the door
    const L = Math.max(2.2, Math.min(10, free - 1.2)), beyond = Math.max(0.4, Math.min(4, other - 0.6));
    return { o, d, ux, uz, width, cx, cz, L, beyond, other, label };
  }

  // ---------------------------------------------------------------- the corridor: walls, floor, ceiling, sky panels, diffusers
  // film: matte KLEENCLAD walls with a crash rail, a seamless ceiling, antistatic vinyl, a light behind every sky panel
  // (the film turns them on one by one) and the scrub station where the drawing has it
  function fitCorridor(r, group, emitters, film = false) {
    if (film && r.other < 4.8) r.beyond = Math.max(0.4, r.other - 0.03); // the passage ends at its drawn end wall
    const segs = ctx.walls(), H = Math.min(ctx.wallH(), 3.0), len = r.L + 0.9 + r.beyond, w = r.width - 0.08;
    const mid = (r.L + 0.9 - r.beyond) / 2, mx = r.cx + r.ux * mid, mz = r.cz + r.uz * mid, rot = Math.atan2(-r.uz, r.ux);
    const strip = new T.Group(); strip.position.set(mx, 0, mz); strip.rotation.y = rot; group.add(strip);
    const mats = [], keep = m => { mats.push(m); return m; };
    const box = (a, b, c, m, x, y, z, uv) => { const g = new T.BoxGeometry(a, b, c); if (uv) scaleUv(g, uv, 1); const o = new T.Mesh(g, m); o.position.set(x, y, z); strip.add(o); return o; };
    // seamless vinyl: blue field, warm yellow border (as on site), with a soft sheen
    const vinyl = artTexture(T, drawVinyl, 256, 256); vinyl.wrapS = vinyl.wrapT = T.RepeatWrapping; vinyl.repeat.set(len / 1.2, w / 1.2);
    const band = Math.min(film ? 0.16 : 0.3, w * 0.12), border = keep(new T.MeshStandardMaterial({ color: film ? 0x1d3f74 : 0xc9a24a, roughness: film ? 0.45 : 0.3, envMapIntensity: film ? 0.15 : 0.4, map: vinyl }));
    box(len, 0.012, w, border, 0, 0.009, 0);
    box(len - band * 2, 0.013, w - band * 2, keep(new T.MeshStandardMaterial({ color: film ? 0xc3cad2 : 0x5b93ae, roughness: film ? 0.45 : 0.28, envMapIntensity: film ? 0.15 : 0.4, map: vinyl })), 0, 0.0095, 0);
    // panelled walls along both sides, with the vinyl coved up the foot of the wall (only where the drawing has a wall)
    const seam = seamTexture(T), wallMat = keep(film ? new T.MeshStandardMaterial({ color: KLEENCLAD, roughness: 0.88, metalness: 0, envMapIntensity: 0.05 }) : new T.MeshPhysicalMaterial({ color: 0xa6d8cd, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, map: seam, envMapIntensity: 0.6 }));
    const lineBlue = keep(new T.MeshStandardMaterial({ color: 0x1f6fb5, roughness: 0.35 })), lineGreen = keep(new T.MeshStandardMaterial({ color: 0x5cb85c, roughness: 0.35 }));
    const rail = keep(new T.MeshStandardMaterial({ color: 0xe3e6e8, roughness: 0.5, envMapIntensity: 0.15 })), railIn = keep(new T.MeshStandardMaterial({ color: 0x8d98a4, roughness: 0.6 }));
    const wallRuns = { 1: [], '-1': [] };
    for (const side of [1, -1]) {
      const runs = [];
      for (let t = -len / 2 + 0.1; t < len / 2; t += 0.25) {
        const sx = mx + r.ux * t, sz = mz + r.uz * t, nx = -r.uz * side, nz = r.ux * side, dd = ctx.rayDist(sx, sz, nx, nz, w, segs);
        if (dd > w / 2 + 0.45) continue; // an opening (a door, a side passage)
        const last = runs[runs.length - 1];
        if (last && t - last.b <= 0.4) { last.b = t; last.d.push(dd); } else runs.push({ a: t, b: t, d: [dd] });
      }
      for (const run of runs) {
        if (run.b - run.a < 0.3) continue;
        const dist = run.d.sort((p, q) => p - q)[run.d.length >> 1] - 0.03, l = run.b - run.a + 0.25, c = (run.a + run.b) / 2;
        // strip-local: x along the corridor, z across (the strip's +z is side +1: it is turned by rot)
        const z = side * dist;
        box(l, H, 0.03, wallMat, c, H / 2, z, l / 1.2);
        box(l, 0.1, 0.012, border, c, 0.05, z - side * 0.021);
        if (film) { box(l, 0.17, 0.04, rail, c, 0.95, z - side * 0.035); box(l, 0.035, 0.012, railIn, c, 0.95, z - side * 0.06); } // the crash rail
        else { box(l, 0.07, 0.008, lineBlue, c, 1.2, z - side * 0.019); box(l, 0.022, 0.008, lineGreen, c, 1.27, z - side * 0.019); }
        wallRuns[side].push({ a: run.a, b: run.b, dist });
      }
    }
    const world = (x, z) => [mx + Math.cos(rot) * x + Math.sin(rot) * z, mz - Math.sin(rot) * x + Math.cos(rot) * z];
    if (film && r.other < 4.8) { const xe = -len / 2 - 0.015; box(0.03, H, w + 0.06, wallMat, xe, H / 2, 0, w / 1.2); box(0.012, 0.1, w, border, xe + 0.021, 0.05, 0); }
    // the surgical scrub station in the passage (two bays, sensor taps, foot pedals), on a wall near the OT's door
    let scrub = film ? drawnScrub() : null;
    if (!scrub) {
      const otSide = Math.sign(-r.uz * r.d.inX + r.ux * r.d.inZ) || 1, tDoor = -mid;
      for (const side of [otSide, -otSide]) for (const t of [tDoor + 2.1, tDoor + 2.9, tDoor + 3.8, tDoor - 2.1]) {
        const run = !scrub && wallRuns[side].find(q => q.a <= t - 0.85 && q.b >= t + 0.85);
        if (run) scrub = { side, t, dist: run.dist };
      }
      if (scrub) {
        const { side, t, dist } = scrub, zf = off => side * (dist - 0.015 - off), Cy = (a, b, hh) => new T.CylinderGeometry(a, b, hh, 14);
        const ss = keep(film ? new T.MeshStandardMaterial({ color: 0xf0f2f3, roughness: 0.4 }) : new T.MeshStandardMaterial({ color: 0xc9d1da, metalness: 0.7, roughness: 0.34, envMapIntensity: 0.8 })), ssDk = keep(new T.MeshStandardMaterial({ color: 0x8e99a6, metalness: 0.8, roughness: 0.35 }));
        const dark = keep(new T.MeshStandardMaterial({ color: 0x20262e, roughness: 0.5 })), white = keep(new T.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4 }));
        const cyl = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); strip.add(o); return o; };
        box(1.44, 0.08, 0.5, dark, t, 0.04, zf(0.27));                 // plinth
        box(1.5, 0.8, 0.56, ss, t, 0.48, zf(0.29));                    // cabinet
        box(1.52, 0.05, 0.6, ss, t, 0.905, zf(0.3));                   // rim of the trough
        box(1.34, 0.012, 0.4, ssDk, t, 0.932, zf(0.32));               // the trough
        box(0.03, 0.06, 0.4, ss, t, 0.95, zf(0.32));                   // between the two bays
        box(1.52, 0.62, 0.04, ss, t, 1.24, zf(0.02));                  // splash back
        for (const k of [-0.37, 0.37]) {
          cyl(Cy(0.016, 0.02, 0.26), ss, t + k, 1.07, zf(0.07));       // tap column
          box(0.03, 0.03, 0.2, ss, t + k, 1.2, zf(0.17));              // spout
          box(0.04, 0.018, 0.02, dark, t + k, 1.15, zf(0.08));         // sensor
          box(0.12, 0.03, 0.18, dark, t + k, 0.015, zf(0.68));         // foot pedal
        }
        for (const k of [-0.66, 0.66]) box(0.08, 0.15, 0.07, white, t + k, 1.32, zf(0.055)); // soap and antiseptic
        box(0.26, 0.1, 0.02, dark, t, 1.68, zf(0.01)); box(0.2, 0.05, 0.004, keep(new T.MeshBasicMaterial({ color: 0x4fe08a, toneMapped: false })), t, 1.68, zf(0.022)); // scrub timer
        const [sx2, sz2] = world(t, zf(0.3)), [cx2, cz2] = world(t + 1.4, -side * Math.min(0.7, dist - 0.5));
        scrub = { x: sx2, z: sz2, camX: cx2, camZ: cz2 };
      }
    }
    // the scrub station as the drawing places it: the furniture drawn in the passage, against the wall it stands at.
    // Built in matte solid surface (the film shows no stainless steel), sensor taps and knee / foot controls.
    function drawnScrub() {
      const F = ctx.fixtures?.().furniture; if (!F?.length) return null;
      const c = Math.cos(rot), sn = Math.sin(rot), local = (x, z) => { const dx = x - mx, dz = z - mz; return [c * dx - sn * dz, sn * dx + c * dz]; };
      const groups = [];
      for (let i = 0; i < F.length; i += 4) {
        const [a, b] = local(F[i], F[i + 1]), [p, q] = local(F[i + 2], F[i + 3]);
        if (Math.min(a, p) < -len / 2 - 0.3 || Math.max(a, p) > len / 2 + 0.3 || Math.min(Math.abs(b), Math.abs(q)) > w / 2 + 0.1 || Math.max(Math.abs(b), Math.abs(q)) > w / 2 + 0.4) continue;
        const gx = (a + p) / 2, gz = (b + q) / 2; let g = groups.find(k => gx > k.x0 - 0.5 && gx < k.x1 + 0.5 && gz > k.z0 - 0.5 && gz < k.z1 + 0.5);
        if (!g) groups.push(g = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, n: 0 });
        g.x0 = Math.min(g.x0, a, p); g.x1 = Math.max(g.x1, a, p); g.z0 = Math.min(g.z0, b, q); g.z1 = Math.max(g.z1, b, q); g.n++;
      }
      const g = groups.filter(k => k.n >= 4 && Math.max(k.x1 - k.x0, k.z1 - k.z0) >= 1.0 && Math.min(k.x1 - k.x0, k.z1 - k.z0) <= 1.1)
        .sort((p, q) => Math.abs((p.x0 + p.x1) / 2 + mid) - Math.abs((q.x0 + q.x1) / 2 + mid))[0]; // the one nearest the OT's door
      if (!g) return null;
      const across = g.z1 - g.z0 > g.x1 - g.x0, unit = new T.Group(); strip.add(unit);
      let L, at;
      if (across) { // against an end wall: the unit runs across the passage, facing along it
        const end = (g.x0 + g.x1) / 2 < 0 ? -1 : 1, xw = end < 0 ? Math.min(g.x0, -len / 2) : Math.max(g.x1, len / 2);
        L = Math.min(g.z1 - g.z0, w - 0.1, 2.7); unit.position.set(xw, 0, (g.z0 + g.z1) / 2); unit.rotation.y = end < 0 ? Math.PI / 2 : -Math.PI / 2; at = [xw - end * 0.35, (g.z0 + g.z1) / 2, -end, 0];
      } else { // against a side wall
        const side = (g.z0 + g.z1) / 2 > 0 ? 1 : -1, zw = side > 0 ? Math.max(g.z1, w / 2 - 0.02) : Math.min(g.z0, -w / 2 + 0.02);
        L = Math.min(g.x1 - g.x0, 2.7); unit.position.set((g.x0 + g.x1) / 2, 0, zw); unit.rotation.y = side > 0 ? Math.PI : 0; at = [(g.x0 + g.x1) / 2, zw - side * 0.35, 0, -side];
      }
      const solid = keep(new T.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.35, envMapIntensity: 0.25 })), basin = keep(new T.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.25, envMapIntensity: 0.35 }));
      const dark = keep(new T.MeshStandardMaterial({ color: 0x2a313a, roughness: 0.5 })), tap = keep(new T.MeshStandardMaterial({ color: 0xd5d9dd, roughness: 0.3, metalness: 0.2 })), white = keep(new T.MeshStandardMaterial({ color: 0xf7f8f9, roughness: 0.4 }));
      const ub = (a1, b1, c1, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(a1, b1, c1), m); o.position.set(x, y, z); unit.add(o); return o; };
      const bays = Math.max(1, Math.min(3, Math.round(L / 0.85))), bw = L / bays; // unit-local: x along the unit, z out from the wall
      ub(L, 0.08, 0.5, dark, 0, 0.04, 0.27); ub(L, 0.8, 0.58, solid, 0, 0.48, 0.29); ub(L + 0.02, 0.06, 0.62, solid, 0, 0.91, 0.31); ub(L, 0.68, 0.04, solid, 0, 1.28, 0.02);
      for (let b = 0; b < bays; b++) {
        const x = -L / 2 + bw * (b + 0.5);
        ub(bw - 0.12, 0.012, 0.42, basin, x, 0.944, 0.33);                                            // basin
        const col = new T.Mesh(new T.CylinderGeometry(0.016, 0.02, 0.26, 14), tap); col.position.set(x, 1.07, 0.07); unit.add(col);
        ub(0.03, 0.03, 0.2, tap, x, 1.2, 0.17); ub(0.04, 0.018, 0.02, dark, x, 1.15, 0.08);             // spout, sensor
        ub(0.14, 0.03, 0.2, dark, x, 0.015, 0.7);                                                     // foot control
        ub(0.08, 0.15, 0.07, white, x + bw / 2 - 0.12, 1.33, 0.055);                                   // soap / antiseptic
      }
      ub(0.26, 0.1, 0.02, dark, 0, 1.7, 0.01); ub(0.2, 0.05, 0.004, keep(new T.MeshBasicMaterial({ color: 0x4fe08a, toneMapped: false })), 0, 1.7, 0.022); // scrub timer
      const [px, pz, nx, nz] = at, lim = v => Math.max(-w / 2 + 0.45, Math.min(w / 2 - 0.45, v)); // the camera: in front of the unit, a little to one side
      const [sx2, sz2] = world(px, pz), [cx2, cz2] = world(px + nx * 2.3 + (across ? 0 : 0.6), lim(pz + nz * 2.3 + (across ? 0.6 : 0)));
      return { x: sx2, z: sz2, camX: cx2, camZ: cz2, bays };
    }
    // the ceiling in 600 mm tiles, then sky panels and diffusers just under it
    const tile = artTexture(T, drawCeilingTile, 128, 128); tile.wrapS = tile.wrapT = T.RepeatWrapping;
    const ceil = new T.Mesh(scaleUv(new T.PlaneGeometry(len, w), len / 0.6, w / 0.6), keep(film ? new T.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.85, envMapIntensity: 0.05 }) : new T.MeshStandardMaterial({ map: tile, roughness: 0.7 }))); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; strip.add(ceil);
    const skyMats = [drawCanopy, drawBlossom, drawSky].map(p => keep(new T.MeshBasicMaterial({ map: artTexture(T, p, 1024, 640), toneMapped: false })));
    const diffMat = keep(new T.MeshStandardMaterial({ map: artTexture(T, drawDiffuser, 256, 256), roughness: 0.6 })), frameMat = keep(new T.MeshStandardMaterial({ color: 0xf7f8fa, roughness: 0.4 }));
    const pl = Math.min(2.4, Math.max(1.4, (len - 1) / 3)), pw = Math.max(0.9, Math.min(1.8, w - 0.5)), gap = pl + 1.6;
    const count = Math.max(1, Math.floor((len - 0.8) / gap)), first = -((count - 1) * gap) / 2;
    const toScene = t => [mx + Math.cos(rot) * t, mz - Math.sin(rot) * t]; // strip x → scene x, z
    const panels = [], vents = [];
    for (let i = 0; i < count; i++) {
      const t = first + i * gap;
      box(pl + 0.12, 0.04, pw + 0.12, frameMat, t, H - 0.02, 0);
      const p = new T.Mesh(new T.PlaneGeometry(pl, pw), film ? keep(skyMats[i % 2].clone()) : skyMats[i % 2]); p.rotation.x = Math.PI / 2; p.position.set(t, H - 0.042, 0); strip.add(p);
      const [px, pz] = toScene(t), P = { px, pz, mesh: p, t }; panels.push(P);
      if (film) { P.light = new T.PointLight(0xfff3e2, 0, 6, 2); P.light.position.set(px, H - 0.4, pz); group.add(P.light); }
      else if (i % Math.ceil(count / 3) === 0) { const light = new T.PointLight(0xfff3e2, 0.55, 6, 2); light.position.set(px, H - 0.4, pz); group.add(light); } // the panels light the passage
      if (i < count - 1 || count === 1) { // a diffuser after every panel (and one beside a lone panel)
        const tv = count === 1 ? t + pl / 2 + 0.7 : t + gap / 2;
        if (Math.abs(tv) < len / 2 - 0.4) { const v = new T.Mesh(new T.PlaneGeometry(0.6, 0.6), diffMat); v.rotation.x = Math.PI / 2; v.position.set(tv, H - 0.006, 0); strip.add(v); const [vx, vz] = toScene(tv); vents.push({ px: vx, pz: vz }); emitters.push({ kind: 'vent', x: vx, z: vz, y: H - 0.05 }); }
      }
    }
    group.userData.dispose = () => { for (const m of mats) { m.map?.dispose?.(); m.dispose(); } seam.dispose(); strip.traverse(o => o.geometry?.dispose?.()); };
    return { panels, vents, H, skyMats, scrub, strip, len, w, mid, wallRuns, world };
  }

  // lights of the theatre while the tour is inside: the OT light on the table and the plenum's cool light
  function lightOt(o, group) {
    const S = o.fit.spots, [cx, cz] = S.center;
    const spot = new T.SpotLight(0xfff1dc, 1.5, 5, 0.75, 0.75, 2); spot.position.set(cx, S.H - 0.15, cz); spot.target.position.set(cx, 0.6, cz);
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.02; spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 5;
    group.add(spot, spot.target);
    if (S.laf) for (const u of [-S.span * 0.25, S.span * 0.25]) { const [x, z] = S.at(u, 0), l = new T.PointLight(0xeef6ff, 0.5, 7, 2); l.position.set(x, S.H - 0.3, z); group.add(l); }
    for (const [u, v] of [[0, S.across * 0.32], [0, -S.across * 0.32]]) { const [x, z] = S.at(u, v), l = new T.PointLight(0xfff8ee, 0.3, 6, 2); l.position.set(x, S.H - 0.2, z); group.add(l); }
  }

  // ---------------------------------------------------------------- air: soft particles from the diffusers and the plenum
  function makeAir(group, emitters) {
    const per = { vent: 240, laf: 560 }, n = emitters.reduce((a, e) => a + per[e.kind], 0);
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), owner = new Uint16Array(n);
    let k = 0; emitters.forEach((e, i) => { for (let j = 0; j < per[e.kind]; j++) owner[k++] = i; });
    const reset = (i, anywhere) => {
      const e = emitters[owner[i]], p = i * 3;
      if (e.kind === 'laf') {
        pos[p] = e.x + (Math.random() - 0.5) * e.sx; pos[p + 2] = e.z + (Math.random() - 0.5) * e.sz; pos[p + 1] = anywhere ? 0.4 + Math.random() * (e.y - 0.4) : e.y;
        vel[p] = 0; vel[p + 1] = -(0.42 + Math.random() * 0.3); vel[p + 2] = 0;
      } else { // four-way diffuser: out along the ceiling, then down
        const a = Math.floor(Math.random() * 4) * (Math.PI / 2) + (Math.random() - 0.5) * 0.9, sp = 0.35 + Math.random() * 0.3;
        pos[p] = e.x + Math.cos(a) * 0.2; pos[p + 2] = e.z + Math.sin(a) * 0.2; pos[p + 1] = anywhere ? e.y - Math.random() * 1.6 : e.y;
        vel[p] = Math.cos(a) * sp; vel[p + 1] = -(0.28 + Math.random() * 0.25); vel[p + 2] = Math.sin(a) * sp;
      }
    };
    for (let i = 0; i < n; i++) reset(i, true);
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const dot = artTexture(T, (g, w, hh) => { const gr = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, hh); }, 32, 32);
    const mat = new T.PointsMaterial({ color: 0x7cc6f5, size: 0.03, map: dot, transparent: true, opacity: 0.5, depthWrite: false });
    const points = new T.Points(geo, mat); points.frustumCulled = false; group.add(points);
    return {
      step(dt) {
        for (let i = 0; i < n; i++) {
          const p = i * 3, e = emitters[owner[i]];
          pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt;
          if (e.kind === 'laf' && pos[p + 1] < 0.95) { vel[p] += (pos[p] - e.x) * 0.9 * dt; vel[p + 2] += (pos[p + 2] - e.z) * 0.9 * dt; vel[p + 1] *= 1 - 0.8 * dt; } // spreads out over the table
          if (e.kind === 'vent') { vel[p] *= 1 - 0.9 * dt; vel[p + 2] *= 1 - 0.9 * dt; }
          if (pos[p + 1] < (e.kind === 'vent' ? e.y - 1.7 : 0.15) || Math.abs(vel[p + 1]) < 0.04) reset(i, false);
        }
        geo.attributes.position.needsUpdate = true;
      },
      dispose() { geo.dispose(); mat.dispose(); dot.dispose(); },
    };
  }

  // ---------------------------------------------------------------- the steps of the tour
  function plan(r) {
    const o = r.o, S = o.fit.spots, f = ctx.finishOf(o), fin = ctx.finishText(f), H = S.H;
    const [cx, cz] = S.center, inRoom = (x, z) => [Math.max(o.x0 + 0.55, Math.min(o.x1 - 0.55, x)), Math.max(o.z0 + 0.55, Math.min(o.z1 - 0.55, z))];
    const steps = [], add = (key, pose, opt = {}) => { if (pose) steps.push({ key, pose, move: 3, delay: 0, ...opt }); };
    const things = [...S.kit, ...S.pendants.map(p => [p.x, p.z])]; // equipment that would stand in the way
    const inWay = (x, z, tx, tz) => { const dx = tx - x, dz = tz - z, L2 = dx * dx + dz * dz || 1; return things.some(([px, pz]) => { const k = ((px - x) * dx + (pz - z) * dz) / L2; if (k < 0.05 || k > 0.8) return false; return Math.hypot(x + dx * k - px, z + dz * k - pz) < 0.5; }); };
    const sees = (x, z, tx, tz) => { const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz); return L < 0.4 || (ctx.rayDist(x, z, dx / L, dz / L, L, ctx.walls()) >= L - 0.1 && !inWay(x, z, tx, tz)); };
    // the first of the places to stand that really sees (tx, ty, tz); null when none does (the step is left out)
    const view = (tx, ty, tz, places) => { for (const [x0, z0] of places) { const [x, z] = inRoom(x0, z0); if (sees(x, z, tx, tz)) return look(x, EYE, z, tx, ty, tz); } return null; };
    const size = `${(o.size?.w || o.x1 - o.x0).toFixed(1)} × ${(o.size?.d || o.z1 - o.z0).toFixed(1)} m`;
    let inside;
    if (r.d) {
      const d = r.d, sx = r.cx + r.ux * r.L, sz = r.cz + r.uz * r.L, along = t => [sx + (r.cx - sx) * t, sz + (r.cz - sz) * t];
      const ahead = (x, z, list) => list.map(p => ({ ...p, t: (p.px - x) * -r.ux + (p.pz - z) * -r.uz })).filter(p => p.t > 0.8).sort((p, q) => p.t - q.t)[0];
      const corr = run.corr = fitCorridor(r, run.group, run.emitters);
      const name = r.label ? r.label.name : 'Sterile corridor', wide = `${(r.label?.width || r.width).toFixed(1)} m wide`;
      run.pose = look(sx, EYE, sz, sx - r.ux * 6, 1.45, sz - r.uz * 6);
      { const [x, z] = along(0.22); add('corridor_intro', look(x, EYE, z, x - r.ux * 6, 1.5, z - r.uz * 6), { move: 6, sub: `${name} · ${wide}` }); }
      { const [x, z] = along(0.36), p = ahead(x, z, corr.panels);
        add('corridor_sky', p ? look(x, EYE, z, p.px, corr.H, p.pz) : look(x, EYE, z, x - r.ux, corr.H, z - r.uz), { move: 4, sub: 'Backlit sky-ceiling panels · designs to choose from',
          options: p ? [['tree canopies', { sky: 0 }, 'Tree canopy'], ['blossoms', { sky: 1 }, 'Blossom'], ['open sky', { sky: 2 }, 'Open sky']] : null, panel: p?.mesh }); }
      { const [x, z] = along(0.55), p = ahead(x, z, corr.vents); add('corridor_air', p ? look(x, EYE, z, p.px, 2.05, p.pz) : look(x, EYE, z, x - r.ux * 3, 1.9, z - r.uz * 3), { move: 4, sub: 'Supply air diffusers' }); }
      if (corr.scrub) add('corridor_scrub', look(corr.scrub.camX, EYE, corr.scrub.camZ, corr.scrub.x, 1.0, corr.scrub.z), { move: 4, sub: 'Two-bay surgical scrub station · sensor taps · foot pedals' });
      { const [x, z] = along(0.8); add('corridor_finish', look(x, EYE, z, x - r.ux * 2.2, 0.1, z - r.uz * 2.2), { move: 4, sub: 'Seamless vinyl · coved, panelled walls' }); }
      const back = Math.max(1.2, Math.min(r.width - 0.35, 2.8)), [bx, bz] = [d.x - d.inX * back, d.z - d.inZ * back];
      add('door_closed', look(bx, EYE, bz, d.x, 1.25, d.z), { move: 3.5, sub: `${o.name} · ${DOOR_NAME[f.door] || 'OT door'}`, enter: () => d.setOpen(0) });
      add('door_options', look(bx + d.inX * 0.3, EYE, bz + d.inZ * 0.3, d.x, 1.2, d.z), { move: 6, sub: `Chosen for this OT: ${DOOR_NAME[f.door] || 'OT door'}`,
        options: [['hermetic sliding', { door: 'sliding' }, 'Hermetic sliding'], ['double leaf swing', { door: 'swing' }, 'Double-leaf swing'], ['in widths', null, null]],
        during: (t, opt, from, to) => d.setOpen(opt?.patch?.door === 'swing' ? clamp01((t - from - 0.6) / 1.4) * clamp01((to - t - 0.2) / 1.2) : 0), shadows: true });
      const [ix, iz] = inRoom(d.x + d.inX * 1.3, d.z + d.inZ * 1.3);
      add(f.door === 'sliding' ? 'door_open_sliding' : 'door_open_swing', look(ix, EYE, iz, cx, 1.0, cz), { delay: 2.6, move: 4, sub: DOOR_NAME[f.door] || 'OT door', during: t => d.setOpen(clamp01((t - 0.5) / 1.8)), shadows: true });
      inside = [ix, iz];
    } else {
      inside = inRoom(o.x0 + 0.8, o.z0 + 0.8);
      run.pose = look(inside[0], EYE, inside[1], cx, 1.0, cz);
    }
    const [ix, iz] = inside;
    {
      const corners = [[o.x0, o.z0], [o.x1, o.z0], [o.x0, o.z1], [o.x1, o.z1]].sort((p, q) => Math.hypot(p[0] - ix, p[1] - iz) - Math.hypot(q[0] - ix, q[1] - iz));
      const places = [...corners.map(([kx, kz]) => [kx + Math.sign(cx - kx) * 1.0, kz + Math.sign(cz - kz) * 1.0]), [ix, iz]];
      add('ot_intro', view(cx, 1.0, cz, places) || look(ix, EYE, iz, cx, 1.0, cz), { move: 4.5, sub: `${o.name} · ${size}` });
    }
    const here = () => steps[steps.length - 1].pose, at = () => [here().x, here().z];
    add('ot_walls', S.panel ? view(S.panel.x, 1.5, S.panel.z, [[S.panel.x + S.panel.inX * 3.2, S.panel.z + S.panel.inZ * 3.2], at(), [cx, cz]]) : look(here().x, EYE, here().z, cx + (S.long ? 3 : 0), 1.5, cz + (S.long ? 0 : 3)), { move: 3.5, sub: `Chosen for this OT: ${fin[0]}`,
      options: [['stainless steel', { wall: 'ss', wall_colour: 'Natural steel' }, 'SS 304'], ['p.p.g.l.', { wall: 'ppgi', wall_colour: 'Off-white' }, 'PPGL'], ['toughened glass', { wall: 'glass', wall_colour: 'Sky blue' }, 'Toughened glass'], ['dado height', { wall: 'ssglass', wall_colour: 'Ivory white' }, 'SS 304 + glass'], ['everything on the wall', null, null]] });
    if (S.picture) { const P = S.picture; add('ot_picture', view(P.x, P.y, P.z, [[P.x + P.inX * 2.8, P.z + P.inZ * 2.8], [P.x + P.inX * 2, P.z + P.inZ * 2], [cx, cz]]), { move: 4.5, sub: 'Printed picture glass · scenes to choose from',
      options: [['blossom avenue', { picture: 'avenue' }, 'Blossom avenue'], ['mountain lake', { picture: 'lake' }, 'Mountain lake'], ['sunlit forest', { picture: 'forest' }, 'Sunlit forest'], ['giving the patient', null, null]] }); }
    { // the floor near a wall, so the border and the coving are in view
      const p = here(), edges = [[o.x0 + 1.1, p.z, Math.abs(p.x - o.x0)], [o.x1 - 1.1, p.z, Math.abs(o.x1 - p.x)], [p.x, o.z0 + 1.1, Math.abs(p.z - o.z0)], [p.x, o.z1 - 1.1, Math.abs(o.z1 - p.z)]].filter(e => e[2] > 2.0).sort((a, b) => a[2] - b[2]);
      const [tx, tz] = edges[0] || [p.x - Math.sin(p.yaw) * 2, p.z - Math.cos(p.yaw) * 2], fl = look(p.x, EYE, p.z, tx, 0.05, tz);
      add('ot_floor', fl, { move: 3, sub: fin[1] });
      add('ot_floor_colours', { ...fl, yaw: fl.yaw + 0.12 }, { move: 9, sub: `Chosen for this OT: ${f.floor_main} with ${f.floor_border} border`,
        options: [['beige', { floor_main: 'Beige', floor_border: 'Grey' }, 'Beige · Grey'], ['sky blue', { floor_main: 'Sky blue', floor_border: 'Navy blue' }, 'Sky blue · Navy'], ['aqua green', { floor_main: 'Aqua green', floor_border: 'Grey' }, 'Aqua green · Grey'], ['light grey with navy', { floor_main: 'Light grey', floor_border: 'Navy blue' }, 'Light grey · Navy']] });
    }
    if (S.laf) {
      const side = Math.min(1.9, S.across / 2 - 0.5);
      add('ot_laf', view(S.laf.x, 2.25, S.laf.z, [S.at(1.3, side), S.at(1.3, -side), S.at(-1.3, side), S.at(-1.3, -side)]), { move: 4.5, sub: `${S.laf.sx.toFixed(1)} × ${S.laf.sz.toFixed(1)} m laminar air flow plenum · H14 HEPA` });
    }
    if (S.risers.length) { const p = here(), R = S.risers.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)), tries = R.flatMap(q => [[q, [p.x, p.z]], [q, [q.x + q.inX * 2.2, q.z + q.inZ * 2.2]], [q, [q.x + q.inX * 1.6 + q.inZ * 0.9, q.z + q.inZ * 1.6 + q.inX * 0.9]]]);
      add('ot_return', tries.map(([q, pl]) => view(q.x, 0.7, q.z, [pl])).find(Boolean), { move: 3.5, sub: 'Return air risers with grilles' }); }
    add('ot_light', view(cx, 1.95, cz, [at(), S.at(1.6, 0), S.at(-1.6, 0)]), { move: 3, sub: 'LED OT light' });
    if (S.pendants.length) { const P = S.pendants.find(q => q.kind === 'surgeon') || S.pendants[0], sv = Math.sign(P.v) || 1; add('ot_pendants', view(P.x, 1.7, P.z, [S.at(P.u + 0.9, P.v - sv * 1.9), S.at(P.u - 0.9, P.v - sv * 1.9), S.at(P.u + 1.4, P.v - sv * 1.2), at()]), { move: 3, sub: 'Surgeon’s and anaesthesia pendants' }); }
    if (S.panel) { const P = S.panel; add('ot_panel', view(P.x, 1.45, P.z, [[P.x + P.inX * 2.1, P.z + P.inZ * 2.1], [P.x + P.inX * 1.6, P.z + P.inZ * 1.6]]), { move: 4.5, sub: 'Surgeon’s control panel · X-ray viewer' }); }
    const span = Math.max(o.x1 - o.x0, o.z1 - o.z0), R = span * 0.58, hy = span * 0.52 + H + 0.8, a0 = Math.atan2(here().x - cx, here().z - cz);
    const orbit = a => look(cx + Math.sin(a) * R, hy, cz + Math.cos(a) * R, cx, 0.3, cz);
    add('ot_full', orbit(a0 + 1.5), { cut: orbit(a0), orbit: { at: orbit, a0, a1: a0 + 1.5 }, move: 12, sub: `${o.name} · ${size} · ${fin[0]}`, outside: true });
    const far = look(cx + span * 0.85, span * 1.4 + H + 6, cz + span * 1.45, cx, 0, cz);
    add('ot_outro', far, { move: 8, sub: ctx.title, enter: () => ctx.focus?.(null) });
    return steps;
  }

  // ---------------------------------------------------------------- sound: the voice and a soft music bed
  async function loadVoices(keys, ac) {
    const out = {};
    await Promise.all(keys.map(async k => {
      try { const res = await fetch(`/audio/tour/${k}.mp3`); if (!res.ok) throw new Error(); out[k] = await ac.decodeAudioData(await res.arrayBuffer()); } catch { out[k] = null; }
    }));
    return out;
  }
  function music(ac, at, end, out) {
    const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; g.gain.value = 0; lp.connect(g); out.forEach(o => g.connect(o));
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.06, at + 2); g.gain.setValueAtTime(0.06, end - 3); g.gain.linearRampToValueAtTime(0, end);
    const hz = n => 440 * 2 ** ((n - 69) / 12), CH = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]], BAR = 6.4;
    for (let b = 0; at + b * BAR < end; b++) CH[b % 4].forEach((n, i) => { for (const det of [-6, 5]) {
      const o = ac.createOscillator(), a = ac.createGain(), t = at + b * BAR; o.type = i ? 'sawtooth' : 'triangle'; o.frequency.value = hz(n); o.detune.value = det;
      a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(i ? 0.18 : 0.6, t + 1.8); a.gain.linearRampToValueAtTime(0, t + BAR + 0.9); o.connect(a).connect(lp); o.start(t); o.stop(t + BAR + 1);
    } });
    return g;
  }

  // ---------------------------------------------------------------- what is drawn over the 3D (on screen and in the video)
  const overlay = h('canvas.p3-tourov'), box = h('div.p3-tour.hidden', overlay, h('button.btn.small.p3-tourstop', { type: 'button', onclick: () => stop(true) }, '✕ Stop tour'));
  stage.append(box);
  const wrapped = new Map();
  function wrap(g, text, maxW) { const key = `${g.font}|${Math.round(maxW)}|${text}`; if (!wrapped.has(key)) wrapped.set(key, wrapRaw(g, text, maxW)); return wrapped.get(key); }
  function wrapRaw(g, text, maxW) { const words = text.split(' '), lines = []; let line = ''; for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; }
  function card(g, W, Hh, kind, a) { // the title and closing cards: white, the WIESPL logo, the project or the address
    if (a <= 0) return;
    const k = Math.min(W / 1280, Hh / 720);
    g.save(); g.globalAlpha = a;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, Hh);
    if (LOGO.complete && LOGO.naturalWidth) { const lh = Hh * (kind === 'title' ? 0.36 : 0.4), lw = lh * LOGO.naturalWidth / LOGO.naturalHeight; g.drawImage(LOGO, (W - lw) / 2, Hh * 0.08, lw, lh); }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (kind === 'title') {
      g.fillStyle = '#1f2f6e'; g.font = `700 ${40 * k}px ${FONT}`; wrap(g, ctx.title, W * 0.8).slice(0, 2).forEach((t, i) => g.fillText(t, W / 2, Hh * 0.6 + i * 48 * k));
      g.fillStyle = '#2563c9'; g.font = `600 ${24 * k}px ${FONT}`; g.fillText('Modular operation theatre · 3D walk-through', W / 2, Hh * 0.6 + 70 * k);
      g.fillStyle = '#5a6b80'; g.font = `500 ${17 * k}px ${FONT}`; g.fillText(`Designed from your drawing by WIESPL · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, W / 2, Hh * 0.6 + 106 * k);
    } else {
      g.fillStyle = '#15202f'; g.font = `700 ${26 * k}px ${FONT}`; g.fillText(COMPANY[0], W / 2, Hh * 0.62);
      g.fillStyle = '#44546a'; g.font = `500 ${17 * k}px ${FONT}`; g.fillText(COMPANY[1], W / 2, Hh * 0.62 + 36 * k);
      g.fillStyle = '#1f4e9a'; g.font = `600 ${20 * k}px ${FONT}`; g.fillText(COMPANY[2], W / 2, Hh * 0.62 + 72 * k);
    }
    g.fillStyle = '#1f4e9a'; g.fillRect(0, Hh - 10 * k, W * 0.68, 10 * k); g.fillStyle = '#5cb85c'; g.fillRect(W * 0.68, Hh - 10 * k, W * 0.32, 10 * k);
    g.restore();
  }
  function drawOverlay(g, W, Hh, st) {
    const k = Math.max(0.62, Math.min(W / 1280, Hh / 720)), pad = 44 * k;
    if (st.fadeA > 0) { g.fillStyle = `rgba(255,255,255,${st.fadeA})`; g.fillRect(0, 0, W, Hh); }
    // the WIESPL mark and name, top left; the web address, top right
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 8 * k;
    const m = markImage(); if (m) g.drawImage(m, pad - 10 * k, 14 * k, 62 * k, 62 * k);
    g.fillStyle = '#ffffff'; g.font = `italic 800 ${24 * k}px ${FONT}`; g.textBaseline = 'middle'; g.fillText('WIESPL', pad + 52 * k, 46 * k);
    g.font = `600 ${14 * k}px ${FONT}`; g.textAlign = 'right'; g.fillText('www.wiespl.com', W - pad, 46 * k);
    g.restore();
    const s = st.s;
    if (s && st.capK > 0) {
      const L = TOUR_LINES[s.key];
      g.save(); g.globalAlpha = st.capK; g.textBaseline = 'middle';
      g.font = `500 ${24 * k}px ${FONT}`; const lines = wrap(g, L.show, W - pad * 2 - 40 * k);
      const opts = s.options?.filter(o => o.label), chipH = opts?.length ? 40 * k : 0;
      const boxH = 64 * k + lines.length * 32 * k + (s.sub ? 26 * k : 0) + chipH, y0 = Hh - boxH - 24 * k;
      const gr = g.createLinearGradient(0, y0 - 40 * k, 0, Hh); gr.addColorStop(0, 'rgba(5,20,45,0)'); gr.addColorStop(0.22, 'rgba(5,20,45,.8)'); gr.addColorStop(1, 'rgba(5,20,45,.92)');
      g.fillStyle = gr; g.fillRect(0, y0 - 40 * k, W, Hh - y0 + 40 * k);
      let y = y0;
      if (opts?.length) { // the options named in this step; the one on screen is filled
        g.font = `700 ${14 * k}px ${FONT}`; let x = pad;
        g.fillStyle = 'rgba(255,255,255,.75)'; g.textAlign = 'left'; g.fillText('OPTIONS', x, y + 14 * k); x += g.measureText('OPTIONS').width + 14 * k;
        g.font = `600 ${15 * k}px ${FONT}`;
        opts.forEach(o => { const tw = g.measureText(o.label).width + 26 * k, on = o === st.opt; g.fillStyle = on ? '#3aa46a' : 'rgba(255,255,255,.12)'; g.strokeStyle = on ? '#7ee08a' : 'rgba(255,255,255,.4)'; g.lineWidth = 1.5 * k; g.beginPath(); g.roundRect(x, y, tw, 28 * k, 14 * k); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.fillText(o.label, x + 13 * k, y + 14 * k); x += tw + 8 * k; });
        y += chipH;
      }
      g.font = `800 ${18 * k}px ${FONT}`; const tw = g.measureText(L.title).width + 30 * k;
      g.fillStyle = '#1f4e9a'; g.beginPath(); g.roundRect(pad, y, tw, 32 * k, 16 * k); g.fill(); g.fillStyle = '#5cb85c'; g.fillRect(pad + tw + 10 * k, y + 14 * k, 46 * k, 4 * k);
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(L.title, pad + 15 * k, y + 17 * k);
      g.font = `500 ${24 * k}px ${FONT}`; g.fillStyle = '#f2f7ff'; lines.forEach((t, i) => g.fillText(t, pad, y + 60 * k + i * 32 * k));
      if (s.sub) { g.font = `600 ${17 * k}px ${FONT}`; g.fillStyle = '#9fd3ff'; g.fillText(st.opt?.label ? `Shown now: ${st.opt.label}` : s.sub, pad, y + 60 * k + lines.length * 32 * k + 4 * k); }
      g.restore();
    }
    if (st.progress != null) { g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, Hh - 4 * k, W, 4 * k); g.fillStyle = '#5cb85c'; g.fillRect(0, Hh - 4 * k, W * st.progress, 4 * k); }
    card(g, W, Hh, 'title', st.titleA); card(g, W, Hh, 'end', st.endA);
  }

  // ---------------------------------------------------------------- start / run / stop
  async function start({ record = false } = {}) {
    if (run) return;
    const r = route();
    if (!r) throw new Error('No fitted operation theatre in this part of the drawing to walk through.');
    const ac = new AudioContext();
    await ac.resume();
    run = { r, ac, group: new T.Group(), emitters: [], steps: null, pose: null, last: 0, idx: -1, fov: camera.fov, exposure: renderer.toneMappingExposure, pr: renderer.getPixelRatio() };
    stage.tourState = () => run && Object.assign(run, { camera }); // for checking the tour from the console
    ctx.scene.add(run.group);
    const steps = plan(r);
    run.steps = steps;
    r.d?.setOpen(0); // the door is shut while we walk up to it
    lightOt(r.o, run.group);
    if (r.o.fit.spots.laf) { const L = r.o.fit.spots.laf; run.emitters.push({ kind: 'laf', x: L.x, z: L.z, sx: L.sx * 0.9, sz: L.sz * 0.9, y: L.y }); }
    run.air = makeAir(run.group, run.emitters);
    const voices = await loadVoices([...new Set(steps.map(s => s.key))], ac);
    let t = TITLE;
    for (const s of steps) {
      const v = voices[s.key], words = TOUR_LINES[s.key].show.split(' ').length;
      s.voice = v; s.vdur = v ? v.duration : words / 2.6;
      s.start = t; s.dur = Math.max(s.vdur + 0.4 + 0.9, s.delay + s.move + 0.6) + (s.cut ? 0.6 : 0); t += s.dur;
      // each option comes on screen just before the voice names it (where its words fall in the line)
      const say = TOUR_LINES[s.key].say.toLowerCase();
      s.options = (s.options || []).map(([word, patch, label]) => { const i = say.indexOf(word); return i < 0 ? null : { at: Math.max(0.2, 0.4 + (i / say.length) * s.vdur - 0.3), patch, label }; }).filter(Boolean);
    }
    run.end = t; run.total = t + END_CARD;
    let prev = run.pose; for (const s of steps) { s.from = prev; prev = s.pose; }
    const outs = [ac.destination];
    if (record) {
      renderer.setPixelRatio(1); renderer.setSize(1280, 720, false); camera.aspect = 16 / 9; stage.classList.add('p3-recording');
      const W = 1280, Hh = 720, canvas = h('canvas', { width: W, height: Hh }), g = canvas.getContext('2d');
      const dest = ac.createMediaStreamDestination(); outs.push(dest);
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => window.MediaRecorder?.isTypeSupported?.(m));
      if (!type) throw new Error('This browser cannot save video. Use Chrome or Edge on a computer.');
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 }), chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      run.rec = { rec, chunks, type, g, W, Hh, done: new Promise(ok => { rec.onstop = ok; }) };
      rec.start(1000);
    }
    run.t0 = ac.currentTime + 0.5;
    for (const s of steps) if (s.voice) { const src = ac.createBufferSource(); src.buffer = s.voice; outs.forEach(o => src.connect(o)); src.start(run.t0 + s.start + 0.4); (run.sources ||= []).push(src); }
    run.music = music(ac, run.t0, run.t0 + run.total, outs);
    camera.fov = camera.aspect < 1.2 ? 64 : 54; camera.updateProjectionMatrix();
    renderer.toneMappingExposure = 0.92;
    // when the browser stops drawing (tab in the background, window minimised) the voice, the clock and the recording
    // all wait, so nothing runs ahead of the picture; they carry on with the next frame drawn
    run.lastFrame = performance.now();
    run.watch = setInterval(() => {
      if (!run || run.paused || performance.now() - run.lastFrame < 500) return;
      run.paused = true; run.ac.suspend().catch(() => {}); if (run.rec?.rec.state === 'recording') run.rec.rec.pause();
    }, 250);
    ctx.focus?.(r.o); ctx.indoor(true, { soft: true }); camera.rotation.order = 'YXZ'; ctx.shadows?.();
    if (!record) { renderer.setPixelRatio(Math.min(1.25, run.pr)); ctx.resize?.(); } // fewer pixels: smooth movement on any PC
    box.classList.remove('hidden'); stage.classList.add('p3-touring');
  }

  // show an option on screen: a sky-ceiling design on the panel in view, or other finishes on the OT (null: its own)
  function showOption(s, opt) {
    if (opt?.patch?.sky != null) { if (s.panel && run.corr) s.panel.material = run.corr.skyMats[opt.patch.sky]; return; }
    if (s.options.some(o => o.patch && o.patch.sky == null)) ctx.preview(run.r.o, opt?.patch || null);
  }

  // called every frame while the tour runs: places the camera, shows options; false once it is over
  function frame(now) {
    if (!run?.steps) return false;
    run.lastFrame = performance.now();
    if (run.paused) { run.paused = false; run.ac.resume().catch(() => {}); if (run.rec?.rec.state === 'paused') run.rec.rec.resume(); }
    const t = run.ac.currentTime - run.t0, dt = Math.min(0.1, (now - (run.last || now)) / 1000); run.last = now;
    run.air?.step(dt);
    let i = run.steps.findIndex(x => t < x.start + x.dur); if (i === -1) i = run.steps.length - 1;
    const s = t < TITLE ? null : run.steps[i];
    let pose = run.pose, fadeA = 0, opt = null;
    if (s) {
      if (run.idx !== i) { const was = run.steps[run.idx]; if (was?.options.length) showOption(was, null); run.idx = i; run.optIdx = -1; s.enter?.(); }
      const lt = t - s.start;
      let oi = -1;
      if (s.options.length) { // the option being named now (the last one whose time has come)
        s.options.forEach((o, n) => { if (lt >= o.at) oi = n; });
        if (oi !== run.optIdx) { run.optIdx = oi; showOption(s, oi >= 0 ? s.options[oi] : null); ctx.shadows?.(); }
        opt = oi >= 0 ? s.options[oi] : null;
      }
      s.during?.(lt, opt, opt ? opt.at : 0, s.options[oi + 1]?.at ?? s.dur);
      if (s.shadows && (run.frameNo = (run.frameNo || 0) + 1) % 3 === 0) ctx.shadows?.(); // doors moving: their shadows follow
      if (s.cut) { // fade to white, jump outside, fade back
        fadeA = lt < 0.45 ? lt / 0.45 : lt < 0.9 ? 1 - (lt - 0.45) / 0.45 : 0;
        if (lt >= 0.45 && !s.cutDone) { s.cutDone = true; ctx.indoor(false, { marks: false, sun: 0.85 }); ctx.shadows?.(); }
        const k = ease(clamp01((lt - 0.45) / s.move));
        pose = lt < 0.45 ? s.from : s.orbit ? s.orbit.at(s.orbit.a0 + (s.orbit.a1 - s.orbit.a0) * k) : lerpPose(s.cut, s.pose, k);
      } else pose = lerpPose(s.from, s.pose, ease(clamp01((lt - s.delay) / s.move)));
    }
    camera.position.set(pose.x, pose.y, pose.z); camera.rotation.set(pose.pitch, pose.yaw, 0);
    run.st = {
      s, opt, fadeA,
      capK: s && t < run.end ? clamp01((t - s.start) / 0.5) * clamp01((s.start + s.dur - t) / 0.35) : 0,
      titleA: t < TITLE - 0.9 ? 1 : clamp01((TITLE - t) / 0.9),
      endA: clamp01((t - run.end) / 0.8),
      progress: clamp01(t / run.total),
    };
    if (t > run.total) stop(false);
    return true;
  }
  // after the frame is drawn: the overlay on screen, and the frame with its overlay into the video
  function afterRender() {
    if (!run?.st) return;
    const dpr = Math.min(1.25, window.devicePixelRatio || 1), W = stage.clientWidth, Hh = stage.clientHeight;
    if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(Hh * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(Hh * dpr); }
    const g = overlay.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    if (run.rec) { // on screen the 3D is letterboxed to 16:9 while recording: the overlay follows it
      const c = renderer.domElement, sc = Math.min(W / 16, Hh / 9), w = sc * 16, hh = sc * 9;
      g.save(); g.translate((W - w) / 2, (Hh - hh) / 2); drawOverlay(g, w, hh, run.st); g.restore();
      const R = run.rec; R.g.drawImage(c, 0, 0, R.W, R.Hh); drawOverlay(R.g, R.W, R.Hh, run.st);
    } else drawOverlay(g, W, Hh, run.st);
  }

  async function stop(early) {
    if (!run) return;
    const cur = run; run = null; clearInterval(cur.watch);
    for (const src of cur.sources || []) { try { src.stop(); } catch { /* already over */ } }
    cur.r.d?.setOpen(1); ctx.preview(cur.r.o, null);
    cur.air?.dispose(); cur.group.userData.dispose?.(); ctx.scene.remove(cur.group);
    box.classList.add('hidden'); stage.classList.remove('p3-touring');
    camera.rotation.order = 'XYZ'; camera.fov = cur.fov; renderer.toneMappingExposure = cur.exposure;
    renderer.setPixelRatio(cur.pr); if (cur.rec) stage.classList.remove('p3-recording');
    ctx.resize?.();
    ctx.done(cur.r.o, early);
    if (cur.rec) {
      cur.rec.rec.stop(); await cur.rec.done;
      const ext = cur.rec.type.startsWith('video/mp4') ? 'mp4' : 'webm', blob = new Blob(cur.rec.chunks, { type: cur.rec.type.split(';')[0] });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${ctx.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - WIESPL walk-through.${ext}` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    }
    cur.ac.close().catch(() => {});
  }

  return { start, stop, frame, afterRender, get on() { return !!run; }, get recording() { return !!run?.rec; }, parts: { route, fitCorridor, lightOt, makeAir, music, loadVoices } };
}
