import { h, api, state, toast, fail, modal, confirmBox, fieldInput, refOptions, clearRefCache, badge, money, fmtDate, today } from '../ui.js';
import { ENTITIES, canWrite } from '../schema.js';
import { linesTotals, inr, round2 } from '../calc.js';
import { table, newRecord, recordHref } from './list.js';

const LOCKED = {
  purchase_orders: ['Pending Approval', 'Approved', 'Sent', 'Partially Received', 'Received', 'Cancelled'],
};
const isManager = () => ['admin', 'manager'].includes(state.user.role);

// ---------------------------------------------------------------- line items (PO / invoice)
function linesEditor(f, value, { readonly, onTotals }) {
  let lines = Array.isArray(value) ? value.map(l => ({ ...l })) : [];
  const wrap = h('div');
  const totalsBox = h('div.totals');
  let items = [];

  function totals() {
    const t = linesTotals(lines);
    totalsBox.replaceChildren(h('span', 'Taxable value'), h('span.right', inr(t.subtotal)), h('span', 'GST'), h('span.right', inr(t.tax)),
      h('span.grand', 'Total'), h('span.right.grand', inr(t.total)));
    onTotals?.(t);
  }
  function render() {
    const head = h('tr', f.itemRef ? h('th', 'Inventory item') : null, f.columns.map(c => h('th', { style: { minWidth: c.width + 'px' } }, c.label)),
      h('th.num', 'Amount'), f.itemRef ? h('th.num', 'Received') : null, readonly ? null : h('th'));
    const rows = lines.map((l, i) => {
      const amount = h('td.num', inr((Number(l.qty) || 0) * (Number(l.rate) || 0)));
      const cells = f.columns.map(c => {
        const inp = c.key === 'description'
          ? h('textarea', { rows: 1, readOnly: readonly, style: { minHeight: '32px' } })
          : h('input', { type: ['number', 'money'].includes(c.type) ? 'number' : 'text', step: 'any', readOnly: readonly });
        inp.value = l[c.key] ?? '';
        inp.oninput = () => {
          l[c.key] = ['number', 'money'].includes(c.type) ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
          amount.textContent = inr((Number(l.qty) || 0) * (Number(l.rate) || 0));
          totals();
        };
        return h('td', inp);
      });
      let itemCell = null;
      if (f.itemRef) {
        const sel = h('select', { disabled: readonly }, h('option', { value: '' }, '— none —'), items.map(o => h('option', { value: o.id }, o.label)));
        sel.value = l.item_id ?? '';
        sel.onchange = async () => {
          l.item_id = sel.value ? Number(sel.value) : null;
          if (l.item_id) {
            const it = await api(`/items/${l.item_id}`);
            Object.assign(l, { description: l.description || it.name, uom: it.uom, rate: l.rate || it.rate, hsn: l.hsn || it.hsn });
            render();
          }
        };
        itemCell = h('td', sel);
      }
      return h('tr', itemCell, cells, amount, f.itemRef ? h('td.num', l.received ?? 0) : null,
        readonly ? null : h('td', h('button.icon-btn.del', { type: 'button', title: 'Remove line', onclick: () => { lines.splice(i, 1); render(); } }, '✕')));
    });
    wrap.replaceChildren(h('div.table-wrap', h('table.data.lines', h('thead', head), h('tbody', rows))),
      readonly ? null : h('button.btn.small', { type: 'button', style: { marginTop: '6px' }, onclick: () => { lines.push({ description: '', qty: 1, uom: 'No', rate: 0, gst: 18 }); render(); } }, '+ Add line'),
      totalsBox);
    totals();
  }
  if (f.itemRef) refOptions('items').then(o => { items = o; render(); }).catch(fail); else render();
  return { el: wrap, get: () => lines };
}

// ---------------------------------------------------------------- actions per module
function actionsFor(entity, row, reload) {
  const id = row.id;
  const post = (path, body) => api(path, { method: 'POST', body });
  const go = (p, then) => async () => { try { const r = await p(); then?.(r); } catch (e) { fail(e); } };
  const can = e => canWrite(e, state.user.role);
  const A = [];
  switch (entity) {
    case 'customers':
      if (can('enquiries')) A.push(h('button.btn', { onclick: () => newRecord('enquiries', { customer_id: id }) }, '+ New Enquiry'));
      if (can('contacts')) A.push(h('button.btn', { onclick: () => newRecord('contacts', { customer_id: id }) }, '+ Contact'));
      if (can('service_tickets')) A.push(h('button.btn', { onclick: () => newRecord('service_tickets', { customer_id: id }) }, '+ Service Ticket'));
      break;
    case 'enquiries':
      if (can('quotations')) A.push(h('button.btn.primary', { onclick: go(() => post(`/enquiries/${id}/quotation`), q => (location.hash = `#/quotation/${q.id}`)) }, '🧾 Create Quotation'));
      if (can('followups')) A.push(h('button.btn', { onclick: () => newRecord('followups', { enquiry_id: id, ...(row.customer_id ? { customer_id: row.customer_id } : {}) }) }, '📞 Log Follow-up'));
      if (!row.customer_id && can('customers') && row.hospital_name) {
        A.push(h('button.btn', { onclick: go(async () => {
          const c = await api('/customers', { method: 'POST', body: { name: row.hospital_name, place: row.place, district: row.district, contact_person: row.doctor_name, phone: row.doctor_phone } });
          await api(`/enquiries/${id}`, { method: 'PUT', body: { customer_id: c.id } });
          clearRefCache('customers');
          toast('Customer created and linked');
          reload();
        }) }, '🏥 Save hospital as Customer'));
      }
      break;
    case 'approvals':
      if (row.doc_type === 'Quotation') A.push(h('a.btn', { href: `#/quotation/${row.doc_id}` }, 'Open quotation'));
      if (row.doc_type === 'Purchase Order') A.push(h('a.btn', { href: `#/view/purchase_orders/${row.doc_id}` }, 'Open PO'));
      if (row.status === 'Pending' && isManager()) {
        const decide = decision => go(async () => {
          const c = h('textarea', { placeholder: 'Comments (optional)' });
          const ok = await modal(`${decision === 'Approved' ? 'Approve' : 'Reject'} ${row.doc_ref}`, h('label', 'Comments', c),
            [{ label: 'Cancel', value: false }, { label: decision === 'Approved' ? 'Approve' : 'Reject', cls: decision === 'Approved' ? 'good' : 'danger solid', value: true }]);
          if (!ok) return;
          await post(`/approvals/${id}/decide`, { decision, comments: c.value });
          toast(decision);
          window.dispatchEvent(new Event('approvals-changed'));
          reload();
        });
        A.push(h('button.btn.good', { onclick: decide('Approved') }, '✔ Approve'), h('button.btn.danger.solid', { onclick: decide('Rejected') }, '✖ Reject'));
      }
      break;
    case 'sales_orders':
      if (row.quotation_id) A.push(h('a.btn', { href: `#/quotation/${row.quotation_id}` }, 'Quotation'));
      if (can('projects')) A.push(h('button.btn', { onclick: go(() => post(`/sales_orders/${id}/project`), p => (location.hash = `#/view/projects/${p.id}`)) }, '🏗️ Create Project'));
      if (can('invoices')) A.push(h('button.btn.primary', { onclick: go(async () => {
        const pct = h('input', { type: 'number', value: 50, min: 1, max: 100 });
        const type = h('select', h('option', 'Proforma Invoice'), h('option', 'Tax Invoice'));
        const desc = h('input', { placeholder: 'e.g. 50% advance against PO' });
        const ok = await modal('Create invoice from Sales Order', h('div.grid',
          h('p.muted', `Order value ${money(row.order_value)} + GST ${row.gst_rate}%. Payment terms: ${row.payment_terms || '-'}`),
          h('label', 'Percent of order value', pct), h('label', 'Invoice type', type), h('label', 'Line description (optional)', desc)),
          [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', value: true }]);
        if (!ok) return;
        const inv = await post(`/sales_orders/${id}/invoice`, { percent: Number(pct.value), type: type.value, description: desc.value || undefined });
        location.hash = `#/view/invoices/${inv.id}`;
      }) }, '💳 Create Invoice'));
      break;
    case 'projects':
      if (can('material_approvals')) A.push(h('button.btn', { onclick: () => newRecord('material_approvals', { project_id: id }) }, '🧱 Material / Drawing Submittal'));
      if (can('stock_moves')) A.push(h('button.btn', { onclick: () => newRecord('stock_moves', { project_id: id, type: 'OUT' }) }, '🔁 Issue Material'));
      if (can('purchase_orders')) A.push(h('button.btn', { onclick: () => newRecord('purchase_orders', { project_id: id }) }, '🛒 Purchase Order'));
      if (can('service_tickets')) A.push(h('button.btn', { onclick: () => newRecord('service_tickets', { project_id: id, ...(row.customer_id ? { customer_id: row.customer_id } : {}) }) }, '🛠️ Service Ticket'));
      break;
    case 'purchase_orders': {
      const st = row.status;
      A.push(h('a.btn', { href: `#/print/po/${id}`, target: '_blank' }, '🖨 Print PO'));
      if (can(entity) && ['Draft', 'Rejected'].includes(st)) A.push(h('button.btn.primary', { onclick: go(() => post(`/purchase_orders/${id}/submit`), () => { toast('Submitted for approval'); window.dispatchEvent(new Event('approvals-changed')); reload(); }) }, 'Submit for Approval'));
      if (can(entity) && st === 'Approved') A.push(h('button.btn', { onclick: go(() => post(`/purchase_orders/${id}/status`, { status: 'Sent' }), reload) }, 'Mark as Sent'));
      if (can(entity) && ['Approved', 'Sent', 'Partially Received'].includes(st)) A.push(h('button.btn.good', { onclick: go(() => receiveDialog(row), reload) }, '📦 Receive Goods (GRN)'));
      if (can(entity) && st === 'Rejected') A.push(h('button.btn', { onclick: go(() => post(`/purchase_orders/${id}/status`, { status: 'Draft' }), reload) }, 'Back to Draft'));
      if (can(entity) && ['Draft', 'Approved', 'Sent', 'Rejected'].includes(st)) A.push(h('button.btn.danger', { onclick: go(async () => { if (await confirmBox('Cancel this PO?')) { await post(`/purchase_orders/${id}/status`, { status: 'Cancelled' }); reload(); } }) }, 'Cancel PO'));
      break;
    }
    case 'invoices':
      A.push(h('a.btn', { href: `#/print/invoice/${id}`, target: '_blank' }, '🖨 Print Invoice'));
      if (can('payments') && row.status !== 'Draft' && row.status !== 'Cancelled' && row.balance > 0) A.push(h('button.btn.primary', { onclick: () => newRecord('payments', { invoice_id: id, customer_id: row.customer_id, amount: round2(row.balance) }) }, '💰 Record Payment'));
      break;
    case 'items':
      if (can('stock_moves')) A.push(h('button.btn', { onclick: () => newRecord('stock_moves', { item_id: id, type: 'IN' }) }, '🔁 Stock In / Out'));
      break;
  }
  return A;
}

async function receiveDialog(po) {
  const lines = po.lines || [];
  const inputs = lines.map(l => h('input', { type: 'number', step: 'any', value: Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0)) }));
  const challan = h('input', { placeholder: 'Vendor challan / invoice no' });
  const date = h('input', { type: 'date', value: today() });
  const body = h('div.grid', h('div.cols-2.grid', h('label', 'Receipt date', date), h('label', 'Challan / Invoice', challan)),
    h('table.data', h('thead', h('tr', h('th', 'Item'), h('th.num', 'Ordered'), h('th.num', 'Received so far'), h('th.num', 'Receiving now'))),
      h('tbody', lines.map((l, i) => h('tr', h('td', l.description, l.item_id ? '' : h('div.muted', '(not linked to inventory: no stock entry)')), h('td.num', l.qty), h('td.num', l.received || 0), h('td', inputs[i]))))));
  const ok = await modal(`Goods receipt against ${po.po_no}`, body, [{ label: 'Cancel', value: false }, { label: 'Save receipt', cls: 'good', value: true }], { wide: true });
  if (!ok) return;
  await api(`/purchase_orders/${po.id}/receive`, { method: 'POST', body: { date: date.value, challan: challan.value, receipts: inputs.map((inp, index) => ({ index, qty: Number(inp.value) })).filter(r => r.qty > 0) } });
  clearRefCache('items');
  toast('Goods received and stock updated');
}

// ---------------------------------------------------------------- page
export async function recordView(root, entity, id) {
  const ent = ENTITIES[entity];
  if (!ent) throw new Error('Unknown module');
  if (ent.editor === 'quotation' && id !== 'new') { location.hash = `#/quotation/${id}`; return; }
  const isNew = id === 'new';
  const presets = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  let row = {};
  if (isNew) {
    for (const f of ent.fields) {
      if (f.default === undefined) continue;
      row[f.key] = f.default === 'today' ? today() : f.default === 'me' ? state.user.name : f.default;
    }
    for (const [k, v] of Object.entries(presets)) row[k] = /_id$/.test(k) || k === 'amount' ? Number(v) : v;
  } else {
    row = await api(`/${entity}/${id}`);
  }
  const locked = !isNew && LOCKED[entity]?.includes(row.status);
  const writable = canWrite(entity, state.user.role) && !locked && !(isNew && ent.noCreate);
  const inputs = {};
  const totalsOut = {};

  const grid = h('div.form-grid');
  for (const f of ent.fields) {
    if (f.hidden || f.type === 'json') continue;
    if (isNew && (f.readonly || f.computed) && row[f.key] == null) continue;
    if (f.type === 'lines') {
      const ed = linesEditor(f, row[f.key], {
        readonly: !writable,
        onTotals: t => { for (const k of ['subtotal', 'tax', 'total']) if (inputs[k]) inputs[k].el.value = t[k]; Object.assign(totalsOut, t); },
      });
      inputs[f.key] = ed;
      grid.append(h('div.span-2', h('label', f.label), ed.el));
      continue;
    }
    const w = fieldInput(f, row[f.key], { readonly: !writable });
    inputs[f.key] = w;
    const lbl = h('label', f.label, f.required ? ' *' : '', f.hint ? h('span.hint', f.hint) : null, w.el);
    if (f.span === 2) lbl.classList.add('span-2');
    if (f.type === 'ref' && row[f.key] && !isNew) {
      lbl.append(h('a', { href: recordHref(f.ref, row[f.key]), style: { fontWeight: 400 } }, 'open ›'));
    }
    grid.append(lbl);
  }

  async function save() {
    const body = {};
    for (const f of ent.fields) {
      if (!inputs[f.key] || f.readonly || f.computed) continue;
      body[f.key] = inputs[f.key].get();
    }
    // Presets for readonly-but-settable links (e.g. new payment against invoice) still need sending.
    if (isNew) for (const k of Object.keys(presets)) if (!(k in body)) body[k] = row[k];
    const missing = ent.fields.find(f => f.required && !f.readonly && inputs[f.key] && (body[f.key] === null || body[f.key] === ''));
    if (missing) throw new Error(`${missing.label} is required`);
    const saved = isNew
      ? await api(`/${entity}`, { method: 'POST', body })
      : await api(`/${entity}/${id}`, { method: 'PUT', body });
    clearRefCache(entity);
    toast('Saved');
    if (isNew) {
      // When created from another record (e.g. follow-up from an enquiry), go back to it.
      const back = Object.entries(presets).find(([k]) => k.endsWith('_id'));
      const parentField = back && ent.fields.find(f => f.key === back[0]);
      location.hash = parentField && ['followups', 'payments', 'stock_moves', 'contacts', 'material_approvals'].includes(entity)
        ? recordHref(parentField.ref, back[1])
        : recordHref(entity, saved.id);
    } else render(saved);
  }

  async function remove() {
    if (!(await confirmBox(`Delete this ${ent.singular.toLowerCase()}? This cannot be undone.`, 'Delete'))) return;
    await api(`/${entity}/${id}`, { method: 'DELETE' });
    clearRefCache(entity);
    toast('Deleted');
    location.hash = `#/list/${entity}`;
  }

  function render(r = row) {
    row = r;
    const title = isNew ? `New ${ent.singular}` : `${ent.singular}: ${r.enquiry_no || r.quote_no || r.so_no || r.po_no || r.invoice_no || r.ticket_no || r.submittal_no || r.code || r.name || r.doc_ref || fmtDate(r.date) || '#' + r.id}`;
    const statusVal = ent.statusField && r[ent.statusField];
    root.replaceChildren(
      h('div.page-head',
        h('a.btn.small', { href: `#/list/${entity}` }, '‹ Back'),
        h('h1', `${ent.icon} ${title}`), statusVal ? badge(statusVal) : null,
        locked ? h('span.muted', '🔒 locked') : null,
        h('div.actions',
          isNew ? [] : actionsFor(entity, r, () => recordView(root, entity, id)),
          writable ? h('button.btn.primary', { onclick: () => save().catch(fail) }, '💾 Save') : null,
          !isNew && isManager() && !locked ? h('button.btn.danger', { onclick: () => remove().catch(fail) }, 'Delete') : null)),
      h('div.card', grid),
      isNew ? null : h('div.muted', { style: { fontSize: '12px', marginBottom: '12px' } },
        `Created ${r.created_at || ''} by ${r.created_by || '-'}${r.updated_at ? ` · last updated ${r.updated_at}` : ''}`),
      isNew ? null : related(entity, r),
      isNew || !isManager() ? null : history(entity, id),
    );
  }

  // Ctrl+S saves
  root.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && writable) { e.preventDefault(); save().catch(fail); } };
  render();
}

function related(entity, row) {
  const box = h('div');
  for (const [other, key] of ENTITIES[entity].related || []) {
    const sec = h('div.card', h('div.page-head', { style: { marginBottom: '8px' } }, h('h2', `${ENTITIES[other].icon} ${ENTITIES[other].label}`),
      canWrite(other, state.user.role) && !ENTITIES[other].noCreate
        ? h('div.actions', h('button.btn.small', { onclick: () => newRecord(other, { [key]: row.id }).catch(fail) }, `+ Add`)) : null),
      h('div.muted', 'Loading…'));
    box.append(sec);
    api(`/${other}?${key}=${row.id}`).then(rows => {
      sec.lastChild.replaceWith(rows.length ? table(other, rows, { pageSize: 10 }) : h('div.muted', 'None yet'));
    }).catch(() => sec.lastChild.replaceWith(h('div.muted', 'Could not load')));
  }
  return box;
}

function history(entity, id) {
  const box = h('details.card', h('summary', 'Change history'), h('div.timeline', 'Loading…'));
  box.addEventListener('toggle', async () => {
    if (!box.open) return;
    const rows = await api(`/audit?entity=${entity}&record_id=${id}`).catch(() => []);
    box.lastChild.replaceChildren(...(rows.length ? rows.map(a => h('div', h('b', a.action), ` · ${a.user} · ${a.at}`, a.summary ? h('div.muted', a.summary) : null)) : [h('div.muted', 'No history')]));
  });
  return box;
}
