// inputBox.ts — InputBox UI component
//
// Reusable text input with built-in validation, placeholder,
// and keyboard events (Enter → submit, Escape → cancel).
//
// VS Code reference: `src/vs/base/browser/ui/inputbox/inputBox.ts`

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener, toggleClass } from './dom.js';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IInputBoxOptions {
  /** Placeholder text shown when input is empty. */
  readonly placeholder?: string;
  /** Initial value. */
  readonly value?: string;
  /** Input type (`text` or `password`). Default: `text`. */
  readonly type?: 'text' | 'password';
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
  /** Synchronous or async validation function. Return error string or null/undefined. */
  readonly validationFn?: (value: string) => string | null | undefined | Promise<string | null | undefined>;
}

// ─── InputBox ────────────────────────────────────────────────────────────────

/**
 * A styled text input with validation support.
 *
 * CSS classes:
 * - `.ui-input-box` — wrapper
 * - `.ui-input-box-input` — the `<input>` element
 * - `.ui-input-box-validation` — validation message below input
 * - `.ui-input-box--invalid` — added to wrapper when validation fails
 *
 * Events:
 * - `onDidChange` — fired on every `input` event with current value
 * - `onDidSubmit` — fired on Enter key
 * - `onDidCancel` — fired on Escape key
 */
export class InputBox extends Disposable {

  readonly element: HTMLElement;
  readonly inputElement: HTMLInputElement;

  private readonly _validationEl: HTMLElement;
  private readonly _validationFn: IInputBoxOptions['validationFn'];

  private readonly _onDidChange = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this._onDidChange.event;

  private readonly _onDidSubmit = this._register(new Emitter<string>());
  readonly onDidSubmit: Event<string> = this._onDidSubmit.event;

  private readonly _onDidCancel = this._register(new Emitter<void>());
  readonly onDidCancel: Event<void> = this._onDidCancel.event;

  constructor(container: HTMLElement, options?: IInputBoxOptions) {
    super();

    this._validationFn = options?.validationFn;

    // Wrapper
    this.element = $('div.ui-input-box');

    // Input element
    this.inputElement = document.createElement('input');
    this.inputElement.className = 'ui-input-box-input';
    this.inputElement.type = options?.type ?? 'text';
    this.inputElement.spellcheck = false;
    this.inputElement.autocomplete = 'off';
    if (options?.placeholder) this.inputElement.placeholder = options.placeholder;
    if (options?.value) this.inputElement.value = options.value;
    if (options?.ariaLabel) this.inputElement.setAttribute('aria-label', options.ariaLabel);
    this.element.appendChild(this.inputElement);

    // Validation label
    this._validationEl = $('div.ui-input-box-validation');
    this.element.appendChild(this._validationEl);

    // Events
    this._register(addDisposableListener(this.inputElement, 'input', () => {
      this._onDidChange.fire(this.inputElement.value);
      this._validate();
    }));

    this._register(addDisposableListener(this.inputElement, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._onDidSubmit.fire(this.inputElement.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._onDidCancel.fire();
      }
    }));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get value(): string {
    return this.inputElement.value;
  }

  set value(v: string) {
    this.inputElement.value = v;
    this._validate();
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    this.inputElement.focus();
  }

  select(): void {
    this.inputElement.select();
  }

  /**
   * Show a validation error message. Pass empty string to clear.
   */
  showValidation(message: string): void {
    this._validationEl.textContent = message;
    toggleClass(this.element, 'ui-input-box--invalid', !!message);
  }

  hideValidation(): void {
    this.showValidation('');
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async _validate(): Promise<void> {
    if (!this._validationFn) {
      this.hideValidation();
      return;
    }

    const result = this._validationFn(this.inputElement.value);
    const message = result instanceof Promise ? await result : result;
    this.showValidation(message ?? '');
  }
}
