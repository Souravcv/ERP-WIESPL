// When the price of an item changes (a new price on the item, or an inward at a new price), the material lines of Draft costing sheets
// that still use the old price move to the new one, and the sheet works out the selling prices again (cost 100 + 40% = 140; cost 120 = 168).
// A line whose cost was typed by hand (not the item's price) stays as it is.
import { db } from './db.js';
import { updateRow } from './crud.js';

export const rateWas = new Map(); // item id → price before the change, until repriced

export function repriceDraftSheets(map, user) {
  const changes = new Map(map); map.clear();
  const sys = { name: user?.name || 'system', role: 'admin' };
  let sheets = 0;
  for (const s of db.prepare("SELECT id, lines FROM costing_sheets WHERE status = 'Draft' AND lines LIKE '%item_id%'").all()) {
    let lines; try { lines = JSON.parse(s.lines || '[]'); } catch { continue; }
    let changed = false;
    for (const l of lines) {
      const old = changes.get(Number(l.item_id));
      if (old === undefined) continue;
      if (l.cost === '' || l.cost == null || Number(l.cost) === Number(old)) {
        const now = db.prepare('SELECT rate FROM items WHERE id = ?').get(Number(l.item_id))?.rate;
        if (now != null && Number(now) !== Number(l.cost)) { l.cost = now; changed = true; }
      }
    }
    if (changed) { updateRow('costing_sheets', s.id, { lines }, sys, { system: true }); sheets++; }
  }
  return sheets;
}
