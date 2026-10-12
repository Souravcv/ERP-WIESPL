import { h, api, state, fmtDate } from '../ui.js';
import { roomAreas, quoteTotals, lineBasicRate, lineQty, inr, amountInWords, linesTotals, gstTotals, round2 } from '../calc.js';

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
      h('tr', h('td', { colspan: cols - 1 }, `GST @${q.gst_rate}%`), h('td.num', inr(t.gst))),
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
          h('tr', h('td', { colspan: 2 }, `GST @${q.gst_rate}%`), h('td.num', inr(t.gst))),
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
    s.bank_details && title !== 'PURCHASE ORDER' ? h('div.spec', { style: { marginTop: '8px' } }, h('b', 'Bank details: '), s.bank_details) : null,
    sign(s), footer()));
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
  const t = gstTotals(lines, intra);
  const rates = [...new Set(lines.filter(l => Number(l.qty) > 0).map(l => Number(l.gst) || 0))];
  const pct = rates.length === 1 ? rates[0] : null;
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
      h('tr', td(`Contact Person : ${v.contact_person || ''}${v.phone ? '  ·  Contact No : ' + v.phone : ''}`), td(`Contact Person : ${po.contact_person || ''}  ·  Contact No : ${po.contact_phone || ''}`, { colspan: 2 })))),
    h('p', { style: { margin: '6px 0' } }, `Ref.:- ${po.quotation_ref ? 'Your quotation ' + po.quotation_ref : 'Your quotation'}`),
    h('p', { style: { margin: '6px 0' } }, ...multiline(s.po_greeting || '')),
    h('table',
      h('thead', h('tr', ['Sr. No.', 'ITEM NAME', 'ITEM CODE', 'SPECIFICATIONS', 'Qty.', 'UOM', 'Rate (INR)', 'GST', 'Amount (INR)'].map((x, i) => h('th' + (i >= 4 && i !== 5 ? '.num' : ''), x)))),
      h('tbody', lines.map(l => h('tr',
        td(l.description ? ++sr : ''), td(h('b', l.description || '')), td(l.hsn || ''), td(h('div.spec', l.spec || '')),
        td(l.qty ?? '', { class: 'num' }), td(l.uom || ''), td(l.rate != null && Number(l.qty) ? inr(l.rate) : '', { class: 'num' }),
        td(Number(l.qty) ? `${l.gst ?? 0}%` : '', { class: 'num' }), td(Number(l.qty) ? inr((Number(l.qty) || 0) * (Number(l.rate) || 0)) : '', { class: 'num' })))),
      h('tfoot', h('tr', td(h('b', 'Sub Total'), { colspan: 8, style: { textAlign: 'right' } }), td(h('b', inr(t.subtotal)), { class: 'num' })))),
    h('table', { style: { marginTop: '-1px' } }, h('tbody', h('tr',
      td([h('b', 'Terms & conditions :'), h('table', { style: { border: 'none', marginTop: '4px' } }, h('tbody', terms.filter(([, val], i) => i === 0 || val).map(([k, val]) =>
        h('tr', h('td', { style: { border: 'none', width: '22px', verticalAlign: 'top' } }, ['Advance', 'Balance'].includes(k) ? '' : ++n),
          h('td', { style: { border: 'none', width: '110px', verticalAlign: 'top' } }, k === 'Payment Terms' ? h('b', k) : `${k}  -`),
          h('td', { style: { border: 'none', whiteSpace: 'pre-wrap' } }, val || '')))))], { style: { width: '62%' } }),
      td(h('table', { style: { border: 'none' } }, h('tbody',
        h('tr', h('td', { style: { border: 'none' } }, 'Sub Total For GST'), h('td.num', { style: { border: 'none' } }, inr(t.subtotal))),
        intra ? [h('tr', h('td', { style: { border: 'none' } }, `CGST${pct != null ? ` @${pct / 2}%` : ''}`), h('td.num', { style: { border: 'none' } }, inr(t.cgst))),
          h('tr', h('td', { style: { border: 'none' } }, `SGST${pct != null ? ` @${pct / 2}%` : ''}`), h('td.num', { style: { border: 'none' } }, inr(t.sgst)))]
          : h('tr', h('td', { style: { border: 'none' } }, `IGST${pct != null ? ` @${pct}%` : ''}`), h('td.num', { style: { border: 'none' } }, inr(t.igst))),
        h('tr', h('td', { style: { border: 'none' } }, 'Round off'), h('td.num', { style: { border: 'none' } }, inr(t.round_off))),
        h('tr', h('td', { style: { border: 'none', borderTop: '1px solid #555' } }, h('b', 'Grand Total')), h('td.num', { style: { border: 'none', borderTop: '1px solid #555' } }, h('b', inr(t.total)))))))))),
    h('table', { style: { marginTop: '-1px' } }, h('tbody', h('tr',
      td([h('b', 'Note: '), po.project_note || ''], { style: { width: '50%' } }),
      td([h('b', 'Rupees in words: '), amountInWords(t.total).replace(/^Rupees /, '')])))),
    h('table', { style: { marginTop: '-1px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By', 'Technical Approval', 'Commercial Approval', 'Approved By'].map(x => h('th', { style: { width: '25%' } }, x))),
      h('tr', [plainName(po.prepared_by) || po.created_by, plainName(po.tech_approved_by), plainName(po.comm_approved_by), plainName(po.approved_by)].map(x => h('td', { style: { height: '42px', verticalAlign: 'bottom' } }, x || ''))),
      h('tr', ['Purchase Executive', 'Technical Manager', 'Account Manager', 'General Manager'].map(x => h('td', x))))),
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
      lines.map((l, i) => h('tr', h('td', i + 1), h('td', l.description || ''), h('td.spec', l.spec || ''), h('td.num', l.qty ?? ''), h('td', l.uom || ''), h('td', l.remark || ''))),
      Array.from({ length: blanks }, () => h('tr', Array.from({ length: 6 }, () => h('td', { style: { height: '22px' } }, '')))),
      h('tr', h('th', { colspan: 2 }, 'Name & Sign of Requester'), h('th', 'Stamp'), h('th', { colspan: 3 }, 'Sign of Purchase Head')),
      h('tr', h('td', { colspan: 2, style: { height: '70px', verticalAlign: 'bottom' } }, r.requested_by || ''), h('td'), h('td', { colspan: 3, style: { verticalAlign: 'bottom' } }, r.approved_by ? `${r.approved_by} (${r.approved_at || ''})` : r.status))))));
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
      c.boq_id ? h('tr', ...cellInfo('BOQ', c.boq_id_label || ''), ...cellInfo('Customer', c.customer_id_label || '')) : null,
      h('tr', h('th', 'Consignee / Ship To'), h('td', { colspan: 3 }, ...multiline(c.ship_to || ''), c.site_contact ? [h('br'), `Contact: ${c.site_contact}`] : null)),
      h('tr', ...cellInfo('Vehicle No', c.vehicle_no), ...cellInfo('Transporter', c.transporter)),
      h('tr', ...cellInfo('LR / Docket No', c.lr_no), ...cellInfo('E-way Bill No', c.eway_bill)),
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
    title = inv.invoice_no;
    doc = taxDoc({ title: inv.type === 'Proforma Invoice' ? 'PROFORMA INVOICE' : 'TAX INVOICE', no: inv.invoice_no, date: inv.date, party: c, partyLabel: 'Bill to:',
      refs: [['Sales Order', so?.so_no], ['Client PO', so?.client_po_no], ['Due date', fmtDate(inv.due_date)]], items: inv.lines || [], place: inv.place_of_supply, notes: inv.notes, s });
  } else if (kind === 'po') {
    const po = await api(`/purchase_orders/${id}`);
    const v = await api(`/vendors/${po.vendor_id}`);
    title = `PO ${po.po_no} ${v.name}`;
    doc = poDoc(po, v, s);
  } else if (kind === 'challan') {
    const c = await api(`/challans/${id}`);
    const project = c.project_id ? await api(`/projects/${c.project_id}`).catch(() => null) : null;
    title = c.challan_no;
    doc = challanDoc(c, project, s);
  } else if (kind === 'requisition') {
    const r = await api(`/requisitions/${id}`);
    title = r.req_no;
    doc = requisitionDoc(r, s);
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
