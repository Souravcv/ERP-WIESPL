// Sales Finance check (management discussion, Nov 2026): before a quotation goes on, Sales Finance checks four things on the
// costing sheet: raw material, timeline (city rate x project days, penalty clause), manpower (days x rate) and logistics.
// Profit above the limit: cleared at once. Below the limit: sent as an approval to the seniors (journey step s6).
import { db, getSettings, setSettings, audit } from './db.js';
import { HttpError, getRow, updateRow } from './crud.js';
import { hasFunction, canView } from '../public/js/schema.js';
import { journeyFor } from './journey.js';

const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);
export const DEFAULT_MIN_PROFIT = 20;

export const rates = () => {
  const s = getSettings();
  let cities = s.sf_city_rates; if (typeof cities === 'string') { try { cities = JSON.parse(cities); } catch { cities = {}; } }
  return { cities: cities && typeof cities === 'object' ? cities : {}, manpower_day: Number(s.sf_manpower_day) || 0, min_profit_pct: Number(s.sf_min_profit_pct) || DEFAULT_MIN_PROFIT };
};
const cityRate = (cities, city) => { const k = Object.keys(cities).find(x => x.trim().toLowerCase() === String(city || '').trim().toLowerCase()); return k ? Number(cities[k]) : null; };

export function saveRates(body, user) {
  if (!hasFunction(user.role, 'sales_fin_rates')) throw new HttpError(403, 'Only the Finance Head can change the Sales Finance rates');
  const cur = rates(), out = {};
  if (body.city) {
    const city = String(body.city).trim().slice(0, 60), rate = Number(body.rate);
    if (!city || !(rate >= 0)) throw new HttpError(400, 'Give the city and its cost per day');
    out.sf_city_rates = { ...cur.cities, [city]: rate };
  }
  if (body.manpower_day !== undefined && body.manpower_day !== '') { const m = Number(body.manpower_day); if (!(m >= 0)) throw new HttpError(400, 'Manpower cost per day must be a number'); out.sf_manpower_day = m; }
  if (body.min_profit_pct !== undefined && body.min_profit_pct !== '') { const m = Number(body.min_profit_pct); if (!(m >= 0 && m < 100)) throw new HttpError(400, 'Minimum profit must be 0 to 99 %'); out.sf_min_profit_pct = m; }
  setSettings(out); audit(user.name, 'settings', null, 'update', `Sales Finance rates: ${Object.keys(out).join(', ')}`);
  return rates();
}

// the numbers of a costing sheet and the four checks (also run by the costing hook on every save)
export function figures(cs) {
  const R = rates(), days = Number(cs.sf_days) || 0;
  const cityDay = cityRate(R.cities, cs.sf_city);
  const manDay = cs.sf_manpower_day !== '' && cs.sf_manpower_day != null ? Number(cs.sf_manpower_day) : R.manpower_day;
  const timeline = r2(days * (cityDay || 0)), manpower = r2(days * (manDay || 0));
  const logistics = cs.transport === '' || cs.transport == null ? null : Number(cs.transport);
  const selling = Number(cs.selling_total) || 0;
  const profit = r2(selling - (Number(cs.cost_total) || 0) - (logistics || 0) - timeline - manpower);
  const pct = selling > 0 ? r2(profit / selling * 100) : 0;
  let lines = cs.lines; if (typeof lines === 'string') { try { lines = JSON.parse(lines); } catch { lines = []; } }
  const un = (lines || []).filter(l => !(Number(l.cost) > 0)).length;
  const checks = [
    { key: 'material', title: 'Raw material cost and profit', ok: (lines || []).length > 0 && un === 0 && Number(cs.material_cost) > 0,
      text: `Material ₹${Number(cs.material_cost) || 0} · company margin ₹${Number(cs.margin_amount) || 0}`, why: !(lines || []).length ? 'No material lines on the sheet' : un ? `${un} material line(s) have no cost` : '' },
    { key: 'timeline', title: 'Timeline cost', ok: days > 0 && cityDay != null && (cs.sf_penalty === 'Yes' || cs.sf_penalty === 'No'),
      text: `${days} days × ₹${cityDay ?? '?'} (${cs.sf_city || 'no city'}) = ₹${timeline}${cs.sf_penalty === 'Yes' ? ` · penalty clause: ₹${Number(cs.sf_penalty_day) || 0} per day` : ''}`,
      why: !days ? 'Enter the project days' : cityDay == null ? `No cost per day for "${cs.sf_city || 'this city'}": ask the Finance Head to add it` : !(cs.sf_penalty === 'Yes' || cs.sf_penalty === 'No') ? 'Say whether the client has a delay penalty clause' : '' },
    { key: 'manpower', title: 'Manpower cost', ok: days > 0 && manDay > 0, text: `${days} days × ₹${manDay || 0} = ₹${manpower}`, why: !days ? 'Enter the project days' : !(manDay > 0) ? 'Manpower cost per day is not set' : '' },
    { key: 'logistics', title: 'Logistics', ok: logistics != null, text: logistics != null ? `₹${logistics} (transport to site)` : '', why: logistics == null ? 'Enter the transport cost from the transport quotation (0 if none)' : '' },
  ];
  return { checks, timeline, manpower, logistics, profit, pct, min: R.min_profit_pct, day_rate: cityDay, all_ok: checks.every(c => c.ok),
    penalty: cs.sf_penalty === 'Yes' ? { per_day: Number(cs.sf_penalty_day) || 0, days_at_risk: Math.min(days, 10), max_10_days: (Number(cs.sf_penalty_day) || 0) * Math.min(days, 10) } : null };
}

// costing hook: keep the computed fields on the sheet
export function prep(row, v) {
  if (v('kind') === 'Service') return;
  const f = figures({ ...Object.fromEntries(['sf_city', 'sf_days', 'sf_manpower_day', 'sf_penalty', 'sf_penalty_day', 'transport', 'lines'].map(k => [k, v(k)])), cost_total: row.cost_total, selling_total: row.selling_total, material_cost: row.material_cost, margin_amount: row.margin_amount });
  Object.assign(row, { sf_day_rate: f.day_rate ?? null, sf_timeline_cost: f.timeline, sf_manpower_cost: f.manpower, sf_profit: f.profit, sf_profit_pct: f.pct });
}

export function view(id, user) {
  if (!canView('costing_sheets', user.role)) throw new HttpError(403, 'No access');
  const cs = getRow('costing_sheets', id);
  return { sheet: cs.cs_no, status: cs.sf_status || 'Not checked', ...figures(cs), rates: rates(), can_check: hasFunction(user.role, 'sales_fin'), can_rates: hasFunction(user.role, 'sales_fin_rates') };
}

export function check(id, body, user) {
  if (!hasFunction(user.role, 'sales_fin')) throw new HttpError(403, 'Only Sales Finance can run this check');
  const cs = getRow('costing_sheets', id);
  if (cs.kind === 'Service') throw new HttpError(400, 'The Sales Finance check is for sales costing sheets');
  if (!cs.enquiry_id) throw new HttpError(400, 'Link the enquiry to this costing sheet first');
  const f = figures(cs);
  if (!f.all_ok) throw new HttpError(409, `Not all four checks are green:\n${f.checks.filter(c => !c.ok).map(c => `${c.title}: ${c.why}`).join('\n')}`);
  const note = `Profit ₹${f.profit} (${f.pct}% of ₹${cs.selling_total}); limit ${f.min}%. ${f.checks.map(c => c.text).join(' | ')}`.slice(0, 480);
  const low = f.pct < f.min;
  const jid = journeyFor(cs.enquiry_id);
  if (low) {
    if (!body?.request) throw new HttpError(409, `The profit is ${f.pct}%, below the ${f.min}% limit. Ask for approval from the seniors.`);
    const { submitStep } = journeyApi; submitStep(jid, 's6', { note: `${String(body.reason || '').trim() ? body.reason + ' · ' : ''}${note}` }, user);
    updateRow('costing_sheets', id, { sf_status: 'Approval requested', sf_by: user.name, sf_at: stamp(), sf_note: note }, user, { system: true });
    audit(user.name, 'costing_sheets', Number(id), 'sales finance', `approval requested, profit ${f.pct}%`);
    return { status: 'Approval requested', ...f };
  }
  journeyApi.clearStep(jid, 's6', `Cleared by ${user.name} (Sales Finance). ${note}`, user);
  updateRow('costing_sheets', id, { sf_status: 'Cleared', sf_by: user.name, sf_at: stamp(), sf_note: note }, user, { system: true });
  audit(user.name, 'costing_sheets', Number(id), 'sales finance', `cleared, profit ${f.pct}%`);
  return { status: 'Cleared', ...f };
}
import * as journeyApi from './journey.js';

// a senior decided the approval of step s6: the sheet follows
export function decided(enquiryId, decision) {
  db.prepare("UPDATE costing_sheets SET sf_status = ? WHERE enquiry_id = ? AND sf_status = 'Approval requested'").run(decision === 'Rejected' ? 'Rejected' : 'Approved by seniors', enquiryId);
}
