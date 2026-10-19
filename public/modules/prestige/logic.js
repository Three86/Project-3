// Prestige: which prestige is shown, its conditions, achieved marks and your own (custom) requirements.
import { S, setProgress, saveUi } from '../../core/store.js';
import { objValue } from '../../core/game.js';

export { stepRequirement, setRequirement } from '../../core/progress.js';

export const uiDefaults = {
  prestigeView: null, // prestige id picked with the switcher; null = next one not achieved
};

export const prestigeList = () => (S.data?.prestige || []).slice().sort((a, b) => (a.prestigeLevel || 0) - (b.prestigeLevel || 0));
export const prestigeName = (p) => p?.name || `Prestige ${p?.prestigeLevel ?? ''}`;
export const isAchieved = (p) => !!S.progress.prestige[`achieved|${p.id}`];
// Progress key of one condition of a prestige.
export const conditionKey = (p, o) => `${p.id}|${o.id}`;

// The prestige to show: the picked one, else the first not yet achieved, else the last.
export function currentPrestige(list = prestigeList()) {
  return list.find((p) => p.id === S.ui.prestigeView) || list.find((p) => !isAchieved(p)) || list[list.length - 1];
}

// Conditions met. Once achieved, all count as met even if level etc. reset since.
export function conditionsDone(p) {
  const conds = p.conditions || [];
  return isAchieved(p) ? conds.length : conds.filter((o) => objValue('prestige', conditionKey(p, o), o).done).length;
}

// Custom requirements for one prestige ('general' when there is no prestige data): [[id, { text, done }]].
export const customRequirements = (pid) => Object.entries(S.progress.custom).filter(([, c]) => c.prestigeId === pid);

export function setView(id) { S.ui.prestigeView = id || null; saveUi(); }

export function setAchieved(id, achieved) {
  // Back to "next unachieved" so marking one achieved moves straight on to the next prestige.
  S.ui.prestigeView = null;
  saveUi();
  return setProgress({ section: 'prestige', id: `achieved|${id}`, value: achieved || null });
}

export function addCustom(prestigeId, text) {
  text = String(text || '').trim();
  if (!text) return null;
  return setProgress({ section: 'custom', id: `c${Date.now().toString(36)}`, value: { text, done: false, prestigeId } });
}
export const toggleCustom = (id, done) => setProgress({ section: 'custom', id, value: { ...S.progress.custom[id], done } });
export const deleteCustom = (id) => setProgress({ section: 'custom', id, value: null });
