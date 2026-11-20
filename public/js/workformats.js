// Daily Team Work per department (owner, 20 Nov 2026: each department works differently, not in the production format).
// Each format says what a row is linked to (production order, project / site, or nothing), what the number columns
// mean, the usual unit and the usual works. Shared by the screen (views/performance.js) and the server (performance.js).
const F = {
  production: {
    title: 'Production', link: 'order', linkLabel: 'Production order', target: 'Target', done: 'Done', rejected: 'Rejected / rework', uom: 'Nos',
    works: ['Cutting', 'Bending', 'Welding', 'Fabrication', 'Foaming', 'Assembly', 'Powder coating', 'Packing', 'Helper work'],
  },
  electrical: {
    title: 'Electrical / Wiring', link: 'project', linkLabel: 'Project / panel for', target: 'Target', done: 'Done', rejected: 'Faults / rework', uom: 'Panels',
    works: ['Control panel assembly', 'Panel wiring', 'Panel testing', 'Surgeon panel / OR panel', 'SHRM / sensor wiring', 'Cable laying', 'Termination', 'Lighting wiring', 'Fault finding / repair'],
  },
  site: {
    title: 'Site / Installation', link: 'project', linkLabel: 'Site / project', target: 'Planned', done: 'Done', rejected: 'Snags', uom: 'Sq. Ft',
    works: ['Wall panel erection', 'Ceiling panel erection', 'Plenum / riser', 'Ducting & insulation', 'AHU installation', 'ODU & copper piping', 'Electrical cabling', 'Door installation',
      'Self-levelling', 'Vinyl flooring', 'Pendant installation', 'Testing & air balancing', 'Snag rectification', 'Unloading / shifting'],
  },
  design: {
    title: 'Design', link: 'project', linkLabel: 'Project', target: 'Planned', done: 'Done', rejected: 'Revisions', uom: 'Drawings',
    works: ['Site measurement', 'GA / layout drawing', 'Shop / fabrication drawing', 'BOQ / bill of material', 'Drawing revision', 'Client approval follow-up', 'As-built drawing'],
  },
  hvac: {
    title: 'HVAC', link: 'project', linkLabel: 'Project', target: 'Planned', done: 'Done', rejected: 'Rework', uom: 'Tasks',
    works: ['Heat load calculation', 'AHU / ODU selection', 'Duct design & drawing', 'HVAC technical data sheet', 'Site supervision', 'Testing & air balancing', 'Validation support'],
  },
  project: {
    title: 'Project', link: 'project', linkLabel: 'Project', target: 'Planned', done: 'Done', rejected: null, uom: 'Tasks',
    works: ['Site visit / review', 'Client / PMC meeting', 'Schedule update', 'Material follow-up', 'Site team planning', 'RA bill / measurement', 'Handover documents'],
  },
  quality: {
    title: 'Quality', link: 'project', linkLabel: 'Project', target: 'Planned', done: 'Inspected', rejected: 'Rejected / NCR', uom: 'Inspections',
    works: ['IQC (incoming)', 'In-process inspection', 'Final inspection', 'Site QC', 'NCR / CAPA follow-up', 'Calibration'],
  },
  rnd: {
    title: 'R&D', link: 'project', linkLabel: 'Project', target: 'Planned', done: 'Done', rejected: null, uom: 'Tasks',
    works: ['Design', 'Prototype', 'Firmware / software', 'Testing', 'Documentation', 'Support to production / site'],
  },
  store: {
    title: 'Store', link: null, target: null, done: 'Count', rejected: null, uom: 'Slips',
    works: ['GRN entered', 'Issue slips', 'Delivery challans', 'Material arranged for dispatch', 'Stock count', 'IQC support'],
  },
  purchase: {
    title: 'Purchase', link: null, target: 'Target', done: 'Count', rejected: null, uom: 'POs',
    works: ['POs raised', 'PO follow-ups', 'Vendor quotations', 'Vendor visits', 'Payments followed'],
  },
  sales: {
    title: 'Sales', link: null, target: 'Target', done: 'Count', rejected: null, uom: 'Calls',
    works: ['Calls', 'Client visits', 'Enquiries added', 'Quotations sent', 'Follow-ups', 'Orders received'],
  },
  accounts: {
    title: 'Accounts', link: null, target: null, done: 'Count', rejected: null, uom: 'Entries',
    works: ['Vendor bills entered', 'Payments made', 'Receipts', 'Bank reconciliation', 'GST / TDS', 'Invoices'],
  },
  general: { title: 'General', link: null, target: 'Target', done: 'Done', rejected: null, uom: 'Nos', works: [] },
};
const MATCH = [[/prod/i, 'production'], [/design/i, 'design'], [/hvac/i, 'hvac'], [/^project/i, 'project'], [/electr|wiring/i, 'electrical'], [/site|install/i, 'site'], [/qualit|\bqc\b/i, 'quality'], [/r\s*&\s*d|research/i, 'rnd'],
  [/store/i, 'store'], [/purchas/i, 'purchase'], [/sales|marketing/i, 'sales'], [/account|finance/i, 'accounts']];
export function workFormat(department) {
  const hit = MATCH.find(([re]) => re.test(String(department || '')));
  return { key: hit ? hit[1] : 'general', ...F[hit ? hit[1] : 'general'] };
}
