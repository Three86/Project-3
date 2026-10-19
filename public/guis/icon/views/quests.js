// Icon GUI quest overview: a row of trader cards (portrait, loyalty, reputation, restock timer);
// clicking one lists that trader's quests underneath. Uses the quests module's logic and the shared
// objective rows; quest and objective changes go through core/progress.js.
import { S } from '../../../core/store.js';
import { esc } from '../../../core/util.js';
import { STATUS_LABEL, idx, objValue, taskMaps, taskStatus } from '../../../core/game.js';
import { badge, btn, emptyState, icon } from '../../../ui/basecoat/components.js';
import { objRow, objectiveActions, objectiveChanges } from '../../../ui/basecoat/objectives.js';
import { questCardToggle } from '../../../ui/basecoat/quest-card.js';
import defaultView from '../../../modules/quests/view.js';
import { filteredTasks, sortTasks, toggleStatusFilter, focusTask, setTaskStatus, startWithPrereqs, traderCards, selectTrader, setLoyaltyOverride, hasStandingData, restockIn } from '../../../modules/quests/logic.js';

const STATUSES = ['active', 'locked', 'completed', 'failed'];
const CLOCK = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
const clock = `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CLOCK}</svg>`;

const fmtRep = (r) => `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
function fmtRestock(s) {
  if (s == null) return 'unknown';
  if (s <= 0) return 'due now';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(x).padStart(2, '0')}s`;
}
const initials = (n) => (String(n).match(/[A-Z]/g) || []).slice(0, 2).join('') || String(n).slice(0, 2).toUpperCase();
const hue = (n) => [...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const pips = (level, max, manual) => `<span class="pips${manual ? ' manual' : ''}" aria-label="Loyalty level ${level} of ${max}">${Array.from({ length: Math.max(max, 1) }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;

// Restock countdowns tick every second without redrawing the page.
if (typeof document !== 'undefined') {
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-restock]')) el.textContent = fmtRestock(restockIn(el.dataset.restock));
  }, 1000);
}

// The trader shown: the one picked last, else the first with active quests, else the first with quests.
function currentTrader(cards) {
  const picked = cards.find((c) => c.trader.name === S.ui.q.trader);
  if (picked) return picked;
  const c = cards.find((x) => x.counts.active) || cards.find((x) => x.counts.total) || cards[0];
  if (c) S.ui.q.trader = c.trader.name;
  return c;
}

function traderCard(c, selected) {
  const { trader: t, loyalty: L, unlock, counts } = c;
  const locked = !unlock.unlocked;
  const repKnown = hasStandingData();
  return `<button type="button" class="trader${locked ? ' locked' : ''}" data-act="trader" data-name="${esc(t.name)}" aria-pressed="${selected}">
    <span class="portrait" style="background:linear-gradient(160deg, oklch(0.45 0.06 ${hue(t.name)}), oklch(0.25 0.03 ${hue(t.name)}))">
      <span class="initials">${esc(initials(t.name))}</span>
      <img src="${esc(c.image)}" alt="" loading="lazy" onerror="this.remove()">
      <span class="ll-chip">${locked ? icon('lock') : `LL${L.level}`}</span>${counts.active ? `<span class="active-chip" title="${counts.active} active">${counts.active}</span>` : ''}
    </span>
    <span class="t-name">${esc(t.name)}</span>
    ${pips(locked ? 0 : L.level, L.max, L.manual)}
    <span class="t-stats"><span>Rep</span><b class="${c.rep < 0 ? 'rep-neg' : ''}">${repKnown ? fmtRep(c.rep) : '–'}</b>
      ${locked ? `<span>${icon('lock')}</span><b title="Unlocked by ${esc(unlock.by?.name || '')}">${esc(unlock.by?.name || 'locked')}</b>`
        : `<span>${clock}</span><b data-restock="${esc(t.id)}" title="Time to restock">${fmtRestock(c.restock)}</b>`}</span>
  </button>`;
}

function traderHead(c, ctx) {
  const { trader: t, loyalty: L, unlock } = c;
  const pl = S.progress.settings.playerLevel;
  let next;
  if (!unlock.unlocked) next = `Unlocked by completing <a href="#" data-act="goto" data-module="quests" data-id="${esc(unlock.by.id)}">${esc(unlock.by.name)}</a>.`;
  else if (!t.levels?.length) next = 'No loyalty data for this trader yet (refresh game data).';
  else if (!L.next) next = 'Max loyalty.';
  else {
    const rep = L.next.repMissing > 0 ? `<b>${L.next.repMissing.toFixed(2)}</b> more rep` : 'rep ✓';
    const lvl = L.next.playerLevelMissing > 0 ? `level <b>${L.next.requiredPlayerLevel}</b> (you ${pl})` : 'level ✓';
    next = `Next: <b>LL${L.next.level}</b> needs ${rep}, ${lvl} · money spent not tracked`;
  }
  const manual = S.progress.settings.loyaltyManual && unlock.unlocked && t.levels?.length
    ? `<label class="label tb-field"><span>Loyalty</span><select class="select" data-size="sm" data-act="ll-set" data-id="${esc(t.id)}" aria-label="${esc(t.name)} loyalty level">
        ${[['auto', `Auto (LL${L.auto})`], ...t.levels.map((l) => [String(l.level), `LL${l.level}`])].map(([v, label]) => `<option value="${v}" ${(L.manual ? String(L.level) : 'auto') === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`
    : '';
  return `<div class="trader-head">
    <span class="th-name">${esc(t.name)}</span>
    <span class="th-ll">${pips(unlock.unlocked ? L.level : 0, L.max, L.manual)}${badge(`LL${L.level}${L.manual ? ' · manual' : ''}`, 'secondary')}</span>
    ${hasStandingData() ? badge(`Rep ${fmtRep(c.rep)}`) : badge('Rep unknown', 'outline', '', 'Refresh game data to get quest reputation rewards')}
    <span class="th-next">${next}</span>
    <span class="spacer"></span>${manual}
  </div>`;
}

// Reputation this quest gives its own trader when completed.
const repReward = (t) => (t.finishRewards?.traderStanding || []).filter((s) => s.trader?.id === t.trader?.id).reduce((a, s) => a + s.standing, 0);

function whyLocked(t) {
  const missing = t.taskRequirements.filter((r) => r.task && taskStatus(r.task.id) !== 'completed').map((r) => r.task.name);
  if (missing.length) return `Needs ${missing.join(', ')}`;
  if ((t.minPlayerLevel || 0) > S.progress.settings.playerLevel) return `Needs level ${t.minPlayerLevel} (you ${S.progress.settings.playerLevel})`;
  return 'Locked';
}

function questRow(t) {
  const st = taskStatus(t.id);
  const req = t.objectives.filter((o) => !o.optional);
  const done = req.filter((o) => objValue('objectives', o.id, o).done).length;
  const pct = req.length ? Math.round((done / req.length) * 100) : 0;
  const rep = repReward(t);
  const p = S.progress.tasks[t.id];
  const action = st === 'active' ? btn('Complete', `data-act="quest-set" data-id="${esc(t.id)}" data-v="completed"`, { size: 'xs' })
    : st === 'available' ? btn('Start', `data-act="quest-set" data-id="${esc(t.id)}" data-v="active"`, { variant: 'outline', size: 'xs' })
    : st === 'locked' ? badge(`${icon('lock')} Locked`)
    : badge(STATUS_LABEL[st], 'outline', `status-${st}`);
  const tools = [
    t.wikiLink ? `<a class="btn" data-variant="ghost" data-size="xs" href="${esc(t.wikiLink)}" target="_blank" rel="noopener">Wiki ${icon('external')}</a>` : '',
    st === 'locked' ? btn('Start + complete prereqs', `data-act="quest-chain" data-id="${esc(t.id)}"`, { variant: 'ghost', size: 'xs', tip: 'Mark all prerequisite quests completed and start this one' }) : '',
    st === 'active' ? btn('Mark failed', `data-act="quest-set" data-id="${esc(t.id)}" data-v="failed"`, { variant: 'ghost', size: 'xs' }) : '',
    p ? btn('Reset quest', `data-act="quest-set" data-id="${esc(t.id)}" data-v=""`, { variant: 'ghost', size: 'xs' }) : '',
  ].join('');
  return `<li><details class="qrow st-${st}" id="task-${esc(t.id)}" data-open="${esc(t.id)}" ${S.ui.open[t.id] ? 'open' : ''}>
    <summary>${icon('chevron', 'caret').replace('<path d="m6 9 6 6 6-6"/>', '<path d="m9 18 6-6-6-6"/>')}
      <span class="q-name">${esc(t.name)}<span class="q-sub">${st === 'locked' ? esc(whyLocked(t)) : `Level ${t.minPlayerLevel || 1}${t.kappaRequired ? ' · Kappa' : ''}`}</span></span>
      <span class="q-map count">${esc(taskMaps(t).join(', '))}</span>
      <span class="q-prog">${req.length ? `${done}/${req.length} objectives<div class="progress" role="progressbar" aria-label="Objectives done" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ''}</span>
      <span class="q-rep${rep ? '' : ' none'}">${rep ? `${fmtRep(rep)} rep` : ''}</span>
      <span class="q-act">${action}</span></summary>
    <div class="q-body"><ul class="objs">${t.objectives.map((o) => objRow('objectives', o.id, o)).join('')}</ul>
      ${tools ? `<div class="q-tools">${tools}</div>` : ''}</div>
  </details></li>`;
}

function render(ctx) {
  const cards = traderCards();
  if (!cards.length) return emptyState('No traders', 'Refresh game data under Settings.', '', 'database');
  const cur = currentTrader(cards);
  const f = S.ui.q;
  // Status counts for this trader only.
  const counts = {};
  for (const t of S.data.tasks) if (t.trader?.name === cur.trader.name) { const s = taskStatus(t.id); counts[s] = (counts[s] || 0) + 1; }
  const list = sortTasks(filteredTasks());
  const toolbar = `<div class="toolbar">
    <div class="chips" role="group" aria-label="Status">${STATUSES.filter((s) => s !== 'failed' || counts.failed).map((s) => {
      const on = f.statuses.includes(s);
      return btn(`${STATUS_LABEL[s]} ${badge(counts[s] || 0, on ? 'secondary' : 'outline', 'count-badge')}`, `data-act="qstatus" data-s="${s}" aria-pressed="${on}"`, { variant: on ? 'primary' : 'outline', size: 'sm' });
    }).join('')}</div>
    <input type="search" class="input tb-search" data-ui="q.text" value="${esc(f.text)}" placeholder="Filter ${esc(cur.trader.name)}'s quests…" aria-label="Filter quests">
    <span class="count">${list.length} of ${cur.counts.total} quests</span>
  </div>`;
  return `<div class="trader-strip" role="group" aria-label="Traders">${cards.map((c) => traderCard(c, c === cur)).join('')}</div>
    ${traderHead(cur, ctx)}
    ${toolbar}
    ${list.length ? `<ul class="qlist">${list.map(questRow).join('')}</ul>` : emptyState('', cur.counts.total ? 'No quests with these statuses. Pick more above.' : `${esc(cur.trader.name)} has no quests.`, '', 'search')}`;
}

export default {
  render,
  actions: {
    ...objectiveActions,
    trader(el, ctx) { selectTrader(el.dataset.name); ctx.ui.render(); },
    qstatus(el, ctx) { toggleStatusFilter(el.dataset.s); ctx.ui.render(); },
    'quest-set'(el) { setTaskStatus(el.dataset.id, el.dataset.v); },
    'quest-chain'(el) { startWithPrereqs(el.dataset.id); },
  },
  changes: {
    ...objectiveChanges,
    'll-set'(el) { setLoyaltyOverride(el.dataset.id, el.value); },
  },
  toggle: (el) => questCardToggle(el),
  // Links from other sections: show the quest under its trader, all statuses, row open.
  goto({ id }) {
    const t = focusTask(id);
    if (!t) return null;
    selectTrader(t.trader?.name || '');
    return () => {
      const el = document.getElementById(`task-${id}`);
      el?.scrollIntoView({ block: 'center' });
      el?.classList.add('flash');
    };
  },
  commands: defaultView.commands,
};
