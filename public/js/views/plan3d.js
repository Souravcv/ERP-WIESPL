// 🧊 A CAD floor plan (DWG / DXF attached to any record) shown in 3D like an architect's model: solid walls with
// dark section-cut tops, glass, raised furniture, soft shadows and colour-coded room names.
// The DWG is read once in a Web Worker (plan-worker.js); the result is kept on the server so it reopens instantly.
import { h, api, toast, fail } from '../ui.js';
import { guessRole } from '../plan-extract.js';

const ROLES = [['wall', 'Wall'], ['glass', 'Glass'], ['column', 'Column'], ['door', 'Door'], ['furniture', 'Furniture / fittings'], ['floor', 'Lines on floor'], ['hide', 'Hide']];
const COLOR = { wall: 0xe9edf2, glass: 0x9fd0f2, column: 0x707b8c, door: 0x9a5b22, furniture: 0x52627a, floor: 0x9aa7b6 };
const ROLE_KEY = 'plan3d-roles';
const ROOM_RE = /THEAT|\bOT\b|CORRIDOR|STORE|ROOM|ICU|NICU|WARD|RECOVERY|PRE-?OP|POST-?OP|SCRUB|CSSD|LOBBY|TOILET|STAIR|LIFT|STATION|AREA|SHAFT|CATH|LAB|PANTRY|OFFICE/i;
const loadRoles = () => { try { return JSON.parse(localStorage.getItem(ROLE_KEY) || '{}'); } catch { return {}; } };
const saveRoles = r => { try { localStorage.setItem(ROLE_KEY, JSON.stringify(r)); } catch { /* ignore */ } };

let three = null;
function loadThree() {
  if (window.THREE?.OrbitControls) return Promise.resolve();
  const s = src => new Promise((ok, bad) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => bad(new Error('Could not load the 3D library (internet needed)')); document.head.append(el); });
  three ||= (async () => { if (!window.THREE) await s('https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'); await s('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'); })().catch(e => { three = null; throw e; });
  return three;
}

function readInWorker(buf, dxf, onStep) {
  return new Promise((ok, bad) => {
    const w = new Worker('/js/plan-worker.js', { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.step) return onStep(data.step);
      w.terminate();
      if (data.error) bad(new Error(data.error)); else ok(data.plan);
    };
    w.onerror = e => { w.terminate(); bad(new Error(e.message || 'The drawing reader stopped')); };
    w.postMessage({ buf, dxf }, [buf]);
  });
}

export async function plan3dView(root, fileId) {
  const id = Number(fileId);
  const name = new URLSearchParams(location.hash.split('?')[1] || '').get('n') || 'Drawing';
  const status = h('div.p3-status', 'Opening…');
  const stage = h('div.p3-stage', status);
  const side = h('aside.p3-side');
  root.replaceChildren(
    h('div.page-head', h('h1', `🧊 ${name}`), h('div.actions', h('button.btn', { onclick: () => history.back() }, '‹ Back'), h('a.btn', { href: `/api/files/${id}` }, '⬇ Download drawing'))),
    h('div.p3-wrap', stage, side));

  let plan;
  try {
    await loadThree();
    plan = await api(`/files/${id}/plan`).catch(() => null);
    if (!plan) {
      status.textContent = 'Downloading the drawing…';
      const res = await fetch(`/api/files/${id}`);
      if (!res.ok) throw new Error('Could not download the drawing');
      const buf = await res.arrayBuffer();
      plan = await readInWorker(buf, /\.dxf$/i.test(name), t => { status.textContent = t; });
      api(`/files/${id}/plan`, { method: 'PUT', body: plan }).catch(() => {}); // next time it opens instantly
    }
  } catch (e) { status.textContent = `⚠ ${e.message}`; return; }
  build(stage, side, plan);
}

// premium look: solid walls with dark section-cut tops, soft shadows, studio light, tiled floor, raised furniture
const TINT = name => (/NICOMAC|PANEL|HPL|CLEAN ROOM/i.test(name) ? 0xdde6ef : /PARTI/i.test(name) ? 0xf0f2f5 : 0xf5f1ea);
const KIND = t => (/THEAT|\bOT\b|OPERATION|CATH|PROCEDURE/i.test(t) ? 'ot' : /CORRIDOR|LOBBY|PASSAGE/i.test(t) ? 'cor' : /STORE|STORAGE|SUPPLY/i.test(t) ? 'store'
  : /SHAFT|LIFT|STAIR|ELEVATOR|AHU/i.test(t) ? 'shaft' : /TOILET|WC|WASH|SCRUB|SINK/i.test(t) ? 'wet' : 'room');

function build(stage, side, plan) {
  const T = window.THREE;
  const roles = loadRoles();
  const roleOf = l => roles[l] || guessRole(l);
  const small = Math.min(stage.clientWidth, stage.clientHeight) < 500 || /Mobi|Android/i.test(navigator.userAgent);
  let areaIdx = 0, wallH = 3, furnH = 0.6, showLabels = true, current = null;

  stage.replaceChildren();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(small ? 1.75 : 2, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // the building does not move: shadows are drawn once per rebuild
  stage.append(renderer.domElement);
  const labelsLayer = h('div.p3-labels'); stage.append(labelsLayer);
  const scene = new T.Scene();
  { // soft studio reflections (glass, panels)
    const env = new T.Scene();
    env.add(new T.Mesh(new T.BoxGeometry(20, 12, 20), new T.MeshBasicMaterial({ color: 0xb7c1cd, side: T.BackSide })));
    const panel = (w, hh, x, y, z, rx, ry, c = 0xffffff) => { const m = new T.Mesh(new T.PlaneGeometry(w, hh), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    panel(10, 3, 0, 5.8, 0, Math.PI / 2, 0, 0xfff7ea); panel(5, 6, -9.8, 2, 0, 0, Math.PI / 2); panel(5, 6, 9.8, 2, 2, 0, -Math.PI / 2, 0xe6efff);
    const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose();
  }
  const camera = new T.PerspectiveCamera(42, 1, 0.1, 6000);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI * 0.495, screenSpacePanning: true, zoomSpeed: 1.2 });
  scene.add(new T.HemisphereLight(0xf4f7ff, 0x9aa6b6, 0.38));
  const sun = new T.DirectionalLight(0xfff3e2, 1.55);
  sun.castShadow = true; sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xdce8ff, 0.22); fill.position.set(-1, 0.6, -0.8); scene.add(fill);
  const group = new T.Group(); scene.add(group);
  const tile = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#e4e3dd'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '90,95,105'},${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    g.strokeStyle = 'rgba(60,70,85,.14)'; g.lineWidth = 2; for (let p = 0; p <= 256; p += 128) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.moveTo(0, p); g.lineTo(256, p); g.stroke(); }
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; t.encoding = T.sRGBEncoding; return t; })(); // one tile = 0.6 m
  let labels = [], center = [0, 0], size = 50, box = { w: 50, h: 50 }, occ = new Float32Array(0); // occ: solid walls in scene x / z, for views from inside

  // vertical faces for a list of plan segments (x1, y1, x2, y2 …), darker at the foot (reads as contact shadow)
  const faces = (s, X, Z, y0, y1, foot = 0.8) => {
    const n = s.length / 4, pos = new Float32Array(n * 18), col = new Float32Array(n * 18);
    for (let i = 0, k = 0; i < s.length; i += 4, k += 18) {
      const ax = X(s[i]), az = Z(s[i + 1]), bx = X(s[i + 2]), bz = Z(s[i + 3]);
      pos.set([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az], k);
      col.set([foot, foot, foot, foot, foot, foot, 1, 1, 1, foot, foot, foot, 1, 1, 1, 1, 1, 1], k);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  };
  const outline = (s, X, Z, y) => {
    const pos = new Float32Array((s.length / 4) * 6);
    for (let i = 0, k = 0; i < s.length; i += 4, k += 6) pos.set([X(s[i]), y, Z(s[i + 1]), X(s[i + 2]), y, Z(s[i + 3])], k);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); return g;
  };
  // the two lines of a wall → a filled top between them (dark "cut" like an architect's section)
  const caps = (s, X, Z, y) => {
    const n = s.length / 4, out = [];
    for (let a = 0; a < n; a++) {
      const ax = s[a * 4], ay = s[a * 4 + 1], dx = s[a * 4 + 2] - ax, dy = s[a * 4 + 3] - ay, L = Math.hypot(dx, dy);
      if (L < 0.05) continue;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const minx = Math.min(ax, s[a * 4 + 2]) - 0.6, maxx = Math.max(ax, s[a * 4 + 2]) + 0.6, miny = Math.min(ay, s[a * 4 + 3]) - 0.6, maxy = Math.max(ay, s[a * 4 + 3]) + 0.6;
      for (let b = a + 1; b < n; b++) {
        const bx1 = s[b * 4], by1 = s[b * 4 + 1], bx2 = s[b * 4 + 2], by2 = s[b * 4 + 3];
        if ((bx1 < minx && bx2 < minx) || (bx1 > maxx && bx2 > maxx) || (by1 < miny && by2 < miny) || (by1 > maxy && by2 > maxy)) continue;
        const d1 = (bx1 - ax) * nx + (by1 - ay) * ny, d2 = (bx2 - ax) * nx + (by2 - ay) * ny;
        if (Math.abs(d1 - d2) > 0.012 || Math.abs(d1) < 0.03 || Math.abs(d1) > 0.5) continue;    // parallel, 3–500 mm apart
        const t1 = (bx1 - ax) * ux + (by1 - ay) * uy, t2 = (bx2 - ax) * ux + (by2 - ay) * uy;
        const o0 = Math.max(0, Math.min(t1, t2)), o1 = Math.min(L, Math.max(t1, t2));
        if (o1 - o0 < 0.05) continue;
        const d = (d1 + d2) / 2, p = [ax + ux * o0, ay + uy * o0], q = [ax + ux * o1, ay + uy * o1];
        const P = [X(p[0]), Z(p[1])], Q = [X(q[0]), Z(q[1])], Q2 = [X(q[0] + nx * d), Z(q[1] + ny * d)], P2 = [X(p[0] + nx * d), Z(p[1] + ny * d)];
        out.push(P[0], y, P[1], Q[0], y, Q[1], Q2[0], y, Q2[1], P[0], y, P[1], Q2[0], y, Q2[1], P2[0], y, P2[1]);
      }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(out), 3)); g.computeVertexNormals();
    return g;
  };

  const rebuild = () => {
    group.traverse(o => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
    group.clear(); labelsLayer.replaceChildren(); labels = [];
    const A = plan.areas[areaIdx] || { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
    const inA = (x, y) => x >= A.x0 - 1 && x <= A.x1 + 1 && y >= A.y0 - 1 && y <= A.y1 + 1;
    const buckets = {}, wallsByTint = {};
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [lname, L] of Object.entries(plan.layers)) {
      const r = roleOf(lname); if (r === 'hide') continue;
      const s = L.segs, out = (buckets[r] ||= []), tinted = r === 'wall' ? (wallsByTint[TINT(lname)] ||= []) : null;
      for (let i = 0; i < s.length; i += 4) if (inA(s[i], s[i + 1]) && inA(s[i + 2], s[i + 3])) {
        out.push(s[i], s[i + 1], s[i + 2], s[i + 3]); tinted?.push(s[i], s[i + 1], s[i + 2], s[i + 3]);
        if (r === 'wall' || r === 'glass' || r === 'column') { bx0 = Math.min(bx0, s[i], s[i + 2]); bx1 = Math.max(bx1, s[i], s[i + 2]); by0 = Math.min(by0, s[i + 1], s[i + 3]); by1 = Math.max(by1, s[i + 1], s[i + 3]); }
      }
    }
    if (!Number.isFinite(bx0)) { bx0 = A.x0; by0 = A.y0; bx1 = A.x1; by1 = A.y1; } // no walls chosen: use the whole area
    center = [(bx0 + bx1) / 2, (by0 + by1) / 2]; box = { w: bx1 - bx0, h: by1 - by0 }; size = Math.max(box.w, box.h);
    const X = x => x - center[0], Z = y => -(y - center[1]);
    { // solid walls and columns as 2D segments in scene coordinates
      const solid = [...(buckets.wall || []), ...(buckets.column || [])];
      occ = new Float32Array(solid.length);
      for (let i = 0; i < solid.length; i += 4) occ.set([X(solid[i]), Z(solid[i + 1]), X(solid[i + 2]), Z(solid[i + 3])], i);
    }
    const mesh = (g, m, cast = true) => { const o = new T.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; group.add(o); return o; };

    // walls by material, with their dark tops; columns the same in grey
    for (const [tint, s] of Object.entries(wallsByTint)) mesh(faces(s, X, Z, 0, wallH), new T.MeshStandardMaterial({ color: Number(tint), vertexColors: true, roughness: 0.88, metalness: 0, side: T.DoubleSide, envMapIntensity: 0.15 }));
    const capMat = new T.MeshBasicMaterial({ color: 0x232b36, side: T.DoubleSide });
    if (buckets.wall?.length) mesh(caps(buckets.wall, X, Z, wallH + 0.002), capMat, false);
    if (buckets.column?.length) { mesh(faces(buckets.column, X, Z, 0, wallH), new T.MeshStandardMaterial({ color: 0xa3acb7, vertexColors: true, roughness: 0.8, side: T.DoubleSide })); mesh(caps(buckets.column, X, Z, wallH + 0.002), capMat.clone(), false); }
    const edge = new T.LineBasicMaterial({ color: 0x3a4452, transparent: true, opacity: 0.55 });
    if (buckets.wall?.length) group.add(new T.LineSegments(outline(buckets.wall, X, Z, wallH + 0.004), edge));
    if (buckets.glass?.length) {
      mesh(faces(buckets.glass, X, Z, 0, wallH, 1), new T.MeshStandardMaterial({ color: 0xa8d3f3, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.4 }), false);
      group.add(new T.LineSegments(outline(buckets.glass, X, Z, wallH), new T.LineBasicMaterial({ color: 0x4f8fc7 })));
    }
    // furniture and equipment as low white blocks (or flat when the height is 0)
    if (buckets.furniture?.length) {
      if (furnH > 0.01) mesh(faces(buckets.furniture, X, Z, 0, furnH, 0.86), new T.MeshStandardMaterial({ color: 0xfbfcfd, vertexColors: true, roughness: 0.9, side: T.DoubleSide, envMapIntensity: 0.12 }));
      group.add(new T.LineSegments(outline(buckets.furniture, X, Z, Math.max(0.012, furnH + 0.002)), new T.LineBasicMaterial({ color: 0x8693a4, transparent: true, opacity: 0.8 })));
    }
    for (const [r, y, c] of [['floor', 0.006, 0xa7b2bf], ['door', 0.02, 0xb4733a]]) if (buckets[r]?.length) group.add(new T.LineSegments(outline(buckets[r], X, Z, y), new T.LineBasicMaterial({ color: c })));
    // floor: tiled vinyl on a slab
    const fw = box.w + 4, fd = box.h + 4;
    const ft = tile.clone(); ft.needsUpdate = true; ft.repeat.set(fw / 1.2, fd / 1.2);
    const floor = mesh(new T.PlaneGeometry(fw, fd), new T.MeshStandardMaterial({ map: ft, roughness: 0.72, envMapIntensity: 0.06 }), false);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0;
    mesh(new T.BoxGeometry(fw + 0.6, 0.35, fd + 0.6), new T.MeshStandardMaterial({ color: 0xc9d1db, roughness: 0.9 }), false).position.y = -0.18;
    // sun and its shadow cover the building
    const D = size * 1.4;
    sun.position.set(size * 0.55, D * 0.75, size * 0.42); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -size * 0.6, right: size * 0.6, top: size * 0.6, bottom: -size * 0.6, near: 1, far: D * 3 });
    sun.shadow.camera.updateProjectionMatrix(); renderer.shadowMap.needsUpdate = true;
    // room names (texts with words, not numbers or dimensions), colour-coded by kind
    if (showLabels) for (const t of plan.texts) {
      if (!inA(t.x, t.y) || !/[A-Za-z]{3,}/.test(t.t)) continue;
      const lines = t.t.split('\n').filter(Boolean).slice(0, 2);
      const el = h(`div.p3-label.k-${KIND(t.t)}`, h('b', lines[0]), lines[1] ? h('span', lines[1]) : null);
      labelsLayer.append(el);
      labels.push({ el, v: new T.Vector3(X(t.x + (t.w || 0) / 2), 0.15, Z(t.y)), t, room: ROOM_RE.test(t.t) });
    }
    labels.sort((a, b) => Number(b.room) - Number(a.room));
    drawSide();
  };

  let anim = null;
  const fly = (pos, target, ms = 950) => { anim = { p0: camera.position.clone(), t0: controls.target.clone(), p: pos, t: target, start: performance.now(), ms }; };
  const fitDist = () => (Math.max(box.h, box.w / Math.max(0.3, camera.aspect)) / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.08;
  const hero = () => {
    const long = box.w >= box.h, tall = camera.aspect < 1;
    if (tall) { const d = (Math.max(box.w, box.h) / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 0.75; return long ? new T.Vector3(-d * 0.62, d * 0.52, d * 0.18) : new T.Vector3(d * 0.18, d * 0.52, d * 0.62); }
    const d = fitDist() * 0.68; return long ? new T.Vector3(-d * 0.3, d * 0.48, d * 0.8) : new T.Vector3(d * 0.6, d * 0.5, d * 0.5);
  };
  const views = {
    top: () => fly(new T.Vector3(0, fitDist(), 0.01), new T.Vector3(0, 0, 0)),
    persp: () => fly(hero(), new T.Vector3(0, 0, 0)),
  };
  // distance from (ox, oz) along (dx, dz) to the nearest solid wall
  const rayDist = (ox, oz, dx, dz, max) => {
    let best = max;
    for (let i = 0; i < occ.length; i += 4) {
      const ax = occ[i], az = occ[i + 1], ex = occ[i + 2] - ax, ez = occ[i + 3] - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  };
  const blocked = (x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz); return L > 0.2 && rayDist(x1, z1, dx / L, dz / L, L - 0.1) < L - 0.1; };
  const goTo = l => { current = l; fly(new T.Vector3(l.v.x + 7, 10, l.v.z + 10), new T.Vector3(l.v.x, 0, l.v.z), 1100); drawSide(); };
  const standIn = l => {
    let best = null;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), f = rayDist(l.v.x, l.v.z, dx, dz, 15); if (!best || f > best.f) best = { dx, dz, f }; }
    const back = Math.min(1.6, Math.max(0, rayDist(l.v.x, l.v.z, -best.dx, -best.dz, 4) - 0.35));
    const ex = l.v.x - best.dx * back, ez = l.v.z - best.dz * back;
    fly(new T.Vector3(ex, 1.6, ez), new T.Vector3(ex + best.dx * 3, 1.4, ez + best.dz * 3), 1300);
  };

  // side panel: views, rooms, heights, layers
  function drawSide() {
    const rooms = labels.filter(l => l.room);
    const roomSel = h('select', { onchange: e => { const l = rooms[Number(e.target.value)]; if (l) goTo(l); } }, h('option', { value: '' }, `Go to a room (${rooms.length})…`),
      rooms.map((l, i) => h('option', { value: i, ...(l === current ? { selected: true } : {}) }, l.t.t.split('\n')[0])));
    const num = (val, min, max, step, set) => h('input', { type: 'number', min, max, step, value: val, style: { width: '76px' }, onchange: e => { set(Math.max(min, Math.min(max, Number(e.target.value) || 0))); rebuild(); } });
    const layerRows = Object.entries(plan.layers).sort((a, b) => b[1].segs.length - a[1].segs.length).map(([lname, L]) => {
      const sel = h('select', { onchange: e => { roles[lname] = e.target.value; saveRoles(roles); rebuild(); } }, ROLES.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = roleOf(lname);
      return h('tr', h('td.p3-lname', { title: lname }, lname), h('td.num', Math.round(L.segs.length / 4)), h('td', sel));
    });
    side.replaceChildren(
      h('div.p3-box', h('b', 'View'), h('div.toolbar', h('button.btn.small', { onclick: views.persp }, '3D'), h('button.btn.small', { onclick: views.top }, 'Plan (top)'),
        h('label.p3-check', h('input', { type: 'checkbox', ...(showLabels ? { checked: true } : {}), onchange: e => { showLabels = e.target.checked; rebuild(); } }), ' Room names')),
        roomSel, current ? h('div.toolbar', { style: { marginTop: '6px' } }, h('button.btn.small.primary', { onclick: () => standIn(current) }, '👁 Stand inside'), h('button.btn.small', { onclick: () => goTo(current) }, 'Above the room')) : null),
      h('div.p3-box', h('b', 'Heights'), h('div.p3-row', h('span', 'Walls'), num(wallH, 1, 10, 0.1, v => { wallH = v; }), h('span', 'm')),
        h('div.p3-row', h('span', 'Furniture'), num(furnH, 0, 2, 0.1, v => { furnH = v; }), h('span', 'm (0 = flat)'))),
      plan.areas.length > 1 ? h('div.p3-box', h('b', 'Part of the sheet'), h('select', { onchange: e => { areaIdx = Number(e.target.value); current = null; rebuild(); views.persp(); } },
        plan.areas.map((a, i) => h('option', { value: i, ...(i === areaIdx ? { selected: true } : {}) }, `${i === 0 ? 'Main drawing' : 'Other area ' + i} · ${Math.round(a.x1 - a.x0)} × ${Math.round(a.y1 - a.y0)} m`)))) : null,
      h('div.p3-box', h('b', 'Layers'), h('p.muted', 'What each CAD layer is. Your choices are remembered for the next drawing.'),
        h('table.p3-layers', h('tbody', layerRows))));
  }

  const resize = () => { const w = stage.clientWidth, hh = stage.clientHeight; renderer.setSize(w, hh, false); camera.aspect = w / Math.max(1, hh); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(stage);
  rebuild(); resize();
  camera.position.copy(hero()); controls.target.set(0, 0, 0);
  const v = new T.Vector3();
  const loop = now => {
    if (!stage.isConnected) { ro.disconnect(); renderer.dispose(); return; }
    requestAnimationFrame(loop);
    if (anim) { const k = Math.min(1, (now - anim.start) / anim.ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; camera.position.lerpVectors(anim.p0, anim.p, e); controls.target.lerpVectors(anim.t0, anim.t, e); if (k >= 1) anim = null; }
    controls.update(); renderer.render(scene, camera);
    // labels never overlap: room names are placed first, the rest only where there is space
    const W = stage.clientWidth, Hh = stage.clientHeight, placed = [];
    for (const l of labels) {
      v.copy(l.v).project(camera);
      let on = v.z < 1 && v.x > -1.02 && v.x < 1.02 && v.y > -1.02 && v.y < 1.02;
      if (on && camera.position.y < 4) on = Math.hypot(l.v.x - camera.position.x, l.v.z - camera.position.z) < 30 && !blocked(camera.position.x, camera.position.z, l.v.x, l.v.z);
      if (on) {
        const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * Hh, w = (l.w ||= l.el.offsetWidth || 90) / 2 + 3, hh = (l.hgt ||= l.el.offsetHeight || 28) / 2 + 2;
        on = !placed.some(p => x - w < p[2] && x + w > p[0] && y - hh < p[3] && y + hh > p[1]);
        if (on) { placed.push([x - w, y - hh, x + w, y + hh]); l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; }
      }
      l.el.style.display = on ? '' : 'none';
    }
  };
  requestAnimationFrame(loop);
  toast(`${plan.segments.toLocaleString()} lines · ${labels.length} labels`);
}
