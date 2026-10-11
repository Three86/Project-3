'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseQuestEvents, LogWatcher } = require('../server/logwatcher');

test('parses quest start/complete notifications', () => {
  const text = `{"message": {"type": 10, "dt": 100, "templateId": "5936d90786f7742b1420ba5b description"}}
{"message": {"type": 12, "dt": 200.5, "templateId": "5936d90786f7742b1420ba5b successMessageText"}}
{"message": {"type": 4, "dt": 300, "templateId": "5936d90786f7742b1420ba5b something"}}`;
  assert.deepStrictEqual(parseQuestEvents(text), [
    { taskId: '5936d90786f7742b1420ba5b', status: 'active', at: 100000 },
    { taskId: '5936d90786f7742b1420ba5b', status: 'completed', at: 200500 },
  ]);
});

test('scans a log folder once and resumes from offsets', () => {
  const got = [];
  const state = { offsets: {} };
  const w = new LogWatcher({ logsDir: path.join(__dirname, 'fixtures', 'logs'), state, onEvents: (e) => got.push(...e) });
  assert.strictEqual(w.scan(), 3);
  assert.deepStrictEqual(got.map((e) => e.status), ['active', 'completed', 'active']);
  assert.strictEqual(w.scan(), 0);
});
