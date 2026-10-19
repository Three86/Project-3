// Needed items: every item requirement still open, totalled per item.
import { S } from '../../core/store.js';
import { norm, byName } from '../../core/util.js';
import { itemRequirements } from '../../core/game.js';

export const uiDefaults = {
  items: { fir: 'all', source: 'all', includeLocked: true, text: '', sortBy: 'remaining' },
};

// Rows with the current filters: [{ item, fir, nofir, have, sources }] (sources: itemRequirements() entries).
export function neededItems() {
  const f = S.ui.items;
  const text = norm(f.text);
  const reqs = itemRequirements().filter((r) => {
    if (r.done) return false;
    if (!f.includeLocked && r.kind === 'quest' && r.status === 'locked') return false;
    if (r.kind === 'quest' && (r.status === 'unavailable' || r.status === 'failed')) return false;
    if (f.fir === 'fir' && !r.fir) return false;
    if (f.fir === 'nofir' && r.fir) return false;
    if (f.source !== 'all' && r.kind !== f.source) return false;
    return !text || norm(r.item.name).includes(text) || norm(r.item.shortName).includes(text);
  });
  const agg = new Map();
  for (const r of reqs) {
    const a = agg.get(r.item.id) || { item: r.item, fir: 0, nofir: 0, have: 0, sources: [] };
    a[r.fir ? 'fir' : 'nofir'] += r.count;
    a.have += r.have;
    a.sources.push(r);
    agg.set(r.item.id, a);
  }
  const rows = [...agg.values()];
  const sorters = { remaining: (a, b) => (b.fir + b.nofir - b.have) - (a.fir + a.nofir - a.have), name: (a, b) => byName(a.item.name, b.item.name), fir: (a, b) => b.fir - a.fir };
  rows.sort(sorters[f.sortBy] || sorters.remaining);
  return rows;
}
