// Daily copy of the CRM database (run at 1:30 am by the "WIESPL CRM backup" task from install-server.bat).
// Uses VACUUM INTO, so the copy is consistent even while people are working. Keeps the newest 30 copies.
// Also copy the whole data folder (database + uploaded drawings / photos) to a USB drive or cloud now and then.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const DATA = process.env.WIESPL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const dir = path.join(DATA, 'backups', 'daily');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `wiespl-${new Date().toLocaleString('sv-SE').slice(0, 10)}.db`);
fs.rmSync(out, { force: true });
const db = new DatabaseSync(path.join(DATA, 'wiespl.db'));
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
const old = fs.readdirSync(dir).filter(f => /^wiespl-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -30);
for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
console.log(`Backup written: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB), removed ${old.length} old`);
