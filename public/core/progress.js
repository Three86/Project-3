// Progress changes used by several sections (quest status, requirement counters and checkboxes).
// Section-specific changes live in that module's logic.js.
import { S, setProgress } from './store.js';
import { allPrereqs, taskStatus } from './game.js';

// status: 'active' | 'completed' | 'failed' | null (reset)
export const setTaskStatus = (id, status) => setProgress({ section: 'tasks', id, value: status || null });

// Mark all prerequisite quests completed and start this one.
export function startWithPrereqs(id) {
  const ops = [...allPrereqs(id)].filter((p) => taskStatus(p) !== 'completed').map((p) => ({ section: 'tasks', id: p, value: 'completed' }));
  ops.push({ section: 'tasks', id, value: 'active' });
  return setProgress(ops);
}

// Counter requirement (objectives, hideoutReqs, prestige): add d, clamped to 0..max.
export function stepRequirement(section, key, d, max) {
  const v = S.progress[section][key];
  const cur = v === true ? Number(max) : Number(v || 0);
  return setProgress({ section, id: key, value: Math.max(0, Math.min(Number(max), cur + Number(d))) });
}

// Checkbox requirement.
export const setRequirement = (section, key, done) => setProgress({ section, id: key, value: done || null });
