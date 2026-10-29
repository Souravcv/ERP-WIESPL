// Root cause analysis pictures, shared by the NCR screen, the Quality tab and the NCR print: the fishbone (6M) diagram,
// the process map with where the defect got in / escaped, and the Pareto chart (bars + cumulative %, 80% line).
// Built as SVG text (fixed colours so they print the same).
import { h } from '../ui.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const svgBox = (markup, label) => { const d = h('div', { role: 'img', 'aria-label': label, style: { width: '100%', overflowX: 'auto' } }); d.innerHTML = markup; return d; };
const INK = '#1f2937', QUIET = '#6b7280', LINE = '#9ca3af', ACCENT = '#1f4e9a', BAD = '#c0392b', WARN = '#d9822b', GOOD = '#2e7d32';

// Fishbone: the effect at the head, Man / Machine / Method above the spine, Material / Measurement / Environment below.
export function fishbone(effect, causes = []) {
  const top = ['Man', 'Machine', 'Method'], bottom = ['Material', 'Measurement', 'Environment'];
  const by = k => causes.filter(c => c.category === k && String(c.cause || '').trim());
  const rowsUp = Math.max(1, ...top.map(k => Math.min(6, by(k).length))), rowsDown = Math.max(1, ...bottom.map(k => Math.min(6, by(k).length)));
  const W = 920, xs = [60, 290, 520], bone = 150, upH = rowsUp * 17 + 34, spineY = 30 + upH, H = spineY + rowsDown * 17 + 44;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;font-family:inherit;display:block" xmlns="http://www.w3.org/2000/svg">`;
  s += `<line x1="40" y1="${spineY}" x2="740" y2="${spineY}" stroke="${INK}" stroke-width="2.5"/><path d="M740 ${spineY - 7}L752 ${spineY}L740 ${spineY + 7}z" fill="${INK}"/>`;
  s += `<rect x="756" y="${spineY - 34}" width="156" height="68" rx="8" fill="#eef3fb" stroke="${ACCENT}" stroke-width="1.5"/>`;
  const head = cut(effect, 66), parts = [head.slice(0, 22), head.slice(22, 44), head.slice(44)].filter(Boolean);
  parts.forEach((p, i) => { s += `<text x="834" y="${spineY - 8 + i * 15 - (parts.length - 1) * 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${INK}">${esc(p)}</text>`; });
  const draw = (k, x, up) => {
    const y0 = up ? 26 : H - 22, list = by(k);
    s += `<line x1="${x}" y1="${y0}" x2="${x + bone}" y2="${spineY}" stroke="${LINE}" stroke-width="1.5"/>`;
    s += `<text x="${x - 6}" y="${up ? y0 - 6 : y0 + 14}" font-size="12.5" font-weight="700" fill="${ACCENT}">${esc(k)}</text>`;
    list.slice(0, 6).forEach((c, i) => {
      const y = up ? y0 + 22 + i * 17 : y0 - 16 - i * 17, f = (y - y0) / (spineY - y0), x1 = x + f * bone + 8;
      const col = c.check === 'Confirmed' ? BAD : c.check === 'Ruled out' ? QUIET : WARN, mark = c.check === 'Confirmed' ? '● ' : c.check === 'Ruled out' ? '○ ' : '? ';
      s += `<text x="${x1}" y="${y}" font-size="11.5" fill="${col}" font-weight="${c.check === 'Confirmed' ? 700 : 400}"${c.check === 'Ruled out' ? ' text-decoration="line-through"' : ''}>${esc(mark + cut(c.cause, 30))}</text>`;
    });
    if (list.length > 6) s += `<text x="${x + bone * 0.5}" y="${up ? spineY - 6 : spineY + 14}" font-size="11" fill="${QUIET}">+${list.length - 6} more</text>`;
  };
  top.forEach((k, i) => draw(k, xs.at(i), true));
  bottom.forEach((k, i) => draw(k, xs.at(i), false));
  s += '</svg>';
  return h('div', svgBox(s, 'Fishbone diagram'), h('div.muted', { style: { fontSize: '12px', marginTop: '4px' } }, '● confirmed (red) · ○ ruled out · ? still to check'));
}

// Process map: steps left to right (4 a row), the check at each, where the defect got in (red) or escaped (orange).
export function processMap(steps = []) {
  const list = steps.filter(p => String(p.step || '').trim());
  const per = 4, bw = 196, bh = 72, gx = 34, gy = 36, rows = Math.ceil(list.length / per) || 1, W = per * bw + (per - 1) * gx + 20, H = rows * bh + (rows - 1) * gy + 20;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;font-family:inherit;display:block" xmlns="http://www.w3.org/2000/svg"><defs><marker id="pm-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${LINE}"/></marker></defs>`;
  list.forEach((p, i) => {
    const r = Math.floor(i / per), c = i % per, x = 10 + c * (bw + gx), y = 10 + r * (bh + gy);
    const col = /entered/.test(p.finding || '') ? BAD : /Escaped/.test(p.finding || '') ? WARN : p.finding === 'OK' ? GOOD : LINE;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${col === LINE ? 'none' : col + '14'}" stroke="${col}" stroke-width="${col === LINE ? 1.2 : 2}"/>`;
    s += `<text x="${x + 10}" y="${y + 19}" font-size="12" font-weight="700" fill="${INK}">${esc(`${i + 1}. ${cut(p.step, 24)}`)}</text>`;
    s += `<text x="${x + 10}" y="${y + 36}" font-size="11" fill="${QUIET}">${esc(cut([p.owner, p.control].filter(Boolean).join(' · '), 32))}</text>`;
    if (p.finding && p.finding !== 'OK') s += `<text x="${x + 10}" y="${y + 54}" font-size="11" font-weight="700" fill="${col}">${esc(cut(p.finding, 32))}</text>`;
    else if (p.remark) s += `<text x="${x + 10}" y="${y + 54}" font-size="11" fill="${QUIET}">${esc(cut(p.remark, 32))}</text>`;
    if (i < list.length - 1) {
      if (c < per - 1) s += `<line x1="${x + bw}" y1="${y + bh / 2}" x2="${x + bw + gx - 2}" y2="${y + bh / 2}" stroke="${LINE}" stroke-width="1.3" marker-end="url(#pm-a)"/>`;
      else s += `<path d="M${x + bw / 2} ${y + bh}V${y + bh + gy / 2}H${10 + bw / 2}V${y + bh + gy - 2}" fill="none" stroke="${LINE}" stroke-width="1.3" marker-end="url(#pm-a)"/>`;
    }
  });
  s += '</svg>';
  return h('div', svgBox(s, 'Process map'), h('div.muted', { style: { fontSize: '12px', marginTop: '4px' } }, 'Red: the defect got in here · orange: a check let it through · green: checked OK'));
}

// Pareto chart: bars largest first (the vital few dark), cumulative % line, 80% line; highlighted keys outlined.
export function pareto(a, highlight = []) {
  const rows = (a.rows || []).slice(0, 12);
  if (!rows.length) return h('p.muted', 'Nothing recorded in this period.');
  const W = 700, L = 44, Rm = 44, T = 16, plotH = 170, bottomH = 64, H = T + plotH + bottomH, max = rows[0].value || 1, bw = Math.min(84, (W - L - Rm) / rows.length);
  const yv = v => T + plotH - (v / max) * plotH, yc = p => T + plotH - (p / 100) * plotH;
  const unit = a.measure === 'cost' ? '₹' : '';
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;font-family:inherit;display:block" xmlns="http://www.w3.org/2000/svg">`;
  s += `<line x1="${L}" y1="${T + plotH}" x2="${W - Rm}" y2="${T + plotH}" stroke="${LINE}"/><line x1="${L}" y1="${yc(80)}" x2="${W - Rm}" y2="${yc(80)}" stroke="${WARN}" stroke-dasharray="4 4"/>`;
  s += `<text x="${W - Rm + 4}" y="${yc(80) + 4}" font-size="11" fill="${WARN}">80%</text><text x="${W - Rm + 4}" y="${yc(100) + 4}" font-size="11" fill="${QUIET}">100%</text>`;
  let pts = '';
  rows.forEach((r, i) => {
    const x = L + i * bw + 4, w = bw - 8, hi = highlight.includes(r.key);
    s += `<rect x="${x}" y="${yv(r.value)}" width="${w}" height="${T + plotH - yv(r.value)}" fill="${r.vital ? ACCENT : '#9fb4d8'}"${hi ? ` stroke="${BAD}" stroke-width="3"` : ''}/>`;
    s += `<text x="${x + w / 2}" y="${yv(r.value) - 4}" text-anchor="middle" font-size="11" fill="${INK}">${esc(unit + (Math.round(r.value * 10) / 10).toLocaleString('en-IN'))}</text>`;
    const words = cut(r.key, 26).split(' '), l1 = [], l2 = [];
    for (const wd of words) ((l1.join(' ') + ' ' + wd).trim().length <= 13 && !l2.length ? l1 : l2).push(wd);
    s += `<text x="${x + w / 2}" y="${T + plotH + 15}" text-anchor="middle" font-size="10.5" fill="${hi ? BAD : INK}" font-weight="${hi ? 700 : 400}">${esc(l1.join(' '))}</text>`;
    if (l2.length) s += `<text x="${x + w / 2}" y="${T + plotH + 28}" text-anchor="middle" font-size="10.5" fill="${hi ? BAD : INK}" font-weight="${hi ? 700 : 400}">${esc(cut(l2.join(' '), 14))}</text>`;
    pts += `${x + w / 2},${yc(r.cum)} `;
  });
  s += `<polyline points="${pts}" fill="none" stroke="${BAD}" stroke-width="1.6"/>`;
  rows.forEach((r, i) => { s += `<circle cx="${L + i * bw + bw / 2}" cy="${yc(r.cum)}" r="3" fill="${BAD}"/>`; });
  s += `<text x="${L}" y="${H - 6}" font-size="11" fill="${QUIET}">${esc(`${a.by_label} · ${a.measure === 'cost' ? 'cost of rework + scrap' : a.measure === 'qty' ? 'quantity' : 'count'} · dark bars = the vital few (to 80%) · red line = cumulative %`)}</text>`;
  s += '</svg>';
  return svgBox(s, `Pareto by ${a.by_label}`);
}
