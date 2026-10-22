import { h, api, state, fmtDate } from '../ui.js';
import { bomDoc } from './bom.js';
import { bomRows } from './form.js';
import { PROJECT, ROOM, SITE, roomCalc } from '../brief-fields.js';
import { roomAreas, quoteTotals, lineBasicRate, lineQty, inr, amountInWords, linesTotals, gstTotals, round2, poTotals } from '../calc.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const lines = s => String(s || '').split('\n');
const multiline = s => lines(s).flatMap((l, i) => (i ? [h('br'), l] : [l]));

function letterhead(s) {
  return h('div.letterhead', h('img', { src: 'logo.jpeg', alt: 'WIESPL' }),
    h('div.co', h('b', s.company_name), h('div', s.reg_address), h('div', `${s.phone} · ${s.email} · ${s.website}`),
      s.gstin ? h('div', `GSTIN: ${s.gstin}`) : null));
}
const footer = () => h('img.foot-img', { src: 'letterfoot.jpeg', alt: '' });
const sign = s => h('div.sign', h('div', h('b', `For, ${s.company_name}`)), h('div.space'), h('div', h('b', 'AUTHORISED SIGNATORY')));
const page = (...c) => h('div.page', ...c);

function bar(title) {
  return h('div.print-bar', h('b', title), h('span', { style: { flex: 1 } }),
    h('span', { style: { fontSize: '12px', opacity: 0.8 } }, 'Use "Save as PDF" in the print dialog to create a PDF'),
    h('button.btn.small', { onclick: () => window.print() }, '🖨 Print / Save PDF'),
    h('button.btn.small', { onclick: () => (history.length > 1 ? history.back() : window.close()) }, 'Close'));
}

// ---------------------------------------------------------------- quotation
function quotationDoc(q, s) {
  const d = q.data || {};
  const rooms = d.rooms || [];
  const annex = d.annex || {};
  const t = quoteTotals(d, q.gst_rate, q.discount_pct);
  const sections = [];
  if (annex.usp !== false) sections.push(['usp', 'WIESPL USP']);
  if (annex.bod !== false && rooms.length) sections.push(['bod', 'Basis of Design']);
  sections.push(['boq', `Techno Commercial BOQ${d.boq_title ? ' – ' + d.boq_title.replace(/^WIESPL ESTIMATE FOR /i, '') : ''}`]);
  if (annex.summary !== false && rooms.length) sections.push(['summary', 'SUMMARY']);
  if (annex.terms !== false || annex.scope !== false) sections.push(['terms', 'Commercial terms, conditions & Scope of Work']);
  const num = k => ROMAN[sections.findIndex(x => x[0] === k)];

  const pages = [];
  // Cover letter
  pages.push(page(letterhead(s),
    h('table', { style: { border: 'none' } }, h('tr',
      h('td', { style: { border: 'none', padding: 0 } }, h('b', `Quotation No : ${q.quote_no}`)),
      h('td', { style: { border: 'none', padding: 0, textAlign: 'right' } }, h('b', `Date : ${fmtDate(q.date)}`)))),
    h('p', { style: { marginTop: '14px' } }, 'To,', h('br'), ...multiline(q.to_address)),
    h('p', h('b', `Subject : ${q.subject || ''}`)),
    h('p', s.letter_greeting || 'Dear Sir,'),
    h('p', d.letter_intro || s.letter_intro),
    h('p', s.letter_body),
    h('table', { style: { width: 'auto', marginLeft: '20px' } }, h('tbody', sections.map((sec, i) =>
      h('tr', h('td', { style: { border: 'none' } }, `•  ANNEXURE ${ROMAN[i]}`), h('td', { style: { border: 'none' } }, `-  ${sec[1]}`))))),
    ...lines(s.letter_closing).map(l => h('p', l)),
    h('p', 'Yours faithfully,'), sign(s), footer()));

  if (num('usp')) {
    pages.push(page(letterhead(s), h('h2', `ANNEXURE ${num('usp')}`), h('h3', s.usp_title || 'Distinctive features of WIESPL HVAC Systems'),
      h('ul.usp', (s.usp || []).map(u => h('li', u)))));
  }

  if (num('bod')) {
    const ROWS = [
      ['Room Length', 'ft.', r => round2(r.length)], ['Width', 'ft.', r => round2(r.width)], ['Height', 'ft.', r => round2(r.height)],
      ['Walls', 'Sq. Ft.', r => roomAreas(r).walls], ['False Ceiling', 'Sq. Ft.', r => roomAreas(r).ceiling], ['Coving', 'R. Ft.', r => roomAreas(r).coving],
      ['Flooring', 'Sq. Ft.', r => roomAreas(r).flooring], ['Class of Air at Plenum Grill', 'CLASS', r => r.cls], ['Temperature range', '˚C', r => r.temp],
      ['Humidity', '%', r => r.rh], ['LAF Plenum Size', 'Sq. Ft.', r => r.plenum], ['HEPA Filtration Area', 'Sizes / Nos.', r => r.hepa_area],
      ['HEPA Filter Location', 'TERMINAL / AHU', r => r.hepa_loc], ['Supply Air Quantity', 'cfm', r => r.cfm], ['Fresh Air Quantity', 'ACPH', r => r.fresh_ach],
      ['Designed Air Changes', 'ACPH', r => (roomAreas(r).air_changes ? roomAreas(r).air_changes.toFixed(1) : '')], ['Average Number of Persons', 'Nos.', r => r.persons],
      ['Average Equipment Load', 'kW', r => r.equip_kw], ['Lighting load per sq. ft', 'watt/sq. ft', r => r.light], ['Air Conditioning + CHW', 'Tr.', r => r.ac_tr],
      ['Air Conditioning (WIESPL Scope)', 'Tr.', r => r.dx], ['CHW (Client Scope)', 'Tr.', r => r.chw], ['SS Strip heaters with PLC control', 'kW', r => r.heater_kw],
    ];
    const chunks = [];
    for (let i = 0; i < rooms.length; i += 8) chunks.push(rooms.slice(i, i + 8));
    pages.push(page({ class: 'landscape' }, letterhead(s), h('h2', `ANNEXURE ${num('bod')}`), h('h3', 'BASIS OF DESIGN'),
      chunks.map(ch => h('table', { style: { marginBottom: '10px' } },
        h('thead', h('tr', h('th', 'Sr.'), h('th', 'Project Parameters'), h('th', 'UOM'), ch.map(r => h('th', r.name)))),
        h('tbody', ROWS.map((row, i) => h('tr', h('td', i + 1), h('td', row[0]), h('td', row[1]), ch.map(r => h('td.num', row[2](r) ?? '')))))))));
  }

  // BOQ
  const boqLines = d.lines || [];
  let main = 0, sub = 0;
  const nums = boqLines.map(l => (l.sub ? `${main}.${++sub}` : (sub = 0, String(++main))));
  const cols = 8 + rooms.length;
  const opt = d.optionals || [];
  pages.push(page({ class: 'landscape' }, letterhead(s), h('h2', `ANNEXURE ${num('boq')}`), h('h3', d.boq_title || 'WIESPL ESTIMATE'),
    h('table', h('thead', h('tr', h('th', 'Sr. No.'), h('th', 'Particulars'), h('th.num', 'Rate (INR)'), h('th.num', 'Installation'), h('th.num', 'Basic Rate'), h('th', 'UOM'),
      rooms.map(r => h('th.num', r.name)), h('th.num', 'Total Qty'), h('th.num', 'Basic Total'))),
    h('tbody', boqLines.map((l, i) => l.kind === 'heading'
      ? h('tr', h('td', nums[i]), h('td.spec', { colspan: cols - 1 }, h('b', lines(l.description || l.name)[0]), ...multiline(lines(l.description || '').slice(1).join('\n')).map(x => x)))
      : h('tr', h('td', nums[i]), h('td.spec', l.description && l.description !== l.name ? [h('b', lines(l.description)[0]), lines(l.description).length > 1 ? h('br') : null, ...multiline(lines(l.description).slice(1).join('\n'))] : h('b', l.name)),
        h('td.num', inr(l.rate)), h('td.num', inr(l.install)), h('td.num', inr(lineBasicRate(l))), h('td', l.uom),
        rooms.map(r => h('td.num', lineQty(l, r) || '')), h('td.num', t.lineTotals[l.id]?.qty || ''), h('td.num', inr(t.lineTotals[l.id]?.amount))))),
    h('tfoot',
      h('tr', h('td', { colspan: 6 }, h('b', 'BASIC TOTAL')), rooms.map(r => h('td.num', h('b', inr(t.roomTotals[r.id])))), h('td'), h('td.num', h('b', inr(t.basic)))),
      t.discount ? h('tr', h('td', { colspan: cols - 1 }, `Discount @${q.discount_pct}%`), h('td.num', '− ' + inr(t.discount))) : null,
      Object.entries(t.gstByRate || { [q.gst_rate]: t.gst }).filter(([, v]) => v).map(([rate, v]) => h('tr', h('td', { colspan: cols - 1 }, `GST @${rate}%`), h('td.num', inr(v)))),
      h('tr', h('td', { colspan: cols - 1 }, h('b', 'GRAND ALL INCLUSIVE TOTAL')), h('td.num', h('b', inr(t.grand)))))),
    h('p', h('b', amountInWords(t.grand))),
    s.boq_note ? h('p', s.boq_note) : null,
    opt.length ? [h('h3', 'Optional Items'), h('table', h('thead', h('tr', ['Sr.No.', 'Optional Items', 'Rate (INR)', 'Installation', 'Basic Rate', 'Qty', 'UOM', 'Amount'].map((x, i) => h('th' + (i > 1 && i !== 6 ? '.num' : ''), x)))),
      h('tbody', opt.map((l, i) => h('tr', h('td', i + 1), h('td.spec', h('b', l.name), h('br'), ...multiline(l.description)), h('td.num', inr(l.rate)), h('td.num', inr(l.install)),
        h('td.num', inr(lineBasicRate(l))), h('td.num', l.qty), h('td', l.uom), h('td.num', inr(lineBasicRate(l) * (Number(l.qty) || 0))))))),
      h('p', 'Optional items are not included in the above total. GST extra as applicable.')] : null,
    sign(s)));

  if (num('summary')) {
    pages.push(page(letterhead(s), h('h2', `ANNEXURE ${num('summary')}`), h('h3', 'SUMMARY'),
      h('table', h('thead', h('tr', h('th', 'Sr.No'), h('th', 'PARTICULARS'), h('th.num', 'BASIC AMOUNT'))),
        h('tbody', rooms.map((r, i) => h('tr', h('td', i + 1), h('td', r.name), h('td.num', inr(t.roomTotals[r.id]))))),
        h('tfoot', h('tr', h('td', { colspan: 2 }, h('b', 'TOTAL BASIC AMOUNT')), h('td.num', h('b', inr(t.basic)))),
          t.discount ? h('tr', h('td', { colspan: 2 }, `Discount @${q.discount_pct}%`), h('td.num', '− ' + inr(t.discount))) : null,
          Object.entries(t.gstByRate || { [q.gst_rate]: t.gst }).filter(([, v]) => v).map(([rate, v]) => h('tr', h('td', { colspan: 2 }, `GST @${rate}%`), h('td.num', inr(v)))),
          h('tr', h('td', { colspan: 2 }, h('b', 'ALL INCLUSIVE TOTAL AMOUNT')), h('td.num', h('b', inr(t.grand)))))),
      h('p', h('b', amountInWords(t.grand)))));
  }

  if (num('terms')) {
    pages.push(page(letterhead(s), h('h2', `ANNEXURE ${num('terms')}`),
      annex.terms !== false ? [h('h3', 'Terms & Conditions :'), h('table', h('tbody', (d.terms || []).map((x, i) => h('tr', h('td', { style: { width: '30px' } }, i + 1), h('td', x)))))] : null,
      annex.scope !== false && d.client_scope ? [h('h3', { style: { marginTop: '16px' } }, 'SCOPE OF WORK : CLIENT END'), h('div.spec', d.client_scope)] : null,
      annex.scope !== false && (d.scope_matrix || []).length ? [h('h3', { style: { marginTop: '16px' } }, 'SCOPE SHEET'),
        h('table', h('thead', h('tr', h('th', 'Sr. No.'), h('th', 'Particulars'), h('th', 'WIESPL Scope'), h('th', 'Client Scope'))),
          h('tbody', d.scope_matrix.map((r, i) => h('tr', h('td', String.fromCharCode(65 + i)), h('td', r[0]), h('td.spec', r[1]), h('td.spec', r[2])))))] : null,
      sign(s), footer()));
  }
  return h('div.doc', pages);
}

// ---------------------------------------------------------------- GST invoice / PO
function taxDoc({ title, no, date, party, partyLabel, refs, items, place, notes, s }) {
  const intra = (place || '').toLowerCase() === (s.state || 'Maharashtra').toLowerCase();
  const t = linesTotals(items);
  return h('div.doc', page(letterhead(s), h('h2', title),
    h('table', h('tbody', h('tr',
      h('td', { style: { width: '55%' } }, h('b', partyLabel), h('br'), h('b', party.name || ''), h('br'), ...multiline(party.address || ''),
        party.gstin ? [h('br'), `GSTIN: ${party.gstin}`] : null, party.state ? [h('br'), `State: ${party.state}`] : null),
      h('td', h('div', h('b', `${title} No: `), no), h('div', h('b', 'Date: '), fmtDate(date)), refs.map(([k, v]) => (v ? h('div', h('b', `${k}: `), v) : null)),
        place ? h('div', h('b', 'Place of supply: '), place) : null)))),
    h('table', { style: { marginTop: '10px' } },
      h('thead', h('tr', ['Sr', 'Description', 'HSN/SAC', 'Qty', 'UOM', 'Rate', 'Taxable', 'GST %', intra ? 'CGST' : 'IGST', intra ? 'SGST' : null, 'Amount'].filter(Boolean).map((x, i) => h('th' + (i >= 3 && x !== 'UOM' ? '.num' : ''), x)))),
      h('tbody', items.map((l, i) => {
        const taxable = (Number(l.qty) || 0) * (Number(l.rate) || 0), tax = taxable * (Number(l.gst) || 0) / 100;
        return h('tr', h('td', i + 1), h('td.spec', l.description), h('td', l.hsn), h('td.num', l.qty), h('td', l.uom), h('td.num', inr(l.rate)), h('td.num', inr(taxable)),
          h('td.num', l.gst), intra ? [h('td.num', inr(tax / 2)), h('td.num', inr(tax / 2))] : h('td.num', inr(tax)), h('td.num', inr(taxable + tax)));
      })),
      h('tfoot', h('tr', h('td', { colspan: 6 }, 'Total'), h('td.num', inr(t.subtotal)), h('td'),
        intra ? [h('td.num', inr(t.tax / 2)), h('td.num', inr(t.tax / 2))] : h('td.num', inr(t.tax)), h('td.num', inr(t.total))))),
    h('p', h('b', amountInWords(t.total))),
    notes ? h('div.spec', { style: { marginTop: '8px' } }, notes) : null,
    s.bank_details && !['PURCHASE ORDER', 'CREDIT NOTE'].includes(title) ? h('div.spec', { style: { marginTop: '8px' } }, h('b', 'Bank details: '), s.bank_details) : null,
    sign(s), footer()));
}

// A requisition / PO for several sites: each line is printed with its site (nothing is added for a single site).
async function siteLabels(lines = []) {
  const ids = new Set(lines.filter(l => l.project_id && Number(l.qty) > 0).map(l => Number(l.project_id)));
  if (ids.size < 2) return;
  const names = new Map((await api('/projects/options').catch(() => [])).map(o => [Number(o.id), o.label]));
  for (const l of lines) if (l.project_id) l.site = names.get(Number(l.project_id)) || '';
}

// ---------------------------------------------------------------- WIESPL purchase order (format WIESPL/PUR./02/R0)
const plainName = s => String(s || '').replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, '').replace(/\s*\(auto\)$/, '');
function companyHead(s, title) {
  return h('div', { style: { textAlign: 'center', borderBottom: '2px solid #1f4e9a', paddingBottom: '6px', marginBottom: '6px', position: 'relative' } },
    h('img', { src: 'logo.jpeg', style: { position: 'absolute', left: 0, top: 0, height: '58px' } }),
    h('div', { style: { fontSize: '17px', fontWeight: 700, color: '#1f4e9a' } }, s.company_name),
    h('div', { style: { fontSize: '10.5px' } }, `Reg. : ${s.reg_address}`), h('div', { style: { fontSize: '10.5px' } }, `Works : ${s.works_address}`),
    h('div', { style: { fontSize: '10.5px' } }, `Tel. : ${s.phone}, Email : ${s.email}, Website : ${s.website}`), s.cin ? h('div', { style: { fontSize: '10.5px' } }, `CIN : ${s.cin}`) : null,
    title ? h('div', { style: { fontSize: '15px', fontWeight: 700, marginTop: '4px', textDecoration: 'underline' } }, title) : null);
}

function poDoc(po, v, s) {
  const lines = po.lines || [];
  const intra = !v.state || v.state === (s.state || 'Maharashtra');
  const t = poTotals(po, intra);
  const rs = x => `₹ ${inr(x)}`;
  // Item code column: the vendor's item code (older POs kept the HSN there).
  const hasVendorCode = lines.some(l => l.vendor_code);
  const noBorder = { border: 'none' };
  const sumRow = (label, val, strong) => h('tr', h('td', { style: strong ? { ...noBorder, borderTop: '1px solid #555' } : noBorder }, strong ? h('b', label) : label),
    h('td.num', { style: strong ? { ...noBorder, borderTop: '1px solid #555' } : noBorder }, strong ? h('b', val) : val));
  let sr = 0;
  const td = (c, attrs) => h('td', attrs || {}, c);
  const terms = [
    ['Payment Terms', null], ['Advance', po.term_advance], ['Balance', po.term_balance], ['Delivery', po.term_delivery],
    ['Warranty', [po.term_warranty, po.terms].filter(Boolean).join('\n')], ['Freight', po.term_freight], ['Validity', po.term_validity],
    ['Invoice Copies', po.term_invoice], ['Jurisdiction', po.term_jurisdiction]];
  let n = 0;
  return h('div.doc', h('div.page', { style: { fontSize: '11.5px' } },
    companyHead(s),
    h('table', h('tbody',
      h('tr', h('th', { style: { width: '13%' } }, 'P.O. No.'), td(h('b', po.po_no)), h('th', { rowspan: 2, style: { fontSize: '16px', textAlign: 'center' } }, 'PURCHASE ORDER'), h('th', 'GST No.'), td(s.gstin)),
      h('tr', h('th', 'P.O. Date'), td(fmtDate(po.date).replaceAll('/', '.')), h('th', 'PAN No.'), td(s.pan)))),
    h('table', { style: { marginTop: '-1px' } }, h('tbody', h('tr',
      td([h('b', 'To'), h('br'), h('b', v.name), h('br'), ...multiline(v.address || ''), [v.city, v.state, v.pincode].filter(Boolean).length ? [h('br'), [v.city, v.state, v.pincode].filter(Boolean).join(', ')] : null,
        v.gstin ? [h('br'), `GST No. : ${v.gstin}`] : null, v.emails ? [h('br'), `Email :- ${String(v.emails).split('\n').join(' ')}`] : null], { style: { width: '38%' } }),
      td([h('b', 'Delivery & Billing Address'), h('br'), ...multiline(po.delivery_address || s.po_delivery_address || '')], { style: { width: '32%' } }),
      td([h('b', 'Contact person :'), ' ', po.contact_person || '', h('br'), po.contact_phone || '', h('br'), ...String(po.contact_emails || '').split(/[,;]\s*/).filter(Boolean).flatMap(e => [`Email : ${e}`, h('br')])])),
      // Contact person, and the contact number on the row below, for the vendor and for us.
      h('tr', td(`Contact Person : ${po.vendor_contact || v.contact_person || ''}`), td(`Contact Person : ${po.contact_person || ''}`, { colspan: 2 })),
      h('tr', td(`Contact No : ${po.vendor_phone || v.phone || ''}`), td(`Contact No : ${po.contact_phone || ''}`, { colspan: 2 })))),
    // Reference and greetings in their own box.
    h('table', { style: { marginTop: '-1px' } }, h('tbody',
      h('tr', td([h('b', 'Ref.:- '), po.quotation_ref ? `Your quotation / P.I. No. ${po.quotation_ref}${po.quotation_date ? ' dated ' + fmtDate(po.quotation_date).replaceAll('/', '.') : ''}` : 'Your quotation / P.I. No. & date'])),
      h('tr', td(multiline(s.po_greeting || ''))))),
    h('table', { style: { marginTop: '-1px' } },
      h('thead', h('tr', ['Sr. No.', 'ITEM NAME', 'ITEM CODE', 'SPECIFICATIONS', 'Qty.', 'UOM', 'Rate (₹)', 'GST', 'Amount (₹)'].map((x, i) => h('th' + (i >= 4 && i !== 5 ? '.num' : ''), x)))),
      h('tbody', lines.map(l => h('tr',
        td(l.description ? ++sr : ''), td(h('b', l.description || '')), td(hasVendorCode ? l.vendor_code || '' : l.hsn || ''),
        td([h('div.spec', l.spec || ''), l.site ? h('div', { style: { fontSize: '10px', fontWeight: 600 } }, `Site: ${l.site}`) : null, hasVendorCode && l.hsn ? h('div', { style: { fontSize: '10px', color: '#555' } }, `HSN/SAC ${l.hsn}`) : null]),
        td(l.qty ?? '', { class: 'num' }), td(l.uom || ''), td(l.rate != null && Number(l.qty) ? inr(l.rate) : '', { class: 'num' }),
        td(Number(l.qty) ? `${l.gst ?? 0}%` : '', { class: 'num' }), td(Number(l.qty) ? inr((Number(l.qty) || 0) * (Number(l.rate) || 0)) : '', { class: 'num' })))),
      h('tfoot', h('tr', td(h('b', 'Sub Total'), { colspan: 8, style: { textAlign: 'right' } }), td(h('b', rs(t.items)), { class: 'num' })))),
    h('table', { style: { marginTop: '-1px' } }, h('tbody', h('tr',
      td([h('b', 'Terms & conditions :'), h('table', { style: { border: 'none', marginTop: '4px' } }, h('tbody', terms.filter(([, val], i) => i === 0 || val).map(([k, val]) =>
        h('tr', h('td', { style: { border: 'none', width: '22px', verticalAlign: 'top' } }, ['Advance', 'Balance'].includes(k) ? '' : ++n),
          h('td', { style: { border: 'none', width: '110px', verticalAlign: 'top' } }, k === 'Payment Terms' ? h('b', k) : `${k}  -`),
          h('td', { style: { border: 'none', whiteSpace: 'pre-wrap' } }, val || '')))))], { style: { width: '62%' } }),
      // Sub total, each charge, the taxable value, GST per rate with its %, round off, grand total — all in ₹.
      td(h('table', { style: noBorder }, h('tbody',
        sumRow('Sub Total', rs(t.items)),
        t.charges.map(c => sumRow(c.label, rs(c.amount))),
        sumRow('Sub Total For GST', rs(t.subtotal)),
        t.rates.map(r => intra
          ? [sumRow(`CGST @ ${r / 2}%`, rs(t.byRate[r].tax / 2)), sumRow(`SGST @ ${r / 2}%`, rs(t.byRate[r].tax / 2))]
          : sumRow(`IGST @ ${r}%`, rs(t.byRate[r].tax))),
        t.rates.length > 1 ? sumRow(`Total GST (${t.gst_label})`, rs(t.tax)) : null,
        sumRow('Round off', rs(t.round_off)),
        sumRow('Grand Total', rs(t.total), true))))))),
    h('table', { style: { marginTop: '-1px' } }, h('tbody', h('tr',
      td([h('b', 'Note: '), po.project_note || ''], { style: { width: '50%' } }),
      td([h('b', 'Rupees in words: '), amountInWords(t.total).replace(/^Rupees /, '')])))),
    // Sign-offs in the approval order: Purchase → Technical → Commercial → GM.
    h('table', { style: { marginTop: '-1px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By', 'Purchase Approval', 'Technical Approval', 'Commercial Approval', 'Approved By'].map(x => h('th', { style: { width: '20%' } }, x))),
      h('tr', [plainName(po.prepared_by) || po.created_by, plainName(po.purchase_approved_by), plainName(po.tech_approved_by), plainName(po.comm_approved_by), plainName(po.approved_by)]
        .map(x => h('td', { style: { height: '42px', verticalAlign: 'bottom' } }, x || ''))),
      h('tr', ['Purchase Executive', 'Purchase Head', 'Technical Manager', 'Account Manager', 'General Manager'].map(x => h('td', x))))),
    h('div', { style: { fontSize: '10px', marginTop: '4px' } }, s.po_doc_no || 'WIESPL/PUR./02/R0'),
    po.status !== 'Approved' && !['Sent', 'Partially Received', 'Closed', 'Received'].includes(po.status) ? h('div', { style: { color: '#b42318', fontWeight: 700, marginTop: '6px' } }, `DRAFT – status: ${po.status}${po.approval_stage ? ' (waiting for ' + po.approval_stage + ')' : ''}`) : null));
}

function requisitionDoc(r, s) {
  const lines = (r.lines || []).filter(l => l.description || l.spec || l.qty);
  const blanks = Math.max(0, 11 - lines.length);
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    h('table', h('tbody',
      h('tr', h('td', { colspan: 6, style: { textAlign: 'center', fontSize: '16px', fontWeight: 700 } }, 'Material Purchase Requisition')),
      h('tr', h('td', { colspan: 6, style: { textAlign: 'center', fontWeight: 700, color: '#1f4e9a' } }, s.company_name)),
      h('tr', h('td', { colspan: 6, style: { textAlign: 'center', fontSize: '10.5px' } }, `Reg. : ${s.reg_address}`, h('br'), `Works : ${s.works_address}`, h('br'), `Tel. : ${s.phone}`)),
      h('tr', h('td', { colspan: 2 }, h('b', 'Project Name :- '), r.project_name || r.project_id_label || ''), h('td', { colspan: 2 }, h('b', 'Req No - '), r.req_no), h('td', { colspan: 2 }, h('b', 'Date '), fmtDate(r.date))),
      h('tr', ['Sr. No.', 'Material Description', 'Specification', 'Qty.', 'UOM', 'Remark'].map(x => h('th', x))),
      lines.map((l, i) => h('tr', h('td', i + 1), h('td', l.description || ''), h('td.spec', l.spec || ''), h('td.num', l.qty ?? ''), h('td', l.uom || ''), h('td', [l.remark, l.site && `Site: ${l.site}`].filter(Boolean).join(' · ')))),
      Array.from({ length: blanks }, () => h('tr', Array.from({ length: 6 }, () => h('td', { style: { height: '22px' } }, '')))),
      h('tr', h('th', { colspan: 2 }, 'Name & Sign of Requester'), h('th', 'Stamp'), h('th', { colspan: 3 }, 'Sign of Purchase Head')),
      h('tr', h('td', { colspan: 2, style: { height: '70px', verticalAlign: 'bottom' } }, r.requested_by || ''), h('td'), h('td', { colspan: 3, style: { verticalAlign: 'bottom' } }, r.approved_by ? `${r.approved_by} (${r.approved_at || ''})` : r.status))))));
}

// Techno-commercial requirement sheet (MD, 13 Oct 2026): the enquiry, the detailed form per OT with design figures,
// site and scope, the internal client profile and MIS, and the drawings received. The base for the proposal.
function techSheetDoc(e, brief, files, s) {
  const d = brief?.data || {}, rooms = d.rooms || [], P = d.project || {}, S = d.site || {};
  const row = (k, v) => (v == null || v === '' ? null : h('tr', h('th', { style: { width: '34%', textAlign: 'left', fontWeight: 600 } }, k), h('td', ...multiline(v))));
  let num = 0; // sections are numbered only when they have something in them
  const sec = (title, ...rows) => { const r = rows.flat().filter(Boolean); return r.length ? [h('tr', h('td', { colspan: 2, style: { background: '#1f4e9a', color: '#fff', fontWeight: 700, padding: '5px 8px' } }, title.startsWith('INTERNAL') ? title : `${++num} · ${title}`)), ...r] : []; };
  const val = (f, v) => (v == null || v === '' ? null : `${v}${f.unit ? ' ' + f.unit : ''}`);
  const fieldsOf = (fields, obj) => fields.filter(f => (!f.show || f.show(obj)) && f.type !== 'textarea').map(f => row(f.label, val(f, obj[f.key])));
  const otRows = () => rooms.flatMap((r, i) => {
    const c = roomCalc(r);
    return sec(`${r.name || `OT ${i + 1}`} — ${r.specialty || 'specialty not given'}`,
      row('NABH type / air class', `Type ${c.type} · ${c.cls}`), c.protocol ? row('Infection protocol', c.protocol.text) : null,
      row('Size (L × W × H)', `${r.length || '?'} × ${r.width || '?'} × ${r.height || '?'} ft${c.area ? ` · ${c.area} sq ft floor · ${c.wallArea} sq ft walls` : ''}`),
      row('Design (WIESPL basis of design)', c.cfm ? `${Math.round(c.acph)} air changes · AHU ≈ ${c.cfm} cfm · ≈ ${c.tr} TR${c.sunRoof ? ' + roof load (sun-exposed)' : ''} · fresh air ≈ ${c.fresh} cfm · ${c.temp} · RH ${c.rh}` : null),
      c.voidFt != null ? row('Space above false ceiling', `${c.voidFt} ft`) : null,
      ROOM.flatMap(([, fields]) => fieldsOf(fields.filter(f => !['name', 'specialty', 'length', 'width', 'height'].includes(f.key)), r)),
      row('Notes', r.notes));
  });
  const internal = sec('INTERNAL – client profile & MIS (remove before sharing with the client)',
    row('Client profile', e.client_profile), row('Budget range', e.budget_range), row('Decision maker', e.decision_maker), row('Taste & priorities', e.client_taste),
    row('Institution / group', e.institution_name), row('Board of Directors / trustees', e.board_members), row('Financial strength', e.financial_status), row('Questionnaire', e.profile_answers),
    row('Lead (website score)', e.lead_grade ? `${e.lead_grade}${e.lead_score != null ? ` (${e.lead_score}/100)` : ''}` : null));
  return h('div.doc', h('div.page', { style: { fontSize: '11.5px' } },
    letterhead(s),
    h('div', { style: { textAlign: 'center', fontSize: '17px', fontWeight: 700, margin: '10px 0 2px' } }, 'TECHNO-COMMERCIAL REQUIREMENT SHEET'),
    h('div', { style: { textAlign: 'center', marginBottom: '8px' } }, `Enquiry ${e.enquiry_no || ''} · ${fmtDate(e.date) || ''}${brief?.submitted_at ? ` · detailed form received ${brief.submitted_at}${brief.submitted_by ? ` from ${brief.submitted_by}` : ''}` : ' · detailed form not received yet'}`),
    h('table', h('tbody',
      sec('Client & project', row('Hospital / client', e.hospital_name || P.hospital), row('Place', [e.place, e.district].filter(Boolean).join(', ') || P.city), row('Doctor / contact', [e.doctor_name || P.doctor, e.doctor_phone || P.phone, e.email].filter(Boolean).join(' · ')),
        row('Type of work', e.type_of_work), row('Capacity', e.capacity), row('Source', e.source), fieldsOf(PROJECT.filter(f => !['hospital', 'city', 'doctor', 'phone'].includes(f.key)), P)),
      sec('Site & scope of work', fieldsOf(SITE, S), row('Remarks', S.remarks)),
      otRows(),
      sec('Drawings & photos received', files.length ? files.map(a => row(a.filename, a.note || '')) : [row('—', 'None yet: ask for the architectural / structural drawing')]),
      sec('What the client told us online', row('Website form', e.web_summary)),
      internal)),
    h('table', { style: { marginTop: '18px' } }, h('tbody', h('tr', ['Prepared by (Sales)', 'Checked by (Technical)', 'Approved (MD)'].map(t => h('td', { style: { height: '64px', verticalAlign: 'bottom', textAlign: 'center', width: '33%' } }, t))))),
  ));
}

function challanDoc(c, project, s) {
  const lines = (c.lines || []).filter(l => l.description || Number(l.qty));
  const blanks = Math.max(0, 8 - lines.length);
  const cellInfo = (k, v) => [h('th', { style: { width: '17%' } }, k), h('td', v || '')];
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, `DELIVERY CHALLAN${c.challan_type === 'Returnable' ? ' (RETURNABLE)' : ''}`),
    h('div', { style: { textAlign: 'center', fontSize: '11px', marginBottom: '6px' } }, `GSTIN : ${s.gstin || ''}   ·   PAN : ${s.pan || ''}`),
    h('table', h('tbody',
      h('tr', ...cellInfo('Challan No', h('b', c.challan_no)), ...cellInfo('Date', fmtDate(c.date))),
      h('tr', ...cellInfo('Work Order', project?.project_no || ''), ...cellInfo('Project', project?.name || c.project_id_label)),
      c.bom_id || c.boq_id ? h('tr', ...cellInfo('BOQ', c.bom_id_label || ''), ...cellInfo('Client Work Order', c.boq_id_label || '')) : null,
      c.issue_no || c.vendor_id_label ? h('tr', ...cellInfo('Store Issue No', c.issue_no || ''), ...cellInfo('Vendor', c.vendor_id_label || '')) : null,
      h('tr', h('th', 'Consignee / Ship To'), h('td', { colspan: 3 }, ...multiline(c.ship_to || ''))),
      h('tr', ...cellInfo('Vehicle No', c.vehicle_no), ...cellInfo('Transporter', c.transporter)),
      c.driver ? h('tr', ...cellInfo('Driver', c.driver), h('th'), h('td')) : null)),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr.', 'Description of Material', 'UOM', 'Qty', 'Remark'].map((x, i) => h('th' + (i === 3 ? '.num' : ''), x)))),
      h('tbody', lines.map((l, i) => h('tr', h('td', i + 1), h('td.spec', l.description || ''), h('td', l.uom || ''), h('td.num', h('b', l.qty ?? '')), h('td', l.remark || ''))),
        Array.from({ length: blanks }, () => h('tr', Array.from({ length: 5 }, () => h('td', { style: { height: '20px' } }, ''))))),
      h('tfoot', h('tr', h('td', { colspan: 3 }, h('b', `Total items: ${lines.length}`)), h('td.num', h('b', round2(lines.reduce((a, l) => a + (Number(l.qty) || 0), 0)))), h('td')))),
    c.remarks ? h('p', h('b', 'Remarks: '), c.remarks) : null,
    h('p', { style: { fontSize: '11px' } }, 'Material dispatched against the above work order for supply / installation at site. Please check the material on receipt and sign with date and stamp.'),
    h('table', { style: { marginTop: '18px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By', 'Checked By (Store)', 'Driver / Transporter', "Receiver's Sign, Date & Stamp"].map(x => h('th', { style: { width: '25%' } }, x))),
      h('tr', [plainName(c.dispatched_by) || c.created_by, '', '', c.received_by ? `${c.received_by}${c.delivered_date ? ' · ' + fmtDate(c.delivered_date) : ''}` : ''].map(x => h('td', { style: { height: '60px', verticalAlign: 'bottom' } }, x || ''))))),
    h('div', { style: { marginTop: '6px' } }, h('b', `For, ${s.company_name}`)),
    c.status === 'Draft' ? h('div', { style: { color: '#b42318', fontWeight: 700, marginTop: '6px' } }, 'DRAFT – not yet dispatched') : null,
    footer()));
}

const SLIP_TITLES = { INWARD: 'GOODS RECEIPT NOTE (GRN)', OUTWARD: 'MATERIAL ISSUE SLIP', TRANSFER: 'MATERIAL TRANSFER NOTE', RETURN: 'MATERIAL RETURN NOTE', SCRAP: 'SCRAP NOTE', OPENING: 'OPENING STOCK', ADJUST: 'STOCK ADJUSTMENT' };
function stockSlipDoc(type, docNo, moves, s) {
  if (!['INWARD', 'OPENING'].includes(type)) return stockSlipNoPrice(type, docNo, moves, s);
  const m0 = moves[0] || {};
  const total = moves.reduce((a, m) => a + (Number(m.value) || 0), 0);
  const info = [
    ['No', docNo], ['Date', fmtDate(m0.date)],
    type === 'INWARD' && ['Supplier', m0.vendor_id_label || m0.supplier], type === 'INWARD' && ['Invoice', [m0.invoice_no, fmtDate(m0.invoice_date)].filter(Boolean).join(' dt. ')],
    type === 'INWARD' && ['PO No', m0.po_no || m0.po_id_label], ['Project', m0.project_id_label], ['Issued to / Site', m0.issued_to],
    type === 'TRANSFER' && ['From → To', `${m0.from_location || 'Store'} → ${m0.to_location || ''}`], ['Requested by', m0.requested_by], ['Original Issue No', m0.against_issue_no],
    ['Reason', m0.reason], ['Purpose', m0.purpose]].filter(x => x && x[1]);
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, SLIP_TITLES[type] || type),
    h('table', h('tbody', info.reduce((rows, x, i) => { if (i % 2 === 0) rows.push([]); rows.at(-1).push(h('th', { style: { width: '16%' } }, x[0]), h('td', x[1])); return rows; }, []).map(c => h('tr', c)))),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr', 'Item Code', 'Item Name', 'Qty', 'UOM', 'Rate', 'Value', 'Remark'].map((x, i) => h('th' + ([3, 5, 6].includes(i) ? '.num' : ''), x)))),
      h('tbody', moves.map((m, i) => h('tr', h('td', i + 1), h('td', (m.item_id_label || '').split(' · ')[0]), h('td', (m.item_id_label || '').split(' · ').slice(1).join(' · ')),
        h('td.num', m.qty), h('td', m.uom || ''), h('td.num', inr(m.rate)), h('td.num', inr(m.value)), h('td', m.remarks || '')))),
      h('tfoot', h('tr', h('td', { colspan: 6 }, 'Total'), h('td.num', inr(total)), h('td')))),
    h('table', { style: { marginTop: '24px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By (Store)', type === 'INWARD' ? 'Checked By (Quality)' : 'Received By', 'Authorised Signatory'].map(x => h('th', { style: { width: '33%' } }, x))),
      h('tr', [m0.created_by, '', ''].map(x => h('td', { style: { height: '50px', verticalAlign: 'bottom' } }, x || ''))))),
    footer()));
}

function stockSlipNoPrice(type, docNo, moves, s) {
  const m0 = moves[0] || {};
  const info = [['No', docNo], ['Date', fmtDate(m0.date)], ['Project', m0.project_id_label], ['Issued to / Site', m0.issued_to],
    type === 'TRANSFER' && ['From → To', `${m0.from_location || 'Store'} → ${m0.to_location || ''}`], ['Requested by', m0.requested_by], ['Original Issue No', m0.against_issue_no],
    ['Reason', m0.reason], ['Purpose', m0.purpose]].filter(x => x && x[1]);
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, SLIP_TITLES[type] || type),
    h('table', h('tbody', info.reduce((rows, x, i) => { if (i % 2 === 0) rows.push([]); rows.at(-1).push(h('th', { style: { width: '16%' } }, x[0]), h('td', x[1])); return rows; }, []).map(c => h('tr', c)))),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr', 'Item Code', 'Item Name', 'Qty', 'UOM', 'Remark'].map((x, i) => h('th' + (i === 3 ? '.num' : ''), x)))),
      h('tbody', moves.map((m, i) => h('tr', h('td', i + 1), h('td', (m.item_id_label || '').split(' · ')[0]), h('td', (m.item_id_label || '').split(' · ').slice(1).join(' · ')),
        h('td.num', m.qty), h('td', m.uom || ''), h('td', m.remarks || '')))),
      h('tfoot', h('tr', h('td', { colspan: 3 }, `Total items: ${moves.length}`), h('td.num', round2(moves.reduce((a, m) => a + (Number(m.qty) || 0), 0))), h('td', { colspan: 2 })))),
    h('table', { style: { marginTop: '24px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By (Store)', 'Received By', 'Authorised Signatory'].map(x => h('th', { style: { width: '33%' } }, x))),
      h('tr', [m0.created_by, '', ''].map(x => h('td', { style: { height: '50px', verticalAlign: 'bottom' } }, x || ''))))),
    footer()));
}

export async function printView(root, kind, id) {
  root.classList.remove('hidden');
  root.replaceChildren(h('div.empty', 'Preparing document…'));
  const s = await api('/settings');
  state.settings = s;
  let doc, title;
  if (kind === 'quotation') {
    const q = await api(`/quotations/${id}`);
    doc = quotationDoc(q, s);
    title = q.quote_no;
  } else if (kind === 'invoice') {
    const inv = await api(`/invoices/${id}`);
    const c = await api(`/customers/${inv.customer_id}`);
    const so = inv.sales_order_id ? await api(`/sales_orders/${inv.sales_order_id}`) : null;
    title = inv.invoice_no || 'Draft invoice';
    doc = taxDoc({ title: inv.type === 'Proforma Invoice' ? 'PROFORMA INVOICE' : 'TAX INVOICE', no: inv.invoice_no || 'DRAFT – not issued', date: inv.date, party: c, partyLabel: 'Bill to:',
      refs: [['Sales Order', so?.so_no], ['Client PO', so?.client_po_no], ['Due date', fmtDate(inv.due_date)]], items: inv.lines || [], place: inv.place_of_supply, notes: inv.notes, s });
  } else if (kind === 'creditnote') {
    const cn = await api(`/credit_notes/${id}`);
    const inv = await api(`/invoices/${cn.invoice_id}`);
    const c = await api(`/customers/${cn.customer_id}`);
    title = cn.cn_no || 'Draft credit note';
    doc = taxDoc({ title: 'CREDIT NOTE', no: cn.cn_no || 'DRAFT – not approved', date: cn.date, party: c, partyLabel: 'Issued to:',
      refs: [['Against invoice', inv.invoice_no], ['Invoice date', fmtDate(inv.date)], ['Reason', cn.reason]],
      items: [{ description: cn.description, hsn: (inv.lines || [])[0]?.hsn || '', qty: 1, uom: 'Lot', rate: cn.taxable, gst: cn.gst_rate }], place: cn.place_of_supply, notes: '', s });
  } else if (kind === 'po') {
    const po = await api(`/purchase_orders/${id}`);
    await siteLabels(po.lines);
    const v = await api(`/vendors/${po.vendor_id}`);
    title = `PO ${po.po_no} ${v.name}`;
    doc = poDoc(po, v, s);
  } else if (kind === 'challan') {
    const c = await api(`/challans/${id}`);
    const project = c.project_id ? await api(`/projects/${c.project_id}`).catch(() => null) : null;
    title = c.challan_no;
    doc = challanDoc(c, project, s);
  } else if (kind === 'bom') {
    const bom = await api(`/boms/${id}`);
    const rows = bomRows(await api(`/bom_items?bom_id=${id}&limit=20000`));
    title = `${bom.bom_no} ${bom.client || ''}`;
    doc = bomDoc(bom, rows, s);
  } else if (kind === 'requisition') {
    const r = await api(`/requisitions/${id}`);
    await siteLabels(r.lines);
    title = r.req_no;
    doc = requisitionDoc(r, s);
  } else if (kind === 'techsheet') {
    const e = await api(`/enquiries/${id}`);
    const [brief, files] = await Promise.all([api(`/enquiries/${id}/brief-data`).catch(() => ({})), api(`/attachments/enquiries/${id}`).catch(() => [])]);
    title = `Techno-commercial sheet ${e.enquiry_no || ''} ${e.hospital_name || ''}`.trim();
    doc = techSheetDoc(e, brief, files, s);
  } else if (kind === 'stockdoc') {
    const docNo = new URLSearchParams(location.hash.split('?')[1] || '').get('doc');
    const moves = await api(`/stock_moves?type=${encodeURIComponent(id)}&doc_no=${encodeURIComponent(docNo)}`);
    if (!moves.length) throw new Error(`No ${id} entries with number ${docNo}`);
    moves.sort((a, b) => a.id - b.id);
    title = `${SLIP_TITLES[id] || id} ${docNo}`;
    doc = stockSlipDoc(id, docNo, moves, s);
  } else throw new Error('Unknown document');
  document.title = title;
  root.replaceChildren(bar(title), doc);
}
