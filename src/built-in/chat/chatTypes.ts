// chatTypes.ts — Centralized type definitions for the chat built-in (M13 Phase 1)
//
// Single source of truth for every interface and type alias exported by the
// chat subsystem.  Mirrors the canvas pattern (`canvasTypes.ts`).
//
// RULE: This file has ZERO intra-chat imports.  All external dependencies
// come from platform/, services/, or other top-level modules.

import type { Event } from '../../platform/events.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  IChatMessage,
  IChatSession,
  IChatSendRequestOptions,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  ICancellationToken,
  IToolResult,
  IContextPill,
  ILanguageModelInfo,
  IChatPendingRequest,
  ChatMode,
  IChatEditProposalContent,
} from '../../services/chatTypes.js';
import type {
  AgentApprovalRequest,
  AgentApprovalResolution,
  AgentTaskDiagnostics,
  AgentTaskRecord,
} from '../../agent/agentTypes.js';
import { ChatRequestQueueKind } from '../../services/chatTypes.js';
export { ChatRequestQueueKind } from '../../services/chatTypes.js';
export type { IChatPendingRequest } from '../../services/chatTypes.js';
import type { IDiffResult } from '../../services/diffService.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Participant Service Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Services injected into the default (agentic) participant. */
import type { ISessionManager } from '../../services/serviceTypes.js';
import type { IUnifiedAIConfigService } from '../../aiSettings/unifiedConfigTypes.js';

export interface IDefaultParticipantServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  getWorkspaceName(): string;
  getPageCount(): Promise<number>;
  getCurrentPageTitle(): string | undefined;
  getToolDefinitions(): readonly IToolDefinition[];
  getReadOnlyToolDefinitions(): readonly IToolDefinition[];
  invokeTool?(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult>;
  maxIterations?: number;
  networkTimeout?: number;
  getModelContextLength?(): number;
  sendSummarizationRequest?(
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
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
  reportBudget?(slots: ReadonlyArray<{ label: string; used: number; allocated: number; color: string }>): void;
  listFolderFiles?(folderPath: string): Promise<Array<{ relativePath: string; content: string }>>;
  getTerminalOutput?(): Promise<string | undefined>;
  userCommandFileSystem?: IUserCommandFileSystem;
  compactSession?(sessionId: string, summaryText: string): void;
  getExcludedContextIds?(): ReadonlySet<string>;
  getWorkspaceDigest?(): Promise<string | undefined>;
  /** Session manager for stale session detection during tool invocations. */
  sessionManager?: ISessionManager;
  /** Unified AI Config service for all configuration (M20). */
  unifiedConfigService?: IUnifiedAIConfigService;
  /** M39: Return lightweight catalog of workflow skills for prompt injection. */
  getWorkflowSkillCatalog?(): ISkillCatalogEntry[];
  /** M39: Return full skill manifest by name (for activation). */
  getSkillManifest?(name: string): import('../../services/skillLoaderService.js').ISkillManifest | undefined;
}

/** Services injected into the @workspace participant. */
export interface IWorkspaceParticipantServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  listPages(): Promise<readonly IPageSummary[]>;
  searchPages(query: string): Promise<readonly IPageSummary[]>;
  getPageContent(pageId: string): Promise<string | null>;
  getPageTitle(pageId: string): Promise<string | null>;
  getWorkspaceName(): string;
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
}

/** Services injected into the @canvas participant. */
export interface ICanvasParticipantServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  getCurrentPageId(): string | undefined;
  getCurrentPageTitle(): string | undefined;
  getPageStructure(pageId: string): Promise<IPageStructure | null>;
  getWorkspaceName(): string;
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
}

// ── Participant data types ──

/** Summary of a canvas page (for @workspace participant). */
export interface IPageSummary {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** Summary of a single block (for @canvas participant). */
export interface IBlockSummary {
  readonly id: string;
  readonly blockType: string;
  readonly parentBlockId: string | null;
  readonly sortOrder: number;
  readonly textPreview: string;
}

/** Full page structure with blocks (for @canvas participant). */
export interface IPageStructure {
  readonly pageId: string;
  readonly title: string;
  readonly icon?: string;
  readonly blocks: readonly IBlockSummary[];
}

/** Retrieval plan from the 2-call pipeline (M12). */
export interface IRetrievalPlan {
  intent: 'question' | 'situation' | 'task' | 'conversational' | 'exploration';
  reasoning: string;
  needsRetrieval: boolean;
  queries: string[];
  coverageMode?: 'representative' | 'exhaustive' | 'enumeration';
}

// ── M38: Scope resolution ──

/** A resolved entity reference from freeform user text (M38). */
export interface IResolvedEntity {
  /** What the user wrote, e.g. "RF Guides" */
  readonly naturalName: string;
  /** Actual workspace-relative path, e.g. "RF Guides/" */
  readonly resolvedPath: string;
  /** Whether this maps to a folder, file, or canvas page. */
  readonly kind: 'folder' | 'file' | 'page';
}

/** Canonical scope object passed through all downstream pipeline stages (M38). */
export interface IQueryScope {
  /** Granularity of the resolved scope. */
  readonly level: 'workspace' | 'folder' | 'document' | 'selection';
  /** Workspace-relative path prefixes that scope retrieval. */
  readonly pathPrefixes?: readonly string[];
  /** Explicit document/source IDs for page-level scoping. */
  readonly documentIds?: readonly string[];
  /** How the scope was determined. */
  readonly derivedFrom: 'explicit-mention' | 'inferred' | 'contextual';
  /** Resolved entity references that produced this scope. */
  readonly resolvedEntities?: readonly IResolvedEntity[];
  /** Confidence in the resolution (0–1). */
  readonly confidence: number;
}

// ── Execution Plan Types (M38 Phase 2) ─────────────────────────────────────

/** Workflow classifications that guide execution planning. */
export type WorkflowType =
  | 'generic-grounded'       // Standard RAG — existing behavior
  | 'scoped-topic'           // Entity reference + topic question
  | 'folder-summary'         // Entity reference + summary verb
  | 'document-summary'       // Single document + summary verb
  | 'comparative'            // Two entities + comparison cue
  | 'exhaustive-extraction'  // Entity + "every"/"all" + extraction verb
  | 'mixed';                 // Structural cue + semantic cue together

/** A single step in an execution plan. */
export interface IExecutionStep {
  readonly kind:
    | 'enumerate'            // List files in a scope path
    | 'structural-inspect'   // Read directory structure
    | 'scoped-retrieve'      // RAG with pathPrefixes
    | 'deterministic-read'   // Read specific files by path
    | 'synthesize';          // Final LLM synthesis step
  /** Human-readable label for trace/debug output. */
  readonly label: string;
  /** Scope path(s) this step operates on (when applicable). */
  readonly targetPaths?: readonly string[];
}

/** Output format constraints for the final synthesis. */
export interface IOutputConstraints {
  /** Expected structure: prose, list, table, json. */
  readonly format?: 'prose' | 'list' | 'table' | 'json';
  /** Whether every source in scope must be cited. */
  readonly requireExhaustiveCitation?: boolean;
}

/** A typed execution plan built from route + scope. */
export interface IExecutionPlan {
  readonly workflowType: WorkflowType;
  readonly steps: readonly IExecutionStep[];
  readonly outputConstraints: IOutputConstraints;
  readonly scope: IQueryScope;
}

// ── M38 Phase 3: Evidence types ────────────────────────────────────────────

/** Metadata for one file discovered via enumeration. */
export interface IFileEntry {
  readonly relativePath: string;
  /** File extension (including dot), e.g. ".md" */
  readonly ext: string;
}

/** Evidence from a structural inspection or enumeration step. */
export interface IStructuralEvidence {
  readonly kind: 'structural';
  /** Workspace-relative file paths discovered. */
  readonly files: readonly IFileEntry[];
  /** Scope path that was enumerated. */
  readonly scopePath: string;
}

/** Evidence from a scoped-retrieve (RAG) step. */
export interface ISemanticEvidence {
  readonly kind: 'semantic';
  /** Retrieved text content. */
  readonly text: string;
  /** Source identifiers for citations. */
  readonly sources: readonly { uri: string; label: string; index?: number }[];
}

/** Evidence from a deterministic-read step. */
export interface IExhaustiveEvidence {
  readonly kind: 'exhaustive';
  /** File reads with their full content. */
  readonly reads: readonly { relativePath: string; content: string }[];
}

/** Tagged union of evidence subtypes. */
export type EvidenceItem = IStructuralEvidence | ISemanticEvidence | IExhaustiveEvidence;

/** A bundle of evidence gathered from executing all plan steps. */
export interface IEvidenceBundle {
  /** The plan that produced this evidence. */
  readonly plan: IExecutionPlan;
  /** Ordered evidence items (one per non-synthesize step). */
  readonly items: readonly EvidenceItem[];
  /** Total character count of all evidence text. */
  readonly totalChars: number;
}

// ── M38 Phase 4: Coverage Tracking ─────────────────────────────────────────

/** How completely the evidence covers the targets in scope. */
export type CoverageLevel = 'full' | 'partial' | 'minimal' | 'none';

/** A record of how many targets were enumerated, read, and represented. */
export interface ICoverageRecord {
  /** Overall coverage assessment. */
  readonly level: CoverageLevel;
  /** Number of targets in scope (e.g. files enumerated). */
  readonly totalTargets: number;
  /** Number of targets that were actually read or retrieved. */
  readonly coveredTargets: number;
  /** Paths that could not be read or were skipped. */
  readonly gaps: readonly string[];
}

// ── M39: Skill types ────────────────────────────────────────────────────────

import type { SkillKind } from '../../services/skillLoaderService.js';

/** Tier 1 — lightweight catalog entry visible in the system prompt. */
export interface ISkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly kind: SkillKind;
  readonly tags: readonly string[];
}

/** Tier 2 — result of matching user intent to a workflow skill. */
export interface ISkillMatchResult {
  readonly matched: boolean;
  readonly skill?: ISkillCatalogEntry;
  readonly reason: string;
}

/** Tier 3 — fully activated skill with resolved body ready for injection. */
export interface IActivatedSkill {
  readonly manifest: import('../../services/skillLoaderService.js').ISkillManifest;
  readonly resolvedBody: string;
  readonly activatedBy: 'planner' | 'user';
  readonly scope?: IQueryScope;
}

export type ChatTurnRouteKind =
  | 'conversational'
  | 'memory-recall'
  | 'transcript-recall'
  | 'product-semantics'
  | 'off-topic'
  | 'grounded';

export interface IChatTurnRoute {
  readonly kind: ChatTurnRouteKind;
  readonly reason: string;
  readonly directAnswer?: string;
  readonly coverageMode?: 'representative' | 'exhaustive' | 'enumeration';
  /** M38: Resolved workflow type for execution planning. */
  readonly workflowType?: WorkflowType;
}

export interface IChatContextPlan {
  readonly route: ChatTurnRouteKind;
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
  readonly semanticFallback?: IChatSemanticFallbackDecision;
  readonly routeAuthority?: IChatRouteAuthorityDecision;
  readonly sessionId?: string;
  readonly hasActiveSlashCommand: boolean;
  readonly isRagReady: boolean;
}

// ── /init command ──

/** Services injected into the /init command handler. */
export interface IInitCommandServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: undefined,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getWorkspaceName(): string;
  listFiles?(relativePath: string): Promise<{ name: string; type: 'file' | 'directory' }[]>;
  readFile?(relativePath: string): Promise<string | null>;
  writeFile?(relativePath: string, content: string): Promise<void>;
  exists?(relativePath: string): Promise<boolean>;
  invalidatePromptFiles?(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Widget & UI Service Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Service accessor passed from the activation layer to ChatWidget. */
export interface IChatWidgetServices {
  readonly sendRequest: (sessionId: string, message: string, options?: IChatSendRequestOptions) => Promise<void>;
  readonly cancelRequest: (sessionId: string) => void;
  readonly createSession: () => IChatSession;
  readonly onDidChangeSession: Event<string>;
  readonly getProviderStatus: () => { available: boolean };
  readonly onDidChangeProviderStatus: Event<void>;
  readonly modelPicker?: IModelPickerServices;
  readonly modePicker?: IModePickerServices;
  readonly attachmentServices?: IAttachmentServices;
  readonly getSession?: (sessionId: string) => IChatSession | undefined;
  readonly getSessions?: () => readonly IChatSession[];
  readonly deleteSession?: (sessionId: string) => void;
  readonly openFile?: (fullPath: string) => void;
  readonly openPage?: (pageId: string) => void;
  readonly openMemory?: (sessionId: string) => void;
  readonly getSystemPrompt?: () => Promise<string>;
  readonly readFileRelative?: (relativePath: string) => Promise<string | null>;
  readonly writeFileRelative?: (relativePath: string, content: string) => Promise<void>;
  readonly searchSessions?: (query: string) => Promise<Array<{ sessionId: string; sessionTitle: string; matchingContent: string }>>;
  readonly openAISettings?: () => void;
  readonly getAgentTasks?: () => readonly IChatAgentTaskViewModel[];
  readonly resolveAgentApproval?: (taskId: string, requestId: string, resolution: AgentApprovalResolution) => Promise<void>;
  readonly continueAgentTask?: (taskId: string) => Promise<void>;
  readonly stopAgentTaskAfterStep?: (taskId: string) => Promise<void>;
  readonly onDidChangeAgentTasks?: Event<AgentTaskRecord>;
  readonly onDidChangeAgentApprovals?: Event<AgentApprovalRequest>;
  // ── Pending request queue ──
  readonly queueRequest?: (sessionId: string, message: string, kind: ChatRequestQueueKind) => IChatPendingRequest;
  readonly removePendingRequest?: (sessionId: string, requestId: string) => void;
  readonly requestYield?: (sessionId: string) => void;
  readonly onDidChangePendingRequests?: Event<string>;
}

export interface IChatAgentTaskViewModel {
  readonly task: AgentTaskRecord;
  readonly diagnostics?: AgentTaskDiagnostics;
  readonly pendingApprovals: readonly AgentApprovalRequest[];
}

/** Services needed by the model picker dropdown. */
export interface IModelPickerServices {
  getModels(): Promise<readonly ILanguageModelInfo[]>;
  getModelInfo?(modelId: string): Promise<ILanguageModelInfo>;
  getActiveModel(): string | undefined;
  setActiveModel(modelId: string): void;
  readonly onDidChangeModels: Event<void>;
  getModelContextLength?(modelId: string): Promise<number>;
}

/** Services needed by the mode picker dropdown. */
export interface IModePickerServices {
  getMode(): ChatMode;
  setMode(mode: ChatMode): void;
  getAvailableModes(): readonly ChatMode[];
  readonly onDidChangeMode: Event<ChatMode>;
}

/** Services needed by the session history sidebar. */
export interface ISessionSidebarServices {
  getSessions(): readonly IChatSession[];
  deleteSession(sessionId: string): void;
  searchSessions?(query: string): Promise<Array<{ sessionId: string; sessionTitle: string; matchingContent: string }>>;
}

/** Services needed by the attachment ribbon. */
export interface IAttachmentServices {
  getOpenEditorFiles(): IOpenEditorFile[];
  readonly onDidChangeOpenEditors: Event<void>;
  listWorkspaceFiles?(): Promise<IWorkspaceFileEntry[]>;
}

export type RegenerateMessageHandler = (request: import('../../services/chatTypes.js').IChatUserMessage) => void;

/** Services needed by the tool picker — re-exported from main service types. */
export type { IToolPickerServices } from '../../services/chatTypes.js';

/** Services needed for token breakdown calculations. */
export interface ITokenStatusBarServices {
  getActiveSession(): IChatSession | undefined;
  getContextLength(): Promise<number>;
  getMode(): ChatMode;
  getWorkspaceName(): string;
  getPageCount(): Promise<number>;
  getCurrentPageTitle(): string | undefined;
  getToolDefinitions(): readonly IToolDefinition[];
  getFileCount(): Promise<number>;
  isRAGAvailable(): boolean;
  isIndexing(): boolean;
  getIndexingProgress?(): import('../../services/indexingPipeline.js').IndexingProgress;
  getIndexStats?(): { pages: number; files: number } | undefined;
}

// ── Attachment data types ──

/** Information about an open editor file. */
export interface IOpenEditorFile {
  readonly name: string;
  readonly fullPath: string;
}

/** A workspace file entry (from recursive directory listing). */
export interface IWorkspaceFileEntry {
  readonly name: string;
  readonly fullPath: string;
  readonly relativePath: string;
  readonly isDirectory: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mention & Autocomplete Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** A suggestion item in the autocomplete dropdown. */
export interface IMentionSuggestion {
  readonly label: string;
  readonly kind: 'scope' | 'file' | 'folder' | 'command';
  readonly description?: string;
  readonly insertText: string;
  readonly sortOrder?: number;
}

/** Fired when the user selects a suggestion. */
export interface IMentionAcceptEvent {
  readonly insertText: string;
  readonly triggerStart: number;
  readonly triggerEnd: number;
}

/** Service interface for providing workspace file/folder suggestions. */
export interface IMentionSuggestionProvider {
  listFiles(): Promise<Array<{ name: string; relativePath: string; isDirectory: boolean }>>;
}

/** Service interface for providing slash command suggestions. */
export interface ISlashCommandProvider {
  getCommands(): Array<{ name: string; description: string }>;
}

/** A resolved @mention in user input. */
export interface IChatMention {
  readonly kind: 'file' | 'folder' | 'workspace' | 'terminal';
  readonly path?: string;
  readonly original: string;
  readonly start: number;
  readonly end: number;
}

/** Result of resolving @mentions into context blocks. */
export interface IMentionResolutionResult {
  readonly contextBlocks: string[];
  readonly pills: IContextPill[];
  readonly cleanText: string;
}

/** Services needed for @mention resolution. */
export interface IMentionResolutionServices {
  readFileContent?(path: string): Promise<string>;
  listFolderFiles?(folderPath: string): Promise<Array<{ relativePath: string; content: string }>>;
  retrieveContext?(query: string, pathPrefixes?: string[]): Promise<{ text: string; sources: Array<{ uri: string; label: string; index: number }> } | undefined>;
  getTerminalOutput?(): Promise<string | undefined>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Database accessor for built-in tools. */
export interface IBuiltInToolDatabase {
  get<T>(sql: string, params?: unknown[]): Promise<T | null | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  readonly isOpen: boolean;
}

/** File system accessor for built-in tools. */
export interface IBuiltInToolFileSystem {
  readdir(relativePath: string): Promise<readonly { name: string; type: 'file' | 'directory'; size: number }[]>;
  readFile(relativePath: string): Promise<string>;
  exists(relativePath: string): Promise<boolean>;
  /** Check whether a file extension belongs to a rich document format (PDF, DOCX, XLSX, etc.). */
  isRichDocument(ext: string): boolean;
  /** Extract text from a rich document (PDF, DOCX, XLSX). Returns extracted plain text. */
  readDocumentText(relativePath: string): Promise<string>;
  readonly workspaceRootName: string;
}

/** File writer accessor for built-in tools. */
export interface IBuiltInToolFileWriter {
  writeFile(relativePath: string, content: string): Promise<void>;
  isPathAllowed(relativePath: string): boolean;
}

/** Retrieval accessor for built-in tools. */
export interface IBuiltInToolRetrieval {
  isReady(): boolean;
  retrieve(query: string, sourceFilter?: string, pathPrefixes?: string[]): Promise<{ sourceType: string; sourceId: string; contextPrefix: string; text: string; score: number }[]>;
}

/** Canonical memory search accessor for built-in tools. */
export interface IBuiltInToolCanonicalMemorySearch {
  isReady(): boolean;
  search(
    query: string,
    options?: { layer?: 'all' | 'durable' | 'daily'; date?: string },
  ): Promise<Array<{ sourceId: string; contextPrefix: string; text: string; score: number; layer: 'durable' | 'daily' }>>;
}

/** Canonical transcript search accessor for built-in tools. */
export interface IBuiltInToolTranscriptSearch {
  isEnabled(): boolean;
  isReady(): boolean;
  search(
    query: string,
    options?: { sessionId?: string },
  ): Promise<Array<{ sourceId: string; contextPrefix: string; text: string; score: number; sessionId: string }>>;
}

/** Terminal accessor for built-in tools. */
export interface IBuiltInToolTerminal {
  exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    error: { code: string; message: string } | null;
  }>;
}

/** Getter for the current page ID. */
export type CurrentPageIdGetter = () => string | undefined;

// ═══════════════════════════════════════════════════════════════════════════════
// Config & Prompt Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** System prompt construction context. */
export interface ISystemPromptContext {
  readonly workspaceName: string;
  readonly pageCount: number;
  readonly currentPageTitle?: string;
  readonly tools?: readonly IToolDefinition[];
  readonly fileCount?: number;
  readonly isRAGAvailable?: boolean;
  readonly isIndexing?: boolean;
  readonly promptOverlay?: string;
  readonly workspaceDigest?: string;
  /**
   * User-editable description of the workspace's purpose and contents.
   * Injected into the system prompt before the digest to prime the AI's
   * understanding of what "workspace" means in this context.
   */
  readonly workspaceDescription?: string;
  /** M39: Lightweight catalog of available workflow skills. */
  readonly skillCatalog?: readonly ISkillCatalogEntry[];
}

/** Mode capability matrix (Ask/Edit/Agent). */
export interface IChatModeCapabilities {
  readonly canReadContext: boolean;
  readonly canInvokeTools: boolean;
  readonly canProposeEdits: boolean;
  readonly canAutonomous: boolean;
}

// ── Slash command types ──

/** A registered slash command. */
export interface IChatSlashCommand {
  readonly name: string;
  readonly description: string;
  readonly promptTemplate: string;
  readonly isBuiltIn: boolean;
  readonly specialHandler?: string;
}

/** Result of parsing a slash command from user input. */
export interface IParsedSlashCommand {
  readonly command: IChatSlashCommand | undefined;
  readonly commandName: string | undefined;
  readonly remainingText: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility & Input Parsing Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Parsed chat request with mentions, commands, and variables. */
export interface IChatParsedRequest {
  readonly participantId?: string;
  readonly command?: string;
  readonly variables: readonly IChatParsedVariable[];
  readonly text: string;
}

export type ChatParticipantSurface = 'default' | 'workspace' | 'canvas' | 'bridge';

export interface IChatParticipantInterpretation {
  readonly surface: ChatParticipantSurface;
  readonly rawText: string;
  readonly effectiveText: string;
  readonly commandName?: string;
  readonly hasExplicitCommand: boolean;
  readonly kind: 'command' | 'message';
  readonly semantics: IChatTurnSemantics;
}

export interface IChatTurnSemantics {
  readonly rawText: string;
  readonly normalizedText: string;
  readonly strippedApostropheText: string;
  readonly isConversational: boolean;
  readonly isExplicitMemoryRecall: boolean;
  readonly isExplicitTranscriptRecall: boolean;
  readonly isFileEnumeration: boolean;
  readonly isExhaustiveWorkspaceReview: boolean;
  readonly offTopicDirectAnswer?: string;
  readonly productSemanticsDirectAnswer?: string;
  readonly workflowTypeHint: WorkflowType;
  readonly groundedCoverageModeHint?: 'representative' | 'exhaustive' | 'enumeration';
}

export interface IChatSemanticFallbackDecision {
  readonly kind: 'broad-workspace-summary';
  readonly confidence: number;
  readonly reason: string;
  readonly workflowTypeHint: WorkflowType;
  readonly groundedCoverageModeHint: 'exhaustive';
}

export interface IChatRouteAuthorityDecision {
  readonly action: 'preserved' | 'corrected';
  readonly reason: string;
}

/** A parsed variable reference in user input. */
export interface IChatParsedVariable {
  readonly name: string;
  readonly original: string;
}

/** File system abstraction for loading user commands. */
export interface IUserCommandFileSystem {
  listCommandFiles(): Promise<string[]>;
  readCommandFile(relativePath: string): Promise<string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Code Actions & Diff Viewer Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Kind of code action (apply existing or create new file). */
export type CodeActionKind = 'apply' | 'create';

/** Dispatched when a code action button is clicked. */
export interface ICodeActionRequest {
  readonly filePath: string;
  readonly code: string;
  readonly language?: string;
  readonly action: CodeActionKind;
}

/** Callback for handling code action requests. */
export type CodeActionHandler = (request: ICodeActionRequest) => void;

/** Decision the user makes on a diff. */
export type DiffReviewDecision = 'accept' | 'reject';

/** Callback for when the user accepts or rejects a diff. */
export type DiffReviewCallback = (decision: DiffReviewDecision, diff: IDiffResult) => void;

/** Options for the diff viewer. */
export interface IDiffViewerOptions {
  wordLevelHighlight?: boolean;
  maxVisibleLines?: number;
  showActions?: boolean;
  onReview?: DiffReviewCallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rendering & Content Part Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Custom DOM event detail for accepting an edit proposal. */
export interface EditApplyEventDetail {
  readonly proposal: IChatEditProposalContent;
}

/** Per-slot token budget breakdown. */
export interface ITokenBudgetSlot {
  label: string;
  used: number;
  allocated: number;
  color: string;
}

/** Optional callback for opening an attached file in the editor. */
export type OpenAttachmentHandler = (fullPath: string) => void;

// ═══════════════════════════════════════════════════════════════════════════════
// Entry Point Types (internal to activation layer)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Subset of the Parallx API used by the chat activation layer.
 * Not exposed to other chat files — only used by main.ts.
 */
export interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: Record<string, unknown>): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showQuickPick(items: readonly { label: string; description?: string; detail?: string }[], options?: { placeHolder?: string; title?: string }): Promise<{ label: string; description?: string; detail?: string } | undefined>;
    createStatusBarItem(alignment?: number, priority?: number): {
      text: string;
      tooltip: string | undefined;
      command: string | undefined;
      name: string | undefined;
      iconSvg: string | undefined;
      htmlElement: HTMLElement | undefined;
      show(): void;
      hide(): void;
      dispose(): void;
    };
  };
  workspace: {
    getConfiguration(section: string): { get<T>(key: string, defaultValue?: T): T };
    onDidChangeConfiguration: Event<{ affectsConfiguration(section: string): boolean }>;
  };
  context: {
    createContextKey<T extends string | number | boolean | undefined>(name: string, defaultValue: T): { key: string; get(): T; set(value: T): void; reset(): void };
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}
