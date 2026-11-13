// Reads a DWG / DXF in the background (so the page stays responsive) and returns the plan geometry.
// The reader is libredwg-web (GPL-3.0, WebAssembly), served from /vendor/libredwg and kept in this worker.
import { LibreDwg, Dwg_File_Type } from '/vendor/libredwg/dist/libredwg-web.js';
import { extractPlan, guardReader } from './plan-extract.js';
import { readDxf } from './plan-dxf.js';

self.onmessage = async ({ data }) => {
  try {
    let db;
    if (data.dxf) { // plain text: our own reader
      self.postMessage({ step: 'Reading the DXF…' });
      db = readDxf(new TextDecoder('utf-8').decode(data.buf));
    } else {
      self.postMessage({ step: 'Loading the drawing reader…' });
      const lib = guardReader(await LibreDwg.create('/vendor/libredwg/wasm'));
      self.postMessage({ step: 'Reading the drawing (a 12 MB DWG takes about 15 seconds)…' });
      const dwg = lib.dwg_read_data(new Uint8Array(data.buf), Dwg_File_Type.DWG);
      if (!dwg) throw new Error('This drawing could not be read. Save it again from AutoCAD (Save As → AutoCAD 2018 DXF) and upload that.');
      db = lib.convert(dwg);
      lib.dwg_free(dwg);
    }
    self.postMessage({ step: 'Building the 3D…' });
    const plan = extractPlan(db);
    if (!plan.segments) throw new Error('No drawing lines were found in the model space of this file.');
    self.postMessage({ plan });
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
