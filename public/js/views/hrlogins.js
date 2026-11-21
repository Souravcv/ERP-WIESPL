// App logins (HR → App logins): make the logins for everyone who has none, all at once, and print the temporary passwords
// to hand out. They are shown once; each person sets their own password at the first sign-in.
import { h, api, toast, busy, modal, fail } from '../ui.js';
import { slipPages, SLIP_LANGS } from './slipguide.js';
import { guideLang } from './attendguide.js';

const FULL_ACCESS = ['admin', 'manager'];

export async function appLogins(box) {
  const [{ people = [], roles = [] }, holders] = await Promise.all([api('/hr/login-gaps').catch(e => { fail(e); return {}; }), api('/hr/login-holders').catch(() => ({ people: [], allowed: false }))]);
  const reprint = holdersPart(box, holders);
  const first = holders.allowed ? await firstPasswordPart() : null;
  if (!people.length) return box.replaceChildren(h('p.muted', 'Every active employee has a login.'), first, reprint);
  const labels = Object.fromEntries(roles.map(r => [r.name, r.label]));
  const roleLabel = r => labels[r] || r;

  const rows = people.map(p => {
    const tick = h('input', { type: 'checkbox', checked: true, onchange: () => count() });
    const role = h('select', { 'aria-label': `Role for ${p.name}` }, roles.map(r => h('option', { value: r.name, selected: r.name === 'worker' }, r.label)));
    return { p, tick, role, tr: h('tr', h('td', tick), h('td', p.emp_code || ''), h('td', p.name), h('td', p.department || ''), h('td', p.designation || ''), h('td', p.login || h('span.muted', 'made from the name')), h('td', role)) };
  });
  const all = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Tick everyone', onchange: () => { rows.forEach(r => { r.tick.checked = all.checked; }); count(); } });
  const go = h('button.btn.primary', { type: 'button', onclick: busy(() => create()) });
  const count = () => { const n = rows.filter(r => r.tick.checked).length; go.textContent = `🔑 Create ${n} login${n === 1 ? '' : 's'}`; go.disabled = !n; };
  count();

  const create = async () => {
    const list = rows.filter(r => r.tick.checked).map(r => ({ employee_id: r.p.id, role: r.role.value }));
    const full = rows.filter(r => r.tick.checked && FULL_ACCESS.includes(r.role.value));
    const yes = await modal('Create logins?', h('div',
      h('p', `${list.length} new login${list.length === 1 ? '' : 's'}. The temporary passwords are shown once, on the next screen: print them before you leave it.`),
      full.length ? h('p', { style: { color: 'var(--warn)' } }, `Full access to everything: ${full.map(r => `${r.p.name} (${roleLabel(r.role.value)})`).join(', ')}.`) : null),
      [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', value: true }]);
    if (!yes) return;
    showCreated(box, (await api('/hr/login-gaps', { method: 'POST', body: { people: list } })).created, roleLabel);
  };

  box.replaceChildren(
    h('p', `${people.length} active employee${people.length === 1 ? ' has' : 's have'} no login yet. Worker is the least access: own attendance and leave, own tasks. Choose another role for anyone who needs more.`),
    h('div.toolbar', go),
    h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', all), h('th', 'Code'), h('th', 'Name'), h('th', 'Department'), h('th', 'Designation'), h('th', 'Username'), h('th', 'Role'))), h('tbody', rows.map(r => r.tr)))),
    first, reprint);
}

// Installation days (administrators only): one first password, typed here by the administrator, for everyone ticked who
// has never signed in. Each person must set their own password at the first sign-in; nothing is shown or printed.
async function firstPasswordPart() {
  const { people = [] } = await api('/hr/never-signed-in').catch(() => ({}));
  if (!people.length) return null;
  const rows = people.map(p => { const tick = h('input', { type: 'checkbox', checked: true, onchange: () => count() }); return { p, tick, tr: h('tr', h('td', tick), h('td', p.name), h('td', h('b', p.username)), h('td', p.role_label)) }; });
  const all = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Tick everyone', onchange: () => { rows.forEach(r => { r.tick.checked = all.checked; }); count(); } });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'first password (8+ characters)' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'type it again' });
  const go = h('button.btn', { type: 'button', onclick: busy(async () => {
    const ids = rows.filter(r => r.tick.checked).map(r => r.p.user_id);
    if (pw.value.length < 8) return fail(new Error('The password needs at least 8 characters'));
    if (pw.value !== pw2.value) return fail(new Error('The two passwords are not the same'));
    if (!(await modal('Set the first password?', h('p', `${ids.length} people who never signed in get this password. Each must set their own at the first sign-in. Anyone who knows the password and a username can sign in as that person until they do, so hand it out only for the installation.`),
      [{ label: 'Cancel', value: false }, { label: 'Set password', cls: 'primary', value: true }]))) return;
    const r = await api('/hr/first-password', { method: 'POST', body: { user_ids: ids, password: pw.value } });
    pw.value = pw2.value = '';
    toast(`First password set for ${r.done.length}`);
  }) });
  const count = () => { const n = rows.filter(r => r.tick.checked).length; go.textContent = `🔑 Set first password for ${n}`; go.disabled = !n; };
  count();
  return h('div', { style: { marginTop: '24px' } },
    h('h3', `People who have never signed in (${people.length})`),
    h('p.muted', 'For the installation: give everyone ticked one first password that you type here. Each person must set their own password at the first sign-in. People who have signed in before are not in this list.'),
    h('div.toolbar', pw, pw2, go),
    h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', all), h('th', 'Name'), h('th', 'Username'), h('th', 'Role'))), h('tbody', rows.map(r => r.tr)))));
}

// People who already have a login (administrators only): passwords are kept locked and can never be shown, so the ticked
// people get new temporary passwords, printed as a sheet (Print → Save as PDF). Each sets their own at the next sign-in.
function holdersPart(box, { people = [], allowed = false } = {}) {
  if (!allowed || !people.length) return null;
  const rows = people.map(p => { const tick = h('input', { type: 'checkbox', onchange: () => count() }); return { p, tick, tr: h('tr', h('td', tick), h('td', p.emp_code || ''), h('td', p.name), h('td', p.department || ''), h('td', h('b', p.username)), h('td', p.role_label)) }; });
  const all = h('input', { type: 'checkbox', 'aria-label': 'Tick everyone', onchange: () => { rows.forEach(r => { r.tick.checked = all.checked; }); count(); } });
  const go = h('button.btn', { type: 'button', onclick: busy(() => reset()) });
  const count = () => { const n = rows.filter(r => r.tick.checked).length; go.textContent = `🖨 New passwords and print for ${n}`; go.disabled = !n; };
  count();
  const reset = async () => {
    const ticked = rows.filter(r => r.tick.checked);
    const yes = await modal('Give new passwords?', h('div',
      h('p', `${ticked.length} people get a new temporary password. Their current passwords stop working at once, so hand the sheet out straight away. Each person sets their own password at the next sign-in.`),
      h('p', 'The passwords are shown once, on the next screen: print them (or Save as PDF) before you leave it.')),
      [{ label: 'Cancel', value: false }, { label: 'Give new passwords', cls: 'primary', value: true }]);
    if (!yes) return;
    const labels = Object.fromEntries(people.map(p => [p.role, p.role_label]));
    showCreated(box, (await api('/hr/login-reset', { method: 'POST', body: { user_ids: ticked.map(r => r.p.user_id) } })).created, r => labels[r] || r);
  };
  return h('div', { style: { marginTop: '24px' } },
    h('h3', 'Print login slips for people who already have a login'),
    h('p.muted', 'Passwords are kept locked and cannot be shown. Tick the people who need their login on paper: they get a new temporary password, printed on a sheet. Administrator logins and your own are not in the list.'),
    h('div.toolbar', go),
    h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', all), h('th', 'Code'), h('th', 'Name'), h('th', 'Department'), h('th', 'Username'), h('th', 'Role'))), h('tbody', rows.map(r => r.tr)))));
}

function showCreated(box, created, roleLabel) {
  // The server's own screen says localhost, which is no use to anyone else.
  const address = /^(localhost|127\.)/.test(location.hostname) ? '' : location.origin;
  const text = created.map(c => `${c.name}\n${address ? `Address: ${address}\n` : ''}Username: ${c.username}\nTemporary password: ${c.password}`).join('\n\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it', true); } };
  // Leaving by accident would lose the passwords.
  const guard = e => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', guard);
  const done = () => { window.removeEventListener('beforeunload', guard); location.hash = '#/list/employees'; };
  const sheet = () => h('table', h('thead', h('tr', h('th', 'Code'), h('th', 'Name'), h('th', 'Username'), h('th', 'Temporary password'), h('th', 'Role'))),
    h('tbody', created.map(c => h('tr', h('td', c.emp_code || ''), h('td', c.name), h('td', h('b', c.username)), h('td', h('b', { style: { fontFamily: 'monospace', fontSize: '15px' } }, c.password)), h('td', roleLabel(c.role))))));
  // the list on one sheet, or one slip per person (two per A4) with the picture guide for clocking in / out
  const lang = h('select', { 'aria-label': 'Language of the slips' }, SLIP_LANGS.map(([k, l]) => h('option', { value: k, selected: k === guideLang() }, l)));
  const print = (slips = false) => {
    const pr = document.querySelector('.print-root');
    pr.replaceChildren(slips ? slipPages(created, { address, lang: lang.value, roleLabel })
      : h('div.doc', h('div.page', h('h2', 'CRM and attendance app logins'), h('p', `${address ? `Address: ${address}. ` : ''}Each person sets a new password at the first sign-in. Keep this sheet private and destroy it after handing out.`), sheet())));
    pr.classList.remove('hidden');
    const clear = () => { pr.classList.add('hidden'); pr.replaceChildren(); window.removeEventListener('afterprint', clear); };
    window.addEventListener('afterprint', clear);
    setTimeout(() => window.print(), 50);
  };
  box.replaceChildren(
    h('p', { style: { color: 'var(--warn)' } }, `${created.length} login${created.length === 1 ? '' : 's'} ready. These passwords are shown only this once: print them now (Print → Save as PDF for a PDF). Each person sets a new password at the first sign-in. An administrator can set a new one under Admin → Users.`),
    h('div.toolbar', h('button.btn.primary', { type: 'button', onclick: () => print(true) }, '🖨 Print slips with attendance guide (2 per page)'), h('span.muted', 'Language'), lang,
      h('button.btn', { type: 'button', onclick: () => print(false) }, '🖨 Print list'), h('button.btn', { type: 'button', onclick: copy }, '📋 Copy all'), h('button.btn', { type: 'button', onclick: done }, 'Done, I have them')),
    address ? h('p', `Address: ${address}`) : null,
    h('div.table-wrap', sheet()));
  box.querySelector('table').classList.add('data');
}
