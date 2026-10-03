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
  /**
   * Each dragged block's own range, in document order.  A multi-block drag
   * of a non-contiguous selection is NOT the span from..to: the blocks
   * between the selected ones stay where they are.
   */
  readonly ranges?: ReadonlyArray<DragRange>;
  readonly nodes: any[];
  readonly listType?: 'bulletList' | 'orderedList' | 'taskList';
  readonly startedAt: number;
}

export interface DragRange {
  readonly from: number;
  readonly to: number;
}

/** The ranges a drag removes: its own ranges, else the single from..to span. */
export function dragRangesOf(from: number, to: number, ranges?: ReadonlyArray<DragRange> | null): DragRange[] {
  if (ranges && ranges.length > 0) return [...ranges].sort((a, b) => a.from - b.from);
  return [{ from, to }];
}

/** Whether the dragged ranges sit back to back (one block, or adjacent blocks). */
export function dragRangesContiguous(ranges: ReadonlyArray<DragRange>): boolean {
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from !== ranges[i - 1].to) return false;
  }
  return true;
}

/**
 * Whether dropping at `pos` would leave the dragged blocks where they are:
 * inside a dragged block, or at the edge of a contiguous run of them.
 */
export function isDropInsideDragged(pos: number, ranges: ReadonlyArray<DragRange>): boolean {
  if (ranges.some((r) => pos > r.from && pos < r.to)) return true;
  if (dragRangesContiguous(ranges)) {
    return pos >= ranges[0].from && pos <= ranges[ranges.length - 1].to;
  }
  return false;
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
