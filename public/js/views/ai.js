// 🤖 WIESPL AI: the AI's own page. On the left this person's conversations (kept on the server, private to them),
// on the right the chat: ideas to start with, answers that stream in with the records they came from, Stop, voice.
import { h, api, state, toast, fail, confirmBox } from '../ui.js';
import { ask, messageEl, liveAnswer, ideas, aiStatus, statusText, aiSettings, micButton, say, hush } from '../ai-core.js';

let abortCtl = null; // the answer being written, if any (stopped when the person leaves or starts another chat)

export async function aiView(view, id) {
  abortCtl?.abort(); abortCtl = null;
  let conv = null, speak = false, busyNow = false, chats = [];
  const admin = state.user?.role === 'admin';

  // ---- the parts of the page
  const list = h('div.aip-list'), find = h('input.aip-find', { type: 'search', placeholder: 'Search your chats…', oninput: () => showList() });
  const side = h('aside.aip-side',
    h('div.aip-brand', h('div.aip-orb'), h('div', h('b', 'WIESPL AI'), h('small', 'Your private CRM assistant'))),
    h('button.btn.primary.aip-new', { type: 'button', onclick: () => go(null) }, '＋  New chat'), find, list,
    h('div.aip-note', h('span', '🔒'), h('span', 'Runs on WIESPL’s own computer. Nothing leaves the company, and your chats are only yours.')));
  const title = h('h2.aip-title', 'New chat'), pill = h('span.aip-pill', '…'), headOrb = h('div.aip-orb.sm');
  const speakBtn = h('button.btn.small', { type: 'button', title: 'Read every answer aloud', onclick: () => { speak = !speak; speakBtn.classList.toggle('on', speak); if (!speak) hush(); } }, '🔊');
  const log = h('div.aip-log');
  const input = h('textarea.aip-input', { rows: 1, placeholder: 'Ask WIESPL AI anything…   (Enter to send · Shift+Enter for a new line)',
    oninput: () => grow(), onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } if (e.key === 'Escape') stop(); } });
  const sendBtn = h('button.btn.aip-send', { type: 'button', title: 'Send (Enter)', 'aria-label': 'Send', disabled: true, onclick: () => send(input.value) }, '➤');
  const stopBtn = h('button.btn.aip-stop.hidden', { type: 'button', title: 'Stop the answer (Esc)', onclick: () => stop() }, '■ Stop');
  const mic = micButton(text => send(text)); mic.classList.add('hidden');
  const main = h('section.aip-main',
    h('header.aip-head',
      h('button.btn.small.aip-menu', { type: 'button', title: 'Your chats', onclick: () => side.classList.toggle('open') }, '☰'),
      headOrb, h('div.aip-titles', title, pill), h('span.grow'),
      h('button.btn.small', { type: 'button', title: 'Rename this chat', onclick: () => rename() }, '✏️'),
      speakBtn,
      admin ? h('button.btn.small', { type: 'button', title: 'AI settings and documents', onclick: () => aiSettings().then(refreshStatus).catch(fail) }, '⚙') : null),
    log,
    h('div.aip-compose', h('div.aip-box', mic, input, stopBtn, sendBtn)),
    h('div.aip-fine', 'WIESPL AI can make mistakes. Check important numbers in the records it links to.'));
  view.replaceChildren(h('div.aip', side, main));
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; sendBtn.disabled = !input.value.trim(); };

  // ---- the list of conversations
  async function loadList() { try { chats = await api('/ai/conversations'); } catch { chats = []; } showList(); }
  function showList() {
    const q = find.value.trim().toLowerCase(), shown = chats.filter(c => !q || c.title.toLowerCase().includes(q));
    const day = s => { const d = String(s || '').slice(0, 10), t = new Date().toLocaleString('sv-SE').slice(0, 10), y = new Date(Date.now() - 864e5).toLocaleString('sv-SE').slice(0, 10); return d === t ? 'Today' : d === y ? 'Yesterday' : d; };
    const groups = []; for (const c of shown) { const g = day(c.updated_at); (groups.at(-1)?.[0] === g ? groups.at(-1)[1] : (groups.push([g, []]), groups.at(-1)[1])).push(c); }
    list.replaceChildren(...(shown.length ? groups.flatMap(([g, cs]) => [h('div.aip-day', g), ...cs.map(c => h('div.aip-item' + (conv?.id === c.id ? '.on' : ''), { onclick: () => go(c.id) },
      h('span.aip-item-t', c.title || 'Chat'),
      h('button.aip-x', { type: 'button', title: 'Delete this chat', onclick: async e => { e.stopPropagation(); if (!(await confirmBox(`Delete the chat "${c.title}"?`, 'Delete'))) return; await api('/ai/conversations/' + c.id, { method: 'DELETE' }).catch(fail); if (conv?.id === c.id) go(null); else loadList(); } }, '🗑')))])
      : [h('div.aip-empty', q ? 'No chat matches.' : 'Your chats will be kept here.')]));
  }
  function go(cid) { // open a chat (or a new one) without reloading the page
    abortCtl?.abort(); side.classList.remove('open');
    history.replaceState(history.state, '', cid ? `#/ai/${cid}` : '#/ai');
    openChat(cid);
  }

  // ---- one conversation
  async function openChat(cid) {
    conv = null;
    if (cid) { try { conv = await api('/ai/conversations/' + cid); } catch (e) { fail(e); history.replaceState(history.state, '', '#/ai'); } }
    title.textContent = conv?.title || 'New chat';
    showList(); render(); input.focus();
  }
  function render() {
    if (!conv?.messages?.length) {
      const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      log.replaceChildren(h('div.aip-welcome',
        h('div.aip-hero', h('div.aip-orb.lg'),
          h('h1', `${greet}, `, h('span.aip-grad', state.user?.name?.split(' ')[0] || 'there')),
          h('h1', 'What would you like to know?'),
          h('p', 'Ask about enquiries, quotations, projects, stock, purchase or HR, or about WIESPL’s products and NABH norms. I only see what your role can see.'),
          h('div.aip-feats', h('span', '🔒 Private, on WIESPL’s computer'), h('span', '⚡ Live CRM data'), h('span', '📚 WIESPL documents'), h('span', '🌐 Ask in any language'))),
        h('div.aip-ideas', ideas().map(([group, qs]) => {
          const [icon, ...name] = group.split(' ');
          return h('div.aip-idea-group', h('div.aip-gh', h('span.aip-gi', icon), h('b', name.join(' '))),
            qs.map(q => h('button.aip-idea', { type: 'button', onclick: () => send(q) }, h('span', q))));
        }))));
      return;
    }
    log.replaceChildren(...conv.messages.map(messageEl)); log.scrollTop = log.scrollHeight;
  }

  // ---- asking
  async function send(text) {
    text = String(text || '').trim(); if (!text || busyNow) return;
    busyNow = true; input.value = ''; grow(); sendBtn.classList.add('hidden'); stopBtn.classList.remove('hidden'); headOrb.classList.add('busy');
    if (!conv) { conv = { id: null, title: text.slice(0, 80), messages: [] }; title.textContent = conv.title; }
    conv.messages.push({ role: 'user', content: text }); render();
    const live = liveAnswer(); log.append(live.el); log.scrollTop = log.scrollHeight;
    const ctl = abortCtl = new AbortController();
    try {
      await ask({ text, conversation: conv.id, signal: ctl.signal, onEvent: ev => {
        if (ev.type === 'conversation' && !conv.id) { conv.id = ev.id; history.replaceState(history.state, '', `#/ai/${ev.id}`); loadList(); }
        live.on(ev); log.scrollTop = log.scrollHeight;
      } });
      live.stop();
      if (!live.reply.content.trim()) live.reply.content = 'I could not find an answer to that.';
      conv.messages.push(live.reply); live.el.replaceWith(messageEl(live.reply));
      if (speak) say(live.reply.content);
    } catch (e) {
      live.stop();
      if (ctl.signal.aborted) { live.reply.content = (live.reply.content.trim() ? live.reply.content + ' …' : '(stopped)'); conv.messages.push(live.reply); live.el.replaceWith(messageEl(live.reply)); }
      else { const m = { role: 'assistant', content: '⚠️ ' + (e.message || e), error: true }; conv.messages.push(m); live.el.replaceWith(messageEl(m)); }
    } finally {
      if (abortCtl === ctl) abortCtl = null;
      busyNow = false; stopBtn.classList.add('hidden'); sendBtn.classList.remove('hidden'); headOrb.classList.remove('busy');
      log.scrollTop = log.scrollHeight; if (document.activeElement !== find) input.focus();
      loadList();
    }
  }
  function stop() { abortCtl?.abort(); }
  async function rename() {
    if (!conv?.id) return toast('Ask something first', true);
    const t = prompt('Name of this chat', conv.title); if (!t?.trim()) return;
    await api('/ai/conversations/' + conv.id, { method: 'PATCH', body: { title: t.trim() } }).then(() => { conv.title = t.trim().slice(0, 80); title.textContent = conv.title; loadList(); }).catch(fail);
  }

  // ---- the AI's state
  async function refreshStatus() {
    const s = await aiStatus(true), ok = s.ok && s.chatModel !== false;
    pill.textContent = statusText(s) + (admin && s.model ? ` · ${s.model.replace(/\.gguf$/i, '')}` : '');
    pill.classList.toggle('bad', !ok);
    mic.classList.toggle('hidden', !s.voice || !window.MediaRecorder);
    if (!ok && location.hash.startsWith('#/ai')) setTimeout(() => { if (document.body.contains(pill)) refreshStatus(); }, 10000);
  }

  await Promise.all([loadList(), openChat(id ? Number(id) : null)]);
  refreshStatus();
}
