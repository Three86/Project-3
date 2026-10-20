// Basecoat UI helpers (markup from basecoat-css 1.0.2, see public/vendor/basecoat), shared by the default
// module views and the Basecoat-based GUIs. Every element keeps the data-* attributes the GUI shell
// routes events by, so behaviour does not depend on the styling.
import { esc } from '../../core/util.js';

// Markup follows basecoat-css 1.0.2 (public/vendor/basecoat). Every element keeps the data-* attributes
// the delegated event handlers below rely on, so behaviour does not depend on the styling.
export const ICON_PATHS = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
  run: '<circle cx="13" cy="4" r="2"/><path d="m7 21 3-6 3 2v5"/><path d="m5 12 3-4 5 1 3 3 3 1"/><path d="m10 15-2-3"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  fuel: '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
};
export const icon = (name, cls = '') => `<svg class="lucide ${cls}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
export const spinner = () => `<svg aria-label="Loading" role="status" class="animate-spin lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS.loader}</svg>`;

// <button class="btn">. opts: variant (primary|secondary|outline|ghost|link|destructive), size
// (xs|sm|lg|icon|icon-xs|icon-sm), tip (tooltip text), side, disabled, cls. attrs: raw data-* attributes.
export function btn(label, attrs = '', { variant, size, tip, side, disabled, cls = '' } = {}) {
  const b = `<button type="button" class="btn ${cls}"${variant ? ` data-variant="${variant}"` : ''}${size ? ` data-size="${size}"` : ''}${tip && !disabled ? ` data-tooltip="${esc(tip)}"${side ? ` data-side="${side}"` : ''}` : ''} ${attrs}${disabled ? ' disabled' : ''}>${label}</button>`;
  // Disabled buttons get no hover events; wrap them so the tooltip still shows (as in the Basecoat docs).
  return tip && disabled ? `<span class="tip-wrap" data-tooltip="${esc(tip)}"${side ? ` data-side="${side}"` : ''}>${b}</span>` : b;
}
// <span class="badge">. variant: primary (default) | secondary | outline | destructive | ghost.
export const badge = (text, variant = 'outline', cls = '', tip = '') => `<span class="badge ${cls}" data-variant="${variant}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>${text}</span>`;
// Labelled control on one line (toolbar fields).
export const fieldInline = (label, control) => `<label class="label tb-field"><span>${label}</span>${control}</label>`;
// Checkbox with Basecoat styling; attrs carry the data-* the change handler needs.
export const checkbox = (attrs, checked, extra = '') => `<input type="checkbox" class="input" ${attrs} ${checked ? 'checked' : ''} ${extra}>`;
// Switch with its label.
export const toggleSwitch = (label, attrs, checked) => `<label class="label sw-field"><input type="checkbox" role="switch" class="input" ${attrs} ${checked ? 'checked' : ''}>${label}</label>`;
// Basecoat progress bar.
export function progressBar(done, total, label = 'Progress') {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}
// Counter for multi-count requirements: [−] 3/5 [+].
export function stepperControl(attrs, cur, target, disabled = false) {
  return `<div role="group" class="button-group stepper" aria-label="Count">
    ${btn(icon('minus'), `${attrs} data-d="-1" data-max="${target}" aria-label="One less"`, { variant: 'outline', size: 'icon-xs', disabled })}
    <span class="step-val">${cur}/${target}</span>
    ${btn(icon('plus'), `${attrs} data-d="1" data-max="${target}" aria-label="One more"`, { variant: 'outline', size: 'icon-xs', disabled })}</div>`;
}
// Empty state.
export const emptyState = (title, text = '', footer = '', ic = 'info') => `<section class="empty">
  <header><figure>${icon(ic)}</figure>${title ? `<h3>${title}</h3>` : ''}${text ? `<p>${text}</p>` : ''}</header>${footer ? `<footer>${footer}</footer>` : ''}</section>`;
// Dropdown menu (Basecoat dropdown-menu). items: [{ label, attrs, destructive, disabled }] or 'sep'.
let uid = 0;
// Ids only need to be unique within one render; the shell resets them before each.
export function resetIds() { uid = 0; }
export function dropdownMenu(triggerLabel, items, { tip = 'More actions', align = 'end' } = {}) {
  const id = `dd${++uid}`;
  return `<div id="${id}" class="dropdown-menu">
    <button type="button" id="${id}-trigger" aria-haspopup="menu" aria-controls="${id}-menu" aria-expanded="false" class="btn" data-variant="ghost" data-size="icon-sm" aria-label="${esc(tip)}">${triggerLabel}</button>
    <div id="${id}-popover" data-popover aria-hidden="true" data-align="${align}">
      <div role="menu" id="${id}-menu" aria-labelledby="${id}-trigger">${items.map((it) => it === 'sep' ? '<hr role="separator">' : `<div role="menuitem" ${it.attrs || ''}${it.destructive ? ' data-variant="destructive"' : ''}${it.disabled ? ' aria-disabled="true"' : ''}>${it.label}</div>`).join('')}</div>
    </div></div>`;
}
// Popover: trigger button plus floating content (Basecoat popover).
export function popover(triggerLabel, content, { variant = 'outline', size = 'xs', align = 'start', cls = '' } = {}) {
  const id = `pop${++uid}`;
  return `<div id="${id}" class="popover ${cls}">
    <button id="${id}-trigger" type="button" aria-expanded="false" aria-controls="${id}-popover" class="btn" data-variant="${variant}" data-size="${size}">${triggerLabel}</button>
    <div id="${id}-popover" data-popover aria-hidden="true" data-align="${align}">${content}</div></div>`;
}

// Labelled <select> bound to a UI-state path (data-ui), e.g. select('q.trader', …).
export function select(name, value, options, label) {
  return fieldInline(label, `<select class="select" data-size="sm" data-ui="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
}
