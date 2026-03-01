// chatWidget.ts — Core chat widget (M9 Task 3.3)
//
// Three-region layout: header + scrollable message list + bottom-pinned input area.
// Manages session binding, input submission, auto-scroll, empty/offline states,
// session history, and context/token indicator.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts

import './chatWidget.css';

import { Disposable, DisposableStore, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, append, addDisposableListener } from '../../ui/dom.js';
import type { FollowupClickEventDetail } from './chatContentParts.js';
import type { OllamaProvider } from './providers/ollamaProvider.js';
import { ChatInputPart } from './chatInputPart.js';
import { ChatListRenderer } from './chatListRenderer.js';
import { ChatModelPicker } from './chatModelPicker.js';
import type { IModelPickerServices } from './chatModelPicker.js';
import { ChatModePicker } from './chatModePicker.js';
import type { IModePickerServices } from './chatModePicker.js';
import { ChatHeaderPart } from './chatHeaderPart.js';
import { ChatSessionHistory } from './chatSessionHistory.js';
import type { ISessionHistoryServices } from './chatSessionHistory.js';
import { ChatContextIndicator } from './chatContextIndicator.js';
import type { IContextIndicatorServices } from './chatContextIndicator.js';
import type {
  IChatSession,
  IChatWidgetDescriptor,
} from '../../services/chatTypes.js';

// ── Types ──

/** Service accessor passed from the activation layer. */
export interface IChatWidgetServices {
  readonly sendRequest: (sessionId: string, message: string) => Promise<void>;
  readonly cancelRequest: (sessionId: string) => void;
  readonly createSession: () => IChatSession;
  readonly onDidChangeSession: Event<string>;
  readonly getProviderStatus: () => { available: boolean };
  readonly onDidChangeProviderStatus: Event<void>;
  /** Optional model picker services — when provided, the model picker is shown. */
  readonly modelPicker?: IModelPickerServices;
  /** Optional mode picker services — when provided, the mode picker is shown. */
  readonly modePicker?: IModePickerServices;
  /** Session history services — list, switch, delete sessions. */
  readonly sessionHistory?: ISessionHistoryServices;
  /** Context window indicator services. */
  readonly contextIndicator?: IContextIndicatorServices;
  /** Get a session by ID (for session switching from history). */
  readonly getSession?: (sessionId: string) => IChatSession | undefined;
  /** Get all sessions. */
  readonly getSessions?: () => readonly IChatSession[];
  /** Delete a session by ID. */
  readonly deleteSession?: (sessionId: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChatWidget
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The core chat widget — message list + input area.
 *
 * Registered with IChatWidgetService and bound to a single session at a time.
 * Layout: flex column with scrollable message region and bottom-pinned input.
 */
export class ChatWidget extends Disposable implements IChatWidgetDescriptor {

  // ── Identity ──

  readonly id: string;

  // ── Session binding ──

  private _session: IChatSession | undefined;

  get sessionId(): string {
    return this._session?.id ?? '';
  }

  // ── DOM Elements ──

  private readonly _root: HTMLElement;
  private readonly _headerContainer: HTMLElement;
  private readonly _messageListContainer: HTMLElement;
  private readonly _scrollBtn: HTMLElement;
  private readonly _contextContainer: HTMLElement;
  private readonly _inputAreaContainer: HTMLElement;
  private readonly _emptyStateEl: HTMLElement;
  private readonly _offlineStateEl: HTMLElement;

  // ── Sub-components ──

  private readonly _inputPart: ChatInputPart;
  private readonly _listRenderer: ChatListRenderer;
  private readonly _headerPart: ChatHeaderPart;
  private readonly _sessionHistory: ChatSessionHistory;
  private readonly _contextIndicator: ChatContextIndicator;

  // ── Services ──

  private readonly _services: IChatWidgetServices;

  // ── State ──

  private _isAtBottom = true;

  // ── Events ──

  private readonly _onDidAcceptInput = this._register(new Emitter<string>());
  readonly onDidAcceptInput: Event<string> = this._onDidAcceptInput.event;

  private readonly _sessionDisposables = this._register(new DisposableStore());

  // ── Constructor ──

  constructor(
    container: HTMLElement,
    provider: OllamaProvider,
    services: IChatWidgetServices,
  ) {
    super();

    this.id = _generateWidgetId();
    void provider; // retained for future Tiptap integration
    this._services = services;

    // ── Build DOM ──

    this._root = $('div.parallx-chat-widget');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // Header (top-pinned — new chat, history, clear)
    this._headerContainer = $('div.parallx-chat-header-container');
    this._root.appendChild(this._headerContainer);

    this._headerPart = this._register(new ChatHeaderPart(this._headerContainer));
    this._register(this._headerPart.onNewChat(() => this._handleNewChat()));
    this._register(this._headerPart.onToggleHistory(() => this._handleToggleHistory()));
    this._register(this._headerPart.onClearSession(() => this._handleClearSession()));

    // Session History overlay (attached to root for absolute positioning)
    const historyServices: ISessionHistoryServices = {
      getSessions: () => this._services.getSessions?.() ?? [],
      deleteSession: (id) => this._services.deleteSession?.(id),
    };
    this._sessionHistory = this._register(new ChatSessionHistory(this._root, historyServices));
    this._register(this._sessionHistory.onDidSelectSession((sessionId) => {
      const session = this._services.getSession?.(sessionId);
      if (session) {
        this.setSession(session);
      }
    }));

    // Message list (scrollable)
    this._messageListContainer = $('div.parallx-chat-message-list');
    this._root.appendChild(this._messageListContainer);

    // Scroll-to-bottom button (overlaid on message list)
    this._scrollBtn = $('div.parallx-chat-scroll-btn', '\u2193');
    this._root.appendChild(this._scrollBtn);

    // Context indicator (between message list and input)
    this._contextContainer = $('div.parallx-chat-context-container');
    this._root.appendChild(this._contextContainer);

    const contextServices: IContextIndicatorServices = services.contextIndicator ?? {
      getContextLength: () => 0,
    };
    this._contextIndicator = this._register(new ChatContextIndicator(
      this._contextContainer, contextServices,
    ));

    // Input area (bottom-pinned)
    this._inputAreaContainer = $('div.parallx-chat-input-area');
    this._root.appendChild(this._inputAreaContainer);

    // Empty state (hidden by default)
    this._emptyStateEl = this._buildEmptyState();
    this._messageListContainer.appendChild(this._emptyStateEl);

    // Offline state (hidden by default)
    this._offlineStateEl = this._buildOfflineState();
    this._messageListContainer.appendChild(this._offlineStateEl);

    // ── Sub-components ──

    this._listRenderer = this._register(new ChatListRenderer());

    this._inputPart = this._register(new ChatInputPart(this._inputAreaContainer));
    this._register(this._inputPart.onDidAcceptInput((text) => this._handleSubmit(text)));
    this._register(this._inputPart.onDidRequestStop(() => this._handleStop()));

    // ── Pickers (attached to input toolbar's picker slot) ──

    const pickerSlot = this._inputPart.getPickerSlot();

    if (services.modelPicker) {
      this._register(new ChatModelPicker(pickerSlot, services.modelPicker));
    }

    if (services.modePicker) {
      this._register(new ChatModePicker(pickerSlot, services.modePicker));
    }

    // ── Scroll tracking ──

    this._register(addDisposableListener(this._messageListContainer, 'scroll', () => {
      this._updateScrollState();
    }));

    this._register(addDisposableListener(this._scrollBtn, 'click', () => {
      this._scrollToBottom();
    }));

    // ── Follow-up chip click handler ──

    const followupHandler = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<FollowupClickEventDetail>).detail;
      if (detail?.message) {
        this._handleSubmit(detail.message);
      }
    };
    this._messageListContainer.addEventListener('parallx-followup-click', followupHandler);
    this._register(toDisposable(() => {
      this._messageListContainer.removeEventListener('parallx-followup-click', followupHandler);
    }));

    // ── Service listeners ──

    this._register(this._services.onDidChangeSession((sessionId) => {
      if (this._session && sessionId === this._session.id) {
        this._renderMessages();
      }
    }));

    this._register(this._services.onDidChangeProviderStatus(() => {
      this._updateVisibility();
    }));

    // ── Initial state ──

    this._updateVisibility();
  }

  // ── Public API ──

  /**
   * Bind the widget to a session. Loads conversation and starts listening
   * for updates.
   */
  setSession(session: IChatSession): void {
    this._sessionDisposables.clear();
    this._session = session;
    this._renderMessages();
    this._updateVisibility();
    this._updateHeader();
    this._updateContextIndicator();
    this._scrollToBottom();
    this._inputPart.setStreaming(session.requestInProgress);
    this._inputPart.focus();
  }

  /**
   * Read input text, send to the chat service, clear input.
   * Called by Enter key or submit button.
   */
  acceptInput(): void {
    const text = this._inputPart.getValue().trim();
    if (!text || !this._session) {
      return;
    }
    this._handleSubmit(text);
  }

  /**
   * Focus the input area.
   */
  focus(): void {
    this._inputPart.focus();
  }

  /**
   * Update the widget dimensions. Called by the host view on resize.
   */
  layout(_width: number, _height: number): void {
    // Dimensions received from host view for future Tiptap relayout.
    // Flex layout handles sizing automatically for now.
  }

  // ── Session helpers ──

  /** Get the current session (if any). */
  getSession(): IChatSession | undefined {
    return this._session;
  }

  // ── Input submission ──

  private async _handleSubmit(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    // Ensure we have a session
    if (!this._session) {
      this._session = this._services.createSession();
    }

    this._inputPart.clear();
    this._inputPart.setStreaming(true);
    this._onDidAcceptInput.fire(text);

    try {
      await this._services.sendRequest(this._session.id, text);
    } catch (err) {
      console.error('[ChatWidget] Send request failed:', err);
    } finally {
      this._inputPart.setStreaming(false);
    }
  }

  private _handleStop(): void {
    if (this._session) {
      this._services.cancelRequest(this._session.id);
    }
  }

  // ── Rendering ──

  private _renderMessages(): void {
    if (!this._session) {
      return;
    }

    // Delegate to the list renderer
    this._listRenderer.renderMessages(
      this._messageListContainer,
      this._session.messages,
      this._session.requestInProgress,
    );

    this._updateVisibility();
    this._updateHeader();
    this._updateContextIndicator();

    // Auto-scroll if user was at bottom
    if (this._isAtBottom) {
      this._scrollToBottom();
    }
  }

  // ── Visibility ──

  private _updateVisibility(): void {
    const hasSession = !!this._session;
    const hasMessages = hasSession && this._session!.messages.length > 0;
    const isOnline = this._services.getProviderStatus().available;

    // Offline state takes priority
    if (!isOnline && !hasMessages) {
      this._emptyStateEl.style.display = 'none';
      this._offlineStateEl.style.display = '';
      this._inputPart.setEnabled(false);
      return;
    }

    this._offlineStateEl.style.display = 'none';

    // Empty state when no messages
    if (!hasMessages) {
      this._emptyStateEl.style.display = '';
      this._inputPart.setEnabled(true);
    } else {
      this._emptyStateEl.style.display = 'none';
      this._inputPart.setEnabled(true);
    }
  }

  // ── Scroll ──

  private _updateScrollState(): void {
    const el = this._messageListContainer;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this._isAtBottom = distanceFromBottom < 30;

    this._scrollBtn.classList.toggle('parallx-chat-scroll-btn--visible', !this._isAtBottom);
  }

  private _scrollToBottom(): void {
    const el = this._messageListContainer;
    el.scrollTop = el.scrollHeight;
    this._isAtBottom = true;
    this._scrollBtn.classList.remove('parallx-chat-scroll-btn--visible');
  }

  // ── Header / Context Updates ──

  private _updateHeader(): void {
    if (!this._session) {
      this._headerPart.setTitle('Chat');
      this._headerPart.setSessionInfo('');
      return;
    }
    const msgCount = this._session.messages.length;
    this._headerPart.setTitle(this._session.title || 'New Chat');
    const modeLabel = this._session.mode
      ? this._session.mode.charAt(0).toUpperCase() + this._session.mode.slice(1)
      : '';
    this._headerPart.setSessionInfo(
      msgCount > 0
        ? `${msgCount} message${msgCount !== 1 ? 's' : ''}${modeLabel ? ` \u00B7 ${modeLabel}` : ''}`
        : modeLabel || '',
    );
  }

  private _updateContextIndicator(): void {
    if (!this._session || this._session.messages.length === 0) {
      this._contextIndicator.hide();
      return;
    }
    // Count all characters in the conversation
    let totalChars = 0;
    for (const pair of this._session.messages) {
      totalChars += pair.request.text.length;
      for (const part of pair.response.parts) {
        if ('value' in part && typeof part.value === 'string') {
          totalChars += part.value.length;
        }
        if ('code' in part && typeof part.code === 'string') {
          totalChars += part.code.length;
        }
      }
    }
    this._contextIndicator.update(totalChars);
  }

  // ── Header Action Handlers ──

  private _handleNewChat(): void {
    const session = this._services.createSession();
    this.setSession(session);
  }

  private _handleToggleHistory(): void {
    this._sessionHistory.toggle(this._session?.id);
  }

  private _handleClearSession(): void {
    if (this._session) {
      this._services.deleteSession?.(this._session.id);
    }
    const newSession = this._services.createSession();
    this.setSession(newSession);
  }

  // ── Empty / Offline State Builders ──

  private _buildEmptyState(): HTMLElement {
    const root = $('div.parallx-chat-empty-state');

    const icon = $('div.parallx-chat-empty-state-icon', '\u2728');
    const title = $('div.parallx-chat-empty-state-title', 'How can I help you?');
    const subtitle = $('div.parallx-chat-empty-state-subtitle',
      'Ask questions, get explanations, or let AI help with your workspace.');

    append(root, icon, title, subtitle);

    // Feature hints
    const hints = $('div.parallx-chat-empty-state-hints');

    const hintItems: { icon: string; label: string; description: string }[] = [
      { icon: '\uD83D\uDCAC', label: 'Ask mode', description: 'Q&A about anything' },
      { icon: '\u270F\uFE0F', label: 'Edit mode', description: 'AI-assisted canvas editing' },
      { icon: '\u{1F916}', label: 'Agent mode', description: 'Autonomous with tools' },
      { icon: '@', label: '@workspace', description: 'Search pages & files' },
      { icon: '\u{1F3A8}', label: '@canvas', description: 'Edit current page' },
      { icon: '\u2328\uFE0F', label: 'Ctrl+L', description: 'New chat session' },
    ];

    for (const hint of hintItems) {
      const item = $('div.parallx-chat-hint-item');
      const hintIcon = $('span.parallx-chat-hint-icon', hint.icon);
      const hintText = $('span.parallx-chat-hint-text');
      const hintLabel = $('span.parallx-chat-hint-label', hint.label);
      const hintDesc = $('span.parallx-chat-hint-desc', hint.description);
      append(hintText, hintLabel, hintDesc);
      append(item, hintIcon, hintText);

      // Clicking a hint item inserts the label into the input
      item.addEventListener('click', () => {
        if (hint.label.startsWith('@')) {
          this._inputPart.focus();
        }
      });

      hints.appendChild(item);
    }

    root.appendChild(hints);
    return root;
  }

  private _buildOfflineState(): HTMLElement {
    const root = $('div.parallx-chat-offline-state');

    const spinner = $('div.parallx-chat-offline-spinner');
    const title = $('div.parallx-chat-offline-title', 'Connecting to Ollama\u2026');

    const instruction = $('div.parallx-chat-offline-instruction');
    instruction.innerHTML = [
      'Looking for a local <strong>Ollama</strong> server.',
      'If Ollama is not installed, get it from',
      '<a href="https://ollama.com">ollama.com</a>.',
    ].join(' ');

    append(root, spinner, title, instruction);
    return root;
  }
}

// ── Utility ──

let _widgetCounter = 0;

function _generateWidgetId(): string {
  return `chat-widget-${++_widgetCounter}`;
}
