// tableKeyboardPolicy.ts — the keyboard contract for a cursor inside a table
//
// A table is ONE block to the canvas (the drag handle, the marquee and the
// block-selection model all resolve a cursor in any cell to the table node).
// That is the right model for moving a table around a page — and the wrong
// one for every keystroke typed INSIDE it, because the canvas's block-level
// shortcuts then aim at the table when the user meant the cell they are
// standing in.  Measured on 2026-08-27, before this file existed:
//
//   • Shift+ArrowUp in a cell block-selected the table AND the paragraph
//     above it; the next Backspace deleted both.  (The single worst one —
//     it is reachable by pure text-editing muscle memory.)
//   • Mod+d in a cell duplicated the whole table.
//   • Mod+Shift+ArrowDown in a cell moved the whole table down the page.
//   • Mod+a in a cell selected the entire DOCUMENT; Backspace then wiped
//     the page.
//
// So: inside a table, the block layer stands down and these keys get their
// table-scoped meaning instead — the row is the unit, exactly as the block
// is outside.  Priority 300 puts this above BlockKeyboardShortcuts (200) and
// columnNodes (100); anything this file declines falls through to them, and
// past them to prosemirror-tables' own keymap, which already implements
// Tab/Shift-Tab, cell-wise arrows and Shift+arrow cell-selection extension.
//
// Structural edits are NOT implemented here — they come from tableOps.ts, the
// single vocabulary shared with the row/column grips.

import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import {
  duplicateRow,
  focusTableCell,
  insertRowBelow,
  moveColumnBy,
  moveRowBy,
  resolveTableFrame,
  selectWholeTable,
  selectionIsInTable,
  isWholeTableSelected,
} from '../config/blockStateRegistry/blockStateRegistry.js';

/**
 * True when the canvas's own multi-block selection is driving.  In that state
 * the user has explicitly stepped OUT of the cell (via Escape or the drag
 * handle) and block-level shortcuts are what they asked for, so this policy
 * gets out of the way even though the caret is still inside a cell.
 *
 * Read through the same storage channel canvasEditorProvider writes; when the
 * controller isn't wired (headless tests) it reads as "no selection".
 */
function blockSelectionActive(editor: any): boolean {
  return editor?.storage?.blockKeyboardShortcuts?.hasSelection?.() === true;
}

/** This policy applies only to a caret/cell selection inside a table. */
function policyApplies(editor: any): boolean {
  return selectionIsInTable(editor.state) && !blockSelectionActive(editor);
}

/** The content range of the cell the selection's anchor sits in. */
function currentCellRange(editor: any): { from: number; to: number } | null {
  const frame = resolveTableFrame(editor.state);
  if (!frame) return null;
  const offset = frame.map.map[frame.rect.top * frame.cols + frame.rect.left];
  if (offset == null) return null;
  const cell = frame.table.nodeAt(offset);
  if (!cell) return null;
  const start = frame.tableStart + offset + 1;
  const { doc } = editor.state;
  const sel = TextSelection.between(
    doc.resolve(start),
    doc.resolve(start + cell.content.size),
  );
  return { from: sel.from, to: sel.to };
}

export const TableKeyboardPolicy = Extension.create({
  name: 'tableKeyboardPolicy',

  // Above BlockKeyboardShortcuts (200) and columnNodes (100) — see header.
  priority: 300,

  addKeyboardShortcuts() {
    return {
      // ── Mod-a — widen by one ring, never straight to the document ──
      // Notion's ladder: the cell's text, then the whole table, then the
      // page.  ProseMirror's `selectAll` jumps to the page on the first
      // press, which is why Ctrl+A-then-Backspace inside a cell used to
      // erase everything the user had written.
      'Mod-a': ({ editor }) => {
        if (!policyApplies(editor)) return false;
        if (isWholeTableSelected(editor.state)) return false; // next ring: the page

        const { selection } = editor.state;
        if (!(selection instanceof CellSelection)) {
          const range = currentCellRange(editor);
          if (range && !(selection.from === range.from && selection.to === range.to)) {
            editor.view.dispatch(editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, range.from, range.to),
            ));
            return true;
          }
        }
        const frame = resolveTableFrame(editor.state);
        return frame ? selectWholeTable(editor, frame.tablePos) : false;
      },

      // ── Mod-Shift-Arrow — the ROW is the movable unit inside a table ──
      // Outside a table these move the selected block; inside one, moving
      // the table itself is never what a caret in a cell meant.
      'Mod-Shift-ArrowUp': ({ editor }) =>
        policyApplies(editor) ? moveRowBy(editor, -1) || true : false,
      'Mod-Shift-ArrowDown': ({ editor }) =>
        policyApplies(editor) ? moveRowBy(editor, 1) || true : false,
      'Mod-Shift-ArrowLeft': ({ editor }) =>
        policyApplies(editor) ? moveColumnBy(editor, -1) || true : false,
      'Mod-Shift-ArrowRight': ({ editor }) =>
        policyApplies(editor) ? moveColumnBy(editor, 1) || true : false,

      // ── Mod-d — duplicate the ROW ──
      // Rows carrying merged cells can't be copied without desynchronising
      // the table map, so they get a fresh empty row instead of a corrupt
      // duplicate: the gesture still means "another row like this one".
      'Mod-d': ({ editor }) => {
        if (!policyApplies(editor)) return false;
        return duplicateRow(editor) || insertRowBelow(editor) || true;
      },

      // ── Escape — one ring out, not straight to the block ──
      // First press selects the cell (visible, and the door to the cell
      // menu); a second press falls through to BlockKeyboardShortcuts,
      // which block-selects the whole table.
      Escape: ({ editor }) => {
        if (!policyApplies(editor)) return false;
        if (editor.state.selection instanceof CellSelection) return false;
        const frame = resolveTableFrame(editor.state);
        if (!frame) return false;
        const offset = frame.map.map[frame.rect.top * frame.cols + frame.rect.left];
        if (offset == null) return false;
        const $cell = editor.state.doc.resolve(frame.tableStart + offset);
        editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($cell)));
        return true;
      },

      // ── Enter with cells selected — step INTO the anchor cell ──
      // The base keymap would replace the selected cells with a split
      // paragraph; "start typing here" is what the keystroke means.
      Enter: ({ editor }) => {
        if (!policyApplies(editor)) return false;
        if (!(editor.state.selection instanceof CellSelection)) return false;
        const frame = resolveTableFrame(editor.state);
        if (!frame) return false;
        return focusTableCell(editor, frame.tablePos, frame.rect.top, frame.rect.left);
      },
    };
  },
});
