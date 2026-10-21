// Calculations shared by the browser (live preview) and the server (authoritative totals).

export const MM_PER_FT = 304.8;
export const AREA_BASES = ['walls', 'ceiling', 'coving', 'flooring'];

const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const round2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;

// Financial year (April - March) helpers, e.g. 2025-10-21 -> "25-26"
export function fyOf(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear() % 100, start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Basis of Design: same formulas as the WIESPL quotation workbook.
//   walls    = 2(L x H) + 2(W x H)     (wall_sides lets a passage use fewer sides)
//   ceiling  = L x W
//   coving   = 4L + 4W + 60
//   flooring = ceiling + 15% wastage
//   air changes/hr = supply cfm x 60 / room volume
export function roomAreas(room = {}) {
  const L = num(room.length), W = num(room.width), H = num(room.height) || 10;
  const sides = room.wall_sides ? num(room.wall_sides) : 4;
  const wallsCalc = sides >= 4 ? 2 * L * H + 2 * W * H : sides === 3 ? 2 * L * H + W * H : sides === 2 ? L * H + W * H : L * H;
  const ov = room.override || {};
  const pick = (k, v) => (ov[k] !== undefined && ov[k] !== '' && ov[k] !== null ? num(ov[k]) : v);
  const ceiling = pick('ceiling', L * W);
  const out = {
    walls: round2(pick('walls', wallsCalc + num(room.walls_extra))),
    ceiling: round2(ceiling),
    coving: round2(pick('coving', 4 * L + 4 * W + 60)),
    flooring: round2(pick('flooring', ceiling * 1.15)),
  };
  const volume = L * W * H;
  out.air_changes = volume > 0 && num(room.cfm) > 0 ? round2((num(room.cfm) * 60) / volume) : 0;
  return out;
}

export function lineBasicRate(line) {
  return round2(num(line.rate) + num(line.install));
}

// Quantity of a BOQ line for one room: manual qty, or the room's Basis of Design area when blank.
export function lineQty(line, room) {
  const q = line.qty?.[room.id];
  if (q !== undefined && q !== null && q !== '') return num(q);
  if (line.basis && AREA_BASES.includes(line.basis)) return roomAreas(room)[line.basis];
  return 0;
}

export function quoteTotals(data = {}, gstRate = 18, discountPct = 0) {
  const rooms = data.rooms || [];
  const lines = (data.lines || []).filter(l => l.kind !== 'heading');
  const roomTotals = {};
  const lineTotals = {};
  for (const r of rooms) roomTotals[r.id] = 0;
  for (const l of lines) {
    const br = lineBasicRate(l);
    let qtySum = 0, amt = 0;
    for (const r of rooms) {
      const q = lineQty(l, r);
      qtySum += q;
      const a = br * q;
      amt += a;
      roomTotals[r.id] += a;
    }
    lineTotals[l.id] = { qty: round2(qtySum), amount: round2(amt) };
  }
  for (const k in roomTotals) roomTotals[k] = round2(roomTotals[k]);
  const basic = round2(Object.values(roomTotals).reduce((a, b) => a + b, 0));
  const discount = round2(basic * num(discountPct) / 100);
  const taxable = round2(basic - discount);
  // GST per rate: a line's own GST % if set, otherwise the quotation's; the discount reduces every line alike.
  const keep = 1 - num(discountPct) / 100;
  const gstByRate = {};
  for (const l of lines) {
    const rate = l.gst === undefined || l.gst === null || l.gst === '' ? num(gstRate) : num(l.gst);
    gstByRate[rate] = (gstByRate[rate] || 0) + (lineTotals[l.id]?.amount || 0) * keep * rate / 100;
  }
  for (const k in gstByRate) gstByRate[k] = round2(gstByRate[k]);
  const gst = round2(Object.values(gstByRate).reduce((a, b) => a + b, 0));
  return { roomTotals, lineTotals, basic, discount, taxable, gst, gstByRate, grand: round2(taxable + gst) };
}

// Simple item lines for PO / invoice: qty x rate + line GST
export function linesTotals(lines = []) {
  let subtotal = 0, tax = 0;
  for (const l of lines || []) {
    const amt = num(l.qty) * num(l.rate);
    subtotal += amt;
    tax += amt * num(l.gst) / 100;
  }
  subtotal = round2(subtotal); tax = round2(tax);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

// PO totals as printed on the WIESPL PO: CGST + SGST within the company's state, IGST otherwise,
// then rounded to whole rupees with the difference shown as "Round off".
export function gstTotals(lines = [], intraState = true) {
  const { subtotal, tax } = linesTotals(lines);
  const exact = subtotal + tax;
  const total = Math.round(exact);
  return {
    subtotal, tax,
    cgst: intraState ? round2(tax / 2) : 0, sgst: intraState ? round2(tax / 2) : 0, igst: intraState ? 0 : tax,
    round_off: round2(total - exact), total,
  };
}

// PO charges: part of the taxable value (before GST) at the PO's "GST % on charges".
export const PO_CHARGES = [['freight_charges', 'Freight Charges'], ['packing_charges', 'Packing Charges'], ['installation_charges', 'Installation Charges'],
  ['transport_charges', 'Transportation Charges'], ['other_charges', 'Other Charges']];
export function poTotals(po = {}, intraState = true) {
  const lines = (po.lines || []).filter(l => num(l.qty) && (l.rate !== undefined && l.rate !== null && l.rate !== ''));
  const chargeGst = po.charges_gst === undefined || po.charges_gst === null || po.charges_gst === '' ? 18 : num(po.charges_gst);
  const charges = PO_CHARGES.map(([k, label]) => ({ key: k, label: k === 'other_charges' ? (po.other_charges_label || label) : label, amount: round2(po[k]) })).filter(c => c.amount);
  const items = linesTotals(lines).subtotal;
  const all = [...lines.map(l => ({ qty: l.qty, rate: l.rate, gst: l.gst ?? 18 })), ...charges.map(c => ({ qty: 1, rate: c.amount, gst: chargeGst }))];
  const t = gstTotals(all, intraState);
  const byRate = {};
  for (const l of all) { const r = num(l.gst); const a = num(l.qty) * num(l.rate); byRate[r] = byRate[r] || { taxable: 0, tax: 0 }; byRate[r].taxable += a; byRate[r].tax += a * r / 100; }
  for (const r in byRate) { byRate[r].taxable = round2(byRate[r].taxable); byRate[r].tax = round2(byRate[r].tax); }
  const rates = Object.keys(byRate).map(Number).filter(r => byRate[r].taxable).sort((a, b) => a - b);
  return { ...t, items, charges, byRate, rates, gst_label: rates.map(r => `${r}%`).join(' / ') };
}

export function inr(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
function three(n) { return (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : ''); }

// Indian numbering: 12,34,56,789 -> "Twelve Crore Thirty Four Lakh ..."
export function amountInWords(v) {
  let n = Math.floor(num(v));
  const paise = Math.round((num(v) - n) * 100);
  if (n === 0 && paise === 0) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push((crore >= 100 ? three(crore) : two(crore)) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (n) parts.push(three(n));
  let s = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return s + ' Only';
}
