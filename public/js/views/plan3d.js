// 🧊 A CAD floor plan (DWG / DXF attached to any record) shown in 3D: walls, glass and columns stand up,
// doors, furniture and the rest stay as lines on the floor, room names float above the floor.
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

function build(stage, side, plan) {
  const T = window.THREE;
  const roles = loadRoles();
  const roleOf = l => roles[l] || guessRole(l);
  let areaIdx = 0, wallH = 3, showLabels = true;

  stage.replaceChildren();
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  stage.append(renderer.domElement);
  const labelsLayer = h('div.p3-labels'); stage.append(labelsLayer);
  const scene = new T.Scene(); scene.background = new T.Color(0xeef2f7);
  const camera = new T.PerspectiveCamera(45, 1, 0.1, 5000);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.1, maxPolarAngle: Math.PI * 0.495, screenSpacePanning: true });
  scene.add(new T.HemisphereLight(0xffffff, 0x8a96a8, 0.85));
  const sun = new T.DirectionalLight(0xffffff, 0.55); sun.position.set(0.4, 1, 0.3); scene.add(sun);
  const group = new T.Group(); scene.add(group);
  let labels = [], center = [0, 0], size = 50, box = { w: 50, h: 50 };

  const rebuild = () => {
    group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    group.clear(); labelsLayer.replaceChildren(); labels = [];
    const A = plan.areas[areaIdx] || { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
    const inA = (x, y) => x >= A.x0 - 1 && x <= A.x1 + 1 && y >= A.y0 - 1 && y <= A.y1 + 1;
    const buckets = {};
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [lname, L] of Object.entries(plan.layers)) {
      const r = roleOf(lname); if (r === 'hide') continue;
      const s = L.segs; const out = (buckets[r] ||= []);
      for (let i = 0; i < s.length; i += 4) if (inA(s[i], s[i + 1]) && inA(s[i + 2], s[i + 3])) {
        out.push(s[i], s[i + 1], s[i + 2], s[i + 3]);
        if (r === 'wall' || r === 'glass' || r === 'column') { bx0 = Math.min(bx0, s[i], s[i + 2]); bx1 = Math.max(bx1, s[i], s[i + 2]); by0 = Math.min(by0, s[i + 1], s[i + 3]); by1 = Math.max(by1, s[i + 1], s[i + 3]); }
      }
    }
    if (!Number.isFinite(bx0)) { bx0 = A.x0; by0 = A.y0; bx1 = A.x1; by1 = A.y1; } // no walls chosen: use the whole area
    center = [(bx0 + bx1) / 2, (by0 + by1) / 2]; box = { w: bx1 - bx0, h: by1 - by0 }; size = Math.max(box.w, box.h);
    const X = x => x - center[0], Z = y => -(y - center[1]);
    // standing elements: one vertical face per line (double-sided), plus a dark outline on top
    for (const r of ['wall', 'glass', 'column']) {
      const s = buckets[r]; if (!s?.length) continue;
      const H = r === 'glass' ? wallH : wallH, n = s.length / 4, pos = new Float32Array(n * 18);
      for (let i = 0, k = 0; i < s.length; i += 4) {
        const ax = X(s[i]), az = Z(s[i + 1]), bx = X(s[i + 2]), bz = Z(s[i + 3]);
        pos.set([ax, 0, az, bx, 0, bz, bx, H, bz, ax, 0, az, bx, H, bz, ax, H, az], k); k += 18;
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = r === 'glass' ? new T.MeshStandardMaterial({ color: COLOR.glass, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false, roughness: 0.1 })
        : new T.MeshStandardMaterial({ color: COLOR[r], side: T.DoubleSide, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      group.add(new T.Mesh(g, m));
      const top = new Float32Array(n * 6);
      for (let i = 0, k = 0; i < s.length; i += 4) { top.set([X(s[i]), H, Z(s[i + 1]), X(s[i + 2]), H, Z(s[i + 3])], k); k += 6; }
      const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(top, 3));
      group.add(new T.LineSegments(tg, new T.LineBasicMaterial({ color: r === 'glass' ? 0x3b82c4 : 0x2b3442 })));
    }
    // lines on the floor
    for (const [r, y] of [['floor', 0.005], ['furniture', 0.012], ['door', 0.02]]) {
      const s = buckets[r]; if (!s?.length) continue;
      const pos = new Float32Array((s.length / 4) * 6);
      for (let i = 0, k = 0; i < s.length; i += 4) { pos.set([X(s[i]), y, Z(s[i + 1]), X(s[i + 2]), y, Z(s[i + 3])], k); k += 6; }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      group.add(new T.LineSegments(g, new T.LineBasicMaterial({ color: COLOR[r] })));
    }
    const floor = new T.Mesh(new T.PlaneGeometry(box.w + 4, box.h + 4), new T.MeshStandardMaterial({ color: 0xfbfcfd, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; group.add(floor);
    // room names (texts with words, not numbers or dimensions)
    if (showLabels) for (const t of plan.texts) {
      if (!inA(t.x, t.y) || !/[A-Za-z]{3,}/.test(t.t)) continue;
      const lines = t.t.split('\n').filter(Boolean).slice(0, 2);
      const el = h('div.p3-label', h('b', lines[0]), lines[1] ? h('span', lines[1]) : null);
      labelsLayer.append(el);
      labels.push({ el, v: new T.Vector3(X(t.x + (t.w || 0) / 2), 0.1, Z(t.y)), t, room: ROOM_RE.test(t.t) });
    }
    labels.sort((a, b) => Number(b.room) - Number(a.room));
    drawSide();
  };

  const fly = (pos, target, ms = 900) => { anim = { p0: camera.position.clone(), t0: controls.target.clone(), p: pos, t: target, start: performance.now(), ms }; };
  let anim = null;
  const fitDist = () => (Math.max(box.h, box.w / Math.max(0.3, camera.aspect)) / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.08;
  const views = {
    top: () => fly(new T.Vector3(0, fitDist(), 0.01), new T.Vector3(0, 0, 0)),
    persp: () => { const d = fitDist() * 0.95; fly(new T.Vector3(0, d * 0.62, d * 0.78), new T.Vector3(0, 0, 0)); },
  };
  const goTo = l => fly(new T.Vector3(l.v.x + 6, 9, l.v.z + 9), new T.Vector3(l.v.x, 0, l.v.z), 1100);

  // side panel: views, rooms, wall height, layers
  function drawSide() {
    const rooms = labels.filter(l => l.room);
    const roomSel = h('select', { onchange: e => { const l = rooms[Number(e.target.value)]; if (l) goTo(l); } }, h('option', { value: '' }, `Go to a room (${rooms.length})…`),
      rooms.map((l, i) => h('option', { value: i }, l.t.t.split('\n')[0])));
    const height = h('input', { type: 'number', min: 2, max: 6, step: 0.1, value: wallH, style: { width: '80px' }, onchange: e => { wallH = Math.max(1, Math.min(10, Number(e.target.value) || 3)); rebuild(); } });
    const layerRows = Object.entries(plan.layers).sort((a, b) => b[1].segs.length - a[1].segs.length).map(([lname, L]) => {
      const sel = h('select', { onchange: e => { roles[lname] = e.target.value; saveRoles(roles); rebuild(); } }, ROLES.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = roleOf(lname);
      return h('tr', h('td.p3-lname', { title: lname }, lname), h('td.num', Math.round(L.segs.length / 4)), h('td', sel));
    });
    side.replaceChildren(
      h('div.p3-box', h('b', 'View'), h('div.toolbar', h('button.btn.small', { onclick: views.persp }, '3D'), h('button.btn.small', { onclick: views.top }, 'Plan (top)'),
        h('label.p3-check', h('input', { type: 'checkbox', ...(showLabels ? { checked: true } : {}), onchange: e => { showLabels = e.target.checked; rebuild(); } }), ' Room names')), roomSel),
      h('div.p3-box', h('b', 'Wall height'), h('div', height, ' m')),
      plan.areas.length > 1 ? h('div.p3-box', h('b', 'Part of the sheet'), h('select', { onchange: e => { areaIdx = Number(e.target.value); rebuild(); views.persp(); } },
        plan.areas.map((a, i) => h('option', { value: i, ...(i === areaIdx ? { selected: true } : {}) }, `${i === 0 ? 'Main drawing' : 'Other area ' + i} · ${Math.round(a.x1 - a.x0)} × ${Math.round(a.y1 - a.y0)} m`)))) : null,
      h('div.p3-box', h('b', 'Layers'), h('p.muted', 'What each CAD layer is. Your choices are remembered for the next drawing.'),
        h('table.p3-layers', h('tbody', layerRows))));
  }

  const resize = () => { const w = stage.clientWidth, hh = stage.clientHeight; renderer.setSize(w, hh, false); camera.aspect = w / Math.max(1, hh); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(stage);
  rebuild(); resize();
  { const d = fitDist() * 0.95; camera.position.set(0, d * 0.62, d * 0.78); controls.target.set(0, 0, 0); }
  const v = new T.Vector3();
  const loop = now => {
    if (!stage.isConnected) { ro.disconnect(); renderer.dispose(); return; }
    requestAnimationFrame(loop);
    if (anim) { const k = Math.min(1, (now - anim.start) / anim.ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; camera.position.lerpVectors(anim.p0, anim.p, e); controls.target.lerpVectors(anim.t0, anim.t, e); if (k >= 1) anim = null; }
    controls.update(); renderer.render(scene, camera);
    // labels: only when on screen and not too far away (keeps the plan readable)
    const W = stage.clientWidth, Hh = stage.clientHeight, placed = [];
    for (const l of labels) {
      v.copy(l.v).project(camera);
      let on = v.z < 1 && v.x > -1.02 && v.x < 1.02 && v.y > -1.02 && v.y < 1.02;
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
