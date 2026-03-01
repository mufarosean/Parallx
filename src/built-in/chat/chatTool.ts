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
import { registerBuiltInTools } from './tools/builtInTools.js';
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
import { IWorkspaceService, IDatabaseService, IFileService } from '../../services/serviceTypes.js';
import { IEditorService } from '../../services/serviceTypes.js';
import type { IBuiltInToolFileSystem } from './tools/builtInTools.js';

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

// ── Activation ──

export function activate(api: ParallxApi, context: ToolContext): void {

  // ── 1. Retrieve DI services ──

  const languageModelsService = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
  const chatService = api.services.get<import('../../services/chatTypes.js').IChatService>(IChatService);
  const agentService = api.services.get<import('../../services/chatTypes.js').IChatAgentService>(IChatAgentService);
  const modeService = api.services.get<import('../../services/chatTypes.js').IChatModeService>(IChatModeService);

  // Restore persisted sessions (fire and forget — non-blocking)
  if ('restoreSessions' in chatService) {
    (chatService as any).restoreSessions().catch(() => { /* persistence is best-effort */ });
  }

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

    // ── Data context (prevents LLM hallucination) ──

    async listPageNames(): Promise<readonly string[]> {
      if (!databaseService?.isOpen) { return []; }
      try {
        const pages = await databaseService.all<{ title: string; icon: string | null }>(
          'SELECT title, icon FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT 20',
        );
        return pages.map((p) => `${p.icon ?? '📄'} ${p.title}`);
      } catch { return []; }
    },
    listFileNames: fsAccessor
      ? async (): Promise<readonly string[]> => {
        try {
          const entries = await fsAccessor.readdir('.');
          return entries.slice(0, 30).map((e) =>
            e.type === 'directory' ? `📁 ${e.name}` : `📄 ${e.name}`,
          );
        } catch { return []; }
      }
      : undefined,
    maxIterations: chatConfig.get<number>('agent.maxIterations', 10),
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
      return editorService?.activeEditor?.id;
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
    const toolDisposables = registerBuiltInTools(languageModelToolsService, databaseService ?? undefined, fsAccessor);
    for (const d of toolDisposables) {
      context.subscriptions.push(d);
    }
  }

  // ── 4. Build widget services bridge (delegates to IChatService) ──

  const widgetServices: IChatWidgetServices = {
    async sendRequest(sessionId: string, message: string): Promise<void> {
      await chatService.sendRequest(sessionId, message);
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
    // Session management (for header actions + history overlay)
    getSessions: () => chatService.getSessions(),
    getSession: (id: string) => chatService.getSession(id),
    deleteSession: (id: string) => chatService.deleteSession(id),
    sessionHistory: {
      getSessions: () => chatService.getSessions(),
      deleteSession: (id: string) => chatService.deleteSession(id),
    },
    // Context indicator (token usage vs. context window)
    contextIndicator: {
      getContextLength: () => _ollamaProvider?.getActiveModelContextLength?.() ?? 0,
    },
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

  // ── 6b. Status bar item — model name + connection status ──

  const statusBarItem = api.window.createStatusBarItem(/* Right */ 2, 100);
  statusBarItem.name = 'AI Model';
  statusBarItem.command = 'chat.selectModel';

  const updateStatusBar = (): void => {
    const activeModel = languageModelsService.getActiveModel();
    const status = _ollamaProvider?.getLastStatus();
    const isConnected = status?.available ?? false;

    if (!isConnected) {
      statusBarItem.text = '$(circle-slash) No AI';
      statusBarItem.tooltip = 'Ollama not connected — click to select model';
    } else if (activeModel) {
      statusBarItem.text = `$(circle-filled) ${activeModel}`;
      statusBarItem.tooltip = `AI Model: ${activeModel} — click to change`;
    } else {
      statusBarItem.text = '$(circle-filled) AI Ready';
      statusBarItem.tooltip = 'No model selected — click to choose';
    }
  };
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem as unknown as IDisposable);

  // React to model/status changes
  const modelChangeListener = languageModelsService.onDidChangeModels(() => updateStatusBar());
  context.subscriptions.push(modelChangeListener as unknown as IDisposable);

  const statusChangeListener = _ollamaProvider.onDidChangeStatus(() => updateStatusBar());
  context.subscriptions.push(statusChangeListener as unknown as IDisposable);

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
}

/** Update the chatIsStreaming context key (called from chatWidget). */
export function setChatIsStreaming(streaming: boolean): void {
  _chatIsStreamingKey?.set(streaming);
}

export function deactivate(): void {
  _ollamaProvider = undefined;
  _activeWidget = undefined;
  _chatIsStreamingKey = undefined;
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
