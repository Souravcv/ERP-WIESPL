// 🧾 Site Material: every item sent to a site is accounted for (server/sitematerial.js).
//   Sent = installed (billed / measured) + returned + still at site (last count) + allowed wastage → else Unaccounted.
// The site engineer confirms challans on arrival and counts the high-value items weekly; the store weighs scrap in;
// the Projects head enters installed quantities, approves material above the BOQ and signs the closure before handover.
import { h, api, toast, fail, modal, money, fmtDate, badge, today, busy, hashParams, setHashParam, setHashQuery } from '../ui.js';
import { round2 } from '../calc.js';
import { SCRAP_MATERIALS } from '../schema.js';

const n = v => (v == null || v === '' ? '' : round2(v));
const nz = v => (Number(v) ? round2(v) : '');
const field = (label, el, hint) => h('label', label, hint ? h('span.hint', hint) : null, el);
const pre = t => h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, t);
const tabs = (list, cur, go) => h('div.tabs.wrap', list.map(([k, l]) => h('button', { class: k === cur ? 'active' : '', onclick: () => go(k) }, l)));
const flag = t => h('span.badge', { style: { background: /Unaccounted|Above|Not in|Used|Spares/.test(t) ? 'var(--bad-bg, #fde8e8)' : '', color: /Unaccounted|Above|Not in|Used|Spares/.test(t) ? 'var(--bad, #b91c1c)' : '', marginRight: '4px', whiteSpace: 'nowrap' } }, t);

async function upload(entity, id, file, note) {
  if (!file) return;
  const r = await fetch(`/api/site-material/photo/${entity}/${id}?name=${encodeURIComponent(file.name)}&note=${encodeURIComponent(note || 'Site photo')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-file-type': file.type || 'image/jpeg' }, body: file });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Photo not saved');
}
const photoInput = () => h('input', { type: 'file', accept: 'image/*', capture: 'environment' });

export async function siteMaterialView(root, idArg) {
  const pid = Number(idArg) || null;
  if (pid) return projectPage(root, pid);
  const tab = ['supervisors', 'scrap'].includes(hashParams().get('tab')) ? hashParams().get('tab') : 'sites';
  const head = h('div.page-head', h('h1', '🧾 Site Material'));
  const intro = h('p.muted', 'Every item sent to a site must be accounted for: sent = installed (as billed / measured) + returned to the store + still at site + allowed wastage. Anything else is unaccounted.');
  const body = h('div');
  root.replaceChildren(head, intro, tabs([['sites', '🏗️ Sites'], ['supervisors', '👷 Wastage per site engineer'], ['scrap', '♻️ Scrap yard']], tab, k => { setHashParam('tab', k === 'sites' ? '' : k); siteMaterialView(root); }), body);
  if (tab === 'sites') {
    const d = await api('/site-material');
    body.replaceChildren(d.rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
      h('thead', h('tr', ['Project', 'Site engineer', 'Distance', 'BOQ', 'Items', 'Challans to confirm', 'Last count', 'Flags', d.prices ? 'Unaccounted' : null, 'Closed'].filter(Boolean).map(x => h(/Items|Flags|Unaccounted|confirm/.test(x) ? 'th.num' : 'th', x)))),
      h('tbody', d.rows.map(r => h('tr', { style: { cursor: 'pointer' }, onclick: e => { if (e.target.tagName !== 'A') location.hash = `#/site-material/${r.id}`; } },
        h('td', { style: { minWidth: '220px' } }, h('a', { href: `#/site-material/${r.id}` }, [r.no, r.name].filter(Boolean).join(' · '))),
        h('td', r.engineer || h('span', { style: { color: 'var(--bad)' } }, 'not set')), h('td', r.distance || ''),
        h('td', r.has_boq ? 'Yes' : h('span', { style: { color: 'var(--bad)' } }, 'No BOQ')), h('td.num', r.items),
        h('td.num', r.pending_receipt ? h('b', { style: { color: 'var(--warn, #b45309)' } }, r.pending_receipt) : ''),
        h('td', r.days_since_count == null ? h('span.muted', 'never') : h('span', { style: { color: r.days_since_count > 7 ? 'var(--bad)' : '' } }, `${r.days_since_count} day${r.days_since_count === 1 ? '' : 's'} ago`)),
        h('td.num', r.flagged ? h('b', { style: { color: 'var(--bad)' } }, r.flagged) : ''),
        d.prices ? h('td.num', r.unaccounted_value ? h('b', { style: { color: 'var(--bad)' } }, money(r.unaccounted_value)) : r.no_installed ? h('span.muted', 'installed qty not entered') : '') : null,
        h('td', r.closed ? badge('Closed') : ''))))))) : h('div.card', h('div.empty', 'No project has material sent to its site yet.')));
  } else if (tab === 'supervisors') {
    const d = await api('/site-material/supervisors');
    body.replaceChildren(h('p.muted', 'Material lost on site (wastage + unaccounted) as a share of what was sent, per site engineer, over the items whose installed quantity is entered. One engineer far above the others is worth a look.'),
      d.rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Site engineer', 'Projects', 'Items reconciled', 'Lost %', d.prices ? 'Unaccounted' : null].filter(Boolean).map(x => h(x === 'Site engineer' ? 'th' : 'th.num', x)))),
        h('tbody', d.rows.map(r => h('tr', h('td', r.name), h('td.num', r.projects), h('td.num', r.items), h('td.num', h('b', `${r.wastage_pct}%`)), d.prices ? h('td.num', r.unaccounted_value ? money(r.unaccounted_value) : '') : null)))))) : h('div.card', h('div.empty', 'Nothing to compare yet: enter installed / billed quantities on a project first.')));
  } else {
    const d = await api('/site-material/scrap-yard');
    body.replaceChildren(h('div', { style: { margin: '6px 0' } }, h('a.btn.small.primary', { href: '#/list/scrap_register' }, '♻️ Scrap Register')),
      d.rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Material', 'Weighed in (kg)', 'Sold (kg)', 'In the yard (kg)', 'Sold for'].map(x => h(x === 'Material' ? 'th' : 'th.num', x)))),
        h('tbody', d.rows.map(r => h('tr', h('td', r.material), h('td.num', nz(r.received)), h('td.num', nz(r.sold)), h('td.num', h('b', nz(r.in_yard))), h('td.num', r.sold_value ? money(r.sold_value) : ''))))))) : h('div.card', h('div.empty', 'No scrap weighed in yet.')),
      d.by_project.length ? h('div', h('h3', 'Scrap back from each site'), h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', 'Project'), h('th', 'Material'), h('th.num', 'kg'))),
        h('tbody', d.by_project.map(r => h('tr', h('td', h('a', { href: `#/site-material/${r.id}?tab=scrap` }, [r.no, r.name].filter(Boolean).join(' · '))), h('td', r.material), h('td.num', nz(r.kg))))))))) : null);
  }
}

async function projectPage(root, pid) {
  let d = await api(`/site-material/${pid}`);
  let tab = hashParams().get('tab') || 'reco';
  let editing = false, onlyFlags = false;
  const p = d.project;
  const out = h('div');
  const reload = async () => { d = await api(`/site-material/${pid}`); draw(); };
  function warnings() {
    const w = [];
    if (!p.engineer) w.push(['Set the project\'s Site Engineer (the supervisor who answers for the material at site).', `#/edit/projects/${p.id}`]);
    if (!d.has_boq) w.push(['This project has no BOQ: there is nothing to check the material against. Make the BOQ first.', '#/list/boms']);
    if (d.pending_receipt) w.push([`${d.pending_receipt} challan(s) not yet confirmed at site.`, null, 'challans']);
    if (d.days_since_count == null && d.rows.some(r => r.watch && r.sent)) w.push(['High-value items are at site but never counted.', null, 'counts']);
    else if (d.days_since_count > 7) w.push([`Last count ${d.days_since_count} days ago: count the high-value items weekly.`, null, 'counts']);
    if (p.site_distance === 'Far' && d.unlabelled) w.push([`Far site: ${d.unlabelled} challan line(s) without a package / stage label.`, null, 'challans']);
    if (!p.site_distance) w.push(['Set the site distance (Near / Far) on the project.', `#/edit/projects/${p.id}`]);
    return w;
  }
  function draw() {
    const w = warnings();
    out.replaceChildren(
      h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', margin: '4px 0 10px' }, class: 'muted' },
        h('span', `👷 ${p.engineer || 'no site engineer'}`), h('span', `📍 ${p.site || ''}${p.site_distance ? ` · ${p.site_distance} site` : ''}`),
        p.site_store ? h('span', `🔐 ${p.site_store}`) : null, h('span', p.progress == null ? 'Work done: not known' : `Work done ${p.progress}%`),
        d.prices && d.totals.unaccounted_value ? h('b', { style: { color: 'var(--bad)' } }, `Unaccounted ${money(d.totals.unaccounted_value)}`) : null,
        p.recon_head_sign ? h('b', { style: { color: 'var(--good, #15803d)' } }, '✓ Closed') : null),
      w.length ? h('div.card', { style: { borderLeft: '4px solid var(--warn, #d97706)' } }, w.map(([t, link, go]) => h('div', { style: { margin: '2px 0' } }, '⚠️ ', link ? h('a', { href: link }, t) : go ? h('a', { href: '#', onclick: e => { e.preventDefault(); tab = go; setHashParam('tab', go); draw(); } }, t) : t))) : null,
      tabs([['reco', `🧾 Reconciliation (${d.rows.length})`], ['challans', `🚚 Challans${d.pending_receipt ? ` (${d.pending_receipt} to confirm)` : ''}`], ['counts', `🔢 Counts at site (${d.checks.length})`], ['scrap', '♻️ Scrap back'], ['closure', p.recon_head_sign ? '✅ Closure' : '🔒 Closure']], tab, k => { tab = k; setHashParam('tab', k === 'reco' ? '' : k); draw(); }),
      ...({ reco, challans, counts, scrap, closure }[tab] || reco)());
  }

  // ---- reconciliation
  function reco() {
    const inputs = new Map();
    const rows = d.rows.filter(r => !onlyFlags || r.flags.length);
    const save = busy(async () => {
      d = await api(`/site-material/${pid}/installed`, { method: 'POST', body: { lines: [...inputs].map(([id, [q, nt]]) => ({ item_id: id, qty: q.value, note: nt.value })) } });
      editing = false; toast('Installed quantities saved'); draw();
    });
    const bar = h('div.toolbar', { style: { flexWrap: 'wrap' } },
      d.head && !p.recon_head_sign ? (editing ? [h('button.btn.primary', { onclick: save }, '💾 Save installed quantities'), h('button.btn', { onclick: () => { editing = false; draw(); } }, 'Cancel')]
        : h('button.btn.primary', { onclick: () => { editing = true; draw(); } }, '✏️ Enter installed / billed qty')) : null,
      d.head ? h('button.btn', { onclick: allowanceDialog }, '⚙️ Wastage allowance') : null,
      h('a.btn', { href: `#/stock-entry?type=RETURN&project=${pid}` }, '↩️ Return leftovers to the store'),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400 } }, h('input', { type: 'checkbox', checked: onlyFlags, style: { width: 'auto' }, onchange: e => { onlyFlags = e.target.checked; draw(); } }), 'Only flagged'));
    const cols = ['Item', 'BOQ', 'Sent', 'Spare', 'Short / damaged on arrival', 'Returned', 'Installed / billed', 'At site (last count)', 'Allowed wastage', 'Unaccounted', d.prices ? 'Value' : null, 'Flags'].filter(Boolean);
    return [bar,
      rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', cols.map(x => h(['Item', 'Flags'].includes(x) ? 'th' : 'th.num', x)))),
        h('tbody', rows.map(r => {
          let inst = r.installed == null ? (r.sent ? h('span.muted', '—') : '') : round2(r.installed);
          if (editing) {
            const q = h('input', { type: 'number', step: 'any', min: 0, value: r.installed ?? '', style: { width: '90px' } });
            const nt = h('input', { placeholder: 'from measurement sheet / bill no', value: r.installed_note || '', style: { width: '150px', marginTop: '2px' } });
            inputs.set(r.item_id, [q, nt]); inst = h('div', q, nt);
          }
          return h('tr', h('td', { style: { minWidth: '220px' } }, r.watch ? h('span', { title: 'High-value: counted weekly' }, '💎 ') : null, h('a', { href: `#/view/items/${r.item_id}` }, [r.code, r.name].filter(Boolean).join(' · ')), h('div.muted', { style: { fontSize: '11px' } }, [r.category, r.uom].filter(Boolean).join(' · '))),
            h('td.num', nz(r.required)), h('td.num', h('b', nz(r.sent))), h('td.num', nz(r.spare)), h('td.num', nz(r.short + r.damaged)), h('td.num', nz(r.returned)),
            h('td.num', inst), h('td.num', r.at_site == null ? h('span.muted', 'not counted') : h('span', { title: `Counted ${fmtDate(r.counted_on)}` }, n(r.at_site))),
            h('td.num', r.allowed ? h('span', { title: `${r.allowance_pct}% of ${r.category}` }, n(r.allowed)) : ''),
            h('td.num', r.unaccounted == null ? '' : h('b', { style: { color: r.unaccounted > 0.0005 ? 'var(--bad)' : 'var(--good, #15803d)' } }, r.unaccounted > 0.0005 ? round2(r.unaccounted) : '0')),
            d.prices ? h('td.num', r.unaccounted_value ? money(r.unaccounted_value) : '') : null,
            h('td', r.flags.map(flag)));
        }))))) : h('div.card', h('div.empty', onlyFlags ? 'Nothing flagged.' : 'Nothing has been sent to this site yet.')),
      h('p.muted', { style: { fontSize: '12px' } }, 'Unaccounted = (sent − short / damaged on arrival) − returned − installed / billed − at site (last count) − allowed wastage. Installed / billed comes from the client\'s measurement sheet, entered by the Projects head, not by the site. Short / damaged on arrival is the transport\'s, not the site\'s. 💎 = high-value item (counted weekly).')];
  }
  async function allowanceDialog() {
    const cats = [...new Set([...Object.keys(d.allowances), ...d.rows.map(r => r.category).filter(Boolean)])].sort();
    const ins = cats.map(c => [c, h('input', { type: 'number', step: 'any', min: 0, max: 50, value: d.allowances[c] ?? '', style: { width: '90px' } })]);
    const ok = await modal('Wastage allowance per category', h('div', h('p.muted', 'The share of what is sent that may be cut off or wasted at site, per item category (your team\'s norm). Blank = 0%.'),
      h('table.data', h('tbody', ins.map(([c, i]) => h('tr', h('td', c), h('td', i, ' %')))))), [{ label: 'Cancel', value: null },
      { label: '💾 Save', cls: 'primary', action: async () => (await api('/site-material/allowances', { method: 'PUT', body: { allowances: Object.fromEntries(ins.map(([c, i]) => [c, i.value])) } })) }]);
    if (ok) { toast('Allowance saved'); reload(); }
  }

  // ---- challans: the site confirms what arrived
  function challans() {
    return [h('p.muted', 'The site engineer confirms every challan when it arrives: quantity received per line, short or damaged, with a photo. From then on the material at site is in the site engineer\'s name.'),
      d.challans.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Challan', 'Date', 'Lines', 'Status', 'Received', ''].map(x => h('th', x)))),
        h('tbody', d.challans.map(c => {
          const bad = c.receipt.filter(r => r.condition !== 'OK');
          return h('tr', h('td', h('a', { href: `#/view/challans/${c.id}` }, c.challan_no)), h('td.nowrap', fmtDate(c.date)), h('td', (c.lines || []).filter(l => Number(l.qty) > 0).length), h('td', badge(c.status)),
            h('td', c.status === 'Delivered' ? [c.received_by || '', bad.length ? h('div', { style: { color: 'var(--bad)' } }, `${bad.length} line(s) ${bad.map(b => b.condition.toLowerCase()).join(' / ')}`) : c.receipt.length ? h('div.muted', 'all OK') : h('div.muted', 'marked delivered (no line check)')] : ''),
            h('td', c.status === 'Dispatched' && d.can_act ? h('button.btn.small.good', { onclick: () => receiveDialog(c) }, '✓ Confirm receipt') : c.overrun_ok ? h('span.muted', { title: c.overrun_ok }, 'above BOQ (approved)') : ''));
        }))))) : h('div.card', h('div.empty', 'No challans for this project.'))];
  }
  async function receiveDialog(c) {
    const rows = (c.lines || []).map((l, i) => ({ l, i })).filter(x => Number(x.l.qty) > 0);
    const ins = rows.map(({ l, i }) => {
      const got = h('input', { type: 'number', step: 'any', min: 0, max: l.qty, value: l.qty, style: { width: '80px' } });
      const cond = h('select', ['OK', 'Short', 'Damaged'].map(o => h('option', o)));
      const note = h('input', { placeholder: 'what is short / damaged', style: { width: '160px' } });
      got.oninput = () => { if (Number(got.value) < Number(l.qty) && cond.value === 'OK') cond.value = 'Short'; };
      return { i, l, got, cond, note };
    });
    const who = h('input', { value: '', placeholder: 'Your name (if not you)' });
    const date = h('input', { type: 'date', value: today() });
    const pic = photoInput();
    const ok = await modal(`Confirm receipt – ${c.challan_no}`, h('div',
      h('div.table-wrap', h('table.data', h('thead', h('tr', ['Material', 'Package', 'Sent', 'Received', 'Condition', 'Note'].map(x => h('th', x)))),
        h('tbody', ins.map(x => h('tr', h('td', { style: { minWidth: '180px' } }, x.l.description || ''), h('td', x.l.pack || ''), h('td.num', `${x.l.qty} ${x.l.uom || ''}`), h('td', x.got), h('td', x.cond), h('td', x.note)))))),
      h('div.grid', field('Received on', date), field('Received by', who), field('Photo of the material', pic, 'Optional but expected'))), [{ label: 'Cancel', value: null },
      { label: '✓ Confirm', cls: 'good', action: async () => {
        await api(`/site-material/challans/${c.id}/receive`, { method: 'POST', body: { date: date.value, received_by: who.value.trim() || undefined, lines: ins.map(x => ({ i: x.i, received: x.got.value, condition: x.cond.value, note: x.note.value })) } });
        await upload('challans', c.id, pic.files[0], 'Material on arrival at site').catch(fail);
        return true;
      } }], { wide: true });
    if (ok) { toast('Receipt confirmed'); reload(); }
  }

  // ---- counts at site
  function counts() {
    return [h('div.toolbar', d.can_act ? h('button.btn.primary', { onclick: () => countDialog() }, '🔢 New count') : null,
      d.can_act && !d.closure ? h('button.btn', { onclick: () => countDialog('Site closure count') }, '🏁 Closure count (work finished)') : null),
    h('p.muted', 'Weekly, the site engineer counts the high-value items (💎) and enters what was used and what is left at site, with a photo. The Projects head records a visit or a video-call check the same way. At the end, the closure count of everything left decides what must come back.'),
    d.checks.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Count', 'By', 'Items', ''].map(x => h('th', x)))),
      h('tbody', d.checks.map(c => h('tr', h('td.nowrap', fmtDate(c.date)), h('td', c.kind), h('td', c.checked_by || ''), h('td', c.lines.length), h('td', h('a', { href: `#/view/site_checks/${c.id}` }, 'Open')))))))) : h('div.card', h('div.empty', 'No counts yet.'))];
  }
  async function countDialog(kind0) {
    let all = kind0 === 'Site closure count';
    const kind = h('select', ['Weekly count', 'Visit check', 'Video check', 'Site closure count'].map(o => h('option', { selected: o === (kind0 || 'Weekly count') }, o)));
    const date = h('input', { type: 'date', value: today() });
    const remarks = h('textarea', { rows: 2 });
    const pic = photoInput();
    const box = h('div');
    let ins = [];
    const fill = () => {
      const list = d.rows.filter(r => r.sent && (all || r.watch));
      ins = list.map(r => ({ r, used: h('input', { type: 'number', step: 'any', min: 0, inputMode: 'decimal' }), at: h('input', { type: 'number', step: 'any', min: 0, inputMode: 'decimal' }), note: h('input') }));
      // one block per item (fits a phone: the site engineer counts on site)
      box.replaceChildren(list.length ? h('div', { style: { maxHeight: '55vh', overflowY: 'auto' } }, ins.map(x => h('div', { style: { borderBottom: '1px solid var(--border)', padding: '8px 0' } },
        h('div', { style: { fontWeight: 600 } }, x.r.watch ? '💎 ' : '', [x.r.code, x.r.name].filter(Boolean).join(' · ')),
        h('div.muted', { style: { fontSize: '12px', margin: '2px 0 4px' } }, `At site: ${round2(x.r.sent - x.r.returned)} ${x.r.uom || ''} sent · last count ${x.r.at_site == null ? '—' : n(x.r.at_site)}`),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('label', { style: { flex: '1 1 90px' } }, 'Used since last count', x.used), h('label', { style: { flex: '1 1 90px' } }, 'Left at site', x.at), h('label', { style: { flex: '2 1 140px' } }, 'Note', x.note)))))
        : h('div.empty', all ? 'Nothing sent to this site yet.' : 'No high-value item (💎) at this site. Tick “All items”, or mark the items as high-value in the item master.'));
    };
    const allBox = h('input', { type: 'checkbox', checked: all, style: { width: 'auto' }, onchange: e => { all = e.target.checked; fill(); } });
    kind.onchange = () => { if (kind.value === 'Site closure count' && !all) { all = true; allBox.checked = true; fill(); } };
    fill();
    const ok = await modal('Count at site', h('div', h('div.grid', field('Count', kind), field('Date', date), field('Photo', pic, 'The items counted')),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400, margin: '6px 0' } }, allBox, 'All items (not only the high-value ones)'), box, field('Remarks', remarks)),
    [{ label: 'Cancel', value: null }, { label: '💾 Save count', cls: 'primary', action: async () => {
      const r = await api(`/site-material/${pid}/checks`, { method: 'POST', body: { kind: kind.value, date: date.value, remarks: remarks.value, lines: ins.map(x => ({ item_id: x.r.item_id, uom: x.r.uom, used: x.used.value, at_site: x.at.value, note: x.note.value })) } });
      await upload('site_checks', r.id, pic.files[0], `${kind.value} photo`).catch(fail);
      return true;
    } }], { wide: true });
    if (ok) { toast('Count saved'); reload(); }
  }

  // ---- scrap back from this site
  function scrap() {
    return [h('div.toolbar', d.can_store ? h('button.btn.primary', { onclick: scrapDialog }, '⚖️ Weigh in scrap from this site') : null, h('a.btn', { href: '#/list/scrap_register' }, '♻️ Scrap Register')),
      h('p.muted', 'Offcuts and scrap come back from the site with the return vehicle and are weighed at the factory by material. Copper and cable scrap is worth money: what comes back should match the wastage.'),
      d.scrap.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', 'Material'), h('th.num', 'Weighed in (kg)'))), h('tbody', d.scrap.map(s => h('tr', h('td', s.material), h('td.num', nz(s.kg)))))))) : h('div.card', h('div.empty', 'No scrap back from this site yet.'))];
  }
  async function scrapDialog() {
    const mat = h('select', SCRAP_MATERIALS.map(o => h('option', o)));
    const kg = h('input', { type: 'number', step: 'any', min: 0 });
    const slip = h('input');
    const rem = h('input');
    const ok = await modal('Scrap back from the site', h('div.grid', field('Material', mat), field('Weight (kg)', kg), field('Weight slip no', slip), field('Remarks', rem)), [{ label: 'Cancel', value: null },
      { label: '💾 Save', cls: 'primary', action: () => api('/scrap_register', { method: 'POST', body: { kind: 'Received from site', project_id: pid, date: today(), material: mat.value, weight_kg: kg.value, slip_no: slip.value, remarks: rem.value } }) }]);
    if (ok) { toast(`${ok.entry_no || 'Scrap'} saved`); reload(); }
  }

  // ---- closure before handover
  function closure() {
    const unacc = d.rows.filter(r => r.unaccounted > 0.0005);
    const checks = [
      [!d.pending_receipt, 'Every challan confirmed at site', d.pending_receipt ? `${d.pending_receipt} to confirm` : ''],
      [!!d.closure, 'Closure count done (what is left at site)', d.closure ? fmtDate(d.closure.date) : 'Counts → Closure count'],
      [!d.totals.no_installed, 'Installed / billed quantity entered for every item', d.totals.no_installed ? `${d.totals.no_installed} item(s) missing` : ''],
      [!unacc.length && !d.totals.no_installed, 'Nothing unaccounted', d.totals.no_installed && !unacc.length ? 'known once installed quantities are entered' : unacc.length ? `${unacc.length} item(s)${d.prices && d.totals.unaccounted_value ? `, ${money(d.totals.unaccounted_value)}` : ''}: the Projects head writes what was decided` : ''],
    ];
    const note = h('textarea', { rows: 2, placeholder: unacc.length ? 'What was decided for the unaccounted items: explained / written off / recovered …' : 'Note (optional)' });
    const sign = as => busy(async () => { d = await api(`/site-material/${pid}/sign`, { method: 'POST', body: { as, note: note.value } }); Object.assign(p, d.project); toast('Signed'); draw(); });
    const reopen = busy(async () => { const why = prompt('Why reopen the closed site?'); if (!why) return; d = await api(`/site-material/${pid}/sign`, { method: 'POST', body: { as: 'reopen', reason: why } }); Object.assign(p, d.project); draw(); });
    return [h('p.muted', 'Before handover the leftovers come back (return to the store), scrap is weighed in, and the reconciliation is signed by the site engineer and then the Projects head. The project can be set to Completed only after that.'),
      h('div.card', checks.map(([ok, t, more]) => h('div', { style: { margin: '4px 0' } }, ok ? '✅ ' : '⬜ ', h('b', t), more ? h('span.muted', ` — ${more}`) : null))),
      h('div.card', h('div', h('b', 'Site engineer: '), p.recon_supervisor_sign || h('span.muted', 'not signed')), h('div', h('b', 'Projects head: '), p.recon_head_sign || h('span.muted', 'not signed'))),
      !p.recon_head_sign ? h('div.card', field('Note', note), h('div.toolbar',
        !p.recon_supervisor_sign && (d.supervisor || d.head) ? h('button.btn.primary', { onclick: sign('supervisor') }, '✍️ Sign as site engineer') : null,
        p.recon_supervisor_sign && d.head ? h('button.btn.good', { onclick: sign('head') }, '✍️ Sign as Projects head (close the site)') : null)) : d.head ? h('button.btn', { onclick: reopen }, '↺ Reopen') : null];
  }

  draw();
  root.replaceChildren(h('div.page-head', h('h1', `🧾 ${[p.project_no || p.code, p.name].filter(Boolean).join(' · ')}`),
    h('div.actions', h('a.btn', { href: '#/site-material' }, '‹ All sites'), h('a.btn', { href: `#/project-store/${pid}` }, '🏗️ Project Store'), h('a.btn', { href: `#/view/projects/${pid}` }, 'Project'))),
  h('p.muted', p.client || ''), out);
}
