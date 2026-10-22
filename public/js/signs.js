// Company stamp and personal signatures.
// - Printing: loadSigns() once, then sigImg(name) / stampImg() wherever an approval has been given.
// - Capturing: signatureDialog() (draw or upload, background removed) and stampEditor() for Settings.
import { h, api, toast, fail, modal, confirmBox, state } from './ui.js';

let SIGS = {}, STAMP_V = '';
export async function loadSigns() {
  SIGS = {}; STAMP_V = '';
  try {
    const r = await api('/signatures');
    STAMP_V = r.stamp || '';
    for (const p of r.people || []) { SIGS[p.name.trim().toLowerCase()] = p; SIGS[String(p.username || '').toLowerCase()] = p; }
  } catch { /* print without signatures */ }
}
// "Ramesh (Purchase Head, 2026-10-20 11:02)" → "ramesh"
const key = n => String(n || '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
export const plainSigner = n => String(n || '').replace(/\s*\(.*\)\s*$/, '').trim();
// approvals of documents without lines are "A (stage, date) · B (stage, date)": one signature each
export const sigImg = name => {
  const imgs = String(name || '').split(' · ').map(n => SIGS[key(n)]).filter(Boolean)
    .map(p => h('img.sig', { src: `/api/signatures/${p.user_id}?v=${encodeURIComponent(p.v || '')}`, alt: `Signature: ${p.name}` }));
  return imgs.length ? imgs : null;
};
export const stampImg = () => (STAMP_V ? h('img.stamp', { src: `/api/brand/stamp?v=${encodeURIComponent(STAMP_V)}`, alt: 'Company stamp' }) : null);

// ---------------------------------------------------------------- image clean-up: white paper → transparent, trimmed
function toCanvas(src) {
  return new Promise((ok, bad) => {
    if (src instanceof HTMLCanvasElement) return ok(src);
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); const k = Math.min(1, 900 / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c); };
    img.onerror = () => bad(new Error('This file is not an image the browser can read (use PNG or JPG)'));
    img.src = URL.createObjectURL(src);
  });
}
export async function cleanImage(src) {
  const c = await toCanvas(src);
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gg = p[i + 1], b = p[i + 2], light = (r + gg + b) / 3, sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    if (light > 215 && sat < 40) p[i + 3] = 0;                                   // paper
    else if (light > 170 && sat < 40) p[i + 3] = Math.round(p[i + 3] * (215 - light) / 45); // soft edge
    if (p[i + 3] > 20) { const x = (i / 4) % c.width, y = Math.floor(i / 4 / c.width); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('The image looks empty');
  g.putImageData(d, 0, 0);
  const pad = 6, out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext('2d').drawImage(c, x0, y0, out.width - pad * 2, out.height - pad * 2, pad, pad, out.width - pad * 2, out.height - pad * 2);
  return new Promise(ok => out.toBlob(ok, 'image/png'));
}

// ---------------------------------------------------------------- "✍️ My signature": draw or upload
export async function signatureDialog(userId = 'me', who = 'your') {
  const pad = h('canvas', { width: 520, height: 180, style: { width: '100%', maxWidth: '520px', height: '180px', background: '#fff', border: '1.5px dashed #9aa7ba', borderRadius: '10px', touchAction: 'none', cursor: 'crosshair' } });
  const g = pad.getContext('2d'); g.lineWidth = 2.6; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#13306b';
  let drawing = false, drawn = false, upload = null;
  const pos = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.onpointerdown = e => { drawing = true; drawn = true; upload = null; pad.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); };
  pad.onpointermove = e => { if (drawing) { g.lineTo(...pos(e)); g.stroke(); } };
  pad.onpointerup = () => { drawing = false; };
  const clear = () => { g.clearRect(0, 0, pad.width, pad.height); drawn = false; upload = null; };
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', onchange: async () => { const f = file.files[0]; if (!f) return; try { const c = await toCanvas(f); clear(); const k = Math.min(pad.width / c.width, pad.height / c.height); g.drawImage(c, (pad.width - c.width * k) / 2, (pad.height - c.height * k) / 2, c.width * k, c.height * k); upload = true; } catch (e) { fail(e); } } });
  const current = h('div');
  try { const r = await api('/signatures'); const me = userId === 'me' ? state.user.id : Number(userId); const p = (r.people || []).find(x => x.user_id === me); if (p) current.append(h('div.muted', 'Current signature:'), h('img', { src: `/api/signatures/${me}?v=${encodeURIComponent(p.v)}`, alt: 'Current signature', style: { maxHeight: '60px', display: 'block', margin: '4px 0 10px', background: '#fff', padding: '4px 8px', borderRadius: '6px' } })); } catch { /* none */ }
  const ok = await modal(`✍️ ${who === 'your' ? 'Your' : who + '’s'} signature`, h('div.grid',
    h('p.muted', 'Printed above your name on documents you approve (PO, requisition, quotation …), next to the company stamp. Sign with the mouse or finger, or upload a photo / scan of your signature on white paper: the white background is removed automatically.'),
    current, pad, h('div.toolbar', h('button.btn', { type: 'button', onclick: clear }, 'Clear'), h('label', 'Or upload a scan / photo: ', file))),
  [{ label: 'Cancel', value: false }, current.childNodes.length ? { label: 'Remove signature', value: 'remove' } : null, { label: 'Save signature', cls: 'primary', value: true }].filter(Boolean));
  if (ok === 'remove') { if (!(await confirmBox('Remove this signature? Documents will print without it.'))) return; await api(`/signatures/${userId}`, { method: 'DELETE' }); toast('Signature removed'); return; }
  if (!ok) return;
  if (!drawn && !upload) { toast('Draw or upload a signature first'); return; }
  const blob = await cleanImage(pad);
  await api(`/signatures/${userId}`, { method: 'PUT', raw: await blob.arrayBuffer() });
  toast('Signature saved');
}

// ---------------------------------------------------------------- Settings: company stamp
export function stampEditor() {
  const box = h('div');
  const draw = async () => {
    let v = '';
    try { v = (await api('/signatures')).stamp; } catch { /* none */ }
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
    box.replaceChildren(
      v ? h('img', { src: `/api/brand/stamp?v=${encodeURIComponent(v)}`, alt: 'Company stamp', style: { height: '110px', display: 'block', margin: '6px 0', background: '#fff', padding: '6px', borderRadius: '8px' } }) : h('p.muted', 'No stamp uploaded yet.'),
      h('div.toolbar', h('label', v ? 'Replace with: ' : 'Upload: ', file),
        h('button.btn.primary', { onclick: async () => { try { if (!file.files[0]) { toast('Choose the stamp image'); return; } const blob = await cleanImage(file.files[0]); await api('/brand/stamp', { method: 'PUT', raw: await blob.arrayBuffer() }); toast('Stamp saved'); draw(); } catch (e) { fail(e); } } }, '⬆ Save stamp'),
        v ? h('button.btn', { onclick: async () => { if (!(await confirmBox('Remove the company stamp? Approved documents will print without it.'))) return; await api('/brand/stamp', { method: 'DELETE' }); toast('Stamp removed'); draw(); } }, '🗑 Remove') : null));
  };
  draw();
  return box;
}
