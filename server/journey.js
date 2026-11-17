// The order journey (public/js/journey.js): one per order, from the enquiry to the OT handover. A journey links the
// order's enquiry, sales order and project, whichever exist. Steps are ticked by hand (who, when, a note), or by
// themselves when the CRM already records the fact (an approved quotation, a project, a vendor PO …).
import { db, tx, audit } from './db.js';
import { HttpError, insertRow, updateRow, getRow } from './crud.js';
import { canView, canWrite, hasFunction } from '../public/js/schema.js';
import { STEPS, STEP, TICKABLE, PHASES, RACI } from '../public/js/journey.js';

export function migrateJourneys() {
  db.exec(`CREATE TABLE IF NOT EXISTS journeys (id INTEGER PRIMARY KEY, enquiry_id INTEGER, sales_order_id INTEGER, project_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS journey_steps (journey_id INTEGER NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, note TEXT, by_name TEXT,
      at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (journey_id, step));`);
  // a step ticked by its task (so reopening the task reopens the step)
  if (!db.prepare('PRAGMA table_info(journey_steps)').all().some(c => c.name === 'task_id')) db.exec('ALTER TABLE journey_steps ADD COLUMN task_id INTEGER');
}

const LINKS = ['enquiries', 'sales_orders', 'projects'];
const canSee = role => LINKS.some(e => canView(e, role));
const canEdit = role => role === 'admin' || LINKS.some(e => canWrite(e, role));
const one = (sql, ...a) => db.prepare(sql).get(...a);
const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const addDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };

// Every enquiry, sales order and project belongs to a journey: an order's journey is its enquiry's, a project's is its
// sales order's; what has neither starts a journey of its own.
export function ensureJourneys() {
  tx(() => {
    const ins = db.prepare('INSERT INTO journeys (enquiry_id, sales_order_id, project_id) VALUES (?, ?, ?)');
    for (const e of db.prepare('SELECT id FROM enquiries WHERE id NOT IN (SELECT enquiry_id FROM journeys WHERE enquiry_id IS NOT NULL)').all()) ins.run(e.id, null, null);
    for (const so of db.prepare('SELECT id, enquiry_id FROM sales_orders WHERE id NOT IN (SELECT sales_order_id FROM journeys WHERE sales_order_id IS NOT NULL)').all()) {
      const j = so.enquiry_id && one('SELECT id FROM journeys WHERE enquiry_id = ? AND sales_order_id IS NULL', so.enquiry_id);
      if (j) db.prepare('UPDATE journeys SET sales_order_id = ? WHERE id = ?').run(so.id, j.id); else ins.run(null, so.id, null);
    }
    for (const p of db.prepare('SELECT id, sales_order_id FROM projects WHERE id NOT IN (SELECT project_id FROM journeys WHERE project_id IS NOT NULL)').all()) {
      const j = p.sales_order_id && one('SELECT id FROM journeys WHERE sales_order_id = ? AND project_id IS NULL', p.sales_order_id);
      if (j) db.prepare('UPDATE journeys SET project_id = ? WHERE id = ?').run(p.id, j.id); else ins.run(null, null, p.id);
    }
  });
}

// What the CRM already records, for the steps that tick by themselves: { date, text, href } or null
const AUTO = {
  enquiry: j => { const e = j.enquiry; return e ? { date: e.date, text: `Enquiry ${e.enquiry_no || e.id}`, href: `#/view/enquiries/${e.id}` } : null; },
  costing: j => { const c = j.enquiry && one('SELECT id, cs_no, date FROM costing_sheets WHERE enquiry_id = ? ORDER BY id LIMIT 1', j.enquiry.id); return c ? { date: c.date, text: `Costing ${c.cs_no || c.id}`, href: `#/view/costing_sheets/${c.id}` } : null; },
  quotation: j => { const q = j.enquiry && one("SELECT id, quote_no, date, status FROM quotations WHERE enquiry_id = ? AND status IN ('Approved','Sent','Won') ORDER BY id DESC LIMIT 1", j.enquiry.id); return q ? { date: q.date, text: `Quotation ${q.quote_no || q.id} (${q.status})`, href: `#/view/quotations/${q.id}` } : null; },
  order: j => (j.order ? { date: j.order.client_po_date || j.order.date, text: `Sales order ${j.order.so_no || j.order.id}${j.order.client_po_no ? `, client PO ${j.order.client_po_no}` : ''}`, href: `#/view/sales_orders/${j.order.id}` }
    : j.project ? { date: j.project.work_order_date || j.project.start_date, text: `Project ${j.project.project_no || j.project.name} (order received)`, href: `#/view/projects/${j.project.id}` } : null),
  drawings: j => { const m = j.project && one("SELECT id, submittal_no, submitted_date FROM material_approvals WHERE project_id = ? AND category = 'Drawing' ORDER BY id LIMIT 1", j.project.id); return m ? { date: m.submitted_date, text: `Drawing submittal ${m.submittal_no || m.id}`, href: `#/view/material_approvals/${m.id}` } : null; },
  drawingsApproved: j => { const m = j.project && one("SELECT id, submittal_no, approval_date FROM material_approvals WHERE project_id = ? AND category = 'Drawing' AND status IN ('Approved','Approved with Comments') ORDER BY id DESC LIMIT 1", j.project.id); return m ? { date: m.approval_date, text: `Drawings ${m.submittal_no || m.id} approved by the client`, href: `#/view/material_approvals/${m.id}` } : null; },
  gantt: j => { const n = j.project && one('SELECT COUNT(*) n FROM schedule_activities WHERE project_id = ?', j.project.id).n; return n ? { text: `Gantt: ${n} activities in the planner`, href: `#/planner/${j.project.id}` } : null; },
  project: j => (j.project ? { date: j.project.work_order_date, text: `Project ${j.project.project_no || ''} ${j.project.name || ''}`.trim(), href: `#/view/projects/${j.project.id}` } : null),
  boq: j => { const b = j.project && one('SELECT id, boq_no, date FROM boqs WHERE project_id = ? ORDER BY id LIMIT 1', j.project.id); return b ? { date: b.date, text: `BOQ ${b.boq_no || b.id}`, href: `#/view/boqs/${b.id}` } : null; },
  production: j => { const p = j.project && one('SELECT id, order_no, date FROM production_orders WHERE project_id = ? ORDER BY id LIMIT 1', j.project.id); return p ? { date: p.date, text: `Production order ${p.order_no || p.id}`, href: `#/view/production_orders/${p.id}` } : null; },
  po: j => { const p = j.project && one("SELECT id, po_no, date, (SELECT COUNT(*) FROM purchase_orders WHERE project_id = ?) n FROM purchase_orders WHERE project_id = ? ORDER BY id LIMIT 1", j.project.id, j.project.id); return p ? { date: p.date, text: `${p.n} vendor PO${p.n === 1 ? '' : 's'}, first ${p.po_no || p.id}`, href: `#/view/purchase_orders/${p.id}` } : null; },
  dispatch: j => { const c = j.project && one("SELECT id, challan_no, date FROM challans WHERE project_id = ? AND status IN ('Dispatched','Delivered') ORDER BY id LIMIT 1", j.project.id); return c ? { date: c.date, text: `Dispatched: challan ${c.challan_no || c.id}`, href: `#/view/challans/${c.id}` } : null; },
  handover: j => (j.project && (j.project.status === 'Completed' || j.project.completion_date) ? { date: j.project.completion_date, text: 'Project completed', href: `#/view/projects/${j.project.id}` } : null),
  invoice: j => { const i = (j.project || j.order) && one('SELECT id, invoice_no, date FROM invoices WHERE (project_id = ? OR sales_order_id = ?) ORDER BY id LIMIT 1', j.project?.id ?? -1, j.order?.id ?? -1); return i ? { date: i.date, text: `Invoice ${i.invoice_no || i.id}`, href: `#/view/invoices/${i.id}` } : null; },
};

function load(id) {
  const j = one('SELECT * FROM journeys WHERE id = ?', id);
  if (!j) throw new HttpError(404, 'Journey not found');
  j.enquiry = j.enquiry_id ? one('SELECT * FROM enquiries WHERE id = ?', j.enquiry_id) : null;
  j.order = j.sales_order_id ? one('SELECT * FROM sales_orders WHERE id = ?', j.sales_order_id) : null;
  j.project = j.project_id ? one('SELECT * FROM projects WHERE id = ?', j.project_id) : null;
  return j;
}
const titleOf = j => j.project?.name || j.enquiry?.hospital_name || j.enquiry?.client_name || (j.enquiry && `Enquiry ${j.enquiry.enquiry_no || j.enquiry.id}${j.enquiry.place ? ` · ${j.enquiry.place}` : ''}`) || (j.order && `Sales order ${j.order.so_no || j.order.id}`) || `Journey ${j.id}`;
const refsOf = j => [j.enquiry && (j.enquiry.enquiry_no || `Enquiry ${j.enquiry.id}`), j.order && (j.order.so_no || `SO ${j.order.id}`), j.project && (j.project.project_no || j.project.code)].filter(Boolean);

// every step with its state: done / na / open, by hand or by itself, with its date and due date
function work(j) {
  const stored = Object.fromEntries(db.prepare('SELECT * FROM journey_steps WHERE journey_id = ?').all(j.id).map(r => [r.step, r]));
  const tasks = stepTasks(j.id);
  const part = (key, auto) => {
    const s = stored[key], task = tasks[key] || null;
    if (s) return { status: s.status, note: s.note, by: s.by_name, at: s.at, date: s.at?.slice(0, 10), task };
    const fact = auto && AUTO[auto]?.(j);
    if (fact) return { status: 'done', auto: true, date: fact.date || null, fact, task };
    // an open step given to someone: its deadline is the task's
    return task ? { status: 'open', task, due: task.due_date, late: !!task.due_date && task.due_date < today() } : { status: 'open' };
  };
  const out = {};
  for (const st of STEPS) {
    if (st.subs) {
      const subs = st.subs.map(x => ({ key: x.key, title: x.title, who: x.who, ...part(x.key, x.auto) }));
      const finished = subs.every(x => x.status !== 'open');
      out[st.key] = { status: finished ? (subs.some(x => x.status === 'done') ? 'done' : 'na') : 'open', subs, left: subs.filter(x => x.status === 'open').length };
    } else if (st.derived) out[st.key] = { status: out[st.derived].status, derived: true };
    else out[st.key] = part(st.key, st.auto);
  }
  for (const st of STEPS) if (st.due && out[st.key].status === 'open' && !out[st.key].task) {
    const from = out[st.due.after];
    if (from?.status === 'done' && from.date) { out[st.key].due = addDays(from.date, st.due.days); out[st.key].late = out[st.key].due < today(); }
  }
  const finished = STEPS.filter(s => out[s.key].status !== 'open').length;
  // where the order stands: the step after the furthest one reached; open steps before it were not recorded (an order
  // that came into the CRM part-way, or a step skipped) and do not hold it back
  let last = -1; STEPS.forEach((s, i) => { if (out[s.key].status === 'done') last = i; });
  const next = STEPS.find((s, i) => i > last && out[s.key].status === 'open');
  const gaps = STEPS.filter((s, i) => i < last && out[s.key].status === 'open').map(s => s.key);
  for (const k of gaps) out[k].gap = true;
  const isLate = x => x.late || x.subs?.some(p => p.late);
  return { steps: out, finished, total: STEPS.length, next: next?.key || null, phase: next ? next.phase : PHASES.length, gaps: gaps.length, late: STEPS.some(s => isLate(out[s.key])) };
}

// every role with its label and the people who have it now, for the who-does-what of each step
const roleMap = () => {
  const out = Object.fromEntries(db.prepare('SELECT name, label FROM roles').all().map(r => [r.name, { label: r.label, people: [] }]));
  for (const u of db.prepare('SELECT name, role FROM users WHERE active = 1 ORDER BY name').all()) out[u.role]?.people.push(u.name);
  out.client = { label: 'Client', people: [], outside: true }; out.vendor = { label: 'Vendor', people: [], outside: true };
  return out;
};

const summary = j => { const w = work(j); return { id: j.id, title: titleOf(j), refs: refsOf(j), enquiry_id: j.enquiry_id, sales_order_id: j.sales_order_id, project_id: j.project_id,
  finished: w.finished, total: w.total, phase: w.phase, next: w.next, gaps: w.gaps, next_title: w.next ? STEP[w.next].title : 'Handed over', late: w.late,
  done: w.finished === w.total, status: j.project?.status || j.order?.status || j.enquiry?.status || '' }; };

export function list(user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  ensureJourneys();
  return { journeys: db.prepare('SELECT id FROM journeys ORDER BY id DESC').all().map(r => summary(load(r.id))), can_edit: canEdit(user.role), can_assign: canAssign(user), roles: roleMap() };
}

export function view(id, user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  const j = load(id); closeAutoTasks(j, user);
  const w = work(j);
  const lab = (e, row, f) => (row ? { id: row.id, label: f(row) } : null);
  return { ...summary(j), ...w, can_edit: canEdit(user.role), can_assign: canAssign(user), me: user.name, people: canAssign(user) ? people() : [], roles: roleMap(),
    links: { enquiry: lab('enquiries', j.enquiry, e => `${e.enquiry_no || e.id} · ${e.hospital_name || e.client_name || ''}`), order: lab('sales_orders', j.order, o => `${o.so_no || o.id}${o.client_po_no ? ` · PO ${o.client_po_no}` : ''}`),
      project: lab('projects', j.project, p => `${p.project_no || p.code || p.id} · ${p.name || ''}`) } };
}

// tick a step (or a part of one): done, not needed, or back to open (a step the CRM ticked by itself cannot be reopened)
export function setStep(id, key, body, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  if (!TICKABLE.has(key)) throw new HttpError(400, 'Unknown step');
  const status = String(body?.status || ''), note = String(body?.note || '').trim().slice(0, 500) || null;
  if (!['done', 'na', 'open'].includes(status)) throw new HttpError(400, 'Choose done, not needed or open');
  load(id);
  tx(() => {
    if (status === 'open') db.prepare('DELETE FROM journey_steps WHERE journey_id = ? AND step = ?').run(id, key);
    else db.prepare(`INSERT INTO journey_steps (journey_id, step, status, note, by_name, at, task_id) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), NULL)
      ON CONFLICT (journey_id, step) DO UPDATE SET status = excluded.status, note = excluded.note, by_name = excluded.by_name, at = excluded.at, task_id = NULL`).run(id, key, status, note, user.name);
    // the step's task follows: done, cancelled (not needed) or open again
    const t = one("SELECT id, status FROM work_tasks WHERE journey_id = ? AND journey_step = ? ORDER BY id DESC LIMIT 1", id, key);
    const want = status === 'done' ? 'Done' : status === 'na' ? 'Cancelled' : t && ['Done', 'Cancelled'].includes(t.status) ? 'To do' : null;
    if (t && want && t.status !== want) updateRow('work_tasks', t.id, { status: want, ...(note ? { progress_note: note } : {}) }, user, { system: true });
  });
  audit(user.name, 'journeys', Number(id), 'update', `${key}: ${status}${note ? ` (${note})` : ''}`);
  return view(id, user);
}

// ---------------------------------------------------------------- steps as tasks (stage 2)
// A step is given to a person as a task in the Task Scheduler, with a deadline: it shows in their My tasks, they get a
// pop-up, and when they mark it Done the step ticks itself (and the other way round).
const canAssign = user => user.role === 'admin' || hasFunction(user.role, 'task_assign');
const people = () => db.prepare('SELECT u.name, u.role, r.label FROM users u LEFT JOIN roles r ON r.name = u.role WHERE u.active = 1 ORDER BY u.name').all()
  .map(u => ({ name: u.name, role: u.role, label: u.label || u.role }));
const stepTasks = jid => {
  const out = {};
  for (const t of db.prepare("SELECT id, task_no, assigned_to, assigned_by, due_date, status, priority, journey_step FROM work_tasks WHERE journey_id = ? AND status <> 'Cancelled' ORDER BY id").all(jid)) out[t.journey_step] = t;
  return out;
};
const flatSteps = x => { const flat = {}; for (const [k, v] of Object.entries(x)) { flat[k] = v; for (const p of v.subs || []) flat[p.key] = p; } return flat; };
const stepTitle = key => { for (const s of STEPS) { if (s.key === key) return s.title; const p = s.subs?.find(x => x.key === key); if (p) return `${s.title}: ${p.title}`; } return key; };
const stepNo = key => { const s = STEPS.find(x => x.key === key || x.subs?.some(p => p.key === key)); return s ? Number(s.key.slice(1)) : ''; };

export function giveStep(id, key, body, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  if (!TICKABLE.has(key)) throw new HttpError(400, 'Unknown step');
  const j = load(id);
  const to = String(body?.assigned_to || '').trim();
  const due = String(body?.due_date || '').slice(0, 10);
  if (!to) throw new HttpError(400, 'Choose who does it');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new HttpError(400, 'Choose the deadline');
  if (!one('SELECT 1 FROM users WHERE active = 1 AND lower(name) = lower(?)', to)) throw new HttpError(400, `${to} has no active login`);
  if (!canAssign(user) && to.toLowerCase() !== String(user.name).toLowerCase()) throw new HttpError(403, 'You can give a step to yourself only: ask your head to give it to someone else');
  if (flatSteps(work(j).steps)[key]?.status !== 'open') throw new HttpError(409, 'This step is already finished');
  const priority = ['Normal', 'High', 'Urgent', 'Low'].includes(body?.priority) ? body.priority : 'Normal';
  const note = String(body?.note || '').trim().slice(0, 1000);
  const old = one("SELECT * FROM work_tasks WHERE journey_id = ? AND journey_step = ? AND status NOT IN ('Done', 'Cancelled') ORDER BY id DESC LIMIT 1", id, key);
  if (old) {
    updateRow('work_tasks', old.id, { assigned_to: to, due_date: due, priority, ...(note ? { description: `${old.description || ''}\n${note}`.trim() } : {}) }, user);
  } else {
    const r = RACI[key] || {};
    const title = `${titleOf(j)}: ${stepNo(key)}. ${stepTitle(key)}`;
    insertRow('work_tasks', { title: title.slice(0, 200), assigned_to: to, priority, category: category(key), start_date: today(), due_date: due, status: 'To do',
      project_id: j.project_id || null, customer_id: j.project?.customer_id || j.order?.customer_id || null, journey_id: j.id, journey_step: key,
      description: [note, r.doc ? `Must be in the CRM: ${r.doc}` : null, r.a?.length ? `Approved by: ${r.a.map(roleLabel).join(' › ')}` : null, `Order journey: #/journey/${j.id}`].filter(Boolean).join('\n'),
      checklist: r.doc ? [{ item: r.doc, done: '' }] : [] }, user, { system: true });
  }
  audit(user.name, 'journeys', Number(id), 'update', `${key}: given to ${to}, due ${due}`);
  return view(id, user);
}
const roleLabel = r => one('SELECT label FROM roles WHERE name = ?', r)?.label || (r === 'client' ? 'Client' : r === 'vendor' ? 'Vendor' : r);
const category = key => { const s = STEPS.find(x => x.key === key || x.subs?.some(p => p.key === key)); const r = RACI[key]?.r?.[0] || '';
  return s?.kind === 'site' ? 'Site work' : /purchase|store/.test(r) ? 'Purchase' : /accounts|finance/.test(r) ? 'Accounts' : /design/.test(r) ? 'Design / R&D' : /production/.test(r) ? 'Production' : /sales/.test(r) ? 'Sales follow-up' : 'Office'; };

// after any save of a task: a journey task marked Done ticks its step; reopened, it opens the step it ticked
export function taskSaved(taskId, user) {
  const t = db.prepare('SELECT id, task_no, journey_id, journey_step, status, progress_note, completed_by, assigned_to FROM work_tasks WHERE id = ?').get(taskId);
  if (!t?.journey_id || !t.journey_step || !one('SELECT 1 FROM journeys WHERE id = ?', t.journey_id)) return;
  const s = one('SELECT * FROM journey_steps WHERE journey_id = ? AND step = ?', t.journey_id, t.journey_step);
  if (t.status === 'Done' && !s) {
    db.prepare("INSERT INTO journey_steps (journey_id, step, status, note, by_name, at, task_id) VALUES (?, ?, 'done', ?, ?, datetime('now','localtime'), ?)")
      .run(t.journey_id, t.journey_step, [`Task ${t.task_no}`, t.progress_note].filter(Boolean).join(': ').slice(0, 500), t.completed_by || user?.name || t.assigned_to, t.id);
    audit(user?.name, 'journeys', t.journey_id, 'update', `${t.journey_step}: done (task ${t.task_no})`);
  } else if (t.status !== 'Done' && s?.task_id === t.id) {
    db.prepare('DELETE FROM journey_steps WHERE journey_id = ? AND step = ?').run(t.journey_id, t.journey_step);
    audit(user?.name, 'journeys', t.journey_id, 'update', `${t.journey_step}: open again (task ${t.task_no} reopened)`);
  }
}

// a step the CRM ticked by itself (an approved quotation, a PO …) closes its task
function closeAutoTasks(j, user) {
  const open = db.prepare("SELECT id, journey_step FROM work_tasks WHERE journey_id = ? AND status NOT IN ('Done', 'Cancelled')").all(j.id);
  if (!open.length) return;
  const flat = flatSteps(work(j).steps);
  for (const t of open) if (flat[t.journey_step]?.auto) updateRow('work_tasks', t.id, { status: 'Done', progress_note: `The CRM records it: ${flat[t.journey_step].fact?.text || ''}` }, { name: 'system', role: 'admin' }, { system: true });
}

// the team: everyone's open tasks (journey steps first), late and due this week, and the next steps nobody has yet
export function team(user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  if (!canAssign(user)) throw new HttpError(403, 'Only people who give tasks see the team view');
  ensureJourneys();
  const soon = (() => { const x = new Date(); x.setDate(x.getDate() + 7); return x.toLocaleString('sv-SE').slice(0, 10); })();
  const rows = db.prepare("SELECT t.id, t.task_no, t.title, t.assigned_to, t.assigned_by, t.due_date, t.status, t.priority, t.journey_id, t.journey_step FROM work_tasks t WHERE t.status NOT IN ('Done', 'Cancelled') ORDER BY t.due_date, t.id").all();
  const byPerson = new Map();
  for (const u of people()) byPerson.set(u.name.toLowerCase(), { name: u.name, role: u.label, tasks: [] });
  for (const t of rows) {
    const k = String(t.assigned_to || '').trim().toLowerCase(); if (!byPerson.has(k)) byPerson.set(k, { name: t.assigned_to || '—', role: 'no active login', tasks: [] });
    byPerson.get(k).tasks.push({ ...t, late: !!t.due_date && t.due_date < today(), soon: !!t.due_date && t.due_date <= soon });
  }
  const team = [...byPerson.values()].filter(p => p.tasks.length).map(p => ({ ...p, late: p.tasks.filter(t => t.late).length, week: p.tasks.filter(t => t.soon && !t.late).length,
    journey: p.tasks.filter(t => t.journey_id).length })).sort((a, b) => b.late - a.late || b.tasks.length - a.tasks.length);
  // the next step of every order that is not finished, when nobody has it as a task
  const waiting = [];
  for (const r of db.prepare('SELECT id FROM journeys ORDER BY id DESC').all()) {
    const j = load(r.id), w = work(j);
    if (!w.next) continue;
    const st = STEPS.find(s => s.key === w.next), x = w.steps[w.next];
    const parts = st.subs ? x.subs.filter(p => p.status === 'open' && !p.task).map(p => ({ key: p.key, title: `${st.title}: ${p.title}` })) : x.task || st.derived ? [] : [{ key: st.key, title: st.title }];
    for (const p of parts) waiting.push({ journey_id: j.id, order: titleOf(j), step: p.key, no: stepNo(p.key), title: p.title, does: (RACI[p.key]?.r || []).map(roleLabel) });
  }
  return { team, waiting, today: today(), people: people(), roles: roleMap(), can_edit: canEdit(user.role) };
}

// link the enquiry, sales order or project of this order; one that started a journey of its own on its own is merged in
export function setLinks(id, body, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  load(id);
  const cols = { enquiry_id: 'enquiries', sales_order_id: 'sales_orders', project_id: 'projects' };
  return tx(() => {
    for (const [col, table] of Object.entries(cols)) {
      if (!(col in (body || {}))) continue;
      const v = body[col] ? Number(body[col]) : null;
      if (v && !one(`SELECT 1 FROM ${table} WHERE id = ?`, v)) throw new HttpError(400, 'Record not found');
      if (v) {
        const other = one(`SELECT * FROM journeys WHERE ${col} = ? AND id <> ?`, v, id);
        if (other) {
          const linked = Object.keys(cols).filter(c => other[c]).length;
          if (linked > 1) throw new HttpError(409, `That record already belongs to another order's journey (${titleOf(load(other.id))}). Unlink it there first.`);
          db.prepare('INSERT OR IGNORE INTO journey_steps (journey_id, step, status, note, by_name, at) SELECT ?, step, status, note, by_name, at FROM journey_steps WHERE journey_id = ?').run(id, other.id);
          db.prepare('DELETE FROM journey_steps WHERE journey_id = ?').run(other.id);
          db.prepare('DELETE FROM journeys WHERE id = ?').run(other.id);
        }
      }
      db.prepare(`UPDATE journeys SET ${col} = ? WHERE id = ?`).run(v, id);
      audit(user.name, 'journeys', Number(id), 'update', `${col} = ${v ?? 'none'}`);
    }
    // a journey left with nothing linked is removed; what was unlinked gets its own again
    if (!['enquiry_id', 'sales_order_id', 'project_id'].some(c => one('SELECT * FROM journeys WHERE id = ?', id)[c])) {
      db.prepare('DELETE FROM journey_steps WHERE journey_id = ?').run(id); db.prepare('DELETE FROM journeys WHERE id = ?').run(id);
      ensureJourneys(); return { removed: true };
    }
    ensureJourneys();
    return view(id, user);
  });
}
