'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures', 'json');

test('JSONPath translation handles wildcards, unions and deep scans', () => {
  const { translate } = require('../server/tarkovjson');
  const file = {
    data: { tasks: { a: { name: 'k1', objectives: [{ description: 'k2', x: { bodyParts: ['k3'] } }], finishRewards: [{ customization: [{ name: 'k4' }] }] } } },
    translations: ['$.data.tasks.*.name', '$.data.tasks.*.objectives[*].description', '$.data.tasks.*.objectives[*]..bodyParts[*]', "$.data.tasks.*['startRewards','finishRewards'][*].customization[*].name"],
  };
  const out = translate(file, { k1: 'Name', k2: 'Desc', k3: 'Head', k4: 'Cap' });
  assert.strictEqual(out.tasks.a.name, 'Name');
  assert.strictEqual(out.tasks.a.objectives[0].description, 'Desc');
  assert.deepStrictEqual(out.tasks.a.objectives[0].x.bodyParts, ['Head']);
  assert.strictEqual(out.tasks.a.finishRewards[0].customization[0].name, 'Cap');
});

test('loads and normalises the json.tarkov.dev feed', async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, decodeURIComponent(req.url));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  process.env.TARKOV_JSON_URL = `http://localhost:${server.address().port}/`;
  delete require.cache[require.resolve('../server/tarkovjson')];
  const { fetchGameDataJson } = require('../server/tarkovjson');
  try {
    const d = await fetchGameDataJson({ log: () => {} });
    const debut = d.tasks.find((t) => t.name === 'Debut');
    assert.ok(debut);
    assert.deepStrictEqual(debut.trader, { id: '54cb50c76803fa8b248b4571', name: 'Prapor' });
    assert.strictEqual(debut.objectives[0].description, 'Eliminate 5 Scavs');
    assert.deepStrictEqual(debut.objectives[0].targetNames, ['Scav']);
    assert.strictEqual(debut.objectives[0].usingWeapon[0].shortName, 'SV-98');
    assert.strictEqual(debut.objectives[0].wearing[0][0].shortName, '6B43');
    assert.strictEqual(debut.objectives[1].items[0].name, 'MP-133 12ga shotgun');
    assert.strictEqual(debut.objectives[1].items[0].iconLink, 'https://assets.tarkov.dev/i-mp133-icon.webp');
    assert.strictEqual(debut.objectives[1].foundInRaid, true);
    const checking = d.tasks.find((t) => t.name === 'Checking');
    assert.deepStrictEqual(checking.map, { id: 'm-customs', name: 'Customs' });
    assert.deepStrictEqual(checking.taskRequirements, [{ task: { id: '5936d90786f7742b1420ba5b', name: 'Debut' }, status: ['complete'] }]);
    assert.strictEqual(checking.objectives[0].questItem.name, 'Bronze pocket watch');
    assert.deepStrictEqual(checking.objectives[0].zoneNames, ['Crossroads']);
    assert.strictEqual(checking.objectives[1].markerItem.shortName, 'MS2000');
    assert.deepStrictEqual(checking.objectives[2].skillLevel, { name: 'Strength', level: 5 });
    assert.strictEqual(checking.objectives[3].task.name, 'Debut');
    const gen = d.hideout.find((s) => s.name === 'Generator');
    const l1 = gen.levels[0];
    assert.strictEqual(l1.itemRequirements[0].item.shortName, 'MP-133');
    assert.deepStrictEqual(l1.itemRequirements[0].attributes, [{ type: 'foundInRaid', name: 'foundInRaid', value: 'true' }]);
    assert.deepStrictEqual(l1.stationLevelRequirements, [{ station: { id: 's-med', name: 'Medstation' }, level: 1 }]);
    assert.deepStrictEqual(l1.skillRequirements, [{ name: 'Endurance', level: 2 }]);
    assert.deepStrictEqual(l1.bonuses.map((b) => [b.type, b.name, b.value, b.skillName]), [['FuelConsumption', 'Fuel consumption', -0.1, undefined], ['SkillGroupLevelingBoost', 'Skill leveling', 0.05, 'Physical']]);
    assert.deepStrictEqual(l1.traderRequirements, [
      { trader: { id: '54cb50c76803fa8b248b4571', name: 'Prapor' }, level: 2, requirementType: 'loyaltyLevel', compareMethod: '>=', value: 2 },
      { trader: { id: '54cb50c76803fa8b248b4571', name: 'Prapor' }, level: 0.2, requirementType: 'reputation', compareMethod: '>=', value: 0.2 },
    ]);
    assert.strictEqual(gen.imageLink, 'https://assets.tarkov.dev/station-generator.png');
    assert.strictEqual(l1.description, 'desc-gen1');
    assert.strictEqual(d.prestige[0].name, 'Prestige 1');
    const p2 = d.prestige.find((x) => x.name === 'Prestige 2');
    assert.deepStrictEqual(p2.conditions.map((c) => c.type), ['playerLevel', 'skill', 'hideoutStation', 'haveItem']);
    assert.deepStrictEqual(p2.conditions[1].skillLevel, { name: 'Strength', level: 10 });
    assert.deepStrictEqual(p2.conditions[2].hideoutStation, { id: 's-med', name: 'Medstation' });
    assert.strictEqual(p2.conditions[2].stationLevel, 1);
    assert.strictEqual(p2.conditions[3].items[0].name, 'Roubles');
    assert.strictEqual(p2.conditions[3].count, 1000000);
    assert.ok(d.skills.some((sk) => sk.id === 'Strength' && sk.name === 'Strength'));
    assert.strictEqual(d.skills.find((sk) => sk.id === 'Endurance').imageLink, 'https://assets.tarkov.dev/skill-strength.png');
    const [c1, c2] = d.crafts;
    assert.deepStrictEqual(c1.station, { id: 's-med', name: 'Medstation' });
    assert.deepStrictEqual(c1.requiredItems.map((r) => [r.item.shortName, r.count, r.tool]), [['MP-133', 2, false], ['MS2000', 1, true]]);
    assert.deepStrictEqual(c1.rewardItems.map((r) => [r.item.shortName, r.count]), [['Salewa', 1]]);
    assert.deepStrictEqual(c2.taskUnlock, { id: '5936d90786f7742b1420ba5b', name: 'Debut' });
    assert.ok(!d.skills.some((sk) => sk.id === 'Melee'));
    assert.strictEqual(d.prestige[0].conditions[1].items[0].shortName, 'MP-133');
    // Trader reputation rewards and unlocks per quest; traders with loyalty levels and restock time.
    assert.deepStrictEqual(debut.finishRewards.traderStanding, [{ trader: { id: '54cb50c76803fa8b248b4571', name: 'Prapor' }, standing: 0.02 }]);
    assert.strictEqual(debut.failureOutcome.traderStanding[0].standing, -0.05);
    assert.strictEqual(debut.startRewards, undefined);
    assert.deepStrictEqual(checking.finishRewards.traderUnlock, [{ id: '5c0647fdd443bc2504c2d371', name: 'Jaeger' }]);
    const prapor = d.traders.find((t) => t.name === 'Prapor');
    assert.strictEqual(prapor.image4xLink, 'https://assets.tarkov.dev/prapor-4x.webp');
    assert.strictEqual(prapor.resetTime, '2026-10-20T12:00:00.000Z');
    assert.deepStrictEqual(prapor.levels.map((l) => [l.level, l.requiredPlayerLevel, l.requiredReputation]), [[1, 1, 0], [2, 15, 0.2]]);
    assert.deepStrictEqual(d.traders.find((t) => t.name === 'Jaeger').levels, []);
  } finally {
    server.close();
  }
});
