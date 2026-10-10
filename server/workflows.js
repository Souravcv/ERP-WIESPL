import { db, tx, getSettings, audit } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { round2 } from '../public/js/calc.js';
import { APPROVAL_FLOWS, FUNCTIONS, hasFunction } from '../public/js/schema.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);

const DOCS = {
  Quotation: { entity: 'quotations', ref: 'quote_no', amount: 'grand_total', title: r => `${r.subject || 'Quotation'} — ${r.customer_id_label || ''}`, settingKey: 'require_quote_approval' },
  'Purchase Order': { entity: 'purchase_orders', ref: 'po_no', amount: 'total', title: r => `PO to ${r.vendor_id_label || ''}`, settingKey: 'require_po_approval' },
  Requisition: { entity: 'requisitions', ref: 'req_no', amount: null, title: r => `Requisition – ${r.project_name || r.project_id_label || ''} (${(r.lines || []).length} items)` },
};

export function canApprove(docType, stage, user) {
  const step = (APPROVAL_FLOWS[docType] || []).find(s => s.stage === stage) || (APPROVAL_FLOWS[docType] || [])[0];
  return !!step && hasFunction(user.role, step.fn);
}

function openStep(docType, docId, row, stepIndex, user) {
  const d = DOCS[docType];
  const step = APPROVAL_FLOWS[docType][stepIndex];
  insertRow('approvals', {
    doc_type: docType, doc_id: Number(docId), doc_ref: row[d.ref], stage: step.stage, title: d.title(row),
    amount: d.amount ? row[d.amount] : null, requested_by: user.name, requested_at: stamp(), status: 'Pending',
  }, user, { system: true });
  return step;
}

export function submitForApproval(docType, id, user) {
  const d = DOCS[docType];
  const row = getRow(d.entity, id);
  if (!['Draft', 'Rejected'].includes(row.status)) throw new HttpError(400, `Only Draft or Rejected documents can be submitted (current: ${row.status})`);
  if (docType !== 'Quotation' && !(row.lines || []).some(l => Number(l.qty) > 0)) throw new HttpError(400, 'Add at least one line with a quantity first');
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
    if (d.entity === 'purchase_orders') Object.assign(patch, { approval_stage: step.stage, tech_approved_by: null, comm_approved_by: null, approved_by: null });
    return updateRow(d.entity, id, patch, user, { system: true });
  });
}

export function decide(approvalId, decision, comments, user) {
  if (!['Approved', 'Rejected'].includes(decision)) throw new HttpError(400, 'Decision must be Approved or Rejected');
  const ap = getRow('approvals', approvalId);
  if (ap.status !== 'Pending') throw new HttpError(400, `Already ${ap.status}`);
  if (!canApprove(ap.doc_type, ap.stage, user)) {
    const step = (APPROVAL_FLOWS[ap.doc_type] || []).find(s => s.stage === ap.stage) || (APPROVAL_FLOWS[ap.doc_type] || [])[0];
    throw new HttpError(403, `Your role is not allowed to give “${ap.stage || 'this'}” approval (${FUNCTIONS[step?.fn] || 'approval'}). An admin can allow it under Roles & Permissions.`);
  }
  const d = DOCS[ap.doc_type];
  return tx(() => {
    updateRow('approvals', approvalId, { status: decision, decided_by: user.name, decided_at: stamp(), comments: comments || ap.comments }, user, { system: true });
    if (!d) return getRow('approvals', approvalId);
    const flow = APPROVAL_FLOWS[ap.doc_type];
    const idx = Math.max(0, flow.findIndex(s => s.stage === ap.stage));
    const step = flow[idx];
    if (decision === 'Rejected') {
      updateRow(d.entity, ap.doc_id, { status: 'Rejected', ...(d.entity === 'purchase_orders' ? { approval_stage: null } : {}) }, user, { system: true });
      return getRow('approvals', approvalId);
    }
    const patch = {};
    if (d.entity === 'purchase_orders') patch[step.field] = `${user.name} (${stamp()})`;
    if (idx + 1 < flow.length) {
      const row = getRow(d.entity, ap.doc_id);
      const next = openStep(ap.doc_type, ap.doc_id, row, idx + 1, user);
      patch.approval_stage = next.stage;
    } else {
      patch.status = 'Approved';
      if (d.entity === 'purchase_orders') patch.approval_stage = null;
      if (d.entity !== 'purchase_orders') patch.approved_by = user.name;
      if (d.entity === 'quotations' || d.entity === 'requisitions') patch.approved_at = stamp();
    }
    updateRow(d.entity, ap.doc_id, patch, user, { system: true });
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
    };
  });
  return tx(() => {
    const po = insertRow('purchase_orders', {
      vendor_id: Number(body.vendor_id), project_id: r.project_id, requisition_id: r.id, lines, status: 'Draft', prepared_by: user.name,
    }, user, { system: true });
    updateRow('requisitions', id, { status: 'Converted to PO' }, user, { system: true });
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
      order_value: q.basic_total, gst_rate: q.gst_rate, status: 'Open',
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

// Milestone billing, e.g. 50% advance / 45% before dispatch / 5% on installation.
export function invoiceFromSalesOrder(soId, body, user) {
  const so = getRow('sales_orders', soId);
  const pct = Number(body?.percent) || 100;
  if (pct <= 0 || pct > 100) throw new HttpError(400, 'Percent must be between 1 and 100');
  const project = db.prepare('SELECT id FROM projects WHERE sales_order_id = ? ORDER BY id LIMIT 1').get(so.id);
  const cust = getRow('customers', so.customer_id);
  return insertRow('invoices', {
    type: body?.type === 'Proforma Invoice' ? 'Proforma Invoice' : 'Tax Invoice',
    customer_id: so.customer_id, sales_order_id: so.id, project_id: project?.id || null, status: 'Draft',
    place_of_supply: cust.state || 'Maharashtra', notes: getSettings().invoice_terms || '',
    lines: [{ description: body?.description || `${pct}% of order value against ${so.so_no}${so.client_po_no ? ' / PO ' + so.client_po_no : ''}`, hsn: '', qty: 1, uom: 'Lot', rate: round2((so.order_value || 0) * pct / 100), gst: so.gst_rate ?? 18 }],
  }, user, { system: true });
}
