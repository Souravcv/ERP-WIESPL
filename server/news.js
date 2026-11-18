// News: industry, regulation and OT / hospital technology headlines, and new hospitals all over India (sales leads).
// The CRM server only READS public news feeds (trusted publishers' RSS and Google News topic searches): nothing of the
// CRM goes out; the searches use generic words only (no client names). Headlines are kept with their source, date,
// link and the publisher's short summary; the article opens on the publisher's site. Keyword rules decide the topic and
// drop noise (patients, crime, politics). Fetched every 3 hours; old items go after 90 days.
import { db, getSettings, audit } from './db.js';
import { insertRow, HttpError } from './crud.js';
import { canWrite, hasFunction } from '../public/js/schema.js';
import { notify } from './notify.js';

export function migrateNews() {
  db.exec(`CREATE TABLE IF NOT EXISTS news_items (id INTEGER PRIMARY KEY, url TEXT UNIQUE, title TEXT, title_key TEXT, source TEXT, published TEXT, topic TEXT,
      score INTEGER, snippet TEXT, place TEXT, state TEXT, feed TEXT, found_at TEXT DEFAULT (datetime('now','localtime')), status TEXT DEFAULT 'new', enquiry_id INTEGER, by_name TEXT);
    CREATE INDEX IF NOT EXISTS ix_news_found ON news_items(found_at);
    CREATE INDEX IF NOT EXISTS ix_news_key ON news_items(title_key);`);
}

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const gnews = (q, lang = 'en') => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang === 'en' ? 'en-IN' : lang}&gl=IN&ceid=IN:${lang === 'en' ? 'en' : lang}`;

// ---------------------------------------------------------------- what is read
// kind: leads (new hospitals), industry (OT / hospital technology and regulation). Admins can replace the list in
// Settings → News feeds (one per line: Name | URL | leads or industry).
// Google News answers simple searches well (a long OR-query falls back to general news): one "N-bed hospital" search
// per state / UT, a few India-wide phrases, and Marathi / Hindi searches; the filter below does the rest.
const ALL_STATES = ['Maharashtra', 'Goa', 'Gujarat', 'Rajasthan', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Puducherry', 'Telangana', 'Andhra Pradesh', 'Delhi', 'Haryana', 'Punjab', 'Chandigarh',
  'Uttar Pradesh', 'Uttarakhand', 'Madhya Pradesh', 'Chhattisgarh', 'Bihar', 'Jharkhand', 'West Bengal', 'Odisha', 'Assam', 'Meghalaya', 'Tripura', 'Manipur', 'Nagaland', 'Mizoram',
  'Arunachal Pradesh', 'Sikkim', 'Jammu and Kashmir', 'Himachal Pradesh', 'Ladakh'];
export const DEFAULT_FEEDS = [
  ...ALL_STATES.map(s => ({ name: `New hospitals · ${s}`, url: gnews(`"bed hospital" ${s} when:14d`), kind: 'leads' })),
  ...['"new hospital" India when:7d', '"multispeciality hospital" when:7d', '"super speciality hospital" when:7d', 'hospital "foundation stone" when:14d', '"hospital to come up" when:30d',
    'hospital bhoomipujan when:30d', '"new medical college" when:14d', '"cancer hospital" new when:14d'].map(q => ({ name: `New hospitals · ${q.replace(/ when:\d+d/, '').replace(/"/g, '')}`, url: gnews(q), kind: 'leads' })),
  { name: 'नवीन रुग्णालय (Marathi)', url: gnews('नवीन रुग्णालय when:14d', 'mr'), kind: 'leads' },
  { name: 'रुग्णालय उद्घाटन (Marathi)', url: gnews('रुग्णालय उद्घाटन when:14d', 'mr'), kind: 'leads' },
  { name: 'नया अस्पताल (Hindi)', url: gnews('नया अस्पताल when:14d', 'hi'), kind: 'leads' },
  { name: 'अस्पताल शिलान्यास (Hindi)', url: gnews('अस्पताल शिलान्यास when:14d', 'hi'), kind: 'leads' },
  { name: 'Modular OT', url: gnews('"modular operation theatre" when:30d'), kind: 'industry' },
  { name: 'Operation theatres', url: gnews('"operation theatre" hospital new when:14d'), kind: 'industry' },
  { name: 'Hospital HVAC & cleanroom', url: gnews('hospital HVAC cleanroom when:30d'), kind: 'industry' },
  { name: 'Medical gas pipeline', url: gnews('"medical gas pipeline" hospital when:30d'), kind: 'industry' },
  { name: 'NABH', url: gnews('NABH hospital when:14d'), kind: 'industry' },
  { name: 'Medical Devices Rules', url: gnews('"Medical Devices Rules" when:30d'), kind: 'industry' },
  { name: 'CDSCO medical devices', url: gnews('CDSCO "medical device" when:14d'), kind: 'industry' },
  { name: 'ETHealthworld · Medical devices', url: 'https://health.economictimes.indiatimes.com/rss/medical-devices', kind: 'industry' },
  { name: 'Express Healthcare', url: 'https://www.expresshealthcare.in/feed/', kind: 'industry' },
  { name: 'Medical Dialogues', url: 'https://medicaldialogues.in/feed', kind: 'industry' },
  { name: 'Medical Device Network', url: 'https://www.medicaldevice-network.com/feed/', kind: 'industry' },
];
export function feeds() {
  const lines = getSettings().news_feeds;
  if (!Array.isArray(lines) || !lines.length) return DEFAULT_FEEDS;
  return lines.map(l => String(l).split('|').map(x => x.trim())).filter(x => /^https?:\/\//.test(x[1] || '')).map(([name, url, kind]) => ({ name, url, kind: kind === 'leads' ? 'leads' : 'industry' }));
}

// ---------------------------------------------------------------- the filter
const NOISE = /\b(admitted|discharged|hospitali[sz]ed|dies|died|death|dead|deaths|killed|murder|rape|assault|harass\w*|arrest\w*|fir|police|protest|strike|agitation|accident|fire|blaze|stampede|suicide|funeral|condolence|health update|ventilator|critical condition|election|poll|bjp|congress|candidate|celebrity|actor|actress|cricketer|bail|court|scam|bribe|negligence|baby swap|newborn|stray|dogs?|bomb|attack|stolen|theft|guards?|bus|metro|neet|cutoff|exam|results?|research day|celebrat\w*|survey|c-sections?|births|nocs?|fees|salary|recruit\w*|vacanc\w*|jobs?|ranking|top \d+|best .* hospitals|drug-free|narcotic|subsidy|chicks|demand|demands)\b/i;
// a new facility: N beds, to be set up / opened / inaugurated / built, foundation stone, approved …
const LEAD = /(\d+[- ]?bed(ded|s)?|begin operations|start functioning|to start|operational|new (hospital|medical college|block|wing|building|facility|campus|ot|icu)|to (set up|come up|open|build|be built)|sets? up|setting up|opens|opened|inaugurat\w*|foundation stone|bhoomi ?pujan|under construction|construction (of|work)|sanction\w*|approved|upcoming|proposed|expansion|will (come up|be built)|launch\w* (a |its )?(new )?(hospital|facility|centre)|नवीन रुग्णालय|नवी इमारत|नया अस्पताल|नया भवन|नई इमारत|नया मेडिकल कॉलेज|मेडिकल कॉलेज|उद्घाटन|लोकार्पण|शिलान्यास|भूमिपूजन|खाटांचे|बेड|बनेगा|बनेगी)/i;
// the same in Hindi and Marathi ( does not work with Devanagari)
const NOISE_IN = /(मांग|प्रतिमा|प्याऊ|मौत|मृत्यु|हत्या|हादसा|आग लग|चोरी|गिरफ्तार|प्रदर्शन|हड़ताल|धरना|नवजात|मृत्यू|अपघात|आंदोलन|मागणी|पुतळा|लिफ्ट|रोस्टर|कीर्तिमान|पशु|प्राणी)/;
// news from abroad (unless an Indian place is named too)
const FOREIGN = /\b(indonesia|pakistan|bangladesh|nepal|sri lanka|dubai|uae|abu dhabi|saudi|qatar|oman|kuwait|kenya|nigeria|ghana|uganda|tanzania|egypt|u\.?k\.?|britain|london|usa|u\.s\.|america|china|africa|australia|canada|singapore|malaysia|philippines|vietnam|germany|france|afghan\w*|kabul|takhar|iraq|sulaymaniyah|kurdistan|quetta|sindh|larkana|karachi|lahore|islamabad|rawalpindi|peshawar|balochistan|khyber|bugti|bilawal|bhutto|zardari|sharif|federal government|afghanis|billion|fda)\b/i;
// business and market news, animals, pharma: not ours
const OFFTOPIC = /\b(shares?|stocks?|ipo|q[1-4](fy\d+)?|revenue|profit|earnings|forecast|market (worth|size|share)|valuation|veterinary|animal|fish|study|studies|suggests|pharma\w*|drug|drugs|vaccine|nasal|tablet|syrup)\b/i;
const GENERIC = new Set(['hospital', 'hospitals', 'new', 'bed', 'beds', 'medical', 'college', 'set', 'sets', 'plans', 'plan', 'open', 'opens', 'with', 'the', 'for', 'and', 'at', 'in', 'to', 'of', 'a', 'on', 'its', 'by', 'up']);
const words = t => new Set(String(t || '').toLowerCase().replace(/[,₹]/g, '').match(/[a-zऀ-ॿ]+|\d+/g)?.filter(w => w.length > 1) || []);
// the same story told by another paper: most of the words of the shorter headline, two of them not generic
export function sameStory(a, b) {
  const A = words(a), B = words(b), shared = [...A].filter(w => B.has(w));
  return shared.filter(w => !GENERIC.has(w)).length >= 2 && shared.length / Math.min(A.size, B.size) >= 0.55;
}
const HOSPITAL = /(hospital|medical college|aiims|esic|healthcare facility|health centre|health center|clinic|रुग्णालय|अस्पताल|मेडिकल)/i;
const TOPICS = [
  // rules for hospitals and medical devices (CDSCO's drug news is not ours)
  ['regulation', { test: t => /(nabh|nabl|medical devices? rules?|hospital accreditation)/i.test(t) || (/(cdsco|\bbis\b|guideline|notification|regulat|compliance|norms|gazette)/i.test(t) && /(medical device|hospital|equipment|operation theatre)/i.test(t)) }],
  ['ot', /(operation theatre|operating room|\bot\b|modular ot|laminar|hepa|cleanroom|clean room|hvac|medical gas|mgps|pendant|surgical light|icu|infection control|sterile|cssd|ahu)/i],
  ['medtech', /(medical device|medtech|med-tech|diagnostic|imaging|robot|equipment|ventilator maker|implant|monitor)/i],
];
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'];
const CITIES = { Pune: 'Maharashtra', Mumbai: 'Maharashtra', Nagpur: 'Maharashtra', Nashik: 'Maharashtra', Aurangabad: 'Maharashtra', 'Chhatrapati Sambhajinagar': 'Maharashtra', Amravati: 'Maharashtra', Akola: 'Maharashtra',
  Kolhapur: 'Maharashtra', Solapur: 'Maharashtra', Thane: 'Maharashtra', 'Navi Mumbai': 'Maharashtra', Latur: 'Maharashtra', Nanded: 'Maharashtra', Satara: 'Maharashtra', Sangli: 'Maharashtra', Jalgaon: 'Maharashtra', Chandrapur: 'Maharashtra',
  Ahmedabad: 'Gujarat', Surat: 'Gujarat', Vadodara: 'Gujarat', Rajkot: 'Gujarat', Bengaluru: 'Karnataka', Bangalore: 'Karnataka', Mysuru: 'Karnataka', Hubballi: 'Karnataka', Belagavi: 'Karnataka', Mangaluru: 'Karnataka',
  Chennai: 'Tamil Nadu', Coimbatore: 'Tamil Nadu', Madurai: 'Tamil Nadu', Hyderabad: 'Telangana', Warangal: 'Telangana', Visakhapatnam: 'Andhra Pradesh', Vijayawada: 'Andhra Pradesh', Kochi: 'Kerala', Thiruvananthapuram: 'Kerala',
  Kozhikode: 'Kerala', Jaipur: 'Rajasthan', Jodhpur: 'Rajasthan', Udaipur: 'Rajasthan', Indore: 'Madhya Pradesh', Bhopal: 'Madhya Pradesh', Jabalpur: 'Madhya Pradesh', Raipur: 'Chhattisgarh', Lucknow: 'Uttar Pradesh',
  Kanpur: 'Uttar Pradesh', Varanasi: 'Uttar Pradesh', Noida: 'Uttar Pradesh', Agra: 'Uttar Pradesh', Prayagraj: 'Uttar Pradesh', Gorakhpur: 'Uttar Pradesh', Dehradun: 'Uttarakhand', Patna: 'Bihar', Ranchi: 'Jharkhand',
  Kolkata: 'West Bengal', Bhubaneswar: 'Odisha', Guwahati: 'Assam', Gurugram: 'Haryana', Gurgaon: 'Haryana', Faridabad: 'Haryana', Ludhiana: 'Punjab', Amritsar: 'Punjab', Mohali: 'Punjab', Srinagar: 'Jammu and Kashmir',
  Jammu: 'Jammu and Kashmir', Shimla: 'Himachal Pradesh', Panaji: 'Goa', 'New Delhi': 'Delhi' };
const CITY_RE = new RegExp(`\\b(${Object.keys(CITIES).sort((a, b) => b.length - a.length).join('|')})\\b`, 'i');
const STATE_RE = new RegExp(`\\b(${STATES.sort((a, b) => b.length - a.length).join('|')})\\b`, 'i');
const titleKey = t => String(t || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim().split(' ').filter(w => w.length > 2).slice(0, 9).sort().join(' ');

// one headline → its topic and score, or null when it is noise
export function classify(title, snippet, kind) {
  const text = `${title} ${snippet || ''}`;
  if (NOISE.test(title) || NOISE_IN.test(title)) return null;
  const topic = TOPICS.find(([, re]) => re.test(text))?.[0] || null;
  if (FOREIGN.test(title) && !CITY_RE.test(title) && !STATE_RE.test(title) && !/india/i.test(title)) return null;
  if (OFFTOPIC.test(title)) return null;
  if (kind === 'leads') {
    if (!HOSPITAL.test(title) || !LEAD.test(title)) return null;
    let score = 50 + (/(\d+)[- ]?bed/i.test(text) ? 20 : 0) + (/(inaugurat|foundation stone|bhoomi ?pujan|to come up|construction|sanction|approv|upcoming)/i.test(text) ? 15 : 0) + (topic === 'ot' ? 15 : 0);
    return { topic: 'leads', score };
  }
  if (!topic) return null; // publisher feeds carry a lot of general health news: keep only ours
  return { topic, score: topic === 'ot' ? 70 : topic === 'regulation' ? 60 : 40 };
}
export function placeOf(text) {
  const c = String(text || '').match(CITY_RE)?.[1];
  const city = c ? Object.keys(CITIES).find(k => k.toLowerCase() === c.toLowerCase()) : null;
  const st = String(text || '').match(STATE_RE)?.[1];
  return { place: city, state: city ? CITIES[city] : st ? STATES.find(s => s.toLowerCase() === st.toLowerCase()) : null };
}

// ---------------------------------------------------------------- reading the feeds
// the text of a feed field: CDATA opened, entities turned back into characters, THEN the HTML tags removed (a summary
// often comes as escaped HTML: &lt;a href=…&gt;)
const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => decode(x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))?.[1] || '');
export function parseFeed(xml) {
  return [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => {
    const x = m[0];
    let title = tag(x, 'title'), source = tag(x, 'source');
    const link = tag(x, 'link') || x.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)); // Google News: "Title - Source"
    const pub = tag(x, 'pubDate') || tag(x, 'dc:date');
    const d = pub ? new Date(pub) : null;
    return { title, link, source, published: d && !Number.isNaN(+d) ? d.toLocaleString('sv-SE').slice(0, 16) : null, snippet: tag(x, 'description').slice(0, 400) };
  }).filter(i => i.title && i.link);
}

let running = false;
export async function refresh(user = { name: 'system' }) {
  if (running) return { busy: true };
  running = true;
  const status = [], ins = db.prepare(`INSERT OR IGNORE INTO news_items (url, title, title_key, source, published, topic, score, snippet, place, state, feed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const seenKey = db.prepare("SELECT 1 FROM news_items WHERE title_key = ? AND found_at > datetime('now', '-30 days') LIMIT 1");
  // headlines of the last 3 weeks: the same story from another paper is not added again
  const recent = db.prepare("SELECT title FROM news_items WHERE found_at > datetime('now', '-21 days')").all().map(r => r.title);
  let added = 0;
  try {
    for (const f of feeds()) {
      try {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
        const get = () => fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; news reader)', accept: 'application/rss+xml, application/xml, text/xml' }, signal: ctl.signal });
        let r = await get();
        if (r.status === 429) { await new Promise(ok => setTimeout(ok, 15000)); r = await get(); } // asked to slow down: once more, later
        clearTimeout(timer);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const items = parseFeed(await r.text());
        let kept = 0;
        for (const it of items) {
          const c = classify(it.title, it.snippet, f.kind);
          if (!c) continue;
          const key = titleKey(it.title);
          if ((key && seenKey.get(key)) || recent.some(t => sameStory(t, it.title))) continue; // the same story from another paper
          const p = placeOf(`${it.title} ${it.snippet}`);
          if (ins.run(it.link, it.title.slice(0, 300), key, it.source || f.name, it.published, c.topic, c.score, it.snippet || null, p.place, p.state, f.name).changes) { kept++; added++; recent.push(it.title); }
        }
        status.push({ feed: f.name, ok: true, items: items.length, kept });
      } catch (e) { status.push({ feed: f.name, ok: false, error: String(e.message || e).slice(0, 120) }); }
      await new Promise(ok => setTimeout(ok, 3000)); // one feed at a time, slowly: a polite reader is not blocked
    }
    db.prepare("DELETE FROM news_items WHERE found_at < datetime('now', '-90 days') AND status IN ('new', 'dismissed')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('news_status', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ at: new Date().toLocaleString('sv-SE').slice(0, 16), feeds: status }));
    if (user.name !== 'system') audit(user.name, 'news', null, 'refresh', `${added} new`);
    return { added, feeds: status };
  } finally { running = false; }
}

// ---------------------------------------------------------------- the page
export const mayView = user => hasFunction(user.role, 'screen_news');
export function list(user, q = {}) {
  if (!mayView(user)) throw new HttpError(403, 'No access to the news');
  const where = ["status <> 'dismissed'"], args = [];
  if (q.tab === 'tech') where.push("topic IN ('ot', 'medtech')");
  else if (q.tab && q.tab !== 'all') { where.push('topic = ?'); args.push(q.tab); }
  if (q.state) { where.push('state = ?'); args.push(q.state); }
  if (q.q) { where.push('(title LIKE ? OR snippet LIKE ? OR place LIKE ?)'); const s = `%${String(q.q).slice(0, 60)}%`; args.push(s, s, s); }
  if (q.status === 'enquiry') where.push('enquiry_id IS NOT NULL');
  const rows = db.prepare(`SELECT id, url, title, source, published, topic, score, snippet, place, state, found_at, status, enquiry_id, by_name FROM news_items WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(published, found_at) DESC, score DESC LIMIT 300`).all(...args);
  const counts = Object.fromEntries(db.prepare("SELECT topic, COUNT(*) n FROM news_items WHERE status = 'new' AND found_at > datetime('now', '-7 days') GROUP BY topic").all().map(r => [r.topic, r.n]));
  const st = getSettings().news_status || null;
  return { rows, counts, states: db.prepare("SELECT state, COUNT(*) n FROM news_items WHERE state IS NOT NULL AND status <> 'dismissed' GROUP BY state ORDER BY n DESC").all(),
    status: st, can_enquire: canWrite('enquiries', user.role), can_refresh: user.role === 'admin' || canWrite('enquiries', user.role) };
}
export function setStatus(id, status, user) {
  if (!mayView(user)) throw new HttpError(403, 'No access to the news');
  if (!['new', 'seen', 'dismissed', 'lead'].includes(status)) throw new HttpError(400, 'Unknown status');
  db.prepare('UPDATE news_items SET status = ?, by_name = ? WHERE id = ?').run(status, user.name, Number(id));
  return { ok: true };
}
// a new hospital in the news → an enquiry to follow up (source: News), linked back to the headline
export function makeEnquiry(id, user) {
  if (!canWrite('enquiries', user.role)) throw new HttpError(403, 'You cannot create enquiries');
  const n = db.prepare('SELECT * FROM news_items WHERE id = ?').get(Number(id));
  if (!n) throw new HttpError(404, 'News item not found');
  if (n.enquiry_id && db.prepare('SELECT 1 FROM enquiries WHERE id = ?').get(n.enquiry_id)) return { enquiry_id: n.enquiry_id, existing: true };
  const e = insertRow('enquiries', { date: today(), hospital_name: n.title.slice(0, 120), place: n.place || null, state: n.state || null, source: 'News', enquiry_by: user.name, status: 'New', lead_grade: 'Cold',
    remarks: `From the news (${n.source}${n.published ? ', ' + n.published.slice(0, 10) : ''}): ${n.title}\n${n.url}\nFind the hospital, the promoter / doctor and their contact; then grade the lead.` }, user);
  db.prepare("UPDATE news_items SET status = 'lead', enquiry_id = ?, by_name = ? WHERE id = ?").run(e.id, user.name, n.id);
  audit(user.name, 'news', n.id, 'enquiry', e.enquiry_no || String(e.id));
  return { enquiry_id: e.id };
}

// once a day (after 10): sales and marketing hear about the new hospitals found since yesterday
export function dailyNews() {
  const t = today();
  if (getSettings().news_alerts === t) return 0;
  const leads = db.prepare("SELECT title, place, state FROM news_items WHERE topic = 'leads' AND status = 'new' AND found_at > datetime('now', '-1 day') ORDER BY score DESC LIMIT 8").all();
  let sent = 0;
  if (leads.length) sent = notify({ fn: 'notify_enquiry', kind: 'news', title: `📰 ${leads.length} new hospital${leads.length === 1 ? '' : 's'} in the news`,
    body: leads.map(l => `${l.title}${l.place || l.state ? ` (${[l.place, l.state].filter(Boolean).join(', ')})` : ''}`).join('\n'), link: '#/news' }, { name: 'system' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('news_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(t));
  return sent;
}
