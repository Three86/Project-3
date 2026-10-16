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
    recOpen: {},
    rec: { text: '', showLocked: false },
    buffOpen: {},
    sk: { text: '', category: '', sortBy: 'category', onlyLeveled: false, view: 'skills' },
  };
  try {
    const saved = JSON.parse(localStorage.getItem('tt-ui') || '{}');
    return { ...defaults, ...saved, q: { ...defaults.q, ...saved.q }, h: { ...defaults.h, ...saved.h }, items: { ...defaults.items, ...saved.items }, sk: { ...defaults.sk, ...saved.sk }, groups: { ...saved.groups }, hOpen: { ...saved.hOpen }, recOpen: { ...saved.recOpen }, rec: { ...defaults.rec, ...saved.rec }, buffOpen: { ...saved.buffOpen } };
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

// ---------------------------------------------------------------- Basecoat UI helpers
// Markup follows basecoat-css 1.0.2 (public/vendor/basecoat). Every element keeps the data-* attributes
// the delegated event handlers below rely on, so behaviour does not depend on the styling.
const ICON_PATHS = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
};
const icon = (name, cls = '') => `<svg class="lucide ${cls}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
const spinner = () => `<svg aria-label="Loading" role="status" class="animate-spin lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS.loader}</svg>`;

// <button class="btn">. opts: variant (primary|secondary|outline|ghost|link|destructive), size
// (xs|sm|lg|icon|icon-xs|icon-sm), tip (tooltip text), side, disabled, cls. attrs: raw data-* attributes.
function btn(label, attrs = '', { variant, size, tip, side, disabled, cls = '' } = {}) {
  const b = `<button type="button" class="btn ${cls}"${variant ? ` data-variant="${variant}"` : ''}${size ? ` data-size="${size}"` : ''}${tip && !disabled ? ` data-tooltip="${esc(tip)}"${side ? ` data-side="${side}"` : ''}` : ''} ${attrs}${disabled ? ' disabled' : ''}>${label}</button>`;
  // Disabled buttons get no hover events; wrap them so the tooltip still shows (as in the Basecoat docs).
  return tip && disabled ? `<span class="tip-wrap" data-tooltip="${esc(tip)}"${side ? ` data-side="${side}"` : ''}>${b}</span>` : b;
}
// <span class="badge">. variant: primary (default) | secondary | outline | destructive | ghost.
const badge = (text, variant = 'outline', cls = '', tip = '') => `<span class="badge ${cls}" data-variant="${variant}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>${text}</span>`;
// Labelled control on one line (toolbar fields).
const fieldInline = (label, control) => `<label class="label tb-field"><span>${label}</span>${control}</label>`;
// Checkbox with Basecoat styling; attrs carry the data-* the change handler needs.
const checkbox = (attrs, checked, extra = '') => `<input type="checkbox" class="input" ${attrs} ${checked ? 'checked' : ''} ${extra}>`;
// Switch with its label.
const toggleSwitch = (label, attrs, checked) => `<label class="label sw-field"><input type="checkbox" role="switch" class="input" ${attrs} ${checked ? 'checked' : ''}>${label}</label>`;
// Basecoat progress bar.
function progressBar(done, total, label = 'Progress') {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}
// Counter for multi-count requirements: [−] 3/5 [+].
function stepperControl(attrs, cur, target, disabled = false) {
  return `<div role="group" class="button-group stepper" aria-label="Count">
    ${btn(icon('minus'), `${attrs} data-d="-1" data-max="${target}" aria-label="One less"`, { variant: 'outline', size: 'icon-xs', disabled })}
    <span class="step-val">${cur}/${target}</span>
    ${btn(icon('plus'), `${attrs} data-d="1" data-max="${target}" aria-label="One more"`, { variant: 'outline', size: 'icon-xs', disabled })}</div>`;
}
// Empty state.
const emptyState = (title, text = '', footer = '', ic = 'info') => `<section class="empty">
  <header><figure>${icon(ic)}</figure>${title ? `<h3>${title}</h3>` : ''}${text ? `<p>${text}</p>` : ''}</header>${footer ? `<footer>${footer}</footer>` : ''}</section>`;
// Dropdown menu (Basecoat dropdown-menu). items: [{ label, attrs, destructive, disabled }] or 'sep'.
let uid = 0;
function dropdownMenu(triggerLabel, items, { tip = 'More actions', align = 'end' } = {}) {
  const id = `dd${++uid}`;
  return `<div id="${id}" class="dropdown-menu">
    <button type="button" id="${id}-trigger" aria-haspopup="menu" aria-controls="${id}-menu" aria-expanded="false" class="btn" data-variant="ghost" data-size="icon-sm" aria-label="${esc(tip)}">${triggerLabel}</button>
    <div id="${id}-popover" data-popover aria-hidden="true" data-align="${align}">
      <div role="menu" id="${id}-menu" aria-labelledby="${id}-trigger">${items.map((it) => it === 'sep' ? '<hr role="separator">' : `<div role="menuitem" ${it.attrs || ''}${it.destructive ? ' data-variant="destructive"' : ''}${it.disabled ? ' aria-disabled="true"' : ''}>${it.label}</div>`).join('')}</div>
    </div></div>`;
}
// Popover: trigger button plus floating content (Basecoat popover).
function popover(triggerLabel, content, { variant = 'outline', size = 'xs', align = 'start', cls = '' } = {}) {
  const id = `pop${++uid}`;
  return `<div id="${id}" class="popover ${cls}">
    <button id="${id}-trigger" type="button" aria-expanded="false" aria-controls="${id}-popover" class="btn" data-variant="${variant}" data-size="${size}">${triggerLabel}</button>
    <div id="${id}-popover" data-popover aria-hidden="true" data-align="${align}">${content}</div></div>`;
}

// Toast notification (Basecoat toaster). Basecoat inserts title/description as HTML, so escape here.
function toast(category, title, description = '') {
  const t = document.getElementById('toaster');
  if (t?.toast) t.toast({ category, title: esc(title), description: esc(description) });
}

// Confirmation dialog (Basecoat alert-dialog); resolves true when confirmed.
function confirmDialog(title, text, okLabel = 'Continue', destructive = false) {
  const d = document.getElementById('confirmDialog');
  d.querySelector('h2').textContent = title;
  d.querySelector('p').textContent = text;
  const ok = d.querySelector('[data-confirm="1"]');
  ok.textContent = okLabel;
  ok.toggleAttribute('data-variant', destructive);
  if (destructive) ok.dataset.variant = 'destructive';
  return new Promise((resolve) => {
    const done = (v) => { d.removeEventListener('click', onClick); d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); };
    const onClick = (e) => { const b = e.target.closest('[data-confirm]'); if (b) done(b.dataset.confirm === '1'); };
    const onClose = () => done(false); // Esc
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
    d.showModal();
    d.querySelector('[data-confirm="0"]').focus();
  });
}

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
    toast('error', 'Could not save progress', err.message);
  }
}

// Message strip under the top bar (Basecoat alert). kind: 'info' | 'error'.
function banner(html, kind = /fail|cannot|could not|error/i.test(html || '') ? 'error' : 'info') {
  const b = $('#banner');
  b.innerHTML = html ? `<div class="alert"${kind === 'error' ? ' data-variant="destructive"' : ''}>${icon(kind === 'error' ? 'alert' : 'info')}<section>${html}</section></div>` : '';
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
// Hideout station a requirement refers to (normalised data has hideoutStation; older caches the raw id).
function stationOf(o) {
  const id = o.hideoutStation?.id || o.station;
  if (!id) return null;
  return idx.stations.get(id) || { id, name: o.hideoutStation?.name || 'Hideout station', levels: [] };
}

// Title for requirements the game ships without description text (mostly prestige conditions):
// "Level: 25", "Strength level 10", "Medstation level 3", "Have 1,000,000 Roubles".
function objTitle(o) {
  switch (o.type) {
    case 'playerLevel': return o.playerLevel ? `Level: ${o.playerLevel}` : null;
    case 'skill': return o.skillLevel ? `${o.skillLevel.name} level ${o.skillLevel.level}` : null;
    case 'hideoutStation': return `${stationOf(o)?.name || 'Hideout station'} level ${o.stationLevel ?? '?'}`;
    case 'haveItem': {
      const it = objItems(o)[0];
      return `Have ${Number(o.count || 1).toLocaleString('en-US')} ${it?.name || 'items'}`;
    }
    case 'taskStatus': return o.task ? `Complete ${o.task.name}` : null;
    default: return null;
  }
}
const readableType = (t) => String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function autoValue(o) {
  if (o.type === 'hideoutStation' && o.stationLevel) {
    const st = stationOf(o);
    if (st?.levels?.length) {
      const built = builtLevel(st);
      return { done: built >= o.stationLevel, why: `your ${st.name}: level ${built}` };
    }
  }
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
  return `<span class="it-tag" title="${esc(it.name)}">${img}${esc(it.shortName || it.name)}</span>`;
}

function objTags(o) {
  const tags = [];
  const items = objItems(o);
  if (items.length) tags.push(items.length > 1 ? `<span class="badge" data-variant="outline">any of:</span> ${items.map(itemTag).join(' ')}` : itemTag(items[0]));
  if (['giveItem', 'findItem', 'plantItem', 'mark', 'useItem', 'sellItem'].includes(o.type) && items.length) {
    tags.push(o.foundInRaid ? badge('FIR', 'primary', 'fir', 'Must be found in raid') : badge('not FIR', 'outline', 'nofir', 'Does not need to be found in raid'));
  }
  if (o.questItem) tags.push(`<span class="badge" data-variant="outline">quest item: ${esc(o.questItem.name)}</span>`);
  if (o.dogTagLevel) tags.push(`<span class="badge" data-variant="outline">dogtag lvl ≥ ${o.dogTagLevel}</span>`);
  if (o.minDurability || (o.maxDurability && o.maxDurability < 100)) tags.push(`<span class="badge" data-variant="outline">durability ${o.minDurability || 0}–${o.maxDurability ?? 100}%</span>`);
  if (o.targetNames?.length) tags.push(`<span class="badge" data-variant="outline">target: ${esc(o.targetNames.join(', '))}</span>`);
  if (o.bodyParts?.length) tags.push(`<span class="badge" data-variant="outline">${esc(o.bodyParts.join(', '))}</span>`);
  if (o.zoneNames?.length) tags.push(`<span class="badge" data-variant="outline">zone: ${esc(o.zoneNames.join(', '))}</span>`);
  if (o.usingWeapon?.length) tags.push(`<span class="badge" data-variant="outline">weapon:</span> ${o.usingWeapon.slice(0, 6).map(itemTag).join(' ')}${o.usingWeapon.length > 6 ? ` +${o.usingWeapon.length - 6}` : ''}`);
  for (const set of o.wearing || []) if (set?.length) tags.push(`<span class="badge" data-variant="outline">wearing:</span> ${set.map(itemTag).join(' + ')}`);
  if (o.notWearing?.length) tags.push(`<span class="badge" data-variant="outline">not wearing: ${esc(o.notWearing.map((i) => i.shortName || i.name).join(', '))}</span>`);
  if (o.skillLevel) tags.push(`<span class="badge" data-variant="outline">${esc(o.skillLevel.name)} ${o.skillLevel.level}</span>`);
  if (o.exitStatus?.length) tags.push(`<span class="badge" data-variant="outline">${esc(o.exitStatus.join('/'))}</span>`);
  if (o.maps?.length) tags.push(`<span class="badge" data-variant="outline">${esc(o.maps.map((m) => m.name).join(', '))}</span>`);
  return tags.join(' ');
}

// Render one objective row with a checkbox or a counter.
function objRow(section, key, o, { disabled = false, forceDone = false } = {}) {
  const v = forceDone ? { cur: objTarget(o), target: objTarget(o), done: true } : objValue(section, key, o);
  let control;
  if (v.auto) control = `<span class="tip-wrap" data-tooltip="Tracked automatically" data-side="right">${checkbox('disabled aria-label="Tracked automatically"', v.done)}</span>`;
  else if (v.target > 1) control = stepperControl(`data-act="step" data-sec="${section}" data-key="${esc(key)}"`, v.cur, v.target, disabled);
  else control = checkbox(`data-act="check" data-sec="${section}" data-key="${esc(key)}" aria-label="Done"`, v.done, disabled ? 'disabled' : '');
  const auto = v.auto ? `<span class="auto">auto – ${esc(v.auto.why)}</span>` : '';
  // No description from the game: build the title from the data and skip the (now redundant) tags.
  const generated = !o.description || o.description === o.type;
  if (generated) {
    const title = objTitle(o) || readableType(o.type);
    const icon = o.type === 'haveItem' && objItems(o)[0]?.iconLink ? `<img class="req-icon" src="${esc(objItems(o)[0].iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<li class="${v.done ? 'done' : ''}">${control}<div class="body">
      <div class="desc">${icon}${esc(title)} ${o.optional ? '<span class="optional">(optional)</span>' : ''}</div>
      ${auto ? `<div class="tags">${auto}</div>` : ''}
    </div></li>`;
  }
  const kind = [...objNeeds(o)].map((n) => NEEDS[n]).join(' · ');
  return `<li class="${v.done ? 'done' : ''}">${control}<div class="body">
    <div class="desc">${esc(o.description)} ${o.optional ? '<span class="optional">(optional)</span>' : ''}</div>
    <div class="tags"><span class="type-icon">${esc(kind)}</span> ${objTags(o)} ${auto}</div>
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
  document.querySelectorAll('#tabs [role=tab]').forEach((b) => {
    const on = b.dataset.tab === S.ui.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const view = $('#view');
  view.hidden = false;
  view.setAttribute('aria-labelledby', `tab-${S.ui.tab}`);
  uid = 0;
  const fn = { quests: renderQuests, hideout: renderHideout, recipes: renderRecipes, prestige: renderPrestige, skills: renderSkills, buffs: renderBuffs, items: renderItems, search: renderSearch, settings: renderSettings }[S.ui.tab] || renderQuests;
  view.innerHTML = S.data || ['settings', 'skills', 'buffs'].includes(S.ui.tab) ? fn() : renderNoData();
  // Basecoat's MutationObserver initialises new components on its own; this catches any it missed.
  window.basecoat?.initAll();
}

function renderNoData() {
  const st = S.status || {};
  const text = `${st.refreshing ? 'Downloading quest &amp; hideout data from tarkov.dev…' : 'Quest and hideout definitions are downloaded once from tarkov.dev and cached locally.'}
    ${st.refreshError ? `<br><span class="bad">Last attempt failed: ${esc(st.refreshError)}</span>` : ''}
    ${/server unavailable/i.test(st.refreshError || '') ? '<br>tarkov.dev reports its own server is down. That is an outage on their side, not a problem with your setup. The tracker retries every 5 minutes and loads as soon as tarkov.dev is back.' : ''}`;
  return emptyState('No game data yet', text, `<div class="row-gap">${btn(st.refreshing ? `${spinner()} Downloading…` : `${icon('download')} Download now`, 'data-act="refresh"', { disabled: !!st.refreshing })}
    ${btn('Import a data file', 'data-act="tab" data-tab="settings"', { variant: 'outline' })}</div>`, 'database');
}

function select(name, value, options, label) {
  return fieldInline(label, `<select class="select" data-size="sm" data-ui="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
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
    <div class="chips" role="group" aria-label="Status">${Object.keys(STATUS_LABEL).map((s) => {
      const on = f.statuses.includes(s);
      return btn(`${STATUS_LABEL[s]} ${badge(counts[s] || 0, on ? 'secondary' : 'outline', 'count-badge')}`, `data-act="qstatus" data-s="${s}" aria-pressed="${on}"`, { variant: on ? 'primary' : 'outline', size: 'sm' });
    }).join('')}</div>
    <div class="tb-row">
    ${select('q.trader', f.trader, [['', 'All traders'], ...idx.traders.map((x) => [x, x])], 'Trader')}
    ${select('q.map', f.map, [['', 'All maps'], ...idx.maps.map((x) => [x, x])], 'Map')}
    ${select('q.need', f.need, [['', 'Anything'], ...Object.entries(NEEDS)], 'Needs')}
    ${select('q.groupBy', f.groupBy, [['none', 'No grouping'], ['trader', 'Trader'], ['map', 'Map'], ['need', 'Requirement type'], ['status', 'Status']], 'Group')}
    ${select('q.sortBy', f.sortBy, [['level', 'Level'], ['trader', 'Trader'], ['map', 'Map'], ['name', 'Name'], ['progress', 'Progress']], 'Sort')}
    <label class="label cb-field">${checkbox('data-ui="q.kappa"', f.kappa)}Kappa</label>
    <label class="label cb-field">${checkbox('data-ui="q.lightkeeper"', f.lightkeeper)}Lightkeeper</label>
    <input type="search" class="input tb-search" data-ui="q.text" value="${esc(f.text)}" placeholder="Filter…" aria-label="Filter quests">
    <span class="count">${list.length} quests</span></div>
  </div>`;
  if (!list.length) return toolbar + emptyState('No quests match these filters', 'Loosen a filter or pick more statuses above.', '', 'search');
  const groups = groupTasks(list);
  const tools = `<div class="collapse-tools">
    <div role="group" class="button-group">${btn('Expand all quests', 'data-act="quests-open" data-v="1"', { variant: 'outline', size: 'sm' })}${btn('Collapse all quests', 'data-act="quests-open" data-v="0"', { variant: 'outline', size: 'sm' })}</div>
    ${groups.length > 1 ? `<div role="group" class="button-group">${btn('Expand all groups', 'data-act="groups-open" data-v="1"', { variant: 'outline', size: 'sm' })}${btn('Collapse all groups', 'data-act="groups-open" data-v="0"', { variant: 'outline', size: 'sm' })}</div>` : ''}</div>`;
  // Per-group completion across every quest in that group (not just the filtered ones).
  const totals = ['trader', 'map', 'need'].includes(f.groupBy) ? new Map(groupTasks(S.data.tasks)) : new Map();
  const sections = groups.map(([name, ts]) => {
    const grid = `<div class="grid">${ts.map(taskCard).join('')}</div>`;
    if (!name) return grid;
    const key = groupKey(name);
    const active = ts.filter((t) => taskStatus(t.id) === 'active').length;
    const all = totals.get(name);
    const doneAll = all ? all.filter((t) => taskStatus(t.id) === 'completed').length : 0;
    return `<details class="group" data-group="${esc(key)}" ${S.ui.groups[key] === false ? '' : 'open'}>
      <summary><span class="group-name">${esc(name)}</span><span class="count">${ts.length} quest${ts.length === 1 ? '' : 's'}${active ? ` · ${active} active` : ''}</span>
        ${all ? `<span class="group-progress" data-tooltip="${doneAll} of ${all.length} ${esc(name)} quests completed">${progressBar(doneAll, all.length, `${name} quests completed`)}<span class="count">${doneAll}/${all.length}</span></span>` : ''}${icon('chevron')}</summary>
      <section>${grid}</section></details>`;
  });
  return toolbar + tools + (groups.length === 1 && !groups[0][0] ? sections.join('') : `<section class="accordion groups" data-multiple>${sections.join('')}</section>`);
}

function taskCard(t) {
  const st = taskStatus(t.id);
  const p = S.progress.tasks[t.id];
  const pct = Math.round(taskProgress(t) * 100);
  const open = S.ui.open[t.id] ?? false;
  const actions = [];
  if (st !== 'active' && st !== 'completed') actions.push(btn('Start', `data-act="task" data-id="${t.id}" data-v="active"`, { variant: st === 'available' ? 'primary' : 'outline', size: 'sm' }));
  if (st !== 'completed') actions.push(btn('Complete', `data-act="task" data-id="${t.id}" data-v="completed"`, { variant: st === 'active' ? 'primary' : 'outline', size: 'sm' }));
  const more = [];
  if (st === 'locked') more.push({ label: 'Start + complete prereqs', attrs: `data-act="taskchain" data-id="${t.id}" title="Mark all prerequisite quests completed and start this one"` });
  if (st === 'active') more.push({ label: 'Mark failed', attrs: `data-act="task" data-id="${t.id}" data-v="failed"`, destructive: true });
  if (p) more.push({ label: 'Reset quest', attrs: `data-act="task" data-id="${t.id}" data-v=""` });
  const prereqs = t.taskRequirements.filter((r) => r.task).map((r) => {
    const ok = autoValue({ type: 'taskStatus', task: r.task, status: r.status }).done;
    return { ok, html: `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '✗'} <a href="#" data-act="goto" data-id="${r.task.id}">${esc(r.task.name)}</a>${reqStatuses(r).join() !== 'complete' ? ` (${esc(reqStatuses(r).join('/'))})` : ''}</span>` };
  });
  // Locked: a popover explains exactly what is missing.
  let why = '';
  if (st === 'locked') {
    const missing = prereqs.filter((x) => !x.ok).map((x) => `<li>${x.html}</li>`);
    const lvl = (t.minPlayerLevel || 0) > S.progress.settings.playerLevel ? `<li>Reach level ${t.minPlayerLevel} (you are ${S.progress.settings.playerLevel})</li>` : '';
    why = popover(`${icon('lock')} Why locked?`, `<header><h4>Still needed</h4></header><ul class="why-list">${missing.join('')}${lvl}${!missing.length && !lvl ? '<li>A prerequisite chain is still locked.</li>' : ''}</ul>`, { variant: 'ghost', size: 'sm', align: 'start' });
  }
  const pending = t.objectives.filter((o) => !o.optional && !objValue('objectives', o.id, o).done).length;
  return `<details class="card qcard st-${st}" data-size="sm" id="task-${t.id}" data-open="${t.id}" ${open ? 'open' : ''}>
    <summary>
      <div class="qhead"><span class="title">${esc(t.name)}</span>
        ${p?.source === 'log' ? badge('log', 'secondary', 'log', 'Detected from game logs') : ''}${badge(STATUS_LABEL[st], 'outline', `status-${st}`)}${icon('chevron', 'caret')}</div>
      <div class="meta"><span>${esc(t.trader?.name || '?')}</span>·<span>${esc(taskMaps(t).join(', '))}</span>·<span>Lvl ${t.minPlayerLevel || 1}</span>
        ${t.objectives.length ? `·<span>${pending ? `${pending} left` : 'all objectives done'} (${pct}%)</span>` : ''}
        ${t.kappaRequired ? badge('Kappa', 'outline', 'kappa') : ''}${t.lightkeeperRequired ? badge('Lightkeeper', 'outline', 'kappa') : ''}
        ${t.factionName && t.factionName !== 'Any' ? badge(esc(t.factionName)) : ''}</div>
      ${t.objectives.length ? progressBar(pct, 100, 'Objectives done') : ''}
    </summary>
    <section>
      <ul class="objs">${t.objectives.map((o) => objRow('objectives', o.id, o)).join('')}</ul>
      ${prereqs.length ? `<div class="prereqs">Requires: ${prereqs.map((x) => x.html).join(', ')}</div>` : ''}
    </section>
    <footer class="actions">${actions.join('')}${why}${t.wikiLink ? `<a class="btn" data-variant="ghost" data-size="sm" href="${esc(t.wikiLink)}" target="_blank" rel="noopener">Wiki ${icon('external')}</a>` : ''}
      ${more.length ? `<span class="spacer"></span>${dropdownMenu(icon('more'), more, { tip: 'More quest actions' })}` : ''}</footer>
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
    <input type="search" class="input tb-search" data-ui="h.text" value="${esc(f.text)}" placeholder="Filter station or item…" aria-label="Filter stations">
    <span class="count">${rows.length} stations</span>
  </div>`;
  const tools = `<div class="collapse-tools">
    <div role="group" class="button-group">${btn('Expand all', 'data-act="stations-open" data-v="1"', { variant: 'outline', size: 'sm' })}${btn('Collapse all', 'data-act="stations-open" data-v="0"', { variant: 'outline', size: 'sm' })}</div>
    ${locked ? `<span class="auto">${icon('lock')} ${locked} station${locked === 1 ? '' : 's'} hidden until the stations they need are built · <a href="#" data-act="h-show" data-v="nextAll">show them</a></span>` : ''}</div>`;
  if (!rows.length) return toolbar + tools + emptyState('Nothing to show', 'Everything built? Show-off.', '', 'home');
  return toolbar + tools + `<div class="grid">${rows.map(stationCard).join('')}</div>`;
}

function stationCard({ st, built, levels }) {
  const max = st.levels[st.levels.length - 1]?.level || 0;
  const top = st.levels.find((l) => l.level === built);
  const undo = top ? btn(`${icon('undo')} Unmark level ${built}`, `data-act="build" data-id="${top.id}" data-v="0"`, { variant: 'ghost', size: 'xs', tip: `Marked built by mistake? Sets the station back to level ${built - 1}` }) : '';
  const next = st.levels.find((l) => l.level === built + 1);
  let state = '';
  if (built >= max) state = badge('Fully built', 'outline', 'status-completed');
  else if (next && !levelUnlocked(next)) state = badge(`${icon('lock')} Locked`);
  else if (next) {
    const reqs = hideoutReqs(next);
    const done = reqs.filter((r) => r.done).length;
    state = done === reqs.length ? badge('Ready to build', 'outline', 'status-available') : badge(`${done}/${reqs.length} requirements`);
  }
  const open = S.ui.hOpen[st.id] ?? (levels.length > 0 && built < max);
  return `<details class="card qcard station ${built >= max ? 'st-completed' : 'st-available'}" data-size="sm" data-hopen="${esc(st.id)}" ${open ? 'open' : ''}>
    <summary><div class="qhead"><span class="title">${esc(st.name)}</span>${state}${badge(`Level ${built}/${max}`, 'secondary')}${icon('chevron', 'caret')}</div>
      ${progressBar(built, max, `${st.name} level`)}</summary>
    <section>${undo ? `<div class="undo-row">${undo}</div>` : ''}
    ${levels.length ? levels.map((l) => levelBlock(st, l)).join('') : `<div class="auto">${built >= max ? 'Fully built.' : 'Next level is locked until the stations it needs are built.'}</div>`}</section>
  </details>`;
}

function levelBlock(st, l) {
  const built = levelBuilt(st, l);
  const reqs = hideoutReqs(l);
  const ready = reqs.every((r) => r.done);
  const rows = reqs.map((r) => {
    let control;
    if (r.auto || built) control = checkbox(`disabled aria-label="${built ? 'Built' : 'Tracked automatically'}"`, r.done || built);
    else if (r.target > 1) control = stepperControl(`data-act="step" data-sec="hideoutReqs" data-key="${esc(r.key)}"`, r.cur, r.target);
    else control = checkbox(`data-act="check" data-sec="hideoutReqs" data-key="${esc(r.key)}" aria-label="Done"`, r.done);
    const label = r.kind === 'item'
      ? `${itemTag(r.item)} ×${r.count} ${r.fir ? badge('FIR', 'primary', 'fir', 'Must be found in raid') : badge('not FIR', 'outline', 'nofir')}`
      : `${esc(r.label)} ${r.auto ? '<span class="auto">auto</span>' : ''}`;
    return `<li class="${r.done || built ? 'done' : ''}">${control}<div class="body"><div class="tags"><span class="type-icon">${REQ_NEEDS[r.kind]}</span> ${label}</div></div></li>`;
  });
  const time = l.constructionTime ? `${Math.round(l.constructionTime / 360) / 10}h build` : '';
  return `<div class="station-level">
    <div class="lvl-title">Level ${l.level} ${built ? badge('Built', 'outline', 'status-completed') : !levelUnlocked(l) ? badge(`${icon('lock')} Locked`) : ready ? badge('Ready to build', 'outline', 'status-available') : ''}<span class="count">${time}</span>
      ${btn(built ? 'Unbuild' : 'Mark built', `data-act="build" data-id="${l.id}" data-v="${built ? 0 : 1}"`, { variant: built ? 'outline' : ready ? 'primary' : 'secondary', size: 'sm' })}</div>
    ${rows.length ? `<ul class="objs">${rows.join('')}</ul>` : '<div class="auto">No requirements</div>'}
  </div>`;
}

// ---------------------------------------------------------------- render: prestige
function renderPrestige() {
  const list = (S.data.prestige || []).slice().sort((a, b) => (a.prestigeLevel || 0) - (b.prestigeLevel || 0));
  const custom = Object.entries(S.progress.custom);
  const customBlock = (pid) => {
    const rows = custom.filter(([, c]) => c.prestigeId === pid);
    return `${rows.length ? `<ul class="objs custom-list">${rows.map(([id, c]) => `<li class="${c.done ? 'done' : ''}">${checkbox(`data-act="custom-toggle" data-id="${esc(id)}" aria-label="Done"`, c.done)}<div class="body"><div class="desc">${esc(c.text)} <span class="optional">(custom)</span></div></div>${btn(icon('trash'), `data-act="custom-del" data-id="${esc(id)}" aria-label="Delete requirement"`, { variant: 'ghost', size: 'icon-sm', tip: 'Delete', side: 'left' })}</li>`).join('')}</ul>` : ''}
      <form class="custom-add" data-act="custom-add" data-pid="${esc(pid)}"><div class="input-group"><input type="text" name="text" placeholder="Add your own requirement…" aria-label="New requirement"><span data-align="end"><button type="submit" class="btn" data-size="xs">${icon('plus')} Add</button></span></div></form>`;
  };
  let html = `<div class="alert intro">${icon('info')}<section><p>Prestige requirements. Quest, level and hideout conditions update automatically; tick the rest yourself. Your level: <b>${S.progress.settings.playerLevel}</b> (change in <a href="#" data-act="tab" data-tab="settings">Settings</a>).</p></section></div>`;
  if (!list.length) {
    html += emptyState('No prestige data', `No prestige data came back from tarkov.dev${S.data.meta?.prestigeError ? ` (${esc(S.data.meta.prestigeError)})` : ''}. Try refreshing game data, or track requirements by hand below.`, '', 'list')
      + `<div class="card prestige-card" data-size="sm"><header><h2>My prestige checklist</h2></header><section>${customBlock('general')}</section></div>`;
    return html;
  }
  const achieved = (p) => !!S.progress.prestige[`achieved|${p.id}`];
  // Default to the first prestige not yet achieved; the buttons can pick any other.
  const current = list.find((p) => p.id === S.ui.prestigeView) || list.find((p) => !achieved(p)) || list[list.length - 1];
  const switcher = `<div class="tabs prestige-switch"><nav role="tablist" aria-orientation="horizontal" aria-label="Prestige level">${list.map((p) => `<button type="button" role="tab" aria-selected="${p.id === current.id}" tabindex="${p.id === current.id ? 0 : -1}" data-act="prestige-view" data-id="${esc(p.id)}">${achieved(p) ? '✓ ' : ''}${esc(p.name || `Prestige ${p.prestigeLevel}`)}</button>`).join('')}</nav>
    ${S.ui.prestigeView ? btn('Next unachieved', 'data-act="prestige-view" data-id=""', { variant: 'ghost', size: 'sm', tip: 'Show the next prestige you have not achieved' }) : ''}</div>`;
  const p = current;
  const conds = p.conditions || [];
  const isAchieved = achieved(p);
  // Once achieved, the conditions were met at the time even if level etc. reset since.
  const done = isAchieved ? conds.length : conds.filter((o) => objValue('prestige', `${p.id}|${o.id}`, o).done).length;
  const all = conds.length && done === conds.length;
  const name = esc(p.name || `Prestige ${p.prestigeLevel}`);
  return html + switcher + `<div class="card prestige-card ${isAchieved || all ? 'st-completed' : 'st-active'}" data-size="sm">
      <header><h2>${name}</h2><p>${done} of ${conds.length} conditions met</p>
        <div class="card-action">${isAchieved ? badge('Achieved', 'outline', 'status-completed') : ''}${badge(`${done}/${conds.length}`, 'secondary')}</div></header>
      <section>${progressBar(done, conds.length, 'Conditions met')}
      <ul class="objs">${conds.map((o) => objRow('prestige', `${p.id}|${o.id}`, o, { disabled: isAchieved, forceDone: isAchieved })).join('')}</ul>
      ${customBlock(p.id)}</section>
      <footer class="actions">${isAchieved
        ? btn(`${icon('undo')} Undo: mark not achieved`, `data-act="prestige-achieved" data-id="${esc(p.id)}" data-v="0"`, { variant: 'outline', size: 'sm' })
        : btn(`Mark ${name} achieved`, `data-act="prestige-achieved" data-id="${esc(p.id)}" data-v="1"`, { variant: all ? 'primary' : 'outline', size: 'sm' })}</footer>
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
  return leveled.length ? `<details class="card qcard skill-overview" data-size="sm" data-skill-overview ${S.ui.skillOverviewOpen === false ? '' : 'open'}>
      <summary><div class="qhead"><span class="title">Total buffs on your PMC</span>${badge(`${leveled.length} skills leveled · ${leveled.filter((sk) => lv(sk) >= elite).length} elite`, 'secondary')}${icon('chevron', 'caret')}</div></summary>
      <section><div class="overview-grid">${cats.map((cat) => {
        const sks = leveled.filter((sk) => sk.category === cat);
        if (!sks.length) return '';
        return `<div><div class="ov-cat">${esc(cat)}</div>${sks.map((sk) => `<div class="ov-skill"><b>${esc(sk.name)}</b> <span class="auto">lvl ${lv(sk)}</span>${lv(sk) >= elite ? ` ${badge('Elite', 'outline', 'kappa')}` : ''}
          ${(sk.effects || []).map((e) => `<div class="ov-row"><span>${esc(e.name)}</span><span class="num">${fmtNum(effectValue(sk, e, lv(sk)))}${esc(e.unit || '')}</span></div>`).join('')}
          ${lv(sk) >= elite ? (sk.elite || []).map((x) => `<div class="ov-row elite"><span>★ ${esc(x)}</span></div>`).join('') : ''}</div>`).join('')}</div>`;
      }).join('')}</div>
      ${shared.length ? `<div class="ov-cat" style="margin-top:10px">Combined (same effect from several skills)</div>${shared.map(([name, c]) => `<div class="ov-row"><span>${esc(name)} <span class="auto">(${esc(c.from.join(' + '))})</span></span><span class="num">${fmtNum(c.total)}${esc(c.unit || '')}</span></div>`).join('')}` : ''}
    </section></details>` : emptyState('', 'Enter your skill levels to see the total buffs on your PMC.', '', 'zap');
}

function renderSkills() {
  const cfg = activeSkillConfig();
  const f = S.ui.sk;
  const maxLevel = cfg.maxLevel || 51;
  const elite = cfg.eliteLevel || 51;
  const lv = (sk) => Number(S.progress.skills[sk.id] || 0);
  if (!cfg.skills.length) return emptyState('No skill data available');
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
    <input type="search" class="input tb-search wide" data-ui="sk.text" value="${esc(f.text)}" placeholder="Search skills, descriptions, effects…" aria-label="Search skills">
    <div role="group" class="button-group" aria-label="Category">${[['', 'All'], ...cats.map((c) => [c, c])].map(([v, t]) => btn(esc(t), `data-act="sk-cat" data-v="${esc(v)}" aria-pressed="${f.category === v}"`, { variant: f.category === v ? 'secondary' : 'outline', size: 'sm' })).join('')}</div>
    ${select('sk.sortBy', f.sortBy, [['category', 'Game order'], ['name', 'Name'], ['level', 'Your level']], 'Sort')}
    ${toggleSwitch('Only leveled', 'data-ui="sk.onlyLeveled"', f.onlyLeveled)}
    <span class="count">${list.length} skills</span>
  </div>`;
  const cards = list.map((sk) => {
    const l = lv(sk);
    return `<div class="card skill ${l >= elite ? 'st-completed' : l > 0 ? 'st-active' : ''}" data-size="sm">
      <header><h2>${esc(sk.name)}</h2><div class="card-action">${l >= elite ? badge('Elite', 'outline', 'kappa') : ''}${badge(esc(sk.category), 'secondary')}</div></header>
      <section>
      <div class="skill-level"><div role="group" class="button-group stepper">${btn(icon('minus'), `data-act="skill-step" data-id="${esc(sk.id)}" data-d="-1" aria-label="Level down"`, { variant: 'outline', size: 'icon-sm' })}
        <input type="number" class="input" min="0" max="${maxLevel}" value="${l}" data-act="skill-level" data-id="${esc(sk.id)}" aria-label="${esc(sk.name)} level">
        ${btn(icon('plus'), `data-act="skill-step" data-id="${esc(sk.id)}" data-d="1" aria-label="Level up"`, { variant: 'outline', size: 'icon-sm' })}</div><span class="auto">level ${l}/${maxLevel}</span></div>
      ${progressBar(l, maxLevel, `${sk.name} level`)}
      <div class="desc">${esc(sk.description)}</div>
      ${sk.levelUp ? `<div class="auto">Levels up by: ${esc(sk.levelUp)}</div>` : ''}
      <ul class="effects">${(sk.effects || []).map((e) => `<li><span>${esc(e.name)}</span><span class="num">${fmtNum(effectValue(sk, e, l))}${esc(e.unit || '')} <span class="auto">(${fmtNum(e.perLevel)}${esc(e.unit || '')}/lvl, max ${fmtNum(effectValue(sk, e, maxLevel))}${esc(e.unit || '')})</span></span></li>`).join('')}
        ${(sk.elite || []).map((x) => `<li class="${l >= elite ? '' : 'locked'}"><span>★ Elite: ${esc(x)}</span></li>`).join('')}</ul>
    </section></div>`;
  }).join('');
  // Wide screens: skill cards on the left, buff totals in a sticky sidebar. Narrow: totals on top.
  return ocrPanel() + toolbar + `<div class="skills-layout">
      <div class="skills-main"><div class="grid skills-grid">${cards || emptyState('No skills match', '', '', 'search')}</div></div>
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
    if (!st.tesseract && !st.ai) info = 'No OCR engine installed. Both come with the Docker image.';
    else if (!st.available) info = `Screenshot folder not found (<code>${esc(st.dir)}</code>). Mount your Tarkov Screenshots folder, see README.`;
    else if (!st.selected.length) info = st.total ? 'Only in-raid screenshots found (those are skipped).' : 'No screenshots in the folder yet.';
    else info = `Will read ${st.selected.length} screenshot${st.selected.length === 1 ? '' : 's'} from <b>${esc(st.day)}</b>${st.inRaid ? ` · ${st.inRaid} in-raid skipped` : ''} · engine: ${esc(ocrEngineLabel(st))}`;
  }
  let result = '';
  if (r?.error) result = `<div class="alert ocr-result" data-variant="destructive">${icon('alert')}<h2>Reading screenshots failed</h2><section>${esc(r.error)}</section><footer>${btn(icon('x'), 'data-act="ocr-dismiss" aria-label="Dismiss"', { variant: 'ghost', size: 'icon-sm' })}</footer></div>`;
  else if (r) {
    const changed = new Map(r.changes.map((c) => [c.id, c]));
    const read = r.read || r.changes.map((c) => ({ id: c.id, name: c.name, level: c.to }));
    const changes = read.length
      ? read.map((x) => { const c = changed.get(x.id); const inf = x.inferred ? ' <span data-tooltip="Name unreadable; worked out from its position on the page">≈</span>' : ''; return c ? badge(`${esc(x.name)}${inf} ${c.from} → <b>${c.to}</b>`, 'outline', 'changed') : badge(`${esc(x.name)}${inf} ${x.level} ✓`); }).join(' ')
        + `<div class="auto">${r.changes.length ? `${r.changes.length} changed` : 'All already matched the tracker'} · ✓ = already the same${read.some((x) => x.inferred) ? ' · ≈ = name unreadable, worked out from its position on the page' : ''}.</div>`
      : '<span class="auto">No skill levels could be read from these screenshots. Are they of the skills page?</span>';
    const files = r.files.map((f) => `<div>${esc(f.name)}: ${f.error ? `<span class="bad">${esc(f.error)}</span>` : `${Object.keys(f.skills).length} skills${f.characterLevel ? `, PMC level ${f.characterLevel}` : ''}${f.levelCheck ? ` <span class="auto">(${levelCheckText(f.levelCheck)})</span>` : ''}${f.engines ? ` ${badge(esc(f.engines.map((e) => (e === 'ai' ? 'AI' : 'Tesseract')).join(' + ')), 'secondary')}` : ''}${f.unreadLevels ? ` <span class="auto">(${f.unreadLevels} level${f.unreadLevels === 1 ? '' : 's'} without a readable name)</span>` : ''}`}</div>`).join('');
    result = `<div class="alert ocr-result">${icon('camera')}<h2><b>${r.found}</b> skills read from ${r.files.length} screenshot${r.files.length === 1 ? '' : 's'} (${esc(r.day)}).${r.playerLevel ? ` PMC level ${r.playerLevel.from} → <b>${r.playerLevel.to}</b>.` : ''}</h2>
      <section>${r.aiError ? `<p class="warn">AI OCR failed to start (${esc(r.aiError)}); Tesseract was used.</p>` : ''}<div class="ocr-changes">${changes}</div>
      <section class="accordion"><details><summary>Screenshots${icon('chevron')}</summary><section><div class="sources">${files}</div></section></details></section></section>
      <footer>${btn(icon('x'), 'data-act="ocr-dismiss" aria-label="Dismiss"', { variant: 'ghost', size: 'icon-sm', tip: 'Dismiss', side: 'left' })}</footer></div>`;
  }
  const canRun = !running && st?.selected?.length && (st?.tesseract || st?.ai);
  return `<div class="card ocr-bar" data-size="sm"><section>${btn(running ? `${spinner()} Reading screenshots…` : `${icon('camera')} Read levels from screenshots`, 'data-act="ocr-run"', { variant: 'primary', disabled: !canRun })}
    <span class="auto">${st ? info : `${spinner()} ${info}`}</span></section></div>${result}`;
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

// What will actually run, given the setting and what is installed.
function ocrEngineLabel(st) {
  const want = st.engine || 'auto';
  if (want === 'tesseract') return st.tesseract ? 'Tesseract' : 'Tesseract (not installed)';
  if (want === 'ai') return st.ai ? 'AI' : 'AI (not installed)';
  return st.ai ? (st.tesseract ? 'AI, Tesseract as backup' : 'AI') : 'Tesseract (AI not installed)';
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
  const levelBadge = (sk) => badge(`your level ${lv(sk)}${lv(sk) >= (cfg.eliteLevel || 51) ? ' · Elite' : ''}`, 'secondary');
  const card = (title, sk, body) => `<div class="card info-card" data-size="sm"><header><h2>${title}</h2><div class="card-action">${levelBadge(sk)}</div></header><section>${body}</section></div>`;
  const row = (label, now, was) => `<div class="ov-row"><span>${label}</span><span class="num"><b>${now}</b>${was != null ? ` <span class="auto">(base ${was})</span>` : ''}</span></div>`;
  const elite = (sk) => lv(sk) >= (cfg.eliteLevel || 51) ? (sk.elite || []).map((t) => `<div class="ov-row elite"><span>★ ${esc(t)}</span></div>`).join('') : '';
  const cards = [];

  const str = get('Strength');
  if (str) {
    const b = pct(str, /carry weight/i);
    const m = 1 + b / 100;
    cards.push(card('Strength', str, `
      <p class="auto">Carry weight bonus ${fmtNum(b)}% raises the weight limits below.</p>
      ${row('You become overweight at', kg(base.overweightStartKg * m), kg(base.overweightStartKg))}
      ${row('You can no longer sprint at', kg(base.sprintLimitKg * m), kg(base.sprintLimitKg))}
      ${row('Critically overweight at', kg(base.criticalOverweightKg * m), kg(base.criticalOverweightKg))}
      ${row('Sprint speed', `${fmtNum(pct(str, /sprint/i))}%`)}${row('Jump height', `${fmtNum(pct(str, /jump/i))}%`)}${row('Throw distance', `${fmtNum(pct(str, /throw/i))}%`)}
      ${elite(str)}`));
  }

  const met = get('Metabolism');
  if (met) {
    const food = 1 + pct(met, /from food/i) / 100;
    const drainMet = pct(met, /drain/i);
    const drainHealth = pct(get('Health'), /drain/i);
    const drain = 1 + (drainMet + drainHealth) / 100;
    cards.push(card('Metabolism', met, `
      ${row('Food and drinks restore', x(food), '×1')}
      ${row('Example: a 60-energy MRE gives', `${Math.round(60 * food)} energy`, '60')}
      ${row('Energy and hydration drain', x(drain), '×1')}
      <p class="auto">Drain includes Health (${fmtNum(drainHealth)}%) and Metabolism (${fmtNum(drainMet)}%).${drain < 1 ? ` Your energy lasts about ${Math.round((1 / drain - 1) * 100)}% longer.` : ''}</p>
      ${elite(met)}`));
  }

  const hm = get('HideoutManagement');
  if (hm) {
    const cons = 1 + pct(hm, /consumption/i) / 100;
    const bonus = 1 + pct(hm, /zone bonus/i) / 100;
    const fuelBonus = hideoutBonusTotals().find((b) => b.type === 'FuelConsumption');
    const zoneFuel = fuelBonus ? 1 + fuelBonus.boosted / 100 : 1;
    const perHour = (base.generatorFuelPerHour || 4.75) * cons * zoneFuel;
    cards.push(card('Hideout Management', hm, `
      ${row('Fuel and filter use', x(cons), '×1')}
      ${fuelBonus ? row(`Hideout fuel bonus (${esc(fuelBonus.from.join(', '))})`, `${fmtNum(fuelBonus.boosted)}%`) : ''}
      ${row('Generator burns', `${(Math.round(perHour * 100) / 100)} fuel/h`, `${base.generatorFuelPerHour || 4.75}/h`)}
      ${(base.fuelTanks || []).map((t) => row(`${esc(t.name)} (${t.resource}) lasts`, hrs(t.resource / perHour), hrs(t.resource / (base.generatorFuelPerHour || 4.75)))).join('')}
      ${row('Hideout zone bonuses', x(bonus), '×1')}
      <p class="auto">Example: a zone bonus of +10% becomes +${Math.round(10 * bonus * 10) / 10}%.</p>
      ${elite(hm)}`));
  }

  const cr = get('Crafting');
  if (cr) {
    const t = 1 + pct(cr, /production time/i) / 100;
    cards.push(card('Crafting', cr, `
      ${row('Craft time', x(t), '×1')}
      ${(base.craftExampleHours || [1, 8, 24]).map((h) => row(`A ${h} h craft takes`, hrs(h * t), hrs(h))).join('')}
      ${elite(cr)}`));
  }
  return `<div class="grid info-grid">${cards.join('')}</div>
    <p class="kv">Base values: ${esc(base.source || 'n/a')}${base.fuelTanksSource ? `; fuel tank sizes: ${esc(base.fuelTanksSource)}` : ''}. Per-level percentages come from the Skills data (marked "game config" where taken from the game; otherwise community wiki and approximate). Change your levels on the Skills tab.</p>`;
}

// ---------------------------------------------------------------- recipes (hideout crafts)
const MAX_PINS = 4;
const fmtDuration = (sec) => {
  const m = Math.round(sec / 60);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h ${String(mm).padStart(2, '0')}m` : `${h}h ${String(mm).padStart(2, '0')}m`;
};

// Fuel the generator burns per hour after Hideout Management and hideout fuel bonuses.
function generatorFuelPerHour() {
  const cfg = activeSkillConfig();
  const base = cfg.baseValues || {};
  const hm = cfg.skills.find((sk) => sk.id === 'HideoutManagement');
  const e = (hm?.effects || []).find((x) => /consumption/i.test(x.name));
  const cons = 1 + (e ? effectValue(hm, e, Number(S.progress.skills?.HideoutManagement || 0)) : 0) / 100;
  const fuelBonus = hideoutBonusTotals().find((b) => b.type === 'FuelConsumption');
  return (base.generatorFuelPerHour || 4.75) * cons * (fuelBonus ? 1 + fuelBonus.boosted / 100 : 1);
}

// Crafting skill: production time multiplier (e.g. 0.85 at level 20).
function craftTimeFactor() {
  const cfg = activeSkillConfig();
  const cr = cfg.skills.find((sk) => sk.id === 'Crafting');
  const e = (cr?.effects || []).find((x) => /production time/i.test(x.name));
  return 1 + (e ? effectValue(cr, e, Number(S.progress.skills?.Crafting || 0)) : 0) / 100;
}

// The Bitcoin Farm station (it has no regular recipes; its production depends on graphics cards).
const isBitcoinFarm = (st) => /bitcoin/i.test(st?.name || '');

// Seconds per bitcoin with N graphics cards: base / (1 + (N - 1) x gpuBoostRate).
// Base and rate match the in-game farm (1 GPU 3d 11h 20m, 50 GPUs 1d 3h 35m 36s).
function bitcoinSeconds(gpus) {
  const b = activeSkillConfig().baseValues?.bitcoin || {};
  return (b.baseSeconds || 300000) / (1 + Math.max(0, gpus - 1) * (b.gpuBoostRate ?? 0.041225));
}

// Why a recipe can't be made yet, or null when it can.
function craftLock(c) {
  const st = c.station && idx.stations.get(c.station.id);
  if (!st || builtLevel(st) < c.level) return `needs ${c.station?.name || 'station'} level ${c.level}`;
  if (c.taskUnlock && taskStatus(c.taskUnlock.id) !== 'completed') return `complete quest: ${c.taskUnlock.name}`;
  return null;
}

function craftCard(c, pins) {
  const lock = craftLock(c);
  const pinned = pins.includes(c.id);
  const full = !pinned && pins.length >= MAX_PINS;
  const secs = c.duration * craftTimeFactor();
  const timeNote = secs !== c.duration ? `base ${fmtDuration(c.duration)}` : '';
  // Product: full item name (ingredients keep the short name, full name on hover).
  const out = (c.rewardItems || []).map((r) => {
    const img = r.item?.iconLink ? `<img class="req-icon" src="${esc(r.item.iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<span class="product">${img}${esc(r.item?.name || '?')}${r.count > 1 ? ` <span class="auto">×${r.count}</span>` : ''}</span>`;
  }).join(' ');
  const ins = (c.requiredItems || []).map((r) => `<li>${itemTag(r.item)} <span class="num">×${Number(r.count).toLocaleString('en-US')}</span>${r.tool ? ` ${badge('tool', 'outline', '', 'Tools are returned when the craft finishes')}` : ''}</li>`)
    .concat((c.requiredQuestItems || []).map((q) => `<li>${esc(q.name)} ${badge('quest item')}</li>`)).join('');
  const pinBtn = btn(`${icon('star', pinned ? 'filled' : '')} ${pinned ? 'Pinned' : 'Pin'}`, `data-act="craft-pin" data-station="${esc(c.station.id)}" data-id="${esc(c.id)}" aria-pressed="${pinned}"`,
    { variant: pinned ? 'secondary' : 'ghost', size: 'xs', cls: `pin ${pinned ? 'on' : ''}`, disabled: full, side: 'left', tip: full ? `${MAX_PINS} recipes pinned for this module; unpin one first` : pinned ? 'Unpin' : 'Pin to the top of this module' });
  return `<div class="card recipe ${lock ? 'locked' : ''} ${pinned ? 'pinned' : ''}" data-size="sm">
    <header><h2 class="title">${out}</h2><div class="card-action">${pinBtn}</div></header>
    <section><div class="meta"><span>Level ${c.level}</span>·<span class="craft-time"><b>${fmtDuration(secs)}</b>${timeNote ? ` <span class="auto">(${esc(timeNote)})</span>` : ''}</span>
      ${c.taskUnlock ? badge(`quest: ${esc(c.taskUnlock.name)}`, 'outline', lock && /quest/.test(lock) ? '' : 'status-completed') : ''}
      ${lock ? badge(`${icon('lock')} ${esc(lock)}`, 'destructive', 'lock-badge') : ''}</div>
    <ul class="ingredients">${ins || '<li class="auto">No ingredients</li>'}</ul></section>
  </div>`;
}

const fmtDurationSec = (sec) => {
  const t = Math.floor(sec + 1e-6); // the game drops the fraction of a second
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return `${d ? `${d}d ` : ''}${h}h ${String(m).padStart(2, '0')}m ${String(x).padStart(2, '0')}s`;
};

// Own section for the Bitcoin Farm: time per bitcoin for your graphics cards, a comparison table,
// and bitcoins per fuel tank with your generator fuel use.
function bitcoinSection(st) {
  const b = activeSkillConfig().baseValues || {};
  const btc = b.bitcoin || {};
  const gpus = Math.max(1, Number(S.progress.settings.gpuCount || 1));
  const secs = bitcoinSeconds(gpus);
  const perHour = generatorFuelPerHour();
  const storage = (btc.storage || 3) + (Number(S.progress.skills?.HideoutManagement || 0) >= 51 ? 2 : 0);
  const rows = uniq([1, 10, 25, 50, gpus]).sort((x, y) => x - y).map((n) => {
    const t = bitcoinSeconds(n);
    return `<tr class="${n === gpus ? 'mine' : ''}"><td>${n}${n === gpus ? ` ${badge('yours', 'secondary')}` : ''}</td><td>${fmtDurationSec(t)}</td><td class="num">${(86400 / t).toFixed(4)}</td></tr>`;
  }).join('');
  const tanks = (b.fuelTanks || [{ name: 'Metal fuel tank', resource: 100 }]).map((t) => {
    const hours = t.resource / perHour;
    return `<div class="ov-row"><span>${esc(t.name)} (${t.resource}) lasts ${fmtDuration(hours * 3600)}</span><span class="num"><b>${(hours / (secs / 3600)).toFixed(2)}</b> bitcoins per tank</span></div>`;
  }).join('');
  const open = S.ui.recOpen.bitcoin ?? true;
  return `<details class="group recipes-station bitcoin-farm" data-recopen="bitcoin" ${open ? 'open' : ''}>
    <summary><span class="group-name">${esc(st.name)}</span><span class="count">level ${builtLevel(st)} · ${gpus} GPU${gpus === 1 ? '' : 's'} · ${(86400 / secs).toFixed(4)} BTC/day</span>${icon('chevron')}</summary>
    <section><div class="card btc-panel" data-size="sm">
      <header><h2>1 bitcoin every ${fmtDurationSec(secs)}</h2><p>${(86400 / secs).toFixed(4)} per day · farm holds ${storage}</p></header>
      <section>
      <div role="group" class="field btc-field"><label class="label" for="gpuCount">Graphics cards installed</label><input id="gpuCount" class="input" type="number" min="1" max="${btc.maxGpus || 50}" value="${gpus}" data-set="gpuCount"></div>
      <div class="table-container"><table class="table btc-table"><thead><tr><th>Graphics cards</th><th>Time to produce 1 bitcoin</th><th class="num">BTC/day</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="auto" style="margin-top:8px">Generator burns ${perHour.toFixed(2)} fuel/h (Hideout Management and hideout bonuses included):</div>
      ${tanks}</section>
    </div></section>
  </details>`;
}

function renderRecipes() {
  const crafts = S.data.crafts;
  if (!Array.isArray(crafts)) return emptyState('No recipe data yet', 'Refresh game data under Settings (the tracker does this automatically after an update).', '', 'database');
  const f = S.ui.rec;
  const text = norm(f.text);
  const pinsAll = S.progress.craftPins || {};
  const stations = (S.data.hideout || []).filter((st) => !isBitcoinFarm(st) && crafts.some((c) => c.station?.id === st.id)).sort((a, b) => byName(a.name, b.name));
  const farm = (S.data.hideout || []).find(isBitcoinFarm);
  const farmSection = farm && builtLevel(farm) > 0 && !text ? bitcoinSection(farm) : '';
  let shownTotal = 0, hiddenLocked = 0;
  const sections = stations.map((st) => {
    const pins = (pinsAll[st.id] || []).filter((id) => crafts.some((c) => c.id === id));
    let list = crafts.filter((c) => c.station?.id === st.id);
    const matches = (c) => !text || [...(c.rewardItems || []), ...(c.requiredItems || [])].some((r) => norm(r.item?.name).includes(text) || norm(r.item?.shortName).includes(text));
    list = list.filter(matches);
    const unlocked = list.filter((c) => !craftLock(c));
    hiddenLocked += list.length - unlocked.length;
    const visible = (f.showLocked ? list : unlocked).sort((a, b) => a.level - b.level || byName(a.rewardItems?.[0]?.item?.name, b.rewardItems?.[0]?.item?.name));
    const pinned = pins.map((id) => crafts.find((c) => c.id === id)).filter((c) => c && matches(c));
    const rest = visible.filter((c) => !pins.includes(c.id));
    if (!pinned.length && !rest.length) return '';
    shownTotal += pinned.length + rest.length;
    const key = st.id;
    const open = S.ui.recOpen[key] ?? !!pinned.length;
    return `<details class="group recipes-station" data-recopen="${esc(key)}" ${open || text ? 'open' : ''}>
      <summary><span class="group-name">${esc(st.name)}</span><span class="count">level ${builtLevel(st)} · ${unlocked.length} available</span>${pins.length ? badge(`${icon('star')} ${pins.length}/${MAX_PINS} pinned`, 'secondary') : ''}${icon('chevron')}</summary>
      <section>${pinned.length ? `<div class="pinned-row"><div class="grid">${pinned.map((c) => craftCard(c, pins)).join('')}</div></div>` : ''}
      ${rest.length ? `<div class="grid">${rest.map((c) => craftCard(c, pins)).join('')}</div>` : ''}</section>
    </details>`;
  }).join('');
  const factor = craftTimeFactor();
  const toolbar = `<div class="toolbar">
    <input type="search" class="input tb-search wide" data-ui="rec.text" value="${esc(f.text)}" placeholder="Find recipes by item…" aria-label="Find recipes">
    ${toggleSwitch(`Show locked${hiddenLocked && !f.showLocked ? ` (${hiddenLocked} hidden)` : ''}`, 'data-ui="rec.showLocked"', f.showLocked)}
    <span class="auto">Times include your Crafting skill (×${factor.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')})</span>
    <div role="group" class="button-group">${btn('Expand all', 'data-act="rec-open" data-v="1"', { variant: 'outline', size: 'sm' })}${btn('Collapse all', 'data-act="rec-open" data-v="0"', { variant: 'outline', size: 'sm' })}</div>
  </div>`;
  const body = farmSection + sections;
  return toolbar + (body ? `<section class="accordion groups" data-multiple>${body}</section>` : '') + (sections ? '' : emptyState(text ? 'No recipe uses or makes that item' : 'No recipes available yet', text ? '' : 'Build hideout stations to unlock them.', '', 'search'))
    + '<p class="kv">Recipes appear when their station level is built and their unlocking quest is completed. Crafts run at 7% speed while the generator has no fuel.</p>';
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
    return `<details class="buff-group" data-buffopen="${esc(key)}" ${S.ui.buffOpen[key] ? 'open' : ''}><summary><span class="ov-cat">${esc(title)}</span>${badge(`${rows.length} bonus${rows.length === 1 ? '' : 'es'}`, 'secondary')}${icon('chevron')}</summary><section>${rows.map((b) => `<div class="ov-row"><span>${esc(b.name)}${b.skillName ? ` <span class="auto">(${esc(b.skillName)})</span>` : ''}${b.type === 'AdditionalSlots' ? ` <span class="auto">(${esc(b.station)})</span>` : ''}
      <span class="auto">· ${esc(b.from.join(', '))}</span></span><span class="num"><b>${b.abs ? absValue(b) : fmtPct(b.boosted)}</b>${!b.abs && boost ? ` <span class="auto">(base ${fmtPct(b.pct)})</span>` : ''}</span></div>`).join('')}</section></details>`;
  }).join('');
  // Game data cached by an older version has no 'bonuses' field on any hideout level.
  const noBonusData = !!S.data?.hideout?.length && !S.data.hideout.some((st) => st.levels.some((l) => Array.isArray(l.bonuses)));
  const hideoutCard = `<details class="card qcard buffs-hideout" data-size="sm" data-buffopen="hb" ${S.ui.buffOpen.hb === false ? '' : 'open'}>
      <summary><div class="qhead"><span class="title">Hideout bonuses</span>
      ${badge(`${totals.length} bonuses`, 'secondary')}${badge(`${(S.data?.hideout || []).filter((st) => builtLevel(st) > 0).length} stations built`, 'secondary')}${icon('chevron', 'caret')}</div></summary>
      <section>
      ${totals.length ? `<div class="collapse-tools"><div role="group" class="button-group">${btn('Expand all', 'data-act="buff-groups" data-v="1"', { variant: 'outline', size: 'sm' })}${btn('Collapse all', 'data-act="buff-groups" data-v="0"', { variant: 'outline', size: 'sm' })}</div></div>` : ''}
      ${boost ? `<p class="auto">Includes your Hideout Management bonus: zone bonuses ×${Math.round((1 + boost / 100) * 1000) / 1000}.</p>` : ''}
      ${sections ? `<section class="accordion buff-groups" data-multiple>${sections}</section>` : (noBonusData
        ? `<p class="auto">Your saved game data was downloaded before the tracker read hideout bonuses${S.status?.refreshing ? ' and is being refreshed now…' : '.'}</p>${btn(`${icon('refresh')} Refresh game data now`, 'data-act="refresh"', { variant: 'primary' })}`
        : `<p class="auto">${S.data ? 'No hideout bonuses yet. Mark stations built on the Hideout tab.' : 'Game data not loaded yet.'}</p>`)}
      <p class="kv">Bonuses of all built levels are added up; Hideout Management boosts percentage bonuses. Values come from tarkov.dev's hideout data.</p></section></details>`;
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
    ? `<a href="#" data-act="goto" data-id="${r.taskId}">${esc(r.label)}</a> ${badge(STATUS_LABEL[r.status] || r.status, 'outline', `status-${r.status}`)}`
    : `<b>${esc(r.label)}</b> ${badge(r.kind, 'secondary')}`;
  const qty = r.kind === 'equipment' ? badge('equipment', 'secondary') : `×${r.count} ${r.fir ? badge('FIR', 'primary', 'fir') : badge('not FIR', 'outline', 'nofir')}${r.alt ? ' <span class="optional">(one of several accepted items)</span>' : ''}`;
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
    ${toggleSwitch('Include locked (future) quests', 'data-ui="items.includeLocked"', f.includeLocked)}
    <input type="search" class="input tb-search" data-ui="items.text" value="${esc(f.text)}" placeholder="Filter items…" aria-label="Filter items">
    <span class="count">${rows.length} items</span>
  </div>`;
  if (!rows.length) return toolbar + emptyState('Nothing needed', 'Either you are done, or your filters are lying to you.', '', 'list');
  return toolbar + `<div class="card table-card"><div class="table-container"><table class="table items"><thead><tr><th>Item</th><th class="num">FIR</th><th class="num">Not FIR</th><th class="num">Collected</th><th>Needed for</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${itemTag(a.item)}<div class="auto">${esc(a.item.name)}</div></td><td class="num">${a.fir || ''}</td><td class="num">${a.nofir || ''}</td><td class="num">${a.have}/${a.fir + a.nofir}</td>
      <td class="sources">${popover(`${a.sources.length} source${a.sources.length > 1 ? 's' : ''} ${icon('chevron')}`, `<div class="sources pop-sources">${a.sources.map(sourceLine).join('')}</div>`, { variant: 'outline', size: 'xs', align: 'end' })}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

// ---------------------------------------------------------------- render: search
function renderSearch() {
  const q = norm(S.ui.search).trim();
  const head = `<div class="toolbar"><input type="search" class="input tb-search wide" data-ui="search" value="${esc(S.ui.search)}" placeholder="Quest or item name…" id="searchBox" aria-label="Search">
    ${toggleSwitch('Include completed', 'data-ui="searchCompleted"', S.ui.searchCompleted)}
    <span class="auto">Tip: <kbd class="kbd">Ctrl</kbd> <kbd class="kbd">K</kbd> opens the command palette from anywhere.</span></div>`;
  if (q.length < 2) return head + emptyState('Search everything', 'Type at least two characters. Searches quest names, objectives, and every item any quest, hideout level or prestige needs.', '', 'search');
  const quests = S.data.tasks.filter((t) => norm(t.name).includes(q) && (S.ui.searchCompleted || taskStatus(t.id) !== 'completed'));
  const reqs = itemRequirements({ includeEquipment: true }).filter((r) => (norm(r.item.name).includes(q) || norm(r.item.shortName).includes(q)) && (S.ui.searchCompleted || !r.done) && r.status !== 'unavailable');
  const byItem = new Map();
  for (const r of reqs) {
    if (!byItem.has(r.item.id)) byItem.set(r.item.id, { item: r.item, sources: [] });
    byItem.get(r.item.id).sources.push(r);
  }
  const items = [...byItem.values()].sort((a, b) => byName(a.item.name, b.item.name));
  const skillHits = activeSkillConfig().skills.filter((sk) => norm(sk.name).includes(q) || norm(sk.description).includes(q));
  return head + `<h3 class="section-title">Quests ${badge(quests.length, 'secondary')}</h3>
    ${quests.length ? `<div class="grid">${sortTasks(quests).slice(0, 60).map(taskCard).join('')}</div>` : emptyState('', 'No quests by that name.', '', 'search')}
    ${skillHits.length ? `<h3 class="section-title">Skills ${badge(skillHits.length, 'secondary')}</h3><div class="chips">${skillHits.map((sk) => btn(`${esc(sk.name)} ${badge(`lvl ${Number(S.progress.skills[sk.id] || 0)}`, 'secondary')}`, `data-act="goto-skill" data-id="${esc(sk.name)}"`, { variant: 'outline', size: 'sm' })).join('')}</div>` : ''}
    <h3 class="section-title">Items ${badge(items.length, 'secondary')}</h3>
    ${items.length ? `<div class="card table-card"><div class="table-container"><table class="table items"><thead><tr><th>Item</th><th>Needed for (current &amp; future)</th></tr></thead><tbody>${items.map((a) => `<tr><td>${itemTag(a.item)}<div class="auto">${esc(a.item.name)}</div></td><td class="sources">${a.sources.map(sourceLine).join('')}</td></tr>`).join('')}</tbody></table></div></div>`
      : emptyState('', 'No current or future quest, hideout level or prestige needs an item matching that. Sell it.', '', 'list')}`;
}

// ---------------------------------------------------------------- render: settings
function renderSettings() {
  const s = S.progress?.settings || {};
  const st = S.status || {};
  const logs = st.logs || {};
  const meta = st.dataMeta || {};
  const sel = (key, value, options) => `<select class="select" id="set-${key}" data-set="${key}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const field = (id, label, control, desc = '') => `<div role="group" class="field"><label class="label" for="${id}">${label}</label>${control}${desc ? `<p>${desc}</p>` : ''}</div>`;
  const theme = window.basecoat?.theme?.get?.() || (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  return `<div class="settings">
    <div class="card" data-size="sm"><header><h2>Character</h2><p>Changing game mode re-downloads the matching quest data.</p></header>
      <section class="field-row">
        ${field('set-playerLevel', 'PMC level', `<input class="input" id="set-playerLevel" type="number" min="1" max="79" data-set="playerLevel" value="${s.playerLevel || 1}">`)}
        ${field('set-faction', 'Faction', sel('faction', s.faction, [['USEC', 'USEC'], ['BEAR', 'BEAR']]))}
        ${field('set-gameMode', 'Game mode', sel('gameMode', s.gameMode, [['regular', 'PvP'], ['pve', 'PvE']]))}
      </section>
    </div>
    <div class="card" data-size="sm"><header><h2>Appearance</h2><p>Dark is the default. Also toggled with the moon/sun button in the top bar.</p></header>
      <section class="field-row">${field('set-theme', 'Theme', `<select class="select" id="set-theme" data-act="theme-select">${[['dark', 'Dark'], ['light', 'Light']].map(([v, t]) => `<option value="${v}" ${theme === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}</section>
    </div>
    <div class="card" data-size="sm"><header><h2>Game data</h2><p>Source: <code>${esc(meta.source || '–')}</code> · fetched <code>${esc(meta.fetchedAt || 'never')}</code> · mode <code>${esc(meta.gameMode || '–')}</code></p></header>
      ${st.refreshError ? `<section><div class="alert" data-variant="destructive">${icon('alert')}<h2>Last refresh failed</h2><section>${esc(st.refreshError)}</section></div></section>` : ''}
      <footer class="actions">${btn(st.refreshing ? `${spinner()} Refreshing…` : `${icon('refresh')} Refresh from tarkov.dev`, 'data-act="refresh"', { variant: 'outline', disabled: !!st.refreshing })}
        <label class="btn" data-variant="outline">${icon('upload')} Import data file…<input type="file" accept=".json" data-act="import-data" hidden></label></footer>
    </div>
    <div class="card" data-size="sm"><header><h2>Game log detection</h2>
        <p>Folder: <code>${esc(logs.dir || '–')}</code> — ${logs.available ? `<span class="good">found</span>, ${logs.files} notification log files, ${logs.events} quest events read, last scan ${esc(logs.lastScan || '–')}` : '<span class="warn">not found</span>. Mount your EFT Logs folder (see README) to detect quest starts/completions automatically.'}</p>
        <div class="card-action">${badge(logs.available ? 'Connected' : 'Not found', 'outline', logs.available ? 'status-completed' : 'status-failed')}</div></header>
      <section class="stack">
        <div class="field-row">${field('set-logsSince', 'Count game logs from', `<input class="input" id="set-logsSince" type="datetime-local" data-set="logsSince" value="${esc(toLocalInput(s.logsSince))}">`, 'Quest events logged before this moment are ignored (the game keeps logs from every wipe, reset and prestige). Changing it re-reads all logs.')}
          <div class="field-btn">${btn('New start from now…', 'data-act="fresh-start"', { variant: 'destructive', tip: 'After a wipe, profile reset or prestige' })}</div></div>
        ${toggleSwitch('Update quest status from game logs', 'data-set="autoLogs"', s.autoLogs !== false)}
        ${(logs.lastEvents || []).length ? `<p class="kv">Recent: ${logs.lastEvents.slice(0, 8).map((e) => `${esc(idx.tasks.get(e.taskId)?.name || e.taskId)} → ${esc(e.status)}`).join(' · ')}</p>` : ''}
      </section>
      <footer class="actions">${btn(`${icon('refresh')} Re-read all logs`, 'data-act="rescan"', { variant: 'outline' })}</footer>
    </div>
    <div class="card" data-size="sm"><header><h2>Screenshot reading (OCR)</h2></header>
      <section>${field('set-ocrEngine', 'Engine', sel('ocrEngine', s.ocrEngine || 'auto', [['auto', 'Auto: AI, Tesseract as backup (recommended)'], ['ai', 'AI only'], ['tesseract', 'Tesseract only']]),
        'The AI engine (PaddleOCR models, runs on the CPU, no graphics card needed) reads Tarkov\'s font more reliably; Tesseract is the older engine and joins in when the AI read looks incomplete.')}</section>
    </div>
    <div class="card" data-size="sm"><header><h2>Progress</h2><p>Export a backup before resetting or importing.</p></header>
      <footer class="actions">${btn(`${icon('download')} Export progress`, 'data-act="export"', { variant: 'outline' })}
        <label class="btn" data-variant="outline">${icon('upload')} Import progress…<input type="file" accept=".json" data-act="import-progress" hidden></label>
        ${btn(`${icon('trash')} Reset all progress`, 'data-act="reset"', { variant: 'destructive' })}</footer>
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
    case 'theme': setTheme(window.basecoat?.theme?.get() === 'dark' ? 'light' : 'dark'); break;
    case 'palette': openPalette(); break;
    case 'search-all': S.ui.search = el.dataset.q || ''; S.ui.tab = 'search'; $('#globalSearch').value = S.ui.search; saveUi(); render(); break;
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
      if (S.ui.tab !== 'skills') { S.ui.tab = 'skills'; saveUi(); }
      S.ocr.running = true; render();
      try {
        const res = await fetch('/api/ocr/run', { method: 'POST' });
        S.ocr.result = await res.json();
      } catch (err) { S.ocr.result = { error: err.message }; }
      S.ocr.running = false; S.ocr.status = null;
      const r = S.ocr.result;
      if (r?.error) toast('error', 'Reading screenshots failed', r.error);
      else if (r) toast('success', `OCR: ${r.changes?.length || 0} skill${r.changes?.length === 1 ? '' : 's'} updated`, `${r.found} read from ${r.files?.length || 0} screenshot${r.files?.length === 1 ? '' : 's'}${r.playerLevel ? ` · PMC level ${r.playerLevel.to}` : ''}`);
      await poll(true);
      render(); break;
    }
    case 'ocr-dismiss': S.ocr.result = null; render(); break;
    case 'craft-pin': {
      const st = el.dataset.station;
      const pins = (S.progress.craftPins?.[st] || []).slice();
      const at = pins.indexOf(id);
      if (at >= 0) pins.splice(at, 1);
      else if (pins.length < MAX_PINS) pins.push(id);
      S.ui.recOpen[st] = true; saveUi();
      setProgress({ section: 'craftPins', id: st, value: pins.length ? pins : null });
      break;
    }
    case 'rec-open':
      for (const st of S.data.hideout || []) S.ui.recOpen[st.id] = el.dataset.v === '1';
      S.ui.recOpen.bitcoin = el.dataset.v === '1'; // the Bitcoin Farm section has its own key
      saveUi(); render(); break;
    case 'h-show': S.ui.h.show = el.dataset.v; saveUi(); render(); break;
    case 'goto-station': {
      const st = idx.stations.get(id);
      if (!st) break;
      S.ui.tab = 'hideout';
      S.ui.h = { ...S.ui.h, show: 'all', need: '', text: st.name };
      S.ui.hOpen[id] = true;
      saveUi(); render();
      document.querySelector(`[data-hopen="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
      break;
    }
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
    case 'prestige-achieved': {
      const on = el.dataset.v === '1';
      const p = (S.data.prestige || []).find((x) => x.id === id);
      const name = p?.name || `Prestige ${p?.prestigeLevel ?? ''}`;
      if (on && !(await confirmDialog(`Mark ${name} achieved?`, 'Its checklist is closed and the next prestige is shown. You can undo this any time.', 'Mark achieved'))) break;
      // Back to "next unachieved" so marking one achieved moves straight on to the next prestige.
      S.ui.prestigeView = null; saveUi();
      setProgress({ section: 'prestige', id: `achieved|${id}`, value: on || null });
      if (on) toast('success', `${name} achieved`);
      break;
    }
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
    case 'rescan':
      try { await api('/api/logs/rescan', { method: 'POST' }); toast('success', 'Game logs re-read'); } catch (err) { toast('error', 'Could not re-read logs', err.message); }
      await poll(true); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(S.progress, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tarkov-progress-${new Date().toISOString().slice(0, 10)}.json` });
      a.click(); URL.revokeObjectURL(a.href);
      toast('success', 'Progress exported', a.download); break;
    }
    case 'fresh-start':
      if (await confirmDialog('Start fresh from now?', 'For after a wipe, profile reset or prestige. This clears quest, objective and hideout progress, sets your level to 1 and ignores all game logs from before now. Prestige checklists and settings are kept. Export first if unsure.', 'Start fresh', true)) {
        await api('/api/progress/fresh-start', { method: 'POST' });
        await poll(true);
        toast('success', 'Fresh start', 'Progress cleared; game logs before now are ignored.');
      }
      break;
    case 'reset':
      if (await confirmDialog('Reset ALL progress?', 'This clears every quest, hideout and prestige mark. Export first if unsure.', 'Reset everything', true)) {
        await api('/api/progress/reset', { method: 'POST' }); await poll(true);
        toast('success', 'All progress reset');
      }
      break;
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.ui) {
    setUi(el.dataset.ui, el.type === 'checkbox' ? el.checked : el.value);
    render();
  } else if (el.dataset.act === 'theme-select') {
    setTheme(el.value);
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
    let value = el.type === 'checkbox' ? el.checked : key === 'playerLevel' ? Math.max(1, Number(el.value) || 1) : key === 'gpuCount' ? Math.min(50, Math.max(1, Math.round(Number(el.value) || 1))) : el.value;
    // datetime-local is in the viewer's local time; store an absolute timestamp.
    if (key === 'logsSince') value = el.value ? new Date(el.value).toISOString() : '';
    await setProgress({ section: 'settings', id: key, value });
    if (key === 'gameMode') await refreshData();
    if (key === 'ocrEngine') S.ocr.status = null;
  } else if (el.dataset.act === 'import-data' || el.dataset.act === 'import-progress') {
    const file = el.files[0];
    if (!file) return;
    try {
      const body = await file.text();
      const res = await api(el.dataset.act === 'import-data' ? '/api/data/import' : '/api/progress/import', { method: 'POST', body });
      if (!res.ok) throw new Error(res.body.error);
      await loadAll();
      toast('success', el.dataset.act === 'import-data' ? 'Game data imported' : 'Progress imported', file.name);
    } catch (err) { toast('error', 'Import failed', err.message); }
    el.value = '';
  }
});

document.addEventListener('toggle', (e) => {
  const id = e.target.dataset?.open;
  if (id) { S.ui.open[id] = e.target.open; saveUi(); }
  if (e.target.hasAttribute?.('data-skill-overview')) { S.ui.skillOverviewOpen = e.target.open; saveUi(); }
  const bo = e.target.dataset?.buffopen;
  if (bo) { S.ui.buffOpen[bo] = e.target.open; saveUi(); }
  const ro = e.target.dataset?.recopen;
  if (ro) { S.ui.recOpen[ro] = e.target.open; saveUi(); }
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

// ---------------------------------------------------------------- theme, keyboard, command palette
function setTheme(mode) {
  if (window.basecoat?.theme) window.basecoat.theme.set(mode); // stores localStorage.themeMode
  else {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    try { localStorage.setItem('themeMode', mode); } catch { /* storage unavailable */ }
  }
  const sel = document.getElementById('set-theme');
  if (sel) sel.value = mode;
}

// Basecoat tabs move the selection with the arrow keys; follow it.
document.getElementById('tabs').addEventListener('keyup', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const sel = document.querySelector('#tabs [role=tab][aria-selected="true"]');
  if (sel && sel.dataset.tab !== S.ui.tab) { S.ui.tab = sel.dataset.tab; saveUi(); render(); }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});

// Command palette (Basecoat command in a dialog): jump to tabs, quests, skills, stations, or run actions.
// Items reuse the normal data-act handlers. Rebuilt on every open so it reflects current progress.
function openPalette() {
  const d = document.getElementById('cmdk');
  if (d.open) return;
  const item = (label, attrs, { keywords = '', hint = '', ic = '' } = {}) => `<div role="menuitem" ${attrs} data-filter="${esc(label)}"${keywords ? ` data-keywords="${esc(keywords)}"` : ''}>${ic ? icon(ic) : ''}<span>${esc(label)}</span>${hint ? `<span class="cmd-hint">${hint}</span>` : ''}</div>`;
  const group = (id, title, items) => (items.length ? `<div role="group" aria-labelledby="cmdk-${id}"><span role="heading" id="cmdk-${id}">${title}</span>${items.join('')}</div>` : '');
  const tabs = [...document.querySelectorAll('#tabs [role=tab]')].map((b) => item(b.textContent.trim(), `data-act="tab" data-tab="${b.dataset.tab}"`, { ic: 'list', keywords: 'tab go' }));
  const actions = [
    item('Refresh game data', 'data-act="refresh"', { ic: 'refresh', keywords: 'download update tarkov.dev' }),
    item('Re-read game logs', 'data-act="rescan"', { ic: 'refresh', keywords: 'logs rescan' }),
    item('Read levels from screenshots (OCR)', 'data-act="ocr-run"', { ic: 'camera', keywords: 'ocr skills screenshot' }),
    item('Toggle dark mode', 'data-act="theme"', { ic: 'sun', keywords: 'theme light dark' }),
    item('Export progress', 'data-act="export"', { ic: 'download', keywords: 'backup save' }),
  ];
  const quests = S.data ? S.data.tasks.slice().sort((a, b) => byName(a.name, b.name)).map((t) => {
    const st = taskStatus(t.id);
    return item(t.name, `data-act="goto" data-id="${esc(t.id)}"`, { keywords: `${t.trader?.name || ''} ${taskMaps(t).join(' ')} ${st}`, hint: `${esc(t.trader?.name || '')} · ${STATUS_LABEL[st]}` });
  }) : [];
  const skills = activeSkillConfig().skills.map((sk) => item(sk.name, `data-act="goto-skill" data-id="${esc(sk.name)}"`, { keywords: `skill ${sk.category}`, hint: `lvl ${Number(S.progress?.skills?.[sk.id] || 0)}` }));
  const stations = (S.data?.hideout || []).filter((st) => st.levels.length).map((st) => item(st.name, `data-act="goto-station" data-id="${esc(st.id)}"`, { keywords: 'hideout station module', hint: `level ${builtLevel(st)}/${st.levels[st.levels.length - 1].level}`, ic: 'home' }));
  d.innerHTML = `<div class="command">
    <header>${icon('search')}<input type="text" id="cmdk-input" placeholder="Jump to a quest, skill, station or action…" autocomplete="off" autocorrect="off" spellcheck="false" aria-autocomplete="list" role="combobox" aria-expanded="true" aria-controls="cmdk-menu"></header>
    <div role="menu" id="cmdk-menu" aria-orientation="vertical" data-empty="No results found.">
      ${group('actions', 'Actions', actions)}${group('tabs', 'Go to', tabs)}${group('quests', 'Quests', quests)}${group('skills', 'Skills', skills)}${group('stations', 'Hideout', stations)}
      ${group('search', 'Search', [`<div role="menuitem" data-act="search-all" data-q="" data-force>${icon('search')}<span class="cmd-search-label">Search quests &amp; items…</span></div>`])}
    </div>
    <footer><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> to move</span><span><kbd class="kbd">Enter</kbd> to select</span><span><kbd class="kbd">Esc</kbd> to close</span></footer>
  </div>`;
  window.basecoat?.init('command');
  const input = d.querySelector('#cmdk-input');
  const all = d.querySelector('[data-act="search-all"]');
  input.addEventListener('input', () => {
    all.dataset.q = input.value.trim();
    all.querySelector('.cmd-search-label').textContent = input.value.trim() ? `Search everything for “${input.value.trim()}”` : 'Search quests & items…';
  });
  d.onclick = (e) => { if (e.target === d) d.close(); };
  d.showModal();
  input.focus();
}

// ---------------------------------------------------------------- loading & sync
async function refreshData() {
  banner('Downloading game data from tarkov.dev…');
  let serverOk = false;
  try { serverOk = (await api('/api/data/refresh', { method: 'POST' })).ok; } catch { /* fall back below */ }
  const ok = serverOk || await browserDownload();
  await loadAll();
  if (ok) toast('success', 'Game data updated', S.data?.meta?.fetchedAt ? `Fetched ${new Date(S.data.meta.fetchedAt).toLocaleString()}` : '');
  else toast('error', 'Game data could not be downloaded', 'Using the cached data; the tracker keeps retrying.');
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
