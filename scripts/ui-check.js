#!/usr/bin/env node
// Browser check of every UI feature (Playwright + Chromium). Starts its own tracker server on a copy of
// test/fixtures/ui, clicks through each tab and checks the saved progress ops and the re-rendered page.
// External requests are blocked, so it also proves the UI works offline (Basecoat is self-hosted).
//
//   node scripts/ui-check.js [--shots <dir>] [--only quests,hideout,…]
//
// Needs the `playwright` package (not a dependency of the tracker): NODE_PATH=$(npm root -g) works
// when it is installed globally.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const shots = opt('--shots');
const only = opt('--only')?.split(',');
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;

let failures = 0;
let passes = 0;
const ok = (cond, msg) => {
  if (cond) { passes++; console.log(`  ✓ ${msg}`); } else { failures++; console.log(`  ✗ ${msg}`); }
};

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ui-'));
  for (const f of ['gamedata.json', 'progress.json']) fs.copyFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'ui', f), path.join(dir, f));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, REFRESH_HOURS: '100000', EFT_LOGS_DIR: path.join(dir, 'nologs'), EFT_SCREENSHOTS_DIR: path.join(dir, 'noshots') },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).hasData) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await run();
  } finally {
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  // Offline: anything not served by the tracker itself is blocked.
  const external = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  let ops = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/progress')) ops.push(...JSON.parse(req.postData()).ops);
  });
  const lastOp = () => ops[ops.length - 1];
  const settle = () => page.waitForTimeout(250);
  const tab = async (name) => { await page.click(`#tabs [data-tab="${name}"]`); await settle(); };
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
  const want = (name) => !only || only.includes(name);
  // Each section starts from default filters (saved UI state lives in localStorage 'tt-ui').
  const freshUi = async (tabName) => {
    await page.evaluate((t) => localStorage.setItem('tt-ui', JSON.stringify({ tab: t })), tabName);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#view .loading-skeleton') && document.querySelector('#view').children.length > 0);
  };

  await page.goto(BASE);
  await page.waitForSelector('#view .toolbar');

  // ------------------------------------------------------------ shell
  if (want('shell')) {
    console.log('Shell');
    const css = await page.evaluate(() => [...document.styleSheets].map((s) => s.href).filter(Boolean));
    ok(css.some((h) => h.endsWith('/vendor/basecoat/basecoat.cdn.min.css')), 'Basecoat CSS loaded from the local vendor folder');
    ok(await page.evaluate(() => typeof window.basecoat?.init === 'function'), 'Basecoat JS loaded (window.basecoat)');
    ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'dark mode by default');
    await page.click('[data-act="theme"]');
    ok(await page.evaluate(() => !document.documentElement.classList.contains('dark') && localStorage.getItem('themeMode') === 'light'), 'theme toggle switches to light and saves it');
    await page.reload(); await page.waitForSelector('#view .toolbar');
    ok(await page.evaluate(() => !document.documentElement.classList.contains('dark')), 'light mode remembered after reload');
    await shot('quests-light');
    await page.click('[data-act="theme"]');
    ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'theme toggle back to dark');
    await tab('hideout');
    ok(await page.getAttribute('#tab-hideout', 'aria-selected') === 'true' && await page.locator('[data-hopen]').count() > 0, 'tab click switches view and marks the tab selected');
    await page.reload(); await page.waitForSelector('#view .toolbar');
    ok(await page.getAttribute('#tab-hideout', 'aria-selected') === 'true', 'selected tab remembered after reload');
    await page.focus('#tab-hideout'); await page.keyboard.press('ArrowRight'); await settle();
    ok(await page.getAttribute('#tab-recipes', 'aria-selected') === 'true' && await page.locator('.recipes-station').count() > 0, 'arrow keys move between tabs');
    // command palette
    await page.keyboard.press('Control+k');
    ok(await page.evaluate(() => document.getElementById('cmdk').open), 'Ctrl+K opens the command palette');
    await page.keyboard.type('Shooting Cans'); await page.keyboard.press('Enter'); await settle();
    ok(!(await page.evaluate(() => document.getElementById('cmdk').open)) && await page.getAttribute('#tab-quests', 'aria-selected') === 'true', 'palette: Enter on a quest closes it and opens Quests');
    ok(await page.locator('details[data-open="t3"][open]').count() === 1, 'palette: the chosen quest is shown and expanded');
    await page.click('[data-act="palette"]');
    await page.keyboard.type('Medstation'); await page.keyboard.press('Enter'); await settle();
    ok(await page.getAttribute('#tab-hideout', 'aria-selected') === 'true' && await page.locator('[data-hopen="s-med"][open]').count() === 1, 'palette: station item opens it on the Hideout tab');
    await page.keyboard.press('Control+k'); await page.keyboard.type('salewa');
    ok(await page.locator('#cmdk [data-act="search-all"]').innerText() === 'Search everything for “salewa”', 'palette: search-everything item follows the typed text');
    await page.click('#cmdk [data-act="search-all"]'); await settle();
    ok(await page.getAttribute('#tab-search', 'aria-selected') === 'true' && await page.inputValue('#globalSearch') === 'salewa', 'palette: search everything opens Search with the text');
    await page.keyboard.press('Control+k'); await page.keyboard.press('Escape');
    ok(!(await page.evaluate(() => document.getElementById('cmdk').open)), 'palette closes with Esc');
    // global search
    await page.fill('#globalSearch', ''); await page.type('#globalSearch', 'Plug'); await page.waitForTimeout(400);
    ok(await page.getAttribute('#tab-search', 'aria-selected') === 'true' && await page.locator('.table.items', { hasText: 'Spark plug' }).count() === 1, 'global search box switches to Search and finds items');
  }

  // ------------------------------------------------------------ quests
  if (want('quests')) {
    console.log('Quests');
    await freshUi('quests');
    await page.click('[data-act="qstatus"][data-s="locked"]'); await settle();
    ok(await page.getAttribute('[data-act="qstatus"][data-s="locked"]', 'aria-pressed') === 'true', 'status chip toggles on');
    ok(await page.locator('[data-open="59674cd986f7744ab26e32f2"]').count() === 1, 'locked quest shown once the Locked chip is on');
    await page.selectOption('[data-ui="q.trader"]', 'Jaeger'); await settle();
    ok(/^1 quests$/.test(await page.locator('.toolbar .count').innerText()), 'trader select filters quests');
    await page.selectOption('[data-ui="q.trader"]', ''); await settle();
    await page.check('[data-ui="q.kappa"]'); await settle();
    ok(await page.locator('details.qcard').count() === 2, 'Kappa checkbox filters to Kappa quests');
    await page.uncheck('[data-ui="q.kappa"]'); await settle();
    await page.selectOption('[data-ui="q.map"]', 'Woods'); await settle();
    const woods = await page.locator('details.qcard').count();
    await page.selectOption('[data-ui="q.map"]', ''); await settle();
    ok(woods > 0 && woods < await page.locator('details.qcard').count(), 'map select filters quests');
    await page.selectOption('[data-ui="q.need"]', 'kill'); await settle();
    ok(await page.locator('details.qcard').count() > 0, 'needs select works');
    await page.selectOption('[data-ui="q.need"]', ''); await settle();
    await page.selectOption('[data-ui="q.groupBy"]', 'map'); await settle();
    ok(await page.locator('details.group .group-name', { hasText: 'Woods' }).count() === 1, 'group-by select regroups (by map)');
    await page.selectOption('[data-ui="q.groupBy"]', 'trader'); await settle();
    await page.selectOption('[data-ui="q.sortBy"]', 'name'); await settle();
    ok(await page.inputValue('[data-ui="q.sortBy"]') === 'name', 'sort select keeps its value');
    await page.fill('[data-ui="q.text"]', 'Debut'); await page.waitForTimeout(450);
    ok(await page.locator('details.qcard').count() === 1, 'text filter narrows to one quest');
    await page.fill('[data-ui="q.text"]', ''); await page.waitForTimeout(450);
    await page.click('[data-act="quests-open"][data-v="1"]'); await settle();
    ok(await page.locator('details.qcard:not([open])').count() === 0, 'expand all quests');
    await page.click('[data-act="quests-open"][data-v="0"]'); await settle();
    ok(await page.locator('details.qcard[open]').count() === 0, 'collapse all quests');
    await page.click('[data-act="groups-open"][data-v="0"]'); await settle();
    ok(await page.locator('details.group[open]').count() === 0, 'collapse all groups');
    await page.click('[data-act="groups-open"][data-v="1"]'); await settle();
    ok(await page.locator('details.group:not([open])').count() === 0, 'expand all groups');
    await page.click('details.group[data-group="trader:Jaeger"] > summary'); await settle();
    await page.reload(); await page.waitForSelector('#view .toolbar');
    ok(await page.locator('details.group[data-group="trader:Jaeger"]:not([open])').count() === 1, 'collapsed group remembered after reload');
    await page.click('details.group[data-group="trader:Jaeger"] > summary');
    const debut = '[data-open="5936d90786f7742b1420ba5b"]';
    await page.click(`${debut} > summary`); await settle();
    await page.reload(); await page.waitForSelector('#view .toolbar');
    ok(await page.locator(`${debut}[open]`).count() === 1, 'expanded quest remembered after reload');
    ok(await page.locator(`${debut} a[href*="wiki"]`).count() === 1, 'wiki link present');
    ops = [];
    await page.click(`${debut} [data-act="step"][data-key="o1"][data-d="1"]`); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'objectives', id: 'o1', value: 1 }), 'objective stepper + saves 1');
    ok((await page.locator(`${debut} [data-key="o1"]`).first().locator('xpath=..').innerText()).includes('1/5'), 'stepper shows 1/5');
    await page.click(`${debut} [data-act="step"][data-key="o1"][data-d="-1"]`); await settle();
    ok(lastOp()?.value === 0, 'objective stepper − saves 0');
    await page.click(`${debut} [data-act="task"][data-v="active"]`); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'tasks', id: '5936d90786f7742b1420ba5b', value: 'active' }), 'Start saves status active');
    ok((await page.locator(`${debut} .badge.status-active`).count()) === 1, 'status badge shows Active');
    await page.click(`${debut} .dropdown-menu > button`);
    ok(await page.locator(`${debut} .dropdown-menu [data-popover]`).getAttribute('aria-hidden') === 'false', 'more-actions dropdown opens');
    await page.click(`${debut} [role=menuitem][data-v="failed"]`); await settle();
    ok(lastOp()?.value === 'failed', 'dropdown: Mark failed saves failed');
    await page.click('[data-act="qstatus"][data-s="failed"]'); await settle();
    await page.click(`${debut} .dropdown-menu > button`);
    await page.click(`${debut} [role=menuitem][data-v=""]`); await settle();
    ok(lastOp()?.section === 'tasks' && lastOp()?.value === null, 'dropdown: Reset quest clears the status');
    await page.click('[data-act="qstatus"][data-s="failed"]'); await settle();
    const checking = '[data-open="59674cd986f7744ab26e32f2"]';
    await page.click(`${checking} > summary`); await settle();
    await page.click(`${checking} .popover > button`); await settle();
    const pop = page.locator(`${checking} .popover [data-popover]`);
    const popText = await pop.innerText();
    ok(await pop.getAttribute('aria-hidden') === 'false' && popText.includes('Debut'), `locked quest: "Why locked?" popover lists the missing prerequisite (${await pop.getAttribute('aria-hidden')}: ${popText.replace(/\n/g, ' ')})`);
    await page.keyboard.press('Escape');
    await page.click(`${checking} .dropdown-menu > button`);
    ops = [];
    await page.click(`${checking} [role=menuitem][data-act="taskchain"]`); await settle();
    ok(ops.some((o) => o.id === '5936d90786f7742b1420ba5b' && o.value === 'completed') && ops.some((o) => o.id === '59674cd986f7744ab26e32f2' && o.value === 'active'), 'Start + complete prereqs completes Debut and starts Checking');
    await page.click(`${checking} [data-act="goto"]`); await settle();
    ok(await page.inputValue('[data-ui="q.text"]') === 'Debut' && await page.locator(`${debut}[open]`).count() === 1, 'prerequisite link jumps to that quest');
    // goto cleared the status filter (all statuses shown)
    await page.fill('[data-ui="q.text"]', 'Shooting'); await page.waitForTimeout(450);
    if (!(await page.locator('[data-open="t3"][open]').count())) await page.click('[data-open="t3"] > summary');
    ops = [];
    await page.click('[data-open="t3"] [data-act="check"][data-key="o7"]'); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'objectives', id: 'o7', value: true }), 'objective checkbox saves true');
    ok(await page.isChecked('[data-open="t3"] [data-act="check"][data-key="o7"]'), 'checkbox stays checked after re-render');
    await page.click('[data-open="t3"] [data-act="task"][data-v="completed"]'); await settle();
    ok(lastOp()?.value === 'completed', 'Complete saves completed');
    await shot('quests');
    await page.fill('[data-ui="q.text"]', ''); await page.waitForTimeout(450);
  }

  // ------------------------------------------------------------ hideout
  if (want('hideout')) {
    console.log('Hideout');
    await freshUi('hideout');
    await page.selectOption('[data-ui="h.show"]', 'all'); await settle();
    ok(await page.locator('[data-hopen]').count() === 3, 'show select: all levels lists 3 stations');
    await page.selectOption('[data-ui="h.show"]', 'next'); await settle();
    const gen = '[data-hopen="s-gen"]';
    if (!(await page.locator(`${gen}[open]`).count())) await page.click(`${gen} > summary`);
    ops = [];
    await page.click(`${gen} [data-act="check"][data-key="gen1|item|1"]`); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'hideoutReqs', id: 'gen1|item|1', value: true }), 'requirement checkbox saves');
    await page.click(`${gen} [data-act="step"][data-key="gen1|item|0"][data-d="1"]`); await settle();
    ok(lastOp()?.id === 'gen1|item|0' && lastOp()?.value === 1, 'requirement stepper saves');
    ok(await page.locator(`${gen} .badge.fir`).count() > 0, 'FIR badge shown');
    await page.click(`${gen} [data-act="build"][data-id="gen1"][data-v="1"]`); await settle();
    ok(ops.some((o) => o.id === 'gen1' && o.value === true), 'Mark built saves the level');
    ok((await page.locator(`${gen} .qhead`).innerText()).includes('Level 1/2'), 'station shows level 1/2');
    await page.click(`${gen} [data-act="build"][data-id="gen1"][data-v="0"]`); await settle();
    ok(lastOp()?.section === 'hideout' && ops.slice(-2).some((o) => o.id === 'gen1' && o.value === false), 'Unmark level 1 unbuilds it');
    await page.click('[data-act="stations-open"][data-v="0"]'); await settle();
    ok(await page.locator('[data-hopen][open]').count() === 0, 'collapse all stations');
    await page.click('[data-act="stations-open"][data-v="1"]'); await settle();
    ok(await page.locator('[data-hopen]:not([open])').count() === 0, 'expand all stations');
    await page.fill('[data-ui="h.text"]', 'plug'); await page.waitForTimeout(450);
    ok(await page.locator('[data-hopen]').count() === 1, 'hideout filter by item');
    await page.fill('[data-ui="h.text"]', ''); await page.waitForTimeout(450);
    await page.selectOption('[data-ui="h.need"]', 'fir'); await settle();
    ok(await page.locator('[data-hopen]').count() >= 1, 'needs select (FIR items)');
    await page.selectOption('[data-ui="h.need"]', ''); await settle();
    await page.selectOption('[data-ui="h.sortBy"]', 'ready'); await settle();
    ok(await page.inputValue('[data-ui="h.sortBy"]') === 'ready', 'sort select');
    await shot('hideout');
  }

  // ------------------------------------------------------------ recipes
  if (want('recipes')) {
    console.log('Recipes');
    // Debut unlocks a recipe; make sure it is not completed (or implied by an active Checking) so one is locked.
    await fetch(`${BASE}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [{ section: 'tasks', id: '5936d90786f7742b1420ba5b', value: null }, { section: 'tasks', id: '59674cd986f7744ab26e32f2', value: null }] }) });
    await freshUi('recipes');
    await page.click('[data-act="rec-open"][data-v="1"]'); await settle();
    ok(await page.locator('.recipes-station:not([open])').count() === 0, 'expand all modules');
    ops = [];
    for (const id of ['cr1', 'cr3', 'cr4', 'cr5']) { await page.click(`[data-act="craft-pin"][data-id="${id}"]`); await settle(); }
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'craftPins', id: 's-med', value: ['cr1', 'cr3', 'cr4', 'cr5'] }), 'four pins saved for Medstation');
    ok(await page.isDisabled('[data-act="craft-pin"][data-id="cr6"]'), 'fifth pin is disabled');
    ok(await page.locator('.pinned-row .card.recipe').count() === 4, 'pinned recipes listed at the top');
    await page.click('[data-act="craft-pin"][data-id="cr1"]'); await settle();
    ok(JSON.stringify(lastOp()?.value) === JSON.stringify(['cr3', 'cr4', 'cr5']), 'unpin removes it');
    const locked = await page.locator('.card.recipe.locked').count();
    await page.check('[data-ui="rec.showLocked"]'); await settle();
    const lockedNow = await page.locator('.card.recipe.locked').count();
    ok(lockedNow > locked && await page.locator('.lock-badge').count() > 0, `show-locked switch shows locked recipes with the reason (${locked} → ${lockedNow})`);
    await page.uncheck('[data-ui="rec.showLocked"]'); await settle();
    await page.fill('[data-set="gpuCount"]', '25'); await page.press('[data-set="gpuCount"]', 'Tab'); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'settings', id: 'gpuCount', value: 25 }), 'GPU count saves');
    ok((await page.locator('.btc-table tr.mine').innerText()).startsWith('25'), 'bitcoin table marks 25 GPUs as yours');
    ok((await page.locator('.btc-panel').innerText()).includes('bitcoins per tank'), 'bitcoins per fuel tank shown');
    await page.fill('[data-ui="rec.text"]', 'zzzz'); await page.waitForTimeout(450);
    ok(await page.locator('.empty').count() === 1, 'recipe search with no match shows the empty state');
    await page.fill('[data-ui="rec.text"]', ''); await page.waitForTimeout(450);
    await page.click('[data-act="rec-open"][data-v="0"]'); await settle();
    ok(await page.locator('.recipes-station[open]').count() === 0, 'collapse all modules');
    await page.click('[data-act="rec-open"][data-v="1"]'); await settle();
    await shot('recipes');
  }

  // ------------------------------------------------------------ prestige
  if (want('prestige')) {
    console.log('Prestige');
    await freshUi('prestige');
    ops = [];
    await page.fill('.custom-add input[name="text"]', 'Kill 100 PMCs'); await page.press('.custom-add input[name="text"]', 'Enter'); await settle();
    ok(lastOp()?.section === 'custom' && lastOp()?.value?.text === 'Kill 100 PMCs', 'custom requirement added');
    await page.click('[data-act="custom-toggle"]'); await settle();
    ok(lastOp()?.value?.done === true, 'custom requirement ticked');
    await page.click('[data-act="custom-del"]'); await settle();
    ok(lastOp()?.value === null, 'custom requirement deleted');
    await page.click('[data-act="prestige-achieved"][data-v="1"]');
    ok(await page.evaluate(() => document.getElementById('confirmDialog').open), 'mark achieved asks for confirmation');
    await page.click('#confirmDialog [data-confirm="0"]'); await settle();
    ok(lastOp()?.section === 'custom', 'cancel saves nothing');
    await page.click('[data-act="prestige-achieved"][data-v="1"]');
    await page.click('#confirmDialog [data-confirm="1"]'); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'prestige', id: 'achieved|pr1', value: true }), 'confirm marks the prestige achieved');
    ok(await page.locator('.prestige-card .badge.status-completed').count() === 1 && await page.locator('#toaster .toast').count() > 0, 'achieved badge and a toast shown');
    await page.click('[data-act="prestige-achieved"][data-v="0"]'); await settle();
    ok(lastOp()?.value === null, 'undo marks it not achieved');
    ok(await page.locator('[data-act="prestige-view"]').count() >= 1, 'prestige switcher present');
    await shot('prestige');
  }

  // ------------------------------------------------------------ skills
  if (want('skills')) {
    console.log('Skills');
    await freshUi('skills');
    ops = [];
    await page.click('[data-act="skill-step"][data-id="Strength"][data-d="1"]'); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'skills', id: 'Strength', value: 1 }), 'skill stepper + saves');
    await page.fill('[data-act="skill-level"][data-id="Strength"]', '12'); await page.press('[data-act="skill-level"][data-id="Strength"]', 'Tab'); await settle();
    ok(lastOp()?.value === 12, 'skill level input saves');
    ok(await page.locator('.skills-side', { hasText: 'Strength' }).count() === 1, 'totals sidebar lists the leveled skill');
    await page.click('[data-act="sk-cat"][data-v="Mental"]'); await settle();
    ok(await page.getAttribute('[data-act="sk-cat"][data-v="Mental"]', 'aria-pressed') === 'true' && await page.locator('.card.skill', { hasText: 'Strength' }).count() === 0, 'category button filters (one active)');
    await page.click('[data-act="sk-cat"][data-v=""]'); await settle();
    await page.check('[data-ui="sk.onlyLeveled"]'); await settle();
    ok(await page.locator('.card.skill').count() === 3, 'only-leveled switch');
    await page.uncheck('[data-ui="sk.onlyLeveled"]'); await settle();
    await page.selectOption('[data-ui="sk.sortBy"]', 'level'); await settle();
    ok((await page.locator('.card.skill h2').first().innerText()) === 'Crafting', 'sort by level puts the highest first');
    await page.selectOption('[data-ui="sk.sortBy"]', 'category'); await settle();
    await page.fill('[data-ui="sk.text"]', 'carry weight'); await page.waitForTimeout(450);
    ok(await page.locator('.card.skill').count() >= 1 && await page.locator('.card.skill', { hasText: 'Strength' }).count() === 1, 'skill search');
    await page.fill('[data-ui="sk.text"]', ''); await page.waitForTimeout(450);
    await page.click('[data-skill-overview] > summary'); await settle();
    await page.reload(); await page.waitForSelector('#view .card.skill');
    ok(await page.locator('[data-skill-overview]:not([open])').count() === 1, 'totals sidebar collapse remembered');
    await page.click('[data-skill-overview] > summary');
    ok(await page.isDisabled('[data-act="ocr-run"]') && (await page.locator('.ocr-bar').innerText()).includes('Screenshot folder not found'), 'OCR button disabled with the folder hint (no screenshots mounted)');
    await shot('skills');
  }

  // ------------------------------------------------------------ buffs
  if (want('buffs')) {
    console.log('Buffs');
    await freshUi('buffs');
    ok(await page.locator('.info-card').count() === 4, 'four skills-in-game cards');
    await page.click('[data-act="buff-groups"][data-v="1"]'); await settle();
    ok(await page.locator('details.buff-group:not([open])').count() === 0, 'expand all bonus groups');
    await page.click('[data-act="buff-groups"][data-v="0"]'); await settle();
    ok(await page.locator('details.buff-group[open]').count() === 0, 'collapse all bonus groups');
    await page.click('[data-buffopen="hb"] > summary'); await settle();
    await page.reload(); await page.waitForSelector('.buffs-layout');
    ok(await page.locator('[data-buffopen="hb"]:not([open])').count() === 1, 'hideout bonuses card collapse remembered');
    await page.click('[data-buffopen="hb"] > summary');
    await shot('buffs');
  }

  // ------------------------------------------------------------ needed items
  if (want('items')) {
    console.log('Needed items');
    await freshUi('items');
    const all = await page.locator('.table.items tbody tr').count();
    await page.selectOption('[data-ui="items.fir"]', 'fir'); await settle();
    const notFir = await page.locator('.table.items tbody tr td:nth-child(3)').allInnerTexts();
    ok(all > 0 && notFir.length > 0 && notFir.every((t) => t.trim() === ''), 'type select: FIR only leaves no not-FIR counts');
    await page.selectOption('[data-ui="items.fir"]', 'all'); await settle();
    await page.selectOption('[data-ui="items.source"]', 'hideout'); await settle();
    ok(await page.locator('.table.items tbody tr').count() >= 1, 'source select filters');
    await page.selectOption('[data-ui="items.source"]', 'all'); await settle();
    await page.uncheck('[data-ui="items.includeLocked"]'); await settle();
    ok(!(await page.isChecked('[data-ui="items.includeLocked"]')), 'include-locked switch');
    await page.check('[data-ui="items.includeLocked"]'); await settle();
    await page.click('.table.items tbody tr:first-child .popover > button');
    ok(await page.locator('.table.items tbody tr:first-child [data-popover]').getAttribute('aria-hidden') === 'false', 'sources popover opens');
    await page.keyboard.press('Escape');
    await page.fill('[data-ui="items.text"]', 'salewa'); await page.waitForTimeout(450);
    ok(await page.locator('.table.items tbody tr').count() === 1, 'item filter');
    await page.fill('[data-ui="items.text"]', ''); await page.waitForTimeout(450);
    await shot('items');
  }

  // ------------------------------------------------------------ search
  if (want('search')) {
    console.log('Search');
    await freshUi('search');
    await page.fill('#searchBox', 'strength'); await page.waitForTimeout(450);
    ok(await page.inputValue('#globalSearch') === 'strength', 'search box mirrors into the top bar');
    await page.click('[data-act="goto-skill"]'); await settle();
    ok(await page.getAttribute('#tab-skills', 'aria-selected') === 'true' && await page.inputValue('[data-ui="sk.text"]') === 'Strength', 'skill result jumps to the skill');
    await tab('search');
    await page.fill('#searchBox', 'debut'); await page.waitForTimeout(450);
    const n = await page.locator('details.qcard').count();
    await page.check('[data-ui="searchCompleted"]'); await settle();
    ok(await page.locator('details.qcard').count() >= n, 'include-completed switch');
    await page.uncheck('[data-ui="searchCompleted"]'); await settle();
    await shot('search');
  }

  // ------------------------------------------------------------ settings
  if (want('settings')) {
    console.log('Settings');
    await freshUi('settings');
    ops = [];
    await page.fill('[data-set="playerLevel"]', '35'); await page.press('[data-set="playerLevel"]', 'Tab'); await settle();
    ok(JSON.stringify(lastOp()) === JSON.stringify({ section: 'settings', id: 'playerLevel', value: 35 }), 'PMC level saves');
    await page.selectOption('[data-set="faction"]', 'BEAR'); await settle();
    ok(lastOp()?.id === 'faction' && lastOp()?.value === 'BEAR', 'faction saves');
    await page.selectOption('[data-set="faction"]', 'USEC'); await settle();
    await page.selectOption('[data-set="ocrEngine"]', 'tesseract'); await settle();
    ok(lastOp()?.id === 'ocrEngine' && lastOp()?.value === 'tesseract', 'OCR engine saves');
    await page.uncheck('[data-set="autoLogs"]'); await settle();
    ok(lastOp()?.id === 'autoLogs' && lastOp()?.value === false, 'auto-logs switch saves');
    await page.check('[data-set="autoLogs"]'); await settle();
    await page.fill('[data-set="logsSince"]', '2026-01-02T03:04'); await page.press('[data-set="logsSince"]', 'Tab'); await settle();
    ok(lastOp()?.id === 'logsSince' && lastOp()?.value === new Date('2026-01-02T03:04').toISOString(), 'count-logs-from date saves');
    await page.selectOption('#set-theme', 'light');
    ok(await page.evaluate(() => !document.documentElement.classList.contains('dark')), 'theme select switches to light');
    await shot('settings-light');
    await page.selectOption('#set-theme', 'dark');
    let resets = 0;
    page.on('request', (r) => { if (/progress\/(reset|fresh-start)/.test(r.url())) resets++; });
    await page.click('[data-act="reset"]');
    ok(await page.evaluate(() => document.getElementById('confirmDialog').open), 'reset asks for confirmation (dialog)');
    await page.click('#confirmDialog [data-confirm="0"]'); await settle();
    await page.click('[data-act="fresh-start"]');
    await page.keyboard.press('Escape'); await settle();
    ok(resets === 0, 'cancel / Esc does not reset');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
    ok(/tarkov-progress-.*\.json/.test(dl.suggestedFilename()), 'export downloads the progress file');
    ok(await page.locator('#toaster .toast', { hasText: 'Progress exported' }).count() === 1, 'export shows a toast');
    await page.setInputFiles('[data-act="import-progress"]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await page.waitForTimeout(500);
    ok(await page.locator('#toaster .toast[data-category="error"]', { hasText: 'Import failed' }).count() === 1, 'failed import shows an error toast');
    const progress = await (await fetch(`${BASE}/api/progress`)).json();
    await page.setInputFiles('[data-act="import-progress"]', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(progress)) });
    await page.waitForTimeout(500);
    ok(await page.locator('#toaster .toast', { hasText: 'Progress imported' }).count() === 1, 'progress import works and shows a toast');
    await shot('settings');
  }

  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  const blockedAssets = external.filter((u) => !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u));
  ok(blockedAssets.length === 0, `no external scripts, styles or fonts requested${blockedAssets.length ? `: ${blockedAssets.join(', ')}` : ''}`);
  await browser.close();
}

main().then(() => {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}).catch((err) => { console.error(err); process.exit(1); });
