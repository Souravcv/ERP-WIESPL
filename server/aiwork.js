// WIESPL AI: instant answers about the day's work, written by the CRM itself (no waiting for the AI model, which writes
// only ~8 words a second on the office PC). Each comes from the same function as the screen that shows it, so it shows
// exactly what that screen would show this person: My tasks, approvals they may decide, POs to chase, material of a
// project, late journey steps. Returns null when the question is not one of these; the model answers it then.
import { listRows, getRow } from './crud.js';
import { canView } from '../public/js/schema.js';

const fmt = d => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '');
const MAX = 8; // lines per group: the rest is on the screen the answer links to
// "#/view/purchase_orders/12" → a source chip under the answer
function linkSource(link, label, sources) {
  const m = /^#\/view\/(\w+)\/(\d+)/.exec(link || ''); if (m) sources.push({ module: m[1], id: Number(m[2]), label: String(label).slice(0, 40) });
}
const lines = (items, line, more, max = MAX) => [...items.slice(0, max).map(line), ...(items.length > max ? [`- …and ${items.length - max} more${more ? ` on ${more}` : ''}`] : [])].join('\n');

const INTENTS = [
  ['day', /\bwhat (should|shall|do|must|can) i (do|work on|handle|finish)\b|\bmy (tasks|work|day|to-?dos?|pending work)\b|\bto-?do list\b|\bplan (for )?(my|the) day\b|\bwork (for|to do) today\b|आज.{0,20}(काम|करू|करूं|करना|करायच)|(माझी|माझे|मेरे|मेरा) (कामे|काम)/i],
  ['approvals', /(approv|मंजूर|मंज़ूर|मान्यता).{0,40}\b(wait|pending|me|my|mine|for me)\b|\b(waiting|pending)\b.{0,30}approv|(मंजूर|मंज़ूर|मान्यता)/i],
  ['material', /\bmaterials?\b.{0,40}\b(pending|awaited|missing|balance|status|short|not (yet )?received|due|late|left|remaining)\b|\b(pending|awaited|missing|balance|remaining)\b.{0,15}\bmaterials?\b|(साहित्य|माल|मटेरियल)/i],
  ['latepo', /\b(po|pos|p\.o\.|purchase orders?)\b.{0,40}\b(late|overdue|delay(ed)?|chase|follow[ -]?ups?|not delivered|pending delivery)\b|\b(late|overdue|delayed|chase|follow up)\b.{0,30}\b(po|pos|purchase orders?|deliveries|delivery)\b/i],
  ['late', /\b(what|which)('s| is| are)? (late|overdue|delayed|behind)\b|\b(late|overdue|delayed)\b.{0,20}\b(steps?|journeys?|orders?|projects?|work|items?)\b|\bbehind schedule\b/i],
];
export const workIntent = text => (INTENTS.find(([, re]) => re.test(text)) || [])[0] || null;

export async function workAnswer(user, text, screen, sources) {
  const kind = workIntent(text); if (!kind) return null;
  const first = String(user.name || '').split(' ')[0];

  if (kind === 'day' || kind === 'approvals') {
    const { myTasks } = await import('./tasks.js');
    const mine = myTasks(user);
    if (kind === 'approvals') {
      const g = mine.groups.find(x => x.key === 'approve');
      if (!g) return 'No approvals are waiting for you right now.';
      g.items.slice(0, MAX).forEach(i => linkSource(i.link, i.title, sources));
      return `**${g.items.length} approval${g.items.length === 1 ? ' is' : 's are'} waiting for you:**\n${lines(g.items, i => `- ${i.title}${i.sub ? ` · ${i.sub}` : ''}`, 'My tasks')}`;
    }
    if (!mine.count) return `Nothing is waiting for you right now, ${first}. 👍`;
    const late = mine.groups.reduce((s, g) => s + g.items.filter(i => i.late).length, 0);
    mine.groups.forEach(g => g.items.slice(0, 3).forEach(i => linkSource(i.link, i.title, sources)));
    return `**Your work, ${first}: ${mine.count} item${mine.count === 1 ? '' : 's'}**${late ? ` (🔴 ${late} late: do those first)` : ''}\n\n` +
      mine.groups.map(g => `**${g.icon} ${g.title} (${g.items.length})**\n${lines([...g.items].sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0)), i => `- ${i.late && !/^🔴/.test(i.title) ? '🔴 ' : ''}${i.title}${i.sub ? ` · ${i.sub}` : ''}`, 'My tasks', 4)}`).join('\n\n');
  }

  if (kind === 'latepo') {
    if (!canView('purchase_orders', user.role)) return 'Your role cannot see purchase orders.';
    const { followItems } = await import('./pofollow.js');
    const all = followItems(), late = all.filter(x => x.late);
    if (!all.length) return 'No purchase order needs a call right now: everything open is on time and has a delivery date.';
    // "late / overdue" asked: the overdue ones only, if there are any; else say so and show what needs a call
    const onlyLate = /\b(late|overdue|delay)/i.test(text) && late.length, shown = onlyLate ? late : all;
    shown.slice(0, MAX).forEach(x => sources.push({ module: 'purchase_orders', id: x.id, label: `PO ${x.po_no}` }));
    const head = onlyLate ? `**${late.length} purchase order${late.length === 1 ? ' is' : 's are'} overdue** (past the promised date); ${all.length} need a call in all:`
      : /\b(late|overdue|delay)/i.test(text) ? `No purchase order is past its promised date. ✅\nBut **${all.length} need a call** (no delivery date from the vendor, a follow-up due, or due within 3 days):`
      : `**${all.length} purchase order${all.length === 1 ? '' : 's'} to chase**, ${late.length} overdue:`;
    return `${head}\n` +
      lines(shown, x => `- ${x.late ? '🔴 ' : ''}**${x.po_no}** · ${x.vendor || '?'} · ${x.why.join(', ')} · ${x.lines} line${x.lines === 1 ? '' : 's'} pending${x.last ? ` · last call ${fmt(x.last.date)}` : ''}`, 'the PO Tracker');
  }

  if (kind === 'material') {
    const { mayView, projectMaterials, trackedProjects } = await import('./materials.js');
    if (!mayView(user)) return 'Your role cannot see the material tracker.';
    const project = findProject(text, screen);
    if (!project) {
      const list = trackedProjects(user).projects.filter(p => p.pos > 0).slice(0, 8);
      return `Which project? Ask e.g. "pending material for ${list[0]?.name || 'Jehangir'}".${list.length ? `\nProjects with POs: ${list.map(p => p.name).join(', ')}.` : ''}`;
    }
    const m = projectMaterials(project.id, user), open = m.rows.filter(r => r.state !== 'Received');
    sources.push({ module: 'projects', id: project.id, label: String(project.name).slice(0, 40) });
    if (!m.rows.length) return `Nothing is tracked yet for **${project.name}**: no PO, requisition or Final BOQ is linked to it.`;
    if (!open.length) return `✅ All ${m.rows.length} material lines of **${project.name}** are received.`;
    const counts = Object.entries(m.count).filter(([s, n]) => n && s !== 'Received').map(([s, n]) => `${s} ${n}`).join(' · ');
    return `**${project.name}: ${open.length} of ${m.rows.length} material lines pending** (${counts})\nNeeded by: ${m.needed_by.date ? fmt(m.needed_by.date) : 'not set'}\n` +
      lines(open, r => `- ${r.late_days ? '🔴 ' : ''}${String(r.item).slice(0, 60)} · ${r.qty - (r.received || 0)} ${r.uom || ''} · ${r.state}${r.po_no ? ` · PO ${r.po_no}${r.vendor ? ' ' + r.vendor : ''}` : r.req_no ? ` · ${r.req_no}` : r.bom_no ? ` · ${r.bom_no}` : ''}${r.promised ? ` · promised ${fmt(r.promised)}` : ''}${r.late_days ? ` · ${r.late_days} days late` : ''}`, 'the Material Tracker');
  }

  if (kind === 'late') {
    const { dashboard, canSeeRole } = await import('./journey.js');
    if (!canSeeRole(user.role)) { // no order journeys for this role: the late items on their own task list
      const { myTasks } = await import('./tasks.js');
      const late = myTasks(user).groups.flatMap(g => g.items.filter(i => i.late));
      late.slice(0, MAX).forEach(i => linkSource(i.link, i.title, sources));
      return late.length ? `**${late.length} late item${late.length === 1 ? '' : 's'} on your list:**\n${lines(late, i => `- ${i.title}${i.sub ? ` · ${i.sub}` : ''}`, 'My tasks')}` : 'Nothing on your list is late. 👍';
    }
    const d = dashboard(user);
    if (!d.late.length && !d.approvals.length) return `Nothing is late in the order journeys. ${d.kpi.due_soon} step${d.kpi.due_soon === 1 ? '' : 's'} due in the next 2 days.`;
    return `**${d.kpi.late_steps} late step${d.kpi.late_steps === 1 ? '' : 's'} in ${d.kpi.late_orders} order${d.kpi.late_orders === 1 ? '' : 's'}** (of ${d.kpi.orders} running)${d.kpi.slow_approvals ? `, ${d.kpi.slow_approvals} approval${d.kpi.slow_approvals === 1 ? '' : 's'} waiting 2+ days` : ''}:\n` +
      lines(d.late, x => `- ${x.order}: ${x.no}. ${x.title} · ${x.days_late} day${x.days_late === 1 ? '' : 's'} late · ${x.who.length ? x.who.slice(0, 3).join(', ') : 'nobody assigned'}`, 'the Journey dashboard') +
      (d.week.length ? `\n\nDue this week: ${d.week.length} step${d.week.length === 1 ? '' : 's'}.` : '');
  }
  return null;
}

// the project a question names ("pending material for Jehangir"), or the one on screen
const SKIP = /^(pending|material|materials|project|projects|for|of|the|what|which|is|are|status|balance|missing|awaited|show|list|give|me|this|that|site|hospital|still|not|yet|received|remaining|left|due|late)$/i;
export function findProject(text, screen) {
  const on = /^#\/(?:view\/projects|materials)\/(\d+)/.exec(screen || '');
  if (on && /\b(this|current|here)\b|^[^a-z]*$/i.test(text)) { try { const r = getRow('projects', Number(on[1])); if (r) return r; } catch { /* gone */ } }
  const words = (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu) || []).filter(w => !SKIP.test(w));
  for (const w of words) { try { const r = listRows('projects', { q: w, limit: 1 })[0]; if (r) return r; } catch { /* next */ } }
  if (on) { try { return getRow('projects', Number(on[1])) || null; } catch { return null; } }
  return null;
}
