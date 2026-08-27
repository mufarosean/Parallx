// tableOps.ts — THE single vocabulary for table structure changes
//
// Every structural edit a table can undergo — add / delete / duplicate /
// move a row or column, toggle a header, clear cells, merge or split — is
// defined here ONCE and shared by every door that can trigger it: the row
// and column grips, the grip menu, and the table keyboard policy.  The
// canvas already learned this lesson for blocks (blockUnit.ts, "which block
// am I operating on?" must have exactly one answer); tables get the same
// treatment so a grip and a shortcut can never disagree.
//
// Two layers, deliberately:
//
//   • TARGETING — `selectTableRow` / `selectTableColumn` / `selectTableCell`
//     put a real, VISIBLE CellSelection on the thing the user aimed at.
//     Notion does the same: clicking a grip highlights the row before the
//     menu opens, so the user can see what the next command will hit.
//
//   • OPERATIONS — everything below reads `state.selection`, exactly like the
//     prosemirror-tables commands they wrap.  One code path for grips and
//     keystrokes: aim, then act.
//
// The guards are the part that isn't free from the library:
//   – the header row/column never moves and is never moved into;
//   – duplication refuses spanning cells rather than corrupting the TableMap;
//   – duplicating the HEADER row yields a BODY row (a table has one header).
//
// Part of blockStateRegistry — the single authority for block state
// operations.  Zero canvas-internal imports (ProseMirror only).

import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  CellSelection,
  TableMap,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  columnIsHeader,
  deleteCellSelection,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  mergeCells,
  moveTableColumn,
  moveTableRow,
  rowIsHeader,
  selectedRect,
  splitCell,
  toggleHeaderColumn,
  toggleHeaderRow,
} from '@tiptap/pm/tables';

// ── Frame ───────────────────────────────────────────────────────────────────

/**
 * Everything a table op needs about the table under the current selection.
 * `rect` is the selected span in map coordinates: rows [top, bottom),
 * columns [left, right).
 */
export interface TableFrame {
  /** Absolute position OF the table node. */
  readonly tablePos: number;
  /** Absolute position of the table's first child (`tablePos + 1`). */
  readonly tableStart: number;
  readonly table: PMNode;
  readonly map: TableMap;
  readonly rect: { top: number; bottom: number; left: number; right: number };
  readonly rows: number;
  readonly cols: number;
  /** True when row 0 is a header row (every cell is a `tableHeader`). */
  readonly headerRow: boolean;
  /** True when column 0 is a header column. */
  readonly headerCol: boolean;
}

/** The table frame under the current selection, or null when outside a table. */
export function resolveTableFrame(state: EditorState): TableFrame | null {
  if (!isInTable(state)) return null;
  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return null; // selection moved out from under us
  }
  const { map, table, tableStart } = rect;
  return {
    tablePos: tableStart - 1,
    tableStart,
    table,
    map,
    rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    rows: map.height,
    cols: map.width,
    headerRow: map.height > 0 && rowIsHeader(map, table, 0),
    headerCol: map.width > 0 && columnIsHeader(map, table, 0),
  };
}

/**
 * The table frame for the table node AT `tablePos`, independent of where the
 * selection currently is.  Used by the grips, which know their table from the
 * DOM and must be able to describe it before they move the selection into it.
 */
export function tableFrameAt(doc: PMNode, tablePos: number): TableFrame | null {
  if (tablePos < 0 || tablePos > doc.content.size) return null;
  const table = doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table' || table.childCount === 0) return null;
  let map: TableMap;
  try {
    map = TableMap.get(table);
  } catch {
    return null; // malformed table — structuralRepair's problem, not ours
  }
  return {
    tablePos,
    tableStart: tablePos + 1,
    table,
    map,
    rect: { top: 0, bottom: map.height, left: 0, right: map.width },
    rows: map.height,
    cols: map.width,
    headerRow: map.height > 0 && rowIsHeader(map, table, 0),
    headerCol: map.width > 0 && columnIsHeader(map, table, 0),
  };
}

/** Resolved position pointing AT the cell covering (row, col). */
function $cellAt(doc: PMNode, frame: TableFrame, row: number, col: number) {
  const index = row * frame.map.width + col;
  const offset = frame.map.map[index];
  if (offset == null) return null;
  return doc.resolve(frame.tableStart + offset);
}

// ── Targeting ───────────────────────────────────────────────────────────────

/**
 * Select every cell in `row` of the table at `tablePos`.  Returns false when
 * the position no longer holds a table with that row (a stale grip after an
 * external edit) — callers treat that as "nothing to aim at".
 */
export function selectTableRow(editor: Editor, tablePos: number, row: number): boolean {
  const { doc } = editor.state;
  const frame = tableFrameAt(doc, tablePos);
  if (!frame || row < 0 || row >= frame.rows) return false;
  const $first = $cellAt(doc, frame, row, 0);
  const $last = $cellAt(doc, frame, row, frame.cols - 1);
  if (!$first || !$last) return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(CellSelection.rowSelection($first, $last)),
  );
  return true;
}

/** Select every cell in `col` of the table at `tablePos`. */
export function selectTableColumn(editor: Editor, tablePos: number, col: number): boolean {
  const { doc } = editor.state;
  const frame = tableFrameAt(doc, tablePos);
  if (!frame || col < 0 || col >= frame.cols) return false;
  const $first = $cellAt(doc, frame, 0, col);
  const $last = $cellAt(doc, frame, frame.rows - 1, col);
  if (!$first || !$last) return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(CellSelection.colSelection($first, $last)),
  );
  return true;
}

/** Select every cell of the table at `tablePos`. */
export function selectWholeTable(editor: Editor, tablePos: number): boolean {
  const { doc } = editor.state;
  const frame = tableFrameAt(doc, tablePos);
  if (!frame) return false;
  const $first = $cellAt(doc, frame, 0, 0);
  const $last = $cellAt(doc, frame, frame.rows - 1, frame.cols - 1);
  if (!$first || !$last) return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(new CellSelection($first, $last)),
  );
  return true;
}

/**
 * Node-select the table itself — the canvas block unit.  Only reachable
 * because the table extension runs with `allowTableNodeSelection: true`;
 * with the library default prosemirror-tables rewrites this back into a
 * cell selection the moment it is dispatched.
 */
export function selectTableNode(editor: Editor, tablePos: number): boolean {
  const { doc } = editor.state;
  const table = doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(doc, tablePos)),
  );
  return true;
}

/** Put the caret inside the cell at (row, col), ready to type. */
export function focusTableCell(editor: Editor, tablePos: number, row: number, col: number): boolean {
  const { doc } = editor.state;
  const frame = tableFrameAt(doc, tablePos);
  if (!frame) return false;
  const $cell = $cellAt(doc, frame, Math.min(row, frame.rows - 1), Math.min(col, frame.cols - 1));
  if (!$cell) return false;
  const tr = editor.state.tr.setSelection(
    TextSelection.near(doc.resolve($cell.pos + 1)),
  );
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

// ── Insertion ───────────────────────────────────────────────────────────────

const run = (editor: Editor, cmd: (s: EditorState, d?: (tr: any) => void) => boolean): boolean =>
  cmd(editor.state, editor.view.dispatch.bind(editor.view));

export function insertRowAbove(editor: Editor): boolean {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return false;
  // Inserting above the header row would push the header into the body and
  // leave a plain row on top.  Notion keeps the header pinned; so do we.
  if (frame.headerRow && frame.rect.top === 0) return insertRowBelow(editor);
  return run(editor, addRowBefore);
}

export function insertRowBelow(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, addRowAfter) : false;
}

export function insertColumnLeft(editor: Editor): boolean {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return false;
  if (frame.headerCol && frame.rect.left === 0) return insertColumnRight(editor);
  return run(editor, addColumnBefore);
}

export function insertColumnRight(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, addColumnAfter) : false;
}

/** Append one row at the bottom of the table at `tablePos`. */
export function appendRow(editor: Editor, tablePos: number): boolean {
  const frame = tableFrameAt(editor.state.doc, tablePos);
  if (!frame) return false;
  if (!selectTableRow(editor, tablePos, frame.rows - 1)) return false;
  return insertRowBelow(editor);
}

/** Append one column at the right edge of the table at `tablePos`. */
export function appendColumn(editor: Editor, tablePos: number): boolean {
  const frame = tableFrameAt(editor.state.doc, tablePos);
  if (!frame) return false;
  if (!selectTableColumn(editor, tablePos, frame.cols - 1)) return false;
  return insertColumnRight(editor);
}

// ── Removal ─────────────────────────────────────────────────────────────────

export function removeRow(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, deleteRow) : false;
}

export function removeColumn(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, deleteColumn) : false;
}

export function removeTable(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, deleteTable) : false;
}

/**
 * Empty the selected cells without touching the table's shape.  This is the
 * contract Backspace already honours for a partial cell selection; the menu
 * needs a door to the same behaviour.
 */
export function clearSelectedCells(editor: Editor): boolean {
  if (!(editor.state.selection instanceof CellSelection)) return false;
  return run(editor, deleteCellSelection);
}

// ── Duplication ─────────────────────────────────────────────────────────────

/**
 * A copy of `row` whose header cells become body cells.  A table has exactly
 * one header row; duplicating the header must produce data, not a second
 * heading (Notion's behaviour, and the only one that keeps `rowIsHeader`
 * meaningful).
 */
function bodyRowCopy(rowNode: PMNode, schema: any): PMNode {
  const bodyCellType = schema.nodes.tableCell;
  const cells: PMNode[] = [];
  rowNode.forEach((cell) => {
    if (bodyCellType && cell.type.name === 'tableHeader') {
      cells.push(bodyCellType.create(cell.attrs, cell.content, cell.marks));
    } else {
      cells.push(cell.type.create(cell.attrs, cell.content, cell.marks));
    }
  });
  return rowNode.type.create(rowNode.attrs, Fragment.from(cells), rowNode.marks);
}

/** True when every cell of `row` occupies exactly one map slot. */
function rowIsSimple(frame: TableFrame, row: number): boolean {
  for (let col = 0; col < frame.cols; col++) {
    const cell = frame.table.nodeAt(frame.map.map[row * frame.cols + col]);
    if (!cell) return false;
    if (cell.attrs.rowspan !== 1 || cell.attrs.colspan !== 1) return false;
  }
  return true;
}

/** True when every cell of `col` occupies exactly one map slot. */
function columnIsSimple(frame: TableFrame, col: number): boolean {
  for (let row = 0; row < frame.rows; row++) {
    const cell = frame.table.nodeAt(frame.map.map[row * frame.cols + col]);
    if (!cell) return false;
    if (cell.attrs.rowspan !== 1 || cell.attrs.colspan !== 1) return false;
  }
  return true;
}

/**
 * Insert a copy of the selected row(s) directly below them.  Refuses rows
 * containing merged cells: a naive copy would desynchronise the TableMap and
 * corrupt the table.  Callers fall back to inserting an empty row.
 */
export function duplicateRow(editor: Editor): boolean {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return false;

  for (let row = frame.rect.top; row < frame.rect.bottom; row++) {
    if (!rowIsSimple(frame, row)) return false;
  }

  const copies: PMNode[] = [];
  for (let row = frame.rect.top; row < frame.rect.bottom; row++) {
    copies.push(bodyRowCopy(frame.table.child(row), editor.state.schema));
  }
  if (copies.length === 0) return false;

  let insertAt = frame.tableStart;
  for (let i = 0; i < frame.rect.bottom; i++) insertAt += frame.table.child(i).nodeSize;

  const tr = editor.state.tr.insert(insertAt, Fragment.from(copies));
  editor.view.dispatch(tr);
  return true;
}

/**
 * Insert a copy of the selected column directly to its right.  Cells are
 * inserted bottom-up so every position computed against the original document
 * is still valid when its turn comes.
 */
export function duplicateColumn(editor: Editor): boolean {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return false;

  const col = frame.rect.right - 1;
  if (col < 0 || !columnIsSimple(frame, col)) return false;

  const tr = editor.state.tr;
  for (let row = frame.rows - 1; row >= 0; row--) {
    const offset = frame.map.map[row * frame.cols + col];
    const cell = frame.table.nodeAt(offset);
    if (!cell) return false;
    tr.insert(frame.tableStart + offset + cell.nodeSize,
      cell.type.create(cell.attrs, cell.content, cell.marks));
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

// ── Reordering ──────────────────────────────────────────────────────────────

/**
 * Move the selected row by `delta`.  The header row is pinned: it never
 * moves, and no body row may be moved above it.
 */
export function moveRowBy(editor: Editor, delta: number): boolean {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return false;
  const from = frame.rect.top;
  const floor = frame.headerRow ? 1 : 0;
  if (from < floor) return false;
  const to = from + delta;
  if (to < floor || to > frame.rows - 1) return false;
  return run(editor, moveTableRow({ from, to }));
}

/** Move the selected column by `delta`; the header column is pinned. */
export function moveColumnBy(editor: Editor, delta: number): boolean {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return false;
  const from = frame.rect.left;
  const floor = frame.headerCol ? 1 : 0;
  if (from < floor) return false;
  const to = from + delta;
  if (to < floor || to > frame.cols - 1) return false;
  return run(editor, moveTableColumn({ from, to }));
}

// ── Headers & cells ─────────────────────────────────────────────────────────

export function toggleHeaderRowOp(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, toggleHeaderRow) : false;
}

export function toggleHeaderColumnOp(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, toggleHeaderColumn) : false;
}

export function mergeSelectedCells(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, mergeCells) : false;
}

export function splitSelectedCell(editor: Editor): boolean {
  return resolveTableFrame(editor.state) ? run(editor, splitCell) : false;
}

/** Whether merge/split would do anything from the current selection. */
export function canMergeCells(state: EditorState): boolean {
  return isInTable(state) && mergeCells(state);
}

export function canSplitCell(state: EditorState): boolean {
  return isInTable(state) && splitCell(state);
}

// ── Predicates shared with the keyboard policy & the controls layer ─────────

/** True when the selection sits inside a table (caret or cell selection). */
export function selectionIsInTable(state: EditorState): boolean {
  return isInTable(state);
}

/** True when every cell of the table is selected. */
export function isWholeTableSelected(state: EditorState): boolean {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;
  const frame = resolveTableFrame(state);
  if (!frame) return false;
  return frame.rect.top === 0 && frame.rect.left === 0
    && frame.rect.bottom === frame.rows && frame.rect.right === frame.cols;
}
