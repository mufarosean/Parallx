import type { Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type {
  ChatMode,
  ICancellationToken,
  IChatMessage,
  IChatParticipant,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatRequestOptions,
  IChatRequestResponsePair,
  IChatResponseChunk,
  IChatResponseStream,
  IChatSendRequestOptions,
  IChatSession,
  IContextPill,
  IToolDefinition,
  IToolResult,
} from '../services/chatTypes.js';
import type { AgentApprovalRequest, AgentApprovalResolution, AgentTaskDiagnostics, AgentTaskRecord } from '../agent/agentTypes.js';
import type { IUnifiedAIConfigService } from '../aiSettings/unifiedConfigTypes.js';
import type { ISessionManager } from '../services/serviceTypes.js';

export type ChatRuntimeKind = 'claw' | 'openclaw';
export type ChatRuntimeRunState = 'prepared' | 'executing' | 'awaiting-approval' | 'completed' | 'aborted' | 'failed';
export type ChatRuntimeApprovalState = 'not-required' | 'pending' | 'approved' | 'denied' | 'auto-approved';

export type WorkflowType =
  | 'generic-grounded'
  | 'scoped-topic'
  | 'folder-summary'
  | 'document-summary'
  | 'comparative'
  | 'exhaustive-extraction'
  | 'mixed';

export interface IPageSummary {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

export interface IBlockSummary {
  readonly id: string;
  readonly blockType: string;
  readonly parentBlockId: string | null;
  readonly sortOrder: number;
  readonly textPreview: string;
}

export interface IPageStructure {
  readonly pageId: string;
  readonly title: string;
  readonly icon?: string;
  readonly blocks: readonly IBlockSummary[];
}

export interface IRetrievalPlan {
  readonly intent: 'question' | 'situation' | 'task' | 'conversational' | 'exploration' | string;
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
  readonly kind: 'conversational' | 'memory-recall' | 'transcript-recall' | 'product-semantics' | 'off-topic' | 'grounded' | string;
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
  readonly semanticFallback?: unknown;
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

export interface IChatRuntimeToolMetadata {
  readonly name: string;
  readonly permissionLevel: import('../services/chatTypes.js').ToolPermissionLevel;
  readonly enabled: boolean;
  readonly requiresApproval: boolean;
  readonly autoApproved: boolean;
  readonly approvalSource: 'default' | 'session' | 'persistent' | 'global-auto' | 'missing-permission-service';
  readonly source?: 'built-in' | 'bridge';
  readonly ownerToolId?: string;
  readonly description?: string;
}

export interface IChatRuntimeToolInvocationObserver {
  onValidated?(metadata: IChatRuntimeToolMetadata): void;
  onApprovalRequested?(metadata: IChatRuntimeToolMetadata): void;
  onApprovalResolved?(metadata: IChatRuntimeToolMetadata, approved: boolean): void;
  onExecuted?(metadata: IChatRuntimeToolMetadata, result: IToolResult): void;
}

export interface IChatRuntimeAutonomyMirror {
  readonly taskId: string;
  begin(): Promise<void>;
  createToolObserver(
    toolName: string,
    args: Record<string, unknown>,
    downstream?: IChatRuntimeToolInvocationObserver,
  ): IChatRuntimeToolInvocationObserver;
  complete(note?: string): Promise<void>;
  fail(note?: string): Promise<void>;
  abort(note?: string): Promise<void>;
}

export interface IOpenclawBootstrapDebugFile {
  readonly name: string;
  readonly path: string;
  readonly missing: boolean;
  readonly rawChars: number;
  readonly injectedChars: number;
  readonly truncated: boolean;
  readonly causes: readonly ('per-file-limit' | 'total-limit')[];
}

export interface IOpenclawBootstrapDebugReport {
  readonly maxChars: number;
  readonly totalMaxChars: number;
  readonly totalRawChars: number;
  readonly totalInjectedChars: number;
  readonly files: readonly IOpenclawBootstrapDebugFile[];
  readonly warningLines: readonly string[];
}

export interface IOpenclawSkillPromptEntry {
  readonly name: string;
  readonly blockChars: number;
}

export interface IOpenclawToolPromptEntry {
  readonly name: string;
  readonly summaryChars: number;
  readonly schemaChars: number;
  readonly propertiesCount?: number;
}

export interface IOpenclawSystemPromptReport {
  readonly source: 'run' | 'estimate';
  readonly generatedAt: number;
  readonly workspaceName?: string;
  readonly bootstrapMaxChars: number;
  readonly bootstrapTotalMaxChars: number;
  readonly systemPrompt: {
    readonly chars: number;
    readonly projectContextChars: number;
    readonly nonProjectContextChars: number;
  };
  readonly injectedWorkspaceFiles: readonly IOpenclawBootstrapDebugFile[];
  readonly bootstrapWarningLines: readonly string[];
  readonly skills: {
    readonly promptChars: number;
    readonly entries: readonly IOpenclawSkillPromptEntry[];
  };
  readonly tools: {
    readonly listChars: number;
    readonly schemaChars: number;
    readonly entries: readonly IOpenclawToolPromptEntry[];
  };
  readonly promptProvenance?: {
    readonly rawUserInput: string;
    readonly parsedUserText: string;
    readonly contextQueryText: string;
    readonly participantId?: string;
    readonly command?: string;
    readonly attachmentCount: number;
    readonly historyTurns: number;
    readonly seedMessageCount: number;
    readonly modelMessageCount: number;
    readonly modelMessageRoles: readonly string[];
    readonly finalUserMessage: string;
  };
}

export interface IChatRuntimeMemoryCheckpoint {
  readonly checkpoint: string;
  readonly note?: string;
}

export interface IChatSlashCommand {
  readonly name: string;
  readonly description: string;
  readonly promptTemplate: string;
  readonly isBuiltIn: boolean;
  readonly specialHandler?: string;
}

export interface IParsedSlashCommand {
  readonly command: IChatSlashCommand | undefined;
  readonly commandName: string | undefined;
  readonly remainingText: string;
}

export interface IOpenclawCommandRegistryFacade {
  readonly parseSlashCommand: (text: string) => IParsedSlashCommand;
  readonly applyCommandTemplate: (command: IChatSlashCommand, input: string, contextContent: string) => string | undefined;
}

export interface IOpenclawResolvedTurn {
  readonly interpretation: { readonly rawText: string };
  readonly slashResult: IParsedSlashCommand;
  readonly effectiveText: string;
  readonly activeCommand?: string;
  readonly hasActiveSlashCommand: boolean;
  readonly handledEarlyAnswer: boolean;
  readonly userText: string;
  readonly contextQueryText: string;
  readonly isRagReady: boolean;
  readonly turnRoute: IChatTurnRoute;
  readonly contextPlan: IChatContextPlan;
  readonly retrievalPlan: IRetrievalPlan;
  readonly isConversationalTurn: boolean;
  readonly queryScope: IQueryScope;
  readonly semanticFallback?: unknown;
  readonly mentionPills: readonly IContextPill[];
  readonly mentionContextBlocks: readonly string[];
  readonly activatedSkill?: unknown;
}

export interface IOpenclawPreparedContext {
  readonly messages: readonly IChatMessage[];
  readonly turnRoute: IChatTurnRoute;
  readonly routeAuthority?: unknown;
  readonly contextPlan: IChatContextPlan;
  readonly contextParts: readonly string[];
  readonly ragSources: readonly { uri: string; label: string; index?: number }[];
  readonly retrievedContextText: string;
  readonly evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: readonly string[] };
  readonly memoryResult?: string;
  readonly coverageRecord?: unknown;
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
      buildDeterministicSessionSummary: (history: readonly { request: { text: string } }[], currentRequestText: string) => string;
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
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ISkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly kind: string;
  readonly tags: readonly string[];
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
  getWorkflowSkillCatalog?(): ISkillCatalogEntry[];
  getSkillManifest?(name: string): unknown;
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
    semanticFallbackKind?: string;
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
    semanticFallbackKind?: string;
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
}

export interface IChatParticipantRuntime {
  readonly kind: ChatRuntimeKind;
  handleTurn(
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult>;
}

export interface IChatAgentTaskViewModel {
  readonly task: AgentTaskRecord;
  readonly diagnostics?: AgentTaskDiagnostics;
  readonly pendingApprovals: readonly AgentApprovalRequest[];
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

export type IChatParticipantFactory = (services: IDefaultParticipantServices) => IChatParticipant & IDisposable;