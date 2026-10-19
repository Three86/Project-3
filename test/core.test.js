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

test('needed items add up open requirements per item', async () => {
  const S = await reset();
  const items = await load('modules/items/logic.js');
  const salewa = () => items.neededItems().find((r) => r.item.shortName === 'Salewa');
  const before = salewa();
  assert.ok(before.fir + before.nofir > 0 && before.sources.length > 1);
  S.ui.items.fir = 'fir';
  assert.ok(items.neededItems().every((r) => r.nofir === 0), 'FIR filter leaves only FIR counts');
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

test('trader reputation from quests: start, finish, failure and implied completion', async () => {
  const S = await reset();
  assert.strictEqual(game.traderStanding('p'), 0);
  S.progress.tasks[DEBUT] = { status: 'completed' };
  game.resetMemo();
  assert.strictEqual(game.traderStanding('p'), 0.02);
  // Checking active implies Debut completed; failing Debut instead costs reputation.
  S.progress.tasks = { [CHECKING]: { status: 'completed' } };
  game.resetMemo();
  assert.strictEqual(game.traderStanding('p'), 0.05, 'Debut (implied) + Checking');
  S.progress.tasks = { [DEBUT]: { status: 'failed' } };
  game.resetMemo();
  assert.strictEqual(game.traderStanding('p'), -0.05);
  assert.ok(game.hasStandingData());
});

test('loyalty level: limited by PMC level or reputation, manual override only when switched on', async () => {
  const S = await reset();
  const prapor = S.data.traders.find((t) => t.id === 'p');
  const pk = S.data.traders.find((t) => t.id === 'pk');
  S.progress.settings.playerLevel = 21;
  let L = game.loyaltyLevel(prapor);
  assert.strictEqual(L.level, 1, 'rep 0 < 0.20 needed');
  assert.deepStrictEqual([L.next.level, L.next.repMissing, L.next.playerLevelMissing], [2, 0.2, 0]);
  assert.strictEqual(game.loyaltyLevel(pk).level, 2, 'Peacekeeper LL2 needs no reputation');
  S.progress.settings.playerLevel = 10;
  L = game.loyaltyLevel(pk);
  assert.strictEqual(L.level, 1, 'level 10 < 14 needed');
  assert.strictEqual(L.next.playerLevelMissing, 4);
  S.progress.settings.loyaltyOverrides = { pk: 4 };
  assert.strictEqual(game.loyaltyLevel(pk).level, 1, 'override ignored while manual levels are off');
  S.progress.settings.loyaltyManual = true;
  L = game.loyaltyLevel(pk);
  assert.deepStrictEqual([L.level, L.auto, L.manual, L.next.level], [4, 1, true, 2]);
  const quests = await load('modules/quests/logic.js');
  await quests.setLoyaltyOverride('pk', 'auto');
  assert.deepStrictEqual(S.progress.settings.loyaltyOverrides, {});
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
  assert.deepStrictEqual(cards.map((c) => c.trader.name), ['Prapor', 'Therapist', 'Skier', 'Peacekeeper', 'Jaeger'], 'in-game order');
  const p = cards[0];
  assert.strictEqual(p.image, '/api/images/traders/p');
  assert.strictEqual(p.counts.total, 17);
  assert.strictEqual(p.rep, 0.05);
});
