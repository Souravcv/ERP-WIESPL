// Reads a DWG / DXF in the background (so the page stays responsive) and returns the plan geometry.
// The reader is libredwg-web (GPL-3.0, WebAssembly), served from /vendor/libredwg and kept in this worker.
import { LibreDwg, Dwg_File_Type } from '/vendor/libredwg/dist/libredwg-web.js';
import { extractPlan } from './plan-extract.js';

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ step: 'Loading the drawing reader…' });
    const lib = await LibreDwg.create('/vendor/libredwg/wasm');
    self.postMessage({ step: 'Reading the drawing (a 12 MB DWG takes about 15 seconds)…' });
    const dwg = lib.dwg_read_data(new Uint8Array(data.buf), data.dxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
    if (!dwg) throw new Error('This drawing could not be read. Save it again from AutoCAD (Save As → AutoCAD 2018 DWG or DXF) and upload that.');
    const db = lib.convert(dwg);
    lib.dwg_free(dwg);
    self.postMessage({ step: 'Building the 3D…' });
    const plan = extractPlan(db);
    if (!plan.segments) throw new Error('No drawing lines were found in the model space of this file.');
    self.postMessage({ plan });
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
