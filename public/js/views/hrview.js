// HR dashboard: who is working where today, the month register (one code per day, with the HR Policy's late marks and
// sandwich rule), leave balances, and the days HR has to review.
import { h, api, fmtDate, today, toast, fail, modal, busy, state } from '../ui.js';
import { hasFunction } from '../schema.js';
import { inr } from '../calc.js';

const TABS = [['today', '🕘 Today'], ['month', '📅 Month register'], ['balances', '🌴 Leave balances'], ['people', '🧑‍💼 Joining & exits'], ['review', '🔎 To review']];
const kpi = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, String(v)), sub ? h('div.sub', sub) : null);
const dist = m => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const STATE_COLOR = { Working: 'var(--good)', 'Clocked out': 'var(--text)', 'Not in': 'var(--bad)', 'On leave': 'var(--warn)' };
const CODE_COLOR = { P: 'var(--good)', 'P*': 'var(--good)', H: 'var(--warn)', 'H*': 'var(--warn)', A: 'var(--bad)', L: 'var(--info)', HL: 'var(--info)', CO: 'var(--info)', OD: 'var(--info)', LWP: 'var(--bad)',
  S: 'var(--bad)', W: 'var(--accent, var(--info))', HO: 'var(--muted)', WO: 'var(--muted)' };
const LEGEND = 'P present · P* late mark (free) · H* late mark after the free ones = ½ day · H half day (1½–4 h late / early) · A absent (or over 4 h late / early) · L paid leave · HL half-day leave · CO comp-off · OD on duty · LWP leave without pay · HO holiday · WO weekly off · W worked on an off day (comp-off) · S off day between absences / leave = unpaid (sandwich) · ? HR still to review';

export async function hrView(root, tab = 'today') {
  const head = h('div.page-head', h('h1', '👥 HR & Attendance'), h('div.actions',
    h('a.btn', { href: '#/list/employees' }, '🧑‍💼 Employees'), h('a.btn', { href: '#/list/work_locations' }, '📍 Work locations'),
    h('a.btn', { href: '#/list/site_assignments' }, '🗓️ Site assignments'), h('a.btn', { href: '#/list/leave_requests' }, '🌴 Leave'), h('a.btn', { href: '#/list/holidays' }, '🎉 Holidays'),
    h('a.btn', { href: '#/list/onboardings' }, '🧾 Onboarding'), h('a.btn', { href: '#/list/probation_reviews' }, '📋 Probation'), h('a.btn', { href: '#/list/asset_issues' }, '💻 Assets'), h('a.btn', { href: '#/list/separations' }, '🚪 Exits')));
  const tabs = h('div.tabs', TABS.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { location.hash = `#/hr/${k}`; } }, l)));
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(head, tabs, box);
  if (tab === 'month') return month(box);
  if (tab === 'review') return reviewList(box, root);
  if (tab === 'balances') return balancesTab(box);
  if (tab === 'people') return peopleTab(box);
  return todayTab(box);
}

async function todayTab(box) {
  const date = h('input', { type: 'date', value: today() });
  const out = h('div');
  const load = async () => {
    const d = await api(`/hr/today?date=${date.value}`);
    const t = d.totals;
    out.replaceChildren(
      d.holiday ? h('p', { style: { color: 'var(--warn)' } }, `Holiday: ${d.holiday}`) : null,
      h('div.kpis', kpi('Employees', t.employees), kpi('Working now', t.working, '', 'var(--good)'), kpi('Clocked out', t.out), kpi('Not in', t.not_in, 'no clock-in', t.not_in ? 'var(--bad)' : null),
        kpi('On leave', t.leave), kpi('Outside the site now', t.outside, 'last check outside the fence', t.outside ? 'var(--bad)' : null), kpi('To review', t.to_review, 'all days', t.to_review ? 'var(--warn)' : null)),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Employee', 'State', 'Where', 'In', 'Out', 'Hours', 'Last check', 'Flags'].map(x => h('th', x)))),
        h('tbody', d.rows.map(r => h('tr' + (r.attendance_id ? '.clickable' : ''), { onclick: r.attendance_id ? () => (location.hash = `#/view/attendance/${r.attendance_id}`) : null },
          h('td', r.name, h('div.muted', { style: { fontSize: '11px' } }, `${r.code || ''} · ${r.department || ''}${r.field ? ' · field' : ''}`)),
          h('td', { style: { color: STATE_COLOR[r.state] || '', fontWeight: 600 } }, r.state), h('td', r.site || ''), h('td', r.check_in), h('td', r.check_out), h('td.num', r.hours || ''),
          h('td', r.last_at ? [r.last_at, ' ', h('span', { style: { color: r.last_inside === 'No' ? 'var(--bad)' : 'var(--good)' } }, r.last_inside === 'No' ? `outside ${dist(r.last_distance)}` : `inside ${dist(r.last_distance)}`),
            r.last_lat != null ? [' · ', h('a', { href: `https://www.google.com/maps?q=${r.last_lat},${r.last_lng}`, target: '_blank', onclick: e => e.stopPropagation() }, 'map')] : null] : ''),
          h('td', { style: { maxWidth: '260px', fontSize: '12px', color: 'var(--warn)', whiteSpace: 'pre-wrap' } }, r.flags))))))));
  };
  date.onchange = () => load().catch(fail);
  box.replaceChildren(h('div.toolbar', h('span.muted', 'Day'), date, h('button.btn', { onclick: () => load().catch(fail) }, '↻ Refresh')), out);
  await load();
}

async function month(box) {
  const pick = h('input', { type: 'month', value: today().slice(0, 7) });
  const out = h('div');
  let d = null;
  const COLS = [['present', 'Present'], ['late_marks', 'Late marks'], ['half', '½ days'], ['absent', 'Absent'], ['leave', 'Paid leave'], ['lwp', 'LWP'], ['sandwich', 'Sandwich'], ['off_worked', 'Off days worked'], ['pay_extra', 'Pay extra (comp-off not taken)'], ['paid_days', 'Paid days'],
    ['hours', 'Hours (in to out)'], ['outside_hours', 'Outside the site (h)'], ['deducted_hours', 'Deducted by HR (h)'], ['net_hours', 'Net hours']];
  const csv = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Code', 'Employee', 'Department', ...d.days.map(x => x.slice(8)), ...COLS.map(c => c[1]), 'To review'].map(q).join(',')]
      .concat(d.rows.map(r => [r.code, r.name, r.department, ...r.codes, ...COLS.map(c => r[c[0]]), r.to_review].map(q).join(',')));
    const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' })), download: `attendance-${d.month}.csv` });
    document.body.append(a); a.click(); a.remove();
  };
  const load = async () => {
    d = await api(`/hr/month?month=${pick.value}`);
    out.replaceChildren(
      h('p.muted', { style: { fontSize: '12px' } }, LEGEND, `. First ${d.late_free} late marks a month are free. Paid days = P + P* + ½ (H, H*, HL) + L + CO + OD + HO + WO + W.`),
      h('div.card.flush', h('div.table-wrap', h('table.data', { style: { fontSize: '11.5px' } },
        h('thead', h('tr', h('th', 'Employee'), d.days.map(x => h('th', { style: { padding: '4px 3px', textAlign: 'center', color: d.holidays[x] ? 'var(--warn)' : '' }, title: d.holidays[x] || '' }, Number(x.slice(8)))),
          ['P', 'Late', '½', 'A', 'L', 'LWP', 'S', 'W', 'Pay+', 'Paid', 'Hrs', 'Out h', 'Net h', '?'].map(x => h('th.num', x)))),
        h('tbody', d.rows.map(r => h('tr', h('td.nowrap', r.name),
          r.codes.map(c => h('td', { style: { padding: '4px 3px', textAlign: 'center', fontWeight: 600, color: CODE_COLOR[c.replace('?', '')] || '' } }, c)),
          h('td.num', r.present), h('td.num', { style: { color: r.late_marks > d.late_free ? 'var(--bad)' : '' } }, r.late_marks || ''), h('td.num', r.half || ''), h('td.num', r.absent || ''), h('td.num', r.leave || ''),
          h('td.num', r.lwp || ''), h('td.num', r.sandwich || ''), h('td.num', r.off_worked || ''), h('td.num', r.pay_extra || ''), h('td.num', h('b', inr(r.paid_days, 1))),
          h('td.num', r.hours || ''), h('td.num', { title: r.deducted_hours ? `${r.deducted_hours} h deducted by HR` : '' }, r.outside_hours || ''), h('td.num', r.net_hours || ''),
          h('td.num', { style: { color: r.to_review ? 'var(--warn)' : '' } }, r.to_review || ''))))))),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, h('button.btn', { onclick: () => window.print() }, '🖨 Print'), h('button.btn', { onclick: csv }, '⬇ Excel (CSV) for salary')));
  };
  pick.onchange = () => load().catch(fail);
  box.replaceChildren(h('div.toolbar', h('span.muted', 'Month'), pick), out);
  await load();
}

// Leave position of everyone: PL credited by quarter after confirmation, taken, waiting, available; comp-off of the
// month; leave without pay against the yearly limit; short leaves and late marks this month.
async function balancesTab(box) {
  const date = h('input', { type: 'date', value: today() });
  const out = h('div');
  const load = async () => {
    const d = await api(`/hr/balances?date=${date.value}`);
    const unset = d.rows.filter(r => !r.employment_type).length;
    out.replaceChildren(
      unset ? h('p', { style: { color: 'var(--warn)' } }, `${unset} employee(s) have no Employment set (Probation / Confirmed): PL needs Confirmed and a confirmation date. Open the employee to set it.`) : null,
      h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Employee', 'Employment', 'Service (yrs)', 'PL credited', 'PL taken', 'PL waiting', 'PL available', 'PL by 31 Mar (unused = encash)', 'Comp-off left (this month)', 'LWP this year', 'Short leaves (month)', 'Late marks (month)']
          .map((x, i) => h(i > 1 ? 'th.num' : 'th', x)))),
        h('tbody', d.rows.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/employees/${r.employee_id}`) },
          h('td', r.name, h('div.muted', { style: { fontSize: '11px' } }, `${r.code || ''} · ${r.department || ''}`)),
          h('td', r.employment_type || h('span', { style: { color: 'var(--warn)' } }, 'not set'), r.confirmation_date ? h('div.muted', { style: { fontSize: '11px' } }, `confirmed ${fmtDate(r.confirmation_date)}`) : null),
          h('td.num', r.service_years || ''), h('td.num', r.pl_credit), h('td.num', r.pl_taken || ''), h('td.num', r.pl_pending || ''),
          h('td.num', h('b', { style: { color: r.pl_available > 0 ? 'var(--good)' : '' } }, r.pl_available)), h('td.num', r.pl_year_end || ''),
          h('td.num', r.comp_off_earned ? `${r.comp_off_left} of ${r.comp_off_earned}` : ''), h('td.num', { style: { color: r.lwp >= r.lwp_max ? 'var(--bad)' : '' } }, r.lwp ? `${r.lwp} / ${r.lwp_max}` : ''),
          h('td.num', r.short_leaves ? `${r.short_leaves} / ${r.short_max}` : ''), h('td.num', { style: { color: r.late_marks > r.late_free ? 'var(--bad)' : '' } }, r.late_marks || ''))))))),
      h('p.muted', { style: { fontSize: '12px' } }, `Leave year ${fmtDate(d.year.from)} – ${fmtDate(d.year.to)}. PL: ${d.policy.plYear} days a year, ${d.policy.plYear / 4} at the start of each quarter once confirmed (pro-rata in the quarter of confirmation), not carried forward; unused PL is encashed at year end (Basic/DA). Comp-off: an off day worked (approved by HR) is taken in the same month, or paid. Maternity (16 weeks), paternity / adoption (4 days) and marriage (10 days, once) need confirmation and 3 years' service.`));
  };
  date.onchange = () => load().catch(fail);
  box.replaceChildren(h('div.toolbar', h('span.muted', 'As on'), date), out);
  await load();
}

// Joining and exits: onboarding in progress, probation reviews due, probation ending, people on notice and full &
// final pending, company assets out, retirements, bonds running.
async function peopleTab(box) {
  const d = await api('/hr/people');
  const sec = (title, rows, cols, link, empty = 'None') => h('div.card', h('h2', `${title} (${rows.length})`), rows.length ? h('div.table-wrap', h('table.data',
    h('thead', h('tr', cols.map(c => h('th', c[0])))), h('tbody', rows.map(r => h('tr.clickable', { onclick: () => (location.hash = link(r)) }, cols.map(c => h('td', c[1](r)))))))) : h('p.muted', empty));
  const late = x => x && x < today() ? { color: 'var(--bad)', fontWeight: 600 } : {};
  box.replaceChildren(
    d.unset.length ? h('p', { style: { color: 'var(--warn)' } }, `Employment type not set for: ${d.unset.map(e => e.name).join(', ')} – open each employee and set Probation / Confirmed (and the confirmation date).`) : null,
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } }, h('a.btn.primary', { href: '#/edit/onboardings/new' }, '+ New joiner (onboarding)'), h('a.btn', { href: '#/edit/separations/new' }, '+ Resignation / exit')),
    sec('Onboarding in progress', d.joining, [['No', r => r.onb_no], ['Employee', r => r.name], ['Joining', r => fmtDate(r.joining_date)], ['Done', r => `${r.progress}%`]], r => `#/view/onboardings/${r.id}`),
    sec('Probation reviews due (next 7 days and overdue)', d.reviews, [['No', r => r.review_no], ['Employee', r => r.name], ['Review', r => r.stage], ['Due', r => h('span', { style: late(r.due_date) }, fmtDate(r.due_date))], ['Status', r => r.status]], r => `#/view/probation_reviews/${r.id}`),
    sec('Probation ending (next 30 days) – confirmation needed', d.probation, [['Employee', r => r.name], ['Probation ends', r => h('span', { style: late(r.probation_end) }, fmtDate(r.probation_end))]], r => `#/view/employees/${r.id}`),
    sec('Exits: notice period and full & final', d.exits, [['No', r => r.sep_no], ['Employee', r => r.name], ['Type', r => r.type], ['Status', r => r.status], ['Relieving', r => fmtDate(r.relieving_date)],
      ['Acceptance letter', r => r.accepted_on ? fmtDate(r.accepted_on) : h('span', { style: late(r.acceptance_due) }, r.acceptance_due ? 'due ' + fmtDate(r.acceptance_due) : '')], ['F&F due', r => h('span', { style: r.status === 'Relieved' ? late(r.fnf_due) : {} }, fmtDate(r.fnf_due))], ['Net F&F', r => r.net_payable != null ? inr(r.net_payable) : '']], r => `#/view/separations/${r.id}`),
    sec('Company assets with employees', d.assets, [['Employee', r => [r.name, r.emp_status === 'Left' ? h('b', { style: { color: 'var(--bad)' } }, ' (left)') : null]], ['Asset', r => r.asset_type], ['Serial', r => r.serial_no || ''], ['Value', r => r.value ? inr(r.value) : '']], r => `#/view/asset_issues/${r.id}`),
    sec('Retiring in the next 90 days (age 58)', d.retiring, [['Employee', r => r.name], ['Retires', r => fmtDate(r.retirement_date)]], r => `#/view/employees/${r.id}`),
    sec('Employment bonds running', d.bonds, [['Employee', r => r.name], ['Signed', r => fmtDate(r.bond_signed_on)], ['Ends', r => fmtDate(r.bond_end)], ['Amount', r => r.bond_amount ? inr(r.bond_amount) : '']], r => `#/view/employees/${r.id}`));
}

async function reviewList(box, root) {
  const rows = await api('/attendance?review=To%20review&limit=500');
  const may = hasFunction(state.user.role, 'hr_manage');
  box.replaceChildren(rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Employee', 'Where', 'In', 'Out', 'Hours', 'Flags', ''].map(x => h('th', x)))),
    h('tbody', rows.map(a => h('tr', h('td.nowrap', fmtDate(a.date)), h('td', a.employee_id_label), h('td', a.location_id_label || a.mode || ''), h('td', String(a.check_in || '').slice(11, 16)), h('td', String(a.check_out || '').slice(11, 16)),
      h('td.num', a.hours || ''), h('td', { style: { maxWidth: '300px', fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--warn)' } }, [a.flags, a.note && `Note: ${a.note}`].filter(Boolean).join('\n')),
      h('td.nowrap', h('a.btn.small', { href: `#/view/attendance/${a.id}` }, 'Open'), may ? [' ', reviewButtons(a, () => hrView(root, 'review'))] : null))))))) : h('div.card', h('p', 'Nothing to review ✓')));
}

// Approve (optionally correcting the day) or reject an attendance day, with a remark.
export function reviewButtons(a, done) {
  return h('button.btn.small.primary', { onclick: busy(async () => {
    const st = h('select', ['', 'Present', 'Half Day', 'Absent'].map(x => h('option', { value: x }, x || `keep (${a.status})`)));
    const rem = h('textarea', { rows: 2, placeholder: 'e.g. phone battery died, confirmed by the site engineer' });
    const r = await modal(`Attendance ${a.employee_id_label || ''} – ${fmtDate(a.date)}`, h('div.grid', a.flags ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, a.flags) : null, h('label', 'Day counts as', st), h('label', 'Remarks', rem)),
      [{ label: 'Cancel', value: null }, { label: 'Reject', cls: 'danger solid', value: 'Rejected' }, { label: 'Approve', cls: 'primary', value: 'Approved' }]);
    if (!r) return;
    try { await api(`/attendance/${a.id}/review`, { method: 'POST', body: { decision: r, status: st.value || undefined, remarks: rem.value } }); toast(`Day ${r.toLowerCase()}`); done(); } catch (e) { fail(e); }
  }) }, 'Review');
}
