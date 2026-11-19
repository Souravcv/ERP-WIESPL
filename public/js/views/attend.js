// My Attendance (phone): clock in / out at the work location with GPS + selfie, presence checks during the day
// (automatic while the app is open, and a photo check every few hours), leave requests, my month.
import { h, api, toast, fail, fmtDate, today, busy, modal } from '../ui.js';
import { LEAVE_TYPES, OUT_REASONS } from '../schema.js';
import { attendGuide, msg } from './attendguide.js';

let timer = null, wakeLock = null;
const stop = () => { clearInterval(timer); timer = null; try { wakeLock?.release(); } catch { /* none */ } wakeLock = null; };
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/attend')) stop(); });

// Inside the WIESPL Android app (android-app/): GPS with the fake-GPS flag, and a background service that sends the
// location checks while clocked in, also with the phone locked. null in a normal browser.
const app = window.Capacitor?.isNativePlatform?.() ? (method, options = {}) => window.Capacitor.nativePromise('AttendanceTracker', method, options) : null;

// One GPS fix, as precise as the phone can give within 20 s.
function locate() {
  if (app) return app('getPosition').catch(e => { throw new Error(e?.message || String(e)); });
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error('GPS works only on the secure (https) address of the CRM: open it on the phone through the https link'));
    if (!navigator.geolocation) return reject(new Error('This browser cannot give a location'));
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      e => reject(new Error(e.code === 1 ? 'Location is blocked: allow location for this site in the browser settings, then try again' : e.code === 3 ? 'No GPS fix in 20 seconds: step outside or near a window and try again' : 'Location not available: switch on GPS')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

// Selfie from the front camera, made small (≤ 720 px JPEG) before it is sent.
function selfie() {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'user', style: { display: 'none' } });
    document.body.append(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (!file) return reject(new Error('No photo taken'));
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 720 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('The photo could not be read'));
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

// Location checks while clocked in, on every CRM screen (not only this one) as long as the CRM is open in front: a
// web page cannot run with the phone locked or the browser closed (the Android app can; see the guide for iPhone).
const shared = { working: false, every: 15, last: 0 };
async function checkNow() {
  shared.last = Date.now();
  return api('/hr/check', { method: 'POST', body: await locate() });
}
let bgStarted = false;
export async function backgroundChecks() {
  if (app || bgStarted) return;
  bgStarted = true;
  const refresh = async () => {
    try { const me = await api('/hr/me'); shared.working = !!(me.attendance?.check_in && !me.attendance?.check_out); shared.every = me.rules.pingMinutes || 15; }
    catch { shared.working = false; }
  };
  const tick = async () => {
    if (!shared.working || document.visibilityState !== 'visible' || location.hash.startsWith('#/attend')) return;
    if (Date.now() - shared.last < shared.every * 60e3) return;
    try { await checkNow(); } catch (e) { if (/not clocked in/i.test(e.message)) shared.working = false; }
  };
  await refresh();
  if (shared.working) shared.last = Date.now() - shared.every * 60e3;   // check soon after opening the CRM
  setInterval(tick, 60e3);
  setInterval(refresh, 30 * 60e3);
  document.addEventListener('visibilitychange', tick);
}

const dist = m => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const maps = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const hm = s => String(s || '').slice(11, 16) || String(s || '').slice(0, 5);

export async function attendView(root) {
  stop();
  let me;
  try { me = await api('/hr/me'); }
  catch (e) {
    root.replaceChildren(h('div.page-head', h('h1', '🕘 My Attendance')), h('div.card', h('p', e.message)));
    return;
  }
  const a = me.attendance, R = me.rules;
  const working = a?.check_in && !a?.check_out;
  Object.assign(shared, { working: !!working, every: R.pingMinutes || 15 });
  const card = h('div.card');
  const status = h('div', { style: { fontSize: '15px' } });
  const reload = () => attendView(root);
  // the button opens by itself when the hours are complete
  if (me.out_wait_ms > 0) setTimeout(() => { if (location.hash.startsWith('#/attend')) reload(); }, me.out_wait_ms + 1000);

  // Automatic location checks while this screen is open and the day is running.
  async function autoCheck(force = false) {
    if (!working || document.visibilityState !== 'visible') return;
    if (!force && Date.now() - shared.last < R.pingMinutes * 60e3) return;
    try {
      const r = await checkNow();
      if (r.site) { toast(`📍 You are now at ${r.site}: your day moved there`); reload(); return; }
      status.textContent = `Location recorded at ${r.at || new Date().toTimeString().slice(0, 5)}`;
      status.style.color = 'var(--good)';
    } catch (e) { status.textContent = `Location check failed: ${e.message}`; status.style.color = 'var(--warn)'; }
  }
  // In the app the background service does this (every R.pingMinutes and on leaving the site), screen on or off.
  const bg = h('div');
  if (app) {
    const loc = working && me.sites.find(s => s.id === a.location_id);
    (working ? app('start', { intervalMinutes: R.pingMinutes, site: loc ? { name: loc.name, lat: loc.lat, lng: loc.lng, radius: loc.radius_m || 200 } : undefined }) : app('stop'))
      .then(r => {
        if (!working) return;
        status.textContent = `Location checks run in the background every ${R.pingMinutes} min, also with the phone locked`;
        status.style.color = 'var(--good)';
        // Without these two the phone ends the checks when the app is closed.
        const warn = (text, label, method) => h('div', { style: { marginTop: '8px' } }, h('div', { style: { color: 'var(--bad)', fontSize: '13px', marginBottom: '4px' } }, text), h('button.btn', { onclick: () => app(method) }, label));
        bg.replaceChildren(
          r?.background === false ? warn('⚠️ Location stops when this app is closed', '⚙️ Set location to “Allow all the time”', 'allowAlways') : null,
          r?.battery === false ? warn('⚠️ The phone may stop location checks to save battery', '🔋 Allow running in the background', 'allowBattery') : null);
      })
      .catch(e => { if (working) { status.textContent = `Background location checks are off: ${e?.message || e}`; status.style.color = 'var(--bad)'; } });
  } else if (working) {
    timer = setInterval(() => autoCheck(), 60e3);
    // one listener at a time (this screen is redrawn after each action)
    document.removeEventListener('visibilitychange', window.__attVis || (() => {}));
    window.__attVis = () => autoCheck();
    document.addEventListener('visibilitychange', window.__attVis);
  }

  const mode = h('select', h('option', 'Site / office'), h('option', 'Travel / outstation'));
  const note = h('input', { placeholder: 'For travel / outstation: where and why' });
  // The site to clock in at: the nearest one where you stand, or the one you choose (yours first, then all other sites).
  // During the day the CRM follows you: a location check at another site moves the day there.
  const site = h('select', h('option', { value: '' }, 'Nearest site where I am (automatic)'),
    me.sites.length ? h('optgroup', { label: 'My sites and offices' }, me.sites.map(s => h('option', { value: s.id }, s.name))) : null,
    (me.other_sites || []).length ? h('optgroup', { label: 'Other sites' }, me.other_sites.map(s => h('option', { value: s.id }, s.name))) : null);
  const siteLbl = h('label', 'Site', site);
  mode.onchange = () => { siteLbl.style.display = mode.value === 'Travel / outstation' ? 'none' : ''; };
  const needPhoto = me.employee.field_staff === 'Yes';
  const send = async (path, extra = {}, withPhoto = needPhoto) => {
    const photo = withPhoto ? await selfie() : undefined;
    toast('Getting your location…');
    const pos = await locate();
    return api(path, { method: 'POST', body: { ...pos, ...extra, photo } });
  };

  const nowHm = new Date().toTimeString().slice(0, 5), LT = me.leave_today;
  const banner = (text, sub, color) => h('div', { class: 'no-i18n', style: { margin: '10px 0', padding: '12px 14px', borderRadius: '12px', border: `2px solid ${color}`, background: 'var(--bg)' } },
    h('div', { style: { fontSize: '18px', fontWeight: 700, color } }, text), sub ? h('div', { style: { fontSize: '15px', marginTop: '4px' } }, sub) : null);
  const offToday = me.holiday || me.weekly_off || (LT && !LT.part);
  const startAt = LT?.part ? LT.come_by : me.employee.shift_start;
  const banners = [
    LT?.part ? banner(msg(LT.half ? 'half' : 'short', LT.come_by, LT.go_from), null, 'var(--info, #1f6feb)') : null,
    !a?.check_in && a?.status !== 'On Leave' && !offToday && startAt && nowHm >= startAt ? banner(msg('clockIn'), msg('clockInSub', startAt), 'var(--bad)') : null,
    working && !(me.out_wait_ms > 0) && nowHm >= (me.out_from || (LT?.part ? LT.go_from : me.employee.shift_end) || '99') ? banner(msg('clockOut'), msg('clockOutSub'), 'var(--bad)') : null,
  ];

  const nextPhoto = (() => {
    if (!working || !needPhoto) return null;
    const last = a.last_check && a.photo_checks ? a.last_check : hm(a.check_in);
    return `Next photo check by about ${(() => { const [hh, mm] = last.split(':').map(Number); const t = hh * 60 + mm + R.checkEvery * 60; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })()}`;
  })();

  card.replaceChildren(
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
      h('div', h('b', me.employee.name), h('div.muted', `${me.employee.code || ''} · shift ${me.employee.shift_start || ''}–${me.employee.shift_end || ''}`)),
      h('div', { style: { textAlign: 'right' } }, h('b', fmtDate(me.today)), me.holiday ? h('div', { style: { color: 'var(--warn)' } }, `Holiday: ${me.holiday}`) : me.weekly_off ? h('div.muted', 'Weekly off') : null)),
    ...banners,
    h('div', { style: { margin: '14px 0', padding: '12px', borderRadius: '10px', background: 'var(--bg)' } },
      !a?.check_in ? h('div', { style: { fontSize: '18px', fontWeight: 600 } }, a?.status === 'On Leave' ? `On leave today${a.note ? ' – ' + a.note : ''}` : 'Not clocked in yet')
        : h('div', h('div', { style: { fontSize: '18px', fontWeight: 600 } }, working ? `Working since ${hm(a.check_in)}` : `Clocked out at ${hm(a.check_out)} · ${a.hours} h`),
          h('div.muted', `${a.location_id_label || a.mode} · ${a.checks || 0} location checks, ${a.photo_checks || 0} photo checks`),
          a.review === 'To review' && !working ? h('div.muted', { style: { marginTop: '6px' } }, 'HR is checking this day') : null),
      nextPhoto ? h('div', { style: { marginTop: '6px', fontWeight: 600 } }, nextPhoto) : null, status),
    !a?.check_in && a?.status !== 'On Leave' ? h('div.grid', { style: { gap: '10px' } },
      h('label', 'Where', mode), siteLbl, h('label', 'Note', note),
      h('button.btn.primary', { style: { fontSize: '18px', padding: '14px' }, onclick: busy(async () => {
        try { const r = await send('/hr/clock-in', { mode: mode.value, note: note.value, site_id: mode.value === 'Travel / outstation' ? undefined : site.value || undefined }); toast(r.site ? `Clocked in at ${r.site}` : 'Clocked in (travel)'); reload(); } catch (e) { fail(e); }
      }) }, needPhoto ? '📸 Clock in (selfie + location)' : '📍 Clock in')) : null,
    working ? h('div.grid', { style: { gap: '10px' } },
      needPhoto ? h('button.btn.good', { style: { fontSize: '17px', padding: '13px' }, onclick: busy(async () => {
        try { const r = await send('/hr/check', {}, true); toast('Presence check saved'); reload(); } catch (e) { fail(e); }
      }) }, '📸 Presence check (photo)') : null,
      // Stepping out is not clocking out: say why, and press Back on return (the day keeps running).
      a.out_since ? h('div', { style: { padding: '10px', borderRadius: '10px', background: 'var(--bg)' } }, h('b', `🚶 Out since ${hm(a.out_since)}`), h('div.muted', a.out_reason || ''),
        h('button.btn.good', { style: { marginTop: '8px', width: '100%' }, onclick: busy(async () => {
          try { await send('/hr/back', {}, false).catch(() => api('/hr/back', { method: 'POST', body: {} })); toast('Welcome back'); reload(); } catch (e) { fail(e); }
        }) }, '↩ Back at site'))
        : h('button.btn', { onclick: busy(async () => {
          const why = h('select', h('option', { value: '' }, 'Choose…'), OUT_REASONS.map(r => h('option', r))), note = h('input', { placeholder: 'Where / what (e.g. hardware shop, Aundh site)' });
          if (!(await modal('Going out', h('div.grid', h('p.muted', 'You stay clocked in. Press “Back at site” when you return.'), h('label', 'Reason', why), h('label', 'Note', note)), [{ label: 'Cancel', value: false }, { label: '🚶 Going out', cls: 'primary', value: true }]))) return;
          try { await send('/hr/going-out', { reason: why.value, note: note.value }, false).catch(e => (/GPS|location|Location/.test(e.message) ? api('/hr/going-out', { method: 'POST', body: { reason: why.value, note: note.value } }) : Promise.reject(e))); toast('Noted: you are out'); reload(); } catch (e) { fail(e); }
        }) }, '🚶 Going out (material / work / lunch)'),
      h('button.btn', { onclick: busy(async () => { await autoCheck(true); }) }, '📍 Check my location now'),
      bg,
      app ? null : h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('input', { type: 'checkbox', style: { width: 'auto' }, onchange: async e => {
        if (e.target.checked) { try { wakeLock = await navigator.wakeLock.request('screen'); toast('Screen stays on: location is checked every ' + R.pingMinutes + ' min'); } catch { toast('This phone cannot keep the screen on', true); e.target.checked = false; } }
        else { try { await wakeLock?.release(); } catch { /* none */ } wakeLock = null; }
      } }), 'Keep screen on at site (location checks keep running)'),
      me.out_wait_ms > 0 ? h('button.btn', { disabled: true, style: { fontSize: '17px', padding: '13px' } }, '🔒 Clock out opens at', ` ${me.out_from}`) : h('button.btn.danger', { style: { fontSize: '17px', padding: '13px' }, onclick: busy(async () => {
        if (!confirm('Clock out now?')) return;
        try { const r = await send('/hr/clock-out'); toast(`Clocked out: ${r.attendance.hours} h, ${r.attendance.status}`); stop(); await app?.('stop'); reload(); } catch (e) { fail(e); }
      }) }, needPhoto ? '📸 Clock out (selfie + location)' : '📍 Clock out')) : null,
    h('p.muted', { style: { fontSize: '12px', marginTop: '10px' } }, app
      ? `Your location is taken when you clock in / out, press a check, and from clock-in to clock-out every ${R.pingMinutes} min and when you leave the site, also with the phone locked (a notification shows while it is shared). ${needPhoto ? `Field staff: a photo presence check about every ${R.checkEvery} h.` : ''}`
      : `Your location is taken when you clock in and clock out, when you press a check, and every ${R.pingMinutes} min while you are clocked in and the CRM is open on the phone (any screen). With the phone locked or the browser closed nothing is sent: open the CRM now and then. ${needPhoto ? `Field staff: a photo presence check about every ${R.checkEvery} h. ` : ''}Add this page to the home screen to open it like an app.`));

  const sites = h('div.card', h('h2', '📍 Where you can clock in today'), me.sites.length ? h('table.data', h('tbody', me.sites.map(s => h('tr', h('td', s.name, h('div.muted', { style: { fontSize: '11px' } }, `${s.kind} · within ${s.radius_m || 200} m`)), h('td', h('a', { href: maps(s.lat, s.lng), target: '_blank' }, 'Map')))))) : h('p.muted', 'No site is set for you today: ask HR / the service coordinator to assign your site.'));

  const lt = h('select', LEAVE_TYPES.map(x => h('option', x)));
  const B = me.balance;
  const lf = h('input', { type: 'date', value: today() }), lto = h('input', { type: 'date', value: today() });
  const half = h('input', { type: 'checkbox', style: { width: 'auto' } }), why = h('input', { placeholder: 'Reason' });
  const halfLbl = h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, half, 'Half day');
  // a short leave is 1½ h (no half-day tick); a half day is one date, taken from the leave type chosen (PL, comp-off …)
  const syncHalf = () => {
    const isShort = lt.value.startsWith('Short leave');
    halfLbl.style.display = isShort ? 'none' : '';
    if (isShort) half.checked = false;
    if (half.checked || isShort) lto.value = lf.value;
    lto.disabled = half.checked || isShort;
  };
  lt.onchange = syncHalf; half.onchange = syncHalf; lf.addEventListener('change', syncHalf);
  const leave = h('div.card', h('h2', '🌴 Leave'),
    B ? h('div.kpis', { style: { marginBottom: '10px' } }, ...[['PL available', B.pl_available, B.employment_type === 'Confirmed' ? `${B.pl_credit} credited this year` : 'after confirmation'],
      ['Comp-off', B.comp_off_left, 'take this month'], ['Short leaves', `${B.short_leaves} / ${B.short_max}`, 'this month'], ['Late marks', `${B.late_marks} / ${B.late_free}`, 'free this month']]
      .map(([l, v, s]) => h('div.kpi', h('div.label', l), h('div.value', String(v)), h('div.sub', s)))) : null,
    h('div.form-grid', h('label', 'Type', lt), h('label', 'From', lf), h('label', 'To', lto), halfLbl, h('label.span-2', 'Reason', why)),
    h('button.btn.primary', { style: { marginTop: '8px' }, onclick: busy(async () => {
      try { const r = await api('/hr/leave', { method: 'POST', body: { type: lt.value, from_date: lf.value, to_date: lto.value, half_day: half.checked ? 'Yes' : 'No', reason: why.value } }); toast(`${r.leave_no} sent for approval`); reload(); } catch (e) { fail(e); }
    }) }, '📤 Apply for leave'),
    me.leaves.length ? h('table.data', { style: { marginTop: '10px' } }, h('tbody', me.leaves.map(l => h('tr', h('td', l.leave_no), h('td', l.type), h('td', `${fmtDate(l.from_date)}${l.to_date !== l.from_date ? ' – ' + fmtDate(l.to_date) : ''}`), h('td.num', l.days), h('td', l.status, l.balance_note ? h('div.muted', { style: { fontSize: '11px' } }, l.balance_note) : null))))) : null);

  const month = h('div.card', h('h2', '📅 This month'), me.month.length ? h('table.data', h('thead', h('tr', ['Date', 'Status', 'In', 'Out', 'Hours'].map(x => h('th', x)))),
    h('tbody', me.month.map(d => h('tr', h('td.nowrap', fmtDate(d.date)), h('td', d.status, d.timing && !['On time', ''].includes(d.timing) ? h('div.muted', { style: { fontSize: '11px' } }, d.timing) : null, d.review === 'To review' ? h('span.muted', ' (HR checking)') : null), h('td', hm(d.check_in)), h('td', hm(d.check_out)), h('td.num', d.hours || ''))))) : h('p.muted', 'Nothing yet this month'));

  syncHalf();
  // the guide opens by itself until the person has clocked in a few times
  root.replaceChildren(h('div.page-head', h('h1', '🕘 My Attendance')), card, attendGuide({ open: me.month.filter(d => d.check_in).length < 3 }), sites, leave, month);
  if (working && !app) autoCheck();
}
