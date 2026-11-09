// directions-scope.js — Creations AI: the kinds of direction a chat offers,
// scoped. Creations Settings holds the two lists every chat follows by
// default (for each character, for the Narrator); a chat may keep its own
// two lists instead, each started from the Settings list so it is edited,
// not written from nothing, and each empty meaning none of that sort in
// this chat. Drawn with the kit alone; mounted in the chat drawer.

import { DEFAULT_CHARACTER_DIRECTIONS, DEFAULT_NARRATOR_DIRECTIONS, MAX_DIRECTION_KINDS } from './director.js';

const LISTS = [
  { key: 'directionsCharacter', label: 'Directions for each character', fallback: DEFAULT_CHARACTER_DIRECTIONS, hint: `What Suggest Directions offers each character in this chat, one per line as "Label: what it means", up to ${MAX_DIRECTION_KINDS}. Empty means no character options here.` },
  { key: 'directionsNarrator', label: 'Directions for the Narrator', fallback: DEFAULT_NARRATOR_DIRECTIONS, hint: `The Narrator's options in this chat: moves for the story itself, one per line, up to ${MAX_DIRECTION_KINDS}. Empty means no Narrator options here.` },
];

/** The scope values of the dropdown. */
export const FOLLOW_SETTINGS = '';
export const OWN_LIST = 'chat';

/** The Settings list for a key, the shipped default when Settings has none. */
export function settingsList(settings, key, fallback) {
  const v = settings?.[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * Two fields in the chat drawer, one per list: a dropdown (Follow Settings,
 * This Chat's Own List) and, for an own list, the textarea holding it.
 *   ui: the kit (createBlock)
 *   select: makes the app's dropdown from { className, layout, items, value, onChange }
 *   fieldWrap: the drawer's labelled field (label, control element)
 *   thread: the chat; `directionsCharacter` and `directionsNarrator` are null (follow) or a string (own)
 *   saveMeta: saves fields on the thread
 *   settings: Creations Settings, or a getter for them
 * Returns one { key, area, scope } per list.
 */
export function mountDirectionsScope(host, { ui, select, fieldWrap, thread, saveMeta, settings }) {
  const current = () => (typeof settings === 'function' ? settings() : settings) || {};
  const mounted = [];
  for (const list of LISTS) {
    const own = typeof thread[list.key] === 'string';
    const area = ui.createBlock(null, 'textarea', { className: 'tg-drawer-textarea', attrs: { rows: '4', placeholder: 'One kind per line, as "Label: what it means".', 'aria-label': `${list.label}, this chat's list` } });
    area.value = own ? thread[list.key] : '';
    area.hidden = !own;
    const scope = select({
      className: 'tg-drawer-select',
      layout: 'full',
      items: [{ value: FOLLOW_SETTINGS, label: 'Follow Settings (Default)' }, { value: OWN_LIST, label: "This Chat's Own List" }],
      value: own ? OWN_LIST : FOLLOW_SETTINGS,
      onChange: (v) => {
        if (v === OWN_LIST) {
          // An own list begins as a copy of the Settings list, to edit.
          if (typeof thread[list.key] !== 'string') {
            area.value = settingsList(current(), list.key, list.fallback);
            saveMeta({ [list.key]: area.value }, 'directions');
          }
          area.hidden = false;
          area.focus();
        } else {
          saveMeta({ [list.key]: null }, 'directions');
          area.hidden = true;
        }
      },
    });
    const wrap = fieldWrap(`${list.label} (this chat)`, scope.element);
    wrap.appendChild(area);
    ui.createBlock(wrap, 'div', { className: 'tg-drawer-hint', text: list.hint });
    area.addEventListener('change', () => { if (!area.hidden) saveMeta({ [list.key]: area.value }, 'directions'); });
    host.appendChild(wrap);
    mounted.push({ key: list.key, area, scope });
  }
  return mounted;
}
