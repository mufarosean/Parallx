// moItemMenu.test.ts — Atelier's right-click menus by kind and in one order
// (MEDIA_ORGANIZER_AUDIT step 5). A photo, a GIF and a video each show only
// what applies to them; one item's menu and a selection's share the groups
// open, edit, organise, AI, send, file, delete, in that order; the rarer
// items wait under More.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { MO_MENU_GROUPS, moArrangeMenu, moItemKind, moKindsOf } from '../../ext/media-organizer/item-menu.js';

type Entry = { group: string; label: string; kinds?: string[]; rare?: boolean };
type Item = { label?: string; separator?: boolean; submenu?: Item[] };

// The entries main.js describes for one item, deliberately out of order.
const ENTRIES: Entry[] = [
  { group: 'delete', label: 'Delete…' },
  { group: 'file', label: 'Show in Folder' },
  { group: 'file', label: 'Copy File Path', rare: true },
  { group: 'send', label: 'Add to Chat', rare: true },
  { group: 'ai', label: 'Tag With AI', kinds: ['photo'] },
  { group: 'organise', label: 'Select Similar Photos', kinds: ['photo'] },
  { group: 'organise', label: 'Tag…' },
  { group: 'organise', label: 'Add to Album…' },
  { group: 'edit', label: 'Edit Image', kinds: ['photo'] },
  { group: 'edit', label: 'Upscale…', kinds: ['photo'] },
  { group: 'edit', label: 'Optimize GIF…', kinds: ['gif'] },
  { group: 'edit', label: 'Add to Clip Project', kinds: ['video'] },
  { group: 'open', label: 'View Full Size' },
  { group: 'open', label: 'Edit Details' },
];

const labels = (menu: Item[]) => menu.map((m) => (m.separator ? '|' : m.label));
const flat = (menu: Item[]): string[] => menu.flatMap((m) => (m.submenu ? [m.label as string, ...flat(m.submenu)] : m.separator ? [] : [m.label as string]));

describe('moItemKind', () => {
  it('tells a photo, a GIF and a video apart', () => {
    expect(moItemKind({ type: 'photo', id: 1 })).toBe('photo');
    expect(moItemKind({ type: 'photo', id: 2, isGif: true })).toBe('gif');
    expect(moItemKind({ type: 'video', id: 3 })).toBe('video');
    expect([...moKindsOf([{ type: 'photo' }, { type: 'video' }, { type: 'photo', isGif: true }])].sort()).toEqual(['gif', 'photo', 'video']);
  });
});

describe('moArrangeMenu', () => {
  it('a photo gets the photo items, grouped in the shared order', () => {
    expect(labels(moArrangeMenu(ENTRIES, ['photo']))).toEqual([
      'View Full Size', 'Edit Details', '|',
      'Edit Image', 'Upscale…', '|',
      'Select Similar Photos', 'Tag…', 'Add to Album…', '|',
      'Tag With AI', '|',
      'Show in Folder', 'More', '|',
      'Delete…',
    ]);
  });

  it('a GIF is not edited, upscaled or tagged by the AI, and is optimised', () => {
    const all = flat(moArrangeMenu(ENTRIES, ['gif']));
    expect(all).toContain('Optimize GIF…');
    for (const not of ['Edit Image', 'Upscale…', 'Select Similar Photos', 'Tag With AI', 'Add to Clip Project']) expect(all).not.toContain(not);
  });

  it('a video goes into a clip project and gets no photo tools', () => {
    const all = flat(moArrangeMenu(ENTRIES, ['video']));
    expect(all).toContain('Add to Clip Project');
    for (const not of ['Edit Image', 'Upscale…', 'Optimize GIF…', 'Tag With AI', 'Select Similar Photos']) expect(all).not.toContain(not);
  });

  it('a mixed selection shows what applies to any of its kinds', () => {
    const all = flat(moArrangeMenu(ENTRIES, ['photo', 'video']));
    expect(all).toContain('Upscale…');
    expect(all).toContain('Add to Clip Project');
    expect(all).not.toContain('Optimize GIF…');
  });

  it('every kind lists its groups in the same order, Delete last', () => {
    const groupOf = new Map(ENTRIES.map((e) => [e.label, e.group]));
    for (const kind of ['photo', 'gif', 'video']) {
      const menu = moArrangeMenu(ENTRIES, [kind]);
      const ranks = labels(menu).filter((l) => l !== '|' && l !== 'More').map((l) => MO_MENU_GROUPS.indexOf(groupOf.get(l as string) ?? ''));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(labels(menu).at(-1)).toBe('Delete…');
    }
  });

  it('puts the rare items under More, at the end of the file group', () => {
    const menu = moArrangeMenu(ENTRIES, ['photo']) as Item[];
    const more = menu.find((m) => m.label === 'More');
    expect(more?.submenu?.map((m) => m.label)).toEqual(['Add to Chat', 'Copy File Path']);
    expect(flat(menu).filter((l) => l === 'Add to Chat')).toHaveLength(1);
  });

  it('never starts, ends or doubles a separator, and drops empty groups', () => {
    const menu = moArrangeMenu([{ group: 'organise', label: 'Tag…' }, { group: 'edit', label: 'Edit Image', kinds: ['photo'] }, false, null], ['video']);
    expect(labels(menu)).toEqual(['Tag…']);
    for (const kind of ['photo', 'gif', 'video']) {
      const l = labels(moArrangeMenu(ENTRIES, [kind]));
      expect(l[0]).not.toBe('|');
      expect(l.at(-1)).not.toBe('|');
      expect(l.join(',')).not.toContain('|,|');
    }
  });

  it('strips its own fields from the items it returns', () => {
    const [first] = moArrangeMenu([{ group: 'open', kinds: ['photo'], label: 'View Full Size', handler: () => {} }], ['photo']);
    expect(first).not.toHaveProperty('group');
    expect(first).not.toHaveProperty('kinds');
    expect(first).toHaveProperty('handler');
  });
});
