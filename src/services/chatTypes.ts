// chatTypes.ts — Chat & Language Model type definitions and service interfaces
//
// Single file containing all shared types for the AI chat system (M9).
// Pure data types — no runtime dependencies beyond platform primitives.
//
// Layout:
//   1. Provider & Message Types       (Task 0.1)
//   2. Session & Content Part Types   (Task 0.2)
//   3. Participant & Tool Types       (Task 0.3)
//   4. Service Interfaces & DI IDs    (Task 0.4)
//
// VS Code references:
//   src/vs/workbench/contrib/chat/common/languageModels.ts
//   src/vs/workbench/contrib/chat/common/model/chatModel.ts
//   src/vs/workbench/contrib/chat/common/chatAgents.ts
//   src/vs/workbench/contrib/chat/common/chatModes.ts
//   src/vs/workbench/contrib/chat/common/chatService/chatService.ts
//   src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts

import { createServiceIdentifier } from '../platform/types.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { URI } from '../platform/uri.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Provider & Message Types (Task 0.1)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Metadata describing a single language model available from a provider.
 *
 * Maps to Ollama's `/api/tags` response entries + `/api/show` enrichment.
 * VS Code reference: ILanguageModelChatMetadata
 */
export interface ILanguageModelInfo {
  /** Unique model identifier (e.g. 'llama3.2:latest'). */
  readonly id: string;
  /** Human-readable display name (e.g. 'Llama 3.2'). */
  readonly displayName: string;
  /** Model family (e.g. 'llama', 'gemma', 'qwen'). */
  readonly family: string;
  /** Model parameter size string (e.g. '3.2B', '8.0B'). */
  readonly parameterSize: string;
  /** Quantization level (e.g. 'Q4_K_M', 'Q4_0'). */
  readonly quantization: string;
  /** Context window length in tokens. */
  readonly contextLength: number;
  /** Capabilities this model supports. */
  readonly capabilities: readonly ModelCapability[];
}

/**
 * Model capabilities — derived from Ollama's model info.
 */
export type ModelCapability = 'completion' | 'tools' | 'thinking';

/**
 * Provider connection/availability status.
 *
 * Returned by `ILanguageModelProvider.checkAvailability()`.
 */
export interface IProviderStatus {
  /** Whether the provider backend is reachable. */
  readonly available: boolean;
  /** Backend version string when available (e.g. '0.5.4'). */
  readonly version?: string;
  /** Error description when unavailable. */
  readonly error?: string;
}

/**
 * A single message in a chat conversation.
 *
 * Matches Ollama's message format (4 roles: system, user, assistant, tool).
 * VS Code reference: ILanguageModelChatMessage
 */
export interface IChatMessage {
  /** Message role — matches Ollama's 4 roles. */
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  /** Message text content. */
  readonly content: string;
  /** Tool calls requested by assistant (present when role === 'assistant'). */
  readonly toolCalls?: readonly IToolCall[];
  /** Tool name for tool results (present when role === 'tool'). */
  readonly toolName?: string;
  /** Thinking/reasoning content for thinking models (e.g. DeepSeek-R1). */
  readonly thinking?: string;
}

/**
 * Options for a chat completion request.
 *
 * Maps to Ollama's request body options.
 */
export interface IChatRequestOptions {
  /** Sampling temperature (0.0 = deterministic, higher = more creative). */
  readonly temperature?: number;
  /** Top-p (nucleus) sampling threshold. */
  readonly topP?: number;
  /** Maximum tokens to generate. */
  readonly maxTokens?: number;
  /** Tool definitions the model can invoke. */
  readonly tools?: readonly IToolDefinition[];
  /** Response format constraint (e.g. 'json' for structured output). */
  readonly format?: string | object;
  /** Random seed for reproducibility. */
  readonly seed?: number;
  /** Enable thinking/reasoning mode for supported models. */
  readonly think?: boolean;
}

/**
 * A single streaming response chunk from the language model.
 *
 * Maps 1:1 to Ollama's streaming JSON objects from POST /api/chat.
 */
export interface IChatResponseChunk {
  /** Incremental text content. */
  readonly content: string;
  /** Incremental thinking/reasoning content. */
  readonly thinking?: string;
  /** Tool calls in this chunk (when model requests tool invocation). */
  readonly toolCalls?: readonly IToolCall[];
  /** Whether this is the final chunk. */
  readonly done: boolean;
  /** Number of tokens in the prompt (present on final chunk from Ollama). */
  readonly promptEvalCount?: number;
  /** Number of tokens generated (present on final chunk from Ollama). */
  readonly evalCount?: number;
  /** Evaluation duration in nanoseconds (present on final chunk). */
  readonly evalDuration?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Session & Content Part Types (Task 0.2)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Chat mode determines per-request capabilities.
 *
 * VS Code reference: ChatModeKind enum (constants.ts)
 */
export enum ChatMode {
  /** Q&A mode — no side effects, no tool invocation. */
  Ask = 'ask',
  /** Edit mode — canvas page/block editing with accept/reject. */
  Edit = 'edit',
  /** Agent mode — autonomous with tool invocation and confirmation gates. */
  Agent = 'agent',
}

/**
 * A chat session — one conversation thread.
 *
 * VS Code reference: IChatModel (model/chatModel.ts)
 */
export interface IChatSession {
  /** Unique session identifier (UUID). */
  readonly id: string;
  /** Session URI: parallx-chat-session:///<uuid>. */
  readonly sessionResource: URI;
  /** Timestamp when the session was created. */
  readonly createdAt: number;
  /** Session title (auto-generated from first user message). */
  title: string;
  /** Current chat mode for this session. */
  mode: ChatMode;
  /** Active model ID for this session. */
  modelId: string;
  /** Ordered list of request/response pairs. */
  readonly messages: IChatRequestResponsePair[];
  /** Whether a request is currently being processed. */
  requestInProgress: boolean;
  /** Pending messages queued while a request is in progress. */
  readonly pendingRequests: IChatPendingRequest[];
}

// ── Queued / Pending Requests ──

/**
 * A message queued while the AI is still responding.
 *
 * VS Code reference: IChatPendingRequest (model/chatModel.ts)
 */
export interface IChatPendingRequest {
  /** Unique identifier for this pending request. */
  readonly id: string;
  /** The user's message text. */
  readonly text: string;
  /** Queue behavior: wait or steer. */
  readonly kind: ChatRequestQueueKind;
  /** Timestamp when the message was queued. */
  readonly timestamp: number;
}

/**
 * How a queued message interacts with the active request.
 *
 * VS Code reference: ChatRequestQueueKind (chatService.ts)
 */
export const enum ChatRequestQueueKind {
  /** Wait until the active request finishes, then send. */
  Queued = 0,
  /** Signal the active request to yield, then send immediately. */
  Steering = 1,
}

/**
 * A paired user request and assistant response.
 *
 * VS Code reference: IChatRequestModel + IChatResponseModel pair
 */
export interface IChatRequestResponsePair {
  readonly request: IChatUserMessage;
  readonly response: IChatAssistantResponse;
}

/**
 * A user's chat message.
 */
export interface IChatUserMessage {
  /** Raw input text. */
  readonly text: string;
  /** Resolved participant ID (from @mention or default). */
  readonly participantId?: string;
  /** Slash command (e.g. '/search'). */
  readonly command?: string;
  /** Variable references (e.g. #currentPage). */
  readonly variables?: readonly IChatVariable[];
  /** Files attached as explicit context by the user. */
  readonly attachments?: readonly IChatAttachment[];
  /** Timestamp when the message was sent. */
  readonly timestamp: number;
}

/**
 * A variable reference extracted from user input.
 */
export interface IChatVariable {
  /** Variable name (e.g. 'currentPage', 'selection'). */
  readonly name: string;
  /** Resolved value (populated at request time by participant handler). */
  value?: string;
}

// ── Chat Attachments ──

/**
 * A file attached as explicit context by the user (via "Add Context" button).
 *
 * VS Code reference: IChatRequestVariableEntry (chatModel.ts)
 */
export interface IChatAttachment {
  /** Unique identifier (typically a file path or URI string). */
  readonly id: string;
  /** Display name (e.g. 'chatWidget.ts'). */
  readonly name: string;
  /** Full path or URI for content retrieval. */
  readonly fullPath: string;
  /** Whether this is an implicit suggestion (from open editor) vs explicitly added. */
  readonly isImplicit: boolean;
}

/**
 * The assistant's response to a user message.
 */
export interface IChatAssistantResponse {
  /** Ordered content parts composing the response. */
  readonly parts: IChatContentPart[];
  /** Whether the response is complete (no more streaming). */
  isComplete: boolean;
  /** Model that generated this response. */
  readonly modelId: string;
  /** Timestamp when the response started. */
  readonly timestamp: number;
  /** Follow-up suggestion chips (populated after response completes). */
  followups?: readonly IChatFollowup[];
  /** Actual prompt tokens reported by Ollama (set after response completes). */
  promptTokens?: number;
  /** Actual completion tokens reported by Ollama (set after response completes). */
  completionTokens?: number;
}

// ── Context Pills (M11 Task 1.10) ──

/**
 * A context pill — represents a single context source visible to the LLM.
 * Displayed as visual chips above the chat input for transparency.
 */
export interface IContextPill {
  /** Unique ID (file path, page URI, or synthetic like 'system'). */
  readonly id: string;
  /** Display label (filename or source description). */
  readonly label: string;
  /** Context source type. */
  readonly type: 'attachment' | 'rag' | 'system' | 'rule';
  /** Estimated token count for this source. */
  readonly tokens: number;
  /** Whether the user can remove this pill (false for system). */
  readonly removable: boolean;
  /** Citation index from the retrieval pipeline (1-based). RAG pills only. */
  readonly index?: number;
}

// ── Content Part Discriminated Union ──

/**
 * Discriminant for content part types.
 *
 * VS Code reference: ChatResponsePart union type (model/chatModel.ts)
 */
export enum ChatContentPartKind {
  Markdown = 'markdown',
  CodeBlock = 'codeBlock',
  ToolInvocation = 'toolInvocation',
  Progress = 'progress',
  Thinking = 'thinking',
  Reference = 'reference',
  Warning = 'warning',
  Confirmation = 'confirmation',
  EditProposal = 'editProposal',
  EditBatch = 'editBatch',
}

export interface IChatMarkdownContent {
  readonly kind: ChatContentPartKind.Markdown;
  content: string;
  /** Citation map: source index → { uri, label } for rendering [N] badges. */
  citations?: Array<{ index: number; uri: string; label: string }>;
}

export interface IChatCodeBlockContent {
  readonly kind: ChatContentPartKind.CodeBlock;
  readonly code: string;
  readonly language?: string;
}

/** Status of a tool invocation lifecycle. */
export type ToolInvocationStatus = 'pending' | 'running' | 'completed' | 'rejected';

export interface IChatToolInvocationContent {
  readonly kind: ChatContentPartKind.ToolInvocation;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  status: ToolInvocationStatus;
  isConfirmed?: boolean;
  isComplete?: boolean;
  isError?: boolean;
  result?: IToolResult;
  toolSpecificData?: unknown;
}

export interface IChatProgressContent {
  readonly kind: ChatContentPartKind.Progress;
  readonly message: string;
}

export interface IChatThinkingContent {
  readonly kind: ChatContentPartKind.Thinking;
  content: string;
  isCollapsed: boolean;
  /** Ephemeral status message shown while context is being gathered. */
  progressMessage?: string;
  /** Source references gathered during retrieval. */
  references?: Array<{ uri: string; label: string; index?: number }>;
}

export interface IChatReferenceContent {
  readonly kind: ChatContentPartKind.Reference;
  readonly uri: string;
  readonly label: string;
}

export interface IChatWarningContent {
  readonly kind: ChatContentPartKind.Warning;
  readonly message: string;
}

export interface IChatConfirmationContent {
  readonly kind: ChatContentPartKind.Confirmation;
  readonly message: string;
  readonly data: unknown;
  /** @deprecated Use `grantDecision` for the new 3-tier flow. */
  isAccepted?: boolean;

  // ── M11 Task 2.1 — 3-tier permission grant ──

  /** The tool name this confirmation is for (if any). */
  readonly toolName?: string;
  /** A brief description of what the tool does. */
  readonly toolDescription?: string;
  /** The arguments being passed to the tool. */
  readonly toolArgs?: Record<string, unknown>;
  /** Resolved grant decision (set when user clicks a button). */
  grantDecision?: ToolGrantDecision;
  /**
   * Callback invoked when the user picks a grant option.
   * This resolves the pending `confirmToolInvocation()` promise.
   */
  onGrant?: (decision: ToolGrantDecision) => void;
}

/** Status of an edit proposal lifecycle. */
export type EditProposalStatus = 'pending' | 'accepted' | 'rejected';

/** Edit operation type. */
export type EditProposalOperation = 'insert' | 'update' | 'delete';

/**
 * A single edit proposal — one block-level change proposed by the model.
 *
 * VS Code reference: IChatTextEditGroup (model/chatModel.ts) — adapted from
 * file-level text edits to canvas block-level edits.
 */
export interface IChatEditProposalContent {
  readonly kind: ChatContentPartKind.EditProposal;
  /** Target page UUID. */
  readonly pageId: string;
  /** Target block UUID (omit for page-level operations like insert). */
  readonly blockId?: string;
  /** Edit operation. */
  readonly operation: EditProposalOperation;
  /** Original content before the edit (for update/delete). */
  readonly before?: string;
  /** Proposed new content (for insert/update). */
  readonly after: string;
  /** Current status of this proposal. */
  status: EditProposalStatus;
}

/**
 * A batch of edit proposals with a shared explanation.
 * Enables group accept/reject across multiple edits in one response.
 *
 * VS Code reference: chatEditing/ orchestration — multi-file edit groups.
 */
export interface IChatEditBatchContent {
  readonly kind: ChatContentPartKind.EditBatch;
  /** Model's explanation of the proposed changes. */
  readonly explanation: string;
  /** Ordered list of individual edit proposals. */
  readonly proposals: IChatEditProposalContent[];
}

/**
 * Discriminated union of all content part types.
 * Use `part.kind` for exhaustive switch checking.
 */
export type IChatContentPart =
  | IChatMarkdownContent
  | IChatCodeBlockContent
  | IChatToolInvocationContent
  | IChatProgressContent
  | IChatThinkingContent
  | IChatReferenceContent
  | IChatWarningContent
  | IChatConfirmationContent
  | IChatEditProposalContent
  | IChatEditBatchContent;

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Participant & Tool Types (Task 0.3)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A slash command contributed by a participant.
 */
export interface IChatCommand {
  /** Command name (without leading slash). */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
}

/**
 * Descriptor for a registered chat participant (agent).
 *
 * Service-layer uses "agent"; API layer uses "participant".
 * VS Code reference: IChatAgent (chatAgents.ts)
 */
export interface IChatParticipant {
  /** Unique participant ID (e.g. 'parallx.chat.default', 'parallx.chat.workspace'). */
  readonly id: string;
  /** Display name shown in the UI (e.g. 'Chat', '@workspace'). */
  readonly displayName: string;
  /** Short description of what this participant does. */
  readonly description: string;
  /** Optional icon path or emoji. */
  readonly iconPath?: string;
  /** Slash commands this participant supports. */
  readonly commands: readonly IChatCommand[];
  /** The handler function that processes requests. */
  readonly handler: IChatParticipantHandler;
  /** Optional follow-up suggestion provider, called after handler completes. */
  readonly provideFollowups?: IChatFollowupProvider;
}

/**
 * Handler function signature for a chat participant.
 *
 * Mirrors VS Code: `(request, context, response, token) => Promise<result>`
 * VS Code reference: IChatAgentImplementation.invoke()
 */
export type IChatParticipantHandler = (
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
) => Promise<IChatParticipantResult>;

/**
 * The parsed request passed to a participant handler.
 *
 * VS Code reference: IChatAgentRequest
 */
export interface IChatParticipantRequest {
  /** User's message text (after extracting @mention and /command). */
  readonly text: string;
  /** Unique request ID (UUID for cancellation/retry tracking). */
  readonly requestId: string;
  /** Slash command invoked (e.g. 'search'), or undefined. */
  readonly command?: string;
  /** Variable references from the message. */
  readonly variables?: readonly IChatVariable[];
  /** Files attached as explicit context by the user. */
  readonly attachments?: readonly IChatAttachment[];
  /** Current chat mode. */
  readonly mode: ChatMode;
  /** Active model ID. */
  readonly modelId: string;
  /** Retry attempt count (0 = first attempt). */
  readonly attempt: number;
}

/**
 * Context passed to a participant handler — conversation history.
 *
 * VS Code reference: IChatAgentHistoryEntry[]
 */
export interface IChatParticipantContext {
  /** The session ID this request belongs to. */
  readonly sessionId: string;
  /** Previous request/response pairs in this session. */
  readonly history: readonly IChatRequestResponsePair[];
}

/**
 * Response stream interface — the participant writes to this to build the response.
 *
 * Each method creates/updates a content part in the active response.
 * VS Code reference: ChatResponseStream (extHostTypes.ts)
 */
export interface IChatResponseStream {
  /** Append markdown text. Adjacent markdown calls are merged. */
  markdown(content: string): void;
  /** Append a code block. */
  codeBlock(code: string, language?: string): void;
  /** Show a progress indicator. */
  progress(message: string): void;
  /** Append a clickable reference. */
  reference(uri: string, label: string, index?: number): void;
  /** Append thinking/reasoning content. */
  thinking(content: string): void;
  /** Append a warning message. */
  warning(message: string): void;
  /** Append a button (rendered as a command link). */
  button(label: string, commandId: string, ...args: unknown[]): void;
  /** Append a confirmation prompt for a tool action. */
  confirmation(message: string, data: unknown): void;
  /** Begin a tool invocation (creates a pending tool card). */
  beginToolInvocation(toolCallId: string, toolName: string, data?: unknown): void;
  /** Update an in-progress tool invocation. */
  updateToolInvocation(toolCallId: string, data: Partial<IChatToolInvocationContent>): void;
  /** Append a single edit proposal. */
  editProposal(pageId: string, operation: EditProposalOperation, after: string, options?: { blockId?: string; before?: string }): void;
  /** Append a batch of edit proposals with an explanation. */
  editBatch(explanation: string, proposals: IChatEditProposalContent[]): void;
  /** Push a raw content part. */
  push(part: IChatContentPart): void;
  /**
   * Replace the content of the most recent Markdown part.
   * Used when text-based tool calls are detected post-streaming — the
   * raw JSON needs to be stripped from the already-rendered markdown.
   */
  replaceLastMarkdown(content: string): void;
  /**
   * Guard: throws Error('Stream is closed') if the response has been
   * finalized or cancelled. Prevents writing after completion.
   */
  throwIfDone(): void;
  /** Report actual token usage from the LLM response (Ollama eval counts). */
  reportTokenUsage(promptTokens: number, completionTokens: number): void;
  /** Attach a citation map to all existing Markdown parts so the renderer can resolve [N] markers. */
  setCitations(citations: Array<{ index: number; uri: string; label: string }>): void;
  /** Return the concatenated text of all Markdown parts in the response. */
  getMarkdownText(): string;
}

/**
 * Result returned by a participant handler.
 *
 * VS Code reference: IChatAgentResult
 */
export interface IChatParticipantResult {
  /** Error details if the request failed. */
  readonly errorDetails?: {
    readonly message: string;
    readonly responseIsIncomplete?: boolean;
    readonly responseIsFiltered?: boolean;
  };
  /** Opaque metadata attached to the result. */
  readonly metadata?: unknown;
}

/**
 * A follow-up suggestion shown as a clickable chip below a response.
 *
 * VS Code reference: IChatFollowup (chatService.ts)
 */
export interface IChatFollowup {
  /** Prompt text to send when the chip is clicked. */
  readonly message: string;
  /** Short display label for the chip (defaults to `message` if omitted). */
  readonly label?: string;
  /** Tooltip shown on hover. */
  readonly tooltip?: string;
}

/**
 * Provider function that returns follow-up suggestions after a response completes.
 *
 * VS Code reference: IChatAgentImplementation.provideFollowups()
 */
export type IChatFollowupProvider = (
  result: IChatParticipantResult,
  context: IChatParticipantContext,
  token: ICancellationToken,
) => Promise<readonly IChatFollowup[]>;

/**
 * Cancellation token for aborting in-flight requests.
 */
export interface ICancellationToken {
  /** Whether cancellation has been requested. */
  readonly isCancellationRequested: boolean;
  /** Event that fires when cancellation is requested. */
  readonly onCancellationRequested: Event<void>;
  /**
   * Whether a yield has been requested (soft interrupt).
   * Participants should check this at natural break points (between tool
   * iterations) and wrap up early when true, allowing the next queued
   * message to be processed without a hard cancel.
   */
  readonly isYieldRequested?: boolean;
}

// ── Tool Types ──

/**
 * JSON Schema definition for a tool's parameters.
 */
export interface IToolDefinition {
  /** Tool function name (e.g. 'search_workspace'). */
  readonly name: string;
  /** Human-readable description for the model. */
  readonly description: string;
  /** JSON Schema object describing the parameters. */
  readonly parameters: Record<string, unknown>;
}

/**
 * A tool call from the model (in an assistant message).
 *
 * Maps to Ollama's `message.tool_calls[]` items.
 */
export interface IToolCall {
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

/**
 * Result returned by a tool execution.
 */
export interface IToolResult {
  /** Tool output content (text). */
  readonly content: string;
  /** Whether the tool execution failed. */
  readonly isError?: boolean;
}

// ── Permission Model (M11 Task 2.1) ──

/**
 * 3-tier permission level for tool execution.
 *
 * - `always-allowed`: Auto-approved, no confirmation needed (read-only tools).
 * - `requires-approval`: User must approve before each execution (default for write tools).
 * - `never-allowed`: Tool is blocked entirely (user can disable dangerous tools).
 */
export type ToolPermissionLevel = 'always-allowed' | 'requires-approval' | 'never-allowed';

/**
 * Grant decision returned from the confirmation UI.
 *
 * - `allow-once`: Approve this single invocation.
 * - `allow-session`: Approve for the rest of this session.
 * - `always-allow`: Persist as always-allowed (updates permissions.json).
 * - `reject`: Deny execution.
 */
export type ToolGrantDecision = 'allow-once' | 'allow-session' | 'always-allow' | 'reject';

/**
 * A registered chat tool — definition + handler.
 *
 * VS Code reference: IToolData + handler (languageModelToolsService.ts)
 */
export interface IChatTool {
  /** Tool name (unique identifier). */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** JSON Schema for parameters. */
  readonly parameters: Record<string, unknown>;
  /** Execution handler. */
  readonly handler: (args: Record<string, unknown>, token: ICancellationToken) => Promise<IToolResult>;
  /** Whether this tool requires user confirmation before execution. @deprecated Use permissionLevel. */
  readonly requiresConfirmation: boolean;
  /** 3-tier permission level (M11 Task 2.1). Defaults to 'always-allowed' if not set. */
  readonly permissionLevel?: ToolPermissionLevel;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Service Interfaces & DI Identifiers (Task 0.4)
// ═══════════════════════════════════════════════════════════════════════════════

// ── ILanguageModelProvider (NOT a DI service — registered with ILanguageModelsService) ──

/**
 * Interface that language model backends must implement.
 * Ollama is the first (and initially only) provider.
 *
 * VS Code reference: language model registration in languageModels.ts
 */
export interface ILanguageModelProvider {
  /** Unique provider identifier (e.g. 'ollama'). */
  readonly id: string;
  /** Human-readable display name (e.g. 'Ollama'). */
  readonly displayName: string;
  /** List available models. */
  listModels(): Promise<readonly ILanguageModelInfo[]>;
  /** Check if the backend is reachable. */
  checkAvailability(): Promise<IProviderStatus>;
  /** Send a chat completion request (streaming). */
  sendChatRequest(
    modelId: string,
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  /** Get detailed model info. */
  getModelInfo(modelId: string): Promise<ILanguageModelInfo>;
}

// ── ILanguageModelsService ──

/**
 * Manages language model providers, model enumeration, and request delegation.
 *
 * VS Code reference: ILanguageModelsService (languageModels.ts)
 */
export interface ILanguageModelsService extends IDisposable {
  /** Fires when providers are added/removed. */
  readonly onDidChangeProviders: Event<void>;
  /** Fires when the available model list or active model changes. */
  readonly onDidChangeModels: Event<void>;
  /** Register a language model provider. */
  registerProvider(provider: ILanguageModelProvider): IDisposable;
  /** Get all registered providers. */
  getProviders(): readonly ILanguageModelProvider[];
  /** Get all available models across all providers. */
  getModels(): Promise<readonly ILanguageModelInfo[]>;
  /** Get the user's currently selected model ID. */
  getActiveModel(): string | undefined;
  /** Set the user's active model. */
  setActiveModel(modelId: string): void;
  /** Delegate a chat request to the appropriate provider. */
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  /** Check provider availability. */
  checkStatus(): Promise<IProviderStatus>;
}

export const ILanguageModelsService = createServiceIdentifier<ILanguageModelsService>('ILanguageModelsService');

// ── IChatService ──

/**
 * Session lifecycle and request orchestration.
 *
 * VS Code reference: IChatService (chatService/chatService.ts)
 */
export interface IChatService extends IDisposable {
  /** Fires when a new session is created. */
  readonly onDidCreateSession: Event<IChatSession>;
  /** Fires when a session is deleted. */
  readonly onDidDeleteSession: Event<string>;
  /** Fires when a session's data changes (new message, response update). */
  readonly onDidChangeSession: Event<string>;
  /** Create a new chat session. */
  createSession(mode?: ChatMode, modelId?: string): IChatSession;
  /** Delete a session by ID. */
  deleteSession(sessionId: string): void;
  /** Get a session by ID. */
  getSession(sessionId: string): IChatSession | undefined;
  /** Get all sessions. */
  getSessions(): readonly IChatSession[];
  /** Restore persisted sessions from database. Called once on startup. */
  restoreSessions(): Promise<void>;
  /** Late-bind a database for persistence (called after DB opens in Phase 5).
   * @param workspaceId — the active workspace ID for session scoping */
  setDatabase(database: import('./chatSessionPersistence.js').IChatPersistenceDatabase, workspaceId?: string): void;
  /** Late-bind a session manager for stale session detection (M14 Phase 2). */
  setSessionManager(sessionManager: import('./serviceTypes.js').ISessionManager): void;
  /** Send a user message and orchestrate the full request pipeline. */
  sendRequest(sessionId: string, message: string, options?: IChatSendRequestOptions): Promise<IChatParticipantResult>;
  /** Cancel the in-progress request for a session. */
  cancelRequest(sessionId: string): void;
  /**
   * Hard-reset for workspace switch.
   * Cancels active requests, clears in-memory sessions,
   * and re-restores from the (now new-workspace) database.
   */
  resetForWorkspaceSwitch(): Promise<void>;

  // ── Pending Request Queue ──

  /** Queue a message to be sent after the in-progress request finishes. */
  queueRequest(sessionId: string, message: string, kind: ChatRequestQueueKind, options?: IChatSendRequestOptions): IChatPendingRequest;
  /** Remove a pending request from the queue (e.g. user clicked X). */
  removePendingRequest(sessionId: string, requestId: string): void;
  /**
   * Signal the active request to yield early so the next pending
   * request can be processed.  The participant checks this flag
   * at natural break points (between tool iterations, etc.).
   */
  requestYield(sessionId: string): void;
  /** Fires when pending requests change (added, removed, processed). */
  readonly onDidChangePendingRequests: Event<string>;
}

/**
 * Options for IChatService.sendRequest().
 *
 * VS Code reference: IChatSendRequestOptions
 */
export interface IChatSendRequestOptions {
  /** Override the participant to route to. */
  readonly participantId?: string;
  /** Override the slash command. */
  readonly command?: string;
  /** Disable automatic @mention detection. */
  readonly noCommandDetection?: boolean;
  /** Files attached as explicit context. */
  readonly attachments?: readonly IChatAttachment[];
}

export const IChatService = createServiceIdentifier<IChatService>('IChatService');

// ── IChatAgentService ──

/**
 * Participant (agent) registry and request dispatch.
 *
 * VS Code reference: IChatAgentService (chatAgents.ts)
 */
export interface IChatAgentService extends IDisposable {
  /** Fires when participants are added/removed. */
  readonly onDidChangeAgents: Event<void>;
  /** Register a chat participant. */
  registerAgent(participant: IChatParticipant): IDisposable;
  /** Get all registered participants. */
  getAgents(): readonly IChatParticipant[];
  /** Get a participant by ID. */
  getAgent(id: string): IChatParticipant | undefined;
  /** Get the default participant (handles messages with no @mention). */
  getDefaultAgent(): IChatParticipant | undefined;
  /** Invoke a participant's handler. */
  invokeAgent(
    participantId: string,
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult>;
}

export const IChatAgentService = createServiceIdentifier<IChatAgentService>('IChatAgentService');

// ── IChatModeService ──

/**
 * Mode state management (Ask / Edit / Agent).
 *
 * VS Code reference: IChatModeService (chatModes.ts)
 */
export interface IChatModeService extends IDisposable {
  /** Fires when the current mode changes. */
  readonly onDidChangeMode: Event<ChatMode>;
  /** Get the current mode. */
  getMode(): ChatMode;
  /** Set the current mode. */
  setMode(mode: ChatMode): void;
  /** Get all available modes. */
  getAvailableModes(): readonly ChatMode[];
}

export const IChatModeService = createServiceIdentifier<IChatModeService>('IChatModeService');

// ── IChatWidgetService ──

/**
 * Tracks active chat widget instances.
 *
 * VS Code reference: IChatWidgetService (chat.ts)
 */
export interface IChatWidgetService extends IDisposable {
  /** Fires when a widget is added. */
  readonly onDidAddWidget: Event<IChatWidgetDescriptor>;
  /** Fires when a widget is removed. */
  readonly onDidRemoveWidget: Event<string>;
  /** Register a chat widget. */
  registerWidget(widget: IChatWidgetDescriptor): IDisposable;
  /** Get the widget showing a specific session. */
  getWidget(sessionId: string): IChatWidgetDescriptor | undefined;
  /** Get all registered widgets. */
  getWidgets(): readonly IChatWidgetDescriptor[];
}

/**
 * Descriptor for a registered chat widget instance.
 */
export interface IChatWidgetDescriptor {
  /** Unique widget instance ID. */
  readonly id: string;
  /** Session ID this widget is currently showing. */
  readonly sessionId: string;
  /** Focus the widget's input. */
  focus(): void;
  /** Layout the widget. */
  layout(width: number, height: number): void;
}

export const IChatWidgetService = createServiceIdentifier<IChatWidgetService>('IChatWidgetService');

// ── ILanguageModelToolsService ──

/**
 * Tool registry, invocation, and confirmation gates.
 *
 * VS Code reference: ILanguageModelToolsService (tools/languageModelToolsService.ts)
 * Note: VS Code has a separate ILanguageModelToolsConfirmationService;
 * Parallx folds confirmation logic into this service.
 */
export interface ILanguageModelToolsService extends IDisposable {
  /** Fires when tools are added/removed or enablement changes. */
  readonly onDidChangeTools: Event<void>;
  /** Register a chat tool. */
  registerTool(tool: IChatTool): IDisposable;
  /** Get all registered tools (regardless of enablement). */
  getTools(): readonly IChatTool[];
  /** Get a tool by name. */
  getTool(name: string): IChatTool | undefined;
  /** Get tool definitions formatted for the Ollama tools[] array (only enabled tools). */
  getToolDefinitions(): readonly IToolDefinition[];
  /** Get read-only tool definitions (no requiresConfirmation tools). For Ask mode. */
  getReadOnlyToolDefinitions(): readonly IToolDefinition[];
  /** Invoke a tool with confirmation gate. */
  invokeTool(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult>;
  /** Check if a tool is enabled. All tools are enabled by default. */
  isToolEnabled(name: string): boolean;
  /** Enable or disable a tool by name. */
  setToolEnabled(name: string, enabled: boolean): void;
  /** Get the count of enabled tools. */
  getEnabledCount(): number;
}

export const ILanguageModelToolsService = createServiceIdentifier<ILanguageModelToolsService>('ILanguageModelToolsService');
