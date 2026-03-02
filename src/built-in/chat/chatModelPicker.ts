// chatModelPicker.ts — Model picker dropdown (M9 Task 3.7)
//
// Dropdown showing available models from ILanguageModelsService.
// Populated from getModels(), refreshes on onDidChangeModels.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts
//   (ChatModelPickerWidget portion)

import { Disposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import type { ILanguageModelInfo } from '../../services/chatTypes.js';
import { chatIcons } from './chatIcons.js';

/** Service accessor for model picker. */
export interface IModelPickerServices {
  getModels(): Promise<readonly ILanguageModelInfo[]>;
  getActiveModel(): string | undefined;
  setActiveModel(modelId: string): void;
  readonly onDidChangeModels: Event<void>;
}

/**
 * Model picker — a button that opens a dropdown list of available models.
 */
export class ChatModelPicker extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private _dropdown: HTMLElement | undefined;
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
    this._button.className = 'parallx-chat-picker-btn';
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
    this._closeDropdown();

    const models = await this._services.getModels();
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
        const size = $('span.parallx-chat-picker-item-size', model.parameterSize);
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

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !this._button.contains(e.target as Node)) {
        this._closeDropdown();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    document.addEventListener('mousedown', closeHandler);
  }

  private _closeDropdown(): void {
    if (this._dropdown) {
      this._dropdown.remove();
      this._dropdown = undefined;
    }
  }

  override dispose(): void {
    this._closeDropdown();
    super.dispose();
  }
}
