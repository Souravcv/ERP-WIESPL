// Receivables: invoices raised against the sales order's billing milestones, issued (numbered in date order, locked),
// money received against them with the TDS the customer deducted, advances on the order adjusted against its invoices,
// retention held until its date, credit notes approved by the GM; ageing and the customer statement.
import { db, tx, audit } from './db.js';
import { getRow, listRows, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction, canWrite } from '../public/js/schema.js';
import { invoiceMoney } from './hooks.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const rs = n => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const fmt = d => (d ? d.split('-').reverse().join('-') : '');
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + (Number(n) || 0)); return x.toLocaleString('sv-SE').slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const LIVE_TAX = "type = 'Tax Invoice' AND status NOT IN ('Draft', 'Cancelled')";
export const SO_APPROVED = ['Approved', 'In Execution', 'Completed'];

// ---------------------------------------------------------------- sales order billing
// The order's milestones with the invoices raised against each.
export function soBilling(soId) {
  const so = getRow('sales_orders', soId);
  const inv = db.prepare("SELECT id, invoice_no, type, status, milestone_no, total, date FROM invoices WHERE sales_order_id = ? AND status <> 'Cancelled' ORDER BY date, id").all(so.id);
  const milestones = (so.milestones || []).map((m, i) => ({ ...m, no: i + 1, amount: r2((so.total_value || 0) * (Number(m.percent) || 0) / 100),
    invoices: inv.filter(x => x.milestone_no === i + 1).map(x => ({ id: x.id, no: x.invoice_no || `Draft #${x.id}`, type: x.type, status: x.status, total: x.total })) }));
  return { so: { id: so.id, so_no: so.so_no, order_value: so.order_value, total_value: so.total_value, gst_rate: so.gst_rate, invoiced: so.invoiced, to_invoice: so.to_invoice,
    received: so.received, receivable: so.receivable, retention_pct: so.retention_pct, payment_terms: so.payment_terms }, milestones,
    pct_total: (so.milestones || []).reduce((s, m) => s + (Number(m.percent) || 0), 0) };
}

// Draft invoice for one milestone (or a custom % / amount, e.g. a running bill).
export function invoiceFromSalesOrder(soId, body = {}, user) {
  const so = getRow('sales_orders', soId);
  if (!SO_APPROVED.includes(so.status)) throw new HttpError(400, `Sales order ${so.so_no} is ${so.status}; invoices are made once the GM has approved it`);
  const type = body.type === 'Proforma Invoice' ? 'Proforma Invoice' : 'Tax Invoice';
  let basic, desc, milestone = null, milestoneNo = null;
  const n = Number(body.milestone_no) || 0;
  if (n) {
    const m = (so.milestones || [])[n - 1];
    if (!m) throw new HttpError(400, 'Milestone not found on the sales order');
    const pct = Number(m.percent) || 0;
    if (!(pct > 0)) throw new HttpError(400, `Milestone “${m.description}” has no %`);
    if (type === 'Tax Invoice') {
      const done = db.prepare(`SELECT COALESCE(invoice_no, 'Draft #' || id) no FROM invoices WHERE sales_order_id = ? AND milestone_no = ? AND type = 'Tax Invoice' AND status <> 'Cancelled'`).get(so.id, n);
      if (done) throw new HttpError(409, `Milestone “${m.description}” already has tax invoice ${done.no}. For a further bill choose “Running bill / other”.`);
    }
    basic = r2((so.order_value || 0) * pct / 100);
    desc = `${m.description} – ${pct}% of order value`;
    milestone = m.description; milestoneNo = n;
  } else if (Number(body.amount) > 0) {
    basic = r2(body.amount);
    desc = 'Running bill';
    milestone = body.description ? String(body.description).slice(0, 80) : 'Running bill';
  } else {
    const pct = Number(body.percent) || 0;
    if (pct <= 0 || pct > 100) throw new HttpError(400, 'Choose a milestone, or enter a % (1–100) or an amount');
    basic = r2((so.order_value || 0) * pct / 100);
    desc = `${pct}% of order value`;
    milestone = body.description ? String(body.description).slice(0, 80) : `${pct}%`;
  }
  if (!(basic > 0)) throw new HttpError(400, 'The sales order has no order value');
  const cust = getRow('customers', so.customer_id);
  const project = db.prepare('SELECT id FROM projects WHERE sales_order_id = ? ORDER BY id LIMIT 1').get(so.id);
  const ref = `against ${so.so_no}${so.client_po_no ? ' / client PO ' + so.client_po_no : ''}`;
  return insertRow('invoices', {
    type, customer_id: so.customer_id, sales_order_id: so.id, project_id: project?.id || null, status: 'Draft',
    milestone, milestone_no: milestoneNo, retention_pct: type === 'Tax Invoice' ? so.retention_pct || 0 : 0,
    place_of_supply: cust.state || 'Maharashtra', notes: body.notes || '',
    lines: [{ description: `${body.description && n ? body.description + ' – ' : ''}${desc} ${ref}`, hsn: body.hsn || '', qty: 1, uom: 'Lot', rate: basic, gst: so.gst_rate ?? 18 }],
  }, user, { system: true });
}

// ---------------------------------------------------------------- invoice actions
export function issueInvoice(id, user) {
  if (!canWrite('invoices', user.role)) throw new HttpError(403, 'No permission to issue invoices');
  const inv = getRow('invoices', id);
  if (inv.status !== 'Draft') throw new HttpError(400, `This invoice is already ${inv.status}`);
  if (!(inv.lines || []).some(l => Number(l.qty) > 0 && Number(l.rate) > 0) || !(inv.total > 0)) throw new HttpError(400, 'Add at least one line with a quantity and rate');
  if (inv.date > today()) throw new HttpError(400, 'An invoice cannot be issued with a future date');
  const cust = getRow('customers', inv.customer_id);
  const so = inv.sales_order_id ? getRow('sales_orders', inv.sales_order_id) : null;
  if (inv.type === 'Tax Invoice') {
    const last = db.prepare("SELECT MAX(date) d FROM invoices WHERE type = 'Tax Invoice' AND invoice_no IS NOT NULL AND status <> 'Draft'").get().d;
    if (last && inv.date < last) throw new HttpError(409, `The invoice date ${fmt(inv.date)} is before the last issued tax invoice (${fmt(last)}). Invoice numbers go in date order: change the date to ${fmt(last)} or later.`);
    if (so && so.invoiced + inv.total > so.total_value + 1) throw new HttpError(409, `This invoice would make the invoiced total ${rs(so.invoiced + inv.total)}, more than the order value incl. GST ${rs(so.total_value)} on ${so.so_no}. Amend the sales order first.`);
    if (inv.milestone_no) {
      const dup = db.prepare("SELECT invoice_no FROM invoices WHERE sales_order_id = ? AND milestone_no = ? AND type = 'Tax Invoice' AND status NOT IN ('Draft', 'Cancelled') AND id <> ?").get(inv.sales_order_id, inv.milestone_no, inv.id);
      if (dup) throw new HttpError(409, `Milestone “${inv.milestone}” is already invoiced in ${dup.invoice_no}`);
    }
  }
  const patch = { status: 'Issued', issued_by: `${user.name} (${stamp()})` };
  if (!inv.due_date) {
    const m = so && inv.milestone_no ? (so.milestones || [])[inv.milestone_no - 1] : null;
    const days = m && m.days !== '' && m.days != null ? Number(m.days) : (cust.credit_days ?? 30);
    patch.due_date = addDays(inv.date, days);
  }
  if (inv.type === 'Tax Invoice' && Number(inv.retention_pct) > 0) {
    patch.retention_amount = r2(inv.total * Number(inv.retention_pct) / 100);
    if (!inv.retention_due) patch.retention_due = addDays(inv.date, so?.retention_days ?? 365);
  } else patch.retention_amount = null;
  return tx(() => {
    const out = updateRow('invoices', id, patch, user, { system: true });
    audit(user.name, 'invoices', inv.id, 'issued', `${out.invoice_no} ${rs(out.total)}`);
    return out;
  });
}

export function cancelInvoice(id, body = {}, user) {
  if (!hasFunction(user.role, 'pay_final')) throw new HttpError(403, 'Only the GM (or an admin) can cancel an issued invoice');
  const inv = getRow('invoices', id);
  if (inv.status === 'Draft') throw new HttpError(400, 'A draft is not cancelled; delete it');
  if (inv.status === 'Cancelled') throw new HttpError(400, 'Already cancelled');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Write the reason');
  if (db.prepare("SELECT 1 FROM payments WHERE invoice_id = ? AND status = 'Received'").get(inv.id)) throw new HttpError(409, 'Money is received against this invoice; it cannot be cancelled (reverse the receipt first, or make a credit note)');
  if (db.prepare("SELECT 1 FROM credit_notes WHERE invoice_id = ? AND status IN ('Pending Approval', 'Approved')").get(inv.id)) throw new HttpError(409, 'Credit notes are made against this invoice; it cannot be cancelled');
  return tx(() => {
    const out = updateRow('invoices', id, { status: 'Cancelled', cancel_reason: `${reason} (${user.name}, ${today()})` }, user, { system: true });
    audit(user.name, 'invoices', inv.id, 'cancelled', reason);
    return out;
  });
}

// ---------------------------------------------------------------- receipts
export function reverseReceipt(id, body = {}, user) {
  if (!hasFunction(user.role, 'pay_final')) throw new HttpError(403, 'Only the GM (or an admin) can reverse a receipt');
  const row = getRow('payments', id);
  if (row.status !== 'Received') throw new HttpError(400, 'Only a received entry can be reversed');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Write the reason for the reversal (e.g. cheque bounced)');
  return tx(() => {
    const out = updateRow('payments', id, { status: 'Reversed', reversed_reason: `${reason} (${user.name}, ${today()})` }, user, { system: true });
    audit(user.name, 'payments', row.id, 'reversed', reason);
    return out;
  });
}

export function form16aReceived(id, user) {
  if (!canWrite('payments', user.role)) throw new HttpError(403, 'No permission');
  const row = getRow('payments', id);
  if (!(row.tds_amount > 0)) throw new HttpError(400, 'No TDS on this receipt');
  const out = updateRow('payments', id, { form16a: 'Yes' }, user, { system: true });
  audit(user.name, 'payments', row.id, 'Form 16A received', '');
  return out;
}

export function prepareCreditNote(id, user) {
  const cn = getRow('credit_notes', id);
  if (!['Draft', 'Rejected'].includes(cn.status)) throw new HttpError(400, `Only a Draft can be submitted (this one is ${cn.status})`);
  updateRow('credit_notes', id, { requested_by: user.name }, user, { system: true });
}

// ---------------------------------------------------------------- reports
const bucketOf = days => (days <= 0 ? 'not_due' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p');
const BUCKETS = ['not_due', 'd30', 'd60', 'd90', 'd90p'];

// Unadjusted advances per customer: advances on their sales orders less what the invoices already took.
function advancesByCustomer(customerId) {
  const rows = db.prepare(`SELECT p.customer_id, SUM(p.amount + COALESCE(p.tds_amount, 0)) v FROM payments p WHERE p.kind = 'Advance (against sales order)' AND p.status = 'Received'
    ${customerId ? 'AND p.customer_id = ' + Number(customerId) : ''} GROUP BY p.customer_id`).all();
  const out = {};
  for (const r of rows) {
    const used = listRows('invoices', { customer_id: r.customer_id, type: 'Tax Invoice' }).filter(i => !['Draft', 'Cancelled'].includes(i.status)).reduce((s, i) => s + (i.advance_adjusted || 0), 0);
    out[r.customer_id] = r2(Math.max(0, r.v - used));
  }
  return out;
}

export function ageing({ customer_id, project_id } = {}) {
  const t = today();
  const q = { type: 'Tax Invoice', ...(customer_id ? { customer_id } : {}), ...(project_id ? { project_id } : {}) };
  const inv = listRows('invoices', q).filter(i => !['Draft', 'Cancelled'].includes(i.status) && i.balance > 0.5);
  const adv = advancesByCustomer(customer_id);
  const by = {};
  const blank = (id, name) => ({ customer_id: id, customer: name, not_due: 0, d30: 0, d60: 0, d90: 0, d90p: 0, retention: 0, retention_due: 0, advance: 0, total: 0, invoices: [] });
  for (const i of inv) {
    const c = by[i.customer_id] ||= blank(i.customer_id, i.customer_id_label);
    const due = i.due_date || i.date;
    const overdueDays = daysBetween(due, t);
    const held = r2(i.balance - i.due_now);   // retention not yet due
    const retDue = i.retention_held > 0 && i.retention_due && i.retention_due <= t ? i.retention_held : 0;
    const b = bucketOf(overdueDays);
    c[b] = r2(c[b] + i.due_now);
    c.retention = r2(c.retention + held);
    c.retention_due = r2(c.retention_due + retDue);
    c.total = r2(c.total + i.balance);
    c.invoices.push({ id: i.id, invoice_no: i.invoice_no, date: i.date, due_date: due, milestone: i.milestone, total: i.total, balance: i.balance, due_now: i.due_now,
      retention_held: held, days: overdueDays, bucket: b, status: i.status, so: i.sales_order_id_label });
  }
  for (const [cid, v] of Object.entries(adv)) {
    if (!(v > 0.5)) continue;
    const c = by[cid] ||= blank(Number(cid), db.prepare('SELECT name FROM customers WHERE id = ?').get(Number(cid))?.name);
    c.advance = v;
  }
  const customers = Object.values(by).map(c => ({ ...c, net: r2(c.total - c.advance), overdue: r2(c.d30 + c.d60 + c.d90 + c.d90p) }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  const sum = k => r2(customers.reduce((s, c) => s + (c[k] || 0), 0));
  return { as_of: t, customers, totals: Object.fromEntries([...BUCKETS, 'retention', 'retention_due', 'advance', 'total', 'net', 'overdue'].map(k => [k, sum(k)])) };
}

// Statement of account: invoices (+), credit notes (−), receipts (− amount and TDS), running balance.
export function customerStatement(customerId, { from, to } = {}) {
  const c = getRow('customers', customerId);
  const ev = [];
  for (const i of db.prepare(`SELECT id, invoice_no, date, total, milestone, due_date FROM invoices WHERE customer_id = ? AND ${LIVE_TAX}`).all(c.id))
    ev.push({ date: i.date, kind: 'Invoice', ref: `${i.invoice_no}${i.milestone ? ' · ' + i.milestone : ''}`, link: `#/view/invoices/${i.id}`, debit: i.total, due: i.due_date });
  for (const n of db.prepare(`SELECT c.id, c.cn_no, c.date, c.total, c.reason, i.invoice_no FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id WHERE c.customer_id = ? AND c.status = 'Approved'`).all(c.id))
    ev.push({ date: n.date, kind: 'Credit note', ref: `${n.cn_no} · ${n.reason} · ${n.invoice_no}`, link: `#/view/credit_notes/${n.id}`, credit: n.total });
  for (const p of db.prepare(`SELECT p.id, p.receipt_no, p.date, p.amount, p.tds_amount, p.mode, p.reference, p.kind, i.invoice_no, s.so_no FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN sales_orders s ON s.id = p.sales_order_id WHERE p.customer_id = ? AND p.status = 'Received'`).all(c.id)) {
    const against = p.kind === 'Against invoice' ? p.invoice_no : `advance ${p.so_no || ''}`;
    ev.push({ date: p.date, kind: 'Receipt', ref: `${p.receipt_no} · ${against} · ${p.mode} ${p.reference || ''}`.trim(), link: `#/view/payments/${p.id}`, credit: r2(p.amount + (p.tds_amount || 0)), tds: p.tds_amount || 0 });
  }
  const order = { Invoice: 0, 'Credit note': 1, Receipt: 2 };
  ev.sort((a, b) => String(a.date).localeCompare(String(b.date)) || order[a.kind] - order[b.kind]);
  let opening = 0;
  const shown = [];
  let bal = 0;
  for (const e of ev) {
    bal = r2(bal + (e.debit || 0) - (e.credit || 0));
    if (from && e.date < from) { opening = bal; continue; }
    if (to && e.date > to) continue;
    shown.push({ ...e, balance: bal });
  }
  const s = k => r2(shown.reduce((t, e) => t + (e[k] || 0), 0));
  const a = ageing({ customer_id: c.id }).customers[0] || null;
  return { customer: { id: c.id, name: c.name, gstin: c.gstin, pan: c.pan, address: c.address, state: c.state, phone: c.phone, credit_days: c.credit_days },
    from: from || null, to: to || today(), opening, entries: shown,
    totals: { invoiced: s('debit'), credited: s('credit'), tds: s('tds'), closing: shown.length ? shown[shown.length - 1].balance : opening },
    ageing: a && { not_due: a.not_due, d30: a.d30, d60: a.d60, d90: a.d90, d90p: a.d90p, retention: a.retention, advance: a.advance, overdue: a.overdue } };
}

// Receipts register (and the TDS-by-customer register when tds_only).
export function receiptsRegister({ from, to, customer_id, project_id, status, tds_only } = {}) {
  const f = ['p.status = ?'], a = [status || 'Received'];
  if (from) { f.push('p.date >= ?'); a.push(from); }
  if (to) { f.push('p.date <= ?'); a.push(to); }
  if (customer_id) { f.push('p.customer_id = ?'); a.push(Number(customer_id)); }
  if (project_id) { f.push('p.project_id = ?'); a.push(Number(project_id)); }
  if (tds_only === '1' || tds_only === true) f.push('p.tds_amount > 0');
  const rows = db.prepare(`SELECT p.id, p.receipt_no, p.date, c.name customer, c.pan, p.kind, i.invoice_no, s.so_no, pr.name project, p.amount, p.tds_section, p.tds_amount, p.mode, p.reference,
      p.bank_date, p.form16a, p.status FROM payments p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN sales_orders s ON s.id = p.sales_order_id LEFT JOIN projects pr ON pr.id = p.project_id WHERE ${f.join(' AND ')} ORDER BY p.date DESC, p.id DESC`).all(...a);
  const sum = k => r2(rows.reduce((t, r) => t + (r[k] || 0), 0));
  return { rows, totals: { amount: sum('amount'), tds: sum('tds_amount'), settled: r2(sum('amount') + sum('tds_amount')),
    form16a_pending: rows.filter(r => r.tds_amount > 0 && r.form16a !== 'Yes').length } };
}

// Sales side of one project: order, invoiced, credit notes, received, outstanding, retention, unadjusted advance.
export function projectSales(project) {
  const soId = project.sales_order_id || 0;
  const so = soId ? db.prepare("SELECT order_value FROM sales_orders WHERE id = ? AND status <> 'Cancelled'").get(soId) : null;
  const inv = db.prepare(`SELECT id FROM invoices WHERE (project_id = ? OR (sales_order_id = ? AND ? > 0)) AND ${LIVE_TAX}`).all(project.id, soId, soId).map(r => invoiceMoney(r.id));
  const received = db.prepare("SELECT COALESCE(SUM(amount + COALESCE(tds_amount, 0)), 0) v FROM payments WHERE status = 'Received' AND (project_id = ? OR (sales_order_id = ? AND ? > 0))").get(project.id, soId, soId).v;
  const s = k => r2(inv.reduce((t, i) => t + (i[k] || 0), 0));
  const invoiced = s('total'), credited = s('credited');
  return { order_value: so?.order_value || 0, invoiced, credited, received: r2(received), outstanding: s('balance'), due_now: s('due_now'), retention: s('retention_held'),
    advance: r2(Math.max(0, received - (invoiced - credited - s('balance')))) };
}
