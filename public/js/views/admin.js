import { h, api, state, toast, fail, modal, badge } from '../ui.js';
import { ROLES, ENTITIES } from '../schema.js';
import { table } from './list.js';

const ROLE_HELP = {
  admin: 'Everything, incl. users & settings',
  manager: 'Everything + approves quotations / POs, deletes records',
  sales: 'Customers, enquiries, follow-ups, quotations, catalog',
  accounts: 'Sales orders, invoices, payments, purchase, vendors',
  store: 'Inventory, stock in/out, purchase orders, vendors',
  engineer: 'Projects, material/drawing approvals, service tickets, stock issue',
};

export async function usersView(root) {
  const users = await api('/users');
  const edit = async (u = {}) => {
    const f = {
      username: h('input', { value: u.username || '', readOnly: !!u.id }),
      name: h('input', { value: u.name || '' }),
      role: h('select', ROLES.map(r => h('option', { value: r }, `${r} – ${ROLE_HELP[r]}`))),
      email: h('input', { type: 'email', value: u.email || '' }),
      phone: h('input', { value: u.phone || '' }),
      password: h('input', { type: 'password', autocomplete: 'new-password', placeholder: u.id ? 'Leave blank to keep current' : 'min 8 characters' }),
      active: h('select', h('option', { value: '1' }, 'Active'), h('option', { value: '0' }, 'Disabled')),
    };
    f.role.value = u.role || 'sales';
    f.active.value = u.id && !u.active ? '0' : '1';
    await modal(u.id ? `Edit ${u.name}` : 'New user', h('div.form-grid',
      h('label', 'Username', f.username), h('label', 'Full name', f.name), h('label.span-2', 'Role', f.role),
      h('label', 'Email', f.email), h('label', 'Phone', f.phone), h('label', u.id ? 'Reset password' : 'Initial password', f.password), h('label', 'Status', f.active)),
      [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', action: async () => {
        const body = { username: f.username.value, name: f.name.value, role: f.role.value, email: f.email.value, phone: f.phone.value, active: f.active.value === '1' };
        if (f.password.value) body.password = f.password.value;
        await api(u.id ? `/users/${u.id}` : '/users', { method: u.id ? 'PUT' : 'POST', body });
        toast('User saved');
        usersView(root);
      } }]);
  };
  root.replaceChildren(
    h('div.page-head', h('h1', '👥 Users & Roles'), h('div.actions', h('button.btn.primary', { onclick: () => edit() }, '+ New user'))),
    h('div.card.flush', h('table.data', h('thead', h('tr', ['Name', 'Username', 'Role', 'Email', 'Phone', 'Status'].map(t => h('th', t)))),
      h('tbody', users.map(u => h('tr.clickable', { onclick: () => edit(u) }, h('td', u.name), h('td', u.username), h('td', u.role), h('td', u.email || ''), h('td', u.phone || ''),
        h('td', u.active ? badge('Active') : badge('Cancelled'), u.must_change ? h('span.muted', ' (must change password)') : null)))))),
    h('div.card', h('h2', 'What each role can do'), h('table.data', h('tbody', ROLES.map(r => h('tr', h('td', h('b', r)), h('td', ROLE_HELP[r])))))),
  );
}

const SETTINGS_FORM = [
  ['Company', [['company_name', 'Company name'], ['company_short', 'Short name'], ['tagline', 'Tagline'], ['reg_address', 'Registered address', 'ta'], ['works_address', 'Works address', 'ta'],
    ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['cin', 'CIN'], ['gstin', 'GSTIN'], ['state', 'State (for CGST/SGST vs IGST)'], ['bank_details', 'Bank details (printed on invoices)', 'ta']]],
  ['Numbering & approvals', [['quote_prefix', 'Document prefix (WIESPL/…)'], ['require_quote_approval', 'Quotations need manager approval', 'yn'], ['require_po_approval', 'Purchase orders need manager approval', 'yn']]],
  ['Quotation defaults', [['default_subject', 'Default subject'], ['letter_greeting', 'Greeting'], ['letter_intro', 'Opening paragraph', 'ta'], ['letter_body', 'Body paragraph', 'ta'], ['letter_closing', 'Closing lines', 'ta'],
    ['usp_title', 'USP heading'], ['usp', 'USP points (one per line)', 'list'], ['terms', 'Default terms (one per line)', 'list'], ['client_scope', 'Default client scope', 'ta'], ['boq_note', 'Note under BOQ'], ['invoice_terms', 'Invoice terms', 'ta']]],
];

export async function settingsView(root) {
  const s = await api('/settings');
  const inputs = {};
  const sections = SETTINGS_FORM.map(([title, fields]) => h('div.card', h('h2', title), h('div.form-grid', fields.map(([k, label, type]) => {
    let el;
    if (type === 'ta' || type === 'list') { el = h('textarea', { rows: type === 'list' ? 10 : 3 }); el.value = type === 'list' ? (s[k] || []).join('\n') : s[k] ?? ''; }
    else if (type === 'yn') { el = h('select', h('option', 'Yes'), h('option', 'No')); el.value = s[k] || 'Yes'; }
    else el = h('input', { value: s[k] ?? '' });
    inputs[k] = [el, type];
    return h('label' + (type === 'ta' || type === 'list' ? '.span-2' : ''), label, el);
  }))));
  const save = async () => {
    const body = {};
    for (const [k, [el, type]] of Object.entries(inputs)) body[k] = type === 'list' ? el.value.split('\n').map(x => x.trim()).filter(Boolean) : el.value;
    state.settings = await api('/settings', { method: 'PUT', body });
    toast('Settings saved');
  };
  root.replaceChildren(h('div.page-head', h('h1', '⚙️ Company & Quotation Settings'), h('div.actions', h('button.btn.primary', { onclick: () => save().catch(fail) }, '💾 Save settings'))),
    h('p.muted', 'The scope sheet matrix and per-quotation text can be edited inside each quotation (Letter, Terms & Scope tab). Changes here apply to new quotations.'),
    sections);
}

export async function auditView(root) {
  const rows = await api('/audit');
  root.replaceChildren(h('div.page-head', h('h1', '🕘 Activity Log')), h('div.card.flush', h('div.table-wrap', h('table.data',
    h('thead', h('tr', ['When', 'User', 'Module', 'Record', 'Action', 'Details'].map(t => h('th', t)))),
    h('tbody', rows.map(a => h('tr' + (ENTITIES[a.entity] && a.record_id && a.action !== 'delete' ? '.clickable' : ''), {
      onclick: () => ENTITIES[a.entity] && a.record_id && a.action !== 'delete' && (location.hash = a.entity === 'quotations' ? `#/quotation/${a.record_id}` : `#/view/${a.entity}/${a.record_id}`),
    }, h('td.nowrap', a.at), h('td', a.user), h('td', ENTITIES[a.entity]?.label || a.entity), h('td', a.record_id ?? ''), h('td', a.action), h('td.clip', a.summary || ''))))))));
}

export async function importView(root) {
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const out = h('div');
  const run = async () => {
    if (!file.files[0]) throw new Error('Choose the Sales Enquiry Register .xlsx file');
    out.replaceChildren(h('div.muted', 'Importing…'));
    const r = await api('/import/enquiries', { method: 'POST', raw: await file.files[0].arrayBuffer() });
    out.replaceChildren(h('div.card', h('h2', 'Import finished'),
      h('p', `${r.imported} enquiries imported · ${r.duplicates} already existed · ${r.skipped} empty rows skipped`),
      r.errors.length ? h('ul', r.errors.map(e => h('li', e))) : null, h('a.btn.primary', { href: '#/list/enquiries' }, 'Open Enquiry Register')));
  };
  root.replaceChildren(h('div.page-head', h('h1', '📥 Import Sales Enquiry Register')),
    h('div.card', h('p', 'Upload the existing “Sales Enquiry Register” Excel (same columns as SALES ENQUIRY REGISTER-2025-26). Rows with only a number and no details are skipped; ',
      'the running enquiry number continues after the highest number imported. Carried-forward enquiries without a number get a CF/… number. Importing the same file twice does not create duplicates.'),
    h('div.toolbar', file, h('button.btn.primary', { onclick: () => run().catch(e => { out.replaceChildren(); fail(e); }) }, 'Import'))), out);
}

export async function searchView(root, q) {
  const targets = ['enquiries', 'customers', 'contacts', 'quotations', 'sales_orders', 'projects', 'invoices', 'purchase_orders', 'vendors', 'items', 'service_tickets'];
  root.replaceChildren(h('div.page-head', h('h1', `🔎 Results for “${q}”`)));
  const results = await Promise.all(targets.map(t => api(`/${t}?q=${encodeURIComponent(q)}&limit=50`).then(rows => [t, rows]).catch(() => [t, []])));
  const found = results.filter(([, rows]) => rows.length);
  if (!found.length) root.append(h('div.empty', 'Nothing found'));
  for (const [t, rows] of found) root.append(h('div.card', h('h2', `${ENTITIES[t].icon} ${ENTITIES[t].label} (${rows.length})`), table(t, rows, { pageSize: 10, totals: false })));
}
