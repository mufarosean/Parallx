// chatSessionSidebar.ts — VS Code-style chat history panel
//
// Right-side panel showing session history grouped by date.
// Toggled on/off (no collapsed strip) via header toolbar button.
//
// Layout: header (SESSIONS title + toolbar) → optional filter input
//         → scrollable session list with date-group section headers.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatHistory.ts

import { Disposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import type { IChatSession } from '../../services/chatTypes.js';
import { chatIcons } from './chatIcons.js';

// ── Types ──

export interface ISessionSidebarServices {
  getSessions(): readonly IChatSession[];
  deleteSession(sessionId: string): void;
}

// ── Date grouping buckets ──

type DateGroup = 'Today' | 'Yesterday' | 'Last 7 Days' | 'Last 30 Days' | 'Older';

function _getDateGroup(timestamp: number): DateGroup {
  const now = Date.now();
  const diff = now - timestamp;
  const dayMs = 86_400_000;

  // "Today" = same calendar day
  const nowDate = new Date(now);
  const tsDate = new Date(timestamp);
  if (
    nowDate.getFullYear() === tsDate.getFullYear() &&
    nowDate.getMonth() === tsDate.getMonth() &&
    nowDate.getDate() === tsDate.getDate()
  ) {
    return 'Today';
  }

  // "Yesterday" = previous calendar day
  const yesterday = new Date(now - dayMs);
  if (
    yesterday.getFullYear() === tsDate.getFullYear() &&
    yesterday.getMonth() === tsDate.getMonth() &&
    yesterday.getDate() === tsDate.getDate()
  ) {
    return 'Yesterday';
  }

  if (diff < 7 * dayMs) { return 'Last 7 Days'; }
  if (diff < 30 * dayMs) { return 'Last 30 Days'; }
  return 'Older';
}

const GROUP_ORDER: readonly DateGroup[] = [
  'Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older',
];

// ── Relative time formatting ──

function _formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) { return 'just now'; }
  if (minutes < 60) { return `${minutes}m ago`; }
  if (hours < 24) { return `${hours}h ago`; }
  if (days === 1) { return 'yesterday'; }
  if (days < 7) { return `${days}d ago`; }
  if (days < 30) { return `${Math.floor(days / 7)}w ago`; }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChatSessionSidebar
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * VS Code-style chat history sidebar — date-grouped session list with
 * search/filter capability. Shown/hidden (no collapsed state).
 */
export class ChatSessionSidebar extends Disposable {

  // ── DOM ──

  private readonly _root: HTMLElement;
  private readonly _filterContainer: HTMLElement;
  private readonly _filterInput: HTMLInputElement;
  private readonly _sessionList: HTMLElement;
  private readonly _emptyEl: HTMLElement;

  // ── State ──

  private _visible = true;
  private _activeSessionId: string | undefined;
  private _filterText = '';
  private _collapsedGroups = new Set<DateGroup>();

  // ── Events ──

  private readonly _onDidSelectSession = this._register(new Emitter<string>());
  readonly onDidSelectSession: Event<string> = this._onDidSelectSession.event;

  private readonly _onDidRequestNewSession = this._register(new Emitter<void>());
  readonly onDidRequestNewSession: Event<void> = this._onDidRequestNewSession.event;

  private readonly _onDidToggle = this._register(new Emitter<boolean>());
  /** Fires `true` when shown, `false` when hidden. */
  readonly onDidToggle: Event<boolean> = this._onDidToggle.event;

  // ── Services ──

  private readonly _services: ISessionSidebarServices;

  // ── Constructor ──

  constructor(container: HTMLElement, services: ISessionSidebarServices) {
    super();
    this._services = services;

    // Root container (hidden by default)
    this._root = $('div.parallx-chat-session-sidebar');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // ── Header ──
    const header = $('div.parallx-chat-session-sidebar-header');
    this._root.appendChild(header);

    const headerTitle = $('span.parallx-chat-session-sidebar-title', 'SESSIONS');
    header.appendChild(headerTitle);

    const headerActions = $('div.parallx-chat-session-sidebar-actions');
    header.appendChild(headerActions);

    // Refresh button
    const refreshBtn = this._createButton(chatIcons.refresh, 'Refresh', 'parallx-chat-sidebar-btn');
    this._register(addDisposableListener(refreshBtn, 'click', () => this.refresh()));
    headerActions.appendChild(refreshBtn);

    // Search toggle button
    const searchBtn = this._createButton(chatIcons.search, 'Filter Sessions', 'parallx-chat-sidebar-btn');
    this._register(addDisposableListener(searchBtn, 'click', () => this._toggleFilter()));
    headerActions.appendChild(searchBtn);

    // New Session button
    const newBtn = this._createButton(chatIcons.newChat, 'New Session', 'parallx-chat-sidebar-btn parallx-chat-sidebar-btn--new');
    this._register(addDisposableListener(newBtn, 'click', () => this._onDidRequestNewSession.fire()));
    headerActions.appendChild(newBtn);

    // ── Filter input (hidden by default) ──
    this._filterContainer = $('div.parallx-chat-session-sidebar-filter');
    this._filterContainer.style.display = 'none';
    this._root.appendChild(this._filterContainer);

    this._filterInput = document.createElement('input');
    this._filterInput.type = 'text';
    this._filterInput.className = 'parallx-chat-session-sidebar-filter-input';
    this._filterInput.placeholder = 'Filter sessions\u2026';
    this._filterContainer.appendChild(this._filterInput);

    this._register(addDisposableListener(this._filterInput, 'input', () => {
      this._filterText = this._filterInput.value.toLowerCase();
      this._renderSessionList();
    }));

    // ── Session list (scrollable) ──
    this._sessionList = $('div.parallx-chat-session-sidebar-list');
    this._root.appendChild(this._sessionList);

    // ── Empty state ──
    this._emptyEl = $('div.parallx-chat-session-sidebar-empty', 'No sessions yet');
    this._emptyEl.style.display = 'none';
    this._root.appendChild(this._emptyEl);

    // Initial state: visible by default
    this._applyVisibility();
    this._renderSessionList();
  }

  // ── Public API ──

  /** The root DOM element of the sidebar (for external resize). */
  get rootElement(): HTMLElement { return this._root; }

  /** Toggle between visible and hidden. */
  toggle(): void {
    this._visible = !this._visible;
    this._applyVisibility();
    this._onDidToggle.fire(this._visible);
    if (this._visible) {
      this.refresh();
    }
  }

  /** Show the panel. */
  show(): void {
    if (!this._visible) {
      this._visible = true;
      this._applyVisibility();
      this._onDidToggle.fire(true);
      this.refresh();
    }
  }

  /** Hide the panel. */
  hide(): void {
    if (this._visible) {
      this._visible = false;
      this._applyVisibility();
      this._onDidToggle.fire(false);
    }
  }

  get isVisible(): boolean {
    return this._visible;
  }

  // Keep isExpanded as an alias for backward compat with tests
  get isExpanded(): boolean {
    return this._visible;
  }

  /** Set which session is the active one (highlighted). */
  setActiveSession(sessionId: string | undefined): void {
    this._activeSessionId = sessionId;
    if (this._visible) {
      this._renderSessionList();
    }
  }

  /** Re-render the session list from services. */
  refresh(): void {
    this._renderSessionList();
  }

  // ── Internal: Visibility ──

  private _applyVisibility(): void {
    this._root.classList.toggle('parallx-chat-session-sidebar--visible', this._visible);
  }

  // ── Internal: Filter toggle ──

  private _toggleFilter(): void {
    const isShown = this._filterContainer.style.display !== 'none';
    this._filterContainer.style.display = isShown ? 'none' : '';
    if (!isShown) {
      this._filterInput.focus();
    } else {
      // Clear filter when hiding
      this._filterInput.value = '';
      this._filterText = '';
      this._renderSessionList();
    }
  }

  // ── Internal: Render ──

  private _renderSessionList(): void {
    this._sessionList.innerHTML = '';

    const allSessions = this._services.getSessions();

    // Apply filter
    const sessions = this._filterText
      ? [...allSessions].filter((s) => {
        const title = (s.title || 'New Chat').toLowerCase();
        const preview = s.messages.length > 0
          ? s.messages[0].request.text.toLowerCase()
          : '';
        return title.includes(this._filterText) || preview.includes(this._filterText);
      })
      : [...allSessions];

    // Sort by createdAt descending
    sessions.sort((a, b) => b.createdAt - a.createdAt);

    if (sessions.length === 0) {
      this._emptyEl.textContent = this._filterText
        ? 'No matching sessions'
        : 'No sessions yet';
      this._emptyEl.style.display = '';
      return;
    }

    this._emptyEl.style.display = 'none';

    // Group by date
    const groups = new Map<DateGroup, IChatSession[]>();
    for (const session of sessions) {
      const group = _getDateGroup(session.createdAt);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(session);
    }

    // Render in group order
    for (const groupName of GROUP_ORDER) {
      const groupSessions = groups.get(groupName);
      if (!groupSessions || groupSessions.length === 0) {
        continue;
      }

      const isCollapsed = this._collapsedGroups.has(groupName);

      // Section header
      const sectionHeader = $('div.parallx-chat-session-sidebar-section-header');
      const chevron = $('span.parallx-chat-session-sidebar-chevron');
      chevron.innerHTML = isCollapsed ? chatIcons.chevronRight : chatIcons.sectionExpanded;
      const label = $('span.parallx-chat-session-sidebar-section-label', groupName);
      const count = $('span.parallx-chat-session-sidebar-section-count',
        `${groupSessions.length}`);

      sectionHeader.appendChild(chevron);
      sectionHeader.appendChild(label);
      sectionHeader.appendChild(count);

      sectionHeader.addEventListener('click', () => {
        if (this._collapsedGroups.has(groupName)) {
          this._collapsedGroups.delete(groupName);
        } else {
          this._collapsedGroups.add(groupName);
        }
        this._renderSessionList();
      });

      this._sessionList.appendChild(sectionHeader);

      // Session items (if not collapsed)
      if (!isCollapsed) {
        for (const session of groupSessions) {
          this._sessionList.appendChild(this._buildSessionItem(session));
        }
      }
    }
  }

  private _buildSessionItem(session: IChatSession): HTMLElement {
    const isActive = session.id === this._activeSessionId;

    const item = $('div.parallx-chat-session-sidebar-item');
    if (isActive) {
      item.classList.add('parallx-chat-session-sidebar-item--active');
    }

    // Info area (clickable)
    const info = $('div.parallx-chat-session-sidebar-item-info');

    // Top row: title + time
    const topRow = $('div.parallx-chat-session-sidebar-item-top');
    const title = $('span.parallx-chat-session-sidebar-item-title',
      session.title || 'New Chat');
    const time = $('span.parallx-chat-session-sidebar-item-time',
      _formatRelativeTime(session.createdAt));
    topRow.appendChild(title);
    topRow.appendChild(time);
    info.appendChild(topRow);

    // Meta row: message count + mode
    const meta = $('div.parallx-chat-session-sidebar-item-meta');
    const messageCount = session.messages.length;
    const modeLabel = session.mode
      ? session.mode.charAt(0).toUpperCase() + session.mode.slice(1)
      : '';
    meta.textContent = `${messageCount} msg${messageCount !== 1 ? 's' : ''}${modeLabel ? ` \u00B7 ${modeLabel}` : ''}`;
    info.appendChild(meta);

    // Preview (first message)
    if (messageCount > 0) {
      const preview = $('div.parallx-chat-session-sidebar-item-preview');
      const firstMsg = session.messages[0].request.text;
      preview.textContent = firstMsg.length > 80
        ? firstMsg.slice(0, 77) + '\u2026'
        : firstMsg;
      info.appendChild(preview);
    }

    info.addEventListener('click', () => {
      this._onDidSelectSession.fire(session.id);
    });

    item.appendChild(info);

    // Delete button (hover-only)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'parallx-chat-session-sidebar-item-delete';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Delete Session';
    deleteBtn.setAttribute('aria-label', 'Delete Session');
    deleteBtn.innerHTML = chatIcons.trash;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._services.deleteSession(session.id);
      this._renderSessionList();
    });
    item.appendChild(deleteBtn);

    return item;
  }

  // ── Helpers ──

  private _createButton(svgHtml: string, tooltip: string, className: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
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
