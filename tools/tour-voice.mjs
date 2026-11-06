// Makes the voice clips of the CAD drawing's explainer tour: public/audio/tour/<key>.mp3, one per line in
// public/js/views/plan3d-tour-lines.js. Run it again after changing a line.
//
// It needs the Kokoro voice (Apache-2.0, runs on this PC, no internet once downloaded) and an MP3 encoder, which are
// not part of the CRM. Install them once in any folder and point TOUR_TOOLS at it:
//   mkdir C:\tour-tools && cd C:\tour-tools && npm init -y && npm i kokoro-js@1.2.1 @breezystack/lamejs@1.2.7
//   set TOUR_TOOLS=C:\tour-tools && node tools/tour-voice.mjs            (only some: node tools/tour-voice.mjs ot_laf ot_floor)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'audio', 'tour');
const TOOLS = process.env.TOUR_TOOLS;
if (!TOOLS) { console.error('Set TOUR_TOOLS to the folder where kokoro-js and @breezystack/lamejs are installed (see the top of this file).'); process.exit(1); }
const req = createRequire(path.join(TOOLS, 'x.js'));
const load = async name => import(pathToFileURL(req.resolve(name)).href);
const { TOUR_LINES } = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'views', 'plan3d-tour-lines.js')).href);
const { KokoroTTS } = await load('kokoro-js');
const { Mp3Encoder } = await import(pathToFileURL(path.join(path.dirname(req.resolve('@breezystack/lamejs')), 'lamejs.js')).href); // its ES module build

const VOICE = 'af_heart', SPEED = 0.97, KBPS = 48, LOUD = 0.11; // LOUD: the same loudness for every line (RMS of speech)
const only = process.argv.slice(2);
const keys = Object.keys(TOUR_LINES).filter(k => !only.length || only.includes(k));
fs.mkdirSync(OUT, { recursive: true });
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });

for (const key of keys) {
  const a = await tts.generate(TOUR_LINES[key].say, { voice: VOICE, speed: SPEED });
  let x = a.audio; const rate = a.sampling_rate;
  // trim the silence at both ends, keep 80 ms
  const on = v => Math.abs(v) > 0.01;
  let s = 0, e = x.length - 1; while (s < e && !on(x[s])) s++; while (e > s && !on(x[e])) e--;
  x = x.slice(Math.max(0, s - rate * 0.08), Math.min(x.length, e + rate * 0.08));
  // even loudness, never above 0.95
  let sum = 0, n = 0, peak = 1e-6; for (const v of x) { const m = Math.abs(v); if (m > peak) peak = m; if (m > 0.02) { sum += v * v; n++; } }
  const gain = Math.min(LOUD / Math.sqrt(sum / Math.max(1, n)), 0.95 / peak);
  const pcm = new Int16Array(x.length); for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-1, Math.min(1, x[i] * gain)) * 32767;
  const enc = new Mp3Encoder(1, rate, KBPS), parts = [];
  for (let i = 0; i < pcm.length; i += 1152) { const b = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush(); if (end.length) parts.push(Buffer.from(end));
  const file = path.join(OUT, `${key}.mp3`), buf = Buffer.concat(parts);
  fs.writeFileSync(file, buf);
  console.log(`${key}: ${(x.length / rate).toFixed(1)} s, ${Math.round(buf.length / 1024)} KB`);
}
