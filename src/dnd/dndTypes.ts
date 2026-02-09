// dndTypes.ts — drag-and-drop types

import { Event } from '../platform/events.js';
import { IDisposable } from '../platform/lifecycle.js';

// ── Drop Position ────────────────────────────────────────────────────────────────

/**
 * Where a drop lands relative to its target.
 *
 * - Center: merge into the target
 * - Top/Bottom: split vertically
 * - Left/Right: split horizontally
 */
export enum DropPosition {
  Center = 'center',
  Top = 'top',
  Bottom = 'bottom',
  Left = 'left',
  Right = 'right',
}

// ── Drag Data ──────────────────────────────────────────────────────────────────

/**
 * MIME type used in DataTransfer for view DnD payloads.
 */
export const VIEW_DRAG_MIME = 'application/parallx-view';

/**
 * Payload attached to the drag event.
 */
export interface DragPayload {
  /** The view ID being dragged. */
  readonly viewId: string;
  /** The source part ID the view is dragged from. */
  readonly sourcePartId: string;
}

// ── Drop Target ────────────────────────────────────────────────────────────────

/**
 * A resolved drop result: the target part, the drop position, and the
 * drag payload.
 */
export interface DropResult {
  readonly payload: DragPayload;
  readonly targetPartId: string;
  readonly position: DropPosition;
}

// ── IDropTarget ───────────────────────────────────────────────────────────────

/**
 * Interface for elements that can accept drops.
 */
export interface IDropTarget extends IDisposable {
  /** The part ID this target represents. */
  readonly partId: string;

  /** The DOM element that acts as the drop target. */
  readonly element: HTMLElement;

  /** Whether this target currently accepts the given payload. */
  accepts(payload: DragPayload): boolean;

  /** Fires when a drop completes on this target. */
  readonly onDidDrop: Event<DropResult>;
}
