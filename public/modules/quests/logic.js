// Quests: filtering, sorting and grouping of the quest list, and the list-level actions.
// Quest status and objective changes are in core/progress.js (shared with other sections).
import { S, saveUi, setProgress } from '../../core/store.js';
import { norm, uniq, byName } from '../../core/util.js';
import { idx, NEEDS, STATUS_LABEL, objItems, objNeeds, taskMaps, taskProgress, taskStatus, traderList, traderStanding, traderUnlock, loyaltyLevel, restockIn } from '../../core/game.js';

export { setTaskStatus, startWithPrereqs, stepRequirement, setRequirement } from '../../core/progress.js';

// UI state this section keeps (merged into the GUI's saved UI state).
export const uiDefaults = {
  q: { statuses: ['active'], trader: '', map: '', need: '', groupBy: 'trader', sortBy: 'level', text: '', kappa: false, lightkeeper: false },
  open: {}, // quest id -> card open
  groups: {}, // group key -> open (false = collapsed)
};

// Status filters offered in quest lists. Available (startable, not started) quests are not listed:
// starts come from the game logs. An empty filter (a link to one quest) still shows every status.
export const STATUS_FILTERS = ['active', 'locked', 'completed', 'failed', 'unavailable'];

export const traders = () => idx.traders;
export const maps = () => idx.maps;

export function filteredTasks() {
  const f = S.ui.q;
  const text = norm(f.text);
  return S.data.tasks.filter((t) => {
    const st = taskStatus(t.id);
    if (f.statuses.length && (st === 'available' || !f.statuses.includes(st))) return false;
    if (f.trader && t.trader?.name !== f.trader) return false;
    if (f.map && !taskMaps(t).includes(f.map) && !taskMaps(t).includes('Any')) return false;
    if (f.kappa && !t.kappaRequired) return false;
    if (f.lightkeeper && !t.lightkeeperRequired) return false;
    if (f.need && !t.objectives.some((o) => objNeeds(o).has(f.need))) return false;
    if (text && !norm(t.name).includes(text) && !t.objectives.some((o) => norm(o.description).includes(text) || objItems(o).some((i) => norm(i.name).includes(text)))) return false;
    return true;
  });
}

export function sortTasks(list) {
  const by = S.ui.q.sortBy;
  const key = {
    level: (t) => [t.minPlayerLevel || 0, t.trader?.name || '', t.name],
    trader: (t) => [t.trader?.name || '', t.minPlayerLevel || 0, t.name],
    map: (t) => [taskMaps(t)[0], t.minPlayerLevel || 0, t.name],
    name: (t) => [t.name],
    progress: (t) => [-taskProgress(t), t.name],
  }[by] || ((t) => [t.name]);
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

export const groupKey = (name) => `${S.ui.q.groupBy}:${name}`;

export function groupTasks(list) {
  const g = S.ui.q.groupBy;
  if (g === 'none') return [['', list]];
  const groups = new Map();
  for (const t of list) {
    let keys;
    if (g === 'trader') keys = [t.trader?.name || 'Unknown'];
    else if (g === 'map') keys = taskMaps(t);
    else if (g === 'need') keys = uniq(t.objectives.flatMap((o) => [...objNeeds(o)])).map((n) => NEEDS[n]);
    else if (g === 'status') keys = [STATUS_LABEL[taskStatus(t.id)]];
    for (const k of keys.length ? keys : ['Other']) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
  }
  return [...groups.entries()].sort((a, b) => byName(a[0], b[0]));
}

// Number of quests per status (for the status filter chips).
export function statusCounts() {
  const counts = {};
  for (const t of S.data.tasks) { const s = taskStatus(t.id); counts[s] = (counts[s] || 0) + 1; }
  return counts;
}

export function toggleStatusFilter(s) {
  const set = new Set(S.ui.q.statuses);
  set.has(s) ? set.delete(s) : set.add(s);
  S.ui.q.statuses = [...set];
  saveUi();
}

// Open or close every quest card currently listed / every group.
export function setAllOpen(open) {
  for (const t of filteredTasks()) S.ui.open[t.id] = open;
  saveUi();
}
export function setAllGroupsOpen(open) {
  for (const [name] of groupTasks(filteredTasks())) S.ui.groups[groupKey(name)] = open;
  saveUi();
}

// Show one quest: clear the filters down to its name and open its card.
export function focusTask(id) {
  const t = idx.tasks.get(id);
  if (!t) return null;
  S.ui.q = { ...S.ui.q, statuses: [], trader: '', map: '', need: '', kappa: false, lightkeeper: false, text: t.name };
  S.ui.open[id] = true;
  saveUi();
  return t;
}


// ---------------------------------------------------------------- traders
export { traderList, traderStanding, traderUnlock, loyaltyLevel, restockIn, hasStandingData } from '../../core/game.js';

// Portrait served by the tracker (downloaded once from tarkov.dev); 404 until it has been fetched.
export const traderImage = (id) => `/api/images/traders/${encodeURIComponent(id)}`;

// One entry per trader for trader cards: { trader, image, rep, loyalty, unlock, restock, counts }.
// counts: quests per status for that trader.
export function traderCards() {
  const counts = new Map();
  for (const t of S.data?.tasks || []) {
    const id = t.trader?.id;
    if (!id) continue;
    const c = counts.get(id) || { total: 0 };
    const st = taskStatus(t.id);
    c[st] = (c[st] || 0) + 1;
    c.total++;
    counts.set(id, c);
  }
  return traderList().map((trader) => ({
    trader,
    image: traderImage(trader.id),
    rep: traderStanding(trader.id),
    loyalty: loyaltyLevel(trader),
    unlock: traderUnlock(trader.id),
    restock: restockIn(trader.id),
    counts: counts.get(trader.id) || { total: 0 },
  }));
}

// Show one trader's quests (the trader filter of the quest list).
export function selectTrader(name) { S.ui.q.trader = name || ''; saveUi(); }

// Set a trader's loyalty level by hand (null = back to the calculated one). Only used while
// "Manual loyalty levels" is on in Settings.
export function setLoyaltyOverride(traderId, level) {
  const overrides = { ...(S.progress.settings.loyaltyOverrides || {}) };
  if (level == null || level === '' || level === 'auto') delete overrides[traderId];
  else overrides[traderId] = Number(level);
  return setProgress({ section: 'settings', id: 'loyaltyOverrides', value: overrides });
}
