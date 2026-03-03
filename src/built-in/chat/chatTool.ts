// chatTool.ts — Chat built-in tool activation (M9 Task 3.1)
//
// Entry point for the chat built-in tool. Follows the same pattern
// as Explorer, Canvas, etc. — exports activate() and deactivate().
//
// Responsibilities:
//   1. Create OllamaProvider and register it with ILanguageModelsService
//   2. Register the default chat participant with IChatAgentService
//   3. Register the chat view in the Auxiliary Bar
//   4. Register chat commands (toggle, new session, clear, stop, focus)

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import { OllamaProvider } from './providers/ollamaProvider.js';
import type { IRetrievalPlan } from './providers/ollamaProvider.js';
import { buildPlannerPrompt } from './chatSystemPrompts.js';
import { createChatView } from './chatView.js';
import type { IChatWidgetServices } from './chatWidget.js';
import type { ChatWidget } from './chatWidget.js';
import { createDefaultParticipant } from './participants/defaultParticipant.js';
import { createWorkspaceParticipant } from './participants/workspaceParticipant.js';
import { createCanvasParticipant } from './participants/canvasParticipant.js';
import { registerBuiltInTools, extractTextContent } from './tools/builtInTools.js';
import type { IBuiltInToolFileWriter } from './tools/builtInTools.js';
import { ChatTokenStatusBar } from './chatTokenStatusBar.js';
import type { IPageSummary } from './participants/workspaceParticipant.js';
import type { IBlockSummary, IPageStructure } from './participants/canvasParticipant.js';
import {
  ILanguageModelsService,
  IChatService,
  IChatAgentService,
  IChatModeService,
  ILanguageModelToolsService,
  ChatContentPartKind,
} from '../../services/chatTypes.js';
import type {
  IChatSession,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  ICancellationToken,
  IToolResult,
  IChatRequestResponsePair,
} from '../../services/chatTypes.js';
import { IWorkspaceService, IDatabaseService, IFileService, ITextFileModelManager, IRetrievalService, IIndexingPipelineService, IMemoryService, IRelatedContentService, IAutoTaggingService, IProactiveSuggestionsService } from '../../services/serviceTypes.js';
import { IEditorService } from '../../services/serviceTypes.js';
import type { IBuiltInToolFileSystem } from './tools/builtInTools.js';
import { PromptFileService } from '../../services/promptFileService.js';
import type { IPromptFileAccess } from '../../services/promptFileService.js';
import { PermissionService } from '../../services/permissionService.js';
import type { ToolGrantDecision } from '../../services/chatTypes.js';

// ── Helpers ──

/**
 * Extract the canvas page UUID from an editor input ID.
 *
 * Handles two formats:
 *   - Prefixed: `parallx.canvas:canvas:<pageId>` → `<pageId>`
 *   - Bare UUID: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` → as-is
 *
 * Returns the bare page UUID, or undefined if the editor is not a canvas page.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractCanvasPageId(editorId: string | undefined): string | undefined {
  if (!editorId) { return undefined; }
  // Prefixed format: parallx.canvas:canvas:<uuid>
  const parts = editorId.split(':');
  if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
    return parts.slice(2).join(':');
  }
  // Bare UUID (canvas editors opened directly by page ID)
  if (UUID_RE.test(editorId)) {
    return editorId;
  }
  return undefined;
}

// ── Local API type — only the subset we use ──

interface ParallxApi {
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



// ── Module state ──

let _ollamaProvider: OllamaProvider | undefined;
let _activeWidget: ChatWidget | undefined;
let _chatIsStreamingKey: { set(value: boolean): void } | undefined;
let _tokenStatusBar: ChatTokenStatusBar | undefined;
let _lastIndexStats: { pages: number; files: number } | undefined;
let _promptFileService: PromptFileService | undefined;
let _permissionService: PermissionService | undefined;
let _fsAccessor: IBuiltInToolFileSystem | undefined;

// ── Activation ──

export function activate(api: ParallxApi, context: ToolContext): void {

  // ── 1. Retrieve DI services ──

  const languageModelsService = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
  const chatService = api.services.get<import('../../services/chatTypes.js').IChatService>(IChatService);
  const agentService = api.services.get<import('../../services/chatTypes.js').IChatAgentService>(IChatAgentService);
  const modeService = api.services.get<import('../../services/chatTypes.js').IChatModeService>(IChatModeService);

  // Restore persisted sessions (fire and forget — non-blocking)
  chatService.restoreSessions().catch(() => { /* persistence is best-effort */ });

  // Workspace context services (for mode-aware system prompts + participants)
  const workspaceService = api.services.has(IWorkspaceService)
    ? api.services.get<import('../../services/serviceTypes.js').IWorkspaceService>(IWorkspaceService)
    : undefined;
  const editorService = api.services.has(IEditorService)
    ? api.services.get<import('../../services/serviceTypes.js').IEditorService>(IEditorService)
    : undefined;
  const databaseService = api.services.has(IDatabaseService)
    ? api.services.get<import('../../services/serviceTypes.js').IDatabaseService>(IDatabaseService)
    : undefined;
  const languageModelToolsService = api.services.has(ILanguageModelToolsService)
    ? api.services.get<import('../../services/chatTypes.js').ILanguageModelToolsService>(ILanguageModelToolsService)
    : undefined;
  const fileService = api.services.has(IFileService)
    ? api.services.get<import('../../services/serviceTypes.js').IFileService>(IFileService)
    : undefined;
  const retrievalService = api.services.has(IRetrievalService)
    ? api.services.get<import('../../services/serviceTypes.js').IRetrievalService>(IRetrievalService)
    : undefined;
  const indexingPipelineService = api.services.has(IIndexingPipelineService)
    ? api.services.get<import('../../services/serviceTypes.js').IIndexingPipelineService>(IIndexingPipelineService)
    : undefined;
  const memoryService = api.services.has(IMemoryService)
    ? api.services.get<import('../../services/serviceTypes.js').IMemoryService>(IMemoryService)
    : undefined;

  // Phase 7: Advanced Feature services
  const relatedContentService = api.services.has(IRelatedContentService)
    ? api.services.get<import('../../services/serviceTypes.js').IRelatedContentService>(IRelatedContentService)
    : undefined;
  const autoTaggingService = api.services.has(IAutoTaggingService)
    ? api.services.get<import('../../services/serviceTypes.js').IAutoTaggingService>(IAutoTaggingService)
    : undefined;
  const proactiveSuggestionsService = api.services.has(IProactiveSuggestionsService)
    ? api.services.get<import('../../services/serviceTypes.js').IProactiveSuggestionsService>(IProactiveSuggestionsService)
    : undefined;

  // ── 1b. Build file system accessor for built-in tools ──

  const fsAccessor = buildFileSystemAccessor(fileService, workspaceService);
  _fsAccessor = fsAccessor ?? undefined;

  // ── 1b2. Prompt file service (M11 Task 1.1 + 1.4) ──
  //
  // Reads SOUL.md / AGENTS.md / TOOLS.md / .parallx/rules/*.md from workspace root.
  // Falls back to built-in defaults when files don't exist.

  _promptFileService = new PromptFileService();
  context.subscriptions.push(_promptFileService);

  if (fsAccessor) {
    const promptFileAccess: IPromptFileAccess = {
      async readFile(relativePath: string): Promise<string | null> {
        try {
          return await fsAccessor.readFile(relativePath);
        } catch {
          return null;
        }
      },
      async exists(relativePath: string): Promise<boolean> {
        try {
          return await fsAccessor.exists(relativePath);
        } catch {
          return false;
        }
      },
      async listDir(relativePath: string): Promise<string[]> {
        try {
          const entries = await fsAccessor.readdir(relativePath);
          return entries.map((e) => e.name);
        } catch {
          return [];
        }
      },
    };
    _promptFileService.setFileAccess(promptFileAccess);
  }

  // ── 1c. Read configuration settings ──

  const chatConfig = api.workspace.getConfiguration('chat');
  const ollamaBaseUrl = chatConfig.get<string>('ollama.baseUrl', 'http://localhost:11434');
  const defaultModel = chatConfig.get<string>('defaultModel', '');
  const defaultMode = chatConfig.get<string>('defaultMode', 'ask') as import('../../services/chatTypes.js').ChatMode;
  const configuredContextLength = chatConfig.get<number>('contextLength', 0);

  // Apply configured default mode
  if (defaultMode && modeService.getAvailableModes().includes(defaultMode)) {
    modeService.setMode(defaultMode);
  }

  // ── 2. Create OllamaProvider and register with ILanguageModelsService ──

  _ollamaProvider = new OllamaProvider(ollamaBaseUrl);
  context.subscriptions.push(_ollamaProvider);

  // Apply user-configured context length override (0 = let Ollama decide)
  if (configuredContextLength > 0) {
    _ollamaProvider.setContextLengthOverride(configuredContextLength);
  }

  const providerRegistration = languageModelsService.registerProvider(_ollamaProvider);
  context.subscriptions.push(providerRegistration);

  // Set configured default model (after provider registered, so models are discoverable)
  if (defaultModel) {
    languageModelsService.setActiveModel(defaultModel);
  }

  // ── 3. Register the default chat participant with IChatAgentService ──

  const defaultParticipantServices = {
    sendChatRequest(
      messages: readonly IChatMessage[],
      options?: IChatRequestOptions,
      signal?: AbortSignal,
    ): AsyncIterable<IChatResponseChunk> {
      // Use the active model from ILanguageModelsService
      const modelId = languageModelsService.getActiveModel() ?? '';
      return _ollamaProvider!.sendChatRequest(modelId, messages, options, signal);
    },
    getActiveModel(): string | undefined {
      return languageModelsService.getActiveModel();
    },
    // ── Context overflow support (Cap 9.5) ──
    getModelContextLength(): number {
      // Cached from OllamaProvider model info — 0 if unknown
      return _ollamaProvider?.getActiveModelContextLength?.() ?? 0;
    },
    sendSummarizationRequest(
      messages: readonly IChatMessage[],
      signal?: AbortSignal,
    ): AsyncIterable<IChatResponseChunk> {
      const modelId = languageModelsService.getActiveModel() ?? '';
      return _ollamaProvider!.sendChatRequest(modelId, messages, undefined, signal);
    },
    networkTimeout: 60_000, // 60 seconds default network timeout
    // ── Workspace context (Cap 4 — mode-aware system prompts) ──
    getWorkspaceName(): string {
      return workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace';
    },
    async getPageCount(): Promise<number> {
      if (!databaseService?.isOpen) { return 0; }
      try {
        const row = await databaseService.get<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM pages WHERE is_archived = 0',
        );
        return row?.cnt ?? 0;
      } catch { return 0; }
    },
    getCurrentPageTitle(): string | undefined {
      return editorService?.activeEditor?.name;
    },
    getToolDefinitions(): readonly IToolDefinition[] {
      return languageModelToolsService?.getToolDefinitions() ?? [];
    },
    getReadOnlyToolDefinitions(): readonly IToolDefinition[] {
      return languageModelToolsService?.getReadOnlyToolDefinitions() ?? [];
    },
    invokeTool(
      name: string,
      args: Record<string, unknown>,
      token: ICancellationToken,
    ): Promise<IToolResult> {
      if (!languageModelToolsService) {
        return Promise.resolve({ content: 'Tool service not available', isError: true });
      }
      return languageModelToolsService.invokeTool(name, args, token);
    },

    // ── Workspace statistics (M10 Phase 4 — dynamic system prompt) ──

    getFileCount: fsAccessor
      ? async (): Promise<number> => {
        try {
          const entries = await fsAccessor.readdir('.');
          return entries.length;
        } catch { return 0; }
      }
      : undefined,
    isRAGAvailable(): boolean {
      return indexingPipelineService?.isInitialIndexComplete ?? false;
    },
    isIndexing(): boolean {
      return indexingPipelineService?.isIndexing ?? false;
    },
    // readFileContent and getCurrentPageContent check DB/fileService at
    // call time (not activation time) so they remain functional even when
    // the user opens a workspace folder after the chat tool has activated.

    readFileContent: async (fullPath: string): Promise<string> => {
      // Canvas page attachments use parallx-page://<pageId> URIs
      if (fullPath.startsWith('parallx-page://') && databaseService?.isOpen) {
        const pageId = fullPath.slice('parallx-page://'.length);
        try {
          const row = await databaseService.get<{ title: string; content: string }>(
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
      if (!fileService) { return `[Error: File service not available]`; }
      try {
        const { URI } = await import('../../platform/uri.js');
        const uri = URI.file(fullPath);
        const content = await fileService.readFile(uri);
        return content.content;
      } catch {
        return `[Error: Could not read file "${fullPath}"]`;
      }
    },

    // ── Implicit context: current page content (VS Code implicit context pattern) ──

    getCurrentPageContent: async (): Promise<{ title: string; pageId: string; textContent: string } | undefined> => {
      const pageId = extractCanvasPageId(editorService?.activeEditor?.id);
      if (!pageId || !databaseService?.isOpen) { return undefined; }
      try {
        const row = await databaseService.get<{ id: string; title: string; content: string }>(
          'SELECT id, title, content FROM pages WHERE id = ?',
          [pageId],
        );
        if (!row) { return undefined; }
        const textContent = extractTextContent(row.content);
        return textContent ? { title: row.title, pageId: row.id, textContent } : undefined;
      } catch { return undefined; }
    },

    maxIterations: chatConfig.get<number>('agent.maxIterations', 10),

    // ── RAG context retrieval (M10 Phase 3) ──

    retrieveContext: retrievalService
      ? async (query: string) => {
        // Only retrieve if initial indexing is complete
        if (!indexingPipelineService?.isInitialIndexComplete) { return undefined; }
        try {
          const chunks = await retrievalService.retrieve(query, {
            topK: 8,
            maxPerSource: 3,
            tokenBudget: 3000,
          });
          if (chunks.length === 0) { return undefined; }
          const text = retrievalService.formatContext(chunks);
          // Build source citations for Reference rendering (M10 Phase 6 — Task 6.2)
          const seen = new Set<string>();
          const sources: Array<{ uri: string; label: string }> = [];
          for (const chunk of chunks) {
            const key = `${chunk.sourceType}:${chunk.sourceId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const uri = chunk.sourceType === 'page'
              ? `parallx-page://${chunk.sourceId}`
              : chunk.sourceId;
            const label = chunk.contextPrefix ?? (chunk.sourceType === 'page' ? 'Page' : 'File');
            sources.push({ uri, label });
          }
          return { text, sources };
        } catch { return undefined; }
      }
      : undefined,

    // ── Planned retrieval (M12 Phase 3 — 2-call pipeline) ──
    //
    // Runs the retrieval planner LLM call to classify intent and generate
    // targeted search queries, then performs multi-query retrieval.
    // Falls back to direct single-query retrieval on any failure.

    planAndRetrieve: (retrievalService && _ollamaProvider)
      ? async (
        userText: string,
        recentHistory?: string,
        workspaceDigest?: string,
      ): Promise<{ text: string; sources: Array<{ uri: string; label: string }>; plan?: IRetrievalPlan } | undefined> => {
        // Only retrieve if initial indexing is complete
        if (!indexingPipelineService?.isInitialIndexComplete) { return undefined; }

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
          const modelId = languageModelsService.getActiveModel() ?? '';
          const plan = await _ollamaProvider!.planRetrieval(modelId, plannerMessages);

          // If planner says no retrieval needed, return empty with plan metadata
          if (!plan.needsRetrieval || plan.queries.length === 0) {
            return { text: '', sources: [], plan };
          }

          // Multi-query retrieval
          const chunks = await retrievalService!.retrieveMulti(plan.queries, {
            topK: 10,
            maxPerSource: 3,
            tokenBudget: 3500,
          });

          if (chunks.length === 0) { return { text: '', sources: [], plan }; }

          const text = retrievalService!.formatContext(chunks);

          // Build source citations
          const seen = new Set<string>();
          const sources: Array<{ uri: string; label: string }> = [];
          for (const chunk of chunks) {
            const key = `${chunk.sourceType}:${chunk.sourceId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const uri = chunk.sourceType === 'page'
              ? `parallx-page://${chunk.sourceId}`
              : chunk.sourceId;
            const label = chunk.contextPrefix ?? (chunk.sourceType === 'page' ? 'Page' : 'File');
            sources.push({ uri, label });
          }

          return { text, sources, plan };
        } catch (err) {
          // Graceful degradation: fall back to single-query retrieval
          console.warn('[chatTool] planAndRetrieve failed, falling back to single query:', err);
          try {
            const chunks = await retrievalService!.retrieve(userText, {
              topK: 8,
              maxPerSource: 3,
              tokenBudget: 3000,
            });
            if (chunks.length === 0) { return undefined; }
            const text = retrievalService!.formatContext(chunks);
            const seen = new Set<string>();
            const sources: Array<{ uri: string; label: string }> = [];
            for (const chunk of chunks) {
              const key = `${chunk.sourceType}:${chunk.sourceId}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const uri = chunk.sourceType === 'page'
                ? `parallx-page://${chunk.sourceId}`
                : chunk.sourceId;
              const label = chunk.contextPrefix ?? (chunk.sourceType === 'page' ? 'Page' : 'File');
              sources.push({ uri, label });
            }
            return { text, sources };
          } catch { return undefined; }
        }
      }
      : undefined,

    // ── Memory context (M10 Phase 5 — conversation memory) ──

    recallMemories: memoryService
      ? async (query: string): Promise<string | undefined> => {
        try {
          const memories = await memoryService.recallMemories(query);
          if (memories.length === 0) { return undefined; }
          return memoryService.formatMemoryContext(memories);
        } catch { return undefined; }
      }
      : undefined,

    storeSessionMemory: memoryService
      ? async (sessionId: string, summary: string, messageCount: number): Promise<void> => {
        try { await memoryService.storeMemory(sessionId, summary, messageCount); } catch { /* best-effort */ }
      }
      : undefined,

    isSessionEligibleForSummary: memoryService
      ? (messageCount: number): boolean => memoryService.isSessionEligibleForSummary(messageCount)
      : undefined,

    hasSessionMemory: memoryService
      ? async (sessionId: string): Promise<boolean> => {
        try { return await memoryService.hasMemory(sessionId); } catch { return false; }
      }
      : undefined,

    // ── Preference learning (M10 Phase 5 — Task 5.2) ──

    extractPreferences: memoryService
      ? async (text: string): Promise<void> => {
        try { await memoryService.extractAndStorePreferences(text); } catch { /* best-effort */ }
      }
      : undefined,

    getPreferencesForPrompt: memoryService
      ? async (): Promise<string | undefined> => {
        try {
          const prefs = await memoryService.getPreferences();
          if (prefs.length === 0) { return undefined; }
          return memoryService.formatPreferencesForPrompt(prefs);
        } catch { return undefined; }
      }
      : undefined,

    // ── Prompt file overlay (M11 Task 1.4) ──

    getPromptOverlay: _promptFileService
      ? async (_activeFilePath?: string): Promise<string | undefined> => {
        try {
          // Determine active file's relative path (for pattern-scoped rules)
          let activeRelPath = _activeFilePath;
          if (!activeRelPath && editorService?.activeEditor) {
            const ed = editorService.activeEditor;
            // File editors have the full path in `description`
            if (ed.description && !ed.id.includes('canvas:') && !ed.id.includes('database:')) {
              // Convert to relative path within workspace
              const rootPath = workspaceService?.folders?.[0]?.uri?.fsPath;
              if (rootPath && ed.description.startsWith(rootPath)) {
                activeRelPath = ed.description.slice(rootPath.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
              }
            }
          }
          const layers = await _promptFileService!.loadLayers();
          const overlay = _promptFileService!.assemblePromptOverlay(layers, activeRelPath);
          return overlay || undefined;
        } catch { return undefined; }
      }
      : undefined,

    // ── /init command file system access (M11 Task 1.6) ──

    listFilesRelative: fsAccessor
      ? async (relativePath: string) => {
        const entries = await fsAccessor.readdir(relativePath);
        return entries.map(e => ({ name: e.name, type: e.type }));
      }
      : undefined,

    readFileRelative: fsAccessor
      ? async (relativePath: string): Promise<string | null> => {
        try {
          return await fsAccessor.readFile(relativePath);
        } catch { return null; }
      }
      : undefined,

    writeFileRelative: (fileService && workspaceService?.folders?.length)
      ? async (relativePath: string, content: string): Promise<void> => {
        const rootUri = workspaceService!.folders[0].uri;
        const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
        const targetUri = rootUri.joinPath(clean);

        // Ensure parent directory exists
        const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
        if (parentPath) {
          const parentUri = rootUri.joinPath(parentPath);
          try {
            await fileService!.mkdir(parentUri);
          } catch {
            // Directory may already exist — that's fine
          }
        }
        await fileService!.writeFile(targetUri, content);
      }
      : undefined,

    existsRelative: fsAccessor
      ? async (relativePath: string): Promise<boolean> => {
        try { return await fsAccessor.exists(relativePath); } catch { return false; }
      }
      : undefined,

    invalidatePromptFiles: _promptFileService
      ? () => _promptFileService!.invalidate()
      : undefined,

    // M11 Task 1.10 — context pills UI bridge
    reportContextPills: (pills: readonly import('../../services/chatTypes.js').IContextPill[]) => {
      if (_activeWidget) {
        _activeWidget.setContextPills(pills);
      }
    },

    // M11 Task 1.10 — excluded context IDs from pills UI
    getExcludedContextIds: (): ReadonlySet<string> => {
      return _activeWidget?.getExcludedContextIds() ?? new Set();
    },

    // M11 Task 4.8 — token budget transparency bridge
    reportBudget: (slots: readonly import('./chatContextPills.js').ITokenBudgetSlot[]) => {
      if (_activeWidget) {
        _activeWidget.setBudget(slots);
      }
    },

    // M11 Task 4.2 — @terminal mention: get recent terminal output
    getTerminalOutput: async (): Promise<string | undefined> => {
      const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
      const terminal = electron?.terminal as { getOutput?: (lineCount?: number) => Promise<{ output: string; lineCount: number }> } | undefined;
      if (!terminal?.getOutput) { return undefined; }
      try {
        const result = await terminal.getOutput(100);
        return result.output || undefined;
      } catch { return undefined; }
    },

    // M11 Task 3.3 — @folder: mention: list files in a folder
    listFolderFiles: fsAccessor
      ? async (folderPath: string): Promise<Array<{ relativePath: string; content: string }>> => {
        const results: Array<{ relativePath: string; content: string }> = [];
        const MAX_FILES = 50;
        const MAX_FILE_SIZE = 10_000; // chars
        try {
          const entries = await fsAccessor!.readdir(folderPath);
          for (const entry of entries) {
            if (results.length >= MAX_FILES) break;
            if (entry.type === 'file') {
              const relPath = folderPath ? `${folderPath}/${entry.name}` : entry.name;
              try {
                const content = await fsAccessor!.readFile(relPath);
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
      : undefined,

    // M11 Task 3.7 — User-defined slash commands filesystem
    userCommandFileSystem: fsAccessor
      ? {
        listCommandFiles: async () => {
          try {
            const entries = await fsAccessor!.readdir('.parallx/commands');
            return entries
              .filter(e => e.type === 'file' && e.name.endsWith('.md'))
              .map(e => `.parallx/commands/${e.name}`);
          } catch { return []; }
        },
        readCommandFile: async (relativePath: string) => {
          return await fsAccessor!.readFile(relativePath);
        },
      }
      : undefined,

    // M11 Task 3.8 — /compact session compaction
    compactSession: (sessionId: string, summaryText: string) => {
      const session = chatService.getSession(sessionId);
      if (!session) return;
      // Replace all existing messages with a single summary pair
      const messages = session.messages as IChatRequestResponsePair[];
      messages.splice(0, messages.length, {
        request: { text: '[Compacted conversation history]' },
        response: {
          parts: [{ kind: ChatContentPartKind.Markdown, content: summaryText }],
          isComplete: true,
        },
      } as IChatRequestResponsePair);
    },

    // ── Workspace digest (proactive context grounding) ──
    //
    // Assembles a pre-loaded snapshot of the workspace so the AI already
    // knows what exists before the user types anything. Includes:
    //   1. Canvas page titles (from database)
    //   2. Workspace file tree (from filesystem, max depth 3)
    //   3. Key file previews (README*, SOUL.md, etc. — first ~500 chars)
    //
    // Budget: ~2000 tokens max to avoid bloating the system prompt.
    // Cached with a 60-second TTL to avoid redundant filesystem/DB queries.

    getWorkspaceDigest: (() => {
      let _cachedDigest: string | undefined;
      let _cacheTimestamp = 0;
      const DIGEST_TTL_MS = 60_000; // 60 seconds

      return async (): Promise<string | undefined> => {
        const now = Date.now();
        if (_cachedDigest !== undefined && now - _cacheTimestamp < DIGEST_TTL_MS) {
          return _cachedDigest;
        }

        const result = await _computeWorkspaceDigest();
        _cachedDigest = result;
        _cacheTimestamp = now;
        return result;
      };
    })(),
  };

  // Workspace digest computation (extracted for caching)
  async function _computeWorkspaceDigest(): Promise<string | undefined> {
      const sections: string[] = [];
      const MAX_DIGEST_CHARS = 8000; // ~2000 tokens at 4 chars/token
      let totalChars = 0;

      // 1. Canvas page titles
      if (databaseService?.isOpen) {
        try {
          const pages = await databaseService.all<{ title: string; id: string }>(
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
      if (fsAccessor) {
        try {
          const treeLines: string[] = [];
          const MAX_TREE_ENTRIES = 80;
          let treeCount = 0;

          async function walkTree(dir: string, depth: number, prefix: string): Promise<void> {
            if (depth > 3 || treeCount >= MAX_TREE_ENTRIES) return;
            const entries = await fsAccessor!.readdir(dir);
            // Sort: dirs first, then files
            const sorted = [...entries].sort((a, b) => {
              if (a.type === 'directory' && b.type !== 'directory') return -1;
              if (a.type !== 'directory' && b.type === 'directory') return 1;
              return a.name.localeCompare(b.name);
            });
            for (const entry of sorted) {
              if (treeCount >= MAX_TREE_ENTRIES) break;
              // Skip hidden/system dirs
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
      if (fsAccessor) {
        const keyFiles = ['README.md', 'README.txt', 'README', 'SOUL.md', 'AGENTS.md'];
        for (const fileName of keyFiles) {
          if (totalChars >= MAX_DIGEST_CHARS) break;
          try {
            const exists = await fsAccessor.exists(fileName);
            if (!exists) continue;
            const content = await fsAccessor.readFile(fileName);
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

  const defaultParticipant = createDefaultParticipant(defaultParticipantServices);
  context.subscriptions.push(defaultParticipant);

  const agentRegistration = agentService.registerAgent(defaultParticipant);
  context.subscriptions.push(agentRegistration);

  // ── 3b. Register @workspace participant ──

  const sendChatRequest = (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> => {
    const modelId = languageModelsService.getActiveModel() ?? '';
    return _ollamaProvider!.sendChatRequest(modelId, messages, options, signal);
  };

  const getWorkspaceName = (): string =>
    workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace';

  const workspaceParticipant = createWorkspaceParticipant({
    sendChatRequest,
    getActiveModel: () => languageModelsService.getActiveModel(),
    getWorkspaceName,
    async listPages(): Promise<readonly IPageSummary[]> {
      if (!databaseService?.isOpen) { return []; }
      try {
        return await databaseService.all<IPageSummary>(
          'SELECT id, title, icon FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?',
          [100],
        );
      } catch { return []; }
    },
    async searchPages(query: string): Promise<readonly IPageSummary[]> {
      if (!databaseService?.isOpen) { return []; }
      try {
        return await databaseService.all<IPageSummary>(
          'SELECT id, title, icon FROM pages WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC LIMIT ?',
          [`%${query}%`, 20],
        );
      } catch { return []; }
    },
    async getPageContent(pageId: string): Promise<string | null> {
      if (!databaseService?.isOpen) { return null; }
      try {
        const row = await databaseService.get<{ content: string }>(
          'SELECT content FROM pages WHERE id = ?', [pageId],
        );
        return row?.content ?? null;
      } catch { return null; }
    },
    async getPageTitle(pageId: string): Promise<string | null> {
      if (!databaseService?.isOpen) { return null; }
      try {
        const row = await databaseService.get<{ title: string }>(
          'SELECT title FROM pages WHERE id = ?', [pageId],
        );
        return row?.title ?? null;
      } catch { return null; }
    },
    // ── File system closures (optional — undefined when no workspace folder) ──
    listFiles: fsAccessor
      ? async (relativePath: string) => { return fsAccessor.readdir(relativePath); }
      : undefined,
    readFileContent: fsAccessor
      ? async (relativePath: string) => { return fsAccessor.readFile(relativePath); }
      : undefined,
  });
  context.subscriptions.push(workspaceParticipant);
  context.subscriptions.push(agentService.registerAgent(workspaceParticipant));

  // ── 3c. Register @canvas participant ──

  const canvasParticipant = createCanvasParticipant({
    sendChatRequest,
    getActiveModel: () => languageModelsService.getActiveModel(),
    getWorkspaceName,
    getCurrentPageId(): string | undefined {
      return extractCanvasPageId(editorService?.activeEditor?.id);
    },
    getCurrentPageTitle(): string | undefined {
      return editorService?.activeEditor?.name;
    },
    async getPageStructure(pageId: string): Promise<IPageStructure | null> {
      if (!databaseService?.isOpen) { return null; }
      try {
        const page = await databaseService.get<{ id: string; title: string; icon?: string }>(
          'SELECT id, title, icon FROM pages WHERE id = ?', [pageId],
        );
        if (!page) { return null; }

        const blocks = await databaseService.all<{
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
    },
  });
  context.subscriptions.push(canvasParticipant);
  context.subscriptions.push(agentService.registerAgent(canvasParticipant));

  // ── 3d. Register built-in tools (Cap 6 Task 6.3) ──

  if (languageModelToolsService) {
    const getCurrentPageId = () => extractCanvasPageId(editorService?.activeEditor?.id);

    // ── Wire permission service (M11 Task 2.1) ──
    _permissionService = new PermissionService();
    context.subscriptions.push(_permissionService);

    // Inline DOM-based confirmation handler — creates a floating card in the
    // chat panel and returns a Promise that resolves when the user clicks.
    _permissionService.setConfirmationHandler(
      (toolName: string, toolDescription: string, args: Record<string, unknown>): Promise<ToolGrantDecision> => {
        return new Promise<ToolGrantDecision>((resolve) => {
          // Find the chat list container to append the confirmation card
          const chatContainer = document.querySelector('.parallx-chat-messages')
            ?? document.querySelector('.parallx-chat-list')
            ?? document.body;

          const card = document.createElement('div');
          card.className = 'parallx-chat-confirmation';

          // Message
          const msg = document.createElement('div');
          msg.className = 'parallx-chat-confirmation-message';
          msg.textContent = `"${toolName}" wants to run. ${toolDescription}`;
          card.appendChild(msg);

          // Args summary
          if (args && Object.keys(args).length > 0) {
            const argsBlock = document.createElement('div');
            argsBlock.className = 'parallx-chat-confirmation-args';
            const pre = document.createElement('pre');
            pre.textContent = Object.entries(args)
              .map(([k, v]) => {
                const val = typeof v === 'string'
                  ? (v.length > 80 ? v.slice(0, 80) + '…' : v)
                  : JSON.stringify(v);
                return `${k}: ${val}`;
              })
              .join('\n');
            argsBlock.appendChild(pre);
            card.appendChild(argsBlock);
          }

          // Button bar
          const buttonBar = document.createElement('div');
          buttonBar.className = 'parallx-chat-confirmation-buttons';

          const decisions: Array<{ label: string; cls: string; decision: ToolGrantDecision }> = [
            { label: 'Allow once', cls: 'parallx-chat-confirmation-btn--accept', decision: 'allow-once' },
            { label: 'Allow for session', cls: 'parallx-chat-confirmation-btn--session', decision: 'allow-session' },
            { label: 'Always allow', cls: 'parallx-chat-confirmation-btn--always', decision: 'always-allow' },
            { label: 'Reject', cls: 'parallx-chat-confirmation-btn--reject', decision: 'reject' },
          ];

          for (const { label, cls, decision } of decisions) {
            const btn = document.createElement('button');
            btn.className = `parallx-chat-confirmation-btn ${cls}`;
            btn.textContent = label;
            btn.type = 'button';
            btn.addEventListener('click', () => {
              card.remove();
              resolve(decision);
            });
            buttonBar.appendChild(btn);
          }

          card.appendChild(buttonBar);
          chatContainer.appendChild(card);

          // Scroll the card into view
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      },
    );

    // Bind to tools service
    (languageModelToolsService as import('../../services/languageModelToolsService.js').LanguageModelToolsService).setPermissionService(_permissionService);

    // Build retrieval accessor for the search_knowledge tool (M10 Phase 3)
    const retrievalAccessor = retrievalService && indexingPipelineService
      ? {
        isReady: () => indexingPipelineService!.isInitialIndexComplete,
        async retrieve(query: string, sourceFilter?: string) {
          const chunks = await retrievalService!.retrieve(query, {
            topK: 10,
            maxPerSource: 3,
            tokenBudget: 4000,
            sourceFilter,
          });
          return chunks.map((c) => ({
            sourceType: c.sourceType,
            sourceId: c.sourceId,
            contextPrefix: c.contextPrefix,
            text: c.text,
            score: c.score,
          }));
        },
      }
      : undefined;

    // Build file writer accessor for write_file / edit_file tools (M11 Task 2.2 + 2.3)
    const writerAccessor: IBuiltInToolFileWriter | undefined = (fileService && workspaceService?.folders?.length)
      ? (() => {
        // Lazy-load ParallxIgnore for path validation
        let ignoreInstance: import('../../services/parallxIgnore.js').ParallxIgnore | undefined;
        const getIgnore = async (): Promise<import('../../services/parallxIgnore.js').ParallxIgnore> => {
          if (!ignoreInstance) {
            const { createParallxIgnore } = await import('../../services/parallxIgnore.js');
            ignoreInstance = createParallxIgnore();
            // Try to load .parallxignore from workspace
            if (fsAccessor) {
              try {
                const content = await fsAccessor.readFile('.parallxignore');
                ignoreInstance.loadFromContent(content);
              } catch { /* no .parallxignore — use defaults */ }
            }
          }
          return ignoreInstance;
        };
        // Eagerly initialize
        getIgnore().catch(() => {});

        return {
          async writeFile(relativePath: string, content: string): Promise<void> {
            const rootUri = workspaceService!.folders[0].uri;
            const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
            const targetUri = rootUri.joinPath(clean);

            // Ensure parent directory exists
            const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
            if (parentPath) {
              const parentUri = rootUri.joinPath(parentPath);
              try { await fileService!.mkdir(parentUri); } catch { /* may already exist */ }
            }
            await fileService!.writeFile(targetUri, content);
          },
          isPathAllowed(relativePath: string): boolean {
            // Synchronous check with eagerly loaded ignore instance
            if (ignoreInstance) {
              return !ignoreInstance.isIgnored(relativePath, false);
            }
            // If not loaded yet, allow (will be checked again on write)
            return true;
          },
        };
      })()
      : undefined;

    // M11 Task 4.3 — Terminal accessor for run_command tool
    const terminalAccessor: import('./tools/builtInTools.js').IBuiltInToolTerminal | undefined = (() => {
      const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
      const termBridge = electron?.terminal as {
        exec?: (cmd: string, opts?: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string; exitCode: number; error: { code: string; message: string } | null }>;
      } | undefined;
      if (!termBridge?.exec) { return undefined; }
      return {
        exec: (command: string, options?: { cwd?: string; timeout?: number }) => termBridge.exec!(command, options),
      };
    })();

    const toolDisposables = registerBuiltInTools(languageModelToolsService, databaseService ?? undefined, fsAccessor, getCurrentPageId, retrievalAccessor, writerAccessor, terminalAccessor, workspaceService?.folders?.[0]?.uri?.fsPath);
    for (const d of toolDisposables) {
      context.subscriptions.push(d);
    }
  }

  // ── 4. Build widget services bridge (delegates to IChatService) ──

  const widgetServices: IChatWidgetServices = {
    async sendRequest(sessionId: string, message: string, attachments?: readonly import('../../services/chatTypes.js').IChatAttachment[]): Promise<void> {
      await chatService.sendRequest(sessionId, message, attachments ? { attachments } : undefined);
    },
    cancelRequest(sessionId: string): void {
      chatService.cancelRequest(sessionId);
    },
    createSession(): IChatSession {
      return chatService.createSession();
    },
    onDidChangeSession: chatService.onDidChangeSession as Event<string>,
    getProviderStatus(): { available: boolean } {
      return { available: _ollamaProvider?.getLastStatus()?.available ?? false };
    },
    onDidChangeProviderStatus: _ollamaProvider.onDidChangeStatus as unknown as Event<void>,
    modelPicker: {
      getModels: () => languageModelsService.getModels(),
      getActiveModel: () => languageModelsService.getActiveModel(),
      setActiveModel: (modelId: string) => languageModelsService.setActiveModel(modelId),
      onDidChangeModels: languageModelsService.onDidChangeModels,
      getModelContextLength: (modelId: string) => _ollamaProvider?.getModelContextLength(modelId) ?? Promise.resolve(0),
    },
    modePicker: {
      getMode: () => modeService.getMode(),
      setMode: (mode) => modeService.setMode(mode),
      getAvailableModes: () => modeService.getAvailableModes(),
      onDidChangeMode: modeService.onDidChangeMode,
    },
    // Session management (for header actions + session sidebar)
    getSessions: () => chatService.getSessions(),
    getSession: (id: string) => chatService.getSession(id),
    deleteSession: (id: string) => chatService.deleteSession(id),
    // Attachment services (enable "Add Context" file picker — open editor files + workspace files)
    attachmentServices: editorService ? {
      getOpenEditorFiles: () => {
        return editorService!.getOpenEditors().map((ed) => {
          // Canvas/database editors: use parallx-page:// URI so readFileContent
          // can resolve content via SQLite instead of filesystem
          const parts = ed.id.split(':');
          if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
            const pageId = parts.slice(2).join(':');
            return { name: ed.name, fullPath: `parallx-page://${pageId}` };
          }
          return { name: ed.name, fullPath: ed.description || ed.name };
        });
      },
      onDidChangeOpenEditors: editorService!.onDidChangeOpenEditors,
      listWorkspaceFiles: fsAccessor
        ? async () => {
          const result: import('./chatContextAttachments.js').IWorkspaceFileEntry[] = [];
          const rootFolders = workspaceService?.folders ?? [];
          if (rootFolders.length === 0 || !fileService) { return result; }
          const rootUri = rootFolders[0].uri;

          // Recursive walk (breadth-first, up to 500 entries, max depth 6)
          const queue: { uri: import('../../platform/uri.js').URI; rel: string }[] =
            [{ uri: rootUri, rel: '' }];
          const MAX_ENTRIES = 500;
          const MAX_DEPTH = 6;

          while (queue.length > 0 && result.length < MAX_ENTRIES) {
            const current = queue.shift()!;
            const depth = current.rel.split('/').filter(Boolean).length;
            try {
              const entries = await fileService!.readdir(current.uri);
              for (const entry of entries) {
                if (result.length >= MAX_ENTRIES) { break; }
                // Skip hidden/system dirs
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
        : undefined,
    } : undefined,
    // Open file in editor (for clicking attachment chips in chat messages)
    openFile: editorService && fileService ? (fullPath: string) => {
      Promise.all([
        import('../../platform/uri.js'),
        import('../editor/fileEditorInput.js'),
      ]).then(([{ URI }, { FileEditorInput }]) => {
        const uri = URI.file(fullPath);
        const textFileManager = api.services.has(ITextFileModelManager)
          ? api.services.get<import('../../services/serviceTypes.js').ITextFileModelManager>(ITextFileModelManager)
          : undefined;
        if (textFileManager) {
          const input = FileEditorInput.create(uri, textFileManager, fileService!);
          editorService!.openEditor(input);
        }
      });
    } : undefined,
    // Tool picker services (enable "Configure Tools" wrench button)
    toolPickerServices: languageModelToolsService ? {
      getTools: () => languageModelToolsService!.getTools().map((t) => ({
        name: t.name,
        description: t.description,
        enabled: languageModelToolsService!.isToolEnabled(t.name),
      })),
      setToolEnabled: (name: string, enabled: boolean) => languageModelToolsService!.setToolEnabled(name, enabled),
      onDidChangeTools: languageModelToolsService!.onDidChangeTools,
      getEnabledCount: () => languageModelToolsService!.getEnabledCount(),
    } : undefined,
    // System prompt viewer (Task 4.10)
    getSystemPrompt: async () => {
      const { buildSystemPrompt } = await import('./chatSystemPrompts.js');
      const { ChatMode } = await import('../../services/chatTypes.js');
      const mode = ChatMode.Agent; // Show the full agent prompt (most complete)
      const pageCount = databaseService?.isOpen ? (await databaseService.all<{ id: string }>('SELECT id FROM pages')).length : 0;
      const fileCount = fsAccessor
        ? (await (async () => { try { return (await fsAccessor!.readdir('')).length; } catch { return 0; } })())
        : 0;

      // Read prompt overlay if available
      let promptOverlay: string | undefined;
      if (_promptFileService) {
        try {
          const layers = await _promptFileService.loadLayers();
          promptOverlay = _promptFileService.assemblePromptOverlay(layers);
        } catch { /* best-effort */ }
      }

      return buildSystemPrompt(mode, {
        workspaceName: workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace',
        pageCount,
        currentPageTitle: undefined,
        tools: languageModelToolsService?.getToolDefinitions() ?? [],
        fileCount,
        isRAGAvailable: !!retrievalService,
        isIndexing: false,
        promptOverlay,
      });
    },
    // File access for code action diff/apply flow (Task 2.6)
    readFileRelative: fsAccessor
      ? async (relativePath: string): Promise<string | null> => {
        try { return await fsAccessor!.readFile(relativePath); } catch { return null; }
      }
      : undefined,
    writeFileRelative: (fileService && workspaceService?.folders?.length)
      ? async (relativePath: string, content: string): Promise<void> => {
        const rootUri = workspaceService!.folders[0].uri;
        const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
        const targetUri = rootUri.joinPath(clean);
        const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
        if (parentPath) {
          try { await fileService!.mkdir(rootUri.joinPath(parentPath)); } catch { /* may exist */ }
        }
        await fileService!.writeFile(targetUri, content);
      }
      : undefined,
    // Session search (Task 4.5) — delegates to chatSessionPersistence
    searchSessions: databaseService
      ? async (query: string) => {
        const { searchSessions } = await import('../../services/chatSessionPersistence.js');
        return searchSessions(databaseService!, query);
      }
      : undefined,
  };

  // ── 5. Register the chat view in the Auxiliary Bar ──

  context.subscriptions.push(
    api.views.registerViewProvider('view.chat', {
      createView(container: HTMLElement): IDisposable {
        const view = createChatView(container, _ollamaProvider!, widgetServices);
        return view;
      },
    }),
  );

  // ── 6. Register chat commands ──

  context.subscriptions.push(
    api.commands.registerCommand('chat.toggle', () => {
      api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.newSession', () => {
      // Create a new session and bind it to the active widget
      const session = chatService.createSession();
      if (_activeWidget) {
        _activeWidget.setSession(session);
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.clearSession', () => {
      // Delete the current session and create a fresh one
      if (_activeWidget) {
        const currentSession = _activeWidget.getSession();
        if (currentSession) {
          chatService.deleteSession(currentSession.id);
        }
        const newSession = chatService.createSession();
        _activeWidget.setSession(newSession);
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.stop', () => {
      // Cancel the in-progress request for the active widget's session
      if (_activeWidget) {
        const session = _activeWidget.getSession();
        if (session) {
          chatService.cancelRequest(session.id);
        }
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.focus', () => {
      api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
      if (_activeWidget) {
        _activeWidget.focus();
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.switchMode', () => {
      // Cycle through Ask → Agent → Edit → Ask (matches getAvailableModes order)
      const modes = modeService.getAvailableModes();
      const current = modeService.getMode();
      const idx = modes.indexOf(current);
      const next = modes[(idx + 1) % modes.length];
      modeService.setMode(next);
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.selectModel', async () => {
      const models = await languageModelsService.getModels();
      if (models.length === 0) {
        await api.window.showInformationMessage(
          'No models available. Run `ollama pull llama3.2` to get started.',
        );
        return;
      }
      const activeId = languageModelsService.getActiveModel();
      const items = models.map((m) => ({
        label: m.displayName,
        description: m.id === activeId ? '$(check) active' : '',
        detail: `${m.parameterSize} · ${m.quantization}`,
      }));
      const picked = await api.window.showQuickPick(items, {
        placeHolder: 'Select a language model',
        title: 'AI Model',
      });
      if (picked) {
        const model = models.find((m) => m.displayName === picked.label);
        if (model) {
          languageModelsService.setActiveModel(model.id);
        }
      }
    }),
  );

  // ── 6b. Status bar item — visual token usage with detail popup ──

  const tokenBarServices: import('./chatTokenStatusBar.js').ITokenStatusBarServices = {
    getActiveSession: () => _activeWidget?.getSession(),
    getContextLength: async () => {
      // Use the currently selected chat model (from the model picker),
      // NOT session.modelId which may be stale or set to an embedding model.
      const modelId = languageModelsService.getActiveModel();
      if (modelId && _ollamaProvider) {
        return _ollamaProvider.getModelContextLength(modelId);
      }
      return 0;
    },
    getMode: () => modeService.getMode() as import('../../services/chatTypes.js').ChatMode,
    getWorkspaceName: () => workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace',
    getPageCount: async () => {
      if (!databaseService?.isOpen) return 0;
      try {
        const row = await databaseService.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM pages WHERE is_archived = 0');
        return row?.cnt ?? 0;
      } catch { return 0; }
    },
    getCurrentPageTitle: () => editorService?.activeEditor?.name,
    getToolDefinitions: () => languageModelToolsService?.getToolDefinitions() ?? [],
    getFileCount: async () => {
      if (!fsAccessor) return 0;
      try {
        const entries = await fsAccessor.readdir('.');
        return entries.length;
      } catch { return 0; }
    },
    isRAGAvailable: () => indexingPipelineService?.isInitialIndexComplete ?? false,
    isIndexing: () => indexingPipelineService?.isIndexing ?? false,
    getIndexingProgress: () => indexingPipelineService?.progress ?? { phase: 'idle' as const, processed: 0, total: 0 },
    getIndexStats: () => _lastIndexStats,
  };

  _tokenStatusBar = new ChatTokenStatusBar(tokenBarServices);
  context.subscriptions.push(_tokenStatusBar);

  // Create a status bar entry using the custom HTML element
  const tokenStatusBarItem = api.window.createStatusBarItem(/* Right */ 2, 200);
  tokenStatusBarItem.name = 'Token Usage';
  tokenStatusBarItem.htmlElement = _tokenStatusBar.element;
  tokenStatusBarItem.show();
  context.subscriptions.push(tokenStatusBarItem as unknown as IDisposable);

  // Find the rendered DOM container for popup anchoring (after show)
  requestAnimationFrame(() => {
    const sbItem = document.querySelector(`[id$="statusbar"][id*="chat"]`) as HTMLElement
      ?? _tokenStatusBar!.element.closest('.statusbar-item') as HTMLElement;
    if (sbItem) _tokenStatusBar!.setStatusBarItemContainer(sbItem);
  });

  // Initial update
  _tokenStatusBar.update().catch(() => {});

  // React to session changes
  const tokenSessionListener = chatService.onDidChangeSession(() => {
    _tokenStatusBar?.update().catch(() => {});
  });
  context.subscriptions.push(tokenSessionListener as unknown as IDisposable);

  // Also update when models change (context length may differ)
  const tokenModelListener = languageModelsService.onDidChangeModels(() => {
    _tokenStatusBar?.update().catch(() => {});
  });
  context.subscriptions.push(tokenModelListener as unknown as IDisposable);

  // Update when mode changes (system prompt breakdown changes)
  const tokenModeListener = modeService.onDidChangeMode(() => {
    _tokenStatusBar?.update().catch(() => {});
  });
  context.subscriptions.push(tokenModeListener as unknown as IDisposable);

  // Update on indexing progress changes (M10 Phase 6 — Task 6.1)
  if (indexingPipelineService) {
    const indexProgressListener = indexingPipelineService.onDidChangeProgress(() => {
      _tokenStatusBar?.update().catch(() => {});
    });
    context.subscriptions.push(indexProgressListener as unknown as IDisposable);

    const indexCompleteListener = indexingPipelineService.onDidCompleteInitialIndex((stats) => {
      _lastIndexStats = { pages: stats.pages, files: stats.files };
      _tokenStatusBar?.update().catch(() => {});
    });
    context.subscriptions.push(indexCompleteListener as unknown as IDisposable);
  }

  // ── 7. Set context keys ──

  const chatVisibleKey = api.context.createContextKey('chatVisible', false);
  context.subscriptions.push(chatVisibleKey as unknown as IDisposable);

  const chatIsStreamingKey = api.context.createContextKey('chatIsStreaming', false);
  context.subscriptions.push(chatIsStreamingKey as unknown as IDisposable);

  // Expose streaming key setter for the chat widget to update
  _chatIsStreamingKey = chatIsStreamingKey;

  // ── 8. Apply chat font settings via CSS custom properties ──

  const applyFontSettings = (): void => {
    const cfg = api.workspace.getConfiguration('chat');
    const fontSize = cfg.get<number>('fontSize', 13);
    const fontFamily = cfg.get<string>('fontFamily', '');
    document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`);
    document.documentElement.style.setProperty(
      '--chat-font-family',
      fontFamily || 'var(--vscode-font-family)',
    );
  };
  applyFontSettings();

  // Re-apply on configuration change
  if (api.workspace.onDidChangeConfiguration) {
    const configSub = api.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('chat')) {
        applyFontSettings();
        // Re-read context length override
        const cfg = api.workspace.getConfiguration('chat');
        const newCtxLen = cfg.get<number>('contextLength', 0);
        _ollamaProvider?.setContextLengthOverride(newCtxLen);
      }
    });
    if (configSub && typeof (configSub as any).dispose === 'function') {
      context.subscriptions.push(configSub as unknown as IDisposable);
    }
  }

  // ── 9. Phase 7: Advanced Features (M10 Tasks 7.1–7.4) ──

  // 9a. Inline AI provider — register command so canvas can obtain AI functions
  context.subscriptions.push(
    api.commands.registerCommand('chat.getInlineAIProvider', () => {
      const provider: {
        sendChatRequest: (
          messages: readonly IChatMessage[],
          options?: { temperature?: number; maxTokens?: number },
          signal?: AbortSignal,
        ) => AsyncIterable<IChatResponseChunk>;
        retrieveContext?: (query: string) => Promise<string | undefined>;
      } = {
        sendChatRequest: (messages, options, signal) => {
          const modelId = languageModelsService.getActiveModel() ?? '';
          return _ollamaProvider!.sendChatRequest(modelId, messages, options, signal);
        },
        retrieveContext: retrievalService && indexingPipelineService
          ? async (query: string): Promise<string | undefined> => {
            if (!indexingPipelineService!.isInitialIndexComplete) return undefined;
            try {
              const chunks = await retrievalService!.retrieve(query, { topK: 5, maxPerSource: 2, tokenBudget: 1500 });
              return chunks.length > 0 ? retrievalService!.formatContext(chunks) : undefined;
            } catch { return undefined; }
          }
          : undefined,
      };
      return provider;
    }),
  );

  // 9b. Related Content commands
  if (relatedContentService) {
    context.subscriptions.push(
      api.commands.registerCommand('chat.getRelatedContent', async (...args: unknown[]) => {
        const pageId = args[0] as string | undefined;
        if (!pageId) return [];
        return relatedContentService.findRelated(pageId);
      }),
    );
  }

  // 9c. Auto-tagging commands
  if (autoTaggingService) {
    context.subscriptions.push(
      api.commands.registerCommand('chat.suggestTags', async (...args: unknown[]) => {
        const pageId = args[0] as string | undefined;
        if (!pageId) return [];
        return autoTaggingService.suggestTags(pageId);
      }),
    );

    context.subscriptions.push(
      api.commands.registerCommand('chat.autoTagPage', async (...args: unknown[]) => {
        const pageId = args[0] as string | undefined;
        if (!pageId) return;
        await autoTaggingService.autoTagOnSave(pageId);
      }),
    );

    context.subscriptions.push(
      api.commands.registerCommand('chat.getPageTags', async (...args: unknown[]) => {
        const pageId = args[0] as string | undefined;
        if (!pageId) return [];
        return autoTaggingService.getPageTags(pageId);
      }),
    );
  }

  // 9d. Proactive suggestions commands
  if (proactiveSuggestionsService) {
    context.subscriptions.push(
      api.commands.registerCommand('chat.getSuggestions', () => {
        return proactiveSuggestionsService.suggestions;
      }),
    );

    context.subscriptions.push(
      api.commands.registerCommand('chat.dismissSuggestion', (...args: unknown[]) => {
        const suggestionId = args[0] as string | undefined;
        if (suggestionId) proactiveSuggestionsService.dismiss(suggestionId);
      }),
    );

    context.subscriptions.push(
      api.commands.registerCommand('chat.analyzeSuggestions', async () => {
        return proactiveSuggestionsService.analyze();
      }),
    );
  }

  // ── 10. Instantiate M11 services (skill loader, config, permissions) ──

  // SkillLoaderService (M11 Task 2.7–2.8): load skills from .parallx/skills/
  if (fsAccessor) {
    import('../../services/skillLoaderService.js').then(({ SkillLoaderService }) => {
      const skillLoader = new SkillLoaderService();
      skillLoader.setFileSystem({
        readFile: (path: string) => fsAccessor!.readFile(path),
        listDirs: async (path: string) => {
          try {
            const entries = await fsAccessor!.readdir(path);
            return entries.filter(e => e.type === 'directory').map(e => e.name);
          } catch { return []; }
        },
        exists: (path: string) => fsAccessor!.exists(path),
      });
      skillLoader.scanSkills().catch(() => { /* best-effort */ });
      context.subscriptions.push(skillLoader);
    }).catch(() => { /* optional service */ });
  }

  // ParallxConfigService (M11 Task 2.9): read .parallx/config.json
  if (fsAccessor) {
    import('../../services/parallxConfigService.js').then(({ ParallxConfigService }) => {
      const configService = new ParallxConfigService();
      configService.setFileSystem({
        readFile: (path: string) => fsAccessor!.readFile(path),
        exists: (path: string) => fsAccessor!.exists(path),
      });
      configService.load().catch(() => { /* best-effort */ });
      context.subscriptions.push(configService);
    }).catch(() => { /* optional service */ });
  }

  // PermissionsFileService (M11 Task 2.10): persist permission overrides
  if (fsAccessor && fileService && workspaceService?.folders?.length && _permissionService) {
    import('../../services/permissionsFileService.js').then(({ PermissionsFileService }) => {
      const permsFileService = new PermissionsFileService();
      permsFileService.setFileSystem({
        readFile: (path: string) => fsAccessor!.readFile(path),
        exists: (path: string) => fsAccessor!.exists(path),
      });
      permsFileService.setFileWriter({
        writeFile: async (relativePath: string, content: string) => {
          const rootUri = workspaceService!.folders[0].uri;
          const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
          await fileService!.writeFile(rootUri.joinPath(clean), content);
        },
      });
      permsFileService.setPermissionService(_permissionService!);
      permsFileService.load().catch(() => { /* best-effort */ });
      context.subscriptions.push(permsFileService);
    }).catch(() => { /* optional service */ });
  }
}

/** Set the active widget reference (called from chatView). */
export function setActiveWidget(widget: ChatWidget | undefined): void {
  _activeWidget = widget;
  _tokenStatusBar?.update().catch(() => {});

  // Wire mention/command providers once the widget is available
  if (widget) {
    // Mention provider: list workspace files for @file: autocomplete
    if (_fsAccessor) {
      widget.setMentionSuggestionProvider({
        async listFiles() {
          try {
            const entries = await _fsAccessor!.readdir('.');
            return entries.map(e => ({
              name: e.name,
              relativePath: e.name,
              isDirectory: e.type === 'directory',
            }));
          } catch {
            return [];
          }
        },
      });
    }

    // Slash command provider: built-in + user commands from registry
    import('./chatSlashCommands.js').then(({ SlashCommandRegistry }) => {
      const reg = new SlashCommandRegistry();
      widget.setSlashCommandProvider({
        getCommands() {
          return reg.getCommands().map(c => ({ name: c.name, description: c.description }));
        },
      });
    }).catch(() => { /* best-effort */ });
  }
}

/** Update the chatIsStreaming context key (called from chatWidget). */
export function setChatIsStreaming(streaming: boolean): void {
  _chatIsStreamingKey?.set(streaming);
}

export function deactivate(): void {
  _ollamaProvider = undefined;
  _activeWidget = undefined;
  _chatIsStreamingKey = undefined;
  _tokenStatusBar = undefined;
  _promptFileService = undefined;
  _fsAccessor = undefined;
}

// ── Helpers ──

/**
 * Extract a plain text preview from a block's content_json column.
 * Walks Tiptap-style JSON nodes and concatenates text.
 */
function extractBlockPreview(contentJson: string): string {
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

// ── File System Accessor Builder ──

const MAX_FILE_READ_BYTES = 50 * 1024; // 50 KB per spec

/**
 * Build an IBuiltInToolFileSystem from IFileService + IWorkspaceService.
 * Returns undefined if no workspace folder is open.
 */
function buildFileSystemAccessor(
  fileService: import('../../services/serviceTypes.js').IFileService | undefined,
  workspaceService: import('../../services/serviceTypes.js').IWorkspaceService | undefined,
): IBuiltInToolFileSystem | undefined {
  if (!fileService || !workspaceService) { return undefined; }

  const folders = workspaceService.folders;
  if (!folders || folders.length === 0) { return undefined; }

  const rootUri = folders[0].uri;
  const rootName = workspaceService.activeWorkspace?.name ?? folders[0].name;

  /** Resolve a relative path to an absolute URI under the workspace root. */
  function resolveUri(relativePath: string): import('../../platform/uri.js').URI {
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
      // Check size before reading to respect the 50 KB guard
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
