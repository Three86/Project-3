// Icon GUI recipes: one card per station that crafts (icon, name, level) in two columns; clicking one
// shows its recipes on the right (pinned first, in pin order), or for the Bitcoin Farm the graphics
// cards, production time and bitcoins per fuel tank.
import { S, saveUi, setSetting } from '../../../core/store.js';
import { esc, fmtDuration, fmtDurationSec } from '../../../core/util.js';
import { badge, btn, emptyState, icon, toggleSwitch } from '../../../ui/basecoat/components.js';
import { stationImage } from '../../../modules/hideout/logic.js';
import { MAX_PINS, bitcoinInfo, craftLock, craftStations, craftTimeFactor, generatorFuel, stationRecipes, togglePin } from '../../../modules/recipes/logic.js';

const initials = (n) => String(n || '?').replace(/["'()]/g, '').split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
const pic = (src, name, cls = '') => `<span class="pic ${cls}"><span class="initials">${esc(initials(name))}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
const fmt = (n) => Number(n).toLocaleString('en-US');
const pct = (p) => `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;

// The station shown in the panel: the one picked last, else the first built one.
const current = (cards) => cards.find((c) => c.st.id === S.ui.rxSel) || cards.find((c) => c.built > 0 && !c.farm) || cards[0];

function card(c, selected, gpus) {
  const meta = c.farm ? (c.built ? `<span>${gpus} GPU${gpus === 1 ? '' : 's'}</span>` : '<span>not built</span>')
    : `<span>${c.available} recipe${c.available === 1 ? '' : 's'}</span>${c.pins ? `<span class="pin-n">${icon('star')}${c.pins} pinned</span>` : ''}`;
  return `<button type="button" class="rstation${c.built ? '' : ' unbuilt'}" data-act="rx-select" data-id="${esc(c.st.id)}" aria-pressed="${selected}">
    <span class="r-icon">${pic(stationImage(c.st.id), c.st.name)}</span>
    <span class="r-text"><span class="r-name">${esc(c.st.name)}</span>
      <span class="r-meta">${badge(`Level ${c.built}/${c.max}`, 'secondary')}${meta}</span></span>
  </button>`;
}

function recipeRow(c, pins) {
  const at = pins.indexOf(c.id);
  const pinned = at >= 0;
  const lock = craftLock(c);
  const full = !pinned && pins.length >= MAX_PINS;
  const secs = c.duration * craftTimeFactor();
  const out = c.rewardItems?.[0];
  const name = (c.rewardItems || []).map((r) => `${esc(r.item?.name || '?')}${r.count > 1 ? ` <span class="count">×${fmt(r.count)}</span>` : ''}`).join(', ');
  const ings = (c.requiredItems || []).map((r) => `<span class="ing" title="${esc(r.item?.name || '')}">${pic(r.item?.iconLink, r.item?.shortName || r.item?.name, 'ico')}${esc(r.item?.shortName || r.item?.name || '?')} <b>×${fmt(r.count)}</b>${r.tool ? ` ${badge('tool', 'outline', '', 'Tools are returned when the craft finishes')}` : ''}</span>`)
    .concat((c.requiredQuestItems || []).map((q) => `<span class="ing">${esc(q.name)} ${badge('quest item')}</span>`)).join('');
  const tip = pinned ? 'Unpin' : lock ? 'Locked recipes can’t be pinned' : full ? `${MAX_PINS} pinned; unpin one first` : 'Pin to the top';
  return `<li class="rrow${pinned ? ' pinned' : ''}${lock ? ' locked' : ''}" data-craft="${esc(c.id)}">
    <div class="rrow-head">
      <span class="rprod">${pic(out?.item?.iconLink, out?.item?.shortName || out?.item?.name, 'ico')}<span class="rp-name">${name}</span>${pinned ? `<span class="pin-no" title="Pinned ${at + 1}.">${at + 1}</span>` : ''}</span>
      <span class="rtime"><b>${fmtDuration(secs)}</b>${secs !== c.duration ? `<small>base ${fmtDuration(c.duration)}</small>` : ''}</span>
      ${btn(icon('star', pinned ? 'filled' : ''), `data-act="rx-pin" data-station="${esc(c.station.id)}" data-id="${esc(c.id)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'}"`,
        { variant: pinned ? 'secondary' : 'ghost', size: 'icon-sm', cls: 'pin', disabled: !pinned && (full || !!lock), tip, side: 'left' })}
    </div>
    <div class="ings">${ings || '<span class="count">No ingredients</span>'}</div>
    ${lock ? `<span class="rlock">${icon('lock')} ${esc(lock)}</span>` : ''}
  </li>`;
}

function recipePanel(c) {
  const f = S.ui.rec;
  const { pins, pinned, rest, unlocked, hiddenLocked } = stationRecipes(c.st);
  const factor = craftTimeFactor();
  const crafting = Number(S.progress.skills?.Crafting || 0);
  return `<div class="card" data-size="sm">
    <header><h2>${esc(c.st.name)}</h2><p>Level ${c.built} of ${c.max} · ${c.available} recipe${c.available === 1 ? '' : 's'} available</p></header>
    <section>
      <div class="rx-tools"><input type="search" class="input tb-search" data-ui="rec.text" value="${esc(f.text)}" placeholder="Find by item…" aria-label="Find recipes">
        ${toggleSwitch(`Show locked${hiddenLocked && !f.showLocked ? ` (${hiddenLocked})` : ''}`, 'data-ui="rec.showLocked"', f.showLocked)}</div>
      <p class="rx-speed">${icon('clock')} Craft times include your <b>Crafting ${crafting}</b> (${pct((factor - 1) * 100)}). Pinned recipes stay on top in the order you pinned them (up to ${MAX_PINS}).</p>
      ${pinned.length || rest.length ? `<ul class="recipe-list">${[...pinned, ...rest].map((r) => recipeRow(r, pins)).join('')}</ul>`
        : `<p class="count">${f.text ? 'No recipe here uses or makes that item.' : unlocked.length ? '' : c.built ? 'No recipes unlocked yet at this level.' : 'Build this station to unlock its recipes.'}</p>`}
    </section></div>`;
}

function fuelLines(fuel) {
  const lines = [`base ${fuel.base}/h`];
  if (fuel.hmPct) lines.push(`Hideout Management ${fuel.hmLevel}: ${pct(fuel.hmPct)} fuel use`);
  if (fuel.bonus) {
    const boost = fuel.bonus.boosted / fuel.bonus.pct;
    lines.push(`${esc(fuel.bonus.from.join(', '))}: ${pct(fuel.bonus.pct)} fuel use${boost > 1.0001 ? `, ×${boost.toFixed(2)} from Hideout Management` : ''}`);
  }
  return lines.map((l) => `<span>· ${l}</span>`).join('');
}

function bitcoinPanel(c) {
  const b = bitcoinInfo();
  if (!c.built) {
    return `<div class="card" data-size="sm"><header><h2>${esc(c.st.name)}</h2><p>Not built</p></header>
      <section><p class="count">Build the Bitcoin Farm (Hideout tab) to set its graphics cards and see what it produces.</p></section></div>`;
  }
  const tanks = b.tanks.map((t) => `<div class="tank-row"><span class="r-icon">${icon('fuel')}</span>
      <span><b class="t-name">${esc(t.name)}</b> <span class="count">(${t.resource})</span><br><span class="count">lasts ${fmtDuration(t.hours * 3600)}</span></span>
      <span class="t-btc"><b>${t.bitcoins.toFixed(2)}</b><br><span class="count">bitcoins</span></span></div>`).join('');
  return `<div class="card btc-card" data-size="sm">
    <header><h2>${esc(c.st.name)}</h2><p>Level ${c.built} of ${c.max} · room for ${b.maxGpus} graphics cards at this level</p></header>
    <section>
      <div class="btc-gpu"><label class="label" for="rxGpu">Graphics cards installed</label>
        <div role="group" class="button-group stepper">${btn(icon('minus'), 'data-act="rx-gpu" data-d="-1" aria-label="One less"', { variant: 'outline', size: 'icon-sm', disabled: b.gpus <= 1 })}<input id="rxGpu" type="number" class="input" inputmode="numeric" min="1" max="${b.maxGpus}" value="${b.gpus}" data-set="gpuCount">${btn(icon('plus'), 'data-act="rx-gpu" data-d="1" aria-label="One more"', { variant: 'outline', size: 'icon-sm', disabled: b.gpus >= b.maxGpus })}</div>
        <span class="count">max ${b.maxGpus} (level ${c.built})</span></div>
      <div class="btc-big"><div><b>${fmtDurationSec(b.secs)}</b><span>per bitcoin</span></div><div><b>${b.perDay.toFixed(3)}</b><span>bitcoins per day</span></div><div><b>${b.storage}</b><span>bitcoins the farm holds</span></div></div>
      <h4 class="rx-sub">Per fuel tank</h4>
      ${tanks}
      <div class="fuel-why"><span>Generator burns <b>${b.perHour.toFixed(2)}</b> fuel per hour:</span>${fuelLines(b.fuel)}</div>
    </section></div>`;
}

function render() {
  const cards = craftStations();
  if (!cards) return emptyState('No recipe data yet', 'Refresh game data under Settings (the tracker does this automatically after an update).', '', 'database');
  if (!cards.length) return emptyState('No crafting stations', 'Refresh game data under Settings.', '', 'database');
  const cur = current(cards);
  const gpus = bitcoinInfo().gpus;
  const avail = cards.filter((c) => !c.farm).reduce((a, c) => a + c.available, 0);
  const factor = craftTimeFactor();
  return `<div class="rx-summary"><span><b>${cards.length}</b> stations that craft</span>
      ${badge(`${avail} recipes available`)}
      ${badge(`${icon('clock')} Crafting ${Number(S.progress.skills?.Crafting || 0)}: ${pct((factor - 1) * 100)} time`)}
      ${badge(`${icon('fuel')} ${generatorFuel().perHour.toFixed(2)} fuel/h`)}</div>
    <div class="rx-layout">
      <div class="rx-grid" role="group" aria-label="Crafting stations">${cards.map((c) => card(c, c === cur, gpus)).join('')}</div>
      <aside class="rx-panel" aria-label="${esc(cur.st.name)}">${cur.farm ? bitcoinPanel(cur) : recipePanel(cur)}</aside>
    </div>`;
}

export default {
  render,
  actions: {
    'rx-select'(el, ctx) { S.ui.rxSel = el.dataset.id; S.ui.rec.text = ''; saveUi(); ctx.ui.render(); },
    'rx-pin'(el) { togglePin(el.dataset.station, el.dataset.id); },
    'rx-gpu'(el) { setSetting('gpuCount', bitcoinInfo().gpus + Number(el.dataset.d)); },
  },
};
