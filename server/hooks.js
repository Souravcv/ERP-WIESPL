// Per-module business rules applied on every save: document numbering, totals, derived fields.
import { db, nextSeq, getSettings } from './db.js';
import { quoteTotals, linesTotals } from '../public/js/calc.js';

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
    case 'purchase_orders':
      if (!existing && !row.po_no) row.po_no = docNo('po', date, (n, fy) => `${prefix()}/PO/${fy}/${n}`);
      if ('lines' in row) Object.assign(row, linesTotals(parse(row.lines, [])));
      break;
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
    case 'stock_moves':
      if (row.type && row.type !== 'ADJUST' && row.qty != null) row.qty = Math.abs(row.qty);
      break;
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
