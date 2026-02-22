// blockMovement.ts — In-page block movement (keyboard + DnD)
//
// ALL in-page positional changes to blocks are defined here — regardless of
// trigger (keyboard shortcut or mouse drag-and-drop).
//
// Column structural invariants (empty-check, normalize, width reset, source
// deletion) live in columnInvariants.ts.  Drag session state lives in
// dragSession.ts.  Cross-page movement lives in crossPageMovement.ts.
//
// Part of blockStateRegistry — the single authority for block state operations.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  PAGE_CONTAINERS,
  resolveBlockAncestry,
  cleanupEmptyColumn,
  isColumnEffectivelyEmpty,
  normalizeAllColumnLists,
  deleteDraggedSource,
} from './blockStateRegistry.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BlockMoveResult {
  handled: boolean;
  moved: boolean;
}

// ── Keyboard Movement ───────────────────────────────────────────────────────

export function moveBlockUpWithinPageFlow(editor: Editor): BlockMoveResult {
  const { state } = editor;
  const { $head } = state.selection;
  const { containerDepth, blockDepth } = resolveBlockAncestry($head);

  if ($head.depth < blockDepth) return { handled: false, moved: false };

  const blockPos = $head.before(blockDepth);
  const node = state.doc.nodeAt(blockPos);
  if (!node) return { handled: false, moved: false };

  const container = containerDepth === 0 ? state.doc : $head.node(containerDepth);
  const $blockStart = state.doc.resolve(blockPos);
  const index = $blockStart.index(containerDepth);

  if (index <= 0) return { handled: true, moved: false };

  const parentPos = containerDepth === 0 ? 0 : $head.before(containerDepth);
  let offset = 0;
  for (let i = 0; i < index - 1; i++) {
    const child = container.child(i);
    offset += child.nodeSize;
  }
  const targetPos = parentPos + (containerDepth === 0 ? 0 : 1) + offset;

  const { tr } = state;
  const nodeJson = node.toJSON();
  tr.delete(blockPos, blockPos + node.nodeSize);
  tr.insert(targetPos, state.schema.nodeFromJSON(nodeJson));
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos + 1)));
  editor.view.dispatch(tr);
  return { handled: true, moved: true };
}

export function moveBlockDownWithinPageFlow(editor: Editor): BlockMoveResult {
  const { state } = editor;
  const { $head } = state.selection;
  const { containerDepth, blockDepth } = resolveBlockAncestry($head);

  if ($head.depth < blockDepth) return { handled: false, moved: false };

  const blockPos = $head.before(blockDepth);
  const node = state.doc.nodeAt(blockPos);
  if (!node) return { handled: false, moved: false };

  const container = containerDepth === 0 ? state.doc : $head.node(containerDepth);
  const $blockStart = state.doc.resolve(blockPos);
  const index = $blockStart.index(containerDepth);

  if (index >= container.childCount - 1) return { handled: true, moved: false };

  const nextSibling = container.child(index + 1);
  const afterNextPos = blockPos + node.nodeSize + nextSibling.nodeSize;

  const { tr } = state;
  const nodeJson = node.toJSON();
  tr.insert(afterNextPos, state.schema.nodeFromJSON(nodeJson));
  tr.delete(blockPos, blockPos + node.nodeSize);

  const newBlockPos = blockPos + nextSibling.nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(newBlockPos + 1)));
  editor.view.dispatch(tr);
  return { handled: true, moved: true };
}

export function moveBlockAcrossColumnBoundary(
  editor: Editor,
  direction: 'up' | 'down',
): boolean {
  const { $from } = editor.state.selection;
  const ancestry = resolveBlockAncestry($from);

  if (ancestry.columnDepth === null) return false;

  const colDepth = ancestry.columnDepth;
  const blockDepth = colDepth + 1;
  if (blockDepth > $from.depth) return false;

  const blockPos = $from.before(blockDepth);
  const blockNode = editor.state.doc.nodeAt(blockPos);
  if (!blockNode) return false;

  const colPos = $from.before(colDepth);
  const clDepth = ancestry.columnListDepth!;
  const clPos = $from.before(clDepth);
  const clNode = $from.node(clDepth);
  const clEnd = clPos + clNode.nodeSize;
  const { tr } = editor.state;

  const probe = editor.state.tr;
  probe.delete(blockPos, blockPos + blockNode.nodeSize);
  const probeColPos = probe.mapping.map(colPos, -1);
  const probeColNode = probe.doc.nodeAt(probeColPos);
  const sourceWillBeEmptyAfterMove = !probeColNode
    || (probeColNode.type.name === 'column' && isColumnEffectivelyEmpty(probeColNode));

  if (sourceWillBeEmptyAfterMove && clNode.childCount === 2) {
    let sourceIndex = -1;
    let scanPos = clPos + 1;
    for (let i = 0; i < clNode.childCount; i++) {
      if (scanPos === colPos) {
        sourceIndex = i;
        break;
      }
      scanPos += clNode.child(i).nodeSize;
    }

    const otherIndex = sourceIndex === 0 ? 1 : sourceIndex === 1 ? 0 : -1;
    if (otherIndex >= 0) {
      const nodes: any[] = [];
      if (direction === 'up') {
        nodes.push(blockNode);
      }
      clNode.child(otherIndex).forEach((child: any) => {
        nodes.push(child);
      });
      if (direction === 'down') {
        nodes.push(blockNode);
      }
      tr.replaceWith(clPos, clPos + clNode.nodeSize, nodes);
      editor.view.dispatch(tr);
      return true;
    }
  }

  tr.delete(blockPos, blockPos + blockNode.nodeSize);

  // Clean up any empty column left behind after the block removal.
  const mappedColPos = tr.mapping.map(colPos, 1);
  cleanupEmptyColumn(tr, mappedColPos, clPos);

  const mapped = tr.mapping.map(direction === 'up' ? clPos : clEnd);
  tr.insert(mapped, blockNode);
  normalizeAllColumnLists(tr);
  editor.view.dispatch(tr);
  return true;
}

// ── DnD Movement Primitives ─────────────────────────────────────────────────
// Column layout creation primitives (createColumnLayoutFromDrop,
// addColumnToLayoutFromDrop) live in columnCreation.ts.
// This file only handles above/below repositioning.

/**
 * Move block content above or below a target block.
 * Covers all six drop scenarios (4A–4F) when the user drops in the
 * above/below zone — source origin is irrelevant for the insertion.
 */
export function moveBlockAboveBelow(
  tr: any,
  content: any,
  insertPos: number,
  dragFrom: number,
  dragTo: number,
  isDuplicate: boolean,
): void {
  tr.insert(insertPos, content);
  if (!isDuplicate) deleteDraggedSource(tr, dragFrom, dragTo);
}
