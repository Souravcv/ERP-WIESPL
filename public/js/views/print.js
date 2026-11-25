import { h, api, state, fmtDate, navDepth } from '../ui.js';
import { loadSigns, sigImg, stampImg, plainSigner } from '../signs.js';
import { bomDoc } from './bom.js';
import { bomRows } from './form.js';
import { PROJECT, ROOM, SITE, roomCalc } from '../brief-fields.js';
import { roomAreas, quoteTotals, lineBasicRate, lineQty, inr, amountInWords, linesTotals, gstTotals, round2, poTotals } from '../calc.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const lines = s => String(s || '').split('\n');
const multiline = s => lines(s).flatMap((l, i) => (i ? [h('br'), l] : [l]));

export function letterhead(s) {
  return h('div.letterhead', h('img', { src: 'logo.jpeg', alt: 'WIESPL' }),
    h('div.co', h('b', s.company_name), h('div', s.reg_address), h('div', `${s.phone} · ${s.email} · ${s.website}`),
      s.gstin ? h('div', `GSTIN: ${s.gstin}`) : null));
}
// Footer of printed documents, written from Company Settings (it was a picture with the old registered address).
export const footer = (s = {}) => h('div.doc-foot',
  h('div.df-co', String(s.company_name || 'Western India Electromedical Systems Pvt. Ltd.').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())),
  s.reg_address ? h('div', h('span.df-k', 'Reg.: '), s.reg_address) : null,
  s.works_address ? h('div', h('span.df-k', 'Works : '), s.works_address) : null,
  h('div.df-row', h('span', [s.phone && `☎ ${s.phone}`, s.email && `✉ ${s.email}`, s.website].filter(Boolean).join('    ')), s.cin ? h('span', `CIN : ${s.cin}`) : null));
const sign = (s, by) => h('div.sign', h('div', h('b', `For, ${s.company_name}`)), h('div.space' + (by ? '.signed' : ''), by ? [stampImg(), sigImg(by)] : null), h('div', h('b', 'AUTHORISED SIGNATORY')), by ? h('div.signame', plainSigner(by)) : null);
export const page = (...c) => h('div.page', ...c);

function bar(title) {
  return h('div.print-bar', h('b', title), h('span', { style: { flex: 1 } }),
    h('span', { style: { fontSize: '12px', opacity: 0.8 } }, 'Use "Save as PDF" in the print dialog to create a PDF'),
    h('button.btn.small', { onclick: () => window.print() }, '🖨 Print / Save PDF'),
    h('button.btn.small', { onclick: () => (navDepth() > 0 ? history.back() : window.close()) }, 'Close'));
}

// ---------------------------------------------------------------- quotation
// Rooms printed side by side: at most 8 on a landscape A4 page (18 OTs → 8 + 8 + 2).
const ROOMS_PER_PAGE = 8;
const roomChunks = rooms => {
  const out = [];
  for (let i = 0; i < rooms.length; i += ROOMS_PER_PAGE) out.push({ rooms: rooms.slice(i, i + ROOMS_PER_PAGE), from: i + 1, to: Math.min(i + ROOMS_PER_PAGE, rooms.length) });
  return out;
};
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
    h('p', 'Yours faithfully,'), sign(s, q.approved_by), footer(s)));

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
      ['Average Equipment Load', 'kW', r => r.equip_kw], ['Lighting load per sq. ft', 'watt/sq. ft', r => r.light], ['Cooling Unit Type', 'DX / CHW', r => r.cooling], ['Air Conditioning + CHW', 'Tr.', r => r.ac_tr],
      ['Air Conditioning (WIESPL Scope)', 'Tr.', r => r.dx], ['CHW (Client Scope)', 'Tr.', r => r.chw], ['SS Strip heaters with PLC control', 'kW', r => r.heater_kw],
    ];
    // 8 rooms on each landscape page, so any number of OTs fits the paper
    const chunks = roomChunks(rooms);
    chunks.forEach((ch, c) => pages.push(page({ class: 'landscape' }, letterhead(s), h('h2', `ANNEXURE ${num('bod')}`),
      h('h3', `BASIS OF DESIGN${chunks.length > 1 ? ` (rooms ${ch.from}–${ch.to} of ${rooms.length})` : ''}`),
      h('table.rooms', h('colgroup', h('col', { style: { width: '4%' } }), h('col', { style: { width: '22%' } }), h('col', { style: { width: '10%' } }), ch.rooms.map(() => h('col'))),
        h('thead', h('tr', h('th', 'Sr.'), h('th', 'Project Parameters'), h('th', 'UOM'), ch.rooms.map(r => h('th.num', r.name)))),
        h('tbody', ROWS.map((row, i) => h('tr', h('td', i + 1), h('td', row[0]), h('td', row[1]), ch.rooms.map(r => h('td.num', row[2](r) ?? '')))))),
      c === chunks.length - 1 ? null : h('p', { style: { fontSize: '10px', textAlign: 'right' } }, 'continued on the next page'))));
  }

  // BOQ
  const boqLines = d.lines || [];
  let main = 0, sub = 0;
  const nums = boqLines.map(l => (l.sub ? `${main}.${++sub}` : (sub = 0, String(++main))));
  // More than 8 rooms do not fit side by side: the BOQ shows the totals, and the quantity of each room follows on
  // its own pages (8 rooms per page).
  const wide = rooms.length > ROOMS_PER_PAGE;
  const roomCols = wide ? [] : rooms;
  const cols = 8 + roomCols.length;
  const opt = d.optionals || [];
  pages.push(page({ class: 'landscape' }, letterhead(s), h('h2', `ANNEXURE ${num('boq')}`), h('h3', d.boq_title || 'WIESPL ESTIMATE'),
    h('table', h('thead', h('tr', h('th', 'Sr. No.'), h('th', 'Particulars'), h('th.num', 'Rate (INR)'), h('th.num', 'Installation'), h('th.num', 'Basic Rate'), h('th', 'UOM'),
      roomCols.map(r => h('th.num', r.name)), h('th.num', 'Total Qty'), h('th.num', 'Basic Total'))),
    h('tbody', boqLines.map((l, i) => l.kind === 'heading'
      ? h('tr', h('td', nums[i]), h('td.spec', { colspan: cols - 1 }, h('b', lines(l.description || l.name)[0]), ...multiline(lines(l.description || '').slice(1).join('\n')).map(x => x)))
      : h('tr', h('td', nums[i]), h('td.spec', l.description && l.description !== l.name ? [h('b', lines(l.description)[0]), lines(l.description).length > 1 ? h('br') : null, ...multiline(lines(l.description).slice(1).join('\n'))] : h('b', l.name)),
        h('td.num', inr(l.rate)), h('td.num', inr(l.install)), h('td.num', inr(lineBasicRate(l))), h('td', l.uom),
        roomCols.map(r => h('td.num', lineQty(l, r) || '')), h('td.num', t.lineTotals[l.id]?.qty || ''), h('td.num', inr(t.lineTotals[l.id]?.amount))))),
    h('tfoot',
      h('tr', h('td', { colspan: 6 }, h('b', 'BASIC TOTAL')), roomCols.map(r => h('td.num', h('b', inr(t.roomTotals[r.id])))), h('td'), h('td.num', h('b', inr(t.basic)))),
      t.discount ? h('tr', h('td', { colspan: cols - 1 }, `Discount @${q.discount_pct}%`), h('td.num', '− ' + inr(t.discount))) : null,
      Object.entries(t.gstByRate || { [q.gst_rate]: t.gst }).filter(([, v]) => v).map(([rate, v]) => h('tr', h('td', { colspan: cols - 1 }, `GST @${rate}%`), h('td.num', inr(v)))),
      h('tr', h('td', { colspan: cols - 1 }, h('b', 'GRAND ALL INCLUSIVE TOTAL')), h('td.num', h('b', inr(t.grand)))))),
    h('p', h('b', amountInWords(t.grand))),
    s.boq_note ? h('p', s.boq_note) : null,
    opt.length ? [h('h3', 'Optional Items'), h('table', h('thead', h('tr', ['Sr.No.', 'Optional Items', 'Rate (INR)', 'Installation', 'Basic Rate', 'Qty', 'UOM', 'Amount'].map((x, i) => h('th' + (i > 1 && i !== 6 ? '.num' : ''), x)))),
      h('tbody', opt.map((l, i) => h('tr', h('td', i + 1), h('td.spec', h('b', l.name), h('br'), ...multiline(l.description)), h('td.num', inr(l.rate)), h('td.num', inr(l.install)),
        h('td.num', inr(lineBasicRate(l))), h('td.num', l.qty), h('td', l.uom), h('td.num', inr(lineBasicRate(l) * (Number(l.qty) || 0))))))),
      h('p', 'Optional items are not included in the above total. GST extra as applicable.')] : null,
    sign(s, q.approved_by)));
  if (wide) {
    const items = boqLines.map((l, i) => [l, nums[i]]).filter(([l]) => l.kind !== 'heading');
    const chunks = roomChunks(rooms);
    chunks.forEach((ch, c) => pages.push(page({ class: 'landscape' }, letterhead(s), h('h2', `ANNEXURE ${num('boq')} – ROOM-WISE QUANTITIES`),
      h('h3', `Rooms ${ch.from}–${ch.to} of ${rooms.length}`),
      h('table.rooms', h('colgroup', h('col', { style: { width: '5%' } }), h('col', { style: { width: '27%' } }), h('col', { style: { width: '6%' } }), ch.rooms.map(() => h('col')), c === chunks.length - 1 ? h('col', { style: { width: '7%' } }) : null),
        h('thead', h('tr', h('th', 'Sr. No.'), h('th', 'Particulars'), h('th', 'UOM'), ch.rooms.map(r => h('th.num', r.name)), c === chunks.length - 1 ? h('th.num', 'Total Qty') : null)),
        h('tbody', items.map(([l, no]) => h('tr', h('td', no), h('td', lines(l.description || l.name)[0] || l.name), h('td', l.uom),
          ch.rooms.map(r => h('td.num', lineQty(l, r) || '')), c === chunks.length - 1 ? h('td.num', t.lineTotals[l.id]?.qty || '') : null))),
        h('tfoot', h('tr', h('td', { colspan: 3 }, h('b', 'BASIC TOTAL (₹)')), ch.rooms.map(r => h('td.num', h('b', inr(t.roomTotals[r.id])))), c === chunks.length - 1 ? h('td') : null))))));
  }

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
      sign(s, q.approved_by), footer(s)));
  }
  return h('div.doc', pages);
}

// ---------------------------------------------------------------- GST invoice / PO
function taxDoc({ title, no, date, party, partyLabel, refs, items, place, notes, s, approvedBy }) {
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
    sign(s, approvedBy), footer(s)));
}

// A requisition / PO for several sites: each line is printed with its site (nothing is added for a single site).
async function siteLabels(lines) {
  lines = lines || []; // a document saved without lines has lines: null
  const ids = new Set(lines.filter(l => l.project_id && Number(l.qty) > 0).map(l => Number(l.project_id)));
  if (!ids.size) return;
  const names = new Map((await api('/projects/options').catch(() => [])).map(o => [Number(o.id), o.label]));
  for (const l of lines) if (!l.site && l.project_id) l.site_label = names.get(Number(l.project_id)) || '';
}


// ---------------------------------------------------------------- service documents
export const grid = info => h('table', h('tbody', info.filter(x => x && x[1] != null && x[1] !== '').reduce((rows, x, i) => { if (i % 2 === 0) rows.push([]); rows.at(-1).push(h('th', { style: { width: '17%' } }, x[0]), h('td', x[1])); return rows; }, []).map(c => h('tr', c))));
const box = (title, text) => (text ? [h('div', { style: { fontWeight: 700, marginTop: '8px' } }, title), h('div.spec', { style: { border: '1px solid #999', padding: '6px', minHeight: '40px' } }, text)] : null);
export const signRow = (...who) => h('table', { style: { marginTop: '22px' } }, h('tbody', h('tr', who.map(w => h('th', { style: { width: `${100 / who.length}%` } }, w[0]))),
  h('tr', who.map(w => h('td', { style: { height: '56px', verticalAlign: 'bottom' } }, w[1] || '')))));

function swoDoc(w, s) {
  const lines = (w.lines || []).filter(l => l.description || l.qty);
  return h('div.doc', page(companyHead(s, 'SERVICE WORK ORDER (SERVICE REQUISITION)'),
    grid([['Client Name', w.hospital], ['S.W.O. No', w.swo_no], ['Work Location', w.location], ['Order Date', fmtDate(w.date)], ['Order Received From', w.order_from], ['Order Received By', w.received_by],
      ['Complaint', w.ticket_id_label], ['Status', w.status]]),
    h('table', { style: { marginTop: '8px' } }, h('thead', h('tr', ['Sr', 'Parts & Material Description', 'Make & Model', 'Qty', 'Remark'].map(x => h('th', x)))),
      h('tbody', lines.map((l, i) => h('tr', h('td', i + 1), h('td', l.description || ''), h('td', l.make || ''), h('td.num', `${l.qty ?? ''} ${l.uom || ''}`), h('td', l.remark || ''))))),
    box('Old Material Status', w.old_material_status), box('Additional Details', w.additional_details),
    grid([['Material Dispatch Through', w.dispatch_through], ['Docket Details', w.docket], ['Material Request', w.mr_id_label]]),
    signRow(['Prepared By', w.received_by], ['Work Authorized By', w.authorized_by], ['Work Complete – Signature', ''])));
}

function serviceReportDoc(r, s) {
  const tick = (label, on) => h('span', { style: { marginRight: '14px' } }, on ? '☑ ' : '☐ ', label);
  const fb = [['The level of courtesy & professionalism of our staff', r.fb_courtesy], ['The information provided by our staff', r.fb_information], ['The wait time for service', r.fb_wait], ['Overall service provided', r.fb_overall], ['Resolution of your concern', r.fb_resolution]];
  const RATES = ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'];
  const check = (r.checklist || []).filter(c => c.step);
  const read = (r.readings || []).filter(x => Object.values(x).some(v => v !== '' && v != null));
  const air = (r.airflow || []).filter(x => Object.values(x).some(v => v !== '' && v != null));
  const dampers = (r.dampers || []).filter(x => x.damper && Object.entries(x).some(([k, v]) => k !== 'damper' && v !== '' && v != null));
  const RC = ['timing', 'ot_temp', 'rh', 'comp1', 'comp2', 'blower', 'heater_r', 'heater_y', 'heater_b', 'coil', 'suction', 'discharge', 'remark'];
  const AC = ['ot', 'r1', 'r2', 'r3', 'r4', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'return_open', 'fresh_open', 'bypass_open'];
  return h('div.doc',
    page(companyHead(s, 'SERVICE REPORT'),
      grid([['Report No', r.report_no], ['Date / Time', [fmtDate(r.date), r.time_in].filter(Boolean).join(' ')], ['Hospital Name', r.hospital], ['Complaint From', r.complaint_from],
        ['Mr. / Ms.', r.contact_name], ['Mobile No', r.mobile], ['Email Id', r.email], ['Complaint No', r.ticket_id_label]]),
      h('div', { style: { margin: '6px 0' } }, h('b', 'Status of call: '), ['AMC Service Visit', 'Chargeable Basis', 'Break Down Call', 'Warranty'].map(x => tick(x, r.call_type === x))),
      grid([['OT / Room', r.ot_no], ['AHU Capacity', r.ahu_capacity], ['AC (TR)', r.ac_tr], ['No of ODU', r.odu_count], ['PLC Sr No', r.plc_sr], ['GSM Model Sr No', r.gsm_sr],
        ['Testing done', (r.tests_done || []).join(', ')], ['Particle count', [r.particle_count, r.particle_result].filter(Boolean).join(' – ')]]),
      box('Problem Observation', r.problem), box('Work done during service / Resolving issue', r.work_done),
      r.result ? h('div', { style: { margin: '6px 0', padding: '6px 8px', border: '2px solid ' + (r.result === 'Solved' ? '#16a34a' : '#d97706') } }, h('b', 'Result: '), r.result,
        r.result !== 'Solved' && r.next_action ? [h('br'), h('b', 'Next step: '), r.next_action, r.revisit_date ? ` (revisit ${fmtDate(r.revisit_date)})` : ''] : null) : null,
      (r.material_used || []).some(l => Number(l.qty) > 0) ? h('table', { style: { marginTop: '6px' } }, h('thead', h('tr', ['Material used', 'Qty', 'Remark'].map(x => h('th', x)))),
        h('tbody', (r.material_used || []).filter(l => Number(l.qty) > 0).map(l => h('tr', h('td', l.description || l.item_id_label || ''), h('td.num', `${l.qty} ${l.uom || ''}`), h('td', l.remark || ''))))) : null,
      grid([['End of Service Date', fmtDate(r.end_date)], ['Time', r.end_time], ['Call Attended By', r.attended_by]]),
      h('div', { style: { fontWeight: 700, marginTop: '8px' } }, 'Customer Feedback'),
      h('table', h('thead', h('tr', h('th', 'Particulars'), RATES.map(x => h('th', { style: { fontSize: '10px' } }, x)))),
        h('tbody', fb.map(([q, v]) => h('tr', h('td', q), RATES.map(x => h('td', { style: { textAlign: 'center' } }, v === x ? '●' : '○')))))),
      box('Additional Feedback / Information', r.additional_feedback),
      signRow(['Customer / Representative – Name, Seal & Signature', r.client_sign?.png ? h('div', h('img', { src: r.client_sign.png, style: { height: '56px', display: 'block' } }),
        [r.signed_by || r.customer_rep, r.signed_designation].filter(Boolean).join(', '), r.signed_at ? h('div', { style: { fontSize: '10px', color: '#555' } }, `Signed ${r.signed_at}`) : null) : r.customer_rep],
        ['Engineer / Technician – Name & Signature', r.attended_by])),
    check.length ? page(companyHead(s, 'ANNEXURE I : CHECK LIST'),
      h('table', h('thead', h('tr', ['Sr. No', 'Service Protocol Steps', 'Yes / No'].map(x => h('th', x)))), h('tbody', check.map((c, i) => h('tr', h('td', i + 1), h('td', c.step), h('td', { style: { textAlign: 'center' } }, c.done || '')))))) : null,
    read.length || air.length || dampers.length ? page(companyHead(s, 'TESTING PARAMETERS / AIR FLOW AND DAMPER OPENING STATUS'),
      grid([['Client Name', r.hospital], ['OT No', r.ot_no], ['VFD Freq (Hz)', r.vfd_hz], ['HEPA Pressure (Pa)', r.hepa_pa], ['Positive Pressure (Pa)', r.positive_pa], ['Ambient Temp (°C)', r.ambient_c], ['Date', fmtDate(r.date)]]),
      read.length ? h('table', { style: { marginTop: '8px', fontSize: '10px' } }, h('thead', h('tr', ['Timing', 'OT °C', 'RH %', 'Comp AC1 A', 'Comp AC2 A', 'Blower A', 'Heater R', 'Heater Y', 'Heater B', 'Coil °C', 'Suction PSI', 'Discharge PSI', 'Remark'].map(x => h('th', x)))),
        h('tbody', read.map(x => h('tr', RC.map(k => h('td', x[k] ?? '')))))) : null,
      air.length ? h('table', { style: { marginTop: '10px', fontSize: '10px' } }, h('thead', h('tr', ['OT', 'Return R1', 'R2', 'R3', 'R4', 'Supply HEPA 1', 'HEPA 2', 'HEPA 3', 'HEPA 4', 'HEPA 5', 'HEPA 6', 'Return open %', 'Fresh open %', 'Bypass open %'].map(x => h('th', x)))),
        h('tbody', air.map(x => h('tr', AC.map(k => h('td', x[k] ?? '')))))) : null,
      dampers.length ? h('table', { style: { marginTop: '10px', fontSize: '10px' } }, h('thead', h('tr', ['OT', 'Damper', 'Size', 'Qty', 'Opening %', 'Velocity / CFM', 'Condition', 'Remark'].map(x => h('th', x)))),
        h('tbody', dampers.map(x => h('tr', ['ot', 'damper', 'size', 'qty', 'opening', 'velocity', 'condition', 'remark'].map(k => h('td', x[k] ?? '')))))) : null,
      signRow(['Prepared By – Designation – Signature', r.attended_by])) : null);
}

// The AMC / warranty format: the client, the cover, the system OT by OT, the service visits and the breakdown calls.
function amcDoc(a, s) {
  const ots = (a.ot_systems || []).filter(x => Object.values(x).some(v => v !== '' && v != null));
  const visits = (a.service_plan || []).filter(p => p.visit || p.planned);
  return h('div.doc', page(companyHead(s, 'AMC / WARRANTY – SYSTEM DETAILS & SERVICE PLAN'),
    grid([['Client ID', a.client_id], ['Hospital', a.hospital], ['Doctor / Customer', a.customer_name], ['City', a.city], ['Contact Person', a.contact_person], ['Mobile', a.mobile], ['Email', a.email], ['Address', a.address],
      ['System', a.system_details], ['Cover', a.coverage], ['Warranty', [fmtDate(a.warranty_start), fmtDate(a.warranty_end)].filter(Boolean).join(' – ')], ['AMC Period', [fmtDate(a.amc_start), fmtDate(a.amc_end)].filter(Boolean).join(' – ')],
      ['AMC Amount (incl. GST)', a.amc_amount ? `₹ ${Number(a.amc_amount).toLocaleString('en-IN')}` : ''], ['Service Visits per Year', a.services_covered], ['Breakdown Calls Included', a.breakdowns_allowed ? `${a.breakdowns_allowed} a year (used: ${a.breakdowns_used || 0})` : 'As per agreement'],
      ['Particle Count', [a.particle_count_date && `last ${fmtDate(a.particle_count_date)}`, a.particle_next && `next ${fmtDate(a.particle_next)}`].filter(Boolean).join(', ')], ['Status', a.cover_status]]),
    ots.length ? [h('div', { style: { fontWeight: 700, marginTop: '10px' } }, 'System details – OT wise'), h('table', { style: { fontSize: '10px' } }, h('thead', h('tr', ['OT / Room', 'AHU (CFM)', 'AC (TR)', 'ODU', 'Return air dampers', 'Fresh air dampers', 'HEPA filters', 'PLC Sr', 'GSM Sr', 'Remark'].map(x => h('th', x)))),
      h('tbody', ots.map(x => h('tr', ['ot', 'ahu_cfm', 'ac_tr', 'odu', 'return_dampers', 'fresh_dampers', 'hepa', 'plc_sr', 'gsm_sr', 'remark'].map(k => h('td', x[k] ?? ''))))))] : null,
    visits.length ? [h('div', { style: { fontWeight: 700, marginTop: '10px' } }, 'Service visits'), h('table', h('thead', h('tr', ['Visit', 'Planned', 'Done on', 'Service report', 'Remark'].map(x => h('th', x)))),
      h('tbody', visits.map(p => h('tr', h('td', p.visit || ''), h('td', fmtDate(p.planned)), h('td', fmtDate(p.done)), h('td', p.report || ''), h('td', p.remark || '')))))] : null,
    box('Notes', a.notes),
    signRow(['For ' + (s.company_name || 'WIESPL') + ' – Authorised Signatory', ''], ['Client – Name, Seal & Signature', a.contact_person || ''])));
}

function rcaDoc(r, s) {
  const row = (k, v) => h('tr', h('th', { style: { width: '28%', textAlign: 'left' } }, k), h('td', { style: { whiteSpace: 'pre-wrap' } }, v || ''));
  return h('div.doc', page(companyHead(s, 'ROOT CAUSE ANALYSIS (RCA)'),
    h('table', h('tbody', row('RCA No / Date', `${r.rca_no || ''}   ${fmtDate(r.date)}`), row('Hospital Name', r.hospital), row('Contact Person', r.contact_person), row('Email', r.email), row('Ph. No.', r.phone),
      row('Date of Complaint', fmtDate(r.complaint_date)), row('Complaint Details', r.complaint_details), row('Date of Action Taken', [fmtDate(r.action_date), r.action_by].filter(Boolean).join(' – ')),
      row('Observation before resolving the issue', r.observation), row('Investigative Team', r.team), row('Findings', r.findings), row('Identification of Root Cause', r.root_cause),
      row('Corrective Action', r.corrective_action), row('Preventive Action', r.preventive_action), row('Sponsor Acceptance – Authorized Persons (Name & Designation)', r.authorized))),
    signRow(['Signature', ''], ['Date', fmtDate(r.date)])));
}

// Costing sheet printed for the customer: selling prices only (cost + company % + transport), GST, terms.
function costingDoc(cs, sell, c, s) {
  const items = sell.map(l => ({ description: l.description, hsn: l.hsn, qty: l.qty, uom: l.uom, rate: l.rate, gst: cs.gst_rate ?? 18 }));
  return taxDoc({ title: cs.kind === 'Service' ? 'SERVICE QUOTATION' : 'QUOTATION', no: cs.cs_no, date: cs.date, party: c || { name: cs.hospital || '' }, partyLabel: 'To:',
    refs: [['Subject', cs.title], ['Site', cs.site], ['Validity', cs.validity]], items, place: c?.state || 'Maharashtra', notes: cs.terms || '', s });
}

// ---------------------------------------------------------------- WIESPL purchase order (format WIESPL/PUR./02/R0)
const plainName = s => String(s || '').replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, '').replace(/\s*\(auto\)$/, '');
export function companyHead(s, title) {
  return h('div', { style: { textAlign: 'center', borderBottom: '2px solid #1f4e9a', paddingBottom: '6px', marginBottom: '6px', position: 'relative' } },
    h('img', { src: 'logo.jpeg', style: { position: 'absolute', left: 0, top: 0, height: '58px' } }),
    h('div', { style: { fontSize: '17px', fontWeight: 700, color: '#1f4e9a' } }, s.company_name),
    h('div', { style: { fontSize: '10.5px' } }, `Reg. : ${s.reg_address}`), h('div', { style: { fontSize: '10.5px' } }, `Works : ${s.works_address}`),
    h('div', { style: { fontSize: '10.5px' } }, `Tel. : ${s.phone}, Email : ${s.email}, Website : ${s.website}`), s.cin ? h('div', { style: { fontSize: '10.5px' } }, `CIN : ${s.cin}`) : null,
    title ? h('div', { style: { fontSize: '15px', fontWeight: 700, marginTop: '4px', textDecoration: 'underline' } }, title) : null);
}

// The vendor's copy names no project or site; the internal copy (approvals, files) shows them and the split per project.
function poDoc(po, v, s, internal = false) {
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
      h('tr', h('th', { style: { width: '13%' } }, 'P.O. No.'), td([h('b', po.po_no), po.revision ? ` Rev. ${po.revision}` : '']), h('th', { rowspan: 2, style: { fontSize: '16px', textAlign: 'center' } }, 'PURCHASE ORDER'), h('th', 'GST No.'), td(s.gstin)),
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
        td([h('div.spec', l.spec || ''), internal && (l.site || l.site_label) ? h('div', { style: { fontSize: '10px', fontWeight: 600 } }, `${l.split?.length > 1 ? 'For' : 'Site'}: ${l.site || l.site_label}`) : null, hasVendorCode && l.hsn ? h('div', { style: { fontSize: '10px', color: '#555' } }, `HSN/SAC ${l.hsn}`) : null]),
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
      td([h('b', 'Note: '), internal ? po.project_note || '' : ''], { style: { width: '50%' } }),
      td([h('b', 'Rupees in words: '), amountInWords(t.total).replace(/^Rupees /, '')])))),
    // Sign-offs in the approval order: Purchase (executive and head together, with the company stamp) → Technical →
    // Commercial → GM.
    (() => {
      const purchase = [...new Set([po.prepared_by || po.created_by, po.purchase_approved_by].filter(Boolean).map(plainName))];
      const cells = [[purchase.join(' / '), [po.prepared_by || po.created_by, po.purchase_approved_by].filter(Boolean).join(' · '), !!po.purchase_approved_by],
        [plainName(po.comm_approved_by), po.comm_approved_by], [plainName(po.approved_by), po.approved_by]];
      // POs approved before Nov 2026 still show their Technical approval
      const tech = !!po.tech_approved_by;
      if (tech) cells.splice(1, 0, [plainName(po.tech_approved_by), po.tech_approved_by]);
      const heads = ['Purchase (Prepared & Approved)', tech ? 'Technical Approval' : null, 'Commercial Approval', 'Approved By'].filter(Boolean);
      const roles = ['Purchase Executive / Purchase Head', tech ? 'Technical Manager' : null, 'Account Manager', 'General Manager'].filter(Boolean);
      return h('table.po-sign', { style: { marginTop: '-1px', textAlign: 'center' } }, h('tbody',
        h('tr', heads.map(x => h('th', { style: { width: `${100 / heads.length}%` } }, x))),
        h('tr', cells.map(([name, who, stamp]) => h('td', { style: { height: '40px', verticalAlign: 'bottom' } },
          h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '4px' } }, stamp ? stampImg() : null, who ? sigImg(who) : null), name || ''))),
        h('tr', roles.map(x => h('td', x)))));
    })(),
    h('div', { style: { fontSize: '10px', marginTop: '4px' } }, s.po_doc_no || 'WIESPL/PUR./02/R0'),
    internal ? h('div', { style: { color: '#1f4e9a', fontWeight: 700, marginTop: '6px' } }, 'INTERNAL COPY – shows projects / sites; send the vendor copy to the vendor') : null,
    po.status !== 'Approved' && !['Sent', 'Partially Received', 'Closed', 'Received'].includes(po.status) ? h('div', { style: { color: '#b42318', fontWeight: 700, marginTop: '6px' } }, `DRAFT – status: ${po.status}${po.approval_stage ? ' (waiting for ' + po.approval_stage + ')' : ''}`) : null));
}

function materialRequestDoc(r, s) {
  const lines = (r.lines || []).filter(l => l.description || l.qty);
  const info = [['MR No', r.mr_no], ['Date', fmtDate(r.date)], ['Requested by', r.requested_by], ['Department', r.department], ['For', r.purpose], ['Site', r.site || r.project_id_label], ['Needed by', fmtDate(r.needed_by)], ['Status', r.status]].filter(x => x[1]);
  return h('div.doc', page(companyHead(s, 'MATERIAL REQUEST (TO STORE)'),
    h('table', h('tbody', info.reduce((rows, x, i) => { if (i % 2 === 0) rows.push([]); rows.at(-1).push(h('th', { style: { width: '16%' } }, x[0]), h('td', x[1])); return rows; }, []).map(c => h('tr', c)))),
    h('table', { style: { marginTop: '8px' } }, h('thead', h('tr', ['Sr', 'Material', 'Specification', 'Qty', 'UOM', 'Site', 'Issued', 'To purchase', 'Remark'].map(x => h('th', x)))),
      h('tbody', lines.map((l, i) => h('tr', h('td', i + 1), h('td', l.description || ''), h('td.spec', l.spec || ''), h('td.num', l.qty ?? ''), h('td', l.uom || ''), h('td', l.site || r.site || ''),
        h('td.num', l.issued || ''), h('td.num', l.to_purchase || ''), h('td', l.remark || ''))))),
    r.store_note ? h('div.spec', { style: { marginTop: '8px' } }, h('b', 'Store decision: '), r.store_note) : null,
    h('table', { style: { marginTop: '24px' } }, h('tbody', h('tr', ['Requested by', 'Store', 'Received by'].map(x => h('th', { style: { width: '33%' } }, x))),
      h('tr', h('td', { style: { height: '60px', verticalAlign: 'bottom' } }, r.requested_by || ''), h('td', { style: { verticalAlign: 'bottom' } }, plainSigner(r.processed_by || '')), h('td'))))));
}

function requisitionDoc(r, s) {
  const lines = (r.lines || []).filter(l => l.description || l.spec || l.qty);
  const siteOf = l => l.site || l.site_label || '';
  const showSite = lines.some(siteOf);
  const blanks = Math.max(0, 11 - lines.length);
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    h('table', h('tbody',
      h('tr', h('td', { colspan: 6, style: { textAlign: 'center', fontSize: '16px', fontWeight: 700 } }, 'Material Purchase Requisition')),
      h('tr', h('td', { colspan: 6, style: { textAlign: 'center', fontWeight: 700, color: '#1f4e9a' } }, s.company_name)),
      h('tr', h('td', { colspan: 6, style: { textAlign: 'center', fontSize: '10.5px' } }, `Reg. : ${s.reg_address}`, h('br'), `Works : ${s.works_address}`, h('br'), `Tel. : ${s.phone}`)),
      h('tr', h('td', { colspan: 2 }, h('b', 'Project Name :- '), r.project_name || r.project_id_label || ''), h('td', { colspan: 2 }, h('b', 'Req No - '), r.req_no), h('td', { colspan: 2 }, h('b', 'Date '), fmtDate(r.date))),
      h('tr', ['Sr. No.', 'Material Description', 'Specification', 'Qty.', 'UOM', showSite ? 'Site' : null, 'Remark'].filter(Boolean).map(x => h('th', x))),
      lines.map((l, i) => h('tr', h('td', i + 1), h('td', l.description || ''), h('td.spec', l.spec || ''), h('td.num', l.qty ?? ''), h('td', l.uom || ''), showSite ? h('td', { style: { fontWeight: 600 } }, siteOf(l)) : null, h('td', l.remark || ''))),
      Array.from({ length: blanks }, () => h('tr', Array.from({ length: showSite ? 7 : 6 }, () => h('td', { style: { height: '22px' } }, '')))),
      h('tr', h('th', { colspan: 2 }, 'Name & Sign of Requester'), h('th', 'Stamp'), h('th', { colspan: 3 }, 'Sign of Purchase Head')),
      h('tr', h('td', { colspan: 2, style: { height: '70px', verticalAlign: 'bottom' } }, r.approved_by ? sigImg(r.requested_by) : null, r.requested_by || ''), h('td', { style: { textAlign: 'center', verticalAlign: 'middle' } }, r.approved_by ? stampImg() : null),
        h('td', { colspan: 3, style: { verticalAlign: 'bottom' } }, r.approved_by ? [sigImg(r.approved_by), `${plainSigner(r.approved_by)} (${r.approved_at || ''})`] : r.status))))));
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
      sec('Client & project', row('Hospital / client', e.hospital_name || P.hospital), row('Place', [e.place, e.state, e.pin_code].filter(Boolean).join(', ') || P.city), row('Client / contact', [e.client_name || P.doctor, e.client_phone || P.phone, e.email].filter(Boolean).join(' · ')),
        row('Type of work', (e.type_of_work || []).join(', ')), row('Hospital capacity (approx.)', [e.capacity, e.icu_beds != null && `ICU beds ${e.icu_beds}`, e.nicu_beds != null && `NICU beds ${e.nicu_beds}`].filter(Boolean).join(' · ')),
        row('AHU by area', (e.ahu_areas || []).map(a => `${a.area}: ${a.ahu_count ?? 0} AHU${a.cfm ? ` · ${a.cfm} cfm` : ''}${a.notes ? ` (${a.notes})` : ''}`).join('\n')),
        row('Source', e.source), row('Salesperson', e.enquiry_by), fieldsOf(PROJECT.filter(f => !['hospital', 'city', 'doctor', 'phone'].includes(f.key)), P)),
      sec('Site & scope of work', fieldsOf(SITE, S), row('Remarks', S.remarks)),
      otRows(),
      sec('Drawings & photos received', files.length ? files.map(a => row(a.filename, a.note || '')) : [row('—', 'None yet: ask for the architectural / structural drawing')]),
      sec('What the client told us online', row('Website form', e.web_summary)),
      internal)),
    h('table', { style: { marginTop: '18px' } }, h('tbody', h('tr', ['Prepared by (Sales)', 'Checked by (Technical)', 'Approved (MD)'].map(t => h('td', { style: { height: '64px', verticalAlign: 'bottom', textAlign: 'center', width: '33%' } }, t))))),
  ));
}

// The challan is a delivery document only: what goes, how it goes and who receives it. No prices and nothing from the
// BOQ / work order (those stay in the CRM). Lines made from a BOQ before 29 Oct 2026 carry "(BOQ <section> <sr>)" in the
// description: it is cut off here.
export const challanText = d => {
  const s = String(d || '').trimEnd(), i = s.lastIndexOf('(BOQ ');
  return i > 0 && s.endsWith(')') ? s.slice(0, i).trimEnd() : s; // the section name may have brackets of its own
};
function challanDoc(c, s, codes = {}) {
  const lines = (c.lines || []).filter(l => l.description || Number(l.qty));
  const blanks = Math.max(0, 8 - lines.length);
  const cellInfo = (k, v) => [h('th', { style: { width: '17%' } }, k), h('td', v || '')];
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, `DELIVERY CHALLAN${c.challan_type === 'Returnable' ? ' (RETURNABLE)' : ''}`),
    h('div', { style: { textAlign: 'center', fontSize: '11px', marginBottom: '6px' } }, `GSTIN : ${s.gstin || ''}   ·   PAN : ${s.pan || ''}`),
    h('table', h('tbody',
      h('tr', ...cellInfo('Challan No', h('b', c.challan_no)), ...cellInfo('Date', fmtDate(c.date))),
      h('tr', h('th', 'Receiver / Ship To'), h('td', { colspan: 3 }, c.vendor_id_label ? h('div', h('b', c.vendor_id_label)) : null, ...multiline(c.ship_to || ''))),
      c.receiver_name || c.site_contact ? h('tr', ...cellInfo('Receiver Name', c.receiver_name), ...cellInfo('Receiver Contact', c.site_contact)) : null,
      c.section || c.boq_id_label ? h('tr', ...cellInfo('Work Order', c.boq_id_label), ...cellInfo('Section', c.section)) : null,
      h('tr', ...cellInfo('Vehicle No', c.vehicle_no), ...(c.transporter ? cellInfo('Transporter', c.transporter) : cellInfo('Driver', c.driver))),
      (c.driver && c.transporter) || c.lr_no ? h('tr', ...cellInfo('Driver', c.transporter ? c.driver : ''), ...cellInfo('LR / Docket No', c.lr_no)) : null)),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr.', 'Item', 'Description of Material', 'Qty', 'Unit', 'Remark'].map((x, i) => h('th' + (i === 3 ? '.num' : ''), x)))),
      h('tbody', lines.map((l, i) => h('tr', h('td', i + 1), h('td.nowrap', codes[l.item_id] || ''), h('td.spec', challanText(l.description)), h('td.num', h('b', l.qty ?? '')), h('td', l.uom || ''), h('td', l.remark || ''))),
        Array.from({ length: blanks }, () => h('tr', Array.from({ length: 6 }, () => h('td', { style: { height: '20px' } }, ''))))),
      h('tfoot', h('tr', h('td', { colspan: 3 }, h('b', `Total items: ${lines.length}`)), h('td.num', h('b', round2(lines.reduce((a, l) => a + (Number(l.qty) || 0), 0)))), h('td', { colspan: 2 })))),
    c.remarks ? h('p', h('b', 'Remarks: '), c.remarks) : null,
    h('p', { style: { fontSize: '11px' } }, 'Material sent as listed above. Please check the material on receipt and sign with date and stamp.'),
    h('table', { style: { marginTop: '18px', textAlign: 'center' } }, h('tbody',
      // the store always prepares the challan; someone checks it; the receiver signs at site
      h('tr', ['Prepared By (Store)', 'Checked By', "Receiver's Sign, Date & Stamp"].map(x => h('th', { style: { width: '33%' } }, x))),
      h('tr', [plainName(c.dispatched_by) || c.created_by, '', c.received_by ? `${c.received_by}${c.delivered_date ? ' · ' + fmtDate(c.delivered_date) : ''}` : ''].map((x, i) => h('td', { style: { height: '60px', verticalAlign: 'bottom' } }, i === 0 && c.dispatched_by ? [stampImg(), sigImg(c.dispatched_by)] : null, x || ''))))),
    h('div', { style: { marginTop: '6px' } }, h('b', `For, ${s.company_name}`)),
    c.status === 'Draft' ? h('div', { style: { color: '#b42318', fontWeight: 700, marginTop: '6px' } }, 'DRAFT – not yet dispatched') : null,
    footer(s)));
}

const SLIP_TITLES = { MOVE: 'DEPARTMENT TRANSFER NOTE', INWARD: 'GOODS RECEIPT NOTE (GRN)', OUTWARD: 'MATERIAL ISSUE SLIP', TRANSFER: 'MATERIAL TRANSFER NOTE (MTN)', JOB_OUT: 'JOB WORK OUTWARD – DC TO VENDOR', JOB_IN: 'JOB WORK INWARD (GRN)', PRODUCED: 'PRODUCTION NOTE (FINISHED GOODS MADE)', RETURN: 'MATERIAL RETURN NOTE', SCRAP: 'SCRAP NOTE', OPENING: 'OPENING STOCK', ADJUST: 'STOCK ADJUSTMENT' };
function stockSlipDoc(type, docNo, moves, s, lotsOf) {
  if (!['INWARD', 'OPENING', 'JOB_IN'].includes(type)) return stockSlipNoPrice(type, docNo, moves, s, lotsOf);
  const m0 = moves[0] || {};
  const total = moves.reduce((a, m) => a + (Number(m.value) || 0), 0);
  const info = [
    ['No', docNo], ['Date', fmtDate(m0.date)],
    ['INWARD', 'JOB_IN'].includes(type) && ['Supplier', m0.vendor_id_label || m0.supplier], ['INWARD', 'JOB_IN'].includes(type) && ['Invoice', [m0.invoice_no, fmtDate(m0.invoice_date)].filter(Boolean).join(' dt. ')],
    type === 'INWARD' && ['PO No', [...new Set(moves.map(m => m.po_no || m.po_id_label).filter(Boolean))].join(', ') || 'not linked'], ['Project', m0.project_id_label], ['Issued to / Site', m0.issued_to],
    ['TRANSFER', 'JOB_OUT'].includes(type) && ['From → To', `${m0.from_location || 'Store'} → ${m0.to_location || ''}`], ['Requested by', m0.requested_by], ['Original Issue No', m0.against_issue_no],
    ['Reason', m0.reason], ['Purpose', m0.purpose]].filter(x => x && x[1]);
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, SLIP_TITLES[type] || type),
    h('table', h('tbody', info.reduce((rows, x, i) => { if (i % 2 === 0) rows.push([]); rows.at(-1).push(h('th', { style: { width: '16%' } }, x[0]), h('td', x[1])); return rows; }, []).map(c => h('tr', c)))),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr', 'Item Code', 'Item Name', 'Qty', 'UOM', 'Rate', 'Value', 'Remark'].map((x, i) => h('th' + ([3, 5, 6].includes(i) ? '.num' : ''), x)))),
      h('tbody', moves.map((m, i) => h('tr', h('td', i + 1), h('td', (m.item_id_label || '').split(' · ')[0]), h('td', (m.item_id_label || '').split(' · ').slice(1).join(' · '), type === 'INWARD' && m.po_no ? ` (PO ${m.po_no})` : ''),
        h('td.num', m.qty), h('td', m.uom || ''), h('td.num', inr(m.rate)), h('td.num', inr(m.value)), h('td', m.remarks || '')))),
      h('tfoot', h('tr', h('td', { colspan: 6 }, 'Total'), h('td.num', inr(total)), h('td')))),
    h('table', { style: { marginTop: '24px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By (Store)', type === 'INWARD' ? 'Checked By (Quality)' : 'Received By', 'Authorised Signatory'].map(x => h('th', { style: { width: '33%' } }, x))),
      h('tr', [m0.created_by, '', ''].map(x => h('td', { style: { height: '50px', verticalAlign: 'bottom' } }, x || ''))))),
    footer(s)));
}

// Incoming Inspection Report of one GRN (Quality): received, accepted, rejected, remarks, inspected by.
function iqcDoc(r, s) {
  const st = l => (l.qc_status === 'Partly accepted' ? 'Partly accepted' : l.qc_status || 'Pending');
  const cell = { border: '1px solid #999', padding: '3px 5px', verticalAlign: 'top' };
  const tot = k => Math.round(r.lines.reduce((a, l) => a + (Number(l[k]) || 0), 0) * 1000) / 1000;
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, 'INCOMING INSPECTION REPORT (IQC)'),
    grid([['GRN No', r.doc_no], ['GRN Date', fmtDate(r.date)], ['Supplier', r.vendor], ['PO No', r.po_no], ['Invoice No', r.invoice_no], ['Invoice Date', fmtDate(r.invoice_date)],
      ['Inspected By', r.inspectors.join(', ') || '—'], ['Result', r.open ? `${r.open} line(s) still pending` : 'All lines inspected']]),
    h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: '8px' } },
      h('thead', h('tr', ['#', 'Item', 'Category', 'Batch / lot', 'Received', 'Accepted', 'Rejected', 'Result', 'Remarks / defect', 'Inspected by'].map(x => h('th', { style: { ...cell, background: '#eef2f7' } }, x)))),
      h('tbody', r.lines.map((l, i) => h('tr', h('td', { style: cell }, i + 1), h('td', { style: cell }, [l.code, l.item].filter(Boolean).join(' · ')), h('td', { style: cell }, l.category || ''),
        h('td', { style: cell }, l.batch_no || ''), h('td', { style: { ...cell, textAlign: 'right' } }, `${l.qty} ${l.uom || l.item_uom || ''}`),
        h('td', { style: { ...cell, textAlign: 'right' } }, l.accepted ?? ''), h('td', { style: { ...cell, textAlign: 'right' } }, l.qc_status === 'Rejected' ? l.qty : l.qc_rejected || ''),
        h('td', { style: { ...cell, fontWeight: 700, color: ['Rejected', 'Hold'].includes(l.qc_status) ? '#b00' : l.qc_status === 'Accepted' ? '#2e7d32' : '#555' } }, st(l)),
        h('td', { style: cell }, l.qc_remarks || ''), h('td', { style: cell }, [l.qc_by || (l.inspector ? `(${l.inspector})` : ''), l.qc_at ? fmtDate(String(l.qc_at).slice(0, 10)) : ''].filter(Boolean).join(' · ')))).flatMap((row, i) => {
        const l = r.lines[i];
        const list = l.qc_checks?.length ? l.qc_checks.map(c => `${c.result === 'Pass' ? '✔' : c.result === 'Fail' ? '✗' : '–'} ${c.check}`) : (l.norms || []).map(c => `☐ ${c}`);
        return [row, list.length ? h('tr', h('td', { style: cell }), h('td', { style: { ...cell, fontSize: '10.5px', color: '#444' }, colSpan: 9 }, h('b', l.qc_checks?.length ? 'Checks: ' : 'Checks to do: '), list.join('   '))) : null];
      })),
      h('tfoot', h('tr', h('td', { style: cell, colSpan: 4 }, h('b', 'Total')), h('td', { style: { ...cell, textAlign: 'right' } }, h('b', tot('qty'))), h('td', { style: { ...cell, textAlign: 'right' } }, h('b', tot('accepted'))),
        h('td', { style: { ...cell, textAlign: 'right' } }, h('b', Math.round(r.lines.reduce((a, l) => a + (l.qc_status === 'Rejected' ? Number(l.qty) : Number(l.qc_rejected) || 0), 0) * 1000) / 1000)), h('td', { style: cell, colSpan: 3 })))),
    h('p', { style: { fontSize: '10.5px', marginTop: '6px' } }, 'Rejected material is kept apart, is not issued and is not paid for; Purchase raises the debit note / return to the vendor (SCAR for repeated rejections).'),
    signRow(['Inspected by (Quality)', r.inspectors.join(', ')], ['Store', ''], ['Approved by (QC Head)', ''])));
}

function stockSlipNoPrice(type, docNo, moves, s, lotsOf = {}) {
  const m0 = moves[0] || {};
  const info = [['No', docNo], ['Date', fmtDate(m0.date)], ['Project', m0.project_id_label], ['Issued to / Site', m0.issued_to],
    ['TRANSFER', 'JOB_OUT'].includes(type) && ['From → To', `${m0.from_location || 'Store'} → ${m0.to_location || ''}`], ['Requested by', m0.requested_by], ['Original Issue No', m0.against_issue_no],
    ['Reason', m0.reason], ['Purpose', m0.purpose]].filter(x => x && x[1]);
  return h('div.doc', h('div.page', { style: { fontSize: '12px' } },
    companyHead(s, SLIP_TITLES[type] || type),
    h('table', h('tbody', info.reduce((rows, x, i) => { if (i % 2 === 0) rows.push([]); rows.at(-1).push(h('th', { style: { width: '16%' } }, x[0]), h('td', x[1])); return rows; }, []).map(c => h('tr', c)))),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr', 'Item Code', 'Item Name', 'Qty', 'UOM', 'Remark'].map((x, i) => h('th' + (i === 3 ? '.num' : ''), x)))),
      h('tbody', moves.map((m, i) => h('tr', h('td', i + 1), h('td', (m.item_id_label || '').split(' · ')[0]),
        h('td', (m.item_id_label || '').split(' · ').slice(1).join(' · '), lotsOf[m.id]?.length ? h('div', { style: { fontSize: '10px', color: '#555' } }, 'from ' + lotsOf[m.id].map(a => `${a.lot} (${a.qty})`).join(', ')) : null),
        h('td.num', m.qty), h('td', m.uom || ''), h('td', m.remarks || '')))),
      h('tfoot', h('tr', h('td', { colspan: 3 }, `Total items: ${moves.length}`), h('td.num', round2(moves.reduce((a, m) => a + (Number(m.qty) || 0), 0))), h('td', { colspan: 2 })))),
    h('table', { style: { marginTop: '24px', textAlign: 'center' } }, h('tbody',
      h('tr', ['Prepared By (Store)', 'Received By', 'Authorised Signatory'].map(x => h('th', { style: { width: '33%' } }, x))),
      h('tr', [m0.created_by, '', ''].map(x => h('td', { style: { height: '50px', verticalAlign: 'bottom' } }, x || ''))))),
    footer(s)));
}

export async function printView(root, kind, id) {
  root.classList.remove('hidden');
  root.replaceChildren(h('div.empty', 'Preparing document…'));
  const s = await api('/settings');
  state.settings = s;
  await loadSigns();
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
    doc = invoiceDoc(inv, c, so, s);
  } else if (kind === 'creditnote') {
    const cn = await api(`/credit_notes/${id}`);
    const inv = await api(`/invoices/${cn.invoice_id}`);
    const c = await api(`/customers/${cn.customer_id}`);
    title = cn.cn_no || 'Draft credit note';
    doc = taxDoc({ title: 'CREDIT NOTE', no: cn.cn_no || 'DRAFT – not approved', date: cn.date, party: c, partyLabel: 'Issued to:',
      refs: [['Against invoice', inv.invoice_no], ['Invoice date', fmtDate(inv.date)], ['Reason', cn.reason]],
      items: [{ description: cn.description, hsn: (inv.lines || [])[0]?.hsn || '', qty: 1, uom: 'Lot', rate: cn.taxable, gst: cn.gst_rate }], place: cn.place_of_supply, notes: '', s, approvedBy: cn.approved_by });
  } else if (kind === 'po') {
    const po = await api(`/purchase_orders/${id}`);
    await siteLabels(po.lines);
    const v = await api(`/purchase_orders/${id}/vendor`);
    const internal = new URLSearchParams(location.hash.split('?')[1] || '').get('internal') === '1';
    title = `PO ${po.po_no} ${v.name}${internal ? ' (internal)' : ''}`;
    doc = poDoc(po, v, s, internal);
  } else if (kind === 'challan') {
    const c = await api(`/challans/${id}`);
    // item code of each store item on the challan
    const ids = [...new Set((c.lines || []).map(l => l.item_id).filter(Boolean))];
    const codes = Object.fromEntries(await Promise.all(ids.map(i => api(`/items/${i}`).then(it => [i, it.code || ''], () => [i, '']))));
    title = c.challan_no;
    doc = challanDoc(c, s, codes);
  } else if (kind === 'bom') {
    const bom = await api(`/boms/${id}`);
    const rows = bomRows(await api(`/bom_items?bom_id=${id}&limit=20000`));
    title = `${bom.bom_no} ${bom.client || ''}`;
    doc = bomDoc(bom, rows, s);
  } else if (kind === 'swo') {
    const w = await api(`/service_work_orders/${id}`);
    title = w.swo_no; doc = swoDoc(w, s);
  } else if (kind === 'servicereport') {
    const r = await api(`/service_reports/${id}`);
    title = `${r.report_no} ${r.hospital || ''}`; doc = serviceReportDoc(r, s);
  } else if (kind === 'amc') {
    const a = await api(`/amc_contracts/${id}`);
    title = `AMC ${a.hospital || ''}`; doc = amcDoc(a, s);
  } else if (kind === 'rca') {
    const r = await api(`/rca_reports/${id}`);
    title = `${r.rca_no} ${r.hospital || ''}`; doc = rcaDoc(r, s);
  } else if (kind === 'costing') {
    const cs = await api(`/costing_sheets/${id}`);
    const [sell, c] = await Promise.all([api(`/costing_sheets/${id}/selling`), cs.customer_id ? api(`/customers/${cs.customer_id}`).catch(() => null) : null]);
    title = `${cs.cs_no} ${cs.hospital || ''}`; doc = costingDoc(cs, sell, c, s);
  } else if (kind === 'mr') {
    const r = await api(`/material_requests/${id}`);
    title = r.mr_no;
    doc = materialRequestDoc(r, s);
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
  } else if (kind === 'iqc') {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const r = await api(`/iqc/report?doc=${encodeURIComponent(q.get('doc') || '')}${q.get('date') ? `&date=${q.get('date')}` : ''}`);
    title = `IQC report GRN ${r.doc_no}`;
    doc = iqcDoc(r, s);
  } else if (kind === 'stockdoc') {
    const docNo = new URLSearchParams(location.hash.split('?')[1] || '').get('doc');
    const moves = await api(`/stock_moves?type=${encodeURIComponent(id)}&doc_no=${encodeURIComponent(docNo)}`);
    if (!moves.length) throw new Error(`No ${id} entries with number ${docNo}`);
    moves.sort((a, b) => a.id - b.id);
    title = `${SLIP_TITLES[id] || id} ${docNo}`;
    const lotsOf = ['OUTWARD', 'TRANSFER', 'SCRAP', 'JOB_OUT'].includes(id) ? await api(`/lots/for-doc?type=${encodeURIComponent(id)}&doc=${encodeURIComponent(docNo)}`).catch(() => ({})) : {};
    doc = stockSlipDoc(id, docNo, moves, s, lotsOf);
  } else if (['bond', 'onboarding', 'probation', 'confirmation', 'acceptance', 'relieving', 'fnf', 'exitinterview'].includes(kind)) {
    const { hrDoc } = await import('./hrprint.js');
    ({ doc, title } = await hrDoc(kind, id, s));
  } else if (['prodorder', 'prodplan', 'prodday', 'prodmonth', 'qcreport', 'qcfile', 'ncr'].includes(kind)) {
    const { prodDoc } = await import('./prodprint.js');
    ({ doc, title } = await prodDoc(kind, id, s));
  } else throw new Error('Unknown document');
  document.title = title;
  root.replaceChildren(bar(title), doc);
}

// ---------------------------------------------------------------- the tax invoice, in WIESPL's format
// Bill To / Ship To with GST no.; invoice no., date, Udyam (MSME) no., challan no., the client's work order no. and date;
// the material by area (a line without qty and rate is an area heading: A Mj OT 1, B Mj OT 2 … numbered 1, 2 … under it);
// basic total, CGST + SGST (or IGST) per rate, round off, grand total; the terms, signatory, client's seal, bank details.
const INVOICE_TERMS = ['Supply of material as per attached Annexure.', 'Our responsibility ceases as soon as goods leave our premises.',
  'Material stored at your premises is under your responsibility.', 'Material provided as per work order.', 'Rejected material should be returned with in 7 days.',
  'Interest will be charges @ 24 % p.a. on bills not paid within 30 days.', 'Goods once sold will not be taken back under any circumstances.',
  'Rates applied are inclusive of installation and finishing as per provided BOQ.', 'Subject to PUNE Jurisdiction.',
  'Material provided will be under comprehensive warranty 12 month from the date of installation.'];
function invoiceDoc(inv, c, so, s) {
  const intra = (inv.place_of_supply || '').toLowerCase() === (s.state || 'Maharashtra').toLowerCase();
  const items = (inv.lines || []).filter(l => l.description || Number(l.qty) || Number(l.rate));
  const isHead = l => !(Number(l.qty) || 0) && !(Number(l.rate) || 0) && l.description;
  const amt = l => round2((Number(l.qty) || 0) * (Number(l.rate) || 0));
  // GST per rate
  const byRate = new Map();
  for (const l of items) if (!isHead(l)) { const r = Number(l.gst) || 0; byRate.set(r, round2((byRate.get(r) || 0) + amt(l))); }
  const basic = round2([...byRate.values()].reduce((a, b) => a + b, 0));
  const taxes = [...byRate].filter(([r]) => r > 0).flatMap(([r, base]) => (intra ? [[`CGST ${r / 2}%`, round2(base * r / 200)], [`SGST ${r / 2}%`, round2(base * r / 200)]] : [[`IGST ${r}%`, round2(base * r / 100)]]));
  const exact = basic + taxes.reduce((a, [, v]) => a + v, 0), grand = Math.round(exact), roundOff = round2(grand - exact);
  let letter = 0, sr = 0;
  const rows = items.map(l => {
    if (isHead(l)) { sr = 0; return h('tr.inv-head', h('td', h('b', String.fromCharCode(65 + letter++))), h('td', { colspan: 6 }, h('b', l.description))); }
    return h('tr', h('td', ++sr), h('td.spec', l.description), h('td.nowrap', l.hsn || ''), h('td.num', l.qty ?? ''), h('td', l.uom || ''), h('td.num', inr(l.rate)), h('td.num', inr(amt(l))));
  });
  const party = (label, name, address, gstin) => h('div', h('b', label), h('div', { style: { paddingLeft: '14px' } }, h('b', name || ''), h('br'), ...multiline(address || ''), gstin ? [h('br'), `GST No : ${gstin}`] : null));
  const info = [['Invoice No.', h('b', inv.invoice_no || 'DRAFT – not issued')], ['Date', fmtDate(inv.date)], ['Udyam Reg. No. (MSME)', s.udyam_no || 'Udyam-MH-26-0033790'],
    ['Challan No', inv.challan_nos], ['Work Order Number', inv.wo_number || so?.client_po_no], ['Date', fmtDate(inv.wo_date || so?.client_po_date)], ['Place of supply', inv.place_of_supply]].filter(x => x[1]);
  const terms = (Array.isArray(s.invoice_terms) && s.invoice_terms.length ? s.invoice_terms : INVOICE_TERMS);
  const sum = (k, v, bold) => h('tr', h('td', { style: { textAlign: 'right' } }, bold ? h('b', k) : k), h('td.num', bold ? h('b', inr(v)) : inr(v)));
  return h('div.doc', page(letterhead(s), h('h2', inv.type === 'Proforma Invoice' ? 'Proforma Invoice' : 'Tax Invoice'),
    h('table', h('tbody', h('tr',
      h('td', { style: { width: '55%', verticalAlign: 'top' } }, party('Bill To :-', c.name, c.address, c.gstin), h('div', { style: { marginTop: '8px' } }, party('Ship To : -', c.name, inv.ship_to || c.address, c.gstin))),
      h('td', { style: { verticalAlign: 'top', padding: 0 } }, h('table.inv-info', h('tbody', info.map(([k, v]) => h('tr', h('th', k), h('td', v))))))))),
    h('table', { style: { marginTop: '8px' } },
      h('thead', h('tr', ['Sr. No.', 'Description of Goods', 'HSN/SAC CODE', 'Qty.', 'UOM', 'Rate', 'Amount'].map((x, i) => h('th' + (i === 3 || i >= 5 ? '.num' : ''), x)))),
      h('tbody', rows),
      h('tfoot', h('tr', h('td'), h('td', { colspan: 5 }, h('b', 'Total')), h('td.num', h('b', inr(basic)))))),
    h('table', { style: { marginTop: '6px' } }, h('tbody', h('tr',
      h('td', { style: { width: '58%', verticalAlign: 'top' } }, h('div', h('b', amountInWords(grand))), h('div', { style: { marginTop: '4px', fontSize: '11px' } }, 'E. & O.E.')),
      h('td', { style: { padding: 0, verticalAlign: 'top' } }, h('table.inv-sum', h('tbody', sum('Basic Total', basic), taxes.map(([k, v]) => sum(k, v)), roundOff ? sum('Round off', roundOff) : null, sum('Grand Total', grand, true))))))),
    h('table', { style: { marginTop: '6px' } }, h('tbody', h('tr',
      h('td', { style: { width: '58%', verticalAlign: 'top', fontSize: '11px' } }, h('ol.inv-terms', terms.map(t => h('li', t)))),
      h('td', { style: { verticalAlign: 'top' } }, sign(s, inv.issued_by))))),
    h('table', { style: { marginTop: '6px' } }, h('tbody', h('tr',
      h('td', { style: { width: '40%', height: '70px', verticalAlign: 'bottom' } }, h('b', "Client's Seal & Signature")),
      h('td', { style: { verticalAlign: 'top', fontSize: '11px' } }, h('b', 'Bank Details :'), h('br'), ...multiline(String(s.bank_details || '').replace(/^"+|"+$/g, '').trim() || ['Western India Electromedical Systems Pvt Ltd.', 'Bank - Axis Bank Ltd., Branch - Chinchwad,', 'Account No. 103010200001007, IFSC code - UTIB0000103.'].join('\n')))))),
    inv.notes ? h('div.spec', { style: { marginTop: '6px', fontSize: '11px' } }, inv.notes) : null,
    footer(s)));
}
