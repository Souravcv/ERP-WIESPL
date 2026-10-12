import { h, api, state, display, fail, download } from '../ui.js';
import { ENTITIES, fieldMap, canWrite } from '../schema.js';
import { inr } from '../calc.js';

export const recordHref = (entity, id) => (ENTITIES[entity].editor === 'quotation' ? `#/quotation/${id}` : ENTITIES[entity].editor === 'boq' ? `#/boq/${id}` : `#/view/${entity}/${id}`);

const NUMERIC = ['money', 'number'];

export function table(entity, rows, { columns, pageSize = 50, totals = true } = {}) {
  const ent = ENTITIES[entity];
  const fm = fieldMap(entity);
  const cols = (columns || ent.list).map(k => fm[k]).filter(Boolean);
  let sortKey = null, dir = 1, page = 0;
  const wrap = h('div');

  function render() {
    let data = rows;
    if (sortKey) {
      const f = fm[sortKey];
      const val = r => (f.type === 'ref' ? r[`${sortKey}_label`] : r[sortKey]) ?? '';
      data = [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        return (NUMERIC.includes(f.type) ? (Number(x) || 0) - (Number(y) || 0) : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
    }
    const pages = Math.max(1, Math.ceil(data.length / pageSize));
    page = Math.min(page, pages - 1);
    const slice = data.slice(page * pageSize, (page + 1) * pageSize);
    const moneyCols = cols.filter(c => c.type === 'money');
    const thead = h('thead', h('tr', cols.map(c => h('th' + (NUMERIC.includes(c.type) ? '.num' : ''), {
      onclick: () => { dir = sortKey === c.key ? -dir : 1; sortKey = c.key; render(); },
      title: 'Sort',
    }, c.label, sortKey === c.key ? (dir > 0 ? ' ▲' : ' ▼') : ''))));
    const tbody = h('tbody', slice.map(r => h('tr.clickable', { onclick: () => (location.hash = recordHref(entity, r.id)) },
      cols.map(c => h('td' + (NUMERIC.includes(c.type) ? '.num' : c.type === 'textarea' ? '.clip' : ''), display(c, r))))));
    const tfoot = totals && moneyCols.length && rows.length > 1
      ? h('tfoot', h('tr', cols.map((c, i) => h('td' + (c.type === 'money' ? '.num' : ''),
        c.type === 'money' ? inr(data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)) : i === 0 ? `Total (${data.length})` : ''))))
      : null;
    wrap.replaceChildren(
      rows.length ? h('div.table-wrap', h('table.data', thead, tbody, tfoot)) : h('div.empty', 'No records yet'),
      pages > 1 ? h('div.pager', `${data.length} records · page ${page + 1} of ${pages}`,
        h('button.btn.small', { disabled: page === 0, onclick: () => { page--; render(); } }, '‹ Prev'),
        h('button.btn.small', { disabled: page >= pages - 1, onclick: () => { page++; render(); } }, 'Next ›')) : null,
    );
  }
  render();
  return wrap;
}

export async function newRecord(entity, preset = {}) {
  if (ENTITIES[entity].editor === 'boq') { const { newBoqDialog } = await import('./dispatch.js'); return newBoqDialog(preset); }
  if (ENTITIES[entity].editor === 'quotation') {
    const q = preset.enquiry_id ? await api(`/enquiries/${preset.enquiry_id}/quotation`, { method: 'POST' }) : await api('/quotations', { method: 'POST', body: { status: 'Draft', ...preset, data: { rooms: [], lines: [], optionals: [], terms: state.settings.terms, client_scope: state.settings.client_scope, scope_matrix: state.settings.scope_matrix, letter_intro: state.settings.letter_intro, boq_title: 'WIESPL ESTIMATE FOR LAMINAR AIR FLOW, CONTROL PANEL WITH MODULAR OT - PPGL' }, subject: state.settings.default_subject } });
    location.hash = `#/quotation/${q.id}`;
    return;
  }
  const qs = new URLSearchParams(preset).toString();
  location.hash = `#/edit/${entity}/new${qs ? '?' + qs : ''}`;
}

export async function listView(root, entity) {
  const ent = ENTITIES[entity];
  if (!ent) throw new Error('Unknown module');
  const fm = fieldMap(entity);
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = h('input.grow', { placeholder: `Search ${ent.label.toLowerCase()}…`, type: 'search', value: params.get('q') || '' });
  const statusSel = ent.statusField
    ? h('select', h('option', { value: '' }, 'All statuses'), fm[ent.statusField].options.map(o => h('option', { value: o }, o)))
    : null;
  if (statusSel) statusSel.value = params.get('status') || '';
  const hasDate = !!fm.date;
  const from = hasDate ? h('input', { type: 'date', title: 'From date' }) : null;
  const to = hasDate ? h('input', { type: 'date', title: 'To date' }) : null;
  const body = h('div.card.flush');

  const query = () => {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    if (statusSel?.value) p.set(ent.statusField, statusSel.value);
    if (from?.value) p.set('from', from.value);
    if (to?.value) p.set('to', to.value);
    // other filters from the link, e.g. #/list/boqs?project_id=3
    for (const [k, v] of params) if (fm[k] && !p.has(k) && k !== ent.statusField && k !== 'q') p.set(k, v);
    return p.toString();
  };
  let timer;
  async function load() {
    try {
      const rows = await api(`/${entity}?${query()}`);
      body.replaceChildren(table(entity, rows));
    } catch (e) { fail(e); }
  }
  const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  for (const el of [q, statusSel, from, to].filter(Boolean)) el.addEventListener('input', reload);

  root.replaceChildren(
    h('div.page-head', h('h1', `${ent.icon} ${ent.label}`), h('div.actions',
      h('button.btn', { onclick: () => download(`/api/export/${entity}?${query()}`) }, '⬇ Export Excel'),
      entity === 'enquiries' && canWrite(entity, state.user.role) ? h('a.btn', { href: '#/import' }, '📥 Import Excel') : null,
      canWrite(entity, state.user.role) && !ent.noCreate ? h('button.btn.primary', { onclick: () => newRecord(entity).catch(fail) }, `+ New ${ent.singular}`) : null)),
    h('div.toolbar', q, statusSel, from ? h('span.muted', 'From') : null, from, to ? h('span.muted', 'to') : null, to),
    body,
  );
  await load();
}
