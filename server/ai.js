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
import { ENTITIES, canView, WORKER_ROLES, STOCK_SQL, hasFunction, isStoreStockField } from '../public/js/schema.js';
import { listRows, getRow, HttpError, options } from './crud.js';
import { PART_UI, DOOR_TYPES, FLOOR_TYPES } from '../public/js/parts.js';
import { VIDEOS } from '../public/js/explainers.js';
import { workAnswer } from './aiwork.js';
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
// never shown, to anyone: signatures, stamps, seals, passwords, tokens (whole words, so "assigned_to", "designation"
// and "design_brief" are not caught by "sign")
const HIDE = /(^|_)(sign|signature|signatures|stamp|stamps|seal)(_|$)|password|pass_hash|token|secret|aadhaar|pan_no|bank_account|bank_ifsc|uan_no|esic_no/i;
const MONEY = /rate|price|value|cost|amount|salary|margin|total/i; // not for the least-access roles
// Store prices, rates and stock value: only for roles with the function see_stock_value, as on the screens and in Excel (server/index.js)
const STOCK_VALUE_MODULES = new Set(['items', 'stock_moves', 'lots', 'iqc', 'stock_drafts']);
const hidesValue = (module, f, role) => STOCK_VALUE_MODULES.has(module) && /rate|price|value|cost/i.test(`${f.key} ${f.label || ''}`) && !hasFunction(role, 'see_stock_value');
function cleanRow(module, row, role, full = false) {
  const ent = ENTITIES[module], out = { id: row.id }, worker = WORKER_ROLES.includes(role);
  const keys = full ? ent.fields.filter(f => f.type !== 'section').map(f => f.key) : [...new Set(['date', ...(ent.list || []), ent.statusField].filter(Boolean))];
  for (const key of keys) {
    const f = ent.fields.find(x => x.key === key); if (!f || f.type === 'json' || f.type === 'image' || f.type === 'file' || HIDE.test(key)) continue;
    if ((worker && (f.type === 'money' || MONEY.test(key))) || hidesValue(module, f, role) || (isStoreStockField(module, key) && !hasFunction(role, 'see_store_stock'))) continue;
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
    return { module: a.module, label: ent.label, fields: ent.fields.filter(f => f.type !== 'section' && !HIDE.test(f.key) && f.type !== 'json' && !hidesValue(a.module, f, role)).map(f => ({ key: f.key, label: f.label, type: f.type, ...(f.options ? { choices: f.options.filter(Boolean).slice(0, 25) } : {}), ...(f.ref ? { refers_to: f.ref } : {}) })) };
  }
  if (name === 'find_records') {
    const ent = mustSee(a.module, role), q = { limit: Math.min(Number(a.limit) || 10, 25) };
    if (a.text) q.q = String(a.text);
    for (const [k, v] of Object.entries(a.filters || {})) if (ent.fields.some(f => f.key === k && !f.computed && !hidesValue(a.module, f, role))) q[k] = v;
    if (a.from) q.from = a.from; if (a.to) q.to = a.to;
    const rows = listRows(a.module, q);
    rows.forEach(r => sources.push({ module: a.module, id: r.id, label: `${ent.singular || ent.label} #${r.id}` }));
    return rows.length ? `${ent.label}: ${rows.length} record(s), newest first:\n${table(a.module, rows, role)}` : `${ent.label}: nothing found. Try search_everything with the key word, or another module.`;
  }
  if (name === 'get_record') {
    mustSee(a.module, role);
    const row = getRow(a.module, a.id); sources.push({ module: a.module, id: row.id, label: `${ENTITIES[a.module].singular || ENTITIES[a.module].label} #${row.id}` });
    const out = cleanRow(a.module, row, role, true);
    if (STOCK_VALUE_MODULES.has(a.module) && !hasFunction(role, 'see_stock_value')) out.note = 'Rates, prices and stock value are hidden from this role: if asked, say the user cannot see them.';
    return out;
  }
  if (name === 'summarize') {
    const ent = mustSee(a.module, role), stored = k => ent.fields.find(f => f.key === k && !f.computed && f.type !== 'section');
    const hasDate = ent.fields.some(f => f.key === 'date');
    let groupSql;
    if (a.group_by === 'month') { if (!hasDate) throw new Error('This module has no date'); groupSql = "strftime('%Y-%m', t.date)"; }
    else { const f = stored(a.group_by); if (!f || HIDE.test(f.key)) throw new Error(`"${a.group_by}" is not a field of ${a.module}. Fields: month, ${ent.fields.filter(f => !f.computed && f.type !== 'section' && f.type !== 'json' && !HIDE.test(f.key)).map(f => f.key).join(', ')}`); groupSql = f.type === 'ref' ? `(SELECT ${ENTITIES[f.ref].display.replaceAll('{t}', 'g')} FROM ${f.ref} g WHERE g.id = t.${f.key})` : `t.${f.key}`; }
    let sumSql = '';
    const sf = a.sum_field && stored(a.sum_field); if (sf && !['number', 'money'].includes(sf.type)) a.sum_field = ''; if (a.sum_field && !sf) a.sum_field = '';
    if (a.group_by !== 'month' && hidesValue(a.module, stored(a.group_by), role)) throw new Error('Your role cannot see prices or stock value');
    if (a.sum_field) { const f = sf; if ((WORKER_ROLES.includes(role) && (f.type === 'money' || MONEY.test(f.key))) || hidesValue(a.module, f, role)) throw new Error('Your role cannot see prices or stock value'); sumSql = `, ROUND(SUM(t.${f.key}), 2) AS total`; }
    const where = [], params = [];
    for (const [k, v] of Object.entries(a.filters || {})) if (stored(k) && !hidesValue(a.module, stored(k), role)) { where.push(`t.${k} = ?`); params.push(v); }
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
Style: give the answer in the first sentence, then the details. Keep it short: at most about 120 words. For several records give a list of at most 10 lines, one line each with the number, the name and the one fact that matters; never list every field of a record; when there are more, say how many more. Every record in the facts that answers the question must be in your answer: never leave one out, and when the question asks "who", name every person. Call people by their name, not "he" or "she". For a question about pay, a raise or a bonus: give the current salary, then the work summary as short points (tasks, overdue, attendance, late marks, leave, projects), then say the decision is the management's; never make up a salary figure. Do not guess or comment on whether the data is right; just report it. Answer in the language of the question (English, Hindi, Marathi...); when the question says which language to answer in, use that one.`);
}

// ---------------------------------------------------------------- facts for one question, looked up before the model starts
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ymd = d => d.toLocaleDateString('en-CA');
// "today", "this month", "last month", "this year", "this FY", "in November", "in 2025"... → a date range
function period(low, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const range = (a, b, label) => ({ label, from: ymd(a), to: ymd(b) });
  if (/\btoday\b|\baaj\b|आज/.test(low)) return range(now, now, 'today');
  if (/\byesterday\b|\bkal\b|काल\b|कल\b/.test(low)) return range(new Date(y, m, d - 1), new Date(y, m, d - 1), 'yesterday');
  if (/इस (हफ्ते|सप्ताह)|या आठवड्या/.test(low)) low = 'this week';
  if (/इस (महीने|माह)|या महिन्या/.test(low)) low = 'this month';
  if (/इस (साल|वर्ष)|या वर्षी/.test(low)) low = 'this year';
  const monday = new Date(y, m, d - ((now.getDay() + 6) % 7));
  if (/\b(this|current) week\b/.test(low)) return range(monday, new Date(y, m, monday.getDate() + 6), 'this week, Monday to Sunday');
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
function table(m, rows, role, maxCols = 6, keep = []) {
  const recs = rows.map(r => cleanRow(m, r, role));
  const all = [...new Set(recs.flatMap(r => Object.keys(r)))].filter(k => k !== 'id');
  const ent = ENTITIES[m], st = ent.statusField && (ent.fields.find(f => f.key === ent.statusField)?.label || ent.statusField);
  // the status always kept, and the columns the question filtered on ("late" -> Timing)
  const must = [st, ...keep.map(k => ent.fields.find(f => f.key === k)?.label || k)].filter(c => c && all.includes(c));
  const cols = [...all.slice(0, 2).filter(c => !must.includes(c)), ...must, ...all.slice(2).filter(k => !must.includes(k))].slice(0, Math.max(maxCols, must.length + 2));
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
  // "per person", "by employee", "each staff member": the person the record is given to
  if (words.some(w => /^(person|people|employee|staff|member|user|engineer|assignee|owner|head)s?\b/.test(w))) {
    const f = fields.find(f => f.type === 'person') || fields.find(f => f.type === 'ref' && ['employees', 'users'].includes(f.ref));
    if (f) return { key: f.key, label: f.label || f.key };
  }
  for (const w of words) {
    const s = w.replace(/s$/, ''), norm = v => String(v || '').toLowerCase().replace(/_id$/, '').replace(/_/g, ' ');
    const f = fields.find(f => norm(f.key) === s || norm(f.label) === s) || fields.find(f => norm(f.label).includes(s) || s.includes(norm(f.key)));
    if (f) return { key: f.key, label: f.label || f.key };
  }
  return null;
}
const STOP = new Set(('about what which show from with have will much many there their this that these those give tell list open latest last first month months year years today please when where does want know need all any some your mine also into than then them they were been being could would should shall days day how who why the and for are you get got can our has had not but its was let ' +
  'wiespl make makes made type types kind kinds find search record records detail details info information details me my we us is am be do did an of to in on at by it as or if so no yes new old current previous week weeks number numbers count total per each every between under over more less most top recent recently hour hours minute minutes time times change changes coming upcoming next pending approved active status ' +
  'work works working worked doing done should him her his hers she he give given want wants engagement much salary amount').split(' '));
const NO_WORD_SEARCH = new Set(['boq_items', 'bom_items', 'schedule_baselines']); // line items: too many, too alike
const DOC_MIN = 0.7; // how close a document passage must be to the question to be handed over (related ones score 0.75+)
// The staff's names (employees and CRM users), so "Swapnil's tasks" can be narrowed to Swapnil. Looked up fresh each
// question (a few dozen rows). A name word must be 3+ letters and not a common word.
function people() {
  const map = new Map();
  const add = (name, k, id) => { const n = String(name || '').trim().toLowerCase(); if (!n) return; const p = map.get(n) || { name: n, words: [n, ...n.split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w) && /^[a-z]+$/.test(w))] }; p[k] = id; map.set(n, p); };
  try { for (const e of db.prepare('SELECT id, name FROM employees').all()) add(e.name, 'emp', e.id); } catch { /* no employees table */ }
  try { for (const u of db.prepare('SELECT id, name FROM users').all()) add(u.name, 'user', u.id); } catch { /* no users table */ }
  return [...map.values()].map(p => ({ ...p, words: [...new Set(p.words)].map(w => w.replace(/[^a-z0-9 ]/g, '.')) }));
}
// A question about how someone works, or what to pay them
const PERF = /\b(perform\w*|work done|his work|her work|productiv\w*|apprais\w*|report card|review of|how (is|has|was|did) \w+( \w+)? (doing|working|work|performed|done)|salary|salaries|ctc|raise|increment|bonus|incentive|hike|promot\w*|engagement|pay (him|her)|worth)\b/;
// One person's work in the period (default: the last 30 days): tasks, attendance, leave, tickets, enquiries, projects,
// and their current salary. Counted here, so the model only has to report it.
function workSummary(user, who, when, sources) {
  const role = user.role, t = ymd(new Date()), d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const from = when?.from || ymd(d30), to = when?.to || t, label = when?.label || 'the last 30 days';
  const names = who.map(p => p.name), ph = names.map(() => '?').join(','), emp = who.find(p => p.emp)?.emp;
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) || {}; } catch { return {}; } };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
  const n = v => Number(v) || 0;
  const e = emp ? one('SELECT name, emp_code, designation, department, joining_date, status FROM employees WHERE id = ?', emp) : {};
  const out = [`Work summary of ${e.name || names[0]}${e.emp_code ? ` (${e.emp_code})` : ''}, ${label} (${from} to ${to}), counted by the CRM:`];
  if (e.name) out.push(`- Job: ${[e.designation, e.department].filter(Boolean).join(', ') || 'not recorded'}; joined ${e.joining_date || 'date not recorded'}; status ${e.status || ''}`);
  if (emp && canView('salaries', role)) {
    const s = one("SELECT sal_no, effective_from, monthly_gross, annual_ctc, increment_pct, reason FROM salaries WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1", emp, t);
    out.push(s.monthly_gross ? `- Current salary: ₹${n(s.monthly_gross).toLocaleString('en-IN')} a month gross, CTC ₹${n(s.annual_ctc).toLocaleString('en-IN')} a year, from ${s.effective_from} (${s.reason || 'revision'}${s.increment_pct ? `, +${s.increment_pct}%` : ''}; ${s.sal_no})` : '- Current salary: not in the Salary Register yet');
    if (s.sal_no) sources.push({ module: 'salaries', label: 'Salary Register' });
  }
  if (canView('work_tasks', role)) {
    const a = one(`SELECT COUNT(*) total, SUM(status = 'Done') done, SUM(status = 'Done' AND substr(completed_at, 1, 10) <= due_date) on_time FROM work_tasks WHERE lower(trim(assigned_to)) IN (${ph}) AND due_date BETWEEN ? AND ?`, ...names, from, to);
    const b = one(`SELECT SUM(status NOT IN ('Done', 'Cancelled')) open, SUM(status NOT IN ('Done', 'Cancelled') AND due_date < ?) overdue FROM work_tasks WHERE lower(trim(assigned_to)) IN (${ph})`, t, ...names);
    const late = all(`SELECT task_no, title, due_date FROM work_tasks WHERE lower(trim(assigned_to)) IN (${ph}) AND status NOT IN ('Done', 'Cancelled') AND due_date < ? ORDER BY due_date LIMIT 5`, ...names, t);
    out.push(`- Tasks due in the period: ${n(a.total)}, done ${n(a.done)}${a.done ? ` (${n(a.on_time)} on time)` : ''}. Open now: ${n(b.open)}, overdue ${n(b.overdue)}${late.length ? ': ' + late.map(r => `${r.task_no} "${r.title}" due ${r.due_date}`).join('; ') : ''}`);
    sources.push({ module: 'work_tasks', label: 'Task Scheduler' });
  }
  if (emp && canView('attendance', role)) {
    const a = one(`SELECT COUNT(*) days, SUM(status IN ('Present', 'Working')) present, SUM(status = 'Half Day') half, SUM(status = 'Absent') absent, SUM(status = 'On Leave') leave, SUM(timing LIKE 'Late%') late, ROUND(AVG(NULLIF(net_hours, 0)), 1) hrs FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?`, emp, from, to);
    out.push(a.days ? `- Attendance: ${n(a.present)} days present, ${n(a.half)} half days, ${n(a.absent)} absent, ${n(a.leave)} on leave; ${n(a.late)} late marks; ${a.hrs || 0} working hours a day on average` : '- Attendance: no attendance records in the period');
    if (a.days) sources.push({ module: 'attendance', label: 'Attendance Register' });
  }
  if (emp && canView('leave_requests', role)) {
    const a = one("SELECT COUNT(*) n, SUM(days) days FROM leave_requests WHERE employee_id = ? AND status = 'Approved' AND from_date <= ? AND to_date >= ?", emp, to, from);
    out.push(`- Approved leave in the period: ${n(a.n)} request${n(a.n) === 1 ? '' : 's'}, ${n(a.days)} day${n(a.days) === 1 ? '' : 's'}`);
  }
  if (canView('service_tickets', role)) {
    const a = one(`SELECT COUNT(*) total, SUM(status IN ('Resolved', 'Closed')) closed FROM service_tickets WHERE lower(trim(assigned_to)) IN (${ph}) AND date BETWEEN ? AND ?`, ...names, from, to);
    if (a.total) { out.push(`- Service tickets given in the period: ${n(a.total)}, resolved / closed ${n(a.closed)}`); sources.push({ module: 'service_tickets', label: 'Complaint Register' }); }
  }
  if (canView('enquiries', role)) {
    const a = one(`SELECT COUNT(*) total, SUM(status = 'Won') won, SUM(CASE WHEN status = 'Won' THEN expected_value END) won_value FROM enquiries WHERE lower(trim(enquiry_by)) IN (${ph}) AND date BETWEEN ? AND ?`, ...names, from, to);
    if (a.total) { out.push(`- Enquiries brought in the period: ${n(a.total)}, won ${n(a.won)}${a.won_value ? ` (₹${n(a.won_value).toLocaleString('en-IN')})` : ''}`); sources.push({ module: 'enquiries', label: 'Enquiry Register' }); }
  }
  if (canView('projects', role)) {
    const ps = all(`SELECT code, name, stage, progress FROM projects WHERE lower(trim(engineer)) IN (${ph}) AND status = 'Active'`, ...names);
    if (ps.length) { out.push(`- Engineer on running projects: ${ps.map(p => `${p.code} ${p.name} (${p.stage || ''}, ${n(p.progress)}%)`).join('; ')}`); sources.push({ module: 'projects', label: 'Projects / Execution' }); }
  }
  out.push('(Pay decisions are the management\'s: report these facts; do not invent a salary figure the facts do not give.)');
  return out.join('\n');
}
const ALIASES = [
  [/\b(salary|salaries|ctc|wages?|pay ?scale|gross pay)\b/, 'salaries'],
  [/\b(on leave|leaves?|day off|days off|time off)\b/, 'leave_requests'],
  [/\b(late|late mark|absent|present|attendance|came|punch(ed)?|check(ed)?[ -]?in|half[ -]day)\b/, 'attendance'],
  [/\b(complaints?|tickets?|breakdowns?)\b/, 'service_tickets'],
  [/\b(pos?|p\.o\.?)\b/, 'purchase_orders'],
  [/\b(staff|team|engineers?|people|who works)\b/, 'employees'],
  [/\b(leads?|prospects?)\b/, 'enquiries'],
];
// Spelling slips in module names ("empoly list", "enqiury", "vender"): swap a near-miss word for the module word it was
// meant to be, so the CRM search still finds the module. Only words of 5+ letters, same first letter, 1 slip (2 when long).
let VOCAB;
function slips(a, b) { // Damerau-Levenshtein distance (a swap of two neighbours counts as one slip)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function fixSpelling(low) {
  VOCAB ||= [...new Set(Object.entries(ENTITIES).flatMap(([m, e]) => [m, e.label, e.singular].filter(Boolean).join(' ').toLowerCase().split(/[^a-z]+/)).filter(w => w.length >= 5))];
  return low.replace(/[a-z]{5,}/g, w => {
    if (STOP.has(w) || VOCAB.includes(w) || VOCAB.some(v => v.startsWith(w))) return w;
    let best = null, bestD = 9;
    for (const v of VOCAB) {
      if (v[0] !== w[0]) continue;
      const max = w.length >= 8 ? 2 : 1;
      // whole word ("vender" -> "vendor"), or the start of it ("empoly" -> "employ"ee)
      const dd = Math.min(slips(w, v), v.length > w.length ? slips(w, v.slice(0, w.length)) + 0.5 : 9);
      if (dd <= max + 0.5 && dd < bestD) { best = v; bestD = dd; }
    }
    return best || w;
  });
}
async function questionContext(user, text, sources) {
  const role = user.role, low = fixSpelling(String(text).toLowerCase()), when = period(low), can = viewable(role), facts = [];
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
  // everyday words for a module, when no module is named outright ("who is on leave", "who came late", "complaints")
  if (!named.length) for (const [re, m] of ALIASES) if (re.test(low) && can.includes(m) && !named.includes(m)) named.push(m);
  named = named.slice(0, 2);
  let summedDept = false;
  for (const m of named) {
    const ent = ENTITIES[m], span = ent.fields.some(f => f.key === 'from_date') && ent.fields.some(f => f.key === 'to_date');
    const dated = !!when && (span || ent.fields.some(f => f.key === 'date'));
    // What the question narrows the records to: a choice of any choice-field ("approved vendors", "urgent tasks",
    // "site work"), maybe with "not" ("not done"); "pending / open / unfinished" (not finished yet); "overdue / late"
    // (past the due date and not finished); and the period ("this month", "coming up")
    const FINISHED = /^(done|cancelled|canceled|closed|completed|paid|resolved|received|won|lost|rejected|left|reversed)$/i;
    const sf = ent.statusField && ent.fields.find(f => f.key === ent.statusField);
    const conds = [], said = [], keep = [];
    for (const f of ent.fields.filter(f => f.type === 'select' && !f.computed && f.options?.length)) {
      for (const o of f.options.filter(Boolean)) {
        const l = String(o).toLowerCase(), esc = l.replace(/[^a-z0-9 ]/g, '.'), first = l.split(/[\s(/]/)[0];
        if (!(new RegExp(`\\b${esc}\\b`).test(low) || (f === sf && first.length >= 4 && !STOP.has(first) && new RegExp(`\\b${first}\\b`).test(low)))) continue;
        const neg = new RegExp(`\\b(not|non|un)[ -]?(${esc}|${first})\\b`).test(low);
        conds.push(r => (String(r[f.key] ?? '') === o) !== neg);
        keep.push(f.key); said.push(`${f.label || f.key} ${neg ? 'not ' : ''}"${o}"`);
        break; // one choice per field
      }
    }
    const today = ymd(new Date());
    const overdue = /\boverdue\b|\blate\b|past (the )?due|delayed|missed/.test(low) && ent.fields.some(f => f.key === 'due_date' && !f.computed);
    const open = !overdue && sf && !said.some(s => s.startsWith(sf.label || sf.key)) && /\b(pending|open|unfinished|incomplete|remaining|not (yet )?(done|finished|completed|closed))\b/.test(low);
    if (overdue) { conds.push(r => r.due_date && r.due_date < today && !FINISHED.test(String((sf && r[sf.key]) || ''))); said.push(`overdue (due before today ${today} and not finished)`); }
    if (open) { conds.push(r => !FINISHED.test(String(r[sf.key] || ''))); said.push('not finished yet'); }
    // a person the question names ("Swapnil's tasks", "Priya's leave"): only their records
    const who = people().filter(p => p.words.some(w => new RegExp(`\\b${w}\\b`).test(low)));
    const pf = ent.fields.filter(f => !f.computed && (f.type === 'person' || (f.type === 'ref' && ['employees', 'users'].includes(f.ref))));
    if (who.length && pf.length) {
      conds.push(r => pf.some(f => who.some(p => f.type === 'person' ? String(r[f.key] || '').toLowerCase() === p.name : (f.ref === 'employees' ? p.emp : p.user) === r[f.key])));
      said.push(`for ${who.map(p => p.name).join(' / ')}`);
    }
    if (m === 'attendance' && /\blate\b/.test(low)) { conds.push(r => /late/i.test(r.timing || '')); keep.push('timing'); said.push('Timing "Late mark"'); }
    if (m === 'attendance' && /\babsent\b/.test(low)) { conds.push(r => r.status === 'Absent'); said.push('Status "Absent"'); }
    if (dated && span) { conds.push(r => r.from_date <= when.to && (r.to_date || r.from_date) >= when.from); keep.push('from_date', 'to_date'); said.push(`on any day from ${when.from} to ${when.to} (${when.label})`); }
    else if (dated) { conds.push(r => r.date >= when.from && r.date <= when.to); said.push(`dated ${when.from} to ${when.to} (${when.label})`); }
    let rows = [], total = 0;
    try {
      if (conds.length) { rows = listRows(m, { limit: 5000 }).filter(r => conds.every(c => c(r))); total = rows.length; rows = rows.slice(0, 15); }
      else { rows = listRows(m, { limit: 12 }); total = db.prepare(`SELECT COUNT(*) AS n FROM ${m}`).get().n; }
    } catch { continue; }
    // salary per department / designation: those are on the employee, so counted here from each one's current salary
    if (m === 'salaries' && /\b(department|designation|team|role)s?\b/.test(low)) {
      const by = /designation|role/.test(low) ? 'designation' : 'department';
      const rows2 = db.prepare(`SELECT COALESCE(e.${by}, '(not set)') k, COUNT(*) n, SUM(s.monthly_gross) g, SUM(s.annual_ctc) c FROM salaries s JOIN employees e ON e.id = s.employee_id WHERE s.status = 'Current' AND COALESCE(e.status, 'Active') <> 'Left' GROUP BY 1 ORDER BY g DESC`).all();
      const inr = v => '₹' + (Number(v) || 0).toLocaleString('en-IN');
      facts.push(`Current salaries per ${by}, worked out by the CRM:\n${by} | Employees | Monthly gross total | Annual CTC total\n` + rows2.map(r => `${r.k} | ${r.n} | ${inr(r.g)} | ${inr(r.c)}`).join('\n') +
        `\nTotal: ${rows2.reduce((s, r) => s + r.n, 0)} employees, ${inr(rows2.reduce((s, r) => s + r.g, 0))} a month, ${inr(rows2.reduce((s, r) => s + r.c, 0))} a year`);
      sources.push({ module: m, label: ent.label }); summedDept = true;
      continue;
    }
    const g = groupField(m, low);
    // "who ...?": name the people in the records outright, so none of them is left out of the answer
    if (!g && /\bwho\b/.test(low) && rows.length && pf.length) {
      const count = new Map();
      for (const r of rows) for (const f of pf) { const n = f.type === 'person' ? r[f.key] : r[f.key + '_label']; if (n && !/assigned_by|approved_by|prepared_by|verified_by/.test(f.key)) { count.set(n, (count.get(n) || 0) + 1); break; } }
      if (count.size) facts.push(`People in these ${ent.label} records (${count.size}): ${[...count].map(([n, c]) => `${n} (${c} record${c === 1 ? '' : 's'})`).join(', ')}`);
    }
    if (!g) facts.push(`${ent.label}${said.length ? ' that are: ' + said.join('; ') : ''}: ${total} record${total === 1 ? '' : 's'}${rows.length < total ? `; the newest ${rows.length} (${total - rows.length} more not shown)` : rows.length > 1 ? ' (all of them, no more)' : ''}${rows.length ? ':\n' + table(m, rows, role, 7, keep) : '.'}`);
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
  // 2b. "How has Sourav performed?", "what raise for Swapnil?": one person's work, counted by the CRM (HR-level users only)
  let summed = false;
  if (PERF.test(low) && (role === 'admin' || hasFunction(role, 'hr_manage') || canView('salaries', role))) {
    const who = people().filter(p => p.words.some(w => new RegExp(`\\b${w}\\b`).test(low)));
    if (who.length) { facts.push(workSummary(user, who, when, sources)); summed = true; }
  }
  // 3. records that match the specific words of the question ("Diwali", "Sourav", "Kerala"); a word found all over the CRM says nothing
  // (the module's own name and its field names, e.g. "state" in "enquiries per state", are not things to look for)
  const nameWords = named.flatMap(m => [m, ENTITIES[m].label, ENTITIES[m].singular || '', ...ENTITIES[m].fields.flatMap(f => [f.key.replace(/_id$/, ''), f.label || ''])].map(n => n.toLowerCase()));
  const words = [...new Set(low.match(/[\p{L}\p{N}][\p{L}\p{N}./-]{2,}/gu) || [])]
    .filter(w => !STOP.has(w) && !MONTHS.includes(w) && !/^20\d\d$/.test(w) && !(lowStock && /stock|low|item/.test(w)) && !nameWords.some(n => n.includes(w))).slice(0, 5);
  // WIESPL's own documents, for questions about products, norms and how things work (looked up first: when a
  // document clearly answers, records that merely share a word, e.g. "operation", would only be noise)
  let docs = [];
  if (!named.length && !lowStock && !summed) {
    try {
      docs = (await searchDocs(text, 3)).filter(h => h.score >= DOC_MIN);
      if (process.env.AI_DEBUG) console.log('[ai docs]', docs.map(h => `${h.title} ${h.score.toFixed(2)}`).join(', ') || 'none close enough');
    } catch { /* the search engine is still starting: the model can still use the tools */ }
  }
  const seen = new Set();
  if (summed || summedDept || docs.some(h => h.score >= 0.72)) words.length = 0;
  // two words side by side first ("electrical engineer", "door hardware"): far more telling than each word alone
  const order = low.match(/[\p{L}\p{N}][\p{L}\p{N}./-]{2,}/gu) || [];
  const pairs = words.length ? order.slice(1).map((w, i) => [order[i], w]).filter(p => p.every(w => words.includes(w))).map(p => p.join(' ')) : [];
  const covered = new Set();
  for (const w of [...pairs, ...words]) {
    if (covered.has(w)) continue;
    const found = [];
    for (const m of can) {
      if (NO_WORD_SEARCH.has(m) || !ENTITIES[m].search?.length) continue;
      let rows = []; try { rows = listRows(m, { q: w, limit: 4 }); } catch { continue; }
      rows = rows.filter(r => !seen.has(`${m}:${r.id}`));
      if (rows.length) found.push({ m, rows });
    }
    const n = found.reduce((s, f) => s + f.rows.length, 0);
    if (!n || n > 10) continue;
    for (const { m, rows } of found) {
      rows.forEach(r => { seen.add(`${m}:${r.id}`); sources.push({ module: m, id: r.id, label: `${ENTITIES[m].singular || ENTITIES[m].label} #${r.id}` }); });
      facts.push(`${ENTITIES[m].label} with "${w}":\n${table(m, rows, role)}`);
    }
    if (w.includes(' ')) w.split(' ').forEach(x => covered.add(x)); // found as a pair: no need for each word alone
  }
  for (const h of docs) { facts.push(`From WIESPL's document "${h.title}":\n${h.chunk.slice(0, 900)}`); sources.push({ doc: h.source, label: h.title }); }
  if (/\b(rate|rates|price|prices|cost|costs|value|valuation|worth)\b|किंमत|कीमत|दर\b/i.test(low) && !hasFunction(role, 'see_stock_value'))
    facts.unshift(`${user.name}'s role cannot see store prices, rates or stock value. If the question asks for one of those, say so plainly and give nothing else for it.`);
  let body = facts.join('\n\n');
  if (body.length > 5000) body = body.slice(0, 5000) + '\n…';
  const now = new Date();
  return `Today: ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${ymd(now)}). Asked by: ${user.name} (role ${role}).\n` +
    (body ? `Facts the CRM looked up for this question:\n${body}` : 'The CRM found no facts for this question by itself.') + `\n\nQuestion: ${text}`;
}

// ---------------------------------------------------------------- one record: a summary of it, or a message drafted from it
// "summarise enquiry E-12", "draft a reminder for PO 2026-27/104", "summarise this project" (on its screen). The CRM finds
// the record and the records linked to it (follow-ups, quotations, POs... only modules this role may see) and asks the
// model for a short summary or message, so it has nothing to look up.
const REC_WORDS = [['purchase_orders', /\b(po|p\.o\.|purchase orders?)\b/i], ['quotations', /\bquot(e|es|ation|ations)\b/i], ['enquiries', /\b(enquir|inquir)\w*/i],
  ['projects', /\bprojects?\b/i], ['service_tickets', /\b(complaints?|tickets?|service calls?)\b/i], ['invoices', /\binvoices?\b/i], ['sales_orders', /\bsales orders?\b/i],
  ['vendors', /\b(vendors?|suppliers?)\b/i], ['customers', /\b(customers?|clients?)\b/i]].filter(([m]) => ENTITIES[m]);
const SUMMARY = /\b(summar\w*|overview|brief me|status of|update on|history of|tell me about)\b|सारांश|थोडक्यात|सार/i;
const DRAFT = /\b(draft|write|compose|prepare|make)\b.{0,40}\b(message|msg|mail|email|whatsapp|reminder|follow[- ]?up|letter|note|reply)\b|\b(reminder|follow[- ]?up) (message|mail|email|note)\b|संदेश|मेसेज|मैसेज/i;
const TASK_WORDS = /^(summar\w*|overview|brief|status|update|history|tell|about|draft|write|compose|prepare|make|message|msg|mail|email|whatsapp|reminder|follow|followup|follow-up|letter|note|reply|vendor|client|customer|send|polite|short|hindi|marathi|english)$/i;
function findRecord(text, screen, role) {
  const onScreen = /^#\/view\/(\w+)\/(\d+)/.exec(screen || '') || (/^#\/materials\/(\d+)/.exec(screen || '') && ['', 'projects', /^#\/materials\/(\d+)/.exec(screen)[1]]);
  const named = REC_WORDS.find(([, re]) => re.test(text))?.[0];
  const module = named || (onScreen && ENTITIES[onScreen[1]] ? onScreen[1] : null);
  if (!module) return null;
  if (!canView(module, role)) return { module, denied: true };
  const ent = ENTITIES[module], get = id => { try { return getRow(module, Number(id)); } catch { return null; } };
  const words = (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}./_-]*/gu) || []).filter(w => !STOP.has(w.toLowerCase()) && !TASK_WORDS.test(w) && !REC_WORDS.some(([, re]) => re.test(w)) && !/^(this|these|current|here|it|for|of|the|a|an|to|on|with|in|please)$/i.test(w));
  const ids = words.filter(w => /\d/.test(w)), names = words.filter(w => !/\d/.test(w) && w.length > 2);
  if (onScreen?.[1] === module && (/\b(this|current|here)\b/i.test(text) || !ids.length && !names.length)) { const r = get(onScreen[2]); if (r) return { module, row: r }; }
  for (const w of ids) { try { const r = listRows(module, { q: w, limit: 1 })[0]; if (r) return { module, row: getRow(module, r.id) }; } catch { /* next */ } if (/^\d+$/.test(w)) { const r = get(w); if (r) return { module, row: r }; } }
  if (names.length) { try { const r = listRows(module, { q: names.join(' '), limit: 1 })[0] || names.map(w => listRows(module, { q: w, limit: 1 })[0]).find(Boolean); if (r) return { module, row: getRow(module, r.id) }; } catch { /* none */ } }
  if (onScreen?.[1] === module) { const r = get(onScreen[2]); if (r) return { module, row: r }; }
  return { module, row: null, ent };
}
function recordFacts(module, row, role, sources) {
  const ent = ENTITIES[module], name = ent.singular || ent.label;
  const rec = cleanRow(module, row, role, true);
  let out = `${name} #${row.id}:\n` + Object.entries(rec).filter(([k]) => k !== 'id').map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n').slice(0, 1800);
  sources.push({ module, id: row.id, label: `${name} #${row.id}` });
  if (module === 'purchase_orders') { // what the vendor still has to send (quantities only)
    let ls = row.lines; try { if (typeof ls === 'string') ls = JSON.parse(ls); } catch { ls = []; }
    const pend = (Array.isArray(ls) ? ls : []).filter(l => Number(l.qty) > 0 && (Number(l.received) || 0) < Number(l.qty)).slice(0, 12);
    if (pend.length) out += `\nStill to be delivered:\n` + pend.map(l => `- ${String(l.description || l.item_id_label || l.spec || 'item').split('\n')[0].slice(0, 70)}: ${Number(l.qty) - (Number(l.received) || 0)} ${l.uom || ''}${l.promised ? ` (promised ${l.promised})` : ''}`).join('\n');
  }
  let n = 0; // records linked to it: follow-ups, quotations, POs, tickets...
  for (const m of viewable(role)) {
    if (n >= 4 || m === module || NO_WORD_SEARCH.has(m)) continue;
    const f = ENTITIES[m].fields.find(x => x.type === 'ref' && x.ref === module && !x.computed); if (!f) continue;
    let rows = []; try { rows = listRows(m, { [f.key]: row.id, limit: 4 }).filter(r => Number(r[f.key]) === Number(row.id)); } catch { continue; }
    if (!rows.length) continue;
    n++; out += `\n\nLinked ${ENTITIES[m].label} (newest first):\n${table(m, rows, role, 5)}`;
  }
  return out.slice(0, 4000);
}
function replyLang(text, lang) {
  const t = String(text);
  const asked = /\b(?:in|into)\s+(hindi|marathi|english)\b/i.exec(t)?.[1];
  if (asked) return asked[0].toUpperCase() + asked.slice(1).toLowerCase();
  if (/[ऀ-ॿ]/.test(t)) return /(आहे|आहेत|काय|कोणत|मला|माझ|झाल|किती|नाही|साठी|करायच|द्या|सांग)/.test(t) ? 'Marathi' : 'Hindi';
  if (/\b(kya|hai|kitne|kitna|mujhe|batao|kaun|kaise|chahiye)\b/i.test(t)) return 'Hindi';
  if (/\b(kay|aahe|ahe|kiti|sanga|mala|kuthe)\b/i.test(t)) return 'Marathi';
  return lang === 'mr' ? 'Marathi' : null;
}
async function focusContext(user, text, screen, sources) {
  const draft = DRAFT.test(text), summary = !draft && SUMMARY.test(text);
  if (!draft && !summary) return null;
  const hit = findRecord(text, screen, user.role); if (!hit) return null;
  if (hit.denied) return { direct: `Your role cannot see ${ENTITIES[hit.module].label}.` };
  const ent = ENTITIES[hit.module], name = (ent.singular || ent.label).toLowerCase();
  if (!hit.row) return { direct: `Which ${name}? Give its number or name, e.g. "${draft ? 'draft a reminder for' : 'summarise'} ${name} 12", or open it and ask "${draft ? 'draft a message for' : 'summarise'} this ${name}".` };
  const facts = recordFacts(hit.module, hit.row, user.role, sources);
  const to = hit.module === 'purchase_orders' || hit.module === 'vendors' ? 'vendor' : 'client';
  const what = /remind/i.test(text) || hit.module === 'purchase_orders' ? (hit.module === 'purchase_orders' ? 'a polite reminder to deliver the pending items, asking for the dispatch date' : 'a polite reminder') : 'a polite follow-up';
  const task = draft
    ? `Task: write ${what} as a short ${/\b(e-?mail|mail|letter)\b/i.test(text) ? 'email' : 'WhatsApp message'} from ${user.name}, WIESPL, to the ${to} about this ${name}. Mention its number and the key facts${to === 'vendor' ? ' (the items and quantities still due; no amounts or payment terms)' : ''}. At most 90 words. Write only the message, no notes.`
    : `Task: summarise this ${name} for a colleague in at most 5 short bullet points: what it is and for whom, where it stands now, what is pending or late, and the next step. Use only these facts.`;
  const now = new Date();
  return { prompt: `Today: ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} (${ymd(now)}). Asked by: ${user.name} (role ${user.role}).\nThe facts are complete: do not use tools.\n${facts}\n\n${task}\n\nQuestion: ${text}` };
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
  const screen = String(b.screen || '').slice(0, 120), lang = String(b.lang || '').slice(0, 5);
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
  let quick = null, focus = null, question = '';
  try {
    // the day's work (My tasks, approvals, POs to chase, material, late steps): written by the CRM at once
    quick = await workAnswer(user, text, screen, sources);
    // a summary of one record, or a message drafted from it: the record and its linked records go with the question
    if (!quick) { focus = await focusContext(user, text, screen, sources); if (focus?.direct) quick = focus.direct; }
  } catch (e) { console.error('AI: quick answer failed', e.message); quick = null; focus = null; }
  if (!quick) {
    question = focus?.prompt || await questionContext(user, text, sources);
    // The small model on the office PC reads Hindi and Marathi well but writes them poorly: it answers those questions in
    // simple English unless the person asks for the language in words ("in Marathi"), or the admin set a bigger model.
    const l = replyLang(text, lang), asked = /\b(?:in|into)\s+(hindi|marathi)\b|(हिंदी|हिन्दी|मराठी)\s*(में|मध्ये|त)/i.test(text);
    if (l && l !== 'English' && (asked || !/3b|1\.5b|0\.5b/i.test(cfg.model))) question += `\n(Answer in ${l}${focus ? '' : '; keep record numbers and names as they are'}.)`;
    else if (l && l !== 'English') question += '\n(Answer in simple English.)';
  }
  if (process.env.AI_DEBUG) console.log('[ai question]', question.slice(0, 700).replace(/\n/g, ' | '));
  const messages = [{ role: 'system', content: systemPrompt() }, ...past, { role: 'user', content: question }];
  const tools = TOOLS.map(t => ({ type: 'function', function: t }));
  const LABEL = { search_everything: 'Searching the CRM', describe_module: 'Reading the module', find_records: 'Looking up records', get_record: 'Opening a record', summarize: 'Counting', search_documents: 'Searching WIESPL documents' };
  let answer = '', failed = '', items = [];
  try {
    if (quick) { answer = quick; send({ type: 'token', text: quick }); }
    else send({ type: 'status', text: focus ? 'Writing…' : 'Thinking…' });
    for (let round = 0; !quick && round < 5; round++) {
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
    ? await post(cfg.url, '/api/chat', { model: cfg.model, messages, tools, stream: true, options: { temperature: 0.3, top_p: 0.8, top_k: 20, num_ctx: 8192, num_predict: 700 } }, signal)
    : await post(cfg.url, '/v1/chat/completions', { messages, tools, stream: true, temperature: 0.3, top_p: 0.8, top_k: 20, max_tokens: 700, cache_prompt: true }, signal);
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
