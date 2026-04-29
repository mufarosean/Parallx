// chatContextWindowPicker.ts — Per-session context window override picker
//
// Sibling of ChatModelPicker. Lets the user clamp the active session's
// context window so heavy reasoning models keep their KV cache in VRAM.
//
// The picker writes through three places, all routed via IChatWidgetServices:
//   1. session.contextWindowOverride (persisted to SQLite)
//   2. OllamaProvider._contextLengthOverride (so num_ctx + token bar match)
//   3. chatService.updateSessionContextWindow (fires onDidChangeSession)

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';

/** Preset values offered in the dropdown. 0 = "Model default" (clear override). */
const CONTEXT_WINDOW_PRESETS: readonly { label: string; description: string; value: number }[] = [
  { label: 'Model default', description: 'Model\u2019s reported context',        value: 0 },
  { label: '4K',   description: 'Tiny \u2014 lowest VRAM',                       value: 4_096 },
  { label: '8K',   description: 'Light chat',                                    value: 8_192 },
  { label: '16K',  description: 'Medium context',                                value: 16_384 },
  { label: '32K',  description: 'Long chat',                                     value: 32_768 },
  { label: '64K',  description: 'Stays in VRAM on most GPUs',                    value: 65_536 },
  { label: '128K', description: 'May spill to CPU',                              value: 131_072 },
];

export interface IContextWindowPickerCallbacks {
  /** Fired when the user picks a preset. 0 = clear override. */
  onPick: (contextWindow: number) => void;
}

/**
 * A button + dropdown that selects a per-session context window override.
 * Display label: "Ctx: 64K" or "Ctx: auto".
 */
export class ChatContextWindowPicker extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private readonly _label: HTMLSpanElement;
  private _dropdown: HTMLElement | undefined;
  private _closeHandler: ((e: MouseEvent) => void) | undefined;
  private _activeValue = 0;

  constructor(container: HTMLElement, private readonly _callbacks: IContextWindowPickerCallbacks) {
    super();

    this._root = $('div.parallx-chat-context-picker');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    this._button = document.createElement('button');
    this._button.className = 'parallx-chat-picker-btn parallx-chat-picker-btn--context';
    this._button.type = 'button';
    this._button.title = 'Context window for this chat (lower = faster, less VRAM)';
    this._root.appendChild(this._button);

    this._label = document.createElement('span');
    this._button.appendChild(this._label);

    const chevron = document.createElement('span');
    chevron.className = 'parallx-chat-picker-chevron';
    chevron.innerHTML = chatIcons.chevronDown;
    this._button.appendChild(chevron);

    this._register(addDisposableListener(this._button, 'click', () => {
      if (this._dropdown) {
        this._closeDropdown();
      } else {
        this._openDropdown();
      }
    }));

    this._renderLabel();
  }

  /** Reflect the current session's value in the button label. */
  setActiveContextWindow(value: number | undefined): void {
    this._activeValue = value && value > 0 ? Math.floor(value) : 0;
    this._renderLabel();
  }

  private _renderLabel(): void {
    this._label.textContent = this._activeValue > 0
      ? `Ctx: ${this._formatTokens(this._activeValue)}`
      : 'Ctx: auto';
  }

  private _openDropdown(): void {
    this._closeDropdown();

    const dropdown = $('div.parallx-chat-picker-dropdown');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    for (const preset of CONTEXT_WINDOW_PRESETS) {
      const item = $('div.parallx-chat-picker-item');
      const isActive = preset.value === this._activeValue;
      if (isActive) {
        item.classList.add('parallx-chat-picker-item--active');
      }

      // Leading check icon slot — shown for the active preset, kept as an
      // empty cell otherwise so all rows share the same leading column.
      const icon = document.createElement('span');
      icon.className = 'parallx-chat-picker-item-icon';
      icon.innerHTML = isActive ? chatIcons.check : '';
      item.appendChild(icon);

      const textCol = $('div.parallx-chat-picker-item-text');
      const name = $('span.parallx-chat-picker-item-name', preset.label);
      textCol.appendChild(name);
      const description = $('span.parallx-chat-picker-item-description', preset.description);
      textCol.appendChild(description);
      item.appendChild(textCol);

      item.addEventListener('click', () => {
        this._activeValue = preset.value;
        this._renderLabel();
        this._closeDropdown();
        this._callbacks.onPick(preset.value);
      });
      dropdown.appendChild(item);
    }

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

  /** 65536 → "64K", 131072 → "128K". */
  private _formatTokens(tokens: number): string {
    const k = tokens / 1024;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
}
