import ExcelJS from 'exceljs';
import { db, bumpSeq, tx } from './db.js';
import { ENTITIES } from '../public/js/schema.js';
import { listRows, insertRow } from './crud.js';
import { fyOf } from '../public/js/calc.js';

// Column order of the WIESPL "Sales Enquiry Register" sheet.
const REGISTER = [
  ['Sr. No.', null], ['Enquiry  No.', 'enquiry_no'], ['Quotation Ref No', 'quote_ref'], ['Date', 'date'], ['Place', 'place'],
  ['District', 'district'], ['Name of the Doctor', 'doctor_name'], ['Contact No.', 'doctor_phone'], ['Name of the Hospital', 'hospital_name'],
  ['Name of the consultant/architect', 'consultant_name'], ['Contact No.', 'consultant_phone'], ['Type of work', 'type_of_work'],
  ['Hospital capacity', 'capacity'], ['Enquiry By', 'enquiry_by'], ['Supported By', 'supported_by'], ['Quoted by', 'quoted_by'],
  ['Drawing received Y/N', 'drawing_received'], ['Quotation Status', 'status'], ['Remarks/ Feedback', 'remarks'],
  ['Kick back involved Y/N', 'kickback'], ['Verified By & date', 'verified'],
];

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E9A' } };
    c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
}

const toDate = s => (s ? new Date(`${s}T00:00:00`) : null);

export async function exportEntity(name, query) {
  const ent = ENTITIES[name];
  const rows = listRows(name, query);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WIESPL CRM';
  // Excel sheet names cannot contain * ? : \ / [ ] and are limited to 31 characters.
  const ws = wb.addWorksheet(ent.label.replace(/[*?:\\/[\]]/g, '-').replace(/\s+/g, ' ').slice(0, 31));

  if (name === 'enquiries') {
    const fy = query.fy || fyOf();
    ws.mergeCells(1, 1, 1, REGISTER.length);
    ws.getCell(1, 1).value = `SALES ENQUIRY REGISTER-20${fy}`;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(1, 1).alignment = { horizontal: 'center' };
    const hdr = ws.addRow(REGISTER.map(c => c[0]));
    styleHeader(hdr);
    hdr.height = 32;
    [...rows].reverse().forEach((r, i) => {
      ws.addRow(REGISTER.map(([, k]) => {
        if (k === null) return i + 1;
        if (k === 'date') return toDate(r.date);
        if (k === 'verified') return [r.verified_by, r.verified_date].filter(Boolean).join(' ');
        if (k === 'hospital_name') return r.hospital_name || r.customer_id_label || '';
        return r[k] ?? '';
      }));
    });
    ws.getColumn(4).numFmt = 'dd/mm/yyyy';
    REGISTER.forEach((c, i) => { ws.getColumn(i + 1).width = [6, 14, 18, 12].at(i) || (c[1] === 'remarks' ? 40 : 18); });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
  } else {
    const fields = ent.fields.filter(f => !f.hidden && f.type !== 'json' && f.type !== 'lines');
    const hdr = ws.addRow(fields.map(f => f.label));
    styleHeader(hdr);
    for (const r of rows) {
      ws.addRow(fields.map(f => {
        if (f.type === 'ref') return r[`${f.key}_label`] ?? '';
        if (f.type === 'date') return toDate(r[f.key]);
        return r[f.key] ?? '';
      }));
    }
    fields.forEach((f, i) => {
      const col = ws.getColumn(i + 1);
      col.width = f.type === 'textarea' ? 40 : f.type === 'date' ? 12 : 18;
      if (f.type === 'date') col.numFmt = 'dd/mm/yyyy';
      if (f.type === 'money') col.numFmt = '#,##,##0.00';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return wb.xlsx.writeBuffer();
}

// ---------------------------------------------------------------- import of the enquiry register
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text) return v.text;
    return '';
  }
  return v;
}

function toIsoDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
const HEADER_KEYS = {
  enquiryno: 'enquiry_no', quotationrefno: 'quote_ref', date: 'date', place: 'place', district: 'district',
  nameofthedoctor: 'doctor_name', nameofthehospital: 'hospital_name', nameoftheconsultantarchitect: 'consultant_name',
  typeofwork: 'type_of_work', hospitalcapacity: 'capacity', enquiryby: 'enquiry_by', supportedby: 'supported_by', quotedby: 'quoted_by',
  drawingreceivedyn: 'drawing_received', quotatationstatus: 'status', quotationstatus: 'status', remarksfeedback: 'remarks',
  kickbackinvolvedyn: 'kickback', verifiedbydate: 'verified_by',
};
const STATUS_OPTS = ENTITIES.enquiries.fields.find(f => f.key === 'status').options;

export async function importEnquiries(buffer, user) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // Every sheet of the register (e.g. 25-26 and 26-27) that has the header row.
  const result = { imported: 0, skipped: 0, duplicates: 0, errors: [], sheets: [] };
  const counter = { carry: 0 };
  for (const ws of wb.worksheets) importEnquirySheet(ws, user, result, counter);
  if (!result.sheets.length) throw Object.assign(new Error('Could not find the header row (expected "Enquiry No." and "Date" columns)'), { status: 400 });
  return result;
}

function importEnquirySheet(ws, user, result, counter) {
  let headerRow = 0;
  const colMap = {};
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const texts = row.values.map(v => norm(cellText(v)));
    if (texts.includes('enquiryno') && texts.includes('date')) {
      headerRow = n;
      let contactCount = 0;
      texts.forEach((t, col) => {
        if (t === 'contactno') colMap[col] = contactCount++ === 0 ? 'doctor_phone' : 'consultant_phone';
        else if (HEADER_KEYS[t]) colMap[col] = HEADER_KEYS[t];
      });
    }
  });
  if (!headerRow) return;
  result.sheets.push(ws.name);
  const exists = db.prepare('SELECT 1 FROM enquiries WHERE enquiry_no = ?');
  tx(() => {
    for (let n = headerRow + 1; n <= ws.rowCount; n++) {
      const row = ws.getRow(n);
      const rec = {};
      for (const [col, key] of Object.entries(colMap)) {
        const v = cellText(row.getCell(Number(col)).value);
        if (v !== '' && v != null) rec[key] = v;
      }
      const meaningful = ['date', 'place', 'doctor_name', 'hospital_name', 'type_of_work', 'consultant_name'].some(k => rec[k]);
      if (!meaningful) { result.skipped++; continue; }
      try {
        if (rec.date) rec.date = toIsoDate(rec.date);
        if (!rec.date) rec.date = new Date().toISOString().slice(0, 10);
        for (const k of ['drawing_received', 'kickback']) {
          if (rec[k] != null) rec[k] = /^y/i.test(String(rec[k]).trim()) ? 'Yes' : /^n/i.test(String(rec[k]).trim()) ? 'No' : null;
        }
        if (rec.status) {
          const s = norm(rec.status);
          rec.status = STATUS_OPTS.find(o => norm(o) === s) || (s.startsWith('inprocess') ? 'In Process' : s.startsWith('order') ? 'Won' : String(rec.status).trim());
        } else rec.status = 'New';
        for (const k of Object.keys(rec)) {
          if (typeof rec[k] !== 'string') continue;
          rec[k] = rec[k].replace(/\r\n/g, '\n').trim();
          // Multi-line cells (e.g. "MOT\nNICU") go into single-line fields as a list.
          if (!['remarks'].includes(k)) rec[k] = rec[k].split('\n').map(s => s.trim()).filter(Boolean).join(', ');
        }
        // A section label such as "Active Enquiry 2024-25" (a merged cell repeated on every row) is not an enquiry number.
        if (rec.enquiry_no && !/\d+\s*\/\s*\d+/.test(String(rec.enquiry_no))) {
          rec.remarks = [rec.remarks, `Register section: ${rec.enquiry_no}`].filter(Boolean).join('\n');
          delete rec.enquiry_no;
        }
        if (typeof rec.doctor_phone === 'number') rec.doctor_phone = String(rec.doctor_phone);
        if (typeof rec.consultant_phone === 'number') rec.consultant_phone = String(rec.consultant_phone);

        const m = String(rec.enquiry_no || '').match(/^(\d+)\/(\d{1,2})\/(\d{2}-\d{2})$/);
        if (m) {
          rec.seq = Number(m[1]); rec.fy = m[3];
          bumpSeq('enquiry', rec.fy, rec.seq);
        } else if (!rec.enquiry_no) {
          // Carried-forward active enquiries from an earlier year have no number in the register.
          rec.enquiry_no = `CF/${++counter.carry}/${fyOf(rec.date)}`;
          rec.fy = fyOf(rec.date);
        }
        if (exists.get(String(rec.enquiry_no))) { result.duplicates++; continue; }
        insertRow('enquiries', rec, user, { system: true });
        result.imported++;
      } catch (e) {
        result.errors.push(`${ws.name} row ${n}: ${e.message}`);
      }
    }
  });
}
