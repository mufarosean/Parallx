// toggle.ts — Toggle UI component
//
// On/off toggle switch with optional label. Renders as a sliding
// oval track with a circular thumb.
//
// VS Code reference: Settings editor toggle / checkbox pattern.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener } from './dom.js';
import './toggle.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IToggleOptions {
  /** Whether the toggle starts in the "on" state. Default: `false`. */
  readonly checked?: boolean;
  /** Label text displayed next to the toggle. */
  readonly label?: string;
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
  /** Whether the toggle is disabled. */
  readonly disabled?: boolean;
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

/**
 * An on/off toggle switch.
 *
 * CSS classes (co-located in `toggle.css`):
 * - `.ui-toggle` — wrapper (label element)
 * - `.ui-toggle__track` — the oval track
 * - `.ui-toggle__thumb` — the circular sliding thumb
 * - `.ui-toggle__label` — text label
 * - `.ui-toggle--checked` — added when the toggle is on
 * - `.ui-toggle--disabled` — added when disabled
 *
 * Events:
 * - `onDidChange` — fired with new checked state (boolean)
 */
export class Toggle extends Disposable {

  readonly element: HTMLElement;
  private readonly _track: HTMLElement;
  private readonly _thumb: HTMLElement;
  private readonly _labelEl: HTMLElement | undefined;
  private _checked: boolean;
  private _disabled: boolean;

  private readonly _onDidChange = this._register(new Emitter<boolean>());
  readonly onDidChange: Event<boolean> = this._onDidChange.event;

  constructor(container: HTMLElement, options?: IToggleOptions) {
    super();

    this._checked = options?.checked ?? false;
    this._disabled = options?.disabled ?? false;

    // Wrapper — uses a <label> so clicking the text also toggles
    this.element = document.createElement('label');
    this.element.className = 'ui-toggle';
    this.element.setAttribute('role', 'switch');
    this.element.setAttribute('tabindex', '0');

    if (this._checked) {
      this.element.classList.add('ui-toggle--checked');
      this.element.setAttribute('aria-checked', 'true');
    } else {
      this.element.setAttribute('aria-checked', 'false');
    }

    if (this._disabled) {
      this.element.classList.add('ui-toggle--disabled');
    }

    if (options?.ariaLabel) {
      this.element.setAttribute('aria-label', options.ariaLabel);
    }

    // Track
    this._track = $('span.ui-toggle__track');

    // Thumb
    this._thumb = $('span.ui-toggle__thumb');
    this._track.appendChild(this._thumb);
    this.element.appendChild(this._track);

    // Label text
    if (options?.label) {
      this._labelEl = $('span.ui-toggle__label', options.label);
      this.element.appendChild(this._labelEl);
    }

    // Click handler
    this._register(addDisposableListener(this.element, 'click', (e) => {
      e.preventDefault();
      if (this._disabled) return;
      this._toggle();
    }));

    // Keyboard: Space/Enter
    this._register(addDisposableListener(this.element, 'keydown', (e) => {
      if (this._disabled) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this._toggle();
      }
    }));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get checked(): boolean {
    return this._checked;
  }

  set checked(v: boolean) {
    if (this._checked === v) return;
    this._checked = v;
    this.element.classList.toggle('ui-toggle--checked', v);
    this.element.setAttribute('aria-checked', String(v));
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.element.classList.toggle('ui-toggle--disabled', v);
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    this.element.focus();
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _toggle(): void {
    this._checked = !this._checked;
    this.element.classList.toggle('ui-toggle--checked', this._checked);
    this.element.setAttribute('aria-checked', String(this._checked));
    this._onDidChange.fire(this._checked);
  }
}
