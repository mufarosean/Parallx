// columnCreation.ts — Column layout assembly
//
// Every path that creates or extends a column layout funnels through here:
//   • turnBlockIntoColumns   — "Turn Into → Columns" menu action
//   • createColumnLayoutFromDrop — DnD left/right on a top-level block
//   • addColumnToLayoutFromDrop  — DnD left/right on a block inside columns
//
// Column structural invariants (empty-check, normalize, width reset, source
// deletion) live in columnInvariants.ts.  This file only *assembles* layouts;
// post-mutation cleanup is delegated to the invariant layer.
//
// Part of blockStateRegistry — the single authority for block state operations.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import {
  deleteDraggedRanges,
  dragRangesOf,
  isListItemNodeName,
  resetColumnListWidths,
  type DragRange,
} from './blockStateRegistry.js';

// ── Dragged content as blocks ──────────────────────────────────────────────

/**
 * The dragged nodes as BLOCKS: list rows are wrapped in a list of the type
 * they came from (consecutive rows from lists of one type share a list).
 * Rows alone can't stand in a column or at page level; inserting them raw
 * either threw (a column of bare rows is schema-invalid) or let ProseMirror
 * wrap them in a bullet list, turning numbered and to-do rows into bullets.
 *
 * @param doc    the doc the ranges point into (before the drop's steps).
 * @param ranges each dragged node's source range, in the fragment's order.
 */
export function draggedContentAsBlocks(
  schema: any,
  doc: any,
  content: Fragment,
  ranges: ReadonlyArray<DragRange>,
): Fragment {
  const out: any[] = [];
  let open: { type: string; attrs: any; rows: any[] } | null = null;
  const flush = () => {
    if (open) out.push(schema.nodes[open.type].create(open.attrs, open.rows));
    open = null;
  };
  content.forEach((node: any, _offset: number, index: number) => {
    if (!isListItemNodeName(node.type.name)) {
      flush();
      out.push(node);
      return;
    }
    let listType = node.type.name === 'taskItem' ? 'taskList' : 'bulletList';
    let listAttrs: any = null;
    const range = ranges[index];
    if (range) {
      try {
        const parent = doc.resolve(range.from).parent;
        if (parent.type.contentMatch.matchType(node.type) && parent.type.name !== 'doc') {
          listType = parent.type.name;
          const { id: _id, ...rest } = parent.attrs ?? {};
          listAttrs = rest;
        }
      } catch { /* keep the default list type */ }
    }
    if (!open || open.type !== listType) {
      flush();
      open = { type: listType, attrs: listAttrs, rows: [] };
    }
    open.rows.push(node);
  });
  flush();
  return Fragment.from(out);
}

// ── Turn-Into Columns ───────────────────────────────────────────────────────

/**
 * Convert a single block into a columnList with `columnCount` columns.
 * The source block's content goes into the first column; remaining columns
 * get empty paragraphs.
 *
 * Called by `turnBlockWithSharedStrategy` (blockTransforms) when the user
 * selects "Turn Into → Columns" from the block action menu.
 */
export function turnBlockIntoColumns(
  editor: Editor,
  pos: number,
  node: any,
  columnCount: number,
): boolean {
  if (!Number.isFinite(columnCount) || columnCount < 2) {
    return false;
  }

  if (node.type.name === 'columnList') {
    return false;
  }

  const { schema } = editor.state;
  const columnNodeType = schema.nodes.column;
  const columnListNodeType = schema.nodes.columnList;
  const paragraphNodeType = schema.nodes.paragraph;

  if (!columnNodeType || !columnListNodeType || !paragraphNodeType) {
    return false;
  }

  const sourceBlock = schema.nodeFromJSON(node.toJSON());

  // createChecked: a block a column can't hold (a data view, …) refuses the
  // conversion instead of writing a schema-invalid layout.
  let columnList: any;
  try {
    const columns: any[] = [];
    for (let i = 0; i < columnCount; i++) {
      if (i === 0) {
        columns.push(columnNodeType.createChecked({ width: null }, [sourceBlock]));
      } else {
        // Each empty column needs its own paragraph instance — reusing a single
        // node object corrupts ProseMirror's position tracking and makes the
        // column un-editable.
        const emptyParagraph = paragraphNodeType.createAndFill();
        if (!emptyParagraph) return false;
        columns.push(columnNodeType.createChecked({ width: null }, [emptyParagraph]));
      }
    }
    columnList = columnListNodeType.createChecked(null, columns);
  } catch {
    return false;
  }

  const { tr } = editor.state;
  tr.replaceWith(pos, pos + node.nodeSize, columnList);

  const selectionAnchor = Math.min(pos + 3, tr.doc.content.size);
  const $resolved = tr.doc.resolve(selectionAnchor);
  const sel = TextSelection.near($resolved, 1);
  tr.setSelection(sel);

  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

// ── DnD Column Creation ─────────────────────────────────────────────────────

/**
 * Wrap a top-level target block and dragged content into a new columnList.
 * Covers left/right drops on top-level blocks (scenarios 4A, 4C).
 *
 * @returns true if the columnList was created, false on schema error.
 */
export function createColumnLayoutFromDrop(
  tr: any,
  schema: any,
  content: Fragment,
  targetBlockPos: number,
  targetBlockNode: any,
  zone: 'left' | 'right',
  dragFrom: number,
  dragTo: number,
  isDuplicate: boolean,
  ranges?: ReadonlyArray<DragRange>,
): boolean {
  const columnType = schema.nodes.column;
  const columnListType = schema.nodes.columnList;
  const dragRanges = dragRangesOf(dragFrom, dragTo, ranges);
  const blocks = draggedContentAsBlocks(schema, tr.doc, content, dragRanges);

  // createChecked: `create` never validates, so a column of content it can't
  // hold used to be written as-is (or threw later, mid-dispatch).
  let cl: any;
  try {
    const tCol = columnType.createChecked(null, Fragment.from(targetBlockNode));
    const dCol = columnType.createChecked(null, blocks);
    const cols = zone === 'left'
      ? Fragment.from([dCol, tCol])
      : Fragment.from([tCol, dCol]);
    cl = columnListType.createChecked(null, cols);
  } catch { return false; }

  tr.replaceWith(targetBlockPos, targetBlockPos + targetBlockNode.nodeSize, cl);
  if (!isDuplicate) deleteDraggedRanges(tr, dragRanges);
  return true;
}

/**
 * Insert a new column into an existing columnList.
 * Covers left/right drops on blocks inside columns (scenarios 4B, 4D, 4E, 4F).
 *
 * Notion-style width redistribution: only the target column's width is split
 * in half; other sibling columns keep their current widths.
 *
 * @returns true if the column was added, false on error.
 */
export function addColumnToLayoutFromDrop(
  tr: any,
  doc: any,
  schema: any,
  content: Fragment,
  columnPos: number,
  columnListPos: number,
  zone: 'left' | 'right',
  dragFrom: number,
  dragTo: number,
  isDuplicate: boolean,
  ranges?: ReadonlyArray<DragRange>,
): boolean {
  const columnType = schema.nodes.column;
  const dragRanges = dragRangesOf(dragFrom, dragTo, ranges);

  const targetColNode = doc.nodeAt(columnPos);
  if (!targetColNode) return false;

  // ── Compute target column's effective width before mutations ──
  const oldCl = doc.nodeAt(columnListPos);
  const oldColCount = oldCl ? oldCl.childCount : 0;
  let expSum = 0, nCount = 0;
  if (oldCl) {
    for (let i = 0; i < oldCl.childCount; i++) {
      const w = oldCl.child(i).attrs.width;
      if (w != null) expSum += w; else nCount++;
    }
  }
  const nullEff = nCount > 0 ? (100 - expSum) / nCount : 0;
  const targetEff = targetColNode.attrs.width ?? nullEff;
  const half = parseFloat((targetEff / 2).toFixed(2));

  let newCol: any;
  try {
    newCol = columnType.createChecked(null, draggedContentAsBlocks(schema, doc, content, dragRanges));
  } catch { return false; }

  const insertColPos = zone === 'left'
    ? columnPos
    : columnPos + targetColNode.nodeSize;

  tr.insert(insertColPos, newCol);
  if (!isDuplicate) deleteDraggedRanges(tr, dragRanges);

  // ── Width redistribution: Notion-style split ──
  const mClPos = tr.mapping.map(columnListPos);
  const finalCl = tr.doc.nodeAt(mClPos);

  if (finalCl && finalCl.type.name === 'columnList' &&
      finalCl.childCount === oldColCount + 1) {
    // Clean addition — no column removed from this list.
    const mTargetPos = tr.mapping.map(columnPos);
    let targetIdx = -1;
    let off = mClPos + 1;
    for (let i = 0; i < finalCl.childCount; i++) {
      if (off === mTargetPos) { targetIdx = i; break; }
      off += finalCl.child(i).nodeSize;
    }
    if (targetIdx >= 0) {
      const newIdx = zone === 'left'
        ? targetIdx - 1
        : targetIdx + 1;
      off = mClPos + 1;
      for (let i = 0; i < finalCl.childCount; i++) {
        const ch = finalCl.child(i);
        if (i === targetIdx || i === newIdx) {
          tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: half });
        }
        off += ch.nodeSize;
      }
    } else {
      // Fallback — couldn't locate target; equalize
      resetColumnListWidths(tr, columnListPos);
    }
  } else {
    // Source column was removed from same columnList — equalize
    resetColumnListWidths(tr, columnListPos);
  }

  return true;
}
