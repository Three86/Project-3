'use strict';
// OCR accuracy benchmark (not part of `npm test`).
// Usage: node scripts/ocr-bench.js <folder with screenshots> <truth.json> [auto|ai|tesseract ...]
// truth.json: { "file.png": { "skills": { "Strength": 6, ... }, "pmc": 17 } }
const fs = require('fs');
const path = require('path');
const ocr = require('../server/ocr');

const [dir, truthFile, ...modes] = process.argv.slice(2);
const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
const skills = require('../server/skills.json').skills.map((s) => ({ id: s.id, name: s.name }));
const playerLevels = process.env.XP_TABLE ? JSON.parse(fs.readFileSync(process.env.XP_TABLE, 'utf8')) : undefined;

(async () => {
  const avail = await ocr.engines();
  console.log('engines available:', JSON.stringify(avail));
  for (const mode of modes.length ? modes : ['tesseract', 'ai', 'auto']) {
    if (mode !== 'tesseract' && !avail.ai) { console.log(mode, ': AI engine not available'); continue; }
    const ai = mode === 'tesseract' ? null : ocr.startAi();
    if (ai) await ai.ready;
    let ok = 0, n = 0, phantoms = 0, pmcOk = 0, pmcN = 0, ms = 0;
    for (const [file, t] of Object.entries(truth)) {
      const t0 = Date.now();
      const r = await ocr.readScreenshot(path.join(dir, file), skills, { engine: mode, ai, playerLevels });
      ms += Date.now() - t0;
      const wrong = Object.entries(t.skills).filter(([k, v]) => r.skills[k] !== v).map(([k, v]) => `${k}: ${r.skills[k]}≠${v}`);
      const extra = Object.keys(r.skills).filter((k) => !(k in t.skills));
      n += Object.keys(t.skills).length; ok += Object.keys(t.skills).length - wrong.length; phantoms += extra.length;
      if (t.pmc) { pmcN++; if (r.characterLevel === t.pmc) pmcOk++; }
      if (wrong.length || extra.length || (t.pmc && r.characterLevel !== t.pmc)) console.log(`  ${mode} ${file}: wrong [${wrong}] phantom [${extra}]${t.pmc ? ` pmc ${r.characterLevel}` : ''} engines ${r.engines}`);
      else if (t.pmc) console.log(`  ${mode} ${file}: PMC ${r.characterLevel} ${JSON.stringify(r.levelCheck)}`);
    }
    if (ai) ai.stop();
    console.log(`${mode.padEnd(9)}: ${ok}/${n} skills, ${phantoms} phantoms, PMC ${pmcOk}/${pmcN}, ${Math.round(ms / Object.keys(truth).length)} ms/screenshot`);
  }
})();
