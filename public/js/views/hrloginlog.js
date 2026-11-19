// HR → Login log: every sign-in / sign-out / failed sign-in with time, network (IP) and phone / browser, and the
// warnings for buddy punching (one phone used for several accounts, one phone clocking in several people).
import { h, api, fail } from '../ui.js';

const LEVEL = { high: ['🔴', 'var(--bad)'], check: ['🟠', 'var(--warn)'] };
const KIND = { login: '➡️ Sign in', logout: '⬅️ Sign out', failed: '❌ Wrong password' };

export async function loginLog(box) {
  const days = h('select', [1, 7, 30, 90].map(n => h('option', { value: n, selected: n === 7 }, n === 1 ? 'Today and yesterday' : `Last ${n} days`)));
  const who = h('input', { placeholder: 'Filter: name, username, IP, phone', style: { maxWidth: '260px' } });
  const out = h('div');
  let d = null;
  const draw = () => {
    const q = who.value.trim().toLowerCase();
    const ev = d.events.filter(e => !q || [e.name, e.username, e.ip, e.device].some(x => String(x || '').toLowerCase().includes(q)));
    out.replaceChildren(
      h('div.card', h('h2', `⚠️ Warnings (${d.warnings.length + d.shared_clock_ins.length})`),
        h('p.muted', { style: { fontSize: '12px' } }, '🔴 One phone / browser signed in to several accounts within 30 minutes, or one phone clocked in several people: ask them. 🟠 Same network and same kind of phone within 10 minutes: often just colleagues on the office Wi-Fi; look at the clock-ins next to it.'),
        !d.warnings.length && !d.shared_clock_ins.length ? h('p', '✅ Nothing found in this period.') : null,
        d.shared_clock_ins.length ? h('table.data', h('thead', h('tr', ['Day', 'One phone clocked in', 'Phone / browser'].map(x => h('th', x)))),
          h('tbody', d.shared_clock_ins.map(s => h('tr', h('td.nowrap', s.date), h('td', { style: { color: 'var(--bad)', fontWeight: 600 } }, '🔴 ', s.people), h('td', s.in_device || ''))))) : null,
        d.warnings.length ? h('table.data', { style: { marginTop: '8px' } }, h('thead', h('tr', ['', 'When', 'Accounts', 'Phone / network', 'Clock-ins around then'].map(x => h('th', x)))),
          h('tbody', d.warnings.map(w => h('tr', h('td', { title: w.why }, LEVEL[w.level][0]),
            h('td.nowrap', w.from.slice(0, 16), w.to !== w.from ? ` – ${w.to.slice(11, 16)}` : ''),
            h('td', { style: { color: LEVEL[w.level][1], fontWeight: 600 } }, w.accounts.join(', '), h('div.muted', { style: { fontSize: '11px', fontWeight: 400 } }, w.why)),
            h('td', w.device || '', h('div.muted', { style: { fontSize: '11px' } }, w.ip || '')),
            h('td', w.clock_ins.length ? w.clock_ins.map(c => h('div', h('a', { href: `#/view/attendance/${c.attendance_id}` }, `${c.name} ${c.at}`))) : h('span.muted', 'none')))))) : null),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Time', 'What', 'Person', 'Username', 'Network (IP)', 'Phone / browser', 'Device'].map(x => h('th', x)))),
        h('tbody', ev.map(e => h('tr', h('td.nowrap', e.at.slice(0, 16)), h('td.nowrap', { style: { color: e.kind === 'failed' ? 'var(--bad)' : '' } }, KIND[e.kind] || e.kind),
          h('td', e.name || ''), h('td', e.username || ''), h('td', { style: { fontSize: '12px' } }, e.ip || ''), h('td', e.device || ''),
          h('td.muted', { style: { fontSize: '11px' }, title: 'The CRM\'s cookie on that phone / browser: the same code = the same browser' }, String(e.device_id || '').slice(0, 6)))))))),
      h('p.muted', { style: { fontSize: '12px' } }, `${ev.length} of ${d.events.length} entries. Passwords are never logged. The log starts from the day this version went live.`));
  };
  const load = async () => { d = await api(`/hr/login-log?days=${days.value}`); draw(); };
  days.onchange = () => load().catch(fail);
  who.oninput = () => d && draw();
  box.replaceChildren(h('div.toolbar', days, who, h('button.btn', { onclick: () => load().catch(fail) }, '↻ Refresh')), out);
  await load();
}
