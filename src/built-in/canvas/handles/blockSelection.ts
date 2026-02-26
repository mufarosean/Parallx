// blockSelection.ts — Block selection model
//
// Implements §5.2.2 of CANVAS_STRUCTURAL_MODEL.md:
//   • Click handle → select single block (blue highlight)
//   • Shift+Click handle → extend selection range
//   • Esc → select block at cursor
//   • Selected blocks support group delete / duplicate / move
//
// Selection is position-based. Visual feedback uses a ProseMirror Decoration
// plugin so that .block-selected classes survive PM's DOM reconciliation
// (MutationObserver re-renders).  The controller dispatches metadata-only
// transactions to update the decoration set — no manual classList calls.

import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { resolveBlockAncestry, normalizeAllColumnLists, notifyLinkedPageBlocksDeleted } from './handleRegistry.js';
import { isDevMode } from '../../../platform/devMode.js';

// ── Decoration Plugin ───────────────────────────────────────────────────────

/**
 * PluginKey for the block selection decoration plugin.
 * Shared between the Plugin (owns the DecorationSet) and the
 * BlockSelectionController (dispatches meta-transactions to update it).
 */
export const blockSelectionPluginKey = new PluginKey<DecorationSet>('blockSelection');

/**
 * Create the ProseMirror plugin that renders `.block-selected` decorations.
 *
 * How it works:
 *   1. BlockSelectionController dispatches `tr.setMeta(key, positions[])` or
 *      `tr.setMeta(key, null)` to update/clear the selection.
 *   2. The plugin's `apply` rebuilds the DecorationSet from the positions.
 *   3. PM's own rendering pipeline stamps/removes the class — no manual
 *      classList manipulation, so the MutationObserver has nothing to undo.
 */
export function createBlockSelectionPlugin(): Plugin {
  return new Plugin({
    key: blockSelectionPluginKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(blockSelectionPluginKey);
        if (meta !== undefined) {
          // Explicit update from BlockSelectionController
          if (!meta || (Array.isArray(meta) && meta.length === 0)) {
            return DecorationSet.empty;
          }
          const positions = meta as number[];
          const decorations: Decoration[] = [];
          for (const pos of positions) {
            const node = newState.doc.nodeAt(pos);
            if (node) {
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: 'block-selected',
                }),
              );
            }
          }
          return DecorationSet.create(newState.doc, decorations);
        }
        // Auto-clear on document changes (positions become stale)
        if (tr.docChanged) {
          return DecorationSet.empty;
        }
        // Remap existing decorations for selection-only changes
        return prev.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return blockSelectionPluginKey.getState(state);
      },
    },
  });
}

export interface BlockSelectionHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
}

/**
 * Tracks a set of selected block positions and renders visual indicators
 * via ProseMirror node decorations.
 *
 * Positions are absolute document positions (the "before" position of a
 * block node). They become invalid on any edit — the plugin auto-clears
 * decorations on document changes to avoid stale references.
 */
export class BlockSelectionController {
  /** Set of selected block positions (absolute doc positions). */
  private _selected = new Set<number>();

  private _editorChangeHandler: ((props: { transaction: any }) => void) | null = null;
  private _docClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(private readonly _host: BlockSelectionHost) {}

  // ── Setup / Teardown ──────────────────────────────────────────────────

  setup(): void {
    // Clear model on content edits (positions become stale).
    // The decoration plugin auto-clears its DecorationSet on docChanged,
    // so we only need to keep _selected in sync.
    this._editorChangeHandler = ({ transaction }: any) => {
      if (transaction?.docChanged && this._selected.size > 0) {
        this._selected.clear();
      }
    };
    this._host.editor?.on('update', this._editorChangeHandler!);

    // Note: _transactionHandler is no longer needed.  The decoration plugin
    // takes care of rendering — classes survive PM's DOM reconciliation.

    // Clear selection when clicking anywhere except drag-handle / action-menu UI.
    // This ensures clicking into any block content (including the selected block
    // itself) deselects — only handle interactions maintain selection.
    this._docClickHandler = (e: MouseEvent) => {
      if (this._selected.size === 0) return;       // nothing to clear
      const target = e.target as HTMLElement;
      if (
        target.closest('.drag-handle') ||
        target.closest('.block-action-menu') ||
        target.closest('.block-action-submenu')
      ) {
        return;                                     // handle / menu click → keep selection
      }
      this.clear();
    };
    this._host.editorContainer?.addEventListener('mousedown', this._docClickHandler);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Whether any blocks are currently selected. */
  get hasSelection(): boolean {
    return this._selected.size > 0;
  }

  /** Number of selected blocks. */
  get count(): number {
    return this._selected.size;
  }

  /** Snapshot of currently selected positions. */
  get positions(): number[] {
    this._sanitizeSelectionReferences();
    return [...this._selected].sort((a, b) => a - b);
  }

  /**
   * Select a single block, clearing any previous selection.
   * @param pos Absolute document position of the block node.
   */
  select(pos: number): void {
    this._selected.clear();
    this._selected.add(pos);
    this._syncDecorations();
  }

  /**
   * Select multiple blocks at once (for marquee / lasso selection).
   * Replaces any existing selection.  Single render pass — no flicker.
   */
  selectMultiple(positions: number[]): void {
    this._selected.clear();
    for (const pos of positions) {
      this._selected.add(pos);
    }
    this._syncDecorations();
  }

  /**
   * Toggle a block's selection (for Shift+Click).
   * If already selected, deselect it. Otherwise add it.
   */
  toggle(pos: number): void {
    if (this._selected.has(pos)) {
      this._selected.delete(pos);
    } else {
      this._selected.add(pos);
    }
    this._syncDecorations();
  }

  /**
   * Extend selection from current selection to the given position.
   * Selects all blocks between the anchor (first selected) and pos within
   * the same parent container.
   */
  extendTo(pos: number): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) {
      this.select(pos);
      return;
    }

    // Find the anchor (smallest currently selected position)
    const anchor = Math.min(...this._selected);
    const $anchor = editor.state.doc.resolve(anchor);
    const $target = editor.state.doc.resolve(pos);

    // Find parent container for both positions
    const anchorCtx = resolveBlockAncestry($anchor);
    const targetCtx = resolveBlockAncestry($target);

    // Only extend within the same parent container
    if (anchorCtx.containerDepth !== targetCtx.containerDepth) {
      this.select(pos);
      return;
    }

    const containerDepth = anchorCtx.containerDepth;
    const container = containerDepth === 0 ? editor.state.doc : $anchor.node(containerDepth);
    const parentPos = containerDepth === 0 ? 0 : $anchor.before(containerDepth);

    // Collect all block positions within the range
    const anchorIndex = $anchor.index(containerDepth);
    const targetIndex = $target.index(containerDepth);
    const fromIndex = Math.min(anchorIndex, targetIndex);
    const toIndex = Math.max(anchorIndex, targetIndex);

    this._selected.clear();
    let offset = parentPos + (containerDepth === 0 ? 0 : 1); // skip container open token
    for (let i = 0; i < container.childCount; i++) {
      if (i >= fromIndex && i <= toIndex) {
        this._selected.add(offset);
      }
      offset += container.child(i).nodeSize;
    }

    this._syncDecorations();
  }

  /**
   * Select the block at the current cursor position (for Esc key).
   */
  selectAtCursor(): boolean {
    const editor = this._host.editor;
    if (!editor) return false;

    const { $head } = editor.state.selection;
    const { blockDepth } = resolveBlockAncestry($head);

    if ($head.depth < blockDepth) return false;

    const blockPos = $head.before(blockDepth);
    const node = editor.state.doc.nodeAt(blockPos);
    if (!node) return false;

    this.select(blockPos);
    return true;
  }

  /**
   * Extend block selection upward by one block.
   * If no selection exists, selects the block at cursor first.
   * Returns true if the event was handled.
   */
  extendSelectionUp(): boolean {
    const editor = this._host.editor;
    if (!editor) return false;

    // Bootstrap: if nothing selected, first select the current block
    if (!this.hasSelection) {
      if (!this.selectAtCursor()) return false;
    }

    // Find the topmost selected position and the block above it
    const sorted = this.positions; // already sorted asc
    const topPos = sorted[0];
    const adjacentPos = this._findAdjacentBlockPos(topPos, 'up');
    if (adjacentPos == null) return true; // at boundary — consume event but no-op

    this.extendTo(adjacentPos);
    return true;
  }

  /**
   * Extend block selection downward by one block.
   * If no selection exists, selects the block at cursor first.
   * Returns true if the event was handled.
   */
  extendSelectionDown(): boolean {
    const editor = this._host.editor;
    if (!editor) return false;

    // Bootstrap: if nothing selected, first select the current block
    if (!this.hasSelection) {
      if (!this.selectAtCursor()) return false;
    }

    // Find the bottommost selected position and the block below it
    const sorted = this.positions; // sorted asc
    const bottomPos = sorted[sorted.length - 1];
    const adjacentPos = this._findAdjacentBlockPos(bottomPos, 'down');
    if (adjacentPos == null) return true; // at boundary — consume event but no-op

    this.extendTo(adjacentPos);
    return true;
  }

  /** Clear all selection. */
  clear(): void {
    if (this._selected.size === 0) return;
    this._selected.clear();
    this._syncDecorations();
  }

  // ── Group Operations ──────────────────────────────────────────────────

  /**
   * Delete all selected blocks.
   * Processes from last to first to maintain position validity.
   */
  deleteSelected(): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return;

    const positions = this.positions.reverse(); // process from end to start
    const { tr } = editor.state;

    // Collect page-linked nodes before deleting so we can trigger page deletion.
    const linkedNodes: any[] = [];
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (node) linkedNodes.push(node);
    }
    notifyLinkedPageBlocksDeleted(linkedNodes);

    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (node) {
        tr.delete(pos, pos + node.nodeSize);
      }
    }

    // Synchronous column cleanup — dissolve any columns that became empty
    // after the multi-block delete, and normalize parent columnLists.
    normalizeAllColumnLists(tr);

    editor.view.dispatch(tr);
    this.clear();
  }

  /**
   * Duplicate all selected blocks.
   * Each block's copy is inserted immediately after it.
   * Processes from last to first to maintain position validity.
   */
  duplicateSelected(): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return;

    const positions = this.positions.reverse();
    const { tr } = editor.state;

    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (node) {
        const clone = editor.state.schema.nodeFromJSON(node.toJSON());
        tr.insert(pos + node.nodeSize, clone);
      }
    }

    editor.view.dispatch(tr);
    this.clear();
  }

  /**
   * Move all selected blocks up by one position within their parent.
   * Returns true if handled.
   */
  moveSelectedUp(): boolean {
    return this._moveSelected('up');
  }

  /**
   * Move all selected blocks down by one position within their parent.
   * Returns true if handled.
   */
  moveSelectedDown(): boolean {
    return this._moveSelected('down');
  }

  /**
   * Deselect and place the cursor inside the first selected block
   * (Notion's Enter behavior on block selection).
   * Returns true if handled.
   */
  enterEditFirstSelected(): boolean {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return false;

    const sorted = this.positions;
    const firstPos = sorted[0];
    const node = editor.state.doc.nodeAt(firstPos);
    if (!node) return false;

    this.clear();
    // Place cursor at the start of the first block's content
    try {
      editor.commands.focus();
      const resolvedPos = editor.state.doc.resolve(firstPos + 1);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.near(resolvedPos),
        ),
      );
    } catch { /* fallback: just focus */ }

    return true;
  }

  // ── Move helper ───────────────────────────────────────────────────────

  /**
   * Move all selected blocks by one sibling position in the given direction.
   * All selected blocks must share the same parent container.  If any block
   * is at the boundary, the move is a no-op (returns true to consume the event).
   */
  private _moveSelected(direction: 'up' | 'down'): boolean {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return false;

    const sorted = this.positions; // sorted asc

    // Resolve the parent container of the first selected block
    const $first = editor.state.doc.resolve(sorted[0]);
    const { containerDepth } = resolveBlockAncestry($first);
    const container = containerDepth === 0 ? editor.state.doc : $first.node(containerDepth);
    const parentPos = containerDepth === 0 ? 0 : $first.before(containerDepth);

    // Build a list of child positions in the container
    const childPositions: number[] = [];
    let off = parentPos + (containerDepth === 0 ? 0 : 1);
    for (let i = 0; i < container.childCount; i++) {
      childPositions.push(off);
      off += container.child(i).nodeSize;
    }

    // Find indices of selected blocks within the container
    const selectedSet = new Set(sorted);
    const selectedIndices = childPositions
      .map((pos, idx) => selectedSet.has(pos) ? idx : -1)
      .filter(idx => idx >= 0);

    if (selectedIndices.length === 0) return false;

    // Boundary check
    if (direction === 'up' && selectedIndices[0] <= 0) return true;
    if (direction === 'down' && selectedIndices[selectedIndices.length - 1] >= container.childCount - 1) return true;

    // Compute the new indices the selected blocks will occupy after the swap
    const newIndices = selectedIndices.map(i => direction === 'up' ? i - 1 : i + 1);

    // Build and dispatch the move transaction
    const { tr } = editor.state;

    if (direction === 'up') {
      // Remove the block above the selection and insert it after the selection
      const swapIndex = selectedIndices[0] - 1;
      const swapPos = childPositions[swapIndex];
      const swapNode = tr.doc.nodeAt(swapPos);
      if (!swapNode) return false;

      const lastSelIdx = selectedIndices[selectedIndices.length - 1];
      const lastSelNode = tr.doc.nodeAt(childPositions[lastSelIdx]);
      if (!lastSelNode) return false;
      const insertAfter = childPositions[lastSelIdx] + lastSelNode.nodeSize;

      const swapCopy = swapNode.type.create(swapNode.attrs, swapNode.content, swapNode.marks);
      tr.delete(swapPos, swapPos + swapNode.nodeSize);
      const mappedInsert = tr.mapping.map(insertAfter);
      tr.insert(mappedInsert, swapCopy);
    } else {
      // Remove the block below the selection and insert it before the selection
      const lastSelIdx = selectedIndices[selectedIndices.length - 1];
      const swapIndex = lastSelIdx + 1;
      const swapPos = childPositions[swapIndex];
      const swapNode = tr.doc.nodeAt(swapPos);
      if (!swapNode) return false;

      const firstSelPos = childPositions[selectedIndices[0]];

      const swapCopy = swapNode.type.create(swapNode.attrs, swapNode.content, swapNode.marks);
      tr.delete(swapPos, swapPos + swapNode.nodeSize);
      const mappedInsert = tr.mapping.map(firstSelPos);
      tr.insert(mappedInsert, swapCopy);
    }

    // Dispatch — docChanged handler will clear _selected, decoration plugin
    // will auto-clear.  We immediately re-select at the new positions.
    editor.view.dispatch(tr);

    // Re-walk the (now updated) container to find positions at newIndices
    const newContainer = containerDepth === 0
      ? editor.state.doc
      : editor.state.doc.nodeAt(parentPos);
    if (!newContainer) { this.clear(); return true; }

    const resolvedContainer = containerDepth === 0 ? editor.state.doc : newContainer;
    const newChildPositions: number[] = [];
    let newOff = parentPos + (containerDepth === 0 ? 0 : 1);
    for (let i = 0; i < resolvedContainer.childCount; i++) {
      newChildPositions.push(newOff);
      newOff += resolvedContainer.child(i).nodeSize;
    }

    const reselect = newIndices
      .filter(idx => idx >= 0 && idx < newChildPositions.length)
      .map(idx => newChildPositions[idx]);

    if (reselect.length > 0) {
      this.selectMultiple(reselect);
    } else {
      this.clear();
    }

    return true;
  }

  /**
   * Dispatch a metadata-only transaction that tells the decoration plugin
   * which block positions should have `.block-selected`.  If `_selected`
   * is empty the plugin receives `null` and clears all decorations.
   */
  private _syncDecorations(): void {
    const editor = this._host.editor;
    if (!editor) return;
    this._sanitizeSelectionReferences();
    const positions = this._selected.size > 0 ? [...this._selected] : null;
    const tr = editor.state.tr.setMeta(blockSelectionPluginKey, positions);
    // Prevent this housekeeping transaction from being recorded in undo history
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  }

  /**
   * Find the position of the adjacent block above or below the given pos.
   * Stays within the same parent container. Returns null if at boundary.
   */
  private _findAdjacentBlockPos(pos: number, direction: 'up' | 'down'): number | null {
    const editor = this._host.editor;
    if (!editor) return null;

    const $pos = editor.state.doc.resolve(pos);
    const { containerDepth } = resolveBlockAncestry($pos);
    const container = containerDepth === 0 ? editor.state.doc : $pos.node(containerDepth);
    const parentPos = containerDepth === 0 ? 0 : $pos.before(containerDepth);
    const index = $pos.index(containerDepth);

    if (direction === 'up') {
      if (index <= 0) return null; // already first child
      // Walk to the previous sibling's start position
      let offset = parentPos + (containerDepth === 0 ? 0 : 1);
      for (let i = 0; i < index - 1; i++) {
        offset += container.child(i).nodeSize;
      }
      return offset;
    } else {
      if (index >= container.childCount - 1) return null; // already last child
      // Walk to the next sibling's start position
      let offset = parentPos + (containerDepth === 0 ? 0 : 1);
      for (let i = 0; i <= index; i++) {
        offset += container.child(i).nodeSize;
      }
      return offset;
    }
  }

  /**
   * Sanitize stale references — remove positions where doc.nodeAt returns null.
   */
  private _sanitizeSelectionReferences(): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return;

    const stale: number[] = [];
    for (const pos of this._selected) {
      const node = editor.state.doc.nodeAt(pos);
      if (!node) {
        stale.push(pos);
      }
    }

    if (stale.length === 0) return;

    for (const pos of stale) {
      this._selected.delete(pos);
    }

    if (isDevMode) {
      console.warn('[Canvas Invariants] Dropped stale block selection references', { stale });
    }
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    // Clear decorations before teardown
    if (this._selected.size > 0) {
      this._selected.clear();
      const editor = this._host.editor;
      if (editor) {
        try {
          const tr = editor.state.tr.setMeta(blockSelectionPluginKey, null);
          tr.setMeta('addToHistory', false);
          editor.view.dispatch(tr);
        } catch { /* editor may already be destroyed */ }
      }
    }
    if (this._editorChangeHandler) {
      this._host.editor?.off('update', this._editorChangeHandler);
      this._editorChangeHandler = null;
    }
    if (this._docClickHandler) {
      this._host.editorContainer?.removeEventListener('mousedown', this._docClickHandler);
      this._docClickHandler = null;
    }
  }
}

// ── Shared utility ──────────────────────────────────────────────────────────
// resolveBlockAncestry is imported from handleRegistry (source: columnInvariants.ts).
// It replaces the former local findBlockContext() — same depth-walk, but shared
// across the entire BSR and handle layer.
