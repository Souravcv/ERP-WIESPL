// Room labels of a CAD drawing: the size written in a label, and which labels are operation theatres.
// No DOM: used by the CAD viewer (views/plan3d-extras.js) and by the Basis of Design on the server (server/bod.js).

// "OPERATION THEATER 01\n7722 x 6692 MM" → { name: 'OPERATION THEATER 01', w: 7.722, d: 6.692 } (metres); null when no size
// feet and inches: 22'-0"X19'-1½" (½ ¼ ¾, or a damaged character where the fraction was) → metres
const FT_IN = /(\d{1,3})\s*'\s*-?\s*(\d{1,2})?\s*(½|¼|¾|�|\s\d\/\d)?\s*"?\s*[xX×]\s*(\d{1,3})\s*'\s*-?\s*(\d{1,2})?\s*(½|¼|¾|�|\s\d\/\d)?\s*"?/;
const frac = f => (!f ? 0 : f === '½' || f === '�' ? 0.5 : f === '¼' ? 0.25 : f === '¾' ? 0.75 : (([n, d]) => n / d)(f.trim().split('/').map(Number)));
const feetIn = (ft, inch, f) => (Number(ft) * 12 + Number(inch || 0) + frac(f)) * 0.0254;
export function roomSize(text) {
  const s = String(text || '');
  const fi = s.match(FT_IN);
  if (fi) {
    const w = feetIn(fi[1], fi[2], fi[3]), d = feetIn(fi[4], fi[5], fi[6]);
    if (w < 1.5 || w > 20 || d < 1.5 || d > 20) return null;
    return { name: s.slice(0, fi.index).replace(/\s+/g, ' ').trim() || s.split('\n')[0].trim(), w, d };
  }
  const m = s.match(/(\d{3,6})\D{0,3}[xX×]\s*(\d{3,5})\s*MM/i);
  if (!m) return null;
  let a = m[1], b = Number(m[2]), extra = '';
  if (Number(a) > 20000) { extra = a.slice(0, -4); a = a.slice(-4); } // "THEATER 065853x" → room "06", 5853 mm
  a = Number(a);
  if (a < 1500 || a > 20000 || b < 1500 || b > 20000) return null;
  const name = s.slice(0, m.index).replace(/\s+/g, ' ').trim() + extra; // every line above the size: "OPERATION THEATER 06 (ROBOTICS)"
  return { name: name || s.split('\n')[0].trim(), w: a / 1000, d: b / 1000 };
}
export const isOt = name => /THEAT|\bOT\b|OPERATION|CATH|HYBRID|PROCEDURE/i.test(name) && !/STORE|DOOR|CORRIDOR|COORDINATOR|STATION|PHARMACY|MANAGER|RECOVERY|HOLDING|CHANGE|TOILET|SCRUB|STERILE|DUTY|LOUNGE|WAITING/i.test(name);
