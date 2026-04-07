// chatContextPicker.ts — Per-session context window picker
//
// Dropdown next to the model picker that lets the user override the context
// window size for the current chat session.  Options: Model Default (0),
// 8K, 16K, 32K, 64K, 128K.
//
// Follows the same pattern as ChatModelPicker / ChatModePicker.
//
// When "Model Default" is selected the override is 0 and the runtime uses
// whatever Ollama reports for the active model.

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IContextPickerServices } from '../chatTypes.js';

export type { IContextPickerServices } from '../chatTypes.js';

/** Preset context-window sizes shown in the dropdown. */
const CONTEXT_OPTIONS: { label: string; value: number }[] = [
  { label: 'Model Default', value: 0 },
  { label: '8K',   value: 8_192 },
  { label: '16K',  value: 16_384 },
  { label: '32K',  value: 32_768 },
  { label: '64K',  value: 65_536 },
  { label: '128K', value: 131_072 },
];

/**
 * Context window picker — a button that opens a dropdown of preset sizes.
 */
export class ChatContextPicker extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private _dropdown: HTMLElement | undefined;
  private _closeHandler: ((e: MouseEvent) => void) | undefined;
  private _value = 0; // 0 = model default

  private readonly _onDidChange = this._register(new Emitter<number>());
  readonly onDidChange: Event<number> = this._onDidChange.event;

  constructor(container: HTMLElement, _services: IContextPickerServices) {
    super();

    this._root = $('div.parallx-chat-ctxwindow-picker');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    this._button = document.createElement('button');
    this._button.className = 'parallx-chat-picker-btn parallx-chat-picker-btn--context';
    this._button.type = 'button';
    this._root.appendChild(this._button);

    this._register(addDisposableListener(this._button, 'click', () => {
      if (this._dropdown) {
        this._closeDropdown();
      } else {
        this._openDropdown();
      }
    }));

    this._updateLabel();
  }

  /** Set the value programmatically (e.g. when restoring a session). */
  setValue(tokens: number): void {
    this._value = tokens;
    this._updateLabel();
  }

  getValue(): number {
    return this._value;
  }

  private _updateLabel(): void {
    this._button.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = this._value > 0 ? this._formatSize(this._value) : 'Ctx: Auto';
    this._button.appendChild(label);

    const chevron = document.createElement('span');
    chevron.className = 'parallx-chat-picker-chevron';
    chevron.innerHTML = chatIcons.chevronDown;
    this._button.appendChild(chevron);
  }

  private _openDropdown(): void {
    this._closeDropdown();

    const dropdown = $('div.parallx-chat-picker-dropdown');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    for (const option of CONTEXT_OPTIONS) {
      const item = $('div.parallx-chat-picker-item');
      if (option.value === this._value) {
        item.classList.add('parallx-chat-picker-item--active');
      }

      const name = $('span.parallx-chat-picker-item-name', option.label);
      item.appendChild(name);

      if (option.value > 0) {
        const detail = $('span.parallx-chat-picker-item-size', `${option.value.toLocaleString()} tokens`);
        item.appendChild(detail);
      }

      item.addEventListener('click', () => {
        this._value = option.value;
        this._updateLabel();
        this._onDidChange.fire(option.value);
        this._closeDropdown();
      });

      dropdown.appendChild(item);
    }

    // Position below button
    const rect = this._button.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(dropdown);
    this._dropdown = dropdown;

    const closeHandler = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !this._button.contains(e.target as Node)) {
        this._closeDropdown();
      }
    };
    this._closeHandler = closeHandler;
    document.addEventListener('mousedown', closeHandler);
  }

  private _closeDropdown(): void {
    if (this._dropdown) {
      this._dropdown.remove();
      this._dropdown = undefined;
    }
    if (this._closeHandler) {
      document.removeEventListener('mousedown', this._closeHandler);
      this._closeHandler = undefined;
    }
  }

  override dispose(): void {
    this._closeDropdown();
    super.dispose();
  }

  private _formatSize(tokens: number): string {
    if (tokens >= 1_048_576) {
      const m = tokens / 1_048_576;
      return `Ctx: ${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
    }
    const k = tokens / 1024;
    return `Ctx: ${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
}
