// The order journey (public/js/journey.js): every order on a board by the phase it is in, and one order's 41 steps in
// six columns, as on the End-to-End Flow sheet. Steps tick by hand (done / not needed, with a note) or by themselves
// when the CRM already records the fact.
import { h, api, toast, fail, busy, modal, fmtDate, today } from '../ui.js';
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

// the deadline a step starts with: its own (from the step before), or the RACI rule counted from today
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const defaultDue = (key, due) => { if (due) return due; const rule = RACI[key]?.due || '';
  const m = rule.match(/(\d+) days?/); return addDays(today(), /same day/i.test(rule) ? 0 : m ? Number(m[1]) : 3); };

// give a step (or a part of one) to a person as a task with a deadline; resolves true when given
async function giveStep(jid, key, title, { task, due, people, roles, me, canAssign }) {
  const doers = new Set((RACI[key]?.r || []).flatMap(r => roles?.[r]?.people || []));
  const list = canAssign ? [...people].sort((a, b) => (doers.has(b.name) - doers.has(a.name)) || a.name.localeCompare(b.name)) : [{ name: me, label: 'you' }];
  const who = h('select', list.map(u => h('option', { value: u.name }, `${doers.has(u.name) ? '★ ' : ''}${u.name} (${u.label})`)));
  who.value = task?.assigned_to || list[0]?.name || '';
  const date = h('input', { type: 'date', value: task?.due_date || defaultDue(key, due) });
  const pri = h('select', ['Normal', 'High', 'Urgent', 'Low'].map(x => h('option', x))); pri.value = task?.priority || 'Normal';
  const note = h('textarea', { rows: 2, placeholder: 'What to do, or anything they should know (optional)' });
  const r = RACI[key];
  const body = h('div.form-grid', { style: { display: 'grid', gap: '8px' } },
    r ? h('div.muted', `Does it: ${(r.r || []).map(x => roles?.[x]?.label || x).join(', ')} · Deadline rule: ${r.due}`) : null,
    h('label', 'Who does it', who), canAssign ? h('div.muted', '★ = has the role that does this step') : null,
    h('label', 'Deadline', date), h('label', 'Priority', pri), h('label', 'Note', note),
    r?.doc ? h('div.muted', `They tick it Done when this is in the CRM: ${r.doc}`) : null);
  const ok = await modal(task ? `Change: ${title}` : `Give as a task: ${title}`, body, [{ label: 'Cancel', value: false }, { label: task ? 'Save' : '📌 Give', cls: 'primary', value: true }]);
  if (!ok) return false;
  await api(`/journeys/${jid}/steps/${key}/give`, { method: 'POST', body: { assigned_to: who.value, due_date: date.value, priority: pri.value, note: note.value } });
  toast(`Given to ${who.value}, due ${fmtDate(date.value)}`);
  return true;
}

export async function journeyView(root, id) {
  if (id === 'raci') return raciView(root);
  if (id === 'team') return teamView(root);
  if (id === 'dashboard') return journeyDashboard(root);
  if (id === 'guide') return guideView(root);
  if (id) return detail(root, Number(id));
  const { journeys, can_assign, pilot } = await api('/journeys');
  const head = h('div.page-head', h('h1', '🧭 Order Journey'), h('div.actions', h('span.muted', 'From the first enquiry to the OT handover: 6 phases, 41 steps'),
    h('a.btn', { href: '#/journey/guide' }, '📘 Pilot & my part'), h('a.btn', { href: '#/journey/dashboard' }, '📊 Dashboard'), can_assign ? h('a.btn', { href: '#/journey/team' }, '👥 Team') : null, h('a.btn', { href: '#/journey/raci' }, '📋 Who does what')));
  const cols = PHASES.map(p => {
    const here = journeys.filter(j => !j.done && j.phase === p.no);
    return h('div.jr-col', { style: `--ph:${p.colour}` },
      h('div.jr-colhead', h('span.jr-no', p.no), h('div', h('b', p.title), h('div.muted', p.sub)), h('span.jr-count', here.length)),
      here.length ? here.map(j => card(j, pilot)) : h('p.muted.jr-empty', 'No order here'));
  });
  const done = journeys.filter(j => j.done);
  root.replaceChildren(head,
    journeys.length ? null : h('div.card', h('p.muted', 'No orders yet. Every enquiry, sales order and project gets its journey here.')),
    h('div.jr-board', cols),
    done.length ? h('div.card', h('h2', `✅ Handed over (${done.length})`), h('div.jr-done', done.map(card))) : null);
}

function card(j, pilot) {
  const pct = Math.round((j.finished / j.total) * 100);
  return h('a.jr-card', { href: `#/journey/${j.id}` },
    h('div.jr-title', j.id === pilot ? h('span.jr-pilot', 'PILOT') : null, j.title, j.late ? h('span.jr-late', 'Late') : null),
    j.refs.length ? h('div.muted.jr-refs', j.refs.join(' · ')) : null,
    h('div.jr-bar', h('span', { style: { width: `${pct}%` } })),
    h('div.jr-next', h('span.muted', `${j.finished}/${j.total} · next: `), j.next_title),
    j.waiting ? h('div.jr-apnote', `⏳ ${j.waiting} waiting for approval`) : null,
    j.gaps ? h('div.jr-gapnote', `${j.gaps} earlier step${j.gaps === 1 ? '' : 's'} not recorded`) : null);
}

async function detail(root, id) {
  let d;
  const draw = async () => {
    d = await api(`/journeys/${id}`);
    const pct = Math.round((d.finished / d.total) * 100);
    const head = h('div.page-head', h('h1', '🧭 ', d.title), h('div.actions', d.can_assign ? h('a.btn', { href: '#/journey/team' }, '👥 Team') : null,
      h('a.btn', { href: '#/journey/raci' }, '📋 Who does what'), h('a.btn', { href: '#/journey' }, '← All orders')));
    root.replaceChildren(head,
      h('div.card.jr-summary',
        h('div.jr-links', linkBox('Enquiry', 'enquiry', 'enquiries', 'enquiry_id'), linkBox('Sales order', 'order', 'sales_orders', 'sales_order_id'), linkBox('Project', 'project', 'projects', 'project_id')),
        h('div.jr-progress', h('div.jr-bar.big', h('span', { style: { width: `${pct}%` } })),
          h('div', h('b', `${d.finished} of ${d.total} steps`), ' · ', d.next ? h('span', 'Next: ', h('b', STEPS.find(s => s.key === d.next).title)) : h('b', 'Handed over'),
            d.late ? h('span.jr-late', 'Late') : null),
          d.gaps ? h('div.jr-gapnote', `${d.gaps} earlier step${d.gaps === 1 ? '' : 's'} not recorded: tick them, or mark them not needed`) : null)),
      siteCard(),
      h('div.jr-legend', Object.entries({ gate: 'Approval or check (work stops until it passes)', client: 'Client', vendor: 'Vendor', site: 'Site work', auto: 'Ticked by the CRM from its records' })
        .map(([k, l]) => h('span', h('i', { class: `jr-key k-${k}` }), l))),
      h('div.jr-phases', PHASES.map(p => h('section.jr-phase', { style: `--ph:${p.colour}` },
        h('div.jr-phasehead', h('span.jr-no', p.no), h('div', h('b', p.title), h('div', p.sub))),
        STEPS.filter(s => s.phase === p.no).map(stepCard)))));
  };

  // the site plan of the order: make it from the dispatch day, or show it with the crew of every working day
  const siteCard = () => {
    const sp = d.site;
    if (!sp) {
      if (!d.project_id) return null;
      const date = h('input', { type: 'date', value: d.dispatch || today() });
      return h('div.card.jr-site', h('h2', '📅 Site plan'),
        h('p.muted', 'One modular OT from the one-time dispatch to handover: 15 activities, every day including Sundays (holidays off), with the crew of each. It goes into the Project Planner and gives the site steps their dates.'),
        d.can_plan ? h('div.jr-btns', h('label', 'Dispatch day (site day 1) ', date),
          h('button.btn.primary', { type: 'button', onclick: busy(async () => { await api(`/journeys/${id}/site-plan`, { method: 'POST', body: { start: date.value } }); toast('Site plan made'); await draw(); }) }, '📅 Make the site plan'))
          : h('p.muted', 'Someone who plans projects makes it.'));
    }
    const max = Math.max(1, sp.peak);
    return h('div.card.jr-site', h('div.jr-sitehead', h('h2', '📅 Site plan'),
      h('span', `${fmtDate(sp.start)} → ${fmtDate(sp.end)} · ${sp.working_days} working days · ${sp.man_days} man-days in-house${sp.unknown_days ? ` (+ ${sp.unknown_days} day${sp.unknown_days === 1 ? '' : 's'} with crew not known yet)` : ''} · peak ${sp.peak} people`),
      h('a.btn.small', { href: `#/planner/${sp.project_id}` }, 'Open in the Project Planner')),
      h('div.jr-crew', sp.days.map(x => h('div', { class: `jr-day${x.unknown ? ' unknown' : ''}`, title: `${fmtDate(x.date)}: ${x.people} in-house${x.unknown ? ' + ?' : ''}${x.vendor ? ' · vendor' : ''}${x.client ? ' · client' : ''}\n${x.work.join('\n')}` },
        h('span.jr-bar2', { style: `height:${Math.round((x.people / max) * 48) + 2}px` }), h('b', `${x.people}${x.unknown ? '?' : ''}`), h('i', x.date.slice(8)),
        x.vendor || x.client ? h('em', x.vendor ? 'V' : 'C') : null))),
      h('div.muted', 'People on site per day, Sundays included (hover a day for the work). ? = a job whose crew the site notes do not give yet: set it in the planner. V = vendor on site, C = client\'s work.'));
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

  const flat = () => { const f = {}; for (const [k, v] of Object.entries(d.steps)) { f[k] = v; for (const p of v.subs || []) f[p.key] = p; } return f; };
  // attach the step's document(s): PDF, drawing, photo, Excel …
  const addFiles = key => {
    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    input.onchange = busy(async () => {
      for (const f of input.files) {
        const res = await fetch(`/api/journeys/${id}/steps/${key}/files?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'x-file-type': f.type || 'application/octet-stream' }, body: f });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `${f.name} could not be uploaded`); }
      }
      toast(`${input.files.length} file${input.files.length === 1 ? '' : 's'} attached`); await draw();
    });
    document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
  };
  const removeFile = async (f, title) => {
    const ok = await modal(`Remove ${f.filename}?`, h('p.muted', title), [{ label: 'Cancel', value: false }, { label: 'Remove', cls: 'danger solid', value: true }]);
    if (!ok) return;
    await api(`/files/${f.id}`, { method: 'DELETE' }); toast('Removed'); await draw();
  };
  const sendForApproval = async (key, title) => {
    const needNote = flat()[key]?.need === 'note';
    const box = h('textarea', { rows: 3, placeholder: needNote ? `Required: ${RACI[key]?.doc || 'the result'}` : 'What is ready, document no., anything the approver should know (optional)' });
    const ok = await modal(`Send for approval: ${title}`, h('div', h('p.muted', `Approved in this order: ${(d.steps[key] || Object.values(d.steps).flatMap(v => v.subs || []).find(p => p.key === key))?.approval?.chain.map(c => c.label).join(' › ')}`), box),
      [{ label: 'Cancel', value: false }, { label: '📨 Send', cls: 'primary', value: true }]);
    if (!ok) return;
    await api(`/journeys/${id}/steps/${key}/approval`, { method: 'POST', body: { note: box.value } });
    toast('Sent for approval'); window.dispatchEvent(new Event('approvals-changed'));
    await draw();
  };
  const decide = async (row, decision, title) => {
    const c = h('textarea', { rows: 3, placeholder: decision === 'Rejected' ? 'What has to change' : 'Comments (optional)' });
    const ok = await modal(`${decision === 'Approved' ? 'Approve' : 'Reject'}: ${title} (${row.stage})`, h('div', c),
      [{ label: 'Cancel', value: false }, { label: decision === 'Approved' ? '✔ Approve' : '✖ Reject', cls: decision === 'Approved' ? 'good' : 'danger solid', value: true }]);
    if (!ok) return;
    if (decision === 'Rejected' && !c.value.trim()) { toast('Write what has to change', true); return; }
    await api(`/approvals/${row.id}/decide`, { method: 'POST', body: { decision, comments: c.value } });
    toast(decision); window.dispatchEvent(new Event('approvals-changed'));
    await draw();
  };
  const tick = async (key, status, title) => {
    let note = '';
    if (status !== 'open') {
      const x = flat()[key], needNote = status === 'done' && x?.need === 'note';
      const box = h('textarea', { rows: 3, placeholder: status === 'na' ? 'Why it is not needed (optional)' : needNote ? `Required: ${RACI[key]?.doc || 'the result'}` : 'A note: date, document no., remarks (optional)' });
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
    const t = x.task;
    const task = t ? h('div.jr-task', '📌 ', h('a', { href: `#/view/work_tasks/${t.id}` }, t.assigned_to), ` · ${t.task_no || 'task'} · ${t.status}`) : null;
    const give = () => giveStep(id, key, title, { task: t, due: x.due, people: d.people, roles: d.roles, me: d.me, canAssign: d.can_assign }).then(ok => ok && draw()).catch(fail);
    const mine = t && t.assigned_to?.toLowerCase() === String(d.me).toLowerCase();
    const giveBtn = !d.can_edit || x.status !== 'open' ? null : d.can_assign ? h('button.btn.small', { type: 'button', onclick: give }, t ? 'Change' : '📌 Give')
      : !t ? h('button.btn.small', { type: 'button', onclick: give }, "🙋 I'll do it") : null;
    // a gate: its approvers in order, and who decides now
    const ap = x.approval;
    const apCls = c => (c.row?.status === 'Approved' ? 'ok' : c.row?.status === 'Pending' ? 'wait' : c.row?.status === 'Rejected' && c.row === ap.rejected ? 'no' : '');
    const apLine = ap ? h('div.jr-approvals', h('span.jr-rk', 'Approval'), ap.chain.map((c, i) => [i ? ' › ' : null,
      h('span', { class: `jr-ap ${apCls(c)}`, title: c.row?.decided_by ? `${c.row.status} by ${c.row.decided_by}, ${c.row.decided_at || ''}` : '' }, `${c.row?.status === 'Approved' ? '✓ ' : c.row?.status === 'Pending' ? '⏳ ' : ''}${c.label}`)]),
      ap.rejected && x.status === 'open' && !ap.pending ? h('div.jr-late', `Rejected by ${ap.rejected.decided_by}${ap.rejected.comments ? `: “${ap.rejected.comments}”` : ''}`) : null) : null;
    const canDecide = !!ap?.pending && (d.my_role === 'admin' || String(ap.pending.approver_role || '').split(',').includes(d.my_role));
    const decideBtns = canDecide ? [h('button.btn.small.good', { type: 'button', onclick: busy(() => decide(ap.pending, 'Approved', title)) }, '✔ Approve'),
      h('button.btn.small.danger', { type: 'button', onclick: busy(() => decide(ap.pending, 'Rejected', title)) }, '✖ Reject')] : [];
    const doneBtn = ap ? (ap.pending ? h('a.btn.small', { href: `#/view/approvals/${ap.pending.id}` }, `⏳ With ${ap.pending.stage}`) : h('button.btn.small.primary', { type: 'button', onclick: busy(() => sendForApproval(key, title)) }, '📨 Send for approval'))
      : h('button.btn.small.primary', { type: 'button', onclick: busy(() => tick(key, 'done', title)) }, '✓ Done');
    const btns = x.auto ? null : x.status === 'open'
      ? h('div.jr-btns', ...decideBtns, d.can_edit ? [canDecide ? null : doneBtn, h('button.btn.small', { type: 'button', onclick: busy(() => tick(key, 'na', title)) }, 'Not needed'), giveBtn] : null)
      : d.can_edit ? h('div.jr-btns', h('button.btn.small', { type: 'button', onclick: busy(() => tick(key, 'open', title)) }, 'Undo')) : null;
    const files = x.files || [];
    const missing = x.status === 'open' && x.need === 'file' && !files.length;
    const docs = x.need === 'file' || files.length ? h('div', { class: `jr-docs${missing ? ' missing' : ''}` },
      h('span.jr-rk', '📎'), files.length ? files.map(f => h('span.jr-file', h('a', { href: `/api/files/${f.id}?inline=1`, target: '_blank', title: `${f.by || ''} · ${f.at || ''}` }, f.filename),
        d.can_edit && x.status === 'open' ? h('button.jr-x', { type: 'button', title: 'Remove', onclick: () => removeFile(f, title).catch(fail) }, '×') : null))
        : h('span', x.auto ? 'In the CRM' : 'Document not attached yet'),
      d.can_edit && !x.auto ? h('button.btn.small', { type: 'button', onclick: () => addFiles(key) }, '+ Attach') : null)
      : x.need === 'note' && x.status === 'open' ? h('div.jr-docs', h('span.jr-rk', '✍'), 'A written note when done') : null;
    const plan = x.plan ? h('div.jr-plan', '📅 ', x.plan.start === x.plan.finish ? fmtDate(x.plan.start) : `${fmtDate(x.plan.start)} → ${fmtDate(x.plan.finish)}`,
      x.plan.crew != null ? ` · crew ${x.plan.crew}` : '', x.plan.crew_note ? h('span.muted', ` (${x.plan.crew_note})`) : null, x.plan.critical ? h('b.jr-crit', ' critical') : null, x.late ? h('span.jr-late', 'Late') : null) : null;
    return [chip, info, task, plan, x.plan ? null : due, docs, apLine, mine && x.status === 'open' ? h('div.jr-mine', 'Yours') : null, btns];
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

// the team: everyone's open tasks (late first), and the next step of each order that nobody has yet
async function teamView(root) {
  const d = await api('/journeys/team');
  const draw = () => teamView(root).catch(fail);
  const row = t => h('div', { class: `jr-ttask${t.late ? ' late' : ''}` },
    h('a', { href: t.journey_id ? `#/journey/${t.journey_id}` : `#/view/work_tasks/${t.id}` }, t.journey_id ? '🧭 ' : '', t.title),
    h('span', { class: t.late ? 'jr-late' : 'muted' }, t.due_date ? ` · due ${fmtDate(t.due_date)}` : ''), h('span.muted', ` · ${t.status}`));
  root.replaceChildren(h('div.page-head', h('h1', '👥 Team'), h('div.actions', h('a.btn', { href: '#/taskboard' }, '🗂️ Task board'), h('a.btn', { href: '#/journey' }, '← Order Journey'))),
    h('p.muted', 'What everyone has open, late first. 🧭 = a step of an order journey. Below them: the next step of each order that nobody has been given yet.'),
    h('div.jr-team', d.team.length ? d.team.map(p => h('div.card.jr-person',
      h('div.jr-phead', h('b', p.name), h('span.muted', p.role), h('span.jr-counts', p.late ? h('span.jr-late', `${p.late} late`) : null, ` ${p.week} this week · ${p.tasks.length} open`)),
      p.tasks.slice(0, 12).map(row), p.tasks.length > 12 ? h('div.muted', `+ ${p.tasks.length - 12} more`) : null)) : h('p.muted', 'No open tasks.')),
    h('div.card', h('h2', `⏳ Next steps nobody has (${d.waiting.length})`),
      d.waiting.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Order', 'Step', 'Done by', ''].map(x => h('th', x)))),
        h('tbody', d.waiting.map(w => h('tr', h('td', h('a', { href: `#/journey/${w.journey_id}` }, w.order)), h('td', `${w.no}. ${w.title}`), h('td', w.does.join(', ')),
          h('td', d.can_edit ? h('button.btn.small', { type: 'button', onclick: () => giveStep(w.journey_id, w.step, w.title, { people: d.people, roles: d.roles, canAssign: true }).then(ok => ok && draw()).catch(fail) }, '📌 Give') : null))))))
        : h('p.muted', 'Every order has its next step given to someone.')));
}

// the dashboard: how the orders stand, what is late, what is due this week, approvals waiting, late steps per person
export async function journeyDashboard(root, { embedded = false } = {}) {
  const d = await api('/journeys/dashboard');
  const k = d.kpi;
  const tile = (n, label, cls = '', href = null) => h(href ? 'a' : 'div', { class: `jr-kpi ${cls}`, ...(href ? { href } : {}) }, h('b', n), h('span', label));
  const stepRow = x => h('tr', h('td', h('a', { href: `#/journey/${x.journey_id}` }, x.order)), h('td', `${x.no}. ${x.title}`),
    h('td', x.who.length ? x.who.join(', ') : h('span.muted', x.roles.join(', ') || 'client / vendor')), h('td.nowrap', x.due ? fmtDate(x.due) : ''),
    h('td.num', x.days_late ? h('b.jr-late', x.days_late) : ''));
  const max = Math.max(1, ...d.phases.map(p => p.orders));
  root.replaceChildren(
    embedded ? null : h('div.page-head', h('h1', '📊 Order Journey dashboard'), h('div.actions', h('a.btn', { href: '#/journey' }, '🧭 All orders'), h('a.btn', { href: '#/journey/team' }, '👥 Team'))),
    h('div.jr-kpis', tile(k.orders, 'orders in progress', '', '#/journey'), tile(k.late_orders, 'orders late', k.late_orders ? 'bad' : ''), tile(k.late_steps, 'steps late', k.late_steps ? 'bad' : ''),
      tile(k.due_soon, 'due in 2 days', k.due_soon ? 'warn' : ''), tile(k.approvals, `approvals waiting${k.slow_approvals ? ` (${k.slow_approvals} over 2 days)` : ''}`, k.slow_approvals ? 'warn' : '', '#/list/approvals'),
      tile(k.unassigned, 'next steps not given out', k.unassigned ? 'warn' : '', '#/journey/team'), tile(k.handed_over, 'handed over', 'ok')),
    h('div.card', h('h2', 'Orders by phase'), h('div.jr-phasebars', d.phases.map(p => h('div.jr-pb', h('span.jr-pbname', `${p.no}. ${p.title}`),
      h('span.jr-pbtrack', h('span', { style: `width:${(p.orders / max) * 100}%;background:${p.colour}` })), h('b', p.orders))))),
    h('div.card', h('h2', `🔴 Late steps (${d.late.length})`), d.late.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Order', 'Step', 'Who', 'Due', 'Days late'].map(t => h('th', t)))), h('tbody', d.late.map(stepRow))))
      : h('p.muted', 'Nothing late.')),
    d.people.length ? h('div.card', h('h2', 'Late steps per person'), h('div.jr-phasebars', d.people.map(p => h('div.jr-pb', h('span.jr-pbname', p.name),
      h('span.jr-pbtrack', h('span', { style: `width:${(p.n / Math.max(...d.people.map(x => x.n))) * 100}%;background:var(--bad,#dc2626)` })), h('b', p.n))))) : null,
    h('div.card', h('h2', `📅 Due in the next 7 days (${d.week.length})`), d.week.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Order', 'Step', 'Who', 'Due', ''].map(t => h('th', t)))), h('tbody', d.week.map(stepRow))))
      : h('p.muted', 'Nothing with a deadline this week. Steps get deadlines when they are given as tasks or from the site plan.')),
    h('div.card', h('h2', `⏳ Approvals waiting (${d.approvals.length})`), d.approvals.length ? h('div.table-wrap', h('table.data', h('thead', h('tr', ['Order', 'Step', 'With', 'Waiting'].map(t => h('th', t)))),
      h('tbody', d.approvals.map(a => h('tr', h('td', h('a', { href: `#/journey/${a.journey_id}` }, a.order)), h('td', h('a', { href: `#/view/approvals/${a.id}` }, `${a.no}. ${a.title}`)),
        h('td', a.with, a.who.length ? h('div.muted', a.who.join(', ')) : h('div.jr-late', 'nobody has this role')), h('td.nowrap', { class: a.days >= 2 ? 'jr-late' : '' }, `${a.days} day${a.days === 1 ? '' : 's'}`))))))
      : h('p.muted', 'No approvals waiting.')));
}

// the pilot checklist (for the people who lead it) and each role's part: its steps and its daily routine
const ROUTINE = [
  ['Every morning', 'Open ✅ My tasks: your journey steps, the tasks given to you, and the approvals waiting for you. Late ones are red.'],
  ['Doing a step', 'Open the order (🧭 link), do the work, attach the document (📎 + Attach), then press ✓ Done. A check or decision step asks for a written note instead.'],
  ['A gate', 'Press 📨 Send for approval. The approvers decide in order; the last approval ticks the step. If rejected, the reason comes back to you: fix it and send again.'],
  ['Approving', 'Approve or reject on the order (or in Approvals) the same day. Write what has to change when you reject.'],
  ['A task given to you', 'Mark it Done when the step is done: the step ticks itself (a gate goes for approval).'],
  ['Heads', 'Every day: 👥 Team page: give the next steps that nobody has, with a deadline; check what is late on 📊 Dashboard.'],
  ['Site', 'Site steps have their days and crew from the site plan. Attach the day\'s photos and tick the step when it is finished.'],
];
async function guideView(root) {
  const d = await api('/journeys/guide');
  const pick = h('select', Object.entries(d.roles).filter(([, x]) => !x.outside).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([k, x]) => h('option', { value: k }, x.label)));
  pick.value = d.roles[d.my_role] ? d.my_role : 'project_head';
  const partBox = h('div');
  const rows = STEPS.flatMap(st => (st.subs ? st.subs.map(p => ({ key: p.key, no: st.key.slice(1), title: `${st.title}: ${p.title}` })) : st.derived ? [] : [{ key: st.key, no: st.key.slice(1), title: st.title }]));
  const showPart = () => {
    const r = pick.value, label = d.roles[r]?.label || r;
    const of = (kind) => rows.filter(x => RACI[x.key]?.[kind]?.includes(r));
    const list = (items, extra) => (items.length ? h('table.data', h('tbody', items.map(x => h('tr', h('td.nowrap', h('b', x.no)), h('td', x.title), h('td.muted', extra(RACI[x.key])))))) : h('p.muted', 'None'));
    partBox.replaceChildren(
      h('p', h('b', label), d.roles[r]?.people.length ? `: ${d.roles[r].people.join(', ')}` : h('span.jr-late', ' – nobody has this role yet')),
      h('h3', `You do (${of('r').length})`), list(of('r'), x => [`By: ${x.due}`, `Needs: ${x.doc}`].join(' · ')),
      h('h3', `You approve (${of('a').length})`), list(of('a'), x => `Done by: ${x.r.map(k => d.roles[k]?.label || k).join(', ')}`),
      h('h3', `You give input (${of('c').length})`), list(of('c'), x => `Asked by: ${x.r.map(k => d.roles[k]?.label || k).join(', ')}`),
      h('h3', `You are told (${of('i').length})`), list(of('i'), () => ''));
  };
  pick.onchange = showPart; showPart();
  const choose = d.can_lead ? (() => {
    const sel = h('select', h('option', { value: '' }, '— none —'), d.orders.map(o => h('option', { value: o.id }, `${o.title}${o.refs.length ? ` (${o.refs.join(' · ')})` : ''}`)));
    sel.value = d.pilot?.id || '';
    return h('div.jr-btns', h('label', 'Pilot order ', sel), h('button.btn.primary', { type: 'button', onclick: busy(async () => { await api('/journeys/pilot', { method: 'PUT', body: { journey_id: sel.value || null } }); toast('Saved'); await guideView(root); }) }, 'Save'));
  })() : null;
  root.replaceChildren(
    h('div.page-head', h('h1', '📘 Pilot & my part'), h('div.actions', h('button.btn', { type: 'button', onclick: () => window.print() }, '🖨 Print'), h('a.btn', { href: '#/journey' }, '← Order Journey'))),
    d.checks ? h('div.card', h('h2', '🚦 Pilot checklist'), h('p.muted', 'One real order goes through every step first, with the real people. When it has reached handover, the next orders follow.'),
      h('div.jr-checks', d.checks.map(c => h('div', { class: `jr-check ${c.ok ? 'ok' : 'todo'}` }, h('span.jr-tick', c.ok ? '✓' : '○'), h('div', h('b', c.title), h('div.muted', c.detail)), c.link && !c.ok ? h('a.btn.small', { href: c.link }, 'Open') : null))),
      choose,
      d.pilot ? h('div.jr-pilotline', h('span.jr-pilot', 'PILOT'), h('a', { href: `#/journey/${d.pilot.id}` }, d.pilot.title), ` · ${d.pilot.finished} of ${d.pilot.total} steps · next: ${d.pilot.next_title}`) : null) : null,
    h('div.card', h('h2', '🗓 Every day in the CRM'), h('table.data', h('tbody', ROUTINE.map(([a, b]) => h('tr', h('td.nowrap', h('b', a)), h('td', b)))))),
    h('div.card', h('div.jr-sitehead', h('h2', '🧩 Your part in the order journey'), h('label', 'Role ', pick)), partBox));
}
