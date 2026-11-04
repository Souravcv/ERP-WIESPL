// A project's QC list: products down, stages across, made from its work orders. Failed and open hold points stand out.
import { h, api, state, toast, fail, busy } from '../ui.js';
import { hasFunction, canWrite } from '../schema.js';

const COLOUR = { Passed: 'var(--good)', Failed: 'var(--bad)', Pending: 'var(--warn)' };
const kpi = (label, value, sub) => h('div.kpi', h('div.label', label), h('div.value', String(value)), sub ? h('div.sub', sub) : null);

export async function projectQcView(root, projectId) {
  const projects = await api('/projects/options');
  const pick = h('select', { 'aria-label': 'Project', style: { width: 'auto', maxWidth: '100%' }, onchange: e => { location.hash = `#/project-qc/${e.target.value}`; } },
    h('option', { value: '' }, 'Choose a project…'), projects.map(p => h('option', { value: p.id }, p.label)));
  pick.value = projectId || '';
  const body = h('div');
  const head = h('div.page-head', h('h1', '✅ Project QC'), h('div.actions', h('a.btn', { href: '#/list/qc_plans' }, '📘 QC Plans')));
  root.replaceChildren(head, h('div.toolbar', pick), body);
  if (!projectId) { body.replaceChildren(h('div.card', h('p.muted', 'Choose a project. Its QC list is made from the products on its work orders.'))); return; }
  const role = state.user.role;
  const draw = async () => {
    const d = await api(`/project-qc/${projectId}`);
    const t = d.totals;
    const actions = h('div.toolbar',
      canWrite('project_qc', role) && (hasFunction(role, 'qc_inspect') || hasFunction(role, 'qc_site')) ? h('button.btn.primary', { onclick: busy(async () => {
        const r = await api(`/project-qc/${projectId}/generate`, { method: 'POST' });
        toast(r.work_orders ? `${r.created} new records, ${r.refreshed} updated with the latest plans` : 'This project has no work order yet');
        await draw();
      }) }, t.total ? '🔄 Update from work orders' : '➕ Create QC list from work orders') : null,
      t.total ? h('a.btn', { href: `#/print/qcfile/${projectId}`, target: '_blank' }, '🖨 QC file') : null);
    const warnings = [
      ...d.plans.filter(p => p.no_limit).map(p => h('li', `${p.product}: ${p.no_limit} check${p.no_limit === 1 ? '' : 's'} with no limit yet. `, h('a', { href: `#/view/qc_plans/${p.id}` }, 'Set the limits'))),
      d.lines_no_plan ? h('li', `${d.lines_no_plan} of ${d.lines_total} work order lines have no QC plan yet.`) : null,
    ].filter(Boolean);
    const groups = {};
    for (const r of d.rows) (groups[`${r.boq_id}|${r.section || ''}`] ||= { section: r.section || 'Work order', plans: {} }).plans[r.plan_id] ||= {};
    for (const r of d.rows) groups[`${r.boq_id}|${r.section || ''}`].plans[r.plan_id][r.stage] = r;
    const productOf = id => d.plans.find(p => p.id === id)?.product || '';
    const cell = r => (r ? h('td', h('a', { href: `#/view/project_qc/${r.id}`, style: { color: COLOUR[r.status], fontWeight: 600, whiteSpace: 'nowrap' } }, `${r.status === 'Passed' ? '✔' : r.status === 'Failed' ? '✘' : r.holds ? '✋' : '○'} ${r.status}`)) : h('td', h('span.muted', '—')));
    body.replaceChildren(actions,
      t.total ? h('div.kpis', kpi('QC records', t.total), kpi('Passed', t.passed), kpi('Failed', t.failed, t.failed ? 'NCR raised' : null), kpi('Pending', t.pending), kpi('Open hold points', t.open_holds, '✋ records that must pass')) : null,
      warnings.length ? h('div.card', h('h2', '⚠️ Still needed'), h('ul', { style: { margin: 0, paddingLeft: '18px' } }, warnings)) : null,
      t.total ? h('div.card.flush.table-wrap', h('table.data', h('thead', h('tr', h('th', 'Section'), h('th', 'Product'), d.stages.map(s => h('th', s)))),
        h('tbody', Object.values(groups).flatMap(g => Object.entries(g.plans).map(([planId, st]) => h('tr', h('td', g.section), h('td', h('b', productOf(Number(planId)))), d.stages.map(s => cell(st[s]))))))))
        : h('div.card', h('p.muted', d.work_orders ? 'No QC list yet for this project.' : 'This project has no work order yet.')));
  };
  await draw().catch(fail);
}
