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

/** Autonomy levels for Agent mode. */
export type AgentAutonomyLevel = 'manual' | 'allow-reads' | 'allow-safe' | 'custom';

const AUTONOMY_LEVELS: { value: AgentAutonomyLevel; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'Every action requires your OK' },
  { value: 'allow-reads', label: 'Allow Reads', description: 'Auto-search, ask for changes' },
  { value: 'allow-safe', label: 'Allow Safe', description: 'Reads + safe edits run automatically' },
  { value: 'custom', label: 'Custom', description: 'You set the rules in Settings → Agent' },
];

/** Mode display metadata. */
const MODE_META: Record<ChatMode, { label: string; title: string; description: string; icon: string }> = {
  [ChatMode.Ask]: {
    label: 'Ask',
    title: 'Ask mode — answers grounded in your workspace',
    description: 'AI answers questions using workspace context',
    icon: chatIcons.chatBubble,
  },
  [ChatMode.Edit]: {
    label: 'Edit',
    title: 'Edit mode — structured canvas changes',
    description: 'AI proposes file changes for you to review',
    icon: chatIcons.pencil,
  },
  [ChatMode.Agent]: {
    label: 'Agent',
    title: 'Agent mode — awake, action-capable, approval-aware',
    description: 'AI takes multi-step actions with your approval',
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
  private _autonomyLevel: AgentAutonomyLevel = 'allow-reads';

  private readonly _onDidSelectMode = this._register(new Emitter<ChatMode>());
  readonly onDidSelectMode: Event<ChatMode> = this._onDidSelectMode.event;

  private readonly _onDidChangeAutonomy = this._register(new Emitter<AgentAutonomyLevel>());
  readonly onDidChangeAutonomy: Event<AgentAutonomyLevel> = this._onDidChangeAutonomy.event;

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

    // ── Autonomy level sub-selector (visible when Agent is current mode) ──
    if (currentMode === ChatMode.Agent) {
      const separator = $('div.parallx-chat-picker-separator');
      dropdown.appendChild(separator);

      const autonomyHeader = $('div.parallx-chat-picker-autonomy-header', 'Agent autonomy');
      dropdown.appendChild(autonomyHeader);

      for (const level of AUTONOMY_LEVELS) {
        const chip = $('div.parallx-chat-picker-autonomy-chip');
        if (level.value === this._autonomyLevel) {
          chip.classList.add('parallx-chat-picker-autonomy-chip--active');
        }
        chip.textContent = level.label;
        chip.title = level.description;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this._autonomyLevel = level.value;
          this._onDidChangeAutonomy.fire(level.value);
          this._closeDropdown();
        });
        dropdown.appendChild(chip);
      }
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

  get autonomyLevel(): AgentAutonomyLevel {
    return this._autonomyLevel;
  }
}
