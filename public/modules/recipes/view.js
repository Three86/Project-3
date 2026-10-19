// Recipes: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc, fmtDuration, fmtDurationSec } from '../../core/util.js';
import { badge, btn, emptyState, icon, toggleSwitch } from '../../ui/basecoat/components.js';
import { itemTag } from '../../ui/basecoat/objectives.js';
import { MAX_PINS, craftLock, craftTimeFactor, builtLevel, recipeGroups, bitcoinInfo, togglePin, setAllOpen } from './logic.js';

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

// Own section for the Bitcoin Farm: time per bitcoin for your graphics cards, a comparison table,
// and bitcoins per fuel tank with your generator fuel use.
function bitcoinSection(st) {
  const b = bitcoinInfo();
  const rows = b.table.map(({ gpus: n, secs: t }) => `<tr class="${n === b.gpus ? 'mine' : ''}"><td>${n}${n === b.gpus ? ` ${badge('yours', 'secondary')}` : ''}</td><td>${fmtDurationSec(t)}</td><td class="num">${(86400 / t).toFixed(4)}</td></tr>`).join('');
  const tanks = b.tanks.map((t) => `<div class="ov-row"><span>${esc(t.name)} (${t.resource}) lasts ${fmtDuration(t.hours * 3600)}</span><span class="num"><b>${t.bitcoins.toFixed(2)}</b> bitcoins per tank</span></div>`).join('');
  const open = S.ui.recOpen.bitcoin ?? true;
  return `<details class="group recipes-station bitcoin-farm" data-recopen="bitcoin" ${open ? 'open' : ''}>
    <summary><span class="group-name">${esc(st.name)}</span><span class="count">level ${builtLevel(st)} · ${b.gpus} GPU${b.gpus === 1 ? '' : 's'} · ${b.perDay.toFixed(4)} BTC/day</span>${icon('chevron')}</summary>
    <section><div class="card btc-panel" data-size="sm">
      <header><h2>1 bitcoin every ${fmtDurationSec(b.secs)}</h2><p>${b.perDay.toFixed(4)} per day · farm holds ${b.storage}</p></header>
      <section>
      <div role="group" class="field btc-field"><label class="label" for="gpuCount">Graphics cards installed</label><input id="gpuCount" class="input" type="number" min="1" max="${b.maxGpus}" value="${b.gpus}" data-set="gpuCount"></div>
      <div class="table-container"><table class="table btc-table"><thead><tr><th>Graphics cards</th><th>Time to produce 1 bitcoin</th><th class="num">BTC/day</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="auto" style="margin-top:8px">Generator burns ${b.perHour.toFixed(2)} fuel/h (Hideout Management and hideout bonuses included):</div>
      ${tanks}</section>
    </div></section>
  </details>`;
}

function renderRecipes() {
  const { available, farm, groups, hiddenLocked, text } = recipeGroups();
  if (!available) return emptyState('No recipe data yet', 'Refresh game data under Settings (the tracker does this automatically after an update).', '', 'database');
  const f = S.ui.rec;
  const sections = groups.map(({ st, pins, pinned, rest, unlocked }) => {
    const open = S.ui.recOpen[st.id] ?? !!pinned.length;
    return `<details class="group recipes-station" data-recopen="${esc(st.id)}" ${open || text ? 'open' : ''}>
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
  const body = (farm ? bitcoinSection(farm) : '') + sections;
  return toolbar + (body ? `<section class="accordion groups" data-multiple>${body}</section>` : '') + (sections ? '' : emptyState(text ? 'No recipe uses or makes that item' : 'No recipes available yet', text ? '' : 'Build hideout stations to unlock them.', '', 'search'))
    + '<p class="kv">Recipes appear when their station level is built and their unlocking quest is completed. Crafts run at 7% speed while the generator has no fuel.</p>';
}

export default {
  render: renderRecipes,
  actions: {
    'craft-pin'(el) { togglePin(el.dataset.station, el.dataset.id); },
    'rec-open'(el, ctx) { setAllOpen(el.dataset.v === '1'); ctx.ui.render(); },
  },
  toggle(el) {
    const ro = el.dataset.recopen;
    if (!ro) return false;
    S.ui.recOpen[ro] = el.open;
    return true;
  },
};
