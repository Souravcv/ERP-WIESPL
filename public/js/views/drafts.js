// My Drafts: what this login has not finished — forms typed but not saved yet (kept in this browser), and records
// saved as a draft (or sent back) that still have to be completed and submitted.
import { h, api, state, toast, fail, fmtDate, badge, confirmBox } from '../ui.js';
import { ENTITIES } from '../schema.js';
import { recordHref } from './list.js';

const PREFIX = () => `wiespl-unsaved:${state.user?.username || state.user?.name}:`;

// Unsaved form copies of this login in this browser (see keepUnsaved in form.js).
export function unsavedCopies() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(PREFIX())) continue;
      const [entity, rest] = [key.slice(PREFIX().length).split(':')[0], key.slice(PREFIX().length).split(':').slice(1).join(':')];
      if (!ENTITIES[entity]) continue;
      let d; try { d = JSON.parse(localStorage.getItem(key)); } catch { continue; }
      out.push({ key, entity, recId: rest.split('?')[0], query: rest.split('?')[1] || '', ...d });
    }
  } catch { /* storage blocked */ }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

const summary = (entity, data = {}) => {
  const lines = Array.isArray(data.lines) ? data.lines.filter(l => l.description || l.item_id || Number(l.qty)) : [];
  const first = lines[0] && String(lines[0].description || '').split('\n')[0];
  return [data.title, data.name, data.subject, data.quotation_ref && `ref ${data.quotation_ref}`, data.remarks,
    lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}${first ? `: ${first.slice(0, 50)}${lines.length > 1 ? '…' : ''}` : ''}` : null].filter(Boolean).slice(0, 2).join(' · ') || '—';
};

export async function draftsView(root) {
  const out = h('div');
  async function draw() {
    const local = unsavedCopies();
    const saved = await api('/my-drafts').catch(e => { fail(e); return []; });
    out.replaceChildren(
      h('div.card', h('h2', '💾 Typed but not saved yet'),
        h('p.muted', 'Kept in this browser on this PC while you typed (a refresh, a closed tab or an expired login does not lose them). Open one and press ↩ Restore, then Save.'),
        local.length ? h('table.data', h('thead', h('tr', ['Form', 'What', 'Typed', ''].map(x => h('th', x)))),
          h('tbody', local.map(c => {
            const href = c.recId === 'new' ? `#/edit/${c.entity}/new${c.query ? '?' + c.query : ''}` : recordHref(c.entity, c.recId);
            return h('tr', h('td', `${ENTITIES[c.entity].icon} ${c.recId === 'new' ? 'New ' + ENTITIES[c.entity].singular.toLowerCase() : `${ENTITIES[c.entity].singular} #${c.recId}`}`),
              h('td', summary(c.entity, c.data)), h('td.nowrap', `${fmtDate(String(c.at).slice(0, 10))} ${String(c.at).slice(11, 16)}`),
              h('td.nowrap', h('a.btn.small.primary', { href }, 'Open'), ' ',
                h('button.btn.small', { onclick: async () => { if (!(await confirmBox('Discard what was typed? It cannot be brought back.', 'Discard'))) return; try { localStorage.removeItem(c.key); } catch { /* blocked */ } toast('Discarded'); draw(); } }, 'Discard')));
          }))) : h('p.muted', 'Nothing unsaved.')),
      h('div.card', h('h2', '📝 Saved as draft, not finished'),
        h('p.muted', 'Records you created that are still Draft (or were sent back): complete them and submit, or delete what is not needed.'),
        saved.length ? h('table.data', h('thead', h('tr', ['Document', 'No / title', 'Status', 'Last change', ''].map(x => h('th', x)))),
          h('tbody', saved.map(r => h('tr.clickable', { onclick: () => (location.hash = recordHref(r.entity, r.id)) },
            h('td', `${ENTITIES[r.entity].icon} ${ENTITIES[r.entity].singular}`), h('td', r.label || `#${r.id}`), h('td', badge(r.status)),
            h('td.nowrap', fmtDate(String(r.updated_at || r.created_at).slice(0, 10))), h('td', h('a.btn.small', { href: recordHref(r.entity, r.id) }, 'Open')))))) : h('p.muted', 'No drafts.')));
  }
  root.replaceChildren(h('div.page-head', h('h1', '📝 My Drafts')), out);
  await draw();
}
