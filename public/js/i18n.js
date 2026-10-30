// CRM screens in Marathi (or English). The screens are written in English; when Marathi is chosen, every piece
// of screen text that is in the dictionary (i18n/mr.js) is shown in Marathi as it appears — menus, labels, buttons,
// statuses, table headings, placeholders and tooltips. What people type (names, remarks, amounts) is never changed,
// and printed documents (quotations, POs, invoices… inside .doc / #print-root) stay in English.
// The choice is kept in this browser.

const KEY = 'wiespl-lang';
export const LANGS = [['en', 'English'], ['mr', 'मराठी']];
export function getLang() { try { return localStorage.getItem(KEY) || 'en'; } catch { return 'en'; } }
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ } location.reload(); }

let dict = null, patterns = [];
const SKIP = 'script, style, textarea, input, [contenteditable], .doc, #print-root, .no-i18n, code, pre';
// "📋 Enquiry Register (3)" → prefix "📋 ", core "Enquiry Register", suffix " (3)"
const SPLIT = /^([^A-Za-z]*?)([A-Za-z][\s\S]*?)(\s*(?:\(\d+\)|[:*…]|\d+)?\s*)$/;

export function tr(text) {
  if (!dict || !text || !/[A-Za-z]/.test(text)) return text;
  const whole = dict[text.trim()];
  if (whole) return text.replace(text.trim(), whole);
  const s = text.trim();
  for (const [re, to] of patterns) if (re.test(s)) return text.replace(s, s.replace(re, to));
  const m = text.match(SPLIT);
  if (!m) return text;
  const core = dict[m[2]] || dict[m[2].replace(/\s+/g, ' ')];
  return core ? m[1] + core + m[3] : text;
}

function translateNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const v = n.nodeValue, t = tr(v);
    if (t !== v) n.nodeValue = t;
    return;
  }
  if (n.nodeType !== 1) return;
  if (n.matches(SKIP)) { // fields keep what was typed, but their hint and tooltip are translated
    if (/^(INPUT|TEXTAREA)$/.test(n.tagName) && !n.closest('.doc, #print-root, .no-i18n')) for (const a of ['placeholder', 'title']) { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
    return;
  }
  for (const a of ['placeholder', 'title', 'aria-label', 'data-tip']) {
    const v = n.getAttribute(a);
    if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); }
  }
  if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) n.value = tr(n.value);
  for (const c of n.childNodes) translateNode(c);
}

export async function startI18n() {
  if (getLang() !== 'mr') return;
  const mr = await import('./i18n/mr.js');
  dict = mr.default; patterns = mr.PATTERNS || [];
  document.documentElement.lang = 'mr';
  translateNode(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  // browser dialogs (confirm / alert) too
  const c = window.confirm.bind(window), a = window.alert.bind(window);
  window.confirm = msg => c(tr(String(msg))); window.alert = msg => a(tr(String(msg)));
}
