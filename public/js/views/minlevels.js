// Minimum stock levels, set quickly (owner, 28 Nov 2026).
// One list of items with a box for the minimum: type and press Enter to go to the next item, paste a column
// from Excel to fill several rows, or take the suggestion from the last 6 months' use. Changes save by themselves.
import { h, api, state, toast, fail, confirmBox, fmtDate } from '../ui.js';
import { ITEM_CATEGORIES, canWrite } from '../schema.js';

export async function minLevelsView(root) {
  const mayEdit = canWrite('items', state.user.role);
  const data = await api('/stock/min-levels');
  const byId = new Map(data.rows.map(r => [r.id, r]));
  const pending = new Map(); // id → new minimum, waiting to be saved
  const status = h('span.muted', { style: { alignSelf: 'center' } }, '');
  const f = {
    q: h('input.grow', { type: 'search', placeholder: 'Search code or name…' }),
    category: h('select', h('option', { value: '' }, 'All categories'), ITEM_CATEGORIES.map(c => h('option', c))),
    show: h('select',
      h('option', { value: 'used' }, 'Used in the last 6 months, no minimum yet'),
      h('option', { value: 'none' }, 'All items without a minimum'),
      h('option', { value: 'low' }, 'Below minimum now'),
      h('option', { value: 'all' }, 'All items')),
  };
  f.show.value = data.rows.some(r => !r.reorder_level && r.used > 0) ? 'used' : 'none';
  const out = h('div');
  const LIMIT = 300;
  const qn = v => Math.round((Number(v) || 0) * 100) / 100;
  const YELLOW = '#fff3c4';

  let timer;
  function queue(id, v) {
    const r = byId.get(id);
    const n = v === '' ? 0 : Number(v);
    if (!Number.isFinite(n) || n < 0) { toast('The minimum must be 0 or more', true); return false; }
    if (n === r.reorder_level) pending.delete(id); else pending.set(id, n);
    if (pending.size) status.textContent = `Saving ${pending.size}…`;
    clearTimeout(timer); timer = setTimeout(save, 700);
    return pending.has(id);
  }
  async function save() {
    if (!pending.size) return;
    const levels = [...pending].map(([id, min]) => ({ id, min }));
    pending.clear();
    try {
      const r = await api('/stock/min-levels', { method: 'POST', body: { levels } });
      for (const l of levels) {
        const x = byId.get(l.id);
        x.reorder_level = l.min; x.low = x.reorder_level > 0 && x.stock <= x.reorder_level;
        for (const el of out.querySelectorAll(`input[data-min="${l.id}"]`)) {
          if (!pending.has(l.id)) el.style.background = '';
          const stk = el.closest('tr')?.querySelector('.stk');
          if (stk) stk.style.color = x.low ? 'var(--warn)' : '';
        }
      }
      status.textContent = `✓ Saved (${r.changed} changed) at ${new Date().toTimeString().slice(0, 5)}`;
    } catch (e) {
      for (const l of levels) if (!pending.has(l.id)) pending.set(l.id, l.min);
      status.textContent = '⚠ Not saved – check your connection';
      fail(e);
    }
  }
  // leaving the screen saves what is still waiting
  const flush = () => { if (pending.size) { clearTimeout(timer); save(); } };
  window.addEventListener('hashchange', flush, { once: true });

  function visible() {
    const q = f.q.value.trim().toLowerCase(), show = f.show.value;
    return data.rows.filter(r => (!f.category.value || r.category === f.category.value)
      && (show === 'all' || (show === 'none' && !r.reorder_level) || (show === 'used' && !r.reorder_level && r.used > 0) || (show === 'low' && r.low))
      && (!q || `${r.code || ''} ${r.name}`.toLowerCase().includes(q)))
      .sort((a, b) => show === 'used' ? b.months - a.months || b.used - a.used : String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }));
  }

  function draw() {
    const rows = visible();
    const inputs = [];
    const go = (i, d) => { const el = inputs[i + d]; if (el) { el.focus(); el.select(); } };
    const body = rows.slice(0, LIMIT).map((r, i) => {
      const inp = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', placeholder: '0', 'data-min': r.id, style: { width: '58px', textAlign: 'right' } });
      inp.disabled = !mayEdit;
      inp.value = pending.has(r.id) ? pending.get(r.id) : r.reorder_level || '';
      if (pending.has(r.id)) inp.style.background = YELLOW;
      inputs.push(inp);
      const changed = () => { inp.style.background = queue(r.id, inp.value.trim()) ? YELLOW : ''; };
      inp.addEventListener('change', changed);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); go(i, 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); go(i, -1); }
      });
      inp.addEventListener('paste', e => { // a column copied from Excel fills this row and the ones below
        const vals = (e.clipboardData?.getData('text') || '').split(/\r?\n/).map(s => s.split('\t')[0].trim().replace(/,/g, '')).filter(s => s !== '');
        if (vals.length < 2) return;
        e.preventDefault();
        let n = 0;
        vals.forEach((v, k) => { const el = inputs[i + k]; if (el && /^\d*\.?\d+$/.test(v)) { el.value = v; el.dispatchEvent(new Event('change')); n++; } });
        toast(`${n} minimum level(s) pasted`);
      });
      const use = r.suggested != null && mayEdit
        ? h('button.btn.small', { title: 'Use the suggestion', onclick: () => { inp.value = r.suggested; inp.dispatchEvent(new Event('change')); go(i, 1); } }, String(r.suggested))
        : h('span.muted', r.suggested ?? '–');
      return h('tr',
        h('td', { style: { minWidth: '100px', overflowWrap: 'anywhere' } }, h('a', { href: `#/view/items/${r.id}` }, r.name),
          h('div.muted', { style: { fontSize: '11px' } }, [r.code, r.category].filter(Boolean).join(' · '))),
        h('td.num', h('span.stk', { style: { whiteSpace: 'nowrap', fontWeight: 600, color: r.low ? 'var(--warn)' : '' } }, `${qn(r.stock)} ${r.uom || ''}`),
          h('div.muted', { style: { fontSize: '11px', whiteSpace: 'normal' } }, r.used ? `used ${qn(r.used)} in ${r.months} mo` : 'not used')),
        h('td.num', use), h('td.num', inp));
    });
    const withSugg = rows.filter(r => r.suggested != null && !r.reorder_level && !pending.has(r.id));
    out.replaceChildren(
      h('div.toolbar',
        h('span.muted', { style: { alignSelf: 'center' } }, `${rows.length} item(s)${rows.length > LIMIT ? ` – showing the first ${LIMIT}, search to find others` : ''}`),
        mayEdit && withSugg.length ? h('button.btn', { onclick: async () => {
          if (!await confirmBox(`Set the suggested minimum on the ${withSugg.length} item(s) in this list that have none? You can change any of them afterwards.`)) return;
          for (const r of withSugg) queue(r.id, String(r.suggested));
          draw();
        } }, `✨ Use the suggestions for ${withSugg.length} item(s)`) : null),
      h('div.card.flush', h('div.table-wrap', h('table.data.minlv',
        h('thead', h('tr', h('th', 'Item'), h('th.num', 'Stock / used (6 mo)'), h('th.num', 'Suggested'), h('th.num', 'Minimum'))),
        h('tbody', body.length ? body : h('tr', h('td', { colspan: 4 }, h('div.empty', f.show.value === 'low' ? 'Nothing is below its minimum' : f.show.value === 'all' ? 'No items' : 'Every item here has a minimum level 👍'))))))));
  }

  let t2;
  f.q.addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(draw, 200); });
  f.category.addEventListener('change', draw);
  f.show.addEventListener('change', draw);
  const set = data.rows.filter(r => r.reorder_level > 0).length;
  root.replaceChildren(
    h('div.page-head', h('h1', '📉 Minimum Stock Levels'), h('div.actions', status,
      h('a.btn', { href: '#/stock-summary?only=low' }, '⚠ Below minimum'), h('a.btn', { href: '#/stock-summary' }, '📊 Stock Summary'))),
    h('p.muted', `${set} of ${data.rows.length} items have a minimum level. When an item's stock falls to its minimum it shows as low stock on the dashboards. `,
      mayEdit ? 'Type the minimum and press Enter to go to the next item – it saves by itself. You can also paste a column of numbers from Excel, or tap a suggestion. ' : 'You can see the levels; the store sets them. ',
      `Suggested = enough for the supplier's lead time (15 days if not known) plus 15 more days, at the average use since ${fmtDate(data.since)} (only for items issued in 2 or more months – a one-off use for a project is no reason to keep stock).`),
    h('div.toolbar', f.q, f.category, f.show),
    out);
  draw();
}
