// Compact quest view, made for a glance at a second monitor during a raid: pick the map you're on, see
// only the quests there (pinned first) with just the objectives still to do. Uses the quests module's
// filters and status changes, the Raid planner's pins and the shared objective rows.
import { S, saveUi } from '../../../core/store.js';
import { esc } from '../../../core/util.js';
import { STATUS_LABEL, objValue, taskMaps, taskMapText, taskStatus } from '../../../core/game.js';
import { badge, btn, checkbox, emptyState, icon, progressBar } from '../../../ui/basecoat/components.js';
import { objRow, objectiveActions, objectiveChanges } from '../../../ui/basecoat/objectives.js';
import { wikiBadge } from '../../../ui/basecoat/quest-card.js';
import { STATUS_FILTERS, filteredTasks, sortTasks, toggleStatusFilter, focusTask, setTaskStatus } from '../../../modules/quests/logic.js';
import { ANY_MAP, pinState, togglePin } from '../../../modules/planner/logic.js';

// Quests matching every filter except the map (for the map chips' counts).
function anyMapTasks() {
  const f = S.ui.q;
  const map = f.map;
  f.map = '';
  try { return filteredTasks(); } finally { f.map = map; }
}

function mapChips(list) {
  const counts = new Map();
  for (const t of list) for (const m of taskMaps(t)) counts.set(m, (counts.get(m) || 0) + 1);
  // Counts are the quests tied to that map; quests you can do on any map show on every map's list.
  counts.delete(ANY_MAP);
  const cur = S.ui.q.map;
  const chip = (map, label, n) => btn(`${esc(label)} <span class="cq-n">${n}</span>`, `data-act="cq-map" data-map="${esc(map)}" aria-pressed="${cur === map}"`, { variant: cur === map ? 'primary' : 'outline', size: 'xs' });
  return `<div class="chips cq-maps" role="group" aria-label="Map">${chip('', 'All maps', list.length)}${[...counts].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, n]) => chip(m, m, n)).join('')}</div>`;
}

function questRow(t, pins) {
  const st = taskStatus(t.id);
  const req = t.objectives.filter((o) => !o.optional);
  const isDone = (o) => objValue('objectives', o.id, o).done;
  const done = req.filter(isDone).length;
  const kind = pins.get(t.id);
  const todo = t.objectives.filter((o) => !isDone(o));
  const finished = t.objectives.filter(isDone);
  const pin = btn(icon('star', kind ? 'filled' : ''), `data-act="cq-pin" data-id="${esc(t.id)}" aria-pressed="${!!kind}" aria-label="${kind ? 'Unpin' : 'Pin'} ${esc(t.name)}"`,
    { variant: kind ? 'secondary' : 'ghost', size: 'icon-sm', cls: 'pin', tip: kind === 'auto' ? 'Pinned automatically (Kappa / Lightkeeper)' : kind ? 'Unpin' : 'Pin to the top' });
  return `<li class="cq-row st-${st}" id="task-${t.id}">
    <div class="cq-head">
      ${pin}
      <span class="cq-name">${esc(t.name)}${wikiBadge(t)}</span>
      <span class="cq-meta">${esc(t.trader?.name || '?')} · ${esc(taskMapText(t))}</span>
      ${st === 'active' ? '' : badge(STATUS_LABEL[st], 'outline', `status-${st}`)}
      <span class="cq-actions">${st === 'active'
        ? btn('Complete', `data-act="task-set" data-id="${esc(t.id)}" data-v="completed"`, { variant: 'primary', size: 'xs' })
        : st !== 'completed' ? btn('Start', `data-act="task-set" data-id="${esc(t.id)}" data-v="active"`, { variant: 'outline', size: 'xs' }) : ''}</span>
    </div>
    ${req.length ? progressBar(done, req.length, 'Objectives done') : ''}
    ${st === 'active' && todo.length ? `<ul class="objs">${todo.map((o) => objRow('objectives', o.id, o)).join('')}</ul>` : ''}
    ${st === 'active' && finished.length ? `<details class="cq-done"><summary>${finished.length} done</summary><ul class="objs">${finished.map((o) => objRow('objectives', o.id, o)).join('')}</ul></details>` : ''}
  </li>`;
}

function render() {
  const f = S.ui.q;
  const pins = pinState();
  const base = anyMapTasks();
  const onlyPinned = !!f.pinned;
  // Pinned quests first (in pin order), then active ones, then the module's sort order.
  const order = new Map([...pins.keys()].map((id, i) => [id, i]));
  const list = sortTasks(filteredTasks())
    .filter((t) => !onlyPinned || pins.has(t.id))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || (taskStatus(b.id) === 'active') - (taskStatus(a.id) === 'active'));
  const toolbar = `<div class="toolbar cq-toolbar">
    ${mapChips(base)}
    <div class="cq-filters">
      <div class="chips" role="group" aria-label="Status">${STATUS_FILTERS.map((s) => {
        const on = f.statuses.includes(s);
        return btn(STATUS_LABEL[s], `data-act="qstatus" data-s="${s}" aria-pressed="${on}"`, { variant: on ? 'primary' : 'outline', size: 'xs' });
      }).join('')}</div>
      <label class="label cb-field">${checkbox('data-ui="q.pinned"', onlyPinned)}Pinned only</label>
      <label class="label cb-field">${checkbox('data-ui="q.kappa"', f.kappa)}Kappa</label>
      <label class="label cb-field">${checkbox('data-ui="q.lightkeeper"', f.lightkeeper)}Lightkeeper</label>
      <input type="search" class="input tb-search" data-ui="q.text" value="${esc(f.text)}" placeholder="Filter…" aria-label="Filter quests">
      <span class="count">${list.length}</span>
    </div>
  </div>`;
  if (!list.length) {
    const why = onlyPinned ? 'No pinned quests here. Pin quests with the star, or switch off "Pinned only".' : f.map ? `No quests on ${esc(f.map)} with these filters.` : 'No quests match.';
    return toolbar + emptyState('', why, '', onlyPinned ? 'star' : 'search');
  }
  return toolbar + `<ul class="cq-list">${list.map((t) => questRow(t, pins)).join('')}</ul>`;
}

export default {
  render,
  actions: {
    ...objectiveActions,
    qstatus(el, ctx) { toggleStatusFilter(el.dataset.s); ctx.ui.render(); },
    'cq-map'(el, ctx) { S.ui.q.map = el.dataset.map || ''; saveUi(); ctx.ui.render(); },
    'cq-pin'(el) { togglePin(el.dataset.id); },
    'task-set'(el) { setTaskStatus(el.dataset.id, el.dataset.v); },
  },
  changes: { ...objectiveChanges },
  goto({ id }) {
    if (!focusTask(id)) return null;
    return () => document.getElementById(`task-${id}`)?.scrollIntoView({ block: 'center' });
  },
};
