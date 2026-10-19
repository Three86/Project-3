// Hideout: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { badge, btn, checkbox, emptyState, icon, progressBar, select, stepperControl } from '../../ui/basecoat/components.js';
import { itemTag, objectiveActions, objectiveChanges } from '../../ui/basecoat/objectives.js';
import { builtLevel, hideoutReqs, levelBuilt, levelUnlocked, REQ_NEEDS, stationRows, setBuilt, setAllOpen, setShow, focusStation, stations } from './logic.js';

function renderHideout() {
  const f = S.ui.h;
  const { rows, locked } = stationRows();
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

export default {
  render: renderHideout,
  actions: {
    ...objectiveActions,
    build(el) { setBuilt(el.dataset.id, el.dataset.v === '1'); },
    'stations-open'(el, ctx) { setAllOpen(el.dataset.v === '1'); ctx.ui.render(); },
    'h-show'(el, ctx) { setShow(el.dataset.v); ctx.ui.render(); },
  },
  changes: { ...objectiveChanges },
  toggle(el) {
    const h = el.dataset.hopen;
    if (!h) return false;
    S.ui.hOpen[h] = el.open;
    return true;
  },
  // Links from other sections: { id } of a station.
  goto({ id }) {
    if (!focusStation(id)) return null;
    return () => document.querySelector(`[data-hopen="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  },
  commands() {
    return stations().map((st) => ({ group: 'Hideout', label: st.name, attrs: `data-act="goto-station" data-id="${esc(st.id)}"`, keywords: 'hideout station module', hint: `level ${builtLevel(st)}/${st.levels[st.levels.length - 1].level}`, icon: 'home' }));
  },
};
