// HR dashboard: who is working where today, the month register (one code per day), and the days HR has to review.
import { h, api, fmtDate, today, toast, fail, modal, busy, state } from '../ui.js';
import { hasFunction } from '../schema.js';
import { inr } from '../calc.js';

const TABS = [['today', '🕘 Today'], ['month', '📅 Month register'], ['review', '🔎 To review']];
const kpi = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, String(v)), sub ? h('div.sub', sub) : null);
const dist = m => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const STATE_COLOR = { Working: 'var(--good)', 'Clocked out': 'var(--text)', 'Not in': 'var(--bad)', 'On leave': 'var(--warn)' };
const CODE_COLOR = { P: 'var(--good)', H: 'var(--warn)', A: 'var(--bad)', L: 'var(--info)', HO: 'var(--muted)', WO: 'var(--muted)' };

export async function hrView(root, tab = 'today') {
  const head = h('div.page-head', h('h1', '👥 HR & Attendance'), h('div.actions',
    h('a.btn', { href: '#/list/employees' }, '🧑‍💼 Employees'), h('a.btn', { href: '#/list/work_locations' }, '📍 Work locations'),
    h('a.btn', { href: '#/list/site_assignments' }, '🗓️ Site assignments'), h('a.btn', { href: '#/list/leave_requests' }, '🌴 Leave'), h('a.btn', { href: '#/list/holidays' }, '🎉 Holidays')));
  const tabs = h('div.tabs', TABS.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { location.hash = `#/hr/${k}`; } }, l)));
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(head, tabs, box);
  if (tab === 'month') return month(box);
  if (tab === 'review') return reviewList(box, root);
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
  const load = async () => {
    const d = await api(`/hr/month?month=${pick.value}`);
    out.replaceChildren(
      h('p.muted', 'P present · H half day · A absent · L leave · HO holiday · WO weekly off · ? = HR still to review. Paid days = P + ½ H + L + HO + WO.'),
      h('div.card.flush', h('div.table-wrap', h('table.data', { style: { fontSize: '11.5px' } },
        h('thead', h('tr', h('th', 'Employee'), d.days.map(x => h('th', { style: { padding: '4px 3px', textAlign: 'center', color: d.holidays[x] ? 'var(--warn)' : '' }, title: d.holidays[x] || '' }, Number(x.slice(8)))),
          ['P', 'H', 'A', 'L', 'Paid', '?'].map(x => h('th.num', x)))),
        h('tbody', d.rows.map(r => h('tr', h('td.nowrap', r.name),
          r.codes.map(c => h('td', { style: { padding: '4px 3px', textAlign: 'center', fontWeight: 600, color: CODE_COLOR[c.replace('?', '')] || '' } }, c)),
          h('td.num', r.present), h('td.num', r.half), h('td.num', r.absent), h('td.num', r.leave), h('td.num', h('b', inr(r.paid_days, 1))), h('td.num', { style: { color: r.to_review ? 'var(--warn)' : '' } }, r.to_review || ''))))))),
      h('button.btn', { style: { marginTop: '8px' }, onclick: () => window.print() }, '🖨 Print'));
  };
  pick.onchange = () => load().catch(fail);
  box.replaceChildren(h('div.toolbar', h('span.muted', 'Month'), pick), out);
  await load();
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
