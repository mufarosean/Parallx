// chatModelPicker.ts — Model picker dropdown (M9 Task 3.7)
//
// Dropdown showing available models from ILanguageModelsService.
// Populated from getModels(), refreshes on onDidChangeModels.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts
//   (ChatModelPickerWidget portion)

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IModelPickerServices } from '../chatTypes.js';

// IModelPickerServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IModelPickerServices } from '../chatTypes.js';

/**
 * Model picker — a button that opens a dropdown list of available models.
 */
export class ChatModelPicker extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private _dropdown: HTMLElement | undefined;
  private _closeHandler: ((e: MouseEvent) => void) | undefined;
  private _opening = false;
  private _services: IModelPickerServices;

  private readonly _onDidSelectModel = this._register(new Emitter<string>());
  readonly onDidSelectModel: Event<string> = this._onDidSelectModel.event;

  constructor(container: HTMLElement, services: IModelPickerServices) {
    super();
    this._services = services;

    this._root = $('div.parallx-chat-model-picker');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    this._button = document.createElement('button');
    this._button.className = 'parallx-chat-picker-btn parallx-chat-picker-btn--model';
    this._button.type = 'button';
    this._button.textContent = 'Model\u2026';
    this._root.appendChild(this._button);

    // Click to toggle dropdown
    this._register(addDisposableListener(this._button, 'click', () => {
      if (this._dropdown) {
        this._closeDropdown();
      } else {
        this._openDropdown();
      }
    }));

    // Update button label
    this._register(this._services.onDidChangeModels(() => {
      this._updateLabel();
    }));

    this._updateLabel();
  }

  private _updateLabel(): void {
    const activeId = this._services.getActiveModel();
    this._button.innerHTML = '';

    const label = document.createElement('span');
    if (activeId) {
      label.textContent = activeId.length > 20 ? activeId.slice(0, 17) + '\u2026' : activeId;
    } else {
      label.textContent = 'No model';
    }
    this._button.appendChild(label);

    // Chevron
    const chevron = document.createElement('span');
    chevron.className = 'parallx-chat-picker-chevron';
    chevron.innerHTML = chatIcons.chevronDown;
    this._button.appendChild(chevron);
  }

  private async _openDropdown(): Promise<void> {
    if (this._opening) return; // Re-entry guard: ignore clicks while loading
    this._opening = true;
    this._closeDropdown();

    let models: readonly { id: string; displayName: string; parameterSize: string; contextLength: number; capabilities?: readonly string[] }[];
    try {
      models = await this._services.getModels();
    } catch {
      this._opening = false;
      return;
    }
    const activeId = this._services.getActiveModel();

    const dropdown = $('div.parallx-chat-picker-dropdown');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    if (models.length === 0) {
      const empty = $('div.parallx-chat-picker-item.parallx-chat-picker-item--empty', 'No models available');
      dropdown.appendChild(empty);
    } else {
      for (const model of models) {
        const item = $('div.parallx-chat-picker-item');
        const isActive = model.id === activeId;
        if (isActive) {
          item.classList.add('parallx-chat-picker-item--active');
        }

        const name = $('span.parallx-chat-picker-item-name', model.displayName);
        // Use contextLength already on the model object (populated by probe)
        const ctxLabel = model.contextLength > 0 ? ` · ${this._formatContextLength(model.contextLength)}` : '';
        const size = $('span.parallx-chat-picker-item-size', `${model.parameterSize}${ctxLabel}`);
        item.appendChild(name);
        item.appendChild(size);

        item.addEventListener('click', () => {
          this._services.setActiveModel(model.id);
          this._onDidSelectModel.fire(model.id);
          this._closeDropdown();
        });

        dropdown.appendChild(item);
      }
    }

    // Position below button
    const rect = this._button.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(dropdown);
    this._dropdown = dropdown;
    this._opening = false;

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !this._button.contains(e.target as Node)) {
        this._closeDropdown();
      }
    };
    this._closeHandler = closeHandler;
    document.addEventListener('mousedown', closeHandler);
  }

  private _closeDropdown(): void {
    this._opening = false;
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

  /** Format context length for display: 4096 → "4K", 131072 → "128K". */
  private _formatContextLength(tokens: number): string {
    if (tokens >= 1_000_000) {
      const m = tokens / 1_000_000;
      return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
    }
    const k = tokens / 1024;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
}
