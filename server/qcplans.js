// QC plans: per product, what is checked at each stage (incoming, in-process, factory final, site, commissioning), how,
// and against which limit. A project's QC list is made from its work order lines: one record per work order section,
// product and stage. Results are measured values the CRM judges against the limits; a failure raises an NCR. Limits
// nobody has set stay blank and show as a warning: they are the design head's, not to be guessed.
import { db, tx, audit } from './db.js';
import { getRow, insertRow, updateRow, HttpError } from './crud.js';
import { hasFunction, canView, QC_PLAN_STAGES } from '../public/js/schema.js';
import { notify } from './notify.js';
import { CAPA_DAYS } from './quality.js';

const today = () => new Date().toLocaleString('sv-SE').slice(0, 10);
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleString('sv-SE').slice(0, 10); };
const parse = (v, d) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || 'null') ?? d; } catch { return d; } };
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const NCR_SOURCE = { Incoming: 'Incoming (IQC)', 'In-process': 'In-process (IPQC)', 'Factory final': 'Final (FQC)', Site: 'Site', Commissioning: 'Site' };
const SITE_STAGES = ['Site', 'Commissioning'];
const hasLimit = c => num(c.min) != null || num(c.max) != null || String(c.limit || '').trim() !== '';

// ---------------------------------------------------------------- the first plans; every other figure is left for the design head
const c = (stage, check, method, instrument, frequency, o = {}) => ({ stage, check, method, instrument, frequency, min: null, max: null, unit: '', limit: '', hold: 'No', only_if: '', source: '', ...o });
const STARTER = [
  { product: 'PUF wall and ceiling panels', keywords: 'modular wall, modular ceiling', checks: [
    c('Incoming', 'PPGL sheet thickness', 'Micrometer, 3 points per sampled sheet', 'Micrometer', 'Each batch', { unit: 'mm', source: 'Work order: 0.5 mm. Design head to set the tolerance' }),
    c('Incoming', 'Mill / test certificate', 'Check the document against the batch', '', 'Each batch', { limit: 'Certificate on file; make as per work order', hold: 'Yes' }),
    c('Incoming', 'Lead sheet thickness', 'Micrometer, 3 points per sheet', 'Micrometer', 'Each sheet', { min: 1, unit: 'mm', hold: 'Yes', only_if: 'lead', source: 'Work order: 1 mm. The RSO shielding calculation decides the final thickness' }),
    c('In-process', 'PUF core density', 'Weigh a cut core sample of known volume', 'Balance and scale', 'Each foaming batch', { unit: 'kg/m³', hold: 'Yes', source: 'Work order: 40 kg/m³. Design head to set the tolerance' }),
    c('In-process', 'Panel thickness', 'Vernier at the edges of each sampled panel', 'Vernier', 'Each batch', { unit: 'mm', source: 'As per the work order line: 50 or 100 mm. Design head to set the tolerance' }),
    c('In-process', 'Skin to core adhesion', 'Peel test on a sample', '', 'Each foaming batch', { source: 'Design head to set the pass condition' }),
    c('In-process', 'Lead continuity', 'Inspect before the panel is closed', '', 'Each panel', { limit: 'No gaps; overlap as per drawing', hold: 'Yes', only_if: 'lead' }),
    c('Factory final', 'Length and width against drawing', 'Measuring tape', 'Tape', 'Each panel', { unit: 'mm', source: 'Design head to set the tolerance' }),
    c('Factory final', 'Flatness', 'Straight edge and feeler gauge', 'Straight edge, feeler gauge', 'Sample per batch', { unit: 'mm', source: 'Design head to set the limit' }),
    c('Factory final', 'Squareness', 'Compare the diagonals', 'Tape', 'Sample per batch', { unit: 'mm', source: 'Design head to set the limit' }),
    c('Factory final', 'Surface finish', 'Visual', '', 'Each panel', { limit: 'No dents, scratches or coating damage' }),
    c('Factory final', 'Identification label', 'Compare with the layout drawing', '', 'Each panel', { limit: 'Panel number matches the layout' }),
    c('Site', 'Alignment and plumb', 'Spirit level and plumb line', 'Spirit level', 'Each wall', { unit: 'mm', source: 'Design head to set the limit' }),
    c('Site', 'Joint sealing', 'Visual along every joint', '', 'Each room', { limit: 'Continuous; no gaps or voids', hold: 'Yes' }),
    c('Site', 'Coving', 'Visual', '', 'Each room', { limit: 'All floor, wall and ceiling junctions covered; no gaps' }),
    c('Site', 'Penetrations sealed', 'Visual at every service entry', '', 'Each room', { limit: 'All sealed before the ceiling is closed', hold: 'Yes' }),
    c('Site', 'Radiation survey', "By the hospital's RSO / physicist after installation", 'Survey meter', 'Each lead-lined room', { limit: 'Survey report on file and accepted by the RSO', hold: 'Yes', only_if: 'lead' }),
  ] },
  { product: 'OT system validation', keywords: 'system validation', checks: [
    c('Commissioning', 'Particle count at 0.5 µm', 'ISO 14644-1 count at the supply', 'Particle counter', 'Each OT', { max: 3520, unit: 'particles/m³', hold: 'Yes', source: 'Work order: ISO Class 5. Limit from ISO 14644-1' }),
    c('Commissioning', 'HEPA filter leak scan', 'Aerosol challenge and photometer scan', 'Photometer, aerosol generator', 'Each filter', { unit: '%', hold: 'Yes', source: 'Commonly 0.01%. Confirm against the contract and ISO 14644-3' }),
    c('Commissioning', 'Air velocity', 'Anemometer on a grid', 'Anemometer', 'Each OT', { unit: 'm/s', hold: 'Yes', source: 'CONFLICT: work orders say at least 0.45 m/s at the operating area; NABH 2018 says 25–35 fpm (0.13–0.18 m/s) at the diffuser. Design head to fix the value and the measuring point' }),
    c('Commissioning', 'Air changes per hour', 'Calculate from the measured air volume', 'Anemometer / balometer', 'Each OT', { min: 20, unit: 'per hour', hold: 'Yes', source: 'NABH 2018: at least 20' }),
    c('Commissioning', 'Fresh air changes per hour', 'Measure the fresh air volume', 'Anemometer', 'Each OT', { min: 4, unit: 'per hour', source: 'NABH 2018: at least 4' }),
    c('Commissioning', 'Room pressure', 'Differential pressure against the passage', 'Manometer', 'Each OT', { min: 2.5, max: 5, unit: 'Pa', hold: 'Yes', source: 'Work order: 2.5 to 5 Pa' }),
    c('Commissioning', 'Temperature', 'Calibrated probe at the table', 'Thermo-hygrometer', 'Each OT', { min: 18, max: 24, unit: '°C', source: 'NABH 2018: 21 ± 3 °C. Joint replacement 18 ± 2 °C: narrow it for those OTs' }),
    c('Commissioning', 'Relative humidity', 'Calibrated probe at the table', 'Thermo-hygrometer', 'Each OT', { min: 20, max: 60, unit: '%', source: 'NABH 2018: 20–60%' }),
    c('Commissioning', 'Validation report', 'Check the documents', '', 'Each OT', { limit: 'Report and instrument calibration certificates on file', hold: 'Yes' }),
  ] },
];

export function seedPlans() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'qc_plans_v1'").get()) return;
  const system = { name: 'System', role: 'admin' };
  for (const p of STARTER) insertRow('qc_plans', { ...p, status: 'Draft', checks: JSON.stringify(p.checks) }, system, { system: true });
  db.prepare("INSERT INTO settings (key, value) VALUES ('qc_plans_v1', '\"1\"')").run();
}

// A plan is approved only when every check has a limit.
export function prepPlan(row, existing) {
  const m = { ...(existing || {}), ...row };
  if (m.status === 'Approved') {
    const open = parse(m.checks, []).filter(x => !hasLimit(x)).map(x => x.check);
    if (open.length) throw new HttpError(400, `Set a limit first: ${open.join(', ')}`);
  }
}

const planChecks = (plan, stage, lines) => parse(plan.checks, []).filter(x => x.stage === stage
  && (!String(x.only_if || '').trim() || lines.some(l => String(l.description || '').toLowerCase().includes(String(x.only_if).trim().toLowerCase()))))
  .map(({ stage: _s, only_if: _o, ...x }) => ({ ...x, measured: '', result: '', remark: '' }));

// Plan fields come from the record on the server, so only measured, result and remark can be changed.
export function prepRecord(row, existing) {
  if (!existing || !('checks' in row)) return;
  const sent = parse(row.checks, []);
  row.checks = JSON.stringify(parse(existing.checks, []).map(o => {
    const s = sent.find(x => x.check === o.check) || o;
    const measured = s.measured ?? '';
    let result = s.result || '';
    const v = String(measured).trim() === '' ? null : Number(measured);
    if (result !== 'NA' && (num(o.min) != null || num(o.max) != null) && Number.isFinite(v) && v !== null) result = (num(o.min) == null || v >= num(o.min)) && (num(o.max) == null || v <= num(o.max)) ? 'OK' : 'Not OK';
    return { ...o, measured, result, remark: s.remark || '' };
  }));
}

// ---------------------------------------------------------------- the project's list, from its work orders
const latest = projectId => db.prepare(`SELECT r.* FROM project_qc r WHERE r.project_id = ? AND r.id = (SELECT MAX(x.id) FROM project_qc x
  WHERE x.boq_id = r.boq_id AND COALESCE(x.section, '') = COALESCE(r.section, '') AND x.plan_id = r.plan_id AND x.stage = r.stage) ORDER BY r.section, r.plan_id, r.id`).all(Number(projectId));

export function generate(projectId, user) {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(Number(projectId));
  if (!project) throw new HttpError(404, 'Project not found');
  const plans = db.prepare('SELECT * FROM qc_plans ORDER BY id').all();
  const boqs = db.prepare('SELECT id FROM boqs WHERE project_id = ?').all(project.id);
  let created = 0, refreshed = 0;
  return tx(() => {
    for (const b of boqs) {
      const lines = db.prepare("SELECT section, description, qty, uom FROM boq_items WHERE boq_id = ? AND COALESCE(kind, 'Item') = 'Item' ORDER BY sort, id").all(b.id);
      for (const section of [...new Set(lines.map(l => l.section || ''))]) {
        for (const plan of plans) {
          const keys = String(plan.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
          const matched = lines.filter(l => (l.section || '') === section && keys.some(k => String(l.description || '').toLowerCase().includes(k)));
          if (!matched.length) continue;
          const items = matched.map(l => `${String(l.description).replace(/\s+/g, ' ').slice(0, 90)}${l.qty != null ? ` – ${Math.round(Number(l.qty) * 100) / 100} ${l.uom || ''}` : ''}`).join('\n');
          for (const stage of QC_PLAN_STAGES) {
            const checks = planChecks(plan, stage, matched);
            if (!checks.length) continue;
            const old = db.prepare("SELECT id, status, checks FROM project_qc WHERE boq_id = ? AND COALESCE(section, '') = ? AND plan_id = ? AND stage = ? ORDER BY id DESC LIMIT 1").get(b.id, section, plan.id, stage);
            if (!old) {
              insertRow('project_qc', { project_id: project.id, boq_id: b.id, section: section || null, plan_id: plan.id, stage, items, status: 'Pending', checks: JSON.stringify(checks) }, user, { system: true });
              created++;
            } else if (old.status === 'Pending' && !parse(old.checks, []).some(x => x.result || x.measured || x.remark)) {
              db.prepare('UPDATE project_qc SET checks = ?, items = ? WHERE id = ?').run(JSON.stringify(checks), items, old.id); // limits set since
              refreshed++;
            }
          }
        }
      }
    }
    if (created) audit(user.name, 'projects', project.id, 'QC list', `${created} records created`);
    return { created, refreshed, work_orders: boqs.length };
  });
}

const holdsOf = r => parse(r.checks, []).filter(x => x.hold === 'Yes').map(x => x.check);

export function board(projectId, user) {
  if (!canView('project_qc', user.role)) throw new HttpError(403, 'No access to QC records');
  const project = db.prepare('SELECT id, code, name FROM projects WHERE id = ?').get(Number(projectId));
  if (!project) throw new HttpError(404, 'Project not found');
  const plans = db.prepare('SELECT id, product, keywords, status, checks FROM qc_plans ORDER BY id').all();
  const rows = latest(project.id).map(r => { const ch = parse(r.checks, []); return { id: r.id, pqc_no: r.pqc_no, boq_id: r.boq_id, section: r.section, plan_id: r.plan_id, stage: r.stage, status: r.status, date: r.date, ncr_id: r.ncr_id, checks: ch.length, no_limit: ch.filter(x => !hasLimit(x)).length, holds: holdsOf(r).length }; });
  const keysOf = p => String(p.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  const keys = plans.flatMap(keysOf);
  const lines = db.prepare("SELECT i.description FROM boq_items i JOIN boqs b ON b.id = i.boq_id WHERE b.project_id = ? AND COALESCE(i.kind, 'Item') = 'Item' AND COALESCE(i.qty, 0) > 0").all(project.id);
  const count = s => rows.filter(r => r.status === s).length;
  return { project, rows, stages: QC_PLAN_STAGES,
    plans: plans.map(p => ({ id: p.id, product: p.product, status: p.status, no_limit: parse(p.checks, []).filter(x => !hasLimit(x)).length })),
    totals: { total: rows.length, passed: count('Passed'), failed: count('Failed'), pending: count('Pending'), open_holds: rows.filter(r => r.status !== 'Passed' && r.holds).length },
    lines_total: lines.length, lines_no_plan: lines.filter(l => !keys.some(k => String(l.description || '').toLowerCase().includes(k))).length,
    work_orders: db.prepare('SELECT COUNT(*) n FROM boqs WHERE project_id = ?').get(project.id).n };
}

// ---------------------------------------------------------------- recording a result
const mayRecord = (user, stage) => hasFunction(user.role, 'qc_inspect') || (hasFunction(user.role, 'qc_site') && SITE_STAGES.includes(stage));

export function complete(id, user) {
  const r = getRow('project_qc', id);
  if (!mayRecord(user, r.stage)) throw new HttpError(403, `Your role may not record ${r.stage} QC`);
  if (r.status !== 'Pending') throw new HttpError(409, `Already ${r.status}`);
  const checks = parse(r.checks, []), bad = [];
  checks.forEach((x, i) => {
    const name = `Check ${i + 1} (${x.check})`;
    if (!x.result) bad.push(`${name}: enter the result`);
    if (x.result === 'NA') { if (x.hold === 'Yes' && !String(x.remark || '').trim()) bad.push(`${name} is a hold point: write why it does not apply`); return; }
    if ((num(x.min) != null || num(x.max) != null) && num(x.measured) == null) bad.push(`${name}: enter the measured number`);
    if (!hasLimit(x) && !String(x.measured || '').trim()) bad.push(`${name}: no limit is set yet, so enter what was measured`);
  });
  const notOk = checks.filter(x => x.result === 'Not OK');
  if (notOk.length && !String(r.defect || '').trim()) bad.push('Write the defect / reason');
  if (notOk.length && !r.defect_category) bad.push('Choose the defect category');
  if (bad.length) throw new HttpError(400, bad.join('\n'));
  const date = r.date || today();
  // Started out of order: said, not stopped, while the team gets used to the plans.
  const order = QC_PLAN_STAGES.indexOf(r.stage);
  const open = latest(r.project_id).filter(x => x.id !== r.id && x.boq_id === r.boq_id && (x.section || '') === (r.section || '') && x.status !== 'Passed' && holdsOf(x).length
    && (r.stage === 'Commissioning' ? true : x.plan_id === r.plan_id && QC_PLAN_STAGES.indexOf(x.stage) < order));
  return tx(() => {
    let ncrId = null;
    if (notOk.length) {
      const ncr = insertRow('ncrs', { date, source: NCR_SOURCE[r.stage], category: r.defect_category, project_id: r.project_id, qc_record_id: r.id,
        description: `${r.pqc_no} · ${r.plan_id_label || ''} · ${r.stage}${r.section ? ' · ' + r.section : ''}: ${r.defect}\nNot OK: ${notOk.map(x => `${x.check}${String(x.measured || '') !== '' ? ` (${x.measured}${x.unit ? ' ' + x.unit : ''})` : ''}`).join(', ')}`,
        segregated: 'Yes', target_date: addDays(date, CAPA_DAYS) }, user, { system: true });
      ncrId = ncr.id;
      notify({ fn: 'ncr_close', kind: 'quality', title: `NCR ${ncr.ncr_no}: ${r.stage} QC failed`, body: r.defect, link: `#/view/ncrs/${ncr.id}` }, user);
    }
    const out = updateRow('project_qc', id, { status: notOk.length ? 'Failed' : 'Passed', date, inspector: r.inspector || user.name, done_by: `${user.name} (${stamp()})`, ncr_id: ncrId }, user, { system: true });
    audit(user.name, 'project_qc', r.id, `QC ${out.status}`, `${r.pqc_no} ${r.stage}`);
    return { ...out, warning: open.length ? `Hold points still open before this stage: ${open.map(x => `${x.stage} (${x.pqc_no})`).join(', ')}` : null };
  });
}

// After rework: a new record; the failed one stays as evidence.
export function retest(id, user) {
  const r = getRow('project_qc', id);
  if (!mayRecord(user, r.stage)) throw new HttpError(403, `Your role may not record ${r.stage} QC`);
  if (r.status !== 'Failed') throw new HttpError(409, 'Only a failed record is tested again');
  const newer = db.prepare("SELECT 1 FROM project_qc WHERE boq_id = ? AND COALESCE(section, '') = COALESCE(?, '') AND plan_id = ? AND stage = ? AND id > ?").get(r.boq_id, r.section, r.plan_id, r.stage, r.id);
  if (newer) throw new HttpError(409, 'This has already been sent for a new test');
  return insertRow('project_qc', { project_id: r.project_id, boq_id: r.boq_id, section: r.section, plan_id: r.plan_id, stage: r.stage, items: r.items, status: 'Pending', retest_of: r.id,
    checks: JSON.stringify(parse(r.checks, []).map(x => ({ ...x, measured: '', result: '', remark: '' }))) }, user, { system: true });
}

// The file for the client or an audit: every record of the project, with the files attached to each.
export function file(projectId, user) {
  if (!canView('project_qc', user.role)) throw new HttpError(403, 'No access to QC records');
  const project = db.prepare('SELECT id, code, name FROM projects WHERE id = ?').get(Number(projectId));
  if (!project) throw new HttpError(404, 'Project not found');
  const ids = db.prepare('SELECT id FROM project_qc WHERE project_id = ? ORDER BY section, plan_id, id').all(project.id);
  const files = db.prepare("SELECT filename FROM attachments WHERE entity = 'project_qc' AND record_id = ? ORDER BY id");
  return { project, records: ids.map(({ id }) => ({ ...getRow('project_qc', id), files: files.all(id).map(f => f.filename) })) };
}
