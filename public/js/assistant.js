// 🤖 WIESPL Assistant: a chat panel on every screen. Questions go to the CRM server, which asks the AI model running on a
// WIESPL machine (server/ai.js); the answer streams back with the records and documents it used. Voice: speak a
// question (speech to text on the company's own speech server, if set up) and hear the answer (the PC's own voices).
// Admins: ⚙ sets the AI server, the models and the document library.
import { h, api, state, toast, fail, modal } from './ui.js';
import { ENTITIES } from './schema.js';

const KEY = 'wiespl-ai-chat';
let panel, log, input, sendBtn, micBtn, speakBtn, statusLine, messages = [], busy = false, speak = false, ai = null;
const load = () => { try { messages = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { messages = []; } };
const keep = () => { try { sessionStorage.setItem(KEY, JSON.stringify(messages.slice(-30))); } catch { /* private mode */ } };

// a little Markdown: **bold**, `code`, lists, tables, line breaks
function md(text) {
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = text.split('\n'), out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) { // a table
      const row = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue; }
    if (/^#{1,4}\s/.test(l)) { out.push(`<p><b>${inline(l.replace(/^#+\s/, ''))}</b></p>`); i++; continue; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : ''); i++;
  }
  return out.join('');
}
function bubble(m) {
  const b = h('div.ai-msg.' + m.role);
  if (m.role === 'user') b.textContent = m.content; else b.innerHTML = md(m.content || '');
  if (m.sources?.length) b.append(h('div.ai-src', 'From: ', m.sources.map(s => s.module && s.id ? h('a', { href: `#/view/${s.module}/${s.id}` }, s.label) : h('span', s.label || ENTITIES[s.module]?.label || s.doc))));
  return b;
}
function render() {
  log.replaceChildren(...(messages.length ? messages.map(bubble) : [h('div.ai-hello',
    h('b', `Hello ${state.user?.name?.split(' ')[0] || ''} 👋`),
    h('p', 'Ask about enquiries, customers, projects, stock, POs or service, or about WIESPL products and NABH norms. I only see what your role can see, and everything stays on WIESPL\'s own computers.'),
    ['Open enquiries from Kerala this month', 'Enquiries per state this year', 'Which items are low in stock?', 'What is a hermetic sliding door?'].map(q => h('button.btn.small', { type: 'button', onclick: () => ask(q) }, q)))]));
  log.scrollTop = log.scrollHeight;
}

async function ask(text) {
  text = String(text || '').trim(); if (!text || busy) return;
  busy = true; sendBtn.disabled = true; input.value = '';
  messages.push({ role: 'user', content: text }); keep(); render();
  const reply = { role: 'assistant', content: '' }, el = bubble(reply), status = h('div.ai-status', 'Thinking…');
  el.append(status); log.append(el); log.scrollTop = log.scrollHeight;
  try {
    const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Request failed (${res.status})`); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'token') { reply.content += ev.text; status.remove(); el.innerHTML = md(reply.content); }
        else if (ev.type === 'reset') { reply.content = ''; el.innerHTML = ''; }
        else if (ev.type === 'status') { status.textContent = ev.text; if (!status.isConnected) el.append(status); }
        else if (ev.type === 'sources') reply.sources = ev.items;
        else if (ev.type === 'error') throw new Error(ev.text);
        log.scrollTop = log.scrollHeight;
      }
    }
    if (!reply.content.trim()) reply.content = 'I could not find an answer to that.';
    messages.push(reply); keep();
    el.replaceWith(bubble(reply));
    if (speak) say(reply.content);
  } catch (e) {
    status.remove(); el.classList.add('err'); el.textContent = '⚠️ ' + (e.message || e);
  } finally { busy = false; sendBtn.disabled = false; input.focus(); log.scrollTop = log.scrollHeight; }
}

// ---- voice
function say(text) {
  if (!window.speechSynthesis) return;
  const plain = text.replace(/\|/g, ' ').replace(/[*`#>-]/g, ' ').replace(/\s+/g, ' ').slice(0, 900);
  const u = new SpeechSynthesisUtterance(plain), v = speechSynthesis.getVoices().filter(x => x.localService); // the PC's own voices: nothing goes online
  u.voice = v.find(x => /en-IN/i.test(x.lang)) || v.find(x => /^en/i.test(x.lang)) || v[0] || null; u.rate = 1;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
let rec = null;
async function toggleMic() {
  if (rec) { rec.stop(); return; }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone not allowed', true); }
  const chunks = []; rec = new MediaRecorder(stream);
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); micBtn.classList.remove('on'); rec = null;
    try {
      micBtn.disabled = true;
      const wav = await toWav(new Blob(chunks));
      const r = await api('/ai/voice', { method: 'POST', raw: wav });
      if (r.text) ask(r.text); else toast('I did not catch that', true);
    } catch (e) { fail(e); } finally { micBtn.disabled = false; }
  };
  rec.start(); micBtn.classList.add('on'); toast('Listening… tap 🎤 again to stop');
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

// ---- admin: the AI server, the models and the document library
async function settings() {
  let s = await api('/ai/status');
  const f = { ai_url: s.builtIn ? '' : s.url, ai_model: s.builtIn ? '' : s.model, ai_embed_model: s.builtIn ? '' : s.embed, ai_whisper_url: s.whisper || '' };
  const field = (k, label, hint) => h('label.ai-field', h('span', label), h('input', { value: f[k], oninput: e => (f[k] = e.target.value) }), hint ? h('small.muted', hint) : null);
  const docs = h('div.ai-docs'), info = h('div.ai-info');
  const showInfo = () => info.replaceChildren(
    h('div', s.ok ? (s.builtIn ? `🟢 Built-in AI engine running on this server · ${s.model}` : '🟢 AI server reachable') : `🔴 ${s.error || 'AI server not reachable'}`),
    s.builtIn ? null : h('div', s.chatModel ? `🟢 Chat model ${s.model} installed` : `🔴 Chat model ${s.model} missing: run  ollama pull ${s.model}`),
    h('div', s.embedModel ? `🟢 Search model ${s.embed} ready` : s.builtIn ? '🟡 Search model loading…' : `🔴 Search model ${s.embed} missing: run  ollama pull ${s.embed}`),
    h('div', `📚 ${s.chunks} passages from ${s.sources} documents indexed${s.indexing ? ' · indexing now…' : ''}`),
    h('div', s.voice ? '🎤 Voice: speech server set' : '🎤 Voice: not set up (optional)'));
  const showDocs = () => docs.replaceChildren(h('b', 'Document library'), h('p.muted', 'PDFs, text or Markdown files the assistant may quote: manuals, brochures, SOPs, price policies. Then press "Re-index".'),
    s.files.length ? h('ul', s.files.map(d => h('li', `${d.name} · ${(d.size / 1024).toFixed(0)} KB `, h('button.btn.small', { type: 'button', onclick: async () => { await api('/ai/docs/' + encodeURIComponent(d.name), { method: 'DELETE' }); s = await api('/ai/status'); showDocs(); } }, '🗑')))) : h('p.muted', 'No documents yet.'),
    h('input', { type: 'file', multiple: true, accept: '.pdf,.txt,.md,.csv,.json,.html', onchange: async e => { for (const file of e.target.files) { try { await api('/ai/docs?name=' + encodeURIComponent(file.name), { method: 'POST', raw: new Uint8Array(await file.arrayBuffer()) }); } catch (err) { fail(err); } } s = await api('/ai/status'); showDocs(); toast('Added. Press Re-index.'); } }));
  showInfo(); showDocs();
  await modal('🤖 AI Assistant', h('div.ai-settings', info,
    field('ai_url', 'Ollama server instead (optional)', 'Leave empty for the CRM’s built-in AI engine. To use Ollama on a PC with a graphics card: http://<its address>:11434'),
    field('ai_model', 'Ollama chat model', 'Only with Ollama: e.g. qwen2.5:7b on a PC with a graphics card'),
    field('ai_embed_model', 'Ollama search model', 'Only with Ollama: nomic-embed-text'),
    field('ai_whisper_url', 'Speech server (optional)', 'A whisper.cpp server on a WIESPL PC, e.g. http://127.0.0.1:8178'),
    docs), [
    { label: '🔄 Re-index documents', action: async () => { await api('/ai/reindex', { method: 'POST' }); toast('Indexing… this can take a few minutes'); return false; } },
    { label: 'Close' },
    { label: 'Save', cls: 'primary', action: async () => { await api('/ai/settings', { method: 'PUT', body: f }); s = await api('/ai/status'); showInfo(); toast('Saved'); return false; } },
  ], { wide: true });
}

export async function initAssistant() {
  if (panel) return;
  try { ai = await api('/ai/status'); } catch (e) { if (/not found|404/i.test(e.message)) return; } // a server without the assistant yet: no button
  load();
  const fab = h('button.ai-fab', { type: 'button', title: 'WIESPL Assistant', 'aria-label': 'Open the WIESPL Assistant', onclick: () => open(!panel.classList.contains('open')) }, '🤖');
  log = h('div.ai-log');
  input = h('textarea', { rows: 1, placeholder: 'Ask anything…', onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } } });
  sendBtn = h('button.btn.primary', { type: 'button', onclick: () => ask(input.value) }, 'Send');
  micBtn = h('button.btn.ai-mic.hidden', { type: 'button', title: 'Speak your question', onclick: toggleMic }, '🎤');
  speakBtn = h('button.btn.small', { type: 'button', title: 'Read the answers aloud', onclick: () => { speak = !speak; speakBtn.classList.toggle('on', speak); if (!speak) speechSynthesis?.cancel(); } }, '🔊');
  statusLine = h('small.ai-state');
  panel = h('section.ai-panel', { 'aria-label': 'WIESPL Assistant' },
    h('header', h('b', '🤖 WIESPL Assistant'), statusLine, h('span.grow'), speakBtn,
      state.user?.role === 'admin' ? h('button.btn.small', { type: 'button', title: 'AI settings and documents', onclick: () => settings().catch(fail) }, '⚙') : null,
      h('button.btn.small', { type: 'button', title: 'New conversation', onclick: () => { messages = []; keep(); render(); } }, '🧹'),
      h('button.btn.small', { type: 'button', 'aria-label': 'Close', onclick: () => open(false) }, '✕')),
    log, h('div.ai-input', micBtn, input, sendBtn));
  document.body.append(fab, panel);
  render();
  function open(on) {
    panel.classList.toggle('open', on);
    if (on) { input.focus(); refresh(); }
  }
  window.addEventListener('logged-out', () => { messages = []; keep(); panel.classList.remove('open'); });
}
async function refresh() {
  try { ai = await api('/ai/status'); } catch { ai = { ok: false }; }
  statusLine.textContent = ai.ok && ai.chatModel !== false ? '· on WIESPL server' : '· AI server offline';
  statusLine.classList.toggle('bad', !(ai.ok && ai.chatModel !== false));
  micBtn.classList.toggle('hidden', !ai.voice || !window.MediaRecorder);
}
