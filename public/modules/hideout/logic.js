// Hideout: which stations and levels to list, and building / unbuilding levels.
// Requirement counters and checkboxes are in core/progress.js.
import { S, setProgress, saveUi } from '../../core/store.js';
import { norm, byName } from '../../core/util.js';
import { idx, builtLevel, hideoutReqs, levelBuilt, levelUnlocked, REQ_NEEDS, stationStatus } from '../../core/game.js';

export { stepRequirement, setRequirement } from '../../core/progress.js';
export { builtLevel, hideoutReqs, levelBuilt, levelUnlocked, REQ_NEEDS, stationStatus };

export const uiDefaults = {
  h: { show: 'next', need: '', sortBy: 'name', text: '' },
  hOpen: {}, // station id -> card open
};

// Stations to list with the current filters: { rows: [{ st, built, levels }], locked } where locked
// counts stations hidden because the stations they need are not built yet.
export function stationRows() {
  const f = S.ui.h;
  const text = norm(f.text);
  let stations = (S.data.hideout || []).filter((st) => st.levels.length);
  const rows = [];
  let locked = 0;
  for (const st of stations) {
    const built = builtLevel(st);
    let levels = st.levels;
    if (f.show === 'next') {
      levels = levels.filter((l) => l.level === built + 1);
      if (levels.length && !levels.every(levelUnlocked)) {
        levels = [];
        // Nothing built yet and the first level is locked: hide the station entirely.
        if (built === 0) { locked++; continue; }
      }
    } else if (f.show === 'nextAll') levels = levels.filter((l) => l.level === built + 1);
    else if (f.show === 'todo') levels = levels.filter((l) => l.level > built);
    else if (f.show === 'built') levels = levels.filter((l) => l.level <= built);
    levels = levels.filter((l) => {
      const reqs = hideoutReqs(l);
      if (f.need === 'fir' && !reqs.some((r) => r.kind === 'item' && r.fir)) return false;
      if (f.need && f.need !== 'fir' && !reqs.some((r) => r.kind === f.need)) return false;
      if (text && !norm(st.name).includes(text) && !reqs.some((r) => norm(r.item?.name || r.label).includes(text))) return false;
      return true;
    });
    // Keep fully built stations visible in "next level" view so they can still be unmarked.
    // (also stations whose next level is locked, so their built levels can be unmarked)
    const keepBuilt = f.show === 'next' && built > 0 && !levels.length && !f.need && !text;
    if (levels.length || keepBuilt) rows.push({ st, built, levels });
  }
  const readiness = (r) => {
    if (!r.levels.length) return -1;
    const reqs = hideoutReqs(r.levels[0]);
    return reqs.length ? reqs.filter((x) => x.done).length / reqs.length : 1;
  };
  rows.sort(f.sortBy === 'ready' ? (a, b) => readiness(b) - readiness(a) || byName(a.st.name, b.st.name) : (a, b) => byName(a.st.name, b.st.name));
  return { rows, locked };
}

// Mark a level built (and every lower level), or unbuild it (and every higher level).
export function setBuilt(levelId, built) {
  const { station, level } = idx.levels.get(levelId);
  const ops = station.levels.map((l) => ({ section: 'hideout', id: l.id, value: built ? (l.level <= level.level ? true : !!S.progress.hideout[l.id]) : (l.level < level.level && !!S.progress.hideout[l.id]) }));
  return setProgress(ops);
}

export function setAllOpen(open) {
  for (const st of S.data.hideout || []) S.ui.hOpen[st.id] = open;
  saveUi();
}

export function setShow(show) { S.ui.h.show = show; saveUi(); }

// Show one station: list all its levels, filtered to its name, card open.
export function focusStation(id) {
  const st = idx.stations.get(id);
  if (!st) return null;
  S.ui.h = { ...S.ui.h, show: 'all', need: '', text: st.name };
  S.ui.hOpen[id] = true;
  saveUi();
  return st;
}

// Stations that have levels (for the command palette etc.).
export const stations = () => (S.data?.hideout || []).filter((st) => st.levels.length);

// Icon served by the tracker (downloaded once from tarkov.dev); 404 until it has been fetched.
export const stationImage = (id) => `/api/images/stations/${encodeURIComponent(id)}`;

// Every station with levels, by name, with its status (see core/game.js stationStatus; opts are passed on).
export function stationCards(opts) {
  return stations().slice().sort((a, b) => byName(a.name, b.name)).map((st) => ({ station: st, image: stationImage(st.id), status: stationStatus(st, opts) }));
}

// Change a station's built level by one (−1 unbuilds the top level, +1 builds the next one).
export function stepLevel(stationId, d) {
  const st = idx.stations.get(stationId);
  if (!st) return null;
  const built = builtLevel(st);
  const target = st.levels.find((l) => l.level === (d > 0 ? built + 1 : built));
  if (!target) return null;
  return setBuilt(target.id, d > 0);
}
