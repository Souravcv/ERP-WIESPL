// Vendor performance and the Approved Vendor List (AVL): every vendor with its code, group, status, last rating, and
// what the data says this year — POs, on-time delivery, IQC acceptance, open complaints — plus who is due a review.
import { h, api, fail, fmtDate, badge, state } from '../ui.js';
import { VENDOR_GROUPS } from '../schema.js';
import { inr } from '../calc.js';

// OTIF: green at or above the target (85 %), red below it
const otifPct = (v, target, below) => (v == null ? h('span.muted', '—') : h('b', { style: { color: v >= target ? 'var(--good)' : 'var(--bad)' } }, `${v}%`, below ? ' ⚠' : ''));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = m => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const cell = (t, target) => (t.n ? h('td.num', { title: `${monLabel(t.month)}: ${t.otif} of ${t.n} GRNs on time in full`, style: { padding: '6px 5px', color: t.pct >= target ? 'var(--good)' : 'var(--bad)', fontWeight: t.pct < target ? 700 : 400 } }, `${t.pct}%`) : h('td.num.muted', { style: { padding: '6px 5px' } }, '·'));

// On-time in-full per vendor per month, worst vendors first, with a warning for those below the target.
function otifSection(o, q) {
  if (!o) return null;
  const rows = o.rows.filter(r => r.grns && (!q || `${r.name} ${r.vendor_code}`.toLowerCase().includes(q)));
  const below = o.rows.filter(r => r.below);
  const undated = o.rows.reduce((a, r) => a + r.undated, 0);
  return h('div.card', { style: { marginBottom: '14px' } },
    h('h2', `📦 On-time in-full (OTIF) by month — target ${o.target}%`),
    below.length ? h('div.card', { style: { borderColor: 'var(--bad)', background: 'var(--bad-bg)', padding: '10px 14px', margin: '8px 0' } },
      h('b', `⚠ ${below.length} vendor${below.length > 1 ? 's' : ''} below ${o.target}% OTIF: `),
      below.map(r => `${r.name} ${r.pct}% (${r.otif} of ${r.grns} GRNs)`).join(' · ')) : null,
    rows.length ? h('div.table-wrap', h('table.data',
      h('thead', h('tr', h('th', 'Vendor'), h('th', ''), h('th.num', 'GRNs'), h('th.num', 'OTIF'), h('th.num', 'On time'), h('th.num', 'In full'), o.months.map(m => h('th.num.nowrap', { style: { padding: '6px 5px' } }, monLabel(m))))),
      h('tbody',
        rows.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/vendors/${r.vendor_id}`), style: r.below ? { background: 'var(--bad-bg)' } : null },
          h('td.clip', { title: [r.vendor_code, r.name].filter(Boolean).join(' · '), style: { minWidth: '180px' } }, r.name),
          h('td.nowrap', r.below ? h('span.badge.bad', `⚠ below ${o.target}%`) : null),
          h('td.num', r.grns), h('td.num', otifPct(r.pct, o.target)), h('td.num', `${r.on_time}%`), h('td.num', `${r.in_full}%`), r.trend.map(t => cell(t, o.target)))),
        q ? null : h('tr', { style: { borderTop: '2px solid var(--border)' } }, h('td', h('b', 'All vendors')), h('td'), h('td.num', h('b', o.total.grns)), h('td.num', otifPct(o.total.pct, o.target)), h('td'), h('td'),
          o.overall.map(t => cell(t, o.target)))))) : h('p.muted', 'No GRN against a PO with a promised or delivery date in these months yet.'),
    h('p.muted', { style: { fontSize: '12px', marginBottom: 0 } },
      `Each GRN against a PO is measured against the first date the vendor promised (PO line promised date, else the PO's first date given, else its delivery date) and the quantity ordered. `,
      `OTIF = every line came on or before that date and the PO line was complete after this GRN. Since ${fmtDate(o.from)}.`,
      undated ? h('b', { style: { color: 'var(--warn)' } }, ` ${undated} GRN${undated > 1 ? 's' : ''} against POs had no promised or delivery date and are not measured — enter the dates on the POs.`) : null));
}

const pct = v => (v == null ? h('span.muted', '—') : h('b', { style: { color: v >= 90 ? 'var(--good)' : v >= 70 ? 'var(--warn)' : 'var(--bad)' } }, `${v}%`));

export async function vendorPerformanceView(root) {
  const f = {
    q: h('input.grow', { type: 'search', placeholder: 'Vendor name or code…' }),
    status: h('select', { style: { width: 'auto' } }, ['', 'Approved list (Approved / Preferred / Conditional)', 'New (to approve)', 'Approved', 'Preferred', 'Conditional', 'Under review', 'Blacklisted', 'Due for evaluation'].map(s => h('option', { value: s }, s || 'All vendors'))),
    group: h('select', { style: { width: 'auto' } }, h('option', { value: '' }, 'All groups'), Object.entries(VENDOR_GROUPS).map(([k, v]) => h('option', { value: k }, `${k} – ${v}`))),
  };
  const out = h('div');
  let data = null;
  const draw = () => {
    const q = f.q.value.toLowerCase();
    const rows = data.rows.filter(r => (!q || `${r.name} ${r.vendor_code}`.toLowerCase().includes(q)) && (!f.group.value || String(r.code_group || '').startsWith(f.group.value))
      && (!f.status.value || (f.status.value.startsWith('Approved list') ? ['Approved', 'Preferred', 'Conditional'].includes(r.vendor_status) : f.status.value === 'Due for evaluation' ? r.due_review && r.pos > 0 : r.vendor_status === f.status.value)));
    const n = s => data.rows.filter(r => r.vendor_status === s).length;
    out.replaceChildren(
      h('div.kpis', ...[['Vendors', data.rows.length], ['Preferred', n('Preferred')], ['Approved', n('Approved')], ['Conditional', n('Conditional')], ['Under review', n('Under review')], ['Blacklisted', n('Blacklisted')],
        ['New (to approve)', n('New (to approve)')], ['Open complaints', data.rows.reduce((a, r) => a + r.open_scars, 0)]].map(([l, v]) => h('div.kpi', h('div.label', l), h('div.value', v)))),
      otifSection(data.otif, q),
      h('div.card.flush', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Code', 'Vendor', 'Group', 'Status', 'Rating', 'Last evaluation', 'POs (this FY)', 'PO value', 'On time', 'OTIF', 'IQC accepted', 'Open SCAR', 'Valid till'].map((x, i) => h('th' + ([6, 7, 8, 9, 10, 11].includes(i) ? '.num' : ''), x)))),
        h('tbody', rows.map(r => h('tr.clickable', { onclick: () => (location.hash = `#/view/vendors/${r.id}`) },
          h('td.nowrap', r.vendor_code || ''), h('td.clip', { title: r.name }, r.name, r.critical === 'Yes' ? h('span.badge.warn', { style: { marginLeft: '4px' } }, 'critical') : null),
          h('td.muted', String(r.code_group || '').slice(0, 2)), h('td', badge(r.vendor_status || '')), h('td', r.rating != null ? `${r.rating}% ${r.rating_band || ''}` : h('span.muted', '—')),
          h('td.nowrap', r.last_review ? fmtDate(r.last_review) : h('span', { style: { color: r.pos ? 'var(--warn)' : 'var(--muted)' } }, r.pos ? 'due' : '—')),
          h('td.num', r.pos || ''), h('td.num', r.po_value ? inr(r.po_value) : ''), h('td.num', pct(r.otd)), h('td.num', otifPct(r.otif, data.otif.target, r.otif_below)), h('td.num', pct(r.quality)),
          h('td.num', r.open_scars ? h('b', { style: { color: 'var(--bad)' } }, r.open_scars) : ''), h('td.nowrap', { style: { color: r.expired ? 'var(--bad)' : '' } }, r.valid_till ? fmtDate(r.valid_till) : ''))))))),
      h('p.muted', { style: { fontSize: '12px' } }, `On time = GRN lines received on or before the PO delivery date; OTIF = see above (last 12 months); IQC accepted = accepted share of what was inspected; since ${fmtDate(data.from)}. Rating bands: 90+ Preferred · 80–89 Approved · 70–79 Conditional · below 70 Under review. Evaluate every vendor with POs each half-year.`));
  };
  const printAvl = () => {
    const rows = data.rows.filter(r => ['Approved', 'Preferred', 'Conditional'].includes(r.vendor_status));
    const w = window.open('', '_blank');
    const s = state.settings || {};
    w.document.write(`<html><head><title>Approved Vendor List</title><style>body{font:12px Arial;margin:18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:4px 6px;text-align:left}th{background:#eef}h2{margin:4px 0}</style></head><body>
      <h2>${s.company_name || 'WIESPL'} – Approved Vendor List (AVL)</h2><div>As on ${fmtDate(new Date().toLocaleString('sv-SE').slice(0, 10))} · ${rows.length} vendors</div><br>
      <table><tr><th>#</th><th>Vendor Code</th><th>Vendor</th><th>Group</th><th>Status</th><th>Rating</th><th>Approved On</th><th>Valid Till</th></tr>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.vendor_code || ''}</td><td>${String(r.name).replace(/</g, '&lt;')}</td><td>${VENDOR_GROUPS[String(r.code_group || '').slice(0, 2)] || ''}</td><td>${r.vendor_status}</td><td>${r.rating != null ? r.rating + '%' : ''}</td><td>${fmtDate(r.approved_on) || ''}</td><td>${fmtDate(r.valid_till) || ''}</td></tr>`).join('')}
      </table><br><table><tr><th style="width:33%">Prepared By (Purchase)</th><th style="width:33%">Checked By (Purchase Head)</th><th>Approved By (GM)</th></tr><tr><td style="height:50px"></td><td></td><td></td></tr></table></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  for (const el of Object.values(f)) el.addEventListener('input', () => data && draw());
  root.replaceChildren(h('div.page-head', h('h1', '🏅 Vendor Performance & Approved List'), h('div.actions',
    h('button.btn', { onclick: () => data && printAvl() }, '🖨 Approved Vendor List'), h('a.btn', { href: '#/list/vendor_evaluations' }, '📊 Evaluations'),
    h('a.btn', { href: '#/list/vendor_complaints' }, '⚠️ Complaints / SCAR'), h('a.btn', { href: '#/list/vendor_audits' }, '🔍 Audits'), h('a.btn', { href: '#/list/vendors' }, '🏭 Vendors'))),
    h('div.toolbar', f.q, f.status, f.group), out);
  try { data = await api('/vendor-performance'); draw(); } catch (e) { fail(e); }
}
