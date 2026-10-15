'use strict';
// Loads game data from tarkov.dev's static JSON feed (json.tarkov.dev) – the same feed the
// tarkov.dev website uses. Each file is { data, translations: [jsonPath...] }; strings at those
// paths are translation keys resolved via the matching "<file>_<lang>" file. Cross references
// (items, traders, maps, quests) are plain ids and get resolved here into the same shape the
// GraphQL API returns, so the front-end does not care which source was used.

const JSON_URL = (process.env.TARKOV_JSON_URL || 'https://json.tarkov.dev/').replace(/\/?$/, '/');
const HEADERS = { Accept: 'application/json', 'User-Agent': 'tarkov-quest-tracker/1.0 (+self-hosted)' };

async function getJson(path) {
  const res = await fetch(`${JSON_URL}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// ---- minimal JSONPath: $ .key .* [*] [n] ['a','b'] ..key (all that the feed's paths use)
function tokenize(path) {
  const tokens = [];
  const re = /\.\.([A-Za-z_$][\w$]*)|\.([A-Za-z_$][\w$]*)|\.\*|\[\*\]|\[(\d+)\]|\[((?:'[^']*'\s*,?\s*)+)\]/y;
  let i = path.startsWith('$') ? 1 : 0;
  while (i < path.length) {
    re.lastIndex = i;
    const m = re.exec(path);
    if (!m) throw new Error(`unsupported JSONPath ${path}`);
    if (m[1]) tokens.push({ deep: m[1] });
    else if (m[2]) tokens.push({ keys: [m[2]] });
    else if (m[3]) tokens.push({ keys: [m[3]] });
    else if (m[4]) tokens.push({ keys: [...m[4].matchAll(/'([^']*)'/g)].map((x) => x[1]) });
    else tokens.push({ all: true });
    i = re.lastIndex;
  }
  return tokens;
}

// Calls fn(parent, key) for every location matched by the path.
function eachMatch(root, path, fn) {
  const tokens = tokenize(path);
  const walk = (parent, key, ti) => {
    const node = parent[key];
    if (ti === tokens.length) return fn(parent, key);
    if (node == null || typeof node !== 'object') return;
    const t = tokens[ti];
    if (t.all) for (const k of Object.keys(node)) walk(node, k, ti + 1);
    else if (t.keys) for (const k of t.keys) { if (k in node) walk(node, k, ti + 1); }
    else if (t.deep) {
      const visit = (obj) => {
        if (obj == null || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
          if (k === t.deep) walk(obj, k, ti + 1);
          visit(obj[k]);
        }
      };
      visit(node);
    }
  };
  walk({ $: root }, '$', 0);
}

function translate(file, dict) {
  for (const path of file.translations || []) {
    try {
      eachMatch(file, path, (parent, key) => {
        const v = parent[key];
        if (typeof v === 'string' && dict[v] != null) parent[key] = dict[v];
      });
    } catch {
      /* skip paths we cannot evaluate; the raw key stays visible */
    }
  }
  return file.data;
}

async function loadFile(path, lang) {
  const [file, tr] = await Promise.all([getJson(path), getJson(`${path}_${lang}`).catch(() => ({ data: {} }))]);
  return translate(file, tr.data || {});
}

// ---- normalisation into the GraphQL shape
const idOf = (x) => (x && typeof x === 'object' ? x.id : x);
const list = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

function makeResolvers({ items, traders, maps, tasks, questItems, stations }) {
  const item = (x) => {
    const id = idOf(x);
    if (id == null) return null;
    const it = items[id];
    return it ? { id, name: it.name, shortName: it.shortName, iconLink: it.iconLink } : { id, name: x?.name || String(id), shortName: x?.shortName };
  };
  const named = (table) => (x) => {
    const id = idOf(x);
    return id == null ? null : { id, name: table[id]?.name || x?.name || String(id) };
  };
  return {
    item,
    items: (xs) => list(xs).map(item).filter(Boolean),
    trader: named(traders),
    map: named(maps),
    task: named(tasks),
    station: named(stations),
    questItem: (x) => {
      const id = idOf(x);
      const q = questItems[id];
      return id == null ? null : { id, name: q?.name || x?.name || String(id), shortName: q?.shortName };
    },
  };
}

function normObjective(o, R) {
  const out = { ...o, id: o.id, type: o.type, description: o.description || '', optional: !!o.optional };
  out.maps = list(o.maps).map(R.map).filter(Boolean);
  if (o.items) out.items = R.items(o.items);
  if (o.item) out.item = R.item(o.item);
  if (o.markerItem) out.markerItem = R.item(o.markerItem);
  if (o.useAny) out.useAny = R.items(o.useAny);
  if (o.usingWeapon) out.usingWeapon = R.items(o.usingWeapon);
  if (o.wearing) out.wearing = list(o.wearing).map((set) => R.items(set));
  if (o.notWearing) out.notWearing = R.items(o.notWearing);
  if (o.containsAll) out.containsAll = R.items(o.containsAll);
  if (o.questItem) out.questItem = R.questItem(o.questItem);
  if (o.trader) out.trader = R.trader(o.trader);
  if (o.task) out.task = R.task(o.task);
  if (o.station) out.hideoutStation = R.station(o.station); // hideout station level requirement
  if (o.skill || o.skillLevel) out.skillLevel = o.skillLevel || { name: o.skill?.name || o.skill, level: o.level };
  if (o.zones && !o.zoneNames) out.zoneNames = list(o.zones).map((z) => z?.name).filter(Boolean);
  delete out.zones;
  delete out.possibleLocations;
  return out;
}

async function fetchGameDataJson({ gameMode = 'regular', lang = 'en', log = console.log } = {}) {
  const [tasksFile, hideoutFile, itemsFile, tradersFile, mapsFile] = await Promise.all([
    loadFile(`${gameMode}/tasks`, lang),
    loadFile(`${gameMode}/hideout`, lang),
    loadFile(`${gameMode}/items`, lang),
    loadFile(`${gameMode}/traders`, lang),
    loadFile(`${gameMode}/maps`, lang).catch((err) => { log(`json.tarkov.dev maps unavailable: ${err.message}`); return { maps: {} }; }),
  ]);
  const rawTasks = Object.values(tasksFile.tasks || {});
  if (!rawTasks.length) throw new Error('json.tarkov.dev returned no quests');
  const R = makeResolvers({
    items: itemsFile.items || {},
    traders: tradersFile || {},
    maps: mapsFile.maps || {},
    tasks: tasksFile.tasks || {},
    questItems: tasksFile.questItems || {},
    stations: hideoutFile || {},
  });

  const tasks = rawTasks.map((t) => ({
    id: t.id,
    name: t.name,
    wikiLink: t.wikiLink,
    minPlayerLevel: t.minPlayerLevel,
    kappaRequired: t.kappaRequired,
    lightkeeperRequired: t.lightkeeperRequired,
    factionName: t.factionName,
    trader: R.trader(t.trader),
    map: t.map ? R.map(t.map) : null,
    taskRequirements: list(t.taskRequirements).map((r) => ({ task: R.task(r.task), status: r.status })),
    objectives: list(t.objectives).map((o) => normObjective(o, R)),
  }));

  const hideout = Object.values(hideoutFile || {}).map((st) => ({
    id: st.id,
    name: st.name,
    normalizedName: st.normalizedName,
    levels: list(st.levels).map((l) => ({
      id: l.id,
      level: l.level,
      constructionTime: l.constructionTime,
      itemRequirements: list(l.itemRequirements).map((r, i) => ({
        id: r.id || `${l.id}-${i}`,
        item: R.item(r.item),
        count: r.count ?? r.quantity,
        attributes: Array.isArray(r.attributes) ? r.attributes : Object.entries(r.attributes || {}).map(([name, value]) => ({ type: name, name, value: String(value) })),
      })),
      stationLevelRequirements: list(l.stationLevelRequirements).map((r) => ({ station: R.station(r.station), level: r.level })),
      skillRequirements: list(l.skillRequirements).map((r) => ({ name: r.name || r.skill, level: r.level })),
      traderRequirements: list(l.traderRequirements).map((r) => ({ trader: R.trader(r.trader), level: r.level ?? r.value })),
      // Percent bonuses are fractions (0.15 = 15%); slots, stash size and energy reserve are absolute.
      bonuses: list(l.bonuses).map((b) => ({ type: b.type, name: b.name, value: b.value, passive: b.passive, production: b.production, skillName: b.skillName ?? b.skill })),
    })),
  }));

  const prestige = list(tasksFile.prestige).map((p) => ({
    id: p.id,
    name: p.name,
    prestigeLevel: p.prestigeLevel,
    conditions: list(p.conditions).map((o) => normObjective(o, R)),
  }));

  // Skills tarkov.dev considers active in the game (it filters out removed ones like Prone Movement).
  const skills = Object.values(itemsFile.skills || {}).filter((sk) => sk?.id).map((sk) => ({ id: sk.id, name: sk.name }));
  // XP table for this game mode: exp = experience needed to reach that level from the one before.
  const playerLevels = list(itemsFile.playerLevels).filter((l) => l && Number.isFinite(l.level)).map((l) => ({ level: l.level, exp: l.exp }));

  return {
    meta: { source: JSON_URL, fetchedAt: new Date().toISOString(), gameMode, lang, prestigeError: null },
    tasks,
    hideout,
    prestige,
    skills,
    playerLevels,
  };
}

module.exports = { fetchGameDataJson, eachMatch, translate, JSON_URL };
