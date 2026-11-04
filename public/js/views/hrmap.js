// Live map (HR → Live map): everyone clocked in, where they last were, grouped by site, with their phone numbers for an
// emergency. Leaflet comes from the jsDelivr CDN with OpenStreetMap maps; without them the lists below still work.
import { h, api, fail } from '../ui.js';

const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
const kpi = (l, v, sub, c) => h('div.kpi', h('div.label', l), h('div.value', { style: c ? { color: c } : {} }, String(v)), sub ? h('div.sub', sub) : null);
const ago = m => (m == null ? 'no location yet' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`);
const COLOUR = p => (p.fake ? '#b42318' : p.stale ? '#9a6400' : p.inside === 'No' ? '#d9480f' : '#1e7d3a');
const stateOf = p => (p.fake ? 'Fake GPS flagged' : p.lat == null ? 'No location yet' : p.stale ? 'Out of date' : p.out_since ? `Out since ${p.out_since}` : p.inside === 'No' ? 'Away from site' : 'At site');
const tel = n => (n ? h('a', { href: `tel:${String(n).replace(/[^\d+]/g, '')}` }, n) : h('span.muted', '—'));

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!document.querySelector('link[data-leaflet]')) document.head.append(h('link', { rel: 'stylesheet', href: LEAFLET + 'leaflet.css', 'data-leaflet': '1' }));
  return new Promise((ok, no) => {
    const s = h('script', { src: LEAFLET + 'leaflet.js' });
    s.onload = () => ok(window.L); s.onerror = () => no(new Error('Map could not load'));
    document.head.append(s);
  });
}

export async function liveMap(box) {
  const mapEl = h('div', { style: { height: '460px', borderRadius: '10px', position: 'relative', zIndex: 0, background: 'var(--bg)' } });
  const note = h('p.muted', { style: { fontSize: '12px' } });
  const kpis = h('div.kpis'), lists = h('div');
  const search = h('input', { placeholder: 'Find a person or site', style: { width: 'auto', minWidth: '220px' }, oninput: () => drawLists() });
  const stamp = h('span.muted');
  let data = null, L = null, map = null, layer = null, fitted = false;
  const markers = new Map();

  const matches = p => { const q = search.value.trim().toLowerCase(); return !q || [p.name, p.site, p.department, p.code].some(x => String(x || '').toLowerCase().includes(q)); };
  function drawLists() {
    const groups = {};
    for (const p of data.people.filter(matches)) (groups[p.site] ||= []).push(p);
    const row = p => h('tr', h('td', h('b', p.name), p.designation || p.department ? h('div.muted', { style: { fontSize: '12px' } }, p.designation || p.department) : null),
      h('td', { style: { color: COLOUR(p), fontWeight: 600 } }, stateOf(p), p.out_reason ? h('div.muted', { style: { fontSize: '12px', fontWeight: 400 } }, p.out_reason) : null),
      h('td.nowrap', ago(p.minutes), p.last_at ? h('div.muted', { style: { fontSize: '12px' } }, `at ${p.last_at}`) : null), h('td.nowrap', p.check_in), h('td.nowrap', tel(p.mobile)), h('td', p.emergency_contact || h('span.muted', '—')),
      h('td.nowrap', p.lat != null ? h('button.btn.small', { onclick: () => { if (markers.get(p.employee_id) && map) { map.setView([p.lat, p.lng], 16); markers.get(p.employee_id).bringToFront().openPopup(); mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } } }, 'Show') : null, ' ',
        p.lat != null ? h('a.btn.small', { href: `https://www.google.com/maps?q=${p.lat},${p.lng}`, target: '_blank', rel: 'noopener' }, 'Directions') : null));
    const absent = data.absent.filter(matches);
    lists.replaceChildren(
      ...Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([site, ps]) => h('div.card.flush', h('div', { style: { padding: '12px 16px 0' } }, h('h2', `📍 ${site} (${ps.length})`)), h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Person', 'Status', 'Last location', 'In at', 'Mobile', 'Emergency contact', ''].map(x => h('th', x)))), h('tbody', ps.map(row)))))),
      !data.people.length ? h('div.card', h('p.muted', 'Nobody is clocked in right now.')) : null,
      absent.length ? h('details.card', h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `Not on duty now (${absent.length})`), h('div.table-wrap', h('table.data', h('thead', h('tr', ['Person', 'Today', 'Mobile', 'Emergency contact'].map(x => h('th', x)))),
        h('tbody', absent.map(p => h('tr', h('td', p.name), h('td', p.state), h('td.nowrap', tel(p.mobile)), h('td', p.emergency_contact || h('span.muted', '—')))))))) : null);
  }
  function drawMap() {
    if (!L) return;
    if (!map) {
      map = L.map(mapEl).setView([18.62, 73.76], 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers(); markers.clear();
    const points = [];
    for (const s of data.sites) {
      const n = data.people.filter(p => p.site_id === s.id).length;
      L.circle([s.lat, s.lng], { radius: s.radius_m || 200, color: '#1f4e9a', weight: 1, fillOpacity: n ? 0.12 : 0.04 }).addTo(layer).bindTooltip(`${s.name}: ${n}`, { permanent: n > 0 });
      if (n) points.push([s.lat, s.lng]);
    }
    for (const p of data.people.filter(x => x.lat != null)) {
      const pop = h('div', h('b', p.name), h('div', p.site), h('div', `${stateOf(p)} · ${ago(p.minutes)}`), p.accuracy ? h('div', `GPS within ${p.accuracy} m`) : null, h('div', tel(p.mobile)));
      markers.set(p.employee_id, L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 2, fillColor: COLOUR(p), fillOpacity: 1 }).addTo(layer).bindPopup(pop).bindTooltip(p.name));
      points.push([p.lat, p.lng]);
    }
    if (!fitted) { if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 }); else if (data.sites.length) map.fitBounds(data.sites.map(s => [s.lat, s.lng]), { padding: [40, 40], maxZoom: 14 }); fitted = true; }
  }
  async function refresh() {
    data = await api('/hr/locations');
    const t = data.totals;
    kpis.replaceChildren(kpi('On duty now', t.on_duty), kpi('At site', t.at_site, null, 'var(--good)'), kpi('Away from site', t.away, null, t.away ? 'var(--warn)' : null), kpi('Out of date', t.out_of_date, `no check for ${data.stale_after} min`, t.out_of_date ? 'var(--bad)' : null));
    stamp.textContent = `Updated ${data.at}`;
    note.textContent = `Green: at site · Orange: away from site · Brown: out of date · Red: fake GPS flagged. The location is the last check received: phones send one every ${data.ping_minutes} min and when leaving the site. Only people clocked in are placed on the map.`;
    drawLists(); drawMap();
  }
  box.replaceChildren(h('div.toolbar', search, h('button.btn', { onclick: () => refresh().catch(fail) }, '🔄 Refresh'), stamp), kpis, h('div.card', mapEl, note), lists);
  await refresh();
  try { L = await loadLeaflet(); drawMap(); map?.invalidateSize(); } catch { mapEl.replaceChildren(h('p.muted', { style: { padding: '16px' } }, 'The map could not load (no internet to the map service). The lists below are still current.')); mapEl.style.height = 'auto'; }
  const timer = setInterval(() => { if (!box.isConnected) { clearInterval(timer); return; } refresh().catch(() => {}); }, 60000);
}
