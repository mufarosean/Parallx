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
  IWorkspaceParticipantServices,
  ICanvasParticipantServices,
  IChatWidgetServices,
  ITokenStatusBarServices,
  IBuiltInToolFileSystem,
  IPageSummary,
  IBlockSummary,
  IPageStructure,
  IRetrievalPlan,
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
} from '../../../services/chatTypes.js';
import {
  ChatContentPartKind,
  ChatMode,
} from '../../../services/chatTypes.js';

import type { Event } from '../../../platform/events.js';

import type { IDatabaseService, IFileService, IWorkspaceService, IEditorService, IRetrievalService, IIndexingPipelineService, IMemoryService, ITextFileModelManager } from '../../../services/serviceTypes.js';
import type { ILanguageModelsService, IChatService, IChatModeService, ILanguageModelToolsService } from '../../../services/chatTypes.js';
import type { OllamaProvider } from '../providers/ollamaProvider.js';
import type { PromptFileService } from '../../../services/promptFileService.js';
import type { ChatWidget } from '../widgets/chatWidget.js';

import { buildPlannerPrompt, buildSystemPrompt } from '../config/chatSystemPrompts.js';
import { extractTextContent } from '../tools/builtInTools.js';

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
  if (chunk.sourceType === 'conversation_memory') {
    return 'Session Memory';
  }

  // Try to extract Source: "..." from the contextPrefix
  if (prefix) {
    const m = /Source:\s*"([^"]+)"/.exec(prefix);
    if (m) {
      const raw = m[1];
      // For file paths, extract just the filename
      if (chunk.sourceType === 'file' || raw.includes('/') || raw.includes('\\')) {
        const segments = raw.replace(/\\/g, '/').split('/');
        return segments[segments.length - 1] || raw;
      }
      // For pages the source is the page title — use as-is
      return raw;
    }
  }

  // Fallback: derive from sourceId
  if (chunk.sourceType === 'page') {
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
 * Returns undefined if no workspace folder is open.
 */
export function buildFileSystemAccessor(
  fileService: IFileService | undefined,
  workspaceService: IWorkspaceService | undefined,
): IBuiltInToolFileSystem | undefined {
  if (!fileService || !workspaceService) { return undefined; }

  const folders = workspaceService.folders;
  if (!folders || folders.length === 0) { return undefined; }

  const rootUri = folders[0].uri;
  const rootName = workspaceService.activeWorkspace?.name ?? folders[0].name;

  function resolveUri(relativePath: string): import('../../../platform/uri.js').URI {
    const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
    if (!clean || clean === '.') { return rootUri; }
    return rootUri.joinPath(clean);
  }

  return {
    workspaceRootName: rootName,

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

  constructor(private readonly _d: ChatDataServiceDeps) {}

  /** Called by the indexing-complete listener in chatTool.ts. */
  setLastIndexStats(stats: { pages: number; files: number }): void {
    this._lastIndexStats = stats;
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

  async retrieveContext(query: string): Promise<{ text: string; sources: Array<{ uri: string; label: string }> } | undefined> {
    if (!this._d.retrievalService) { return undefined; }
    if (!this._d.indexingPipelineService?.isInitialIndexComplete) { return undefined; }
    try {
      const chunks = await this._d.retrievalService.retrieve(query, {
        topK: 8,
        maxPerSource: 3,
        tokenBudget: 3000,
      });
      if (chunks.length === 0) { return undefined; }
      const text = this._d.retrievalService.formatContext(chunks);
      const sources = this._buildSourceCitations(chunks);
      return { text, sources };
    } catch { return undefined; }
  }

  async planAndRetrieve(
    userText: string,
    recentHistory?: string,
    workspaceDigest?: string,
  ): Promise<{ text: string; sources: Array<{ uri: string; label: string }>; plan?: IRetrievalPlan } | undefined> {
    if (!this._d.retrievalService || !this._d.ollamaProvider) { return undefined; }
    if (!this._d.indexingPipelineService?.isInitialIndexComplete) { return undefined; }

    try {
      // Build planner messages
      const plannerSystemPrompt = buildPlannerPrompt(workspaceDigest);
      const plannerMessages: IChatMessage[] = [
        { role: 'system', content: plannerSystemPrompt },
      ];

      // Include recent history for contextual understanding
      if (recentHistory) {
        plannerMessages.push({
          role: 'user',
          content: `Recent conversation context:\n${recentHistory}\n\nNow analyse the LATEST message below.`,
        });
        plannerMessages.push({
          role: 'assistant',
          content: 'I understand the context. Please provide the latest user message.',
        });
      }

      plannerMessages.push({ role: 'user', content: userText });

      // Run the planner LLM call
      const modelId = this._d.languageModelsService.getActiveModel() ?? '';
      const plan = await this._d.ollamaProvider.planRetrieval(modelId, plannerMessages);

      // If planner says no retrieval needed, return empty with plan metadata
      if (!plan.needsRetrieval || plan.queries.length === 0) {
        return { text: '', sources: [], plan };
      }

      // Multi-query retrieval
      const chunks = await this._d.retrievalService.retrieveMulti(plan.queries, {
        topK: 10,
        maxPerSource: 3,
        tokenBudget: 3500,
      });

      if (chunks.length === 0) { return { text: '', sources: [], plan }; }

      const text = this._d.retrievalService.formatContext(chunks);
      const sources = this._buildSourceCitations(chunks);
      return { text, sources, plan };
    } catch (err) {
      // Graceful degradation: fall back to single-query retrieval
      console.warn('[chatTool] planAndRetrieve failed, falling back to single query:', err);
      try {
        const chunks = await this._d.retrievalService.retrieve(userText, {
          topK: 8,
          maxPerSource: 3,
          tokenBudget: 3000,
        });
        if (chunks.length === 0) { return undefined; }
        const text = this._d.retrievalService.formatContext(chunks);
        const sources = this._buildSourceCitations(chunks);
        return { text, sources };
      } catch { return undefined; }
    }
  }

  /** Build deduplicated source citations from retrieval chunks. */
  private _buildSourceCitations(chunks: readonly { sourceType: string; sourceId: string; contextPrefix?: string }[]): Array<{ uri: string; label: string }> {
    const seen = new Set<string>();
    const sources: Array<{ uri: string; label: string }> = [];
    for (const chunk of chunks) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const uri = chunk.sourceType === 'page'
        ? `parallx-page://${chunk.sourceId}`
        : chunk.sourceId;
      const label = extractCitationLabel(chunk);
      sources.push({ uri, label });
    }
    return sources;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Memory & Preferences
  // ═══════════════════════════════════════════════════════════════════════════

  async recallMemories(query: string): Promise<string | undefined> {
    if (!this._d.memoryService) { return undefined; }
    try {
      const memories = await this._d.memoryService.recallMemories(query);
      if (memories.length === 0) { return undefined; }
      return this._d.memoryService.formatMemoryContext(memories);
    } catch { return undefined; }
  }

  async storeSessionMemory(sessionId: string, summary: string, messageCount: number): Promise<void> {
    if (!this._d.memoryService) { return; }
    try { await this._d.memoryService.storeMemory(sessionId, summary, messageCount); } catch { /* best-effort */ }
  }

  isSessionEligibleForSummary(messageCount: number): boolean {
    return this._d.memoryService?.isSessionEligibleForSummary(messageCount) ?? false;
  }

  async hasSessionMemory(sessionId: string): Promise<boolean> {
    if (!this._d.memoryService) { return false; }
    try { return await this._d.memoryService.hasMemory(sessionId); } catch { return false; }
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
    const widget = this._d.getActiveWidget();
    if (widget) {
      widget.setContextPills(pills);
    }
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
    return searchSessions(this._d.databaseService, query);
  }

  openFile(fullPath: string): void {
    if (!this._d.editorService || !this._d.fileService) { return; }
    const editorService = this._d.editorService;
    const fileService = this._d.fileService;
    const textFileManager = this._d.textFileModelManager;
    import('../../../platform/uri.js').then(({ URI }) => {
      return import('../../editor/fileEditorInput.js').then(({ FileEditorInput }) => {
        const uri = URI.file(fullPath);
        if (textFileManager) {
          const input = FileEditorInput.create(uri, textFileManager, fileService);
          editorService.openEditor(input);
        }
      });
    }).catch(() => { /* best-effort */ });
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
    const MAX_DIGEST_CHARS = 8000; // ~2000 tokens at 4 chars/token
    let totalChars = 0;

    // 1. Canvas page titles
    if (this._d.databaseService?.isOpen) {
      try {
        const pages = await this._d.databaseService.all<{ title: string; id: string }>(
          'SELECT title, id FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT 30',
        );
        if (pages.length > 0) {
          const pageLines = pages.map(p => `  - ${p.title}`);
          const block = `CANVAS PAGES (${pages.length}):\n${pageLines.join('\n')}`;
          sections.push(block);
          totalChars += block.length;
        }
      } catch { /* best-effort */ }
    }

    // 2. Workspace file tree (depth 3, max 80 entries)
    if (this._d.fsAccessor) {
      try {
        const treeLines: string[] = [];
        const MAX_TREE_ENTRIES = 80;
        let treeCount = 0;
        const fsAccessor = this._d.fsAccessor;

        async function walkTree(dir: string, depth: number, prefix: string): Promise<void> {
          if (depth > 3 || treeCount >= MAX_TREE_ENTRIES) return;
          const entries = await fsAccessor.readdir(dir);
          const sorted = [...entries].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          for (const entry of sorted) {
            if (treeCount >= MAX_TREE_ENTRIES) break;
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;
            const icon = entry.type === 'directory' ? '📁' : '📄';
            treeLines.push(`${prefix}${icon} ${entry.name}`);
            treeCount++;
            if (entry.type === 'directory') {
              const childPath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
              await walkTree(childPath, depth + 1, prefix + '  ');
            }
          }
        }

        await walkTree('.', 0, '  ');
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
      ? `YOU ALREADY KNOW THIS WORKSPACE. Here is what exists:\n\n${sections.join('\n\n')}\n\nUse this knowledge to answer directly. You do NOT need to discover what files exist — you already know.`
      : undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Builder Methods
  // ═══════════════════════════════════════════════════════════════════════════

  buildDefaultParticipantServices(): IDefaultParticipantServices {
    return {
      sendChatRequest: (m, o, s) => this.sendChatRequest(m, o, s),
      getActiveModel: () => this.getActiveModel(),
      getWorkspaceName: () => this.getWorkspaceName(),
      getPageCount: () => this.getPageCount(),
      getCurrentPageTitle: () => this.getCurrentPageTitle(),
      getToolDefinitions: () => this.getToolDefinitions(),
      getReadOnlyToolDefinitions: () => this.getReadOnlyToolDefinitions(),
      invokeTool: (n, a, t) => this.invokeTool(n, a, t),
      maxIterations: this._d.maxIterations,
      networkTimeout: this._d.networkTimeout,
      getModelContextLength: () => this.getModelContextLength(),
      sendSummarizationRequest: (m, s) => this.sendSummarizationRequest(m, s),
      getFileCount: this._d.fsAccessor ? () => this.getFileCount() : undefined,
      isRAGAvailable: () => this.isRAGAvailable(),
      isIndexing: () => this.isIndexing(),
      readFileContent: (p) => this.readFileContent(p),
      getCurrentPageContent: () => this.getCurrentPageContent(),
      retrieveContext: this._d.retrievalService
        ? (q) => this.retrieveContext(q) as Promise<{ text: string; sources: Array<{ uri: string; label: string }> } | undefined>
        : undefined,
      planAndRetrieve: (this._d.retrievalService && this._d.ollamaProvider)
        ? (u, r, w) => this.planAndRetrieve(u, r, w)
        : undefined,
      recallMemories: this._d.memoryService ? (q) => this.recallMemories(q) : undefined,
      storeSessionMemory: this._d.memoryService ? (s, su, m) => this.storeSessionMemory(s, su, m) : undefined,
      isSessionEligibleForSummary: this._d.memoryService ? (m) => this.isSessionEligibleForSummary(m) : undefined,
      hasSessionMemory: this._d.memoryService ? (s) => this.hasSessionMemory(s) : undefined,
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
      getExcludedContextIds: () => this.getExcludedContextIds(),
      reportBudget: (s) => this.reportBudget(s),
      getTerminalOutput: () => this.getTerminalOutput(),
      listFolderFiles: this._d.fsAccessor ? (f) => this.listFolderFiles(f) : undefined,
      userCommandFileSystem: this.getUserCommandFileSystem(),
      compactSession: (s, t) => this.compactSession(s, t),
      getWorkspaceDigest: () => this.getWorkspaceDigest(),
    };
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
    return {
      sendRequest: async (sessionId, message, attachments?) => {
        await this._d.chatService.sendRequest(sessionId, message, attachments ? { attachments } : undefined);
      },
      cancelRequest: (sessionId) => {
        this._d.chatService.cancelRequest(sessionId);
      },
      createSession: () => this._d.chatService.createSession(),
      onDidChangeSession: this._d.chatService.onDidChangeSession as Event<string>,
      getProviderStatus: () => ({
        available: (this._d.ollamaProvider as any).getLastStatus?.()?.available ?? false,
      }),
      onDidChangeProviderStatus: (this._d.ollamaProvider as any).onDidChangeStatus as Event<void>,
      modelPicker: {
        getModels: () => this._d.languageModelsService.getModels(),
        getActiveModel: () => this._d.languageModelsService.getActiveModel(),
        setActiveModel: (modelId: string) => this._d.languageModelsService.setActiveModel(modelId),
        onDidChangeModels: this._d.languageModelsService.onDidChangeModels,
        getModelContextLength: (modelId: string) => this._d.ollamaProvider.getModelContextLength(modelId) ?? Promise.resolve(0),
      },
      modePicker: {
        getMode: () => this._d.modeService.getMode(),
        setMode: (mode) => this._d.modeService.setMode(mode),
        getAvailableModes: () => this._d.modeService.getAvailableModes(),
        onDidChangeMode: this._d.modeService.onDidChangeMode,
      },
      getSessions: () => this._d.chatService.getSessions(),
      getSession: (id: string) => this._d.chatService.getSession(id),
      deleteSession: (id: string) => this._d.chatService.deleteSession(id),
      attachmentServices: this._d.editorService ? {
        getOpenEditorFiles: () => {
          return this._d.editorService!.getOpenEditors().map((ed) => {
            const parts = ed.id.split(':');
            if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
              const pageId = parts.slice(2).join(':');
              return { name: ed.name, fullPath: `parallx-page://${pageId}` };
            }
            return { name: ed.name, fullPath: ed.description || ed.name };
          });
        },
        onDidChangeOpenEditors: this._d.editorService!.onDidChangeOpenEditors,
        listWorkspaceFiles: this._d.fsAccessor
          ? () => this.listWorkspaceFiles()
          : undefined,
      } : undefined,
      openFile: (this._d.editorService && this._d.fileService)
        ? (fullPath: string) => this.openFile(fullPath)
        : undefined,
      openPage: this._d.openPage
        ? (pageId: string) => { this._d.openPage!(pageId); }
        : undefined,
      toolPickerServices: this._d.languageModelToolsService ? {
        getTools: () => this._d.languageModelToolsService!.getTools().map((t) => ({
          name: t.name,
          description: t.description,
          enabled: this._d.languageModelToolsService!.isToolEnabled(t.name),
        })),
        setToolEnabled: (name: string, enabled: boolean) => this._d.languageModelToolsService!.setToolEnabled(name, enabled),
        onDidChangeTools: this._d.languageModelToolsService!.onDidChangeTools,
        getEnabledCount: () => this._d.languageModelToolsService!.getEnabledCount(),
      } : undefined,
      getSystemPrompt: () => this.getSystemPrompt(),
      readFileRelative: this._d.fsAccessor
        ? (r) => this.readFileRelative(r)
        : undefined,
      writeFileRelative: (this._d.fileService && this._d.workspaceService?.folders?.length)
        ? (r, c) => this.writeFileRelative(r, c)
        : undefined,
      searchSessions: this._d.databaseService
        ? (q) => this.searchSessions(q)
        : undefined,
    };
  }

  buildTokenBarServices(): ITokenStatusBarServices {
    return {
      getActiveSession: () => this._d.getActiveWidget()?.getSession(),
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
    };
  }
}
