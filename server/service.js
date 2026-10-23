// Service: work orders to the store, AMC proforma invoices, the service dashboard and the imports of the complaint and
// AMC / warranty registers. Costing sheets: lines into a quotation (sales) or a proforma invoice (service).
import ExcelJS from 'exceljs';
import { db, tx, audit, getSettings } from './db.js';
import { getRow, insertRow, updateRow, listRows, HttpError } from './crud.js';
import { canWrite } from '../public/js/schema.js';
import { submitMR } from './storeflow.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };

// ---------------------------------------------------------------- service work order → material request to the store
export function swoToStore(id, user) {
  if (!canWrite('service_work_orders', user.role) || !canWrite('material_requests', user.role)) throw new HttpError(403, 'No permission');
  const w = getRow('service_work_orders', id);
  if (w.mr_id) throw new HttpError(409, 'Already sent to the store');
  const lines = (w.lines || []).filter(l => Number(l.qty) > 0 && (l.item_id || l.description));
  if (!lines.length) throw new HttpError(400, 'Add the parts with quantities first');
  return tx(() => {
    const site = [w.hospital, w.location].filter(Boolean).join(', ');
    const mr = insertRow('material_requests', {
      department: 'Service', purpose: 'Service work', site, requested_by: user.name, swo_id: w.id, status: 'Draft',
      remarks: [`Service work order ${w.swo_no}`, w.additional_details].filter(Boolean).join(' – '),
      lines: lines.map(l => ({ item_id: l.item_id || null, description: l.description, spec: l.make || '', qty: Number(l.qty), uom: l.uom || 'Nos', site, remark: l.remark || '' })),
    }, user, { system: true });
    submitMR(mr.id, user);
    const out = updateRow('service_work_orders', id, { mr_id: mr.id, status: 'Sent to Store' }, user, { system: true });
    audit(user.name, 'service_work_orders', w.id, 'sent to store', mr.mr_no);
    return { swo: out, request: getRow('material_requests', mr.id) };
  });
}

// A customer for a hospital typed in a service register: the CRM customer of that name, else a new one.
function customerFor(name, extra = {}, user) {
  const n = String(name || '').trim();
  if (!n) throw new HttpError(400, 'Enter the hospital / customer name');
  const hit = db.prepare('SELECT id FROM customers WHERE lower(trim(name)) = lower(?)').get(n);
  if (hit) return hit.id;
  return insertRow('customers', { name: n, category: 'Hospital', place: extra.city || null, state: extra.state || 'Maharashtra', contact_person: extra.contact || null, phone: extra.phone || null, email: extra.email || null, address: extra.address || null }, user, { system: true }).id;
}

// Proforma invoice for the AMC (amount in the register is incl. GST; SAC 9954 as on the WIESPL PI).
export function amcPI(id, user) {
  if (!canWrite('amc_contracts', user.role)) throw new HttpError(403, 'No permission');
  const a = getRow('amc_contracts', id);
  if (!(a.amc_amount > 0)) throw new HttpError(400, 'Enter the AMC amount first');
  const fmt = d => (d ? d.split('-').reverse().join('/') : '');
  return tx(() => {
    const customer_id = a.customer_id || customerFor(a.hospital, { city: a.city, state: a.state, contact: a.contact_person, phone: a.mobile, email: a.email, address: a.address }, user);
    if (!a.customer_id) updateRow('amc_contracts', id, { customer_id }, user, { system: true });
    const inv = insertRow('invoices', {
      type: 'Proforma Invoice', customer_id, status: 'Draft', place_of_supply: a.state || 'Maharashtra', milestone: 'AMC',
      notes: 'Payment should be 100% advance with P.O.',
      lines: [{ description: `AMC of ${a.system_details || 'system'}${a.amc_start ? `\nPeriod ${fmt(a.amc_start)} – ${fmt(a.amc_end)}` : ''}`, hsn: '9954', qty: 1, uom: 'No', rate: r2(a.amc_amount / 1.18), gst: 18 }],
    }, user, { system: true });
    audit(user.name, 'amc_contracts', a.id, 'proforma', inv.invoice_no);
    return inv;
  });
}

// ---------------------------------------------------------------- costing sheets
const sellRate = (cost, pct) => r2((Number(cost) || 0) * (1 + (Number(pct) || 0) / 100));
// Selling lines of a costing sheet: material at cost + company %, labour / visits / travel / other the same, transport at cost.
export function sellingLines(cs) {
  const pct = cs.margin_pct;
  const out = (cs.lines || []).filter(l => Number(l.qty) > 0).map(l => ({ item_id: l.item_id || null, description: l.description || '', hsn: l.hsn || '', qty: Number(l.qty), uom: l.uom || 'Nos', rate: sellRate(l.cost, pct) }));
  const visits = r2((Number(cs.visit_days) || 0) * (Number(cs.day_rate) || 0));
  const service = cs.kind === 'Service';
  if (Number(cs.labour) > 0) out.push({ description: service ? 'Service charges' : 'Installation, testing & commissioning', hsn: '9954', qty: 1, uom: 'Lot', rate: sellRate(cs.labour, pct) });
  if (visits > 0) out.push({ description: `Engineer visit – ${cs.visit_days} man-day(s)`, hsn: '9987', qty: Number(cs.visit_days), uom: 'Day', rate: sellRate(cs.day_rate, pct) });
  if (Number(cs.travel) > 0) out.push({ description: 'Travel & lodging', hsn: '9964', qty: 1, uom: 'Lot', rate: sellRate(cs.travel, pct) });
  if (Number(cs.other_cost) > 0) out.push({ description: 'Other charges', hsn: '', qty: 1, uom: 'Lot', rate: sellRate(cs.other_cost, pct) });
  if (Number(cs.transport) > 0) out.push({ description: `Transportation to site${cs.site ? ' – ' + cs.site : ''}`, hsn: '9965', qty: 1, uom: 'Lot', rate: r2(cs.transport) });
  return out;
}

// Sales: append the selling lines to a Draft quotation (quantities in its first room).
export function costingToQuotation(id, quotationId, user) {
  if (!canWrite('quotations', user.role)) throw new HttpError(403, 'No permission to change quotations');
  const cs = getRow('costing_sheets', id);
  const q = getRow('quotations', quotationId);
  if (q.status !== 'Draft') throw new HttpError(409, `Quotation ${q.quote_no} is ${q.status}; only a Draft quotation can be changed (Revise it first)`);
  const data = typeof q.data === 'string' ? JSON.parse(q.data || '{}') : q.data || {};
  data.rooms ||= [];
  if (!data.rooms.length) data.rooms.push({ id: 'r' + Date.now().toString(36), name: 'Supply' });
  const room = data.rooms[0].id;
  data.lines ||= [];
  const stamp = Date.now().toString(36);
  data.lines.push({ id: `h${stamp}`, kind: 'heading', name: cs.title, description: `${cs.title} (costing ${cs.cs_no})`, qty: {} });
  sellingLines(cs).forEach((l, i) => data.lines.push({ id: `l${stamp}${i}`, kind: 'item', name: l.description.split('\n')[0].slice(0, 80), description: l.description, uom: l.uom,
    rate: l.rate, install: 0, basis: 'manual', qty: { [room]: l.qty }, gst: cs.gst_rate ?? 18, hsn: l.hsn }));
  return tx(() => {
    updateRow('quotations', q.id, { data }, user, { system: true });
    const out = updateRow('costing_sheets', id, { quotation_id: q.id, status: 'Quoted', customer_id: cs.customer_id || q.customer_id || null }, user, { system: true });
    audit(user.name, 'costing_sheets', cs.id, 'added to quotation', q.quote_no);
    return { costing: out, quotation: getRow('quotations', q.id) };
  });
}

// Service: the proforma invoice from the costing sheet (selling prices only).
export function costingPI(id, user) {
  if (!canWrite('costing_sheets', user.role)) throw new HttpError(403, 'No permission');
  const cs = getRow('costing_sheets', id);
  if (cs.invoice_id) throw new HttpError(409, 'A proforma invoice is already made from this costing sheet');
  const lines = sellingLines(cs);
  if (!lines.length) throw new HttpError(400, 'Add the material / charges first');
  return tx(() => {
    const customer_id = cs.customer_id || customerFor(cs.hospital, {}, user);
    const c = getRow('customers', customer_id);
    const inv = insertRow('invoices', {
      type: 'Proforma Invoice', customer_id, status: 'Draft', place_of_supply: c.state || 'Maharashtra', milestone: cs.title,
      notes: cs.terms || 'Payment should be 100% advance with P.O.',
      lines: lines.map(l => ({ description: l.description, hsn: l.hsn, qty: l.qty, uom: l.uom, rate: l.rate, gst: cs.gst_rate ?? 18 })),
    }, user, { system: true });
    updateRow('costing_sheets', id, { invoice_id: inv.id, customer_id, status: 'Quoted' }, user, { system: true });
    audit(user.name, 'costing_sheets', cs.id, 'proforma', inv.invoice_no);
    return inv;
  });
}

// ---------------------------------------------------------------- service dashboard
export function serviceDashboard() {
  const t = today(), monthEnd = (() => { const d = new Date(t + 'T00:00:00'); d.setMonth(d.getMonth() + 1, 0); return d.toLocaleString('sv-SE').slice(0, 10); })(), in60 = addDays(t, 60);
  const tickets = listRows('service_tickets', { limit: 20000 });
  const open = tickets.filter(x => !['Closed', 'Resolved'].includes(x.status));
  const closed = tickets.filter(x => ['Closed', 'Resolved'].includes(x.status) && x.closed_date);
  const since30 = addDays(t, -30);
  const group = (rows, key) => Object.entries(rows.reduce((m, r) => { const k = r[key] || '—'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n);
  const amc = listRows('amc_contracts', { limit: 20000 });
  const visits = [];
  // Visits of a current cover only (old periods in the register are history), in the AMC period.
  for (const a of amc) if (['AMC Active', 'Renewal Due', 'In Warranty'].includes(a.cover_status)) for (const p of a.service_plan || []) if (p.planned && !p.done && p.planned <= monthEnd && (!a.amc_start || p.planned >= a.amc_start || a.cover_status === 'In Warranty')) visits.push({ id: a.id, hospital: a.hospital, city: a.city, visit: p.visit, planned: p.planned, late: p.planned < t });
  visits.sort((x, y) => x.planned.localeCompare(y.planned));
  const fy0 = (() => { const d = new Date(t + 'T00:00:00'); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  return {
    today: t,
    complaints: {
      open: open.length, waiting_parts: open.filter(x => x.status === 'Waiting for Parts').length, over7: open.filter(x => x.days_open > 7).length,
      new30: tickets.filter(x => x.date >= since30).length, closed30: closed.filter(x => x.closed_date >= since30).length,
      avg_days: closed.length ? r2(closed.reduce((s, x) => s + (x.days_open || 0), 0) / closed.length) : 0,
      by_person: group(open, 'assigned_to'), by_instrument: group(tickets.filter(x => x.date >= fy0), 'equipment').slice(0, 10),
      oldest: open.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 15).map(x => ({ id: x.id, no: x.ticket_no, date: x.date, hospital: x.hospital, equipment: x.equipment, complaint: x.complaint, assigned_to: x.assigned_to, status: x.status, days: x.days_open })),
    },
    amc: {
      active: amc.filter(a => ['AMC Active', 'Renewal Due'].includes(a.cover_status)).length, warranty: amc.filter(a => a.cover_status === 'In Warranty').length,
      value: r2(amc.filter(a => ['AMC Active', 'Renewal Due'].includes(a.cover_status)).reduce((s, a) => s + (a.amc_amount || 0), 0)),
      renewals: amc.filter(a => a.amc_end && a.amc_end >= addDays(t, -90) && a.amc_end <= in60).sort((a, b) => a.amc_end.localeCompare(b.amc_end)).map(a => ({ id: a.id, hospital: a.hospital, city: a.city, amc_end: a.amc_end, amount: a.amc_amount, status: a.cover_status })),
      warranty_ending: amc.filter(a => a.warranty_end && a.warranty_end >= t && a.warranty_end <= in60).map(a => ({ id: a.id, hospital: a.hospital, warranty_end: a.warranty_end })),
      particle_due: amc.filter(a => a.particle_next && a.particle_next <= in60).map(a => ({ id: a.id, hospital: a.hospital, particle_next: a.particle_next })),
      visits_due: visits,
    },
    swo_pending: db.prepare("SELECT COUNT(*) n FROM service_work_orders WHERE status IN ('Draft', 'Sent to Store')").get().n,
    reports_month: db.prepare("SELECT COUNT(*) n FROM service_reports WHERE date >= ?").get(t.slice(0, 8) + '01').n,
    rca_open: db.prepare("SELECT COUNT(*) n FROM rca_reports WHERE status <> 'Accepted by Client'").get().n,
    revenue_fy: r2(db.prepare("SELECT COALESCE(SUM(total), 0) v FROM invoices WHERE type = 'Proforma Invoice' AND status <> 'Cancelled' AND date >= ? AND (milestone = 'AMC' OR id IN (SELECT invoice_id FROM costing_sheets WHERE kind = 'Service'))").get(fy0).v),
  };
}

// ---------------------------------------------------------------- imports of the Excel registers
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cellv = v => { if (v == null) return null; if (v instanceof Date) return v; if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map(x => x.text).join('') : null); return v; };
const toDate = v => {
  v = cellv(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return null;
  const d = new Date(`${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('sv-SE').slice(0, 10);
};
const text = v => { v = cellv(v); return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); };
const money = v => { v = cellv(v); const n = Number(String(v ?? '').replace(/[,₹\s]/g, '')); return Number.isFinite(n) && n ? n : null; };

// Header row with the most of the wanted columns, then each data row as { key: cell }.
function sheetRows(ws, want) {
  let best = null;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const cols = {};
    // Each column goes to the first wanted field it matches (so "Date of Complaint" is never also the problem).
    ws.getRow(r).eachCell((c, i) => { const n = norm(cellv(c.value)); for (const [k, re] of Object.entries(want)) if (!cols[k] && re.test(n)) { cols[k] = i; break; } });
    if (!best || Object.keys(cols).length > Object.keys(best.cols).length) best = { row: r, cols };
  }
  if (!best || Object.keys(best.cols).length < 4) return [];
  const out = [];
  for (let r = best.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    out.push(Object.fromEntries(Object.entries(best.cols).map(([k, i]) => [k, row.getCell(i).value])));
  }
  return out;
}

export async function importComplaints(buffer, user) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'Upload the complaint register as .xlsx'); }
  const want = { date: /^dateofcomplaint|^date$/, mode: /modeofcomplaint|^mode/, hospital: /customername|hospital/, address: /^address|^city/, contact: /contactperson/, phone: /contactno|mobile|phone/,
    instrument: /instrument|equipment/, status: /complaintstatus|^status/, problem: /^problem|^complaintdetail|^natureofcomplaint/, person: /assigned/, solution: /solution/, done: /dateofcompli|dateofcomplet|completiondate/, remark: /^remark/ };
  let added = 0, skipped = 0;
  tx(() => {
    for (const ws of wb.worksheets) for (const r of sheetRows(ws, want)) {
      const hospital = text(r.hospital), problem = text(r.problem), date = toDate(r.date);
      if (!hospital || !problem || !date) continue;
      if (db.prepare('SELECT 1 FROM service_tickets WHERE date = ? AND lower(hospital) = lower(?) AND complaint = ?').get(date, hospital, problem)) { skipped++; continue; }
      const st = text(r.status).toLowerCase();
      const cust = db.prepare('SELECT id FROM customers WHERE lower(trim(name)) = lower(?)').get(hospital);
      insertRow('service_tickets', { date, mode: text(r.mode) || 'Telephonic', hospital, customer_id: cust?.id || null, city: text(r.address) || null, contact_person: text(r.contact) || null, contact_no: text(r.phone) || null,
        equipment: text(r.instrument) || null, complaint: problem, assigned_to: text(r.person) || null, resolution: text(r.solution) || null, status: st.startsWith('close') || toDate(r.done) ? 'Closed' : 'Open',
        closed_date: toDate(r.done), remark: text(r.remark) || null }, user, { system: true });
      added++;
    }
  });
  audit(user.name, 'service_tickets', null, 'import', `${added} complaint(s), ${skipped} already there`);
  return { added, skipped };
}

export async function importAmc(buffer, user) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'Upload the AMC / warranty register as .xlsx'); }
  const want = { client_id: /^clientid/, hospital: /^hospitalname/, customer: /^customername/, address: /^address/, city: /^city/, state: /^state/, contact: /contactperson/, mobile: /^mobile/, email: /^email/,
    system: /systemdetails/, wmonths: /warrantyduration/, wstart: /warrantystart/, wend: /endofwarranty/, services: /servicescovered/, s1: /^s1$/, s2: /^s2$/, s3: /^s3$/, s4: /^s4$/,
    astart: /startofamc/, aend: /endofamc/, agreed: /asperoriginal/, amount: /^amcamount$/, pc: /particlecountstart/, pcnext: /^nextparticle|^next/ };
  let added = 0, updated = 0;
  tx(() => {
    for (const ws of wb.worksheets) for (const r of sheetRows(ws, want)) {
      const hospital = text(r.hospital);
      if (!hospital) continue;
      const plan = ['s1', 's2', 's3', 's4'].map((k, i) => ({ visit: `S${i + 1}`, planned: toDate(r[k]) || '', done: '', report: '', remark: '' })).filter(p => p.planned);
      const row = { client_id: text(r.client_id) || null, hospital, customer_name: text(r.customer) || null, address: text(r.address) || null, city: text(r.city) || null, state: text(r.state) || null,
        contact_person: text(r.contact) || null, mobile: text(r.mobile) || null, email: text(r.email) || null, system_details: text(r.system) || null,
        warranty_months: Number(text(r.wmonths)) || null, warranty_start: toDate(r.wstart), warranty_end: toDate(r.wend), services_covered: Number(text(r.services)) || null,
        amc_start: toDate(r.astart), amc_end: toDate(r.aend), amc_amount_agreement: money(r.agreed), amc_amount: money(r.amount), particle_count_date: toDate(r.pc), particle_next: toDate(r.pcnext),
        coverage: toDate(r.astart) ? 'AMC' : toDate(r.wstart) ? 'Warranty' : 'None', service_plan: plan };
      const hit = db.prepare('SELECT id FROM amc_contracts WHERE lower(hospital) = lower(?) AND COALESCE(system_details, \'\') = ? AND COALESCE(client_id, \'\') = ?').get(hospital, row.system_details || '', row.client_id || '');
      if (hit) { updateRow('amc_contracts', hit.id, row, user, { system: true }); updated++; } else { insertRow('amc_contracts', row, user, { system: true }); added++; }
    }
  });
  audit(user.name, 'amc_contracts', null, 'import', `${added} added, ${updated} updated`);
  return { added, updated };
}
