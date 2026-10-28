import { db, tx, getSettings, audit } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { round2 } from '../public/js/calc.js';
import { APPROVAL_FLOWS, FUNCTIONS, hasFunction } from '../public/js/schema.js';
import { notify, notifyApprovalRequest, notifyDecision, notifyNew } from './notify.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);

const DOCS = {
  Quotation: { entity: 'quotations', ref: 'quote_no', amount: 'grand_total', title: r => `${r.subject || 'Quotation'} — ${r.customer_id_label || ''}`, settingKey: 'require_quote_approval' },
  'Sales Order': { entity: 'sales_orders', ref: 'so_no', amount: 'total_value', noLines: true, title: r => `Sales order – ${r.customer_id_label || ''}${r.client_po_no ? ' – client PO ' + r.client_po_no : ''}` },
  'Purchase Order': { entity: 'purchase_orders', ref: 'po_no', amount: 'total', title: r => `PO to ${r.vendor_id_label || ''}`, settingKey: 'require_po_approval' },
  Requisition: { entity: 'requisitions', ref: 'req_no', amount: null, title: r => `Requisition – ${r.project_name || r.project_id_label || ''} (${(r.lines || []).length} items)` },
  Payment: { entity: 'vendor_payments', ref: 'payment_no', amount: 'amount', noLines: true,
    title: r => `Pay ${r.vendor_id_label || ''} – PO ${r.po_id_label || ''}${r.off_terms === 'Yes' ? ' – OUTSIDE PO TERMS' : ''}` },
  Expense: { entity: 'expenses', ref: 'voucher_no', amount: 'amount', noLines: true, title: r => `${r.category}: ${r.payee} – ${String(r.description || '').slice(0, 60)}` },
  Leave: { entity: 'leave_requests', ref: 'leave_no', amount: null, noLines: true,
    title: r => `${r.type} – ${r.employee_id_label || ''} – ${r.days} day(s), ${r.from_date}${r.to_date && r.to_date !== r.from_date ? ' to ' + r.to_date : ''}${r.half_day === 'Yes' ? ' (half day)' : ''}${r.balance_note ? ' · ' + r.balance_note : ''} · ${String(r.reason || '').slice(0, 80)}`,
    // HR Policy: the reporting manager approves leave (HR, with the leave approval right, can too).
    alsoBy: r => db.prepare('SELECT reporting_to FROM employees WHERE id = ?').get(r.employee_id)?.reporting_to || null },
  'Schedule Baseline': { entity: 'schedule_baselines', ref: 'rev', amount: null, noLines: true, title: r => `Project schedule baseline ${r.rev} – ${r.project_id_label || ''}${r.finish ? ' – finish ' + r.finish : ''}` },
  'Credit Note': { entity: 'credit_notes', ref: 'cn_no', amount: 'total', noLines: true, title: r => `Credit note to ${r.customer_id_label || ''} on ${r.invoice_id_label || ''} – ${r.reason}` },
};
// Payments / expenses: the GM step only above the approval limit or outside the PO terms.
const gmNeeded = (docType, row) => {
  const lim = Number(getSettings().payment_approval_limit ?? 50000) || 50000;
  return (Number(row.amount) || 0) > lim || row.off_terms === 'Yes';
};
const STAGED = ['purchase_orders', 'vendor_payments', 'expenses', 'credit_notes', 'sales_orders', 'leave_requests', 'schedule_baselines'];

export function canApprove(docType, stage, user, ap = null) {
  const step = (APPROVAL_FLOWS[docType] || []).find(s => s.stage === stage) || (APPROVAL_FLOWS[docType] || [])[0];
  return !!step && (hasFunction(user.role, step.fn) || (!!ap?.also_by && ap.also_by === user.name));
}

function openStep(docType, docId, row, stepIndex, user, requestedBy = user.name) {
  const d = DOCS[docType];
  const step = APPROVAL_FLOWS[docType][stepIndex];
  const alsoBy = d.alsoBy?.(row) || null;
  const ap = insertRow('approvals', {
    doc_type: docType, doc_id: Number(docId), doc_ref: row[d.ref] || `draft #${docId}`, stage: step.stage, title: d.title(row),
    amount: d.amount ? row[d.amount] : null, requested_by: requestedBy, requested_at: stamp(), status: 'Pending', also_by: alsoBy !== requestedBy ? alsoBy : null,
  }, user, { system: true });
  notifyApprovalRequest(ap, user);
  if (ap.also_by) notify({ userNames: [ap.also_by], kind: 'approval', title: `Approval needed: ${docType} ${ap.doc_ref || ''}`, body: `${ap.title} · requested by ${requestedBy}`, link: `#/view/approvals/${ap.id}` }, user);
  return step;
}

export function submitForApproval(docType, id, user) {
  const d = DOCS[docType];
  const row = getRow(d.entity, id);
  if (docType === 'Purchase Order' && row.vendor_id) {
    const v = db.prepare('SELECT name, vendor_status, blacklist_reason FROM vendors WHERE id = ?').get(row.vendor_id);
    if (v?.vendor_status === 'Blacklisted') throw new HttpError(409, `${v.name} is blacklisted (${v.blacklist_reason || 'see the vendor'}): choose another vendor`);
  }
  if (!['Draft', 'Rejected'].includes(row.status)) throw new HttpError(400, `Only Draft or Rejected documents can be submitted (current: ${row.status})`);
  if (docType !== 'Quotation' && !d.noLines && !(row.lines || []).some(l => Number(l.qty) > 0)) throw new HttpError(400, 'Add at least one line with a quantity first');
  const flow = APPROVAL_FLOWS[docType];
  if (d.settingKey && getSettings()[d.settingKey] === 'No') {
    const patch = { status: 'Approved', approved_by: `${user.name} (auto)` };
    if (d.entity === 'quotations') patch.approved_at = stamp();
    if (d.entity === 'purchase_orders') patch.approval_stage = null;
    return updateRow(d.entity, id, patch, user, { system: true });
  }
  return tx(() => {
    db.prepare("UPDATE approvals SET status = 'Rejected', comments = COALESCE(comments, 'Superseded by resubmission') WHERE doc_type = ? AND doc_id = ? AND status = 'Pending'").run(docType, Number(id));
    const step = openStep(docType, id, row, 0, user);
    const patch = { status: docType === 'Requisition' ? 'Submitted' : 'Pending Approval' };
    if (d.entity === 'purchase_orders') Object.assign(patch, { approval_stage: step.stage, purchase_approved_by: null, tech_approved_by: null, comm_approved_by: null, approved_by: null });
    if (d.noLines) Object.assign(patch, { approval_stage: step.stage, approved_by: null });
    return updateRow(d.entity, id, patch, user, { system: true });
  });
}

export function decide(approvalId, decision, comments, user) {
  if (!['Approved', 'Rejected'].includes(decision)) throw new HttpError(400, 'Decision must be Approved or Rejected');
  const ap = getRow('approvals', approvalId);
  if (ap.status !== 'Pending') throw new HttpError(400, `Already ${ap.status}`);
  if (!canApprove(ap.doc_type, ap.stage, user, ap)) {
    const step = (APPROVAL_FLOWS[ap.doc_type] || []).find(s => s.stage === ap.stage) || (APPROVAL_FLOWS[ap.doc_type] || [])[0];
    throw new HttpError(403, `Your role is not allowed to give “${ap.stage || 'this'}” approval (${FUNCTIONS[step?.fn] || 'approval'}). An admin can allow it under Roles & Permissions.`);
  }
  const d = DOCS[ap.doc_type];
  // Maker-checker: a payment or expense is approved by someone other than the person who prepared it.
  if (d?.noLines && ap.requested_by === user.name && user.role !== 'admin') throw new HttpError(403, `You prepared this ${ap.doc_type.toLowerCase()}; someone else has to approve it`);
  if (ap.doc_type === 'Purchase Order' && ap.stage === 'Commercial' && decision === 'Approved') {
    const po = getRow('purchase_orders', ap.doc_id);
    if ((po.lines || []).some(l => Number(l.qty) > 0 && !(Number(l.rate) > 0))) throw new HttpError(400, `Open PO ${po.po_no} and enter the prices in its Commercial step before approving`);
  }
  return tx(() => {
    updateRow('approvals', approvalId, { status: decision, decided_by: user.name, decided_at: stamp(), comments: comments || ap.comments }, user, { system: true });
    if (!d) return getRow('approvals', approvalId);
    const flow = APPROVAL_FLOWS[ap.doc_type];
    const idx = Math.max(0, flow.findIndex(s => s.stage === ap.stage));
    const step = flow[idx];
    if (decision === 'Rejected') {
      updateRow(d.entity, ap.doc_id, { status: 'Rejected', ...(STAGED.includes(d.entity) ? { approval_stage: null } : {}) }, user, { system: true });
      notifyDecision({ ...ap, comments }, decision, true, user);
      return getRow('approvals', approvalId);
    }
    const patch = {};
    if (d.entity === 'purchase_orders') patch[step.field] = `${user.name} (${stamp()})`;
    if (d.noLines) patch.approved_by = [getRow(d.entity, ap.doc_id).approved_by, `${user.name} (${ap.stage}, ${stamp()})`].filter(Boolean).join(' · ');
    const moreSteps = idx + 1 < flow.length && (!d.noLines || gmNeeded(ap.doc_type, getRow(d.entity, ap.doc_id)));
    if (moreSteps) {
      const row = getRow(d.entity, ap.doc_id);
      // The next step is still the original requester's request, so the final decision reaches them.
      const next = openStep(ap.doc_type, ap.doc_id, row, idx + 1, user, ap.requested_by || user.name);
      patch.approval_stage = next.stage;
    } else {
      patch.status = 'Approved';
      // A revised PO with material already in: back to partly received (or closed when everything is in).
      if (d.entity === 'purchase_orders') {
        const lines = (getRow(d.entity, ap.doc_id).lines || []).filter(l => Number(l.qty) > 0);
        if (lines.some(l => Number(l.received) > 0)) patch.status = lines.every(l => Number(l.received) >= Number(l.qty) - 1e-9) ? 'Closed' : 'Partially Received';
      }
      if (STAGED.includes(d.entity)) patch.approval_stage = null;
      if (d.entity !== 'purchase_orders' && !d.noLines) patch.approved_by = user.name;
      if (d.entity === 'quotations' || d.entity === 'requisitions') patch.approved_at = stamp();
    }
    updateRow(d.entity, ap.doc_id, patch, user, { system: true });
    notifyDecision({ ...ap, comments }, decision, !moreSteps, user);
    return getRow('approvals', approvalId);
  });
}

// Approved requisition → draft PO for the chosen vendor (lines carry over with item prices).
export function requisitionToPO(id, body, user) {
  const r = getRow('requisitions', id);
  if (r.status !== 'Approved') throw new HttpError(400, 'Only an approved requisition can be converted to a PO');
  if (!body?.vendor_id) throw new HttpError(400, 'Choose a vendor');
  const itemStmt = db.prepare('SELECT name, code, hsn, rate, gst_rate, uom FROM items WHERE id = ?');
  const lines = (r.lines || []).filter(l => Number(l.qty) > 0).map(l => {
    const it = l.item_id ? itemStmt.get(l.item_id) : null;
    return {
      item_id: l.item_id || null, description: l.description || it?.name || '', hsn: it?.hsn || '', spec: l.spec || '',
      qty: Number(l.qty), uom: l.uom || it?.uom || 'Nos', rate: it?.rate || 0, gst: it?.gst_rate ?? 18,
      ...(l.bom_item_id ? { bom_item_id: l.bom_item_id } : {}), ...(l.bom_id ? { bom_id: l.bom_id } : {}), ...(l.project_id ? { project_id: l.project_id } : {}), ...(l.site ? { site: l.site } : {}),
      ...(l.split?.length ? { split: l.split.map(s => ({ ...s })) } : {}),
    };
  });
  return tx(() => {
    const po = insertRow('purchase_orders', {
      vendor_id: Number(body.vendor_id), project_id: r.project_id, project_note: r.project_id ? undefined : r.project_name || undefined, requisition_id: r.id, bom_id: r.bom_id || null, lines, status: 'Draft', prepared_by: user.name,
    }, user, { system: true });
    updateRow('requisitions', id, { status: 'Converted to PO' }, user, { system: true });
    notifyNew('purchase_orders', po, user);
    return po;
  });
}

export function quotationFromEnquiry(enquiryId, user) {
  const e = getRow('enquiries', enquiryId);
  const s = getSettings();
  const cust = e.customer_id ? getRow('customers', e.customer_id) : null;
  const toAddress = [e.doctor_name, e.hospital_name || cust?.name, cust?.address, [e.place, e.district].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  return tx(() => {
    const q = insertRow('quotations', {
      enquiry_id: e.id, customer_id: e.customer_id, to_address: toAddress, subject: s.default_subject,
      status: 'Draft', gst_rate: 18, discount_pct: 0, prepared_by: user.name,
      data: { rooms: [], lines: [], optionals: [], terms: s.terms, client_scope: s.client_scope, scope_matrix: s.scope_matrix, letter_intro: s.letter_intro, boq_title: 'WIESPL ESTIMATE FOR LAMINAR AIR FLOW, CONTROL PANEL WITH MODULAR OT - PPGL' },
    }, user, { system: true });
    if (['New', '', null].includes(e.status)) db.prepare("UPDATE enquiries SET status = 'In Process' WHERE id = ?").run(e.id);
    return q;
  });
}

export function reviseQuotation(id, user) {
  const q = getRow('quotations', id);
  const base = q.quote_no.replace(/-R\d+$/, '');
  const maxRev = db.prepare("SELECT MAX(revision) m FROM quotations WHERE quote_no = ? OR quote_no LIKE ?").get(base, `${base}-R%`).m || 0;
  return tx(() => {
    const copy = insertRow('quotations', {
      enquiry_id: q.enquiry_id, customer_id: q.customer_id, to_address: q.to_address, subject: q.subject, date: new Date().toLocaleString('sv-SE').slice(0, 10),
      gst_rate: q.gst_rate, discount_pct: q.discount_pct, data: q.data, status: 'Draft', prepared_by: user.name,
      revision: maxRev + 1, quote_no: `${base}-R${maxRev + 1}`,
    }, user, { system: true });
    if (!['Won', 'Lost'].includes(q.status)) updateRow('quotations', id, { status: 'Superseded' }, user, { system: true });
    return copy;
  });
}

export function convertToSalesOrder(id, body, user) {
  const q = getRow('quotations', id);
  if (!['Approved', 'Sent', 'Won'].includes(q.status)) throw new HttpError(400, 'Quotation must be Approved or Sent before converting to a Sales Order');
  if (!q.customer_id) throw new HttpError(400, 'Link the quotation to a customer first');
  const existing = db.prepare('SELECT id FROM sales_orders WHERE quotation_id = ?').get(q.id);
  if (existing) throw new HttpError(409, 'A Sales Order already exists for this quotation');
  return tx(() => {
    const so = insertRow('sales_orders', {
      customer_id: q.customer_id, quotation_id: q.id, enquiry_id: q.enquiry_id,
      client_po_no: body?.client_po_no || null, client_po_date: body?.client_po_date || null,
      order_value: q.basic_total, gst_rate: q.gst_rate, status: 'Draft',
    }, user, { system: true });
    updateRow('quotations', id, { status: 'Won' }, user, { system: true });
    return so;
  });
}

export function projectFromSalesOrder(soId, user) {
  const so = getRow('sales_orders', soId);
  const cust = getRow('customers', so.customer_id);
  return insertRow('projects', {
    name: `${cust.name}${cust.place ? ' - ' + cust.place : ''}`, customer_id: so.customer_id, sales_order_id: so.id,
    site_address: cust.address, start_date: new Date().toLocaleString('sv-SE').slice(0, 10), stage: 'Drawing Preparation', status: 'Active', progress: 0,
  }, user, { system: true });
}

// Commercial step of a PO: prices, GST, payment terms and the payment schedule (due dates) are entered here,
// while the PO waits for this step. Approving the step then makes the PO Approved.
export function poCommercial(id, body, user) {
  const po = getRow('purchase_orders', id);
  if (po.status !== 'Pending Approval' || po.approval_stage !== 'Commercial') throw new HttpError(400, 'Prices and payment terms are entered when the PO is at the Commercial step');
  if (!canApprove('Purchase Order', 'Commercial', user)) throw new HttpError(403, 'Your role is not allowed to do the commercial step of POs');
  const lines = (po.lines || []).map((l, i) => {
    const c = (body?.lines || [])[i];
    if (!c) return l;
    return { ...l, ...(c.rate !== undefined && c.rate !== '' ? { rate: Number(c.rate) } : {}), ...(c.gst !== undefined && c.gst !== '' ? { gst: Number(c.gst) } : {}) };
  });
  const patch = { lines };
  for (const k of ['term_advance', 'term_balance', 'term_delivery', 'term_freight', 'term_validity', 'quotation_ref', 'remarks',
    'freight_charges', 'packing_charges', 'installation_charges', 'transport_charges', 'other_charges', 'other_charges_label', 'charges_gst']) if (body?.[k] !== undefined) patch[k] = body[k];
  if (Array.isArray(body?.payment_schedule)) patch.payment_schedule = body.payment_schedule.filter(p => p.due_date || p.amount || p.percent || p.description || p.trigger === 'After inward (GRN)');
  return updateRow('purchase_orders', id, patch, user, { system: true });
}

// An approved / sent / partly received PO changes only through Revise: back to Draft as the next revision, then the
// approvals again. Material already received stays on its lines; after approval the PO is "Partially Received" again.
export function revisePO(id, user) {
  const po = getRow('purchase_orders', id);
  if (!['Approved', 'Sent', 'Partially Received'].includes(po.status)) throw new HttpError(400, `Only an approved, sent or partly received PO is revised (this one is ${po.status})`);
  return tx(() => {
    db.prepare("UPDATE approvals SET status = 'Rejected', comments = COALESCE(comments, 'Superseded by revision') WHERE doc_type = 'Purchase Order' AND doc_id = ? AND status = 'Pending'").run(Number(id));
    const out = updateRow('purchase_orders', po.id, { status: 'Draft', revision: (Number(po.revision) || 0) + 1, approval_stage: null, approved_by: null,
      purchase_approved_by: null, tech_approved_by: null, comm_approved_by: null }, user, { system: true });
    audit(user.name, 'purchase_orders', po.id, `revised to Rev. ${out.revision}`, `was ${po.status}, total ${po.total}`);
    return out;
  });
}
