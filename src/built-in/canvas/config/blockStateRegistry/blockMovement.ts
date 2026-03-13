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
  resolveBlockAncestry,
  resolveMovableBlock,
  isListItemNodeName,
  isListNodeName,
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

function _selectionAnchorForNode(nodePos: number, node: any): number {
  return isListNodeName(node?.type?.name) ? nodePos + 2 : nodePos + 1;
}

function _wrapListFragment(schema: any, listType: 'bulletList' | 'orderedList' | 'taskList', items: any): any {
  const listNodeType = schema.nodes[listType];
  if (!listNodeType) {
    throw new Error(`Missing schema node for ${listType}`);
  }
  return listNodeType.create(null, items);
}

function _moveNodeWithinParent(editor: Editor, params: {
  nodePos: number;
  node: any;
  parentDepth: number;
  direction: 'up' | 'down';
}): BlockMoveResult {
  const { state } = editor;
  const { nodePos, node, parentDepth, direction } = params;
  const $nodeStart = state.doc.resolve(nodePos);
  const parentNode = parentDepth === 0 ? state.doc : $nodeStart.node(parentDepth);
  const index = $nodeStart.index(parentDepth);

  if (direction === 'up') {
    if (index <= 0) return { handled: true, moved: false };

    const parentPos = parentDepth === 0 ? 0 : $nodeStart.before(parentDepth);
    let offset = 0;
    for (let childIndex = 0; childIndex < index - 1; childIndex++) {
      offset += parentNode.child(childIndex).nodeSize;
    }
    const targetPos = parentPos + (parentDepth === 0 ? 0 : 1) + offset;

    const tr = state.tr;
    tr.delete(nodePos, nodePos + node.nodeSize);
    tr.insert(targetPos, state.schema.nodeFromJSON(node.toJSON()));
    tr.setSelection(TextSelection.near(tr.doc.resolve(_selectionAnchorForNode(targetPos, node))));
    editor.view.dispatch(tr);
    return { handled: true, moved: true };
  }

  if (index >= parentNode.childCount - 1) return { handled: true, moved: false };

  const nextSibling = parentNode.child(index + 1);
  const afterNextPos = nodePos + node.nodeSize + nextSibling.nodeSize;

  const tr = state.tr;
  tr.insert(afterNextPos, state.schema.nodeFromJSON(node.toJSON()));
  tr.delete(nodePos, nodePos + node.nodeSize);

  const newNodePos = nodePos + nextSibling.nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(_selectionAnchorForNode(newNodePos, node))));
  editor.view.dispatch(tr);
  return { handled: true, moved: true };
}

function _moveListItemWithinPageFlow(editor: Editor, direction: 'up' | 'down'): BlockMoveResult {
  const { state } = editor;
  const unit = resolveMovableBlock(state.selection.$head);
  if (!unit || !unit.isListItem || !unit.listNode || !unit.listType || unit.listPos === null) {
    return { handled: false, moved: false };
  }

  const itemIndex = state.doc.resolve(unit.pos).index(unit.parentDepth);
  const listNode = unit.listNode;

  if (direction === 'up' && itemIndex > 0) {
    return _moveNodeWithinParent(editor, {
      nodePos: unit.pos,
      node: unit.node,
      parentDepth: unit.parentDepth,
      direction,
    });
  }

  if (direction === 'down' && itemIndex < listNode.childCount - 1) {
    return _moveNodeWithinParent(editor, {
      nodePos: unit.pos,
      node: unit.node,
      parentDepth: unit.parentDepth,
      direction,
    });
  }

  if (listNode.childCount === 1) {
    const outerParentDepth = unit.parentDepth - 1;
    if (outerParentDepth < 0) return { handled: true, moved: false };
    return _moveNodeWithinParent(editor, {
      nodePos: unit.listPos,
      node: listNode,
      parentDepth: outerParentDepth,
      direction,
    });
  }

  const wrappedList = _wrapListFragment(
    state.schema,
    unit.listType,
    state.schema.nodeFromJSON(unit.node.toJSON()),
  );

  const tr = state.tr;
  tr.delete(unit.pos, unit.pos + unit.node.nodeSize);

  if (direction === 'up') {
    const mappedListPos = tr.mapping.map(unit.listPos, -1);
    tr.insert(mappedListPos, wrappedList);
    tr.setSelection(TextSelection.near(tr.doc.resolve(_selectionAnchorForNode(mappedListPos, wrappedList))));
  } else {
    const mappedListPos = tr.mapping.map(unit.listPos, 1);
    const mappedListNode = tr.doc.nodeAt(mappedListPos);
    if (!mappedListNode) return { handled: false, moved: false };
    const insertPos = mappedListPos + mappedListNode.nodeSize;
    tr.insert(insertPos, wrappedList);
    tr.setSelection(TextSelection.near(tr.doc.resolve(_selectionAnchorForNode(insertPos, wrappedList))));
  }

  editor.view.dispatch(tr);
  return { handled: true, moved: true };
}

export function areAllDraggedNodesListItems(content: any): boolean {
  if (!content || content.childCount === 0) return false;
  const first = content.firstChild;
  if (!isListItemNodeName(first?.type?.name)) return false;
  for (let index = 1; index < content.childCount; index++) {
    if (content.child(index).type.name !== first.type.name) return false;
  }
  return true;
}

export function wrapDraggedListItemsForDrop(
  schema: any,
  content: any,
  listType: 'bulletList' | 'orderedList' | 'taskList',
): any {
  const first = content?.firstChild;
  if (!isListItemNodeName(first?.type?.name)) {
    throw new Error('wrapDraggedListItemsForDrop requires list item content');
  }
  return _wrapListFragment(schema, listType, content);
}

// ── Keyboard Movement ───────────────────────────────────────────────────────

export function moveBlockUpWithinPageFlow(editor: Editor): BlockMoveResult {
  const unit = resolveMovableBlock(editor.state.selection.$head);
  if (!unit) return { handled: false, moved: false };
  if (unit.isListItem) {
    return _moveListItemWithinPageFlow(editor, 'up');
  }
  return _moveNodeWithinParent(editor, {
    nodePos: unit.pos,
    node: unit.node,
    parentDepth: unit.parentDepth,
    direction: 'up',
  });
}

export function moveBlockDownWithinPageFlow(editor: Editor): BlockMoveResult {
  const unit = resolveMovableBlock(editor.state.selection.$head);
  if (!unit) return { handled: false, moved: false };
  if (unit.isListItem) {
    return _moveListItemWithinPageFlow(editor, 'down');
  }
  return _moveNodeWithinParent(editor, {
    nodePos: unit.pos,
    node: unit.node,
    parentDepth: unit.parentDepth,
    direction: 'down',
  });
}

export function moveBlockAcrossColumnBoundary(
  editor: Editor,
  direction: 'up' | 'down',
): boolean {
  const { $from } = editor.state.selection;
  const ancestry = resolveBlockAncestry($from);
  const movable = resolveMovableBlock($from);

  if (ancestry.columnDepth === null || !movable) return false;

  const colDepth = ancestry.columnDepth;
  const shouldMoveListWrapper = movable.isListItem
    && movable.listNode
    && movable.listPos !== null
    && movable.listNode.childCount === 1;

  const blockPos = shouldMoveListWrapper ? movable.listPos! : movable.pos;
  const blockNode = shouldMoveListWrapper ? movable.listNode : movable.node;
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
