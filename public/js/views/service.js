// Service dashboard: open complaints (age, person, instrument), AMC / warranty (visits due, renewals, warranty ending,
// particle count), work orders, reports and RCAs; imports of the Excel complaint and AMC registers.
import { h, api, fmtDate, state, toast, fail, modal } from '../ui.js';
import { canWrite } from '../schema.js';
import { inr } from '../calc.js';
import { newRecord } from './list.js';

const kpi = (l, v, sub, href, c) => h(href ? 'a.kpi' : 'div.kpi', href ? { href } : {}, h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, v), sub ? h('div.sub', sub) : null);
const table = (cols, rows) => (rows.length ? h('table.data', h('thead', h('tr', cols.map(c => h('th', c)))), h('tbody', rows)) : h('p.muted', 'None'));

async function importRegister(kind) {
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const ok = await modal(kind === 'amc' ? 'Import AMC / warranty register' : 'Import complaint register', h('div.grid',
    h('p.muted', kind === 'amc' ? 'The WIESPL “AMC WARRANTY SERVICE REGISTER” workbook: one row per client system (Client ID, Hospital Name … S1–S4, Start / End of AMC, AMC Amount). Rows already in the CRM are updated.'
      : 'The WIESPL “Complaint Register” workbook (Date of Complaint, Mode, Customer Name … Solution, Date of completion). Complaints already in the CRM are skipped.'), file),
    [{ label: 'Cancel', value: false }, { label: '📥 Import', cls: 'primary', value: true }]);
  if (!ok || !file.files[0]) return false;
  const r = await api(`/service/import/${kind === 'amc' ? 'amc' : 'complaints'}`, { method: 'POST', raw: await file.files[0].arrayBuffer() });
  toast(kind === 'amc' ? `${r.added} added, ${r.updated} updated` : `${r.added} complaint(s) added, ${r.skipped} already there`);
  return true;
}

export async function serviceView(root, { embedded = false } = {}) {
  const role = state.user.role;
  const [d, stock] = await Promise.all([api('/dashboard/service'), api('/service/stock').catch(() => [])]);
  const c = d.complaints, a = d.amc;
  const head = h('div.page-head', embedded ? null : h('h1', '🛠️ Service'), h('div.actions',
    canWrite('service_tickets', role) ? h('button.btn.primary', { onclick: () => newRecord('service_tickets', {}) }, '+ Complaint') : null,
    canWrite('service_reports', role) ? h('button.btn', { onclick: () => newRecord('service_reports', {}) }, '+ Service report') : null,
    canWrite('service_work_orders', role) ? h('button.btn', { onclick: () => newRecord('service_work_orders', {}) }, '+ Work order (parts)') : null,
    canWrite('costing_sheets', role) ? h('button.btn', { onclick: () => newRecord('costing_sheets', { kind: 'Service' }) }, '🧮 Service costing') : null,
    canWrite('service_tickets', role) ? h('button.btn', { onclick: () => importRegister('complaints').then(x => x && serviceView(root, { embedded })).catch(fail) }, '📥 Complaint register') : null,
    canWrite('amc_contracts', role) ? h('button.btn', { onclick: () => importRegister('amc').then(x => x && serviceView(root, { embedded })).catch(fail) }, '📥 AMC register') : null));
  const late = s => ({ color: s ? 'var(--bad)' : '' });
  root.replaceChildren(head,
    h('div.kpis',
      kpi('Open complaints', c.open, `${c.waiting_parts} waiting for parts`, '#/list/service_tickets', c.open ? 'var(--warn)' : null),
      kpi('Open > 7 days', c.over7, 'needs follow-up', '#/list/service_tickets', c.over7 ? 'var(--bad)' : null),
      kpi('Last 30 days', `${c.new30} in · ${c.closed30} closed`, `average ${inr(c.avg_days, 1)} days to close`),
      kpi('AMC active', a.active, `₹ ${inr(a.value, 0)} a year · ${a.warranty} in warranty`, '#/list/amc_contracts'),
      kpi('Visits due this month', a.visits_due.length, `${a.visits_due.filter(v => v.late).length} overdue`, null, a.visits_due.some(v => v.late) ? 'var(--bad)' : null),
      kpi('Renewals (60 days)', a.renewals.length, 'AMC ending / ended', null, a.renewals.length ? 'var(--warn)' : null),
      kpi('Work orders pending', d.swo_pending, 'parts not dispatched', '#/list/service_work_orders'),
      kpi('Reports this month', d.reports_month, `${d.unsigned} not signed yet`, '#/list/service_reports', d.unsigned ? 'var(--warn)' : null),
      kpi('RCA due', d.rca_due.length, `${d.rca_due.filter(x => x.due_date < d.today).length} overdue (4 days)`, '#/list/rca_reports', d.rca_due.some(x => x.due_date < d.today) ? 'var(--bad)' : null),
      kpi('Not solved yet', d.revisits.length, 'revisit / parts pending', null, d.revisits.length ? 'var(--warn)' : null),
      kpi('AMC invoices', d.amc_invoices.length, 'not raised or not paid', '#/list/amc_contracts', d.amc_invoices.length ? 'var(--warn)' : null),
      kpi('Service PIs (FY)', `₹ ${inr(d.revenue_fy, 0)}`, 'AMC and service proformas')),
    h('div.card.flush', h('div', { style: { padding: '10px 16px' } }, h('h2', { style: { margin: 0 } }, '🛠️ Open complaints (oldest first)')),
      h('div.table-wrap', table(['No', 'Date', 'Hospital', 'Instrument', 'Problem', 'Assigned', 'Status', 'Days'],
        c.oldest.map(x => h('tr.clickable', { onclick: () => (location.hash = `#/view/service_tickets/${x.id}`) }, h('td.nowrap', x.no), h('td.nowrap', fmtDate(x.date)), h('td', x.hospital || ''), h('td', x.equipment || ''),
          h('td', { style: { maxWidth: '320px' } }, String(x.complaint || '').slice(0, 120)), h('td', x.assigned_to || ''), h('td', x.status), h('td.num', { style: late(x.days > 7) }, x.days)))))),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' } },
      d.rca_due.length ? h('div.card', h('h2', '🔍 RCA to fill (4 days after a breakdown)'), table(['Due', 'Hospital', 'By'],
        d.rca_due.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/rca_reports/${v.id}`) }, h('td.nowrap', { style: late(v.due_date < d.today) }, fmtDate(v.due_date)), h('td', v.hospital || ''), h('td', v.action_by || ''))))) : null,
      d.revisits.length ? h('div.card', h('h2', '🔁 Not solved yet'), table(['Revisit', 'Hospital', 'Next step', 'Engineer'],
        d.revisits.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/service_reports/${v.id}`) }, h('td.nowrap', { style: late(v.revisit_date && v.revisit_date < d.today) }, fmtDate(v.revisit_date) || '—'), h('td', v.hospital || ''), h('td', String(v.next_action || v.result || '').slice(0, 80)), h('td', v.attended_by || ''))))) : null,
      d.amc_invoices.length ? h('div.card', h('h2', '🧾 AMC invoices pending'), table(['Hospital', 'Amount', 'Invoice'],
        d.amc_invoices.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/amc_contracts/${v.id}`) }, h('td', v.hospital), h('td.num', v.amount ? `₹ ${inr(v.amount, 0)}` : ''), h('td', { style: late(v.invoice === 'Not raised') }, v.invoice))))) : null,
      d.chargeable_unpaid.length ? h('div.card', h('h2', '💰 Chargeable calls – payment'), table(['Complaint', 'Hospital', 'Charges', 'Payment'],
        d.chargeable_unpaid.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/service_tickets/${v.id}`) }, h('td.nowrap', v.no), h('td', v.hospital || ''), h('td.num', v.charges ? `₹ ${inr(v.charges, 0)}` : ''), h('td', v.payment))))) : null,
      d.breakdowns.length ? h('div.card', h('h2', '🚨 Breakdown calls used (AMC)'), table(['Hospital', 'Used'],
        d.breakdowns.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/amc_contracts/${v.id}`) }, h('td', v.hospital), h('td', v.used))))) : null,
      h('div.card', h('h2', '📦 Our Service stock'), stock.length ? table(['Material', 'We hold'], stock.slice(0, 15).map(r => h('tr', h('td', [r.code, r.name].filter(Boolean).join(' · ')), h('td.num', `${inr(r.holds, 2)} ${r.uom || ''}`))))
        : h('p.muted', 'Nothing yet: the store transfers material to “Service” (Stock Entry → Material Transfer, To: Service).')),
      h('div.card', h('h2', '📅 AMC visits due (this month and overdue)'), table(['Planned', 'Visit', 'Hospital', 'City'],
        a.visits_due.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/amc_contracts/${v.id}`) }, h('td.nowrap', { style: late(v.late) }, fmtDate(v.planned)), h('td', v.visit), h('td', v.hospital), h('td', v.city || ''))))),
      h('div.card', h('h2', '🔁 AMC renewals'), table(['AMC end', 'Hospital', 'Amount', 'Status'],
        a.renewals.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/amc_contracts/${v.id}`) }, h('td.nowrap', fmtDate(v.amc_end)), h('td', v.hospital), h('td.num', `₹ ${inr(v.amount, 0)}`), h('td', v.status))))),
      h('div.card', h('h2', '👷 Open complaints per person'), table(['Assigned', 'Open'], c.by_person.map(x => h('tr', h('td', x.key), h('td.num', x.n))))),
      h('div.card', h('h2', '⚙️ Complaints per instrument (this FY)'), table(['Instrument', 'Complaints'], c.by_instrument.map(x => h('tr', h('td', x.key), h('td.num', x.n))))),
      h('div.card', h('h2', '🛡️ Warranty ending (60 days)'), table(['Warranty end', 'Hospital'], a.warranty_ending.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/amc_contracts/${v.id}`) }, h('td', fmtDate(v.warranty_end)), h('td', v.hospital))))),
      h('div.card', h('h2', '🔬 Particle count due'), table(['Due', 'Hospital'], a.particle_due.map(v => h('tr.clickable', { onclick: () => (location.hash = `#/view/amc_contracts/${v.id}`) }, h('td', { style: late(v.particle_next < d.today) }, fmtDate(v.particle_next)), h('td', v.hospital)))))));
}
