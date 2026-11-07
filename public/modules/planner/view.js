// Raid planner: default (Basecoat) view. Map chips, the quest list for that map (every trader) with
// pins, and on the right what the pinned quests still need in total.
import { S, saveUi } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { STATUS_LABEL, objValue, taskMaps, taskStatus } from '../../core/game.js';
import { badge, btn, emptyState, icon, toggleSwitch } from '../../ui/basecoat/components.js';
import { objRow, objectiveActions, objectiveChanges } from '../../ui/basecoat/objectives.js';
import { questCardToggle } from '../../ui/basecoat/quest-card.js';
import { setTaskStatus } from '../../core/progress.js';
import { traderImage } from '../quests/logic.js';
import { ANY_MAP, mapCounts, pinnedTotals, plannerTasks, setMap, togglePin } from './logic.js';

const mapLabel = (m) => (m === ANY_MAP ? 'Any map' : m);
const initials = (n) => String(n || '?').replace(/["'()]/g, '').split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
const pic = (src, name, cls = '') => `<span class="pic ${cls}"><span class="initials">${esc(initials(name))}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
const names = (items) => items.map((i) => esc(i.name)).join(', ');

function questRow(t, pins) {
  const st = taskStatus(t.id);
  const pinned = t.id in pins;
  const req = t.objectives.filter((o) => !o.optional);
  const done = req.filter((o) => objValue('objectives', o.id, o).done).length;
  const pct = req.length ? Math.round((done / req.length) * 100) : 0;
  const action = st === 'active' ? btn('Complete', `data-act="rp-status" data-id="${esc(t.id)}" data-v="completed"`, { size: 'xs' }) : badge(`${icon('lock')} ${STATUS_LABEL[st]}`);
  return `<li><details class="rp-q st-${st}${pinned ? ' pinned' : ''}" id="rp-${esc(t.id)}" data-open="${esc(t.id)}" ${S.ui.open?.[t.id] ? 'open' : ''}>
    <summary>${icon('chevron', 'caret')}${pic(traderImage(t.trader?.id), t.trader?.name, 'tr')}
      <span class="q-name">${esc(t.name)}<span class="q-sub">${esc(t.trader?.name || '')}${st === 'locked' ? ' · locked' : ''}</span></span>
      <span class="q-map">${esc(taskMaps(t).map(mapLabel).join(', '))}</span>
      <span class="q-prog">${req.length ? `${done}/${req.length} objectives<span class="bar"><i style="width:${pct}%"></i></span>` : ''}</span>
      ${btn(icon('star', pinned ? 'filled' : ''), `data-act="rp-pin" data-id="${esc(t.id)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${esc(t.name)}"`, { variant: pinned ? 'secondary' : 'ghost', size: 'icon-sm', cls: 'pin', tip: pinned ? 'Unpin' : 'Pin: add to the totals', side: 'left' })}</summary>
    <div class="q-body"><ul class="objs">${t.objectives.map((o) => objRow('objectives', o.id, o)).join('')}</ul>
      <div class="q-tools">${action}${btn(`Open in Quests ${icon('external')}`, `data-act="goto" data-module="quests" data-id="${esc(t.id)}"`, { variant: 'ghost', size: 'xs' })}</div></div>
  </details></li>`;
}

function totalsPanel() {
  const T = pinnedTotals();
  if (!T.tasks.length) {
    return `<div class="card" data-size="sm"><header><h2>Pinned quests</h2><p>Pin quests with the star to add up what they need.</p></header>
      <section>${emptyState('', 'Nothing pinned yet. Pinned quests can be on any map; completed ones unpin themselves.', '', 'star')}</section></div>`;
  }
  const line = (lead, name, sub, ct = '', ctSub = '') => `<div class="rp-line">${lead}<span class="nm">${name}<small>${sub}</small></span><span class="ct">${ct}${ctSub ? `<small>${ctSub}</small>` : ''}</span></div>`;
  const ico = (items) => pic(items[0]?.iconLink, items[0]?.shortName || items[0]?.name, 'ico');
  const anyOf = (items) => (items.length > 1 ? `any of: ${names(items)}` : esc(items[0]?.name || '?'));
  const items = [
    ...T.items.map((e) => line(ico(e.items), `${anyOf(e.items)} ${e.fir ? badge('FIR', 'primary', 'fir') : ''}`, esc(e.from.join(', ')), `×${e.count - e.have}`, e.have ? `of ${e.count} · ${e.have} done` : '')),
    ...T.questItems.map((e) => line(pic(null, e.item.name, 'ico'), `${esc(e.item.name)} ${badge('quest item')}`, `found in raid · ${esc(e.from.join(', '))}`, '×1')),
  ].join('');
  const keys = T.keys.map((e) => line(ico(e.keys), e.keys.length > 1 ? `any one of: ${names(e.keys)}` : esc(e.keys[0].name), `${esc(e.maps.map(mapLabel).join(', '))} · ${esc(e.from.join(', '))}`)).join('');
  const HOW = { use: 'Use', wear: 'Wear', build: 'Build' };
  const gear = T.gear.map((e) => line(ico(e.items), `${HOW[e.how]}: ${e.how === 'wear' ? e.items.map((i) => esc(i.name)).join(' + ') : anyOf(e.items)}`, esc(e.from.join(', ')))).join('');
  const group = (title, count, body, none) => `<div class="rp-sum" data-group="${title.toLowerCase().split(' ')[0]}"><h4><span>${title}</span><span>${count}</span></h4>${body || `<p class="count">${none}</p>`}</div>`;
  return `<div class="card" data-size="sm"><header><h2>Pinned quests (${T.tasks.length})</h2><p>Everything they still need, added up</p></header><section>
    <div class="rp-pins">${T.tasks.map((t) => `<div class="rp-pin" data-id="${esc(t.id)}"><span><a href="#" data-act="rp-show" data-id="${esc(t.id)}">${esc(t.name)}</a> <small>· ${esc(t.trader?.name || '')}</small></span><small>${esc(taskMaps(t).map(mapLabel).join(', '))}</small>${btn(icon('x'), `data-act="rp-pin" data-id="${esc(t.id)}" aria-label="Unpin ${esc(t.name)}"`, { variant: 'ghost', size: 'icon-sm' })}</div>`).join('')}</div>
    <p class="rp-maps-sum">On ${T.maps.map(({ map, count }) => `<b>${esc(mapLabel(map))}</b> (${count})`).join(', ')}. Completed quests unpin themselves.</p>
    ${group('Items', T.items.length + T.questItems.length, items, 'Nothing to hand in.')}
    ${group('Keys', T.keys.length, keys, 'No keys needed.')}
    ${group('Gear to wear or use', T.gear.length, gear, 'No gear needed.')}
  </section></div>`;
}

function render() {
  if (!S.data?.tasks) return emptyState('No quest data yet', 'Refresh game data under Settings.', '', 'database');
  const f = S.ui.rp;
  const { all, maps } = mapCounts();
  if (f.map && !maps.some((m) => m.map === f.map)) f.map = '';
  const chip = (map, label, count) => btn(`${esc(label)} ${badge(count, f.map === map ? 'secondary' : 'outline', 'count-badge')}`, `data-act="rp-map" data-map="${esc(map)}" aria-pressed="${f.map === map}"`, { variant: f.map === map ? 'primary' : 'outline', size: 'sm' });
  const list = plannerTasks();
  const pins = S.progress.questPins || {};
  return `<div class="rp-maps" role="group" aria-label="Map">${chip('', 'All maps', all)}${maps.map((m) => chip(m.map, mapLabel(m.map), m.count)).join('')}</div>
    <div class="rp-bar"><input type="search" class="input tb-search" data-ui="rp.text" value="${esc(f.text)}" placeholder="Filter quests…" aria-label="Filter quests">
      ${toggleSwitch('Include locked quests', 'data-ui="rp.locked"', f.locked)}
      <span class="count">${list.length} quest${list.length === 1 ? '' : 's'} ${f.map ? `on ${esc(mapLabel(f.map))}` : 'on all maps'}, all traders</span></div>
    <div class="rp-layout">
      <div>${list.length ? `<ul class="rp-list">${list.map((t) => questRow(t, pins)).join('')}</ul>` : emptyState('', f.locked ? 'No quests here.' : 'No active quests here. Switch on "Include locked quests" to plan ahead.', '', 'search')}</div>
      <aside class="rp-panel" aria-label="Pinned quests">${totalsPanel()}</aside>
    </div>`;
}

export default {
  render,
  actions: {
    ...objectiveActions,
    'rp-map'(el, ctx) { setMap(el.dataset.map); ctx.ui.render(); },
    'rp-pin'(el) { togglePin(el.dataset.id); },
    'rp-status'(el) { setTaskStatus(el.dataset.id, el.dataset.v); },
    // Pinned quest name: show it in the list (its map, row open).
    'rp-show'(el, ctx) {
      const t = S.data.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      const maps = taskMaps(t);
      if (S.ui.rp.map && !maps.includes(S.ui.rp.map)) setMap(maps[0]);
      if (taskStatus(t.id) === 'locked') S.ui.rp.locked = true;
      S.ui.open = { ...S.ui.open, [t.id]: true };
      saveUi();
      ctx.ui.render();
      document.getElementById(`rp-${t.id}`)?.scrollIntoView({ block: 'center' });
    },
  },
  changes: { ...objectiveChanges },
  toggle: (el) => questCardToggle(el),
};
