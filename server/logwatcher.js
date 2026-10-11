'use strict';
// Reads Escape from Tarkov's local log files to detect quest starts, failures and completions.
// The game writes trader chat notifications to "...notifications...log" files in its Logs folder.
// Each quest notification carries a message type (10 started, 11 failed, 12 completed) and a
// templateId of the form "<questId> <messageKey>".

const fs = require('fs');
const path = require('path');

const STATUS_BY_TYPE = { 10: 'active', 11: 'failed', 12: 'completed' };
const TEMPLATE_RE = /"templateId"\s*:\s*"([0-9a-f]{24})\s+[^"]*"/g;
const TYPE_RE = /"type"\s*:\s*(\d+)/g;
const DT_RE = /"dt"\s*:\s*(\d+(?:\.\d+)?)/g;

// Return the value of the last match of `re` inside `text`, or null.
function lastMatch(re, text) {
  re.lastIndex = 0;
  let m, last = null;
  while ((m = re.exec(text))) last = m[1];
  return last;
}

// Extract quest events from a chunk of log text.
function parseQuestEvents(text) {
  const events = [];
  TEMPLATE_RE.lastIndex = 0;
  let m;
  while ((m = TEMPLATE_RE.exec(text))) {
    // "type" and "dt" belong to the same message object and precede templateId in the JSON.
    const windowStart = Math.max(0, m.index - 800);
    const before = text.slice(windowStart, m.index);
    const objStart = before.lastIndexOf('"message"');
    const ctx = objStart >= 0 ? before.slice(objStart) : before;
    const type = Number(lastMatch(TYPE_RE, ctx));
    const status = STATUS_BY_TYPE[type];
    if (!status) continue;
    const dt = Number(lastMatch(DT_RE, ctx));
    events.push({ taskId: m[1], status, at: dt ? Math.round(dt * 1000) : null });
  }
  return events;
}

function findLogFiles(root, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory() && depth < 2) findLogFiles(p, depth + 1, out);
    else if (e.isFile() && /notifications.*\.log$/i.test(e.name)) out.push(p);
  }
  return out;
}

class LogWatcher {
  constructor({ logsDir, state, onEvents, log = console.log, intervalMs = 5000 }) {
    this.logsDir = logsDir;
    this.state = state; // { offsets: { [file]: bytes } } – persisted by caller
    this.onEvents = onEvents;
    this.log = log;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastScan = null;
    this.filesSeen = 0;
  }

  get available() {
    try {
      return !!this.logsDir && fs.statSync(this.logsDir).isDirectory();
    } catch {
      return false;
    }
  }

  scan() {
    if (!this.available) return 0;
    // Folder and file names start with a timestamp, so a name sort is chronological.
    const files = findLogFiles(this.logsDir).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    this.filesSeen = files.length;
    const events = [];
    for (const file of files) {
      let size;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      let offset = this.state.offsets[file] || 0;
      if (size < offset) offset = 0; // file was rotated/truncated
      if (size === offset) continue;
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        let text = buf.toString('utf8');
        // Only consume up to the last complete line so half-written JSON is re-read next scan.
        const lastNl = text.lastIndexOf('\n');
        if (lastNl === -1) continue;
        text = text.slice(0, lastNl + 1);
        const fallbackAt = fs.statSync(file).mtimeMs;
        for (const ev of parseQuestEvents(text)) events.push({ ...ev, at: ev.at || fallbackAt, file: path.basename(file) });
        this.state.offsets[file] = offset + Buffer.byteLength(text, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    }
    this.lastScan = new Date().toISOString();
    if (events.length) this.onEvents(events);
    return events.length;
  }

  start() {
    const tick = () => {
      try {
        this.scan();
      } catch (err) {
        this.log(`log scan failed: ${err.message}`);
      }
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = { LogWatcher, parseQuestEvents };
