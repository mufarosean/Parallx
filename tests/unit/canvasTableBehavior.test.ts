// @vitest-environment jsdom
//
// canvasTableBehavior.test.ts — behavioural pins for canvas tables, against a
// REAL headless editor carrying the real extension set.
//
// Written 2026-08-27 from four user-reported symptoms, each reproduced here
// before it was fixed:
//
//   1. "Backspace inside a cell affects things other than that cell."
//      Three separate paths did: Shift+Arrow bootstrapped a BLOCK selection
//      covering the table and its neighbour above; Escape block-selected the
//      table; Ctrl+A selected the whole DOCUMENT.  A following Backspace then
//      deleted whatever those had grabbed.
//   2. "No way to add rows or columns."  There was none — only Tab in the
//      last cell.  tableOps.ts is now the single vocabulary behind the grips,
//      the grip menu and the keyboard.
//   3. "Moving a table leaves an orphaned empty table behind."  The drag slice
//      came from `selection.content()`, and prosemirror-tables had rewritten
//      the table NodeSelection into a cell selection whose content() is an
//      OPEN slice; columnDropPlugin's closed-slice guard bailed, ProseMirror's
//      fallback drop move-deleted with `tr.deleteSelection()` — which on a
//      cell selection empties the cells and KEEPS the table.
//   4. Structural edits had no guards: nothing stopped a duplicate from
//      corrupting the table map, or a row from being moved above the header.
//
// THE INVARIANT this file exists to hold: a keystroke aimed at a cell changes
// that cell (or that row), never the document around the table.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createLowlight, common } from 'lowlight';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { Fragment, Slice } from '@tiptap/pm/model';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { BlockSelectionController } from '../../src/built-in/canvas/handles/blockSelection';
import {
  appendColumn,
  appendRow,
  clearSelectedCells,
  duplicateColumn,
  duplicateRow,
  moveRowBy,
  selectTableRow,
  tableFrameAt,
  toggleHeaderRowOp,
} from '../../src/built-in/canvas/config/blockStateRegistry/tableOps';
import { moveBlockAboveBelow } from '../../src/built-in/canvas/config/blockStateRegistry/blockMovement';
import { resolveBlockUnitFromDOM } from '../../src/built-in/canvas/config/blockStateRegistry/blockUnit';

const lowlight = createLowlight(common);

// jsdom implements no layout, so `Range.getClientRects` — which ProseMirror
// calls through `view.endOfTextblock` — simply isn't there.  prosemirror-tables
// reaches it on every arrow key inside a cell (that fall-through is the whole
// point of the stand-down rule below), and the throw surfaces as an *unhandled*
// error because jsdom swallows listener exceptions.  Zero-rect stubs make the
// measurement return "unknown", which is the correct answer for a headless DOM.
const RangeProto = (globalThis as any).Range?.prototype;
if (RangeProto && typeof RangeProto.getClientRects !== 'function') {
  RangeProto.getClientRects = () => [] as unknown as DOMRectList;
  RangeProto.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function p(text?: string) {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}
function cell(...kids: any[]) { return { type: 'tableCell', content: kids.length ? kids : [p()] }; }
function hcell(text?: string) { return { type: 'tableHeader', content: [p(text)] }; }
function row(...cells: any[]) { return { type: 'tableRow', content: cells }; }

/** paragraph BEFORE · 3×2 table (header + two body rows) · paragraph AFTER */
const DOC = () => ({ type: 'doc', content: [
  p('BEFORE'),
  { type: 'table', content: [
    row(hcell('h1'), hcell('h2')),
    row(cell(p('a1')), cell(p('a2'))),
    row(cell(p('b1')), cell(p('b2'))),
  ] },
  p('AFTER'),
] });

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * A real editor with the real extension set AND the block-selection
 * controller wired exactly as canvasEditorProvider wires it — the block
 * shortcuts are no-ops without that storage, and three of the four bugs
 * lived precisely in the seam between the two.
 */
function makeEditor(content: any = DOC()): { ed: Editor; sel: BlockSelectionController } {
  const ed = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(lowlight, {}),
    content,
  });
  const host: any = {
    editor: ed,
    container: document.createElement('div'),
    editorContainer: document.createElement('div'),
    pageId: 'test',
  };
  const sel = new BlockSelectionController(host);
  sel.setup();
  const kb = (ed.storage as any).blockKeyboardShortcuts;
  kb.selectAtCursor = () => sel.selectAtCursor();
  kb.extendSelectionUp = () => sel.extendSelectionUp();
  kb.extendSelectionDown = () => sel.extendSelectionDown();
  kb.deleteSelected = () => sel.deleteSelected();
  kb.duplicateSelected = () => sel.duplicateSelected();
  kb.moveSelectedUp = () => sel.moveSelectedUp();
  kb.moveSelectedDown = () => sel.moveSelectedDown();
  kb.enterEditFirstSelected = () => sel.enterEditFirstSelected();
  kb.hasSelection = () => sel.hasSelection;
  return { ed, sel };
}

/** Compact structural fingerprint: type(child,…) with textblock text inline. */
function shape(ed: Editor): string {
  function render(n: any): string {
    if (n.isTextblock) return `${n.type.name}"${n.textContent}"`;
    if (n.isAtom) return n.type.name;
    const kids: string[] = [];
    n.forEach((c: any) => kids.push(render(c)));
    return `${n.type.name}(${kids.join(',')})`;
  }
  const kids: string[] = [];
  ed.state.doc.forEach((c: any) => kids.push(render(c)));
  return kids.join(',');
}

/** The table's rows as arrays of cell text — the readable assertion form. */
function grid(ed: Editor): string[][] {
  const out: string[][] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name !== 'table') return true;
    n.forEach((tr) => {
      const cells: string[] = [];
      tr.forEach((c) => cells.push(c.textContent));
      out.push(cells);
    });
    return false;
  });
  return out;
}

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function findText(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.isTextblock && n.textContent === text) { found = pos; return false; }
    return true;
  });
  if (found < 0) throw new Error(`textblock not found: ${text}`);
  return found;
}
function cursorAtStart(ed: Editor, text: string): void {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, findText(ed, text) + 1)));
}
function cursorAtEnd(ed: Editor, text: string): void {
  ed.view.dispatch(ed.state.tr.setSelection(
    TextSelection.create(ed.state.doc, findText(ed, text) + 1 + text.length),
  ));
}
function tablePos(ed: Editor): number {
  let found = -1;
  ed.state.doc.descendants((n, pos) => {
    if (found < 0 && n.type.name === 'table') { found = pos; return false; }
    return true;
  });
  if (found < 0) throw new Error('no table in doc');
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. A keystroke aimed at a cell never reaches outside it
// ═══════════════════════════════════════════════════════════════════════════

describe('a keystroke in a cell stays in the cell', () => {
  it('Backspace at the start of a body cell does nothing', () => {
    const { ed } = makeEditor();
    cursorAtStart(ed, 'b1');
    const before = shape(ed);
    press(ed, 'Backspace');
    expect(shape(ed)).toBe(before);
  });

  it('Backspace at the start of the first header cell does nothing', () => {
    const { ed } = makeEditor({ type: 'doc', content: [
      { type: 'table', content: [row(hcell('h1'), hcell('h2')), row(cell(p('a1')), cell(p('a2')))] },
      p('AFTER'),
    ] });
    cursorAtStart(ed, 'h1');
    const before = shape(ed);
    press(ed, 'Backspace');
    expect(shape(ed)).toBe(before);
  });

  it('Delete at the end of the last cell does nothing', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'b2');
    const before = shape(ed);
    press(ed, 'Delete');
    expect(shape(ed)).toBe(before);
  });

  // The worst of the four: reachable by pure text-editing muscle memory.
  // It used to block-select the table AND the paragraph above it, and the
  // next Backspace deleted both.  The correct behaviour is prosemirror-tables'
  // — extend the CELL selection, and clear only cells.
  it('Shift+ArrowUp extends the CELL selection, never the block selection', () => {
    const { ed, sel } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'ArrowUp', { shiftKey: true });
    expect(sel.count).toBe(0);
    expect(ed.state.selection).toBeInstanceOf(CellSelection);

    press(ed, 'Backspace');
    // Whatever it cleared, it stayed inside the table: the page around it and
    // the table's own shape are exactly as they were.
    expect(shape(ed).startsWith('paragraph"BEFORE",table(')).toBe(true);
    expect(shape(ed).endsWith('paragraph"AFTER"')).toBe(true);
    expect(grid(ed).map((r) => r.length)).toEqual([2, 2, 2]);
    expect(grid(ed)[2]).toEqual(['b1', 'b2']);
  });

  it('Shift+ArrowDown does not block-select either', () => {
    const { ed, sel } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'ArrowDown', { shiftKey: true });
    expect(sel.count).toBe(0);
  });

  it('Ctrl+A selects the cell text, not the document', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'a', { ctrlKey: true });
    expect(ed.state.selection.constructor.name).toBe('TextSelection');
    press(ed, 'Backspace');
    expect(grid(ed)).toEqual([['h1', 'h2'], ['', 'a2'], ['b1', 'b2']]);
    expect(shape(ed).startsWith('paragraph"BEFORE"')).toBe(true);
    expect(shape(ed).endsWith('paragraph"AFTER"')).toBe(true);
  });

  it('a second Ctrl+A widens to the whole table, a third releases to the page', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'a', { ctrlKey: true });
    press(ed, 'a', { ctrlKey: true });
    expect(ed.state.selection).toBeInstanceOf(CellSelection);
    press(ed, 'a', { ctrlKey: true });
    expect(ed.state.selection.constructor.name).toBe('AllSelection');
  });

  it('Escape selects the cell; Backspace then clears only that cell', () => {
    const { ed, sel } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'Escape');
    expect(ed.state.selection).toBeInstanceOf(CellSelection);
    expect(sel.count).toBe(0);
    press(ed, 'Backspace');
    expect(grid(ed)).toEqual([['h1', 'h2'], ['', 'a2'], ['b1', 'b2']]);
  });

  it('a second Escape steps out to the table as a block', () => {
    const { ed, sel } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'Escape');
    press(ed, 'Escape');
    expect(sel.count).toBe(1);
    expect(sel.positions[0]).toBe(tablePos(ed));
  });

  it('a partial cell selection clears its cells without changing the shape', () => {
    const { ed } = makeEditor();
    const doc = ed.state.doc;
    const from = findText(ed, 'a1') - 1;
    const to = findText(ed, 'a2') - 1;
    ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(doc, from, to) as any));
    press(ed, 'Backspace');
    expect(grid(ed)).toEqual([['h1', 'h2'], ['', ''], ['b1', 'b2']]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Inside a table, the ROW is the unit the block shortcuts act on
// ═══════════════════════════════════════════════════════════════════════════

describe('the row is the movable unit inside a table', () => {
  it('Ctrl+Shift+ArrowDown moves the row, not the table', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'ArrowDown', { ctrlKey: true, shiftKey: true });
    expect(grid(ed)).toEqual([['h1', 'h2'], ['b1', 'b2'], ['a1', 'a2']]);
    // …and the blocks around the table are untouched.
    expect(shape(ed).startsWith('paragraph"BEFORE",table(')).toBe(true);
  });

  it('Ctrl+Shift+ArrowUp will not move a row into the header slot', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'ArrowUp', { ctrlKey: true, shiftKey: true });
    expect(grid(ed)).toEqual([['h1', 'h2'], ['a1', 'a2'], ['b1', 'b2']]);
  });

  it('Ctrl+Shift+ArrowRight moves the column', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'ArrowRight', { ctrlKey: true, shiftKey: true });
    expect(grid(ed)).toEqual([['h2', 'h1'], ['a2', 'a1'], ['b2', 'b1']]);
  });

  it('Ctrl+D duplicates the row, not the table', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'a1');
    press(ed, 'd', { ctrlKey: true });
    expect(grid(ed)).toEqual([['h1', 'h2'], ['a1', 'a2'], ['a1', 'a2'], ['b1', 'b2']]);
    expect(ed.state.doc.content.content.filter((n: any) => n.type.name === 'table')).toHaveLength(1);
  });

  it('duplicating the header row yields a BODY row — a table has one header', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'h1');
    press(ed, 'd', { ctrlKey: true });
    const table = ed.state.doc.nodeAt(tablePos(ed))!;
    const second = table.child(1);
    expect(second.child(0).type.name).toBe('tableCell');
    expect(second.textContent).toBe('h1h2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The drag contract — no orphaned husk at the source
// ═══════════════════════════════════════════════════════════════════════════

describe('moving a table leaves nothing behind', () => {
  it('a table can be node-selected (prosemirror-tables does not rewrite it)', () => {
    const { ed } = makeEditor();
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, tablePos(ed))));
    expect(ed.state.selection).toBeInstanceOf(NodeSelection);
  });

  // columnDropPlugin refuses an open slice; with the library default this was
  // 1/1 and every table drag fell through to ProseMirror's fallback drop.
  it('the selection slice for a table is CLOSED, so the drop plugin accepts it', () => {
    const { ed } = makeEditor();
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, tablePos(ed))));
    const slice = ed.state.selection.content();
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild!.type.name).toBe('table');
  });

  it('the canvas move primitive relocates the table without a husk', () => {
    const { ed } = makeEditor();
    const pos = tablePos(ed);
    const node = ed.state.doc.nodeAt(pos)!;
    const dragFrom = pos;
    const dragTo = pos + node.nodeSize;
    const content = Fragment.from(node);
    // Drop it above BEFORE (position 0) — the same call columnDropPlugin makes.
    const tr = ed.state.tr;
    moveBlockAboveBelow(tr, content, 0, dragFrom, dragTo, false);
    ed.view.dispatch(tr);

    const tables = ed.state.doc.content.content.filter((n: any) => n.type.name === 'table');
    expect(tables).toHaveLength(1);
    expect(shape(ed).startsWith('table(')).toBe(true);
    expect(grid(ed)).toEqual([['h1', 'h2'], ['a1', 'a2'], ['b1', 'b2']]);
  });

  it("ProseMirror's own fallback move-delete removes the table, not its contents", () => {
    const { ed } = makeEditor();
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, tablePos(ed))));
    const tr = ed.state.tr;
    tr.deleteSelection();   // exactly what handleDrop() does when move === true
    ed.view.dispatch(tr);
    expect(shape(ed)).toBe('paragraph"BEFORE",paragraph"AFTER"');
  });

  it('a node-derived drag slice is closed for a table (what blockHandles builds)', () => {
    const { ed } = makeEditor();
    const node = ed.state.doc.nodeAt(tablePos(ed))!;
    const slice = new Slice(Fragment.from(node), 0, 0);
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
    expect(slice.content.firstChild!.type.name).toBe('table');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. tableOps — the vocabulary behind the grips, the menu and the keyboard
// ═══════════════════════════════════════════════════════════════════════════

describe('tableOps', () => {
  it('appendRow adds one empty row at the bottom', () => {
    const { ed } = makeEditor();
    expect(appendRow(ed, tablePos(ed))).toBe(true);
    expect(grid(ed)).toEqual([['h1', 'h2'], ['a1', 'a2'], ['b1', 'b2'], ['', '']]);
  });

  it('appendColumn adds one empty column at the right edge', () => {
    const { ed } = makeEditor();
    expect(appendColumn(ed, tablePos(ed))).toBe(true);
    expect(grid(ed)).toEqual([['h1', 'h2', ''], ['a1', 'a2', ''], ['b1', 'b2', '']]);
  });

  it('the appended column keeps the header row a header row', () => {
    const { ed } = makeEditor();
    appendColumn(ed, tablePos(ed));
    const table = ed.state.doc.nodeAt(tablePos(ed))!;
    const headerRow = table.child(0);
    headerRow.forEach((c) => expect(c.type.name).toBe('tableHeader'));
  });

  it('selectTableRow selects exactly that row', () => {
    const { ed } = makeEditor();
    expect(selectTableRow(ed, tablePos(ed), 1)).toBe(true);
    const sel = ed.state.selection as CellSelection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect(sel.isRowSelection()).toBe(true);
    clearSelectedCells(ed);
    expect(grid(ed)).toEqual([['h1', 'h2'], ['', ''], ['b1', 'b2']]);
  });

  it('moveRowBy refuses to move the header row', () => {
    const { ed } = makeEditor();
    selectTableRow(ed, tablePos(ed), 0);
    expect(moveRowBy(ed, 1)).toBe(false);
    expect(grid(ed)).toEqual([['h1', 'h2'], ['a1', 'a2'], ['b1', 'b2']]);
  });

  it('moveRowBy refuses to run past the last row', () => {
    const { ed } = makeEditor();
    selectTableRow(ed, tablePos(ed), 2);
    expect(moveRowBy(ed, 1)).toBe(false);
  });

  it('duplicateColumn copies the column contents', () => {
    const { ed } = makeEditor();
    selectTableRow(ed, tablePos(ed), 1);
    cursorAtEnd(ed, 'a1');
    expect(duplicateColumn(ed)).toBe(true);
    expect(grid(ed)).toEqual([['h1', 'h1', 'h2'], ['a1', 'a1', 'a2'], ['b1', 'b1', 'b2']]);
  });

  // A naive copy of a spanning row desynchronises the TableMap; refusing is
  // the honest answer, and the callers fall back to a fresh empty row.
  it('duplicateRow refuses a row carrying a merged cell', () => {
    const { ed } = makeEditor({ type: 'doc', content: [
      { type: 'table', content: [
        row(hcell('h1'), hcell('h2')),
        row({ type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [p('wide')] }),
        row(cell(p('b1')), cell(p('b2'))),
      ] },
    ] });
    cursorAtEnd(ed, 'wide');
    expect(duplicateRow(ed)).toBe(false);
    expect(grid(ed)).toEqual([['h1', 'h2'], ['wide'], ['b1', 'b2']]);
  });

  it('toggleHeaderRowOp turns the header row into body cells and back', () => {
    const { ed } = makeEditor();
    cursorAtEnd(ed, 'h1');
    expect(toggleHeaderRowOp(ed)).toBe(true);
    let table = ed.state.doc.nodeAt(tablePos(ed))!;
    table.child(0).forEach((c) => expect(c.type.name).toBe('tableCell'));
    expect(toggleHeaderRowOp(ed)).toBe(true);
    table = ed.state.doc.nodeAt(tablePos(ed))!;
    table.child(0).forEach((c) => expect(c.type.name).toBe('tableHeader'));
  });

  it('tableFrameAt reports the shape the grips draw from', () => {
    const { ed } = makeEditor();
    const frame = tableFrameAt(ed.state.doc, tablePos(ed))!;
    expect(frame.rows).toBe(3);
    expect(frame.cols).toBe(2);
    expect(frame.headerRow).toBe(true);
    expect(frame.headerCol).toBe(false);
    expect(frame.tableStart).toBe(frame.tablePos + 1);
  });

  // The grips resolve their table from the DOM on hover.  If that resolution
  // is off by one the grips silently never appear, so pin it.
  it('the rendered table resolves back to the table node position', () => {
    const { ed } = makeEditor();
    const tableEl = ed.view.dom.querySelector('table') as HTMLElement | null;
    expect(tableEl).not.toBeNull();
    const unit = resolveBlockUnitFromDOM(ed.view, tableEl!);
    expect(unit).not.toBeNull();
    expect(unit!.node.type.name).toBe('table');
    expect(unit!.pos).toBe(tablePos(ed));
  });

  it('a cell inside the table also resolves to the table (one block unit)', () => {
    const { ed } = makeEditor();
    const cellEl = ed.view.dom.querySelector('td') as HTMLElement | null;
    expect(cellEl).not.toBeNull();
    const unit = resolveBlockUnitFromDOM(ed.view, cellEl!);
    expect(unit!.node.type.name).toBe('table');
    expect(unit!.pos).toBe(tablePos(ed));
  });

  it('tableFrameAt returns null for a position that is not a table', () => {
    const { ed } = makeEditor();
    expect(tableFrameAt(ed.state.doc, 0)).toBeNull();
  });
});
