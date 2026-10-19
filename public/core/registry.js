// Finds GUIs and section modules (the server lists public/guis/*/gui.json and public/modules/*/module.json)
// and loads a GUI's modules: each module's logic plus its view (the GUI's override, else the module's
// default view).
import { api } from './store.js';

const root = new URL('../', import.meta.url); // public/

export async function discover() {
  const { body } = await api('/api/ui');
  return { guis: body.guis || [], modules: body.modules || [] };
}

export const guiBase = (id) => new URL(`guis/${id}/`, root);

// A GUI's modules in its order: gui.modules is "*" (every module, by module.json order) or a list of ids.
export function pickModules(gui, catalog) {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  if (Array.isArray(gui.modules)) return gui.modules.map((id) => byId.get(id)).filter(Boolean);
  return catalog.slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.id).localeCompare(String(b.id)));
}

export async function loadModules(gui, catalog) {
  const metas = pickModules(gui, catalog);
  return Promise.all(metas.map(async (meta) => {
    const logic = await import(new URL(`modules/${meta.id}/logic.js`, root).href);
    const override = gui.views?.[meta.id];
    const viewUrl = override ? new URL(override, guiBase(gui.id)) : new URL(`modules/${meta.id}/view.js`, root);
    const view = (await import(viewUrl.href)).default;
    return { ...meta, needsData: meta.needsData !== false, logic, view };
  }));
}

// Stylesheets and classic scripts a GUI declares (paths relative to its folder), loaded in order.
export async function loadAssets(gui) {
  const base = guiBase(gui.id);
  for (const href of gui.styles || []) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL(href, base).href });
    link.dataset.gui = gui.id;
    document.head.append(link);
  }
  for (const src of gui.scripts || []) {
    await new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src: new URL(src, base).href });
      s.dataset.gui = gui.id;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.append(s);
    });
  }
}
