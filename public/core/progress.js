// Progress changes used by several sections (quest status, requirement counters and checkboxes).
// Section-specific changes live in that module's logic.js.
import { S, setProgress, toast } from './store.js';
import { allPrereqs, idx, taskStatus } from './game.js';

const questName = (id) => idx.tasks.get(id)?.name || 'Quest';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Quest status changes show a toast with Undo: a mis-click on a second monitor is easy to miss, and
// completing a quest also counts its earlier quests as done. Undo puts back the exact entries replaced.
function changeTasks(ops, title, description) {
  const before = ops.map(({ id }) => ({ section: 'tasks', id, value: S.progress.tasks[id] ? { ...S.progress.tasks[id] } : null }));
  const done = setProgress(ops);
  toast('success', title, description, { label: 'Undo', run: () => setProgress(before) });
  return done;
}

// Earlier quests that are not completed yet (by hand, from the logs, or implied).
const openPrereqs = (id) => [...allPrereqs(id)].filter((p) => taskStatus(p) !== 'completed');

const STATUS_TOAST = { active: 'Started', completed: 'Completed', failed: 'Marked failed' };

// status: 'active' | 'completed' | 'failed' | null (reset)
export function setTaskStatus(id, status) {
  const value = status || null;
  const name = questName(id);
  // Completing (or starting) a quest counts every quest it requires as completed.
  const implied = value === 'completed' || value === 'active' ? openPrereqs(id).length : 0;
  const title = value ? `${STATUS_TOAST[value] || 'Updated'}: ${name}` : `Reset: ${name}`;
  const description = implied ? `${plural(implied, 'earlier quest')} in its chain now count as completed.` : '';
  return changeTasks([{ section: 'tasks', id, value }], title, description);
}

// Mark all prerequisite quests completed and start this one.
export function startWithPrereqs(id) {
  const ops = openPrereqs(id).map((p) => ({ section: 'tasks', id: p, value: 'completed' }));
  ops.push({ section: 'tasks', id, value: 'active' });
  return changeTasks(ops, `Started: ${questName(id)}`, ops.length > 1 ? `${plural(ops.length - 1, 'earlier quest')} marked completed.` : '');
}

// Counter requirement (objectives, hideoutReqs, prestige): add d, clamped to 0..max.
export function stepRequirement(section, key, d, max) {
  const v = S.progress[section][key];
  const cur = v === true ? Number(max) : Number(v || 0);
  return setProgress({ section, id: key, value: Math.max(0, Math.min(Number(max), cur + Number(d))) });
}

// Checkbox requirement.
export const setRequirement = (section, key, done) => setProgress({ section, id: key, value: done || null });
