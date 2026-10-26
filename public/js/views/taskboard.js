// Task board: the task scheduler as columns (To do · In progress · Waiting · Done), for me, for what I gave, or for
// everyone (people allowed to assign). Overdue tasks in red; Start / Done on each card.
import { h, api, state, toast, fail, fmtDate, today, busy } from '../ui.js';
import { hasFunction } from '../schema.js';
import { newRecord } from './list.js';

const COLS = ['To do', 'In progress', 'Waiting', 'Done'];
const PRI = { Urgent: 'var(--bad)', High: 'var(--warn)', Normal: 'var(--muted)', Low: 'var(--muted)' };

export async function taskBoardView(root) {
  const me = state.user.name, boss = hasFunction(state.user.role, 'task_assign');
  const scope = h('select', { style: { width: 'auto' } }, [['mine', 'Given to me'], ['given', 'Given by me'], ...(boss ? [['all', 'Everyone']] : [])].map(([v, l]) => h('option', { value: v }, l)));
  const person = h('input', { placeholder: 'Person (name)', list: 'tb-people', style: { width: '180px' } });
  const people = h('datalist', { id: 'tb-people' }, (state.people || []).map(p => h('option', { value: p.name })));
  const out = h('div');
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const load = async () => {
    const t = today();
    let rows = (await api('/work_tasks?limit=2000')).filter(x => x.status !== 'Cancelled');
    if (scope.value === 'mine') rows = rows.filter(x => same(x.assigned_to, me));
    if (scope.value === 'given') rows = rows.filter(x => same(x.assigned_by, me) && !same(x.assigned_to, me));
    if (person.value.trim()) rows = rows.filter(x => same(x.assigned_to, person.value));
    const old = d => d && d < (() => { const x = new Date(t + 'T00:00:00'); x.setDate(x.getDate() - 14); return x.toLocaleString('sv-SE').slice(0, 10); })();
    rows = rows.filter(x => !(x.status === 'Done' && old(String(x.completed_at || '').slice(0, 10))));
    const set = (x, st) => busy(async () => { try { await api(`/work_tasks/${x.id}`, { method: 'PUT', body: { status: st } }); toast(`${x.title}: ${st}`); load(); } catch (e) { fail(e); } });
    const card = x => {
      const late = x.overdue === 'Yes';
      return h('div.card', { style: { padding: '10px', marginBottom: '8px', borderLeft: `4px solid ${late ? 'var(--bad)' : PRI[x.priority] || 'var(--muted)'}`, cursor: 'pointer' }, onclick: () => (location.hash = `#/view/work_tasks/${x.id}`) },
        h('div', { style: { fontWeight: 600 } }, x.title),
        h('div.muted', { style: { fontSize: '12px' } }, [`due ${fmtDate(x.due_date)}${x.due_time ? ' ' + x.due_time : ''}`, x.priority !== 'Normal' ? x.priority : null, x.repeat && x.repeat !== 'No repeat' ? `↻ ${x.repeat.toLowerCase()}` : null].filter(Boolean).join(' · ')),
        h('div', { style: { fontSize: '12px', marginTop: '2px' } }, same(x.assigned_to, me) ? (same(x.assigned_by, me) ? 'my own task' : `from ${x.assigned_by}`) : `→ ${x.assigned_to}`, late ? h('b', { style: { color: 'var(--bad)' } }, ' · overdue') : null),
        x.status !== 'Done' ? h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px' }, onclick: e => e.stopPropagation() },
          x.status !== 'In progress' ? h('button.btn.small', { onclick: set(x, 'In progress') }, '▶ Start') : null,
          h('button.btn.small.good', { onclick: set(x, 'Done') }, '✔ Done')) : null);
    };
    const late = rows.filter(x => x.overdue === 'Yes').length;
    out.replaceChildren(
      h('p.muted', `${rows.filter(x => x.status !== 'Done').length} open · ${late ? `${late} overdue · ` : ''}done in the last 14 days shown`),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px', alignItems: 'start' } },
        COLS.map(c => {
          const list = rows.filter(x => x.status === c).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
          return h('div', h('h3', { style: { margin: '0 0 8px' } }, `${c} (${list.length})`), list.length ? list.map(card) : h('p.muted', '—'));
        })));
  };
  scope.onchange = () => load().catch(fail);
  person.onchange = () => load().catch(fail);
  root.replaceChildren(
    h('div.page-head', h('h1', '🗂️ Task Board'), h('div.actions',
      h('button.btn.primary', { onclick: () => newRecord('work_tasks', {}) }, boss ? '+ New task (assign)' : '+ New task for me'),
      h('a.btn', { href: '#/list/work_tasks' }, '📋 List'))),
    h('div.toolbar', scope, boss ? person : null, people, h('button.btn', { onclick: () => load().catch(fail) }, '↻ Refresh')), out);
  await load();
}
