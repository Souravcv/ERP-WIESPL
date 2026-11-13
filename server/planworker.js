// Reads one DWG / DXF into the 3D plan, away from the main server thread (a 13 MB DWG takes about 15 seconds).
// Started by server/plans.js. Same result as the browser's public/js/plan-worker.js.
// DXF (plain text) is read by our own reader (plan-dxf.js); DWG by libredwg-web, unless plans.js has already turned
// it into a DXF with ODA File Converter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { extractPlan, guardReader } from '../public/js/plan-extract.js';
import { readDxf } from '../public/js/plan-dxf.js';

const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@mlightcad', 'libredwg-web');

try {
  let db;
  if (/\.dxf$/i.test(workerData.file)) db = readDxf(fs.readFileSync(workerData.file, 'utf8'));
  else {
    const { LibreDwg, Dwg_File_Type } = await import(pathToFileURL(path.join(pkg, 'dist', 'libredwg-web.js')).href);
    const lib = guardReader(await LibreDwg.create(path.join(pkg, 'wasm')));
    const dwg = lib.dwg_read_data(new Uint8Array(fs.readFileSync(workerData.file)), Dwg_File_Type.DWG);
    if (!dwg) throw new Error('This drawing could not be read');
    db = lib.convert(dwg);
    lib.dwg_free(dwg);
  }
  const plan = extractPlan(db);
  if (workerData.via) plan.via = workerData.via;
  if (!plan.segments) throw new Error('No drawing lines were found');
  fs.mkdirSync(path.dirname(workerData.out), { recursive: true });
  fs.writeFileSync(workerData.out, JSON.stringify(plan));
  parentPort.postMessage({ ok: true, segments: plan.segments });
} catch (e) {
  parentPort.postMessage({ error: e?.message || String(e) });
}
