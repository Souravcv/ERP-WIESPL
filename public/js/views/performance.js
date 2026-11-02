// Performance: a person's own working days, output and quality, their department, and who is doing well. The in-charge
// sees the whole department and enters the Daily Team Work; the GM, HR, production and planning see every department.
import { h, api, state, toast, fail, fmtDate, today, busy } from '../ui.js';
import { hasFunction } from '../schema.js';

const qs = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const kpi = (label, value, sub) => h('div.kpi', h('div.label', label), h('div.value', value ?? '—'), sub ? h('div.sub', sub) : null);
const p = v => (v == null ? '—' : `${v}%`);
const scoreCell = v => h('td.num', v == null ? h('span.muted', '—') : h('b', { style: { color: v >= 80 ? 'var(--good)' : v >= 60 ? 'var(--warn)' : 'var(--bad)' } }, v));
const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
const WORKS = ['Cutting', 'Bending', 'Welding', 'Fabrication', 'Foaming', 'Assembly', 'Wiring', 'Panel making', 'Panel testing', 'Installation', 'Powder coating', 'Packing', 'Helper work'];

export async function performanceView(root) {
  const params = qs();
  const canLog = hasFunction(state.user.role, 'work_log');
  let tab = params.tab === 'team' && canLog ? 'team' : 'report';
  const body = h('div');
  const tabs = h('div.tabs.wrap');
  const drawTabs = () => tabs.replaceChildren(
    h('button', { class: tab === 'report' ? 'active' : '', onclick: () => { tab = 'report'; drawTabs(); draw().catch(fail); } }, '📈 Performance'),
    canLog ? h('button', { class: tab === 'team' ? 'active' : '', onclick: () => { tab = 'team'; drawTabs(); draw().catch(fail); } }, '📝 Daily Team Work') : null);
  const from = h('input', { type: 'date', value: params.from || `${today().slice(0, 8)}01`, style: { width: 'auto' } }), to = h('input', { type: 'date', value: params.to || today(), style: { width: 'auto' } });
  const deptSel = h('select', { style: { width: 'auto' }, 'aria-label': 'Department' });
  let dept = params.department || '';

  async function report() {
    let d;
    try { d = await api(`/performance?${new URLSearchParams({ from: from.value, to: to.value, ...(dept ? { department: dept } : {}) })}`); }
    catch (e) { body.replaceChildren(h('div.card', h('p', e.message))); return; }
    const filter = h('div.toolbar', h('span.muted', 'From'), from, h('span.muted', 'to'), to, d.scope === 'all' ? deptSel : null);
    from.onchange = to.onchange = () => report().catch(fail);
    if (d.scope === 'all') {
      deptSel.replaceChildren(h('option', { value: '' }, 'All departments'), d.departments.map(x => h('option', { value: x.name }, x.name)));
      deptSel.value = dept;
      deptSel.onchange = () => { dept = deptSel.value; report().catch(fail); };
    }
    const m = d.me;
    const mine = m ? h('div.card', h('h2', `👤 ${m.name}${m.designation ? ` · ${m.designation}` : ''}`),
      h('div.kpis', { style: { marginBottom: 0 } },
        kpi('My score', m.score, d.rank ? `No. ${d.rank} of ${d.of} in ${d.department}` : d.department),
        kpi('Days worked', `${m.present_days} / ${m.working_days}`, `attendance ${p(m.attendance)}`),
        kpi('Work recorded', `${m.work_days} day${m.work_days === 1 ? '' : 's'}`, `${m.work_hours} hours`),
        kpi('Done', m.done, m.target ? `target ${m.target} · ${p(m.achievement)}` : 'no target given'),
        kpi('Quality', p(m.quality), `${m.rejected} rejected / rework`),
        kpi('Late marks', m.late_marks))) : null;
    const deptTable = d.departments.length ? h('div.card', h('h2', d.scope === 'all' ? '🏢 Departments' : `🏢 ${d.department}`), h('div.table-wrap', h('table.data',
      h('thead', h('tr', ['Department', 'People', 'Attendance', 'Done', 'Output vs target', 'Quality', 'Score', 'Doing best'].map((x, i) => h('th' + (i && i < 7 ? '.num' : ''), x)))),
      h('tbody', d.departments.map(x => h('tr', h('td', h('b', x.name)), h('td.num', x.people), h('td.num', p(x.attendance)), h('td.num', x.done), h('td.num', p(x.achievement)), h('td.num', p(x.quality)), scoreCell(x.score),
        h('td', x.top ? `🏆 ${x.top.name} (${x.top.score})` : h('span.muted', '—')))))))) : null;
    const leaders = d.top ? h('div.card', h('h2', `🏆 Doing well in ${d.department}`), d.top.length ? h('table.data', h('tbody', d.top.map((x, i) => h('tr', h('td', { style: { width: '40px', fontSize: '18px' } }, medal(i)),
      h('td', h('b', x.name), x.designation ? h('div.muted', { style: { fontSize: '12px' } }, x.designation) : null), scoreCell(x.score))))) : h('p.muted', 'No scores yet for this period.')) : null;
    const people = d.people ? h('div.card.flush', h('div', { style: { padding: '14px 16px 0' } }, h('h2', `🏆 ${dept || (d.scope === 'all' ? 'Everyone' : d.department)}: who is doing well`)), h('div.table-wrap', h('table.data',
      h('thead', h('tr', ['', 'Name', 'Department', 'Days worked', 'Attendance', 'Late', 'Work days', 'Hours', 'Done', 'Target', 'Output', 'Rejected', 'Quality', 'Score'].map((x, i) => h('th' + (i > 2 ? '.num' : ''), x)))),
      h('tbody', d.people.length ? d.people.map((r, i) => h('tr', h('td', r.score != null ? medal(i) : ''), h('td', h('b', r.name), r.designation ? h('div.muted', { style: { fontSize: '12px' } }, r.designation) : null), h('td', r.department),
        h('td.num', `${r.present_days} / ${r.working_days}`), h('td.num', p(r.attendance)), h('td.num', r.late_marks), h('td.num', r.work_days), h('td.num', r.work_hours), h('td.num', r.done), h('td.num', r.target || '—'), h('td.num', p(r.achievement)), h('td.num', r.rejected), h('td.num', p(r.quality)), scoreCell(r.score)))
        : h('tr', h('td', { colspan: 14 }, h('span.muted', 'Nobody in this department yet.'))))))) : null;
    const work = d.my_work?.length ? h('div.card', h('h2', '🧰 My work'), h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Work', 'Order', 'Target', 'Done', 'Rejected', 'Hours', 'Remark'].map((x, i) => h('th' + (i > 2 && i < 7 ? '.num' : ''), x)))),
      h('tbody', d.my_work.map(w => h('tr', h('td.nowrap', fmtDate(w.date)), h('td', w.work), h('td.nowrap', w.order_no || ''), h('td.num', w.target ?? ''), h('td.num', `${w.done ?? ''} ${w.uom || ''}`), h('td.num', w.rejected ?? ''), h('td.num', w.hours ?? ''), h('td', w.remark || ''))))))) : null;
    body.replaceChildren(filter, mine, leaders, deptTable, people, work,
      h('p.muted', { style: { fontSize: '12px' } }, `Score = output against target ${d.parts.output} % + attendance ${d.parts.attendance} % + quality ${d.parts.quality} %, over the parts that have data. Compare people doing similar work: quantities of different jobs are not the same.`));
  }

  async function teamScreen(date, department) {
    let t;
    try { t = await api(`/performance/team?${new URLSearchParams({ ...(date ? { date } : {}), ...(department ? { department } : {}) })}`); }
    catch (e) { body.replaceChildren(h('div.card', h('p', e.message))); return; }
    const dateI = h('input', { type: 'date', value: t.date, max: today(), style: { width: 'auto' }, onchange: e => teamScreen(e.target.value, t.department).catch(fail) });
    const dSel = h('select', { style: { width: 'auto' }, 'aria-label': 'Department', onchange: e => teamScreen(t.date, e.target.value).catch(fail) }, t.departments.map(x => h('option', { value: x }, x)));
    dSel.value = t.department;
    // what is entered for the day, and a blank row for everyone else in the team
    const rows = [...t.logs.map(l => ({ ...l })), ...t.employees.filter(e => !t.logs.some(l => l.employee_id === e.id)).map(e => ({ employee_id: e.id, work: '', uom: 'Nos' }))];
    const tbody = h('tbody');
    const draw2 = () => tbody.replaceChildren(...rows.map((r, i) => {
      const put = k => e => { r[k] = e.target.value; };
      const who = h('select', { onchange: put('employee_id'), style: { minWidth: '150px' } }, t.employees.map(e => h('option', { value: e.id }, e.name + (e.designation ? ` · ${e.designation}` : ''))));
      who.value = r.employee_id ?? '';
      const order = h('select', { onchange: put('order_id'), style: { minWidth: '130px' } }, h('option', { value: '' }, '—'), t.orders.map(o => h('option', { value: o.id }, o.label)));
      order.value = r.order_id ?? '';
      const n = (k, w = '76px') => h('input', { type: 'number', min: 0, step: 'any', value: r[k] ?? '', oninput: put(k), style: { width: w } });
      return h('tr', h('td', who), h('td', h('input', { value: r.work || '', list: 'team-works', placeholder: 'Work done', oninput: put('work'), style: { minWidth: '150px' } })), h('td', order),
        h('td', n('target')), h('td', n('done')), h('td', n('rejected')), h('td', h('input', { value: r.uom || '', oninput: put('uom'), style: { width: '60px' } })), h('td', n('hours', '64px')),
        h('td', h('input', { value: r.remark || '', oninput: put('remark'), style: { minWidth: '120px' } })),
        h('td.nowrap', h('button.icon-btn', { type: 'button', title: 'Add another work for this person', onclick: () => { rows.splice(i + 1, 0, { employee_id: r.employee_id, work: '', uom: r.uom }); draw2(); } }, '＋'),
          h('button.icon-btn.del', { type: 'button', title: 'Remove', onclick: () => { rows.splice(i, 1); draw2(); } }, '✕')));
    }));
    draw2();
    const save = h('button.btn.primary', { onclick: busy(async () => {
      const r = await api('/performance/team', { method: 'POST', body: { date: t.date, department: t.department, rows } });
      toast(`Saved: ${r.saved} row(s) for ${fmtDate(r.date)}`);
      await teamScreen(t.date, t.department);
    }) }, '💾 Save the day');
    body.replaceChildren(
      h('div.toolbar', h('span.muted', 'Date'), dateI, t.departments.length > 1 ? dSel : h('b', t.department), h('span', { style: { flex: 1 } }), t.employees.length ? save : null),
      t.employees.length ? h('div.card.flush.table-wrap', h('table.data.lines', h('thead', h('tr', ['Person', 'Work', 'Production order', 'Target', 'Done', 'Rejected / rework', 'UOM', 'Hours', 'Remark', ''].map(x => h('th', x)))), tbody))
        : h('div.card', h('p', `No active employee is in ${t.department || 'this department'} yet. HR sets the department on the employee record.`)),
      h('datalist', { id: 'team-works' }, WORKS.map(w => h('option', { value: w }))),
      h('p.muted', { style: { fontSize: '12px' } }, 'One row per person and work. Rows left without work or quantities are not saved. Saving again replaces this day for this department. The target is what was expected that day; without a target the score uses attendance and quality only.'));
  }

  async function draw() { await (tab === 'team' ? teamScreen() : report()); }
  drawTabs();
  root.replaceChildren(h('div.page-head', h('h1', '📈 Performance')), tabs, body);
  await draw();
}
