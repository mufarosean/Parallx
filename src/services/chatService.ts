// chatService.ts — IChatService implementation (M9 Task 2.1 + Cap 9 persistence)
//
// Session lifecycle and request orchestration.
// Creates sessions, orchestrates the sendRequest pipeline:
//   parse → dispatch to agent → stream response → update session.
// Sessions are persisted to SQLite via chatSessionPersistence.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatService/chatService.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import { URI } from '../platform/uri.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import { ChatContentPartKind } from './chatTypes.js';
import { parseChatRequest } from '../built-in/chat/input/chatRequestParser.js';
import {
  ensureChatTables,
  saveSession,
  loadSessions,
  deletePersistedSession,
} from './chatSessionPersistence.js';
import type { IChatPersistenceDatabase } from './chatSessionPersistence.js';
import type { ISessionManager } from './serviceTypes.js';
import { captureSession } from '../workspace/staleGuard.js';
import type { SessionGuard } from '../workspace/staleGuard.js';
import type {
  IChatService,
  IChatSession,
  IChatUserMessage,
  IChatAssistantResponse,
  IChatRequestResponsePair,
  IChatSendRequestOptions,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatParticipantResult,
  IChatResponseStream,
  IChatContentPart,
  IChatMarkdownContent,
  IChatThinkingContent,
  IChatProvenanceEntry,
  IChatReferenceContent,
  IChatToolInvocationContent,
  IChatEditProposalContent,
  EditProposalOperation,
  ICancellationToken,
  IChatPendingRequest,
  ChatMode,
  IChatAgentService,
  IChatModeService,
  ILanguageModelsService,
} from './chatTypes.js';
import { ChatRequestQueueKind } from './chatTypes.js';

// ── Session URI scheme ──

const CHAT_SESSION_SCHEME = 'parallx-chat-session';

// ── UUID generator ──

function generateUUID(): string {
  // Use crypto.randomUUID when available, fallback to manual
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback (should not be needed in modern Electron)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Simple CancellationToken backed by an AbortController.
 */
export class CancellationTokenSource implements IDisposable {
  private readonly _controller = new AbortController();
  private readonly _onCancellationRequested = new Emitter<void>();
  private _yieldRequested = false;
  readonly token: ICancellationToken;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.token = {
      get isCancellationRequested() {
        return self._controller.signal.aborted;
      },
      get isYieldRequested() {
        return self._yieldRequested;
      },
      onCancellationRequested: self._onCancellationRequested.event,
    };
  }

  /** Get the underlying AbortSignal for fetch() calls. */
  get signal(): AbortSignal {
    return this._controller.signal;
  }

  /** Request the participant to yield at next natural break point. */
  requestYield(): void {
    this._yieldRequested = true;
  }

  cancel(): void {
    this._controller.abort();
    this._onCancellationRequested.fire();
  }

  dispose(): void {
    this._onCancellationRequested.dispose();
  }
}

/**
 * Concrete IChatResponseStream implementation.
 *
 * Each method mutates the response's parts array in-place.
 * UI update notifications are coalesced via queueMicrotask: multiple writes
 * within the same microtask (e.g. consecutive streaming chunks) produce a
 * single change event, minimising DOM thrashing.
 *
 * VS Code reference: extHostTypes.ts — ChatResponseStream + sendQueue batching
 */
class ChatResponseStream implements IChatResponseStream {
  private _done = false;
  private _updateScheduled = false;

  constructor(
    private readonly _response: IChatAssistantResponse,
    private readonly _onUpdate: () => void,
  ) {
    this.throwIfDone = this.throwIfDone.bind(this);
    this.close = this.close.bind(this);
    this.reportTokenUsage = this.reportTokenUsage.bind(this);
    this.setCitations = this.setCitations.bind(this);
    this.getMarkdownText = this.getMarkdownText.bind(this);
    this.replaceLastMarkdown = this.replaceLastMarkdown.bind(this);
    this.markdown = this.markdown.bind(this);
    this.codeBlock = this.codeBlock.bind(this);
    this.progress = this.progress.bind(this);
    this.provenance = this.provenance.bind(this);
    this.reference = this.reference.bind(this);
    this.thinking = this.thinking.bind(this);
    this.warning = this.warning.bind(this);
    this.button = this.button.bind(this);
    this.confirmation = this.confirmation.bind(this);
    this.beginToolInvocation = this.beginToolInvocation.bind(this);
    this.updateToolInvocation = this.updateToolInvocation.bind(this);
    this.editProposal = this.editProposal.bind(this);
    this.editBatch = this.editBatch.bind(this);
    this.push = this.push.bind(this);
  }

  /**
   * Schedule a batched update notification via queueMicrotask.
   * Multiple writes within the same microtask coalesce into one event.
   */
  private _scheduleUpdate(): void {
    if (!this._updateScheduled) {
      this._updateScheduled = true;
      queueMicrotask(() => {
        this._updateScheduled = false;
        this._onUpdate();
      });
    }
  }

  throwIfDone(): void {
    if (this._done) {
      throw new Error('Stream is closed');
    }
  }

  /** Mark the stream as closed — no more writes allowed. */
  close(): void {
    this._done = true;
    // Strip transient parts that may linger.
    // Progress and references are already folded into the thinking part
    // during streaming, but strip any stragglers + tool invocations.
    const parts = this._response.parts as IChatContentPart[];

    // Collect any straggler references not yet folded into thinking
    const stragglerRefs: IChatProvenanceEntry[] = [];
    for (const p of parts) {
      if (p.kind === ChatContentPartKind.Reference) {
        const reference = p as IChatReferenceContent;
        stragglerRefs.push({
          id: reference.uri,
          label: reference.label,
          kind: 'rag',
          uri: reference.uri,
          tokens: 0,
          removable: true,
        });
      }
    }

    // Strip transient standalone parts
    for (let i = parts.length - 1; i >= 0; i--) {
      const kind = parts[i].kind;
      if (
        kind === ChatContentPartKind.Progress ||
        kind === ChatContentPartKind.ToolInvocation ||
        kind === ChatContentPartKind.Reference
      ) {
        parts.splice(i, 1);
      }
    }

    // Fold any straggler references into thinking
    if (stragglerRefs.length > 0) {
      const thinkingPart = parts.find(
        (p) => p.kind === ChatContentPartKind.Thinking,
      ) as IChatThinkingContent | undefined;

      if (thinkingPart) {
        if (!thinkingPart.provenance) {
          thinkingPart.provenance = [];
        }
        for (const ref of stragglerRefs) {
          // Avoid duplicates
          if (!thinkingPart.provenance.some((entry) => (entry.uri ?? entry.id) === (ref.uri ?? ref.id))) {
            thinkingPart.provenance.push(ref);
          }
        }
      }
    }

    // Clear the ephemeral progress message now that we're done
    const thinkingPart = parts.find(
      (p) => p.kind === ChatContentPartKind.Thinking,
    ) as IChatThinkingContent | undefined;
    if (thinkingPart) {
      thinkingPart.progressMessage = undefined;
    }

    // Ensure thinking is first in the parts list (before markdown)
    const thinkingIdx = parts.findIndex(p => p.kind === ChatContentPartKind.Thinking);
    if (thinkingIdx > 0) {
      const [t] = parts.splice(thinkingIdx, 1);
      parts.unshift(t);
    }

    this._scheduleUpdate();
  }

  reportTokenUsage(promptTokens: number, completionTokens: number): void {
    (this._response as any).promptTokens = promptTokens;
    (this._response as any).completionTokens = completionTokens;
  }

  setCitations(citations: Array<{ index: number; uri: string; label: string }>): void {
    // Attach the citation map to every Markdown part so the renderer
    // can resolve [N] markers to clickable source badges.
    const parts = this._response.parts as IChatContentPart[];
    for (const part of parts) {
      if (part.kind === ChatContentPartKind.Markdown) {
        (part as IChatMarkdownContent).citations = citations;
      }
    }
    this._scheduleUpdate();
  }

  /** Return the concatenated text of all Markdown parts in the response. */
  getMarkdownText(): string {
    const parts = this._response.parts as IChatContentPart[];
    return parts
      .filter(p => p.kind === ChatContentPartKind.Markdown)
      .map(p => (p as IChatMarkdownContent).content)
      .join('');
  }

  replaceLastMarkdown(content: string): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];
    // Walk backwards to find the last Markdown part
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].kind === ChatContentPartKind.Markdown) {
        (parts[i] as IChatMarkdownContent).content = content;
        this._scheduleUpdate();
        return;
      }
    }
    // No markdown part found — push one if there's content
    if (content) {
      parts.push({ kind: ChatContentPartKind.Markdown, content });
      this._scheduleUpdate();
    }
  }

  markdown(content: string): void {
    this.throwIfDone();

    // Merge adjacent markdown parts
    const parts = this._response.parts as IChatContentPart[];
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;

    if (last && last.kind === ChatContentPartKind.Markdown) {
      (last as IChatMarkdownContent).content += content;
    } else {
      parts.push({ kind: ChatContentPartKind.Markdown, content });
    }

    this._scheduleUpdate();
  }

  codeBlock(code: string, language?: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.CodeBlock,
      code,
      language,
    });
    this._scheduleUpdate();
  }

  progress(message: string): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];

    // Fold progress into the existing thinking part so the UI shows
    // a single unified "Thinking..." section instead of a disjoint
    // spinner + source pills.
    const thinkingPart = parts.find(
      (p) => p.kind === ChatContentPartKind.Thinking,
    ) as IChatThinkingContent | undefined;

    if (thinkingPart) {
      thinkingPart.progressMessage = message;
    } else {
      // No thinking part yet — create one to host the progress message
      parts.unshift({
        kind: ChatContentPartKind.Thinking,
        content: '',
        isCollapsed: false,
        progressMessage: message,
      });
    }
    this._scheduleUpdate();
  }

  provenance(entry: IChatProvenanceEntry): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];

    const thinkingPart = parts.find(
      (p) => p.kind === ChatContentPartKind.Thinking,
    ) as IChatThinkingContent | undefined;

    if (thinkingPart) {
      if (!thinkingPart.provenance) {
        thinkingPart.provenance = [];
      }
      if (!thinkingPart.provenance.some((existing) => (existing.uri ?? existing.id) === (entry.uri ?? entry.id))) {
        thinkingPart.provenance.push(entry);
      }
    } else {
      parts.unshift({
        kind: ChatContentPartKind.Thinking,
        content: '',
        isCollapsed: false,
        provenance: [entry],
      });
    }
    this._scheduleUpdate();
  }

  reference(uri: string, label: string, index?: number): void {
    this.provenance({
      id: uri,
      label,
      kind: 'rag',
      uri,
      index,
      tokens: 0,
      removable: true,
    });
  }

  thinking(content: string): void {
    this.throwIfDone();

    // Merge into the existing thinking part (which may have been created
    // earlier by progress() or reference()) rather than appending a new one.
    const parts = this._response.parts as IChatContentPart[];
    const existing = parts.find(
      (p) => p.kind === ChatContentPartKind.Thinking,
    ) as IChatThinkingContent | undefined;

    if (existing) {
      existing.content += content;
    } else {
      // No thinking part yet — create at front so it appears first
      parts.unshift({
        kind: ChatContentPartKind.Thinking,
        content,
        isCollapsed: false,
      });
    }

    this._scheduleUpdate();
  }

  warning(message: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Warning,
      message,
    });
    this._scheduleUpdate();
  }

  button(_label: string, _commandId: string, ..._args: unknown[]): void {
    this.throwIfDone();
    // Buttons are rendered as markdown action links in M9.0
    // Full button support arrives in M9.1 with tool invocation UI
    this.markdown(`[${_label}](command:${_commandId})`);
  }

  confirmation(message: string, data: unknown): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Confirmation,
      message,
      data,
    });
    this._scheduleUpdate();
  }

  beginToolInvocation(toolCallId: string, toolName: string, data?: unknown): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.ToolInvocation,
      toolCallId,
      toolName,
      args: (data as Record<string, unknown>) || {},
      status: 'pending',
    });
    this._scheduleUpdate();
  }

  updateToolInvocation(toolCallId: string, data: Partial<IChatToolInvocationContent>): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];
    const toolPart = parts.find(
      (p) => p.kind === ChatContentPartKind.ToolInvocation && p.toolCallId === toolCallId,
    ) as IChatToolInvocationContent | undefined;

    if (toolPart) {
      Object.assign(toolPart, data);
      this._scheduleUpdate();
    }
  }

  editProposal(
    pageId: string,
    operation: EditProposalOperation,
    after: string,
    options?: { blockId?: string; before?: string },
  ): void {
    this.throwIfDone();
    const part: IChatEditProposalContent = {
      kind: ChatContentPartKind.EditProposal,
      pageId,
      blockId: options?.blockId,
      operation,
      before: options?.before,
      after,
      status: 'pending',
    };
    (this._response.parts as IChatContentPart[]).push(part);
    this._scheduleUpdate();
  }

  editBatch(explanation: string, proposals: IChatEditProposalContent[]): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.EditBatch,
      explanation,
      proposals,
    });
    this._scheduleUpdate();
  }

  push(part: IChatContentPart): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push(part);
    this._scheduleUpdate();
  }
}

/**
 * Chat service — session lifecycle and request orchestration.
 *
 * Dependencies are injected via constructor (no auto-DI, matching codebase pattern).
 */
export class ChatService extends Disposable implements IChatService {

  // ── Session store ──

  private readonly _sessions = new Map<string, IChatSession>();

  /** Active cancellation source for the in-progress request, keyed by sessionId. */
  private readonly _activeCancellations = new Map<string, CancellationTokenSource>();

  // ── Dependencies ──

  private readonly _agentService: IChatAgentService;
  private readonly _modeService: IChatModeService;
  private readonly _languageModelsService: ILanguageModelsService;
  private _database: IChatPersistenceDatabase | undefined;
  /** Active workspace ID for session scoping. */
  private _workspaceId: string = '';
  /** Session manager for stale session detection. */
  private _sessionManager: ISessionManager | undefined;

  /** Debounce timer for persistence writes. */
  private _persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** Session IDs with pending persist (for flush on dispose). */
  private readonly _pendingPersistIds = new Set<string>();

  // ── Events ──

  private readonly _onDidCreateSession = this._register(new Emitter<IChatSession>());
  readonly onDidCreateSession: Event<IChatSession> = this._onDidCreateSession.event;

  private readonly _onDidDeleteSession = this._register(new Emitter<string>());
  readonly onDidDeleteSession: Event<string> = this._onDidDeleteSession.event;

  private readonly _onDidChangeSession = this._register(new Emitter<string>());
  readonly onDidChangeSession: Event<string> = this._onDidChangeSession.event;

  private readonly _onDidChangePendingRequests = this._register(new Emitter<string>());
  readonly onDidChangePendingRequests: Event<string> = this._onDidChangePendingRequests.event;

  constructor(
    agentService: IChatAgentService,
    modeService: IChatModeService,
    languageModelsService: ILanguageModelsService,
    database?: IChatPersistenceDatabase,
  ) {
    super();
    this._agentService = agentService;
    this._modeService = modeService;
    this._languageModelsService = languageModelsService;
    this._database = database;

    // Ensure tables exist (fire and forget — errors are non-fatal)
    if (database) {
      ensureChatTables(database).catch(() => { /* persistence is best-effort */ });
    }
  }

  /**
   * Late-bind a database for persistence.
   *
   * ChatService is created in Phase 1 (Services) before the DatabaseService
   * exists. The workbench calls this in Phase 5 (Ready) after the database
   * is opened, then triggers restoreSessions().
   *
   * @param workspaceId — the active workspace ID for session scoping
   */
  setDatabase(database: IChatPersistenceDatabase, workspaceId: string = ''): void {
    this._database = database;
    this._workspaceId = workspaceId;
    ensureChatTables(database).catch(() => { /* persistence is best-effort */ });
  }

  /**
   * Late-bind a session manager for stale session detection.
   * Called after services are available.
   */
  setSessionManager(sessionManager: ISessionManager): void {
    this._sessionManager = sessionManager;
  }

  // ── Session Persistence ──

  /**
   * Restore sessions from SQLite for the active workspace.
   * Called once during workbench startup to hydrate the session store.
   * Only loads sessions scoped to the current workspace ID.
   */
  async restoreSessions(): Promise<void> {
    if (!this._database) { return; }
    try {
      const sessions = await loadSessions(this._database, this._workspaceId);

      for (const session of sessions) {
        this._sessions.set(session.id, session);
      }
      // Fire change events so listeners (sidebar, widget) can refresh
      for (const session of sessions) {
        this._onDidChangeSession.fire(session.id);
      }
    } catch {
      // Persistence failure is non-fatal — chat still works in-memory
    }
  }

  /**
   * Schedule a debounced persistence write for a session.
   * Coalesces multiple writes within 500ms.
   */
  private _schedulePersist(sessionId: string): void {
    if (!this._database) { return; }
    this._pendingPersistIds.add(sessionId);
    if (this._persistTimer !== undefined) {
      clearTimeout(this._persistTimer);
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = undefined;
      this._flushPendingPersists();
    }, 500);
  }

  /**
   * Flush all pending session persists immediately.
   * Called by the debounce timer and on dispose (to avoid data loss on shutdown).
   */
  private _flushPendingPersists(): void {
    if (!this._database || this._pendingPersistIds.size === 0) return;
    const ids = [...this._pendingPersistIds];
    this._pendingPersistIds.clear();
    for (const id of ids) {
      const session = this._sessions.get(id);
      if (session && this._database) {
        saveSession(this._database, session, this._workspaceId).catch(() => { /* best-effort */ });
      }
    }
  }

  override dispose(): void {
    // Flush any pending persistence writes before teardown
    if (this._persistTimer !== undefined) {
      clearTimeout(this._persistTimer);
      this._persistTimer = undefined;
    }
    this._flushPendingPersists();
    super.dispose();
  }

  // ── Session Lifecycle ──

  createSession(mode?: ChatMode, modelId?: string): IChatSession {
    const id = generateUUID();
    const sessionResource = URI.from({ scheme: CHAT_SESSION_SCHEME, path: `/${id}` });

    const session: IChatSession = {
      id,
      sessionResource,
      createdAt: Date.now(),
      title: 'New Chat',
      mode: mode ?? this._modeService.getMode(),
      modelId: modelId ?? this._languageModelsService.getActiveModel() ?? '',
      messages: [],
      requestInProgress: false,
      pendingRequests: [],
    };

    this._sessions.set(id, session);
    this._onDidCreateSession.fire(session);
    return session;
  }

  deleteSession(sessionId: string): void {
    // Cancel any in-progress request
    const cts = this._activeCancellations.get(sessionId);
    if (cts) {
      cts.cancel();
      cts.dispose();
      this._activeCancellations.delete(sessionId);
    }

    if (this._sessions.delete(sessionId)) {
      // Remove from database
      if (this._database) {
        deletePersistedSession(this._database, sessionId).catch(() => { /* best-effort */ });
      }
      this._onDidDeleteSession.fire(sessionId);
    }
  }

  getSession(sessionId: string): IChatSession | undefined {
    return this._sessions.get(sessionId);
  }

  getSessions(): readonly IChatSession[] {
    return [...this._sessions.values()];
  }

  // ── Request Orchestration ──

  async sendRequest(
    sessionId: string,
    message: string,
    options?: IChatSendRequestOptions,
  ): Promise<IChatParticipantResult> {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }
    if (session.requestInProgress) {
      throw new Error('A request is already in progress for this session.');
    }

    // 0a. Capture session guard for stale detection
    const guard: SessionGuard | undefined = this._sessionManager
      ? captureSession(this._sessionManager)
      : undefined;

    // Session-scoped diagnostic log (M14 Phase 3)
    const logPrefix = this._sessionManager?.activeContext?.logPrefix ?? '';
    if (logPrefix) {
      console.log('%s [ChatService] sendRequest sessionId=%s', logPrefix, sessionId);
    }

    // 0. Parse user input for @participant, /command, #variables
    const parsed = parseChatRequest(message);

    // 1. Create user message
    const requestId = generateUUID();
    const attempt = Math.max(0, options?.attempt ?? 0);

    const userMessage: IChatUserMessage = {
      text: message,
      requestId,
      participantId: options?.participantId ?? parsed.participantId,
      command: options?.command ?? parsed.command,
      attachments: options?.attachments,
      attempt,
      replayOfRequestId: options?.replayOfRequestId,
      timestamp: Date.now(),
    };

    // 2. Create empty assistant response
    const assistantResponse: IChatAssistantResponse = {
      parts: [],
      isComplete: false,
      modelId: session.modelId,
      timestamp: Date.now(),
    };

    // 3. Append or replace the request/response pair in-session.
    const pair: IChatRequestResponsePair = {
      request: userMessage,
      response: assistantResponse,
    };

    const replayIndex = typeof options?.replayOfRequestId === 'string'
      ? session.messages.findIndex((existingPair) => existingPair.request.requestId === options.replayOfRequestId)
      : -1;
    const isReplayReplacement = replayIndex >= 0;

    if (isReplayReplacement) {
      session.messages.splice(replayIndex, session.messages.length - replayIndex, pair);
    } else {
      session.messages.push(pair);
    }

    // 4. Auto-generate title from first message
    if (!isReplayReplacement && session.messages.length === 1) {
      session.title = message.length > 50 ? message.slice(0, 47) + '...' : message;
    }

    session.requestInProgress = true;
    this._onDidChangeSession.fire(sessionId);

    // 5. Resolve participant (prefer explicit option, then parsed @mention, then default)
    const participantId = options?.participantId ?? parsed.participantId ?? this._agentService.getDefaultAgent()?.id ?? 'parallx.chat.default';

    // 6. Create cancellation token
    const cts = new CancellationTokenSource();
    this._activeCancellations.set(sessionId, cts);

    // 7. Create response stream
    const stream = new ChatResponseStream(assistantResponse, () => {
      this._onDidChangeSession.fire(sessionId);
    });

    // 8. Build participant request (use parsed text with @mention stripped)
    const participantRequest: IChatParticipantRequest = {
      text: parsed.text,
      requestId,
      command: options?.command ?? parsed.command,
      mode: session.mode,
      modelId: session.modelId,
      attachments: options?.attachments,
      attempt,
    };

    // 9. Build context
    const context: IChatParticipantContext = {
      sessionId,
      history: session.messages.slice(0, -1), // Exclude the current pair
    };

    // 10. Invoke agent
    let result: IChatParticipantResult;
    try {
      result = await this._agentService.invokeAgent(
        participantId,
        participantRequest,
        context,
        stream,
        cts.token,
      );
    } catch (err) {
      result = {
        errorDetails: {
          message: err instanceof Error ? err.message : String(err),
          responseIsIncomplete: true,
        },
      };
    }

    // 10b. Render errorDetails as a warning part so it's visible in the chat UI
    if (result.errorDetails) {
      const errMsg = result.errorDetails.message || 'An unknown error occurred.';
      stream.warning(errMsg);
      if (result.errorDetails.responseIsIncomplete) {
        assistantResponse.isComplete = false;
      }
    }

    // 11. Finalize
    stream.close();
    if (!result.errorDetails?.responseIsIncomplete) {
      assistantResponse.isComplete = true;
    }
    session.requestInProgress = false;

    cts.dispose();
    this._activeCancellations.delete(sessionId);

    this._onDidChangeSession.fire(sessionId);

    // 12. Persist session after response completes (skip if session is stale)
    if (!guard || guard.isValid()) {
      this._schedulePersist(sessionId);
    } else {
      console.warn('[ChatService] Skipping persist — workspace session changed during request');
    }

    // 13. Process any pending queued requests
    this._processNextPending(sessionId);

    return result;
  }

  /** Cancel the in-progress request for a session. */
  cancelRequest(sessionId: string): void {
    const cts = this._activeCancellations.get(sessionId);
    if (cts) {
      cts.cancel();
    }
  }

  // ── Pending Request Queue ──

  queueRequest(
    sessionId: string,
    message: string,
    kind: ChatRequestQueueKind,
    _options?: IChatSendRequestOptions,
  ): IChatPendingRequest {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const pending: IChatPendingRequest = {
      id: generateUUID(),
      text: message,
      kind,
      timestamp: Date.now(),
    };

    // Steering goes to front (after other steering), Queued goes to end
    if (kind === ChatRequestQueueKind.Steering) {
      const lastSteeringIdx = session.pendingRequests.reduce(
        (acc, p, i) => (p.kind === ChatRequestQueueKind.Steering ? i : acc), -1,
      );
      session.pendingRequests.splice(lastSteeringIdx + 1, 0, pending);
      // Signal the active request to yield early
      this.requestYield(sessionId);
    } else {
      session.pendingRequests.push(pending);
    }

    this._onDidChangePendingRequests.fire(sessionId);
    this._onDidChangeSession.fire(sessionId);

    return pending;
  }

  removePendingRequest(sessionId: string, requestId: string): void {
    const session = this._sessions.get(sessionId);
    if (!session) return;

    const idx = session.pendingRequests.findIndex((p) => p.id === requestId);
    if (idx >= 0) {
      session.pendingRequests.splice(idx, 1);
      this._onDidChangePendingRequests.fire(sessionId);
      this._onDidChangeSession.fire(sessionId);
    }
  }

  requestYield(sessionId: string): void {
    const cts = this._activeCancellations.get(sessionId);
    if (cts) {
      cts.requestYield();
    }
  }

  /**
   * Process the next pending request after the active request completes.
   * Runs asynchronously so sendRequest() has fully finished before we re-enter.
   */
  private _processNextPending(sessionId: string): void {
    const session = this._sessions.get(sessionId);
    if (!session || session.requestInProgress) return;
    if (session.pendingRequests.length === 0) return;

    const next = session.pendingRequests.shift()!;
    this._onDidChangePendingRequests.fire(sessionId);

    // Fire-and-forget — errors are handled inside sendRequest
    queueMicrotask(() => {
      this.sendRequest(sessionId, next.text).catch(() => { /* swallowed */ });
    });
  }
}
