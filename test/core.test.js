'use strict';
// The browser core (public/core) and module logic (public/modules/*/logic.js) are headless ES modules,
// so they run in Node against the UI fixture data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const FIX = path.join(__dirname, 'fixtures', 'ui');
const load = (rel) => import(path.join(PUBLIC, rel));
const DEBUT = '5936d90786f7742b1420ba5b';
const CHECKING = '59674cd986f7744ab26e32f2';

let store, game;
// Fresh copy of the fixture state before each test; progress writes are captured instead of sent.
let posted;
async function reset() {
  store ||= await load('core/store.js');
  game ||= await load('core/game.js');
  const { S } = store;
  S.data = JSON.parse(fs.readFileSync(path.join(FIX, 'gamedata.json'), 'utf8'));
  S.progress = JSON.parse(fs.readFileSync(path.join(FIX, 'progress.json'), 'utf8'));
  S.skills = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'skills.json'), 'utf8'));
  S.status = {};
  game.buildIndex();
  posted = [];
  globalThis.fetch = async (url, opts) => {
    posted.push(...JSON.parse(opts.body).ops);
    return { ok: true, status: 200, json: async () => ({ rev: 1 }) };
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const defaults = { tab: 'quests' };
  for (const id of fs.readdirSync(path.join(PUBLIC, 'modules'))) Object.assign(defaults, (await load(`modules/${id}/logic.js`)).uiDefaults);
  store.initUi('test', defaults);
  return S;
}

test('quest status: prerequisites, implied completion and start-with-prereqs', async () => {
  const S = await reset();
  const progress = await load('core/progress.js');
  assert.strictEqual(game.taskStatus(DEBUT), 'available');
  assert.strictEqual(game.taskStatus(CHECKING), 'locked', 'Checking needs Debut completed');
  await progress.startWithPrereqs(CHECKING);
  assert.deepStrictEqual(posted.map((o) => [o.id, o.value]), [[DEBUT, 'completed'], [CHECKING, 'active']]);
  assert.strictEqual(game.taskStatus(CHECKING), 'active');
  // Only Checking marked active: Debut counts as completed because Checking requires it.
  delete S.progress.tasks[DEBUT];
  game.resetMemo();
  assert.strictEqual(game.taskStatus(DEBUT), 'completed');
});

test('requirement counter clamps between 0 and the target', async () => {
  const S = await reset();
  const { stepRequirement } = await load('core/progress.js');
  await stepRequirement('objectives', 'o1', 1, 5);
  await stepRequirement('objectives', 'o1', -3, 5);
  assert.strictEqual(S.progress.objectives.o1, undefined, 'below zero stores nothing');
  S.progress.objectives.o1 = true; // old checkbox value = complete
  await stepRequirement('objectives', 'o1', 1, 5);
  assert.deepStrictEqual(posted.map((o) => o.value), [1, 0, 5]);
});

test('hideout: building a level builds lower ones, unbuilding removes higher ones', async () => {
  const S = await reset();
  const hideout = await load('modules/hideout/logic.js');
  await hideout.setBuilt('gen2', true);
  assert.deepStrictEqual(posted.filter((o) => o.section === 'hideout').map((o) => [o.id, o.value]), [['gen1', true], ['gen2', true]]);
  assert.strictEqual(game.builtLevel(game.idx.stations.get('s-gen')), 2);
  posted = [];
  await hideout.setBuilt('gen1', false);
  assert.deepStrictEqual(posted.map((o) => [o.id, o.value]), [['gen1', false], ['gen2', false]]);
  assert.strictEqual(S.progress.hideout.gen1, undefined);
});

test('hideout requirements report items, FIR and other stations', async () => {
  await reset();
  const reqs = game.hideoutReqs(game.idx.levels.get('gen2').level);
  assert.ok(reqs.some((r) => r.kind === 'station' && r.auto), 'station requirement is tracked automatically');
  const gen1 = game.hideoutReqs(game.idx.levels.get('gen1').level);
  assert.deepStrictEqual(gen1.filter((r) => r.kind === 'item').map((r) => [r.item.shortName || r.item.name, r.count, r.fir]), [['Salewa', 2, false], ['Plug', 1, true]]);
});

test('bitcoin farm times match the game (1 and 50 graphics cards)', async () => {
  await reset();
  assert.strictEqual(Math.round(game.bitcoinSeconds(1)), 300000);
  const t = Math.floor(game.bitcoinSeconds(50));
  assert.strictEqual(t, 1 * 86400 + 3 * 3600 + 35 * 60 + 36); // 1d 3h 35m 36s
  const { fmtDurationSec } = await load('core/util.js');
  assert.strictEqual(fmtDurationSec(game.bitcoinSeconds(1)), '3d 11h 20m 00s');
});

test('bitcoin farm: graphics card slots follow the built level and the setting is clamped to them', async () => {
  const S = await reset();
  const farm = S.data.hideout.find((st) => st.id === 's-btc');
  farm.levels.push({ ...farm.levels[0], id: 'btc2', level: 2 }, { ...farm.levels[0], id: 'btc3', level: 3 });
  game.buildIndex();
  const recipes = await load('modules/recipes/logic.js');
  assert.strictEqual(game.maxGpus(), 10);
  await store.setSetting('gpuCount', 40);
  assert.strictEqual(S.progress.settings.gpuCount, 10, 'level 1 holds 10 cards');
  S.progress.hideout.btc2 = true;
  assert.strictEqual(game.maxGpus(), 25);
  await store.setSetting('gpuCount', 40);
  assert.strictEqual(S.progress.settings.gpuCount, 25);
  S.progress.hideout.btc3 = true;
  await store.setSetting('gpuCount', 40);
  assert.strictEqual(recipes.bitcoinInfo().gpus, 40);
  assert.strictEqual(recipes.bitcoinInfo().maxGpus, 50);
  // Unbuilding a level caps the cards used in the numbers without losing the saved count.
  delete S.progress.hideout.btc3;
  assert.strictEqual(recipes.bitcoinInfo().gpus, 25);
  assert.strictEqual(S.progress.settings.gpuCount, 40);
  // Fuel breakdown: Hideout Management 10 (−5%) and Generator level 1 (−10%, ×1.10 from Hideout Management).
  S.progress.hideout.gen1 = true;
  const fuel = recipes.bitcoinInfo().fuel;
  assert.strictEqual(fuel.hmPct, -5);
  assert.ok(Math.abs(fuel.perHour - 4.75 * 0.95 * (1 - 0.1 * 1.1)) < 1e-9, `fuel per hour ${fuel.perHour}`);
  assert.deepStrictEqual(fuel.bonus.from, ['Generator']);
  for (const t of recipes.bitcoinInfo().tanks) assert.ok(Math.abs(t.bitcoins - (t.resource / fuel.perHour) / (recipes.bitcoinInfo().secs / 3600)) < 1e-9);
});

test('recipe stations: pinned recipes first in pin order, the Bitcoin Farm card last', async () => {
  const S = await reset();
  const recipes = await load('modules/recipes/logic.js');
  const cards = recipes.craftStations();
  assert.deepStrictEqual(cards.map((c) => c.st.id), ['s-med', 's-btc']);
  assert.ok(cards[1].farm);
  await recipes.togglePin('s-med', 'cr4');
  await recipes.togglePin('s-med', 'cr1');
  const med = S.data.hideout.find((st) => st.id === 's-med');
  const g = recipes.stationRecipes(med, '', false);
  assert.deepStrictEqual(g.pinned.map((c) => c.id), ['cr4', 'cr1']);
  assert.ok(!g.rest.some((c) => ['cr4', 'cr1'].includes(c.id)), 'pinned recipes are not listed twice');
  assert.strictEqual(recipes.craftStations()[0].pins, 2);
});

test('crafting skill shortens craft times; recipes respect locks and the pin limit', async () => {
  const S = await reset();
  S.progress.skills.Crafting = 20;
  assert.strictEqual(game.craftTimeFactor(), 0.85);
  const recipes = await load('modules/recipes/logic.js');
  const cr2 = S.data.crafts.find((c) => c.id === 'cr2');
  assert.match(recipes.craftLock(cr2), /complete quest: Debut/);
  for (const id of ['cr1', 'cr3', 'cr4', 'cr5', 'cr6']) await recipes.togglePin('s-med', id);
  assert.deepStrictEqual(S.progress.craftPins['s-med'], ['cr1', 'cr3', 'cr4', 'cr5'], `no more than ${recipes.MAX_PINS} pins`);
});

test('overview: weight limits, stamina, food and drain, fuel and filters at your skill levels', async () => {
  const S = await reset();
  const ov = await load('modules/overview/logic.js');
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
  Object.assign(S.progress.skills, { Strength: 12, Endurance: 15, Metabolism: 10, Health: 8, Crafting: 20, HideoutManagement: 10 });
  const s = ov.strength();
  near(s.overweight.now, 26 * 1.048, 'overweight'); near(s.sprint.now, 72 * 1.048, 'sprint limit'); near(s.critical.now, 77 * 1.048, 'critical');
  S.progress.skills.Strength = 51;
  near(ov.strength().carryPct, 30, 'elite: 20% (capped at level 50) + 10%');
  const e = ov.endurance();
  near(e.sprint.base, 115 / 4, 'base sprint time'); near(e.sprint.now, 115 * 1.15 / 4, 'sprint time');
  near(e.refill.now, 115 * 1.15 / (4.5 * 1.15 * 1.25), 'refill standing');
  const m = ov.metabolism();
  near(m.item50, 55, '50 energy item at Metabolism 10');
  near(m.energy.perMin, 3.8 * (1 - 0.048), 'energy drain: Health only'); near(m.hydration.minutes, 100 / (3.2 * 0.952), 'hydration lasts');
  // As measured in game: Health 5 → −3.69 energy and −3.10 hydration per minute.
  Object.assign(S.progress.skills, { Health: 5, Metabolism: 11 });
  assert.deepStrictEqual([ov.metabolism().energy.perMin.toFixed(2), ov.metabolism().hydration.perMin.toFixed(2)], ['3.69', '3.10']);
  const h = ov.hideoutResources();
  const fuelH = 4.75 * 0.95; // Generator not built in the fixture: no fuel bonus
  near(h.fuel.perHour, fuelH, 'fuel per hour');
  assert.deepStrictEqual(h.tanks.map((t) => t.name), ['Metal fuel tank', 'Expeditionary fuel tank']);
  near(h.tanks[0].hours, 100 / fuelH, 'metal tank'); near(h.tanks[1].hours, 60 / fuelH, 'expeditionary tank');
  near(h.air.hours, 300 / (17 * 0.95), 'air filter'); near(h.air.baseHours, 300 / 17, 'air filter base');
  near(h.water.canisters, 100 / (66 * 0.95), 'canisters per water filter'); near(h.water.seconds, 19500 * 0.85, 'time per canister');
  const p = ov.pmc();
  assert.deepStrictEqual([p.faction, p.level, p.image, p.fallback], ['USEC', 30, '/api/images/pmc/usec', 'img/pmc/usec.webp']);
  S.progress.settings.faction = 'BEAR';
  assert.strictEqual(ov.pmc().fallback, 'img/pmc/bear.webp');
  const [kappa, lk] = ov.goals();
  assert.strictEqual(kappa.total, S.data.tasks.filter((t) => t.kappaRequired && (!t.factionName || t.factionName === 'Any' || t.factionName === 'BEAR')).length);
  assert.strictEqual(lk.key, 'lightkeeper');
  S.progress.tasks['5936d90786f7742b1420ba5b'] = { status: 'completed' };
  game.resetMemo();
  assert.strictEqual(ov.goals()[0].done, kappa.done + 1, 'completing a Kappa quest counts');
});

test('prestige: current prestige, custom requirements, achieved mark', async () => {
  const S = await reset();
  const prestige = await load('modules/prestige/logic.js');
  const p = prestige.currentPrestige();
  assert.strictEqual(p.id, 'pr1');
  await prestige.addCustom('pr1', '  Kill 100 PMCs ');
  assert.strictEqual(prestige.customRequirements('pr1')[0][1].text, 'Kill 100 PMCs');
  assert.strictEqual(await prestige.addCustom('pr1', '   '), null, 'blank text is ignored');
  await prestige.setAchieved('pr1', true);
  assert.ok(prestige.isAchieved(p));
  assert.strictEqual(prestige.conditionsDone(p), p.conditions.length, 'achieved counts every condition as met');
  assert.strictEqual(S.ui.prestigeView, null);
});

test('skills: level clamped to the maximum; search finds by effect', async () => {
  const S = await reset();
  const skills = await load('modules/skills/logic.js');
  await skills.setLevel('Strength', 99);
  assert.strictEqual(S.progress.skills.Strength, 51);
  S.ui.sk.text = 'carry weight';
  assert.ok(skills.skillList().some((sk) => sk.id === 'Strength'));
});

test('every module folder has module.json, logic.js (uiDefaults) and a default view with render()', async () => {
  for (const id of fs.readdirSync(path.join(PUBLIC, 'modules'))) {
    const meta = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'modules', id, 'module.json'), 'utf8'));
    assert.ok(meta.title, `${id}: title`);
    const logic = await load(`modules/${id}/logic.js`);
    assert.strictEqual(typeof logic.uiDefaults, 'object', `${id}: uiDefaults`);
    const view = (await load(`modules/${id}/view.js`)).default;
    assert.strictEqual(typeof view.render, 'function', `${id}: render`);
  }
  for (const id of fs.readdirSync(path.join(PUBLIC, 'guis'))) {
    const gui = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'guis', id, 'gui.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(PUBLIC, 'guis', id, gui.entry || 'shell.js')), `${id}: entry file`);
    for (const f of [...(gui.styles || []), ...(gui.scripts || []), ...Object.values(gui.views || {})]) {
      assert.ok(fs.existsSync(path.join(PUBLIC, 'guis', id, f)), `${id}: ${f} exists`);
    }
  }
});

test('loyalty level from quests: the highest level an active or completed quest needs; manual override', async () => {
  const S = await reset();
  const prapor = S.data.traders.find((t) => t.id === 'p');
  const pk = S.data.traders.find((t) => t.id === 'pk');
  let L = game.loyaltyLevel(prapor);
  assert.deepStrictEqual([L.level, L.from, L.next.level, L.next.task.name], [1, null, 2, 'Checking'], 'no quest started: LL1, Checking needs LL2');
  S.progress.tasks[CHECKING] = { status: 'active' };
  game.resetMemo();
  L = game.loyaltyLevel(prapor);
  assert.deepStrictEqual([L.level, L.from.name, L.next.level, L.next.task.name], [2, 'Checking', 3, 'Quest number 4'], 'an active LL2 quest means LL2');
  S.progress.tasks.x4 = { status: 'completed' };
  game.resetMemo();
  assert.strictEqual(game.loyaltyLevel(prapor).level, 3, 'a completed LL3 quest means LL3');
  S.progress.tasks.x4 = { status: 'failed' };
  game.resetMemo();
  assert.strictEqual(game.loyaltyLevel(prapor).level, 2, 'failed quests do not count');
  assert.strictEqual(game.loyaltyLevel(pk).level, 1, 'each trader on its own quests');
  S.progress.settings.playerLevel = 70;
  assert.strictEqual(game.loyaltyLevel(pk).level, 1, 'PMC level does not change it');
  S.progress.settings.loyaltyOverrides = { pk: 4 };
  assert.strictEqual(game.loyaltyLevel(pk).level, 1, 'override ignored while manual levels are off');
  S.progress.settings.loyaltyManual = true;
  L = game.loyaltyLevel(pk);
  assert.deepStrictEqual([L.level, L.auto, L.manual, L.next.level], [4, 1, true, 2]);
  const quests = await load('modules/quests/logic.js');
  await quests.setLoyaltyOverride('pk', 'auto');
  assert.deepStrictEqual(S.progress.settings.loyaltyOverrides, {});
  assert.strictEqual(game.traderStanding, undefined, 'reputation is not worked out any more');
});

test('trader unlock, restock countdown and trader cards', async () => {
  const S = await reset();
  assert.deepStrictEqual([game.traderUnlock('j').unlocked, game.traderUnlock('j').by.name], [false, 'Checking']);
  assert.strictEqual(game.traderUnlock('p').unlocked, true);
  S.progress.tasks[CHECKING] = { status: 'completed' };
  game.resetMemo();
  assert.strictEqual(game.traderUnlock('j').unlocked, true);
  const now = Date.parse('2026-10-20T10:00:00Z');
  S.status.traderResets = { times: { p: '2026-10-20T11:30:15Z', th: '2026-10-20T09:00:00Z' } };
  assert.strictEqual(game.restockIn('p', now), 5415);
  assert.strictEqual(game.restockIn('th', now), 0, 'past restock time = due');
  assert.strictEqual(game.restockIn('s', now), null);
  const quests = await load('modules/quests/logic.js');
  const cards = quests.traderCards();
  assert.deepStrictEqual(cards.map((c) => c.trader.name), ['Prapor', 'Therapist', 'Skier', 'Peacekeeper', 'Jaeger'], 'in-game order, traders without quests (Mr. Kerman) left out');
  assert.ok(game.traderList().some((t) => t.name === 'Mr. Kerman'));
  const p = cards[0];
  assert.strictEqual(p.image, '/api/images/traders/p');
  assert.strictEqual(p.counts.total, 17);
  assert.strictEqual(p.rep, undefined);
});

test('hideout module status and automatic trader requirements', async () => {
  const S = await reset();
  S.progress.settings.playerLevel = 21;
  S.progress.skills.Endurance = 3;
  S.progress.hideout = { gen1: true, med1: true, btc1: true };
  game.resetMemo();
  const st = (id) => game.stationStatus(game.idx.stations.get(id));
  assert.strictEqual(st('s-btc').key, 'max');
  const gen = st('s-gen');
  assert.deepStrictEqual([gen.key, gen.missing, gen.built, gen.max], ['missing', 2, 1, 2], 'Prapor LL2 and the shotgun missing');
  assert.deepStrictEqual([game.stationStatus(game.idx.stations.get('s-gen'), { countItems: false }).missing], [1], 'items left out: only Prapor LL2');
  const trader = gen.reqs.find((r) => r.kind === 'trader');
  assert.deepStrictEqual([trader.auto, trader.done, trader.label], [true, false, 'Prapor loyalty level 2 (yours: LL1)']);
  assert.deepStrictEqual([st('s-med').key, st('s-med').lockedBy.map((r) => r.label)], ['locked', ['Generator level 2']]);
  // Loyalty set by hand + item ticked: ready.
  S.progress.settings.loyaltyManual = true;
  S.progress.settings.loyaltyOverrides = { p: 2 };
  S.progress.hideoutReqs['gen2|item|0'] = true;
  assert.strictEqual(st('s-gen').key, 'ready');
  // Build it: Medstation level 2 is no longer locked; its reputation requirement is a tick of your own.
  const hideout = await load('modules/hideout/logic.js');
  await hideout.stepLevel('s-gen', 1);
  assert.strictEqual(st('s-gen').key, 'max');
  const med = st('s-med');
  assert.strictEqual(med.key, 'missing');
  const rep = med.reqs.find((r) => r.kind === 'trader');
  assert.deepStrictEqual([!!rep.auto, rep.done, rep.label], [false, false, 'Therapist reputation 0.10']);
  await hideout.stepLevel('s-gen', -1);
  assert.strictEqual(S.progress.hideout.gen2, undefined, '− unbuilds the top level');
  assert.strictEqual(await hideout.stepLevel('s-btc', 1), null, 'no level above the max');
});
