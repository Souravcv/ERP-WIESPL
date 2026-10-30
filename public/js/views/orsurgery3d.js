// The OR Screen in use: a 3D operating theatre where the surgeon operates while watching the WIESPL OR Screen.
// Laminar-flow ceiling, OT table with a draped patient, surgeon and assistant (simple figures that move their hands
// and look up at the screens), a 43" WIESPL panel on the wall running the OR Screen app (canvas texture, real videos
// when available) and a pendant 4K monitor with the zero-latency endoscope feed (video texture).
// Built by panels3d.js inside its renderer; T = window.THREE (r128).

// Each step of the story: what the OR Screen shows (layout), where the camera goes, where the surgeon looks.
export const OR_STORY = [
  { key: 'live', title: 'Live surgical video on the OR Screen', text: 'The endoscope feed appears on the 43" WIESPL panel. The surgeon operates while watching the screen, without turning away from the table.', layout: 'full', view: 'shoulder', look: 'wall' },
  { key: 'zero', title: 'Zero latency on the pendant monitor', text: 'A medical-grade switch sends the endoscope to two 4K HDMI screens with no delay, so the hand on the instrument and the image move together.', layout: 'full', view: 'pendant', look: 'pendant' },
  { key: 'quad', title: 'Four sources, one screen', text: 'Endo cam, surgical cam, overhead camera and vitals / X-ray side by side. Tap a source to make it the main view.', layout: 'quad', view: 'screen', look: 'wall' },
  { key: 'pip', title: 'Picture in picture', text: 'The main feed stays full size while the surgical camera and the vitals sit in small windows.', layout: 'pip', view: 'over', look: 'wall' },
  { key: 'rec', title: 'Recording in 1080p and 4K', text: "Every source can be recorded. The video is saved in the patient's own folder on internal storage or USB, ready for teaching and records.", layout: 'full', view: 'screen', look: 'table', big: true },
  { key: 'report', title: 'Reports beside the live feed', text: "The patient's CT, PDF reports and images open next to the live video: no walking to a viewing box mid-surgery.", layout: 'report', view: 'shoulder', look: 'wall' },
  { key: 'conf', title: 'Teaching and consultation', text: 'The live OR feed streams on the hospital network and into a video conference with remote experts, students or family.', layout: 'conf', view: 'wide', look: 'table' },
];

export function buildSurgery(T, { orCanvas, endoVideo }) {
  const scene = new T.Scene();
  scene.background = null;
  scene.fog = new T.Fog(0x0b1626, 9, 20);
  const std = (color, rough = 0.5, metal = 0, extra = {}) => new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = scene) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  // room: PPGL walls, glossy vinyl with a border, ceiling
  const RW = 6.4, RD = 6.4;
  const floor = mesh(new T.PlaneGeometry(RW, RD), std(0x7e8ea2, 0.22, 0.3)); floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  const border = mesh(new T.RingGeometry(1.55, 1.68, 4, 1), std(0x2563c9, 0.3)); border.rotation.x = -Math.PI / 2; border.rotation.z = Math.PI / 4; border.position.y = 0.003; border.scale.set(1.35, 1, 1); border.castShadow = false;
  const wallM = std(0xd3dbe5, 0.42, 0.12);
  for (const [x, z, ry] of [[0, -RD / 2, 0], [-RW / 2, 0, Math.PI / 2], [RW / 2, 0, -Math.PI / 2]]) { const w = mesh(new T.PlaneGeometry(RW, 3), wallM, x, 1.5, z); w.rotation.y = ry; w.castShadow = false; }
  const ceil = mesh(new T.PlaneGeometry(RW, RD), std(0xe3e8ee, 0.6)); ceil.rotation.x = Math.PI / 2; ceil.position.y = 3; ceil.castShadow = false;
  for (const x of [-2.2, -1.1, 1.1, 2.2]) mesh(new T.BoxGeometry(0.008, 3, 0.004), std(0xb4bfcc), x, 1.5, -RD / 2 + 0.003).castShadow = false;

  // laminar air-flow plenum over the table, with the clean air falling as faint streaks
  const grille = Object.assign(document.createElement('canvas'), { width: 256, height: 192 });
  { const c = grille.getContext('2d'); c.fillStyle = '#f4f8ff'; c.fillRect(0, 0, 256, 192); c.strokeStyle = 'rgba(120,140,170,.35)'; for (let i = 0; i < 256; i += 6) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 192); c.stroke(); } for (let j = 0; j < 192; j += 6) { c.beginPath(); c.moveTo(0, j); c.lineTo(256, j); c.stroke(); } }
  const gTex = new T.CanvasTexture(grille); gTex.encoding = T.sRGBEncoding;
  mesh(new T.BoxGeometry(2.6, 0.12, 2.0), std(0xdfe5ec, 0.3, 0.6), 0, 2.94, 0).castShadow = false;
  const plen = mesh(new T.PlaneGeometry(2.4, 1.8), new T.MeshBasicMaterial({ map: gTex, toneMapped: false }), 0, 2.875, 0); plen.rotation.x = Math.PI / 2; plen.castShadow = false;
  const N = 120, flow = new Float32Array(N * 6), speed = [];
  for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 2.3, z = (Math.random() - 0.5) * 1.7, y = 0.9 + Math.random() * 1.9; flow.set([x, y, z, x, y - 0.1, z], i * 6); speed.push(0.35 + Math.random() * 0.25); }
  const flowGeo = new T.BufferGeometry(); flowGeo.setAttribute('position', new T.BufferAttribute(flow, 3));
  scene.add(new T.LineSegments(flowGeo, new T.LineBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.13, depthWrite: false })));

  // lights: soft fill, the OT light (two domes) pouring onto the table
  scene.add(new T.HemisphereLight(0xdfe8ff, 0x1c2738, 0.5));
  const key = new T.DirectionalLight(0xffffff, 0.45); key.position.set(3, 4, 3); scene.add(key);
  const otLight = new T.SpotLight(0xfff8ee, 2.6, 6, 0.42, 0.55, 1.2); otLight.position.set(0, 2.45, 0.15); otLight.target.position.set(0, 0.9, 0);
  otLight.castShadow = true; otLight.shadow.mapSize.set(1024, 1024); otLight.shadow.bias = -0.0008; scene.add(otLight, otLight.target);
  const domeM = std(0xf3f6fa, 0.3, 0.3);
  mesh(new T.CylinderGeometry(0.025, 0.025, 0.36), std(0xcfd6de, 0.3, 0.8), 0, 2.78, 0);
  for (const [x, z, s] of [[-0.3, 0.12, 0.22], [0.36, -0.14, 0.18]]) {
    const d = mesh(new T.SphereGeometry(s, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeM, x, 2.5, z); d.castShadow = false;
    const glow = mesh(new T.CircleGeometry(s * 0.92, 32), new T.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false }), x, 2.499, z); glow.rotation.x = Math.PI / 2; glow.castShadow = false;
    mesh(new T.CylinderGeometry(0.018, 0.018, Math.hypot(x, z) + 0.05), std(0xcfd6de, 0.3, 0.8), x / 2, 2.6, z / 2).rotation.set(Math.PI / 2, 0, Math.atan2(x, z));
  }

  // OT table and the draped patient (head towards -x)
  mesh(new T.BoxGeometry(0.7, 0.08, 0.45), std(0x9aa5b2, 0.4, 0.7), 0, 0.04, 0);
  mesh(new T.CylinderGeometry(0.12, 0.14, 0.72), std(0xc4ccd5, 0.3, 0.8), 0, 0.44, 0);
  mesh(new T.BoxGeometry(2.0, 0.09, 0.56), std(0x2b3a4d, 0.6), 0, 0.84, 0);
  const drapeM = std(0x2f7d8c, 0.85);
  mesh(new T.BoxGeometry(2.1, 0.16, 0.66), drapeM, 0.05, 0.96, 0);
  for (const s of [-1, 1]) { const f = mesh(new T.PlaneGeometry(2.1, 0.42), drapeM, 0.05, 0.75, s * 0.33); f.rotation.y = 0; f.material.side = T.DoubleSide; }
  mesh(new T.SphereGeometry(0.11, 24, 16), std(0xd9a58a, 0.7), -0.98, 1.0, 0);
  mesh(new T.SphereGeometry(0.115, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x7fb3d5, 0.8), -1.0, 1.02, 0).rotation.z = Math.PI / 2;
  const field = mesh(new T.PlaneGeometry(0.34, 0.22), std(0xc98a7a, 0.55), 0.15, 1.045, 0); field.rotation.x = -Math.PI / 2; // the operating field
  // anaesthesia screen (ether screen) and a laparoscopy tower
  const bar = mesh(new T.TorusGeometry(0.34, 0.012, 8, 24, Math.PI), std(0xcfd6de, 0.3, 0.8), -0.72, 1.0, 0); bar.rotation.y = Math.PI / 2;
  mesh(new T.BoxGeometry(0.55, 1.25, 0.5), std(0x2e3a4a, 0.5, 0.3), -1.75, 0.63, -0.95);
  mesh(new T.BoxGeometry(0.48, 0.3, 0.03), new T.MeshBasicMaterial({ color: 0x0b2238 }), -1.75, 1.42, -0.69);

  // people: simple figures in scrubs with a cap and mask; the arms reach for the table, the head can look around
  const skin = std(0xd9a58a, 0.7), glove = std(0xeae2c8, 0.5);
  function person(gown, cap) {
    const g = new T.Group(); scene.add(g);
    const gm = std(gown, 0.8);
    for (const s of [-1, 1]) { mesh(new T.CylinderGeometry(0.065, 0.06, 0.82), std(0x3b6e8f, 0.8), s * 0.1, 0.41, 0, g); mesh(new T.BoxGeometry(0.11, 0.06, 0.24), std(0xe8edf2, 0.6), s * 0.1, 0.03, 0.04, g); }
    mesh(new T.CylinderGeometry(0.2, 0.27, 0.78), gm, 0, 1.2, 0, g);
    mesh(new T.SphereGeometry(0.2, 20, 12), gm, 0, 1.56, 0, g).scale.set(1.15, 0.5, 0.8);
    mesh(new T.CylinderGeometry(0.05, 0.055, 0.1), skin, 0, 1.66, 0, g);
    const head = new T.Group(); head.position.set(0, 1.78, 0); g.add(head);
    mesh(new T.SphereGeometry(0.105, 24, 16), skin, 0, 0, 0, head);
    mesh(new T.SphereGeometry(0.112, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(cap, 0.85), 0, 0.012, 0, head);
    const mask = mesh(new T.BoxGeometry(0.15, 0.085, 0.05), std(0x9ec9e8, 0.8), 0, -0.035, 0.085, head); mask.castShadow = false;
    for (const s of [-1, 1]) mesh(new T.SphereGeometry(0.012, 8, 8), std(0x1b2433, 0.3), s * 0.038, 0.03, 0.098, head);
    const arms = [-1, 1].map(s => {
      const sh = new T.Group(); sh.position.set(s * 0.25, 1.52, 0); g.add(sh);
      mesh(new T.CylinderGeometry(0.05, 0.045, 0.3), gm, 0, -0.15, 0, sh);
      const el = new T.Group(); el.position.set(0, -0.3, 0); sh.add(el);
      mesh(new T.CylinderGeometry(0.042, 0.036, 0.28), gm, 0, -0.14, 0, el);
      const hand = mesh(new T.SphereGeometry(0.045, 12, 10), glove, 0, -0.3, 0, el);
      return { sh, el, hand, s };
    });
    return { g, head, arms };
  }
  const surgeon = person(0x3d7fb0, 0x2563c9); surgeon.g.position.set(0.15, 0, 0.62); surgeon.g.rotation.y = Math.PI;
  const assistant = person(0x4f9a8a, 0x5cb85c); assistant.g.position.set(0.2, 0, -0.62);
  const anaes = person(0x6a7fa8, 0x8b5cf6); anaes.g.position.set(-1.45, 0, 0.1); anaes.g.rotation.y = Math.PI / 2;
  // the surgeon's laparoscopic instruments
  const tool = (arm, len) => { const m = mesh(new T.CylinderGeometry(0.008, 0.008, len), std(0x9aa3ad, 0.25, 0.9), 0, -0.3 - len / 2 + 0.02, 0.0, arm.el); m.castShadow = false; return m; };
  tool(surgeon.arms[0], 0.42); tool(surgeon.arms[1], 0.38); tool(assistant.arms[1], 0.4);

  // the WIESPL 43" panel on the wall in front of the surgeon, running the OR Screen app
  const orTex = new T.CanvasTexture(orCanvas); orTex.encoding = T.sRGBEncoding; orTex.anisotropy = 8;
  const SW = 1.36, SH = 0.765; // shown a little larger than 43" so it reads from the camera
  const wallP = new T.Group(); wallP.position.set(0.25, 1.62, -RD / 2 + 0.01); scene.add(wallP);
  mesh(new T.BoxGeometry(SW + 0.09, SH + 0.12, 0.04), new T.MeshPhysicalMaterial({ color: 0xf8fafc, roughness: 0.25, clearcoat: 1 }), 0, -0.01, 0.02, wallP);
  const wallScreen = mesh(new T.PlaneGeometry(SW, SH), new T.MeshBasicMaterial({ map: orTex, toneMapped: false }), 0, 0, 0.0405, wallP); wallScreen.castShadow = false;
  for (const [c, x, w] of [[0x2563c9, -0.2, 0.7], [0x5cb85c, 0.35, 0.34]]) mesh(new T.BoxGeometry(w, 0.008, 0.002), new T.MeshBasicMaterial({ color: c }), x, -SH / 2 - 0.035, 0.041, wallP);
  const wallGlow = new T.PointLight(0x8ab8ff, 0.9, 3, 2); wallGlow.position.set(0.25, 1.62, -RD / 2 + 0.7); scene.add(wallGlow);

  // pendant arm from the ceiling holding a 4K monitor with the zero-latency endoscope feed
  const pend = new T.Group(); pend.position.set(1.05, 0, -0.85); scene.add(pend);
  mesh(new T.CylinderGeometry(0.03, 0.03, 1.05), std(0xcfd6de, 0.3, 0.8), 0, 2.47, 0, pend);
  mesh(new T.BoxGeometry(0.1, 0.1, 0.1), std(0xcfd6de, 0.3, 0.8), 0, 1.93, 0, pend);
  const mon = new T.Group(); mon.position.set(0, 1.8, 0.05); pend.add(mon);
  const endoTex = endoVideo ? new T.VideoTexture(endoVideo) : orTex; if (endoVideo) endoTex.encoding = T.sRGBEncoding;
  mesh(new T.BoxGeometry(0.66, 0.4, 0.04), std(0x1b2433, 0.4, 0.4), 0, 0, -0.022, mon);
  const pendScreen = mesh(new T.PlaneGeometry(0.62, 0.35), new T.MeshBasicMaterial({ map: endoTex, toneMapped: false }), 0, 0, 0.0, mon); pendScreen.castShadow = false;
  mon.lookAt(new T.Vector3(0.15, 1.75, 0.62).sub(pend.position)); // turned towards the surgeon

  // camera spots (position, target)
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const views = {
    wide: [V(2.9, 2.25, 3.1), V(0, 1.15, -0.6)],
    shoulder: [V(0.55, 2.0, 1.65), V(0.25, 1.45, -2.6)],
    over: [V(-0.35, 1.95, 1.45), V(0.3, 1.55, -2.8)],
    screen: [V(0.25, 1.55, -1.3), V(0.25, 1.47, -RD / 2)],
    pendant: [V(0.55, 1.95, 0.95), V(1.05, 1.75, -0.85)],
    table: [V(1.3, 1.75, 1.05), V(0.1, 0.98, 0)],
  };
  const lookAt = { wall: wallP.position.clone(), pendant: V(1.05, 1.8, -0.85), table: V(0.15, 1.0, 0.05) };
  let look = 'table', glance = 0;
  const yawPitch = (p, target, faceY) => { const d = target.clone().sub(p); const yaw = Math.atan2(d.x, d.z) - faceY; return [Math.atan2(Math.sin(yaw), Math.cos(yaw)), -Math.atan2(d.y, Math.hypot(d.x, d.z))]; };

  function tick(t, dt) {
    // air streaks fall and wrap
    const p = flowGeo.attributes.position;
    for (let i = 0; i < N; i++) { let y = p.array[i * 6 + 1] - speed[i] * dt; if (y < 0.95) y = 2.8; p.array[i * 6 + 1] = y; p.array[i * 6 + 4] = y - 0.1; }
    p.needsUpdate = true;
    // hands working at the table
    const work = (who, phase, reach = 1) => who.arms.forEach(({ sh, el, s }, i) => {
      sh.rotation.x = -0.95 * reach + 0.06 * Math.sin(t * 2.2 + phase + i); sh.rotation.z = s * -0.28; sh.rotation.y = s * 0.15;
      el.rotation.x = -0.75 + 0.08 * Math.sin(t * 3.1 + phase + i * 1.7); el.rotation.z = s * 0.35;
    });
    work(surgeon, 0); work(assistant, 2); anaes.arms.forEach(({ sh, el }) => { sh.rotation.x = -0.25; el.rotation.x = -0.6; });
    // where the surgeon looks: the story's choice, plus a glance at the table every few seconds
    glance = (t % 7) > 5.6 && look !== 'table';
    const tgt = lookAt[glance ? 'table' : look];
    const hp = new T.Vector3(); surgeon.head.getWorldPosition(hp);
    const [yaw, pitch] = yawPitch(hp, tgt, surgeon.g.rotation.y);
    const k = Math.min(1, dt * 3.5);
    surgeon.head.rotation.y += (yaw - surgeon.head.rotation.y) * k; surgeon.head.rotation.x += (pitch - surgeon.head.rotation.x) * k;
    const ap = new T.Vector3(); assistant.head.getWorldPosition(ap);
    const [ay, apch] = yawPitch(ap, (t % 9) > 6 ? lookAt.wall : lookAt.table, assistant.g.rotation.y);
    assistant.head.rotation.y += (ay - assistant.head.rotation.y) * k; assistant.head.rotation.x += (apch - assistant.head.rotation.x) * k;
    anaes.head.rotation.x = 0.25 + 0.05 * Math.sin(t * 0.4);
    orTex.needsUpdate = true;
  }
  return {
    scene, views, tick, screens: [wallScreen, pendScreen],
    setLook(l) { look = l; },
    dispose() { scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { if (x.map && x.map !== orTex) x.map.dispose?.(); x.dispose(); }); }); orTex.dispose(); gTex.dispose(); },
  };
}
