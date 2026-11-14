// 🎞 The client film of one OT from a CAD drawing: calm, one-line labels, a female voice and a soft music bed.
// The drawing seen from above with the OT glowing → its walls rise and the seamless ceiling closes over (a
// self-standing system, no civil work) → down into the passage a room or two before the OT, where the lights come on
// one by one → the scrub station where the drawing has it → the hermetic sliding door opens and we go in → a look
// round → the glass wall facing the door with its picture, the other walls and the ceiling, the storage on the right,
// the surgeon's wall opposite it, the table under the plenum, the floor → up and out over the drawing → the end card.
// The OT is fitted round its main door in the film's finishes (plan3d-otfit.js, layout 'entry'): matte KLEENCLAD
// walls, antistatic vinyl, stainless steel only on the plenum. It plays on screen, or is made frame by frame as a
// 4K 30 fps MP4 (H.264 + AAC, WebCodecs) without needing the PC to keep up in real time.
// Voice clips: public/audio/tour/film_*.mp3 (plan3d-tour-lines.js, tools/tour-voice.mjs).
import { h } from '../ui.js';
import { TOUR_LINES } from './plan3d-tour-lines.js';
import { markImage } from './plan3d-art.js';

const EYE = 1.6, FPS = 30, END_CARD = 7, FOV = 55;
const clamp01 = x => Math.max(0, Math.min(1, x));
const ease = k => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const soft = k => k * k * (3 - 2 * k); // gentle start and stop
const seg = (k, a, b) => clamp01((k - a) / (b - a));
const angLerp = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
const lerpPose = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: angLerp(a.yaw, b.yaw, k), pitch: a.pitch + (b.pitch - a.pitch) * k });
const look = (x, y, z, tx, ty, tz) => { const dx = tx - x, dz = tz - z; return { x, y, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(ty - y, Math.hypot(dx, dz) || 1e-6) }; };
const FONT = '"Segoe UI", system-ui, sans-serif';
const LOGO = new Image(); LOGO.src = '/logo.jpeg';
const COMPANY = ['Western India Electromedical Systems Pvt. Ltd.', 'Sct. No. 4, Plot No. 14, Narsimha Colony, Tathawade, Chinchwad, Pune, Maharashtra – 411033', 'sales@wiespl.com   |   www.wiespl.com'];
const tick = () => new Promise(ok => { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0); }); // keeps going in a hidden tab
// a camera path through key poses at given times: smooth (cubic, Catmull-Rom tangents), starting and ending at rest
function posePath(keys) {
  const comps = ['x', 'y', 'z', 'yaw', 'pitch'], ts = keys.map(k => k[0]), P = keys.map(k => ({ ...k[1] }));
  for (let i = 1; i < P.length; i++) { let d = P[i].yaw - P[i - 1].yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P[i].yaw = P[i - 1].yaw + d; } // no turn the long way round
  const m = P.map((p, i) => Object.fromEntries(comps.map(c => [c, i === 0 || i === P.length - 1 ? 0 : (P[i + 1][c] - P[i - 1][c]) / (ts[i + 1] - ts[i - 1])])));
  return t => {
    if (t <= ts[0]) return { ...P[0] }; if (t >= ts[ts.length - 1]) return { ...P[P.length - 1] };
    let i = 0; while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h, h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return Object.fromEntries(comps.map(c => [c, h00 * P[i][c] + h10 * h * m[i][c] + h01 * P[i + 1][c] + h11 * h * m[i + 1][c]]));
  };
}
const otTitle = name => String(name || 'Operation theatre').replace(/OPERATION\s+THEAT(?:ER|RE)/i, 'Operation Theatre').replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase());

// soft shading where surfaces meet (the dark falls off away from the corner), so walls, floor and ceiling read apart
function shadeKit(T) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#777'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const map = new T.CanvasTexture(c), mats = new Map();
  const mat = op => { if (!mats.has(op)) mats.set(op, new T.MeshBasicMaterial({ color: 0x18222e, transparent: true, opacity: op, alphaMap: map, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); return mats.get(op); };
  // a quad from its dark edge (p0 → p1) to its light edge (q0 → q1)
  const quad = (p0, p1, q0, q1, op) => { const g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.Float32BufferAttribute([...p0, ...p1, ...q0, ...q1], 3)); g2.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2)); g2.setIndex([0, 1, 2, 2, 1, 3]); const m = new T.Mesh(g2, mat(op)); m.renderOrder = 2; return m; };
  return { quad, dispose: () => { map.dispose(); for (const m of mats.values()) m.dispose(); } };
}
// the WIESPL Digital OR entrance display, as the drawing describes it
function drawEntrance(g, W, Hh, ot) {
  const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#0d2447'); gr.addColorStop(1, '#081830'); g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#1f4e9a'; g.fillRect(0, 0, W, 96); g.fillStyle = '#5cb85c'; g.fillRect(0, 96, W, 6);
  g.fillStyle = '#fff'; g.font = '700 46px Segoe UI, sans-serif'; g.textBaseline = 'middle'; g.fillText('WIESPL Digital OR', 34, 50);
  g.textAlign = 'right'; g.font = '800 58px Segoe UI, sans-serif'; g.fillText(ot, W - 34, 50); g.textAlign = 'left';
  const row = (y, k, v) => { g.fillStyle = '#9fc0e8'; g.font = '500 30px Segoe UI, sans-serif'; g.fillText(k, 40, y); g.fillStyle = '#fff'; g.font = '600 34px Segoe UI, sans-serif'; g.fillText(v, 290, y); };
  row(150, 'Surgery', 'Scheduled · In theatre'); row(200, 'Patient', 'From hospital system'); row(250, 'Surgeon', 'From hospital system');
  const tile = (x, v, k) => { g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(x, 292, 300, 150, 16); g.fill(); g.fillStyle = '#7ee0a0'; g.font = '700 58px Segoe UI, sans-serif'; g.fillText(v, x + 24, 350); g.fillStyle = '#9fc0e8'; g.font = '500 26px Segoe UI, sans-serif'; g.fillText(k, x + 24, 410); };
  tile(40, '21.5 °C', 'Temperature'); tile(362, '52 %', 'Humidity (RH)'); tile(684, '+15 Pa', 'Air pressure');
  const chip = (x, k, on) => { g.fillStyle = on ? '#2f8f57' : 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(x, 478, 232, 64, 32); g.fill(); g.fillStyle = '#fff'; g.font = '600 26px Segoe UI, sans-serif'; g.fillText(`${k} ${on ? 'ON' : 'OFF'}`, x + 22, 511); };
  chip(40, 'AHU', true); chip(284, 'UV', false); chip(528, 'Fumigation', false); chip(772, 'Night', false);
}

// ctx: the tour's ctx plus film(o) (fit o for the film, null: back to normal), fixtures(), box(), layers(), ambient(k),
// hold(on), draw(); parts: the tour's route, fitCorridor, lightOt, makeAir, music, loadVoices
export function createFilm(ctx, parts) {
  const { T, camera, renderer, stage } = ctx;
  let run = null;
  const overlay = h('canvas.p3-tourov'), note = h('div.p3-filmnote.hidden');
  const pauseBtn = h('button.btn.small.p3-filmpause', { type: 'button', onclick: () => pause() }, '⏸ Pause');
  const box = h('div.p3-tour.hidden', overlay, note, h('div.p3-filmbtns', pauseBtn, h('button.btn.small', { type: 'button', onclick: () => stop(true) }, '✕ Stop film')));
  function pause() {
    if (!run?.ac) return;
    run.paused = !run.paused; pauseBtn.textContent = run.paused ? '▶ Play' : '⏸ Pause';
    (run.paused ? run.ac.suspend() : run.ac.resume()).catch(() => {});
  }
  stage.append(box);

  // ---------------------------------------------------------------- the shots
  function build(o) {
    ctx.film(o); // refitted round its main door: o.fit is new
    const r = parts.route(o);
    if (!r?.d) throw new Error('This OT has no door onto a passage to walk in by.');
    const group = new T.Group(), emitters = []; ctx.scene.add(group);
    const corr = parts.fitCorridor(r, group, emitters, true);
    parts.lightOt(o, group);
    const S = o.fit.spots, H = S.H, d = r.d, [cx, cz] = S.center;
    for (const q of S.doors) if (q !== d && !q.main) q.setOpen?.(0);
    if (S.laf) emitters.push({ kind: 'laf', x: S.laf.x, z: S.laf.z, sx: S.laf.sx * 0.9, sz: S.laf.sz * 0.9, y: S.laf.y });
    const air = parts.makeAir(group, emitters);
    // shading: where the walls meet the floor and the ceiling, in the theatre and along the passage
    const shade = shadeKit(T), tp = S.tPanel || 0.04;
    // every stretch of wall alike (runs, under and over windows, over doors), so no strip of wall reads lighter
    for (const run of S.faces?.length ? S.faces : S.runs || []) {
      const sd = run.s, face = run.plane + sd.n * (tp / 2 + 0.004), at = (t, y, off = 0) => (sd.along === 'x' ? [t, y, face + sd.n * off] : [face + sd.n * off, y, t]);
      group.add(shade.quad(at(run.from, H - 0.004), at(run.to, H - 0.004), at(run.from, H - 0.6), at(run.to, H - 0.6), 0.22)); // the top of the wall
      if (run.foot === false) continue;
      group.add(shade.quad(at(run.from, 0.016), at(run.to, 0.016), at(run.from, 0.016, 0.5), at(run.to, 0.016, 0.5), 0.3)); // on the floor
      group.add(shade.quad(at(run.from, 0.1, 0.012), at(run.to, 0.1, 0.012), at(run.from, 0.45, 0.012), at(run.to, 0.45, 0.012), 0.12)); // the foot of the wall
    }
    { const st2 = corr.strip; for (const side of [1, -1]) for (const q of corr.wallRuns[side]) {
      const z = side * (q.dist - 0.017), a = q.a - 0.12, b = q.b + 0.12, H2 = corr.H;
      st2.add(shade.quad([a, 0.016, z], [b, 0.016, z], [a, 0.016, z - side * 0.45], [b, 0.016, z - side * 0.45], 0.28));
      st2.add(shade.quad([a, H2 - 0.004, z], [b, H2 - 0.004, z], [a, H2 - 0.6, z], [b, H2 - 0.6, z], 0.2));
    } }
    // light that falls off across the room (not one flat ambient): four soft lights round the plenum
    for (const [u, v] of [[0.32, 0.3], [-0.32, 0.3], [0.32, -0.3], [-0.32, -0.3]]) { const [x, z] = S.at(S.span * u, S.across * v), l = new T.PointLight(0xfff6ea, 0.32, 5.5, 2); l.position.set(x, H - 0.25, z); group.add(l); }
    // the Digital OR display at the entrance, beside the door on the passage side
    let disp = null;
    { const lat = [d.inZ, -d.inX], first = Math.sign(lat[0] * r.ux + lat[1] * r.uz) || 1;
      for (const k of [first, -first]) {
        const off = d.gap / 2 + 0.62, bx = d.x + lat[0] * k * off - d.inX * 1.0, bz = d.z + lat[1] * k * off - d.inZ * 1.0, dd = ctx.rayDist(bx, bz, d.inX, d.inZ, 1.6, ctx.walls());
        if (dd > 1.5) continue;
        const x = bx + d.inX * (dd - 0.07), z = bz + d.inZ * (dd - 0.07), rot = Math.atan2(-d.inX, -d.inZ);
        const scr = document.createElement('canvas'); scr.width = 1024; scr.height = 576; drawEntrance(scr.getContext('2d'), 1024, 576, otTitle(o.name).replace(/Operation Theatre/i, 'OT'));
        const tex = new T.CanvasTexture(scr); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
        const frameM = new T.MeshStandardMaterial({ color: 0x252c35, roughness: 0.4 }), scrM = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
        const fr = new T.Mesh(new T.BoxGeometry(0.7, 0.42, 0.03), frameM); fr.position.set(x, 1.55, z); fr.rotation.y = rot; group.add(fr);
        const sc = new T.Mesh(new T.PlaneGeometry(0.66, 0.37), scrM); sc.position.set(x - d.inX * 0.017, 1.55, z - d.inZ * 0.017); sc.rotation.y = rot; group.add(sc);
        disp = { x, z, k, lat, dispose: () => { tex.dispose(); frameM.dispose(); scrM.dispose(); fr.geometry.dispose(); sc.geometry.dispose(); } };
        break;
      } }
    const B = ctx.box(), ox = (o.x0 + o.x1) / 2, oz = (o.z0 + o.z1) / 2, span = Math.max(o.x1 - o.x0, o.z1 - o.z0);
    // the seamless ceiling closing over the complex, and the glow on the OT
    const pts = [[o.x0, o.z0], [o.x1, o.z1]];
    for (const u of [-r.beyond, r.L + 0.9]) for (const v of [-r.width / 2, r.width / 2]) pts.push([r.cx + r.ux * u + r.uz * v, r.cz + r.uz * u - r.ux * v]);
    const rb = { x0: Math.min(...pts.map(p => p[0])) - 0.15, x1: Math.max(...pts.map(p => p[0])) + 0.15, z0: Math.min(...pts.map(p => p[1])) - 0.15, z1: Math.max(...pts.map(p => p[1])) + 0.15 };
    const roof = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.85, transparent: true, opacity: 0, envMapIntensity: 0.05, side: T.DoubleSide }));
    roof.rotation.x = -Math.PI / 2; roof.visible = false; roof.userData.box = rb; group.add(roof);
    const glowMat = new T.MeshBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0, depthWrite: false }), glow = new T.Mesh(new T.PlaneGeometry(o.x1 - o.x0, o.z1 - o.z0), glowMat);
    glow.rotation.x = -Math.PI / 2; glow.position.set(ox, 0.1, oz); group.add(glow);
    const ringMat = new T.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0 }), ring = new T.LineLoop(new T.BufferGeometry().setFromPoints([[o.x0, o.z0], [o.x1, o.z0], [o.x1, o.z1], [o.x0, o.z1]].map(([x, z]) => new T.Vector3(x, 0.12, z))), ringMat);
    group.add(ring);
    group.userData.disposeFilm = () => { shade.dispose(); disp?.dispose(); group.traverse(m => { if (m.geometry && m.material?.alphaMap) m.geometry.dispose(); }); roof.geometry.dispose(); roof.material.dispose(); glow.geometry.dispose(); glowMat.dispose(); ring.geometry.dispose(); ringMat.dispose(); };

    // where to stand: the first place that really sees the target, kept inside the room
    const things = [...S.kit, ...S.pendants.map(p => [p.x, p.z])];
    const clearOfThings = (x, z) => things.every(([px, pz]) => Math.hypot(px - x, pz - z) > 0.85);
    const inWay = (x, z, tx, tz) => { const dx = tx - x, dz = tz - z, L2 = dx * dx + dz * dz || 1; return things.some(([px, pz]) => { const k = ((px - x) * dx + (pz - z) * dz) / L2; if (k < 0.05 || k > 0.85) return false; return Math.hypot(x + dx * k - px, z + dz * k - pz) < 0.45; }); };
    const sees = (x, z, tx, tz) => { const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz); return L < 0.4 || (ctx.rayDist(x, z, dx / L, dz / L, L, ctx.walls()) >= L - 0.12 && !inWay(x, z, tx, tz)); };
    const inRoom = (x, z) => [Math.max(o.x0 + 0.6, Math.min(o.x1 - 0.6, x)), Math.max(o.z0 + 0.6, Math.min(o.z1 - 0.6, z))];
    // the first place that sees the target and stands clear of the equipment; then any place that sees it; then a
    // place pulled towards the target until it is clear
    const view = (tx, ty, tz, places, y = EYE) => {
      for (const [x0, z0] of places) { const [x, z] = inRoom(x0, z0); if (sees(x, z, tx, tz) && clearOfThings(x, z)) return look(x, y, z, tx, ty, tz); }
      for (const [x0, z0] of places) { const [x, z] = inRoom(x0, z0); for (let k = 0.1; k < 0.75; k += 0.1) { const xx = x + (tx - x) * k, zz = z + (tz - z) * k; if (clearOfThings(xx, zz) && sees(xx, zz, tx, tz)) return look(xx, y, zz, tx, ty, tz); } }
      const [x, z] = inRoom(...places[0]); return look(x, y, z, tx, ty, tz); };
    const facing = (P, dist, lat = 0) => [P.x + P.inX * dist + P.inZ * lat, P.z + P.inZ * dist - P.inX * lat]; // in front of a thing on a wall

    // outside: the drawing from above, then the OT from above, then a three-quarter view over it and its passage
    const aspect = 16 / 9, tanH = Math.tan((FOV * Math.PI) / 360), topD = (w, hh) => (Math.max(hh, w / aspect) / (2 * tanH)) * 1.04;
    const P_full = look(0, topD(B.w, B.h), 0.001, 0, 0, 0), P_ot = look(ox, topD(span * 3.2, span * 3.2), oz + 0.001, ox, 0, oz);
    const wx = d.x - d.inX * 3, wz = d.z - d.inZ * 3; // the passage outside the door
    const P_obl = look(ox + (ox - wx) * 0.6 + span * 0.7, span * 1.5 + 7, oz + (oz - wz) * 0.6 + span * 1.1, (ox + wx) / 2, 0, (oz + wz) / 2);
    // the passage: from a room or two along, to the door
    const sx = r.cx + r.ux * r.L, sz = r.cz + r.uz * r.L;
    const P_above = look(sx + r.ux * 2.5, H + 5.5, sz + r.uz * 2.5, sx - r.ux * 4, 0, sz - r.uz * 4);
    const P_eye = look(sx, EYE, sz, sx - r.ux * 6, 1.45, sz - r.uz * 6);
    const nearK = Math.min(1.4, r.L * 0.3), P_near = look(r.cx + r.ux * nearK, EYE, r.cz + r.uz * nearK, r.cx - r.ux * 4, 1.35, r.cz - r.uz * 4);
    const P_scrub = corr.scrub ? look(corr.scrub.camX, EYE, corr.scrub.camZ, corr.scrub.x, 1.0, corr.scrub.z) : null;
    const P_disp = disp ? look(disp.x - d.inX * 1.75 - disp.lat[0] * disp.k * 0.55, EYE, disp.z - d.inZ * 1.75 - disp.lat[1] * disp.k * 0.55, disp.x, 1.5, disp.z) : null;
    const back = Math.max(1.2, Math.min(r.width - 0.45, 2.2)), P_door = look(d.x - d.inX * back, EYE, d.z - d.inZ * back, d.x, 1.25, d.z);
    const [ix, iz] = [d.x + d.inX * 1.5, d.z + d.inZ * 1.5], P_in = look(ix, EYE, iz, ix + d.inX * 5, 1.4, iz + d.inZ * 5);
    // inside
    const F = S.front || S.picture, C = S.cabinet, P = S.panel, want = S.parts || {}, frontPic = !!S.picture && (S.picture.wall || 'front') === 'front';
    const Pic = S.picture && !frontPic ? S.picture : null; // the picture on another wall: a shot of its own
    const P_front = F ? view(F.x, 1.45, F.z, [facing(F, 4.4), facing(F, 3.8, 0.6), facing(F, 4.0, -0.7), [ix, iz]]) : P_in;
    const P_front2 = F ? view(F.x, 1.5, F.z, [facing(F, 3.6), facing(F, 3.2, 0.5), facing(F, 3.4, -0.6), [ix, iz]]) : P_in;
    const riser = [...S.risers].sort((a, b) => (!!b.slant - !!a.slant) || Math.hypot(a.x - P_front.x, a.z - P_front.z) - Math.hypot(b.x - P_front.x, b.z - P_front.z))[0]; // a riser corner first
    const ent = S.entry || d, rv = [-ent.inZ, ent.inX]; // to the right on the way in
    const sideWall = k => { const [px, pz] = F ? [F.x + F.inX * 2.2, F.z + F.inZ * 2.2] : [cx, cz]; const dir = [rv[0] * k, rv[1] * k], dd = ctx.rayDist(px, pz, dir[0], dir[1], 8, ctx.walls()); return [px + dir[0] * dd, pz + dir[1] * dd]; };
    const [lwx, lwz] = sideWall(1), P_wallA = look(P_front2.x, EYE, P_front2.z, lwx, 1.35, lwz);
    const P_riser = riser ? view(riser.x, 0.45, riser.z, [[riser.x + riser.inX * 2.4 + riser.inZ * 0.8, riser.z + riser.inZ * 2.4 + riser.inX * 0.8], [riser.x + riser.inX * 2.4 - riser.inZ * 0.8, riser.z + riser.inZ * 2.4 - riser.inX * 0.8], [P_front2.x, P_front2.z]]) : P_wallA;
    const P_ceil = F ? { ...look(P_front2.x, EYE, P_front2.z, F.x, H, F.z), pitch: 0.5 } : { ...P_riser, pitch: 0.55 };
    const P_pic = Pic ? view(Pic.x, 1.45, Pic.z, [[3.4, 0], [3.0, -0.6], [3.0, 0.6], [2.6, 0], [3.8, 0]].map(([dd, lat]) => facing(Pic, dd, lat))) : null;
    const P_store = C ? view(C.x, 1.15, C.z, [[2.7, -0.5], [2.7, 0.5], [2.3, 0], [3.2, 0], [2.4, -1.0], [2.4, 1.0], [3.4, -1.2], [3.4, 1.2], [2.0, -1.4], [2.0, 1.4], [3.8, 0], [1.9, 0]].map(([dd, lat]) => facing(C, dd, lat))) : null;
    // the surgeon's wall: the control panel and X-ray viewer, and the writing board (beside them, or on the next stretch)
    const Bd = S.board, Q = P && Bd ? { x: (P.x + Bd.x) / 2, z: (P.z + Bd.z) / 2, inX: P.inX, inZ: P.inZ } : P, far = P && Bd ? Math.max(2.9, Math.hypot(P.x - Bd.x, P.z - Bd.z) * 0.75 + 1.6) : 2.9;
    const P_surg = Q ? (() => {
      for (const dd of [far, far - 0.5, far + 0.4, far - 1.0, far - 1.5]) for (const lat of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.5, -2.5]) {
        const [x, z] = inRoom(...facing(Q, dd, lat));
        if (clearOfThings(x, z) && sees(x, z, Q.x, Q.z) && (!P || sees(x, z, P.x, P.z)) && (!Bd || sees(x, z, Bd.x, Bd.z))) return look(x, EYE, z, Q.x, 1.4, Q.z);
      }
      return view(Q.x, 1.4, Q.z, [facing(Q, far), facing(Q, far, 0.4), facing(Q, far, -0.4), facing(Q, far - 0.5)]); })() : null;
    const P_dig = P ? view(P.x, 1.45, P.z, [facing(P, 1.9, -0.25), facing(P, 1.9, 0.25), facing(P, 2.3)]) : null;
    const pend = S.pendants.find(q => q.kind === 'surgeon') || S.pendants[0];
    const P_dig2 = P_dig && pend ? look(P_dig.x, EYE, P_dig.z, pend.x, 1.85, pend.z) : P_dig;
    const P_centre = view(cx, 0.95, cz, [S.at(1.9, 1.7), S.at(-1.9, 1.7), S.at(1.9, -1.7), S.at(-1.9, -1.7)]);
    const P_plenum = { ...P_centre, pitch: Math.atan2(H - EYE, Math.hypot(cx - P_centre.x, cz - P_centre.z) || 1) * 0.9 };
    const floorAt = F || C, P_floor = floorAt ? (() => {
      const tx = floorAt.x + floorAt.inX * 0.35 - floorAt.inZ * 0.4, tz = floorAt.z + floorAt.inZ * 0.35 + floorAt.inX * 0.4;
      for (const [dd, lat] of [[2.0, 1.6], [2.0, -1.6], [2.4, 1.0], [2.4, -1.0], [1.8, 0.6], [1.8, -0.6], [2.6, 0]]) { const [x, z] = inRoom(...facing(floorAt, dd, lat)); if (clearOfThings(x, z) && sees(x, z, tx, tz)) return look(x, EYE, z, tx, 0.05, tz); }
      const [x, z] = inRoom(...facing(floorAt, 2.0, 1.6)); return look(x, EYE, z, tx, 0.05, tz); })() : P_in;
    const P_high = look(ox + span * 0.45, span * 1.25 + H + 2, oz + span * 0.95, ox, 0, oz);
    const P_far = look(B.w * 0.12, Math.max(B.w, B.h) * 0.62 + 10, B.h * 0.62 + 6, 0, 0, 0);

    const project = String(ctx.title || '').replace(/\.(dwg|dxf)$/i, '').replace(/\s+(proposal|layout|drawing|plan)\b.*$/i, '').trim();
    const name = otTitle(o.name);
    // scenes: key (its voice line), the shortest it may be, when the voice starts, labels [fraction, text], and go()
    // placing the camera at lt seconds into a scene dur long; st collects what the overlay draws
    const L = (k, a, b, hold = 0) => soft(seg(k, a, b)) * (1 - hold);
    // when the turn inside (from P_in, a full circle eased over the scene) faces the windows, as a fraction of the scene
    let winAt = null;
    if (S.windows?.length && want.winFilm !== false) {
      const wx = S.windows.reduce((a2, q) => a2 + q.x, 0) / S.windows.length, wz = S.windows.reduce((a2, q) => a2 + q.z, 0) / S.windows.length;
      const want = Math.atan2(-(wx - P_in.x), -(wz - P_in.z)), f = ((((P_in.yaw - want) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < f) lo = m; else hi = m; } // ease(k) = f
      winAt = Math.max(0.3, Math.min(0.82, ((0.3 + lo * (11 - 0.6)) / 11) - 0.06)); // the scene is about 11 s, the turn from 0.3 s to the end
    }
    const scenes = [
      { key: 'film_plan', min: 10, vAt: 1.6, labels: [[0.12, `${project || 'Your project'} · OT complex`]], pin: name,
        go: (lt, dur) => lerpPose(P_full, P_ot, ease(seg(lt, 2.2, dur - 0.3))), outside: true, rise: () => 0.03, glow: () => 1 },
      { key: 'film_rise', min: 9, vAt: 0.8, labels: [[0.3, 'Self-standing modular system · No civil work']], pin: name,
        go: (lt, dur, s) => run.path(s.start + lt), outside: true, shadows: true,
        rise: lt => 0.03 + 0.97 * ease(seg(lt, 0.3, 5)), glow: lt => 1 - seg(lt, 2.5, 5.5), roof: (lt, dur) => ease(seg(lt, 5.2, Math.min(dur - 0.4, 7.8))) },
      { key: 'film_passage', min: 7, vAt: 3.2, labels: [[0.62, 'Clean passage']],
        go: (lt, dur, s) => run.path(s.start + lt), dip: true, roof: lt => 1 - ease(seg(lt, 0, 1.6)) },
      { key: 'film_walk', min: 14, vAt: 1.2, lightsOn: true,
        labels: [[0.06, 'KLEENCLAD™ walls · Silver-Ion antimicrobial'], [0.3, 'Matte cladding · 2–2.5 mm'], [0.52, 'Sky ceiling · air diffusers'], [0.76, 'Antistatic vinyl floor']],
        go: (lt, dur) => { const k = ease(seg(lt, 0.4, dur - 0.2)), p = lerpPose(P_eye, P_near, k); p.pitch += 0.34 * Math.sin(Math.PI * seg(k, 0.4, 0.72)) - 0.22 * Math.sin(Math.PI * seg(k, 0.8, 1)); return p; } },
      P_scrub && { key: 'film_scrub', min: 6, vAt: 0.6, labels: [[0.15, 'Scrub station']], go: (lt, dur) => lerpPose(P_near, P_scrub, ease(seg(lt, 0, Math.min(3.5, dur * 0.7)))) },
      P_disp && want.display !== false && { key: 'film_entrance', min: 9, vAt: 1.4, labels: [[0.1, 'WIESPL Digital OR · entrance display'], [0.5, 'Surgery · patient · surgeon · temperature · humidity · pressure']], go: (lt, dur) => lerpPose(P_scrub || P_near, P_disp, ease(seg(lt, 0, Math.min(3.4, dur * 0.4)))) },
      { key: 'film_enter', min: 8, vAt: 3.1, labels: [[0.22, d.kind === 'swing' ? (d.gap >= 1.15 ? 'WIESPL double-leaf swing door' : 'WIESPL swing door') : 'WIESPL hermetic sliding door']], door: (lt, dur) => soft(seg(lt, dur * 0.3, dur * 0.3 + 2.2)), shadows: true,
        go: (lt, dur) => (lt < dur * 0.3 ? lerpPose(P_disp || P_scrub || P_near, P_door, ease(seg(lt, 0, dur * 0.3))) : lerpPose(P_door, P_in, ease(seg(lt, dur * 0.48, dur)))) },
      // with windows: the voice tells of the privacy film, which turns the glass frosted for a moment, then clear again
      { key: winAt ? 'film_inside_win' : 'film_inside', min: 11, vAt: 1.0, labels: [[0.1, name], winAt ? [winAt, 'Clear glass windows · switchable privacy film'] : null].filter(Boolean), inside: true, smart: winAt ? (lt, dur) => lt > dur * (winAt + 0.07) && lt < dur - 0.6 : null, door: lt => 1 - soft(seg(lt, 0.6, 3)), shadows: true,
        go: (lt, dur) => ({ ...P_in, yaw: P_in.yaw - Math.PI * 2 * ease(seg(lt, 0.3, dur - 0.3)) }) },
      F && { key: frontPic ? (C?.where === 'front' ? 'film_front_store' : 'film_front') : (C?.where === 'front' ? 'film_front_storeonly' : 'film_front_plain'), min: 7, vAt: 0.9,
        labels: [[0.15, ['Full-height glass', frontPic && 'picture panel', C?.where === 'front' && 'built-in storage'].filter(Boolean).join(' · ')]], inside: true, go: (lt, dur) => lerpPose(P_in, P_front, ease(seg(lt, 0, Math.min(3.6, dur * 0.6)))) },
      { key: riser ? 'film_walls' : 'film_walls_nr', min: 10, vAt: 0.5, inside: true, labels: [[0.05, 'KLEENCLAD™ · RAL 7035 light grey, matte'], riser ? [0.4, 'Return-air risers'] : null, [0.72, 'Seamless ceiling']].filter(Boolean),
        go: (lt, dur) => { const k = lt / dur; return k < 0.32 ? lerpPose(P_front, P_wallA, ease(seg(k, 0, 0.3))) : k < 0.66 ? lerpPose(P_wallA, P_riser, ease(seg(k, 0.32, 0.62))) : lerpPose(P_riser, P_ceil, ease(seg(k, 0.66, 0.95))); } },
      P_pic && { key: 'film_picture_side', min: 6.5, vAt: 0.9, inside: true, labels: [[0.18, 'Printed picture glass · floor to ceiling']], go: (lt, dur) => lerpPose(P_ceil, P_pic, ease(seg(lt, 0, Math.min(3.4, dur * 0.6)))) },
      P_store && { key: { front: 'film_storage_front', left: 'film_storage_left', door: 'film_storage_door' }[C.where] || 'film_storage', min: 6.5, vAt: 0.9, inside: true, labels: [[0.18, 'Built-in storage · 60% glass doors']], go: (lt, dur) => lerpPose(P_pic || P_ceil, P_store, ease(seg(lt, 0, Math.min(3.4, dur * 0.6)))) },
      // "opposite the storage" only when the storage is on the other side wall
      // "opposite the storage" only when the storage is on the wall across the room
      P_surg && { key: 'film_surgeon' + (P_store && { left: 'right', right: 'left', front: 'door', door: 'front' }[S.surgeonWall] === C.where ? '' : '_ns') + (S.xray ? '' : '_nx') + (Bd ? '' : '_nb'), min: 8, vAt: 1.0, inside: true, labels: [[0.16, ['Control panel', S.xray && 'X-ray viewer', Bd && 'Writing board'].filter(Boolean).join(' · ')]], go: (lt, dur) => lerpPose(P_store || P_pic || P_ceil, P_surg, ease(seg(lt, 0, Math.min(3.6, dur * 0.55)))) },
      P_dig && { key: 'film_digital', min: 16, vAt: 1.0, inside: true, labels: [[0.04, 'WIESPL Digital OR · control at the surgeon’s panel'], [0.3, '4K multi-camera recording · live streaming'], [0.55, 'PACS · DICOM · HMS integration'], [0.78, 'Central OR server · surgery schedule display']],
        go: (lt, dur) => { const k = lt / dur; return k < 0.45 ? lerpPose(P_surg || P_store || P_front, P_dig, ease(seg(k, 0, 0.25))) : lerpPose(P_dig, P_dig2, ease(seg(k, 0.45, 0.75))); } },
      { key: S.pendants.length ? 'film_centre' : 'film_centre_np', min: 10, vAt: 0.9, inside: true, labels: [[0.12, 'Laminar airflow plenum'], S.pendants.length ? [0.55, 'Surgeon’s and anaesthesia pendants'] : null].filter(Boolean),
        go: (lt, dur) => { const k = lt / dur, from = P_dig2 || P_surg || P_store || P_front; return k < 0.4 ? lerpPose(from, P_centre, ease(seg(k, 0, 0.36))) : lerpPose(P_centre, P_plenum, ease(seg(k, 0.42, 0.9))); } },
      { key: 'film_floor', min: 6, vAt: 0.6, inside: true, labels: [[0.18, 'Antistatic vinyl floor · coved']], go: (lt, dur) => lerpPose(P_plenum, P_floor, ease(seg(lt, 0, Math.min(3.4, dur * 0.65)))) },
      { key: 'film_close', min: 11, vAt: 1.4, cut: true, outside: true, go: (lt, dur) => (lt < 0.5 ? P_floor : lerpPose(P_high, P_far, ease(seg(lt, 0.6, dur)))), roof: () => 0 },
    ].filter(Boolean);
    // panels light up one by one from the start of the walk
    const order = [...corr.panels].sort((a, b) => b.t - a.t);
    return { o, r, group, corr, air, roof, glowMat, ringMat, scenes, order, H, project, name, keys: { P_ot, P_obl, P_above, P_eye } };
  }

  // ---------------------------------------------------------------- one moment of the film
  function apply(t, dt) {
    const R = run; R.air.step(dt);
    let i = R.scenes.findIndex(s => t < s.start + s.dur); if (i < 0) i = R.scenes.length - 1;
    const s = R.scenes[i], lt = Math.max(0, t - s.start), dur = s.dur;
    if (R.idx !== i) { R.idx = i; R.shadowNext = true; }
    const st = { fadeA: t < 1.2 ? 1 - t / 1.2 : 0, label: null, pin: null, endA: clamp01((t - R.end) / 0.8) };
    let pose = s.go(Math.min(lt, dur), dur, s);
    { const near = Math.max(0.05, Math.min(2.5, pose.y * 0.03)); if (Math.abs(camera.near - near) > 1e-4) { camera.near = near; camera.updateProjectionMatrix(); } }
    // inside or outside (a dip to white on the way down, a cut to white on the way out)
    let inside = s.outside ? false : s.dip ? pose.y < R.H + 0.1 : true;
    if (s.cut) { st.fadeA = lt < 0.5 ? lt / 0.5 : clamp01(1 - (lt - 0.5) / 0.55); if (lt < 0.5) inside = true; }
    if (s.dip) st.fadeA = Math.max(st.fadeA, 0.95 * clamp01(1 - Math.abs(pose.y - (R.H + 0.2)) / 1.1));
    if (inside !== R.inside) {
      R.inside = inside; R.shadowNext = true;
      if (inside) { ctx.indoor(true, { soft: true, keepShadow: true }); ctx.focus?.(R.o); } else { ctx.indoor(false, { marks: false, sun: s.cut ? 0.85 : undefined, keepShadow: true }); ctx.focus?.(null); }
      if (R.hemi) R.hemi.intensity = inside ? R.hemiWas * 0.5 : R.hemiWas;
    }
    // the walls rise, the ceiling closes over, the glow
    const rise = s.rise ? s.rise(lt, dur) : 1;
    if (rise !== R.riseWas) { R.riseWas = rise; for (const e of R.risers) { e.obj.scale.y = rise; e.obj.position.y = e.y0 * rise; } R.shadowNext = true; }
    let roof = s.roof ? s.roof(lt, dur) : 0;
    if (s.dip) roof *= clamp01((pose.y - (R.H + 0.25)) / 2.6);
    { const rb = R.roof.userData.box, slideK = s.dip ? 1 : roof, wv = (rb.x1 - rb.x0) * Math.max(0.001, slideK); // slides across from one side
      R.roof.scale.set(wv, rb.z1 - rb.z0, 1); R.roof.position.set(rb.x0 + wv / 2, R.H * rise + 0.06, (rb.z0 + rb.z1) / 2);
      const op = s.dip ? roof : Math.min(1, roof * 3); R.roof.visible = op > 0.005 && slideK > 0.002; R.roof.material.opacity = op; R.roof.material.transparent = op < 0.995; R.roof.material.depthWrite = op > 0.5; }
    const gl = s.glow ? s.glow(lt, dur) : 0, pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    R.glowMat.opacity = gl * (0.16 + 0.14 * pulse); R.ringMat.opacity = gl * (0.6 + 0.4 * pulse);
    // the door: shut while we walk up, opening, closing behind us
    if (s.smart) { const on = !!s.smart(lt, dur); if (on !== R.smartWas) { R.smartWas = on; ctx.smartFilm?.(on); } }
    const door = s.door ? s.door(lt, dur) : 0;
    if (door !== R.doorWas) { R.doorWas = door; R.r.d.setOpen(door); }
    // the passage lights: off until the walk, then on one by one
    const ws = R.walkStart, on = n => (t < ws ? 0 : clamp01((t - ws - 0.35 - n * 0.42) / 0.5));
    R.order.forEach((p, n) => { const k = on(n); if (k !== p.k) { p.k = k; p.mesh.material.color.setScalar(0.07 + 0.93 * k); if (p.light) p.light.intensity = 0.55 * k; } });
    if (R.inside) ctx.ambient(t < ws ? 0.04 : 0.04 + 0.08 * clamp01((t - ws) / (0.9 + R.order.length * 0.42)));
    R.n = (R.n || 0) + 1;
    if (R.shadowNext || (s.shadows && (!R.ac || R.n % 3 === 0))) { ctx.shadows?.(); R.shadowNext = false; }
    // labels: one at a time, each until the next (or the scene's end)
    if (s.labels?.length) for (let n = 0; n < s.labels.length; n++) {
      const a = s.labels[n][0] * dur, b = n + 1 < s.labels.length ? s.labels[n + 1][0] * dur - 0.15 : dur - 0.3;
      if (lt >= a && lt < b) st.label = { text: s.labels[n][1], a: clamp01((lt - a) / 0.45) * clamp01((b - lt) / 0.4) };
    }
    if (s.pin) { const v = new T.Vector3((R.o.x0 + R.o.x1) / 2, 0.3 * rise, (R.o.z0 + R.o.z1) / 2); camera.position.set(pose.x, pose.y, pose.z); camera.rotation.set(pose.pitch, pose.yaw, 0); camera.updateMatrixWorld(); v.project(camera);
      st.pin = { x: (v.x + 1) / 2, y: (1 - v.y) / 2, text: s.pin, a: clamp01((lt - (s.key === 'film_plan' ? 3 : 0)) / 0.6) * (s.key === 'film_rise' ? 1 - seg(lt, 3.5, 4.3) : 1) }; }
    camera.position.set(pose.x, pose.y, pose.z); camera.rotation.set(pose.pitch, pose.yaw, 0);
    R.st = st;
  }

  // ---------------------------------------------------------------- what is drawn over the 3D
  function card(g, W, Hh, a) {
    if (a <= 0) return;
    const k = W / 1920; g.save(); g.globalAlpha = a; g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, Hh);
    if (LOGO.complete && LOGO.naturalWidth) { const lh = Hh * 0.36, lw = lh * LOGO.naturalWidth / LOGO.naturalHeight; g.drawImage(LOGO, (W - lw) / 2, Hh * 0.1, lw, lh); }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#15202f'; g.font = `600 ${34 * k}px ${FONT}`; g.fillText(COMPANY[0], W / 2, Hh * 0.62);
    g.fillStyle = '#44546a'; g.font = `500 ${24 * k}px ${FONT}`; g.fillText(COMPANY[1], W / 2, Hh * 0.62 + 50 * k);
    g.fillStyle = '#1f4e9a'; g.font = `600 ${28 * k}px ${FONT}`; g.fillText(COMPANY[2], W / 2, Hh * 0.62 + 104 * k);
    g.fillStyle = '#1f4e9a'; g.fillRect(0, Hh - 12 * k, W * 0.68, 12 * k); g.fillStyle = '#5cb85c'; g.fillRect(W * 0.68, Hh - 12 * k, W * 0.32, 12 * k);
    g.restore();
  }
  function pill(g, x, y, text, a, k, anchor = 'left') {
    g.save(); g.globalAlpha = a; g.font = `600 ${30 * k}px ${FONT}`; g.textBaseline = 'middle';
    const tw = g.measureText(text).width, w = tw + 64 * k, hh = 62 * k, x0 = anchor === 'center' ? x - w / 2 : x;
    g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 18 * k; g.fillStyle = 'rgba(12,28,56,.66)'; g.beginPath(); g.roundRect(x0, y, w, hh, hh / 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#5cb85c'; g.beginPath(); g.arc(x0 + 30 * k, y + hh / 2, 6 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.fillText(text, x0 + 46 * k, y + hh / 2 + 1 * k);
    g.restore();
  }
  function drawOverlay(g, W, Hh, st) {
    const k = W / 1920;
    { const v = g.createRadialGradient(W / 2, Hh / 2, Hh * 0.45, W / 2, Hh / 2, Hh * 1.15); v.addColorStop(0, 'rgba(10,18,30,0)'); v.addColorStop(1, 'rgba(10,18,30,.32)'); g.fillStyle = v; g.fillRect(0, 0, W, Hh); }
    if (st.fadeA > 0) { g.fillStyle = `rgba(255,255,255,${st.fadeA})`; g.fillRect(0, 0, W, Hh); }
    const m = markImage(); // the WIESPL mark, small and quiet
    if (m) { g.save(); g.globalAlpha = 0.85; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 10 * k; g.drawImage(m, 48 * k, 40 * k, 74 * k, 74 * k); g.restore(); }
    if (st.pin && st.pin.a > 0) {
      const px = st.pin.x * W, py = st.pin.y * Hh;
      g.save(); g.globalAlpha = st.pin.a; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3 * k; g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 70 * k); g.stroke();
      g.fillStyle = '#2f9bff'; g.beginPath(); g.arc(px, py, 9 * k, 0, Math.PI * 2); g.fill(); g.restore();
      pill(g, px, py - 70 * k - 62 * k, st.pin.text, st.pin.a, k, 'center');
    }
    if (st.label && st.label.a > 0) pill(g, 72 * k, Hh - 150 * k, st.label.text, st.label.a, k);
    card(g, W, Hh, st.endA);
  }

  // ---------------------------------------------------------------- start, play, make the 4K file, stop
  async function start({ record = false, sink = null, still = false, quality = '4k' } = {}) {
    if (run) return;
    const o = ctx.selected() || parts.route()?.o;
    if (!o) throw new Error('Choose the OT the film is about first.');
    const B = build(o);
    const hemi = ctx.scene.children.find(x => x.isHemisphereLight);
    // the parts that rise: each thing standing above the floor (its height scaled from the floor), never the floors
    const risers = [], box3 = new T.Box3(), skip = new Set([B.roof, B.group.children.find(x => x.isLineLoop), B.group.children.find(x => x.material === B.glowMat)]);
    const take = obj => { if (skip.has(obj) || obj.isLight) { if (obj.isLight) risers.push({ obj, y0: obj.position.y }); return; } box3.setFromObject(obj); if (box3.isEmpty() || box3.max.y <= 0.06) return; risers.push({ obj, y0: obj.position.y }); };
    { const Ls = ctx.layers(); for (const c of Ls.group.children) take(c); for (const ot of Ls.fitLayer.children) for (const c of ot.children) take(c);
      for (const c of B.group.children) { if (c === B.corr.strip) { for (const k of c.children) take(k); } else take(c); } }
    run = { ...B, risers, near: camera.near, hemi, hemiWas: hemi?.intensity ?? 0, idx: -1, inside: null, riseWas: null, doorWas: null, fov: camera.fov, exposure: renderer.toneMappingExposure, pr: renderer.getPixelRatio() };
    stage.filmState = () => run && Object.assign(run, { camera }); // for checking from the console
    const dec = new OfflineAudioContext(1, 1, 48000), voices = await parts.loadVoices([...new Set(run.scenes.map(s => s.key))], dec);
    let t = 0;
    for (const s of run.scenes) {
      s.voice = voices[s.key]; const vd = s.voice ? s.voice.duration : TOUR_LINES[s.key].say.split(' ').length / 2.6;
      s.start = t; s.dur = Math.max(s.min, s.vAt + vd + 0.9); t += s.dur;
      if (s.key === 'film_walk') run.walkStart = s.start;
    }
    run.walkStart ??= 1e9; run.end = t; run.total = t + END_CARD;
    ctx.smartFilm?.(false); run.smartWas = false; // windows start clear
    { const rise = run.scenes.find(x => x.key === 'film_rise'), pas = run.scenes.find(x => x.key === 'film_passage'), K = run.keys;
      run.path = posePath([[rise.start, K.P_ot], [rise.start + rise.dur * 0.72, K.P_obl], [pas.start + pas.dur * 0.5, K.P_above], [pas.start + pas.dur, K.P_eye]]); }
    camera.rotation.order = 'YXZ'; camera.fov = FOV; camera.updateProjectionMatrix(); renderer.toneMappingExposure = 0.95;
    run.bg = ctx.scene.background; ctx.scene.background = new T.Color(0xe6eaef);
    { const Ls = ctx.layers(), was = Ls.ceilLayer.visible; ctx.focus?.(null); Ls.ceilLayer.visible = true;
      ctx.indoor(true, { soft: true, keepShadow: true }); renderer.compile(ctx.scene, camera); ctx.indoor(false, { marks: false, keepShadow: true }); renderer.compile(ctx.scene, camera); Ls.ceilLayer.visible = was; }
    box.classList.remove('hidden'); stage.classList.add('p3-touring'); pauseBtn.classList.toggle('hidden', !!record || !!still); pauseBtn.textContent = '⏸ Pause';
    if (still) { ctx.hold(true); return run; } // for checking: peek(t) draws one moment
    if (record) return make(sink, quality);
    // on screen, in real time, with sound
    const ac = run.ac = new AudioContext(); await ac.resume();
    run.t0 = ac.currentTime + 0.4; run.sources = [];
    for (const s of run.scenes) if (s.voice) { const src = ac.createBufferSource(); src.buffer = s.voice; src.connect(ac.destination); src.start(run.t0 + s.start + s.vAt); run.sources.push(src); }
    parts.music(ac, run.t0, run.t0 + run.total, [ac.destination]);
    renderer.setPixelRatio(Math.min(1.25, run.pr)); ctx.resize?.();
    apply(0, 0);
  }
  function frame(now) {
    if (!run?.ac) return false;
    const t = Math.max(0, run.ac.currentTime - run.t0), dt = run.paused ? 0 : Math.min(0.1, (now - (run.last || now)) / 1000); run.last = now;
    apply(t, dt);
    if (t > run.total) stop(false);
    return true;
  }
  function afterRender() {
    if (!run?.st || !run.ac) return;
    const dpr = Math.min(1.25, window.devicePixelRatio || 1), W = stage.clientWidth, Hh = stage.clientHeight;
    if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(Hh * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(Hh * dpr); }
    const g = overlay.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    drawOverlay(g, W, Hh, run.st);
  }

  // frame by frame. Each frame is the average of a few sub-frames, a little apart in time and shifted under a pixel, so
  // fine lines of the drawing do not shimmer and movement is smooth. The voice and music are mixed offline. One pass
  // makes two MP4s: 4K (3840 × 2160) and 1080p for phones and WhatsApp.
  const JIT = { 1: [[0, 0]], 2: [[0.25, 0.25], [-0.25, -0.25]], 3: [[0.33, 0], [-0.17, 0.29], [-0.17, -0.29]] };
  function fileSink() { // the file in parts: the first MB stays editable (the muxer fills in the size of the media data at the end)
    const HEAD = 1 << 20, head = new Uint8Array(HEAD), blobs = []; let pend = [], pendSize = 0, end = 0, headLen = 0;
    const push = u => { pend.push(u.slice()); pendSize += u.length; if (pendSize > (32 << 20)) { blobs.push(new Blob(pend)); pend = []; pendSize = 0; } };
    return {
      onData(data, pos) {
        if (pos < end) { if (pos + data.length > HEAD) throw new Error('mp4: late write'); head.set(data, pos); return; }
        if (pos !== end) throw new Error('mp4: gap');
        if (pos < HEAD) { const n = Math.min(data.length, HEAD - pos); head.set(data.subarray(0, n), pos); headLen = pos + n; if (n < data.length) push(data.subarray(n)); } else push(data);
        end = pos + data.length;
      },
      blob: () => new Blob([head.subarray(0, headLen), ...blobs, ...pend], { type: 'video/mp4' }),
    };
  }
  async function make(sink, quality = '4k') {
    const R = run, frames = Math.ceil(R.total * FPS), sr = 48000;
    if (!window.VideoEncoder || !window.AudioEncoder) throw new Error('This browser cannot make the film file. Use Chrome or Edge on a computer.');
    const quick = quality === '1080p', hd = { W: 1920, Hh: 1080, codec: 'avc1.640028', bitrate: 10_000_000, tag: '1080p' };
    const outs = quick ? [hd] : [{ W: 3840, Hh: 2160, codec: 'avc1.640033', bitrate: 24_000_000, tag: '4K' }, hd];
    for (const O of outs) { O.cfg = { codec: O.codec, width: O.W, height: O.Hh, bitrate: O.bitrate, framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } }; if (!(await VideoEncoder.isConfigSupported(O.cfg)).supported) throw new Error(`This PC cannot encode ${O.tag} H.264 video.`); }
    const { Muxer, StreamTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
    let err = null;
    for (const O of outs) {
      O.sink = fileSink(); O.muxer = new Muxer({ target: new StreamTarget({ onData: O.sink.onData }), video: { codec: 'avc', width: O.W, height: O.Hh, frameRate: FPS }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: sr }, fastStart: false, firstTimestampBehavior: 'offset' });
      O.canvas = h('canvas', { width: O.W, height: O.Hh }); O.g = O.canvas.getContext('2d');
    }
    // sound first
    note.textContent = 'Mixing the voice and music…'; note.classList.remove('hidden');
    const oac = new OfflineAudioContext(2, Math.ceil(R.total * sr), sr);
    for (const s of R.scenes) if (s.voice) { const src = oac.createBufferSource(); src.buffer = s.voice; src.connect(oac.destination); src.start(s.start + s.vAt); }
    parts.music(oac, 0, R.total, [oac.destination]);
    const mix = await oac.startRendering();
    const aenc = new AudioEncoder({ output: (c, m) => outs.forEach(O => O.muxer.addAudioChunk(c, m)), error: e => { err = e; } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 2, bitrate: 192_000 });
    const A = mix.getChannelData(0), Bc = mix.getChannelData(1), NA = 4096;
    for (let i = 0; i < mix.length; i += NA) {
      const n = Math.min(NA, mix.length - i), buf = new Float32Array(n * 2); buf.set(A.subarray(i, i + n), 0); buf.set(Bc.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data: buf }); aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
    // then the pictures
    const big = outs[0], W = big.W, Hh = big.Hh;
    ctx.hold(true);
    renderer.setPixelRatio(1); renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.updateProjectionMatrix();
    for (const O of outs) { O.enc = new VideoEncoder({ output: (c, m) => O.muxer.addVideoChunk(c, m), error: e => { err = e; } }); O.enc.configure(O.cfg); }
    const t0 = performance.now();
    try {
      for (let i = 0; i < frames && run === R; i++) {
        if (err) throw err;
        const t = i / FPS, sc = R.scenes.find(x => t < x.start + x.dur) || R.scenes[R.scenes.length - 1], N = (sc.outside || sc.dip || sc.cut ? 3 : 2) - (quick ? 1 : 0);
        const step = 0.5 / (N * FPS); // a half-frame shutter
        for (let j = 0; j < N; j++) {
          apply(Math.max(0, t + (j - (N - 1) / 2) * step), j === 0 ? 1 / FPS - (N - 1) * step : step);
          camera.setViewOffset(W, Hh, JIT[N][j][0], JIT[N][j][1], W, Hh); ctx.draw();
          big.g.globalAlpha = 1 / (j + 1); big.g.drawImage(renderer.domElement, 0, 0, W, Hh);
        }
        camera.clearViewOffset(); big.g.globalAlpha = 1;
        drawOverlay(big.g, W, Hh, R.st);
        for (const O of outs.slice(1)) O.g.drawImage(big.canvas, 0, 0, O.W, O.Hh);
        for (const O of outs) { const vf = new VideoFrame(O.canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) }); O.enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close(); }
        while (outs.some(O => O.enc.encodeQueueSize > 4)) await tick();
        if (i % 15 === 0) { const sec = (performance.now() - t0) / 1000, left = (sec / (i + 1)) * (frames - i - 1); note.textContent = `Making the film: ${Math.round((100 * i) / frames)} % · about ${Math.ceil(left / 60)} min left. Keep this tab open.`; await tick(); }
      }
      if (run !== R) { for (const O of outs) O.enc.close(); return; } // stopped
      for (const O of outs) { await O.enc.flush(); O.enc.close(); O.muxer.finalize(); }
      if (err) throw err;
      const base = `${(R.project || 'WIESPL').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${R.name} - WIESPL film`;
      for (const O of outs) {
        const file = O.sink.blob(), fileName = `${base} ${O.tag}.mp4`;
        note.textContent = `Film made: ${O.tag}, ${(file.size / 1048576).toFixed(0)} MB`;
        if (sink) await sink(file, fileName, O.tag);
        else { const a2 = h('a', { href: URL.createObjectURL(file), download: fileName }); document.body.append(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(a2.href), 120_000); }
      }
      R.made = { frames, seconds: R.total, ms: performance.now() - t0 };
    } finally { camera.clearViewOffset(); if (run === R) stop(false); }
  }

  // one moment of a film started with { still: true }, as a JPEG with its overlay (for checking)
  function peek(t, W = 1280, Hh = 720) {
    if (!run) return null;
    renderer.setPixelRatio(1); renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.updateProjectionMatrix();
    for (let k = 6; k >= 1; k--) apply(Math.max(0, t - k / FPS), 1 / FPS); // a few frames before, so the air has moved
    apply(t, 1 / FPS); ctx.draw();
    const c = h('canvas', { width: W, height: Hh }), g = c.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh); drawOverlay(g, W, Hh, run.st);
    return c.toDataURL('image/jpeg', 0.85);
  }
  function stop(early) {
    if (!run) return;
    const cur = run; run = null;
    for (const src of cur.sources || []) { try { src.stop(); } catch { /* already over */ } }
    cur.ac?.close().catch(() => {});
    cur.r.d?.setOpen?.(1); if (cur.hemi) cur.hemi.intensity = cur.hemiWas; ctx.smartFilm?.(null); // the window film as the viewer had it
    for (const e of cur.risers) { e.obj.scale.y = 1; e.obj.position.y = e.y0; } camera.near = cur.near; camera.updateProjectionMatrix();
    cur.air?.dispose(); cur.group.userData.dispose?.(); cur.group.userData.disposeFilm?.(); ctx.scene.remove(cur.group);
    box.classList.add('hidden'); note.classList.add('hidden'); stage.classList.remove('p3-touring');
    camera.rotation.order = 'XYZ'; camera.fov = cur.fov; renderer.toneMappingExposure = cur.exposure; renderer.setPixelRatio(cur.pr); ctx.scene.background = cur.bg ?? null;
    ctx.hold(false); ctx.resize?.();
    ctx.done(cur.o, early);
  }

  stage.filmApi = { peek: (...a) => peek(...a), stop: () => stop(true), times: () => run?.scenes.map(s => [s.key, +s.start.toFixed(2), +s.dur.toFixed(2)]) };
  return { start, stop, frame, afterRender, get on() { return !!run; }, get making() { return !!run && !run.ac; } };
}
