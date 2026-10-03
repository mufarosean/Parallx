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
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  resolveBlockAncestry,
  resolveMovableBlock,
  isListItemNodeName,
  PAGE_CONTAINERS,
  cleanupEmptyColumn,
  deleteDraggedRanges,
  dragRangesOf,
  type DragRange,
  type MovableBlockContext,
} from './blockStateRegistry.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BlockMoveResult {
  handled: boolean;
  moved: boolean;
}

function _wrapListFragment(schema: any, listType: 'bulletList' | 'orderedList' | 'taskList', items: any, attrs?: any): any {
  const listNodeType = schema.nodes[listType];
  if (!listNodeType) {
    throw new Error(`Missing schema node for ${listType}`);
  }
  // A new list: the source list's numbering and colour, never its id.
  const { id: _id, ...rest } = attrs ?? {};
  return listNodeType.create(attrs ? rest : null, items);
}

/**
 * Safely dispatch a Tiptap transaction and report success (M77 Phase 4).
 *
 * Dispatch can throw if a plugin's appendTransaction / filter throws, or
 * if positions in the tr are invalid for the current doc. Previously
 * every movement primitive called `editor.view.dispatch(tr)` raw and
 * unconditionally returned `moved: true` — any failure was invisible to
 * the caller and the user saw a silently-no-op keyboard shortcut.
 *
 * This wrapper catches dispatch errors, logs them, and returns false so
 * callers can surface a failure or fall back to a different strategy.
 */
function _safeDispatch(editor: Editor, tr: any, opLabel: string): boolean {
  try {
    editor.view.dispatch(tr);
    return true;
  } catch (err) {
    console.warn(`[blockMovement] ${opLabel} dispatch failed:`, err);
    return false;
  }
}

/**
 * Bounds-check positions before they're used in a transaction (M77 Phase 4).
 * Returns true when both positions are non-negative and within the doc
 * size. Catches stale-position bugs where the caller's resolved positions
 * predate intermediate plugin transactions.
 */
function _validPositions(tr: any, ...positions: number[]): boolean {
  const docSize = tr.doc.content.size;
  for (const p of positions) {
    if (!Number.isFinite(p) || p < 0 || p > docSize) return false;
  }
  return true;
}

// ── Selection: the unit being moved, and where the caret goes after ─────────

/**
 * The block a keyboard move acts on.  A caret resolves through the unit
 * resolver; a NODE selection (an image, equation, divider, bookmark…
 * clicked or chosen with the handle) is that node itself.  The resolver
 * alone returned null for a node selection, so Mod-Shift-↑/↓ did nothing
 * on every atom block.
 */
function _selectedUnit(state: any): MovableBlockContext | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.isBlock) {
    const node = sel.node;
    if (isListItemNodeName(node.type.name)) {
      return resolveMovableBlock(state.doc.resolve(sel.from + 1));
    }
    const $from = sel.$from;
    const parentDepth = $from.depth;
    return {
      ...resolveBlockAncestry($from),
      pos: sel.from,
      node,
      depth: parentDepth + 1,
      parentDepth,
      parentPos: parentDepth === 0 ? 0 : $from.before(parentDepth),
      parentNode: $from.parent,
      isListItem: false,
      listDepth: null,
      listPos: null,
      listNode: null,
      listType: null,
    };
  }
  return resolveMovableBlock(sel.$head);
}

/**
 * Put the selection back on the moved block: a node selection stays a node
 * selection, a caret keeps its offset inside the block.  The old code set
 * the caret at "near the block's start" with a mapping that pointed PAST
 * the moved block (map(pos) after an insert at pos lands after it), so the
 * next press moved the block below instead — or threw at the end of the doc.
 */
function _restoreSelection(tr: any, oldSel: any, oldBase: number, newBase: number): void {
  try {
    if (oldSel instanceof NodeSelection) {
      const shifted = oldSel.from - oldBase + newBase;
      const node = tr.doc.nodeAt(shifted);
      if (node && node.type === oldSel.node.type) {
        tr.setSelection(NodeSelection.create(tr.doc, shifted));
        return;
      }
    }
    const $anchor = tr.doc.resolve(oldSel.anchor - oldBase + newBase);
    const $head = tr.doc.resolve(oldSel.head - oldBase + newBase);
    if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) throw new Error('not in text');
    tr.setSelection(TextSelection.between($anchor, $head));
  } catch {
    const size = tr.doc.content.size;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, Math.min(newBase + 1, size)))));
  }
}

function _moveNodeWithinParent(editor: Editor, params: {
  nodePos: number;
  node: any;
  parentDepth: number;
  direction: 'up' | 'down';
  /** Position the selection is measured from (the unit inside a moved wrapper). */
  selectionBase?: number;
}): BlockMoveResult {
  const { state } = editor;
  const { nodePos, node, parentDepth, direction } = params;
  const $nodeStart = state.doc.resolve(nodePos);
  const parentNode = parentDepth === 0 ? state.doc : $nodeStart.node(parentDepth);
  const index = $nodeStart.index(parentDepth);
  const oldSel = state.selection;
  const selBase = params.selectionBase ?? nodePos;

  if (direction === 'up') {
    if (index <= 0) return { handled: true, moved: false };

    const prevSibling = parentNode.child(index - 1);
    const targetPos = nodePos - prevSibling.nodeSize;

    const tr = state.tr;
    if (!_validPositions(tr, nodePos, nodePos + node.nodeSize, targetPos)) {
      return { handled: true, moved: false };
    }
    tr.delete(nodePos, nodePos + node.nodeSize);
    tr.insert(targetPos, node);
    _restoreSelection(tr, oldSel, nodePos, targetPos + (selBase - nodePos));
    if (!_safeDispatch(editor, tr, 'moveNodeWithinParent/up')) {
      return { handled: true, moved: false };
    }
    return { handled: true, moved: true };
  }

  if (index >= parentNode.childCount - 1) return { handled: true, moved: false };

  const nextSibling = parentNode.child(index + 1);
  const afterNextPos = nodePos + node.nodeSize + nextSibling.nodeSize;

  const tr = state.tr;
  if (!_validPositions(tr, nodePos, nodePos + node.nodeSize, afterNextPos)) {
    return { handled: true, moved: false };
  }
  tr.insert(afterNextPos, node);
  tr.delete(nodePos, nodePos + node.nodeSize);

  // The moved copy starts where the next sibling ended, less the removed node.
  const newNodePos = afterNextPos - node.nodeSize;
  _restoreSelection(tr, oldSel, nodePos, newNodePos + (selBase - nodePos));
  if (!_safeDispatch(editor, tr, 'moveNodeWithinParent/down')) {
    return { handled: true, moved: false };
  }
  return { handled: true, moved: true };
}

/**
 * A list row moving past its list's edge leaves the list as a one-row list
 * of its own type and swaps with the block beyond the list (Notion).  The
 * old code inserted that one-row list right next to the list it came from,
 * where the join plugin merged it straight back: the first row never moved
 * up and the last row never moved down.
 */
function _moveListItemWithinPageFlow(editor: Editor, unit: MovableBlockContext, direction: 'up' | 'down'): BlockMoveResult {
  const { state } = editor;
  if (!unit.isListItem || !unit.listNode || !unit.listType || unit.listPos === null) {
    return { handled: false, moved: false };
  }

  const itemIndex = state.doc.resolve(unit.pos).index(unit.parentDepth);
  const listNode = unit.listNode;

  if (direction === 'up' && itemIndex > 0) {
    return _moveNodeWithinParent(editor, { nodePos: unit.pos, node: unit.node, parentDepth: unit.parentDepth, direction });
  }
  if (direction === 'down' && itemIndex < listNode.childCount - 1) {
    return _moveNodeWithinParent(editor, { nodePos: unit.pos, node: unit.node, parentDepth: unit.parentDepth, direction });
  }

  const outerParentDepth = unit.parentDepth - 1;
  if (outerParentDepth < 0) return { handled: true, moved: false };

  if (listNode.childCount === 1) {
    const moved = _moveNodeWithinParent(editor, {
      nodePos: unit.listPos,
      node: listNode,
      parentDepth: outerParentDepth,
      direction,
      selectionBase: unit.pos,
    });
    if (moved.moved) return moved;
    return _liftRowOutOfNestedList(editor, unit, direction);
  }

  // The row leaves its list: swap it with the list's neighbour outside.
  const $list = state.doc.resolve(unit.listPos);
  const outer = $list.parent;
  const listIndex = $list.index($list.depth);
  const neighbourIndex = direction === 'up' ? listIndex - 1 : listIndex + 1;
  if (neighbourIndex < 0 || neighbourIndex >= outer.childCount) {
    return _liftRowOutOfNestedList(editor, unit, direction);
  }
  const neighbour = outer.child(neighbourIndex);
  const wrappedList = _wrapListFragment(state.schema, unit.listType, unit.node, listNode.attrs);

  const tr = state.tr;
  const listEnd = unit.listPos + listNode.nodeSize;
  const insertAt = direction === 'up' ? unit.listPos - neighbour.nodeSize : listEnd + neighbour.nodeSize;
  if (!_validPositions(tr, unit.pos, unit.pos + unit.node.nodeSize, insertAt)) {
    return { handled: true, moved: false };
  }
  const oldSel = state.selection;
  let wrapperPos: number;
  if (direction === 'up') {
    tr.delete(unit.pos, unit.pos + unit.node.nodeSize);
    tr.insert(insertAt, wrappedList);
    wrapperPos = insertAt;
  } else {
    tr.insert(insertAt, wrappedList);
    tr.delete(unit.pos, unit.pos + unit.node.nodeSize);
    wrapperPos = insertAt - unit.node.nodeSize;
  }
  _restoreSelection(tr, oldSel, unit.pos, wrapperPos + 1);
  if (!_safeDispatch(editor, tr, 'moveListItemWithinPageFlow')) {
    return { handled: true, moved: false };
  }
  return { handled: true, moved: true };
}

/**
 * A nested row at the edge of its sub-list steps out to the parent level:
 * above (below) the row that holds the sub-list, as a row of the parent
 * list.  Only when the row fits there (a to-do row can't sit in a bullet
 * list); otherwise it stays.
 */
function _liftRowOutOfNestedList(editor: Editor, unit: MovableBlockContext, direction: 'up' | 'down'): BlockMoveResult {
  const { state } = editor;
  if (unit.listPos === null || !unit.listNode) return { handled: true, moved: false };
  const $list = state.doc.resolve(unit.listPos);
  const parentRowDepth = $list.depth;
  if (parentRowDepth < 2) return { handled: true, moved: false };
  const parentRow = $list.node(parentRowDepth);
  const grandList = $list.node(parentRowDepth - 1);
  if (!isListItemNodeName(parentRow.type.name)) return { handled: true, moved: false };
  if (!grandList.type.contentMatch.matchType(unit.node.type)) return { handled: true, moved: false };

  const parentRowPos = $list.before(parentRowDepth);
  const parentRowEnd = parentRowPos + parentRow.nodeSize;
  // The row leaves; its sub-list goes too when this was its only row.
  const removeFrom = unit.listNode.childCount === 1 ? unit.listPos : unit.pos;
  const removeTo = unit.listNode.childCount === 1 ? unit.listPos + unit.listNode.nodeSize : unit.pos + unit.node.nodeSize;

  const tr = state.tr;
  const oldSel = state.selection;
  let newPos: number;
  if (direction === 'up') {
    tr.delete(removeFrom, removeTo);
    tr.insert(parentRowPos, unit.node);
    newPos = parentRowPos;
  } else {
    tr.insert(parentRowEnd, unit.node);
    tr.delete(removeFrom, removeTo);
    newPos = parentRowEnd - (removeTo - removeFrom);
  }
  _restoreSelection(tr, oldSel, unit.pos, newPos);
  if (!_safeDispatch(editor, tr, 'liftRowOutOfNestedList')) return { handled: true, moved: false };
  return { handled: true, moved: true };
}

/**
 * A block at the top (bottom) of a callout, quote or toggle steps out of it
 * and lands directly above (below) the container (Notion).  The container
 * keeps an empty paragraph when this was its only block.  Columns are not
 * containers here: crossing a column edge is moveBlockAcrossColumnBoundary.
 */
function _moveOutOfContainer(editor: Editor, unit: MovableBlockContext, direction: 'up' | 'down'): BlockMoveResult {
  const { state } = editor;
  if (unit.parentDepth < 1) return { handled: true, moved: false };
  const $unit = state.doc.resolve(unit.pos);
  const parent = $unit.node(unit.parentDepth);
  const parentName = parent.type.name;
  let containerDepth = unit.parentDepth;
  if (parentName === 'detailsContent') containerDepth = unit.parentDepth - 1;
  else if (!PAGE_CONTAINERS.has(parentName) || parentName === 'column') return { handled: true, moved: false };
  if (containerDepth < 1) return { handled: true, moved: false };

  const container = $unit.node(containerDepth);
  const containerPos = $unit.before(containerDepth);
  const containerEnd = containerPos + container.nodeSize;
  const onlyChild = parent.childCount === 1;

  const tr = state.tr;
  const oldSel = state.selection;
  const removeSource = () => {
    if (onlyChild) {
      const filler = state.schema.nodes.paragraph.create();
      tr.replaceWith(tr.mapping.map(unit.pos), tr.mapping.map(unit.pos + unit.node.nodeSize), filler);
    } else {
      tr.delete(tr.mapping.map(unit.pos), tr.mapping.map(unit.pos + unit.node.nodeSize));
    }
  };
  let newPos: number;
  if (direction === 'up') {
    tr.insert(containerPos, unit.node);
    removeSource();
    newPos = containerPos;
  } else {
    removeSource();
    newPos = tr.mapping.map(containerEnd);
    tr.insert(newPos, unit.node);
  }
  _restoreSelection(tr, oldSel, unit.pos, newPos);
  if (!_safeDispatch(editor, tr, 'moveOutOfContainer')) return { handled: true, moved: false };
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

function _moveWithinPageFlow(editor: Editor, direction: 'up' | 'down'): BlockMoveResult {
  const unit = _selectedUnit(editor.state);
  if (!unit) return { handled: false, moved: false };
  if (unit.isListItem) {
    return _moveListItemWithinPageFlow(editor, unit, direction);
  }
  const result = _moveNodeWithinParent(editor, {
    nodePos: unit.pos,
    node: unit.node,
    parentDepth: unit.parentDepth,
    direction,
  });
  if (result.moved) return result;
  return _moveOutOfContainer(editor, unit, direction);
}

export function moveBlockUpWithinPageFlow(editor: Editor): BlockMoveResult {
  return _moveWithinPageFlow(editor, 'up');
}

export function moveBlockDownWithinPageFlow(editor: Editor): BlockMoveResult {
  return _moveWithinPageFlow(editor, 'down');
}

/**
 * The block is at the top (bottom) of its column: it leaves the column
 * layout and lands directly above (below) it.  A column the move empties is
 * removed, and a layout left with one column dissolves into its blocks.
 */
export function moveBlockAcrossColumnBoundary(
  editor: Editor,
  direction: 'up' | 'down',
): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const ancestry = resolveBlockAncestry($from);
  const movable = _selectedUnit(state);

  if (ancestry.columnDepth === null || !movable) return false;

  const colDepth = ancestry.columnDepth;
  // Only a block that is a direct child of the column (or a row of a list
  // that is) crosses the column edge — a block inside a callout in a column
  // stays in its callout.
  const unitParentDepth = movable.isListItem ? (movable.listDepth ?? -1) - 1 : movable.parentDepth;
  if (unitParentDepth !== colDepth) return false;

  // A row leaves as a one-row list of its own type; a list's only row takes
  // its list along.
  let sourcePos = movable.pos;
  let sourceNode = movable.node;
  let blockNode = movable.node;
  if (movable.isListItem && movable.listNode && movable.listPos !== null && movable.listType) {
    if (movable.listNode.childCount === 1) {
      sourcePos = movable.listPos;
      sourceNode = movable.listNode;
      blockNode = movable.listNode;
    } else {
      blockNode = _wrapListFragment(state.schema, movable.listType as any, movable.node, movable.listNode.attrs);
    }
  }
  if (!sourceNode) return false;

  const colPos = $from.before(colDepth);
  const clDepth = ancestry.columnListDepth!;
  const clPos = $from.before(clDepth);
  const clNode = $from.node(clDepth);
  const oldSel = state.selection;
  const selBase = movable.pos;
  const tr = state.tr;

  if (!_validPositions(tr, sourcePos, sourcePos + sourceNode.nodeSize)) return false;
  tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);

  // Remove the column if the move emptied it (normalizes its layout too).
  cleanupEmptyColumn(tr, tr.mapping.map(colPos, 1), clPos);

  // Land beside the layout — or beside its blocks, when it dissolved.
  const insertPos = direction === 'up'
    ? tr.mapping.map(clPos, -1)
    : tr.mapping.map(clPos + clNode.nodeSize, 1);
  if (!_validPositions(tr, insertPos)) return false;
  tr.insert(insertPos, blockNode);

  // The moved node starts at insertPos; the unit inside a one-row wrapper
  // sits one deeper.
  const unitOffset = blockNode === movable.node || blockNode === sourceNode ? selBase - sourcePos : 1;
  _restoreSelection(tr, oldSel, selBase, insertPos + unitOffset);

  return _safeDispatch(editor, tr, 'moveBlockAcrossColumnBoundary');
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
  ranges?: ReadonlyArray<DragRange>,
): void {
  tr.insert(insertPos, content);
  if (!isDuplicate) deleteDraggedRanges(tr, dragRangesOf(dragFrom, dragTo, ranges));
}
