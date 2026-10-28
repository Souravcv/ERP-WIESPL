// HR letters and forms: joining checklist, employment bond, probation review, confirmation / extension letter,
// resignation acceptance, relieving & experience letter, exit interview, full & final statement with pre-receipt.
import { h, api, fmtDate } from '../ui.js';
import { inr, amountInWords } from '../calc.js';
import { companyHead, grid, signRow, letterhead, page, footer } from './print.js';

const t = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const mr = e => (e.gender === 'Male' ? 'Mr.' : e.gender === 'Female' ? 'Ms.' : 'Mr./Ms.');
const he = e => (e.gender === 'Male' ? 'He' : e.gender === 'Female' ? 'She' : 'He/She');
const his = e => (e.gender === 'Male' ? 'his' : e.gender === 'Female' ? 'her' : 'his/her');
const P = (...c) => h('p', { style: { margin: '8px 0', lineHeight: 1.55, textAlign: 'justify' } }, ...c);
const toBlock = e => h('div', { style: { margin: '12px 0' } }, h('div', 'To,'), h('b', `${mr(e)} ${e.name}`), e.emp_code ? h('div', `Employee Code: ${e.emp_code}`) : null,
  e.designation || e.department ? h('div', [e.designation, e.department].filter(Boolean).join(', ')) : null, e.address ? h('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '60%' } }, e.address) : null);
const letter = (s, date, ref, ...body) => h('div.doc', page(letterhead(s),
  h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', ref ? `Ref: ${ref}` : ''), h('span', `Date: ${fmtDate(date)}`)), ...body,
  h('div', { style: { marginTop: '40px' } }, h('b', `For ${s.company_name}`), h('div', { style: { height: '56px' } }), h('div', 'Authorised Signatory (HR & Administration)')), footer()));
const subject = x => h('p', { style: { margin: '12px 0', fontWeight: 700 } }, `Subject: ${x}`);
const checkTable = (rows, cols) => h('table', { style: { marginTop: '6px' } }, h('thead', h('tr', h('th', '#'), cols.map(c => h('th', c[1])))),
  h('tbody', rows.map((r, i) => h('tr', h('td', i + 1), cols.map(c => h('td', { style: { whiteSpace: 'pre-wrap' } }, c[2] ? c[2](r) : r[c[0]] ?? ''))))));

// The bond text lives in Settings (HR may revise it); {{…}} are filled from the employee.
function bondDoc(e, s) {
  const years = Number(e.bond_years) || 3;
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][years] || String(years);
  const amount = Number(e.bond_amount) || 0;
  const fill = { name: e.name, father_name: e.father_name || '______________________', address: e.address || '______________________________', aadhaar: e.aadhaar_no || '______________', pan: e.pan_no || '______________',
    date: e.bond_signed_on ? fmtDate(e.bond_signed_on) : '___ / ___ / 20___', reg_address: s.reg_address, company: s.company_name, bond_years: `${words} (${years})`,
    amount: amount ? inr(amount, 0) : '__________', amount_words: amount ? amountInWords(amount) : 'Rupees ______________________ only', designation: e.designation || '', department: e.department || '' };
  const text = String(s.hr_bond_template || '').replace(/\{\{(\w+)\}\}/g, (m, k) => fill[k] ?? m);
  const out = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const head = /^(\d+\.\s+[A-Z][A-Z &,/'-]+$|[A-Z][A-Z &,()./'-]{6,}$)/.test(l);
    const item = /;$|^[a-e]\)/.test(l) && !/^\d+\.\d/.test(l);
    out.push(h(head ? 'h3' : 'p', { style: head ? { margin: '14px 0 4px', fontSize: '13px' } : { margin: item ? '2px 0 2px 22px' : '6px 0', lineHeight: 1.5, textAlign: 'justify' } }, l));
  }
  return h('div.doc', page(...out));
}

export async function hrDoc(kind, id, s) {
  if (kind === 'bond') {
    const e = await api(`/employees/${id}`);
    return { title: `Employment bond ${e.name}`, doc: bondDoc(e, s) };
  }
  if (kind === 'onboarding') {
    const o = await api(`/onboardings/${id}`);
    const e = await api(`/employees/${o.employee_id}`);
    return { title: `${o.onb_no} ${e.name}`, doc: h('div.doc', page(companyHead(s, 'EMPLOYEE JOINING & ONBOARDING CHECKLIST'),
      grid([['Employee', `${e.name} (${e.emp_code || ''})`], ['Onboarding No', o.onb_no], ['Department', e.department], ['Designation', e.designation], ['Reporting To', e.reporting_to], ['Joining Date', fmtDate(o.joining_date)],
        ['Offer Issued', fmtDate(o.offer_date)], ['Offer Accepted', fmtDate(o.offer_accepted_on)], ['Probation', `${o.probation_months} months, till ${fmtDate(o.probation_end)}`], ['Status', `${o.status} (${o.progress}%)`]]),
      h('h3', 'Documents'), checkTable((o.documents || []).filter(d => d.doc), [['doc', 'Document'], ['received', 'Received'], ['verified', 'HR Verified'], ['remark', 'Remarks']]),
      h('h3', 'Checklist'), checkTable((o.checklist || []).filter(c => c.item), [['area', 'By'], ['item', 'Activity'], ['done', 'Status'], ['date', 'Date', r => fmtDate(r.date) || ''], ['remark', 'Remarks']]),
      signRow(['HR', ''], ['Reporting Manager', ''], ['Employee', ''])))};
  }
  if (kind === 'probation' || kind === 'confirmation') {
    const r = await api(`/probation_reviews/${id}`);
    const e = await api(`/employees/${r.employee_id}`);
    if (kind === 'probation') return { title: `${r.review_no} ${e.name}`, doc: h('div.doc', page(companyHead(s, 'PROBATION PERFORMANCE REVIEW'),
      grid([['Employee', `${e.name} (${e.emp_code || ''})`], ['Review No', r.review_no], ['Department', e.department], ['Designation', e.designation], ['Joining Date', fmtDate(e.joining_date)], ['Review', r.stage],
        ['Due', fmtDate(r.due_date)], ['Reviewed On', fmtDate(r.review_date)], ['Score', r.score != null ? `${r.score}%` : ''], ['Recommendation', r.recommendation]]),
      checkTable((r.lines || []).filter(l => l.criterion), [['criterion', 'Criterion'], ['rating', 'Rating (1–5)'], ['remark', 'Remarks']]),
      h('p', { style: { fontSize: '12px' } }, r.attendance_note || ''),
      ...[['Reporting Manager', r.manager_remarks], ['Department Head', r.head_remarks], ['HR (attendance & discipline)', r.hr_remarks]].map(([l, v]) => h('div', { style: { margin: '6px 0' } }, h('b', `${l}: `), h('span', { style: { whiteSpace: 'pre-wrap' } }, v || ''))),
      signRow(['Reporting Manager', ''], ['Department Head', ''], ['HR', ''], ['Management', r.approved_by || ''])))};
    const date = r.applied_on || r.review_date || t();
    const extend = r.recommendation === 'Extend probation';
    return { title: `${extend ? 'Probation extension' : 'Confirmation'} ${e.name}`, doc: letter(s, date, r.review_no, toBlock(e),
      subject(extend ? 'Extension of Probation Period' : 'Confirmation of Employment'), P(`Dear ${e.name},`),
      extend ? [P(`With reference to your appointment with effect from ${fmtDate(e.joining_date)}, your performance during the probation period has been reviewed. The management has decided to extend your probation by ${r.extend_months || 1} month(s), up to ${fmtDate(e.probation_end)}.`),
        P('Your performance will be reviewed again before the end of the extended period. We expect you to work on the points discussed with your reporting manager. All other terms and conditions of your appointment remain unchanged.')]
        : [P(`With reference to your appointment with effect from ${fmtDate(e.joining_date)}, we are pleased to inform you that, on review of your performance during the probation period, your services are confirmed as ${e.designation || 'a member of staff'}${e.department ? ' in the ' + e.department + ' department' : ''} with effect from ${fmtDate(e.confirmation_date || r.effective_date)}.`),
          P('As a confirmed employee you are covered by the leave policy (privilege leave) and the other benefits of confirmed employees under the WIESPL HR Policy. All other terms and conditions of your appointment remain unchanged.'),
          P('We appreciate your contribution and wish you continued success with WIESPL.')],
      h('p', { style: { marginTop: '18px', fontSize: '12px' } }, 'Received and accepted: ____________________ (Employee signature)    Date: __________')) };
  }
  if (['acceptance', 'relieving', 'fnf', 'exitinterview'].includes(kind)) {
    const x = await api(`/separations/${id}`);
    const e = await api(`/employees/${x.employee_id}`);
    if (kind === 'acceptance') return { title: `Resignation acceptance ${e.name}`, doc: letter(s, x.accepted_on || t(), x.sep_no, toBlock(e), subject('Acceptance of Resignation'), P(`Dear ${e.name},`),
      P(`We acknowledge receipt of your resignation dated ${fmtDate(x.resignation_date)}. Your resignation is accepted, and you will be relieved from the services of the company at the close of working hours on ${fmtDate(x.relieving_date)}.`),
      P('Before your last working day, please complete the handover of your work, files, drawings, data and company property to your reporting manager (Exit – Handing-over Report), and the exit formalities with HR, Accounts and IT / Admin.'),
      x.shortfall_days && x.notice_waived !== 'Yes' ? P(`As the notice period of ${x.notice_days} days is not served in full (${x.shortfall_days} days short), salary in lieu of the shortfall will be recovered in the full and final settlement as per the company policy.`) : null,
      P('Your full and final settlement will be processed as per the company policy after the exit formalities are complete.')) };
    if (kind === 'relieving') return { title: `Relieving letter ${e.name}`, doc: letter(s, x.relieving_date || t(), x.sep_no, h('p', { style: { textAlign: 'center', fontWeight: 700, margin: '18px 0', textDecoration: 'underline' } }, 'RELIEVING & EXPERIENCE LETTER'),
      P(`This is to certify that ${mr(e)} ${e.name}${e.emp_code ? ' (Employee Code ' + e.emp_code + ')' : ''} was employed with ${s.company_name} from ${fmtDate(e.joining_date)} to ${fmtDate(x.relieving_date)}${e.designation ? ', last designated as ' + e.designation : ''}${e.department ? ' in the ' + e.department + ' department' : ''}.`),
      P(`${he(e)} has been relieved from the services of the company at the close of working hours on ${fmtDate(x.relieving_date)}, after completing the exit formalities.`),
      P(`During ${his(e)} tenure with us, ${his(e)} conduct was found satisfactory. We wish ${e.gender === 'Female' ? 'her' : e.gender === 'Male' ? 'him' : 'him/her'} success in all future endeavours.`)) };
    if (kind === 'exitinterview') return { title: `Exit interview ${e.name}`, doc: h('div.doc', page(companyHead(s, 'EXIT INTERVIEW FORM'),
      grid([['Employee', `${e.name} (${e.emp_code || ''})`], ['Exit No', x.sep_no], ['Department', e.department], ['Designation', e.designation], ['Joining Date', fmtDate(e.joining_date)], ['Last Working Day', fmtDate(x.relieving_date)],
        ['Type', x.type], ['Interview By', x.interviewed_by]]),
      checkTable((x.interview || []).filter(q => q.question), [['question', 'Question'], ['answer', 'Answer']]),
      signRow(['Employee', ''], ['HR', ''], ['Reporting Senior', ''])))};
    const row = (l, v, b) => (Number(v) ? h('tr', h('td', b ? h('b', l) : l), h('td.num', b ? h('b', inr(v)) : inr(v))) : null);
    return { title: `Full & final ${e.name}`, doc: h('div.doc', page(companyHead(s, 'FULL & FINAL SETTLEMENT'),
      grid([['Employee', `${e.name} (${e.emp_code || ''})`], ['Exit No', x.sep_no], ['Department', e.department], ['Designation', e.designation], ['Joining Date', fmtDate(e.joining_date)], ['Relieving Date', fmtDate(x.relieving_date)],
        ['Type', x.type], ['Notice', `${x.notice_days} days${x.shortfall_days ? ', ' + x.shortfall_days + ' short' + (x.notice_waived === 'Yes' ? ' (waived)' : '') : ''}`], ['PAN', e.pan_no], ['PF UAN', e.uan_no], ['Bank A/c', e.bank_account], ['IFSC', e.bank_ifsc]]),
      h('div', { style: { display: 'flex', gap: '12px', marginTop: '8px' } },
        h('table', { style: { flex: 1 } }, h('thead', h('tr', h('th', 'Payable'), h('th.num', '₹'))), h('tbody',
          row(`Salary (${x.days_payable || 0} days)`, x.salary_payable), row(`Gratuity (${x.gratuity_years} years)`, x.gratuity), row('Bonus', x.bonus), row('Expenses / reimbursements', x.reimbursements), row('Other earnings', x.other_earnings),
          row('Total payable', x.earnings_total, true))),
        h('table', { style: { flex: 1 } }, h('thead', h('tr', h('th', 'Deductions'), h('th.num', '₹'))), h('tbody',
          row('Notice pay recovery', x.notice_recovery), row('Company assets', x.asset_recovery), row('Advances', x.advances), row('Loan', x.loans), row('Bond recovery', x.bond_recovery), row('Income tax (TDS)', x.tds),
          row('Professional tax', x.professional_tax), row('Other deductions', x.other_deductions), row('Total deductions', x.deductions_total, true)))),
      h('p', { style: { fontSize: '14px', margin: '10px 0' } }, h('b', `Net full & final ${Number(x.net_payable) < 0 ? 'recoverable from the employee' : 'payable'}: ${inr(Math.abs(x.net_payable || 0))}`), h('br'), amountInWords(Math.abs(x.net_payable || 0))),
      h('div', { style: { fontSize: '11px', whiteSpace: 'pre-wrap', color: '#444' } }, x.fnf_note || ''),
      signRow(['Prepared By (HR)', ''], ['Checked By (Accounts)', ''], ['Approved By', '']),
      h('div', { style: { border: '1px solid #999', padding: '10px', marginTop: '16px' } }, h('b', 'PRE-RECEIPT'),
        P(`I, ${e.name}, hereby acknowledge receipt of ${inr(Math.abs(x.net_payable || 0))} (${amountInWords(Math.abs(x.net_payable || 0))}) from ${s.company_name} towards the full and final settlement of all my dues, as worked out above, and I have no further claim of any kind against the company.`),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '30px' } }, h('span', 'Employee signature: ____________________'), h('span', 'Date: ____________'))))) };
  }
  throw new Error('Unknown document');
}
