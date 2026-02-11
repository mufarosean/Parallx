// overlay.ts — Overlay / backdrop UI component
//
// A full-screen overlay with optional backdrop dimming, used as the
// foundation for modals, command palette, context menus, and dialogs.
// Content is placed inside a centered content element.
//
// VS Code reference: `src/vs/base/browser/ui/dialog/dialog.ts` (overlay pattern)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener, toggleClass } from './dom.js';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IOverlayOptions {
  /** If true, don't darken the backdrop. Default: false. */
  readonly transparent?: boolean;
  /** Close when the backdrop (outside content) is clicked. Default: true. */
  readonly closeOnClickOutside?: boolean;
  /** Close when Escape key is pressed. Default: true. */
  readonly closeOnEscape?: boolean;
  /** Extra CSS class added to the content container. */
  readonly contentClass?: string;
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

/**
 * A full-viewport overlay with an optional backdrop.
 *
 * CSS classes:
 * - `.ui-overlay` — the backdrop element
 * - `.ui-overlay--transparent` — no dimming
 * - `.ui-overlay-content` — the centered content area
 *
 * Usage:
 * ```ts
 * const overlay = new Overlay(document.body, { closeOnClickOutside: true });
 * const dialog = document.createElement('div');
 * overlay.contentElement.appendChild(dialog);
 * overlay.show();
 * overlay.onDidClose(() => { cleanup(); });
 * ```
 */
export class Overlay extends Disposable {

  readonly element: HTMLElement;
  readonly contentElement: HTMLElement;

  private _visible = false;

  private readonly _onDidClose = this._register(new Emitter<void>());
  readonly onDidClose: Event<void> = this._onDidClose.event;

  constructor(
    private readonly _parent: HTMLElement,
    options?: IOverlayOptions,
  ) {
    super();

    const transparent = options?.transparent ?? false;
    const closeOnClickOutside = options?.closeOnClickOutside ?? true;
    const closeOnEscape = options?.closeOnEscape ?? true;

    // Backdrop
    this.element = $('div.ui-overlay');
    toggleClass(this.element, 'ui-overlay--transparent', transparent);

    // Content area
    this.contentElement = $('div.ui-overlay-content');
    if (options?.contentClass) {
      this.contentElement.classList.add(options.contentClass);
    }
    this.element.appendChild(this.contentElement);

    // Click outside → close
    if (closeOnClickOutside) {
      this._register(addDisposableListener(this.element, 'mousedown', (e) => {
        if (e.target === this.element) {
          this.hide();
        }
      }));
    }

    // Escape → close
    if (closeOnEscape) {
      this._register(addDisposableListener(this.element, 'keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.hide();
        }
      }));
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────

  get visible(): boolean {
    return this._visible;
  }

  show(): void {
    if (this._visible) return;
    this._visible = true;
    this._parent.appendChild(this.element);
    // Focusable so Escape works
    this.element.tabIndex = -1;
    this.element.focus();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.element.remove();
    this._onDidClose.fire();
  }

  override dispose(): void {
    if (this._visible) {
      this.element.remove();
    }
    super.dispose();
  }
}
