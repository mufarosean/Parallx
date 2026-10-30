// item-menu.js — what the library's right-click menu shows for one item or a
// selection, and in what order (MEDIA_ORGANIZER_AUDIT 3.7 and step 5).
//
// A photo, a GIF and a video each get only what applies to them: a GIF is
// not edited, upscaled or tagged by the AI, a still photo is not optimised as
// a GIF, and only a video goes into a clip project. One item's menu and a
// selection's list their items in the same groups, in the same order:
// open, edit, organise, AI, send, file, delete. The rarer ones (Add to Chat,
// Copy File Path) wait under More, at the end of the file group.
//
// main.js describes each entry once, with its group and the kinds it is for;
// this arranges them. Pure, so the order is tested (tests/unit/moItemMenu).

/** The groups, in the order every media menu lists them. */
export const MO_MENU_GROUPS = ['open', 'edit', 'organise', 'ai', 'send', 'file', 'delete'];

/** An item's kind for its menu: 'photo', 'gif' or 'video'. */
export function moItemKind(item) {
  if (item && item.type === 'video') return 'video';
  return item && item.isGif ? 'gif' : 'photo';
}

/** The kinds a selection holds. */
export function moKindsOf(items) {
  return new Set((items || []).map(moItemKind));
}

const rankOf = (group) => {
  const i = MO_MENU_GROUPS.indexOf(group);
  return i < 0 ? MO_MENU_GROUPS.indexOf('file') : i;
};

/**
 * Arrange menu entries. Each entry is a menu item plus `group` (one of
 * MO_MENU_GROUPS), optional `kinds` (shown only when the item, or any item of
 * the selection, is one of them) and optional `rare` (goes under More).
 * `kinds` is the kinds present. Returns the menu: groups in order, entries
 * in the order given within a group, one separator between groups.
 */
export function moArrangeMenu(entries, kinds, moreLabel = 'More') {
  const have = new Set(kinds || []);
  const groups = MO_MENU_GROUPS.map(() => []);
  const rare = MO_MENU_GROUPS.map(() => []); // in the same order, under More
  for (const e of entries || []) {
    if (!e || e.separator) continue;
    if (Array.isArray(e.kinds) && !e.kinds.some((k) => have.has(k))) continue;
    const { group, kinds: _kinds, rare: isRare, ...item } = e;
    (isRare ? rare : groups)[rankOf(group)].push(item);
  }
  const more = rare.flat();
  if (more.length) groups[rankOf('file')].push({ label: moreLabel, icon: 'ellipsis', submenu: more });
  const out = [];
  for (const g of groups) {
    if (!g.length) continue;
    if (out.length) out.push({ separator: true });
    out.push(...g);
  }
  return out;
}
