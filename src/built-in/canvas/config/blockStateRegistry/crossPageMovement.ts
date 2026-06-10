// crossPageMovement.ts — Cross-page block transfer (async persistence)
//
// Handles dropping blocks onto a pageBlock card to move or copy content
// into a linked page.  This is async persistence orchestration — fundamentally
// different from the synchronous ProseMirror transactions in blockMovement.
//
// Source-block deletion uses UniqueID-based identity rather than positional
// ranges.  This prevents stale-position bugs from dragstart → drop drift.
//
// Part of blockStateRegistry — the single authority for block state operations.

import type { Editor } from '@tiptap/core';
import {
  getActiveCanvasDragSession,
  clearActiveCanvasDragSession,
  CANVAS_BLOCK_DRAG_MIME,
  deleteDraggedSource,
} from './blockStateRegistry.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Narrow data-service shape — only the methods moveBlockToLinkedPage needs.
 * The full ICanvasDataService structurally satisfies this.
 */
export interface ICrossPageMoveDataAccess {
  appendBlocksToPage(targetPageId: string, appendedNodes: any[]): Promise<any>;
  moveBlocksBetweenPagesAtomic(params: {
    sourcePageId: string;
    targetPageId: string;
    sourceDoc: any;
    appendedNodes: any[];
  }): Promise<{ sourcePage: any; targetPage: any }>;
  /**
   * Reparent a page in the DB and re-anchor its pageBlock cards in
   * both old and new parents — all in one transaction. Needed when a
   * pageBlock is dragged across pages: a plain content move would leave
   * the child page's parent_id stale, producing "subpage in sidebar but
   * no block on parent" (or its dual on the other side).
   */
  movePageWithBlocks(opts: { pageId: string; newParentId: string | null; afterSiblingId?: string }): Promise<void>;
  fireContentReload(pageId: string): void;
}

/** Sentinel meta key. Mirror-delete transactions emitted by this module
 *  set it to true so the editor-side pageBlock reconciler can tell a
 *  cross-page move apart from a real delete and skip the auto-archive. */
export const CANVAS_CROSS_PAGE_MOVE_META = 'canvas-cross-page-move';

export interface CrossPageMoveParams {
  /** The Tiptap editor instance. */
  readonly editor: Editor;
  /** The native drop event. */
  readonly event: DragEvent;
  /** The pageId of the target pageBlock (destination page). */
  readonly targetPageId: string;
  /** The pageId of the page that owns the editor (source page). */
  readonly currentPageId: string;
  /** Data service for cross-page persistence. */
  readonly dataService: ICrossPageMoveDataAccess;
}

// ── Cross-Page Move ─────────────────────────────────────────────────────────

/**
 * Move or copy dragged block(s) into a linked page.
 *
 * Resolution order for dragged content:
 *   1. `editor.view.dragging.slice` (ProseMirror native drag)
 *   2. `DataTransfer` payload via CANVAS_BLOCK_DRAG_MIME (serialized drag data)
 *   3. Active drag session (blockHandles-initiated drag)
 *
 * Hold Alt during drop to copy instead of move.
 *
 * @returns true if the drop was handled, false if no valid drag source was found.
 */
export async function moveBlockToLinkedPage(params: CrossPageMoveParams): Promise<boolean> {
  const { editor, event, targetPageId, currentPageId, dataService } = params;

  // ── Resolve dragged nodes from available sources ──
  const dragging = editor.view.dragging;
  const dragSession = getActiveCanvasDragSession();
  const rawPayload = event.dataTransfer?.getData(CANVAS_BLOCK_DRAG_MIME) ?? '';

  let payload: { sourcePageId?: string; from?: number; to?: number; nodes?: any[] } | null = null;
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = null;
    }
  }

  if (!dragging?.slice && !dragSession && !payload) return false;

  let draggedJson: any[] = [];
  if (dragging?.slice) {
    const slice = dragging.slice;
    if (slice.openStart > 0 || slice.openEnd > 0 || slice.content.childCount === 0) return false;
    const fromSlice = slice.content.toJSON();
    if (!Array.isArray(fromSlice) || fromSlice.length === 0) return false;
    draggedJson = fromSlice;
  } else if (payload
    && payload.sourcePageId === currentPageId
    && Array.isArray(payload.nodes)
    && payload.nodes.length > 0) {
    draggedJson = payload.nodes;
  } else if (dragSession && dragSession.sourcePageId === currentPageId) {
    draggedJson = dragSession.nodes;
    if (!Array.isArray(draggedJson) || draggedJson.length === 0) return false;
  } else {
    return false;
  }

  // ── Identity-based source deletion ───────────────────────────────────────
  //
  // UniqueID extension assigns persistent `attrs.id` to every block.
  // Instead of relying on positions captured at dragstart time (which can
  // drift if any transaction fires between dragstart and drop), we extract
  // the block IDs from the dragged JSON and walk the *current* editor doc
  // to find their exact positions.  This eliminates stale-position bugs.
  //
  // Fallback: if blocks lack IDs (e.g. created before UniqueID was wired),
  // use classic position-range deletion via deleteDraggedSource.

  const shouldDeleteSource = !event.altKey;
  const blockIds = draggedJson
    .map((n: any) => n.attrs?.id)
    .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

  // ── Partition the drag set: pageBlock cards vs regular content ──────────
  //
  // A pageBlock card is not content — it IS the child page. Moving one means
  // "reparent the child page" (`movePageWithBlocks`: atomically updates the
  // child row's parent_id, strips the card from the old parent's content,
  // appends it to the new parent's). Treating a card as plain content leaves
  // the child's `parent_id` stale — the sidebar shows the page under the old
  // parent while the card lives elsewhere. The old code only special-cased
  // PURE card drags (`every(...)`); cards caught inside a MIXED drag fell
  // through to the content paths and desynced. Partitioning fixes the mixed
  // case: cards are reparented, regular blocks move as content.
  const isPageBlockCard = (n: any): boolean =>
    n?.type === 'pageBlock' && typeof n?.attrs?.pageId === 'string';
  const pageBlockNodes = draggedJson.filter(isPageBlockCard);
  const regularNodes = draggedJson.filter((n: any) => !isPageBlockCard(n));

  if (shouldDeleteSource && pageBlockNodes.length > 0) {
    try {
      for (const node of pageBlockNodes) {
        await dataService.movePageWithBlocks({
          pageId: node.attrs.pageId as string,
          newParentId: targetPageId,
        });
      }
    } catch (moveErr) {
      console.warn('[Canvas] Cross-page pageBlock reparent failed; aborting:', moveErr);
      clearActiveCanvasDragSession();
      return false;
    }
    if (regularNodes.length === 0) {
      // Pure card drag — mirror the source deletion locally. Tagged with the
      // cross-page-move meta so the editor reconciler doesn't see "pageBlock
      // removed" and archive the (already-correctly-reparented) child.
      // movePageWithBlocks already fired content-reload for both parents.
      _mirrorSourceDelete(editor, blockIds);
      clearActiveCanvasDragSession();
      return true;
    }
    // Mixed drag: cards are reparented; fall through to move the regular
    // blocks as content.
  }

  // COPY-drag (alt key): a pageBlock card cannot be duplicated as content —
  // a second card would point the same child page at two parents. Copy only
  // the regular blocks; the cards stay where they are.
  if (!shouldDeleteSource && pageBlockNodes.length > 0) {
    console.warn(
      '[Canvas] Skipped copying %d sub-page card(s) — a page cannot live in two parents. Move them instead.',
      pageBlockNodes.length,
    );
  }
  if (regularNodes.length === 0) {
    // Nothing left to transfer as content (copy-drag of cards only).
    clearActiveCanvasDragSession();
    return true;
  }

  const regularIds = regularNodes
    .map((n: any) => n.attrs?.id)
    .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
  const canUseAtomic =
    shouldDeleteSource && blockIds.length === draggedJson.length && regularIds.length === regularNodes.length;

  // ── Move path: persist atomically (single transaction) ───────────────────
  if (canUseAtomic) {
    // Strip ALL dragged ids (cards included — their reparent above already
    // pruned them from the stored source; the editor doc still shows them).
    const sourceDocPostDelete = removeNodesByIds(editor.getJSON(), new Set(blockIds));
    try {
      await dataService.moveBlocksBetweenPagesAtomic({
        sourcePageId: currentPageId,
        targetPageId,
        sourceDoc: sourceDocPostDelete,
        appendedNodes: regularNodes,
      });
    } catch (atomicErr) {
      console.warn('[Canvas] Atomic cross-page move failed; aborting:', atomicErr);
      clearActiveCanvasDragSession();
      return false;
    }

    // Mirror the deletion in the local editor so the user sees it disappear.
    // Tagged with the cross-page-move meta so the editor's pageBlock
    // reconciler treats this as relocation, not a user-initiated delete.
    _mirrorSourceDelete(editor, blockIds);

    dataService.fireContentReload(targetPageId);
    clearActiveCanvasDragSession();
    return true;
  }

  // ── Fallback path: append target, then dispatch editor delete ────────────
  // Used for: (a) copy-on-drop (alt key held), (b) blocks lacking UniqueID
  // attrs that can't be safely computed in JSON.

  // ── Paste: append blocks to target page (immediate DB write) ──
  // Only regular content blocks — pageBlock cards were either reparented
  // above (move) or skipped (copy); appending one as content would desync
  // the child's parent_id.
  try {
    await dataService.appendBlocksToPage(targetPageId, regularNodes);
  } catch (appendErr) {
    // appendBlocksToPage can throw if a side-effect listener fails
    // (e.g. pageBlock title sync) even though the DB write succeeded.
    // Log but continue — the delete must still run.
    console.warn('[Canvas] appendBlocksToPage error (continuing with delete):', appendErr);
  }
  dataService.fireContentReload(targetPageId);

  // ── Cut: delete blocks from source editor ──
  try {
    if (shouldDeleteSource) {
      const blockIds = draggedJson
        .map((n: any) => n.attrs?.id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

      const deleteTr = editor.state.tr;
      deleteTr.setMeta('addToHistory', true);
      // Tag as a cross-page move so the pageBlock reconciler treats any card
      // in the deleted set as relocated, not user-deleted (no child archive).
      deleteTr.setMeta(CANVAS_CROSS_PAGE_MOVE_META, true);

      if (blockIds.length > 0) {
        // Delete blocks by unique ID (immune to position drift)
        const idSet = new Set(blockIds);
        const toDelete: { pos: number; size: number }[] = [];
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.attrs?.id && idSet.has(node.attrs.id)) {
            toDelete.push({ pos, size: node.nodeSize });
            return false;
          }
          return true;
        });
        toDelete.sort((a, b) => b.pos - a.pos);
        for (const { pos } of toDelete) {
          const mapped = deleteTr.mapping.map(pos);
          const node = deleteTr.doc.nodeAt(mapped);
          if (node) {
            deleteTr.delete(mapped, mapped + node.nodeSize);
          }
        }
      } else {
        // Fallback for blocks without UniqueID attrs
        const dragFrom = typeof (dragging as any)?.from === 'number'
          ? (dragging as any).from
          : typeof dragSession?.from === 'number'
            ? dragSession.from
          : editor.state.selection.from;
        const dragTo = typeof (dragging as any)?.to === 'number'
          ? (dragging as any).to
          : typeof dragSession?.to === 'number'
            ? dragSession.to
          : editor.state.selection.to;
        deleteDraggedSource(deleteTr, dragFrom, dragTo);
      }

      if (deleteTr.docChanged) {
        editor.view.dispatch(deleteTr);
      }
    }

    clearActiveCanvasDragSession();
    return true;
  } catch (err) {
    console.warn('[Canvas] Failed to delete source block after cross-page move:', err);
    clearActiveCanvasDragSession();
    return true;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk a Tiptap JSON doc and return a copy with nodes whose `attrs.id` is in
 * `idSet` removed.  Preserves all other structure (columns, callouts, etc.).
 * Used to compute the post-delete source doc for atomic cross-page moves
 * without applying the deletion to the live editor first.
 */
/**
 * Mirror a cross-page block deletion in the local editor. Tags the
 * dispatched transaction with CANVAS_CROSS_PAGE_MOVE_META so the
 * editor's pageBlock-hierarchy reconciler can distinguish "block moved
 * to another page" from "block deleted by user". Without the tag the
 * reconciler would archive any pageBlock child caught in the move,
 * silently destroying user data.
 */
function _mirrorSourceDelete(editor: Editor, blockIds: string[]): void {
  if (!blockIds.length) return;
  try {
    const idSet = new Set(blockIds);
    const deleteTr = editor.state.tr;
    deleteTr.setMeta('addToHistory', true);
    deleteTr.setMeta(CANVAS_CROSS_PAGE_MOVE_META, true);
    const toDelete: { pos: number; size: number }[] = [];
    editor.state.doc.descendants((node: any, pos: number) => {
      if (node.attrs?.id && idSet.has(node.attrs.id)) {
        toDelete.push({ pos, size: node.nodeSize });
        return false;
      }
      return true;
    });
    toDelete.sort((a, b) => b.pos - a.pos);
    for (const { pos } of toDelete) {
      const mapped = deleteTr.mapping.map(pos);
      const node = deleteTr.doc.nodeAt(mapped);
      if (node) {
        deleteTr.delete(mapped, mapped + node.nodeSize);
      }
    }
    if (deleteTr.docChanged) {
      editor.view.dispatch(deleteTr);
    }
  } catch (err) {
    console.warn('[Canvas] Failed to mirror cross-page move in editor (DB already updated):', err);
  }
}

function removeNodesByIds(node: any, idSet: Set<string>): any {
  if (!node || typeof node !== 'object') return node;
  if (!Array.isArray(node.content)) return node;

  const next: any[] = [];
  for (const child of node.content) {
    if (child?.attrs?.id && idSet.has(child.attrs.id)) continue;
    next.push(removeNodesByIds(child, idSet));
  }
  return { ...node, content: next };
}
