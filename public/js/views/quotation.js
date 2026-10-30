import { h, api, state, toast, fail, modal, confirmBox, fieldInput, badge, money, clearRefCache } from '../ui.js';
import { canWrite, UOMS } from '../schema.js';
import { roomAreas, quoteTotals, lineBasicRate, lineQty, inr, round2, amountInWords, MM_PER_FT, AREA_BASES } from '../calc.js';

const uid = p => p + Math.random().toString(36).slice(2, 9);
const EDITABLE = ['Draft', 'Rejected'];

// Cooling unit of a room: DX, chilled water (CHW) valve, or both
const COOLING = ['DX', 'Chilled water valve', 'DX + Chilled water valve (both)'];
const COOL_BOTH = COOLING[2];

const ROOM_TEMPLATES = {
  "Major OT – 10'x10' plenum": { name: 'Major OT', length: 21.5, width: 19, height: 10, cls: 'CLASS 100', temp: '20C +/-2˚C', rh: 'NMT 55', plenum: "10' x 10'", hepa_area: '96 Sq. Ft', hepa_loc: 'TERMINAL HEPA FILTER', cfm: 3000, fresh_ach: 5, persons: 6, equip_kw: 2, light: 0.3, ac_tr: '10 TR', cooling: COOL_BOTH, dx: '3Tr+3Tr', chw: '4Tr', heater_kw: 12 },
  "Major OT – 6'x8' plenum": { name: 'Major OT', length: 17.6, width: 13.8, height: 10, cls: 'CLASS 100', temp: '20C +/-2˚C', rh: 'NMT 55', plenum: "6' x 8'", hepa_area: '44 Sq. Ft', hepa_loc: 'TERMINAL HEPA FILTER', cfm: 2000, fresh_ach: 5, persons: 6, equip_kw: 2, light: 0.3, ac_tr: '6 Tr', cooling: COOL_BOTH, dx: '2Tr+2TR', chw: '2TR', heater_kw: 6 },
  'Septic OT': { name: 'Septic OT', length: 19.6, width: 18.5, height: 10, cls: 'CLASS 100', temp: '20C +/-2˚C', rh: 'NMT 55', plenum: "6' x 8'", hepa_area: '44 Sq. Ft', hepa_loc: 'TERMINAL HEPA FILTER', cfm: 2500, fresh_ach: 5, persons: 6, equip_kw: 2, light: 0.3, ac_tr: '7 Tr', cooling: COOL_BOTH, dx: '2Tr+2TR', chw: '3TR', heater_kw: 6 },
  'Cath Lab': { name: 'Cath Lab', length: 22.7, width: 18.9, height: 10, cls: 'CLASS 100', temp: '22C +/-2˚C', rh: 'NMT 55', plenum: 'HEPA IN AHU', hepa_loc: 'AHU', cfm: 2500, fresh_ach: 5, persons: 6, equip_kw: 2, light: 0.3, ac_tr: '10 TR', cooling: COOL_BOTH, dx: '3Tr+3Tr', chw: '4Tr', heater_kw: 12 },
  'ICU / NICU': { name: 'ICU', length: 30, width: 20, height: 10, cls: 'CLASS 10000', temp: '22C +/-2˚C', rh: 'NMT 55', plenum: 'HEPA IN AHU', hepa_loc: 'AHU', cfm: 2500, fresh_ach: 5, persons: 8, equip_kw: 3, light: 0.3 },
  'OT Passage': { name: 'OT Passage', length: 94.4, width: 7.9, height: 10, wall_sides: 1, temp: '24C +/-2˚C', rh: 'NMT 55' },
  'OT Store': { name: 'OT Store', length: 16.9, width: 10, height: 10 },
  'Blank room': { name: 'Room', height: 10 },
};

// Basis of Design rows (in the order of the WIESPL sheet). type: num | text | calc
const BOD = [
  ['h', 'Room size'],
  ['name', 'Room / Location', 'text'],
  ['length', 'OT Room Length (ft)', 'num'],
  ['width', 'Width (ft)', 'num'],
  ['height', 'Height (ft)', 'num'],
  ['wall_sides', 'Wall sides counted (4 / 3 / 2 / 1)', 'num'],
  ['h', 'Modular OT ceiling & walls (area)'],
  ['walls', 'Walls (Sq. Ft)', 'calc'],
  ['ceiling', 'False Ceiling (Sq. Ft)', 'calc'],
  ['coving', 'Coving (R. Ft)', 'calc'],
  ['flooring', 'Flooring incl. 15% (Sq. Ft)', 'calc'],
  ['h', 'OT indoor air quality'],
  ['cls', 'Class of air at plenum grill', 'text'],
  ['temp', 'Temperature range (˚C)', 'text'],
  ['rh', 'Humidity (%)', 'text'],
  ['h', 'LAF system'],
  ['plenum', 'LAF Plenum Size', 'text'],
  ['hepa_area', 'HEPA Filtration Area', 'text'],
  ['hepa_loc', 'HEPA Filter Location', 'text'],
  ['h', 'AHU design'],
  ['cfm', 'Supply Air Quantity (cfm)', 'num'],
  ['fresh_ach', 'Fresh Air Quantity (ACPH)', 'num'],
  ['air_changes', 'Designed Air Changes (ACPH)', 'calc'],
  ['h', 'Internal heat load'],
  ['persons', 'Average persons in room', 'num'],
  ['equip_kw', 'Average equipment load (kW)', 'num'],
  ['light', 'Lighting load (W / sq. ft)', 'num'],
  ['h', 'Cooling unit'],
  ['cooling', 'Cooling unit type (DX / chilled water valve / both)', 'text'],
  ['ac_tr', 'Air Conditioning + CHW (TR)', 'text'],
  ['dx', 'Air Conditioning – WIESPL scope (TR)', 'text'],
  ['chw', 'CHW – client scope (TR)', 'text'],
  ['h', 'Heater bank'],
  ['heater_kw', 'SS strip heaters with PLC control (kW)', 'num'],
];

// Choices offered on the room fields (pick one or type your own); the templates' and the other rooms' values are added.
const BOD_CHOICES = {
  cls: ['CLASS 100', 'CLASS 1000', 'CLASS 10000', 'CLASS 100000', 'ISO 5', 'ISO 6', 'ISO 7', 'ISO 8'],
  temp: ['18C +/-2˚C', '20C +/-2˚C', '21C +/-3˚C', '22C +/-2˚C', '24C +/-2˚C'],
  rh: ['NMT 55', 'NMT 60', '50 +/- 5', '40 – 60'],
  plenum: ["4' x 6'", "4' x 8'", "6' x 8'", "8' x 10'", "10' x 10'", 'HEPA IN AHU'],
  hepa_loc: ['TERMINAL HEPA FILTER', 'AHU'],
  cooling: COOLING,
  wall_sides: [4, 3, 2, 1],
};

export async function quotationView(root, id) {
  let q = await api(`/quotations/${id}`);
  const data = q.data || {};
  data.rooms ||= []; data.lines ||= []; data.optionals ||= []; data.terms ||= state.settings.terms || [];
  data.scope_matrix ||= state.settings.scope_matrix || [];
  data.client_scope ??= state.settings.client_scope || '';
  data.letter_intro ??= state.settings.letter_intro || '';
  data.annex ||= { usp: true, bod: true, summary: true, terms: true, scope: true };
  const editable = EDITABLE.includes(q.status) && canWrite('quotations', state.user.role);
  let dirty = false;
  let tab = sessionStorage.getItem('q-tab') || 'rooms';

  const head = {};
  const headFields = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'enquiry_id', label: 'Enquiry', type: 'ref', ref: 'enquiries' },
    { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
    { key: 'prepared_by', label: 'Prepared By', type: 'person' },
    { key: 'gst_rate', label: 'GST %', type: 'number' },
    { key: 'discount_pct', label: 'Discount %', type: 'number' },
    { key: 'subject', label: 'Subject', type: 'text', span: 2 },
    { key: 'to_address', label: 'To (name & address as printed)', type: 'textarea', span: 2 },
  ];
  const markDirty = () => { dirty = true; saveBtn && (saveBtn.textContent = '💾 Save *'); refresh(); };
  const headGrid = h('div.form-grid', headFields.map(f => {
    const w = fieldInput(f, q[f.key], { readonly: !editable, onChange: markDirty });
    head[f.key] = w;
    return h('label' + (f.span === 2 ? '.span-2' : ''), f.label, w.el);
  }));

  const strip = h('div.status-line');
  const tabBody = h('div');
  const tabs = h('div.tabs');
  let saveBtn;
  // Cells updated in place on every keystroke (avoids re-rendering inputs)
  let live = { refresh: () => {} };

  // the quotation GST %, used for lines without their own GST %
  const quoteGst = () => head.gst_rate.get() ?? 18;
  function totals() {
    return quoteTotals(data, head.gst_rate.get() ?? 18, head.discount_pct.get() ?? 0);
  }
  function refresh() {
    const t = totals();
    strip.replaceChildren(
      h('span', 'Basic ', h('b', money(t.basic))),
      t.discount ? h('span', 'Discount ', h('b', '− ' + money(t.discount))) : null,
      h('span', `GST ${Object.keys(t.gstByRate || {}).filter(r => t.gstByRate[r]).map(r => r + '%').join(' + ') || (head.gst_rate.get() ?? 18) + '%'} `, h('b', money(t.gst))),
      h('span', 'Grand total ', h('b', { style: { fontSize: '16px' } }, money(t.grand))),
      dirty ? h('span.badge.warn', 'Unsaved changes') : null);
    live.refresh(t);
  }

  async function save(silent = false) {
    const body = { data };
    for (const k of Object.keys(head)) body[k] = head[k].get();
    q = await api(`/quotations/${q.id}`, { method: 'PUT', body });
    dirty = false;
    if (!silent) toast('Quotation saved');
    clearRefCache('quotations');
    return q;
  }
  const act = fn => async () => { try { await fn(); } catch (e) { fail(e); } };
  const post = (path, body) => api(path, { method: 'POST', body });
  const reload = () => quotationView(root, q.id);

  function actions() {
    const A = [];
    const can = canWrite('quotations', state.user.role);
    if (editable) A.push(saveBtn = h('button.btn.primary', { onclick: act(() => save()) }, '💾 Save'));
    A.push(h('button.btn', { onclick: act(async () => { if (dirty && editable) await save(true); window.open(`#/print/quotation/${q.id}`, '_blank'); }) }, '🖨 Print / PDF'));
    if (can && EDITABLE.includes(q.status)) A.push(h('button.btn.good', { onclick: act(async () => {
      if (!data.lines.length) throw new Error('Add BOQ items before submitting');
      await save(true);
      await post(`/quotations/${q.id}/submit`);
      toast(state.settings.require_quote_approval === 'No' ? 'Approved' : 'Sent to manager for approval');
      window.dispatchEvent(new Event('approvals-changed'));
      reload();
    }) }, '✅ Submit for Approval'));
    if (can && q.status === 'Approved') A.push(h('button.btn', { onclick: act(async () => { await post(`/quotations/${q.id}/status`, { status: 'Sent' }); reload(); }) }, '📤 Mark as Sent'));
    if (canWrite('sales_orders', state.user.role) && ['Approved', 'Sent'].includes(q.status)) A.push(h('button.btn.good', { onclick: act(async () => {
      const po = h('input', { placeholder: 'Client PO / Work order no' });
      const dt = h('input', { type: 'date' });
      const ok = await modal('Order received – create Sales Order', h('div.grid', h('label', 'Client PO number', po), h('label', 'PO date', dt)),
        [{ label: 'Cancel', value: false }, { label: 'Create Sales Order', cls: 'good', value: true }]);
      if (!ok) return;
      const so = await post(`/quotations/${q.id}/convert`, { client_po_no: po.value, client_po_date: dt.value || null });
      location.hash = `#/view/sales_orders/${so.id}`;
    }) }, '🤝 Won → Sales Order'));
    if (can && ['Approved', 'Sent'].includes(q.status)) A.push(h('button.btn.danger', { onclick: act(async () => { if (await confirmBox('Mark this quotation as Lost?')) { await post(`/quotations/${q.id}/status`, { status: 'Lost' }); reload(); } }) }, 'Mark Lost'));
    if (can && q.status !== 'Draft') A.push(h('button.btn', { onclick: act(async () => {
      if (!(await confirmBox('Create a new revision (R+1) of this quotation for editing?'))) return;
      const r = await post(`/quotations/${q.id}/revise`);
      location.hash = `#/quotation/${r.id}`;
    }) }, '✏️ Revise'));
    if (q.enquiry_id) A.push(h('a.btn', { href: `#/view/enquiries/${q.enquiry_id}` }, 'Enquiry'));
    return A;
  }

  // ------------------------------------------------------------ Rooms & Basis of Design
  function roomsTab() {
    const rooms = data.rooms;
    const calcCells = {};
    const addSel = h('select', h('option', { value: '' }, '+ Add room from template…'), Object.keys(ROOM_TEMPLATES).map(k => h('option', { value: k }, k)));
    addSel.onchange = () => {
      if (!addSel.value) return;
      const t = ROOM_TEMPLATES[addSel.value];
      const same = rooms.filter(r => r.name?.startsWith(t.name)).length;
      rooms.push({ ...t, id: uid('r'), name: same ? `${t.name} ${same + 1}` : t.name });
      markDirty(); render();
    };
    const parseFt = v => {
      const m = String(v).trim().match(/^([\d.]+)\s*mm$/i);
      return m ? round2(Number(m[1]) / MM_PER_FT) : v === '' ? null : Number(v);
    };
    // one list per room field: standard choices + template values + values in this quotation's rooms
    const lists = h('div', { hidden: true });
    const choiceList = key => {
      const id = 'bod-' + key;
      const vals = [...new Set([...(BOD_CHOICES[key] || []), ...Object.values(ROOM_TEMPLATES).map(t => t[key]), ...rooms.map(r => r[key])]
        .filter(v => v != null && v !== '').map(String))];
      lists.append(h('datalist', { id }, vals.map(v => h('option', { value: v }))));
      return id;
    };
    const thead = h('thead', h('tr', h('th', 'Project parameters'), rooms.map((r, i) => h('th', { style: { minWidth: '120px' } },
      h('div', { style: { display: 'flex', gap: '2px' } },
        h('span', { style: { flex: 1 } }, `#${i + 1}`),
        editable ? [
          h('button.icon-btn', { title: 'Move left', disabled: i === 0, onclick: () => { [rooms[i - 1], rooms[i]] = [rooms[i], rooms[i - 1]]; markDirty(); render(); } }, '‹'),
          h('button.icon-btn', { title: 'Move right', disabled: i === rooms.length - 1, onclick: () => { [rooms[i + 1], rooms[i]] = [rooms[i], rooms[i + 1]]; markDirty(); render(); } }, '›'),
          h('button.icon-btn', { title: 'Duplicate', onclick: () => { rooms.splice(i + 1, 0, { ...structuredClone(r), id: uid('r'), name: r.name + ' (copy)' }); markDirty(); render(); } }, '⧉'),
          h('button.icon-btn.del', { title: 'Remove room', onclick: async () => { if (await confirmBox(`Remove ${r.name}? Its BOQ quantities are removed too.`)) { rooms.splice(i, 1); markDirty(); render(); } } }, '✕'),
        ] : null)))));
    const tbody = h('tbody', BOD.map(([key, label, type]) => {
      if (key === 'h') return h('tr', h('td', { colspan: rooms.length + 1, style: { fontWeight: 700, background: 'var(--surface-2)' } }, h('span.bod-h', label)));
      return h('tr', h('td', label), rooms.map(r => {
        if (type === 'calc') {
          const a = roomAreas(r);
          if (key === 'air_changes') {
            const c = h('td.calc.num', a.air_changes ? a.air_changes.toFixed(1) : '');
            (calcCells[r.id] ||= {})[key] = c;
            return c;
          }
          const inp = h('input', { type: 'number', step: 'any', readOnly: !editable, placeholder: String(a[key]), title: 'Auto-calculated; type a value to override' });
          inp.value = r.override?.[key] ?? '';
          inp.oninput = () => { r.override ||= {}; if (inp.value === '') delete r.override[key]; else r.override[key] = Number(inp.value); markDirty(); };
          (calcCells[r.id] ||= {})[key] = inp;
          return h('td.calc', inp);
        }
        const inp = h('input', { type: 'text', inputmode: type === 'num' ? 'decimal' : undefined, readOnly: !editable, list: editable ? choiceList(key) : null, autocomplete: 'off' });
        inp.value = r[key] ?? '';
        inp.oninput = () => { r[key] = type === 'num' ? (inp.value.match(/mm$/i) ? r[key] : inp.value === '' ? null : Number(inp.value)) : inp.value; markDirty(); };
        if (type === 'num') inp.onchange = () => { r[key] = parseFt(inp.value); inp.value = r[key] ?? ''; markDirty(); };
        return h('td', inp);
      }));
    }));
    live.refresh = () => {
      for (const r of rooms) {
        const a = roomAreas(r), cells = calcCells[r.id] || {};
        for (const k of AREA_BASES) if (cells[k]) cells[k].placeholder = String(a[k]);
        if (cells.air_changes) cells.air_changes.textContent = a.air_changes ? a.air_changes.toFixed(1) : '';
      }
    };
    return h('div',
      h('div.toolbar', editable ? addSel : null, h('span.muted', 'Tip: type sizes like "6550mm" to convert to feet. Blue cells are auto-calculated (type to override). Every field: pick from the list or type your own.')), lists,
      rooms.length ? h('div.table-wrap.card.flush.q-scroll', h('table.data.bod', thead, tbody)) : h('div.empty', 'No rooms yet. Add OTs, ICU, passage etc. from a template.'));
  }

  // ------------------------------------------------------------ BOQ
  async function pickProducts(optional = false) {
    const all = (await api('/products?active=Yes')).sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999));
    const search = h('input', { type: 'search', placeholder: 'Search products…' });
    const checks = new Map();
    const list = h('div', { style: { maxHeight: '55vh', overflow: 'auto' } });
    const draw = () => {
      const s = search.value.toLowerCase();
      list.replaceChildren(...all.filter(p => !s || `${p.code} ${p.name} ${p.category}`.toLowerCase().includes(s)).map(p => {
        const cb = checks.get(p.id) || h('input', { type: 'checkbox', style: { width: 'auto' } });
        checks.set(p.id, cb);
        return h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400, padding: '4px 0' } }, cb,
          h('span', h('b', p.name), ' ', h('span.muted', `${p.category} · ${p.uom} · ₹${inr(p.rate)}${p.kind === 'Heading' ? ' · heading' : ''}`)));
      }));
    };
    search.oninput = draw; draw();
    const ok = await modal(optional ? 'Add optional items' : 'Add products to BOQ', h('div.grid', search, list), [{ label: 'Cancel', value: false }, { label: 'Add selected', cls: 'primary', value: true }], { wide: true });
    if (!ok) return [];
    return all.filter(p => checks.get(p.id)?.checked);
  }
  const lineFromProduct = (p, prevHeading) => ({
    id: uid('l'), kind: p.kind === 'Heading' ? 'heading' : 'item', product_id: p.id, name: p.name, description: p.description || p.name,
    uom: p.uom, rate: p.rate || 0, install: round2((p.rate || 0) * (p.install_pct || 0) / 100), basis: p.qty_basis || 'manual',
    gst: p.gst_rate != null && Number(p.gst_rate) !== Number(head.gst_rate.get() ?? 18) ? Number(p.gst_rate) : null,
    sub: !!(prevHeading && p.kind !== 'Heading' && p.sort != null && prevHeading.sort != null && Math.floor(p.sort / 10) === Math.floor(prevHeading.sort / 10)),
    qty: {}, default_qty: p.default_qty,
  });
  function applyDefaultQty(line) {
    if (line.kind === 'heading' || AREA_BASES.includes(line.basis)) return;
    for (const r of data.rooms) if (line.qty[r.id] === undefined) line.qty[r.id] = line.default_qty ?? 1;
  }
  function addProducts(products, target) {
    let prevHeading = null;
    for (const p of products) {
      const l = lineFromProduct(p, prevHeading);
      if (p.kind === 'Heading') prevHeading = p; else if (!l.sub) prevHeading = null;
      if (target === data.optionals) { l.qty = 1; target.push(l); } else { applyDefaultQty(l); target.push(l); }
    }
    markDirty();
  }

  function numbering(lines) {
    let main = 0, sub = 0;
    return lines.map(l => (l.sub ? `${main}.${++sub}` : (sub = 0, String(++main))));
  }

  function boqTab() {
    const rooms = data.rooms, lines = data.lines;
    const nums = numbering(lines);
    const amountCells = {}, qtyCells = {}, roomTotalCells = {}, autoInputs = [];
    let basicCell;
    const bar = h('div.toolbar',
      editable ? [
        h('button.btn', { onclick: act(async () => {
          const prods = (await api('/products?active=Yes')).filter(p => p.sort != null && p.category !== 'Optional');
          const sets = [...new Set(prods.map(p => p.boq_set || ''))].sort();
          const sel = h('select', sets.map(s => h('option', { value: s }, s || 'MOT (main catalog)')));
          const ok = await modal('Load a standard BOQ', h('div.grid', h('label', 'Standard BOQ', sel), lines.length ? h('p.muted', `The items are added below the ${lines.length} existing line(s).`) : null,
            h('p.muted', 'Add more standard BOQs (e.g. from an estimate Excel like “SS 304_MOT”) under CRM → Product Catalog → 📥 Import estimate Excel.')),
            [{ label: 'Cancel', value: false }, { label: 'Load', cls: 'primary', value: true }]);
          if (!ok) return;
          addProducts(prods.filter(p => (p.boq_set || '') === sel.value).sort((a, b) => a.sort - b.sort), lines); render();
        }) }, '⚡ Load standard BOQ'),
        h('button.btn.primary', { onclick: act(async () => { addProducts(await pickProducts(), lines); render(); }) }, '+ Add from catalog'),
        h('button.btn', { onclick: () => { lines.push({ id: uid('l'), kind: 'item', name: 'Custom item', description: '', uom: 'Each', rate: 0, install: 0, basis: 'manual', qty: {} }); markDirty(); render(); } }, '+ Custom line'),
        h('button.btn', { onclick: () => { lines.push({ id: uid('l'), kind: 'heading', name: 'Heading', description: '', qty: {} }); markDirty(); render(); } }, '+ Heading'),
      ] : null,
      rooms.length ? null : h('span.badge.warn', 'Add rooms first (Rooms & Basis of Design tab)'),
      // units for the UOM cells: pick one or type
      h('datalist', { id: 'q-uoms' }, [...new Set([...UOMS, 'Each', 'R. Ft', 'Sq. Ft', 'Job', ...lines.map(l => l.uom).filter(Boolean)])].map(u => h('option', { value: u }))));
    const BOQ_TITLE = h('input', { readOnly: !editable, value: data.boq_title || '', placeholder: 'BOQ title printed on Annexure', oninput: e => { data.boq_title = e.target.value; markDirty(); } });

    const head = h('tr', h('th', '#'), h('th', { style: { minWidth: '280px' } }, 'Particulars'), h('th.num', 'Rate'), h('th.num', 'Install.'), h('th.num', 'Basic rate'), h('th.num', { title: 'Blank = the quotation GST %' }, 'GST %'),
      h('th', 'UOM'), h('th', 'Qty basis'), rooms.map(r => h('th.num', { style: { minWidth: '76px' } }, r.name || 'Room')), h('th.num', 'Total qty'), h('th.num', 'Amount'), editable ? h('th') : null);

    const body = lines.map((l, i) => {
      const ctl = editable ? h('td.nowrap',
        h('button.icon-btn', { title: 'Move up', disabled: i === 0, onclick: () => { [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]]; markDirty(); render(); } }, '↑'),
        h('button.icon-btn', { title: 'Move down', disabled: i === lines.length - 1, onclick: () => { [lines[i + 1], lines[i]] = [lines[i], lines[i + 1]]; markDirty(); render(); } }, '↓'),
        l.kind !== 'heading' ? h('button.icon-btn', { title: l.sub ? 'Make main item' : 'Make sub-item of heading above', onclick: () => { l.sub = !l.sub; markDirty(); render(); } }, l.sub ? '⇤' : '↳') : null,
        h('button.icon-btn.del', { title: 'Remove', onclick: () => { lines.splice(i, 1); markDirty(); render(); } }, '✕')) : null;
      const name = h('input', { value: l.name || '', readOnly: !editable, style: { fontWeight: 600 }, oninput: e => { l.name = e.target.value; markDirty(); } });
      const spec = h('textarea.spec', { rows: 3, readOnly: !editable, placeholder: 'Specification printed in the BOQ', oninput: e => { l.description = e.target.value; markDirty(); } });
      spec.value = l.description || '';
      spec.style.display = 'none';
      const toggle = h('a', { href: 'javascript:void 0', style: { fontSize: '12px' }, onclick: () => { spec.style.display = spec.style.display === 'none' ? '' : 'none'; } }, 'specification ▾');
      const partCell = h('td', name, toggle, spec);
      if (l.kind === 'heading') {
        return h('tr.heading', h('td', nums[i]), h('td', { colspan: 7 + rooms.length + 2 }, name, toggle, spec), ctl);
      }
      const num = (key, w = 90) => {
        const inp = h('input', { type: 'number', step: 'any', readOnly: !editable, style: { width: w + 'px' } });
        inp.value = l[key] ?? '';
        inp.oninput = () => { l[key] = inp.value === '' ? 0 : Number(inp.value); markDirty(); };
        return h('td', inp);
      };
      const basicCellLine = h('td.num');
      const basisSel = h('select', { disabled: !editable, style: { width: '96px' } }, ['manual', ...AREA_BASES].map(b => h('option', { value: b }, b)));
      basisSel.value = l.basis || 'manual';
      basisSel.onchange = () => { l.basis = basisSel.value; markDirty(); render(); };
      const roomCells = rooms.map(r => {
        const inp = h('input.q', { type: 'number', step: 'any', readOnly: !editable });
        const isAuto = AREA_BASES.includes(l.basis);
        const set = l.qty?.[r.id];
        inp.value = set ?? '';
        if (isAuto) { inp.classList.toggle('auto', set === undefined || set === ''); autoInputs.push([inp, l, r]); }
        inp.oninput = () => {
          l.qty ||= {};
          if (inp.value === '') delete l.qty[r.id]; else l.qty[r.id] = Number(inp.value);
          if (isAuto) inp.classList.toggle('auto', inp.value === '');
          markDirty();
        };
        return h('td', inp);
      });
      qtyCells[l.id] = h('td.num');
      amountCells[l.id] = h('td.num');
      amountCells[l.id].basic = basicCellLine;
      const gstIn = h('input', { type: 'number', step: 'any', readOnly: !editable, style: { width: '58px' }, placeholder: String(quoteGst()) });
      gstIn.value = l.gst ?? '';
      gstIn.oninput = () => { l.gst = gstIn.value === '' ? null : Number(gstIn.value); markDirty(); };
      return h('tr', h('td', nums[i]), partCell, num('rate'), num('install', 80), basicCellLine, h('td', gstIn),
        h('td', h('input', { value: l.uom || '', readOnly: !editable, list: editable ? 'q-uoms' : null, autocomplete: 'off', style: { width: '70px' }, oninput: e => { l.uom = e.target.value; markDirty(); } })),
        h('td', basisSel), roomCells, qtyCells[l.id], amountCells[l.id], ctl);
    });
    const foot = h('tr', h('td', { colspan: 8 }, 'Basic total (room-wise)'), rooms.map(r => (roomTotalCells[r.id] = h('td.num'))), h('td'), (basicCell = h('td.num')), editable ? h('td') : null);

    live.refresh = t => {
      for (const l of lines) {
        if (!amountCells[l.id]) continue;
        amountCells[l.id].textContent = inr(t.lineTotals[l.id]?.amount);
        amountCells[l.id].basic.textContent = inr(lineBasicRate(l));
        qtyCells[l.id].textContent = t.lineTotals[l.id]?.qty ?? '';
      }
      for (const [inp, l, r] of autoInputs) inp.placeholder = String(lineQty({ ...l, qty: {} }, r));
      for (const r of rooms) roomTotalCells[r.id].textContent = inr(t.roomTotals[r.id]);
      basicCell.textContent = inr(t.basic);
    };
    return h('div', bar, h('label', { style: { marginBottom: '10px' } }, 'BOQ title', BOQ_TITLE),
      lines.length ? h('div.card.flush.table-wrap.q-scroll', h('table.data.boq.lines', h('thead', head), h('tbody', body), h('tfoot', foot)))
        : h('div.empty', 'No BOQ lines. Use “Load standard MOT BOQ” or add products from the catalog.'),
      h('p.muted', 'Blue quantity cells follow the room areas (walls / ceiling / coving / flooring); type a number to override, clear it to go back to automatic.'));
  }

  // ------------------------------------------------------------ Optional items
  function optionalTab() {
    const lines = data.optionals;
    const amounts = {};
    const rows = lines.map((l, i) => {
      const n = key => {
        const inp = h('input', { type: 'number', step: 'any', readOnly: !editable, style: { width: '100px' } });
        inp.value = l[key] ?? '';
        inp.oninput = () => { l[key] = Number(inp.value) || 0; markDirty(); };
        return h('td', inp);
      };
      amounts[l.id] = h('td.num');
      const spec = h('textarea', { rows: 2, readOnly: !editable, oninput: e => { l.description = e.target.value; markDirty(); } });
      spec.value = l.description || '';
      return h('tr', h('td', i + 1), h('td', h('input', { value: l.name, readOnly: !editable, style: { fontWeight: 600 }, oninput: e => { l.name = e.target.value; markDirty(); } }), spec),
        n('rate'), n('install'), h('td.num', inr(lineBasicRate(l))), n('qty'), h('td', l.uom), amounts[l.id],
        editable ? h('td', h('button.icon-btn.del', { onclick: () => { lines.splice(i, 1); markDirty(); render(); } }, '✕')) : null);
    });
    live.refresh = () => { for (const l of lines) amounts[l.id].textContent = inr(lineBasicRate(l) * (Number(l.qty) || 0)); };
    return h('div',
      editable ? h('div.toolbar', h('button.btn.primary', { onclick: act(async () => { addProducts(await pickProducts(true), lines); render(); }) }, '+ Add optional items')) : null,
      lines.length ? h('div.card.flush.table-wrap', h('table.data.lines', h('thead', h('tr', ['Sr', 'Optional item', 'Rate', 'Install.', 'Basic rate', 'Qty', 'UOM', 'Amount', ''].map(t => h('th', t)))), h('tbody', rows)))
        : h('div.empty', 'Optional items are quoted separately and are not included in the total.'));
  }

  // ------------------------------------------------------------ Summary
  function summaryTab() {
    const box = h('div');
    live.refresh = t => {
      const gst = head.gst_rate.get() ?? 18;
      box.replaceChildren(h('div.card', h('table.data',
        h('thead', h('tr', h('th', 'Sr.No'), h('th', 'Particulars'), h('th.num', 'Basic amount'))),
        h('tbody', data.rooms.map((r, i) => h('tr', h('td', i + 1), h('td', r.name), h('td.num', inr(t.roomTotals[r.id]))))),
        h('tfoot',
          h('tr', h('td'), h('td', 'TOTAL BASIC AMOUNT'), h('td.num', inr(t.basic))),
          t.discount ? h('tr', h('td'), h('td', `Discount ${head.discount_pct.get()}%`), h('td.num', '− ' + inr(t.discount))) : null,
          Object.entries(t.gstByRate || { [gst]: t.gst }).filter(([, v]) => v).map(([rate, v]) => h('tr', h('td'), h('td', `GST @${rate}%`), h('td.num', inr(v)))),
          h('tr', h('td'), h('td', 'ALL INCLUSIVE TOTAL AMOUNT'), h('td.num', inr(t.grand))))),
        h('p', h('b', amountInWords(t.grand)))));
    };
    return box;
  }

  // ------------------------------------------------------------ Letter, terms & scope
  function termsTab() {
    const ta = (val, set, rows = 6) => { const t = h('textarea', { rows, readOnly: !editable, oninput: e => { set(e.target.value); markDirty(); } }); t.value = val ?? ''; return t; };
    const chk = (key, label) => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 400 } },
      h('input', { type: 'checkbox', checked: data.annex[key] !== false, disabled: !editable, style: { width: 'auto' }, onchange: e => { data.annex[key] = e.target.checked; markDirty(); } }), label);
    return h('div.grid',
      h('div.card', h('h2', 'Covering letter'),
        h('label', 'Opening paragraph', ta(data.letter_intro, v => (data.letter_intro = v), 3)),
        h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '10px' } }, h('b', 'Annexures to print:'),
          chk('usp', 'WIESPL USP'), chk('bod', 'Basis of Design'), chk('summary', 'Summary'), chk('terms', 'Terms & conditions'), chk('scope', 'Client scope & scope matrix'))),
      h('div.card', h('h2', 'Terms & Conditions'), h('p.muted', 'One term per line.'),
        ta((data.terms || []).join('\n'), v => (data.terms = v.split('\n').filter(s => s.trim())), 12)),
      h('div.card', h('h2', 'Scope of work: client end'), ta(data.client_scope, v => (data.client_scope = v), 16)),
      scopeMatrix());
  }
  function scopeMatrix() {
    const m = data.scope_matrix;
    const box = h('div.card', h('h2', 'Scope sheet (WIESPL vs client)'));
    const draw = () => {
      box.replaceChildren(box.firstChild, h('table.data.lines', h('thead', h('tr', h('th', 'Particulars'), h('th', 'WIESPL scope'), h('th', 'Client scope'), h('th'))),
        h('tbody', m.map((row, i) => h('tr', [0, 1, 2].map(c => {
          const t = h('textarea', { rows: c ? 4 : 1, readOnly: !editable, oninput: e => { row[c] = e.target.value; markDirty(); } });
          t.value = row[c] || '';
          return h('td', t);
        }), editable ? h('td', h('button.icon-btn.del', { onclick: () => { m.splice(i, 1); markDirty(); draw(); } }, '✕')) : h('td'))))),
        editable ? h('button.btn.small', { style: { marginTop: '6px' }, onclick: () => { m.push(['', '', '']); markDirty(); draw(); } }, '+ Row') : null);
    };
    draw();
    return box;
  }

  const TABS = [['rooms', '1. Rooms & Basis of Design', roomsTab], ['boq', '2. BOQ', boqTab], ['optional', '3. Optional Items', optionalTab], ['summary', '4. Summary', summaryTab], ['terms', '5. Letter, Terms & Scope', termsTab]];
  function render() {
    live = { refresh: () => {} };
    tabs.replaceChildren(...TABS.map(([k, label]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { tab = k; sessionStorage.setItem('q-tab', k); render(); } }, label)));
    tabBody.replaceChildren(TABS.find(t => t[0] === tab)[2]());
    refresh();
  }

  root.replaceChildren(
    h('div.page-head', h('a.btn.small', { href: '#/list/quotations' }, '‹ Back'), h('h1', `🧾 ${q.quote_no}`), badge(q.status),
      q.approved_by ? h('span.muted', `approved by ${q.approved_by} ${q.approved_at || ''}`) : null,
      editable ? null : h('span.muted', '🔒 read-only (use Revise to change)'),
      h('div.actions', actions())),
    h('div.card', headGrid, h('div', { style: { marginTop: '12px' } }, strip)),
    tabs, tabBody);
  root.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && editable) { e.preventDefault(); act(() => save())(); } };
  render();
}
