// Quests: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { idx, NEEDS, STATUS_LABEL, taskMaps, taskStatus } from '../../core/game.js';
import { badge, btn, checkbox, emptyState, icon, progressBar, select } from '../../ui/basecoat/components.js';
import { objectiveActions, objectiveChanges } from '../../ui/basecoat/objectives.js';
import { taskCard, questCardActions, questCardToggle } from '../../ui/basecoat/quest-card.js';
import { filteredTasks, sortTasks, groupKey, groupTasks, toggleStatusFilter, setAllOpen, setAllGroupsOpen, focusTask } from './logic.js';

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

export default {
  render: renderQuests,
  actions: {
    ...objectiveActions,
    ...questCardActions,
    qstatus(el, ctx) { toggleStatusFilter(el.dataset.s); ctx.ui.render(); },
    'quests-open'(el, ctx) { setAllOpen(el.dataset.v === '1'); ctx.ui.render(); },
    'groups-open'(el, ctx) { setAllGroupsOpen(el.dataset.v === '1'); ctx.ui.render(); },
  },
  changes: { ...objectiveChanges },
  toggle(el) {
    if (questCardToggle(el)) return true;
    const g = el.dataset.group;
    if (!g) return false;
    S.ui.groups[g] = el.open;
    return true;
  },
  // Links from other sections: { id } of a quest.
  goto({ id }) {
    if (!focusTask(id)) return null;
    return () => {
      const el = document.getElementById(`task-${id}`);
      if (!el) return;
      const group = el.closest('details.group');
      if (group && !group.open) group.open = true;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
    };
  },
  commands() {
    if (!S.data) return [];
    return S.data.tasks.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
      const st = taskStatus(t.id);
      return { group: 'Quests', label: t.name, attrs: `data-act="goto" data-id="${esc(t.id)}"`, keywords: `${t.trader?.name || ''} ${taskMaps(t).join(' ')} ${st}`, hint: `${esc(t.trader?.name || '')} · ${STATUS_LABEL[st]}` };
    });
  },
};
