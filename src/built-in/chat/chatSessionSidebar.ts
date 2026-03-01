// chatSessionSidebar.ts — Collapsible session sidebar (right panel)
//
// Shows on the right edge of the chat widget. Collapsed state is a
// thin icon strip (36px); expanded state shows the full session list
// with title, message count, date, and preview.
//
// VS Code reference:
//   Activity bar concept adapted for session management.

import { Disposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import type { IChatSession } from '../../services/chatTypes.js';

export interface ISessionSidebarServices {
  getSessions(): readonly IChatSession[];
  deleteSession(sessionId: string): void;
}

/**
 * Collapsible session sidebar — right-side panel listing chat sessions.
 *
 * Collapsed: thin icon strip with session count badge.
 * Expanded: ~220px panel with full session list.
 */
export class ChatSessionSidebar extends Disposable {

  // ── DOM ──

  private readonly _root: HTMLElement;
  private readonly _collapsedStrip: HTMLElement;
  private readonly _expandedPanel: HTMLElement;
  private readonly _sessionList: HTMLElement;
  private readonly _badgeEl: HTMLElement;

  // ── State ──

  private _expanded = false;
  private _activeSessionId: string | undefined;

  // ── Events ──

  private readonly _onDidSelectSession = this._register(new Emitter<string>());
  readonly onDidSelectSession: Event<string> = this._onDidSelectSession.event;

  private readonly _onDidRequestNewSession = this._register(new Emitter<void>());
  readonly onDidRequestNewSession: Event<void> = this._onDidRequestNewSession.event;

  private readonly _onDidToggle = this._register(new Emitter<boolean>());
  /** Fires with `true` when expanded, `false` when collapsed. */
  readonly onDidToggle: Event<boolean> = this._onDidToggle.event;

  // ── Services ──

  private readonly _services: ISessionSidebarServices;

  constructor(container: HTMLElement, services: ISessionSidebarServices) {
    super();
    this._services = services;

    this._root = $('div.parallx-chat-session-sidebar');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // ── Collapsed strip (default visible) ──

    this._collapsedStrip = $('div.parallx-chat-session-sidebar-strip');
    this._root.appendChild(this._collapsedStrip);

    // Toggle button (top of strip)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'parallx-chat-session-sidebar-toggle';
    toggleBtn.type = 'button';
    toggleBtn.title = 'Toggle Sessions';
    toggleBtn.textContent = '\u{1F4CB}'; // 📋
    this._collapsedStrip.appendChild(toggleBtn);
    this._register(addDisposableListener(toggleBtn, 'click', () => this.toggle()));

    // Session count badge
    this._badgeEl = $('span.parallx-chat-session-sidebar-badge');
    this._collapsedStrip.appendChild(this._badgeEl);

    // New session button (bottom of strip)
    const newBtn = document.createElement('button');
    newBtn.className = 'parallx-chat-session-sidebar-new';
    newBtn.type = 'button';
    newBtn.title = 'New Chat';
    newBtn.textContent = '\u002B'; // +
    this._collapsedStrip.appendChild(newBtn);
    this._register(addDisposableListener(newBtn, 'click', () => {
      this._onDidRequestNewSession.fire();
    }));

    // ── Expanded panel (hidden by default) ──

    this._expandedPanel = $('div.parallx-chat-session-sidebar-panel');
    this._root.appendChild(this._expandedPanel);

    // Panel header
    const panelHeader = $('div.parallx-chat-session-sidebar-panel-header');

    const panelTitle = $('span.parallx-chat-session-sidebar-panel-title', 'Sessions');
    panelHeader.appendChild(panelTitle);

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'parallx-chat-session-sidebar-collapse';
    collapseBtn.type = 'button';
    collapseBtn.title = 'Collapse';
    collapseBtn.textContent = '\u203A'; // ›
    this._register(addDisposableListener(collapseBtn, 'click', () => this.collapse()));
    panelHeader.appendChild(collapseBtn);

    this._expandedPanel.appendChild(panelHeader);

    // Session list (scrollable)
    this._sessionList = $('div.parallx-chat-session-sidebar-list');
    this._expandedPanel.appendChild(this._sessionList);

    // Panel footer with new session button
    const panelFooter = $('div.parallx-chat-session-sidebar-panel-footer');
    const newSessionBtn = document.createElement('button');
    newSessionBtn.className = 'parallx-chat-session-sidebar-new-btn';
    newSessionBtn.type = 'button';
    newSessionBtn.textContent = '+ New Chat';
    this._register(addDisposableListener(newSessionBtn, 'click', () => {
      this._onDidRequestNewSession.fire();
    }));
    panelFooter.appendChild(newSessionBtn);
    this._expandedPanel.appendChild(panelFooter);

    // Initial state: collapsed
    this._applyState();
  }

  // ── Public API ──

  toggle(): void {
    this._expanded = !this._expanded;
    this._applyState();
    this._onDidToggle.fire(this._expanded);
    if (this._expanded) {
      this.refresh();
    }
  }

  expand(): void {
    if (!this._expanded) {
      this._expanded = true;
      this._applyState();
      this._onDidToggle.fire(true);
      this.refresh();
    }
  }

  collapse(): void {
    if (this._expanded) {
      this._expanded = false;
      this._applyState();
      this._onDidToggle.fire(false);
    }
  }

  get isExpanded(): boolean {
    return this._expanded;
  }

  /** Update the active session to highlight. */
  setActiveSession(sessionId: string | undefined): void {
    this._activeSessionId = sessionId;
    this._updateBadge();
    if (this._expanded) {
      this.refresh();
    }
  }

  /** Re-render the session list. */
  refresh(): void {
    this._renderSessionList();
    this._updateBadge();
  }

  // ── Internal ──

  private _applyState(): void {
    this._root.classList.toggle('parallx-chat-session-sidebar--expanded', this._expanded);
    this._collapsedStrip.style.display = this._expanded ? 'none' : '';
    this._expandedPanel.style.display = this._expanded ? '' : 'none';
  }

  private _updateBadge(): void {
    const sessions = this._services.getSessions();
    const count = sessions.length;
    this._badgeEl.textContent = count > 0 ? String(count) : '';
    this._badgeEl.style.display = count > 0 ? '' : 'none';
  }

  private _renderSessionList(): void {
    // Clear existing items
    this._sessionList.innerHTML = '';

    const sessions = this._services.getSessions();

    if (sessions.length === 0) {
      const empty = $('div.parallx-chat-session-sidebar-empty', 'No sessions yet');
      this._sessionList.appendChild(empty);
      return;
    }

    // Sort by createdAt descending (newest first)
    const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);

    for (const session of sorted) {
      const item = this._buildSessionItem(session);
      this._sessionList.appendChild(item);
    }
  }

  private _buildSessionItem(session: IChatSession): HTMLElement {
    const isActive = session.id === this._activeSessionId;

    const item = $('div.parallx-chat-session-sidebar-item');
    if (isActive) {
      item.classList.add('parallx-chat-session-sidebar-item--active');
    }

    // Session info
    const info = $('div.parallx-chat-session-sidebar-item-info');

    const title = $('div.parallx-chat-session-sidebar-item-title',
      session.title || 'New Chat');
    info.appendChild(title);

    const meta = $('div.parallx-chat-session-sidebar-item-meta');
    const messageCount = session.messages.length;
    const dateStr = this._formatDate(session.createdAt);
    meta.textContent = `${messageCount} msg${messageCount !== 1 ? 's' : ''} \u00B7 ${dateStr}`;
    info.appendChild(meta);

    // First message preview
    if (messageCount > 0) {
      const preview = $('div.parallx-chat-session-sidebar-item-preview');
      const firstMsg = session.messages[0].request.text;
      preview.textContent = firstMsg.length > 60
        ? firstMsg.slice(0, 57) + '\u2026'
        : firstMsg;
      info.appendChild(preview);
    }

    info.addEventListener('click', () => {
      this._onDidSelectSession.fire(session.id);
    });

    item.appendChild(info);

    // Delete button (not on active session)
    if (!isActive) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'parallx-chat-session-sidebar-item-delete';
      deleteBtn.type = 'button';
      deleteBtn.title = 'Delete';
      deleteBtn.textContent = '\u00D7'; // ×
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._services.deleteSession(session.id);
        item.remove();
        this._updateBadge();
        // Re-check if list is empty
        if (this._sessionList.children.length === 0) {
          const empty = $('div.parallx-chat-session-sidebar-empty', 'No sessions yet');
          this._sessionList.appendChild(empty);
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

    if (minutes < 1) { return 'now'; }
    if (minutes < 60) { return `${minutes}m`; }
    if (hours < 24) { return `${hours}h`; }
    if (days < 7) { return `${days}d`; }

    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  override dispose(): void {
    this._root.remove();
    super.dispose();
  }
}
