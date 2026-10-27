// Planning department: dispatch plans per project (what goes to site when, on which vehicle), each shown as a
// milestone on the project's Gantt; and the work order split by department (one master copy, each line owned by a
// department) so every department sees its own part.
import { db, tx, audit } from './db.js';
import { getRow, updateRow, listRows, HttpError } from './crud.js';
import { canWrite } from '../public/js/schema.js';
import { compute } from './schedule.js';
import { notify } from './notify.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const firstLine = s => String(s || '').split('\n')[0].trim();
const parse = (v, d = []) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || '') ?? d; } catch { return d; } };

// After a dispatch plan is saved: keep its milestone on the project's Gantt in step, and tell the store about a new plan.
export function afterDispatchPlan(id, user) {
  const p = getRow('dispatch_plans', id);
  if (!p.project_id) return;
  const done = ['Dispatched', 'Delivered'].includes(p.status);
  const name = `Dispatch to site: ${p.plan_no}${p.title ? ' – ' + p.title : ''}`.slice(0, 200);
  const act = p.activity_id && db.prepare('SELECT id, project_id FROM schedule_activities WHERE id = ?').get(p.activity_id);
  if (p.status === 'Cancelled') {
    if (act) db.prepare('DELETE FROM schedule_activities WHERE id = ?').run(act.id);
    db.prepare('UPDATE dispatch_plans SET activity_id = NULL WHERE id = ?').run(id);
  } else {
    const when = done ? (p.dispatched_on || today()) : null;
    const fields = { name, kind: 'Milestone', party: 'WIESPL', dept: 'Logistics', duration: 0, fixed_start: p.planned_date, responsible: p.planned_by || null,
      status: done ? 'Done' : 'Not started', progress: done ? 100 : 0, actual_start: when, actual_finish: when };
    if (act && act.project_id === p.project_id) {
      const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE schedule_activities SET ${sets} WHERE id = ?`).run(...Object.values(fields), act.id);
    } else {
      if (act) db.prepare('DELETE FROM schedule_activities WHERE id = ?').run(act.id);
      const top = db.prepare('SELECT COALESCE(MAX(sr), 0) sr, COALESCE(MAX(sort), 0) sort FROM schedule_activities WHERE project_id = ?').get(p.project_id);
      const cols = ['project_id', 'sr', 'sort', ...Object.keys(fields), 'created_by', 'created_at'];
      const r = db.prepare(`INSERT INTO schedule_activities (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(p.project_id, top.sr + 1, top.sort + 1, ...Object.values(fields), user?.name || 'system', new Date().toLocaleString('sv-SE').slice(0, 19));
      db.prepare('UPDATE dispatch_plans SET activity_id = ? WHERE id = ?').run(Number(r.lastInsertRowid), id);
      notify({ fn: 'stock_post', kind: 'dispatch_plans', title: `Dispatch plan ${p.plan_no}: ${p.project_id_label || ''} on ${p.planned_date}`,
        body: [p.title, `${parse(p.lines).filter(l => l.description).length} item(s)`, p.ready_by && `material ready by ${p.ready_by}`].filter(Boolean).join(' · '), link: `#/view/dispatch_plans/${id}` }, user);
    }
  }
  try { compute(p.project_id); } catch (e) { console.error('planner', e.message); }
}

// A challan delivered at site closes the dispatch plan it went on.
export function challanToPlan(challanId) {
  const c = db.prepare('SELECT status, delivered_date FROM challans WHERE id = ?').get(challanId);
  if (c?.status === 'Delivered') db.prepare("UPDATE dispatch_plans SET status = 'Delivered' WHERE challan_id = ? AND status = 'Dispatched'").run(challanId);
}

// Fill a dispatch plan with the work-order material still to send (optionally one department's part only).
export function fillPlan(id, body, user) {
  const p = getRow('dispatch_plans', id);
  if (['Dispatched', 'Delivered', 'Cancelled'].includes(p.status)) throw new HttpError(409, `This plan is ${p.status}`);
  const boqIds = p.boq_id ? [p.boq_id] : db.prepare("SELECT id FROM boqs WHERE project_id = ? AND status <> 'Completed'").all(p.project_id).map(r => r.id);
  if (!boqIds.length) throw new HttpError(400, 'This project has no open work order: choose the work order on the plan');
  const lines = parse(p.lines).filter(l => l.description || Number(l.qty));
  const have = new Set(lines.map(l => l.boq_item_id).filter(Boolean));
  let added = 0;
  for (const boqId of boqIds) {
    for (const b of listRows('boq_items', { boq_id: boqId, limit: 20000 })) {
      if (b.kind === 'Heading' || have.has(b.id) || ['Dispatched', 'Delivered'].includes(b.delivery_status)) continue;
      if (body?.department && (b.department || '') !== (body.department === '(not assigned)' ? '' : body.department)) continue;
      lines.push({ boq_item_id: b.id, description: `${b.sr_no ? b.sr_no + ' ' : ''}${[b.heading, firstLine(b.description)].filter(Boolean).join(' › ')} (${b.section || 'WO'})`.slice(0, 300),
        uom: b.uom || '', qty: b.pending ?? null, department: b.department || '', remark: '' });
      added++;
    }
  }
  updateRow('dispatch_plans', id, { lines }, user);
  return { added, plan: getRow('dispatch_plans', id) };
}

// The work order split by department: give many lines (or a whole section) to one department.
export function setDepartments(boqId, body, user) {
  if (!canWrite('boqs', user.role)) throw new HttpError(403, 'No permission to change the work order');
  const ids = (body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Choose the lines');
  const dept = body.department || null;
  return tx(() => {
    const st = db.prepare('UPDATE boq_items SET department = ? WHERE id = ? AND boq_id = ?');
    let n = 0;
    for (const id of ids) n += Number(st.run(dept, id, Number(boqId)).changes);
    audit(user.name, 'boqs', Number(boqId), 'departments', `${n} line(s) → ${dept || 'not assigned'}`);
    return { changed: n };
  });
}
