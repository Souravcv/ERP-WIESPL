import { db, tx, getSettings, audit } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { round2 } from '../public/js/calc.js';

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const APPROVERS = ['admin', 'manager'];

const DOCS = {
  Quotation: { entity: 'quotations', ref: 'quote_no', amount: 'grand_total', title: r => `${r.subject || 'Quotation'} — ${r.customer_id_label || ''}`, settingKey: 'require_quote_approval' },
  'Purchase Order': { entity: 'purchase_orders', ref: 'po_no', amount: 'total', title: r => `PO to ${r.vendor_id_label || ''}`, settingKey: 'require_po_approval' },
};

export function submitForApproval(docType, id, user) {
  const d = DOCS[docType];
  const row = getRow(d.entity, id);
  if (!['Draft', 'Rejected'].includes(row.status)) throw new HttpError(400, `Only Draft or Rejected documents can be submitted (current: ${row.status})`);
  if (getSettings()[d.settingKey] === 'No') {
    return updateRow(d.entity, id, { status: 'Approved', approved_by: `${user.name} (auto)`, ...(d.entity === 'quotations' ? { approved_at: stamp() } : {}) }, user, { system: true });
  }
  return tx(() => {
    const open = db.prepare("SELECT id FROM approvals WHERE doc_type = ? AND doc_id = ? AND status = 'Pending'").get(docType, Number(id));
    if (!open) {
      insertRow('approvals', {
        doc_type: docType, doc_id: Number(id), doc_ref: row[d.ref], title: d.title(row), amount: row[d.amount],
        requested_by: user.name, requested_at: stamp(), status: 'Pending',
      }, user, { system: true });
    }
    return updateRow(d.entity, id, { status: 'Pending Approval' }, user, { system: true });
  });
}

export function decide(approvalId, decision, comments, user) {
  if (!APPROVERS.includes(user.role)) throw new HttpError(403, 'Only a manager or admin can approve');
  if (!['Approved', 'Rejected'].includes(decision)) throw new HttpError(400, 'Decision must be Approved or Rejected');
  const ap = getRow('approvals', approvalId);
  if (ap.status !== 'Pending') throw new HttpError(400, `Already ${ap.status}`);
  const d = DOCS[ap.doc_type];
  return tx(() => {
    updateRow('approvals', approvalId, { status: decision, decided_by: user.name, decided_at: stamp(), comments: comments || ap.comments }, user, { system: true });
    if (d) {
      const patch = { status: decision };
      if (decision === 'Approved') {
        patch.approved_by = user.name;
        if (d.entity === 'quotations') patch.approved_at = stamp();
      }
      updateRow(d.entity, ap.doc_id, patch, user, { system: true });
    }
    return getRow('approvals', approvalId);
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

// Goods receipt against a PO: adds stock IN entries for lines linked to inventory items.
export function receivePurchaseOrder(id, body, user) {
  const po = getRow('purchase_orders', id);
  if (!['Approved', 'Sent', 'Partially Received'].includes(po.status)) throw new HttpError(400, 'PO must be Approved or Sent before receiving goods');
  const receipts = body?.receipts || [];
  const lines = po.lines || [];
  return tx(() => {
    for (const r of receipts) {
      const line = lines[r.index];
      const qty = Number(r.qty);
      if (!line || !(qty > 0)) continue;
      line.received = round2((Number(line.received) || 0) + qty);
      if (line.item_id) {
        insertRow('stock_moves', {
          date: body.date || new Date().toLocaleString('sv-SE').slice(0, 10), item_id: line.item_id, type: 'IN', qty,
          project_id: po.project_id, ref_no: `${po.po_no}${body.challan ? ' / ' + body.challan : ''}`, remarks: `GRN against ${po.po_no}`,
        }, user, { system: true });
        db.prepare('UPDATE items SET rate = ? WHERE id = ?').run(Number(line.rate) || null, line.item_id);
      }
    }
    const all = lines.every(l => (Number(l.received) || 0) >= (Number(l.qty) || 0));
    const any = lines.some(l => (Number(l.received) || 0) > 0);
    const updated = updateRow('purchase_orders', id, { lines, status: all ? 'Received' : any ? 'Partially Received' : po.status }, user, { system: true });
    audit(user.name, 'purchase_orders', id, 'receive', receipts.map(r => `line ${r.index + 1}: ${r.qty}`).join(', '));
    return updated;
  });
}
