// Quality (QEMS Vol 3): QC inspections in process, at final QC and before dispatch, with the checks of the policy
// filled in; rework / rejection raises an NCR; NCR → root cause → corrective & preventive action within 30 days →
// verification → closure. Final QC's accepted qty limits what the daily reports count as finished. The quality review
// gives incoming / internal rejection %, rework %, first-pass yield, the NCR Pareto, CAPA closure and the cost of poor
// quality.
import { db, tx, audit } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction, QC_STAGE_CHECKS, QC_ELECTRICAL_CHECKS, QC_FINAL_CHECKS, QC_PRODUCT_CHECKS, QC_DISPATCH_CHECKS, NCR_CATEGORIES } from '../public/js/schema.js';
import { notify } from './notify.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const parse = (v, d) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || 'null') ?? d; } catch { return d; } };
const n0 = v => Number(v) || 0;
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
export const CAPA_DAYS = 30;

// The checks an inspection starts with: per stage (electrical panels: the panel checks), final = general + product, dispatch.
export function defaultChecks(kind, stage, category) {
  let list = [];
  if (String(kind).startsWith('In-process')) list = category === 'Electrical panel' && ['Assembly', 'Fabrication / welding'].includes(stage) ? QC_ELECTRICAL_CHECKS : QC_STAGE_CHECKS[stage] || ['Dimensions', 'Finish'];
  else if (String(kind).startsWith('Final')) list = [...QC_FINAL_CHECKS, ...(QC_PRODUCT_CHECKS[category] || []).filter(c => !QC_FINAL_CHECKS.includes(c))];
  else if (kind === 'Dispatch QC') list = QC_DISPATCH_CHECKS;
  return list.map(check => ({ check, standard: '', measured: '', result: '', remark: '' }));
}
const resultOf = (i, a, rw, rj) => (!(i > 0) ? null : rj >= i ? 'Rejected' : rw + rj > 0 ? 'Partly accepted' : a >= i ? 'Accepted' : 'Hold');

export function prepInspection(row, existing) {
  const get = k => (k in row ? row[k] : existing?.[k]);
  const kind = get('kind'), stage = get('stage') || '';
  if (kind?.startsWith('In-process') && 'stage' in row && !stage) throw new HttpError(400, 'Choose the stage that was inspected');
  for (const k of ['qty_inspected', 'qty_accepted', 'qty_rework', 'qty_rejected']) if (k in row && row[k] !== '' && row[k] != null && Number(row[k]) < 0) throw new HttpError(400, 'Quantities cannot be negative');
  const orderId = get('order_id');
  const o = orderId ? db.prepare('SELECT category, drawing_no, drawing_rev FROM production_orders WHERE id = ?').get(Number(orderId)) : null;
  // New, or kind / stage changed while no check has a result yet: the policy's checks.
  const checks = parse(get('checks'), []);
  const untouched = !checks.some(c => c.result || c.measured);
  if ((!existing && !checks.length) || (existing && untouched && (('kind' in row && row.kind !== existing.kind) || ('stage' in row && row.stage !== existing.stage) || !checks.length))) {
    if (kind) row.checks = JSON.stringify(defaultChecks(kind, stage, o?.category));
  }
  if (!existing && !row.drawing_rev && o?.drawing_no) row.drawing_rev = [o.drawing_no, o.drawing_rev].filter(Boolean).join(' rev ');
  if (['qty_inspected', 'qty_accepted', 'qty_rework', 'qty_rejected'].some(k => k in row)) {
    let i = n0(get('qty_inspected')), rw = n0(get('qty_rework')), rj = n0(get('qty_rejected'));
    let a = get('qty_accepted');
    // Accepted left blank, or still the figure worked out last time: what was not reworked or rejected.
    const auto = existing && (existing.qty_accepted == null || n0(existing.qty_accepted) === r2(Math.max(0, n0(existing.qty_inspected) - n0(existing.qty_rework) - n0(existing.qty_rejected))))
      && n0(a) === n0(existing.qty_accepted);
    if (((a == null || a === '') || auto) && i > 0) { a = r2(Math.max(0, i - rw - rj)); row.qty_accepted = a; }
    row.result = resultOf(i, n0(a), rw, rj);
  }
}

export const fqcAccepted = orderId => db.prepare("SELECT COALESCE(SUM(qty_accepted), 0) q FROM qc_inspections WHERE order_id = ? AND kind = 'Final (FQC)' AND status = 'Done'").get(Number(orderId)).q;

// Inspection recorded: quantities add up, every check answered; rework / rejection opens an NCR.
export function completeInspection(id, user) {
  if (!hasFunction(user.role, 'qc_inspect')) throw new HttpError(403, 'Your role may not record QC inspections');
  const q = getRow('qc_inspections', id);
  if (q.status !== 'Draft') throw new HttpError(409, `Already ${q.status}`);
  const o = getRow('production_orders', q.order_id);
  const i = n0(q.qty_inspected), a = n0(q.qty_accepted), rw = n0(q.qty_rework), rj = n0(q.qty_rejected);
  const bad = [];
  if (!(i > 0)) bad.push('Enter the quantity inspected');
  else if (Math.abs(a + rw + rj - i) > 1e-9) bad.push(`Accepted ${a} + rework ${rw} + rejected ${rj} must make the ${i} inspected`);
  const checks = q.checks || [];
  if (!checks.length) bad.push('Add the checks');
  checks.forEach((c, k) => { if (!c.result) bad.push(`Check ${k + 1} (${c.check || '—'}): OK, Not OK or NA`); });
  const notOk = checks.filter(c => c.result === 'Not OK');
  if (notOk.length && !(rw + rj > 0) && notOk.some(c => !String(c.remark || '').trim())) bad.push(`“Not OK” with everything accepted: write in the remark why it is still accepted (${notOk.map(c => c.check).join(', ')})`);
  if (rw + rj > 0 && !String(q.defect || '').trim()) bad.push('Write the defect / reason for the rework or rejection');
  if (rw + rj > 0 && !q.defect_category) bad.push('Choose the defect category');
  if (q.kind === 'Final (FQC)' && i > 0) {
    const before = fqcAccepted(q.order_id);
    if (before + a > Number(o.qty) + 1e-9) bad.push(`${o.order_no}: final QC would accept ${r2(before + a)}, more than the order's ${o.qty} ${o.uom || ''}`);
  }
  if (q.kind === 'Dispatch QC' && a > 0 && a > fqcAccepted(q.order_id) + 1e-9) bad.push(`${o.order_no}: only ${fqcAccepted(q.order_id)} passed final QC – dispatch only after final QC`);
  if (bad.length) throw new HttpError(400, bad.join('\n'));
  return tx(() => {
    let ncrId = null;
    if (rw + rj > 0) {
      const ncr = insertRow('ncrs', {
        date: q.date, source: q.kind, category: q.defect_category, order_id: q.order_id, project_id: o.project_id, inspection_id: q.id,
        description: `${q.qc_no}${q.stage ? ' · ' + q.stage : ''}: ${q.defect}${notOk.length ? `\nNot OK: ${notOk.map(c => `${c.check}${c.measured ? ' (' + c.measured + ')' : ''}`).join(', ')}` : ''}`,
        qty: r2(rw + rj), uom: o.uom, segregated: 'Yes', disposition: rj && !rw ? 'Reject / scrap' : rw && !rj ? 'Rework' : '', responsible: o.responsible || null, target_date: addDays(q.date, CAPA_DAYS),
      }, user, { system: true });
      ncrId = ncr.id;
      notify({ fn: 'ncr_close', kind: 'quality', title: `NCR ${ncr.ncr_no}: ${o.order_no} – ${rw ? rw + ' rework' : ''}${rw && rj ? ', ' : ''}${rj ? rj + ' rejected' : ''}`, body: q.defect, link: `#/view/ncrs/${ncr.id}` }, user);
      if (o.responsible) notify({ userNames: [o.responsible], kind: 'quality', title: `NCR ${ncr.ncr_no} on ${o.order_no}: root cause and CAPA by ${ncr.target_date}`, body: q.defect, link: `#/view/ncrs/${ncr.id}` }, user);
    }
    const out = updateRow('qc_inspections', id, { status: 'Done', done_by: `${user.name} (${stamp()})`, ncr_id: ncrId }, user, { system: true });
    audit(user.name, 'qc_inspections', q.id, `QC ${out.result}`, `${q.kind} ${o.order_no}: ${a}/${i} accepted`);
    return out;
  });
}

export function prepNcr(row, existing) {
  const date = row.date || existing?.date || today();
  if (!existing && !row.target_date) row.target_date = addDays(date, CAPA_DAYS);
  const orderId = row.order_id ?? existing?.order_id;
  if (orderId && !(row.project_id ?? existing?.project_id)) row.project_id = db.prepare('SELECT project_id FROM production_orders WHERE id = ?').get(Number(orderId))?.project_id || null;
  if ('whys' in row) row.whys = JSON.stringify(parse(row.whys, []).filter(w => w.why || w.because));
}

export function ncrAction(id, action, body = {}, user) {
  const n = getRow('ncrs', id);
  const head = hasFunction(user.role, 'ncr_close'), qc = hasFunction(user.role, 'qc_inspect');
  if (action === 'investigate') {
    if (!head && !qc) throw new HttpError(403, 'Your role may not work on NCRs');
    if (n.status !== 'Open') throw new HttpError(409, `This NCR is ${n.status}`);
    return updateRow('ncrs', id, { status: 'Under investigation' }, user, { system: true });
  }
  if (action === 'action') {
    if (!head && !qc && n.responsible !== user.name) throw new HttpError(403, 'Your role may not work on NCRs');
    if (!['Open', 'Under investigation'].includes(n.status)) throw new HttpError(409, `This NCR is ${n.status}`);
    const miss = [];
    if (!n.disposition) miss.push('the disposition');
    if (!String(n.root_cause || '').trim()) miss.push('the root cause');
    if (!String(n.corrective_action || '').trim()) miss.push('the corrective action');
    if (!String(n.preventive_action || '').trim()) miss.push('the preventive action');
    if (!n.responsible) miss.push('who is responsible');
    if (!n.target_date) miss.push('the CAPA target date');
    if (miss.length) throw new HttpError(400, `Fill in ${miss.join(', ')} first`);
    return updateRow('ncrs', id, { status: 'Action in progress' }, user, { system: true });
  }
  if (action === 'close') {
    if (!head) throw new HttpError(403, 'Only the quality head closes an NCR (verifies the CAPA)');
    if (n.status !== 'Action in progress') throw new HttpError(409, 'Record the root cause and CAPA first (Action in progress)');
    if (!String(n.verification || '').trim()) throw new HttpError(400, 'Write how the action was verified as effective');
    const out = updateRow('ncrs', id, { status: 'Closed', closed_by: `${user.name} (${stamp()})`, closed_on: today() }, user, { system: true });
    audit(user.name, 'ncrs', n.id, 'closed', n.ncr_no);
    return out;
  }
  if (action === 'cancel') {
    if (!head) throw new HttpError(403, 'Only the quality head cancels an NCR');
    if (['Closed', 'Cancelled'].includes(n.status)) throw new HttpError(409, `This NCR is ${n.status}`);
    const why = String(body.reason || '').trim();
    if (!why) throw new HttpError(400, 'Write why the NCR is cancelled');
    return updateRow('ncrs', id, { status: 'Cancelled', remarks: [n.remarks, `${today()}: cancelled by ${user.name} – ${why}`].filter(Boolean).join('\n') }, user, { system: true });
  }
  throw new HttpError(400, 'Unknown action');
}

// ---------------------------------------------------------------- quality review (dashboard: daily / weekly / monthly)
export function qualityReview({ from, to } = {}) {
  const f = from || today().slice(0, 8) + '01', t = to || today();
  const ins = db.prepare(`SELECT q.*, o.order_no, o.category, o.description FROM qc_inspections q LEFT JOIN production_orders o ON o.id = q.order_id
    WHERE q.status = 'Done' AND q.date BETWEEN ? AND ? ORDER BY q.date DESC, q.id DESC`).all(f, t);
  const sum = (rows, k) => r2(rows.reduce((s, r) => s + n0(r[k]), 0));
  const kinds = ['In-process (IPQC)', 'Final (FQC)', 'Dispatch QC'].map(kind => {
    const rows = ins.filter(r => r.kind === kind);
    const i = sum(rows, 'qty_inspected'), a = sum(rows, 'qty_accepted'), rw = sum(rows, 'qty_rework'), rj = sum(rows, 'qty_rejected');
    return { kind, inspections: rows.length, inspected: i, accepted: a, rework: rw, rejected: rj, fpy: pct(a, i), rework_pct: pct(rw, i), rejection_pct: pct(rj, i) };
  });
  const internal = ins.filter(r => r.kind !== 'Dispatch QC');
  const I = sum(internal, 'qty_inspected');
  const stages = [...new Set(ins.filter(r => r.stage).map(r => r.stage))].map(stage => {
    const rows = ins.filter(r => r.stage === stage);
    const i = sum(rows, 'qty_inspected');
    return { stage, inspections: rows.length, inspected: i, rework: sum(rows, 'qty_rework'), rejected: sum(rows, 'qty_rejected'), fpy: pct(sum(rows, 'qty_accepted'), i) };
  });
  // Incoming (IQC on the GRN lines of the store).
  const iqc = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(qty), 0) qty, COALESCE(SUM(CASE WHEN qc_status = 'Rejected' THEN qty ELSE COALESCE(qc_rejected, 0) END), 0) rejected
    FROM stock_moves WHERE type = 'INWARD' AND qc_status IN ('Accepted', 'Partly accepted', 'Rejected') AND date BETWEEN ? AND ?`).get(f, t);
  const ncrs = db.prepare(`SELECT n.*, o.order_no FROM ncrs n LEFT JOIN production_orders o ON o.id = n.order_id ORDER BY n.date DESC, n.id DESC`).all();
  const inPeriod = ncrs.filter(n => n.date >= f && n.date <= t && n.status !== 'Cancelled');
  const pareto = NCR_CATEGORIES.map(category => ({ category, count: inPeriod.filter(n => n.category === category).length, qty: r2(inPeriod.filter(n => n.category === category).reduce((s, n) => s + n0(n.qty), 0)) }))
    .filter(x => x.count).sort((a, b) => b.count - a.count);
  const closed = ncrs.filter(n => n.status === 'Closed' && n.closed_on >= f && n.closed_on <= t);
  const open = ncrs.filter(n => !['Closed', 'Cancelled'].includes(n.status));
  const overdue = open.filter(n => n.target_date && n.target_date < today());
  // Inspection compliance: orders completed in the period that have a final QC.
  const done = db.prepare("SELECT id, order_no FROM production_orders WHERE status = 'Completed' AND completed_on BETWEEN ? AND ?").all(f, t);
  const withFqc = done.filter(o => fqcAccepted(o.id) > 0);
  return {
    from: f, to: t, kinds, stages,
    totals: {
      inspections: ins.length, internal_rejection_pct: pct(sum(internal, 'qty_rejected'), I), rework_pct: pct(sum(internal, 'qty_rework'), I), fpy: pct(sum(internal, 'qty_accepted'), I),
      incoming_rejection_pct: pct(iqc.rejected, iqc.qty), incoming_lots: iqc.n,
      ncr_raised: inPeriod.length, ncr_open: open.length, ncr_overdue: overdue.length, capa_closed: closed.length,
      capa_on_time_pct: pct(closed.filter(n => !n.target_date || n.closed_on <= n.target_date).length, closed.length),
      rework_hours: r2(inPeriod.reduce((s, n) => s + n0(n.rework_hours), 0)), rework_cost: r2(inPeriod.reduce((s, n) => s + n0(n.rework_cost), 0)), scrap_value: r2(inPeriod.reduce((s, n) => s + n0(n.scrap_value), 0)),
      completed_orders: done.length, inspection_compliance_pct: pct(withFqc.length, done.length),
    },
    pareto,
    open: open.map(n => ({ id: n.id, ncr_no: n.ncr_no, date: n.date, source: n.source, category: n.category, order_no: n.order_no, description: n.description, qty: n.qty, disposition: n.disposition,
      responsible: n.responsible, target_date: n.target_date, status: n.status, overdue: !!(n.target_date && n.target_date < today()) })),
    inspections: ins.slice(0, 200).map(r => ({ id: r.id, qc_no: r.qc_no, date: r.date, kind: r.kind, stage: r.stage, order_id: r.order_id, order_no: r.order_no, description: r.description,
      inspected: r.qty_inspected, accepted: r.qty_accepted, rework: r.qty_rework, rejected: r.qty_rejected, result: r.result, inspector: r.inspector, ncr_id: r.ncr_id })),
  };
}

// For the daily reminder: NCRs whose CAPA is past the target date.
export const overdueNcrs = () => db.prepare("SELECT ncr_no FROM ncrs WHERE status NOT IN ('Closed', 'Cancelled') AND target_date < ? ORDER BY target_date").all(today()).map(r => r.ncr_no);
