// WIESPL control panel range and the OR app: one source for the CRM "Control Panels" page, the product master
// (quotation / BOQ text), the client enquiry form and the detailed requirement form.
// From "WIESPL Control Panel Range" (product specification, Oct 2026), "WIESPL Surgeon Control Panel" and
// "WIESPL Digital OR – Functional Guide" (Oct 2026). Works in the browser and in Node (no DOM).

// ---------------------------------------------------------------- the five standard versions
export const PANELS = [
  { key: 'v1', code: 'PANEL-V1', name: 'Surgeon Panel with AHU', short: 'Surgeon Panel + AHU', for: 'Operating room', ahu: true,
    displays: '10" outside + 32" inside', text: 'Room monitoring and full AHU control for the operating room.' },
  { key: 'v2', code: 'PANEL-V2', name: 'Surgeon Panel without AHU', short: 'Surgeon Panel', for: 'Operating room', ahu: false,
    displays: '10" outside + 32" inside', text: 'Room monitoring, lights and music. No AHU control.' },
  { key: 'v3', code: 'PANEL-V3', name: 'IVF Lab with AHU', short: 'IVF Lab + AHU', for: 'IVF lab', ahu: true,
    displays: 'Option A: 22" only · Option B: 10" outside + 32" inside', text: 'AHU control plus VOC air-quality monitoring for IVF labs.' },
  { key: 'v4', code: 'PANEL-V4', name: 'OR Panel with AHU', short: 'Digital OR + AHU', for: 'Operating room', ahu: true,
    displays: '10" outside + 32" or 43" inside (43": 1000 or 700 nits)', text: 'Complete OR integration: AHU control, recording, patient data and DICOM.' },
  { key: 'v5', code: 'PANEL-V5', name: 'OR Panel without AHU', short: 'Digital OR', for: 'Operating room', ahu: false,
    displays: '10" outside + 32" or 43" inside (43": 1000 or 700 nits)', text: 'Complete OR integration without AHU control.' },
];
export const panelByKey = k => PANELS.find(p => p.key === k);
export const panelByName = n => PANELS.find(p => p.name === n);

// values: true = included, false = not included, 'fitted' = shown when the sensor is installed, 'optional' = on request,
// 'a' = IVF Option A shows it on the 22" display (there is no outside display then), any other string = printed as is
const Y = true, N = false, F = 'fitted', O = 'optional', A = 'a';
export const VALUE_LABEL = { true: '✓', false: '—', fitted: 'If fitted', optional: 'Optional', a: '✓*' };
export const FEATURE_GROUPS = [
  ['Outside display (10", at the entrance)', [
    ['Temperature and humidity', '', [Y, Y, A, Y, Y]],
    ['Room pressure', 'Differential pressure in Pa, green at 5 Pa or more', [Y, Y, A, Y, Y]],
    ['Time and date (digital)', '', [Y, Y, A, Y, Y]],
    ['System ON / OFF', 'Asks for confirmation before switching off', [Y, N, A, Y, N]],
    ['Defumigation mode', 'Exhaust / purge after fumigation', [Y, N, A, Y, N]],
    ['Night mode', 'Reduced setting when the room is not in use', [Y, N, A, Y, N]],
  ]],
  ['Inside display: room control', [
    ['Temperature and humidity display', '', [Y, Y, Y, Y, Y]],
    ['Temperature and humidity control', 'Set the target values (16–24 °C, 45–55 % RH)', [Y, N, Y, Y, N]],
    ['System ON / OFF', '', [Y, N, Y, Y, N]],
    ['Light control', '4 lights, each ON / OFF, plus All ON / OFF', [Y, Y, Y, Y, Y]],
    ['Glass ON / OFF', 'Smart glass privacy control', [N, N, N, Y, Y]],
    ['Medical gas (MGPS)', 'Status of 7 gas sensors with a voice alarm when a gas is empty', [Y, Y, N, Y, Y]],
    ['HEPA filter status', 'Healthy / alert from the HEPA pressure sensor', [Y, F, F, Y, F]],
    ['VOC air quality', 'For the IVF lab', [N, N, Y, N, N]],
    ['Stopwatch', 'Surgery timer with laps', [Y, Y, Y, Y, Y]],
  ]],
  ['Inside display: music, clock and settings', [
    ['Music', 'Built-in speaker, upload your own songs', [Y, Y, Y, Y, Y]],
    ['Hospital music server', 'Play from the server, with default music', [N, N, N, Y, Y]],
    ['Music streaming', 'Over the hospital network', [N, N, N, Y, Y]],
    ['Analog and digital clock', '', [N, N, N, Y, Y]],
    ['Language and colour theme', '', [N, N, N, Y, Y]],
  ]],
  ['Inside display: OR integration', [
    ['OR screen', 'Live view of the surgical video sources', [N, N, N, Y, Y]],
    ['Surgery recording', '1080p and 4K, saved per patient', [N, N, N, Y, Y]],
    ['Video streaming', 'On the local network', [N, N, N, Y, Y]],
    ['Zero-latency video', 'Medical-grade switch with two 4K HDMI screens', [N, N, N, O, O]],
    ['Patient information', 'Patient list, records and reports', [N, N, N, Y, Y]],
    ['DICOM viewer and 3D anatomy', 'CT / MRI / X-ray viewer and an offline 3D anatomy atlas', [N, N, N, Y, Y]],
    ['Store', 'OT inventory and requests', [N, N, N, Y, Y]],
    ['Clean protocol', 'Room cleaning checklist with photos, then UV fumigation', [N, N, N, Y, Y]],
    ['Video conferencing', 'Live OR collaboration', [N, N, N, Y, Y]],
  ]],
];
export const FEATURE_NOTE = '* IVF Lab Option A uses only the 22" display. In that case these features are shown on the 22" display.';

export const HARDWARE = [
  ['Outside display (10")', [
    ['Room pressure sensor (differential)', [Y, Y, 'Option B', Y, Y]],
    ['24 V power supply (SMPS)', [Y, Y, 'Option B', Y, Y]],
  ]],
  ['Inside display', [
    ['Screen size', ['32"', '32"', '22" or 32"', '32" or 43" (43": 1000 or 700 nits)', '32" or 43" (43": 1000 or 700 nits)']],
    ['Processor board', ['4 GB RAM, 32 GB storage, speaker', '4 GB RAM, 32 GB storage, speaker', '4 GB RAM, 32 GB storage, speaker', '8 GB RAM, 64 GB storage', '8 GB RAM, 64 GB storage']],
    ['Room controller', ['Waveshare controller (Ethernet) with Proton slave', 'Waveshare controller with Proton slave', 'Waveshare controller (Ethernet) with Proton slave', 'Waveshare controller (Ethernet) with Proton slave', 'Waveshare controller with Proton slave']],
    ['HEPA pressure sensor', [Y, F, F, Y, F]],
    ['AHU switching', '24 V SMPS, 4-relay board (2-pole), 2 smart switches, system ON / OFF', [Y, N, Y, Y, N]],
    ['HDMI capture card', 'Medical grade or standard', [N, N, N, Y, Y]],
    ['Wi-Fi 7 gigabit router', [N, N, N, Y, Y]],
  ]],
].map(([g, rows]) => [g, rows.map(r => (r.length === 2 ? [r[0], '', r[1]] : r))]);

export const valueText = v => VALUE_LABEL[String(v)] ?? String(v);
const included = v => v === true || v === 'a' || v === 'fitted';

// ---------------------------------------------------------------- the apps on the panels
export const SURGEON_APP = {
  title: 'Surgeon Control Panel app', sub: 'Inside (surgeon) panel and outside (entrance) panel · Android tablet · English, Hindi, Arabic',
  modules: [
    ['🏠', 'Home', 'Clock, live temperature and humidity tiles, HEPA Healthy / Alert, controller Connected / Disconnected, System ON / OFF (with confirmation) and language.'],
    ['🌡️', 'Temperature & humidity', 'Live values and set-points sent to the AHU: 16–24 °C and 45–55 % RH, so a set-point outside safe limits cannot be sent. Values refresh every 3 seconds.'],
    ['💡', 'Lighting', 'Light 1–4 and All Lights. The switch state is read back from the controller, so the screen always matches the real lights.'],
    ['⏱️', 'Surgery timer', 'Start / Pause, Lap at each surgical stage, Reset. Keeps running while other screens are used.'],
    ['🎵', 'Music', 'Built-in tracks (Gayatri Mantra, Hanuman Chalisa, Suprabhatham and more) and songs added from the tablet. Plays in the background.'],
    ['🫁', 'MGPS', 'Oxygen, Vacuum, N₂O, AGSS, Air 4 bar, Air 7 bar and CO₂ with FULL / EMPTY status, and a spoken alarm when a gas goes empty. Gas lines can be renamed to match the hospital.'],
    ['🧽', 'Clean protocol', '11-step cleaning checklist with the disinfectant and a photo per step, uploaded reports, then a fumigation request to the room controller.'],
    ['🩻', 'DICOM viewer', 'CT, MRI and X-ray: slices, cine (5–30 fps), window / level, zoom, rotate, metadata. Demo study built in.'],
    ['🚪', 'Outside panel', 'Live temperature, RH and room pressure (green at 5 Pa or more), time, System ON / OFF, Defumigation and Night mode, and the fumigation warnings.'],
  ],
};
export const OR_APP = {
  title: 'WIESPL Digital OR app', sub: 'OR Panel versions · Android tablet · works offline in demo mode when a server is not reachable',
  modules: [
    ['🏠', 'OR dashboard', 'Analog clock, surgery stopwatch, HEPA, MGPS, lighting zones 1–4, temperature, humidity, music, power and glass, with large targets for gloved hands.'],
    ['🎥', 'OR Screen', 'Four surgical sources (endo cam, surgical cam, overhead, vitals / X-ray), recording per patient to internal storage or USB, layouts (full, side by side, picture in picture, main + 3, 4 equal) and reports beside the live feed.'],
    ['🧑‍⚕️', 'PI – patient information', "Today's patients for the OT, patient records (basic, medical team, eye, fitness, insurance) and reports: images, PDFs and DICOM studies."],
    ['🧽', 'Clean', '11-step cleaning checklist with photos, searchable clean reports, then a 5-minute vacate countdown and UV fumigation through the room controller.'],
    ['🩻', 'DICOM', 'Full-screen viewer for CT, MRI and X-ray by patient: slices, cine, window / level, invert, grid, crosshair, metadata, share.'],
    ['📦', 'Store', 'Hospital inventory with stock levels, and orders from the OT with priority (Low to Critical), tracked to dispatched and completed.'],
    ['📹', 'Video conference', 'Remote experts, students or family join with the live OR feed and shared imaging. Quick join OT-1 to OT-4.'],
    ['🫀', 'Anatomy', 'Offline 3D human body with more than 2,200 structures: 10 body systems, layers, search in English or Latin, pull-apart view, labels, X-ray mode and a quiz.'],
  ],
};
export const FUMIGATION_STEPS = [
  ['Requested', 'The Clean protocol is submitted inside. The outside panel shows Fumigation Requested: CONFIRM or REJECT.'],
  ['Countdown', 'Red banner: COUNTDOWN IN PROGRESS – EVACUATE IMMEDIATELY, with the time left.'],
  ['Active', 'Red banner: DANGER – FUMIGATION ACTIVE – DO NOT ENTER.'],
  ['Defumigation', 'Staff switch on Defumigation to clear the room, then Night mode until the next session.'],
];
export const FUMIGATION_SAFETY = 'The room controller refuses to start fumigation if its occupancy sensor sees a person (PERSON INSIDE OT) or the sensor is offline, and the outside panel shows the reason.';
export const DEMO_FLOW = {
  surgeon: ['Log in in Main mode: home tiles, HEPA status, connection, language switch.', 'Temperature / humidity: live values, set a new target.',
    'Lighting zones and All Lights; stopwatch: start, lap, pause.', 'Music: play a default track. MGPS: gas status and the empty-gas alarm.',
    'DICOM: open a study, scroll the slices, play cine, adjust window / level.', 'Clean: tick steps, take a photo, submit.',
    'Outside panel: live temperature, RH and pressure, confirm the fumigation request and show the warnings, then Defumigation and Night mode.'],
  or: ['Dashboard: start the surgery timer, switch light zones, flip Temp and MGPS.', "OR Mode → OR Screen: pick a patient from today's list, start a recording, open a report beside the live feed.",
    'PI: open a patient record and their reports, including a DICOM study.', 'Clean: tick a few items, take a photo, show the UV fumigation countdown.',
    'Store: place a High-priority order for gloves, then show it in Orders.', 'Video Conf: Quick Join OT-1.',
    'Anatomy: rotate the body, switch on Heart & vessels, tap the heart, Pull apart, then one quiz question.'],
  tip: 'Log the second tablet in Entrance mode before the meeting, and open Anatomy once (it loads the first time, then it is instant).',
};
export const REQUIREMENTS = [
  ['Tablets', 'Android tablets in landscape: one inside (Main mode) and one at the door (Entrance mode).'],
  ['Network', "Both tablets on the theatre controller's Wi-Fi (default gateway 192.168.4.1)."],
  ['Controllers', 'Waveshare ESP32-S3 with v7.2 firmware. The AHU bridge ESP32 is optional, for direct AHU temperature / humidity over RS485.'],
  ['Relays', '1–4 lighting zones · 6 night mode · 7 defumigation · 8 system ON / OFF.'],
  ['Hospital server', 'For Clean report uploads and DICOM / patient data. Both have a demo mode without it.'],
  ['Storage', 'A USB drive (OTG) for the Clean evidence photos.'],
];

// ---------------------------------------------------------------- text for the product master (quotation / BOQ)
export function panelSpec(p) {
  const i = PANELS.indexOf(p);
  const lines = [`WIESPL ${p.name} (Android touch control panel)`, `${p.text}`, `Displays: ${p.displays}.`];
  for (const [g, rows] of FEATURE_GROUPS) {
    const got = rows.filter(r => included(r[2][i]) || r[2][i] === 'optional');
    if (!got.length) continue;
    lines.push(`${g}:`);
    for (const [name, hint, v] of got) lines.push(`- ${name}${hint ? `: ${hint}` : ''}${v[i] === 'fitted' ? ' (when the sensor is fitted)' : v[i] === 'optional' ? ' (optional, on request)' : ''}`);
  }
  lines.push('Hardware:');
  for (const [, rows] of HARDWARE) for (const [name, hint, v] of rows) {
    const x = v[i];
    if (x === false) continue;
    lines.push(`- ${name}${typeof x === 'string' && !(x in VALUE_LABEL) ? `: ${x}` : hint ? `: ${hint}` : ''}${x === 'fitted' ? ' (if fitted)' : ''}`);
  }
  if (i === 2) lines.push(FEATURE_NOTE.replace('* ', 'Note: '));
  return lines.join('\n');
}
