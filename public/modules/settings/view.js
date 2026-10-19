// Settings: default (Basecoat) view.
import { S } from '../../core/store.js';
import { esc, toLocalInput } from '../../core/util.js';
import { idx } from '../../core/game.js';
import { badge, btn, icon, spinner, toggleSwitch } from '../../ui/basecoat/components.js';
import { interfaces, setInterface, rescanLogs, exportProgress, importFile, freshStart, resetAll, refreshData } from './logic.js';

function renderSettings(ctx) {
  const s = S.progress?.settings || {};
  const st = S.status || {};
  const logs = st.logs || {};
  const meta = st.dataMeta || {};
  const sel = (key, value, options) => `<select class="select" id="set-${key}" data-set="${key}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const field = (id, label, control, desc = '') => `<div role="group" class="field"><label class="label" for="${id}">${label}</label>${control}${desc ? `<p>${desc}</p>` : ''}</div>`;
  const theme = ctx.ui.theme?.get() || 'dark';
  const guis = interfaces();
  return `<div class="settings">
    <div class="card" data-size="sm"><header><h2>Character</h2><p>Changing game mode re-downloads the matching quest data.</p></header>
      <section class="field-row">
        ${field('set-playerLevel', 'PMC level', `<input class="input" id="set-playerLevel" type="number" min="1" max="79" data-set="playerLevel" value="${s.playerLevel || 1}">`)}
        ${field('set-faction', 'Faction', sel('faction', s.faction, [['USEC', 'USEC'], ['BEAR', 'BEAR']]))}
        ${field('set-gameMode', 'Game mode', sel('gameMode', s.gameMode, [['regular', 'PvP'], ['pve', 'PvE']]))}
      </section>
      <section>${toggleSwitch('Manual loyalty levels', 'data-set="loyaltyManual" id="set-loyaltyManual"', !!s.loyaltyManual)}
        <p class="kv">Trader loyalty is worked out from your level and quest reputation (money spent is not tracked). Turn this on to set a trader's level by hand where the interface offers it.</p></section>
    </div>
    <div class="card" data-size="sm"><header><h2>Appearance</h2><p>Dark is the default. Also toggled with the moon/sun button in the top bar. The interface decides the layout and which sections are shown.</p></header>
      <section class="field-row">${field('set-theme', 'Theme', `<select class="select" id="set-theme" data-act="theme-select">${[['dark', 'Dark'], ['light', 'Light']].map(([v, t]) => `<option value="${v}" ${theme === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
        ${field('set-gui', 'Interface', `<select class="select" id="set-gui" data-act="gui-select">${guis.list.map((g) => `<option value="${esc(g.id)}" ${g.id === guis.current ? 'selected' : ''}>${esc(g.title || g.id)}</option>`).join('')}</select>`, `${esc(guis.list.find((g) => g.id === guis.current)?.description || '')} Remembered for this browser only.`)}</section>
    </div>
    <div class="card" data-size="sm"><header><h2>Game data</h2><p>Source: <code>${esc(meta.source || '–')}</code> · fetched <code>${esc(meta.fetchedAt || 'never')}</code> · mode <code>${esc(meta.gameMode || '–')}</code></p></header>
      ${st.refreshError ? `<section><div class="alert" data-variant="destructive">${icon('alert')}<h2>Last refresh failed</h2><section>${esc(st.refreshError)}</section></div></section>` : ''}
      <footer class="actions">${btn(st.refreshing ? `${spinner()} Refreshing…` : `${icon('refresh')} Refresh from tarkov.dev`, 'data-act="refresh"', { variant: 'outline', disabled: !!st.refreshing })}
        <label class="btn" data-variant="outline">${icon('upload')} Import data file…<input type="file" accept=".json" data-act="import-data" hidden></label></footer>
    </div>
    <div class="card" data-size="sm"><header><h2>Game log detection</h2>
        <p>Folder: <code>${esc(logs.dir || '–')}</code> — ${logs.available ? `<span class="good">found</span>, ${logs.files} notification log files, ${logs.events} quest events read, last scan ${esc(logs.lastScan || '–')}` : '<span class="warn">not found</span>. Mount your EFT Logs folder (see README) to detect quest starts/completions automatically.'}</p>
        <div class="card-action">${badge(logs.available ? 'Connected' : 'Not found', 'outline', logs.available ? 'status-completed' : 'status-failed')}</div></header>
      <section class="stack">
        <div class="field-row">${field('set-logsSince', 'Count game logs from', `<input class="input" id="set-logsSince" type="datetime-local" data-set="logsSince" value="${esc(toLocalInput(s.logsSince))}">`, 'Quest events logged before this moment are ignored (the game keeps logs from every wipe, reset and prestige). Changing it re-reads all logs.')}
          <div class="field-btn">${btn('New start from now…', 'data-act="fresh-start"', { variant: 'destructive', tip: 'After a wipe, profile reset or prestige' })}</div></div>
        ${toggleSwitch('Update quest status from game logs', 'data-set="autoLogs"', s.autoLogs !== false)}
        ${(logs.lastEvents || []).length ? `<p class="kv">Recent: ${logs.lastEvents.slice(0, 8).map((e) => `${esc(idx.tasks.get(e.taskId)?.name || e.taskId)} → ${esc(e.status)}`).join(' · ')}</p>` : ''}
      </section>
      <footer class="actions">${btn(`${icon('refresh')} Re-read all logs`, 'data-act="rescan"', { variant: 'outline' })}</footer>
    </div>
    <div class="card" data-size="sm"><header><h2>Screenshot reading (OCR)</h2></header>
      <section>${field('set-ocrEngine', 'Engine', sel('ocrEngine', s.ocrEngine || 'auto', [['auto', 'Auto: AI, Tesseract as backup (recommended)'], ['ai', 'AI only'], ['tesseract', 'Tesseract only']]),
        'The AI engine (PaddleOCR models, runs on the CPU, no graphics card needed) reads Tarkov\'s font more reliably; Tesseract is the older engine and joins in when the AI read looks incomplete.')}</section>
    </div>
    <div class="card" data-size="sm"><header><h2>Progress</h2><p>Export a backup before resetting or importing.</p></header>
      <footer class="actions">${btn(`${icon('download')} Export progress`, 'data-act="export"', { variant: 'outline' })}
        <label class="btn" data-variant="outline">${icon('upload')} Import progress…<input type="file" accept=".json" data-act="import-progress" hidden></label>
        ${btn(`${icon('trash')} Reset all progress`, 'data-act="reset"', { variant: 'destructive' })}</footer>
    </div>
  </div>`;
}

export default {
  render: renderSettings,
  live: true, // log folder status and data refresh state change on every poll
  actions: {
    refresh() { refreshData(); },
    async rescan(el, ctx) {
      try { await rescanLogs(); ctx.ui.toast('success', 'Game logs re-read'); } catch (err) { ctx.ui.toast('error', 'Could not re-read logs', err.message); }
    },
    export(el, ctx) {
      const { filename, json } = exportProgress();
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: filename });
      a.click();
      URL.revokeObjectURL(a.href);
      ctx.ui.toast('success', 'Progress exported', filename);
    },
    async 'fresh-start'(el, ctx) {
      if (!(await ctx.ui.confirm('Start fresh from now?', 'For after a wipe, profile reset or prestige. This clears quest, objective and hideout progress, sets your level to 1 and ignores all game logs from before now. Prestige checklists and settings are kept. Export first if unsure.', 'Start fresh', true))) return;
      await freshStart();
      ctx.ui.toast('success', 'Fresh start', 'Progress cleared; game logs before now are ignored.');
    },
    async reset(el, ctx) {
      if (!(await ctx.ui.confirm('Reset ALL progress?', 'This clears every quest, hideout and prestige mark. Export first if unsure.', 'Reset everything', true))) return;
      await resetAll();
      ctx.ui.toast('success', 'All progress reset');
    },
  },
  changes: {
    'theme-select'(el, ctx) { ctx.ui.theme?.set(el.value); },
    'gui-select'(el) { setInterface(el.value); },
    'import-data': (el, ctx) => importChosen(el, ctx, 'data'),
    'import-progress': (el, ctx) => importChosen(el, ctx, 'progress'),
  },
  commands() {
    return [
      { group: 'Actions', label: 'Refresh game data', attrs: 'data-act="refresh"', keywords: 'download update tarkov.dev', icon: 'refresh' },
      { group: 'Actions', label: 'Re-read game logs', attrs: 'data-act="rescan"', keywords: 'logs rescan', icon: 'refresh' },
      { group: 'Actions', label: 'Export progress', attrs: 'data-act="export"', keywords: 'backup save', icon: 'download' },
    ];
  },
};

async function importChosen(el, ctx, kind) {
  const file = el.files[0];
  if (!file) return;
  try {
    await importFile(kind, await file.text());
    ctx.ui.toast('success', kind === 'data' ? 'Game data imported' : 'Progress imported', file.name);
  } catch (err) { ctx.ui.toast('error', 'Import failed', err.message); }
  el.value = '';
}
