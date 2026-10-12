// BOQ / Bill of Material window (WIESPL engineers' format): components by section, what is procured
// (requisition → PO → GRN), what is sent to site and what is pending. Dispatch makes the challan automatically.
import { h, api, state, toast, fail, modal, badge, fmtDate, today, refOptions, clearRefCache, busy } from '../ui.js';
import { canWrite } from '../schema.js';
import { itemPicker, attachments, bomRows, toProcure } from './form.js';

const firstLine = s => String(s || '').split('\n')[0];

async function upload(path, file) {
  const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(file.name)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': file.type || 'application/octet-stream' }, body: await file.arrayBuffer() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

// "New BOQ": upload the engineers' bill of material Excel, or start an empty BOQ and add components by hand.
export async function newBomDialog(preset = {}) {
  const [projects, wos] = await Promise.all([refOptions('projects'), refOptions('boqs')]);
  let projectId = preset.project_id ? Number(preset.project_id) : null;
  let woId = preset.work_order_id ? Number(preset.work_order_id) : null;
  const client = h('input', { placeholder: 'e.g. Solapur OT 1,2,3, Passage (taken from the Excel if blank)' });
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const ok = await modal('New BOQ (bill of material)', h('div.grid',
    h('p', 'Upload the bill of material in the WIESPL format (SR.NO., COMPONENT NAME, SPECIFICATIONS, DIMENSIONS, QTY, UOM, MOC, DRAWING MODEL NO, Remark, MAKE). Sections like PLENUM, RISER, SWING DOOR and the size rows under a component are read automatically. Or leave the file empty and add components by hand.'),
    h('label', 'Bill of material Excel (optional)', file), h('label', 'Client / site', client),
    h('label', 'Project (optional)', itemPicker(projects, projectId, { onPick: id => { projectId = id; } })),
    h('label', 'Against work order (optional)', itemPicker(wos, woId, { onPick: id => { woId = id; } }))),
  [{ label: 'Cancel', value: false }, { label: 'Create BOQ', cls: 'primary', value: true }]);
  if (!ok) return;
  let bom;
  if (file.files[0]) {
    const q = new URLSearchParams({ client: client.value, ...(projectId ? { project_id: projectId } : {}), ...(woId ? { work_order_id: woId } : {}) });
    const r = await upload(`/boms/upload?${q}`, file.files[0]);
    bom = r.bom;
    toast(`BOQ ${bom.bom_no} created with ${r.components} components: ${r.sections.map(s => s.section).join(', ').slice(0, 160)}`);
  } else {
    if (!client.value.trim()) throw new Error('Enter the client / site, or choose the Excel file');
    bom = await api('/boms', { method: 'POST', body: { client: client.value.trim(), project_id: projectId, work_order_id: woId } });
  }
  clearRefCache('boms');
  location.hash = `#/bom/${bom.id}`;
}

const PROC = b => {
  if (!(b.qty > 0)) return '';
  if ((b.received || 0) >= b.qty) return 'Procured';
  if ((b.on_po || 0) > 0) return (b.received || 0) > 0 ? 'Partly received' : 'On PO';
  if ((b.req_open || 0) > 0) return 'Requisitioned';
  if ((b.dispatched || 0) >= b.qty) return 'From stock';
  return 'To procure';
};

export async function bomView(root, bomId) {
  const [bom, raw, challans, items] = await Promise.all([
    api(`/boms/${bomId}`), api(`/bom_items?bom_id=${bomId}&limit=20000`), api(`/challans?bom_id=${bomId}`), refOptions('items'),
  ]);
  const rows = bomRows(raw);
  const canEdit = canWrite('boms', state.user.role), canSend = canWrite('challans', state.user.role);
  const sections = [...new Set(rows.map(r => r.section || '—'))];
  const picks = new Map(); // component id → { qty, item_id }
  const pickCount = h('b', '0');
  const filter = h('select', { style: { width: 'auto' } }, ['All components', 'To procure', 'On PO / not received', 'Procured', 'Pending to send', 'Sent / in transit', 'Delivered ✓'].map(t => h('option', t)));
  const cols = h('select', { style: { width: 'auto' } }, h('option', { value: 'all' }, 'All columns'), h('option', { value: 'boq' }, 'BOQ details only'), h('option', { value: 'track' }, 'Procurement & dispatch only'));
  const search = h('input.grow', { type: 'search', placeholder: 'Search component, size, make …' });
  const out = h('div');
  const n = v => (v ? Math.round(v * 1000) / 1000 : '');

  function draw() {
    const q = search.value.toLowerCase().trim();
    const f = filter.value;
    const showBoq = cols.value !== 'track', showTrack = cols.value !== 'boq';
    const keep = r => {
      if (q && !`${r.sr_no} ${r.component_name} ${r.spec} ${r.dimensions} ${r.make} ${r.moc} ${r.remark}`.toLowerCase().includes(q)) return false;
      const p = PROC(r);
      if (f === 'To procure') return toProcure(r) > 0;
      if (f === 'On PO / not received') return ['On PO', 'Partly received'].includes(p);
      if (f === 'Procured') return p === 'Procured';
      if (f === 'Pending to send') return r.pending > 0;
      if (f === 'Sent / in transit') return ['Dispatched', 'Partly Dispatched'].includes(r.delivery_status);
      if (f === 'Delivered ✓') return r.delivery_status === 'Delivered';
      return true;
    };
    const head = [canSend ? '' : null, 'Sr', 'Component', ...(showBoq ? ['Specifications', 'Dimensions'] : []), 'Qty', 'UOM',
      ...(showBoq ? ['MOC', 'Drawing / Model', 'Remark', 'Make'] : []),
      ...(showTrack ? ['Store item / in store', 'Requisitioned', 'On PO', 'Received', 'Procurement', 'Sent', 'Pending', 'Dispatch'] : []), canSend ? 'Send now' : null, canEdit ? '' : null].filter(x => x !== null);
    const num = new Set(['Qty', 'Requisitioned', 'On PO', 'Received', 'Sent', 'Pending', 'Send now']);
    out.replaceChildren(...sections.map(sec => {
      const shown = rows.filter(r => (r.section || '—') === sec).filter(keep);
      if (!shown.length) return null;
      return h('div.card.flush', { style: { marginBottom: '14px' } },
        h('div', { style: { padding: '10px 16px', display: 'flex', gap: '12px', alignItems: 'center' } }, h('h2', { style: { margin: 0 } }, sec), h('span.muted', `${shown.length} component(s)`)),
        h('div.table-wrap', h('table.data', h('thead', h('tr', head.map(t => h('th' + (num.has(t) ? '.num' : ''), t)))),
          h('tbody', shown.map(r => {
            const sendable = r.pending > 0;
            const pick = picks.get(r.id);
            const qtyIn = h('input', { type: 'number', step: 'any', min: 0, style: { width: '70px' }, value: pick?.qty ?? r.pending ?? '' });
            const chk = h('input', { type: 'checkbox', checked: !!pick, style: { width: 'auto' } });
            const sync = () => { if (chk.checked) picks.set(r.id, { qty: qtyIn.value === '' ? null : Number(qtyIn.value), item_id: picks.get(r.id)?.item_id ?? r.item_id ?? null }); else picks.delete(r.id); pickCount.textContent = picks.size; };
            chk.onchange = sync;
            qtyIn.oninput = () => { if (!chk.checked && qtyIn.value) chk.checked = true; sync(); };
            const p = PROC(r);
            return h('tr', { style: { opacity: r.qty > 0 ? 1 : 0.6 } },
              canSend ? h('td', chk) : null,
              h('td.nowrap', r.sr_no || ''),
              h('td', { style: { minWidth: '160px' } }, r.component ? h('b', r.component) : h('span.muted', `↳ ${r.component_name}`)),
              showBoq ? [h('td', { style: { maxWidth: '280px', whiteSpace: 'pre-wrap', fontSize: '12px' } }, r.spec || ''), h('td', r.dimensions || '')] : null,
              h('td.num', r.qty_text ? `${r.qty ?? ''} (${r.qty_text})` : r.qty ?? ''), h('td', r.uom || ''),
              showBoq ? [h('td', r.moc || ''), h('td', r.drawing_no || ''), h('td', r.remark || ''), h('td', r.make || '')] : null,
              showTrack ? [
                h('td', { style: { fontSize: '12px' } }, r.item_id_label ? [r.item_id_label, h('div.muted', `in store: ${n(r.in_store) || 0}`)] : h('span.muted', '—')),
                h('td.num', n(r.requested)), h('td.num', n(r.on_po)), h('td.num', n(r.received)),
                h('td.nowrap', { style: { color: p === 'Procured' || p === 'From stock' ? 'var(--good)' : p === 'To procure' ? 'var(--warn)' : '' } }, p),
                h('td.num', n(r.dispatched)), h('td.num', { style: { fontWeight: 600, color: r.pending > 0 ? 'var(--warn)' : '' } }, n(r.pending)), h('td', badge(r.delivery_status))] : null,
              canSend ? h('td.num', sendable ? qtyIn : '') : null,
              canEdit ? h('td', h('a.btn.small', { href: `#/edit/bom_items/${r.id}` }, '✏️')) : null);
          })))));
    }));
    if (!out.children.length) out.append(h('div.empty', rows.length ? 'Nothing matches this filter' : 'No components yet. Import the bill of material Excel or add components.'));
  }

  async function dispatchSelected() {
    if (!picks.size) throw new Error('Tick the components you are sending');
    const chosen = rows.filter(r => picks.has(r.id));
    const f = {
      ship_to: h('textarea', { rows: 3, placeholder: 'Leave blank to use the vendor / project site address' }),
      date: h('input', { type: 'date', value: today() }), vehicle_no: h('input', { placeholder: 'MH14 AB 1234' }), transporter: h('input'),
      driver: h('input', { placeholder: 'name / phone' }), remarks: h('input'),
    };
    let vendorId = null;
    const vendors = await refOptions('vendors');
    const itemRows = chosen.map(r => h('tr', h('td', `${r.sr_no || ''} ${r.component_name} ${r.dimensions || ''}`.slice(0, 70)), h('td.num', picks.get(r.id).qty ?? ''),
      h('td', itemPicker(items, picks.get(r.id).item_id, { onPick: id => { picks.get(r.id).item_id = id; } }))));
    const ok = await modal(`Dispatch ${chosen.length} component(s) – a delivery challan is created automatically`, h('div.grid',
      h('label', 'Vendor (if the material goes to a vendor)', itemPicker(vendors, null, { onPick: id => { vendorId = id; } })),
      h('label', 'Ship to (address on the challan)', f.ship_to),
      h('div.form-grid', ...Object.entries({ date: 'Date', vehicle_no: 'Vehicle No', transporter: 'Transporter', driver: 'Driver', remarks: 'Remarks' })
        .map(([k, l]) => h('label', l, f[k]))),
      h('details', h('summary', 'Issue from store stock (optional) – pick the store item for components that come from the store'),
        h('table.data', h('thead', h('tr', h('th', 'Component'), h('th.num', 'Qty'), h('th', 'Store item'))), h('tbody', itemRows)))),
    [{ label: 'Cancel', value: false }, { label: '🚚 Dispatch & make challan', cls: 'good', value: true }], { wide: true });
    if (!ok) return;
    const body = { picks: [...picks].map(([bom_item_id, p]) => ({ bom_item_id, qty: p.qty, item_id: p.item_id })), ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), vendor_id: vendorId };
    let r;
    try { r = await api(`/boms/${bomId}/dispatch`, { method: 'POST', body }); } catch (e) {
      if (!/Not enough stock|More than the BOQ/.test(e.message)) throw e;
      if (!(await modal('Please check', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message), [{ label: 'Cancel', value: false }, { label: 'Dispatch anyway', cls: 'danger solid', value: true }]))) return;
      r = await api(`/boms/${bomId}/dispatch`, { method: 'POST', body: { ...body, force: true, allowNegative: true } });
    }
    await modal('Dispatched', h('p', `Challan ${r.challan.challan_no} created and marked Dispatched${r.stock_lines ? `; ${r.stock_lines} store item(s) issued from stock` : ''}. The BOQ now shows this material as sent.`),
      [{ label: '🖨 Print challan', action: () => { window.open(`#/print/challan/${r.challan.id}`, '_blank'); return false; } },
        r.stock_lines ? { label: '🖨 Print issue slip', action: () => { window.open(`#/print/stockdoc/OUTWARD?doc=${encodeURIComponent(r.challan.challan_no)}`, '_blank'); return false; } } : null,
        { label: 'OK', cls: 'primary', value: true }].filter(Boolean));
    bomView(root, bomId);
  }

  async function addFile() {
    const file = h('input', { type: 'file', accept: '.xlsx' });
    const mode = h('select', h('option', { value: 'append' }, 'Add its components to this BOQ'), h('option', { value: 'replace' }, 'Replace all components (only if nothing is ordered or sent yet)'));
    const ok = await modal('Import bill of material Excel', h('div.grid', h('label', 'Excel file', file), rows.length ? h('label', 'This BOQ already has components', mode) : null),
      [{ label: 'Cancel', value: false }, { label: 'Import', cls: 'primary', value: true }]);
    if (!ok) return;
    if (!file.files[0]) throw new Error('Choose a file');
    const r = await upload(`/boms/${bomId}/import?mode=${rows.length ? mode.value : 'append'}`, file.files[0]);
    toast(`Imported ${r.components} components`);
    bomView(root, bomId);
  }

  const procureLink = entity => () => {
    const ids = [...picks.keys()];
    location.hash = `#/edit/${entity}/new?bom_id=${bomId}${bom.project_id ? '&project_id=' + bom.project_id : ''}${ids.length ? '&bom_items=' + ids.join(',') : ''}`;
  };
  filter.onchange = draw; cols.onchange = draw; search.oninput = draw;
  const items_ = rows.filter(r => r.qty > 0);
  const k = (label, v, sub) => h('div.kpi', h('div.label', label), h('div.value', v), sub ? h('div.sub', sub) : null);
  root.replaceChildren(
    h('div.page-head', h('a.btn.small', { href: '#/list/boms' }, '‹ BOQs'),
      h('h1', `📑 ${bom.bom_no} · ${bom.client || ''}`), badge(bom.status),
      h('div.actions',
        h('a.btn', { href: `#/print/bom/${bomId}`, target: '_blank' }, '🖨 Print BOQ'),
        canEdit ? h('button.btn', { onclick: busy(addFile) }, '📥 Import Excel') : null,
        canEdit ? h('a.btn', { href: `#/edit/bom_items/new?bom_id=${bomId}` }, '+ Component') : null,
        canEdit ? h('a.btn', { href: `#/edit/boms/${bomId}?details=1` }, '✏️ Details') : null,
        canWrite('requisitions', state.user.role) ? h('button.btn', { onclick: procureLink('requisitions'), title: 'Ticked components, or everything still to procure' }, '📝 Requisition') : null,
        canWrite('purchase_orders', state.user.role) ? h('button.btn', { onclick: procureLink('purchase_orders'), title: 'Ticked components, or everything still to procure' }, '🛒 PO') : null,
        canSend && rows.length ? h('button.btn.primary', { onclick: busy(dispatchSelected) }, '🚚 Dispatch selected (', pickCount, ')') : null)),
    h('div.muted', { style: { marginBottom: '10px' } }, [bom.project_id_label && `Project: ${bom.project_id_label}`, bom.work_order_id_label && `Work order: ${bom.work_order_id_label}`,
      bom.customer_id_label && `Customer: ${bom.customer_id_label}`, `Date: ${fmtDate(bom.date)}`, bom.prepared_by && `Prepared by: ${bom.prepared_by}`, bom.approved_by && `Approved by: ${bom.approved_by}`].filter(Boolean).join('   ·   ')),
    rows.length ? h('div.kpis',
      k('Components', items_.length, `${rows.length - items_.length} with qty 0`),
      k('To procure', items_.filter(r => toProcure(r) > 0).length, 'not on PO / requisition yet'),
      k('On PO', items_.filter(r => ['On PO', 'Partly received'].includes(PROC(r))).length, 'waiting for GRN'),
      k('Procured ✓', items_.filter(r => PROC(r) === 'Procured').length),
      k('Sent to site', items_.filter(r => ['Dispatched', 'Delivered'].includes(r.delivery_status)).length, `${items_.filter(r => r.delivery_status === 'Delivered').length} delivered ✓`),
      k('Pending to send', items_.filter(r => r.pending > 0).length),
      k('Challans', challans.length)) : null,
    rows.length ? h('div.toolbar', search, filter, cols, h('span.muted', 'Tick components → “Requisition”, “PO” or “Dispatch selected”.')) : null,
    out,
    challans.length ? h('div.card', h('h2', '🚚 Challans of this BOQ'), h('table.data', h('thead', h('tr', ['Challan', 'Date', 'Vehicle', 'Items', 'Status', 'Delivered', 'Received by', ''].map(x => h('th', x)))),
      h('tbody', challans.map(c => h('tr',
        h('td', h('a', { href: `#/view/challans/${c.id}` }, c.challan_no)), h('td', fmtDate(c.date)), h('td', c.vehicle_no || ''), h('td', (c.lines || []).length), h('td', badge(c.status)),
        h('td', fmtDate(c.delivered_date)), h('td', c.received_by || ''), h('td', h('a.btn.small', { href: `#/print/challan/${c.id}`, target: '_blank' }, '🖨 Print'))))))) : null,
    attachments('boms', Number(bomId), canEdit));
  draw();
}

// Printed exactly like the engineers' sheet.
export function bomDoc(bom, rows, s) {
  const td = (c, a) => h('td', a || {}, c ?? '');
  let sec = null;
  const body = [];
  for (const r of rows) {
    if ((r.section || '') !== sec) { sec = r.section || ''; if (sec) body.push(h('tr', h('td', { colspan: 10, style: { fontWeight: 700, background: '#eef2f8' } }, sec))); }
    body.push(h('tr', td(r.sr_no), td(r.component), td(h('div', { style: { whiteSpace: 'pre-wrap' } }, r.spec || '')), td(r.dimensions), td(r.qty_text || r.qty, { class: 'num' }), td(r.uom), td(r.moc), td(r.drawing_no), td(r.remark), td(r.make)));
  }
  return h('div.doc', h('div.page', { style: { fontSize: '11px' } },
    h('div', { style: { textAlign: 'center', marginBottom: '6px' } }, h('div', { style: { fontSize: '16px', fontWeight: 700 } }, s.company_name),
      h('div', s.works_address || s.reg_address || ''), h('div', `Phone - ${s.phone || ''}`)),
    h('div', { style: { textAlign: 'center', fontSize: '15px', fontWeight: 700, textDecoration: 'underline', margin: '6px 0' } }, 'BILL OF MATERIAL'),
    h('table', h('tbody', h('tr', h('td', { style: { width: '75%' } }, h('b', 'CLIENT - '), bom.client || ''), h('td', h('b', 'Date - '), fmtDate(bom.date))),
      h('tr', h('td', h('b', 'BOQ No - '), bom.bom_no, bom.project_id_label ? `   ·   Project: ${bom.project_id_label}` : ''), h('td', bom.work_order_id_label ? `WO: ${bom.work_order_id_label.split(' · ')[0]}` : '')))),
    h('table', { style: { marginTop: '6px' } }, h('thead', h('tr', ['SR.NO.', 'COMPONENT NAME', 'SPECIFICATIONS', 'DIMENSIONS', 'QTY', 'UOM', 'MOC', 'DRAWING MODEL NO', 'Remark', 'MAKE'].map(x => h('th', x)))), h('tbody', body)),
    h('table', { style: { marginTop: '10px' } }, h('tbody', h('tr', h('td', { style: { height: '50px', verticalAlign: 'top', width: '60%' } }, h('b', 'Prepared By :- '), bom.prepared_by || ''),
      h('td', { style: { verticalAlign: 'top' } }, h('b', 'Approved By :- '), bom.approved_by || '')))),
    h('div', { style: { fontSize: '10px', marginTop: '4px' } }, s.bom_doc_no || 'WIESPL/MFG/00')));
}
