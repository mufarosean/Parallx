// textarea.ts — Textarea UI component
//
// Multi-line text input with placeholder, readonly mode, and auto-resize.
//
// VS Code reference: comment editor / description inputs in VS Code.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener } from './dom.js';
import './textarea.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ITextareaOptions {
  /** Initial value. */
  readonly value?: string;
  /** Placeholder text. */
  readonly placeholder?: string;
  /** Number of visible rows. Default: `4`. */
  readonly rows?: number;
  /** Whether the textarea is read-only. */
  readonly readonly?: boolean;
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
  /** Whether the textarea is disabled. */
  readonly disabled?: boolean;
}

// ─── Textarea ────────────────────────────────────────────────────────────────

/**
 * A styled multi-line text input.
 *
 * CSS classes (co-located in `textarea.css`):
 * - `.ui-textarea` — wrapper
 * - `.ui-textarea__input` — the `<textarea>` element
 * - `.ui-textarea--readonly` — added when read-only
 * - `.ui-textarea--disabled` — added when disabled
 *
 * Events:
 * - `onDidChange` — fired on every `input` event with current value
 * - `onDidBlur` — fired when the textarea loses focus
 */
export class Textarea extends Disposable {

  readonly element: HTMLElement;
  readonly textareaElement: HTMLTextAreaElement;

  private readonly _onDidChange = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this._onDidChange.event;

  private readonly _onDidBlur = this._register(new Emitter<void>());
  readonly onDidBlur: Event<void> = this._onDidBlur.event;

  constructor(container: HTMLElement, options?: ITextareaOptions) {
    super();

    // Wrapper
    this.element = $('div.ui-textarea');

    if (options?.readonly) {
      this.element.classList.add('ui-textarea--readonly');
    }
    if (options?.disabled) {
      this.element.classList.add('ui-textarea--disabled');
    }

    // Textarea element
    this.textareaElement = document.createElement('textarea');
    this.textareaElement.className = 'ui-textarea__input';
    this.textareaElement.rows = options?.rows ?? 4;
    this.textareaElement.spellcheck = false;
    if (options?.value) this.textareaElement.value = options.value;
    if (options?.placeholder) this.textareaElement.placeholder = options.placeholder;
    if (options?.readonly) this.textareaElement.readOnly = true;
    if (options?.disabled) this.textareaElement.disabled = true;
    if (options?.ariaLabel) this.textareaElement.setAttribute('aria-label', options.ariaLabel);
    this.element.appendChild(this.textareaElement);

    // Events
    this._register(addDisposableListener(this.textareaElement, 'input', () => {
      this._onDidChange.fire(this.textareaElement.value);
    }));

    this._register(addDisposableListener(this.textareaElement, 'blur', () => {
      this._onDidBlur.fire();
    }));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get value(): string {
    return this.textareaElement.value;
  }

  set value(v: string) {
    this.textareaElement.value = v;
  }

  get readonly(): boolean {
    return this.textareaElement.readOnly;
  }

  set readonly(v: boolean) {
    this.textareaElement.readOnly = v;
    this.element.classList.toggle('ui-textarea--readonly', v);
  }

  get disabled(): boolean {
    return this.textareaElement.disabled;
  }

  set disabled(v: boolean) {
    this.textareaElement.disabled = v;
    this.element.classList.toggle('ui-textarea--disabled', v);
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    this.textareaElement.focus();
  }

  select(): void {
    this.textareaElement.select();
  }
}
