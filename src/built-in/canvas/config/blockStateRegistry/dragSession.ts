// dragSession.ts — Shared drag state channel
//
// Simple get/set/clear singleton that bridges drag-start (blockHandles)
// and drop handlers (columnDropPlugin, pageBlockNode, crossPageMovement).
//
// Part of blockStateRegistry — the single authority for block state operations.

// ── Types ───────────────────────────────────────────────────────────────────

export interface CanvasDragSession {
  readonly sourcePageId: string;
  readonly from: number;
  readonly to: number;
  readonly nodes: any[];
  readonly startedAt: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const CANVAS_BLOCK_DRAG_MIME = 'application/x-parallx-canvas-block-drag';

// ── Singleton State ─────────────────────────────────────────────────────────

let _activeSession: CanvasDragSession | null = null;

export function setActiveCanvasDragSession(session: CanvasDragSession): void {
  _activeSession = session;
}

export function getActiveCanvasDragSession(): CanvasDragSession | null {
  return _activeSession;
}

export function clearActiveCanvasDragSession(): void {
  _activeSession = null;
}
