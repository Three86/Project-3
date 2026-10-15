'use strict';
/* Tarkov Tracker front-end. Vanilla JS, no build step. */

// ---------------------------------------------------------------- state
const S = {
  data: null,
  skills: null,
  ocr: { status: null, result: null, running: false },
  progress: null,
  status: null,
  ui: loadUi(),
};
const idx = { tasks: new Map(), dependents: new Map(), stations: new Map(), levels: new Map(), traders: [], maps: [] };
let memo = {};

function loadUi() {
  const defaults = {
    tab: 'quests',
    q: { statuses: ['active', 'available'], trader: '', map: '', need: '', groupBy: 'trader', sortBy: 'level', text: '', kappa: false, lightkeeper: false },
    h: { show: 'next', need: '', sortBy: 'name', text: '' },
    items: { fir: 'all', source: 'all', includeLocked: true, text: '', sortBy: 'remaining' },
    search: '',
    searchCompleted: false,
    open: {},
    groups: {},
    prestigeView: null,
    hOpen: {},
    buffOpen: {},
    sk: { text: '', category: '', sortBy: 'category', onlyLeveled: false, view: 'skills' },
  };
  try {
    const saved = JSON.parse(localStorage.getItem('tt-ui') || '{}');
    return { ...defaults, ...saved, q: { ...defaults.q, ...saved.q }, h: { ...defaults.h, ...saved.h }, items: { ...defaults.items, ...saved.items }, sk: { ...defaults.sk, ...saved.sk }, groups: { ...saved.groups }, hOpen: { ...saved.hOpen }, buffOpen: { ...saved.buffOpen } };
  } catch {
    return defaults;
  }
}
function saveUi() {
  try { localStorage.setItem('tt-ui', JSON.stringify(S.ui)); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- utils
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').toLowerCase();
const uniq = (a) => [...new Set(a)];
const byName = (a, b) => String(a).localeCompare(String(b));

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) throw new Error(body.error || `HTTP ${res.status}`);
  return { ok: res.ok, body };
}

// Apply ops locally (optimistic) and persist them on the server.
async function setProgress(ops) {
  if (!Array.isArray(ops)) ops = [ops];
  for (const { section, id, value } of ops) {
    const t = S.progress[section];
    if (section === 'tasks') value == null ? delete t[id] : (t[id] = { status: value, updatedAt: Date.now(), source: 'manual' });
    else if (section === 'settings') t[id] = value;
    else if (value == null || value === false || value === 0) delete t[id];
    else t[id] = value;
  }
  memo = {};
  render();
  try {
    const { body } = await api('/api/progress', { method: 'POST', body: JSON.stringify({ ops }) });
    S.progress.rev = body.rev;
  } catch (err) {
    banner(`Could not save progress: ${err.message}`);
  }
}

function banner(html) {
  const b = $('#banner');
  b.innerHTML = html || '';
  b.classList.toggle('hidden', !html);
}

// ---------------------------------------------------------------- indexing
function buildIndex() {
  idx.tasks.clear(); idx.dependents.clear(); idx.stations.clear(); idx.levels.clear();
  for (const t of S.data.tasks) {
    t.objectives ||= [];
    t.taskRequirements ||= [];
    idx.tasks.set(t.id, t);
  }
  for (const t of S.data.tasks) {
    for (const r of t.taskRequirements) {
      if (!r.task) continue;
      if (!idx.dependents.has(r.task.id)) idx.dependents.set(r.task.id, []);
      idx.dependents.get(r.task.id).push({ task: t, status: reqStatuses(r) });
    }
  }
  for (const st of S.data.hideout || []) {
    idx.stations.set(st.id, st);
    st.levels = (st.levels || []).slice().sort((a, b) => a.level - b.level);
    for (const l of st.levels) idx.levels.set(l.id, { station: st, level: l });
  }
  idx.traders = uniq(S.data.tasks.map((t) => t.trader?.name).filter(Boolean)).sort(byName);
  idx.maps = uniq(S.data.tasks.flatMap(taskMaps)).filter((m) => m !== 'Any').sort(byName);
  memo = {};
}

const reqStatuses = (r) => (Array.isArray(r.status) ? r.status : [r.status || 'complete']).map(norm);

function taskMaps(t) {
  if (t.map?.name) return [t.map.name];
  const m = uniq(t.objectives.flatMap((o) => (o.maps || []).map((x) => x.name)));
  return m.length ? m : ['Any'];
}

// ---------------------------------------------------------------- objectives
const NEEDS = {
  kill: 'Kills',
  fir: 'Items (found in raid)',
  item: 'Items (not FIR)',
  equipment: 'Equipment / gear',
  questitem: 'Quest items',
  place: 'Place / mark',
  visit: 'Visit / locate',
  extract: 'Extract',
  progression: 'Skill / level / trader',
};

function objItems(o) {
  if (Array.isArray(o.items) && o.items.length) return o.items;
  if (o.item) return [o.item];
  if (o.markerItem) return [o.markerItem];
  if (o.useAny?.length) return o.useAny;
  return [];
}
function objEquipment(o) {
  return [...(o.usingWeapon || []), ...(o.wearing || []).flat()].filter(Boolean);
}

function objNeeds(o) {
  const n = new Set();
  switch (o.type) {
    case 'shoot': n.add('kill'); if (objEquipment(o).length) n.add('equipment'); break;
    case 'giveItem': case 'findItem': case 'sellItem': case 'useItem': n.add(o.foundInRaid ? 'fir' : 'item'); break;
    case 'plantItem': case 'mark': n.add('place'); n.add(o.foundInRaid ? 'fir' : 'item'); break;
    case 'plantQuestItem': n.add('place'); break;
    case 'buildWeapon': n.add('equipment'); break;
    case 'giveQuestItem': case 'findQuestItem': n.add('questitem'); break;
    case 'visit': n.add('visit'); break;
    case 'extract': n.add('extract'); break;
    default: n.add('progression');
  }
  if (o.type !== 'shoot' && objEquipment(o).length) n.add('equipment');
  return n;
}

// How many "units" an objective needs (for steppers). 1 => simple checkbox.
function objTarget(o) {
  const c = Number(o.count || 0);
  return ['giveItem', 'findItem', 'shoot', 'extract', 'useItem', 'plantItem', 'giveQuestItem', 'findQuestItem', 'sellItem'].includes(o.type) && c > 1 ? c : 1;
}

// Some objectives can be evaluated from other progress (player level, other quests, hideout).
function autoValue(o) {
  if (o.type === 'skill' && o.skillLevel?.level && findSkill(o.skillLevel.name)) {
    const lvl = skillLevel(o.skillLevel.name);
    if (lvl >= o.skillLevel.level) return { done: true, why: `your ${o.skillLevel.name}: ${lvl}` };
    if (lvl > 0) return { done: false, why: `your ${o.skillLevel.name}: ${lvl}` };
  }
  if (o.type === 'playerLevel' && o.playerLevel) return { done: S.progress.settings.playerLevel >= o.playerLevel, why: `your level: ${S.progress.settings.playerLevel}` };
  if (o.type === 'taskStatus' && o.task) {
    const st = taskStatus(o.task.id);
    const want = (Array.isArray(o.status) ? o.status : [o.status || 'complete']).map(norm);
    const ok = want.some((w) => (w === 'complete' ? st === 'completed' : w === 'active' ? ['active', 'completed'].includes(st) : st === w));
    return { done: ok, why: `quest is ${st}` };
  }
  return null;
}

function objValue(section, key, o) {
  const auto = autoValue(o);
  if (auto) return { auto, cur: auto.done ? 1 : 0, target: 1, done: auto.done };
  const v = S.progress[section][key];
  const target = objTarget(o);
  const cur = v === true ? target : Number(v || 0);
  return { cur: Math.min(cur, target), target, done: cur >= target };
}

function itemTag(it) {
  if (!it) return '';
  const img = it.iconLink ? `<img src="${esc(it.iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="item" title="${esc(it.name)}">${img}${esc(it.shortName || it.name)}</span>`;
}

function objTags(o) {
  const tags = [];
  const items = objItems(o);
  if (items.length) tags.push(items.length > 1 ? `<span class="badge">any of:</span> ${items.map(itemTag).join(' ')}` : itemTag(items[0]));
  if (['giveItem', 'findItem', 'plantItem', 'mark', 'useItem', 'sellItem'].includes(o.type) && items.length) {
    tags.push(o.foundInRaid ? '<span class="badge fir" title="Must be found in raid">FIR</span>' : '<span class="badge nofir" title="Does not need to be found in raid">not FIR</span>');
  }
  if (o.questItem) tags.push(`<span class="badge">quest item: ${esc(o.questItem.name)}</span>`);
  if (o.dogTagLevel) tags.push(`<span class="badge">dogtag lvl ≥ ${o.dogTagLevel}</span>`);
  if (o.minDurability || (o.maxDurability && o.maxDurability < 100)) tags.push(`<span class="badge">durability ${o.minDurability || 0}–${o.maxDurability ?? 100}%</span>`);
  if (o.targetNames?.length) tags.push(`<span class="badge">target: ${esc(o.targetNames.join(', '))}</span>`);
  if (o.bodyParts?.length) tags.push(`<span class="badge">${esc(o.bodyParts.join(', '))}</span>`);
  if (o.zoneNames?.length) tags.push(`<span class="badge">zone: ${esc(o.zoneNames.join(', '))}</span>`);
  if (o.usingWeapon?.length) tags.push(`<span class="badge">weapon:</span> ${o.usingWeapon.slice(0, 6).map(itemTag).join(' ')}${o.usingWeapon.length > 6 ? ` +${o.usingWeapon.length - 6}` : ''}`);
  for (const set of o.wearing || []) if (set?.length) tags.push(`<span class="badge">wearing:</span> ${set.map(itemTag).join(' + ')}`);
  if (o.notWearing?.length) tags.push(`<span class="badge">not wearing: ${esc(o.notWearing.map((i) => i.shortName || i.name).join(', '))}</span>`);
  if (o.skillLevel) tags.push(`<span class="badge">${esc(o.skillLevel.name)} ${o.skillLevel.level}</span>`);
  if (o.exitStatus?.length) tags.push(`<span class="badge">${esc(o.exitStatus.join('/'))}</span>`);
  if (o.maps?.length) tags.push(`<span class="badge">${esc(o.maps.map((m) => m.name).join(', '))}</span>`);
  return tags.join(' ');
}

// Render one objective row with a checkbox or a counter.
function objRow(section, key, o, { disabled = false, forceDone = false } = {}) {
  const v = forceDone ? { cur: objTarget(o), target: objTarget(o), done: true } : objValue(section, key, o);
  let control;
  if (v.auto) control = `<input type="checkbox" disabled ${v.done ? 'checked' : ''} title="Tracked automatically">`;
  else if (v.target > 1) {
    control = `<span class="stepper"><button data-act="step" data-sec="${section}" data-key="${esc(key)}" data-d="-1" data-max="${v.target}" ${disabled ? 'disabled' : ''}>−</button><span>${v.cur}/${v.target}</span><button data-act="step" data-sec="${section}" data-key="${esc(key)}" data-d="1" data-max="${v.target}" ${disabled ? 'disabled' : ''}>+</button></span>`;
  } else control = `<input type="checkbox" data-act="check" data-sec="${section}" data-key="${esc(key)}" ${v.done ? 'checked' : ''} ${disabled ? 'disabled' : ''}>`;
  const kind = [...objNeeds(o)].map((n) => NEEDS[n]).join(' · ');
  return `<li class="${v.done ? 'done' : ''}">${control}<div class="body">
    <div class="desc">${esc(o.description || o.type)} ${o.optional ? '<span class="optional">(optional)</span>' : ''}</div>
    <div class="tags"><span class="type-icon">${esc(kind)}</span> ${objTags(o)} ${v.auto ? `<span class="auto">auto – ${esc(v.auto.why)}</span>` : ''}</div>
  </div></li>`;
}

// ---------------------------------------------------------------- quest status
function explicitStatus(id) {
  return S.progress.tasks[id]?.status || null;
}

// A quest is implicitly completed if a quest that requires its completion is active/completed.
function impliedComplete(id, seen = new Set()) {
  const key = `imp:${id}`;
  if (key in memo) return memo[key];
  if (seen.has(id)) return false;
  seen.add(id);
  const res = (idx.dependents.get(id) || []).some(({ task, status }) =>
    status.length === 1 && status[0] === 'complete' &&
    (['active', 'completed'].includes(explicitStatus(task.id)) || impliedComplete(task.id, seen)));
  return (memo[key] = res);
}

function taskStatus(id, seen = new Set()) {
  const key = `st:${id}`;
  if (key in memo) return memo[key];
  const t = idx.tasks.get(id);
  const ex = explicitStatus(id);
  let st;
  if (ex === 'completed' || ex === 'failed') st = ex;
  else if (impliedComplete(id)) st = 'completed';
  else if (ex === 'active') st = 'active';
  else if (!t) st = 'locked';
  else if (t.factionName && t.factionName !== 'Any' && t.factionName !== S.progress.settings.faction) st = 'unavailable';
  else if (seen.has(id)) st = 'locked';
  else {
    seen.add(id);
    const prereqs = t.taskRequirements.every((r) => {
      if (!r.task) return true;
      const ps = taskStatus(r.task.id, seen);
      return reqStatuses(r).some((w) => (w === 'complete' ? ps === 'completed' : w === 'active' ? ['active', 'completed'].includes(ps) : w === 'failed' ? ps === 'failed' : false));
    });
    st = prereqs && S.progress.settings.playerLevel >= (t.minPlayerLevel || 0) ? 'available' : 'locked';
  }
  return (memo[key] = st);
}

function taskProgress(t) {
  const req = t.objectives.filter((o) => !o.optional);
  if (!req.length) return 0;
  return req.filter((o) => objValue('objectives', o.id, o).done).length / req.length;
}

// All (transitive) prerequisite quest ids.
function allPrereqs(id, out = new Set()) {
  for (const r of idx.tasks.get(id)?.taskRequirements || []) {
    if (r.task && !out.has(r.task.id) && reqStatuses(r).includes('complete')) {
      out.add(r.task.id);
      allPrereqs(r.task.id, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------- hideout status
function builtLevel(station) {
  let lvl = 0;
  for (const l of station.levels) if (S.progress.hideout[l.id]) lvl = Math.max(lvl, l.level);
  return lvl;
}
const levelBuilt = (station, level) => builtLevel(station) >= level.level;
// A level is locked until every other station it requires has been built to the required level.
function levelUnlocked(level) {
  return (level.stationLevelRequirements || []).every((r) => {
    const st = r.station && idx.stations.get(r.station.id);
    return !st || builtLevel(st) >= r.level;
  });
}

function hideoutReqs(level) {
  const reqs = [];
  (level.itemRequirements || []).forEach((r, i) => {
    if (!r.item) return;
    const fir = (r.attributes || []).some((a) => /found.?in.?raid/i.test(`${a.type} ${a.name}`) && String(a.value) !== 'false');
    reqs.push({ kind: 'item', key: `${level.id}|item|${i}`, item: r.item, count: Number(r.count || r.quantity || 1), fir });
  });
  (level.stationLevelRequirements || []).forEach((r) => {
    const st = r.station && idx.stations.get(r.station.id);
    reqs.push({ kind: 'station', key: `${level.id}|station|${r.station?.id}`, label: `${r.station?.name} level ${r.level}`, auto: true, done: st ? builtLevel(st) >= r.level : false });
  });
  (level.traderRequirements || []).forEach((r, i) => reqs.push({ kind: 'trader', key: `${level.id}|trader|${i}`, label: `${r.trader?.name} loyalty level ${r.level ?? r.value}` }));
  (level.skillRequirements || []).forEach((r, i) => {
    const lvl = skillLevel(r.name);
    // Tracked automatically once you enter that skill on the Skills tab; otherwise a manual checkbox.
    if (lvl > 0) reqs.push({ kind: 'skill', key: `${level.id}|skill|${i}`, label: `${r.name} level ${r.level} (yours: ${lvl})`, auto: true, done: lvl >= r.level });
    else reqs.push({ kind: 'skill', key: `${level.id}|skill|${i}`, label: `${r.name} level ${r.level}` });
  });
  for (const r of reqs) {
    if (r.auto) continue;
    const v = S.progress.hideoutReqs[r.key];
    const target = r.kind === 'item' ? r.count : 1;
    r.cur = v === true ? target : Math.min(Number(v || 0), target);
    r.target = target;
    r.done = r.cur >= target;
  }
  return reqs;
}

// ---------------------------------------------------------------- render: shell
// Redrawing while a mouse button is held down replaces the element being clicked, and the browser
// then drops the click (e.g. typing a skill level and clicking a button straight away: the input's
// change event redraws the page between mousedown and mouseup). Defer redraws until release.
let pointerDown = false;
let renderPending = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
const releasePointer = () => {
  if (!pointerDown) return;
  pointerDown = false;
  // After the click event has been delivered to the unchanged page.
  if (renderPending) setTimeout(() => { if (renderPending) render(); }, 0);
};
document.addEventListener('pointerup', releasePointer, true);
document.addEventListener('pointercancel', releasePointer, true);
window.addEventListener('blur', releasePointer); // mouse released outside the window

function render() {
  if (pointerDown) { renderPending = true; return; }
  renderPending = false;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.ui.tab));
  const view = $('#view');
  if (S.ui.tab === 'settings') { view.innerHTML = renderSettings(); return; }
  if (S.ui.tab === 'skills') { view.innerHTML = renderSkills(); return; }
  if (S.ui.tab === 'buffs') { view.innerHTML = renderBuffs(); return; }
  if (!S.data) { view.innerHTML = renderNoData(); return; }
  const fn = { quests: renderQuests, hideout: renderHideout, prestige: renderPrestige, skills: renderSkills, buffs: renderBuffs, items: renderItems, search: renderSearch }[S.ui.tab] || renderQuests;
  view.innerHTML = fn();
}

function renderNoData() {
  const st = S.status || {};
  return `<div class="empty">
    <h2>No game data yet</h2>
    <p>${st.refreshing ? 'Downloading quest &amp; hideout data from tarkov.dev…' : 'Quest and hideout definitions are downloaded once from tarkov.dev and cached locally.'}</p>
    ${st.refreshError ? `<p style="color:var(--bad)">Last attempt failed: ${esc(st.refreshError)}</p>` : ''}
    ${/server unavailable/i.test(st.refreshError || '') ? '<p>tarkov.dev reports its own server is down. That is an outage on their side, not a problem with your setup. The tracker retries every 5 minutes and loads as soon as tarkov.dev is back.</p>' : ''}
    <p><button class="btn primary" data-act="refresh">Download now</button> or import a data file under <a href="#" data-act="tab" data-tab="settings">Settings</a>.</p>
  </div>`;
}

function select(name, value, options, label) {
  return `<label>${label}<select data-ui="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}

// ---------------------------------------------------------------- render: quests
const STATUS_LABEL = { active: 'Active', available: 'Available', locked: 'Locked', completed: 'Completed', failed: 'Failed', unavailable: 'Other faction' };

function filteredTasks() {
  const f = S.ui.q;
  const text = norm(f.text);
  return S.data.tasks.filter((t) => {
    const st = taskStatus(t.id);
    if (f.statuses.length && !f.statuses.includes(st)) return false;
    if (f.trader && t.trader?.name !== f.trader) return false;
    if (f.map && !taskMaps(t).includes(f.map) && !taskMaps(t).includes('Any')) return false;
    if (f.kappa && !t.kappaRequired) return false;
    if (f.lightkeeper && !t.lightkeeperRequired) return false;
    if (f.need && !t.objectives.some((o) => objNeeds(o).has(f.need))) return false;
    if (text && !norm(t.name).includes(text) && !t.objectives.some((o) => norm(o.description).includes(text) || objItems(o).some((i) => norm(i.name).includes(text)))) return false;
    return true;
  });
}

function sortTasks(list) {
  const by = S.ui.q.sortBy;
  const key = {
    level: (t) => [t.minPlayerLevel || 0, t.trader?.name || '', t.name],
    trader: (t) => [t.trader?.name || '', t.minPlayerLevel || 0, t.name],
    map: (t) => [taskMaps(t)[0], t.minPlayerLevel || 0, t.name],
    name: (t) => [t.name],
    progress: (t) => [-taskProgress(t), t.name],
  }[by] || ((t) => [t.name]);
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

const groupKey = (name) => `${S.ui.q.groupBy}:${name}`;

function groupTasks(list) {
  const g = S.ui.q.groupBy;
  if (g === 'none') return [['', list]];
  const groups = new Map();
  for (const t of list) {
    let keys;
    if (g === 'trader') keys = [t.trader?.name || 'Unknown'];
    else if (g === 'map') keys = taskMaps(t);
    else if (g === 'need') keys = uniq(t.objectives.flatMap((o) => [...objNeeds(o)])).map((n) => NEEDS[n]);
    else if (g === 'status') keys = [STATUS_LABEL[taskStatus(t.id)]];
    for (const k of keys.length ? keys : ['Other']) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
  }
  return [...groups.entries()].sort((a, b) => byName(a[0], b[0]));
}

function renderQuests() {
  const f = S.ui.q;
  const list = sortTasks(filteredTasks());
  const counts = {};
  for (const t of S.data.tasks) { const s = taskStatus(t.id); counts[s] = (counts[s] || 0) + 1; }
  const toolbar = `<div class="toolbar">
    <div class="chips">${Object.keys(STATUS_LABEL).map((s) => `<button class="chip ${f.statuses.includes(s) ? 'on' : ''}" data-act="qstatus" data-s="${s}">${STATUS_LABEL[s]} (${counts[s] || 0})</button>`).join('')}</div>
    ${select('q.trader', f.trader, [['', 'All traders'], ...idx.traders.map((x) => [x, x])], 'Trader')}
    ${select('q.map', f.map, [['', 'All maps'], ...idx.maps.map((x) => [x, x])], 'Map')}
    ${select('q.need', f.need, [['', 'Anything'], ...Object.entries(NEEDS)], 'Needs')}
    ${select('q.groupBy', f.groupBy, [['none', 'No grouping'], ['trader', 'Trader'], ['map', 'Map'], ['need', 'Requirement type'], ['status', 'Status']], 'Group')}
    ${select('q.sortBy', f.sortBy, [['level', 'Level'], ['trader', 'Trader'], ['map', 'Map'], ['name', 'Name'], ['progress', 'Progress']], 'Sort')}
    <label><input type="checkbox" data-ui="q.kappa" ${f.kappa ? 'checked' : ''}>Kappa</label>
    <label><input type="checkbox" data-ui="q.lightkeeper" ${f.lightkeeper ? 'checked' : ''}>Lightkeeper</label>
    <input type="search" data-ui="q.text" value="${esc(f.text)}" placeholder="Filter…">
    <span class="count">${list.length} quests</span>
  </div>`;
  if (!list.length) return toolbar + `<div class="empty">No quests match these filters.</div>`;
  const groups = groupTasks(list);
  const tools = `<div class="collapse-tools">
    <button class="btn small" data-act="quests-open" data-v="1">Expand all quests</button><button class="btn small" data-act="quests-open" data-v="0">Collapse all quests</button>
    ${groups.length > 1 ? '<button class="btn small" data-act="groups-open" data-v="1">Expand all groups</button><button class="btn small" data-act="groups-open" data-v="0">Collapse all groups</button>' : ''}</div>`;
  return toolbar + tools + groups.map(([name, ts]) => {
    const grid = `<div class="grid">${ts.map(taskCard).join('')}</div>`;
    if (!name) return grid;
    const key = groupKey(name);
    const active = ts.filter((t) => taskStatus(t.id) === 'active').length;
    return `<details class="group" data-group="${esc(key)}" ${S.ui.groups[key] === false ? '' : 'open'}>
      <summary class="group-title"><span class="caret"></span>${esc(name)} <span class="count">${ts.length} quest${ts.length === 1 ? '' : 's'}${active ? ` · ${active} active` : ''}</span></summary>${grid}</details>`;
  }).join('');
}

function taskCard(t) {
  const st = taskStatus(t.id);
  const p = S.progress.tasks[t.id];
  const pct = Math.round(taskProgress(t) * 100);
  const open = S.ui.open[t.id] ?? false;
  const actions = [];
  if (st !== 'active' && st !== 'completed') actions.push(`<button class="btn small" data-act="task" data-id="${t.id}" data-v="active">Start</button>`);
  if (st !== 'completed') actions.push(`<button class="btn small" data-act="task" data-id="${t.id}" data-v="completed">Complete</button>`);
  if (st === 'locked') actions.push(`<button class="btn small" data-act="taskchain" data-id="${t.id}" title="Mark all prerequisite quests completed and start this one">Start + complete prereqs</button>`);
  if (st === 'active') actions.push(`<button class="btn small danger" data-act="task" data-id="${t.id}" data-v="failed">Failed</button>`);
  if (p) actions.push(`<button class="btn small" data-act="task" data-id="${t.id}" data-v="">Reset</button>`);
  const prereqs = t.taskRequirements.filter((r) => r.task).map((r) => {
    const ok = autoValue({ type: 'taskStatus', task: r.task, status: r.status }).done;
    return `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '✗'} <a href="#" data-act="goto" data-id="${r.task.id}">${esc(r.task.name)}</a>${reqStatuses(r).join() !== 'complete' ? ` (${esc(reqStatuses(r).join('/'))})` : ''}</span>`;
  });
  const pending = t.objectives.filter((o) => !o.optional && !objValue('objectives', o.id, o).done).length;
  return `<details class="card quest st-${st}" id="task-${t.id}" data-open="${t.id}" ${open ? 'open' : ''}>
    <summary class="quest-sum">
      <div class="card-head"><span class="caret"></span><div class="title">${esc(t.name)}</div>
        ${p?.source === 'log' ? '<span class="badge log" title="Detected from game logs">log</span>' : ''}<span class="badge status-${st}">${STATUS_LABEL[st]}</span></div>
      <div class="meta"><span>${esc(t.trader?.name || '?')}</span>·<span>${esc(taskMaps(t).join(', '))}</span>·<span>Lvl ${t.minPlayerLevel || 1}</span>
        ${t.objectives.length ? `·<span>${pending ? `${pending} left` : 'all objectives done'} (${pct}%)</span>` : ''}
        ${t.kappaRequired ? '<span class="badge kappa">Kappa</span>' : ''}${t.lightkeeperRequired ? '<span class="badge kappa">Lightkeeper</span>' : ''}
        ${t.factionName && t.factionName !== 'Any' ? `<span class="badge">${esc(t.factionName)}</span>` : ''}</div>
      ${t.objectives.length ? `<div class="progressbar"><div style="width:${pct}%"></div></div>` : ''}
    </summary>
    <ul class="objs">${t.objectives.map((o) => objRow('objectives', o.id, o)).join('')}</ul>
    ${prereqs.length ? `<div class="prereqs">Requires: ${prereqs.join(', ')}</div>` : ''}
    <div class="actions">${actions.join('')}${t.wikiLink ? `<a class="btn small" href="${esc(t.wikiLink)}" target="_blank" rel="noopener">Wiki ↗</a>` : ''}</div>
  </details>`;
}

// ---------------------------------------------------------------- render: hideout
const REQ_NEEDS = { item: 'Items', fir: 'FIR items', trader: 'Trader loyalty', skill: 'Skills', station: 'Other stations' };

function renderHideout() {
  const f = S.ui.h;
  const text = norm(f.text);
  let stations = (S.data.hideout || []).filter((st) => st.levels.length);
  const rows = [];
  let locked = 0;
  for (const st of stations) {
    const built = builtLevel(st);
    let levels = st.levels;
    if (f.show === 'next') {
      levels = levels.filter((l) => l.level === built + 1);
      if (levels.length && !levels.every(levelUnlocked)) {
        levels = [];
        // Nothing built yet and the first level is locked: hide the station entirely.
        if (built === 0) { locked++; continue; }
      }
    } else if (f.show === 'nextAll') levels = levels.filter((l) => l.level === built + 1);
    else if (f.show === 'todo') levels = levels.filter((l) => l.level > built);
    else if (f.show === 'built') levels = levels.filter((l) => l.level <= built);
    levels = levels.filter((l) => {
      const reqs = hideoutReqs(l);
      if (f.need === 'fir' && !reqs.some((r) => r.kind === 'item' && r.fir)) return false;
      if (f.need && f.need !== 'fir' && !reqs.some((r) => r.kind === f.need)) return false;
      if (text && !norm(st.name).includes(text) && !reqs.some((r) => norm(r.item?.name || r.label).includes(text))) return false;
      return true;
    });
    // Keep fully built stations visible in "next level" view so they can still be unmarked.
    // (also stations whose next level is locked, so their built levels can be unmarked)
    const keepBuilt = f.show === 'next' && built > 0 && !levels.length && !f.need && !text;
    if (levels.length || keepBuilt) rows.push({ st, built, levels });
  }
  const readiness = (r) => {
    if (!r.levels.length) return -1;
    const reqs = hideoutReqs(r.levels[0]);
    return reqs.length ? reqs.filter((x) => x.done).length / reqs.length : 1;
  };
  rows.sort(f.sortBy === 'ready' ? (a, b) => readiness(b) - readiness(a) || byName(a.st.name, b.st.name) : (a, b) => byName(a.st.name, b.st.name));
  const toolbar = `<div class="toolbar">
    ${select('h.show', f.show, [['next', 'Available upgrades'], ['nextAll', 'Next level (incl. locked)'], ['todo', 'All unbuilt levels'], ['built', 'Built levels'], ['all', 'All levels']], 'Show')}
    ${select('h.need', f.need, [['', 'Anything'], ...Object.entries(REQ_NEEDS)], 'Needs')}
    ${select('h.sortBy', f.sortBy, [['name', 'Station name'], ['ready', 'Closest to buildable']], 'Sort')}
    <input type="search" data-ui="h.text" value="${esc(f.text)}" placeholder="Filter station or item…">
    <span class="count">${rows.length} stations</span>
  </div>`;
  const tools = `<div class="collapse-tools">
    <button class="btn small" data-act="stations-open" data-v="1">Expand all</button><button class="btn small" data-act="stations-open" data-v="0">Collapse all</button>
    ${locked ? `<span class="auto">${locked} station${locked === 1 ? '' : 's'} hidden until the stations they need are built · <a href="#" data-act="h-show" data-v="nextAll">show them</a></span>` : ''}</div>`;
  if (!rows.length) return toolbar + tools + '<div class="empty">Nothing to show. Everything built? Show-off.</div>';
  return toolbar + tools + `<div class="grid">${rows.map(stationCard).join('')}</div>`;
}

function stationCard({ st, built, levels }) {
  const max = st.levels[st.levels.length - 1]?.level || 0;
  const top = st.levels.find((l) => l.level === built);
  const undo = top ? `<button class="btn small" data-act="build" data-id="${top.id}" data-v="0" title="Marked built by mistake? Sets the station back to level ${built - 1}">↶ Unmark level ${built}</button>` : '';
  const next = st.levels.find((l) => l.level === built + 1);
  let state = '';
  if (built >= max) state = '<span class="badge status-completed">Fully built</span>';
  else if (next && !levelUnlocked(next)) state = '<span class="badge">Locked</span>';
  else if (next) {
    const reqs = hideoutReqs(next);
    const done = reqs.filter((r) => r.done).length;
    state = done === reqs.length ? '<span class="badge status-available">Ready to build</span>' : `<span class="badge">${done}/${reqs.length} requirements</span>`;
  }
  const open = S.ui.hOpen[st.id] ?? (levels.length > 0 && built < max);
  return `<details class="card station ${built >= max ? 'st-completed' : 'st-available'}" data-hopen="${esc(st.id)}" ${open ? 'open' : ''}>
    <summary class="quest-sum"><div class="card-head"><span class="caret"></span><div class="title">${esc(st.name)}</div>${state}${undo}<span class="badge">Level ${built}/${max}</span></div></summary>
    ${levels.length ? levels.map((l) => levelBlock(st, l)).join('') : `<div class="auto">${built >= max ? 'Fully built.' : 'Next level is locked until the stations it needs are built.'}</div>`}
  </details>`;
}

function levelBlock(st, l) {
  const built = levelBuilt(st, l);
  const reqs = hideoutReqs(l);
  const ready = reqs.every((r) => r.done);
  const rows = reqs.map((r) => {
    let control;
    if (r.auto || built) control = `<input type="checkbox" disabled ${r.done || built ? 'checked' : ''}>`;
    else if (r.target > 1) control = `<span class="stepper"><button data-act="step" data-sec="hideoutReqs" data-key="${esc(r.key)}" data-d="-1" data-max="${r.target}">−</button><span>${r.cur}/${r.target}</span><button data-act="step" data-sec="hideoutReqs" data-key="${esc(r.key)}" data-d="1" data-max="${r.target}">+</button></span>`;
    else control = `<input type="checkbox" data-act="check" data-sec="hideoutReqs" data-key="${esc(r.key)}" ${r.done ? 'checked' : ''}>`;
    const label = r.kind === 'item'
      ? `${itemTag(r.item)} ×${r.count} ${r.fir ? '<span class="badge fir">FIR</span>' : '<span class="badge nofir">not FIR</span>'}`
      : `${esc(r.label)} ${r.auto ? '<span class="auto">auto</span>' : ''}`;
    return `<li class="${r.done || built ? 'done' : ''}">${control}<div class="body"><div class="tags"><span class="type-icon">${REQ_NEEDS[r.kind]}</span> ${label}</div></div></li>`;
  });
  const time = l.constructionTime ? `${Math.round(l.constructionTime / 360) / 10}h build` : '';
  return `<div class="station-level">
    <div class="lvl-title">Level ${l.level} ${built ? '<span class="badge status-completed">Built</span>' : !levelUnlocked(l) ? '<span class="badge">Locked</span>' : ready ? '<span class="badge status-available">Ready to build</span>' : ''}<span class="count">${time}</span>
      <button class="btn small" data-act="build" data-id="${l.id}" data-v="${built ? 0 : 1}">${built ? 'Unbuild' : 'Mark built'}</button></div>
    ${rows.length ? `<ul class="objs">${rows.join('')}</ul>` : '<div class="auto">No requirements</div>'}
  </div>`;
}

// ---------------------------------------------------------------- render: prestige
function renderPrestige() {
  const list = (S.data.prestige || []).slice().sort((a, b) => (a.prestigeLevel || 0) - (b.prestigeLevel || 0));
  const custom = Object.entries(S.progress.custom);
  const customBlock = (pid) => {
    const rows = custom.filter(([, c]) => c.prestigeId === pid);
    return `<ul class="objs" style="margin-top:6px">${rows.map(([id, c]) => `<li class="${c.done ? 'done' : ''}"><input type="checkbox" data-act="custom-toggle" data-id="${esc(id)}" ${c.done ? 'checked' : ''}><div class="body"><div class="desc">${esc(c.text)} <span class="optional">(custom)</span></div></div><button class="btn small danger" data-act="custom-del" data-id="${esc(id)}">✕</button></li>`).join('')}</ul>
      <form class="custom-add" data-act="custom-add" data-pid="${esc(pid)}"><input type="text" name="text" placeholder="Add your own requirement…"><button class="btn small">Add</button></form>`;
  };
  let html = `<div class="toolbar"><span>Prestige requirements. Quest, level and hideout conditions update automatically; tick the rest yourself. Your level: <b>${S.progress.settings.playerLevel}</b> (change in Settings).</span></div>`;
  if (!list.length) {
    html += `<div class="empty">No prestige data came back from tarkov.dev${S.data.meta?.prestigeError ? ` (${esc(S.data.meta.prestigeError)})` : ''}.<br>Try refreshing game data, or track requirements by hand below.</div>
      <div class="card" style="margin-top:10px"><div class="card-head"><div class="title">My prestige checklist</div></div>${customBlock('general')}</div>`;
    return html;
  }
  const achieved = (p) => !!S.progress.prestige[`achieved|${p.id}`];
  // Default to the first prestige not yet achieved; the buttons can pick any other.
  const current = list.find((p) => p.id === S.ui.prestigeView) || list.find((p) => !achieved(p)) || list[list.length - 1];
  const switcher = `<div class="chips prestige-switch">${list.map((p) => `<button class="chip ${p.id === current.id ? 'on' : ''}" data-act="prestige-view" data-id="${esc(p.id)}">${achieved(p) ? '✓ ' : ''}${esc(p.name || `Prestige ${p.prestigeLevel}`)}</button>`).join('')}
    ${S.ui.prestigeView ? '<button class="chip" data-act="prestige-view" data-id="" title="Show the next prestige you have not achieved">Next unachieved</button>' : ''}</div>`;
  const p = current;
  const conds = p.conditions || [];
  const isAchieved = achieved(p);
  // Once achieved, the conditions were met at the time even if level etc. reset since.
  const done = isAchieved ? conds.length : conds.filter((o) => objValue('prestige', `${p.id}|${o.id}`, o).done).length;
  const all = conds.length && done === conds.length;
  return html + switcher + `<div class="card prestige-card ${isAchieved || all ? 'st-completed' : 'st-active'}">
      <div class="card-head"><div class="title">${esc(p.name || `Prestige ${p.prestigeLevel}`)}</div>
        ${isAchieved ? '<span class="badge status-completed">Achieved</span>' : ''}<span class="badge">${done}/${conds.length}</span></div>
      <div class="progressbar"><div style="width:${conds.length ? Math.round((done / conds.length) * 100) : 0}%"></div></div>
      <ul class="objs">${conds.map((o) => objRow('prestige', `${p.id}|${o.id}`, o, { disabled: isAchieved, forceDone: isAchieved })).join('')}</ul>
      ${customBlock(p.id)}
      <div class="actions">${isAchieved
        ? `<button class="btn small" data-act="prestige-achieved" data-id="${esc(p.id)}" data-v="0">Undo: mark not achieved</button>`
        : `<button class="btn small ${all ? 'primary' : ''}" data-act="prestige-achieved" data-id="${esc(p.id)}" data-v="1">Mark ${esc(p.name || `Prestige ${p.prestigeLevel}`)} achieved</button>`}</div>
    </div>`;
}

// ---------------------------------------------------------------- skills
const skillKey = (s) => norm(s).replace(/[^a-z]/g, '');
function findSkill(name) {
  const k = skillKey(name);
  return activeSkillConfig().skills.find((sk) => skillKey(sk.id) === k || skillKey(sk.name) === k);
}
function skillLevel(name) {
  const sk = findSkill(name);
  return sk ? Number(S.progress.skills?.[sk.id] || 0) : 0;
}
const fmtNum = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}`;
function effectValue(sk, e, level) {
  const cap = S.skills.effectCapLevel || 50;
  return e.perLevel * Math.min(level, cap);
}

// Bundled skills, minus any that the downloaded game data says are no longer in the game.
function activeSkillConfig() {
  const cfg = S.skills || { skills: [] };
  const live = S.data?.skills;
  if (!Array.isArray(live) || !live.length) return cfg;
  const ids = new Set(live.map((sk) => skillKey(sk.id)));
  return { ...cfg, skills: cfg.skills.filter((sk) => ids.has(skillKey(sk.id))) };
}

function skillOverview(cfg, lv) {
  const cats = uniq(cfg.skills.map((sk) => sk.category));
  const elite = cfg.eliteLevel || 51;
  // Overview: every active buff, grouped by category, plus totals for effects that several skills share.
  const leveled = cfg.skills.filter((sk) => lv(sk) > 0);
  const combined = new Map();
  for (const sk of leveled) {
    if (sk.category === 'Combat') continue; // weapon-class effects only apply to their own weapon class
    for (const e of sk.effects || []) {
      const c = combined.get(e.name) || { total: 0, unit: e.unit, from: [] };
      c.total += effectValue(sk, e, lv(sk));
      c.from.push(sk.name);
      combined.set(e.name, c);
    }
  }
  const shared = [...combined.entries()].filter(([, c]) => c.from.length > 1);
  return leveled.length ? `<details class="card skill-overview" data-skill-overview ${S.ui.skillOverviewOpen === false ? '' : 'open'}>
      <summary class="quest-sum"><div class="card-head"><span class="caret"></span><div class="title">Total buffs on your PMC</div><span class="badge">${leveled.length} skills leveled · ${leveled.filter((sk) => lv(sk) >= elite).length} elite</span></div></summary>
      <div class="overview-grid">${cats.map((cat) => {
        const sks = leveled.filter((sk) => sk.category === cat);
        if (!sks.length) return '';
        return `<div><div class="ov-cat">${esc(cat)}</div>${sks.map((sk) => `<div class="ov-skill"><b>${esc(sk.name)}</b> <span class="auto">lvl ${lv(sk)}</span>${lv(sk) >= elite ? ' <span class="badge kappa">Elite</span>' : ''}
          ${(sk.effects || []).map((e) => `<div class="ov-row"><span>${esc(e.name)}</span><span class="num">${fmtNum(effectValue(sk, e, lv(sk)))}${esc(e.unit || '')}</span></div>`).join('')}
          ${lv(sk) >= elite ? (sk.elite || []).map((x) => `<div class="ov-row elite"><span>★ ${esc(x)}</span></div>`).join('') : ''}</div>`).join('')}</div>`;
      }).join('')}</div>
      ${shared.length ? `<div class="ov-cat" style="margin-top:10px">Combined (same effect from several skills)</div>${shared.map(([name, c]) => `<div class="ov-row"><span>${esc(name)} <span class="auto">(${esc(c.from.join(' + '))})</span></span><span class="num">${fmtNum(c.total)}${esc(c.unit || '')}</span></div>`).join('')}` : ''}
    </details>` : '<div class="empty" style="padding:14px">Enter your skill levels to see the total buffs on your PMC.</div>';
}

function renderSkills() {
  const cfg = activeSkillConfig();
  const f = S.ui.sk;
  const maxLevel = cfg.maxLevel || 51;
  const elite = cfg.eliteLevel || 51;
  const lv = (sk) => Number(S.progress.skills[sk.id] || 0);
  if (!cfg.skills.length) return '<div class="empty">No skill data available.</div>';
  const cats = uniq(cfg.skills.map((sk) => sk.category));
  const text = norm(f.text);
  let list = cfg.skills.filter((sk) =>
    (!f.category || sk.category === f.category) &&
    (!f.onlyLeveled || lv(sk) > 0) &&
    (!text || [sk.name, sk.description, sk.levelUp, ...(sk.effects || []).map((e) => e.name), ...(sk.elite || [])].some((x) => norm(x).includes(text))));
  const order = new Map(cfg.skills.map((sk, i) => [sk.id, i]));
  // 'category' keeps its saved-setting name but means the in-game order (which is grouped by category).
  const sorters = { category: (a, b) => order.get(a.id) - order.get(b.id), name: (a, b) => byName(a.name, b.name), level: (a, b) => lv(b) - lv(a) || byName(a.name, b.name) };
  list = list.slice().sort(sorters[f.sortBy] || sorters.category);

  const overview = skillOverview(cfg, lv);

  const toolbar = `<div class="toolbar">
    <input type="search" data-ui="sk.text" value="${esc(f.text)}" placeholder="Search skills, descriptions, effects…" style="flex:1;min-width:220px">
    <div class="chips">${[['', 'All'], ...cats.map((c) => [c, c])].map(([v, t]) => `<button class="chip ${f.category === v ? 'on' : ''}" data-act="sk-cat" data-v="${esc(v)}">${esc(t)}</button>`).join('')}</div>
    ${select('sk.sortBy', f.sortBy, [['category', 'Game order'], ['name', 'Name'], ['level', 'Your level']], 'Sort')}
    <label><input type="checkbox" data-ui="sk.onlyLeveled" ${f.onlyLeveled ? 'checked' : ''}>Only leveled</label>
    <span class="count">${list.length} skills</span>
  </div>`;
  const cards = list.map((sk) => {
    const l = lv(sk);
    return `<div class="card skill ${l >= elite ? 'st-completed' : l > 0 ? 'st-active' : ''}">
      <div class="card-head"><div class="title">${esc(sk.name)}</div>${l >= elite ? '<span class="badge kappa">Elite</span>' : ''}<span class="badge">${esc(sk.category)}</span></div>
      <div class="skill-level"><span class="stepper"><button data-act="skill-step" data-id="${esc(sk.id)}" data-d="-1">−</button>
        <input type="number" min="0" max="${maxLevel}" value="${l}" data-act="skill-level" data-id="${esc(sk.id)}" aria-label="${esc(sk.name)} level">
        <button data-act="skill-step" data-id="${esc(sk.id)}" data-d="1">+</button></span><span class="auto">level ${l}/${maxLevel}</span></div>
      <div class="progressbar"><div style="width:${Math.round((l / maxLevel) * 100)}%"></div></div>
      <div class="desc">${esc(sk.description)}</div>
      ${sk.levelUp ? `<div class="auto">Levels up by: ${esc(sk.levelUp)}</div>` : ''}
      <ul class="effects">${(sk.effects || []).map((e) => `<li><span>${esc(e.name)}</span><span class="num">${fmtNum(effectValue(sk, e, l))}${esc(e.unit || '')} <span class="auto">(${fmtNum(e.perLevel)}${esc(e.unit || '')}/lvl, max ${fmtNum(effectValue(sk, e, maxLevel))}${esc(e.unit || '')})</span></span></li>`).join('')}
        ${(sk.elite || []).map((x) => `<li class="${l >= elite ? '' : 'locked'}"><span>★ Elite: ${esc(x)}</span></li>`).join('')}</ul>
    </div>`;
  }).join('');
  // Wide screens: skill cards on the left, buff totals in a sticky sidebar. Narrow: totals on top.
  return ocrPanel() + toolbar + `<div class="skills-layout">
      <div class="skills-main"><div class="grid skills-grid">${cards || '<div class="empty">No skills match.</div>'}</div></div>
      <aside class="skills-side">${overview}</aside>
    </div>
    <p class="kv">${esc(cfg.note || '')}</p>`;
}

// Screenshot OCR: button, folder status and the result of the last run.
function ocrPanel() {
  const { status: st, result: r, running } = S.ocr;
  if (!st) loadOcrStatus();
  let info = 'Checking screenshot folder…';
  if (st) {
    if (!st.tesseract) info = 'OCR engine (Tesseract) not installed. It comes with the Docker image.';
    else if (!st.available) info = `Screenshot folder not found (<code>${esc(st.dir)}</code>). Mount your Tarkov Screenshots folder, see README.`;
    else if (!st.selected.length) info = st.total ? 'Only in-raid screenshots found (those are skipped).' : 'No screenshots in the folder yet.';
    else info = `Will read ${st.selected.length} screenshot${st.selected.length === 1 ? '' : 's'} from <b>${esc(st.day)}</b>${st.inRaid ? ` · ${st.inRaid} in-raid skipped` : ''}`;
  }
  let result = '';
  if (r?.error) result = `<div class="ocr-result bad">${esc(r.error)}</div>`;
  else if (r) {
    const changed = new Map(r.changes.map((c) => [c.id, c]));
    const read = r.read || r.changes.map((c) => ({ id: c.id, name: c.name, level: c.to }));
    const changes = read.length
      ? read.map((x) => { const c = changed.get(x.id); const inf = x.inferred ? ' <span title="Name unreadable; worked out from its position on the page">≈</span>' : ''; return c ? `<span class="badge changed">${esc(x.name)}${inf} ${c.from} → <b>${c.to}</b></span>` : `<span class="badge">${esc(x.name)}${inf} ${x.level} ✓</span>`; }).join(' ')
        + `<div class="auto">${r.changes.length ? `${r.changes.length} changed` : 'All already matched the tracker'} · ✓ = already the same${read.some((x) => x.inferred) ? ' · ≈ = name unreadable, worked out from its position on the page' : ''}.</div>`
      : '<span class="auto">No skill levels could be read from these screenshots. Are they of the skills page?</span>';
    const files = r.files.map((f) => `<div>${esc(f.name)}: ${f.error ? `<span style="color:var(--bad)">${esc(f.error)}</span>` : `${Object.keys(f.skills).length} skills${f.characterLevel ? `, PMC level ${f.characterLevel}` : ''}${f.levelCheck ? ` <span class="auto">(${levelCheckText(f.levelCheck)})</span>` : ''}${f.unreadLevels ? ` <span class="auto">(${f.unreadLevels} level${f.unreadLevels === 1 ? '' : 's'} without a readable name)</span>` : ''}`}</div>`).join('');
    result = `<div class="ocr-result"><div><b>${r.found}</b> skills read from ${r.files.length} screenshot${r.files.length === 1 ? '' : 's'} (${esc(r.day)}).${r.playerLevel ? ` PMC level ${r.playerLevel.from} → <b>${r.playerLevel.to}</b>.` : ''}
      <button class="btn small" data-act="ocr-dismiss">✕</button></div><div class="ocr-changes">${changes}</div><details><summary>Screenshots</summary><div class="sources">${files}</div></details></div>`;
  }
  return `<div class="toolbar ocr-bar"><button class="btn primary" data-act="ocr-run" ${running || !st?.selected?.length || !st?.tesseract ? 'disabled' : ''}>${running ? 'Reading screenshots…' : '📷 Read levels from screenshots'}</button>
    <span class="auto">${info}</span></div>${result}`;
}

// "3 of 3 checks agree: big number 17, next level 18 − 1, XP 312 146 → 17"
function levelCheckText(c) {
  const parts = [];
  if (c.number != null) parts.push(`number ${c.number}`);
  if (c.nextLevel != null) parts.push(`next level ${c.nextLevel + 1} − 1`);
  if (c.xp != null) parts.push(`XP ${Number(c.xpValue).toLocaleString()} → ${c.xp}`);
  else if (c.xpValue != null) parts.push(`XP ${Number(c.xpValue).toLocaleString()} ${c.xpTableMissing ? '(no XP table yet)' : c.xpTableMismatch ? '(XP table does not match this game version)' : ''}`);
  const head = c.agree ? `${c.agree} of ${c.of} checks agree` : 'checks disagree, level not changed';
  return `${head}: ${parts.join(', ')}`;
}

let ocrStatusLoading = false;
async function loadOcrStatus() {
  if (ocrStatusLoading) return;
  ocrStatusLoading = true;
  try { S.ocr.status = (await api('/api/ocr/status')).body; } catch { S.ocr.status = { tesseract: false, available: false, selected: [] }; }
  ocrStatusLoading = false;
  if (S.ui.tab === 'skills') render();
}

// Practical, plain-language consequences of a few skills at your current level.
function renderSkillPractical(cfg, lv) {
  const base = cfg.baseValues || {};
  const get = (id) => cfg.skills.find((sk) => sk.id === id);
  const eff = (sk, pattern) => (sk?.effects || []).find((e) => pattern.test(e.name));
  const pct = (sk, pattern) => { const e = eff(sk, pattern); return e ? effectValue(sk, e, lv(sk)) : 0; };
  const kg = (n) => `${(Math.round(n * 10) / 10).toLocaleString()} kg`;
  const hrs = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const x = (n) => `×${(Math.round(n * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  const levelBadge = (sk) => `<span class="badge">your level ${lv(sk)}${lv(sk) >= (cfg.eliteLevel || 51) ? ' · Elite' : ''}</span>`;
  const row = (label, now, was) => `<div class="ov-row"><span>${label}</span><span class="num"><b>${now}</b>${was != null ? ` <span class="auto">(base ${was})</span>` : ''}</span></div>`;
  const elite = (sk) => lv(sk) >= (cfg.eliteLevel || 51) ? (sk.elite || []).map((t) => `<div class="ov-row elite"><span>★ ${esc(t)}</span></div>`).join('') : '';
  const cards = [];

  const str = get('Strength');
  if (str) {
    const b = pct(str, /carry weight/i);
    const m = 1 + b / 100;
    cards.push(`<div class="card info-card"><div class="card-head"><div class="title">Strength</div>${levelBadge(str)}</div>
      <p class="auto">Carry weight bonus ${fmtNum(b)}% raises the weight limits below.</p>
      ${row('You become overweight at', kg(base.overweightStartKg * m), kg(base.overweightStartKg))}
      ${row('You can no longer sprint at', kg(base.sprintLimitKg * m), kg(base.sprintLimitKg))}
      ${row('Critically overweight at', kg(base.criticalOverweightKg * m), kg(base.criticalOverweightKg))}
      ${row('Sprint speed', `${fmtNum(pct(str, /sprint/i))}%`)}${row('Jump height', `${fmtNum(pct(str, /jump/i))}%`)}${row('Throw distance', `${fmtNum(pct(str, /throw/i))}%`)}
      ${elite(str)}</div>`);
  }

  const met = get('Metabolism');
  if (met) {
    const food = 1 + pct(met, /from food/i) / 100;
    const drainMet = pct(met, /drain/i);
    const drainHealth = pct(get('Health'), /drain/i);
    const drain = 1 + (drainMet + drainHealth) / 100;
    cards.push(`<div class="card info-card"><div class="card-head"><div class="title">Metabolism</div>${levelBadge(met)}</div>
      ${row('Food and drinks restore', x(food), '×1')}
      ${row('Example: a 60-energy MRE gives', `${Math.round(60 * food)} energy`, '60')}
      ${row('Energy and hydration drain', x(drain), '×1')}
      <p class="auto">Drain includes Health (${fmtNum(drainHealth)}%) and Metabolism (${fmtNum(drainMet)}%).${drain < 1 ? ` Your energy lasts about ${Math.round((1 / drain - 1) * 100)}% longer.` : ''}</p>
      ${elite(met)}</div>`);
  }

  const hm = get('HideoutManagement');
  if (hm) {
    const cons = 1 + pct(hm, /consumption/i) / 100;
    const bonus = 1 + pct(hm, /zone bonus/i) / 100;
    const fuelBonus = hideoutBonusTotals().find((b) => b.type === 'FuelConsumption');
    const zoneFuel = fuelBonus ? 1 + fuelBonus.boosted / 100 : 1;
    const perHour = (base.generatorFuelPerHour || 4.75) * cons * zoneFuel;
    cards.push(`<div class="card info-card"><div class="card-head"><div class="title">Hideout Management</div>${levelBadge(hm)}</div>
      ${row('Fuel and filter use', x(cons), '×1')}
      ${fuelBonus ? row(`Hideout fuel bonus (${esc(fuelBonus.from.join(', '))})`, `${fmtNum(fuelBonus.boosted)}%`) : ''}
      ${row('Generator burns', `${(Math.round(perHour * 100) / 100)} fuel/h`, `${base.generatorFuelPerHour || 4.75}/h`)}
      ${(base.fuelTanks || []).map((t) => row(`${esc(t.name)} (${t.resource}) lasts`, hrs(t.resource / perHour), hrs(t.resource / (base.generatorFuelPerHour || 4.75)))).join('')}
      ${row('Hideout zone bonuses', x(bonus), '×1')}
      <p class="auto">Example: a zone bonus of +10% becomes +${Math.round(10 * bonus * 10) / 10}%.</p>
      ${elite(hm)}</div>`);
  }

  const cr = get('Crafting');
  if (cr) {
    const t = 1 + pct(cr, /production time/i) / 100;
    cards.push(`<div class="card info-card"><div class="card-head"><div class="title">Crafting</div>${levelBadge(cr)}</div>
      ${row('Craft time', x(t), '×1')}
      ${(base.craftExampleHours || [1, 8, 24]).map((h) => row(`A ${h} h craft takes`, hrs(h * t), hrs(h))).join('')}
      ${elite(cr)}</div>`);
  }
  return `<div class="grid info-grid">${cards.join('')}</div>
    <p class="kv">Base values: ${esc(base.source || 'n/a')}${base.fuelTanksSource ? `; fuel tank sizes: ${esc(base.fuelTanksSource)}` : ''}. Per-level percentages come from the Skills data (marked "game config" where taken from the game; otherwise community wiki and approximate). Change your levels on the Skills tab.</p>`;
}

// ---------------------------------------------------------------- buffs (skills + hideout)
const ABSOLUTE_BONUS = new Set(['AdditionalSlots', 'MaximumEnergyReserve', 'StashSize', 'UnlockArmorRepair', 'UnlockWeaponModification', 'UnlockWeaponRepair']);

// Hideout Management's per-level boost to hideout zone bonuses, in percent.
function hideoutBoostPercent() {
  const cfg = activeSkillConfig();
  const hm = cfg.skills.find((sk) => sk.id === 'HideoutManagement');
  const e = (hm?.effects || []).find((x) => /zone bonus/i.test(x.name));
  return e ? effectValue(hm, e, Number(S.progress.skills?.HideoutManagement || 0)) : 0;
}

// Sum the bonuses of every built hideout level. Percent bonuses add up across levels;
// stash size takes the largest; extra slots are counted per station.
function hideoutBonusTotals() {
  const boost = hideoutBoostPercent();
  const map = new Map();
  for (const st of S.data?.hideout || []) {
    const built = builtLevel(st);
    for (const l of st.levels) {
      if (l.level > built) continue;
      for (const b of l.bonuses || []) {
        if (b.value == null || !b.type) continue;
        const abs = ABSOLUTE_BONUS.has(b.type);
        const key = `${b.type}|${b.skillName || ''}|${b.type === 'AdditionalSlots' ? st.id : ''}`;
        const e = map.get(key) || { type: b.type, name: b.name || b.type, skillName: b.skillName, station: st.name, abs, total: 0, from: [] };
        e.total = b.type === 'StashSize' ? Math.max(e.total, b.value) : e.total + b.value;
        if (!e.from.includes(st.name)) e.from.push(st.name);
        map.set(key, e);
      }
    }
  }
  return [...map.values()].map((e) => {
    const pct = e.abs ? 0 : e.total * 100;
    return { ...e, pct, boosted: pct * (1 + boost / 100) };
  });
}

function renderBuffs() {
  const cfg = activeSkillConfig();
  const lv = (sk) => Number(S.progress.skills[sk.id] || 0);
  const boost = hideoutBoostPercent();
  const totals = hideoutBonusTotals();
  const fmtPct = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}%`;
  const absValue = (b) => b.type === 'StashSize' ? `${b.total} cells` : b.type.startsWith('Unlock') ? 'Unlocked' : `+${b.total}`;
  const groups = [
    ['Health, energy & hydration', (b) => /health|energy|hydration|regenerat|debuff|metabol/i.test(`${b.type} ${b.name}`) && !b.abs],
    ['Skills & experience', (b) => !b.abs && (b.skillName || /skill|experience/i.test(`${b.type} ${b.name}`))],
    ['Other hideout bonuses', (b) => !b.abs],
    ['Slots, stash & unlocks', (b) => b.abs],
  ];
  const used = new Set();
  const sections = groups.map(([title, test]) => {
    const rows = totals.filter((b) => !used.has(b) && test(b));
    rows.forEach((b) => used.add(b));
    if (!rows.length) return '';
    const key = `hb:${title}`;
    return `<details class="buff-group" data-buffopen="${esc(key)}" ${S.ui.buffOpen[key] ? 'open' : ''}><summary><span class="caret"></span><span class="ov-cat">${esc(title)}</span><span class="auto">${rows.length} bonus${rows.length === 1 ? '' : 'es'}</span></summary>${rows.map((b) => `<div class="ov-row"><span>${esc(b.name)}${b.skillName ? ` <span class="auto">(${esc(b.skillName)})</span>` : ''}${b.type === 'AdditionalSlots' ? ` <span class="auto">(${esc(b.station)})</span>` : ''}
      <span class="auto">· ${esc(b.from.join(', '))}</span></span><span class="num"><b>${b.abs ? absValue(b) : fmtPct(b.boosted)}</b>${!b.abs && boost ? ` <span class="auto">(base ${fmtPct(b.pct)})</span>` : ''}</span></div>`).join('')}</details>`;
  }).join('');
  // Game data cached by an older version has no 'bonuses' field on any hideout level.
  const noBonusData = !!S.data?.hideout?.length && !S.data.hideout.some((st) => st.levels.some((l) => Array.isArray(l.bonuses)));
  const hideoutCard = `<details class="card buffs-hideout" data-buffopen="hb" ${S.ui.buffOpen.hb === false ? '' : 'open'}>
      <summary class="quest-sum"><div class="card-head"><span class="caret"></span><div class="title">Hideout bonuses</div>
      <span class="badge">${totals.length} bonuses</span><span class="badge">${(S.data?.hideout || []).filter((st) => builtLevel(st) > 0).length} stations built</span></div></summary>
      ${totals.length ? '<div class="collapse-tools"><button class="btn small" data-act="buff-groups" data-v="1">Expand all</button><button class="btn small" data-act="buff-groups" data-v="0">Collapse all</button></div>' : ''}
      ${boost ? `<p class="auto">Includes your Hideout Management bonus: zone bonuses ×${Math.round((1 + boost / 100) * 1000) / 1000}.</p>` : ''}
      ${sections || (noBonusData
        ? `<p class="auto">Your saved game data was downloaded before the tracker read hideout bonuses${S.status?.refreshing ? ' and is being refreshed now…' : '.'}</p><button class="btn primary" data-act="refresh">Refresh game data now</button>`
        : `<p class="auto">${S.data ? 'No hideout bonuses yet. Mark stations built on the Hideout tab.' : 'Game data not loaded yet.'}</p>`)}
      <p class="kv">Bonuses of all built levels are added up; Hideout Management boosts percentage bonuses. Values come from tarkov.dev's hideout data.</p></details>`;
  return `<div class="buffs-layout">
      <section><h3 class="section-title">Hideout</h3>${hideoutCard}</section>
      <section><h3 class="section-title">Skills in game</h3>${renderSkillPractical(cfg, lv)}</section>
      <section><h3 class="section-title">All skill buffs</h3>${skillOverview(cfg, lv)}</section>
    </div>`;
}

// ---------------------------------------------------------------- needed items aggregation
const AGG_TYPES = new Set(['giveItem', 'plantItem', 'mark', 'buildWeapon', 'useItem', 'findItem']);

// Every item requirement across quests, hideout and prestige. Used by both the items tab and search.
function itemRequirements({ includeEquipment = false } = {}) {
  const out = [];
  for (const t of S.data.tasks) {
    const st = taskStatus(t.id);
    const handedIn = new Set(t.objectives.filter((o) => o.type === 'giveItem').flatMap((o) => objItems(o).map((i) => i.id)));
    for (const o of t.objectives) {
      const items = objItems(o);
      // "Find" + "hand over" pairs reference the same items; count them once.
      if (o.type === 'findItem' && items.every((i) => handedIn.has(i.id))) continue;
      const v = objValue('objectives', o.id, o);
      const count = o.type === 'buildWeapon' || o.type === 'mark' ? 1 : Number(o.count || 1);
      if (AGG_TYPES.has(o.type) || items.length) {
        for (const it of items) out.push({ item: it, count, have: Math.round((v.cur / v.target) * count), fir: !!o.foundInRaid, alt: items.length > 1, kind: 'quest', status: st, label: t.name, sub: o.description, taskId: t.id, done: v.done || st === 'completed' });
      }
      if (includeEquipment) {
        for (const it of objEquipment(o)) out.push({ item: it, count: 0, have: 0, fir: false, alt: true, kind: 'equipment', status: st, label: t.name, sub: o.description, taskId: t.id, done: v.done || st === 'completed' });
      }
    }
  }
  for (const st of S.data.hideout || []) {
    for (const l of st.levels) {
      const built = levelBuilt(st, l);
      for (const r of hideoutReqs(l)) {
        if (r.kind !== 'item') continue;
        out.push({ item: r.item, count: r.count, have: r.cur, fir: r.fir, alt: false, kind: 'hideout', status: built ? 'completed' : 'hideout', label: `${st.name} level ${l.level}`, sub: '', done: built || r.done });
      }
    }
  }
  for (const p of S.data.prestige || []) {
    if (S.progress.prestige[`achieved|${p.id}`]) continue;
    for (const o of p.conditions || []) {
      const v = objValue('prestige', `${p.id}|${o.id}`, o);
      for (const it of objItems(o)) out.push({ item: it, count: Number(o.count || 1), have: Math.round((v.cur / v.target) * Number(o.count || 1)), fir: !!o.foundInRaid, alt: false, kind: 'prestige', status: 'prestige', label: p.name || `Prestige ${p.prestigeLevel}`, sub: o.description, done: v.done });
    }
  }
  return out;
}

function sourceLine(r) {
  const where = r.kind === 'quest' || r.kind === 'equipment'
    ? `<a href="#" data-act="goto" data-id="${r.taskId}">${esc(r.label)}</a> <span class="badge status-${r.status}">${STATUS_LABEL[r.status] || r.status}</span>`
    : `<b>${esc(r.label)}</b> <span class="badge">${r.kind}</span>`;
  const qty = r.kind === 'equipment' ? '<span class="badge">equipment</span>' : `×${r.count} ${r.fir ? '<span class="badge fir">FIR</span>' : '<span class="badge nofir">not FIR</span>'}${r.alt ? ' <span class="optional">(one of several accepted items)</span>' : ''}`;
  return `<div>${r.done ? '✓ ' : ''}${where} — ${qty}${r.have && !r.done ? ` <span class="auto">${r.have} collected</span>` : ''}${r.sub ? `<br><span class="auto">${esc(r.sub)}</span>` : ''}</div>`;
}

function renderItems() {
  const f = S.ui.items;
  const text = norm(f.text);
  const reqs = itemRequirements().filter((r) => {
    if (r.done) return false;
    if (!f.includeLocked && r.kind === 'quest' && r.status === 'locked') return false;
    if (r.kind === 'quest' && (r.status === 'unavailable' || r.status === 'failed')) return false;
    if (f.fir === 'fir' && !r.fir) return false;
    if (f.fir === 'nofir' && r.fir) return false;
    if (f.source !== 'all' && r.kind !== f.source) return false;
    return !text || norm(r.item.name).includes(text) || norm(r.item.shortName).includes(text);
  });
  const agg = new Map();
  for (const r of reqs) {
    const a = agg.get(r.item.id) || { item: r.item, fir: 0, nofir: 0, have: 0, sources: [] };
    a[r.fir ? 'fir' : 'nofir'] += r.count;
    a.have += r.have;
    a.sources.push(r);
    agg.set(r.item.id, a);
  }
  const rows = [...agg.values()];
  const sorters = { remaining: (a, b) => (b.fir + b.nofir - b.have) - (a.fir + a.nofir - a.have), name: (a, b) => byName(a.item.name, b.item.name), fir: (a, b) => b.fir - a.fir };
  rows.sort(sorters[f.sortBy] || sorters.remaining);
  const toolbar = `<div class="toolbar">
    ${select('items.fir', f.fir, [['all', 'FIR + not FIR'], ['fir', 'Found in raid only'], ['nofir', 'Not FIR only']], 'Type')}
    ${select('items.source', f.source, [['all', 'Quests + hideout + prestige'], ['quest', 'Quests'], ['hideout', 'Hideout'], ['prestige', 'Prestige']], 'Source')}
    ${select('items.sortBy', f.sortBy, [['remaining', 'Most needed'], ['fir', 'Most FIR needed'], ['name', 'Name']], 'Sort')}
    <label><input type="checkbox" data-ui="items.includeLocked" ${f.includeLocked ? 'checked' : ''}>Include locked (future) quests</label>
    <input type="search" data-ui="items.text" value="${esc(f.text)}" placeholder="Filter items…">
    <span class="count">${rows.length} items</span>
  </div>`;
  if (!rows.length) return toolbar + '<div class="empty">Nothing needed. Either you are done, or your filters are lying to you.</div>';
  return toolbar + `<table class="items"><thead><tr><th>Item</th><th class="num">FIR</th><th class="num">Not FIR</th><th class="num">Collected</th><th>Needed for</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${itemTag(a.item)}<div class="auto">${esc(a.item.name)}</div></td><td class="num">${a.fir || ''}</td><td class="num">${a.nofir || ''}</td><td class="num">${a.have}/${a.fir + a.nofir}</td>
      <td class="sources"><details><summary>${a.sources.length} source${a.sources.length > 1 ? 's' : ''}</summary>${a.sources.map(sourceLine).join('')}</details></td></tr>`).join('')}
  </tbody></table>`;
}

// ---------------------------------------------------------------- render: search
function renderSearch() {
  const q = norm(S.ui.search).trim();
  const head = `<div class="toolbar"><input type="search" data-ui="search" value="${esc(S.ui.search)}" placeholder="Quest or item name…" style="flex:1" id="searchBox">
    <label><input type="checkbox" data-ui="searchCompleted" ${S.ui.searchCompleted ? 'checked' : ''}>Include completed</label></div>`;
  if (q.length < 2) return head + '<div class="empty">Type at least two characters. Searches quest names, objectives, and every item any quest, hideout level or prestige needs.</div>';
  const quests = S.data.tasks.filter((t) => norm(t.name).includes(q) && (S.ui.searchCompleted || taskStatus(t.id) !== 'completed'));
  const reqs = itemRequirements({ includeEquipment: true }).filter((r) => (norm(r.item.name).includes(q) || norm(r.item.shortName).includes(q)) && (S.ui.searchCompleted || !r.done) && r.status !== 'unavailable');
  const byItem = new Map();
  for (const r of reqs) {
    if (!byItem.has(r.item.id)) byItem.set(r.item.id, { item: r.item, sources: [] });
    byItem.get(r.item.id).sources.push(r);
  }
  const items = [...byItem.values()].sort((a, b) => byName(a.item.name, b.item.name));
  const skillHits = activeSkillConfig().skills.filter((sk) => norm(sk.name).includes(q) || norm(sk.description).includes(q));
  return head + `<div class="group-title">Quests (${quests.length})</div>
    ${quests.length ? `<div class="grid">${sortTasks(quests).slice(0, 60).map(taskCard).join('')}</div>` : '<div class="empty">No quests by that name.</div>'}
    ${skillHits.length ? `<div class="group-title">Skills (${skillHits.length})</div><div class="chips">${skillHits.map((sk) => `<button class="chip" data-act="goto-skill" data-id="${esc(sk.name)}">${esc(sk.name)} · lvl ${Number(S.progress.skills[sk.id] || 0)}</button>`).join('')}</div>` : ''}
    <div class="group-title">Items (${items.length})</div>
    ${items.length ? `<table class="items"><thead><tr><th>Item</th><th>Needed for (current &amp; future)</th></tr></thead><tbody>${items.map((a) => `<tr><td>${itemTag(a.item)}<div class="auto">${esc(a.item.name)}</div></td><td class="sources">${a.sources.map(sourceLine).join('')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No current or future quest, hideout level or prestige needs an item matching that. Sell it.</div>'}`;
}

// ---------------------------------------------------------------- render: settings
function renderSettings() {
  const s = S.progress?.settings || {};
  const st = S.status || {};
  const logs = st.logs || {};
  const meta = st.dataMeta || {};
  return `<div class="settings">
    <div class="card"><h3>Character</h3>
      <div class="row"><label>PMC level <input type="number" min="1" max="79" data-set="playerLevel" value="${s.playerLevel || 1}"></label>
        <label>Faction <select data-set="faction">${['USEC', 'BEAR'].map((f) => `<option ${s.faction === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label>Game mode <select data-set="gameMode">${[['regular', 'PvP'], ['pve', 'PvE']].map(([v, t]) => `<option value="${v}" ${s.gameMode === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <div class="kv">Changing game mode re-downloads the matching quest data.</div>
    </div>
    <div class="card"><h3>Game data</h3>
      <div class="kv">Source: <code>${esc(meta.source || '–')}</code> · fetched <code>${esc(meta.fetchedAt || 'never')}</code> · mode <code>${esc(meta.gameMode || '–')}</code></div>
      ${st.refreshError ? `<div class="kv" style="color:var(--bad)">Last refresh failed: ${esc(st.refreshError)}</div>` : ''}
      <div class="row"><button class="btn" data-act="refresh">${st.refreshing ? 'Refreshing…' : 'Refresh from tarkov.dev'}</button>
        <label class="btn">Import data file…<input type="file" accept=".json" data-act="import-data" hidden></label></div>
    </div>
    <div class="card"><h3>Game log detection</h3>
      <div class="kv">Folder: <code>${esc(logs.dir || '–')}</code> — ${logs.available ? `<span style="color:var(--good)">found</span>, ${logs.files} notification log files, ${logs.events} quest events read, last scan ${esc(logs.lastScan || '–')}` : '<span style="color:var(--warn)">not found</span>. Mount your EFT Logs folder (see README) to detect quest starts/completions automatically.'}</div>
      <div class="row"><label>Count game logs from <input type="datetime-local" data-set="logsSince" value="${esc(toLocalInput(s.logsSince))}"></label>
        <button class="btn danger" data-act="fresh-start" title="After a wipe, profile reset or prestige">New start from now…</button></div>
      <div class="kv">Quest events logged before this moment are ignored (the game keeps logs from every wipe, reset and prestige). Changing it re-reads all logs.</div>
      <div class="row"><label><input type="checkbox" data-set="autoLogs" ${s.autoLogs !== false ? 'checked' : ''}> Update quest status from game logs</label>
        <button class="btn" data-act="rescan">Re-read all logs</button></div>
      ${(logs.lastEvents || []).length ? `<div class="kv">Recent: ${logs.lastEvents.slice(0, 8).map((e) => `${esc(idx.tasks.get(e.taskId)?.name || e.taskId)} → ${esc(e.status)}`).join(' · ')}</div>` : ''}
    </div>
    <div class="card"><h3>Progress</h3>
      <div class="row"><button class="btn" data-act="export">Export progress</button>
        <label class="btn">Import progress…<input type="file" accept=".json" data-act="import-progress" hidden></label>
        <button class="btn danger" data-act="reset">Reset all progress</button></div>
    </div>
  </div>`;
}

// ISO timestamp -> value for <input type="datetime-local"> in local time.
function toLocalInput(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------- events
function setUi(path, value) {
  const parts = path.split('.');
  let o = S.ui;
  while (parts.length > 1) o = o[parts.shift()];
  o[parts[0]] = value;
  saveUi();
}

function gotoTask(id) {
  const t = idx.tasks.get(id);
  if (!t) return;
  S.ui.tab = 'quests';
  S.ui.q = { ...S.ui.q, statuses: [], trader: '', map: '', need: '', kappa: false, lightkeeper: false, text: t.name };
  S.ui.open[id] = true;
  saveUi();
  render();
  const el = document.getElementById(`task-${id}`);
  if (el) {
    const group = el.closest('details.group');
    if (group && !group.open) group.open = true;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
  }
}

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('#tabs button');
  if (tab) { S.ui.tab = tab.dataset.tab; saveUi(); render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'FORM') return;
  const { act, id } = el.dataset;
  if (el.tagName === 'A' || el.closest('summary')) e.preventDefault();
  switch (act) {
    case 'tab': S.ui.tab = el.dataset.tab; saveUi(); render(); break;
    case 'qstatus': {
      const s = el.dataset.s;
      const set = new Set(S.ui.q.statuses);
      set.has(s) ? set.delete(s) : set.add(s);
      S.ui.q.statuses = [...set];
      saveUi(); render(); break;
    }
    case 'task': setProgress({ section: 'tasks', id, value: el.dataset.v || null }); break;
    case 'taskchain': {
      const ops = [...allPrereqs(id)].filter((p) => taskStatus(p) !== 'completed').map((p) => ({ section: 'tasks', id: p, value: 'completed' }));
      ops.push({ section: 'tasks', id, value: 'active' });
      setProgress(ops); break;
    }
    case 'step': {
      const { sec, key, d, max } = el.dataset;
      const cur = S.progress[sec][key] === true ? Number(max) : Number(S.progress[sec][key] || 0);
      setProgress({ section: sec, id: key, value: Math.max(0, Math.min(Number(max), cur + Number(d))) }); break;
    }
    case 'build': {
      const { station, level } = idx.levels.get(id);
      // Building a level implies lower levels are built; unbuilding removes this and higher levels.
      const ops = station.levels.map((l) => ({ section: 'hideout', id: l.id, value: el.dataset.v === '1' ? (l.level <= level.level ? true : !!S.progress.hideout[l.id]) : (l.level < level.level && !!S.progress.hideout[l.id]) }));
      setProgress(ops); break;
    }
    case 'goto': gotoTask(id); break;
    case 'stations-open': {
      for (const st of S.data.hideout || []) S.ui.hOpen[st.id] = el.dataset.v === '1';
      saveUi(); render(); break;
    }
    case 'buff-groups':
      document.querySelectorAll('details.buff-group').forEach((d) => { S.ui.buffOpen[d.dataset.buffopen] = el.dataset.v === '1'; });
      saveUi(); render(); break;
    case 'ocr-run': {
      S.ocr.running = true; render();
      try {
        const res = await fetch('/api/ocr/run', { method: 'POST' });
        S.ocr.result = await res.json();
      } catch (err) { S.ocr.result = { error: err.message }; }
      S.ocr.running = false; S.ocr.status = null;
      await poll(true);
      render(); break;
    }
    case 'ocr-dismiss': S.ocr.result = null; render(); break;
    case 'h-show': S.ui.h.show = el.dataset.v; saveUi(); render(); break;
    case 'sk-cat': S.ui.sk.category = el.dataset.v; saveUi(); render(); break;
    case 'sk-view': S.ui.sk.view = el.dataset.v; saveUi(); render(); break;
    case 'goto-skill': S.ui.tab = 'skills'; S.ui.sk = { ...S.ui.sk, text: id, category: '', onlyLeveled: false, view: 'skills' }; saveUi(); render(); break;
    case 'skill-step': {
      const max = S.skills?.maxLevel || 51;
      const v = Math.max(0, Math.min(max, Number(S.progress.skills[id] || 0) + Number(el.dataset.d)));
      setProgress({ section: 'skills', id, value: v || null });
      break;
    }
    case 'prestige-view': S.ui.prestigeView = id || null; saveUi(); render(); break;
    case 'prestige-achieved':
      // Back to "next unachieved" so marking one achieved moves straight on to the next prestige.
      S.ui.prestigeView = null; saveUi();
      setProgress({ section: 'prestige', id: `achieved|${id}`, value: el.dataset.v === '1' || null });
      break;
    case 'quests-open': {
      const v = el.dataset.v === '1';
      for (const t of filteredTasks()) S.ui.open[t.id] = v;
      saveUi(); render(); break;
    }
    case 'groups-open': {
      const v = el.dataset.v === '1';
      for (const [name] of groupTasks(filteredTasks())) S.ui.groups[groupKey(name)] = v;
      saveUi(); render(); break;
    }
    case 'custom-del': setProgress({ section: 'custom', id, value: null }); break;
    case 'refresh': await refreshData(); break;
    case 'rescan': await api('/api/logs/rescan', { method: 'POST' }); await poll(true); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(S.progress, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tarkov-progress-${new Date().toISOString().slice(0, 10)}.json` });
      a.click(); URL.revokeObjectURL(a.href); break;
    }
    case 'fresh-start':
      if (confirm('Start fresh from now (after a wipe, profile reset or prestige)?\n\nThis clears quest, objective and hideout progress, sets your level to 1 and ignores all game logs from before now. Prestige checklists and settings are kept. Export first if unsure.')) {
        await api('/api/progress/fresh-start', { method: 'POST' });
        await poll(true);
      }
      break;
    case 'reset':
      if (confirm('Reset ALL quest, hideout and prestige progress? Export first if unsure.')) { await api('/api/progress/reset', { method: 'POST' }); await poll(true); }
      break;
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.ui) {
    setUi(el.dataset.ui, el.type === 'checkbox' ? el.checked : el.value);
    render();
  } else if (el.dataset.act === 'skill-level') {
    const max = S.skills?.maxLevel || 51;
    const v = Math.max(0, Math.min(max, Math.round(Number(el.value) || 0)));
    setProgress({ section: 'skills', id: el.dataset.id, value: v || null });
  } else if (el.dataset.act === 'check') {
    setProgress({ section: el.dataset.sec, id: el.dataset.key, value: el.checked || null });
  } else if (el.dataset.act === 'custom-toggle') {
    setProgress({ section: 'custom', id: el.dataset.id, value: { ...S.progress.custom[el.dataset.id], done: el.checked } });
  } else if (el.dataset.set) {
    const key = el.dataset.set;
    let value = el.type === 'checkbox' ? el.checked : key === 'playerLevel' ? Math.max(1, Number(el.value) || 1) : el.value;
    // datetime-local is in the viewer's local time; store an absolute timestamp.
    if (key === 'logsSince') value = el.value ? new Date(el.value).toISOString() : '';
    await setProgress({ section: 'settings', id: key, value });
    if (key === 'gameMode') await refreshData();
  } else if (el.dataset.act === 'import-data' || el.dataset.act === 'import-progress') {
    const file = el.files[0];
    if (!file) return;
    try {
      const body = await file.text();
      const res = await api(el.dataset.act === 'import-data' ? '/api/data/import' : '/api/progress/import', { method: 'POST', body });
      if (!res.ok) throw new Error(res.body.error);
      await loadAll();
    } catch (err) { alert(`Import failed: ${err.message}`); }
  }
});

document.addEventListener('toggle', (e) => {
  const id = e.target.dataset?.open;
  if (id) { S.ui.open[id] = e.target.open; saveUi(); }
  if (e.target.hasAttribute?.('data-skill-overview')) { S.ui.skillOverviewOpen = e.target.open; saveUi(); }
  const bo = e.target.dataset?.buffopen;
  if (bo) { S.ui.buffOpen[bo] = e.target.open; saveUi(); }
  const h = e.target.dataset?.hopen;
  if (h) { S.ui.hOpen[h] = e.target.open; saveUi(); }
  const g = e.target.dataset?.group;
  if (g) { S.ui.groups[g] = e.target.open; saveUi(); }
}, true);

// Text inputs re-render while typing; keep focus and caret position.
let typingTimer;
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'globalSearch') {
    S.ui.search = el.value; S.ui.tab = 'search'; saveUi();
    clearTimeout(typingTimer); typingTimer = setTimeout(render, 150);
    return;
  }
  if (!el.dataset.ui || el.type !== 'search') return;
  setUi(el.dataset.ui, el.value);
  if (el.dataset.ui === 'search') $('#globalSearch').value = el.value;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    const sel = `[data-ui="${el.dataset.ui}"]`, pos = el.selectionStart;
    render();
    const again = document.querySelector(sel);
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  }, 200);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-act="custom-add"]');
  if (!form) return;
  e.preventDefault();
  const text = form.text.value.trim();
  if (!text) return;
  setProgress({ section: 'custom', id: `c${Date.now().toString(36)}`, value: { text, done: false, prestigeId: form.dataset.pid } });
});

// ---------------------------------------------------------------- loading & sync
async function refreshData() {
  banner('Downloading game data from tarkov.dev…');
  let serverOk = false;
  try { serverOk = (await api('/api/data/refresh', { method: 'POST' })).ok; } catch { /* fall back below */ }
  if (!serverOk) await browserDownload();
  await loadAll();
}

// Fallback for when the container's own requests to tarkov.dev are rejected: the browser runs
// the same queries (tarkov.dev allows cross-origin requests) and uploads the result.
let browserTried = false;
async function browserDownload() {
  browserTried = true;
  banner('Server download failed – trying to download game data directly from your browser…');
  try {
    const { body: cfg } = await api('/api/data/queries');
    const out = {};
    const errors = [];
    for (const [key, variants] of Object.entries(cfg.queries)) {
      for (const query of variants) {
        try {
          const res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
          const json = await res.json();
          if (!json.data?.[key]) throw new Error((json.errors || []).map((e) => e.message).join('; ') || 'empty response');
          out[key] = json.data[key];
          break;
        } catch (err) { errors.push(`${key}: ${err.message}`); }
      }
    }
    if (!out.tasks || !out.hideoutStations) throw new Error(errors.join(' / '));
    const payload = { meta: { source: `${cfg.url} (via browser)`, gameMode: cfg.gameMode, prestigeError: out.prestige ? null : errors.filter((e) => e.startsWith('prestige')).join(' / ') }, tasks: out.tasks, hideout: out.hideoutStations, prestige: out.prestige || [] };
    const res = await api('/api/data/import', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(res.body.error);
    banner('');
    return true;
  } catch (err) {
    const msg = /failed to fetch/i.test(err.message) ? 'your browser could not reach tarkov.dev either (it is down or blocked)' : esc(err.message);
    banner(`Browser download failed too: ${msg}. The tracker keeps retrying automatically.`);
    return false;
  }
}

async function loadAll() {
  const [st, prog, data, skills] = await Promise.all([api('/api/status'), api('/api/progress'), api('/api/data'), api('/api/skills').catch(() => ({ body: { skills: [] } }))]);
  S.skills = skills.body;
  S.status = st.body;
  S.progress = prog.body;
  S.progress.skills ||= {};
  if (data.ok) { S.data = data.body; buildIndex(); }
  memo = {};
  if (!S.data && S.status.refreshError && !S.status.refreshing && !browserTried) {
    if (await browserDownload()) return loadAll();
  }
  if (S.data && !S.status.refreshError) banner('');
  else if (S.status.refreshError && S.data) banner(`Could not refresh game data (${esc(S.status.refreshError)}). Using cached data from ${esc(S.data.meta?.fetchedAt)}.`);
  render();
}

async function poll(force = false) {
  try {
    const { body } = await api('/api/status');
    const hadData = S.status?.hasData;
    S.status = body;
    if (!hadData && body.hasData) return loadAll();
    if (force || body.rev !== S.progress?.rev) {
      S.progress = (await api('/api/progress')).body;
      memo = {};
      render();
    } else if ((S.ui.tab === 'settings' || !S.data) && !$('#view').contains(document.activeElement)) render();
  } catch { /* server restarting */ }
}

$('#globalSearch').value = S.ui.search || '';
loadAll().catch((err) => banner(`Cannot reach tracker server: ${esc(err.message)}`));
setInterval(poll, 5000);
