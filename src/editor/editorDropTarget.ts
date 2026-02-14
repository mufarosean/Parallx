// editorDropTarget.ts — editor area drop overlay for creating split groups
//
// Implements VS Code's EditorDropTarget / DropOverlay pattern.
// When a tab is dragged over the editor area body (below the tab bar),
// a directional overlay appears indicating which split direction will be
// created. On drop, the editor is moved to a new group in that direction.
//
// VS Code reference: src/vs/workbench/browser/parts/editor/editorDropTarget.ts

import { Disposable, DisposableStore } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { EDITOR_TAB_DRAG_TYPE, EditorTabDragData, GroupDirection } from './editorTypes.js';
import { $ } from '../ui/dom.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Fraction of the editor area width/height used as the edge split threshold. */
const EDGE_THRESHOLD = 0.33;


// ── Split Direction ──────────────────────────────────────────────────────────

enum OverlayPosition {
  Left = 'left',
  Right = 'right',
  Top = 'top',
  Bottom = 'bottom',
  Center = 'center',
}

// ── Drop Overlay Event ───────────────────────────────────────────────────────

interface EditorDropEvent {
  /** The dragged tab data. */
  readonly data: EditorTabDragData;
  /** The target group element's data-editor-group-id. */
  readonly targetGroupId: string;
  /** The resolved split direction, or undefined for merge-into-center. */
  readonly splitDirection: GroupDirection | undefined;
}

// ── EditorDropOverlay ────────────────────────────────────────────────────────

/**
 * Per-group drop overlay that appears when dragging a tab over an editor
 * group's pane area. Shows a directional indicator for the split direction.
 *
 * VS Code reference: class DropOverlay in editorDropTarget.ts
 */
class EditorDropOverlay extends Disposable {

  private readonly _container: HTMLElement;
  private readonly _indicator: HTMLElement;
  private _currentPosition: OverlayPosition | undefined;

  private readonly _onDidDrop = this._register(new Emitter<{ position: OverlayPosition; data: EditorTabDragData }>());
  readonly onDidDrop: Event<{ position: OverlayPosition; data: EditorTabDragData }> = this._onDidDrop.event;

  private readonly _onDidDispose = this._register(new Emitter<void>());
  readonly onDidDispose: Event<void> = this._onDidDispose.event;

  private _enterCounter = 0;

  constructor(
    private readonly _groupElement: HTMLElement,
  ) {
    super();
    this._container = this._createOverlayContainer();
    this._indicator = this._createIndicator();
    this._container.appendChild(this._indicator);
    this._attachToGroup();
    this._registerListeners();
  }

  get currentPosition(): OverlayPosition | undefined {
    return this._currentPosition;
  }

  // ── DOM creation ──

  private _createOverlayContainer(): HTMLElement {
    const el = $('div');
    el.classList.add('editor-drop-overlay');
    // Positioning via .editor-drop-overlay CSS class (position absolute, inset 0, z-index, pointer-events)
    return el;
  }

  private _createIndicator(): HTMLElement {
    const el = $('div');
    el.classList.add('editor-drop-overlay-indicator');
    return el;
  }

  private _attachToGroup(): void {
    // Overlay is placed inside the group element's pane container
    const paneContainer = this._groupElement.querySelector('.editor-pane-container') as HTMLElement | null;
    const parent = paneContainer ?? this._groupElement;
    // .editor-pane-container already has position: relative via CSS
    parent.appendChild(this._container);
  }

  // ── Event listeners ──

  private _registerListeners(): void {
    const el = this._container;

    const onDragOver = (e: DragEvent): void => {
      if (!this._hasDragData(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';

      const rect = this._container.getBoundingClientRect();
      this._positionOverlay(e.clientX, e.clientY, rect);
    };

    const onDragEnter = (e: DragEvent): void => {
      if (!this._hasDragData(e)) return;
      e.preventDefault();
      this._enterCounter++;
    };

    const onDragLeave = (_e: DragEvent): void => {
      this._enterCounter--;
      if (this._enterCounter <= 0) {
        this._enterCounter = 0;
        this.dispose();
      }
    };

    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      const data = this._extractDragData(e);
      if (data && this._currentPosition) {
        this._onDidDrop.fire({ position: this._currentPosition, data });
      }
      this.dispose();
    };

    const onDragEnd = (): void => {
      this.dispose();
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    document.addEventListener('dragend', onDragEnd);

    this._register({
      dispose: () => {
        el.removeEventListener('dragover', onDragOver);
        el.removeEventListener('dragenter', onDragEnter);
        el.removeEventListener('dragleave', onDragLeave);
        el.removeEventListener('drop', onDrop);
        document.removeEventListener('dragend', onDragEnd);
      },
    });
  }

  // ── Overlay positioning (VS Code's positionOverlay pattern) ──

  private _positionOverlay(clientX: number, clientY: number, rect: DOMRect): void {
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    if (w === 0 || h === 0) return;

    const fracX = relX / w;
    const fracY = relY / h;

    let position: OverlayPosition;

    // VS Code's zone detection logic:
    // - If the mouse is within 33% of an edge, use that split direction
    // - Priority: left/right first (horizontal preference), then top/bottom
    // - Center if within the central third both horizontally and vertically
    if (fracX < EDGE_THRESHOLD) {
      position = OverlayPosition.Left;
    } else if (fracX > 1 - EDGE_THRESHOLD) {
      position = OverlayPosition.Right;
    } else if (fracY < EDGE_THRESHOLD) {
      position = OverlayPosition.Top;
    } else if (fracY > 1 - EDGE_THRESHOLD) {
      position = OverlayPosition.Bottom;
    } else {
      position = OverlayPosition.Center;
    }

    if (this._currentPosition === position) return;
    this._currentPosition = position;

    // Position the indicator element to fill the target half
    this._doPositionIndicator(position);
  }

  /**
   * Set the indicator CSS to fill the half matching the split direction.
   * VS Code uses percentage-based top/left/width/height.
   */
  private _doPositionIndicator(pos: OverlayPosition): void {
    const s = this._indicator.style;

    // Remove the move-transition class briefly to allow instant jump
    // if user quickly moves between zones
    this._indicator.classList.remove('overlay-move-transition');

    // Force a reflow so the class removal takes effect
    void this._indicator.offsetWidth;

    this._indicator.classList.add('overlay-move-transition');

    switch (pos) {
      case OverlayPosition.Left:
        Object.assign(s, { top: '0', left: '0', width: '50%', height: '100%' });
        break;
      case OverlayPosition.Right:
        Object.assign(s, { top: '0', left: '50%', width: '50%', height: '100%' });
        break;
      case OverlayPosition.Top:
        Object.assign(s, { top: '0', left: '0', width: '100%', height: '50%' });
        break;
      case OverlayPosition.Bottom:
        Object.assign(s, { top: '50%', left: '0', width: '100%', height: '50%' });
        break;
      case OverlayPosition.Center:
        Object.assign(s, { top: '0', left: '0', width: '100%', height: '100%' });
        break;
    }
  }

  // ── Helpers ──

  private _hasDragData(e: DragEvent): boolean {
    return e.dataTransfer?.types.includes(EDITOR_TAB_DRAG_TYPE) ?? false;
  }

  private _extractDragData(e: DragEvent): EditorTabDragData | undefined {
    try {
      const raw = e.dataTransfer?.getData(EDITOR_TAB_DRAG_TYPE);
      return raw ? JSON.parse(raw) as EditorTabDragData : undefined;
    } catch {
      return undefined;
    }
  }

  override dispose(): void {
    this._container.remove();
    this._onDidDispose.fire();
    super.dispose();
  }
}

// ── EditorDropTarget ─────────────────────────────────────────────────────────

/**
 * Container-level coordinator for editor drop overlays.
 *
 * Wraps the editor group container and creates/manages `EditorDropOverlay`
 * instances on the group being dragged over.
 *
 * VS Code reference: class EditorDropTarget in editorDropTarget.ts
 */
export class EditorDropTarget extends Disposable {

  private readonly _onDidDrop = this._register(new Emitter<EditorDropEvent>());
  readonly onDidDrop: Event<EditorDropEvent> = this._onDidDrop.event;

  private _activeOverlay: EditorDropOverlay | undefined;
  private _activeOverlayGroupElement: HTMLElement | undefined;
  private readonly _overlayDisposables = this._register(new DisposableStore());

  constructor(
    private readonly _container: HTMLElement,
  ) {
    super();
    this._registerContainerListeners();
  }

  private _registerContainerListeners(): void {
    const el = this._container;

    const onDragOver = (e: DragEvent): void => {
      if (!this._hasDragData(e)) return;

      // Find the group element at the drag point
      const groupElement = this._findGroupElement(e.target as HTMLElement | null);
      if (!groupElement) return;

      // Don't create overlay if we're over the tab bar area — UNLESS the
      // group is empty (no tabs to act as drop targets). VS Code parity:
      // empty groups accept drops on the tab bar via the pane overlay.
      if (this._isOverTabBar(e.target as HTMLElement | null)) {
        const hasEditors = groupElement.querySelectorAll('.ui-tab').length > 0;
        if (hasEditors) return;
      }

      // VS Code parity: if the overlay belongs to a different group, switch it
      if (this._activeOverlay && this._activeOverlayGroupElement !== groupElement) {
        this._clearOverlay();
      }

      // Create overlay if needed
      if (!this._activeOverlay) {
        this._createOverlayForGroup(groupElement);
      }
    };

    // Document-level dragover: dismiss the overlay when the cursor leaves
    // the editor group container. This is more reliable than enter/leave
    // counters which are notoriously flaky in HTML5 DnD.
    const onDocumentDragOver = (e: DragEvent): void => {
      if (!this._activeOverlay) return;
      const rect = el.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) {
        this._clearOverlay();
      }
    };

    el.addEventListener('dragover', onDragOver, { capture: true });
    document.addEventListener('dragover', onDocumentDragOver);

    this._register({
      dispose: () => {
        el.removeEventListener('dragover', onDragOver, { capture: true });
        document.removeEventListener('dragover', onDocumentDragOver);
      },
    });
  }

  private _createOverlayForGroup(groupElement: HTMLElement): void {
    this._clearOverlay();

    const overlay = new EditorDropOverlay(groupElement);
    this._activeOverlay = overlay;
    this._activeOverlayGroupElement = groupElement;

    this._overlayDisposables.add(overlay);

    this._overlayDisposables.add(overlay.onDidDrop(({ position, data }) => {
      const groupId = groupElement.getAttribute('data-editor-group-id') ?? '';

      const splitDirection = this._toGroupDirection(position);
      this._onDidDrop.fire({
        data,
        targetGroupId: groupId,
        splitDirection,
      });
    }));

    this._overlayDisposables.add(overlay.onDidDispose(() => {
      this._activeOverlay = undefined;
      this._activeOverlayGroupElement = undefined;
      this._overlayDisposables.clear();
    }));
  }

  private _clearOverlay(): void {
    if (this._activeOverlay) {
      this._activeOverlay.dispose();
      this._activeOverlay = undefined;
      this._activeOverlayGroupElement = undefined;
    }
  }

  /**
   * Walk up from the target to find the .editor-group element.
   */
  private _findGroupElement(el: HTMLElement | null): HTMLElement | null {
    while (el && el !== this._container) {
      if (el.classList.contains('editor-group')) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Check if the event target is inside the tab bar (we don't show the
   * split overlay when dragging over tabs — tabs have their own DnD).
   */
  private _isOverTabBar(el: HTMLElement | null): boolean {
    while (el && el !== this._container) {
      if (el.classList.contains('editor-tab-bar')) return true;
      el = el.parentElement;
    }
    return false;
  }

  private _toGroupDirection(pos: OverlayPosition): GroupDirection | undefined {
    switch (pos) {
      case OverlayPosition.Left: return GroupDirection.Left;
      case OverlayPosition.Right: return GroupDirection.Right;
      case OverlayPosition.Top: return GroupDirection.Up;
      case OverlayPosition.Bottom: return GroupDirection.Down;
      case OverlayPosition.Center: return undefined; // merge into existing group
    }
  }

  private _hasDragData(e: DragEvent): boolean {
    return e.dataTransfer?.types.includes(EDITOR_TAB_DRAG_TYPE) ?? false;
  }

  override dispose(): void {
    this._clearOverlay();
    super.dispose();
  }
}
