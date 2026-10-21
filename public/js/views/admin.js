import { h, api, state, toast, fail, modal, badge, download, confirmBox, clearRefCache, fmtDate } from '../ui.js';
import { ENTITIES, GROUPS, FUNCTIONS, ACCESS_LEVELS, setPermissions, canWrite } from '../schema.js';
import { table } from './list.js';
import { PART_UI, PHOTO_SLOTS } from '../parts.js';
import { inr } from '../calc.js';

// ---------------------------------------------------------------- users (each user gets one role)
export async function usersView(root) {
  const [users, roles] = await Promise.all([api('/users'), api('/roles')]);
  const roleLabel = Object.fromEntries(roles.map(r => [r.name, r.label]));
  const edit = async (u = {}) => {
    const roleHelp = h('div.muted', { style: { fontSize: '12px', fontWeight: 400 } });
    const f = {
      username: h('input', { value: u.username || '', readOnly: !!u.id }),
      name: h('input', { value: u.name || '' }),
      role: h('select', roles.map(r => h('option', { value: r.name }, r.label))),
      email: h('input', { type: 'email', value: u.email || '' }),
      phone: h('input', { value: u.phone || '' }),
      password: h('input', { type: 'password', autocomplete: 'new-password', placeholder: u.id ? 'Leave blank to keep current' : 'min 8 characters' }),
      active: h('select', h('option', { value: '1' }, 'Active'), h('option', { value: '0' }, 'Disabled')),
    };
    f.role.value = u.role || roles.find(r => r.name === 'sales')?.name || roles[0].name;
    const showHelp = () => { roleHelp.textContent = roles.find(r => r.name === f.role.value)?.description || ''; };
    f.role.onchange = showHelp; showHelp();
    f.active.value = u.id && !u.active ? '0' : '1';
    await modal(u.id ? `Edit ${u.name}` : 'New user', h('div.form-grid',
      h('label', 'Username (for login)', f.username), h('label', 'Full name', f.name), h('label.span-2', 'Role', f.role, roleHelp),
      h('label', 'Email', f.email), h('label', 'Phone', f.phone), h('label', u.id ? 'Reset password' : 'Initial password', f.password), h('label', 'Status', f.active)),
      [{ label: 'Cancel' },
        u.id && u.id !== state.user.id ? { label: '🗑 Delete user', cls: 'danger', action: async () => {
          if (!(await confirmBox(`Delete the login of ${u.name} (${u.username})? Records they made keep their name. To only block the login for now, set Status to Disabled instead.`, 'Delete'))) return false;
          await api(`/users/${u.id}`, { method: 'DELETE' });
          toast('User deleted');
          usersView(root);
          return true;
        } } : null,
        { label: 'Save', cls: 'primary', action: async () => {
        const body = { username: f.username.value, name: f.name.value, role: f.role.value, email: f.email.value, phone: f.phone.value, active: f.active.value === '1' };
        if (f.password.value) body.password = f.password.value;
        await api(u.id ? `/users/${u.id}` : '/users', { method: u.id ? 'PUT' : 'POST', body });
        toast('User saved');
        usersView(root);
      } }].filter(Boolean));
  };
  root.replaceChildren(
    h('div.page-head', h('h1', '👥 Users'), h('div.actions', h('a.btn', { href: '#/roles' }, '🛡️ Roles & Permissions'), h('button.btn.primary', { onclick: () => edit() }, '+ New user'))),
    h('p.muted', 'Each user gets one role. What a role can see and do is set under Roles & Permissions.'),
    h('div.card.flush', h('table.data', h('thead', h('tr', ['Name', 'Username', 'Role', 'Email', 'Phone', 'Status'].map(t => h('th', t)))),
      h('tbody', users.map(u => h('tr.clickable', { onclick: () => edit(u) }, h('td', u.name), h('td', u.username), h('td', roleLabel[u.role] || u.role), h('td', u.email || ''), h('td', u.phone || ''),
        h('td', u.active ? badge('Active') : badge('Cancelled'), u.must_change ? h('span.muted', ' (must change password)') : null)))))),
  );
}

// ---------------------------------------------------------------- roles: what a role handles + module access + functions
export async function rolesView(root) {
  const roles = await api('/roles');
  const edit = async (r = null) => {
    const isAdminRole = r?.name === 'admin';
    const label = h('input', { value: r?.label || '', placeholder: 'e.g. Store Keeper, Site Supervisor' });
    const description = h('textarea', { rows: 3, placeholder: 'What this person handles, e.g. "Receives material at site, issues to installation team, records returns"' });
    description.value = r?.description || '';
    const base = r?.perms || roles.find(x => x.name === 'engineer')?.perms || { modules: {}, functions: [] };
    const modSel = {};
    const funcChk = {};
    const levelSelect = cur => {
      const s = h('select', { style: { width: 'auto' } }, Object.entries(ACCESS_LEVELS).map(([k, v]) => h('option', { value: k }, v)));
      s.value = cur || 'none';
      return s;
    };
    const setAll = lvl => { for (const s of Object.values(modSel)) s.value = lvl; };
    const matrix = isAdminRole ? h('p', 'The Administrator always has full access to everything.') : h('div',
      h('div.toolbar', h('b', 'Module access'), h('span.muted', 'Set all to:'), Object.entries(ACCESS_LEVELS).map(([k, v]) => h('button.btn.small', { type: 'button', onclick: () => setAll(k) }, v))),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '6px 18px' } },
        GROUPS.map(g => h('div', h('div', { style: { fontWeight: 700, margin: '8px 0 4px', color: 'var(--text-2)' } }, g),
          Object.entries(ENTITIES).filter(([, e]) => e.group === g).map(([k, e]) => {
            modSel[k] = levelSelect(base.modules?.[k]);
            return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '2px 0' } }, h('span', `${e.icon} ${e.label}`), modSel[k]);
          })))),
      h('div', { style: { fontWeight: 700, margin: '16px 0 6px' } }, 'Special functions'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '4px 18px' } },
        Object.entries(FUNCTIONS).map(([k, v]) => {
          funcChk[k] = h('input', { type: 'checkbox', checked: (base.functions || []).includes(k), style: { width: 'auto' } });
          return h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } }, funcChk[k], v);
        })),
      h('p.muted', { style: { fontSize: '12px' } }, 'View = can open and search. View + add / edit = can also create and change records. Full = can also delete. PO approvals happen in order: Technical → Commercial → Final (GM).'));
    await modal(r ? `Role: ${r.label}` : 'New role', h('div.grid', h('div.form-grid', h('label', 'Role name', label), h('label.span-2', 'What this role handles', description)), matrix),
      [{ label: 'Cancel' }, ...(r && !r.builtin && !r.users ? [{ label: 'Delete role', cls: 'danger', action: async () => {
        if (!(await confirmBox(`Delete the role "${r.label}"?`, 'Delete'))) return false;
        await api(`/roles/${r.name}`, { method: 'DELETE' }); toast('Role deleted'); rolesView(root);
      } }] : []),
      { label: 'Save role', cls: 'primary', action: async () => {
        const perms = isAdminRole ? null : { modules: Object.fromEntries(Object.entries(modSel).map(([k, s]) => [k, s.value])), functions: Object.keys(funcChk).filter(k => funcChk[k].checked) };
        const saved = await api(r ? `/roles/${r.name}` : '/roles', { method: r ? 'PUT' : 'POST', body: { label: label.value, description: description.value, perms } });
        if (saved.name === state.user.role && saved.perms) setPermissions({ [saved.name]: saved.perms });
        toast(r ? 'Role saved' : `Role "${saved.label}" created. Assign it to users on the Users page.`);
        rolesView(root);
      } }], { wide: true });
  };
  const summary = r => {
    if (!r.perms) return 'Everything';
    const by = lvl => Object.entries(r.perms.modules).filter(([, v]) => v === lvl).map(([k]) => ENTITIES[k]?.label).filter(Boolean);
    const edit = [...by('full'), ...by('edit')];
    return `${edit.length ? 'Edits: ' + edit.join(', ') : 'View only'}${r.perms.functions.length ? ' · Can: ' + r.perms.functions.map(f => FUNCTIONS[f]).join('; ') : ''}`;
  };
  root.replaceChildren(
    h('div.page-head', h('h1', '🛡️ Roles & Permissions'), h('div.actions', h('a.btn', { href: '#/users' }, '👥 Users'), h('button.btn.primary', { onclick: () => edit().catch(fail) }, '+ New role'))),
    h('p.muted', 'A role says what a person handles and which tabs and functions they get. Create as many as you need (e.g. "Store Keeper – Site", "Drawing Engineer") and assign them to users.'),
    h('div.card.flush', h('table.data', h('thead', h('tr', ['Role', 'What they handle', 'Access', 'Users'].map(t => h('th', t)))),
      h('tbody', roles.map(r => h('tr.clickable', { onclick: () => edit(r).catch(fail) },
        h('td.nowrap', h('b', r.label), r.builtin ? h('div.muted', { style: { fontSize: '11px' } }, 'built-in') : null),
        h('td', r.description || ''), h('td', { style: { fontSize: '12px', color: 'var(--text-2)', maxWidth: '520px' } }, summary(r)), h('td.num', r.users)))))));
}

const SETTINGS_FORM = [
  ['Company', [['company_name', 'Company name'], ['company_short', 'Short name'], ['tagline', 'Tagline'], ['reg_address', 'Registered address', 'ta'], ['works_address', 'Works address', 'ta'],
    ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['cin', 'CIN'], ['gstin', 'GSTIN'], ['state', 'State (for CGST/SGST vs IGST)'], ['bank_details', 'Bank details (printed on invoices)', 'ta']]],
  ['Numbering & approvals', [['quote_prefix', 'Document prefix (WIESPL/…)'], ['require_quote_approval', 'Quotations need manager approval', 'yn'], ['require_po_approval', 'Purchase orders need manager approval', 'yn']]],
  ['Purchase order defaults (printed on every PO)', [['pan', 'Company PAN'], ['po_doc_no', 'Document No (footer)'], ['po_delivery_address', 'Delivery & billing address', 'ta'], ['po_contact_person', 'Our contact person'],
    ['po_contact_phone', 'Contact number'], ['po_contact_emails', 'Purchase email(s)'], ['po_greeting', 'Opening line', 'ta'], ['po_term_advance', 'Payment – Advance'], ['po_term_balance', 'Payment – Balance'],
    ['po_term_delivery', 'Delivery'], ['po_term_warranty', 'Warranty'], ['po_term_freight', 'Freight'], ['po_term_validity', 'Validity', 'ta'], ['po_term_invoice', 'Invoice copies'],
    ['po_term_jurisdiction', 'Jurisdiction', 'ta'], ['po_term_extra', 'Additional terms', 'ta']]],
  ['Client website enquiry form (enquire.html)', [['web_next_steps', 'What happens next (thank-you screen)', 'ta'], ['web_trust', 'Trust points beside the form (one per line)', 'list'], ['web_whatsapp', 'Company WhatsApp number (e.g. 919876543210)'], ['web_brochure_url', 'Brochure link (PDF)'],
    ['web_show_estimate', 'Show an indicative price range at the end', 'yn'], ['web_estimates', 'Ranges, one per line: Modular OT | 4500000 | 8500000 | per OT', 'list']]],
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
    sections, await docNumbersCard(), photosCard());
}

// Continue a document series from your own book number (this financial year).
async function docNumbersCard() {
  const series = await api('/admin/doc-numbers');
  return h('div.card', h('h2', '🔢 Document numbers (this financial year)'),
    h('p.muted', 'Continue numbering from your own challan book: enter the number the NEXT challan should get. It cannot be a number already used in the CRM. Numbers start again at 001 every 1 April.'),
    h('table.data', { style: { maxWidth: '760px' } }, h('thead', h('tr', ['Series', 'Last used in the CRM', 'Next number', ''].map(x => h('th', x)))),
      h('tbody', series.map(s => {
        const next = h('input', { type: 'number', min: s.used + 1, value: s.next, style: { width: '120px' } });
        const example = h('span.muted', ` → ${s.example}`);
        next.oninput = () => { example.textContent = ` → ${s.prefix}-${String(next.value || '').padStart(3, '0')}/20${s.fy}`; };
        return h('tr', h('td', `${s.label} (${s.prefix}-)`), h('td', s.used ? `${s.prefix}-${String(s.used).padStart(3, '0')}/20${s.fy}` : h('span.muted', 'none yet')),
          h('td', next, example), h('td', h('button.btn.small.primary', { onclick: async () => {
            try { const r = await api('/admin/doc-numbers', { method: 'PUT', body: { key: s.key, next: Number(next.value) } }); toast(`Next ${s.label}: ${r.example}`); }
            catch (e) { fail(e); }
          } }, 'Save')));
      }))));
}

// Real photos of each part (pass box, door, pendants …): shown to clients when they tap that part in the 3D view.
function photosCard() {
  const card = h('div.card');
  const part = h('select', PHOTO_SLOTS.map(([k, label]) => h('option', { value: k }, label)));
  const caption = h('input', { placeholder: 'e.g. Pass box at Sahyadri Hospital, Pune' });
  const file = h('input', { type: 'file', accept: '.jpg,.jpeg,.png,.webp', multiple: true });
  const list = h('div');
  const load = async () => {
    const rows = await api('/part-photos');
    const by = {};
    for (const r of rows) (by[r.part] ||= []).push(r);
    list.replaceChildren(...(rows.length ? Object.entries(by).map(([k, ps]) => h('div', { style: { margin: '12px 0' } }, h('b', PHOTO_SLOTS.find(x => x[0] === k)?.[1] || PART_UI[k]?.title || k),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px' } }, ps.map(p => h('div', { style: { width: '150px' } },
        h('img', { src: `/api/public/part-photo/${p.id}`, alt: p.caption || '', style: { width: '150px', height: '100px', objectFit: 'cover', borderRadius: '8px', display: 'block' } }),
        h('div.muted', { style: { fontSize: '11px', margin: '3px 0' } }, p.caption || p.filename),
        h('button.btn.sm', { onclick: async () => { if (!(await confirmBox('Delete this photo? Clients will no longer see it.'))) return; await api(`/part-photos/${p.id}`, { method: 'DELETE' }); toast('Photo deleted'); load().catch(fail); } }, '🗑 Delete')))))) : [h('p.muted', 'No photos yet.')]));
  };
  const upload = async () => {
    if (!file.files.length) { toast('Choose one or more photos'); return; }
    for (const f of file.files) await api(`/part-photos?part=${encodeURIComponent(part.value)}&name=${encodeURIComponent(f.name)}&caption=${encodeURIComponent(caption.value)}`, { method: 'POST', raw: await f.arrayBuffer() });
    toast(`${file.files.length} photo(s) added`); file.value = ''; caption.value = ''; load().catch(fail);
  };
  card.append(h('h2', '📷 Website 3D: real photos of each part'),
    h('p.muted', 'When a client taps a part in the 3D view of the enquiry form (pass box, door, pendant, wall …), these photos from your own installations are shown beside it. JPG, PNG or WebP, up to 8 MB, 12 per part.'),
    h('div.form-grid', h('label', 'Part', part), h('label', 'Caption (optional)', caption), h('label.span-2', 'Photos', file)),
    h('div.toolbar', h('button.btn.primary', { onclick: () => upload().catch(fail) }, '⬆ Upload photos')), list);
  load().catch(fail);
  return card;
}

export async function auditView(root) {
  const rows = await api('/audit');
  root.replaceChildren(h('div.page-head', h('h1', '🕘 Activity Log')), h('div.card.flush', h('div.table-wrap', h('table.data',
    h('thead', h('tr', ['When', 'User', 'Module', 'Record', 'Action', 'Details'].map(t => h('th', t)))),
    h('tbody', rows.map(a => h('tr' + (ENTITIES[a.entity] && a.record_id && a.action !== 'delete' ? '.clickable' : ''), {
      onclick: () => ENTITIES[a.entity] && a.record_id && a.action !== 'delete' && (location.hash = a.entity === 'quotations' ? `#/quotation/${a.record_id}` : `#/view/${a.entity}/${a.record_id}`),
    }, h('td.nowrap', a.at), h('td', a.user), h('td', ENTITIES[a.entity]?.label || a.entity), h('td', a.record_id ?? ''), h('td', a.action), h('td.clip', a.summary || ''))))))));
}

const IMPORT_KINDS = [
  ['items', 'Item Master / Smart Store workbook', 'Items with category, UOM, price, GST, HSN. Upload the whole “WIESPL Smart Store ERP” workbook to bring in items, 1 April opening stock and all Inward, Outward, Transfer, Return, Scrap and FG entries in one go.'],
  ['opening', 'Opening stock (1 April)', 'One row per item: code, quantity and price as on 1 April.'],
  ['stock', 'Stock movements', 'Inward / Outward / Transfer / Return / Scrap / Adjust rows.'],
  ['vendors', 'Vendors', 'Template, or your “Purchase Address with GST Details” sheet (name, address, email and GSTIN in one cell are split automatically; state comes from the GSTIN).'],
  ['purchase_orders', 'Past purchase orders', 'Template (one row per line), or a PO saved in the WIESPL PO format (e.g. “008 Venti-Tron … .xlsx”).'],
  ['requisitions', 'Material requisitions', 'Template, one row per material line.'],
  ['projects', 'Projects / work orders', 'Project / work order no, name, client, site, work order date.'],
  ['enquiries', 'Sales Enquiry Register', 'The SALES ENQUIRY REGISTER sheet. Imported directly; duplicates are skipped by enquiry number.'],
];

export async function importView(root) {
  const isAdmin = state.user.role === 'admin';
  const kindSel = h('select', { style: { width: 'auto' } }, IMPORT_KINDS.map(([k, label]) => h('option', { value: k }, label)));
  kindSel.value = new URLSearchParams(location.hash.split('?')[1] || '').get('kind') || 'items';
  const help = h('p.muted');
  const tplBtn = h('button.btn', { onclick: () => download(`/api/import/template/${kindSel.value}`) }, '⬇ Download template');
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const out = h('div');
  const syncKind = () => {
    help.textContent = IMPORT_KINDS.find(k => k[0] === kindSel.value)[2];
    tplBtn.style.display = kindSel.value === 'enquiries' ? 'none' : '';
    out.replaceChildren();
  };
  kindSel.onchange = syncKind;
  syncKind();

  async function previewFile() {
    if (!file.files[0]) throw new Error('Choose an .xlsx file first');
    out.replaceChildren(h('div.card', h('div.muted', 'Reading the file…')));
    const raw = await file.files[0].arrayBuffer();
    if (kindSel.value === 'enquiries') {
      const r = await api('/import/enquiries', { method: 'POST', raw });
      out.replaceChildren(h('div.card', h('h2', 'Import finished'),
        h('p', `${r.imported} enquiries imported · ${r.duplicates} already existed · ${r.skipped} empty rows skipped`),
        r.errors.length ? h('ul', r.errors.map(e => h('li', e))) : null, h('a.btn.primary', { href: '#/list/enquiries' }, 'Open Enquiry Register')));
      return;
    }
    const p = await api(`/import/preview/${kindSel.value}`, { method: 'POST', raw });
    const mode = h('select', { style: { width: 'auto' } }, h('option', { value: 'skip' }, 'Skip them (keep what is in the CRM)'), h('option', { value: 'update' }, 'Update the CRM records from the file'), h('option', { value: 'add' }, 'Add them anyway as new records'));
    const c = p.counts;
    const filter = h('select', { style: { width: 'auto' } }, h('option', { value: 'error' }, `Errors (${c.error})`), h('option', { value: 'new' }, 'New'), h('option', { value: 'duplicate' }, 'Duplicates'), h('option', { value: '' }, 'All shown'));
    const rowsBox = h('div');
    const drawRows = () => {
      const rows = p.rows.filter(r => !filter.value || r.status === filter.value);
      rowsBox.replaceChildren(rows.length ? h('div.table-wrap', { style: { maxHeight: '420px', overflow: 'auto' } }, h('table.data',
        h('thead', h('tr', h('th', 'Sheet'), h('th', 'Row'), h('th', 'Record'), h('th', 'Status'), h('th', 'Problem'))),
        h('tbody', rows.map(r => h('tr', h('td', r.sheet), h('td', r.row ?? ''), h('td.clip', { title: r.label }, r.label),
          h('td', badge(r.status === 'error' ? 'Rejected' : r.status === 'duplicate' ? 'Pending' : 'New'), r.status === 'duplicate' ? ' already in CRM' : ''), h('td', { style: { color: 'var(--bad)' } }, r.errors.join('; '))))))) : h('div.muted', 'Nothing to show'));
    };
    filter.onchange = drawRows;
    if (!c.error) filter.value = '';
    drawRows();
    // Smart Store workbook: replace the earlier imports with this workbook (default), or only add new rows.
    const s = p.sync;
    const syncSel = s ? h('select', { style: { width: 'auto' } },
      h('option', { value: 'replace' }, 'Replace: make the CRM store data match this workbook (recommended)'),
      h('option', { value: 'add' }, 'Only add rows that are new (old way; corrected rows are added again)')) : null;
    const removeChk = s?.removable ? h('input', { type: 'checkbox', checked: true, style: { width: 'auto' } }) : null;
    const syncBox = s ? h('div.card', { style: { background: 'var(--surface-2)', margin: '10px 0' } },
      h('h3', { style: { marginTop: 0 } }, '🔄 Smart Store workbook'),
      h('label', 'How should this workbook be loaded?', syncSel),
      h('ul', { style: { margin: '8px 0' } },
        s.previous ? h('li', `The ${s.replace} stock movements from earlier Smart Store imports are removed and every row of this workbook is loaded again, so rows you corrected or deleted in Excel are corrected or deleted in the CRM.`)
          : h('li', 'First Smart Store import: every row of the workbook is loaded.'),
        h('li', `${s.manual} stock entr${s.manual === 1 ? 'y' : 'ies'} made directly in the CRM (GRN against a PO, issues with challans …) ${s.manual === 1 ? 'is' : 'are'} kept. Do not type those into the Excel as well, or they count twice.`),
        h('li', 'Items are updated from the Item Master (name, price, UOM, GST).'),
        s.removable ? h('li', h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, removeChk, `Remove ${s.removable} item(s) that are not in this workbook and not used anywhere in the CRM`),
          h('details', h('summary.muted', 'which ones'), h('div.muted', { style: { fontSize: '12px' } }, s.removableList.join(' · ')))) : null,
        s.kept ? h('li', `${s.kept} item(s) not in this workbook are kept because the CRM uses them`, h('details', h('summary.muted', 'which ones'), h('div.muted', { style: { fontSize: '12px' } }, s.keptList.join(' · ')))) : null,
        h('li', 'A full backup of the database is taken first (data\\backups\\before-import).')),
      p.dateFixes?.length ? h('p', { style: { color: 'var(--warn)' } }, `⚠ ${p.dateFixes.length} date(s) that do not exist were moved to the last day of that month: ${p.dateFixes.join(', ')}. Correct them in the Excel.`) : null) : null;
    const modeLabel = c.duplicate ? h('label', { style: { margin: '8px 0' } }, `${c.duplicate} records already exist in the CRM (matched by item code, GSTIN, PO no …). What should happen to them?`, mode) : null;
    const dupNote = h('p.muted', 'Stock movement rows already in the CRM (same type, date, document no, item, quantity and party) are skipped automatically, so you can import a newer copy of the same workbook later and only the new rows are added.');
    if (syncSel) { const show = () => { const rep = syncSel.value === 'replace'; if (modeLabel) modeLabel.style.display = rep ? 'none' : ''; dupNote.style.display = rep ? 'none' : ''; }; syncSel.onchange = show; show(); }
    out.replaceChildren(h('div.card',
      h('h2', `Preview: ${p.detected}`),
      s ? null : p.warning ? h('p', { style: { color: 'var(--warn)' } }, '⚠ ', p.warning) : null,
      syncBox,
      p.openingDate ? h('p.muted', `Opening stock from the Item Master is entered as on ${fmtDate(p.openingDate)}.`) : null,
      h('table.data', { style: { maxWidth: '760px', marginBottom: '12px' } },
        h('thead', h('tr', h('th', 'Sheet'), h('th.num', 'Rows'), h('th.num', 'New'), h('th.num', 'Already in CRM'), h('th.num', 'Errors'))),
        h('tbody', p.sheets.map(s => h('tr', h('td', s.sheet), h('td.num', s.total), h('td.num', s.new), h('td.num', s.duplicate), h('td.num', { style: { color: s.error ? 'var(--bad)' : '' } }, s.error))))),
      c.noCodeItems ? h('p', { style: { color: 'var(--warn)' } }, `⚠ ${c.noCodeRows} movement rows refer to ${c.noCodeItems} items that are not in the Item Master (no item code, or a code with a blank row in the master). Your Excel stock summary ignores these rows, so they are not imported. To bring them in, add the item to the Item Master sheet first (code + name), then import again.`) : null,
      modeLabel,
      dupNote,
      h('div.toolbar', h('b', 'Rows:'), filter),
      rowsBox,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        h('button.btn.primary', { onclick: async e => {
          e.target.disabled = true;
          try {
            const replace = syncSel ? syncSel.value === 'replace' : false;
            if (replace && s.previous && !(await confirmBox(`Replace the ${s.replace} stock movements of earlier Smart Store imports with this workbook${removeChk?.checked ? ` and remove ${s.removable} unused item(s)` : ''}? A backup is taken first.`, 'Replace'))) { e.target.disabled = false; return; }
            const r = await api('/import/commit', { method: 'POST', body: { token: p.token, mode: mode.value, ...(syncSel ? { sync: replace, removeItems: !!removeChk?.checked } : {}) } });
            clearRefCache();
            const ck = r.check;
            out.replaceChildren(h('div.card', h('h2', '✅ Import finished'),
              h('p', r.sync ? `Store data replaced: ${r.replaced || 0} earlier movements removed, ${r.moves} loaded from this workbook · ${r.updated} items updated · ${r.created} created${r.itemsRemoved ? ` · ${r.itemsRemoved} unused items removed` : ''}${r.noCode ? ` · ${r.noCode} rows without item code skipped` : ''} · ${r.errors} rows with errors not imported`
                : `${r.created} records created · ${r.updated} updated · ${r.moves} stock movements added · ${r.skipped} skipped as duplicates${r.noCode ? ` · ${r.noCode} rows without item code skipped` : ''} · ${r.errors} rows with errors not imported`),
              r.backup ? h('p.muted', `Backup taken first: ${r.backup}`) : null,
              ck ? h('div', h('h3', 'Check against the workbook’s Stock Summary'),
                h('p', `${ck.matched} item(s) have the same closing stock as the workbook${ck.different ? `; ${ck.different} differ (below)` : ' ✓'}. ${ck.negative} item(s) are negative${ck.negative ? ' (in the workbook too, e.g. FG parts issued without an FG Inward entry)' : ''}.`),
                ck.different ? h('p.muted', 'The CRM adds up the rows of Inward, Outward, Transfer, Return, Scrap and FG Inward. Where the workbook’s Stock Summary shows something else, it is usually not recalculated (open the Excel, press F9 / Ctrl+Alt+F9, save) or a row has a typing error.') : null,
                ck.list.length ? h('table.data', { style: { maxWidth: '760px' } }, h('thead', h('tr', h('th', 'Code'), h('th', 'Item'), h('th.num', 'CRM'), h('th.num', 'Workbook'))),
                  h('tbody', ck.list.map(d => h('tr', h('td', d.code), h('td', d.name), h('td.num', d.crm), h('td.num', d.sheet))))) : null) : null,
              r.failed?.length ? h('ul', r.failed.map(x => h('li', x))) : null,
              h('div.toolbar', h('a.btn', { href: '#/stock-summary' }, 'Stock Summary'), h('a.btn', { href: '#/list/items' }, 'Items'), h('a.btn', { href: '#/list/vendors' }, 'Vendors'), h('a.btn', { href: '#/list/purchase_orders' }, 'Purchase Orders'))));
          } catch (err) { e.target.disabled = false; fail(err); }
        } }, `Import ${c.total - c.error} rows`),
        h('button.btn', { onclick: () => out.replaceChildren() }, 'Cancel'))));
  }

  // A folder of old WIESPL PO Excel files: each file is read and imported in turn; a revised "( R )" file replaces its original.
  const poFiles = h('input', { type: 'file', accept: '.xlsx', multiple: true });
  const poOut = h('div');
  const poCard = h('div.card', h('h2', '🛒 Old purchase orders (many PO files at once)'),
    h('p.muted', 'Select all the PO Excel files (WIESPL purchase order format) — e.g. open the folder, press Ctrl+A. Each PO is created as Approved with its vendor, items (name, vendor item code, specification), charges, terms, contacts and approvers; vendors not in the CRM are added. A PO already in the CRM is replaced by its file (a “( R )” revised file replaces the earlier one), unless material was already received against it.'),
    h('div.toolbar', poFiles, h('button.btn.primary', { onclick: async e => {
      const files = [...poFiles.files].sort((a, b) => (/\(\s*r\s*\)/i.test(a.name) - /\(\s*r\s*\)/i.test(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!files.length) return fail(new Error('Choose the PO files'));
      e.target.disabled = true;
      const res = [];
      const bar = h('div', { style: { height: '8px', background: 'var(--neutral-bg)', borderRadius: '4px', overflow: 'hidden', margin: '8px 0' } }, h('div', { style: { width: '0%', height: '100%', background: 'var(--good)' } }));
      const msg = h('div.muted');
      poOut.replaceChildren(bar, msg);
      for (const [i, f] of files.entries()) {
        msg.textContent = `${i + 1} of ${files.length}: ${f.name}`;
        try { res.push(...await api(`/import/po-file?name=${encodeURIComponent(f.name)}`, { method: 'POST', raw: await f.arrayBuffer() })); }
        catch (err) { res.push({ file: f.name, action: 'error', message: err.message }); }
        bar.firstChild.style.width = `${Math.round((i + 1) / files.length * 100)}%`;
      }
      e.target.disabled = false;
      clearRefCache();
      const n = a => res.filter(r => r.action === a).length;
      // Not imported, kept, or imported with something to check (total differs from the Excel, date was blank).
      const problems = res.filter(r => (r.action !== 'created' && r.action !== 'replaced') || /CHECK|blank/.test(r.message || ''));
      const checks = res.filter(r => /CHECK/.test(r.message || '')).length;
      poOut.replaceChildren(h('p', h('b', `${files.length} file(s): ${n('created')} PO(s) created · ${n('replaced')} replaced (revisions / updates) · ${n('skipped')} kept · ${n('error')} not imported`),
        checks ? h('div', { style: { color: 'var(--warn)' } }, `${checks} PO(s) have a total different from the Grand Total in their Excel (unusual layout) — listed below and noted on the PO; please check them.`) : null),
        problems.length ? h('div.table-wrap', { style: { maxHeight: '320px', overflow: 'auto' } }, h('table.data', h('thead', h('tr', ['File', 'PO', 'Result', 'Why'].map(x => h('th', x)))),
          h('tbody', problems.map(r => h('tr', h('td', r.file), h('td', r.po_no || ''), h('td', badge(r.action === 'error' ? 'Rejected' : 'Pending'), ' ', r.action), h('td', { style: { color: r.action === 'error' ? 'var(--bad)' : '' } }, r.message || '')))))) : null,
        h('a.btn', { href: '#/list/purchase_orders' }, 'Open Purchase Orders'));
    } }, '📥 Import selected PO files')), poOut);

  const backup = isAdmin ? h('div.card', h('h2', '💾 Backup & Restore'),
    h('p', 'Download a complete copy of the CRM database (all modules). Keep it on another drive or cloud folder; take one every day or before big imports.'),
    h('div.toolbar', h('button.btn.primary', { onclick: () => download('/api/admin/backup') }, '⬇ Download full backup'),
      (() => {
        const f = h('input', { type: 'file', accept: '.db' });
        return [f, h('button.btn.danger', { onclick: async () => {
          try {
            if (!f.files[0]) throw new Error('Choose a backup .db file');
            if (!(await confirmBox('Restore this backup? ALL current data will be replaced by the backup after the CRM restarts. The current data is kept in data/backups.', 'Restore'))) return;
            const r = await api('/admin/restore', { method: 'POST', raw: await f.files[0].arrayBuffer() });
            await modal('Restore scheduled', h('p', r.message), [{ label: 'OK', cls: 'primary' }]);
          } catch (e) { fail(e); }
        } }, '⬆ Restore from backup')];
      })())) : null;

  root.replaceChildren(h('div.page-head', h('h1', '📥 Import from Excel')),
    h('div.card', h('div.toolbar', h('b', 'What are you importing?'), kindSel, tplBtn), help,
      h('div.toolbar', file, h('button.btn.primary', { onclick: () => previewFile().catch(e => { out.replaceChildren(); fail(e); }) }, kindSel.value === 'enquiries' ? 'Import' : 'Preview'))),
    out, canWrite('purchase_orders', state.user.role) ? poCard : null, backup);
}

export async function searchView(root, q) {
  const targets = ['enquiries', 'customers', 'contacts', 'quotations', 'sales_orders', 'projects', 'invoices', 'purchase_orders', 'vendors', 'items', 'service_tickets'];
  root.replaceChildren(h('div.page-head', h('h1', `🔎 Results for “${q}”`)));
  // "slow moving", "fast moving", "non moving": stock by movement class (Stock Summary, this financial year).
  const fsn = /non[\s-]*mov|non[\s-]*m\b/i.test(q) ? 'NON-M' : /\bslow/i.test(q) ? 'SLOW' : /\bfast/i.test(q) ? 'FAST' : null;
  if (fsn) {
    const r = await api(`/stock/summary?q=${encodeURIComponent(q)}`).catch(() => null);
    if (r) root.append(h('div.card', h('h2', `📊 ${{ FAST: 'Fast', SLOW: 'Slow', 'NON-M': 'Non' }[fsn]}-moving stock (${r.rows.length} items, ${inr(r.rows.reduce((s, x) => s + x.closing_value, 0))} in stock)`),
      h('p.muted', 'Issued in 4+ months this year = fast, 1–3 months = slow, never = non-moving.'),
      h('table.data', h('thead', h('tr', ['Code', 'Item', 'Category', 'In stock', 'Value', 'Last issued'].map(x => h('th', x)))),
        h('tbody', r.rows.slice(0, 50).map(x => h('tr.clickable', { onclick: () => (location.hash = `#/view/items/${x.id}`) },
          h('td', x.code), h('td', x.name), h('td', x.category || ''), h('td.num', `${x.closing} ${x.uom || ''}`), h('td.num', inr(x.closing_value)), h('td', x.last_out ? fmtDate(x.last_out) : 'never'))))),
      h('a.btn', { href: `#/stock-summary?fsn=${encodeURIComponent(fsn)}` }, `Open all in Stock Summary ›`)));
  }
  const results = await Promise.all(targets.map(t => api(`/${t}?q=${encodeURIComponent(q)}&limit=50`).then(rows => [t, rows]).catch(() => [t, []])));
  const found = results.filter(([, rows]) => rows.length);
  if (!found.length && !fsn) root.append(h('div.empty', 'Nothing found'));
  for (const [t, rows] of found) root.append(h('div.card', h('h2', `${ENTITIES[t].icon} ${ENTITIES[t].label} (${rows.length})`), table(t, rows, { pageSize: 10, totals: false })));
}
