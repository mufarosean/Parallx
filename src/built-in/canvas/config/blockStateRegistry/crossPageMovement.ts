// crossPageMovement.ts — Cross-page block transfer (async persistence)
//
// Handles dropping blocks onto a pageBlock card to move or copy content
// into a linked page.  This is async persistence orchestration — fundamentally
// different from the synchronous ProseMirror transactions in blockMovement.
//
// Part of blockStateRegistry — the single authority for block state operations.

import type { Editor } from '@tiptap/core';
import {
  getActiveCanvasDragSession,
  clearActiveCanvasDragSession,
  CANVAS_BLOCK_DRAG_MIME,
} from './blockStateRegistry.js';
import { deleteDraggedSource } from './columnInvariants.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Narrow data-service shape — only the methods moveBlockToLinkedPage needs.
 * The full ICanvasDataService structurally satisfies this.
 */
export interface ICrossPageMoveDataAccess {
  moveBlocksBetweenPagesAtomic(params: {
    sourcePageId: string;
    targetPageId: string;
    sourceDoc: any;
    appendedNodes: any[];
  }): Promise<any>;
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

  // ── Resolve source positions ──
  const dragFrom = typeof (dragging as any)?.from === 'number'
    ? (dragging as any).from
    : typeof payload?.from === 'number'
      ? payload.from
    : typeof dragSession?.from === 'number'
      ? dragSession.from
    : editor.state.selection.from;
  const dragTo = typeof (dragging as any)?.to === 'number'
    ? (dragging as any).to
    : typeof payload?.to === 'number'
      ? payload.to
    : typeof dragSession?.to === 'number'
      ? dragSession.to
    : editor.state.selection.to;

  const shouldDeleteSource = !event.altKey;

  try {
    if (shouldDeleteSource) {
      const deleteTr = editor.state.tr;
      deleteTr.setMeta('addToHistory', true);
      deleteDraggedSource(deleteTr, dragFrom, dragTo);
      if (!deleteTr.docChanged) return false;

      await dataService.moveBlocksBetweenPagesAtomic({
        sourcePageId: currentPageId,
        targetPageId,
        sourceDoc: deleteTr.doc.toJSON(),
        appendedNodes: draggedJson,
      });

      editor.view.dispatch(deleteTr);
      clearActiveCanvasDragSession();
      return true;
    }

    await dataService.appendBlocksToPage(targetPageId, draggedJson);
    clearActiveCanvasDragSession();
    return true;
  } catch (err) {
    console.warn('[Canvas] Failed to move dropped block into linked page:', err);
    return false;
  }
}
