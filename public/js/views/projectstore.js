// Project Store (Store, Purchase and Projects menus): pick a project and see, item by item, what its BOQs need, what is
// ordered for it, what came in for it, what went to the site, what the store holds for it now and what is pending —
// with its slips, POs, challans and material requests underneath (server/projectstore.js).
import { h, api, fail, money, fmtDate, badge, hashParams, setHashQuery } from '../ui.js';
import { MOVE_TYPES } from '../schema.js';
import { round2 } from '../calc.js';
import { itemPicker } from './form.js';

const STATE_COLOR = { Short: 'var(--bad)', 'On order': 'var(--warn)', 'In store': 'var(--good)', Ready: 'var(--good)', Sent: 'var(--muted)', Done: 'var(--muted)' };
const TABS = [['items', '📦 Material'], ['moves', '🔁 Inward / outward'], ['slips', '🗂️ Store slips'], ['pos', '🛒 POs'], ['challans', '🚚 Challans'], ['mrs', '🙋 Material requests']];
const n = v => (Number(v) ? round2(v) : '');
const IN_T = ['INWARD', 'JOB_IN', 'PRODUCED', 'RETURN', 'OPENING', 'ADJUST'];
// What the Material tab shows (the same as the tiles above it)
const SHOW = [['', 'All material'], ['store', '📦 In store for it'], ['order', '🚚 Pending from vendor'], ['send', '🏗️ Pending to site'], ['short', '⚠ Short']];
const DIRS = [['', 'All'], ['in', '⬇ Inward (GRN, production, return)'], ['out', '⬆ Outward (issue, challan, transfer, scrap)']];

export async function projectStoreView(root, idArg) {
  const projects = await api('/project-store');
  const opts = projects.map(p => ({ id: p.id, label: `${p.no || ''} ${p.name}${p.status && ['Completed', 'Cancelled'].includes(p.status) ? ` · ${p.status}` : ''}${p.moves ? '' : ' · nothing in store yet'}`.trim() }));
  let pid = Number(idArg) || null;
  const hp = hashParams();
  let tab = TABS.some(t => t[0] === hp.get('tab')) ? hp.get('tab') : 'items', only = hp.get('show') || '', dir = hp.get('dir') || '', moveItem = Number(hp.get('item')) || null, find = '';
  const openItems = new Set();
  const out = h('div');
  const go = id => { location.hash = id ? `#/project-store/${id}${tab !== 'items' ? `?tab=${tab}` : ''}` : '#/project-store'; };
  root.replaceChildren(h('div.page-head', h('h1', '🏗️ Project Store')),
    h('p.muted', 'Everything the store has to do with one project: what its BOQs need, what is ordered for it, what came in for it, what went to the site, what the store still holds for it and what is pending.'),
    h('div.toolbar', h('label', { style: { minWidth: '340px' } }, 'Project', itemPicker(opts, pid, { onPick: id => go(id) }))), out);
  if (!pid) { out.replaceChildren(h('div.card', h('div.empty', 'Choose a project above.'))); return; }
  let d;
  try { d = await api(`/project-store/${pid}`); } catch (e) { fail(e); return; }
  const t = d.totals;
  const kpi = (label, value, filter) => h('button.card', { type: 'button', style: { textAlign: 'left', cursor: 'pointer', padding: '10px 14px', border: only === filter && filter ? '2px solid var(--primary)' : '' },
    onclick: () => { only = only === filter ? '' : filter; tab = 'items'; draw(); } }, h('div.muted', { style: { fontSize: '12px' } }, label), h('div', { style: { fontSize: '20px', fontWeight: 700 } }, value));
  const body = h('div');
  const tabs = h('div.tabs');
  const table = (head, rows, empty) => (rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', head.map(x => h(/^(Qty|Items|Needed|Ordered|Received|Came in|Went out|In store|To receive|To send|Short|Value|Total)/.test(x) ? 'th.num' : 'th', x)))), h('tbody', rows)))) : h('div.card', h('div.empty', empty)));
  // The stock lines of this project (optionally one item, inward or outward), each with its slip.
  const movesTable = async (box, q, compact) => {
    box.replaceChildren(h('p.muted', 'Loading…'));
    try {
      const ls = await api(`/stock/lines?project=${pid}${q}&limit=2000`);
      const inQ = round2(ls.filter(m => IN_T.includes(m.type)).reduce((a, m) => a + (Number(m.qty) || 0), 0)), outQ = round2(ls.filter(m => !IN_T.includes(m.type)).reduce((a, m) => a + (Number(m.qty) || 0), 0));
      box.replaceChildren(ls.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Type', 'No', compact ? null : 'Item', 'In', 'Out', 'UOM', 'Supplier / site / to', 'PO'].filter(Boolean).map(x => h(['In', 'Out'].includes(x) ? 'th.num' : 'th', x)))),
        h('tbody', ls.map(m => h('tr', h('td.nowrap', fmtDate(m.date)), h('td.nowrap', MOVE_TYPES[m.type]?.label || m.type),
          h('td.nowrap', h('a', { href: `#/stock-movements?type=${m.type}&q=${encodeURIComponent(m.doc_no || '')}` }, m.doc_no || '—')),
          compact ? null : h('td', { style: { minWidth: '220px' } }, [m.code, m.item].filter(Boolean).join(' · ')),
          h('td.num', IN_T.includes(m.type) ? round2(m.qty) : ''), h('td.num', IN_T.includes(m.type) ? '' : round2(m.qty)), h('td', m.uom || ''),
          h('td.clip', [m.party, m.issued_to, m.to_location && `→ ${m.to_location}`].filter(Boolean).join(' · ')), h('td.nowrap', m.po_no || '')))),
        h('tfoot', h('tr', h('td', { colspan: compact ? 3 : 4 }, h('b', `${ls.length} line${ls.length === 1 ? '' : 's'}`)), h('td.num', h('b', inQ)), h('td.num', h('b', outQ)), h('td', { colspan: 3 }, h('b', `net ${round2(inQ - outQ)}`))))))
        : h('div.empty', 'No stock lines for this project here.'));
    } catch (e) { fail(e); }
  };
  function draw() {
    setHashQuery(new URLSearchParams(Object.entries({ tab: tab === 'items' ? '' : tab, show: tab === 'items' ? only : '', dir: tab === 'moves' ? dir : '', item: tab === 'moves' && moveItem ? moveItem : '' }).filter(([, v]) => v)).toString());
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { tab = k; draw(); } }, l,
      k === 'moves' ? null : h('span.muted', { style: { marginLeft: '4px', fontSize: '11px' } }, String({ items: d.rows.length, slips: d.slips.length, pos: d.pos.length, challans: d.challans.length, mrs: d.mrs.length }[k])))));
    if (tab === 'moves') {
      const box = h('div.card.flush');
      const itemOpts = d.rows.filter(r => r.item_id).map(r => ({ id: r.item_id, label: [r.code, r.name].filter(Boolean).join(' · ') }));
      body.replaceChildren(h('div.toolbar', h('div.tabs', { style: { margin: 0 } }, DIRS.map(([k, l]) => h('button', { class: k === dir ? 'active' : '', onclick: () => { dir = k; draw(); } }, l))),
        h('label', { style: { minWidth: '280px' } }, 'Item', itemPicker(itemOpts, moveItem, { onPick: id => { moveItem = id || null; draw(); } }))), box);
      movesTable(box, `${dir ? `&dir=${dir}` : ''}${moveItem ? `&item=${moveItem}` : ''}`, !!moveItem);
    } else if (tab === 'items') {
      const q = find.trim().toLowerCase();
      const rows = d.rows.filter(r => (!only || (only === 'short' ? r.state === 'Short' : only === 'order' ? r.to_receive > 0 : only === 'store' ? r.in_store > 0 : only === 'send' ? r.to_send > 0 : true))
        && (!q || `${r.code} ${r.name}`.toLowerCase().includes(q)));
      const search = h('input', { type: 'search', placeholder: 'Find an item…', value: find, oninput: e => { find = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => { draw(); const el = body.querySelector('input[type=search]'); el?.focus(); el?.setSelectionRange(find.length, find.length); }, 250); } });
      const tr = [];
      for (const r of rows) {
        const key = r.item_id || r.name, exp = openItems.has(key);
        tr.push(h('tr', { class: r.item_id ? 'clickable' : '', title: r.item_id ? 'Click to see the inward / outward lines of this item for the project' : '', onclick: e => { if (!r.item_id || e.target.closest('a')) return; exp ? openItems.delete(key) : openItems.add(key); draw(); } },
          h('td', { style: { minWidth: '240px' } }, r.item_id ? [exp ? '▾ ' : '▸ ', h('a', { href: `#/view/items/${r.item_id}` }, [r.code, r.name].filter(Boolean).join(' · '))] : h('span', r.name, h('span.muted', ' (no store item)'))), h('td', r.uom || ''),
          h('td.num', n(r.required)), h('td.num', n(r.ordered)), h('td.num', n(r.received_po)), h('td.num', n(r.to_receive)), h('td.num', n(r.came_in)), h('td.num', n(r.went_out)),
          h('td.num', h('b', { style: { color: r.in_store < 0 ? 'var(--bad)' : '' } }, n(r.in_store) || (r.came_in || r.went_out ? '0' : ''))), h('td.num', n(r.to_send)), h('td.num', { style: { color: r.short ? 'var(--bad)' : '' } }, n(r.short)),
          d.prices ? h('td.num', r.value ? money(r.value) : '') : null, h('td', h('span', { style: { color: STATE_COLOR[r.state], fontWeight: 600 } }, r.state))));
        if (exp) { const cell = h('td', { colspan: d.prices ? 13 : 12, style: { background: 'var(--bg)' } }); tr.push(h('tr', cell)); movesTable(cell, `&item=${r.item_id}`, true); }
      }
      body.replaceChildren(h('div.toolbar', h('div.tabs', { style: { margin: 0 } }, SHOW.map(([k, l]) => h('button', { class: k === only ? 'active' : '', onclick: () => { only = k; draw(); } }, l,
        h('span.muted', { style: { marginLeft: '4px', fontSize: '11px' } }, String(k === '' ? d.rows.length : k === 'store' ? t.in_store : k === 'order' ? t.on_order : k === 'send' ? t.to_send : t.short))))), search),
        table(['Item', 'UOM', 'Needed (BOQ)', 'Ordered', 'Received on PO', 'To receive', 'Came in', 'Went out', 'In store now', 'To send', 'Short', d.prices ? 'Value in store' : null, 'State'].filter(Boolean),
        tr,
        only ? 'Nothing in this filter.' : 'Nothing for this project in the store, on POs or on its BOQs yet.'),
        h('p.muted', { style: { fontSize: '12px' } }, 'Click an item to see its inward / outward lines for this project. Came in = GRN, production, return and job work booked to this project. Went out = issue, challan, transfer, scrap. In store now = came in − went out. To send = BOQ need not yet sent. Short = still to send that is neither in store for it nor on order.'));
    } else if (tab === 'slips') {
      body.replaceChildren(table(['Date', 'Type', 'No', 'Supplier / to', 'Items', 'Qty'], d.slips.map(s => h('tr.clickable', { onclick: () => { location.hash = `#/stock-movements?type=${s.type}&q=${encodeURIComponent(s.doc_no || '')}`; } },
        h('td.nowrap', fmtDate(s.date)), h('td', MOVE_TYPES[s.type]?.label || s.type), h('td', h('b', s.doc_no || '—')), h('td.clip', s.party || ''), h('td.num', s.items), h('td.num', round2(s.qty)))), 'No store slips for this project.'));
    } else if (tab === 'pos') {
      body.replaceChildren(table(['PO', 'Date', 'Vendor', 'Lines for this project', 'Status', d.prices ? 'Total' : null].filter(Boolean), d.pos.map(p => h('tr.clickable', { onclick: () => { location.hash = `#/view/purchase_orders/${p.id}`; } },
        h('td', h('b', p.po_no || `#${p.id}`)), h('td.nowrap', fmtDate(p.date)), h('td.clip', p.vendor || ''), h('td.num', p.lines), h('td', badge(p.status)), d.prices ? h('td.num', money(p.total)) : null)), 'No POs for this project.'));
    } else if (tab === 'challans') {
      body.replaceChildren(table(['Challan', 'Date', 'Type', 'Items', 'Status'], d.challans.map(c => h('tr.clickable', { onclick: () => { location.hash = `#/view/challans/${c.id}`; } },
        h('td', h('b', c.challan_no || `#${c.id}`)), h('td.nowrap', fmtDate(c.date)), h('td', c.challan_type || ''), h('td.num', c.items), h('td', badge(c.status)))), 'No delivery challans for this project.'));
    } else {
      body.replaceChildren(table(['MR', 'Date', 'Requested by', 'For', 'Status'], d.mrs.map(m => h('tr.clickable', { onclick: () => { location.hash = `#/view/material_requests/${m.id}`; } },
        h('td', h('b', m.mr_no || `#${m.id}`)), h('td.nowrap', fmtDate(m.date)), h('td', m.requested_by || ''), h('td.clip', m.purpose || ''), h('td', badge(m.status)))), 'No material requests for this project.'));
    }
    kpis.replaceChildren(kpi('Items', t.items, ''), kpi('In store for it', t.in_store, 'store'), kpi('On order', t.on_order, 'order'), kpi('Still to send', t.to_send, 'send'), kpi('Short', t.short, 'short'),
      d.prices ? h('div.card', { style: { padding: '10px 14px' } }, h('div.muted', { style: { fontSize: '12px' } }, 'Value in store for it'), h('div', { style: { fontSize: '20px', fontWeight: 700 } }, money(t.value))) : null);
  }
  const kpis = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', margin: '10px 0' } });
  out.replaceChildren(h('h2', { style: { margin: '6px 0' } }, `${d.project.no || ''} ${d.project.name}`, h('span.muted', { style: { fontSize: '13px', fontWeight: 400, marginLeft: '8px' } }, [d.project.client, d.project.status, d.boqs.length ? `BOQ ${d.boqs.join(', ')}` : 'no BOQ yet'].filter(Boolean).join(' · '))),
    kpis, tabs, body);
  draw();
}
