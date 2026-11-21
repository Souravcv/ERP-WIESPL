// 🏬 Department Stores: material the main store transferred to each department (or job-work vendor / place), what came
// back, what was used, and what each still holds — choose a department to see its inventory and the slips (server/deptstore.js).
import { h, api, money, fmtDate, hashParams, setHashParam } from '../ui.js';
import { round2 } from '../calc.js';

const n = v => (Number(v) ? round2(v) : '');

export async function deptStoresView(root) {
  const d = await api('/dept-stores');
  let place = hashParams().get('place') || '';
  let tab = hashParams().get('tab') === 'trail' ? 'trail' : 'items', find = '', onlyHeld = true;
  const out = h('div');
  const cards = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px', margin: '10px 0' } });
  const drawCards = () => cards.replaceChildren(...d.rows.map(r => h('button.card', { type: 'button', title: r.department ? 'Department' : 'Job-work vendor / other place',
    style: { textAlign: 'left', padding: '10px 12px', cursor: 'pointer', border: r.place === place ? '2px solid var(--primary)' : '', opacity: r.items_ever ? 1 : 0.6 },
    onclick: () => { place = r.place; setHashParam('place', place); drawCards(); load(); } },
  h('div', { style: { fontWeight: 700 } }, `${r.department ? '🏬' : '🚚'} ${r.place}`),
  h('div.muted', { style: { fontSize: '12px' } }, r.items_held ? `${r.items_held} item${r.items_held === 1 ? '' : 's'} held` : r.items_ever ? 'nothing held now' : 'nothing transferred yet'),
  d.prices && r.value ? h('div', { style: { fontSize: '12px' } }, money(r.value)) : null)));
  async function load() {
    if (!place) { out.replaceChildren(h('div.card', h('div.empty', 'Choose a department (or place) above to see its inventory.'))); return; }
    const p = await api(`/dept-stores/${encodeURIComponent(place)}`);
    const tabs = h('div.tabs', [['items', `📦 Inventory (${p.totals.held} held)`], ['trail', `🔁 Trail (${p.trail.length})`]].map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { tab = k; setHashParam('tab', k === 'trail' ? 'trail' : ''); load(); } }, l)));
    let body;
    if (tab === 'items') {
      const q = find.trim().toLowerCase();
      const rows = p.rows.filter(r => (!onlyHeld || r.balance > 0) && (!q || `${r.code} ${r.name} ${r.category}`.toLowerCase().includes(q)));
      const search = h('input', { type: 'search', placeholder: 'Find an item…', value: find, oninput: e => { find = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => load().then(() => { const s = out.querySelector('input[type=search]'); s?.focus(); s?.setSelectionRange(find.length, find.length); }), 250); } });
      const held = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400 } }, h('input', { type: 'checkbox', checked: onlyHeld, style: { width: 'auto' }, onchange: e => { onlyHeld = e.target.checked; load(); } }), 'Only what it still holds');
      body = [h('div.toolbar', search, held),
        rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
          h('thead', h('tr', ['Item', 'Category', 'UOM', 'Received from store', 'Returned', p.place === 'Production' ? 'Used in production' : null, 'Holds now', d.prices ? 'Value' : null, 'Issued to it (used)', 'Last'].filter(Boolean)
            .map(x => h(/Received|Returned|Used|Holds|Value|Issued/.test(x) ? 'th.num' : 'th', x)))),
          h('tbody', rows.map(r => h('tr', h('td', { style: { minWidth: '220px' } }, h('a', { href: `#/view/items/${r.item_id}` }, [r.code, r.name].filter(Boolean).join(' · '))), h('td', r.category || ''), h('td', r.uom || ''),
            h('td.num', n(r.in)), h('td.num', n(r.back)), p.place === 'Production' ? h('td.num', n(r.used)) : null,
            h('td.num', h('b', { style: { color: r.balance < 0 ? 'var(--bad)' : '' } }, r.balance ? round2(r.balance) : '0')), d.prices ? h('td.num', r.value ? money(r.value) : '') : null,
            h('td.num.muted', n(r.issued)), h('td.nowrap', fmtDate(r.last)))))))) : h('div.card', h('div.empty', onlyHeld ? `${p.place} holds nothing now. Untick “Only what it still holds” to see everything it received.` : `Nothing has gone to ${p.place} yet.`)),
        h('p.muted', { style: { fontSize: '12px' } }, `Holds now = received (from the store or another department) − returned to the store − sent to another department / place${p.place === 'Production' ? ' − used in posted production entries' : ''}. “Issued to it” = issue slips to the department: handed over for use, not counted as held.`)];
    } else {
      body = [p.trail.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Date', 'What', 'Slip', 'Item', 'Qty', 'To / from', 'Project'].map(x => h(x === 'Qty' ? 'th.num' : 'th', x)))),
        h('tbody', p.trail.map(t => h('tr', h('td.nowrap', fmtDate(t.date)), h('td', t.kind),
          h('td.nowrap', t.production_id ? h('a', { href: `#/view/production_entries/${t.production_id}` }, t.doc_no || '') : h('a', { href: `#/stock-movements?type=${t.type}&q=${encodeURIComponent(t.doc_no || '')}` }, t.doc_no || '—')),
          h('td.clip', t.item), h('td.num', `${round2(t.qty)} ${t.uom || ''}`), h('td.clip', t.where), h('td.clip', t.project)))))))
        : h('div.card', h('div.empty', 'No movements yet.'))];
    }
    out.replaceChildren(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '6px 0' } },
      h('a.btn.small.primary', { href: `#/stock-entry?type=TRANSFER&from=${encodeURIComponent(p.place)}` }, `🔀 Send from ${p.place} (to store or anywhere)`)),
      h('h2', { style: { margin: '6px 0' } }, `${p.department ? '🏬' : '🚚'} ${p.place}`, d.prices && p.totals.value ? h('span.muted', { style: { fontSize: '13px', fontWeight: 400, marginLeft: '8px' } }, `holds ${money(p.totals.value)}`) : null), tabs, ...body);
  }
  drawCards();
  root.replaceChildren(h('div.page-head', h('h1', '🏬 Department Stores'), h('div.actions', h('a.btn.primary', { href: '#/stock-entry?type=TRANSFER' }, '🔀 Transfer to a department'), h('a.btn', { href: '#/stock-entry?type=RETURN' }, '↩️ Return to store'))),
    h('p.muted', 'Material the store transferred to a department or a job-work vendor stays traced there: what each one received, returned, used and still holds. Choose one to see its inventory.'),
    cards, out);
  await load();
}
