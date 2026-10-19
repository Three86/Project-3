// Buffs: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc, fmtNum } from '../../core/util.js';
import { badge, btn, icon } from '../../ui/basecoat/components.js';
import { skillOverview, skillOverviewToggle } from '../../ui/basecoat/skills.js';
import { activeSkillConfig, effectValue, hideoutBonusTotals, hideoutBoostPercent, bonusGroups, noBonusData, stationsBuilt, setAllGroupsOpen } from './logic.js';

function renderBuffs() {
  const cfg = activeSkillConfig();
  const lv = (sk) => Number(S.progress.skills[sk.id] || 0);
  const boost = hideoutBoostPercent();
  const totals = hideoutBonusTotals();
  const fmtPct = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}%`;
  const absValue = (b) => b.type === 'StashSize' ? `${b.total} cells` : b.type.startsWith('Unlock') ? 'Unlocked' : `+${b.total}`;
  const sections = bonusGroups(totals).map(({ key, title, rows }) => `<details class="buff-group" data-buffopen="${esc(key)}" ${S.ui.buffOpen[key] ? 'open' : ''}><summary><span class="ov-cat">${esc(title)}</span>${badge(`${rows.length} bonus${rows.length === 1 ? '' : 'es'}`, 'secondary')}${icon('chevron')}</summary><section>${rows.map((b) => `<div class="ov-row"><span>${esc(b.name)}${b.skillName ? ` <span class="auto">(${esc(b.skillName)})</span>` : ''}${b.type === 'AdditionalSlots' ? ` <span class="auto">(${esc(b.station)})</span>` : ''}
      <span class="auto">· ${esc(b.from.join(', '))}</span></span><span class="num"><b>${b.abs ? absValue(b) : fmtPct(b.boosted)}</b>${!b.abs && boost ? ` <span class="auto">(base ${fmtPct(b.pct)})</span>` : ''}</span></div>`).join('')}</section></details>`).join('');
  const hideoutCard = `<details class="card qcard buffs-hideout" data-size="sm" data-buffopen="hb" ${S.ui.buffOpen.hb === false ? '' : 'open'}>
      <summary><div class="qhead"><span class="title">Hideout bonuses</span>
      ${badge(`${totals.length} bonuses`, 'secondary')}${badge(`${stationsBuilt()} stations built`, 'secondary')}${icon('chevron', 'caret')}</div></summary>
      <section>
      ${totals.length ? `<div class="collapse-tools"><div role="group" class="button-group">${btn('Expand all', 'data-act="buff-groups" data-v="1"', { variant: 'outline', size: 'sm' })}${btn('Collapse all', 'data-act="buff-groups" data-v="0"', { variant: 'outline', size: 'sm' })}</div></div>` : ''}
      ${boost ? `<p class="auto">Includes your Hideout Management bonus: zone bonuses ×${Math.round((1 + boost / 100) * 1000) / 1000}.</p>` : ''}
      ${sections ? `<section class="accordion buff-groups" data-multiple>${sections}</section>` : (noBonusData()
        ? `<p class="auto">Your saved game data was downloaded before the tracker read hideout bonuses${S.status?.refreshing ? ' and is being refreshed now…' : '.'}</p>${btn(`${icon('refresh')} Refresh game data now`, 'data-act="refresh-data"', { variant: 'primary' })}`
        : `<p class="auto">${S.data ? 'No hideout bonuses yet. Mark stations built on the Hideout tab.' : 'Game data not loaded yet.'}</p>`)}
      <p class="kv">Bonuses of all built levels are added up; Hideout Management boosts percentage bonuses. Values come from tarkov.dev's hideout data.</p></section></details>`;
  return `<div class="buffs-layout">
      <section><h3 class="section-title">Hideout</h3>${hideoutCard}</section>
      <section><h3 class="section-title">Skills in game</h3>${renderSkillPractical(cfg, lv)}</section>
      <section><h3 class="section-title">All skill buffs</h3>${skillOverview(cfg, lv)}</section>
    </div>`;
}

// Practical, plain-language consequences of a few skills at your current level.
function renderSkillPractical(cfg, lv) {
  const base = cfg.baseValues || {};
  const get = (id) => cfg.skills.find((sk) => sk.id === id);
  const eff = (sk, pattern) => (sk?.effects || []).find((e) => pattern.test(e.name));
  const pct = (sk, pattern) => { const e = eff(sk, pattern); return e ? effectValue(sk, e, lv(sk)) : 0; };
  const kg = (n) => `${(Math.round(n * 10) / 10).toLocaleString()} kg`;
  const hrs = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const x = (n) => `×${(Math.round(n * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  const levelBadge = (sk) => badge(`your level ${lv(sk)}${lv(sk) >= (cfg.eliteLevel || 51) ? ' · Elite' : ''}`, 'secondary');
  const card = (title, sk, body) => `<div class="card info-card" data-size="sm"><header><h2>${title}</h2><div class="card-action">${levelBadge(sk)}</div></header><section>${body}</section></div>`;
  const row = (label, now, was) => `<div class="ov-row"><span>${label}</span><span class="num"><b>${now}</b>${was != null ? ` <span class="auto">(base ${was})</span>` : ''}</span></div>`;
  const elite = (sk) => lv(sk) >= (cfg.eliteLevel || 51) ? (sk.elite || []).map((t) => `<div class="ov-row elite"><span>★ ${esc(t)}</span></div>`).join('') : '';
  const cards = [];

  const str = get('Strength');
  if (str) {
    const b = pct(str, /carry weight/i);
    const m = 1 + b / 100;
    cards.push(card('Strength', str, `
      <p class="auto">Carry weight bonus ${fmtNum(b)}% raises the weight limits below.</p>
      ${row('You become overweight at', kg(base.overweightStartKg * m), kg(base.overweightStartKg))}
      ${row('You can no longer sprint at', kg(base.sprintLimitKg * m), kg(base.sprintLimitKg))}
      ${row('Critically overweight at', kg(base.criticalOverweightKg * m), kg(base.criticalOverweightKg))}
      ${row('Sprint speed', `${fmtNum(pct(str, /sprint/i))}%`)}${row('Jump height', `${fmtNum(pct(str, /jump/i))}%`)}${row('Throw distance', `${fmtNum(pct(str, /throw/i))}%`)}
      ${elite(str)}`));
  }

  const met = get('Metabolism');
  if (met) {
    const food = 1 + pct(met, /from food/i) / 100;
    const drainMet = pct(met, /drain/i);
    const drainHealth = pct(get('Health'), /drain/i);
    const drain = 1 + (drainMet + drainHealth) / 100;
    cards.push(card('Metabolism', met, `
      ${row('Food and drinks restore', x(food), '×1')}
      ${row('Example: a 60-energy MRE gives', `${Math.round(60 * food)} energy`, '60')}
      ${row('Energy and hydration drain', x(drain), '×1')}
      <p class="auto">Drain includes Health (${fmtNum(drainHealth)}%) and Metabolism (${fmtNum(drainMet)}%).${drain < 1 ? ` Your energy lasts about ${Math.round((1 / drain - 1) * 100)}% longer.` : ''}</p>
      ${elite(met)}`));
  }

  const hm = get('HideoutManagement');
  if (hm) {
    const cons = 1 + pct(hm, /consumption/i) / 100;
    const bonus = 1 + pct(hm, /zone bonus/i) / 100;
    const fuelBonus = hideoutBonusTotals().find((b) => b.type === 'FuelConsumption');
    const zoneFuel = fuelBonus ? 1 + fuelBonus.boosted / 100 : 1;
    const perHour = (base.generatorFuelPerHour || 4.75) * cons * zoneFuel;
    cards.push(card('Hideout Management', hm, `
      ${row('Fuel and filter use', x(cons), '×1')}
      ${fuelBonus ? row(`Hideout fuel bonus (${esc(fuelBonus.from.join(', '))})`, `${fmtNum(fuelBonus.boosted)}%`) : ''}
      ${row('Generator burns', `${(Math.round(perHour * 100) / 100)} fuel/h`, `${base.generatorFuelPerHour || 4.75}/h`)}
      ${(base.fuelTanks || []).map((t) => row(`${esc(t.name)} (${t.resource}) lasts`, hrs(t.resource / perHour), hrs(t.resource / (base.generatorFuelPerHour || 4.75)))).join('')}
      ${row('Hideout zone bonuses', x(bonus), '×1')}
      <p class="auto">Example: a zone bonus of +10% becomes +${Math.round(10 * bonus * 10) / 10}%.</p>
      ${elite(hm)}`));
  }

  const cr = get('Crafting');
  if (cr) {
    const t = 1 + pct(cr, /production time/i) / 100;
    cards.push(card('Crafting', cr, `
      ${row('Craft time', x(t), '×1')}
      ${(base.craftExampleHours || [1, 8, 24]).map((h) => row(`A ${h} h craft takes`, hrs(h * t), hrs(h))).join('')}
      ${elite(cr)}`));
  }
  return `<div class="grid info-grid">${cards.join('')}</div>
    <p class="kv">Base values: ${esc(base.source || 'n/a')}${base.fuelTanksSource ? `; fuel tank sizes: ${esc(base.fuelTanksSource)}` : ''}. Per-level percentages come from the Skills data (marked "game config" where taken from the game; otherwise community wiki and approximate). Change your levels on the Skills tab.</p>`;
}

export default {
  render: renderBuffs,
  actions: {
    'buff-groups'(el, ctx) { setAllGroupsOpen(el.dataset.v === '1'); ctx.ui.render(); },
  },
  toggle(el) {
    if (skillOverviewToggle(el)) return true;
    const bo = el.dataset.buffopen;
    if (!bo) return false;
    S.ui.buffOpen[bo] = el.open;
    return true;
  },
};
