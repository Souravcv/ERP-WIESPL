// Project Planner: a project's schedule (phases, activities, milestones) worked out like MS Project — durations in
// working days (Mon–Sat, holidays off), "after" links (finish-to-start or start-to-start, with a lag), a forward pass
// for the dates, a backward pass for float and the critical path. Once a baseline is approved, unfinished work is
// never planned before today and every activity is measured against its baseline dates.
import { db, tx, audit } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { canView, canWrite, ENTITIES } from '../public/js/schema.js';
import { submitForApproval } from './workflows.js';
import { templateRows, TEMPLATES } from './scheduletemplates.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const now = () => new Date().toLocaleString('sv-SE').slice(0, 19);

// ---------------------------------------------------------------- working-day calendar
const D = s => new Date(s + 'T00:00:00Z');
const S = d => d.toISOString().slice(0, 10);
const shift = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export function calendar() {
  const hol = new Set(db.prepare("SELECT date FROM holidays WHERE COALESCE(optional, 'No') <> 'Yes'").all().map(r => r.date));
  const isWork = s => D(s).getUTCDay() !== 0 && !hol.has(s);
  const onOrAfter = s => { while (!isWork(s)) s = shift(s, 1); return s; };
  const onOrBefore = s => { while (!isWork(s)) s = shift(s, -1); return s; };
  // Move n working days from a working day (n may be negative); 0 = the day itself.
  const add = (s, n) => {
    s = n >= 0 ? onOrAfter(s) : onOrBefore(s);
    for (let i = 0; i < Math.abs(n); i++) { s = shift(s, Math.sign(n)); while (!isWork(s)) s = shift(s, Math.sign(n)); }
    return s;
  };
  // Working days from a to b (b after a → positive; same day → 0).
  const between = (a, b) => {
    if (a === b) return 0;
    const sign = a < b ? 1 : -1;
    let n = 0, s = a;
    while (s !== b) { s = shift(s, sign); if (isWork(s)) n += sign; }
    return n;
  };
  return { isWork, onOrAfter, onOrBefore, add, between };
}

// "3, 5+2, 4ss, 7-1" → [{ sr: 3, type: 'FS', lag: 0 }, { sr: 5, type: 'FS', lag: 2 }, { sr: 4, type: 'SS', lag: 0 }, …]
export function parseAfter(text) {
  const out = [], bad = [];
  for (const tok of String(text || '').split(/[,;\s]+(?![+-])/).map(t => t.replace(/\s+/g, '')).filter(Boolean)) {
    const m = tok.match(/^(\d+)(ss|fs)?([+-]\d+)?d?$/i);
    if (m) out.push({ sr: Number(m[1]), type: (m[2] || 'FS').toUpperCase(), lag: Number(m[3] || 0) });
    else bad.push(tok);
  }
  return { links: out, bad };
}

const rowsOf = projectId => db.prepare('SELECT * FROM schedule_activities WHERE project_id = ? ORDER BY COALESCE(sort, sr), sr, id').all(Number(projectId));
const hasBaseline = projectId => !!db.prepare("SELECT 1 FROM schedule_baselines WHERE project_id = ? AND status = 'Approved'").get(Number(projectId));
const weight = r => Math.max(Number(r.duration) || 0, r.kind === 'Milestone' ? 0 : 1);

// Work out every date, float and the critical path; returns rows (with phase roll-ups) and the problems found.
export function compute(projectId, { save = true } = {}) {
  const project = getRow('projects', projectId);
  const cal = calendar();
  const t = today();
  const rows = rowsOf(projectId);
  const acts = rows.filter(r => r.kind !== 'Phase');
  const bySr = new Map(acts.map(r => [Number(r.sr), r]));
  const problems = [];
  const dupe = rows.filter((r, i) => rows.findIndex(x => Number(x.sr) === Number(r.sr)) !== i);
  if (dupe.length) problems.push(`Sr. No. used twice: ${[...new Set(dupe.map(r => r.sr))].join(', ')}`);
  const phaseSrs = new Set(rows.filter(r => r.kind === 'Phase').map(r => Number(r.sr)));
  for (const r of acts) {
    const { links, bad } = parseAfter(r.after);
    if (bad.length) problems.push(`${r.sr}: cannot read "${bad.join(' ')}" in After`);
    r.links = links.filter(l => {
      if (l.sr === Number(r.sr)) { problems.push(`${r.sr}: cannot come after itself`); return false; }
      if (phaseSrs.has(l.sr)) { problems.push(`${r.sr}: ${l.sr} is a phase heading – link to an activity`); return false; }
      if (!bySr.has(l.sr)) { problems.push(`${r.sr}: there is no activity ${l.sr}`); return false; }
      return true;
    });
  }
  // Order so that every activity comes after the ones it waits for; a loop is reported and its links ignored.
  const order = [], state = new Map();
  const visit = (r, path) => {
    if (state.get(r.id) === 2) return;
    if (state.get(r.id) === 1) { problems.push(`Loop in the links: ${[...path, r.sr].join(' → ')}`); return 'loop'; }
    state.set(r.id, 1);
    r.links = r.links.filter(l => visit(bySr.get(l.sr), [...path, r.sr]) !== 'loop');
    state.set(r.id, 2);
    order.push(r);
  };
  for (const r of acts) visit(r, []);

  const based = hasBaseline(projectId);
  const projStart = cal.onOrAfter(project.start_date || t);
  const statusDay = cal.onOrAfter(t);
  // Forward pass: earliest dates.
  for (const r of order) {
    const dur = r.kind === 'Milestone' ? 0 : Math.max(1, Math.round(Number(r.duration) || 1));
    r._dur = dur;
    const qtyPct = Number(r.qty) > 0 ? Math.min(100, Math.round((Number(r.qty_done) || 0) / Number(r.qty) * 1000) / 10) : null;
    r.progress = r.actual_finish ? 100 : qtyPct ?? Math.min(100, Math.max(0, Number(r.progress) || 0));
    let es = projStart;
    if (r.fixed_start && r.fixed_start > es) es = cal.onOrAfter(r.fixed_start);
    for (const l of r.links) {
      const p = bySr.get(l.sr);
      const c = l.type === 'SS' ? cal.add(p.plan_start, l.lag) : dur === 0 && !l.lag ? p.plan_finish : cal.add(cal.add(p.plan_finish, 1), l.lag);
      if (c > es) es = c;
    }
    if (r.actual_start) es = r.actual_start;
    else if (based && es < statusDay) es = statusDay;
    let ef = dur === 0 ? es : cal.add(es, dur - 1);
    if (r.actual_finish) ef = r.actual_finish;
    else if (r.actual_start && dur) {
      const left = Math.ceil(dur * (1 - r.progress / 100));
      const byProgress = left > 0 ? cal.add(statusDay, left - 1) : statusDay;
      if (byProgress > ef) ef = byProgress;
    }
    r.plan_start = es; r.plan_finish = ef;
    r.status = r.actual_finish ? 'Done' : r.status === 'On hold' ? 'On hold' : r.actual_start ? 'In progress' : 'Not started';
  }
  // Backward pass: latest dates without moving the finish → float; float ≤ 0 is the critical path.
  const finish = acts.reduce((m, r) => (r.plan_finish > m ? r.plan_finish : m), projStart);
  const succ = new Map(acts.map(r => [r.id, []]));
  for (const r of acts) for (const l of r.links) succ.get(bySr.get(l.sr).id).push({ r, l });
  for (const r of [...order].reverse()) {
    let lf = finish;
    for (const { r: s, l } of succ.get(r.id)) {
      const c = l.type === 'SS' ? cal.add(cal.add(s._ls, -l.lag), r._dur ? r._dur - 1 : 0)
        : s._dur === 0 && !l.lag ? s._ls : cal.add(cal.add(s._ls, -l.lag), -1);
      if (c < lf) lf = c;
    }
    r._lf = lf;
    r._ls = r._dur ? cal.add(lf, -(r._dur - 1)) : lf;
    const done = r.status === 'Done';
    r.total_float = done ? null : cal.between(r.plan_finish, lf);
    r.critical = !done && r.total_float <= 0 ? 'Yes' : '';
  }
  // Late against the baseline (working days), or past its finish without a baseline.
  for (const r of acts) {
    r.late_days = r.base_finish && r.status !== 'Done' ? Math.max(0, cal.between(r.base_finish, r.plan_finish))
      : r.base_finish && r.actual_finish ? Math.max(0, cal.between(r.base_finish, r.actual_finish)) : 0;
    r.overdue = r.status !== 'Done' && r.plan_finish < t ? 'Yes' : '';
  }
  // Phases: the span and the weighted progress of the activities under them (until the next phase).
  let phase = null;
  const kids = new Map();
  for (const r of rows) { if (r.kind === 'Phase') { phase = r; kids.set(r.id, []); } else if (phase) kids.get(phase.id).push(r); }
  for (const p of rows.filter(r => r.kind === 'Phase')) {
    const k = kids.get(p.id);
    const min = key => k.map(x => x[key]).filter(Boolean).sort()[0] || null;
    const max = key => k.map(x => x[key]).filter(Boolean).sort().at(-1) || null;
    Object.assign(p, { plan_start: min('plan_start'), plan_finish: max('plan_finish'), base_start: min('base_start'), base_finish: max('base_finish'),
      actual_start: min('actual_start'), actual_finish: k.length && k.every(x => x.actual_finish) ? max('actual_finish') : null, total_float: null,
      critical: k.some(x => x.critical === 'Yes') ? 'Yes' : '', late_days: Math.max(0, ...k.map(x => x.late_days || 0)) });
    const w = k.reduce((s, x) => s + weight(x), 0);
    p.progress = w ? Math.round(k.reduce((s, x) => s + weight(x) * x.progress, 0) / w * 10) / 10 : 0;
    p.status = !k.length ? 'Not started' : k.every(x => x.status === 'Done') ? 'Done' : k.some(x => x.actual_start) ? 'In progress' : 'Not started';
    p.duration = p.plan_start && p.plan_finish ? cal.between(p.plan_start, p.plan_finish) + 1 : 0;
  }
  if (save) {
    const up = db.prepare('UPDATE schedule_activities SET plan_start = ?, plan_finish = ?, total_float = ?, critical = ?, status = ?, progress = ? WHERE id = ?');
    tx(() => { for (const r of rows) up.run(r.plan_start || null, r.plan_finish || null, r.total_float ?? null, r.critical || '', r.status, r.progress ?? 0, r.id); });
  }
  const w = acts.reduce((s, x) => s + weight(x), 0);
  const baseFinish = acts.map(r => r.base_finish).filter(Boolean).sort().at(-1) || null;
  const summary = {
    start: acts.map(r => r.plan_start).filter(Boolean).sort()[0] || projStart, finish: acts.length ? finish : null,
    base_start: acts.map(r => r.base_start).filter(Boolean).sort()[0] || null, base_finish: baseFinish,
    variance: baseFinish && acts.length ? cal.between(baseFinish, finish) : null,
    progress: w ? Math.round(acts.reduce((s, x) => s + weight(x) * x.progress, 0) / w * 10) / 10 : 0,
    activities: acts.length, done: acts.filter(r => r.status === 'Done').length, critical: acts.filter(r => r.critical === 'Yes').length,
    late: acts.filter(r => r.late_days > 0 && r.status !== 'Done').length, overdue: acts.filter(r => r.overdue).length,
    client_open: acts.filter(r => r.party === 'Client' && r.status !== 'Done' && r.plan_start <= shift(t, 14)).length,
    baselined: based, today: t,
  };
  for (const r of rows) { delete r._dur; delete r._lf; delete r._ls; delete r.links; }
  return { project, rows, problems: [...new Set(problems)], summary };
}

// ---------------------------------------------------------------- what the planner page reads and writes
const mayView = user => { if (!canView('schedule_activities', user.role)) throw new HttpError(403, 'No access to project schedules'); };
const mayEdit = user => { if (!canWrite('schedule_activities', user.role)) throw new HttpError(403, 'You may not change project schedules'); };

export function plannerData(projectId, user) {
  mayView(user);
  const out = compute(projectId);
  const p = getRow('projects', projectId);
  out.project = { id: p.id, name: p.name, no: p.project_no || p.code, customer: p.customer_id_label, site: p.site, site_address: p.site_address, pmc: p.pmc,
    engineer: p.engineer, start_date: p.start_date, target_date: p.target_date, status: p.status };
  out.baselines = db.prepare('SELECT id, rev, status, start, finish, activities, reason, requested_by, approved_by, created_at FROM schedule_baselines WHERE project_id = ? ORDER BY id DESC').all(Number(projectId));
  out.templates = Object.entries(TEMPLATES).map(([key, x]) => ({ key, label: x.label, rows: x.rows.length }));
  out.canEdit = canWrite('schedule_activities', user.role);
  return out;
}

const EDITABLE = ['sr', 'kind', 'name', 'party', 'dept', 'responsible', 'duration', 'after', 'fixed_start', 'actual_start', 'actual_finish', 'qty', 'uom', 'qty_done', 'progress', 'status', 'delay_reason', 'remark', 'sort'];

// Save the planner grid: changed / new rows and deleted ids; the whole schedule is then worked out again.
export function saveSchedule(projectId, body, user) {
  mayEdit(user);
  getRow('projects', projectId);
  const pid = Number(projectId);
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const deleted = (Array.isArray(body?.deleted) ? body.deleted : []).map(Number).filter(Boolean);
  tx(() => {
    for (const id of deleted) {
      const r = db.prepare('SELECT * FROM schedule_activities WHERE id = ? AND project_id = ?').get(id, pid);
      if (!r) continue;
      if (r.actual_start) throw new HttpError(409, `${r.sr}. ${r.name} has started (actual start ${r.actual_start}): it cannot be deleted – mark it Done or put it on hold`);
      db.prepare('DELETE FROM schedule_activities WHERE id = ?').run(id);
      audit(user.name, 'schedule_activities', id, 'delete', `${r.sr}. ${r.name}`);
    }
    for (const x of rows) {
      const data = Object.fromEntries(EDITABLE.filter(k => k in x).map(k => [k, x[k] === '' ? null : x[k]]));
      if (data.actual_finish && !(data.actual_start ?? (x.id && db.prepare('SELECT actual_start FROM schedule_activities WHERE id = ?').get(Number(x.id))?.actual_start))) data.actual_start = data.actual_finish;
      if (x.id) {
        const cur = db.prepare('SELECT project_id FROM schedule_activities WHERE id = ?').get(Number(x.id));
        if (!cur || cur.project_id !== pid) throw new HttpError(404, 'Activity not found in this project');
        updateRow('schedule_activities', x.id, data, user);
      } else insertRow('schedule_activities', { ...data, project_id: pid }, user);
    }
    const srs = db.prepare('SELECT sr, COUNT(*) n FROM schedule_activities WHERE project_id = ? GROUP BY sr HAVING n > 1').all(pid);
    if (srs.length) throw new HttpError(400, `Sr. No. used twice: ${srs.map(r => r.sr).join(', ')} – each row needs its own number`);
    const loop = compute(pid, { save: false }).problems.find(p => /^Loop/.test(p));
    if (loop) throw new HttpError(400, `${loop}. Change one of these "After" links.`);
  });
  return plannerData(pid, user);
}

// Fill an empty schedule from a standard template, starting on the given date.
export function applyTemplate(projectId, body, user) {
  mayEdit(user);
  const rows = templateRows(body?.template);
  if (!rows) throw new HttpError(400, 'Choose a template');
  const pid = Number(projectId);
  const count = db.prepare('SELECT COUNT(*) n FROM schedule_activities WHERE project_id = ?').get(pid).n;
  if (count && !body.replace) throw new HttpError(409, 'This project already has a schedule');
  if (count && hasBaseline(pid)) throw new HttpError(409, 'The schedule has an approved baseline: change activities instead of replacing it');
  if (count && db.prepare('SELECT 1 FROM schedule_activities WHERE project_id = ? AND actual_start IS NOT NULL').get(pid)) throw new HttpError(409, 'Work has started on this schedule: it cannot be replaced');
  tx(() => {
    if (count) db.prepare('DELETE FROM schedule_activities WHERE project_id = ?').run(pid);
    if (body.start) updateRow('projects', pid, { start_date: body.start }, user, { system: true });
    for (const r of rows) insertRow('schedule_activities', { ...r, project_id: pid }, user, { system: true });
    audit(user.name, 'projects', pid, 'schedule from template', TEMPLATES[body.template].label);
  });
  return plannerData(pid, user);
}

// Freeze today's plan as the next baseline (R0, R1 …) and send it to the Projects head.
export function requestBaseline(projectId, body, user) {
  mayEdit(user);
  const pid = Number(projectId);
  const { rows, problems, summary } = compute(pid);
  const acts = rows.filter(r => r.kind !== 'Phase');
  if (!acts.length) throw new HttpError(400, 'Add the activities first');
  if (problems.length) throw new HttpError(400, `Fix the schedule first: ${problems.slice(0, 3).join('; ')}`);
  if (db.prepare("SELECT 1 FROM schedule_baselines WHERE project_id = ? AND status = 'Pending Approval'").get(pid)) throw new HttpError(409, 'A baseline of this project is already waiting for approval');
  const n = db.prepare("SELECT COUNT(*) n FROM schedule_baselines WHERE project_id = ? AND status IN ('Approved', 'Superseded')").get(pid).n;
  const reason = String(body?.reason || '').trim();
  if (n && !reason) throw new HttpError(400, 'Say why the schedule is re-baselined (e.g. client delay in drawing approval, scope change)');
  return tx(() => {
    const b = insertRow('schedule_baselines', { project_id: pid, rev: `R${n}`, reason: reason || 'First baseline', start: summary.start, finish: summary.finish, activities: acts.length,
      requested_by: user.name, status: 'Draft', snapshot: acts.map(r => ({ sr: r.sr, name: r.name, start: r.plan_start, finish: r.plan_finish })) }, user, { system: true });
    submitForApproval('Schedule Baseline', b.id, user);
    return getRow('schedule_baselines', b.id);
  });
}

// Approved → its dates become every activity's baseline; the earlier approved baseline is kept as Superseded.
export function applyBaseline(id, user) {
  const b = db.prepare('SELECT * FROM schedule_baselines WHERE id = ?').get(Number(id));
  if (!b || b.status !== 'Approved' || b.applied_at) return;
  let snap = [];
  try { snap = JSON.parse(b.snapshot || '[]'); } catch { /* empty */ }
  const by = new Map(snap.map(s => [Number(s.sr), s]));
  const up = db.prepare('UPDATE schedule_activities SET base_start = ?, base_finish = ? WHERE id = ?');
  for (const r of db.prepare("SELECT id, sr, kind FROM schedule_activities WHERE project_id = ? AND kind <> 'Phase'").all(b.project_id)) {
    const s = by.get(Number(r.sr));
    up.run(s?.start || null, s?.finish || null, r.id);
  }
  db.prepare("UPDATE schedule_baselines SET status = 'Superseded' WHERE project_id = ? AND status = 'Approved' AND id <> ?").run(b.project_id, b.id);
  db.prepare('UPDATE schedule_baselines SET applied_at = ? WHERE id = ?').run(now(), b.id);
  const p = db.prepare('SELECT target_date FROM projects WHERE id = ?').get(b.project_id);
  if (p && !p.target_date) db.prepare('UPDATE projects SET target_date = ? WHERE id = ?').run(b.finish, b.project_id);
  audit(user?.name, 'schedule_baselines', b.id, 'baseline applied', `${b.rev} – finish ${b.finish}`);
}

export const scheduleFields = () => ENTITIES.schedule_activities.fields;

// ---------------------------------------------------------------- all projects at a glance
// Every open project: its schedule summary (progress, forecast vs baseline, late, critical), what is being worked on
// now, the next milestone and the next dispatch. Projects without a schedule are listed too, to start one.
export function portfolio(user) {
  mayView(user);
  const t = today();
  const projects = db.prepare("SELECT id FROM projects WHERE COALESCE(status, 'Active') NOT IN ('Completed', 'Cancelled') ORDER BY id").all();
  const nextDispatch = db.prepare("SELECT plan_no, planned_date, title, status FROM dispatch_plans WHERE project_id = ? AND status IN ('Planned', 'Material ready') ORDER BY planned_date LIMIT 1");
  const out = projects.map(({ id }) => {
    const p = getRow('projects', id);
    const base = { id, no: p.project_no || p.code, name: p.name, customer: p.customer_id_label || null, site: p.site || null, engineer: p.engineer || null, status: p.status,
      target: p.target_date || null, next_dispatch: nextDispatch.get(id) || null };
    const n = db.prepare('SELECT COUNT(*) n FROM schedule_activities WHERE project_id = ?').get(id).n;
    if (!n) return { ...base, has_schedule: false };
    const c = compute(id, { save: false });
    const acts = c.rows.filter(r => r.kind !== 'Phase');
    const open = acts.filter(r => r.status !== 'Done');
    const now = open.filter(r => r.status === 'In progress' || (r.plan_start <= t && r.plan_finish >= t)).slice(0, 3).map(r => ({ sr: r.sr, name: r.name, party: r.party, late: r.late_days || 0 }));
    const ms = open.filter(r => r.kind === 'Milestone').sort((a, b) => String(a.plan_finish).localeCompare(String(b.plan_finish)))[0];
    const late = open.filter(r => r.late_days > 0 || r.overdue === 'Yes').sort((a, b) => (b.late_days || 0) - (a.late_days || 0)).slice(0, 3).map(r => ({ sr: r.sr, name: r.name, days: r.late_days || 0, overdue: r.overdue === 'Yes' }));
    const phases = c.rows.filter(r => r.kind === 'Phase').map(r => ({ name: r.name, progress: r.progress, status: r.status, start: r.plan_start, finish: r.plan_finish }));
    return { ...base, has_schedule: true, summary: c.summary, problems: c.problems.length, now, late, phases,
      next_milestone: ms ? { name: ms.name, date: ms.plan_finish, base: ms.base_finish || null } : null };
  });
  return { today: t, projects: out };
}
