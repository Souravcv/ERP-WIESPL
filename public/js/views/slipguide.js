// Login slip with a picture guide for attendance (HR → App logins → print slips): half an A4 page per person, so two
// slips per sheet with a cut line. Name, username, temporary password, then three rows of small drawn copies of the
// phone screen (sign in → clock in → clock out) with very short steps in English, Marathi or Hindi. The drawings are
// generic (no real person, photo or place), made in HTML so they print sharp.
import { h } from '../ui.js';

export const SLIP_LANGS = [['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिंदी']];

const T = {
  title: { en: 'Your CRM login and attendance', mr: 'तुमचे CRM लॉगिन आणि हजेरी', hi: 'आपका CRM लॉगिन और हाज़िरी' },
  user: { en: 'Username', mr: 'युजरनेम', hi: 'यूज़रनेम' },
  pass: { en: 'Temporary password', mr: 'तात्पुरता पासवर्ड', hi: 'अस्थायी पासवर्ड' },
  addr: { en: 'Open on the phone', mr: 'फोनवर उघडा', hi: 'फ़ोन पर खोलें' },
  first: { en: '1 · First time: sign in', mr: '1 · पहिल्यांदा: साइन इन', hi: '1 · पहली बार: साइन इन' },
  morning: { en: '2 · Morning: Clock in', mr: '2 · सकाळी: Clock in', hi: '2 · सुबह: Clock in' },
  evening: { en: '3 · Evening: Clock out', mr: '3 · संध्याकाळी: Clock out', hi: '3 · शाम: Clock out' },
  rule: { en: '🙅 Only you, on your own phone. Never give your password to anyone. Keep this slip private.',
    mr: '🙅 फक्त तुम्ही, तुमच्या फोनवरून. पासवर्ड कोणालाही देऊ नका. ही चिठ्ठी स्वतःजवळ ठेवा.',
    hi: '🙅 सिर्फ़ आप, अपने फ़ोन से. पासवर्ड किसी को न दें. यह पर्ची अपने पास रखें.' },
};
const STEPS = {
  first: [
    { en: 'Type username + password, press Sign in', mr: 'युजरनेम + पासवर्ड लिहा, Sign in दाबा', hi: 'यूज़रनेम + पासवर्ड लिखें, Sign in दबाएँ' },
    { en: 'Make your own new password', mr: 'स्वतःचा नवीन पासवर्ड बनवा', hi: 'अपना नया पासवर्ड बनाएँ' },
    { en: 'Menu → 🕘 My attendance', mr: 'मेनू → 🕘 My attendance', hi: 'मेनू → 🕘 My attendance' },
  ],
  morning: [
    { en: 'At work: press the blue “Clock in”', mr: 'कामावर: निळे “Clock in” दाबा', hi: 'काम पर: नीला “Clock in” दबाएँ' },
    { en: 'Location asked? Press “Allow”. Selfie asked? Take it.', mr: 'लोकेशन विचारले? “Allow” दाबा. सेल्फी विचारली? घ्या.', hi: 'लोकेशन पूछे? “Allow” दबाएँ. सेल्फ़ी पूछे? लें.' },
    { en: '“Working since …” = done', mr: '“Working since …” दिसले = झाले', hi: '“Working since …” दिखे = हो गया' },
  ],
  evening: [
    { en: 'Message “Please clock out” comes', mr: '“Please clock out” संदेश येतो', hi: '“Please clock out” संदेश आता है' },
    { en: 'Press the red “Clock out”', mr: 'लाल “Clock out” दाबा', hi: 'लाल “Clock out” दबाएँ' },
    { en: '“Clocked out at …” = done, go home', mr: '“Clocked out at …” = झाले, घरी जा', hi: '“Clocked out at …” = हो गया, घर जाएँ' },
  ],
};

// ---- small drawn screens (about 22 × 25 mm); made new for each slip (a node can be on the page only once)
const C = { blue: '#2563eb', red: '#dc2626', green: '#16a34a', line: '#9ca3af', soft: '#f3f4f6', ink: '#111827' };
const phone = (...kids) => h('div', { style: { width: '22mm', height: '25mm', border: `0.6mm solid ${C.ink}`, borderRadius: '3mm', padding: '1.6mm 1.3mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.9mm', background: '#fff', fontSize: '5.3pt', lineHeight: 1.2, overflow: 'hidden', flex: 'none' } }, ...kids);
const bar = (w = '100%', c = C.soft) => h('div', { style: { height: '2mm', width: w, background: c, borderRadius: '0.8mm', border: `0.2mm solid ${C.line}` } });
const btn = (text, c, filled = true) => h('div', { style: { padding: '1.1mm 0.5mm', borderRadius: '1.2mm', textAlign: 'center', fontWeight: 700, fontSize: '6.2pt', color: filled ? '#fff' : c, background: filled ? c : '#fff', border: `0.4mm solid ${c}` } }, text);
const small = (text, c = C.ink, bold = false) => h('div', { style: { color: c, fontWeight: bold ? 700 : 400 } }, text);

const SCREENS = () => ({
  first: [
    phone(small('WIESPL CRM', C.blue, true), small('Username'), bar(), small('Password'), bar(), btn('Sign in', C.blue)),
    phone(small('New password', C.ink, true), bar(), small('Again'), bar(), btn('Save', C.blue)),
    phone(small('☰ Menu', C.ink, true), small('📊 Dashboard'), h('div', { style: { background: C.blue, color: '#fff', borderRadius: '1mm', padding: '0.8mm', fontWeight: 700 } }, '🕘 My attendance'), small('✅ My tasks')),
  ],
  morning: [
    phone(small('My Attendance', C.ink, true), small('Not clocked in yet'), h('div', { style: { flex: 1 } }), btn('📍 Clock in', C.blue)),
    phone(h('div', { style: { border: `0.3mm solid ${C.line}`, borderRadius: '1.5mm', padding: '1.2mm', marginTop: '3mm', textAlign: 'center' } }, small('📍 Allow location?', C.ink, true),
      h('div', { style: { display: 'flex', gap: '1mm', marginTop: '1.2mm' } }, h('div', { style: { flex: 1, fontSize: '6pt' } }, 'Block'), h('div', { style: { flex: 1, color: C.blue, fontWeight: 700, fontSize: '6.5pt' } }, 'Allow'))),
      h('div', { style: { textAlign: 'center', fontSize: '13pt', marginTop: '1mm' } }, '🤳')),
    phone(small('My Attendance', C.ink, true), h('div', { style: { background: C.soft, borderRadius: '1mm', padding: '1mm' } }, small('Working since 09:30', C.green, true)), h('div', { style: { textAlign: 'center', fontSize: '14pt' } }, '✅')),
  ],
  evening: [
    phone(h('div', { style: { border: `0.4mm solid ${C.red}`, borderRadius: '1.2mm', padding: '1mm' } }, small('🏁 Please clock out', C.red, true)), h('div', { style: { flex: 1 } }), small('⏰ 18:00', C.ink, true)),
    phone(small('My Attendance', C.ink, true), small('Working since 09:30'), h('div', { style: { flex: 1 } }), btn('📍 Clock out', C.red, false)),
    phone(small('My Attendance', C.ink, true), h('div', { style: { background: C.soft, borderRadius: '1mm', padding: '1mm' } }, small('Clocked out at 18:00', C.ink, true)), h('div', { style: { textAlign: 'center', fontSize: '14pt' } }, '🏠')),
  ],
});

const row = (key, lang) => h('div', { style: { marginTop: '1.5mm', breakInside: 'avoid' } },
  h('div', { style: { fontWeight: 700, fontSize: '10.5pt', marginBottom: '0.8mm' } }, T[key][lang] || T[key].en),
  h('div', { style: { display: 'flex', gap: '3mm' } }, SCREENS()[key].map((scr, i) => h('div', { style: { display: 'flex', gap: '1.5mm', flex: 1, alignItems: 'flex-start' } },
    scr, h('div', { style: { fontSize: '8.5pt', lineHeight: 1.3, fontWeight: 600 } }, h('div', { style: { fontSize: '10pt', fontWeight: 800 } }, `${i + 1}`), STEPS[key][i][lang] || STEPS[key][i].en)))));

// One slip (half an A4 page).
export function loginSlip(c, { address, lang = 'en', roleLabel = r => r }) {
  const t = k => T[k][lang] || T[k].en;
  return h('div', { style: { height: '132mm', boxSizing: 'border-box', padding: '2.5mm 2mm', overflow: 'hidden', color: '#000', breakInside: 'avoid', pageBreakInside: 'avoid' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '0.4mm solid #000', paddingBottom: '1.5mm' } },
      h('div', { style: { fontSize: '13pt', fontWeight: 800 } }, c.name, c.emp_code ? h('span', { style: { fontSize: '9pt', fontWeight: 400 } }, ` · ${c.emp_code}`) : null),
      h('div', { style: { fontSize: '9pt' } }, t('title'), ' · ', roleLabel(c.role))),
    h('div', { style: { display: 'flex', gap: '6mm', margin: '2mm 0', fontSize: '10.5pt', flexWrap: 'wrap' } },
      address ? h('div', t('addr'), ': ', h('b', address)) : null,
      h('div', t('user'), ': ', h('b', { style: { fontFamily: 'monospace', fontSize: '12pt' } }, c.username)),
      h('div', t('pass'), ': ', h('b', { style: { fontFamily: 'monospace', fontSize: '12pt' } }, c.password))),
    row('first', lang), row('morning', lang), row('evening', lang),
    h('div', { style: { marginTop: '2.5mm', fontSize: '8.5pt', fontWeight: 600 } }, t('rule')));
}

// All slips, two per A4 page with a dashed cut line between them.
export function slipPages(created, opts) {
  const pages = [];
  for (let i = 0; i < created.length; i += 2) {
    pages.push(h('div.page', { style: { padding: 0 } }, loginSlip(created[i], opts),
      created[i + 1] ? [h('div', { style: { borderTop: '0.3mm dashed #666', margin: '1mm 0', fontSize: '7pt', color: '#666', textAlign: 'center' } }, '✂'), loginSlip(created[i + 1], opts)] : null));
  }
  return h('div.doc', { style: { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } }, pages);
}
