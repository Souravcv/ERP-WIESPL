// Per-module business rules applied on every save: document numbering, totals, derived fields.
import { db, nextSeq, getSettings } from './db.js';
import { quoteTotals, linesTotals, gstTotals } from '../public/js/calc.js';
import { GST_STATE_CODES, MOVE_TYPES } from '../public/js/schema.js';

// Item codes continue the Smart Store numbering (1001, 1002 ...): next = highest numeric code + 1.
export function nextItemCode() {
  const max = db.prepare("SELECT MAX(CAST(code AS INTEGER)) m FROM items WHERE code GLOB '[0-9]*' AND code NOT GLOB '*[^0-9]*'").get().m;
  return String(Math.max(Number(max) || 1000, 1000) + 1);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const prefix = () => getSettings().quote_prefix || 'WIESPL';

function mmyy(date) {
  const [y, m] = (date || today()).split('-');
  return { mm: m, yy: y.slice(2) };
}

// Enquiry register numbering: 01/04/25-26 and WIESPL/01/0425 share one running number per FY.
export function enquiryNumbers(date) {
  const { seq, fy } = nextSeq('enquiry', date);
  const { mm, yy } = mmyy(date);
  return { seq, fy, enquiry_no: `${pad(seq)}/${mm}/${fy}`, quote_ref: `${prefix()}/${pad(seq)}/${mm}${yy}` };
}

function docNo(series, date, fmt) {
  const { seq, fy } = nextSeq(series, date);
  return fmt(pad(seq, 3), fy);
}

const parse = (v, dflt) => {
  if (v == null) return dflt;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return dflt; }
};

export function beforeSave(name, row, existing, user) {
  const date = row.date || existing?.date || today();
  switch (name) {
    case 'enquiries': {
      if (!existing && !row.enquiry_no) Object.assign(row, enquiryNumbers(date));
      const custId = row.customer_id ?? existing?.customer_id;
      if (custId && !(row.hospital_name ?? existing?.hospital_name)) {
        const c = db.prepare('SELECT name, place, district FROM customers WHERE id = ?').get(custId);
        if (c) {
          row.hospital_name = c.name;
          if (!(row.place ?? existing?.place)) row.place = c.place;
          if (!(row.district ?? existing?.district)) row.district = c.district;
        }
      }
      break;
    }
    case 'quotations': {
      if (!existing && !row.quote_no) {
        const enq = row.enquiry_id && db.prepare('SELECT quote_ref FROM enquiries WHERE id = ?').get(row.enquiry_id);
        const base = enq?.quote_ref || enquiryNumbers(date).quote_ref;
        row.revision = row.revision || 0;
        row.quote_no = row.revision ? `${base}-R${row.revision}` : base;
      }
      if ('data' in row || 'gst_rate' in row || 'discount_pct' in row) {
        const data = parse(row.data ?? existing?.data, {});
        const t = quoteTotals(data, row.gst_rate ?? existing?.gst_rate ?? 18, row.discount_pct ?? existing?.discount_pct ?? 0);
        row.basic_total = t.taxable;
        row.gst_amount = t.gst;
        row.grand_total = t.grand;
      }
      break;
    }
    case 'sales_orders':
      if (!existing && !row.so_no) row.so_no = docNo('so', date, (n, fy) => `${prefix()}/SO/${fy}/${n}`);
      break;
    case 'projects':
      if (!existing && !row.code) row.code = docNo('project', row.start_date || date, (n, fy) => `PRJ/${fy}/${n}`);
      break;
    case 'purchase_orders': {
      // WIESPL PO numbering: 008/2025-26, restarting every April.
      if (!existing && !row.po_no) row.po_no = docNo('po', date, (n, fy) => `${n}/20${fy}`);
      const vendorId = row.vendor_id ?? existing?.vendor_id;
      const projectId = row.project_id ?? existing?.project_id;
      if (projectId && !(row.project_note ?? existing?.project_note)) {
        const p = db.prepare('SELECT project_no, code, name FROM projects WHERE id = ?').get(projectId);
        if (p) row.project_note = [p.project_no || p.code, p.name].filter(Boolean).join(' - ');
      }
      if ('lines' in row || 'vendor_id' in row) {
        const lines = parse(row.lines ?? existing?.lines, []);
        const vendorState = vendorId && db.prepare('SELECT state FROM vendors WHERE id = ?').get(vendorId)?.state;
        const t = gstTotals(lines, !vendorState || vendorState === (getSettings().state || 'Maharashtra'));
        Object.assign(row, { subtotal: t.subtotal, tax: t.tax, round_off: t.round_off, total: t.total });
      }
      break;
    }
    case 'requisitions':
      if (!existing && !row.req_no) row.req_no = docNo('requisition', date, (n, fy) => `REQ-${n}/20${fy}`);
      if ((row.project_id ?? existing?.project_id) && !(row.project_name ?? existing?.project_name)) {
        const p = db.prepare('SELECT project_no, name FROM projects WHERE id = ?').get(row.project_id ?? existing.project_id);
        if (p) row.project_name = [p.name, p.project_no].filter(Boolean).join(' – ');
      }
      break;
    case 'items':
      if (!existing && !row.code) row.code = nextItemCode();
      if (row.code && db.prepare('SELECT 1 FROM items WHERE code = ? AND id <> ?').get(row.code, existing?.id ?? 0)) {
        throw Object.assign(new Error(`Item code ${row.code} is already used`), { status: 409 });
      }
      break;
    case 'vendors': {
      const g = String(row.gstin ?? existing?.gstin ?? '').trim().toUpperCase();
      if ('gstin' in row) row.gstin = g || null;
      if (/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}$/.test(g)) {
        if (GST_STATE_CODES[g.slice(0, 2)]) row.state = GST_STATE_CODES[g.slice(0, 2)];
        if (!(row.pan ?? existing?.pan)) row.pan = g.slice(2, 12);
      }
      break;
    }
    case 'invoices': {
      const type = row.type ?? existing?.type ?? 'Tax Invoice';
      if (!existing && !row.invoice_no) {
        row.invoice_no = type === 'Proforma Invoice'
          ? docNo('proforma', date, (n, fy) => `PI/${fy}/${n}`)
          : docNo('invoice', date, (n, fy) => `${prefix()}/${fy}/${n}`);
      }
      if ('lines' in row) Object.assign(row, linesTotals(parse(row.lines, [])));
      break;
    }
    case 'service_tickets':
      if (!existing && !row.ticket_no) row.ticket_no = docNo('service', date, (n, fy) => `SRV/${fy}/${n}`);
      if ((row.status === 'Resolved' || row.status === 'Closed') && !(row.closed_date ?? existing?.closed_date)) row.closed_date = today();
      break;
    case 'material_approvals':
      if (!existing && !row.submittal_no) row.submittal_no = docNo('submittal', row.submitted_date || today(), (n, fy) => `MAS/${fy}/${n}`);
      break;
    case 'payments': {
      const invId = row.invoice_id ?? existing?.invoice_id;
      if (invId && !(row.customer_id ?? existing?.customer_id)) {
        row.customer_id = db.prepare('SELECT customer_id FROM invoices WHERE id = ?').get(invId)?.customer_id;
      }
      break;
    }
    case 'stock_moves': {
      const type = row.type ?? existing?.type;
      if (type && type !== 'ADJUST' && row.qty != null) row.qty = Math.abs(row.qty);
      const itemId = row.item_id ?? existing?.item_id;
      const item = itemId && db.prepare('SELECT uom, rate, hsn, gst_rate FROM items WHERE id = ?').get(itemId);
      if (item) {
        if (!(row.uom ?? existing?.uom)) row.uom = item.uom;
        if ((row.rate ?? existing?.rate) == null) {
          if (type === 'INWARD') throw Object.assign(new Error('Price per piece is required for Inward entries'), { status: 400 });
          row.rate = item.rate ?? 0;
        }
      }
      if (!existing && !row.doc_no && MOVE_TYPES[type]) {
        row.doc_no = docNo(`stock_${type}`, date, (n, fy) => `${n}/20${fy}`);
      }
      if (type === 'TRANSFER' && !(row.from_location ?? existing?.from_location)) row.from_location = 'Store';
      // Inward at a new price updates the item's current price.
      if (type === 'INWARD' && itemId && row.rate > 0) db.prepare('UPDATE items SET rate = ? WHERE id = ?').run(row.rate, itemId);
      break;
    }
  }
  return row;
}

export function refreshInvoiceStatus(invoiceId) {
  const inv = db.prepare('SELECT id, total, status FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 'Cancelled' || inv.status === 'Draft') return;
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
  const status = paid <= 0 ? 'Issued' : paid + 0.5 >= (inv.total || 0) ? 'Paid' : 'Partially Paid';
  if (status !== inv.status) db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
}

// `deleted` is passed when a row was removed (id is null then).
export function afterSave(name, id, user, deleted) {
  if (name === 'payments') {
    const invId = deleted ? deleted.invoice_id : db.prepare('SELECT invoice_id FROM payments WHERE id = ?').get(id)?.invoice_id;
    if (invId) refreshInvoiceStatus(invId);
  }
  if (name === 'invoices' && id) refreshInvoiceStatus(id);
  if (name === 'quotations' && id) {
    // Keep the enquiry register's status in step with its quotation.
    const q = db.prepare('SELECT enquiry_id, status FROM quotations WHERE id = ?').get(id);
    const map = { Sent: 'Quoted', Won: 'Won', Lost: 'Lost' };
    if (q?.enquiry_id && map[q.status]) {
      db.prepare("UPDATE enquiries SET status = ?, quoted_by = COALESCE(quoted_by, ?) WHERE id = ? AND status NOT IN ('Won')")
        .run(map[q.status], user?.name || null, q.enquiry_id);
    }
  }
}
