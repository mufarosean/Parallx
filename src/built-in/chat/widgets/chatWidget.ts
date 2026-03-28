// chatWidget.ts — Core chat widget (M9 Task 3.3)
//
// Horizontal layout: [chat-main-area | session-sidebar].
// Chat main: header + scrollable message list + context indicator + input.
// Session sidebar: collapsible right panel with session list.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts

import './chatWidget.css';

import { Disposable, DisposableStore, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, append, addDisposableListener } from '../../../ui/dom.js';
import type { OllamaProvider } from '../providers/ollamaProvider.js';
import { ChatInputPart } from '../input/chatInputPart.js';
import { chatIcons } from '../chatIcons.js';
import { ChatListRenderer } from '../rendering/chatListRenderer.js';
import { renderAgentTaskRail } from '../rendering/chatTaskCards.js';
import { ChatModelPicker } from '../pickers/chatModelPicker.js';
import { ChatModePicker } from '../pickers/chatModePicker.js';
import { ChatSessionSidebar } from './chatSessionSidebar.js';
import type {
  IChatSession,
  IChatWidgetDescriptor,
  IContextPill,
  IChatPendingRequest,
  IChatUserMessage,
  ILanguageModelInfo,
} from '../../../services/chatTypes.js';
import { ChatRequestQueueKind } from '../../../services/chatTypes.js';
import type {
  IChatWidgetServices,
  ICodeActionRequest,
  ISessionSidebarServices,
} from '../chatTypes.js';

// IChatWidgetServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatWidgetServices } from '../chatTypes.js';

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
  private readonly _taskRailContainer: HTMLElement;
  private readonly _pendingMessagesContainer: HTMLElement;
  private readonly _scrollBtn: HTMLElement;
  private readonly _inputAreaContainer: HTMLElement;
  private readonly _emptyStateEl: HTMLElement;
  private readonly _offlineStateEl: HTMLElement;
  private readonly _sash: HTMLElement;

  /** Map of pending request ID → DOM element for hover actions. */
  private readonly _pendingMessageEls = new Map<string, HTMLElement>();

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
  private readonly _expandedTaskIds = new Set<string>();
  private _visionSyncRequestId = 0;
  private _responsiveLayoutObserver: ResizeObserver | undefined;

  // ── Events ──

  private readonly _onDidAcceptInput = this._register(new Emitter<string>());
  readonly onDidAcceptInput: Event<string> = this._onDidAcceptInput.event;

  private readonly _onDidRequestOpenToolSettings = this._register(new Emitter<void>());
  /** Fired when the wrench icon is clicked — callers should open AI Hub → Tools (M20 E.2). */
  readonly onDidRequestOpenToolSettings: Event<void> = this._onDidRequestOpenToolSettings.event;

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

    this._taskRailContainer = $('div.parallx-chat-agent-task-rail-container');
    this._messageListContainer.appendChild(this._taskRailContainer);

    // Pending messages container (between message list and input)
    this._pendingMessagesContainer = $('div.parallx-chat-pending-messages');
    this._mainArea.appendChild(this._pendingMessagesContainer);

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
      searchSessions: this._services.searchSessions,
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

    this._setupResponsiveLayout();

    // ── Sub-components ──

    this._listRenderer = this._register(new ChatListRenderer());
    if (services.openFile) {
      this._listRenderer.setOpenAttachmentHandler(services.openFile);
    }
    this._listRenderer.setRegenerateHandler((request) => {
      void this._handleRegenerate(request);
    });
    // Task 4.9: Wire cancel handler from widget into list renderer
    this._listRenderer.setCancelHandler(() => this._handleStop());

    // Task 2.6: Wire code action event listener (Apply to File / Create File)
    this._register(addDisposableListener(this._messageListContainer, 'parallx-code-action' as keyof HTMLElementEventMap, ((e: CustomEvent<ICodeActionRequest>) => {
      this._handleCodeAction(e.detail);
    }) as EventListener));

    // Wire source citation click handlers (navigate-page + open-file)
    this._register(addDisposableListener(this._messageListContainer, 'parallx:navigate-page' as keyof HTMLElementEventMap, ((e: CustomEvent<{ pageId: string }>) => {
      if (this._services.openPage) {
        this._services.openPage(e.detail.pageId);
      }
    }) as EventListener));

    this._register(addDisposableListener(this._messageListContainer, 'parallx:open-file' as keyof HTMLElementEventMap, ((e: CustomEvent<{ path: string }>) => {
      if (this._services.openFile) {
        this._services.openFile(e.detail.path);
      }
    }) as EventListener));

    this._register(addDisposableListener(this._messageListContainer, 'parallx:open-memory' as keyof HTMLElementEventMap, ((e: CustomEvent<{ sessionId: string }>) => {
      if (this._services.openMemory) {
        this._services.openMemory(e.detail.sessionId);
      } else {
        console.warn('[ChatWidget] openMemory service not available — memoryService or editorService may be missing');
      }
    }) as EventListener));

    this._register(addDisposableListener(this._messageListContainer, 'parallx-agent-task-action' as keyof HTMLElementEventMap, ((e: CustomEvent<{ taskId: string; action: 'continue' | 'stop-after-step' | 'toggle-details' }>) => {
      void this._handleAgentTaskAction(e.detail);
    }) as EventListener));

    this._register(addDisposableListener(this._messageListContainer, 'parallx-agent-approval' as keyof HTMLElementEventMap, ((e: CustomEvent<{ taskId: string; requestId: string; resolution: import('../../../agent/agentTypes.js').AgentApprovalResolution }>) => {
      void this._handleAgentApproval(e.detail);
    }) as EventListener));

    this._inputPart = this._register(new ChatInputPart(this._inputAreaContainer, () => {
      const modelPicker = this._services.modelPicker;
      if (!modelPicker) { return; }
      modelPicker.getModels().then((models) => {
        const visionModel = models.find(m => m.capabilities?.includes('vision'));
        if (visionModel) {
          modelPicker.setActiveModel(visionModel.id);
        } else {
          console.warn('[ChatWidget] No vision-capable model available to switch to');
        }
      }).catch(() => {
        // Model query failed — no-op
      });
    }));
    this._register(this._inputPart.onDidAcceptInput((text) => this._handleSubmit(text)));
    this._register(this._inputPart.onDidRequestStop(() => this._handleStop()));
    this._register(this._inputPart.onDidRequestOpenToolSettings(() => this._onDidRequestOpenToolSettings.fire()));

    // ── Pickers (attached to input toolbar's picker slot) ──

    const pickerSlot = this._inputPart.getPickerSlot();

    if (services.modePicker) {
      this._register(new ChatModePicker(pickerSlot, services.modePicker));
    }

    if (services.modelPicker) {
      this._register(new ChatModelPicker(pickerSlot, services.modelPicker));
      this._register(services.modelPicker.onDidChangeModels(() => {
        void this._syncVisionSupport();
      }));
    }

    // ── Attachment services (enable "Add Context" file picker) ──

    if (services.attachmentServices) {
      this._inputPart.setAttachmentServices(services.attachmentServices);
    }

    // ── Mode-aware UI updates ──
    // Hide tools button in Ask mode (read-only tools are always on).

    if (services.modePicker) {
      // Set initial visibility
      this._inputPart.updateToolsButtonForMode(services.modePicker.getMode());
      // React to mode changes
      this._register(services.modePicker.onDidChangeMode((mode) => {
        this._inputPart.updateToolsButtonForMode(mode);
      }));
    }

    // ── Scroll tracking ──

    this._register(addDisposableListener(this._messageListContainer, 'scroll', () => {
      this._updateScrollState();
    }));

    this._register(addDisposableListener(this._scrollBtn, 'click', () => {
      this._scrollToBottom();
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

    if (this._services.onDidChangeAgentTasks) {
      this._register(this._services.onDidChangeAgentTasks(() => {
        this._renderAgentTasks();
      }));
    }

    if (this._services.onDidChangeAgentApprovals) {
      this._register(this._services.onDidChangeAgentApprovals(() => {
        this._renderAgentTasks();
      }));
    }

    // ── Initial state ──

    this._updateVisibility();
    this._renderAgentTasks();
    void this._syncVisionSupport();
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
    void _width;
    void _height;
  }

  // ── Session helpers ──

  /** Get the current session (if any). */
  getSession(): IChatSession | undefined {
    return this._session;
  }

  /** Update context pills UI with sources the LLM sees (M11 Task 1.10). */
  setContextPills(pills: readonly IContextPill[]): void {
    this._inputPart.setContextPills(pills);
  }

  /** Update token budget breakdown (Task 4.8). */
  setBudget(slots: readonly import('../input/chatContextPills.js').ITokenBudgetSlot[]): void {
    this._inputPart.setBudget(slots);
  }

  /** Get IDs of context sources the user has excluded via pills UI (Task 1.10). */
  getExcludedContextIds(): ReadonlySet<string> {
    return this._inputPart.getExcludedContextIds();
  }

  /** Bind @mention suggestion provider for workspace file autocomplete (Task 3.1). */
  setMentionSuggestionProvider(provider: import('../input/chatMentionAutocomplete.js').IMentionSuggestionProvider): void {
    this._inputPart.setMentionSuggestionProvider(provider);
  }

  /** Bind slash command provider for /command autocomplete (Task 3.5). */
  setSlashCommandProvider(provider: import('../input/chatMentionAutocomplete.js').ISlashCommandProvider): void {
    this._inputPart.setSlashCommandProvider(provider);
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

    const sessionId = this._session.id;

    // Collect attachments before clearing (must be before early-return branch)
    const attachments = this._inputPart.getAttachments();

    // If a request is already in progress, queue the message
    if (this._session.requestInProgress) {
      if (this._services.queueRequest) {
        this._inputPart.clear();
        const pending = this._services.queueRequest(
          sessionId,
          text,
          ChatRequestQueueKind.Queued,
          attachments.length > 0 ? { attachments } : undefined,
        );
        this._renderPendingMessage(pending);
        this._onDidAcceptInput.fire(text);
      }
      return;
    }

    this._inputPart.clear();
    this._inputPart.setStreaming(true);
    this._onDidAcceptInput.fire(text);

    try {
      await this._services.sendRequest(sessionId, text, attachments.length > 0 ? { attachments } : undefined);
    } catch (err) {
      console.error('[ChatWidget] Send request failed:', err);
    } finally {
      this._inputPart.setStreaming(false);
      // Clear pending message UI for any that were processed
      this._clearProcessedPendingMessages();
    }
  }

  private _handleStop(): void {
    if (this._session) {
      this._services.cancelRequest(this._session.id);
    }
  }

  private async _handleRegenerate(request: IChatUserMessage): Promise<void> {
    if (!this._session || this._session.requestInProgress) {
      return;
    }

    this._inputPart.setStreaming(true);
    try {
      await this._services.sendRequest(this._session.id, request.text, {
        attachments: request.attachments,
        command: request.command,
        participantId: request.participantId,
        attempt: request.attempt + 1,
        replayOfRequestId: request.requestId,
      });
    } catch (err) {
      console.error('[ChatWidget] Regenerate failed:', err);
    } finally {
      this._inputPart.setStreaming(false);
    }
  }

  private async _syncVisionSupport(): Promise<void> {
    const syncRequestId = ++this._visionSyncRequestId;
    const modelPicker = this._services.modelPicker;
    if (!modelPicker) {
      this._inputPart.setVisionSupported(false);
      return;
    }

    const activeModelId = modelPicker.getActiveModel();
    if (!activeModelId) {
      this._inputPart.setVisionSupported(false);
      return;
    }

    if (modelPicker.getModelInfo) {
      const activeModel = await modelPicker.getModelInfo(activeModelId).catch((): ILanguageModelInfo | undefined => undefined);
      if (syncRequestId !== this._visionSyncRequestId || modelPicker.getActiveModel() !== activeModelId) {
        return;
      }
      this._inputPart.setVisionSupported(!!activeModel?.capabilities?.includes('vision'));
      return;
    }

    const models = await modelPicker.getModels().catch((): readonly ILanguageModelInfo[] => []);
    if (syncRequestId !== this._visionSyncRequestId || modelPicker.getActiveModel() !== activeModelId) {
      return;
    }
    const activeModel = models.find((model) => model.id === activeModelId);
    this._inputPart.setVisionSupported(!!activeModel?.capabilities?.includes('vision'));
  }

  // ── Pending Message Queue UI ──

  /**
   * Render a queued message as a greyed-out bubble below the message list.
   * On hover, shows an arrow (steer/interrupt) and X (remove) button.
   */
  private _renderPendingMessage(pending: IChatPendingRequest): void {
    const el = $('div.parallx-chat-pending-message');
    el.dataset.pendingId = pending.id;

    // Message text (truncated)
    const textEl = $('span.parallx-chat-pending-message-text');
    textEl.textContent = pending.text.length > 80
      ? pending.text.slice(0, 77) + '…'
      : pending.text;
    el.appendChild(textEl);

    // Hover actions container
    const actions = $('div.parallx-chat-pending-message-actions');

    // Arrow (steer/send now) button
    const steerBtn = $('button.parallx-chat-pending-action-steer');
    steerBtn.innerHTML = chatIcons.send;
    steerBtn.title = 'Send now (interrupts current response)';
    steerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._session && this._services.removePendingRequest) {
        // Remove from queue and re-submit as a steering request
        this._services.removePendingRequest(this._session.id, pending.id);
        // Re-queue as steering (will signal yield + go to front)
        if (this._services.queueRequest) {
          this._services.queueRequest(this._session.id, pending.text, ChatRequestQueueKind.Steering, pending.options);
        }
        this._removePendingMessageEl(pending.id);
      }
    });
    actions.appendChild(steerBtn);

    // X (remove) button
    const removeBtn = $('button.parallx-chat-pending-action-remove');
    removeBtn.innerHTML = '\u00D7'; // ×
    removeBtn.title = 'Remove queued message';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._session && this._services.removePendingRequest) {
        this._services.removePendingRequest(this._session.id, pending.id);
      }
      this._removePendingMessageEl(pending.id);
    });
    actions.appendChild(removeBtn);

    el.appendChild(actions);

    this._pendingMessageEls.set(pending.id, el);
    this._pendingMessagesContainer.appendChild(el);
  }

  private _removePendingMessageEl(pendingId: string): void {
    const el = this._pendingMessageEls.get(pendingId);
    if (el) {
      el.remove();
      this._pendingMessageEls.delete(pendingId);
    }
  }

  /**
   * After a request completes, remove any pending messages that have
   * already been processed (dequeued by the service).
   */
  private _clearProcessedPendingMessages(): void {
    if (!this._session) return;
    const sessionPendingIds = new Set(this._session.pendingRequests.map((p) => p.id));
    for (const [id] of this._pendingMessageEls) {
      if (!sessionPendingIds.has(id)) {
        this._removePendingMessageEl(id);
      }
    }
  }

  // ── Code Action Handler (Task 2.6) ──

  /**
   * Handle code action requests from code blocks (Apply to File / Create File).
   * For 'apply': reads existing file, computes diff, shows inline diff viewer.
   * For 'create': writes the file directly.
   */
  private async _handleCodeAction(request: ICodeActionRequest): Promise<void> {
    const { replaceCodeActionsWithResult } = await import('../rendering/chatCodeActions.js');

    // Find the action bar element that fired this event (for result feedback)
    const actionBars = this._messageListContainer.querySelectorAll('.parallx-chat-code-actions');
    let actionBar: HTMLElement | null = null;
    for (const bar of actionBars) {
      const pathLabel = bar.querySelector('.parallx-chat-code-actions-path');
      if (pathLabel?.textContent === request.filePath) {
        actionBar = bar as HTMLElement;
        break;
      }
    }

    try {
      if (request.action === 'create') {
        // Direct file write
        if (!this._services.writeFileRelative) {
          if (actionBar) { replaceCodeActionsWithResult(actionBar, 'No file write access', false); }
          return;
        }
        await this._services.writeFileRelative(request.filePath, request.code);
        if (actionBar) { replaceCodeActionsWithResult(actionBar, `Created ${request.filePath}`, true); }
      } else if (request.action === 'apply') {
        // Diff flow: read existing → compute diff → show diff viewer → on accept, write
        if (!this._services.readFileRelative || !this._services.writeFileRelative) {
          if (actionBar) { replaceCodeActionsWithResult(actionBar, 'No file access', false); }
          return;
        }

        const existing = await this._services.readFileRelative(request.filePath);
        if (existing === null) {
          // File doesn't exist — treat as create
          await this._services.writeFileRelative(request.filePath, request.code);
          if (actionBar) { replaceCodeActionsWithResult(actionBar, `Created ${request.filePath}`, true); }
          return;
        }

        // Compute diff and show viewer
        const { computeDiff } = await import('../../../services/diffService.js');
        const { renderDiffViewer } = await import('../rendering/chatDiffViewer.js');

        const diff = computeDiff(existing, request.code, request.filePath);

        if (diff.isIdentical) {
          if (actionBar) { replaceCodeActionsWithResult(actionBar, 'No changes detected', true); }
          return;
        }

        const diffEl = renderDiffViewer(diff, {
          showActions: true,
          wordLevelHighlight: true,
          onReview: async (decision) => {
            if (decision === 'accept') {
              try {
                await this._services.writeFileRelative!(request.filePath, request.code);
                if (actionBar) { replaceCodeActionsWithResult(actionBar, `Applied to ${request.filePath}`, true); }
              } catch (err) {
                if (actionBar) { replaceCodeActionsWithResult(actionBar, `Write failed: ${err}`, false); }
              }
            } else {
              if (actionBar) { replaceCodeActionsWithResult(actionBar, 'Rejected', false); }
            }
            // Remove diff viewer after decision
            diffEl.remove();
          },
        });

        // Insert diff viewer after the action bar
        if (actionBar?.parentElement) {
          actionBar.parentElement.insertBefore(diffEl, actionBar.nextSibling);
        }
      }
    } catch (err) {
      console.error('[ChatWidget] Code action failed:', err);
      if (actionBar) { replaceCodeActionsWithResult(actionBar, `Error: ${err}`, false); }
    }
  }

  private async _handleAgentTaskAction(detail: { taskId: string; action: 'continue' | 'stop-after-step' | 'toggle-details' }): Promise<void> {
    if (detail.action === 'toggle-details') {
      if (this._expandedTaskIds.has(detail.taskId)) {
        this._expandedTaskIds.delete(detail.taskId);
      } else {
        this._expandedTaskIds.add(detail.taskId);
      }
      this._renderAgentTasks();
      return;
    }

    if (detail.action === 'continue') {
      await this._services.continueAgentTask?.(detail.taskId);
      return;
    }

    await this._services.stopAgentTaskAfterStep?.(detail.taskId);
  }

  private async _handleAgentApproval(detail: { taskId: string; requestId: string; resolution: import('../../../agent/agentTypes.js').AgentApprovalResolution }): Promise<void> {
    await this._services.resolveAgentApproval?.(detail.taskId, detail.requestId, detail.resolution);
  }

  // ── Rendering ──

  private _renderMessages(): void {
    if (!this._session) {
      this._renderAgentTasks();
      this._updateVisibility();
      return;
    }

    // Delegate to the list renderer
    this._listRenderer.renderMessages(
      this._messageListContainer,
      this._session.messages,
      this._session.requestInProgress,
    );

    this._renderAgentTasks();

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
    const hasAgentTasks = (this._services.getAgentTasks?.().length ?? 0) > 0;
    const isOnline = this._services.getProviderStatus().available;

    // Offline state takes priority
    if (!isOnline && !hasMessages && !hasAgentTasks) {
      this._emptyStateEl.style.display = 'none';
      this._offlineStateEl.style.display = '';
      this._inputPart.setEnabled(false);
      return;
    }

    this._offlineStateEl.style.display = 'none';

    // Empty state when no messages
    if (!hasMessages && !hasAgentTasks) {
      this._emptyStateEl.style.display = '';
      this._inputPart.setEnabled(true);
    } else {
      this._emptyStateEl.style.display = 'none';
      this._inputPart.setEnabled(true);
    }
  }

  private _renderAgentTasks(): void {
    const tasks = this._services.getAgentTasks?.() ?? [];
    this._taskRailContainer.replaceChildren();
    this._taskRailContainer.style.display = tasks.length > 0 ? '' : 'none';
    if (tasks.length > 0) {
      this._taskRailContainer.appendChild(renderAgentTaskRail(tasks, this._expandedTaskIds));
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
    let sashRafId = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;

      // Throttle DOM writes to one-per-frame to avoid layout thrashing
      cancelAnimationFrame(sashRafId);
      const clientX = e.clientX;
      sashRafId = requestAnimationFrame(() => {
        if (!dragging) return;
        const delta = startX - clientX; // moving left = positive delta = wider sidebar
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
        this._sessionSidebar.rootElement.style.flexBasis = `${newWidth}px`;
      });
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      cancelAnimationFrame(sashRafId);
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
        this._sessionSidebar.rootElement.style.flexBasis = `${this._sidebarWidth}px`;
        this._sash.classList.add('parallx-chat-sidebar-sash--visible');
      } else {
        this._sash.classList.remove('parallx-chat-sidebar-sash--visible');
      }
    }));

    // Initial sash visibility reflects sidebar default state
    if (this._sessionSidebar.isVisible) {
      this._sash.classList.add('parallx-chat-sidebar-sash--visible');
      this._sessionSidebar.rootElement.style.width = `${this._sidebarWidth}px`;
      this._sessionSidebar.rootElement.style.flexBasis = `${this._sidebarWidth}px`;
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

    // System prompt viewer button (Task 4.10)
    if (this._services.getSystemPrompt) {
      const promptBtn = createBtn(chatIcons.wrench, 'View System Prompt', 'parallx-chat-title-action--prompt');
      promptBtn.addEventListener('click', (e) => { e.stopPropagation(); this._showSystemPromptViewer(); });
      container.appendChild(promptBtn);
    }

    // AI Settings gear button (C2)
    if (this._services.openAISettings) {
      const gearBtn = createBtn(chatIcons.gear, 'AI Settings (Ctrl+Shift+A)', 'parallx-chat-title-action--settings');
      gearBtn.addEventListener('click', (e) => { e.stopPropagation(); this._services.openAISettings!(); });
      container.appendChild(gearBtn);
    }
  }

  // ── System Prompt Viewer (Task 4.10) ──

  /** Show a read-only modal with the fully assembled system prompt. */
  private async _showSystemPromptViewer(): Promise<void> {
    if (!this._services.getSystemPrompt) { return; }

    const promptText = await this._services.getSystemPrompt();

    // Create modal overlay
    const overlay = $('div.parallx-system-prompt-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); }
    });

    const modal = $('div.parallx-system-prompt-modal');

    // Header
    const header = $('div.parallx-system-prompt-header');
    const title = $('span.parallx-system-prompt-title', 'System Prompt');
    header.appendChild(title);

    const tokenEst = $('span.parallx-system-prompt-tokens',
      `~${Math.ceil(promptText.length / 4).toLocaleString()} tokens`,
    );
    header.appendChild(tokenEst);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'parallx-system-prompt-close';
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = chatIcons.close;
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);

    modal.appendChild(header);

    // Content
    const content = $('div.parallx-system-prompt-content');
    const pre = document.createElement('pre');
    pre.className = 'parallx-system-prompt-text';
    pre.textContent = promptText;
    content.appendChild(pre);
    modal.appendChild(content);

    // Footer: copy button
    const footer = $('div.parallx-system-prompt-footer');
    const copyBtn = document.createElement('button');
    copyBtn.className = 'parallx-system-prompt-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy to clipboard';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(promptText).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 1500);
      });
    });
    footer.appendChild(copyBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on Escape
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // ── Empty / Offline State Builders ──

  private _buildEmptyState(): HTMLElement {
    const root = $('div.parallx-chat-empty-state');

    const icon = $('div.parallx-chat-empty-state-icon');
    icon.innerHTML = chatIcons.sparkle;
    const title = $('div.parallx-chat-empty-state-title', 'How can I help you?');
    const subtitle = $('div.parallx-chat-empty-state-subtitle',
      'Ask questions, get explanations, or let AI help with your workspace.');
    const posture = $('div.parallx-chat-empty-state-note',
      'AI is always awake. Agent unlocks action tools and approval-gated changes.');

    append(root, icon, title, subtitle, posture);

    // Feature hints — each inserts its label into the input on click
    const hints = $('div.parallx-chat-empty-state-hints');

    const hintItems: { svg: string; label: string; description: string; insert: string }[] = [
      { svg: chatIcons.pencil, label: 'Edit mode', description: 'AI proposes edits for you to review', insert: '/edit ' },
      { svg: chatIcons.agent, label: 'Agent mode', description: 'AI takes multi-step actions with your OK', insert: '/agent ' },
      { svg: chatIcons.atSign, label: '@workspace', description: 'Search across all your files and pages', insert: '@workspace ' },
      { svg: chatIcons.canvas, label: '@canvas', description: 'Edit the current page with AI', insert: '@canvas ' },
      { svg: chatIcons.keyboard, label: 'Ctrl+L', description: 'Start a new chat session', insert: '' },
      { svg: chatIcons.wand, label: '/init', description: 'Generate project context for better answers', insert: '/init ' },
      { svg: chatIcons.lightbulb, label: '/explain', description: 'Get a clear explanation of any concept', insert: '/explain ' },
      { svg: chatIcons.search, label: 'Search workspace', description: 'Find information across all your files', insert: '@workspace ' },
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

  private _setupResponsiveLayout(): void {
    const updateLayout = () => {
      const width = this._mainArea.getBoundingClientRect().width;
      this._root.classList.toggle('parallx-chat-widget--compact', width <= 430);
      this._root.classList.toggle('parallx-chat-widget--narrow', width <= 340);
    };

    updateLayout();

    if (typeof ResizeObserver !== 'undefined') {
      this._responsiveLayoutObserver = new ResizeObserver(() => {
        updateLayout();
      });
      this._responsiveLayoutObserver.observe(this._mainArea);
      this._register(toDisposable(() => {
        this._responsiveLayoutObserver?.disconnect();
        this._responsiveLayoutObserver = undefined;
      }));
      return;
    }

    const onResize = () => updateLayout();
    window.addEventListener('resize', onResize);
    this._register(toDisposable(() => window.removeEventListener('resize', onResize)));
  }
}

// ── Utility ──

let _widgetCounter = 0;

function _generateWidgetId(): string {
  return `chat-widget-${++_widgetCounter}`;
}
