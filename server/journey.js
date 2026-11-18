// The order journey (public/js/journey.js): one per order, from the enquiry to the OT handover. A journey links the
// order's enquiry, sales order and project, whichever exist. Steps are ticked by hand (who, when, a note), or by
// themselves when the CRM already records the fact (an approved quotation, a project, a vendor PO …).
import { db, tx, audit } from './db.js';
import { HttpError, insertRow, updateRow, getRow } from './crud.js';
import { canView, canWrite, hasFunction } from '../public/js/schema.js';
import { STEPS, STEP, TICKABLE, PHASES, RACI, JOURNEY_DOC, approvalChain, docNeed } from '../public/js/journey.js';
import { saveAttachment, deleteAttachment } from './roles.js';
import { compute as computeSchedule, calendar } from './schedule.js';
import { templateRows } from './scheduletemplates.js';
import { notify, notifyDecision } from './notify.js';
import { storeReadiness } from './materials.js';
import { getSettings } from './db.js';

export function migrateJourneys() {
  db.exec(`CREATE TABLE IF NOT EXISTS journeys (id INTEGER PRIMARY KEY, enquiry_id INTEGER, sales_order_id INTEGER, project_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS journey_steps (journey_id INTEGER NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, note TEXT, by_name TEXT,
      at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (journey_id, step));`);
  // a step ticked by its task (so reopening the task reopens the step)
  if (!db.prepare('PRAGMA table_info(journey_steps)').all().some(c => c.name === 'task_id')) db.exec('ALTER TABLE journey_steps ADD COLUMN task_id INTEGER');
}

const LINKS = ['enquiries', 'sales_orders', 'projects'];
const canSee = role => hasFunction(role, 'screen_journey');
export const canSeeRole = canSee;
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
  const tasks = stepTasks(j.id), aps = stepApprovals(j.id), files = stepFiles(j.id), plan = siteRows(j);
  const part = (key, auto) => {
    const p = plan[key];
    const s = stored[key], task = tasks[key] || null, approval = approvalState(key, aps[key]), more = { task, approval, files: files[key] || [], need: docNeed(key),
      plan: p ? { start: p.plan_start, finish: p.plan_finish, crew: p.crew, crew_note: p.crew_note, critical: p.critical === 'Yes', status: p.status } : null };
    if (s) return { status: s.status, note: s.note, by: s.by_name, at: s.at, date: s.at?.slice(0, 10), ...more };
    const fact = auto && AUTO[auto]?.(j);
    if (fact) return { status: 'done', auto: true, date: fact.date || null, fact, ...more };
    // an open step given to someone: its deadline is the task's
    // an open step given to someone: its deadline is the task's; else the site plan's finish
    const due = task?.due_date || p?.plan_finish || null;
    return due ? { status: 'open', due, late: due < today(), ...more } : { status: 'open', ...more };
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
  const isLate = x => (x.late && !x.gap) || x.subs?.some(p => p.late && !(x.gap && !p.task)); // an old step nobody recorded is not "late"
  const waiting = Object.values(aps).filter(r => r.some(a => a.status === 'Pending')).length;
  return { steps: out, finished, total: STEPS.length, next: next?.key || null, phase: next ? next.phase : PHASES.length, gaps: gaps.length, late: STEPS.some(s => isLate(out[s.key])), waiting };
}

// every role with its label and the people who have it now, for the who-does-what of each step
const roleMap = () => {
  const out = Object.fromEntries(db.prepare('SELECT name, label FROM roles').all().map(r => [r.name, { label: r.label, people: [] }]));
  for (const u of db.prepare('SELECT name, role FROM users WHERE active = 1 ORDER BY name').all()) out[u.role]?.people.push(u.name);
  out.client = { label: 'Client', people: [], outside: true }; out.vendor = { label: 'Vendor', people: [], outside: true };
  return out;
};

const summary = j => { const w = work(j); return { id: j.id, title: titleOf(j), refs: refsOf(j), enquiry_id: j.enquiry_id, sales_order_id: j.sales_order_id, project_id: j.project_id,
  finished: w.finished, total: w.total, phase: w.phase, next: w.next, gaps: w.gaps, next_title: w.next ? STEP[w.next].title : 'Handed over', late: w.late, waiting: w.waiting,
  done: w.finished === w.total, status: j.project?.status || j.order?.status || j.enquiry?.status || '' }; };

export function list(user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  ensureJourneys();
  return { journeys: db.prepare('SELECT id FROM journeys ORDER BY id DESC').all().map(r => summary(load(r.id))), pilot: pilotId(), can_edit: canEdit(user.role), can_assign: canAssign(user), roles: roleMap() };
}

export function view(id, user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  const j = load(id); closeAutoTasks(j, user);
  const w = work(j);
  const lab = (e, row, f) => (row ? { id: row.id, label: f(row) } : null);
  return { ...summary(j), ...w, store_check: j.project_id ? storeReadiness(j.project_id) : null, site: sitePlan(j), can_plan: !!j.project_id && canWrite('schedule_activities', user.role), dispatch: dispatchDate(j, w), can_edit: canEdit(user.role), can_assign: canAssign(user), me: user.name, my_role: user.role, people: canAssign(user) ? people() : [], roles: roleMap(),
    links: { enquiry: lab('enquiries', j.enquiry, e => `${e.enquiry_no || e.id} · ${e.hospital_name || e.client_name || ''}`), order: lab('sales_orders', j.order, o => `${o.so_no || o.id}${o.client_po_no ? ` · PO ${o.client_po_no}` : ''}`),
      project: lab('projects', j.project, p => `${p.project_no || p.code || p.id} · ${p.name || ''}`) } };
}

// tick a step (or a part of one): done, not needed, or back to open (a step the CRM ticked by itself cannot be reopened)
export function setStep(id, key, body, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  if (!TICKABLE.has(key)) throw new HttpError(400, 'Unknown step');
  const status = String(body?.status || ''), note = String(body?.note || '').trim().slice(0, 500) || null;
  if (!['done', 'na', 'open'].includes(status)) throw new HttpError(400, 'Choose done, not needed or open');
  if (status === 'done' && approvalChain(key).length && user.role !== 'admin') throw new HttpError(409, 'This step is approved in the CRM: send it for approval');
  load(id);
  if (status === 'done' && user.role !== 'admin') needDoc(id, key, note);
  cancelPending(id, key, status === 'na' ? 'Step marked not needed' : status === 'open' ? 'Step reopened' : 'Ticked by hand', user);
  tx(() => {
    if (status === 'open') db.prepare('DELETE FROM journey_steps WHERE journey_id = ? AND step = ?').run(id, key);
    else db.prepare(`INSERT INTO journey_steps (journey_id, step, status, note, by_name, at, task_id) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), NULL)
      ON CONFLICT (journey_id, step) DO UPDATE SET status = excluded.status, note = excluded.note, by_name = excluded.by_name, at = excluded.at, task_id = NULL`).run(id, key, status, note, user.name);
    // the step's task follows: done, cancelled (not needed) or open again
    const t = one("SELECT id, status FROM work_tasks WHERE journey_id = ? AND journey_step = ? ORDER BY id DESC LIMIT 1", id, key);
    const want = status === 'done' ? 'Done' : status === 'na' ? 'Cancelled' : t && ['Done', 'Cancelled'].includes(t.status) ? 'To do' : null;
    if (t && want && t.status !== want) updateRow('work_tasks', t.id, { status: want, ...(note ? { progress_note: note } : {}) }, user, { system: true });
  });
  if (status === 'done') siteDone(load(id), key, user);
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
  if (t.status === 'Done' && !s && user?.name !== 'system' && user?.role !== 'admin') needDoc(t.journey_id, t.journey_step, t.progress_note, true);
  if (t.status === 'Done' && !s && approvalChain(t.journey_step).length) {
    if (!one("SELECT 1 FROM approvals WHERE doc_type = ? AND doc_id = ? AND journey_step = ? AND status = 'Pending'", JOURNEY_DOC, t.journey_id, t.journey_step))
      openApproval(load(t.journey_id), t.journey_step, 0, user, t.completed_by || t.assigned_to, [`Task ${t.task_no}`, t.progress_note].filter(Boolean).join(': '));
    return;
  }
  if (t.status === 'Done' && !s) {
    db.prepare("INSERT INTO journey_steps (journey_id, step, status, note, by_name, at, task_id) VALUES (?, ?, 'done', ?, ?, datetime('now','localtime'), ?)")
      .run(t.journey_id, t.journey_step, [`Task ${t.task_no}`, t.progress_note].filter(Boolean).join(': ').slice(0, 500), t.completed_by || user?.name || t.assigned_to, t.id);
    siteDone(load(t.journey_id), t.journey_step, user);
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

// ---------------------------------------------------------------- approvals of gates (stage 3)
// A gate is sent for approval (by hand, or when its task is marked Done); its approvers decide one after the other in
// the Approvals list (or on the journey); the last approval ticks the step. A rejection sends it back to the doer.
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const holders = roles => db.prepare(`SELECT name FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')})`).all(...roles).map(u => u.name);
const labels = csv => String(csv).split(',').map(roleLabel).join(' / ');
// the latest round of approvals of each step (a round starts with the first approver)
const stepApprovals = jid => {
  const out = {};
  for (const a of db.prepare('SELECT id, journey_step, approver_role, approval_seq, stage, status, decided_by, decided_at, requested_by, requested_at, comments FROM approvals WHERE doc_type = ? AND doc_id = ? ORDER BY id').all(JOURNEY_DOC, jid)) {
    if (!a.journey_step) continue;
    if (!a.approval_seq || !out[a.journey_step]) out[a.journey_step] = [];
    out[a.journey_step].push(a);
  }
  return out;
};
const approvalState = (key, rows) => {
  const chain = approvalChain(key); if (!chain.length) return null;
  const r = rows || [];
  return { chain: chain.map((roles, i) => ({ roles, label: labels(roles), row: r.find(a => a.approval_seq === i) || null })),
    pending: r.find(a => a.status === 'Pending') || null, rejected: r.find(a => a.status === 'Rejected' && !String(a.comments || '').startsWith('Withdrawn')) || null,
    approved: r.length > 0 && chain.every((_, i) => r.some(a => a.approval_seq === i && a.status === 'Approved')), requested_by: r[0]?.requested_by || null };
};

function openApproval(j, key, seq, user, requestedBy, note = '') {
  const roles = approvalChain(key)[seq];
  const ap = insertRow('approvals', { doc_type: JOURNEY_DOC, doc_id: j.id, doc_ref: `${titleOf(j)} · step ${stepNo(key)}`.slice(0, 200), stage: labels(roles),
    title: `${stepNo(key)}. ${stepTitle(key)}`, requested_by: requestedBy || user.name, requested_at: stamp(), status: 'Pending',
    journey_step: key, approver_role: roles, approval_seq: seq, comments: note || null }, user, { system: true });
  notify({ userNames: holders(roles.split(',')), kind: 'approval', title: `Approval needed: ${titleOf(j)}: ${stepTitle(key)}`,
    body: [`${labels(roles)}${approvalChain(key).length > 1 ? ` (${seq + 1} of ${approvalChain(key).length})` : ''}`, `requested by ${ap.requested_by}`, note].filter(Boolean).join(' · '), link: `#/view/approvals/${ap.id}` }, user);
  audit(user.name, 'journeys', j.id, 'update', `${key}: sent for approval (${labels(roles)})`);
  return ap;
}

// a pending approval of a step that was reopened or marked not needed is withdrawn
function cancelPending(jid, key, why, user) {
  for (const a of db.prepare("SELECT id FROM approvals WHERE doc_type = ? AND doc_id = ? AND journey_step = ? AND status = 'Pending'").all(JOURNEY_DOC, jid, key))
    updateRow('approvals', a.id, { status: 'Rejected', decided_by: user.name, decided_at: stamp(), comments: `Withdrawn: ${why}` }, user, { system: true });
}

export function submitStep(id, key, body, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  if (!TICKABLE.has(key) || !approvalChain(key).length) throw new HttpError(400, 'This step has no approval in the CRM');
  const j = load(id);
  if (flatSteps(work(j).steps)[key]?.status !== 'open') throw new HttpError(409, 'This step is already finished');
  if (one("SELECT 1 FROM approvals WHERE doc_type = ? AND doc_id = ? AND journey_step = ? AND status = 'Pending'", JOURNEY_DOC, id, key)) throw new HttpError(409, 'Already waiting for approval');
  needDoc(id, key, body?.note);
  tx(() => openApproval(j, key, 0, user, user.name, String(body?.note || '').trim().slice(0, 500)));
  return view(id, user);
}

// called by the approval engine (workflows.decide) after the approval row is saved
export function approvalDecided(ap, decision, comments, user) {
  const j = load(ap.doc_id), key = ap.journey_step, chain = approvalChain(key), seq = Number(ap.approval_seq) || 0;
  const task = one("SELECT id, status FROM work_tasks WHERE journey_id = ? AND journey_step = ? AND status <> 'Cancelled' ORDER BY id DESC LIMIT 1", j.id, key);
  if (decision === 'Rejected') {
    if (task?.status === 'Done') updateRow('work_tasks', task.id, { status: 'In progress', progress_note: `Rejected by ${user.name}${comments ? `: ${comments}` : ''}` }, user, { system: true });
    notifyDecision({ ...ap, comments }, decision, true, user);
    audit(user.name, 'journeys', j.id, 'update', `${key}: rejected by ${user.name}`);
    return;
  }
  if (seq + 1 < chain.length) { openApproval(j, key, seq + 1, user, ap.requested_by); notifyDecision({ ...ap, comments }, decision, false, user); return; }
  const by = db.prepare("SELECT decided_by, stage FROM approvals WHERE doc_type = ? AND doc_id = ? AND journey_step = ? AND status = 'Approved' AND id >= (SELECT MAX(id) FROM approvals WHERE doc_type = ? AND doc_id = ? AND journey_step = ? AND approval_seq = 0) ORDER BY id")
    .all(JOURNEY_DOC, j.id, key, JOURNEY_DOC, j.id, key).map(a => `${a.decided_by} (${a.stage})`);
  db.prepare(`INSERT INTO journey_steps (journey_id, step, status, note, by_name, at, task_id) VALUES (?, ?, 'done', ?, ?, datetime('now','localtime'), NULL)
    ON CONFLICT (journey_id, step) DO UPDATE SET status = 'done', note = excluded.note, by_name = excluded.by_name, at = excluded.at, task_id = NULL`).run(j.id, key, `Approved by ${by.join(', ')}`.slice(0, 500), ap.requested_by || user.name);
  if (task && task.status !== 'Done') updateRow('work_tasks', task.id, { status: 'Done', progress_note: `Approved by ${by.join(', ')}` }, user, { system: true });
  notifyDecision({ ...ap, comments }, decision, true, user);
  audit(user.name, 'journeys', j.id, 'update', `${key}: approved`);
}

// ---------------------------------------------------------------- the document of each step (stage 4)
const stepFiles = jid => {
  const out = {};
  for (const a of db.prepare("SELECT id, entity, filename, mime, size, note, uploaded_by, at FROM attachments WHERE entity LIKE 'journey:%' AND record_id = ? ORDER BY id").all(jid)) {
    const k = a.entity.slice(8); (out[k] ||= []).push({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, note: a.note, by: a.uploaded_by, at: a.at });
  }
  return out;
};
function needDoc(jid, key, note, fromTask = false) {
  const need = docNeed(key), what = RACI[key]?.doc || 'the document';
  const where = fromTask ? ' on the order journey' : '';
  if (need === 'note' && !String(note || '').trim()) throw new HttpError(409, fromTask ? `Write the result in the task's update first: ${what}` : `Write the note first: ${what}`);
  if (need === 'file' && !one("SELECT 1 FROM attachments WHERE entity = ? AND record_id = ?", `journey:${key}`, jid)) throw new HttpError(409, `Attach the document${where} first: ${what}`);
}
export function addFile(id, key, meta, buf, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  if (!TICKABLE.has(key)) throw new HttpError(400, 'Unknown step');
  load(id);
  const saved = saveAttachment(`journey:${key}`, id, meta, buf, user);
  audit(user.name, 'journeys', id, 'update', `${key}: file ${saved.filename}`);
  return saved;
}
export function removeFile(a, user) {
  if (!canEdit(user.role)) throw new HttpError(403, 'You cannot change the order journey');
  // once the step is done its documents stay (an admin may still remove one)
  const s = one('SELECT status FROM journey_steps WHERE journey_id = ? AND step = ?', a.record_id, a.entity.slice(8));
  if (s?.status === 'done' && user.role !== 'admin') throw new HttpError(409, 'The step is done: its documents stay. Undo the step first.');
  deleteAttachment(a.id, user, ['admin', 'manager', 'md'].includes(user.role));
}

// ---------------------------------------------------------------- site plan with crew (stage 5)
// The order's project gets the site plan of one modular OT (scheduletemplates.js OT_SITE) in the Project Planner,
// starting on the dispatch day; each site step of the journey then has its planned dates and crew, and the crew of
// every working day is added up (the manpower plan the site schedule review asks for).
const siteRows = j => {
  if (!j.project_id) return {};
  return Object.fromEntries(db.prepare('SELECT * FROM schedule_activities WHERE project_id = ? AND journey_step IS NOT NULL').all(j.project_id).map(r => [r.journey_step, r]));
};
const dispatchDate = (j, w) => { const x = w.steps.s25; return x?.date || null; };

function sitePlan(j) {
  const rows = Object.values(siteRows(j)).filter(r => r.plan_start).sort((a, b) => (a.sort ?? a.sr) - (b.sort ?? b.sr));
  if (!rows.length) return null;
  const cal = calendar({ sundays: true }); // site work runs every day
  const start = rows.reduce((m, r) => (r.plan_start < m ? r.plan_start : m), rows[0].plan_start);
  const end = rows.reduce((m, r) => ((r.plan_finish || r.plan_start) > m ? r.plan_finish || r.plan_start : m), start);
  const days = [];
  for (let d = cal.onOrAfter(start), n = 0; d <= end && n < 200; d = cal.add(d, 1), n++) {
    const on = rows.filter(r => r.kind !== 'Milestone' && r.plan_start <= d && (r.plan_finish || r.plan_start) >= d);
    const ours = on.filter(r => r.party === 'WIESPL');
    days.push({ date: d, people: ours.reduce((s, r) => s + (Number(r.crew) || 0), 0), unknown: ours.some(r => r.crew == null), vendor: on.some(r => r.party === 'Vendor'),
      client: on.some(r => r.party === 'Client'), work: on.map(r => r.name.split(/[,(:]/)[0].trim()) });
    if (d === end) break;
  }
  return { project_id: j.project_id, start, end, working_days: days.length, man_days: days.reduce((s, d) => s + d.people, 0), peak: Math.max(0, ...days.map(d => d.people)),
    unknown_days: days.filter(d => d.unknown).length, days };
}

export function makeSitePlan(id, body, user) {
  if (!canEdit(user.role) || !canWrite('schedule_activities', user.role)) throw new HttpError(403, 'You may not plan the site work');
  const j = load(id);
  if (!j.project_id) throw new HttpError(400, 'Link the project of this order first');
  if (Object.keys(siteRows(j)).length) throw new HttpError(409, 'This project already has its site plan: change it in the Project Planner');
  const start = String(body?.start || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new HttpError(400, 'Choose the dispatch day (site day 1)');
  const pid = j.project_id;
  const top = one('SELECT MAX(sr) sr, MAX(COALESCE(sort, sr)) so FROM schedule_activities WHERE project_id = ?', pid);
  const off = Number(top.sr) || 0, soff = Number(top.so) || 0;
  const shift = after => String(after || '').replace(/\d+/g, (n, i, s) => (s[i - 1] === '+' || s[i - 1] === '-' ? n : String(Number(n) + off)));
  tx(() => {
    // a project without a schedule or a start date starts on the dispatch day (else the plan could not begin before today)
    if (!off && !j.project.start_date) updateRow('projects', pid, { start_date: start }, user, { system: true });
    const rows = templateRows('ot_site');
    rows.forEach((r, i) => insertRow('schedule_activities', { ...r, project_id: pid, sr: r.sr + off, sort: r.sort + soff, after: shift(r.after),
      ...(i === 1 ? { fixed_start: start } : {}) }, user, { system: true }));
    computeSchedule(pid);
  });
  audit(user.name, 'journeys', id, 'update', `site plan from ${start}`);
  return view(id, user);
}

// a site step done on the journey: its activity in the planner is done
function siteDone(j, key, user) {
  const r = j.project_id && one("SELECT id, status FROM schedule_activities WHERE project_id = ? AND journey_step = ? AND COALESCE(status, '') <> 'Done'", j.project_id, key);
  if (!r) return;
  updateRow('schedule_activities', r.id, { status: 'Done', progress: 100, actual_finish: today() }, user, { system: true });
  try { computeSchedule(j.project_id); } catch { /* the planner shows its own problems */ }
}

// ---------------------------------------------------------------- alerts and dashboard (stage 6)
// Every open step that has a deadline (its task's, the site plan's, or the rule's), the next step of every order, and
// every approval waiting: who has it (the task's person, else the people in the step's "does" role), and whether it is
// late or due soon. The daily alert, My tasks and the dashboard all read this.
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export function openWork() {
  ensureJourneys();
  const t = today(), soon = addDays(t, 2), people = roleMap();
  const steps = [], approvals = [], orders = [];
  for (const { id } of db.prepare('SELECT id FROM journeys ORDER BY id').all()) {
    const j = load(id), w = work(j), flat = flatSteps(w.steps), title = titleOf(j);
    orders.push({ id, title, phase: w.phase, finished: w.finished, total: w.total, late: w.late, done: w.finished === w.total, next: w.next, waiting: w.waiting });
    const nextKeys = new Set();
    if (w.next) { const st = STEP[w.next]; for (const k of st.subs ? st.subs.map(p => p.key) : st.derived ? [] : [st.key]) if (flat[k]?.status === 'open') nextKeys.add(k); }
    for (const [key, x] of Object.entries(flat)) {
      if (!TICKABLE.has(key) || x.status !== 'open') continue;
      if (x.approval?.pending) { const p = x.approval.pending;
        approvals.push({ journey_id: id, order: title, key, no: stepNo(key), title: stepTitle(key), id: p.id, with: p.stage, since: p.requested_at, days: daysBetween(String(p.requested_at).slice(0, 10), t),
          who: holders(String(p.approver_role).split(',')) }); }
      // a step not recorded on an older order counts only once someone has it as a task
      if (x.gap && !x.task) continue;
      if (!x.due && !nextKeys.has(key)) continue;
      const roles = (RACI[key]?.r || []).filter(r => !['client', 'vendor'].includes(r));
      const who = x.task ? [x.task.assigned_to] : roles.flatMap(r => people[r]?.people || []);
      steps.push({ journey_id: id, order: title, key, no: stepNo(key), title: stepTitle(key), due: x.due || null, late: !!x.due && x.due < t, soon: !!x.due && x.due >= t && x.due <= soon,
        days_late: x.due && x.due < t ? daysBetween(x.due, t) : 0, next: nextKeys.has(key), task: x.task ? { id: x.task.id, no: x.task.task_no } : null,
        who, roles: roles.map(roleLabel), outside: !roles.length, waiting: !!x.approval?.pending });
    }
  }
  // an order is late when one of its steps that counts is late (not an old step nobody recorded)
  const lateIds = new Set(steps.filter(x => x.late).map(x => x.journey_id));
  for (const o of orders) o.late = lateIds.has(o.id);
  return { steps, approvals, orders, today: t };
}

// once a day (after 9): each person hears about their late and due steps, approvers about approvals waiting over two
// days, and the people who give tasks about late orders and next steps nobody has
export function dailyJourney() {
  const t = today(), s = getSettings();
  if (s.journey_alerts === t) return;
  const { steps, approvals, orders } = openWork();
  const per = new Map();
  const add = (name, line) => { if (!name) return; const k = String(name).trim(); (per.get(k) || per.set(k, []).get(k)).push(line); };
  for (const x of steps) {
    if (x.late) for (const n of x.who) add(n, `LATE ${x.days_late}d: ${x.order}: ${x.no}. ${x.title}`);
    else if (x.soon) for (const n of x.who) add(n, `Due ${x.due.split('-').reverse().join('-')}: ${x.order}: ${x.no}. ${x.title}`);
  }
  for (const a of approvals.filter(a => a.days >= 2)) for (const n of a.who) add(n, `Approve (waiting ${a.days} days): ${a.order}: ${a.no}. ${a.title}`);
  let sent = 0;
  for (const [name, lines] of per) {
    const late = lines.filter(l => l.startsWith('LATE')).length;
    sent += notify({ userNames: [name], kind: 'journey', title: late ? `Order journey: ${late} late step${late === 1 ? '' : 's'}${lines.length > late ? ` + ${lines.length - late} more` : ''}` : `Order journey: ${lines.length} thing${lines.length === 1 ? '' : 's'} due`,
      body: lines.slice(0, 12).join('\n') + (lines.length > 12 ? `\n+ ${lines.length - 12} more` : ''), link: '#/tasks' }, { name: 'system' });
  }
  const lateOrders = orders.filter(o => !o.done && o.late), nobody = steps.filter(x => x.next && !x.task && !x.outside);
  if (lateOrders.length || nobody.length) notify({ fn: 'task_assign', kind: 'journey', title: `Orders: ${lateOrders.length} late, ${nobody.length} next step${nobody.length === 1 ? '' : 's'} not given to anyone`,
    body: [...lateOrders.slice(0, 8).map(o => `Late: ${o.title}`), nobody.length ? `Give them out on the Team page.` : null].filter(Boolean).join('\n'), link: '#/journey/dashboard' }, { name: 'system' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('journey_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(t));
  return sent;
}

// My tasks: the journey steps waiting for this person that are not a task yet (tasks are in "Your tasks" already)
export function myJourneyItems(user) {
  if (!canSee(user.role)) return [];
  const me = String(user.name).toLowerCase();
  return openWork().steps.filter(x => !x.task && !x.waiting && x.who.some(n => String(n).toLowerCase() === me) && (x.late || x.soon || x.next))
    .sort((a, b) => b.days_late - a.days_late || String(a.due || '9').localeCompare(String(b.due || '9')))
    .map(x => ({ title: `${x.late ? '🔴 ' : ''}${x.order}: ${x.no}. ${x.title}`, sub: x.due ? `${x.late ? `late ${x.days_late} day${x.days_late === 1 ? '' : 's'}, ` : ''}due ${x.due.split('-').reverse().join('-')}` : 'next step of the order',
      link: `#/journey/${x.journey_id}`, due: x.due, late: x.late }));
}

export function dashboard(user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  const w = openWork(), live = w.orders.filter(o => !o.done);
  const byPerson = new Map();
  for (const x of w.steps.filter(x => x.late)) for (const n of x.who.length ? x.who : ['(nobody has the role)']) byPerson.set(n, (byPerson.get(n) || 0) + 1);
  return { today: w.today,
    kpi: { orders: live.length, late_orders: live.filter(o => o.late).length, late_steps: w.steps.filter(x => x.late).length, due_soon: w.steps.filter(x => x.soon).length,
      approvals: w.approvals.length, slow_approvals: w.approvals.filter(a => a.days >= 2).length, unassigned: w.steps.filter(x => x.next && !x.task && !x.outside).length, handed_over: w.orders.length - live.length },
    phases: PHASES.map(p => ({ no: p.no, title: p.title, colour: p.colour, orders: live.filter(o => o.phase === p.no).length })),
    late: w.steps.filter(x => x.late).sort((a, b) => b.days_late - a.days_late),
    week: w.steps.filter(x => !x.late && x.due && x.due <= addDays(w.today, 7)).sort((a, b) => a.due.localeCompare(b.due)),
    approvals: w.approvals.sort((a, b) => b.days - a.days),
    people: [...byPerson].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
}

// ---------------------------------------------------------------- pilot and rollout (stage 7)
// One real order runs through the journey first. The guide page shows the pilot checklist (worked out from the data)
// and, for each role, its steps and daily routine.
const pilotId = () => { const v = Number(getSettings().journey_pilot) || null; return v && one('SELECT 1 FROM journeys WHERE id = ?', v) ? v : null; };
export function guide(user) {
  if (!canSee(user.role)) throw new HttpError(403, 'You do not have access to the order journeys');
  ensureJourneys();
  const roles = roleMap(), pid = pilotId(), lead = canAssign(user);
  const used = [...new Set(Object.values(RACI).flatMap(x => [...x.r, ...x.a]))].filter(r => roles[r] && !roles[r].outside);
  const out = { roles, my_role: user.role, can_lead: lead, pilot: null, checks: null,
    orders: lead ? db.prepare('SELECT id FROM journeys ORDER BY id DESC').all().map(r => { const j = load(r.id); return { id: r.id, title: titleOf(j), refs: refsOf(j) }; }) : [] };
  if (pid) {
    const j = load(pid), w = work(j), flat = flatSteps(w.steps);
    const keys = [...TICKABLE].filter(k => flat[k]);
    out.pilot = { ...summary(j), tasks: keys.filter(k => flat[k].task).length, docs: keys.filter(k => flat[k].files?.length).length,
      approvals: one("SELECT COUNT(*) n FROM approvals WHERE doc_type = ? AND doc_id = ?", JOURNEY_DOC, pid).n, site_plan: !!sitePlan(j) };
  }
  if (lead) {
    const nobody = used.filter(r => !roles[r].people.length);
    const year = String(Number(today().slice(0, 4)) + (today().slice(5, 7) >= '10' ? 1 : 0));
    const crewUnknown = one("SELECT COUNT(*) n FROM schedule_activities WHERE journey_step IS NOT NULL AND crew IS NULL AND party = 'WIESPL' AND kind = 'Activity'").n;
    out.checks = [
      { ok: !nobody.length, title: 'Every role in "Who does what" has a person', detail: nobody.length ? `Nobody has: ${nobody.map(r => roles[r].label).join(', ')}. Give the roles under Admin → Users.` : 'All roles have a person.', link: '#/users' },
      { ok: !!pid, title: 'Pilot order chosen', detail: pid ? out.pilot.title : 'Choose one real order below: it runs through every step first.' },
      { ok: !!out.pilot?.tasks, title: 'Pilot: steps given to people as tasks', detail: out.pilot ? `${out.pilot.tasks} step(s) given as tasks` : 'After the pilot order is chosen', link: '#/journey/team' },
      { ok: !!out.pilot?.docs, title: 'Pilot: documents attached to the steps', detail: out.pilot ? `${out.pilot.docs} step(s) with documents` : '—' },
      { ok: !!out.pilot?.approvals, title: 'Pilot: a gate sent for approval', detail: out.pilot ? `${out.pilot.approvals} approval(s)` : '—' },
      { ok: !!out.pilot?.site_plan, title: 'Pilot: site plan made from the dispatch day', detail: out.pilot ? (out.pilot.site_plan ? 'Made' : 'On the order\'s journey, once it has a project') : '—' },
      { ok: !!one("SELECT 1 FROM holidays WHERE date LIKE ?", `${year}-%`), title: `Holidays of ${year} entered (site plans skip them)`, detail: 'HR → Holidays', link: '#/list/holidays' },
      { ok: !crewUnknown, title: 'Crew known for every site activity', detail: crewUnknown ? `${crewUnknown} site activit${crewUnknown === 1 ? 'y has' : 'ies have'} no crew yet (the site notes do not give it): set it in the Project Planner` : 'All set' },
    ];
  }
  return out;
}
export function setPilot(body, user) {
  if (!canAssign(user)) throw new HttpError(403, 'Only people who give tasks choose the pilot order');
  const id = body?.journey_id ? Number(body.journey_id) : null;
  if (id) load(id);
  db.prepare("INSERT INTO settings (key, value) VALUES ('journey_pilot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(id));
  audit(user.name, 'journeys', id, 'update', id ? 'chosen as the pilot order' : 'pilot order cleared');
  return guide(user);
}
