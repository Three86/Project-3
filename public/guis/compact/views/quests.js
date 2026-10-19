// Compact quest view: one checklist row per quest, objectives inline, no grouping. Uses the quests
// module's logic (filters, status changes) and the shared objective rows.
import { S } from '../../../core/store.js';
import { esc } from '../../../core/util.js';
import { STATUS_LABEL, objValue, taskMaps, taskStatus } from '../../../core/game.js';
import { badge, btn, checkbox, emptyState, progressBar } from '../../../ui/basecoat/components.js';
import { objRow, objectiveActions, objectiveChanges } from '../../../ui/basecoat/objectives.js';
import { filteredTasks, sortTasks, toggleStatusFilter, focusTask, setTaskStatus } from '../../../modules/quests/logic.js';

const SHOWN = ['active', 'available', 'locked', 'completed'];

function questRow(t) {
  const st = taskStatus(t.id);
  const req = t.objectives.filter((o) => !o.optional);
  const done = req.filter((o) => objValue('objectives', o.id, o).done).length;
  return `<li class="cq-row st-${st}" id="task-${t.id}">
    <div class="cq-head">
      <span class="cq-name">${esc(t.name)}</span>
      <span class="cq-meta">${esc(t.trader?.name || '?')} · ${esc(taskMaps(t).join(', '))}</span>
      ${badge(STATUS_LABEL[st], 'outline', `status-${st}`)}
      <span class="cq-actions">${st === 'active'
        ? btn('Complete', `data-act="task-set" data-id="${esc(t.id)}" data-v="completed"`, { variant: 'primary', size: 'xs' })
        : st !== 'completed' ? btn('Start', `data-act="task-set" data-id="${esc(t.id)}" data-v="active"`, { variant: 'outline', size: 'xs' }) : ''}</span>
    </div>
    ${req.length ? progressBar(done, req.length, 'Objectives done') : ''}
    ${st === 'active' ? `<ul class="objs">${t.objectives.map((o) => objRow('objectives', o.id, o)).join('')}</ul>` : ''}
  </li>`;
}

function render() {
  const f = S.ui.q;
  // Active quests first, then the module's sort order.
  const list = sortTasks(filteredTasks()).sort((a, b) => (taskStatus(b.id) === 'active') - (taskStatus(a.id) === 'active'));
  const toolbar = `<div class="toolbar">
    <div class="chips" role="group" aria-label="Status">${SHOWN.map((s) => {
      const on = f.statuses.includes(s);
      return btn(STATUS_LABEL[s], `data-act="qstatus" data-s="${s}" aria-pressed="${on}"`, { variant: on ? 'primary' : 'outline', size: 'xs' });
    }).join('')}</div>
    <label class="label cb-field">${checkbox('data-ui="q.kappa"', f.kappa)}Kappa only</label>
    <input type="search" class="input tb-search" data-ui="q.text" value="${esc(f.text)}" placeholder="Filter…" aria-label="Filter quests">
    <span class="count">${list.length}</span>
  </div>`;
  if (!list.length) return toolbar + emptyState('', 'No quests match.', '', 'search');
  return toolbar + `<ul class="cq-list">${list.map(questRow).join('')}</ul>`;
}

export default {
  render,
  actions: {
    ...objectiveActions,
    qstatus(el, ctx) { toggleStatusFilter(el.dataset.s); ctx.ui.render(); },
    'task-set'(el) { setTaskStatus(el.dataset.id, el.dataset.v); },
  },
  changes: { ...objectiveChanges },
  goto({ id }) {
    if (!focusTask(id)) return null;
    return () => document.getElementById(`task-${id}`)?.scrollIntoView({ block: 'center' });
  },
};
