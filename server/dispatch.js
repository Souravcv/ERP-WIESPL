// Work order BOQ per project, delivery challans (dispatch) and BOQ delivery status.
import ExcelJS from 'exceljs';
import { db, tx, audit } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { stockEntry } from './stock.js';
import { hasFunction } from '../public/js/schema.js';

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function cell(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.error) return null;
    if ('result' in v) return cell(v.result);
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}
const str = v => { const c = cell(v); return c == null ? '' : String(c).replace(/\r/g, '').trim(); };
const num = v => { const c = cell(v); if (c == null || c === '') return null; const n = Number(String(c).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const firstLine = s => String(s || '').split('\n')[0].trim();
const WO_RE = /WIESPL\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d{4}-\d{2}/i;

// ---------------------------------------------------------------- BOQ import from a work order workbook
function parseSheet(ws) {
  let hdr = null;
  for (let r = 1; r <= Math.min(15, ws.rowCount) && !hdr; r++) {
    const vals = Array.from(ws.getRow(r).values, v => norm(str(v)));
    const desc = vals.findIndex(v => ['particulars', 'description', 'itemsdescription', 'itemdescription'].includes(v));
    const sr = vals.findIndex(v => ['srno', 'sr', 'srnoo'].includes(v));
    if (desc > 0 && sr > 0) hdr = { row: r, vals, desc, sr };
  }
  if (!hdr) return null;
  const { vals } = hdr;
  const uomCol = vals.findIndex(v => ['uom', 'unit', 'units'].includes(v));
  const qtyCol = vals.findIndex(v => ['qty', 'quantity'].includes(v));
  // Per-area quantity columns (e.g. Mj OT 1 … Mj OT 5) when there is no single Qty column.
  const areaCols = qtyCol > 0 ? [] : vals.map((v, i) => [v, i]).filter(([v, i]) => v && i > hdr.desc && i !== uomCol).map(([, i]) => [i, str(ws.getRow(hdr.row).getCell(i).value)]);
  let woNo = null;
  for (let r = 1; r <= hdr.row && !woNo; r++) ws.getRow(r).eachCell(c => { const m = str(c.value).match(WO_RE); if (m && !woNo) woNo = m[0].replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / '); });

  const lines = [];
  let heading = null;
  for (let r = hdr.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const desc = str(row.getCell(hdr.desc).value);
    if (/^(for,|authori[sz]ed signatory)/i.test(desc)) break;
    let sr = str(row.getCell(hdr.sr).value);
    if (/^#|ref!/i.test(sr)) sr = '';
    if (/^\d+\.\d{6,}$/.test(sr)) sr = String(Math.round(Number(sr) * 10) / 10); // 1.1000000000000001 → 1.1
    const uomText = uomCol > 0 ? str(row.getCell(uomCol).value) : '';
    let qty = null, area = [], ur = false;
    if (qtyCol > 0) {
      const q = row.getCell(qtyCol).value;
      qty = num(q);
      ur = /^ur$/i.test(str(q));
    } else {
      for (const [i, name] of areaCols) { const q = num(row.getCell(i).value); if (q) { area.push(`${name}: ${q}`); qty = (qty || 0) + q; } }
    }
    if (!desc && qty == null) continue;
    const hasQty = qty != null || ur;
    const prev = lines[lines.length - 1];
    // Continuation text: no number (e.g. "Incomer 1 No. 25A DP ELCB"), or a numbered paragraph like
    // "6.1 Indications & Metering" under an item that already has a quantity. It belongs to the line above.
    if (!uomText && !hasQty && prev && (!sr || (sr.includes('.') && prev.kind === 'Item'))) {
      prev.description += '\n' + desc;
      continue;
    }
    if (!uomText && !hasQty) {
      heading = { sr, text: firstLine(desc).slice(0, 120) };
      lines.push({ kind: 'Heading', sr_no: sr, description: desc, uom: null, qty: null, heading: null });
      continue;
    }
    // A heading only applies to lines numbered under it (1 → 1.1, 1.2).
    const under = heading && sr && heading.sr && sr.startsWith(heading.sr + '.') ? heading.text : null;
    lines.push({ kind: 'Item', sr_no: sr, description: desc, uom: uomText || null, qty, area_qty: area.join(', ') || null, heading: under, remarks: ur ? 'Qty UR (to be decided)' : null });
  }
  return { section: ws.name.trim(), wo_no: woNo, lines };
}

export async function importBoq(projectId, buffer, mode, user) {
  const project = getRow('projects', projectId);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not a readable .xlsx file'); }
  const sections = wb.worksheets.map(parseSheet).filter(s => s && s.lines.some(l => l.kind === 'Item'));
  if (!sections.length) throw new HttpError(400, 'No BOQ found. Each sheet needs a header row with "Sr. No." and "Particulars" / "Description".');
  const existing = db.prepare('SELECT COUNT(*) n FROM boq_items WHERE project_id = ?').get(project.id).n;
  if (existing && mode !== 'append' && mode !== 'replace') throw new HttpError(409, `This project already has ${existing} BOQ lines. Choose "Add to existing" or "Replace".`);
  return tx(() => {
    if (mode === 'replace' && existing) {
      const used = db.prepare(`SELECT COUNT(*) n FROM challans c, json_each(c.lines) j WHERE c.project_id = ? AND c.status <> 'Cancelled' AND json_extract(j.value, '$.boq_item_id') IS NOT NULL`).get(project.id).n;
      if (used) throw new HttpError(409, 'Some BOQ lines are already on challans, so the BOQ cannot be replaced. Use "Add to existing" instead.');
      db.prepare('DELETE FROM boq_items WHERE project_id = ?').run(project.id);
    }
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM boq_items WHERE project_id = ?').get(project.id).m;
    const ins = db.prepare(`INSERT INTO boq_items (project_id, section, wo_no, sr_no, kind, heading, description, uom, qty, area_qty, remarks, sort, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`);
    const summary = [];
    for (const s of sections) {
      let items = 0;
      for (const l of s.lines) {
        ins.run(project.id, s.section, s.wo_no, l.sr_no || null, l.kind, l.heading || null, l.description, l.uom, l.qty, l.area_qty || null, l.remarks || null, ++sort, user.name);
        if (l.kind === 'Item') items++;
      }
      summary.push({ section: s.section, wo_no: s.wo_no, items, headings: s.lines.length - items });
    }
    const woNos = [...new Set(sections.map(s => s.wo_no).filter(Boolean))];
    if (!project.project_no && woNos.length) db.prepare('UPDATE projects SET project_no = ? WHERE id = ?').run(woNos[0], project.id);
    audit(user.name, 'projects', project.id, 'BOQ import', summary.map(s => `${s.section}: ${s.items}`).join(', '));
    return { sections: summary, woNos };
  });
}

// ---------------------------------------------------------------- challans
const boqLine = db => db.prepare(`SELECT b.*, ${'(SELECT COALESCE(SUM(CAST(json_extract(j.value, \'$.qty\') AS REAL)), 0) FROM challans c, json_each(c.lines) j WHERE c.status IN (\'Dispatched\',\'Delivered\') AND CAST(json_extract(j.value, \'$.boq_item_id\') AS INTEGER) = b.id)'} AS sent FROM boq_items b WHERE b.id = ?`);

export function challanFromBoq(projectId, picks, user) {
  const project = getRow('projects', projectId);
  const get = boqLine(db);
  const lines = [];
  for (const p of picks || []) {
    const b = get.get(Number(p.boq_item_id));
    if (!b || b.project_id !== project.id || b.kind === 'Heading') continue;
    const pending = b.qty == null ? null : Math.max(0, b.qty - b.sent);
    const qty = Number(p.qty) > 0 ? Number(p.qty) : pending;
    if (!(qty > 0)) continue;
    lines.push({ boq_item_id: b.id, item_id: b.item_id || null, description: [b.heading, firstLine(b.description)].filter(Boolean).join(' – ') + (b.sr_no ? ` (BOQ ${b.section} ${b.sr_no})` : ` (BOQ ${b.section})`), uom: b.uom || 'Nos', qty, remark: '' });
  }
  if (!lines.length) throw new HttpError(400, 'Pick at least one pending BOQ line');
  return insertRow('challans', { project_id: project.id, status: 'Draft', lines }, user, { system: true });
}

export function dispatchChallan(id, body, user) {
  const ch = getRow('challans', id);
  if (ch.status !== 'Draft') throw new HttpError(400, `Challan is already ${ch.status}`);
  const lines = (ch.lines || []).filter(l => Number(l.qty) > 0);
  if (!lines.length) throw new HttpError(400, 'Add material with quantities first');
  // Do not send more than the work order quantity, unless a manager overrides.
  const get = boqLine(db);
  const over = [];
  const need = {};
  for (const l of lines) if (l.boq_item_id) need[l.boq_item_id] = (need[l.boq_item_id] || 0) + Number(l.qty);
  for (const [bid, q] of Object.entries(need)) {
    const b = get.get(Number(bid));
    if (b && b.qty != null && b.sent + q > b.qty + 1e-9) over.push(`${b.sr_no || ''} ${firstLine(b.description).slice(0, 60)}: WO ${b.qty}, already sent ${b.sent}, this challan ${q}`);
  }
  if (over.length && !(body?.force && hasFunction(user.role, 'allow_negative'))) {
    throw new HttpError(409, `More than the work order quantity:\n${over.join('\n')}`);
  }
  return tx(() => {
    const stockLines = lines.filter(l => l.item_id).map(l => ({ item_id: l.item_id, qty: Number(l.qty), remark: l.remark || '' }));
    let stockDoc = null;
    if (stockLines.length) {
      stockDoc = stockEntry({
        type: 'OUTWARD', date: ch.date, doc_no: ch.challan_no, project_id: ch.project_id, issued_to: firstLine(ch.ship_to) || ch.project_id_label,
        purpose: `Delivery challan ${ch.challan_no}`, lines: stockLines,
        allowNegative: !!body?.allowNegative && hasFunction(user.role, 'allow_negative'),
      }, user);
    }
    updateRow('challans', id, { status: 'Dispatched', dispatched_by: `${user.name} (${new Date().toLocaleString('sv-SE').slice(0, 16)})` }, user, { system: true });
    return { ...getRow('challans', id), stock_lines: stockLines.length, stock_doc: stockDoc?.doc_no || null };
  });
}

export function deliverChallan(id, body, user) {
  const ch = getRow('challans', id);
  if (ch.status !== 'Dispatched') throw new HttpError(400, 'Only a dispatched challan can be marked delivered');
  return updateRow('challans', id, { status: 'Delivered', received_by: body?.received_by || null, delivered_date: body?.delivered_date || new Date().toLocaleString('sv-SE').slice(0, 10) }, user, { system: true });
}
