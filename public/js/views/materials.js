// Material tracker of a project (server/materials.js): every material from BOQ shortage to PO to receipt, with the date
// it is needed and the date the vendor promised; late lines first. Purchase sets the dates right in the table.
import { h, api, toast, fail, fmtDate } from '../ui.js';

const CLS = { 'Not ordered': 'bad', Overdue: 'bad', 'Promised late': 'bad', 'No date from vendor': 'warn', 'Requisition, no PO yet': 'warn', 'PO not approved': 'warn',
  'On track': 'ok', 'Part received': 'ok', Received: 'done' };
const HELP = {
  'Not ordered': 'In the BOQ, short in the store, not asked for yet: raise the requisition by the order-by date',
  Overdue: 'The vendor\'s promised date has passed and it is not received: chase the vendor',
  'Promised late': 'The vendor promised it after the date it is needed: get an earlier date, or another vendor',
  'No date from vendor': 'Ask the vendor for a delivery date and enter it',
  'Requisition, no PO yet': 'Asked for, not ordered yet',
  'PO not approved': 'The PO is waiting for approval',
  'On track': 'Promised before it is needed', 'Part received': 'Partly in the store', Received: 'In the store',
};

export async function materialsView(root, projectId) {
  if (!projectId) {
    const { projects, unlinked } = await api('/materials/projects');
    root.replaceChildren(h('div.page-head', h('h1', '📦 Material tracker')),
      h('p.muted', 'For each project: every material it needs, when it is needed, when the vendor promised it, and what is in. Late material shows first.'),
      unlinked ? h('div.card.mt-warn', h('b', `⚠️ ${unlinked} open PO${unlinked === 1 ? ' is' : 's are'} not linked to a project.`),
        ' They cannot be tracked for a site until they are. Open a project below: the POs that look like its own are listed there with a Link button.') : null,
      h('div.card.flush.table-wrap', h('table.data', h('thead', h('tr', ['Project', 'POs linked', 'POs to link', ''].map(x => h('th', x)))),
        h('tbody', projects.map(p => h('tr', h('td', h('a', { href: `#/materials/${p.id}` }, [p.no, p.name].filter(Boolean).join(' · '))), h('td.num', p.pos || ''),
          h('td.num', p.to_link ? h('b.jr-late', p.to_link) : ''), h('td.muted', p.status || '')))))));
    return;
  }
  const d = await api(`/materials/${projectId}`);
  const draw = () => materialsView(root, projectId).catch(fail);
  const dateCell = (r, key) => {
    if (r.kind !== 'po' || !d.can_edit) return h('span', r[key] ? fmtDate(r[key]) : '—');
    const inp = h('input', { type: 'date', value: (key === 'need_by' ? (r.need_set ? r.need_by : '') : (r.promised_set ? r.promised : '')) || '', title: key === 'need_by' ? 'Needed in the store by (empty = the project date)' : 'Date the vendor promised (empty = the PO delivery date)' });
    inp.onchange = async () => {
      try { await api(`/materials/po/${r.po_id}/line/${r.line}`, { method: 'PUT', body: { [key]: inp.value || null } }); toast('Saved'); draw(); } catch (e) { fail(e); }
    };
    const shown = key === 'need_by' ? (!r.need_set && r.need_by ? h('div.muted', `project: ${fmtDate(r.need_by)}`) : null) : (!r.promised_set && r.promised ? h('div.muted', `PO: ${fmtDate(r.promised)}`) : null);
    return h('div', inp, shown);
  };
  const ref = r => (r.kind === 'po' ? h('a', { href: `#/view/purchase_orders/${r.po_id}` }, r.po_no || `PO #${r.po_id}`) : r.kind === 'req' ? h('a', { href: `#/view/requisitions/${r.req_id}` }, r.req_no || 'Requisition')
    : h('a', { href: `#/bom/${r.bom_id}` }, r.bom_no || 'BOQ'));
  const states = Object.entries(d.count).filter(([, n]) => n);
  const link = async (poId, pid) => { await api(`/materials/po/${poId}/project`, { method: 'PUT', body: { project_id: pid } }); toast(pid ? 'Linked' : 'Unlinked'); draw(); };
  const toLink = d.to_link?.length ? h('div.card.mt-warn', h('h2', `🔗 POs that look like this project's (${d.to_link.length})`),
    h('p.muted', 'These open POs are not linked to any project; their note matches this one. Link the ones that are for this site.'),
    h('div.table-wrap', h('table.data', h('thead', h('tr', ['PO', 'Date', 'Vendor', 'Note on the PO', 'Matched by', ''].map(x => h('th', x)))),
      h('tbody', d.to_link.map(p => h('tr', h('td', h('a', { href: `#/view/purchase_orders/${p.id}` }, p.po_no || `#${p.id}`)), h('td.nowrap', fmtDate(p.date)), h('td', p.vendor || ''),
        h('td', p.project_note || ''), h('td.muted', p.suggest?.why || ''), h('td', d.can_edit ? h('button.btn.small.primary', { type: 'button', onclick: () => link(p.id, d.project.id).catch(fail) }, '🔗 Link') : null))))))) : null;
  root.replaceChildren(
    h('div.page-head', h('h1', '📦 Material tracker: ', [d.project.no, d.project.name].filter(Boolean).join(' · ')),
      h('div.actions', h('a.btn', { href: '#/materials' }, 'All projects'), h('a.btn', { href: `#/planner/${d.project.id}` }, '📅 Planner'))),
    h('div.card', h('div', h('b', 'Needed in the store by: '), d.needed_by.date ? fmtDate(d.needed_by.date) : '—', h('span.muted', ` (${d.needed_by.from})`)),
      h('div.mt-states', states.length ? states.map(([s, n]) => h('span', { class: `mt-state ${CLS[s]}`, title: HELP[s] }, `${s}: ${n}`)) : h('span.muted', 'Nothing to track yet: no BOQ shortage, requisition or PO for this project.')),
      d.ready ? h('div.mt-ready', '✅ Everything is in the store: ready for the one-time dispatch') : null,
      storePanel(d.store, { open: true })),
    toLink,
    d.rows.length ? h('div.card.flush.table-wrap', h('table.data.mt-table', h('thead', h('tr', ['Status', 'Material', 'Qty', 'Received', 'Order / PO', 'Vendor', 'Needed by', 'Promised', 'Late'].map(x => h('th', x)))),
      h('tbody', d.rows.map(r => h('tr', { class: CLS[r.state] === 'bad' ? 'mt-bad' : '' },
        h('td', h('span', { class: `mt-state ${CLS[r.state]}`, title: HELP[r.state] }, r.state), r.order_by && r.kind === 'boq' ? h('div', { class: r.late_days ? 'jr-late' : 'muted' }, `order by ${fmtDate(r.order_by)}`) : null),
        h('td', r.item), h('td.num', `${r.qty} ${r.uom || ''}`), h('td.num', r.kind === 'po' ? r.received : ''), h('td', ref(r), r.po_date ? h('div.muted', fmtDate(r.po_date)) : null, r.follow ? h('div.mt-follow', { title: r.follow.note || '' }, `📞 ${fmtDate(r.follow.date)} ${r.follow.vendor_status || ''}${r.follow.next_on ? ` · next ${fmtDate(r.follow.next_on)}` : ''}`) : null),
        h('td', r.vendor || ''), h('td', dateCell(r, 'need_by')), h('td', dateCell(r, 'promised')), h('td.num', r.late_days ? h('b.jr-late', `${r.late_days} d`) : '')))))) : null);
}

// "Is everything in the store?" before the one-time dispatch: every BOQ material received and QC passed, and what is missing.
// Shows only; nothing is blocked. Used on the material tracker and on the journey step "Freeze panel design, make the dispatch checklist".
export function storePanel(s, { open = false } = {}) {
  if (!s) return null;
  if (!s.has_boq) return h('div.mt-store', h('b', '🏬 Store check before dispatch: '), h('span.muted', 'no Final BOQ for this project yet, so there is nothing to check.'));
  const head = s.complete ? h('b.mt-ready', `✅ Store check: all ${s.lines} BOQ lines are in the store and QC passed`)
    : h('b.jr-late', `🏬 Store check: ${s.ready} of ${s.lines} BOQ lines are in the store and QC passed, ${s.missing.length} missing`);
  const table = s.missing.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Material', 'BOQ', 'Needed', 'In store (QC passed)', 'Missing', 'Why'].map(x => h('th', x)))),
    h('tbody', s.missing.map(m => h('tr', h('td', m.item), h('td', h('a', { href: `#/bom/${m.bom_id}` }, m.bom_no || 'BOQ')), h('td.num', `${m.needed} ${m.uom || ''}`), h('td.num', m.in_store),
      h('td.num', h('b.jr-late', m.short)), h('td', m.why)))))) : null;
  return h('div.mt-store', s.missing.length ? h('details', { open }, h('summary', head), table) : head,
    h('div.muted', 'For information only: nothing is blocked. Dispatch can still go ahead.'));
}
