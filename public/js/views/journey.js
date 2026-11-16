// The order journey (public/js/journey.js): every order on a board by the phase it is in, and one order's 41 steps in
// six columns, as on the End-to-End Flow sheet. Steps tick by hand (done / not needed, with a note) or by themselves
// when the CRM already records the fact.
import { h, api, toast, fail, busy, modal, fmtDate } from '../ui.js';
import { PHASES, STEPS, RACI } from '../journey.js';

const KIND = { start: 'Start / milestone', gate: 'Approval or check', client: 'Client', vendor: 'Vendor', site: 'Site', end: 'Handover', step: 'Step' };

// a role's name, and who has it (a role nobody has yet stands out)
const roleTag = (roles, r) => { const x = roles?.[r]; const label = x?.label || r; if (!x || x.outside) return h('span.jr-role', label);
  return h('span', { class: `jr-role${x.people.length ? '' : ' nobody'}`, title: x.people.length ? x.people.join(', ') : 'No one has this role yet' }, label); };
const roleList = (roles, list) => (list?.length ? list.flatMap((r, i) => [i ? ' › ' : null, roleTag(roles, r)]) : h('span.muted', '—'));
// who does it, who approves, by when, and what must be in the CRM
const raciLines = (roles, key) => { const x = RACI[key]; if (!x) return null;
  return h('div.jr-raci', h('div', h('span.jr-rk', 'Does'), roleList(roles, x.r)), x.a.length ? h('div', h('span.jr-rk', 'Approves'), roleList(roles, x.a)) : null,
    h('div', h('span.jr-rk', 'By'), x.due), h('div', h('span.jr-rk', 'Needs'), x.doc)); };

export async function journeyView(root, id) {
  if (id === 'raci') return raciView(root);
  if (id) return detail(root, Number(id));
  const { journeys } = await api('/journeys');
  const head = h('div.page-head', h('h1', '🧭 Order Journey'), h('div.actions', h('span.muted', 'From the first enquiry to the OT handover: 6 phases, 41 steps'), h('a.btn', { href: '#/journey/raci' }, '📋 Who does what')));
  const cols = PHASES.map(p => {
    const here = journeys.filter(j => !j.done && j.phase === p.no);
    return h('div.jr-col', { style: `--ph:${p.colour}` },
      h('div.jr-colhead', h('span.jr-no', p.no), h('div', h('b', p.title), h('div.muted', p.sub)), h('span.jr-count', here.length)),
      here.length ? here.map(card) : h('p.muted.jr-empty', 'No order here'));
  });
  const done = journeys.filter(j => j.done);
  root.replaceChildren(head,
    journeys.length ? null : h('div.card', h('p.muted', 'No orders yet. Every enquiry, sales order and project gets its journey here.')),
    h('div.jr-board', cols),
    done.length ? h('div.card', h('h2', `✅ Handed over (${done.length})`), h('div.jr-done', done.map(card))) : null);
}

function card(j) {
  const pct = Math.round((j.finished / j.total) * 100);
  return h('a.jr-card', { href: `#/journey/${j.id}` },
    h('div.jr-title', j.title, j.late ? h('span.jr-late', 'Late') : null),
    j.refs.length ? h('div.muted.jr-refs', j.refs.join(' · ')) : null,
    h('div.jr-bar', h('span', { style: { width: `${pct}%` } })),
    h('div.jr-next', h('span.muted', `${j.finished}/${j.total} · next: `), j.next_title),
    j.gaps ? h('div.jr-gapnote', `${j.gaps} earlier step${j.gaps === 1 ? '' : 's'} not recorded`) : null);
}

async function detail(root, id) {
  let d;
  const draw = async () => {
    d = await api(`/journeys/${id}`);
    const pct = Math.round((d.finished / d.total) * 100);
    const head = h('div.page-head', h('h1', '🧭 ', d.title), h('div.actions', h('a.btn', { href: '#/journey/raci' }, '📋 Who does what'), h('a.btn', { href: '#/journey' }, '← All orders')));
    root.replaceChildren(head,
      h('div.card.jr-summary',
        h('div.jr-links', linkBox('Enquiry', 'enquiry', 'enquiries', 'enquiry_id'), linkBox('Sales order', 'order', 'sales_orders', 'sales_order_id'), linkBox('Project', 'project', 'projects', 'project_id')),
        h('div.jr-progress', h('div.jr-bar.big', h('span', { style: { width: `${pct}%` } })),
          h('div', h('b', `${d.finished} of ${d.total} steps`), ' · ', d.next ? h('span', 'Next: ', h('b', STEPS.find(s => s.key === d.next).title)) : h('b', 'Handed over'),
            d.late ? h('span.jr-late', 'Late') : null),
          d.gaps ? h('div.jr-gapnote', `${d.gaps} earlier step${d.gaps === 1 ? '' : 's'} not recorded: tick them, or mark them not needed`) : null)),
      h('div.jr-legend', Object.entries({ gate: 'Approval or check (work stops until it passes)', client: 'Client', vendor: 'Vendor', site: 'Site work', auto: 'Ticked by the CRM from its records' })
        .map(([k, l]) => h('span', h('i', { class: `jr-key k-${k}` }), l))),
      h('div.jr-phases', PHASES.map(p => h('section.jr-phase', { style: `--ph:${p.colour}` },
        h('div.jr-phasehead', h('span.jr-no', p.no), h('div', h('b', p.title), h('div', p.sub))),
        STEPS.filter(s => s.phase === p.no).map(stepCard)))));
  };

  const linkBox = (label, key, entity, col) => {
    const l = d.links[key];
    const change = d.can_edit ? h('button.btn.small', { type: 'button', onclick: () => pickLink(label, entity, col).catch(fail) }, l ? 'Change' : 'Link') : null;
    return h('div.jr-link', h('div.muted', label), l ? h('a', { href: `#/view/${entity}/${l.id}` }, l.label) : h('span.muted', 'none'), change);
  };
  const pickLink = async (label, entity, col) => {
    const opts = await api(`/${entity}/options`);
    const sel = h('select', h('option', { value: '' }, '— none —'), opts.map(o => h('option', { value: o.id }, o.label)));
    sel.value = d[col] || '';
    const ok = await modal(`${label} of this order`, h('div', h('p.muted', 'One order, one journey. A record that has a journey of its own is moved into this one, with its ticks.'), sel),
      [{ label: 'Cancel', value: false }, { label: 'Save', cls: 'primary', value: true }]);
    if (!ok) return;
    const r = await api(`/journeys/${id}/links`, { method: 'PUT', body: { [col]: sel.value || null } });
    if (r.removed) { toast('Nothing is linked any more: the journey was removed'); location.hash = '#/journey'; return; }
    toast('Saved'); await draw();
  };

  const tick = async (key, status, title) => {
    let note = '';
    if (status !== 'open') {
      const box = h('textarea', { rows: 3, placeholder: status === 'na' ? 'Why it is not needed (optional)' : 'A note: date, document no., remarks (optional)' });
      const ok = await modal(status === 'na' ? `Not needed: ${title}` : `Done: ${title}`, h('div', box), [{ label: 'Cancel', value: false }, { label: status === 'na' ? 'Not needed' : '✓ Done', cls: 'primary', value: true }]);
      if (!ok) return;
      note = box.value;
    }
    await api(`/journeys/${id}/steps/${key}`, { method: 'POST', body: { status, note } });
    await draw();
  };
  // what one step (or a part of it) shows: its state, where it came from, and the buttons
  const state = (x, key, title) => {
    const chip = x.gap ? h('span.jr-chip.gap', 'Not recorded') : x.status === 'done' ? h('span.jr-chip.ok', x.auto ? '✓ CRM' : '✓ Done') : x.status === 'na' ? h('span.jr-chip.na', 'Not needed') : null;
    const info = x.auto && x.fact ? h('div.jr-fact', h('a', { href: x.fact.href }, x.fact.text), x.date ? ` · ${fmtDate(x.date)}` : '')
      : x.status !== 'open' ? h('div.jr-fact', `${x.by || ''}${x.at ? ` · ${fmtDate(x.at.slice(0, 10))}` : ''}`, x.note ? h('div', `“${x.note}”`) : null) : null;
    const due = x.due ? h('div', { class: x.late ? 'jr-late' : 'muted' }, `Due ${fmtDate(x.due)}`) : null;
    const btns = !d.can_edit || x.auto ? null : x.status === 'open'
      ? h('div.jr-btns', h('button.btn.small.primary', { type: 'button', onclick: busy(() => tick(key, 'done', title)) }, '✓ Done'), h('button.btn.small', { type: 'button', onclick: busy(() => tick(key, 'na', title)) }, 'Not needed'))
      : h('div.jr-btns', h('button.btn.small', { type: 'button', onclick: busy(() => tick(key, 'open', title)) }, 'Undo'));
    return [chip, info, due, btns];
  };
  const stepCard = s => {
    const x = d.steps[s.key];
    const n = Number(s.key.slice(1));
    return h('div', { class: `jr-step k-${s.kind}${s.gate ? ' k-gate' : ''} st-${x.status}${s.key === d.next ? ' is-next' : ''}${x.gap ? ' is-gap' : ''}` },
      h('div.jr-steph', h('span.jr-sno', n), h('b', s.title), s.subs ? null : state(x, s.key, s.title)[0]),
      h('div.jr-who', s.who, s.kind !== 'step' ? ` · ${KIND[s.kind]}` : ''),
      h('div.jr-hint', s.hint),
      s.subs ? null : raciLines(d.roles, s.key),
      s.subs ? h('div.jr-subs', x.subs.map(p => h('div', { class: `jr-sub st-${p.status}` }, h('div.jr-steph', h('span', p.title), state(p, p.key, p.title)[0]), h('div.jr-who', p.who), raciLines(d.roles, p.key), ...state(p, p.key, p.title).slice(1))))
        : s.derived ? h('div.jr-fact', x.status === 'open' ? 'Ticks itself when all five release items are done' : 'All five release items are done')
          : state(x, s.key, s.title).slice(1));
  };
  await draw();
}

// the RACI of every step: who does it, who approves (in order), who gives input, who is told, the deadline, the document
async function raciView(root) {
  const { roles } = await api('/journeys');
  const rows = STEPS.flatMap(st => (st.subs ? st.subs.map(x => ({ ...x, no: `${st.key.slice(1)} · ${x.title}`, phase: st.phase, key: x.key })) : [{ ...st, no: `${st.key.slice(1)} · ${st.title}` }]));
  const empty = Object.entries(roles).filter(([, x]) => !x.outside && !x.people.length);
  const used = new Set(Object.values(RACI).flatMap(x => [...x.r, ...x.a, ...x.c, ...x.i]));
  const missing = empty.filter(([k]) => used.has(k));
  root.replaceChildren(h('div.page-head', h('h1', '📋 Who does what'), h('div.actions', h('a.btn', { href: '#/journey' }, '← Order Journey'))),
    h('p.muted', 'For every step: who does it, who approves it (in this order), who gives input, who is told, the deadline and what must be in the CRM. A first draft from the Order-to-Execution guide: to be confirmed by the MD and GM. Higher authority = GM, MD or Chief Engineer.'),
    missing.length ? h('div.card', h('b', '⚠️ Roles in this chart that nobody has yet: '), missing.map(([k, x], i) => [i ? ', ' : '', x.label]), h('div.muted', 'Give the role to the right person under Admin → Users.')) : null,
    h('div.card.flush.table-wrap', h('table.data.jr-raci-table', h('thead', h('tr', ['Phase', 'Step', 'Does (R)', 'Approves (A)', 'Gives input (C)', 'Is told (I)', 'Deadline', 'Must be in the CRM'].map(t => h('th', t)))),
      h('tbody', rows.map(rw => { const x = RACI[rw.key] || {}; const ph = PHASES[rw.phase - 1];
        return h('tr', h('td', h('span.jr-dot', { style: `--ph:${ph.colour}` }), ph.no), h('td', h('b', rw.no)), h('td', roleList(roles, x.r)), h('td', roleList(roles, x.a)), h('td', roleList(roles, x.c)), h('td', roleList(roles, x.i)), h('td', x.due || ''), h('td', x.doc || '')); })))));
}
