// Game rules shared by several sections: indexes, objectives, quest and hideout status, skills,
// hideout bonuses, crafting and the needed-items list. Headless (no DOM); reads the shared store.
import { S } from './store.js';
import { norm, uniq, byName } from './util.js';

export const idx = { tasks: new Map(), dependents: new Map(), stations: new Map(), levels: new Map(), traders: [], maps: [] };
let memo = {};
// Cached quest statuses depend on progress; call after any progress change.
export function resetMemo() { memo = {}; }

// ---------------------------------------------------------------- indexing
export function buildIndex() {
  idx.tasks.clear(); idx.dependents.clear(); idx.stations.clear(); idx.levels.clear();
  for (const t of S.data.tasks) {
    t.objectives ||= [];
    t.taskRequirements ||= [];
    idx.tasks.set(t.id, t);
  }
  for (const t of S.data.tasks) {
    for (const r of t.taskRequirements) {
      if (!r.task) continue;
      if (!idx.dependents.has(r.task.id)) idx.dependents.set(r.task.id, []);
      idx.dependents.get(r.task.id).push({ task: t, status: reqStatuses(r) });
    }
  }
  for (const st of S.data.hideout || []) {
    idx.stations.set(st.id, st);
    st.levels = (st.levels || []).slice().sort((a, b) => a.level - b.level);
    for (const l of st.levels) idx.levels.set(l.id, { station: st, level: l });
  }
  idx.traders = uniq(S.data.tasks.map((t) => t.trader?.name).filter(Boolean)).sort(byName);
  idx.maps = uniq(S.data.tasks.flatMap(taskMaps)).filter((m) => m !== 'Any').sort(byName);
  memo = {};
}

export const reqStatuses = (r) => (Array.isArray(r.status) ? r.status : [r.status || 'complete']).map(norm);

export function taskMaps(t) {
  if (t.map?.name) return [t.map.name];
  const m = uniq(t.objectives.flatMap((o) => (o.maps || []).map((x) => x.name)));
  return m.length ? m : ['Any'];
}

// ---------------------------------------------------------------- objectives
export const NEEDS = {
  kill: 'Kills',
  fir: 'Items (found in raid)',
  item: 'Items (not FIR)',
  equipment: 'Equipment / gear',
  questitem: 'Quest items',
  place: 'Place / mark',
  visit: 'Visit / locate',
  extract: 'Extract',
  progression: 'Skill / level / trader',
};

export function objItems(o) {
  if (Array.isArray(o.items) && o.items.length) return o.items;
  if (o.item) return [o.item];
  if (o.markerItem) return [o.markerItem];
  if (o.useAny?.length) return o.useAny;
  return [];
}
export function objEquipment(o) {
  return [...(o.usingWeapon || []), ...(o.wearing || []).flat()].filter(Boolean);
}

export function objNeeds(o) {
  const n = new Set();
  switch (o.type) {
    case 'shoot': n.add('kill'); if (objEquipment(o).length) n.add('equipment'); break;
    case 'giveItem': case 'findItem': case 'sellItem': case 'useItem': n.add(o.foundInRaid ? 'fir' : 'item'); break;
    case 'plantItem': case 'mark': n.add('place'); n.add(o.foundInRaid ? 'fir' : 'item'); break;
    case 'plantQuestItem': n.add('place'); break;
    case 'buildWeapon': n.add('equipment'); break;
    case 'giveQuestItem': case 'findQuestItem': n.add('questitem'); break;
    case 'visit': n.add('visit'); break;
    case 'extract': n.add('extract'); break;
    default: n.add('progression');
  }
  if (o.type !== 'shoot' && objEquipment(o).length) n.add('equipment');
  return n;
}

// How many "units" an objective needs (for steppers). 1 => simple checkbox.
export function objTarget(o) {
  const c = Number(o.count || 0);
  return ['giveItem', 'findItem', 'shoot', 'extract', 'useItem', 'plantItem', 'giveQuestItem', 'findQuestItem', 'sellItem'].includes(o.type) && c > 1 ? c : 1;
}

// Some objectives can be evaluated from other progress (player level, other quests, hideout).
// Hideout station a requirement refers to (normalised data has hideoutStation; older caches the raw id).
export function stationOf(o) {
  const id = o.hideoutStation?.id || o.station;
  if (!id) return null;
  return idx.stations.get(id) || { id, name: o.hideoutStation?.name || 'Hideout station', levels: [] };
}

// Title for requirements the game ships without description text (mostly prestige conditions):
// "Level: 25", "Strength level 10", "Medstation level 3", "Have 1,000,000 Roubles".
export function objTitle(o) {
  switch (o.type) {
    case 'playerLevel': return o.playerLevel ? `Level: ${o.playerLevel}` : null;
    case 'skill': return o.skillLevel ? `${o.skillLevel.name} level ${o.skillLevel.level}` : null;
    case 'hideoutStation': return `${stationOf(o)?.name || 'Hideout station'} level ${o.stationLevel ?? '?'}`;
    case 'haveItem': {
      const it = objItems(o)[0];
      return `Have ${Number(o.count || 1).toLocaleString('en-US')} ${it?.name || 'items'}`;
    }
    case 'taskStatus': return o.task ? `Complete ${o.task.name}` : null;
    default: return null;
  }
}

export function autoValue(o) {
  if (o.type === 'hideoutStation' && o.stationLevel) {
    const st = stationOf(o);
    if (st?.levels?.length) {
      const built = builtLevel(st);
      return { done: built >= o.stationLevel, why: `your ${st.name}: level ${built}` };
    }
  }
  if (o.type === 'skill' && o.skillLevel?.level && findSkill(o.skillLevel.name)) {
    const lvl = skillLevel(o.skillLevel.name);
    if (lvl >= o.skillLevel.level) return { done: true, why: `your ${o.skillLevel.name}: ${lvl}` };
    if (lvl > 0) return { done: false, why: `your ${o.skillLevel.name}: ${lvl}` };
  }
  if (o.type === 'playerLevel' && o.playerLevel) return { done: S.progress.settings.playerLevel >= o.playerLevel, why: `your level: ${S.progress.settings.playerLevel}` };
  if (o.type === 'taskStatus' && o.task) {
    const st = taskStatus(o.task.id);
    const want = (Array.isArray(o.status) ? o.status : [o.status || 'complete']).map(norm);
    const ok = want.some((w) => (w === 'complete' ? st === 'completed' : w === 'active' ? ['active', 'completed'].includes(st) : st === w));
    return { done: ok, why: `quest is ${st}` };
  }
  return null;
}

export function objValue(section, key, o) {
  const auto = autoValue(o);
  if (auto) return { auto, cur: auto.done ? 1 : 0, target: 1, done: auto.done };
  const v = S.progress[section][key];
  const target = objTarget(o);
  const cur = v === true ? target : Number(v || 0);
  return { cur: Math.min(cur, target), target, done: cur >= target };
}

// ---------------------------------------------------------------- quest status
export const STATUS_LABEL = { active: 'Active', available: 'Available', locked: 'Locked', completed: 'Completed', failed: 'Failed', unavailable: 'Other faction' };

export function explicitStatus(id) {
  return S.progress.tasks[id]?.status || null;
}

// A quest is implicitly completed if a quest that requires its completion is active/completed.
export function impliedComplete(id, seen = new Set()) {
  const key = `imp:${id}`;
  if (key in memo) return memo[key];
  if (seen.has(id)) return false;
  seen.add(id);
  const res = (idx.dependents.get(id) || []).some(({ task, status }) =>
    status.length === 1 && status[0] === 'complete' &&
    (['active', 'completed'].includes(explicitStatus(task.id)) || impliedComplete(task.id, seen)));
  return (memo[key] = res);
}

export function taskStatus(id, seen = new Set()) {
  const key = `st:${id}`;
  if (key in memo) return memo[key];
  const t = idx.tasks.get(id);
  const ex = explicitStatus(id);
  let st;
  if (ex === 'completed' || ex === 'failed') st = ex;
  else if (impliedComplete(id)) st = 'completed';
  else if (ex === 'active') st = 'active';
  else if (!t) st = 'locked';
  else if (t.factionName && t.factionName !== 'Any' && t.factionName !== S.progress.settings.faction) st = 'unavailable';
  else if (seen.has(id)) st = 'locked';
  else {
    seen.add(id);
    const prereqs = t.taskRequirements.every((r) => {
      if (!r.task) return true;
      const ps = taskStatus(r.task.id, seen);
      return reqStatuses(r).some((w) => (w === 'complete' ? ps === 'completed' : w === 'active' ? ['active', 'completed'].includes(ps) : w === 'failed' ? ps === 'failed' : false));
    });
    st = prereqs && S.progress.settings.playerLevel >= (t.minPlayerLevel || 0) ? 'available' : 'locked';
  }
  return (memo[key] = st);
}

export function taskProgress(t) {
  const req = t.objectives.filter((o) => !o.optional);
  if (!req.length) return 0;
  return req.filter((o) => objValue('objectives', o.id, o).done).length / req.length;
}

// All (transitive) prerequisite quest ids.
export function allPrereqs(id, out = new Set()) {
  for (const r of idx.tasks.get(id)?.taskRequirements || []) {
    if (r.task && !out.has(r.task.id) && reqStatuses(r).includes('complete')) {
      out.add(r.task.id);
      allPrereqs(r.task.id, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------- hideout status
export function builtLevel(station) {
  let lvl = 0;
  for (const l of station.levels) if (S.progress.hideout[l.id]) lvl = Math.max(lvl, l.level);
  return lvl;
}
export const levelBuilt = (station, level) => builtLevel(station) >= level.level;
// A level is locked until every other station it requires has been built to the required level.
export function levelUnlocked(level) {
  return (level.stationLevelRequirements || []).every((r) => {
    const st = r.station && idx.stations.get(r.station.id);
    return !st || builtLevel(st) >= r.level;
  });
}

export const REQ_NEEDS = { item: 'Items', fir: 'FIR items', trader: 'Trader loyalty', skill: 'Skills', station: 'Other stations' };

export function hideoutReqs(level) {
  const reqs = [];
  (level.itemRequirements || []).forEach((r, i) => {
    if (!r.item) return;
    const fir = (r.attributes || []).some((a) => /found.?in.?raid/i.test(`${a.type} ${a.name}`) && String(a.value) !== 'false');
    reqs.push({ kind: 'item', key: `${level.id}|item|${i}`, item: r.item, count: Number(r.count || r.quantity || 1), fir });
  });
  (level.stationLevelRequirements || []).forEach((r) => {
    const st = r.station && idx.stations.get(r.station.id);
    reqs.push({ kind: 'station', key: `${level.id}|station|${r.station?.id}`, station: r.station, need: r.level, have: st ? builtLevel(st) : 0, label: `${r.station?.name} level ${r.level}`, auto: true, done: st ? builtLevel(st) >= r.level : false });
  });
  (level.traderRequirements || []).forEach((r, i) => {
    const key = `${level.id}|trader|${i}`;
    const trader = (S.data?.traders || []).find((t) => t.id === r.trader?.id);
    if (r.requirementType === 'reputation') {
      // Checked against the reputation your quests give (needs quest reward data).
      const need = Number(r.value ?? r.level);
      if (hasStandingData()) {
        const rep = traderStanding(r.trader.id);
        reqs.push({ kind: 'trader', key, trader: r.trader, need, label: `${r.trader?.name} reputation ${need.toFixed(2)} (yours: ${rep.toFixed(2)})`, auto: true, done: rep >= need });
      } else reqs.push({ kind: 'trader', key, trader: r.trader, need, label: `${r.trader?.name} reputation ${need.toFixed(2)}` });
      return;
    }
    // Loyalty level: checked against the level worked out from your PMC level and quest reputation
    // (or set by hand in Settings) once the game data has the trader's loyalty levels.
    const need = Number(r.level ?? r.value);
    if (trader?.levels?.length) {
      const ll = loyaltyLevel(trader).level;
      reqs.push({ kind: 'trader', key, trader: r.trader, need, label: `${r.trader?.name} loyalty level ${need} (yours: LL${ll})`, auto: true, done: ll >= need });
    } else reqs.push({ kind: 'trader', key, trader: r.trader, need, label: `${r.trader?.name} loyalty level ${need}` });
  });
  (level.skillRequirements || []).forEach((r, i) => {
    const lvl = skillLevel(r.name);
    // Tracked automatically once you enter that skill on the Skills tab; otherwise a manual checkbox.
    if (lvl > 0) reqs.push({ kind: 'skill', key: `${level.id}|skill|${i}`, name: r.name, need: r.level, have: lvl, label: `${r.name} level ${r.level} (yours: ${lvl})`, auto: true, done: lvl >= r.level });
    else reqs.push({ kind: 'skill', key: `${level.id}|skill|${i}`, name: r.name, need: r.level, have: 0, label: `${r.name} level ${r.level}` });
  });
  for (const r of reqs) {
    if (r.auto) continue;
    const v = S.progress.hideoutReqs[r.key];
    const target = r.kind === 'item' ? r.count : 1;
    r.cur = v === true ? target : Math.min(Number(v || 0), target);
    r.target = target;
    r.done = r.cur >= target;
  }
  return reqs;
}

// ---------------------------------------------------------------- skills
export const skillKey = (s) => norm(s).replace(/[^a-z]/g, '');
export function findSkill(name) {
  const k = skillKey(name);
  return activeSkillConfig().skills.find((sk) => skillKey(sk.id) === k || skillKey(sk.name) === k);
}
export function skillLevel(name) {
  const sk = findSkill(name);
  return sk ? Number(S.progress.skills?.[sk.id] || 0) : 0;
}
export function effectValue(sk, e, level) {
  const cap = S.skills.effectCapLevel || 50;
  return e.perLevel * Math.min(level, cap);
}

// Bundled skills, minus any that the downloaded game data says are no longer in the game.
export function activeSkillConfig() {
  const cfg = S.skills || { skills: [] };
  const live = S.data?.skills;
  if (!Array.isArray(live) || !live.length) return cfg;
  const ids = new Set(live.map((sk) => skillKey(sk.id)));
  return { ...cfg, skills: cfg.skills.filter((sk) => ids.has(skillKey(sk.id))) };
}

// ---------------------------------------------------------------- hideout bonuses
export const ABSOLUTE_BONUS = new Set(['AdditionalSlots', 'MaximumEnergyReserve', 'StashSize', 'UnlockArmorRepair', 'UnlockWeaponModification', 'UnlockWeaponRepair']);

// Hideout Management's per-level boost to hideout zone bonuses, in percent.
export function hideoutBoostPercent() {
  const cfg = activeSkillConfig();
  const hm = cfg.skills.find((sk) => sk.id === 'HideoutManagement');
  const e = (hm?.effects || []).find((x) => /zone bonus/i.test(x.name));
  return e ? effectValue(hm, e, Number(S.progress.skills?.HideoutManagement || 0)) : 0;
}

// Sum the bonuses of every built hideout level. Percent bonuses add up across levels;
// stash size takes the largest; extra slots are counted per station.
export function hideoutBonusTotals() {
  const boost = hideoutBoostPercent();
  const map = new Map();
  for (const st of S.data?.hideout || []) {
    const built = builtLevel(st);
    for (const l of st.levels) {
      if (l.level > built) continue;
      for (const b of l.bonuses || []) {
        if (b.value == null || !b.type) continue;
        const abs = ABSOLUTE_BONUS.has(b.type);
        const key = `${b.type}|${b.skillName || ''}|${b.type === 'AdditionalSlots' ? st.id : ''}`;
        const e = map.get(key) || { type: b.type, name: b.name || b.type, skillName: b.skillName, station: st.name, abs, total: 0, from: [] };
        e.total = b.type === 'StashSize' ? Math.max(e.total, b.value) : e.total + b.value;
        if (!e.from.includes(st.name)) e.from.push(st.name);
        map.set(key, e);
      }
    }
  }
  return [...map.values()].map((e) => {
    const pct = e.abs ? 0 : e.total * 100;
    return { ...e, pct, boosted: pct * (1 + boost / 100) };
  });
}

// ---------------------------------------------------------------- crafting
// Fuel the generator burns per hour after Hideout Management and hideout fuel bonuses, with the parts:
// { base, hmLevel, hmPct, bonus (FuelConsumption hideout bonus or null), perHour }.
export function generatorFuel() {
  const cfg = activeSkillConfig();
  const base = (cfg.baseValues || {}).generatorFuelPerHour || 4.75;
  const hmLevel = Number(S.progress.skills?.HideoutManagement || 0);
  const hm = cfg.skills.find((sk) => sk.id === 'HideoutManagement');
  const e = (hm?.effects || []).find((x) => /consumption/i.test(x.name));
  const hmPct = e ? effectValue(hm, e, hmLevel) : 0;
  const bonus = hideoutBonusTotals().find((b) => b.type === 'FuelConsumption') || null;
  return { base, hmLevel, hmPct, bonus, perHour: base * (1 + hmPct / 100) * (bonus ? 1 + bonus.boosted / 100 : 1) };
}
export const generatorFuelPerHour = () => generatorFuel().perHour;

// Crafting skill: production time multiplier (e.g. 0.85 at level 20).
export function craftTimeFactor() {
  const cfg = activeSkillConfig();
  const cr = cfg.skills.find((sk) => sk.id === 'Crafting');
  const e = (cr?.effects || []).find((x) => /production time/i.test(x.name));
  return 1 + (e ? effectValue(cr, e, Number(S.progress.skills?.Crafting || 0)) : 0) / 100;
}

// The Bitcoin Farm station (it has no regular recipes; its production depends on graphics cards).
export const isBitcoinFarm = (st) => /bitcoin/i.test(st?.name || '');

// Seconds per bitcoin with N graphics cards: base / (1 + (N - 1) x gpuBoostRate).
// Base and rate match the in-game farm (1 GPU 3d 11h 20m, 50 GPUs 1d 3h 35m 36s).
export function bitcoinSeconds(gpus) {
  const b = activeSkillConfig().baseValues?.bitcoin || {};
  return (b.baseSeconds || 300000) / (1 + Math.max(0, gpus - 1) * (b.gpuBoostRate ?? 0.041225));
}

// Graphics card slots in the Bitcoin Farm at its built level (10 / 25 / 50 in game); 0 when not built.
export function maxGpus() {
  const slots = activeSkillConfig().baseValues?.bitcoin?.gpuSlots || [10, 25, 50];
  const farm = (S.data?.hideout || []).find(isBitcoinFarm);
  const lv = farm ? builtLevel(farm) : 0;
  return lv ? slots[Math.min(lv, slots.length) - 1] : 0;
}

// ---------------------------------------------------------------- needed items
export const AGG_TYPES = new Set(['giveItem', 'plantItem', 'mark', 'buildWeapon', 'useItem', 'findItem']);

// Every item requirement across quests, hideout and prestige. Used by both the items tab and search.
export function itemRequirements({ includeEquipment = false } = {}) {
  const out = [];
  for (const t of S.data.tasks) {
    const st = taskStatus(t.id);
    const handedIn = new Set(t.objectives.filter((o) => o.type === 'giveItem').flatMap((o) => objItems(o).map((i) => i.id)));
    for (const o of t.objectives) {
      const items = objItems(o);
      // "Find" + "hand over" pairs reference the same items; count them once.
      if (o.type === 'findItem' && items.every((i) => handedIn.has(i.id))) continue;
      const v = objValue('objectives', o.id, o);
      const count = o.type === 'buildWeapon' || o.type === 'mark' ? 1 : Number(o.count || 1);
      if (AGG_TYPES.has(o.type) || items.length) {
        for (const it of items) out.push({ item: it, count, have: Math.round((v.cur / v.target) * count), fir: !!o.foundInRaid, alt: items.length > 1, kind: 'quest', status: st, label: t.name, sub: o.description, taskId: t.id, done: v.done || st === 'completed' });
      }
      if (includeEquipment) {
        for (const it of objEquipment(o)) out.push({ item: it, count: 0, have: 0, fir: false, alt: true, kind: 'equipment', status: st, label: t.name, sub: o.description, taskId: t.id, done: v.done || st === 'completed' });
      }
    }
  }
  for (const st of S.data.hideout || []) {
    for (const l of st.levels) {
      const built = levelBuilt(st, l);
      for (const r of hideoutReqs(l)) {
        if (r.kind !== 'item') continue;
        out.push({ item: r.item, count: r.count, have: r.cur, fir: r.fir, alt: false, kind: 'hideout', status: built ? 'completed' : 'hideout', label: `${st.name} level ${l.level}`, sub: '', done: built || r.done });
      }
    }
  }
  for (const p of S.data.prestige || []) {
    if (S.progress.prestige[`achieved|${p.id}`]) continue;
    for (const o of p.conditions || []) {
      const v = objValue('prestige', `${p.id}|${o.id}`, o);
      for (const it of objItems(o)) out.push({ item: it, count: Number(o.count || 1), have: Math.round((v.cur / v.target) * Number(o.count || 1)), fir: !!o.foundInRaid, alt: false, kind: 'prestige', status: 'prestige', label: p.name || `Prestige ${p.prestigeLevel}`, sub: o.description, done: v.done });
    }
  }
  return out;
}

// ---------------------------------------------------------------- traders
// In-game order (by normalizedName); traders not listed go last, by name.
const TRADER_ORDER = ['prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref', 'lightkeeper', 'btr-driver'];
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Every trader: from the game data (portraits, loyalty levels), plus any quest giver it lacks.
export function traderList() {
  const byId = new Map((S.data?.traders || []).map((t) => [t.id, t]));
  for (const t of S.data?.tasks || []) {
    if (t.trader?.id && !byId.has(t.trader.id)) byId.set(t.trader.id, { id: t.trader.id, name: t.trader.name, levels: [] });
  }
  const rank = (t) => { const i = TRADER_ORDER.indexOf(t.normalizedName || slug(t.name)); return i < 0 ? 99 : i; };
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || byName(a.name, b.name));
}

// Whether the game data has quest reputation rewards at all (older cached data does not).
export const hasStandingData = () => (S.data?.tasks || []).some((t) => t.finishRewards || t.startRewards);

// Reputation with a trader from quests: start rewards of started quests, finish rewards of completed
// ones (also those implied by later quests) and the outcome of failed ones.
export function traderStanding(traderId) {
  const key = `rep:${traderId}`;
  if (key in memo) return memo[key];
  let rep = 0;
  const add = (r) => { for (const s of r?.traderStanding || []) if (s.trader?.id === traderId) rep += Number(s.standing) || 0; };
  for (const t of S.data?.tasks || []) {
    const st = taskStatus(t.id);
    if (st === 'active' || st === 'completed' || st === 'failed') add(t.startRewards);
    if (st === 'completed') add(t.finishRewards);
    if (st === 'failed') add(t.failureOutcome);
  }
  return (memo[key] = Math.round(rep * 10000) / 10000);
}

// A trader some quest unlocks (e.g. Jaeger) is locked until that quest is completed.
// { unlocked, by: quest or null }
export function traderUnlock(traderId) {
  const by = (S.data?.tasks || []).filter((t) => (t.finishRewards?.traderUnlock || []).some((x) => x?.id === traderId));
  if (!by.length) return { unlocked: true, by: null };
  const done = by.find((t) => taskStatus(t.id) === 'completed');
  return { unlocked: !!done, by: done || by[0] };
}

// Loyalty level from your PMC level and quest reputation. Money spent with the trader is not tracked
// and assumed to be met. With "Manual loyalty levels" on in Settings, a level set by hand wins.
// { level, auto, manual, max, next: { level, requiredPlayerLevel, requiredReputation, requiredCommerce,
//   repMissing, playerLevelMissing } | null }
export function loyaltyLevel(trader) {
  const levels = (trader.levels || []).slice().sort((a, b) => a.level - b.level);
  const rep = traderStanding(trader.id);
  const pl = Number(S.progress?.settings?.playerLevel || 1);
  let auto = levels[0]?.level ?? 1;
  for (const l of levels) {
    if (pl >= (l.requiredPlayerLevel ?? 1) && rep >= (l.requiredReputation ?? 0)) auto = Math.max(auto, l.level);
    else break;
  }
  const s = S.progress?.settings || {};
  const override = s.loyaltyManual ? s.loyaltyOverrides?.[trader.id] : null;
  const level = Number.isFinite(Number(override)) && override != null ? Number(override) : auto;
  const n = levels.find((l) => l.level === auto + 1);
  const next = n ? {
    ...n,
    repMissing: Math.max(0, Math.round(((n.requiredReputation ?? 0) - rep) * 100) / 100),
    playerLevelMissing: Math.max(0, (n.requiredPlayerLevel ?? 1) - pl),
  } : null;
  return { level, auto, manual: level !== auto || override != null, max: levels.length ? levels[levels.length - 1].level : 4, next };
}

// Seconds until the trader's next restock (from the server's 10-minute snapshot), 0 when due, or
// null when unknown.
export function restockIn(traderId, now = Date.now()) {
  const iso = S.status?.traderResets?.times?.[traderId];
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((t - now) / 1000));
}

// ---------------------------------------------------------------- hideout module status
// Where a hideout station stands with its next level:
// { built, max, next (level object or null), key: 'max' | 'ready' | 'missing' | 'locked',
//   reqs (of the next level), missing (unmet count), lockedBy (unmet station requirements) }
// locked = another station is not built high enough; missing = stations fine, other things unmet.
// countItems: false leaves item requirements out of missing / ready (for views that only list items).
export function stationStatus(st, { countItems = true } = {}) {
  const built = builtLevel(st);
  const max = st.levels.length ? st.levels[st.levels.length - 1].level : 0;
  const next = st.levels.find((l) => l.level === built + 1) || null;
  if (!next) return { built, max, next: null, key: 'max', reqs: [], missing: 0, lockedBy: [] };
  const reqs = hideoutReqs(next);
  const lockedBy = reqs.filter((r) => r.kind === 'station' && !r.done);
  const missing = reqs.filter((r) => !r.done && (countItems || r.kind !== 'item')).length;
  return { built, max, next, reqs, missing, lockedBy, key: lockedBy.length ? 'locked' : missing ? 'missing' : 'ready' };
}
