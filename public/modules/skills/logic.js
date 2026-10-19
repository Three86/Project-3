// Skills: the skill list with filters, setting levels, and reading levels from screenshots (OCR).
import { S, api, on, emit, setProgress, saveUi, poll } from '../../core/store.js';
import { norm, uniq, byName } from '../../core/util.js';
import { activeSkillConfig, effectValue } from '../../core/game.js';

export { activeSkillConfig, effectValue };

export const uiDefaults = {
  sk: { text: '', category: '', sortBy: 'category', onlyLeveled: false, view: 'skills' },
  skillOverviewOpen: true,
};

export const skillLevelOf = (sk) => Number(S.progress.skills[sk.id] || 0);
export const maxLevel = () => activeSkillConfig().maxLevel || 51;
export const eliteLevel = () => activeSkillConfig().eliteLevel || 51;
export const categories = () => uniq(activeSkillConfig().skills.map((sk) => sk.category));

// Skills to list with the current search / category / only-leveled filters and sort order.
export function skillList() {
  const cfg = activeSkillConfig();
  const f = S.ui.sk;
  const lv = skillLevelOf;
  const text = norm(f.text);
  const list = cfg.skills.filter((sk) =>
    (!f.category || sk.category === f.category) &&
    (!f.onlyLeveled || lv(sk) > 0) &&
    (!text || [sk.name, sk.description, sk.levelUp, ...(sk.effects || []).map((e) => e.name), ...(sk.elite || [])].some((x) => norm(x).includes(text))));
  const order = new Map(cfg.skills.map((sk, i) => [sk.id, i]));
  // 'category' keeps its saved-setting name but means the in-game order (which is grouped by category).
  const sorters = { category: (a, b) => order.get(a.id) - order.get(b.id), name: (a, b) => byName(a.name, b.name), level: (a, b) => lv(b) - lv(a) || byName(a.name, b.name) };
  return list.slice().sort(sorters[f.sortBy] || sorters.category);
}

export function setLevel(id, level) {
  const v = Math.max(0, Math.min(maxLevel(), Math.round(Number(level) || 0)));
  return setProgress({ section: 'skills', id, value: v || null });
}
export const stepLevel = (id, d) => setLevel(id, Number(S.progress.skills[id] || 0) + Number(d));

export function setCategory(category) { S.ui.sk.category = category; saveUi(); }

// Show one skill: search for its name with the other filters cleared.
export function focusSkill(name) {
  S.ui.sk = { ...S.ui.sk, text: name, category: '', onlyLeveled: false, view: 'skills' };
  saveUi();
}

// ---------------------------------------------------------------- screenshot OCR
// status: /api/ocr/status (folder, engines, screenshots it would read); result: last run; running.
export const ocr = { status: null, result: null, running: false };

let statusLoading = false;
export async function loadOcrStatus() {
  if (statusLoading) return;
  statusLoading = true;
  try { ocr.status = (await api('/api/ocr/status')).body; } catch { ocr.status = { tesseract: false, available: false, selected: [] }; }
  statusLoading = false;
  emit('change');
}
// The engine setting changes what the status reports.
on('setting', ({ key }) => { if (key === 'ocrEngine') ocr.status = null; });

export const canRunOcr = () => !ocr.running && !!ocr.status?.selected?.length && !!(ocr.status.tesseract || ocr.status.ai);

// Read the newest screenshots; the server updates skill and PMC levels. Returns the result.
export async function runOcr() {
  ocr.running = true;
  emit('change');
  try {
    const res = await fetch('/api/ocr/run', { method: 'POST' });
    ocr.result = await res.json();
  } catch (err) { ocr.result = { error: err.message }; }
  ocr.running = false;
  ocr.status = null;
  await poll(true);
  emit('change');
  return ocr.result;
}
export function dismissOcr() { ocr.result = null; emit('change'); }

// "3 of 3 checks agree: big number 17, next level 18 − 1, XP 312 146 → 17"
export function levelCheckText(c) {
  const parts = [];
  if (c.number != null) parts.push(`number ${c.number}`);
  if (c.nextLevel != null) parts.push(`next level ${c.nextLevel + 1} − 1`);
  if (c.xp != null) parts.push(`XP ${Number(c.xpValue).toLocaleString()} → ${c.xp}`);
  else if (c.xpValue != null) parts.push(`XP ${Number(c.xpValue).toLocaleString()} ${c.xpTableMissing ? '(no XP table yet)' : c.xpTableMismatch ? '(XP table does not match this game version)' : ''}`);
  const head = c.agree ? `${c.agree} of ${c.of} checks agree` : 'checks disagree, level not changed';
  return `${head}: ${parts.join(', ')}`;
}

// What will actually run, given the setting and what is installed.
export function ocrEngineLabel(st) {
  const want = st.engine || 'auto';
  if (want === 'tesseract') return st.tesseract ? 'Tesseract' : 'Tesseract (not installed)';
  if (want === 'ai') return st.ai ? 'AI' : 'AI (not installed)';
  return st.ai ? (st.tesseract ? 'AI, Tesseract as backup' : 'AI') : 'Tesseract (AI not installed)';
}
