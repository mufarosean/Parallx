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

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, addDisposableListener } from '../../ui/dom.js';

export interface IChatHeaderAction {
  readonly onNewChat: Event<void>;
  readonly onToggleHistory: Event<void>;
  readonly onClearSession: Event<void>;
}

/**
 * Chat panel header — title + action buttons.
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

    this._titleEl = $('span.parallx-chat-header-title', 'Chat');
    left.appendChild(this._titleEl);

    this._sessionInfoEl = $('span.parallx-chat-header-session-info');
    left.appendChild(this._sessionInfoEl);

    // ── Right: Action buttons ──
    const right = $('div.parallx-chat-header-actions');
    this._root.appendChild(right);

    // New Chat button
    const newChatBtn = this._createActionButton(
      '\u002B', // +
      'New Chat (Ctrl+L)',
      'parallx-chat-header-btn--new',
    );
    this._register(addDisposableListener(newChatBtn, 'click', () => this._onNewChat.fire()));
    right.appendChild(newChatBtn);

    // History button
    const historyBtn = this._createActionButton(
      '\u{1F552}', // 🕒
      'Chat History',
      'parallx-chat-header-btn--history',
    );
    this._register(addDisposableListener(historyBtn, 'click', () => this._onToggleHistory.fire()));
    right.appendChild(historyBtn);

    // Clear button
    const clearBtn = this._createActionButton(
      '\u{1F5D1}', // 🗑
      'Clear Session',
      'parallx-chat-header-btn--clear',
    );
    this._register(addDisposableListener(clearBtn, 'click', () => this._onClearSession.fire()));
    right.appendChild(clearBtn);
  }

  // ── Public API ──

  /** Update the session title displayed in the header. */
  setTitle(title: string): void {
    this._titleEl.textContent = title || 'Chat';
  }

  /** Update session metadata (message count, mode). */
  setSessionInfo(info: string): void {
    this._sessionInfoEl.textContent = info;
  }

  // ── Helpers ──

  private _createActionButton(icon: string, tooltip: string, extraClass: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `parallx-chat-header-btn ${extraClass}`;
    btn.type = 'button';
    btn.title = tooltip;
    btn.textContent = icon;
    return btn;
  }

  override dispose(): void {
    this._root.remove();
    super.dispose();
  }
}
