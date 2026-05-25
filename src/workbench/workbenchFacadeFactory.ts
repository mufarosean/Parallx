// workbenchFacadeFactory.ts — Facade service registration
//
// Extracted from workbench.ts (D.2) to reduce the god-object.
// VS Code parity: services are registered via `registerSingleton()` calls
// scattered across service files. Parallx centralizes registrations here.
//
// Responsibilities:
//   - Create and register LayoutService, ViewService, WorkspaceService,
//     WorkspaceBoundaryService, WindowService, NotificationService
//   - Wire workspace service into Quick Access for workspace switching
//   - Enforce workspace boundary on FileService

import { IDisposable } from '../platform/lifecycle.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import {
  IAgentApprovalService,
  IAgentExecutionService,
  IAgentMemoryService,
  IAgentPolicyService,
  IAgentSessionService,
  IAgentTaskStore,
  IAgentTraceService,
  ICanonicalMemorySearchService,
  IIndexingPipelineService,
  IMemoryService,
  IRetrievalService,
  IUnifiedAIConfigService,
  ILayoutService,
  IViewService,
  IWorkspaceService,
  IContextService,
  ISurfaceRegistry,
  ISelectionService,
  IResourceRegistry,
  IToolArtifactStore,
  IWorkspaceBoundaryService,
  IWorkspaceMemoryService,
  IWorkspaceTranscriptService,
  INotificationService,
  IFileService,
} from '../services/serviceTypes.js';

import { LayoutService } from '../services/layoutService.js';
import { ViewService } from '../services/viewService.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { ContextService } from './resources/contextService.js';
import { fileResourceResolver } from './resources/resolvers/fileResolver.js';
import { externalResourceResolver } from './resources/resolvers/externalResolver.js';
import { toolArtifactResourceResolver } from './resources/resolvers/toolArtifactResolver.js';
import { InMemoryToolArtifactStore } from './toolArtifactStore.js';
import { WorkspaceBoundaryService } from '../services/workspaceBoundaryService.js';
import { WorkspaceMemoryService } from '../services/workspaceMemoryService.js';
import { WorkspaceTranscriptService } from '../services/workspaceTranscriptService.js';
import { CanonicalMemorySearchService } from '../services/canonicalMemorySearchService.js';
import { AgentPolicyService } from '../services/agentPolicyService.js';
import { AgentExecutionService } from '../services/agentExecutionService.js';
import { AgentMemoryService } from '../services/agentMemoryService.js';
import { AgentSessionService } from '../services/agentSessionService.js';
import { AgentTraceService } from '../services/agentTraceService.js';

import type { Workspace } from '../workspace/workspace.js';
import type { WorkspaceSaver } from '../workspace/workspaceSaver.js';
import type { QuickAccessWidget } from '../commands/quickAccess.js';
import type { Event } from '../platform/events.js';
import type { RecentWorkspaceEntry } from '../workspace/workspaceTypes.js';

// ─── Host interface ──────────────────────────────────────────────────────────

export interface FacadeFactoryHost {
  readonly container: HTMLElement;
  readonly _hGrid: { layout(): void; resize(w: number, h: number): void };
  readonly _vGrid: { layout(): void; resize(w: number, h: number): void };

  readonly workspace: Workspace;
  readonly _workspaceSaver: WorkspaceSaver;

  _layoutViewContainers(): void;
  isPartVisible(partId: string): boolean;
  setPartHidden(hidden: boolean, partId: string): void;
  readonly onDidChangePartVisibility: Event<{ partId: string; visible: boolean }>;

  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<Workspace>;
  switchWorkspace(id: string): Promise<void>;
  getRecentWorkspaces(): Promise<readonly RecentWorkspaceEntry[]>;
  removeRecentWorkspace(id: string): Promise<void>;
  readonly onDidSwitchWorkspace: Event<Workspace>;
}

export interface FacadeFactoryDeps {
  readonly services: ServiceCollection;
  readonly host: FacadeFactoryHost;
  readonly commandPalette?: QuickAccessWidget;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register facade services and return disposables for the caller to track.
 *
 * Facade services wrap internal workbench state behind service interfaces
 * consumable by other modules (Capability 0 gap cleanup).
 */
export function registerFacadeServices(deps: FacadeFactoryDeps): IDisposable[] {
  const { services, host, commandPalette } = deps;
  const disposables: IDisposable[] = [];

  // Layout service — delegates to grids
  const layoutService = new LayoutService();
  layoutService.setHost({
    get container() { return host.container; },
    get _hGrid() { return host._hGrid; },
    get _vGrid() { return host._vGrid; },
    _layoutViewContainers: () => host._layoutViewContainers(),
    isPartVisible: (partId: string) => host.isPartVisible(partId),
    setPartHidden: (hidden: boolean, partId: string) => host.setPartHidden(hidden, partId),
    onDidChangePartVisibility: host.onDidChangePartVisibility,
  });
  disposables.push(layoutService);
  services.registerInstance(ILayoutService, layoutService);

  // View service — placeholder for M2 tool API surface
  const viewService = new ViewService();
  disposables.push(viewService);
  services.registerInstance(IViewService, viewService);

  // Workspace service — delegates to workbench workspace operations
  const workspaceService = new WorkspaceService();
  workspaceService.setHost({
    get workspace() { return host.workspace; },
    get _workspaceSaver() { return host._workspaceSaver; },
    createWorkspace: (name: string, path?: string, switchTo?: boolean) => host.createWorkspace(name, path, switchTo),
    switchWorkspace: (id: string) => host.switchWorkspace(id),
    getRecentWorkspaces: () => host.getRecentWorkspaces(),
    removeRecentWorkspace: (id: string) => host.removeRecentWorkspace(id),
    get onDidSwitchWorkspace() { return host.onDidSwitchWorkspace; },
  });
  disposables.push(workspaceService);
  services.registerInstance(IWorkspaceService, workspaceService);

  // ── Context Service (Unified Workbench Primitives — Slice A4) ──
  // Composes workspace + active surface + selection into one canonical
  // workbench context. Pure-additive — no consumer reads from it yet.
  // Wired here (not in registerWorkbenchServices) because IWorkspaceService
  // is constructed at facade time, after the three source services exist.
  const contextService = new ContextService(
    {
      get activeWorkspace() { return workspaceService.activeWorkspace ? { id: workspaceService.activeWorkspace.id } : undefined; },
      onDidChangeWorkspace: workspaceService.onDidChangeWorkspace,
    },
    services.get(ISurfaceRegistry),
    services.get(ISelectionService),
  );
  disposables.push(contextService);
  services.registerInstance(IContextService, contextService);

  // ── File Resource Resolver (Unified Workbench Primitives — Slice A6) ──
  // Registers a built-in resolver for FileResource so any consumer can call
  // resourceRegistry.resolveUri('parallx://file:...') and get content back.
  // Pure-additive — no consumer reads from it yet.
  if (services.has(IResourceRegistry) && services.has(IFileService)) {
    services.get(IResourceRegistry).register(fileResourceResolver(services.get(IFileService)));
  }

  // External resolver needs no source service (echoes URI unchanged); register
  // unconditionally so consumers can call resolveUri on http(s)/mailto URIs.
  if (services.has(IResourceRegistry)) {
    services.get(IResourceRegistry).register(externalResourceResolver());
  }

  // ── Tool Artifact Store + Resolver (Slice A10) ──────────────────────────
  // Workbench-owned in-memory store for tool-produced artifacts. Tools
  // (extensions, web research, agents) put records here; the tool-artifact
  // resolver reads them so `resolveUri('parallx://tool-artifact:...')` works
  // end-to-end. Pure-additive: no existing tool writes to this yet.
  const toolArtifactStore = new InMemoryToolArtifactStore();
  disposables.push(toolArtifactStore);
  services.registerInstance(IToolArtifactStore, toolArtifactStore);
  if (services.has(IResourceRegistry)) {
    services.get(IResourceRegistry).register(
      toolArtifactResourceResolver({
        getArtifact: (toolId: string, artifactId: string) => toolArtifactStore.get(toolId, artifactId),
      }),
    );
  }

  // Workspace boundary service
  const workspaceBoundaryService = new WorkspaceBoundaryService();
  workspaceBoundaryService.setHost({
    get folders() { return workspaceService.folders; },
  });
  disposables.push(workspaceBoundaryService);
  services.registerInstance(IWorkspaceBoundaryService, workspaceBoundaryService);

  if (services.has(IFileService)) {
    const workspaceMemoryService = new WorkspaceMemoryService(services.get(IFileService), workspaceService);
    disposables.push(workspaceMemoryService);
    services.registerInstance(IWorkspaceMemoryService, workspaceMemoryService);
    workspaceMemoryService.ensureScaffold().catch((err) => {
      console.warn('[Workbench] Failed to seed workspace memory scaffold:', err);
    });

    const workspaceTranscriptService = new WorkspaceTranscriptService(services.get(IFileService), workspaceService);
    disposables.push(workspaceTranscriptService);
    services.registerInstance(IWorkspaceTranscriptService, workspaceTranscriptService);
    workspaceTranscriptService.ensureScaffold().catch((err) => {
      console.warn('[Workbench] Failed to seed workspace transcript scaffold:', err);
    });
  }

  if (services.has(IRetrievalService) && services.has(IIndexingPipelineService) && services.has(IWorkspaceMemoryService)) {
    const canonicalMemorySearchService = new CanonicalMemorySearchService(
      services.get(IRetrievalService),
      services.get(IIndexingPipelineService),
      services.get(IWorkspaceMemoryService),
    );
    disposables.push(canonicalMemorySearchService);
    services.registerInstance(ICanonicalMemorySearchService, canonicalMemorySearchService);
  }

  if (services.has(IWorkspaceMemoryService) && services.has(IMemoryService)) {
    const workspaceMemoryService = services.get(IWorkspaceMemoryService);
    const memoryService = services.get(IMemoryService);
    Promise.all([
        memoryService.getAllMemories().catch(() => []),
        memoryService.getPreferences().catch(() => []),
        memoryService.getAllConcepts().catch(() => []),
      ]).then(([memories, preferences, concepts]) => {
      return workspaceMemoryService.importLegacySnapshot({
        memories: memories.map((memory) => ({
          sessionId: memory.sessionId,
          createdAt: memory.createdAt,
          messageCount: memory.messageCount,
          summary: memory.summary,
        })),
        preferences: preferences.map((preference) => ({
          key: preference.key,
          value: preference.value,
        })),
        concepts: concepts.map((concept) => ({
          concept: concept.concept,
          category: concept.category,
          summary: concept.summary,
          encounterCount: concept.encounterCount,
          masteryLevel: concept.masteryLevel,
        })),
      });
    }).catch((err) => {
      console.warn('[Workbench] Failed to import legacy memory snapshot:', err);
    });
  }

  const unifiedConfigService = services.has(IUnifiedAIConfigService)
    ? services.get(IUnifiedAIConfigService)
    : undefined;

  const agentPolicyService = new AgentPolicyService(workspaceBoundaryService, unifiedConfigService);
  disposables.push(agentPolicyService);
  services.registerInstance(IAgentPolicyService, agentPolicyService);

  if (services.has(IAgentTaskStore) && services.has(IAgentApprovalService)) {
    const agentMemoryService = new AgentMemoryService(services.get(IAgentTaskStore));
    disposables.push(agentMemoryService);
    services.registerInstance(IAgentMemoryService, agentMemoryService);

    const agentTraceService = new AgentTraceService(services.get(IAgentTaskStore));
    disposables.push(agentTraceService);
    services.registerInstance(IAgentTraceService, agentTraceService);

    const agentSessionService = new AgentSessionService(
      workspaceService,
      services.get(IAgentTaskStore),
      services.get(IAgentApprovalService),
      agentTraceService,
    );
    disposables.push(agentSessionService);
    services.registerInstance(IAgentSessionService, agentSessionService);

    const agentExecutionService = new AgentExecutionService(
      services.get(IAgentTaskStore),
      agentSessionService,
      agentPolicyService,
      unifiedConfigService,
      agentMemoryService,
      agentTraceService,
    );
    disposables.push(agentExecutionService);
    services.registerInstance(IAgentExecutionService, agentExecutionService);
  }

  // Enforce workspace boundary on FileService
  if (services.has(IFileService)) {
    const fileService = services.get(IFileService);
    fileService.setBoundaryChecker((uri: any, operation: string) => {
      workspaceBoundaryService.assertUriWithinWorkspace(uri, `FileService.${operation}`);
    });
  }

  // Wire workspace service into Quick Access
  if (commandPalette) {
    commandPalette.setWorkspaceService({
      workspace: host.workspace,
      getRecentWorkspaces: () => host.getRecentWorkspaces(),
      switchWorkspace: (id: string) => host.switchWorkspace(id),
    });
  }

  // Notification service — attach toast container
  if (services.has(INotificationService)) {
    const notificationService = services.get(INotificationService);
    notificationService.attach(host.container);
  }

  console.log('[Workbench] Facade services registered (layout, view, workspace)');
  return disposables;
}
