// App logins (HR → App logins): make the logins for everyone who has none, all at once, and print the temporary passwords
// to hand out. They are shown once; each person sets their own password at the first sign-in.
import { h, api, toast, busy, modal, fail } from '../ui.js';
import { ROLE_INFO } from '../schema.js';

const ROLES = Object.keys(ROLE_INFO).filter(r => !['admin', 'manager'].includes(r));
const roleLabel = r => ROLE_INFO[r]?.label || r;

export async function appLogins(box) {
  const people = await api('/hr/login-gaps').catch(e => { fail(e); return []; });
  if (!people.length) return box.replaceChildren(h('p.muted', 'Every active employee has a login.'));

  const rows = people.map(p => {
    const tick = h('input', { type: 'checkbox', checked: true, onchange: () => count() });
    const role = h('select', { 'aria-label': `Role for ${p.name}` }, ROLES.map(r => h('option', { value: r, selected: r === 'worker' }, roleLabel(r))));
    return { p, tick, role, tr: h('tr', h('td', tick), h('td', p.emp_code || ''), h('td', p.name), h('td', p.department || ''), h('td', p.designation || ''), h('td', p.login || h('span.muted', 'made from the name')), h('td', role)) };
  });
  const all = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Tick everyone', onchange: () => { rows.forEach(r => { r.tick.checked = all.checked; }); count(); } });
  const go = h('button.btn.primary', { type: 'button', onclick: busy(() => create()) });
  const count = () => { const n = rows.filter(r => r.tick.checked).length; go.textContent = `🔑 Create ${n} login${n === 1 ? '' : 's'}`; go.disabled = !n; };
  count();

  const create = async () => {
    const list = rows.filter(r => r.tick.checked).map(r => ({ employee_id: r.p.id, role: r.role.value }));
    const yes = await modal('Create logins?', h('p', `${list.length} new login${list.length === 1 ? '' : 's'}. The temporary passwords are shown once, on the next screen: print them before you leave it.`),
      [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', value: true }]);
    if (!yes) return;
    showCreated(box, (await api('/hr/login-gaps', { method: 'POST', body: { people: list } })).created);
  };

  box.replaceChildren(
    h('p', `${people.length} active employee${people.length === 1 ? ' has' : 's have'} no login yet. Worker is the least access: own attendance and leave, own tasks. Choose another role for anyone who needs more.`),
    h('div.toolbar', go),
    h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', all), h('th', 'Code'), h('th', 'Name'), h('th', 'Department'), h('th', 'Designation'), h('th', 'Username'), h('th', 'Role'))), h('tbody', rows.map(r => r.tr)))));
}

function showCreated(box, created) {
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
  const print = () => {
    const pr = document.querySelector('.print-root');
    pr.replaceChildren(h('div.doc', h('div.page', h('h2', 'CRM and attendance app logins'), h('p', `${address ? `Address: ${address}. ` : ''}Each person sets a new password at the first sign-in. Keep this sheet private and destroy it after handing out.`), sheet())));
    pr.classList.remove('hidden');
    const clear = () => { pr.classList.add('hidden'); pr.replaceChildren(); window.removeEventListener('afterprint', clear); };
    window.addEventListener('afterprint', clear);
    setTimeout(() => window.print(), 50);
  };
  box.replaceChildren(
    h('p', { style: { color: 'var(--warn)' } }, `${created.length} login${created.length === 1 ? '' : 's'} created. These passwords are shown only this once: print them now. Each person sets a new password at the first sign-in. An administrator can set a new one under Admin → Users.`),
    h('div.toolbar', h('button.btn.primary', { type: 'button', onclick: print }, '🖨 Print'), h('button.btn', { type: 'button', onclick: copy }, '📋 Copy all'), h('button.btn', { type: 'button', onclick: done }, 'Done, I have them')),
    address ? h('p', `Address: ${address}`) : null,
    h('div.table-wrap', sheet()));
  box.querySelector('table').classList.add('data');
}
