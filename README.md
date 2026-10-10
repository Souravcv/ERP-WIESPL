# ERP-CRM

## WIESPL CRM & ERP

Web-based CRM + ERP for Western India Electromedical Systems Pvt. Ltd. It runs on one office PC and staff use it from any browser on the office network.

## Start

1. Install **Node.js 22.13 or newer** (it has SQLite built in, so there is no database server to install).
2. Double-click `start-crm.bat` (or run `npm install` then `npm start`).
3. Open `http://localhost:3000` on that PC. Other staff use the "Office network" address the window prints, e.g. `http://192.168.0.44:3000`.
   If they cannot connect, allow Node.js through Windows Firewall for Private networks.
4. First login: user `admin`, with the password in `data/initial-admin-password.txt`. You will be asked to set a new password. Then delete that file and create users under **Admin → Users & Roles**.

Locked out of admin? Double-click `reset-admin-password.bat`; it writes a new temporary password to `data/initial-admin-password.txt`.

Options: `PORT=8080` changes the port; `WIESPL_DATA_DIR=D:\crm-data` moves the database.

## Backup

All data is in `data/wiespl.db` (plus `-wal` / `-shm` files while running). Stop the server and copy the `data` folder to a backup drive or cloud folder regularly.

## Modules

| Area | What it does |
|---|---|
| **Enquiry Register** | Same columns as the Excel register. Auto numbers `NN/MM/FY` and `WIESPL/NN/MMYY` (one running number per April–March year). Status, follow-up date, Excel export in the register layout. **Admin → Import** loads the existing register .xlsx. |
| **Customers & Contacts** | Hospitals, doctors, consultants and architects, with every linked enquiry, quotation, order, invoice and ticket. |
| **Follow-ups** | Call/visit log with next date. Due and overdue items show on the dashboard. |
| **Quotation Builder** | 1) Rooms & Basis of Design: wall, ceiling, coving and flooring areas plus air changes are calculated from L×W×H (type `6550mm` to convert). 2) BOQ from the Product Catalog: area items take quantities from the rooms automatically; room-wise totals. 3) Optional items. 4) Summary with GST and amount in words. 5) Letter, terms, client scope and scope sheet. Prints in the WIESPL annexure format (Print → Save as PDF). |
| **Approvals** | Quotations and POs go to a manager for approval and are locked once submitted. **Revise** creates R1, R2… revisions. Can be turned off in Settings. |
| **Material / Drawing Approvals** | Client submittals per project (material, make, drawing, colour…) with status, client remarks and approval date. |
| **Sales Orders** | Created from a won quotation (client PO no / date). Buttons create the Project and milestone invoices (e.g. 50% / 45% / 5%). |
| **Projects** | Stage (drawing → material approval → procurement → dispatch → installation → validation → handover), progress, engineer, warranty, plus linked submittals, POs, material issues and service tickets. |
| **Invoices & Payments** | Tax and proforma invoices with CGST+SGST or IGST by place of supply. Payments update Paid / Partially Paid automatically. |
| **Purchase** | Vendors and POs with approval, print, and goods receipt (GRN) that adds stock. |
| **Inventory** | Items, stock in/out/adjust, issue to project, reorder-level alerts. |
| **Service / Complaints** | Breakdown, PM, warranty and AMC tickets. |
| **Dashboard** | FY KPIs, enquiries per month, win rate, pipeline, receivables, follow-ups due, pending approvals, low stock, projects by stage. |
| **Admin** | Users & roles, company / quotation defaults (USP, terms, client scope, letter text), activity log of every change. |

### Roles

`admin` everything · `manager` everything + approvals + delete · `sales` CRM & quotations · `accounts` orders, invoices, payments, purchase · `store` inventory & purchase · `engineer` projects, submittals, service, material issue.

## First steps after install

1. **Admin → Company & Quotation Settings**: fill in GSTIN and bank details (printed on invoices).
2. **Product Catalog**: enter rates. The 35 BOQ items from the quotation workbook are pre-loaded with full specifications, but the workbook had no rates. Set *Installation %* where it applies (the pass box uses 12%).
3. **Admin → Import Enquiry Register** with the current register file.
4. Create user accounts for the team.

## Code layout

- `public/js/schema.js`: every module's fields, list columns and permissions. Adding a field here adds the database column, form input and Excel export column automatically.
- `public/js/calc.js`: Basis of Design and BOQ / GST math, shared by browser and server.
- `server/hooks.js`: numbering and totals. `server/workflows.js`: approvals, revise, convert, GRN, invoicing.
- `server/seed.js`: default catalog, USP, terms and scope from the WIESPL quotation format.
