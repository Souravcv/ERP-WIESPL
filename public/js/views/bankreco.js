// Bank reconciliation: upload the bank statement, check the suggested matches, confirm.
import { h, api, toast, fail, fmtDate } from '../ui.js';
import { inr } from '../calc.js';

export async function bankRecoView(root) {
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const out = h('div');
  const run = async () => {
    if (!file.files[0]) throw new Error('Choose the bank statement (.xlsx)');
    out.replaceChildren(h('div.muted', 'Reading the statement…'));
    const p = await api('/bank-reco/preview', { method: 'POST', raw: await file.files[0].arrayBuffer() });
    const ticks = p.matches.map(m => h('input', { type: 'checkbox', checked: m.amountOk, style: { width: 'auto' } }));
    const link = c => `#/view/${c.type}/${c.id}`;
    out.replaceChildren(
      h('p', h('b', `Statement ${fmtDate(p.from)} – ${fmtDate(p.to)}: ${p.withdrawals} withdrawals, ${p.deposits} deposits · ${p.matches.length} matched · ${p.bankOnly.length} not in the CRM · ${p.crmOnly.length} CRM entries not in the statement`)),
      h('div.card', h('h2', `✓ Matches (${p.matches.length})`), p.matches.length ? h('table.data', h('thead', h('tr', ['', 'Bank date', 'Narration', 'Bank ₹', 'CRM entry', 'CRM ₹', 'Matched by'].map(x => h('th', x)))),
        h('tbody', p.matches.map((m, i) => h('tr', h('td', ticks[i]), h('td.nowrap', fmtDate(m.bank.date)), h('td', { style: { maxWidth: '320px', fontSize: '12px' } }, m.bank.narration),
          h('td.num', { style: { color: m.bank.dir === 'in' ? 'var(--good)' : '' } }, `${m.bank.dir === 'in' ? '+ ' : '− '}${inr(m.bank.amount)}`), h('td', h('a', { href: link(m.crm), target: '_blank' }, `${m.crm.no} ${m.crm.party || ''}`), h('div.muted', { style: { fontSize: '11px' } }, `${fmtDate(m.crm.date)} ${m.crm.reference || ''}`)),
          h('td.num', { style: { color: m.amountOk ? '' : 'var(--bad)' } }, inr(m.crm.amount)), h('td', m.how, m.amountOk ? '' : h('div', { style: { color: 'var(--bad)', fontSize: '11px' } }, 'amounts differ – check')))))) : h('p.muted', 'No matches'),
        p.matches.length ? h('button.btn.primary', { style: { marginTop: '10px' }, onclick: async () => {
          const sel = p.matches.filter((m, i) => ticks[i].checked).map(m => ({ type: m.crm.type, id: m.crm.id, date: m.bank.date }));
          try { const r = await api('/bank-reco/confirm', { method: 'POST', body: { matches: sel } }); toast(`${r.reconciled} entr${r.reconciled === 1 ? 'y' : 'ies'} reconciled`); run().catch(fail); } catch (e) { fail(e); }
        } }, '✔ Confirm ticked matches') : null),
      h('div.card', h('h2', `🏦 In the bank but not in the CRM (${p.bankOnly.length})`), h('p.muted', 'Withdrawals without a payment / expense voucher, or deposits without a customer receipt in the CRM — enter them, or find out what they were.'),
        p.bankOnly.length ? h('table.data', h('thead', h('tr', ['Date', 'Narration', 'Ref', 'Out / In'].map(x => h('th', x)))),
          h('tbody', p.bankOnly.map(b => h('tr', h('td.nowrap', fmtDate(b.date)), h('td', { style: { fontSize: '12px' } }, b.narration), h('td', b.ref), h('td.num', { style: { color: b.dir === 'in' ? 'var(--good)' : '' } }, `${b.dir === 'in' ? '+ ' : '− '}${inr(b.amount)}`))))) : h('p.muted', 'None ✓')),
      h('div.card', h('h2', `💸 In the CRM but not in this statement (${p.crmOnly.length})`), h('p.muted', 'Check the UTR / amount, or it may clear in the next statement.'),
        p.crmOnly.length ? h('table.data', h('thead', h('tr', ['Date', 'No', 'Party', 'UTR / cheque', 'Out / In'].map(x => h('th', x)))),
          h('tbody', p.crmOnly.map(c => h('tr.clickable', { onclick: () => (location.hash = link(c)) }, h('td', fmtDate(c.date)), h('td', c.no), h('td', c.party || ''), h('td', c.reference || ''), h('td.num', { style: { color: c.dir === 'in' ? 'var(--good)' : '' } }, `${c.dir === 'in' ? '+ ' : '− '}${inr(c.amount)}`))))) : h('p.muted', 'None ✓')));
  };
  root.replaceChildren(h('div.page-head', h('h1', '🏦 Bank Reconciliation'), h('div.actions', h('a.btn', { href: '#/payables' }, '💼 Payables'))),
    h('div.card', h('p', 'Download the account statement from net banking as Excel (.xlsx) and upload it. Each withdrawal is matched to a payment / expense voucher marked Paid in the CRM, each deposit to a customer receipt — by the UTR / cheque no in the narration, otherwise by the same amount within 5 days. Tick the matches you agree with and confirm.'),
      h('div.toolbar', file, h('button.btn.primary', { onclick: () => run().catch(e => { out.replaceChildren(); fail(e); }) }, 'Match'))), out);
}
