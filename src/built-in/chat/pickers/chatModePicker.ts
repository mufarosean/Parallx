// chatModePicker.ts — Mode picker dropdown (M9 Task 3.7)
//
// Dropdown showing current chat mode (Ask/Edit/Agent).
// Button shows current mode label; click opens a dropdown list.
// Follows the same pattern as ChatModelPicker.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts
//   (mode picker portion integrated into input toolbar)

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { ChatMode } from '../../../services/chatTypes.js';
import { chatIcons } from '../chatIcons.js';
import type { IModePickerServices } from '../chatTypes.js';

// IModePickerServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IModePickerServices } from '../chatTypes.js';

/** Mode display metadata. */
const MODE_META: Record<ChatMode, { label: string; title: string; description: string; icon: string }> = {
  [ChatMode.Ask]: {
    label: 'Ask',
    title: 'Ask mode — awake, read-first, no side effects',
    description: 'Awake by default; uses read-only tools',
    icon: chatIcons.chatBubble,
  },
  [ChatMode.Edit]: {
    label: 'Edit',
    title: 'Edit mode — structured canvas changes',
    description: 'Focused edit proposals with accept/reject',
    icon: chatIcons.pencil,
  },
  [ChatMode.Agent]: {
    label: 'Agent',
    title: 'Agent mode — awake, action-capable, approval-aware',
    description: 'Action tools with approval gates',
    icon: chatIcons.agent,
  },
};

/**
 * Mode picker — dropdown button for Ask / Edit / Agent.
 */
export class ChatModePicker extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private _dropdown: HTMLElement | undefined;
  private _closeHandler: ((e: MouseEvent) => void) | undefined;
  private _services: IModePickerServices;

  private readonly _onDidSelectMode = this._register(new Emitter<ChatMode>());
  readonly onDidSelectMode: Event<ChatMode> = this._onDidSelectMode.event;

  constructor(container: HTMLElement, services: IModePickerServices) {
    super();
    this._services = services;

    this._root = $('div.parallx-chat-mode-picker');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // Button showing current mode + chevron
    this._button = document.createElement('button');
    this._button.className = 'parallx-chat-picker-btn parallx-chat-picker-btn--mode';
    this._button.type = 'button';
    this._root.appendChild(this._button);

    // Click to toggle dropdown
    this._register(addDisposableListener(this._button, 'click', () => {
      if (this._dropdown) {
        this._closeDropdown();
      } else {
        this._openDropdown();
      }
    }));

    // Update button label when mode changes externally
    this._register(this._services.onDidChangeMode(() => {
      this._updateLabel();
    }));

    this._updateLabel();
  }

  private _updateLabel(): void {
    const current = this._services.getMode();
    const meta = MODE_META[current];
    this._button.innerHTML = '';

    const icon = document.createElement('span');
    icon.className = 'parallx-chat-picker-icon';
    icon.innerHTML = meta.icon;
    this._button.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'parallx-chat-picker-label';
    label.textContent = meta.label;
    this._button.appendChild(label);

    // Chevron
    const chevron = document.createElement('span');
    chevron.className = 'parallx-chat-picker-chevron';
    chevron.innerHTML = chatIcons.chevronDown;
    this._button.appendChild(chevron);

    this._button.title = meta.title;
  }

  private _openDropdown(): void {
    this._closeDropdown();

    const currentMode = this._services.getMode();
    const modes = this._services.getAvailableModes();

    const dropdown = $('div.parallx-chat-picker-dropdown');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    for (const mode of modes) {
      const meta = MODE_META[mode];
      const item = $('div.parallx-chat-picker-item');
      if (mode === currentMode) {
        item.classList.add('parallx-chat-picker-item--active');
      }

      const icon = document.createElement('span');
      icon.className = 'parallx-chat-picker-item-icon';
      icon.innerHTML = meta.icon;
      item.appendChild(icon);

      const name = $('span.parallx-chat-picker-item-name', meta.label);
      item.appendChild(name);

      const description = $('span.parallx-chat-picker-item-description', meta.description);
      item.appendChild(description);

      item.addEventListener('click', () => {
        this._services.setMode(mode);
        this._onDidSelectMode.fire(mode);
        this._closeDropdown();
      });

      dropdown.appendChild(item);
    }

    // Position below button (opening upward from the input bar)
    const rect = this._button.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(dropdown);
    this._dropdown = dropdown;

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
}
