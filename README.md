# ERP-CRM

## WIESPL CRM & ERP

Web-based CRM + ERP for Western India Electromedical Systems Pvt. Ltd. It runs on one office PC and staff use it from any browser on the office network.

## Start

1. Install **Node.js 22.13 or newer** (it has SQLite built in, so there is no database server to install).
2. Double-click `start-crm.bat`, or in PowerShell in this folder run `.\start-crm.bat` (or `npm install` then `npm start`).
3. Open `http://localhost:3000` on that PC. Other staff use the "Office network" address the window prints, e.g. `http://192.168.0.44:3000`.
   If they cannot connect, allow Node.js through Windows Firewall for Private networks.
4. First login: user `admin`, with the password in `data/initial-admin-password.txt`. You will be asked to set a new password. Then delete that file and create users under **Admin → Users & Roles**.

Locked out of admin? Double-click `reset-admin-password.bat`; it writes a new temporary password to `data/initial-admin-password.txt`.

Options: `PORT=8080` changes the port; `WIESPL_DATA_DIR=D:\crm-data` moves the database.

## Backup

All data is in `data/wiespl.db` (plus `-wal` / `-shm` files while running). Stop the server and copy the `data` folder to a backup drive or cloud folder regularly.

## Hosting on Render

`render.yaml` sets everything up: in Render choose **New → Blueprint**, pick this GitHub repository and enter the first admin password (`ADMIN_PASSWORD`).

- The database and attached files are kept on a persistent disk at `/var/data` (`WIESPL_DATA_DIR`). Disks need a paid instance (plan `starter`); on the free plan every restart or deploy would erase all data.
- To bring the office data across: on the office PC, **Admin → Import / Backup → Download full backup**; on Render, log in as admin, **Restore** that `.db` file, then **Manual Deploy → Restart service**. Attached files (drawings, work orders) are not in the backup and have to be uploaded again.
- Use only one copy (office PC *or* Render) for daily work, otherwise the two databases drift apart.
- `autoDeploy` is off: after pushing new code, click **Manual Deploy → Deploy latest commit**.

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
| **Work order → BOQ → store** | **Standard Material Lists** (Sales & Projects → 🧩): the components for ONE unit of a product (one door, one Sq. Ft of panel …), linked to store items, with match words. On a work order, **⚙️ Generate BOQ** matches each line to a list (or you pick one) and multiplies the components by the work-order qty; lines without a list are copied for design to detail, or use **📋 Copy from earlier BOQ**. **Design review**: every department (Doors, HVAC, Electrical, Production / Panels …) reviews and may edit its section; a change after review sends that section back. **🔒 Make Final** (Technical Manager / GM) locks the BOQ, reserves free store stock (earliest required-by date first) and raises a **Draft requisition** for the shortage, with order-by dates from each item's lead time; the store checks it and submits it to the Purchase Head. **Store → 📦 BOQ Store Check** shows every Final BOQ's reserved / short / late material. **🔓 Reopen** releases the reservation for changes. Each component is **Per unit** (× work-order qty) or **Per job** (fixed once per BOQ: rivets, silicone, tools); the same component from several lines (wall + ceiling) becomes one BOQ line under the list's **BOQ section**. **Sub-assemblies**: a list that "makes" a store item (e.g. the 32" surgeon control panel) adds its parts in a **BUILD › …** section for the making department; the finished item is marked *made in-house* and only its parts are requisitioned. **📥 From bill of material Excel** turns an engineers' BOQ into lists, one per section (quantities ÷ "per unit of", consumables pre-marked per job). **📂 Create Work Order** on a sales order makes the work order from its quotation (each line's total qty over the rooms, qty per room, catalog product); a list linked to that **Catalog product** is used for it automatically. Issuing stock that is **reserved** for another project's Final BOQ asks for confirmation (Stock Entry, dispatch, challans). A **daily store check** (after 7 am) raises a Draft requisition when a Final BOQ is short again and reminds the store of material to order within 3 days that is not on a PO. |
| **✅ My tasks** | Everything waiting for the logged-in person: BOQ sections to review, BOQs ready to make Final, changes asked of you, requisitions to check and submit, approvals, material to order this week, follow-ups due, work orders without a BOQ. |
| **Material Requisitions** | Project, Req No (REQ-001/2026-27), lines (description, specification, qty, UOM, remark). Draft → Submitted → approved by Purchase Head → converted to a PO. Prints in the WIESPL requisition format. |
| **Purchase Orders** | PO No 008/2026-27 (restarts every April). Vendor details, delivery address, contact, terms (payment, delivery, warranty, freight, validity, invoice copies, jurisdiction) from a saved template. Item lines with size sub-lines. CGST+SGST or IGST from the vendor's state, round-off, amount in words, project note. Four-step approval: Prepared (Purchase Executive) → Technical (Technical Manager) → Commercial (Account Manager) → GM. Prints in the WIESPL/PUR./02/R0 format. **PO Tracker** shows ordered / approved / received / pending per line. |
| **Vendors** | GSTIN (state and PAN filled automatically), address, city, emails, phones, other contacts, payment terms, "complete later" flag, purchase history. |
| **Store** | Item Master (category, internal code 1001…, UOM, current price, GST, HSN, minimum level, preferred vendor). **Stock Entry** slips with many items: Inward (GRN, price per piece required), Outward (issue to project / site), Transfer (to Production / job-work vendor), Return (against issue no), Scrap, Opening Stock, Adjustment. Closing = Opening + Inward − Outward − Transfer + Return − Scrap. **Stock Summary** with values, ABC and FSN classes, Excel export, and **1 April opening stock** carry-forward. Receiving against a PO updates the PO. |
| **Import / Backup** | Admin → Import from Excel: templates for items, opening stock, movements, vendors, projects, POs and requisitions, plus automatic recognition of the Smart Store workbook, the vendor address list and WIESPL-format POs. Preview with errors and duplicates first; already-imported rows are skipped, so a newer workbook only adds new rows. Full database backup download and restore. |
| **Service / Complaints** | Breakdown, PM, warranty and AMC tickets. |
| **Dashboard** | FY KPIs, enquiries per month, win rate, pipeline, receivables, follow-ups due, pending approvals, low stock, projects by stage. |
| **Admin** | Users & roles, company / quotation defaults (USP, terms, client scope, letter text), activity log of every change. |

### Roles

`admin` everything · `manager` (General Manager) everything + final PO approval + delete · `sales` CRM & quotations · `accounts` (Account Manager) commercial PO approval, orders, invoices, payments · `store` item master & stock · `engineer` projects, submittals, service, material issue · `purchase` (Purchase Executive) vendors, requisitions, POs · `purchase_head` approves requisitions · `technical` (Technical Manager) technical PO approval.

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

## Office mini PC as the server (crm.wiespl.com)

1. Install **Node.js 24 LTS** (nodejs.org) and **Git** on the mini PC, then `git clone https://github.com/Souravcv/ERP-WIESPL.git C:\WIESPL\crm`.
2. Right-click **install-server.bat → Run as administrator**. The CRM now starts by itself at boot (no login needed),
   restarts if it stops, keeps the PC awake, and backs up the database every night at 1:30 am to `data\backups\daily` (30 days kept).
   Log: `data\server.log`. Do not also run start-crm.bat on that PC.
3. Put it on the internet with a free **Cloudflare Tunnel**: add wiespl.com to Cloudflare (check every DNS record — website and email — was copied),
   switch the nameservers at BigRock to Cloudflare's, then Zero Trust → Networks → Tunnels → create a tunnel, run the Windows install command
   it shows on the mini PC, and add the public hostname `crm.wiespl.com` → `http://localhost:3000`.
4. Update later: `git pull`, then restart the PC (or Task Scheduler → WIESPL CRM → End, Run).
5. Now and then copy the whole `data` folder (database + uploaded drawings and photos) to a USB drive or cloud storage.
