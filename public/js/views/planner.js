// Project Planner: a project's schedule as a Gantt chart, worked out like MS Project (working days Mon–Sat,
// "after" links, critical path, baseline vs forecast). Every change is saved at once and the dates are worked out
// again by the server. WIESPL, client and vendor activities sit in the same chart, in their own colours.
import { h, api, state, toast, fail, busy, modal, confirmBox, fmtDate, today, refOptions, badge } from '../ui.js';
import { SCHEDULE_PARTIES, DELAY_REASONS, UOMS } from '../schema.js';
import { itemPicker } from './form.js';

const PX = { Day: 22, Week: 6, Month: 2 };
const DAY = 86400000;
const T = s => Date.parse(s + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);
const plus = (s, n) => iso(T(s) + n * DAY);
const mondayOf = s => plus(s, -((new Date(T(s)).getUTCDay() + 6) % 7));
const dm = s => (s ? new Date(T(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const monthOf = s => new Date(T(s)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const days = n => `${n} day${Math.abs(n) === 1 ? '' : 's'}`;

const ui = (() => { try { return { zoom: 'Week', filter: 'All', ...JSON.parse(sessionStorage.getItem('planner-ui') || '{}') }; } catch { return { zoom: 'Week', filter: 'All' }; } })();
const keepUi = () => { try { sessionStorage.setItem('planner-ui', JSON.stringify({ zoom: ui.zoom, filter: ui.filter })); } catch { /* private window */ } };
const collapsed = new Set();

// The chart's time span: Monday before the earliest date to two weeks after the last.
export function span(rows, project) {
  const all = rows.flatMap(r => [r.plan_start, r.plan_finish, r.base_start, r.base_finish, r.actual_start, r.actual_finish]).filter(Boolean).sort();
  const from = mondayOf(all[0] || project.start_date || today());
  const to = plus(all.at(-1) || plus(from, 60), 14);
  return { from, to, days: Math.round((T(to) - T(from)) / DAY) + 1 };
}

// Rows to show: the filter, and phases folded away.
function visible(rows) {
  const keep = r => {
    switch (ui.filter) {
      case 'Open': return r.status !== 'Done';
      case 'Critical': return r.critical === 'Yes';
      case 'Late': return r.late_days > 0 || r.overdue === 'Yes';
      case 'All': return true;
      default: return r.party === ui.filter;
    }
  };
  const out = [];
  let phase = null, kids = [];
  const flush = () => { if (phase && (ui.filter === 'All' || kids.length)) out.push(phase, ...(collapsed.has(phase.id) ? [] : kids)); else if (!phase) out.push(...kids); };
  for (const r of rows) {
    if (r.kind === 'Phase') { flush(); phase = r; kids = []; } else if (keep(r)) kids.push(r);
  }
  flush();
  return out;
}

export async function plannerView(root, projectId) {
  const projects = await refOptions('projects');
  const picker = itemPicker(projects, projectId ? Number(projectId) : null, { onPick: id => { if (id) location.hash = `#/planner/${id}`; } });
  picker.querySelector('input').placeholder = 'Project name or work order no…';
  const head = h('div.page-head', h('h1', '📅 Project Planner'), h('div.actions', h('span', { style: { minWidth: '320px', display: 'inline-block' } }, picker)));
  if (!projectId) {
    root.replaceChildren(head, h('div', 'Loading all projects…'));
    root.replaceChildren(head, await portfolioView());
    return;
  }
  let d = await api(`/projects/${projectId}/schedule`);
  const out = h('div');

  const savedNote = h('span.muted', { style: { fontSize: '12px' } }, d.canEdit ? 'Changes save by themselves when you leave a cell' : 'View only: your login may not change schedules');
  const save = async (rows, deleted = []) => {
    savedNote.textContent = 'Saving…'; savedNote.style.color = '';
    try {
      d = await api(`/projects/${projectId}/schedule`, { method: 'PUT', body: { rows, deleted } });
      savedNote.textContent = `✓ Saved ${new Date().toTimeString().slice(0, 5)} · dates worked out again`; savedNote.style.color = 'var(--good)';
      render(); return true;
    } catch (e) { fail(e); savedNote.textContent = '✗ Not saved: ' + e.message; savedNote.style.color = 'var(--bad)'; d = await api(`/projects/${projectId}/schedule`); render(); return false; }
  };
  // Inline cell edits: saved when the cell is left, then the page is drawn again with the cell keeping focus.
  const cell = (r, key, input) => {
    input.dataset.row = r.id; input.dataset.key = key;
    input.onchange = () => {
      const v = input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
      if (key === 'name' && !String(v).trim()) { toast('The activity needs a name', true); input.value = r.name; return; }
      save([{ id: r.id, [key]: v }]);
    };
    input.onkeydown = e => { if (e.key === 'Enter') input.blur(); };
    return input;
  };

  function kpis() {
    const s = d.summary;
    const k = (label, value, sub, color) => h('div.kpi', h('div.label', label), h('div.value', { style: { fontSize: '19px', ...(color ? { color } : {}) } }, value), sub ? h('div.sub', sub) : null);
    const cur = d.baselines.find(b => b.status === 'Approved'), pending = d.baselines.find(b => b.status === 'Pending Approval');
    return h('div.kpis.tight',
      k('Start', fmtDate(s.start), d.project.engineer ? `PM / engineer: ${d.project.engineer}` : ''),
      k('Forecast finish', fmtDate(s.finish), s.base_finish ? `baseline ${cur?.rev || ''}: ${fmtDate(s.base_finish)}` : pending ? `baseline ${pending.rev} waiting for approval` : 'no baseline yet'),
      k('Against baseline', s.variance == null ? '—' : s.variance > 0 ? `+${days(s.variance)}` : s.variance < 0 ? `${days(s.variance)} early` : 'on time', s.variance > 0 ? 'working days late' : '', s.variance > 0 ? 'var(--bad)' : s.variance === 0 ? 'var(--good)' : null),
      k('Progress', `${s.progress}%`, `${s.done} of ${s.activities} activities done`),
      k('Critical path', s.critical, 'activities with no spare time', s.critical ? 'var(--bad)' : null),
      k('Late', s.late + s.overdue, s.late ? 'forecast after their baseline finish' : s.overdue ? 'past their finish date' : 'nothing late', s.late + s.overdue ? 'var(--warn)' : null),
      k('Client actions', s.client_open, 'client activities due in the next 14 days', s.client_open ? 'var(--warn)' : null));
  }

  function toolbar() {
    const zoom = h('select', { onchange: e => { ui.zoom = e.target.value; keepUi(); render(); } }, Object.keys(PX).map(z => h('option', { value: z, selected: ui.zoom === z }, z)));
    const filter = h('select', { onchange: e => { ui.filter = e.target.value; keepUi(); render(); } },
      [['All', 'All activities'], ['Open', 'Not done'], ['Critical', 'Critical path'], ['Late', 'Late'], ...SCHEDULE_PARTIES.map(p => [p, `${p} scope`])].map(([v, l]) => h('option', { value: v, selected: ui.filter === v }, l)));
    const hasRows = d.rows.length > 0;
    return h('div.toolbar',
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Zoom', zoom),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Show', filter),
      hasRows ? h('button.btn.small', { onclick: () => { for (const r of d.rows) if (r.kind === 'Phase') collapsed.add(r.id); render(); } }, '⊟ Fold phases') : null,
      hasRows ? h('button.btn.small', { onclick: () => { collapsed.clear(); render(); } }, '⊞ Unfold') : null,
      h('span', { style: { flex: 1 } }), savedNote,
      d.canEdit && hasRows ? h('button.btn.small', { onclick: () => editRow(null, 'Phase') }, '+ Phase') : null,
      d.canEdit && hasRows ? h('button.btn.small', { onclick: () => editRow(null, 'Activity') }, '+ Activity') : null,
      d.canEdit && hasRows ? h('button.btn.small', { onclick: busy(baseline) }, '📌 Freeze baseline') : null,
      hasRows ? h('a.btn.small', { href: `#/planner-print/${projectId}` }, '🖨 Print bar chart') : null,
      h('a.btn.small', { href: `#/view/projects/${projectId}` }, '🏗️ Project'), h('a.btn.small', { href: '#/planner' }, '📊 All projects'));
  }

  async function baseline() {
    const approved = d.baselines.some(b => ['Approved', 'Superseded'].includes(b.status));
    const reason = h('textarea', { rows: 3, placeholder: approved ? 'e.g. client approval of AHU GA drawing 3 weeks late; scope change in passage' : 'optional' });
    const ok = await modal(approved ? 'Re-baseline the schedule' : 'Freeze the first baseline (R0)', h('div.grid',
      h('p', `The planned dates as they are now (finish ${fmtDate(d.summary.finish)}) go to the Projects head for approval. Once approved, progress and delays are measured against them${approved ? '; the earlier baseline is kept' : ''}.`),
      h('label', approved ? 'Why is the schedule re-baselined? (required)' : 'Note', reason)),
    [{ label: 'Cancel', value: false }, { label: 'Send for approval', cls: 'primary', action: async () => {
      await api(`/projects/${projectId}/schedule/baseline`, { method: 'POST', body: { reason: reason.value } }); return true; } }]);
    if (ok) { toast('Baseline sent to the Projects head for approval'); window.dispatchEvent(new Event('approvals-changed')); d = await api(`/projects/${projectId}/schedule`); render(); }
  }

  // All fields of one row (also to add a row, move it, or delete it).
  async function editRow(r, kind = 'Activity', below = null) {
    const isNew = !r;
    const rows = d.rows;
    const at = isNew ? rows.length : rows.indexOf(r);
    r = r || { kind, party: 'WIESPL', duration: kind === 'Phase' ? 0 : 1, sr: Math.max(0, ...rows.map(x => x.sr)) + 1, after: '' };
    const f = {};
    const inp = (key, attrs = {}) => (f[key] = h('input', { value: r[key] ?? '', ...attrs }));
    const sel = (key, opts) => (f[key] = h('select', opts.map(o => h('option', { value: o, selected: (r[key] ?? '') === o }, o || '—'))));
    const people = h('datalist', { id: 'pl-people' }, (state.people || []).map(p => h('option', { value: p.name })));
    const uoms = h('datalist', { id: 'pl-uom' }, UOMS.map(u => h('option', { value: u })));
    const L = (label, el, hint) => h('label', label, el, hint ? h('span.hint', hint) : null);
    const phase = r.kind === 'Phase';
    const body = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' } }, people, uoms,
      L('Sr. No.', inp('sr', { type: 'number', min: 1 })),
      L('Type', sel('kind', ['Activity', 'Milestone', 'Phase'])),
      h('label', { style: { gridColumn: '1 / -1' } }, phase ? 'Phase' : 'Activity', inp('name', { placeholder: 'e.g. Approval of AHU GA drawing' })),
      phase ? null : [
        L('Scope', sel('party', SCHEDULE_PARTIES)),
        L('Department', inp('dept', { list: 'pl-dept' }), null), h('datalist', { id: 'pl-dept' }, ['Sales', 'Engg', 'Purchase', 'Production', 'Store', 'Site', 'Accounts', 'Client', 'PMC'].map(x => h('option', { value: x }))),
        L('Responsible', inp('responsible', { list: 'pl-people' })),
        L('Duration (working days)', inp('duration', { type: 'number', min: 0 }), 'Mon–Sat; 0 = milestone'),
        L('After (Sr. No.)', inp('after', { placeholder: '3, 5+2' }), '"5+2" = 2 days after 5 finishes; "4ss" = starts with 4'),
        L('Not before', inp('fixed_start', { type: 'date' })),
        L('Actual start', inp('actual_start', { type: 'date' })),
        L('Actual finish', inp('actual_finish', { type: 'date' }), 'Marks it Done'),
        L('Quantity (BOQ)', inp('qty', { type: 'number', min: 0 }), 'Progress = done ÷ quantity'),
        L('UOM', inp('uom', { list: 'pl-uom' })),
        L('Installed / done qty', inp('qty_done', { type: 'number', min: 0 })),
        L('Progress %', inp('progress', { type: 'number', min: 0, max: 100 }), 'When there is no quantity'),
        L('On hold', sel('status', ['', 'On hold'])),
        L('Delay reason', sel('delay_reason', DELAY_REASONS)),
        h('label', { style: { gridColumn: '1 / -1' } }, 'Remark', (f.remark = h('textarea', { rows: 2 }, r.remark || ''))),
        r.id ? h('div.muted', { style: { gridColumn: '1 / -1' } }, [`Plan ${fmtDate(r.plan_start)} – ${fmtDate(r.plan_finish)}`, r.base_finish ? `baseline ${fmtDate(r.base_start)} – ${fmtDate(r.base_finish)}` : null,
          r.total_float != null ? `float ${days(r.total_float)}` : null, r.late_days ? `${days(r.late_days)} late` : null].filter(Boolean).join(' · ')) : null]);
    if (f.status) f.status.value = r.status === 'On hold' ? 'On hold' : '';
    const collect = () => {
      const v = {};
      for (const [k, el] of Object.entries(f)) v[k] = ['sr', 'duration', 'qty', 'qty_done', 'progress'].includes(k) ? (el.value === '' ? null : Number(el.value)) : el.value;
      if ('status' in v) v.status = v.status || (r.status === 'On hold' ? 'Not started' : undefined);
      if (v.status === undefined) delete v.status;
      if (v.kind === 'Milestone') v.duration = 0;
      if (!String(v.name || '').trim()) throw new Error('Give it a name');
      if (!(v.sr > 0)) throw new Error('Give it a Sr. No.');
      return v;
    };
    const sortAt = i => { const a = rows[i - 1]?.sort ?? i, b = rows[i]?.sort ?? a + 2; return (Number(a) + Number(b)) / 2; };
    const buttons = [{ label: 'Cancel', value: null }];
    if (!isNew && d.canEdit) {
      buttons.unshift({ label: '🗑 Delete', cls: 'danger', action: async () => {
        if (!(await confirmBox(`Delete ${r.sr}. ${r.name}?${phase ? ' (only the heading; its activities stay)' : ''}`, 'Delete'))) return false;
        await save([], [r.id]); return true;
      } });
      buttons.push({ label: '↑', action: async () => { if (at > 0) await save([{ id: r.id, sort: sortAt(at - 1) }]); return true; } },
        { label: '↓', action: async () => { if (at < rows.length - 1) await save([{ id: r.id, sort: sortAt(at + 2) }]); return true; } },
        { label: '+ Insert below', value: 'insert' });
    }
    if (d.canEdit) buttons.push({ label: isNew ? 'Add' : 'Save', cls: 'primary', action: async () => {
      const v = collect();
      if (isNew) v.sort = sortAt(insertAt ?? rows.length);
      return save([isNew ? v : { id: r.id, ...v }]);
    } });
    const insertAt = isNew ? (below != null ? below + 1 : rows.length) : null;
    const res = await modal(isNew ? `New ${kind.toLowerCase()}` : `${r.sr}. ${r.name}`, body, buttons, { wide: true });
    if (res === 'insert') editRow(null, 'Activity', at);
  }

  function chart() {
    const rows = visible(d.rows);
    const px = PX[ui.zoom];
    const sp = span(d.rows, d.project);
    const width = sp.days * px;
    const x = s => ((T(s) - T(sp.from)) / DAY) * px;
    const t = d.summary.today;
    // header: months, then weeks (or days)
    const months = [];
    for (let s = sp.from; s <= sp.to;) {
      const next = iso(Date.UTC(new Date(T(s)).getUTCFullYear(), new Date(T(s)).getUTCMonth() + 1, 1));
      const end = next > sp.to ? plus(sp.to, 1) : next;
      months.push(h('div.gh-cell', { style: { left: x(s) + 'px', width: x(end) - x(s) + 'px' } }, x(end) - x(s) > 40 ? monthOf(s) : ''));
      s = end;
    }
    const ticks = [];
    if (ui.zoom === 'Day') for (let s = sp.from; s <= sp.to; s = plus(s, 1)) ticks.push(h('div.gh-cell' + (new Date(T(s)).getUTCDay() === 0 ? '.sun' : ''), { style: { left: x(s) + 'px', width: px + 'px' } }, String(new Date(T(s)).getUTCDate())));
    else if (ui.zoom === 'Week') for (let s = sp.from; s <= sp.to; s = plus(s, 7)) ticks.push(h('div.gh-cell', { style: { left: x(s) + 'px', width: 7 * px + 'px' } }, String(new Date(T(s)).getUTCDate())));
    const grid = { backgroundImage: `repeating-linear-gradient(to right, var(--grid) 0 1px, transparent 1px ${(ui.zoom === 'Day' ? 1 : 7) * px}px)`, width: width + 'px' };
    const timeHead = h('div.gt', { style: { width: width + 'px', height: '38px' } }, h('div.gh-row', months), h('div.gh-row.ticks', ticks));
    const ed = d.canEdit;
    const head = h('tr', h('th.sticky.c-sr', 'Sr'), h('th.sticky.c-name', 'Activity'), h('th.sticky.c-party', 'Scope'), h('th.sticky.c-days', 'Days'), h('th.sticky.c-after', 'After'),
      h('th.sticky.c-start', 'Start'), h('th.sticky.c-finish', 'Finish'), h('th.sticky.c-pct', '%'), h('th.c-time', timeHead));
    const body = rows.map(r => {
      const phase = r.kind === 'Phase', ms = r.kind === 'Milestone';
      const late = r.late_days > 0 || r.overdue === 'Yes';
      const bars = [];
      if (!phase && r.base_start && r.base_finish) bars.push(h('div.gb-base', { style: { left: x(r.base_start) + 'px', width: Math.max(2, x(plus(r.base_finish, 1)) - x(r.base_start)) + 'px' } }));
      if (r.plan_start && r.plan_finish) {
        const left = x(r.plan_start), w = Math.max(3, x(plus(r.plan_finish, 1)) - left);
        const tip = [`${r.sr}. ${r.name}`, `Plan ${fmtDate(r.plan_start)} – ${fmtDate(r.plan_finish)}`, r.base_finish ? `Baseline ${fmtDate(r.base_start)} – ${fmtDate(r.base_finish)}` : '',
          r.actual_start ? `Actual ${fmtDate(r.actual_start)} – ${fmtDate(r.actual_finish) || 'in progress'}` : '', `${r.progress || 0}% done`,
          r.total_float != null ? `Float ${days(r.total_float)}` : '', r.late_days ? `${days(r.late_days)} late${r.delay_reason ? ' – ' + r.delay_reason : ''}` : '', r.remark || ''].filter(Boolean).join('\n');
        if (phase) bars.push(h('div.gb-phase', { title: tip, style: { left: left + 'px', width: w + 'px' } }));
        else if (ms) bars.push(h('div.gb-ms' + (late ? '.late' : ''), { title: tip, style: { left: left + px / 2 - 7 + 'px' } }, '◆'));
        else bars.push(h(`div.gb.p-${r.party || 'Other'}${late ? '.late' : ''}${r.critical === 'Yes' ? '.crit' : ''}${r.status === 'Done' ? '.done' : ''}`, { title: tip, style: { left: left + 'px', width: w + 'px' } },
          h('div.gb-prog', { style: { width: `${Math.min(100, r.progress || 0)}%` } })));
        if (!phase && w > 0 && ui.zoom !== 'Month') bars.push(h('div.gb-label', { style: { left: left + w + 4 + 'px' } }, r.late_days ? `+${r.late_days}d` : r.status === 'Done' ? '✓' : ''));
      }
      if (t >= sp.from && t <= sp.to) bars.push(h('div.g-today', { style: { left: x(t) + px / 2 + 'px' } }));
      const nameCell = phase
        ? h('td.sticky.c-name', h('button.fold', { onclick: () => { collapsed.has(r.id) ? collapsed.delete(r.id) : collapsed.add(r.id); render(); } }, collapsed.has(r.id) ? '▸' : '▾'), h('b', r.name))
        : h('td.sticky.c-name', ed ? cell(r, 'name', h('input', { value: r.name })) : h('span', { title: r.name }, r.name), r.responsible ? h('span.who', r.responsible) : null);
      return h('tr' + (phase ? '.phase' : '') + (r.status === 'Done' ? '.done' : ''),
        h('td.sticky.c-sr', h('a', { href: 'javascript:void 0', title: 'All details', onclick: () => editRow(r) }, r.sr)),
        nameCell,
        h('td.sticky.c-party', phase ? '' : ed ? cell(r, 'party', h('select', SCHEDULE_PARTIES.map(p => h('option', { value: p, selected: r.party === p }, p)))) : h('span.party.p-' + (r.party || 'Other'), r.party)),
        h('td.sticky.c-days', phase ? r.duration || '' : ed ? cell(r, 'duration', h('input', { type: 'number', min: 0, value: r.duration ?? '' })) : r.duration),
        h('td.sticky.c-after', phase ? '' : ed ? cell(r, 'after', h('input', { value: r.after || '', placeholder: '—' })) : r.after || ''),
        h('td.sticky.c-start', { title: r.actual_start ? `actual start ${fmtDate(r.actual_start)}` : '' }, r.actual_start ? h('b', dm(r.actual_start)) : dm(r.plan_start)),
        h('td.sticky.c-finish' + (late ? '.bad' : ''), { title: r.base_finish ? `baseline finish ${fmtDate(r.base_finish)}` : '' }, r.actual_finish ? h('b', dm(r.actual_finish)) : dm(r.plan_finish)),
        h('td.sticky.c-pct', !phase && ed && !(Number(r.qty) > 0) ? cell(r, 'progress', h('input', { type: 'number', min: 0, max: 100, value: r.progress ?? 0 })) : `${Math.round(r.progress || 0)}`),
        h('td.c-time', h('div.gt', { style: grid }, bars)));
    });
    return h('div.gantt-wrap', h('table.gantt', h('thead', head), h('tbody', body)));
  }

  function legend() {
    const sw = (cls, label) => h('span.lg', h('span.' + cls), label);
    return h('div.gantt-legend', sw('gb.p-WIESPL', 'WIESPL'), sw('gb.p-Client', 'Client'), sw('gb.p-Vendor', 'Vendor'), sw('gb.p-PMC', 'PMC / other'),
      sw('gb.late', 'Late'), sw('gb.crit', 'Critical path'), sw('gb-base', 'Baseline'), h('span.lg', h('span', { style: { color: 'var(--bad)' } }, '│'), 'Today'),
      h('span.muted', 'Darker part of a bar = progress. Click a Sr. No. for all details (actual dates, quantity, delay reason, remark).'));
  }

  function emptyCard() {
    if (!d.canEdit) return h('div.card', h('p', 'No schedule yet for this project.'));
    const tpl = h('select', d.templates.map(x => h('option', { value: x.key }, `${x.label} – ${x.rows} rows`)));
    const start = h('input', { type: 'date', value: d.project.start_date || today() });
    return h('div.card', h('h2', 'Start the schedule'),
      h('p.muted', 'Pick a standard schedule and the start date: the activities, scope (WIESPL / client), durations and links come in, and every date is worked out (Mon–Sat, holidays off). Change anything afterwards.'),
      h('div.toolbar', h('label', 'Template', tpl), h('label', 'Start date', start),
        h('button.btn.primary', { style: { alignSelf: 'end' }, onclick: busy(async () => {
          d = await api(`/projects/${projectId}/schedule/template`, { method: 'POST', body: { template: tpl.value, start: start.value } });
          toast('Schedule created'); render();
        }) }, 'Create schedule'),
        h('span.muted', { style: { alignSelf: 'end' } }, 'or'),
        h('button.btn', { style: { alignSelf: 'end' }, onclick: () => editRow(null, 'Activity') }, '+ Add activities by hand')));
  }

  function render() {
    const focus = document.activeElement?.dataset?.row ? { row: document.activeElement.dataset.row, key: document.activeElement.dataset.key } : null;
    const pend = d.baselines.find(b => b.status === 'Pending Approval');
    out.replaceChildren(
      h('div.muted', { style: { marginBottom: '10px' } }, [d.project.no, d.project.name, d.project.customer, d.project.site, d.project.pmc && `PMC: ${d.project.pmc}`].filter(Boolean).join('   ·   ')),
      d.rows.length ? kpis() : null,
      d.problems.length ? h('div.card', { style: { borderColor: 'var(--warn)', background: 'var(--warn-bg)', padding: '10px 14px' } }, h('b', 'Check the schedule: '), d.problems.join(' · ')) : null,
      pend ? h('div.card', { style: { padding: '10px 14px' } }, '📌 Baseline ', h('b', pend.rev), ` (finish ${fmtDate(pend.finish)}) is waiting for the Projects head's approval – `, h('a', { href: `#/view/schedule_baselines/${pend.id}` }, 'open')) : null,
      toolbar(),
      d.rows.length ? [chart(), legend(),
        d.baselines.length ? h('div.muted', { style: { marginTop: '8px' } }, 'Baselines: ', d.baselines.map((b, i) => [i ? ' · ' : '', h('a', { href: `#/view/schedule_baselines/${b.id}` }, b.rev), ' ', badge(b.status), ` finish ${fmtDate(b.finish)}`])) : null]
        : emptyCard());
    if (focus) out.querySelector(`[data-row="${focus.row}"][data-key="${focus.key}"]`)?.focus();
  }

  root.replaceChildren(head, out);
  render();
}

// ---------------------------------------------------------------- all projects at a glance
// Each open project on one line: progress, forecast finish against the baseline, what is late, what is going on now,
// the next milestone and dispatch, and a bar on one shared time line (today marked) to compare the projects.
async function portfolioView() {
  const { today: t, projects } = await api('/planner/portfolio');
  const sched = projects.filter(p => p.has_schedule);
  const lateOf = p => (p.summary.variance > 0 ? p.summary.variance : 0) + p.summary.late + p.summary.overdue;
  sched.sort((a, b) => lateOf(b) - lateOf(a) || String(a.summary.finish).localeCompare(String(b.summary.finish)));
  const dates = sched.flatMap(p => [p.summary.start, p.summary.finish, p.summary.base_finish]).filter(Boolean).sort();
  const from = mondayOf(dates[0] || t), to = plus(dates.at(-1) || plus(t, 90), 7);
  const pos = s => Math.max(0, Math.min(100, ((T(s) - T(from)) / (T(to) - T(from))) * 100));
  const avg = sched.length ? Math.round(sched.reduce((a, p) => a + p.summary.progress, 0) / sched.length) : 0;
  const k = (label, value, sub, color) => h('div.kpi', h('div.label', label), h('div.value', { style: color ? { color } : {} }, value), sub ? h('div.sub', sub) : null);
  const lateN = sched.filter(p => lateOf(p) > 0).length;
  const bar = p => {
    const s = p.summary;
    return h('div', { style: { position: 'relative', height: '22px', background: 'var(--surface-2, #f3f4f6)', borderRadius: '4px', minWidth: '220px' } },
      h('div', { title: `${fmtDate(s.start)} → ${fmtDate(s.finish)} · ${s.progress}% done`, style: { position: 'absolute', top: '5px', height: '12px', left: pos(s.start) + '%', width: Math.max(1, pos(plus(s.finish, 1)) - pos(s.start)) + '%', background: s.variance > 0 ? 'var(--bad)' : 'var(--accent, #2563eb)', opacity: 0.35, borderRadius: '3px' } },
        h('div', { style: { height: '100%', width: Math.min(100, s.progress) + '%', background: s.variance > 0 ? 'var(--bad)' : 'var(--accent, #2563eb)', borderRadius: '3px' } })),
      s.base_finish ? h('div', { title: `baseline finish ${fmtDate(s.base_finish)}`, style: { position: 'absolute', top: '2px', height: '18px', width: '2px', left: pos(s.base_finish) + '%', background: '#111' } }) : null,
      h('div', { title: `today ${fmtDate(t)}`, style: { position: 'absolute', top: 0, bottom: 0, width: '1px', left: pos(t) + '%', background: 'var(--bad)' } }));
  };
  const scale = () => {
    const marks = [];
    for (let s = iso(Date.UTC(new Date(T(from)).getUTCFullYear(), new Date(T(from)).getUTCMonth() + 1, 1)); s < to; s = iso(Date.UTC(new Date(T(s)).getUTCFullYear(), new Date(T(s)).getUTCMonth() + 1, 1)))
      marks.push(h('span', { style: { position: 'absolute', left: pos(s) + '%', fontSize: '11px', color: 'var(--muted)', borderLeft: '1px solid var(--grid, #ddd)', paddingLeft: '2px' } }, monthOf(s)));
    return h('div', { style: { position: 'relative', height: '16px', minWidth: '220px' } }, marks);
  };
  const vs = s => s.variance == null ? h('span.muted', 'no baseline') : s.variance > 0 ? h('b', { style: { color: 'var(--bad)' } }, `+${days(s.variance)} late`) : s.variance < 0 ? h('span', { style: { color: 'var(--good)' } }, `${days(-s.variance)} early`) : h('span', { style: { color: 'var(--good)' } }, 'on time');
  const rows = sched.map(p => {
    const s = p.summary;
    return h('tr.clickable', { onclick: () => (location.hash = `#/planner/${p.id}`) },
      h('td', h('b', p.name), h('div.muted', { style: { fontSize: '12px' } }, [p.no, p.customer, p.engineer && `PM: ${p.engineer}`].filter(Boolean).join(' · '))),
      h('td', { style: { minWidth: '120px' } }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        h('div', { style: { flex: 1, height: '8px', background: 'var(--surface-2, #eee)', borderRadius: '4px', overflow: 'hidden' } }, h('div', { style: { width: s.progress + '%', height: '100%', background: 'var(--good)' } })),
        h('b', `${Math.round(s.progress)}%`)), h('div.muted', { style: { fontSize: '11px' } }, `${s.done} of ${s.activities} done`)),
      h('td.nowrap', fmtDate(s.finish), h('div', { style: { fontSize: '12px' } }, vs(s))),
      h('td', { style: { fontSize: '12px' } }, p.late.length ? p.late.map(x => h('div', { style: { color: 'var(--bad)' } }, `${x.sr}. ${x.name.slice(0, 40)}${x.days ? ` +${x.days}d` : ' (past finish)'}`)) : h('span', { style: { color: 'var(--good)' } }, 'nothing late'),
        s.client_open ? h('div', { style: { color: 'var(--warn)' } }, `${s.client_open} client action(s) due in 14 days`) : null),
      h('td', { style: { fontSize: '12px' } }, p.now.length ? p.now.map(x => h('div', `${x.sr}. ${x.name.slice(0, 40)}${x.party !== 'WIESPL' ? ` (${x.party})` : ''}`)) : h('span.muted', '—')),
      h('td', { style: { fontSize: '12px' } }, p.next_milestone ? [h('div', '◆ ' + p.next_milestone.name.slice(0, 40)), h('div.muted', fmtDate(p.next_milestone.date))] : h('span.muted', '—'),
        p.next_dispatch ? h('div', { style: { marginTop: '3px' } }, `🚛 ${p.next_dispatch.plan_no} ${fmtDate(p.next_dispatch.planned_date)}`) : null),
      h('td', bar(p)));
  });
  const none = projects.filter(p => !p.has_schedule);
  return h('div',
    h('div.kpis', k('Open projects', projects.length, `${sched.length} with a schedule`), k('Average progress', `${avg}%`),
      k('Late', lateN, 'behind baseline or past a finish date', lateN ? 'var(--bad)' : 'var(--good)'),
      k('On time', sched.length - lateN, '', 'var(--good)'),
      k('Client actions', sched.reduce((a, p) => a + p.summary.client_open, 0), 'due in the next 14 days')),
    sched.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
      h('thead', h('tr', h('th', 'Project'), h('th', 'Progress'), h('th', 'Forecast finish'), h('th', 'Late / client'), h('th', 'Going on now'), h('th', 'Next milestone / dispatch'), h('th', scale()))),
      h('tbody', rows)))) : null,
    h('p.muted', { style: { fontSize: '12px' } }, 'Late projects first. The bar runs from start to forecast finish (darker part = progress, red = behind baseline); the black mark is the baseline finish, the red line is today. Click a project to open its Gantt chart.'),
    none.length ? h('div.card', h('h3', { style: { margin: '0 0 6px' } }, 'Projects without a schedule'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, none.map(p => h('a.btn.small', { href: `#/planner/${p.id}` }, `+ ${p.no ? p.no + ' · ' : ''}${p.name.trim().slice(0, 50)}`)))) : null);
}

// ---------------------------------------------------------------- printed bar chart (A3 landscape, like the WIESPL Excel)
export async function plannerPrint(root, projectId) {
  root.classList.remove('hidden');
  root.replaceChildren(h('div.empty', 'Preparing the bar chart…'));
  const [d, s] = await Promise.all([api(`/projects/${projectId}/schedule`), api('/settings')]);
  const p = d.project;
  const sp = span(d.rows, p);
  const weeks = [];
  for (let w = sp.from; w <= sp.to; w = plus(w, 7)) weeks.push(w);
  const cur = d.baselines.find(b => b.status === 'Approved');
  const on = (a, b, w) => a && b && a <= plus(w, 6) && b >= w;
  const months = [];
  for (const w of weeks) { const m = monthOf(w); if (months.at(-1)?.m === m) months.at(-1).n++; else months.push({ m, n: 1 }); }
  const wcol = `${Math.max(4, Math.min(14, 200 / weeks.length)).toFixed(1)}mm`;
  const info = (k, v) => h('tr', h('th', k), h('td', v || ''));
  const doc = h('div.doc', h('div.page.gantt',
    h('div.gp-head',
      h('img', { src: 'logo.jpeg', alt: 'WIESPL', style: { height: '46px' } }),
      h('div.gp-title', h('div', { style: { fontSize: '16px', fontWeight: 700 } }, `${(s.company_name || 'WIESPL').toUpperCase()} – PROJECT SCHEDULE (BAR CHART)`),
        h('div', { style: { fontSize: '11px' } }, `${cur ? `Baseline ${cur.rev}` : 'Not baselined'} · printed ${fmtDate(today())} · progress ${d.summary.progress}% · forecast finish ${fmtDate(d.summary.finish)}${d.summary.variance > 0 ? ` (${d.summary.variance} working days late)` : ''}`)),
      h('table.gp-info', info('Site name', p.customer || p.name), info('Location', p.site || p.site_address), info('Project', [p.no, p.name].filter(Boolean).join(' – ')), info('PMC', p.pmc)),
      h('table.gp-legend', h('tr', h('td', h('span.sw.p-WIESPL')), h('td', 'WIESPL scope')), h('tr', h('td', h('span.sw.p-Client')), h('td', 'Client scope')),
        h('tr', h('td', h('span.sw.p-Vendor')), h('td', 'Vendor / PMC')), h('tr', h('td', h('span.sw.base')), h('td', 'Baseline')))),
    h('table.gp',
      h('colgroup', h('col', { style: { width: '8mm' } }), h('col', { style: { width: '70mm' } }), h('col', { style: { width: '15mm' } }), h('col', { style: { width: '14mm' } }), h('col', { style: { width: '14mm' } }), h('col', { style: { width: '8mm' } }),
        weeks.map(() => h('col', { style: { width: wcol } })), h('col', { style: { width: '42mm' } })),
      h('thead',
        h('tr', h('th', { rowSpan: 2 }, 'Sr.'), h('th', { rowSpan: 2 }, 'Description'), h('th', { rowSpan: 2 }, 'Scope'), h('th', { rowSpan: 2 }, 'Start'), h('th', { rowSpan: 2 }, 'Finish'), h('th', { rowSpan: 2 }, '%'),
          months.map(m => h('th', { colSpan: m.n }, m.m)), h('th', { rowSpan: 2 }, 'Remark')),
        h('tr', weeks.map(w => h('th.wk', { title: `${dm(w)} – ${dm(plus(w, 6))}` }, `${new Date(T(w)).getUTCDate()}–${new Date(T(plus(w, 6))).getUTCDate()}`)))),
      h('tbody', d.rows.map(r => {
        const phase = r.kind === 'Phase';
        const late = r.late_days > 0 || r.overdue === 'Yes';
        return h('tr' + (phase ? '.phase' : ''),
          h('td.c', r.sr), h('td', phase ? h('b', r.name) : r.name), h('td.c', phase ? '' : r.party), h('td.c', fmtDate(r.actual_start || r.plan_start).slice(0, 5)), h('td.c' + (late ? '.late' : ''), fmtDate(r.actual_finish || r.plan_finish).slice(0, 5)),
          h('td.c', phase || r.progress ? Math.round(r.progress || 0) : ''),
          weeks.map(w => h('td.w', on(r.base_start, r.base_finish, w) && !phase ? h('div.wb') : null,
            on(r.plan_start, r.plan_finish, w) ? h('div.wf' + (phase ? '.phase' : `.p-${r.party || 'Other'}`) + (late && !phase ? '.late' : '') + (r.kind === 'Milestone' ? '.ms' : '')) : null)),
          h('td.rm', [r.late_days ? `${r.late_days} days late${r.delay_reason ? ' – ' + r.delay_reason : ''}` : '', r.remark || ''].filter(Boolean).join('. ')));
      }))),
    h('div.gp-sign', ['Prepared by (WIESPL Project Manager)', 'Checked by (Projects Head)', `Acknowledged by (Client / PMC${p.pmc ? ' – ' + p.pmc : ''})`].map(x => h('div', h('div.line'), x)))));
  root.replaceChildren(h('div.print-bar', h('b', `Bar chart – ${p.name}`), h('span', { style: { flex: 1 } }),
    h('span', { style: { fontSize: '12px', opacity: 0.8 } }, 'A3 landscape · use "Save as PDF" in the print dialog'),
    h('button.btn.small', { onclick: () => window.print() }, '🖨 Print / Save PDF'),
    h('button.btn.small', { onclick: () => (location.hash = `#/planner/${projectId}`) }, 'Close')), doc);
  document.title = `Bar chart ${p.no || ''} ${p.name}`;
}
