// 🤖 WIESPL AI, the quick chat panel on every screen (the full page is #/ai, views/ai.js). The conversation is kept on
// the server like the page's, so "⤢" opens it there. Shared parts (asking, answers, voice, settings): ai-core.js.
import { h, api, state, fail } from './ui.js';
import { ask, messageEl, liveAnswer, ideas, screenIdeas, aiStatus, statusText, aiSettings, micButton, say, hush } from './ai-core.js';

const KEY = 'wiespl-ai-conversation';
let panel, log, input, sendBtn, stopBtn, mic, speakBtn, statusLine, conv = null, busy = false, speak = false, ctl = null;
const savedId = () => { try { return Number(sessionStorage.getItem(KEY)) || null; } catch { return null; } };
const keepId = id => { try { id ? sessionStorage.setItem(KEY, String(id)) : sessionStorage.removeItem(KEY); } catch { /* private mode */ } };

function render() {
  if (!conv?.messages?.length) {
    // this screen's questions first, then the day's work, then one per topic
    const first = [...new Set([...screenIdeas(), ...(ideas()[0]?.[1] || []).slice(0, 2), ...ideas().flatMap(([, qs]) => qs.slice(0, 1))])].slice(0, 5);
    log.replaceChildren(h('div.ai-hello',
      h('b', `Hello ${state.user?.name?.split(' ')[0] || ''} 👋`),
      h('p', 'Ask about enquiries, customers, projects, stock, POs or service, or about WIESPL products and NABH norms. I only see what your role can see, and everything stays on WIESPL’s own computers.'),
      first.map(q => h('button.btn.small', { type: 'button', onclick: () => send(q) }, q))));
    return;
  }
  log.replaceChildren(...conv.messages.map(messageEl)); log.scrollTop = log.scrollHeight;
}
async function load() {
  const id = savedId(); if (!id || conv?.id === id) return render();
  try { conv = await api('/ai/conversations/' + id); } catch { conv = null; keepId(null); }
  render();
}
async function send(text) {
  text = String(text || '').trim(); if (!text || busy) return;
  busy = true; input.value = ''; sendBtn.classList.add('hidden'); stopBtn.classList.remove('hidden');
  conv ||= { id: null, title: text.slice(0, 80), messages: [] };
  conv.messages.push({ role: 'user', content: text }); render();
  const live = liveAnswer(); log.append(live.el); log.scrollTop = log.scrollHeight;
  const mine = ctl = new AbortController();
  try {
    await ask({ text, conversation: conv.id, signal: mine.signal, onEvent: ev => { if (ev.type === 'conversation') { conv.id = ev.id; keepId(ev.id); } live.on(ev); log.scrollTop = log.scrollHeight; } });
    live.stop();
    if (!live.reply.content.trim()) live.reply.content = 'I could not find an answer to that.';
    conv.messages.push(live.reply); live.el.replaceWith(messageEl(live.reply));
    if (speak) say(live.reply.content);
  } catch (e) {
    live.stop();
    const m = mine.signal.aborted ? { ...live.reply, content: live.reply.content.trim() ? live.reply.content + ' …' : '(stopped)' } : { role: 'assistant', content: '⚠️ ' + (e.message || e), error: true };
    conv.messages.push(m); live.el.replaceWith(messageEl(m));
  } finally {
    if (ctl === mine) ctl = null;
    busy = false; stopBtn.classList.add('hidden'); sendBtn.classList.remove('hidden'); input.focus(); log.scrollTop = log.scrollHeight;
  }
}

export async function initAssistant() {
  if (panel) return;
  const s = await aiStatus(); if (s.missing) return; // a server without the AI yet: no button
  const fab = h('button.ai-fab', { type: 'button', title: 'WIESPL AI', 'aria-label': 'Open the WIESPL Assistant', onclick: () => open(!panel.classList.contains('open')) }, '🤖');
  log = h('div.ai-log');
  input = h('textarea', { rows: 1, placeholder: 'Ask anything…', onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } if (e.key === 'Escape') ctl?.abort(); } });
  sendBtn = h('button.btn.primary', { type: 'button', onclick: () => send(input.value) }, 'Send');
  stopBtn = h('button.btn.hidden', { type: 'button', title: 'Stop the answer', onclick: () => ctl?.abort() }, '■');
  mic = micButton(text => send(text)); mic.classList.add('hidden');
  speakBtn = h('button.btn.small', { type: 'button', title: 'Read the answers aloud', onclick: () => { speak = !speak; speakBtn.classList.toggle('on', speak); if (!speak) hush(); } }, '🔊');
  statusLine = h('small.ai-state');
  panel = h('section.ai-panel', { 'aria-label': 'WIESPL Assistant' },
    h('header', h('b', '🤖 WIESPL AI'), statusLine, h('span.grow'), speakBtn,
      state.user?.role === 'admin' ? h('button.btn.small', { type: 'button', title: 'AI settings and documents', onclick: () => aiSettings().catch(fail) }, '⚙') : null,
      h('button.btn.small', { type: 'button', title: 'Open this chat on the full AI page', onclick: () => { open(false); location.hash = conv?.id ? `#/ai/${conv.id}` : '#/ai'; } }, '⤢'),
      h('button.btn.small', { type: 'button', title: 'New chat', onclick: () => { ctl?.abort(); conv = null; keepId(null); render(); } }, '🧹'),
      h('button.btn.small', { type: 'button', 'aria-label': 'Close', onclick: () => open(false) }, '✕')),
    log, h('div.ai-input', mic, input, stopBtn, sendBtn));
  document.body.append(fab, panel);
  render();
  function open(on) {
    panel.classList.toggle('open', on);
    if (on) { input.focus(); refresh(); load(); }
  }
  window.addEventListener('hashchange', () => { if (!conv?.messages?.length && !busy) render(); }); // the new screen's questions
  window.addEventListener('logged-out', () => { ctl?.abort(); conv = null; keepId(null); panel.classList.remove('open'); });
}
async function refresh() {
  const s = await aiStatus(true), ok = s.ok && s.chatModel !== false;
  statusLine.textContent = '· ' + (ok ? 'ready' : statusText(s).toLowerCase());
  statusLine.classList.toggle('bad', !ok);
  mic.classList.toggle('hidden', !s.voice || !window.MediaRecorder);
}
