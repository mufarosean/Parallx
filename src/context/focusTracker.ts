// focusTracker.ts — active view / part / region tracking
//
// Tracks which part and view currently have keyboard focus, maintains
// a focus history for restoration, and updates the ContextKeyService
// whenever focus changes.
//
// Uses DOM focusin/focusout events as the base signal and maps the
// focused element to the closest part/view ancestor via data attributes.

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { ContextKeyService } from './contextKey.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FocusChangeEvent {
  /** Previous focused part ID (undefined if none). */
  readonly previousPartId: string | undefined;
  /** New focused part ID (undefined if none). */
  readonly partId: string | undefined;
  /** Previous focused view ID (undefined if none). */
  readonly previousViewId: string | undefined;
  /** New focused view ID (undefined if none). */
  readonly viewId: string | undefined;
}

/** Data attribute names used to tag DOM elements for focus resolution. */
const DATA_PART_ID = 'data-part-id';
const DATA_VIEW_ID = 'data-view-id';

// ─── FocusTracker ────────────────────────────────────────────────────────────

/**
 * Tracks keyboard focus across the workbench and maintains focus history.
 *
 * Parts and views annotate their root elements with `data-part-id` and
 * `data-view-id` respectively. When a DOM element receives focus, the
 * tracker walks up the tree to find the containing part/view and updates
 * context keys accordingly.
 */
export class FocusTracker extends Disposable {
  // ── State ──

  private _focusedPartId: string | undefined;
  private _focusedViewId: string | undefined;
  private _lastFocusedPartId: string | undefined;
  private _lastFocusedViewId: string | undefined;
  private _lastFocusedElement: HTMLElement | undefined;

  /** Stack of recently focused part+view pairs, for intelligent restoration. */
  private readonly _focusHistory: Array<{ partId: string; viewId?: string; element?: WeakRef<HTMLElement> }> = [];
  private static readonly MAX_HISTORY = 10;

  // ── Events ──

  private readonly _onDidChangeFocus = this._register(new Emitter<FocusChangeEvent>());
  readonly onDidChangeFocus: Event<FocusChangeEvent> = this._onDidChangeFocus.event;

  private readonly _onDidFocusPart = this._register(new Emitter<string>());
  readonly onDidFocusPart: Event<string> = this._onDidFocusPart.event;

  private readonly _onDidFocusView = this._register(new Emitter<string>());
  readonly onDidFocusView: Event<string> = this._onDidFocusView.event;

  /** Whether focus tracking is temporarily suspended (e.g. during overlays). */
  private _suspended = false;

  constructor(
    private readonly _root: HTMLElement,
    private readonly _contextKeys: ContextKeyService | undefined,
  ) {
    super();
    this._attachDOMListeners();
  }

  // ─── Public API ────────────────────────────────────────────────────────

  get focusedPartId(): string | undefined { return this._focusedPartId; }
  get focusedViewId(): string | undefined { return this._focusedViewId; }
  get lastFocusedPartId(): string | undefined { return this._lastFocusedPartId; }
  get lastFocusedViewId(): string | undefined { return this._lastFocusedViewId; }

  /**
   * Programmatically move focus to a part.
   * If the part contains a previously focused element, focus is restored there.
   */
  focusPart(partId: string): void {
    const partEl = this._root.querySelector(`[${DATA_PART_ID}="${partId}"]`) as HTMLElement | null;
    if (!partEl) return;

    // Try to restore to last focused element within this part
    const historyEntry = this._focusHistory.find((h) => h.partId === partId);
    const target = historyEntry?.element?.deref();
    if (target && this._root.contains(target)) {
      target.focus();
    } else {
      // Focus the part root itself (it should be focusable or contain one)
      const focusable = partEl.querySelector<HTMLElement>('[tabindex], input, button, a, textarea, select');
      if (focusable) {
        focusable.focus();
      } else {
        partEl.focus();
      }
    }
  }

  /**
   * Programmatically move focus to a view.
   */
  focusView(viewId: string): void {
    const viewEl = this._root.querySelector(`[${DATA_VIEW_ID}="${viewId}"]`) as HTMLElement | null;
    if (!viewEl) return;

    const focusable = viewEl.querySelector<HTMLElement>('[tabindex], input, button, a, textarea, select');
    if (focusable) {
      focusable.focus();
    } else {
      viewEl.focus();
    }
  }

  /**
   * Restore focus to the last focused element.
   * Useful after closing dialogs/overlays.
   */
  restoreFocus(): void {
    // Try exact element first
    if (this._lastFocusedElement && this._root.contains(this._lastFocusedElement)) {
      this._lastFocusedElement.focus();
      return;
    }

    // Walk history to find a still-alive target
    for (const entry of this._focusHistory) {
      const el = entry.element?.deref();
      if (el && this._root.contains(el)) {
        el.focus();
        return;
      }
    }

    // Last resort: focus the last known part
    if (this._lastFocusedPartId) {
      this.focusPart(this._lastFocusedPartId);
    }
  }

  /**
   * Temporarily suspend focus tracking (e.g. while a dialog is open).
   */
  suspend(): void {
    this._suspended = true;
  }

  /**
   * Resume focus tracking and optionally restore focus.
   */
  resume(restore = true): void {
    this._suspended = false;
    if (restore) {
      this.restoreFocus();
    }
  }

  // ─── DOM Listeners ─────────────────────────────────────────────────────

  private _attachDOMListeners(): void {
    const onFocusIn = (e: FocusEvent) => {
      if (this._suspended) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      this._handleFocusChange(target);
    };

    const onFocusOut = (e: FocusEvent) => {
      if (this._suspended) return;
      // If focus is leaving the workbench entirely (relatedTarget is null
      // or outside _root), we keep current state but note the loss.
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || !this._root.contains(related)) {
        // Focus left the workbench. Don't clear state — we want to restore later.
      }
    };

    this._root.addEventListener('focusin', onFocusIn, true);
    this._root.addEventListener('focusout', onFocusOut, true);

    this._register(toDisposable(() => {
      this._root.removeEventListener('focusin', onFocusIn, true);
      this._root.removeEventListener('focusout', onFocusOut, true);
    }));
  }

  private _handleFocusChange(target: HTMLElement): void {
    // Walk up from the focused element to find part/view data attributes
    const partId = this._findAncestorData(target, DATA_PART_ID);
    const viewId = this._findAncestorData(target, DATA_VIEW_ID);

    const prevPartId = this._focusedPartId;
    const prevViewId = this._focusedViewId;

    // No change?
    if (partId === prevPartId && viewId === prevViewId) {
      // Still update the last focused element within the same part/view
      this._lastFocusedElement = target;
      return;
    }

    // Update state
    if (partId !== prevPartId) {
      this._lastFocusedPartId = prevPartId;
    }
    if (viewId !== prevViewId) {
      this._lastFocusedViewId = prevViewId;
    }

    this._focusedPartId = partId;
    this._focusedViewId = viewId;
    this._lastFocusedElement = target;

    // Record in history
    if (partId) {
      this._pushHistory(partId, viewId, target);
    }

    // Update context keys
    this._updateContextKeys();

    // Fire events
    this._onDidChangeFocus.fire({
      previousPartId: prevPartId,
      partId,
      previousViewId: prevViewId,
      viewId,
    });

    if (partId && partId !== prevPartId) {
      this._onDidFocusPart.fire(partId);
    }
    if (viewId && viewId !== prevViewId) {
      this._onDidFocusView.fire(viewId);
    }
  }

  private _findAncestorData(el: HTMLElement, attr: string): string | undefined {
    let current: HTMLElement | null = el;
    while (current && current !== this._root) {
      const val = current.getAttribute(attr);
      if (val) return val;
      current = current.parentElement;
    }
    return undefined;
  }

  private _pushHistory(partId: string, viewId: string | undefined, element: HTMLElement): void {
    // Remove existing entry for this part
    const idx = this._focusHistory.findIndex((h) => h.partId === partId);
    if (idx >= 0) {
      this._focusHistory.splice(idx, 1);
    }

    // Push to front
    this._focusHistory.unshift({
      partId,
      viewId,
      element: new WeakRef(element),
    });

    // Trim
    if (this._focusHistory.length > FocusTracker.MAX_HISTORY) {
      this._focusHistory.length = FocusTracker.MAX_HISTORY;
    }
  }

  private _updateContextKeys(): void {
    if (!this._contextKeys) return;

    this._contextKeys.setContext('focusedPart', this._focusedPartId);
    this._contextKeys.setContext('focusedView', this._focusedViewId);
  }

  // ─── Disposal ──────────────────────────────────────────────────────────

  override dispose(): void {
    this._focusHistory.length = 0;
    super.dispose();
  }
}
