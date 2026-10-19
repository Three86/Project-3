// Search: quests, skills and needed items matching a text.
import { S, saveUi } from '../../core/store.js';
import { norm, byName } from '../../core/util.js';
import { activeSkillConfig, itemRequirements, taskStatus } from '../../core/game.js';

export const uiDefaults = { search: '', searchCompleted: false };

export function setQuery(q) { S.ui.search = q; saveUi(); }

// Results for the current search text (null when it is shorter than 2 characters):
// { quests, skills, items: [{ item, sources }] }. Completed things only with "Include completed".
export function searchResults() {
  const q = norm(S.ui.search).trim();
  if (q.length < 2) return null;
  const quests = S.data.tasks.filter((t) => norm(t.name).includes(q) && (S.ui.searchCompleted || taskStatus(t.id) !== 'completed'))
    .sort((a, b) => (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0) || byName(a.name, b.name));
  const reqs = itemRequirements({ includeEquipment: true }).filter((r) => (norm(r.item.name).includes(q) || norm(r.item.shortName).includes(q)) && (S.ui.searchCompleted || !r.done) && r.status !== 'unavailable');
  const byItem = new Map();
  for (const r of reqs) {
    if (!byItem.has(r.item.id)) byItem.set(r.item.id, { item: r.item, sources: [] });
    byItem.get(r.item.id).sources.push(r);
  }
  const items = [...byItem.values()].sort((a, b) => byName(a.item.name, b.item.name));
  const skills = activeSkillConfig().skills.filter((sk) => norm(sk.name).includes(q) || norm(sk.description).includes(q));
  return { quests, skills, items };
}
