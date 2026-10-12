// Work order BOQ per project, delivery challans (dispatch) and BOQ delivery status.
import ExcelJS from 'exceljs';
import { db, tx, audit, nextSeq } from './db.js';
import { insertRow, updateRow, getRow, HttpError } from './crud.js';
import { stockEntry } from './stock.js';
import { saveAttachment } from './roles.js';
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
    updateRow('challans', ch.id, { status: 'Dispatched', dispatched_by: `${user.name} (${new Date().toLocaleString('sv-SE').slice(0, 16)})` }, user, { system: true });
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
