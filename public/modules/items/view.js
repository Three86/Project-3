// Needed items: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { emptyState, icon, popover, select, toggleSwitch } from '../../ui/basecoat/components.js';
import { itemTag, sourceLine } from '../../ui/basecoat/objectives.js';
import { neededItems } from './logic.js';

function renderItems() {
  const f = S.ui.items;
  const rows = neededItems();
  const toolbar = `<div class="toolbar">
    ${select('items.fir', f.fir, [['all', 'FIR + not FIR'], ['fir', 'Found in raid only'], ['nofir', 'Not FIR only']], 'Type')}
    ${select('items.source', f.source, [['all', 'Quests + hideout + prestige'], ['quest', 'Quests'], ['hideout', 'Hideout'], ['prestige', 'Prestige']], 'Source')}
    ${select('items.sortBy', f.sortBy, [['remaining', 'Most needed'], ['fir', 'Most FIR needed'], ['name', 'Name']], 'Sort')}
    ${toggleSwitch('Include locked (future) quests', 'data-ui="items.includeLocked"', f.includeLocked)}
    <input type="search" class="input tb-search" data-ui="items.text" value="${esc(f.text)}" placeholder="Filter items…" aria-label="Filter items">
    <span class="count">${rows.length} items</span>
  </div>`;
  if (!rows.length) return toolbar + emptyState('Nothing needed', 'Either you are done, or your filters are lying to you.', '', 'list');
  return toolbar + `<div class="card table-card"><div class="table-container"><table class="table items"><thead><tr><th>Item</th><th class="num">FIR</th><th class="num">Not FIR</th><th class="num">Collected</th><th>Needed for</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${itemTag(a.item)}<div class="auto">${esc(a.item.name)}</div></td><td class="num">${a.fir || ''}</td><td class="num">${a.nofir || ''}</td><td class="num">${a.have}/${a.fir + a.nofir}</td>
      <td class="sources">${popover(`${a.sources.length} source${a.sources.length > 1 ? 's' : ''} ${icon('chevron')}`, `<div class="sources pop-sources">${a.sources.map(sourceLine).join('')}</div>`, { variant: 'outline', size: 'xs', align: 'end' })}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

export default { render: renderItems };
