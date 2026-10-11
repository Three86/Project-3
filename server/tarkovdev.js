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
`;
const OBJECTIVE_MIN = `__typename id type description optional maps { id name }`;

const tasksQuery = (args, obj) => `{
  tasks(${args}) {
    id name wikiLink minPlayerLevel kappaRequired lightkeeperRequired factionName
    trader { id name } map { id name }
    taskRequirements { task { id name } status }
    objectives { ${obj} }
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
    }
  }
}`;

const prestigeQuery = (args, obj) => `{
  prestige(${args}) { id name prestigeLevel conditions { ${obj} } }
}`;

async function gql(query) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`tarkov.dev responded HTTP ${res.status}`);
  const body = await res.json();
  if (!body.data || Object.values(body.data).every((v) => v == null)) {
    const msg = (body.errors || []).map((e) => e.message).join('; ') || 'empty response';
    throw new Error(msg);
  }
  return { data: body.data, warnings: (body.errors || []).map((e) => e.message) };
}

// Try each query variant in order (richest first) and return the first that succeeds.
async function firstWorking(variants, key, log) {
  let lastErr;
  for (const q of variants) {
    try {
      const { data, warnings } = await gql(q);
      warnings.slice(0, 3).forEach((w) => log(`tarkov.dev warning (${key}): ${w}`));
      return data[key] || [];
    } catch (err) {
      lastErr = err;
      log(`tarkov.dev query for ${key} failed, trying fallback: ${err.message}`);
    }
  }
  throw lastErr;
}

async function fetchGameData({ gameMode = 'regular', lang = 'en', log = console.log } = {}) {
  const withMode = `lang: ${lang}, gameMode: ${gameMode}`;
  const noMode = `lang: ${lang}`;
  const tasks = await firstWorking(
    [tasksQuery(withMode, OBJECTIVE_FULL), tasksQuery(noMode, OBJECTIVE_FULL), tasksQuery(noMode, OBJECTIVE_MIN)],
    'tasks', log);
  const hideout = await firstWorking(
    [hideoutQuery(withMode, true), hideoutQuery(noMode, true), hideoutQuery(noMode, false)],
    'hideoutStations', log);
  let prestige = [];
  let prestigeError = null;
  try {
    prestige = await firstWorking(
      [prestigeQuery(withMode, OBJECTIVE_FULL), prestigeQuery(noMode, OBJECTIVE_FULL), prestigeQuery(noMode, OBJECTIVE_MIN)],
      'prestige', log);
  } catch (err) {
    prestigeError = err.message;
  }
  return {
    meta: { source: API_URL, fetchedAt: new Date().toISOString(), gameMode, lang, prestigeError },
    tasks,
    hideout,
    prestige,
  };
}

module.exports = { fetchGameData };
