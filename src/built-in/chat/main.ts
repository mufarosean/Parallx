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
import type { LinksApi } from '../../links/linksApi.js';
import { OllamaProvider } from './providers/ollamaProvider.js';
import { AnthropicProvider, getAnthropicBridge } from './providers/anthropicProvider.js';
import { createChatView } from './widgets/chatView.js';
import type { ChatWidget } from './widgets/chatWidget.js';
import { AUTONOMY_ACTIVITY_WIDGET } from './widgets/autonomyActivityWidget.js';
import { createBackgroundPromptRunner } from './utilities/backgroundPromptRunner.js';

import {
  buildOpenclawCanvasParticipantServices,
  buildOpenclawDefaultParticipantServices,
  buildOpenclawWorkspaceParticipantServices,
} from '../../openclaw/openclawParticipantServices.js';
import { buildToolDefinitionFromSkillCatalogEntry } from '../../openclaw/openclawToolState.js';
import { registerOpenclawParticipants } from '../../openclaw/registerOpenclawParticipants.js';
import { createOpenclawCommandRegistry } from '../../openclaw/openclawDefaultRuntimeSupport.js';
import { registerBuiltInTools } from './tools/builtInTools.js';
import { createPlanUpdateTool, formatSessionPlan } from './tools/planTools.js';
import { clearResourceRegistry } from '../../services/toolResourceRegistry.js';
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
import { IWorkspaceService, IDatabaseService, IFileService, ITextFileModelManager, IRetrievalService, IIndexingPipelineService, IMemoryService, IRelatedContentService, IAutoTaggingService, IProactiveSuggestionsService, ISessionManager, IUnifiedAIConfigService, IAgentApprovalService, IAgentExecutionService, IAgentPolicyService, IAgentSessionService, IAgentTaskStore, IAgentTraceService, IVectorStoreService, IWorkspaceMemoryService, ICanonicalMemorySearchService, IDiagnosticsService, IDocumentExtractionService, IObservabilityService, IRuntimeHookRegistry, ILayoutService, IEmbeddingService, IWorkspaceStorageService, ISurfaceRouterService, IAutonomyLogService, IAutonomyEventLog, ISettingsRegistryService, IAutonomyTaskRailService, IAutonomyPatternMemoryService, IAutonomyFeatureFlagsService, ISemanticGraphService, IMindMapRefreshOrchestrator, ICanvasPageQueryService, IPlannerQueryService } from '../../services/serviceTypes.js';
import { IActivityJournalService } from '../../services/activityJournalService.js';
import { IPythonEnvService } from '../../services/pythonEnvService.js';
import { INotebookKernelService } from '../../services/notebookKernelService.js';
import { findOpenNotebook } from '../../editor/panes/notebook/notebookEditorInput.js';
import { writeThroughOpenDocument } from '../../services/openDocumentWriter.js';
import { getGlobalSettingsRegistry } from '../../services/settingsRegistryService.js';
import { PolicyDecisionPoint as _PolicyDecisionPoint } from '../../services/policyDecisionPoint.js';
import { registerAutonomyFlagSettings } from '../../services/autonomySettingsSchemas.js';
import {
  registerAIProfileSettings,
  registerSettingsActions,
} from '../../aiSettings/aiProfileSettingsSchemas.js';
import { ChatSurfacePlugin } from './surfaces/chatSurface.js';
import { FilesystemSurfacePlugin } from '../../services/surfaces/filesystemSurface.js';
import { CanvasSurfacePlugin } from '../canvas/surfaces/canvasSurface.js';
import { HeartbeatRunner, type IHeartbeatConfig } from '../../openclaw/openclawHeartbeatRunner.js';
import { createHeartbeatTurnExecutor } from '../../openclaw/openclawHeartbeatExecutor.js';
import { ARCHIVED_RUN_EDITOR_TYPE, renderArchivedRun } from './archivedRunViewer.js';
import { runHeartbeatDeterministicLane } from '../../openclaw/heartbeatDeterministicLane.js';
import { buildPlanFacts, contentHashPrefix } from '../../openclaw/heartbeatTriggers.js';
import { HEARTBEAT_PURPOSE_PATH, parseHeartbeatPurpose } from '../../openclaw/heartbeatPurpose.js';
import { createHeartbeatWatchTool } from './tools/heartbeatWatchTool.js';
import { INotificationService } from '../../services/serviceTypes.js';
import { MindService } from '../../openclaw/mind/mindService.js';
import { MindStore } from '../../openclaw/mind/mindStore.js';
import { ActionLedger } from '../../openclaw/mind/actionLedger.js';
import { PredictionLoop } from '../../openclaw/mind/predictionLoop.js';
import { SequencePredictor } from '../../openclaw/mind/sequencePredictor.js';
import { SurpriseAccumulator } from '../../openclaw/mind/surpriseAccumulator.js';
import { cronForMinuteOfDay, habitActionForActivity } from '../../openclaw/mind/habitDetector.js';
import { createMindRememberTool } from './tools/mindTools.js';
import { signalToSystemEvent } from '../../openclaw/openclawAutonomySignal.js';
import { IAutonomySignalService } from '../../services/autonomySignalService.js';
import { shouldHeartbeatAcceptPath } from '../../openclaw/openclawHeartbeatFileFilter.js';
import { CronService, ICronService, type HeartbeatWaker } from '../../openclaw/openclawCronService.js';
import {
  createCronTurnExecutor,
  createCronContextLineFetcher,
} from '../../openclaw/openclawCronExecutor.js';
import { SubagentSpawner } from '../../openclaw/openclawSubagentSpawn.js';
import { AutonomyLogService } from '../../services/autonomyLogService.js';
import {
  AutonomyFeatureFlagsService,
  FLAG_PAUSED_GLOBAL,
  FLAG_SUBAGENT_ENABLED,
  FLAG_PATTERN_MEMORY_ENABLED,
  isAutonomyTriggerAllowed,
} from '../../services/autonomyFeatureFlags.js';
import {
  AutonomyEventLog,
  type IAutonomyEventLogFs,
} from '../../services/autonomyEventLog.js';
import {
  AutonomyPatternMemoryService,
  computeArgsShape,
} from '../../services/autonomyPatternMemoryService.js';
import { AutonomyTaskRailService } from '../../services/autonomyTaskRailService.js';
import type { IRailFilter, IRailRow } from '../../services/autonomyTaskRailService.js';
import {
  createSubagentTurnExecutor,
  createSubagentAnnouncer,
} from '../../openclaw/openclawSubagentExecutor.js';
import { IEditorService, ICommandService } from '../../services/serviceTypes.js';
import { IIntrospectionService } from '../../services/introspectionService.js';
import type { IBuiltInToolFileSystem } from './chatTypes.js';
import { PromptFileService } from '../../services/promptFileService.js';
import type { IPromptFileAccess } from '../../services/promptFileService.js';
import { PermissionService } from '../../services/permissionService.js';
import type { IPermissionCheckResult } from '../../services/permissionService.js';
import type { ToolGrantDecision } from '../../services/chatTypes.js';
import { ChatDataService, buildFileSystemAccessor } from './data/chatDataService.js';
import { URI } from '../../platform/uri.js';
import type { AgentPlanStepInput, DelegatedTaskInput, AgentApprovalResolution } from '../../agent/agentTypes.js';
import { searchWorkspaceTranscripts } from '../../services/transcriptSearch.js';
import {
  resolveChatRuntimeParticipantId,
} from '../../services/chatRuntimeSelector.js';

import { SelectionActionDispatcher } from '../../services/selectionActionDispatcher.js';
import { createBuiltInActionHandlers } from '../../services/selectionActionHandlers.js';
import { ChatProgrammaticAccess } from './chatProgrammaticAccess.js';
import type { IChatSelectionAttachment, ICanvasBlockReferencePayload } from '../../services/selectionActionTypes.js';

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
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
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
    registerInstance<T>(id: { readonly id: string }, instance: T): void;
  };
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
    openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;
    registerEditorProvider(
      typeId: string,
      provider: { createEditorPane(container: HTMLElement, input?: unknown): { dispose(): void } },
    ): { dispose(): void };
  };
  links: LinksApi;
  dashboard: {
    registerWidgetType<TConfig = Record<string, unknown>>(
      registration: import('../../api/bridges/dashboardBridge.js').WidgetTypeRegistration<TConfig>,
    ): IDisposable;
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
/** The MIND, if workspace storage allowed one — read by the participant deps
 *  (continuity injection) which build earlier in activate() than the MIND. */
let _mindServiceRef: MindService | undefined;
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

export async function activate(api: ParallxApi, context: ToolContext): Promise<void> {
  _api = api;

  // ── M86: dashboard widget contribution ──
  //
  // The "Autonomy activity" widget renders this tool's autonomy task rail,
  // so this tool owns and contributes it. Registration is inert until the
  // dashboard mirrors it (activation-order independent).
  context.subscriptions.push(api.dashboard.registerWidgetType(AUTONOMY_ACTIVITY_WIDGET));

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

  // ── Autonomy log (M58-real post-ship UX reshape) ──
  //
  // Dedicated, in-memory store for heartbeat / cron / subagent results
  // so the chat transcript stays clean. The AutonomyLogSection in AI
  // Settings renders it; the `autonomy_log` built-in tool lets the
  // agent read it back between turns. Registered globally in
  // workbenchServices.ts so AI Settings activation can see it too.
  // The workbench registers IAutonomyLogService in workbenchServices.ts
  // before any extension activates. Falling back to a private instance here
  // would silently desync ChatSurfacePlugin from the autonomy-log panel,
  // which subscribes to the workbench-registered instance — that's exactly
  // how the "panel doesn't update" regression sneaks in. Fail loudly.
  if (!api.services.has(IAutonomyLogService)) {
    throw new Error('[chat] IAutonomyLogService not registered — workbench bootstrap order broken');
  }
  const autonomyLog = api.services.get<AutonomyLogService>(IAutonomyLogService);
  // Activity journal — the app's common activity language. Feeds the
  // heartbeat's wake context and the activity_log chat tool.
  const _activityJournal = api.services.has(IActivityJournalService)
    ? api.services.get<import('../../services/activityJournalService.js').IActivityJournalService>(IActivityJournalService)
    : undefined;

  // ── M60 §3.8 + §3.10: Autonomy controls layer ──────────────────────────
  //
  // Phase D step 5a: the substrate (feature flags, event log, task rail,
  // pattern memory) is CORE's — the workbench constructs it in
  // autonomyBootstrap before any tool activates. Chat resolves the pieces
  // and wires them into the machinery they gate (SurfaceRouterService,
  // the openclaw participant services, cron). Flags fail loudly like the
  // autonomy log: a missing registration is a bootstrap-order bug, and a
  // silent private fallback is how desyncs sneak in.
  if (!api.services.has(IAutonomyFeatureFlagsService)) {
    throw new Error('[chat] IAutonomyFeatureFlagsService not registered — workbench bootstrap order broken');
  }
  const autonomyFlags = api.services.get<AutonomyFeatureFlagsService>(IAutonomyFeatureFlagsService);

  // ── Settings schemas (chat's own) ────────────────────────────────────────
  //
  // Phase D step 4: the registry itself is CORE's — the workbench
  // constructs it before any tool activates (settingsRegistryBootstrap).
  // Chat is a consumer like everyone else: it resolves the registry and
  // registers only its own domain. The sentinel key guards reactivation
  // (schemas register once per app lifetime, as before).
  const settingsRegistry = api.services.has(ISettingsRegistryService)
    ? api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(ISettingsRegistryService)
    : undefined;
  if (settingsRegistry && !settingsRegistry.getSchema('ai.providers.ollama.enabled')) {
    // Model providers — each is enabled PER WORKSPACE from AI Settings → Model →
    // Providers. Ollama (local) defaults ON; Claude (cloud) defaults OFF so
    // nothing leaves the machine unless the user turns it on for a non-sensitive
    // workspace. The Claude API key lives in the main process (never the renderer).
    settingsRegistry.register({
      key: 'ai.providers.ollama.enabled',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Enable the local Ollama model provider in this workspace.',
      category: 'AI',
    });
    settingsRegistry.register({
      key: 'ai.providers.anthropic.enabled',
      type: 'boolean',
      default: false,
      scope: 'workspace',
      description: 'Enable Claude (Anthropic) cloud models in this workspace. Off by default: turn on only for workspaces without sensitive data. Set the API key in AI Settings → Model → Providers.',
      category: 'AI',
    });

    // Bind the autonomy flags. (The non-flag autonomy settings the runtime reads
    // live in the unified AI config — the old unwired substrate schemas were removed.)
    registerAutonomyFlagSettings(settingsRegistry, autonomyFlags);

    // (canvas.propertyBar.collapsed removed — the legacy property bar is
    // retired; properties live in databases now.)

    // M62: Gmail-specific settings removed. Provider integrations now
    // ship as MCP servers (see tools/gmail-mcp-server). Users register
    // them via chat-gear → MCP Servers.

    // ── M61 Phase 4: AI profile settings (persona/chat/model/etc) ────────
    // Register schemas + bind to UnifiedAIConfigService when present so the
    // unified settings overlay is the single editor for these values.
    if (api.services.has(IUnifiedAIConfigService)) {
      const _unified = api.services.get<
        import('../../aiSettings/unifiedConfigTypes.js').IUnifiedAIConfigService
      >(IUnifiedAIConfigService);
      registerAIProfileSettings(settingsRegistry, _unified);
    }

    // ── M61 Phase 4: action rows (managers + workspace import/export/reset) ──
    registerSettingsActions(settingsRegistry, [
      {
        key: 'tools.manage',
        category: 'Tools',
        description: 'Open the tool tree to enable or disable individual tools.',
        actionLabel: 'Manage tools…',
        command: 'aiSettings.manageTools',
      },
      {
        key: 'mcp.servers.manage',
        category: 'Integrations',
        description: 'Install MCP servers from the catalog or add a custom one.',
        actionLabel: 'Manage MCP servers…',
        command: 'aiSettings.manageMcp',
      },
      {
        key: 'agent.configs.manage',
        category: 'Agent',
        description: 'Configure individual sub-agents (model, max iterations, custom instructions).',
        actionLabel: 'Manage agents…',
        command: 'aiSettings.manageAgents',
      },
      {
        key: 'autonomy.cron.jobs.manage',
        category: 'Autonomy',
        description: 'View and edit the scheduled cron jobs for this workspace.',
        actionLabel: 'Manage cron jobs…',
        command: 'aiSettings.manageCron',
      },
      {
        key: 'workspace.exportConfig',
        category: 'Workspace',
        description: 'Export every workspace setting (and the active preset) to a JSON file.',
        actionLabel: 'Export workspace config…',
        command: 'workspace.exportConfig',
      },
      {
        key: 'workspace.importConfig',
        category: 'Workspace',
        description: 'Import a previously exported workspace settings JSON file.',
        actionLabel: 'Import workspace config…',
        command: 'workspace.importConfig',
      },
      {
        key: 'workspace.resetConfig',
        category: 'Workspace',
        description: 'Reset every workspace setting to its default. Cannot be undone.',
        actionLabel: 'Reset workspace settings…',
        command: 'workspace.resetConfig',
      },
    ]);
  }

  // The preload bridge — still needed by chat's own machinery below (fs
  // workspace root, cron persistence). The autonomy substrate that used to
  // be constructed here over this bridge (event log, task rail, pattern
  // memory, with their legacy-file migrations) now comes from CORE's
  // autonomyBootstrap (Phase D step 5a) and is resolved just below.
  const _bridge = (globalThis as { parallxElectron?: {
    appPath?: string;
    fs?: IAutonomyEventLogFs & {
      readdir?: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string }>; error?: string }>;
      rename?: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
    };
  } }).parallxElectron;
  const _fsBridge = _bridge?.fs;

  const autonomyEventLog = api.services.has(IAutonomyEventLog)
    ? api.services.get<AutonomyEventLog>(IAutonomyEventLog)
    : undefined;
  const autonomyTaskRail = api.services.has(IAutonomyTaskRailService)
    ? api.services.get<AutonomyTaskRailService>(IAutonomyTaskRailService)
    : undefined;
  const autonomyPatternMemory = api.services.has(IAutonomyPatternMemoryService)
    ? api.services.get<AutonomyPatternMemoryService>(IAutonomyPatternMemoryService)
    : undefined;

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

  // M67 Phase 2.4 — register workspace root with main process for IPC write-path validation.
  const _fsBridgeAny = _fsBridge as unknown as Record<string, unknown> | undefined;
  if (_fsBridgeAny && typeof _fsBridgeAny['setWorkspaceRoot'] === 'function') {
    const _setWsRoot = _fsBridgeAny['setWorkspaceRoot'] as (p: string | null) => unknown;
    const _regWsRoot = (fsPath: string | undefined) => void _setWsRoot(fsPath ?? null);
    _regWsRoot(workspaceService?.folders[0]?.uri.fsPath);
    if (workspaceService) {
      context.subscriptions.push(
        workspaceService.onDidChangeWorkspace(
          (ws) => _regWsRoot(ws?.folders[0]?.uri.fsPath),
        ),
      );
    }
  }

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
  // M60 §3.8 + §3.10: install controls layer on the workbench-owned router.
  // Setters (not constructor args) so the workbench bootstrap stays
  // unchanged — the chat extension owns the autonomy services.
  if (surfaceRouter) {
    surfaceRouter.setFeatureFlags(autonomyFlags);
    surfaceRouter.setEventLog(autonomyEventLog);
  }
  let retrievalService = api.services.has(IRetrievalService)
    ? api.services.get<import('../../services/serviceTypes.js').IRetrievalService>(IRetrievalService)
    : undefined;
  let indexingPipelineService = api.services.has(IIndexingPipelineService)
    ? api.services.get<import('../../services/serviceTypes.js').IIndexingPipelineService>(IIndexingPipelineService)
    : undefined;
  // M60 Phase θ B5 — wire flag accessor so the pipeline can consult
  // `indexing.lazyMtime.enabled` for page mtime fast-skip. The pipeline is
  // constructed by the workbench before the chat extension activates, so
  // this is the first reachable seam.
  if (indexingPipelineService && typeof indexingPipelineService.setFlagAccessor === 'function') {
    indexingPipelineService.setFlagAccessor((id) => autonomyFlags.isEnabled(id as Parameters<typeof autonomyFlags.isEnabled>[0]));
  }
  const vectorStoreService = api.services.has(IVectorStoreService)
    ? api.services.get<import('../../services/serviceTypes.js').IVectorStoreService>(IVectorStoreService)
    : undefined;
  let memoryService = api.services.has(IMemoryService)
    ? api.services.get<import('../../services/serviceTypes.js').IMemoryService>(IMemoryService)
    : undefined;

  // Deleting a chat session must also delete the AI's memory derived from it
  // (the conversation summary + its vector embedding) — otherwise the AI keeps
  // recalling a chat you deleted. Wire the cleanup into ChatService.deleteSession.
  if (memoryService) {
    const _memoryForCleanup = memoryService;
    chatService.setMemoryCleanup((id) => _memoryForCleanup.deleteMemory(id));
  }

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
  // Workspace default model + context size live in the unified AI config
  // (workspace-scoped, surfaced in Settings → Model). Legacy chat.* keys are
  // a fallback so existing config.json files still work.
  const unifiedModelDefault = unifiedConfigService?.getEffectiveConfig().model.chatModel ?? '';
  const unifiedContextLength = unifiedConfigService?.getEffectiveConfig().model.contextWindow ?? 0;
  // Retirement: the chatConfig fallback read a key deliberately never
  // registered (builtinManifests excludes chat.defaultModel as superseded),
  // so it could only ever return '' — a constant in config costume.
  const defaultModel = unifiedModelDefault || '';
  const defaultMode = chatConfig.get<string>('defaultMode', 'agent') as import('../../services/chatTypes.js').ChatMode;
  const configuredContextLength = unifiedContextLength || 0;

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

  // ── 2b. Provider registration — each provider is enabled PER WORKSPACE ──
  //
  // Both Ollama (local) and Claude (cloud) register with ILanguageModelsService
  // only when enabled for THIS workspace, so the model picker shows exactly the
  // providers the user turned on (AI Settings → Model → Providers). OllamaProvider
  // is always CONSTRUCTED (ChatDataService depends on it) but its registration is
  // gated. Flipping a toggle registers/unregisters live. The Claude API key lives
  // only in the main process — the renderer never holds it.
  {
    const settingsReg = api.services.has(ISettingsRegistryService)
      ? api.services.get<ISettingsRegistryService>(ISettingsRegistryService)
      : getGlobalSettingsRegistry();
    const anthropicBridge = getAnthropicBridge();
    const ollama = _ollamaProvider;
    let ollamaReg: { dispose(): void } | undefined;
    let anthropicProvider: AnthropicProvider | undefined;
    let anthropicReg: { dispose(): void } | undefined;

    const isEnabled = (key: string, fallback: boolean): boolean => {
      try { const v = settingsReg?.getValue<boolean>(key); return v === undefined ? fallback : v === true; }
      catch { return fallback; }
    };

    const syncProviders = (): void => {
      const ollamaOn = isEnabled('ai.providers.ollama.enabled', true);
      if (ollamaOn && ollama && !ollamaReg) { ollamaReg = languageModelsService.registerProvider(ollama); }
      else if (!ollamaOn && ollamaReg) { ollamaReg.dispose(); ollamaReg = undefined; }

      const anthropicOn = isEnabled('ai.providers.anthropic.enabled', false);
      if (anthropicOn && anthropicBridge && !anthropicReg) {
        anthropicProvider = new AnthropicProvider(anthropicBridge);
        anthropicReg = languageModelsService.registerProvider(anthropicProvider);
      } else if ((!anthropicOn || !anthropicBridge) && anthropicReg) {
        anthropicReg.dispose(); anthropicReg = undefined;
        anthropicProvider?.dispose(); anthropicProvider = undefined;
      }
    };

    syncProviders();
    if (settingsReg) {
      context.subscriptions.push(settingsReg.onDidChange((c) => {
        if (c.key === 'ai.providers.ollama.enabled' || c.key === 'ai.providers.anthropic.enabled') syncProviders();
      }));
    }
    context.subscriptions.push({
      dispose: () => { ollamaReg?.dispose(); anthropicReg?.dispose(); anthropicProvider?.dispose(); },
    });
  }

  // Set configured default model (after provider registered, so models are discoverable).
  // Use setDefaultModel so the workspace default wins over the persisted
  // "last used" id — that's the whole point of having a default.
  if (defaultModel) {
    languageModelsService.setDefaultModel(defaultModel);
  }

  // Subscribe to unified-config changes so editing model.defaultModel or
  // model.contextSize in Settings updates the running session live, without
  // a workspace reload.
  if (unifiedConfigService) {
    context.subscriptions.push(
      unifiedConfigService.onDidChangeConfig(() => {
        const cfg = unifiedConfigService.getEffectiveConfig();
        const nextDefault = cfg.model.chatModel || '';
        if (nextDefault) {
          languageModelsService.setDefaultModel(nextDefault);
        }
        if (_ollamaProvider) {
          _ollamaProvider.setContextLengthOverride(cfg.model.contextWindow || 0);
        }
      }),
    );
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
    // Retirement: chat.agent.maxIterations is deliberately unregistered
    // (superseded by the permission model) — the old fallback could only
    // ever return its literal 25.
    maxIterations: unifiedConfigService?.getEffectiveConfig().agent.maxIterations ?? 25,
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
    notifyWarning: (message: string) => { void api.window.showWarningMessage(message); },
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
    sessionId?: string,
  ) => {
    const platformTools = dataService.getToolDefinitions();
    if (platformTools.some((tool) => tool.name === name)) {
      return dataService.invokeToolWithRuntimeControl(name, args, token, observer, sessionId);
    }

    const skill = getRuntimeSkillCatalog().find((entry) => entry.kind === 'tool' && entry.name === name);
    if (!skill) {
      return dataService.invokeToolWithRuntimeControl(name, args, token, observer, sessionId);
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
        ? await _permissionService.confirmToolInvocation(name, skill.description, args, skill.permissionLevel, sessionId)
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

  // M85 Slice B — per-session boundary-compaction cache (see the
  // readCompactionCache wiring below). Entries are dropped with their session.
  const _compactionCache = new Map<string, import('../../openclaw/openclawTypes.js').IOpenclawCompactionCacheEntry>();
  context.subscriptions.push(chatService.onDidDeleteSession((sid) => {
    _compactionCache.delete(sid);
    // M85 Slice C — drop the session's read-before-edit registry with it.
    clearResourceRegistry(sid);
  }));

  const openclawDefaultParticipantServices = buildOpenclawDefaultParticipantServices({
    sendChatRequest: (m, o, s) => dataService.sendChatRequest(m, o, s),
    getActiveModel: () => dataService.getActiveModel(),
    getWorkspaceName: () => dataService.getWorkspaceName(),
    getPageCount: () => dataService.getPageCount(),
    getCurrentPageTitle: () => dataService.getCurrentPageTitle(),
    getToolDefinitions: () => dataService.getToolDefinitions(),
    getReadOnlyToolDefinitions: () => dataService.getReadOnlyToolDefinitions(),
    filterToolsForSession: _permissionService
      ? (tools, sid) => _permissionService!.filterToolsForSession(tools, sid)
      : undefined,
    invokeToolWithRuntimeControl: (n, a, t, o, s) => invokeRuntimeToolWithSkillSupport(n, a, t, o, s),
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
    // M85 Slice B — session-keyed boundary-compaction cache. Lives here (the
    // long-lived services layer) because the context engine is per-turn; an
    // app restart costs at most one re-summarization per session.
    readCompactionCache: (sid: string) => _compactionCache.get(sid),
    writeCompactionCache: (sid: string, entry: import('../../openclaw/openclawTypes.js').IOpenclawCompactionCacheEntry | undefined) => {
      if (entry) { _compactionCache.set(sid, entry); } else { _compactionCache.delete(sid); }
    },
    isSessionEligibleForSummary: memoryService ? (m) => dataService.isSessionEligibleForSummary(m) : undefined,
    hasSessionMemory: memoryService ? (s) => dataService.hasSessionMemory(s) : undefined,
    getSessionMemoryMessageCount: memoryService ? (s) => dataService.getSessionMemoryMessageCount(s) : undefined,
    getPreferencesForPrompt: (memoryService || workspaceMemoryService) ? () => dataService.getPreferencesForPrompt() : undefined,
    // M85 — the session's durable plan, formatted for the "## Active Plan"
    // context section. Read fresh per assembly so mid-turn plan_update calls
    // are reflected after compaction re-assembly.
    //
    // M86 — staleness nudge: telling models to "update as you work" in the
    // system prompt is not enough (small local models reliably forget
    // bookkeeping calls). When the plan hasn't been touched for several
    // messages, append an imperative nudge to the section the model reads
    // EVERY turn — update it or clear it, right now.
    getSessionPlanText: (sid: string) => {
      const plan = chatService.getSessionPlan?.(sid);
      if (!plan) return undefined;
      let text = formatSessionPlan(plan);
      if (typeof plan.atMessageCount === 'number') {
        const now = chatService.getSession(sid)?.messages.length ?? plan.atMessageCount;
        const drift = now - plan.atMessageCount;
        if (drift >= 3) {
          text += `\n\nWarning: This plan has not been updated for ${drift} messages. Before anything else: `
            + 'if the work is finished, call plan_update with {"clear": true}; '
            + 'otherwise update the step statuses and `note` to match reality NOW.';
        }
      }
      return text;
    },
    // MIND continuity for interactive turns — beliefs the agent accumulated
    // (heartbeat reviews, mind_remember calls) finally reach conversation.
    // Origin-tagged (autonomous-rail) sessions return undefined: the heartbeat
    // rail injects beliefs via its own seed (double-injecting there would echo),
    // while cron/subagent/dashboard turns INTENTIONALLY run without continuity
    // — they are scoped task runs, not the conversational agent.
    getMindContinuity: (sid: string) => {
      if (!_mindServiceRef) return undefined;
      if (chatService.getSession(sid)?.origin) return undefined;
      const block = _mindServiceRef.continuityBlock();
      return block || undefined;
    },
    // M66 — Snapshot every registered `parallx://` link contract for the
    // system prompt builder. Flattened to the descriptor shape that the
    // openclaw layer expects, so adding a new extension contract surfaces
    // its templates to the AI with zero core changes.
    getLinkContractDescriptors: () => api.links.allContracts().map(c => ({
      segment: c.segment,
      displayName: c.displayName,
      extensionId: c.extensionId,
      kinds: Object.entries(c.kinds).map(([kind, h]) => ({
        kind,
        uriTemplate: h.uriTemplate,
        description: h.description,
        examples: h.examples,
      })),
    })),
    getPromptOverlay: _promptFileService ? (a) => dataService.getPromptOverlay(a) : undefined,
    listFilesRelative: fsAccessor ? (r) => dataService.listFilesRelative(r) : undefined,
    readFileRelative: fsAccessor ? (r) => dataService.readFileRelative(r) : undefined,
    writeFileRelative: (fileService && workspaceService?.folders?.length) ? (r, c) => dataService.writeFileRelative(r, c) : undefined,
    existsRelative: fsAccessor ? (r) => dataService.existsRelative(r) : undefined,
    invalidatePromptFiles: _promptFileService ? () => dataService.invalidatePromptFiles() : undefined,
    // M81 Phase 8 — workspace memory accessor for `/init`. Bound only when
    // a WorkspaceMemoryService is registered; the openclaw layer treats
    // `undefined` as "no Phase 8 work to do" and falls through to the
    // existing AGENTS.md generation.
    workspaceMemory: workspaceMemoryService
      ? {
          archiveLegacyConceptSection: () => workspaceMemoryService.archiveLegacyConceptSection(),
          listLessons: () => workspaceMemoryService.listLessons(),
          writeLessonFile: (slug: string, content: string) => workspaceMemoryService.writeLessonFile(slug, content),
          addMemoryIndexEntry: (slug: string, description: string) => workspaceMemoryService.addMemoryIndexEntry(slug, description),
        }
      : undefined,
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
    // M76 Phase 7 — surface mind-map diagnostics through /context.
    getMindMapDiagnostics: async () => {
      const sg = api.services.has(ISemanticGraphService)
        ? api.services.get<import('../../services/serviceTypes.js').ISemanticGraphService>(ISemanticGraphService)
        : null;
      if (!sg) return undefined;
      const stats = await sg.getMindMapDiagnostics();
      const orch = api.services.has(IMindMapRefreshOrchestrator)
        ? api.services.get<import('../../services/serviceTypes.js').IMindMapRefreshOrchestrator>(IMindMapRefreshOrchestrator)
        : null;
      let lastRefreshAt: string | null = null;
      let lastRefreshStatus: string | null = null;
      if (orch) {
        const hist = await orch.getRefreshHistory(1);
        if (hist.length > 0) {
          lastRefreshAt = hist[0].startedAt;
          lastRefreshStatus = hist[0].status;
        }
      }
      return { ...stats, lastRefreshAt, lastRefreshStatus };
    },
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
    // The participant delegate is the AGENT acting — stamp origin 'ai', not
    // the extension bridge's ext:chat (which reads as a user gesture).
    executeCommand: (commandId: string, ...args: unknown[]) => {
      const cmd = api.services.has(ICommandService) ? api.services.get<import('../../services/serviceTypes.js').ICommandService>(ICommandService) : undefined;
      if (cmd) { void cmd.executeCommandFrom('ai', commandId, ...args); }
      else { void api.commands.executeCommand(commandId, ...args); }
    },
    // W1 (M58): Bridge followup runner to chat service queue.
    // Upstream: scheduleFollowupDrain + enqueueFollowupRun.
    queueFollowupRequest: (sessionId: string, message: string) => {
      chatService.queueRequest(sessionId, message, ChatRequestQueueKind.Queued);
    },
    // M60 §3.8: gate followup evaluation on autonomy.followup.enabled.
    // M60 §8 Phase ζ: also honor the global pause kill-switch — when
    // `autonomy.paused.global` is on, every trigger reports disabled
    // regardless of its per-trigger flag.
    isAutonomyFlagEnabled: (flagId: string) => {
      // Only known flags are honored; unknown ids default to true so a
      // misconfiguration does not silently disable autonomy.
      try {
        return isAutonomyTriggerAllowed(
          autonomyFlags,
          flagId as Parameters<typeof autonomyFlags.isEnabled>[0],
        );
      } catch {
        return true;
      }
    },
    // M60 §3.10: emit a structured autonomy event record.
    emitAutonomyEvent: autonomyEventLog
      ? (input) => { autonomyEventLog!.emit(input); }
      : undefined,
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
    filterToolsForSession: _permissionService
      ? (tools, sid) => _permissionService!.filterToolsForSession(tools, sid)
      : undefined,
    invokeToolWithRuntimeControl: (n, a, t, o, s) => invokeRuntimeToolWithSkillSupport(n, a, t, o, s),
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
    filterToolsForSession: _permissionService
      ? (tools, sid) => _permissionService!.filterToolsForSession(tools, sid)
      : undefined,
    invokeToolWithRuntimeControl: (n, a, t, o, s) => invokeRuntimeToolWithSkillSupport(n, a, t, o, s),
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
    // ── Wire permission service (M11 Task 2.1) ──
    _permissionService = new PermissionService();
    context.subscriptions.push(_permissionService);

    // Wire heartbeat-aware approval queue: heartbeat-originated tool calls
    // that would otherwise stall on a UI dialog get logged to the autonomy
    // log instead. See PermissionService.confirmToolInvocation.
    _permissionService.setAutonomyLogAppender({
      append: (input) => autonomyLog.append(input),
    });

    // Inline DOM-based confirmation handler — creates a floating card in the
    // chat panel and returns a Promise that resolves when the user clicks.
    _permissionService.setConfirmationHandler(
      (toolName: string, toolDescription: string, args: Record<string, unknown>, forcedReason?: string): Promise<ToolGrantDecision> => {
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

          // Forced-approval explanation (color gate etc.) — without it,
          // repeat prompts read as "Always allow is broken".
          if (forcedReason) {
            const reason = document.createElement('div');
            reason.className = 'parallx-chat-confirmation-reason';
            reason.textContent = forcedReason;
            card.appendChild(reason);
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
    const _lmts = languageModelToolsService as import('../../services/languageModelToolsService.js').LanguageModelToolsService;
    _lmts.setPermissionService(_permissionService);

    // M67 Phase 2 — wire Policy Decision Point
    {
      const pdp = new _PolicyDecisionPoint();
      pdp.setPermissionService(_permissionService);
      _lmts.setPolicyDecisionPoint(pdp);
    }

    // Build retrieval accessor for the fs_search_knowledge tool (M10 Phase 3)
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

    // M81 Phase 2 — workspace memory write accessor for the `memory_write` tool.
    // Thin wrapper around IWorkspaceMemoryService that exposes only the methods
    // the tool needs (USER.md / MEMORY.md / daily file read+write). Lets the
    // tool stay decoupled from the full service interface.
    const workspaceMemoryAccessor = workspaceMemoryService
      ? {
          getUserFileRelativePath: () => workspaceMemoryService.getUserFileRelativePath(),
          getDurableMemoryRelativePath: () => workspaceMemoryService.getDurableMemoryRelativePath(),
          getDailyMemoryRelativePath: (date?: Date) => workspaceMemoryService.getDailyMemoryRelativePath(date),
          readUserFile: () => workspaceMemoryService.readUserFile(),
          writeUserFile: (content: string) => workspaceMemoryService.writeUserFile(content),
          readDurableMemory: () => workspaceMemoryService.readDurableMemory(),
          writeDurableMemory: (content: string) => workspaceMemoryService.writeDurableMemory(content),
          readDailyMemory: (date?: Date) => workspaceMemoryService.readDailyMemory(date),
          appendDailyMemory: (text: string, date?: Date) => workspaceMemoryService.appendDailyMemory(text, date),
          writeDailyMemory: (body: string, date?: Date) => workspaceMemoryService.writeDailyMemory(body, date),
          ensureDailyMemory: (date?: Date) => workspaceMemoryService.ensureDailyMemory(date),
          // M81 Phase 8 — lesson files.
          getLessonFileRelativePath: (slug: string) => workspaceMemoryService.getLessonFileRelativePath(slug),
          readLessonFile: (slug: string) => workspaceMemoryService.readLessonFile(slug),
          writeLessonFile: (slug: string, content: string) => workspaceMemoryService.writeLessonFile(slug, content),
          archiveLessonFile: (slug: string) => workspaceMemoryService.archiveLessonFile(slug),
          parseMemoryIndex: () => workspaceMemoryService.parseMemoryIndex(),
          addMemoryIndexEntry: (slug: string, description: string) => workspaceMemoryService.addMemoryIndexEntry(slug, description),
          removeMemoryIndexEntry: (slug: string) => workspaceMemoryService.removeMemoryIndexEntry(slug),
        }
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

    // Build file writer accessor for fs_write_file / fs_edit_file tools (M11 Task 2.2 + 2.3)
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

    // The open-document registry, so a write can go through an open editor
    // rather than around it. See the note in writeFile below.
    const _textModels = api.services.has(ITextFileModelManager)
      ? api.services.get<import('../../services/serviceTypes.js').ITextFileModelManager>(ITextFileModelManager)
      : undefined;

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

            // One writer per file: through the open document when there is one,
            // to disk otherwise. See openDocumentWriter.ts for why.
            await writeThroughOpenDocument(_textModels, fileService!, targetUri, content, async () => {
              const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
              if (parentPath) {
                const parentUri = rootUri.joinPath(parentPath);
                try { await fileService!.mkdir(parentUri); } catch { /* may already exist */ }
              }
            });
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

    // M11 Task 4.3 — Terminal accessor for terminal_run_command tool
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
      // Phase D step 5b: the scheduler is CORE's — constructed, observed,
      // persisted, and hydrated in autonomyBootstrap before any tool
      // activated. Chat attaches the half only it can supply — the
      // executor that runs real isolated LLM turns via the W5
      // ephemeral-session substrate — and then starts the timer, so
      // missed-job catchup (M60 §3.7) still runs against the restored set.
      cronService = api.services.has(ICronService)
        ? api.services.get<CronService>(ICronService)
        : undefined;
      if (cronService) {
        const chatServiceForCron = chatService as unknown as import('../../services/chatService.js').ChatService;
        const cronExecutor = createCronTurnExecutor(surfaceRouter, {
          chatService: {
            createEphemeralSession: (parentId, seed) =>
              chatServiceForCron.createEphemeralSession(parentId, seed),
            purgeEphemeralSession: (handle) =>
              chatServiceForCron.purgeEphemeralSession(handle),
            sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
            getSession: (sid) => chatService.getSession(sid),
          },
          getParentSessionId: () => _activeWidget?.getSession()?.id,
        });
        const cronContextFetcher = createCronContextLineFetcher({
          getActiveSession: () => {
            const id = _activeWidget?.getSession()?.id;
            return id ? chatService.getSession(id) : undefined;
          },
        });
        cronService.attachExecution(cronExecutor, cronContextFetcher, cronHeartbeatWaker);
        cronService.start();
      }
    }

    // ── SubagentSpawner (M58 W5) ──
    //
    // The keystone domain: W5 builds the ephemeral-session substrate AND
    // the first real isolated-turn consumer of it. Unlike W2/W4 (which
    // ship thin per §6.5), W5 runs a live LLM turn on an ephemeral
    // session so the parent's `messages[]`, the `chat_sessions` table,
    // and the session-list UI stay untouched.
    //
    // Safety: `sessions_spawn` is always approval-gated
    // (`subagentToolPermissionLevel` returns `requires-approval`
    // uniformly) — no exemptions. Depth is hard-capped at 1 for M58 via
    // the `currentSubagentDepth()` guard inside the tool handler AND the
    // SubagentSpawner's own `callerDepth >= maxDepth` gate.
    let subagentSpawner: SubagentSpawner | undefined;
    if (surfaceRouter) {
      const getParentSessionId = () => _activeWidget?.getSession()?.id;
      // Narrow adapter over the concrete ChatService class — the
      // ephemeral-session substrate (createEphemeralSession /
      // purgeEphemeralSession) lives on the class, not the public
      // IChatService interface, so the subagent executor can remain
      // decoupled from the full service surface.
      const chatServiceForSubagent = chatService as unknown as import('../../services/chatService.js').ChatService;
      const subagentExecutor = createSubagentTurnExecutor({
        chatService: {
          createEphemeralSession: (parentId, seed) =>
            chatServiceForSubagent.createEphemeralSession(parentId, seed),
          purgeEphemeralSession: (handle) =>
            chatServiceForSubagent.purgeEphemeralSession(handle),
          sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
          getSession: (sid) => chatService.getSession(sid),
        },
        getParentSessionId,
        permissionService: _permissionService
          ? {
              markSubagentSession: (sid, level) => _permissionService!.markSubagentSession(sid, level),
              unmarkSubagentSession: (sid) => _permissionService!.unmarkSubagentSession(sid),
            }
          : undefined,
        // Subagents inherit the heartbeat autonomy dial — same
        // "non-interactive ephemeral run" semantics, same default policy.
        getAutonomyLevel: () => unifiedConfigService?.getEffectiveConfig().heartbeat.autonomy,
      });
      const subagentAnnouncer = createSubagentAnnouncer({
        surfaceRouter,
        getParentSessionId,
      });
      subagentSpawner = new SubagentSpawner(
        subagentExecutor,
        subagentAnnouncer,
        /* maxDepth */ 1,
      );
      // ── M60 Phase γ §3.8/§3.10 — subagent controls layer ──
      // Hard cap depth=1 already enforced by maxDepth above (no nested
      // spawns in M60). Flag gate refuses spawn when off; emit captures
      // gated/budget/error/completed outcomes with parent-session ref.
      subagentSpawner.setObservers({
        isFlagEnabled: () => isAutonomyTriggerAllowed(autonomyFlags, FLAG_SUBAGENT_ENABLED),
        onAutonomyEvent: autonomyEventLog
          ? (info) => {
              autonomyEventLog!.emit({
                trigger: { kind: 'subagent', ref: getParentSessionId() },
                outcome: info.outcome,
                durationMs: info.durationMs,
                budgetSnapshot: { depth: info.depth },
                note: info.runId
                  ? `${info.note ?? `runId=${info.runId}`}`
                  : info.note,
              });
            }
          : undefined,
        // M60 §8 Phase ζ T5.E3 — pattern memory hooks. Only consulted when
        // the pattern memory feature flag is on. Pattern key is reduced to
        // (toolName='subagent.spawn', sessionPattern=parentSessionId,
        // argsShape=sorted-keys-of-{task,label,model}). Raw values are
        // never stored — see autonomyPatternMemoryService.
        isPatternApproved: autonomyPatternMemory
          ? (params) => {
              if (!autonomyFlags.isEnabled(FLAG_PATTERN_MEMORY_ENABLED)) return false;
              return autonomyPatternMemory!.isApproved({
                toolName: 'subagent.spawn',
                parentSessionPattern: getParentSessionId() ?? '',
                argsShape: computeArgsShape({
                  task: params.task,
                  label: params.label,
                  model: params.model,
                }),
              });
            }
          : undefined,
        notePatternMatch: autonomyPatternMemory
          ? (params) => {
              if (!autonomyFlags.isEnabled(FLAG_PATTERN_MEMORY_ENABLED)) return;
              autonomyPatternMemory!.noteMatch({
                toolName: 'subagent.spawn',
                parentSessionPattern: getParentSessionId() ?? '',
                argsShape: computeArgsShape({
                  task: params.task,
                  label: params.label,
                  model: params.model,
                }),
              });
            }
          : undefined,
      });
      context.subscriptions.push(subagentSpawner);
    }

    // M84: canvas page/block tools are registered by the canvas tool itself
    // (src/built-in/canvas/ai/), so the DB / current-page / page-mutation
    // wiring no longer threads through here. This registers the workspace-level
    // tools (files, memory, transcripts, write, terminal, RAG, surface, cron,
    // subagent, autonomy).
    const toolDisposables = registerBuiltInTools(languageModelToolsService, fsAccessor, retrievalAccessor, canonicalMemorySearchAccessor, transcriptSearchAccessor, writerAccessor, terminalAccessor, workspaceService?.folders?.[0]?.uri?.fsPath, surfaceRouter, cronService, subagentSpawner, autonomyLog, workspaceMemoryAccessor, _activityJournal);
    for (const d of toolDisposables) {
      context.subscriptions.push(d);
    }

    // ── Notebook tools. Same `python.enabled` gate as the python_* tools: a
    // notebook is Python execution wearing a different hat, running against the
    // same workspace environment, so one consent decision covers both.
    //
    // These drive the SAME INotebookKernelService the notebook editor drives —
    // one kernel per workspace — so a cell the assistant runs shares variables
    // and imports with a cell the user runs. Shelling out to
    // `jupyter nbconvert --execute` would start a second, unrelated kernel and
    // leave the open notebook's state untouched, which is why a generic
    // terminal command is not a substitute for this.
    //
    // Registered here rather than beside the python_* block because that block
    // sits outside the scope holding `writerAccessor`.
    if (api.services.has(IPythonEnvService) && api.services.has(INotebookKernelService)) {
      const _pySvcForNb = api.services.get<IPythonEnvService>(IPythonEnvService);
      const _kernelSvc = api.services.get<INotebookKernelService>(INotebookKernelService);
      const _lmToolsNb = languageModelToolsService;

      // Turn a workspace-relative path into the OPEN notebook holding that
      // document, so the tools write through the pane instead of around it —
      // the same single-writer rule the text path uses via ITextFileModelManager.
      const _resolveOpenNotebook = (relativePath: string) => {
        const folders = workspaceService?.folders;
        if (!folders || folders.length === 0) return undefined;
        const uri = folders[0].uri.joinPath(normalizeWorkspaceRelativePath(relativePath));
        return findOpenNotebook(uri);
      };

      void import('./tools/notebookTools.js').then((toolMod) => {
        // Reading and editing a .ipynb is a FILE operation — always available,
        // like fs_read_file on the same path. Only execution is gated, because
        // `python.enabled` is consent to run Python, not consent to open a JSON
        // document. Gating the file tools too removed capability the assistant
        // already had through fs_* and bought nothing.
        for (const tool of toolMod.createNotebookFileTools(fsAccessor, writerAccessor, _resolveOpenNotebook)) {
          context.subscriptions.push(_lmToolsNb.registerTool(tool));
        }

        let _nbRegs: IDisposable[] = [];
        const _disposeNbRegs = () => {
          for (const d of _nbRegs) d.dispose();
          _nbRegs = [];
        };
        const _syncNb = () => {
          const want = _pySvcForNb.isEnabled;
          const have = _nbRegs.length > 0;
          if (want === have) return;
          if (want) {
            for (const tool of toolMod.createNotebookRunTools(_kernelSvc, fsAccessor, writerAccessor, _resolveOpenNotebook)) {
              _nbRegs.push(_lmToolsNb.registerTool(tool));
            }
          } else {
            _disposeNbRegs();
          }
        };
        _syncNb();
        const _nbStatusSub = _pySvcForNb.onDidChangeStatus(_syncNb);
        context.subscriptions.push({ dispose: () => { _nbStatusSub.dispose(); _disposeNbRegs(); } });
      }).catch(() => { /* tool module load failed — chat continues without it */ });
    }

    // M85 — `plan_update`: the agent's durable working plan (the planning
    // organ). Registered separately so it closes over the ChatService's
    // session-plan accessors without threading them through the big
    // registerBuiltInTools(...) signature.
    context.subscriptions.push(languageModelToolsService.registerTool(createPlanUpdateTool({
      readPlan: (sid) => chatService.getSessionPlan?.(sid),
      // Stamp the session's message count at write time (M86): the context
      // engine compares it to the live count to detect a drifting plan and
      // nudge the model to update or clear it.
      writePlan: (sid, plan) => chatService.setSessionPlan?.(
        sid,
        plan ? { ...plan, atMessageCount: chatService.getSession(sid)?.messages.length ?? 0 } : undefined,
      ),
    })));

    // M87 S2 — `heartbeat_watch`: standing watches in .parallx/HEARTBEAT.md.
    // "Watch this for me" becomes a durable gesture the heartbeat reads on
    // every review. Registered separately (closes over the dataService's
    // workspace-relative file access).
    context.subscriptions.push(languageModelToolsService.registerTool(createHeartbeatWatchTool({
      readFile: (p) => dataService.readFileRelative(p),
      writeFile: (p, c) => dataService.writeFileRelative(p, c),
    })));

    // Phase C (SYSTEM_INTEGRITY.md) — `app__describe`: the system diagnosing
    // itself. Read-only, always allowed, modeled on activity_log. The
    // introspection service resolves LAZILY at call time — it registers
    // during workbench init, which may still be running when chat activates.
    void import('./tools/appDescribeTool.js').then((mod) => {
      const getIntrospection = () => {
        const id = IIntrospectionService;
        return api.services.has(id)
          ? api.services.get<import('../../services/introspectionService.js').IIntrospectionService>(id)
          : undefined;
      };
      context.subscriptions.push(languageModelToolsService.registerTool(mod.createAppDescribeTool(getIntrospection)));
    }).catch(() => { /* tool module load failed — chat continues without it */ });

    // M66 §4a — `link_create` chat tool. Registered separately so it can
    // close over the `api.links` snapshot without threading it through the
    // big `registerBuiltInTools(...)` signature. The tool's prompt
    // visibility is gated by the `## Linking` section in the system prompt,
    // which only renders when at least one contract is registered.
    void import('./tools/parallxLinkTool.js').then((mod) => {
      const parallxLinkTool = mod.createParallxLinkTool(() => api.links.allContracts().map(c => ({
        segment: c.segment,
        displayName: c.displayName,
        kinds: Object.entries(c.kinds).map(([kind, h]) => ({ kind, uriTemplate: h.uriTemplate })),
      })));
      context.subscriptions.push(languageModelToolsService.registerTool(parallxLinkTool));
    }).catch(() => { /* tool module load failed — chat continues without it */ });

    // M70 — App Command Control tools. Gated on `tools.workbenchControl`.
    // The two tool schemas are registered when the toggle is ON and
    // disposed when it goes OFF, so the chat context has zero footprint
    // whenever the user is not opted in. The subscription is live: flipping
    // the setting in the AI Hub immediately attaches or detaches the tools
    // without requiring a chat reload.
    void Promise.all([
      import('../../services/serviceTypes.js'),
      import('./tools/appCommandTools.js'),
    ]).then(([svcMod, toolMod]) => {
      const _cmdSvc = api.services.has(svcMod.ICommandService)
        ? api.services.get<import('../../services/serviceTypes.js').ICommandService>(svcMod.ICommandService)
        : undefined;
      const _aiCfg = api.services.has(IUnifiedAIConfigService)
        ? api.services.get<import('../../aiSettings/unifiedConfigTypes.js').IUnifiedAIConfigService>(IUnifiedAIConfigService)
        : undefined;
      if (!_cmdSvc || !_aiCfg) return;

      let _registrations: IDisposable[] = [];
      const _disposeRegs = () => {
        for (const d of _registrations) d.dispose();
        _registrations = [];
      };
      const _sync = () => {
        const want = _aiCfg.getEffectiveConfig().tools?.workbenchControlEnabled === true;
        const have = _registrations.length > 0;
        if (want === have) return;
        if (want) {
          _registrations.push(languageModelToolsService.registerTool(toolMod.createAppFindCommandsTool(_cmdSvc)));
          _registrations.push(languageModelToolsService.registerTool(toolMod.createAppRunCommandTool(_cmdSvc)));
        } else {
          _disposeRegs();
        }
      };
      _sync();
      const _configSub = _aiCfg.onDidChangeConfig(_sync);
      context.subscriptions.push({ dispose: () => { _configSub.dispose(); _disposeRegs(); } });
    }).catch(() => { /* tool module load failed — chat continues without it */ });
  }

  // ── M94 — Python tools. Gated on the workspace's `python.enabled` consent.
  // Same attach/detach shape as App Command Control above: a workspace that
  // has not opted in never sees these schemas, so the assistant cannot offer
  // to run Python where the user has not allowed it. Flipping the switch in
  // Settings attaches them live, without a chat reload.
  if (api.services.has(IPythonEnvService) && languageModelToolsService) {
    const _pythonSvc = api.services.get<IPythonEnvService>(IPythonEnvService);
    const _lmTools = languageModelToolsService;
    void import('./tools/pythonTools.js').then((toolMod) => {
      let _pyRegs: IDisposable[] = [];
      const _disposePyRegs = () => {
        for (const d of _pyRegs) d.dispose();
        _pyRegs = [];
      };
      const _syncPy = () => {
        const want = _pythonSvc.isEnabled;
        const have = _pyRegs.length > 0;
        if (want === have) return;
        if (want) {
          for (const tool of toolMod.createPythonTools(_pythonSvc)) {
            _pyRegs.push(_lmTools.registerTool(tool));
          }
        } else {
          _disposePyRegs();
        }
      };
      _syncPy();
      const _statusSub = _pythonSvc.onDidChangeStatus(_syncPy);
      context.subscriptions.push({ dispose: () => { _statusSub.dispose(); _disposePyRegs(); } });
    }).catch(() => { /* tool module load failed — chat continues without it */ });
  }


  // ── 3b. Register chat-owned surface plugins (M58 W6) ──
  // The surface router is created in the workbench Phase 5; the chat-owned
  // plugins (chat, filesystem, canvas) can only be built here because their
  // backing services live in chat activation scope.
  if (surfaceRouter) {
    // Chat surface — M58-real post-ship UX reshape: autonomous deliveries
    // (heartbeat / cron / subagent result cards) are routed into the
    // dedicated AutonomyLogService instead of the chat transcript, so
    // conversation stays uncluttered. The agent reads the log via the
    // `autonomy_log` built-in tool. See
    // src/built-in/chat/surfaces/chatSurface.ts and
    // src/services/autonomyLogService.ts.
    surfaceRouter.registerSurface(new ChatSurfacePlugin({
      autonomyLog,
      getActiveSessionId: () => _activeWidget?.getSession()?.id,
    }));
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
    // Human-readable autonomy-log note for a heartbeat tick. Describes the tick
    // itself; the model's actual findings (NOTE/ACT) surface as their own log
    // entries, so we never overclaim "all clear" here.
    const heartbeatTickNote = (reason: string, events: number): string => {
      const evs = events > 0 ? ` · ${events} event${events === 1 ? '' : 's'}` : '';
      return reason === 'interval' ? `periodic review${evs}` : `${reason}${evs}`;
    };
    const readHeartbeatConfig = (): IHeartbeatConfig => {
      const hb = unifiedConfigService.getEffectiveConfig().heartbeat;
      return {
        enabled: hb.enabled,
        intervalMs: hb.intervalMs,
        coalesceWindowMs: hb.coalesceWindowMs,
        // Chat-turn back-pressure: if the user has an in-flight chat turn,
        // defer the heartbeat tick. Heartbeat ephemeral sessions and the
        // user's chat session don't share a per-session lock (different
        // session IDs), but they would race at the model HTTP layer (Ollama
        // serializes per loaded model) and at tools / approval handler.
        // Skipping the tick avoids those races. System-event payloads stay
        // queued and fire on the next viable tick.
        shouldDeferTick: () => {
          const sid = _activeWidget?.getSession()?.id;
          if (!sid) return false;
          return chatService.getSession(sid)?.requestInProgress === true;
        },
        // Single global gate: the per-workspace `heartbeat.enabled` config
        // (above) is the on/off switch users actually toggle; the only global
        // override is the `paused.global` kill switch. Previously this ALSO
        // required the separate, default-OFF `autonomy.heartbeat.enabled` flag,
        // which silently blocked anyone who enabled heartbeat from AI settings
        // — the "I turned it on but nothing happens" trap. Closure picks up
        // live changes; no restart required.
        isFlagEnabled: () => !autonomyFlags.isEnabled(FLAG_PAUSED_GLOBAL),
        // M60 Phase γ §3.10 — emit a structured autonomy event per tick.
        onAutonomyEvent: autonomyEventLog
          ? (info) => {
              autonomyEventLog!.emit({
                trigger: { kind: 'heartbeat', ref: _activeWidget?.getSession()?.id },
                outcome: info.outcome,
                durationMs: info.durationMs,
                note: info.note ?? heartbeatTickNote(info.reason, info.eventsProcessed),
              });
            }
          : undefined,
      };
    };

    // MIND — the continuity keystone (Build-1d.3). A workspace-scoped persistent
    // inner model + tamper-evident audit ledger, composed into the loop seam and
    // handed to the executor. Optional: if workspace storage is unavailable the
    // heartbeat runs stateless exactly as before. init() loads any prior MIND in
    // the background — the first tick before it resolves simply sees an empty MIND.
    let mindService: MindService | undefined;
    {
      const _mindStorage = api.services.has(IWorkspaceStorageService)
        ? api.services.get<import('../../platform/storage.js').IStorage>(IWorkspaceStorageService)
        : undefined;
      if (_mindStorage) {
        mindService = new MindService(new MindStore(_mindStorage), new ActionLedger(_mindStorage), { capabilityStorage: _mindStorage });
        mindService.init().catch(() => { /* first-tick seed is simply empty */ });
      }
      _mindServiceRef = mindService;
    }

    // Build-5: give the model a tool to deliberately curate its own MIND during
    // reviews (governed + audited, so always-allowed). Without storage there is
    // no MIND to write to, so the tool is only registered when one exists.
    if (mindService && languageModelToolsService) {
      context.subscriptions.push(languageModelToolsService.registerTool(createMindRememberTool(mindService)));
    }

    // Active-inference loop (Build-2): predicts the next file the user will touch
    // and grades itself against reality (Brier), remembering surprises as
    // continuity. Fed from the live file-change stream (below). No model call —
    // surprise is what later justifies a review, not the other way round.
    // Serialized so the loop's pending-prediction state stays consistent.
    const predictionLoop = mindService ? new PredictionLoop(mindService, new SequencePredictor()) : undefined;
    // Surprise → attention (Build-4): sustained divergence from the agent's model
    // accumulates pressure and, past a threshold (rate-limited by a cooldown),
    // asks the heartbeat to review — the impasse that justifies the model.
    const surpriseAttention = new SurpriseAccumulator();
    let _predictChain: Promise<unknown> = Promise.resolve();
    const observeForPrediction = (path: string): void => {
      if (!predictionLoop) return;
      // Never let Parallx's own internal files (.parallx/** — skills, SOUL/USER/
      // AGENTS/TOOLS/MEMORY, daily logs) enter prediction history or the fluency
      // probe; they're the app's files, not the user's work.
      if (path.replace(/\\/g, '/').includes('/.parallx/')) return;
      _predictChain = _predictChain.then(async () => {
        // The human just did work — the conscience denominator, and (with the
        // file as the recurring "skill") the held-out fluency probe.
        void mindService?.recordHuman(Date.now(), path);
        const res = await predictionLoop.observe(path);
        if (res.surprised && typeof res.brier === 'number') {
          const t = Date.now();
          surpriseAttention.add(res.brier, t);
          if (surpriseAttention.shouldReview(t)) {
            const pressure = Number(surpriseAttention.pressure(t).toFixed(2));
            surpriseAttention.markReviewed(t);
            // Naturally gated by the kill switch + heartbeat.enabled in the runner,
            // and rate-limited by the accumulator cooldown. The review sees the
            // remembered surprises (MIND continuity) plus this trigger.
            heartbeatRunner.pushEvent({ type: 'prediction-surprise', payload: { path, pressure }, timestamp: t });
          }
        }
      }).catch(() => { /* best-effort; never break the bus */ });
    };

    // M87 S4 — the deterministic lane's last result, surfaced through
    // parallx.heartbeat.status so silence is legible on the status board.
    let _lastTriggerLane: { at: number; delivered: number; suppressed: number; failed: number } | null = null;

    const executor = createHeartbeatTurnExecutor(
      surfaceRouter,
      () => ({ reasons: unifiedConfigService.getEffectiveConfig().heartbeat.reasons }),
      // M58-real (W2-real): real-turn deps for system-event / wake / hook.
      // `interval` stays status-only inside the executor (token-burn guard);
      // `cron` is a no-op (delegated to cron executor).
      {
        chatService: {
          createEphemeralSession: (parentId, seed) =>
            (chatService as unknown as import('../../services/chatService.js').ChatService)
              .createEphemeralSession(parentId, seed),
          purgeEphemeralSession: (handle) =>
            (chatService as unknown as import('../../services/chatService.js').ChatService)
              .purgeEphemeralSession(handle),
          sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
          getSession: (sid) => chatService.getSession(sid),
        },
        getParentSessionId: () => {
          // Prefer the focused chat session. If the user is on canvas/dashboard
          // (no focused chat widget), fall back to the most recent real session
          // so the periodic review still runs and any finding lands in a real
          // transcript. The ephemeral parent is informational (model/mode have
          // fallbacks in createEphemeralSession), so this is safe. Only a
          // brand-new workspace with no chat at all yields undefined → the
          // review status-flashes and skips cleanly.
          const active = _activeWidget?.getSession()?.id;
          if (active) return active;
          const sessions = chatService.getSessions();
          return sessions.length > 0 ? sessions[sessions.length - 1].id : undefined;
        },
        outputDedupWindowMs: unifiedConfigService.getEffectiveConfig().heartbeat.outputDedupWindowMs,
        permissionService: _permissionService
          ? {
              markHeartbeatSession: (sid, level) => _permissionService!.markHeartbeatSession(sid, level),
              unmarkHeartbeatSession: (sid) => _permissionService!.unmarkHeartbeatSession(sid),
            }
          : undefined,
        getAutonomyLevel: () => unifiedConfigService.getEffectiveConfig().heartbeat.autonomy,
        // The user's ACTUAL canvas pages — real workspace awareness, so the review
        // knows their work and can give substantive help, not just report status.
        getWorkspacePages: async () => {
          const canvas = api.services.has(ICanvasPageQueryService)
            ? api.services.get<import('../../services/serviceTypes.js').ICanvasPageQueryService>(ICanvasPageQueryService)
            : undefined;
          if (!canvas) return [];
          try { return (await canvas.getRootPages()).map((p) => ({ title: p.title, updatedAt: p.updatedAt })); }
          catch { return []; }
        },
        // M87 S2 — standing watches from HEARTBEAT.md, evaluated on every
        // model review (and the daily reflection).
        getPurposeWatches: async () => {
          try {
            const content = await dataService.readFileRelative(HEARTBEAT_PURPOSE_PATH);
            return content ? parseHeartbeatPurpose(content).watches : [];
          } catch { return []; }
        },
        // The user's open planner tasks — the second surface the review knows.
        getWorkspaceTasks: async () => {
          const planner = api.services.has(IPlannerQueryService)
            ? api.services.get<import('../../services/serviceTypes.js').IPlannerQueryService>(IPlannerQueryService)
            : undefined;
          if (!planner) return [];
          try { return await planner.listOpenTasks(); }
          catch { return []; }
        },
        // The activity timeline — what the user actually DID since the last
        // review, as human-readable lines. This is the sense that lets a
        // review reason about behavior instead of file-change aftermath.
        getRecentActivity: async () => {
          try { return _activityJournal?.renderRecent({ maxLines: 40 }) ?? ''; }
          catch { return ''; }
        },
        // Continuity + audit (Build-1d.3). The loop reads its prior beliefs into
        // the seed and ledgers every outcome. Best-effort: never breaks the tick.
        mind: mindService,
        // M87 — deterministic fact→trigger→delivery lane (no model, no chat
        // session; runs before the idle gate). Findings land in the planner
        // review queue / notifications and mirror to the autonomy log.
        // S4: the last result is captured for parallx.heartbeat.status so
        // the status board can say what the quiet lane actually checked.
        deterministicLane: async () => {
          const result = await runHeartbeatDeterministicLane({
          collectFacts: async () => {
            const planner = api.services.has(IPlannerQueryService)
              ? api.services.get<import('../../services/serviceTypes.js').IPlannerQueryService>(IPlannerQueryService)
              : undefined;
            const [tasks, today, sync] = await Promise.all([
              planner?.listTaskFacts?.() ?? Promise.resolve([]),
              planner?.getTodayDigest?.() ?? Promise.resolve(null),
              planner?.getSyncHealth?.() ?? Promise.resolve(null),
            ]);
            const plans = buildPlanFacts(chatService.getSessions().map((s) => ({
              sessionId: s.id,
              plan: s.plan,
            })));
            // UC7 — AGENTS.md staleness inputs: content hash + 30d page churn.
            let agentsMd: { hashPrefix: string | null; recentPageUpdates: number } | null = null;
            try {
              const content = await dataService.readFileRelative('.parallx/AGENTS.md');
              const canvas = api.services.has(ICanvasPageQueryService)
                ? api.services.get<import('../../services/serviceTypes.js').ICanvasPageQueryService>(ICanvasPageQueryService)
                : undefined;
              const pages = canvas ? await canvas.getRootPages() : [];
              const cutoff = Date.now() - 30 * 86_400_000;
              const recentPageUpdates = pages.filter((p) => {
                const t = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
                return Number.isFinite(t) && t >= cutoff;
              }).length;
              agentsMd = { hashPrefix: content ? contentHashPrefix(content) : null, recentPageUpdates };
            } catch { agentsMd = null; }
            return { plans, tasks, today, sync, agentsMd };
          },
          loadLedger: async () => {
            try {
              const storage = api.services.has(IWorkspaceStorageService)
                ? api.services.get<import('../../platform/storage.js').IStorage>(IWorkspaceStorageService)
                : undefined;
              const raw = await storage?.get('parallx-heartbeat-trigger-ledger');
              const parsed = raw ? JSON.parse(raw) : {};
              return parsed && typeof parsed === 'object' ? parsed : {};
            } catch { return {}; }
          },
          saveLedger: async (ledger) => {
            const storage = api.services.has(IWorkspaceStorageService)
              ? api.services.get<import('../../platform/storage.js').IStorage>(IWorkspaceStorageService)
              : undefined;
            await storage?.set('parallx-heartbeat-trigger-ledger', JSON.stringify(ledger));
          },
          deliverTask: async (finding) => {
            const planner = api.services.has(IPlannerQueryService)
              ? api.services.get<import('../../services/serviceTypes.js').IPlannerQueryService>(IPlannerQueryService)
              : undefined;
            if (!planner?.captureHeartbeatTask) return false;
            return planner.captureHeartbeatTask({
              title: finding.title,
              description: finding.detail,
              sourceKey: finding.key,
            });
          },
          deliverNotification: async (finding) => {
            const notifications = api.services.has(INotificationService)
              ? api.services.get<import('../../services/serviceTypes.js').INotificationService>(INotificationService)
              : undefined;
            if (!notifications) return false;
            void notifications.info(`${finding.title}: ${finding.detail}`);
            return true;
          },
          log: (finding) => {
            autonomyLog.append({
              origin: 'heartbeat',
              requestText: `[trigger] ${finding.kind}`,
              content: `${finding.title}: ${finding.detail}`,
              metadata: { findingKey: finding.key, delivery: finding.delivery },
            });
          },
          getConfig: () => {
            const hb = unifiedConfigService.getEffectiveConfig().heartbeat;
            return {
              stallDays: hb.triggerStallDays,
              reviewQueueSize: hb.triggerReviewQueueSize,
              overdueDays: hb.triggerOverdueDays,
            };
          },
          });
          _lastTriggerLane = { at: Date.now(), ...result };
          // M89 S3 — presence: filed findings get one status-bar pulse.
          if (surfaceRouter && (result as { delivered?: number }).delivered! > 0) {
            const n = (result as { delivered: number }).delivered;
            void surfaceRouter.sendWithOrigin({
              surfaceId: 'status',
              contentType: 'text',
              content: `watchers: ${n} filed`,
              metadata: { pulse: true, tooltip: 'Heartbeat filed follow-ups. See the planner review queue.' },
            }, 'heartbeat').catch(() => {});
          }
          return result;
        },
      },
    );

    const heartbeatRunner = new HeartbeatRunner(executor, readHeartbeatConfig);
    context.subscriptions.push(heartbeatRunner);

    // ── M60 Phase γ §3.7 — shutdown suspension ──
    // When the chat extension is torn down (workbench shutdown), suspend
    // autonomy BEFORE running dispose chains so in-flight ticks can finish
    // gracefully without scheduling new work. Cron service is suspended via
    // the same disposable below.
    const _autonomyShutdownDisposable = {
      dispose: () => {
        heartbeatRunner.suspendForShutdown();
        cronService?.suspendForShutdown();
      },
    };
    // Push BEFORE the runners so it disposes first (subscriptions dispose in
    // push-order; we want suspend before stop).
    context.subscriptions.push(_autonomyShutdownDisposable);

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
          const hb = unifiedConfigService.getEffectiveConfig().heartbeat;
          for (const ev of events) {
            const uri = ev.uri.toString();
            // Hard guard: Parallx's OWN internal dir (.parallx/** — skills,
            // SOUL/USER/AGENTS/TOOLS/MEMORY, daily logs, the heartbeat's own
            // memory writes) is never a user-work signal. Drop it unconditionally,
            // independent of user config — this also covers a stale persisted
            // watchExcludeGlobs from before `**/.parallx/**` was a default.
            if (uri.replace(/\\/g, '/').includes('/.parallx/')) continue;
            // Fix 3 — honor user-configured include/exclude. Path filtering
            // is scoped to file-change events only (index/workspace events
            // bypass). The runner's coalesce window collapses surviving
            // bursts into a single turn.
            if (!shouldHeartbeatAcceptPath(uri, hb.watchIncludeExtensions, hb.watchExcludeGlobs)) {
              continue;
            }
            heartbeatRunner.pushEvent({
              type: 'file-change',
              payload: { path: uri, changeType: ev.type },
              timestamp: Date.now(),
            });
            // Feed the same (filtered) stream to the active-inference loop so it
            // forecasts the user's next file and grades itself against reality.
            observeForPrediction(uri);
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

    // ── Phase 3 · Extension signal channel ──
    // Both api.autonomy.signal(...) and the parallx.autonomy.signal command flow
    // through the shared AutonomySignalService; we subscribe its output onto the
    // heartbeat's review queue here. Malformed payloads are dropped by the
    // service; the runner's input dedup + the kill switch still apply.
    const _autonomySignals = api.services.has(IAutonomySignalService)
      ? api.services.get<import('../../services/autonomySignalService.js').IAutonomySignalService>(IAutonomySignalService)
      : undefined;
    if (_autonomySignals) {
      context.subscriptions.push(
        _autonomySignals.onDidSignal((sig) => {
          // A signal reaches a REVIEW when it's a warning/urgent OR a meaningful
          // user ACTION in a surface the agent should respond to (e.g. creating a
          // canvas page or a planner item). Pure status pings (a news refresh, a
          // sync completing) stay perception-only — they feed habits but never
          // spin up the model. This is what lets the agent see + respond to the
          // surfaces you actually touch, instead of only its own diagnostics.
          // actor stamp (canvas marks agent-mutated pages): a page the AGENT
          // created must never count as the user's behavior — not in the
          // conscience meter, not in habit detection. Unstamped signals from
          // canvas/planner default to user (they are user-gesture surfaces).
          const isUserAction = (sig.source === 'canvas' || sig.source === 'planner') && sig.actor !== 'agent';
          const salient = sig.severity === 'warn' || sig.severity === 'urgent' || isUserAction;
          if (salient && unifiedConfigService.getEffectiveConfig().heartbeat.senseExtensionSignals) {
            heartbeatRunner.pushEvent(signalToSystemEvent(sig));
          }
          // Canvas/planner USER signals are the user DOING work — count them in
          // the conscience denominator. Canvas pages live in SQLite, so the
          // file-edit recordHuman above never sees this work; without this line
          // the meter reads canvas-heavy days as "the human did nothing".
          // (planner emits no signals yet — the clause is forward wiring, and
          // planner work is still invisible to the meter until it does.)
          if (isUserAction) void mindService?.recordHuman(Date.now());
          // USER signals feed habit detection (agent-caused ones would train
          // fake "user habits" at machine-scheduled times). When a habit newly
          // CONFIRMS, we deterministically hand the agent a FOCUSED decision
          // (guaranteed — not a hint buried in a general review) and trust its
          // JUDGMENT on whether and how to offer automation. Code guarantees
          // the shot + the rails (cron); the model decides. Deduped to once per
          // habit so it never nags.
          const action = sig.actor === 'agent' ? '' : [sig.source, sig.title].filter(Boolean).join(':');
          if (action && mindService) {
            const mind = mindService;
            void (async () => {
              await mind.observeAction(action, Date.now());
              for (const h of await drainHabitProposalsIfViable(mind)) {
                heartbeatRunner.pushEvent({
                  type: 'habit-confirmed',
                  payload: { action: h.action, typicalTime: h.typicalTime, cron: cronForMinuteOfDay(h.typicalMinuteOfDay ?? 0) },
                  timestamp: Date.now(),
                });
              }
            })();
          }
        }),
      );
    }
    context.subscriptions.push(
      api.commands.registerCommand('parallx.autonomy.signal', (raw: unknown) =>
        _autonomySignals?.signal(raw) ?? false,
      ),
    );

    // Habit proposals are propose-ONCE (the marker persists), so consuming one
    // while the heartbeat can't deliver it — disabled (the shipped default) or
    // globally paused — would silently burn the user's one "Automate it?"
    // decision: the in-memory event queue dies with the session, the marker
    // doesn't. Drain only when a heartbeat tick can actually surface it;
    // otherwise the habit stays un-proposed and the next gesture after the
    // user enables heartbeat drains it naturally.
    const drainHabitProposalsIfViable = async (mind: MindService) => {
      const viable = unifiedConfigService.getEffectiveConfig().heartbeat.enabled
        && !autonomyFlags.isEnabled(FLAG_PAUSED_GLOBAL);
      return viable ? mind.takePendingHabitProposals(Date.now()) : [];
    };

    // The activity journal is the MIND's richest sense: deliberate user
    // gestures the signal bus never carries become MIND observations —
    // (1) habits: opening a pdf / focusing the planner, so "you open the
    //     planner every morning at 8" is learnable from ordinary app use.
    //     habitActionForActivity gates to first-fire, user-actor gesture verbs
    //     and EXCLUDES signal:* sources (they feed observeAction via the lane
    //     above — double-observing fakes tight clustering) and command runs
    //     (the command tap can't yet tell the user from plumbing/the AI).
    // (2) the conscience denominator: canvas TYPING bouts (journal 'edited'
    //     lines come only from the editor's save pipeline, so they're the
    //     user's own keystrokes) count as human work — once per coalesced
    //     bout, not per save.
    if (_activityJournal && mindService) {
      const mind = mindService;
      context.subscriptions.push(
        _activityJournal.onDidAppend((ev) => {
          if (ev.actor === 'user' && ev.source === 'canvas' && ev.verb === 'edited' && ev.count === 1) {
            void mind.recordHuman(ev.ts, ev.object);
          }
          const action = habitActionForActivity(ev);
          if (!action) return;
          void (async () => {
            await mind.observeAction(action, ev.ts);
            // Same guaranteed-proposal drain as the signal lane: a habit that
            // confirms from journal observations must not wait for an
            // unrelated bus signal to surface its "Automate it?" decision.
            for (const h of await drainHabitProposalsIfViable(mind)) {
              heartbeatRunner.pushEvent({
                type: 'habit-confirmed',
                payload: { action: h.action, typicalTime: h.typicalTime, cron: cronForMinuteOfDay(h.typicalMinuteOfDay ?? 0) },
                timestamp: Date.now(),
              });
            }
          })();
        }),
      );
    }

    // Heartbeat state snapshot for UI (autonomy-log "last reviewed / next in").
    context.subscriptions.push(
      api.commands.registerCommand('parallx.heartbeat.status', () => ({
        ...heartbeatRunner.state,
        // M87 S4 — last deterministic-lane pass (null until the first beat).
        triggerLane: _lastTriggerLane,
      })),
    );

    // MIND snapshot for the Mind panel (transparency: the human can see what the
    // agent believes, what it predicted, how accurate it's been, and the audit).
    context.subscriptions.push(
      api.commands.registerCommand('parallx.mind.status', async () =>
        mindService ? await mindService.snapshot() : { available: false },
      ),
    );

    // The human steering the mind: forget a belief by id (a correction). The
    // mind is the agent's, but the human can always overrule it.
    context.subscriptions.push(
      api.commands.registerCommand('parallx.mind.forget', async (raw: unknown) => {
        const id = (raw as { id?: unknown } | undefined)?.id;
        return (typeof id === 'string' && mindService) ? await mindService.forget(id) : false;
      }),
    );

    // The human wipes the whole MIND — a clean slate when the accumulated
    // beliefs are noise. Returns how many were cleared.
    context.subscriptions.push(
      api.commands.registerCommand('parallx.mind.clearAll', async () =>
        mindService ? await mindService.clearAll() : 0,
      ),
    );

    // Nag governor's external sensor: the user's response to a surfaced
    // suggestion. 'act' (Do it / Tell me more) keeps the agent chatty; sustained
    // 'dismiss' throttles its interruptions.
    context.subscriptions.push(
      api.commands.registerCommand('parallx.mind.feedback', (raw: unknown) => {
        const outcome = (raw as { outcome?: unknown } | undefined)?.outcome;
        if ((outcome === 'act' || outcome === 'dismiss') && mindService) {
          void mindService.recordFeedback(outcome);
          return true;
        }
        return false;
      }),
    );
  }

  // ── M60 §3.10: dev-only autonomy.replay command ──
  // Inspects a past autonomous turn from the event log — read-only; it summarizes
  // what the event did and never re-executes anything.
  if (autonomyEventLog) {
    context.subscriptions.push(
      api.commands.registerCommand('autonomy.replay', async (...args: unknown[]) => {
        const eventId = typeof args[0] === 'string' ? (args[0] as string) : '';
        const { executeAutonomyReplay } = await import('../../commands/autonomyReplayCommand.js');
        return executeAutonomyReplay(autonomyEventLog, eventId);
      }),
    );
  }

  // M62: `gmail.disconnect` removed. To disconnect the Gmail MCP server,
  // delete `~/.parallx/gmail-mcp/credentials.json` and remove the entry
  // from chat-gear → MCP Servers.

  // ── 4. Build widget services bridge (delegates to ChatDataService) ──

  const widgetServices = dataService.buildWidgetServices();
  // C2: Wire AI Settings opener — accessible from the chat title bar gear
  // icon. `ai-settings.open` lands on the unified Settings hub's AI panel
  // (the sidebar surface is retired — one settings surface).
  (widgetServices as unknown as Record<string, unknown>).openAISettings = () => {
    api.commands.executeCommand('ai-settings.open');
  };

  // M86 — user-initiated plan removal (the ✕ on the plan card). The model
  // has plan_update {clear:true}; the USER gets this. setSessionPlan fires
  // onDidChangeSession, so the card disappears immediately.
  (widgetServices as unknown as Record<string, unknown>).clearSessionPlan = (sessionId: string) => {
    chatService.setSessionPlan?.(sessionId, undefined);
  };

  // Live block-reference resolver: a canvas-block attachment resolves its
  // CURRENT content at send time via the canvas command (so it's never a stale
  // snapshot). Canvas owns the markdown serialization; we just bridge the call.
  (widgetServices as unknown as Record<string, unknown>).resolveCanvasBlock = (pageId: string, blockId: string) =>
    api.commands.executeCommand('canvas.resolveBlockForChat', pageId, blockId);

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
        const view = createChatView(
          container,
          _ollamaProvider!,
          widgetServices,
          setActiveWidget,
        );
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

  // M86: clear the active session's plan from the palette — the user-side
  // counterpart of plan_update {clear:true} for when the model finishes the
  // work but leaves its plan behind.
  context.subscriptions.push(
    api.commands.registerCommand('chat.clearPlan', () => {
      const sid = _activeWidget?.getSession()?.id;
      if (sid) chatService.setSessionPlan?.(sid, undefined);
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

  // M66 — register the chat link contract. Makes
  // `parallx://chat/session/<sessionId>` swap the active chat to the named
  // session (does not create — only opens an existing session).
  context.subscriptions.push(
    api.links.register({
      segment: 'chat',
      displayName: 'Chat',
      kinds: {
        session: {
          uriTemplate: 'parallx://chat/session/<sessionId>',
          description: 'Open an existing chat session by id in the active chat widget. Returns false if the session is unknown or the chat panel isn\'t mounted.',
          examples: ['parallx://chat/session/01HZX...'],
          async open(parsed) {
            const sessionId = parsed.pathSegments[1];
            if (!sessionId) return false;
            const session = chatService.getSession(sessionId);
            if (!session) return false;
            try {
              await api.commands.executeCommand('chat.show');
            } catch {
              // Best-effort; panel may already be visible.
            }
            if (!_activeWidget) return false;
            _activeWidget.setSession(session);
            return true;
          },
          async resolveMetadata(parsed) {
            const sessionId = parsed.pathSegments[1];
            if (!sessionId) return null;
            const session = chatService.getSession(sessionId);
            if (!session) return null;
            const title = (session as { title?: string }).title || 'Chat session';
            return { title, icon: 'message-circle' };
          },
        },
      },
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

  // 9a-ter. Submit a prompt into the ACTIVE chat session.
  //
  // This is the single, simple bridge any surface (dashboard widgets,
  // automations) uses to ask the AI to do work. It reveals the chat panel,
  // ensures a session exists, drops the prompt into the active session, and
  // submits it. From there it runs through regular chat — same model, same
  // registered tools (webSearch/webFetch/dashboard_render_widget/…), same defaults.
  //
  // Fire-and-forget: it returns once the prompt is submitted. The AI's output
  // streams visibly in chat; surfaces that want results delivered back to a
  // widget instruct the model (in the prompt) to call the `dashboard_render_widget`
  // tool with their instanceId.
  //
  // Contract: { text: string, reveal?: boolean } → void.
  context.subscriptions.push(
    api.commands.registerCommand('chat.submitPrompt', async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { text?: string; reveal?: boolean };
      const text = typeof opts.text === 'string' ? opts.text.trim() : '';
      if (!text) {
        throw new Error('submitPrompt: a non-empty "text" prompt is required.');
      }
      if (opts.reveal !== false) {
        try { await api.commands.executeCommand('chat.show'); } catch { /* panel may already be visible */ }
      }
      if (!_activeWidget) {
        throw new Error('submitPrompt: the chat panel is not mounted.');
      }
      // Ensure a session is bound — acceptInput() no-ops without one. Routed
      // through ensureSession() so a session created for this programmatic
      // prompt inherits the user's chosen context window instead of resetting
      // it to auto.
      _activeWidget.ensureSession();
      _activeWidget.setInputValue(text);
      _activeWidget.acceptInput();
    }),
  );

  // chat.stagePrompt — submitPrompt's other half: fill the input and STOP.
  //
  // A one-shot prompt fired straight at the model answers whatever the caller
  // guessed the user wanted to ask. Staging hands the turn back: the prompt
  // and its attachments are ready, and the user edits or extends it before
  // sending. Callers that want the old fire-and-forget keep using
  // submitPrompt; this is for surfaces where the question is really the
  // user's, not the caller's.
  //
  // Contract: { text, reveal? } — reveal:false skips showing the panel.
  context.subscriptions.push(
    api.commands.registerCommand('chat.stagePrompt', async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { text?: string; reveal?: boolean };
      const text = typeof opts.text === 'string' ? opts.text : '';
      if (!text.trim()) {
        throw new Error('stagePrompt: a non-empty "text" prompt is required.');
      }
      if (opts.reveal !== false) {
        try { await api.commands.executeCommand('chat.show'); } catch { /* panel may already be visible */ }
      }
      if (!_activeWidget) {
        throw new Error('stagePrompt: the chat panel is not mounted.');
      }
      // Bind a session for the same reason submitPrompt does: without one the
      // eventual acceptInput() silently no-ops, and the user would press
      // Enter on a staged prompt and watch nothing happen.
      _activeWidget.ensureSession();
      _activeWidget.stageInput(text);
    }),
  );

  // chat.runBackgroundPrompt — the HEADLESS sibling of submitPrompt (M86 C4).
  //
  // Runs the prompt as one isolated agent turn on the ephemeral-session rail
  // (same substrate as heartbeat/cron): the chat panel is never revealed and
  // the user's visible session is never touched. Dashboard AI widgets refresh
  // through this — their prompts instruct the model to deliver results via
  // `dashboard_render_widget`, so the widget cache is written mid-turn.
  //
  // Contract: { text, origin?, originLabel?, systemMessage? }
  //        → { ok: true, resultText } | { ok: false, error }.
  const runBackgroundPrompt = createBackgroundPromptRunner({
    chatService: {
      createEphemeralSession: (parentId, seed) =>
        (chatService as unknown as import('../../services/chatService.js').ChatService).createEphemeralSession(parentId, seed),
      purgeEphemeralSession: (handle) =>
        (chatService as unknown as import('../../services/chatService.js').ChatService).purgeEphemeralSession(handle),
      sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
      getSession: (sid) => chatService.getSession(sid),
      cancelRequest: (sid) => chatService.cancelRequest(sid),
    },
    permissionService: _permissionService
      ? {
          markHeartbeatSession: (sid, level) => _permissionService!.markHeartbeatSession(sid, level as never),
          unmarkHeartbeatSession: (sid) => _permissionService!.unmarkHeartbeatSession(sid),
          markUserTaskSession: (sid) => _permissionService!.markUserTaskSession(sid),
          unmarkUserTaskSession: (sid) => _permissionService!.unmarkUserTaskSession(sid),
        }
      : undefined,
    getAutonomyLevel: () => unifiedConfigService?.getEffectiveConfig().heartbeat.autonomy,
    // A parent session must exist, but the chat VIEW must not be required:
    // "open the chat panel once, then retry" made every background refresh
    // in a fresh window fail consistently. Fallback chain: mounted widget's
    // session → any existing session → mint a headless one.
    getParentSessionId: () => {
      try { _activeWidget?.ensureSession(); } catch { /* widget not ready */ }
      const fromWidget = _activeWidget?.getSession()?.id;
      if (fromWidget) return fromWidget;
      const existing = chatService.getSessions();
      if (existing.length > 0) return existing[0].id;
      try { return chatService.createSession().id; } catch { return undefined; }
    },
    autonomyLog,
    // Transparency: stamp the serving model on every run's log entries, and
    // narrate failures into the activity timeline.
    getActiveModelId: () => languageModelsService.getActiveModel() ?? undefined,
    activity: _activityJournal
      ? { note: (n) => _activityJournal.note(n) }
      : undefined,
  });
  context.subscriptions.push(
    api.commands.registerCommand('chat.runBackgroundPrompt', async (...args: unknown[]) =>
      runBackgroundPrompt((args[0] ?? {}) as { text: string }),
    ),
  );

  // ── M91 — archived autonomous-run viewer ──
  // Reopen a heartbeat/cron/dashboard/subagent run's FULL transcript as a
  // read-only editor tab. openEditor forwards only instanceId, so the
  // origin/title are stashed per-session for the pane to read.
  const _archivedRunMeta = new Map<string, { origin?: string; title?: string }>();
  const _archivedChatSvc = chatService as unknown as import('../../services/chatService.js').ChatService;
  context.subscriptions.push(
    api.editors.registerEditorProvider(ARCHIVED_RUN_EDITOR_TYPE, {
      createEditorPane(container: HTMLElement, input?: unknown): { dispose(): void } {
        const sessionId = (input as { id?: string } | undefined)?.id ?? '';
        const meta = _archivedRunMeta.get(sessionId);
        let handle: { dispose(): void } = { dispose() { /* replaced on load */ } };
        void _archivedChatSvc.getArchivedRun(sessionId).then((run) => {
          handle = renderArchivedRun(container, run, meta?.origin);
        }).catch(() => {
          handle = renderArchivedRun(container, null, meta?.origin);
        });
        return { dispose() { handle.dispose(); _archivedRunMeta.delete(sessionId); } };
      },
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('chat.openArchivedRun', async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { sessionId?: string; origin?: string; title?: string };
      if (!opts.sessionId) return;
      _archivedRunMeta.set(opts.sessionId, { origin: opts.origin, title: opts.title });
      await api.editors.openEditor({
        typeId: ARCHIVED_RUN_EDITOR_TYPE,
        title: opts.title || 'Autonomous run',
        instanceId: opts.sessionId,
      });
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('chat.getArchivedRunSummaries', async (...args: unknown[]) => {
      const limit = (args[0] as { limit?: number } | undefined)?.limit;
      return _archivedChatSvc.getArchivedRunSummaries(limit);
    }),
  );


  // dashboard "Autonomy activity" widget (and any other surface that wants a
  // compact view of background agent activity). Mirrors the
  // `chat.getInlineAIProvider` pattern: the chat extension owns the autonomy
  // log + rail, so it exposes a slim command instead of letting widgets read
  // ndjson files directly. Returns only structured metadata — never message
  // or tool-call bodies (§3.9 privacy posture).
  context.subscriptions.push(
    api.commands.registerCommand('chat.getRecentAutonomyEvents', async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as {
        sinceDays?: number;
        limit?: number;
        triggers?: readonly string[];
        outcomes?: readonly string[];
      };
      const filter: IRailFilter = {
        sinceDays: typeof opts.sinceDays === 'number' ? opts.sinceDays : 7,
        limit: typeof opts.limit === 'number' ? opts.limit : 30,
        triggers: opts.triggers as IRailFilter['triggers'],
        outcomes: opts.outcomes as IRailFilter['outcomes'],
      };
      let rows: readonly IRailRow[] = [];
      try {
        if (!autonomyTaskRail) return [];
        rows = await autonomyTaskRail.readRows(filter);
      } catch (err) {
        console.warn('[chat] getRecentAutonomyEvents failed:', err);
        return [];
      }
      return rows.map((r) => ({
        id: r.id,
        triggeredAt: r.triggeredAt,
        trigger: r.trigger,
        outcome: r.outcome,
        durationMs: r.durationMs,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        toolCount: r.kind === 'event' ? (r.record.toolCalls?.length ?? 0) : undefined,
        note: r.kind === 'event' ? r.note : undefined,
      }));
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
        // M81 Phase 6 — enumerate files (not directories) for bundled
        // scripts/references/assets discovery under each skill folder.
        listFiles: async (path: string) => {
          try {
            const entries = await fsAccessor!.readdir(path);
            return entries.filter(e => e.type === 'file').map(e => e.name);
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
              throw new Error('No workspace folder; cannot write config');
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
      // Persist per-workspace to <folder>/.parallx/permissions.json when a folder
      // is open; otherwise (or if that write fails for any reason — missing
      // folder, absent .parallx dir, etc.) fall back to global app storage so
      // "Always allow" is NEVER silently lost. The old code threw + swallowed the
      // error when no folder was open, which is why grants didn't persist for a
      // folderless session.
      const PERMS_GLOBAL_KEY = 'parallx.permissions.overrides';
      const hasWorkspaceFolder = () => (workspaceService!.folders?.length ?? 0) > 0;
      permsFileService.setFileSystem({
        readFile: async (path: string) => {
          if (hasWorkspaceFolder()) {
            try { const r = await fsAccessor!.readFileContent(path); if (r.content) return r.content; }
            catch { /* fall through to global */ }
          }
          return context.globalState.get<string>(PERMS_GLOBAL_KEY) ?? '';
        },
        exists: async (path: string) => {
          if (hasWorkspaceFolder()) {
            try { if (await fsAccessor!.exists(path)) return true; } catch { /* fall through */ }
          }
          return context.globalState.get<string>(PERMS_GLOBAL_KEY) != null;
        },
      });
      permsFileService.setFileWriter({
        writeFile: async (relativePath: string, content: string) => {
          if (hasWorkspaceFolder()) {
            try {
              const rootUri = workspaceService!.folders[0].uri;
              const clean = normalizeWorkspaceRelativePath(relativePath);
              await fileService!.writeFile(rootUri.joinPath(clean), content);
              return;
            } catch { /* fall through to global storage */ }
          }
          await context.globalState.update(PERMS_GLOBAL_KEY, content);
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

  // LIVE canvas-block reference → chat input (driven by the canvas block menu's
  // "Send to Chat"). Resolves current content at send time, not here.
  context.subscriptions.push(
    api.commands.registerCommand('chat.addCanvasBlockReference', async (...args: unknown[]) => {
      const payload = args[0] as ICanvasBlockReferencePayload | undefined;
      if (_chatProgrammaticAccess && payload?.pageId && Array.isArray(payload.blocks) && payload.blocks.length) {
        await _chatProgrammaticAccess.addCanvasBlockReference(payload);
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

  // LIVE canvas-block references dispatched by the canvas block menu's
  // "Send to Chat" — resolved to current content at send time.
  const onCanvasBlockToChat = (e: globalThis.Event): void => {
    const detail = (e as CustomEvent).detail;
    if (!detail?.pageId || !Array.isArray(detail.blocks) || detail.blocks.length === 0) return;
    void _chatProgrammaticAccess?.addCanvasBlockReference({
      pageId: detail.pageId,
      pageTitle: detail.pageTitle,
      blocks: detail.blocks,
    });
  };
  document.addEventListener('parallx-canvas-block-to-chat', onCanvasBlockToChat);
  context.subscriptions.push({
    dispose: () => document.removeEventListener('parallx-canvas-block-to-chat', onCanvasBlockToChat),
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
  _mindServiceRef = undefined;
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
