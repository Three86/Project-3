// Reusable GUI frame built from Basecoat: top bar with one tab per module, global search, theme toggle,
// Ctrl+K command palette, toasts, confirm dialog and message banner. It renders the active module's view
// into #view and routes events to it. GUIs call startShell() from their shell.js with their options.
//
// A module view (default export of modules/<id>/view.js or a GUI override) may provide:
//   render(ctx)              → HTML of the section (required)
//   actions  { act: fn }     click on an element with data-act="act"      fn(el, ctx, event)
//   changes  { act: fn }     change on an input with data-act="act"
//   submits  { act: fn }     submit of a form with data-act="act"
//   toggle(el, ctx)          a <details> in the section was opened/closed; return true if handled
//   goto(args, ctx)          another section links here (args from the link's data-*); may return a
//                            function that runs after the redraw (e.g. scroll into view)
//   commands(ctx)            entries for the command palette: [{ group, label, attrs, keywords, hint, icon }]
//   live: true               redraw on every status poll (e.g. settings showing log-folder status)
// Generic attributes handled here for every view:
//   data-ui="path"           input/select/checkbox bound to UI state (filters etc.); redraws
//   data-set="key"           input bound to a Settings value (saved to progress.json)
//   data-act="goto…" data-module="id" data-id="…"   link to another section
import { S, on, start as startStore, initUi, saveUi, setUi, setSetting, refreshData } from '../../core/store.js';
import { esc } from '../../core/util.js';
import { guiInfo } from '../../core/gui.js';
import { btn, emptyState, icon, resetIds, spinner } from './components.js';

const $ = (sel) => document.querySelector(sel);

export async function startShell({ gui, modules, brand = 'TARKOV<span>TRACKER</span>', palette = true, uiKey = gui.id === 'basecoat' ? 'tt-ui' : `tt-ui:${gui.id}`, className = '' }) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const hasSearch = byId.has('search');

  // UI state: the shell's own keys plus every module's defaults (logic.js uiDefaults).
  const defaults = { tab: modules[0]?.id };
  for (const m of modules) Object.assign(defaults, m.logic.uiDefaults || {});
  initUi(uiKey, defaults);
  if (!byId.has(S.ui.tab)) S.ui.tab = modules[0]?.id;

  document.body.className = className;
  document.body.innerHTML = `
  <header class="topbar">
    <div class="brand">${brand}</div>
    <div class="tabs app-tabs">
      <nav role="tablist" aria-orientation="horizontal" data-variant="line" id="tabs" aria-label="Sections">
        ${modules.map((m) => `<button type="button" role="tab" id="tab-${esc(m.id)}" data-tab="${esc(m.id)}" aria-controls="view" aria-selected="${m.id === S.ui.tab}" tabindex="${m.id === S.ui.tab ? 0 : -1}">${esc(m.title || m.id)}</button>`).join('')}
      </nav>
    </div>
    ${hasSearch ? `<div class="input-group global-search">
      <input id="globalSearch" type="search" placeholder="Search quests &amp; items…" autocomplete="off" aria-label="Search quests and items">
      <span data-align="start" aria-hidden="true">${icon('search')}</span>
      ${palette ? `<span data-align="end"><button type="button" class="btn" data-variant="ghost" data-size="xs" data-act="palette" aria-label="Open command palette" data-tooltip="Command palette" data-side="bottom" data-align="end"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd></button></span>` : ''}
    </div>` : ''}
    <button type="button" class="btn theme-toggle" data-variant="outline" data-size="icon" data-act="theme" aria-label="Toggle dark mode" data-tooltip="Toggle dark mode" data-side="bottom" data-align="end">
      <svg class="lucide icon-moon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      ${icon('sun', 'icon-sun')}
    </button>
  </header>
  <div id="banner" class="banner hidden"></div>
  <main id="view" role="tabpanel" aria-labelledby="tab-${esc(S.ui.tab)}" tabindex="-1">
    <div class="loading-skeleton" aria-label="Loading">
      <div class="skeleton sk-bar"></div>
      <div class="sk-grid"><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div></div>
    </div>
  </main>
  <div id="toaster" class="toaster"></div>
  <dialog id="confirmDialog" class="alert-dialog" aria-labelledby="confirmDialog-title" aria-describedby="confirmDialog-desc">
    <div>
      <header><h2 id="confirmDialog-title"></h2><p id="confirmDialog-desc"></p></header>
      <footer>
        <button type="button" class="btn" data-variant="outline" data-confirm="0">Cancel</button>
        <button type="button" class="btn" data-confirm="1">Continue</button>
      </footer>
    </div>
  </dialog>
  <dialog id="cmdk" class="command-dialog" aria-label="Command palette"></dialog>`;
  // Basecoat initialises on DOMContentLoaded, which has passed when a GUI is loaded dynamically.
  window.basecoat?.initAll();
  window.basecoat?.start();

  // ---------------------------------------------------------------- toasts, dialogs, banner, theme
  function toast(category, title, description = '') {
    const t = document.getElementById('toaster');
    // Basecoat inserts title/description as HTML, so escape here.
    if (t?.toast) t.toast({ category, title: esc(title), description: esc(description) });
  }

  // Confirmation dialog (Basecoat alert-dialog); resolves true when confirmed.
  function confirmDialog(title, text, okLabel = 'Continue', destructive = false) {
    const d = document.getElementById('confirmDialog');
    d.querySelector('h2').textContent = title;
    d.querySelector('p').textContent = text;
    const ok = d.querySelector('[data-confirm="1"]');
    ok.textContent = okLabel;
    ok.toggleAttribute('data-variant', destructive);
    if (destructive) ok.dataset.variant = 'destructive';
    return new Promise((resolve) => {
      const done = (v) => { d.removeEventListener('click', onClick); d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); };
      const onClick = (e) => { const b = e.target.closest('[data-confirm]'); if (b) done(b.dataset.confirm === '1'); };
      const onClose = () => done(false); // Esc
      d.addEventListener('click', onClick);
      d.addEventListener('close', onClose);
      d.showModal();
      d.querySelector('[data-confirm="0"]').focus();
    });
  }

  // Message strip under the top bar (Basecoat alert). kind: 'info' | 'error'.
  function banner(html, kind = /fail|cannot|could not|error/i.test(html || '') ? 'error' : 'info') {
    const b = $('#banner');
    b.innerHTML = html ? `<div class="alert"${kind === 'error' ? ' data-variant="destructive"' : ''}>${icon(kind === 'error' ? 'alert' : 'info')}<section>${html}</section></div>` : '';
    b.classList.toggle('hidden', !html);
  }

  const theme = {
    get: () => window.basecoat?.theme?.get() || (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
    set(mode) {
      if (window.basecoat?.theme) window.basecoat.theme.set(mode); // stores localStorage.themeMode
      else {
        document.documentElement.classList.toggle('dark', mode === 'dark');
        try { localStorage.setItem('themeMode', mode); } catch { /* storage unavailable */ }
      }
      const sel = document.getElementById('set-theme');
      if (sel) sel.value = mode;
    },
  };

  // ---------------------------------------------------------------- rendering
  const active = () => byId.get(S.ui.tab) || modules[0];
  const ctx = { S, gui, modules, ui: { render: () => render(), toast, confirm: confirmDialog, banner, goto, theme, setTab } };

  function renderNoData() {
    const st = S.status || {};
    const text = `${st.refreshing ? 'Downloading quest &amp; hideout data from tarkov.dev…' : 'Quest and hideout definitions are downloaded once from tarkov.dev and cached locally.'}
      ${st.refreshError ? `<br><span class="bad">Last attempt failed: ${esc(st.refreshError)}</span>` : ''}
      ${/server unavailable/i.test(st.refreshError || '') ? '<br>tarkov.dev reports its own server is down. That is an outage on their side, not a problem with your setup. The tracker retries every 5 minutes and loads as soon as tarkov.dev is back.' : ''}`;
    const importBtn = byId.has('settings') ? btn('Import a data file', 'data-act="tab" data-tab="settings"', { variant: 'outline' }) : '';
    return emptyState('No game data yet', text, `<div class="row-gap">${btn(st.refreshing ? `${spinner()} Downloading…` : `${icon('download')} Download now`, 'data-act="refresh-data"', { disabled: !!st.refreshing })}${importBtn}</div>`, 'database');
  }

  // Redrawing while a mouse button is held down replaces the element being clicked, and the browser
  // then drops the click (e.g. typing a skill level and clicking a button straight away: the input's
  // change event redraws the page between mousedown and mouseup). Defer redraws until release.
  let pointerDown = false;
  let renderPending = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const releasePointer = () => {
    if (!pointerDown) return;
    pointerDown = false;
    // After the click event has been delivered to the unchanged page.
    if (renderPending) setTimeout(() => { if (renderPending) render(); }, 0);
  };
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);
  window.addEventListener('blur', releasePointer); // mouse released outside the window

  function render() {
    if (!S.progress) return; // still loading: keep the skeleton
    if (pointerDown) { renderPending = true; return; }
    renderPending = false;
    const mod = active();
    document.querySelectorAll('#tabs [role=tab]').forEach((b) => {
      const sel = b.dataset.tab === mod.id;
      b.setAttribute('aria-selected', String(sel));
      b.tabIndex = sel ? 0 : -1;
    });
    const view = $('#view');
    view.hidden = false;
    view.dataset.module = mod.id;
    view.setAttribute('aria-labelledby', `tab-${mod.id}`);
    resetIds();
    try {
      view.innerHTML = mod.needsData && !S.data ? renderNoData() : mod.view.render(ctx);
    } catch (err) {
      console.error(err);
      view.innerHTML = emptyState(`The ${esc(mod.title || mod.id)} section failed to draw`, esc(err.message), '', 'alert');
    }
    // Basecoat's MutationObserver initialises new components on its own; this catches any it missed.
    window.basecoat?.initAll();
  }

  function setTab(id) {
    if (!byId.has(id)) return false;
    S.ui.tab = id;
    saveUi();
    render();
    return true;
  }

  // Open another section, e.g. goto('quests', { id }) from a prerequisite link.
  function goto(id, args = {}) {
    const mod = byId.get(id);
    if (!mod) return;
    S.ui.tab = id;
    const after = mod.view.goto?.(args, ctx);
    saveUi();
    render();
    if (typeof after === 'function') after();
  }

  // ---------------------------------------------------------------- events
  // The module an element belongs to: the open section, or (palette items) the one named on the element.
  const moduleFor = (el) => byId.get(el.dataset.module) || (el.closest('#view') ? active() : null);
  const findHandler = (map, act, el) => {
    const own = moduleFor(el);
    if (own?.view[map]?.[act]) return [own, own.view[map][act]];
    for (const m of modules) if (m.view[map]?.[act]) return [m, m.view[map][act]];
    return [];
  };

  const shellActs = {
    tab: (el) => setTab(el.dataset.tab),
    theme: () => theme.set(theme.get() === 'dark' ? 'light' : 'dark'),
    palette: () => openPalette(),
    'refresh-data': () => refreshData(),
    'search-all': (el) => goto('search', { q: el.dataset.q || '' }),
  };

  document.addEventListener('click', async (e) => {
    const tab = e.target.closest('#tabs [role=tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'FORM') return;
    const { act } = el.dataset;
    if (el.tagName === 'A' || el.closest('summary')) e.preventDefault();
    if (shellActs[act]) return shellActs[act](el);
    if (act.startsWith('goto') && el.dataset.module && !byId.get(el.dataset.module)?.view.actions?.[act]) return goto(el.dataset.module, { ...el.dataset });
    const [, fn] = findHandler('actions', act, el);
    if (fn) await fn(el, ctx, e);
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.ui) {
      setUi(el.dataset.ui, el.type === 'checkbox' ? el.checked : el.value);
      render();
    } else if (el.dataset.set) {
      await setSetting(el.dataset.set, el.type === 'checkbox' ? el.checked : el.value);
    } else if (el.dataset.act) {
      const [, fn] = findHandler('changes', el.dataset.act, el);
      if (fn) await fn(el, ctx, e);
    }
  });

  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLDetailsElement) || !el.closest('#view')) return;
    if (active().view.toggle?.(el, ctx)) saveUi();
  }, true);

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-act]');
    if (!form) return;
    const [, fn] = findHandler('submits', form.dataset.act, form);
    if (!fn) return;
    e.preventDefault();
    await fn(form, ctx, e);
  });

  // Text inputs re-render while typing; keep focus and caret position.
  let typingTimer;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'globalSearch') {
      S.ui.search = el.value;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => goto('search', { q: el.value, keepFocus: true }), 150);
      return;
    }
    if (!el.dataset.ui || el.type !== 'search') return;
    setUi(el.dataset.ui, el.value);
    if (el.dataset.ui === 'search' && $('#globalSearch')) $('#globalSearch').value = el.value;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const sel = `[data-ui="${el.dataset.ui}"]`, pos = el.selectionStart;
      render();
      const again = document.querySelector(sel);
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }, 200);
  });

  // Basecoat tabs move the selection with the arrow keys; follow it.
  $('#tabs').addEventListener('keyup', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const sel = document.querySelector('#tabs [role=tab][aria-selected="true"]');
    if (sel && sel.dataset.tab !== S.ui.tab) setTab(sel.dataset.tab);
  });

  if (palette) {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    });
  }

  // Command palette (Basecoat command in a dialog): tabs, theme, and whatever each module offers
  // (view.commands). Items reuse the normal data-act routing. Rebuilt on every open.
  function openPalette() {
    const d = document.getElementById('cmdk');
    if (!palette || d.open) return;
    const item = (label, attrs, { keywords = '', hint = '', icon: ic = '' } = {}) => `<div role="menuitem" ${attrs} data-filter="${esc(label)}"${keywords ? ` data-keywords="${esc(keywords)}"` : ''}>${ic ? icon(ic) : ''}<span>${esc(label)}</span>${hint ? `<span class="cmd-hint">${hint}</span>` : ''}</div>`;
    const groups = new Map([['Actions', []], ['Go to', []]]);
    const add = (group, html) => { if (!groups.has(group)) groups.set(group, []); groups.get(group).push(html); };
    for (const m of modules) {
      let cmds = [];
      try { cmds = S.progress ? m.view.commands?.(ctx) || [] : []; } catch (err) { console.error(err); }
      for (const c of cmds) add(c.group || m.title, item(c.label, `${c.attrs} data-module="${esc(m.id)}"`, c));
    }
    add('Actions', item('Toggle dark mode', 'data-act="theme"', { icon: 'sun', keywords: 'theme light dark' }));
    for (const m of modules) add('Go to', item(m.title || m.id, `data-act="tab" data-tab="${esc(m.id)}"`, { icon: 'list', keywords: 'tab go' }));
    if (hasSearch) add('Search', `<div role="menuitem" data-act="search-all" data-q="" data-force>${icon('search')}<span class="cmd-search-label">Search quests &amp; items…</span></div>`);
    let n = 0;
    const html = [...groups].filter(([, items]) => items.length).map(([title, items]) => `<div role="group" aria-labelledby="cmdk-g${++n}"><span role="heading" id="cmdk-g${n}">${esc(title)}</span>${items.join('')}</div>`).join('');
    d.innerHTML = `<div class="command">
      <header>${icon('search')}<input type="text" id="cmdk-input" placeholder="Jump to a quest, skill, station or action…" autocomplete="off" autocorrect="off" spellcheck="false" aria-autocomplete="list" role="combobox" aria-expanded="true" aria-controls="cmdk-menu"></header>
      <div role="menu" id="cmdk-menu" aria-orientation="vertical" data-empty="No results found.">${html}</div>
      <footer><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> to move</span><span><kbd class="kbd">Enter</kbd> to select</span><span><kbd class="kbd">Esc</kbd> to close</span></footer>
    </div>`;
    window.basecoat?.init('command');
    const input = d.querySelector('#cmdk-input');
    const all = d.querySelector('[data-act="search-all"]');
    if (all) {
      input.addEventListener('input', () => {
        all.dataset.q = input.value.trim();
        all.querySelector('.cmd-search-label').textContent = input.value.trim() ? `Search everything for “${input.value.trim()}”` : 'Search quests & items…';
      });
    }
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.showModal();
    input.focus();
  }

  // ---------------------------------------------------------------- store events
  on('change', () => render());
  on('status', () => {
    const mod = active();
    if ((mod.view.live || (mod.needsData && !S.data)) && !$('#view').contains(document.activeElement)) render();
  });
  on('banner', (html) => banner(html));
  on('toast', ({ category, title, description }) => toast(category, title, description));

  if ($('#globalSearch')) $('#globalSearch').value = S.ui.search || '';
  if (guiInfo.warning) setTimeout(() => toast('warning', 'Interface fallback', guiInfo.warning), 300);
  await startStore();
  return ctx;
}
