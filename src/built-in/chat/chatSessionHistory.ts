// chatSessionHistory.ts — Session history overlay (VS Code-style)
//
// Dropdown overlay listing all chat sessions. Allows switching between
// sessions and deleting old ones. Triggered by the history button in
// ChatHeaderPart.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatViewPane.ts
//   (chat history quick pick / overlay)

import { Disposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $ } from '../../ui/dom.js';
import type { IChatSession } from '../../services/chatTypes.js';

export interface ISessionHistoryServices {
  getSessions(): readonly IChatSession[];
  deleteSession(sessionId: string): void;
}

/**
 * Session history overlay — lists past chat sessions.
 */
export class ChatSessionHistory extends Disposable {

  private readonly _root: HTMLElement;
  private _overlay: HTMLElement | undefined;
  private _visible = false;

  private readonly _onDidSelectSession = this._register(new Emitter<string>());
  readonly onDidSelectSession: Event<string> = this._onDidSelectSession.event;

  private readonly _services: ISessionHistoryServices;
  private _activeSessionId: string | undefined;

  constructor(container: HTMLElement, services: ISessionHistoryServices) {
    super();
    this._services = services;
    this._root = container;
  }

  // ── Public API ──

  /** Toggle the history overlay visibility. */
  toggle(activeSessionId?: string): void {
    this._activeSessionId = activeSessionId;
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** Show the overlay. */
  show(): void {
    this.hide(); // clean up any existing overlay

    const sessions = this._services.getSessions();

    this._overlay = $('div.parallx-chat-history-overlay');

    // Header
    const header = $('div.parallx-chat-history-header');
    const headerTitle = $('span.parallx-chat-history-header-title', 'Chat History');
    header.appendChild(headerTitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'parallx-chat-history-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '\u00D7'; // ×
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);

    this._overlay.appendChild(header);

    // Session list
    const list = $('div.parallx-chat-history-list');

    if (sessions.length === 0) {
      const empty = $('div.parallx-chat-history-empty', 'No chat sessions yet.');
      list.appendChild(empty);
    } else {
      // Sort by createdAt descending (newest first)
      const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);

      for (const session of sorted) {
        const item = this._buildSessionItem(session);
        list.appendChild(item);
      }
    }

    this._overlay.appendChild(list);
    this._root.appendChild(this._overlay);
    this._visible = true;

    // Close on click outside (deferred to avoid the triggering click)
    requestAnimationFrame(() => {
      const handler = (e: MouseEvent) => {
        if (this._overlay && !this._overlay.contains(e.target as Node)) {
          this.hide();
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
      this._register(toDisposable(() => document.removeEventListener('mousedown', handler)));
    });
  }

  /** Hide the overlay. */
  hide(): void {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = undefined;
    }
    this._visible = false;
  }

  get isVisible(): boolean {
    return this._visible;
  }

  // ── Builders ──

  private _buildSessionItem(session: IChatSession): HTMLElement {
    const item = $('div.parallx-chat-history-item');
    const isActive = session.id === this._activeSessionId;

    if (isActive) {
      item.classList.add('parallx-chat-history-item--active');
    }

    // Session info
    const info = $('div.parallx-chat-history-item-info');

    const title = $('div.parallx-chat-history-item-title',
      session.title || 'New Chat');
    info.appendChild(title);

    const meta = $('div.parallx-chat-history-item-meta');
    const messageCount = session.messages.length;
    const dateStr = this._formatDate(session.createdAt);
    meta.textContent = `${messageCount} message${messageCount !== 1 ? 's' : ''} \u00B7 ${dateStr}`;
    info.appendChild(meta);

    // First message preview
    if (messageCount > 0) {
      const preview = $('div.parallx-chat-history-item-preview');
      const firstMsg = session.messages[0].request.text;
      preview.textContent = firstMsg.length > 80
        ? firstMsg.slice(0, 77) + '\u2026'
        : firstMsg;
      info.appendChild(preview);
    }

    item.appendChild(info);

    // Click to select
    info.addEventListener('click', () => {
      this._onDidSelectSession.fire(session.id);
      this.hide();
    });

    // Delete button
    if (!isActive) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'parallx-chat-history-item-delete';
      deleteBtn.type = 'button';
      deleteBtn.title = 'Delete session';
      deleteBtn.textContent = '\u00D7'; // ×
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._services.deleteSession(session.id);
        item.remove();
        // If list is now empty, show empty state
        const list = this._overlay?.querySelector('.parallx-chat-history-list');
        if (list && list.children.length === 0) {
          const empty = $('div.parallx-chat-history-empty', 'No chat sessions yet.');
          list.appendChild(empty);
        }
      });
      item.appendChild(deleteBtn);
    }

    return item;
  }

  private _formatDate(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);

    if (minutes < 1) { return 'just now'; }
    if (minutes < 60) { return `${minutes}m ago`; }
    if (hours < 24) { return `${hours}h ago`; }
    if (days < 7) { return `${days}d ago`; }

    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  override dispose(): void {
    this.hide();
    super.dispose();
  }
}
