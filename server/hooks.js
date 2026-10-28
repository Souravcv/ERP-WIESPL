// Per-module business rules applied on every save: document numbering, totals, derived fields.
import { db, nextSeq, getSettings } from './db.js';
import { quoteTotals, linesTotals, gstTotals, poTotals } from '../public/js/calc.js';
import { GST_STATE_CODES, MOVE_TYPES, TDS_SECTIONS, ENTITIES } from '../public/js/schema.js';
import { prefillProduction } from './storeflow.js';
import { parseLatLng, prepLeave, markLeave } from './hr.js';
import { beforeSaveTask, afterSaveTask } from './worktasks.js';
import { applyBaseline } from './schedule.js';
import { afterDispatchPlan, challanToPlan } from './planning.js';

// Item codes continue the Smart Store numbering: finished goods FG001, FG002 …; everything else 1001, 1002 … (highest + 1).
export function nextItemCode(category) {
  if (category === 'Finished Goods') {
    const max = db.prepare("SELECT MAX(CAST(substr(code, 3) AS INTEGER)) m FROM items WHERE code GLOB 'FG[0-9]*' AND substr(code, 3) NOT GLOB '*[^0-9]*'").get().m;
    return 'FG' + String((Number(max) || 0) + 1).padStart(3, '0');
  }
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

// "22+22" → 44, "36" → 36, text without numbers → null
export function qtyFromText(t) {
  const s = String(t ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?(\s*\+\s*\d+(\.\d+)?)*$/.test(s)) return s.split('+').reduce((a, x) => a + Number(x), 0);
  return null;
}

function docNo(series, date, fmt) {
  const { seq, fy } = nextSeq(series, date);
  return fmt(pad(seq, 3), fy);
}

// Requisition / PO lines for several sites: a line from a BOQ takes that BOQ and its project, a line without a site
// takes the document's project. Returns the projects on the lines with a quantity (null when the lines are not saved).
function siteLines(row, existing) {
  if (!('lines' in row)) return null;
  const lines = parse(row.lines, []);
  const head = row.project_id ?? existing?.project_id ?? null;
  const bomOf = db.prepare('SELECT b.id, b.project_id FROM bom_items i JOIN boms b ON b.id = i.bom_id WHERE i.id = ?');
  for (const l of lines) {
    if (l.split?.length) continue; // one line for several projects: the split says which
    if (l.bom_item_id && !l.bom_id) { const b = bomOf.get(Number(l.bom_item_id)); if (b) { l.bom_id = b.id; if (!l.project_id && b.project_id) l.project_id = b.project_id; } }
    if (!l.project_id && head && (l.description || l.item_id)) l.project_id = Number(head);
  }
  row.lines = JSON.stringify(lines);
  return [...new Set(lines.filter(l => Number(l.qty) > 0).flatMap(l => l.split?.length ? l.split.map(s => s.project_id) : [l.project_id]).filter(Boolean).map(Number))];
}

// The same material for several projects becomes one PO line: the total quantity, and "split" says how much is
// for each project (shown on the internal copy, used to book the GRN to each project). Only while the PO is a draft.
function mergeProjects(lines) {
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const keyOf = l => `${l.item_id ? 'i' + l.item_id : 'd' + norm(l.description) + '|' + norm(String(l.spec || '').split('\n')[0])}|${norm(l.uom)}`;
  const out = [], byKey = new Map();
  for (const l of lines) {
    if (!(Number(l.qty) > 0) || Number(l.received) > 0 || !(l.description || l.item_id)) { out.push(l); continue; }
    const parts = l.split?.length ? l.split.map(s => ({ ...s })) : [{ project_id: l.project_id ? Number(l.project_id) : null, site: l.site || null, qty: Number(l.qty) }];
    const m = byKey.get(keyOf(l));
    if (m) { m.qty = Math.round((Number(m.qty) + Number(l.qty)) * 1000) / 1000; m.split.push(...parts); continue; }
    const c = { ...l, split: parts };
    byKey.set(keyOf(l), c);
    out.push(c);
  }
  const names = new Map(db.prepare('SELECT id, name FROM projects').all().map(p => [p.id, p.name]));
  for (const m of byKey.values()) {
    const by = new Map();
    for (const s of m.split) { const k = s.project_id || 's:' + (s.site || ''); const x = by.get(k); if (x) x.qty += Number(s.qty) || 0; else by.set(k, { ...s, qty: Number(s.qty) || 0 }); }
    m.split = [...by.values()];
    if (m.split.length <= 1) { const one = m.split[0]; delete m.split; if (one?.project_id) m.project_id = one.project_id; continue; }
    m.project_id = null;
    m.site = m.split.map(s => `${String(names.get(s.project_id) || s.site || 'stock').trim()}: ${s.qty}`).join(', ');
  }
  return out;
}
const siteNames = ids => db.prepare(`SELECT name, project_no FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(p => p.name).join(', ');

// date + n months (− 1 day for "end of period")
function addMonths(d, n, dayShift = 0) {
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(x.getTime())) return null;
  x.setMonth(x.getMonth() + n);
  x.setDate(x.getDate() + dayShift);
  return x.toLocaleString('sv-SE').slice(0, 10);
}
// Service report / RCA: hospital, customer and contact from the complaint (or the AMC) when not typed.
function fillFromTicket(row, existing, entity) {
  const tid = row.ticket_id ?? existing?.ticket_id;
  const t = tid && db.prepare('SELECT hospital, customer_id, contact_person, contact_no, amc_id FROM service_tickets WHERE id = ?').get(Number(tid));
  const a = (row.amc_id ?? existing?.amc_id ?? t?.amc_id) && db.prepare('SELECT hospital, customer_id, contact_person, mobile, email FROM amc_contracts WHERE id = ?').get(Number(row.amc_id ?? existing?.amc_id ?? t?.amc_id));
  const src = t || a;
  if (!src) return;
  if (!(row.hospital ?? existing?.hospital)) row.hospital = src.hospital;
  if (!(row.customer_id ?? existing?.customer_id) && src.customer_id) row.customer_id = src.customer_id;
  if (entity === 'service_reports' && !(row.amc_id ?? existing?.amc_id) && t?.amc_id) row.amc_id = t.amc_id;
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
    case 'dispatch_plans':
      if (!existing && !row.plan_no) row.plan_no = docNo('dispatch_plan', date, (n, fy) => `DP-${n}/20${fy}`);
      if (!existing && !row.planned_by) row.planned_by = user?.name || null;
      if (row.status === 'Dispatched' && existing?.status !== 'Dispatched' && !(row.dispatched_on ?? existing?.dispatched_on)) row.dispatched_on = new Date().toLocaleString('sv-SE').slice(0, 10);
      break;
    case 'projects':
      if (!existing && !row.code) row.code = docNo('project', row.start_date || date, (n, fy) => `PRJ/${fy}/${n}`);
      break;
    case 'purchase_orders': {
      // WIESPL PO numbering: 008/2025-26, restarting every April.
      if (!existing && !row.po_no) row.po_no = docNo('po', date, (n, fy) => `${n}/20${fy}`);
      const sites = siteLines(row, existing);
      if ('lines' in row && (!existing || ['Draft', 'Rejected'].includes(existing.status))) row.lines = JSON.stringify(mergeProjects(parse(row.lines, [])));
      if (sites?.length > 1) { row.project_id = null; row.project_note = `Multiple sites: ${siteNames(sites)}`; }
      else if (sites?.length === 1 && !(row.project_id ?? existing?.project_id)) row.project_id = sites[0];
      const vendorId = row.vendor_id ?? existing?.vendor_id;
      const projectId = row.project_id ?? existing?.project_id;
      if (projectId && !(row.project_note ?? existing?.project_note)) {
        const p = db.prepare('SELECT project_no, code, name FROM projects WHERE id = ?').get(projectId);
        if (p) row.project_note = [p.project_no || p.code, p.name].filter(Boolean).join(' - ');
      }
      // Revising a PO with material received: those lines stay where they are and cannot go below what came in.
      if (existing && existing.status === 'Draft' && 'lines' in row) {
        const oldL = parse(existing.lines, []), newL = parse(row.lines, []);
        oldL.forEach((o, i) => {
          const rec = Number(o.received) || 0;
          if (!rec) return;
          const n = newL[i];
          const name = o.description || o.spec || `line ${i + 1}`;
          const bad = msg => Object.assign(new Error(`${String(name).split('\n')[0]}: ${rec} already received, ${msg}`), { status: 400 });
          if (!n || (o.item_id && Number(n.item_id) !== Number(o.item_id))) throw bad('so this line cannot be removed or moved. Add new lines below the existing ones.');
          if (Number(n.qty) < rec - 1e-9) throw bad('the quantity cannot be less than that');
          if (Number(n.received || 0) !== rec) { n.received = rec; }
        });
        row.lines = typeof row.lines === 'string' ? JSON.stringify(newL) : newL;
      }
      // Totals: items + freight / packing / installation / transport / other charges (taxable), GST by rate.
      const po = { ...(existing || {}), ...row, lines: parse(row.lines ?? existing?.lines, []) };
      const vendor = vendorId && db.prepare('SELECT state, contact_person, phone FROM vendors WHERE id = ?').get(vendorId);
      const t = poTotals(po, !vendor?.state || vendor.state === (getSettings().state || 'Maharashtra'));
      Object.assign(row, { subtotal: t.subtotal, tax: t.tax, round_off: t.round_off, total: t.total, gst_label: t.gst_label || null });
      if (vendor && !(row.vendor_contact ?? existing?.vendor_contact) && vendor.contact_person) row.vendor_contact = vendor.contact_person;
      if (vendor && !(row.vendor_phone ?? existing?.vendor_phone) && vendor.phone) row.vendor_phone = vendor.phone;
      // Payment schedule: amount from the % of the PO total; "With PO" is due on the PO date.
      if ('payment_schedule' in row || 'lines' in row || 'date' in row) {
        const sched = parse(row.payment_schedule ?? existing?.payment_schedule, []);
        let changed = false;
        for (const p of sched) {
          if ((p.amount == null || p.amount === '') && Number(p.percent) > 0) { p.amount = Math.round(t.total * Number(p.percent) / 100 * 100) / 100; changed = true; }
          if (p.trigger === 'With PO' && !p.due_date) { p.due_date = row.date || existing?.date || today(); changed = true; }
        }
        if (changed) row.payment_schedule = JSON.stringify(sched);
      }
      break;
    }
    case 'vendor_bills':
    case 'vendor_payments':
    case 'debit_notes': {
      const poId = row.po_id ?? existing?.po_id;
      const po = poId && db.prepare('SELECT vendor_id, project_id, payment_schedule FROM purchase_orders WHERE id = ?').get(poId);
      // Vendor and project always follow the PO.
      if (po) { row.vendor_id = po.vendor_id; if (name !== 'debit_notes') row.project_id = po.project_id || null; }
      const billId = row.bill_id ?? existing?.bill_id;
      if (name !== 'vendor_bills' && billId) {
        const b = db.prepare('SELECT po_id FROM vendor_bills WHERE id = ?').get(billId);
        if (b && poId && b.po_id !== Number(poId)) throw Object.assign(new Error('That vendor bill belongs to another PO'), { status: 400 });
      }
      if (name === 'vendor_bills') {
        // The same vendor invoice number cannot be entered twice.
        const no = String(row.bill_no ?? existing?.bill_no ?? '').trim();
        const dup = no && db.prepare('SELECT b.id, p.po_no FROM vendor_bills b LEFT JOIN purchase_orders p ON p.id = b.po_id WHERE lower(trim(b.bill_no)) = lower(?) AND b.vendor_id = ? AND b.id <> ?').get(no, row.vendor_id ?? existing?.vendor_id, existing?.id ?? 0);
        if (dup) throw Object.assign(new Error(`Invoice ${no} of this vendor is already entered (PO ${dup.po_no || ''})`), { status: 409 });
        // Bill due date: the PO's next payment still due.
        if (po && !(row.due_date ?? existing?.due_date)) row.due_date = parse(po.payment_schedule, []).filter(p => p.status !== 'Paid' && p.due_date).map(p => p.due_date).sort()[0] || null;
      }
      if (name === 'debit_notes' && !existing && !row.dn_no) row.dn_no = docNo('debit_note', date, (n, fy) => `DN-${n}/20${fy}`);
      if (name === 'vendor_payments') {
        if (!existing && !row.payment_no) row.payment_no = docNo('payment', date, (n, fy) => `PAY-${n}/20${fy}`);
        // TDS: rate from the section unless typed; net = gross − TDS.
        const section = row.tds_section ?? existing?.tds_section ?? '';
        if ('tds_section' in row && (row.tds_rate == null || row.tds_rate === '') && TDS_SECTIONS[section] != null) row.tds_rate = TDS_SECTIONS[section] || null;
        const amount = Number(row.amount ?? existing?.amount) || 0, rate = section ? Number(row.tds_rate ?? existing?.tds_rate) || 0 : 0;
        row.tds_amount = Math.round(amount * rate) / 100;
        row.net_amount = Math.round((amount - row.tds_amount) * 100) / 100;
      }
      break;
    }
    case 'expenses':
      if (!existing && !row.voucher_no) row.voucher_no = docNo('expense', date, (n, fy) => `EXP-${n}/20${fy}`);
      break;
    case 'boqs':
      if (!existing && !row.boq_no) row.boq_no = docNo('boq', date, (n, fy) => `WO-${n}/20${fy}`);
      if ((row.project_id ?? existing?.project_id) && !(row.customer_id ?? existing?.customer_id)) {
        row.customer_id = db.prepare('SELECT customer_id FROM projects WHERE id = ?').get(row.project_id ?? existing.project_id)?.customer_id || null;
      }
      break;
    case 'boms': {
      if (!existing && !row.bom_no) row.bom_no = docNo('bom', date, (n, fy) => `BOQ-${n}/20${fy}`);
      const woId = row.work_order_id ?? existing?.work_order_id;
      if (woId && !(row.project_id ?? existing?.project_id)) row.project_id = db.prepare('SELECT project_id FROM boqs WHERE id = ?').get(woId)?.project_id || null;
      const pid = row.project_id ?? existing?.project_id;
      if (!(row.customer_id ?? existing?.customer_id) && (pid || woId)) {
        row.customer_id = (pid && db.prepare('SELECT customer_id FROM projects WHERE id = ?').get(pid)?.customer_id)
          || (woId && db.prepare('SELECT customer_id FROM boqs WHERE id = ?').get(woId)?.customer_id) || null;
      }
      break;
    }
    case 'bom_items':
      // "22+22" in the Qty column counts as 44.
      if ('qty_text' in row && row.qty == null && (existing?.qty == null || 'qty' in row)) row.qty = qtyFromText(row.qty_text);
      break;
    case 'challans': {
      // Delivery challans DC-001/2026-27 …, returnable challans their own series RE-001/2026-27 …
      const returnable = (row.challan_type ?? existing?.challan_type) === 'Returnable';
      const challanNo = () => docNo(returnable ? 'challan_ret' : 'challan', date, (n, fy) => `${returnable ? 'RE' : 'DC'}-${n}/20${fy}`);
      if (!existing && !row.challan_no) row.challan_no = challanNo();
      // A draft switched between returnable and non-returnable gets a number of the right series.
      else if (existing?.status === 'Draft' && 'challan_type' in row && row.challan_type !== existing.challan_type && /^(DC|RE)-/.test(existing.challan_no || '')) row.challan_no = challanNo();
      const vid = row.vendor_id ?? existing?.vendor_id;
      if (vid && !(row.ship_to ?? existing?.ship_to)) {
        const v = db.prepare('SELECT name, address, city, state, pincode, phone FROM vendors WHERE id = ?').get(vid);
        if (v) row.ship_to = [v.name, v.address, [v.city, v.state, v.pincode].filter(Boolean).join(', '), v.phone && `Ph: ${v.phone}`].filter(Boolean).join('\n');
      }
      const mid = row.bom_id ?? existing?.bom_id;
      if (mid && !(row.project_id ?? existing?.project_id)) row.project_id = db.prepare('SELECT project_id FROM boms WHERE id = ?').get(mid)?.project_id || null;
      if (mid && !(row.ship_to ?? existing?.ship_to) && !(row.project_id ?? existing?.project_id)) {
        const bm = db.prepare('SELECT b.client, c.name cname, c.address caddr FROM boms b LEFT JOIN customers c ON c.id = b.customer_id WHERE b.id = ?').get(mid);
        if (bm) row.ship_to = [bm.cname || bm.client, bm.caddr].filter(Boolean).join('\n');
      }
      const bid = row.boq_id ?? existing?.boq_id;
      if (bid && !(row.ship_to ?? existing?.ship_to)) {
        const bq = db.prepare('SELECT b.title, b.project_id, c.name cname, c.address caddr FROM boqs b LEFT JOIN customers c ON c.id = b.customer_id WHERE b.id = ?').get(bid);
        if (bq && !bq.project_id) row.ship_to = [bq.cname || bq.title, bq.caddr].filter(Boolean).join('\n');
      }
      const pid = row.project_id ?? existing?.project_id;
      if (pid && (!(row.ship_to ?? existing?.ship_to) || !(row.customer_id ?? existing?.customer_id))) {
        const p = db.prepare('SELECT p.name, p.site, p.site_address, p.customer_id, c.name cname, c.address caddr FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?').get(pid);
        if (p) {
          if (!(row.customer_id ?? existing?.customer_id) && p.customer_id) row.customer_id = p.customer_id;
          if (!(row.ship_to ?? existing?.ship_to)) row.ship_to = [p.cname || p.name, p.site_address || p.caddr, p.site].filter(Boolean).join('\n');
        }
      }
      break;
    }
    case 'work_tasks':
      beforeSaveTask(row, existing, user, docNo, date);
      break;
    case 'employees':
      if (!existing && !row.emp_code) {
        const max = db.prepare("SELECT MAX(CAST(substr(emp_code, 5) AS INTEGER)) m FROM employees WHERE emp_code LIKE 'EMP-%'").get().m || 0;
        row.emp_code = `EMP-${String(max + 1).padStart(3, '0')}`;
      }
      if ('login' in row) row.login = String(row.login || '').trim() || null;
      if (row.login && db.prepare('SELECT 1 FROM employees WHERE lower(login) = lower(?) AND id <> ?').get(row.login, existing?.id ?? 0)) throw Object.assign(new Error(`Login ${row.login} is already linked to another employee`), { status: 409 });
      break;
    case 'work_locations':
      if (row.maps_link) {
        const ll = parseLatLng(row.maps_link);
        if (!ll) throw Object.assign(new Error('Could not read a position from that link: open the pin in Google Maps and copy the link that shows @lat,lng, or type "18.6201, 73.7447"'), { status: 400 });
        [row.lat, row.lng] = ll;
      }
      break;
    case 'leave_requests':
      if (!existing && !row.leave_no) row.leave_no = docNo('leave', date, (n, fy) => `LV-${n}/20${fy}`);
      prepLeave(row, existing);
      break;
    case 'material_requests':
      if (!existing && !row.mr_no) row.mr_no = docNo('material_request', date, (n, fy) => `MR-${n}/20${fy}`);
      break;
    case 'production_entries': {
      if (!existing && !row.entry_no) row.entry_no = docNo('production', date, (n, fy) => `PRD-${n}/20${fy}`);
      const fg = row.fg_item_id ?? existing?.fg_item_id;
      if (fg && !(row.uom ?? existing?.uom)) row.uom = db.prepare('SELECT uom FROM items WHERE id = ?').get(Number(fg))?.uom || null;
      if (!existing) prefillProduction(row);
      break;
    }
    case 'requisitions': {
      if (!existing && !row.req_no) row.req_no = docNo('requisition', date, (n, fy) => `REQ-${n}/20${fy}`);
      const sites = siteLines(row, existing);
      if (sites?.length > 1) { row.project_id = null; row.project_name = `Multiple sites: ${siteNames(sites)}`; }
      else if (sites?.length === 1 && !(row.project_id ?? existing?.project_id)) row.project_id = sites[0];
      if ((row.project_id ?? existing?.project_id) && !(row.project_name ?? existing?.project_name)) {
        const p = db.prepare('SELECT project_no, name FROM projects WHERE id = ?').get(row.project_id ?? existing.project_id);
        if (p) row.project_name = [p.name, p.project_no].filter(Boolean).join(' – ');
      }
      break;
    }
    case 'items':
      if (!existing && !String(row.code ?? '').trim()) row.code = nextItemCode(row.category);
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
      // A proforma is numbered when made; a tax invoice when it is issued (see receivables.issueInvoice), so drafts
      // leave no gaps in the GST invoice series.
      if (!existing && !row.invoice_no && type === 'Proforma Invoice') row.invoice_no = docNo('proforma', date, (n, fy) => `PI/${fy}/${n}`);
      if (existing?.status === 'Draft' && row.status === 'Issued' && type === 'Tax Invoice' && !existing.invoice_no) row.invoice_no = docNo('invoice', date, (n, fy) => `${prefix()}/${fy}/${n}`);
      const soId = row.sales_order_id ?? existing?.sales_order_id;
      if (!existing && soId) {
        const so = db.prepare('SELECT customer_id, retention_pct FROM sales_orders WHERE id = ?').get(Number(soId));
        if (so) {
          if (!row.customer_id) row.customer_id = so.customer_id;
          if (!(Number(row.retention_pct) > 0) && so.retention_pct > 0) row.retention_pct = so.retention_pct;
          if (!row.project_id) row.project_id = db.prepare('SELECT id FROM projects WHERE sales_order_id = ? ORDER BY id LIMIT 1').get(Number(soId))?.id || null;
        }
      }
      if ('lines' in row) Object.assign(row, linesTotals(parse(row.lines, [])));
      break;
    }
    case 'credit_notes': {
      const err = (m, status = 400) => Object.assign(new Error(m), { status });
      const invId = row.invoice_id ?? existing?.invoice_id;
      const inv = invId && db.prepare('SELECT id, invoice_no, type, status, customer_id, place_of_supply, total, lines FROM invoices WHERE id = ?').get(Number(invId));
      if (!inv) throw err('Choose the invoice the credit note is against');
      if (inv.type !== 'Tax Invoice' || ['Draft', 'Cancelled'].includes(inv.status)) throw err('A credit note goes against an issued tax invoice');
      row.customer_id = inv.customer_id;
      row.place_of_supply = inv.place_of_supply;
      const rate = row.gst_rate ?? existing?.gst_rate;
      if (rate == null || rate === '') row.gst_rate = Number(parse(inv.lines, [])[0]?.gst ?? 18);
      const taxable = Number(row.taxable ?? existing?.taxable) || 0;
      if (!(taxable > 0)) throw err('Enter the taxable value');
      const g = Number(row.gst_rate ?? existing?.gst_rate) || 0;
      row.tax = Math.round(taxable * g) / 100;
      row.total = Math.round((taxable + row.tax) * 100) / 100;
      const other = db.prepare("SELECT COALESCE(SUM(total), 0) v FROM credit_notes WHERE invoice_id = ? AND status IN ('Pending Approval', 'Approved') AND id <> ?").get(inv.id, existing?.id ?? 0).v;
      if (row.total > inv.total - other + 1) throw err(`Credit notes on ${inv.invoice_no} would be more than the invoice (₹${inv.total}; already credited ₹${other})`, 409);
      // Numbered and dated when the GM approves it.
      if ((row.status ?? existing?.status) === 'Approved' && !existing?.cn_no) {
        row.date = today();
        row.cn_no = docNo('credit_note', row.date, (n, fy) => `CN-${n}/20${fy}`);
      }
      break;
    }
    case 'service_tickets': {
      if (!existing && !row.ticket_no) row.ticket_no = docNo('service', date, (n, fy) => `SRV/${fy}/${n}`);
      const cid = row.customer_id ?? existing?.customer_id;
      if (cid && !(row.hospital ?? existing?.hospital)) {
        const c = db.prepare('SELECT name, place FROM customers WHERE id = ?').get(Number(cid));
        if (c) { row.hospital = c.name; if (!(row.city ?? existing?.city)) row.city = c.place || null; }
      }
      const amc = row.amc_id ?? existing?.amc_id;
      if (amc && !(row.hospital ?? existing?.hospital)) row.hospital = db.prepare('SELECT hospital FROM amc_contracts WHERE id = ?').get(Number(amc))?.hospital || null;
      if ((row.status === 'Resolved' || row.status === 'Closed') && !(row.closed_date ?? existing?.closed_date)) row.closed_date = today();
      break;
    }
    case 'amc_contracts': {
      const months = Number(row.warranty_months ?? existing?.warranty_months) || 0;
      const ws = row.warranty_start ?? existing?.warranty_start;
      if (ws && months && !(row.warranty_end ?? existing?.warranty_end)) row.warranty_end = addMonths(ws, months, -1);
      const pc = row.particle_count_date ?? existing?.particle_count_date;
      if (pc && !(row.particle_next ?? existing?.particle_next)) row.particle_next = addMonths(pc, 12, -1);
      // A new AMC period without a visit plan: S1 at the start, then every 12 / n months.
      const start = row.amc_start ?? existing?.amc_start;
      const plan = parse(row.service_plan ?? existing?.service_plan, []);
      const nVis = Number(row.services_covered ?? existing?.services_covered) || 0;
      if (start && nVis > 0 && !plan.length) {
        row.service_plan = JSON.stringify(Array.from({ length: nVis }, (_, k) => ({ visit: `S${k + 1}`, planned: addMonths(start, Math.round(k * 12 / nVis)), done: '', report: '', remark: '' })));
      }
      const cid = row.customer_id ?? existing?.customer_id;
      if (cid && !(row.hospital ?? existing?.hospital)) row.hospital = db.prepare('SELECT name FROM customers WHERE id = ?').get(Number(cid))?.name || null;
      break;
    }
    case 'service_work_orders':
      if (!existing && !row.swo_no) row.swo_no = docNo('swo', date, (n, fy) => `SW/${n}/20${fy}`);
      break;
    case 'service_reports':
      if (!existing && !row.report_no) row.report_no = docNo('service_report', date, (n, fy) => `SR-${n}/20${fy}`);
      fillFromTicket(row, existing, 'service_reports');
      break;
    case 'rca_reports':
      if (!existing && !row.rca_no) row.rca_no = docNo('rca', date, (n, fy) => `RCA-${n}/20${fy}`);
      fillFromTicket(row, existing, 'rca_reports');
      if ((row.ticket_id ?? existing?.ticket_id) && !(row.complaint_details ?? existing?.complaint_details)) {
        const t = db.prepare('SELECT date, complaint FROM service_tickets WHERE id = ?').get(Number(row.ticket_id ?? existing.ticket_id));
        if (t) { row.complaint_details = t.complaint; if (!(row.complaint_date ?? existing?.complaint_date)) row.complaint_date = t.date; }
      }
      break;
    case 'costing_sheets': {
      if (!existing && !row.cs_no) row.cs_no = docNo('costing', date, (n, fy) => `CS-${n}/20${fy}`);
      const v = k => row[k] !== undefined ? row[k] : existing?.[k];
      const kind = v('kind') || 'Sales';
      if (v('margin_pct') == null || v('margin_pct') === '') {
        const s = getSettings();
        row.margin_pct = Number(kind === 'Service' ? s.service_margin_pct ?? 30 : s.sales_margin_pct ?? 20);
      }
      const lines = parse(v('lines'), []);
      const rate = db.prepare('SELECT rate, hsn FROM items WHERE id = ?');
      for (const l of lines) if (l.item_id && (l.cost === '' || l.cost == null)) { const it = rate.get(Number(l.item_id)); l.cost = it?.rate || 0; if (!l.hsn && it?.hsn) l.hsn = it.hsn; }
      if ('lines' in row) row.lines = JSON.stringify(lines);
      const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
      const material = r2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0));
      const visits = r2((Number(v('visit_days')) || 0) * (Number(v('day_rate')) || 0));
      const cost = r2(material + (Number(v('labour')) || 0) + visits + (Number(v('travel')) || 0) + (Number(v('other_cost')) || 0));
      const margin = r2(cost * (Number(v('margin_pct')) || 0) / 100);
      const selling = r2(cost + margin + (Number(v('transport')) || 0));
      const gst = r2(selling * (Number(v('gst_rate') ?? 18) || 0) / 100);
      Object.assign(row, { material_cost: material, cost_total: cost, margin_amount: margin, selling_total: selling, gst_amount: gst, grand_total: r2(selling + gst) });
      const cid = v('customer_id');
      if (cid && !v('hospital')) row.hospital = db.prepare('SELECT name FROM customers WHERE id = ?').get(Number(cid))?.name || null;
      break;
    }
    case 'material_approvals':
      if (!existing && !row.submittal_no) row.submittal_no = docNo('submittal', row.submitted_date || today(), (n, fy) => `MAS/${fy}/${n}`);
      break;
    case 'payments': {
      // Customer receipt. Locked once saved: later changes are only the reversal, bank date and Form 16A flag.
      if (existing) break;
      const err = (m, status = 400) => Object.assign(new Error(m), { status });
      const rs = n => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
      const amount = Number(row.amount) || 0, tds = Number(row.tds_amount) || 0;
      if (!(amount > 0)) throw err('Enter the amount received');
      if (tds < 0) throw err('TDS cannot be negative');
      row.tds_amount = tds || null;
      const inv = row.invoice_id ? db.prepare('SELECT id, invoice_no, type, status, customer_id, sales_order_id, project_id FROM invoices WHERE id = ?').get(Number(row.invoice_id)) : null;
      if (row.invoice_id && !inv) throw err('Invoice not found', 404);
      // Money against a proforma is an advance on its sales order.
      if (inv?.type === 'Proforma Invoice') {
        if (inv.status === 'Cancelled') throw err(`Proforma ${inv.invoice_no} is cancelled`);
        if (!inv.sales_order_id) throw err(`Proforma ${inv.invoice_no} is not on a sales order. Link it to the sales order first: money against a proforma is an advance on the order.`);
        row.kind = 'Advance (against sales order)';
        row.sales_order_id = inv.sales_order_id;
      }
      row.kind ||= 'Against invoice';
      if (row.kind === 'Against invoice') {
        if (!inv) throw err('Choose the invoice this money is against (or “Advance” and the sales order)');
        if (['Draft', 'Cancelled'].includes(inv.status)) throw err(`That invoice is ${inv.status}; money is received against issued invoices`);
        const bal = invoiceMoney(inv.id).balance;
        if (amount + tds > bal + 1) throw err(`${rs(amount + tds)} (amount + TDS) is more than the balance of ${inv.invoice_no}: ${rs(bal)}. Record the extra as an advance against the sales order.`, 409);
        Object.assign(row, { sales_order_id: inv.sales_order_id || null, customer_id: inv.customer_id, project_id: inv.project_id || null });
      } else {
        const so = row.sales_order_id && db.prepare('SELECT id, customer_id, status FROM sales_orders WHERE id = ?').get(Number(row.sales_order_id));
        if (!so) throw err('Choose the sales order the advance is for');
        if (so.status === 'Cancelled') throw err('That sales order is cancelled');
        row.customer_id = so.customer_id;
        row.project_id = db.prepare('SELECT id FROM projects WHERE sales_order_id = ? ORDER BY id LIMIT 1').get(so.id)?.id || null;
        if (!inv) row.invoice_id = null;
      }
      if (!row.customer_id) throw err('Choose the customer');
      row.mode ||= 'NEFT / RTGS';
      const ref = String(row.reference || '').trim();
      row.reference = ref || null;
      if (row.mode !== 'Cash' && !ref) throw err('Enter the UTR / cheque no');
      if (ref && db.prepare("SELECT 1 FROM payments WHERE lower(trim(reference)) = lower(?) AND status = 'Received'").get(ref)) throw err(`UTR / cheque no ${ref} is already on another receipt`, 409);
      if (!row.receipt_no) row.receipt_no = docNo('receipt', date, (n, fy) => `RCT-${n}/20${fy}`);
      Object.assign(row, { status: 'Received', received_by: user?.name || null, bank_date: null, form16a: tds > 0 ? 'No' : null, reversed_reason: null });
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

// One invoice's money, from the computed fields of the invoices module (receipts, credit notes, advances, retention).
const INV_MONEY = ['received', 'tds', 'credited', 'advance_adjusted', 'balance', 'retention_held', 'due_now'];
export function invoiceMoney(id) {
  const cols = ENTITIES.invoices.fields.filter(f => INV_MONEY.includes(f.key)).map(f => `${f.computed.replaceAll('{t}', 't')} AS ${f.key}`);
  return db.prepare(`SELECT t.id, t.invoice_no, t.type, t.status, t.total, t.sales_order_id, t.customer_id, ${cols.join(', ')} FROM invoices t WHERE t.id = ?`).get(Number(id));
}

export function refreshInvoiceStatus(invoiceId) {
  const m = invoiceMoney(invoiceId);
  if (!m || m.status === 'Cancelled' || m.status === 'Draft') return;
  const status = m.balance <= 0.5 ? 'Paid'
    : m.type === 'Tax Invoice' && m.retention_held > 0.5 && m.balance - m.retention_held <= 0.5 ? 'Retention Held'
      : m.received + m.credited + m.advance_adjusted > 0.5 ? 'Partially Paid' : 'Issued';
  if (status !== m.status) db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, m.id);
}

// Advances on a sales order move between its invoices, so a change refreshes every invoice of the order.
export function refreshReceivables({ invoiceId, soId } = {}) {
  const so = soId || (invoiceId && db.prepare('SELECT sales_order_id FROM invoices WHERE id = ?').get(Number(invoiceId))?.sales_order_id);
  const ids = so ? db.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').all(Number(so)).map(r => r.id) : [];
  if (invoiceId && !ids.includes(Number(invoiceId))) ids.push(Number(invoiceId));
  for (const id of ids) refreshInvoiceStatus(id);
}

// Payments made against a PO mark its payment schedule lines Paid, in order, as far as the money goes.
export function refreshPoPayments(poId) {
  const po = db.prepare('SELECT id, total, payment_schedule FROM purchase_orders WHERE id = ?').get(poId);
  if (!po) return;
  const sched = parse(po.payment_schedule, []);
  if (!sched.length) return;
  const pays = db.prepare("SELECT date, amount FROM vendor_payments WHERE po_id = ? AND status = 'Paid' ORDER BY date, id").all(po.id);
  let left = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const last = pays.length ? pays[pays.length - 1].date : null;
  for (const p of sched) {
    if (p.status === 'On hold') continue;
    const amt = Number(p.amount) || (Number(p.percent) > 0 ? Math.round((po.total || 0) * Number(p.percent)) / 100 : 0);
    if (amt > 0 && left + 0.5 >= amt) { left -= amt; if (p.status !== 'Paid') { p.status = 'Paid'; p.paid_on = p.paid_on || last; p.auto_paid = true; } }
    // Only lines this marked Paid go back to Due (a line accounts marked Paid by hand stays Paid).
    else if (p.status === 'Paid' && p.auto_paid) { p.status = 'Due'; p.paid_on = null; delete p.auto_paid; left = 0; }
    else if (amt > 0) left = 0;
  }
  db.prepare('UPDATE purchase_orders SET payment_schedule = ? WHERE id = ?').run(JSON.stringify(sched), po.id);
}

// Material received on a PO (GRN): payments "N days after inward" become due on GRN date + N days.
export function poInwardDues(poId, grnDate) {
  const po = db.prepare('SELECT payment_schedule FROM purchase_orders WHERE id = ?').get(poId);
  const sched = parse(po?.payment_schedule, []);
  let changed = false;
  for (const p of sched) {
    if (p.trigger === 'After inward (GRN)' && !p.due_date) {
      const d = new Date(grnDate + 'T00:00:00'); d.setDate(d.getDate() + (Number(p.days) || 0));
      p.due_date = d.toLocaleString('sv-SE').slice(0, 10);
      p.grn_date = grnDate;
      changed = true;
    }
  }
  if (changed) db.prepare('UPDATE purchase_orders SET payment_schedule = ? WHERE id = ?').run(JSON.stringify(sched), poId);
  return changed;
}

// 3-way note on a PO's bills: bills (less debit notes) against the material received (GRN value incl. GST share).
export function refreshBillNotes(poId) {
  const po = db.prepare('SELECT id, total, subtotal FROM purchase_orders WHERE id = ?').get(Number(poId));
  if (!po) return;
  const one = sql => db.prepare(sql).get(po.id).v || 0;
  const billed = one('SELECT COALESCE(SUM(amount),0) v FROM vendor_bills WHERE po_id = ?');
  if (!billed) return;
  const received = one("SELECT COALESCE(SUM((qty - COALESCE(qc_rejected, 0)) * COALESCE(rate,0)),0) v FROM stock_moves WHERE type = 'INWARD' AND po_id = ?") * (po.subtotal > 0 ? po.total / po.subtotal : 1);
  const net = billed - one('SELECT COALESCE(SUM(amount),0) v FROM debit_notes WHERE po_id = ?');
  const tol = Number(getSettings().bill_tolerance_pct ?? 2) || 0;
  const rs = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const note = net <= received * (1 + tol / 100) + 1 ? `OK: bills ${rs(net)} ≤ received ${rs(received)} (incl. GST)` : `Bills ${rs(net)} are more than the material received ${rs(received)} (incl. GST, +${tol}% allowed)`;
  db.prepare('UPDATE vendor_bills SET match_note = ? WHERE po_id = ?').run(note, po.id);
}

// `deleted` is passed when a row was removed (id is null then).
export function afterSave(name, id, user, deleted) {
  if (['vendor_bills', 'debit_notes', 'stock_moves'].includes(name)) {
    const poId = deleted ? deleted.po_id : db.prepare(`SELECT po_id FROM ${name} WHERE id = ?`).get(id)?.po_id;
    if (poId) refreshBillNotes(poId);
  }
  if (name === 'vendor_payments') {
    const poId = deleted ? deleted.po_id : db.prepare('SELECT po_id FROM vendor_payments WHERE id = ?').get(id)?.po_id;
    if (poId) refreshPoPayments(poId);
  }
  // A project with a work-order number picks up the POs whose note names that work order ("WIESPL / 1015 / 01 …").
  if (name === 'projects' && id) {
    const p = db.prepare('SELECT project_no FROM projects WHERE id = ?').get(id);
    const m = String(p?.project_no || '').match(/(\d{3,5})\s*\/\s*(\d{1,2})\b/);
    if (m) {
      const re = new RegExp(`\\b${m[1]}\\s*\\/\\s*0?${Number(m[2])}\\b`);
      for (const po of db.prepare("SELECT id, project_note FROM purchase_orders WHERE project_id IS NULL AND project_note LIKE ?").all(`%${m[1]}%`)) {
        if (re.test(po.project_note || '')) db.prepare('UPDATE purchase_orders SET project_id = ? WHERE id = ?').run(id, po.id);
      }
    }
  }
  if (name === 'payments') {
    const r = deleted || db.prepare('SELECT invoice_id, sales_order_id FROM payments WHERE id = ?').get(id);
    if (r) refreshReceivables({ invoiceId: r.invoice_id, soId: r.sales_order_id });
  }
  if (name === 'invoices') {
    const r = deleted || db.prepare('SELECT sales_order_id FROM invoices WHERE id = ?').get(id);
    refreshReceivables({ invoiceId: deleted ? null : id, soId: r?.sales_order_id });
  }
  if (name === 'service_reports' && !deleted) {
    const r = db.prepare('SELECT report_no, date, end_date, status, call_type, ticket_id, amc_id, work_done FROM service_reports WHERE id = ?').get(id);
    if (r?.status === 'Completed') {
      if (r.ticket_id) db.prepare("UPDATE service_tickets SET status = 'Closed', closed_date = COALESCE(NULLIF(closed_date, ''), ?), resolution = COALESCE(NULLIF(resolution, ''), ?) WHERE id = ? AND status <> 'Closed'")
        .run(r.end_date || r.date, r.work_done || null, r.ticket_id);
      if (r.amc_id && r.call_type === 'AMC Service Visit') {
        const a = db.prepare('SELECT service_plan FROM amc_contracts WHERE id = ?').get(r.amc_id);
        const plan = parse(a?.service_plan, []);
        if (!plan.some(p => p.report === r.report_no)) {
          const next = plan.filter(p => !p.done).sort((x, y) => String(x.planned || '9999').localeCompare(String(y.planned || '9999')))[0];
          if (next) { next.done = r.end_date || r.date; next.report = r.report_no; }
          else plan.push({ visit: `S${plan.length + 1}`, planned: '', done: r.end_date || r.date, report: r.report_no, remark: 'extra visit' });
          db.prepare('UPDATE amc_contracts SET service_plan = ? WHERE id = ?').run(JSON.stringify(plan), r.amc_id);
        }
      }
    }
  }
  if (name === 'leave_requests' && !deleted) markLeave(id, user);
  if (name === 'work_tasks' && !deleted) afterSaveTask(id, user);
  if (name === 'schedule_baselines' && !deleted) applyBaseline(id, user);
  if (name === 'dispatch_plans' && !deleted) afterDispatchPlan(id, user);
  if (name === 'challans' && !deleted) challanToPlan(id);
  if (name === 'credit_notes') {
    const cn = deleted || db.prepare('SELECT invoice_id, cn_no FROM credit_notes WHERE id = ?').get(id);
    if (cn?.invoice_id) refreshReceivables({ invoiceId: cn.invoice_id });
    if (!deleted && cn?.cn_no) db.prepare("UPDATE approvals SET doc_ref = ? WHERE doc_type = 'Credit Note' AND doc_id = ?").run(cn.cn_no, id);
  }
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
