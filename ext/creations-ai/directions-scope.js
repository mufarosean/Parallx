// directions-scope.js — Creations AI: the kinds of direction a chat offers,
// scoped. Creations Settings holds the lists every chat follows by default
// (one for each character, one for the Narrator); in a chat, each character
// may keep a list of their own (the chef and the daughter do not want the
// same moves), and the Narrator one list for the chat. An own list starts as
// a copy of the Settings list so it is edited, not written from nothing, and
// an own empty list means none of that sort here. Drawn with the kit alone;
// mounted in the chat drawer.

import { DEFAULT_CHARACTER_DIRECTIONS, DEFAULT_NARRATOR_DIRECTIONS, MAX_DIRECTION_KINDS } from './director.js';

/** The scope values of the dropdown. */
export const FOLLOW_SETTINGS = '';
export const OWN_LIST = 'chat';

/** The Settings list for a key, the shipped default when Settings has none. */
export function settingsList(settings, key, fallback) {
  const v = settings?.[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * The lists a chat can scope: one per character in it, then the Narrator's.
 * Each reads and writes its place on the thread: a character's list lives in
 * `thread.directionsByCharacter[file]` (absent means follow), the Narrator's
 * in `thread.directionsNarrator` (null means follow).
 */
export function directionLists(thread, characters, saveMeta) {
  const lists = (Array.isArray(characters) ? characters : []).filter((c) => c && c.file).map((c) => ({
    key: `directionsByCharacter.${c.file}`,
    label: `Directions for ${c.name || c.file}`,
    settingsKey: 'directionsCharacter',
    fallback: DEFAULT_CHARACTER_DIRECTIONS,
    hint: `What Suggest Directions offers ${c.name || 'this character'} in this chat, one per line as "Label: what it means", up to ${MAX_DIRECTION_KINDS}. Empty means no options for them here.`,
    get: () => (thread.directionsByCharacter && typeof thread.directionsByCharacter === 'object' ? thread.directionsByCharacter[c.file] : undefined),
    set: (v) => {
      const map = { ...(thread.directionsByCharacter && typeof thread.directionsByCharacter === 'object' ? thread.directionsByCharacter : {}) };
      if (v === null) delete map[c.file]; else map[c.file] = v;
      saveMeta({ directionsByCharacter: map }, 'directions');
    },
  }));
  lists.push({
    key: 'directionsNarrator',
    label: 'Directions for the Narrator',
    settingsKey: 'directionsNarrator',
    fallback: DEFAULT_NARRATOR_DIRECTIONS,
    hint: `The Narrator's options in this chat: moves for the story itself, one per line, up to ${MAX_DIRECTION_KINDS}. Empty means no Narrator options here.`,
    get: () => thread.directionsNarrator,
    set: (v) => saveMeta({ directionsNarrator: v }, 'directions'),
  });
  return lists;
}

/**
 * The fields in the chat drawer, one per list: a dropdown (Follow Settings,
 * This Chat's Own List) and, for an own list, the textarea holding it.
 *   ui: the kit (createBlock, for the hint)
 *   textarea: makes an empty multi-line field like the drawer's others (the kit has no multi-line control)
 *   select: makes the app's dropdown from { className, layout, items, value, onChange }
 *   fieldWrap: the drawer's labelled field (label, control element)
 *   thread, saveMeta: the chat and how its fields are saved
 *   settings: Creations Settings, or a getter for them
 *   characters: [{ file, name }] in the chat
 * Returns one { key, area, scope } per list.
 */
export function mountDirectionsScope(host, { ui, textarea, select, fieldWrap, thread, saveMeta, settings, characters = [] }) {
  const current = () => (typeof settings === 'function' ? settings() : settings) || {};
  const mounted = [];
  for (const list of directionLists(thread, characters, saveMeta)) {
    const own = typeof list.get() === 'string';
    const area = textarea();
    area.className = 'tg-drawer-textarea';
    area.setAttribute('rows', '4');
    area.setAttribute('placeholder', 'One kind per line, as "Label: what it means".');
    area.setAttribute('aria-label', `${list.label}, this chat's list`);
    area.value = own ? list.get() : '';
    area.hidden = !own;
    const scope = select({
      className: 'tg-drawer-select',
      layout: 'full',
      items: [{ value: FOLLOW_SETTINGS, label: 'Follow Settings (Default)' }, { value: OWN_LIST, label: "This Chat's Own List" }],
      value: own ? OWN_LIST : FOLLOW_SETTINGS,
      onChange: (v) => {
        if (v === OWN_LIST) {
          // An own list begins as a copy of the Settings list, to edit.
          if (typeof list.get() !== 'string') {
            area.value = settingsList(current(), list.settingsKey, list.fallback);
            list.set(area.value);
          }
          area.hidden = false;
          area.focus();
        } else {
          list.set(null);
          area.hidden = true;
        }
      },
    });
    const wrap = fieldWrap(`${list.label} (this chat)`, scope.element);
    wrap.appendChild(area);
    ui.createBlock(wrap, 'div', { className: 'tg-drawer-hint', text: list.hint });
    area.addEventListener('change', () => { if (!area.hidden) list.set(area.value); });
    host.appendChild(wrap);
    mounted.push({ key: list.key, area, scope });
  }
  return mounted;
}
