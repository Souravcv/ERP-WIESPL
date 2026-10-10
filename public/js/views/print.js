import { h, api, state, fmtDate } from '../ui.js';
import { roomAreas, quoteTotals, lineBasicRate, lineQty, inr, amountInWords, linesTotals, round2 } from '../calc.js';

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
    title = po.po_no;
    doc = taxDoc({ title: 'PURCHASE ORDER', no: po.po_no, date: po.date, party: v, partyLabel: 'To (vendor):',
      refs: [['Delivery by', fmtDate(po.delivery_date)], ['Project', po.project_id_label], ['Approved by', po.approved_by]], items: po.lines || [], place: v.state, notes: po.terms, s });
  } else throw new Error('Unknown document');
  document.title = title;
  root.replaceChildren(bar(title), doc);
}
