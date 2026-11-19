// "How to clock in / clock out" on My Attendance: big pictures, very short steps, in English, Marathi or Hindi (starts in
// the CRM's language; the choice is kept in this browser). Its own text, so the CRM translator leaves it alone (.no-i18n).
import { h } from '../ui.js';
import { getLang } from '../i18n.js';

const KEY = 'wiespl-guide-lang';
export function guideLang() { try { return localStorage.getItem(KEY) || (getLang() === 'mr' ? 'mr' : 'en'); } catch { return 'en'; } }
const setGuideLang = l => { try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ } };

// Short messages on the attendance card, in the same language as the guide.
const MSG = {
  clockIn: { en: '⏰ Please clock in now', mr: '⏰ कृपया आता Clock in करा', hi: '⏰ कृपया अभी Clock in करें' },
  clockInSub: { en: t => `Your shift started at ${t}. Press “📍 Clock in” below.`, mr: t => `तुमची शिफ्ट ${t} ला सुरू झाली. खाली “📍 Clock in” दाबा.`, hi: t => `आपकी शिफ्ट ${t} बजे शुरू हुई. नीचे “📍 Clock in” दबाएँ.` },
  clockOut: { en: '🏁 Your work time is over: please clock out', mr: '🏁 तुमची कामाची वेळ संपली: कृपया Clock out करा', hi: '🏁 आपका काम का समय पूरा हुआ: कृपया Clock out करें' },
  clockOutSub: { en: 'Press the red “Clock out” button before you leave.', mr: 'निघण्यापूर्वी लाल “Clock out” बटण दाबा.', hi: 'जाने से पहले लाल “Clock out” बटन दबाएँ.' },
  half: { en: (c, g) => `🌗 Half-day leave approved today: come by ${c}, or leave from ${g}. The day counts as complete.`, mr: (c, g) => `🌗 आज अर्ध्या दिवसाची रजा मंजूर: ${c} पर्यंत या, किंवा ${g} नंतर जा. दिवस पूर्ण धरला जाईल.`, hi: (c, g) => `🌗 आज आधे दिन की छुट्टी मंज़ूर: ${c} तक आएँ, या ${g} के बाद जाएँ. दिन पूरा गिना जाएगा.` },
  short: { en: (c, g) => `⏱️ Short leave approved today: come by ${c}, or leave from ${g}. The day counts as complete.`, mr: (c, g) => `⏱️ आज शॉर्ट लीव्ह मंजूर: ${c} पर्यंत या, किंवा ${g} नंतर जा. दिवस पूर्ण धरला जाईल.`, hi: (c, g) => `⏱️ आज शॉर्ट लीव मंज़ूर: ${c} तक आएँ, या ${g} के बाद जाएँ. दिन पूरा गिना जाएगा.` },
};
export const msg = (k, ...a) => { const m = MSG[k][guideLang()] || MSG[k].en; return typeof m === 'function' ? m(...a) : m; };

const T = {
  title: { en: 'How to clock in / clock out', mr: 'Clock in / Clock out कसे करायचे', hi: 'Clock in / Clock out कैसे करें' },
  morning: { en: '🌅 Morning: Clock in', mr: '🌅 सकाळी: Clock in', hi: '🌅 सुबह: Clock in' },
  day: { en: '☀️ During the day', mr: '☀️ दिवसभर', hi: '☀️ दिन में' },
  evening: { en: '🌇 Evening: Clock out', mr: '🌇 संध्याकाळी: Clock out', hi: '🌇 शाम: Clock out' },
  help: { en: '🆘 If there is a problem', mr: '🆘 अडचण आली तर', hi: '🆘 अगर दिक्कत हो' },
};
const IN = [
  ['📍', { en: 'Switch ON the phone location (GPS)', mr: 'फोनचे लोकेशन (GPS) चालू करा', hi: 'फ़ोन की लोकेशन (GPS) चालू करें' }],
  ['🏢', { en: 'Reach the office or your site', mr: 'ऑफिस किंवा साइटवर पोहोचा', hi: 'ऑफिस या अपनी साइट पर पहुँचें' }],
  ['📱', { en: 'Open the CRM → 🕘 My Attendance', mr: 'CRM उघडा → 🕘 My Attendance', hi: 'CRM खोलें → 🕘 My Attendance' }],
  ['👆', { en: 'Press the blue button “📍 Clock in”', mr: 'निळे बटण “📍 Clock in” दाबा', hi: 'नीला बटन “📍 Clock in” दबाएँ' }],
  ['🤳', { en: 'If the phone asks: take a selfie', mr: 'फोनने विचारले तर: सेल्फी घ्या', hi: 'फ़ोन पूछे तो: सेल्फ़ी लें' }],
  ['✅', { en: 'You see “Working since …” = done', mr: '“Working since …” दिसले = झाले', hi: '“Working since …” दिखे = हो गया' }],
];
const DAY = [
  ['📲', { en: 'Keep the CRM open: your location is noted every 15 minutes', mr: 'CRM उघडे ठेवा: दर 15 मिनिटांनी तुमचे लोकेशन नोंदवले जाते', hi: 'CRM खुला रखें: हर 15 मिनट आपकी लोकेशन दर्ज होती है' }],
  ['🚶', { en: 'Going out for work or lunch? Press “🚶 Going out”', mr: 'कामासाठी / जेवणासाठी बाहेर जाताय? “🚶 Going out” दाबा', hi: 'काम या खाने के लिए बाहर जा रहे हैं? “🚶 Going out” दबाएँ' }],
  ['↩️', { en: 'Back? Press “↩ Back at site”', mr: 'परत आलात? “↩ Back at site” दाबा', hi: 'वापस आए? “↩ Back at site” दबाएँ' }],
];
const OUT = [
  ['⏰', { en: 'Work time over? (a “Please clock out” message comes)', mr: 'कामाची वेळ संपली? (“Please clock out” संदेश येतो)', hi: 'काम का समय पूरा? (“Please clock out” संदेश आता है)' }],
  ['📱', { en: 'Open 🕘 My Attendance', mr: '🕘 My Attendance उघडा', hi: '🕘 My Attendance खोलें' }],
  ['👆', { en: 'Press the red button “📍 Clock out”', mr: 'लाल बटण “📍 Clock out” दाबा', hi: 'लाल बटन “📍 Clock out” दबाएँ' }],
  ['✅', { en: 'You see “Clocked out at …” = done. Now go home.', mr: '“Clocked out at …” दिसले = झाले. आता घरी जा.', hi: '“Clocked out at …” दिखे = हो गया. अब घर जाएँ.' }],
];
const HELP = [
  ['🚫', { en: '“Location is blocked”: iPhone → Settings → Safari → Location → Allow. Android → Chrome → Site settings → Location → Allow.',
    mr: '“Location is blocked”: iPhone → Settings → Safari → Location → Allow. Android → Chrome → Site settings → Location → Allow.',
    hi: '“Location is blocked”: iPhone → Settings → Safari → Location → Allow. Android → Chrome → Site settings → Location → Allow.' }],
  ['🛰️', { en: '“GPS is too rough”: go outside or near a window, wait 10 seconds, press again', mr: '“GPS is too rough”: बाहेर किंवा खिडकीजवळ जा, 10 सेकंद थांबा, पुन्हा दाबा', hi: '“GPS is too rough”: बाहर या खिड़की के पास जाएँ, 10 सेकंड रुकें, फिर दबाएँ' }],
  ['🔒', { en: '“Clock out opens at …”: your hours are not complete. Need to leave early? Ask for a short leave or half day first.', mr: '“Clock out opens at …”: तुमचे तास पूर्ण नाहीत. लवकर जायचे आहे? आधी शॉर्ट लीव्ह / हाफ डे मागा.', hi: '“Clock out opens at …”: आपके घंटे पूरे नहीं हुए. जल्दी जाना है? पहले शॉर्ट लीव / हाफ़ डे माँगें.' }],
  ['🙅', { en: 'Clock in only for yourself, on your own phone. Never share your password. The CRM notes the phone used.', mr: 'फक्त स्वतःसाठी, स्वतःच्या फोनवरून Clock in करा. पासवर्ड कोणालाही देऊ नका. CRM वापरलेला फोन नोंदवतो.', hi: 'सिर्फ़ अपने लिए, अपने फ़ोन से Clock in करें. पासवर्ड किसी को न दें. CRM इस्तेमाल हुआ फ़ोन दर्ज करता है.' }],
  ['📞', { en: 'Still stuck? Call HR.', mr: 'तरीही अडचण? HR ला फोन करा.', hi: 'फिर भी दिक्कत? HR को फ़ोन करें.' }],
];

const step = (n, [icon, text], lang, color) => h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px', borderRadius: '12px', background: 'var(--bg)' } },
  n ? h('div', { style: { minWidth: '30px', height: '30px', borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '16px' } }, String(n)) : null,
  h('div', { style: { fontSize: '40px', lineHeight: 1, minWidth: '48px', textAlign: 'center' }, 'aria-hidden': 'true' }, icon),
  h('div', { style: { fontSize: '17px', fontWeight: 600, lineHeight: 1.35 } }, text[lang] || text.en));

export function attendGuide({ open = false } = {}) {
  const body = h('div');
  const langs = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0 10px' } });
  const draw = () => {
    const lang = guideLang();
    langs.replaceChildren(...[['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिंदी']].map(([k, l]) => h('button.btn' + (k === lang ? '.primary' : ''), { type: 'button', style: { fontSize: '16px' }, onclick: () => { setGuideLang(k); draw(); } }, l)));
    const part = (title, steps, color, numbered = true) => h('div', { style: { marginBottom: '14px' } },
      h('div', { style: { fontSize: '19px', fontWeight: 700, margin: '4px 0 8px' } }, title[lang] || title.en),
      h('div.grid', { style: { gap: '8px' } }, steps.map((s, i) => step(numbered ? i + 1 : 0, s, lang, color))));
    body.replaceChildren(part(T.morning, IN, '#1a7f37'), part(T.day, DAY, '#1f6feb', false), part(T.evening, OUT, '#cf222e'), part(T.help, HELP, '#9a6700', false));
  };
  draw();
  const det = h('details.card.no-i18n', { open },
    h('summary', { style: { fontSize: '18px', fontWeight: 700, cursor: 'pointer', padding: '4px 0' } }, '❓ ', h('span', T.title[guideLang()] || T.title.en)), langs, body);
  langs.addEventListener('click', () => { det.querySelector('summary span').textContent = T.title[guideLang()] || T.title.en; });
  return det;
}
