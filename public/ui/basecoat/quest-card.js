// Quest card (collapsible Basecoat card), shared by the quests and search default views.
import { S } from '../../core/store.js';
import { setTaskStatus, startWithPrereqs } from '../../core/progress.js';
import { esc } from '../../core/util.js';
import { STATUS_LABEL, autoValue, objValue, reqStatuses, taskMaps, taskProgress, taskStatus } from '../../core/game.js';
import { badge, btn, dropdownMenu, icon, popover, progressBar } from './components.js';
import { objRow } from './objectives.js';

export function taskCard(t) {
  const st = taskStatus(t.id);
  const p = S.progress.tasks[t.id];
  const pct = Math.round(taskProgress(t) * 100);
  const open = S.ui.open?.[t.id] ?? false;
  const actions = [];
  if (st !== 'active' && st !== 'completed') actions.push(btn('Start', `data-act="task" data-id="${t.id}" data-v="active"`, { variant: st === 'available' ? 'primary' : 'outline', size: 'sm' }));
  if (st !== 'completed') actions.push(btn('Complete', `data-act="task" data-id="${t.id}" data-v="completed"`, { variant: st === 'active' ? 'primary' : 'outline', size: 'sm' }));
  const more = [];
  if (st === 'locked') more.push({ label: 'Start + complete prereqs', attrs: `data-act="taskchain" data-id="${t.id}" title="Mark all prerequisite quests completed and start this one"` });
  if (st === 'active') more.push({ label: 'Mark failed', attrs: `data-act="task" data-id="${t.id}" data-v="failed"`, destructive: true });
  if (p) more.push({ label: 'Reset quest', attrs: `data-act="task" data-id="${t.id}" data-v=""` });
  const prereqs = t.taskRequirements.filter((r) => r.task).map((r) => {
    const ok = autoValue({ type: 'taskStatus', task: r.task, status: r.status }).done;
    return { ok, html: `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '✗'} <a href="#" data-act="goto" data-module="quests" data-id="${r.task.id}">${esc(r.task.name)}</a>${reqStatuses(r).join() !== 'complete' ? ` (${esc(reqStatuses(r).join('/'))})` : ''}</span>` };
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

// Click handlers for the card's buttons and menu items.
export const questCardActions = {
  task(el) { setTaskStatus(el.dataset.id, el.dataset.v); },
  taskchain(el) { startWithPrereqs(el.dataset.id); },
};

// Remembers which quest cards are open (details[data-open]).
export function questCardToggle(el) {
  const id = el.dataset?.open;
  if (!id) return false;
  S.ui.open ||= {};
  S.ui.open[id] = el.open;
  return true;
}
