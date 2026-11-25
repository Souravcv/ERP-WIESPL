// 📋 Service report for the technician (owner, 25 Nov 2026): one screen in clear numbered sections that works on a phone.
// Testing values: first set when the readings start and how often (that makes the reading times), then fill one reading
// at a time with "Next reading". Same fields as the record, so the print and "Complete – client signs" are unchanged.
import { h, api, state, toast, fail, busy, today, fmtDate, hashParams, setHashParam, redirect } from '../ui.js';
import { canWrite, SERVICE_TESTS } from '../schema.js';

const RC = [['ot_temp', 'OT temp', '°C'], ['rh', 'RH', '%'], ['comp1', 'Compressor AC1', 'A'], ['comp2', 'Compressor AC2', 'A'], ['blower', 'Blower', 'A'],
  ['heater_r', 'Heater R', 'A'], ['heater_y', 'Heater Y', 'A'], ['heater_b', 'Heater B', 'A'], ['coil', 'Coil temp', '°C'], ['suction', 'Suction', 'PSI'], ['discharge', 'Discharge', 'PSI']];
const RGROUPS = [['🌡️ Room', ['ot_temp', 'rh']], ['⚙️ Compressor & blower', ['comp1', 'comp2', 'blower']], ['🔥 Heater', ['heater_r', 'heater_y', 'heater_b']], ['❄️ Coil & refrigerant', ['coil', 'suction', 'discharge']]];
const AIR = [['r1', 'Return R1'], ['r2', 'Return R2'], ['r3', 'Return R3'], ['r4', 'Return R4'], ['h1', 'HEPA 1'], ['h2', 'HEPA 2'], ['h3', 'HEPA 3'], ['h4', 'HEPA 4'], ['h5', 'HEPA 5'], ['h6', 'HEPA 6'],
  ['return_open', 'Return damper open %'], ['fresh_open', 'Fresh air damper open %'], ['bypass_open', 'Bypass damper open %']];
const CALLS = ['AMC Service Visit', 'Break Down Call', 'Warranty', 'Chargeable Basis'];
const RESULTS = ['Solved', 'Not solved – revisit needed', 'Not solved – parts needed'];
const EDIT = ['date', 'time_in', 'hospital', 'customer_id', 'call_type', 'ticket_id', 'amc_id', 'complaint_from', 'contact_name', 'mobile', 'email', 'ot_no', 'ahu_capacity', 'ac_tr', 'odu_count', 'plc_sr', 'gsm_sr',
  'problem', 'work_done', 'attended_by', 'end_date', 'end_time', 'checklist', 'vfd_hz', 'hepa_pa', 'positive_pa', 'ambient_c', 'readings', 'reading_start', 'reading_every', 'airflow', 'dampers', 'tests_done',
  'particle_count', 'particle_result', 'result', 'next_action', 'revisit_date', 'material_used'];

function css() {
  if (document.getElementById('srv-css')) return;
  document.head.append(h('style', { id: 'srv-css' }, `
.srv { max-width: 900px; margin: 0 auto; padding-bottom: 90px; }
.srv-nav { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0 10px; position: sticky; top: 0; z-index: 5; background: var(--bg, #f6f7f9); }
.srv-nav a { white-space: nowrap; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--card, #fff); font-size: 13px; text-decoration: none; color: inherit; }
.srv-nav a.done { border-color: #16a34a; color: #166534; background: #f0fdf4; }
.srv-sec { background: var(--card, #fff); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 0 0 12px; scroll-margin-top: 54px; }
.srv-sec > h2 { font-size: 17px; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; }
.srv-sec > h2 .n { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: var(--primary, #2563eb); color: #fff; font-size: 14px; align-items: center; justify-content: center; flex: none; }
.srv-sec > h2 .ok { margin-left: auto; font-size: 12px; font-weight: 600; color: #166534; }
.srv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px 10px; }
.srv-grid.wide { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.srv label { display: block; font-size: 13px; font-weight: 600; }
.srv label input, .srv label select, .srv label textarea { width: 100%; margin-top: 3px; font-size: 16px; }
.srv .unit { color: var(--muted, #64748b); font-weight: 400; }
.srv-seg { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
.srv-seg button { min-height: 40px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--card, #fff); font-size: 14px; cursor: pointer; }
.srv-seg button.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.srv-seg button.on.no { background: #dc2626; border-color: #dc2626; }
.srv-seg button.on.na { background: #64748b; border-color: #64748b; }
.srv-check { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
.srv-check .t { flex: 1; font-size: 14px; }
.srv-check .srv-seg { margin: 0; flex: none; }
.srv-check .srv-seg button { min-height: 36px; padding: 4px 10px; }
.srv-sub { font-weight: 700; margin: 12px 0 6px; font-size: 14px; }
.srv-card { border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin: 8px 0; background: var(--bg, #f8fafc); }
.srv-pager { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-bottom: 8px; }
.srv-pager b { font-size: 16px; }
.srv-times { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.srv-times button { min-width: 64px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--card, #fff); cursor: pointer; font-size: 13px; }
.srv-times button.cur { outline: 2px solid var(--primary, #2563eb); }
.srv-times button.full { background: #f0fdf4; border-color: #16a34a; }
.srv-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; gap: 8px; justify-content: center; align-items: center; padding: 10px 12px; background: var(--card, #fff); border-top: 1px solid var(--border); box-shadow: 0 -2px 10px rgba(0,0,0,.06); }
.srv-bar .btn { min-height: 42px; }
.srv-bar .st { font-size: 12px; color: var(--muted, #64748b); }
@media (max-width: 600px) { .srv { padding-bottom: 120px; } .srv-bar { flex-wrap: wrap; gap: 6px; padding: 6px 8px 8px; } .srv-bar .st { width: 100%; text-align: center; } .srv-bar .btn { flex: 1 1 auto; padding: 6px 10px; font-size: 14px; } .srv-sec { padding: 12px 10px; } .srv-grid { grid-template-columns: repeat(2, 1fr); } .srv-grid.wide { grid-template-columns: 1fr; } .srv-check { flex-direction: column; align-items: stretch; } }
`));
}

const field = (label, el, unit) => h('label', label, unit ? h('span.unit', ` (${unit})`) : null, el);
const num = (v, on) => { const i = h('input', { type: 'text', inputMode: 'decimal', value: v ?? '', autocomplete: 'off' }); i.oninput = () => on(i.value); return i; };
const txt = (v, on, extra = {}) => { const i = h('input', { type: 'text', value: v ?? '', ...extra }); i.oninput = () => on(i.value); return i; };
const area = (v, on, rows = 3, ph = '') => { const t = h('textarea', { rows, placeholder: ph }); t.value = v ?? ''; t.oninput = () => on(t.value); return t; };
const seg = (opts, cur, on, cls = () => '') => {
  const wrap = h('div.srv-seg');
  const draw = v => wrap.replaceChildren(...opts.map(([val, lab]) => h('button', { type: 'button', class: [val === v ? 'on' : '', cls(val)].join(' ').trim(), onclick: () => { const nv = v === val ? '' : val; on(nv); draw(nv); } }, lab)));
  draw(cur);
  return wrap;
};
const filled = o => o && Object.entries(o).some(([k, v]) => !['timing', 'ot', 'damper'].includes(k) && v !== '' && v != null);
const addMin = (t, m) => { const [hh, mm] = String(t || '10:00').split(':').map(Number); const x = (hh * 60 + mm + m) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

export async function serviceReportView(root, idArg) {
  css();
  const isNew = !idArg || idArg === 'new';
  let r = {};
  if (isNew) {
    r = { date: today(), status: 'Draft', attended_by: state.user.name, checklist: null };
    for (const [k, v] of hashParams()) if (k !== 'tab' && v !== '' && v !== 'null' && v !== 'undefined') r[k] = /_id$/.test(k) ? Number(v) : v;
    // the standard checklist steps come from the module's default
    const { ENTITIES } = await import('../schema.js');
    const f = ENTITIES.service_reports.fields.find(x => x.key === 'checklist');
    r.checklist = JSON.parse(JSON.stringify(f?.default || []));
  } else r = await api(`/service_reports/${idArg}`);
  const writable = canWrite('service_reports', state.user.role) && r.status !== 'Completed';
  const amc = r.amc_id ? await api(`/amc_contracts/${r.amc_id}`).catch(() => null) : null;
  const ots = (amc?.ot_systems || []).filter(x => x.ot);
  const stock = writable ? await api('/service/stock').catch(() => []) : [];
  r.readings = Array.isArray(r.readings) ? r.readings : [];
  r.airflow = Array.isArray(r.airflow) ? r.airflow : [];
  r.dampers = Array.isArray(r.dampers) ? r.dampers : [];
  r.material_used = Array.isArray(r.material_used) ? r.material_used : [];
  r.tests_done = Array.isArray(r.tests_done) ? r.tests_done : (r.tests_done ? String(r.tests_done).split(/,\s*/) : []);
  let dirty = false, cur = 0, curAir = 0;
  const status = h('span.st', isNew ? 'Not saved yet' : r.status === 'Completed' ? `✔ Completed · signed by ${r.signed_by || r.customer_rep || 'client'}` : 'Saved');
  const set = (k, v) => { r[k] = v; dirty = true; status.textContent = 'Not saved'; refreshNav(); };
  const out = h('div.srv');

  // ---- save
  async function save({ quiet = false } = {}) {
    if (!writable) return r;
    if (!String(r.hospital || '').trim()) throw new Error('Enter the hospital name (section 1)');
    const body = Object.fromEntries(EDIT.filter(k => k in r).map(k => [k, r[k] === '' ? null : r[k]]));
    const saved = isNew && !r.id ? await api('/service_reports', { method: 'POST', body }) : await api(`/service_reports/${r.id}`, { method: 'PUT', body });
    const wasNew = !r.id;
    Object.assign(r, saved);
    dirty = false; status.textContent = `Saved ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    if (!quiet) toast('Saved');
    if (wasNew) { redirect(`#/service-report/${r.id}`); }
    return r;
  }
  const saveBtn = h('button.btn.primary', { onclick: busy(() => save()) }, '💾 Save');

  // ---- sections
  const sections = [];
  const sec = (key, title, body, isDone) => { const s = { key, title, isDone, el: h('div.srv-sec', { id: `srv-${key}` }) }; s.draw = () => { s.el.replaceChildren(h('h2', h('span.n', sections.indexOf(s) + 1), title, isDone() ? h('span.ok', '✓ filled') : null), ...[body()].flat()); if (!writable) for (const el of s.el.querySelectorAll('input, select, textarea, .srv-seg button')) el.disabled = true; refreshNav(); }; sections.push(s); return s; };
  const nav = h('div.srv-nav');
  function refreshNav() { nav.replaceChildren(...sections.map((s, i) => h('a', { href: `#srv-${s.key}`, class: s.isDone() ? 'done' : '', onclick: e => { e.preventDefault(); s.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, `${i + 1} ${s.title.replace(/^\S+\s/, '')}`))); }

  sec('call', '📞 Call', () => [
    h('div.srv-sub', 'Type of call'), seg(CALLS.map(c => [c, c]), r.call_type, v => set('call_type', v)),
    h('div.srv-grid.wide', field('Hospital *', txt(r.hospital, v => set('hospital', v))), field('Date', txt(r.date, v => set('date', v), { type: 'date' })), field('Time in', txt(r.time_in, v => set('time_in', v), { type: 'time' })),
      field('Contact person (Mr. / Ms.)', txt(r.contact_name, v => set('contact_name', v))), field('Mobile', txt(r.mobile, v => set('mobile', v), { type: 'tel', inputMode: 'tel' })), field('Complaint from', txt(r.complaint_from, v => set('complaint_from', v))),
      field('Call attended by', txt(r.attended_by, v => set('attended_by', v)))),
    r.ticket_id ? h('p.muted', { style: { margin: '8px 0 0' } }, '🛠️ Complaint: ', h('a', { href: `#/view/service_tickets/${r.ticket_id}` }, r.ticket_id_label || `#${r.ticket_id}`)) : null,
  ], () => !!(r.hospital && r.call_type));

  sec('system', '🏭 OT & system', () => {
    const fillOt = name => {
      set('ot_no', name);
      const s = ots.find(x => x.ot === name);
      if (s) { for (const [to, from] of [['ahu_capacity', 'ahu_cfm'], ['ac_tr', 'ac_tr'], ['odu_count', 'odu'], ['plc_sr', 'plc_sr'], ['gsm_sr', 'gsm_sr']]) if (s[from]) r[to] = s[from]; }
      sections.find(x => x.key === 'system').draw();
    };
    return [
      ots.length ? [h('div.srv-sub', 'Which OT? (from the AMC register)'), seg(ots.map(o => [o.ot, o.ot]), r.ot_no, v => fillOt(v))] : null,
      h('div.srv-grid', ots.length ? null : field('OT / Room', txt(r.ot_no, v => set('ot_no', v))), field('AHU capacity', txt(r.ahu_capacity, v => set('ahu_capacity', v)), 'CFM'), field('AC', txt(r.ac_tr, v => set('ac_tr', v)), 'TR'),
        field('No of ODU', txt(r.odu_count, v => set('odu_count', v), { inputMode: 'numeric' })), field('PLC Sr No', txt(r.plc_sr, v => set('plc_sr', v))), field('GSM Sr No', txt(r.gsm_sr, v => set('gsm_sr', v)))),
      ots.length ? h('p.muted', { style: { fontSize: '12px', margin: '6px 0 0' } }, 'Choosing the OT fills these from the AMC register.') : null];
  }, () => !!(r.ot_no || r.ahu_capacity));

  sec('work', '🔧 Problem & work done', () => h('div.srv-grid.wide', field('Problem observed', area(r.problem, v => set('problem', v), 3, 'What the client reported and what you found')),
    field('Work done', area(r.work_done, v => set('work_done', v), 3, 'What you did to resolve it'))), () => !!(r.problem && r.work_done));

  sec('check', '✅ Checklist', () => {
    const list = Array.isArray(r.checklist) ? r.checklist : [];
    const n = list.filter(c => c.done).length;
    return [h('p.muted', { style: { margin: '0 0 4px' } }, `${n} of ${list.length} answered`),
      ...list.map(c => h('div.srv-check', h('div.t', c.step), seg([['Yes', 'Yes'], ['No', 'No'], ['N/A', 'N/A']], c.done, v => { c.done = v; set('checklist', list); sections.find(x => x.key === 'check').draw(); },
        v => (v === 'No' ? 'no' : v === 'N/A' ? 'na' : ''))))];
  }, () => Array.isArray(r.checklist) && r.checklist.length > 0 && r.checklist.every(c => c.done));

  // testing: fixed values, then the readings one time at a time
  sec('test', '🧪 Testing readings', () => {
    const list = r.readings;
    const setup = h('div.srv-card',
      h('div.srv-sub', { style: { marginTop: 0 } }, 'Step 1 · When are the readings taken?'),
      h('div.srv-grid', field('First reading at', txt(r.reading_start || r.time_in || '10:00', v => { r.reading_start = v; dirty = true; }, { type: 'time' })),
        field('Every', (() => { const s = h('select', [10, 15, 20, 30, 45, 60, 120].map(m => h('option', { value: m, selected: Number(r.reading_every || 30) === m }, m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`))); s.onchange = () => { r.reading_every = Number(s.value); dirty = true; }; return s; })()),
        field('How many readings', (() => { const s = h('select', [1, 2, 3, 4, 5, 6, 8, 10, 12].map(k => h('option', { value: k, selected: (list.length || 4) === k }, k))); s.id = 'srv-count'; return s; })())),
      writable ? h('button.btn', { type: 'button', style: { marginTop: '8px' }, onclick: () => {
        const k = Number(document.getElementById('srv-count').value), start = r.reading_start || r.time_in || '10:00', every = Number(r.reading_every || 30);
        r.reading_start = start; r.reading_every = every;
        const next = Array.from({ length: k }, (_, i) => ({ ...(list[i] || {}), timing: addMin(start, i * every) }));
        if (list.length > k && list.slice(k).some(filled) && !confirm(`Readings after no. ${k} have values. Remove them?`)) return;
        set('readings', next); cur = Math.min(cur, k - 1); sections.find(x => x.key === 'test').draw();
        if (r.id) save({ quiet: true }).then(() => toast(`${k} reading times saved`)).catch(fail);
      } }, list.length ? '↻ Update reading times' : '➕ Make the reading times') : null);
    const fixed = h('div.srv-card', h('div.srv-sub', { style: { marginTop: 0 } }, 'Set once'), h('div.srv-grid', field('VFD frequency', num(r.vfd_hz, v => set('vfd_hz', v)), 'Hz'),
      field('HEPA pressure', num(r.hepa_pa, v => set('hepa_pa', v)), 'Pa'), field('Room positive pressure', num(r.positive_pa, v => set('positive_pa', v)), 'Pa'), field('Ambient temp', num(r.ambient_c, v => set('ambient_c', v)), '°C')),
      h('div.srv-sub', 'Tests done'), (() => { const w = h('div.srv-seg'); const draw = () => w.replaceChildren(...SERVICE_TESTS.map(t => h('button', { type: 'button', class: r.tests_done.includes(t) ? 'on' : '', onclick: () => { r.tests_done = r.tests_done.includes(t) ? r.tests_done.filter(x => x !== t) : [...r.tests_done, t]; set('tests_done', r.tests_done); draw(); } }, t))); draw(); return w; })());
    if (!list.length) return [setup, h('p.muted', { style: { margin: '6px 2px' } }, 'Make the reading times first; then fill each reading when you take it.'), fixed];
    cur = Math.max(0, Math.min(cur, list.length - 1));
    const x = list[cur];
    const go = i => { cur = i; sections.find(s => s.key === 'test').draw(); document.getElementById('srv-test').scrollIntoView({ block: 'start' }); };
    const card = h('div.srv-card',
      h('div.srv-sub', { style: { marginTop: 0 } }, 'Step 2 · Fill each reading when you take it'),
      h('div.srv-times', list.map((t, i) => h('button', { type: 'button', class: [i === cur ? 'cur' : '', filled(t) ? 'full' : ''].join(' '), onclick: () => go(i) }, t.timing || `#${i + 1}`, filled(t) ? ' ✓' : ''))),
      h('div.srv-pager', { style: { marginTop: '10px' } }, h('button.btn.small', { type: 'button', disabled: cur === 0, onclick: () => go(cur - 1) }, '‹ Prev'),
        h('b', `Reading ${cur + 1} of ${list.length} · ${x.timing || ''}`), h('button.btn.small', { type: 'button', disabled: cur === list.length - 1, onclick: () => go(cur + 1) }, 'Next ›')),
      ...RGROUPS.map(([g, keys]) => [h('div.srv-sub', g), h('div.srv-grid', keys.map(k => { const [, lab, unit] = RC.find(c => c[0] === k); return field(lab, num(x[k], v => { x[k] = v; set('readings', list); }), unit); }))]),
      field('Remark', txt(x.remark, v => { x.remark = v; set('readings', list); })),
      writable ? h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onclick: busy(async () => {
        if (r.id || r.hospital) await save({ quiet: true });
        toast(`Reading ${cur + 1} saved`);
        if (cur < list.length - 1) go(cur + 1); else sections.find(s => s.key === 'test').draw();
      }) }, cur < list.length - 1 ? '💾 Save & next reading ›' : '💾 Save last reading')) : null);
    const table = h('div.table-wrap', { style: { marginTop: '8px' } }, h('table.data', { style: { fontSize: '12px' } }, h('thead', h('tr', h('th', 'Time'), RC.map(([, l, u]) => h('th', `${l} ${u}`)))),
      h('tbody', list.map((t, i) => h('tr.clickable', { onclick: () => go(i) }, h('td.nowrap', t.timing || ''), RC.map(([k]) => h('td', t[k] ?? '')))))));
    return [card, h('details', h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '📋 All readings (table)'), table), h('details', h('summary', { style: { cursor: 'pointer', margin: '8px 0', fontWeight: 600 } }, '⏱ Change the reading times'), setup), fixed];
  }, () => r.readings.length > 0 && r.readings.every(filled));

  // air flow & dampers, OT by OT
  sec('air', '💨 Air flow & dampers', () => {
    const list = r.airflow;
    const addOt = name => { list.push({ ot: name || '' }); set('airflow', list); curAir = list.length - 1; sections.find(s => s.key === 'air').draw(); };
    const otChoices = [...new Set([r.ot_no, ...ots.map(o => o.ot)].filter(Boolean))];
    const pick = h('div.srv-seg', list.map((a, i) => h('button', { type: 'button', class: i === curAir ? 'on' : '', onclick: () => { curAir = i; sections.find(s => s.key === 'air').draw(); } }, a.ot || `OT ${i + 1}`)),
      writable ? otChoices.filter(o => !list.some(a => a.ot === o)).map(o => h('button', { type: 'button', onclick: () => addOt(o) }, `+ ${o}`)) : null,
      writable ? h('button', { type: 'button', onclick: () => addOt('') }, '+ Another OT') : null);
    curAir = Math.max(0, Math.min(curAir, list.length - 1));
    const a = list[curAir];
    const one = a ? h('div.srv-card', h('div.srv-grid', field('OT', txt(a.ot, v => { a.ot = v; set('airflow', list); }))),
      h('div.srv-sub', 'Return air grills (velocity m/s or CFM)'), h('div.srv-grid', AIR.slice(0, 4).map(([k, l]) => field(l, num(a[k], v => { a[k] = v; set('airflow', list); })))),
      h('div.srv-sub', 'Supply HEPA (velocity m/s or CFM)'), h('div.srv-grid', AIR.slice(4, 10).map(([k, l]) => field(l, num(a[k], v => { a[k] = v; set('airflow', list); })))),
      h('div.srv-sub', 'Damper opening'), h('div.srv-grid', AIR.slice(10).map(([k, l]) => field(l, num(a[k], v => { a[k] = v; set('airflow', list); })))),
      writable ? h('button.btn.small.danger', { type: 'button', style: { marginTop: '8px' }, onclick: () => { if (filled(a) && !confirm('Remove this OT\'s air flow readings?')) return; list.splice(curAir, 1); set('airflow', list); sections.find(s => s.key === 'air').draw(); } }, 'Remove this OT') : null) : h('p.muted', 'Add the OT you are measuring.');
    // dampers in detail
    const dl = r.dampers;
    const addDamper = (preset = {}) => { dl.push({ ot: r.ot_no || a?.ot || '', damper: 'Return air', ...preset }); set('dampers', dl); sections.find(s => s.key === 'air').draw(); };
    const fromAmc = ots.find(o => o.ot === (a?.ot || r.ot_no));
    const dampers = h('div', h('div.srv-sub', 'Return air / fresh air dampers in detail'),
      ...dl.map((d, i) => h('div.srv-card', h('div.srv-seg', ['Return air', 'Fresh air', 'Bypass', 'Supply'].map(t => h('button', { type: 'button', class: d.damper === t ? 'on' : '', onclick: () => { d.damper = t; set('dampers', dl); sections.find(s => s.key === 'air').draw(); } }, t))),
        h('div.srv-grid', field('OT', txt(d.ot, v => { d.ot = v; set('dampers', dl); })), field('Size', txt(d.size, v => { d.size = v; set('dampers', dl); }, { placeholder: '600x300' })), field('Qty', num(d.qty, v => { d.qty = v; set('dampers', dl); })),
          field('Opening', num(d.opening, v => { d.opening = v; set('dampers', dl); }), '%'), field('Velocity / CFM', num(d.velocity, v => { d.velocity = v; set('dampers', dl); }))),
        h('div.srv-sub', 'Condition'), seg(['OK', 'Cleaned', 'Adjusted', 'Needs repair', 'Replaced'].map(c => [c, c]), d.condition, v => { d.condition = v; set('dampers', dl); }),
        field('Remark', txt(d.remark, v => { d.remark = v; set('dampers', dl); })),
        writable ? h('button.btn.small', { type: 'button', onclick: () => { dl.splice(i, 1); set('dampers', dl); sections.find(s => s.key === 'air').draw(); } }, '✕ Remove') : null)),
      writable ? h('div.srv-seg', h('button', { type: 'button', onclick: () => addDamper({ damper: 'Return air' }) }, '+ Return air damper'), h('button', { type: 'button', onclick: () => addDamper({ damper: 'Fresh air' }) }, '+ Fresh air damper'),
        fromAmc && (fromAmc.return_dampers || fromAmc.fresh_dampers) && !dl.length ? h('button', { type: 'button', onclick: () => { if (fromAmc.return_dampers) dl.push({ ot: fromAmc.ot, damper: 'Return air', size: fromAmc.return_dampers }); if (fromAmc.fresh_dampers) dl.push({ ot: fromAmc.ot, damper: 'Fresh air', size: fromAmc.fresh_dampers }); set('dampers', dl); sections.find(s => s.key === 'air').draw(); } }, `+ ${fromAmc.ot}'s dampers from the AMC`) : null) : null);
    return [pick, one, dampers];
  }, () => r.airflow.some(filled) || r.dampers.some(filled));

  sec('particle', '🔬 Particle count', () => [seg([['Done', 'Done'], ['Not done', 'Not done']], r.particle_count, v => { set('particle_count', v); }),
    field('Result / report no', txt(r.particle_result, v => set('particle_result', v), { placeholder: 'e.g. ISO 7 met, report PC-12' })),
    h('p.muted', { style: { fontSize: '12px', margin: '6px 0 0' } }, 'Done: the AMC register gets today’s date and the next due date.')], () => !!r.particle_count);

  sec('result', '🏁 Result & material', () => {
    const notSolved = r.result && r.result !== 'Solved';
    const mat = r.material_used;
    const pickItem = h('select', h('option', { value: '' }, stock.length ? '+ Add material from our Service stock' : 'The Service stock is empty'), stock.map(s => h('option', { value: s.item_id }, `${[s.code, s.name].filter(Boolean).join(' · ')} (we hold ${s.holds} ${s.uom || ''})`)));
    pickItem.onchange = () => { const s = stock.find(x => String(x.item_id) === pickItem.value); if (!s) return; mat.push({ item_id: s.item_id, description: [s.code, s.name].filter(Boolean).join(' · '), qty: 1, uom: s.uom || 'Nos' }); set('material_used', mat); sections.find(x => x.key === 'result').draw(); };
    return [h('div.srv-sub', { style: { marginTop: 0 } }, 'Is the problem solved?'), seg(RESULTS.map(x => [x, x]), r.result, v => { set('result', v); sections.find(x => x.key === 'result').draw(); }, v => (v === 'Solved' ? '' : 'no')),
      notSolved ? h('div.srv-grid.wide', field('Next step *', area(r.next_action, v => set('next_action', v), 2, 'Parts to send, revisit …')), field('Revisit on', txt(r.revisit_date, v => set('revisit_date', v), { type: 'date' }))) : null,
      h('div.srv-sub', 'Material used'),
      ...mat.map((m, i) => h('div.srv-check', h('div.t', m.description || m.item_id_label || ''), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        num(m.qty, v => { m.qty = v; set('material_used', mat); }), h('span', m.uom || ''), writable ? h('button.btn.small', { type: 'button', onclick: () => { mat.splice(i, 1); set('material_used', mat); sections.find(x => x.key === 'result').draw(); } }, '✕') : null))),
      writable ? pickItem : null,
      h('div.srv-grid', { style: { marginTop: '10px' } }, field('End of service', txt(r.end_date, v => set('end_date', v), { type: 'date' })), field('End time', txt(r.end_time, v => set('end_time', v), { type: 'time' })))];
  }, () => !!r.result);

  for (const s of sections) s.draw();
  refreshNav();
  const done = r.status === 'Completed';
  const bar = h('div.srv-bar', status, writable ? saveBtn : null,
    !isNew && r.id && !done && writable ? h('button.btn.good', { onclick: busy(async () => {
      await save({ quiet: true });
      const { completeServiceDialog } = await import('./form.js');
      if (await completeServiceDialog(await api(`/service_reports/${r.id}`))) serviceReportView(root, r.id);
    }) }, '✍️ Complete – client signs') : null,
    !isNew && r.id ? h('a.btn', { href: `#/print/servicereport/${r.id}`, target: '_blank' }, '🖨 Print') : null);
  out.replaceChildren(nav, ...sections.map(s => s.el), bar);
  root.replaceChildren(h('div.page-head', h('h1', `📋 ${r.report_no || 'New service report'}`, r.hospital ? h('span.muted', { style: { fontSize: '15px', fontWeight: 400, marginLeft: '8px' } }, r.hospital) : null),
    h('div.actions', r.ticket_id ? h('a.btn', { href: `#/view/service_tickets/${r.ticket_id}` }, '‹ Complaint') : h('a.btn', { href: '#/list/service_reports' }, '‹ Service reports'),
      !isNew ? h('a.btn', { href: `#/edit/service_reports/${r.id}?full=1` }, 'Full form') : null)),
  done ? h('div.card', { style: { borderLeft: '4px solid #16a34a' } }, `✔ Completed and signed by ${r.signed_by || r.customer_rep || 'the client'}${r.signed_designation ? ', ' + r.signed_designation : ''}${r.signed_at ? ' on ' + r.signed_at : ''}. It can no longer be changed.`) : null,
  out);
  // warn before leaving with unsaved changes
  const leave = e => { if (dirty && writable) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', leave);
  window.addEventListener('hashchange', () => window.removeEventListener('beforeunload', leave), { once: true });
}
