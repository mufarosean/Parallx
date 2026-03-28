import type { Event } from '../platform/events.js';
import type {
  ChatMode,
  ICancellationToken,
  IChatMessage,
  IChatRequestOptions,
  IChatRequestResponsePair,
  IChatResponseChunk,
  IChatSendRequestOptions,
  IChatSession,
  IContextPill,
  IToolDefinition,
  IToolResult,
  ToolPermissionLevel,
} from '../services/chatTypes.js';
import type { AgentApprovalResolution } from '../agent/agentTypes.js';
import type { IUnifiedAIConfigService } from '../aiSettings/unifiedConfigTypes.js';
import type { ISessionManager } from '../services/serviceTypes.js';
import type { IAgentRegistry } from './agents/openclawAgentRegistry.js';

// ── Shared runtime types (canonical source: services/chatRuntimeTypes.ts) ──
export type {
  ChatRuntimeKind,
  ChatRuntimeRunState,
  ChatRuntimeApprovalState,
  IPageSummary,
  IBlockSummary,
  IPageStructure,
  IOpenclawBootstrapDebugFile,
  IOpenclawBootstrapDebugReport,
  IOpenclawSkillCatalogReportEntry,
  IOpenclawSkillPromptEntry,
  IOpenclawToolPromptEntry,
  IOpenclawSystemPromptReport,
  IChatRuntimeToolMetadata,
  IChatRuntimeToolInvocationObserver,
  IChatRuntimeAutonomyMirror,
  IChatRuntimeMemoryCheckpoint,
  IChatSlashCommand,
  IParsedSlashCommand,
  IChatParticipantRuntime,
  IChatAgentTaskViewModel,
} from '../services/chatRuntimeTypes.js';

import type {
  ChatRuntimeKind,
  ChatRuntimeRunState,
  ChatRuntimeApprovalState,
  IPageSummary,
  IPageStructure,
  IOpenclawBootstrapDebugReport,
  IOpenclawSystemPromptReport,
  IChatRuntimeToolInvocationObserver,
  IChatRuntimeAutonomyMirror,
  IChatSlashCommand,
  IParsedSlashCommand,
  IChatAgentTaskViewModel,
} from '../services/chatRuntimeTypes.js';

// ── OpenClaw-only types ──

export type WorkflowType =
  | 'generic-grounded'
  | 'scoped-topic'
  | 'folder-summary'
  | 'document-summary'
  | 'comparative'
  | 'exhaustive-extraction'
  | 'mixed';


export interface IRetrievalPlan {
  readonly intent: 'question' | 'situation' | 'task' | 'exploration' | string;
  readonly reasoning: string;
  readonly needsRetrieval: boolean;
  readonly queries: readonly string[];
  readonly coverageMode?: 'representative' | 'exhaustive' | 'enumeration';
}

export interface IQueryScope {
  readonly level: 'workspace' | 'folder' | 'document' | 'selection' | string;
  readonly pathPrefixes?: readonly string[];
  readonly documentIds?: readonly string[];
  readonly derivedFrom: 'explicit-mention' | 'inferred' | 'contextual' | string;
  readonly confidence: number;
  readonly resolvedEntities?: readonly unknown[];
}

export interface IChatTurnRoute {
  readonly kind: 'memory-recall' | 'transcript-recall' | 'grounded' | string;
  readonly reason: string;
  readonly directAnswer?: string;
  readonly coverageMode?: 'representative' | 'exhaustive' | 'enumeration';
  readonly workflowType?: WorkflowType | string;
}

export interface IChatContextPlan {
  readonly route: IChatTurnRoute['kind'];
  readonly intent: IRetrievalPlan['intent'];
  readonly useRetrieval: boolean;
  readonly useMemoryRecall: boolean;
  readonly useTranscriptRecall: boolean;
  readonly useConceptRecall: boolean;
  readonly useCurrentPage: boolean;
  readonly citationMode: 'required' | 'disabled';
  readonly reasoning: string;
  readonly retrievalPlan: IRetrievalPlan;
}

export interface IChatRuntimeTrace {
  readonly route: IChatTurnRoute;
  readonly contextPlan: IChatContextPlan;
  readonly queryScope?: IQueryScope;
  readonly routeAuthority?: unknown;
  readonly sessionId?: string;
  readonly hasActiveSlashCommand: boolean;
  readonly isRagReady: boolean;
  readonly runtime?: ChatRuntimeKind;
  readonly runId?: string;
  readonly phase?: 'interpretation' | 'context' | 'execution';
  readonly checkpoint?: string;
  readonly runState?: ChatRuntimeRunState;
  readonly toolName?: string;
  readonly approvalState?: ChatRuntimeApprovalState;
  readonly note?: string;
}




export interface IOpenclawCommandRegistryFacade {
  readonly parseSlashCommand: (text: string) => IParsedSlashCommand;
  readonly applyCommandTemplate: (command: IChatSlashCommand, input: string, contextContent: string) => string | undefined;
  readonly registerCommand?: (command: IChatSlashCommand) => { dispose(): void };
  readonly getRegisteredCommands?: () => readonly IChatSlashCommand[];
}

export interface IOpenclawRuntimeLifecycle {
  queueMemoryWriteBack(
    deps: {
      extractPreferences?: (text: string) => Promise<void>;
      storeSessionMemory?: (sessionId: string, summary: string, messageCount: number) => Promise<void>;
      storeConceptsFromSession?: (concepts: Array<{ concept: string; category: string; summary: string; struggled: boolean }>, sessionId: string) => Promise<void>;
      isSessionEligibleForSummary?: (messageCount: number) => boolean;
      getSessionMemoryMessageCount?: (sessionId: string) => Promise<number | null>;
      sendSummarizationRequest?: (messages: readonly IChatMessage[], signal?: AbortSignal) => AsyncIterable<IChatResponseChunk>;
      buildFallbackSessionSummary: (history: readonly { request: { text: string } }[], currentRequestText: string) => string;
    },
    options: {
      memoryEnabled: boolean;
      requestText: string;
      sessionId: string;
      history: readonly IChatRequestResponsePair[];
    },
  ): void;
  recordCompleted(note?: string): void;
  recordAborted(note?: string): void;
  recordFailed(note?: string): void;
}

export interface IUserCommandFileSystem {
  listCommandFiles(): Promise<string[]>;
  readCommandFile(relativePath: string): Promise<string>;
}

export interface ISkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly location?: string;
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly permissionLevel?: ToolPermissionLevel;
  readonly parameters?: readonly {
    readonly name: string;
    readonly type: string;
    readonly description: string;
    readonly required: boolean;
  }[];
  readonly body?: string;
}

export interface IDefaultParticipantServices {
  sendChatRequest(messages: readonly IChatMessage[], options?: IChatRequestOptions, signal?: AbortSignal): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  getWorkspaceName(): string;
  getPageCount(): Promise<number>;
  getCurrentPageTitle(): string | undefined;
  getToolDefinitions(): readonly IToolDefinition[];
  getReadOnlyToolDefinitions(): readonly IToolDefinition[];
  invokeToolWithRuntimeControl?(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: IChatRuntimeToolInvocationObserver,
  ): Promise<IToolResult>;
  maxIterations?: number;
  networkTimeout?: number;
  getModelContextLength?(): number;
  sendSummarizationRequest?(messages: readonly IChatMessage[], signal?: AbortSignal): AsyncIterable<IChatResponseChunk>;
  getFileCount?(): Promise<number>;
  isRAGAvailable?(): boolean;
  isIndexing?(): boolean;
  readFileContent?(fullPath: string): Promise<string>;
  getCurrentPageContent?(): Promise<{ title: string; pageId: string; textContent: string } | undefined>;
  retrieveContext?(query: string, pathPrefixes?: string[]): Promise<{ text: string; sources: Array<{ uri: string; label: string; index: number }> } | undefined>;
  recallMemories?(query: string, sessionId?: string): Promise<string | undefined>;
  recallTranscripts?(query: string): Promise<string | undefined>;
  storeSessionMemory?(sessionId: string, summary: string, messageCount: number): Promise<void>;
  storeConceptsFromSession?(concepts: Array<{ concept: string; category: string; summary: string; struggled: boolean }>, sessionId: string): Promise<void>;
  recallConcepts?(query: string): Promise<string | undefined>;
  isSessionEligibleForSummary?(messageCount: number): boolean;
  hasSessionMemory?(sessionId: string): Promise<boolean>;
  getSessionMemoryMessageCount?(sessionId: string): Promise<number | null>;
  extractPreferences?(text: string): Promise<void>;
  getPreferencesForPrompt?(): Promise<string | undefined>;
  getPromptOverlay?(activeFilePath?: string): Promise<string | undefined>;
  listFilesRelative?(relativePath: string): Promise<{ name: string; type: 'file' | 'directory' }[]>;
  readFileRelative?(relativePath: string): Promise<string | null>;
  writeFileRelative?(relativePath: string, content: string): Promise<void>;
  existsRelative?(relativePath: string): Promise<boolean>;
  invalidatePromptFiles?(): void;
  reportContextPills?(pills: IContextPill[]): void;
  reportRetrievalDebug?(debug: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  }): void;
  reportResponseDebug?(debug: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  }): void;
  reportRuntimeTrace?(trace: IChatRuntimeTrace): void;
  reportBootstrapDebug?(debug: IOpenclawBootstrapDebugReport): void;
  reportSystemPromptReport?(report: IOpenclawSystemPromptReport): void;
  reportBudget?(slots: ReadonlyArray<{ label: string; used: number; allocated: number; color: string }>): void;
  listFolderFiles?(folderPath: string): Promise<Array<{ relativePath: string; content: string }>>;
  getTerminalOutput?(): Promise<string | undefined>;
  userCommandFileSystem?: IUserCommandFileSystem;
  compactSession?(sessionId: string, summaryText: string): void;
  getExcludedContextIds?(): ReadonlySet<string>;
  getWorkspaceDigest?(): Promise<string | undefined>;
  getLastSystemPromptReport?(): IOpenclawSystemPromptReport | undefined;
  sessionManager?: ISessionManager;
  unifiedConfigService?: IUnifiedAIConfigService;
  createAutonomyMirror?(input: { sessionId: string; requestText: string; mode: ChatMode; runtime: 'claw' | 'openclaw' }): Promise<IChatRuntimeAutonomyMirror | undefined>;
  getSkillCatalog?(): ISkillCatalogEntry[];
  getToolPermissions?(): Record<string, ToolPermissionLevel>;
  /** Get IDs of all available models (for model fallback). */
  getAvailableModelIds?(): Promise<readonly string[]>;
  /** Build a sendChatRequest function targeting a specific model (for model fallback). */
  sendChatRequestForModel?(modelId: string): (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  /** D8: Agent registry for per-agent configuration. */
  agentRegistry?: IAgentRegistry;
  /** D2: List available models from provider (for /models command). */
  listModels?(): Promise<readonly { id: string; name: string; parameterSize?: string; quantization?: string; contextLength?: number }[]>;
  /** D2: Check provider connection status (for /status, /doctor commands). */
  checkProviderStatus?(): Promise<{ available: boolean; version?: string; error?: string }>;
  /** D2: Session-scoped flags for /think, /verbose toggles. */
  getSessionFlag?(key: string): boolean;
  /** D2: Set a session-scoped flag. */
  setSessionFlag?(key: string, value: boolean): void;
  /** D2: Execute a UI command by ID (for /new → chat.newSession bridge). */
  executeCommand?(commandId: string, ...args: unknown[]): void;
  /** D3: Diagnostics service for /doctor delegation. */
  diagnosticsService?: import('../services/serviceTypes.js').IDiagnosticsService;
  /** D7: Observability service for turn metric recording. */
  observabilityService?: import('../services/serviceTypes.js').IObservabilityService;
  /** D4: Runtime hook registry for tool and message observers. */
  runtimeHookRegistry?: import('../services/serviceTypes.js').IRuntimeHookRegistry;
}

export interface IWorkspaceParticipantServices {
  sendChatRequest(messages: readonly IChatMessage[], options?: IChatRequestOptions, signal?: AbortSignal): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  listPages(): Promise<readonly IPageSummary[]>;
  searchPages(query: string): Promise<readonly IPageSummary[]>;
  getPageContent(pageId: string): Promise<string | null>;
  getPageTitle(pageId: string): Promise<string | null>;
  getWorkspaceName(): string;
  getReadOnlyToolDefinitions?(): readonly IToolDefinition[];
  invokeToolWithRuntimeControl?(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: IChatRuntimeToolInvocationObserver,
  ): Promise<IToolResult>;
  listFiles?(relativePath: string): Promise<readonly { name: string; type: 'file' | 'directory'; size: number }[]>;
  readFileContent?(relativePath: string): Promise<string>;
  reportParticipantDebug?(debug: {
    surface: 'workspace' | 'canvas';
    usedSharedTurnState: boolean;
    attachmentCount: number;
    fileAttachmentCount: number;
    imageAttachmentCount: number;
    queryScopeLevel?: string;
  }): void;
  reportRetrievalDebug?(debug: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  }): void;
  reportRuntimeTrace?(trace: IChatRuntimeTrace): void;
  reportBootstrapDebug?(debug: IOpenclawBootstrapDebugReport): void;
  unifiedConfigService?: IUnifiedAIConfigService;
  /** D8: Agent registry for per-agent configuration. */
  agentRegistry?: IAgentRegistry;
  /** D7: Observability service for turn metric recording. */
  observabilityService?: import('../services/serviceTypes.js').IObservabilityService;
  /** D4: Runtime hook registry for tool and message observers. */
  runtimeHookRegistry?: import('../services/serviceTypes.js').IRuntimeHookRegistry;
}

export interface ICanvasParticipantServices {
  sendChatRequest(messages: readonly IChatMessage[], options?: IChatRequestOptions, signal?: AbortSignal): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  getCurrentPageId(): string | undefined;
  getCurrentPageTitle(): string | undefined;
  getPageStructure(pageId: string): Promise<IPageStructure | null>;
  getWorkspaceName(): string;
  getReadOnlyToolDefinitions?(): readonly IToolDefinition[];
  invokeToolWithRuntimeControl?(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: IChatRuntimeToolInvocationObserver,
  ): Promise<IToolResult>;
  readFileContent?(relativePath: string): Promise<string>;
  reportParticipantDebug?(debug: {
    surface: 'workspace' | 'canvas';
    usedSharedTurnState: boolean;
    attachmentCount: number;
    fileAttachmentCount: number;
    imageAttachmentCount: number;
    queryScopeLevel?: string;
  }): void;
  reportRetrievalDebug?(debug: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  }): void;
  reportRuntimeTrace?(trace: IChatRuntimeTrace): void;
  reportBootstrapDebug?(debug: IOpenclawBootstrapDebugReport): void;
  unifiedConfigService?: IUnifiedAIConfigService;
  /** D8: Agent registry for per-agent configuration. */
  agentRegistry?: IAgentRegistry;
  /** D7: Observability service for turn metric recording. */
  observabilityService?: import('../services/serviceTypes.js').IObservabilityService;
  /** D4: Runtime hook registry for tool and message observers. */
  runtimeHookRegistry?: import('../services/serviceTypes.js').IRuntimeHookRegistry;
}


export interface IChatWidgetServices {
  readonly sendRequest: (sessionId: string, message: string, options?: IChatSendRequestOptions) => Promise<void>;
  readonly cancelRequest: (sessionId: string) => void;
  readonly createSession: () => IChatSession;
  readonly onDidChangeSession: Event<string>;
  readonly getProviderStatus: () => { available: boolean };
  readonly onDidChangeProviderStatus: Event<void>;
  readonly getAgentTasks?: () => readonly IChatAgentTaskViewModel[];
  readonly resolveAgentApproval?: (taskId: string, requestId: string, resolution: AgentApprovalResolution) => Promise<void>;
}