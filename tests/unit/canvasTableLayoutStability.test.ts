// canvasTableLayoutStability.test.ts — hover chrome must never move the table.
//
// The bug this pins (user report, 2026-08-27: "when I hover a column edge the
// table flickers, it moves"):
//
//   `.tableWrapper` is `overflow-x: auto`.  Per CSS Overflow, a box whose
//   overflow-x is not `visible` computes a `visible` overflow-y to `auto`, so
//   the wrapper is a scroll container on BOTH axes.  This app's scrollbars are
//   classic, not overlay — `::-webkit-scrollbar { width: 10px; height: 10px }`
//   in workbench.css — so a scrollbar that appears takes 10px of layout.
//
//   prosemirror-tables injects `.column-resize-handle` INSIDE the cells of the
//   hovered column and removes it on mouseout.  It was positioned at
//   `right: -2px; bottom: -2px`, so the last row's handles spilled below the
//   table and the last column's spilled past its right edge.  Two pixels of
//   scrollable overflow → a 10px scrollbar → a `width: 100%` table reflowed
//   narrower → the table jumped, and jumped back when the pointer left.
//
// jsdom has no layout, so this is asserted where the defect actually lives:
// in the declarations.  THE RULE: chrome that appears on hover must stay
// inside its cell's border box, and the table must clip regardless.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(
  resolve(__dirname, '../../src/built-in/canvas/canvas.css'),
  'utf-8',
);

/**
 * The declaration body of the first rule whose selector text contains `sel`.
 * `sel` is matched as a single-line substring so the check is indifferent to
 * the file's line endings and to how a selector list is wrapped.
 */
function ruleBody(sel: string): string {
  const idx = CSS.indexOf(sel);
  expect(idx, `selector not found in canvas.css: ${sel}`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('}', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return CSS.slice(open + 1, close);
}

/** Negative `top/right/bottom/left/inset` values — the overflow makers. */
function negativeOffsets(body: string): string[] {
  const found: string[] = [];
  const re = /(^|[;{\s])(top|right|bottom|left|inset)\s*:\s*(-[^;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.push(`${m[2]}: ${m[3].trim()}`);
  return found;
}

describe('table hover chrome is layout-neutral', () => {
  it('the column resize handle never spills outside its cell', () => {
    const body = ruleBody('.canvas-tiptap-editor .column-resize-handle');
    expect(negativeOffsets(body)).toEqual([]);
  });

  it('the resize handle stays out of flow', () => {
    const body = ruleBody('.canvas-tiptap-editor .column-resize-handle');
    expect(body).toMatch(/position\s*:\s*absolute/);
  });

  // THE load-bearing guard.  Left at its initial `visible`, overflow-y
  // computes to `auto` (because overflow-x isn't `visible`), and a vertical
  // scrollbar steals 10px of WIDTH from a `width: 100%` table — a horizontal
  // jump caused by a vertical scrollbar.  A table wrapper never needs to
  // scroll vertically, so the axis stays pinned closed.
  it('the table wrapper cannot grow a vertical scrollbar', () => {
    const body = ruleBody('.canvas-tiptap-editor .tableWrapper {');
    expect(body).toMatch(/overflow-x\s*:\s*auto/);
    expect(body).toMatch(/overflow-y\s*:\s*hidden/);
  });

  // Intent, not a guarantee: Chromium doesn't clip a `border-collapse: collapse`
  // table box.  Still worth keeping, and worth noticing if it disappears again.
  it('the table still declares its own clip', () => {
    const body = ruleBody('.canvas-tiptap-editor table {');
    expect(body).toMatch(/overflow\s*:\s*hidden/);
  });

  // THE actual cause of the reported jump.  prosemirror-tables appends its
  // resize-handle widget as the cell's last child on hover, which takes
  // `:last-child` away from the real last block — it gets its bottom margin
  // back, in every row of that column at once, and the table grows ~2px per
  // row until the pointer moves away.  The reset must not depend on DOM order.
  it('the cell bottom-margin reset survives a widget being appended', () => {
    const idx = CSS.indexOf('.canvas-tiptap-editor table td > *:last-child');
    expect(idx, 'cell margin reset rule not found').toBeGreaterThan(-1);
    const selectorList = CSS.slice(idx, CSS.indexOf('{', idx));
    expect(selectorList).toContain(':has(+ .ProseMirror-widget)');
  });

  // An outline paints outside the border box and counts toward the scrollable
  // overflow of the editor wrapper; a spread shadow looks the same and doesn't.
  it('the table selection ring uses box-shadow, not outline', () => {
    const body = ruleBody('.canvas-tiptap-editor .tableWrapper.ProseMirror-selectednode');
    expect(body).toMatch(/box-shadow\s*:/);
    expect(body).not.toMatch(/outline\s*:\s*\d/);
    expect(body).not.toMatch(/outline-offset/);
  });

  // The selected-cell wash is the other per-cell overlay; `inset: 0` keeps it
  // exactly on the cell.  Same rule, same reason.
  it('the selected-cell wash stays inside the cell', () => {
    const body = ruleBody('.canvas-tiptap-editor table .selectedCell::after');
    expect(body).toMatch(/inset\s*:\s*0/);
    expect(negativeOffsets(body)).toEqual([]);
  });
});
