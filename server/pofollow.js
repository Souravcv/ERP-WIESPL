// PO follow-up (expediting): purchase logs every call to the vendor (what they said, the date they give now, when to
// call again). The date the vendor gives becomes the PO's delivery date; the first one is kept to measure the vendor
// against. Once a day purchase hears which POs to chase: follow-ups due, overdue, due within 3 days, no date yet.
import { db, getSettings } from './db.js';
import { notify } from './notify.js';
import { hasFunction, canWrite } from '../public/js/schema.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const addDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const parse = s => { try { return JSON.parse(s || '[]') || []; } catch { return []; } };
const fmt = d => (d ? d.split('-').reverse().join('-') : '');
const OPEN = ['Approved', 'Sent', 'Partially Received'];
const BAD = ['Delayed', 'Problem / on hold', 'No answer'];

// a follow-up saved: the vendor's date goes on the PO (the first date ever given is kept); a delay or problem is told
export function afterFollowup(id, user) {
  const f = db.prepare('SELECT * FROM po_followups WHERE id = ?').get(id);
  if (!f) return;
  const po = db.prepare('SELECT p.id, p.po_no, p.delivery_date, p.first_promised, p.prepared_by, v.name vendor FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE p.id = ?').get(f.po_id);
  if (!po) return;
  if (f.promised && f.promised !== po.delivery_date) {
    db.prepare('UPDATE purchase_orders SET delivery_date = ?, first_promised = COALESCE(first_promised, ?) WHERE id = ?').run(f.promised, po.delivery_date || f.promised, po.id);
  }
  if (BAD.includes(f.vendor_status)) {
    notify({ fn: 'po_check', userNames: [po.prepared_by].filter(Boolean), kind: 'po', title: `PO ${po.po_no} ${po.vendor || ''}: ${f.vendor_status.toLowerCase()}`,
      body: [f.note, f.promised ? `vendor's date now ${fmt(f.promised)}` : null].filter(Boolean).join(' · '), link: `#/view/purchase_orders/${po.id}` }, user);
  }
}

// every open PO that needs a call, with why
export function followItems() {
  const t = today(), soon = addDays(t, 3);
  const last = new Map(db.prepare('SELECT po_id, date, note, next_on, vendor_status, promised FROM po_followups ORDER BY date, id').all().map(f => [f.po_id, f]));
  const out = [];
  for (const p of db.prepare(`SELECT p.id, p.po_no, p.date, p.delivery_date, p.status, p.prepared_by, p.lines, v.name vendor FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE p.status IN (${OPEN.map(() => '?').join(',')}) ORDER BY p.date, p.id`).all(...OPEN)) {
    const pending = parse(p.lines).filter(l => Number(l.qty) > 0 && (Number(l.received) || 0) < Number(l.qty) - 1e-9);
    if (!pending.length) continue;
    const dates = pending.map(l => l.promised || p.delivery_date).filter(Boolean).sort();
    const promised = dates[0] || null, f = last.get(p.id);
    const why = [];
    if (f?.next_on && f.next_on <= t) why.push(`follow-up due${f.next_on < t ? ` since ${fmt(f.next_on)}` : ' today'}`);
    if (promised && promised < t) why.push(`overdue ${days(promised, t)} day${days(promised, t) === 1 ? '' : 's'}`);
    else if (promised && promised <= soon) why.push(`due ${fmt(promised)}: confirm dispatch`);
    if (!promised && p.date <= addDays(t, -2)) why.push('no delivery date from the vendor');
    if (f && BAD.includes(f.vendor_status) && !why.length) why.push(`vendor said: ${f.vendor_status.toLowerCase()}`);
    if (!why.length) continue;
    out.push({ id: p.id, po_no: p.po_no, vendor: p.vendor, prepared_by: p.prepared_by, promised, lines: pending.length, why, last: f || null,
      late: !!promised && promised < t, sort: promised && promised < t ? days(promised, t) + 1000 : 0 });
  }
  return out.sort((a, b) => b.sort - a.sort);
}

// My tasks: POs to follow up, for people who handle purchase orders
export function myFollowItems(user) {
  if (!hasFunction(user.role, 'po_check') && !canWrite('purchase_orders', user.role)) return [];
  return followItems().map(x => ({ title: `${x.late ? '🔴 ' : ''}PO ${x.po_no} · ${x.vendor || ''}`, sub: [x.why.join(', '), x.last ? `last: ${fmt(x.last.date)} ${String(x.last.note || '').slice(0, 60)}` : 'no follow-up yet'].join(' · '),
    link: `#/view/purchase_orders/${x.id}`, late: x.late }));
}

// once a day (after 9): one pop-up to purchase with the POs to chase
export function dailyPoFollowups() {
  const t = today();
  if (getSettings().po_follow_alerts === t) return 0;
  const items = followItems();
  let sent = 0;
  if (items.length) {
    const late = items.filter(x => x.late).length;
    sent = notify({ fn: 'po_check', userNames: [...new Set(items.map(x => x.prepared_by).filter(Boolean))], kind: 'po',
      title: `POs to follow up today: ${items.length}${late ? ` (${late} overdue)` : ''}`,
      body: items.slice(0, 12).map(x => `PO ${x.po_no} ${x.vendor || ''}: ${x.why.join(', ')}`).join('\n') + (items.length > 12 ? `\n+ ${items.length - 12} more` : ''), link: '#/tasks' }, { name: 'system' });
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('po_follow_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(t));
  return sent;
}

// the last follow-up of each PO, for the material tracker
export const lastFollowups = () => new Map(db.prepare('SELECT po_id, date, note, next_on, vendor_status FROM po_followups ORDER BY date, id').all().map(f => [f.po_id, f]));
