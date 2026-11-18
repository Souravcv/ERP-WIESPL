// WIESPL AI, shared by the chat panel on every screen (assistant.js) and the AI page (views/ai.js): asking (the answer
// streams in word by word), showing answers with the records they came from, ideas to start with, voice, and the admin
// settings. The AI itself runs on WIESPL's own computer (server/ai.js); conversations are kept there, one person's own.
import { h, api, state, toast, fail, modal } from './ui.js';
import { ENTITIES, canView } from './schema.js';

// ---- a little Markdown: **bold**, `code`, lists, tables, headings (everything escaped first)
export function md(text) {
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(text || '').split('\n'), out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) { // a table
      const row = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="ai-table"><table><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`); continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*•]\s+/, ''))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`); out.push(`<ol>${items.join('')}</ol>`); continue; }
    if (/^#{1,4}\s/.test(l)) { out.push(`<p class="ai-h">${inline(l.replace(/^#+\s/, ''))}</p>`); i++; continue; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : ''); i++;
  }
  return out.join('');
}

// ---- asking: onEvent gets {type: conversation | status | token | reset | sources | done | error, ...}
export async function ask({ text, conversation, signal, onEvent }) {
  const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    // the screen it is asked on ("summarise this enquiry") and the screen language (Marathi → answers in Marathi where the model can)
    body: JSON.stringify({ text, ...(conversation ? { conversation } : {}), screen: location.hash, lang: (() => { try { return localStorage.getItem('wiespl-lang') || 'en'; } catch { return 'en'; } })() }) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Request failed (${res.status})`); }
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) onEvent(JSON.parse(line)); }
  }
}

// ---- one message: the question, or the answer with where it came from
const srcLink = s => s.module && s.id ? h('a.ai-chip', { href: `#/view/${s.module}/${s.id}` }, s.label)
  : s.module ? h('a.ai-chip', { href: `#/list/${s.module}` }, `📋 ${s.label || ENTITIES[s.module]?.label || s.module}`)
  : h('span.ai-chip', `📄 ${s.label || s.doc}`);
export function messageEl(m) {
  const b = h('div.ai-msg.' + m.role + (m.error ? '.err' : ''));
  if (m.role === 'user') { b.textContent = m.content; return b; }
  const body = h('div.ai-body'); body.innerHTML = md(m.content); b.append(body);
  if (m.sources?.length) b.append(h('div.ai-src', h('span.muted', 'From'), m.sources.map(srcLink)));
  if (m.content) b.append(h('div.ai-foot',
    h('button.ai-mini', { type: 'button', title: 'Copy the answer', onclick: () => navigator.clipboard?.writeText(m.content).then(() => toast('Copied'), () => toast('Could not copy', true)) }, '📋 Copy'),
    h('button.ai-mini', { type: 'button', title: 'Read the answer aloud', onclick: () => say(m.content) }, '🔊 Read'),
    m.at || m.seconds ? h('small.muted', [m.at ? m.at.slice(11, 16) : '', m.seconds ? `answered in ${m.seconds} s` : ''].filter(Boolean).join(' · ')) : null));
  return b;
}
// the answer while it is being written: what the AI is doing (with a clock), then the words as they come
export function liveAnswer() {
  const reply = { role: 'assistant', content: '', sources: [] };
  const body = h('div.ai-body'), txt = h('span', 'Thinking…'), secs = h('span.ai-secs', '0 s');
  const line = h('div.ai-status', h('span.ai-spin'), txt, secs), el = h('div.ai-msg.assistant.live', body, line);
  const t0 = Date.now(), timer = setInterval(() => { secs.textContent = `${Math.round((Date.now() - t0) / 1000)} s`; }, 500);
  return {
    el, reply,
    on(ev) {
      if (ev.type === 'token') { reply.content += ev.text; body.innerHTML = md(reply.content); line.classList.add('hidden'); }
      else if (ev.type === 'reset') { reply.content = ''; body.replaceChildren(); line.classList.remove('hidden'); }
      else if (ev.type === 'status') { txt.textContent = ev.text; if (!reply.content) line.classList.remove('hidden'); }
      else if (ev.type === 'sources') reply.sources = ev.items || [];
      else if (ev.type === 'done') reply.seconds = ev.seconds;
      else if (ev.type === 'error') throw new Error(ev.text);
    },
    stop() { clearInterval(timer); reply.seconds ??= Math.round((Date.now() - t0) / 1000); reply.at = new Date().toLocaleString('sv-SE').slice(0, 16); },
  };
}

// ---- ideas to start with, only for what this person's role can see
const IDEAS = [
  ['🗓️ My work', [[null, 'What should I do today?'], [null, 'Which approvals are waiting for me?'], ['purchase_orders', 'Which POs are late?'], [null, 'What is late?']]],
  ['📈 Sales', [['enquiries', 'Show the enquiries from this month'], ['enquiries', 'How many enquiries per state this year?'], ['quotations', 'Show the latest 5 quotations'], ['enquiries', 'Which enquiries are still New?']]],
  ['🏗️ Projects & service', [['projects', 'Which projects are active now?'], ['service_tickets', 'Show the open complaints'], ['invoices', 'Which invoices are not paid yet?']]],
  ['📦 Purchase & store', [['items', 'Which items are low in stock?'], ['purchase_orders', 'Show the purchase orders from this month'], ['purchase_orders', 'Purchase order value per vendor this year'], ['vendors', 'Which vendors are approved?']]],
  ['👥 HR', [['holidays', 'Which holidays are coming up?'], ['holidays', 'How many days off for Diwali?'], ['leave_requests', 'Show the pending leave requests'], ['attendance', 'Attendance summary for this month']]],
  ['📚 WIESPL products & norms', [[null, 'What door types does WIESPL make?'], [null, 'What is a hermetic sliding door?'], [null, 'NABH air changes per hour for an operation theatre'], [null, 'What does a laminar air flow (LAF) do?']]],
];
// questions for the screen the person is on: a record (summary, a message drafted from it) or a list
const RECORD_IDEAS = {
  enquiries: ['Summarise this enquiry', 'Draft a follow-up message to the client for this enquiry'],
  quotations: ['Summarise this quotation', 'Draft a follow-up message to the client for this quotation'],
  purchase_orders: ['Summarise this PO', 'Draft a reminder to the vendor for this PO'],
  projects: ['Summarise this project', 'Pending material for this project'],
  service_tickets: ['Summarise this complaint', 'Draft a message to the client about this complaint'],
  invoices: ['Summarise this invoice'],
  customers: ['Summarise this client'], vendors: ['Summarise this vendor'],
};
const LIST_IDEAS = { purchase_orders: ['Which POs are late?'], enquiries: ['Show the enquiries from this month', 'Which enquiries are still New?'], items: ['Which items are low in stock?'], approvals: ['Which approvals are waiting for me?'], projects: ['Which projects are active now?'] };
export function screenIdeas(hash = location.hash, role = state.user?.role) {
  const rec = /^#\/(?:view|edit)\/(\w+)\/\d+/.exec(hash), list = /^#\/list\/(\w+)/.exec(hash);
  if (rec && canView(rec[1], role)) return RECORD_IDEAS[rec[1]] || ['Summarise this record'];
  if (/^#\/materials\/\d+/.test(hash)) return ['Pending material for this project', 'Summarise this project'];
  if (/^#\/(materials|po-tracker)/.test(hash)) return ['Which POs are late?'];
  if (/^#\/journey/.test(hash)) return ['What is late?', 'Which approvals are waiting for me?'];
  if (list && canView(list[1], role)) return LIST_IDEAS[list[1]] || [];
  return [];
}
export const ideas = (role = state.user?.role) => IDEAS.map(([group, qs]) => [group, qs.filter(([m]) => !m || canView(m, role)).map(([, q]) => q)]).filter(([, qs]) => qs.length);

// ---- status of the AI (cached for a few seconds)
let statusAt = 0, statusVal = null;
export async function aiStatus(force = false) {
  if (!force && statusVal && Date.now() - statusAt < 5000) return statusVal;
  try { statusVal = await api('/ai/status'); } catch (e) { statusVal = { ok: false, error: e.message, missing: /not found|404/i.test(e.message) }; }
  statusAt = Date.now(); return statusVal;
}
export const statusText = s => s.ok && s.chatModel !== false ? 'Ready · runs on WIESPL’s own computer' : s.error && /starting|loading/i.test(s.error) ? 'Starting… (about a minute)' : 'Offline';

// ---- voice: answers read aloud by the PC's own voices; questions spoken into the company's own speech server
export function say(text) {
  if (!window.speechSynthesis) return toast('This browser cannot read aloud', true);
  const plain = String(text).replace(/\|/g, ' ').replace(/[*`#>]/g, ' ').replace(/\s+/g, ' ').slice(0, 1200);
  const u = new SpeechSynthesisUtterance(plain), v = speechSynthesis.getVoices().filter(x => x.localService); // the PC's own voices: nothing goes online
  u.voice = v.find(x => /en-IN/i.test(x.lang)) || v.find(x => /^en/i.test(x.lang)) || v[0] || null; u.rate = 1;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
export const hush = () => window.speechSynthesis?.cancel();
// a 🎤 button: tap to speak, tap again to stop; the words go to onText
export function micButton(onText) {
  let rec = null;
  const btn = h('button.btn.ai-mic', { type: 'button', title: 'Speak your question', onclick: async () => {
    if (rec) { rec.stop(); return; }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone not allowed', true); }
    const chunks = []; rec = new MediaRecorder(stream);
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); btn.classList.remove('on'); rec = null;
      try { btn.disabled = true; const r = await api('/ai/voice', { method: 'POST', raw: await toWav(new Blob(chunks)) }); if (r.text) onText(r.text); else toast('I did not catch that', true); }
      catch (e) { fail(e); } finally { btn.disabled = false; }
    };
    rec.start(); btn.classList.add('on'); toast('Listening… tap 🎤 again to stop');
  } }, '🎤');
  return btn;
}
async function toWav(blob) { // 16 kHz mono 16-bit, what the speech server reads
  const ac = new AudioContext(), buf = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000), src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0), out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(out.buffer);
}

// ---- admin: the AI engine, the models and the document library
export async function aiSettings() {
  let s = await aiStatus(true);
  const f = { ai_url: s.builtIn ? '' : s.url, ai_model: s.builtIn ? '' : s.model, ai_embed_model: s.builtIn ? '' : s.embed, ai_whisper_url: s.whisper || '' };
  const field = (k, label, hint) => h('label.ai-field', h('span', label), h('input', { value: f[k], oninput: e => (f[k] = e.target.value) }), hint ? h('small.muted', hint) : null);
  const docs = h('div.ai-docs'), info = h('div.ai-info');
  const showInfo = () => info.replaceChildren(
    h('div', s.ok ? (s.builtIn ? `🟢 Built-in AI engine running on this server · ${s.model}` : '🟢 AI server reachable') : `🔴 ${s.error || 'AI server not reachable'}`),
    s.builtIn ? null : h('div', s.chatModel ? `🟢 Chat model ${s.model} installed` : `🔴 Chat model ${s.model} missing: run  ollama pull ${s.model}`),
    h('div', s.embedModel ? `🟢 Search model ${s.embed} ready` : s.builtIn ? '🟡 Search model loading…' : `🔴 Search model ${s.embed} missing: run  ollama pull ${s.embed}`),
    h('div', `📚 ${s.chunks} passages from ${s.sources} documents indexed${s.indexing ? ' · indexing now…' : ''}`),
    h('div', s.voice ? '🎤 Voice: speech server set' : '🎤 Voice: not set up (optional)'));
  const showDocs = () => docs.replaceChildren(h('b', 'Document library'), h('p.muted', 'PDFs, text or Markdown files the AI may quote: manuals, brochures, SOPs, price policies. Then press "Re-index". Scanned PDFs (pictures of pages) cannot be read yet.'),
    s.files?.length ? h('ul', s.files.map(d => h('li', `${d.name} · ${(d.size / 1024).toFixed(0)} KB `, h('button.btn.small', { type: 'button', title: 'Remove', onclick: async () => { await api('/ai/docs/' + encodeURIComponent(d.name), { method: 'DELETE' }); s = await aiStatus(true); showDocs(); } }, '🗑')))) : h('p.muted', 'No documents yet.'),
    h('input', { type: 'file', multiple: true, accept: '.pdf,.txt,.md,.csv,.json,.html', onchange: async e => { for (const file of e.target.files) { try { await api('/ai/docs?name=' + encodeURIComponent(file.name), { method: 'POST', raw: new Uint8Array(await file.arrayBuffer()) }); } catch (err) { fail(err); } } s = await aiStatus(true); showDocs(); toast('Added. Press Re-index.'); } }));
  showInfo(); showDocs();
  await modal('🤖 WIESPL AI settings', h('div.ai-settings', info,
    field('ai_url', 'Ollama server instead (optional)', 'Leave empty for the CRM’s built-in AI engine. To use Ollama on a PC with a graphics card: http://<its address>:11434'),
    field('ai_model', 'Ollama chat model', 'Only with Ollama: e.g. qwen3:8b on a PC with a graphics card'),
    field('ai_embed_model', 'Ollama search model', 'Only with Ollama: nomic-embed-text'),
    field('ai_whisper_url', 'Speech server (optional)', 'A whisper.cpp server on a WIESPL PC, e.g. http://127.0.0.1:8178'),
    docs), [
    { label: '🔄 Re-index documents', action: async () => { await api('/ai/reindex', { method: 'POST' }); toast('Indexing… this can take a few minutes'); return false; } },
    { label: 'Close' },
    { label: 'Save', cls: 'primary', action: async () => { await api('/ai/settings', { method: 'PUT', body: f }); s = await aiStatus(true); showInfo(); toast('Saved'); return false; } },
  ], { wide: true });
}
