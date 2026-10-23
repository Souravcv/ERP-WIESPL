// Single source of truth for every CRM/ERP module.
// The server builds tables, validation and joins from this; the browser builds forms and lists from it.
// Field types: text, textarea, number, money, date, select, yn, ref, person, email, tel, lines, json
// `computed` fields are read-only SQL expressions evaluated by the server ({t} = the entity's table alias).

export const ROLES = ['admin', 'manager', 'sales', 'accounts', 'store', 'engineer', 'purchase', 'purchase_head', 'technical', 'production', 'service'];

const ALL = ROLES;
const CRM = ['admin', 'manager', 'sales'];
const ACC = ['admin', 'manager', 'accounts'];
const PURCHASE = ['admin', 'manager', 'purchase', 'purchase_head', 'accounts', 'store'];
const STORE = ['admin', 'manager', 'store', 'purchase', 'purchase_head', 'accounts'];
const ENG = ['admin', 'manager', 'engineer', 'sales', 'technical'];
const SERVICE = ['admin', 'manager', 'service', 'engineer'];

// GSTIN state codes: the first two digits of a GSTIN give the supplier's state.
export const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
export const STATES = ['Maharashtra', ...Object.values(GST_STATE_CODES).filter(s => s !== 'Maharashtra').sort(), 'Other'];

export const ITEM_CATEGORIES = ['Bought-out', 'HVAC', 'Electrical (BGM)', 'R&D (Electronic)', 'Hardware', 'Raw Materials', 'Finished Goods', 'Packaging', 'Tools'];
export const UOMS = ['Nos', 'Set', 'Pair', 'Kg', 'Mtr', 'RFt', 'Ft', 'Sq. Ft', 'Sq. Mtr', 'Roll', 'Sheet', 'TR', 'Ltr', 'Pkt', 'Box', 'Tin', 'Coil', 'Cyl', 'Bundle', 'Lot'];

// Stock movement types and their effect on store stock.
// Closing = Opening + Inward - Outward - Transfer + Return - Scrap (+/- Adjust), as in the Smart Store workbook.
export const MOVE_TYPES = {
  OPENING: { label: 'Opening Stock (1 April)', sign: 0, doc: 'OPN' },
  INWARD: { label: 'Inward (GRN)', sign: 1, doc: 'GRN' },
  OUTWARD: { label: 'Outward (Issue)', sign: -1, doc: 'ISS' },
  TRANSFER: { label: 'Material Transfer', sign: -1, doc: 'TRF' },
  RETURN: { label: 'Return Material', sign: 1, doc: 'RET' },
  SCRAP: { label: 'Scrap', sign: -1, doc: 'SCR' },
  ADJUST: { label: 'Adjustment (+/-)', sign: 1, doc: 'ADJ' },
  PRODUCED: { label: 'Production (finished goods made)', sign: 1, doc: 'PRD' },
};
const SIGNED_QTY = m => `CASE WHEN ${m}.type IN ('INWARD','IN','RETURN','ADJUST','PRODUCED') THEN ${m}.qty WHEN ${m}.type IN ('OUTWARD','OUT','TRANSFER','SCRAP') THEN -${m}.qty ELSE 0 END`;
// Quantity of a BOQ line sent on challans with the given statuses (challan lines carry boq_item_id).
const BOQ_SENT = statuses => `(SELECT COALESCE(SUM(CAST(json_extract(j.value, '$.qty') AS REAL)), 0) FROM challans c, json_each(c.lines) j
  WHERE c.status IN (${statuses}) AND CAST(json_extract(j.value, '$.boq_item_id') AS INTEGER) = {t}.id)`;
const BOQ_SENT_B = statuses => BOQ_SENT(statuses).replaceAll('{t}', 'b');
// Same for lines of a BOQ / bill of material (challan lines carry bom_item_id).
const BOM_SENT = statuses => BOQ_SENT(statuses).replace('$.boq_item_id', '$.bom_item_id');
const BOM_SENT_B = statuses => BOM_SENT(statuses).replaceAll('{t}', 'b');
// Quantity of a BOQ line on requisitions / purchase orders (their lines carry bom_item_id).
const BOM_ON = (table, statuses, key = 'qty') => `(SELECT COALESCE(SUM(CAST(json_extract(j.value, '$.${key}') AS REAL)), 0) FROM ${table} p, json_each(p.lines) j
  WHERE p.status IN (${statuses}) AND CAST(json_extract(j.value, '$.bom_item_id') AS INTEGER) = {t}.id)`;
const PO_LIVE = "'Draft','Pending Approval','Approved','Sent','Partially Received','Received','Closed'";
const REQ_LIVE = "'Draft','Submitted','Approved','Converted to PO'";
// Current stock: the latest 1-April opening entry (or the legacy opening field) plus every movement since it.
// Only openings dated today or earlier count, so an opening entered in advance for next April changes nothing yet.
const OPEN_OK = `o.item_id = {t}.id AND o.type = 'OPENING' AND o.date <= date('now', 'localtime')`;
export const STOCK_SQL = `(CASE WHEN EXISTS (SELECT 1 FROM stock_moves o WHERE ${OPEN_OK})
    THEN (SELECT o.qty FROM stock_moves o WHERE ${OPEN_OK} ORDER BY o.date DESC, o.id DESC LIMIT 1)
    ELSE COALESCE({t}.opening_stock, 0) END
  + (SELECT COALESCE(SUM(${SIGNED_QTY('m')}), 0) FROM stock_moves m WHERE m.item_id = {t}.id
      AND m.date >= COALESCE((SELECT MAX(o.date) FROM stock_moves o WHERE ${OPEN_OK}), '0000-00-00')))`;

// ---------------------------------------------------------------- roles & permissions
// Built-in roles; admins can edit them and create new ones under Admin → Roles & Permissions.
export const ROLE_INFO = {
  admin: { label: 'Administrator', description: 'Everything, incl. users, roles, settings and backup' },
  manager: { label: 'General Manager', description: 'Everything + final (GM) approval of POs, quotation approval, deletes records' },
  sales: { label: 'Sales', description: 'Customers, enquiries, follow-ups, quotations, catalog' },
  accounts: { label: 'Account Manager', description: 'Commercial step of POs (prices, payment terms & due dates), sales orders, invoices, payments, vendors' },
  store: { label: 'Store', description: 'Item master, stock inward / issue / transfer / return / scrap, opening stock' },
  engineer: { label: 'Site Engineer', description: 'Projects, material/drawing approvals, service tickets, material issue' },
  purchase: { label: 'Purchase Executive', description: 'Vendors, requisitions, prepares purchase orders' },
  purchase_head: { label: 'Purchase Head', description: 'Approves material requisitions, checks POs; purchase and store' },
  technical: { label: 'Technical Manager', description: 'Projects, BOQs and drawings' },
  production: { label: 'Production Supervisor', description: 'Material requests to the store, production stock, finished goods made per day' },
  service: { label: 'Service Coordinator', description: 'Complaints, AMC / warranty register, service work orders, service reports, RCA, service quotations' },
};

// What each built-in profile works with; everything else is hidden from it (an admin can still change this under
// Roles & Permissions). Admin and GM see everything.
const BOQ_VIEW = ['boqs', 'boq_items', 'boms', 'bom_items', 'material_lists'];
const SERVICE_VIEW = ['service_tickets', 'amc_contracts', 'service_work_orders', 'service_reports', 'rca_reports'];
export const ROLE_SEES = {
  sales: ['customers', 'contacts', 'enquiries', 'followups', 'quotations', 'products', 'approvals', 'material_approvals', 'sales_orders', 'projects', 'costing_sheets', 'items'],
  accounts: ['customers', 'contacts', 'quotations', 'approvals', 'sales_orders', 'projects', 'challans', 'invoices', 'payments', 'credit_notes', 'vendors', 'requisitions',
    'purchase_orders', 'vendor_bills', 'debit_notes', 'vendor_payments', 'expenses', 'items', 'stock_moves', 'amc_contracts', 'costing_sheets'],
  store: ['approvals', ...BOQ_VIEW, 'challans', 'vendors', 'requisitions', 'purchase_orders', 'items', 'stock_moves', 'stock_drafts', 'material_requests', 'production_entries', 'service_work_orders'],
  engineer: ['approvals', 'material_approvals', 'projects', ...BOQ_VIEW, 'challans', ...SERVICE_VIEW, 'material_requests', 'items', 'stock_moves', 'stock_drafts'],
  purchase: ['approvals', 'projects', ...BOQ_VIEW, 'vendors', 'requisitions', 'purchase_orders', 'items', 'stock_moves', 'material_requests'],
  purchase_head: ['approvals', 'projects', ...BOQ_VIEW, 'challans', 'vendors', 'requisitions', 'purchase_orders', 'debit_notes', 'items', 'stock_moves', 'stock_drafts', 'material_requests', 'production_entries'],
  technical: ['approvals', 'material_approvals', 'projects', ...BOQ_VIEW, 'products', 'requisitions', 'purchase_orders', 'items', 'material_requests', ...SERVICE_VIEW],
  production: ['approvals', 'material_requests', 'production_entries', 'items', 'stock_drafts', 'boms', 'bom_items', 'material_lists'],
  service: ['customers', 'contacts', 'approvals', ...SERVICE_VIEW, 'material_requests', 'costing_sheets', 'items', 'invoices'],
};
export const roleSees = (role, entity) => !ROLE_SEES[role] || ROLE_SEES[role].includes(entity);

// Special actions a role may be allowed, beyond module access.
export const FUNCTIONS = {
  approve_quotation: 'Approve quotations',
  approve_sales_order: 'Approve sales orders (GM)',
  approve_requisition: 'Approve material requisitions (Purchase Head step)',
  po_check: 'PO step 1 – Purchase approval (Purchase Head: vendor, material & quantity)',
  po_technical: 'PO step 2 – Technical approval (Technical Manager: specifications)',
  po_commercial: 'PO step 3 – Commercial approval: prices, charges, payment terms & due dates',
  po_final: 'PO step 4 – Final approval by GM',
  stock_opening: 'Create 1 April opening stock for all items',
  stock_post: 'Post draft issue slips / dispatch challans / transfers (reduces stock) and process material requests',
  production_post: 'Post production entries (finished goods into stock)',
  allow_negative: 'Issue more than the available stock',
  import: 'Import from Excel',
  view_audit: 'See change history / activity log',
  notify_requisition: 'Pop-up: new material requisition',
  notify_po: 'Pop-up: new purchase order',
  notify_boq: 'Pop-up: new BOQ (bill of material)',
  notify_work_order: 'Pop-up: new work order',
  notify_enquiry: 'Pop-up: new enquiry from the client website form',
  pay_approve: 'Payments & expenses – approve (Accounts), up to the approval limit',
  pay_final: 'GM – payments & expenses above the limit / outside the PO terms, 3-way overrides, reversals; credit notes, receipt reversals, invoice cancellation',
  pay_record: 'Payments & expenses – mark as paid with UTR / cheque no',
  boq_review: 'BOQ – review / edit department sections (design review)',
  boq_final: 'BOQ – make Final (freeze, reserve stock, auto requisition) and reopen',
  notify_store_check: 'Pop-up: BOQ final – store stock check & auto requisition',
  notify_material_request: 'Pop-up: new material request to the store',
};
// Departments a BOQ section belongs to; each one is reviewed before the BOQ can be made Final.
export const DEPARTMENTS = ['Design', 'HVAC', 'Electrical', 'Production / Panels', 'Doors', 'MGPS', 'Flooring / Civil', 'Lighting', 'Bought-out'];
// Pop-up notifications per new document; approval requests always go to whoever may approve that step.
export const NOTIFY_FUNCTIONS = { material_requests: 'notify_material_request', requisitions: 'notify_requisition', purchase_orders: 'notify_po', boms: 'notify_boq', boqs: 'notify_work_order' };
export const DEFAULT_FUNCTIONS = {
  manager: Object.keys(FUNCTIONS),
  purchase_head: ['approve_requisition', 'po_check', 'stock_opening', 'stock_post', 'import', 'notify_requisition', 'notify_po', 'notify_boq', 'notify_work_order', 'notify_store_check'],
  technical: ['notify_work_order', 'notify_boq', 'boq_review', 'boq_final', 'po_technical'],
  accounts: ['po_commercial', 'import', 'notify_po', 'pay_approve', 'pay_record'],
  store: ['stock_opening', 'stock_post', 'production_post', 'notify_material_request', 'import', 'notify_po', 'notify_boq', 'notify_work_order', 'notify_store_check'],
  purchase: ['import', 'notify_requisition', 'notify_po', 'notify_boq'],
  sales: ['import', 'notify_enquiry'],
  engineer: ['notify_work_order', 'boq_review'],
  production: ['production_post'],
  service: ['import'],
};
export const ACCESS_LEVELS = { none: 'No access', view: 'View', edit: 'View + add / edit', full: 'Full (incl. delete)' };

// Approval steps; who may approve is the role's function list.
export const APPROVAL_FLOWS = {
  Quotation: [{ stage: 'Approval', fn: 'approve_quotation' }],
  'Sales Order': [{ stage: 'GM', fn: 'approve_sales_order' }],
  Requisition: [{ stage: 'Purchase Head', fn: 'approve_requisition' }],
  // As on the printed PO: Purchase → Technical → Commercial → GM.
  'Purchase Order': [
    { stage: 'Purchase Approval', fn: 'po_check', field: 'purchase_approved_by' },
    { stage: 'Technical Approval', fn: 'po_technical', field: 'tech_approved_by' },
    { stage: 'Commercial', fn: 'po_commercial', field: 'comm_approved_by' },
    { stage: 'Approved By (GM)', fn: 'po_final', field: 'approved_by' },
  ],
  // Accounts approves; the GM step is added only above the approval limit or outside the PO terms.
  Payment: [{ stage: 'Accounts', fn: 'pay_approve' }, { stage: 'GM', fn: 'pay_final' }],
  Expense: [{ stage: 'Accounts', fn: 'pay_approve' }, { stage: 'GM', fn: 'pay_final' }],
  'Credit Note': [{ stage: 'GM', fn: 'pay_final' }],
};
const BILL_DN = '(SELECT COALESCE(SUM(d.amount),0) FROM debit_notes d WHERE d.bill_id = {t}.id)';
const BILL_DIRECT = "(SELECT COALESCE(SUM(p.amount),0) FROM vendor_payments p WHERE p.bill_id = {t}.id AND p.status = 'Paid')";
const BILL_OWN = `(COALESCE({t}.amount,0) - ${BILL_DN} - ${BILL_DIRECT})`;
// Advances (paid, no bill) on the PO, less what earlier bills of the PO already took.
const BILL_ADJ = `MAX(0, MIN(${BILL_OWN}, (SELECT COALESCE(SUM(p.amount),0) FROM vendor_payments p WHERE p.po_id = {t}.po_id AND p.bill_id IS NULL AND p.status = 'Paid')
  - (SELECT COALESCE(SUM(b2.amount - (SELECT COALESCE(SUM(d.amount),0) FROM debit_notes d WHERE d.bill_id = b2.id) - (SELECT COALESCE(SUM(p.amount),0) FROM vendor_payments p WHERE p.bill_id = b2.id AND p.status = 'Paid')), 0)
     FROM vendor_bills b2 WHERE b2.po_id = {t}.po_id AND (b2.bill_date < {t}.bill_date OR (b2.bill_date = {t}.bill_date AND b2.id < {t}.id)))))`;
export const TDS_SECTIONS = { '': 0, '194C – Contractor / job work': 2, '194C – Contractor (individual / HUF)': 1, '194J – Professional / technical': 10, '194I – Rent': 10, '194H – Commission': 5, '194Q – Purchase of goods': 0.1 };
export const EXPENSE_NO_PO = ['Salary / Wages', 'Rent', 'Electricity / Utilities', 'Statutory / Govt fees', 'Travel / Conveyance', 'Food / Lodging'];
export const EXPENSE_CATEGORIES = [...EXPENSE_NO_PO, 'Site expenses (petty)', 'Courier / Postage', 'Repairs (small)', 'Other'];
// TDS the customer deducts when paying us (we claim it against Form 26AS / the Form 16A they send).
export const CUSTOMER_TDS = ['', '194C – Contract work', '194J – Professional / technical', '194Q – Purchase of goods', 'GST TDS (Govt, sec 51)', 'Other'];
export const MILESTONE_TRIGGERS = ['With PO / advance', 'Before dispatch', 'On delivery', 'On installation', 'On commissioning / handover', 'Running bill', 'Other'];
export const RECEIPT_KINDS = ['Against invoice', 'Advance (against sales order)'];
// Receivables. A receipt settles amount received + TDS deducted by the customer. Advances received on a sales order
// are adjusted against its tax invoices, oldest invoice first. Retention is the part of an invoice the customer holds
// until the retention date.
const INV_LIVE = "({t}.type = 'Tax Invoice' AND {t}.status NOT IN ('Draft', 'Cancelled'))";
const INV_RCV = "(SELECT COALESCE(SUM(p.amount + COALESCE(p.tds_amount, 0)), 0) FROM payments p WHERE p.invoice_id = {t}.id AND p.status = 'Received')";
const INV_TDS = "(SELECT COALESCE(SUM(p.tds_amount), 0) FROM payments p WHERE p.invoice_id = {t}.id AND p.status = 'Received')";
const INV_CN = "(SELECT COALESCE(SUM(c.total), 0) FROM credit_notes c WHERE c.invoice_id = {t}.id AND c.status = 'Approved')";
const INV_OWN = `(COALESCE({t}.total, 0) - ${INV_CN} - ${INV_RCV})`;
const INV_ADJ = `(CASE WHEN ${INV_LIVE} AND {t}.sales_order_id IS NOT NULL THEN MAX(0, MIN(${INV_OWN},
  (SELECT COALESCE(SUM(p.amount + COALESCE(p.tds_amount, 0)), 0) FROM payments p WHERE p.sales_order_id = {t}.sales_order_id AND p.kind = 'Advance (against sales order)' AND p.status = 'Received')
  - (SELECT COALESCE(SUM(MAX(0, i2.total - (SELECT COALESCE(SUM(c.total), 0) FROM credit_notes c WHERE c.invoice_id = i2.id AND c.status = 'Approved')
      - (SELECT COALESCE(SUM(p.amount + COALESCE(p.tds_amount, 0)), 0) FROM payments p WHERE p.invoice_id = i2.id AND p.status = 'Received'))), 0)
     FROM invoices i2 WHERE i2.sales_order_id = {t}.sales_order_id AND i2.type = 'Tax Invoice' AND i2.status NOT IN ('Draft', 'Cancelled')
       AND (i2.date < {t}.date OR (i2.date = {t}.date AND i2.id < {t}.id))))) ELSE 0 END)`;
const INV_BAL = `(CASE WHEN {t}.type = 'Proforma Invoice' AND {t}.status <> 'Cancelled' THEN COALESCE({t}.total, 0) - ${INV_RCV} WHEN ${INV_LIVE} THEN ${INV_OWN} - ${INV_ADJ} ELSE 0 END)`;
const INV_RET = `(CASE WHEN ${INV_LIVE} THEN MIN(MAX(${INV_BAL}, 0), COALESCE({t}.retention_amount, 0)) ELSE 0 END)`;
const SO_RCPT = "(SELECT COALESCE(SUM(p.amount + COALESCE(p.tds_amount, 0)), 0) FROM payments p WHERE p.sales_order_id = {t}.id AND p.status = 'Received')";
const SO_INV = "(SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.sales_order_id = {t}.id AND i.type = 'Tax Invoice' AND i.status NOT IN ('Draft', 'Cancelled'))";
const SO_CN = "(SELECT COALESCE(SUM(c.total), 0) FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id WHERE i.sales_order_id = {t}.id AND c.status = 'Approved')";
const RECEIVED_VALUE = "(SELECT COALESCE(SUM(m.qty * COALESCE(m.rate, 0)), 0) FROM stock_moves m WHERE m.type = 'INWARD' AND m.po_id = {t}.id)";
const PAID = "(SELECT COALESCE(SUM(p.amount),0) FROM vendor_payments p WHERE p.po_id = {t}.id AND p.status = 'Paid')";
const DEBITED = "(SELECT COALESCE(SUM(d.amount),0) FROM debit_notes d WHERE d.po_id = {t}.id)";

const LINE_COLS = [
  { key: 'description', label: 'Description', type: 'text', width: 320 },
  { key: 'hsn', label: 'HSN/SAC', type: 'text', width: 90 },
  { key: 'qty', label: 'Qty', type: 'number', width: 80 },
  { key: 'uom', label: 'UOM', type: 'text', width: 70 },
  { key: 'rate', label: 'Rate', type: 'money', width: 110 },
  { key: 'gst', label: 'GST %', type: 'number', width: 70 },
];

export const ENTITIES = {
  // ---------------------------------------------------------------- CRM
  customers: {
    label: 'Customers', singular: 'Customer', group: 'CRM', icon: '🏥', write: CRM.concat('accounts'),
    display: "{t}.name",
    search: ['name', 'contact_person', 'phone', 'place', 'district', 'gstin'],
    list: ['name', 'category', 'contact_person', 'phone', 'place', 'district', 'state'],
    related: [['contacts', 'customer_id'], ['enquiries', 'customer_id'], ['quotations', 'customer_id'], ['sales_orders', 'customer_id'], ['projects', 'customer_id'], ['invoices', 'customer_id'], ['service_tickets', 'customer_id']],
    fields: [
      { key: 'name', label: 'Hospital / Customer Name', type: 'text', required: true, span: 2 },
      { key: 'category', label: 'Category', type: 'select', options: ['Hospital', 'Clinic', 'Consultant', 'Architect', 'Contractor', 'Government', 'Dealer', 'Other'], default: 'Hospital' },
      { key: 'contact_person', label: 'Contact Person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address', type: 'textarea', span: 2 },
      { key: 'place', label: 'Place / City', type: 'text' },
      { key: 'district', label: 'District', type: 'text' },
      { key: 'state', label: 'State', type: 'select', options: STATES, default: 'Maharashtra' },
      { key: 'pincode', label: 'Pincode', type: 'text' },
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'pan', label: 'PAN', type: 'text', hint: 'For the TDS they deduct (Form 26AS)' },
      { key: 'credit_days', label: 'Credit Days', type: 'number', default: 30, hint: 'Invoice due date = invoice date + these days, unless the milestone says otherwise' },
      { key: 'capacity', label: 'Hospital Capacity (beds)', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
  },
  contacts: {
    label: 'Contacts', singular: 'Contact', group: 'CRM', icon: '👤', write: CRM,
    display: "{t}.name",
    search: ['name', 'phone', 'email', 'designation'],
    list: ['name', 'designation', 'customer_id', 'phone', 'email'],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'designation', label: 'Role', type: 'select', options: ['Doctor', 'Consultant', 'Architect', 'Owner / Director', 'Purchase', 'Administrator', 'Biomedical Engineer', 'Contractor', 'Other'], default: 'Doctor' },
      { key: 'customer_id', label: 'Hospital / Organisation', type: 'ref', ref: 'customers' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
  },
  enquiries: {
    label: 'Enquiry Register', singular: 'Enquiry', group: 'CRM', icon: '📋', write: CRM,
    display: "{t}.enquiry_no || ' · ' || COALESCE({t}.hospital_name, '')",
    search: ['enquiry_no', 'quote_ref', 'place', 'district', 'doctor_name', 'hospital_name', 'consultant_name', 'type_of_work', 'remarks', 'enquiry_by', 'quoted_by'],
    list: ['enquiry_no', 'quote_ref', 'date', 'hospital_name', 'doctor_name', 'place', 'type_of_work', 'enquiry_by', 'lead_grade', 'status', 'next_followup'],
    statusField: 'status',
    related: [['followups', 'enquiry_id'], ['quotations', 'enquiry_id']],
    fields: [
      { key: 'enquiry_no', label: 'Enquiry No.', type: 'text', readonly: true, hint: 'Auto: NN/MM/FY' },
      { key: 'quote_ref', label: 'Quotation Ref No', type: 'text', readonly: true, hint: 'Auto: WIESPL/NN/MMYY' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: 'today' },
      { key: 'status', label: 'Quotation Status', type: 'select', options: ['New', 'In Process', 'Quoted', 'Negotiation', 'Won', 'Lost', 'Closed', 'On Hold', 'Regret'], default: 'In Process', hint: 'Won = order received' },
      { key: 'customer_id', label: 'Hospital (from Customers)', type: 'ref', ref: 'customers' },
      { key: 'hospital_name', label: 'Name of the Hospital', type: 'text' },
      { key: 'place', label: 'Place', type: 'text' },
      { key: 'district', label: 'District', type: 'text' },
      { key: 'doctor_name', label: 'Name of the Doctor', type: 'text' },
      { key: 'doctor_phone', label: 'Doctor Contact No.', type: 'tel' },
      { key: 'consultant_name', label: 'Consultant / Architect', type: 'text' },
      { key: 'consultant_phone', label: 'Consultant Contact No.', type: 'tel' },
      { key: 'type_of_work', label: 'Type of Work', type: 'text', hint: 'e.g. MOT, NICU, ICU, CSSD, Cath Lab', suggest: ['MOT', 'MOT + Passage', 'MOT/ICU', 'MOT/NICU', 'MICU', 'NICU', 'ICU', 'PICU', 'CSSD', 'Cath Lab', 'Modular Cathlab', 'IVF Lab', 'Isolation Room', 'Clean Room', 'Sterile Store', 'Door', 'Lead Door', 'PCGI Door', 'SS 304 Door', 'Scrub', 'Wall Panel', 'Storage / Glass Panel', 'Flooring', 'Pendant', 'HVAC', 'Built ODU with AHU', 'Govt Tender MOT'] },
      { key: 'capacity', label: 'Hospital Capacity', type: 'text' },
      { key: 'enquiry_by', label: 'Enquiry By', type: 'person', suggest: ['Saurabh', 'Pratiksha', 'SDP', 'Sir', 'Ashwin', 'Balaji', 'IM', 'Website'] },
      { key: 'supported_by', label: 'Supported By', type: 'person', suggest: ['Ashwin/Jai'] },
      { key: 'quoted_by', label: 'Quoted By', type: 'person', suggest: ['Pratiksha'] },
      { key: 'drawing_received', label: 'Drawing Received', type: 'yn' },
      { key: 'source', label: 'Lead Source', type: 'select', options: ['', 'Direct', 'Consultant / Architect', 'Reference', 'Website', 'Exhibition', 'Tender', 'Existing Customer', 'Dealer', 'Other'] },
      { key: 'expected_value', label: 'Expected Value (₹)', type: 'money' },
      { key: 'next_followup', label: 'Next Follow-up', type: 'date' },
      { key: 'kickback', label: 'Kick Back Involved Y/N', type: 'yn' },
      { key: 'remarks', label: 'Remarks / Feedback', type: 'textarea', span: 2 },
      { key: 'lost_reason', label: 'Lost / Regret Reason', type: 'text', span: 2 },
      { key: 'verified_by', label: 'Verified By', type: 'person', suggest: ['Sir'] },
      { key: 'verified_date', label: 'Verified Date', type: 'date' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'whatsapp', label: 'WhatsApp on this number', type: 'yn' },
      { key: 'best_time', label: 'Best time to call', type: 'text' },
      { key: 'lead_score', label: 'Lead score (0–100)', type: 'number', readonly: true, hint: 'From the website form: timeline, budget, size' },
      { key: 'lead_grade', label: 'Lead', type: 'select', options: ['', 'Hot', 'Warm', 'Cold'] },
      { key: 'web_summary', label: 'What the client told us (website form)', type: 'textarea', span: 2, rows: 8, readonly: true },
      { key: 'design_brief', label: 'Detailed requirements (surgeon / hospital brief)', type: 'textarea', span: 2, rows: 12, readonly: true, hint: 'From the 📋 Detailed requirement form' },
      // internal: client profile (sales questionnaire) and MIS — never shown to the client
      { key: 'client_profile', label: 'Client profile (internal)', type: 'select', options: ['', 'Cost-sensitive', 'Balanced', 'Quality-sensitive'], hint: 'From the 🧭 Client profile questionnaire' },
      { key: 'budget_range', label: 'Budget range (internal)', type: 'select', options: ['', 'Under ₹50 lakh', '₹50 lakh – 1 crore', '₹1 – 2 crore', '₹2 – 5 crore', 'Above ₹5 crore', 'Not disclosed'] },
      { key: 'decision_maker', label: 'Decision maker', type: 'select', options: ['', 'Owner doctor', 'Board / trustees', 'Purchase committee', 'Government tender', 'Consultant / architect'] },
      { key: 'client_taste', label: 'Client taste & priorities', type: 'textarea', span: 2, rows: 2, hint: 'e.g. premium look, organic / health-conscious, Vastu, latest technology' },
      { key: 'institution_name', label: 'MIS – Institution / trust / group', type: 'text' },
      { key: 'board_members', label: 'MIS – Board of Directors / trustees', type: 'textarea', span: 2, rows: 3 },
      { key: 'financial_status', label: 'MIS – Financial strength / purchasing power', type: 'textarea', span: 2, rows: 2, hint: 'e.g. part of a large media group; self-funded; loan needed' },
      { key: 'profile_answers', label: 'Client profile questionnaire answers', type: 'textarea', span: 2, rows: 6, hint: 'Filled by the questionnaire; you can add notes' },
      { key: 'fy', label: 'FY', type: 'text', hidden: true },
      { key: 'seq', label: 'Seq', type: 'number', hidden: true },
    ],
  },
  followups: {
    label: 'Follow-ups', singular: 'Follow-up', group: 'CRM', icon: '📞', write: CRM.concat('engineer'),
    display: "{t}.date || ' ' || {t}.mode",
    search: ['notes', 'assigned_to', 'mode'],
    list: ['date', 'enquiry_id', 'customer_id', 'mode', 'notes', 'assigned_to', 'next_date', 'status'],
    statusField: 'status',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true, default: 'today' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['Call', 'Visit', 'Email', 'WhatsApp', 'Meeting', 'Presentation'], default: 'Call' },
      { key: 'enquiry_id', label: 'Enquiry', type: 'ref', ref: 'enquiries' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { key: 'notes', label: 'Discussion / Notes', type: 'textarea', span: 2, required: true },
      { key: 'assigned_to', label: 'Assigned To', type: 'person', default: 'me' },
      { key: 'next_date', label: 'Next Follow-up Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Done'], default: 'Open' },
    ],
  },
  quotations: {
    label: 'Quotations', singular: 'Quotation', group: 'CRM', icon: '🧾', write: CRM, editor: 'quotation',
    display: "{t}.quote_no",
    search: ['quote_no', 'subject', 'to_address', 'prepared_by'],
    list: ['quote_no', 'date', 'customer_id', 'enquiry_id', 'subject', 'grand_total', 'status', 'prepared_by'],
    statusField: 'status',
    fields: [
      { key: 'quote_no', label: 'Quotation No', type: 'text', readonly: true },
      { key: 'revision', label: 'Revision', type: 'number', default: 0, readonly: true },
      { key: 'date', label: 'Date', type: 'date', default: 'today' },
      { key: 'enquiry_id', label: 'Enquiry', type: 'ref', ref: 'enquiries' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { key: 'to_address', label: 'To (address block)', type: 'textarea' },
      { key: 'subject', label: 'Subject', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Sent', 'Won', 'Lost', 'Superseded'], default: 'Draft', readonly: true },
      { key: 'gst_rate', label: 'GST %', type: 'number', default: 18 },
      { key: 'discount_pct', label: 'Discount %', type: 'number', default: 0 },
      { key: 'basic_total', label: 'Basic Total', type: 'money', readonly: true },
      { key: 'gst_amount', label: 'GST', type: 'money', readonly: true },
      { key: 'grand_total', label: 'Grand Total', type: 'money', readonly: true },
      { key: 'prepared_by', label: 'Prepared By', type: 'person', default: 'me' },
      { key: 'approved_by', label: 'Approved By', type: 'text', readonly: true },
      { key: 'approved_at', label: 'Approved At', type: 'text', readonly: true },
      { key: 'data', label: 'Quotation Data', type: 'json', hidden: true },
    ],
  },
  products: {
    label: 'Product Catalog', singular: 'Product', group: 'CRM', icon: '📦', write: ['admin', 'manager', 'sales'],
    display: "{t}.name",
    search: ['code', 'name', 'category', 'description'],
    list: ['boq_set', 'sort', 'code', 'name', 'kind', 'category', 'uom', 'rate', 'install_pct', 'gst_rate', 'qty_basis', 'active'],
    fields: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'name', label: 'Short Name', type: 'text', required: true },
      { key: 'kind', label: 'Line Type', type: 'select', options: ['Item', 'Heading'], default: 'Item', hint: 'Heading = specification row without qty, followed by size items' },
      { key: 'sort', label: 'Order in Standard BOQ', type: 'number', hint: 'Blank = not part of the standard BOQ' },
      { key: 'boq_set', label: 'Standard BOQ', type: 'text', hint: 'e.g. SS 304 MOT; blank = the main MOT BOQ', suggest: ['SS 304 MOT', 'PPGL MOT'] },
      { key: 'category', label: 'Category', type: 'select', options: ['HVAC', 'LAF / Plenum', 'Control Panels', 'Modular Panels', 'Doors', 'Flooring', 'Lighting', 'Pendants', 'Furniture / Storage', 'Accessories', 'Validation / Services', 'Optional', 'Other'], default: 'HVAC' },
      { key: 'uom', label: 'UOM', type: 'select', options: ['Each', 'No', 'Set', 'Sq. Ft', 'R. Ft', 'Rmt', 'Kg', 'Lot', 'Job'], default: 'Each' },
      { key: 'rate', label: 'Rate (₹)', type: 'money' },
      { key: 'install_pct', label: 'Installation % of Rate', type: 'number', default: 0 },
      { key: 'qty_basis', label: 'Quantity Basis', type: 'select', options: ['manual', 'walls', 'ceiling', 'coving', 'flooring'], default: 'manual', hint: 'Area items pull quantity from Basis of Design' },
      { key: 'default_qty', label: 'Default Qty per Room', type: 'number', default: 1 },
      { key: 'hsn', label: 'HSN / SAC', type: 'text' },
      { key: 'gst_rate', label: 'GST %', type: 'number', default: 18 },
      { key: 'active', label: 'Active', type: 'yn', default: 'Yes' },
      { key: 'description', label: 'Full Specification (printed in BOQ)', type: 'textarea', span: 2, rows: 12 },
    ],
  },

  // ---------------------------------------------------------------- Approvals
  approvals: {
    label: 'Approval Requests', singular: 'Approval', group: 'Approvals', icon: '✅', write: ALL, noCreate: true,
    display: "{t}.doc_type || ' ' || COALESCE({t}.doc_ref, '')",
    totalOnceBy: ['doc_type', 'doc_id'],
    search: ['doc_type', 'doc_ref', 'title', 'requested_by', 'comments'],
    list: ['requested_at', 'doc_type', 'doc_ref', 'stage', 'title', 'amount', 'requested_by', 'status', 'decided_by'],
    statusField: 'status',
    fields: [
      { key: 'doc_type', label: 'Document Type', type: 'select', options: ['Quotation', 'Sales Order', 'Purchase Order', 'Requisition', 'Payment', 'Expense', 'Credit Note', 'Discount', 'Other'], readonly: true },
      { key: 'stage', label: 'Approval Step', type: 'text', readonly: true },
      { key: 'doc_id', label: 'Document ID', type: 'number', hidden: true },
      { key: 'doc_ref', label: 'Document Ref', type: 'text', readonly: true },
      { key: 'title', label: 'Title', type: 'text', readonly: true, span: 2 },
      { key: 'amount', label: 'Amount', type: 'money', readonly: true },
      { key: 'requested_by', label: 'Requested By', type: 'text', readonly: true },
      { key: 'requested_at', label: 'Requested At', type: 'text', readonly: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Rejected'], readonly: true },
      { key: 'decided_by', label: 'Decided By', type: 'text', readonly: true },
      { key: 'decided_at', label: 'Decided At', type: 'text', readonly: true },
      { key: 'comments', label: 'Comments', type: 'textarea', span: 2 },
    ],
  },
  material_approvals: {
    label: 'Material / Drawing Approvals', singular: 'Material Approval', group: 'Approvals', icon: '🧱', write: ENG,
    display: "{t}.submittal_no || ' ' || COALESCE({t}.item_name, '')",
    search: ['submittal_no', 'item_name', 'make', 'specification', 'submitted_to', 'client_remarks'],
    list: ['submittal_no', 'project_id', 'category', 'item_name', 'make', 'submitted_date', 'status', 'approval_date'],
    statusField: 'status',
    fields: [
      { key: 'submittal_no', label: 'Submittal No', type: 'text', readonly: true },
      { key: 'revision', label: 'Revision', type: 'number', default: 0 },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', required: true },
      { key: 'category', label: 'Type', type: 'select', options: ['Material', 'Drawing', 'Make / Brand', 'Sample', 'Colour / Finish', 'Technical Datasheet', 'Method Statement'], default: 'Material' },
      { key: 'item_name', label: 'Material / Drawing Title', type: 'text', required: true, span: 2 },
      { key: 'make', label: 'Make / Brand', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'text' },
      { key: 'specification', label: 'Specification / Details', type: 'textarea', span: 2 },
      { key: 'submitted_to', label: 'Submitted To (client / consultant)', type: 'text' },
      { key: 'submitted_date', label: 'Submitted Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Approved', 'Approved with Comments', 'Rejected', 'Resubmit'], default: 'Draft' },
      { key: 'approved_by_client', label: 'Approved By (client)', type: 'text' },
      { key: 'approval_date', label: 'Approval Date', type: 'date' },
      { key: 'client_remarks', label: 'Client Remarks', type: 'textarea', span: 2 },
      { key: 'document_link', label: 'Document Link / File Path', type: 'text', span: 2 },
    ],
  },

  // ---------------------------------------------------------------- Sales & Projects (ERP)
  sales_orders: {
    label: 'Sales Orders', singular: 'Sales Order', group: 'Approvals', icon: '🤝', write: ['admin', 'manager', 'sales', 'accounts'],
    display: "{t}.so_no",
    search: ['so_no', 'client_po_no', 'remarks'],
    list: ['so_no', 'date', 'customer_id', 'quotation_id', 'client_po_no', 'order_value', 'status', 'delivery_date'],
    statusField: 'status',
    related: [['projects', 'sales_order_id'], ['boqs', 'sales_order_id'], ['invoices', 'sales_order_id'], ['payments', 'sales_order_id']],
    fields: [
      { key: 'so_no', label: 'SO No', type: 'text', readonly: true },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { key: 'quotation_id', label: 'Quotation', type: 'ref', ref: 'quotations' },
      { key: 'enquiry_id', label: 'Enquiry', type: 'ref', ref: 'enquiries' },
      { key: 'client_po_no', label: 'Client PO / Work Order No', type: 'text' },
      { key: 'client_po_date', label: 'Client PO Date', type: 'date' },
      { key: 'order_value', label: 'Order Value (basic ₹)', type: 'money' },
      { key: 'gst_rate', label: 'GST %', type: 'number', default: 18 },
      { key: 'total_value', label: 'Total incl. GST', type: 'money', computed: "ROUND(COALESCE({t}.order_value,0) * (1 + COALESCE({t}.gst_rate,0) / 100.0), 2)" },
      { key: 'invoiced', label: 'Invoiced (tax invoices)', type: 'money', computed: `ROUND(${SO_INV}, 2)` },
      { key: 'credited', label: 'Credit Notes', type: 'money', computed: `ROUND(${SO_CN}, 2)` },
      { key: 'received', label: 'Received (incl. TDS)', type: 'money', computed: `ROUND(${SO_RCPT}, 2)` },
      { key: 'receivable', label: 'Receivable (− = advance)', type: 'money', computed: `ROUND(${SO_INV} - ${SO_CN} - ${SO_RCPT}, 2)` },
      { key: 'to_invoice', label: 'Still to Invoice', type: 'money', computed: `ROUND(COALESCE({t}.order_value,0) * (1 + COALESCE({t}.gst_rate,0) / 100.0) - ${SO_INV}, 2)` },
      { key: 'delivery_date', label: 'Committed Delivery', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'In Execution', 'Completed', 'Rejected', 'Cancelled'], default: 'Draft', readonly: true },
      { key: 'approval_stage', label: 'Waiting For', type: 'text', readonly: true },
      { key: 'approved_by', label: 'Approved By (GM)', type: 'text', readonly: true },
      { key: 'payment_terms', label: 'Payment Terms', type: 'textarea', span: 2, default: '50% advance with PO, 45% against PI before dispatch & 5% against installation completion.' },
      { key: 'milestones', label: 'Billing Milestones', type: 'lines', span: 2, hint: 'Invoices are raised against these (Create Invoice); the % add up to 100',
        default: [{ description: 'Advance with PO', percent: 50, trigger: 'With PO / advance', days: 0 }, { description: 'Against PI before dispatch', percent: 45, trigger: 'Before dispatch', days: 0 }, { description: 'On installation completion', percent: 5, trigger: 'On installation', days: 30 }],
        columns: [{ key: 'description', label: 'Milestone', type: 'text', width: 300 }, { key: 'percent', label: '%', type: 'number', width: 70 },
          { key: 'trigger', label: 'When', type: 'select', options: MILESTONE_TRIGGERS, width: 190 }, { key: 'days', label: 'Credit days', type: 'number', width: 90 }] },
      { key: 'retention_pct', label: 'Retention %', type: 'number', default: 0, hint: 'Part of each invoice the client holds back (e.g. 5% till handover / defect liability)' },
      { key: 'retention_days', label: 'Retention Released After (days)', type: 'number', default: 365, hint: 'From the invoice date' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  projects: {
    label: 'Projects / Execution', singular: 'Project', group: 'Sales & Projects', icon: '🏗️', write: ENG,
    display: "COALESCE(NULLIF({t}.project_no, ''), {t}.code) || ' ' || {t}.name",
    search: ['code', 'project_no', 'name', 'site', 'site_address', 'engineer', 'notes'],
    list: ['project_no', 'name', 'customer_id', 'site', 'stage', 'material_cost', 'po_value', 'status'],
    statusField: 'status',
    related: [['boqs', 'project_id'], ['boms', 'project_id'], ['challans', 'project_id'], ['requisitions', 'project_id'], ['purchase_orders', 'project_id'], ['stock_moves', 'project_id'], ['material_approvals', 'project_id'], ['invoices', 'project_id'], ['service_tickets', 'project_id']],
    fields: [
      { key: 'code', label: 'Internal Code', type: 'text', readonly: true },
      { key: 'project_no', label: 'Project / Work Order No', type: 'text', hint: 'e.g. WIESPL / 1001 / 04/2026-27' },
      { key: 'name', label: 'Project Name', type: 'text', required: true, hint: 'e.g. Sanjeevani Hospital - Solapur (OT 1, OT 2 & Passage)' },
      { key: 'customer_id', label: 'Client', type: 'ref', ref: 'customers' },
      { key: 'site', label: 'Site / City', type: 'text' },
      { key: 'work_order_date', label: 'Work Order Date', type: 'date' },
      { key: 'sales_order_id', label: 'Sales Order', type: 'ref', ref: 'sales_orders' },
      { key: 'quotation_id', label: 'BOQ / Quotation', type: 'ref', ref: 'quotations' },
      { key: 'material_cost', label: 'Material Issued (₹)', type: 'money', computed: "(SELECT COALESCE(SUM(CASE WHEN m.type IN ('OUTWARD','OUT','TRANSFER') THEN m.qty * COALESCE(m.rate,0) WHEN m.type = 'RETURN' THEN -m.qty * COALESCE(m.rate,0) ELSE 0 END),0) FROM stock_moves m WHERE m.project_id = {t}.id)" },
      { key: 'po_value', label: 'PO Value (₹)', type: 'money', computed: "(SELECT COALESCE(SUM(p.total),0) FROM purchase_orders p WHERE p.project_id = {t}.id AND p.status NOT IN ('Cancelled','Rejected','Draft'))" },
      { key: 'site_address', label: 'Site Address', type: 'textarea', span: 2 },
      { key: 'engineer', label: 'Site Engineer', type: 'person' },
      { key: 'start_date', label: 'Start Date', type: 'date' },
      { key: 'target_date', label: 'Target Completion', type: 'date' },
      { key: 'completion_date', label: 'Actual Completion', type: 'date' },
      { key: 'stage', label: 'Stage', type: 'select', options: ['Drawing Preparation', 'Drawing Approval', 'Material Approval', 'Procurement', 'Fabrication', 'Dispatch', 'Installation', 'Testing & Validation', 'Handover', 'Closed'], default: 'Drawing Preparation' },
      { key: 'progress', label: 'Progress %', type: 'number', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'On Hold', 'Completed', 'Cancelled'], default: 'Active' },
      { key: 'warranty_until', label: 'Warranty Until', type: 'date' },
      { key: 'notes', label: 'Site Notes', type: 'textarea', span: 2 },
    ],
  },
  // Client work order (the customer's Excel, e.g. Lokmanya "Electrical & HVAC - Work Order 1"); table name kept from earlier versions.
  boqs: {
    label: 'Work Orders', singular: 'Work Order', group: 'Sales & Projects', icon: '📂', write: ENG.concat('store', 'purchase', 'purchase_head'), editor: 'boq',
    display: "{t}.boq_no || ' · ' || {t}.title",
    search: ['boq_no', 'title', 'wo_no', 'remarks'],
    list: ['boq_no', 'title', 'project_id', 'wo_no', 'lines', 'sent_lines', 'pending_lines', 'progress', 'status'],
    statusField: 'status',
    related: [['boms', 'work_order_id'], ['challans', 'boq_id']],
    fields: [
      { key: 'boq_no', label: 'WO Ref', type: 'text', readonly: true, hint: 'Auto: WO-001/2026-27' },
      { key: 'title', label: 'Work Order Title', type: 'text', required: true, hint: 'e.g. Lokmanya Hospital – Electrical & HVAC Work Order 1' },
      { key: 'date', label: 'Date', type: 'date', default: 'today' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { key: 'wo_no', label: 'Work Order No(s)', type: 'text' },
      { key: 'sales_order_id', label: 'From Sales Order', type: 'ref', ref: 'sales_orders', readonly: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Completed', 'On Hold'], default: 'Open' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
      { key: 'lines', label: 'Items', type: 'number', computed: "(SELECT COUNT(*) FROM boq_items b WHERE b.boq_id = {t}.id AND b.kind = 'Item')" },
      { key: 'sent_lines', label: 'Fully Sent', type: 'number', computed: `(SELECT COUNT(*) FROM boq_items b WHERE b.boq_id = {t}.id AND b.kind = 'Item' AND b.qty IS NOT NULL AND ${BOQ_SENT_B("'Dispatched','Delivered'")} >= b.qty)` },
      { key: 'pending_lines', label: 'Pending', type: 'number', computed: `(SELECT COUNT(*) FROM boq_items b WHERE b.boq_id = {t}.id AND b.kind = 'Item' AND (b.qty IS NULL OR ${BOQ_SENT_B("'Dispatched','Delivered'")} < b.qty))` },
      { key: 'progress', label: '% Sent', type: 'number', computed: `(SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(100.0 * SUM(CASE WHEN b.qty IS NOT NULL AND ${BOQ_SENT_B("'Dispatched','Delivered'")} >= b.qty THEN 1 ELSE 0 END) / COUNT(*)) END FROM boq_items b WHERE b.boq_id = {t}.id AND b.kind = 'Item')` },
    ],
  },
  boq_items: {
    label: 'Work Order Lines', singular: 'Work Order Line', group: 'Hidden', icon: '📑', write: ENG.concat('store', 'purchase', 'purchase_head'),
    display: "COALESCE({t}.sr_no || ' ', '') || substr(COALESCE({t}.heading || ' › ', '') || {t}.description, 1, 90)",
    search: ['section', 'wo_no', 'sr_no', 'heading', 'description', 'remarks'],
    list: ['section', 'sr_no', 'description', 'uom', 'qty', 'dispatched', 'delivered', 'pending', 'delivery_status'],
    statusField: 'kind',
    fields: [
      { key: 'boq_id', label: 'Work Order', type: 'ref', ref: 'boqs', required: true },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'section', label: 'Section / Annexure', type: 'text', hint: 'e.g. MOT PPGL, Passage, MGPS, Electrical' },
      { key: 'wo_no', label: 'Work Order No', type: 'text' },
      { key: 'sr_no', label: 'Sr. No.', type: 'text' },
      { key: 'kind', label: 'Line Type', type: 'select', options: ['Item', 'Heading'], default: 'Item' },
      { key: 'heading', label: 'Under heading', type: 'text', span: 2 },
      { key: 'description', label: 'Description', type: 'textarea', span: 2, required: true },
      { key: 'uom', label: 'UOM', type: 'text' },
      { key: 'qty', label: 'WO Qty', type: 'number', hint: 'Blank = quantity not fixed (UR)' },
      { key: 'area_qty', label: 'Qty per area', type: 'text', hint: 'e.g. Mj OT 1: 1, Mj OT 2: 1' },
      { key: 'item_id', label: 'Store item (for stock)', type: 'ref', ref: 'items', hint: 'Link to deduct store stock when dispatched' },
      { key: 'product_id', label: 'Catalog product', type: 'ref', ref: 'products', readonly: true },
      { key: 'material_list_id', label: 'Standard material list', type: 'ref', ref: 'material_lists', hint: 'Used by “Generate BOQ”: its components × this line’s qty' },
      { key: 'dispatched', label: 'Dispatched', type: 'number', computed: BOQ_SENT("'Dispatched','Delivered'") },
      { key: 'delivered', label: 'Delivered (site confirmed)', type: 'number', computed: BOQ_SENT("'Delivered'") },
      { key: 'pending', label: 'Pending', type: 'number', computed: `CASE WHEN {t}.qty IS NULL THEN NULL ELSE MAX({t}.qty - ${BOQ_SENT("'Dispatched','Delivered'")}, 0) END` },
      { key: 'delivery_status', label: 'Status', type: 'select', options: ['', 'Pending', 'Partly Dispatched', 'Dispatched', 'Delivered', 'Qty TBD'], computed: `CASE WHEN {t}.kind = 'Heading' THEN ''
        WHEN {t}.qty IS NULL THEN CASE WHEN ${BOQ_SENT("'Dispatched','Delivered'")} > 0 THEN 'Partly Dispatched' ELSE 'Qty TBD' END
        WHEN ${BOQ_SENT("'Delivered'")} >= {t}.qty THEN 'Delivered'
        WHEN ${BOQ_SENT("'Dispatched','Delivered'")} >= {t}.qty THEN 'Dispatched'
        WHEN ${BOQ_SENT("'Dispatched','Delivered'")} > 0 THEN 'Partly Dispatched' ELSE 'Pending' END` },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
      { key: 'sort', label: 'Order', type: 'number', hidden: true },
    ],
  },
  // Standard material list ("recipe") per product the design department keeps: the components for ONE unit of a
  // work-order item (one door, one Sq. Ft of wall panel …). "Generate BOQ" multiplies them by the work-order qty.
  material_lists: {
    label: 'Standard Material Lists', singular: 'Material List', group: 'Sales & Projects', icon: '🧩', write: ENG.concat('purchase_head'),
    display: "COALESCE({t}.code || ' · ', '') || {t}.name",
    search: ['code', 'name', 'department', 'boq_section', 'match_words', 'notes'],
    list: ['code', 'name', 'product_id', 'boq_section', 'department', 'per_uom', 'makes_item_id', 'match_words', 'components', 'active'],
    fields: [
      { key: 'code', label: 'Code', type: 'text', hint: 'e.g. ML-DOOR-HS' },
      { key: 'name', label: 'Product / Item', type: 'text', required: true, hint: 'e.g. Hermetically sealed sliding door (automatic)' },
      { key: 'department', label: 'Department', type: 'select', options: DEPARTMENTS, default: 'Design', hint: 'Its components go to this department for review' },
      { key: 'product_id', label: 'Catalog product', type: 'ref', ref: 'products', hint: 'The quotation product this list is for: a work order made from a quotation uses this list for that product automatically' },
      { key: 'boq_section', label: 'BOQ section', type: 'text', hint: 'Section heading in the bill of material, e.g. MODULAR WALL / CEILING PANEL, PLENUM, CONTROL PANEL (blank = the work-order section)' },
      { key: 'per_uom', label: 'Quantities are per 1', type: 'text', default: 'Nos', suggest: ['Nos', 'Set', 'Sq. Ft', 'Sq. Mtr', 'RFt', 'Mtr', 'Lot'], hint: 'Unit of the work-order line, e.g. 1 Nos door or 1 Sq. Ft of panel' },
      { key: 'makes_item_id', label: 'Sub-assembly: makes store item', type: 'ref', ref: 'items', hint: 'Set this when the list is the build list of something made in-house (e.g. 32" surgeon control panel). Wherever that item appears in a BOQ, these parts are added for the making department' },
      { key: 'match_words', label: 'Match words', type: 'text', span: 2, hint: 'Comma-separated words found in work-order descriptions, e.g. sliding door, hermetic. Used to pick this list automatically' },
      { key: 'active', label: 'Active', type: 'yn', default: 'Yes' },
      { key: 'lines', label: 'Components', type: 'lines', span: 2, itemRef: true, amounts: false, hint: 'Per unit = qty for 1 unit of the work-order line (× its qty). Per job = fixed qty once per BOQ (rivets, silicone, tools …). Pick the store item where there is one, so stock can be checked and reserved', columns: [
        { key: 'description', label: 'Component', type: 'text', width: 220 },
        { key: 'spec', label: 'Specification', type: 'textarea', width: 240 },
        { key: 'dimensions', label: 'Dimensions', type: 'text', width: 100 },
        { key: 'basis', label: 'Qty basis', type: 'select', options: ['Per unit', 'Per job'], width: 96 },
        { key: 'qty', label: 'Qty', type: 'number', width: 80 },
        { key: 'uom', label: 'UOM', type: 'text', width: 64 },
        { key: 'moc', label: 'MOC', type: 'text', width: 90 },
        { key: 'make', label: 'Make', type: 'text', width: 90 },
        { key: 'department', label: 'Department (if different)', type: 'select', options: ['', ...DEPARTMENTS], width: 130 },
      ] },
      { key: 'components', label: 'Components', type: 'number', computed: "json_array_length(COALESCE(NULLIF({t}.lines, ''), '[]'))" },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
  },
  // BOQ / Bill of Material prepared by WIESPL engineers (format: SR.NO, COMPONENT NAME, SPECIFICATIONS, DIMENSIONS, QTY, UOM, MOC, DRAWING MODEL NO, Remark, MAKE).
  boms: {
    label: 'BOQ / Bill of Material', singular: 'BOQ', group: 'Sales & Projects', icon: '📑', write: ENG.concat('store', 'purchase', 'purchase_head'), editor: 'bom',
    display: "{t}.bom_no || ' · ' || COALESCE({t}.client, '')",
    search: ['bom_no', 'client', 'remarks', 'prepared_by'],
    list: ['bom_no', 'date', 'client', 'project_id', 'work_order_id', 'required_by', 'lines', 'procured_lines', 'sent_lines', 'progress', 'status'],
    statusField: 'status', print: 'bom',
    related: [['requisitions', 'bom_id'], ['purchase_orders', 'bom_id'], ['challans', 'bom_id']],
    fields: [
      { key: 'bom_no', label: 'BOQ No', type: 'text', readonly: true, hint: 'Auto: BOQ-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'client', label: 'Client / Site', type: 'text', required: true, span: 2, hint: 'e.g. Solapur OT 1,2,3, Passage' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'work_order_id', label: 'Against Work Order', type: 'ref', ref: 'boqs' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      // Draft → Design Review (each department reviews its section) → Final (locked; stock reserved, shortages requisitioned).
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Design Review', 'Final', 'Approved', 'In Progress', 'Completed', 'On Hold'], default: 'Draft', hint: 'Design Review and Final are set with the buttons on the BOQ' },
      { key: 'required_by', label: 'Material Required By', type: 'date', hint: 'When the material is needed in production / at site; order-by dates are counted back from it with each item’s lead time' },
      { key: 'reviews', label: 'Department Reviews', type: 'json', hidden: true },
      { key: 'finalized_by', label: 'Made Final By', type: 'text', readonly: true },
      { key: 'finalized_at', label: 'Made Final At', type: 'text', readonly: true },
      { key: 'prepared_by', label: 'Prepared By', type: 'person', default: 'me' },
      { key: 'approved_by', label: 'Approved By', type: 'person' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
      { key: 'lines', label: 'Components', type: 'number', computed: "(SELECT COUNT(*) FROM bom_items b WHERE b.bom_id = {t}.id)" },
      { key: 'procured_lines', label: 'Procured', type: 'number', computed: `(SELECT COUNT(*) FROM bom_items b WHERE b.bom_id = {t}.id AND COALESCE(b.qty, 0) > 0 AND ${BOM_ON('purchase_orders', PO_LIVE, 'received').replaceAll('{t}', 'b')} >= b.qty)` },
      { key: 'sent_lines', label: 'Fully Sent', type: 'number', computed: `(SELECT COUNT(*) FROM bom_items b WHERE b.bom_id = {t}.id AND COALESCE(b.qty, 0) > 0 AND ${BOM_SENT_B("'Dispatched','Delivered'")} >= b.qty)` },
      { key: 'progress', label: '% Sent', type: 'number', computed: `(SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(100.0 * SUM(CASE WHEN ${BOM_SENT_B("'Dispatched','Delivered'")} >= b.qty THEN 1 ELSE 0 END) / COUNT(*)) END FROM bom_items b WHERE b.bom_id = {t}.id AND COALESCE(b.qty, 0) > 0)` },
    ],
  },
  bom_items: {
    label: 'BOQ Components', singular: 'BOQ Component', group: 'Hidden', icon: '📑', write: ENG.concat('store', 'purchase', 'purchase_head'),
    display: "COALESCE({t}.sr_no || ' ', '') || COALESCE({t}.component, '') || COALESCE(' ' || NULLIF({t}.dimensions, ''), '')",
    search: ['section', 'sr_no', 'component', 'spec', 'dimensions', 'moc', 'drawing_no', 'make', 'remark'],
    list: ['department', 'section', 'sr_no', 'component', 'spec', 'dimensions', 'qty', 'uom', 'on_po', 'received', 'dispatched', 'pending', 'delivery_status'],
    statusField: 'delivery_status',
    fields: [
      { key: 'bom_id', label: 'BOQ', type: 'ref', ref: 'boms', required: true },
      { key: 'department', label: 'Department', type: 'select', options: ['', ...DEPARTMENTS], hint: 'The department that reviews this component' },
      { key: 'section', label: 'Section', type: 'text', hint: 'e.g. PLENUM, RISER, SWING DOOR' },
      { key: 'sr_no', label: 'Sr. No.', type: 'text' },
      { key: 'component', label: 'Component Name', type: 'text', span: 2 },
      { key: 'spec', label: 'Specifications', type: 'textarea', span: 2 },
      { key: 'dimensions', label: 'Dimensions', type: 'text' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'qty_text', label: 'Qty as written', type: 'text', hint: 'e.g. 22+22' },
      { key: 'uom', label: 'UOM', type: 'text' },
      { key: 'moc', label: 'MOC', type: 'text' },
      { key: 'drawing_no', label: 'Drawing / Model No', type: 'text' },
      { key: 'remark', label: 'Remark', type: 'text' },
      { key: 'make', label: 'Make', type: 'text' },
      { key: 'item_id', label: 'Store item', type: 'ref', ref: 'items', hint: 'Link to see store stock, order it and issue it from stock' },
      { key: 'wo_line_id', label: 'From work order line', type: 'ref', ref: 'boq_items', readonly: true },
      { key: 'in_house', label: 'Made in-house', type: 'yn', hint: 'Sub-assembly built by us from its parts (listed under BUILD); the store requisitions the parts, not this item' },
      { key: 'in_store', label: 'In Store', type: 'number', computed: `(SELECT ${STOCK_SQL.replaceAll('{t}', 'si')} FROM items si WHERE si.id = {t}.item_id)` },
      { key: 'requested', label: 'Requisitioned', type: 'number', computed: BOM_ON('requisitions', REQ_LIVE) },
      { key: 'req_open', label: 'On open requisitions', type: 'number', hidden: true, computed: BOM_ON('requisitions', "'Draft','Submitted','Approved'") },
      { key: 'on_po', label: 'On PO', type: 'number', computed: BOM_ON('purchase_orders', PO_LIVE) },
      { key: 'received', label: 'Received (GRN)', type: 'number', computed: BOM_ON('purchase_orders', PO_LIVE, 'received') },
      { key: 'dispatched', label: 'Sent to Site', type: 'number', computed: BOM_SENT("'Dispatched','Delivered'") },
      { key: 'delivered', label: 'Delivered (site confirmed)', type: 'number', computed: BOM_SENT("'Delivered'") },
      { key: 'pending', label: 'Pending to Send', type: 'number', computed: `MAX(COALESCE({t}.qty, 0) - ${BOM_SENT("'Dispatched','Delivered'")}, 0)` },
      { key: 'delivery_status', label: 'Dispatch', type: 'select', options: ['', 'Pending', 'Partly Dispatched', 'Dispatched', 'Delivered', 'Not needed'], computed: `CASE WHEN COALESCE({t}.qty, 0) <= 0 THEN 'Not needed'
        WHEN ${BOM_SENT("'Delivered'")} >= {t}.qty THEN 'Delivered'
        WHEN ${BOM_SENT("'Dispatched','Delivered'")} >= {t}.qty THEN 'Dispatched'
        WHEN ${BOM_SENT("'Dispatched','Delivered'")} > 0 THEN 'Partly Dispatched' ELSE 'Pending' END` },
      { key: 'sort', label: 'Order', type: 'number', hidden: true },
    ],
  },
  challans: {
    label: 'Delivery Challans', singular: 'Delivery Challan', group: 'Sales & Projects', icon: '🚚', write: ENG.concat('store', 'purchase', 'purchase_head'),
    display: "{t}.challan_no",
    search: ['challan_no', 'issue_no', 'ship_to', 'vehicle_no', 'transporter', 'received_by', 'remarks'],
    list: ['challan_no', 'date', 'bom_id', 'boq_id', 'project_id', 'vendor_id', 'vehicle_no', 'transporter', 'status', 'delivered_date', 'received_by'],
    statusField: 'status', print: 'challan',
    fields: [
      { key: 'challan_no', label: 'Challan No', type: 'text', readonly: true, hint: 'Auto: DC-001/2026-27, returnable RE-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'bom_id', label: 'BOQ', type: 'ref', ref: 'boms' },
      { key: 'boq_id', label: 'Work Order', type: 'ref', ref: 'boqs' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'issue_no', label: 'Stock Issue / Transfer No', type: 'text', readonly: true },
      { key: 'issue_type', label: 'Stock Slip Type', type: 'text', hidden: true },
      { key: 'vendor_id', label: 'Vendor (material sent to)', type: 'ref', ref: 'vendors', hint: 'Ship-to address is filled from the vendor' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', hidden: true },
      { key: 'challan_type', label: 'Challan Type', type: 'select', options: ['Non-Returnable', 'Returnable'], default: 'Non-Returnable' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Dispatched', 'Delivered', 'Cancelled'], default: 'Draft', readonly: true },
      { key: 'ship_to', label: 'Ship To (site address)', type: 'textarea', span: 2 },
      { key: 'site_contact', label: 'Site Contact / Phone', type: 'text', hidden: true },
      { key: 'vehicle_no', label: 'Vehicle No', type: 'text' },
      { key: 'transporter', label: 'Transporter', type: 'text' },
      { key: 'lr_no', label: 'LR / Docket No', type: 'text', hidden: true },
      { key: 'driver', label: 'Driver Name / Phone', type: 'text' },
      { key: 'eway_bill', label: 'E-way Bill No', type: 'text', hidden: true },
      { key: 'lines', label: 'Material', type: 'lines', span: 2, itemRef: true, amounts: false, columns: [
        { key: 'description', label: 'Description', type: 'textarea', width: 320 },
        { key: 'uom', label: 'UOM', type: 'text', width: 70 },
        { key: 'qty', label: 'Qty', type: 'number', width: 80 },
        { key: 'remark', label: 'Remark', type: 'text', width: 160 },
      ] },
      { key: 'dispatched_by', label: 'Dispatched By', type: 'text', readonly: true },
      { key: 'delivered_date', label: 'Delivered On', type: 'date', readonly: true },
      { key: 'received_by', label: 'Received By (site)', type: 'text', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  // Tax invoice: Draft (no number) → Issue (number in date order, locked) → receipts / credit notes. Corrections only by
  // credit note; cancellation (GM) only while nothing is received or credited. Proforma invoices ask for advances.
  invoices: {
    label: 'Invoices', singular: 'Invoice', group: 'Sales & Projects', icon: '💳', write: ACC,
    display: "COALESCE({t}.invoice_no, 'Draft invoice #' || {t}.id)",
    search: ['invoice_no', 'notes', 'place_of_supply', 'milestone'],
    list: ['invoice_no', 'type', 'date', 'customer_id', 'sales_order_id', 'milestone', 'total', 'received', 'credited', 'balance', 'due_now', 'due_date', 'status'],
    statusField: 'status', print: 'invoice',
    related: [['payments', 'invoice_id'], ['credit_notes', 'invoice_id']],
    fields: [
      { key: 'invoice_no', label: 'Invoice No', type: 'text', readonly: true, hint: 'Given when the invoice is issued' },
      { key: 'type', label: 'Type', type: 'select', options: ['Tax Invoice', 'Proforma Invoice'], default: 'Tax Invoice' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { key: 'sales_order_id', label: 'Sales Order', type: 'ref', ref: 'sales_orders' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'milestone', label: 'Milestone', type: 'text', hint: 'From the sales order billing milestones' },
      { key: 'milestone_no', label: 'Milestone No', type: 'number', hidden: true },
      { key: 'place_of_supply', label: 'Place of Supply', type: 'select', options: STATES, default: 'Maharashtra' },
      { key: 'due_date', label: 'Due Date', type: 'date', hint: 'Blank = invoice date + the customer\'s credit days, set when issued' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Issued', 'Partially Paid', 'Retention Held', 'Paid', 'Cancelled'], default: 'Draft', readonly: true },
      { key: 'retention_pct', label: 'Retention %', type: 'number', default: 0 },
      { key: 'retention_amount', label: 'Retention (₹)', type: 'money', readonly: true, hint: 'Retention % of the invoice total, fixed when issued' },
      { key: 'retention_due', label: 'Retention Due On', type: 'date' },
      { key: 'lines', label: 'Items', type: 'lines', span: 2, columns: LINE_COLS },
      { key: 'subtotal', label: 'Taxable Value', type: 'money', readonly: true },
      { key: 'tax', label: 'GST', type: 'money', readonly: true },
      { key: 'total', label: 'Invoice Total', type: 'money', readonly: true },
      { key: 'received', label: 'Received (incl. TDS)', type: 'money', computed: `ROUND(${INV_RCV}, 2)` },
      { key: 'tds', label: 'TDS by Customer', type: 'money', computed: `ROUND(${INV_TDS}, 2)` },
      { key: 'credited', label: 'Credit Notes', type: 'money', computed: `ROUND(${INV_CN}, 2)` },
      { key: 'advance_adjusted', label: 'Advance Adjusted', type: 'money', computed: `ROUND(${INV_ADJ}, 2)` },
      { key: 'balance', label: 'Balance', type: 'money', computed: `ROUND(${INV_BAL}, 2)` },
      { key: 'retention_held', label: 'Retention Held', type: 'money', computed: `ROUND(${INV_RET}, 2)` },
      { key: 'due_now', label: 'Due Now', type: 'money', computed: `ROUND(CASE WHEN ${INV_LIVE} THEN MAX(0, ${INV_BAL} - (CASE WHEN {t}.retention_due IS NOT NULL AND {t}.retention_due <= date('now', 'localtime') THEN 0 ELSE ${INV_RET} END)) ELSE 0 END, 2)` },
      { key: 'issued_by', label: 'Issued By', type: 'text', readonly: true },
      { key: 'cancel_reason', label: 'Cancellation Reason', type: 'text', readonly: true },
      { key: 'notes', label: 'Notes / Bank Details', type: 'textarea', span: 2 },
    ],
  },
  // Money received from a customer: against a tax invoice, or an advance on a sales order (adjusted against its invoices
  // later). Saved = locked; only the GM can reverse it, with a reason.
  payments: {
    label: 'Customer Receipts', singular: 'Receipt', group: 'Sales & Projects', icon: '💰', write: ACC,
    display: "COALESCE({t}.receipt_no, '') || ' ₹' || {t}.amount",
    search: ['receipt_no', 'reference', 'remarks', 'mode'],
    list: ['date', 'receipt_no', 'customer_id', 'kind', 'invoice_id', 'sales_order_id', 'amount', 'tds_amount', 'mode', 'reference', 'status', 'bank_date', 'form16a'],
    statusField: 'status',
    fields: [
      { key: 'receipt_no', label: 'Receipt No', type: 'text', readonly: true, hint: 'Auto: RCT-001/2026-27' },
      { key: 'date', label: 'Date Received', type: 'date', default: 'today', required: true },
      { key: 'kind', label: 'Received For', type: 'select', options: RECEIPT_KINDS, default: 'Against invoice' },
      { key: 'invoice_id', label: 'Against Invoice', type: 'ref', ref: 'invoices', hint: 'A proforma invoice makes it an advance on its sales order' },
      { key: 'sales_order_id', label: 'Sales Order', type: 'ref', ref: 'sales_orders', hint: 'Needed for an advance; taken from the invoice otherwise' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', hint: 'Taken from the invoice / sales order' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', readonly: true },
      { key: 'amount', label: 'Amount Received in Bank (₹)', type: 'money', required: true },
      { key: 'tds_section', label: 'TDS Deducted By Customer – Section', type: 'select', options: CUSTOMER_TDS },
      { key: 'tds_amount', label: 'TDS Deducted (₹)', type: 'money', hint: 'As per the customer\'s payment advice; settles the invoice together with the amount' },
      { key: 'settled', label: 'Settled on the Invoice (₹)', type: 'money', computed: "ROUND(COALESCE({t}.amount, 0) + COALESCE({t}.tds_amount, 0), 2)" },
      { key: 'mode', label: 'Mode', type: 'select', options: ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'DD', 'Other'], default: 'NEFT / RTGS' },
      { key: 'reference', label: 'UTR / Cheque No', type: 'text', hint: 'Required except for cash; the same UTR cannot be entered twice' },
      { key: 'status', label: 'Status', type: 'select', options: ['Received', 'Reversed'], default: 'Received', readonly: true },
      { key: 'received_by', label: 'Entered By', type: 'text', readonly: true },
      { key: 'bank_date', label: 'Bank Reconciled On', type: 'date', readonly: true },
      { key: 'form16a', label: 'TDS Certificate (Form 16A) Received', type: 'yn', readonly: true },
      { key: 'reversed_reason', label: 'Reversal Reason', type: 'text', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  // Reduces what a customer owes on one invoice (rate difference, return, short supply…). The invoice itself is never
  // edited. Approved by the GM; the number is given on approval.
  credit_notes: {
    label: 'Credit Notes', singular: 'Credit Note', group: 'Sales & Projects', icon: '↩️', write: ACC,
    display: "COALESCE({t}.cn_no, 'Draft credit note #' || {t}.id)",
    search: ['cn_no', 'reason', 'description'],
    list: ['date', 'cn_no', 'customer_id', 'invoice_id', 'reason', 'taxable', 'tax', 'total', 'status'],
    statusField: 'status', print: 'creditnote',
    fields: [
      { key: 'cn_no', label: 'Credit Note No', type: 'text', readonly: true, hint: 'Given when approved: CN-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: 'today' },
      { key: 'invoice_id', label: 'Against Invoice', type: 'ref', ref: 'invoices', required: true },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', readonly: true },
      { key: 'reason', label: 'Reason', type: 'select', options: ['Rate difference', 'Goods returned', 'Short supply', 'Discount', 'Billing error', 'Other'], default: 'Rate difference' },
      { key: 'description', label: 'Details (printed)', type: 'textarea', span: 2, required: true },
      { key: 'taxable', label: 'Taxable Value (₹)', type: 'money', required: true },
      { key: 'gst_rate', label: 'GST %', type: 'number', hint: 'From the invoice if blank' },
      { key: 'tax', label: 'GST (₹)', type: 'money', readonly: true },
      { key: 'total', label: 'Total (₹)', type: 'money', readonly: true },
      { key: 'place_of_supply', label: 'Place of Supply', type: 'text', readonly: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'Rejected'], default: 'Draft', readonly: true },
      { key: 'approval_stage', label: 'Waiting For', type: 'text', readonly: true },
      { key: 'requested_by', label: 'Prepared By', type: 'text', readonly: true },
      { key: 'approved_by', label: 'Approved By', type: 'text', readonly: true },
    ],
  },
  service_tickets: {
    label: 'Complaint Register', singular: 'Complaint', group: 'Service', icon: '🛠️', write: SERVICE.concat('store'),
    display: "{t}.ticket_no || ' ' || COALESCE({t}.hospital, '')",
    search: ['ticket_no', 'hospital', 'city', 'equipment', 'complaint', 'assigned_to', 'resolution'],
    list: ['ticket_no', 'date', 'hospital', 'city', 'mode', 'equipment', 'complaint', 'assigned_to', 'status', 'closed_date'],
    statusField: 'status',
    fields: [
      { key: 'ticket_no', label: 'Ticket No', type: 'text', readonly: true },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'mode', label: 'Mode of Complaint', type: 'select', options: ['Telephonic', 'WhatsApp', 'Email', 'Visit', 'Other'], default: 'Telephonic' },
      { key: 'hospital', label: 'Customer / Hospital Name', type: 'text', required: true },
      { key: 'customer_id', label: 'Customer (CRM)', type: 'ref', ref: 'customers' },
      { key: 'city', label: 'Address / City', type: 'text' },
      { key: 'contact_person', label: 'Contact Person', type: 'text' },
      { key: 'contact_no', label: 'Contact No', type: 'tel' },
      { key: 'amc_id', label: 'AMC / Warranty', type: 'ref', ref: 'amc_contracts' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'category', label: 'Category', type: 'select', options: ['Breakdown', 'Preventive Maintenance', 'Warranty', 'AMC Visit', 'Validation', 'Installation Support', 'Other'], default: 'Breakdown' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
      { key: 'equipment', label: 'Instrument Name', type: 'text', suggest: ['ODU', 'AHU', 'AHU Control Panel', 'PLC', 'LAF System', 'Surgeon Control Panel', 'Door', 'Sky Light', 'VMR', 'VFD', 'Motor', 'Pendant', 'MGPS', 'Pass Box', 'Other'] },
      { key: 'under_warranty', label: 'Under Warranty / AMC', type: 'yn' },
      { key: 'complaint', label: 'Problem', type: 'textarea', span: 2, required: true },
      { key: 'reported_by', label: 'Reported By (client)', type: 'text' },
      { key: 'assigned_to', label: 'Assigned Person', type: 'person' },
      { key: 'status', label: 'Complaint Status', type: 'select', options: ['Open', 'In Progress', 'Waiting for Parts', 'Resolved', 'Closed'], default: 'Open' },
      { key: 'closed_date', label: 'Date of Completion', type: 'date' },
      { key: 'resolution', label: 'Solution', type: 'textarea', span: 2 },
      { key: 'remark', label: 'Remark', type: 'text' },
      { key: 'charges', label: 'Charges (₹)', type: 'money' },
      { key: 'days_open', label: 'Days Open', type: 'number', computed: "CAST(julianday(COALESCE(NULLIF({t}.closed_date, ''), date('now', 'localtime'))) - julianday({t}.date) AS INTEGER)" },
    ],
  },


  // ---------------------------------------------------------------- Service
  // AMC / warranty register: one row per client system, with the planned service visits (S1–S4), the AMC period and
  // amount, and the particle count due date. A service report on an AMC visit ticks off the next planned visit.
  amc_contracts: {
    label: 'AMC / Warranty Register', singular: 'AMC / Warranty', group: 'Service', icon: '🛡️', write: SERVICE,
    display: "COALESCE({t}.hospital, '') || COALESCE(' – ' || {t}.system_details, '')",
    search: ['client_id', 'hospital', 'customer_name', 'city', 'contact_person', 'system_details', 'email', 'mobile'],
    list: ['client_id', 'hospital', 'city', 'system_details', 'coverage', 'warranty_end', 'amc_start', 'amc_end', 'amc_amount', 'next_service', 'cover_status'],
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text' },
      { key: 'hospital', label: 'Hospital Name', type: 'text', required: true, span: 2 },
      { key: 'customer_id', label: 'Customer (CRM)', type: 'ref', ref: 'customers' },
      { key: 'customer_name', label: 'Customer / Doctor', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea', span: 2 },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'select', options: STATES },
      { key: 'contact_person', label: 'Contact Person', type: 'text' },
      { key: 'mobile', label: 'Mobile', type: 'tel' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'system_details', label: 'System Details', type: 'text', suggest: ['MOD Setup', 'LAF', 'In Built LAF', 'IVF set up', 'AHU', 'ODU'] },
      { key: 'coverage', label: 'Coverage', type: 'select', options: ['AMC', 'CAMC', 'Warranty', 'None'], default: 'AMC' },
      { key: 'warranty_months', label: 'Warranty (months)', type: 'number', default: 12 },
      { key: 'warranty_start', label: 'Warranty Start', type: 'date' },
      { key: 'warranty_end', label: 'Warranty End', type: 'date', hint: 'Start + months if blank' },
      { key: 'services_covered', label: 'Services Covered per Year', type: 'number', default: 3 },
      { key: 'service_plan', label: 'Service Visits (S1, S2 …)', type: 'lines', span: 2, amounts: false, schedule: true, columns: [
        { key: 'visit', label: 'Visit', type: 'text', width: 60 }, { key: 'planned', label: 'Planned', type: 'date', width: 140 },
        { key: 'done', label: 'Done On', type: 'date', width: 140 }, { key: 'report', label: 'Service Report', type: 'text', width: 140 }, { key: 'remark', label: 'Remark', type: 'text', width: 200 }] },
      { key: 'amc_start', label: 'AMC Start', type: 'date' },
      { key: 'amc_end', label: 'AMC End', type: 'date' },
      { key: 'amc_amount_agreement', label: 'AMC Amount as per Agreement (₹)', type: 'money' },
      { key: 'amc_amount', label: 'AMC Amount (₹, incl. GST)', type: 'money' },
      { key: 'variance', label: 'Variance (₹)', type: 'money', computed: "ROUND(COALESCE({t}.amc_amount, 0) - COALESCE({t}.amc_amount_agreement, 0), 2)" },
      { key: 'particle_count_date', label: 'Particle Count Done On', type: 'date' },
      { key: 'particle_next', label: 'Next Particle Count', type: 'date', hint: 'One year after the last if blank' },
      { key: 'next_service', label: 'Next Service Due', type: 'date', computed: "(SELECT MIN(json_extract(j.value, '$.planned')) FROM json_each(COALESCE({t}.service_plan, '[]')) j WHERE COALESCE(json_extract(j.value, '$.done'), '') = '' AND COALESCE(json_extract(j.value, '$.planned'), '') <> '')" },
      { key: 'cover_status', label: 'Status', type: 'select', options: ['In Warranty', 'AMC Active', 'Renewal Due', 'Expired', 'No Cover'],
        computed: "CASE WHEN {t}.warranty_end >= date('now', 'localtime') THEN 'In Warranty' WHEN {t}.amc_end IS NULL OR {t}.amc_end = '' THEN 'No Cover' WHEN {t}.amc_end < date('now', 'localtime') THEN 'Expired' WHEN {t}.amc_end <= date('now', 'localtime', '+60 days') THEN 'Renewal Due' ELSE 'AMC Active' END" },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
  },
  // Parts for a service job: prepared by the service coordinator, sent to the store as a material request.
  service_work_orders: {
    label: 'Service Work Orders', singular: 'Service Work Order', group: 'Service', icon: '🧰', write: SERVICE.concat('store'),
    display: "{t}.swo_no",
    search: ['swo_no', 'hospital', 'location', 'order_from', 'additional_details'],
    list: ['swo_no', 'date', 'hospital', 'location', 'order_from', 'received_by', 'status'],
    statusField: 'status', print: 'swo',
    fields: [
      { key: 'swo_no', label: 'S.W.O. No', type: 'text', readonly: true, hint: 'Auto: SW/001/2026-27' },
      { key: 'date', label: 'Order Date', type: 'date', default: 'today', required: true },
      { key: 'hospital', label: 'Client Name', type: 'text', required: true },
      { key: 'customer_id', label: 'Customer (CRM)', type: 'ref', ref: 'customers' },
      { key: 'location', label: 'Work Location', type: 'text' },
      { key: 'ticket_id', label: 'Complaint', type: 'ref', ref: 'service_tickets' },
      { key: 'amc_id', label: 'AMC / Warranty', type: 'ref', ref: 'amc_contracts' },
      { key: 'order_from', label: 'Order Received From', type: 'text', hint: 'e.g. Bio-medical, engineer' },
      { key: 'received_by', label: 'Order Received By', type: 'person', default: 'me' },
      { key: 'lines', label: 'Parts & Material', type: 'lines', span: 2, itemRef: true, amounts: false, columns: [
        { key: 'description', label: 'Parts & Material Description', type: 'text', width: 300 }, { key: 'make', label: 'Make & Model', type: 'text', width: 140 },
        { key: 'qty', label: 'Qty', type: 'number', width: 70 }, { key: 'uom', label: 'UOM', type: 'text', width: 60 }, { key: 'remark', label: 'Remark', type: 'text', width: 160 }] },
      { key: 'old_material_status', label: 'Old Material Status', type: 'textarea', span: 2 },
      { key: 'additional_details', label: 'Additional Details', type: 'textarea', span: 2, hint: 'e.g. received PO, waiting for advance; system in warranty' },
      { key: 'dispatch_through', label: 'Material Dispatch Through', type: 'select', options: ['', 'By Courier', 'By Hand', 'Transport', 'Engineer carrying'] },
      { key: 'docket', label: 'Docket Details', type: 'text' },
      { key: 'authorized_by', label: 'Work Authorized By', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Sent to Store', 'Dispatched', 'Completed', 'Cancelled'], default: 'Draft' },
      { key: 'mr_id', label: 'Material Request', type: 'ref', ref: 'material_requests', readonly: true },
    ],
  },
  // Service report of a visit: call type, system, problem / work done, the 24-step checklist, testing parameters,
  // air flow & damper readings and the customer's feedback. Completing it closes the complaint / ticks the AMC visit.
  service_reports: {
    label: 'Service Reports', singular: 'Service Report', group: 'Service', icon: '📋', write: SERVICE,
    display: "{t}.report_no || ' ' || COALESCE({t}.hospital, '')",
    search: ['report_no', 'hospital', 'attended_by', 'problem', 'work_done'],
    list: ['report_no', 'date', 'hospital', 'call_type', 'attended_by', 'ticket_id', 'amc_id', 'status'],
    statusField: 'status', print: 'servicereport',
    fields: [
      { key: 'report_no', label: 'Report No', type: 'text', readonly: true, hint: 'Auto: SR-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'time_in', label: 'Time', type: 'text' },
      { key: 'hospital', label: 'Hospital Name', type: 'text', required: true },
      { key: 'customer_id', label: 'Customer (CRM)', type: 'ref', ref: 'customers' },
      { key: 'call_type', label: 'Status of Call', type: 'select', options: ['AMC Service Visit', 'Chargeable Basis', 'Break Down Call', 'Warranty'], default: 'Break Down Call' },
      { key: 'ticket_id', label: 'Complaint', type: 'ref', ref: 'service_tickets' },
      { key: 'amc_id', label: 'AMC / Warranty', type: 'ref', ref: 'amc_contracts' },
      { key: 'complaint_from', label: 'Complaint From', type: 'text' },
      { key: 'contact_name', label: 'Mr. / Ms.', type: 'text' },
      { key: 'mobile', label: 'Mobile No', type: 'tel' },
      { key: 'email', label: 'Email Id', type: 'text' },
      { key: 'ahu_capacity', label: 'AHU Capacity', type: 'text' },
      { key: 'ac_tr', label: 'AC (TR)', type: 'text' },
      { key: 'odu_count', label: 'No of ODU', type: 'text' },
      { key: 'plc_sr', label: 'PLC Sr No', type: 'text' },
      { key: 'gsm_sr', label: 'GSM Model Sr No', type: 'text' },
      { key: 'problem', label: 'Problem Observation', type: 'textarea', span: 2 },
      { key: 'work_done', label: 'Work Done / Resolving Issue', type: 'textarea', span: 2 },
      { key: 'end_date', label: 'End of Service Date', type: 'date' },
      { key: 'end_time', label: 'End Time', type: 'text' },
      { key: 'attended_by', label: 'Call Attended By', type: 'text' },
      { key: 'checklist', label: 'Annexure I – Service Protocol Check List', type: 'lines', span: 2, amounts: false, schedule: true, default: [{"step":"Checking & cleaning of AHU filters – pre filter with water, fine filter & fresh air filter by blower","done":""},{"step":"Checking & cleaning of ESP filter with cotton","done":""},{"step":"Checking of all electrical wiring – motor, heater, UV & ESP","done":""},{"step":"Checking & cleaning of AC coil","done":""},{"step":"Cleaning of AC coil drain tray & piping by water at full pressure","done":""},{"step":"Checking motor electrical connections, belt alignment, heater connections & current, UV on/off, ESP connections","done":""},{"step":"Cleaning of AHU inside area by water & cloth","done":""},{"step":"Cleaning of AHU outside body by water","done":""},{"step":"Checking CFM of return, supply, fresh & bypass air and damper opening","done":""},{"step":"Checking de-fumigation fan electrical connection & switches","done":""},{"step":"Checking PLC based AHU control panel wiring & cleaning of panel","done":""},{"step":"Checking AC outdoor fan, compressor, wiring, suction & liquid line pressure, LP/HP connection","done":""},{"step":"Cleaning of outdoor unit return grill (back side) by water","done":""},{"step":"Cleaning inside OT – all return air grills; checking UV tube light assembly","done":""},{"step":"Checking surgeon control panel & outside panel – electrical wiring connections","done":""},{"step":"Checking pendant alignment & electrical connections","done":""},{"step":"Checking OT door accessories & their alignment","done":""},{"step":"Checking all panelling silicon joints","done":""},{"step":"Checking plenum tube lights & 2×2 lights","done":""},{"step":"Checking setting of temperature & humidity","done":""},{"step":"Checking HEPA pressure & room pressure meter","done":""},{"step":"Checking electrical connections of X-ray viewer & switches","done":""},{"step":"Checking pass box UV light & door lock","done":""},{"step":"Checking supply air & return air CFM","done":""}],
        columns: [{ key: 'step', label: 'Service protocol step', type: 'text', width: 560 }, { key: 'done', label: 'Yes / No', type: 'select', options: ['', 'Yes', 'No', 'N/A'], width: 90 }] },
      { key: 'ot_no', label: 'OT No (testing)', type: 'text' },
      { key: 'vfd_hz', label: 'VFD Freq (Hz)', type: 'text' },
      { key: 'hepa_pa', label: 'HEPA Pressure (Pa)', type: 'text' },
      { key: 'positive_pa', label: 'Positive Pressure (Pa)', type: 'text' },
      { key: 'ambient_c', label: 'Ambient Temp (°C)', type: 'text' },
      { key: 'readings', label: 'Testing Parameters', type: 'lines', span: 2, amounts: false, schedule: true, columns: [
        {"key":"timing","label":"Timing","type":"text","width":62}, {"key":"ot_temp","label":"OT °C","type":"text","width":62}, {"key":"rh","label":"RH %","type":"text","width":62}, {"key":"comp1","label":"Comp AC1 A","type":"text","width":62}, {"key":"comp2","label":"Comp AC2 A","type":"text","width":62}, {"key":"blower","label":"Blower A","type":"text","width":62}, {"key":"heater_r","label":"Heater R","type":"text","width":62}, {"key":"heater_y","label":"Heater Y","type":"text","width":62}, {"key":"heater_b","label":"Heater B","type":"text","width":62}, {"key":"coil","label":"Coil °C","type":"text","width":62}, {"key":"suction","label":"Suction PSI","type":"text","width":62}, {"key":"discharge","label":"Discharge PSI","type":"text","width":62}, {"key":"remark","label":"Remark","type":"text","width":140}] },
      { key: 'airflow', label: 'Air Flow & Damper Opening (CFM / velocity m/s)', type: 'lines', span: 2, amounts: false, schedule: true, columns: [
        {"key":"ot","label":"OT","type":"text","width":62}, {"key":"r1","label":"Return R1","type":"text","width":62}, {"key":"r2","label":"R2","type":"text","width":62}, {"key":"r3","label":"R3","type":"text","width":62}, {"key":"r4","label":"R4","type":"text","width":62}, {"key":"h1","label":"Supply HEPA 1","type":"text","width":62}, {"key":"h2","label":"HEPA 2","type":"text","width":62}, {"key":"h3","label":"HEPA 3","type":"text","width":62}, {"key":"h4","label":"HEPA 4","type":"text","width":62}, {"key":"h5","label":"HEPA 5","type":"text","width":62}, {"key":"h6","label":"HEPA 6","type":"text","width":62}, {"key":"return_open","label":"Return open %","type":"text","width":62}, {"key":"fresh_open","label":"Fresh open %","type":"text","width":62}, {"key":"bypass_open","label":"Bypass open %","type":"text","width":62}] },
      { key: 'fb_courtesy', label: 'Courtesy & professionalism of our staff', type: 'select', options: ["","Very Satisfied","Satisfied","Neutral","Dissatisfied","Very Dissatisfied"] },
      { key: 'fb_information', label: 'Information provided by our staff', type: 'select', options: ["","Very Satisfied","Satisfied","Neutral","Dissatisfied","Very Dissatisfied"] },
      { key: 'fb_wait', label: 'Wait time for service', type: 'select', options: ["","Very Satisfied","Satisfied","Neutral","Dissatisfied","Very Dissatisfied"] },
      { key: 'fb_overall', label: 'Overall service provided', type: 'select', options: ["","Very Satisfied","Satisfied","Neutral","Dissatisfied","Very Dissatisfied"] },
      { key: 'fb_resolution', label: 'Resolution of your concern', type: 'select', options: ["","Very Satisfied","Satisfied","Neutral","Dissatisfied","Very Dissatisfied"] },
      { key: 'additional_feedback', label: 'Additional Feedback / Information', type: 'textarea', span: 2 },
      { key: 'customer_rep', label: 'Customer / Representative (name)', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Completed'], default: 'Draft' },
    ],
  },
  // Root cause analysis of a complaint (format WIESPL RCA template).
  rca_reports: {
    label: 'Root Cause Analysis (RCA)', singular: 'RCA', group: 'Service', icon: '🔍', write: SERVICE,
    display: "{t}.rca_no || ' ' || COALESCE({t}.hospital, '')",
    search: ['rca_no', 'hospital', 'complaint_details', 'root_cause'],
    list: ['rca_no', 'date', 'hospital', 'complaint_date', 'complaint_details', 'status'],
    statusField: 'status', print: 'rca',
    fields: [
      { key: 'rca_no', label: 'RCA No', type: 'text', readonly: true, hint: 'Auto: RCA-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'ticket_id', label: 'Complaint', type: 'ref', ref: 'service_tickets' },
      { key: 'hospital', label: 'Hospital Name', type: 'text', required: true },
      { key: 'customer_id', label: 'Customer (CRM)', type: 'ref', ref: 'customers' },
      { key: 'contact_person', label: 'Contact Person', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Ph. No.', type: 'tel' },
      { key: 'complaint_date', label: 'Date of Complaint', type: 'date' },
      { key: 'complaint_details', label: 'Complaint Details', type: 'textarea', span: 2 },
      { key: 'action_date', label: 'Date of Action Taken', type: 'date' },
      { key: 'action_by', label: 'Action Taken By', type: 'text' },
      { key: 'observation', label: 'Observation before resolving the issue', type: 'textarea', span: 2 },
      { key: 'team', label: 'Investigative Team', type: 'text', span: 2 },
      { key: 'findings', label: 'Findings', type: 'textarea', span: 2 },
      { key: 'root_cause', label: 'Identification of Root Cause', type: 'textarea', span: 2 },
      { key: 'corrective_action', label: 'Corrective Action', type: 'textarea', span: 2 },
      { key: 'preventive_action', label: 'Preventive Action (so it does not happen again)', type: 'textarea', span: 2 },
      { key: 'authorized', label: 'Authorized Persons – Name & Designation', type: 'textarea', span: 2 },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Sent to Client', 'Accepted by Client'], default: 'Draft' },
    ],
  },
  // Costing sheet: the material (with its cost), labour / visits and other costs; selling = cost + the company's % +
  // transport to the site. Sales sheets add their lines to a quotation; service sheets print as a service quotation
  // and make the proforma invoice. Customers only ever see the selling prices.
  costing_sheets: {
    label: 'Costing Sheets', singular: 'Costing Sheet', group: 'CRM', icon: '🧮', write: ['admin', 'manager', 'sales', 'service'],
    display: "{t}.cs_no || ' · ' || COALESCE({t}.title, '')",
    search: ['cs_no', 'title', 'hospital', 'site'],
    list: ['cs_no', 'date', 'kind', 'hospital', 'title', 'cost_total', 'margin_pct', 'transport', 'selling_total', 'status'],
    statusField: 'status', print: 'costing',
    fields: [
      { key: 'cs_no', label: 'Costing No', type: 'text', readonly: true, hint: 'Auto: CS-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'kind', label: 'Costing For', type: 'select', options: ['Sales', 'Service'], default: 'Sales' },
      { key: 'title', label: 'What is quoted', type: 'text', required: true, span: 2 },
      { key: 'customer_id', label: 'Customer (CRM)', type: 'ref', ref: 'customers' },
      { key: 'hospital', label: 'Hospital / Client', type: 'text' },
      { key: 'site', label: 'Site (for transport)', type: 'text' },
      { key: 'enquiry_id', label: 'Enquiry', type: 'ref', ref: 'enquiries' },
      { key: 'quotation_id', label: 'Quotation', type: 'ref', ref: 'quotations', readonly: true },
      { key: 'ticket_id', label: 'Complaint (service)', type: 'ref', ref: 'service_tickets' },
      { key: 'amc_id', label: 'AMC / Warranty (service)', type: 'ref', ref: 'amc_contracts' },
      { key: 'lines', label: 'Material (cost)', type: 'lines', span: 2, itemRef: true, amounts: false, costKey: 'cost', hint: 'Pick the store item: its last price comes as the cost; change it if needed', columns: [
        { key: 'description', label: 'Material', type: 'text', width: 260 }, { key: 'hsn', label: 'HSN / SAC', type: 'text', width: 80 },
        { key: 'qty', label: 'Qty', type: 'number', width: 70 }, { key: 'uom', label: 'UOM', type: 'text', width: 60 }, { key: 'cost', label: 'Unit Cost ₹', type: 'money', width: 110 }, { key: 'remark', label: 'Remark', type: 'text', width: 140 }] },
      { key: 'labour', label: 'Labour / Installation Cost (₹)', type: 'money', hint: 'Sales: installation; service: leave 0 and use the visit days below' },
      { key: 'visit_days', label: 'Engineer Visit (man-days)', type: 'number' },
      { key: 'day_rate', label: 'Cost per Man-day (₹)', type: 'money' },
      { key: 'travel', label: 'Travel / Lodging Cost (₹)', type: 'money' },
      { key: 'other_cost', label: 'Other Cost (₹)', type: 'money' },
      { key: 'margin_pct', label: 'Company % (added on cost)', type: 'number', hint: 'Blank = the default in Settings → Costing (sales / service)' },
      { key: 'transport', label: 'Transport to Site (₹)', type: 'money', hint: 'Added to the selling price at cost' },
      { key: 'gst_rate', label: 'GST %', type: 'number', default: 18 },
      { key: 'material_cost', label: 'Material Cost (₹)', type: 'money', readonly: true },
      { key: 'cost_total', label: 'Total Cost (₹)', type: 'money', readonly: true },
      { key: 'margin_amount', label: 'Company Margin (₹)', type: 'money', readonly: true },
      { key: 'selling_total', label: 'Selling Price before GST (₹)', type: 'money', readonly: true, hint: 'Cost + company % + transport' },
      { key: 'gst_amount', label: 'GST (₹)', type: 'money', readonly: true },
      { key: 'grand_total', label: 'Total incl. GST (₹)', type: 'money', readonly: true },
      { key: 'validity', label: 'Validity', type: 'text', default: '30 days' },
      { key: 'terms', label: 'Terms (printed)', type: 'textarea', span: 2 },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Quoted', 'Won', 'Lost'], default: 'Draft' },
      { key: 'invoice_id', label: 'Proforma Invoice', type: 'ref', ref: 'invoices', readonly: true },
    ],
  },

  // ---------------------------------------------------------------- Purchase
  vendors: {
    label: 'Vendors', singular: 'Vendor', group: 'Purchase', icon: '🏭', write: PURCHASE,
    display: "{t}.name",
    search: ['name', 'contact_person', 'phone', 'emails', 'category', 'gstin', 'city'],
    list: ['name', 'category', 'city', 'state', 'contact_person', 'phone', 'gstin', 'incomplete'],
    related: [['purchase_orders', 'vendor_id'], ['stock_moves', 'vendor_id']],
    fields: [
      { key: 'name', label: 'Vendor Name', type: 'text', required: true, span: 2 },
      { key: 'category', label: 'Category Supplied', type: 'text', hint: 'e.g. ODU, HEPA filters, PPGL sheets, Hardware' },
      { key: 'gstin', label: 'GSTIN', type: 'text', hint: 'State and PAN are filled in from the GSTIN' },
      { key: 'pan', label: 'PAN', type: 'text' },
      { key: 'state', label: 'State', type: 'select', options: STATES },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'pincode', label: 'Pincode', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea', span: 2 },
      { key: 'contact_person', label: 'Main Contact Person', type: 'text' },
      { key: 'phone', label: 'Phone(s)', type: 'tel' },
      { key: 'emails', label: 'Email(s)', type: 'textarea', hint: 'One per line' },
      { key: 'contacts', label: 'Other Contacts', type: 'textarea', hint: 'Name – role – phone, one per line' },
      { key: 'payment_terms', label: 'Payment Terms', type: 'text' },
      { key: 'bank_details', label: 'Bank Details', type: 'textarea' },
      { key: 'incomplete', label: 'Details Incomplete (complete later)', type: 'yn' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      { key: 'po_value', label: 'Total PO Value', type: 'money', computed: "(SELECT COALESCE(SUM(p.total),0) FROM purchase_orders p WHERE p.vendor_id = {t}.id AND p.status NOT IN ('Cancelled','Rejected'))" },
    ],
  },
  requisitions: {
    label: 'Material Requisitions', singular: 'Requisition', group: 'Purchase', icon: '📝', write: ALL,
    display: "{t}.req_no",
    search: ['req_no', 'project_name', 'requested_by', 'remarks'],
    list: ['req_no', 'date', 'project_id', 'project_name', 'requested_by', 'required_by', 'status'],
    statusField: 'status', print: 'requisition',
    related: [['purchase_orders', 'requisition_id']],
    fields: [
      { key: 'req_no', label: 'Req No', type: 'text', readonly: true },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', hint: 'For several sites, choose the site on each line below; this then shows “Multiple sites”' },
      { key: 'bom_id', label: 'Against BOQ', type: 'ref', ref: 'boms', hint: 'Copies the components still to be procured' },
      { key: 'project_name', label: 'Project Name (as printed)', type: 'text', hint: 'Filled from the project if left blank' },
      { key: 'requested_by', label: 'Requester', type: 'person', default: 'me' },
      { key: 'department', label: 'Department', type: 'select', options: ['', 'Production', 'Site / Installation', 'Electrical (BGM)', 'R&D', 'HVAC', 'Store', 'Service', 'Office'] },
      { key: 'required_by', label: 'Required By', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Converted to PO', 'Closed'], default: 'Draft', readonly: true },
      { key: 'lines', label: 'Materials', type: 'lines', span: 2, itemRef: true, amounts: false, hint: 'Pick the item from inventory, or leave “Inventory item” blank and type a new material (＋ adds it to the item master)', columns: [
        { key: 'description', label: 'Material Description', type: 'text', width: 260 },
        { key: 'spec', label: 'Specification', type: 'textarea', width: 260 },
        { key: 'qty', label: 'Qty', type: 'number', width: 80 },
        { key: 'uom', label: 'UOM', type: 'text', width: 70 },
        { key: 'remark', label: 'Remark', type: 'text', width: 160 },
        { key: 'site', label: 'Site / Hospital', type: 'text', width: 170 },
        { key: 'project_id', label: 'Project (CRM)', type: 'ref', ref: 'projects', width: 170, blank: '(as above)' },
        { key: 'bom_id', label: 'BOQ', type: 'ref', ref: 'boms', width: 150 },
      ] },
      { key: 'approved_by', label: 'Approved By (Purchase Head)', type: 'text', readonly: true },
      { key: 'approved_at', label: 'Approved At', type: 'text', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  purchase_orders: {
    label: 'Purchase Orders', singular: 'Purchase Order', group: 'Purchase', icon: '🛒', write: PURCHASE,
    display: "{t}.po_no",
    search: ['po_no', 'project_note', 'quotation_ref', 'remarks'],
    list: ['po_no', 'date', 'vendor_id', 'project_id', 'total', 'paid', 'balance', 'approval_stage', 'status'],
    statusField: 'status', print: 'po',
    related: [['vendor_bills', 'po_id'], ['vendor_payments', 'po_id'], ['debit_notes', 'po_id']],
    fields: [
      { key: 'po_no', label: 'PO No', type: 'text', readonly: true, hint: 'Auto: 008/2026-27, restarts every April' },
      { key: 'date', label: 'PO Date', type: 'date', default: 'today', required: true },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', required: true },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'requisition_id', label: 'Against Requisition', type: 'ref', ref: 'requisitions' },
      { key: 'bom_id', label: 'Against BOQ', type: 'ref', ref: 'boms' },
      { key: 'quotation_ref', label: 'Ref.: Vendor Quotation / P.I. No', type: 'text', hint: 'Attach the quotation below (📎); the terms are copied from this vendor’s last PO' },
      { key: 'quotation_date', label: 'Quotation Date', type: 'date' },
      { key: 'vendor_contact', label: 'Vendor Contact Person', type: 'text', hint: 'Filled from the vendor if blank' },
      { key: 'vendor_phone', label: 'Vendor Contact No', type: 'text' },
      { key: 'delivery_date', label: 'Delivery Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Sent', 'Partially Received', 'Closed', 'Received', 'Cancelled'], default: 'Draft', readonly: true },
      { key: 'approval_stage', label: 'Waiting For', type: 'text', readonly: true },
      { key: 'delivery_address', label: 'Delivery & Billing Address', type: 'textarea', default: 'setting:po_delivery_address' },
      { key: 'contact_person', label: 'Our Contact Person', type: 'text', default: 'setting:po_contact_person' },
      { key: 'contact_phone', label: 'Our Contact No', type: 'text', default: 'setting:po_contact_phone' },
      { key: 'contact_emails', label: 'Our Email(s)', type: 'text', default: 'setting:po_contact_emails' },
      { key: 'lines', label: 'Items', type: 'lines', span: 2, itemRef: true, poTotals: true, hint: 'Item name short (e.g. VFD), the details in Specifications. Leave Qty blank on a heading line (e.g. "Fire Damper" + spec) and add each size as its own line', columns: [
        { key: 'description', label: 'Item Name', type: 'text', width: 150 },
        { key: 'vendor_code', label: 'Item Code (vendor)', type: 'text', width: 100 },
        { key: 'hsn', label: 'HSN / SAC', type: 'text', width: 90 },
        { key: 'spec', label: 'Specifications', type: 'textarea', width: 300 },
        { key: 'qty', label: 'Qty', type: 'number', width: 70 },
        { key: 'uom', label: 'UOM', type: 'text', width: 64 },
        { key: 'rate', label: 'Rate', type: 'money', width: 100 },
        { key: 'gst', label: 'GST %', type: 'number', width: 60 },
        { key: 'site', label: 'Site / Hospital', type: 'text', width: 150 },
        { key: 'project_id', label: 'Project (CRM)', type: 'ref', ref: 'projects', width: 170, blank: '(as above)' },
        { key: 'bom_id', label: 'BOQ', type: 'ref', ref: 'boms', width: 150 },
      ] },
      // Charges are part of the taxable value (before GST), each shown on the PO.
      { key: 'freight_charges', label: 'Freight Charges (₹)', type: 'money' },
      { key: 'packing_charges', label: 'Packing Charges (₹)', type: 'money' },
      { key: 'installation_charges', label: 'Installation Charges (₹)', type: 'money' },
      { key: 'transport_charges', label: 'Transportation Charges (₹)', type: 'money' },
      { key: 'other_charges', label: 'Other Charges (₹)', type: 'money' },
      { key: 'other_charges_label', label: 'Other Charges – name', type: 'text', hint: 'e.g. Admin, Insurance, Loading' },
      { key: 'charges_gst', label: 'GST % on charges', type: 'number', default: 18 },
      { key: 'subtotal', label: 'Taxable Value', type: 'money', readonly: true, hint: 'Items + charges' },
      { key: 'tax', label: 'GST', type: 'money', readonly: true },
      { key: 'gst_label', label: 'GST %', type: 'text', readonly: true },
      { key: 'round_off', label: 'Round Off', type: 'money', readonly: true },
      { key: 'total', label: 'Grand Total', type: 'money', readonly: true },
      { key: 'term_advance', label: 'Payment – Advance', type: 'text', default: 'setting:po_term_advance' },
      { key: 'term_balance', label: 'Payment – Balance', type: 'text', default: 'setting:po_term_balance' },
      { key: 'term_delivery', label: 'Delivery', type: 'text', default: 'setting:po_term_delivery' },
      { key: 'term_warranty', label: 'Warranty', type: 'text', default: 'setting:po_term_warranty' },
      { key: 'term_freight', label: 'Freight', type: 'text', default: 'setting:po_term_freight' },
      { key: 'term_validity', label: 'Validity', type: 'text', default: 'setting:po_term_validity' },
      { key: 'term_invoice', label: 'Invoice Copies', type: 'text', default: 'setting:po_term_invoice' },
      { key: 'term_jurisdiction', label: 'Jurisdiction', type: 'text', default: 'setting:po_term_jurisdiction' },
      { key: 'terms', label: 'Additional Terms', type: 'textarea', span: 2, default: 'setting:po_term_extra' },
      { key: 'project_note', label: 'Note', type: 'text', span: 2 },
      { key: 'prepared_by', label: 'Prepared By', type: 'person', default: 'me' },
      { key: 'purchase_approved_by', label: 'Purchase Approval', type: 'text', readonly: true },
      { key: 'tech_approved_by', label: 'Technical Approval', type: 'text', readonly: true },
      { key: 'comm_approved_by', label: 'Commercial Approval', type: 'text', readonly: true },
      // Received value: material inward (GRN) on this PO × rate, before GST. Paid: only payments actually made.
      { key: 'received_value', label: 'Received (₹, before GST)', type: 'money', computed: `ROUND(${RECEIVED_VALUE}, 2)` },
      { key: 'billed', label: 'Billed (₹)', type: 'money', computed: "(SELECT COALESCE(SUM(b.amount),0) FROM vendor_bills b WHERE b.po_id = {t}.id)" },
      { key: 'debited', label: 'Debit Notes (₹)', type: 'money', computed: DEBITED },
      { key: 'paid', label: 'Paid (₹)', type: 'money', computed: PAID },
      { key: 'balance', label: 'To Pay (₹)', type: 'money', computed: `ROUND(COALESCE({t}.total,0) - ${PAID} - ${DEBITED}, 2)` },
      // Paid but not yet received (incl. GST share): money out for material not in yet.
      { key: 'advance_at_risk', label: 'Advance at Risk (₹)', type: 'money', computed: `MAX(ROUND(${PAID} - ${RECEIVED_VALUE} * (CASE WHEN COALESCE({t}.subtotal,0) > 0 THEN {t}.total / {t}.subtotal ELSE 1 END), 2), 0)` },
      { key: 'payment_schedule', label: 'Payment Schedule (for planning)', type: 'lines', span: 2, amounts: false, schedule: true, hidden: true, hint: 'Filled by commercial / accounts. “After inward”: the due date is set when the material is received (GRN) + the days', columns: [
        { key: 'trigger', label: 'When', type: 'select', options: ['Fixed date', 'With PO', 'Before dispatch', 'After inward (GRN)'], width: 150 },
        { key: 'days', label: 'Days after', type: 'number', width: 70 },
        { key: 'due_date', label: 'Due Date', type: 'date', width: 140 },
        { key: 'description', label: 'Payment (advance, balance …)', type: 'text', width: 220 },
        { key: 'percent', label: '% of PO', type: 'number', width: 70 },
        { key: 'amount', label: 'Amount (₹)', type: 'money', width: 120 },
        { key: 'status', label: 'Status', type: 'select', options: ['Due', 'Paid', 'On hold'], width: 100 },
        { key: 'paid_on', label: 'Paid On', type: 'date', width: 140 },
      ] },
      { key: 'approved_by', label: 'Approved By (GM)', type: 'text', readonly: true },
      { key: 'remarks', label: 'Internal Remarks', type: 'textarea', span: 2 },
    ],
  },

  // ---------------------------------------------------------------- Payables: bills, debit notes, payments, expenses
  // Vendor's tax invoice against a PO. Payment against it is blocked when the PO's bills exceed the value received
  // (GRN) by more than the tolerance, unless the GM overrides with a reason (3-way match: PO – GRN – bill).
  vendor_bills: {
    label: 'Vendor Bills', singular: 'Vendor Bill', group: 'Purchase', icon: '🧾', write: ['admin', 'manager', 'accounts', 'purchase', 'purchase_head'],
    display: "{t}.bill_no",
    search: ['bill_no', 'remarks', 'match_note'],
    list: ['bill_date', 'bill_no', 'vendor_id', 'po_id', 'amount', 'debited', 'paid', 'balance', 'due_date', 'status', 'match_note'],
    statusField: 'status',
    related: [['vendor_payments', 'bill_id'], ['debit_notes', 'bill_id']],
    fields: [
      { key: 'bill_no', label: 'Vendor Invoice No', type: 'text', required: true, hint: 'The same invoice number for the same vendor cannot be entered twice' },
      { key: 'bill_date', label: 'Invoice Date', type: 'date', required: true, default: 'today' },
      { key: 'po_id', label: 'Against PO', type: 'ref', ref: 'purchase_orders', required: true },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', hint: 'Taken from the PO' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', readonly: true },
      { key: 'amount', label: 'Invoice Amount incl. GST (₹)', type: 'money', required: true },
      { key: 'due_date', label: 'Payment Due', type: 'date', hint: 'From the PO payment terms if blank' },
      { key: 'match_note', label: '3-way check (PO – received – bill)', type: 'text', readonly: true, span: 2 },
      { key: 'override_by', label: '3-way override by (GM)', type: 'text', readonly: true },
      { key: 'override_reason', label: 'Override reason', type: 'text', readonly: true },
      { key: 'debited', label: 'Debit Notes', type: 'money', computed: BILL_DN },
      // Advances paid on the PO before the bill are adjusted against its bills, oldest bill first.
      { key: 'advance_adjusted', label: 'Advance Adjusted', type: 'money', computed: BILL_ADJ },
      { key: 'paid', label: 'Paid (incl. advance)', type: 'money', computed: `ROUND(${BILL_DIRECT} + ${BILL_ADJ}, 2)` },
      { key: 'balance', label: 'Balance', type: 'money', computed: `ROUND(${BILL_OWN} - ${BILL_ADJ}, 2)` },
      { key: 'status', label: 'Status', type: 'select', options: ['', 'Unpaid', 'Partly Paid', 'Paid'], computed: `CASE WHEN ${BILL_OWN} - ${BILL_ADJ} <= 0.5 THEN 'Paid' WHEN ${BILL_DIRECT} + ${BILL_ADJ} > 0 THEN 'Partly Paid' ELSE 'Unpaid' END` },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  // Return, short supply, rate difference: reduces what is payable on the bill / PO (the bill itself is never edited).
  debit_notes: {
    label: 'Debit Notes', singular: 'Debit Note', group: 'Purchase', icon: '↩️', write: ['admin', 'manager', 'accounts', 'purchase_head'],
    display: "{t}.dn_no",
    search: ['dn_no', 'reason', 'remarks'],
    list: ['date', 'dn_no', 'vendor_id', 'po_id', 'bill_id', 'reason', 'amount'],
    fields: [
      { key: 'dn_no', label: 'Debit Note No', type: 'text', readonly: true, hint: 'Auto: DN-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: 'today' },
      { key: 'po_id', label: 'Against PO', type: 'ref', ref: 'purchase_orders', required: true },
      { key: 'bill_id', label: 'Against Vendor Bill', type: 'ref', ref: 'vendor_bills' },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', hint: 'Taken from the PO' },
      { key: 'reason', label: 'Reason', type: 'select', options: ['Material returned', 'Short supply', 'Rate difference', 'Damaged / rejected', 'Late delivery penalty', 'Other'], default: 'Material returned' },
      { key: 'amount', label: 'Amount incl. GST (₹)', type: 'money', required: true },
      { key: 'remarks', label: 'Details', type: 'textarea', span: 2 },
    ],
  },
  // A payment to a vendor: always against an approved PO, as an advance the PO terms allow or against a bill.
  // Draft → Pending Approval (Accounts; GM above the limit or outside the terms) → Approved → Paid (UTR) — locked;
  // only the GM can reverse it, with a reason.
  vendor_payments: {
    label: 'Vendor Payments', singular: 'Vendor Payment', group: 'Purchase', icon: '💸', write: ['admin', 'manager', 'accounts', 'purchase', 'purchase_head'],
    display: "COALESCE({t}.payment_no, '') || ' ₹' || {t}.amount",
    search: ['payment_no', 'reference', 'remarks', 'mode', 'reason'],
    list: ['date', 'payment_no', 'vendor_id', 'po_id', 'project_id', 'kind', 'amount', 'tds_amount', 'net_amount', 'mode', 'reference', 'status', 'bank_date'],
    statusField: 'status',
    fields: [
      { key: 'payment_no', label: 'Payment No', type: 'text', readonly: true, hint: 'Auto: PAY-001/2026-27' },
      { key: 'date', label: 'Payment Date', type: 'date', required: true, default: 'today' },
      { key: 'po_id', label: 'Against PO', type: 'ref', ref: 'purchase_orders', required: true, hint: 'Every vendor payment is against an approved PO' },
      { key: 'kind', label: 'Payment For', type: 'select', options: ['Advance (as per PO terms)', 'Against bill'], default: 'Advance (as per PO terms)' },
      { key: 'bill_id', label: 'Against Vendor Bill', type: 'ref', ref: 'vendor_bills' },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', hint: 'Taken from the PO' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', readonly: true, hint: 'From the PO; blank = store / general' },
      { key: 'amount', label: 'Amount (gross, ₹)', type: 'money', required: true },
      { key: 'tds_section', label: 'TDS Section', type: 'select', options: Object.keys(TDS_SECTIONS) },
      { key: 'tds_rate', label: 'TDS %', type: 'number', hint: 'Filled from the section; change if needed' },
      { key: 'tds_amount', label: 'TDS (₹)', type: 'money', readonly: true },
      { key: 'net_amount', label: 'Net Paid to Vendor (₹)', type: 'money', readonly: true },
      { key: 'mode', label: 'Mode', type: 'select', options: ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'DD', 'Other'], default: 'NEFT / RTGS' },
      { key: 'reference', label: 'UTR / Cheque No', type: 'text', readonly: true, hint: 'Entered when it is paid' },
      { key: 'reason', label: 'Why (if outside the PO terms)', type: 'textarea', span: 2, hint: 'Needed when the payment is more than the terms / bill allow; it then goes to the GM' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'Paid', 'Rejected', 'Reversed'], default: 'Draft', readonly: true },
      { key: 'approval_stage', label: 'Waiting For', type: 'text', readonly: true },
      { key: 'check_note', label: 'Check against the PO', type: 'textarea', span: 2, readonly: true },
      { key: 'off_terms', label: 'Outside the PO terms', type: 'yn', readonly: true },
      { key: 'requested_by', label: 'Prepared By', type: 'text', readonly: true },
      { key: 'approved_by', label: 'Approved By', type: 'text', readonly: true },
      { key: 'paid_by', label: 'Paid By', type: 'text', readonly: true },
      { key: 'bank_date', label: 'Bank Reconciled On', type: 'date', readonly: true },
      { key: 'reversed_reason', label: 'Reversal Reason', type: 'text', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  // Payments without a PO: salary, rent, utilities, fees (any amount) and small site expenses (up to the limit).
  expenses: {
    label: 'Expense Vouchers', singular: 'Expense Voucher', group: 'Purchase', icon: '🧾', write: ALL,
    display: "{t}.voucher_no",
    search: ['voucher_no', 'payee', 'description', 'reference'],
    list: ['date', 'voucher_no', 'category', 'project_id', 'payee', 'amount', 'mode', 'reference', 'status', 'bank_date'],
    statusField: 'status',
    fields: [
      { key: 'voucher_no', label: 'Voucher No', type: 'text', readonly: true, hint: 'Auto: EXP-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: 'today' },
      { key: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, default: 'Site expenses (petty)' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', hint: 'Blank = office / general' },
      { key: 'payee', label: 'Paid To', type: 'text', required: true },
      { key: 'amount', label: 'Amount (₹)', type: 'money', required: true },
      { key: 'description', label: 'What for', type: 'textarea', span: 2, required: true },
      { key: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'NEFT / RTGS', 'UPI', 'Cheque', 'Other'], default: 'Cash' },
      { key: 'reference', label: 'UTR / Cheque No', type: 'text', readonly: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'Paid', 'Rejected', 'Reversed'], default: 'Draft', readonly: true },
      { key: 'approval_stage', label: 'Waiting For', type: 'text', readonly: true },
      { key: 'requested_by', label: 'Prepared By', type: 'text', readonly: true },
      { key: 'approved_by', label: 'Approved By', type: 'text', readonly: true },
      { key: 'paid_by', label: 'Paid By', type: 'text', readonly: true },
      { key: 'bank_date', label: 'Bank Reconciled On', type: 'date', readonly: true },
      { key: 'reversed_reason', label: 'Reversal Reason', type: 'text', readonly: true },
    ],
  },

  // ---------------------------------------------------------------- Store
  items: {
    label: 'Item Master / Inventory', singular: 'Item', group: 'Store', icon: '🗃️', write: STORE,
    display: "COALESCE({t}.code || ' · ', '') || {t}.name",
    search: ['code', 'name', 'category', 'location', 'hsn', 'description'],
    list: ['code', 'name', 'category', 'uom', 'stock', 'rate', 'stock_value', 'reorder_level'],
    related: [['stock_moves', 'item_id']],
    fields: [
      { key: 'code', label: 'Item Code', type: 'text', hint: 'Leave blank for the next number' },
      { key: 'name', label: 'Item Name', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ITEM_CATEGORIES, default: 'Bought-out' },
      { key: 'uom', label: 'UOM', type: 'select', options: UOMS, default: 'Nos' },
      { key: 'rate', label: 'Current Price (₹ per unit)', type: 'money' },
      { key: 'gst_rate', label: 'GST %', type: 'number', default: 18 },
      { key: 'hsn', label: 'HSN Code', type: 'text', hint: 'Optional; pre-filled on POs' },
      { key: 'reorder_level', label: 'Minimum Stock Level', type: 'number', default: 0 },
      { key: 'lead_days', label: 'Lead Time (days)', type: 'number', hint: 'Worked out by itself from PO date to GRN date (average of the last 5 receipts against a PO); BOQ order-by date = required-by − lead time (blank = 7)' },
      { key: 'preferred_vendor_id', label: 'Preferred Vendor', type: 'ref', ref: 'vendors' },
      { key: 'location', label: 'Store Location / Rack', type: 'text' },
      { key: 'description', label: 'Specification', type: 'textarea', span: 2 },
      { key: 'opening_stock', label: 'Opening Stock (old)', type: 'number', hidden: true },
      { key: 'stock', label: 'Current Stock', type: 'number', computed: STOCK_SQL },
      { key: 'stock_value', label: 'Stock Value (₹)', type: 'money', computed: `ROUND(${STOCK_SQL} * COALESCE({t}.rate, 0), 2)` },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
  },
  // Anyone who needs material asks the store. The store checks the stock and splits each request: what is in stock goes
  // out on a draft issue slip / MTN (to the production stock for production), what is short goes to the Purchase Head
  // as a purchase requisition (with the site on every line).
  material_requests: {
    label: 'Material Requests (to Store)', singular: 'Material Request', group: 'Store', icon: '🙋', write: ALL,
    display: "{t}.mr_no",
    search: ['mr_no', 'requested_by', 'department', 'site', 'remarks'],
    list: ['mr_no', 'date', 'requested_by', 'department', 'purpose', 'site', 'needed_by', 'status'],
    statusField: 'status', print: 'mr',
    fields: [
      { key: 'mr_no', label: 'MR No', type: 'text', readonly: true, hint: 'Auto: MR-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'requested_by', label: 'Requested By', type: 'person', default: 'me' },
      { key: 'department', label: 'Department', type: 'select', options: ['Production', 'Site / Installation', 'Service', 'Electrical (BGM)', 'R&D', 'HVAC', 'Office'], default: 'Production' },
      { key: 'purpose', label: 'Material For', type: 'select', options: ['Production (to production stock)', 'Site / project', 'Service work', 'Office / general'], default: 'Production (to production stock)' },
      { key: 'site', label: 'Site / Hospital', type: 'text', hint: 'Where it is used; a line can have its own site' },
      { key: 'project_id', label: 'Project (CRM)', type: 'ref', ref: 'projects' },
      { key: 'swo_id', label: 'Service Work Order', type: 'ref', ref: 'service_work_orders', readonly: true },
      { key: 'needed_by', label: 'Needed By', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Issued', 'Partly Issued', 'Sent to Purchase', 'Closed', 'Rejected'], default: 'Draft', readonly: true },
      { key: 'lines', label: 'Materials', type: 'lines', span: 2, itemRef: true, amounts: false, hint: 'Pick the store item (or type the material); the store decides what is issued and what is purchased', columns: [
        { key: 'description', label: 'Material', type: 'text', width: 240 },
        { key: 'spec', label: 'Specification', type: 'text', width: 200 },
        { key: 'qty', label: 'Qty', type: 'number', width: 80 },
        { key: 'uom', label: 'UOM', type: 'text', width: 70 },
        { key: 'site', label: 'Site / Hospital', type: 'text', width: 150 },
        { key: 'remark', label: 'Remark', type: 'text', width: 140 },
        { key: 'issued', label: 'Issued', type: 'number', width: 70 },
        { key: 'to_purchase', label: 'To Purchase', type: 'number', width: 80 },
      ] },
      { key: 'store_note', label: 'Store Decision', type: 'textarea', span: 2, readonly: true },
      { key: 'processed_by', label: 'Processed By (Store)', type: 'text', readonly: true },
      { key: 'requisition_id', label: 'Purchase Requisition', type: 'ref', ref: 'requisitions', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  // Production: raw material reaches the production stock on an MTN from the store; each entry records the finished
  // goods made (into store stock when posted) and the raw material used from the production stock.
  production_entries: {
    label: 'Production (Finished Goods)', singular: 'Production Entry', group: 'Store', icon: '🏭', write: ['admin', 'manager', 'production', 'store'],
    display: "{t}.entry_no",
    search: ['entry_no', 'for_site', 'made_by', 'remarks'],
    list: ['entry_no', 'date', 'shift', 'fg_item_id', 'qty', 'uom', 'for_site', 'made_by', 'unit_cost', 'status'],
    statusField: 'status',
    fields: [
      { key: 'entry_no', label: 'Production No', type: 'text', readonly: true, hint: 'Auto: PRD-001/2026-27' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'shift', label: 'Shift', type: 'select', options: ['General', 'Day', 'Night'], default: 'General' },
      { key: 'fg_item_id', label: 'Finished Good Made', type: 'ref', ref: 'items', required: true },
      { key: 'qty', label: 'Quantity Made', type: 'number', required: true },
      { key: 'uom', label: 'UOM', type: 'text', hint: 'From the item if blank' },
      { key: 'for_site', label: 'For Site / Hospital', type: 'text' },
      { key: 'project_id', label: 'Project (CRM)', type: 'ref', ref: 'projects' },
      { key: 'bom_id', label: 'Against BOQ', type: 'ref', ref: 'boms' },
      { key: 'made_by', label: 'Made By / Supervisor', type: 'person', default: 'me' },
      { key: 'lines', label: 'Raw Material Used (from production stock)', type: 'lines', span: 2, itemRef: true, amounts: false,
        hint: 'Blank = the same material per piece as the last entry of this finished good', columns: [
          { key: 'description', label: 'Material', type: 'text', width: 260 },
          { key: 'qty', label: 'Qty Used', type: 'number', width: 90 },
          { key: 'uom', label: 'UOM', type: 'text', width: 70 },
          { key: 'remark', label: 'Remark', type: 'text', width: 160 },
        ] },
      { key: 'unit_cost', label: 'Material Cost per Piece (₹)', type: 'money', readonly: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Posted'], default: 'Draft', readonly: true },
      { key: 'posted_by', label: 'Posted By', type: 'text', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  // Outward (issue slip / dispatch challan) and transfers are prepared as drafts: nothing leaves the stock until someone
  // allowed to post checks and posts the draft; posting gives the issue / transfer / challan number.
  stock_drafts: {
    label: 'Draft Issues & Transfers', singular: 'Draft Slip', group: 'Store', icon: '📝', write: STORE.concat('engineer'), noCreate: true,
    display: "'Draft #' || {t}.id || ' · ' || COALESCE({t}.doc_kind, '')",
    search: ['doc_kind', 'issued_to', 'to_location', 'items', 'remarks', 'doc_no'],
    list: ['date', 'doc_kind', 'project_id', 'issued_to', 'to_location', 'item_count', 'prepared_by', 'status', 'doc_no'],
    statusField: 'status',
    fields: [
      { key: 'doc_kind', label: 'Document', type: 'select', options: ['Issue slip', 'Dispatch challan', 'Material Transfer Note (MTN)', 'MTN with delivery challan', 'Transfer slip', 'Transfer with challan'], readonly: true },
      { key: 'mr_id', label: 'Material Request', type: 'ref', ref: 'material_requests', readonly: true },
      { key: 'type', label: 'Movement', type: 'select', options: ['OUTWARD', 'TRANSFER'], readonly: true },
      { key: 'date', label: 'Date', type: 'date', readonly: true },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', readonly: true },
      { key: 'issued_to', label: 'Issued To / Site', type: 'text', readonly: true },
      { key: 'to_location', label: 'Transfer To', type: 'text', readonly: true },
      { key: 'item_count', label: 'Items', type: 'number', readonly: true },
      { key: 'items', label: 'Materials', type: 'textarea', span: 2, readonly: true },
      { key: 'payload', label: 'Slip', type: 'json', hidden: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Posted', 'Cancelled'], default: 'Draft', readonly: true },
      { key: 'doc_no', label: 'Issue / Transfer No (when posted)', type: 'text', readonly: true },
      { key: 'challan_id', label: 'Delivery Challan', type: 'ref', ref: 'challans', readonly: true },
      { key: 'prepared_by', label: 'Prepared By', type: 'text', readonly: true },
      { key: 'posted_by', label: 'Posted By', type: 'text', readonly: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  stock_moves: {
    label: 'Stock Movements', singular: 'Stock Movement', group: 'Store', icon: '🔁', write: STORE.concat('engineer'),
    display: "COALESCE({t}.doc_no, '') || ' ' || {t}.type",
    search: ['doc_no', 'issued_to', 'supplier', 'invoice_no', 'po_no', 'remarks', 'to_location', 'against_issue_no'],
    list: ['date', 'type', 'doc_no', 'item_id', 'qty', 'uom', 'rate', 'value', 'project_id', 'issued_to', 'supplier', 'po_no'],
    statusField: 'type',
    fields: [
      { key: 'type', label: 'Movement Type', type: 'select', options: Object.keys(MOVE_TYPES), default: 'OUTWARD' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'doc_no', label: 'GRN / Issue / Transfer No', type: 'text', hint: 'Auto: 001/2026-27 per type if blank' },
      { key: 'item_id', label: 'Item', type: 'ref', ref: 'items', required: true },
      { key: 'qty', label: 'Quantity', type: 'number', required: true, hint: 'For Adjustment use a negative number to reduce stock' },
      { key: 'uom', label: 'UOM', type: 'text', hint: 'Taken from the item if blank' },
      { key: 'rate', label: 'Price per Piece (₹)', type: 'money', hint: 'Required for Inward; defaults to the item price otherwise' },
      { key: 'value', label: 'Value (₹)', type: 'money', computed: 'ROUND(COALESCE({t}.qty,0) * COALESCE({t}.rate,0), 2)' },
      { key: 'vendor_id', label: 'Supplier', type: 'ref', ref: 'vendors', showIf: { type: ['INWARD'] } },
      { key: 'supplier', label: 'Supplier (as on invoice)', type: 'text', showIf: { type: ['INWARD'] } },
      { key: 'invoice_no', label: 'Supplier Invoice No', type: 'text', showIf: { type: ['INWARD'] } },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date', showIf: { type: ['INWARD'] } },
      { key: 'po_id', label: 'Against PO', type: 'ref', ref: 'purchase_orders', showIf: { type: ['INWARD'] } },
      { key: 'po_no', label: 'PO No (text)', type: 'text', showIf: { type: ['INWARD'] } },
      { key: 'hsn', label: 'HSN Code', type: 'text', showIf: { type: ['INWARD'] } },
      { key: 'gst_rate', label: 'GST %', type: 'number', showIf: { type: ['INWARD'] } },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects', showIf: { type: ['OUTWARD', 'RETURN', 'TRANSFER', 'SCRAP'] } },
      { key: 'issued_to', label: 'Issued To / Site / Department', type: 'text', showIf: { type: ['OUTWARD', 'RETURN', 'SCRAP'] } },
      { key: 'requested_by', label: 'Requested By', type: 'person', showIf: { type: ['OUTWARD', 'TRANSFER'] } },
      { key: 'from_location', label: 'From Location', type: 'text', suggest: ['Store', 'Production'], showIf: { type: ['TRANSFER'] } },
      { key: 'to_location', label: 'To Location', type: 'text', suggest: ['Production', 'VRS Engineering', 'Shree Perforater', 'Site'], showIf: { type: ['TRANSFER'] } },
      { key: 'against_issue_no', label: 'Original Issue No', type: 'text', showIf: { type: ['RETURN'] } },
      { key: 'reason', label: 'Reason', type: 'text', suggest: ['Faulty', 'Rework', 'Excess', 'Rusting', 'Expiry', 'Cut', 'Damaged'], showIf: { type: ['RETURN', 'SCRAP', 'ADJUST'] } },
      { key: 'purpose', label: 'Purpose', type: 'text', showIf: { type: ['TRANSFER', 'OUTWARD'] } },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
      { key: 'import_batch', label: 'Import Batch', type: 'text', hidden: true },
    ],
  },
};

export const GROUPS = ['CRM', 'Approvals', 'Sales & Projects', 'Service', 'Purchase', 'Store'];

export function fieldMap(entity) {
  return Object.fromEntries(ENTITIES[entity].fields.map(f => [f.key, f]));
}

// Permissions of each role, loaded from the database (server) or from /me (browser).
let PERMS = {};
export function setPermissions(map) { PERMS = { ...PERMS, ...map }; }

// Defaults for the built-in roles (also the starting point for a new role).
export function defaultPermissions(role) {
  const modules = {};
  for (const [name, ent] of Object.entries(ENTITIES)) {
    modules[name] = role === 'manager' ? 'full' : !roleSees(role, name) ? 'none' : (ent.write || []).includes(role) ? 'edit' : 'view';
  }
  return { modules, functions: DEFAULT_FUNCTIONS[role] || [] };
}
const permsOf = role => PERMS[role] || defaultPermissions(role);

export function moduleAccess(entity, role) {
  if (role === 'admin') return 'full';
  if (entity === 'boq_items') entity = 'boqs';
  if (entity === 'bom_items') entity = 'boms';
  return permsOf(role).modules?.[entity] || 'none';
}
export const canView = (entity, role) => moduleAccess(entity, role) !== 'none';
export const canWrite = (entity, role) => ['edit', 'full'].includes(moduleAccess(entity, role));
export const canDelete = (entity, role) => moduleAccess(entity, role) === 'full';
export const hasFunction = (role, fn) => role === 'admin' || (permsOf(role).functions || []).includes(fn);
