// Lots, IQC & FIFO (WIESPL Stores policy): incoming inspection of GRN lines, the lot-wise inward register with what is
// left of each lot (and its trail till exhausted), and project-wise consumption valued at the lots' rates (for Tally).
// Also the System Health page: where data and process are out of step.
import { h, api, state, toast, fail, modal, fmtDate, busy, refOptions, today, setHashParam } from '../ui.js';
import { hasFunction, canView } from '../schema.js';
import { inr, round2, fyOf } from '../calc.js';
import { itemPicker } from './form.js';

const qs = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const STATUS_COLOR = { ACTIVE: 'var(--good)', 'LOW STOCK': 'var(--warn)', EXHAUSTED: 'var(--muted)', HOLD: 'var(--bad)', 'IQC PENDING': 'var(--warn)' };
const csv = (name, head, rows) => {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
};

export async function lotsView(root) {
  // People who only inspect (Quality) see the IQC tab alone; the store sees lots and consumption too.
  const storeSide = canView('stock_moves', state.user.role);
  let tab = !storeSide ? 'iqc' : ['iqc', 'register', 'consumption'].includes(qs().tab) ? qs().tab : 'register';
  let mine = qs().mine === '1' || (!storeSide && qs().mine !== '0');
  const fy = fyOf(today());
  const f = { q: h('input.grow', { type: 'search', placeholder: 'Item, GRN, batch, PO or supplier…', value: qs().q || '' }),
    from: h('input', { type: 'date', value: `20${fy.slice(0, 2)}-04-01` }), to: h('input', { type: 'date', value: today() }),
    status: h('select', { style: { width: 'auto' } }, ['', 'ACTIVE', 'LOW STOCK', 'IQC PENDING', 'HOLD', 'EXHAUSTED', 'CLOSED (1 April opening)'].map(s => h('option', { value: s }, s || 'All lots'))) };
  const projects = storeSide ? await refOptions('projects').catch(() => []) : [];
  let project = null;
  const projPick = itemPicker([{ id: 0, label: 'All projects' }, ...projects], 0, { onPick: id => { project = id || null; load(); } });
  const tabs = h('div.tabs'), bar = h('div.toolbar'), out = h('div');
  const mayQc = hasFunction(state.user.role, 'iqc_inspect');

  function drawTabs() {
    tabs.replaceChildren(...[['iqc', '🔍 IQC pending'], ...(storeSide ? [['register', '🏷️ Lot register (inward → exhausted)'], ['consumption', '📊 Consumption by project (FIFO value)']] : [])]
      .map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { tab = k; setHashParam('tab', k); drawTabs(); load(); } }, l)));
    bar.replaceChildren(...(tab === 'iqc' ? [h('div.tabs', { style: { margin: 0 } }, [[true, '🙋 Mine'], [false, '📋 All pending']].map(([v, l]) => h('button', { class: mine === v ? 'active' : '', onclick: () => { mine = v; setHashParam('mine', v ? '1' : '0'); drawTabs(); load(); } }, l))), f.q]
      : tab === 'register' ? [f.q, f.status, h('span.muted', 'Inward from'), f.from, h('span.muted', 'to'), f.to]
      : tab === 'consumption' ? [h('span', { style: { minWidth: '260px', display: 'inline-block' } }, projPick), h('span.muted', 'From'), f.from, h('span.muted', 'to'), f.to] : []));
  }

  // ---- IQC (each material group can have its own inspector: Settings → Incoming inspection)
  const reportUrl = (doc, date) => `#/print/iqc/x?doc=${encodeURIComponent(doc)}&date=${date}`;
  async function iqc() {
    const [all, recent] = await Promise.all([api(`/iqc${mine ? '?mine=1' : ''}`), api('/iqc/recent?days=30').catch(() => [])]);
    const term = f.q.value.trim().toLowerCase();
    const rows = term ? all.filter(r => [r.doc_no, r.item, r.code, r.vendor, r.po_no, r.category, r.inspector].some(v => String(v || '').toLowerCase().includes(term))) : all;
    const picked = new Set();
    const decide = status => busy(async () => {
      if (!picked.size) throw new Error('Tick the GRN lines first');
      const remarks = h('textarea', { rows: 2, placeholder: status === 'Accepted' ? 'optional' : 'defect / reason (required)' });
      const rej = {};
      const partly = status === 'Partly accepted' ? h('table.data', h('tbody', rows.filter(r => picked.has(r.id)).map(r => h('tr', h('td', `${r.doc_no} · ${r.item}`), h('td', `received ${r.qty} ${r.uom || r.item_uom || ''}`),
        h('td', h('input', { type: 'number', step: 'any', min: 0, placeholder: 'rejected qty', style: { width: '110px' }, oninput: e => { rej[r.id] = Number(e.target.value); } })))))) : null;
      // the IQC norms of each line: every check Pass / Fail / NA (Accepted: no Fail; Rejected / Partly accepted: a Fail)
      const answers = {};
      const lines = rows.filter(r => picked.has(r.id));
      const sel = (r, c) => { const s2 = h('select', { style: { width: '90px' }, onchange: e => { (answers[r.id] ||= {})[c] = e.target.value; } }, ['', 'Pass', 'Fail', 'NA'].map(o => h('option', { value: o }, o || '—'))); return s2; };
      const sels = [];
      const checklist = h('div', { style: { maxHeight: '340px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 8px' } },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } }, h('b', 'IQC checks'),
          h('button.btn.small', { type: 'button', onclick: () => { for (const [r, c, el] of sels) if (!el.value) { el.value = 'Pass'; (answers[r.id] ||= {})[c] = 'Pass'; } } }, '✔ Pass all not answered')),
        lines.map(r => h('div', { style: { margin: '6px 0' } }, h('div', h('b', `${r.doc_no} · ${r.code} ${r.item}`), h('span.muted', ` · ${r.qty} ${r.uom || r.item_uom || ''}`)),
          h('table.data', h('tbody', (r.checks || []).map(c => { const el = sel(r, c); sels.push([r, c, el]); return h('tr', h('td', c), h('td', { style: { width: '100px' } }, el)); }))))));
      const ok = await modal(`IQC: ${status} (${picked.size} line${picked.size === 1 ? '' : 's'})`, h('div.grid', status === 'Hold' ? null : checklist, partly, h('label', 'Remarks', remarks),
        h('p.muted', status === 'Rejected' || status === 'Partly accepted' ? 'Rejected material is not issued and is not paid for (the 3-way check counts only the accepted quantity). Raise a debit note / return it to the vendor.' : status === 'Hold' ? 'On hold: the material stays in the store and is not issued until it is inspected.' : 'Accepted material can be issued.')),
        [{ label: 'Cancel', value: false }, { label: status, cls: status === 'Accepted' ? 'good' : 'danger solid', value: true }]);
      if (!ok) return;
      await api('/iqc', { method: 'POST', body: { ids: [...picked], status, remarks: remarks.value, rejected: rej, checks: answers } });
      toast(`IQC recorded: ${status}. Print the IQC report from the GRN row.`); load();
    });
    // one heading row per GRN (tick all its lines, print its report), then its lines
    const groups = [];
    for (const r of rows) { const g = groups.at(-1); if (g && g.doc_no === r.doc_no && g.date === r.date) g.rows.push(r); else groups.push({ doc_no: r.doc_no, date: r.date, vendor: r.vendor, po_no: r.po_no, rows: [r] }); }
    const boxes = new Map();
    const tbody = h('tbody');
    for (const g of groups) {
      const all2 = mayQc ? h('input', { type: 'checkbox', style: { width: 'auto' }, title: 'Tick every line of this GRN', onchange: e => { for (const r of g.rows) { const c = boxes.get(r.id); c.checked = e.target.checked; c.onchange({ target: c }); } } }) : '';
      tbody.append(h('tr', { style: { background: 'var(--bg)' } }, h('td', all2), h('td', { colspan: 9 }, h('b', `GRN ${g.doc_no}`), h('span.muted', ` · ${fmtDate(g.date)} · ${g.vendor || ''}${g.po_no ? ` · PO ${g.po_no}` : ''} · ${g.rows.length} line${g.rows.length === 1 ? '' : 's'}`)),
        h('td', h('a.btn.small', { href: reportUrl(g.doc_no, g.date), target: '_blank' }, '🖨 IQC report'))));
      for (const r of g.rows) {
        const cb = mayQc ? h('input', { type: 'checkbox', style: { width: 'auto' }, onchange: e => { e.target.checked ? picked.add(r.id) : picked.delete(r.id); } }) : null;
        if (cb) boxes.set(r.id, cb);
        tbody.append(h('tr', h('td', cb || ''), h('td', { style: { color: r.age > 2 ? 'var(--bad)' : '' } }, `${r.age} d`), h('td.clip', { title: `IQC checks:\n• ${(r.checks || []).join('\n• ')}` }, `${r.code} · ${r.item}`, h('div.muted', { style: { fontSize: '11px' } }, `${(r.checks || []).length} checks`)), h('td', r.category || ''),
          h('td.num', `${r.qty} ${r.uom || r.item_uom || ''}`), h('td', r.batch_no || ''), h('td', r.rack || ''), h('td', r.inspector || h('span.muted', 'anyone')), h('td', r.invoice_no || ''),
          h('td', { style: { color: r.qc_status === 'Hold' ? 'var(--bad)' : 'var(--warn)' } }, r.qc_status), h('td')));
      }
    }
    out.replaceChildren(
      h('p.muted', `${mine ? 'Lines for you to inspect.' : 'All lines waiting for inspection.'} Tick lines (or a whole GRN), then Accept, Partly accept, Reject or Hold, and answer each IQC check (Pass / Fail / NA) of the item. The checks come from the item (Item master → IQC checks) or its category; who inspects which material and the checks per category: Settings → Incoming inspection (IQC).`),
      rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', h('th'), ...['Waiting', 'Item', 'Category', 'Qty', 'Batch / lot', 'Rack', 'Inspector', 'Invoice', 'Status', ''].map(x => h('th', x)))), tbody)))
        : h('div.card', h('div.empty', mine ? 'Nothing waiting for your inspection. 🎉' : 'No GRN line is waiting for inspection.')),
      rows.length && mayQc ? h('div.toolbar', h('button.btn.good', { onclick: decide('Accepted') }, '✔ Accept'), h('button.btn', { onclick: decide('Partly accepted') }, '◐ Partly accepted'),
        h('button.btn.danger', { onclick: decide('Rejected') }, '✗ Reject'), h('button.btn', { onclick: decide('Hold') }, '⏸ Hold')) : null,
      recent.length ? h('div.card', h('h2', '🖨 IQC reports: GRNs inspected in the last 30 days'), h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['GRN', 'Date', 'Supplier', 'Lines', 'Rejected', 'Still open', 'Inspected by', ''].map(x => h('th', x)))),
        h('tbody', recent.map(g => h('tr', h('td', h('b', g.doc_no)), h('td.nowrap', fmtDate(g.date)), h('td.clip', g.vendor || ''), h('td.num', g.lines),
          h('td.num', { style: { color: g.rejected || g.partly ? 'var(--bad)' : '' } }, (g.rejected || 0) + (g.partly || 0) || ''), h('td.num', g.open || ''), h('td', g.by_ || ''),
          h('td', h('a.btn.small', { href: reportUrl(g.doc_no, g.date), target: '_blank' }, '🖨 Report')))))))) : null);
  }

  // ---- lot register
  async function trail(r) {
    const d = await api(`/lots/${r.item_id}/${r.lot_id}`);
    const L = d.lot;
    await modal(`${L.code} · ${L.item} – ${L.lot}`, h('div',
      h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '8px' } }, [['Received', `${L.qty} ${L.uom || ''} on ${fmtDate(L.date)}`], ['Supplier', L.vendor], ['PO', L.po_no], ['Rate', L.rate != null ? `₹ ${inr(L.rate)}` : ''],
        ['Rack', L.rack], ['IQC', [L.qc_status || (L.type === 'INWARD' ? 'Accepted (before IQC)' : ''), L.qc_rejected ? `${L.qc_rejected} rejected` : '', L.qc_by].filter(Boolean).join(' · ')], ['Left', `${L.balance} ${L.uom || ''}`]]
        .filter(x => x[1]).map(([k, v]) => h('div', h('div.muted', { style: { fontSize: '11px' } }, k), h('div', v)))),
      d.uses.length ? h('table.data', h('thead', h('tr', ['Date', 'Slip', 'Type', 'Project / issued to', 'Qty', 'Balance'].map(x => h('th', x)))),
        h('tbody', h('tr', h('td', fmtDate(L.date)), h('td', L.doc_no || ''), h('td', 'Received'), h('td', ''), h('td.num', L.qty), h('td.num', round2(L.qty - (L.rejected || 0)))),
          d.uses.map(u => h('tr', h('td', fmtDate(u.date)), h('td', u.doc_no || ''), h('td', u.type), h('td', [u.project_no, u.project, u.issued_to || u.to_location].filter(Boolean).join(' · ')),
            h('td.num', u.qty), h('td.num', { style: { fontWeight: 600, color: u.balance <= 0 ? 'var(--muted)' : '' } }, u.balance <= 0 ? '0 – exhausted' : u.balance)))))
        : h('p.muted', 'Nothing issued from this lot yet.')), [{ label: 'Close', value: true }], { wide: true });
  }
  async function register() {
    const p = new URLSearchParams(Object.entries({ q: f.q.value, from: f.from.value, to: f.to.value, status: f.status.value }).filter(([, v]) => v)).toString();
    const rows = await api(`/lots?${p}`);
    const sum = k => round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
    out.replaceChildren(
      h('div.kpis', ...[['Lots', rows.length], ['Active', rows.filter(r => r.status === 'ACTIVE' || r.status === 'LOW STOCK').length], ['IQC pending / hold', rows.filter(r => /IQC|HOLD/.test(r.status)).length],
        ['Exhausted', rows.filter(r => r.status === 'EXHAUSTED').length], ['Value left in lots', `₹ ${inr(sum('balance_value'))}`]].map(([l, v]) => h('div.kpi', h('div.label', l), h('div.value', v)))),
      h('div', { style: { display: 'flex', gap: '8px', margin: '0 0 8px' } }, h('button.btn.small', { onclick: () => csv(`lot-register-${today()}.csv`, ['Inward date', 'Lot', 'GRN / doc', 'PO', 'Supplier', 'Item code', 'Item', 'Batch', 'Qty received', 'UOM', 'Rate', 'Value', 'IQC', 'Rejected', 'Rack', 'Issued', 'Balance', 'Status'],
        rows.map(r => [r.date, r.lot, r.doc_no, r.po_no, r.vendor, r.code, r.item, r.batch_no, r.qty, r.uom, r.rate, r.value, r.qc_status || '', r.rejected, r.rack, r.issued, r.balance, r.status])) }, '⬇ Export (Excel / CSV)')),
      rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Inward', 'Lot (GRN / batch)', 'Supplier', 'Item', 'Received', 'Rate', 'IQC', 'Rack', 'Issued', 'Left', 'Status'].map((x, i) => h('th' + ([4, 5, 8, 9].includes(i) ? '.num' : ''), x)))),
        h('tbody', rows.slice(0, 1500).map(r => h('tr.clickable', { onclick: () => trail(r).catch(fail) },
          h('td.nowrap', fmtDate(r.date)), h('td.nowrap', r.lot), h('td.clip', r.vendor || ''), h('td.clip', { title: r.item }, `${r.code} · ${r.item}`), h('td.num', `${r.qty} ${r.uom || ''}`),
          h('td.num', r.rate != null ? inr(r.rate) : ''), h('td', r.qc_status ? `${r.qc_status}${r.rejected ? ` (−${r.rejected})` : ''}` : h('span.muted', '—')), h('td', r.rack || ''),
          h('td.num', r.issued || ''), h('td.num', { style: { fontWeight: 600 } }, r.balance), h('td.nowrap', { style: { color: STATUS_COLOR[r.status] || 'var(--muted)', fontWeight: 600 } }, r.status))))))) : h('div.empty', 'No lots match'),
      h('p.muted', { style: { fontSize: '12px' } }, 'Each receipt is a lot: issues take the oldest lot first (FIFO). Click a lot to see every issue from it, the project and the balance, till it is exhausted.'));
  }

  // ---- consumption by project
  async function consumption() {
    const p = new URLSearchParams(Object.entries({ from: f.from.value, to: f.to.value, project: project || '' }).filter(([, v]) => v)).toString();
    const rows = await api(`/lots/consumption?${p}`);
    const by = new Map();
    // By CRM project; older issues name only the site ("issued to"), so those are grouped by that name.
    for (const r of rows) { const site = String(r.issued_to || '').trim(); const k = r.project_id || 'site:' + site.toLowerCase(); const x = by.get(k) || by.set(k, { name: r.project ? `${r.project_no || ''} ${r.project}`.trim() : site ? `${site} (site, no CRM project)` : 'No project / site', value: 0, scrap: 0, lines: 0 }).get(k); x.value += r.value; if (r.scrap) x.scrap += r.value; x.lines++; }
    const total = round2(rows.reduce((a, r) => a + r.value, 0));
    out.replaceChildren(
      h('div.kpis', h('div.kpi', h('div.label', 'Consumption value'), h('div.value', `₹ ${inr(total)}`), h('div.sub', 'issues + transfers + scrap at FIFO lot rates')), h('div.kpi', h('div.label', 'Projects / sites'), h('div.value', by.size))),
      h('div.card', h('h3', { style: { margin: '0 0 6px' } }, 'By project (for the Tally entry)'), h('table.data', h('thead', h('tr', ['Project', 'Lines', 'Value (₹)', 'of which scrap'].map((x, i) => h('th' + (i > 0 ? '.num' : ''), x)))),
        h('tbody', [...by.values()].sort((a, b) => b.value - a.value).map(x => h('tr', h('td', x.name), h('td.num', x.lines), h('td.num', inr(x.value)), h('td.num', x.scrap ? inr(x.scrap) : '')))))),
      h('div', { style: { margin: '8px 0' } }, h('button.btn.small', { onclick: () => csv(`project-consumption-${f.from.value}-${f.to.value}.csv`, ['Date', 'Type', 'Slip', 'Project code', 'Project', 'Issued to', 'Item code', 'Item', 'Lot (GRN / batch)', 'Qty', 'UOM', 'Rate (FIFO)', 'Value'],
        rows.map(r => [r.date, r.type, r.doc_no, r.project_no, r.project, r.issued_to, r.code, r.item, r.lot, r.qty, r.uom, r.rate, r.value])) }, '⬇ Export for Tally (CSV)')),
      rows.length ? h('div.card.flush', h('div.table-wrap', h('table.data', h('thead', h('tr', ['Date', 'Slip', 'Project', 'Item', 'From lot', 'Qty', 'Rate', 'Value'].map((x, i) => h('th' + (i >= 5 ? '.num' : ''), x)))),
        h('tbody', rows.slice(-1500).reverse().map(r => h('tr', h('td.nowrap', fmtDate(r.date)), h('td.nowrap', `${r.type === 'OUTWARD' ? 'Issue' : r.type === 'TRANSFER' ? 'MTN' : 'Scrap'} ${r.doc_no || ''}`),
          h('td.clip', [r.project_no, r.project].filter(Boolean).join(' ') || r.issued_to || ''), h('td.clip', `${r.code} · ${r.item}`), h('td.nowrap', { style: { color: r.lot_id == null ? 'var(--bad)' : '' } }, r.lot),
          h('td.num', `${r.qty} ${r.uom || ''}`), h('td.num', inr(r.rate)), h('td.num', inr(r.value)))))))) : h('div.empty', 'No consumption in this period'));
  }

  async function load() { try { await ({ iqc, register, consumption }[tab])(); } catch (e) { fail(e); } }
  let timer;
  for (const el of Object.values(f)) el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  root.replaceChildren(h('div.page-head', h('h1', storeSide ? '🏷️ Lots, IQC & FIFO' : '🔍 IQC – incoming inspection'), storeSide ? h('div.actions', h('a.btn', { href: '#/stock-movements' }, '🗂️ Stock Movements'), h('a.btn', { href: '#/stock-summary' }, '📊 Stock Summary')) : null),
    tabs, bar, out);
  drawTabs();
  await load();
}

// ---------------------------------------------------------------- System Health
export async function healthView(root) {
  const out = h('div', 'Checking…');
  root.replaceChildren(h('div.page-head', h('h1', '🩺 System Health'), h('div.actions', h('button.btn', { onclick: () => healthView(root) }, '↻ Check again'))),
    h('p.muted', 'Where the data or the process is out of step: each check says how many, shows examples and where to fix it. A green list means the records agree with each other.'), out);
  const d = await api('/health');
  const bad = d.checks.filter(c => c.count > 0);
  out.replaceChildren(
    h('div.kpis', h('div.kpi', h('div.label', 'Checks'), h('div.value', d.checks.length)), h('div.kpi', h('div.label', 'Need attention'), h('div.value', { style: { color: bad.length ? 'var(--bad)' : 'var(--good)' } }, bad.length)),
      h('div.kpi', h('div.label', 'All right'), h('div.value', { style: { color: 'var(--good)' } }, d.checks.length - bad.length)), h('div.kpi', h('div.label', 'Checked at'), h('div.value', { style: { fontSize: '16px' } }, d.at.slice(11, 16)))),
    h('div.card.flush', h('table.data', h('thead', h('tr', ['', 'Check', 'Area', 'Count', 'Examples', 'Fix']. map(x => h('th', x)))),
      h('tbody', [...d.checks].sort((a, b) => (b.count > 0) - (a.count > 0)).map(c => h('tr',
        h('td', { style: { fontSize: '16px' } }, c.count < 0 ? '⚠' : c.count ? '🔴' : '🟢'), h('td', h('b', c.title)), h('td.muted', c.area),
        h('td.num', { style: { fontWeight: 600, color: c.count ? 'var(--bad)' : 'var(--good)' } }, c.count < 0 ? 'error' : c.count),
        h('td', { style: { fontSize: '12px', maxWidth: '360px' } }, c.error || c.rows.map(r => r.x).join(' · ') + (c.count > c.rows.length ? ` … +${c.count - c.rows.length}` : '')),
        h('td', { style: { fontSize: '12px' } }, c.link ? h('a', { href: c.link }, c.fix) : c.fix)))))));
}
