// dragAndDrop.ts — drag-and-drop coordination

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import {
  DragPayload,
  DropResult,
  IDropTarget,
  VIEW_DRAG_MIME,
} from './dndTypes.js';
import { DropZone } from './dropZone.js';

/**
 * Coordinates view drag-and-drop across the workbench.
 *
 * Responsibilities:
 * - Initiates drags on view elements (sets DataTransfer payload).
 * - Registers drop targets (parts) and routes drop results.
 * - Emits global DnD lifecycle events.
 */
export class DragAndDropController extends Disposable {

  /** All active drop targets indexed by part ID. */
  private readonly _targets = new Map<string, IDropTarget>();

  // ── Events ──

  private readonly _onDidDragStart = this._register(new Emitter<DragPayload>());
  /** Fires when a drag begins. */
  readonly onDidDragStart: Event<DragPayload> = this._onDidDragStart.event;

  private readonly _onDidDropComplete = this._register(new Emitter<DropResult>());
  /** Fires when a drop successfully completes. */
  readonly onDidDropComplete: Event<DropResult> = this._onDidDropComplete.event;

  private readonly _onDidDragEnd = this._register(new Emitter<void>());
  /** Fires when a drag ends (dropped or cancelled). */
  readonly onDidDragEnd: Event<void> = this._onDidDragEnd.event;

  // ── Drag initiation ──

  /**
   * Make an element draggable for a view.
   *
   * Call this on view tab elements or any drag handle. The returned
   * disposable removes the listeners when the element is no longer needed.
   *
   * @param element - The DOM element to make draggable.
   * @param payload - The drag payload (viewId + sourcePartId).
   */
  makeDraggable(element: HTMLElement, payload: DragPayload): void {
    element.draggable = true;
    element.setAttribute('aria-grabbed', 'false');

    const onDragStart = (e: DragEvent): void => {
      if (!e.dataTransfer) return;

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(VIEW_DRAG_MIME, JSON.stringify(payload));

      // Optional: style the element being dragged
      element.classList.add('dragging');
      element.setAttribute('aria-grabbed', 'true');

      this._onDidDragStart.fire(payload);
    };

    const onDragEnd = (): void => {
      element.classList.remove('dragging');
      element.setAttribute('aria-grabbed', 'false');
      this._onDidDragEnd.fire();
    };

    element.addEventListener('dragstart', onDragStart);
    element.addEventListener('dragend', onDragEnd);

    this._register({
      dispose: () => {
        element.removeEventListener('dragstart', onDragStart);
        element.removeEventListener('dragend', onDragEnd);
        element.draggable = false;
      },
    });
  }

  // ── Drop target registration ──

  /**
   * Register a part element as a drop target.
   *
   * Returns the created {@link DropZone} so the caller can listen
   * for local drop events if needed.
   */
  registerTarget(
    partId: string,
    element: HTMLElement,
    acceptFn?: (payload: DragPayload) => boolean,
  ): DropZone {
    // Remove existing target for this part
    this.unregisterTarget(partId);

    const zone = new DropZone(partId, element, acceptFn);
    this._targets.set(partId, zone);

    // Forward drop events to the global stream
    this._register(zone.onDidDrop((result) => {
      this._onDidDropComplete.fire(result);
    }));

    return zone;
  }

  /**
   * Remove a previously registered drop target.
   */
  unregisterTarget(partId: string): void {
    const existing = this._targets.get(partId);
    if (existing) {
      existing.dispose();
      this._targets.delete(partId);
    }
  }

  // ── Keyboard accessibility ──

  /**
   * Programmatically initiate a "drop" for keyboard users.
   *
   * This bypasses the HTML5 DnD API and directly fires a drop result.
   */
  performKeyboardDrop(payload: DragPayload, targetPartId: string, position: import('./dndTypes.js').DropPosition): void {
    const target = this._targets.get(targetPartId);
    if (!target) return;
    if (!target.accepts(payload)) return;

    const result: DropResult = { payload, targetPartId, position };
    this._onDidDropComplete.fire(result);
  }

  // ── Query ──

  /** Get all registered target part IDs. */
  getTargetIds(): readonly string[] {
    return [...this._targets.keys()];
  }

  /** Check if a part is registered as a drop target. */
  hasTarget(partId: string): boolean {
    return this._targets.has(partId);
  }

  // ── Cleanup ──

  override dispose(): void {
    for (const target of this._targets.values()) {
      target.dispose();
    }
    this._targets.clear();
    super.dispose();
  }
}
