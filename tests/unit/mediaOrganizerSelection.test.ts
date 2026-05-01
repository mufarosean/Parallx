/**
 * Unit tests for the Media Organizer grid selection logic.
 *
 * The extension is a single-file plain JS plugin loaded by Parallx via blob
 * URL, so it cannot be imported as an ES module. We instead read the source
 * and evaluate the pure helper `computeNextSelection`, which the extension
 * exposes on `globalThis.__moComputeNextSelection` for exactly this purpose.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Item = { type: string; id: number };

type ComputeFn = (args: {
  items: Item[];
  clickedItem: Item;
  checked: boolean;
  shiftKey: boolean;
  prevSelectedIds: Set<string>;
  lastClickedKey: string | null;
  focusedIndex: number | null;
}) => { selectedIds: Set<string>; lastClickedKey: string; selecting: boolean };

let compute: ComputeFn;

beforeAll(() => {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  // Pull the function definition by anchoring on the surrounding sentinel
  // comment that precedes the globalThis export, rather than trying to
  // brace-match a body that contains nested `}\n` lines.
  const fnStart = src.indexOf('function computeNextSelection(');
  const tailStart = src.indexOf('// Expose for unit testing in jsdom');
  const tailEnd = src.indexOf('globalThis.__moComputeNextSelection = computeNextSelection;');
  if (fnStart < 0 || tailStart < 0 || tailEnd < 0) {
    throw new Error('computeNextSelection markers not found in main.js');
  }
  const fnSrc = src.slice(fnStart, tailStart);
  const exportSrc = src.slice(tailStart, src.indexOf('}', tailEnd) + 1);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function(fnSrc + '\n' + exportSrc).call(globalThis);
  compute = (globalThis as unknown as { __moComputeNextSelection: ComputeFn }).__moComputeNextSelection;
  if (typeof compute !== 'function') throw new Error('compute helper did not bind to globalThis');
});

const items: Item[] = [
  { type: 'photo', id: 1 },
  { type: 'photo', id: 2 },
  { type: 'video', id: 3 },
  { type: 'photo', id: 4 },
  { type: 'photo', id: 5 },
];

const k = (i: Item) => `${i.type}:${i.id}`;

describe('computeNextSelection', () => {
  it('plain click adds to selection and updates lastClickedKey', () => {
    const r = compute({
      items,
      clickedItem: items[2],
      checked: true,
      shiftKey: false,
      prevSelectedIds: new Set(),
      lastClickedKey: null,
      focusedIndex: null,
    });
    expect([...r.selectedIds]).toEqual(['video:3']);
    expect(r.lastClickedKey).toBe('video:3');
    expect(r.selecting).toBe(true);
  });

  it('plain click with checked=false removes from selection', () => {
    const r = compute({
      items,
      clickedItem: items[2],
      checked: false,
      shiftKey: false,
      prevSelectedIds: new Set(['video:3', 'photo:1']),
      lastClickedKey: 'video:3',
      focusedIndex: null,
    });
    expect([...r.selectedIds].sort()).toEqual(['photo:1']);
    expect(r.selecting).toBe(true);
  });

  it('shift-click extends range from anchor to clicked item (forward)', () => {
    // Anchor = photo:1 (index 0), click = photo:4 (index 3). Range covers 4 items.
    const r = compute({
      items,
      clickedItem: items[3],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set([k(items[0])]),
      lastClickedKey: k(items[0]),
      focusedIndex: 0,
    });
    expect([...r.selectedIds].sort()).toEqual(
      ['photo:1', 'photo:2', 'photo:4', 'video:3'].sort()
    );
    expect(r.lastClickedKey).toBe('photo:4');
  });

  it('shift-click extends range backwards', () => {
    const r = compute({
      items,
      clickedItem: items[1],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set([k(items[4])]),
      lastClickedKey: k(items[4]),
      focusedIndex: 4,
    });
    expect([...r.selectedIds].sort()).toEqual(
      ['photo:2', 'photo:4', 'photo:5', 'video:3'].sort()
    );
  });

  it('shift-click without prior anchor falls back to focusedIndex', () => {
    // No lastClickedKey, but the user has focused photo:2 (index 1) via
    // an arrow-key navigation. Shift-clicking video:3 (index 2) should
    // form the range [1..2].
    const r = compute({
      items,
      clickedItem: items[2],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(),
      lastClickedKey: null,
      focusedIndex: 1,
    });
    expect([...r.selectedIds].sort()).toEqual(['photo:2', 'video:3'].sort());
  });

  it('shift-click without prior anchor or focus falls back to first item', () => {
    // First user action of the session is a shift-click on the third card.
    const r = compute({
      items,
      clickedItem: items[2],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(),
      lastClickedKey: null,
      focusedIndex: null,
    });
    expect([...r.selectedIds].sort()).toEqual(['photo:1', 'photo:2', 'video:3'].sort());
  });

  it('shift-click with stale anchor (anchor not in current items) recovers via focus', () => {
    // User clicked photo:99 on a previous page, then changed pages; the
    // anchor key still points to photo:99 but it is no longer in `items`.
    // Without recovery, the shift-click would silently degrade to a single
    // toggle. With recovery, focusedIndex picks up.
    const r = compute({
      items,
      clickedItem: items[3],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(),
      lastClickedKey: 'photo:99',
      focusedIndex: 1,
    });
    expect([...r.selectedIds].sort()).toEqual(['photo:2', 'photo:4', 'video:3'].sort());
  });

  it('shift-click preserves prior selection (additive)', () => {
    // User had photo:5 selected from elsewhere; shift-click on a range
    // should add the range without dropping photo:5.
    const r = compute({
      items,
      clickedItem: items[2],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(['photo:5']),
      lastClickedKey: k(items[0]),
      focusedIndex: 0,
    });
    expect([...r.selectedIds].sort()).toEqual(['photo:1', 'photo:2', 'photo:5', 'video:3'].sort());
  });

  it('shift-click on the same item as the anchor selects just that item', () => {
    const r = compute({
      items,
      clickedItem: items[2],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(),
      lastClickedKey: k(items[2]),
      focusedIndex: 2,
    });
    expect([...r.selectedIds]).toEqual(['video:3']);
  });

  it('empty grid: shift-click is a no-op (no anchor to derive)', () => {
    const r = compute({
      items: [],
      clickedItem: { type: 'photo', id: 99 },
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(),
      lastClickedKey: null,
      focusedIndex: null,
    });
    // Falls through to the "no anchor" branch and at least toggles the
    // clicked key on, so the user gets some feedback.
    expect([...r.selectedIds]).toEqual(['photo:99']);
  });

  it('lastClickedKey is updated to the clicked item even when shift-click', () => {
    // So the next shift-click forms a range from THIS click, not the
    // previous one.
    const r = compute({
      items,
      clickedItem: items[3],
      checked: true,
      shiftKey: true,
      prevSelectedIds: new Set(),
      lastClickedKey: k(items[0]),
      focusedIndex: 0,
    });
    expect(r.lastClickedKey).toBe('photo:4');
  });
});
