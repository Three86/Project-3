'use strict';
// Reads skill levels (and the PMC level, when shown) from in-game screenshots using the
// Tesseract OCR command line tool. Screenshots taken in raid have the player position in their
// file name and are skipped; of the rest only the most recent day's screenshots are used.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');

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

// skills: [{ id, name, aliases? }]. Returns { skills: { id: level }, unpairedLevels }.
function extractLevels(lines, skills, { maxSkillLevel = 51 } = {}) {
  const names = skills
    .flatMap((sk) => [sk.name, ...(sk.aliases || [])].map((n) => ({ id: sk.id, key: norm(n) })))
    .filter((n) => n.key.length >= 3)
    .sort((a, b) => b.key.length - a.key.length); // longest first: "Heavy Machine Guns" before "Machine"
  const nameLines = [];
  const levelLines = [];
  for (const l of lines) {
    const lv = l.text.match(/\blev[e3]l\b\s*[:;.]?\s*(\d{1,3})\b/i);
    if (lv) { levelLines.push({ ...l, level: Number(lv[1]) }); continue; }
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
    } else unpaired.push(lv);
  }
  return { skills: found, characterLevel: null, unpairedLevels: unpaired.map((l) => l.text) };
}

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

// The character screen header shows "<level> current: 312 146 ... remaining: 4 705 <next level>".
// Read the big number left of "current:" from its own crop (the rank emblem beside it confuses a
// full-page read) and cross-check it with the next-level number on the right.
async function readCharacterLevel(file, lines, { maxCharacterLevel = 79 } = {}) {
  const words = lines.flatMap((l) => l.wordBoxes || []);
  const current = words.find((w) => /^current:?$/i.test(w.text));
  if (!current) return null;
  const h = current.height || 17;
  const box = [current.left - 6.5 * h, current.top - 3.8 * h, 6.2 * h, 5.5 * h];
  const left = Number((await readDigitsInBox(file, box)).replace(/\D/g, '')) || null;
  // Next level: a number in the same header band, right of "remain(ing)".
  const remaining = words.find((w) => /^remain/i.test(w.text));
  const right = remaining ? words
    .filter((w) => /^\d{1,2}$/.test(w.text) && w.left > remaining.left + remaining.width && w.top > current.top - 5 * h && w.top < current.top + h)
    .map((w) => Number(w.text))
    .find((n) => n >= 2 && n <= maxCharacterLevel + 1) : null;
  const ok = (n) => n && n >= 1 && n <= maxCharacterLevel;
  if (ok(left) && (!right || right === left + 1)) return { level: left, confirmed: right === left + 1 };
  if (!ok(left) && right) return { level: right - 1, confirmed: false };
  return null; // the two numbers disagree: don't guess
}

async function readScreenshot(file, skills) {
  const tsv = await runTesseract(file);
  const lines = tsvLines(tsv);
  const result = extractLevels(lines, skills);
  const ch = await readCharacterLevel(file, lines).catch(() => null);
  if (ch) { result.characterLevel = ch.level; result.characterLevelConfirmed = ch.confirmed; }
  return result;
}

module.exports = { substringDistance, selectScreenshots, readScreenshot, extractLevels, tsvLines, tesseractAvailable, COORDS_RE };
