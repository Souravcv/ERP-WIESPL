# WIESPL CRM + ERP — notes for Claude

Read this first. It carries the context from the development sessions on the other PC (Claude's chat history and
memory do not move between computers).

## What this is
- CRM + ERP for WIESPL (Western India Electromedical Systems Pvt. Ltd., Pune) — modular OTs, ICUs, NICUs.
- Node 24 (needs `node:sqlite`, Node ≥ 22.13), Express 5, exceljs, vanilla-JS single-page app. No build step.
- Run for development: `start-crm.bat` (port 3000). Data lives in `data/` (`wiespl.db`, `uploads/`, `backups/`), or in `WIESPL_DATA_DIR`.
- GitHub: `origin` = `https://github.com/Souravcv/ERP-WIESPL` (the owner's repo — push here). Commits end with a `Co-Authored-By` line.

## Where things are
- `server/` — `index.js` (routes), `crud.js` (generic tables from `public/js/schema.js`; columns are added automatically from the schema),
  `public.js` (no-login routes for the client forms), `photos.js` (part photos), `stock.js`, `workflows.js`, `notify.js`, `seed.js` (product master text).
- `public/js/views/` — CRM screens (`form.js` actions per module, `print.js` printable documents incl. the techno-commercial sheet, `admin.js` settings).
- Client enquiry form: `public/enquire.html` + `js/enquire.js` (wizard), 3D OT in `js/ot3d.js` (three.js r128 from jsDelivr),
  tap-a-part side panel `js/partpanel.js` + `js/parts.js`, explainer videos on the 3D `js/explainers.js` (English + Hindi), NABH norms `js/nabh.js`.
- Detailed requirement form (second form, per enquiry link): `public/brief.html` + `js/brief.js` + `js/brief-fields.js` (fields shared with the server).
- CAD drawing in 3D: any DWG / DXF attachment has a 🧊 3D button → `#/plan3d/<file id>` (`js/views/plan3d.js`). The DWG is read in the browser by
  `js/plan-worker.js` with `@mlightcad/libredwg-web` (GPL-3.0, WebAssembly, served from `/vendor/libredwg`), turned into lines per layer by
  `js/plan-extract.js`, and the result is cached at `data/uploads/plans/<id>.json` (`/api/files/:id/plan`). Layer roles (wall / glass / door …)
  are guessed from the layer name and can be changed in the viewer (remembered in the browser).
- Company stamp and signatures: `server/signatures.js`, `js/signs.js`; printed only where an approval exists (`js/views/print.js`).

## Decisions already made (do not undo without asking)
- MD's direction (13 Oct 2026): the enquiry is a **techno-commercial document** — site structure (slab height, beams, periphery beams, North,
  what is above the OT), drawings, wall materials PPGL / SS / glass / **SS + glass**, specialty infection protocols (High: transplant, cardiac,
  neuro, ortho, multi-specialty; Special: plastic; Lower: gynae), internal client profile questionnaire and MIS fields (never on client links),
  📄 Techno-commercial sheet print.
- Wall finishes for the OT: SS 304, PPGL (internal key `ppgi`), toughened glass, SS 304 + glass. Wood (HPL) only for the passage.
- MGPS piping is the hospital's scope; incubators and nurse station are not offered as features.
- Inward (GRN) only against an approved PO. PO approval: Purchase Head → GM → Commercial.
- NABH figures come from the NABH 2018 OT air-conditioning guideline; design figures follow the WIESPL basis of design (Type A 50 ACPH, Type B ≈ 42).

## Hosting
- Production target: the **office mini PC** at `crm.wiespl.com` through a free **Cloudflare Tunnel** (see README → "Office mini PC as the server").
  `install-server.bat` (run as administrator) makes it start at boot, restart on failure, and back up nightly (`tools/daily-backup.mjs`).
- The domain wiespl.com and the company website hosting are at BigRock. Moving DNS to Cloudflare affects the website and email:
  check every DNS record is copied before changing nameservers, and let the owner do account sign-ups, passwords and the nameserver change.
- Render (`render.yaml`, service ERP-WIESPL) is only a demo: the free plan loses data on restart.

## Working rules
- Test on a copy of the data (`WIESPL_DATA_DIR=<temp copy> PORT=3002 node server/index.js`), never on the live `data/wiespl.db`.
- Never type passwords or tokens for the owner; never delete data without a backup and consent.
- On Windows, write patch scripts with a file editor rather than bash heredocs (backslashes get mangled); keep `.bat` files CRLF.
