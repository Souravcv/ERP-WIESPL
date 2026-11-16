// The order journey: one modular OT project from the first enquiry to the OT handover, as in the End-to-End Flow
// (A3, Nov 2026) and the Order-to-Execution Process Guide: 6 phases, 41 steps. Shared by the server (server/journey.js)
// and the screen (views/journey.js).
//
// kind: start / step / gate (an approval or check: work stops until it passes) / client / vendor / site / end
// auto: a fact the CRM already records ticks the step by itself (server/journey.js AUTO)
// subs: the parts of a step (the five release items, the department work orders, the parallel site works); the step
//       is done when all its parts are
// due: { after, days } the step is due that many days after another step (acceptance within 4 days of the client PO)
export const PHASES = [
  { no: 1, title: 'Enquiry and estimation', sub: 'Win the right orders at the right price', colour: '#2563eb' },
  { no: 2, title: 'Order acceptance', sub: 'Accept within 4 days, fix dates, approve drawings', colour: '#0d9488' },
  { no: 3, title: 'Work order release', sub: 'Money, time and materials planned before work', colour: '#d97706' },
  { no: 4, title: 'Departments & dispatch', sub: 'Buy, make, send', colour: '#7c3aed' },
  { no: 5, title: 'Site work', sub: 'About 29 days from dispatch to handover', colour: '#0369a1' },
  { no: 6, title: 'Testing & handover', sub: 'Clean air, then the client takes over', colour: '#15803d' },
];

const S = (key, phase, title, who, kind, hint, more = {}) => ({ key, phase, title, who, kind, hint, ...more });
export const STEPS = [
  // 1 · Enquiry and estimation
  S('s1', 1, 'Enquiry received and recorded', 'Marketing', 'start', 'Source noted. The digital marketing head decides how online leads are handled.', { auto: 'enquiry' }),
  S('s2', 1, 'Sales takes ownership', 'Sales', 'step', 'Single point of contact for the client.'),
  S('s3', 1, 'Sales design shown to the doctor', 'Sales design team', 'step', 'Pre-sales design to agree the requirements.'),
  S('s4', 1, 'Technical estimation (costing)', 'Technical Estimation', 'step', 'Engineering, HVAC, electrical, plumbing.', { auto: 'costing' }),
  S('s5', 1, 'Three-way review', 'Marketing · Estimation · Sales', 'gate', 'Marketing (price) · Estimation (complete?) · Sales (matches the request?)'),
  S('s6', 1, 'Finance: take it or not?', 'Finance', 'gate', 'Profit · factory and site capacity · the client\'s date. No: the enquiry is closed.'),
  S('s7', 1, 'Final quotation sent', 'Sales', 'step', 'Only when every detail is clear.', { auto: 'quotation' }),
  S('s8', 1, 'Client PO received', 'Client', 'client', 'Order confirmed (sales order).', { auto: 'order' }),
  // 2 · Order acceptance
  S('s9', 2, 'Finance checks the PO', 'Finance', 'step', 'Must match the quotation: price, terms, payment schedule.'),
  S('s10', 2, 'All department heads meet', 'All heads (Finance calls it)', 'step', 'What could stop us meeting the deadline: lead times, factory load, site, manpower.'),
  S('s11', 2, 'Order accepted + acceptance letter', 'Management', 'gate', '① date the drawings will be sent ② date the client must approve ③ late approval = the client\'s delay.', { due: { after: 's8', days: 4 } }),
  S('s12', 2, 'Site visit', 'Project / design team', 'step', 'Ducting routes, AHU position, doors, windows, scrub area.'),
  S('s13', 2, 'Execution drawings prepared', 'Project design', 'step', 'Construction drawings from the site visit, by the date in the letter.', { auto: 'drawings' }),
  S('s14', 2, 'Client approves the drawings', 'Client', 'client', 'Scope and order documents fix what is delivered. Late: the client\'s delay, dates move.', { auto: 'drawingsApproved', gate: true }),
  S('s15', 2, 'Commercial clearance', 'Finance', 'gate', 'The commercial side in order before money is spent.'),
  // 3 · Work order release
  S('s16', 3, 'Release checklist: all five required', 'Finance · Projects · Supply chain · Production', 'gate', 'If one is missing, nothing is released. Also: a TDS for every product.', {
    subs: [
      { key: 'r1', title: 'Financial budget approved', who: 'Finance Head + MD' },
      { key: 'r2', title: 'Gantt chart: end date and method', who: 'Project department', auto: 'gantt' },
      { key: 'r3', title: 'Technical work order sanctioned', who: 'Higher authority' },
      { key: 'r4', title: 'Supply chain pipeline + production schedule', who: 'Supply chain · Production' },
      { key: 'r5', title: 'Workflow and cash-flow chart', who: 'Finance' },
    ] }),
  S('s17', 3, 'All five complete?', 'GM', 'gate', 'No: on hold until complete.', { derived: 's16' }),
  S('s18', 3, 'GM creates the master work order', 'GM Operations', 'gate', 'The official go-ahead for the project.'),
  S('s19', 3, 'Work order entered in the system', 'GM / system', 'step', 'The Gantt counts from the acceptance date; if approval moves, dates move.', { auto: 'project' }),
  // 4 · Departments & dispatch
  S('s20', 4, 'Split into department work orders', 'GM', 'step', 'Each department gets its own work order.', {
    subs: [
      { key: 'd1', title: 'Project team: 12 scope drawings, site Gantt', who: 'Project team' },
      { key: 'd2', title: 'Supply chain: pipeline plan, vendor orders, all material on site on time', who: 'Supply chain' },
      { key: 'd3', title: 'Design: execution and manufacturing drawings, BOQ', who: 'Project / centralised design', auto: 'boq' },
      { key: 'd4', title: 'Production: modular OT parts, schedule with supply chain', who: 'Production', auto: 'production' },
      { key: 'd5', title: 'Electrical & electronics: OT power, panels, lighting', who: 'Electrical & electronics' },
    ] }),
  S('s21', 4, 'TDS approved for every product', 'Design Head › GM › MD', 'gate', 'No vendor PO without an approved TDS.'),
  S('s22', 4, 'Vendor POs raised', 'Supply chain', 'vendor', 'Only for products with an approved TDS.', { auto: 'po' }),
  S('s23', 4, 'Production + vendor deliveries', 'Production · QC', 'step', 'QC checks factory output.'),
  S('s24', 4, 'Panel design frozen + dispatch checklist', 'Design · Supply chain', 'gate', 'Checklist from the BOQ so nothing is missing.'),
  S('s25', 4, 'One-time dispatch to site', 'Supply chain', 'start', 'All material, plenum and riser in one go. Day 1 of the site.', { auto: 'dispatch' }),
  // 5 · Site work
  S('s26', 5, 'Drawings handed over, plenum, markings', 'Site · 4 people', 'site', 'Plenum first (3 h) · ducting cut-out and riser foundation marking. Day 1.'),
  S('s27', 5, 'Run in parallel (days 2–11)', 'Site', 'site', 'Ducting is the critical path.', {
    subs: [
      { key: 's27a', title: 'Ducting: 1,200 sq ft at 100–150 sq ft/day (critical path)', who: '4 ducting' },
      { key: 's27b', title: 'Parallel works: foundation, MGPS, AHU platform, HVAC stand, cable tray, pendant shaft', who: '4 others' },
      { key: 's27c', title: 'Electrical work (2 days): client\'s scope, late = client\'s delay', who: 'Client' },
    ] }),
  S('s28', 5, 'Riser panel joint (glass panel)', 'Site · 4 panel + HVAC 2', 'site', 'Same time: outside ducting and AHU. Days 12–13.'),
  S('s29', 5, 'Wall panel installation', 'Site · 4 panel', 'site', 'Day 14.'),
  S('s30', 5, 'Right angle + ceiling', 'Site', 'site', '½ day + 1½ days. Days 15–16.'),
  S('s31', 5, 'Panel cut-outs and marking', 'Site', 'site', 'Doors, surgeon panel, lights, pendant. Day 17.'),
  S('s32', 5, 'Coving installation', 'Site', 'site', 'Rounded corners for easy cleaning. Day 18.'),
  S('s33', 5, 'Surgeon panel, doors, OT lights, ODU, AHU controller', 'Site crew + HVAC 2', 'site', 'Outside control panel; all electrical systems on. Day 19.'),
  S('s34', 5, 'System run', 'HVAC team', 'site', 'AHU and HVAC run; ducts flushed. Day 20.'),
  S('s35', 5, 'Self-levelling floor + curing', 'Vendor', 'vendor', 'No one inside while it cures; the crew works outside. Days 21–23.'),
  S('s36', 5, 'Vinyl flooring + HEPA filters', 'Vendor · 2 (HEPA)', 'vendor', 'HEPA last, after all dusty work (3 h). Day 24.'),
  S('s37', 5, 'Film removal, silicone, air balancing', 'Site', 'site', 'Covers off, joints sealed, airflow balanced. Day 25.'),
  // 6 · Testing & handover
  S('s38', 6, 'HVAC testing: particle count', 'QC · project', 'step', 'Is the air clean enough for an OT? Days 27–28.'),
  S('s39', 6, 'Test passed?', 'QC', 'gate', 'Results recorded for the client. No: fix and retest.'),
  S('s40', 6, 'Handover to the client', 'Project team · Client', 'end', 'About 29 days after dispatch.', { auto: 'handover' }),
  S('s41', 6, 'After handover', 'Accounts · Service', 'step', 'Billing, payment, after-sales: still to be defined.', { auto: 'invoice' }),
];

export const STEP = Object.fromEntries(STEPS.map(s => [s.key, s]));
// every part that can be ticked: steps without parts, and the parts of the others
export const TICKABLE = new Set(STEPS.flatMap(s => (s.subs ? s.subs.map(x => x.key) : s.derived ? [] : [s.key])));
export const STATUS = { done: 'Done', na: 'Not needed', open: 'To do' };
