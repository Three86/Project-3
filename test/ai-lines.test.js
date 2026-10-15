'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { aiLines, numberAfter } = require('../server/ocr');

test('AI line results become word boxes the shared logic can use', () => {
  const [line] = aiLines([{ text: 'remaining:4705', left: 1000, top: 80, width: 140, height: 20, score: 0.9 }]);
  assert.strictEqual(line.text, 'remaining: 4705');
  assert.deepStrictEqual(line.wordBoxes.map((w) => w.text), ['remaining:', '4705']);
  assert.ok(line.wordBoxes[1].left > line.wordBoxes[0].left);
  assert.strictEqual(line.bottom, 100);
  // "remaining: 4705" (no thousands separator) is read as one number
  assert.strictEqual(numberAfter(line.wordBoxes, line.wordBoxes[0]), 4705);
});
