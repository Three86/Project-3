'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchGameData, queryVariants, API_URL } = require('./tarkovdev');
const { fetchGameDataJson } = require('./tarkovjson');
const { LogWatcher } = require('./logwatcher');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LOGS_DIR = process.env.EFT_LOGS_DIR || '/eft-logs';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const GAME_FILE = path.join(DATA_DIR, 'gamedata.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const LOGSTATE_FILE = path.join(DATA_DIR, 'logstate.json');
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 24);

const log = (...a) => console.log(new Date().toISOString(), ...a);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- state ----------
// Start of the current wipe (from tarkov.dev's wipe list). The game never clears its Logs folder,
// so quest events from before this date belong to earlier wipes and are ignored.
const DEFAULT_LOGS_SINCE = process.env.WIPE_START || '2025-11-15';

const emptyProgress = () => ({
  rev: 0,
  settings: { playerLevel: 1, faction: 'USEC', gameMode: process.env.GAME_MODE || 'regular', autoLogs: true, logsSince: DEFAULT_LOGS_SINCE },
  tasks: {}, // taskId -> { status: active|completed|failed, updatedAt, source: manual|log }
  objectives: {}, // objectiveId -> true | number
  hideout: {}, // stationLevelId -> true (built)
  hideoutReqs: {}, // requirement key -> true | number
  prestige: {}, // condition key -> true | number
  custom: {}, // id -> { text, done, prestigeId }
});
const savedProgress = readJson(PROGRESS_FILE, {});
let progress = Object.assign(emptyProgress(), savedProgress);
progress.settings = { ...emptyProgress().settings, ...savedProgress.settings };
// Progress saved before the wipe filter existed may hold quest states from older wipes.
const needsLogRebuild = savedProgress.settings && !('logsSince' in savedProgress.settings);
let gameData = readJson(GAME_FILE, null);
const logState = readJson(LOGSTATE_FILE, { offsets: {}, events: 0, lastEvents: [] });
let refreshing = null;
let lastRefreshError = null;

function saveProgress() {
  progress.rev += 1;
  writeJson(PROGRESS_FILE, progress);
}

const SECTIONS = ['tasks', 'objectives', 'hideout', 'hideoutReqs', 'prestige', 'custom', 'settings'];
function applyOp({ section, id, value }) {
  if (!SECTIONS.includes(section) || typeof id !== 'string' || !id) throw new Error(`bad op ${section}/${id}`);
  const target = progress[section];
  if (section === 'tasks') {
    if (value == null) delete target[id];
    else if (['active', 'completed', 'failed'].includes(value)) target[id] = { status: value, updatedAt: Date.now(), source: 'manual' };
    else throw new Error(`bad task status ${value}`);
  } else if (value == null || value === false || value === 0) {
    if (section === 'settings') target[id] = value;
    else delete target[id];
  } else {
    target[id] = value;
  }
}

// ---------- game data ----------
async function refreshGameData(reason) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    log(`refreshing game data from tarkov.dev (${reason})`);
    try {
      const opts = { gameMode: progress.settings.gameMode || 'regular', log };
      // The static JSON feed is what tarkov.dev's own website uses; GraphQL is the fallback.
      let data;
      try {
        data = await fetchGameDataJson(opts);
      } catch (err) {
        log(`json.tarkov.dev failed (${err.message}), trying the GraphQL API`);
        try {
          data = await fetchGameData(opts);
        } catch (gqlErr) {
          throw new Error(`json.tarkov.dev: ${err.message} | GraphQL: ${gqlErr.message}`);
        }
      }
      gameData = data;
      writeJson(GAME_FILE, data);
      lastRefreshError = null;
      log(`game data cached: ${data.tasks.length} quests, ${data.hideout.length} hideout stations, ${data.prestige.length} prestige levels`);
    } catch (err) {
      lastRefreshError = err.message;
      log(`game data refresh failed: ${err.message}`);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function dataIsStale() {
  if (!gameData) return true;
  const age = Date.now() - new Date(gameData.meta?.fetchedAt || 0).getTime();
  return REFRESH_HOURS > 0 && age > REFRESH_HOURS * 3600 * 1000;
}

// ---------- log watcher ----------
const watcher = new LogWatcher({
  logsDir: LOGS_DIR,
  state: logState,
  log,
  onEvents(events) {
    let changed = 0;
    for (const ev of events) {
      if (progress.settings.autoLogs === false) break;
      if (ev.at < logsSinceMs()) continue;
      const cur = progress.tasks[ev.taskId];
      // A manual change made after the logged event wins.
      if (cur && cur.updatedAt > ev.at) continue;
      if (cur && cur.status === ev.status) continue;
      progress.tasks[ev.taskId] = { status: ev.status, updatedAt: ev.at, source: 'log' };
      changed++;
    }
    logState.events += events.length;
    logState.lastEvents = [...events.slice(-20).reverse(), ...logState.lastEvents].slice(0, 20);
    writeJson(LOGSTATE_FILE, logState);
    if (changed) {
      saveProgress();
      log(`applied ${changed} quest status change(s) from game logs`);
    }
  },
});

function logsSinceMs() {
  const t = Date.parse(progress.settings.logsSince || '');
  return Number.isNaN(t) ? 0 : t;
}

// Forget every quest status that came from the logs and read all logs again.
function rebuildFromLogs() {
  for (const [id, t] of Object.entries(progress.tasks)) if (t.source === 'log') delete progress.tasks[id];
  logState.offsets = {};
  logState.events = 0;
  logState.lastEvents = [];
  saveProgress();
  const n = watcher.scan();
  writeJson(LOGSTATE_FILE, logState);
  log(`rebuilt quest statuses from game logs since ${progress.settings.logsSince || 'the beginning'} (${n} events read)`);
  return n;
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function status() {
  return {
    rev: progress.rev,
    hasData: !!gameData,
    dataMeta: gameData?.meta || null,
    refreshing: !!refreshing,
    refreshError: lastRefreshError,
    logs: { dir: LOGS_DIR, available: watcher.available, files: watcher.filesSeen, lastScan: watcher.lastScan, events: logState.events, lastEvents: logState.lastEvents },
  };
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/status':
      return send(res, 200, status());
    case 'GET /api/data':
      return gameData ? send(res, 200, gameData) : send(res, 404, { error: 'no game data yet', ...status() });
    case 'GET /api/data/queries':
      return send(res, 200, { url: API_URL, gameMode: progress.settings.gameMode || 'regular', queries: queryVariants({ gameMode: progress.settings.gameMode || 'regular' }) });
    case 'POST /api/data/refresh':
      await refreshGameData('manual');
      return send(res, lastRefreshError ? 502 : 200, status());
    case 'POST /api/data/import': {
      const body = await readBody(req);
      if (!Array.isArray(body.tasks) || !Array.isArray(body.hideout)) return send(res, 400, { error: 'expected { tasks: [], hideout: [], prestige: [] }' });
      lastRefreshError = null;
      gameData = { meta: { source: 'import', fetchedAt: new Date().toISOString(), ...(body.meta || {}) }, tasks: body.tasks, hideout: body.hideout, prestige: body.prestige || [] };
      writeJson(GAME_FILE, gameData);
      return send(res, 200, status());
    }
    case 'GET /api/progress':
      return send(res, 200, progress);
    case 'POST /api/progress': {
      const body = await readBody(req);
      const ops = Array.isArray(body.ops) ? body.ops : [body];
      ops.forEach(applyOp);
      saveProgress();
      if (ops.some((o) => o.section === 'settings' && (o.id === 'logsSince' || (o.id === 'autoLogs' && o.value)))) rebuildFromLogs();
      return send(res, 200, { rev: progress.rev });
    }
    case 'POST /api/progress/import': {
      const body = await readBody(req);
      if (typeof body !== 'object' || !body.tasks) return send(res, 400, { error: 'not a progress export' });
      const rev = progress.rev;
      progress = Object.assign(emptyProgress(), body, { rev });
      saveProgress();
      return send(res, 200, { rev: progress.rev });
    }
    case 'POST /api/progress/reset': {
      const settings = progress.settings;
      const rev = progress.rev;
      progress = Object.assign(emptyProgress(), { settings, rev });
      saveProgress();
      return send(res, 200, { rev: progress.rev });
    }
    case 'POST /api/logs/rescan': {
      const n = rebuildFromLogs();
      return send(res, 200, { events: n, ...status() });
    }
    default:
      return send(res, 404, { error: 'not found' });
  }
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET') serveStatic(res, url.pathname);
    else send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  log(`Tarkov tracker listening on http://localhost:${PORT}`);
  log(`data dir: ${DATA_DIR}; game logs: ${LOGS_DIR} (${watcher.available ? 'found' : 'not found – auto quest detection disabled'})`);
  if (dataIsStale()) refreshGameData(gameData ? 'cache older than REFRESH_HOURS' : 'no cached data');
  // Without any data, keep retrying every 5 minutes (tarkov.dev outages are usually short).
  let ticks = 0;
  setInterval(() => {
    ticks++;
    if (!gameData) refreshGameData('retry: no data yet');
    else if (ticks % 12 === 0 && dataIsStale()) refreshGameData('scheduled');
  }, 5 * 60 * 1000).unref();
  if (needsLogRebuild && watcher.available) rebuildFromLogs();
  watcher.start();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { watcher.stop(); server.close(); process.exit(0); });
