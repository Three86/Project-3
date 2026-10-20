// Skills: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc, fmtNum } from '../../core/util.js';
import { badge, btn, emptyState, icon, progressBar, select, spinner, toggleSwitch } from '../../ui/basecoat/components.js';
import { skillOverview, skillOverviewToggle } from '../../ui/basecoat/skills.js';
import { activeSkillConfig, effectValue, skillLevelOf, categories, skillList, setLevel, stepLevel, setCategory, focusSkill, ocr, loadOcrStatus, canRunOcr, runOcr, dismissOcr, levelCheckText, ocrEngineLabel } from './logic.js';

function renderSkills() {
  const cfg = activeSkillConfig();
  const f = S.ui.sk;
  const maxLevel = cfg.maxLevel || 51;
  const elite = cfg.eliteLevel || 51;
  const lv = skillLevelOf;
  if (!cfg.skills.length) return emptyState('No skill data available');
  const cats = categories();
  const list = skillList();

  const overview = skillOverview(cfg, lv);

  const toolbar = `<div class="toolbar">
    <input type="search" class="input tb-search wide" data-ui="sk.text" value="${esc(f.text)}" placeholder="Search skills, descriptions, effects…" aria-label="Search skills">
    <div role="group" class="button-group" aria-label="Category">${[['', 'All'], ...cats.map((c) => [c, c])].map(([v, t]) => btn(esc(t), `data-act="sk-cat" data-v="${esc(v)}" aria-pressed="${f.category === v}"`, { variant: f.category === v ? 'secondary' : 'outline', size: 'sm' })).join('')}</div>
    ${select('sk.sortBy', f.sortBy, [['category', 'Game order'], ['name', 'Name'], ['level', 'Your level']], 'Sort')}
    ${toggleSwitch('Only leveled', 'data-ui="sk.onlyLeveled"', f.onlyLeveled)}
    <span class="count">${list.length} skills</span>
  </div>`;
  const cards = list.map((sk) => {
    const l = lv(sk);
    return `<div class="card skill ${l >= elite ? 'st-completed' : l > 0 ? 'st-active' : ''}" data-size="sm">
      <header><h2>${esc(sk.name)}</h2><div class="card-action">${l >= elite ? badge('Elite', 'outline', 'kappa') : ''}${badge(esc(sk.category), 'secondary')}</div></header>
      <section>
      <div class="skill-level"><div role="group" class="button-group stepper">${btn(icon('minus'), `data-act="skill-step" data-id="${esc(sk.id)}" data-d="-1" aria-label="Level down"`, { variant: 'outline', size: 'icon-sm' })}
        <input type="number" class="input" min="0" max="${maxLevel}" value="${l}" data-act="skill-level" data-id="${esc(sk.id)}" aria-label="${esc(sk.name)} level">
        ${btn(icon('plus'), `data-act="skill-step" data-id="${esc(sk.id)}" data-d="1" aria-label="Level up"`, { variant: 'outline', size: 'icon-sm' })}</div><span class="auto">level ${l}/${maxLevel}</span></div>
      ${progressBar(l, maxLevel, `${sk.name} level`)}
      <div class="desc">${esc(sk.description)}</div>
      ${sk.levelUp ? `<div class="auto">Levels up by: ${esc(sk.levelUp)}</div>` : ''}
      <ul class="effects">${(sk.effects || []).map((e) => `<li><span>${esc(e.name)}</span><span class="num">${fmtNum(effectValue(sk, e, l))}${esc(e.unit || '')} <span class="auto">(${fmtNum(e.perLevel)}${esc(e.unit || '')}/lvl, max ${fmtNum(effectValue(sk, e, maxLevel))}${esc(e.unit || '')})</span></span></li>`).join('')}
        ${(sk.elite || []).map((x) => `<li class="${l >= elite ? '' : 'locked'}"><span>★ Elite: ${esc(x)}</span></li>`).join('')}</ul>
    </section></div>`;
  }).join('');
  // Wide screens: skill cards on the left, buff totals in a sticky sidebar. Narrow: totals on top.
  return ocrPanel() + toolbar + `<div class="skills-layout">
      <div class="skills-main"><div class="grid skills-grid">${cards || emptyState('No skills match', '', '', 'search')}</div></div>
      <aside class="skills-side">${overview}</aside>
    </div>
    <p class="kv">${esc(cfg.note || '')}</p>`;
}

// Screenshot OCR: button, folder status and the result of the last run.
// Screenshot OCR, in parts other views reuse: the status line, the result panel and the bar.
// Status text of the screenshot folder / engines ('' + spinner while checking).
export function ocrInfo() {
  const st = ocr.status;
  if (!st) { loadOcrStatus(); return 'Checking screenshot folder…'; }
  if (!st.tesseract && !st.ai) return 'No OCR engine installed. Both come with the Docker image.';
  if (!st.available) return `Screenshot folder not found (<code>${esc(st.dir)}</code>). Mount your Tarkov Screenshots folder, see README.`;
  if (!st.selected.length) return st.total ? 'Only in-raid screenshots found (those are skipped).' : 'No screenshots in the folder yet.';
  return `Will read ${st.selected.length} screenshot${st.selected.length === 1 ? '' : 's'} from <b>${esc(st.day)}</b>${st.inRaid ? ` · ${st.inRaid} in-raid skipped` : ''} · engine: ${esc(ocrEngineLabel(st))}`;
}

// Result of the last run (Basecoat alert), '' when there is none.
export function ocrResult() {
  const r = ocr.result;
  if (r?.error) return `<div class="alert ocr-result" data-variant="destructive">${icon('alert')}<h2>Reading screenshots failed</h2><section>${esc(r.error)}</section><footer>${btn(icon('x'), 'data-act="ocr-dismiss" aria-label="Dismiss"', { variant: 'ghost', size: 'icon-sm' })}</footer></div>`;
  if (!r) return '';
  const changed = new Map(r.changes.map((c) => [c.id, c]));
  const read = r.read || r.changes.map((c) => ({ id: c.id, name: c.name, level: c.to }));
  const changes = read.length
    ? read.map((x) => { const c = changed.get(x.id); const inf = x.inferred ? ' <span data-tooltip="Name unreadable; worked out from its position on the page">≈</span>' : ''; return c ? badge(`${esc(x.name)}${inf} ${c.from} → <b>${c.to}</b>`, 'outline', 'changed') : badge(`${esc(x.name)}${inf} ${x.level} ✓`); }).join(' ')
      + `<div class="auto">${r.changes.length ? `${r.changes.length} changed` : 'All already matched the tracker'} · ✓ = already the same${read.some((x) => x.inferred) ? ' · ≈ = name unreadable, worked out from its position on the page' : ''}.</div>`
    : '<span class="auto">No skill levels could be read from these screenshots. Are they of the skills page?</span>';
  const files = r.files.map((f) => `<div>${esc(f.name)}: ${f.error ? `<span class="bad">${esc(f.error)}</span>` : `${Object.keys(f.skills).length} skills${f.characterLevel ? `, PMC level ${f.characterLevel}` : ''}${f.levelCheck ? ` <span class="auto">(${levelCheckText(f.levelCheck)})</span>` : ''}${f.engines ? ` ${badge(esc(f.engines.map((e) => (e === 'ai' ? 'AI' : 'Tesseract')).join(' + ')), 'secondary')}` : ''}${f.unreadLevels ? ` <span class="auto">(${f.unreadLevels} level${f.unreadLevels === 1 ? '' : 's'} without a readable name)</span>` : ''}`}</div>`).join('');
  return `<div class="alert ocr-result">${icon('camera')}<h2><b>${r.found}</b> skills read from ${r.files.length} screenshot${r.files.length === 1 ? '' : 's'} (${esc(r.day)}).${r.playerLevel ? ` PMC level ${r.playerLevel.from} → <b>${r.playerLevel.to}</b>.` : ''}</h2>
    <section>${r.aiError ? `<p class="warn">AI OCR failed to start (${esc(r.aiError)}); Tesseract was used.</p>` : ''}<div class="ocr-changes">${changes}</div>
    <section class="accordion"><details><summary>Screenshots${icon('chevron')}</summary><section><div class="sources">${files}</div></section></details></section></section>
    <footer>${btn(icon('x'), 'data-act="ocr-dismiss" aria-label="Dismiss"', { variant: 'ghost', size: 'icon-sm', tip: 'Dismiss', side: 'left' })}</footer></div>`;
}

// Bar with the "Read levels from screenshots" button and status, followed by the last result.
function ocrPanel() {
  const info = ocrInfo();
  return `<div class="card ocr-bar" data-size="sm"><section>${btn(ocr.running ? `${spinner()} Reading screenshots…` : `${icon('camera')} Read levels from screenshots`, 'data-act="ocr-run"', { variant: 'primary', disabled: !canRunOcr() })}
    <span class="auto">${ocr.status ? info : `${spinner()} ${info}`}</span></section></div>${ocrResult()}`;
}

// Click handlers shared with other skills views (screenshot reading).
export const ocrActions = {
  async 'ocr-run'(el, ctx) {
    if (ctx.S.ui.tab !== 'skills') ctx.ui.setTab('skills');
    const r = await runOcr();
    if (r?.error) ctx.ui.toast('error', 'Reading screenshots failed', r.error);
    else if (r) ctx.ui.toast('success', `OCR: ${r.changes?.length || 0} skill${r.changes?.length === 1 ? '' : 's'} updated`, `${r.found} read from ${r.files?.length || 0} screenshot${r.files?.length === 1 ? '' : 's'}${r.playerLevel ? ` · PMC level ${r.playerLevel.to}` : ''}`);
  },
  'ocr-dismiss'() { dismissOcr(); },
};

export default {
  render: renderSkills,
  actions: {
    'skill-step'(el) { stepLevel(el.dataset.id, el.dataset.d); },
    'sk-cat'(el, ctx) { setCategory(el.dataset.v); ctx.ui.render(); },
    ...ocrActions,
  },
  changes: {
    'skill-level'(el) { setLevel(el.dataset.id, el.value); },
  },
  toggle: (el) => skillOverviewToggle(el),
  // Links from other sections: { id } = skill name.
  goto({ id }) { focusSkill(id); },
  commands() {
    return [
      { group: 'Actions', label: 'Read levels from screenshots (OCR)', attrs: 'data-act="ocr-run"', keywords: 'ocr skills screenshot', icon: 'camera' },
      ...activeSkillConfig().skills.map((sk) => ({ group: 'Skills', label: sk.name, attrs: `data-act="goto-skill" data-id="${esc(sk.name)}"`, keywords: `skill ${sk.category}`, hint: `lvl ${skillLevelOf(sk)}` })),
    ];
  },
};
