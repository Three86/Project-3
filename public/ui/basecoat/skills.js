// "Total buffs on your PMC" card, shared by the skills and buffs default views.
import { S } from '../../core/store.js';
import { esc, uniq, fmtNum } from '../../core/util.js';
import { effectValue } from '../../core/game.js';
import { badge, emptyState, icon } from './components.js';

export function skillOverview(cfg, lv) {
  const cats = uniq(cfg.skills.map((sk) => sk.category));
  const elite = cfg.eliteLevel || 51;
  // Overview: every active buff, grouped by category, plus totals for effects that several skills share.
  const leveled = cfg.skills.filter((sk) => lv(sk) > 0);
  const combined = new Map();
  for (const sk of leveled) {
    if (sk.category === 'Combat') continue; // weapon-class effects only apply to their own weapon class
    for (const e of sk.effects || []) {
      const c = combined.get(e.name) || { total: 0, unit: e.unit, from: [] };
      c.total += effectValue(sk, e, lv(sk));
      c.from.push(sk.name);
      combined.set(e.name, c);
    }
  }
  const shared = [...combined.entries()].filter(([, c]) => c.from.length > 1);
  return leveled.length ? `<details class="card qcard skill-overview" data-size="sm" data-skill-overview ${S.ui.skillOverviewOpen === false ? '' : 'open'}>
      <summary><div class="qhead"><span class="title">Total buffs on your PMC</span>${badge(`${leveled.length} skills leveled · ${leveled.filter((sk) => lv(sk) >= elite).length} elite`, 'secondary')}${icon('chevron', 'caret')}</div></summary>
      <section><div class="overview-grid">${cats.map((cat) => {
        const sks = leveled.filter((sk) => sk.category === cat);
        if (!sks.length) return '';
        return `<div><div class="ov-cat">${esc(cat)}</div>${sks.map((sk) => `<div class="ov-skill"><b>${esc(sk.name)}</b> <span class="auto">lvl ${lv(sk)}</span>${lv(sk) >= elite ? ` ${badge('Elite', 'outline', 'kappa')}` : ''}
          ${(sk.effects || []).map((e) => `<div class="ov-row"><span>${esc(e.name)}</span><span class="num">${fmtNum(effectValue(sk, e, lv(sk)))}${esc(e.unit || '')}</span></div>`).join('')}
          ${lv(sk) >= elite ? (sk.elite || []).map((x) => `<div class="ov-row elite"><span>★ ${esc(x)}</span></div>`).join('') : ''}</div>`).join('')}</div>`;
      }).join('')}</div>
      ${shared.length ? `<div class="ov-cat" style="margin-top:10px">Combined (same effect from several skills)</div>${shared.map(([name, c]) => `<div class="ov-row"><span>${esc(name)} <span class="auto">(${esc(c.from.join(' + '))})</span></span><span class="num">${fmtNum(c.total)}${esc(c.unit || '')}</span></div>`).join('')}` : ''}
    </section></details>` : emptyState('', 'Enter your skill levels to see the total buffs on your PMC.', '', 'zap');
}

// Remembers whether the card is open (details[data-skill-overview]).
export function skillOverviewToggle(el) {
  if (!el.hasAttribute?.('data-skill-overview')) return false;
  S.ui.skillOverviewOpen = el.open;
  return true;
}
