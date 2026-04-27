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
import { analyzeChatTurnSemantics } from '../built-in/chat/utilities/chatTurnSemantics.js';
import { determineChatTurnRoute } from '../built-in/chat/utilities/chatTurnRouter.js';
import { buildFollowUpRetrievalQuery } from '../built-in/chat/utilities/chatGroundedResponseHelpers.js';
import { extractMentions, stripMentions } from '../built-in/chat/utilities/chatMentionResolver.js';
import { resolveQueryScope } from '../built-in/chat/utilities/chatScopeResolver.js';
import {
  buildRuntimePromptEnvelopeMessages,
  buildRuntimePromptSeedMessages,
} from '../built-in/chat/utilities/chatRuntimePromptMessages.js';
import { buildParticipantRuntimeTrace } from '../built-in/chat/utilities/chatParticipantRuntimeTrace.js';
import { resolveChatRuntimeParticipantId } from './chatRuntimeSelector.js';
import {
  ensureChatTables,
  saveSession,
  loadSessions,
  deletePersistedSession,
  isEphemeralSessionId,
  EPHEMERAL_SESSION_ID_PREFIX,
} from './chatSessionPersistence.js';
import type { IChatPersistenceDatabase } from './chatSessionPersistence.js';
import type { ISessionManager, IWorkspaceTranscriptService } from './serviceTypes.js';
import { captureSession } from '../workspace/staleGuard.js';
import type { SessionGuard } from '../workspace/staleGuard.js';
import type {
  IChatService,
  IChatSession,
  IChatMessage,
  IChatUserMessage,
  IChatAssistantResponse,
  IChatRequestResponsePair,
  IChatRequestOptions,
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
  IChatTurnPreparationServices,
  IChatParticipantTurnState,
  IChatParticipantMention,
} from './chatTypes.js';
import { ChatRequestQueueKind } from './chatTypes.js';

// ── Session URI scheme ──

const CHAT_SESSION_SCHEME = 'parallx-chat-session';

// ── Ephemeral session handle types (M58 W5-A) ──

/**
 * Seed passed to `ChatService.createEphemeralSession`.
 *
 * Every field is optional by design — M58 captures all four fields on the
 * handle so M59 can adopt them without widening the substrate API. The
 * current subagent executor consumes `firstUserMessage` (via the caller
 * deciding when to invoke sendRequest) and inherits loop-safety through
 * the per-turn ChatToolLoopSafety instance.
 */
export interface IEphemeralSessionSeed {
  /** Optional system-prompt override captured for M59 retrofits. */
  readonly systemMessage?: string;
  /** Informational: the first user message the caller plans to send. */
  readonly firstUserMessage?: string;
  /** Optional tool allowlist (M59). */
  readonly toolsEnabled?: readonly string[];
  /** Parent loop-safety context snapshot (M59 shared-counter hook). */
  readonly loopSafetyContext?: Readonly<Record<string, unknown>>;
}

/**
 * Opaque handle returned by `ChatService.createEphemeralSession`. The caller
 * drives the turn with `chatService.sendRequest(handle.sessionId, ...)` and
 * releases scratch state with `chatService.purgeEphemeralSession(handle)`.
 */
export interface IEphemeralSessionHandle {
  readonly sessionId: string;
  readonly parentId: string;
  readonly seed: IEphemeralSessionSeed;
}

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

function findReplayReplacementIndex(
  session: IChatSession,
  replayOfRequestId: string | undefined,
): number {
  if (!replayOfRequestId) {
    return -1;
  }

  const pairs = session.messages;
  let replayIndex = pairs.findIndex((pair) => pair.request.requestId === replayOfRequestId);
  if (replayIndex < 0) {
    replayIndex = pairs.findIndex((pair) => pair.request.replayOfRequestId === replayOfRequestId);
    if (replayIndex < 0) {
      return -1;
    }
  }

  const visitedRequestIds = new Set<string>();
  while (replayIndex >= 0) {
    const replayedRequest = pairs[replayIndex]?.request;
    const previousRequestId = replayedRequest?.replayOfRequestId;
    if (!previousRequestId || visitedRequestIds.has(previousRequestId)) {
      break;
    }

    visitedRequestIds.add(previousRequestId);
    const previousIndex = pairs.findIndex((pair) => pair.request.requestId === previousRequestId);
    if (previousIndex < 0) {
      break;
    }

    replayIndex = previousIndex;
  }

  return replayIndex;
}

function extractRuntimeTracesFromMetadata(metadata: unknown): unknown[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const record = metadata as { runtimeTrace?: unknown; runtimeTraces?: unknown[] };
  const traces: unknown[] = [];

  if (typeof record.runtimeTrace !== 'undefined') {
    traces.push(record.runtimeTrace);
  }

  if (Array.isArray(record.runtimeTraces)) {
    traces.push(...record.runtimeTraces);
  }

  return traces;
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

    // Strip transient standalone parts (Progress spinners, Reference stragglers).
    // ToolInvocation parts are kept — completed tool calls persist in the message
    // so the user can see what tools were called, their args, and results.
    for (let i = parts.length - 1; i >= 0; i--) {
      const kind = parts[i].kind;
      if (
        kind === ChatContentPartKind.Progress ||
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

    // Clear the ephemeral progress message now that we're done, and
    // auto-collapse the thinking block — it stays expanded while streaming
    // (so the user sees reasoning happen live) and tucks away on completion.
    const thinkingPart = parts.find(
      (p) => p.kind === ChatContentPartKind.Thinking,
    ) as IChatThinkingContent | undefined;
    if (thinkingPart) {
      thinkingPart.progressMessage = undefined;
      thinkingPart.isCollapsed = true;
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
  private _transcriptService: IWorkspaceTranscriptService | undefined;
  private _turnPreparationServices: IChatTurnPreparationServices | undefined;
  private _runtimeTraceReporter: ((trace: unknown) => void) | undefined;
  private _runtimeParticipantResolver: ((participantId: string) => string) | undefined;

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
      ensureChatTables(database).catch((e) => { console.error('[ChatService] ensureChatTables failed:', e); });
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
    ensureChatTables(database).catch((e) => { console.error('[ChatService] ensureChatTables failed:', e); });
  }

  /**
   * Late-bind a session manager for stale session detection.
   * Called after services are available.
   */
  setSessionManager(sessionManager: ISessionManager): void {
    this._sessionManager = sessionManager;
  }

  setTranscriptService(transcriptService: IWorkspaceTranscriptService): void {
    this._transcriptService = transcriptService;
  }

  setTurnPreparationServices(services: IChatTurnPreparationServices): void {
    this._turnPreparationServices = services;
  }

  setRuntimeTraceReporter(reporter: ((trace: unknown) => void) | undefined): void {
    this._runtimeTraceReporter = reporter;
  }

  setRuntimeParticipantResolver(resolver: ((participantId: string) => string) | undefined): void {
    this._runtimeParticipantResolver = resolver;
  }

  private _getParticipantSurface(participantId: string): 'default' | 'workspace' | 'canvas' | 'bridge' {
    const registeredSurface = this._agentService.getAgent(participantId)?.surface;
    if (registeredSurface) {
      return registeredSurface;
    }

    if (participantId.endsWith('.workspace')) {
      return 'workspace';
    }
    if (participantId.endsWith('.canvas')) {
      return 'canvas';
    }
    if (!participantId.startsWith('parallx.chat.')) {
      return 'bridge';
    }
    return 'default';
  }

  private async _buildTurnState(
    requestText: string,
    commandName: string | undefined,
    history: readonly IChatRequestResponsePair[],
    participantSurface?: string,
  ): Promise<IChatParticipantTurnState> {
    const mentions = extractMentions(requestText);
    const userText = stripMentions(requestText, mentions);

    // OpenClaw participants use their own context engine and don't consume the
    // legacy regex routing cascade. Skip the expensive semantic analysis +
    // route determination when the surface is NOT the bridge participant.
    const needsLegacyRouting = participantSurface === 'bridge' || participantSurface === undefined;
    const semantics = needsLegacyRouting
      ? analyzeChatTurnSemantics(userText)
      : {
          rawText: userText,
          normalizedText: userText.toLowerCase(),
          strippedApostropheText: userText,
          isConversational: false,
          isExplicitMemoryRecall: false,
          isExplicitTranscriptRecall: false,
          isFileEnumeration: false,
        };
    const hasActiveSlashCommand = !!(commandName && commandName !== 'compact');
    const mentionScope = {
      folders: mentions
        .filter((mention): mention is IChatParticipantMention & { kind: 'folder'; path: string } => mention.kind === 'folder' && typeof mention.path === 'string')
        .map((mention) => mention.path),
      files: mentions
        .filter((mention): mention is IChatParticipantMention & { kind: 'file'; path: string } => mention.kind === 'file' && typeof mention.path === 'string')
        .map((mention) => mention.path),
    };
    const queryScope = await resolveQueryScope(userText, mentionScope, {
      listFilesRelative: this._turnPreparationServices?.listFilesRelative,
    });
    const turnRoute = needsLegacyRouting
      ? determineChatTurnRoute(semantics, { hasActiveSlashCommand })
      : { kind: 'grounded' as const, reason: 'openclaw-runtime' };

    return {
      rawText: requestText,
      effectiveText: requestText.trim(),
      userText,
      contextQueryText: buildFollowUpRetrievalQuery(userText, history),
      mentions,
      semantics,
      queryScope,
      turnRoute,
      hasActiveSlashCommand,
      isRagReady: this._turnPreparationServices?.isRAGAvailable?.() ?? false,
    };
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
    // W5-A: ephemeral sessions never persist. Guard here (at the single
    // schedule site) so the downstream saveSession + transcriptService paths
    // are not reached at all — belt-and-braces with the saveSession() guard
    // inside chatSessionPersistence.ts.
    if (isEphemeralSessionId(sessionId)) { return; }
    if (!this._database && !this._transcriptService) { return; }
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
    if (this._pendingPersistIds.size === 0) return;
    const ids = [...this._pendingPersistIds];
    this._pendingPersistIds.clear();
    for (const id of ids) {
      const session = this._sessions.get(id);
      if (session && this._database) {
        saveSession(this._database, session, this._workspaceId).catch((e) => { console.error('[ChatService] saveSession failed:', e); });
      }
      if (session && this._transcriptService) {
        this._transcriptService.writeSessionTranscript(session).catch((e) => { console.error('[ChatService] writeSessionTranscript failed:', e); });
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

  updateSessionModel(sessionId: string, modelId: string): void {
    const session = this._sessions.get(sessionId);
    if (!session || session.modelId === modelId) return;
    session.modelId = modelId;
    this._schedulePersist(sessionId);
    this._onDidChangeSession.fire(sessionId);
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
      if (this._transcriptService) {
        this._transcriptService.deleteSessionTranscript(sessionId).catch((e) => { console.error('[ChatService] deleteSessionTranscript failed:', e); });
      }
      // Remove from database
      if (this._database) {
        deletePersistedSession(this._database, sessionId).catch((e) => { console.error('[ChatService] deletePersistedSession failed:', e); });
      }
      this._onDidDeleteSession.fire(sessionId);
    }
  }

  getSession(sessionId: string): IChatSession | undefined {
    return this._sessions.get(sessionId);
  }

  getSessions(): readonly IChatSession[] {
    // W5-A: ephemeral (scratch) sessions MUST NOT appear in any UI session
    // list. Filtering here centralises the invariant — every list consumer
    // (sidebar, session switcher, workspace transcript writer) routes through
    // getSessions() so they all inherit the filter.
    return [...this._sessions.values()].filter((s) => !isEphemeralSessionId(s.id));
  }

  // ── Ephemeral session substrate (M58 W5-A) ──
  //
  // Creates an in-memory session that:
  //   • participates in the normal sendRequest pipeline (tool loop, approval
  //     flow, loop-safety ChatToolLoopSafety per-turn instance),
  //   • is NEVER persisted (saveSession early-returns on ephemeral ids),
  //   • is NEVER surfaced by getSessions() or createSession events,
  //   • is purged by purgeEphemeralSession() after the caller captures the
  //     final assistant response.
  //
  // This is the minimum facility the SubagentSpawner needs to run a real
  // isolated turn without polluting the parent session's messages[] or the
  // chat_sessions table. M59 retrofits heartbeat + cron executors onto the
  // same substrate (see Parallx_Milestone_58.md §6.5).

  /**
   * Create a scratch session for an isolated turn. The returned handle's
   * `sessionId` is usable by `sendRequest` immediately; the session is NOT
   * visible to `getSessions()` and NOT persisted.
   *
   * @param parentId Id of the parent chat session (informational — preserved
   *   on the handle for loop-safety context; the ephemeral session never
   *   mutates the parent's messages[]).
   * @param seed Optional turn seeding:
   *   - `systemMessage`: future system-prompt override (captured on handle
   *     for M59; M58 executor doesn't consume it yet)
   *   - `firstUserMessage`: informational — the caller decides when/how to
   *     drive `sendRequest`
   *   - `toolsEnabled`: future tool allowlist (captured for M59)
   *   - `loopSafetyContext`: parent's loop safety snapshot (captured for
   *     future shared-counter wiring; per-turn ChatToolLoopSafety already
   *     provides bounded iteration today)
   */
  createEphemeralSession(parentId: string, seed: IEphemeralSessionSeed = {}): IEphemeralSessionHandle {
    const id = EPHEMERAL_SESSION_ID_PREFIX + generateUUID();
    const sessionResource = URI.from({ scheme: CHAT_SESSION_SCHEME, path: `/${id}` });

    const parent = this._sessions.get(parentId);
    const session: IChatSession = {
      id,
      sessionResource,
      createdAt: Date.now(),
      title: 'Ephemeral (subagent)',
      mode: parent?.mode ?? this._modeService.getMode(),
      modelId: parent?.modelId ?? this._languageModelsService.getActiveModel() ?? '',
      messages: [],
      requestInProgress: false,
      pendingRequests: [],
    };

    this._sessions.set(id, session);
    // Deliberately DO NOT fire onDidCreateSession: ephemeral sessions must
    // not trigger chat-list re-renders or sidebar updates.
    return {
      sessionId: id,
      parentId,
      seed,
    };
  }

  /**
   * Purge an ephemeral session from in-memory state. Cancels any pending
   * request, clears cancellation source, and drops the session from
   * `_sessions`. Persistence was never touched.
   */
  purgeEphemeralSession(handle: IEphemeralSessionHandle): void {
    const { sessionId } = handle;
    if (!isEphemeralSessionId(sessionId)) {
      // Defensive: caller can only mint handles via createEphemeralSession,
      // but ignore non-ephemeral ids to avoid accidental deletion of real
      // chat sessions if a stale handle is replayed.
      return;
    }
    const cts = this._activeCancellations.get(sessionId);
    if (cts) {
      cts.cancel();
      cts.dispose();
      this._activeCancellations.delete(sessionId);
    }
    this._sessions.delete(sessionId);
    this._pendingPersistIds.delete(sessionId);
    // No onDidDeleteSession event — listeners never saw this session created.
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

    const requestedParticipantId = options?.participantId ?? parsed.participantId ?? this._agentService.getDefaultAgent()?.id ?? 'parallx.chat.default';
    const participantId = this._runtimeParticipantResolver?.(requestedParticipantId)
      ?? resolveChatRuntimeParticipantId(requestedParticipantId);

    const userMessage: IChatUserMessage = {
      text: message,
      requestId,
      participantId,
      command: options?.command ?? parsed.command,
      variables: parsed.variables.map((variable) => ({ name: variable.name })),
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

    const replayIndex = findReplayReplacementIndex(session, options?.replayOfRequestId);
    const isReplayReplacement = replayIndex >= 0;

    if (isReplayReplacement) {
      session.messages.splice(replayIndex, session.messages.length - replayIndex, pair);
    } else {
      session.messages.push(pair);
    }

    // 4. Auto-generate title from first substantive message (skip greetings)
    if (!isReplayReplacement && (!session.title || session.title === 'New Chat')) {
      const GREETING_RE = /^\s*(hi|hey|hello|howdy|yo|sup|what's up|hiya|good\s*(morning|afternoon|evening)|greetings)\s*[!.,?]*\s*$/i;
      if (!GREETING_RE.test(message)) {
        session.title = message.length > 50 ? message.slice(0, 47) + '...' : message;
      }
    }

    session.requestInProgress = true;
    this._onDidChangeSession.fire(sessionId);

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
      variables: parsed.variables.map((variable) => ({ name: variable.name })),
      mode: session.mode,
      modelId: session.modelId,
      attachments: options?.attachments,
      attempt,
      isSteeringTurn: options?.isSteeringTurn,
    };

    const history = session.messages.slice(0, -1);
    const participantSurface = this._getParticipantSurface(participantId);
    const turnState = await this._buildTurnState(parsed.text, options?.command ?? parsed.command, history, participantSurface);

    // 9. Build context
    const buildRuntimePromptEnvelope = (systemPrompt: string, userContent: string): readonly IChatMessage[] => {
      const seedMessages = buildRuntimePromptSeedMessages({
        systemPrompt,
        history,
      });
      const promptTraceContext: IChatParticipantContext = { sessionId, history };
      const seedTrace = buildParticipantRuntimeTrace(
        { ...participantRequest, turnState },
        promptTraceContext,
        {
          checkpoint: 'prompt-seed',
          note: `${participantSurface} runtime prompt seed`,
        },
        { useCurrentPage: participantSurface === 'canvas' },
      );
      if (seedTrace) {
        this._runtimeTraceReporter?.(seedTrace);
      }

      const envelopeMessages = buildRuntimePromptEnvelopeMessages({
        seedMessages,
        userContent,
        attachments: participantRequest.attachments,
      });
      const envelopeTrace = buildParticipantRuntimeTrace(
        { ...participantRequest, turnState },
        promptTraceContext,
        {
          checkpoint: 'prompt-envelope',
          note: `${participantSurface} runtime prompt envelope`,
        },
        { useCurrentPage: participantSurface === 'canvas' },
      );
      if (envelopeTrace) {
        this._runtimeTraceReporter?.(envelopeTrace);
      }

      return envelopeMessages;
    };

    const context: IChatParticipantContext = {
      sessionId,
      history,
      runtime: {
        reportTrace: this._runtimeTraceReporter
          ? (trace) => this._runtimeTraceReporter?.(trace)
          : undefined,
        buildPromptSeed: (systemPrompt: string) => buildRuntimePromptSeedMessages({
          systemPrompt,
          history,
        }),
        buildPromptEnvelope: buildRuntimePromptEnvelope,
        sendPrompt: (systemPrompt: string, userContent: string, requestOptions?: IChatRequestOptions, signal?: AbortSignal) => this._languageModelsService.sendChatRequest(
          buildRuntimePromptEnvelope(systemPrompt, userContent),
          requestOptions,
          signal,
        ),
      },
    };

    // 10. Invoke agent
    let result: IChatParticipantResult;
    try {
      result = await this._agentService.invokeAgent(
        participantId,
        {
          ...participantRequest,
          interpretation: {
            surface: this._getParticipantSurface(participantId),
            rawText: parsed.text,
            effectiveText: parsed.text.trim(),
            commandName: options?.command ?? parsed.command,
            hasExplicitCommand: !!(options?.command ?? parsed.command),
            kind: (options?.command ?? parsed.command) ? 'command' : 'message',
            semantics: turnState.semantics,
          },
          turnState,
        },
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
    if (this._runtimeTraceReporter) {
      for (const trace of extractRuntimeTracesFromMetadata(result.metadata)) {
        this._runtimeTraceReporter(trace);
      }
    }

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

    // 11b. Provide followup suggestions
    const participant = this._agentService.getAgent(participantId);
    if (participant?.provideFollowups && !result.errorDetails?.responseIsIncomplete) {
      try {
        const followups = await participant.provideFollowups(result, context, cts.token);
        if (followups.length > 0) {
          assistantResponse.followups = followups;
        }
      } catch {
        // Non-critical — don't fail the response if followup generation fails
      }
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
    options?: IChatSendRequestOptions,
  ): IChatPendingRequest {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const pending: IChatPendingRequest = {
      id: generateUUID(),
      text: message,
      kind,
      options,
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

    // Propagate steering flag so the participant knows this turn interrupted
    // a previous active turn. Upstream: resolveActiveRunQueueAction → shouldSteer.
    const sendOptions: IChatSendRequestOptions = {
      ...next.options,
      ...(next.kind === ChatRequestQueueKind.Steering ? { isSteeringTurn: true } : undefined),
    };

    // Fire-and-forget — errors are handled inside sendRequest
    queueMicrotask(() => {
      this.sendRequest(sessionId, next.text, sendOptions).catch((e) => { console.error('[ChatService] queued sendRequest failed:', e); });
    });
  }
}
