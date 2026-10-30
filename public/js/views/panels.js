// Control Panels & OR app: the five WIESPL control panel versions side by side, what each app does, and how to
// demonstrate it — for sales to explain and print for a client. Data in ../panels.js (shared with the forms).
import { h } from '../ui.js';
import { PANELS, FEATURE_GROUPS, FEATURE_NOTE, HARDWARE, valueText, SURGEON_APP, OR_APP, FUMIGATION_STEPS, FUMIGATION_SAFETY, DEMO_FLOW, REQUIREMENTS } from '../panels.js';

const KEY = 'wiespl-panels-pick';

export async function panelsView(root) {
  let pick = null; // a version to compare against the others; null = show all
  try { pick = localStorage.getItem(KEY) || null; } catch { /* storage blocked */ }
  let tab = 'versions';

  const cell = (v, i) => h('td.pn-v' + (v === false ? '.no' : v === true || v === 'a' ? '.yes' : '.part') + (pick && PANELS[i].key === pick ? '.pick' : ''), valueText(v));
  const head = () => h('thead', h('tr', h('th', 'Feature'), PANELS.map(p => h('th.pn-col' + (pick === p.key ? '.pick' : ''), h('b', `V${PANELS.indexOf(p) + 1}`), h('small', p.short)))));
  const matrix = groups => h('div.table-wrap', h('table.data.pn-table', head(),
    h('tbody', groups.flatMap(([g, rows]) => [h('tr.pn-group', h('td', { colspan: 6 }, g)),
      ...rows.map(([name, hint, vals]) => h('tr', h('td', h('b', name), hint ? h('small.pn-hint', hint) : null), vals.map(cell)))]))));

  const versions = () => h('div.pn-cards', PANELS.map((p, i) => h('button.pn-card' + (pick === p.key ? '.on' : ''), { type: 'button', onclick: () => { pick = pick === p.key ? null : p.key; try { pick ? localStorage.setItem(KEY, pick) : localStorage.removeItem(KEY); } catch { /* ignore */ } draw(); } },
    h('span.pn-tag', `V${i + 1}`), h('b', p.name), h('span', p.text),
    h('span.pn-meta', `🖥️ ${p.displays}`), h('span.pn-meta', p.ahu ? '❄️ AHU control from the panel' : '— No AHU control'),
    h('span.pn-meta', `🏷️ Product code ${p.code}`))));

  const appCard = app => h('div.card', h('h2', app.title), h('p.muted', app.sub),
    h('div.pn-mods', app.modules.map(([icon, name, text]) => h('div.pn-mod', h('span.pn-ico', icon), h('div', h('b', name), h('p', text))))));

  const sections = {
    versions: () => [
      h('div.card', h('h2', 'The five standard versions'), h('p.muted', 'Tap a version to highlight it in the comparison. Each one is in the product master, so it can be added to a quotation or BOQ with its full specification.'), versions()),
      h('div.card', h('h2', 'Features by version'), h('p.muted', '✓ included · If fitted: shown when the sensor is installed · Optional: on request · — not included'), matrix(FEATURE_GROUPS), h('p.muted', { style: { marginTop: '8px' } }, FEATURE_NOTE)),
      h('div.card', h('h2', 'Hardware by version'), matrix(HARDWARE)),
    ],
    apps: () => [appCard(SURGEON_APP), appCard(OR_APP)],
    safety: () => [
      h('div.card', h('h2', 'Fumigation safety sequence'), h('p.muted', 'The outside panel checks the room controller every 5 seconds and shows the state to everyone at the door.'),
        h('ol.pn-steps', FUMIGATION_STEPS.map(([t, d]) => h('li', h('b', t), h('span', d)))), h('p.pn-safe', '🛡️ ', FUMIGATION_SAFETY)),
      h('div.card', h('h2', 'What the site needs'), h('div.table-wrap', h('table.data', h('tbody', REQUIREMENTS.map(([k, v]) => h('tr', h('th', k), h('td', v))))))),
    ],
    demo: () => [
      h('div.card', h('h2', '10-minute demo: Surgeon Control Panel'), h('ol.pn-demo', DEMO_FLOW.surgeon.map(s => h('li', s)))),
      h('div.card', h('h2', '10-minute demo: Digital OR (OR Panel)'), h('ol.pn-demo', DEMO_FLOW.or.map(s => h('li', s))), h('p.pn-safe', '💡 ', DEMO_FLOW.tip)),
    ],
  };
  const TABS = [['versions', '🖥️ Versions & features'], ['apps', '📱 What the apps do'], ['safety', '🛡️ Fumigation & site needs'], ['demo', '🎬 Client demo']];

  const body = h('div');
  const tabs = h('div.tabs');
  function draw() {
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button' + (tab === k ? '.active' : ''), { type: 'button', onclick: () => { tab = k; draw(); } }, l)));
    body.replaceChildren(...sections[tab]());
  }
  const print = () => {
    const pr = document.getElementById('print-root');
    const all = h('div.doc.pn-print', h('div.page',
      h('div.pn-phead', h('img', { src: 'logo.jpeg', alt: 'WIESPL', style: { height: '42px' } }), h('div', h('b', 'WIESPL Control Panel Range'), h('span', 'Surgeon Panel · IVF Lab · Digital OR'))),
      ...Object.values(sections).flatMap(f => f())));
    pr.replaceChildren(all); pr.classList.remove('hidden');
    const done = () => { pr.classList.add('hidden'); pr.replaceChildren(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  };
  draw();
  root.replaceChildren(
    h('div.page-head', h('h1', '🖥️ Control Panels & OR App'), h('span.muted', 'Surgeon Panel · IVF Lab · Digital OR'),
      h('div.actions', h('button.btn', { type: 'button', onclick: print }, '🖨️ Print / PDF for the client'))),
    tabs, body);
}
