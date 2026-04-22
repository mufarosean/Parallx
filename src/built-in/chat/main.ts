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

import {
  buildOpenclawCanvasParticipantServices,
  buildOpenclawDefaultParticipantServices,
  buildOpenclawWorkspaceParticipantServices,
} from '../../openclaw/openclawParticipantServices.js';
import { buildToolDefinitionFromSkillCatalogEntry } from '../../openclaw/openclawToolState.js';
import { registerOpenclawParticipants } from '../../openclaw/registerOpenclawParticipants.js';
import { createOpenclawCommandRegistry } from '../../openclaw/openclawDefaultRuntimeSupport.js';
import { registerBuiltInTools } from './tools/builtInTools.js';
import type { IBuiltInToolFileWriter } from './chatTypes.js';
import {
  ILanguageModelsService,
  IChatService,
  IChatAgentService,
  IChatModeService,
  ILanguageModelToolsService,
  ChatRequestQueueKind,
} from '../../services/chatTypes.js';
import type {
  ICancellationToken,
  IChatMessage,
  IChatResponseChunk,
} from '../../services/chatTypes.js';
import { IWorkspaceService, IDatabaseService, IFileService, ITextFileModelManager, IRetrievalService, IIndexingPipelineService, IMemoryService, IRelatedContentService, IAutoTaggingService, IProactiveSuggestionsService, ISessionManager, IUnifiedAIConfigService, IAgentApprovalService, IAgentExecutionService, IAgentPolicyService, IAgentSessionService, IAgentTaskStore, IAgentTraceService, IVectorStoreService, IWorkspaceMemoryService, ICanonicalMemorySearchService, IDiagnosticsService, IDocumentExtractionService, IObservabilityService, IRuntimeHookRegistry, ILayoutService, IEmbeddingService, IWorkspaceStorageService, ISurfaceRouterService } from '../../services/serviceTypes.js';
import { ChatSurfacePlugin } from './surfaces/chatSurface.js';
import { FilesystemSurfacePlugin } from '../../services/surfaces/filesystemSurface.js';
import { CanvasSurfacePlugin } from '../canvas/surfaces/canvasSurface.js';
import { HeartbeatRunner, type IHeartbeatConfig } from '../../openclaw/openclawHeartbeatRunner.js';
import { createHeartbeatTurnExecutor } from '../../openclaw/openclawHeartbeatExecutor.js';
import { CronService, type HeartbeatWaker } from '../../openclaw/openclawCronService.js';
import {
  createCronTurnExecutor,
  createCronContextLineFetcher,
} from '../../openclaw/openclawCronExecutor.js';
import { IEditorService } from '../../services/serviceTypes.js';
import type { IBuiltInToolFileSystem } from './chatTypes.js';
import { PromptFileService } from '../../services/promptFileService.js';
import type { IPromptFileAccess } from '../../services/promptFileService.js';
import { PermissionService } from '../../services/permissionService.js';
import type { IPermissionCheckResult } from '../../services/permissionService.js';
import type { ToolGrantDecision } from '../../services/chatTypes.js';
import { ChatDataService, buildFileSystemAccessor, extractCanvasPageId } from './data/chatDataService.js';
import { URI } from '../../platform/uri.js';
import type { AgentPlanStepInput, DelegatedTaskInput, AgentApprovalResolution } from '../../agent/agentTypes.js';
import { searchWorkspaceTranscripts } from '../../services/transcriptSearch.js';
import {
  resolveChatRuntimeParticipantId,
} from '../../services/chatRuntimeSelector.js';

import { SelectionActionDispatcher } from '../../services/selectionActionDispatcher.js';
import { createBuiltInActionHandlers } from '../../services/selectionActionHandlers.js';
import { ChatProgrammaticAccess } from './chatProgrammaticAccess.js';
import type { IChatSelectionAttachment } from '../../services/selectionActionTypes.js';

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
  let clean = normalized;
  if (clean.startsWith('./')) {
    clean = clean.slice(2);
  }
  if (clean.startsWith('/')) {
    clean = clean.slice(1);
  }
  const segments = clean.split('/');
  if (segments.some(s => s === '..')) {
    return '.';
  }
  return clean;
}

function dedupeToolDefinitionsByName(
  tools: readonly import('../../services/chatTypes.js').IToolDefinition[],
): readonly import('../../services/chatTypes.js').IToolDefinition[] {
  const seen = new Set<string>();
  const unique: import('../../services/chatTypes.js').IToolDefinition[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    unique.push(tool);
  }
  return unique;
}

function resolveRuntimeSkillPermission(
  toolName: string,
  defaultLevel: import('../../services/chatTypes.js').ToolPermissionLevel,
): IPermissionCheckResult {
  if (_permissionService) {
    return _permissionService.checkPermission(toolName, defaultLevel);
  }
  return {
    level: defaultLevel,
    autoApproved: defaultLevel === 'always-allowed',
    source: 'default',
  };
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
let _lastIndexStats: { pages: number; files: number } | undefined;
let _promptFileService: PromptFileService | undefined;
let _permissionService: PermissionService | undefined;
/** D2: Session-scoped flags for /think, /verbose toggles. */
const _sessionFlags = new Map<string, boolean>();
let _fsAccessor: IBuiltInToolFileSystem | undefined;
let _api: ParallxApi | undefined;

// M48: Unified Selection → AI Action System
let _selectionDispatcher: SelectionActionDispatcher | undefined;
let _chatProgrammaticAccess: ChatProgrammaticAccess | undefined;

// Writer-accessor .parallxignore cache — module-level so the workspace
// switch handler (§11) can invalidate it.
let _writerIgnoreInstance: import('../../services/parallxIgnore.js').ParallxIgnore | undefined;
let _loadWriterIgnore: (() => Promise<unknown>) | undefined;

// ── Activation ──

export function activate(api: ParallxApi, context: ToolContext): void {
  _api = api;

  // ── M58 W4 cron ↔ W2 heartbeat forward-link ──
  //
  // Cron's "next-heartbeat" wake mode needs a reference to the heartbeat
  // runner, which is built AFTER cron in this activation. The ref is lazily
  // resolved through this closure: cron holds the waker from §3d; the
  // heartbeat block patches `cronHeartbeatRunnerRef` in §3c.
  let cronService: CronService | undefined;
  let cronHeartbeatRunnerRef: HeartbeatRunner | undefined;
  const cronHeartbeatWaker: HeartbeatWaker = (reason) => {
    cronHeartbeatRunnerRef?.wake(reason);
  };

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
  const surfaceRouter = api.services.has(ISurfaceRouterService)
    ? api.services.get<import('../../services/surfaceRouterService.js').ISurfaceRouterService>(ISurfaceRouterService)
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
  const agentPolicyService = api.services.has(IAgentPolicyService)
    ? api.services.get<import('../../services/serviceTypes.js').IAgentPolicyService>(IAgentPolicyService)
    : undefined;
  const agentTaskStore = api.services.has(IAgentTaskStore)
    ? api.services.get<import('../../services/serviceTypes.js').IAgentTaskStore>(IAgentTaskStore)
    : undefined;
  const workspaceMemoryService = api.services.has(IWorkspaceMemoryService)
    ? api.services.get<import('../../services/serviceTypes.js').IWorkspaceMemoryService>(IWorkspaceMemoryService)
    : undefined;
  const canonicalMemorySearchService = api.services.has(ICanonicalMemorySearchService)
    ? api.services.get<import('../../services/serviceTypes.js').ICanonicalMemorySearchService>(ICanonicalMemorySearchService)
    : undefined;

  // ── 1b. Build file system accessor for built-in tools ──

  const fsAccessor = buildFileSystemAccessor(fileService, workspaceService);
  _fsAccessor = fsAccessor ?? undefined;

  // ── 1b2. Prompt file service (M11 Task 1.1 + 1.4) ──
  //
  // Reads .parallx/SOUL.md, .parallx/AGENTS.md, .parallx/TOOLS.md, .parallx/rules/*.md from workspace.
  // Falls back to built-in defaults when files don't exist.

  _promptFileService = new PromptFileService();
  context.subscriptions.push(_promptFileService);

  if (fsAccessor) {
    const promptFileAccess: IPromptFileAccess = {
      async readFile(relativePath: string): Promise<string | null> {
        try {
          const result = await fsAccessor.readFileContent(relativePath);
          return result.content;
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
  const defaultMode = chatConfig.get<string>('defaultMode', 'agent') as import('../../services/chatTypes.js').ChatMode;
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
    workspaceMemoryService,
    canonicalMemorySearchService,
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
    maxIterations: unifiedConfigService?.getEffectiveConfig().agent.maxIterations ?? chatConfig.get<number>('agent.maxIterations', 25),
    networkTimeout: 60_000,
    getActiveWidget: () => _activeWidget,
    openPage: (pageId: string) => api.editors.openEditor({ typeId: 'canvas', title: 'Page', instanceId: pageId }),
    sessionContext: sessionContext ?? undefined,
    sessionManager: sessionManager ?? undefined,
    unifiedConfigService: unifiedConfigService ?? undefined,
    permissionService: _permissionService ?? undefined,
    agentSessionService: agentSessionService ?? undefined,
    agentApprovalService: agentApprovalService ?? undefined,
    agentExecutionService: agentExecutionService ?? undefined,
    agentTraceService: agentTraceService ?? undefined,
    agentPolicyService: agentPolicyService ?? undefined,
    agentTaskStore: agentTaskStore ?? undefined,
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
      resetSnapshot: () => dataService.resetTestDebugSnapshot(),
      getIndexingProgress: () => dataService.buildWidgetServices().getIndexingProgress?.(),
      getIndexStats: () => dataService.buildWidgetServices().getIndexStats?.(),
      getEffectiveConfig: () => unifiedConfigService?.getEffectiveConfig(),
      updateWorkspaceOverride: (patch: unknown) => unifiedConfigService?.updateWorkspaceOverride(patch as any),
      getActiveModel: () => languageModelsService.getActiveModel(),
      setActiveModel: (modelId: string) => languageModelsService.setActiveModel(modelId),
      agent: createAgentTaskDebugDriver(),
    };
  }

  // ── 3a. Wire shared chat service hooks ──

  chatService.setRuntimeTraceReporter?.((trace) => {
    dataService.reportRuntimeTrace(trace as import('./chatTypes.js').IChatRuntimeTrace);
  });
  chatService.setRuntimeParticipantResolver?.((participantId: string) => resolveChatRuntimeParticipantId(
    participantId,
  ));
  chatService.setTurnPreparationServices({
    listFilesRelative: fsAccessor ? (r) => dataService.listFilesRelative(r) : undefined,
    isRAGAvailable: () => dataService.isRAGAvailable(),
  });

  // Late-binding skill loader reference — populated asynchronously in section 10
  // when SkillLoaderService finishes dynamic import. Closures below capture the
  // variable so they resolve correctly once the loader is ready.
  let _skillLoaderRef: {
    getSkillCatalog(): {
      name: string;
      description: string;
      kind: string;
      tags: readonly string[];
      location: string;
      disableModelInvocation: boolean;
      userInvocable: boolean;
      permissionLevel: import('../../services/chatTypes.js').ToolPermissionLevel;
      parameters: readonly {
        name: string;
        type: string;
        description: string;
        required: boolean;
      }[];
      body: string;
    }[];
  } | undefined;

  const getRuntimeSkillCatalog = () => _skillLoaderRef?.getSkillCatalog() ?? [];

  const getRuntimeSkillToolDefinitions = (readOnlyOnly: boolean): readonly import('../../services/chatTypes.js').IToolDefinition[] => {
    const tools = getRuntimeSkillCatalog()
      .filter((skill) => skill.kind === 'tool')
      .filter((skill) => !readOnlyOnly || skill.permissionLevel === 'always-allowed')
      .map((skill) => buildToolDefinitionFromSkillCatalogEntry(skill));
    return dedupeToolDefinitionsByName(tools);
  };

  const mergeRuntimeToolDefinitions = (
    platformTools: readonly import('../../services/chatTypes.js').IToolDefinition[],
    readOnlyOnly: boolean,
  ): readonly import('../../services/chatTypes.js').IToolDefinition[] => {
    return dedupeToolDefinitionsByName([
      ...platformTools,
      ...getRuntimeSkillToolDefinitions(readOnlyOnly),
    ]);
  };

  const invokeRuntimeToolWithSkillSupport = async (
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: import('./chatTypes.js').IChatRuntimeToolInvocationObserver,
  ) => {
    const platformTools = dataService.getToolDefinitions();
    if (platformTools.some((tool) => tool.name === name)) {
      return dataService.invokeToolWithRuntimeControl(name, args, token, observer);
    }

    const skill = getRuntimeSkillCatalog().find((entry) => entry.kind === 'tool' && entry.name === name);
    if (!skill) {
      return dataService.invokeToolWithRuntimeControl(name, args, token, observer);
    }

    const permission = resolveRuntimeSkillPermission(name, skill.permissionLevel);
    const metadata = {
      name,
      description: skill.description,
      permissionLevel: permission.level,
      enabled: true,
      requiresApproval: permission.level === 'requires-approval' && !permission.autoApproved,
      autoApproved: permission.autoApproved,
      approvalSource: permission.source,
      source: 'built-in' as const,
    };

    observer?.onValidated?.(metadata);

    if (permission.level === 'never-allowed') {
      observer?.onApprovalResolved?.(metadata, false);
      return { content: `Tool "${name}" is not allowed`, isError: true };
    }

    if (metadata.requiresApproval) {
      const approved = _permissionService
        ? await _permissionService.confirmToolInvocation(name, skill.description, args, skill.permissionLevel)
        : false;
      observer?.onApprovalResolved?.(metadata, approved);
      if (!approved) {
        return { content: 'Tool execution rejected by user', isError: true };
      }
    } else if (metadata.autoApproved) {
      observer?.onApprovalResolved?.(metadata, true);
    }

    if (token.isCancellationRequested) {
      return { content: 'Tool execution cancelled', isError: true };
    }

    const result = {
      content: skill.body
        ? `## Skill: ${skill.name}\n\nFollow these instructions:\n\n${skill.body}`
        : `Skill "${skill.name}" has no instructions body.`,
      isError: !skill.body,
    };
    observer?.onExecuted?.(metadata, result);
    return result;
  };

  const openclawDefaultParticipantServices = buildOpenclawDefaultParticipantServices({
    sendChatRequest: (m, o, s) => dataService.sendChatRequest(m, o, s),
    getActiveModel: () => dataService.getActiveModel(),
    getWorkspaceName: () => dataService.getWorkspaceName(),
    getPageCount: () => dataService.getPageCount(),
    getCurrentPageTitle: () => dataService.getCurrentPageTitle(),
    getToolDefinitions: () => dataService.getToolDefinitions(),
    getReadOnlyToolDefinitions: () => dataService.getReadOnlyToolDefinitions(),
    invokeToolWithRuntimeControl: (n, a, t, o) => invokeRuntimeToolWithSkillSupport(n, a, t, o),
    maxIterations: unifiedConfigService?.getEffectiveConfig().agent.maxIterations ?? 25,
    networkTimeout: 120_000,
    getModelContextLength: () => dataService.getModelContextLength(),
    sendSummarizationRequest: (m, s) => dataService.sendSummarizationRequest(m, s),
    getFileCount: fsAccessor ? () => dataService.getFileCount() : undefined,
    isRAGAvailable: () => dataService.isRAGAvailable(),
    isIndexing: () => dataService.isIndexing(),
    readFileContent: (p) => dataService.readFileContent(p),
    getCurrentPageContent: () => dataService.getCurrentPageContent(),
    retrieveContext: retrievalService
      ? (q, pathPrefixes) => dataService.retrieveContext(q, pathPrefixes) as Promise<{ text: string; sources: Array<{ uri: string; label: string; index: number }> } | undefined>
      : undefined,
    recallMemories: (memoryService || workspaceMemoryService) ? (q, s) => dataService.recallMemories(q, s) : undefined,
    recallTranscripts: retrievalService ? (q) => dataService.recallTranscripts(q) : undefined,
    storeSessionMemory: (memoryService || workspaceMemoryService) ? (s, su, m) => dataService.storeSessionMemory(s, su, m) : undefined,
    storeConceptsFromSession: memoryService ? (c, s) => dataService.storeConceptsFromSession(c, s) : undefined,
    recallConcepts: memoryService ? (q) => dataService.recallConcepts(q) : undefined,
    isSessionEligibleForSummary: memoryService ? (m) => dataService.isSessionEligibleForSummary(m) : undefined,
    hasSessionMemory: memoryService ? (s) => dataService.hasSessionMemory(s) : undefined,
    getSessionMemoryMessageCount: memoryService ? (s) => dataService.getSessionMemoryMessageCount(s) : undefined,
    extractPreferences: (memoryService || workspaceMemoryService) ? (t) => dataService.extractPreferences(t) : undefined,
    getPreferencesForPrompt: (memoryService || workspaceMemoryService) ? () => dataService.getPreferencesForPrompt() : undefined,
    getPromptOverlay: _promptFileService ? (a) => dataService.getPromptOverlay(a) : undefined,
    listFilesRelative: fsAccessor ? (r) => dataService.listFilesRelative(r) : undefined,
    readFileRelative: fsAccessor ? (r) => dataService.readFileRelative(r) : undefined,
    writeFileRelative: (fileService && workspaceService?.folders?.length) ? (r, c) => dataService.writeFileRelative(r, c) : undefined,
    existsRelative: fsAccessor ? (r) => dataService.existsRelative(r) : undefined,
    invalidatePromptFiles: _promptFileService ? () => dataService.invalidatePromptFiles() : undefined,
    reportContextPills: (p) => dataService.reportContextPills(p),
    reportRetrievalDebug: (debug) => dataService.reportRetrievalDebug(debug),
    reportResponseDebug: (debug) => dataService.reportResponseDebug(debug),
    reportRuntimeTrace: (trace) => dataService.reportRuntimeTrace(trace as import('./chatTypes.js').IChatRuntimeTrace),
    reportBootstrapDebug: (debug) => dataService.reportBootstrapDebug(debug),
    reportSystemPromptReport: (report) => dataService.reportSystemPromptReport(report),
    getExcludedContextIds: () => dataService.getExcludedContextIds(),
    reportBudget: (slots) => dataService.reportBudget(slots),
    getTerminalOutput: () => dataService.getTerminalOutput(),
    listFolderFiles: fsAccessor ? (f) => dataService.listFolderFiles(f) : undefined,
    userCommandFileSystem: dataService.getUserCommandFileSystem(),
    compactSession: (s, t) => dataService.compactSession(s, t),
    getWorkspaceDigest: () => dataService.getWorkspaceDigest(),
    getLastSystemPromptReport: () => dataService.getLastSystemPromptReport(),
    sessionManager,
    unifiedConfigService,
    getSkillCatalog: () => getRuntimeSkillCatalog(),
    getToolPermissions: _permissionService ? () => _permissionService!.getEffectivePermissions() : undefined,
    // D2: Command service delegates
    listModels: _ollamaProvider ? async () => {
      const models = await _ollamaProvider!.listModels();
      return models.map(m => ({ id: m.id, name: m.displayName ?? m.id, parameterSize: m.parameterSize, quantization: m.quantization, contextLength: m.contextLength }));
    } : undefined,
    checkProviderStatus: _ollamaProvider ? () => _ollamaProvider!.checkAvailability() : undefined,
    getSessionFlag: (key: string) => _sessionFlags.get(key) ?? false,
    setSessionFlag: (key: string, value: boolean) => { _sessionFlags.set(key, value); },
    executeCommand: (commandId: string, ...args: unknown[]) => { api.commands.executeCommand(commandId, ...args); },
    // W1 (M58): Bridge followup runner to chat service queue.
    // Upstream: scheduleFollowupDrain + enqueueFollowupRun.
    queueFollowupRequest: (sessionId: string, message: string) => {
      chatService.queueRequest(sessionId, message, ChatRequestQueueKind.Queued);
    },
    getAvailableModelIds: _ollamaProvider ? async () => {
      const models = await _ollamaProvider!.listModels().catch(() => []);
      return models.map(m => m.id);
    } : undefined,
    sendChatRequestForModel: _ollamaProvider ? (modelId: string) => {
      return (messages: Parameters<typeof dataService.sendChatRequest>[0], options?: Parameters<typeof dataService.sendChatRequest>[1], signal?: AbortSignal) =>
        _ollamaProvider!.sendChatRequest(modelId, messages as any, options as any, signal);
    } : undefined,
    // D3: Diagnostics service
    diagnosticsService: api.services.has(IDiagnosticsService)
      ? api.services.get<import('../../services/serviceTypes.js').IDiagnosticsService>(IDiagnosticsService)
      : undefined,
    // D7: Observability service for turn metric recording
    observabilityService: api.services.has(IObservabilityService)
      ? api.services.get<import('../../services/serviceTypes.js').IObservabilityService>(IObservabilityService)
      : undefined,
    // D4: Runtime hook registry
    runtimeHookRegistry: api.services.has(IRuntimeHookRegistry)
      ? api.services.get<import('../../services/serviceTypes.js').IRuntimeHookRegistry>(IRuntimeHookRegistry)
      : undefined,
    // D5: Vision model capability detection
    getActiveModelCapabilities: () => (languageModelsService as any).getActiveModelCapabilities?.() ?? ['completion'],
  });

  // D3 R1: Supplement diagnostics deps now that OllamaProvider + dataService are available
  if (api.services.has(IDiagnosticsService)) {
    const diagSvc = api.services.get<import('../../services/serviceTypes.js').IDiagnosticsService>(IDiagnosticsService);
    diagSvc.updateDeps({
      checkProviderStatus: _ollamaProvider ? () => _ollamaProvider!.checkAvailability() : undefined,
      getActiveModel: () => dataService.getActiveModel(),
      listModels: _ollamaProvider ? async () => {
        const models = await _ollamaProvider!.listModels();
        return models.map(m => ({ id: m.id, name: m.displayName ?? m.id, size: typeof m.parameterSize === 'string' ? parseInt(m.parameterSize, 10) || undefined : m.parameterSize }));
      } : undefined,
      isRAGAvailable: () => dataService.isRAGAvailable(),
      isIndexing: () => dataService.isIndexing(),
      getFileCount: fsAccessor ? () => dataService.getFileCount() : undefined,
      existsRelative: fsAccessor ? (r: string) => dataService.existsRelative(r) : undefined,
      getModelContextLength: () => dataService.getModelContextLength(),
      checkDocumentExtraction: async () => { try { return !!(api.services.has(IDocumentExtractionService)); } catch { return false; } },
      getEmbeddingContextLength: _ollamaProvider ? async () => {
        const embSvc = api.services.has(IEmbeddingService) ? api.services.get<import('../../services/serviceTypes.js').IEmbeddingService>(IEmbeddingService) : undefined;
        const modelName = embSvc?.getModelInfo().name ?? 'nomic-embed-text';
        return _ollamaProvider!.getModelContextLength(modelName);
      } : undefined,
    });
  }
  const openclawWorkspaceParticipantServices = buildOpenclawWorkspaceParticipantServices({
    sendChatRequest: (m, o, s) => dataService.sendChatRequest(m, o, s),
    getActiveModel: () => dataService.getActiveModel(),
    getWorkspaceName: () => dataService.getWorkspaceName(),
    listPages: () => dataService.listPages(),
    searchPages: (q) => dataService.searchPages(q),
    getPageContent: (p) => dataService.getPageContent(p),
    getPageTitle: (p) => dataService.getPageTitle(p),
    getReadOnlyToolDefinitions: () => mergeRuntimeToolDefinitions(dataService.getReadOnlyToolDefinitions(), true),
    invokeToolWithRuntimeControl: (n, a, t, o) => invokeRuntimeToolWithSkillSupport(n, a, t, o),
    listFiles: fsAccessor ? (r) => fsAccessor.readdir(r) : undefined,
    readFileContent: fsAccessor ? async (r) => { const res = await fsAccessor.readFileContent(r); return res.content; } : undefined,
    reportParticipantDebug: (debug) => dataService.reportParticipantDebug(debug),
    reportRetrievalDebug: (debug) => dataService.reportRetrievalDebug(debug),
    reportRuntimeTrace: (trace) => dataService.reportRuntimeTrace(trace as import('./chatTypes.js').IChatRuntimeTrace),
    reportBootstrapDebug: (debug) => dataService.reportBootstrapDebug(debug),
    observabilityService: api.services.has(IObservabilityService)
      ? api.services.get<import('../../services/serviceTypes.js').IObservabilityService>(IObservabilityService)
      : undefined,
    runtimeHookRegistry: api.services.has(IRuntimeHookRegistry)
      ? api.services.get<import('../../services/serviceTypes.js').IRuntimeHookRegistry>(IRuntimeHookRegistry)
      : undefined,
  });
  const openclawCanvasParticipantServices = buildOpenclawCanvasParticipantServices({
    sendChatRequest: (m, o, s) => dataService.sendChatRequest(m, o, s),
    getActiveModel: () => dataService.getActiveModel(),
    getWorkspaceName: () => dataService.getWorkspaceName(),
    getCurrentPageId: () => dataService.getCurrentPageId(),
    getCurrentPageTitle: () => dataService.getCurrentPageTitle(),
    getPageStructure: (p) => dataService.getPageStructure(p),
    getReadOnlyToolDefinitions: () => mergeRuntimeToolDefinitions(dataService.getReadOnlyToolDefinitions(), true),
    invokeToolWithRuntimeControl: (n, a, t, o) => invokeRuntimeToolWithSkillSupport(n, a, t, o),
    readFileContent: fsAccessor ? async (r) => { const res = await fsAccessor.readFileContent(r); return res.content; } : undefined,
    reportParticipantDebug: (debug) => dataService.reportParticipantDebug(debug),
    reportRetrievalDebug: (debug) => dataService.reportRetrievalDebug(debug),
    reportRuntimeTrace: (trace) => dataService.reportRuntimeTrace(trace as import('./chatTypes.js').IChatRuntimeTrace),
    reportBootstrapDebug: (debug) => dataService.reportBootstrapDebug(debug),
    observabilityService: api.services.has(IObservabilityService)
      ? api.services.get<import('../../services/serviceTypes.js').IObservabilityService>(IObservabilityService)
      : undefined,
    runtimeHookRegistry: api.services.has(IRuntimeHookRegistry)
      ? api.services.get<import('../../services/serviceTypes.js').IRuntimeHookRegistry>(IRuntimeHookRegistry)
      : undefined,
  });

  context.subscriptions.push(...registerOpenclawParticipants({
    agentService,
    defaultParticipantServices: openclawDefaultParticipantServices,
    workspaceParticipantServices: openclawWorkspaceParticipantServices,
    canvasParticipantServices: openclawCanvasParticipantServices,
  }));



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
          // Find the chat message list to append the confirmation card inline
          const chatContainer = document.querySelector('.parallx-chat-message-list');
          if (!chatContainer) {
            // No chat UI mounted — reject rather than appending to body and breaking layout
            console.warn('[PermissionService] Confirmation handler: chat container not found, rejecting');
            resolve('reject');
            return;
          }

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
        async retrieve(query: string, sourceFilter?: string, pathPrefixes?: string[]) {
          // No hardcoded limits — retrieval params from AI Settings.
          const chunks = await retrievalService!.retrieve(query, {
            sourceFilter,
            pathPrefixes,
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

    const transcriptSearchAccessor = retrievalService && indexingPipelineService && unifiedConfigService
      ? {
          isEnabled: () => unifiedConfigService.getEffectiveConfig().memory.transcriptIndexingEnabled === true,
          isReady: () => indexingPipelineService.isInitialIndexComplete,
          async search(query: string, options?: { sessionId?: string }) {
            if (unifiedConfigService.getEffectiveConfig().memory.transcriptIndexingEnabled !== true) {
              return [];
            }

            if (!fsAccessor) {
              return [];
            }

            return searchWorkspaceTranscripts(fsAccessor, query, options);
          },
        }
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
            const result = await fsAccessor.readFileContent('.parallxignore');
            _writerIgnoreInstance.loadFromContent(result.content);
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

    // ── CronService (M58 W4) ──
    //
    // The scheduler is instantiated here (before tool registration) so the 8
    // cron tool actions (cron_status, cron_list, cron_add, cron_update,
    // cron_remove, cron_run, cron_runs, cron_wake) have a live host.
    //
    // Ship-thin scope per Parallx_Milestone_58.md §6.5: the executor only
    // routes origin-stamped status + notification surface deliveries. The
    // `payload.agentTurn` string is preserved in delivery metadata for M59's
    // isolated-turn substrate to pick up.
    //
    // Safety: jobs are created only by user-approved `cron_add` tool calls
    // (see `openclawToolPolicy.ts#cronToolRequiresApproval`). No jobs exist
    // by default, so the timer ticks over an empty map.
    //
    // Heartbeat wake-mode (`next-heartbeat`) is implemented via a lazy
    // reference — the HeartbeatRunner is instantiated a few blocks below
    // (§3c) and is patched into `cronHeartbeatRunnerRef` at that point.
    // If cron fires before heartbeat is up, the wake is a no-op.
    if (surfaceRouter) {
      const cronExecutor = createCronTurnExecutor(surfaceRouter);
      const cronContextFetcher = createCronContextLineFetcher({
        getActiveSession: () => {
          const id = _activeWidget?.getSession()?.id;
          return id ? chatService.getSession(id) : undefined;
        },
      });
      cronService = new CronService(cronExecutor, cronContextFetcher, cronHeartbeatWaker);
      cronService.start();
      context.subscriptions.push(cronService);
    }

    const toolDisposables = registerBuiltInTools(languageModelToolsService, databaseService ?? undefined, fsAccessor, getCurrentPageId, retrievalAccessor, canonicalMemorySearchAccessor, transcriptSearchAccessor, writerAccessor, terminalAccessor, workspaceService?.folders?.[0]?.uri?.fsPath, surfaceRouter, cronService);
    for (const d of toolDisposables) {
      context.subscriptions.push(d);
    }
  }

  // ── 3b. Register chat-owned surface plugins (M58 W6) ──
  // The surface router is created in the workbench Phase 5; the chat-owned
  // plugins (chat, filesystem, canvas) can only be built here because their
  // backing services live in chat activation scope.
  if (surfaceRouter) {
    // Chat surface — currently a trace-only logger; W5 will extend for
    // sub-agent quoted-card appends. See src/built-in/chat/surfaces/chatSurface.ts.
    surfaceRouter.registerSurface(new ChatSurfacePlugin());
    context.subscriptions.push({ dispose: () => surfaceRouter.unregisterSurface('chat') });

    if (fileService) {
      surfaceRouter.registerSurface(new FilesystemSurfacePlugin(fileService, workspaceService));
      context.subscriptions.push({ dispose: () => surfaceRouter.unregisterSurface('filesystem') });
    }

    // Canvas — read-only stub in M58; real write path deferred to M59.
    surfaceRouter.registerSurface(new CanvasSurfacePlugin());
    context.subscriptions.push({ dispose: () => surfaceRouter.unregisterSurface('canvas') });
  }

  // ── 3c. Heartbeat runner (M58 W2) ──
  //
  // Wires the audit-closed HeartbeatRunner (D2 13/13 ALIGNED) to the workbench
  // so that interval ticks + real workspace events (file changes, index
  // completion, workspace-folder changes) drive narrow status-surface updates
  // through the SurfaceRouter. See src/openclaw/openclawHeartbeatExecutor.ts
  // for the scope-of-isolation decision.
  //
  // Safety defaults: the runner is constructed with `enabled: false` unless
  // the user has explicitly opted in via AI settings. Interval is clamped to
  // [30s, 1h]. Reasons outside the config allowlist are silently ignored.
  //
  // The runner is guarded on surfaceRouter + unifiedConfigService availability.
  // Missing either → heartbeat is inert (no timer, no event queue growth).
  if (surfaceRouter && unifiedConfigService) {
    const readHeartbeatConfig = (): IHeartbeatConfig => {
      const hb = unifiedConfigService.getEffectiveConfig().heartbeat;
      return { enabled: hb.enabled, intervalMs: hb.intervalMs };
    };

    const executor = createHeartbeatTurnExecutor(surfaceRouter, () => ({
      reasons: unifiedConfigService.getEffectiveConfig().heartbeat.reasons,
    }));

    const heartbeatRunner = new HeartbeatRunner(executor, readHeartbeatConfig);
    context.subscriptions.push(heartbeatRunner);

    // W4 → W2 link: complete the `next-heartbeat` cron wake-mode by handing
    // the just-built runner to the waker closure that `cronService` already
    // holds.
    cronHeartbeatRunnerRef = heartbeatRunner;
    context.subscriptions.push({
      dispose: () => { cronHeartbeatRunnerRef = undefined; },
    });

    // Honor initial config — start() no-ops when enabled=false.
    heartbeatRunner.start();

    // React to config changes: enabled flip → start/stop; interval change →
    // restart so the next setTimeout is armed with the new value. Reasons
    // changes are picked up live through the executor's config closure.
    context.subscriptions.push(
      unifiedConfigService.onDidChangeConfig(() => {
        heartbeatRunner.stop();
        heartbeatRunner.start();
      }),
    );

    // ── W2.4a File-change events ──
    if (fileService) {
      context.subscriptions.push(
        fileService.onDidFileChange((events) => {
          // Coalesce burst events into a single pushEvent per resource; the
          // runner's built-in input-level dedup (60s window) further absorbs
          // repeats.
          for (const ev of events) {
            heartbeatRunner.pushEvent({
              type: 'file-change',
              payload: { path: ev.uri.toString(), changeType: ev.type },
              timestamp: Date.now(),
            });
          }
        }),
      );
    }

    // ── W2.4b Indexer completion events ──
    if (indexingPipelineService) {
      context.subscriptions.push(
        indexingPipelineService.onDidCompleteInitialIndex((stats) => {
          heartbeatRunner.pushEvent({
            type: 'index-complete',
            payload: { ...stats },
            timestamp: Date.now(),
          });
        }),
      );
    }

    // ── W2.4c Workspace-change events ──
    if (workspaceService) {
      context.subscriptions.push(
        workspaceService.onDidChangeFolders((e) => {
          heartbeatRunner.pushEvent({
            type: 'workspace-change',
            payload: { added: e.added.length, removed: e.removed.length },
            timestamp: Date.now(),
          });
        }),
      );
    }

    // ── W2.5 Wake command ──
    context.subscriptions.push(
      api.commands.registerCommand('parallx.wakeAgent', () => {
        heartbeatRunner.wake('wake');
      }),
    );
  }

  // ── 4. Build widget services bridge (delegates to ChatDataService) ──

  const widgetServices = dataService.buildWidgetServices();
  // C2: Wire AI Settings opener — accessible from the chat title bar gear icon
  (widgetServices as unknown as Record<string, unknown>).openAISettings = () => {
    api.commands.executeCommand('ai-settings.open');
  };

  // Wire token bar services into widget services (for in-widget token indicator)
  const tokenBarServices = dataService.buildTokenBarServices();
  (widgetServices as unknown as Record<string, unknown>).tokenBarServices = tokenBarServices;

  // Wire workspace storage for per-workspace UI preferences (sidebar width, etc.)
  const wsStorage = api.services.has(IWorkspaceStorageService)
    ? api.services.get<import('../../platform/storage.js').IStorage>(IWorkspaceStorageService)
    : undefined;
  if (wsStorage) {
    (widgetServices as unknown as Record<string, unknown>).workspaceStorage = wsStorage;
  }

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

  // M48: Ensure chat panel is visible (no-op if already shown)
  context.subscriptions.push(
    api.commands.registerCommand('chat.show', () => {
      const layout = api.services.has(ILayoutService)
        ? api.services.get<import('../../services/serviceTypes.js').ILayoutService>(ILayoutService)
        : undefined;
      if (layout && !layout.isVisible('workbench.parts.auxiliarybar')) {
        api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
      }
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

  // Add a file/folder as context attachment to the chat input
  context.subscriptions.push(
    api.commands.registerCommand('chat.addFileAttachment', (...args: unknown[]) => {
      const file = args[0] as { name?: string; fullPath?: string } | undefined;
      if (_activeWidget && file?.name && file?.fullPath) {
        _activeWidget.addFileAttachment({ name: file.name, fullPath: file.fullPath });
        _activeWidget.focus();
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.switchMode', () => {
      // M41 Phase 9: Cycle Agent ↔ Edit (Ask collapsed into Agent)
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

  // ── 6b. Index stats hydration ──

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
    } catch (err) {
      console.warn('[Chat] Failed to hydrate index stats:', err);
    }
  };

  const _subscribeIndexingEvents = (): void => {
    // Dispose previous listeners
    for (const d of _indexingSubs) d.dispose();
    _indexingSubs = [];

    if (!indexingPipelineService) return;

    const completeSub = indexingPipelineService.onDidCompleteInitialIndex((stats) => {
      _lastIndexStats = { pages: stats.pages, files: stats.files };
      dataService.setLastIndexStats(_lastIndexStats);
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
        readFile: async (path: string) => { const r = await fsAccessor!.readFileContent(path); return r.content; },
        listDirs: async (path: string) => {
          try {
            const entries = await fsAccessor!.readdir(path);
            return entries.filter(e => e.type === 'directory').map(e => e.name);
          } catch { return []; }
        },
        exists: (path: string) => fsAccessor!.exists(path),
      });
      skillLoader.scanSkills().then(async () => {
        // Seed any missing default skills into .parallx/skills/ (for pre-existing workspaces)
        try {
          const parallxExists = await fsAccessor!.exists('.parallx');
          if (parallxExists && fileService && workspaceService) {
            const { defaultSkillContents } = await import('./skills/defaultSkillContents.js');
            const folders = workspaceService.folders;
            if (folders && folders.length > 0) {
              const rootUri = folders[0].uri;
              let seeded = false;
              for (const [name, content] of defaultSkillContents) {
                const rel = `.parallx/skills/${name}/SKILL.md`;
                const skillExists = await fsAccessor!.exists(rel);
                if (!skillExists) {
                  const clean = normalizeWorkspaceRelativePath(rel);
                  const parentPath = clean.slice(0, clean.lastIndexOf('/'));
                  try { await fileService.mkdir(rootUri.joinPath(parentPath)); } catch { /* may exist */ }
                  await fileService.writeFile(rootUri.joinPath(clean), content);
                  seeded = true;
                }
              }
              if (seeded) {
                await skillLoader.scanSkills();
              }
            }
          }
        } catch { /* best-effort seeding */ }
      }).catch(() => { /* best-effort */ });
      context.subscriptions.push(skillLoader);

      // Store reference so OpenClaw participant services can access skills
      _skillLoaderRef = skillLoader;

      // File watcher: live-reload skills when .parallx/skills/ changes
      if (fileService?.onDidFileChange) {
        let debounceTimer: ReturnType<typeof setTimeout> | undefined;
        const SKILLS_PATH_SEGMENT = '.parallx/skills/';
        context.subscriptions.push(
          fileService.onDidFileChange((events) => {
            const skillEvents = events.filter(e => {
              const p = e.uri.fsPath.replace(/\\/g, '/');
              return p.includes(SKILLS_PATH_SEGMENT);
            });
            if (skillEvents.length === 0) { return; }
            // Debounce rapid saves: wait 500ms then rescan
            if (debounceTimer !== undefined) { clearTimeout(debounceTimer); }
            debounceTimer = setTimeout(() => {
              debounceTimer = undefined;
              skillLoader.scanSkills().catch(() => { /* best-effort */ });
            }, 500);
          }),
        );
      }

    }).catch(() => { /* optional service */ });
  }

  // M20: Wire workspace filesystem to UnifiedAIConfigService for config.json import
  // Replaces the standalone ParallxConfigService (M11 Task 2.9).
  if (fsAccessor && unifiedConfigService) {
    unifiedConfigService.setFileSystem({
      readFile: async (path: string) => { const r = await fsAccessor!.readFileContent(path); return r.content; },
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
        readFile: async (path: string) => { const r = await fsAccessor!.readFileContent(path); return r.content; },
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

  // ── M48: Unified Selection → AI Action System ──

  _selectionDispatcher = new SelectionActionDispatcher();
  _chatProgrammaticAccess = new ChatProgrammaticAccess(
    () => _activeWidget,
    (id: string, ...args: unknown[]) => api.commands.executeCommand(id, ...args),
  );

  _selectionDispatcher.setServices({
    chatAccess: _chatProgrammaticAccess,
    executeCommand: (id: string, ...args: unknown[]) => api.commands.executeCommand(id, ...args),
  });

  // Register built-in action handlers (add-to-chat, send-to-canvas)
  for (const handler of createBuiltInActionHandlers()) {
    context.subscriptions.push(_selectionDispatcher.registerHandler(handler));
  }

  // Expose the dispatcher to other built-in tools via command
  context.subscriptions.push(
    api.commands.registerCommand('chat.getSelectionActionDispatcher', () => _selectionDispatcher),
  );

  // Direct selection-context command for editor surface adapters
  context.subscriptions.push(
    api.commands.registerCommand('chat.addSelectionContext', (...args: unknown[]) => {
      const attachment = args[0] as IChatSelectionAttachment | undefined;
      if (_chatProgrammaticAccess && attachment) {
        _chatProgrammaticAccess.addSelectionAttachment(attachment);
      }
    }),
  );

  context.subscriptions.push(_selectionDispatcher);

  // Global listener for bubbling selection-action events from editor panes
  const onSelectionAction = (e: globalThis.Event): void => {
    const detail = (e as CustomEvent).detail;
    if (!detail || !detail.actionId || !detail.selectedText) return;
    _selectionDispatcher?.dispatch({
      selectedText: detail.selectedText,
      surface: detail.surface ?? 'unknown',
      actionId: detail.actionId,
      source: detail.source ?? { fileName: 'unknown', filePath: 'unknown' },
    });
  };
  document.addEventListener('parallx-selection-action', onSelectionAction);
  context.subscriptions.push({
    dispose: () => document.removeEventListener('parallx-selection-action', onSelectionAction),
  });

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

    // Wire slash command autocomplete from the OpenClaw command registry
    const cmdRegistry = createOpenclawCommandRegistry();
    widget.setSlashCommandProvider({
      getCommands() {
        return (cmdRegistry.getRegisteredCommands?.() ?? []).map(c => ({
          name: c.name,
          description: c.description ?? '',
        }));
      },
    });
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
  _promptFileService = undefined;
  _fsAccessor = undefined;
  _api = undefined;
  _writerIgnoreInstance = undefined;
  _loadWriterIgnore = undefined;
  _selectionDispatcher?.dispose();
  _selectionDispatcher = undefined;
  _chatProgrammaticAccess = undefined;
}
