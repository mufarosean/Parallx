// dropZone.ts — drop zone rendering and detection

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { DropPosition, DropResult, DragPayload, IDropTarget, VIEW_DRAG_MIME } from './dndTypes.js';
import { DropOverlay } from './dropOverlay.js';

/**
 * A DropZone wraps an HTMLElement and turns it into a valid drop target.
 *
 * It listens for HTML5 drag events, computes the drop position from the
 * cursor’s location, shows visual feedback via a {@link DropOverlay},
 * and fires {@link onDidDrop} on completion.
 */
export class DropZone extends Disposable implements IDropTarget {

  private readonly _overlay: DropOverlay;
  private readonly _acceptFn: (payload: DragPayload) => boolean;

  private readonly _onDidDrop = this._register(new Emitter<DropResult>());
  readonly onDidDrop: Event<DropResult> = this._onDidDrop.event;

  constructor(
    readonly partId: string,
    readonly element: HTMLElement,
    acceptFn?: (payload: DragPayload) => boolean,
  ) {
    super();
    this._acceptFn = acceptFn ?? (() => true);
    this._overlay = this._register(new DropOverlay());
    this._attachListeners();
  }

  accepts(payload: DragPayload): boolean {
    return this._acceptFn(payload);
  }

  // ── Event wiring ──

  private _attachListeners(): void {
    const el = this.element;

    el.addEventListener('dragenter', this._onDragEnter);
    el.addEventListener('dragover', this._onDragOver);
    el.addEventListener('dragleave', this._onDragLeave);
    el.addEventListener('drop', this._onDrop);

    this._register({
      dispose: () => {
        el.removeEventListener('dragenter', this._onDragEnter);
        el.removeEventListener('dragover', this._onDragOver);
        el.removeEventListener('dragleave', this._onDragLeave);
        el.removeEventListener('drop', this._onDrop);
      },
    });
  }

  // ── Handlers ──

  private readonly _onDragEnter = (e: DragEvent): void => {
    if (!this._hasMime(e)) return;
    e.preventDefault();

    const payload = this._extractPayload(e);
    if (payload && !this.accepts(payload)) {
      this._overlay.highlightInvalid();
    }

    this._overlay.show(this.element);
  };

  private readonly _onDragOver = (e: DragEvent): void => {
    if (!this._hasMime(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';

    const rect = this.element.getBoundingClientRect();
    const position = this._overlay.computePosition(e.clientX, e.clientY, rect);
    this._overlay.highlight(position);
  };

  private readonly _onDragLeave = (e: DragEvent): void => {
    // Only hide when leaving the actual target (not entering a child)
    if (e.relatedTarget && this.element.contains(e.relatedTarget as Node)) {
      return;
    }
    this._overlay.hide();
  };

  private readonly _onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const payload = this._extractPayload(e);
    const position = this._overlay.currentPosition ?? DropPosition.Center;
    this._overlay.hide();

    if (!payload) return;
    if (!this.accepts(payload)) return;

    this._onDidDrop.fire({
      payload,
      targetPartId: this.partId,
      position,
    });
  };

  // ── Helpers ──

  private _hasMime(e: DragEvent): boolean {
    return e.dataTransfer?.types.includes(VIEW_DRAG_MIME) ?? false;
  }

  private _extractPayload(e: DragEvent): DragPayload | undefined {
    try {
      const raw = e.dataTransfer?.getData(VIEW_DRAG_MIME);
      return raw ? JSON.parse(raw) as DragPayload : undefined;
    } catch {
      return undefined;
    }
  }
}
