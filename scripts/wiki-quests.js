#!/usr/bin/env node
'use strict';
// Builds server/wiki-quests.json: quests the game files under its storyline chapters (and other quests
// tarkov.dev doesn't publish), taken from the EFT wiki and converted to the same format as the quests
// from tarkov.dev (server/tarkovjson.js), so the tracker merges them in (server/index.js).
//
// What it does: lists the wiki's quest pages (Category:Quests), drops past events ("Historical
// content" / "Event content") and prestige pages, drops every quest tarkov.dev already has (PvP or
// PvE), then parses each remaining page: infobox (trader, map, loyalty level, previous quests, Kappa),
// "Requirements" notes and the objective lines (hand over / find / eliminate / plant / mark / extract /
// visit / skill ...), resolving linked items, traders and maps to tarkov.dev's ids where they exist.
//
// Run: node scripts/wiki-quests.js            (needs escapefromtarkov.fandom.com and json.tarkov.dev)
const fs = require('fs');
const path = require('path');
const { loadFile, fetchGameDataJson } = require('../server/tarkovjson');

const WIKI = 'https://escapefromtarkov.fandom.com';
const OUT = path.join(__dirname, '..', 'server', 'wiki-quests.json');
const HEADERS = { 'User-Agent': 'tarkov-quest-tracker/1.0 (+self-hosted)' };

const norm = (s) => String(s || '').toLowerCase().replace(/\s*\(quest\)\s*$/, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const slug = (s) => String(s).toLowerCase().replace(/\s*\(quest\)\s*$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleName = (t) => t.replace(/\s*\(quest\)\s*$/, '');

async function wikiApi(params) {
  const url = `${WIKI}/api.php?format=json&${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`wiki ${res.status} for ${url}`);
  return res.json();
}

async function categoryMembers(cat) {
  const out = [];
  let cont;
  do {
    const d = await wikiApi({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmlimit: 500, cmnamespace: 0, ...(cont ? { cmcontinue: cont } : {}) });
    out.push(...d.query.categorymembers.map((m) => m.title));
    cont = d.continue?.cmcontinue;
  } while (cont);
  return out;
}

async function pagesInBatches(titles, params, pick) {
  const out = {};
  for (let i = 0; i < titles.length; i += 25) {
    const d = await wikiApi({ action: 'query', redirects: 1, titles: titles.slice(i, i + 25).join('|'), ...params });
    for (const p of Object.values(d.query.pages)) out[p.title] = pick(p);
  }
  return out;
}

// ---------------------------------------------------------------- wikitext helpers
const links = (s) => [...String(s).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)].map((m) => ({ target: m[1].trim(), text: (m[2] || m[1]).trim() }));
const plain = (s) => String(s)
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/'''?/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function infobox(w, key) {
  const m = new RegExp(`\\n\\|\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=([^\\n]*)`).exec(w);
  return m ? m[1].trim() : '';
}
function section(w, title) {
  const m = new RegExp(`\\n==\\s*${title}\\s*==\\n([\\s\\S]*?)(?=\\n==[^=]|$)`).exec(w);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------- objectives
const NUM = (s) => Number(String(s).replace(/,/g, ''));
// Items named in a "X, Y or Z" list: linked ones, else plain names matched against tarkov.dev's item
// names and short names ("Kirasa-N" -> "Kirasa-N body armor").
function listItems(part, ctx) {
  const linked = links(part).map((l) => ctx.item(l.target)).filter(Boolean);
  if (linked.length) return linked;
  return plain(part).replace(/^(?:an?|the|any)\s+/i, '').split(/\s*,\s*|\s+or\s+|\s+and\s+/).map((n) => ctx.itemLoose(n.replace(/^(?:an?|the|any)\s+/i, ''))).filter(Boolean);
}
function parseObjective(line, i, ctx) {
  const optional = /\(''?Optional''?\)/i.test(line);
  const raw = line.replace(/^\*+\s*/, '').replace(/\(''?Optional''?\)\s*/i, '');
  const description = plain(raw);
  const ls = links(raw);
  const maps = ls.map((l) => ctx.map(l.target)).filter(Boolean);
  const items = ls.map((l) => ctx.item(l.target)).filter(Boolean);
  const fir = /found in raid|\[\[Found in raid/i.test(raw);
  const count = NUM((/^(?:Hand over|Find|Locate and obtain|Obtain|Plant|Eliminate|Stash|Mark|Use|Kill|Win|Earn|Capture|Survive and extract from \w+)\s+(?:the\s+)?([\d,]+)/i.exec(description) || [])[1] || 1);
  const o = { id: `${ctx.taskId}-o${i + 1}`, type: 'basic', description, optional, maps: [...new Map(maps.map((m) => [m.id, m])).values()] };
  const questItem = () => {
    const l = ls.find((x) => !ctx.map(x.target) && !ctx.trader(x.target) && !/found in raid/i.test(x.target));
    return l ? { id: `wiki-${slug(l.target)}`, name: l.target, shortName: l.text } : null;
  };
  // Handing over / bringing what an earlier objective of this quest had you find is a quest item.
  const found = () => { const q = questItem(); return q && ctx.found.find((f) => f.name === q.name) ? q : (/\b(the found|found item|it)\b/i.test(description) || /^bring\b/i.test(description)) ? (q || ctx.found[ctx.found.length - 1] || null) : null; };
  if (/^(hand over|bring|deliver|transfer)\b/i.test(description)) {
    // "Hand over the found intel": what an earlier objective had you find, in the same amount.
    const earlier = /\bthe found\b|\bfound item\b/i.test(description) && ctx.found.length
      ? (ctx.found.find((f) => items.some((i) => i.id === f.id) || ls.some((l) => l.target === f.name)) || ctx.found[ctx.found.length - 1]) : null;
    const q = earlier || (!items.length && found());
    if (q) Object.assign(o, { type: 'giveQuestItem', questItem: q, count: earlier ? ctx.foundCount.get(q) || count : count });
    else if (/^hand over/i.test(description)) Object.assign(o, { type: 'giveItem', items: items.length ? items : listItems(raw.replace(/^.*?hand over\s+[\d,]*\s*/i, ''), ctx), count, foundInRaid: fir });
    else o.type = 'visit';
  } else if (/^(locate and obtain|obtain|find|get)\b/i.test(description) && (items.length || questItem())) {
    if (items.length && (fir || /in raid/i.test(description))) Object.assign(o, { type: 'findItem', items, count, foundInRaid: true });
    else { const q = items.length ? { ...items[0] } : questItem(); ctx.found.push(q); ctx.foundCount.set(q, count); Object.assign(o, { type: 'findQuestItem', questItem: q, count }); }
  } else if (/^(eliminate|kill)\b/i.test(description)) {
    const target = /eliminate\s+[\d,]*\s*(.+?)(?:\s+(?:while|with|on|in|at|from|using|within|as)\b|$)/i.exec(description);
    const weaponPart = /\b(?:while using|using|with)\s+(?:an?\s+|the\s+)?(.*?)(?:\s+(?:while|in|on|at)\b|$)/i.exec(raw);
    const wearPart = /\bwhile wearing\s+(.*?)(?:\s+(?:while|in|on|at)\b|$)/i.exec(raw);
    Object.assign(o, { type: 'shoot', count, targetNames: target ? [target[1].replace(/^(?:the|any)\s+/i, '')] : [] });
    if (weaponPart) { const w = listItems(weaponPart[1], ctx); if (w.length) o.usingWeapon = w; }
    if (wearPart) { const w = listItems(wearPart[1], ctx); if (w.length) o.wearing = w.map((x) => [x]); }
  } else if (/^(plant|stash|place|hide)\b/i.test(description)) {
    if (items.length) Object.assign(o, { type: 'plantItem', items, count, foundInRaid: fir });
    else { const q = questItem(); Object.assign(o, q ? { type: 'plantQuestItem', questItem: q } : { type: 'visit' }); }
  } else if (/\bmark\b/i.test(description) && items.some((x) => /marker/i.test(x.name))) {
    Object.assign(o, { type: 'mark', markerItem: items.find((x) => /marker/i.test(x.name)) });
  } else if (/^(survive and extract|extract)\b/i.test(description)) {
    Object.assign(o, { type: 'extract', count });
    const wearPart = /\bwhile wearing\s+(.*?)(?:\s+body armor|\s+(?:while|in|on|at)\b|$)/i.exec(raw);
    if (wearPart) { const w = listItems(wearPart[1], ctx); if (w.length) o.wearing = w.map((x) => [x]); }
  } else if (/^complete the (task|quest)\b/i.test(description)) {
    const t = ls.map((l) => ctx.task(l.target)).find(Boolean);
    Object.assign(o, { type: 'taskStatus', task: t || { id: `wiki-${slug(ls[0]?.target || description)}`, name: ls[0]?.target || description }, status: ['complete'] });
  } else if (/^reach (?:level|the required level)\s+(\d+)/i.test(description) && ls.length) {
    Object.assign(o, { type: 'skill', skillLevel: { name: ls[ls.length - 1].text, level: Number(/(\d+)/.exec(description)[1]) } });
  } else if (/^(locate|visit|check|return to|go to|access|reach|scout|explore|destroy|survey|inspect|investigate|find out|report|talk|meet|search)\b/i.test(description)) {
    o.type = 'visit';
  }
  return o;
}

// ---------------------------------------------------------------- quest page -> task
function parseQuest(title, w, ctx) {
  const name = titleName(title);
  const taskId = `wiki-${slug(name)}`;
  ctx.taskId = taskId;
  ctx.found = [];
  ctx.foundCount = new Map();
  const traderLink = links(infobox(w, 'given by'))[0];
  const traderName = traderLink?.target || plain(infobox(w, 'given by'));
  const trader = ctx.trader(traderName) || { id: `wiki-${slug(traderName || 'unknown')}`, name: traderName || 'Unknown' };
  const locs = links(infobox(w, 'location')).map((l) => ctx.map(l.target)).filter(Boolean);
  const notes = section(w, 'Requirements').split('\n').filter((l) => l.trim().startsWith('*')).map((l) => plain(l.replace(/^\*+\s*/, '')));
  // Previous quests: "[[A]]", "Accept [[A]]" (A active is enough), "[[A]]<br/>or<br/>[[B]]" (either one).
  const prevRaw = infobox(w, 'previous');
  const alternatives = /\bor\b/i.test(plain(prevRaw));
  const taskRequirements = [];
  for (const part of prevRaw.split(/<br\s*\/?>/i)) {
    for (const l of links(part)) {
      if (/requirements/i.test(l.text) || /#/.test(l.target)) continue;
      const t = ctx.task(l.target);
      if (!t) continue;
      taskRequirements.push({ task: t, status: /\baccept\b/i.test(part) ? ['active'] : ['complete'] });
    }
  }
  const ll = NUM(plain(infobox(w, 'LL requirement'))) || 0;
  const objectives = section(w, 'Objectives').split('\n').filter((l) => /^\*/.test(l.trim())).map((l, i) => parseObjective(l.trim(), i, ctx));
  return {
    id: taskId,
    name,
    wikiLink: `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    minPlayerLevel: NUM(plain(infobox(w, 'PMC level'))) || 1,
    kappaRequired: /yes/i.test(plain(infobox(w, 'reqkappa'))),
    lightkeeperRequired: false,
    factionName: 'Any',
    trader,
    map: locs.length === 1 ? locs[0] : null,
    taskRequirements,
    ...(alternatives && taskRequirements.length > 1 ? { taskRequirementsAny: true } : {}),
    traderRequirements: ll ? [{ trader, requirementType: 'level', compareMethod: '>=', value: ll }] : [],
    objectives,
    finishRewards: { traderUnlock: [] },
    source: 'wiki',
    ...(notes.length ? { wikiNotes: notes } : {}),
    ...(notes.some((n) => /seasonal mode/i.test(n)) ? { seasonal: true } : {}),
  };
}

async function main() {
  const log = (...a) => console.log(...a);
  log('tarkov.dev: quests (PvP and PvE), traders, maps and items …');
  const [pvp, pve, itemsFile, mapsFile] = await Promise.all([
    fetchGameDataJson({ gameMode: 'regular', log: () => {} }), fetchGameDataJson({ gameMode: 'pve', log: () => {} }),
    loadFile('regular/items', 'en'), loadFile('regular/maps', 'en').catch(() => ({ maps: {} })),
  ]);
  const known = new Map();
  for (const t of [...pvp.tasks, ...pve.tasks]) known.set(norm(t.name), { id: t.id, name: t.name });
  const items = new Map();
  for (const [id, it] of Object.entries(itemsFile.items || {})) {
    const item = { id, name: it.name, shortName: it.shortName, iconLink: it.iconLink };
    if (it.name && !items.has(norm(it.name))) items.set(norm(it.name), item);
  }
  const shorts = new Map();
  for (const it of items.values()) if (it.shortName && !shorts.has(norm(it.shortName))) shorts.set(norm(it.shortName), it);
  const traders = new Map(pvp.traders.map((t) => [norm(t.name), { id: t.id, name: t.name }]));
  const maps = new Map();
  for (const [id, m] of Object.entries(mapsFile.maps || {})) if (m?.name) maps.set(norm(m.name), { id, name: m.name });
  for (const t of pvp.tasks) if (t.map) maps.set(norm(t.map.name), t.map);
  maps.set('arena', { id: 'wiki-arena', name: 'Arena' });

  log('wiki: quest pages …');
  const titles = await categoryMembers('Quests');
  const cats = await pagesInBatches(titles, { prop: 'categories', cllimit: 'max' }, (p) => (p.categories || []).map((c) => c.title.replace('Category:', '')));
  const wanted = titles.filter((t) => !known.has(norm(t)) && !/^New Beginning/.test(t) && t !== 'Quests'
    && !(cats[t] || []).some((c) => /historical content|event content/i.test(c)));
  log(`${titles.length} wiki quest pages, ${wanted.length} not in tarkov.dev (past events and prestige left out)`);
  const pages = await pagesInBatches(wanted, { prop: 'revisions', rvprop: 'content', rvslots: 'main' }, (p) => p.revisions?.[0]?.slots?.main?.['*'] || '');

  const wikiIds = new Map(wanted.map((t) => [norm(t), { id: `wiki-${slug(t)}`, name: titleName(t) }]));
  const ctx = {
    item: (n) => items.get(norm(n)) || null,
    // Plain names: full name, short name, a name starting with it, or the same without a brand prefix
    // ("NFM THOR CRV" -> short name "THOR CRV").
    itemLoose: (n) => {
      const tries = [n, n.replace(/^\S+\s+/, '')];
      for (const x of tries) {
        const k = norm(x);
        const hit = items.get(k) || shorts.get(k) || (k.length > 4 ? [...items.entries()].find(([name]) => name.startsWith(k))?.[1] : null);
        if (hit) return hit;
      }
      return null;
    },
    map: (n) => maps.get(norm(n)) || null,
    trader: (n) => traders.get(norm(n)) || null,
    task: (n) => known.get(norm(n)) || wikiIds.get(norm(n)) || null,
  };
  const tasks = wanted.filter((t) => pages[t]).map((t) => parseQuest(t, pages[t], ctx)).sort((a, b) => a.name.localeCompare(b.name));
  const out = { meta: { source: `${WIKI} (Category:Quests)`, fetchedAt: new Date().toISOString(), count: tasks.length,
    note: 'Quests tarkov.dev does not publish (mostly storyline-chapter quests and Arena), converted from the EFT wiki by scripts/wiki-quests.js. Regenerate after a patch.' }, tasks };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const byType = {};
  for (const t of tasks) for (const o of t.objectives) byType[o.type] = (byType[o.type] || 0) + 1;
  log(`wrote ${tasks.length} quests to ${path.relative(process.cwd(), OUT)}; objective types:`, byType);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
module.exports = { parseQuest, parseObjective };
