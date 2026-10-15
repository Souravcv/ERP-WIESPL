// "My tasks": what is waiting for the logged-in person, grouped, oldest / most urgent first.
import { h, api, fmtDate } from '../ui.js';

export async function tasksView(root) {
  const r = await api('/my-tasks');
  root.replaceChildren(
    h('div.page-head', h('h1', '✅ My tasks'), h('div.actions', h('button.btn', { onclick: () => tasksView(root) }, '↻ Refresh'))),
    r.count ? h('p.muted', `${r.count} thing(s) waiting for you. Click one to open it.`) : h('div.card', h('p', '🎉 Nothing is waiting for you right now.')),
    r.groups.map(g => h('div.card', { style: { marginBottom: '14px' } },
      h('h2', `${g.icon} ${g.title} `, h('span.muted', `(${g.items.length})`)),
      h('div', g.items.map(t => h('a', { href: t.link, style: { display: 'flex', gap: '12px', alignItems: 'baseline', padding: '8px 4px', borderTop: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' } },
        h('span', { style: { flex: '1' } }, h('b', t.title), t.sub ? h('div.muted', { style: { fontSize: '12px' } }, t.sub) : null),
        t.late ? h('span.badge.bad', 'late') : t.due ? h('span.muted.nowrap', fmtDate(t.due)) : null))))));
}

// Number for the menu.
export async function taskCount() {
  try { return (await api('/my-tasks')).count; } catch { return 0; }
}
