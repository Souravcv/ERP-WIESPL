// 🧊 A CAD floor plan (DWG / DXF attached to any record) shown in 3D like an architect's model: solid walls with
// dark section-cut tops, glass, raised furniture, soft shadows and colour-coded room names.
// The DWG is read once in a Web Worker (plan-worker.js); the result is kept on the server so it reopens instantly.
import { h, api, toast, fail } from '../ui.js';
import { guessRole } from '../plan-extract.js';
import { roomSize, isOt, openOtStudio, finishText, quantitiesDialog } from './plan3d-extras.js';
import { findRoom, highlightMeshes, otMark, disposeGroup, DEFAULT_FINISH, BRIEF_NAMES } from './plan3d-rooms.js';
import { makeFitKit, fitOtRoom, restyle, mergeStatic } from './plan3d-otfit.js';
import { createTour, corridorWidth } from './plan3d-tour.js';
import { createFilm } from './plan3d-film.js';

const ROLES = [['wall', 'Wall'], ['glass', 'Glass'], ['column', 'Column'], ['door', 'Door'], ['furniture', 'Furniture / fittings'], ['floor', 'Lines on floor'], ['hide', 'Hide']];
const COLOR = { wall: 0xe9edf2, glass: 0x9fd0f2, column: 0x707b8c, door: 0x9a5b22, furniture: 0x52627a, floor: 0x9aa7b6 };
const ROLE_KEY = 'plan3d-roles';
const ROOM_RE = /THEAT|\bOT\b|CORRIDOR|STORE|ROOM|ICU|NICU|WARD|RECOVERY|PRE-?OP|POST-?OP|SCRUB|CSSD|LOBBY|TOILET|STAIR|LIFT|STATION|AREA|SHAFT|CATH|LAB|PANTRY|OFFICE/i;
const loadRoles = () => { try { return JSON.parse(localStorage.getItem(ROLE_KEY) || '{}'); } catch { return {}; } };
const saveRoles = r => { try { localStorage.setItem(ROLE_KEY, JSON.stringify(r)); } catch { /* ignore */ } };

let three = null;
function loadThree() {
  if (window.THREE?.OrbitControls && window.THREE.BufferGeometryUtils) return Promise.resolve();
  const s = src => new Promise((ok, bad) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => bad(new Error('Could not load the 3D library (internet needed)')); document.head.append(el); });
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/';
  three ||= (async () => {
    if (!window.THREE) await s(CDN + 'build/three.min.js');
    if (!window.THREE.OrbitControls) await s(CDN + 'examples/js/controls/OrbitControls.js');
    if (!window.THREE.BufferGeometryUtils) await s(CDN + 'examples/js/utils/BufferGeometryUtils.js').catch(() => {}); // only makes it faster
  })().catch(e => { three = null; throw e; });
  return three;
}

// real full screen where the browser allows it, otherwise fill the window (e.g. iPhone Safari)
function toggleFull(el) {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (el.classList.contains('p3-full')) { el.classList.remove('p3-full'); el.onfullscreen?.(); return; }
  const fallback = () => { if (document.fullscreenElement !== el && !el.classList.contains('p3-full')) { el.classList.add('p3-full'); el.onfullscreen?.(); } };
  if (!el.requestFullscreen) return fallback();
  el.requestFullscreen().catch(fallback);
  setTimeout(fallback, 500); // some embedded browsers neither grant nor refuse
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
  const wrap = h('div.p3-wrap', stage, side);
  // full screen: the 3D and its side panel fill the screen (Esc or the button again to leave)
  const fsBtn = h('button.btn', { type: 'button', title: 'Full screen (Esc to leave)', onclick: () => toggleFull(wrap) }, '⛶ Full screen');
  const fsCorner = h('button.p3-fs', { type: 'button', title: 'Full screen (Esc to leave)', 'aria-label': 'Full screen', onclick: () => toggleFull(wrap) }, '⛶');
  stage.append(fsCorner);
  const onFs = () => { const on = document.fullscreenElement === wrap || wrap.classList.contains('p3-full'); fsBtn.textContent = on ? '✕ Exit full screen' : '⛶ Full screen'; fsCorner.textContent = on ? '✕' : '⛶'; };
  document.addEventListener('fullscreenchange', onFs); wrap.onfullscreen = onFs;
  const onKey = e => { if (!wrap.isConnected) return document.removeEventListener('keydown', onKey); if (e.key === 'Escape' && wrap.classList.contains('p3-full') && !wrap.querySelector('.p3-touring')) toggleFull(wrap); };
  document.addEventListener('keydown', onKey);
  root.replaceChildren(
    h('div.page-head', h('h1', `🧊 ${name}`), h('div.actions', h('button.btn', { onclick: () => history.back() }, '‹ Back'), fsBtn, h('a.btn', { href: `/api/files/${id}` }, '⬇ Download drawing'))),
    wrap);

  let plan;
  try {
    await loadThree();
    status.textContent = 'Preparing the drawing…';
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
  const [meta, saved] = await Promise.all([api(`/files/${id}/meta`).catch(() => null), api(`/files/${id}/finishes`).catch(() => null)]);
  build(stage, side, plan, meta, saved?.finishes || {}, id, meta?.place || name.replace(/\.(dwg|dxf)$/i, '')); // the hospital's name when the form has it
}

// premium look: solid walls with dark section-cut tops, soft shadows, studio light, tiled floor, raised furniture
const TINT = name => (/NICOMAC|PANEL|HPL|CLEAN ROOM/i.test(name) ? 0xdde6ef : /PARTI/i.test(name) ? 0xf0f2f5 : 0xf5f1ea);
// the client film's finishes: matte KLEENCLAD walls, antistatic vinyl, the hermetic sliding door
const FILM_FINISH = { wall: 'kleenclad', floor_type: 'conductive', floor_main: 'Light grey', floor_border: 'Navy blue', picture: 'lake' };
// what the client film's OT has: each can be left out; the film shows and the voice tells only what is there
const FILM_PARTS = [['picture', 'Picture on the glass wall'], ['frontStore', 'Storage in the glass wall'], ['store', 'Storage on the side wall'], ['panel', 'Surgeon’s control panel · Digital OR'],
  ['xray', 'X-ray viewer'], ['board', 'Writing board'], ['risers', 'Return-air risers (corners)'], ['pendants', 'Surgeon’s and anaesthesia pendants'], ['winFilm', 'Window privacy film shown'], ['display', 'Digital OR display at the entrance']];
const loadFilmParts = () => { try { return JSON.parse(localStorage.getItem('p3-filmparts') || '{}') || {}; } catch { return {}; } };
const KIND = t => (/THEAT|\bOT\b|OPERATION|CATH|PROCEDURE/i.test(t) ? 'ot' : /CORRIDOR|LOBBY|PASSAGE/i.test(t) ? 'cor' : /STORE|STORAGE|SUPPLY/i.test(t) ? 'store'
  : /SHAFT|LIFT|STAIR|ELEVATOR|AHU/i.test(t) ? 'shaft' : /TOILET|WC|WASH|SCRUB|SINK/i.test(t) ? 'wet' : 'room');

function build(stage, side, plan, meta, finishes, fileId, title) {
  const T = window.THREE;
  const roles = loadRoles();
  const roleOf = l => roles[l] || guessRole(l);
  const small = Math.min(stage.clientWidth, stage.clientHeight) < 500 || /Mobi|Android/i.test(navigator.userAgent);
  let areaIdx = 0, wallH = 3, furnH = 0.6, showLabels = true, current = null, showFitted = true, smartFilm = false, otherDoors = false;

  stage.replaceChildren(...stage.querySelectorAll('.p3-fs'));
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(small ? 1.75 : 2, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // the building does not move: shadows are drawn once per rebuild
  stage.append(renderer.domElement);
  stage.append(h('div.p3-legend', h('span.b'), 'Operation theatre: tap to choose its finishes', h('span.g'), 'Finishes chosen'));
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
  // the OTs of the drawing: tap one to highlight it and open it in its own 3D
  const hlLayer = new T.Group(), markLayer = new T.Group(); scene.add(hlLayer, markLayer);
  // every OT fitted out where it stands; its ceiling is a layer of its own, shown only from inside
  const fitLayer = new T.Group(), ceilLayer = new T.Group(), kit = makeFitKit(T); scene.add(fitLayer, ceilLayer);
  const walkLight = new T.AmbientLight(0xffffff, 0); scene.add(walkLight);
  let walkCeil = null; // the building's ceiling while walking, so there is no sky indoors
  let ots = [], selected = null, hoverOt = null, saveTimer = null;
  const hoverGlow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0.16, depthWrite: false }));
  hoverGlow.rotation.x = -Math.PI / 2; hoverGlow.position.y = 0.025; hoverGlow.visible = false; scene.add(hoverGlow);
  let labels = [], center = [0, 0], size = 50, box = { w: 50, h: 50 }, occ = new Float32Array(0); // occ: solid walls in scene x / z, for views from inside
  let occWalk = new Float32Array(0), occWalkDrawn = occWalk; // what a person walking cannot pass: walls, columns and glass (and the OTs' closed-off openings)
  let corridors = []; // corridor / passage names in the drawing, for the explainer tour
  let fx = {}; // the drawing's doors, plenums and return-air grilles in scene x / z, so each OT is fitted as drawn
  let filmHero = null; // the OT the client film is about: fitted round its main door
  const filmParts = loadFilmParts();

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
      const glass = buckets.glass || [];
      occWalk = new Float32Array(occ.length + glass.length); occWalk.set(occ);
      for (let i = 0; i < glass.length; i += 4) occWalk.set([X(glass[i]), Z(glass[i + 1]), X(glass[i + 2]), Z(glass[i + 3])], occ.length + i);
      occWalkDrawn = occWalk;
    }
    { // the fixtures as drawn: the door layer, and layers named plenum / grille
      const toScene = segs => { const o = new Float32Array(segs.length); for (let i = 0; i < segs.length; i += 4) o.set([X(segs[i]), Z(segs[i + 1]), X(segs[i + 2]), Z(segs[i + 3])], i); return o; };
      const named = re => { const out = []; for (const [lname, L] of Object.entries(plan.layers)) if (re.test(lname) && roleOf(lname) !== 'hide') { const q = L.segs; for (let i = 0; i < q.length; i += 4) if (inA(q[i], q[i + 1])) out.push(q[i], q[i + 1], q[i + 2], q[i + 3]); } return out; };
      fx = { walls: occ, furniture: toScene(buckets.furniture || []), door: toScene(buckets.door || []), plenum: toScene(named(/PLENUM|LAF\b|LAMINAR/i)), grille: toScene(named(/GRILLE|RETURN AIR|RISER/i)),
        // the door / window numbers written in the drawing (D, D2, W10, V1 …): an opening tagged W is a window
        tags: plan.texts.filter(t => inA(t.x, t.y) && /^\s*(D|W|V|DW)\s*-?\s*\d{0,3}\s*[A-Z]?\s*$/i.test(t.t)).map(t => ({ t: t.t.trim().toUpperCase(), x: X(t.x + (t.w || 0) / 2), z: Z(t.y) })) };
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
    if (buckets.floor?.length) group.add(new T.LineSegments(outline(buckets.floor, X, Z, 0.006), new T.LineBasicMaterial({ color: 0xa7b2bf })));
    // floor: tiled vinyl on a slab
    const fw = box.w + 4, fd = box.h + 4;
    const ft = tile.clone(); ft.needsUpdate = true; ft.repeat.set(fw / 1.2, fd / 1.2);
    const floor = mesh(new T.PlaneGeometry(fw, fd), new T.MeshStandardMaterial({ map: ft, roughness: 0.72, envMapIntensity: 0.06 }), false);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0;
    mesh(new T.BoxGeometry(fw + 0.6, 0.35, fd + 0.6), new T.MeshStandardMaterial({ color: 0xc9d1db, roughness: 0.9 }), false).position.y = -0.18;
    walkCeil = new T.Mesh(new T.PlaneGeometry(fw, fd), new T.MeshStandardMaterial({ color: 0xeef1f5, roughness: 0.9 }));
    walkCeil.rotation.x = Math.PI / 2; walkCeil.position.y = wallH + 0.03; walkCeil.visible = walk.on; group.add(walkCeil);
    // sun and its shadow cover the building
    const D = size * 1.4;
    sun.position.set(size * 0.55, D * 0.75, size * 0.42); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -size * 0.6, right: size * 0.6, top: size * 0.6, bottom: -size * 0.6, near: 1, far: D * 3 });
    sun.shadow.camera.updateProjectionMatrix(); renderer.shadowMap.needsUpdate = true;
    // room names (texts with words, not numbers or dimensions), colour-coded by kind
    if (showLabels) for (const t of plan.texts) {
      if (!inA(t.x, t.y) || !/[A-Za-z]{3,}/.test(t.t)) continue;
      const lines = t.t.split('\n').filter(Boolean).slice(0, 2);
      const ot = isOt(lines[0]);
      const open = () => { const o = ots.find(x => x.t === t); if (o) selectOt(o); };
      const el = h(`div.p3-label.k-${KIND(t.t)}`, h('b', lines[0]), lines[1] ? h('span', lines[1]) : null, ot ? h('button.p3-go3d', { type: 'button', title: 'Open this OT in 3D', onclick: e => { e.stopPropagation(); open(); } }, '🧊 3D') : null);
      labelsLayer.append(el);
      labels.push({ el, v: new T.Vector3(X(t.x + (t.w || 0) / 2), 0.15, Z(t.y)), t, ot, room: ROOM_RE.test(t.t), size: roomSize(t.t) });
      if (ot) { el.classList.add('pick'); el.onclick = open; }
    }
    labels.sort((a, b) => Number(b.ot) - Number(a.ot) || Number(b.room) - Number(a.room));
    corridors = plan.texts.filter(t => inA(t.x, t.y) && KIND(t.t) === 'cor' && !/DUCT|DRAWING|DWG|DETAIL/i.test(t.t))
      .map(t => ({ name: t.t.split('\n')[0].trim(), x: X(t.x + (t.w || 0) / 2), z: Z(t.y), width: corridorWidth(t.t) }));
    fx.passages = corridors; // the OT's main door is the one from the passage
    { // the outline of every OT, from the walls, glass and doors around its label
      const edges = [...(buckets.wall || []), ...(buckets.column || []), ...(buckets.glass || []), ...(buckets.door || [])];
      const sc = new Float32Array(edges.length);
      for (let i = 0; i < edges.length; i += 4) sc.set([X(edges[i]), Z(edges[i + 1]), X(edges[i + 2]), Z(edges[i + 3])], i);
      const was = selected?.key; ots = [];
      for (const t of plan.texts) {
        const first = t.t.split('\n').filter(Boolean)[0] || '';
        if (!inA(t.x, t.y) || !/[A-Za-z]{2,}/.test(first) || !isOt(first)) continue;
        const key = `${Math.round(t.x * 10)}_${Math.round(t.y * 10)}`;
        if (ots.some(o => o.key === key)) continue;
        // the size is in the label, or in its own text just under it ("22'-0"X19'-1½"")
        const nearSize = () => { const q = plan.texts.filter(u => u !== t && Math.abs(u.x - t.x) < 2.5 && Math.abs(u.y - t.y) < 1.2).map(u => ({ u, s: roomSize(u.t) })).filter(v => v.s).sort((a, b) => Math.hypot(a.u.x - t.x, a.u.y - t.y) - Math.hypot(b.u.x - t.x, b.u.y - t.y))[0]; return q ? { ...q.s, name: first.trim() } : null; };
        const sz = roomSize(t.t) || nearSize(), cx = X(t.x + (t.w || 0) / 2), cz = Z(t.y), hh = t.h || 0.25;
        const base = findRoom(sc, [[cx, cz], [cx, cz + hh * 3], [cx, cz - hh * 3]], sz ? [sz.w, sz.d] : null);
        const o = { key, t, size: sz, name: sz?.name || first.trim(), base, walls: base.walls, v: new T.Vector3() };
        placeOt(o); ots.push(o);
      }
      selected = ots.find(o => o.key === was) || null;
    }
    drawFitted(); // before the furniture: the fit-out says where its scrub station replaces the drawn basins
    { // the drawing's door lines, except inside a fitted OT (it shows its own doors)
      let dl = buckets.door || [];
      if (showFitted && ots.length && dl.length) { const inOt = (x, z) => ots.some(o => x > o.x0 - 0.25 && x < o.x1 + 0.25 && z > o.z0 - 0.25 && z < o.z1 + 0.25); const keep = []; for (let i = 0; i < dl.length; i += 4) if (!(inOt(X(dl[i]), Z(dl[i + 1])) && inOt(X(dl[i + 2]), Z(dl[i + 3])))) keep.push(dl[i], dl[i + 1], dl[i + 2], dl[i + 3]); dl = keep; }
      if (dl.length) group.add(new T.LineSegments(outline(dl, X, Z, 0.02), new T.LineBasicMaterial({ color: 0xb4733a })));
    }
    // furniture and equipment as low white blocks (or flat when the height is 0); inside a fitted OT the WIESPL fit-out replaces it
    let furn = buckets.furniture || [];
    if (showFitted && ots.length && furn.length) {
      const scrubs = ots.map(o => o.fit?.spots?.scrub).filter(Boolean);
      const inOt = (x, z) => ots.some(o => x > o.x0 - 0.05 && x < o.x1 + 0.05 && z > o.z0 - 0.05 && z < o.z1 + 0.05) || scrubs.some(b => x > b.x0 - 0.05 && x < b.x1 + 0.05 && z > b.z0 - 0.05 && z < b.z1 + 0.05);
      const keep = [];
      for (let i = 0; i < furn.length; i += 4) if (!(inOt(X(furn[i]), Z(furn[i + 1])) && inOt(X(furn[i + 2]), Z(furn[i + 3])))) keep.push(furn[i], furn[i + 1], furn[i + 2], furn[i + 3]);
      furn = keep;
    }
    if (furn.length) {
      if (furnH > 0.01) mesh(faces(furn, X, Z, 0, furnH, 0.86), new T.MeshStandardMaterial({ color: 0xfbfcfd, vertexColors: true, roughness: 0.9, side: T.DoubleSide, envMapIntensity: 0.12 }));
      group.add(new T.LineSegments(outline(furn, X, Z, Math.max(0.012, furnH + 0.002)), new T.LineBasicMaterial({ color: 0x8693a4, transparent: true, opacity: 0.8 })));
    }
    drawOtMarks(); drawHighlight();
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
  // distance from (ox, oz) along (dx, dz) to the nearest solid wall (or the nearest of the segments given)
  const rayDist = (ox, oz, dx, dz, max, segs = occ) => {
    let best = max;
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i], az = segs[i + 1], ex = segs[i + 2] - ax, ez = segs[i + 3] - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  };
  const blocked = (x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz); return L > 0.2 && rayDist(x1, z1, dx / L, dz / L, L - 0.1) < L - 0.1; };
  const goTo = l => { if (walk.on) return startWalk(spotAt(l.v.x, l.v.z)); current = l; fly(new T.Vector3(l.v.x + 7, 10, l.v.z + 10), new T.Vector3(l.v.x, 0, l.v.z), 1100); drawSide(); };
  // where to stand near a point to see the most: backed up against a wall, facing the longest free view
  const spotAt = (x, z) => {
    let best = null;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), f = rayDist(x, z, dx, dz, 15); if (!best || f > best.f) best = { dx, dz, f }; }
    const back = Math.min(1.6, Math.max(0, rayDist(x, z, -best.dx, -best.dz, 4) - 0.35));
    return { x: x - best.dx * back, z: z - best.dz * back, dx: best.dx, dz: best.dz };
  };
  // inside an OT: near one end of its long side, looking at the table
  const spotInOt = o => {
    const w = o.x1 - o.x0, d = o.z1 - o.z0, cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    const x = w >= d ? o.x0 + Math.min(1.2, w * 0.2) : cx + d * 0.08, z = w >= d ? cz + d * 0.08 : o.z0 + Math.min(1.2, d * 0.2);
    const L = Math.hypot(cx - x, cz - z) || 1;
    return { x, z, dx: (cx - x) / L, dz: (cz - z) / L };
  };
  const standIn = l => {
    const s = spotAt(l.v.x, l.v.z);
    fly(new T.Vector3(s.x, 1.6, s.z), new T.Vector3(s.x + s.dx * 3, 1.4, s.z + s.dz * 3), 1300);
  };

  // ---------------------------------------------------------------- walk through, at eye height
  // Keys W A S D / arrows (← → turn), drag to look, tap the floor to walk there; on a phone the stick moves.
  const EYE = 1.6, walk = { on: false, yaw: 0, pitch: -0.08, keys: new Set(), joy: [0, 0], target: null, last: 0 };
  const knob = h('span'), stick = h('div.p3-joy.hidden', knob);
  const walkBar = h('div.p3-walkbar.hidden',
    h('span.p3-walkhint', 'W A S D or arrows to walk · drag to look · tap the floor to go there'),
    h('button.btn.small', { type: 'button', onclick: () => stopWalk() }, '✕ Leave walk'));
  stage.append(stick, walkBar);
  {
    let id = null, ox = 0, oy = 0;
    const R = 46;
    stick.addEventListener('pointerdown', e => { e.stopPropagation(); id = e.pointerId; stick.setPointerCapture(id); const r = stick.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy; const L = Math.hypot(dx, dy); if (L > R) { dx *= R / L; dy *= R / L; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`; walk.joy = [dx / R, -dy / R]; walk.target = null;
    });
    const end = e => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; walk.joy = [0, 0]; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  }
  const typing = e => /INPUT|SELECT|TEXTAREA/.test(e.target?.tagName || '');
  const onTourKey = e => { if (e.key === 'Escape' && tour.on && stage.isConnected) { e.preventDefault(); tour.stop(true); } };
  document.addEventListener('keydown', onTourKey);
  const onWalkKey = e => {
    if (!walk.on || !stage.isConnected || typing(e)) return;
    if (e.key === 'Escape' && e.type === 'keydown') { stopWalk(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(k)) return;
    e.preventDefault(); walk.target = null;
    if (e.type === 'keydown') walk.keys.add(k); else walk.keys.delete(k);
  };
  document.addEventListener('keydown', onWalkKey); document.addEventListener('keyup', onWalkKey);
  // indoors: soft room light and little sun (soft: the tour, which brings its own lights); marks: the OT rails
  function setIndoor(on, { soft = false, marks = !on, sun: sunAt, keepShadow = false } = {}) {
    if (walkCeil) walkCeil.visible = on;
    walkLight.intensity = on ? (soft ? 0.2 : 0.42) : 0; sun.intensity = sunAt ?? (on ? (soft ? 0.12 : 0.45) : 1.55);
    sun.castShadow = keepShadow || !(on && soft); // the tour lights the room itself: the dim sun need not redraw its shadows
    markLayer.visible = hlLayer.visible = marks; if (on) hoverGlow.visible = false;
  }
  function startWalk(s) {
    s ||= selected ? spotInOt(selected) : current ? spotAt(current.v.x, current.v.z) : ots[0] ? spotInOt(ots[0]) : spotAt(0, 0);
    anim = null; walk.target = null; walk.keys.clear();
    if (!walk.on) { walk.on = true; controls.enabled = false; camera.rotation.order = 'YXZ'; stage.classList.add('p3-walking'); stick.classList.remove('hidden'); walkBar.classList.remove('hidden'); }
    camera.position.set(s.x, EYE, s.z);
    walk.yaw = Math.atan2(-s.dx, -s.dz); walk.pitch = -0.08;
    setIndoor(true);
    drawSide();
  }
  function stopWalk(quiet) {
    if (!walk.on) return;
    walk.on = false; walk.keys.clear(); walk.target = null; controls.enabled = true; camera.rotation.order = 'XYZ';
    stage.classList.remove('p3-walking'); stick.classList.add('hidden'); walkBar.classList.add('hidden');
    setIndoor(false);
    const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), p = camera.position;
    controls.target.set(p.x + fx * 4, 0, p.z + fz * 4);
    if (!quiet) fly(new T.Vector3(p.x - fx * 9, 13, p.z - fz * 9 + 0.01), new T.Vector3(p.x + fx * 2, 0, p.z + fz * 2), 1100);
    drawSide();
  }
  // one step: slide along a wall rather than stop dead
  const tryMove = (dx, dz) => {
    const p = camera.position, L = Math.hypot(dx, dz);
    if (L < 1e-6) return false;
    const free = (mx, mz) => { const l = Math.hypot(mx, mz); return l < 1e-6 || rayDist(p.x, p.z, mx / l, mz / l, l + 0.35, occWalk) > l + 0.3; };
    if (free(dx, dz)) { p.x += dx; p.z += dz; return true; }
    if (Math.abs(dx) > 1e-6 && free(dx, 0)) { p.x += dx; return true; }
    if (Math.abs(dz) > 1e-6 && free(0, dz)) { p.z += dz; return true; }
    return false;
  };
  function walkStep(now) {
    const dt = Math.min(0.1, (now - (walk.last || now)) / 1000); walk.last = now;
    const K = walk.keys, run = K.has('Shift') ? 2.2 : 1;
    if (K.has('ArrowLeft')) walk.yaw += 1.6 * dt;
    if (K.has('ArrowRight')) walk.yaw -= 1.6 * dt;
    const f = (K.has('w') || K.has('ArrowUp') ? 1 : 0) - (K.has('s') || K.has('ArrowDown') ? 1 : 0) + walk.joy[1];
    const st = (K.has('d') ? 1 : 0) - (K.has('a') ? 1 : 0) + walk.joy[0];
    const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
    const sp = 1.5 * run * dt;
    if (f || st) tryMove((fx * f + rx * st) * sp, (fz * f + rz * st) * sp);
    else if (walk.target) { // walking to the point tapped, turning towards it on the way
      const p = camera.position, dx = walk.target.x - p.x, dz = walk.target.z - p.z, L = Math.hypot(dx, dz);
      if (L < 0.25) walk.target = null;
      else {
        const want = Math.atan2(-dx, -dz); let turn = want - walk.yaw; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        walk.yaw += turn * Math.min(1, dt * 5);
        if (!tryMove((dx / L) * Math.min(L, sp), (dz / L) * Math.min(L, sp))) walk.target = null;
      }
    }
    camera.position.y = EYE;
    camera.rotation.set(walk.pitch, walk.yaw, 0);
  }

  // ---------------------------------------------------------------- 🎬 explainer tour (plan3d-tour.js)
  let touring = false, filmHold = false;
  const tourCtx = {
    T, scene, camera, renderer, stage, rayDist, title, resize: () => resize(),
    walls: () => occWalk, ots: () => ots, selected: () => selected, corridors: () => corridors,
    finishOf: o => finishOf(o), finishText, wallH: () => wallH, indoor: (on, opts) => setIndoor(on, opts), shadows: () => { renderer.shadowMap.needsUpdate = true; },
    preview: (o, patch) => { if (o.fit) restyle(kit, o.fit.group, patch ? { ...finishOf(o), ...patch } : finishOf(o)); },
    fixtures: () => fx, box: () => ({ ...box, size }),
    layers: () => ({ group, fitLayer, ceilLayer, markLayer, hlLayer }),
    // the client film: its OT fitted round the main door in the film's finishes (null puts everything back)
    film: o => { filmHero = o || null; kit.filmLook(!!o); drawFitted(); return o?.fit || null; },
    ambient: k => { walkLight.intensity = k; },
    smartFilm: on => kit.setSmartFilm(on == null ? smartFilm : on),
    hold: on => { filmHold = !!on; if (!on) resize(); }, // an offline render draws the frames itself
    draw: () => { ceilLayer.visible = camera.position.y < Math.min(wallH, 3) - 0.02; renderer.render(scene, camera); },
    focus: o => { for (const x of ots) if (x.fit) { const near = !o || Math.hypot(x.v.x - o.v.x, x.v.z - o.v.z) < 16; x.fit.group.visible = x.fit.ceiling.visible = near; } renderer.shadowMap.needsUpdate = true; },
    done: (o, early) => {
      touring = false; filmHold = false; if (filmHero) { filmHero = null; kit.filmLook(false); drawFitted(); } for (const L of [group, fitLayer, markLayer]) L.scale.y = 1; setIndoor(false); controls.enabled = true; labelsLayer.style.display = ''; for (const x of ots) if (x.fit) x.fit.group.visible = x.fit.ceiling.visible = true;
      const span = Math.max(o.x1 - o.x0, o.z1 - o.z0);
      controls.target.set(o.v.x, 0, o.v.z);
      if (early) { camera.position.set(o.v.x + span * 0.6, span * 1.15 + wallH + 2, o.v.z + span * 0.95); }
      drawSide();
    },
  };
  const tour = createTour(tourCtx), film = createFilm(tourCtx, tour.parts);
  stage.p3debug = () => ({ ots, fx, selected, film: o => { filmHero = o; kit.filmLook(!!o); drawFitted(); }, select: o => { selected = o; }, startTour: (...a) => startTour(...a), T, camera, scene, renderer, setIndoor, layers: { group, fitLayer, ceilLayer, markLayer, hlLayer, labelsLayer },
    shot: (p, t, w = 1280, hh = 720, fov = 54) => { renderer.setPixelRatio(1); renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.fov = fov; camera.updateProjectionMatrix(); camera.rotation.order = 'XYZ'; camera.position.set(...p); camera.lookAt(...t); ceilLayer.visible = p[1] < Math.min(wallH, 3) - 0.02; renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.85); } }); // for checking from the console
  function startTour(record, asFilm = false, opts = {}) {
    if (touring || tour.on || film.on) return;
    if (walk.on) stopWalk(true);
    if (!showFitted) { showFitted = true; rebuild(); }
    touring = true; anim = null; controls.enabled = false; labelsLayer.style.display = 'none';
    (asFilm ? film : tour).start({ record, ...opts }).then(() => { drawSide(); if (record && !asFilm) toast('Recording: keep this tab open and in front. The video downloads when the tour ends.'); })
      .catch(e => { touring = false; setIndoor(false); controls.enabled = true; labelsLayer.style.display = ''; camera.rotation.order = 'XYZ'; drawSide(); fail(e); });
  }

  function placeOt(o) {
    const b = o.base;
    Object.assign(o, { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }); o.v.set((b.x0 + b.x1) / 2, 0.15, (b.z0 + b.z1) / 2);
  }
  const clearGroup = g => { for (const c of [...g.children]) { disposeGroup(c); g.remove(c); } };
  const hasFinish = o => !!finishes[o.key]?.floor_main;
  const finishOf = o => ({ ...DEFAULT_FINISH, ...finishes[o.key] });
  function drawOtMarks() { clearGroup(markLayer); for (const o of ots) markLayer.add(otMark(T, o, wallH, hasFinish(o), !showFitted)); }
  // the materials are shared by all OTs (kept in the kit): only the shapes are thrown away
  const dropShapes = g => { for (const c of [...g.children]) { c.traverse(o => o.geometry?.dispose?.()); g.remove(c); } };
  function drawFitted() {
    dropShapes(fitLayer); dropShapes(ceilLayer);
    for (const o of ots) o.fit = null;
    if (!showFitted) return;
    for (const o of ots) {
      if (filmHero && !o.walls && o !== filmHero) continue;
      const film = o === filmHero, f = film ? { ...finishOf(o), ...FILM_FINISH } : finishOf(o);
      const { group: g, ceiling, spots } = fitOtRoom(T, kit, o, f, wallH, rayDist, { fx, chosen: hasFinish(o) && !film, layout: film ? 'entry' : null, otherDoors, parts: film ? filmParts : null });
      mergeStatic(T, g); mergeStatic(T, ceiling); // a few meshes per OT instead of hundreds
      fitLayer.add(g); ceilLayer.add(ceiling); o.fit = { spots, group: g, ceiling };
    }
    // the openings closed off in the OTs are walls for a person walking (and for the tour and the film)
    const closed = ots.flatMap(o => o.fit?.spots?.closed || []);
    occWalk = new Float32Array(occWalkDrawn.length + closed.length * 4); occWalk.set(occWalkDrawn); closed.forEach((q, i) => occWalk.set(q, occWalkDrawn.length + i * 4));
    renderer.shadowMap.needsUpdate = true;
  }
  const finishesChanged = () => { saveSoon(); drawOtMarks(); drawFitted(); drawSide(); };
  function drawHighlight() { clearGroup(hlLayer); if (selected) hlLayer.add(highlightMeshes(T, selected, wallH)); }
  const canSave = () => !!meta?.canWrite;
  const canSend = () => meta?.entity === 'enquiries' && canSave();
  function saveSoon() {
    if (!canSave()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api(`/files/${fileId}/finishes`, { method: 'PUT', body: { finishes } }).catch(fail), 500);
  }
  const openStudio = o => openOtStudio({ name: o.name, w: o.size?.w || o.x1 - o.x0, d: o.size?.d || o.z1 - o.z0 }, finishOf(o), {
    canSave: canSave(),
    change: f => { finishes[o.key] = f; finishesChanged(); },
    all: f => { for (const x of ots) finishes[x.key] = { ...f }; finishesChanged(); toast(`Applied to all ${ots.length} OTs`); },
    send: canSend() ? sendChosen : null,
  }).catch(fail);
  // the name in the list shows where the OT is in the drawing; the 3D button opens it
  function showOt(o) {
    selected = o; current = labels.find(l => l.t === o.t) || o;
    if (walk.on) { drawHighlight(); return startWalk(spotInOt(o)); }
    const span = Math.max(o.x1 - o.x0, o.z1 - o.z0);
    fly(new T.Vector3(o.v.x + span * 0.6, span * 1.15 + wallH + 2, o.v.z + span * 0.95), new T.Vector3(o.v.x, 0, o.v.z), 1000);
    drawHighlight(); drawSide();
  }
  function selectOt(o) {
    selected = o; current = labels.find(l => l.t === o.t) || o;
    drawHighlight(); drawSide();
    openStudio(o);
  }
  async function sendChosen() {
    const count = {}, FT = 3.28084, rooms = [];
    for (const o of [...ots].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      count[o.name] = (count[o.name] || 0) + 1;
      if (!hasFinish(o)) continue;
      const f = finishes[o.key], w = o.size?.w || o.x1 - o.x0, d = o.size?.d || o.z1 - o.z0;
      rooms.push({ name: count[o.name] > 1 ? `${o.name} (${count[o.name]})` : o.name, length: w * FT, width: d * FT, height: wallH * FT, wall: BRIEF_NAMES.wall[f.wall], wall_colour: f.wall_colour, floor_type: BRIEF_NAMES.floor_type[f.floor_type], floor_main: f.floor_main, floor_border: f.floor_border, door: BRIEF_NAMES.door[f.door] });
    }
    if (!rooms.length) { toast('Choose the finishes of at least one OT first'); return; }
    const r = await api(`/enquiries/${meta.record_id}/brief-rooms`, { method: 'POST', body: { rooms } });
    toast(`Detailed form: ${r.added} OT(s) added, ${r.updated} updated`);
  }
  // the top of the side panel: every OT of the drawing with its 3D button, and what was chosen for it
  function finishBox() {
    const sorted = [...ots].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const row = o => {
      const on = o === selected, done = hasFinish(o);
      return h('div.p3-otrow' + (on ? '.on' : ''),
        h('div.p3-otline',
          h('button.p3-otname', { type: 'button', title: 'Show it in the drawing', onclick: () => showOt(o) }, done ? '✅ ' : '', h('b', o.name), h('small', `${(o.size?.w || o.x1 - o.x0).toFixed(1)} × ${(o.size?.d || o.z1 - o.z0).toFixed(1)} m`)),
          h('button.btn.small.p3-go', { type: 'button', title: 'Walk into this OT', 'aria-label': `Walk into ${o.name}`, onclick: () => { selected = o; drawHighlight(); startWalk(spotInOt(o)); } }, '🚶'),
          h('button.btn.small.primary.p3-go', { type: 'button', title: 'Choose its walls, floor and door', onclick: () => selectOt(o) }, '🧊 3D')),
        on && done ? h('ul.p3-finlist', finishText(finishes[o.key]).map(t => h('li', t))) : null,
        on && done && canSave() ? h('button.btn.small', { type: 'button', style: { marginTop: '6px' }, onclick: () => { delete finishes[o.key]; finishesChanged(); } }, 'Remove finishes') : null);
    };
    return h('div.p3-box.p3-pickbox',
      h('b', `🏥 Operation theatres (${ots.length})`),
      h('p.muted', ots.length ? 'Shown fitted out in the drawing (WIESPL standard until you choose). 🚶 walks into one; 🧊 3D chooses its walls, floor and door.' : 'No operation theatre labels found in this part of the drawing.'),
      ots.length ? h('div.p3-otlist', sorted.map(row)) : null,
      canSend() && ots.some(hasFinish) ? h('button.btn.small.p3-otbtn', { type: 'button', onclick: () => sendChosen().catch(fail) }, '➕ Send chosen OTs to the detailed form') : null);
  }

  async function openQuantities() {
    const A = plan.areas[areaIdx] || { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
    const seen = new Set(), rooms = [];
    for (const t of plan.texts) {
      if (t.x < A.x0 || t.x > A.x1 || t.y < A.y0 || t.y > A.y1) continue;
      const s = roomSize(t.t), key = s && s.name + s.w + s.d;
      if (s && !seen.has(key)) { seen.add(key); rooms.push(s); }
    }
    rooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const layers = Object.entries(plan.layers).map(([name, L]) => {
      const role = roleOf(name); if (!['wall', 'glass', 'column'].includes(role)) return null;
      let m = 0; const s = L.segs;
      for (let i = 0; i < s.length; i += 4) if (s[i] >= A.x0 && s[i] <= A.x1 && s[i + 1] >= A.y0 && s[i + 1] <= A.y1) m += Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]);
      return m > 0.5 ? { name, role, metres: m } : null;
    }).filter(Boolean).sort((a, b) => b.metres - a.metres);
    await quantitiesDialog({ rooms, layers, heightM: wallH, meta });
  }

  // side panel: views, rooms, heights, layers
  function drawSide() {
    const rooms = labels.filter(l => l.room);
    const roomSel = h('select', { onchange: e => { const l = rooms[Number(e.target.value)]; if (!l) return; const o = ots.find(x => x.t === l.t); if (o) selectOt(o); else { selected = null; drawHighlight(); goTo(l); } } }, h('option', { value: '' }, `Go to a room (${rooms.length})…`),
      rooms.map((l, i) => h('option', { value: i, ...(l === current ? { selected: true } : {}) }, l.t.t.split('\n')[0])));
    const num = (val, min, max, step, set) => h('input', { type: 'number', min, max, step, value: val, style: { width: '76px' }, onchange: e => { set(Math.max(min, Math.min(max, Number(e.target.value) || 0))); rebuild(); } });
    const layerRows = Object.entries(plan.layers).sort((a, b) => b[1].segs.length - a[1].segs.length).map(([lname, L]) => {
      const sel = h('select', { onchange: e => { roles[lname] = e.target.value; saveRoles(roles); rebuild(); } }, ROLES.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = roleOf(lname);
      return h('tr', h('td.p3-lname', { title: lname }, lname), h('td.num', Math.round(L.segs.length / 4)), h('td', sel));
    });
    side.replaceChildren(
      finishBox(),
      h('div.p3-box', h('b', 'View'),
        touring || tour.on
          ? h('div.toolbar', h('button.btn.small', { onclick: () => tour.stop(true) }, '✕ Stop tour'), h('span.muted', 'The explainer tour is playing.'))
          : walk.on
            ? h('div.toolbar', h('button.btn.small', { onclick: () => stopWalk() }, '✕ Leave walk'), h('span.muted', 'Pick a room below to go there.'))
            : h('div.toolbar', h('button.btn.small.primary', { onclick: () => startWalk() }, '🚶 Walk through'), h('button.btn.small', { onclick: views.persp }, '3D'), h('button.btn.small', { onclick: views.top }, 'Plan (top)')),
        touring || tour.on || !ots.length ? null : h('div.p3-tourbtns',
          h('button.btn.small.primary', { type: 'button', title: 'An automatic walk from the corridor into the OT, with a voice explaining each part', onclick: () => startTour(false) }, '🎬 Explainer tour'),
          h('button.btn.small', { type: 'button', title: 'Play the tour and save it as a video file', onclick: () => startTour(true) }, '⏺ Save tour as video'),
          h('button.btn.small', { type: 'button', title: 'Play the client film of this OT: from the drawing, through the passage, into the theatre', onclick: () => startTour(false, true) }, '🎞 Client film'),
          h('button.btn.small', { type: 'button', title: 'Make the client film as a 1080p MP4 (30 fps, voice and music): a few minutes', onclick: () => startTour(true, true, { quality: '1080p' }) }, '🎞 Save film (1080p, quick)'),
          h('button.btn.small', { type: 'button', title: 'Make the client film as a 4K MP4, and a 1080p copy. It takes a while: keep this tab open.', onclick: () => startTour(true, true, { quality: '4k' }) }, '🎞 Save 4K film'),
          h('p.muted', selected ? `Walks into ${selected.name}. Sound on.` : 'Walks from the corridor into the OT with the longest corridor outside. Tap an OT first to choose it. Sound on.')),
        h('div.toolbar', h('label.p3-check', h('input', { type: 'checkbox', ...(showLabels ? { checked: true } : {}), onchange: e => { showLabels = e.target.checked; rebuild(); } }), ' Room names'),
          h('label.p3-check', h('input', { type: 'checkbox', ...(showFitted ? { checked: true } : {}), onchange: e => { showFitted = e.target.checked; rebuild(); } }), ' Finished OTs'),
          h('label.p3-check', { title: 'Windows: electrostatic (switchable) film, clear when off, frosted for privacy when on' }, h('input', { type: 'checkbox', ...(smartFilm ? { checked: true } : {}), onchange: e => { smartFilm = e.target.checked; kit.setSmartFilm(smartFilm); } }), ' Window film on (frosted)'),
          h('label.p3-check', { title: 'Show the drawing’s other doors of each OT (e.g. into a lab). Off: only the main door, from the passage' }, h('input', { type: 'checkbox', ...(otherDoors ? { checked: true } : {}), onchange: e => { otherDoors = e.target.checked; rebuild(); } }), ' Other OT doors')),
        roomSel, current && !walk.on ? h('div.toolbar', { style: { marginTop: '6px' } }, h('button.btn.small.primary', { onclick: () => standIn(current) }, '👁 Stand inside'), h('button.btn.small', { onclick: () => goTo(current) }, 'Above the room')) : null,
        null),
      ots.length ? h('div.p3-box', h('b', 'In the client film'), h('p.muted', 'Untick what this OT should not have: the film leaves it out and the voice does not mention it.'),
        h('div.p3-filmparts', FILM_PARTS.map(([k, label]) => h('label.p3-check', h('input', { type: 'checkbox', ...(filmParts[k] !== false ? { checked: true } : {}), disabled: touring || tour.on,
          onchange: e => { filmParts[k] = e.target.checked; try { localStorage.setItem('p3-filmparts', JSON.stringify(filmParts)); } catch { /* not kept */ } } }), ' ' + label)))) : null,
      h('div.p3-box', h('b', 'Quantities'), h('p.muted', 'Floor, wall panels, ceiling and coving per OT, from the room sizes in the drawing.'), h('button.btn.small', { onclick: () => openQuantities().catch(fail) }, '📐 Quantities from the drawing')),
      h('div.p3-box', h('b', 'Heights'), h('div.p3-row', h('span', 'Walls'), num(wallH, 1, 10, 0.1, v => { wallH = v; }), h('span', 'm')),
        h('div.p3-row', h('span', 'Furniture'), num(furnH, 0, 2, 0.1, v => { furnH = v; }), h('span', 'm (0 = flat)'))),
      plan.areas.length > 1 ? h('div.p3-box', h('b', 'Part of the sheet'), h('select', { onchange: e => { areaIdx = Number(e.target.value); current = null; rebuild(); views.persp(); } },
        plan.areas.map((a, i) => h('option', { value: i, ...(i === areaIdx ? { selected: true } : {}) }, `${a.title || (i === 0 ? 'Main drawing' : 'Other area ' + i)} · ${Math.round(a.x1 - a.x0)} × ${Math.round(a.y1 - a.y0)} m`)))) : null,
      h('div.p3-box', h('b', 'Layers'), h('p.muted', 'What each CAD layer is. Your choices are remembered for the next drawing.'),
        h('table.p3-layers', h('tbody', layerRows))));
  }

  const resize = () => { if (tour.recording) return; const w = stage.clientWidth, hh = stage.clientHeight; renderer.setSize(w, hh, false); camera.aspect = w / Math.max(1, hh); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(stage);
  rebuild(); resize();
  camera.position.copy(hero()); controls.target.set(0, 0, 0);
  // tap an OT in the 3D: the ray meets the floor first, then the wall tops
  {
    const ray = new T.Raycaster(), ptr = new T.Vector2(), hit = new T.Vector3(), el = renderer.domElement;
    const roomAt = (x, z) => ots.filter(o => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1).sort((a, b) => (a.x1 - a.x0) * (a.z1 - a.z0) - (b.x1 - b.x0) * (b.z1 - b.z0))[0] || null;
    const under = e => {
      const r = el.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      for (const y of [0, wallH]) if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), hit)) { const o = roomAt(hit.x, hit.z); if (o) return o; }
      return null;
    };
    let down = null, look = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (walk.on) { look = [e.clientX, e.clientY]; el.setPointerCapture?.(e.pointerId); } });
    el.addEventListener('pointerup', e => {
      look = null;
      if (tour.on) return;
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      if (walk.on) { // tap the floor: walk there
        const r = el.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ptr, camera);
        if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), hit) && hit.distanceTo(camera.position) < 40) walk.target = { x: hit.x, z: hit.z };
        return;
      }
      const o = under(e);
      if (o) selectOt(o); else if (selected) { selected = null; drawHighlight(); drawSide(); }
    });
    el.addEventListener('pointermove', e => {
      if (tour.on) return;
      if (walk.on) {
        if (!look) return;
        walk.yaw -= (e.clientX - look[0]) * 0.0042; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - look[1]) * 0.0042));
        look = [e.clientX, e.clientY];
        return;
      }
      if (e.buttons || e.pointerType !== 'mouse') return;
      const o = under(e);
      if (o === hoverOt) return;
      hoverOt = o; el.style.cursor = o ? 'pointer' : '';
      hoverGlow.visible = !!o && o !== selected;
      if (o) { hoverGlow.position.set(o.v.x, 0.025, o.v.z); hoverGlow.scale.set(o.x1 - o.x0, o.z1 - o.z0, 1); }
    });
  }
  const v = new T.Vector3();
  const loop = now => {
    if (!stage.isConnected) { tour.stop(true); film.stop(true); ro.disconnect(); kit.dispose(); renderer.dispose(); document.removeEventListener('keydown', onWalkKey); document.removeEventListener('keyup', onWalkKey); document.removeEventListener('keydown', onTourKey); return; }
    requestAnimationFrame(loop);
    if (filmHold) return;
    if (film.on) film.frame(now);
    else if (tour.on) tour.frame(now);
    else if (walk.on) walkStep(now);
    else {
      walk.last = 0;
      if (anim) { const k = Math.min(1, (now - anim.start) / anim.ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; camera.position.lerpVectors(anim.p0, anim.p, e); controls.target.lerpVectors(anim.t0, anim.t, e); if (k >= 1) anim = null; }
      controls.update();
    }
    hlLayer.children[0]?.userData.pulse(now);
    ceilLayer.visible = camera.position.y < Math.min(wallH, 3) - 0.02; // ceilings only from inside a room
    renderer.render(scene, camera);
    tour.afterRender(); film.afterRender();
    // labels never overlap: room names are placed first, the rest only where there is space
    const W = stage.clientWidth, Hh = stage.clientHeight, placed = [];
    for (const l of labels) {
      v.copy(l.v); if (walk.on) v.y = 2.35; // walking: names float above head height, not at the feet
      v.project(camera);
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
  // An old AutoCAD version (e.g. 2000) can come out of the reader badly damaged: say so, and how to fix it
  if ((plan.broken || 0) > Math.max(300, plan.segments * 0.2)) {
    stage.append(h('div.p3-warn', h('b', '⚠ Much of this drawing could not be read'),
      h('span', `${plan.broken.toLocaleString()} parts came out damaged, so walls, doors and rooms may be missing: the DWG reader cannot read this file properly. Open it in AutoCAD, choose Save As → AutoCAD 2018 DXF (*.dxf), and attach the DXF instead (the CRM reads DXF itself). Or install the free ODA File Converter on the CRM computer: then every DWG is converted automatically.`),
      h('button.btn.small', { type: 'button', onclick: e => e.target.parentElement.remove() }, 'OK')));
  }
}
