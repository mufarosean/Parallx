// chatService.ts — IChatService implementation (M9 Task 2.1)
//
// Session lifecycle and request orchestration.
// Creates sessions, orchestrates the sendRequest pipeline:
//   parse → dispatch to agent → stream response → update session.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatService/chatService.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import { URI } from '../platform/uri.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import { ChatContentPartKind } from './chatTypes.js';
import { parseChatRequest } from '../built-in/chat/chatRequestParser.js';
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
  IChatToolInvocationContent,
  ICancellationToken,
  ChatMode,
  IChatAgentService,
  IChatModeService,
  ILanguageModelsService,
} from './chatTypes.js';

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
  readonly token: ICancellationToken;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.token = {
      get isCancellationRequested() {
        return self._controller.signal.aborted;
      },
      onCancellationRequested: self._onCancellationRequested.event,
    };
  }

  /** Get the underlying AbortSignal for fetch() calls. */
  get signal(): AbortSignal {
    return this._controller.signal;
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
 * Each method appends a typed content part to the response's parts array.
 * The service fires session change events after each mutation.
 */
class ChatResponseStream implements IChatResponseStream {
  private _done = false;

  constructor(
    private readonly _response: IChatAssistantResponse,
    private readonly _onUpdate: () => void,
  ) {}

  throwIfDone(): void {
    if (this._done) {
      throw new Error('Stream is closed');
    }
  }

  /** Mark the stream as closed — no more writes allowed. */
  close(): void {
    this._done = true;
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

    this._onUpdate();
  }

  codeBlock(code: string, language?: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.CodeBlock,
      code,
      language,
    });
    this._onUpdate();
  }

  progress(message: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Progress,
      message,
    });
    this._onUpdate();
  }

  reference(uri: string, label: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Reference,
      uri,
      label,
    });
    this._onUpdate();
  }

  thinking(content: string): void {
    this.throwIfDone();

    // Merge adjacent thinking parts
    const parts = this._response.parts as IChatContentPart[];
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;

    if (last && last.kind === ChatContentPartKind.Thinking) {
      last.content += content;
    } else {
      parts.push({
        kind: ChatContentPartKind.Thinking,
        content,
        isCollapsed: false,
      });
    }

    this._onUpdate();
  }

  warning(message: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Warning,
      message,
    });
    this._onUpdate();
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
    this._onUpdate();
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
    this._onUpdate();
  }

  updateToolInvocation(toolCallId: string, data: Partial<IChatToolInvocationContent>): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];
    const toolPart = parts.find(
      (p) => p.kind === ChatContentPartKind.ToolInvocation && p.toolCallId === toolCallId,
    ) as IChatToolInvocationContent | undefined;

    if (toolPart) {
      Object.assign(toolPart, data);
      this._onUpdate();
    }
  }

  push(part: IChatContentPart): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push(part);
    this._onUpdate();
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

  // ── Events ──

  private readonly _onDidCreateSession = this._register(new Emitter<IChatSession>());
  readonly onDidCreateSession: Event<IChatSession> = this._onDidCreateSession.event;

  private readonly _onDidDeleteSession = this._register(new Emitter<string>());
  readonly onDidDeleteSession: Event<string> = this._onDidDeleteSession.event;

  private readonly _onDidChangeSession = this._register(new Emitter<string>());
  readonly onDidChangeSession: Event<string> = this._onDidChangeSession.event;

  constructor(
    agentService: IChatAgentService,
    modeService: IChatModeService,
    languageModelsService: ILanguageModelsService,
  ) {
    super();
    this._agentService = agentService;
    this._modeService = modeService;
    this._languageModelsService = languageModelsService;
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

    // 0. Parse user input for @participant, /command, #variables
    const parsed = parseChatRequest(message);

    // 1. Create user message
    const userMessage: IChatUserMessage = {
      text: message,
      participantId: options?.participantId ?? parsed.participantId,
      command: options?.command ?? parsed.command,
      timestamp: Date.now(),
    };

    // 2. Create empty assistant response
    const assistantResponse: IChatAssistantResponse = {
      parts: [],
      isComplete: false,
      modelId: session.modelId,
      timestamp: Date.now(),
    };

    // 3. Append pair to session
    const pair: IChatRequestResponsePair = {
      request: userMessage,
      response: assistantResponse,
    };
    session.messages.push(pair);

    // 4. Auto-generate title from first message
    if (session.messages.length === 1) {
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
      requestId: generateUUID(),
      command: options?.command ?? parsed.command,
      mode: session.mode,
      modelId: session.modelId,
      attempt: 0,
    };

    // 9. Build context
    const context: IChatParticipantContext = {
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
    } finally {
      // 11. Finalize
      stream.close();
      assistantResponse.isComplete = true;
      session.requestInProgress = false;

      cts.dispose();
      this._activeCancellations.delete(sessionId);

      this._onDidChangeSession.fire(sessionId);
    }

    return result;
  }

  /** Cancel the in-progress request for a session. */
  cancelRequest(sessionId: string): void {
    const cts = this._activeCancellations.get(sessionId);
    if (cts) {
      cts.cancel();
    }
  }
}
