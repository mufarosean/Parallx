// button.ts — Button and IconButton UI components
//
// Reusable button that supports text labels, icon text, disabled state,
// and primary/secondary styling via CSS classes. Fires click events
// via Emitter<MouseEvent>.
//
// VS Code reference: `src/vs/base/browser/ui/button/button.ts`

import { Disposable, DisposableStore } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener, toggleClass } from './dom.js';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IButtonOptions {
  /** Text label displayed on the button. */
  readonly label?: string;
  /** Icon text (emoji or codicon placeholder) displayed before the label. */
  readonly icon?: string;
  /** Tooltip text. */
  readonly title?: string;
  /** If true, render with secondary (less prominent) styling. */
  readonly secondary?: boolean;
}

// ─── Button ──────────────────────────────────────────────────────────────────

/**
 * A styled button that extends Disposable.
 *
 * CSS classes applied:
 * - `.ui-button` — always
 * - `.ui-button--secondary` — when `secondary` option is true
 * - `.ui-button--icon-only` — when label is empty and icon is set
 * - `.ui-button--disabled` — when `enabled` is false
 *
 * All visual styling lives in `ui.css`. No inline styles for colors,
 * backgrounds, borders, padding, or fonts.
 */
export class Button extends Disposable {

  readonly element: HTMLButtonElement;

  private readonly _onDidClick = this._register(new Emitter<MouseEvent>());
  readonly onDidClick: Event<MouseEvent> = this._onDidClick.event;

  private _labelEl: HTMLSpanElement;
  private _iconEl: HTMLSpanElement;
  private _enabled = true;

  constructor(container: HTMLElement, options?: IButtonOptions) {
    super();

    this.element = document.createElement('button');
    this.element.className = 'ui-button';
    this.element.type = 'button';

    if (options?.secondary) {
      this.element.classList.add('ui-button--secondary');
    }

    // Icon span
    this._iconEl = $('span.ui-button-icon') as HTMLSpanElement;
    this.element.appendChild(this._iconEl);

    // Label span
    this._labelEl = $('span.ui-button-label') as HTMLSpanElement;
    this.element.appendChild(this._labelEl);

    // Apply initial options
    if (options?.label !== undefined) this.label = options.label;
    if (options?.icon !== undefined) this.icon = options.icon;
    if (options?.title !== undefined) this.element.title = options.title;

    // If no label, check for icon-only
    this._updateIconOnlyClass();

    // Click handler
    this._register(addDisposableListener(this.element, 'click', (e) => {
      if (this._enabled) {
        this._onDidClick.fire(e);
      }
    }));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get label(): string {
    return this._labelEl.textContent ?? '';
  }

  set label(value: string) {
    this._labelEl.textContent = value;
    this._updateIconOnlyClass();
  }

  get icon(): string {
    return this._iconEl.textContent ?? '';
  }

  set icon(value: string) {
    this._iconEl.textContent = value;
    toggleClass(this._iconEl, 'ui-hidden', !value);
    this._updateIconOnlyClass();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.element.disabled = !value;
    toggleClass(this.element, 'ui-button--disabled', !value);
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    this.element.focus();
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _updateIconOnlyClass(): void {
    const isIconOnly = !!this._iconEl.textContent && !this._labelEl.textContent;
    toggleClass(this.element, 'ui-button--icon-only', isIconOnly);
  }
}
