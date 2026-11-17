// News (server/news.js): new hospitals all over India (sales leads), OT & hospital technology, regulation. Headlines link
// to the publisher's site; a new hospital becomes an enquiry with one click.
import { h, api, toast, fail, busy, fmtDate } from '../ui.js';

const TABS = [['leads', '🏥 New hospitals (leads)'], ['tech', '⚙️ OT & hospital technology'], ['regulation', '📜 Rules & NABH'], ['all', '🌐 All']];
const ago = s => { if (!s) return ''; const d = Math.round((Date.now() - Date.parse(s.replace(' ', 'T'))) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

export async function newsView(root) {
  let tab = 'leads'; try { tab = sessionStorage.getItem('news-tab') || 'leads'; } catch { /* private window */ }
  const search = h('input', { type: 'search', placeholder: 'Search: city, hospital, word…', style: { minWidth: '220px' } });
  const stateSel = h('select', h('option', { value: '' }, 'All states'));
  const out = h('div');
  const tabs = h('div.tabs');
  let d;
  const load = async () => {
    const q = new URLSearchParams({ tab, ...(stateSel.value ? { state: stateSel.value } : {}), ...(search.value.trim() ? { q: search.value.trim() } : {}) });
    d = await api(`/news?${q}`);
    const keep = stateSel.value;
    stateSel.replaceChildren(h('option', { value: '' }, 'All states'), d.states.map(s => h('option', { value: s.state }, `${s.state} (${s.n})`)));
    stateSel.value = keep;
    draw();
  };
  const act = (n, status) => busy(async () => { await api(`/news/${n.id}/status`, { method: 'POST', body: { status } }); toast(status === 'dismissed' ? 'Hidden' : 'Marked'); await load(); });
  const enquire = n => busy(async () => {
    const r = await api(`/news/${n.id}/enquiry`, { method: 'POST' });
    toast(r.existing ? 'Already an enquiry' : 'Enquiry made: add the contact and grade it');
    location.hash = `#/edit/enquiries/${r.enquiry_id}`;
  });
  const card = n => h('div', { class: `nw-item${n.status === 'lead' ? ' lead' : ''}` },
    h('div.nw-meta', n.topic === 'leads' ? h('span.nw-tag.lead', 'New hospital') : n.topic === 'regulation' ? h('span.nw-tag.rule', 'Rules') : h('span.nw-tag', n.topic === 'ot' ? 'OT / hospital' : 'Medical devices'),
      n.place || n.state ? h('span.nw-place', `📍 ${[n.place, n.state].filter(Boolean).join(', ')}`) : null, h('span.muted', `${n.source || ''} · ${n.published ? fmtDate(n.published.slice(0, 10)) : ago(n.found_at)}`)),
    h('a.nw-title', { href: n.url, target: '_blank', rel: 'noopener noreferrer' }, n.title),
    n.snippet && !n.snippet.startsWith(n.title.slice(0, 30)) ? h('div.nw-snip', n.snippet.slice(0, 220)) : null,
    h('div.nw-btns',
      n.topic === 'leads' && d.can_enquire ? (n.enquiry_id ? h('a.btn.small', { href: `#/edit/enquiries/${n.enquiry_id}` }, '📇 Open the enquiry') : h('button.btn.small.primary', { type: 'button', onclick: enquire(n) }, '➕ Make an enquiry')) : null,
      h('a.btn.small', { href: n.url, target: '_blank', rel: 'noopener noreferrer' }, 'Read ↗'),
      n.status !== 'lead' ? h('button.btn.small', { type: 'button', title: 'Not useful: hide it', onclick: act(n, 'dismissed') }, 'Hide') : null));
  const draw = () => {
    tabs.replaceChildren(...TABS.map(([k, label]) => h('button', { type: 'button', class: `tab${k === tab ? ' active' : ''}`, onclick: () => { tab = k; try { sessionStorage.setItem('news-tab', k); } catch { /* ignore */ } load().catch(fail); } },
      label, d.counts[k === 'tech' ? 'ot' : k] ? h('span.count', d.counts[k === 'tech' ? 'ot' : k]) : null)));
    const st = d.status;
    const broken = st?.feeds?.filter(f => !f.ok) || [];
    out.replaceChildren(
      d.rows.length ? h('div.nw-list', d.rows.map(card)) : h('div.card', h('p.muted', st ? 'Nothing here yet for this choice.' : 'The first news is being read: it takes a few minutes after the CRM starts.')),
      h('p.muted', { style: { fontSize: '12px' } }, st ? `Read ${st.at} from ${st.feeds.length} sources${broken.length ? ` · not reached: ${broken.map(f => f.feed).join(', ')}` : ''}. ` : '',
        'Only public news is read; nothing from the CRM is sent out. Headlines open on the publisher\'s site.'));
  };
  search.onkeydown = e => { if (e.key === 'Enter') load().catch(fail); };
  stateSel.onchange = () => load().catch(fail);
  await load();
  root.replaceChildren(h('div.page-head', h('h1', '📰 News'), h('div.actions',
    d.can_refresh ? h('button.btn', { type: 'button', title: 'Read all sources now (about a minute)', onclick: busy(async () => { toast('Reading the news…'); const r = await api('/news/refresh', { method: 'POST' }); toast(r.busy ? 'Already reading' : `${r.added} new item(s)`); await load(); }) }, '↻ Refresh now') : null)),
    h('p.muted', 'New hospitals all over India (to follow up as enquiries), OT and hospital technology, and the rules (NABH, Medical Devices Rules). Read every 6 hours.'),
    tabs, h('div.toolbar', search, stateSel), out);
}
