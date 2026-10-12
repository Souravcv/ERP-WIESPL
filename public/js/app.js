import { h, api, state, toast, fail, modal } from './ui.js';
import { ENTITIES, GROUPS, canView, hasFunction, setPermissions } from './schema.js';
import { dashboardView } from './views/dashboard.js';
import { listView } from './views/list.js';
import { recordView } from './views/form.js';
import { quotationView } from './views/quotation.js';
import { printView } from './views/print.js';
import { usersView, rolesView, settingsView, auditView, importView, searchView } from './views/admin.js';
import { stockEntryView, stockSummaryView, poTrackerView } from './views/stock.js';
import { boqView } from './views/dispatch.js';

const $ = id => document.getElementById(id);

// Screens that are not a single module list, shown at the top of their menu group.
// Screens that are not a single module list, shown at the top of their menu group (visible with access to the module).
const EXTRA_LINKS = {
  Purchase: [['#/po-tracker', '🔎', 'PO Tracker', 'purchase_orders']],
  Store: [['#/stock-entry', '🔁', 'Stock Entry (GRN / Issue)', 'stock_moves'], ['#/stock-summary', '📊', 'Stock Summary', 'items']],
};
// [href, icon, label, who: 'admin' or a function key]
const ADMIN_LINKS = [
  ['#/import', '📥', 'Import from Excel / Backup', 'import'],
  ['#/users', '👥', 'Users', 'admin'],
  ['#/roles', '🛡️', 'Roles & Permissions', 'admin'],
  ['#/settings', '⚙️', 'Company & Quotation Settings', 'admin'],
  ['#/audit', '🕘', 'Activity Log', 'view_audit'],
];

function buildNav(pending = 0) {
  const nav = $('nav');
  const role = state.user.role;
  nav.replaceChildren(h('a', { href: '#/dashboard' }, '📊 Dashboard'));
  for (const g of GROUPS) {
    const links = [
      ...(EXTRA_LINKS[g] || []).filter(l => canView(l[3], role)).map(([href, icon, label]) => h('a', { href }, `${icon} ${label}`)),
      ...Object.entries(ENTITIES).filter(([k, e]) => e.group === g && canView(k, role))
        .map(([key, e]) => h('a', { href: `#/list/${key}` }, `${e.icon} ${e.label}`, key === 'approvals' && pending ? h('span.count', pending) : null)),
    ];
    if (links.length) nav.append(h('div.grp', g), ...links);
  }
  const admin = ADMIN_LINKS.filter(l => (l[3] === 'admin' ? role === 'admin' : hasFunction(role, l[3])));
  if (admin.length) {
    nav.append(h('div.grp', 'Admin'));
    for (const [href, icon, label] of admin) nav.append(h('a', { href }, `${icon} ${label}`));
  }
  highlightNav();
}

function highlightNav() {
  const hash = location.hash.split('?')[0].replace(/^#\/(edit|view)\//, '#/list/').replace(/^#\/quotation\/.*/, '#/list/quotations').replace(/^#\/boq\/.*/, '#/list/boqs').replace(/\/(new|\d+)$/, '');
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.getAttribute('href') === hash);
}

export async function refreshPending() {
  try {
    const rows = await api('/approvals?status=Pending&limit=200');
    buildNav(rows.length);
  } catch { /* nav still usable */ }
}

async function route() {
  const view = $('view');
  const [page, a, b] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  $('sidebar').classList.remove('open');
  $('print-root').classList.add('hidden');
  $('app').classList.remove('hidden');
  highlightNav();
  view.replaceChildren(h('div.empty', 'Loading…'));
  try {
    switch (page || 'dashboard') {
      case 'dashboard': await dashboardView(view); break;
      case 'list': await listView(view, a); break;
      case 'view': case 'edit': await recordView(view, a, b); break;
      case 'quotation': await quotationView(view, a); break;
      case 'print': $('app').classList.add('hidden'); await printView($('print-root'), a, b); break;
      case 'users': await usersView(view); break;
      case 'roles': await rolesView(view); break;
      case 'settings': await settingsView(view); break;
      case 'audit': await auditView(view); break;
      case 'import': await importView(view); break;
      case 'stock-entry': await stockEntryView(view); break;
      case 'stock-summary': await stockSummaryView(view); break;
      case 'po-tracker': await poTrackerView(view); break;
      case 'boq': await boqView(view, a); break;
      case 'search': await searchView(view, decodeURIComponent(a || '')); break;
      default: view.replaceChildren(h('div.empty', 'Page not found'));
    }
  } catch (e) {
    view.replaceChildren(h('div.card', h('h2', 'Something went wrong'), h('p', e.message)));
  }
}

async function changePassword(force = false) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const body = h('div.grid', force ? h('p', 'Please set your own password before continuing.') : null,
    h('label', 'Current password', cur), h('label', 'New password (min 8 characters)', pw), h('label', 'Repeat new password', pw2));
  const buttons = [{ label: 'Save password', cls: 'primary', action: async () => {
    if (pw.value !== pw2.value) throw new Error('Passwords do not match');
    await api('/me/password', { method: 'POST', body: { current: cur.value, password: pw.value } });
    toast('Password changed');
    return true;
  } }];
  if (!force) buttons.unshift({ label: 'Cancel' });
  const ok = await modal('Change password', body, buttons);
  if (force && !ok) return changePassword(true);
}

async function start() {
  try {
    const me = await api('/me');
    state.user = me.user; state.settings = me.settings;
    if (me.perms) setPermissions({ [me.user.role]: me.perms });
    state.people = await api('/people');
  } catch {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    return;
  }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-name').textContent = `${state.user.name} · ${state.user.role_label || state.user.role}`;
  buildNav();
  refreshPending();
  if (state.user.must_change) await changePassword(true);
  if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
  else route();
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('login-error').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
    e.target.reset();
    start();
  } catch (err) { $('login-error').textContent = err.message; }
});
$('btn-logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); location.hash = ''; location.reload(); };
$('btn-password').onclick = () => changePassword(false).catch(fail);
$('menu-btn').onclick = () => $('sidebar').classList.toggle('open');
$('global-search').addEventListener('submit', e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});
window.addEventListener('hashchange', () => state.user && route());
window.addEventListener('logged-out', () => { state.user = null; $('app').classList.add('hidden'); $('login').classList.remove('hidden'); });
window.addEventListener('approvals-changed', refreshPending);

start();
