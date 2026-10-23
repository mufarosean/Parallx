// chatModePicker.ts — Mode picker dropdown (M9 Task 3.7)
//
// Dropdown showing current chat mode (Ask/Edit/Agent).
// Button shows current mode label; click opens a dropdown list.
// Follows the same pattern as ChatModelPicker.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts
//   (mode picker portion integrated into input toolbar)

import { createSegmented, declareControl } from '../../../ui/kit.js';
import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { ChatMode } from '../../../services/chatTypes.js';
import { chatIcons } from '../chatIcons.js';
import type { IModePickerServices } from '../chatTypes.js';
import { PERMISSION_MODES, type PermissionMode } from '../../../services/permissionService.js';

// IModePickerServices — now defined in chatTypes.ts
export type { IModePickerServices } from '../chatTypes.js';

// Below the modes, in Agent mode, sits the permission mode: Ask, Auto or
// Careful, one switch the way Claude Code has one, wired through
// IModePickerServices to the permission service, with a line that says
// what the chosen mode really does.

/** The permission modes as the picker names them, and what each one really does. */
export const PERMISSION_MODE_META: Record<PermissionMode, { label: string; truth: string }> = {
  ask: {
    label: 'Ask',
    truth: 'Ask: file writes run and are checkpointed; /rewind restores them. Shell commands ask until you allow a command family; deletes always ask.',
  },
  auto: {
    label: 'Auto',
    truth: 'Auto: everything runs without asking, the shell and deletes included. Only the hard blocklist and a never-allowed ban hold. Writes are checkpointed; /rewind restores them.',
  },
  careful: {
    label: 'Careful',
    truth: 'Careful: every consequential action asks first, always-allow grants included.',
  },
};

/**
 * Mode display metadata. EXPORTED so other surfaces (the chat empty state)
 * describe a mode in the picker's own words instead of keeping a second copy
 * that silently drifts — the old empty state claimed "/agent " switched modes,
 * which was never true.
 */
export const MODE_META: Record<ChatMode, { label: string; title: string; description: string; icon: string }> = {
  [ChatMode.Edit]: {
    label: 'Edit',
    title: 'Edit mode: structured canvas changes',
    description: 'AI proposes file changes for you to review.',
    icon: chatIcons.pencil,
  },
  [ChatMode.Agent]: {
    label: 'Agent',
    title: 'Agent mode: awake, action-capable, approval-aware',
    description: 'AI takes multi-step actions with your approval.',
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
    declareControl(this._button, { id: 'chat.mode', label: 'Chat mode', state: () => ({ kind: 'value', value: this._button.textContent?.trim() ?? '' }) });
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

    // icon + chevron only. The mode name lives in the dropdown (with
    // icon + description) and in the hover title, keeping the toolbar tight.
    const icon = document.createElement('span');
    icon.className = 'parallx-chat-picker-icon';
    icon.innerHTML = meta.icon;
    this._button.appendChild(icon);

    // Chevron
    const chevron = document.createElement('span');
    chevron.className = 'parallx-chat-picker-chevron';
    chevron.innerHTML = chatIcons.chevronDown;
    this._button.appendChild(chevron);

    this._button.title = meta.title;
    this._button.setAttribute('aria-label', `Chat mode: ${meta.label}`);
  }

  /**
   * Open the real dropdown from elsewhere in the UI (the chat empty state's
   * mode cell). Teaching the control the user will keep using beats rendering
   * a lookalike that only exists on the empty state.
   */
  openDropdown(): void {
    if (!this._dropdown) { this._openDropdown(); }
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

      const textCol = $('div.parallx-chat-picker-item-text');

      const name = $('span.parallx-chat-picker-item-name', meta.label);
      textCol.appendChild(name);

      const description = $('span.parallx-chat-picker-item-description', meta.description);
      textCol.appendChild(description);

      item.appendChild(textCol);

      item.addEventListener('click', () => {
        this._services.setMode(mode);
        this._onDidSelectMode.fire(mode);
        this._closeDropdown();
      });

      dropdown.appendChild(item);
    }

    // ── The permission mode: Ask / Auto / Careful ──
    // One switch, wired through IModePickerServices to the permission
    // service. The line under it is derived from the chosen mode, so it is
    // never a sentence that went false when the mode changed.
    const { getPermissionMode, setPermissionMode } = this._services;
    if (currentMode === ChatMode.Agent && getPermissionMode && setPermissionMode) {
      dropdown.appendChild($('div.parallx-chat-picker-separator'));
      const row = $('div.parallx-chat-picker-autonomy-row');
      const truth = $('div.parallx-chat-picker-gating-truth', PERMISSION_MODE_META[getPermissionMode()].truth);
      createSegmented(row, {
        id: 'chat.permissionMode',
        ariaLabel: 'Permissions',
        items: PERMISSION_MODES.map((value) => ({ value, label: PERMISSION_MODE_META[value].label })),
        value: getPermissionMode(),
        onChange: (value) => {
          setPermissionMode(value as PermissionMode);
          truth.textContent = PERMISSION_MODE_META[value as PermissionMode].truth;
        },
      });
      dropdown.appendChild(row);
      dropdown.appendChild(truth);
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
