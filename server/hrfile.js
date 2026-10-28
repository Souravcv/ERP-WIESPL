// The employee file from joining to exit (WIESPL Onboarding Policy, Employment Bond, HR Policy – exit): the onboarding
// file (documents, checklists, probation), probation reviews at 15 / 30 / 60 / 90 days with the confirmation decision
// approved by management, company assets with each person, and the exit — notice, handover, clearance, exit
// interview — with the full & final settlement and gratuity (Payment of Gratuity Act: Basic + DA × 15 × years ÷ 26).
import { db, tx, audit, getSettings } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction } from '../public/js/schema.js';
import { notify } from './notify.js';
import { BOND_TEMPLATE } from './hrbond.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const addMonths = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setMonth(x.getMonth() + Number(n)); return x.toLocaleString('sv-SE').slice(0, 10); };
const r0 = n => Math.round(Number(n) || 0);
const num = v => Number(v) || 0;
const parse = (v, d) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || 'null') ?? d; } catch { return d; } };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const inr = n => `₹ ${r0(n).toLocaleString('en-IN')}`;

// Working days ahead: Sundays and holidays are skipped.
export function addWorkingDays(d, n) {
  const hol = new Set(db.prepare('SELECT date FROM holidays WHERE date BETWEEN ? AND ?').all(d, addDays(d, n * 2 + 30)).map(h => h.date));
  let x = d;
  for (let i = 0; i < n;) { x = addDays(x, 1); if (new Date(x + 'T00:00:00').getDay() !== 0 && !hol.has(x)) i++; }
  return x;
}

// ---------------------------------------------------------------- employee
export function prepEmployee(row, existing) {
  const e = { ...(existing || {}), ...row };
  if ('date_of_birth' in row) {
    if (e.date_of_birth) { const x = new Date(e.date_of_birth + 'T00:00:00'); x.setFullYear(x.getFullYear() + 58, x.getMonth() + 1, 0); row.retirement_date = x.toLocaleString('sv-SE').slice(0, 10); } else row.retirement_date = null;
  }
  if ('bond_signed_on' in row || 'bond_years' in row) row.bond_end = e.bond_signed_on ? addDays(addMonths(e.bond_signed_on, 12 * (num(e.bond_years) || 3)), -1) : null;
}

// ---------------------------------------------------------------- onboarding
const DOCS = ['Aadhaar card copy', 'PAN card copy', 'Passport size photographs', 'Educational certificates', 'Previous experience letters', 'Salary proof / last salary slips',
  'Address proof', 'Bank account details (cancelled cheque)', 'PF / UAN details (if applicable)', 'ESIC details (if applicable)', 'Emergency contact details'];
const CHECKLIST = [
  ['HR', 'Offer letter issued and acceptance received'], ['HR', 'Employee code and records created'], ['HR', 'Documents collected and verified'], ['HR', 'Joining form completed'],
  ['HR', 'Policies explained (attendance, leave, salary, discipline, travel, safety, confidentiality)'], ['HR', 'Induction manual given and acknowledgement signed'],
  ['HR', 'Employment bond signed (if applicable)'], ['HR', 'Gratuity nominee form filled'], ['HR', 'Group accident / mediclaim insurance enrolled'], ['HR', 'Salary details updated (with Accounts)'],
  ['IT / Admin', 'Email ID created'], ['IT / Admin', 'Laptop / desktop issued (Company Assets)'], ['IT / Admin', 'ERP / CRM login and attendance access given'], ['IT / Admin', 'ID card issued'], ['IT / Admin', 'Seating / workstation allotted'],
  ['Department', 'Introduced to the department and reporting manager'], ['Department', 'Role, responsibilities and daily expectations explained'], ['Department', 'Reporting structure explained'],
  ['Department', 'KPI / KRA explained'], ['Department', 'Department workflow and systems explained'], ['Department', 'Factory / site visit and safety briefing (PPE, electrical, fire)'], ['Department', 'Technical training started'],
];
const isDone = v => ['Done', 'N/A', 'Received', 'Not applicable', 'Cleared'].includes(v);

export function prepOnboarding(row, existing) {
  const o = { ...(existing || {}), ...row };
  let docs = parse(o.documents, []), list = parse(o.checklist, []);
  if (!existing) {
    if (!docs.some(d => d.doc)) docs = DOCS.map(doc => ({ doc, received: '', verified: '', remark: '' }));
    if (!list.some(l => l.item)) list = CHECKLIST.map(([area, item]) => ({ area, item, done: '', date: '', remark: '' }));
    row.documents = JSON.stringify(docs); row.checklist = JSON.stringify(list);
    if (!o.joining_date && o.employee_id) row.joining_date = o.joining_date = getRow('employees', o.employee_id).joining_date || null;
  }
  if (o.joining_date) row.probation_end = addDays(addMonths(o.joining_date, num(o.probation_months) || 6), -1);
  const docsOk = d => d.received === 'Not applicable' || (d.received === 'Received' && d.verified === 'Verified');
  const pts = docs.filter(d => d.doc).map(docsOk).concat(list.filter(l => l.item).map(l => isDone(l.done)));
  row.progress = pts.length ? Math.round(pts.filter(Boolean).length / pts.length * 100) : 0;
  row.status = row.progress === 100 ? 'Completed' : 'In progress';
  row.completed_on = row.status === 'Completed' ? (existing?.completed_on || today()) : null;
}

// After saving: the employee gets the joining date and probation; the four probation reviews are planned.
export function afterOnboarding(id, user) {
  const o = getRow('onboardings', id);
  const e = getRow('employees', o.employee_id);
  const patch = {};
  if (o.joining_date && e.joining_date !== o.joining_date) patch.joining_date = o.joining_date;
  if (o.probation_end && e.employment_type !== 'Confirmed' && e.probation_end !== o.probation_end) patch.probation_end = o.probation_end;
  if (!e.employment_type) patch.employment_type = 'Probation';
  if (e.status === 'Joining' && o.joining_date && o.joining_date <= today()) patch.status = 'Active';
  if (Object.keys(patch).length) updateRow('employees', e.id, patch, user, { system: true });
  if (o.joining_date && e.employment_type !== 'Confirmed' && !db.prepare('SELECT 1 FROM probation_reviews WHERE employee_id = ?').get(e.id)) {
    const plan = [['15 days – initial adjustment', 15], ['30 days – basic performance', 30], ['60 days – skill & discipline', 60], ['90 days – confirmation recommendation', 90]];
    for (const [stage, d] of plan) insertRow('probation_reviews', { employee_id: e.id, stage, due_date: addDays(o.joining_date, d), status: 'Due' }, user, { system: true });
  }
}

// ---------------------------------------------------------------- probation reviews
const CRITERIA = ['Discipline', 'Attendance & punctuality', 'Learning ability', 'Work quality', 'Productivity', 'Technical understanding', 'Coordination behaviour', 'Adaptability'];
export function prepReview(row, existing) {
  const r = { ...(existing || {}), ...row };
  if (['Pending Approval', 'Approved'].includes(existing?.status) && !('status' in row)) throw new HttpError(409, `This review is ${existing.status}: it cannot be changed`);
  let L = parse(r.lines, []);
  if (!existing && !L.some(l => l.criterion)) { L = CRITERIA.map(criterion => ({ criterion, rating: '', remark: '' })); row.lines = JSON.stringify(L); }
  const rated = L.filter(l => Number(l.rating) > 0);
  row.score = rated.length ? Math.round(rated.reduce((s, l) => s + Number(l.rating), 0) / (rated.length * 5) * 100) : null;
  if (r.employee_id && !['Approved'].includes(r.status)) {
    const e = getRow('employees', r.employee_id);
    const from = e.joining_date || '1900-01-01', to = r.review_date || today();
    const a = db.prepare(`SELECT SUM(status IN ('Present', 'Working')) p, SUM(status = 'Half Day') h, SUM(status = 'Absent') ab, SUM(status = 'On Leave') l, SUM(timing = 'Late mark') late
      FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?`).get(r.employee_id, from, to);
    row.attendance_note = `${e.joining_date ? 'Since ' + e.joining_date : 'Up to ' + to}: present ${a.p || 0}, half days ${a.h || 0}, absent ${a.ab || 0}, on leave ${a.l || 0}, late marks ${a.late || 0}`;
  }
  // Reviewed (a date and ratings) and not yet sent for approval: Done.
  if (!('status' in row) && ['Due', 'Done', undefined, null].includes(existing?.status ?? r.status)) row.status = r.review_date && rated.length ? 'Done' : 'Due';
}

// Management approved the decision: confirm (employee confirmed from the date), extend (probation and a new review),
// or not suitable (noted; HR starts the exit).
export function afterReview(id, user) {
  const r = getRow('probation_reviews', id);
  if (r.status !== 'Approved' || r.applied_on) return;
  const e = getRow('employees', r.employee_id);
  tx(() => {
    if (r.recommendation === 'Confirm') {
      updateRow('employees', e.id, { employment_type: 'Confirmed', confirmation_date: r.effective_date || e.probation_end || today() }, user, { system: true });
    } else if (r.recommendation === 'Extend probation') {
      const end = addDays(addMonths(addDays(e.probation_end || today(), 1), num(r.extend_months) || 1), -1);
      updateRow('employees', e.id, { probation_end: end }, user, { system: true });
      insertRow('probation_reviews', { employee_id: e.id, stage: 'End of probation', due_date: addDays(end, -7), status: 'Due' }, user, { system: true });
    } else if (r.recommendation === 'Not suitable – separate') {
      updateRow('employees', e.id, { notes: [e.notes, `${today()}: probation review ${r.review_no} – not suitable (approved by management)`].filter(Boolean).join('\n') }, user, { system: true });
    }
    db.prepare('UPDATE probation_reviews SET applied_on = ? WHERE id = ?').run(today(), r.id);
    audit(user?.name || 'system', 'employees', e.id, 'probation decision', `${r.review_no}: ${r.recommendation}`);
  });
}

// ---------------------------------------------------------------- exit and full & final
const EXIT_CHECKLIST = [['HR', 'Resignation acceptance letter issued'], ['Manager', 'Handover report completed and signed'], ['Manager', 'Files, drawings, documents and data handed over'],
  ['IT / Admin', 'Laptop / mobile / SIM returned'], ['IT / Admin', 'Email, CRM and other access closed'], ['HR', 'ID card / access card returned'], ['Store / Site', 'Tools, instruments and safety items returned'],
  ['Accounts', 'Advances, loans and expense claims settled'], ['Accounts', 'Company cards / dues cleared'], ['HR', 'Exit interview done'], ['HR', 'Customers / vendors informed of the exit (where needed)'],
  ['Accounts', 'Full & final statement prepared'], ['Accounts', 'Pre-receipt signed by the employee'], ['HR', 'Relieving & experience letter issued'], ['HR', 'PF withdrawal / transfer and Form 16']];
const QUESTIONS = ['Main reason for leaving', 'What did you like most about working at WIESPL?', 'What should WIESPL improve (work, team, systems, policies)?', 'How was the support from your reporting manager?',
  'Were your role and targets clear?', 'Were training and growth opportunities enough?', 'Salary and benefits compared to the market', 'Would you recommend WIESPL / consider rejoining later?', 'Any other comments'];
const NO_NOTICE = ['Termination', 'Absconding', 'Death / permanent disablement', 'Retirement'];

// Completed years for gratuity: a part year of more than 6 months counts as a full year.
export function gratuityYears(from, to) {
  if (!from || !to || to < from) return { years: 0, exact: 0 };
  const a = new Date(from + 'T00:00:00'), b = new Date(addDays(to, 1) + 'T00:00:00');
  let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) months--;
  const after = new Date(a); after.setMonth(after.getMonth() + months);
  const extraDays = Math.round((b - after) / 864e5), rem = months % 12;
  return { years: Math.floor(months / 12) + (rem > 6 || (rem === 6 && extraDays > 0) ? 1 : 0), exact: (months + extraDays / 30.4) / 12 };
}

export function prepSeparation(row, existing) {
  const s = { ...(existing || {}), ...row };
  if (!s.employee_id) return;
  const e = getRow('employees', s.employee_id);
  if (!existing) {
    if (!parse(s.checklist, []).some(l => l.item)) row.checklist = JSON.stringify(EXIT_CHECKLIST.map(([area, item]) => ({ area, item, done: '', remark: '' })));
    if (!parse(s.interview, []).some(l => l.question)) row.interview = JSON.stringify(QUESTIONS.map(question => ({ question, answer: '' })));
    if (!parse(s.handover, []).some(l => l.item)) row.handover = JSON.stringify([{ item: 'Pending work / projects and their status', to: '', done: '', remark: '' }, { item: 'Files, drawings and documents', to: '', done: '', remark: '' }, { item: 'Customer / vendor contacts and open commitments', to: '', done: '', remark: '' }]);
    if (db.prepare("SELECT 1 FROM separations WHERE employee_id = ? AND status <> 'Withdrawn'").get(s.employee_id)) throw new HttpError(409, `${e.name} already has an exit record`);
  }
  // notice
  const notice = NO_NOTICE.includes(s.type) ? 0 : num(e.notice_days ?? 30);
  row.notice_days = notice;
  row.notice_end = s.resignation_date ? addDays(s.resignation_date, notice) : null;
  const relieving = s.relieving_date || row.notice_end;
  if (!s.relieving_date && row.notice_end && !existing) row.relieving_date = row.notice_end;
  row.shortfall_days = s.type === 'Resignation' && relieving && row.notice_end ? Math.max(0, daysBetween(relieving, row.notice_end)) : 0;
  row.acceptance_due = s.type === 'Resignation' && s.resignation_date ? addWorkingDays(s.resignation_date, 7) : null;
  // company assets still with the person
  const assets = db.prepare('SELECT asset_type, description, serial_no, value, status, recovery FROM asset_issues WHERE employee_id = ? AND status <> ?').all(s.employee_id, 'Returned');
  const out = assets.filter(a => a.status === 'Issued');
  row.assets_note = assets.length ? assets.map(a => `${a.asset_type}${a.serial_no ? ' ' + a.serial_no : ''} (${a.status}${a.value ? ', ' + inr(a.value) : ''})`).join('; ') : 'All returned';
  row.asset_recovery = r0(out.reduce((t, a) => t + num(a.value), 0) + assets.filter(a => a.status !== 'Issued').reduce((t, a) => t + num(a.recovery), 0));
  // full & final
  const gross = num(s.monthly_gross), perDay = gross / 30;
  row.salary_payable = r0(perDay * num(s.days_payable));
  row.notice_recovery = s.notice_waived === 'Yes' ? 0 : r0(perDay * row.shortfall_days);
  const g = gratuityYears(e.joining_date, relieving);
  const fixed = e.employment_type === 'Fixed-term';
  const eligible = s.type === 'Death / permanent disablement' || (fixed ? g.exact >= 1 : g.exact >= 5);
  row.gratuity_years = eligible ? g.years : 0;
  row.gratuity = eligible ? r0(num(s.basic_da) * 15 * g.years / 26) : 0;
  row.earnings_total = r0(row.salary_payable + row.gratuity + num(s.bonus) + num(s.reimbursements) + num(s.other_earnings));
  row.deductions_total = r0(row.notice_recovery + row.asset_recovery + num(s.advances) + num(s.loans) + num(s.bond_recovery) + num(s.tds) + num(s.professional_tax) + num(s.other_deductions));
  row.net_payable = row.earnings_total - row.deductions_total;
  row.fnf_due = relieving ? addWorkingDays(relieving, 40) : null;
  const notes = [
    `Service ${e.joining_date || '?'} to ${relieving || '?'}: ${g.exact.toFixed(2)} years`,
    gross ? `Salary: ${inr(gross)} ÷ 30 × ${num(s.days_payable)} days = ${inr(row.salary_payable)}` : 'Enter the monthly gross for salary and notice pay',
    eligible ? `Gratuity: ${inr(s.basic_da)} × 15 × ${g.years} ÷ 26 = ${inr(row.gratuity)}${s.basic_da ? '' : ' (enter the last Basic + DA)'}`
      : `Gratuity: not due (${fixed ? 'fixed-term: under 1 year' : 'under 5 years of service'}${s.type === 'Death / permanent disablement' ? '' : ''})`,
    row.shortfall_days ? `Notice: ${row.shortfall_days} days short of ${notice}${s.notice_waived === 'Yes' ? ' – waived by management' : ` → ${inr(gross)} ÷ 30 × ${row.shortfall_days} = ${inr(row.notice_recovery)} recovered`}` : null,
    row.asset_recovery ? `Assets: ${inr(row.asset_recovery)} (${row.assets_note})` : null,
    e.bond_end && relieving && e.bond_end > relieving && s.type === 'Resignation' ? `Bond signed ${e.bond_signed_on} runs until ${e.bond_end}${e.bond_amount ? `: ${inr(e.bond_amount)} recoverable under the bond` : ''} – enter it under Bond Recovery only if management decides` : null,
    'Leave balance is not paid at full & final and not adjusted against notice (HR Policy).',
  ];
  row.fnf_note = notes.filter(Boolean).join('\n');
}

export function separationAction(id, action, body, user) {
  if (!hasFunction(user.role, 'hr_manage')) throw new HttpError(403, 'Only HR handles exits');
  const s = getRow('separations', id);
  const e = getRow('employees', s.employee_id);
  return tx(() => {
    if (action === 'accept') return updateRow('separations', id, { accepted_on: body?.date || today(), relieving_date: body?.relieving_date || s.relieving_date }, user, { system: true });
    if (action === 'relieve') {
      if (s.status !== 'Notice period') throw new HttpError(409, `Already ${s.status}`);
      const date = body?.date || s.relieving_date || today();
      updateRow('separations', id, { status: 'Relieved', relieving_date: date }, user, { system: true });
      updateRow('employees', e.id, { status: 'Left', leaving_date: date }, user, { system: true });
      db.prepare("UPDATE site_assignments SET to_date = ? WHERE employee_id = ? AND (to_date IS NULL OR to_date = '' OR to_date > ?)").run(date, e.id, date);
      const admins = db.prepare("SELECT name FROM users WHERE role = 'admin' AND COALESCE(active, 1) = 1").all().map(u => u.name);
      notify({ fn: 'hr_manage', userNames: admins, kind: 'hr', title: `${e.name} relieved on ${date}`, body: `Close the CRM login${e.login ? ' “' + e.login + '”' : ''}, email and other access (Users). Full & final due by ${s.fnf_due || '—'}.`, link: `#/view/separations/${id}` }, user);
      audit(user.name, 'employees', e.id, 'relieved', s.sep_no);
      return getRow('separations', id);
    }
    if (action === 'settle') {
      if (s.status !== 'Relieved') throw new HttpError(409, 'Relieve the employee first');
      if (s.pre_receipt !== 'Yes') throw new HttpError(400, 'The pre-receipt has to be signed by the employee before the full & final is paid');
      return updateRow('separations', id, { status: 'F&F settled', paid_on: body?.date || today(), payment_ref: body?.ref || s.payment_ref }, user, { system: true });
    }
    if (action === 'withdraw') {
      if (s.status !== 'Notice period') throw new HttpError(409, 'Only during the notice period');
      return updateRow('separations', id, { status: 'Withdrawn' }, user, { system: true });
    }
    throw new HttpError(400, 'Unknown action');
  });
}

// ---------------------------------------------------------------- people board and reminders
export function peopleBoard() {
  const t = today();
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  return {
    joining: q("SELECT o.id, o.onb_no, o.joining_date, o.progress, e.name FROM onboardings o JOIN employees e ON e.id = o.employee_id WHERE o.status <> 'Completed' ORDER BY o.joining_date"),
    reviews: q("SELECT r.id, r.review_no, r.stage, r.due_date, r.status, e.name FROM probation_reviews r JOIN employees e ON e.id = r.employee_id WHERE r.status IN ('Due', 'Pending Approval') AND (r.due_date IS NULL OR r.due_date <= ?) ORDER BY r.due_date", addDays(t, 7)),
    probation: q("SELECT id, name, emp_code, probation_end FROM employees WHERE COALESCE(status, 'Active') <> 'Left' AND COALESCE(employment_type, '') <> 'Confirmed' AND probation_end IS NOT NULL AND probation_end <= ? ORDER BY probation_end", addDays(t, 30)),
    unset: q("SELECT id, name, emp_code FROM employees WHERE COALESCE(status, 'Active') <> 'Left' AND COALESCE(employment_type, '') = '' ORDER BY name"),
    exits: q("SELECT s.id, s.sep_no, s.type, s.status, s.relieving_date, s.accepted_on, s.acceptance_due, s.fnf_due, s.net_payable, e.name FROM separations s JOIN employees e ON e.id = s.employee_id WHERE s.status IN ('Notice period', 'Relieved') ORDER BY s.relieving_date"),
    assets: q("SELECT a.id, a.asset_type, a.serial_no, a.value, e.name, e.status emp_status FROM asset_issues a JOIN employees e ON e.id = a.employee_id WHERE a.status = 'Issued' ORDER BY e.name"),
    retiring: q("SELECT id, name, retirement_date FROM employees WHERE COALESCE(status, 'Active') <> 'Left' AND retirement_date BETWEEN ? AND ? ORDER BY retirement_date", t, addDays(t, 90)),
    bonds: q("SELECT id, name, bond_signed_on, bond_end, bond_amount FROM employees WHERE COALESCE(status, 'Active') <> 'Left' AND bond_end >= ? ORDER BY bond_end", t),
  };
}

// Once a day: joiners become Active on their joining date; HR / the manager hear of reviews due, probation ending,
// retirements, overdue acceptance letters and full & final settlements falling due.
export function dailyHr() {
  const t = today();
  for (const e of db.prepare("SELECT id FROM employees WHERE status = 'Joining' AND joining_date <= ?").all(t)) updateRow('employees', e.id, { status: 'Active' }, { name: 'system' }, { system: true });
  let sent = {};
  try { sent = JSON.parse(getSettings().hr_file_alerts || '{}') || {}; } catch { sent = {}; }
  const once = (key, msg) => { if (sent[key]) return; notify({ kind: 'hr', ...msg }, { name: 'HR' }); sent[key] = t; };
  for (const r of db.prepare("SELECT r.id, r.review_no, r.stage, r.due_date, e.name, e.reporting_to FROM probation_reviews r JOIN employees e ON e.id = r.employee_id WHERE r.status = 'Due' AND r.due_date <= ?").all(addDays(t, 2)))
    once(`rev${r.id}`, { fn: 'hr_manage', userNames: r.reporting_to ? [r.reporting_to] : [], title: `Probation review due: ${r.name} (${r.stage})`, body: `Due ${r.due_date} · ${r.review_no}`, link: `#/view/probation_reviews/${r.id}` });
  for (const e of db.prepare("SELECT id, name, probation_end FROM employees WHERE COALESCE(status, 'Active') <> 'Left' AND COALESCE(employment_type, '') <> 'Confirmed' AND probation_end BETWEEN ? AND ?").all(t, addDays(t, 14)))
    once(`prob${e.id}:${e.probation_end}`, { fn: 'hr_manage', title: `Probation of ${e.name} ends on ${e.probation_end}`, body: 'Confirmation review and management approval are needed', link: `#/view/employees/${e.id}` });
  for (const e of db.prepare("SELECT id, name, retirement_date FROM employees WHERE COALESCE(status, 'Active') <> 'Left' AND retirement_date BETWEEN ? AND ?").all(t, addDays(t, 31)))
    once(`ret${e.id}`, { fn: 'hr_manage', title: `${e.name} retires on ${e.retirement_date}`, body: 'HR Policy: intimate the employee one month in advance in writing', link: `#/view/employees/${e.id}` });
  for (const s of db.prepare("SELECT s.id, s.sep_no, s.acceptance_due, s.fnf_due, s.status, s.accepted_on, e.name FROM separations s JOIN employees e ON e.id = s.employee_id WHERE s.status IN ('Notice period', 'Relieved')").all()) {
    if (s.status === 'Notice period' && !s.accepted_on && s.acceptance_due && s.acceptance_due <= t) once(`acc${s.id}`, { fn: 'hr_manage', title: `Resignation acceptance overdue: ${s.name}`, body: `Due ${s.acceptance_due} (7 working days) · ${s.sep_no}`, link: `#/view/separations/${s.id}` });
    if (s.status === 'Relieved' && s.fnf_due && s.fnf_due <= addDays(t, 5)) once(`fnf${s.id}`, { fn: 'hr_manage', title: `Full & final of ${s.name} due by ${s.fnf_due}`, body: s.sep_no, link: `#/view/separations/${s.id}` });
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('hr_file_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(JSON.stringify(sent)));
}

// Once: the employment bond text from the HR documents goes into Settings (HR may revise it there).
export function setupHrFile() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'hr_bond_template'").get()) return;
  db.prepare("INSERT INTO settings (key, value) VALUES ('hr_bond_template', ?)").run(JSON.stringify(BOND_TEMPLATE));
}
