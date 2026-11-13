// A DXF reader of our own for the 3D plan: DXF is AutoCAD's plain-text format, so it is read here without the DWG
// decoder (which garbles some drawings). Returns the same shape extractPlan() reads from the DWG reader:
// { header: { INSUNITS }, tables: { LAYER: { entries }, BLOCK_RECORD: { entries: [{ name, basePoint, entities }] } } }
// Only what the plan needs: lines, polylines, arcs, circles, texts and block inserts (blocks exploded later).
// No DOM: runs in the browser worker and in Node.

const RAD = Math.PI / 180;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function readDxf(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const next = () => { if (i + 1 >= lines.length) return null; const code = parseInt(lines[i], 10); const value = lines[i + 1]; i += 2; return [code, value]; };
  const header = {}, layerEntries = [], blocks = [], modelEntities = [];

  // all group pairs of one entity (up to the next code 0)
  const readEntity = type => {
    const g = [];
    while (i < lines.length) { if (parseInt(lines[i], 10) === 0) break; const p = next(); if (!p) break; g.push(p); }
    return toEntity(type, g);
  };

  while (i < lines.length) {
    const p = next(); if (!p) break;
    if (p[0] !== 0 || p[1].trim() !== 'SECTION') continue;
    const s = next(); const section = s?.[1]?.trim();
    if (section === 'HEADER') {
      let key = null;
      while (i < lines.length) {
        const q = next(); if (!q) break;
        if (q[0] === 0 && q[1].trim() === 'ENDSEC') break;
        if (q[0] === 9) key = q[1].trim();
        else if (key === '$INSUNITS' && q[0] === 70) header.INSUNITS = parseInt(q[1], 10);
      }
    } else if (section === 'TABLES') {
      while (i < lines.length) {
        const q = next(); if (!q) break;
        if (q[0] === 0 && q[1].trim() === 'ENDSEC') break;
        if (q[0] === 0 && q[1].trim() === 'LAYER') {
          const g = []; while (i < lines.length && parseInt(lines[i], 10) !== 0) g.push(next());
          const name = g.find(x => x[0] === 2)?.[1]?.trim();
          if (name != null) layerEntries.push({ name, colorIndex: Math.abs(parseInt(g.find(x => x[0] === 62)?.[1] ?? '7', 10)) });
        }
      }
    } else if (section === 'BLOCKS') {
      let cur = null;
      while (i < lines.length) {
        const q = next(); if (!q) break;
        if (q[0] !== 0) continue;
        const t = q[1].trim();
        if (t === 'ENDSEC') break;
        if (t === 'BLOCK') {
          const g = []; while (i < lines.length && parseInt(lines[i], 10) !== 0) g.push(next());
          cur = { name: g.find(x => x[0] === 2)?.[1]?.trim() || '', basePoint: { x: num(g.find(x => x[0] === 10)?.[1]), y: num(g.find(x => x[0] === 20)?.[1]) }, entities: [] };
          blocks.push(cur);
        } else if (t === 'ENDBLK') { while (i < lines.length && parseInt(lines[i], 10) !== 0) next(); cur = null; }
        else if (cur) pushEntity(cur.entities, t);
        else readEntity(t);
      }
    } else if (section === 'ENTITIES') {
      while (i < lines.length) {
        if (parseInt(lines[i], 10) === 0 && lines[i + 1]?.trim() === 'ENDSEC') { next(); break; }
        const q = next(); if (!q) break;
        if (q[0] === 0) pushEntity(modelEntities, q[1].trim());
      }
    }
  }

  // POLYLINE is followed by VERTEX … SEQEND: gather them into one entity
  function pushEntity(list, type) {
    if (type === 'POLYLINE') {
      const head = readEntity('POLYLINE'); const vertices = [];
      while (i < lines.length && parseInt(lines[i], 10) === 0) {
        const t = lines[i + 1].trim();
        if (t === 'VERTEX') { next(); const v = readEntity('VERTEX'); if (!(v.flags & 16)) vertices.push(v); }
        else if (t === 'SEQEND') { next(); readEntity('SEQEND'); break; }
        else break;
      }
      head.vertices = vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge }));
      list.push(head);
      return;
    }
    const e = readEntity(type);
    if (e) list.push(e);
  }

  return {
    header,
    tables: { LAYER: { entries: layerEntries }, BLOCK_RECORD: { entries: [{ name: '*Model_Space', basePoint: { x: 0, y: 0 }, entities: modelEntities }, ...blocks.filter(b => !/^\*model_space$/i.test(b.name))] } },
  };
}

function toEntity(type, g) {
  const get = (c, d) => { const p = g.find(x => x[0] === c); return p ? p[1] : d; };
  const n = (c, d = 0) => { const p = g.find(x => x[0] === c); return p ? num(p[1]) : d; };
  const base = { type, layer: (get(8, '0') || '0').trim(), isVisible: get(60, '0').trim() !== '1', extrusionDirection: { x: n(210), y: n(220), z: n(230, 1) } };
  switch (type) {
    case 'LINE': return { ...base, startPoint: { x: n(10), y: n(20) }, endPoint: { x: n(11), y: n(21) } };
    case 'LWPOLYLINE': {
      const vertices = []; let v = null;
      for (const [c, val] of g) {
        if (c === 10) { v = { x: num(val), y: 0, bulge: 0 }; vertices.push(v); }
        else if (c === 20 && v) v.y = num(val);
        else if (c === 42 && v) v.bulge = num(val);
      }
      return { ...base, flag: parseInt(get(70, '0'), 10), vertices };
    }
    case 'POLYLINE': return { ...base, type: 'POLYLINE2D', flag: parseInt(get(70, '0'), 10), vertices: [] };
    case 'VERTEX': return { x: n(10), y: n(20), bulge: n(42), flags: parseInt(get(70, '0'), 10) };
    case 'ARC': return { ...base, center: { x: n(10), y: n(20) }, radius: n(40), startAngle: n(50) * RAD, endAngle: n(51) * RAD };
    case 'CIRCLE': return { ...base, center: { x: n(10), y: n(20) }, radius: n(40) };
    case 'TEXT': case 'ATTRIB': return { ...base, type: 'TEXT', insertionPoint: { x: n(10), y: n(20) }, textHeight: n(40, 1), text: get(1, '') };
    case 'MTEXT': {
      const parts = g.filter(x => x[0] === 3).map(x => x[1]); // long texts come in 250-character pieces
      return { ...base, insertionPoint: { x: n(10), y: n(20) }, textHeight: n(40, 1), rectWidth: n(41), text: parts.join('') + get(1, '') };
    }
    case 'INSERT': return { ...base, name: (get(2, '') || '').trim(), insertionPoint: { x: n(10), y: n(20) }, xScale: n(41, 1), yScale: n(42, 1), rotation: n(50) * RAD, columnCount: n(70, 1), rowCount: n(71, 1), columnSpacing: n(44), rowSpacing: n(45) };
    default: return { ...base };
  }
}
