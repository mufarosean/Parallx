// The slash menu's trigger rule and search: "/" opens at the start of a line
// or after a space, never right after another character; a search finds an
// exact name or alias first, then a prefix, then a substring.
import { describe, it, expect } from 'vitest';
import { findSlashTrigger, rankSlashItems, slashMatchScore, slashQueryAlive } from '../../src/built-in/canvas/menus/slashMenuQuery';
import { buildSlashMenuItems } from '../../src/built-in/canvas/menus/slashMenuItems';
import { getSlashMenuBlocks } from '../../src/built-in/canvas/config/blockRegistry';

const ITEMS = buildSlashMenuItems(getSlashMenuBlocks());
const top = (q: string) => rankSlashItems(ITEMS, q)[0]?.blockId;

describe('slash trigger rule', () => {
  it('opens at the start of a line', () => {
    expect(findSlashTrigger('/')).toEqual({ offset: 0, query: '' });
    expect(findSlashTrigger('/h1')).toEqual({ offset: 0, query: 'h1' });
  });

  it('opens after a space mid-line', () => {
    expect(findSlashTrigger('Some text /')).toEqual({ offset: 10, query: '' });
    expect(findSlashTrigger('Some text /tod')).toEqual({ offset: 10, query: 'tod' });
    expect(findSlashTrigger('tab\t/code')).toEqual({ offset: 4, query: 'code' });
    expect(findSlashTrigger('line\n/quote')).toEqual({ offset: 5, query: 'quote' });
  });

  it('does not open right after a non-space character', () => {
    expect(findSlashTrigger('and/')).toBeNull();
    expect(findSlashTrigger('and/or')).toBeNull();
    expect(findSlashTrigger('see https://example.com/a')).toBeNull();
    expect(findSlashTrigger('due 10/30')).toBeNull();
    expect(findSlashTrigger('x￼/h1')).toBeNull(); // right after an inline object
  });

  it('reads the last "/" before the caret', () => {
    expect(findSlashTrigger('and/or /h2')).toEqual({ offset: 7, query: 'h2' });
    expect(findSlashTrigger('/h1 and/or')).toBeNull();
  });

  it('does not open for a "/" followed by a space, or a long run of text', () => {
    expect(findSlashTrigger('a / b')).toBeNull();
    expect(findSlashTrigger('/' + 'x'.repeat(41))).toBeNull();
  });

  it('a query with a space stays open while its words find something', () => {
    expect(slashQueryAlive(ITEMS, 'heading 1')).toBe(true);
    expect(slashQueryAlive(ITEMS, 'to do')).toBe(true);
    expect(slashQueryAlive(ITEMS, 'xyzzy and')).toBe(false);
    expect(slashQueryAlive(ITEMS, 'xyzzy')).toBe(true); // no space yet: the menu just shows nothing
  });
});

describe('slash aliases', () => {
  it.each([
    ['h1', 'heading-1'], ['title', 'heading-1'], ['#', 'heading-1'],
    ['h2', 'heading-2'], ['h3', 'heading-3'],
    ['ul', 'bulletList'], ['bullet', 'bulletList'], ['-', 'bulletList'],
    ['ol', 'orderedList'], ['1.', 'orderedList'],
    ['todo', 'taskList'], ['checkbox', 'taskList'], ['[]', 'taskList'],
    ['blockquote', 'blockquote'], ['>', 'blockquote'],
    ['```', 'codeBlock'], ['snippet', 'codeBlock'],
    ['hr', 'horizontalRule'], ['---', 'horizontalRule'], ['line', 'horizontalRule'],
    ['grid', 'table'],
    ['note', 'callout'], ['info', 'callout'],
    ['latex', 'mathBlock'], ['equation', 'mathBlock'],
    ['picture', 'image'], ['photo', 'image'],
    ['text', 'paragraph'],
  ])('/%s finds %s first', (query, blockId) => {
    expect(top(query)).toBe(blockId);
  });

  it('a block a tool contributes is found by its own aliases', () => {
    const items = buildSlashMenuItems([
      ...getSlashMenuBlocks(),
      { id: 'tool:acme.gallery', label: 'Media Gallery', icon: 'image', slashMenu: { description: 'A grid of pictures', category: 'tools', aliases: ['album', 'carousel'] } },
    ]);
    expect(rankSlashItems(items, 'carousel')[0]?.blockId).toBe('tool:acme.gallery');
    expect(rankSlashItems(items, 'album')[0]?.blockId).toBe('tool:acme.gallery');
  });

  it('ignores aliases that are not strings', () => {
    const items = buildSlashMenuItems([
      { id: 'x', label: 'Thing', icon: 'image', slashMenu: { description: 'd', aliases: [42 as unknown as string, 'widget'] } },
    ]);
    expect(items[0].aliases).toEqual(['widget']);
    expect(rankSlashItems(items, 'widget')).toHaveLength(1);
  });
});

describe('slash ranking', () => {
  const items = [
    { label: 'Tablet Notes', description: 'contains "table" in its name' },
    { label: 'Stable Thing', description: 'contains table mid-word' },
    { label: 'Other', description: 'talks about a table' },
    { label: 'Table', description: 'the exact one' },
    { label: 'Unrelated', description: 'nothing here' },
    { label: 'Grid', description: 'found by alias', aliases: ['tab'] },
  ];

  it('exact name or alias first, then prefix, then substring, then description', () => {
    expect(rankSlashItems(items, 'table').map((i) => i.label)).toEqual(['Table', 'Tablet Notes', 'Stable Thing', 'Other']);
    expect(rankSlashItems(items, 'tab').map((i) => i.label)).toEqual(['Grid', 'Tablet Notes', 'Table', 'Stable Thing', 'Other']);
  });

  it('scores each tier', () => {
    expect(slashMatchScore(items[3], 'table')).toBe(0);
    expect(slashMatchScore(items[0], 'table')).toBe(1);
    expect(slashMatchScore(items[1], 'table')).toBe(2);
    expect(slashMatchScore(items[2], 'table')).toBe(3);
    expect(slashMatchScore(items[4], 'table')).toBe(4);
  });

  it('a word of a name counts as a prefix ("list" before a description match)', () => {
    const ranked = rankSlashItems(ITEMS, 'list').map((i) => i.blockId);
    const firstDescriptionOnly = ranked.findIndex((id) => !ITEMS.find((i) => i.blockId === id)!.label.toLowerCase().includes('list'));
    expect(ranked.slice(0, 4).sort()).toEqual(['bulletList', 'details', 'orderedList', 'taskList']);
    expect(firstDescriptionOnly === -1 || firstDescriptionOnly >= 4).toBe(true);
  });

  it('ties keep the menu order; nothing typed keeps every item in order', () => {
    expect(rankSlashItems(ITEMS, '').map((i) => i.blockId)).toEqual(ITEMS.map((i) => i.blockId));
    const headings = rankSlashItems(ITEMS, 'heading').map((i) => i.blockId);
    expect(headings.slice(0, 3)).toEqual(['heading-1', 'heading-2', 'heading-3']);
  });

  it('matches across spaces and dashes ("to do", "heading 2")', () => {
    expect(top('to do')).toBe('taskList');
    expect(top('heading 2')).toBe('heading-2');
  });

  it('empty query leads with text blocks, pages near the end', () => {
    const ids = rankSlashItems(ITEMS, '').map((i) => i.blockId);
    expect(ids[0]).toBe('paragraph');
    expect(ids.indexOf('pageBlock')).toBeGreaterThan(ids.indexOf('callout'));
    expect(ids.indexOf('database')).toBeGreaterThan(ids.indexOf('bulletList'));
  });
});
