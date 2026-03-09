// chatDataService.ts — Centralised data-layer service for the chat built-in (M13 Phase 2)
//
// Every database query, filesystem operation, retrieval call, memory access,
// and workspace digest computation lives in this single, testable class.
//
// The class replaces ~30 anonymous closures previously scattered across
// chatTool.ts's activate() function.  Builder methods compose these into
// the service interfaces expected by participants, widgets, and the token bar.
//
// RULE: This file has ZERO DOM references.  All UI delegation goes through
// callback deps (getActiveWidget, etc.).

import type {
  IDefaultParticipantServices,
  IChatRuntimeTrace,
  IWorkspaceParticipantServices,
  ICanvasParticipantServices,
  IChatWidgetServices,
  ITokenStatusBarServices,
  IBuiltInToolFileSystem,
  IPageSummary,
  IBlockSummary,
  IPageStructure,
  IWorkspaceFileEntry,
} from '../chatTypes.js';

import type {
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  ICancellationToken,
  IToolResult,
  IContextPill,
  IChatRequestResponsePair,
  IChatSession,
} from '../../../services/chatTypes.js';
import {
  ChatContentPartKind,
  ChatMode,
  ChatRequestQueueKind,
} from '../../../services/chatTypes.js';

import type { Event } from '../../../platform/events.js';

import type { IAgentApprovalService, IAgentExecutionService, IAgentSessionService, IAgentTraceService, IDatabaseService, IFileService, IWorkspaceService, IEditorService, IRetrievalService, IIndexingPipelineService, IMemoryService, ITextFileModelManager, ISessionManager } from '../../../services/serviceTypes.js';
import type { IAISettingsService } from '../../../aiSettings/aiSettingsTypes.js';
import type { IUnifiedAIConfigService } from '../../../aiSettings/unifiedConfigTypes.js';
import type { ILanguageModelsService, IChatService, IChatModeService, ILanguageModelToolsService } from '../../../services/chatTypes.js';
import type { OllamaProvider } from '../providers/ollamaProvider.js';
import type { PromptFileService } from '../../../services/promptFileService.js';
import type { ChatWidget } from '../widgets/chatWidget.js';
import type { IWorkspaceSessionContext } from '../../../workspace/workspaceSessionContext.js';
import type { RetrievalTrace } from '../../../services/retrievalService.js';

import { buildSystemPrompt } from '../config/chatSystemPrompts.js';
import { extractTextContent } from '../tools/builtInTools.js';
import { buildChatAgentTaskWidgetServices } from '../utilities/chatAgentTaskWidgetAdapter.js';
import { buildChatDefaultParticipantServices } from '../utilities/chatDefaultParticipantAdapter.js';
import { buildChatWidgetAttachmentServices } from '../utilities/chatWidgetAttachmentAdapter.js';
import { buildChatWidgetPickerServices } from '../utilities/chatWidgetPickerAdapter.js';
import { buildChatWidgetRequestServices } from '../utilities/chatWidgetRequestAdapter.js';
import { buildChatWidgetSessionServices } from '../utilities/chatWidgetSessionAdapter.js';
import { buildChatTokenBarServices } from '../utilities/chatTokenBarAdapter.js';
import { ReadonlyMarkdownInput } from '../../editor/readonlyMarkdownInput.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dependency bag passed to the ChatDataService constructor.
 * All optional services are `undefined` when the corresponding module
 * is unavailable (e.g. no workspace folder open → no fileService).
 */
export interface ChatDataServiceDeps {
  readonly databaseService: IDatabaseService | undefined;
  readonly fileService: IFileService | undefined;
  readonly workspaceService: IWorkspaceService | undefined;
  readonly editorService: IEditorService | undefined;
  readonly retrievalService: IRetrievalService | undefined;
  readonly indexingPipelineService: IIndexingPipelineService | undefined;
  readonly memoryService: IMemoryService | undefined;
  readonly languageModelsService: ILanguageModelsService;
  readonly languageModelToolsService: ILanguageModelToolsService | undefined;
  readonly chatService: IChatService;
  readonly modeService: IChatModeService;
  readonly ollamaProvider: OllamaProvider;
  readonly promptFileService: PromptFileService;
  readonly fsAccessor: IBuiltInToolFileSystem | undefined;
  readonly textFileModelManager: ITextFileModelManager | undefined;
  readonly maxIterations: number;
  readonly networkTimeout: number;
  readonly getActiveWidget: () => ChatWidget | undefined;
  /** Callback to open a canvas page by its UUID. Provided by main.ts via api.editors. */
  readonly openPage?: (pageId: string) => Promise<void>;
  /** Workspace session context (M14). Carries sessionId, logPrefix, abort signal. */
  readonly sessionContext?: IWorkspaceSessionContext;
  /** Session manager (M14). Used for stale session detection in tool invocations. */
  readonly sessionManager?: ISessionManager;
  /** AI Settings service (M15). Provides active persona and model defaults. */
  readonly aiSettingsService?: IAISettingsService;
  /** Unified AI Config service (M20). Single source of truth for all AI configuration. */
  readonly unifiedConfigService?: IUnifiedAIConfigService;
  /** Autonomy services used for task and approval UI surfaces. */
  readonly agentSessionService?: IAgentSessionService;
  readonly agentApprovalService?: IAgentApprovalService;
  readonly agentExecutionService?: IAgentExecutionService;
  readonly agentTraceService?: IAgentTraceService;
  /** Open a file in the editor via the standard EditorsBridge resolver (same as explorer). */
  readonly openFileEditor?: (uri: string, options?: { pinned?: boolean }) => Promise<void>;
}

export interface IChatTestDebugSnapshot {
  query?: string;
  retrievedContextText?: string;
  ragSources: Array<{ uri: string; label: string; index: number }>;
  contextPills: Array<{ id: string; label: string; type: string; removable: boolean; index?: number; tokens?: number }>;
  retrievalTrace?: RetrievalTrace;
  isRAGAvailable: boolean;
  isIndexing: boolean;
  requestInProgress?: boolean;
  pendingRequestCount?: number;
  assistantMessageCount?: number;
  lastAssistantResponseText?: string;
  lastAssistantResponseComplete?: boolean;
  lastAssistantPartKinds?: string[];
  lastAssistantPartSummary?: Array<{ kind: string; preview: string }>;
  responseDebug?: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  };
  retrievalGate?: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  };
  runtimeTrace?: IChatRuntimeTrace;
  retrievalError?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Static Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_READ_BYTES = 50 * 1024; // 50 KB per spec

/**
 * Extract the canvas page UUID from an editor input ID.
 * Handles two formats:
 *   - Prefixed: `parallx.canvas:canvas:<pageId>` → `<pageId>`
 *   - Bare UUID: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` → as-is
 */
export function extractCanvasPageId(editorId: string | undefined): string | undefined {
  if (!editorId) { return undefined; }
  const parts = editorId.split(':');
  if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
    return parts.slice(2).join(':');
  }
  if (UUID_RE.test(editorId)) {
    return editorId;
  }
  return undefined;
}

/**
 * Extract a clean display label from a retrieval chunk's contextPrefix.
 *
 * Input formats produced by chunkingService.buildContextPrefix():
 *   - `[Source: "D:/AI/Parallx/demo-workspace/file.md" | Section: "Heading"]`
 *   - `[Source: "My Page Title" | Type: heading]`
 *   - `[Conversation Memory — Session abc12345]`
 *
 * Returns a short, human-friendly label (e.g. "file.md", "My Page Title",
 * "Session Memory").
 */
export function extractCitationLabel(chunk: { sourceType: string; sourceId: string; contextPrefix?: string }): string {
  const prefix = chunk.contextPrefix;

  // Conversation memory — always a fixed friendly label
  // sourceType is 'memory' (from MEMORY_SOURCE_TYPE in memoryService)
  if (chunk.sourceType === 'memory' || chunk.sourceType === 'conversation_memory') {
    return 'Session Memory';
  }

  // Memory contextPrefix: "[Conversation Memory — Session abc12345]"
  if (prefix && prefix.startsWith('[Conversation Memory')) {
    return 'Session Memory';
  }

  // Try to extract Source: "..." from the contextPrefix
  if (prefix) {
    const m = /Source:\s*"([^"]+)"/.exec(prefix);
    if (m) {
      const raw = m[1];
      // For file paths, extract just the filename
      if (chunk.sourceType === 'file' || chunk.sourceType === 'file_chunk' || raw.includes('/') || raw.includes('\\')) {
        const segments = raw.replace(/\\/g, '/').split('/');
        return segments[segments.length - 1] || raw;
      }
      // For pages the source is the page title — use as-is
      return raw;
    }
  }

  // Fallback: derive from sourceId
  if (chunk.sourceType === 'page' || chunk.sourceType === 'page_block') {
    return 'Page';
  }
  // sourceId for files is the file path
  const segments = chunk.sourceId.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || 'File';
}

/**
 * Extract a plain text preview from a block's content_json column.
 * Walks Tiptap-style JSON nodes and concatenates text.
 */
export function extractBlockPreview(contentJson: string): string {
  try {
    const arr = JSON.parse(contentJson);
    if (!Array.isArray(arr)) { return ''; }
    const texts: string[] = [];
    for (const node of arr) {
      walkContentNode(node, texts);
    }
    return texts.join(' ').trim();
  } catch {
    return '';
  }
}

function buildRecentSessionRecallSummary(session: IChatSession): string | undefined {
  const userRequests = session.messages
    .map((pair: IChatRequestResponsePair) => pair.request.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-3);

  if (userRequests.length === 0) {
    return undefined;
  }

  const summary = userRequests
    .map((text: string) => /[.!?]$/.test(text) ? text : `${text}.`)
    .join(' ');

  return [
    '[Conversation Memory]',
    '---',
    `Previous session (${new Date(session.createdAt).toISOString()}):`,
    summary.length <= 900 ? summary : `${summary.slice(0, 897).trimEnd()}...`,
  ].join('\n');
}

function scoreSessionForRecallQuery(session: IChatSession, query: string): number {
  const combined = session.messages
    .map((pair) => pair.request.text)
    .join(' ')
    .toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !['last', 'previous', 'prior', 'conversation', 'chat', 'session', 'remember', 'details', 'about'].includes(term));

  let score = 0;
  for (const term of queryTerms) {
    if (combined.includes(term)) {
      score += 3;
    }
  }
  if (/\b(i|my|we|our)\b/.test(combined)) {
    score += 2;
  }
  if (/\baccident|driver|door|police|report|claim|street|mall|parking\b/.test(combined)) {
    score += 4;
  }
  if (/\b\d{4}-\d{4}|\d{2,}\b/.test(combined)) {
    score += 2;
  }
  return score;
}

function walkContentNode(node: unknown, texts: string[]): void {
  if (!node || typeof node !== 'object') { return; }
  const n = node as Record<string, unknown>;
  if (n['type'] === 'text' && typeof n['text'] === 'string') {
    texts.push(n['text'] as string);
    return;
  }
  if (Array.isArray(n['content'])) {
    for (const child of n['content']) {
      walkContentNode(child, texts);
    }
  }
}

/**
 * Build an IBuiltInToolFileSystem from IFileService + IWorkspaceService.
 * Returns undefined only if the required services are missing.
 *
 * The accessor is LAZY — it does NOT check whether a folder is currently
 * open.  Instead, every operation dynamically reads workspaceService.folders
 * at call time.  This allows it to be created during tool activation (when
 * the workspace might be empty) and start working as soon as a folder is
 * opened later.
 */
export function buildFileSystemAccessor(
  fileService: IFileService | undefined,
  workspaceService: IWorkspaceService | undefined,
): IBuiltInToolFileSystem | undefined {
  if (!fileService || !workspaceService) { return undefined; }

  // ── Dynamic root resolution ──
  // Read workspaceService.folders on every call instead of capturing rootUri
  // once at activation time.  After a workspace switch the service's folder
  // list points to the NEW workspace, so every consumer of this accessor
  // (built-in tools, workspace digest, prompt-file reads, mention provider)
  // automatically resolves against the correct root without any explicit
  // rebuild step.

  function getRootUri(): import('../../../platform/uri.js').URI {
    const f = workspaceService!.folders;
    if (!f || f.length === 0) {
      throw new Error('No workspace root folder available');
    }
    return f[0].uri;
  }

  function getRootName(): string {
    return workspaceService!.activeWorkspace?.name
      ?? workspaceService!.folders[0]?.name
      ?? '';
  }

  function resolveUri(relativePath: string): import('../../../platform/uri.js').URI {
    const rootUri = getRootUri();
    const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
    if (!clean || clean === '.') { return rootUri; }

    // Detect absolute paths — if the path starts with a drive letter (C:/) or
    // contains the workspace root path, strip the root prefix so we get a
    // genuine relative path.  Otherwise the path gets doubled:
    //   rootUri + "/AI/Parallx/demo-workspace/file.md"
    //   → D:/AI/Parallx/demo-workspace/AI/Parallx/demo-workspace/file.md
    const rootFsPath = rootUri.fsPath.replace(/\\/g, '/');
    const rootFsPathNoSlash = rootFsPath.replace(/\/$/, '');

    // Absolute path with drive letter (e.g. "D:/AI/Parallx/demo-workspace/file.md")
    if (/^[a-zA-Z]:/.test(clean)) {
      const norm = clean;
      if (norm.startsWith(rootFsPathNoSlash + '/') || norm.startsWith(rootFsPathNoSlash + '\\')) {
        const rel = norm.slice(rootFsPathNoSlash.length + 1);
        return rootUri.joinPath(rel);
      }
      // Absolute path outside workspace — use as-is via URI.file
      return { fsPath: clean, path: '/' + clean, scheme: 'file' } as any;
    }

    // Absolute-looking path without drive letter (e.g. "/AI/Parallx/demo-workspace/file.md")
    if (clean.startsWith('/')) {
      const stripped = clean.slice(1);
      // Check if it matches the root path (without drive letter)
      const rootNoDrive = rootFsPathNoSlash.replace(/^[a-zA-Z]:/, '').replace(/^\//, '');
      if (stripped.startsWith(rootNoDrive + '/')) {
        const rel = stripped.slice(rootNoDrive.length + 1);
        return rootUri.joinPath(rel);
      }
    }

    return rootUri.joinPath(clean);
  }

  return {
    get workspaceRootName() { return getRootName(); },

    async readdir(relativePath: string) {
      const uri = resolveUri(relativePath);
      const entries = await fileService.readdir(uri);
      return entries.map((e) => ({
        name: e.name,
        type: (e.type === 2 /* FileType.Directory */) ? 'directory' as const : 'file' as const,
        size: e.size,
      }));
    },

    async readFile(relativePath: string) {
      const uri = resolveUri(relativePath);
      const stat = await fileService.stat(uri);
      if (stat.size > MAX_FILE_READ_BYTES) {
        throw new Error(`File is too large (${(stat.size / 1024).toFixed(1)} KB). Maximum is ${MAX_FILE_READ_BYTES / 1024} KB.`);
      }
      const result = await fileService.readFile(uri);
      return result.content;
    },

    isRichDocument(ext: string) {
      return fileService.isRichDocument(ext);
    },

    async readDocumentText(relativePath: string) {
      const uri = resolveUri(relativePath);
      const result = await fileService.readDocumentText(uri);
      return result.text;
    },

    async exists(relativePath: string) {
      const uri = resolveUri(relativePath);
      return fileService.exists(uri);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChatDataService
// ═══════════════════════════════════════════════════════════════════════════════

export class ChatDataService {

  // ── Digest cache ──
  private _cachedDigest: string | undefined;
  private _cacheTimestamp = 0;
  private static readonly DIGEST_TTL_MS = 60_000;

  // ── Externally set state ──
  private _lastIndexStats: { pages: number; files: number } | undefined;
  private _lastTestDebugSnapshot: IChatTestDebugSnapshot = {
    ragSources: [],
    contextPills: [],
    isRAGAvailable: false,
    isIndexing: false,
  };

  constructor(private _d: ChatDataServiceDeps) {
    // M17 P1.3 Task 1.3.6: Fire-and-forget memory eviction + decay recalculation on startup
    if (this._d.memoryService) {
      this._d.memoryService.evictStaleContent().catch(() => {});
    }
  }

  /** Called by the indexing-complete listener in chatTool.ts. */
  setLastIndexStats(stats: { pages: number; files: number }): void {
    this._lastIndexStats = stats;
  }

  /**
   * Swap stale service references after a workspace switch.
   *
   * Only the services that are recreated by `registerIndexingServices()`
   * need refreshing — singletons (databaseService, fileService, etc.)
   * survive across workspaces.
   *
   * Also invalidates all caches so the next prompt/digest build reads
   * from the new workspace.
   *
   * @deprecated M14: Dead code in the reload-based workspace switch flow.
   * Kept for backward compatibility with existing tests.
   */
  resetForWorkspaceSwitch(fresh: {
    retrievalService: ChatDataServiceDeps['retrievalService'];
    indexingPipelineService: ChatDataServiceDeps['indexingPipelineService'];
    memoryService: ChatDataServiceDeps['memoryService'];
  }): void {
    // Swap stale refs
    this._d = {
      ...this._d,
      retrievalService: fresh.retrievalService,
      indexingPipelineService: fresh.indexingPipelineService,
      memoryService: fresh.memoryService,
    };

    // Invalidate caches
    this._cachedDigest = undefined;
    this._cacheTimestamp = 0;
    this._lastIndexStats = undefined;

    // Invalidate prompt file cache so next build reads from new workspace
    this._d.promptFileService.invalidate();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM Proxy Methods
  // ═══════════════════════════════════════════════════════════════════════════

  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    const modelId = this._d.languageModelsService.getActiveModel() ?? '';
    return this._d.ollamaProvider.sendChatRequest(modelId, messages, options, signal);
  }

  getActiveModel(): string | undefined {
    return this._d.languageModelsService.getActiveModel();
  }

  getModelContextLength(): number {
    return (this._d.ollamaProvider as any).getActiveModelContextLength?.() ?? 0;
  }

  sendSummarizationRequest(
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    const modelId = this._d.languageModelsService.getActiveModel() ?? '';
    return this._d.ollamaProvider.sendChatRequest(modelId, messages, undefined, signal);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace Context
  // ═══════════════════════════════════════════════════════════════════════════

  getWorkspaceName(): string {
    return this._d.workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace';
  }

  async getPageCount(): Promise<number> {
    if (!this._d.databaseService?.isOpen) { return 0; }
    try {
      const row = await this._d.databaseService.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM pages WHERE is_archived = 0',
      );
      return row?.cnt ?? 0;
    } catch { return 0; }
  }

  getCurrentPageTitle(): string | undefined {
    return this._d.editorService?.activeEditor?.name;
  }

  getToolDefinitions(): readonly IToolDefinition[] {
    return this._d.languageModelToolsService?.getToolDefinitions() ?? [];
  }

  getReadOnlyToolDefinitions(): readonly IToolDefinition[] {
    return this._d.languageModelToolsService?.getReadOnlyToolDefinitions() ?? [];
  }

  invokeTool(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult> {
    if (!this._d.languageModelToolsService) {
      return Promise.resolve({ content: 'Tool service not available', isError: true });
    }
    return this._d.languageModelToolsService.invokeTool(name, args, token);
  }

  async getFileCount(): Promise<number> {
    if (!this._d.fsAccessor) { return 0; }
    try {
      const entries = await this._d.fsAccessor.readdir('.');
      return entries.length;
    } catch { return 0; }
  }

  isRAGAvailable(): boolean {
    return this._d.indexingPipelineService?.isInitialIndexComplete ?? false;
  }

  isIndexing(): boolean {
    return this._d.indexingPipelineService?.isIndexing ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Content Reading
  // ═══════════════════════════════════════════════════════════════════════════

  async readFileContent(fullPath: string): Promise<string> {
    // Canvas page attachments use parallx-page://<pageId> URIs
    if (fullPath.startsWith('parallx-page://') && this._d.databaseService?.isOpen) {
      const pageId = fullPath.slice('parallx-page://'.length);
      try {
        const row = await this._d.databaseService.get<{ title: string; content: string }>(
          'SELECT title, content FROM pages WHERE id = ?',
          [pageId],
        );
        if (!row) { return `[Error: Page not found "${pageId}"]`; }
        const text = extractTextContent(row.content);
        return text || '[Empty page]';
      } catch {
        return `[Error: Could not read page "${pageId}"]`;
      }
    }
    // Regular filesystem file
    if (!this._d.fileService) { return `[Error: File service not available]`; }
    try {
      const { URI } = await import('../../../platform/uri.js');
      const uri = URI.file(fullPath);
      const content = await this._d.fileService.readFile(uri);
      return content.content;
    } catch {
      return `[Error: Could not read file "${fullPath}"]`;
    }
  }

  async getCurrentPageContent(): Promise<{ title: string; pageId: string; textContent: string } | undefined> {
    const pageId = extractCanvasPageId(this._d.editorService?.activeEditor?.id);
    if (!pageId || !this._d.databaseService?.isOpen) { return undefined; }
    try {
      const row = await this._d.databaseService.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [pageId],
      );
      if (!row) { return undefined; }
      const textContent = extractTextContent(row.content);
      return textContent ? { title: row.title, pageId: row.id, textContent } : undefined;
    } catch { return undefined; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RAG Context Retrieval
  // ═══════════════════════════════════════════════════════════════════════════

  async retrieveContext(query: string): Promise<{ text: string; sources: Array<{ uri: string; label: string; index: number }> } | undefined> {
    if (!this._d.retrievalService) {
      this._lastTestDebugSnapshot = {
        query,
        ragSources: [],
        contextPills: [],
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return undefined;
    }
    if (!this._d.indexingPipelineService?.isInitialIndexComplete) {
      this._lastTestDebugSnapshot = {
        query,
        ragSources: [],
        contextPills: [],
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return undefined;
    }
    try {
      // No hardcoded overrides — retrieval parameters come from AI Settings
      // (ragTopK, ragMaxPerSource, ragTokenBudget, etc.) via the config
      // provider bound to the retrieval service. Users control the limits.
      const chunks = await this._d.retrievalService.retrieve(query);
      const retrievalTrace = this._d.retrievalService.getLastTrace?.();
      if (chunks.length === 0) {
        this._lastTestDebugSnapshot = {
          query,
          ragSources: [],
          contextPills: this._lastTestDebugSnapshot.contextPills,
          retrievalTrace,
          isRAGAvailable: this.isRAGAvailable(),
          isIndexing: this.isIndexing(),
          retrievalError: undefined,
        };
        return undefined;
      }
      const text = this._d.retrievalService.formatContext(chunks);
      const sources = this._buildSourceCitations(chunks);
      this._lastTestDebugSnapshot = {
        query,
        retrievedContextText: text,
        ragSources: sources.map((source) => ({ ...source })),
        contextPills: this._lastTestDebugSnapshot.contextPills,
        retrievalTrace,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return { text, sources };
    } catch (error) {
      this._lastTestDebugSnapshot = {
        query,
        ragSources: [],
        contextPills: this._lastTestDebugSnapshot.contextPills,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: error instanceof Error ? error.message : String(error),
      };
      return undefined;
    }
  }

  /** Build deduplicated source citations from retrieval chunks. */
  private _buildSourceCitations(chunks: readonly { sourceType: string; sourceId: string; contextPrefix?: string }[]): Array<{ uri: string; label: string; index: number }> {
    const seen = new Set<string>();
    const sources: Array<{ uri: string; label: string; index: number }> = [];
    let nextIndex = 1;
    for (const chunk of chunks) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isPage = chunk.sourceType === 'page' || chunk.sourceType === 'page_block';
      const isMemory = chunk.sourceType === 'memory' || chunk.sourceType === 'conversation_memory';
      const uri = isPage
        ? `parallx-page://${chunk.sourceId}`
        : isMemory
          ? `parallx-memory://${chunk.sourceId}`
          : chunk.sourceId;
      const label = extractCitationLabel(chunk);
      sources.push({ uri, label, index: nextIndex++ });
    }
    return sources;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Memory & Preferences
  // ═══════════════════════════════════════════════════════════════════════════

  async recallMemories(query: string, sessionId?: string): Promise<string | undefined> {
    if (!this._d.memoryService) { return undefined; }
    try {
      const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
      const asksForPriorConversationRecall = /(last|previous|prior)\s+(conversation|chat|session)|what\s+do\s+you\s+remember|remember\s+about\s+(?:my|our)\s+(?:last|previous|prior)|recall\s+(?:my|our)\s+(?:last|previous|prior)/i.test(normalizedQuery);

      if (asksForPriorConversationRecall) {
        const currentSession = sessionId ? this._d.chatService.getSession(sessionId) : undefined;
        const recentSession = this._d.chatService.getSessions()
          .filter((session) => session.messages.length > 0 && session.id !== sessionId)
          .filter((session) => !currentSession || session.createdAt < currentSession.createdAt)
          .map((session) => ({ session, score: scoreSessionForRecallQuery(session, query) }))
          .filter(({ session }) => session.messages.some((pair) => pair.request.text.trim().toLowerCase() !== query.trim().toLowerCase()))
          .sort((a, b) => b.score - a.score || b.session.createdAt - a.session.createdAt)[0]?.session;
        if (recentSession) {
          return buildRecentSessionRecallSummary(recentSession);
        }
      }

      let memories = await this._d.memoryService.recallMemories(query);
      if (memories.length === 0 && asksForPriorConversationRecall) {
        memories = (await this._d.memoryService.getAllMemories()).slice(0, 1);
      }
      if (memories.length > 0) {
        return this._d.memoryService.formatMemoryContext(memories);
      }

      return undefined;
    } catch { return undefined; }
  }

  async storeSessionMemory(sessionId: string, summary: string, messageCount: number): Promise<void> {
    if (!this._d.memoryService) { return; }
    try { await this._d.memoryService.storeMemory(sessionId, summary, messageCount); } catch { /* best-effort */ }
  }

  /**
   * Store learning concepts extracted from a session (M17 P1.2 Task 1.2.8).
   */
  async storeConceptsFromSession(
    concepts: Array<{ concept: string; category: string; summary: string; struggled: boolean }>,
    sessionId: string,
  ): Promise<void> {
    if (!this._d.memoryService) { return; }
    try {
      const mapped = concepts.map((c) => ({
        concept: c.concept,
        category: c.category,
        summary: c.summary,
        masteryLevel: 0,
        encounterCount: 1,
        struggleCount: c.struggled ? 1 : 0,
        firstSeen: '',
        lastSeen: '',
        lastAccessed: '',
        sourceSessions: '[]',
        decayScore: 1.0,
      }));
      await this._d.memoryService.storeConcepts(mapped, sessionId);
    } catch { /* best-effort */ }
  }

  /**
   * Recall learning concepts relevant to a query (M17 P1.2 Task 1.2.8).
   * Returns formatted context string or undefined.
   */
  async recallConcepts(query: string): Promise<string | undefined> {
    if (!this._d.memoryService) { return undefined; }
    try {
      const concepts = await this._d.memoryService.recallConcepts(query);
      if (!concepts.length) { return undefined; }
      const formatted = this._d.memoryService.formatConceptContext(concepts);
      return formatted || undefined;
    } catch { return undefined; }
  }

  isSessionEligibleForSummary(messageCount: number): boolean {
    return this._d.memoryService?.isSessionEligibleForSummary(messageCount) ?? false;
  }

  async hasSessionMemory(sessionId: string): Promise<boolean> {
    if (!this._d.memoryService) { return false; }
    try { return await this._d.memoryService.hasMemory(sessionId); } catch { return false; }
  }

  /**
   * Get the message count stored with the last summary for a session.
   * Returns `null` if no memory exists (M17 Task 1.1.3).
   */
  async getSessionMemoryMessageCount(sessionId: string): Promise<number | null> {
    if (!this._d.memoryService) { return null; }
    try { return await this._d.memoryService.getMemoryMessageCount(sessionId); } catch { return null; }
  }

  async extractPreferences(text: string): Promise<void> {
    if (!this._d.memoryService) { return; }
    try { await this._d.memoryService.extractAndStorePreferences(text); } catch { /* best-effort */ }
  }

  async getPreferencesForPrompt(): Promise<string | undefined> {
    if (!this._d.memoryService) { return undefined; }
    try {
      const prefs = await this._d.memoryService.getPreferences();
      if (prefs.length === 0) { return undefined; }
      return this._d.memoryService.formatPreferencesForPrompt(prefs);
    } catch { return undefined; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Prompt File Overlay
  // ═══════════════════════════════════════════════════════════════════════════

  async getPromptOverlay(_activeFilePath?: string): Promise<string | undefined> {
    if (!this._d.promptFileService) { return undefined; }
    try {
      let activeRelPath = _activeFilePath;
      if (!activeRelPath && this._d.editorService?.activeEditor) {
        const ed = this._d.editorService.activeEditor;
        if (ed.description && !ed.id.includes('canvas:') && !ed.id.includes('database:')) {
          const rootPath = this._d.workspaceService?.folders?.[0]?.uri?.fsPath;
          if (rootPath && ed.description.startsWith(rootPath)) {
            activeRelPath = ed.description.slice(rootPath.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
          }
        }
      }
      const layers = await this._d.promptFileService.loadLayers();
      const overlay = this._d.promptFileService.assemblePromptOverlay(layers, activeRelPath);
      return overlay || undefined;
    } catch { return undefined; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File System Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async listFilesRelative(relativePath: string): Promise<{ name: string; type: 'file' | 'directory' }[]> {
    if (!this._d.fsAccessor) { return []; }
    const entries = await this._d.fsAccessor.readdir(relativePath);
    return entries.map(e => ({ name: e.name, type: e.type }));
  }

  async readFileRelative(relativePath: string): Promise<string | null> {
    if (!this._d.fsAccessor) { return null; }
    try {
      return await this._d.fsAccessor.readFile(relativePath);
    } catch { return null; }
  }

  async writeFileRelative(relativePath: string, content: string): Promise<void> {
    if (!this._d.fileService || !this._d.workspaceService?.folders?.length) { return; }
    const rootUri = this._d.workspaceService.folders[0].uri;
    const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
    const targetUri = rootUri.joinPath(clean);

    // Ensure parent directory exists
    const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    if (parentPath) {
      const parentUri = rootUri.joinPath(parentPath);
      try { await this._d.fileService.mkdir(parentUri); } catch { /* may already exist */ }
    }
    await this._d.fileService.writeFile(targetUri, content);
  }

  async existsRelative(relativePath: string): Promise<boolean> {
    if (!this._d.fsAccessor) { return false; }
    try { return await this._d.fsAccessor.exists(relativePath); } catch { return false; }
  }

  invalidatePromptFiles(): void {
    this._d.promptFileService?.invalidate();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI Bridges (delegate to active widget)
  // ═══════════════════════════════════════════════════════════════════════════

  reportContextPills(pills: readonly IContextPill[]): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      contextPills: pills.map((pill) => ({
        id: pill.id,
        label: pill.label,
        type: pill.type,
        removable: pill.removable,
        index: pill.index,
        tokens: pill.tokens,
      })),
    };
    const widget = this._d.getActiveWidget();
    if (widget) {
      widget.setContextPills(pills);
    }
  }

  reportRetrievalDebug(debug: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  }): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      retrievalGate: { ...debug },
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportResponseDebug(debug: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  }): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      responseDebug: { ...debug },
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportRuntimeTrace(trace: IChatRuntimeTrace): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      runtimeTrace: structuredClone(trace),
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  getTestDebugSnapshot(): IChatTestDebugSnapshot {
    const session = this._d.getActiveWidget()?.getSession();
    const assistantMessages = session?.messages.filter((pair) => pair.response) ?? [];
    const lastAssistantResponse = assistantMessages.length > 0
      ? assistantMessages[assistantMessages.length - 1].response
      : undefined;

    return {
      ...structuredClone(this._lastTestDebugSnapshot),
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
      requestInProgress: session?.requestInProgress ?? false,
      pendingRequestCount: session?.pendingRequests.length ?? 0,
      assistantMessageCount: assistantMessages.length,
      lastAssistantResponseText: lastAssistantResponse ? this._extractAssistantResponseText(lastAssistantResponse.parts) : '',
      lastAssistantResponseComplete: lastAssistantResponse?.isComplete ?? false,
      lastAssistantPartKinds: lastAssistantResponse?.parts.map((part) => part.kind) ?? [],
      lastAssistantPartSummary: lastAssistantResponse?.parts.map((part) => ({
        kind: part.kind,
        preview: this._summarizeAssistantPart(part),
      })) ?? [],
    };
  }

  private _extractAssistantResponseText(parts: ReadonlyArray<{ kind: string; content?: string; code?: string }>): string {
    return parts
      .filter((part) => part.kind === ChatContentPartKind.Markdown && typeof part.content === 'string')
      .map((part) => part.content ?? '')
      .join('')
      .trim();
  }

  private _summarizeAssistantPart(part: { kind: string; content?: string; code?: string; message?: string }): string {
    if (typeof part.content === 'string' && part.content.trim().length > 0) {
      return part.content.trim().slice(0, 160);
    }
    if (typeof part.message === 'string' && part.message.trim().length > 0) {
      return part.message.trim().slice(0, 160);
    }
    if (typeof part.code === 'string' && part.code.trim().length > 0) {
      return part.code.trim().slice(0, 160);
    }
    return '';
  }

  getExcludedContextIds(): ReadonlySet<string> {
    return this._d.getActiveWidget()?.getExcludedContextIds() ?? new Set();
  }

  reportBudget(slots: ReadonlyArray<{ label: string; used: number; allocated: number; color: string }>): void {
    const widget = this._d.getActiveWidget();
    if (widget) {
      widget.setBudget(slots);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Terminal & Folder Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async getTerminalOutput(): Promise<string | undefined> {
    const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
    const terminal = electron?.terminal as { getOutput?: (lineCount?: number) => Promise<{ output: string; lineCount: number }> } | undefined;
    if (!terminal?.getOutput) { return undefined; }
    try {
      const result = await terminal.getOutput(100);
      return result.output || undefined;
    } catch { return undefined; }
  }

  async listFolderFiles(folderPath: string): Promise<Array<{ relativePath: string; content: string }>> {
    if (!this._d.fsAccessor) { return []; }
    const results: Array<{ relativePath: string; content: string }> = [];
    const MAX_FILES = 50;
    const MAX_FILE_SIZE = 10_000; // chars
    try {
      const entries = await this._d.fsAccessor.readdir(folderPath);
      for (const entry of entries) {
        if (results.length >= MAX_FILES) break;
        if (entry.type === 'file') {
          const relPath = folderPath ? `${folderPath}/${entry.name}` : entry.name;
          try {
            const content = await this._d.fsAccessor.readFile(relPath);
            results.push({
              relativePath: relPath,
              content: content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) + '\n… (truncated)' : content,
            });
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* folder may not exist or be unreadable */ }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // User Command FS & Session Compaction
  // ═══════════════════════════════════════════════════════════════════════════

  getUserCommandFileSystem(): { listCommandFiles(): Promise<string[]>; readCommandFile(relativePath: string): Promise<string> } | undefined {
    if (!this._d.fsAccessor) { return undefined; }
    const fsAccessor = this._d.fsAccessor;
    return {
      async listCommandFiles() {
        try {
          const entries = await fsAccessor.readdir('.parallx/commands');
          return entries
            .filter(e => e.type === 'file' && e.name.endsWith('.md'))
            .map(e => `.parallx/commands/${e.name}`);
        } catch { return []; }
      },
      async readCommandFile(relativePath: string) {
        return await fsAccessor.readFile(relativePath);
      },
    };
  }

  compactSession(sessionId: string, summaryText: string): void {
    const session = this._d.chatService.getSession(sessionId);
    if (!session) return;
    const messages = session.messages as IChatRequestResponsePair[];
    messages.splice(0, messages.length, {
      request: { text: '[Compacted conversation history]' },
      response: {
        parts: [{ kind: ChatContentPartKind.Markdown, content: summaryText }],
        isComplete: true,
      },
    } as IChatRequestResponsePair);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace & Canvas Participant Data
  // ═══════════════════════════════════════════════════════════════════════════

  async listPages(): Promise<readonly IPageSummary[]> {
    if (!this._d.databaseService?.isOpen) { return []; }
    try {
      return await this._d.databaseService.all<IPageSummary>(
        'SELECT id, title, icon FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?',
        [100],
      );
    } catch { return []; }
  }

  async searchPages(query: string): Promise<readonly IPageSummary[]> {
    if (!this._d.databaseService?.isOpen) { return []; }
    try {
      return await this._d.databaseService.all<IPageSummary>(
        'SELECT id, title, icon FROM pages WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC LIMIT ?',
        [`%${query}%`, 20],
      );
    } catch { return []; }
  }

  async getPageContent(pageId: string): Promise<string | null> {
    if (!this._d.databaseService?.isOpen) { return null; }
    try {
      const row = await this._d.databaseService.get<{ content: string }>(
        'SELECT content FROM pages WHERE id = ?', [pageId],
      );
      return row?.content ?? null;
    } catch { return null; }
  }

  async getPageTitle(pageId: string): Promise<string | null> {
    if (!this._d.databaseService?.isOpen) { return null; }
    try {
      const row = await this._d.databaseService.get<{ title: string }>(
        'SELECT title FROM pages WHERE id = ?', [pageId],
      );
      return row?.title ?? null;
    } catch { return null; }
  }

  getCurrentPageId(): string | undefined {
    return extractCanvasPageId(this._d.editorService?.activeEditor?.id);
  }

  async getPageStructure(pageId: string): Promise<IPageStructure | null> {
    if (!this._d.databaseService?.isOpen) { return null; }
    try {
      const page = await this._d.databaseService.get<{ id: string; title: string; icon?: string }>(
        'SELECT id, title, icon FROM pages WHERE id = ?', [pageId],
      );
      if (!page) { return null; }

      const blocks = await this._d.databaseService.all<{
        id: string;
        block_type: string;
        parent_block_id: string | null;
        sort_order: number;
        content_json: string;
      }>(
        'SELECT id, block_type, parent_block_id, sort_order, content_json FROM canvas_blocks WHERE page_id = ? ORDER BY sort_order',
        [pageId],
      );

      const blockSummaries: IBlockSummary[] = blocks.map((b) => ({
        id: b.id,
        blockType: b.block_type,
        parentBlockId: b.parent_block_id,
        sortOrder: b.sort_order,
        textPreview: extractBlockPreview(b.content_json),
      }));

      return {
        pageId: page.id,
        title: page.title,
        icon: page.icon,
        blocks: blockSummaries,
      };
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Widget Data Methods
  // ═══════════════════════════════════════════════════════════════════════════

  async listWorkspaceFiles(): Promise<IWorkspaceFileEntry[]> {
    const rootFolders = this._d.workspaceService?.folders ?? [];
    if (rootFolders.length === 0 || !this._d.fileService) { return []; }
    const rootUri = rootFolders[0].uri;
    const result: IWorkspaceFileEntry[] = [];

    // Recursive walk (breadth-first, up to 500 entries, max depth 6)
    const queue: { uri: import('../../../platform/uri.js').URI; rel: string }[] =
      [{ uri: rootUri, rel: '' }];
    const MAX_ENTRIES = 500;
    const MAX_DEPTH = 6;

    while (queue.length > 0 && result.length < MAX_ENTRIES) {
      const current = queue.shift()!;
      const depth = current.rel.split('/').filter(Boolean).length;
      try {
        const entries = await this._d.fileService.readdir(current.uri);
        for (const entry of entries) {
          if (result.length >= MAX_ENTRIES) { break; }
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
            continue;
          }
          const relPath = current.rel ? `${current.rel}/${entry.name}` : entry.name;
          const isDir = entry.type === 2; /* FileType.Directory */
          result.push({
            name: entry.name,
            fullPath: entry.uri.fsPath,
            relativePath: relPath,
            isDirectory: isDir,
          });
          if (isDir && depth < MAX_DEPTH) {
            queue.push({ uri: entry.uri, rel: relPath });
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    return result;
  }

  async getSystemPrompt(): Promise<string> {
    const mode = ChatMode.Agent; // Show the full agent prompt (most complete)
    const pageCount = this._d.databaseService?.isOpen
      ? (await this._d.databaseService.all<{ id: string }>('SELECT id FROM pages')).length
      : 0;
    const fileCount = this._d.fsAccessor
      ? await (async () => { try { return (await this._d.fsAccessor!.readdir('')).length; } catch { return 0; } })()
      : 0;

    // Read prompt overlay if available
    let promptOverlay: string | undefined;
    if (this._d.promptFileService) {
      try {
        const layers = await this._d.promptFileService.loadLayers();
        promptOverlay = this._d.promptFileService.assemblePromptOverlay(layers);
      } catch { /* best-effort */ }
    }

    return buildSystemPrompt(mode, {
      workspaceName: this._d.workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace',
      pageCount,
      currentPageTitle: undefined,
      tools: this._d.languageModelToolsService?.getToolDefinitions() ?? [],
      fileCount,
      isRAGAvailable: !!this._d.retrievalService,
      isIndexing: false,
      promptOverlay,
    });
  }

  async searchSessions(query: string): Promise<Array<{ sessionId: string; sessionTitle: string; matchingContent: string }>> {
    if (!this._d.databaseService) { return []; }
    const { searchSessions } = await import('../../../services/chatSessionPersistence.js');
    const workspaceId = this._d.workspaceService?.activeWorkspace?.id ?? '';
    return searchSessions(this._d.databaseService, query, workspaceId);
  }

  openFile(fullPath: string): void {
    // Resolve workspace-relative paths (e.g. "Claims Guide.md") to absolute
    // filesystem paths, then open via the same EditorsBridge resolver the
    // explorer uses.  This ensures correct editor type selection (text, image,
    // PDF, markdown preview), deduplication of already-open tabs, and
    // consistent behaviour across all file-opening surfaces.
    if (!this._d.openFileEditor) { return; }

    let fsPath: string;
    const isAbsolute = /^[/\\]/.test(fullPath) || /^[a-zA-Z]:/.test(fullPath);
    if (isAbsolute) {
      fsPath = fullPath;
    } else if (this._d.workspaceService?.folders?.length) {
      // Workspace-relative → join with root folder's filesystem path
      const rootFsPath = this._d.workspaceService.folders[0].uri.fsPath;
      // Normalize: rootFsPath uses forward slashes from URI.fsPath
      fsPath = rootFsPath.endsWith('/') ? rootFsPath + fullPath : rootFsPath + '/' + fullPath;
    } else {
      fsPath = fullPath;
    }

    this._d.openFileEditor(fsPath, { pinned: true }).catch((err) => {
      console.error('[ChatDataService] openFile failed:', err);
    });
  }

  /**
   * Open a session memory entry in a read-only editor tab formatted as Markdown.
   *
   * Called when the user clicks a "Session Memory" citation badge.  Fetches the
   * stored summary for the given sessionId from IMemoryService and displays it
   * as an untitled editor so the user can review what the AI "remembered".
   */
  async openMemoryViewer(sessionId: string): Promise<void> {
    if (!this._d.memoryService || !this._d.editorService) {
      console.warn('[ChatDataService] openMemoryViewer: missing memoryService or editorService');
      return;
    }
    console.log('[ChatDataService] openMemoryViewer for session:', sessionId);

    try {
      const memories = await this._d.memoryService.getAllMemories();
      const match = memories.find((m) => m.sessionId === sessionId);

      let content: string;
      if (match) {
        const lines = [
          `# Session Memory`,
          ``,
          `**Session ID:** \`${match.sessionId}\`  `,
          `**Created:** ${match.createdAt}  `,
          `**Messages in session:** ${match.messageCount}`,
          ``,
          `---`,
          ``,
          `## Summary`,
          ``,
          match.summary,
        ];
        content = lines.join('\n');
      } else {
        content = [
          `# Session Memory`,
          ``,
          `No memory found for session \`${sessionId}\`.`,
          ``,
          `The memory may have been pruned or the session may still be in progress.`,
        ].join('\n');
      }

      const input = ReadonlyMarkdownInput.create(content, 'Session Memory');
      await this._d.editorService.openEditor(input, { pinned: false });
    } catch (err) {
      console.error('[ChatDataService] openMemoryViewer failed:', err);
    }
  }

  async getContextLength(): Promise<number> {
    const modelId = this._d.languageModelsService.getActiveModel();
    if (modelId && this._d.ollamaProvider) {
      return this._d.ollamaProvider.getModelContextLength(modelId);
    }
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace Digest
  // ═══════════════════════════════════════════════════════════════════════════

  async getWorkspaceDigest(): Promise<string | undefined> {
    const now = Date.now();
    if (this._cachedDigest !== undefined && now - this._cacheTimestamp < ChatDataService.DIGEST_TTL_MS) {
      return this._cachedDigest;
    }

    const result = await this._computeWorkspaceDigest();
    this._cachedDigest = result;
    this._cacheTimestamp = now;
    return result;
  }

  private async _computeWorkspaceDigest(): Promise<string | undefined> {
    const sections: string[] = [];

    // Dynamic digest cap based on model context window (M16 Task 3.2).
    // System prompt gets 10% of context; digest gets at most 60% of that
    // (leaving room for SOUL.md, AGENTS.md, rules, citation instructions).
    // Fallback: 8192 context → 10% = 819 tokens → 60% = 491 tokens → ~2000 chars.
    // For large contexts (128K): 10% = 12800 → 60% = 7680 → ~30720 chars → capped at 12000.
    const contextLength = await this.getContextLength();
    const effectiveContext = contextLength > 0 ? contextLength : 8192;
    const systemBudgetTokens = Math.floor(effectiveContext * 0.10);
    const digestBudgetTokens = Math.floor(systemBudgetTokens * 0.60);
    const MAX_DIGEST_CHARS = Math.min(digestBudgetTokens * 4, 12000); // hard cap at 12K chars
    let totalChars = 0;

    // Pre-load document summaries from indexing_metadata.
    // These are brief content descriptions (first ~200 chars) generated during
    // indexing so the AI knows what each file/page contains, not just its name.
    const summaries = new Map<string, string>();
    if (this._d.databaseService?.isOpen) {
      try {
        const rows = await this._d.databaseService.all<{ source_id: string; summary: string }>(
          `SELECT source_id, summary FROM indexing_metadata WHERE summary IS NOT NULL AND summary != ''`,
        );
        for (const row of rows) {
          summaries.set(row.source_id, row.summary);
        }
      } catch { /* best-effort — column may not exist yet */ }
    }

    // 1. Canvas page titles (with content summaries when available)
    if (this._d.databaseService?.isOpen) {
      try {
        const pages = await this._d.databaseService.all<{ title: string; id: string }>(
          'SELECT title, id FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT 30',
        );
        if (pages.length > 0) {
          const pageLines = pages.map(p => {
            const pageSummary = summaries.get(p.id);
            return pageSummary
              ? `  - ${p.title} — ${pageSummary}`
              : `  - ${p.title}`;
          });
          const block = `CANVAS PAGES (${pages.length}):\n${pageLines.join('\n')}`;
          sections.push(block);
          totalChars += block.length;
        }
      } catch { /* best-effort */ }
    }

    // 2. Workspace file tree — breadth-first, no artificial depth/entry caps.
    //    The only limit is MAX_DIGEST_CHARS which caps the total system prompt
    //    budget. The AI should see EVERY file the workspace contains; the
    //    context window is the natural constraint, not arbitrary constants.
    //    Files are annotated with content summaries so the AI knows what's
    //    INSIDE each file, not just its name.
    if (this._d.fsAccessor) {
      try {
        const treeLines: string[] = [];
        let treeChars = 0;
        const fsAccessor = this._d.fsAccessor;

        // Breadth-first queue: each item is { dir, depth, prefix }
        type QueueItem = { dir: string; depth: number; prefix: string };
        const queue: QueueItem[] = [{ dir: '.', depth: 0, prefix: '  ' }];

        while (queue.length > 0) {
          const { dir, depth, prefix } = queue.shift()!;

          let entries;
          try {
            entries = await fsAccessor.readdir(dir);
          } catch { continue; }

          const sorted = [...entries].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });

          for (const entry of sorted) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;
            const icon = entry.type === 'directory' ? '📁' : '📄';
            // Build workspace-relative path for summary lookup
            const relPath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
            const fileSummary = entry.type !== 'directory' ? summaries.get(relPath) : undefined;
            const line = fileSummary
              ? `${prefix}${icon} ${entry.name} — ${fileSummary}`
              : `${prefix}${icon} ${entry.name}`;
            treeLines.push(line);
            treeChars += line.length + 1;
            if (entry.type === 'directory') {
              queue.push({ dir: relPath, depth: depth + 1, prefix: prefix + '  ' });
            }
          }

          // Budget check: stop walking if we've already exceeded the char budget.
          // We check the running tree size against the remaining budget so we
          // don't waste time traversing a massive repo we can't fit anyway.
          const runningSize = treeChars + 20; // +20 for header
          if (totalChars + runningSize >= MAX_DIGEST_CHARS) break;
        }
        if (treeLines.length > 0) {
          const block = `WORKSPACE FILES:\n${treeLines.join('\n')}`;
          if (totalChars + block.length < MAX_DIGEST_CHARS) {
            sections.push(block);
            totalChars += block.length;
          }
        }
      } catch { /* best-effort */ }
    }

    // 3. Key file previews (README, SOUL.md, etc.)
    if (this._d.fsAccessor) {
      const keyFiles = ['README.md', 'README.txt', 'README', 'SOUL.md', 'AGENTS.md'];
      for (const fileName of keyFiles) {
        if (totalChars >= MAX_DIGEST_CHARS) break;
        try {
          const exists = await this._d.fsAccessor.exists(fileName);
          if (!exists) continue;
          const content = await this._d.fsAccessor.readFile(fileName);
          const preview = content.length > 500 ? content.slice(0, 500) + '\n...(truncated)' : content;
          const block = `KEY FILE — ${fileName}:\n\`\`\`\n${preview}\n\`\`\``;
          if (totalChars + block.length < MAX_DIGEST_CHARS) {
            sections.push(block);
            totalChars += block.length;
          }
        } catch { /* best-effort */ }
      }
    }

    return sections.length > 0
      ? `HERE IS WHAT EXISTS IN THIS WORKSPACE (file names and brief summaries):\n\n${sections.join('\n\n')}\n\nIMPORTANT: The list above shows file NAMES and short previews only — NOT the full content of each file. You have NOT read every document. When the user asks about specific file content, rely on [Retrieved Context] chunks provided in the user message, or use search_knowledge / read_file tools to look up the actual content. NEVER guess or fabricate what a file contains based on its title alone.`
      : undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Builder Methods
  // ═══════════════════════════════════════════════════════════════════════════

  buildDefaultParticipantServices(): IDefaultParticipantServices {
    return buildChatDefaultParticipantServices({
      sendChatRequest: (m, o, s) => this.sendChatRequest(m, o, s),
      getActiveModel: () => this.getActiveModel(),
      getWorkspaceName: () => this.getWorkspaceName(),
      getPageCount: () => this.getPageCount(),
      getCurrentPageTitle: () => this.getCurrentPageTitle(),
      getToolDefinitions: () => this.getToolDefinitions(),
      getReadOnlyToolDefinitions: () => this.getReadOnlyToolDefinitions(),
      invokeTool: (n, a, t) => this.invokeTool(n, a, t),
      maxIterations: this._d.unifiedConfigService?.getEffectiveConfig().agent.maxIterations ?? this._d.maxIterations,
      networkTimeout: this._d.networkTimeout,
      getModelContextLength: () => this.getModelContextLength(),
      sendSummarizationRequest: (m, s) => this.sendSummarizationRequest(m, s),
      getFileCount: this._d.fsAccessor ? () => this.getFileCount() : undefined,
      isRAGAvailable: () => this.isRAGAvailable(),
      isIndexing: () => this.isIndexing(),
      readFileContent: (p) => this.readFileContent(p),
      getCurrentPageContent: () => this.getCurrentPageContent(),
      retrieveContext: this._d.retrievalService
        ? (q) => this.retrieveContext(q) as Promise<{ text: string; sources: Array<{ uri: string; label: string; index: number }> } | undefined>
        : undefined,
      recallMemories: this._d.memoryService ? (q, s) => this.recallMemories(q, s) : undefined,
      storeSessionMemory: this._d.memoryService ? (s, su, m) => this.storeSessionMemory(s, su, m) : undefined,
      storeConceptsFromSession: this._d.memoryService ? (c, s) => this.storeConceptsFromSession(c, s) : undefined,
      recallConcepts: this._d.memoryService ? (q) => this.recallConcepts(q) : undefined,
      isSessionEligibleForSummary: this._d.memoryService ? (m) => this.isSessionEligibleForSummary(m) : undefined,
      hasSessionMemory: this._d.memoryService ? (s) => this.hasSessionMemory(s) : undefined,
      getSessionMemoryMessageCount: this._d.memoryService ? (s) => this.getSessionMemoryMessageCount(s) : undefined,
      extractPreferences: this._d.memoryService ? (t) => this.extractPreferences(t) : undefined,
      getPreferencesForPrompt: this._d.memoryService ? () => this.getPreferencesForPrompt() : undefined,
      getPromptOverlay: this._d.promptFileService ? (a) => this.getPromptOverlay(a) : undefined,
      listFilesRelative: this._d.fsAccessor ? (r) => this.listFilesRelative(r) : undefined,
      readFileRelative: this._d.fsAccessor ? (r) => this.readFileRelative(r) : undefined,
      writeFileRelative: (this._d.fileService && this._d.workspaceService?.folders?.length)
        ? (r, c) => this.writeFileRelative(r, c)
        : undefined,
      existsRelative: this._d.fsAccessor ? (r) => this.existsRelative(r) : undefined,
      invalidatePromptFiles: this._d.promptFileService ? () => this.invalidatePromptFiles() : undefined,
      reportContextPills: (p) => this.reportContextPills(p),
      reportRetrievalDebug: (debug) => this.reportRetrievalDebug(debug),
      reportResponseDebug: (debug) => this.reportResponseDebug(debug),
      reportRuntimeTrace: (trace) => this.reportRuntimeTrace(trace),
      getExcludedContextIds: () => this.getExcludedContextIds(),
      reportBudget: (s) => this.reportBudget(s),
      getTerminalOutput: () => this.getTerminalOutput(),
      listFolderFiles: this._d.fsAccessor ? (f) => this.listFolderFiles(f) : undefined,
      userCommandFileSystem: this.getUserCommandFileSystem(),
      compactSession: (s, t) => this.compactSession(s, t),
      getWorkspaceDigest: () => this.getWorkspaceDigest(),
      sessionManager: this._d.sessionManager,
      aiSettingsService: this._d.aiSettingsService,
      unifiedConfigService: this._d.unifiedConfigService,
    });
  }

  buildWorkspaceParticipantServices(): IWorkspaceParticipantServices {
    return {
      sendChatRequest: (m, o, s) => this.sendChatRequest(m, o, s),
      getActiveModel: () => this.getActiveModel(),
      getWorkspaceName: () => this.getWorkspaceName(),
      listPages: () => this.listPages(),
      searchPages: (q) => this.searchPages(q),
      getPageContent: (p) => this.getPageContent(p),
      getPageTitle: (p) => this.getPageTitle(p),
      listFiles: this._d.fsAccessor
        ? (r) => this._d.fsAccessor!.readdir(r)
        : undefined,
      readFileContent: this._d.fsAccessor
        ? (r) => this._d.fsAccessor!.readFile(r)
        : undefined,
    };
  }

  buildCanvasParticipantServices(): ICanvasParticipantServices {
    return {
      sendChatRequest: (m, o, s) => this.sendChatRequest(m, o, s),
      getActiveModel: () => this.getActiveModel(),
      getWorkspaceName: () => this.getWorkspaceName(),
      getCurrentPageId: () => this.getCurrentPageId(),
      getCurrentPageTitle: () => this.getCurrentPageTitle(),
      getPageStructure: (p) => this.getPageStructure(p),
    };
  }

  buildWidgetServices(): IChatWidgetServices {
    const agentTaskServices = buildChatAgentTaskWidgetServices({
      agentSessionService: this._d.agentSessionService,
      agentApprovalService: this._d.agentApprovalService,
      agentExecutionService: this._d.agentExecutionService,
      agentTraceService: this._d.agentTraceService,
    });
    const pickerServices = buildChatWidgetPickerServices({
      getModels: () => this._d.languageModelsService.getModels(),
      getActiveModel: () => this._d.languageModelsService.getActiveModel(),
      setActiveModel: (modelId: string) => this._d.languageModelsService.setActiveModel(modelId),
      onDidChangeModels: this._d.languageModelsService.onDidChangeModels,
      getModelContextLength: (modelId: string) => this._d.ollamaProvider.getModelContextLength(modelId) ?? Promise.resolve(0),
      getMode: () => this._d.modeService.getMode(),
      setMode: (mode) => this._d.modeService.setMode(mode),
      getAvailableModes: () => this._d.modeService.getAvailableModes(),
      onDidChangeMode: this._d.modeService.onDidChangeMode,
    });
    const attachmentServices = buildChatWidgetAttachmentServices({
      getOpenEditorFiles: this._d.editorService
        ? () => this._d.editorService!.getOpenEditors().map((ed) => {
            const parts = ed.id.split(':');
            if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
              const pageId = parts.slice(2).join(':');
              return { name: ed.name, fullPath: `parallx-page://${pageId}` };
            }
            return { name: ed.name, fullPath: ed.description || ed.name };
          })
        : undefined,
      onDidChangeOpenEditors: this._d.editorService?.onDidChangeOpenEditors,
      listWorkspaceFiles: this._d.fsAccessor
        ? () => this.listWorkspaceFiles()
        : undefined,
      openFile: (this._d.editorService && this._d.fileService)
        ? (fullPath: string) => this.openFile(fullPath)
        : undefined,
      openPage: this._d.openPage
        ? (pageId: string) => { this._d.openPage!(pageId); }
        : undefined,
      openMemory: (this._d.memoryService && this._d.editorService)
        ? (sessionId: string) => { this.openMemoryViewer(sessionId); }
        : undefined,
    });
    const sessionServices = buildChatWidgetSessionServices({
      getSessions: () => this._d.chatService.getSessions(),
      getSession: (id: string) => this._d.chatService.getSession(id),
      deleteSession: (id: string) => this._d.chatService.deleteSession(id),
      getSystemPrompt: () => this.getSystemPrompt(),
      readFileRelative: this._d.fsAccessor
        ? (relativePath: string) => this.readFileRelative(relativePath)
        : undefined,
      writeFileRelative: (this._d.fileService && this._d.workspaceService?.folders?.length)
        ? (relativePath: string, content: string) => this.writeFileRelative(relativePath, content)
        : undefined,
      searchSessions: this._d.databaseService
        ? (query: string) => this.searchSessions(query)
        : undefined,
    });
    const requestServices = buildChatWidgetRequestServices({
      sendRequest: async (sessionId, message, attachments) => {
        await this._d.chatService.sendRequest(sessionId, message, attachments ? { attachments: attachments as any } : undefined);
      },
      cancelRequest: (sessionId: string) => {
        this._d.chatService.cancelRequest(sessionId);
      },
      createSession: () => this._d.chatService.createSession(),
      onDidChangeSession: this._d.chatService.onDidChangeSession as Event<string>,
      getProviderStatus: () => ({
        available: (this._d.ollamaProvider as any).getLastStatus?.()?.available ?? false,
      }),
      onDidChangeProviderStatus: (this._d.ollamaProvider as any).onDidChangeStatus as Event<void>,
      queueRequest: (sessionId: string, message: string, kind: ChatRequestQueueKind) =>
        this._d.chatService.queueRequest(sessionId, message, kind),
      removePendingRequest: (sessionId: string, requestId: string) =>
        this._d.chatService.removePendingRequest(sessionId, requestId),
      requestYield: (sessionId: string) =>
        this._d.chatService.requestYield(sessionId),
      onDidChangePendingRequests: this._d.chatService.onDidChangePendingRequests,
    });

    return {
      ...requestServices,
      ...pickerServices,
      ...attachmentServices,
      ...sessionServices,
      ...agentTaskServices,
    };
  }

  buildTokenBarServices(): ITokenStatusBarServices {
    return buildChatTokenBarServices({
      getActiveWidget: this._d.getActiveWidget,
      getContextLength: () => this.getContextLength(),
      getMode: () => this._d.modeService.getMode() as ChatMode,
      getWorkspaceName: () => this.getWorkspaceName(),
      getPageCount: () => this.getPageCount(),
      getCurrentPageTitle: () => this.getCurrentPageTitle(),
      getToolDefinitions: () => this.getToolDefinitions(),
      getFileCount: () => this.getFileCount(),
      isRAGAvailable: () => this.isRAGAvailable(),
      isIndexing: () => this.isIndexing(),
      getIndexingProgress: () => this._d.indexingPipelineService?.progress ?? { phase: 'idle' as const, processed: 0, total: 0 },
      getIndexStats: () => this._lastIndexStats,
    });
  }
}
