// 📜 Company Policies (everyone): the policies the admin has sent, with their files, and "I have read it".
// The admin also sees how many have read each one (server/policies.js).
import { h, api, toast, busy, fmtDate } from '../ui.js';

export async function policiesView(root) {
  const d = await api('/policies');
  const card = p => h('div.card', { style: { borderLeft: `4px solid ${p.read_at ? 'var(--good)' : 'var(--warn)'}` } },
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
      h('h2', { style: { margin: 0 } }, p.title), p.version ? h('span.muted', p.version) : null, h('span.badge', p.category || 'General'),
      h('span.muted', { style: { marginLeft: 'auto', fontSize: '12px' } }, [p.effective_date && `effective ${fmtDate(p.effective_date)}`, p.sent_at && `sent ${fmtDate(p.sent_at.slice(0, 10))}`].filter(Boolean).join(' · '))),
    p.summary ? h('p', { style: { whiteSpace: 'pre-wrap', margin: '10px 0' } }, p.summary) : null,
    p.files.length ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '6px 0' } },
      p.files.map(f => h('a.btn.small', { href: `/api/files/${f.id}?inline=1`, target: '_blank', rel: 'noopener' }, `📄 ${f.filename}`))) : null,
    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' } },
      p.read_at ? h('span', { style: { color: 'var(--good)', fontWeight: 600 } }, `✔ You confirmed reading it on ${fmtDate(p.read_at.slice(0, 10))}`)
        : h('button.btn.good', { onclick: busy(async () => { await api(`/policies/${p.id}/read`, { method: 'POST' }); toast('Thank you: recorded'); await policiesView(root); }) }, '✔ I have read it'),
      p.readers ? h('a', { href: `#/view/company_policies/${p.id}`, style: { marginLeft: 'auto', fontSize: '13px' }, title: p.readers.pending.length ? `Not yet: ${p.readers.pending.join(', ')}` : '' },
        `Read by ${p.readers.read} of ${p.readers.total}${p.readers.pending.length ? ` · ${p.readers.pending.length} not yet` : ''}`) : null));
  const pending = d.policies.filter(p => !p.read_at).length;
  root.replaceChildren(
    h('div.page-head', h('h1', '📜 Company Policies'), d.manage ? h('div.actions', h('a.btn.primary', { href: '#/list/company_policies' }, '⚙ Manage & send policies')) : null),
    h('p.muted', pending ? `${pending} polic${pending === 1 ? 'y' : 'ies'} waiting for you: open the file, read it, then press “I have read it”.` : 'The company policies sent to you. Open the file to read the full policy.'),
    d.policies.length ? h('div', { style: { display: 'grid', gap: '12px' } }, [...d.policies].sort((a, b) => (a.read_at ? 1 : 0) - (b.read_at ? 1 : 0)).map(card))
      : h('div.card', h('div.empty', d.manage ? 'No policy has been sent yet. Use “Manage & send policies” to add one, attach its PDF and send it.' : 'No company policy has been sent to you yet.')));
}
