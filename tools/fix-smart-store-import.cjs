// Removes the items the Smart Store import created that are not in the workbook's Item Master,
// their stock movements, and the test entries made on codes 1001 / 1002 before the import.
// Usage: node fix_items.cjs <path to wiespl.db> [--apply]
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const [file, apply] = [process.argv[2], process.argv.includes('--apply')];
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout = 8000');

const wrong = db.prepare(`SELECT id, code, name FROM items WHERE
     (code GLOB '[0-9]*' AND code NOT GLOB '*[^0-9]*' AND (CAST(code AS INT) < 1001 OR CAST(code AS INT) BETWEEN 1789 AND 1794 OR CAST(code AS INT) BETWEEN 1796 AND 1800 OR CAST(code AS INT) > 1800))
  OR code GLOB 'R-*' OR code = 'FG Code'`).all();
const ids = wrong.map(r => r.id);
const inList = `(${ids.join(',') || 0})`;
const used = db.prepare(`SELECT
  (SELECT COUNT(*) FROM purchase_orders p, json_each(p.lines) j WHERE CAST(json_extract(j.value,'$.item_id') AS INT) IN ${inList})
 + (SELECT COUNT(*) FROM requisitions p, json_each(p.lines) j WHERE CAST(json_extract(j.value,'$.item_id') AS INT) IN ${inList})
 + (SELECT COUNT(*) FROM challans p, json_each(p.lines) j WHERE CAST(json_extract(j.value,'$.item_id') AS INT) IN ${inList})
 + (SELECT COUNT(*) FROM bom_items WHERE item_id IN ${inList}) + (SELECT COUNT(*) FROM boq_items WHERE item_id IN ${inList}) n`).get().n;
const moves = db.prepare(`SELECT COUNT(*) n FROM stock_moves WHERE item_id IN ${inList}`).get().n;
// Test entries made by hand before the workbook was imported (they sit on what is now 1001 Diffuser / 1002 Damper).
const tests = db.prepare(`SELECT id, type, doc_no, qty FROM stock_moves WHERE import_batch IS NULL AND id <= 7 AND created_at < '2026-10-12 12:00'`).all();
console.log(`items to remove: ${ids.length} (${wrong.slice(0, 4).map(r => r.code).join(', ')} … ${wrong.slice(-3).map(r => r.code).join(', ')})`);
console.log(`their stock movements: ${moves}; used on POs / requisitions / challans / BOQs: ${used}`);
console.log(`pre-import test movements: ${tests.length} ${JSON.stringify(tests)}`);
if (used) { console.log('STOP: some of these items are in use'); process.exit(1); }
if (!apply) { console.log('(dry run)'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = path.join(path.dirname(file), 'backups', `before-item-cleanup-${stamp}.db`);
fs.mkdirSync(path.dirname(backup), { recursive: true });
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('backup:', backup);
db.exec('BEGIN IMMEDIATE');
try {
  const m = db.prepare(`DELETE FROM stock_moves WHERE item_id IN ${inList}`).run().changes;
  const t = tests.length ? db.prepare(`DELETE FROM stock_moves WHERE id IN (${tests.map(x => x.id).join(',')})`).run().changes : 0;
  const i = db.prepare(`DELETE FROM items WHERE id IN ${inList}`).run().changes;
  db.prepare("INSERT INTO audit (user, entity, record_id, action, summary) VALUES ('system', 'items', NULL, 'import clean-up', ?)")
    .run(`Removed ${i} items not in the Smart Store Item Master (blank codes 1789-1794, 1796-1800, codes 1801-2517, 1-16, R-01..R-30, FG header row) with ${m} movements, and ${t} test movements on 1001/1002. Backup: ${path.basename(backup)}`);
  db.exec('COMMIT');
  console.log(`removed ${i} items, ${m} movements, ${t} test movements`);
} catch (e) { db.exec('ROLLBACK'); throw e; }
