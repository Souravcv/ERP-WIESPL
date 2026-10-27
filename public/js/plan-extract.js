// Turns a parsed DWG (libredwg-web DwgDatabase) into plain plan geometry for the 3D viewer:
// line segments per layer (in metres, blocks exploded, arcs and bulges tessellated), room / label texts,
// and the separate drawing areas on the sheet (a DWG often holds the plan plus other drawings far away).
// No DOM: runs in the Web Worker (plan-worker.js) and in Node for testing.

const UNIT_TO_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 }; // INSUNITS: inch, feet, mm, cm, m, dm

// MTEXT formatting codes → plain text with line breaks
export function cleanText(s) {
  return String(s || '')
    .replace(/\\P/g, '\n')
    .replace(/\\[pPfFHhWwQqTtCcAa][^;]*;/g, '')
    .replace(/\\[LlOoKkNn]/g, '')
    .replace(/\\S([^;]*);/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
    .replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').trim();
}

// 2D affine transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const insertMatrix = (ins, base) => {
  const r = ins.rotation || 0, sx = ins.xScale ?? 1, sy = ins.yScale ?? 1, c = Math.cos(r), s = Math.sin(r);
  const p = ins.insertionPoint || { x: 0, y: 0 }, b = base || { x: 0, y: 0 };
  // T(p) · R(r) · S(sx, sy) · T(-base)
  let m = [sx, 0, 0, sy, -b.x * sx, -b.y * sy];
  m = mul([c, s, -s, c, 0, 0], m);
  m[4] += p.x; m[5] += p.y;
  if ((ins.extrusionDirection?.z ?? 1) < 0) m = mul([-1, 0, 0, 1, 0, 0], m); // mirrored (OCS z = −1)
  return m;
};

export function extractPlan(db, { maxSegments = 600000 } = {}) {
  const scale = UNIT_TO_M[db.header?.INSUNITS] ?? 0.001;
  const blocks = new Map((db.tables?.BLOCK_RECORD?.entries || []).map(b => [b.name, b]));
  const modelSpace = (db.tables?.BLOCK_RECORD?.entries || []).find(b => /^\*model_space$/i.test(b.name));
  const roots = modelSpace?.entities?.length ? modelSpace.entities : (db.entities || []).filter(e => !modelSpace || e.ownerBlockRecordSoftId === modelSpace.handle);
  const layerColors = Object.fromEntries((db.tables?.LAYER?.entries || []).map(l => [l.name, l.colorIndex]));
  const layers = {};   // name → number[] (x1, y1, x2, y2, …) in metres
  const texts = [];
  let count = 0, skipped = 0;
  const seg = (layer, m, x1, y1, x2, y2) => {
    if (count >= maxSegments) { skipped++; return; }
    const [a, b] = ap(m, x1, y1), [c, d] = ap(m, x2, y2);
    (layers[layer] ||= []).push(a * scale, b * scale, c * scale, d * scale); count++;
  };
  const arcPts = (cx, cy, r, a0, a1) => {
    while (a1 <= a0) a1 += Math.PI * 2;
    const n = Math.max(4, Math.ceil((a1 - a0) / (Math.PI / 18)));
    const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  };
  const poly = (layer, m, pts) => { for (let i = 0; i < pts.length - 1; i++) seg(layer, m, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); };

  const walk = (ents, m, parentLayer, depth) => {
    if (depth > 8) return;
    for (const e of ents || []) {
      if (e.isVisible === false) continue;                       // hidden states of dynamic blocks
      const layer = (e.layer === '0' || !e.layer) && parentLayer ? parentLayer : e.layer || '0';
      const mirror = (e.extrusionDirection?.z ?? 1) < 0;
      const mm = mirror ? mul(m, [-1, 0, 0, 1, 0, 0]) : m;
      switch (e.type) {
        case 'LINE': seg(layer, m, e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y); break;
        case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': {
          const v = e.vertices || []; if (v.length < 2) break;
          const closed = (e.flag & 1) || e.closed;
          const list = closed ? [...v, v[0]] : v;
          for (let i = 0; i < list.length - 1; i++) {
            const p = list[i], q = list[i + 1], bulge = p.bulge || 0;
            if (Math.abs(bulge) < 1e-9) { seg(layer, mm, p.x, p.y, q.x, q.y); continue; }
            const ang = 4 * Math.atan(bulge), dx = q.x - p.x, dy = q.y - p.y, chord = Math.hypot(dx, dy);
            if (chord < 1e-9) continue;
            const r = chord / (2 * Math.sin(Math.abs(ang) / 2)), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
            const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * Math.sign(bulge) * (Math.abs(ang) > Math.PI ? -1 : 1);
            const cx = mx - h * dy / chord, cy = my + h * dx / chord;
            let a0 = Math.atan2(p.y - cy, p.x - cx), a1 = Math.atan2(q.y - cy, q.x - cx);
            const pts = bulge > 0 ? arcPts(cx, cy, r, a0, a1) : arcPts(cx, cy, r, a1, a0).reverse();
            poly(layer, mm, pts);
          }
          break;
        }
        case 'ARC': poly(layer, mm, arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle)); break;
        case 'CIRCLE': poly(layer, mm, arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2)); break;
        case 'TEXT': case 'MTEXT': {
          const p = e.insertionPoint || e.startPoint; if (!p) break;
          const t = cleanText(e.text); if (!t) break;
          const [x, y] = ap(m, p.x, p.y);
          texts.push({ x: x * scale, y: y * scale, h: (e.textHeight || 100) * scale * Math.hypot(m[0], m[1]), t, layer, w: e.type === 'MTEXT' ? (e.rectWidth || 0) * scale : 0 });
          break;
        }
        case 'INSERT': {
          const b = blocks.get(e.name); if (!b) break;
          walk(b.entities, mul(m, insertMatrix(e, b.basePoint)), layer, depth + 1);
          break;
        }
        default: break; // HATCH, DIMENSION, VIEWPORT, ATTRIB …: not needed for the 3D plan
      }
    }
  };
  walk(roots, [1, 0, 0, 1, 0, 0], null, 0);

  // separate drawing areas: 10 m grid cells, connected groups, biggest first
  const CELL = 10, cells = new Map();
  for (const [name, a] of Object.entries(layers)) for (let i = 0; i < a.length; i += 4) {
    const k = `${Math.floor(a[i] / CELL)},${Math.floor(a[i + 1] / CELL)}`; cells.set(k, (cells.get(k) || 0) + 1);
  }
  const seen = new Set(), areas = [];
  for (const k of cells.keys()) {
    if (seen.has(k)) continue;
    const stack = [k]; seen.add(k); let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    while (stack.length) {
      const c = stack.pop(); n += cells.get(c); const [cx, cy] = c.split(',').map(Number);
      x0 = Math.min(x0, cx * CELL); y0 = Math.min(y0, cy * CELL); x1 = Math.max(x1, (cx + 1) * CELL); y1 = Math.max(y1, (cy + 1) * CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const nk = `${cx + dx},${cy + dy}`; if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); } }
    }
    areas.push({ x0, y0, x1, y1, n });
  }
  areas.sort((a, b) => b.n - a.n);
  const round = a => a.map(v => Math.round(v * 1000) / 1000);
  return {
    version: 1, units: 'm', segments: count, skipped,
    layers: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, { color: layerColors[k] ?? 7, segs: round(v) }])),
    texts: texts.map(t => ({ ...t, x: Math.round(t.x * 1000) / 1000, y: Math.round(t.y * 1000) / 1000 })),
    areas: areas.slice(0, 12),
  };
}

// First guess of what each layer is (the user can change it in the viewer)
export function guessRole(name) {
  const n = String(name).toUpperCase();
  if (/DIM|DEFPOINT|HATCH|VIEWPORT|TITLE|BORDER|GRID|ANNO-SYMB|TICK|^0$/.test(n)) return 'hide';
  if (/TEXT|ANNO|TAG|NOTE|LABEL/.test(n)) return 'hide';
  if (/GLASS|GLAZ|WFRM|WINDOW|WIN\b|CURTAIN WALL/.test(n)) return 'glass';
  if (/DOOR/.test(n)) return 'door';
  if (/COLUMN|COL\b|STR-R|STRUCT/.test(n)) return 'column';
  if (/WALL|BRWL|BWL|PARTI|PANEL|NICOMAC|HPL|SHAFT/.test(n)) return 'wall';
  if (/FURN|FRN|EQUP|MQUP|SANI|TFIX|FIXT|TOILET|SANITARY|CARP|CRTN|HVAC|GRILLE|FC\b|HUM|LIGHT/.test(n)) return 'furniture';
  if (/STR|STAIR|OVHD|OVHL|DRWG|DRWH/.test(n)) return 'floor';
  return 'floor';
}
