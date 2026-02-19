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
  ILayoutService,
  IViewService,
  IWorkspaceService,
  IWorkspaceBoundaryService,
  INotificationService,
  IFileService,
} from '../services/serviceTypes.js';

import { LayoutService } from '../services/layoutService.js';
import { ViewService } from '../services/viewService.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { WorkspaceBoundaryService } from '../services/workspaceBoundaryService.js';

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

  // Workspace boundary service
  const workspaceBoundaryService = new WorkspaceBoundaryService();
  workspaceBoundaryService.setHost({
    get folders() { return workspaceService.folders; },
  });
  disposables.push(workspaceBoundaryService);
  services.registerInstance(IWorkspaceBoundaryService, workspaceBoundaryService);

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
