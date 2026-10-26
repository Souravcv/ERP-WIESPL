// Task scheduler rules: anyone sets tasks for themselves; only people allowed to assign (function task_assign) give
// tasks to others and see everyone's. The assignee updates status, checklist and result; the assigner edits the
// rest. Done on a repeating task makes the next one. The assignee and the assigner get pop-ups.
import { db } from './db.js';
import { getRow, insertRow, HttpError } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { notify } from './notify.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const canAssign = user => hasFunction(user?.role, 'task_assign');
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const ASSIGNEE_KEYS = ['status', 'progress_note', 'checklist'];

export const mayView = (task, user) => canAssign(user) || same(task.assigned_to, user.name) || same(task.assigned_by, user.name);
export const visibleTasks = (rows, user) => (canAssign(user) ? rows : rows.filter(t => mayView(t, user)));

// Before a change through the screen: who may change what.
export function guardUpdate(task, body, user) {
  if (canAssign(user) || same(task.assigned_by, user.name)) return;
  if (!same(task.assigned_to, user.name)) throw new HttpError(403, 'This task is not yours');
  const other = Object.keys(body || {}).filter(k => !ASSIGNEE_KEYS.includes(k) && String(body[k] ?? '') !== String(task[k] ?? ''));
  if (other.length) throw new HttpError(403, `${task.assigned_by || 'The person who gave it'} set this task: you can change its status, checklist and update only`);
}

let event = null; // what the save is about, handed from beforeSave to afterSave (saves run one at a time)
export function beforeSaveTask(row, existing, user, docNo, date) {
  if (!existing) {
    if (!row.task_no) row.task_no = docNo('task', date, (n, fy) => `TSK-${n}/20${fy}`);
    row.assigned_by = row.assigned_by || user?.name || null;
    row.assigned_to = String(row.assigned_to || '').trim() || user?.name;
    if (user && !same(row.assigned_to, user.name) && !canAssign(user) && user.name !== 'system') throw new HttpError(403, 'You can set tasks for yourself only: ask your head to assign tasks to others');
  } else if ('assigned_to' in row && !same(row.assigned_to, existing.assigned_to) && user && !canAssign(user) && !same(existing.assigned_by, user.name)) {
    throw new HttpError(403, 'Only the person who gave this task (or someone allowed to assign) can hand it to someone else');
  }
  const status = row.status ?? existing?.status;
  if (status === 'Done' && existing?.status !== 'Done') Object.assign(row, { completed_at: stamp(), completed_by: user?.name || null });
  if (existing?.status === 'Done' && row.status && row.status !== 'Done') Object.assign(row, { completed_at: null, completed_by: null });
  event = { isNew: !existing, oldTo: existing?.assigned_to, doneNow: status === 'Done' && existing?.status !== 'Done' };
}

const addPeriod = (d, repeat) => {
  const x = new Date(d + 'T00:00:00');
  if (repeat === 'Daily') x.setDate(x.getDate() + 1);
  else if (repeat === 'Weekly') x.setDate(x.getDate() + 7);
  else if (repeat === 'Monthly') x.setMonth(x.getMonth() + 1);
  return x.toLocaleString('sv-SE').slice(0, 10);
};

export function afterSaveTask(id, user) {
  const e = event; event = null;
  if (!e) return;
  const t = getRow('work_tasks', id);
  const link = `#/view/work_tasks/${t.id}`;
  const due = t.due_date ? t.due_date.split('-').reverse().join('-') : '';
  if ((e.isNew || !same(e.oldTo, t.assigned_to)) && !same(t.assigned_to, user?.name)) {
    notify({ userNames: [t.assigned_to], kind: 'task', title: `New task from ${user?.name || t.assigned_by}: ${t.title}`, body: [`due ${due}${t.due_time ? ' ' + t.due_time : ''}`, t.priority !== 'Normal' ? t.priority : null].filter(Boolean).join(' · '), link }, user);
  }
  if (e.doneNow) {
    if (t.assigned_by && !same(t.assigned_by, user?.name)) notify({ userNames: [t.assigned_by], kind: 'task', title: `Done: ${t.title}`, body: `by ${user?.name || t.assigned_to}${t.progress_note ? ' · ' + String(t.progress_note).slice(0, 120) : ''}`, link }, user);
    // A repeating task: the next one, once, unless past "repeat until".
    if (t.repeat && t.repeat !== 'No repeat' && !db.prepare('SELECT 1 FROM work_tasks WHERE parent_id = ?').get(t.id)) {
      const nextDue = addPeriod(t.due_date, t.repeat);
      if (!t.repeat_until || nextDue <= t.repeat_until) {
        const span = t.start_date && t.due_date ? Math.round((Date.parse(t.due_date) - Date.parse(t.start_date)) / 864e5) : 0;
        const start = new Date(nextDue + 'T00:00:00'); start.setDate(start.getDate() - span);
        insertRow('work_tasks', { title: t.title, description: t.description, assigned_to: t.assigned_to, assigned_by: t.assigned_by, priority: t.priority, category: t.category,
          start_date: start.toLocaleString('sv-SE').slice(0, 10), due_date: nextDue, due_time: t.due_time, repeat: t.repeat, repeat_until: t.repeat_until, project_id: t.project_id, customer_id: t.customer_id,
          ticket_id: t.ticket_id, location_id: t.location_id, checklist: (t.checklist || []).map(c => ({ item: c.item, done: '' })), status: 'To do', parent_id: t.id }, { name: 'system', role: 'admin' }, { system: true });
      }
    }
  }
}

// My tasks page: what is given to me (due within a week or late), and what I gave that is late.
export function taskGroups(user, today, soon) {
  const mine = db.prepare("SELECT id, task_no, title, due_date, due_time, priority, assigned_by FROM work_tasks WHERE lower(assigned_to) = lower(?) AND status NOT IN ('Done', 'Cancelled') AND due_date <= ? ORDER BY due_date, CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 ELSE 2 END, id").all(user.name, soon);
  const given = db.prepare("SELECT id, title, due_date, assigned_to, status FROM work_tasks WHERE lower(assigned_by) = lower(?) AND lower(assigned_to) <> lower(?) AND status NOT IN ('Done', 'Cancelled') AND due_date < ? ORDER BY due_date").all(user.name, user.name, today);
  const fmt = d => (d ? d.split('-').reverse().join('-') : '');
  return [
    ['mywork', '🗂️', 'Your tasks', mine.map(t => ({ title: `${t.priority === 'Urgent' ? '🔴 ' : t.priority === 'High' ? '🟠 ' : ''}${t.title}`, sub: [`due ${fmt(t.due_date)}${t.due_time ? ' ' + t.due_time : ''}`, !same(t.assigned_by, user.name) && t.assigned_by ? `from ${t.assigned_by}` : null].filter(Boolean).join(' · '), link: `#/view/work_tasks/${t.id}`, due: t.due_date, late: t.due_date < today }))],
    ['given', '📌', 'Tasks you gave that are late', given.map(t => ({ title: `${t.assigned_to}: ${t.title}`, sub: `due ${fmt(t.due_date)} · ${t.status}`, link: `#/view/work_tasks/${t.id}`, late: true }))],
  ];
}
