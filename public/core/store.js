// Shared state, server API, progress saving and sync. Headless: GUIs subscribe to events instead of
// being called directly.
//
// Events (on(name, fn)):
//   change   state changed (progress, data, module state); redraw
//   status   periodic status poll with no progress change (only "live" views need a redraw)
//   banner   (html) persistent message strip; '' clears it
//   toast    ({ category, title, description }) short notification
//   setting  ({ key, value }) a settings value was saved
import { esc } from './util.js';
import { buildIndex, maxGpus, resetMemo } from './game.js';

export const S = {
  data: null, // game data (/api/data)
  skills: null, // skill definitions (/api/skills)
  progress: null, // your progress (/api/progress)
  status: null, // server status (/api/status)
  ui: {}, // UI state of the running GUI (filters, open/closed sections, current tab); see initUi()
};

const listeners = new Map();
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name).delete(fn);
}
export function emit(name, payload) {
  for (const fn of listeners.get(name) || []) {
    try { fn(payload); } catch (err) { console.error(`listener for ${name} failed`, err); }
  }
}
const banner = (html) => emit('banner', html || '');
const toast = (category, title, description = '') => emit('toast', { category, title, description });

export async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) throw new Error(body.error || `HTTP ${res.status}`);
  return { ok: res.ok, body };
}

// Apply ops locally (optimistic) and persist them on the server.
// An op is { section, id, value }; sections are the ones in progress.json.
export async function setProgress(ops) {
  if (!Array.isArray(ops)) ops = [ops];
  for (const { section, id, value } of ops) {
    const t = S.progress[section];
    if (section === 'tasks') value == null ? delete t[id] : (t[id] = { status: value, updatedAt: Date.now(), source: 'manual' });
    else if (section === 'settings') t[id] = value;
    else if (value == null || value === false || value === 0) delete t[id];
    else t[id] = value;
  }
  resetMemo();
  emit('change');
  try {
    const { body } = await api('/api/progress', { method: 'POST', body: JSON.stringify({ ops }) });
    S.progress.rev = body.rev;
  } catch (err) {
    toast('error', 'Could not save progress', err.message);
  }
}

// Save one Settings value from a raw input value (clamped / converted like the inputs expect).
export async function setSetting(key, raw) {
  let value = raw;
  if (key === 'playerLevel') value = Math.max(1, Number(raw) || 1);
  // Graphics cards: no more than the built Bitcoin Farm level has slots for.
  else if (key === 'gpuCount') value = Math.min(Math.max(1, maxGpus()), Math.max(1, Math.round(Number(raw) || 1)));
  // datetime-local is in the viewer's local time; store an absolute timestamp.
  else if (key === 'logsSince') value = raw ? new Date(raw).toISOString() : '';
  await setProgress({ section: 'settings', id: key, value });
  emit('setting', { key, value });
  if (key === 'gameMode') await refreshData();
}

// ---------------------------------------------------------------- UI state (per GUI, in localStorage)
// Modules declare their defaults (logic.js `uiDefaults`); saved values are merged over them one level deep.
let uiKey = 'tt-ui';
export function initUi(key, defaults) {
  uiKey = key;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* storage unavailable or corrupt */ }
  const ui = { ...defaults };
  for (const [k, v] of Object.entries(saved)) {
    ui[k] = v && typeof v === 'object' && !Array.isArray(v) && defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) ? { ...defaults[k], ...v } : v;
  }
  S.ui = ui;
  return ui;
}
export function saveUi() {
  try { localStorage.setItem(uiKey, JSON.stringify(S.ui)); } catch { /* storage unavailable */ }
}
// setUi('q.trader', 'Prapor')
export function setUi(path, value) {
  const parts = path.split('.');
  let o = S.ui;
  while (parts.length > 1) o = o[parts.shift()] ||= {};
  o[parts[0]] = value;
  saveUi();
}

// ---------------------------------------------------------------- loading & sync
export async function refreshData() {
  banner('Downloading game data from tarkov.dev…');
  let serverOk = false;
  try { serverOk = (await api('/api/data/refresh', { method: 'POST' })).ok; } catch { /* fall back below */ }
  const ok = serverOk || await browserDownload();
  await loadAll();
  if (ok) toast('success', 'Game data updated', S.data?.meta?.fetchedAt ? `Fetched ${new Date(S.data.meta.fetchedAt).toLocaleString()}` : '');
  else toast('error', 'Game data could not be downloaded', 'Using the cached data; the tracker keeps retrying.');
  return ok;
}

// Fallback for when the container's own requests to tarkov.dev are rejected: the browser runs
// the same queries (tarkov.dev allows cross-origin requests) and uploads the result.
let browserTried = false;
export async function browserDownload() {
  browserTried = true;
  banner('Server download failed – trying to download game data directly from your browser…');
  try {
    const { body: cfg } = await api('/api/data/queries');
    const out = {};
    const errors = [];
    for (const [key, variants] of Object.entries(cfg.queries)) {
      for (const query of variants) {
        try {
          const res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
          const json = await res.json();
          if (!json.data?.[key]) throw new Error((json.errors || []).map((e) => e.message).join('; ') || 'empty response');
          out[key] = json.data[key];
          break;
        } catch (err) { errors.push(`${key}: ${err.message}`); }
      }
    }
    if (!out.tasks || !out.hideoutStations) throw new Error(errors.join(' / '));
    const payload = { meta: { source: `${cfg.url} (via browser)`, gameMode: cfg.gameMode, prestigeError: out.prestige ? null : errors.filter((e) => e.startsWith('prestige')).join(' / ') }, tasks: out.tasks, hideout: out.hideoutStations, prestige: out.prestige || [], traders: out.traders || [] };
    const res = await api('/api/data/import', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(res.body.error);
    banner('');
    return true;
  } catch (err) {
    const msg = /failed to fetch/i.test(err.message) ? 'your browser could not reach tarkov.dev either (it is down or blocked)' : esc(err.message);
    banner(`Browser download failed too: ${msg}. The tracker keeps retrying automatically.`);
    return false;
  }
}

export async function loadAll() {
  const [st, prog, data, skills] = await Promise.all([api('/api/status'), api('/api/progress'), api('/api/data'), api('/api/skills').catch(() => ({ body: { skills: [] } }))]);
  S.skills = skills.body;
  S.status = st.body;
  S.progress = prog.body;
  S.progress.skills ||= {};
  if (data.ok) { S.data = data.body; buildIndex(); }
  resetMemo();
  if (!S.data && S.status.refreshError && !S.status.refreshing && !browserTried) {
    if (await browserDownload()) return loadAll();
  }
  if (S.data && !S.status.refreshError) banner('');
  else if (S.status.refreshError && S.data) banner(`Could not refresh game data (${esc(S.status.refreshError)}). Using cached data from ${esc(S.data.meta?.fetchedAt)}.`);
  emit('change');
}

export async function poll(force = false) {
  try {
    const { body } = await api('/api/status');
    const hadData = S.status?.hasData;
    S.status = body;
    if (!hadData && body.hasData) return loadAll();
    if (force || body.rev !== S.progress?.rev) {
      S.progress = (await api('/api/progress')).body;
      S.progress.skills ||= {};
      resetMemo();
      emit('change');
    } else emit('status');
  } catch { /* server restarting */ }
}

// Load everything, then keep in sync with the server (game logs, other browsers) every 5 s.
let started = false;
export async function start() {
  if (started) return;
  started = true;
  try { await loadAll(); } catch (err) { banner(`Cannot reach tracker server: ${esc(err.message)}`); }
  setInterval(poll, 5000);
}
