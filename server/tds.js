// Technical Data Sheets (Order-to-Execution guide, stage 5): every product has a TDS, approved Design Head → GM → MD,
// and "no vendor PO without an approved TDS". For now the PO check is a setting (Settings → Numbering & approvals):
// Off, Warn (default: the PO goes on, the missing TDS is shown and written on its approval) or Block.
// It applies to PO lines whose item is marked "Needs a TDS" in the item master.
import { db, getSettings } from './db.js';
import { HttpError } from './crud.js';

export const tdsMode = () => (['Off', 'Warn', 'Block'].includes(getSettings().tds_po_check) ? getSettings().tds_po_check : 'Warn');
const parse = s => (Array.isArray(s) ? s : (() => { try { return JSON.parse(s || '[]') || []; } catch { return []; } })());

// the items on these PO lines that need a TDS and have none approved
export function missingTds(lines) {
  const ids = [...new Set(parse(lines).filter(l => l.item_id && Number(l.qty) > 0).map(l => Number(l.item_id)))];
  if (!ids.length) return [];
  return db.prepare(`SELECT i.id, i.code, i.name, (SELECT status FROM tds_sheets t WHERE t.item_id = i.id ORDER BY t.id DESC LIMIT 1) tds
    FROM items i WHERE i.id IN (${ids.map(() => '?').join(',')}) AND i.needs_tds = 'Yes'
    AND NOT EXISTS (SELECT 1 FROM tds_sheets t WHERE t.item_id = i.id AND t.status = 'Approved')`).all(...ids)
    .map(r => ({ id: r.id, name: [r.code, r.name].filter(Boolean).join(' · '), tds: r.tds || 'none' }));
}

// what the PO page shows, and the check when a PO is sent for approval
export function poTds(po) {
  const mode = tdsMode();
  return { mode, missing: mode === 'Off' ? [] : missingTds(po.lines) };
}
export function checkPoTds(po) {
  const { mode, missing } = poTds(po);
  if (mode === 'Block' && missing.length) {
    throw new HttpError(409, `No vendor PO without an approved TDS. Missing for:\n${missing.map(m => `${m.name} (TDS: ${m.tds})`).join('\n')}\n\nMake the TDS on the item and get it approved (Design Head → GM → MD), or ask the admin to change the TDS check in Settings.`);
  }
  return missing;
}
export const tdsNote = po => { try { const m = poTds(po).missing; return m.length ? ` · ⚠ no approved TDS: ${m.map(x => x.name).slice(0, 3).join(', ')}${m.length > 3 ? ` +${m.length - 3}` : ''}` : ''; } catch { return ''; } };

// an item gets a TDS: it is now an item that needs one
export function markNeedsTds(itemId) {
  if (itemId) db.prepare("UPDATE items SET needs_tds = 'Yes' WHERE id = ? AND COALESCE(needs_tds, '') <> 'Yes'").run(Number(itemId));
}
