// Quality (QEMS Vol 3): QC inspections in process, at final QC and before dispatch, with the checks of the policy
// filled in; rework / rejection raises an NCR; NCR → root cause → corrective & preventive action within 30 days →
// verification → closure. Final QC's accepted qty limits what the daily reports count as finished. The quality review
// gives incoming / internal rejection %, rework %, first-pass yield, the NCR Pareto, CAPA closure and the cost of poor
// quality.
import { db, tx, audit } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction, QC_STAGE_CHECKS, QC_ELECTRICAL_CHECKS, QC_FINAL_CHECKS, QC_PRODUCT_CHECKS, QC_DISPATCH_CHECKS, NCR_CATEGORIES, RCA_METHODS, FMEA_ACTION_RPN } from '../public/js/schema.js';
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

// ---------------------------------------------------------------- root cause analysis (5 Why, Fishbone, Pareto, Process mapping, FMEA)
const score = v => (v === '' || v == null ? null : Number(v));
const okScore = v => Number.isInteger(v) && v >= 1 && v <= 10;
const filled = v => String(v ?? '').trim() !== '';
export const fmeaNeedsAction = r => (okScore(score(r.s)) && score(r.s) >= 9) || n0(r.rpn) >= FMEA_ACTION_RPN;

// Which methods the NCR uses, and what each still lacks (every method used must be complete; the main one is required).
export function rcaCheck(n) {
  const whys = parse(n.whys, []).filter(w => filled(w.why) || filled(w.because));
  const fish = parse(n.fishbone, []).filter(c => filled(c.cause));
  const steps = parse(n.process_steps, []).filter(p => filled(p.step));
  const fmea = parse(n.fmea, []).filter(r => filled(r.mode));
  const used = { '5 Why': whys.length > 0, Fishbone: fish.length > 0, Pareto: filled(n.pareto_note), 'Process mapping': steps.length > 0, FMEA: fmea.length > 0 };
  const miss = [];
  const need = m => used[m] || n.rca_method === m;
  if (need('5 Why')) {
    const done = whys.filter(w => filled(w.why) && filled(w.because)).length;
    if (done < 3) miss.push(`5 Why: ${done} of at least 3 why / because rows answered`);
  }
  if (need('Fishbone')) {
    if (fish.some(c => !c.category)) miss.push('Fishbone: choose the 6M heading for every cause');
    const cats = new Set(fish.map(c => c.category).filter(Boolean));
    if (cats.size < 3) miss.push(`Fishbone: causes under at least 3 of the 6M headings (now ${cats.size})`);
    const open = fish.filter(c => !['Confirmed', 'Ruled out'].includes(c.check)).length;
    if (open) miss.push(`Fishbone: ${open} cause(s) not checked yet (Confirmed / Ruled out)`);
    if (!fish.some(c => c.check === 'Confirmed')) miss.push('Fishbone: confirm at least one cause, with the evidence');
  }
  if (need('Pareto') && !used.Pareto) miss.push('Pareto: write the conclusion (open 📊 Pareto)');
  if (need('Process mapping')) {
    if (steps.length < 3) miss.push(`Process mapping: at least 3 steps (now ${steps.length})`);
    if (!steps.some(p => /entered|Escaped/.test(p.finding || ''))) miss.push('Process mapping: mark the step where the defect got in or escaped');
  }
  if (need('FMEA')) {
    if (!fmea.length) miss.push('FMEA: add the failure modes');
    fmea.forEach((r, i) => {
      if (![r.s, r.o, r.d].map(score).every(okScore)) miss.push(`FMEA row ${i + 1}: S, O and D from 1 to 10`);
      else if (fmeaNeedsAction(r) && (!filled(r.action) || !filled(r.owner))) miss.push(`FMEA row ${i + 1} (RPN ${r.rpn}${score(r.s) >= 9 ? ', severity ' + r.s : ''}): an action and who does it`);
    });
  }
  const methods = RCA_METHODS.filter(m => used[m]);
  return { methods, missing: miss, status: !methods.length ? 'No method used yet' : miss.length ? miss.join('\n') : 'Complete' };
}

export function prepNcr(row, existing) {
  const date = row.date || existing?.date || today();
  if (!existing && !row.target_date) row.target_date = addDays(date, CAPA_DAYS);
  const orderId = row.order_id ?? existing?.order_id;
  if (orderId && !(row.project_id ?? existing?.project_id)) row.project_id = db.prepare('SELECT project_id FROM production_orders WHERE id = ?').get(Number(orderId))?.project_id || null;
  if ('whys' in row) row.whys = JSON.stringify(parse(row.whys, []).filter(w => filled(w.why) || filled(w.because)));
  if ('fishbone' in row) row.fishbone = JSON.stringify(parse(row.fishbone, []).filter(c => filled(c.cause)));
  if ('process_steps' in row) row.process_steps = JSON.stringify(parse(row.process_steps, []).filter(p => filled(p.step)));
  if ('fmea' in row) {
    const rpn = (s, o, d) => ([s, o, d].map(score).every(okScore) ? score(s) * score(o) * score(d) : null);
    row.fmea = JSON.stringify(parse(row.fmea, []).filter(r => filled(r.mode)).map(r => ({ ...r, rpn: rpn(r.s, r.o, r.d), rpn2: rpn(r.s2, r.o2, r.d2) })));
  }
  const m = { ...(existing || {}), ...row };
  // Root cause left blank: the last 5 Why answer.
  const whys = parse(m.whys, []);
  if (!filled(m.root_cause) && whys.length && filled(whys.at(-1).because) && ('whys' in row || 'root_cause' in row)) row.root_cause = whys.at(-1).because;
  const c = rcaCheck(m);
  row.rca_methods = c.methods.join(', ') || null;
  row.rca_status = c.status;
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
    if (!n.rca_method) throw new HttpError(400, `Choose the main root cause method (${RCA_METHODS.join(', ')})`);
    const c = rcaCheck(n);
    if (c.missing.length) throw new HttpError(400, `The root cause analysis is not complete:\n• ${c.missing.join('\n• ')}`);
    return tx(() => {
      const tasks = capaTasks(n, user);
      return updateRow('ncrs', id, { status: 'Action in progress', capa_tasks: JSON.stringify(tasks) }, user, { system: true });
    });
  }
  if (action === 'close') {
    if (!head) throw new HttpError(403, 'Only the quality head closes an NCR (verifies the CAPA)');
    if (n.status !== 'Action in progress') throw new HttpError(409, 'Record the root cause and CAPA first (Action in progress)');
    if (!String(n.verification || '').trim()) throw new HttpError(400, 'Write how the action was verified as effective');
    const open = taskRows(n).filter(t => !['Done', 'Cancelled'].includes(t.status));
    if (open.length) throw new HttpError(409, `CAPA tasks not done yet:\n${open.map(t => `• ${t.task_no} – ${t.assigned_to}: ${t.title}`).join('\n')}`);
    const out = updateRow('ncrs', id, { status: 'Closed', closed_by: `${user.name} (${stamp()})`, closed_on: today() }, user, { system: true });
    audit(user.name, 'ncrs', n.id, 'closed', n.ncr_no);
    return out;
  }
  if (action === 'cancel') {
    if (!head) throw new HttpError(403, 'Only the quality head cancels an NCR');
    if (['Closed', 'Cancelled'].includes(n.status)) throw new HttpError(409, `This NCR is ${n.status}`);
    const why = String(body.reason || '').trim();
    if (!why) throw new HttpError(400, 'Write why the NCR is cancelled');
    return tx(() => {
      for (const t of taskRows(n).filter(t => !['Done', 'Cancelled'].includes(t.status))) updateRow('work_tasks', t.id, { status: 'Cancelled', progress_note: `NCR ${n.ncr_no} cancelled: ${why}` }, user, { system: true });
      return updateRow('ncrs', id, { status: 'Cancelled', remarks: [n.remarks, `${today()}: cancelled by ${user.name} – ${why}`].filter(Boolean).join('\n') }, user, { system: true });
    });
  }
  throw new HttpError(400, 'Unknown action');
}

// CAPA tasks (Task Scheduler): one for the NCR's responsible person with the corrective and preventive action, and
// one for each other FMEA action owner. The NCR closes only when they are done.
const taskRows = n => { const ids = parse(n.capa_tasks, []).map(Number).filter(Boolean); return ids.length ? db.prepare(`SELECT id, task_no, title, assigned_to, status FROM work_tasks WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []; };
function capaTasks(n, user) {
  const by = { name: user.name, username: user.username, role: 'admin' }; // tasks given on the NCR's behalf
  const first = s => String(s || '').split('\n')[0].slice(0, 90);
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const fmea = parse(n.fmea, []).filter(r => filled(r.action));
  const mine = fmea.filter(r => !filled(r.owner) || same(r.owner, n.responsible));
  const base = { assigned_by: user.name, priority: 'High', category: 'Production', start_date: today(), due_date: n.target_date, status: 'To do' };
  const ids = [];
  const main = insertRow('work_tasks', { ...base, assigned_to: n.responsible, title: `CAPA ${n.ncr_no}: ${first(n.corrective_action)}`,
    description: `${first(n.description)}\nRoot cause: ${n.root_cause}\nCorrective action: ${n.corrective_action}\nPreventive action: ${n.preventive_action}\nOpen the NCR: #/view/ncrs/${n.id}`,
    checklist: [{ item: `Corrective action: ${first(n.corrective_action)}`, done: '' }, { item: `Preventive action: ${first(n.preventive_action)}`, done: '' },
      ...mine.map(r => ({ item: `FMEA – ${r.mode}: ${r.action}`, done: '' })), { item: 'Evidence for the verification (photo / measurement / record)', done: '' }] }, by, { system: true });
  ids.push(main.id);
  const owners = new Map();
  for (const r of fmea.filter(r => !mine.includes(r))) owners.set(r.owner.trim(), [...(owners.get(r.owner.trim()) || []), r]);
  for (const [owner, rows] of owners) {
    const t = insertRow('work_tasks', { ...base, assigned_to: owner, title: `CAPA ${n.ncr_no} (FMEA): ${first(rows[0].action)}${rows.length > 1 ? ` + ${rows.length - 1} more` : ''}`,
      description: `FMEA actions from ${n.ncr_no}: ${first(n.description)}\nOpen the NCR: #/view/ncrs/${n.id}`,
      checklist: rows.map(r => ({ item: `${r.mode} (RPN ${r.rpn ?? '?'}): ${r.action}`, done: '' })) }, by, { system: true });
    ids.push(t.id);
  }
  return ids;
}
export const capaTaskList = id => taskRows(getRow('ncrs', id));

// ---------------------------------------------------------------- Pareto (vital few) over NCRs and failed checks
export const PARETO_BY = { category: 'NCR category', cause: 'Confirmed cause (6M)', stage: 'Stage / where found', product: 'Product category', check: 'Failed QC check', source: 'Found at' };
export function paretoAnalysis({ from, to, by = 'category', measure = 'count' } = {}) {
  const f = from || addDays(today(), -180), t = to || today();
  if (!PARETO_BY[by]) throw new HttpError(400, 'Unknown Pareto basis');
  const sums = new Map();
  const add = (k, v) => sums.set(k || '(not given)', (sums.get(k || '(not given)') || 0) + v);
  let n = 0;
  if (by === 'check') {
    const ins = db.prepare("SELECT checks, qty_rework, qty_rejected FROM qc_inspections WHERE status = 'Done' AND date BETWEEN ? AND ?").all(f, t);
    for (const q of ins) for (const c of parse(q.checks, []).filter(c => c.result === 'Not OK')) { n++; add(c.check, measure === 'qty' ? n0(q.qty_rework) + n0(q.qty_rejected) : 1); }
  } else {
    const rows = db.prepare(`SELECT n.*, o.category product, q.stage FROM ncrs n LEFT JOIN production_orders o ON o.id = n.order_id LEFT JOIN qc_inspections q ON q.id = n.inspection_id
      WHERE n.status <> 'Cancelled' AND n.date BETWEEN ? AND ?`).all(f, t);
    for (const r of rows) {
      n++;
      const v = measure === 'qty' ? n0(r.qty) : measure === 'cost' ? n0(r.rework_cost) + n0(r.scrap_value) : 1;
      if (by === 'cause') { const cs = parse(r.fishbone, []).filter(c => c.check === 'Confirmed'); for (const c of cs) add(c.category, v / cs.length); }
      else add(by === 'category' ? r.category : by === 'stage' ? r.stage || r.source : by === 'product' ? r.product : r.source, v);
    }
  }
  const total = [...sums.values()].reduce((s, v) => s + v, 0);
  let cum = 0, vital = true;
  const out = [...sums.entries()].map(([key, value]) => ({ key, value: r2(value) })).filter(r => r.value > 0).sort((a, b) => b.value - a.value).map(r => {
    const was = cum; cum += r.value;
    const row = { ...r, share: pct(r.value, total), cum: pct(cum, total), vital: vital || was === 0 };
    if (pct(cum, total) >= 80) vital = false;
    return row;
  });
  return { from: f, to: t, by, by_label: PARETO_BY[by], measure, total: r2(total), records: n, rows: out };
}
// For one NCR: where its category, product and confirmed causes stand in the last 6 months.
export function ncrPareto(id) {
  const n = getRow('ncrs', id);
  const product = n.order_id ? db.prepare('SELECT category FROM production_orders WHERE id = ?').get(n.order_id)?.category : null;
  const causes = (n.fishbone || []).filter(c => c.check === 'Confirmed').map(c => c.category);
  const from = addDays(n.date, -180), to = today();
  return { ncr_no: n.ncr_no, from, to, mine: { category: n.category, product, causes },
    category: paretoAnalysis({ from, to, by: 'category' }), product: paretoAnalysis({ from, to, by: 'product' }), cause: paretoAnalysis({ from, to, by: 'cause' }), check: paretoAnalysis({ from, to, by: 'check' }) };
}

// FMEA register: every failure mode from every NCR, highest risk first, with the actions still open.
export function fmeaRegister() {
  const rows = [];
  for (const n of db.prepare(`SELECT n.id, n.ncr_no, n.date, n.status, n.fmea, o.category product FROM ncrs n LEFT JOIN production_orders o ON o.id = n.order_id WHERE n.status <> 'Cancelled' AND n.fmea IS NOT NULL AND n.fmea NOT IN ('', '[]')`).all()) {
    for (const r of parse(n.fmea, [])) rows.push({ ...r, ncr_id: n.id, ncr_no: n.ncr_no, date: n.date, ncr_status: n.status, product: n.product,
      risk: r.rpn2 ?? r.rpn, open: fmeaNeedsAction(r) && (r.rpn2 == null || r.rpn2 >= FMEA_ACTION_RPN) });
  }
  return rows.sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0));
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
      rca_complete_pct: pct(inPeriod.filter(n => n.rca_status === 'Complete').length, inPeriod.filter(n => ['Action in progress', 'Closed'].includes(n.status) || n.rca_methods).length),
      fmea_open: fmeaRegister().filter(r => r.open).length,
    },
    pareto, methods: RCA_METHODS.map(m => ({ method: m, main: inPeriod.filter(n => n.rca_method === m).length, used: inPeriod.filter(n => String(n.rca_methods || '').split(', ').includes(m)).length })),
    open: open.map(n => ({ id: n.id, ncr_no: n.ncr_no, date: n.date, source: n.source, category: n.category, order_no: n.order_no, description: n.description, qty: n.qty, disposition: n.disposition,
      responsible: n.responsible, target_date: n.target_date, status: n.status, overdue: !!(n.target_date && n.target_date < today()), rca_method: n.rca_method, rca_ok: n.rca_status === 'Complete' })),
    inspections: ins.slice(0, 200).map(r => ({ id: r.id, qc_no: r.qc_no, date: r.date, kind: r.kind, stage: r.stage, order_id: r.order_id, order_no: r.order_no, description: r.description,
      inspected: r.qty_inspected, accepted: r.qty_accepted, rework: r.qty_rework, rejected: r.qty_rejected, result: r.result, inspector: r.inspector, ncr_id: r.ncr_id })),
  };
}

// For the daily reminder: NCRs whose CAPA is past the target date.
export const overdueNcrs = () => db.prepare("SELECT ncr_no FROM ncrs WHERE status NOT IN ('Closed', 'Cancelled') AND target_date < ? ORDER BY target_date").all(today()).map(r => r.ncr_no);
