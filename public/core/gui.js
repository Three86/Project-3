// Which GUI runs in this browser. The choice is stored per browser (Settings → Interface), so a second
// monitor can show a different GUI. ?gui=<id> in the address overrides it (recovery only, e.g. when a
// custom GUI has no switcher).
export const GUI_KEY = 'tt-gui';
export const DEFAULT_GUI = 'basecoat';

// Filled in by boot.js: every discovered GUI ({ id, title, description, … }) and the running one.
export const guiInfo = { list: [], current: null, warning: '' };

export function chosenGui() {
  const forced = new URLSearchParams(location.search).get('gui');
  if (forced) return forced;
  try { return localStorage.getItem(GUI_KEY) || DEFAULT_GUI; } catch { return DEFAULT_GUI; }
}

// Switch GUI: remember it for this browser and reload into it.
export function setGui(id) {
  try { localStorage.setItem(GUI_KEY, id); } catch { /* storage unavailable */ }
  const url = new URL(location.href);
  url.searchParams.delete('gui');
  location.replace(url.href);
}
