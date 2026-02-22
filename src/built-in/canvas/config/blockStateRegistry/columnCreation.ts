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
  deleteDraggedSource,
  resetColumnListWidths,
} from './blockStateRegistry.js';

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

  const columns: any[] = [];
  for (let i = 0; i < columnCount; i++) {
    if (i === 0) {
      columns.push(columnNodeType.create({ width: null }, [sourceBlock]));
    } else {
      // Each empty column needs its own paragraph instance — reusing a single
      // node object corrupts ProseMirror's position tracking and makes the
      // column un-editable.
      const emptyParagraph = paragraphNodeType.createAndFill();
      if (!emptyParagraph) return false;
      columns.push(columnNodeType.create({ width: null }, [emptyParagraph]));
    }
  }

  const columnList = columnListNodeType.create(null, columns);

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
): boolean {
  const columnType = schema.nodes.column;
  const columnListType = schema.nodes.columnList;

  let tCol: any, dCol: any;
  try {
    tCol = columnType.create(null, Fragment.from(targetBlockNode));
    dCol = columnType.create(null, content);
  } catch { return false; }

  const cols = zone === 'left'
    ? Fragment.from([dCol, tCol])
    : Fragment.from([tCol, dCol]);
  let cl: any;
  try { cl = columnListType.create(null, cols); } catch { return false; }

  tr.replaceWith(targetBlockPos, targetBlockPos + targetBlockNode.nodeSize, cl);
  if (!isDuplicate) deleteDraggedSource(tr, dragFrom, dragTo);
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
): boolean {
  const columnType = schema.nodes.column;

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
  try { newCol = columnType.create(null, content); } catch { return false; }

  const insertColPos = zone === 'left'
    ? columnPos
    : columnPos + targetColNode.nodeSize;

  tr.insert(insertColPos, newCol);
  if (!isDuplicate) deleteDraggedSource(tr, dragFrom, dragTo);

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
