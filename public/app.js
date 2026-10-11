'use strict';
/* Tarkov Tracker front-end. Vanilla JS, no build step. */

// ---------------------------------------------------------------- state
const S = {
  data: null,
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
  };
  try {
    const saved = JSON.parse(localStorage.getItem('tt-ui') || '{}');
    return { ...defaults, ...saved, q: { ...defaults.q, ...saved.q }, h: { ...defaults.h, ...saved.h }, items: { ...defaults.items, ...saved.items } };
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
function objRow(section, key, o, { disabled = false } = {}) {
  const v = objValue(section, key, o);
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
  (level.skillRequirements || []).forEach((r, i) => reqs.push({ kind: 'skill', key: `${level.id}|skill|${i}`, label: `${r.name} level ${r.level}` }));
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
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.ui.tab));
  const view = $('#view');
  if (S.ui.tab === 'settings') { view.innerHTML = renderSettings(); return; }
  if (!S.data) { view.innerHTML = renderNoData(); return; }
  const fn = { quests: renderQuests, hideout: renderHideout, prestige: renderPrestige, items: renderItems, search: renderSearch }[S.ui.tab] || renderQuests;
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
  return toolbar + groupTasks(list).map(([name, ts]) => `${name ? `<div class="group-title">${esc(name)} <span class="count">(${ts.length})</span></div>` : ''}<div class="grid">${ts.map(taskCard).join('')}</div>`).join('');
}

function taskCard(t) {
  const st = taskStatus(t.id);
  const p = S.progress.tasks[t.id];
  const pct = Math.round(taskProgress(t) * 100);
  const open = S.ui.open[t.id] ?? (st === 'active');
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
  return `<div class="card st-${st}" id="task-${t.id}">
    <div class="card-head"><div class="title">${t.wikiLink ? `<a href="${esc(t.wikiLink)}" target="_blank" rel="noopener">${esc(t.name)}</a>` : esc(t.name)}</div>
      <span class="badge status-${st}">${STATUS_LABEL[st]}</span>${p?.source === 'log' ? '<span class="badge log" title="Detected from game logs">log</span>' : ''}</div>
    <div class="meta"><span>${esc(t.trader?.name || '?')}</span>·<span>${esc(taskMaps(t).join(', '))}</span>·<span>Lvl ${t.minPlayerLevel || 1}</span>
      ${t.kappaRequired ? '<span class="badge kappa">Kappa</span>' : ''}${t.lightkeeperRequired ? '<span class="badge kappa">Lightkeeper</span>' : ''}
      ${t.factionName && t.factionName !== 'Any' ? `<span class="badge">${esc(t.factionName)}</span>` : ''}</div>
    ${t.objectives.length ? `<div class="progressbar"><div style="width:${pct}%"></div></div>` : ''}
    <details data-open="${t.id}" ${open ? 'open' : ''}><summary>${t.objectives.length} objectives · ${pct}%</summary>
      <ul class="objs">${t.objectives.map((o) => objRow('objectives', o.id, o)).join('')}</ul>
      ${prereqs.length ? `<div class="prereqs">Requires: ${prereqs.join(', ')}</div>` : ''}
    </details>
    <div class="actions">${actions.join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- render: hideout
const REQ_NEEDS = { item: 'Items', fir: 'FIR items', trader: 'Trader loyalty', skill: 'Skills', station: 'Other stations' };

function renderHideout() {
  const f = S.ui.h;
  const text = norm(f.text);
  let stations = (S.data.hideout || []).filter((st) => st.levels.length);
  const rows = [];
  for (const st of stations) {
    const built = builtLevel(st);
    let levels = st.levels;
    if (f.show === 'next') levels = levels.filter((l) => l.level === built + 1);
    else if (f.show === 'todo') levels = levels.filter((l) => l.level > built);
    else if (f.show === 'built') levels = levels.filter((l) => l.level <= built);
    levels = levels.filter((l) => {
      const reqs = hideoutReqs(l);
      if (f.need === 'fir' && !reqs.some((r) => r.kind === 'item' && r.fir)) return false;
      if (f.need && f.need !== 'fir' && !reqs.some((r) => r.kind === f.need)) return false;
      if (text && !norm(st.name).includes(text) && !reqs.some((r) => norm(r.item?.name || r.label).includes(text))) return false;
      return true;
    });
    if (levels.length) rows.push({ st, built, levels });
  }
  const readiness = (r) => {
    const reqs = hideoutReqs(r.levels[0]);
    return reqs.length ? reqs.filter((x) => x.done).length / reqs.length : 1;
  };
  rows.sort(f.sortBy === 'ready' ? (a, b) => readiness(b) - readiness(a) || byName(a.st.name, b.st.name) : (a, b) => byName(a.st.name, b.st.name));
  const toolbar = `<div class="toolbar">
    ${select('h.show', f.show, [['next', 'Next level only'], ['todo', 'All unbuilt levels'], ['built', 'Built levels'], ['all', 'All levels']], 'Show')}
    ${select('h.need', f.need, [['', 'Anything'], ...Object.entries(REQ_NEEDS)], 'Needs')}
    ${select('h.sortBy', f.sortBy, [['name', 'Station name'], ['ready', 'Closest to buildable']], 'Sort')}
    <input type="search" data-ui="h.text" value="${esc(f.text)}" placeholder="Filter station or item…">
    <span class="count">${rows.length} stations</span>
  </div>`;
  if (!rows.length) return toolbar + '<div class="empty">Nothing to show. Everything built? Show-off.</div>';
  return toolbar + `<div class="grid">${rows.map(stationCard).join('')}</div>`;
}

function stationCard({ st, built, levels }) {
  const max = st.levels[st.levels.length - 1]?.level || 0;
  return `<div class="card ${built >= max ? 'st-completed' : 'st-available'}">
    <div class="card-head"><div class="title">${esc(st.name)}</div><span class="badge">Level ${built}/${max}</span></div>
    ${levels.map((l) => levelBlock(st, l)).join('')}
  </div>`;
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
    <div class="lvl-title">Level ${l.level} ${built ? '<span class="badge status-completed">Built</span>' : ready ? '<span class="badge status-available">Ready to build</span>' : ''}<span class="count">${time}</span>
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
  return html + `<div class="grid">${list.map((p) => {
    const conds = p.conditions || [];
    const done = conds.filter((o) => objValue('prestige', `${p.id}|${o.id}`, o).done).length;
    return `<div class="card ${done === conds.length && conds.length ? 'st-completed' : 'st-active'}">
      <div class="card-head"><div class="title">${esc(p.name || `Prestige ${p.prestigeLevel}`)}</div><span class="badge">${done}/${conds.length}</span></div>
      <div class="progressbar"><div style="width:${conds.length ? Math.round((done / conds.length) * 100) : 0}%"></div></div>
      <ul class="objs">${conds.map((o) => objRow('prestige', `${p.id}|${o.id}`, o)).join('')}</ul>
      ${customBlock(p.id)}
    </div>`;
  }).join('')}</div>`;
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
  return head + `<div class="group-title">Quests (${quests.length})</div>
    ${quests.length ? `<div class="grid">${sortTasks(quests).slice(0, 60).map(taskCard).join('')}</div>` : '<div class="empty">No quests by that name.</div>'}
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
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
}

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('#tabs button');
  if (tab) { S.ui.tab = tab.dataset.tab; saveUi(); render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'FORM') return;
  const { act, id } = el.dataset;
  if (el.tagName === 'A') e.preventDefault();
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
  const [st, prog, data] = await Promise.all([api('/api/status'), api('/api/progress'), api('/api/data')]);
  S.status = st.body;
  S.progress = prog.body;
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
