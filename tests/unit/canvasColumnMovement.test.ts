// @vitest-environment jsdom
//
// canvasColumnMovement.test.ts — column + list movement semantics on a REAL
// editor (StarterKit v3 + Column/ColumnList + MathBlock, matching the app's
// extension set with dropcursor disabled).
//
// Pins the three failure classes from the 2026-07-18 report ("block movement
// is still finicky"):
//   1. A non-list block (equation, paragraph) dropped BETWEEN list rows must
//      land at that gap (splitting the list) — the drop plugin used to
//      teleport it to the whole list's edge while the guide showed the gap.
//   2. Moving blocks between / into / out of columns must clean up emptied
//      columns and dissolve single-column layouts with no ghost structure.
//   3. Backspace/Delete at a columnList boundary must never node-select the
//      whole layout (one more keystroke used to delete every column), and an
//      empty first block inside a column must be deletable.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Column, ColumnList } from '../../src/built-in/canvas/extensions/columnNodes';
import { MathBlock } from '../../src/built-in/canvas/extensions/mathBlockNode';
import { moveBlockAboveBelow } from '../../src/built-in/canvas/config/blockStateRegistry/blockMovement';
import { deleteDraggedSource } from '../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';
import {
  createColumnLayoutFromDrop,
  addColumnToLayoutFromDrop,
} from '../../src/built-in/canvas/config/blockStateRegistry/columnCreation';
import { getZone } from '../../src/built-in/canvas/plugins/columnDropPlugin';

// ── Harness ────────────────────────────────────────────────────────────────

// The real Column's content expression enumerates every registry block type
// (image, video, table, …) — pulling all of those extensions in here would
// drag the whole registry into the harness. Relax ONLY the content
// expression; keymaps, isolating, and attrs are inherited from the real
// nodes, which is what these tests exercise.
const TestColumn = Column.extend({ content: 'block+' });

function makeEditor(content: Record<string, any>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ dropcursor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TestColumn,
      ColumnList,
      MathBlock,
    ],
    content,
  });
}

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function pEmpty() { return { type: 'paragraph' }; }
function li(text: string) { return { type: 'listItem', content: [p(text)] }; }
function col(...blocks: any[]) { return { type: 'column', content: blocks }; }
function columns(...cols: any[]) { return { type: 'columnList', content: cols }; }
function math(latex: string) { return { type: 'mathBlock', attrs: { latex } }; }

/** All text runs + mathBlock latex, in document order. */
function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) out.push(n.text);
    if (n.type.name === 'mathBlock' && n.attrs?.latex) out.push(String(n.attrs.latex));
    return true;
  });
  return out;
}

/** Top-level node types minus the TrailingNode artifact. */
function topTypes(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.forEach((n) => out.push(n.type.name));
  const last = ed.state.doc.child(ed.state.doc.childCount - 1);
  if (out.length > 1 && last.type.name === 'paragraph' && last.content.size === 0) out.pop();
  return out;
}

/** First node of the given type (optionally matching text) with its pos. */
function findBlock(ed: Editor, typeName: string, text?: string): { pos: number; node: any } {
  let found: { pos: number; node: any } | null = null;
  ed.state.doc.descendants((n, pos) => {
    if (found) return false;
    if (n.type.name === typeName && (text === undefined || n.textContent === text)) {
      found = { pos, node: n };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`block not found: ${typeName}${text ? ` "${text}"` : ''}`);
  return found;
}

function columnListNode(ed: Editor): { pos: number; node: any } {
  return findBlock(ed, 'columnList');
}

/** Column shape as text arrays: one entry per column, blocks joined by '|'. */
function columnShape(ed: Editor): string[][] {
  const { node } = columnListNode(ed);
  const shape: string[][] = [];
  node.forEach((c: any) => {
    const blocks: string[] = [];
    c.forEach((b: any) => {
      blocks.push(b.type.name === 'mathBlock' ? String(b.attrs?.latex ?? '') : b.textContent);
    });
    shape.push(blocks);
  });
  return shape;
}

function expectNoGhostRows(ed: Editor): void {
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'listItem' || n.type.name === 'taskItem') {
      expect(n.textContent.length, 'ghost empty row found').toBeGreaterThan(0);
    }
    return true;
  });
}

/** Put the cursor at an absolute position. */
function setCursor(ed: Editor, pos: number): void {
  const tr = ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos));
  ed.view.dispatch(tr);
}

/** Dispatch a real keydown through the view (keymap plugins + base chain). */
function pressKey(ed: Editor, key: string): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Simulate the drop handler's above/below path for NON-list dragged content. */
function dropAt(ed: Editor, content: Fragment, insertPos: number, dragFrom: number, dragTo: number): void {
  const { tr } = ed.state;
  moveBlockAboveBelow(tr, content, insertPos, dragFrom, dragTo, false);
  ed.view.dispatch(tr);
}

function fragmentOf(ed: Editor, json: any): Fragment {
  return Fragment.from(ed.state.schema.nodeFromJSON(json));
}

// ── 1. Non-list blocks land AT the aimed row gap ───────────────────────────

describe('equation/paragraph dropped between list rows lands at the gap', () => {
  it('mathBlock dropped above row "three" splits the list there', () => {
    const ed = makeEditor({ type: 'doc', content: [
      math('E = mc^2'),
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
    ]});
    const src = findBlock(ed, 'mathBlock');
    const target = findBlock(ed, 'listItem', 'three');
    dropAt(ed, fragmentOf(ed, math('E = mc^2')), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(topTypes(ed)).toEqual(['bulletList', 'mathBlock', 'bulletList']);
    expect(allText(ed)).toEqual(['one', 'two', 'E = mc^2', 'three']);
    expectNoGhostRows(ed);
  });

  it('mathBlock dropped below the LAST row appends after the list (no split)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      math('a^2+b^2'),
      { type: 'bulletList', content: [li('one'), li('two')] },
    ]});
    const src = findBlock(ed, 'mathBlock');
    const target = findBlock(ed, 'listItem', 'two');
    dropAt(ed, fragmentOf(ed, math('a^2+b^2')), target.pos + target.node.nodeSize, src.pos, src.pos + src.node.nodeSize);

    expect(topTypes(ed)).toEqual(['bulletList', 'mathBlock']);
    expect(allText(ed)).toEqual(['one', 'two', 'a^2+b^2']);
  });

  it('mathBlock dropped between rows INSIDE a column splits the in-column list', () => {
    const ed = makeEditor({ type: 'doc', content: [
      math('\\alpha'),
      columns(
        col({ type: 'bulletList', content: [li('one'), li('two')] }),
        col(p('right')),
      ),
    ]});
    const src = findBlock(ed, 'mathBlock');
    const target = findBlock(ed, 'listItem', 'two');
    dropAt(ed, fragmentOf(ed, math('\\alpha')), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(columnShape(ed)).toEqual([['one', '\\alpha', 'two'], ['right']]);
    expectNoGhostRows(ed);
  });
});

// ── getZone: row targets keep above/below for the gap, edges go to the list ─

describe('getZone drop-zone math', () => {
  function stubEl(rect: Partial<DOMRect>): HTMLElement {
    const el = document.createElement('div');
    (el as any).getBoundingClientRect = () => ({
      left: 0, top: 0, width: 600, height: 40, right: 600, bottom: 40, x: 0, y: 0,
      toJSON() { return this; },
      ...rect,
    });
    return el;
  }

  it('edge strips resolve left/right on plain blocks', () => {
    const el = stubEl({});
    expect(getZone(el, 10, 20, false, false)).toBe('left');
    expect(getZone(el, 590, 20, false, false)).toBe('right');
  });

  it('center resolves above/below by Y midpoint', () => {
    const el = stubEl({});
    expect(getZone(el, 300, 5, false, false)).toBe('above');
    expect(getZone(el, 300, 35, false, false)).toBe('below');
  });

  it('list-item targets never resolve left/right', () => {
    const el = stubEl({});
    expect(getZone(el, 10, 5, false, true)).toBe('above');
    expect(getZone(el, 590, 35, false, true)).toBe('below');
  });
});

// ── 2. Column movement invariants ──────────────────────────────────────────

describe('column movement', () => {
  it('reordering within a column keeps the layout intact', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('x'), p('y')), col(p('b'))),
    ]});
    const src = findBlock(ed, 'paragraph', 'y');
    const target = findBlock(ed, 'paragraph', 'x');
    dropAt(ed, fragmentOf(ed, p('y')), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(columnShape(ed)).toEqual([['y', 'x'], ['b']]);
  });

  it('transferring a block into a sibling column keeps both columns', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1'), p('a2')), col(p('b1'))),
    ]});
    const src = findBlock(ed, 'paragraph', 'a1');
    const target = findBlock(ed, 'paragraph', 'b1');
    dropAt(ed, fragmentOf(ed, p('a1')), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(columnShape(ed)).toEqual([['a2'], ['a1', 'b1']]);
  });

  it('moving the ONLY block of a column into the sibling column dissolves the layout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1')), col(p('b1'))),
    ]});
    const src = findBlock(ed, 'paragraph', 'a1');
    const target = findBlock(ed, 'paragraph', 'b1');
    dropAt(ed, fragmentOf(ed, p('a1')), target.pos, src.pos, src.pos + src.node.nodeSize);

    // Source column emptied → deleted; one column left → whole layout dissolves.
    expect(topTypes(ed)).toEqual(['paragraph', 'paragraph']);
    expect(allText(ed)).toEqual(['a1', 'b1']);
  });

  it('moving the ONLY block of a column out to top level dissolves the layout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1')), col(p('b1'))),
      p('after'),
    ]});
    const src = findBlock(ed, 'paragraph', 'a1');
    const target = findBlock(ed, 'paragraph', 'after');
    dropAt(ed, fragmentOf(ed, p('a1')), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(topTypes(ed)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(allText(ed)).toEqual(['b1', 'a1', 'after']);
  });

  it('side-drop on a column block adds a column and splits the target width', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1')), col(p('b1'))),
      p('drag'),
    ]});
    const src = findBlock(ed, 'paragraph', 'drag');
    const cl = columnListNode(ed);
    // Right of column B: columnPos = second column.
    let colBPos = cl.pos + 1 + cl.node.child(0).nodeSize;
    const { tr } = ed.state;
    const ok = addColumnToLayoutFromDrop(
      tr, ed.state.doc, ed.state.schema, fragmentOf(ed, p('drag')),
      colBPos, cl.pos, 'right', src.pos, src.pos + src.node.nodeSize, false,
    );
    expect(ok).toBe(true);
    ed.view.dispatch(tr);

    expect(columnShape(ed)).toEqual([['a1'], ['b1'], ['drag']]);
    const after = columnListNode(ed).node;
    // Target and new column split the target's effective 50% share.
    expect(after.child(1).attrs.width).toBe(25);
    expect(after.child(2).attrs.width).toBe(25);
  });

  it('side-drop creating a NEW layout from a mathBlock works', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('target'),
      math('\\int_0^1'),
    ]});
    const src = findBlock(ed, 'mathBlock');
    const target = findBlock(ed, 'paragraph', 'target');
    const { tr } = ed.state;
    const ok = createColumnLayoutFromDrop(
      tr, ed.state.schema, fragmentOf(ed, math('\\int_0^1')),
      target.pos, target.node, 'right', src.pos, src.pos + src.node.nodeSize, false,
    );
    expect(ok).toBe(true);
    ed.view.dispatch(tr);

    expect(topTypes(ed)).toEqual(['columnList']);
    expect(columnShape(ed)).toEqual([['target'], ['\\int_0^1']]);
  });

  it('dragging the only block of a column to the side of the sibling keeps a 2-column layout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1')), col(p('b1'))),
    ]});
    const src = findBlock(ed, 'paragraph', 'a1');
    const cl = columnListNode(ed);
    const colBPos = cl.pos + 1 + cl.node.child(0).nodeSize;
    const { tr } = ed.state;
    const ok = addColumnToLayoutFromDrop(
      tr, ed.state.doc, ed.state.schema, fragmentOf(ed, p('a1')),
      colBPos, cl.pos, 'right', src.pos, src.pos + src.node.nodeSize, false,
    );
    expect(ok).toBe(true);
    ed.view.dispatch(tr);

    expect(topTypes(ed)).toEqual(['columnList']);
    expect(columnShape(ed)).toEqual([['b1'], ['a1']]);
  });
});

// ── 3. Backspace / Delete at column boundaries ─────────────────────────────

describe('backspace/delete at columnList boundaries', () => {
  it('Backspace at start of the block BELOW a layout enters the last column (never node-selects the layout)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1')), col(p('b1'))),
      p('after'),
    ]});
    const after = findBlock(ed, 'paragraph', 'after');
    setCursor(ed, after.pos + 1);
    const before = ed.state.doc.toJSON();

    pressKey(ed, 'Backspace');

    // Layout intact, nothing deleted.
    expect(ed.state.doc.toJSON()).toEqual(before);
    // Cursor entered the layout instead of node-selecting it.
    expect(ed.state.selection).toBeInstanceOf(TextSelection);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
    const cl = columnListNode(ed);
    expect(ed.state.selection.head).toBeGreaterThan(cl.pos);
    expect(ed.state.selection.head).toBeLessThan(cl.pos + cl.node.nodeSize);
    // Specifically: end of the LAST column's last textblock.
    const b1 = findBlock(ed, 'paragraph', 'b1');
    expect(ed.state.selection.head).toBe(b1.pos + 1 + b1.node.content.size);
  });

  it('Backspace in an EMPTY block below a layout deletes it and enters the last column', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('a1')), col(p('b1'))),
      pEmpty(),
      p('tail'),
    ]});
    const cl = columnListNode(ed);
    setCursor(ed, cl.pos + cl.node.nodeSize + 1);

    pressKey(ed, 'Backspace');

    expect(topTypes(ed)).toEqual(['columnList', 'paragraph']);
    expect(allText(ed)).toEqual(['a1', 'b1', 'tail']);
    expect(ed.state.selection).toBeInstanceOf(TextSelection);
    const b1 = findBlock(ed, 'paragraph', 'b1');
    expect(ed.state.selection.head).toBe(b1.pos + 1 + b1.node.content.size);
  });

  it('Backspace deletes an empty first block inside a column with more content', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(pEmpty(), p('rest')), col(p('b1'))),
    ]});
    const cl = columnListNode(ed);
    // Cursor inside the empty paragraph: columnList+1 → column, +1 → paragraph, +1 → inside.
    setCursor(ed, cl.pos + 3);

    pressKey(ed, 'Backspace');

    expect(columnShape(ed)).toEqual([['rest'], ['b1']]);
  });

  it('Backspace at start of a NON-empty first column block is a guarded no-op', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(p('keep'), p('rest')), col(p('b1'))),
    ]});
    const keep = findBlock(ed, 'paragraph', 'keep');
    setCursor(ed, keep.pos + 1);
    const before = ed.state.doc.toJSON();

    pressKey(ed, 'Backspace');

    expect(ed.state.doc.toJSON()).toEqual(before);
    expect(columnShape(ed)).toEqual([['keep', 'rest'], ['b1']]);
  });

  it('Backspace in the only (empty) block of a column removes the column and dissolves', () => {
    const ed = makeEditor({ type: 'doc', content: [
      columns(col(pEmpty()), col(p('b1'))),
    ]});
    const cl = columnListNode(ed);
    setCursor(ed, cl.pos + 3);

    pressKey(ed, 'Backspace');

    expect(topTypes(ed)).toEqual(['paragraph']);
    expect(allText(ed)).toEqual(['b1']);
  });

  it('Delete at end of the block ABOVE a layout enters the first column (never node-selects the layout)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('before'),
      columns(col(p('a1')), col(p('b1'))),
    ]});
    const beforeBlock = findBlock(ed, 'paragraph', 'before');
    setCursor(ed, beforeBlock.pos + 1 + beforeBlock.node.content.size);
    const snapshot = ed.state.doc.toJSON();

    pressKey(ed, 'Delete');

    expect(ed.state.doc.toJSON()).toEqual(snapshot);
    expect(ed.state.selection).toBeInstanceOf(TextSelection);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
    const a1 = findBlock(ed, 'paragraph', 'a1');
    expect(ed.state.selection.head).toBe(a1.pos + 1);
  });
});
