// Overview: default (Basecoat) view. The tracker opens here.
import { esc, fmtDuration, fmtDurationSec } from '../../core/util.js';
import { badge, emptyState, icon } from '../../ui/basecoat/components.js';
import { endurance, goals, hideoutResources, metabolism, pmc, strength } from './logic.js';

const kg = (n) => `${n.toFixed(1)} kg`;
const sec = (n) => `${n.toFixed(1)} s`;
const mins = (m) => (m >= 60 ? fmtDuration(m * 60) : `${Math.round(m)} min`);
const signed = (p) => `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const lv = (name, n) => badge(`${name} ${n}`, 'secondary');
const skillCard = (key, title, ic, levels, body) => `<div class="card ovw-skill" data-size="sm" data-skill="${key}">
  <header><span class="sk-ico">${icon(ic)}</span><h2>${title}</h2><span class="sk-lv">${levels}</span></header><section>${body}</section></div>`;

function pmcCard() {
  const p = pmc();
  // The tracker's copy of a picture you put in data/images/pmc/ wins; otherwise the bundled one.
  return `<div class="card ovw-pmc" data-faction="${p.faction}">
    <div class="art"><img src="${esc(p.image)}" alt="${p.faction} operator" onerror="this.onerror=null;this.src='${esc(p.fallback)}'"></div>
    <div class="who"><span class="faction">${p.faction}</span>
      <span class="lvl"><b>${p.level}</b><span>PMC level</span></span>
      <span class="hint">Faction and level are set under <a href="#" data-act="goto-settings" data-module="settings">Settings → Character</a>.</span></div>
  </div>`;
}

function goalsCard() {
  const g = goals();
  if (!g) return `<div class="card ovw-goals">${emptyState('No quest data yet', 'Kappa and Lightkeeper progress appear once game data is downloaded.', '', 'database')}</div>`;
  const row = ({ key, title, done, active, total }) => {
    // tarkov.dev hasn't flagged any quest for this goal (Lightkeeper often has none): say so instead of 0%.
    if (!total) return `<div class="goal" data-goal="${key}"><div class="goal-head"><h3>${icon(key === 'kappa' ? 'star' : 'sun')} ${title}</h3><span class="pct">–</span></div>
      <p class="auto">The game data marks no quests as needed for ${title} yet, so there's nothing to count.</p></div>`;
    const p = total ? Math.round((done / total) * 100) : 0;
    const w = (n) => (total ? (n / total) * 100 : 0);
    return `<div class="goal" data-goal="${key}"><div class="goal-head"><h3>${icon(key === 'kappa' ? 'star' : 'sun')} ${title}</h3><span class="pct">${p}%</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="${title} progress"><span class="done" style="width:${w(done)}%"></span><span class="act" style="width:${w(active)}%"></span></div>
      <div class="meta"><span><i class="sw done"></i><b>${done}</b> of <b>${total}</b> quests completed</span><span><i class="sw act"></i><b>${active}</b> active</span><span><b>${total - done}</b> to go</span></div></div>`;
  };
  return `<div class="card ovw-goals">${g.map(row).join('')}<p class="ovw-note">Counts the quests marked as needed for Kappa / Lightkeeper in the game data, for your faction.</p></div>`;
}

function strengthCard() {
  const s = strength();
  return skillCard('strength', 'Strength', 'dumbbell', lv('Strength', s.level), `
    ${stat('Overweight from', kg(s.overweight.now), `base ${kg(s.overweight.base)} · carry weight +${s.carryPct.toFixed(1)}%`)}
    ${stat('Heaviest you can sprint with', kg(s.sprint.now), `base ${kg(s.sprint.base)} · no sprinting above this`)}
    ${stat('Critically overweight from', kg(s.critical.now), `base ${kg(s.critical.base)}`)}`);
}

function enduranceCard() {
  const e = endurance();
  return skillCard('endurance', 'Endurance', 'run', lv('Endurance', e.level), `
    ${stat('Sprint from full stamina', sec(e.sprint.now), `base ${sec(e.sprint.base)} · not overweight · ${Math.round(e.capacity)} stamina (+${e.staminaPct.toFixed(0)}%)`)}
    ${stat('Stamina refills from empty in', sec(e.refill.now), `standing still · base ${sec(e.refill.base)} · more stamina takes longer to fill; crouching is faster`)}`);
}

function metabolismCard() {
  const m = metabolism();
  const drain = (label, d) => stat(label, `−${d.perMin.toFixed(2)}/min`, `full (${d.max}) to empty in ${mins(d.minutes)} · base −${d.basePerMin}/min, ${mins(d.baseMinutes)}`);
  return skillCard('metabolism', 'Metabolism', 'food', lv('Metabolism', m.level) + lv('Health', m.health), `
    ${stat('An item with 50 energy gives', `${Math.round(m.item50)} energy`, `${signed(m.gainPct)} from Metabolism`)}
    ${stat('An item with 50 hydration gives', `${Math.round(m.item50)} hydration`, `${signed(m.gainPct)} from Metabolism`)}
    <div class="stat-sub">Drain in raid</div>
    ${drain('Energy', m.energy)}${drain('Hydration', m.hydration)}
    <p class="ovw-note">Drain is lowered by Health (energy ${signed(m.energy.pct)}, hydration ${signed(m.hydration.pct)}); Metabolism doesn't change it.</p>`);
}

function hideoutCard() {
  const h = hideoutResources();
  const hrs = (x) => fmtDuration(x * 3600);
  const { fuel, water: w, bitcoin: btc } = h;
  const mods = fuel.modules.map((m) => `${esc(m.name)} ${signed(m.pct)}${fuel.boostPct ? ` (${signed(m.boosted)} with Hideout Management)` : ''}`);
  if (fuel.hmFuelPct) mods.push(`Hideout Management ${signed(fuel.hmFuelPct)}`);
  const notes = [`Generator burns ${fuel.perHour.toFixed(2)} fuel/h${mods.length ? `: ${mods.join(', ')}` : ''}`, `filters use ${signed(fuel.hmPct)} from Hideout Management`];
  const collector = w.collectorBuilt == null || w.collectorBuilt >= w.collectorLevel ? '' : ` (yours is level ${w.collectorBuilt})`;
  const farm = btc
    ? `${stat('1 bitcoin every', fmtDurationSec(btc.secs), `${btc.gpus} graphics card${btc.gpus === 1 ? '' : 's'} · level ${btc.level} holds ${btc.maxGpus} · set on the Recipes tab`)}
      ${btc.tanks.map((t) => stat(`Per ${esc(t.name)} (${t.resource})`, `${t.bitcoins.toFixed(2)} bitcoins`)).join('')}`
    : '<p class="ovw-note">Not built yet.</p>';
  return skillCard('hideout', 'Hideout', 'home', lv('Crafting', h.crafting) + lv('Hideout Mgmt', h.hm), `
    ${h.tanks.map((t) => stat(`${esc(t.name)} (${t.resource}) lasts`, hrs(t.hours))).join('')}
    <div class="stat-sub">Purified water</div>
    ${stat('Time per canister', fmtDuration(w.seconds), `Crafting ${signed(w.craftPct)} · needs Water Collector level ${w.collectorLevel}${collector}`)}
    ${w.filters.map((f) => stat(`${esc(f.name)} (${f.resource})`, `${f.canisters.toFixed(2)} canisters`)).join('')}
    <div class="stat-sub">Bitcoin Farm</div>
    ${farm}
    <p class="ovw-note">${notes.join('; ')}. A canister uses ${w.perCanister.toFixed(1)} of a filter. The fuel formula is fitted to in-game readings (within about 0.5%).</p>`);
}

function render() {
  return `<div class="ovw">
    <div class="ovw-top">${pmcCard()}${goalsCard()}</div>
    <div class="ovw-skills">${strengthCard()}${enduranceCard()}${metabolismCard()}${hideoutCard()}</div>
    <p class="kv">Skill levels come from the Skills tab. Game values: stamina, drain and hideout rates from the game config (as mirrored by the SPT project); filter sizes from the community wiki.</p>
  </div>`;
}

export default { render };
