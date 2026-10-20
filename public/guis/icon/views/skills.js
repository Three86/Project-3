// Icon GUI skills, styled like the game's Character > Skills screen: two columns of skill rows (icon
// with the level in its corner, category letter, name, long bar, "Level: N" with − / +), and an info
// panel like the game's skill tooltip (description, effects now / per level / at max, elite perks).
// Levels change through the skills module (− / +, typed level, screenshot reading).
import { S } from '../../../core/store.js';
import { esc } from '../../../core/util.js';
import { icon, spinner } from '../../../ui/basecoat/components.js';
import { ocrActions, ocrInfo, ocrResult } from '../../../modules/skills/view.js';
import { activeSkillConfig, categories, skillList, skillLevelOf, maxLevel, eliteLevel, setLevel, stepLevel, setCategory, skillImage, effectRows, selectSkill, selectedSkill, findSkillByName, ocr, canRunOcr } from '../../../modules/skills/logic.js';

const LETTER = { Physical: 'P', Mental: 'M', Combat: 'C', Practical: 'R' };
const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const signed = (n) => `${n > 0 ? '+' : ''}${(Math.round(n * 100) / 100).toFixed(2)}`;
const pic = (sk) => `<span class="initials">${esc(initials(sk.name))}</span><img src="${esc(skillImage(sk))}" alt="" loading="lazy" onerror="this.remove()">`;
const catBadge = (c) => `<span class="ig-cat cat-${esc(c)}" title="${esc(c)}">${LETTER[c] || esc(String(c)[0])}</span>`;

function row(sk, selected) {
  const l = skillLevelOf(sk);
  const max = maxLevel();
  const elite = l >= eliteLevel();
  return `<div class="ig-row${elite ? ' elite' : ''}${l ? '' : ' zero'}" role="button" tabindex="0" data-act="sk-select" data-id="${esc(sk.id)}" aria-pressed="${selected}">
    <span class="ig-icon">${pic(sk)}<span class="ig-lv">${l}</span></span>
    <span class="ig-main">
      <span class="ig-name">${catBadge(sk.category)}<span>${esc(sk.name)}</span></span>
      <span class="ig-bar" aria-hidden="true"><span style="width:calc(${Math.round((l / max) * 1000) / 10}% - 2px)"></span></span>
      <span class="ig-meta">Level: ${l}
        <button type="button" class="ig-step" data-act="skill-step" data-id="${esc(sk.id)}" data-d="-1" aria-label="${esc(sk.name)} level down" ${l <= 0 ? 'disabled' : ''}>−</button><button type="button" class="ig-step" data-act="skill-step" data-id="${esc(sk.id)}" data-d="1" aria-label="${esc(sk.name)} level up" ${l >= max ? 'disabled' : ''}>+</button>
        <span class="ig-of">${elite ? '<span class="ig-elite-tag">ELITE</span>' : `${l}<small>/${max}</small>`}</span></span>
    </span>
  </div>`;
}

function info(sk) {
  const l = skillLevelOf(sk);
  const max = maxLevel();
  const elite = eliteLevel();
  const fx = effectRows(sk, l);
  return `<div class="ig-info" aria-label="${esc(sk.name)}">
    <div class="ig-info-head"><span class="ig-icon">${pic(sk)}</span>
      <div><h3>${catBadge(sk.category)}${esc(sk.name)}</h3><span class="ig-sub">${esc(sk.category)} skill</span></div></div>
    <div class="ig-lvbox">Level <button type="button" class="ig-step" data-act="skill-step" data-id="${esc(sk.id)}" data-d="-1" aria-label="Level down" ${l <= 0 ? 'disabled' : ''}>−</button><input type="number" min="0" max="${max}" value="${l}" data-act="skill-level" data-id="${esc(sk.id)}" aria-label="${esc(sk.name)} level"><button type="button" class="ig-step" data-act="skill-step" data-id="${esc(sk.id)}" data-d="1" aria-label="Level up" ${l >= max ? 'disabled' : ''}>+</button><span class="ig-note">of ${max}${l < elite ? ` · elite at ${elite}` : ''}</span></div>
    <p>${esc(sk.description)}</p>
    ${sk.levelUp ? `<p class="ig-up">Levels up by: ${esc(sk.levelUp)}</p>` : ''}
    ${fx.length ? `<div class="ig-fx">${fx.map((e) => `<div><span>${esc(e.name)}</span><span><b class="${e.now ? '' : 'zero'}">${signed(e.now)}${esc(e.unit)}</b><small>${signed(e.perLevel)}/lvl · max ${signed(e.max)}${esc(e.unit)}</small></span></div>`).join('')}</div>` : ''}
    ${(sk.elite || []).length ? `<div class="ig-elite">${sk.elite.map((x) => `<div class="${l >= elite ? '' : 'locked'}">${icon(l >= elite ? 'star' : 'lock')}<span>Elite: ${esc(x)}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

function render() {
  const cfg = activeSkillConfig();
  if (!cfg.skills.length) return '<div class="ig"><p class="ig-note">No skill data available.</p></div>';
  const f = S.ui.sk;
  const list = skillList();
  const cur = selectedSkill(list);
  const cats = categories();
  let rows = '';
  // All + game order: grouped under category headings, like the game.
  if (!f.category && f.sortBy === 'category') {
    for (const c of cats) {
      const g = list.filter((sk) => sk.category === c);
      if (g.length) rows += `<div class="ig-head">${esc(c)}</div>${g.map((sk) => row(sk, sk === cur)).join('')}`;
    }
  } else rows = list.map((sk) => row(sk, sk === cur)).join('');
  const leveled = cfg.skills.filter((sk) => skillLevelOf(sk) > 0).length;
  const sorts = [['category', 'Game order'], ['name', 'Name'], ['level', 'Your level']];
  return `<div class="ig">
    <div class="ig-top">
      <div class="ig-tabs" role="group" aria-label="Category">${[['', 'All'], ...cats.map((c) => [c, c])].map(([v, t]) => `<button type="button" class="ig-tab" data-act="sk-cat" data-v="${esc(v)}" aria-pressed="${f.category === v}">${esc(t)}</button>`).join('')}</div>
      <select class="ig-sel" data-ui="sk.sortBy" aria-label="Sort">${sorts.map(([v, t]) => `<option value="${v}" ${f.sortBy === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="ig-check"><input type="checkbox" data-ui="sk.onlyLeveled" ${f.onlyLeveled ? 'checked' : ''}>Only leveled</label>
      <button type="button" class="ig-btn" data-act="ocr-run" ${canRunOcr() ? '' : 'disabled'}>${ocr.running ? `${spinner()} Reading screenshots…` : `${icon('camera')} Read levels from screenshots`}</button>
      <span class="ig-count">${list.length} skills · ${leveled} leveled</span>
      <span class="ig-ocr-info">${ocrInfo()}</span>
    </div>
    ${ocrResult()}
    <div class="ig-layout">
      <div class="ig-list" role="group" aria-label="Skills">${rows || '<p class="ig-note">No skills match.</p>'}</div>
      <aside class="ig-aside">${info(cur)}</aside>
    </div></div>`;
}

// Rows are role="button" divs (they contain buttons); let Enter / Space open them.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    const r = e.target?.closest?.('.ig-row[data-act="sk-select"]');
    if (r && e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); }
  });
}

export default {
  render,
  actions: {
    ...ocrActions,
    'sk-select'(el, ctx) { selectSkill(el.dataset.id); ctx.ui.render(); },
    'skill-step'(el) { selectSkill(el.dataset.id); stepLevel(el.dataset.id, el.dataset.d); },
    'sk-cat'(el, ctx) { setCategory(el.dataset.v); ctx.ui.render(); },
  },
  changes: {
    'skill-level'(el) { setLevel(el.dataset.id, el.value); },
  },
  // Links from other sections (search, command palette): { id } = skill name.
  goto({ id }) {
    const sk = findSkillByName(id);
    if (!sk) return null;
    S.ui.sk = { ...S.ui.sk, category: '', onlyLeveled: false };
    selectSkill(sk.id);
    return () => document.querySelector(`.ig-row[data-id="${CSS.escape(sk.id)}"]`)?.scrollIntoView({ block: 'center' });
  },
};
