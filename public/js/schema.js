// Single source of truth for every CRM/ERP module.
// The server builds tables, validation and joins from this; the browser builds forms and lists from it.
// Field types: text, textarea, number, money, date, select, yn, ref, person, email, tel, lines, json
// `computed` fields are read-only SQL expressions evaluated by the server ({t} = the entity's table alias).

export const ROLES = ['admin', 'manager', 'sales', 'accounts', 'store', 'engineer', 'purchase', 'purchase_head', 'technical'];

const ALL = ROLES;
const CRM = ['admin', 'manager', 'sales'];
const ACC = ['admin', 'manager', 'accounts'];
const PURCHASE = ['admin', 'manager', 'purchase', 'purchase_head', 'accounts', 'store'];
const STORE = ['admin', 'manager', 'store', 'purchase', 'purchase_head', 'accounts'];
const ENG = ['admin', 'manager', 'engineer', 'sales', 'technical'];

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
};
const SIGNED_QTY = m => `CASE WHEN ${m}.type IN ('INWARD','IN','RETURN','ADJUST') THEN ${m}.qty WHEN ${m}.type IN ('OUTWARD','OUT','TRANSFER','SCRAP') THEN -${m}.qty ELSE 0 END`;
// Current stock: the latest 1-April opening entry (or the legacy opening field) plus every movement since it.
export const STOCK_SQL = `(CASE WHEN EXISTS (SELECT 1 FROM stock_moves o WHERE o.item_id = {t}.id AND o.type = 'OPENING')
    THEN (SELECT o.qty FROM stock_moves o WHERE o.item_id = {t}.id AND o.type = 'OPENING' ORDER BY o.date DESC, o.id DESC LIMIT 1)
    ELSE COALESCE({t}.opening_stock, 0) END
  + (SELECT COALESCE(SUM(${SIGNED_QTY('m')}), 0) FROM stock_moves m WHERE m.item_id = {t}.id
      AND m.date >= COALESCE((SELECT MAX(o.date) FROM stock_moves o WHERE o.item_id = {t}.id AND o.type = 'OPENING'), '0000-00-00')))`;

// ---------------------------------------------------------------- roles & permissions
// Built-in roles; admins can edit them and create new ones under Admin → Roles & Permissions.
export const ROLE_INFO = {
  admin: { label: 'Administrator', description: 'Everything, incl. users, roles, settings and backup' },
  manager: { label: 'General Manager', description: 'Everything + final (GM) approval of POs, quotation approval, deletes records' },
  sales: { label: 'Sales', description: 'Customers, enquiries, follow-ups, quotations, catalog' },
  accounts: { label: 'Account Manager', description: 'Commercial approval of POs, sales orders, invoices, payments, vendors' },
  store: { label: 'Store', description: 'Item master, stock inward / issue / transfer / return / scrap, opening stock' },
  engineer: { label: 'Site Engineer', description: 'Projects, material/drawing approvals, service tickets, material issue' },
  purchase: { label: 'Purchase Executive', description: 'Vendors, requisitions, prepares purchase orders' },
  purchase_head: { label: 'Purchase Head', description: 'Approves material requisitions; purchase and store' },
  technical: { label: 'Technical Manager', description: 'Technical approval of POs; projects' },
};

// Special actions a role may be allowed, beyond module access.
export const FUNCTIONS = {
  approve_quotation: 'Approve quotations',
  approve_requisition: 'Approve material requisitions (Purchase Head step)',
  po_technical: 'PO step 2 – Technical Approval',
  po_commercial: 'PO step 3 – Commercial Approval',
  po_final: 'PO step 4 – Final approval (GM)',
  stock_opening: 'Create 1 April opening stock for all items',
  allow_negative: 'Issue more than the available stock',
  import: 'Import from Excel',
  view_audit: 'See change history / activity log',
};
const DEFAULT_FUNCTIONS = {
  manager: Object.keys(FUNCTIONS),
  purchase_head: ['approve_requisition', 'stock_opening', 'import'],
  technical: ['po_technical'],
  accounts: ['po_commercial', 'import'],
  store: ['stock_opening', 'import'],
  purchase: ['import'],
  sales: ['import'],
  engineer: [],
};
export const ACCESS_LEVELS = { none: 'No access', view: 'View', edit: 'View + add / edit', full: 'Full (incl. delete)' };

// Approval steps; who may approve is the role's function list.
export const APPROVAL_FLOWS = {
  Quotation: [{ stage: 'Approval', fn: 'approve_quotation' }],
  Requisition: [{ stage: 'Purchase Head', fn: 'approve_requisition' }],
  'Purchase Order': [
    { stage: 'Technical Approval', fn: 'po_technical', field: 'tech_approved_by' },
    { stage: 'Commercial Approval', fn: 'po_commercial', field: 'comm_approved_by' },
    { stage: 'Approved By (GM)', fn: 'po_final', field: 'approved_by' },
  ],
};

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
    list: ['enquiry_no', 'quote_ref', 'date', 'hospital_name', 'doctor_name', 'place', 'type_of_work', 'enquiry_by', 'status', 'next_followup'],
    statusField: 'status',
    related: [['followups', 'enquiry_id'], ['quotations', 'enquiry_id']],
    fields: [
      { key: 'enquiry_no', label: 'Enquiry No.', type: 'text', readonly: true, hint: 'Auto: NN/MM/FY' },
      { key: 'quote_ref', label: 'Quotation Ref No', type: 'text', readonly: true, hint: 'Auto: WIESPL/NN/MMYY' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: 'today' },
      { key: 'status', label: 'Quotation Status', type: 'select', options: ['New', 'In Process', 'Quoted', 'Negotiation', 'Won', 'Lost', 'On Hold', 'Regret'], default: 'New' },
      { key: 'customer_id', label: 'Hospital (from Customers)', type: 'ref', ref: 'customers' },
      { key: 'hospital_name', label: 'Name of the Hospital', type: 'text' },
      { key: 'place', label: 'Place', type: 'text' },
      { key: 'district', label: 'District', type: 'text' },
      { key: 'doctor_name', label: 'Name of the Doctor', type: 'text' },
      { key: 'doctor_phone', label: 'Doctor Contact No.', type: 'tel' },
      { key: 'consultant_name', label: 'Consultant / Architect', type: 'text' },
      { key: 'consultant_phone', label: 'Consultant Contact No.', type: 'tel' },
      { key: 'type_of_work', label: 'Type of Work', type: 'text', hint: 'e.g. MOT, NICU, ICU, CSSD, Cath Lab', suggest: ['MOT', 'MOT + Passage', 'NICU', 'ICU', 'PICU', 'CSSD', 'Cath Lab', 'IVF Lab', 'Isolation Room', 'Pendants', 'HVAC only', 'Panels only'] },
      { key: 'capacity', label: 'Hospital Capacity', type: 'text' },
      { key: 'enquiry_by', label: 'Enquiry By', type: 'person' },
      { key: 'supported_by', label: 'Supported By', type: 'person' },
      { key: 'quoted_by', label: 'Quoted By', type: 'person' },
      { key: 'drawing_received', label: 'Drawing Received', type: 'yn' },
      { key: 'source', label: 'Lead Source', type: 'select', options: ['', 'Direct', 'Consultant / Architect', 'Reference', 'Website', 'Exhibition', 'Tender', 'Existing Customer', 'Dealer', 'Other'] },
      { key: 'expected_value', label: 'Expected Value (₹)', type: 'money' },
      { key: 'next_followup', label: 'Next Follow-up', type: 'date' },
      { key: 'kickback', label: 'Kick Back Involved', type: 'yn' },
      { key: 'remarks', label: 'Remarks / Feedback', type: 'textarea', span: 2 },
      { key: 'lost_reason', label: 'Lost / Regret Reason', type: 'text', span: 2 },
      { key: 'verified_by', label: 'Verified By', type: 'person' },
      { key: 'verified_date', label: 'Verified Date', type: 'date' },
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
    list: ['sort', 'code', 'name', 'kind', 'category', 'uom', 'rate', 'install_pct', 'qty_basis', 'active'],
    fields: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'name', label: 'Short Name', type: 'text', required: true },
      { key: 'kind', label: 'Line Type', type: 'select', options: ['Item', 'Heading'], default: 'Item', hint: 'Heading = specification row without qty, followed by size items' },
      { key: 'sort', label: 'Order in Standard BOQ', type: 'number', hint: 'Blank = not part of the standard BOQ' },
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
    search: ['doc_type', 'doc_ref', 'title', 'requested_by', 'comments'],
    list: ['requested_at', 'doc_type', 'doc_ref', 'stage', 'title', 'amount', 'requested_by', 'status', 'decided_by'],
    statusField: 'status',
    fields: [
      { key: 'doc_type', label: 'Document Type', type: 'select', options: ['Quotation', 'Purchase Order', 'Requisition', 'Discount', 'Expense', 'Other'], readonly: true },
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
    label: 'Sales Orders', singular: 'Sales Order', group: 'Sales & Projects', icon: '🤝', write: ['admin', 'manager', 'sales', 'accounts'],
    display: "{t}.so_no",
    search: ['so_no', 'client_po_no', 'remarks'],
    list: ['so_no', 'date', 'customer_id', 'quotation_id', 'client_po_no', 'order_value', 'status', 'delivery_date'],
    statusField: 'status',
    related: [['projects', 'sales_order_id'], ['invoices', 'sales_order_id']],
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
      { key: 'invoiced', label: 'Invoiced', type: 'money', computed: "(SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.sales_order_id = {t}.id AND i.status <> 'Cancelled')" },
      { key: 'advance_received', label: 'Advance Received (₹)', type: 'money' },
      { key: 'delivery_date', label: 'Committed Delivery', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'In Execution', 'Completed', 'Cancelled'], default: 'Open' },
      { key: 'payment_terms', label: 'Payment Terms', type: 'textarea', span: 2, default: '50% advance with PO, 45% against PI before dispatch & 5% against installation completion.' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  projects: {
    label: 'Projects / Execution', singular: 'Project', group: 'Sales & Projects', icon: '🏗️', write: ENG,
    display: "COALESCE(NULLIF({t}.project_no, ''), {t}.code) || ' ' || {t}.name",
    search: ['code', 'project_no', 'name', 'site', 'site_address', 'engineer', 'notes'],
    list: ['project_no', 'name', 'customer_id', 'site', 'stage', 'material_cost', 'po_value', 'status'],
    statusField: 'status',
    related: [['requisitions', 'project_id'], ['purchase_orders', 'project_id'], ['stock_moves', 'project_id'], ['material_approvals', 'project_id'], ['invoices', 'project_id'], ['service_tickets', 'project_id']],
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
  invoices: {
    label: 'Invoices', singular: 'Invoice', group: 'Sales & Projects', icon: '💳', write: ACC,
    display: "{t}.invoice_no",
    search: ['invoice_no', 'notes', 'place_of_supply'],
    list: ['invoice_no', 'date', 'customer_id', 'sales_order_id', 'total', 'paid', 'balance', 'due_date', 'status'],
    statusField: 'status', print: 'invoice',
    related: [['payments', 'invoice_id']],
    fields: [
      { key: 'invoice_no', label: 'Invoice No', type: 'text', readonly: true },
      { key: 'type', label: 'Type', type: 'select', options: ['Tax Invoice', 'Proforma Invoice'], default: 'Tax Invoice' },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { key: 'sales_order_id', label: 'Sales Order', type: 'ref', ref: 'sales_orders' },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'place_of_supply', label: 'Place of Supply', type: 'select', options: STATES, default: 'Maharashtra' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Cancelled'], default: 'Draft' },
      { key: 'lines', label: 'Items', type: 'lines', span: 2, columns: LINE_COLS },
      { key: 'subtotal', label: 'Taxable Value', type: 'money', readonly: true },
      { key: 'tax', label: 'GST', type: 'money', readonly: true },
      { key: 'total', label: 'Invoice Total', type: 'money', readonly: true },
      { key: 'paid', label: 'Received', type: 'money', computed: "(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id = {t}.id)" },
      { key: 'balance', label: 'Balance', type: 'money', computed: "COALESCE({t}.total,0) - (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id = {t}.id)" },
      { key: 'notes', label: 'Notes / Bank Details', type: 'textarea', span: 2 },
    ],
  },
  payments: {
    label: 'Payments Received', singular: 'Payment', group: 'Sales & Projects', icon: '💰', write: ACC,
    display: "{t}.date || ' ₹' || {t}.amount",
    search: ['reference', 'remarks', 'mode'],
    list: ['date', 'invoice_id', 'customer_id', 'amount', 'mode', 'reference'],
    fields: [
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'invoice_id', label: 'Against Invoice', type: 'ref', ref: 'invoices' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { key: 'amount', label: 'Amount (₹)', type: 'money', required: true },
      { key: 'mode', label: 'Mode', type: 'select', options: ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'DD', 'Other'], default: 'NEFT / RTGS' },
      { key: 'reference', label: 'UTR / Cheque No', type: 'text' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
    ],
  },
  service_tickets: {
    label: 'Service / Complaints', singular: 'Service Ticket', group: 'Sales & Projects', icon: '🛠️', write: ENG.concat('store'),
    display: "{t}.ticket_no",
    search: ['ticket_no', 'complaint', 'assigned_to', 'resolution'],
    list: ['ticket_no', 'date', 'customer_id', 'category', 'priority', 'complaint', 'assigned_to', 'status'],
    statusField: 'status',
    fields: [
      { key: 'ticket_no', label: 'Ticket No', type: 'text', readonly: true },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'category', label: 'Category', type: 'select', options: ['Breakdown', 'Preventive Maintenance', 'Warranty', 'AMC Visit', 'Validation', 'Installation Support', 'Other'], default: 'Breakdown' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
      { key: 'equipment', label: 'Equipment (AHU, Panel, Door...)', type: 'text' },
      { key: 'under_warranty', label: 'Under Warranty / AMC', type: 'yn' },
      { key: 'complaint', label: 'Complaint', type: 'textarea', span: 2, required: true },
      { key: 'reported_by', label: 'Reported By (client)', type: 'text' },
      { key: 'assigned_to', label: 'Assigned Engineer', type: 'person' },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'In Progress', 'Waiting for Parts', 'Resolved', 'Closed'], default: 'Open' },
      { key: 'closed_date', label: 'Closed Date', type: 'date' },
      { key: 'resolution', label: 'Resolution / Action Taken', type: 'textarea', span: 2 },
      { key: 'charges', label: 'Charges (₹)', type: 'money' },
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
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'project_name', label: 'Project Name (as printed)', type: 'text', hint: 'Filled from the project if left blank' },
      { key: 'requested_by', label: 'Requester', type: 'person', default: 'me' },
      { key: 'department', label: 'Department', type: 'select', options: ['', 'Production', 'Site / Installation', 'Electrical (BGM)', 'R&D', 'HVAC', 'Store', 'Service', 'Office'] },
      { key: 'required_by', label: 'Required By', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Converted to PO', 'Closed'], default: 'Draft', readonly: true },
      { key: 'lines', label: 'Materials', type: 'lines', span: 2, itemRef: true, amounts: false, columns: [
        { key: 'description', label: 'Material Description', type: 'text', width: 260 },
        { key: 'spec', label: 'Specification', type: 'textarea', width: 260 },
        { key: 'qty', label: 'Qty', type: 'number', width: 80 },
        { key: 'uom', label: 'UOM', type: 'text', width: 70 },
        { key: 'remark', label: 'Remark', type: 'text', width: 160 },
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
    list: ['po_no', 'date', 'vendor_id', 'project_id', 'total', 'approval_stage', 'status'],
    statusField: 'status', print: 'po',
    fields: [
      { key: 'po_no', label: 'PO No', type: 'text', readonly: true, hint: 'Auto: 008/2026-27, restarts every April' },
      { key: 'date', label: 'PO Date', type: 'date', default: 'today', required: true },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', required: true },
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'projects' },
      { key: 'requisition_id', label: 'Against Requisition', type: 'ref', ref: 'requisitions' },
      { key: 'quotation_ref', label: 'Ref.: Vendor Quotation No / Date', type: 'text' },
      { key: 'delivery_date', label: 'Delivery Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Sent', 'Partially Received', 'Closed', 'Received', 'Cancelled'], default: 'Draft', readonly: true },
      { key: 'approval_stage', label: 'Waiting For', type: 'text', readonly: true },
      { key: 'delivery_address', label: 'Delivery & Billing Address', type: 'textarea', default: 'setting:po_delivery_address' },
      { key: 'contact_person', label: 'Our Contact Person', type: 'text', default: 'setting:po_contact_person' },
      { key: 'contact_phone', label: 'Our Contact No', type: 'text', default: 'setting:po_contact_phone' },
      { key: 'contact_emails', label: 'Our Email(s)', type: 'text', default: 'setting:po_contact_emails' },
      { key: 'lines', label: 'Items', type: 'lines', span: 2, itemRef: true, hint: 'Leave Qty blank on a heading line (e.g. "Fire Damper" + spec) and add each size as its own line', columns: [
        { key: 'description', label: 'Item Name', type: 'text', width: 200 },
        { key: 'hsn', label: 'Item Code / HSN', type: 'text', width: 100 },
        { key: 'spec', label: 'Specifications', type: 'textarea', width: 280 },
        { key: 'qty', label: 'Qty', type: 'number', width: 70 },
        { key: 'uom', label: 'UOM', type: 'text', width: 64 },
        { key: 'rate', label: 'Rate', type: 'money', width: 100 },
        { key: 'gst', label: 'GST %', type: 'number', width: 60 },
      ] },
      { key: 'subtotal', label: 'Sub Total', type: 'money', readonly: true },
      { key: 'tax', label: 'GST', type: 'money', readonly: true },
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
      { key: 'tech_approved_by', label: 'Technical Approval', type: 'text', readonly: true },
      { key: 'comm_approved_by', label: 'Commercial Approval', type: 'text', readonly: true },
      { key: 'approved_by', label: 'Approved By (GM)', type: 'text', readonly: true },
      { key: 'remarks', label: 'Internal Remarks', type: 'textarea', span: 2 },
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
      { key: 'preferred_vendor_id', label: 'Preferred Vendor', type: 'ref', ref: 'vendors' },
      { key: 'location', label: 'Store Location / Rack', type: 'text' },
      { key: 'description', label: 'Specification', type: 'textarea', span: 2 },
      { key: 'opening_stock', label: 'Opening Stock (old)', type: 'number', hidden: true },
      { key: 'stock', label: 'Current Stock', type: 'number', computed: STOCK_SQL },
      { key: 'stock_value', label: 'Stock Value (₹)', type: 'money', computed: `ROUND(${STOCK_SQL} * COALESCE({t}.rate, 0), 2)` },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
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

export const GROUPS = ['CRM', 'Approvals', 'Sales & Projects', 'Purchase', 'Store'];

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
    modules[name] = role === 'manager' ? 'full' : (ent.write || []).includes(role) ? 'edit' : 'view';
  }
  return { modules, functions: DEFAULT_FUNCTIONS[role] || [] };
}
const permsOf = role => PERMS[role] || defaultPermissions(role);

export function moduleAccess(entity, role) {
  if (role === 'admin') return 'full';
  return permsOf(role).modules?.[entity] || 'none';
}
export const canView = (entity, role) => moduleAccess(entity, role) !== 'none';
export const canWrite = (entity, role) => ['edit', 'full'].includes(moduleAccess(entity, role));
export const canDelete = (entity, role) => moduleAccess(entity, role) === 'full';
export const hasFunction = (role, fn) => role === 'admin' || (permsOf(role).functions || []).includes(fn);
