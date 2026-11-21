// The order journey: one modular OT project from the first enquiry to the OT handover, as in the End-to-End Flow
// (A3, Nov 2026) and the Order-to-Execution Process Guide: 6 phases, 45 steps. Shared by the server (server/journey.js)
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
  S('s1', 1, 'Enter the enquiry and submit it to Sales', 'Marketing', 'start', 'Client, hospital, place, source, requirement. Save, then Submit to Sales (Marketing checks their own work first).', { auto: 'enquiry' }),
  S('s2', 1, 'Sales contacts the client (within 24 hours) and checks the data', 'Sales', 'step', 'Call, email or WhatsApp, recorded on the enquiry. Is anything missing: number of OTs, who does electrical, transport, civil? Missing data: ask Marketing or call the client.', { auto: 'contact' }),
  S('s3', 1, 'Show the sales design to the doctor', 'Sales design team', 'step', 'Layout / 3D / client film. Requirements agreed.'),
  S('s3a', 1, 'Make the Basis of Design', 'Technical Sales', 'step', 'From the enquiry and the CAD file of each OT: area, supply CFM, TR, plenum size, temperature, dimensions, panel sq ft, ducting length. Confirm it on the enquiry (📐 Basis of Design).', { auto: 'bod' }),
  S('s4', 1, 'Check the quantities and cost the extra scope', 'Technical Sales', 'step', 'Standard BOQ cost is automatic: check it, report a wrong rate to Costing. Cost the non-standard work (electrical, transport, civil, copper piping).', { auto: 'costing' }),
  S('s5', 1, 'Technical Sales sign-off', 'Technical Sales', 'gate', 'Technically possible, engineering quantities right, heat load and panels checked.'),
  S('s6', 1, 'Sales Finance check: take the order or not', 'Sales Finance', 'gate', 'Raw material profit · timeline cost (city rate, penalty clause) · manpower · logistics. Below the profit limit: ask a senior for approval. No: close the enquiry.'),
  S('s6a', 1, 'Sales checks that everything is included', 'Sales Head', 'step', 'The final check from A to Z: scope, beneficiary or scheme terms, nothing missed.'),
  S('s6b', 1, 'Marketing gives the final OK', 'Marketing', 'gate', 'Price and position of the quotation agreed.'),
  S('s7', 1, 'Send the final quotation', 'Sales Head', 'step', 'Approved quotation, every detail clear.', { auto: 'quotation' }),
  S('s8', 1, 'Receive the client PO', 'Client', 'client', 'PO copy · sales order made.', { auto: 'order' }),
  S('s8a', 1, 'Tell Marketing, Technical Sales and Sales Finance: it is now an order', 'Sales Head', 'step', 'It is no longer a lead. Technical Sales details it as an order; Sales Finance tracks when money is due and when to bill.'),
  // 2 · Order acceptance
  S('s9', 2, 'Check the PO against the quotation', 'Finance', 'step', 'Price · terms · payment schedule.'),
  S('s10', 2, 'Hold the heads\' meeting', 'All heads (Finance calls it)', 'step', 'Lead times · factory load · site · manpower. Minutes recorded.'),
  S('s11', 2, 'Accept the order, send the acceptance letter', 'Management', 'gate', 'Drawing date · client approval date · late approval = client\'s delay.', { due: { after: 's8', days: 4 } }),
  S('s12', 2, 'Visit the site', 'Project / design team', 'step', 'Ducting route · AHU position · doors · windows · scrub area. Photos.'),
  S('s13', 2, 'Make the execution drawings', 'Project design', 'step', 'From the site visit, by the date in the letter. Upload DWG / PDF.', { auto: 'drawings' }),
  S('s14', 2, 'Get the drawings approved by the client', 'Client', 'client', 'Signed drawings with date. Late: client\'s delay, dates move.', { auto: 'drawingsApproved', gate: true }),
  S('s15', 2, 'Give commercial clearance', 'Finance', 'gate', 'Advance received · terms in order.'),
  // 3 · Work order release
  S('s16', 3, 'Complete the five release items', 'Finance · Projects · Supply chain · Production', 'gate', 'All five needed before release. TDS for every product.', {
    subs: [
      { key: 'r1', title: 'Approve the budget', who: 'Finance Head + MD' },
      { key: 'r2', title: 'Make the Gantt chart', who: 'Project department', auto: 'gantt' },
      { key: 'r3', title: 'Sanction the technical work order', who: 'GM / MD / Chief Engineer' },
      { key: 'r4', title: 'Make the pipeline plan and production schedule', who: 'Supply chain · Production' },
      { key: 'r5', title: 'Make the cash-flow chart', who: 'Finance' },
    ] }),
  S('s17', 3, 'Check all five are done', 'GM', 'gate', 'Not done: on hold.', { derived: 's16' }),
  S('s18', 3, 'Issue the master work order', 'GM Operations', 'gate', 'Go-ahead for the project.'),
  S('s19', 3, 'Enter the work order in the CRM', 'GM / system', 'step', 'Project created; Gantt counts from the acceptance date.', { auto: 'project' }),
  // 4 · Departments & dispatch
  S('s20', 4, 'Issue the department work orders', 'GM', 'step', 'One work order per department.', {
    subs: [
      { key: 'd1', title: 'Project team: 12 scope drawings, site Gantt', who: 'Project team' },
      { key: 'd2', title: 'Supply chain: pipeline, vendor orders, arrival dates', who: 'Supply chain' },
      { key: 'd3', title: 'Design: execution and manufacturing drawings, BOQ', who: 'Project / centralised design', auto: 'boq' },
      { key: 'd4', title: 'Production: modular OT parts, schedule', who: 'Production', auto: 'production' },
      { key: 'd5', title: 'Electrical & electronics: power, panels, lighting', who: 'Electrical & electronics' },
    ] }),
  S('s21', 4, 'Approve the TDS of every product', 'Design Head › GM › MD', 'gate', 'No vendor PO without an approved TDS.'),
  S('s22', 4, 'Raise the vendor POs', 'Supply chain', 'vendor', 'Only products with an approved TDS.', { auto: 'po' }),
  S('s23', 4, 'Produce, receive and inspect', 'Production · QC', 'step', 'Factory output and vendor material checked by QC. GRNs.'),
  S('s24', 4, 'Freeze panel design, make the dispatch checklist', 'Design · Supply chain', 'gate', 'Checklist from the BOQ.'),
  S('s25', 4, 'Dispatch everything to site', 'Supply chain', 'start', 'All material, plenum and riser in one go. Site day 1.', { auto: 'dispatch' }),
  // 5 · Site work
  S('s26', 5, 'Hand over drawings, fix plenum, mark site', 'Site · 4 people', 'site', 'Plenum (3 h) · ducting cut-out · riser foundation marking. Day 1.'),
  S('s27', 5, 'Ducting and parallel works (days 2–11)', 'Site', 'site', 'Ducting is the critical path.', {
    subs: [
      { key: 's27a', title: 'Ducting: 1,200 sq ft at 100–150 sq ft/day', who: '4 ducting' },
      { key: 's27b', title: 'Foundation, MGPS, AHU platform, HVAC stand, cable tray, pendant shaft', who: '4 others' },
      { key: 's27c', title: 'Electrical work (2 days, client\'s scope)', who: 'Client' },
    ] }),
  S('s28', 5, 'Fix riser panel joint (glass panel)', 'Site · 4 panel + HVAC 2', 'site', 'With outside ducting and AHU. Days 12–13.'),
  S('s29', 5, 'Install wall panels', 'Site · 4 panel', 'site', 'Day 14.'),
  S('s30', 5, 'Fix right angle and ceiling', 'Site', 'site', 'Days 15–16.'),
  S('s31', 5, 'Cut and mark panels', 'Site', 'site', 'Doors, surgeon panel, lights, pendant. Day 17.'),
  S('s32', 5, 'Install coving', 'Site', 'site', 'Day 18.'),
  S('s33', 5, 'Fit surgeon panel, doors, OT lights, ODU, AHU controller', 'Site crew + HVAC 2', 'site', 'Outside control panel; all electrical on. Day 19.'),
  S('s34', 5, 'Run the system', 'HVAC team', 'site', 'AHU and HVAC run, ducts flushed. Day 20.'),
  S('s35', 5, 'Lay self-levelling floor, cure', 'Vendor', 'vendor', 'Nobody inside while curing. Days 21–23.'),
  S('s36', 5, 'Lay vinyl flooring, fit HEPA filters', 'Vendor · 2 (HEPA)', 'vendor', 'HEPA last (3 h). Day 24.'),
  S('s37', 5, 'Remove film, seal silicone, balance air', 'Site', 'site', 'Day 25.'),
  // 6 · Testing & handover
  S('s38', 6, 'Do the particle count test', 'QC · project', 'step', 'Days 27–28.'),
  S('s39', 6, 'Record the test result', 'QC', 'gate', 'Pass: certificate. Fail: fix and retest.'),
  S('s40', 6, 'Hand over to the client', 'Project team · Client', 'end', 'Handover certificate signed. About 29 days after dispatch.', { auto: 'handover' }),
  S('s41', 6, 'Invoice, collect payment, start warranty / AMC', 'Accounts · Service', 'step', 'Final invoice · payment follow-up · warranty / AMC record.', { auto: 'invoice' }),
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
  s1: R(['marketing'], [], [], ['sales_head'], 'Same day the enquiry comes in', 'Enquiry with client, place, source and requirement; submitted to Sales'),
  s2: R(['sales', 'sales_head'], ['sales_head'], ['client', 'marketing'], ['manager'], '1 day (24 hours) after the enquiry is submitted', 'First contact recorded on the enquiry (call, email, WhatsApp or visit)'),
  s3: R(['design_engineer'], ['sales_head'], ['client', 'sales'], ['technical'], '7 days after the enquiry', 'Sales design: layout / 3D / client film shown to the doctor'),
  s3a: R(['technical'], ['technical'], ['design_engineer', 'sales'], ['sales_head'], '2 days after the sales design', 'Basis of Design sheet, from the enquiry and the CAD file'),
  s4: R(['technical'], ['chief_engineer'], ['design_engineer'], ['sales'], '5 days after the sales design', 'Costing sheet: standard BOQ checked, extra scope costed'),
  s5: R(['technical'], ['technical'], ['design_engineer', 'sales_head'], ['finance_head'], '1 day after the costing', 'Technical sign-off: feasibility, quantities, heat load, panels'),
  s6: R(['accounts'], ['finance_head', 'md'], ['manager', 'production_manager', 'project_head'], ['sales'], '2 days after the technical sign-off', 'Sales Finance note: raw material profit, timeline cost, manpower, logistics, penalty clause; senior approval if the profit is low'),
  s6a: R(['sales_head'], ['sales_head'], ['technical', 'sales'], ['marketing'], '1 day after Sales Finance says go', 'Final check note: scope complete, nothing missed'),
  s6b: R(['marketing'], ['marketing'], ['sales_head'], ['finance_head'], '1 day after the final check', 'Final OK on the quotation'),
  s7: R(['sales_head'], ['manager'], ['technical', 'sales'], ['finance_head'], '2 days after the final OK', 'Final quotation (approved in the CRM)'),
  s8: R(['sales_head'], [], ['client', 'sales'], ['accounts', 'manager'], 'From the client', 'Client PO copy; sales order made from the quotation'),
  s8a: R(['sales_head'], [], ['marketing', 'technical', 'accounts'], ['manager'], 'Same day as the client PO', 'Marketing, Technical Sales and Sales Finance told: track it as an order'),
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

// ---------------------------------------------------------------- approvals (stage 3)
// A gate (and each part of a gate) is approved in the CRM by its approvers, in order; client and vendor approve outside
// the CRM. The technical work order needs one higher authority: GM, MD or Chief Engineer, any one of them.
export const JOURNEY_DOC = 'Order Journey';
const OUTSIDE = new Set(['client', 'vendor']);
const ANY_OF = new Set(['r3']);
const isGate = s => s.kind === 'gate' || !!s.gate;
const GATES = new Set(STEPS.flatMap(s => (s.derived || !isGate(s) ? [] : s.subs ? s.subs.map(x => x.key) : [s.key])));
// the approval steps of a step: each is one role, or several roles of which any one decides
export const approvalChain = key => { if (!GATES.has(key)) return []; const a = (RACI[key]?.a || []).filter(r => !OUTSIDE.has(r));
  return ANY_OF.has(key) && a.length ? [a.join(',')] : a; };
export const mayDecide = (role, approverRole) => role === 'admin' || String(approverRole || '').split(',').includes(role);

// ---------------------------------------------------------------- the document of each step (stage 4)
// Before a step is done by hand or sent for approval, its document is in the CRM: a file attached to the step (PDF,
// drawing, photo, Excel …), or for a check or decision a written note. A step the CRM ticks from its own records
// needs nothing more.
const NOTE_STEPS = new Set(['s2', 's5', 's6', 's9', 's15']);
export const docNeed = key => (TICKABLE.has(key) ? (NOTE_STEPS.has(key) ? 'note' : 'file') : null);
