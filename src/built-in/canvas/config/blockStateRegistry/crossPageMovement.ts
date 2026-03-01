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
}

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

  // ── Paste: append blocks to target page (immediate DB write) ──
  try {
    await dataService.appendBlocksToPage(targetPageId, draggedJson);
  } catch (appendErr) {
    // appendBlocksToPage can throw if a side-effect listener fails
    // (e.g. pageBlock title sync) even though the DB write succeeded.
    // Log but continue — the delete must still run.
    console.warn('[Canvas] appendBlocksToPage error (continuing with delete):', appendErr);
  }

  // ── Cut: delete blocks from source editor ──
  try {
    if (shouldDeleteSource) {
      const blockIds = draggedJson
        .map((n: any) => n.attrs?.id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

      const deleteTr = editor.state.tr;
      deleteTr.setMeta('addToHistory', true);

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
