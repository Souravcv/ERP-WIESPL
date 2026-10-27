// Work order window: upload the client's work order, see each section's material, what is sent and what is pending,
// and dispatch (the delivery challan is created automatically).
import { h, api, state, toast, fail, modal, badge, fmtDate, today, refOptions, clearRefCache, reservedRetry } from '../ui.js';
import { canWrite, WO_DEPARTMENTS, ROLE_DEPARTMENT } from '../schema.js';
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

// "Generate BOQ": each work-order line → its Standard Material List (matched by the list's match words; can be changed here),
// components × the line's quantity. Lines without a list are copied as they are for design to detail.
async function generateBomDialog(boqId) {
  const p = await api(`/boqs/${boqId}/bom-preview`);
  if (!p.rows.length) throw new Error('This work order has no material lines yet');
  const choice = new Map(p.rows.map(r => [r.id, r.list_id]));
  const client = h('input', { value: p.work_order.title || '' });
  const reqBy = h('input', { type: 'date' });
  const count = h('b');
  const recount = () => { const m = [...choice.values()].filter(Boolean).length; count.textContent = `${m} of ${p.rows.length} line(s) have a material list`; };
  const listSel = r => {
    const sel = h('select', { style: { width: '100%', minWidth: '220px' } }, h('option', { value: '' }, '— no list: copy the line for design to detail —'),
      p.lists.map(l => h('option', { value: l.id }, `${l.label} (${l.components})`)));
    sel.value = r.list_id || '';
    sel.onchange = () => { choice.set(r.id, sel.value ? Number(sel.value) : null); recount(); };
    return sel;
  };
  recount();
  const ok = await modal(`Generate BOQ from ${p.work_order.boq_no}`, h('div.grid',
    p.existing.length ? h('p', { style: { color: 'var(--warn)' } }, `This work order already has: ${p.existing.map(b => `${b.bom_no} (${b.status})`).join(', ')}. A new BOQ is created next to it.`) : null,
    p.lists.length ? null : h('p', { style: { color: 'var(--warn)' } }, 'There are no Standard Material Lists yet (Sales & Projects → 🧩 Standard Material Lists). Every line is copied for design to detail.'),
    h('div.form-grid', h('label', 'Client / site (BOQ title)', client), h('label', 'Material required by', reqBy)),
    h('div', count, h('span.muted', ' · ✔ product = the list linked to the quotation’s catalog product; ✔ words = found by the list’s match words. Change any line here (the choice is remembered on the work order).')),
    h('div.table-wrap', { style: { maxHeight: '50vh' } }, h('table.data', h('thead', h('tr', ['Section', 'Sr', 'Work-order line', 'Qty', 'Standard material list', ''].map(x => h('th', x)))),
      h('tbody', p.rows.map(r => h('tr', h('td.muted', r.section || ''), h('td', r.sr_no || ''), h('td', { style: { maxWidth: '360px' } }, r.description),
        h('td.num.nowrap', r.qty == null ? h('span.muted', 'TBD') : `${r.qty} ${r.uom || ''}`), h('td', listSel(r)),
        h('td.muted', { title: r.how }, r.how === 'product' ? '✔ product' : r.how === 'matched' ? '✔ words' : r.how === 'chosen' ? 'saved' : ''))))))),
  [{ label: 'Cancel', value: false }, { label: '⚙️ Generate BOQ', cls: 'primary', value: true }], { wide: true });
  if (!ok) return;
  const r = await api(`/boqs/${boqId}/generate-bom`, { method: 'POST', body: { client: client.value, required_by: reqBy.value || null, mapping: Object.fromEntries(choice) } });
  clearRefCache('boms');
  toast(`${r.bom.bom_no}: ${r.components} components (${r.matched} line(s) from material lists, ${r.unmatched} to detail) · departments: ${r.departments.join(', ')}`);
  location.hash = `#/bom/${r.bom.id}`;
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
  // Master copy for everyone; the department filter shows one department's part (yours by default, once lines are assigned).
  const deptSel = h('select', { style: { width: 'auto' } }, ['All departments', ...WO_DEPARTMENTS, '(not assigned)'].map(t => h('option', t)));
  const mine = ROLE_DEPARTMENT[state.user.role];
  deptSel.value = sessionStorage.getItem(`boq-dept-${boqId}`) || (mine && rows.some(r => r.department === mine) ? mine : 'All departments');
  deptSel.onchange = () => { sessionStorage.setItem(`boq-dept-${boqId}`, deptSel.value); draw(); };
  const deptOf = r => r.department || '(not assigned)';
  async function setDept(ids, department) {
    await api(`/boqs/${boqId}/departments`, { method: 'POST', body: { ids, department } });
    for (const r of rows) if (ids.includes(r.id)) r.department = department || null;
    toast(`${ids.length} line(s) → ${department || 'not assigned'}`); draw(); drawDepts();
  }
  const deptBox = h('div');
  function drawDepts() {
    const it = rows.filter(r => r.kind !== 'Heading');
    const counts = ['(not assigned)', ...WO_DEPARTMENTS].map(d => [d, it.filter(r => deptOf(r) === d)]).filter(([, l]) => l.length);
    deptBox.replaceChildren(it.length ? h('div.card', { style: { padding: '10px 14px' } },
      h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' } }, h('b', 'Departments:'),
        counts.map(([d, l]) => h('a', { href: 'javascript:void 0', style: { color: d === '(not assigned)' ? 'var(--warn)' : '' }, onclick: () => { deptSel.value = d; deptSel.onchange(); } },
          `${d} ${l.length} (${l.filter(r => !['Dispatched', 'Delivered'].includes(r.delivery_status)).length} pending)`))),
      h('div.muted', { style: { fontSize: '12px', marginTop: '4px' } }, 'Master copy: every department sees the same work order. At the start, give each line (or a whole section) to its department; each department then opens it filtered to its part.')) : '');
  }
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
    const dep = deptSel.value;
    const keep = r => {
      if (!isItem(r)) return !q && f === 'All material' && dep === 'All departments';
      if (dep !== 'All departments' && deptOf(r) !== dep) return false;
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
          canEdit ? h('select', { style: { width: 'auto', fontSize: '12px' }, title: 'Give every line of this section (as filtered) to a department', onchange: e => { const v = e.target.value; e.target.value = ''; if (v) setDept(shown.filter(isItem).map(r => r.id), v === '(none)' ? null : v).catch(fail); } },
            h('option', { value: '' }, 'Section → department…'), [...WO_DEPARTMENTS, '(none)'].map(d => h('option', d))) : null,
          h('span', { style: { marginLeft: 'auto' } }, `${st.sent} of ${st.lines} sent · ${st.delivered} delivered ✓ · ${st.pending} pending`),
          h('div', { style: { width: '160px', height: '8px', background: 'var(--neutral-bg)', borderRadius: '4px', overflow: 'hidden' }, title: `${pct}% sent` },
            h('div', { style: { width: pct + '%', height: '100%', background: 'var(--good)' } }))),
        h('div.table-wrap', h('table.data',
          h('thead', h('tr', canSend ? h('th') : null, h('th'), h('th', 'Sr'), h('th', 'Material'), h('th', 'Dept'), h('th', 'UOM'), h('th.num', 'WO Qty'), h('th.num', 'Sent'), h('th.num', 'Delivered'), h('th.num', 'Pending'), h('th', 'Status'),
            canSend ? h('th.num', 'Send now') : null)),
          h('tbody', shown.map(r => {
            if (!isItem(r)) return h('tr', h('td', { colspan: canSend ? 12 : 10, style: { background: 'var(--surface-2)', fontWeight: 600 } }, `${r.sr_no ? r.sr_no + '  ' : ''}${firstLine(r.description)}`));
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
              h('td', canEdit ? h('select', { style: { width: 'auto', fontSize: '12px' }, onchange: e => setDept([r.id], e.target.value || null).catch(fail) },
                ['', ...WO_DEPARTMENTS].map(d => h('option', { value: d, selected: (r.department || '') === d }, d || '—'))) : h('span.muted', r.department || '—')),
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
      [{ label: 'Cancel', value: false }, { label: '📝 Make draft challan', cls: 'good', value: true }], { wide: true });
    if (!ok) return;
    const body = { picks: [...picks].map(([boq_item_id, p]) => ({ boq_item_id, qty: p.qty, item_id: p.item_id })), ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), vendor_id: vendorId };
    let r;
    try {
      r = await reservedRetry(extra => api(`/boqs/${boqId}/dispatch`, { method: 'POST', body: { ...body, ...extra } }));
      if (r === null) return;
    } catch (e) {
      if (!/Not enough stock|More than the work order/.test(e.message)) throw e;
      const again = await modal('Please check', h('pre', { style: { whiteSpace: 'pre-wrap' } }, e.message), [{ label: 'Cancel', value: false }, { label: 'Make it anyway', cls: 'danger solid', value: true }]);
      if (!again) return;
      r = await api(`/boqs/${boqId}/dispatch`, { method: 'POST', body: { ...body, force: true, allowNegative: true, allowReserved: true } });
    }
    await modal('Draft challan made', h('p', `Draft challan ${r.challan.challan_no} is ready. The store checks it and presses 🚚 Dispatch on the challan: then the store items are issued from stock and the material shows as sent.`),
      [{ label: '🖨 Print draft', action: () => { window.open(`#/print/challan/${r.challan.id}`, '_blank'); return false; } }, { label: 'Open challan', action: () => { location.hash = `#/view/challans/${r.challan.id}`; return true; } }, { label: 'OK', cls: 'primary', value: true }]);
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
        canWrite('dispatch_plans', state.user.role) ? h('a.btn', { href: `#/edit/dispatch_plans/new?boq_id=${boqId}${boq.project_id ? '&project_id=' + boq.project_id : ''}` }, '🚛 + Dispatch plan') : null,
        canWrite('boms', state.user.role) && rows.length ? h('button.btn.primary', { onclick: () => generateBomDialog(boqId).catch(fail), title: 'BOQ from the Standard Material Lists × work-order quantities' }, '⚙️ Generate BOQ') : null,
        canWrite('boms', state.user.role) ? h('button.btn', { onclick: () => import('./bom.js').then(m => m.newBomDialog({ work_order_id: Number(boqId), project_id: boq.project_id })).catch(fail) }, '📑 + BOQ (Excel / by hand)') : null,
        canSend && rows.length ? h('button.btn', { onclick: () => dispatchSelected().catch(fail) }, '🚚 Dispatch selected (', pickCount, ')') : null)),
    h('div.muted', { style: { marginBottom: '10px' } }, [boq.project_id_label && `Project: ${boq.project_id_label}`, boq.customer_id_label && `Customer: ${boq.customer_id_label}`, boq.wo_no && `WO: ${boq.wo_no}`].filter(Boolean).join('   ·   '),
      boms.length ? h('div', 'BOQs (bill of material): ', boms.map((b, i) => [i ? ', ' : '', h('a', { href: `#/bom/${b.id}` }, `${b.bom_no} ${b.client || ''}`)])) : null),
    rows.length ? h('div.kpis',
      h('div.kpi', h('div.label', 'Material lines'), h('div.value', all.lines), h('div.sub', `${sections.length} section(s)`)),
      h('div.kpi', h('div.label', 'Sent'), h('div.value', all.sent), h('div.sub', `${all.lines ? Math.round(all.sent / all.lines * 100) : 0}% of lines`)),
      h('div.kpi', h('div.label', 'Delivered ✓'), h('div.value', all.delivered)),
      h('div.kpi', h('div.label', 'Partly sent'), h('div.value', all.partly)),
      h('div.kpi', h('div.label', 'Pending'), h('div.value', all.pending), h('div.sub', `${rows.filter(r => isItem(r) && r.qty == null).length} with qty TBD`)),
      h('div.kpi', h('div.label', 'Challans'), h('div.value', challans.length))) : h('div.card', h('p', 'No material yet. Use “Add work order file” to import the work order Excel, or add lines by hand.')),
    rows.length ? deptBox : null,
    rows.length ? tabs : null,
    rows.length ? h('div.toolbar', search, deptSel, filter, canSend ? h('span.muted', 'Tick what you are sending (qty defaults to pending) → “Dispatch selected”. The challan is made for you.') : null) : null,
    out,
    challans.length ? h('div.card', h('h2', '🚚 Challans of this BOQ'), h('table.data', h('thead', h('tr', ['Challan', 'Date', 'Vehicle', 'Items', 'Status', 'Delivered', 'Received by', ''].map(x => h('th', x)))),
      h('tbody', challans.map(c => h('tr',
        h('td', h('a', { href: `#/view/challans/${c.id}` }, c.challan_no)), h('td', fmtDate(c.date)), h('td', c.vehicle_no || ''), h('td', (c.lines || []).length), h('td', badge(c.status)),
        h('td', fmtDate(c.delivered_date)), h('td', c.received_by || ''), h('td', h('a.btn.small', { href: `#/print/challan/${c.id}`, target: '_blank' }, '🖨 Print'))))))) : null,
    attachments('boqs', Number(boqId), canEdit));
  drawTabs();
  drawDepts();
  draw();
}
