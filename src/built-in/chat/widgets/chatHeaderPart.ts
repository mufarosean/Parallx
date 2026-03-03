// chatHeaderPart.ts — Chat header toolbar (VS Code-style)
//
// Displays at the top of the chat panel with:
//   • Session title (editable on click)
//   • New Chat (+) button
//   • History (clock) button
//   • Clear (trash) button
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatViewPane.ts
//   (toolbar actions in the view title area)

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IChatHeaderAction } from '../chatTypes.js';

// IChatHeaderAction — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatHeaderAction } from '../chatTypes.js';

/**
 * Chat panel header — VS Code-style view title bar.
 *
 * Layout: [CHAT label + session info] ... [action buttons]
 * Matches VS Code Copilot's top bar: uppercase view name, actions on the right.
 */
export class ChatHeaderPart extends Disposable implements IChatHeaderAction {

  private readonly _root: HTMLElement;
  private readonly _titleEl: HTMLElement;
  private readonly _sessionInfoEl: HTMLElement;

  private readonly _onNewChat = this._register(new Emitter<void>());
  readonly onNewChat: Event<void> = this._onNewChat.event;

  private readonly _onToggleHistory = this._register(new Emitter<void>());
  readonly onToggleHistory: Event<void> = this._onToggleHistory.event;

  private readonly _onClearSession = this._register(new Emitter<void>());
  readonly onClearSession: Event<void> = this._onClearSession.event;

  constructor(container: HTMLElement) {
    super();

    this._root = $('div.parallx-chat-header');
    container.appendChild(this._root);

    // ── Left: Title area ──
    const left = $('div.parallx-chat-header-left');
    this._root.appendChild(left);

    this._titleEl = $('span.parallx-chat-header-title', 'CHAT');
    left.appendChild(this._titleEl);

    this._sessionInfoEl = $('span.parallx-chat-header-session-info');
    left.appendChild(this._sessionInfoEl);

    // ── Right: Action buttons ──
    const right = $('div.parallx-chat-header-actions');
    this._root.appendChild(right);

    // New Chat button
    const newChatBtn = this._createActionButton(
      chatIcons.newChat,
      'New Chat (Ctrl+L)',
      'parallx-chat-header-btn--new',
    );
    this._register(addDisposableListener(newChatBtn, 'click', () => this._onNewChat.fire()));
    right.appendChild(newChatBtn);

    // History button
    const historyBtn = this._createActionButton(
      chatIcons.history,
      'Chat History',
      'parallx-chat-header-btn--history',
    );
    this._register(addDisposableListener(historyBtn, 'click', () => this._onToggleHistory.fire()));
    right.appendChild(historyBtn);

    // Clear button
    const clearBtn = this._createActionButton(
      chatIcons.trash,
      'Clear Session',
      'parallx-chat-header-btn--clear',
    );
    this._register(addDisposableListener(clearBtn, 'click', () => this._onClearSession.fire()));
    right.appendChild(clearBtn);
  }

  // ── Public API ──

  /** Update the session title displayed in the header. */
  setTitle(title: string): void {
    this._titleEl.textContent = title || 'CHAT';
  }

  /** Update session metadata (message count, mode). */
  setSessionInfo(info: string): void {
    this._sessionInfoEl.textContent = info;
  }

  // ── Helpers ──

  private _createActionButton(svgHtml: string, tooltip: string, extraClass: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `parallx-chat-header-btn ${extraClass}`;
    btn.type = 'button';
    btn.title = tooltip;
    btn.setAttribute('aria-label', tooltip);
    btn.innerHTML = svgHtml;
    return btn;
  }

  override dispose(): void {
    this._root.remove();
    super.dispose();
  }
}
