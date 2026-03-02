// chatWidget.ts — Core chat widget (M9 Task 3.3)
//
// Horizontal layout: [chat-main-area | session-sidebar].
// Chat main: header + scrollable message list + context indicator + input.
// Session sidebar: collapsible right panel with session list.
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
import { chatIcons } from './chatIcons.js';
import { ChatListRenderer } from './chatListRenderer.js';
import { ChatModelPicker } from './chatModelPicker.js';
import type { IModelPickerServices } from './chatModelPicker.js';
import { ChatModePicker } from './chatModePicker.js';
import type { IModePickerServices } from './chatModePicker.js';
import { ChatSessionSidebar } from './chatSessionSidebar.js';
import type { ISessionSidebarServices } from './chatSessionSidebar.js';

import type {
  IChatSession,
  IChatWidgetDescriptor,
  IChatAttachment,
} from '../../services/chatTypes.js';
import type { IAttachmentServices } from './chatContextAttachments.js';
import type { IToolPickerServices } from './chatToolPicker.js';

// ── Types ──

/** Service accessor passed from the activation layer. */
export interface IChatWidgetServices {
  readonly sendRequest: (sessionId: string, message: string, attachments?: readonly IChatAttachment[]) => Promise<void>;
  readonly cancelRequest: (sessionId: string) => void;
  readonly createSession: () => IChatSession;
  readonly onDidChangeSession: Event<string>;
  readonly getProviderStatus: () => { available: boolean };
  readonly onDidChangeProviderStatus: Event<void>;
  /** Optional model picker services — when provided, the model picker is shown. */
  readonly modelPicker?: IModelPickerServices;
  /** Optional mode picker services — when provided, the mode picker is shown. */
  readonly modePicker?: IModePickerServices;
  /** Optional attachment services — when provided, enables "Add Context" file picker. */
  readonly attachmentServices?: IAttachmentServices;
  /** Optional tool picker services — when provided, shows the Configure Tools button. */
  readonly toolPickerServices?: IToolPickerServices;

  /** Get a session by ID (for session switching from history). */
  readonly getSession?: (sessionId: string) => IChatSession | undefined;
  /** Get all sessions. */
  readonly getSessions?: () => readonly IChatSession[];
  /** Delete a session by ID. */
  readonly deleteSession?: (sessionId: string) => void;
  /** Open a file in the editor (for clicking attachment chips in messages). */
  readonly openFile?: (fullPath: string) => void;
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
  private readonly _mainArea: HTMLElement;
  private readonly _messageListContainer: HTMLElement;
  private readonly _scrollBtn: HTMLElement;
  private readonly _inputAreaContainer: HTMLElement;
  private readonly _emptyStateEl: HTMLElement;
  private readonly _offlineStateEl: HTMLElement;
  private readonly _sash: HTMLElement;

  // ── Sidebar resize state ──
  private _sidebarWidth = 260;
  private static readonly SIDEBAR_MIN_WIDTH = 140;
  private static readonly SIDEBAR_SNAP_THRESHOLD = 70;
  private static readonly SIDEBAR_MAX_WIDTH = 500;

  // ── Sub-components ──

  private readonly _inputPart: ChatInputPart;
  private readonly _listRenderer: ChatListRenderer;
  private readonly _sessionSidebar: ChatSessionSidebar;

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
    titleActionsContainer?: HTMLElement,
  ) {
    super();

    this.id = _generateWidgetId();
    void provider; // retained for future Tiptap integration
    this._services = services;

    // ── Build DOM ──
    // Layout: root (horizontal flex) → [main-area (flex:1) | session-sidebar]

    this._root = $('div.parallx-chat-widget');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // ── Main area (left: vertical flex with messages → context → input) ──

    this._mainArea = $('div.parallx-chat-main-area');
    this._root.appendChild(this._mainArea);

    // ── Title bar actions (injected into the view section header) ──
    // VS Code parity: action buttons live in the view title bar, not a custom header.
    if (titleActionsContainer) {
      this._buildTitleActions(titleActionsContainer);
    }

    // Message list (scrollable)
    this._messageListContainer = $('div.parallx-chat-message-list');
    this._mainArea.appendChild(this._messageListContainer);

    // Scroll-to-bottom button (overlaid on message list)
    this._scrollBtn = $('div.parallx-chat-scroll-btn');
    this._scrollBtn.innerHTML = chatIcons.chevronDown;
    this._mainArea.appendChild(this._scrollBtn);

    // Input area (bottom-pinned)
    this._inputAreaContainer = $('div.parallx-chat-input-area');
    this._mainArea.appendChild(this._inputAreaContainer);

    // ── Sash (resize handle between main area and sidebar) ──
    this._sash = $('div.parallx-chat-sidebar-sash');
    this._root.appendChild(this._sash);

    // ── Session sidebar (right: collapsible panel) ──

    const sidebarServices: ISessionSidebarServices = {
      getSessions: () => this._services.getSessions?.() ?? [],
      deleteSession: (id) => this._services.deleteSession?.(id),
    };
    this._sessionSidebar = this._register(new ChatSessionSidebar(this._root, sidebarServices));

    // Wire sash drag AFTER sidebar is created (it references _sessionSidebar)
    this._setupSashDrag();

    this._register(this._sessionSidebar.onDidSelectSession((sessionId) => {
      const session = this._services.getSession?.(sessionId);
      if (session) {
        this.setSession(session);
      }
    }));
    this._register(this._sessionSidebar.onDidRequestNewSession(() => {
      this._handleNewChat();
    }));

    // Empty state (hidden by default)
    this._emptyStateEl = this._buildEmptyState();
    this._messageListContainer.appendChild(this._emptyStateEl);

    // Offline state (hidden by default)
    this._offlineStateEl = this._buildOfflineState();
    this._messageListContainer.appendChild(this._offlineStateEl);

    // ── Sub-components ──

    this._listRenderer = this._register(new ChatListRenderer());
    if (services.openFile) {
      this._listRenderer.setOpenAttachmentHandler(services.openFile);
    }

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

    // ── Attachment services (enable "Add Context" file picker) ──

    if (services.attachmentServices) {
      this._inputPart.setAttachmentServices(services.attachmentServices);
    }

    // ── Tool picker services (enable "Configure Tools" wrench button) ──

    if (services.toolPickerServices) {
      this._inputPart.setToolPickerServices(services.toolPickerServices);
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
      // Always refresh sidebar so new sessions / title changes appear immediately
      this._sessionSidebar.refresh();
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
    this._sessionSidebar.setActiveSession(session.id);
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
      this._sessionSidebar.setActiveSession(this._session.id);
      this._sessionSidebar.refresh();
    }

    // Collect attachments before clearing
    const attachments = this._inputPart.getAttachments();

    this._inputPart.clear();
    this._inputPart.setStreaming(true);
    this._onDidAcceptInput.fire(text);

    try {
      await this._services.sendRequest(this._session.id, text, attachments.length > 0 ? attachments : undefined);
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

  // ── Header Action Handlers ──

  private _handleNewChat(): void {
    const session = this._services.createSession();
    this.setSession(session);
    this._sessionSidebar.refresh();
  }

  private _handleClearSession(): void {
    if (this._session) {
      this._services.deleteSession?.(this._session.id);
    }
    const newSession = this._services.createSession();
    this.setSession(newSession);
    this._sessionSidebar.refresh();
  }

  // ── Sash Drag Logic ──

  /**
   * Wire up mousedown/mousemove/mouseup on the sash for sidebar resizing.
   * Snap-to-close when dragged below threshold (like the main sidebar).
   */
  private _setupSashDrag(): void {
    let startX = 0;
    let startWidth = 0;
    let dragging = false;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const delta = startX - e.clientX; // moving left = positive delta = wider sidebar
      let newWidth = startWidth + delta;

      // Snap: if below threshold, hide the sidebar entirely
      if (newWidth < ChatWidget.SIDEBAR_SNAP_THRESHOLD) {
        if (this._sessionSidebar.isVisible) {
          this._sessionSidebar.hide();
          this._sash.classList.remove('parallx-chat-sidebar-sash--active');
        }
        dragging = false;
        return;
      }

      // Clamp
      newWidth = Math.max(ChatWidget.SIDEBAR_MIN_WIDTH, Math.min(newWidth, ChatWidget.SIDEBAR_MAX_WIDTH));
      this._sidebarWidth = newWidth;
      this._sessionSidebar.rootElement.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      this._sash.classList.remove('parallx-chat-sidebar-sash--active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    this._register(addDisposableListener(this._sash, 'mousedown', (e: MouseEvent) => {
      // Only start drag when sidebar is visible
      if (!this._sessionSidebar.isVisible) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startWidth = this._sessionSidebar.rootElement.getBoundingClientRect().width;
      this._sash.classList.add('parallx-chat-sidebar-sash--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }));

    // When sidebar is toggled on, restore last width
    this._register(this._sessionSidebar.onDidToggle((visible) => {
      if (visible) {
        this._sessionSidebar.rootElement.style.width = `${this._sidebarWidth}px`;
        this._sash.classList.add('parallx-chat-sidebar-sash--visible');
      } else {
        this._sash.classList.remove('parallx-chat-sidebar-sash--visible');
      }
    }));

    // Initial sash visibility reflects sidebar default state
    if (this._sessionSidebar.isVisible) {
      this._sash.classList.add('parallx-chat-sidebar-sash--visible');
    }
  }

  // ── Title Bar Actions ──

  /**
   * Inject action buttons into the view section header's actions slot.
   * VS Code parity: action buttons render in the view title bar, not a custom header.
   */
  private _buildTitleActions(container: HTMLElement): void {
    const createBtn = (svgHtml: string, tooltip: string, extraClass: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = `parallx-chat-title-action ${extraClass}`;
      btn.type = 'button';
      btn.title = tooltip;
      btn.setAttribute('aria-label', tooltip);
      btn.innerHTML = svgHtml;
      return btn;
    };

    const newBtn = createBtn(chatIcons.newChat, 'New Chat (Ctrl+L)', 'parallx-chat-title-action--new');
    newBtn.addEventListener('click', (e) => { e.stopPropagation(); this._handleNewChat(); });
    container.appendChild(newBtn);

    const historyBtn = createBtn(chatIcons.history, 'Chat History', 'parallx-chat-title-action--history');
    historyBtn.addEventListener('click', (e) => { e.stopPropagation(); this._sessionSidebar.toggle(); });
    container.appendChild(historyBtn);

    const clearBtn = createBtn(chatIcons.trash, 'Clear Session', 'parallx-chat-title-action--clear');
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); this._handleClearSession(); });
    container.appendChild(clearBtn);
  }

  // ── Empty / Offline State Builders ──

  private _buildEmptyState(): HTMLElement {
    const root = $('div.parallx-chat-empty-state');

    const icon = $('div.parallx-chat-empty-state-icon');
    icon.innerHTML = chatIcons.sparkle;
    const title = $('div.parallx-chat-empty-state-title', 'How can I help you?');
    const subtitle = $('div.parallx-chat-empty-state-subtitle',
      'Ask questions, get explanations, or let AI help with your workspace.');

    append(root, icon, title, subtitle);

    // Feature hints — each inserts its label into the input on click
    const hints = $('div.parallx-chat-empty-state-hints');

    const hintItems: { svg: string; label: string; description: string; insert: string }[] = [
      { svg: chatIcons.chatBubble, label: 'Ask mode', description: 'Q&A about anything', insert: '/ask ' },
      { svg: chatIcons.pencil, label: 'Edit mode', description: 'AI-assisted canvas editing', insert: '/edit ' },
      { svg: chatIcons.agent, label: 'Agent mode', description: 'Autonomous with tools', insert: '/agent ' },
      { svg: chatIcons.atSign, label: '@workspace', description: 'Search pages & files', insert: '@workspace ' },
      { svg: chatIcons.canvas, label: '@canvas', description: 'Edit current page', insert: '@canvas ' },
      { svg: chatIcons.keyboard, label: 'Ctrl+L', description: 'New chat session', insert: '' },
    ];

    for (const hint of hintItems) {
      const item = $('div.parallx-chat-hint-item');
      const hintIcon = $('span.parallx-chat-hint-icon');
      hintIcon.innerHTML = hint.svg;
      const hintText = $('span.parallx-chat-hint-text');
      const hintLabel = $('span.parallx-chat-hint-label', hint.label);
      const hintDesc = $('span.parallx-chat-hint-desc', hint.description);
      append(hintText, hintLabel, hintDesc);
      append(item, hintIcon, hintText);

      // Clicking a hint inserts its text into the input and focuses
      item.addEventListener('click', () => {
        if (hint.insert) {
          this._inputPart.setValue(hint.insert);
        }
        this._inputPart.focus();
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
