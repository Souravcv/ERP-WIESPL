// Bank reconciliation: a bank statement (Excel) against the payments and expense vouchers marked Paid in the CRM.
// A withdrawal matches a payment by its UTR / cheque no in the narration, otherwise by the same amount within 5 days.
import ExcelJS from 'exceljs';
import { db, tx, audit } from './db.js';
import { HttpError } from './crud.js';

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cellv = v => { if (v == null) return null; if (v instanceof Date) return v; if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map(t => t.text).join('') : null); return v; };
const toDate = v => {
  v = cellv(v);
  if (v instanceof Date) return new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{1,2})[./ -](\w{1,3})[./ -](\d{2,4})/);
  if (!m) return null;
  const mon = /^\d+$/.test(m[2]) ? Number(m[2]) : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase().slice(0, 3)) + 1;
  if (!mon) return null;
  return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const amount = v => { v = cellv(v); if (v == null || v === '') return null; const n = Number(String(v).replace(/[,₹\s]|cr|dr/gi, '')); return Number.isFinite(n) ? n : null; };
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);

function readStatement(wb) {
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
      const cols = {};
      ws.getRow(r).eachCell((c, i) => {
        const n = norm(cellv(c.value));
        if (!cols.date && /^(txn|transaction|value)?date$/.test(n)) cols.date = i;
        else if (!cols.desc && /narration|description|particulars|remarks|details/.test(n)) cols.desc = i;
        else if (!cols.ref && /(chq|cheque|ref)/.test(n)) cols.ref = i;
        else if (!cols.out && /withdrawal|debit|dr$|paidout/.test(n)) cols.out = i;
      });
      if (cols.date && cols.out && cols.desc) {
        const rows = [];
        for (let k = r + 1; k <= ws.rowCount; k++) {
          const row = ws.getRow(k);
          const date = toDate(row.getCell(cols.date).value), out = amount(row.getCell(cols.out).value);
          if (!date || !(out > 0)) continue;
          rows.push({ row: k, date, amount: out, narration: String(cellv(row.getCell(cols.desc).value) ?? '').trim(), ref: cols.ref ? String(cellv(row.getCell(cols.ref).value) ?? '').trim() : '' });
        }
        return rows;
      }
    }
  }
  throw new HttpError(400, 'Bank statement columns not found. The sheet needs a header row with Date, Narration / Description and Withdrawal / Debit.');
}

export async function preview(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'Save the bank statement as Excel Workbook (.xlsx) and upload again'); }
  const bank = readStatement(wb);
  if (!bank.length) throw new HttpError(400, 'No withdrawals found in the statement');
  const from = bank.map(b => b.date).sort()[0], to = bank.map(b => b.date).sort().slice(-1)[0];
  const crm = [
    ...db.prepare(`SELECT 'vendor_payments' type, x.id, x.payment_no no, x.date, COALESCE(x.net_amount, x.amount) amount, x.reference, v.name party FROM vendor_payments x
      LEFT JOIN vendors v ON v.id = x.vendor_id WHERE x.status = 'Paid' AND x.bank_date IS NULL AND x.mode <> 'Cash'`).all(),
    ...db.prepare("SELECT 'expenses' type, id, voucher_no no, date, amount, reference, payee party FROM expenses WHERE status = 'Paid' AND bank_date IS NULL AND mode <> 'Cash'").all(),
  ];
  const used = new Set();
  const matches = [];
  // 1) UTR / cheque no found in the narration or the reference column.
  for (const b of bank) {
    const text = norm(`${b.narration} ${b.ref}`);
    const hit = crm.find(c => !used.has(c.type + c.id) && c.reference && norm(c.reference).length >= 4 && text.includes(norm(c.reference)));
    if (hit) { used.add(hit.type + hit.id); matches.push({ bank: b, crm: hit, how: 'UTR / cheque no', amountOk: Math.abs(hit.amount - b.amount) < 1 }); b.done = true; }
  }
  // 2) The same amount within 5 days, when only one payment fits.
  for (const b of bank.filter(x => !x.done)) {
    const fits = crm.filter(c => !used.has(c.type + c.id) && Math.abs(c.amount - b.amount) < 1 && days(c.date, b.date) <= 5);
    if (fits.length === 1) { used.add(fits[0].type + fits[0].id); matches.push({ bank: b, crm: fits[0], how: 'same amount and date', amountOk: true }); b.done = true; }
  }
  return {
    from, to, withdrawals: bank.length, matches,
    bankOnly: bank.filter(b => !b.done),
    crmOnly: crm.filter(c => !used.has(c.type + c.id) && c.date >= from && c.date <= to),
  };
}

export function confirm(body = {}, user) {
  const list = (body.matches || []).filter(m => ['vendor_payments', 'expenses'].includes(m.type) && m.id && /^\d{4}-\d{2}-\d{2}$/.test(m.date));
  if (!list.length) throw new HttpError(400, 'Nothing to confirm');
  return tx(() => {
    let n = 0;
    for (const m of list) n += db.prepare(`UPDATE ${m.type} SET bank_date = ? WHERE id = ? AND status = 'Paid' AND bank_date IS NULL`).run(m.date, Number(m.id)).changes;
    audit(user.name, 'bank', null, 'reconciled', `${n} payment(s)`);
    return { reconciled: n };
  });
}
