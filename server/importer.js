// Excel import: templates, preview with duplicate/error detection, then commit.
// Recognises the WIESPL Smart Store workbook, the vendor address list and the WIESPL PO format automatically.
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { db, tx, bumpSeq, audit } from './db.js';
import { insertRow, updateRow, HttpError } from './crud.js';
import { nextItemCode } from './hooks.js';
import { GST_STATE_CODES, STATES, ITEM_CATEGORIES, UOMS, MOVE_TYPES } from '../public/js/schema.js';
import { fyOf, round2 } from '../public/js/calc.js';

// ---------------------------------------------------------------- helpers
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = s => String(s ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
const now = () => new Date().toLocaleString('sv-SE').slice(0, 19);

function cell(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.error) return null;
    if ('result' in v) return cell(v.result);
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}
const str = v => { const c = cell(v); return c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : clean(c); };
const num = v => { const c = cell(v); if (c == null || c === '') return null; const n = Number(String(c).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
function date(v) {
  const c = cell(v);
  if (c == null || c === '') return null;
  if (c instanceof Date) return new Date(c.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
  if (typeof c === 'number' && c > 20000 && c < 80000) return new Date(Math.round((c - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = String(c).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(c).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}
const gstPct = v => { const n = num(v); return n == null ? null : n > 0 && n < 1 ? round2(n * 100) : n; };
const code = v => { const c = cell(v); if (c == null || c === '') return ''; return typeof c === 'number' ? String(Math.round(c)) : clean(c); };

const UOM_MAP = { nos: 'Nos', no: 'Nos', nose: 'Nos', number: 'Nos', pcs: 'Nos', kg: 'Kg', kgs: 'Kg', mtr: 'Mtr', mtrs: 'Mtr', meter: 'Mtr', rmt: 'Mtr', ft: 'Ft', rft: 'RFt',
  sqft: 'Sq. Ft', sqmt: 'Sq. Mtr', sqmtr: 'Sq. Mtr', sqmts: 'Sq. Mtr', sqm: 'Sq. Mtr', pkt: 'Pkt', packet: 'Pkt', ltr: 'Ltr', litre: 'Ltr', set: 'Set', sets: 'Set', pair: 'Pair',
  roll: 'Roll', box: 'Box', tin: 'Tin', sheet: 'Sheet', coil: 'Coil', cyl: 'Cyl', bandle: 'Bundle', bundle: 'Bundle', tr: 'TR', lot: 'Lot' };
const uom = v => { const s = str(v); return s ? (UOM_MAP[norm(s)] || s) : ''; };
const isUom = v => !!UOM_MAP[norm(v)];
const CATEGORY_MAP = { electricalpart: 'Electrical (BGM)', electrical: 'Electrical (BGM)', boughtoutpart: 'Bought-out', boughtout: 'Bought-out', broughtout: 'Bought-out',
  hardware: 'Hardware', hvac: 'HVAC', rawmaterial: 'Raw Materials', rawmaterials: 'Raw Materials', tools: 'Tools', packingmaterial: 'Packaging', packaging: 'Packaging',
  finishedgoods: 'Finished Goods', rd: 'R&D (Electronic)', rdelectronic: 'R&D (Electronic)', electronic: 'R&D (Electronic)' };
const category = v => { const s = str(v); return CATEGORY_MAP[norm(s)] || (ITEM_CATEGORIES.includes(s) ? s : s ? s : 'Bought-out'); };
const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3})\b/;
// Summary rows at the bottom of a sheet ("Total", "Total Names", "Grand Total").
// Total lines and repeated header lines ("FG Code | FG Name") are not items.
const isTotalRow = (c, name) => /^(grand\s*)?total\b/i.test(String(name || '').trim()) || /^(grand\s*)?total$/i.test(String(c || '').trim())
  || /^(fg\s*)?(part\s*)?(item\s*)?code$/i.test(String(c || '').trim()) || /^(fg\s*)?(part\s*)?(item\s*)?name$/i.test(String(name || '').trim());

function headerIndex(ws, mustHave, maxRow = 15) {
  for (let r = 1; r <= Math.min(maxRow, ws.rowCount); r++) {
    const vals = Array.from(ws.getRow(r).values, v => norm(str(v)));
    if (mustHave.every(h => vals.includes(h))) return { row: r, cols: Object.fromEntries(vals.map((v, i) => [v, i]).filter(([v]) => v)) };
  }
  return null;
}
function* dataRows(ws, startRow) {
  for (let r = startRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    yield [r, row];
  }
}
const pick = (row, cols, ...names) => { for (const n of names) if (cols[n] != null) return row.getCell(cols[n]).value; return null; };

// ---------------------------------------------------------------- lookups against the database
function lookups() {
  const items = db.prepare('SELECT id, code, name FROM items').all();
  const vendors = db.prepare('SELECT id, name, gstin FROM vendors').all();
  const projects = db.prepare('SELECT id, project_no, code, name FROM projects').all();
  return {
    itemByCode: new Map(items.filter(i => i.code).map(i => [String(i.code).trim(), i.id])),
    itemByName: new Map(items.map(i => [norm(i.name), i.id])),
    vendorByGst: new Map(vendors.filter(v => v.gstin).map(v => [v.gstin.toUpperCase(), v.id])),
    vendorByName: new Map(vendors.map(v => [norm(v.name), v.id])),
    projectByNo: new Map(projects.flatMap(p => [[norm(p.project_no), p.id], [norm(p.code), p.id], [norm(p.name), p.id]]).filter(([k]) => k)),
    poByNo: new Map(db.prepare('SELECT id, po_no FROM purchase_orders').all().map(p => [norm(p.po_no), p.id])),
    reqByNo: new Map(db.prepare('SELECT id, req_no FROM requisitions').all().map(p => [norm(p.req_no), p.id])),
  };
}

// A plan is a list of operations; each has a label for the preview, errors, and whether it duplicates an existing record.
function newPlan(kind, hash) {
  const plan = { kind, hash, ops: [], sheets: {} };
  const prior = db.prepare('SELECT at, user FROM import_batches WHERE file_hash = ? ORDER BY id DESC LIMIT 1').get(hash);
  if (prior) plan.warning = `This exact file was already imported on ${prior.at} by ${prior.user}. Rows already in the CRM are skipped automatically, so only new rows are added.`;
  plan.priorBatch = !!prior;
  return plan;
}
function addOp(plan, op) {
  plan.ops.push(op);
  const s = (plan.sheets[op.sheet] ||= { sheet: op.sheet, total: 0, new: 0, duplicate: 0, error: 0 });
  s.total++;
  s[op.errors?.length ? 'error' : op.dupId ? 'duplicate' : 'new']++;
}

// ---------------------------------------------------------------- item / vendor builders shared by several formats
function itemResolver(plan, L) {
  const pendingByCode = new Map(), pendingByName = new Map();
  return function resolve(itemCode, name, extra = {}, sheet = 'Items (new)') {
    const c = String(itemCode || '').trim();
    if (c && L.itemByCode.has(c)) return { id: L.itemByCode.get(c) };
    if (c && pendingByCode.has(c)) return { ref: pendingByCode.get(c) };
    const nm = norm(name);
    if (!c && nm && L.itemByName.has(nm)) return { id: L.itemByName.get(nm) };
    if (nm && pendingByName.has(nm)) return { ref: pendingByName.get(nm) };
    if (!name && !c) return { error: 'No item code or name' };
    if (!name) return { error: `Item code ${c} not found in the item master` };
    const op = { sheet, kind: 'item', label: `${c || '(new code)'} · ${name}`, data: { code: c || null, name: clean(name), category: extra.category || 'Bought-out', uom: extra.uom || 'Nos', rate: extra.rate ?? 0, gst_rate: extra.gst ?? 18, hsn: extra.hsn || null }, errors: [], autoCreated: true, nameOnly: true }; // not in the Item Master: only created if the user ticks the option
    addOp(plan, op);
    if (c) pendingByCode.set(c, op);
    if (nm) pendingByName.set(nm, op);
    return { ref: op };
  };
}

function parseVendorBlock(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(clean).filter(Boolean);
  if (!lines.length) return null;
  const name = lines[0].replace(/[,.]+$/, '');
  const gstin = (raw.toUpperCase().match(GSTIN_RE) || [])[1] || null;
  const emails = [...new Set((raw.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).map(e => e.toLowerCase()))];
  const rest = lines.slice(1).join(', ');
  const phones = [...new Set((rest.replace(GSTIN_RE, '').match(/(\+?\d[\d\s-]{8,}\d)/g) || []).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.replace(/\D/g, '').length >= 10 && !/^\d{3}\s?\d{3}$/.test(p)))];
  let address = rest
    .replace(/(GSTIN?(\/UIN)?|GST\s*No\.?)\s*[:/–-]?\s*\d{2}[A-Z0-9]{13}/gi, '')
    .replace(/(e-?mail|mail id|email id)\s*[:–-]?\s*/gi, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '');
  for (const p of phones) address = address.replace(p, '');
  address = address.replace(/\s*,\s*(,\s*)+/g, ', ').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
  const pinMatch = [...address.matchAll(/\b(\d{3})\s?(\d{3})\b/g)].pop();
  const pincode = pinMatch ? pinMatch[1] + pinMatch[2] : null;
  let city = null;
  if (pinMatch) {
    const before = address.slice(0, pinMatch.index).replace(/[\s,–-]+$/, '');
    city = (before.match(/([A-Za-z][A-Za-z .]+)$/) || [])[1]?.trim() || null;
    if (city && city.split(' ').length > 3) city = city.split(' ').slice(-2).join(' ');
  }
  const state = gstin && GST_STATE_CODES[gstin.slice(0, 2)] || STATES.find(s => s !== 'Other' && address.toLowerCase().includes(s.toLowerCase())) || null;
  return { name, gstin, pan: gstin ? gstin.slice(2, 12) : null, emails: emails.join('\n') || null, phone: phones.join(' / ') || null, address: address || null, pincode, city, state };
}

function vendorOp(plan, L, v, sheet, seen) {
  const key = v.gstin ? `G:${v.gstin}` : `N:${norm(v.name)}`;
  if (seen.has(key)) { // same vendor on both sheets: fill blanks on the first entry
    const first = seen.get(key);
    for (const [k, val] of Object.entries(v)) if (val && !first.data[k]) first.data[k] = val;
    first.data.incomplete = !(first.data.gstin && first.data.emails) ? 'Yes' : 'No';
    return first;
  }
  const dupId = (v.gstin && L.vendorByGst.get(v.gstin)) || L.vendorByName.get(norm(v.name)) || null;
  const errors = v.name ? [] : ['Vendor name missing'];
  const op = { sheet, kind: 'vendor', label: `${v.name}${v.gstin ? ' · ' + v.gstin : ''}`, data: { ...v, incomplete: v.gstin && v.emails ? 'No' : 'Yes' }, dupId, errors };
  addOp(plan, op);
  seen.set(key, op);
  return op;
}

// ---------------------------------------------------------------- format: WIESPL Smart Store workbook
function parseStoreWorkbook(wb, plan) {
  const L = lookups();
  const resolveItem = itemResolver(plan, L);
  const im = wb.getWorksheet('Item Master');
  let firstDate = null;
  const inwSheet = wb.getWorksheet('Inward');
  if (inwSheet) for (const [, row] of dataRows(inwSheet, 2)) { const d = date(row.getCell(2).value); if (d && (!firstDate || d < firstDate)) firstDate = d; }
  const fy = fyOf(firstDate || new Date().toISOString().slice(0, 10));
  const openingDate = `20${fy.slice(0, 2)}-04-01`;
  plan.openingDate = openingDate;

  // Item master (+ 1 April opening stock)
  const masterRef = new Map();
  if (im) {
    const h = headerIndex(im, ['itemcode', 'itemname']);
    for (const [r, row] of dataRows(im, (h?.row || 1) + 1)) {
      const c = code(pick(row, h.cols, 'itemcode')), name = str(pick(row, h.cols, 'itemname'));
      if (!c || !name) continue; // placeholder rows (code with no name yet) are skipped
      if (isTotalRow(c, name)) continue;
      if (norm(c) === 'itemcode' || !/^[\w-]+$/.test(c)) continue;
      const data = { code: c, name, category: category(pick(row, h.cols, 'deparment', 'department', 'category')), rate: num(pick(row, h.cols, 'price')) ?? 0,
        gst_rate: gstPct(pick(row, h.cols, 'gst')) ?? 18, uom: uom(pick(row, h.cols, 'uom')) || 'Nos' };
      const dupId = L.itemByCode.get(c) || null;
      const op = { sheet: 'Item Master', n: r, kind: 'item', label: `${c} · ${name}`, data, dupId, errors: name ? [] : ['Item name missing'] };
      addOp(plan, op);
      masterRef.set(c, op);
      const opening = num(pick(row, h.cols, 'openingstock'));
      if (opening) addOp(plan, { sheet: 'Opening Stock', n: r, kind: 'move', label: `${c} · ${name}: ${opening}`, item: { ref: op, id: dupId }, data: { type: 'OPENING', date: openingDate, doc_no: `OPN/20${fy}`, qty: opening, uom: data.uom, rate: data.rate }, errors: [] });
    }
  }
  const itemFor = (c, name, extra, sheet) => {
    const cc = String(c || '').trim();
    if (cc && masterRef.has(cc)) { const op = masterRef.get(cc); return op.dupId ? { id: op.dupId } : { ref: op }; }
    return resolveItem(cc, name, extra, sheet);
  };

  // Finished goods part list (FG001 ...)
  const fgp = wb.getWorksheet('FG Part Summary');
  if (fgp) {
    const h = headerIndex(fgp, ['fgpartcode', 'fgpartname']);
    if (h) for (const [r, row] of dataRows(fgp, h.row + 1)) {
      const c = code(pick(row, h.cols, 'fgpartcode')), name = str(pick(row, h.cols, 'fgpartname'));
      if (!c || !name || masterRef.has(c) || isTotalRow(c, name)) continue;
      const op = { sheet: 'FG Part Summary', n: r, kind: 'item', label: `${c} · ${name}`, data: { code: c, name, category: 'Finished Goods', uom: 'Nos', rate: 0, gst_rate: 18, description: str(pick(row, h.cols, 'sizeremark')) || null }, dupId: L.itemByCode.get(c) || null, errors: [] };
      addOp(plan, op);
      masterRef.set(c, op);
    }
  }

  const moveSheet = (name, must, build) => {
    const ws = wb.getWorksheet(name);
    if (!ws) return;
    const h = headerIndex(ws, must);
    if (!h) { addOp(plan, { sheet: name, kind: 'note', label: 'Header row not recognised', errors: ['Header row not recognised'] }); return; }
    for (const [r, row] of dataRows(ws, h.row + 1)) {
      const g = (...n) => pick(row, h.cols, ...n);
      const m = build(g);
      if (!m) continue;
      if (!m.date && !(Number(m.qty) > 0)) continue; // blank pre-filled rows at the end of the sheet
      if (isTotalRow(m.code, m.name)) continue;
      const errors = [];
      if (!m.date) errors.push('Date missing');
      if (!(Number(m.qty) > 0)) errors.push('Quantity missing');
      const it = itemFor(m.code, m.name, { uom: m.uom, rate: m.rate, category: m.category, hsn: m.hsn }, `Items created from ${name}`);
      if (it.error) errors.push(it.error);
      delete m.code; delete m.name; delete m.category;
      addOp(plan, { sheet: name, n: r, kind: 'move', label: `${m.type} ${m.doc_no || ''} · ${it.ref?.data?.name || it.ref?.label || m.label || ''}`, item: it, data: m, errors });
    }
  };
  const seqDoc = (v, d) => { const s = str(v); if (!s) return null; if (/^\d+$/.test(s)) return `${s.padStart(3, '0')}/20${fyOf(d || openingDate)}`; return s; };

  moveSheet('Inward', ['inwarddate', 'qty'], g => {
    const d = date(g('inwarddate'));
    const supplier = str(g('supplier'));
    return { type: 'INWARD', date: d, doc_no: seqDoc(g('grnno'), d), code: code(g('itemcode')), name: str(g('itemname')), qty: num(g('qty')), uom: uom(g('uom')),
      rate: num(g('basicprice')) ?? 0, hsn: str(g('hsncode')) || null, supplier: supplier || null, vendor_id: L.vendorByName.get(norm(supplier)) || null,
      invoice_no: str(g('invoiceno')) || null, invoice_date: date(g('invoicedate')), po_no: str(g('pono')) || null, remarks: str(g('remark')) || null, gst_rate: gstPct(g('gst')) };
  });
  moveSheet('Outward', ['date', 'qty'], g => {
    const pc = str(g('projectcode'));
    return { type: 'OUTWARD', date: date(g('date')), doc_no: str(g('issueno')) || null, code: code(g('itemcode')), name: str(g('itemname')), qty: num(g('qty')), uom: uom(g('uom')),
      rate: num(g('price')) ?? 0, issued_to: str(g('department')) || null, project_id: L.projectByNo.get(norm(pc)) || null, purpose: pc || null };
  });
  moveSheet('Material Transfer', ['date', 'qty'], g => ({ type: 'TRANSFER', date: date(g('date')), doc_no: str(g('transferno')) || null, code: code(g('itemcode')),
    name: str(g('materialdescription')), qty: num(g('qty')), uom: uom(g('unit')), rate: num(g('price')) ?? 0, from_location: str(g('fromlocation')) || 'Store',
    to_location: str(g('tolocation')) || null, purpose: str(g('purpose')) || null }));
  moveSheet('Return Material', ['date', 'returnqty'], g => {
    const u = str(g('uom'));
    return { type: 'RETURN', date: date(g('date')), code: code(g('itemcode')), name: str(g('itemname')), qty: num(g('returnqty')), uom: isUom(u) ? uom(u) : '',
      issued_to: str(g('projectcode')) || null, against_issue_no: str(g('issueno')) || null, reason: !isUom(u) && u ? u : null };
  });
  moveSheet('Scrap Material', ['date', 'scrapqty'], g => ({ type: 'SCRAP', date: date(g('date')), code: code(g('itemcode')), name: str(g('itemname')), qty: num(g('scrapqty')),
    issued_to: str(g('projectcode')) || null, reason: str(g('scraptype')) || null, remarks: str(g('remark')) || null }));
  moveSheet('FG Inward', ['inwarddate', 'qty'], g => {
    const d = date(g('inwarddate'));
    const notes = [str(g('sitename')) && `Site: ${str(g('sitename'))}`, str(g('size')) && `Size: ${str(g('size'))}`, str(g('rmcode')) && `RM ${str(g('rmcode'))} × ${str(g('rmconsumedqty'))}`, str(g('remark'))].filter(Boolean).join('; ');
    return { type: 'INWARD', date: d, doc_no: str(g('mtnno')) ? `MTN ${str(g('mtnno'))}` : null, code: code(g('itemcode')), name: str(g('itemname')), category: 'Finished Goods',
      qty: num(g('qty')), uom: uom(g('uom')), rate: 0, supplier: 'Production (Finished Goods)', remarks: notes || null };
  });
}

// ---------------------------------------------------------------- format: vendor address list (Details / Details-1)
function parseVendorWorkbook(wb, plan) {
  const L = lookups();
  const seen = new Map();
  for (const ws of wb.worksheets) {
    const single = headerIndex(ws, ['companyaddress']);
    if (single) {
      const col = single.cols.companyaddress;
      for (const [r, row] of dataRows(ws, single.row + 1)) {
        const text = str(row.getCell(col).value) ? cell(row.getCell(col).value) : '';
        const v = parseVendorBlock(text);
        if (v) vendorOp(plan, L, v, ws.name, seen);
      }
      continue;
    }
    const cols = headerIndex(ws, ['suppliername']);
    if (cols) {
      for (const [r, row] of dataRows(ws, cols.row + 1)) {
        const g = (...n) => pick(row, cols.cols, ...n);
        const name = str(g('suppliername'));
        if (!name || norm(name) === 'suppliername') continue;
        const gstin = (str(g('gst', 'gstin', 'gstno')).toUpperCase().match(GSTIN_RE) || [])[1] || null;
        const address = str(g('city', 'address'));
        const pin = [...address.matchAll(/\b(\d{3})\s?(\d{3})\b/g)].pop();
        const emails = (str(g('email')).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).map(e => e.toLowerCase());
        vendorOp(plan, L, {
          name, gstin, pan: gstin ? gstin.slice(2, 12) : null, address: address || null, pincode: pin ? pin[1] + pin[2] : null,
          city: (address.match(/([A-Za-z][A-Za-z .]+?)\s*[-–]?\s*\d{3}\s?\d{3}\b/) || [])[1]?.trim() || null,
          state: gstin && GST_STATE_CODES[gstin.slice(0, 2)] || null, phone: str(g('contact')) || null, emails: emails.join('\n') || null,
        }, ws.name, seen);
      }
    }
  }
}

// ---------------------------------------------------------------- format: one WIESPL purchase order sheet
function parsePOSheet(ws, plan, L, resolveVendor) {
  const at = (addr) => cell(ws.getCell(addr).value);
  const noA = str(at('B3')), noB = str(at('C3'));
  const fyText = noB.replace(/^(\d{4})\D(\d{2,4})$/, (m, a, b) => `${a}-${b.slice(-2)}`);
  const poNo = noA ? `${noA.padStart(3, '0')}${fyText ? '/' + fyText : ''}` : null;
  const poDate = date(at('B4'));
  const vendorText = String(at('A7') || '');
  const v = parseVendorBlock(vendorText);
  let hdr = null;
  for (let r = 10; r <= 30 && !hdr; r++) if (norm(str(ws.getCell(`B${r}`).value)) === 'itemname') hdr = r;
  const lines = [];
  const terms = {};
  let note = null;
  const names = {};
  if (hdr) {
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const e = str(ws.getCell(`E${r}`).value);
      if (/^sub\s*total$/i.test(e)) break;
      let desc = str(ws.getCell(`B${r}`).value);
      const hsn = code(ws.getCell(`C${r}`).value), sr = num(ws.getCell(`A${r}`).value);
      let spec = cell(ws.getCell(`D${r}`).value);
      spec = spec ? String(spec).replace(/\r/g, '').trim() : '';
      const qty = num(ws.getCell(`E${r}`).value);
      if (!desc && !spec && qty == null) continue;
      // A numbered line without an item name: its first specification line is the item name.
      if (!desc && sr != null && spec) { const [first, ...rest] = spec.split('\n'); desc = first.trim(); spec = rest.join('\n').trim(); }
      lines.push({ description: desc || '', hsn: hsn || '', spec, qty, uom: uom(ws.getCell(`F${r}`).value), rate: num(ws.getCell(`G${r}`).value), gst: gstPct(ws.getCell(`H${r}`).value) ?? 18 });
    }
  }
  const TERM_KEYS = { advance: 'term_advance', balance: 'term_balance', delivery: 'term_delivery', warranty: 'term_warranty', freight: 'term_freight', validity: 'term_validity', invoicecopies: 'term_invoice', jurisdiction: 'term_jurisdiction' };
  ws.eachRow((row, r) => {
    const b = norm(str(row.getCell(2).value));
    for (const [k, f] of Object.entries(TERM_KEYS)) if (b.startsWith(k) && str(row.getCell(3).value)) terms[f] = str(row.getCell(3).value);
    if (norm(str(row.getCell(1).value)) === 'note') note = str(row.getCell(2).value);
    if (norm(str(row.getCell(1).value)) === 'preparedby') {
      const nr = ws.getRow(r + 2);
      names.prepared_by = str(nr.getCell(1).value) || null;
      names.tech_approved_by = str(nr.getCell(4).value) || null;
      names.comm_approved_by = str(nr.getCell(5).value) || null;
      names.approved_by = str(nr.getCell(8).value) || null;
    }
  });
  const errors = [];
  if (!poNo) errors.push('PO number not found in B3/C3');
  if (!poDate) errors.push('PO date not found in B4');
  if (!lines.length) errors.push('No item lines found');
  const vendor = v ? resolveVendor(v) : null;
  if (!vendor) errors.push('Vendor not found in A7');
  addOp(plan, {
    sheet: ws.name, kind: 'po', label: `${poNo} · ${v?.name || ''} · ${lines.length} line(s)`, vendor, dupId: poNo ? L.poByNo.get(norm(poNo)) || null : null, errors,
    data: { po_no: poNo, date: poDate, lines, ...terms, project_note: note, quotation_ref: str(at('A14')).replace(/^Ref\.?:-?\s*/i, '') || null, delivery_address: str(at('D7')) || null, status: 'Closed', ...names },
  });
}

// ---------------------------------------------------------------- simple templates
export const TEMPLATES = {
  items: { title: 'Item Master', cols: ['Item Code', 'Item Name', 'Category', 'UOM', 'Current Price', 'GST %', 'HSN Code', 'Minimum Stock Level', 'Preferred Vendor', 'Location', 'Specification'],
    example: ['1801', 'Diffuser Aluminium Size - 450 x 450', 'Bought-out', 'Nos', 596, 18, '84159000', 5, 'VRS Engineering', 'Rack A1', ''] },
  opening: { title: 'Opening Stock (1 April)', cols: ['Item Code', 'Item Name', 'Opening Qty', 'Price per Piece', 'Date'], example: ['1001', 'Diffuser Aluminium Size - 450 x 450', 13, 596, '2026-04-01'] },
  stock: { title: 'Stock Movements', cols: ['Type', 'Date', 'Doc No', 'Item Code', 'Item Name', 'Qty', 'UOM', 'Price per Piece', 'Supplier', 'Invoice No', 'Invoice Date', 'PO No', 'Project No', 'Issued To / Site', 'From Location', 'To Location', 'Original Issue No', 'Reason', 'Remarks'],
    example: ['OUTWARD', '2026-04-02', '001/2026-27', '1001', '', 2, 'Nos', 596, '', '', '', '', '', 'DY Patil Pune', '', '', '', '', ''], note: `Type: ${Object.keys(MOVE_TYPES).join(', ')}` },
  vendors: { title: 'Vendors', cols: ['Vendor Name', 'GSTIN', 'PAN', 'Address', 'City', 'State', 'Pincode', 'Contact Person', 'Phone', 'Emails', 'Category Supplied', 'Payment Terms'],
    example: ['VRS Engineering', '27AGOPT4035C1ZB', '', 'Plot No.275, Sector 7, PCNTDA Bhosari', 'Pune', 'Maharashtra', '411026', '', '', 'vrsengineering9@gmail.com', 'SS sheets', ''] },
  projects: { title: 'Projects', cols: ['Project No', 'Project Name', 'Client', 'Site', 'Work Order Date', 'Status'], example: ['WIESPL / 1001 / 04/2026-27', 'H V Desai - Pune Lasik OT', 'PBMA H V Desai Eye Hospital', 'Pune', '2026-04-15', 'Active'] },
  purchase_orders: { title: 'Purchase Orders (one row per line)', cols: ['PO No', 'PO Date', 'Vendor Name', 'Vendor GSTIN', 'Project No', 'Item Code', 'Item Name', 'HSN', 'Specification', 'Qty', 'UOM', 'Rate', 'GST %', 'Status', 'Received Qty'],
    example: ['008/2025-26', '2026-04-08', 'Venti-Tron Enterprises Pvt Ltd', '09AAJCV5514E1Z9', 'WIESPL / 1010 / 01/2025-26', '', 'Fire Damper', '84798999', 'Size 850 x 350 mm', 2, 'Nos', 2595, 18, 'Closed', 2] },
  requisitions: { title: 'Requisitions (one row per line)', cols: ['Req No', 'Date', 'Project', 'Requested By', 'Item Code', 'Material Description', 'Specification', 'Qty', 'UOM', 'Remark', 'Status'],
    example: ['REQ-001/2026-27', '2026-04-10', 'WIESPL / 1001 / 04/2026-27', 'Vilas', '', 'SS 304 sheet 1.2 mm', '1250 x 2500', 4, 'Nos', 'Urgent', 'Approved'] },
};

export async function templateFile(kind) {
  const t = TEMPLATES[kind];
  if (!t) throw new HttpError(404, 'Unknown template');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.replace(/[*?:\\/[\]]/g, '-').slice(0, 31));
  const hdr = ws.addRow(t.cols);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E9A' } }; });
  ws.addRow(t.example);
  ws.getRow(2).font = { italic: true, color: { argb: 'FF7A8699' } };
  t.cols.forEach((_, i) => { ws.getColumn(i + 1).width = 20; });
  if (t.note) ws.getCell(4, 1).value = t.note;
  if (kind === 'items') ws.getCell(4, 1).value = `Categories: ${ITEM_CATEGORIES.join(', ')} · UOM: ${UOMS.join(', ')} · Leave Item Code blank for the next number. Delete the example row.`;
  return wb.xlsx.writeBuffer();
}

function parseTemplate(kind, ws, plan) {
  const L = lookups();
  const resolveItem = itemResolver(plan, L);
  const t = TEMPLATES[kind];
  const h = headerIndex(ws, [norm(t.cols[0]), norm(t.cols[1])]);
  if (!h) throw new HttpError(400, `Could not find the template header row (${t.cols.slice(0, 3).join(', ')} …). Download the template and keep its first row.`);
  const groups = new Map();
  for (const [r, row] of dataRows(ws, h.row + 1)) {
    const g = (...n) => pick(row, h.cols, ...n.map(norm));
    const exampleRow = r === h.row + 1 && String(cell(row.getCell(1).value) ?? '') === String(t.example[0]);
    if (exampleRow) continue;
    if (kind === 'items') {
      const c = code(g('Item Code')), name = str(g('Item Name'));
      if (!c && !name) continue;
      if (isTotalRow(c, name)) continue;
      const vendorName = str(g('Preferred Vendor'));
      addOp(plan, { sheet: ws.name, n: r, kind: 'item', label: `${c || '(next code)'} · ${name}`, dupId: (c && L.itemByCode.get(c)) || (!c && L.itemByName.get(norm(name))) || null, errors: name ? [] : ['Item name missing'],
        data: { code: c || null, name, category: category(g('Category')), uom: uom(g('UOM')) || 'Nos', rate: num(g('Current Price')) ?? 0, gst_rate: gstPct(g('GST %')) ?? 18,
          hsn: str(g('HSN Code')) || null, reorder_level: num(g('Minimum Stock Level')) ?? 0, preferred_vendor_id: L.vendorByName.get(norm(vendorName)) || null, location: str(g('Location')) || null, description: str(g('Specification')) || null } });
    } else if (kind === 'opening' || kind === 'stock') {
      const c = code(g('Item Code')), name = str(g('Item Name'));
      if (!c && !name) continue;
      const type = kind === 'opening' ? 'OPENING' : str(g('Type')).toUpperCase();
      const d = date(g('Date')) || (kind === 'opening' ? `20${fyOf(new Date().toISOString().slice(0, 10)).slice(0, 2)}-04-01` : null);
      const qty = num(g(kind === 'opening' ? 'Opening Qty' : 'Qty'));
      const errors = [];
      if (!MOVE_TYPES[type]) errors.push(`Unknown type "${type}"`);
      if (!d) errors.push('Date missing');
      if (qty == null || (type !== 'ADJUST' && qty <= 0)) errors.push('Quantity missing');
      const rate = num(g('Price per Piece'));
      if (type === 'INWARD' && rate == null) errors.push('Price per piece is required for Inward');
      const it = resolveItem(c, name, { uom: uom(g('UOM')), rate: rate ?? 0 });
      if (it.error) errors.push(it.error);
      const supplier = str(g('Supplier')), proj = str(g('Project No'));
      addOp(plan, { sheet: ws.name, n: r, kind: 'move', label: `${type} ${c} ${name}`, item: it, errors,
        data: { type, date: d, doc_no: str(g('Doc No')) || (type === 'OPENING' ? `OPN/20${fyOf(d || '2026-04-01')}` : null), qty: type === 'ADJUST' ? qty : Math.abs(qty || 0), uom: uom(g('UOM')) || null, rate,
          supplier: supplier || null, vendor_id: L.vendorByName.get(norm(supplier)) || null, invoice_no: str(g('Invoice No')) || null, invoice_date: date(g('Invoice Date')),
          po_no: str(g('PO No')) || null, po_id: L.poByNo.get(norm(str(g('PO No')))) || null, project_id: L.projectByNo.get(norm(proj)) || null, issued_to: str(g('Issued To / Site')) || null,
          from_location: str(g('From Location')) || null, to_location: str(g('To Location')) || null, against_issue_no: str(g('Original Issue No')) || null, reason: str(g('Reason')) || null, remarks: str(g('Remarks')) || null } });
    } else if (kind === 'vendors') {
      const name = str(g('Vendor Name'));
      if (!name) continue;
      const gstin = (str(g('GSTIN')).toUpperCase().match(GSTIN_RE) || [])[1] || null;
      vendorOp(plan, L, { name, gstin, pan: str(g('PAN')) || (gstin ? gstin.slice(2, 12) : null), address: str(g('Address')) || null, city: str(g('City')) || null,
        state: (gstin && GST_STATE_CODES[gstin.slice(0, 2)]) || str(g('State')) || null, pincode: str(g('Pincode')) || null, contact_person: str(g('Contact Person')) || null,
        phone: str(g('Phone')) || null, emails: str(g('Emails')).split(/[,;\s/]+/).filter(e => e.includes('@')).join('\n') || null, category: str(g('Category Supplied')) || null,
        payment_terms: str(g('Payment Terms')) || null }, ws.name, plan._seen ||= new Map());
    } else if (kind === 'projects') {
      const no = str(g('Project No')), name = str(g('Project Name'));
      if (!no && !name) continue;
      addOp(plan, { sheet: ws.name, n: r, kind: 'project', label: `${no} · ${name}`, dupId: L.projectByNo.get(norm(no || name)) || null, errors: name ? [] : ['Project name missing'],
        data: { project_no: no || null, name, site: str(g('Site')) || null, work_order_date: date(g('Work Order Date')), status: str(g('Status')) || 'Active', client_name: str(g('Client')) || null } });
    } else if (kind === 'purchase_orders' || kind === 'requisitions') {
      const no = str(g(kind === 'purchase_orders' ? 'PO No' : 'Req No'));
      if (!no) continue;
      if (!groups.has(no)) groups.set(no, { rows: [], first: r });
      groups.get(no).rows.push(g);
    }
  }
  if (kind === 'purchase_orders') {
    const seenV = new Map();
    for (const [no, { rows, first }] of groups) {
      const g0 = rows[0];
      const errors = date(g0('PO Date')) ? [] : ['PO date missing'];
      const vName = str(g0('Vendor Name')), vGst = (str(g0('Vendor GSTIN')).toUpperCase().match(GSTIN_RE) || [])[1] || null;
      const vendor = (vGst && L.vendorByGst.get(vGst)) ? { id: L.vendorByGst.get(vGst) } : L.vendorByName.get(norm(vName)) ? { id: L.vendorByName.get(norm(vName)) }
        : vName ? { ref: vendorOp(plan, L, { name: vName, gstin: vGst, state: vGst && GST_STATE_CODES[vGst.slice(0, 2)] || null }, 'Vendors (new)', seenV) } : null;
      if (!vendor) errors.push('Vendor name missing');
      const lines = rows.map(g => {
        const c = code(g('Item Code'));
        return { item_id: (c && L.itemByCode.get(c)) || null, description: str(g('Item Name')), hsn: str(g('HSN')), spec: str(g('Specification')), qty: num(g('Qty')), uom: uom(g('UOM')) || 'Nos', rate: num(g('Rate')) ?? 0, gst: gstPct(g('GST %')) ?? 18, received: num(g('Received Qty')) || 0 };
      });
      addOp(plan, { sheet: ws.name, n: first, kind: 'po', label: `${no} · ${vName} · ${lines.length} line(s)`, vendor, dupId: L.poByNo.get(norm(no)) || null, errors,
        data: { po_no: no, date: date(g0('PO Date')), project_id: L.projectByNo.get(norm(str(g0('Project No')))) || null, lines, status: str(g0('Status')) || 'Approved' } });
    }
  }
  if (kind === 'requisitions') {
    for (const [no, { rows, first }] of groups) {
      const g0 = rows[0];
      const proj = str(g0('Project'));
      const lines = rows.map(g => ({ item_id: L.itemByCode.get(code(g('Item Code'))) || null, description: str(g('Material Description')), spec: str(g('Specification')), qty: num(g('Qty')), uom: uom(g('UOM')) || 'Nos', remark: str(g('Remark')) }));
      addOp(plan, { sheet: ws.name, n: first, kind: 'req', label: `${no} · ${proj} · ${lines.length} line(s)`, dupId: L.reqByNo.get(norm(no)) || null, errors: date(g0('Date')) ? [] : ['Date missing'],
        data: { req_no: no, date: date(g0('Date')), project_id: L.projectByNo.get(norm(proj)) || null, project_name: proj || null, requested_by: str(g0('Requested By')) || null, lines, status: str(g0('Status')) || 'Approved' } });
    }
  }
}

// ---------------------------------------------------------------- preview / commit
const plans = new Map();

export async function preview(kind, buffer, user) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not a readable .xlsx file. Save it as Excel Workbook (.xlsx) and try again.'); }
  const names = wb.worksheets.map(w => w.name);
  let detected;
  const plan = newPlan(kind, hash);
  if (names.includes('Item Master') && (names.includes('Inward') || names.includes('Outward'))) {
    detected = 'WIESPL Smart Store workbook';
    parseStoreWorkbook(wb, plan);
  } else if (wb.worksheets.some(ws => headerIndex(ws, ['companyaddress']) || headerIndex(ws, ['suppliername']))) {
    detected = 'Vendor address list';
    parseVendorWorkbook(wb, plan);
  } else if (wb.worksheets.some(ws => norm(str(ws.getCell('A3').value)) === 'pono' && norm(str(ws.getCell('D3').value)) === 'purchaseorder')) {
    detected = 'WIESPL purchase order';
    const L = lookups();
    const seen = new Map();
    const resolveVendor = v => (v.gstin && L.vendorByGst.get(v.gstin)) ? { id: L.vendorByGst.get(v.gstin) } : L.vendorByName.get(norm(v.name)) ? { id: L.vendorByName.get(norm(v.name)) } : { ref: vendorOp(plan, L, v, 'Vendors (new)', seen) };
    for (const ws of wb.worksheets) if (norm(str(ws.getCell('A3').value)) === 'pono') parsePOSheet(ws, plan, L, resolveVendor);
  } else if (TEMPLATES[kind]) {
    detected = `${TEMPLATES[kind].title} template`;
    parseTemplate(kind, wb.worksheets[0], plan);
  } else {
    throw new HttpError(400, 'File format not recognised. Use a template from this page, the Smart Store workbook, the vendor list or a WIESPL PO.');
  }
  delete plan._seen;
  plan.detected = detected;
  plan.user = user.name;
  const token = crypto.randomBytes(12).toString('hex');
  plans.set(token, { plan, at: Date.now() });
  for (const [k, v] of plans) if (Date.now() - v.at > 30 * 60e3) plans.delete(k);
  const view = op => ({ sheet: op.sheet, row: op.n, kind: op.kind, label: op.label, status: op.errors?.length ? 'error' : op.dupId ? 'duplicate' : 'new', errors: op.errors || [], auto: !!op.autoCreated });
  const errors = plan.ops.filter(o => o.errors?.length);
  return {
    token, detected, warning: plan.warning || null, openingDate: plan.openingDate || null,
    sheets: Object.values(plan.sheets),
    counts: {
      total: plan.ops.length, new: plan.ops.filter(o => !o.errors?.length && !o.dupId).length, duplicate: plan.ops.filter(o => !o.errors?.length && o.dupId).length, error: errors.length,
      autoItems: plan.ops.filter(o => o.autoCreated && !o.nameOnly).length,
      noCodeItems: plan.ops.filter(o => o.nameOnly).length,
      noCodeRows: plan.ops.filter(o => o.kind === 'move' && o.item?.ref?.nameOnly).length,
    },
    rows: [...errors.slice(0, 200), ...plan.ops.filter(o => !o.errors?.length).slice(0, 300)].map(view),
  };
}

export function commit(token, mode, user) {
  const createMissing = false;
  const entry = plans.get(token);
  if (!entry) throw new HttpError(410, 'This preview has expired. Upload the file again.');
  if (!['skip', 'update', 'add'].includes(mode)) throw new HttpError(400, 'Choose skip, update or add for duplicates');
  const { plan } = entry;
  const result = { created: 0, updated: 0, skipped: 0, errors: 0, moves: 0, noCode: 0 };
  const stamp = now();
  const batch = `IMP-${stamp.replace(/\D/g, '').slice(0, 12)}`;
  const insMove = db.prepare(`INSERT INTO stock_moves (type, date, doc_no, item_id, qty, uom, rate, vendor_id, supplier, invoice_no, invoice_date, po_id, po_no, hsn, gst_rate,
    project_id, issued_to, from_location, to_location, against_issue_no, reason, purpose, remarks, import_batch, created_by, created_at)
    VALUES (@type, @date, @doc_no, @item_id, @qty, @uom, @rate, @vendor_id, @supplier, @invoice_no, @invoice_date, @po_id, @po_no, @hsn, @gst_rate,
    @project_id, @issued_to, @from_location, @to_location, @against_issue_no, @reason, @purpose, @remarks, @batch, @user, @at)`);
  const MOVE_COLS = ['type', 'date', 'doc_no', 'item_id', 'qty', 'uom', 'rate', 'vendor_id', 'supplier', 'invoice_no', 'invoice_date', 'po_id', 'po_no', 'hsn', 'gst_rate',
    'project_id', 'issued_to', 'from_location', 'to_location', 'against_issue_no', 'reason', 'purpose', 'remarks'];
  const insItem = db.prepare(`INSERT INTO items (code, name, category, uom, rate, gst_rate, hsn, reorder_level, preferred_vendor_id, location, description, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const itemUom = db.prepare('SELECT uom FROM items WHERE id = ?');
  const docMax = {};
  const moveKey = d => [d.type, d.date, d.doc_no || '', d.item_id, Number(d.qty), d.issued_to || d.supplier || d.to_location || ''].join('|');
  const existing = new Map();
  for (const m of db.prepare('SELECT type, date, doc_no, item_id, qty, issued_to, supplier, to_location FROM stock_moves').all()) {
    const k = moveKey(m);
    existing.set(k, (existing.get(k) || 0) + 1);
  }

  tx(() => {
    let nextCode = Number(nextItemCode());
    const takeCode = () => { while (db.prepare('SELECT 1 FROM items WHERE code = ?').get(String(nextCode))) nextCode++; return String(nextCode++); };
    const failed = [];
    for (const op of plan.ops) {
      if (op.errors?.length) { result.errors++; continue; }
      if (op.kind === 'note') continue;
      // Rows without an item code: skipped (as the workbook's Stock Summary does) unless asked to create items for them.
      if (!createMissing && (op.nameOnly || (op.kind === 'move' && op.item?.ref?.nameOnly))) { result.noCode++; continue; }
      try { runOp(op); } catch (e) { result.errors++; if (failed.length < 20) failed.push(`${op.sheet}${op.n ? ' row ' + op.n : ''}: ${e.message}`); }
    }
    result.failed = failed;
    function runOp(op) {
      const dup = !!op.dupId;
      if (op.kind === 'item') {
        const d = op.data;
        if (dup && mode === 'skip') { op.id = op.dupId; result.skipped++; return; }
        if (dup && mode === 'update') {
          db.prepare(`UPDATE items SET name = ?, category = ?, uom = ?, rate = ?, gst_rate = ?, hsn = COALESCE(?, hsn), updated_at = ? WHERE id = ?`)
            .run(d.name, d.category, d.uom, d.rate ?? 0, d.gst_rate ?? 18, d.hsn ?? null, stamp, op.dupId);
          op.id = op.dupId; result.updated++; return;
        }
        const c = d.code && !db.prepare('SELECT 1 FROM items WHERE code = ?').get(d.code) ? d.code : takeCode();
        op.id = Number(insItem.run(c, d.name, d.category, d.uom || 'Nos', d.rate ?? 0, d.gst_rate ?? 18, d.hsn ?? null, d.reorder_level ?? 0, d.preferred_vendor_id ?? null, d.location ?? null, d.description ?? null, user.name, stamp).lastInsertRowid);
        result.created++;
      } else if (op.kind === 'vendor') {
        if (dup && mode === 'skip') { op.id = op.dupId; result.skipped++; return; }
        if (dup && mode === 'update') { updateRow('vendors', op.dupId, op.data, user, { system: true }); op.id = op.dupId; result.updated++; return; }
        op.id = insertRow('vendors', op.data, user, { system: true }).id; result.created++;
      } else if (op.kind === 'project') {
        const { client_name, ...d } = op.data;
        if (client_name) d.customer_id = db.prepare('SELECT id FROM customers WHERE lower(name) = lower(?)').get(client_name)?.id || null;
        if (dup && mode === 'skip') { result.skipped++; return; }
        if (dup && mode === 'update') { updateRow('projects', op.dupId, d, user, { system: true }); result.updated++; return; }
        insertRow('projects', d, user, { system: true }); result.created++;
      } else if (op.kind === 'po' || op.kind === 'req') {
        const entity = op.kind === 'po' ? 'purchase_orders' : 'requisitions';
        const d = { ...op.data };
        if (op.kind === 'po') d.vendor_id = op.vendor?.id || op.vendor?.ref?.id || null;
        if (op.kind === 'po' && !d.vendor_id) { result.errors++; return; }
        if (dup && mode === 'skip') { result.skipped++; return; }
        if (dup && mode === 'update') { updateRow(entity, op.dupId, d, user, { system: true }); result.updated++; return; }
        if (dup && mode === 'add') { d[op.kind === 'po' ? 'po_no' : 'req_no'] = null; }
        insertRow(entity, d, user, { system: true }); result.created++;
      } else if (op.kind === 'move') {
        const itemId = op.item?.id || op.item?.ref?.id;
        if (!itemId) { result.errors++; return; }
        const d = { ...op.data, item_id: itemId };
        // Row-level duplicate check, so a newer copy of the same workbook only adds the new rows.
        const key = moveKey(d);
        if (mode !== 'add' && (existing.get(key) || 0) > 0) { existing.set(key, existing.get(key) - 1); result.skipped++; return; }
        if (!d.uom) d.uom = itemUom.get(itemId)?.uom || null;
        const row = Object.fromEntries(MOVE_COLS.map(k => [k, d[k] ?? null]));
        insMove.run({ ...row, batch, user: user.name, at: stamp });
        result.moves++;
        const m = String(d.doc_no || '').match(/^(\d+)\s*[A-Z]?\s*\/\s*20(\d{2})-(\d{2})$/i);
        if (m) { const k = `stock_${d.type}|${m[2]}-${m[3]}`; docMax[k] = Math.max(docMax[k] || 0, Number(m[1])); }
      }
    }
    for (const [k, seq] of Object.entries(docMax)) { const [name, fy] = k.split('|'); bumpSeq(name, fy, seq); }
    for (const op of plan.ops.filter(o => o.kind === 'po' && o.data.po_no)) {
      const m = String(op.data.po_no).match(/^(\d+)\s*\/\s*20(\d{2})-(\d{2})$/);
      if (m) bumpSeq('po', `${m[2]}-${m[3]}`, Number(m[1]));
    }
    db.prepare('INSERT INTO import_batches (user, kind, file_hash, summary) VALUES (?, ?, ?, ?)').run(user.name, plan.detected, plan.hash, JSON.stringify(result));
  });
  plans.delete(token);
  audit(user.name, 'import', null, plan.detected, JSON.stringify(result));
  return { ...result, batch };
}

// ---------------------------------------------------------------- quotation estimate → product catalog ("standard BOQ")
// Reads a WIESPL estimate sheet (ANNEXURE III: Sr. No. | Particulars | Rate | Installation Charges | Basic Rate | GST | Qty | UOM | Total)
// and saves its lines as a named standard BOQ, so "Load standard BOQ" in a quotation brings them in with their prices.
export async function importProductBoq(buffer, setName, user) {
  if (!buffer?.length) throw new HttpError(400, 'Upload the quotation Excel (.xlsx)');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not a readable .xlsx file'); }
  const n = v => String(cell(v) ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let ws = null, hdr = null;
  for (const s of wb.worksheets) {
    for (let r = 1; r <= Math.min(15, s.rowCount) && !hdr; r++) {
      const vals = Array.from(s.getRow(r).values, n);
      const part = vals.findIndex(v => v === 'particulars' || v === 'description');
      const rate = vals.findIndex(v => v.startsWith('rate'));
      if (part > 0 && rate > 0) hdr = { row: r, sr: vals.findIndex(v => v === 'srno' || v === 'sr'), part, rate,
        inst: vals.findIndex(v => v.startsWith('installation')), basic: vals.findIndex(v => v === 'basicrate'), gst: vals.findIndex(v => v === 'gst' || v.startsWith('gst')),
        qty: vals.findIndex(v => v === 'qty' || v === 'quantity'), uom: vals.findIndex(v => v === 'uom' || v === 'unit') };
    }
    if (hdr) { ws = s; break; }
  }
  if (!ws) throw new HttpError(400, 'No estimate found: the sheet needs a header row with "Particulars" and "Rate"');
  const name = String(setName || '').trim() || ws.name.trim();
  const numOf = v => { const c = cell(v); if (c === null || c === '' || c === undefined) return null; const x = Number(String(c).replace(/,/g, '')); return Number.isFinite(x) ? x : null; };
  const basisOf = (text, uomText) => {
    const t = text.toLowerCase();
    if (/\bwall/.test(t)) return 'walls';
    if (/ceiling/.test(t)) return 'ceiling';
    if (/coving/.test(t)) return 'coving';
    if (/floor|self level/.test(t)) return 'flooring';
    return /sq\.?\s*ft|r\.?\s*ft/i.test(uomText) ? 'walls' : 'manual';
  };
  const UOMS_OK = ['Each', 'No', 'Set', 'Sq. Ft', 'R. Ft', 'Rmt', 'Kg', 'Lot', 'Job'];
  const uomOf = u => { const k = String(u || '').toLowerCase().replace(/[^a-z]/g, ''); return { each: 'Each', no: 'No', nos: 'No', set: 'Set', sqft: 'Sq. Ft', rft: 'R. Ft', rmt: 'Rmt', kg: 'Kg', lot: 'Lot', job: 'Job' }[k] || (UOMS_OK.includes(u) ? u : 'Each'); };
  const out = [];
  let main = 0, sub = 0;
  for (let r = hdr.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const own = c => { if (c < 1) return null; const x = row.getCell(c); return x.isMerged && x.master !== x ? null : x.value; };
    const text = String(cell(own(hdr.part)) ?? '').replace(/\r/g, '').trim();
    const srRaw = cell(own(hdr.sr > 0 ? hdr.sr : 1));
    if (/basic total|grand|authori[sz]ed/i.test(`${srRaw ?? ''} ${text}`)) break;
    if (!text) continue;
    let sr = srRaw == null ? '' : String(typeof srRaw === 'number' ? Math.round(srRaw * 10) / 10 : srRaw).trim();
    if (/^[A-Z]$/.test(sr)) continue; // section letter row ("A  Laminar Air Flow System …")
    const rate = numOf(own(hdr.rate)), inst = numOf(own(hdr.inst)), basic = numOf(own(hdr.basic)), gstAmt = numOf(own(hdr.gst));
    const qtyCell = cell(own(hdr.qty)), qty = numOf(qtyCell), uomText = String(cell(own(hdr.uom)) ?? '').trim();
    const isSub = /^\d+\.\d+$/.test(sr);
    if (isSub) sub = Math.min(sub + 1, 9); else { main++; sub = 0; }
    const kind = rate == null && qty == null ? 'Heading' : 'Item';
    const title = text.split(/\n|:|(?<=\.)\s/)[0].replace(/\s+/g, ' ').trim().slice(0, 90) || text.slice(0, 90);
    out.push({
      name: title, description: text, kind, boq_set: name, sort: main * 10 + (isSub ? sub : 0), category: 'Other',
      uom: uomOf(uomText), rate: rate || 0, install_pct: rate ? round2(((inst || 0) / rate) * 100) : 0,
      gst_rate: basic && gstAmt != null ? Math.round((gstAmt / basic) * 100) : 18,
      qty_basis: kind === 'Item' && qty == null && /basis/i.test(String(qtyCell ?? '')) ? basisOf(text, uomText) : 'manual',
      default_qty: qty ?? 1, active: 'Yes',
    });
  }
  if (!out.some(p => p.kind === 'Item')) throw new HttpError(400, 'No priced lines found under the header');
  return tx(() => {
    const removed = db.prepare('DELETE FROM products WHERE boq_set = ?').run(name).changes;
    for (const p of out) insertRow('products', p, user, { system: true });
    audit(user.name, 'products', null, 'import standard BOQ', `${name}: ${out.length} lines (${removed} replaced)`);
    return { set: name, lines: out.length, items: out.filter(p => p.kind === 'Item').length, replaced: removed,
      gst_rates: [...new Set(out.filter(p => p.kind === 'Item').map(p => p.gst_rate))] };
  });
}
