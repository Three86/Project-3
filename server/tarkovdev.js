'use strict';
// Fetches quest, hideout and prestige definitions from the community tarkov.dev GraphQL API.
// The game client keeps these definitions in binary asset bundles, so they are downloaded once
// and cached under /data; the tracker works offline from that cache afterwards.

const API_URL = process.env.TARKOV_API_URL || 'https://api.tarkov.dev/graphql';

const ITEM = 'id name shortName iconLink';

// Full objective selection. If the live schema rejects any of these fields we fall back to
// OBJECTIVE_MIN so the tracker still works (with descriptions instead of structured details).
const OBJECTIVE_FULL = `
  __typename id type description optional
  maps { id name }
  ... on TaskObjectiveItem { items { ${ITEM} } count foundInRaid dogTagLevel minDurability maxDurability }
  ... on TaskObjectiveShoot { targetNames count zoneNames bodyParts usingWeapon { ${ITEM} } wearing { ${ITEM} } notWearing { ${ITEM} } }
  ... on TaskObjectiveBuildItem { item { ${ITEM} } }
  ... on TaskObjectiveQuestItem { questItem { id name shortName } count }
  ... on TaskObjectiveMark { markerItem { ${ITEM} } }
  ... on TaskObjectiveExtract { exitStatus count }
  ... on TaskObjectiveSkill { skillLevel { name level } }
  ... on TaskObjectivePlayerLevel { playerLevel }
  ... on TaskObjectiveTraderLevel { trader { id name } level }
  ... on TaskObjectiveTaskStatus { task { id name } status }
  ... on TaskObjectiveUseItem { useAny { ${ITEM} } count }
  ... on TaskObjectiveHideoutStation { hideoutStation { id name } stationLevel }
`;
const OBJECTIVE_MIN = `__typename id type description optional maps { id name }`;

// Trader reputation changes per quest (start, finish, failure) and traders a quest unlocks.
const REWARDS = `
    startRewards { traderStanding { trader { id name } standing } }
    finishRewards { traderStanding { trader { id name } standing } traderUnlock { id name } }
    failureOutcome { traderStanding { trader { id name } standing } }`;

const tasksQuery = (args, obj, rewards = true) => `{
  tasks(${args}) {
    id name wikiLink minPlayerLevel kappaRequired lightkeeperRequired factionName
    trader { id name } map { id name }
    taskRequirements { task { id name } status }
    objectives { ${obj} }${rewards ? REWARDS : ''}
  }
}`;

// Traders: portraits, loyalty level requirements and the next restock time.
const tradersQuery = (args) => `{
  traders(${args}) {
    id name normalizedName imageLink image4xLink resetTime
    levels { level requiredPlayerLevel requiredReputation requiredCommerce }
  }
}`;

const hideoutQuery = (args, full) => `{
  hideoutStations(${args}) {
    id name normalizedName
    levels {
      id level constructionTime
      itemRequirements { id item { ${ITEM} } count ${full ? 'attributes { type name value }' : ''} }
      stationLevelRequirements { station { id name } level }
      skillRequirements { name level }
      traderRequirements { trader { id name } level }
      ${full ? 'bonuses { type name value passive production skillName }' : ''}
    }
  }
}`;

const prestigeQuery = (args, obj) => `{
  prestige(${args}) { id name prestigeLevel conditions { ${obj} } }
}`;

const HEADERS = { Accept: 'application/json', 'User-Agent': 'tarkov-quest-tracker/1.0 (+self-hosted)' };

function parseBody(body) {
  if (!body?.data || Object.values(body.data).every((v) => v == null)) {
    const msg = (body?.errors || []).map((e) => e.message).join('; ') || 'empty response';
    throw new Error(msg);
  }
  return { data: body.data, warnings: (body.errors || []).map((e) => e.message) };
}

async function httpError(res) {
  const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim();
  return new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
}

// POST is the normal transport; a POST without our User-Agent and a GET with ?query= are tried
// when it is rejected, since some
// proxies/firewalls in front of the API treat the two differently.
async function gql(query) {
  const errors = [];
  const attempts = [
    () => fetch(API_URL, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(90000) }),
    () => fetch(API_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(90000) }),
    () => fetch(`${API_URL}?query=${encodeURIComponent(query)}`, { headers: HEADERS, signal: AbortSignal.timeout(90000) }),
  ];
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) throw await httpError(res);
      return parseBody(await res.json());
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(uniqueJoin(errors));
}

const uniqueJoin = (msgs) => [...new Set(msgs)].join(' / ');

// Try each query variant in order (richest first) and return the first that succeeds.
async function firstWorking(variants, key, log) {
  const errors = [];
  for (const q of variants) {
    try {
      const { data, warnings } = await gql(q);
      warnings.slice(0, 3).forEach((w) => log(`tarkov.dev warning (${key}): ${w}`));
      return data[key] || [];
    } catch (err) {
      errors.push(err.message);
      log(`tarkov.dev query for ${key} failed, trying fallback: ${err.message}`);
    }
  }
  throw new Error(`${key}: ${uniqueJoin(errors)}`);
}

// Query variants per top-level field, richest first. Also served to the browser so it can
// download the data itself when the server's own requests are blocked.
function queryVariants({ gameMode = 'regular', lang = 'en' } = {}) {
  const withMode = `lang: ${lang}, gameMode: ${gameMode}`;
  const noMode = `lang: ${lang}`;
  return {
    tasks: [tasksQuery(withMode, OBJECTIVE_FULL), tasksQuery(withMode, OBJECTIVE_FULL, false), tasksQuery(noMode, OBJECTIVE_FULL, false), tasksQuery(noMode, OBJECTIVE_MIN, false)],
    traders: [tradersQuery(withMode), tradersQuery(noMode)],
    hideoutStations: [hideoutQuery(withMode, true), hideoutQuery(noMode, true), hideoutQuery(noMode, false)],
    prestige: [prestigeQuery(withMode, OBJECTIVE_FULL), prestigeQuery(noMode, OBJECTIVE_FULL), prestigeQuery(noMode, OBJECTIVE_MIN)],
  };
}

const withModeArgs = (gameMode, lang) => `lang: ${lang}, gameMode: ${gameMode}`;

async function fetchGameData({ gameMode = 'regular', lang = 'en', log = console.log } = {}) {
  const q = queryVariants({ gameMode, lang });
  const tasks = await firstWorking(q.tasks, 'tasks', log);
  const hideout = await firstWorking(q.hideoutStations, 'hideoutStations', log);
  let playerLevels = [];
  try {
    // GraphQL has no per-game-mode XP table; this is the PvP one (the JSON feed has both).
    playerLevels = await firstWorking(['{ playerLevels { level exp } }'], 'playerLevels', log);
  } catch { /* optional: only used to cross-check the PMC level read from screenshots */ }
  let crafts = [];
  try {
    const q = (args) => `{ crafts(${args}) { id station { id name } level duration taskUnlock { id name }
      requiredItems { item { ${ITEM} } count attributes { type name value } } requiredQuestItems { id name }
      rewardItems { item { ${ITEM} } count } } }`;
    const raw = await firstWorking([q(withModeArgs(gameMode, lang)), q(`lang: ${lang}`)], 'crafts', log);
    crafts = raw.map((c) => ({
      ...c,
      requiredItems: (c.requiredItems || []).map((r) => ({ item: r.item, count: r.count, tool: (r.attributes || []).some((a) => a.type === 'tool' && String(a.value) === 'true') })),
    }));
  } catch { /* optional: only the Recipes tab needs it */ }
  let traders = [];
  try {
    traders = await firstWorking(q.traders, 'traders', log);
  } catch { /* optional: only the trader cards need it */ }
  let prestige = [];
  let prestigeError = null;
  try {
    prestige = await firstWorking(q.prestige, 'prestige', log);
  } catch (err) {
    prestigeError = err.message;
  }
  return {
    meta: { source: API_URL, fetchedAt: new Date().toISOString(), gameMode, lang, prestigeError },
    tasks,
    hideout,
    prestige,
    playerLevels,
    crafts,
    traders,
  };
}

// Just the traders' next restock times: { traderId: ISO time }.
async function fetchTraderResets({ gameMode = 'regular', lang = 'en', log = console.log } = {}) {
  const raw = await firstWorking([`{ traders(${withModeArgs(gameMode, lang)}) { id resetTime } }`, `{ traders(lang: ${lang}) { id resetTime } }`], 'traders', log);
  return Object.fromEntries(raw.filter((t) => t?.id && t.resetTime).map((t) => [t.id, t.resetTime]));
}

module.exports = { fetchGameData, fetchTraderResets, queryVariants, API_URL };
