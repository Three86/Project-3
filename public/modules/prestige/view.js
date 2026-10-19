// Prestige: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { badge, btn, checkbox, emptyState, icon, progressBar } from '../../ui/basecoat/components.js';
import { objRow, objectiveActions, objectiveChanges } from '../../ui/basecoat/objectives.js';
import { prestigeList, prestigeName, isAchieved, conditionKey, currentPrestige, conditionsDone, customRequirements, setView, setAchieved, addCustom, toggleCustom, deleteCustom } from './logic.js';

function customBlock(pid) {
  const rows = customRequirements(pid);
  return `${rows.length ? `<ul class="objs custom-list">${rows.map(([id, c]) => `<li class="${c.done ? 'done' : ''}">${checkbox(`data-act="custom-toggle" data-id="${esc(id)}" aria-label="Done"`, c.done)}<div class="body"><div class="desc">${esc(c.text)} <span class="optional">(custom)</span></div></div>${btn(icon('trash'), `data-act="custom-del" data-id="${esc(id)}" aria-label="Delete requirement"`, { variant: 'ghost', size: 'icon-sm', tip: 'Delete', side: 'left' })}</li>`).join('')}</ul>` : ''}
    <form class="custom-add" data-act="custom-add" data-pid="${esc(pid)}"><div class="input-group"><input type="text" name="text" placeholder="Add your own requirement…" aria-label="New requirement"><span data-align="end"><button type="submit" class="btn" data-size="xs">${icon('plus')} Add</button></span></div></form>`;
}

function renderPrestige(ctx) {
  const list = prestigeList();
  const settingsLink = ctx.modules.some((m) => m.id === 'settings') ? ' (change in <a href="#" data-act="tab" data-tab="settings">Settings</a>)' : '';
  let html = `<div class="alert intro">${icon('info')}<section><p>Prestige requirements. Quest, level and hideout conditions update automatically; tick the rest yourself. Your level: <b>${S.progress.settings.playerLevel}</b>${settingsLink}.</p></section></div>`;
  if (!list.length) {
    html += emptyState('No prestige data', `No prestige data came back from tarkov.dev${S.data.meta?.prestigeError ? ` (${esc(S.data.meta.prestigeError)})` : ''}. Try refreshing game data, or track requirements by hand below.`, '', 'list')
      + `<div class="card prestige-card" data-size="sm"><header><h2>My prestige checklist</h2></header><section>${customBlock('general')}</section></div>`;
    return html;
  }
  const p = currentPrestige(list);
  const switcher = `<div class="tabs prestige-switch"><nav role="tablist" aria-orientation="horizontal" aria-label="Prestige level">${list.map((x) => `<button type="button" role="tab" aria-selected="${x.id === p.id}" tabindex="${x.id === p.id ? 0 : -1}" data-act="prestige-view" data-id="${esc(x.id)}">${isAchieved(x) ? '✓ ' : ''}${esc(prestigeName(x))}</button>`).join('')}</nav>
    ${S.ui.prestigeView ? btn('Next unachieved', 'data-act="prestige-view" data-id=""', { variant: 'ghost', size: 'sm', tip: 'Show the next prestige you have not achieved' }) : ''}</div>`;
  const conds = p.conditions || [];
  const achieved = isAchieved(p);
  const done = conditionsDone(p);
  const all = conds.length && done === conds.length;
  const name = esc(prestigeName(p));
  return html + switcher + `<div class="card prestige-card ${achieved || all ? 'st-completed' : 'st-active'}" data-size="sm">
      <header><h2>${name}</h2><p>${done} of ${conds.length} conditions met</p>
        <div class="card-action">${achieved ? badge('Achieved', 'outline', 'status-completed') : ''}${badge(`${done}/${conds.length}`, 'secondary')}</div></header>
      <section>${progressBar(done, conds.length, 'Conditions met')}
      <ul class="objs">${conds.map((o) => objRow('prestige', conditionKey(p, o), o, { disabled: achieved, forceDone: achieved })).join('')}</ul>
      ${customBlock(p.id)}</section>
      <footer class="actions">${achieved
        ? btn(`${icon('undo')} Undo: mark not achieved`, `data-act="prestige-achieved" data-id="${esc(p.id)}" data-v="0"`, { variant: 'outline', size: 'sm' })
        : btn(`Mark ${name} achieved`, `data-act="prestige-achieved" data-id="${esc(p.id)}" data-v="1"`, { variant: all ? 'primary' : 'outline', size: 'sm' })}</footer>
    </div>`;
}

export default {
  render: renderPrestige,
  actions: {
    ...objectiveActions,
    'prestige-view'(el, ctx) { setView(el.dataset.id); ctx.ui.render(); },
    async 'prestige-achieved'(el, ctx) {
      const on = el.dataset.v === '1';
      const name = prestigeName(prestigeList().find((x) => x.id === el.dataset.id));
      if (on && !(await ctx.ui.confirm(`Mark ${name} achieved?`, 'Its checklist is closed and the next prestige is shown. You can undo this any time.', 'Mark achieved'))) return;
      setAchieved(el.dataset.id, on);
      if (on) ctx.ui.toast('success', `${name} achieved`);
    },
    'custom-del'(el) { deleteCustom(el.dataset.id); },
  },
  changes: {
    ...objectiveChanges,
    'custom-toggle'(el) { toggleCustom(el.dataset.id, el.checked); },
  },
  submits: {
    'custom-add'(form) { addCustom(form.dataset.pid, form.text.value); },
  },
};
