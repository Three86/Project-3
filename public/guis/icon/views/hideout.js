// Icon GUI hideout: one card per module (icon, status, level with − / +); clicking a module shows
// everything a level needs, grouped (other modules, skills, traders, items). Items are only listed
// (what and how many); they are not tracked and do not count towards Ready / N missing.
import { S, saveUi } from '../../../core/store.js';
import { esc } from '../../../core/util.js';
import { hideoutReqs, levelBuilt } from '../../../core/game.js';
import { badge, btn, checkbox, emptyState, icon, progressBar } from '../../../ui/basecoat/components.js';
import { objectiveActions, objectiveChanges } from '../../../ui/basecoat/objectives.js';
import { stationCards, stationImage, stepLevel, setBuilt, focusStation } from '../../../modules/hideout/logic.js';

const STATE_TEXT = { ready: 'Ready', locked: 'Locked', max: 'Max level' };
const stateText = (s) => STATE_TEXT[s.key] || `${s.missing} missing`;
const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
const pic = (src, name, cls = '') => `<span class="pic ${cls}"><span class="initials">${esc(initials(name))}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
const fmt = (n) => Number(n).toLocaleString('en-US');

// The module shown in the panel: the one picked last, else the first ready one, else the first not maxed.
function current(cards) {
  return cards.find((c) => c.station.id === S.ui.hxSel)
    || cards.find((c) => c.status.key === 'ready') || cards.find((c) => c.status.key === 'missing') || cards[0];
}

function card(c, selected) {
  const { station: st, status: s } = c;
  return `<div class="station${s.key === 'locked' && s.built === 0 ? ' locked' : ''}" role="button" tabindex="0" data-act="hx-select" data-id="${esc(st.id)}" aria-pressed="${selected}">
    <span class="s-icon">${pic(c.image, st.name)}<span class="s-state">${badge(`${s.key === 'locked' ? icon('lock') : ''}${stateText(s)}`, 'outline', `st-${s.key}`, s.key === 'locked' ? `Needs ${s.lockedBy.map((r) => r.label).join(', ')}` : '')}</span></span>
    <span class="s-name">${esc(st.name)}</span>
    <span class="s-bar" aria-hidden="true">${st.levels.map((l) => `<i class="${l.level <= s.built ? 'on' : ''}"></i>`).join('')}</span>
    <span class="s-level">${btn(icon('minus'), `data-act="hx-step" data-id="${esc(st.id)}" data-d="-1" aria-label="${esc(st.name)}: level down"`, { variant: 'outline', size: 'icon-xs', disabled: s.built <= 0 })}
      <span class="lv">${s.built}<small>/${s.max}</small></span>
      ${btn(icon('plus'), `data-act="hx-step" data-id="${esc(st.id)}" data-d="1" aria-label="${esc(st.name)}: level up"`, { variant: s.key === 'ready' ? 'primary' : 'outline', size: 'icon-xs', disabled: s.built >= s.max, tip: s.key === 'ready' || s.built >= s.max ? '' : 'Not all requirements met; marks it built anyway', side: 'left' })}</span>
  </div>`;
}

const GROUPS = [['station', 'Hideout'], ['skill', 'Skills'], ['trader', 'Traders'], ['item', 'Items']];

function reqRow(r, built) {
  const done = built || r.done;
  if (r.kind === 'item') {
    return `<div class="req item${built ? ' done' : ''}">${pic(r.item.iconLink, r.item.shortName || r.item.name, 'r-ico')}
      <span class="r-main">${esc(r.item.name)} ${r.fir ? badge('FIR', 'primary', 'fir', 'Must be found in raid') : ''}</span><span class="r-count">×${fmt(r.count)}</span></div>`;
  }
  const lead = r.kind === 'station' ? pic(stationImage(r.station?.id), r.station?.name || '', 'r-ico') : '';
  const auto = r.auto || built;
  const control = auto ? `<span class="${done ? 'ok' : 'no'}" aria-label="${done ? 'Met' : 'Not met'}">${icon(done ? 'check' : 'x')}</span>`
    : checkbox(`data-act="check" data-sec="hideoutReqs" data-key="${esc(r.key)}" aria-label="Done"`, r.done);
  const sub = built ? 'met when built' : auto ? 'checked automatically' : 'tick it yourself';
  const link = r.kind === 'station' && r.station ? `<a href="#" data-act="hx-select" data-id="${esc(r.station.id)}">${esc(r.label)}</a>` : esc(r.label);
  return `<div class="req ${done ? 'done' : ''}">${lead}<span class="r-main">${link}<span class="r-sub">${sub}</span></span>${control}</div>`;
}

function panel(c) {
  const { station: st, status: s } = c;
  const viewLevel = st.levels.find((l) => l.level === S.ui.hxView) || s.next || st.levels[st.levels.length - 1];
  const built = levelBuilt(st, viewLevel);
  const reqs = viewLevel ? hideoutReqs(viewLevel) : [];
  const tracked = reqs.filter((r) => r.kind !== 'item'); // items are listed, not tracked
  const met = built ? tracked.length : tracked.filter((r) => r.done).length;
  const tabs = st.levels.length > 1 ? `<div class="lv-tabs" role="group" aria-label="Level">${st.levels.map((l) => btn(`L${l.level}${l.level <= s.built ? ' ✓' : ''}`, `data-act="hx-view" data-v="${l.level}" aria-pressed="${l.level === viewLevel.level}"`, { variant: l.level === viewLevel.level ? 'secondary' : 'ghost', size: 'xs' })).join('')}</div>` : '';
  const groups = GROUPS.map(([kind, title]) => {
    const rows = reqs.filter((r) => r.kind === kind);
    if (!rows.length) return '';
    const tally = kind === 'item' ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : `${built ? rows.length : rows.filter((r) => r.done).length}/${rows.length}`;
    return `<div class="req-group"><h4><span>${title}</span><span>${tally}</span></h4>${rows.map((r) => reqRow(r, built)).join('')}</div>`;
  }).join('');
  const time = viewLevel?.constructionTime ? ` · ${Math.round(viewLevel.constructionTime / 360) / 10} h to build` : '';
  const isNext = viewLevel && viewLevel.level === s.built + 1;
  return `<div class="card" data-size="sm">
    <header><h2>${esc(st.name)}</h2><p>Level ${s.built} of ${s.max} · ${built ? `level ${viewLevel.level} built` : `requirements for level ${viewLevel.level}`}</p>
      <div class="card-action">${badge(stateText(s), 'outline', `st-${s.key}`)}</div></header>
    <section>${tabs}
      ${viewLevel?.description ? `<p class="hx-desc">${esc(viewLevel.description)}</p>` : ''}
      ${tracked.length ? `${progressBar(met, tracked.length, 'Requirements met')}<span class="count">${met} of ${tracked.length} requirements met${time}</span>` : `<p class="hx-desc">${reqs.length ? 'Only items needed.' : 'No requirements.'}${time}</p>`}
      ${groups}
    </section>
    ${isNext ? `<footer class="actions">${btn(`Mark level ${viewLevel.level} built`, `data-act="hx-build" data-id="${esc(viewLevel.id)}"`, { variant: s.key === 'ready' ? 'primary' : 'outline', size: 'sm' })}</footer>` : ''}
  </div>`;
}

function render() {
  const cards = stationCards({ countItems: false });
  if (!cards.length) return emptyState('No hideout data', 'Refresh game data under Settings.', '', 'database');
  const cur = current(cards);
  const counts = { ready: 0, missing: 0, locked: 0, max: 0 };
  for (const c of cards) counts[c.status.key]++;
  return `<div class="hx-summary"><span><b>${cards.length}</b> modules</span>
      ${badge(`${counts.ready} ready to upgrade`, 'outline', 'st-ready')}${badge(`${counts.missing} missing requirements`, 'outline', 'st-missing')}
      ${badge(`${icon('lock')}${counts.locked} locked`, 'outline', 'st-locked')}${badge(`${counts.max} max level`, 'outline', 'st-max')}</div>
    <div class="hx-layout">
      <div class="hx-grid" role="group" aria-label="Hideout modules">${cards.map((c) => card(c, c === cur)).join('')}</div>
      <aside class="hx-panel" aria-label="${esc(cur.station.name)} requirements">${panel(cur)}</aside>
    </div>`;
}

function select(id) { S.ui.hxSel = id; S.ui.hxView = null; saveUi(); }

// Cards are role="button" divs (they contain buttons); let Enter / Space open them.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    const c = e.target?.closest?.('.station[data-act="hx-select"]');
    if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); }
  });
}

export default {
  render,
  actions: {
    ...objectiveActions,
    'hx-select'(el, ctx) { select(el.dataset.id); ctx.ui.render(); },
    'hx-view'(el, ctx) { S.ui.hxView = Number(el.dataset.v); saveUi(); ctx.ui.render(); },
    'hx-step'(el) { S.ui.hxSel = el.dataset.id; S.ui.hxView = null; saveUi(); stepLevel(el.dataset.id, Number(el.dataset.d)); },
    'hx-build'(el) { S.ui.hxView = null; saveUi(); setBuilt(el.dataset.id, true); },
  },
  changes: { ...objectiveChanges },
  // Links from other sections (command palette): { id } of a station.
  goto({ id }) {
    if (!focusStation(id)) return null;
    select(id);
    return () => document.querySelector(`.station[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  },
};
