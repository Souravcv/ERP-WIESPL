// "My tasks": everything waiting for this person, from their role's permissions — BOQ sections to review, BOQs to make
// Final, changes asked of them, requisitions to check, approvals, material to order, follow-ups, work orders without a BOQ.
import { db } from './db.js';
import { listRows } from './crud.js';
import { canWrite, canView, hasFunction } from '../public/js/schema.js';
import { canApprove } from './workflows.js';
import { reviewsOf, storeOverview } from './boqflow.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const fmt = d => (d ? d.split('-').reverse().join('-') : '');

export function myTasks(user) {
  const role = user.role, t = today(), soon = addDays(t, 7);
  const groups = [];
  const group = (key, icon, title, items) => { if (items.length) groups.push({ key, icon, title, items }); };

  // BOQ design review / Final / changes asked
  if (canView('boms', role)) {
    const inReview = db.prepare("SELECT id, bom_no, client, reviews, prepared_by FROM boms WHERE status = 'Design Review' ORDER BY COALESCE(required_by, '9999'), id").all();
    const review = [], final = [], changes = [];
    for (const b of inReview) {
      const rv = reviewsOf(b);
      const open = Object.entries(rv).filter(([, r]) => r.status !== 'Reviewed');
      if (hasFunction(role, 'boq_review')) for (const [d, r] of open) {
        review.push({ title: `Review the ${d} section of ${b.bom_no}`, sub: [b.client, r.note, r.status === 'Changes needed' ? 'changes were asked: check again' : null].filter(Boolean).join(' · '), link: `#/bom/${b.id}` });
      }
      if (!open.length && hasFunction(role, 'boq_final')) final.push({ title: `Make ${b.bom_no} Final`, sub: `${b.client || ''} · every department has reviewed it`, link: `#/bom/${b.id}` });
      if (b.prepared_by === user.name) for (const [d, r] of Object.entries(rv).filter(([, r]) => r.status === 'Changes needed')) {
        changes.push({ title: `Change the ${d} section of ${b.bom_no}`, sub: `${r.by || ''}: ${r.comments || ''}`, link: `#/bom/${b.id}`, late: true });
      }
    }
    group('changes', '✎', 'Changes asked of you', changes);
    group('review', '🔍', 'BOQ sections to review', review);
    group('final', '🔒', 'BOQs ready to make Final', final);
  }

  // Work orders that have no BOQ yet
  if (canWrite('boms', role)) {
    group('wo', '📂', 'Work orders without a BOQ', db.prepare(`SELECT w.id, w.boq_no, w.title, w.date FROM boqs w
      WHERE w.status = 'Open' AND NOT EXISTS (SELECT 1 FROM boms b WHERE b.work_order_id = w.id)
        AND EXISTS (SELECT 1 FROM boq_items i WHERE i.boq_id = w.id AND COALESCE(i.kind, 'Item') = 'Item') ORDER BY w.id DESC LIMIT 30`).all()
      .map(w => ({ title: `Generate the BOQ for ${w.boq_no}`, sub: `${w.title} · since ${fmt(w.date)}`, link: `#/boq/${w.id}` })));
  }

  // Requisitions to check and submit (automatic ones for the store, and your own drafts)
  if (canWrite('requisitions', role)) {
    const store = hasFunction(role, 'notify_store_check');
    group('req', '📝', 'Requisitions to check and submit', db.prepare(`SELECT id, req_no, project_name, requested_by, required_by, created_by, lines FROM requisitions
      WHERE status = 'Draft' AND (created_by = ? OR (? AND requested_by LIKE 'Auto –%')) ORDER BY COALESCE(required_by, '9999'), id`).all(user.name, store ? 1 : 0)
      .map(r => ({ title: `${r.req_no}${String(r.requested_by || '').startsWith('Auto') ? ' (automatic)' : ''}: check and Submit`,
        sub: [r.project_name, `${JSON.parse(r.lines || '[]').length} material(s)`, r.required_by && `required by ${fmt(r.required_by)}`].filter(Boolean).join(' · '),
        link: `#/view/requisitions/${r.id}`, due: r.required_by })));
  }

  // Approved payments / expense vouchers waiting to be paid (enter the UTR), and bills blocked by the 3-way check.
  if (hasFunction(role, 'pay_record')) {
    group('topay', '💸', 'Approved – pay and enter the UTR', [
      ...db.prepare("SELECT x.id, x.payment_no no, x.amount, x.net_amount, v.name party FROM vendor_payments x LEFT JOIN vendors v ON v.id = x.vendor_id WHERE x.status = 'Approved' ORDER BY x.id").all()
        .map(x => ({ title: `${x.no}: pay ₹${Math.round(x.net_amount ?? x.amount).toLocaleString('en-IN')} to ${x.party || ''}`, link: `#/view/vendor_payments/${x.id}` })),
      ...db.prepare("SELECT id, voucher_no no, amount, payee FROM expenses WHERE status = 'Approved' ORDER BY id").all()
        .map(x => ({ title: `${x.no}: pay ₹${Math.round(x.amount).toLocaleString('en-IN')} to ${x.payee}`, link: `#/view/expenses/${x.id}` })),
    ]);
  }
  if (hasFunction(role, 'pay_final')) {
    group('3way', '⚠', 'Bills more than the material received (3-way)', db.prepare("SELECT b.id, b.bill_no, b.match_note, v.name party FROM vendor_bills b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.match_note LIKE 'Bills %' AND b.override_by IS NULL").all()
      .map(b => ({ title: `${b.bill_no} ${b.party || ''}`, sub: b.match_note, link: `#/view/vendor_bills/${b.id}`, late: true })));
  }

  // Receivables: drafts to issue, money overdue from customers (incl. retention now due), TDS certificates to collect.
  if (canWrite('invoices', role)) {
    group('issue', '💳', 'Invoices to check and issue', db.prepare("SELECT i.id, i.type, i.milestone, i.total, i.date, c.name customer FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.status = 'Draft' ORDER BY i.id").all()
      .map(i => ({ title: `Issue ${i.type === 'Proforma Invoice' ? 'proforma' : 'invoice'} to ${i.customer || ''} – ₹${Math.round(i.total || 0).toLocaleString('en-IN')}`,
        sub: [i.milestone, `draft of ${fmt(i.date)}`].filter(Boolean).join(' · '), link: `#/view/invoices/${i.id}` })));
    group('collect', '💰', 'Money overdue from customers', listRows('invoices', { type: 'Tax Invoice' })
      .filter(i => !['Draft', 'Cancelled', 'Paid'].includes(i.status) && i.due_now > 0.5 && (i.due_date || i.date) < t)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 40)
      .map(i => ({ title: `Collect ₹${Math.round(i.due_now).toLocaleString('en-IN')} from ${i.customer_id_label || ''}`,
        sub: `${i.invoice_no}${i.milestone ? ' · ' + i.milestone : ''} · due ${fmt(i.due_date)}`, link: `#/view/invoices/${i.id}`, due: i.due_date, late: true })));
    group('16a', '📄', 'TDS certificates (Form 16A) to collect', db.prepare("SELECT p.id, p.receipt_no, p.tds_amount, p.date, c.name customer FROM payments p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.status = 'Received' AND p.tds_amount > 0 AND COALESCE(p.form16a, 'No') <> 'Yes' AND p.date <= ? ORDER BY p.date LIMIT 30").all(addDays(t, -60))
      .map(p => ({ title: `Form 16A from ${p.customer || ''} for ₹${Math.round(p.tds_amount).toLocaleString('en-IN')} TDS`, sub: `${p.receipt_no} of ${fmt(p.date)}`, link: `#/view/payments/${p.id}` })));
  }

  // Draft issue slips / dispatch challans / transfers waiting to be posted.
  if (hasFunction(role, 'stock_post')) {
    group('post', '📤', 'Draft issues / transfers to post', db.prepare("SELECT d.id, d.doc_kind, d.item_count, d.issued_to, d.to_location, d.prepared_by, d.date, p.name project FROM stock_drafts d LEFT JOIN projects p ON p.id = d.project_id WHERE d.status = 'Draft' ORDER BY d.date, d.id").all()
      .map(d => ({ title: `Post ${d.doc_kind.toLowerCase()} – ${d.item_count} item(s)${d.project || d.issued_to || d.to_location ? ' for ' + (d.project || d.issued_to || d.to_location) : ''}`, sub: `draft #${d.id} by ${d.prepared_by || ''} · ${fmt(d.date)}`, link: `#/view/stock_drafts/${d.id}` })));
  }

  // Approvals this person may give
  const aps = db.prepare("SELECT id, doc_type, doc_ref, stage, title, requested_by, requested_at FROM approvals WHERE status = 'Pending' ORDER BY id").all()
    .filter(a => canApprove(a.doc_type, a.stage, user));
  group('approve', '✅', 'Approvals waiting for you', aps.map(a => ({ title: `${a.doc_type} ${a.doc_ref || ''} – ${a.stage || 'approval'}`, sub: `${a.title || ''} · by ${a.requested_by} ${a.requested_at || ''}`, link: `#/view/approvals/${a.id}` })));

  // Material to order (order-by date within a week or past) for Final BOQs
  if (hasFunction(role, 'notify_store_check') || hasFunction(role, 'approve_requisition')) {
    const due = [];
    for (const b of storeOverview()) for (const r of b.todo) {
      if (!(r.to_requisition > 0) && !r.late) continue;
      if (r.order_by && r.order_by > soon && !r.late) continue;
      due.push({ title: `Order ${r.to_requisition || r.shortage} ${r.uom || ''} ${r.component}${r.dimensions ? ' ' + r.dimensions : ''}`, sub: `${b.bom_no} ${b.client || ''}${r.order_by ? ` · order by ${fmt(r.order_by)}` : ''}`,
        link: `#/bom/${b.id}`, due: r.order_by, late: r.late });
    }
    due.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
    group('order', '📦', 'Material to order this week', due.slice(0, 50));
  }

  // Follow-ups due
  if (canView('enquiries', role)) {
    group('follow', '📞', 'Follow-ups due', db.prepare(`SELECT 'e' k, id, enquiry_no ref, COALESCE(hospital_name, doctor_name, place) who, next_followup due FROM enquiries
        WHERE next_followup IS NOT NULL AND next_followup <= ? AND enquiry_by = ? AND status NOT IN ('Won', 'Lost', 'Regret', 'Closed')
      UNION ALL SELECT 'f', f.id, e.enquiry_no, f.notes, f.next_date FROM followups f LEFT JOIN enquiries e ON e.id = f.enquiry_id
        WHERE f.status = 'Open' AND f.next_date IS NOT NULL AND f.next_date <= ? AND f.assigned_to = ? ORDER BY due LIMIT 40`).all(t, user.name, t, user.name)
      .map(r => ({ title: `Follow up ${r.ref || ''} ${String(r.who || '').slice(0, 60)}`, sub: `due ${fmt(r.due)}`, link: r.k === 'e' ? `#/view/enquiries/${r.id}` : `#/view/followups/${r.id}`, due: r.due, late: r.due < t })));
  }

  return { count: groups.reduce((s, g) => s + g.items.length, 0), groups };
}
