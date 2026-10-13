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
  /** Center the content vertically as well as horizontally. Default: false (top-aligned with `padding-top: 20vh`). */
  readonly centered?: boolean;
  /** The dialog's name for a screen reader. Default: 'Dialog'. */
  readonly label?: string;
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
  /** Where focus was before show(), given back on hide(). */
  private _returnFocus: HTMLElement | null = null;

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
    const centered = options?.centered ?? false;

    // Backdrop
    this.element = $('div.ui-overlay');
    toggleClass(this.element, 'ui-overlay--transparent', transparent);
    toggleClass(this.element, 'ui-overlay--centered', centered);

    // Content area
    this.contentElement = $('div.ui-overlay-content');
    // A modal dialog to a screen reader: what it is, that the rest waits, its name.
    this.contentElement.setAttribute('role', 'dialog');
    this.contentElement.setAttribute('aria-modal', 'true');
    this.contentElement.setAttribute('aria-label', options?.label ?? 'Dialog');
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
    this._returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this._parent.appendChild(this.element);
    // Focusable so Escape works
    this.element.tabIndex = -1;
    this.element.focus();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    const inside = this.element.contains(document.activeElement);
    this.element.remove();
    // Focus goes back where it was, unless something else already took it.
    const active = document.activeElement;
    if ((inside || !active || active === document.body) && this._returnFocus?.isConnected) this._returnFocus.focus();
    this._returnFocus = null;
    this._onDidClose.fire();
  }

  override dispose(): void {
    if (this._visible) {
      this.element.remove();
    }
    super.dispose();
  }
}
