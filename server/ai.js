// WIESPL Assistant: an AI model that runs on a WIESPL machine, never in the cloud: either the CRM's own built-in engine
// (llama.cpp's llama-server, started by the CRM itself when data/ai-engine holds it and its models) or an Ollama server.
// It answers in the CRM from the CRM's own records (only the modules the user's role may see, through the same
// listRows / getRow the screens use) and from WIESPL's documents (product knowledge built into the CRM, and the
// files an admin puts in the AI library: data/ai-docs). Nothing is sent outside the company network.
//
// The built-in engine: data/ai-engine/bin/llama-server.exe and data/ai-engine/models/*.gguf (a chat model such as
// qwen2.5-3b-instruct-q4_k_m.gguf and nomic-embed-text-*.gguf for document search). The CRM runs one server for each, on
// 127.0.0.1:8080 (chat) and 8081 (search), and stops them when it stops.
// Settings (Settings → AI Assistant, admin): ai_url (an Ollama server instead, e.g. http://127.0.0.1:11434), ai_model
// (default qwen2.5:3b: small, runs on a PC's CPU, can use tools), ai_embed_model (default nomic-embed-text, for
// document search), ai_whisper_url (optional: a local whisper.cpp server for speech to text).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { db, getSettings, setSettings, DATA_DIR, audit } from './db.js';
import { ENTITIES, canView, WORKER_ROLES, STOCK_SQL } from '../public/js/schema.js';
import { listRows, getRow, HttpError, options } from './crud.js';
import { PART_UI, DOOR_TYPES, FLOOR_TYPES } from '../public/js/parts.js';
import { VIDEOS } from '../public/js/explainers.js';
import { NABH_SOURCE, otNorms } from '../public/js/nabh.js';

export const DOCS_DIR = path.join(DATA_DIR, 'ai-docs');
const DOC_TYPES = /\.(txt|md|csv|json|html?|pdf)$/i;

// ---------------------------------------------------------------- the built-in engine
export const ENGINE_DIR = process.env.WIESPL_AI_ENGINE_DIR || path.join(DATA_DIR, 'ai-engine');
const ENGINE = { chat: { port: Number(process.env.WIESPL_AI_CHAT_PORT) || 8080, proc: null, model: null, log: '' }, embed: { port: Number(process.env.WIESPL_AI_EMBED_PORT) || 8081, proc: null, model: null, log: '' } };
function engineFiles() {
  const exe = path.join(ENGINE_DIR, 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'), dir = path.join(ENGINE_DIR, 'models');
  let models = []; try { models = fs.readdirSync(dir).filter(m => /\.gguf$/i.test(m)).map(m => ({ name: m, size: fs.statSync(path.join(dir, m)).size })); } catch { /* none */ }
  const chats = models.filter(m => !/embed/i.test(m.name) && m.size > 300e6).sort((a, b) => b.size - a.size); // the largest chat model there is
  return { exe: fs.existsSync(exe) ? exe : null, chat: chats[0] && path.join(dir, chats[0].name), embed: (m => m && path.join(dir, m.name))(models.find(m => /embed/i.test(m.name))) };
}
const builtIn = () => { const s = getSettings(); return !s.ai_url && !process.env.AI_URL; };
// started when the CRM starts (and again if one stops); does nothing without the engine's files or with ai_url set
export function startEngine() {
  if (!builtIn() || process.env.WIESPL_AI_SHARED) return; // WIESPL_AI_SHARED=1: another CRM on this PC already runs the engine
  const F = engineFiles(); if (!F.exe) return;
  // Measured on the office laptop (i5-12500H): writing is quickest on ¾ of the CPU threads, reading a question on all
  // of them, with flash attention: ~35% faster than 8 threads.
  const cpus = os.cpus().length, write = String(Math.max(2, Math.round(cpus * 0.75))), read = String(Math.max(2, cpus));
  const run = (kind, model, args) => {
    const e = ENGINE[kind]; if (!model || e.proc) return;
    e.model = path.basename(model); e.log = '';
    const p = spawn(F.exe, ['-m', model, '--host', '127.0.0.1', '--port', String(e.port), ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = d => { e.log = (e.log + d).slice(-4000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    p.on('exit', code => { e.proc = null; if (!stopping) { keep(`\n[stopped: ${code}]`); setTimeout(() => run(kind, model, args), 15000); } });
    e.proc = p;
  };
  run('chat', F.chat, ['-t', write, '-tb', read, '-fa', 'on', '-c', '8192', '--jinja', '--no-webui']);
  run('embed', F.embed, ['-t', '4', '--embeddings', '-c', '2048', '-b', '2048', '-ub', '2048']);
  if (F.chat) warmUp();
  if (F.embed) autoIndex(path.basename(F.embed));
}
// Once the engine is up, have it read the instructions and the tool descriptions, so even the first question is quick.
async function warmUp() {
  for (let i = 0; i < 100 && !stopping; i++) {
    try {
      const h = await fetch(`http://127.0.0.1:${ENGINE.chat.port}/health`, { signal: AbortSignal.timeout(2000) });
      if (h.ok) {
        await fetch(`http://127.0.0.1:${ENGINE.chat.port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(300000),
          body: JSON.stringify({ messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: 'Hello' }], tools: TOOLS.map(t => ({ type: 'function', function: t })), max_tokens: 1 }) });
        console.log(`  AI: ready (${ENGINE.chat.model})`);
        return;
      }
    } catch { /* still loading */ }
    await new Promise(r => setTimeout(r, 3000));
  }
}
// Build the document index by itself the first time (or after the search model changes), once the engine is up.
function autoIndex(model) {
  let tries = 0;
  const check = async () => {
    if (stopping || ++tries > 100) return;
    try {
      const h = await fetch(`http://127.0.0.1:${ENGINE.embed.port}/health`, { signal: AbortSignal.timeout(2000) });
      if (!h.ok) throw new Error('loading');
      const r = db.prepare('SELECT COUNT(*) AS n, SUM(model = ?) AS same FROM ai_chunks').get(model);
      if (!r.n || r.same !== r.n) { console.log('  AI: building the document index…'); reindex(null); }
    } catch { setTimeout(check, 3000); }
  };
  setTimeout(check, 3000);
}
let stopping = false;
export function stopEngine() { stopping = true; for (const e of Object.values(ENGINE)) try { e.proc?.kill(); } catch { /* gone */ } }
process.on('exit', stopEngine);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopEngine(); process.exit(0); });

export function aiConfig() {
  const s = getSettings(), own = builtIn();
  return {
    builtIn: own,
    url: own ? `http://127.0.0.1:${ENGINE.chat.port}` : String(s.ai_url || process.env.AI_URL).replace(/\/+$/, ''),
    embedUrl: own ? `http://127.0.0.1:${ENGINE.embed.port}` : String(s.ai_url || process.env.AI_URL).replace(/\/+$/, ''),
    model: own ? ENGINE.chat.model || engineFiles().chat?.split(/[\\/]/).pop() || 'local' : s.ai_model || process.env.AI_MODEL || 'qwen2.5:3b',
    embed: own ? ENGINE.embed.model || 'local' : s.ai_embed_model || process.env.AI_EMBED_MODEL || 'nomic-embed-text',
    whisper: String(s.ai_whisper_url || process.env.AI_WHISPER_URL || '').replace(/\/+$/, ''),
  };
}
export function saveAiConfig(body, user) {
  const pick = ['ai_url', 'ai_model', 'ai_embed_model', 'ai_whisper_url'];
  const patch = Object.fromEntries(pick.filter(k => body?.[k] !== undefined).map(k => [k, String(body[k]).trim()]));
  for (const k of ['ai_url', 'ai_whisper_url']) if (patch[k] && !/^https?:\/\/[^\s]+$/i.test(patch[k])) throw new HttpError(400, 'The address must start with http:// or https://');
  setSettings(patch);
  audit(user.name, 'settings', null, 'update', 'AI assistant settings');
  if (builtIn()) { stopping = false; startEngine(); }
  return aiConfig();
}

export function migrateAi() {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_chunks (id INTEGER PRIMARY KEY, source TEXT NOT NULL, title TEXT, chunk TEXT NOT NULL, vec BLOB,
    model TEXT, updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS ix_ai_chunks_source ON ai_chunks(source);
    CREATE TABLE IF NOT EXISTS ai_conversations (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
      messages TEXT NOT NULL DEFAULT '[]', created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS ix_ai_conversations_user ON ai_conversations(user_id, updated_at);`);
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// ---------------------------------------------------------------- talking to the model server: llama-server speaks the
// OpenAI-style API (/v1/...), Ollama its own (/api/...)
const isOllama = () => !aiConfig().builtIn;
async function post(base, pathname, body, signal) {
  let res;
  try { res = await fetch(base + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }); }
  catch { throw new HttpError(503, aiConfig().builtIn ? 'The AI engine is starting or not running. Try again in a minute.' : `The AI server is not reachable at ${base}. Is Ollama running?`); }
  if (res.status === 503) throw new HttpError(503, 'The AI engine is still loading its model. Try again in a minute.');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (/not found|pull/i.test(t) && body.model) throw new HttpError(503, `The AI model is not installed on the AI server. Run: ollama pull ${body.model}`);
    throw new HttpError(502, `AI server error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res;
}
export async function status() {
  const c = aiConfig(); let models = [], ok = false, error = '', embedOk = false;
  const get = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  if (c.builtIn) {
    const F = engineFiles();
    if (!F.exe || !F.chat) error = 'The built-in AI engine is not installed (data/ai-engine)';
    else {
      try { await get(c.url + '/health'); ok = true; models = [c.model]; } catch { error = ENGINE.chat.proc ? 'The AI engine is loading its model…' : 'The AI engine is not running'; }
      try { await get(c.embedUrl + '/health'); embedOk = true; } catch { /* loading */ }
    }
  } else {
    try { const j = await get(c.url + '/api/tags'); models = (j.models || []).map(m => m.name); ok = true; } catch { error = `Not reachable at ${c.url}`; }
  }
  const has = m => models.some(x => x === m || x === m + ':latest' || x.split(':')[0] === m);
  const docs = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT source) s FROM ai_chunks').get();
  return { ...c, ok, error, models, chatModel: c.builtIn ? ok : has(c.model), embedModel: c.builtIn ? embedOk : has(c.embed), voice: !!c.whisper, chunks: docs.n, sources: docs.s, files: listDocs() };
}
// nomic-embed-text wants to know which side of a search a text is on
async function embed(texts, kind = 'document') {
  const c = aiConfig(), input = texts.map(t => `search_${kind}: ${t}`);
  if (isOllama()) { const j = await (await post(c.embedUrl, '/api/embed', { model: c.embed, input })).json(); return (j.embeddings || []).map(v => Float32Array.from(v)); }
  const j = await (await post(c.embedUrl, '/v1/embeddings', { input })).json();
  return (j.data || []).sort((a, b) => a.index - b.index).map(d => Float32Array.from(d.embedding));
}

// ---------------------------------------------------------------- the document library (search by meaning)
export function listDocs() {
  try { return fs.readdirSync(DOCS_DIR).filter(f => DOC_TYPES.test(f)).map(f => ({ name: f, size: fs.statSync(path.join(DOCS_DIR, f)).size })); } catch { return []; }
}
export function saveDoc(name, buf, user) {
  const safe = path.basename(String(name || '')).replace(/[^\w .()&-]+/g, '_').slice(0, 120);
  if (!DOC_TYPES.test(safe)) throw new HttpError(400, 'Use a PDF, text, Markdown, CSV, JSON or HTML file');
  if (!buf?.length) throw new HttpError(400, 'The file is empty');
  fs.writeFileSync(path.join(DOCS_DIR, safe), buf);
  audit(user.name, 'ai_docs', null, 'upload', safe);
  return { name: safe };
}
export function deleteDoc(name, user) {
  const f = path.join(DOCS_DIR, path.basename(String(name)));
  if (!f.startsWith(DOCS_DIR) || !fs.existsSync(f)) throw new HttpError(404, 'No such document');
  fs.unlinkSync(f); db.prepare('DELETE FROM ai_chunks WHERE source = ?').run('file:' + path.basename(f));
  audit(user.name, 'ai_docs', null, 'delete', path.basename(f));
  return { ok: true };
}
async function pdfText(buf) {
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch { throw new Error('PDF reading needs the pdfjs-dist package (npm install)'); }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) { const c = await (await doc.getPage(p)).getTextContent(); pages.push(c.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('')); }
  return pages.join('\n\n');
}
const strip = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function chunks(text, size = 900, overlap = 150) {
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), out = [];
  for (let i = 0; i < t.length; i += size - overlap) { const c = t.slice(i, i + size).trim(); if (c.length > 40) out.push(c); if (i + size >= t.length) break; }
  return out;
}
// WIESPL's product knowledge that is already in the CRM (what the client sees in the 3D OT, the explainer videos, NABH)
function builtInDocs() {
  const docs = [];
  for (const [k, p] of Object.entries(PART_UI)) docs.push({ source: 'wiespl:part:' + k, title: `WIESPL ${p.title}`, text: [p.title, p.text, ...(p.facts || []).map(f => (Array.isArray(f) ? f.join(': ') : f)), ...(p.choices || []).map(c => (Array.isArray(c) ? c.join(' – ') : c))].filter(Boolean).join('\n') });
  docs.push({ source: 'wiespl:doors', title: 'WIESPL OT door types', text: DOOR_TYPES.map(d => `${d[1]}: ${d[2]}`).join('\n') });
  docs.push({ source: 'wiespl:floors', title: 'WIESPL OT floor types', text: FLOOR_TYPES.map(d => `${d[1]}: ${d[2]}`).join('\n') });
  for (const [k, v] of Object.entries(VIDEOS)) docs.push({ source: 'wiespl:video:' + k, title: `WIESPL explainer: ${v.title || k}`, text: (v.scenes || []).map(s => s.en).filter(Boolean).join('\n') });
  try {
    const a = otNorms(['General Surgery']), b = otNorms(['Orthopaedics']);
    docs.push({ source: 'wiespl:nabh', title: 'NABH / WHO norms for OT air conditioning', text: `${NABH_SOURCE}\nGeneral OT (Type B): ${JSON.stringify(a)}\nOrthopaedics / super-speciality OT (Type A): ${JSON.stringify(b)}` });
  } catch { /* the norms helper changed: leave them out */ }
  return docs;
}
let indexing = null;
export function reindex(user) {
  if (indexing) return { started: false, running: true };
  indexing = (async () => {
    const { embed: model } = aiConfig(), all = [];
    for (const d of builtInDocs()) for (const c of chunks(d.text)) all.push({ source: d.source, title: d.title, chunk: c });
    for (const f of listDocs()) {
      const buf = fs.readFileSync(path.join(DOCS_DIR, f.name));
      let text = '';
      try { text = /\.pdf$/i.test(f.name) ? await pdfText(buf) : /\.html?$/i.test(f.name) ? strip(buf.toString('utf8')) : buf.toString('utf8'); }
      catch (e) { all.push({ source: 'file:' + f.name, title: f.name, chunk: `(${f.name} could not be read: ${e.message})`, skip: true }); continue; }
      for (const c of chunks(text)) all.push({ source: 'file:' + f.name, title: f.name.replace(/\.[^.]+$/, ''), chunk: c });
    }
    const rows = [];
    for (let i = 0; i < all.length; i += 16) {
      const batch = all.slice(i, i + 16), vecs = await embed(batch.map(b => `${b.title}\n${b.chunk}`));
      batch.forEach((b, k) => rows.push({ ...b, vec: Buffer.from(vecs[k].buffer) }));
    }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM ai_chunks').run();
      const ins = db.prepare('INSERT INTO ai_chunks (source, title, chunk, vec, model) VALUES (?, ?, ?, ?, ?)');
      for (const r of rows) ins.run(r.source, r.title, r.chunk, r.vec, model);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    if (user) audit(user.name, 'ai_docs', null, 'reindex', `${rows.length} passages`);
    return rows.length;
  })().finally(() => { indexing = null; });
  indexing.catch(() => {});
  return { started: true };
}
export const indexingNow = () => !!indexing;
async function searchDocs(query, k = 5) {
  const rows = db.prepare('SELECT source, title, chunk, vec FROM ai_chunks WHERE vec IS NOT NULL').all();
  if (!rows.length) return [];
  const [q] = await embed([query], 'query');
  const qn = Math.hypot(...q) || 1;
  const scored = rows.map(r => { const v = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4); let dot = 0, n = 0; for (let i = 0; i < v.length; i++) { dot += v[i] * q[i]; n += v[i] * v[i]; } return { ...r, score: dot / (qn * (Math.sqrt(n) || 1)) }; });
  return scored.sort((a, b) => b.score - a.score).slice(0, k).filter(r => r.score > 0.35);
}

// ---------------------------------------------------------------- what the model may do: read-only tools
const HIDE = /sign|stamp|password|pass_hash|token/i;               // never shown, to anyone
const MONEY = /rate|price|value|cost|amount|salary|margin|total/i; // not for the least-access roles
function cleanRow(module, row, role, full = false) {
  const ent = ENTITIES[module], out = { id: row.id }, worker = WORKER_ROLES.includes(role);
  const keys = full ? ent.fields.filter(f => f.type !== 'section').map(f => f.key) : [...new Set(['date', ...(ent.list || []), ent.statusField].filter(Boolean))];
  for (const key of keys) {
    const f = ent.fields.find(x => x.key === key); if (!f || f.type === 'json' || f.type === 'image' || f.type === 'file' || HIDE.test(key)) continue;
    if (worker && (f.type === 'money' || MONEY.test(key))) continue;
    let v = f.type === 'ref' ? row[key + '_label'] ?? row[key] : row[key];
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v = v.join(', ');
    out[f.label || key] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
  }
  return out;
}
const viewable = role => Object.keys(ENTITIES).filter(m => canView(m, role));
function mustSee(module, role) {
  if (!ENTITIES[module]) throw new Error(`There is no module "${module}". Use one of the module names listed.`);
  if (!canView(module, role)) throw new Error(`Your role cannot see ${ENTITIES[module].label}.`);
  return ENTITIES[module];
}
const TOOLS = [
  { name: 'search_everything', description: 'Search ALL CRM modules at once for a name or word (a person, client, company, hospital, place, product, holiday, enquiry number...). Use this first whenever the user mentions something by name and you do not know which module it is in.',
    parameters: { type: 'object', properties: { text: { type: 'string', description: 'the name or word to look for, e.g. "Sourav" or "Diwali"' } }, required: ['text'] } },
  { name: 'describe_module', description: 'List the fields of one CRM module (their keys, labels, and the choices of select fields). Use before filtering or summarising a module you have not used yet.',
    parameters: { type: 'object', properties: { module: { type: 'string', description: 'module name, e.g. enquiries' } }, required: ['module'] } },
  { name: 'find_records', description: 'Search the records of one CRM module. text searches the main text fields; filters match fields exactly (e.g. {"status": "Open", "state": "Kerala"}); from/to limit by date (YYYY-MM-DD) - leave them out unless the user names a period. Results come newest first, so for the latest records just set limit.',
    parameters: { type: 'object', properties: { module: { type: 'string' }, text: { type: 'string' }, filters: { type: 'object' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'number' } }, required: ['module'] } },
  { name: 'get_record', description: 'Open one record of a module with all its fields.',
    parameters: { type: 'object', properties: { module: { type: 'string' }, id: { type: 'number' } }, required: ['module', 'id'] } },
  { name: 'summarize', description: 'Count records of a module grouped by a field (or by month), optionally summing a number field (leave sum_field out to just count); for analysis such as "enquiries per state this year" or "PO value per vendor".',
    parameters: { type: 'object', properties: { module: { type: 'string' }, group_by: { type: 'string', description: 'a field key, or "month"' }, sum_field: { type: 'string' }, filters: { type: 'object' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['module', 'group_by'] } },
  { name: 'search_documents', description: "Search WIESPL's own documents and product knowledge (OT panels, doors, floors, LAF, AHU, HEPA, pass boxes, NABH norms, manuals, brochures, SOPs) by meaning.",
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];
// Small models write "Enquiries" or "State": match module and field names by key or label, any case.
function normArgs(args) {
  const a = { ...(args && typeof args === 'object' ? args : {}) }, low = v => String(v).trim().toLowerCase();
  if (typeof a.module === 'string') { const m = low(a.module), sp = m.replace(/_/g, ' '); a.module = Object.keys(ENTITIES).find(k => k === m || k === m.replace(/\s+/g, '_') || low(ENTITIES[k].label) === sp || low(ENTITIES[k].singular || '') === sp) || a.module; }
  const ent = ENTITIES[a.module];
  if (ent) {
    const key = k => { if (typeof k !== 'string') return k; const l = low(k); const f = ent.fields.find(f => low(f.key) === l || low(f.label || '') === l || low(f.key) === l.replace(/\s+/g, '_')); return f ? f.key : k; };
    if (typeof a.group_by === 'string') a.group_by = low(a.group_by) === 'month' ? 'month' : key(a.group_by);
    if (a.sum_field) a.sum_field = key(a.sum_field);
    if (a.filters && typeof a.filters === 'object') a.filters = Object.fromEntries(Object.entries(a.filters).map(([k, v]) => {
      k = key(k); const f = ent.fields.find(f => f.key === k);
      if (f?.type === 'ref' && typeof v === 'string' && !/^\d+$/.test(v.trim())) { try { const hit = options(f.ref, v.trim())[0]; if (hit) v = hit.id; } catch { /* leave as is */ } }
      return [k, v];
    }));
  }
  return a;
}
async function runTool(name, args, user, sources) {
  const role = user.role, a = args || {};
  if (name === 'search_everything') {
    const text = String(a.text || a.query || '').trim(); if (!text) throw new Error('Give the text to look for');
    const words = [text, ...text.split(/\s+/).filter(w => w.length > 3)].filter((w, i, all) => all.indexOf(w) === i);
    const groups = []; let found = 0;
    for (const w of words) {
      for (const m of viewable(role)) {
        const ent = ENTITIES[m]; if (!ent.search?.length || found >= 20) continue;
        let rows = []; try { rows = listRows(m, { q: w, limit: 5 }); } catch { continue; }
        rows = rows.filter(r => !groups.some(g => g.m === m && g.rows.some(x => x.id === r.id))).slice(0, 20 - found);
        if (!rows.length) continue;
        found += rows.length; groups.push({ m, rows });
        rows.forEach(r => sources.push({ module: m, id: r.id, label: `${ent.singular || ent.label} #${r.id}` }));
      }
      if (found) break; // the whole phrase matched; no need to try single words
    }
    return found ? `Found ${found} record(s) with "${text}":\n\n` + groups.map(g => `${ENTITIES[g.m].label}:\n${table(g.m, g.rows, role)}`).join('\n\n') : `Nothing in the CRM has "${text}".`;
  }
  if (name === 'describe_module') {
    const ent = mustSee(a.module, role);
    return { module: a.module, label: ent.label, fields: ent.fields.filter(f => f.type !== 'section' && !HIDE.test(f.key) && f.type !== 'json').map(f => ({ key: f.key, label: f.label, type: f.type, ...(f.options ? { choices: f.options.filter(Boolean).slice(0, 25) } : {}), ...(f.ref ? { refers_to: f.ref } : {}) })) };
  }
  if (name === 'find_records') {
    const ent = mustSee(a.module, role), q = { limit: Math.min(Number(a.limit) || 10, 25) };
    if (a.text) q.q = String(a.text);
    for (const [k, v] of Object.entries(a.filters || {})) if (ent.fields.some(f => f.key === k && !f.computed)) q[k] = v;
    if (a.from) q.from = a.from; if (a.to) q.to = a.to;
    const rows = listRows(a.module, q);
    rows.forEach(r => sources.push({ module: a.module, id: r.id, label: `${ent.singular || ent.label} #${r.id}` }));
    return rows.length ? `${ent.label}: ${rows.length} record(s), newest first:\n${table(a.module, rows, role)}` : `${ent.label}: nothing found. Try search_everything with the key word, or another module.`;
  }
  if (name === 'get_record') {
    mustSee(a.module, role);
    const row = getRow(a.module, a.id); sources.push({ module: a.module, id: row.id, label: `${ENTITIES[a.module].singular || ENTITIES[a.module].label} #${row.id}` });
    return cleanRow(a.module, row, role, true);
  }
  if (name === 'summarize') {
    const ent = mustSee(a.module, role), stored = k => ent.fields.find(f => f.key === k && !f.computed && f.type !== 'section');
    const hasDate = ent.fields.some(f => f.key === 'date');
    let groupSql;
    if (a.group_by === 'month') { if (!hasDate) throw new Error('This module has no date'); groupSql = "strftime('%Y-%m', t.date)"; }
    else { const f = stored(a.group_by); if (!f || HIDE.test(f.key)) throw new Error(`"${a.group_by}" is not a field of ${a.module}. Fields: month, ${ent.fields.filter(f => !f.computed && f.type !== 'section' && f.type !== 'json' && !HIDE.test(f.key)).map(f => f.key).join(', ')}`); groupSql = f.type === 'ref' ? `(SELECT ${ENTITIES[f.ref].display.replaceAll('{t}', 'g')} FROM ${f.ref} g WHERE g.id = t.${f.key})` : `t.${f.key}`; }
    let sumSql = '';
    const sf = a.sum_field && stored(a.sum_field); if (sf && !['number', 'money'].includes(sf.type)) a.sum_field = ''; if (a.sum_field && !sf) a.sum_field = '';
    if (a.sum_field) { const f = sf; if (WORKER_ROLES.includes(role) && (f.type === 'money' || MONEY.test(f.key))) throw new Error('Your role cannot see amounts'); sumSql = `, ROUND(SUM(t.${f.key}), 2) AS total`; }
    const where = [], params = [];
    for (const [k, v] of Object.entries(a.filters || {})) if (stored(k)) { where.push(`t.${k} = ?`); params.push(v); }
    if (a.from && hasDate) { where.push('t.date >= ?'); params.push(a.from); }
    if (a.to && hasDate) { where.push('t.date <= ?'); params.push(a.to); }
    const rows = db.prepare(`SELECT ${groupSql} AS grp, COUNT(*) AS count${sumSql} FROM ${a.module} t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY 1 ORDER BY count DESC LIMIT 30`).all(...params);
    sources.push({ module: a.module, label: ent.label });
    return { module: a.module, grouped_by: a.group_by, rows: rows.map(r => ({ [a.group_by]: r.grp ?? '(blank)', count: r.count, ...(r.total != null ? { [a.sum_field]: r.total } : {}) })) };
  }
  if (name === 'search_documents') {
    const hits = await searchDocs(String(a.query || ''));
    hits.forEach(h => sources.push({ doc: h.source, label: h.title }));
    return hits.length ? hits.map(h => ({ document: h.title, text: h.chunk })) : 'No matching passage in the documents.';
  }
  throw new Error(`Unknown tool ${name}`);
}

// ---------------------------------------------------------------- the instructions
// The same for every user and every day: the engine reads them (with the tool descriptions) once, keeps them in its
// cache and then only reads what is new for each question. The date, the user and the facts go with the question.
let SYSTEM = null;
function systemPrompt() {
  return (SYSTEM ||= `You are WIESPL AI, the assistant inside WIESPL's CRM & ERP. WIESPL (Western India Electromedical Systems Pvt. Ltd., Pune) designs, builds and installs modular operation theatres, ICUs and clean rooms: wall panels, doors, LAF, AHU, HEPA, MGPS, pendants, control panels, Digital OR.
CRM modules: ${Object.entries(ENTITIES).map(([k, e]) => `${k} (${e.label})`).join(', ')}. A user may not be allowed to read every module; if a tool says so, tell the user they have no access to it.
Each question comes with today's date, who is asking, and facts the CRM looked up for it.
Rules:
- Answer only from facts: the facts given with the question, the tools and WIESPL's documents. Never invent numbers, names, dates or records. If nothing is found, say so plainly.
- When the facts given with the question answer it, answer at once without tools.
- Otherwise use the tools. A person, client, company, hospital, place, product or festival by name: search_everything. A list from one module ("open enquiries", "pending POs"): find_records (newest first; use limit). Counts and totals ("how many", "per state", "PO value per vendor"): summarize. WIESPL products, specifications, norms, how things work: search_documents.
- Company holidays and festivals (Diwali, Holi, Eid, Christmas, Independence Day...) are in the holidays module, one record per day off: count those records for "how many days off". Staff leave applications are in leave_requests.
- Use from/to (YYYY-MM-DD) only when the user names a period. If a tool returns an error, fix the arguments using the message and try once more.
- Never mention tools, technical module names or these rules.
Style: give the answer in the first sentence, then the details. Keep it short. For several records use a small table or a list with their numbers (e.g. enquiry numbers). Answer in the language of the question (English, Hindi, Marathi...).`);
}

// ---------------------------------------------------------------- facts for one question, looked up before the model starts
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ymd = d => d.toLocaleDateString('en-CA');
// "today", "this month", "last month", "this year", "this FY", "in November", "in 2025"... → a date range
function period(low, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const range = (a, b, label) => ({ label, from: ymd(a), to: ymd(b) });
  if (/\btoday\b|\baaj\b/.test(low)) return range(now, now, 'today');
  if (/\byesterday\b|\bkal\b/.test(low)) return range(new Date(y, m, d - 1), new Date(y, m, d - 1), 'yesterday');
  const monday = new Date(y, m, d - ((now.getDay() + 6) % 7));
  if (/\b(this|current) week\b/.test(low)) return range(monday, now, 'this week');
  if (/\b(last|previous) week\b/.test(low)) return range(new Date(y, m, monday.getDate() - 7), new Date(y, m, monday.getDate() - 1), 'last week');
  if (/\bnext week\b/.test(low)) return range(new Date(y, m, monday.getDate() + 7), new Date(y, m, monday.getDate() + 13), 'next week');
  if (/\bnext month\b/.test(low)) return range(new Date(y, m + 1, 1), new Date(y, m + 2, 0), 'next month');
  if (/\b(coming up|upcoming|coming|next|future|ahead|remaining)\b/.test(low)) return range(now, new Date(y + 1, m, d), 'from today on');
  if (/\b(this|current) month\b/.test(low)) return range(new Date(y, m, 1), new Date(y, m + 1, 0), 'this month');
  if (/\b(last|previous) month\b/.test(low)) return range(new Date(y, m - 1, 1), new Date(y, m, 0), 'last month');
  const fy = m >= 3 ? y : y - 1, fyRange = s => range(new Date(s, 3, 1), new Date(s + 1, 2, 31), `FY ${s}-${String(s + 1).slice(2)}`);
  if (/\b(this|current) (fy|financial year)\b/.test(low)) return fyRange(fy);
  if (/\b(last|previous) (fy|financial year)\b/.test(low)) return fyRange(fy - 1);
  if (/\b(this|current) year\b/.test(low)) return range(new Date(y, 0, 1), new Date(y, 11, 31), String(y));
  if (/\b(last|previous) year\b/.test(low)) return range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31), String(y - 1));
  const year = Number((low.match(/\b(20\d\d)\b/) || [])[1]) || 0;
  const mi = MONTHS.findIndex(n => (n === 'may' ? /\bmay\s+20\d\d\b/ : new RegExp(`\\b${n}\\b`)).test(low));
  if (mi >= 0) { const yr = year || y; return range(new Date(yr, mi, 1), new Date(yr, mi + 1, 0), `${MONTHS[mi]} ${yr}`); }
  if (year && /\b(in|for|during|of)\s+20\d\d\b/.test(low)) return range(new Date(year, 0, 1), new Date(year, 11, 31), String(year));
  return null;
}
// records as a small table: far fewer words for the engine to read than JSON
function table(m, rows, role, maxCols = 8) {
  const recs = rows.map(r => cleanRow(m, r, role));
  const cols = [...new Set(recs.flatMap(r => Object.keys(r)))].filter(k => k !== 'id').slice(0, maxCols);
  const cell = v => String(v ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 90);
  return [`id | ${cols.join(' | ')}`, ...recs.map(r => `${r.id} | ${cols.map(c => cell(r[c])).join(' | ')}`)].join('\n');
}
// The field a question groups by: "per state", "by vendor", "state-wise", "each salesperson", "monthly"
// the words a question groups by: "per state", "by vendor", "state-wise" → state, vendor, state
const groupWords = low => [...low.matchAll(/\b(?:per|by|each|every)\s+([\p{L}][\p{L}_ ]{1,30}?)(?=\s+(?:this|last|in|for|during|from|of|with|and|or|is|are|was)\b|[?.!,]|$)/gu), ...low.matchAll(/\b([\p{L}]+)[- ]?wise\b/gu)].map(x => x[1].trim());
function groupField(m, low) {
  if (/\bmonth(ly|-wise| wise)\b|\bper month\b|\bby month\b|\beach month\b/.test(low) && ENTITIES[m].fields.some(f => f.key === 'date')) return { key: 'month', label: 'Month' };
  const words = groupWords(low);
  const fields = ENTITIES[m].fields.filter(f => !f.computed && f.type !== 'section' && f.type !== 'json' && !HIDE.test(f.key));
  for (const w of words) {
    const s = w.replace(/s$/, ''), norm = v => String(v || '').toLowerCase().replace(/_id$/, '').replace(/_/g, ' ');
    const f = fields.find(f => norm(f.key) === s || norm(f.label) === s) || fields.find(f => norm(f.label).includes(s) || s.includes(norm(f.key)));
    if (f) return { key: f.key, label: f.label || f.key };
  }
  return null;
}
const STOP = new Set(('about what which show from with have will much many there their this that these those give tell list open latest last first month months year years today please when where does want know need all any some your mine also into than then them they were been being could would should shall days day how who why the and for are you get got can our has had not but its was let ' +
  'wiespl make makes made type types kind kinds find search record records detail details info information details me my we us is am be do did an of to in on at by it as or if so no yes new old current previous week weeks number numbers count total per each every between under over more less most top recent recently hour hours minute minutes time times change changes coming upcoming next pending approved active status').split(' '));
const NO_WORD_SEARCH = new Set(['boq_items', 'bom_items', 'schedule_baselines']); // line items: too many, too alike
const DOC_MIN = 0.7; // how close a document passage must be to the question to be handed over (related ones score 0.75+)
async function questionContext(user, text, sources) {
  const role = user.role, low = String(text).toLowerCase(), when = period(low), can = viewable(role), facts = [];
  // 1. low stock, worked out from the stock moves
  const lowStock = /\blow\b.{0,12}\bstock\b|\bstock\b.{0,20}\blow\b|re-?order|out of stock|short(age)? of|running out|below (the )?(minimum|min|reorder)/.test(low) && can.includes('items');
  if (lowStock) {
    const rows = db.prepare(`SELECT * FROM (SELECT t.id, t.code, t.name, t.uom, t.reorder_level, ${STOCK_SQL.replaceAll('{t}', 't')} AS stock FROM items t) WHERE reorder_level > 0 AND stock <= reorder_level ORDER BY stock - reorder_level LIMIT 30`).all();
    facts.push(`Items at or below their reorder level: ${rows.length}${rows.length ? ':\nid | Code | Item | Stock | Reorder level\n' + rows.map(r => `${r.id} | ${r.code || ''} | ${r.name} | ${r.stock} ${r.uom || ''} | ${r.reorder_level}`).join('\n') : '.'}`);
    rows.slice(0, 8).forEach(r => sources.push({ module: 'items', id: r.id, label: `Item ${r.code || '#' + r.id}` }));
  }
  // 2. modules the question names ("holidays", "enquiries", "purchase orders"...): their records, in the period if one is named
  let named = can.filter(m => !(lowStock && m === 'items')).filter(m => { const e = ENTITIES[m]; return [m.replace(/_/g, ' '), e.label, e.singular].filter(Boolean).some(n => n.length > 3 && low.includes(n.toLowerCase())); });
  // "PO value per vendor": vendors is how to group the purchase orders, not what is asked about
  const dims = groupWords(low).map(w => w.replace(/s$/, ''));
  if (named.length > 1) named = named.filter(m => !dims.some(w => [m, ENTITIES[m].label, ENTITIES[m].singular].filter(Boolean).some(n => n.toLowerCase().replace(/s$/, '').startsWith(w))));
  named = named.slice(0, 2);
  for (const m of named) {
    const ent = ENTITIES[m], dated = !!when && ent.fields.some(f => f.key === 'date');
    // "approved vendors", "pending leave requests", "open complaints": only those with that status
    const sf = ent.statusField && ent.fields.find(f => f.key === ent.statusField);
    const status = sf?.options?.filter(Boolean).find(o => { const l = String(o).toLowerCase(), first = l.split(/[\s(]/)[0]; return new RegExp(`\\b${l.replace(/[^a-z0-9 ]/g, '.')}\\b`).test(low) || (first.length >= 4 && new RegExp(`\\b${first}\\b`).test(low)); });
    const where = [...(dated ? ['date >= ?', 'date <= ?'] : []), ...(status ? [`${sf.key} = ?`] : [])], params = [...(dated ? [when.from, when.to] : []), ...(status ? [status] : [])];
    let rows = [], total = 0;
    try {
      rows = listRows(m, { ...(dated ? { from: when.from, to: when.to } : {}), ...(status ? { [sf.key]: status } : {}), limit: dated || status ? 25 : 12 });
      total = db.prepare(`SELECT COUNT(*) AS n FROM ${m}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`).get(...params).n;
    } catch { continue; }
    const g = groupField(m, low);
    if (!g) facts.push(`${ent.label}${status ? ` with status "${status}"` : ''}${dated ? ` dated ${when.from} to ${when.to} (${when.label})` : ''}: ${total} record${total === 1 ? '' : 's'}${rows.length < total ? `; the newest ${rows.length}` : ''}${rows.length ? ':\n' + table(m, rows, role) : '.'}`);
    // "per state", "by vendor", "state-wise", "each salesperson": counted (and summed) right here
    if (g) {
      const money = /value|amount|worth|total|₹|\brs\b|rupee|sum/.test(low) && ent.fields.find(f => !f.computed && ['money', 'number'].includes(f.type) && /grand_total|^total|amount|value/.test(f.key));
      try {
        const out = await runTool('summarize', { module: m, group_by: g.key, ...(money ? { sum_field: money.key } : {}), ...(dated ? { from: when.from, to: when.to } : {}) }, user, sources);
        const label = g.key === 'month' ? 'Month' : g.label;
        facts.push(`${ent.label} per ${label}${dated ? ` (${when.label})` : ''}, worked out by the CRM:\n${label} | Count${money ? ' | ' + (money.label || money.key) : ''}\n` +
          out.rows.map(r => `${r[g.key]} | ${r.count}${money ? ' | ' + (r[money.key] ?? '') : ''}`).join('\n') + `\nTotal: ${out.rows.reduce((s, r) => s + r.count, 0)}`);
      } catch (e) { facts.push(`(Could not count ${ent.label} per ${g.label}: ${e.message})`); }
    } else if (/how many|count|per |total|sum|average|most|least|highest|lowest|top |wise/.test(low)) {
      facts.push(`Fields of ${ent.label} (for counting or filtering with the tools): ${ent.fields.filter(f => !f.computed && f.type !== 'section' && f.type !== 'json' && !HIDE.test(f.key)).slice(0, 35).map(f => `${f.key} (${f.label || f.key})`).join(', ')}`);
    }
    sources.push({ module: m, label: ent.label });
  }
  // 3. records that match the specific words of the question ("Diwali", "Sourav", "Kerala"); a word found all over the CRM says nothing
  // (the module's own name and its field names, e.g. "state" in "enquiries per state", are not things to look for)
  const nameWords = named.flatMap(m => [m, ENTITIES[m].label, ENTITIES[m].singular || '', ...ENTITIES[m].fields.flatMap(f => [f.key.replace(/_id$/, ''), f.label || ''])].map(n => n.toLowerCase()));
  const words = [...new Set(low.match(/[\p{L}\p{N}][\p{L}\p{N}./-]{2,}/gu) || [])]
    .filter(w => !STOP.has(w) && !MONTHS.includes(w) && !/^20\d\d$/.test(w) && !(lowStock && /stock|low|item/.test(w)) && !nameWords.some(n => n.includes(w))).slice(0, 5);
  // WIESPL's own documents, for questions about products, norms and how things work (looked up first: when a
  // document clearly answers, records that merely share a word, e.g. "operation", would only be noise)
  let docs = [];
  if (!named.length && !lowStock) {
    try {
      docs = (await searchDocs(text, 3)).filter(h => h.score >= DOC_MIN);
      if (process.env.AI_DEBUG) console.log('[ai docs]', docs.map(h => `${h.title} ${h.score.toFixed(2)}`).join(', ') || 'none close enough');
    } catch { /* the search engine is still starting: the model can still use the tools */ }
  }
  const seen = new Set();
  if (docs.some(h => h.score >= 0.72)) words.length = 0;
  for (const w of words) {
    const found = [];
    for (const m of can) {
      if (NO_WORD_SEARCH.has(m) || !ENTITIES[m].search?.length) continue;
      let rows = []; try { rows = listRows(m, { q: w, limit: 6 }); } catch { continue; }
      rows = rows.filter(r => !seen.has(`${m}:${r.id}`));
      if (rows.length) found.push({ m, rows });
    }
    const n = found.reduce((s, f) => s + f.rows.length, 0);
    if (!n || n > 10) continue;
    for (const { m, rows } of found) {
      rows.forEach(r => { seen.add(`${m}:${r.id}`); sources.push({ module: m, id: r.id, label: `${ENTITIES[m].singular || ENTITIES[m].label} #${r.id}` }); });
      facts.push(`${ENTITIES[m].label} with "${w}":\n${table(m, rows, role)}`);
    }
  }
  for (const h of docs) { facts.push(`From WIESPL's document "${h.title}":\n${h.chunk.slice(0, 900)}`); sources.push({ doc: h.source, label: h.title }); }
  let body = facts.join('\n\n');
  if (body.length > 5000) body = body.slice(0, 5000) + '\n…';
  const now = new Date();
  return `Today: ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${ymd(now)}). Asked by: ${user.name} (role ${role}).\n` +
    (body ? `Facts the CRM looked up for this question:\n${body}` : 'The CRM found no facts for this question by itself.') + `\n\nQuestion: ${text}`;
}

// ---------------------------------------------------------------- conversations: each person's own, kept on the server
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
export function listConversations(user) {
  return db.prepare('SELECT id, title, updated_at, json_array_length(messages) AS n FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 200').all(user.id);
}
export function getConversation(user, id) {
  const c = db.prepare('SELECT id, title, messages, created_at, updated_at FROM ai_conversations WHERE id = ? AND user_id = ?').get(Number(id), user.id);
  if (!c) throw new HttpError(404, 'That conversation is not there any more');
  return { ...c, messages: JSON.parse(c.messages) };
}
export function renameConversation(user, id, title) {
  const t = String(title || '').trim().slice(0, 80); if (!t) throw new HttpError(400, 'Give it a name');
  if (!db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ? AND user_id = ?').run(t, Number(id), user.id).changes) throw new HttpError(404, 'That conversation is not there any more');
  return { ok: true };
}
export function deleteConversation(user, id) {
  db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(Number(id), user.id);
  return { ok: true };
}

// ---------------------------------------------------------------- one question, answered and streamed to the browser
// The reply is newline-delimited JSON: {type:'conversation'|'status'|'token'|'reset'|'sources'|'done'|'error', ...}
// The browser sends {text, conversation?}; the server keeps the conversation. (An older panel sends {messages}.)
export async function chat(req, res) {
  const user = req.user, cfg = aiConfig(), b = req.body || {}, legacy = Array.isArray(b.messages);
  let conv = null, text, past;
  if (legacy) {
    const all = b.messages.slice(-12).filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!all.length || all[all.length - 1].role !== 'user') throw new HttpError(400, 'Ask a question');
    text = all.pop().content; past = all;
  } else {
    text = String(b.text || '').trim().slice(0, 4000); if (!text) throw new HttpError(400, 'Ask a question');
    if (b.conversation) {
      conv = db.prepare('SELECT id, title, messages FROM ai_conversations WHERE id = ? AND user_id = ?').get(Number(b.conversation), user.id);
      if (!conv) throw new HttpError(404, 'That conversation is not there any more');
    }
    past = conv ? JSON.parse(conv.messages).slice(-12).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })) : [];
  }
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const send = o => { try { res.write(JSON.stringify(o) + '\n'); } catch { /* the browser went away */ } };
  const abort = new AbortController(); res.on('close', () => abort.abort());
  if (!legacy) {
    if (!conv) conv = { id: Number(db.prepare('INSERT INTO ai_conversations (user_id, title, messages) VALUES (?, ?, ?)').run(user.id, text.replace(/\s+/g, ' ').slice(0, 80), '[]').lastInsertRowid), title: text.replace(/\s+/g, ' ').slice(0, 80) };
    send({ type: 'conversation', id: conv.id, title: conv.title });
  }
  const t0 = Date.now(), sources = [];
  send({ type: 'status', text: 'Looking in the CRM…' });
  const question = await questionContext(user, text, sources);
  if (process.env.AI_DEBUG) console.log('[ai question]', question.slice(0, 700).replace(/\n/g, ' | '));
  const messages = [{ role: 'system', content: systemPrompt() }, ...past, { role: 'user', content: question }];
  const tools = TOOLS.map(t => ({ type: 'function', function: t }));
  const LABEL = { search_everything: 'Searching the CRM', describe_module: 'Reading the module', find_records: 'Looking up records', get_record: 'Opening a record', summarize: 'Counting', search_documents: 'Searching WIESPL documents' };
  let answer = '', failed = '', items = [];
  try {
    send({ type: 'status', text: 'Thinking…' });
    for (let round = 0; round < 5; round++) {
      const { content, calls } = await streamRound(cfg, messages, tools, abort.signal, t => send({ type: 'token', text: t }));
      answer = content;
      if (isOllama()) messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(c => ({ function: { name: c.name, arguments: c.args } })) } : {}) });
      else messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
      if (!calls.length) break;
      answer = '';
      if (content) send({ type: 'reset' }); // text written before a lookup was the model thinking aloud: clear it
      for (const c of calls) {
        const fn = c.name, args = normArgs(c.args); c.args = args;
        send({ type: 'status', text: `${LABEL[fn] || fn}${args?.module ? ': ' + (ENTITIES[args.module]?.label || args.module) : args?.query ? ': ' + args.query : args?.text ? ': ' + args.text : ''}…` });
        if (process.env.AI_DEBUG) console.log('[ai tool]', fn, JSON.stringify(args));
        let out; try { out = await runTool(fn, args, user, sources); } catch (e) { out = { error: e.message }; }
        const result = (typeof out === 'string' ? out : JSON.stringify(out)).slice(0, 6000);
        messages.push(isOllama() ? { role: 'tool', content: result, tool_name: fn } : { role: 'tool', tool_call_id: c.id, content: result });
      }
    }
    const seen = new Set();
    items = sources.filter(s => { const k = s.module ? `${s.module}:${s.id ?? ''}` : s.doc; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
    send({ type: 'sources', items });
    send({ type: 'done', seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    failed = e.message || String(e);
    if (!abort.signal.aborted) send({ type: 'error', text: failed });
  } finally {
    if (conv) { // keep the question and the answer (or what there was of it) with the conversation
      try {
        const all = JSON.parse(db.prepare('SELECT messages FROM ai_conversations WHERE id = ?').get(conv.id)?.messages || '[]');
        all.push({ role: 'user', content: text, at: stamp() });
        const reply = answer.trim() + (abort.signal.aborted ? (answer.trim() ? ' …' : '(stopped)') : '');
        all.push({ role: 'assistant', content: reply || (failed ? '⚠️ ' + failed : 'I could not find an answer to that.'), sources: items, at: stamp(), seconds: Math.round((Date.now() - t0) / 1000), ...(failed && !abort.signal.aborted ? { error: true } : {}) });
        db.prepare("UPDATE ai_conversations SET messages = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(JSON.stringify(all.slice(-80)), conv.id);
      } catch (e) { console.error('AI: could not keep the conversation', e.message); }
    }
  }
  res.end();
}

// one answer from the model, streamed: the text as it comes, then the tools it wants (normalised: {id, name, args})
async function streamRound(cfg, messages, tools, signal, onText) {
  const ollama = isOllama();
  const res = ollama
    ? await post(cfg.url, '/api/chat', { model: cfg.model, messages, tools, stream: true, options: { temperature: 0.3, top_p: 0.8, top_k: 20, num_ctx: 8192, num_predict: 900 } }, signal)
    : await post(cfg.url, '/v1/chat/completions', { messages, tools, stream: true, temperature: 0.3, top_p: 0.8, top_k: 20, max_tokens: 900, cache_prompt: true }, signal);
  let content = '', buf = ''; const calls = [], parts = [];
  const reader = res.body.getReader(), dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
      if (!ollama) { if (!line.startsWith('data:')) continue; line = line.slice(5).trim(); if (line === '[DONE]') continue; }
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error.message || j.error);
      if (ollama) {
        for (const c of j.message?.tool_calls || []) calls.push({ id: 'call_' + calls.length, name: c.function?.name, args: typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function?.arguments || {} });
        if (j.message?.content) { content += j.message.content; onText(j.message.content); }
      } else {
        if (j.timings && process.env.AI_DEBUG) { const t = j.timings; console.log(`[ai speed] read ${t.prompt_n} new tokens in ${(t.prompt_ms / 1000).toFixed(1)}s (${t.prompt_per_second?.toFixed(0)}/s, ${t.cache_n ?? 0} from cache), wrote ${t.predicted_n} in ${(t.predicted_ms / 1000).toFixed(1)}s (${t.predicted_per_second?.toFixed(1)}/s)`); }
        const d = j.choices?.[0]?.delta || {};
        for (const c of d.tool_calls || []) { const p = (parts[c.index ?? 0] ||= { id: '', name: '', args: '' }); if (c.id) p.id = c.id; if (c.function?.name) p.name += c.function.name; if (c.function?.arguments) p.args += c.function.arguments; }
        if (d.content) { content += d.content; onText(d.content); }
      }
    }
  }
  for (const [i, p] of parts.entries()) if (p?.name) { let args = {}; try { args = JSON.parse(p.args || '{}'); } catch { /* the model wrote broken JSON */ } calls.push({ id: p.id || 'call_' + i, name: p.name, args }); }
  return { content, calls };
}

// speech to text, on a local whisper.cpp server (no audio leaves the company network)
export async function transcribe(buf) {
  const { whisper } = aiConfig();
  if (!whisper) throw new HttpError(400, 'Voice is not set up: add the speech server address in Settings → AI Assistant');
  const form = new FormData(); form.append('file', new Blob([buf], { type: 'audio/wav' }), 'speech.wav'); form.append('response_format', 'json');
  let r; try { r = await fetch(whisper + '/inference', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) }); } catch { throw new HttpError(503, `The speech server is not reachable at ${whisper}`); }
  if (!r.ok) throw new HttpError(502, `Speech server error ${r.status}`);
  const j = await r.json(); return { text: String(j.text || '').trim() };
}
