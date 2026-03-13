// main.ts — Chat built-in tool activation (M9 Task 3.1, M13 Phase 3)
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
import { createChatView } from './widgets/chatView.js';
import type { ChatWidget } from './widgets/chatWidget.js';
import { createDefaultParticipant } from './participants/defaultParticipant.js';
import { createWorkspaceParticipant } from './participants/workspaceParticipant.js';
import { createCanvasParticipant } from './participants/canvasParticipant.js';
import { registerBuiltInTools } from './tools/builtInTools.js';
import type { IBuiltInToolFileWriter } from './chatTypes.js';
import { ChatTokenStatusBar } from './widgets/chatTokenStatusBar.js';
import {
  ILanguageModelsService,
  IChatService,
  IChatAgentService,
  IChatModeService,
  ILanguageModelToolsService,
} from '../../services/chatTypes.js';
import type {
  IChatMessage,
  IChatResponseChunk,
} from '../../services/chatTypes.js';
import { IWorkspaceService, IDatabaseService, IFileService, ITextFileModelManager, IRetrievalService, IIndexingPipelineService, IMemoryService, IRelatedContentService, IAutoTaggingService, IProactiveSuggestionsService, ISessionManager, IAISettingsService, IUnifiedAIConfigService, IAgentApprovalService, IAgentExecutionService, IAgentSessionService, IAgentTraceService, IVectorStoreService, IWorkspaceMemoryService, ICanonicalMemorySearchService } from '../../services/serviceTypes.js';
import { IEditorService } from '../../services/serviceTypes.js';
import type { IBuiltInToolFileSystem } from './chatTypes.js';
import { PromptFileService } from '../../services/promptFileService.js';
import type { IPromptFileAccess } from '../../services/promptFileService.js';
import { PermissionService } from '../../services/permissionService.js';
import type { ToolGrantDecision } from '../../services/chatTypes.js';
import { ChatDataService, buildFileSystemAccessor, extractCanvasPageId } from './data/chatDataService.js';
import { URI } from '../../platform/uri.js';
import type { AgentPlanStepInput, DelegatedTaskInput, AgentApprovalResolution } from '../../agent/agentTypes.js';

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
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
    openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;
  };
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === '.' || normalized === './' || normalized === '') {
    return '.';
  }
  if (normalized.startsWith('./')) {
    return normalized.slice(2);
  }
  if (normalized.startsWith('/')) {
    return normalized.slice(1);
  }
  return normalized;
}

type TestAgentPlanStepSeed = Omit<AgentPlanStepInput, 'taskId' | 'proposedAction'> & {
  proposedAction?: {
    toolName?: string;
    actionClass?: import('../../agent/agentTypes.js').AgentActionClass;
    summary?: string;
    targetPaths?: readonly string[];
    interactionMode?: import('../../agent/agentTypes.js').AgentInteractionMode;
  };
};

function resolveTestTargetUris(
  workspaceService: import('../../services/serviceTypes.js').IWorkspaceService | undefined,
  targetPaths: readonly string[] | undefined,
): readonly URI[] | undefined {
  if (!targetPaths || targetPaths.length === 0) {
    return undefined;
  }

  const firstFolder = workspaceService?.folders[0]?.uri;
  return targetPaths
    .map((targetPath) => targetPath.trim())
    .filter((targetPath) => targetPath.length > 0)
    .map((targetPath) => {
      if (/^[a-zA-Z]:[\\/]/.test(targetPath) || targetPath.startsWith('/')) {
        return URI.file(targetPath);
      }

      if (!firstFolder) {
        throw new Error('Cannot resolve relative target paths without an active workspace folder.');
      }

      return firstFolder.joinPath(...targetPath.replace(/\\/g, '/').split('/').filter(Boolean));
    });
}

function buildTestPlanStepInput(
  workspaceService: import('../../services/serviceTypes.js').IWorkspaceService | undefined,
  taskId: string,
  step: TestAgentPlanStepSeed,
): AgentPlanStepInput {
  return {
    ...step,
    taskId,
    proposedAction: step.proposedAction
      ? {
        toolName: step.proposedAction.toolName,
        actionClass: step.proposedAction.actionClass,
        summary: step.proposedAction.summary,
        interactionMode: step.proposedAction.interactionMode,
        targetUris: resolveTestTargetUris(workspaceService, step.proposedAction.targetPaths),
      }
      : undefined,
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
let _api: ParallxApi | undefined;

// Writer-accessor .parallxignore cache — module-level so the workspace
// switch handler (§11) can invalidate it.
let _writerIgnoreInstance: import('../../services/parallxIgnore.js').ParallxIgnore | undefined;
let _loadWriterIgnore: (() => Promise<unknown>) | undefined;

// ── Activation ──

export function activate(api: ParallxApi, context: ToolContext): void {
  _api = api;

  // ── 1. Retrieve DI services ──

  const languageModelsService = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
  const chatService = api.services.get<import('../../services/chatTypes.js').IChatService>(IChatService);
  const agentService = api.services.get<import('../../services/chatTypes.js').IChatAgentService>(IChatAgentService);
  const modeService = api.services.get<import('../../services/chatTypes.js').IChatModeService>(IChatModeService);

  // Sessions are restored by the workbench in Phase 5 (after DB binds).
  // No need to call restoreSessions() here — it would duplicate the work
  // and was the secondary path through which unscoped sessions could leak.

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
  let retrievalService = api.services.has(IRetrievalService)
    ? api.services.get<import('../../services/serviceTypes.js').IRetrievalService>(IRetrievalService)
    : undefined;
  let indexingPipelineService = api.services.has(IIndexingPipelineService)
    ? api.services.get<import('../../services/serviceTypes.js').IIndexingPipelineService>(IIndexingPipelineService)
    : undefined;
  const vectorStoreService = api.services.has(IVectorStoreService)
    ? api.services.get<import('../../services/serviceTypes.js').IVectorStoreService>(IVectorStoreService)
    : undefined;
  let memoryService = api.services.has(IMemoryService)
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

  // Session manager (M14) — carries workspace/session identity for diagnostics
  const sessionManager = api.services.has(ISessionManager)
    ? api.services.get<import('../../services/serviceTypes.js').ISessionManager>(ISessionManager)
    : undefined;
  const sessionContext = sessionManager?.activeContext;

  // AI Settings service (M15) — persona overlay + model defaults
  const aiSettingsService = api.services.has(IAISettingsService)
    ? api.services.get<import('../../aiSettings/aiSettingsTypes.js').IAISettingsService>(IAISettingsService)
    : undefined;

  // Unified AI Config service (M20) — single source of truth
  const unifiedConfigService = api.services.has(IUnifiedAIConfigService)
    ? api.services.get<import('../../aiSettings/unifiedConfigTypes.js').IUnifiedAIConfigService>(IUnifiedAIConfigService)
    : undefined;
  const agentSessionService = api.services.has(IAgentSessionService)
    ? api.services.get<import('../../services/serviceTypes.js').IAgentSessionService>(IAgentSessionService)
    : undefined;
  const agentApprovalService = api.services.has(IAgentApprovalService)
    ? api.services.get<import('../../services/serviceTypes.js').IAgentApprovalService>(IAgentApprovalService)
    : undefined;
  const agentExecutionService = api.services.has(IAgentExecutionService)
    ? api.services.get<import('../../services/serviceTypes.js').IAgentExecutionService>(IAgentExecutionService)
    : undefined;
  const agentTraceService = api.services.has(IAgentTraceService)
    ? api.services.get<import('../../services/serviceTypes.js').IAgentTraceService>(IAgentTraceService)
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

  // ── 3. Create ChatDataService (M13 Phase 2) ──

  const dataService = new ChatDataService({
    databaseService,
    fileService,
    workspaceService,
    editorService,
    retrievalService,
    indexingPipelineService,
    memoryService,
    workspaceMemoryService: api.services.has(IWorkspaceMemoryService)
      ? api.services.get<import('../../services/serviceTypes.js').IWorkspaceMemoryService>(IWorkspaceMemoryService)
      : undefined,
    canonicalMemorySearchService: api.services.has(ICanonicalMemorySearchService)
      ? api.services.get<import('../../services/serviceTypes.js').ICanonicalMemorySearchService>(ICanonicalMemorySearchService)
      : undefined,
    languageModelsService,
    languageModelToolsService,
    chatService,
    modeService,
    ollamaProvider: _ollamaProvider,
    promptFileService: _promptFileService!,
    fsAccessor,
    textFileModelManager: api.services.has(ITextFileModelManager)
      ? api.services.get<import('../../services/serviceTypes.js').ITextFileModelManager>(ITextFileModelManager)
      : undefined,
    maxIterations: unifiedConfigService?.getEffectiveConfig().agent.maxIterations ?? chatConfig.get<number>('agent.maxIterations', 10),
    networkTimeout: 60_000,
    getActiveWidget: () => _activeWidget,
    openPage: (pageId: string) => api.editors.openEditor({ typeId: 'canvas', title: 'Page', instanceId: pageId }),
    sessionContext: sessionContext ?? undefined,
    sessionManager: sessionManager ?? undefined,
    aiSettingsService: aiSettingsService ?? undefined,
    unifiedConfigService: unifiedConfigService ?? undefined,
    agentSessionService: agentSessionService ?? undefined,
    agentApprovalService: agentApprovalService ?? undefined,
    agentExecutionService: agentExecutionService ?? undefined,
    agentTraceService: agentTraceService ?? undefined,
    openFileEditor: (uri, opts) => api.editors.openFileEditor(uri, opts),
  });

  const createAgentTaskDebugDriver = () => ({
    listTasks: () => agentSessionService?.listActiveWorkspaceTasks() ?? [],
    getTask: (taskId: string) => agentSessionService?.getTask(taskId),
    getDiagnostics: (taskId: string) => agentTraceService?.getTaskDiagnostics(taskId),
    createTask: async (input: DelegatedTaskInput, taskId?: string, now?: string) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }
      return agentSessionService.createTask(input, taskId, now);
    },
    setPlanSteps: async (taskId: string, steps: readonly TestAgentPlanStepSeed[], now?: string) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }
      return agentSessionService.setPlanSteps(
        taskId,
        steps.map((step) => buildTestPlanStepInput(workspaceService, taskId, step)),
        now,
      );
    },
    transitionTask: async (
      taskId: string,
      nextStatus: import('../../agent/agentTypes.js').AgentTaskStatus,
      now?: string,
      options?: { blockerReason?: string; blockerCode?: import('../../agent/agentTypes.js').AgentBlockReasonCode; currentStepId?: string; stopAfterCurrentStep?: boolean },
    ) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }
      return agentSessionService.transitionTask(taskId, nextStatus, now, options);
    },
    queueApproval: async (
      taskId: string,
      request: Omit<import('../../agent/agentTypes.js').AgentApprovalRequestInput, 'taskId' | 'affectedTargets'> & { affectedTargets?: readonly string[] },
      now?: string,
    ) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }
      return agentSessionService.queueApprovalForTask(taskId, {
        ...request,
        affectedTargets: request.affectedTargets ? [...request.affectedTargets] : undefined,
      }, now);
    },
    runTask: async (taskId: string, now?: string) => {
      if (!agentExecutionService) {
        throw new Error('Agent execution service is not available.');
      }
      return agentExecutionService.runTask(taskId, now);
    },
    resolveApproval: async (taskId: string, requestId: string, resolution: AgentApprovalResolution, now?: string) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }
      return agentSessionService.resolveTaskApproval(taskId, requestId, resolution, now);
    },
    continueTask: async (taskId: string, now?: string) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }
      return agentSessionService.continueTask(taskId, now);
    },
    seedTask: async (
      seed: {
        readonly input: DelegatedTaskInput;
        readonly taskId?: string;
        readonly steps?: readonly TestAgentPlanStepSeed[];
        readonly run?: boolean;
        readonly now?: string;
      },
    ) => {
      if (!agentSessionService) {
        throw new Error('Agent session service is not available.');
      }

      const task = await agentSessionService.createTask(seed.input, seed.taskId, seed.now);
      if (seed.steps && seed.steps.length > 0) {
        await agentSessionService.setPlanSteps(
          task.id,
          seed.steps.map((step) => buildTestPlanStepInput(workspaceService, task.id, step)),
          seed.now,
        );
      }
      if (seed.run) {
        await agentExecutionService?.runTask(task.id, seed.now);
      }
      return {
        task: agentSessionService.getTask(task.id) ?? task,
        diagnostics: agentTraceService?.getTaskDiagnostics(task.id),
        approvals: agentApprovalService?.listApprovalRequestsForTask(task.id) ?? [],
      };
    },
  });

  if (window.parallxElectron?.testMode) {
    (window as unknown as Record<string, unknown>).__parallx_chat_debug__ = {
      getSnapshot: () => dataService.getTestDebugSnapshot(),
      getEffectiveConfig: () => unifiedConfigService?.getEffectiveConfig(),
      updateWorkspaceOverride: (patch: unknown) => unifiedConfigService?.updateWorkspaceOverride(patch as any),
      getActiveModel: () => languageModelsService.getActiveModel(),
      setActiveModel: (modelId: string) => languageModelsService.setActiveModel(modelId),
      agent: createAgentTaskDebugDriver(),
    };
  }

  // ── 3a. Register the default chat participant with IChatAgentService ──

  const defaultParticipantServices = dataService.buildDefaultParticipantServices();

  const defaultParticipant = createDefaultParticipant(defaultParticipantServices);
  context.subscriptions.push(defaultParticipant);

  const agentRegistration = agentService.registerAgent(defaultParticipant);
  context.subscriptions.push(agentRegistration);

  // ── 3b. Register @workspace participant ──

  const workspaceParticipant = createWorkspaceParticipant(dataService.buildWorkspaceParticipantServices());
  context.subscriptions.push(workspaceParticipant);
  context.subscriptions.push(agentService.registerAgent(workspaceParticipant));

  // ── 3c. Register @canvas participant ──

  const canvasParticipant = createCanvasParticipant(dataService.buildCanvasParticipantServices());
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
          // No hardcoded limits — retrieval params from AI Settings.
          const chunks = await retrievalService!.retrieve(query, {
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

    const canonicalMemorySearchAccessor = api.services.has(ICanonicalMemorySearchService)
      ? (() => {
          const canonicalMemorySearchService = api.services.get<import('../../services/serviceTypes.js').ICanonicalMemorySearchService>(ICanonicalMemorySearchService);
          return {
            isReady: () => canonicalMemorySearchService.isReady(),
            search: (query: string, options?: { layer?: 'all' | 'durable' | 'daily'; date?: string }) =>
              canonicalMemorySearchService.search(query, options),
          };
        })()
      : undefined;

    // Build file writer accessor for write_file / edit_file tools (M11 Task 2.2 + 2.3)
    //
    // The writer accessor has two concerns:
    //   1. writeFile — resolves against workspaceService.folders[0].uri
    //      dynamically (already correct across workspace switches).
    //   2. isPathAllowed — checks .parallxignore patterns. The ignore
    //      instance must be reloaded after a workspace switch because the
    //      new workspace may have different rules.
    //
    // _writerIgnoreInstance and _loadWriterIgnore are module-level so the
    // workspace switch handler (§11) can invalidate the cached patterns.

    _loadWriterIgnore = async (): Promise<import('../../services/parallxIgnore.js').ParallxIgnore> => {
      if (!_writerIgnoreInstance) {
        const { createParallxIgnore } = await import('../../services/parallxIgnore.js');
        _writerIgnoreInstance = createParallxIgnore();
        // Try to load .parallxignore from workspace (fsAccessor is dynamic)
        if (fsAccessor) {
          try {
            const content = await fsAccessor.readFile('.parallxignore');
            _writerIgnoreInstance.loadFromContent(content);
          } catch { /* no .parallxignore — use defaults */ }
        }
      }
      return _writerIgnoreInstance;
    };

    const writerAccessor: IBuiltInToolFileWriter | undefined = fileService && workspaceService
      ? (() => {
        // Eagerly attempt to load .parallxignore (best-effort)
        _loadWriterIgnore().catch(() => {});

        return {
          async writeFile(relativePath: string, content: string): Promise<void> {
            const folders = workspaceService!.folders;
            if (!folders || folders.length === 0) {
              throw new Error('No workspace folder is open — cannot write files');
            }
            const rootUri = folders[0].uri;
            const clean = normalizeWorkspaceRelativePath(relativePath);
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
            if (_writerIgnoreInstance) {
              return !_writerIgnoreInstance.isIgnored(relativePath, false);
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

    const toolDisposables = registerBuiltInTools(languageModelToolsService, databaseService ?? undefined, fsAccessor, getCurrentPageId, retrievalAccessor, canonicalMemorySearchAccessor, writerAccessor, terminalAccessor, workspaceService?.folders?.[0]?.uri?.fsPath);
    for (const d of toolDisposables) {
      context.subscriptions.push(d);
    }
  }

  // ── 4. Build widget services bridge (delegates to ChatDataService) ──

  const widgetServices = dataService.buildWidgetServices();
  // C2: Wire AI Settings opener — accessible from the chat title bar gear icon
  (widgetServices as unknown as Record<string, unknown>).openAISettings = () => {
    api.commands.executeCommand('ai-settings.open');
  };

  // ── 5. Register the chat view in the Auxiliary Bar ──

  context.subscriptions.push(
    api.views.registerViewProvider('view.chat', {
      createView(container: HTMLElement): IDisposable {
        const view = createChatView(container, _ollamaProvider!, widgetServices, setActiveWidget);
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

  const tokenBarServices = dataService.buildTokenBarServices();

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
  // Track these subscriptions so we can dispose/re-subscribe on workspace switch
  let _indexingSubs: IDisposable[] = [];

  const _hydrateIndexStats = async (): Promise<void> => {
    if (!vectorStoreService) return;

    try {
      const stats = await vectorStoreService.getStats();
      _lastIndexStats = {
        pages: stats.sourceCountByType['page_block'] ?? 0,
        files: stats.sourceCountByType['file_chunk'] ?? 0,
      };
      dataService.setLastIndexStats(_lastIndexStats);
      _tokenStatusBar?.update().catch(() => {});
    } catch (err) {
      console.warn('[Chat] Failed to hydrate index stats:', err);
    }
  };

  const _subscribeIndexingEvents = (): void => {
    // Dispose previous listeners
    for (const d of _indexingSubs) d.dispose();
    _indexingSubs = [];

    if (!indexingPipelineService) return;

    const progressSub = indexingPipelineService.onDidChangeProgress(() => {
      _tokenStatusBar?.update().catch(() => {});
    });
    _indexingSubs.push(progressSub as unknown as IDisposable);

    const completeSub = indexingPipelineService.onDidCompleteInitialIndex((stats) => {
      _lastIndexStats = { pages: stats.pages, files: stats.files };
      dataService.setLastIndexStats(_lastIndexStats);
      _tokenStatusBar?.update().catch(() => {});
    });
    _indexingSubs.push(completeSub as unknown as IDisposable);

    if (indexingPipelineService.isInitialIndexComplete) {
      void _hydrateIndexStats();
    }
  };

  _subscribeIndexingEvents();

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
              // No hardcoded limits — retrieval params from AI Settings.
              const chunks = await retrievalService!.retrieve(query);
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

  // M20: Wire workspace filesystem to UnifiedAIConfigService for config.json import
  // Replaces the standalone ParallxConfigService (M11 Task 2.9).
  if (fsAccessor && unifiedConfigService) {
    unifiedConfigService.setFileSystem({
      readFile: (path: string) => fsAccessor!.readFile(path),
      exists: (path: string) => fsAccessor!.exists(path),
      // B.1: write support for .parallx/ai-config.json persistence
      writeFile: (fileService && workspaceService)
        ? async (relativePath: string, content: string) => {
            const folders = workspaceService!.folders;
            if (!folders || folders.length === 0) {
              throw new Error('No workspace folder — cannot write config');
            }
            const rootUri = folders[0].uri;
            const clean = normalizeWorkspaceRelativePath(relativePath);
            await fileService!.writeFile(rootUri.joinPath(clean), content);
          }
        : undefined,
    });
    unifiedConfigService.loadWorkspaceConfig().catch(() => { /* best-effort */ });

    if (workspaceService) {
      context.subscriptions.push(
        workspaceService.onDidChangeWorkspace(() => {
          unifiedConfigService.loadWorkspaceConfig().catch(() => { /* best-effort */ });
        }),
      );
      context.subscriptions.push(
        workspaceService.onDidChangeFolders(() => {
          unifiedConfigService.loadWorkspaceConfig().catch(() => { /* best-effort */ });
        }),
      );
    }
  }

  // PermissionsFileService (M11 Task 2.10): persist permission overrides
  if (fsAccessor && fileService && workspaceService && _permissionService) {
    import('../../services/permissionsFileService.js').then(({ PermissionsFileService }) => {
      const permsFileService = new PermissionsFileService();
      permsFileService.setFileSystem({
        readFile: (path: string) => fsAccessor!.readFile(path),
        exists: (path: string) => fsAccessor!.exists(path),
      });
      permsFileService.setFileWriter({
        writeFile: async (relativePath: string, content: string) => {
          const folders = workspaceService!.folders;
          if (!folders || folders.length === 0) {
            throw new Error('No workspace folder is open — cannot write permissions');
          }
          const rootUri = folders[0].uri;
          const clean = normalizeWorkspaceRelativePath(relativePath);
          await fileService!.writeFile(rootUri.joinPath(clean), content);
        },
      });
      permsFileService.setPermissionService(_permissionService!);
      permsFileService.load().catch(() => { /* best-effort */ });
      context.subscriptions.push(permsFileService);
    }).catch(() => { /* optional service */ });
  }

  // ── 11. Workspace switch ──
  //
  // No manual reset handler needed. The workbench reloads the renderer
  // on workspace switch (mirroring VS Code's new-window model), so this
  // tool gets a fresh activate() call with clean services, a new
  // database, and correct indexing context. All stale-state bugs from
  // the previous in-process switch approach are eliminated by design.
}

/** Set the active widget reference (called from chatView). */
export function setActiveWidget(widget: ChatWidget | undefined): void {
  _activeWidget = widget;
  _tokenStatusBar?.update().catch(() => {});

  // Wire mention/command providers once the widget is available
  if (widget) {
    // Wrench icon → open AI Hub scrolled to Tools section (M20 E.2)
    widget.onDidRequestOpenToolSettings(() => {
      _api?.commands.executeCommand('ai-settings.open');
      // Allow the view to render before scrolling
      setTimeout(() => {
        _api?.commands.executeCommand('ai-settings.scrollToSection', 'tools');
      }, 150);
    });
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
    import('./config/chatSlashCommands.js').then(({ SlashCommandRegistry }) => {
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
  _api = undefined;
  _writerIgnoreInstance = undefined;
  _loadWriterIgnore = undefined;
}
