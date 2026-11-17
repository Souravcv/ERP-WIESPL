// Match a work-order / BOQ material ("Sight Glass", spec "for 3/8 size, Brazing type") to a store item ("Sight Glass - 3/8").
// Words of the name are compared loosely (Flaire ≈ Flare, Herrix ≈ Harris, thermostatic ≈ Thermostaic); sizes must agree:
// a 3/8 line never links to a 1/2 item. Confident = a clear best: it is linked by itself; the others are suggestions.
import { db } from './db.js';

const STOP = new Set(['and', 'for', 'with', 'the', 'size', 'sizes', 'siz', 'sizr', 'gauge', 'above', 'type', 'make', 'any', 'nos', 'no', 'each', 'set', 'complete', 'hardened',
  'colour', 'color', 'model', 'name', 'capacity', 'item', 'material', 'supply', 'installation', 'of', 'in', 'or', 'to', 'mm', 'rft', 'mtr', 'sq', 'ft', 'kg', 'per', 'only']);
const norm = s => String(s || '').toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/×/g, 'x');
// sizes: 3/8, 1 1/8, 7/8; 4 TR; 300*75 / 610 x 610 x 305; 2000 cfm; 5.5 kw
export function sizesOf(text) {
  const t = norm(text), out = new Set();
  for (const m of t.matchAll(/(?<![\d/])(\d+\s+)?(\d+)\s*\/\s*(\d+)(?![\d/])/g)) out.add(`${m[1] ? m[1].trim() + ' ' : ''}${m[2]}/${m[3]}`);
  for (const m of t.matchAll(/(\d+)\s*(?:ft|feet)?\s*[x*]\s*(\d+)(?:\s*(?:ft|feet)?\s*[x*]\s*(\d+))?/g)) out.add([m[1], m[2], m[3]].filter(Boolean).join('x'));
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(tr|cfm|kw|hp|w|a|mm|amp|ft|feet)\b/g)) if (!/[x*]\s*$/.test(t.slice(0, m.index))) out.add(`${Number(m[1])}${m[2] === 'feet' ? 'ft' : m[2]}`);
  return out;
}
const kindOf = s => (s.includes('/') ? 'frac' : s.includes('x') ? 'dims' : s.replace(/[\d.]/g, ''));
const wordsOf = text => [...new Set(norm(text).replace(/\d+(\.\d+)?/g, ' ').split(/[^a-z]+/).filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.replace(/(es|s)$/, '')))];
const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
// the same word, a longer form of it, or a misspelling (one letter in short words, two in long ones)
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)))
  || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1) && a[0] === b[0]);

let cache = null, cacheAt = 0;
export function storeItems() {
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  cache = db.prepare("SELECT id, code, name, COALESCE(description, '') description, uom FROM items").all()
    .map(i => ({ ...i, words: wordsOf(i.name), sizes: sizesOf(`${i.name} ${i.description}`) }));
  cacheAt = Date.now();
  return cache;
}

// name = the material ("Flaire Nut"); spec = its specification ("Size 3/8 Hardened")
export function matchItem(name, spec = '', items = storeItems()) {
  const nWords = wordsOf(name), allText = `${name} ${spec}`, aWords = wordsOf(allText), sizes = sizesOf(allText);
  if (!nWords.length) return { best: null, candidates: [], confident: false };
  const scored = [];
  for (const it of items) {
    const hitName = nWords.filter(w => it.words.some(x => same(w, x))).length;
    if (!hitName) continue;
    const extra = it.words.filter(x => !aWords.some(w => same(w, x))).length; // words of the item the line does not have (Aluminum, Silver …)
    let score = hitName / nWords.length - 0.15 * extra / Math.max(1, it.words.length);
    if (sizes.size && it.sizes.size) {
      // a size of a kind both give must agree: a 3/8 line never takes a 1/2 item, 2×2 ft never a 4 ft one
      const kinds = new Set([...sizes].map(kindOf).filter(k => [...it.sizes].some(s => kindOf(s) === k)));
      if (!kinds.size || [...kinds].some(k => ![...sizes].some(s => kindOf(s) === k && it.sizes.has(s)))) continue;
      score += 0.25 * [...sizes].filter(s => it.sizes.has(s)).length / sizes.size;
    } else if (sizes.size && !it.sizes.size) score -= 0.1;
    else if (!sizes.size && it.sizes.size) score -= 0.05;
    scored.push({ id: it.id, label: `${it.code ? it.code + ' · ' : ''}${it.name}`, uom: it.uom, score: Math.round(score * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score);
  const [a, b] = scored;
  const confident = !!a && a.score >= 0.75 && (!b || a.score - b.score >= 0.15);
  return { best: a || null, candidates: scored.slice(0, 5), confident };
}
