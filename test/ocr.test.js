'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectScreenshots, extractLevels, substringDistance } = require('../server/ocr');

test('uses only out-of-raid screenshots from the newest day', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  for (const n of [
    '2026-10-14[10-00]_ (0).png', // older day: ignored
    '2026-10-15[20-30]_ (0).png',
    '2026-10-15[21-45]_ (1).jpg',
    '2026-10-16[09-00]_-283.66, 0.85, 103.09_0.01, 0.83, -0.02, 0.55_17.62 (0).png', // in raid: skipped
    'notes.txt',
  ]) fs.writeFileSync(path.join(dir, n), '');
  const sel = selectScreenshots(dir);
  assert.strictEqual(sel.day, '2026-10-15');
  assert.deepStrictEqual(sel.selected.map((s) => s.name), ['2026-10-15[20-30]_ (0).png', '2026-10-15[21-45]_ (1).jpg']);
  assert.strictEqual(sel.all.length - sel.usable.length, 1);
});

test('pairs each "Level: N" with the skill name above it in the same column', () => {
  const line = (text, left, top) => ({ text, left, top, right: left + 200, bottom: top + 20, height: 20 });
  const lines = [
    line('Ph Endurance', 150, 20), line('Ph Strength', 1000, 20),
    line('Level: 3', 150, 90), line('Level: 6', 1000, 90),
    line('@ pmrs', 1000, 200), line('Gaim oritts', 150, 200), // OCR slips
    line('Level: 2', 1000, 270), line('Level: 3', 150, 270),
    line('14.48/40', 700, 90),
  ];
  const skills = [{ id: 'Endurance', name: 'Endurance' }, { id: 'Strength', name: 'Strength' }, { id: 'DMR', name: 'DMRs' }, { id: 'AimDrills', name: 'Aim Drills' }];
  assert.deepStrictEqual(extractLevels(lines, skills).skills, { Endurance: 3, Strength: 6, DMR: 2, AimDrills: 3 });
});

test('fuzzy substring distance', () => {
  assert.strictEqual(substringDistance('dmrs', 'pmrs'), 1);
  assert.strictEqual(substringDistance('strength', 'phstrength'), 0);
});

test('level from total XP, validated by the remaining XP', () => {
  const { levelFromXp } = require('../server/ocr');
  const table = [{ level: 1, exp: 0 }, { level: 2, exp: 1000 }, { level: 3, exp: 2000 }, { level: 4, exp: 3000 }];
  assert.deepStrictEqual(levelFromXp(table, 0), { level: 1, nextAt: 1000 });
  assert.deepStrictEqual(levelFromXp(table, 2999), { level: 2, nextAt: 3000 });
  assert.deepStrictEqual(levelFromXp(table, 3000, 3000), { level: 3, nextAt: 6000 });
  assert.deepStrictEqual(levelFromXp(table, 3000, 2500), { level: null, mismatch: true }); // table from another game version
});

test('reads space-separated numbers after a label', () => {
  const { numberAfter } = require('../server/ocr');
  const w = (text, left) => ({ text, left, top: 170, width: text.length * 10, height: 18 });
  const label = w('current:', 470);
  assert.strictEqual(numberAfter([label, w('312', 575), w('146', 618), w('remain', 1460)], label), 312146);
  assert.strictEqual(numberAfter([label, w('4', 575), w('705', 600)], label), 4705);
});
