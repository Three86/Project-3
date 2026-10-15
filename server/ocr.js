'use strict';
// Reads skill levels (and the PMC level, when shown) from in-game screenshots using an AI OCR model
// (RapidOCR, see ocr_ai.py) and/or the Tesseract OCR command line tool. Screenshots taken in raid
// have the player position in their file name and are skipped; of the rest only the most recent
// day's screenshots are used.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const os = require('os');

// Optional: enlarge small screenshots before OCR (Tesseract misreads text under ~20 px tall).
let sharp = null;
try { sharp = require('sharp'); } catch { /* not installed: read at native size only */ }

const IMAGE_RE = /\.(png|jpe?g|bmp|webp|tiff?)$/i;
// In-raid screenshots: "2024-06-08[19-02]_-283.66, 0.85, 103.09_0.01, 0.83, -0.02, 0.55_17.62 (0).png"
const COORDS_RE = /-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+/;
const NAME_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})\[(\d{2})-(\d{2})\]/;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Smallest edit distance between `pattern` and any substring of `text` (Sellers' algorithm), so
// OCR slips like "pmrs" for "dmrs" or "aimoritts" for "aimdrills" still match.
function substringDistance(pattern, text) {
  let prev = new Array(text.length + 1).fill(0);
  for (let i = 1; i <= pattern.length; i++) {
    const cur = [i];
    for (let j = 1; j <= text.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (pattern[i - 1] === text[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev);
}
// Allowed OCR errors per name length: none for very short names, then about one in three letters.
// Names only count when they sit right above a "Level: N" line, which keeps this tolerance safe.
const allowedErrors = (len) => (len < 4 ? 0 : len < 6 ? 1 : Math.floor(len / 3));

function tesseractAvailable() {
  return new Promise((resolve) => execFile('tesseract', ['--version'], (err) => resolve(!err)));
}

// Screenshot file info: local date (YYYY-MM-DD) and time, taken from the file name when possible.
function describe(dir, name) {
  const file = path.join(dir, name);
  const st = fs.statSync(file);
  const m = name.match(NAME_DATE_RE);
  const time = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : st.mtimeMs;
  const d = new Date(time);
  const day = m ? `${m[1]}-${m[2]}-${m[3]}` : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { name, file, time, day, hasCoords: COORDS_RE.test(name) };
}

// All usable screenshots plus the ones that would be processed (newest day only).
function selectScreenshots(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => IMAGE_RE.test(n));
  } catch {
    return { available: false, all: [], usable: [], selected: [], day: null };
  }
  const all = names.map((n) => describe(dir, n));
  const usable = all.filter((s) => !s.hasCoords);
  const day = usable.reduce((best, s) => (!best || s.day > best ? s.day : best), null);
  const selected = usable.filter((s) => s.day === day).sort((a, b) => a.time - b.time);
  return { available: true, all, usable, selected, day };
}

function runTesseract(file) {
  return new Promise((resolve, reject) => {
    execFile('tesseract', [file, 'stdout', '--psm', '11', 'tsv'], { maxBuffer: 32 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').pop()));
      else resolve(stdout);
    });
  });
}

// Tesseract TSV -> text lines with bounding boxes.
function tsvLines(tsv) {
  const lines = new Map();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue; // level 5 = word
    const text = c[11].trim();
    if (!text) continue;
    const [left, top, width, height] = c.slice(6, 10).map(Number);
    const key = `${c[2]}.${c[3]}.${c[4]}`; // block.paragraph.line
    const l = lines.get(key) || { words: [], left: Infinity, top: Infinity, right: 0, bottom: 0 };
    l.words.push(text);
    (l.wordBoxes ||= []).push({ text, left, top, width, height });
    l.left = Math.min(l.left, left);
    l.top = Math.min(l.top, top);
    l.right = Math.max(l.right, left + width);
    l.bottom = Math.max(l.bottom, top + height);
    lines.set(key, l);
  }
  return [...lines.values()].map((l) => ({ ...l, text: l.words.join(' '), height: l.bottom - l.top }));
}

// The skills page lists skills in a fixed order, two per row (left, right). When a "Level: N" is
// readable but its skill name is not, work the skill out from a known skill in the same row
// (left = index - 1 of the right one) and check it against the nearest known skill in the same
// column (two indexes per row). Skipped when the checks disagree or the page might be filtered.
function inferFromLayout(unpaired, placed, skills, found, maxSkillLevel) {
  const inferred = [];
  if (!placed.length) return inferred;
  const h = Math.max(10, ...placed.map((p) => p.height));
  const sameRow = (a, b) => Math.abs(a.top - b.top) < 1.5 * h;
  const sameCol = (a, b) => Math.abs(a.left - b.left) < 6 * h;
  // Row height, from two known levels in the same column (each row holds two skills).
  const pitches = [];
  for (const a of placed) for (const b of placed) {
    const rows = (b.index - a.index) / 2;
    if (sameCol(a, b) && rows >= 1 && Number.isInteger(rows)) pitches.push((b.top - a.top) / rows);
  }
  const pitch = pitches.length ? pitches.sort((x, y) => x - y)[Math.floor(pitches.length / 2)] : null;
  // A known pair in one row must be (i, i+1), i.e. the layout really is the unfiltered list.
  for (const a of placed) for (const b of placed) {
    if (a !== b && sameRow(a, b) && a.left < b.left && b.index !== a.index + 1) return inferred;
  }
  for (const lv of unpaired) {
    if (lv.level > maxSkillLevel) continue;
    const partner = placed.find((p) => sameRow(p, lv) && !sameCol(p, lv));
    let idx = partner ? partner.index + (partner.left < lv.left ? 1 : -1) : null;
    const vertical = pitch ? placed.filter((p) => sameCol(p, lv)).sort((a, b) => Math.abs(a.top - lv.top) - Math.abs(b.top - lv.top))[0] : null;
    const fromVertical = vertical ? vertical.index + 2 * Math.round((lv.top - vertical.top) / pitch) : null;
    if (idx == null) idx = fromVertical;
    else if (fromVertical != null && fromVertical !== idx) continue; // disagreement: don't guess
    const sk = idx != null ? skills[idx] : null;
    if (!sk || sk.id in found) continue;
    found[sk.id] = lv.level;
    lv.inferred = true;
    placed.push({ ...lv, index: idx });
    inferred.push(sk.id);
  }
  return inferred;
}

// skills: [{ id, name, aliases? }] in in-game order. Returns { skills: { id: level }, inferred, unpairedLevels }.
function extractLevels(lines, skills, { maxSkillLevel = 51 } = {}) {
  const names = skills
    .flatMap((sk) => [sk.name, ...(sk.aliases || [])].map((n) => ({ id: sk.id, key: norm(n) })))
    .filter((n) => n.key.length >= 3)
    .sort((a, b) => b.key.length - a.key.length); // longest first: "Heavy Machine Guns" before "Machine"
  const nameLines = [];
  const levelLines = [];
  for (const l of lines) {
    // "Level: 6", also as misread by OCR: "Lever 6", "Levek 8", "Levei: 6", "Leve1 6", "LeveI: 6".
    // The number may contain look-alike letters ("Level: B" for 8, "Level: O" for 0).
    const lv = l.text.match(/\b[l1i|]ev[e3c][a-z1|!]?\b\s*[:;.,]?\s*([\dOoBSIl|]{1,3})(?![a-z])/i);
    let digits = lv && lv[1].replace(/[Oo]/g, '0').replace(/B/g, '8').replace(/S/g, '5').replace(/[Il|]/g, '1');
    // An impossible value from a doubled character ("8B" -> 88): keep only the real leading digits.
    if (lv && Number(digits) > maxSkillLevel && /^\d+/.test(lv[1])) digits = lv[1].match(/^\d+/)[0];
    if (lv && /^\d+$/.test(digits)) { levelLines.push({ ...l, level: Number(digits) }); continue; }
    const k = norm(l.text);
    if (k.length < 3) continue;
    let hit = names.find((n) => k.includes(n.key));
    if (!hit) {
      // Fuzzy: best-scoring name within its error allowance (ties go to the longer name).
      let best = null;
      for (const n of names) {
        if (k.length < n.key.length - allowedErrors(n.key.length)) continue;
        const d = substringDistance(n.key, k);
        if (d <= allowedErrors(n.key.length) && (!best || d / n.key.length < best.score)) best = { n, score: d / n.key.length };
      }
      hit = best?.n;
    }
    if (hit) nameLines.push({ ...l, id: hit.id });
  }
  const used = new Set();
  const found = {};
  const unpaired = [];
  const placed = []; // level lines whose skill is known, with the skill's index in game order
  const order = new Map(skills.map((sk, i) => [sk.id, i]));
  for (const lv of levelLines.sort((a, b) => a.top - b.top)) {
    // The skill name sits just above its "Level: N" line, starting at about the same x.
    let best = null;
    for (const n of nameLines) {
      if (used.has(n)) continue;
      const dy = lv.top - n.bottom;
      const lineH = Math.max(lv.height, n.height, 10);
      if (dy < -lineH / 2 || dy > lineH * 6) continue;
      if (Math.abs(n.left - lv.left) > lineH * 6) continue;
      if (!best || dy < best.dy) best = { n, dy };
    }
    if (best && lv.level <= maxSkillLevel) {
      used.add(best.n);
      found[best.n.id] = lv.level;
      placed.push({ ...lv, index: order.get(best.n.id) });
    } else unpaired.push(lv);
  }
  const inferred = inferFromLayout(unpaired, placed, skills, found, maxSkillLevel);
  const heights = levelLines.map((l) => l.height).sort((a, b) => a - b);
  const textHeight = heights.length ? heights[Math.floor(heights.length / 2)] : null;
  return { skills: found, inferred, textHeight, characterLevel: null, unpairedLevels: unpaired.filter((l) => !l.inferred).map((l) => l.text) };
}

// ---------- OCR engines ----------
// Each reader offers lines(file) -> text lines with boxes (the shape tsvLines returns) and
// digits(file, box) -> digits read from one rectangle. Everything after that is engine-neutral.

// Tesseract on one rectangle of the image, digits only. Uses a .uzn zone file next to a temporary
// copy of the screenshot (the screenshot folder itself is mounted read-only).
async function readDigitsInBox(file, box) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ocr-'));
  try {
    const copy = path.join(dir, `shot${path.extname(file)}`);
    fs.copyFileSync(file, copy);
    fs.writeFileSync(path.join(dir, 'shot.uzn'), `${box.map((n) => Math.max(0, Math.round(n))).join(' ')} Text\n`);
    const out = await new Promise((resolve, reject) => execFile('tesseract', [copy, 'stdout', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789'], { timeout: 60000 }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
    return out.trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const tesseractReader = {
  name: 'tesseract',
  lines: async (file) => tsvLines(await runTesseract(file)),
  digits: readDigitsInBox,
  enlargeFactors: [[2, 'lanczos3'], [2.5, 'cubic']],
  enlargeWhenSmall: true,
};

// AI engine: RapidOCR (PaddleOCR models on ONNX Runtime, CPU) in a Python sidecar, see ocr_ai.py.
const AI_PYTHON = process.env.OCR_AI_PYTHON || 'python3';
const AI_SCRIPT = path.join(__dirname, 'ocr_ai.py');
let aiAvailableCache;
function aiAvailable() {
  if (aiAvailableCache !== undefined) return Promise.resolve(aiAvailableCache);
  return new Promise((resolve) => execFile(AI_PYTHON, ['-c', 'import rapidocr_onnxruntime'], { timeout: 60000 }, (err) => resolve((aiAvailableCache = !err))));
}

async function engines() {
  const [ai, tesseract] = await Promise.all([aiAvailable(), tesseractAvailable()]);
  return { ai, tesseract };
}

// One sidecar process per OCR run: the model loads once, then answers one JSON request per line.
function startAi() {
  const proc = spawn(AI_PYTHON, [AI_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let nextId = 1;
  let buf = '';
  let stderr = '';
  let readyResolve, readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  const timer = setTimeout(() => readyReject(new Error('AI OCR did not start within 120 s')), 120000);
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'ready') { clearTimeout(timer); readyResolve(); continue; }
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.lines);
    }
  });
  const fail = (err) => {
    clearTimeout(timer);
    readyReject(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  proc.on('error', fail);
  proc.on('exit', (code) => fail(new Error(`AI OCR stopped (exit ${code}) ${stderr.trim().split('\n').pop() || ''}`.trim())));
  const request = (req) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    proc.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
  });
  return {
    ready,
    request,
    stop: () => { try { proc.stdin.end(); proc.kill(); } catch { /* already gone */ } },
  };
}

// AI results are whole text lines ("current: 312 146"); split them into words with estimated boxes
// so the word-level logic (labels, numbers after labels) works the same as with Tesseract.
function aiLines(raw) {
  return (raw || []).map((l) => {
    const text = String(l.text || '').replace(/:(?=\S)/g, ': ').trim();
    const charW = l.width / Math.max(1, text.length);
    const wordBoxes = [];
    let pos = 0;
    for (const w of text.split(/\s+/)) {
      if (!w) continue;
      const at = text.indexOf(w, pos);
      wordBoxes.push({ text: w, left: Math.round(l.left + at * charW), top: l.top, width: Math.round(w.length * charW), height: l.height });
      pos = at + w.length;
    }
    return { text, left: l.left, top: l.top, right: l.left + l.width, bottom: l.top + l.height, height: l.height, wordBoxes, score: l.score };
  });
}

function aiReader(session) {
  return {
    name: 'ai',
    lines: async (file) => aiLines(await session.request({ file })),
    // Text in the crop, left to right (the big level number; the emblem beside it reads as nothing).
    digits: async (file, box) => (await session.request({ file, box })).sort((a, b) => a.left - b.left).map((l) => l.text).join(' '),
    enlargeFactors: [[2, 'lanczos3']],
    enlargeWhenSmall: false, // reads small text fine; only re-read when the result looks weak
  };
}

// Number written right after a label word on the same line, e.g. "current: 312 146" -> 312146.
function numberAfter(words, label) {
  const h = label.height || 17;
  const after = words
    .filter((w) => w.left > label.left + label.width - 2 && Math.abs(w.top - label.top) < h && w.left - (label.left + label.width) < 30 * h)
    .sort((a, b) => a.left - b.left);
  const groups = [];
  for (const w of after) {
    if (!groups.length && /^\d{4,8}$/.test(w.text)) { groups.push(w.text); break; } // read without separator
    if (!/^\d{1,3}$/.test(w.text) || (groups.length && w.text.length !== 3)) break; // thousands are space-separated
    groups.push(w.text);
  }
  return groups.length ? Number(groups.join('')) : null;
}

// Level for a total amount of XP. levels: [{ level, exp }] where exp is the XP needed to reach that
// level from the one before. If the "remaining" XP was read too, current + remaining must land exactly
// on the next level's threshold; otherwise the table doesn't match this game version and is ignored.
function levelFromXp(levels, xp, remaining) {
  if (!Array.isArray(levels) || !levels.length || !Number.isFinite(xp)) return null;
  const sorted = levels.slice().sort((a, b) => a.level - b.level);
  let total = 0;
  const threshold = new Map();
  for (const l of sorted) { total += Number(l.exp) || 0; threshold.set(l.level, total); }
  let level = null;
  for (const [lv, t] of threshold) if (t <= xp) level = lv;
  if (level == null) return null;
  const next = threshold.get(level + 1);
  if (Number.isFinite(remaining) && next != null && next !== xp + remaining) return { level: null, mismatch: true };
  return { level, nextAt: next };
}

// The character screen header shows "<level> current: 312 146 ... remaining: 4 705 <next level>".
// Three independent readings of the PMC level:
//  - the big number left of "current:", re-read from its own crop (the rank emblem beside it
//    confuses a full-page read),
//  - the next-level number on the right, minus one,
//  - the level that the total XP ("current") corresponds to in the game's XP table.
// The level is used when at least two agree, or when only one could be read.
async function readCharacterLevel(file, lines, { maxCharacterLevel = 79, playerLevels, digits = readDigitsInBox } = {}) {
  const words = lines.flatMap((l) => l.wordBoxes || []);
  const current = words.find((w) => /^current:?$/i.test(w.text));
  if (!current) return null;
  const h = current.height || 17;
  const box = [current.left - 6.5 * h, current.top - 3.8 * h, 6.2 * h, 5.5 * h];
  const ok = (n) => Number.isFinite(n) && n >= 1 && n <= maxCharacterLevel;
  const crop = Number(String(await digits(file, box)).replace(/\D/g, '')) || null;
  const remainingWord = words.find((w) => /^remain/i.test(w.text));
  const right = remainingWord ? words
    .filter((w) => /^\d{1,2}$/.test(w.text) && w.left > remainingWord.left + remainingWord.width && w.top > current.top - 5 * h && w.top < current.top + h)
    .map((w) => Number(w.text))
    .find((n) => n >= 2 && n <= maxCharacterLevel + 1) : null;
  const xp = numberAfter(words, current);
  const remaining = remainingWord ? numberAfter(words, remainingWord) : null;
  const fromXp = xp != null ? levelFromXp(playerLevels, xp, remaining) : null;

  const readings = { number: ok(crop) ? crop : null, nextLevel: right ? right - 1 : null, xp: ok(fromXp?.level) ? fromXp.level : null };
  const values = Object.values(readings).filter((v) => v != null);
  const check = { ...readings, xpValue: xp, xpTableMismatch: !!fromXp?.mismatch, xpTableMissing: !Array.isArray(playerLevels) || !playerLevels.length };
  if (!values.length) return null;
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n >= 2 || values.length === 1) return { level: best, confirmed: n >= 2, agree: n, of: values.length, check };
  return { level: null, check }; // readings disagree: don't guess
}

// The skills page shows a continuous run of the fixed skill order, so a skill far away (in that
// order) from all the others on the same screenshot is an OCR phantom: drop it.
function dropOutliers(found, skills) {
  const order = new Map(skills.map((sk, i) => [sk.id, i]));
  const ids = Object.keys(found).filter((id) => order.has(id)).sort((a, b) => order.get(a) - order.get(b));
  if (ids.length < 3) return found;
  const groups = [[ids[0]]];
  for (let i = 1; i < ids.length; i++) {
    if (order.get(ids[i]) - order.get(ids[i - 1]) <= 4) groups[groups.length - 1].push(ids[i]);
    else groups.push([ids[i]]);
  }
  const keep = new Set(groups.sort((a, b) => b.length - a.length)[0]);
  if (keep.size < 3) return found;
  return Object.fromEntries(Object.entries(found).filter(([id]) => keep.has(id)));
}

async function readPass(reader, file, skills, playerLevels) {
  const lines = await reader.lines(file);
  const result = extractLevels(lines, skills);
  result.skills = dropOutliers(result.skills, skills);
  const ch = await readCharacterLevel(file, lines, { playerLevels, digits: reader.digits }).catch(() => null);
  if (ch) {
    result.characterLevel = ch.level;
    result.levelCheck = { confirmed: !!ch.confirmed, agree: ch.agree, of: ch.of, ...ch.check };
  }
  return result;
}

const SMALL_TEXT_PX = 22;
const looksWeak = (r) => Object.keys(r.skills).length < 6 || r.unpairedLevels.length > 0 || (r.inferred || []).length > 0;

// Combine several reads of the same screenshot: per skill the value most reads agree on wins,
// ties go to the earlier (higher-priority) read; phantoms are dropped again afterwards.
function mergeReads(reads, skills) {
  const votes = {};
  reads.forEach((r, i) => { for (const [id, v] of Object.entries(r.skills)) (votes[id] ||= []).push({ v, i }); });
  const merged = {};
  for (const [id, list] of Object.entries(votes)) {
    const count = new Map();
    for (const { v } of list) count.set(v, (count.get(v) || 0) + 1);
    merged[id] = list.slice().sort((x, y) => count.get(y.v) - count.get(x.v) || x.i - y.i)[0].v;
  }
  const kept = dropOutliers(merged, skills);
  const pick = reads.find((r) => r.levelCheck?.confirmed) || reads.find((r) => r.characterLevel) || reads[0];
  const readDirectly = new Set(reads.flatMap((r) => Object.keys(r.skills).filter((id) => !(r.inferred || []).includes(id))));
  return {
    skills: kept,
    inferred: Object.keys(kept).filter((id) => !readDirectly.has(id)),
    textHeight: reads[reads.length - 1].textHeight,
    characterLevel: pick.characterLevel ?? null,
    levelCheck: pick.levelCheck,
    unpairedLevels: reads[0].unpairedLevels,
  };
}

// One engine: read at native size; if the text is small or the read looks weak, also read enlarged
// copies and let the reads vote.
async function readWith(reader, file, skills, playerLevels) {
  const first = await readPass(reader, file, skills, playerLevels);
  const small = reader.enlargeWhenSmall && (first.textHeight == null || first.textHeight < SMALL_TEXT_PX);
  if (!sharp || (!small && !looksWeak(first))) return { ...first, enlarged: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-big-'));
  try {
    const meta = await sharp(file).metadata();
    const reads = [];
    for (const [factor, kernel] of reader.enlargeFactors) {
      const big = path.join(dir, `x${factor}.png`);
      await sharp(file).resize({ width: Math.round(meta.width * factor), kernel }).png().toFile(big);
      reads.push(await readPass(reader, big, skills, playerLevels));
    }
    reads.push(first); // native read: lowest priority on ties
    return { ...mergeReads(reads, skills), enlarged: true };
  } catch {
    return { ...first, enlarged: false };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// engine: 'auto' (AI first, Tesseract joins when the AI read looks weak), 'ai' or 'tesseract'.
// ai: a running AI session from startAi() (required for 'auto'/'ai' to use the AI engine).
async function readScreenshot(file, skills, { playerLevels, engine = 'auto', ai = null } = {}) {
  const useAi = ai && engine !== 'tesseract';
  if (!useAi) return { ...(await readWith(tesseractReader, file, skills, playerLevels)), engines: ['tesseract'] };
  const fromAi = await readWith(aiReader(ai), file, skills, playerLevels);
  if (engine === 'ai' || !looksWeak(fromAi)) return { ...fromAi, engines: ['ai'] };
  const fromTesseract = await readWith(tesseractReader, file, skills, playerLevels).catch(() => null);
  if (!fromTesseract) return { ...fromAi, engines: ['ai'] };
  // AI first: it wins ties; Tesseract fills in what the AI missed.
  return { ...mergeReads([fromAi, fromTesseract], skills), enlarged: fromAi.enlarged || fromTesseract.enlarged, engines: ['ai', 'tesseract'] };
}

module.exports = { aiLines, engines, startAi, aiAvailable, dropOutliers, levelFromXp, numberAfter, substringDistance, selectScreenshots, readScreenshot, extractLevels, tsvLines, tesseractAvailable, COORDS_RE };
