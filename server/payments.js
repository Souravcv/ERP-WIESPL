// Payables: every vendor payment against an approved PO, checked against the PO terms, the material received (GRN)
// and the vendor's bills; approved by someone other than the person who prepared it (Accounts, and the GM above the
// limit or outside the terms); paid with a UTR / cheque no; locked after, only reversible by the GM with a reason.
import { db, getSettings, audit, tx } from './db.js';
import { getRow, updateRow, HttpError } from './crud.js';
import { hasFunction, EXPENSE_NO_PO } from '../public/js/schema.js';
import { refreshPoPayments } from './hooks.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const rs = n => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const parse = (v, d) => { if (v == null || v === '') return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return d; } };
export const limits = () => {
  const s = getSettings();
  const n = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  return { approve: n(s.payment_approval_limit, 50000), expense: n(s.expense_po_limit, 5000), tolerance: n(s.bill_tolerance_pct, 2) };
};
const APPROVED_PO = ['Approved', 'Sent', 'Partially Received', 'Received', 'Closed'];

// Money on one PO: received (GRN value, with its GST share), billed, debit notes, paid, and payments in the pipeline.
export function poMoney(poId, exceptPaymentId = 0) {
  const po = db.prepare('SELECT id, po_no, status, total, subtotal, payment_schedule FROM purchase_orders WHERE id = ?').get(Number(poId));
  if (!po) return null;
  const factor = po.subtotal > 0 ? po.total / po.subtotal : 1;
  const received = db.prepare("SELECT COALESCE(SUM(qty * COALESCE(rate, 0)), 0) v FROM stock_moves WHERE type = 'INWARD' AND po_id = ?").get(po.id).v;
  const billed = db.prepare('SELECT COALESCE(SUM(amount), 0) v FROM vendor_bills WHERE po_id = ?').get(po.id).v;
  const debited = db.prepare('SELECT COALESCE(SUM(amount), 0) v FROM debit_notes WHERE po_id = ?').get(po.id).v;
  const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) v FROM vendor_payments WHERE po_id = ? AND status = 'Paid'").get(po.id).v;
  const pipeline = db.prepare("SELECT COALESCE(SUM(amount), 0) v FROM vendor_payments WHERE po_id = ? AND status IN ('Pending Approval', 'Approved') AND id <> ?").get(po.id, exceptPaymentId).v;
  // What the payment terms make payable by now (lines due within a week), whether paid or not.
  const soon = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toLocaleString('sv-SE').slice(0, 10); })();
  const dueByTerms = parse(po.payment_schedule, []).filter(p => p.due_date && p.due_date <= soon)
    .reduce((s, p) => s + (Number(p.amount) || (Number(p.percent) > 0 ? (po.total || 0) * Number(p.percent) / 100 : 0)), 0);
  return { po, factor, received: r2(received), received_incl: r2(received * factor), billed: r2(billed), debited: r2(debited), paid: r2(paid), pipeline: r2(pipeline),
    due_by_terms: r2(dueByTerms), advance_at_risk: r2(Math.max(0, paid - received * factor)) };
}

// 3-way match for a PO: bills (less debit notes) against the value received.
export function threeWay(poId) {
  const m = poMoney(poId);
  if (!m) return { ok: true, note: '' };
  const tol = limits().tolerance;
  const allowed = m.received_incl * (1 + tol / 100);
  const net = m.billed - m.debited;
  const ok = net <= allowed + 1;
  const note = m.billed ? (ok ? `OK: bills ${rs(net)} ≤ received ${rs(m.received_incl)} (incl. GST)` : `Bills ${rs(net)} are more than the material received ${rs(m.received_incl)} (incl. GST, +${tol}% allowed)`) : '';
  return { ok, note, m };
}
export function refreshBillMatch(poId) {
  const t = threeWay(poId);
  db.prepare('UPDATE vendor_bills SET match_note = ? WHERE po_id = ?').run(t.note || null, Number(poId));
  return t;
}

// The checks for one payment against its PO.
export function checkPayment(p) {
  const blockers = [], notes = [];
  let offTerms = false;
  const m = poMoney(p.po_id, p.id || 0);
  if (!m) return { blockers: ['Choose the PO'], notes, offTerms };
  if (!APPROVED_PO.includes(m.po.status)) blockers.push(`PO ${m.po.po_no} is ${m.po.status}; only approved POs can be paid`);
  const amt = Number(p.amount) || 0;
  if (!(amt > 0)) blockers.push('Enter the amount');
  const room = r2(m.po.total - m.debited - m.paid - m.pipeline);
  if (amt > room + 1) { offTerms = true; notes.push(`More than what is left on the PO: total ${rs(m.po.total)} − debit notes ${rs(m.debited)} − paid ${rs(m.paid)} − awaiting ${rs(m.pipeline)} = ${rs(room)}`); }
  if (String(p.kind || '').startsWith('Against bill')) {
    if (!p.bill_id) blockers.push('Choose the vendor bill this pays');
    else {
      const b = db.prepare('SELECT id, po_id, bill_no, amount, override_by FROM vendor_bills WHERE id = ?').get(Number(p.bill_id));
      if (!b || b.po_id !== Number(p.po_id)) blockers.push('That bill is not on this PO');
      else {
        // Balance of the bill after debit notes, payments and the PO's advances, less payments still in approval.
        const left = r2(getRow('vendor_bills', b.id).balance
          - db.prepare("SELECT COALESCE(SUM(amount),0) v FROM vendor_payments WHERE bill_id = ? AND status IN ('Pending Approval', 'Approved') AND id <> ?").get(b.id, p.id || 0).v);
        if (amt > left + 1) { offTerms = true; notes.push(`More than the balance of bill ${b.bill_no}: ${rs(left)} (after advances already paid on the PO)`); }
        else notes.push(`Bill ${b.bill_no}: balance ${rs(left)} after advances and debit notes`);
        const t = threeWay(p.po_id);
        if (!t.ok && !b.override_by) blockers.push(`3-way check: ${t.note}. Receive the material (GRN), record a debit note, or ask the GM to override on the bill`);
        else notes.push(t.ok ? t.note : `3-way difference overridden by ${b.override_by}`);
      }
    }
  } else {
    const allowed = r2(Math.max(0, m.due_by_terms - m.paid - m.pipeline));
    if (amt > allowed + 1) { offTerms = true; notes.push(`The PO payment terms allow ${rs(allowed)} as advance by now (due within a week: ${rs(m.due_by_terms)}, paid ${rs(m.paid)}, awaiting ${rs(m.pipeline)})`); }
    else notes.push(`Within the PO payment terms (${rs(allowed)} payable by now)`);
    if (m.advance_at_risk > 0) notes.push(`Already paid ${rs(m.advance_at_risk)} more than the material received`);
  }
  return { blockers, notes, offTerms, m };
}

export const needsGm = row => (Number(row.amount) || 0) > limits().approve || row.off_terms === 'Yes';

// Before submitting for approval: payment checks, or the expense PO rule.
export function prepareSubmit(entity, id, user) {
  const row = getRow(entity, id);
  if (!['Draft', 'Rejected'].includes(row.status)) throw new HttpError(400, `Only a Draft can be submitted (this one is ${row.status})`);
  if (entity === 'vendor_payments') {
    const c = checkPayment(row);
    if (c.blockers.length) throw new HttpError(409, c.blockers.join('\n'));
    if (c.offTerms && !String(row.reason || '').trim()) throw new HttpError(400, `This payment is outside the PO terms:\n${c.notes.join('\n')}\n\nWrite the reason in “Why”; it then goes to the GM as well.`);
    updateRow(entity, id, { check_note: c.notes.join('\n'), off_terms: c.offTerms ? 'Yes' : 'No', requested_by: user.name }, user, { system: true });
  } else if (entity === 'expenses') {
    const lim = limits().expense;
    if (!EXPENSE_NO_PO.includes(row.category) && Number(row.amount) > lim) throw new HttpError(409, `${row.category} above ${rs(lim)} needs a purchase order (Purchase → Purchase Orders), not an expense voucher.`);
    updateRow(entity, id, { requested_by: user.name }, user, { system: true });
  }
}

export function markPaid(entity, id, body = {}, user) {
  if (!hasFunction(user.role, 'pay_record')) throw new HttpError(403, 'Your role may not record payments (Roles & Permissions → “mark as paid”)');
  const row = getRow(entity, id);
  if (row.status !== 'Approved') throw new HttpError(400, `Only an approved ${entity === 'expenses' ? 'voucher' : 'payment'} can be paid (this one is ${row.status})`);
  const mode = body.mode || row.mode;
  const ref = String(body.reference || '').trim();
  if (mode !== 'Cash' && !ref) throw new HttpError(400, 'Enter the UTR / cheque no');
  if (ref && db.prepare(`SELECT 1 FROM ${entity} WHERE reference = ? AND id <> ? AND status = 'Paid'`).get(ref, row.id)) throw new HttpError(409, `UTR / cheque no ${ref} is already on another payment`);
  return tx(() => {
    const out = updateRow(entity, id, { status: 'Paid', date: body.date || today(), mode, reference: ref || null, paid_by: user.name }, user, { system: true });
    if (entity === 'vendor_payments') refreshPoPayments(row.po_id);
    audit(user.name, entity, row.id, 'paid', `${rs(row.amount)} ${mode} ${ref}`);
    return out;
  });
}

export function reverse(entity, id, body = {}, user) {
  if (!hasFunction(user.role, 'pay_final')) throw new HttpError(403, 'Only the GM (or an admin) can reverse a payment');
  const row = getRow(entity, id);
  if (row.status !== 'Paid') throw new HttpError(400, 'Only a paid entry can be reversed');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Write the reason for the reversal');
  return tx(() => {
    const out = updateRow(entity, id, { status: 'Reversed', reversed_reason: `${reason} (${user.name}, ${today()})` }, user, { system: true });
    if (entity === 'vendor_payments') refreshPoPayments(row.po_id);
    audit(user.name, entity, row.id, 'reversed', reason);
    return out;
  });
}

export function overrideBill(id, body = {}, user) {
  if (!hasFunction(user.role, 'pay_final')) throw new HttpError(403, 'Only the GM (or an admin) can override the 3-way check');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Write the reason');
  const out = updateRow('vendor_bills', id, { override_by: `${user.name} (${today()})`, override_reason: reason }, user, { system: true });
  audit(user.name, 'vendor_bills', Number(id), '3-way override', reason);
  return out;
}

// ---------------------------------------------------------------- reports
// Per PO (or all): ordered, received, billed, debit notes, paid, pending, payable now, advance at risk, overdue.
export function payables({ vendor_id, project_id } = {}) {
  const where = ["p.status IN ('Approved', 'Sent', 'Partially Received', 'Received', 'Closed')"];
  const args = [];
  if (vendor_id) { where.push('p.vendor_id = ?'); args.push(Number(vendor_id)); }
  if (project_id) { where.push('p.project_id = ?'); args.push(Number(project_id)); }
  const t = today();
  const rows = db.prepare(`SELECT p.id, p.po_no, p.date, p.total, p.vendor_id, v.name vendor, p.project_id, pr.name project FROM purchase_orders p
    LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN projects pr ON pr.id = p.project_id WHERE ${where.join(' AND ')} ORDER BY p.date, p.id`).all(...args).map(p => {
    const m = poMoney(p.id);
    const sched = parse(m.po.payment_schedule, []);
    const unpaidBills = db.prepare(`SELECT b.id, b.bill_no, b.due_date, b.amount - COALESCE((SELECT SUM(d.amount) FROM debit_notes d WHERE d.bill_id = b.id), 0)
      - COALESCE((SELECT SUM(x.amount) FROM vendor_payments x WHERE x.bill_id = b.id AND x.status = 'Paid'), 0) bal FROM vendor_bills b WHERE b.po_id = ?`).all(p.id).filter(b => b.bal > 0.5);
    const dueLines = sched.filter(s => s.status !== 'Paid' && s.due_date).map(s => ({ date: s.due_date, what: s.description, amount: Number(s.amount) || 0 }));
    const nextDue = [...dueLines, ...unpaidBills.filter(b => b.due_date).map(b => ({ date: b.due_date, what: `bill ${b.bill_no}`, amount: b.bal }))].sort((a, b) => a.date.localeCompare(b.date))[0] || null;
    const payableNow = r2(Math.max(0, Math.min(m.received_incl, m.billed) - m.debited - m.paid));
    return { ...p, received: m.received_incl, billed: m.billed, debited: m.debited, paid: m.paid, pipeline: m.pipeline,
      pending_receipt: r2(Math.max(0, p.total - m.received_incl)), to_pay: r2(p.total - m.debited - m.paid), payable_now: payableNow,
      advance_at_risk: m.advance_at_risk, next_due: nextDue, overdue: !!(nextDue && nextDue.date < t) };
  });
  const sum = k => r2(rows.reduce((s, r) => s + (r[k] || 0), 0));
  return { rows, totals: { ordered: sum('total'), received: sum('received'), billed: sum('billed'), debited: sum('debited'), paid: sum('paid'), to_pay: sum('to_pay'),
    payable_now: sum('payable_now'), advance_at_risk: sum('advance_at_risk'), pending_receipt: sum('pending_receipt'), overdue: rows.filter(r => r.overdue).length } };
}

// Vendor ledger: statement of POs (commitments), GRNs, bills, debit notes and payments, with the running payable.
export function vendorLedger(vendorId) {
  const v = getRow('vendors', vendorId);
  const ev = [];
  for (const p of db.prepare("SELECT id, po_no, date, total, status FROM purchase_orders WHERE vendor_id = ? AND status NOT IN ('Draft', 'Rejected', 'Cancelled', 'Archived (old)')").all(v.id))
    ev.push({ date: p.date, kind: 'PO', ref: p.po_no, link: `#/view/purchase_orders/${p.id}`, ordered: p.total, note: p.status });
  for (const g of db.prepare(`SELECT m.date, m.doc_no, p.po_no, p.id pid, SUM(m.qty * COALESCE(m.rate, 0)) * (CASE WHEN p.subtotal > 0 THEN p.total / p.subtotal ELSE 1 END) v
    FROM stock_moves m JOIN purchase_orders p ON p.id = m.po_id WHERE m.type = 'INWARD' AND p.vendor_id = ? GROUP BY m.date, m.doc_no, p.id`).all(v.id))
    ev.push({ date: g.date, kind: 'Material received', ref: `GRN ${g.doc_no || ''} · PO ${g.po_no}`, link: `#/view/purchase_orders/${g.pid}`, received: r2(g.v) });
  for (const b of db.prepare('SELECT b.id, b.bill_no, b.bill_date, b.amount, p.po_no FROM vendor_bills b JOIN purchase_orders p ON p.id = b.po_id WHERE b.vendor_id = ?').all(v.id))
    ev.push({ date: b.bill_date, kind: 'Bill', ref: `${b.bill_no} · PO ${b.po_no}`, link: `#/view/vendor_bills/${b.id}`, bill: b.amount });
  for (const d of db.prepare('SELECT id, dn_no, date, amount, reason FROM debit_notes WHERE vendor_id = ?').all(v.id))
    ev.push({ date: d.date, kind: 'Debit note', ref: `${d.dn_no} · ${d.reason}`, link: `#/view/debit_notes/${d.id}`, debit: d.amount });
  for (const x of db.prepare("SELECT x.id, x.payment_no, x.date, x.amount, x.tds_amount, x.reference, x.mode, p.po_no FROM vendor_payments x JOIN purchase_orders p ON p.id = x.po_id WHERE x.vendor_id = ? AND x.status = 'Paid'").all(v.id))
    ev.push({ date: x.date, kind: 'Payment', ref: `${x.payment_no} · PO ${x.po_no} · ${x.mode} ${x.reference || ''}`, link: `#/view/vendor_payments/${x.id}`, paid: x.amount, tds: x.tds_amount || 0 });
  const order = { PO: 0, 'Material received': 1, Bill: 2, 'Debit note': 3, Payment: 4 };
  ev.sort((a, b) => String(a.date).localeCompare(String(b.date)) || order[a.kind] - order[b.kind]);
  let balance = 0;
  for (const e of ev) { balance = r2(balance + (e.bill || 0) - (e.debit || 0) - (e.paid || 0)); e.balance = balance; }
  const s = k => r2(ev.reduce((t, e) => t + (e[k] || 0), 0));
  const totals = { ordered: s('ordered'), received: s('received'), billed: s('bill'), debited: s('debit'), paid: s('paid'), tds: s('tds') };
  totals.payable = r2(totals.billed - totals.debited - totals.paid);
  totals.advance = r2(Math.max(0, totals.paid - totals.received));
  return { vendor: { id: v.id, name: v.name, gstin: v.gstin, phone: v.phone }, totals, entries: ev };
}

// Payments register: vendor payments and expense vouchers together.
export function register({ from, to, project_id, vendor_id, status } = {}) {
  const f = [], a = [];
  if (from) { f.push('x.date >= ?'); a.push(from); }
  if (to) { f.push('x.date <= ?'); a.push(to); }
  if (project_id) { f.push('x.project_id = ?'); a.push(Number(project_id)); }
  const w = f.length ? 'AND ' + f.join(' AND ') : '';
  const st = status || 'Paid';
  const vp = db.prepare(`SELECT 'payment' type, x.id, x.payment_no no, x.date, v.name party, p.po_no ref, pr.name project, x.kind what, x.amount, x.tds_amount tds, x.net_amount net, x.mode, x.reference, x.status, x.bank_date
    FROM vendor_payments x LEFT JOIN vendors v ON v.id = x.vendor_id LEFT JOIN purchase_orders p ON p.id = x.po_id LEFT JOIN projects pr ON pr.id = x.project_id
    WHERE x.status = ? ${w} ${vendor_id ? 'AND x.vendor_id = ' + Number(vendor_id) : ''}`).all(st, ...a);
  const ex = vendor_id ? [] : db.prepare(`SELECT 'expense' type, x.id, x.voucher_no no, x.date, x.payee party, x.category ref, pr.name project, x.description what, x.amount, 0 tds, x.amount net, x.mode, x.reference, x.status, x.bank_date
    FROM expenses x LEFT JOIN projects pr ON pr.id = x.project_id WHERE x.status = ? ${w}`).all(st, ...a);
  const rows = [...vp, ...ex].sort((p, q) => String(q.date).localeCompare(String(p.date)));
  return { rows, total: r2(rows.reduce((s, r) => s + (r.amount || 0), 0)), net: r2(rows.reduce((s, r) => s + (r.net || 0), 0)), tds: r2(rows.reduce((s, r) => s + (r.tds || 0), 0)) };
}
