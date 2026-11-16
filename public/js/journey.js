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

// ---------------------------------------------------------------- who does what (RACI), per step and part of a step
// r: Responsible (does it) · a: Accountable (approves / signs off; for a gate, in this order) · c: Consulted · i: Informed
// due: the deadline rule · doc: what must be in the CRM before the step counts as done
// Roles are CRM roles; 'client' and 'vendor' are outside parties. Higher authority = GM, MD or Chief Engineer.
// A first draft from the Order-to-Execution guide and the End-to-End Flow: to be corrected by the MD and GM.
const R = (r, a, c, i, due, doc) => ({ r, a, c, i, due, doc });
export const RACI = {
  s1: R(['sales_service'], ['sales'], [], ['manager'], 'Same day the enquiry comes in', 'Enquiry form with its source (beneficiary, digital, consultant, reference, dealer, other)'),
  s2: R(['sales'], ['manager'], ['sales_service'], [], '1 day after the enquiry', 'Sales owner named on the enquiry'),
  s3: R(['design_engineer'], ['sales'], ['client'], ['technical'], '7 days after the enquiry', 'Sales design: layout / 3D / client film shown to the doctor'),
  s4: R(['technical'], ['chief_engineer'], ['design_engineer'], ['sales'], '5 days after the sales design', 'Costing sheet: engineering, HVAC, electrical, plumbing'),
  s5: R(['sales'], ['sales_service', 'technical', 'sales'], [], ['finance_head'], '2 days after the costing', 'Review notes: price (Marketing), completeness (Estimation), matches the request (Sales)'),
  s6: R(['accounts'], ['finance_head'], ['manager', 'production_manager', 'project_head'], ['sales'], '2 days after the review', "Go / no-go note: profit, factory and site capacity, the client's date"),
  s7: R(['sales'], ['manager'], ['technical'], ['finance_head'], '2 days after Finance says go', 'Final quotation (approved in the CRM)'),
  s8: R(['sales'], [], ['client'], ['accounts', 'manager'], 'From the client', 'Client PO copy; sales order made from the quotation'),
  s9: R(['accounts'], ['finance_head'], ['sales'], ['manager'], '1 day after the PO', 'PO checked against the quotation: price, terms, payment schedule'),
  s10: R(['finance_head'], ['manager'], ['project_head', 'design_head', 'purchase_head', 'production_manager', 'qc_head'], ['md'], '2 days after the PO', "Minutes of the heads' meeting: risks to the deadline"),
  s11: R(['manager'], ['md'], ['finance_head', 'project_head'], ['sales', 'design_head'], '4 days after the PO (at most)', 'Acceptance letter: drawing date, client approval date, delay clause'),
  s12: R(['engineer'], ['project_head'], ['design_engineer'], ['design_head'], '3 days after acceptance', 'Site visit report with photos: ducting route, AHU, doors, windows, scrub area'),
  s13: R(['design_engineer'], ['design_head'], ['engineer'], ['project_head'], 'The drawing date in the acceptance letter', 'Technical execution drawings (DWG / PDF) uploaded'),
  s14: R(['project_head'], ['client'], ['design_head'], ['sales', 'finance_head'], "The approval date in the acceptance letter (late = the client's delay)", 'Drawings signed / approved by the client, with the date'),
  s15: R(['accounts'], ['finance_head'], ['sales'], ['manager'], '2 days after the drawings are approved', 'Advance received and terms in order'),
  r1: R(['accounts'], ['finance_head', 'md'], ['project_head'], ['manager'], '3 days after commercial clearance', 'Project budget: cost heads, amount, margin'),
  r2: R(['project_head'], ['manager'], ['design_head', 'purchase_head', 'production_manager'], ['md'], '3 days after commercial clearance', 'Gantt in the planner with the end date (baseline)'),
  r3: R(['design_head'], ['chief_engineer', 'manager', 'md'], ['project_head'], [], '3 days after commercial clearance', 'Technical work order: scope, drawing list, specifications (sanctioned by a higher authority: GM, MD or Chief Engineer)'),
  r4: R(['purchase_head', 'production_manager'], ['manager'], ['design_head', 'store'], ['project_head'], '3 days after commercial clearance', 'Pipeline plan (item, vendor, order and arrival dates) + production schedule'),
  r5: R(['accounts'], ['finance_head'], ['manager'], ['md'], '3 days after commercial clearance', 'Workflow and cash-flow chart: month-wise money in and out'),
  s17: R(['manager'], ['manager'], [], ['md'], 'When the five are done', 'All five release items approved'),
  s18: R(['manager'], ['md'], [], ['project_head', 'design_head', 'purchase_head', 'production_manager', 'qc_head', 'finance_head'], '1 day after the five are done', 'Master work order'),
  s19: R(['manager'], [], [], ['project_head'], 'Same day as the master work order', 'Project / work order in the CRM'),
  d1: R(['project_head'], ['manager'], ['engineer'], [], '2 days after the master work order', 'Project team work order: 12 scope drawings, site Gantt, suggestions'),
  d2: R(['purchase_head'], ['manager'], ['store'], [], '2 days after the master work order', 'Supply chain work order: pipeline, vendor orders, arrival dates'),
  d3: R(['design_head'], ['chief_engineer'], ['design_engineer'], ['purchase_head'], '2 days after the master work order', 'Execution and manufacturing drawings, BOQ in the CRM'),
  d4: R(['production_manager'], ['manager'], ['purchase_head'], ['qc_head'], '2 days after the master work order', 'Production orders and schedule'),
  d5: R(['project_head'], ['chief_engineer'], ['electronics_engineer', 'bgm_electrical'], [], '2 days after the master work order', 'Electrical & electronics work order: power, panels, lighting'),
  s21: R(['design_engineer'], ['design_head', 'manager', 'md'], ['qc_head'], ['purchase_head'], 'Before the vendor PO of that product', 'TDS for every product, approved in order'),
  s22: R(['purchase_head'], ['purchase_head', 'technical', 'accounts', 'manager'], ['store'], ['project_head'], 'By the order dates of the pipeline plan', 'Vendor POs (4 approvals), only for products with an approved TDS'),
  s23: R(['production_manager', 'purchase_head'], ['qc_head'], ['store'], ['project_head'], 'By the production schedule and pipeline arrival dates', 'QC inspection reports, GRNs'),
  s24: R(['design_head', 'store'], ['project_head'], ['purchase_head'], ['engineer'], '2 days before dispatch', 'Frozen panel drawings + dispatch checklist from the BOQ'),
  s25: R(['store', 'purchase_head'], ['project_head'], [], ['engineer', 'sales'], 'The planned dispatch date (site day 1)', 'Delivery challans for all material'),
  s26: R(['engineer'], ['project_head'], [], [], 'Site day 1', 'Daily site progress with photos'),
  s27a: R(['engineer'], ['project_head'], [], ['manager'], 'Site days 2–11 (critical path)', 'Daily ducting progress (sq ft)'),
  s27b: R(['engineer'], ['project_head'], [], [], 'Site days 2–11', 'Daily site progress'),
  s27c: R(['client'], ['project_head'], ['engineer'], ['sales'], "Site days 2–3 (client's scope; late = client's delay)", "Client's electrical work done"),
  s28: R(['engineer'], ['project_head'], [], [], 'Site days 12–13', 'Daily site progress'),
  s29: R(['engineer'], ['project_head'], [], [], 'Site day 14', 'Daily site progress'),
  s30: R(['engineer'], ['project_head'], [], [], 'Site days 15–16', 'Daily site progress'),
  s31: R(['engineer'], ['project_head'], [], [], 'Site day 17', 'Daily site progress'),
  s32: R(['engineer'], ['project_head'], [], [], 'Site day 18', 'Daily site progress'),
  s33: R(['engineer'], ['project_head'], ['electronics_engineer'], [], 'Site day 19', 'Daily site progress'),
  s34: R(['engineer'], ['project_head'], [], [], 'Site day 20', 'System run record'),
  s35: R(['vendor'], ['project_head'], ['engineer'], [], 'Site days 21–23', 'Vendor work done'),
  s36: R(['vendor', 'engineer'], ['project_head'], [], [], 'Site day 24', 'Flooring done, HEPA fitted'),
  s37: R(['engineer'], ['project_head'], [], [], 'Site day 25', 'Air balancing record'),
  s38: R(['qc_head'], ['project_head'], ['engineer'], ['manager'], 'Site days 27–28', 'Particle count report'),
  s39: R(['qc_head'], ['qc_head'], [], ['md', 'manager'], 'Site day 28', 'Test certificate (pass); a fail goes back to fix and retest'),
  s40: R(['project_head'], ['client'], ['sales'], ['md', 'manager', 'finance_head'], 'Site day 29', 'Handover certificate signed by the client'),
  s41: R(['accounts', 'sales_service'], ['finance_head'], [], ['manager'], 'Invoice within 2 days of handover; then warranty / AMC', 'Final invoice, payment follow-up, warranty / AMC record'),
};
