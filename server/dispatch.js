// Client work orders and BOQs (bills of material), delivery challans (dispatch) and what is sent / pending.
import ExcelJS from 'exceljs';
import { db, tx, audit, nextSeq } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { stockEntry } from './stock.js';
import { saveAttachment } from './roles.js';
import { hasFunction } from '../public/js/schema.js';
import { qtyFromText } from './hooks.js';

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

export async function importBoq(boqId, buffer, mode, user) {
  const boq = getRow('boqs', boqId);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not a readable .xlsx file'); }
  const sections = wb.worksheets.map(parseSheet).filter(s => s && s.lines.some(l => l.kind === 'Item'));
  if (!sections.length) throw new HttpError(400, 'No BOQ found. Each sheet needs a header row with "Sr. No." and "Particulars" / "Description".');
  const existing = db.prepare('SELECT COUNT(*) n FROM boq_items WHERE boq_id = ?').get(boq.id).n;
  if (existing && mode !== 'append' && mode !== 'replace') throw new HttpError(409, `This BOQ already has ${existing} lines. Choose "Add to existing" or "Replace".`);
  return tx(() => {
    if (mode === 'replace' && existing) {
      const used = db.prepare(`SELECT COUNT(*) n FROM challans c, json_each(c.lines) j WHERE c.status <> 'Cancelled'
        AND CAST(json_extract(j.value, '$.boq_item_id') AS INTEGER) IN (SELECT id FROM boq_items WHERE boq_id = ?)`).get(boq.id).n;
      if (used) throw new HttpError(409, 'Some lines of this BOQ are already on challans, so it cannot be replaced. Use "Add to existing" instead.');
      db.prepare('DELETE FROM boq_items WHERE boq_id = ?').run(boq.id);
    }
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM boq_items WHERE boq_id = ?').get(boq.id).m;
    const ins = db.prepare(`INSERT INTO boq_items (boq_id, project_id, section, wo_no, sr_no, kind, heading, description, uom, qty, area_qty, remarks, sort, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`);
    const summary = [];
    for (const s of sections) {
      let items = 0;
      for (const l of s.lines) {
        ins.run(boq.id, boq.project_id || null, s.section, s.wo_no, l.sr_no || null, l.kind, l.heading || null, l.description, l.uom, l.qty, l.area_qty || null, l.remarks || null, ++sort, user.name);
        if (l.kind === 'Item') items++;
      }
      summary.push({ section: s.section, wo_no: s.wo_no, items, headings: s.lines.length - items });
    }
    const woNos = [...new Set(sections.map(s => s.wo_no).filter(Boolean))];
    if (woNos.length) {
      const all = [...new Set([...(boq.wo_no ? boq.wo_no.split(/\s*,\s*/) : []), ...woNos])].filter(Boolean);
      db.prepare('UPDATE boqs SET wo_no = ? WHERE id = ?').run(all.join(', '), boq.id);
    }
    audit(user.name, 'boqs', boq.id, 'import', summary.map(s => `${s.section}: ${s.items}`).join(', '));
    return { sections: summary, woNos };
  });
}

// New BOQ from an uploaded work order: the file is kept as an attachment of the BOQ.
export async function createBoqFromFile({ title, project_id, filename, mime }, buffer, user) {
  if (!buffer?.length) throw new HttpError(400, 'Upload the work order .xlsx');
  const name = String(filename || 'Work order.xlsx');
  const boq = insertRow('boqs', { title: String(title || '').trim() || name.replace(/\.[^.]+$/, ''), project_id: project_id ? Number(project_id) : null, status: 'Open' }, user, { system: true });
  try {
    const r = await importBoq(boq.id, buffer, 'append', user);
    saveAttachment('boqs', boq.id, { filename: name, mime, note: 'Work order (imported)' }, buffer, user);
    return { boq: getRow('boqs', boq.id), ...r };
  } catch (e) {
    db.prepare('DELETE FROM boqs WHERE id = ?').run(boq.id);
    throw e;
  }
}

const sentSql = `(SELECT COALESCE(SUM(CAST(json_extract(j.value, '$.qty') AS REAL)), 0) FROM challans c, json_each(c.lines) j
  WHERE c.status IN ('Dispatched','Delivered') AND CAST(json_extract(j.value, '$.boq_item_id') AS INTEGER) = b.id)`;
const boqLine = id => db.prepare(`SELECT b.*, ${sentSql} AS sent FROM boq_items b WHERE b.id = ?`).get(Number(id));
const lineText = b => [b.heading, firstLine(b.description)].filter(Boolean).join(' – ') + (b.sr_no ? ` (BOQ ${b.section} ${b.sr_no})` : ` (BOQ ${b.section})`);

// Check quantities against the work order and build challan lines.
function challanLines(boq, picks, user, force) {
  const lines = [], over = [];
  const need = {};
  for (const p of picks || []) {
    const b = boqLine(p.boq_item_id);
    if (!b || b.boq_id !== boq.id || b.kind === 'Heading') continue;
    const pending = b.qty == null ? null : Math.max(0, b.qty - b.sent);
    const qty = Number(p.qty) > 0 ? Number(p.qty) : pending;
    if (!(qty > 0)) continue;
    need[b.id] = (need[b.id] || 0) + qty;
    if (b.qty != null && b.sent + need[b.id] > b.qty + 1e-9) over.push(`${b.sr_no || ''} ${firstLine(b.description).slice(0, 60)}: WO ${b.qty}, already sent ${b.sent}, now ${need[b.id]}`);
    const itemId = p.item_id ? Number(p.item_id) : b.item_id || null;
    if (p.item_id && !b.item_id) db.prepare('UPDATE boq_items SET item_id = ? WHERE id = ?').run(itemId, b.id); // remember the store item for next time
    lines.push({ boq_item_id: b.id, item_id: itemId, description: lineText(b), uom: b.uom || 'Nos', qty, remark: p.remark || '' });
  }
  if (!lines.length) throw new HttpError(400, 'Pick at least one BOQ line with a quantity to send');
  if (over.length && !(force && hasFunction(user.role, 'allow_negative'))) throw new HttpError(409, `More than the work order quantity:\n${over.join('\n')}`);
  return lines;
}

const CHALLAN_KEYS = ['date', 'ship_to', 'site_contact', 'vehicle_no', 'transporter', 'lr_no', 'driver', 'eway_bill', 'challan_type', 'remarks'];

// Dispatch from the BOQ window: the challan is created automatically (status Dispatched),
// store items on it are issued from stock, and the BOQ shows them as sent.
export function dispatchFromBoq(boqId, body, user) {
  const boq = getRow('boqs', boqId);
  return tx(() => {
    const lines = challanLines(boq, body?.picks, user, body?.force);
    const extra = Object.fromEntries(CHALLAN_KEYS.filter(k => body?.[k]).map(k => [k, body[k]]));
    const ch = insertRow('challans', { ...extra, boq_id: boq.id, project_id: boq.project_id, customer_id: boq.customer_id, status: 'Draft', lines }, user, { system: true });
    const stockLines = lines.filter(l => l.item_id).map(l => ({ item_id: l.item_id, qty: l.qty, remark: l.remark }));
    if (stockLines.length) {
      stockEntry({ type: 'OUTWARD', date: ch.date, doc_no: ch.challan_no, project_id: boq.project_id, issued_to: firstLine(ch.ship_to) || boq.title,
        purpose: `Delivery challan ${ch.challan_no} – ${boq.boq_no}`, lines: stockLines,
        allowNegative: !!body?.allowNegative && hasFunction(user.role, 'allow_negative') }, user);
    }
    updateRow('challans', ch.id, { status: 'Dispatched', issue_no: stockLines.length ? ch.challan_no : null, issue_type: stockLines.length ? 'OUTWARD' : null, dispatched_by: `${user.name} (${new Date().toLocaleString('sv-SE').slice(0, 16)})` }, user, { system: true });
    return { challan: getRow('challans', ch.id), stock_lines: stockLines.length };
  });
}

// Stock Entry → Outward "against a BOQ": the issue and its challan are created together.
export function issueAgainstBoq(body, user) {
  const boq = getRow('boqs', body.boq_id);
  const picks = (body.lines || []).filter(l => l.boq_item_id && Number(l.qty) > 0);
  if (!picks.length) throw new HttpError(400, 'Pick at least one BOQ line with a quantity');
  if (picks.some(l => !l.item_id)) throw new HttpError(400, 'Pick the store item on every line (it is remembered for the next dispatch)');
  return dispatchFromBoq(boq.id, { ...body, picks }, user);
}

// Earlier versions kept BOQ lines per project: give each such project its own BOQ.
export function migrateProjectBoqs() {
  const groups = db.prepare('SELECT project_id, MIN(wo_no) wo FROM boq_items WHERE boq_id IS NULL GROUP BY project_id').all();
  for (const g of groups) {
    const p = g.project_id ? db.prepare('SELECT name, project_no, customer_id FROM projects WHERE id = ?').get(g.project_id) : null;
    const { seq, fy } = nextSeq('boq', new Date().toLocaleString('sv-SE').slice(0, 10));
    const id = Number(db.prepare(`INSERT INTO boqs (boq_no, title, date, project_id, customer_id, wo_no, status, created_by, created_at)
      VALUES (?, ?, date('now','localtime'), ?, ?, ?, 'Open', 'system', datetime('now','localtime'))`)
      .run(`BOQ-${String(seq).padStart(3, '0')}/20${fy}`, p?.name || 'BOQ', g.project_id, p?.customer_id || null, g.wo || p?.project_no || null).lastInsertRowid);
    db.prepare('UPDATE boq_items SET boq_id = ? WHERE boq_id IS NULL AND project_id IS ?').run(id, g.project_id);
    db.prepare('UPDATE challans SET boq_id = ? WHERE boq_id IS NULL AND project_id IS ?').run(id, g.project_id);
    console.log(`  Moved project BOQ lines into "${p?.name || 'BOQ'}" (BOQ id ${id})`);
  }
}

export function dispatchChallan(id, body, user) {
  const ch = getRow('challans', id);
  if (ch.status !== 'Draft') throw new HttpError(400, `Challan is already ${ch.status}`);
  const lines = (ch.lines || []).filter(l => Number(l.qty) > 0);
  if (!lines.length) throw new HttpError(400, 'Add material with quantities first');
  // Do not send more than the work order quantity, unless a manager overrides.
  const over = [];
  const need = {};
  for (const l of lines) if (l.boq_item_id) need[l.boq_item_id] = (need[l.boq_item_id] || 0) + Number(l.qty);
  for (const [bid, q] of Object.entries(need)) {
    const b = boqLine(bid);
    if (b && b.qty != null && b.sent + q > b.qty + 1e-9) over.push(`${b.sr_no || ''} ${firstLine(b.description).slice(0, 60)}: WO ${b.qty}, already sent ${b.sent}, this challan ${q}`);
  }
  const needBom = {};
  for (const l of lines) if (l.bom_item_id) needBom[l.bom_item_id] = (needBom[l.bom_item_id] || 0) + Number(l.qty);
  for (const [bid, q] of Object.entries(needBom)) {
    const b = bomLine(bid);
    if (b && b.sent + q > (b.qty || 0) + 1e-9) over.push(`${b.sr_no || ''} ${bomLineText(b).slice(0, 60)}: BOQ ${b.qty ?? 0}, already sent ${b.sent}, this challan ${q}`);
  }
  if (over.length && !(body?.force && hasFunction(user.role, 'allow_negative'))) {
    throw new HttpError(409, `More than the work order / BOQ quantity:\n${over.join('\n')}`);
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
    updateRow('challans', id, { status: 'Dispatched', issue_no: stockDoc?.doc_no || null, issue_type: stockDoc ? 'OUTWARD' : null, dispatched_by: `${user.name} (${new Date().toLocaleString('sv-SE').slice(0, 16)})` }, user, { system: true });
    return { ...getRow('challans', id), stock_lines: stockLines.length, stock_doc: stockDoc?.doc_no || null };
  });
}

export function deliverChallan(id, body, user) {
  const ch = getRow('challans', id);
  if (ch.status !== 'Dispatched') throw new HttpError(400, 'Only a dispatched challan can be marked delivered');
  return updateRow('challans', id, { status: 'Delivered', received_by: body?.received_by || null, delivered_date: body?.delivered_date || new Date().toLocaleString('sv-SE').slice(0, 10) }, user, { system: true });
}

// ================================================================ BOQ / Bill of Material (WIESPL engineers' format)
// Columns: SR.NO. | COMPONENT NAME | SPECIFICATIONS | DIMENSIONS | QTY | UOM | MOC | DRAWING MODEL NO | Remark | MAKE.
// Section headings (PLENUM, RISER …) are rows with only a title; rows without Sr. No. and component are sizes / variants
// of the component above (Plenum 8x8 / 8x6, HEPA filter 4x2 / 3x2 / 2x2 …).
const BOM_COLS = {
  sr: ['srno', 'sr', 'srnumber', 'slno'],
  component: ['componentname', 'component', 'itemname', 'item', 'particulars', 'materialname', 'material', 'description'],
  spec: ['specifications', 'specification', 'spec', 'specs'],
  dimensions: ['dimensions', 'dimension', 'size', 'sizes'],
  qty: ['qty', 'quantity', 'qnty'],
  uom: ['uom', 'unit', 'units'],
  moc: ['moc', 'materialofconstruction'],
  drawing_no: ['drawingmodelno', 'drawingno', 'modelno', 'drawingmodel', 'drawing'],
  remark: ['remark', 'remarks'],
  make: ['make', 'brand', 'makes'],
};
const BOM_DOWN = ['make', 'moc', 'uom', 'remark']; // a value merged down a column applies to every row it covers

function parseBomSheet(ws) {
  let hdr = null;
  for (let r = 1; r <= Math.min(30, ws.rowCount) && !hdr; r++) {
    const vals = Array.from(ws.getRow(r).values, v => norm(str(v)));
    const col = {};
    for (const [k, names] of Object.entries(BOM_COLS)) {
      const i = vals.findIndex((v, idx) => idx > 0 && names.includes(v) && !Object.values(col).includes(idx));
      if (i > 0) col[k] = i;
    }
    if (col.sr && col.component && (col.qty || col.spec)) hdr = { row: r, col };
  }
  if (!hdr) return null;
  const { col } = hdr;
  const meta = {};
  for (let r = 1; r < hdr.row; r++) ws.getRow(r).eachCell(c => {
    if (c.isMerged && c.master !== c) return;
    const t = str(c.value);
    const cl = t.match(/^client\s*[-:–]+\s*(.+)$/i);
    if (cl && !meta.client) meta.client = cl[1].trim();
    const dt = t.match(/date\s*[-:–]*\s*(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/i);
    if (dt && !meta.date) meta.date = `${dt[3].length === 2 ? '20' + dt[3] : dt[3]}-${dt[2].padStart(2, '0')}-${dt[1].padStart(2, '0')}`;
  });
  // Value a cell holds itself: the parts of a merged block other than its top-left cell count as empty,
  // except where a make / MOC / UOM is merged down its own column.
  const own = (row, key) => {
    if (!col[key]) return '';
    const c = row.getCell(col[key]);
    if (c.isMerged && c.master !== c) {
      if (c.master.col === c.col && BOM_DOWN.includes(key)) return str(c.master.value);
      return '';
    }
    return str(c.value);
  };
  const lines = [];
  let section = '';
  const srSeen = new Set();
  for (let r = hdr.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const v = Object.fromEntries(Object.keys(BOM_COLS).map(k => [k, own(row, k)]));
    const first = v.sr || v.component;
    if (/^prepared\s*by/i.test(first)) {
      meta.prepared_by = first.replace(/^prepared\s*by\s*[:\-–]*\s*/i, '').trim() || null;
      row.eachCell(c => { const m = str(c.value).match(/^approved\s*by\s*[:\-–]*\s*(.*)$/i); if (m && m[1].trim()) meta.approved_by = m[1].trim(); });
      break;
    }
    const filled = Object.entries(v).filter(([, x]) => x);
    if (!filled.length) continue;
    if (filled.length === 1 && /^WIESPL\s*\//i.test(filled[0][1])) continue; // form number in the footer
    const details = ['spec', 'dimensions', 'qty', 'uom', 'moc', 'drawing_no', 'remark', 'make'].some(k => v[k]);
    // A title on its own (in the Sr. No. column, or alone and in capitals in the component column) starts a section.
    if (!details && ((v.sr && !/^\d+(\.\d+)?$/.test(v.sr) && !v.component) || (!v.sr && v.component && v.component === v.component.toUpperCase() && /[A-Z]{3}/.test(v.component)))) {
      section = (v.sr || v.component).replace(/\s+/g, ' ').trim();
      srSeen.clear();
      continue;
    }
    // Numbering starting again at 1 without a heading (e.g. the tools list at the end) is a new group.
    if (v.sr === '1' && srSeen.has('1')) { section = 'OTHER ITEMS'; srSeen.clear(); }
    if (v.sr) srSeen.add(v.sr);
    if (!v.component && !v.sr && !details) continue;
    const qtyNum = col.qty ? num(row.getCell(col.qty).value) : null;
    const qtyRaw = own(row, 'qty');
    lines.push({
      section: section || null, sr_no: v.sr || null, component: v.component || null,
      spec: v.spec || null, dimensions: v.dimensions || null, qty: qtyNum ?? qtyFromText(qtyRaw), qty_text: qtyRaw && qtyNum == null ? qtyRaw : null,
      uom: v.uom || null, moc: v.moc || null, drawing_no: v.drawing_no || null, remark: v.remark || null, make: v.make || null,
    });
  }
  return { sheet: ws.name.trim(), meta, lines };
}

export async function readBomWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not a readable .xlsx file'); }
  const sheets = wb.worksheets.map(parseBomSheet).filter(s => s && s.lines.length);
  if (!sheets.length) throw new HttpError(400, 'No bill of material found. The sheet needs a header row with "SR.NO." and "COMPONENT NAME" (and QTY / SPECIFICATIONS).');
  return sheets;
}

const usedIn = (table, statusSql) => `(SELECT COUNT(*) FROM ${table} p, json_each(p.lines) j WHERE ${statusSql}
  AND CAST(json_extract(j.value, '$.bom_item_id') AS INTEGER) IN (SELECT id FROM bom_items WHERE bom_id = ?))`;
export const bomUsed = bomId => db.prepare(`SELECT ${usedIn('challans', "p.status <> 'Cancelled'")} + ${usedIn('purchase_orders', "p.status <> 'Cancelled'")}
  + ${usedIn('requisitions', "p.status NOT IN ('Rejected', 'Closed')")} n`).get(bomId, bomId, bomId).n;

export async function importBom(bomId, buffer, mode, user) {
  const bom = getRow('boms', bomId);
  const sheets = await readBomWorkbook(buffer);
  const existing = db.prepare('SELECT COUNT(*) n FROM bom_items WHERE bom_id = ?').get(bom.id).n;
  if (existing && mode !== 'append' && mode !== 'replace') throw new HttpError(409, `This BOQ already has ${existing} components. Choose "Add to existing" or "Replace".`);
  return tx(() => {
    if (mode === 'replace' && existing) {
      if (bomUsed(bom.id)) throw new HttpError(409, 'Some components of this BOQ are already on requisitions, POs or challans, so it cannot be replaced. Use "Add to existing" instead.');
      db.prepare('DELETE FROM bom_items WHERE bom_id = ?').run(bom.id);
    }
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM bom_items WHERE bom_id = ?').get(bom.id).m;
    const ins = db.prepare(`INSERT INTO bom_items (bom_id, section, sr_no, component, spec, dimensions, qty, qty_text, uom, moc, drawing_no, remark, make, sort, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`);
    const sections = new Map();
    for (const s of sheets) for (const l of s.lines) {
      ins.run(bom.id, l.section, l.sr_no, l.component, l.spec, l.dimensions, l.qty, l.qty_text, l.uom, l.moc, l.drawing_no, l.remark, l.make, ++sort, user.name);
      const k = l.section || '(no section)';
      sections.set(k, (sections.get(k) || 0) + 1);
    }
    const m = sheets[0].meta;
    const patch = {};
    if (m.client && !bom.client) patch.client = m.client;
    if (m.approved_by && !bom.approved_by) patch.approved_by = m.approved_by;
    if (Object.keys(patch).length) updateRow('boms', bom.id, patch, user, { system: true });
    const summary = [...sections].map(([section, items]) => ({ section, items }));
    audit(user.name, 'boms', bom.id, 'import', summary.map(s => `${s.section}: ${s.items}`).join(', '));
    return { sections: summary, components: summary.reduce((a, s) => a + s.items, 0), meta: m };
  });
}

// New BOQ from the engineers' Excel; the file is kept with the BOQ.
export async function createBomFromFile({ client, project_id, work_order_id, filename, mime }, buffer, user) {
  if (!buffer?.length) throw new HttpError(400, 'Upload the bill of material .xlsx');
  const sheets = await readBomWorkbook(buffer);
  const m = sheets[0].meta;
  const name = String(filename || 'Bill of material.xlsx');
  const bom = insertRow('boms', {
    client: String(client || '').trim() || m.client || name.replace(/\.[^.]+$/, ''), ...(m.date ? { date: m.date } : {}),
    project_id: project_id ? Number(project_id) : null, work_order_id: work_order_id ? Number(work_order_id) : null,
    prepared_by: m.prepared_by || user.name, approved_by: m.approved_by || null, status: 'Draft',
  }, user, { system: true });
  try {
    const r = await importBom(bom.id, buffer, 'append', user);
    saveAttachment('boms', bom.id, { filename: name, mime, note: 'Bill of material (imported)' }, buffer, user);
    return { bom: getRow('boms', bom.id), ...r };
  } catch (e) {
    db.prepare('DELETE FROM bom_items WHERE bom_id = ?').run(bom.id);
    db.prepare('DELETE FROM boms WHERE id = ?').run(bom.id);
    throw e;
  }
}

const bomSentSql = sentSql.replace('$.boq_item_id', '$.bom_item_id');
const bomLine = id => db.prepare(`SELECT b.*, ${bomSentSql} AS sent FROM bom_items b WHERE b.id = ?`).get(Number(id));
// A size / variant row has no component name of its own: it is the one above it ("HEPA Filters" for the 3x2 line).
export function bomComponentName(b) {
  if (b.component) return b.component;
  return db.prepare("SELECT component FROM bom_items WHERE bom_id = ? AND sort < ? AND COALESCE(component, '') <> '' ORDER BY sort DESC LIMIT 1").get(b.bom_id, b.sort ?? 0)?.component || '';
}
export const bomLineText = b => [bomComponentName(b), b.dimensions, b.spec ? firstLine(b.spec).slice(0, 80) : ''].filter(Boolean).join(' – ');

function bomChallanLines(bom, picks, user, force) {
  const lines = [], over = [], need = {};
  for (const p of picks || []) {
    const b = bomLine(p.bom_item_id);
    if (!b || b.bom_id !== bom.id) continue;
    const pending = Math.max(0, (b.qty || 0) - b.sent);
    const qty = Number(p.qty) > 0 ? Number(p.qty) : pending;
    if (!(qty > 0)) continue;
    need[b.id] = (need[b.id] || 0) + qty;
    if (b.sent + need[b.id] > (b.qty || 0) + 1e-9) over.push(`${b.sr_no || ''} ${bomLineText(b).slice(0, 60)}: BOQ ${b.qty ?? 0}, already sent ${b.sent}, now ${need[b.id]}`);
    const itemId = p.item_id ? Number(p.item_id) : b.item_id || null;
    if (p.item_id && !b.item_id) db.prepare('UPDATE bom_items SET item_id = ? WHERE id = ?').run(itemId, b.id); // remembered for next time
    lines.push({ bom_item_id: b.id, item_id: itemId, description: `${bomLineText(b)}${b.section ? ` (BOQ ${b.section}${b.sr_no ? ' ' + b.sr_no : ''})` : ''}`, uom: b.uom || 'Nos', qty, remark: p.remark || '' });
  }
  if (!lines.length) throw new HttpError(400, 'Pick at least one BOQ component with a quantity to send');
  if (over.length && !(force && hasFunction(user.role, 'allow_negative'))) throw new HttpError(409, `More than the BOQ quantity:\n${over.join('\n')}`);
  return lines;
}

// Dispatch from the BOQ window: challan made automatically, store items issued, BOQ shows them as sent.
export function dispatchFromBom(bomId, body, user) {
  const bom = getRow('boms', bomId);
  return tx(() => {
    const lines = bomChallanLines(bom, body?.picks, user, body?.force);
    const extra = Object.fromEntries(CHALLAN_KEYS.filter(k => body?.[k]).map(k => [k, body[k]]));
    const ch = insertRow('challans', { ...extra, bom_id: bom.id, boq_id: bom.work_order_id || null, project_id: bom.project_id, customer_id: bom.customer_id, status: 'Draft', lines }, user, { system: true });
    const stockLines = lines.filter(l => l.item_id).map(l => ({ item_id: l.item_id, qty: l.qty, remark: l.remark }));
    if (stockLines.length) {
      stockEntry({ type: 'OUTWARD', date: ch.date, doc_no: ch.challan_no, project_id: bom.project_id, issued_to: firstLine(ch.ship_to) || bom.client,
        purpose: `Delivery challan ${ch.challan_no} – ${bom.bom_no}`, lines: stockLines,
        allowNegative: !!body?.allowNegative && hasFunction(user.role, 'allow_negative') }, user);
    }
    updateRow('challans', ch.id, { status: 'Dispatched', issue_no: stockLines.length ? ch.challan_no : null, issue_type: stockLines.length ? 'OUTWARD' : null, dispatched_by: `${user.name} (${new Date().toLocaleString('sv-SE').slice(0, 16)})` }, user, { system: true });
    return { challan: getRow('challans', ch.id), stock_lines: stockLines.length };
  });
}

// Stock Entry → Outward "against a BOQ": the issue and its challan are created together.
export function issueAgainstBom(body, user) {
  const bom = getRow('boms', body.bom_id);
  const picks = (body.lines || []).filter(l => l.bom_item_id && Number(l.qty) > 0);
  if (!picks.length) throw new HttpError(400, 'Pick at least one BOQ component with a quantity');
  if (picks.some(l => !l.item_id)) throw new HttpError(400, 'Pick the store item on every line (it is remembered for the next dispatch)');
  return dispatchFromBom(bom.id, { ...body, picks }, user);
}

// Stock Entry → Outward / Transfer with "also make a delivery challan": the issue is already saved,
// so the challan is created straight as Dispatched and does not touch stock again.
export function challanForIssue(body, issue, user) {
  const items = db.prepare('SELECT id, code, name, uom FROM items WHERE id = ?');
  const lines = (body.lines || []).filter(l => l.item_id && Number(l.qty)).map(l => {
    const it = items.get(Number(l.item_id));
    return { item_id: Number(l.item_id), description: it ? `${it.name}${it.code ? ` (${it.code})` : ''}` : '', uom: l.uom || it?.uom || 'Nos', qty: Math.abs(Number(l.qty)), remark: l.remark || '' };
  });
  const c = body.challan || {};
  const extra = Object.fromEntries(CHALLAN_KEYS.filter(k => c[k]).map(k => [k, c[k]]));
  if (!extra.ship_to && body.type === 'TRANSFER' && body.to_location) extra.ship_to = body.to_location;
  const ch = insertRow('challans', {
    ...extra, date: body.date || undefined, project_id: body.project_id || null, issue_no: issue.doc_no, issue_type: body.type, status: 'Dispatched',
    challan_type: c.challan_type || (body.type === 'TRANSFER' ? 'Returnable' : 'Non-Returnable'),
    remarks: c.remarks || body.purpose || null, lines,
    dispatched_by: `${user.name} (${new Date().toLocaleString('sv-SE').slice(0, 16)})`,
  }, user, { system: true });
  return ch;
}
