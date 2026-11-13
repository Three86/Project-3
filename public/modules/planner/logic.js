// Raid planner: quests filtered by map across every trader, pinned quests, and what the pinned
// quests still need in total (items, keys, gear). Pins live in progress.questPins (taskId -> time
// pinned, or -1: unpinned by hand although auto-pin would add it); the server drops a pin when the
// quest is saved as completed, and completed quests (also those implied by later quests) are left out
// here. With settings.autoPinGoals on, every unlocked (active or available) Kappa / Lightkeeper quest
// counts as pinned too, so locked ones join as soon as they unlock.
import { S, setProgress, saveUi } from '../../core/store.js';
import { norm, byName } from '../../core/util.js';
import { buildSpec, idx, objItems, objKeys, objValue, taskMaps, taskStatus, traderList } from '../../core/game.js';

export const uiDefaults = {
  rp: { map: '', locked: false, text: '' },
};

export const ANY_MAP = 'Any';
const listed = (st) => st === 'active' || (S.ui.rp.locked && st === 'locked');
const UNLOCKED = new Set(['active', 'available']);
export const isGoalQuest = (t) => !!(t.kappaRequired || t.lightkeeperRequired);
// In the list: listed statuses, plus pinned quests you could start (auto-pin adds those).
const inList = (t, st, pins) => listed(st) || (st === 'available' && pins.has(t.id));

// Maps with no base map to share a chip with: shown only while you have an active quest there.
export const ACTIVE_ONLY_MAPS = new Set(['The Labyrinth', 'Icebreaker']);

// Map chips: [{ map, count }] for the listed quests (a quest on several maps counts on each).
// 'Any' (quests not tied to a map) last.
export function mapCounts() {
  const counts = new Map(), active = new Set();
  let all = 0;
  const pins = pinState();
  for (const t of S.data.tasks) {
    const st = taskStatus(t.id);
    if (!inList(t, st, pins)) continue;
    all++;
    for (const m of taskMaps(t)) {
      counts.set(m, (counts.get(m) || 0) + 1);
      if (st === 'active') active.add(m);
    }
  }
  const maps = [...counts].filter(([map]) => !ACTIVE_ONLY_MAPS.has(map) || active.has(map)).map(([map, count]) => ({ map, count }))
    .sort((a, b) => (a.map === ANY_MAP) - (b.map === ANY_MAP) || byName(a.map, b.map));
  return { all, maps };
}

const byTraderLevel = (rank) => (a, b) => (rank.get(a.trader?.id) ?? 99) - (rank.get(b.trader?.id) ?? 99) || (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0) || byName(a.name, b.name);

// Pinned quests: Map taskId -> 'manual' | 'auto', in pin order (by hand in the order pinned, then the
// auto-pinned ones by trader and level). Completed quests are left out.
export function pinState() {
  const pins = S.progress.questPins || {};
  const out = new Map();
  for (const [id] of Object.entries(pins).filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1])) {
    if (idx.tasks.has(id) && taskStatus(id) !== 'completed') out.set(id, 'manual');
  }
  if (S.progress.settings?.autoPinGoals) {
    const rank = new Map(traderList().map((t, i) => [t.id, i]));
    S.data.tasks.filter((t) => isGoalQuest(t) && !out.has(t.id) && !(pins[t.id] < 0) && UNLOCKED.has(taskStatus(t.id)))
      .sort(byTraderLevel(rank)).forEach((t) => out.set(t.id, 'auto'));
  }
  return out;
}

export const pinnedTasks = () => [...pinState().keys()].map((id) => idx.tasks.get(id));

// Quests for the chosen map and filters, every trader: pinned first (in pin order), then by trader and level.
export function plannerTasks() {
  const f = S.ui.rp;
  const text = norm(f.text);
  const pins = pinState();
  const order = new Map([...pins.keys()].map((id, i) => [id, i]));
  const rank = new Map(traderList().map((t, i) => [t.id, i]));
  return S.data.tasks.filter((t) => inList(t, taskStatus(t.id), pins) && (!f.map || taskMaps(t).includes(f.map)) && (!text || norm(t.name).includes(text)))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || byTraderLevel(rank)(a, b));
}

// Pin a quest (stamped later than every other pin, so the order holds) or unpin it. Unpinning an
// auto-pinned quest stores -1 so auto-pin leaves it out; pinning it again by hand clears that.
export function togglePin(id) {
  const pins = S.progress.questPins || {};
  const kind = pinState().get(id);
  const value = kind === 'manual' ? null : kind === 'auto' ? -1 : Math.max(Date.now(), ...Object.values(pins).map((v) => v + 1));
  return setProgress({ section: 'questPins', id, value });
}

export function setMap(map) { S.ui.rp.map = map; saveUi(); }

const ITEM_TYPES = new Set(['giveItem', 'findItem', 'plantItem', 'mark', 'useItem']);
const setKey = (items) => items.map((i) => i.id).sort().join('+');
const add = (map, key, make, fn) => { const e = map.get(key) || make(); fn(e); map.set(key, e); return e; };

// What the pinned quests still need, objectives already done left out:
// { tasks, maps: [{ map, count }], items: [{ items (one of), count, have, fir, from }],
//   questItems: [{ item, from }], keys: [{ keys (any one of), maps, from }], gear: [{ items (one of), how, spec?, from }] }
export function pinnedTotals() {
  const tasks = pinnedTasks();
  const items = new Map(), questItems = new Map(), keys = new Map(), gear = new Map(), maps = new Map();
  for (const t of tasks) {
    for (const m of taskMaps(t)) maps.set(m, (maps.get(m) || 0) + 1);
    // "Find" + "hand over" pairs name the same items; count them once (as the hand-over).
    const handedIn = new Set(t.objectives.filter((o) => o.type === 'giveItem').flatMap((o) => objItems(o).map((i) => i.id)));
    for (const o of t.objectives) {
      const v = objValue('objectives', o.id, o);
      if (v.done) continue;
      const from = (e) => { if (!e.from.includes(t.name)) e.from.push(t.name); };
      const its = objItems(o);
      if (ITEM_TYPES.has(o.type) && its.length && !(o.type === 'findItem' && its.every((i) => handedIn.has(i.id)))) {
        const count = o.type === 'mark' ? 1 : Number(o.count || 1);
        const have = Math.round((v.cur / v.target) * count);
        add(items, `${setKey(its)}|${o.foundInRaid ? 'fir' : ''}`, () => ({ items: its, count: 0, have: 0, fir: !!o.foundInRaid, from: [] }), (e) => { e.count += count; e.have += have; from(e); });
      }
      if (o.questItem && (o.type === 'findQuestItem' || o.type === 'giveQuestItem')) add(questItems, o.questItem.id || o.questItem.name, () => ({ item: o.questItem, from: [] }), from);
      for (const set of objKeys(o)) {
        const where = (o.maps || []).map((m) => m.name).filter(Boolean);
        add(keys, setKey(set), () => ({ keys: set, maps: [], from: [] }), (e) => { from(e); for (const m of where.length ? where : taskMaps(t)) if (!e.maps.includes(m)) e.maps.push(m); });
      }
      if (o.usingWeapon?.length) add(gear, `use|${setKey(o.usingWeapon)}`, () => ({ items: o.usingWeapon, how: 'use', from: [] }), from);
      for (const set of o.wearing || []) if (set?.length) add(gear, `wear|${setKey(set)}`, () => ({ items: set, how: 'wear', from: [] }), from);
      if (o.type === 'buildWeapon' && o.item) add(gear, `build|${o.id}`, () => ({ items: [o.item], how: 'build', spec: buildSpec(o), from: [] }), from);
    }
  }
  const byFirstName = (a, b) => byName((a.items || a.keys || [a.item])[0]?.name, (b.items || b.keys || [b.item])[0]?.name);
  return {
    tasks,
    maps: [...maps].map(([map, count]) => ({ map, count })),
    items: [...items.values()].filter((e) => e.count > e.have).sort(byFirstName),
    questItems: [...questItems.values()].sort(byFirstName),
    keys: [...keys.values()].sort(byFirstName),
    gear: [...gear.values()].sort(byFirstName),
  };
}
