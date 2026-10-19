// Objective / requirement rows (checkbox or counter), item tags and "needed for" lines, shared by the
// default views of quests, hideout, prestige, needed items and search.
import { setRequirement, stepRequirement } from '../../core/progress.js';
import { esc, readableType } from '../../core/util.js';
import { NEEDS, STATUS_LABEL, objItems, objNeeds, objTarget, objTitle, objValue } from '../../core/game.js';
import { badge, checkbox, stepperControl } from './components.js';

export function itemTag(it) {
  if (!it) return '';
  const img = it.iconLink ? `<img src="${esc(it.iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="it-tag" title="${esc(it.name)}">${img}${esc(it.shortName || it.name)}</span>`;
}

export function objTags(o) {
  const tags = [];
  const items = objItems(o);
  if (items.length) tags.push(items.length > 1 ? `<span class="badge" data-variant="outline">any of:</span> ${items.map(itemTag).join(' ')}` : itemTag(items[0]));
  if (['giveItem', 'findItem', 'plantItem', 'mark', 'useItem', 'sellItem'].includes(o.type) && items.length) {
    tags.push(o.foundInRaid ? badge('FIR', 'primary', 'fir', 'Must be found in raid') : badge('not FIR', 'outline', 'nofir', 'Does not need to be found in raid'));
  }
  if (o.questItem) tags.push(`<span class="badge" data-variant="outline">quest item: ${esc(o.questItem.name)}</span>`);
  if (o.dogTagLevel) tags.push(`<span class="badge" data-variant="outline">dogtag lvl ≥ ${o.dogTagLevel}</span>`);
  if (o.minDurability || (o.maxDurability && o.maxDurability < 100)) tags.push(`<span class="badge" data-variant="outline">durability ${o.minDurability || 0}–${o.maxDurability ?? 100}%</span>`);
  if (o.targetNames?.length) tags.push(`<span class="badge" data-variant="outline">target: ${esc(o.targetNames.join(', '))}</span>`);
  if (o.bodyParts?.length) tags.push(`<span class="badge" data-variant="outline">${esc(o.bodyParts.join(', '))}</span>`);
  if (o.zoneNames?.length) tags.push(`<span class="badge" data-variant="outline">zone: ${esc(o.zoneNames.join(', '))}</span>`);
  if (o.usingWeapon?.length) tags.push(`<span class="badge" data-variant="outline">weapon:</span> ${o.usingWeapon.slice(0, 6).map(itemTag).join(' ')}${o.usingWeapon.length > 6 ? ` +${o.usingWeapon.length - 6}` : ''}`);
  for (const set of o.wearing || []) if (set?.length) tags.push(`<span class="badge" data-variant="outline">wearing:</span> ${set.map(itemTag).join(' + ')}`);
  if (o.notWearing?.length) tags.push(`<span class="badge" data-variant="outline">not wearing: ${esc(o.notWearing.map((i) => i.shortName || i.name).join(', '))}</span>`);
  if (o.skillLevel) tags.push(`<span class="badge" data-variant="outline">${esc(o.skillLevel.name)} ${o.skillLevel.level}</span>`);
  if (o.exitStatus?.length) tags.push(`<span class="badge" data-variant="outline">${esc(o.exitStatus.join('/'))}</span>`);
  if (o.maps?.length) tags.push(`<span class="badge" data-variant="outline">${esc(o.maps.map((m) => m.name).join(', '))}</span>`);
  return tags.join(' ');
}

// Render one objective row with a checkbox or a counter.
// Render one objective row with a checkbox or a counter.
export function objRow(section, key, o, { disabled = false, forceDone = false } = {}) {
  const v = forceDone ? { cur: objTarget(o), target: objTarget(o), done: true } : objValue(section, key, o);
  let control;
  if (v.auto) control = `<span class="tip-wrap" data-tooltip="Tracked automatically" data-side="right">${checkbox('disabled aria-label="Tracked automatically"', v.done)}</span>`;
  else if (v.target > 1) control = stepperControl(`data-act="step" data-sec="${section}" data-key="${esc(key)}"`, v.cur, v.target, disabled);
  else control = checkbox(`data-act="check" data-sec="${section}" data-key="${esc(key)}" aria-label="Done"`, v.done, disabled ? 'disabled' : '');
  const auto = v.auto ? `<span class="auto">auto – ${esc(v.auto.why)}</span>` : '';
  // No description from the game: build the title from the data and skip the (now redundant) tags.
  const generated = !o.description || o.description === o.type;
  if (generated) {
    const title = objTitle(o) || readableType(o.type);
    const icon = o.type === 'haveItem' && objItems(o)[0]?.iconLink ? `<img class="req-icon" src="${esc(objItems(o)[0].iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<li class="${v.done ? 'done' : ''}">${control}<div class="body">
      <div class="desc">${icon}${esc(title)} ${o.optional ? '<span class="optional">(optional)</span>' : ''}</div>
      ${auto ? `<div class="tags">${auto}</div>` : ''}
    </div></li>`;
  }
  const kind = [...objNeeds(o)].map((n) => NEEDS[n]).join(' · ');
  return `<li class="${v.done ? 'done' : ''}">${control}<div class="body">
    <div class="desc">${esc(o.description)} ${o.optional ? '<span class="optional">(optional)</span>' : ''}</div>
    <div class="tags"><span class="type-icon">${esc(kind)}</span> ${objTags(o)} ${auto}</div>
  </div></li>`;
}

// One "needed for" line of the needed-items and search tables.
export function sourceLine(r) {
  const where = r.kind === 'quest' || r.kind === 'equipment'
    ? `<a href="#" data-act="goto" data-module="quests" data-id="${r.taskId}">${esc(r.label)}</a> ${badge(STATUS_LABEL[r.status] || r.status, 'outline', `status-${r.status}`)}`
    : `<b>${esc(r.label)}</b> ${badge(r.kind, 'secondary')}`;
  const qty = r.kind === 'equipment' ? badge('equipment', 'secondary') : `×${r.count} ${r.fir ? badge('FIR', 'primary', 'fir') : badge('not FIR', 'outline', 'nofir')}${r.alt ? ' <span class="optional">(one of several accepted items)</span>' : ''}`;
  return `<div>${r.done ? '✓ ' : ''}${where} — ${qty}${r.have && !r.done ? ` <span class="auto">${r.have} collected</span>` : ''}${r.sub ? `<br><span class="auto">${esc(r.sub)}</span>` : ''}</div>`;
}

// Event handlers for the controls above. Views spread these into their own actions/changes.
export const objectiveActions = {
  // counter − / +
  step(el) { const { sec, key, d, max } = el.dataset; stepRequirement(sec, key, d, max); },
};
export const objectiveChanges = {
  check(el) { setRequirement(el.dataset.sec, el.dataset.key, el.checked); },
};
