// Standard Material Lists from an engineers' bill of material Excel: one list per BOQ section.
import { h, api, toast, modal, refOptions, clearRefCache } from '../ui.js';
import { DEPARTMENTS } from '../schema.js';
import { itemPicker } from './form.js';

export async function importMaterialLists() {
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const ok = await modal('Standard Material Lists from a bill of material', h('div.grid',
    h('p', 'Choose a bill of material Excel in the WIESPL format (SR.NO., COMPONENT NAME, SPECIFICATIONS, DIMENSIONS, QTY …). Every section (PLENUM, RISER, MODULAR WALL / CEILING PANEL, CONTROL PANEL …) becomes one Standard Material List. Next you choose which sections, and how their quantities relate to the work order.'),
    h('label', 'Bill of material Excel', file)), [{ label: 'Cancel', value: false }, { label: 'Next ›', cls: 'primary', value: true }]);
  if (!ok) return;
  const f = file.files[0];
  if (!f) throw new Error('Choose the Excel file');
  const p = await api('/material_lists/import-preview', { method: 'POST', raw: await f.arrayBuffer() });
  const items = await refOptions('items');
  const sec = p.sections.map(s => ({ ...s, include: s.used > 0, name: s.section, per_qty: '', per_uom: 'Nos', match_words: s.section.toLowerCase().split(/[\/,&+]/).map(w => w.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(w => w.length > 2).join(', '), makes_item_id: null,
    rows: s.rows.map(r => ({ ...r, include: r.qty > 0 })) }));
  const body = sec.map(s => {
    const inc = h('input', { type: 'checkbox', checked: s.include, style: { width: 'auto' } });
    inc.onchange = () => { s.include = inc.checked; };
    const inp = (k, attrs = {}) => { const el = h('input', { value: s[k] ?? '', ...attrs }); el.oninput = () => { s[k] = el.value; }; return el; };
    const dept = h('select', DEPARTMENTS.map(d => h('option', d)));
    dept.value = s.department; dept.onchange = () => { s.department = dept.value; };
    const rows = h('table.data', h('thead', h('tr', ['Use', 'Component', 'Dimensions / spec', 'Qty in file', 'UOM', 'Per job', 'Store item'].map(x => h('th', x)))),
      h('tbody', s.rows.map(r => {
        const use = h('input', { type: 'checkbox', checked: r.include, style: { width: 'auto' } }); use.onchange = () => { r.include = use.checked; };
        const job = h('input', { type: 'checkbox', checked: r.per_job, style: { width: 'auto' }, title: 'Fixed quantity once per BOQ (consumables, tools)' }); job.onchange = () => { r.per_job = job.checked; };
        return h('tr', { style: { opacity: r.qty > 0 ? 1 : 0.55 } }, h('td', use), h('td', r.description || ''), h('td', { style: { fontSize: '12px' } }, [r.dimensions, r.spec].filter(Boolean).join(' · ').slice(0, 90)),
          h('td.num', r.qty ?? ''), h('td', r.uom || ''), h('td', job),
          h('td', { style: { minWidth: '200px' } }, itemPicker(items, r.item_id, { onPick: id => { r.item_id = id; } })));
      })));
    return h('details.card', { style: { marginBottom: '8px' } },
      h('summary', { style: { cursor: 'pointer' } }, inc, ' ', h('b', s.section), h('span.muted', `  ${s.used} of ${s.rows.length} rows with qty`)),
      h('div.form-grid', { style: { marginTop: '8px' } },
        h('label', 'List name', inp('name')), h('label', 'Department', dept),
        h('label', 'Per unit of (qty in the work order this BOQ was for)', h('span', { style: { display: 'flex', gap: '6px' } }, inp('per_qty', { type: 'number', step: 'any', placeholder: 'blank = per job', style: { width: '120px' } }), inp('per_uom', { style: { width: '90px' } }))),
        h('label', 'Match words (work-order text)', inp('match_words')),
        h('label', 'Sub-assembly: this section builds store item', itemPicker(items, null, { onPick: id => { s.makes_item_id = id; } }))),
      h('p.muted', { style: { fontSize: '12px' } }, 'Per unit of: e.g. 1088 Sq. Ft for wall + ceiling panels, or 1 Nos for one plenum. Quantities of rows not ticked “Per job” are divided by it. Blank = every row is a fixed quantity per job.'),
      h('div.table-wrap', { style: { maxHeight: '300px' } }, rows));
  });
  const go = await modal(`Sections in ${f.name}${p.client ? ' – ' + p.client : ''}`, h('div', { style: { maxHeight: '65vh', overflow: 'auto' } },
    h('p.muted', 'Ticked sections become lists. Rows with qty 0 (template rows) are left out unless you tick them. Consumables and tools are pre-ticked “Per job”.'), body),
  [{ label: 'Cancel', value: false }, { label: '🧩 Create lists', cls: 'primary', value: true }], { wide: true });
  if (!go) return;
  const r = await api('/material_lists/import', { method: 'POST', body: { file: f.name, client: p.client, sections: sec } });
  clearRefCache('material_lists');
  toast(`${r.lists.length} Standard Material List(s) created: ${r.lists.map(l => `${l.name} (${l.components})`).join(', ').slice(0, 200)}`);
  location.hash = `#/list/material_lists?t=${Date.now()}`;
}
