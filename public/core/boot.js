// Page loader: picks the GUI for this browser, loads its styles/scripts, its section modules and its
// shell. If that GUI fails to load, falls back to the default GUI and says why.
import { discover, loadAssets, loadModules, guiBase } from './registry.js';
import { chosenGui, guiInfo, DEFAULT_GUI } from './gui.js';

async function startGui(id, catalog) {
  const gui = catalog.guis.find((g) => g.id === id);
  if (!gui) throw new Error(`GUI "${id}" not found`);
  await loadAssets(gui);
  const modules = await loadModules(gui, catalog.modules);
  const shell = await import(new URL(gui.entry || 'shell.js', guiBase(gui.id)).href);
  guiInfo.current = gui;
  await shell.default({ gui, modules });
}

async function boot() {
  let catalog;
  try {
    catalog = await discover();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:24px;font-family:system-ui">Cannot reach the tracker server: ${String(err.message).replace(/</g, '&lt;')}</p>`;
    return;
  }
  guiInfo.list = catalog.guis;
  const wanted = chosenGui();
  try {
    await startGui(wanted, catalog);
  } catch (err) {
    console.error(err);
    if (wanted === DEFAULT_GUI) throw err;
    // Remove whatever the broken GUI managed to add, then start the default one.
    document.querySelectorAll('[data-gui]').forEach((el) => el.remove());
    document.body.innerHTML = '';
    guiInfo.warning = `The "${wanted}" interface could not be loaded (${err.message}). Showing the default one.`;
    await startGui(DEFAULT_GUI, catalog);
  }
}

boot();
