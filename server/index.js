'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchGameData, queryVariants, API_URL } = require('./tarkovdev');
const { fetchGameDataJson } = require('./tarkovjson');
const { LogWatcher } = require('./logwatcher');
const ocr = require('./ocr');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LOGS_DIR = process.env.EFT_LOGS_DIR || '/eft-logs';
const SHOTS_DIR = process.env.EFT_SCREENSHOTS_DIR || '/eft-screenshots';
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
const DEFAULT_LOGS_SINCE = process.env.WIPE_START || '2025-11-15T09:00:00Z';

const emptyProgress = () => ({
  rev: 0,
  settings: { playerLevel: 1, faction: 'USEC', gameMode: process.env.GAME_MODE || 'regular', autoLogs: true, logsSince: DEFAULT_LOGS_SINCE, ocrEngine: 'auto' },
  tasks: {}, // taskId -> { status: active|completed|failed, updatedAt, source: manual|log }
  objectives: {}, // objectiveId -> true | number
  hideout: {}, // stationLevelId -> true (built)
  hideoutReqs: {}, // requirement key -> true | number
  prestige: {}, // condition key -> true | number
  custom: {}, // id -> { text, done, prestigeId }
  skills: {}, // skill id -> level
  craftPins: {}, // station id -> [craft id] (max 4)
});
const savedProgress = readJson(PROGRESS_FILE, {});
let progress = Object.assign(emptyProgress(), savedProgress);
progress.settings = { ...emptyProgress().settings, ...savedProgress.settings };
// Skill ids that were renamed to match the game's own keys.
const SKILL_RENAMES = { AssaultRifle: 'Assault', Troubleshooting: 'TroubleShooting', WeaponMaintenance: 'WeaponTreatment' };
progress.skills = progress.skills || {};
for (const [from, to] of Object.entries(SKILL_RENAMES)) {
  if (from in progress.skills) {
    progress.skills[to] ??= progress.skills[from];
    delete progress.skills[from];
  }
}
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

const SECTIONS = ['tasks', 'objectives', 'hideout', 'hideoutReqs', 'prestige', 'custom', 'settings', 'skills', 'craftPins'];
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
      data.meta.dataVersion = DATA_VERSION;
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

// Bump when the tracker starts using fields older cached game data doesn't have
// (2: hideout bonuses, active skill list; 3: XP table). Older caches are re-downloaded automatically.
const DATA_VERSION = 4; // 3: XP table (playerLevels); 4: hideout crafts
const dataOutdated = () => !!gameData && (gameData.meta?.dataVersion || 1) < DATA_VERSION && gameData.meta?.source !== 'import';

function dataIsStale() {
  if (!gameData) return true;
  if (dataOutdated()) return true;
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

// data/skills.json lets the user correct the bundled values without rebuilding the image.
function skillsConfig() {
  return readJson(path.join(DATA_DIR, 'skills.json'), null) || readJson(path.join(__dirname, 'skills.json'), { skills: [] });
}

// Read skill / PMC levels from the newest day's out-of-raid screenshots and apply them.
let ocrRunning = null;
async function runOcr() {
  const avail = await ocr.engines();
  const engine = ['auto', 'ai', 'tesseract'].includes(progress.settings.ocrEngine) ? progress.settings.ocrEngine : 'auto';
  if (engine === 'ai' && !avail.ai) return { error: 'The AI OCR engine is not installed (it is included in the Docker image). Choose "Auto" or "Tesseract" in Settings.' };
  if (!avail.ai && !avail.tesseract) return { error: 'No OCR engine is installed (both are included in the Docker image).' };
  if (engine === 'tesseract' && !avail.tesseract) return { error: 'Tesseract OCR is not installed. Choose "Auto" or "AI" in Settings.' };
  const sel = ocr.selectScreenshots(SHOTS_DIR);
  if (!sel.available) return { error: `Screenshot folder ${SHOTS_DIR} not found. Mount your Escape from Tarkov Screenshots folder (see README).` };
  if (!sel.selected.length) return { error: sel.all.length ? 'All screenshots were taken in raid (they have coordinates in the file name); nothing to read.' : 'No screenshots found.' };
  const skills = skillsConfig().skills.map((sk) => ({ id: sk.id, name: sk.name, aliases: sk.aliases }));
  const files = [];
  const levels = {};
  const inferredIds = new Set(); // skills whose name was worked out from the page layout
  let characterLevel = null;
  // One AI process for the whole batch (the model loads once). Falls back to Tesseract if it fails.
  let ai = null;
  let aiError = null;
  if (engine !== 'tesseract' && avail.ai) {
    ai = ocr.startAi();
    try { await ai.ready; } catch (err) { aiError = err.message; ai.stop(); ai = null; }
    if (!ai && (engine === 'ai' || !avail.tesseract)) return { error: `AI OCR failed to start: ${aiError}` };
  }
  for (const shot of sel.selected) { // oldest first, so later screenshots win
    try {
      const r = await ocr.readScreenshot(shot.file, skills, { playerLevels: gameData?.playerLevels, engine: ai ? engine : 'tesseract', ai });
      Object.assign(levels, r.skills);
      for (const id of Object.keys(r.skills)) { if ((r.inferred || []).includes(id)) inferredIds.add(id); else inferredIds.delete(id); }
      if (r.characterLevel) characterLevel = r.characterLevel;
      files.push({ name: shot.name, skills: r.skills, characterLevel: r.characterLevel, levelCheck: r.levelCheck, unreadLevels: r.unpairedLevels.length, engines: r.engines });
    } catch (err) {
      files.push({ name: shot.name, error: err.message });
    }
  }
  if (ai) ai.stop();
  const nameOf = Object.fromEntries(skills.map((sk) => [sk.id, sk.name]));
  const changes = [];
  for (const [id, level] of Object.entries(levels)) {
    const from = Number(progress.skills[id] || 0);
    if (from !== level) changes.push({ id, name: nameOf[id] || id, from, to: level });
    applyOp({ section: 'skills', id, value: level || null });
  }
  let playerLevel = null;
  if (characterLevel && characterLevel !== progress.settings.playerLevel) {
    playerLevel = { from: progress.settings.playerLevel, to: characterLevel };
    applyOp({ section: 'settings', id: 'playerLevel', value: characterLevel });
  }
  if (changes.length || playerLevel) saveProgress();
  log(`OCR: read ${files.length} screenshot(s) from ${sel.day}; ${Object.keys(levels).length} skills found, ${changes.length} changed`);
  const read = Object.entries(levels).map(([id, level]) => ({ id, name: nameOf[id] || id, level, inferred: inferredIds.has(id) }));
  return { day: sel.day, engine, aiError, files, found: read.length, read, changes, playerLevel, skippedInRaid: sel.all.length - sel.usable.length, skippedOlder: sel.usable.length - sel.selected.length, rev: progress.rev };
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
    dataOutdated: dataOutdated(),
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
    case 'GET /api/skills':
      return send(res, 200, skillsConfig());
    case 'GET /api/ocr/status': {
      const sel = ocr.selectScreenshots(SHOTS_DIR);
      return send(res, 200, {
        dir: SHOTS_DIR, available: sel.available, ...(await ocr.engines()), engine: progress.settings.ocrEngine || 'auto', running: !!ocrRunning,
        total: sel.all.length, inRaid: sel.all.length - sel.usable.length, day: sel.day, selected: sel.selected.map((x) => x.name),
      });
    }
    case 'POST /api/ocr/run': {
      if (ocrRunning) return send(res, 409, { error: 'already reading screenshots' });
      ocrRunning = runOcr().finally(() => { ocrRunning = null; });
      const result = await ocrRunning;
      return send(res, result.error ? 400 : 200, result);
    }
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
      const viaBrowser = /via browser/.test(body.meta?.source || '');
      gameData = { meta: { source: 'import', fetchedAt: new Date().toISOString(), ...(body.meta || {}), dataVersion: body.meta?.dataVersion || (viaBrowser ? DATA_VERSION : 1) }, tasks: body.tasks, hideout: body.hideout, prestige: body.prestige || [] };
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
    case 'POST /api/progress/fresh-start': {
      // Wipe, profile reset or prestige: quests, hideout and level start over; only logs from now count.
      const { rev, prestige, custom } = progress;
      const settings = { ...progress.settings, playerLevel: 1, logsSince: new Date().toISOString() };
      progress = Object.assign(emptyProgress(), { settings, rev, prestige, custom });
      rebuildFromLogs();
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
  if (dataIsStale()) refreshGameData(!gameData ? 'no cached data' : dataOutdated() ? 'cached data is from an older tracker version' : 'cache older than REFRESH_HOURS');
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
