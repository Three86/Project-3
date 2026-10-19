// Settings: game data, game logs, progress backup / reset, and which interface (GUI) this browser uses.
// Single settings values are saved with core/store.js setSetting(key, value).
import { S, api, loadAll, poll, refreshData } from '../../core/store.js';
import { guiInfo, setGui } from '../../core/gui.js';

export { setSetting } from '../../core/store.js';
export { refreshData };

export const uiDefaults = {};

// Every installed GUI and the one running here: { list: [{ id, title, description }], current }.
export const interfaces = () => ({ list: guiInfo.list, current: guiInfo.current?.id });
// Switch this browser to another GUI (reloads the page).
export const setInterface = (id) => setGui(id);

export async function rescanLogs() {
  await api('/api/logs/rescan', { method: 'POST' });
  await poll(true);
}

// Progress as a downloadable JSON file: { filename, json }.
export function exportProgress() {
  return { filename: `tarkov-progress-${new Date().toISOString().slice(0, 10)}.json`, json: JSON.stringify(S.progress, null, 2) };
}

// kind: 'data' (game data file) | 'progress' (exported progress). Throws with the server's reason on failure.
export async function importFile(kind, text) {
  const res = await api(kind === 'data' ? '/api/data/import' : '/api/progress/import', { method: 'POST', body: text });
  if (!res.ok) throw new Error(res.body.error);
  await loadAll();
}

// After a wipe, profile reset or prestige: clears quest, objective and hideout progress, level 1,
// ignores game logs before now. Prestige checklists and settings are kept.
export async function freshStart() {
  await api('/api/progress/fresh-start', { method: 'POST' });
  await poll(true);
}

export async function resetAll() {
  await api('/api/progress/reset', { method: 'POST' });
  await poll(true);
}
