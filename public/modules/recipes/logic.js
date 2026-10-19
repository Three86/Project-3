// Recipes: which crafts each station can make, pins (up to MAX_PINS per station), and the Bitcoin Farm.
import { S, setProgress, saveUi } from '../../core/store.js';
import { norm, uniq, byName } from '../../core/util.js';
import { idx, activeSkillConfig, bitcoinSeconds, builtLevel, craftTimeFactor, generatorFuelPerHour, isBitcoinFarm, taskStatus } from '../../core/game.js';

export { craftTimeFactor, builtLevel };

export const uiDefaults = {
  rec: { text: '', showLocked: false },
  recOpen: {}, // station id (or 'bitcoin') -> group open
};

export const MAX_PINS = 4;

// Why a recipe can't be made yet, or null when it can.
export function craftLock(c) {
  const st = c.station && idx.stations.get(c.station.id);
  if (!st || builtLevel(st) < c.level) return `needs ${c.station?.name || 'station'} level ${c.level}`;
  if (c.taskUnlock && taskStatus(c.taskUnlock.id) !== 'completed') return `complete quest: ${c.taskUnlock.name}`;
  return null;
}

// Recipes grouped by station with the current filters:
// { available, farm, groups: [{ st, pins, pinned, rest, unlocked }], hiddenLocked, text }
export function recipeGroups() {
  const crafts = S.data.crafts;
  if (!Array.isArray(crafts)) return { available: false, groups: [], hiddenLocked: 0, farm: null, text: '' };
  const f = S.ui.rec;
  const text = norm(f.text);
  const pinsAll = S.progress.craftPins || {};
  const stations = (S.data.hideout || []).filter((st) => !isBitcoinFarm(st) && crafts.some((c) => c.station?.id === st.id)).sort((a, b) => byName(a.name, b.name));
  const farm = (S.data.hideout || []).find(isBitcoinFarm);
  let hiddenLocked = 0;
  const groups = [];
  for (const st of stations) {
    const pins = (pinsAll[st.id] || []).filter((id) => crafts.some((c) => c.id === id));
    const matches = (c) => !text || [...(c.rewardItems || []), ...(c.requiredItems || [])].some((r) => norm(r.item?.name).includes(text) || norm(r.item?.shortName).includes(text));
    const list = crafts.filter((c) => c.station?.id === st.id).filter(matches);
    const unlocked = list.filter((c) => !craftLock(c));
    hiddenLocked += list.length - unlocked.length;
    const visible = (f.showLocked ? list : unlocked).sort((a, b) => a.level - b.level || byName(a.rewardItems?.[0]?.item?.name, b.rewardItems?.[0]?.item?.name));
    const pinned = pins.map((id) => crafts.find((c) => c.id === id)).filter((c) => c && matches(c));
    const rest = visible.filter((c) => !pins.includes(c.id));
    if (pinned.length || rest.length) groups.push({ st, pins, pinned, rest, unlocked });
  }
  return { available: true, farm: farm && builtLevel(farm) > 0 && !text ? farm : null, groups, hiddenLocked, text };
}

// Bitcoin Farm numbers for your graphics cards and generator fuel use.
export function bitcoinInfo() {
  const b = activeSkillConfig().baseValues || {};
  const btc = b.bitcoin || {};
  const gpus = Math.max(1, Number(S.progress.settings.gpuCount || 1));
  const secs = bitcoinSeconds(gpus);
  const perHour = generatorFuelPerHour();
  return {
    gpus,
    maxGpus: btc.maxGpus || 50,
    secs,
    perDay: 86400 / secs,
    perHour,
    storage: (btc.storage || 3) + (Number(S.progress.skills?.HideoutManagement || 0) >= 51 ? 2 : 0),
    table: uniq([1, 10, 25, 50, gpus]).sort((x, y) => x - y).map((n) => ({ gpus: n, secs: bitcoinSeconds(n) })),
    tanks: (b.fuelTanks || [{ name: 'Metal fuel tank', resource: 100 }]).map((t) => {
      const hours = t.resource / perHour;
      return { ...t, hours, bitcoins: hours / (secs / 3600) };
    }),
  };
}

// Pin or unpin a recipe at the top of its station (no more than MAX_PINS).
export function togglePin(stationId, craftId) {
  const pins = (S.progress.craftPins?.[stationId] || []).slice();
  const at = pins.indexOf(craftId);
  if (at >= 0) pins.splice(at, 1);
  else if (pins.length < MAX_PINS) pins.push(craftId);
  S.ui.recOpen[stationId] = true;
  saveUi();
  return setProgress({ section: 'craftPins', id: stationId, value: pins.length ? pins : null });
}

export function setAllOpen(open) {
  for (const st of S.data.hideout || []) S.ui.recOpen[st.id] = open;
  S.ui.recOpen.bitcoin = open; // the Bitcoin Farm section has its own key
  saveUi();
}

