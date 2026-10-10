// Project work order BOQ: what is dispatched, delivered and still pending; make delivery challans from it.
import { h, api, state, toast, fail, modal, badge, fmtDate } from '../ui.js';
import { canWrite } from '../schema.js';
import { round2 } from '../calc.js';

const firstLine = s => String(s || '').split('\n')[0];

export async function projectBoqView(root, projectId) {
  const [project, rows, challans] = await Promise.all([
    api(`/projects/${projectId}`), api(`/boq_items?project_id=${projectId}&limit=20000`), api(`/challans?project_id=${projectId}`),
  ]);
  const canBoq = canWrite('boq_items', state.user.role), canChallan = canWrite('challans', state.user.role);
  rows.sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id));
  const items = rows.filter(r => r.kind !== 'Heading');
  const filter = h('select', { style: { width: 'auto' } }, ['All lines', 'Pending only', 'Delivered ✓', 'Qty TBD'].map(t => h('option', t)));
  const search = h('input.grow', { type: 'search', placeholder: 'Search description, Sr. no …' });
  const picks = new Map(); // boq id → qty
  const out = h('div');
  const pickCount = h('b');

  const totals = list => {
    const it = list.filter(r => r.kind !== 'Heading');
    return { lines: it.length, delivered: it.filter(r => r.delivery_status === 'Delivered').length, dispatched: it.filter(r => ['Dispatched', 'Delivered'].includes(r.delivery_status)).length,
      pending: it.filter(r => ['Pending', 'Partly Dispatched'].includes(r.delivery_status)).length };
  };
  const all = totals(rows);

  function draw() {
    const q = search.value.toLowerCase().trim();
    const keep = r => {
      if (r.kind === 'Heading') return !q && filter.value === 'All lines';
      if (q && !`${r.sr_no} ${r.heading} ${r.description}`.toLowerCase().includes(q)) return false;
      if (filter.value === 'Pending only') return ['Pending', 'Partly Dispatched'].includes(r.delivery_status) || (r.qty == null && r.delivery_status !== 'Delivered');
      if (filter.value === 'Delivered ✓') return r.delivery_status === 'Delivered';
      if (filter.value === 'Qty TBD') return r.qty == null;
      return true;
    };
    const sections = [...new Set(rows.map(r => r.section || 'BOQ'))];
    out.replaceChildren(...sections.map(sec => {
      const secRows = rows.filter(r => (r.section || 'BOQ') === sec);
      const t = totals(secRows);
      const shown = secRows.filter(keep);
      if (!shown.length && q) return null;
      const pct = t.lines ? Math.round((t.delivered / t.lines) * 100) : 0;
      return h('div.card.flush', { style: { marginBottom: '16px' } },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' } },
          h('h2', { style: { margin: 0 } }, sec), secRows[0]?.wo_no ? h('span.muted', `WO ${secRows[0].wo_no}`) : null,
          h('span', { style: { marginLeft: 'auto' } }, `${t.delivered} of ${t.lines} lines delivered ✓ · ${t.pending} pending`),
          h('div', { style: { width: '160px', height: '8px', background: 'var(--neutral-bg)', borderRadius: '4px', overflow: 'hidden' } },
            h('div', { style: { width: pct + '%', height: '100%', background: 'var(--good)' } }))),
        h('div.table-wrap', h('table.data',
          h('thead', h('tr', canChallan ? h('th', '') : null, ['', 'Sr', 'Description', 'UOM', 'WO Qty', 'Per area', 'Dispatched', 'Delivered', 'Pending', 'Status'].map((x, i) => h('th' + (i >= 4 && i <= 8 && i !== 5 ? '.num' : ''), x)),
            canChallan ? h('th.num', 'Send now') : null)),
          h('tbody', shown.map(r => {
            if (r.kind === 'Heading') return h('tr', h('td', { colspan: canChallan ? 12 : 10, style: { background: 'var(--surface-2)', fontWeight: 600 } }, `${r.sr_no ? r.sr_no + '  ' : ''}${firstLine(r.description)}`));
            const done = r.delivery_status === 'Delivered';
            const sendable = !done && (r.qty == null || r.pending > 0);
            const qtyIn = h('input', { type: 'number', step: 'any', min: 0, style: { width: '80px' }, value: picks.get(r.id) ?? (r.pending ?? ''), placeholder: r.qty == null ? 'qty' : '' });
            const chk = h('input', { type: 'checkbox', checked: picks.has(r.id), disabled: !sendable, style: { width: 'auto' } });
            const sync = () => { if (chk.checked) picks.set(r.id, qtyIn.value === '' ? null : Number(qtyIn.value)); else picks.delete(r.id); pickCount.textContent = picks.size; };
            chk.onchange = sync;
            qtyIn.oninput = () => { if (!chk.checked && qtyIn.value) chk.checked = true; sync(); };
            const desc = h('td', { style: { maxWidth: '520px' } },
              r.heading ? h('div.muted', { style: { fontSize: '11px' } }, r.heading) : null,
              h('a', { href: `#/view/boq_items/${r.id}` }, firstLine(r.description)),
              r.description.includes('\n') ? h('details', h('summary.muted', { style: { fontSize: '11px' } }, 'full specification'), h('div.spec', { style: { fontSize: '12px', whiteSpace: 'pre-wrap' } }, r.description)) : null,
              r.item_id_label ? h('div.muted', { style: { fontSize: '11px' } }, `store item: ${r.item_id_label}`) : null,
              r.remarks ? h('div.muted', { style: { fontSize: '11px' } }, r.remarks) : null);
            return h('tr', { style: { opacity: done ? 0.75 : 1 } },
              canChallan ? h('td', chk) : null,
              h('td', { style: { fontSize: '18px', color: done ? 'var(--good)' : 'var(--muted)' } }, done ? '✓' : r.delivery_status === 'Dispatched' ? '🚚' : ''),
              h('td.nowrap', r.sr_no || ''), desc, h('td', r.uom || ''), h('td.num', r.qty ?? h('span.muted', 'TBD')), h('td.muted', { style: { fontSize: '12px' } }, r.area_qty || ''),
              h('td.num', r.dispatched || ''), h('td.num', r.delivered || ''), h('td.num', { style: { fontWeight: 600 } }, r.pending ?? ''), h('td', badge(r.delivery_status)),
              canChallan ? h('td.num', sendable ? qtyIn : '') : null);
          })))));
    }));
  }

  async function makeChallan() {
    if (!picks.size) throw new Error('Tick the BOQ lines to send');
    const body = { picks: [...picks].map(([boq_item_id, qty]) => ({ boq_item_id, qty })) };
    const ch = await api(`/projects/${projectId}/challan`, { method: 'POST', body });
    toast(`Challan ${ch.challan_no} created as Draft: add vehicle / transporter, then Dispatch.`);
    location.hash = `#/view/challans/${ch.id}`;
  }

  async function importWo() {
    const file = h('input', { type: 'file', accept: '.xlsx' });
    const mode = h('select', h('option', { value: 'append' }, 'Add to the existing BOQ'), h('option', { value: 'replace' }, 'Replace the existing BOQ (only if nothing dispatched yet)'));
    const ok = await modal('Import work order BOQ', h('div.grid',
      h('p', 'Upload the work order Excel (e.g. "Electrical & HVAC - Work Order 1 - Lokmany Hospital.xlsx"). Every sheet with "Sr. No." and "Particulars"/"Description" columns becomes a section: MOT, Passage, MGPS, Electrical …'),
      h('label', 'Work order file', file), rows.length ? h('label', 'This project already has a BOQ', mode) : null),
      [{ label: 'Cancel', value: false }, { label: 'Import', cls: 'primary', value: true }]);
    if (!ok) return;
    if (!file.files[0]) throw new Error('Choose the work order file');
    const r = await api(`/projects/${projectId}/boq/import${rows.length ? '?mode=' + mode.value : ''}`, { method: 'POST', raw: await file.files[0].arrayBuffer() });
    toast(`Imported: ${r.sections.map(s => `${s.section} ${s.items}`).join(', ')}`);
    projectBoqView(root, projectId);
  }

  filter.onchange = draw;
  search.oninput = draw;
  root.replaceChildren(
    h('div.page-head', h('a.btn.small', { href: `#/view/projects/${projectId}` }, '‹ Project'),
      h('h1', `📑 Work Order & Dispatch`), h('span.muted', `${project.project_no || project.code} · ${project.name}`),
      h('div.actions',
        canBoq ? h('button.btn', { onclick: () => importWo().catch(fail) }, '📥 Import work order') : null,
        canBoq ? h('a.btn', { href: `#/edit/boq_items/new?project_id=${projectId}` }, '+ BOQ line') : null,
        canChallan && rows.length ? h('button.btn.primary', { onclick: () => makeChallan().catch(fail) }, '🚚 Make challan (', pickCount, ')') : null)),
    rows.length ? h('div.kpis',
      h('div.kpi', h('div.label', 'BOQ lines'), h('div.value', all.lines)),
      h('div.kpi', h('div.label', 'Delivered ✓'), h('div.value', all.delivered), h('div.sub', `${all.lines ? Math.round(all.delivered / all.lines * 100) : 0}% of lines`)),
      h('div.kpi', h('div.label', 'Dispatched / in transit'), h('div.value', all.dispatched - all.delivered)),
      h('div.kpi', h('div.label', 'Pending'), h('div.value', all.pending), h('div.sub', `${items.filter(r => r.qty == null).length} lines with qty TBD`)),
      h('div.kpi', h('div.label', 'Challans'), h('div.value', challans.length), h('div.sub', `${challans.filter(c => c.status === 'Draft').length} draft`))) : null,
    rows.length ? h('div.toolbar', search, filter, h('span.muted', 'Tick lines (quantity defaults to the pending qty) and press “Make challan”.')) : h('div.card', h('p', 'No BOQ yet for this project. Import the work order Excel, or add lines by hand.')),
    out,
    challans.length ? h('div.card', h('h2', '🚚 Challans for this project'), h('table.data', h('thead', h('tr', ['Challan', 'Date', 'Vehicle', 'Lines', 'Status', 'Delivered', 'Received by'].map(x => h('th', x)))),
      h('tbody', challans.map(c => h('tr.clickable', { onclick: () => (location.hash = `#/view/challans/${c.id}`) },
        h('td', c.challan_no), h('td', fmtDate(c.date)), h('td', c.vehicle_no || ''), h('td', (c.lines || []).length || ''), h('td', badge(c.status)), h('td', fmtDate(c.delivered_date)), h('td', c.received_by || '')))))) : null);
  draw();
}
