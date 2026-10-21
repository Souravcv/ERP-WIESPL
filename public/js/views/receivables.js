// Receivables: what customers owe by age, each customer's statement, the receipts register and the TDS customers deducted.
import { h, api, fmtDate, refOptions, today } from '../ui.js';
import { inr } from '../calc.js';
import { itemPicker } from './form.js';

const rs = v => (v ? `₹ ${inr(v, 0)}` : '');
const TABS = [['ageing', '⏳ Ageing'], ['statement', '📒 Customer statement'], ['receipts', '💰 Receipts register'], ['tds', '🧾 TDS by customers']];
const kpi = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, v || '₹ 0'), sub ? h('div.sub', sub) : null);
const fy0 = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };

export async function receivablesView(root, tab = 'ageing', arg) {
  const head = h('div.page-head', h('h1', '📒 Receivables'), h('div.actions',
    h('a.btn', { href: '#/list/invoices' }, '💳 Invoices'), h('a.btn', { href: '#/list/payments' }, '💰 Receipts'),
    h('a.btn', { href: '#/list/credit_notes' }, '↩️ Credit Notes'), h('a.btn', { href: '#/bank-reco' }, '🏦 Bank reconciliation')));
  const tabs = h('div.tabs', TABS.map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { location.hash = `#/receivables/${k}`; } }, l)));
  const box = h('div', h('div.muted', 'Loading…'));
  root.replaceChildren(head, tabs, box);
  if (tab === 'statement') return statement(box, arg);
  if (tab === 'receipts') return register(box, false);
  if (tab === 'tds') return register(box, true);
  return ageing(box);
}

async function ageing(box) {
  const [customers, projects] = await Promise.all([refOptions('customers'), refOptions('projects')]);
  let customerId = null, projectId = null;
  const out = h('div');
  const load = async () => {
    const q = new URLSearchParams({ ...(customerId ? { customer_id: customerId } : {}), ...(projectId ? { project_id: projectId } : {}) });
    const d = await api(`/receivables/ageing?${q}`);
    const t = d.totals;
    const cols = [['not_due', 'Not due'], ['d30', '1–30 days'], ['d60', '31–60'], ['d90', '61–90'], ['d90p', '90+ days']];
    const open = new Set();
    const body = h('tbody');
    const draw = () => body.replaceChildren(...d.customers.flatMap(c => [
      h('tr.clickable', { onclick: () => { open.has(c.customer_id) ? open.delete(c.customer_id) : open.add(c.customer_id); draw(); } },
        h('td', open.has(c.customer_id) ? '▾ ' : '▸ ', h('a', { href: `#/receivables/statement/${c.customer_id}`, onclick: e => e.stopPropagation() }, c.customer || '')),
        ...cols.map(([k]) => h('td.num', { style: { color: k === 'd90p' && c[k] ? 'var(--bad)' : k !== 'not_due' && c[k] ? 'var(--warn)' : '' } }, rs(c[k]))),
        h('td.num', rs(c.retention)), h('td.num', h('b', rs(c.total))), h('td.num', { style: { color: 'var(--good)' } }, c.advance ? `− ${rs(c.advance)}` : ''), h('td.num', h('b', rs(c.net)))),
      ...(open.has(c.customer_id) ? c.invoices.map(i => h('tr.clickable', { style: { background: 'var(--bg)' }, onclick: () => (location.hash = `#/view/invoices/${i.id}`) },
        h('td', { style: { paddingLeft: '28px', fontSize: '12px' } }, `${i.invoice_no} · ${fmtDate(i.date)}${i.milestone ? ' · ' + i.milestone : ''}`, h('div.muted', { style: { fontSize: '11px' } }, `due ${fmtDate(i.due_date)}${i.days > 0 && i.due_now > 0.5 ? ` · ${i.days} days late` : ''} · ${i.status}`)),
        ...cols.map(([k]) => h('td.num', { style: { fontSize: '12px' } }, i.bucket === k ? rs(i.due_now) : '')),
        h('td.num', { style: { fontSize: '12px' } }, rs(i.retention_held)), h('td.num', { style: { fontSize: '12px' } }, rs(i.balance)), h('td'), h('td'))) : []),
    ]));
    draw();
    out.replaceChildren(
      h('div.kpis', kpi('Receivable', rs(t.total), 'issued tax invoices not yet settled'), kpi('Overdue', rs(t.overdue), 'past the due date', t.overdue ? 'var(--bad)' : null),
        kpi('90+ days', rs(t.d90p), '', t.d90p ? 'var(--bad)' : null), kpi('Retention held', rs(t.retention), 'not yet due'),
        kpi('Advances not adjusted', rs(t.advance), 'received, no invoice yet', t.advance ? 'var(--good)' : null), kpi('Net receivable', rs(t.net))),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Customer', ...cols.map(c => c[1]), 'Retention', 'Total', 'Advance', 'Net'].map(x => h('th', x)))), body,
        h('tfoot', h('tr', h('td', h('b', `${d.customers.length} customer(s)`)), ...cols.map(([k]) => h('td.num', h('b', rs(t[k])))), h('td.num', h('b', rs(t.retention))), h('td.num', h('b', rs(t.total))),
          h('td.num', h('b', t.advance ? `− ${rs(t.advance)}` : '')), h('td.num', h('b', rs(t.net)))))))),
      h('p.muted', `As on ${fmtDate(d.as_of)}. Age = days past the invoice due date. Settled = amount received + TDS deducted by the customer + credit notes + advances adjusted. Retention counts as due from its retention date. Click a customer for the invoices.`));
  };
  box.replaceChildren(h('div.toolbar', h('span', { style: { minWidth: '260px' } }, itemPicker(customers, null, { onPick: id => { customerId = id; load(); } })),
    h('span', { style: { minWidth: '260px' } }, itemPicker(projects, null, { onPick: id => { projectId = id; load(); } })), h('button.btn', { onclick: () => window.print() }, '🖨 Print')), out);
  await load();
}

async function statement(box, customerId) {
  const customers = await refOptions('customers');
  const picker = itemPicker(customers, customerId ? Number(customerId) : null, { onPick: id => { if (id) location.hash = `#/receivables/statement/${id}`; } });
  if (!customerId) { box.replaceChildren(h('div.toolbar', h('span', { style: { minWidth: '320px' } }, picker)), h('div.card', h('p', 'Choose a customer for the statement of account: invoices, credit notes and money received (with TDS), and the balance after each entry.'))); return; }
  const from = h('input', { type: 'date' }), to = h('input', { type: 'date', value: today() });
  const out = h('div');
  const load = async () => {
    const q = new URLSearchParams({ ...(from.value ? { from: from.value } : {}), ...(to.value ? { to: to.value } : {}) });
    const d = await api(`/customer-statement/${customerId}?${q}`);
    const t = d.totals, a = d.ageing;
    out.replaceChildren(
      h('div.card', h('div', { style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' } },
        h('div', h('h2', { style: { margin: 0 } }, d.customer.name), h('div.muted', [d.customer.gstin && `GSTIN ${d.customer.gstin}`, d.customer.pan && `PAN ${d.customer.pan}`, d.customer.phone].filter(Boolean).join(' · ')),
          h('div.muted', { style: { whiteSpace: 'pre-wrap' } }, d.customer.address || '')),
        h('div', { style: { textAlign: 'right' } }, h('b', 'Statement of account'), h('div.muted', `${d.from ? fmtDate(d.from) : 'From the start'} – ${fmtDate(d.to)}`)))),
      h('div.kpis', kpi('Opening balance', rs(d.opening) || '₹ 0'), kpi('Invoiced', rs(t.invoiced)), kpi('Received + credit notes', rs(t.credited), t.tds ? `incl. TDS ${rs(t.tds)}` : ''),
        kpi('Balance', `₹ ${inr(t.closing, 0)}`, t.closing < 0 ? 'advance with us' : '', t.closing > 0 ? 'var(--warn)' : null),
        a ? kpi('Overdue', rs(a.overdue), a.retention ? `retention held ${rs(a.retention)}` : '', a.overdue ? 'var(--bad)' : null) : null),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Entry', 'Reference', 'Debit (+)', 'Credit (−)', 'of which TDS', 'Balance'].map(x => h('th', x)))),
        h('tbody', d.opening ? h('tr', h('td'), h('td', h('b', 'Opening balance')), h('td'), h('td'), h('td'), h('td'), h('td.num', h('b', `₹ ${inr(d.opening, 0)}`))) : null,
          d.entries.map(e => h('tr.clickable', { onclick: () => (location.hash = e.link) }, h('td.nowrap', fmtDate(e.date)),
            h('td', { style: { color: { Receipt: 'var(--good)', 'Credit note': 'var(--bad)' }[e.kind] || '', fontWeight: 600 } }, e.kind), h('td', e.ref, e.due ? h('div.muted', { style: { fontSize: '11px' } }, `due ${fmtDate(e.due)}`) : null),
            h('td.num', rs(e.debit)), h('td.num', rs(e.credit)), h('td.num', rs(e.tds)), h('td.num', h('b', `₹ ${inr(e.balance, 0)}`)))))))),
      h('p.muted', 'Receipts are shown with the TDS the customer deducted (it settles the invoice). Cancelled invoices and reversed receipts are left out.'));
  };
  from.onchange = load; to.onchange = load;
  box.replaceChildren(h('div.toolbar', h('span', { style: { minWidth: '320px' } }, picker), h('span.muted', 'From'), from, h('span.muted', 'to'), to, h('button.btn', { onclick: () => window.print() }, '🖨 Print')), out);
  await load();
}

async function register(box, tdsOnly) {
  const [customers, projects] = await Promise.all([refOptions('customers'), refOptions('projects')]);
  const f = { from: h('input', { type: 'date', value: fy0() }), to: h('input', { type: 'date', value: today() }),
    status: h('select', { style: { width: 'auto' } }, ['Received', 'Reversed'].map(x => h('option', x))) };
  let customerId = null, projectId = null;
  const out = h('div');
  const load = async () => {
    const q = new URLSearchParams({ from: f.from.value, to: f.to.value, status: f.status.value, ...(tdsOnly ? { tds_only: '1' } : {}), ...(customerId ? { customer_id: customerId } : {}), ...(projectId ? { project_id: projectId } : {}) });
    const d = await api(`/receipts-register?${q}`);
    const t = d.totals;
    const cols = tdsOnly ? ['Date', 'Receipt', 'Customer', 'PAN', 'Against', 'Section', 'Received', 'TDS', 'Form 16A']
      : ['Date', 'Receipt', 'Customer', 'Against', 'Project', 'Received', 'TDS', 'Mode', 'UTR / Cheque', 'Bank'];
    out.replaceChildren(h('p', h('b', tdsOnly ? `${d.rows.length} receipt(s) with TDS · TDS ${rs(t.tds) || '₹ 0'} · Form 16A pending on ${t.form16a_pending}`
      : `${d.rows.length} receipt(s) · received ${rs(t.amount) || '₹ 0'} · TDS ${rs(t.tds) || '₹ 0'} · settled ${rs(t.settled) || '₹ 0'}`)),
      h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', cols.map(x => h('th', x)))),
        h('tbody', d.rows.map(r => {
          const against = r.kind === 'Against invoice' ? r.invoice_no : `advance · ${r.so_no || ''}`;
          return h('tr.clickable', { onclick: () => (location.hash = `#/view/payments/${r.id}`) }, ...(tdsOnly
            ? [h('td.nowrap', fmtDate(r.date)), h('td.nowrap', r.receipt_no), h('td', r.customer || ''), h('td', r.pan || h('span.muted', '—')), h('td', against), h('td', r.tds_section || ''),
              h('td.num', rs(r.amount)), h('td.num', rs(r.tds_amount)), h('td', r.form16a === 'Yes' ? '✓ received' : h('span', { style: { color: 'var(--warn)' } }, 'pending'))]
            : [h('td.nowrap', fmtDate(r.date)), h('td.nowrap', r.receipt_no), h('td', r.customer || ''), h('td', against), h('td', r.project || ''), h('td.num', rs(r.amount)), h('td.num', rs(r.tds_amount)),
              h('td', r.mode || ''), h('td', r.reference || ''), h('td', r.bank_date ? `✓ ${fmtDate(r.bank_date)}` : h('span.muted', '—'))]));
        }))))),
      tdsOnly ? h('p.muted', 'Match this with Form 26AS / AIS every quarter; mark Form 16A as received on the receipt when the customer sends it.') : null);
  };
  for (const el of Object.values(f)) el.onchange = load;
  box.replaceChildren(h('div.toolbar', h('span.muted', 'From'), f.from, h('span.muted', 'to'), f.to, f.status,
    h('span', { style: { minWidth: '220px' } }, itemPicker(customers, null, { onPick: id => { customerId = id; load(); } })),
    h('span', { style: { minWidth: '220px' } }, itemPicker(projects, null, { onPick: id => { projectId = id; load(); } }))), out);
  await load();
}
