// CAD drawings are read on the server as soon as they are uploaded, so the 3D opens at once for whoever looks first.
// One at a time in a worker thread (planworker.js); drawings uploaded earlier are read when the server starts.
// If this fails the browser can still read the drawing itself (public/js/plan-worker.js).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { db, DATA_DIR } from './db.js';
import * as roles from './roles.js';

export const planFile = id => path.join(DATA_DIR, 'uploads', 'plans', `${Number(id)}.json`);
export const isCad = name => /\.(dwg|dxf)$/i.test(String(name || ''));
const LIMIT = 5 * 60 * 1000;

const jobs = new Map(); // attachment id → promise of the job
let chain = Promise.resolve();

// ODA File Converter (free, Open Design Alliance) reads every DWG version correctly. When it is installed on this PC
// a DWG is first turned into a 2018 DXF with it, and our own DXF reader takes it from there. Without it, the DWG goes
// to libredwg-web, which garbles some drawings (the viewer then says so).
export function odaPath() {
  if (process.env.WIESPL_ODA && fs.existsSync(process.env.WIESPL_ODA)) return process.env.WIESPL_ODA;
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const dir = path.join(root, 'ODA');
    let subs = [];
    try { subs = fs.readdirSync(dir).filter(d => /^ODAFileConverter/i.test(d)).sort().reverse(); } catch { continue; }
    for (const s of subs) { const exe = path.join(dir, s, 'ODAFileConverter.exe'); if (fs.existsSync(exe)) return exe; }
  }
  return null;
}
function toDxf(a) {
  const exe = odaPath();
  if (!exe || !/\.dwg$/i.test(a.full)) return Promise.resolve(null);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wiespl-dwg-')), inDir = path.join(work, 'in'), outDir = path.join(work, 'out');
  fs.mkdirSync(inDir); fs.mkdirSync(outDir);
  fs.copyFileSync(a.full, path.join(inDir, 'drawing.dwg'));
  return new Promise(done => {
    // in folder, out folder, version, type, recurse, audit (repairs what it can), filter
    execFile(exe, [inDir, outDir, 'ACAD2018', 'DXF', '0', '1', '*.DWG'], { timeout: 3 * 60 * 1000, windowsHide: true }, err => {
      const dxf = path.join(outDir, 'drawing.dxf');
      if (err || !fs.existsSync(dxf)) { console.warn(`  3D drawing ${a.id}: ODA File Converter could not convert it${err ? ` (${err.message})` : ''}`); fs.rmSync(work, { recursive: true, force: true }); return done(null); }
      done({ file: dxf, cleanup: () => fs.rmSync(work, { recursive: true, force: true }) });
    });
  });
}

async function read(a) {
  const conv = await toDxf(a);
  const ok = await readFile(a, conv ? conv.file : a.full, conv ? 'oda' : null);
  conv?.cleanup();
  return ok;
}

function readFile(a, file, via) {
  return new Promise(done => {
    const out = planFile(a.id), tmp = `${out}.${process.pid}.tmp`;
    const w = new Worker(new URL('./planworker.js', import.meta.url), { workerData: { file, out: tmp, via } });
    const end = ok => { clearTimeout(timer); w.terminate(); fs.rmSync(tmp, { force: true }); done(ok); };
    const timer = setTimeout(() => { console.warn(`  3D drawing ${a.id}: took too long, left for the browser`); end(false); }, LIMIT);
    w.on('message', m => {
      if (m.ok) { fs.renameSync(tmp, out); end(true); return; }
      console.warn(`  3D drawing ${a.id} (${a.filename}): ${m.error}`); end(false);
    });
    w.on('error', e => { console.warn(`  3D drawing ${a.id}: ${e.message}`); end(false); });
  });
}

export function preparePlan(a) {
  if (fs.existsSync(planFile(a.id))) return Promise.resolve(true);
  if (jobs.has(a.id)) return jobs.get(a.id);
  const job = chain.then(() => read(a)).catch(() => false).finally(() => jobs.delete(a.id));
  jobs.set(a.id, job); chain = job;
  return job;
}

export function prepareMissingPlans() {
  for (const { id } of db.prepare("SELECT id FROM attachments WHERE lower(filename) LIKE '%.dwg' OR lower(filename) LIKE '%.dxf'").all()) {
    if (fs.existsSync(planFile(id))) continue;
    try { preparePlan(roles.attachmentFile(id)); } catch { /* the file is gone */ }
  }
}
