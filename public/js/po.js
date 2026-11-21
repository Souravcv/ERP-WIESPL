// The client's purchase order page (no login): check the order, then approve it with name, designation, PO number and a drawn signature.
const main = document.getElementById('po-main');
const token = new URLSearchParams(location.search).get('t') || '';
const inr = v => (v == null || v === '' ? '' : '₹ ' + Number(v).toLocaleString('en-IN'));
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
async function call(path, body) {
  const r = await fetch(`/api/public/po/${encodeURIComponent(token)}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j;
}
function pad(canvas) {
  const ctx = canvas.getContext('2d'); let drawing = false, any = false;
  const size = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width * 2; canvas.height = r.height * 2; ctx.scale(2, 2); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#102a56'; };
  size();
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); any = true; });
  const stop = () => { drawing = false; }; canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  return { empty: () => !any, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); any = false; }, png: () => canvas.toDataURL('image/png') };
}
async function start() {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) { main.replaceChildren(el('p', { class: 'po-err' }, 'This link is not valid. Please ask WIESPL for a new one.')); return; }
  const d = await call('');
  if (d.company) document.getElementById('eq-company').textContent = d.company;
  const rows = d.items.map(i => el('tr', el('td', i.name), el('td', { class: 'n' }, `${i.qty} ${i.uom}`)));
  const terms = [d.payment_terms && el('p', el('b', 'Payment terms: '), d.payment_terms), d.milestones?.length && el('table', el('thead', el('tr', el('th', 'Billing stage'), el('th', { class: 'n' }, '%'))), el('tbody', d.milestones.map(m => el('tr', el('td', m.description), el('td', { class: 'n' }, m.percent)))))].filter(Boolean);
  const head = [el('h1', `Purchase order ${d.order}`), el('p', [d.hospital, d.place].filter(Boolean).join(', ')), el('p', `Quotation ${d.quotation || ''}${d.quote_date ? ' dated ' + d.quote_date : ''}${d.subject ? ' · ' + d.subject : ''}`),
    el('div', { class: 'po-box' }, el('table', el('tbody', el('tr', el('td', 'Basic value'), el('td', { class: 'n' }, inr(d.basic))), el('tr', el('td', `GST ${d.gst_rate || 0}%`), el('td', { class: 'n' }, inr(d.total - d.basic))), el('tr', el('td', el('b', 'Total')), el('td', { class: 'n' }, el('b', inr(d.total))))))),
    d.items.length ? [el('h3', 'What is included'), el('table', el('thead', el('tr', el('th', 'Item'), el('th', { class: 'n' }, 'Quantity'))), el('tbody', rows))] : null, terms, d.delivery_date ? el('p', el('b', 'Committed delivery: '), d.delivery_date) : null];
  if (d.approved) { main.replaceChildren(...head.flat(), el('div', { class: 'po-ok' }, `✔ Approved on ${d.approved.at} by ${d.approved.by}, ${d.approved.role}${d.approved.po_no ? ` · your PO number ${d.approved.po_no}` : ''}. Thank you.`)); return; }
  const name = el('input', { type: 'text', autocomplete: 'name' }), role = el('input', { type: 'text' }), po = el('input', { type: 'text' }), tick = el('input', { type: 'checkbox' });
  const canvas = el('canvas', { class: 'po-sig' }), err = el('div', { class: 'po-err' });
  const form = el('div', el('h3', 'Approve this order'),
    el('label', 'Your name'), name, el('label', 'Your designation'), role, el('label', 'Your own purchase order number (if any)'), po,
    el('label', 'Sign here with your finger or mouse'), canvas,
    el('label', { style: 'font-weight:400' }, tick, ' I have read the order above and I accept it for my hospital.'),
    err);
  main.replaceChildren(...head.flat(), el('div', { class: 'po-box' }, form));
  const sig = pad(canvas);
  const btn = el('button', { class: 'po-btn', type: 'button', onclick: async () => {
    err.textContent = ''; if (sig.empty()) { err.textContent = 'Please sign in the box'; return; }
    btn.disabled = true;
    try { await call('/approve', { name: name.value, designation: role.value, po_no: po.value, accept: tick.checked, signature: sig.png() }); await start(); }
    catch (e) { err.textContent = e.message; btn.disabled = false; }
  } }, '✔ Approve the order');
  form.append(btn, el('button', { class: 'po-btn sec', type: 'button', onclick: () => sig.clear() }, 'Clear signature'));
}
start().catch(e => main.replaceChildren(el('p', { class: 'po-err' }, e.message)));
