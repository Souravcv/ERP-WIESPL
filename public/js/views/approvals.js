// Approval Requests, sorted so they are easy to find: Waiting for me → All pending → Decided, each split by document
// type with a pending count. A row says what it is, the step and who it waits for, who asked, how many days it has
// waited and the amount; a click opens the approval, "Open ›" the document itself.
import { h, api, state, badge, money, fmtDate, setHashQuery } from '../ui.js';
import { ENTITIES, canView, hasFunction, APPROVAL_FLOWS, FUNCTIONS, EXTRA_STAGE } from '../schema.js';
import { canApprove } from './form.js';
import { recordHref } from './list.js';

// Payment and Expense are one group: the same people approve both.
const GROUPS = [
  ['Purchase Order', '🛒', ['Purchase Order']],
  ['Requisition', '📋', ['Requisition']],
  ['Payment / Expense', '💸', ['Payment', 'Expense']],
  ['Quotation', '💬', ['Quotation']],
  ['Sales Order', '🧾', ['Sales Order']],
  ['Leave', '🌴', ['Leave']],
  ['Order Journey', '🧭', ['Order Journey']],
  ['TDS', '📐', ['TDS']],
  ['Schedule Baseline', '📅', ['Schedule Baseline']],
  ['Production Plan', '🏭', ['Production Plan']],
  ['Credit Note', '↩️', ['Credit Note']],
  ['Confirmation', '🤝', ['Confirmation']],
];
const groupOf = t => GROUPS.find(g => g[2].includes(t))?.[0] || t || 'Other';
const iconOf = g => GROUPS.find(x => x[0] === g)?.[1] || '📄';
const DOC_ENTITY = { Quotation: 'quotations', 'Purchase Order': 'purchase_orders', Requisition: 'requisitions', 'Sales Order': 'sales_orders', Payment: 'vendor_payments',
  TDS: 'tds_sheets', Expense: 'expenses', Leave: 'leave_requests', 'Schedule Baseline': 'schedule_baselines', 'Credit Note': 'credit_notes', Confirmation: 'probation_reviews', 'Production Plan': 'production_plans' };
const VIEWS = [['mine', '🙋 Waiting for me'], ['pending', '⏳ All pending'], ['decided', '✔ Decided']];

const daysSince = s => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? null : Math.max(0, Math.floor((Date.now() - d) / 864e5)); };
const stepOf = (t, stage) => (APPROVAL_FLOWS[t] || []).find(s => s.stage === stage) || (APPROVAL_FLOWS[t] || [])[0];

// Who the approval waits for: the step's right (or the journey roles) and the people who hold it.
function waitsFor(a) {
  if (a.stage === EXTRA_STAGE) return { right: 'extra approval asked by the GM', who: a.also_by || '' };
  const step = stepOf(a.doc_type, a.stage);
  const roles = a.doc_type === 'Order Journey' ? String(a.approver_role || '').split(',').filter(Boolean) : null;
  const holds = p => p.role && p.role !== 'admin' && (roles ? roles.includes(p.role) : step && hasFunction(p.role, step.fn));
  const names = (state.people || []).filter(holds).map(p => p.name).filter(n => n !== state.user.name);
  if (a.also_by && a.also_by !== state.user.name && !names.includes(a.also_by)) names.unshift(a.also_by);
  const right = roles ? '' : String(FUNCTIONS[step?.fn] || '').replace(/\s*\(.*\)\s*$/, '');
  const who = names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : '';
  return { right, who };
}

export async function approvalsView(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const [pending, recent] = await Promise.all([api('/approvals?status=Pending&limit=5000'), api('/approvals?limit=600')]);
  const decided = recent.filter(a => a.status !== 'Pending').sort((x, y) => String(y.decided_at || '').localeCompare(String(x.decided_at || '')) || y.id - x.id);
  const mine = pending.filter(a => canApprove(a.doc_type, a.stage, a));
  const sets = { mine, pending, decided };
  // Older links (dashboard tiles) say ?status=Pending / Approved / Rejected.
  const st = params.get('status');
  let view = params.get('v') || (st === 'Pending' ? 'pending' : st ? 'decided' : mine.length ? 'mine' : 'pending');
  if (!sets[view]) view = 'pending';
  let type = params.get('t') || '';
  const q = h('input.grow', { type: 'search', placeholder: 'Search ref, title, person…', value: params.get('q') || '' });

  const head = h('div.page-head', h('h1', '✅ Approval Requests'), h('div.actions',
    h('a.btn', { href: '#/list/approvals?table=1', title: 'The plain table with filters and Excel export' }, '▦ Full table')));
  const tabs = h('div.tabs');
  const chips = h('div.p3-chips', { style: { margin: '0 0 12px' } });
  const out = h('div');
  root.replaceChildren(head, tabs, h('div.toolbar', q), chips, out);

  const matches = a => { const s = q.value.trim().toLowerCase(); return !s || [a.doc_type, a.doc_ref, a.title, a.stage, a.requested_by, a.decided_by, a.comments].some(v => String(v || '').toLowerCase().includes(s)); };
  const count = (rows, g) => rows.filter(a => groupOf(a.doc_type) === g).length;

  function row(a) {
    const g = groupOf(a.doc_type);
    const docEnt = DOC_ENTITY[a.doc_type];
    const docHref = a.doc_type === 'Order Journey' ? `#/journey/${a.doc_id}` : docEnt && ENTITIES[docEnt] && canView(docEnt, state.user.role) ? recordHref(docEnt, a.doc_id) : null;
    const open = () => (location.hash = `#/view/approvals/${a.id}`);
    const days = daysSince(a.requested_at);
    const isPending = a.status === 'Pending';
    const w = isPending ? waitsFor(a) : null;
    const me = isPending && canApprove(a.doc_type, a.stage, a);
    return h('tr.clickable', { onclick: open },
      h('td', { 'data-label': 'Document' }, h('div', h('b', `${iconOf(g)} ${a.doc_type}`), ' ', h('span.nowrap', a.doc_ref || '')), h('div.muted', { style: { fontSize: '12px' } }, a.title || '')),
      h('td', { 'data-label': isPending ? 'Step · waits for' : 'Step' }, h('div', a.stage || '—'),
        w ? h('div.muted', { style: { fontSize: '12px' } }, me ? h('b', { style: { color: 'var(--good)' } }, 'You') : null, me ? (w.who ? ' or ' : '') : (w.right ? `${w.right}: ` : ''), w.who || (me ? '' : 'admin')) : null),
      h('td', { 'data-label': 'Asked by' }, h('div', a.requested_by || ''), h('div.muted', { style: { fontSize: '12px' } }, fmtDate(a.requested_at))),
      isPending
        ? h('td.num', { 'data-label': 'Waiting' }, days == null ? '' : h('b', { style: { color: days > 3 ? 'var(--bad)' : days > 1 ? 'var(--warn)' : '' } }, days === 0 ? 'today' : `${days} day${days > 1 ? 's' : ''}`))
        : h('td', { 'data-label': 'Decision' }, badge(a.status), h('div.muted', { style: { fontSize: '12px' } }, `${a.decided_by || ''} ${fmtDate(a.decided_at)}`)),
      h('td.num', { 'data-label': 'Amount' }, a.amount != null && a.amount !== '' ? money(a.amount) : ''),
      h('td.nowrap', { 'data-label': '' }, docHref ? h('a.btn.small', { href: docHref, onclick: e => e.stopPropagation(), title: 'Open the document itself' }, 'Open ›') : null,
        me ? h('a.btn.small.good', { href: `#/view/approvals/${a.id}`, onclick: e => e.stopPropagation(), title: 'Approve or reject' }, '✔ Decide') : null));
  }

  function tableOf(rows) {
    const pend = view !== 'decided';
    return h('div.card.flush', h('div.table-wrap', h('table.data',
      h('thead', h('tr', ['Document', pend ? 'Step · waits for' : 'Step', 'Asked by', pend ? 'Waiting' : 'Decision', 'Amount', ''].map((x, i) => h('th' + ([3, 4].includes(i) && (pend || i === 4) ? '.num' : ''), x)))),
      h('tbody', rows.map(row)))));
  }

  function render() {
    setHashQuery(new URLSearchParams({ v: view, ...(type ? { t: type } : {}), ...(q.value.trim() ? { q: q.value.trim() } : {}) }).toString());
    tabs.replaceChildren(...VIEWS.map(([k, l]) => h('button', { class: k === view ? 'active' : '', onclick: () => { view = k; render(); } },
      l, k !== 'decided' ? h('span.count', String(sets[k].length)) : null)));
    const base = sets[view].filter(matches);
    const present = [...GROUPS.map(g => g[0]), ...new Set(base.map(a => groupOf(a.doc_type)))].filter((g, i, all) => all.indexOf(g) === i && base.some(a => groupOf(a.doc_type) === g));
    if (type && !present.includes(type)) present.push(type);
    // The chip count is the pending ones of that type in this view (for Decided: how many decided are shown).
    chips.replaceChildren(
      h('button.p3-chip', { class: type ? 'p3-chip' : 'p3-chip on', onclick: () => { type = ''; render(); } }, `All types · ${base.length}`),
      ...present.map(g => h('button.p3-chip', { class: g === type ? 'p3-chip on' : 'p3-chip', onclick: () => { type = g === type ? '' : g; render(); } }, `${iconOf(g)} ${g} · ${count(base, g)}`)));
    const rows = type ? base.filter(a => groupOf(a.doc_type) === type) : base;
    if (!rows.length) {
      out.replaceChildren(h('div.card', h('div.empty', view === 'mine' ? 'Nothing is waiting for your approval. 🎉' : view === 'pending' ? 'No pending approvals.' : 'No decided approvals here.')));
      return;
    }
    // Oldest first while pending (what has waited longest on top); newest first once decided.
    const sorted = view === 'decided' ? rows : [...rows].sort((x, y) => String(x.requested_at || '').localeCompare(String(y.requested_at || '')) || x.id - y.id);
    if (type) { out.replaceChildren(tableOf(sorted)); return; }
    out.replaceChildren(...present.filter(g => sorted.some(a => groupOf(a.doc_type) === g)).map(g => {
      const list = sorted.filter(a => groupOf(a.doc_type) === g);
      return h('section', { style: { marginBottom: '16px' } },
        h('h3', { style: { margin: '6px 0', cursor: 'pointer' }, title: `Show only ${g}`, onclick: () => { type = g; render(); } }, `${iconOf(g)} ${g} `, h('span.muted', `(${list.length})`)),
        tableOf(list));
    }));
  }
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(render, 200); };
  render();
}
