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
import { createChatView } from './chatView.js';
import type { IChatWidgetServices } from './chatWidget.js';
import type { ChatWidget } from './chatWidget.js';
import { createDefaultParticipant } from './participants/defaultParticipant.js';
import { createWorkspaceParticipant } from './participants/workspaceParticipant.js';
import { createCanvasParticipant } from './participants/canvasParticipant.js';
import { registerBuiltInTools, extractTextContent } from './tools/builtInTools.js';
import { ChatTokenStatusBar } from './chatTokenStatusBar.js';
import type { IPageSummary } from './participants/workspaceParticipant.js';
import type { IBlockSummary, IPageStructure } from './participants/canvasParticipant.js';
import {
  ILanguageModelsService,
  IChatService,
  IChatAgentService,
  IChatModeService,
  ILanguageModelToolsService,
} from '../../services/chatTypes.js';
import type {
  IChatSession,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  ICancellationToken,
  IToolResult,
} from '../../services/chatTypes.js';
import { IWorkspaceService, IDatabaseService, IFileService, ITextFileModelManager, IRetrievalService, IIndexingPipelineService, IMemoryService } from '../../services/serviceTypes.js';
import { IEditorService } from '../../services/serviceTypes.js';
import type { IBuiltInToolFileSystem } from './tools/builtInTools.js';

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

  // ── 1b. Build file system accessor for built-in tools ──

  const fsAccessor = buildFileSystemAccessor(fileService, workspaceService);

  // ── 1c. Read configuration settings ──

  const chatConfig = api.workspace.getConfiguration('chat');
  const ollamaBaseUrl = chatConfig.get<string>('ollama.baseUrl', 'http://localhost:11434');
  const defaultModel = chatConfig.get<string>('defaultModel', '');
  const defaultMode = chatConfig.get<string>('defaultMode', 'ask') as import('../../services/chatTypes.js').ChatMode;

  // Apply configured default mode
  if (defaultMode && modeService.getAvailableModes().includes(defaultMode)) {
    modeService.setMode(defaultMode);
  }

  // ── 2. Create OllamaProvider and register with ILanguageModelsService ──

  _ollamaProvider = new OllamaProvider(ollamaBaseUrl);
  context.subscriptions.push(_ollamaProvider);

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
      ? async (query: string): Promise<string | undefined> => {
        // Only retrieve if initial indexing is complete
        if (!indexingPipelineService?.isInitialIndexComplete) { return undefined; }
        try {
          const chunks = await retrievalService.retrieve(query, {
            topK: 8,
            maxPerSource: 3,
            tokenBudget: 3000,
          });
          if (chunks.length === 0) { return undefined; }
          return retrievalService.formatContext(chunks);
        } catch { return undefined; }
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
  };

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

    const toolDisposables = registerBuiltInTools(languageModelToolsService, databaseService ?? undefined, fsAccessor, getCurrentPageId, retrievalAccessor);
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
      const session = _activeWidget?.getSession();
      const modelId = session?.modelId;
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
      }
    });
    if (configSub && typeof (configSub as any).dispose === 'function') {
      context.subscriptions.push(configSub as unknown as IDisposable);
    }
  }
}

/** Set the active widget reference (called from chatView). */
export function setActiveWidget(widget: ChatWidget | undefined): void {
  _activeWidget = widget;
  _tokenStatusBar?.update().catch(() => {});
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
