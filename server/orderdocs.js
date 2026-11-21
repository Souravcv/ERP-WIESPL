// Purchase Order and Work Order from a quotation (management discussion, Nov 2026).
// One press on an approved quotation makes both:
//   - the client Purchase Order = the Sales Order (for the client and for Accounts & Finance), with a private link where the client
//     checks it and approves it with a name, designation, PO number and a drawn signature;
//   - the Work Order (for internal working): every quotation line with its total quantity, ready for the BOQ and the store check.
import crypto from 'node:crypto';
import { db, audit, getSettings } from './db.js';
import { HttpError, getRow, updateRow } from './crud.js';
import { convertToSalesOrder } from './workflows.js';
import { workOrderFromSalesOrder } from './boqflow.js';
import { notify } from './notify.js';
import { quoteTotals } from '../public/js/calc.js';

const parse = (v, d) => { if (v == null || v === '') return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return d; } };
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const token = () => crypto.randomBytes(18).toString('base64url');

export function generate(quotationId, user) {
  const q = getRow('quotations', quotationId);
  let so = db.prepare('SELECT * FROM sales_orders WHERE quotation_id = ?').get(q.id), madeSo = false;
  if (!so) {
    so = convertToSalesOrder(q.id, {}, user); madeSo = true;
    updateRow('quotations', q.id, { status: q.status }, user, { system: true }); // Won only when the client approves the PO
  }
  if (!so.client_link_token) { db.prepare('UPDATE sales_orders SET client_link_token = ? WHERE id = ?').run(token(), so.id); so = getRow('sales_orders', so.id); }
  let wo = db.prepare('SELECT id, boq_no FROM boqs WHERE sales_order_id = ?').get(so.id), woError = null, madeWo = false;
  if (!wo) { try { wo = workOrderFromSalesOrder(so.id, user).boq; madeWo = true; } catch (e) { woError = e.message; } }
  audit(user.name, 'quotations', q.id, 'generate order', `${madeSo ? 'PO ' + so.so_no : 'PO existed'}; ${wo ? 'work order ' + wo.boq_no : 'no work order: ' + woError}`);
  return { sales_order: { id: so.id, so_no: so.so_no }, work_order: wo ? { id: wo.id, boq_no: wo.boq_no } : null, work_order_error: woError, made_po: madeSo, made_wo: madeWo, token: so.client_link_token };
}

export function linkInfo(soId) {
  const so = getRow('sales_orders', soId);
  return { token: so.client_link_token || null, approved_at: so.client_approved_at || null, approved_by: so.client_approved_by || null, role: so.client_approved_role || null, po_no: so.client_po_no || null };
}

const bySo = tok => {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(tok || '')) throw new HttpError(404, 'This link is not valid');
  const so = db.prepare('SELECT * FROM sales_orders WHERE client_link_token = ?').get(tok);
  if (!so) throw new HttpError(404, 'This link is not valid');
  return so;
};

// what the client sees: no costs, only the order itself
export function publicView(tok) {
  const so = bySo(tok), s = getSettings();
  const q = so.quotation_id ? db.prepare('SELECT * FROM quotations WHERE id = ?').get(so.quotation_id) : null;
  const cust = so.customer_id ? db.prepare('SELECT name, place FROM customers WHERE id = ?').get(so.customer_id) : null;
  const data = parse(q?.data, {}), totals = q ? quoteTotals(data, q.gst_rate, q.discount_pct).lineTotals : {};
  const items = (data.lines || []).filter(l => l.kind !== 'heading' && (totals[l.id]?.qty || 0) > 0).map(l => ({ name: l.name || String(l.description || '').split('\n')[0], qty: Math.round(totals[l.id].qty * 1000) / 1000, uom: l.uom || '' }));
  return { company: s.company_name, order: so.so_no, quotation: q?.quote_no || null, quote_date: q?.date || null, subject: q?.subject || null, hospital: cust?.name || null, place: cust?.place || null,
    basic: so.order_value, gst_rate: so.gst_rate, total: so.total_value ?? Math.round(so.order_value * (1 + (so.gst_rate || 0) / 100) * 100) / 100,
    payment_terms: so.payment_terms, milestones: parse(so.milestones, []), delivery_date: so.delivery_date, items,
    approved: so.client_approved_at ? { at: so.client_approved_at, by: so.client_approved_by, role: so.client_approved_role, po_no: so.client_po_no } : null };
}

export function publicApprove(tok, body, ip) {
  const so = bySo(tok);
  if (so.client_approved_at) throw new HttpError(409, `This order was already approved on ${so.client_approved_at}.`);
  const name = String(body?.name || '').trim().slice(0, 80), role = String(body?.designation || '').trim().slice(0, 80), po = String(body?.po_no || '').trim().slice(0, 60);
  const sig = String(body?.signature || '');
  if (name.length < 2) throw new HttpError(400, 'Please type your name');
  if (role.length < 2) throw new HttpError(400, 'Please type your designation');
  if (body?.accept !== true) throw new HttpError(400, 'Please tick the box to accept the order');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 160000) throw new HttpError(400, 'Please sign in the box');
  const at = stamp();
  db.prepare(`UPDATE sales_orders SET client_approved_at = ?, client_approved_by = ?, client_approved_role = ?, client_approved_ip = ?, client_signature = ?,
    client_po_no = COALESCE(NULLIF(?, ''), client_po_no), client_po_date = COALESCE(client_po_date, date('now','localtime')) WHERE id = ?`).run(at, name, role, String(ip || '').slice(0, 60), sig, po, so.id);
  if (so.quotation_id) db.prepare("UPDATE quotations SET status = 'Won' WHERE id = ? AND status IN ('Approved','Sent')").run(so.quotation_id);
  audit('client', 'sales_orders', so.id, 'client approval', `${name}, ${role}${po ? ', PO ' + po : ''}`);
  notify({ fn: 'notify_client_po', kind: 'order', title: `Client approved the purchase order ${so.so_no}`, body: `${name}, ${role}${po ? ` · client PO ${po}` : ''}. Check it and accept it.`, link: `#/view/sales_orders/${so.id}` }, null);
  return { approved: true, at };
}
