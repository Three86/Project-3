// Overview: your PMC, Kappa / Lightkeeper progress and what a few skills mean in practice.
// Game values (stamina, drain, filters) are in server/skills.json baseValues.
import { S } from '../../core/store.js';
import { activeSkillConfig, builtLevel, craftTimeFactor, effectValue, generatorFuel, hideoutBonusTotals, taskStatus } from '../../core/game.js';

export const uiDefaults = {};

const base = () => activeSkillConfig().baseValues || {};
const level = (id) => Number(S.progress.skills?.[id] || 0);
// A skill effect at your level, in percent (0 when the skill or effect is missing).
function pct(id, pattern) {
  const sk = activeSkillConfig().skills.find((x) => x.id === id);
  const e = (sk?.effects || []).find((x) => pattern.test(x.name));
  return e ? effectValue(sk, e, level(id)) : 0;
}

// Faction, level and picture. A picture in data/images/pmc/<faction>.* replaces the bundled one.
export function pmc() {
  const faction = S.progress.settings.faction === 'BEAR' ? 'BEAR' : 'USEC';
  const f = faction.toLowerCase();
  return { faction, level: Number(S.progress.settings.playerLevel || 1), image: `/api/images/pmc/${f}`, fallback: `img/pmc/${f}.webp` };
}

// Kappa and Lightkeeper: quests marked as needed for them (your faction's only).
// [{ key, title, done, active, total }], or null without game data.
export function goals() {
  if (!S.data?.tasks) return null;
  return [['kappa', 'Kappa container', 'kappaRequired'], ['lightkeeper', 'Lightkeeper', 'lightkeeperRequired']].map(([key, title, flag]) => {
    const st = S.data.tasks.filter((t) => t[flag]).map((t) => taskStatus(t.id)).filter((s) => s !== 'unavailable');
    return { key, title, done: st.filter((s) => s === 'completed').length, active: st.filter((s) => s === 'active').length, total: st.length };
  });
}

// Weight limits raised by Strength's carry weight bonus.
export function strength() {
  const b = base();
  const carryPct = pct('Strength', /carry weight/i);
  const m = 1 + carryPct / 100;
  const lim = (kg) => ({ now: kg * m, base: kg });
  return { level: level('Strength'), carryPct, overweight: lim(b.overweightStartKg || 26), sprint: lim(b.sprintLimitKg || 72), critical: lim(b.criticalOverweightKg || 77) };
}

// Sprint time from full stamina (not overweight) and the time to refill it from empty, standing still.
// Endurance raises stamina (+1%/level, +20% more at elite) but not how fast it refills.
export function endurance() {
  const b = base(), s = b.stamina || {};
  const cap0 = s.capacity || 115, drain = s.sprintDrainPerSecond || 4, rest = (s.restorePerSecond || 4.5) * (s.restoreStanding || 1);
  const elite = level('Endurance') >= (S.skills?.eliteLevel || 51) ? (b.enduranceEliteStaminaPercent || 0) : 0;
  const staminaPct = pct('Endurance', /^stamina$/i) + elite;
  const capacity = cap0 * (1 + staminaPct / 100);
  return { level: level('Endurance'), staminaPct, capacity, sprint: { now: capacity / drain, base: cap0 / drain }, refill: { now: capacity / rest, base: cap0 / rest } };
}

// What food and drink give (Metabolism) and how fast energy and hydration drain in raid (Health:
// energy consumption and dehydration rate; Metabolism does not change the drain).
export function metabolism() {
  const b = base();
  const gain = pct('Metabolism', /food and drink positive/i);
  const drainEnergy = pct('Health', /energy consumption/i), drainWater = pct('Health', /dehydration/i);
  const extraEnergy = hideoutBonusTotals().find((x) => x.type === 'MaximumEnergyReserve')?.total || 0;
  const pool = (perMin, max, p) => { const f = 1 + p / 100; return { max, pct: p, perMin: perMin * f, basePerMin: perMin, minutes: max / (perMin * f), baseMinutes: max / perMin }; };
  return {
    level: level('Metabolism'), health: level('Health'), gainPct: gain,
    item50: 50 * (1 + gain / 100),
    energy: pool(b.energyDrainPerMinute || 3.8, (b.maxEnergy || 100) + extraEnergy, drainEnergy),
    hydration: pool(b.hydrationDrainPerMinute || 3.2, b.maxHydration || 100, drainWater),
  };
}

// Fuel tanks, air filter and water filter with Hideout Management (and Crafting for the water time).
export function hideoutResources() {
  const b = base();
  const fuel = generatorFuel();
  const cons = 1 + fuel.hmPct / 100;
  const air = b.airFilter || { resource: 300, perHour: 17 };
  const wf = b.waterFilter || { resource: 100, perCanister: 66, canisterSeconds: 19500, collectorLevel: 3 };
  const collector = (S.data?.hideout || []).find((st) => /water collector/i.test(st.name));
  return {
    crafting: level('Crafting'), hm: level('HideoutManagement'), fuel,
    tanks: (b.fuelTanks || []).map((t) => ({ ...t, hours: t.resource / fuel.perHour, baseHours: t.resource / fuel.base })),
    air: { resource: air.resource, hours: air.resource / (air.perHour * cons), baseHours: air.resource / air.perHour },
    water: {
      resource: wf.resource, use: wf.perCanister * cons, canisters: wf.resource / (wf.perCanister * cons), baseCanisters: wf.resource / wf.perCanister,
      seconds: wf.canisterSeconds * craftTimeFactor(), baseSeconds: wf.canisterSeconds, craftPct: (craftTimeFactor() - 1) * 100,
      collectorLevel: wf.collectorLevel, collectorBuilt: collector ? builtLevel(collector) : null,
    },
  };
}
