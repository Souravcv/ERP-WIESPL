// Work order window: upload the client's work order, see each section's material, what is sent and what is pending,
// and dispatch (the delivery challan is created automatically).
import { h, api, state, toast, fail, modal, badge, fmtDate, today, refOptions, clearRefCache } from '../ui.js';
import { canWrite } from '../schema.js';
import { itemPicker, attachments } from './form.js';

const firstLine = s => String(s || '').split('\n')[0];

async function readFile(file) {
  return { raw: await file.arrayBuffer(), name: file.name, type: file.type || 'application/octet-stream' };
}
async function upload(path, f) {
  const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(f.name)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': f.type }, body: f.raw });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

// "New Work Order": upload the work order Excel; it is created and opened.
export async function newBoqDialog(preset = {}) {
  const projects = await refOptions('projects');
  let projectId = preset.project_id ? Number(preset.project_id) : null;
  const title = h('input', { placeholder: 'e.g. Lokmanya Hospital – Electrical & HVAC Work Order 1' });
  const file = h('input', { type: 'file', accept: '.xlsx,.xls' });
  file.onchange = () => { if (!title.value && file.files[0]) title.value = file.files[0].name.replace(/\.[^.]+$/, ''); };
  const ok = await modal('New work order (upload the client work order)', h('div.grid',
    h('p', 'Upload the work order / BOQ Excel. Every sheet with "Sr. No." and "Particulars" / "Description" becomes a section (MOT, Passage, MGPS, Electrical …) and its material is listed line by line.'),
    h('label', 'Work order file *', file), h('label', 'Work order title', title),
    h('label', 'Project (optional)', itemPicker(projects, projectId, { onPick: id => { projectId = id; } }))),
    [{ label: 'Cancel', value: false }, { label: 'Create work order', cls: 'primary', value: true }]);
  if (!ok) return;
  if (!file.files[0]) throw new Error('Choose the work order file');
  const f = await readFile(file.files[0]);
  const r = await upload(`/boqs/upload?title=${encodeURIComponent(title.value)}${projectId ? `&project_id=${projectId}` : ''}`, f);
  clearRefCache('boqs');
  toast(`Work order ${r.boq.boq_no} created: ${r.sections.map(s => `${s.section} ${s.items}`).join(', ')}`);
  location.hash = `#/boq/${r.boq.id}`;
}

export async function boqView(root, boqId) {
  const [boq, rows, challans, items, boms] = await Promise.all([
    api(`/boqs/${boqId}`), api(`/boq_items?boq_id=${boqId}&limit=20000`), api(`/challans?boq_id=${boqId}`), refOptions('items'), api(`/boms?work_order_id=${boqId}`).catch(() => []),
  ]);
  const canEdit = canWrite('boqs', state.user.role), canSend = canWrite('challans', state.user.role);
  rows.sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id));
  const sections = [...new Set(rows.map(r => r.section || 'BOQ'))];
  let tab = sessionStorage.getItem(`boq-tab-${boqId}`);
  if (tab !== 'All' && !sections.includes(tab)) tab = sections.length > 1 ? 'All' : sections[0] || 'All';
  const filter = h('select', { style: { width: 'auto' } }, ['All material', 'Pending', 'Sent / in transit', 'Delivered ✓', 'Qty TBD'].map(t => h('option', t)));
  const search = h('input.grow', { type: 'search', placeholder: 'Search material, Sr. no …' });
  const picks = new Map(); // boq line id → { qty, item_id }
  const pickCount = h('b', '0');
  const out = h('div');

  const isItem = r => r.kind !== 'Heading';
  const stats = list => {
    const it = list.filter(isItem);
    return { lines: it.length, delivered: it.filter(r => r.delivery_status === 'Delivered').length,
      sent: it.filter(r => ['Dispatched', 'Delivered'].includes(r.delivery_status)).length,
      partly: it.filter(r => r.delivery_status === 'Partly Dispatched').length,
      pending: it.filter(r => !['Dispatched', 'Delivered'].includes(r.delivery_status)).length };
  };

  const tabs = h('div.tabs');
  function drawTabs() {
    tabs.replaceChildren(...['All', ...sections].map(s => {
      const st = stats(s === 'All' ? rows : rows.filter(r => (r.section || 'BOQ') === s));
      return h('button', { class: s === tab ? 'active' : '', onclick: () => { tab = s; sessionStorage.setItem(`boq-tab-${boqId}`, s); drawTabs(); draw(); } },
        `${s === 'All' ? 'All sections' : s}  `, h('span.muted', `${st.sent}/${st.lines} sent`));
    }));
  }

  function draw() {
    const q = search.value.toLowerCase().trim();
    const f = filter.value;
    const keep = r => {
      if (!isItem(r)) return !q && f === 'All material';
      if (q && !`${r.sr_no} ${r.heading} ${r.description}`.toLowerCase().includes(q)) return false;
      if (f === 'Pending') return !['Dispatched', 'Delivered'].includes(r.delivery_status);
      if (f === 'Sent / in transit') return ['Dispatched', 'Partly Dispatched'].includes(r.delivery_status);
      if (f === 'Delivered ✓') return r.delivery_status === 'Delivered';
      if (f === 'Qty TBD') return r.qty == null;
      return true;
    };
    const secs = tab === 'All' ? sections : [tab];
    out.replaceChildren(...secs.map(sec => {
      const secRows = rows.filter(r => (r.section || 'BOQ') === sec);
      const shown = secRows.filter(keep);
      if (!shown.length) return null;
      const st = stats(secRows);
      const pct = st.lines ? Math.round((st.sent / st.lines) * 100) : 0;
      return h('div.card.flush', { style: { marginBottom: '16px' } },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' } },
          h('h2', { style: { margin: 0 } }, sec), secRows[0]?.wo_no ? h('span.muted', `WO ${secRows[0].wo_no}`) : null,
          h('span', { style: { marginLeft: 'auto' } }, `${st.sent} of ${st.lines} sent · ${st.delivered} delivered ✓ · ${st.pending} pending`),
          h('div', { style: { width: '160px', height: '8px', background: 'var(--neutral-bg)', borderRadius: '4px', overflow: 'hidden' }, title: `${pct}% sent` },
            h('div', { style: { width: pct + '%', height: '100%', background: 'var(--good)' } }))),
        h('div.table-wrap', h('table.data',
          h('thead', h('tr', canSend ? h('th') : null, h('th'), h('th', 'Sr'), h('th', 'Material'), h('th', 'UOM'), h('th.num', 'WO Qty'), h('th.num', 'Sent'), h('th.num', 'Delivered'), h('th.num', 'Pending'), h('th', 'Status'),
            canSend ? h('th.num', 'Send now') : null)),
          h('tbody', shown.map(r => {
            if (!isItem(r)) return h('tr', h('td', { colspan: canSend ? 11 : 9, style: { background: 'var(--surface-2)', fontWeight: 600 } }, `${r.sr_no ? r.sr_no + '  ' : ''}${firstLine(r.description)}`));
            const done = ['Dispatched', 'Delivered'].includes(r.delivery_status);
            const sendable = !done && (r.qty == null || r.pending > 0);
            const pick = picks.get(r.id);
            const qtyIn = h('input', { type: 'number', step: 'any', min: 0, style: { width: '76px' }, value: pick?.qty ?? (r.pending ?? ''), placeholder: r.qty == null ? 'qty' : '' });
            const chk = h('input', { type: 'checkbox', checked: !!pick, disabled: !sendable, style: { width: 'auto' } });
            const sync = () => {
              if (chk.checked) picks.set(r.id, { qty: qtyIn.value === '' ? null : Number(qtyIn.value), item_id: picks.get(r.id)?.item_id ?? r.item_id ?? null });
              else picks.delete(r.id);
              pickCount.textContent = picks.size;
            };
            chk.onchange = sync;
            qtyIn.oninput = () => { if (!chk.checked && qtyIn.value) chk.checked = true; sync(); };
            const icon = r.delivery_status === 'Delivered' ? '✓' : r.delivery_status === 'Dispatched' ? '🚚' : r.delivery_status === 'Partly Dispatched' ? '◐' : '';
            return h('tr', { style: { opacity: done ? 0.78 : 1 } },
              canSend ? h('td', chk) : null,
              h('td', { style: { fontSize: '17px', color: r.delivery_status === 'Delivered' ? 'var(--good)' : 'var(--text-2)' }, title: r.delivery_status }, icon),
              h('td.nowrap', r.sr_no || ''),
              h('td', { style: { maxWidth: '560px' } },
                r.heading ? h('div.muted', { style: { fontSize: '11px' } }, r.heading) : null,
                h('a', { href: `#/view/boq_items/${r.id}` }, firstLine(r.description)),
                r.description.includes('\n') ? h('details', h('summary.muted', { style: { fontSize: '11px' } }, 'full specification'), h('div', { style: { fontSize: '12px', whiteSpace: 'pre-wrap' } }, r.description)) : null,
                r.area_qty ? h('div.muted', { style: { fontSize: '11px' } }, r.area_qty) : null,
                r.item_id_label ? h('div.muted', { style: { fontSize: '11px' } }, `📦 store item: ${r.item_id_label}`) : null),
              h('td', r.uom || ''), h('td.num', r.qty ?? h('span.muted', 'TBD')), h('td.num', r.dispatched || ''), h('td.num', r.delivered || ''),
              h('td.num', { style: { fontWeight: 600, color: r.pending > 0 ? 'var(--warn)' : '' } }, r.pending ?? ''), h('td', badge(r.delivery_status)),
              canSend ? h('td.num', sendable ? qtyIn : '') : null);
          })))));
    }));
    if (!out.children.length) out.append(h('div.empty', 'Nothing matches this filter'));
  }

  async function dispatchSelected() {
    if (!picks.size) throw new Error('Tick the material you are sending');
    const chosen = rows.filter(r => picks.has(r.id));
    const f = {
      ship_to: h('textarea', { rows: 3, placeholder: 'Leave blank to use the vendor / project site address' }),
      date: h('input', { type: 'date', value: today() }), vehicle_no: h('input', { placeholder: 'MH14 AB 1234' }), transporter: h('input'),
      driver: h('input', { placeholder: 'name / phone' }), remarks: h('input'),
    };
    let vendorId = null;
    const vendors = await refOptions('vendors');
    // Optional store item per line: if set, that quantity is issued from store stock.
    const itemCells = chosen.map(r => h('tr', h('td', `${r.sr_no || ''} ${firstLine(r.description).slice(0, 60)}`), h('td.num', picks.get(r.id).qty ?? ''),
      h('td', itemPicker(items, picks.get(r.id).item_id, { onPick: id => { picks.get(r.id).item_id = id; } }))));
    const ok = await modal(`Dispatch ${chosen.length} item(s) – a delivery challan is created automatically`, h('div.grid',
      h('label', 'Vendor (if the material goes to a vendor)', itemPicker(vendors, null, { onPick: id => { vendorId = id; } })),
      h('label', 'Ship to (address on the challan)', f.ship_to),
      h('div.form-grid', ...Object.entries({ date: 'Date', vehicle_no: 'Vehicle No', transporter: 'Transporter', driver: 'Driver', remarks: 'Remarks' })
        .map(([k, l]) => h('label', l, f[k]))),
      h('details', h('summary', 'Issue from store stock (optional) – pick the store item for lines that come from the store'),
        h('table.data', h('thead', h('tr', h('th', 'Material'), h('th.num', 'Qty'), h('th', 'Store item'))), h('tbody', itemCells)))),
      [{ label: 'Cancel', value: false }, { label: '🚚 Dispatch & make challan', cls: 'good', value: true }], { wide: true });
    if (!ok) return;
    const body = { picks: [...picks].map(([boq_item_id, p]) => ({ boq_item_id, qty: p.qty, item_id: p.item_id })), ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), vendor_id: vendorId };
    let r;
    try { r = await api(`/boqs/${boqId}/dispatch`, { method: 'POST', body }); }
    catch (e) {
      if (!/Not enough stock|More than the work order/.test(e.message)) throw e;
      const again = await modal('Please check', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message), [{ label: 'Cancel', value: false }, { label: 'Dispatch anyway', cls: 'danger solid', value: true }]);
      if (!again) return;
      r = await api(`/boqs/${boqId}/dispatch`, { method: 'POST', body: { ...body, force: true, allowNegative: true } });
    }
    await modal('Dispatched', h('p', `Challan ${r.challan.challan_no} created and marked Dispatched${r.stock_lines ? `; ${r.stock_lines} store item(s) issued from stock` : ''}. The BOQ now shows this material as sent.`),
      [{ label: '🖨 Print challan', action: () => { window.open(`#/print/challan/${r.challan.id}`, '_blank'); return true; } }, { label: 'OK', cls: 'primary', value: true }]);
    boqView(root, boqId);
  }

  async function addFile() {
    const file = h('input', { type: 'file', accept: '.xlsx,.xls' });
    const mode = h('select', h('option', { value: 'append' }, 'Add its material to this BOQ'), h('option', { value: 'replace' }, 'Replace all lines (only if nothing sent yet)'));
    const ok = await modal('Add work order file', h('div.grid', h('label', 'Work order / BOQ Excel', file), rows.length ? h('label', 'This BOQ already has material', mode) : null),
      [{ label: 'Cancel', value: false }, { label: 'Import', cls: 'primary', value: true }]);
    if (!ok) return;
    if (!file.files[0]) throw new Error('Choose a file');
    const r = await upload(`/boqs/${boqId}/import?mode=${rows.length ? mode.value : 'append'}`, await readFile(file.files[0]));
    toast(`Imported: ${r.sections.map(s => `${s.section} ${s.items}`).join(', ')}`);
    boqView(root, boqId);
  }

  filter.onchange = draw;
  search.oninput = draw;
  const all = stats(rows);
  root.replaceChildren(
    h('div.page-head', h('a.btn.small', { href: '#/list/boqs' }, '‹ Work Orders'),
      h('h1', `📑 ${boq.boq_no} · ${boq.title}`), badge(boq.status),
      h('div.actions',
        canEdit ? h('button.btn', { onclick: () => addFile().catch(fail) }, '📥 Add work order file') : null,
        canEdit ? h('a.btn', { href: `#/edit/boq_items/new?boq_id=${boqId}${boq.project_id ? '&project_id=' + boq.project_id : ''}` }, '+ Line') : null,
        canEdit ? h('a.btn', { href: `#/edit/boqs/${boqId}?details=1` }, '✏️ Details') : null,
        canWrite('boms', state.user.role) ? h('button.btn', { onclick: () => import('./bom.js').then(m => m.newBomDialog({ work_order_id: Number(boqId), project_id: boq.project_id })).catch(fail) }, '📑 + BOQ for this work order') : null,
        canSend && rows.length ? h('button.btn.primary', { onclick: () => dispatchSelected().catch(fail) }, '🚚 Dispatch selected (', pickCount, ')') : null)),
    h('div.muted', { style: { marginBottom: '10px' } }, [boq.project_id_label && `Project: ${boq.project_id_label}`, boq.customer_id_label && `Customer: ${boq.customer_id_label}`, boq.wo_no && `WO: ${boq.wo_no}`].filter(Boolean).join('   ·   '),
      boms.length ? h('div', 'BOQs (bill of material): ', boms.map((b, i) => [i ? ', ' : '', h('a', { href: `#/bom/${b.id}` }, `${b.bom_no} ${b.client || ''}`)])) : null),
    rows.length ? h('div.kpis',
      h('div.kpi', h('div.label', 'Material lines'), h('div.value', all.lines), h('div.sub', `${sections.length} section(s)`)),
      h('div.kpi', h('div.label', 'Sent'), h('div.value', all.sent), h('div.sub', `${all.lines ? Math.round(all.sent / all.lines * 100) : 0}% of lines`)),
      h('div.kpi', h('div.label', 'Delivered ✓'), h('div.value', all.delivered)),
      h('div.kpi', h('div.label', 'Partly sent'), h('div.value', all.partly)),
      h('div.kpi', h('div.label', 'Pending'), h('div.value', all.pending), h('div.sub', `${rows.filter(r => isItem(r) && r.qty == null).length} with qty TBD`)),
      h('div.kpi', h('div.label', 'Challans'), h('div.value', challans.length))) : h('div.card', h('p', 'No material yet. Use “Add work order file” to import the work order Excel, or add lines by hand.')),
    rows.length ? tabs : null,
    rows.length ? h('div.toolbar', search, filter, canSend ? h('span.muted', 'Tick what you are sending (qty defaults to pending) → “Dispatch selected”. The challan is made for you.') : null) : null,
    out,
    challans.length ? h('div.card', h('h2', '🚚 Challans of this BOQ'), h('table.data', h('thead', h('tr', ['Challan', 'Date', 'Vehicle', 'Items', 'Status', 'Delivered', 'Received by', ''].map(x => h('th', x)))),
      h('tbody', challans.map(c => h('tr',
        h('td', h('a', { href: `#/view/challans/${c.id}` }, c.challan_no)), h('td', fmtDate(c.date)), h('td', c.vehicle_no || ''), h('td', (c.lines || []).length), h('td', badge(c.status)),
        h('td', fmtDate(c.delivered_date)), h('td', c.received_by || ''), h('td', h('a.btn.small', { href: `#/print/challan/${c.id}`, target: '_blank' }, '🖨 Print'))))))) : null,
    attachments('boqs', Number(boqId), canEdit));
  drawTabs();
  draw();
}
