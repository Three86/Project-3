// Buffs: hideout bonus totals grouped by kind (skill numbers come from core/game.js).
import { S, saveUi } from '../../core/store.js';
import { activeSkillConfig, builtLevel, effectValue, hideoutBonusTotals, hideoutBoostPercent } from '../../core/game.js';

export { activeSkillConfig, builtLevel, effectValue, hideoutBonusTotals, hideoutBoostPercent };

export const uiDefaults = {
  buffOpen: {}, // 'hb' (hideout card) and 'hb:<group>' -> open
  skillOverviewOpen: true,
};

const GROUPS = [
  ['Health, energy & hydration', (b) => /health|energy|hydration|regenerat|debuff|metabol/i.test(`${b.type} ${b.name}`) && !b.abs],
  ['Skills & experience', (b) => !b.abs && (b.skillName || /skill|experience/i.test(`${b.type} ${b.name}`))],
  ['Other hideout bonuses', (b) => !b.abs],
  ['Slots, stash & unlocks', (b) => b.abs],
];

// Hideout bonus totals sorted into groups: [{ key, title, rows }]. Each bonus appears in the first group it fits.
export function bonusGroups(totals = hideoutBonusTotals()) {
  const used = new Set();
  return GROUPS.map(([title, test]) => {
    const rows = totals.filter((b) => !used.has(b) && test(b));
    rows.forEach((b) => used.add(b));
    return { key: `hb:${title}`, title, rows };
  }).filter((g) => g.rows.length);
}

// Game data cached by an older version has no 'bonuses' field on any hideout level.
export const noBonusData = () => !!S.data?.hideout?.length && !S.data.hideout.some((st) => st.levels.some((l) => Array.isArray(l.bonuses)));
export const stationsBuilt = () => (S.data?.hideout || []).filter((st) => builtLevel(st) > 0).length;

export function setAllGroupsOpen(open) {
  for (const g of bonusGroups()) S.ui.buffOpen[g.key] = open;
  saveUi();
}
