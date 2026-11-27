// Search: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { badge, btn, emptyState, toggleSwitch } from '../../ui/basecoat/components.js';
import { itemTag, sourceLine, objectiveActions, objectiveChanges } from '../../ui/basecoat/objectives.js';
import { taskCard, questCardActions, questCardToggle } from '../../ui/basecoat/quest-card.js';
import { searchResults, setQuery } from './logic.js';

function renderSearch() {
  const head = `<div class="toolbar"><input type="search" class="input tb-search wide" data-ui="search" value="${esc(S.ui.search)}" placeholder="Quest or item name…" id="searchBox" aria-label="Search">
    ${toggleSwitch('Include completed', 'data-ui="searchCompleted"', S.ui.searchCompleted)}
    <span class="auto">Tip: <kbd class="kbd">Ctrl</kbd> <kbd class="kbd">K</kbd> opens the command palette from anywhere.</span></div>`;
  const res = searchResults();
  if (!res) return head + emptyState('Search everything', 'Type at least two characters. Searches quest names, objectives, and every item any quest, hideout level or prestige needs.', '', 'search');
  const { quests, skills: skillHits, items } = res;
  // Only sections with hits; one message when nothing matched at all.
  if (!quests.length && !skillHits.length && !items.length) {
    return head + emptyState('Nothing matches', `No quest or skill by that name, and no current or future quest, hideout level or prestige needs an item matching it. If it's an item: sell it.${S.ui.searchCompleted ? '' : ' Completed quests are left out; switch on "Include completed" to search them too.'}`, '', 'search');
  }
  return head + `${quests.length ? `<h3 class="section-title">Quests ${badge(quests.length, 'secondary')}</h3>
    <div class="grid">${quests.slice(0, 60).map(taskCard).join('')}</div>` : ''}
    ${skillHits.length ? `<h3 class="section-title">Skills ${badge(skillHits.length, 'secondary')}</h3><div class="chips">${skillHits.map((sk) => btn(`${esc(sk.name)} ${badge(`lvl ${Number(S.progress.skills[sk.id] || 0)}`, 'secondary')}`, `data-act="goto-skill" data-module="skills" data-id="${esc(sk.name)}"`, { variant: 'outline', size: 'sm' })).join('')}</div>` : ''}
    ${items.length ? `<h3 class="section-title">Items ${badge(items.length, 'secondary')}</h3>
    <div class="card table-card"><div class="table-container"><table class="table items"><thead><tr><th>Item</th><th>Needed for (current &amp; future)</th></tr></thead><tbody>${items.map((a) => `<tr><td>${itemTag(a.item)}<div class="auto">${esc(a.item.name)}</div></td><td class="sources">${a.sources.map(sourceLine).join('')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}

export default {
  render: renderSearch,
  // Quest cards in the results work like on the Quests tab.
  actions: { ...objectiveActions, ...questCardActions },
  changes: { ...objectiveChanges },
  toggle: (el) => questCardToggle(el),
  // { q }: search for this text (top-bar search box, command palette).
  goto({ q, keepFocus }) {
    setQuery(q ?? '');
    if (keepFocus) return null;
    return () => { const g = document.getElementById('globalSearch'); if (g) g.value = q ?? ''; };
  },
};
