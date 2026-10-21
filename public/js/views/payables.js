// Payables: what is owed and what is at risk per PO, each vendor's ledger, and the register of all payments.
import { h, api, badge, fmtDate, refOptions, today } from '../ui.js';
import { inr } from '../calc.js';
import { itemPicker } from './form.js';

const rs = v => (v ? `₹ ${inr(v, 0)}` : '');
const TABS = [['due', '⏰ Payables'], ['ledger', '📒 Vendor ledger'], ['register', '💸 Payments register']];

export async function payablesView(root, tab = 'due', arg) {
  const head = h('div.page-head', h('h1', '💼 Payables'), h('div.actions',
    h('a.btn', { href: '#/list/vendor_bills' }, '🧾 Vendor Bills'), h('a.btn', { href: '#/list/vendor_payments' }, '💸 Payments'),
    h('a.btn', { href: '#/list/expenses' }, '🧾 Expenses'), h('a.btn', { href: '#/bank-reco' }, '🏦 Bank reconciliation')));
  const tabs = h('div.tabs', TABS.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { location.hash = `#/payables/${k}`; } }, l)));
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(head, tabs, box);
  if (tab === 'ledger') return ledger(box, arg);
  if (tab === 'register') return register(box);
  return due(box);
}

async function due(box) {
  const [vendors, projects] = await Promise.all([refOptions('vendors'), refOptions('projects')]);
  let vendorId = null, projectId = null, only = 'open';
  const out = h('div');
  const onlySel = h('select', { style: { width: 'auto' } }, [['open', 'Still to pay'], ['now', 'Payable now'], ['overdue', 'Overdue'], ['risk', 'Advance at risk'], ['all', 'All approved POs']].map(([v, l]) => h('option', { value: v }, l)));
  const load = async () => {
    const q = new URLSearchParams({ ...(vendorId ? { vendor_id: vendorId } : {}), ...(projectId ? { project_id: projectId } : {}) });
    const d = await api(`/payables?${q}`);
    const t = d.totals;
    const keep = r => only === 'all' || (only === 'open' && r.to_pay > 0.5) || (only === 'now' && r.payable_now > 0.5) || (only === 'overdue' && r.overdue) || (only === 'risk' && r.advance_at_risk > 0.5);
    const rows = d.rows.filter(keep);
    const k = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, v), sub ? h('div.sub', sub) : null);
    out.replaceChildren(
      h('div.kpis', k('Ordered (approved POs)', rs(t.ordered)), k('Material received', rs(t.received), `${rs(t.pending_receipt)} still to come`),
        k('Billed', rs(t.billed), t.debited ? `debit notes ${rs(t.debited)}` : ''), k('Paid', rs(t.paid)),
        k('Payable now', rs(t.payable_now), 'billed & received, not paid'), k('Overdue', t.overdue, 'POs past a due date', t.overdue ? 'var(--bad)' : null),
        k('Advance at risk', rs(t.advance_at_risk), 'paid, material not received yet', t.advance_at_risk ? 'var(--warn)' : null)),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['PO', 'Vendor', 'Project', 'Ordered', 'Received', 'Billed', 'Paid', 'To pay', 'Payable now', 'Advance at risk', 'Next due'].map(x => h('th', x)))),
        h('tbody', rows.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/purchase_orders/${r.id}`) },
          h('td.nowrap', r.po_no), h('td', h('a', { href: `#/payables/ledger/${r.vendor_id}`, onclick: e => e.stopPropagation() }, r.vendor || '')), h('td', r.project || h('span.muted', 'store / general')),
          h('td.num', rs(r.total)), h('td.num', rs(r.received)), h('td.num', rs(r.billed)), h('td.num', rs(r.paid)), h('td.num', h('b', rs(r.to_pay))),
          h('td.num', rs(r.payable_now)), h('td.num', { style: { color: r.advance_at_risk ? 'var(--warn)' : '' } }, rs(r.advance_at_risk)),
          h('td.nowrap', { style: { color: r.overdue ? 'var(--bad)' : '' } }, r.next_due ? [fmtDate(r.next_due.date), h('div.muted', { style: { fontSize: '11px' } }, `${r.next_due.what || ''} ${rs(r.next_due.amount)}`)] : '')))),
        h('tfoot', h('tr', h('td', { colspan: 3 }, h('b', `${rows.length} PO(s)`)), ...['total', 'received', 'billed', 'paid', 'to_pay', 'payable_now', 'advance_at_risk'].map(k2 => h('td.num', h('b', rs(rows.reduce((s, r) => s + (r[k2] || 0), 0))))), h('td')))))));
  };
  onlySel.onchange = () => { only = onlySel.value; load(); };
  box.replaceChildren(h('div.toolbar', h('span', { style: { minWidth: '240px' } }, itemPicker(vendors, null, { onPick: id => { vendorId = id; load(); } })),
    h('span', { style: { minWidth: '240px' } }, itemPicker(projects, null, { onPick: id => { projectId = id; load(); } })), onlySel,
    h('span.muted', 'Received = material in (GRN) at the PO rate incl. GST. Payable now = billed and received, less debit notes and payments.')), out);
  await load();
}

async function ledger(box, vendorId) {
  const vendors = await refOptions('vendors');
  const picker = itemPicker(vendors, vendorId ? Number(vendorId) : null, { onPick: id => { if (id) location.hash = `#/payables/ledger/${id}`; } });
  if (!vendorId) { box.replaceChildren(h('div.toolbar', h('span', { style: { minWidth: '320px' } }, picker)), h('div.card', h('p', 'Choose a vendor to see the statement: POs, material received, bills, debit notes and payments, with the amount payable after each entry.'))); return; }
  const d = await api(`/vendor-ledger/${vendorId}`);
  const t = d.totals;
  const k = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, v), sub ? h('div.sub', sub) : null);
  box.replaceChildren(h('div.toolbar', h('span', { style: { minWidth: '320px' } }, picker), h('span.muted', [d.vendor.gstin, d.vendor.phone].filter(Boolean).join(' · ')), h('button.btn', { onclick: () => window.print() }, '🖨 Print')),
    h('div.kpis', k('Ordered', rs(t.ordered)), k('Received', rs(t.received)), k('Billed', rs(t.billed)), k('Debit notes', rs(t.debited)), k('Paid', rs(t.paid), t.tds ? `incl. TDS ${rs(t.tds)}` : ''),
      k('Payable', rs(t.payable), 'bills − debit notes − paid', t.payable > 0 ? 'var(--warn)' : null), k('Advance', rs(t.advance), 'paid beyond material received')),
    h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Entry', 'Reference', 'Ordered', 'Received', 'Bill (+)', 'Debit note (−)', 'Paid (−)', 'Payable'].map(x => h('th', x)))),
      h('tbody', d.entries.map(e => h('tr.clickable', { onclick: () => (location.hash = e.link) }, h('td.nowrap', fmtDate(e.date)), h('td', { style: { color: { Payment: 'var(--good)', Bill: 'var(--warn)', 'Debit note': 'var(--bad)' }[e.kind] || '', fontWeight: 600 } }, e.kind),
        h('td', e.ref), h('td.num', rs(e.ordered)), h('td.num', rs(e.received)), h('td.num', rs(e.bill)), h('td.num', rs(e.debit)), h('td.num', rs(e.paid)), h('td.num', h('b', `₹ ${inr(e.balance, 0)}`)))))))));
}

async function register(box) {
  const [vendors, projects] = await Promise.all([refOptions('vendors'), refOptions('projects')]);
  const fy0 = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const f = { from: h('input', { type: 'date', value: fy0 }), to: h('input', { type: 'date', value: today() }),
    status: h('select', { style: { width: 'auto' } }, ['Paid', 'Approved', 'Pending Approval', 'Reversed'].map(x => h('option', x))) };
  let vendorId = null, projectId = null;
  const out = h('div');
  const load = async () => {
    const q = new URLSearchParams({ from: f.from.value, to: f.to.value, status: f.status.value, ...(vendorId ? { vendor_id: vendorId } : {}), ...(projectId ? { project_id: projectId } : {}) });
    const d = await api(`/payments-register?${q}`);
    out.replaceChildren(h('p', h('b', `${d.rows.length} payment(s) · gross ${rs(d.total)} · TDS ${rs(d.tds) || '₹ 0'} · net ${rs(d.net)}`)),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'No', 'Paid to', 'PO / category', 'Project', 'For', 'Gross', 'TDS', 'Net', 'Mode', 'UTR / Cheque', 'Bank'].map(x => h('th', x)))),
        h('tbody', d.rows.map(r => h('tr.clickable', { onclick: () => (location.hash = r.type === 'payment' ? `#/view/vendor_payments/${r.id}` : `#/view/expenses/${r.id}`) },
          h('td.nowrap', fmtDate(r.date)), h('td.nowrap', r.no), h('td', r.party || ''), h('td', r.ref || ''), h('td', r.project || h('span.muted', 'general')), h('td', { style: { maxWidth: '220px' } }, r.what || ''),
          h('td.num', rs(r.amount)), h('td.num', rs(r.tds)), h('td.num', rs(r.net)), h('td', r.mode || ''), h('td', r.reference || ''), h('td', r.bank_date ? `✓ ${fmtDate(r.bank_date)}` : h('span.muted', '—')))))))));
  };
  for (const el of Object.values(f)) el.onchange = load;
  box.replaceChildren(h('div.toolbar', h('span.muted', 'From'), f.from, h('span.muted', 'to'), f.to, f.status,
    h('span', { style: { minWidth: '220px' } }, itemPicker(vendors, null, { onPick: id => { vendorId = id; load(); } })),
    h('span', { style: { minWidth: '220px' } }, itemPicker(projects, null, { onPick: id => { projectId = id; load(); } }))), out);
  await load();
}
