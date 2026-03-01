// chatModePicker.ts — Mode picker (Ask/Edit/Agent) (M9 Task 3.7)
//
// Three-state toggle showing current chat mode.
// Selecting fires IChatModeService.setMode().
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts
//   (mode picker portion integrated into input toolbar)

import { Disposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import { ChatMode } from '../../services/chatTypes.js';

/** Service accessor for mode picker. */
export interface IModePickerServices {
  getMode(): ChatMode;
  setMode(mode: ChatMode): void;
  getAvailableModes(): readonly ChatMode[];
  readonly onDidChangeMode: Event<ChatMode>;
}

/** Mode display metadata. */
const MODE_META: Record<ChatMode, { label: string; title: string }> = {
  [ChatMode.Ask]: { label: 'Ask', title: 'Q&A mode — no side effects' },
  [ChatMode.Edit]: { label: 'Edit', title: 'Edit mode — canvas editing with accept/reject' },
  [ChatMode.Agent]: { label: 'Agent', title: 'Agent mode — autonomous with tool invocation' },
};

/**
 * Mode picker — segmented control for Ask / Edit / Agent.
 */
export class ChatModePicker extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _buttons = new Map<ChatMode, HTMLButtonElement>();
  private _services: IModePickerServices;

  private readonly _onDidSelectMode = this._register(new Emitter<ChatMode>());
  readonly onDidSelectMode: Event<ChatMode> = this._onDidSelectMode.event;

  constructor(container: HTMLElement, services: IModePickerServices) {
    super();
    this._services = services;

    this._root = $('div.parallx-chat-mode-picker');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    const modes = this._services.getAvailableModes();
    for (const mode of modes) {
      const meta = MODE_META[mode];
      const btn = document.createElement('button');
      btn.className = 'parallx-chat-mode-btn';
      btn.textContent = meta.label;
      btn.title = meta.title;
      btn.type = 'button';
      btn.dataset.mode = mode;
      this._root.appendChild(btn);
      this._buttons.set(mode, btn);

      this._register(addDisposableListener(btn, 'click', () => {
        this._services.setMode(mode);
        this._onDidSelectMode.fire(mode);
      }));
    }

    // Update highlight
    this._register(this._services.onDidChangeMode(() => {
      this._updateHighlight();
    }));

    this._updateHighlight();
  }

  private _updateHighlight(): void {
    const current = this._services.getMode();
    for (const [mode, btn] of this._buttons) {
      btn.classList.toggle('parallx-chat-mode-btn--active', mode === current);
    }
  }
}
