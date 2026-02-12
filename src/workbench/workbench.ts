// workbench.ts — root shell orchestrator
//
// Single entry point for the Parallx workbench. Owns the DI container,
// lifecycle, and coordinates all subsystems through a 5-phase sequence:
//   1. Services — DI container populated, storage + persistence created
//   2. Layout — Grid system built, parts created, DOM assembled
//   3. Parts — Titlebar menus, sidebar views, panel views, DnD, status bar
//   4. WorkspaceRestore — Saved layout state loaded (exercised, applied later)
//   5. Ready — CSS ready class, log
// Teardown reverses (5→1).

import { Disposable, DisposableStore, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { URI } from '../platform/uri.js';
import { ILifecycleService, ICommandService, IContextKeyService, IEditorService, IEditorGroupService, ILayoutService, IViewService, IWorkspaceService, INotificationService, IActivationEventService, IToolErrorService, IToolActivatorService, IToolRegistryService, IWindowService, IFileService, ITextFileModelManager } from '../services/serviceTypes.js';
import { LifecyclePhase, LifecycleService } from './lifecycle.js';
import { registerWorkbenchServices, registerConfigurationServices } from './workbenchServices.js';

// Parts
import { Part } from '../parts/part.js';
import { PartRegistry } from '../parts/partRegistry.js';
import { PartId } from '../parts/partTypes.js';
import { titlebarPartDescriptor, TitlebarPart } from '../parts/titlebarPart.js';
import { activityBarPartDescriptor, ActivityBarPart } from '../parts/activityBarPart.js';
import { sidebarPartDescriptor, SidebarPart } from '../parts/sidebarPart.js';
import { editorPartDescriptor, EditorPart } from '../parts/editorPart.js';
import { auxiliaryBarPartDescriptor } from '../parts/auxiliaryBarPart.js';
import { panelPartDescriptor } from '../parts/panelPart.js';
import { statusBarPartDescriptor, StatusBarPart, StatusBarAlignment } from '../parts/statusBarPart.js';

// Layout
import { Grid } from '../layout/grid.js';
import { Orientation } from '../layout/layoutTypes.js';
import { IGridView } from '../layout/gridView.js';
import { LayoutRenderer } from '../layout/layoutRenderer.js';

// Storage + Persistence
import { LocalStorage, NamespacedStorage, IStorage } from '../platform/storage.js';
import { LayoutPersistence } from '../layout/layoutPersistence.js';

// Workspace
import { Workspace } from '../workspace/workspace.js';
import { WorkspaceLoader } from '../workspace/workspaceLoader.js';
import { WorkspaceSaver, WorkspaceStateSources } from '../workspace/workspaceSaver.js';
import {
  WorkspaceState,
  SerializedContextSnapshot,
  createDefaultContextSnapshot,
  createDefaultEditorSnapshot,
  workspaceStorageKey,
  RecentWorkspaceEntry,
  RECENT_WORKSPACES_KEY,
  DEFAULT_MAX_RECENT_WORKSPACES,
} from '../workspace/workspaceTypes.js';
import { createDefaultLayoutState, SerializedLayoutState } from '../layout/layoutModel.js';

// Commands
import { CommandService } from '../commands/commandRegistry.js';
import { registerBuiltinCommands, ALL_BUILTIN_COMMANDS } from '../commands/structuralCommands.js';
import { QuickAccessWidget } from '../commands/quickAccess.js';

// Context (Capability 8)
import { ContextKeyService } from '../context/contextKey.js';
import { FocusTracker } from '../context/focusTracker.js';
import {
  WorkbenchContextManager,
  CTX_SIDEBAR_VISIBLE,
  CTX_PANEL_VISIBLE,
  CTX_AUXILIARY_BAR_VISIBLE,
  CTX_STATUS_BAR_VISIBLE,
} from '../context/workbenchContext.js';

// Editor services (Capability 9)
import { EditorService } from '../services/editorService.js';
import { EditorGroupService } from '../services/editorGroupService.js';
import type { IEditorInput } from '../editor/editorInput.js';

// Service facades (Capability 0 gap cleanup)
import { LayoutService } from '../services/layoutService.js';
import { ViewService } from '../services/viewService.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { WindowService } from '../services/windowService.js';
import { ContextMenu } from '../ui/contextMenu.js';

// Views
import { ViewManager } from '../views/viewManager.js';
import { ViewContainer } from '../views/viewContainer.js';
import { allPlaceholderViewDescriptors, allAuxiliaryBarViewDescriptors } from '../views/placeholderViews.js';
import { AuxiliaryBarPart } from '../parts/auxiliaryBarPart.js';

// DnD
import { DragAndDropController } from '../dnd/dragAndDrop.js';
import { DropResult } from '../dnd/dndTypes.js';

// Tool Lifecycle (M2 Capability 3)
import { ToolActivator, ToolStorageDependencies } from '../tools/toolActivator.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { ActivationEventService } from '../tools/activationEventService.js';
import { ToolErrorService } from '../tools/toolErrorIsolation.js';

// Configuration (M2 Capability 4)
import type { ConfigurationService } from '../configuration/configurationService.js';
import type { ConfigurationRegistry } from '../configuration/configurationRegistry.js';

// Contribution Processors (M2 Capability 5)
import { registerContributionProcessors, registerViewContributionProcessor } from './workbenchServices.js';
import type { CommandContributionProcessor } from '../contributions/commandContribution.js';
import type { KeybindingContributionProcessor } from '../contributions/keybindingContribution.js';
import type { MenuContributionProcessor } from '../contributions/menuContribution.js';

// Keybinding Service (M3 Capability 0.3)
import type { KeybindingService } from '../services/keybindingService.js';

// View Contribution (M2 Capability 6)
import { ViewContributionProcessor } from '../contributions/viewContribution.js';
import type { IContributedContainer, IContributedView } from '../contributions/viewContribution.js';

// Built-in Tools (M2 Capability 7)
import * as ExplorerTool from '../built-in/explorer/main.js';
import * as WelcomeTool from '../built-in/welcome/main.js';
import * as OutputTool from '../built-in/output/main.js';
import * as ToolGalleryTool from '../built-in/tool-gallery/main.js';
import * as FileEditorTool from '../built-in/editor/main.js';
import type { IToolManifest, IToolDescription } from '../tools/toolManifest.js';

// File Editor Resolver (M4 Capability 4)
import { registerEditorPaneFactory } from '../editor/editorPane.js';
import { setFileEditorResolver } from '../api/bridges/editorsBridge.js';
import { FileEditorInput } from '../built-in/editor/fileEditorInput.js';
import { UntitledEditorInput } from '../built-in/editor/untitledEditorInput.js';
import { TextEditorPane } from '../built-in/editor/textEditorPane.js';
// ── Layout constants ──

const TITLE_HEIGHT = 30;
const STATUS_HEIGHT = 22;
const ACTIVITY_BAR_WIDTH = 48;
const DEFAULT_SIDEBAR_WIDTH = 202;
const DEFAULT_PANEL_HEIGHT = 200;
const DEFAULT_AUX_BAR_WIDTH = 250;
const MIN_EDITOR_WIDTH = 200;

// ── Types ──

export enum WorkbenchState {
  Created = 'created',
  Initializing = 'initializing',
  Ready = 'ready',
  ShuttingDown = 'shuttingDown',
  Disposed = 'disposed',
}

/**
 * Root workbench shell. Creates and owns all subsystems.
 */
export class Workbench extends Disposable {
  private _state: WorkbenchState = WorkbenchState.Created;
  private readonly _services: ServiceCollection;
  private _lifecycle: LifecycleService | undefined;

  // ── Subsystem instances ──

  private _partRegistry!: PartRegistry;
  private _viewManager!: ViewManager;
  private _dndController!: DragAndDropController;
  private _hGrid!: Grid;
  private _vGrid!: Grid;
  private _editorColumnAdapter!: IGridView & { element: HTMLElement };
  private _bodyRow!: HTMLElement;
  private _sidebarContainer!: ViewContainer;
  private _panelContainer!: ViewContainer;
  private _auxBarContainer!: ViewContainer;
  private _secondaryActivityBarEl!: HTMLElement;
  private _auxBarVisible = false;

  // Storage + Persistence
  private _storage!: IStorage;
  private _persistence!: LayoutPersistence;
  private _layoutRenderer!: LayoutRenderer;

  // Workspace
  private _workspace!: Workspace;
  private _workspaceLoader!: WorkspaceLoader;
  private _workspaceSaver!: WorkspaceSaver;
  private _saverListeners: IDisposable[] = [];
  private _restoredState: WorkspaceState | undefined;

  // Part refs (cached after creation)
  private _titlebar!: TitlebarPart;
  private _activityBarPart!: ActivityBarPart;
  private _sidebar!: Part;
  private _editor!: Part;
  private _auxiliaryBar!: Part;
  private _panel!: Part;
  private _statusBar!: Part;

  // Context (Capability 8)
  private _contextKeyService!: ContextKeyService;
  private _focusTracker!: FocusTracker;
  private _workbenchContext!: WorkbenchContextManager;

  // Tool Lifecycle (M2 Capability 3)
  private _toolActivator!: ToolActivator;

  // Configuration (M2 Capability 4)
  private _configService!: ConfigurationService;
  private _configRegistry!: ConfigurationRegistry;
  private _globalStorage!: IStorage;

  // Contribution Processors (M2 Capability 5)
  private _commandContribution!: CommandContributionProcessor;
  private _keybindingContribution!: KeybindingContributionProcessor;
  private _menuContribution!: MenuContributionProcessor;

  // View Contribution (M2 Capability 6)
  private _viewContribution!: ViewContributionProcessor;
  /** Disposable store for view contribution event listeners (cleared on workspace switch). */
  private readonly _viewContribListeners = this._register(new DisposableStore());
  /** Built-in sidebar containers keyed by activity-bar icon ID (e.g. 'view.explorer'). */
  private _builtinSidebarContainers = new Map<string, ViewContainer>();
  /** Tool-contributed sidebar containers (keyed by container ID). */
  private _contributedSidebarContainers = new Map<string, ViewContainer>();
  /** Tool-contributed panel containers (keyed by container ID). */
  private _contributedPanelContainers = new Map<string, ViewContainer>();
  /** Tool-contributed auxiliary bar containers (keyed by container ID). */
  private _contributedAuxBarContainers = new Map<string, ViewContainer>();
  /** Which sidebar container is currently active: undefined = built-in default. */
  private _activeSidebarContainerId: string | undefined;
  /** Header label element for the sidebar. */
  private _sidebarHeaderLabel: HTMLElement | undefined;

  /** Last known sidebar width — used to restore on toggle / persist across sessions. */
  private _lastSidebarWidth: number = DEFAULT_SIDEBAR_WIDTH;
  /** Last known panel height — used to restore on toggle / persist across sessions. */
  private _lastPanelHeight: number = DEFAULT_PANEL_HEIGHT;
  /** Whether the panel is currently maximized (occupying all vertical space). */
  private _panelMaximized = false;
  /** MutationObservers for tab drag wiring (disconnected on teardown). */
  private _tabObservers: MutationObserver[] = [];

  // ── Events ──

  private readonly _onDidChangeState = this._register(new Emitter<WorkbenchState>());
  readonly onDidChangeState: Event<WorkbenchState> = this._onDidChangeState.event;

  private readonly _onDidInitialize = this._register(new Emitter<void>());
  readonly onDidInitialize: Event<void> = this._onDidInitialize.event;

  private readonly _onWillShutdown = this._register(new Emitter<void>());
  readonly onWillShutdown: Event<void> = this._onWillShutdown.event;

  private readonly _onDidShutdown = this._register(new Emitter<void>());
  readonly onDidShutdown: Event<void> = this._onDidShutdown.event;

  private readonly _onDidSwitchWorkspace = this._register(new Emitter<Workspace>());
  readonly onDidSwitchWorkspace: Event<Workspace> = this._onDidSwitchWorkspace.event;

  // Recent workspaces manager (initialized in Phase 1)
  private _recentWorkspaces!: RecentWorkspaces;

  constructor(
    private readonly _container: HTMLElement,
    services?: ServiceCollection,
  ) {
    super();
    this._services = services ?? new ServiceCollection();
    this._register(this._services);
  }

  // ── Public API ──

  get state(): WorkbenchState { return this._state; }
  get services(): ServiceCollection { return this._services; }
  get container(): HTMLElement { return this._container; }

  /**
   * Toggle visibility of the auxiliary bar (secondary sidebar).
   * When shown, it appears on the right side of the editor area.
   */
  toggleAuxiliaryBar(): void {
    if (this._auxBarVisible) {
      // Hide: remove from hGrid
      this._hGrid.removeView(this._auxiliaryBar.id);
      this._auxiliaryBar.setVisible(false);
      this._secondaryActivityBarEl.classList.add('hidden');
      this._auxBarVisible = false;
    } else {
      // Show: add to hGrid at the end (right of editor column)
      this._auxiliaryBar.setVisible(true);
      this._hGrid.addView(this._auxiliaryBar, DEFAULT_AUX_BAR_WIDTH);
      this._secondaryActivityBarEl.classList.remove('hidden');
      this._auxBarVisible = true;

      // Ensure the aux bar content is populated
      if (!this._auxBarContainer) {
        this._auxBarContainer = this._setupAuxBarViews();
      }
    }
    this._hGrid.layout();
    this._layoutViewContainers();
  }

  /**
   * Toggle the command palette overlay (M3 Capability 0.3).
   * Exposed as a public method so the 'workbench.action.showCommands' command handler can call it.
   */
  toggleCommandPalette(): void {
    if (this._commandPalette) {
      this._commandPalette.toggle();
    }
  }

  /**
   * Open Quick Access in general mode (no prefix).
   * VS Code parity: `workbench.action.quickOpen` (Ctrl+P).
   */
  showQuickOpen(): void {
    if (this._commandPalette) {
      this._commandPalette.show('');
    }
  }

  // ── Focus Model (Cap 8) ────────────────────────────────────────────────

  /**
   * Programmatically move keyboard focus to a part.
   * VS Code parity: `layout.ts#focusPart()` dispatches to each part's focus method.
   * Parallx delegates to FocusTracker.focusPart() which finds the part's DOM element
   * via `data-part-id` and focuses the first focusable child or restores previous focus.
   */
  focusPart(partId: string): void {
    this._focusTracker?.focusPart(partId);
  }

  /**
   * Check whether a given part currently has keyboard focus.
   * VS Code parity: `layout.ts#hasFocus()` checks if activeElement is
   * an ancestor of the part container.
   */
  hasFocus(partId: string): boolean {
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl) return false;
    const partEl = this._container.querySelector(`[data-part-id="${partId}"]`) as HTMLElement | null;
    if (!partEl) return false;
    return partEl.contains(activeEl);
  }

  /**
   * The currently active workspace.
   */
  get workspace(): Workspace { return this._workspace; }

  /**
   * Create a brand-new workspace and optionally switch to it.
   */
  async createWorkspace(name: string, path?: string, switchTo = true): Promise<Workspace> {
    const ws = Workspace.create(name, path);

    // Persist it immediately so it has an entry in storage
    const state = ws.createDefaultState(
      this._container.clientWidth,
      this._container.clientHeight,
    );
    const key = workspaceStorageKey(ws.id);
    await this._storage.set(key, JSON.stringify(state));

    // Add to recent list
    await this._recentWorkspaces.add(ws);

    if (switchTo) {
      await this.switchWorkspace(ws.id);
    }

    return ws;
  }

  /**
   * Switch to a different workspace by ID.
   *
   * Flow:
   *   1. Save current workspace state
   *   2. Show transition overlay
   *   3. Tear down DOM content (views, containers, DnD, grids)
   *   4. Load new workspace state
   *   5. Rebuild layout and parts
   *   6. Apply restored state
   *   7. Configure saver
   *   8. Remove overlay
   */
  async switchWorkspace(targetId: string): Promise<void> {
    if (this._state !== WorkbenchState.Ready) {
      console.warn('[Workbench] Cannot switch workspace while in state:', this._state);
      return;
    }
    if ((this as any)._switching) {
      console.warn('[Workbench] Workspace switch already in progress — ignoring');
      return;
    }
    if (this._workspace && this._workspace.id === targetId) {
      console.log('[Workbench] Already on workspace %s — no-op', targetId);
      return;
    }

    (this as any)._switching = true;
    console.log('[Workbench] Switching workspace → %s', targetId);
    const overlay = this._showTransitionOverlay();

    try {
      // 1. Save current workspace
      await this._workspaceSaver.save();

      // 2. Tear down current workspace content (views, containers, DnD)
      this._teardownWorkspaceContent();

      // 3. Load target workspace state
      const w = this._container.clientWidth;
      const h = this._container.clientHeight;
      const savedState = await this._workspaceLoader.loadById(targetId, w, h);

      if (savedState) {
        this._workspace = Workspace.fromSerialized(savedState.identity, savedState.metadata);
        this._restoredState = savedState;
      } else {
        // No saved state — create a fresh workspace identity
        this._workspace = Workspace.create('Workspace');
        this._restoredState = undefined;
      }

      // 4. Rebuild views, containers, DnD inside existing layout
      this._rebuildWorkspaceContent();

      // 5. Apply restored state
      this._applyRestoredState();

      // 5b. Restore workspace folders from saved state
      if (this._restoredState?.folders) {
        this._workspace.restoreFolders(this._restoredState.folders);
      }

      // 6. Re-configure the saver for the new workspace
      this._configureSaver();

      // 7. Update recent workspaces and active ID
      await this._recentWorkspaces.add(this._workspace);
      await this._workspaceLoader.setActiveWorkspaceId(this._workspace.id);

      // 8. Notify
      this._onDidSwitchWorkspace.fire(this._workspace);

      console.log('[Workbench] Switched to workspace "%s"', this._workspace.name);
    } catch (err) {
      console.error('[Workbench] Workspace switch failed:', err);
    } finally {
      (this as any)._switching = false;
      this._removeTransitionOverlay(overlay);
    }
  }

  /**
   * Get the recent workspaces list.
   */
  async getRecentWorkspaces(): Promise<readonly import('../workspace/workspaceTypes.js').RecentWorkspaceEntry[]> {
    return this._recentWorkspaces.getAll();
  }

  /**
   * Remove a workspace from the recent list.
   */
  async removeRecentWorkspace(workspaceId: string): Promise<void> {
    await this._recentWorkspaces.remove(workspaceId);
  }

  async initialize(): Promise<void> {
    if (this._state !== WorkbenchState.Created) {
      throw new Error(`Workbench cannot be initialized from state: ${this._state}`);
    }

    this._setState(WorkbenchState.Initializing);

    // Phase 1 prep: register all services into the DI container
    this._registerServices();

    // Retrieve lifecycle service for phased init
    this._lifecycle = this._services.get(ILifecycleService) as LifecycleService;

    // Register hooks for phases 1→5
    this._registerLifecycleHooks();

    // Execute all startup phases
    await this._lifecycle.startup();

    this._setState(WorkbenchState.Ready);
    this._onDidInitialize.fire();
  }

  async shutdown(): Promise<void> {
    if (this._state === WorkbenchState.Disposed || this._state === WorkbenchState.ShuttingDown) {
      return;
    }

    this._onWillShutdown.fire();
    this._setState(WorkbenchState.ShuttingDown);

    if (this._lifecycle) {
      await this._lifecycle.teardown();
    }

    // Remove window resize listener
    window.removeEventListener('resize', this._onWindowResize);

    // Fire onDidShutdown BEFORE dispose() so listeners can still receive it
    this._onDidShutdown.fire();

    this.dispose();
    this._setState(WorkbenchState.Disposed);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 1 — Services
  // ════════════════════════════════════════════════════════════════════════

  private _registerServices(): void {
    registerWorkbenchServices(this._services);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Lifecycle hook registration
  // ════════════════════════════════════════════════════════════════════════

  private _registerLifecycleHooks(): void {
    const lc = this._lifecycle!;

    // Phase 1: Services — create storage + persistence
    lc.onStartup(LifecyclePhase.Services, () => {
      this._initializeServices();
    });

    // Phase 2: Layout — build grids, assemble DOM
    lc.onStartup(LifecyclePhase.Layout, () => {
      this._initializeLayout();
    });

    // Phase 3: Parts — populate titlebar, views, status bar, DnD
    lc.onStartup(LifecyclePhase.Parts, () => {
      this._initializeParts();
    });

    // Phase 4: Workspace Restore — attempt to load saved state
    lc.onStartup(LifecyclePhase.WorkspaceRestore, async () => {
      await this._restoreWorkspace();
    });

    // Phase 5: Ready — CSS hooks + tool lifecycle initialization
    lc.onStartup(LifecyclePhase.Ready, async () => {
      this._container.classList.add('parallx-workbench');
      this._container.classList.add('parallx-ready');

      // Initialize tool activator and fire startup finished
      await this._initializeToolLifecycle();
    });

    // ── Teardown (5→1) ──

    lc.onTeardown(LifecyclePhase.Ready, async () => {
      this._container.classList.remove('parallx-ready');
      // Deactivate all tools before teardown
      if (this._toolActivator) {
        await this._toolActivator.deactivateAll();
      }
    });

    lc.onTeardown(LifecyclePhase.WorkspaceRestore, async () => {
      // Save current layout dimensions via persistence
      await this._saveLayoutState();
    });

    lc.onTeardown(LifecyclePhase.Parts, () => {
      this._dndController?.dispose();
      this._viewManager?.dispose();
      this._workspaceSaver?.dispose();
      this._focusTracker?.dispose();
      this._workbenchContext?.dispose();
    });

    lc.onTeardown(LifecyclePhase.Layout, () => {
      this._editorColumnAdapter?.dispose();
      this._hGrid?.dispose();
      this._vGrid?.dispose();
      this._partRegistry?.dispose();
      this._layoutRenderer?.dispose();
    });

    lc.onTeardown(LifecyclePhase.Services, () => {
      // Dispose configuration system (Cap 4)
      this._configService?.dispose();
      this._configRegistry?.dispose();
      // ServiceCollection.dispose() handled by Workbench.dispose()
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 1 — Initialize storage + persistence + layout renderer
  // ════════════════════════════════════════════════════════════════════════

  private _initializeServices(): void {
    // Storage: namespaced localStorage wrapper
    const rawStorage = new LocalStorage();
    this._storage = new NamespacedStorage(rawStorage, 'parallx');

    // Global storage: separate namespace for tool global state (persists across workspaces)
    this._globalStorage = new NamespacedStorage(rawStorage, 'parallx-global');

    // Layout persistence: save/load layout state via storage
    this._persistence = new LayoutPersistence(this._storage);

    // Layout renderer: available for future serialized-state rendering
    this._layoutRenderer = this._register(new LayoutRenderer(this._container));

    // Workspace persistence
    this._workspaceLoader = new WorkspaceLoader(this._storage);
    this._workspaceSaver = this._register(new WorkspaceSaver(this._storage));

    // Create or identify the current workspace
    this._workspace = Workspace.create('Default Workspace');

    // Recent workspaces manager
    this._recentWorkspaces = new RecentWorkspaces(this._storage);

    // Configuration system (M2 Capability 4)
    const { configService, configRegistry } = registerConfigurationServices(
      this._services,
      this._storage,
    );
    this._configService = configService;
    this._configRegistry = configRegistry;

    // Window service — abstracts Electron IPC for window controls
    const windowService = this._register(new WindowService());
    this._services.registerInstance(IWindowService, windowService);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2 — Layout: create parts, build grids, assemble DOM
  // ════════════════════════════════════════════════════════════════════════

  private _initializeLayout(): void {
    // 1. Create part registry and register all standard parts
    this._partRegistry = this._register(new PartRegistry());
    this._partRegistry.registerMany([
      titlebarPartDescriptor,
      activityBarPartDescriptor,
      sidebarPartDescriptor,
      editorPartDescriptor,
      auxiliaryBarPartDescriptor,
      panelPartDescriptor,
      statusBarPartDescriptor,
    ]);
    this._partRegistry.createAll();

    // 2. Cache part references
    this._titlebar = this._partRegistry.requirePart(PartId.Titlebar) as TitlebarPart;
    this._activityBarPart = this._partRegistry.requirePart(PartId.ActivityBar) as ActivityBarPart;
    this._sidebar = this._partRegistry.requirePart(PartId.Sidebar) as Part;
    this._editor = this._partRegistry.requirePart(PartId.Editor) as Part;
    this._auxiliaryBar = this._partRegistry.requirePart(PartId.AuxiliaryBar) as Part;
    this._panel = this._partRegistry.requirePart(PartId.Panel) as Part;
    this._statusBar = this._partRegistry.requirePart(PartId.StatusBar) as Part;

    // 2b. Inject services that parts need before create() — IWindowService for titlebar
    this._titlebar.setWindowService(this._services.get(IWindowService));

    // 3. Compute initial dimensions
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    const bodyH = h - TITLE_HEIGHT - STATUS_HEIGHT;
    const sidebarW = this._sidebar.visible ? this._lastSidebarWidth : 0;
    const auxBarW = this._auxiliaryBar.visible ? DEFAULT_AUX_BAR_WIDTH : 0;
    const panelH = this._panel.visible ? DEFAULT_PANEL_HEIGHT : 0;
    const editorAreaW = Math.max(MIN_EDITOR_WIDTH, w - ACTIVITY_BAR_WIDTH - sidebarW - auxBarW - 4);
    const editorH = bodyH - panelH - (this._panel.visible ? 4 : 0);

    // 4. Create parts into temporary container so their elements exist
    const tempDiv = document.createElement('div');
    tempDiv.classList.add('hidden');
    document.body.appendChild(tempDiv);

    this._titlebar.create(tempDiv);
    this._activityBarPart.create(tempDiv);
    this._sidebar.create(tempDiv);
    this._editor.create(tempDiv);
    this._auxiliaryBar.create(tempDiv);
    this._panel.create(tempDiv);
    this._statusBar.create(tempDiv);

    // 5. Vertical grid: editor | panel (stacked in the right column)
    this._vGrid = new Grid(Orientation.Vertical, editorAreaW, bodyH);
    this._vGrid.addView(this._editor, editorH);
    if (this._panel.visible) {
      this._vGrid.addView(this._panel, panelH);
    }
    this._vGrid.layout();

    // 6. Wrap vGrid in adapter so hGrid can manage it as a leaf
    this._editorColumnAdapter = this._createEditorColumnAdapter(this._vGrid);

    // 7. Horizontal grid: sidebar | editorColumn
    const hGridW = w - ACTIVITY_BAR_WIDTH;
    this._hGrid = new Grid(Orientation.Horizontal, hGridW, bodyH);
    if (this._sidebar.visible) {
      this._hGrid.addView(this._sidebar, sidebarW);
    }
    this._hGrid.addView(this._editorColumnAdapter, editorAreaW);
    if (this._auxiliaryBar.visible) {
      this._hGrid.addView(this._auxiliaryBar, auxBarW);
    }
    this._hGrid.layout();

    // 8. Body row: activityBar (Part) + hGrid
    this._bodyRow = document.createElement('div');
    this._bodyRow.classList.add('workbench-middle');

    // Mount the ActivityBarPart (M3 Capability 0.2) — replaces ad-hoc div.activity-bar
    this._bodyRow.appendChild(this._activityBarPart.element);
    this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, bodyH, Orientation.Vertical);

    // Hide the sidebar's internal activity bar slot (now owned by ActivityBarPart)
    // CSS .sidebar-activity-bar already sets display:none

    this._bodyRow.appendChild(this._hGrid.element);
    this._hGrid.element.classList.add('workbench-hgrid');

    this._editorColumnAdapter.element.appendChild(this._vGrid.element);
    this._vGrid.element.classList.add('workbench-vgrid');

    // 9. Assemble final DOM
    this._container.appendChild(this._titlebar.element);
    this._titlebar.layout(w, TITLE_HEIGHT, Orientation.Horizontal);

    this._container.appendChild(this._bodyRow);
    // .workbench-middle CSS already sets flex: 1 1 0 and min-height: 0

    this._container.appendChild(this._statusBar.element);
    this._statusBar.layout(w, STATUS_HEIGHT, Orientation.Horizontal);

    tempDiv.remove();

    // 10. Initialize sash drag on both grids
    this._hGrid.initializeSashDrag();
    this._vGrid.initializeSashDrag();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 3 — Parts: populate content, views, DnD, status bar
  // ════════════════════════════════════════════════════════════════════════

  private _initializeParts(): void {
    // 1. Titlebar: app icon + menu bar + window controls
    this._setupTitlebar();

    // 2. View system — register ALL descriptors before creating any views
    this._viewManager = new ViewManager();
    this._viewManager.registerMany(allPlaceholderViewDescriptors);
    this._viewManager.registerMany(allAuxiliaryBarViewDescriptors);

    this._sidebarContainer = this._setupSidebarViews();
    this._panelContainer = this._setupPanelViews();
    this._auxBarContainer = this._setupAuxBarViews();

    // 2b. Secondary activity bar (right edge, for aux bar views)
    this._setupSecondaryActivityBar();

    // 3. Editor watermark
    this._setupEditorWatermark();

    // 3b. Register editor services (EditorPart exists after Phase 2)
    this._registerEditorServices();

    // 3c. Register facade services (grids, ViewManager, workspace exist)
    this._registerFacadeServices();

    // 4. Status bar entries
    this._setupStatusBar();

    // 4b. Toggle aux bar button in activity bar (bottom)
    this._addAuxBarToggle();

    // 5. DnD between parts
    this._dndController = this._setupDragAndDrop();

    // 6. Layout view containers
    this._layoutViewContainers();

    // 7. React to sash-drag grid changes
    this._hGrid.onDidChange(() => this._layoutViewContainers());
    this._vGrid.onDidChange(() => this._layoutViewContainers());

    // 7a. Track sidebar width after sash drags so toggleSidebar() restores the right size
    this._hGrid.onDidChange(() => {
      if (this._sidebar.visible) {
        const w = this._hGrid.getViewSize(this._sidebar.id);
        if (w !== undefined && w > 0) {
          this._lastSidebarWidth = w;
        }
      }
    });

    // 7b. Double-click sash resets sidebar to default width (VS Code parity: Sash.onDidReset)
    this._hGrid.onDidSashReset(({ sashIndex }) => {
      if (sashIndex === 0 && this._sidebar.visible) {
        const currentWidth = this._hGrid.getViewSize(this._sidebar.id);
        if (currentWidth !== undefined) {
          const delta = DEFAULT_SIDEBAR_WIDTH - currentWidth;
          if (delta !== 0) {
            this._hGrid.resizeSash(this._hGrid.root, 0, delta);
            this._hGrid.layout();
            this._lastSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
          }
        }
      }
    });

    // 7c. Track panel height after sash drags so togglePanel() restores the right size
    //     Also reset _panelMaximized if user manually drags sash while maximized
    //     (VS Code parity: isPanelMaximized() is derived from editor visibility,
    //      so it auto-corrects; our boolean flag needs explicit reset)
    this._vGrid.onDidChange(() => {
      if (this._panel.visible) {
        if (this._panelMaximized) {
          // Any manual sash drag while maximized exits the maximized state
          this._panelMaximized = false;
          this._workbenchContext.setPanelMaximized(false);
        }
        const h = this._vGrid.getViewSize(this._panel.id);
        if (h !== undefined && h > 0) {
          this._lastPanelHeight = h;
        }
      }
    });

    // 7d. Double-click sash resets panel to default height (VS Code parity: Sash.onDidReset)
    this._vGrid.onDidSashReset(({ sashIndex }) => {
      if (sashIndex === 0 && this._panel.visible) {
        const currentHeight = this._vGrid.getViewSize(this._panel.id);
        if (currentHeight !== undefined) {
          const delta = DEFAULT_PANEL_HEIGHT - currentHeight;
          if (delta !== 0) {
            this._vGrid.resizeSash(this._vGrid.root, 0, delta);
            this._vGrid.layout();
            this._lastPanelHeight = DEFAULT_PANEL_HEIGHT;
            this._panelMaximized = false;
            this._workbenchContext.setPanelMaximized(false);
          }
        }
      }
    });

    // 8. Window resize handler
    window.addEventListener('resize', this._onWindowResize);

    // 9. Command system: wire up and register built-in commands
    this._initializeCommands();

    // 10. Context system (Capability 8): context keys, focus tracking, when-clause evaluation
    this._initializeContext();

    // 11. Wire view/title actions and context menus to stacked containers
    for (const vc of this._builtinSidebarContainers.values()) {
      this._wireSectionMenus(vc);
    }
  }

  /**
   * Initialize the command system: set workbench ref, register all builtin commands,
   * and create the command palette UI.
   */
  private _commandPalette: QuickAccessWidget | undefined;
  private _initializeCommands(): void {
    const cmdService = this._services.get(ICommandService) as CommandService;
    cmdService.setWorkbench(this);
    this._register(registerBuiltinCommands(cmdService));

    // Quick Access — unified overlay for commands + workspace switching
    this._commandPalette = new QuickAccessWidget(cmdService, this._container);
    this._register(this._commandPalette);

    console.log(
      '[Workbench] Registered %d built-in commands, command palette ready',
      cmdService.getCommands().size,
    );
  }

  /**
   * Initialize the context key system (Capability 8):
   *  1. Retrieve ContextKeyService from DI
   *  2. Wire CommandService to use real when-clause evaluation
   *  3. Create FocusTracker
   *  4. Create WorkbenchContextManager and wire all part visibility + view tracking
   */
  private _initializeContext(): void {
    // 1. Get context key service from DI
    this._contextKeyService = this._services.get(IContextKeyService) as ContextKeyService;

    // 2. Wire the CommandService to evaluate when-clauses via the context key service
    const cmdService = this._services.get(ICommandService) as CommandService;
    cmdService.setContextKeyService(this._contextKeyService);

    // 3. Focus tracker — monitors DOM focusin/focusout and updates context
    this._focusTracker = this._register(new FocusTracker(this._container, this._contextKeyService));

    // 4. Workbench context manager — standard context keys for structure
    this._workbenchContext = this._register(
      new WorkbenchContextManager(this._contextKeyService, this._focusTracker),
    );

    // 5. Track part visibility
    this._workbenchContext.trackPartVisibility(this._sidebar, CTX_SIDEBAR_VISIBLE);
    this._workbenchContext.trackPartVisibility(this._panel, CTX_PANEL_VISIBLE);
    this._workbenchContext.trackPartVisibility(this._auxiliaryBar, CTX_AUXILIARY_BAR_VISIBLE);
    this._workbenchContext.trackPartVisibility(this._statusBar, CTX_STATUS_BAR_VISIBLE);

    // 6. Track view manager active view
    this._workbenchContext.trackViewManager(this._viewManager);

    // 7. Initial editor group state (Capability 9 will update these dynamically)
    this._workbenchContext.setEditorGroupCount(1);

    // 8. Wire the command palette's when-clause filtering & focus trapping
    if (this._commandPalette) {
      this._commandPalette.setContextKeyService(this._contextKeyService);
      if (this._focusTracker) {
        this._commandPalette.setFocusTracker(this._focusTracker);
      }
    }

    console.log('[Workbench] Context key system initialized (%d context keys)', this._contextKeyService.getAllContext().size);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 4 — Workspace Restore
  // ════════════════════════════════════════════════════════════════════════

  private async _restoreWorkspace(): Promise<void> {
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;

    // Try to load the last-active workspace ID
    const activeId = await this._workspaceLoader.getActiveWorkspaceId();
    if (activeId) {
      const savedState = await this._workspaceLoader.loadById(activeId, w, h);
      if (savedState) {
        // Re-create workspace identity from saved state
        this._workspace = Workspace.fromSerialized(savedState.identity, savedState.metadata);
        this._restoredState = savedState;
        console.log('[Workbench] Loaded workspace "%s" (v%d)', savedState.identity.name, savedState.version);
      } else {
        console.log('[Workbench] No valid saved state for workspace %s — using defaults', activeId);
      }
    } else {
      console.log('[Workbench] No active workspace ID — using defaults');
    }

    // Apply restored state to live parts, views, and containers
    this._applyRestoredState();

    // Restore workspace folders from saved state
    if (this._restoredState?.folders) {
      this._workspace.restoreFolders(this._restoredState.folders);
    }

    // Configure the saver with live sources so subsequent saves capture real state
    this._configureSaver();

    // Track as recent + persist active workspace ID
    await this._recentWorkspaces.add(this._workspace);
    await this._workspaceLoader.setActiveWorkspaceId(this._workspace.id);

    // Update context keys for workspace state
    if (this._workbenchContext) {
      this._workbenchContext.setWorkspaceLoaded(true);

      const folderCount = this._workspace.folders.length;
      this._workbenchContext.setWorkspaceFolderCount(folderCount);
      this._workbenchContext.setWorkbenchState(
        folderCount === 0 ? 'empty' : 'folder',
      );

      // Subscribe to folder changes for live context key updates
      this._register(this._workspace.onDidChangeFolders(() => {
        const count = this._workspace.folders.length;
        this._workbenchContext.setWorkspaceFolderCount(count);
        this._workbenchContext.setWorkbenchState(
          count === 0 ? 'empty' : 'folder',
        );
        this._updateWindowTitle();
      }));
    }

    // Load persisted configuration values (Cap 4)
    if (this._configService) {
      await this._configService.load();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Teardown helper — save current layout
  // ════════════════════════════════════════════════════════════════════════

  private async _saveLayoutState(): Promise<void> {
    try {
      await this._workspaceSaver.save();
    } catch (err) {
      console.error('[Workbench] Failed to save workspace state:', err);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Apply restored workspace state to live subsystems
  // ════════════════════════════════════════════════════════════════════════

  private _applyRestoredState(): void {
    const state = this._restoredState;
    if (!state) return;

    // 1. Restore part visibility and sizes
    for (const partSnap of state.parts) {
      const part = this._partRegistry.getPart(partSnap.partId) as Part | undefined;
      if (!part) continue;

      // Restore visibility
      if (part.visible !== partSnap.visible) {
        // Special handling for aux bar — use the toggle mechanism
        if (partSnap.partId === PartId.AuxiliaryBar) {
          if (partSnap.visible && !this._auxBarVisible) {
            this.toggleAuxiliaryBar();
          } else if (!partSnap.visible && this._auxBarVisible) {
            this.toggleAuxiliaryBar();
          }
        } else {
          part.setVisible(partSnap.visible);
        }
      }

      // Restore part-specific data
      if (partSnap.data) {
        part.restoreState({
          id: partSnap.partId,
          visible: partSnap.visible,
          width: partSnap.width,
          height: partSnap.height,
          position: part.position,
          data: partSnap.data,
        });
      }
    }

    // 1b. Restore sidebar width — resize grid node to match the saved width
    const sidebarSnap = state.parts.find(p => p.partId === PartId.Sidebar);
    if (sidebarSnap?.width && sidebarSnap.width > 0 && this._sidebar.visible) {
      this._lastSidebarWidth = sidebarSnap.width;
      const currentWidth = this._hGrid.getViewSize(this._sidebar.id);
      if (currentWidth !== undefined && currentWidth !== sidebarSnap.width) {
        const delta = sidebarSnap.width - currentWidth;
        this._hGrid.resizeSash(this._hGrid.root, 0, delta);
        this._hGrid.layout();
      }
    }

    // 1c. Restore panel height — resize vGrid node to match the saved height
    const panelSnap = state.parts.find(p => p.partId === PartId.Panel);
    if (panelSnap?.height && panelSnap.height > 0 && this._panel.visible) {
      this._lastPanelHeight = panelSnap.height;
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined && currentHeight !== panelSnap.height) {
        const delta = panelSnap.height - currentHeight;
        this._vGrid.resizeSash(this._vGrid.root, 0, delta);
        this._vGrid.layout();
      }
    }

    // 2. Restore view container states (tab order + active view)
    const containerMap = new Map<string, ViewContainer>([
      ['sidebar', this._sidebarContainer],
      ['panel', this._panelContainer],
    ]);
    // Also include all built-in sidebar containers by their IDs
    for (const [id, vc] of this._builtinSidebarContainers) {
      containerMap.set(id, vc);
    }
    if (this._auxBarContainer) {
      containerMap.set('auxiliaryBar', this._auxBarContainer);
    }

    for (const vcSnap of state.viewContainers) {
      const container = containerMap.get(vcSnap.containerId);
      if (!container) continue;

      container.restoreContainerState({
        activeViewId: vcSnap.activeViewId,
        tabOrder: vcSnap.tabOrder,
      });
    }

    // 3. Restore per-view states
    for (const viewSnap of state.views) {
      const view = this._viewManager.getView(viewSnap.viewId);
      if (view && viewSnap.state) {
        view.restoreState(viewSnap.state);
      }
    }

    // 4. Restore context (active part / focused view)
    if (state.context.focusedView) {
      const view = this._viewManager.getView(state.context.focusedView);
      if (view) {
        try { view.focus(); } catch { /* best-effort */ }
      }
    }

    console.log('[Workbench] Restored workspace state for "%s"', state.identity.name);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Configure the WorkspaceSaver with live sources
  // ════════════════════════════════════════════════════════════════════════

  private _configureSaver(): void {
    const allParts = [
      this._titlebar,
      this._sidebar,
      this._editor,
      this._auxiliaryBar,
      this._panel,
      this._statusBar,
    ];

    const allContainers: ViewContainer[] = [...this._builtinSidebarContainers.values(), this._panelContainer];
    if (this._auxBarContainer) {
      allContainers.push(this._auxBarContainer);
    }

    this._workspaceSaver.setSources({
      workspace: this._workspace,
      containerWidth: this._container.clientWidth,
      containerHeight: this._container.clientHeight,
      parts: allParts,
      viewContainers: allContainers,
      viewManager: this._viewManager,
      layoutSerializer: () => {
        return createDefaultLayoutState(this._container.clientWidth, this._container.clientHeight);
      },
      contextProvider: () => {
        return {
          activePart: undefined,
          focusedView: this._viewManager.activeViewId,
          activeEditor: undefined,
          activeEditorGroup: undefined,
        };
      },
      editorProvider: () => createDefaultEditorSnapshot(),
    });

    // Wire auto-save on structural changes (dispose old listeners first)
    for (const d of this._saverListeners) d.dispose();
    this._saverListeners = [
      this._hGrid.onDidChange(() => this._workspaceSaver.requestSave()),
      this._vGrid.onDidChange(() => this._workspaceSaver.requestSave()),
    ];
  }

  // ════════════════════════════════════════════════════════════════════════
  // Window resize handler (arrow fn keeps `this` binding)
  // ════════════════════════════════════════════════════════════════════════

  /** Public relayout entry point for commands that change part visibility. */
  _relayout(): void {
    this._onWindowResize();
  }

  private _onWindowResize = (): void => {
    const rw = this._container.clientWidth;
    const rh = this._container.clientHeight;
    const statusH = this._statusBar.visible ? STATUS_HEIGHT : 0;
    const rbodyH = rh - TITLE_HEIGHT - statusH;

    this._titlebar.layout(rw, TITLE_HEIGHT, Orientation.Horizontal);
    if (this._statusBar.visible) {
      this._statusBar.layout(rw, STATUS_HEIGHT, Orientation.Horizontal);
    }

    // Re-layout activity bar (not in hGrid, so must be done explicitly)
    this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, rbodyH, Orientation.Vertical);

    // Resize hGrid (cascades to vGrid via editorColumnAdapter)
    this._hGrid.resize(rw - ACTIVITY_BAR_WIDTH, rbodyH);

    this._layoutViewContainers();
  };

  // ════════════════════════════════════════════════════════════════════════
  // Editor Column Adapter
  // ════════════════════════════════════════════════════════════════════════

  private _createEditorColumnAdapter(vGrid: Grid): IGridView & { element: HTMLElement } {
    const wrapper = document.createElement('div');
    wrapper.classList.add('editor-column');

    const emitter = new Emitter<void>();

    return {
      element: wrapper,
      id: 'workbench.editorColumn',
      minimumWidth: MIN_EDITOR_WIDTH,
      maximumWidth: Number.POSITIVE_INFINITY,
      minimumHeight: 0,
      maximumHeight: Number.POSITIVE_INFINITY,
      layout(width: number, height: number, _orientation: Orientation): void {
        wrapper.style.width = `${width}px`;
        wrapper.style.height = `${height}px`;
        vGrid.resize(width, height);
      },
      setVisible(visible: boolean): void {
        wrapper.classList.toggle('hidden', !visible);
      },
      toJSON(): object {
        return { id: 'workbench.editorColumn', type: 'adapter' };
      },
      onDidChangeConstraints: emitter.event,
      dispose(): void {
        emitter.dispose();
      },
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Titlebar setup (M3 Capability 1 — service-wired, data-driven)
  // ════════════════════════════════════════════════════════════════════════

  private _setupTitlebar(): void {
    // Task 1.1: Wire workspace name reactively
    this._titlebar.setWorkspaceName(this._workspace.name);

    // Subscribe to workspace switches so the label updates automatically
    this._register(this._onDidSwitchWorkspace.event((ws) => {
      this._titlebar.setWorkspaceName(ws.name);
    }));

    // Task 1.2: Register default menu bar items via contribution system
    this._registerDefaultMenuBarItems();

    // Task 1.1: Clicking workspace name opens Quick Access in general mode
    this._register(this._titlebar.onDidClickWorkspaceName(() => {
      this.showQuickOpen();
    }));

    // P1.5: Window inactive state — toggle `.inactive` on titlebar when window loses/gains focus
    // VS Code dims titlebar text and window controls when the window is not focused.
    const titlebarEl = this._titlebar.element;
    const onBlur = () => titlebarEl.classList.add('inactive');
    const onFocus = () => titlebarEl.classList.remove('inactive');
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    this._register(toDisposable(() => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    }));
    // Initialise: if window is already blurred (e.g. DevTools focused), set inactive
    if (!document.hasFocus()) {
      titlebarEl.classList.add('inactive');
    }

    console.log('[Workbench] Title bar wired to services');
  }

  /**
   * Register the default (shell) menu bar items via TitlebarPart's
   * registration API. These are not hardcoded DOM — they go through
   * the same registration path that tools can use.
   */
  private _registerDefaultMenuBarItems(): void {
    const defaultMenus = [
      { id: 'file', label: 'File', order: 10 },
      { id: 'edit', label: 'Edit', order: 20 },
      { id: 'selection', label: 'Selection', order: 30 },
      { id: 'view', label: 'View', order: 40 },
      { id: 'go', label: 'Go', order: 50 },
      { id: 'tools', label: 'Tools', order: 60 },
      { id: 'help', label: 'Help', order: 70 },
    ];

    for (const menu of defaultMenus) {
      this._register(this._titlebar.registerMenuBarItem(menu));
    }

    // Register dropdown items for View menu — delegates to structural commands
    this._register(this._titlebar.registerMenuBarDropdownItems('view', [
      { commandId: 'workbench.action.showCommands', title: 'Command Palette…', group: '1_nav', order: 1 },
      { commandId: 'workbench.action.toggleSidebar', title: 'Toggle Sidebar', group: '2_appearance', order: 1 },
      { commandId: 'workbench.action.togglePanel', title: 'Toggle Panel', group: '2_appearance', order: 2 },
      { commandId: 'workbench.action.toggleAuxiliaryBar', title: 'Toggle Auxiliary Bar', group: '2_appearance', order: 3 },
      { commandId: 'workbench.action.toggleStatusbarVisibility', title: 'Toggle Status Bar', group: '2_appearance', order: 4 },
      { commandId: 'editor.toggleWordWrap', title: 'Word Wrap', group: '3_editor', order: 1 },
    ]));

    // Register dropdown items for File menu
    this._register(this._titlebar.registerMenuBarDropdownItems('file', [
      { commandId: 'file.newTextFile', title: 'New Text File', group: '1_new', order: 1 },
      { commandId: 'file.openFile', title: 'Open File…', group: '2_open', order: 1 },
      { commandId: 'workspace.openFolder', title: 'Open Folder…', group: '2_open', order: 2 },
      { commandId: 'workspace.openRecent', title: 'Open Recent…', group: '2_open', order: 3 },
      { commandId: 'workspace.addFolder', title: 'Add Folder to Workspace…', group: '3_workspace', order: 1 },
      { commandId: 'workspace.saveAs', title: 'Save Workspace As…', group: '3_workspace', order: 2 },
      { commandId: 'workspace.duplicate', title: 'Duplicate Workspace', group: '3_workspace', order: 3 },
      { commandId: 'file.save', title: 'Save', group: '4_save', order: 1 },
      { commandId: 'file.saveAs', title: 'Save As…', group: '4_save', order: 2 },
      { commandId: 'file.saveAll', title: 'Save All', group: '4_save', order: 3 },
      { commandId: 'file.revert', title: 'Revert File', group: '5_close', order: 1 },
      { commandId: 'workbench.closeActiveEditor', title: 'Close Editor', group: '5_close', order: 2 },
      { commandId: 'workspace.closeFolder', title: 'Close Folder', group: '5_close', order: 3 },
      { commandId: 'workspace.closeWindow', title: 'Close Window', group: '5_close', order: 4 },
    ]));

    // Register dropdown items for Edit menu
    this._register(this._titlebar.registerMenuBarDropdownItems('edit', [
      { commandId: 'edit.undo', title: 'Undo', group: '1_undo', order: 1 },
      { commandId: 'edit.redo', title: 'Redo', group: '1_undo', order: 2 },
      { commandId: 'edit.cut', title: 'Cut', group: '2_clipboard', order: 1 },
      { commandId: 'edit.copy', title: 'Copy', group: '2_clipboard', order: 2 },
      { commandId: 'edit.paste', title: 'Paste', group: '2_clipboard', order: 3 },
      { commandId: 'edit.find', title: 'Find', group: '3_find', order: 1 },
      { commandId: 'edit.replace', title: 'Replace', group: '3_find', order: 2 },
    ]));

    // Register dropdown items for Go menu
    this._register(this._titlebar.registerMenuBarDropdownItems('go', [
      { commandId: 'workbench.action.quickOpen', title: 'Go to File…', group: '1_go', order: 1 },
      { commandId: 'workbench.action.showCommands', title: 'Go to Command…', group: '1_go', order: 2 },
    ]));

    // Register dropdown items for Tools menu
    this._register(this._titlebar.registerMenuBarDropdownItems('tools', [
      { commandId: 'tools.showInstalled', title: 'Tool Gallery', group: '1_tools', order: 1 },
    ]));

    // Register dropdown items for Help menu
    this._register(this._titlebar.registerMenuBarDropdownItems('help', [
      { commandId: 'welcome.openWelcome', title: 'Welcome', group: '1_welcome', order: 1 },
      { commandId: 'workbench.action.showCommands', title: 'Show All Commands', group: '2_commands', order: 1 },
    ]));

    console.log('[Workbench] Default menu bar items registered (%d menus)', defaultMenus.length);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Sidebar views
  // ════════════════════════════════════════════════════════════════════════

  private _setupSidebarViews(): ViewContainer {
    // ── VS Code parity ──────────────────────────────────────────────────
    // In VS Code each activity-bar icon maps to its *own* ViewContainer
    // that fills the entire sidebar.  Explorer, Search, Source-Control,
    // etc. are separate containers — clicking an icon *switches* which
    // container is visible rather than showing stacked sections inside a
    // single container.
    //
    // We create one ViewContainer per built-in activity-bar icon, store
    // them in `_builtinSidebarContainers`, mount all into `.sidebar-views`,
    // and show only the active one.
    // ─────────────────────────────────────────────────────────────────────

    const views = [
      { id: 'view.explorer', icon: '📁', label: 'Explorer' },
      { id: 'view.search', icon: '🔍', label: 'Search' },
    ];

    const sidebarContent = this._sidebar.element.querySelector('.sidebar-views') as HTMLElement;

    for (const v of views) {
      const vc = new ViewContainer(`sidebar.${v.id}`);
      vc.setMode('stacked');

      const view = this._viewManager.createViewSync(v.id)!;
      vc.addView(view);

      this._builtinSidebarContainers.set(v.id, vc);

      // Activity bar: register built-in icons via ActivityBarPart (M3 Capability 0.2)
      this._activityBarPart.addIcon({
        id: v.id,
        icon: v.icon,
        label: v.label,
        source: 'builtin',
      });

      // Mount into sidebar slot; only the first container is initially visible
      if (sidebarContent) {
        sidebarContent.appendChild(vc.element);
      }
    }

    // The default (first) container is the Explorer
    const defaultContainer = this._builtinSidebarContainers.get('view.explorer')!;

    // Hide all others
    for (const [id, vc] of this._builtinSidebarContainers) {
      if (id !== 'view.explorer') {
        vc.setVisible(false);
      }
    }

    // Wire icon click events to switch containers
    // VS Code reference: ViewContainerActivityAction.run()
    // - Click inactive icon → show sidebar + switch to that container
    // - Click active icon while sidebar visible → hide sidebar
    // - Click active icon while sidebar hidden → show sidebar
    this._register(this._activityBarPart.onDidClickIcon((event) => {
      const isAlreadyActive = event.iconId === this._activityBarPart.activeIconId;

      if (isAlreadyActive) {
        // Toggle sidebar visibility (VS Code parity: click active icon toggles sidebar)
        this.toggleSidebar();
        return;
      }

      // Ensure sidebar is visible
      if (!this._sidebar.visible) {
        this.toggleSidebar();
      }

      if (event.source === 'builtin') {
        // Switch to the target built-in container
        this._switchSidebarContainer(event.iconId);
      } else if (event.source === 'contributed') {
        // Switch to contributed sidebar container
        this._switchSidebarContainer(event.iconId);
      }
    }));

    // P2.7: Activity bar icon context menu
    this._register(this._activityBarPart.onDidContextMenuIcon((event) => {
      const icon = this._activityBarPart.getIcons().find((i) => i.id === event.iconId);
      ContextMenu.show({
        items: [
          { id: 'hide', label: `Hide ${icon?.label ?? 'View'}`, group: '1_visibility' },
        ],
        anchor: { x: event.x, y: event.y },
      });
    }));

    // Activate the first icon by default
    this._activityBarPart.setActiveIcon('view.explorer');
    // Track it as the active container
    this._activeSidebarContainerId = 'view.explorer';
    // Update activeViewContainer context key (Capability 2 deferred item)
    this._workbenchContext?.setActiveViewContainer('view.explorer');

    // Sidebar header label + toolbar
    // VS Code pattern: compositePart.createTitleArea() → title label (left) + actions toolbar (right)
    const headerSlot = this._sidebar.element.querySelector('.sidebar-header') as HTMLElement;
    if (headerSlot) {
      const headerLabel = document.createElement('span');
      headerLabel.classList.add('sidebar-header-label');
      headerLabel.textContent = 'EXPLORER';
      headerSlot.appendChild(headerLabel);

      // Actions toolbar on the right (VS Code: `.title-actions` inside `.composite.title`)
      const actionsContainer = document.createElement('div');
      actionsContainer.classList.add('sidebar-header-actions');

      // "More actions" button (ellipsis)
      const moreBtn = document.createElement('button');
      moreBtn.classList.add('sidebar-header-action-btn');
      moreBtn.title = 'More Actions…';
      moreBtn.setAttribute('aria-label', 'More Actions…');
      moreBtn.textContent = '⋯';
      moreBtn.addEventListener('click', (e) => {
        const rect = moreBtn.getBoundingClientRect();
        ContextMenu.show({
          items: [
            { id: 'collapse-all', label: 'Collapse All', group: '1_actions' },
            { id: 'refresh', label: 'Refresh', group: '1_actions' },
          ],
          anchor: { x: rect.left, y: rect.bottom + 2 },
        });
      });
      actionsContainer.appendChild(moreBtn);
      headerSlot.appendChild(actionsContainer);

      // Store reference for dynamic container switching (Cap 6)
      this._sidebarHeaderLabel = headerLabel;
    }

    // NOTE: Do not call viewManager.showView() here — it bypasses
    // ViewContainer's tab-switching logic and makes both views visible.
    // The container's addView already activated the first view (Explorer).

    return defaultContainer;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Wire view/title actions and context menus to stacked section headers
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Connect a ViewContainer's section events to the MenuContributionProcessor.
   * - `onDidCreateSection`: renders view/title action buttons into the header's actions slot.
   * - `onDidContextMenuSection`: shows a context menu populated from view/title items.
   */
  private _wireSectionMenus(container: ViewContainer): void {
    if (!this._menuContribution) return;

    // Render actions for any sections already created
    for (const viewId of container.getViews().map(v => v.id)) {
      const section = (container as any)._sectionElements?.get(viewId);
      if (section?.actionsSlot) {
        this._menuContribution.renderViewTitleActions(viewId, section.actionsSlot);
      }
    }

    // Render actions for future sections
    this._register(container.onDidCreateSection(({ viewId, actionsSlot }) => {
      this._menuContribution.renderViewTitleActions(viewId, actionsSlot);
    }));

    // Handle right-click context menu on section headers
    this._register(container.onDidContextMenuSection(({ viewId, x, y }) => {
      const actions = this._menuContribution.getViewTitleActions(viewId);
      if (actions.length === 0) return;

      // Build menu items from contributed actions
      const cmdService = this._services.get(ICommandService) as CommandService;
      const items: import('../ui/contextMenu.js').IContextMenuItem[] = [];
      for (const action of actions) {
        const cmd = cmdService.getCommand(action.commandId);
        if (!cmd) continue;
        items.push({ id: action.commandId, label: cmd.title });
      }
      if (items.length === 0) return;

      const ctxMenu = ContextMenu.show({
        items,
        anchor: { x, y },
      });
      ctxMenu.onDidSelect(({ item }) => {
        cmdService.executeCommand(item.id).catch(err => {
          console.error(`[Workbench] Context menu action error:`, err);
        });
      });
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Panel views
  // ════════════════════════════════════════════════════════════════════════

  private _setupPanelViews(): ViewContainer {
    const container = new ViewContainer('panel');

    const terminalView = this._viewManager.createViewSync('view.terminal')!;
    const outputView = this._viewManager.createViewSync('view.output')!;
    container.addView(terminalView);
    container.addView(outputView);

    const panelContent = this._panel.element.querySelector('.panel-views') as HTMLElement;
    if (panelContent) {
      panelContent.appendChild(container.element);
    }

    // NOTE: Do not call viewManager.showView() here — the container
    // already activated the first view (Terminal) via addView.

    return container;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Activity bar toggle for aux bar
  // ════════════════════════════════════════════════════════════════════════

  private _addAuxBarToggle(): void {
    // The spacer and bottom section are already part of ActivityBarPart's
    // createContent(). We just need to add the toggle icon to the bottom section.
    const bottomSection = this._activityBarPart.contentElement.querySelector('.activity-bar-bottom');
    if (!bottomSection) return;

    const toggleBtn = document.createElement('button');
    toggleBtn.classList.add('activity-bar-item');
    toggleBtn.dataset.iconId = 'auxbar-toggle';
    toggleBtn.title = 'Toggle Secondary Side Bar';
    toggleBtn.textContent = '⊞';
    toggleBtn.addEventListener('click', () => {
      this.toggleAuxiliaryBar();
      toggleBtn.classList.toggle('active', this._auxBarVisible);
    });
    bottomSection.appendChild(toggleBtn);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Auxiliary bar views
  // ════════════════════════════════════════════════════════════════════════

  private _setupAuxBarViews(): ViewContainer {
    const container = new ViewContainer('auxiliaryBar');

    // Mount into aux bar's view slot
    const auxBarPart = this._auxiliaryBar as unknown as AuxiliaryBarPart;
    const viewSlot = auxBarPart.viewContainerSlot;
    if (viewSlot) {
      viewSlot.appendChild(container.element);
    }

    // Header label — updates when extensions register and activate views
    const headerSlot = auxBarPart.headerSlot;
    if (headerSlot) {
      const headerLabel = document.createElement('span');
      headerLabel.classList.add('auxiliary-bar-header-label');
      headerLabel.textContent = 'SECONDARY SIDE BAR';
      headerSlot.appendChild(headerLabel);

      container.onDidChangeActiveView((viewId) => {
        if (viewId) {
          const view = container.getView(viewId);
          headerLabel.textContent = (view?.name ?? 'SECONDARY SIDE BAR').toUpperCase();
        }
      });
    }

    // No views registered yet — extensions will populate this in later milestones.

    return container;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Secondary activity bar (right edge)
  // ════════════════════════════════════════════════════════════════════════

  private _setupSecondaryActivityBar(): void {
    this._secondaryActivityBarEl = document.createElement('div');
    this._secondaryActivityBarEl.classList.add('secondary-activity-bar', 'hidden');

    // No hardcoded view buttons — extensions will register their own
    // activity bar items when they add views to the auxiliary bar.

    // Append to body row (after hGrid, at the right edge)
    this._bodyRow.appendChild(this._secondaryActivityBarEl);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Editor watermark
  // ════════════════════════════════════════════════════════════════════════

  private _setupEditorWatermark(): void {
    const watermark = this._editor.element.querySelector('.editor-watermark') as HTMLElement;
    if (watermark) {
      // Initial watermark with static shortcuts (keybinding service not yet available)
      this._renderWatermarkContent(watermark);
    }
  }

  /**
   * Update the watermark keyboard shortcuts to reflect actual keybinding
   * labels from the keybinding service. Called after keybindingService is
   * available (Phase 5).
   */
  private _updateWatermarkKeybindings(keybindingService: { lookupKeybinding(commandId: string): string | undefined }): void {
    const watermark = this._editor.element.querySelector('.editor-watermark') as HTMLElement;
    if (!watermark) return;
    this._renderWatermarkContent(watermark, keybindingService);
  }

  /**
   * Render the watermark content, optionally using the keybinding service
   * for dynamic shortcut labels.
   */
  private _renderWatermarkContent(
    watermark: HTMLElement,
    keybindingService?: { lookupKeybinding(commandId: string): string | undefined },
  ): void {
    const shortcuts: { commandId: string; label: string; fallback: string }[] = [
      { commandId: 'workbench.action.showCommands', label: 'Command Palette', fallback: 'Ctrl+Shift+P' },
      { commandId: 'workbench.action.toggleSidebarVisibility', label: 'Toggle Sidebar', fallback: 'Ctrl+B' },
      { commandId: 'workbench.action.togglePanel', label: 'Toggle Panel', fallback: 'Ctrl+J' },
      { commandId: 'workbench.action.splitEditor', label: 'Split Editor', fallback: 'Ctrl+\\' },
    ];

    const entries = shortcuts.map(({ commandId, label, fallback }) => {
      // Look up keybinding if service is available, else use fallback
      let key = fallback;
      if (keybindingService) {
        const resolved = keybindingService.lookupKeybinding(commandId);
        if (resolved) {
          // Convert normalized format (ctrl+shift+p) to display format (Ctrl+Shift+P)
          key = resolved.split('+').map(part =>
            part.charAt(0).toUpperCase() + part.slice(1),
          ).join('+');
        }
      }
      return `<div class="editor-watermark-entry"><kbd>${key}</kbd> <span>${label}</span></div>`;
    }).join('\n            ');

    watermark.innerHTML = `
        <div class="editor-watermark-content">
          <div class="editor-watermark-icon">⊞</div>
          <div class="editor-watermark-title">Parallx Workbench</div>
          <div class="editor-watermark-shortcuts">
            ${entries}
          </div>
        </div>
      `;
  }

  /**
   * Register editor services (Capability 9).
   * Called in Phase 3 after EditorPart exists.
   */
  private _registerEditorServices(): void {
    const editorPart = this._editor as EditorPart;
    const editorGroupService = new EditorGroupService(editorPart);
    const editorService = new EditorService(editorPart);
    this._register(editorGroupService);
    this._register(editorService);
    this._services.registerInstance(IEditorGroupService, editorGroupService);
    this._services.registerInstance(IEditorService, editorService);

    // Update context key when group count changes
    editorGroupService.onDidGroupCountChange((count) => {
      this._workbenchContext?.setEditorGroupCount(count);
    });

    // Wire activeEditorGroup context key
    editorGroupService.onDidActiveGroupChange((group) => {
      this._workbenchContext?.setActiveEditorGroup(group.id);
    });

    // Wire activeEditor + activeEditorDirty context keys
    let activeEditorDirtyListener: { dispose(): void } | undefined;
    editorService.onDidActiveEditorChange((editor) => {
      // Update active editor type id
      this._workbenchContext?.setActiveEditor(editor?.typeId);

      // Track dirty state of the active editor
      activeEditorDirtyListener?.dispose();
      activeEditorDirtyListener = undefined;

      if (editor) {
        this._workbenchContext?.setActiveEditorDirty(editor.isDirty);
        activeEditorDirtyListener = editor.onDidChangeDirty((dirty) => {
          this._workbenchContext?.setActiveEditorDirty(dirty);
        });
      } else {
        this._workbenchContext?.setActiveEditorDirty(false);
      }

      // Update window title
      this._updateWindowTitle(editor);
    });

    console.log('[Workbench] Editor services registered (Capability 9)');
  }

  /**
   * Update the window title based on the active editor.
   */
  private _updateWindowTitle(editor?: IEditorInput): void {
    const parts: string[] = [];

    // {dirty}{filename}
    if (editor) {
      parts.push(editor.isDirty ? `● ${editor.name}` : editor.name);
    }

    // {folderName} or {workspaceName}
    const folders = this._workspace?.folders;
    if (folders && folders.length === 1) {
      // Single folder — show folder name
      parts.push(folders[0].name);
    } else {
      // Multi-folder, no folders, or no workspace — show workspace name
      const wsName = this._workspace?.name;
      if (wsName) {
        parts.push(wsName);
      }
    }

    parts.push('Parallx');
    document.title = parts.join(' — ');

    // Update resource context keys from active editor
    if (this._workbenchContext && editor) {
      const editorUri = (editor as any).uri as string | undefined;
      if (editorUri) {
        try {
          const uri = URI.parse(editorUri);
          this._workbenchContext.setResourceScheme(uri.scheme);
          this._workbenchContext.setResourceExtname(uri.extname);
          this._workbenchContext.setResourceFilename(uri.basename);
        } catch {
          this._workbenchContext.setResourceScheme('');
          this._workbenchContext.setResourceExtname('');
          this._workbenchContext.setResourceFilename('');
        }
      } else {
        this._workbenchContext.setResourceScheme('');
        this._workbenchContext.setResourceExtname('');
        this._workbenchContext.setResourceFilename('');
      }
    } else if (this._workbenchContext) {
      this._workbenchContext.setResourceScheme('');
      this._workbenchContext.setResourceExtname('');
      this._workbenchContext.setResourceFilename('');
    }
  }

  /**
   * Register facade services (Capability 0 gap cleanup).
   * Called in Phase 3 after grids, ViewManager, and workspace exist.
   */
  private _registerFacadeServices(): void {
    // Layout service — delegates to grids
    const layoutService = new LayoutService();
    layoutService.setHost(this as any);
    this._register(layoutService);
    this._services.registerInstance(ILayoutService, layoutService);

    // View service — placeholder for M2 tool API surface
    const viewService = new ViewService();
    this._register(viewService);
    this._services.registerInstance(IViewService, viewService);

    // Workspace service — delegates to workbench workspace operations
    const workspaceService = new WorkspaceService();
    workspaceService.setHost(this as any);
    this._register(workspaceService);
    this._services.registerInstance(IWorkspaceService, workspaceService);

    // Wire workspace service into Quick Access for workspace switching
    if (this._commandPalette) {
      this._commandPalette.setWorkspaceService({
        workspace: this._workspace,
        getRecentWorkspaces: () => this.getRecentWorkspaces(),
        switchWorkspace: (id: string) => this.switchWorkspace(id),
      });
    }

    // Notification service — attach toast container to the workbench DOM
    if (this._services.has(INotificationService)) {
      const notificationService = this._services.get(INotificationService);
      (notificationService as any).attach(this._container);
    }

    console.log('[Workbench] Facade services registered (layout, view, workspace)');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Tool Lifecycle (M2 Capability 3)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Initialize tool activator, contribution processors, and fire startup-finished event.
   * Called in Phase 5 (Ready) after all services and UI are available.
   */
  private async _initializeToolLifecycle(): Promise<void> {
    // Resolve services
    const registry = this._services.get(IToolRegistryService) as unknown as ToolRegistry;
    const activationEvents = this._services.get(IActivationEventService) as unknown as ActivationEventService;
    const errorService = this._services.get(IToolErrorService) as unknown as ToolErrorService;
    const notificationService = this._services.has(INotificationService)
      ? this._services.get(INotificationService) as any
      : undefined;

    // Register contribution processors (M2 Capability 5)
    const { commandContribution, keybindingContribution, menuContribution, keybindingService } =
      registerContributionProcessors(this._services);
    this._commandContribution = commandContribution;
    this._keybindingContribution = keybindingContribution;
    this._menuContribution = menuContribution;
    this._register(commandContribution);
    this._register(keybindingContribution);
    this._register(menuContribution);
    this._register(keybindingService);

    // Register structural keybindings through the centralized service (M3 Capability 0.3)
    this._registerStructuralKeybindings(keybindingService);

    // Update watermark shortcuts with actual keybinding labels (Phase 5 — service now available)
    this._updateWatermarkKeybindings(keybindingService);

    // Register view contribution processor (M2 Capability 6)
    this._viewContribution = registerViewContributionProcessor(this._services, this._viewManager);
    this._register(this._viewContribution);
    this._wireViewContributionEvents();

    // Process contributions from already-registered tools
    for (const entry of registry.getAll()) {
      commandContribution.processContributions(entry.description);
      keybindingContribution.processContributions(entry.description);
      menuContribution.processContributions(entry.description);
      this._viewContribution.processContributions(entry.description);
    }

    // Process contributions for future tool registrations
    this._register(registry.onDidRegisterTool((event) => {
      commandContribution.processContributions(event.description);
      keybindingContribution.processContributions(event.description);
      menuContribution.processContributions(event.description);
      this._viewContribution.processContributions(event.description);
    }));

    // Build API factory dependencies (includes ConfigurationService for Cap 4,
    // CommandContributionProcessor for Cap 5, ViewContributionProcessor for Cap 6)
    const apiFactoryDeps = {
      services: this._services,
      viewManager: this._viewManager,
      toolRegistry: registry,
      notificationService,
      workbenchContainer: this._container,
      configurationService: this._configService,
      commandContributionProcessor: commandContribution,
      viewContributionProcessor: this._viewContribution,
      badgeHost: this._activityBarPart,
      statusBarPart: this._statusBar as unknown as StatusBarPart,
    };

    // Storage dependencies for persistent tool mementos (Cap 4)
    const storageDeps: ToolStorageDependencies = {
      globalStorage: this._globalStorage,
      workspaceStorage: this._storage,
      configRegistry: this._configRegistry,
    };

    // Create and register the activator
    this._toolActivator = this._register(
      new ToolActivator(registry, errorService, activationEvents, apiFactoryDeps, storageDeps),
    );
    this._services.registerInstance(IToolActivatorService, this._toolActivator as any);

    // Wire activation events to the activator
    this._register(activationEvents.onActivationRequested(async (request) => {
      console.log(`[Workbench] Activation requested for tool "${request.toolId}" (event: ${request.event.raw})`);
      await this._toolActivator.activate(request.toolId);
    }));

    // Clean up contributions when tools are deactivated
    this._register(this._toolActivator.onDidDeactivate((event) => {
      commandContribution.removeContributions(event.toolId);
      keybindingContribution.removeContributions(event.toolId);
      menuContribution.removeContributions(event.toolId);
      this._viewContribution.removeContributions(event.toolId);
    }));

    // Wire contribution processors into the command palette for display
    if (this._commandPalette) {
      this._commandPalette.setMenuContribution(menuContribution);
      this._commandPalette.setKeybindingContribution(keybindingContribution);
    }

    // Wire keybinding lookup and command executor into TitlebarPart (M3 Capability 1)
    this._titlebar.setKeybindingLookup(keybindingService);
    this._titlebar.setCommandExecutor(this._services.get(ICommandService) as any);

    // ── Wire file editor resolver (M4 Capability 4) ──
    this._initFileEditorResolver();

    // ── Register and activate built-in tools (M2 Capability 7) ──
    await this._registerAndActivateBuiltinTools(registry, activationEvents);

    // Fire startup finished — triggers * and onStartupFinished activation events
    activationEvents.fireStartupFinished();

    console.log('[Workbench] Tool lifecycle initialized (with contribution processors)');
  }

  /**
   * Register all structural (built-in) keybindings through the centralized
   * KeybindingService (M3 Capability 0.3). This replaces ad-hoc keydown
   * listeners scattered across CommandPalette and other modules.
   */
  private _registerStructuralKeybindings(keybindingService: KeybindingService): void {
    const bindings: { key: string; commandId: string; when?: string; source: string }[] = [];

    // 1. Structural command keybindings from command descriptors
    for (const cmd of ALL_BUILTIN_COMMANDS) {
      if (cmd.keybinding) {
        bindings.push({
          key: cmd.keybinding,
          commandId: cmd.id,
          when: cmd.when,
          source: 'builtin',
        });
      }
    }

    // 2. F1 as secondary trigger for command palette (not in command descriptor)
    bindings.push(
      { key: 'F1', commandId: 'workbench.action.showCommands', source: 'builtin' },
    );

    this._register(keybindingService.registerKeybindings(bindings));

    console.log(
      '[Workbench] Registered %d structural keybinding(s) via KeybindingService',
      bindings.length,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Built-in Tools (M2 Capability 7)
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  // File Editor Resolver (M4 Capability 4)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Wire the file editor resolver at the workbench level.
   *
   * This connects three things:
   *  1. A pane factory for FileEditorInput / UntitledEditorInput → TextEditorPane
   *  2. A URI resolver for `file://` and `untitled://` → FileEditorInput / UntitledEditorInput
   *  3. Exposes the resolver via setFileEditorResolver() so EditorsBridge.openFileEditor() works
   *
   * Must be called AFTER services are registered but BEFORE built-in tools activate.
   */
  private _initFileEditorResolver(): void {
    // ── 1. Pane factory ──
    const paneFactoryDisposable = registerEditorPaneFactory((input) => {
      if (input instanceof FileEditorInput || input instanceof UntitledEditorInput) {
        return new TextEditorPane();
      }
      return null;
    });
    this._register(paneFactoryDisposable);

    // ── 2. Resolver services ──
    const textFileModelManager = this._services.get(ITextFileModelManager) as any;
    const fileService = this._services.get(IFileService) as any;

    // ── 3. URI resolver function ──
    setFileEditorResolver(async (uriString: string) => {
      // Handle untitled scheme
      if (uriString.startsWith('untitled://') || uriString.startsWith('untitled:')) {
        return UntitledEditorInput.create();
      }

      // Handle file scheme or plain fsPath
      let uri: URI;
      if (uriString.startsWith('file://') || uriString.startsWith('file:///')) {
        uri = URI.parse(uriString);
      } else {
        // Treat as fsPath
        uri = URI.file(uriString);
      }

      // Check if there's already an open FileEditorInput for this URI
      // (deduplication via URI key)
      const existingInput = this._findOpenFileEditorInput(uri);
      if (existingInput) return existingInput;

      // Compute workspace-relative path for description
      let relativePath: string | undefined;
      const workspaceService = this._services.has(IWorkspaceService)
        ? this._services.get(IWorkspaceService) as any
        : undefined;
      if (workspaceService?.workspaceFolders) {
        for (const folder of workspaceService.workspaceFolders) {
          const folderUri = typeof folder.uri === 'string' ? URI.parse(folder.uri) : folder.uri;
          const folderPath = folderUri.fsPath;
          if (uri.fsPath.startsWith(folderPath)) {
            relativePath = uri.fsPath.substring(folderPath.length + 1).replace(/\\/g, '/');
            break;
          }
        }
      }

      return FileEditorInput.create(uri, textFileModelManager, fileService, relativePath);
    });

    console.log('[Workbench] File editor resolver wired');
  }

  /**
   * Find an already-open FileEditorInput by URI across all editor groups.
   */
  private _findOpenFileEditorInput(uri: URI): FileEditorInput | undefined {
    const editorPart = this._editor as EditorPart;
    for (const group of editorPart.groups) {
      for (const editor of group.model.editors) {
        if (editor instanceof FileEditorInput && editor.uri.equals(uri)) {
          return editor;
        }
      }
    }
    return undefined;
  }

  /**
   * Register built-in tools in the registry and activate them using
   * pre-imported modules. Called before fireStartupFinished() so built-in
   * tools are ready when the workbench becomes interactive.
   */
  private async _registerAndActivateBuiltinTools(
    registry: ToolRegistry,
    activationEvents: ActivationEventService,
  ): Promise<void> {
    const builtins: { manifest: IToolManifest; module: { activate: Function; deactivate?: Function } }[] = [
      {
        manifest: {
          manifestVersion: 1,
          id: 'parallx.explorer',
          name: 'Explorer',
          version: '1.0.0',
          publisher: 'parallx',
          description: 'File Explorer — browse, create, rename, and delete files and folders.',
          main: './main.js',
          engines: { parallx: '^0.1.0' },
          activationEvents: ['onStartupFinished'],
          contributes: {
            commands: [
              { id: 'explorer.newFile', title: 'Explorer: New File...' },
              { id: 'explorer.newFolder', title: 'Explorer: New Folder...' },
              { id: 'explorer.rename', title: 'Explorer: Rename...' },
              { id: 'explorer.delete', title: 'Explorer: Delete' },
              { id: 'explorer.refresh', title: 'Explorer: Refresh' },
              { id: 'explorer.collapse', title: 'Explorer: Collapse All' },
              { id: 'explorer.revealInExplorer', title: 'Explorer: Reveal in Explorer' },
              { id: 'explorer.toggleHiddenFiles', title: 'Explorer: Toggle Hidden Files' },
            ],
            keybindings: [
              { command: 'explorer.rename', key: 'F2', when: "focusedView == 'view.explorer'" },
              { command: 'explorer.delete', key: 'Delete', when: "focusedView == 'view.explorer'" },
            ],
            viewContainers: [
              { id: 'explorer-container', title: 'Explorer', icon: '📁', location: 'sidebar' as const },
            ],
            views: [
              { id: 'view.openEditors', name: 'Open Editors', defaultContainerId: 'explorer-container' },
              { id: 'view.explorer', name: 'Explorer', defaultContainerId: 'explorer-container' },
            ],
          },
        },
        module: ExplorerTool,
      },
      {
        manifest: {
          manifestVersion: 1,
          id: 'parallx.editor.text',
          name: 'Text Editor',
          version: '1.0.0',
          publisher: 'parallx',
          description: 'Built-in text editor for files and untitled documents.',
          main: './main.js',
          engines: { parallx: '^0.1.0' },
          activationEvents: ['*'],
          contributes: {
            commands: [
              { id: 'editor.toggleWordWrap', title: 'View: Toggle Word Wrap' },
              { id: 'editor.changeEncoding', title: 'Change File Encoding' },
            ],
            keybindings: [
              { command: 'editor.toggleWordWrap', key: 'Alt+Z' },
            ],
          },
        },
        module: FileEditorTool,
      },
      {
        manifest: {
          manifestVersion: 1,
          id: 'parallx.welcome',
          name: 'Welcome',
          version: '1.0.0',
          publisher: 'parallx',
          description: 'Welcome page — shows getting-started content and recent workspaces.',
          main: './main.js',
          engines: { parallx: '^0.1.0' },
          activationEvents: ['onStartupFinished'],
          contributes: {
            commands: [{ id: 'welcome.openWelcome', title: 'Welcome: Show Welcome Page' }],
          },
        },
        module: WelcomeTool,
      },
      {
        manifest: {
          manifestVersion: 1,
          id: 'parallx.output',
          name: 'Output',
          version: '1.0.0',
          publisher: 'parallx',
          description: 'Output panel — shows log messages from tools and the shell.',
          main: './main.js',
          engines: { parallx: '^0.1.0' },
          activationEvents: ['onStartupFinished'],
          contributes: {
            commands: [
              { id: 'output.clear', title: 'Output: Clear Log' },
              { id: 'output.toggleTimestamps', title: 'Output: Toggle Timestamps' },
            ],
            views: [{ id: 'view.output', name: 'Output', defaultContainerId: 'panel' }],
          },
        },
        module: OutputTool,
      },
      {
        manifest: {
          manifestVersion: 1,
          id: 'parallx.tool-gallery',
          name: 'Tools',
          version: '1.0.0',
          publisher: 'parallx',
          description: 'Tool Gallery — shows all registered tools, their status, and contributions.',
          main: './main.js',
          engines: { parallx: '^0.1.0' },
          activationEvents: ['onStartupFinished'],
          contributes: {
            commands: [{ id: 'tools.showInstalled', title: 'Tools: Show Installed Tools' }],
            viewContainers: [
              { id: 'tools-container', title: 'Tools', icon: '🧩', location: 'sidebar' as const },
            ],
            views: [{ id: 'view.tools', name: 'Installed Tools', defaultContainerId: 'tools-container' }],
          },
        },
        module: ToolGalleryTool,
      },
    ];

    const activationPromises: Promise<void>[] = [];

    for (const { manifest, module } of builtins) {
      const description: IToolDescription = {
        manifest,
        toolPath: `built-in/${manifest.id}`,
        isBuiltin: true,
      };

      try {
        registry.register(description);
        // Register activation events so the system knows about them
        activationEvents.registerToolEvents(manifest.id, manifest.activationEvents);
        // Pre-mark as activated so fireStartupFinished() doesn't double-trigger
        // via the onStartupFinished event while activateBuiltin is still awaiting
        activationEvents.markActivated(manifest.id);
        // Activate immediately using the pre-imported module (no module loader)
        activationPromises.push(
          this._toolActivator.activateBuiltin(manifest.id, module as any).then(
            () => {},
            (err) => { console.error(`[Workbench] Failed to activate built-in tool "${manifest.id}":`, err); },
          ),
        );
      } catch (err) {
        console.error(`[Workbench] Failed to register built-in tool "${manifest.id}":`, err);
      }
    }

    // Wait for all built-in tools to finish activating before returning
    await Promise.allSettled(activationPromises);
  }

  // ════════════════════════════════════════════════════════════════════════
  // View Contribution Events (M2 Capability 6)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Wire events from the ViewContributionProcessor to the workbench DOM.
   * Called once during _initializeToolLifecycle().
   */
  private _wireViewContributionEvents(): void {
    // Clear previous listeners (prevents duplication on workspace switch)
    this._viewContribListeners.clear();

    // When a tool contributes a new container → create DOM + activity bar icon
    this._viewContribListeners.add(this._viewContribution.onDidAddContainer((container) => {
      this._onToolContainerAdded(container);
    }));

    // When a tool's container is removed → tear down DOM + remove icon
    this._viewContribListeners.add(this._viewContribution.onDidRemoveContainer((containerId) => {
      this._onToolContainerRemoved(containerId);
    }));

    // When a tool contributes a view → create it and add to the correct container
    this._viewContribListeners.add(this._viewContribution.onDidAddView((view) => {
      this._onToolViewAdded(view);
    }));

    // When a tool's view is removed → container will handle via ViewManager unregister
    this._viewContribListeners.add(this._viewContribution.onDidRemoveView((viewId) => {
      this._onToolViewRemoved(viewId);
    }));

    // When a provider is registered → if the view is in a visible container, ensure it's rendered
    this._viewContribListeners.add(this._viewContribution.onDidRegisterProvider(({ viewId }) => {
      console.log(`[Workbench] View provider registered for "${viewId}"`);
    }));
  }

  /**
   * Handle a tool contributing a new view container.
   * Creates the ViewContainer DOM and adds an activity bar / panel tab icon.
   */
  private _onToolContainerAdded(info: IContributedContainer): void {
    const vc = new ViewContainer(info.id);

    if (info.location === 'sidebar') {
      vc.hideTabBar(); // sidebar containers use the activity bar, not tabs
      vc.setVisible(false);

      // Mount into sidebar's view slot (hidden until its icon is clicked)
      const sidebarContent = this._sidebar.element.querySelector('.sidebar-views') as HTMLElement;
      if (sidebarContent) {
        sidebarContent.appendChild(vc.element);
      }
      this._contributedSidebarContainers.set(info.id, vc);

      // Add activity bar icon (after separator)
      this._addContributedActivityBarIcon(info);
      console.log(`[Workbench] Added sidebar container "${info.id}" (${info.title})`);

    } else if (info.location === 'panel') {
      vc.setVisible(false);

      const panelContent = this._panel.element.querySelector('.panel-views') as HTMLElement;
      if (panelContent) {
        panelContent.appendChild(vc.element);
      }
      this._contributedPanelContainers.set(info.id, vc);
      console.log(`[Workbench] Added panel container "${info.id}" (${info.title})`);

    } else if (info.location === 'auxiliaryBar') {
      vc.hideTabBar();
      vc.setVisible(false);

      const auxBarPart = this._auxiliaryBar as unknown as AuxiliaryBarPart;
      const viewSlot = auxBarPart.viewContainerSlot;
      if (viewSlot) {
        viewSlot.appendChild(vc.element);
      }
      this._contributedAuxBarContainers.set(info.id, vc);
      console.log(`[Workbench] Added auxiliary bar container "${info.id}" (${info.title})`);
    }
  }

  /**
   * Handle a tool's view container being removed (tool deactivation).
   */
  private _onToolContainerRemoved(containerId: string): void {
    // Sidebar
    const sidebarVc = this._contributedSidebarContainers.get(containerId);
    if (sidebarVc) {
      // If this was the active sidebar container, switch back to default
      if (this._activeSidebarContainerId === containerId) {
        this._switchSidebarContainer(undefined);
      }
      sidebarVc.dispose();
      this._contributedSidebarContainers.delete(containerId);
      this._removeContributedActivityBarIcon(containerId);
      return;
    }

    // Panel
    const panelVc = this._contributedPanelContainers.get(containerId);
    if (panelVc) {
      panelVc.dispose();
      this._contributedPanelContainers.delete(containerId);
      return;
    }

    // Auxiliary bar
    const auxVc = this._contributedAuxBarContainers.get(containerId);
    if (auxVc) {
      auxVc.dispose();
      this._contributedAuxBarContainers.delete(containerId);
      return;
    }
  }

  /**
   * Handle a tool contributing a new view.
   * The view is created from its registered descriptor and added to the appropriate container.
   */
  private _onToolViewAdded(info: IContributedView): void {
    const containerId = info.containerId;

    // Check if the container is a contributed container
    const sidebarVc = this._contributedSidebarContainers.get(containerId);
    if (sidebarVc) {
      this._addViewToContainer(info, sidebarVc);
      return;
    }

    const panelVc = this._contributedPanelContainers.get(containerId);
    if (panelVc) {
      this._addViewToContainer(info, panelVc);
      return;
    }

    const auxVc = this._contributedAuxBarContainers.get(containerId);
    if (auxVc) {
      this._addViewToContainer(info, auxVc);
      return;
    }

    // Check built-in container IDs
    if (containerId === 'sidebar' || containerId === 'workbench.parts.sidebar') {
      this._addViewToContainer(info, this._sidebarContainer);
      return;
    }
    if (containerId === 'panel' || containerId === 'workbench.parts.panel') {
      this._addViewToContainer(info, this._panelContainer);
      return;
    }
    if (containerId === 'auxiliaryBar' || containerId === 'workbench.parts.auxiliarybar') {
      this._addViewToContainer(info, this._auxBarContainer);
      return;
    }

    console.warn(`[Workbench] View "${info.id}" targets unknown container "${containerId}"`);
  }

  /**
   * Create a view from its descriptor and add it to a ViewContainer.
   */
  private async _addViewToContainer(info: IContributedView, container: ViewContainer): Promise<void> {
    try {
      const view = await this._viewManager.createView(info.id);
      container.addView(view);
    } catch (err) {
      console.error(`[Workbench] Failed to add view "${info.id}" to container:`, err);
    }
  }

  /**
   * Handle a tool's view being removed.
   */
  private _onToolViewRemoved(viewId: string): void {
    // The ViewManager.unregister() already disposes the view.
    // We also need to remove it from its container.
    for (const vc of [...this._builtinSidebarContainers.values(), this._panelContainer, this._auxBarContainer]) {
      if (vc?.getView(viewId)) {
        vc.removeView(viewId);
        return;
      }
    }
    for (const vc of this._contributedSidebarContainers.values()) {
      if (vc.getView(viewId)) { vc.removeView(viewId); return; }
    }
    for (const vc of this._contributedPanelContainers.values()) {
      if (vc.getView(viewId)) { vc.removeView(viewId); return; }
    }
    for (const vc of this._contributedAuxBarContainers.values()) {
      if (vc.getView(viewId)) { vc.removeView(viewId); return; }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Activity Bar — Dynamic Icons (M2 Capability 6, Task 6.4)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Add an activity bar icon for a tool-contributed sidebar container.
   * Uses the ActivityBarPart's addIcon API (M3 Capability 0.2).
   */
  private _addContributedActivityBarIcon(info: IContributedContainer): void {
    this._activityBarPart.addIcon({
      id: info.id,
      icon: info.icon ?? info.title.charAt(0).toUpperCase(),
      label: info.title,
      source: 'contributed',
    });
  }

  /**
   * Remove an activity bar icon for a deactivated tool container.
   */
  private _removeContributedActivityBarIcon(containerId: string): void {
    this._activityBarPart.removeIcon(containerId);
  }

  /**
   * Toggle primary sidebar visibility.
   *
   * VS Code reference: ViewContainerActivityAction.run() — clicking active icon toggles sidebar.
   * Remembers width before collapse and restores it on expand.
   */
  toggleSidebar(): void {
    if (this._sidebar.visible) {
      // Save current width before collapsing so we can restore later
      const currentWidth = this._hGrid.getViewSize(this._sidebar.id);
      if (currentWidth !== undefined && currentWidth > 0) {
        this._lastSidebarWidth = currentWidth;
      }
      this._hGrid.removeView(this._sidebar.id);
      this._sidebar.setVisible(false);
    } else {
      this._sidebar.setVisible(true);
      this._hGrid.addView(this._sidebar as any, this._lastSidebarWidth, 0); // index 0 = leftmost in hGrid
    }
    this._hGrid.layout();
    this._layoutViewContainers();
  }

  /**
   * Toggle panel visibility.
   *
   * VS Code reference: TogglePanelAction (workbench.action.togglePanel, Ctrl+J).
   * Remembers height before collapse and restores it on expand.
   */
  togglePanel(): void {
    if (this._panel.visible) {
      // Save current height before collapsing
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined && currentHeight > 0) {
        this._lastPanelHeight = currentHeight;
      }
      this._vGrid.removeView(this._panel.id);
      this._panel.setVisible(false);
      this._panelMaximized = false;
      this._workbenchContext.setPanelMaximized(false);
    } else {
      this._panel.setVisible(true);
      this._vGrid.addView(this._panel as any, this._lastPanelHeight);
      this._panelMaximized = false;
      this._workbenchContext.setPanelMaximized(false);
    }
    this._vGrid.layout();
    this._layoutViewContainers();
  }

  /**
   * Toggle panel between normal and maximized height.
   *
   * VS Code reference: toggleMaximizedPanel — stores non-maximized height,
   * sets panel to fill all vertical space (editor gets minimum), restores on
   * second toggle.
   */
  toggleMaximizedPanel(): void {
    if (!this._panel.visible) {
      // Show + maximize in one go
      this._panel.setVisible(true);
      this._vGrid.addView(this._panel as any, this._lastPanelHeight);
      this._vGrid.layout();
      // Now maximize
    }

    if (this._panelMaximized) {
      // Restore to previous non-maximized height
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined) {
        const delta = this._lastPanelHeight - currentHeight;
        if (delta !== 0) {
          this._vGrid.resizeSash(this._vGrid.root, 0, delta);
          this._vGrid.layout();
        }
      }
      this._panelMaximized = false;
      this._workbenchContext.setPanelMaximized(false);
    } else {
      // Save current height, then maximize panel (give editor minimum)
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined && currentHeight > 0) {
        this._lastPanelHeight = currentHeight;
      }
      // Calculate how much to grow: vGrid total height minus a thin editor minimum
      const editorMin = 30; // minimal editor strip when maximized
      const editorSize = this._vGrid.getViewSize(this._editor.id);
      if (editorSize !== undefined) {
        const delta = editorSize - editorMin;
        if (delta > 0) {
          this._vGrid.resizeSash(this._vGrid.root, 0, -delta);
          this._vGrid.layout();
        }
      }
      this._panelMaximized = true;
      this._workbenchContext.setPanelMaximized(true);
    }
    this._layoutViewContainers();
  }

  /**
   * Toggle status bar visibility.
   *
   * VS Code reference: ToggleStatusbarVisibilityAction
   * (workbench.action.toggleStatusbarVisibility).
   * Status bar is a fixed-height (22 px) strip — no sash resizing needed.
   * Visibility is persisted through WorkspaceSaver (part snapshot).
   */
  toggleStatusBar(): void {
    const visible = !this._statusBar.visible;
    this._statusBar.setVisible(visible);
    this._workbenchContext.setStatusBarVisible(visible);
    this._relayout();
    this._workspaceSaver.requestSave();
  }

  // ── LayoutHost Protocol ──────────────────────────────────────────────────
  // These methods fulfil the LayoutHost interface expected by LayoutService.
  // VS Code reference: IWorkbenchLayoutService.isVisible / setPartHidden.

  /**
   * Check whether a part is currently visible by its PartId.
   */
  isPartVisible(partId: string): boolean {
    switch (partId) {
      case PartId.Sidebar: return this._sidebar.visible;
      case PartId.Panel: return this._panel.visible;
      case PartId.AuxiliaryBar: return this._auxiliaryBar.visible;
      case PartId.StatusBar: return this._statusBar!.visible;
      case PartId.ActivityBar: return true; // always visible
      case PartId.Titlebar: return true;    // always visible
      case PartId.Editor: return true;      // always visible
      default: return false;
    }
  }

  /**
   * Show or hide a part by its PartId.
   * Dispatches to the relevant toggle method following VS Code's
   * `setPartHidden → setSideBarHidden / setPanelHidden` pattern.
   */
  setPartHidden(hidden: boolean, partId: string): void {
    const isVisible = this.isPartVisible(partId);
    // No-op if already in the desired state
    if (hidden === !isVisible) return;

    switch (partId) {
      case PartId.Sidebar:
        this.toggleSidebar();
        break;
      case PartId.Panel:
        this.togglePanel();
        break;
      case PartId.AuxiliaryBar:
        this.toggleAuxiliaryBar();
        break;
      case PartId.StatusBar:
        this.toggleStatusBar();
        break;
      // Titlebar, Editor, ActivityBar — not toggleable
      default:
        console.warn(`[Workbench] setPartHidden not supported for "${partId}"`);
        break;
    }
  }

  /**
   * Switch the active sidebar container.
   *
   * @param containerId - ID of a contributed container, or `undefined` for the built-in default.
   */
  private _switchSidebarContainer(containerId: string | undefined): void {
    if (this._activeSidebarContainerId === containerId) return;

    // Hide current active container (check builtin → contributed → fallback)
    if (this._activeSidebarContainerId) {
      const current =
        this._builtinSidebarContainers.get(this._activeSidebarContainerId) ??
        this._contributedSidebarContainers.get(this._activeSidebarContainerId);
      current?.setVisible(false);
    } else {
      this._sidebarContainer.setVisible(false);
    }

    // Show new container
    this._activeSidebarContainerId = containerId;
    // Update activeViewContainer context key (Capability 2 deferred item)
    this._workbenchContext?.setActiveViewContainer(containerId ?? 'view.explorer');
    if (containerId) {
      const next =
        this._builtinSidebarContainers.get(containerId) ??
        this._contributedSidebarContainers.get(containerId);
      if (next) {
        next.setVisible(true);
        this._layoutViewContainers();
      }
    } else {
      this._sidebarContainer.setVisible(true);
      this._layoutViewContainers();
    }

    // Update activity bar highlight via ActivityBarPart (M3 Capability 0.2)
    if (containerId) {
      this._activityBarPart.setActiveIcon(containerId);
    } else {
      // Switch back to built-in: re-activate the first built-in icon
      this._activityBarPart.setActiveIcon('view.explorer');
    }

    // Update sidebar header label
    if (this._sidebarHeaderLabel) {
      if (containerId) {
        // Check if it's a built-in container first
        const builtinVc = this._builtinSidebarContainers.get(containerId);
        if (builtinVc) {
          // Use the first view's name as the header label
          const views = builtinVc.getViews();
          this._sidebarHeaderLabel.textContent = (views[0]?.name ?? 'SIDEBAR').toUpperCase();
        } else {
          // Contributed container — use container title
          const info = this._viewContribution.getContainer(containerId);
          this._sidebarHeaderLabel.textContent = (info?.title ?? 'SIDEBAR').toUpperCase();
        }
      } else {
        // Restore to the active view name in the built-in container
        const activeId = this._sidebarContainer.activeViewId;
        const activeView = activeId ? this._sidebarContainer.getView(activeId) : undefined;
        this._sidebarHeaderLabel.textContent = (activeView?.name ?? 'EXPLORER').toUpperCase();
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Status bar
  // ════════════════════════════════════════════════════════════════════════

  private _setupStatusBar(): void {
    const sb = this._statusBar as unknown as StatusBarPart;

    // Wire command executor so entry clicks execute commands via CommandService
    // VS Code parity: StatusbarEntryItem uses ICommandService.executeCommand()
    const commandService = this._services.get(ICommandService) as any;
    if (commandService) {
      sb.setCommandExecutor((cmdId: string) => {
        commandService.executeCommand(cmdId);
      });
    }

    // Register default status bar entries through the contribution API
    // (not hardcoded DOM — matches Task 6.1 requirement)
    const branchAccessor = sb.addEntry({
      id: 'status.scm.branch',
      text: '⎇ master',
      alignment: StatusBarAlignment.Left,
      priority: 100,
      tooltip: 'Current branch',
      name: 'Branch',
    });

    const errorsAccessor = sb.addEntry({
      id: 'status.problems',
      text: '⊘ 0  ⚠ 0',
      alignment: StatusBarAlignment.Left,
      priority: 90,
      tooltip: 'Errors and warnings',
      name: 'Problems',
    });

    sb.addEntry({
      id: 'status.editor.selection',
      text: 'Ln 1, Col 1',
      alignment: StatusBarAlignment.Right,
      priority: 100,
      tooltip: 'Go to Line/Column',
      name: 'Cursor Position',
    });

    sb.addEntry({
      id: 'status.editor.encoding',
      text: 'UTF-8',
      alignment: StatusBarAlignment.Right,
      priority: 90,
      tooltip: 'Select Encoding',
      name: 'Encoding',
    });

    // Track accessors so the workbench can update them later
    this._statusBarAccessors = { branch: branchAccessor, errors: errorsAccessor };

    // Context menu on right-click — VS Code parity:
    // Shows "Hide Status Bar" + per-entry hide toggles
    this._register(sb.onDidContextMenu((event) => {
      const entries = sb.getEntries();
      const ctxMenu = ContextMenu.show({
        items: [
          {
            id: 'hideStatusBar',
            label: 'Hide Status Bar',
            group: '0_visibility',
          },
          ...entries.map((e) => ({
            id: e.id,
            label: e.name || e.text,
            group: '1_entries',
          })),
        ],
        anchor: { x: event.x, y: event.y },
      });
      ctxMenu.onDidSelect((e) => {
        if (e.item.id === 'hideStatusBar') {
          this.toggleStatusBar();
        }
      });
    }));

    // ── Notification Center Badge (Cap 9) ──
    this._setupNotificationBadge(sb);
  }

  /**
   * Set up the notification bell badge in the status bar and wire it to
   * the NotificationService. Clicking the badge toggles a notification
   * center dropdown showing recent notifications.
   *
   * VS Code parity: `src/vs/workbench/browser/parts/notifications`
   */
  private _setupNotificationBadge(sb: StatusBarPart): void {
    const notifService = this._services.has(INotificationService)
      ? this._services.get(INotificationService) as import('../api/notificationService.js').NotificationService
      : undefined;
    if (!notifService) return;

    // Add bell entry to status bar (right-aligned, low priority = far right)
    const bellAccessor = sb.addEntry({
      id: 'status.notifications',
      text: '🔔',
      alignment: StatusBarAlignment.Right,
      priority: -100, // far right
      tooltip: 'No new notifications',
      command: 'workbench.action.toggleNotificationCenter',
      name: 'Notifications',
    });

    // Update badge when notification count changes
    const updateBadge = (count: number) => {
      bellAccessor.update({
        text: count > 0 ? `🔔 ${count}` : '🔔',
        tooltip: count > 0 ? `${count} notification${count > 1 ? 's' : ''}` : 'No new notifications',
      });
    };
    this._register(notifService.onDidChangeCount(updateBadge));

    // Notification center overlay state
    let centerOverlay: HTMLElement | null = null;
    const hideCenter = () => {
      if (centerOverlay) {
        centerOverlay.remove();
        centerOverlay = null;
      }
    };

    const showCenter = () => {
      if (centerOverlay) { hideCenter(); return; }

      const overlay = document.createElement('div');
      overlay.className = 'parallx-notification-center-overlay';
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hideCenter();
      });

      const panel = document.createElement('div');
      panel.className = 'parallx-notification-center';

      // Header
      const header = document.createElement('div');
      header.className = 'parallx-notification-center-header';
      const title = document.createElement('span');
      title.textContent = 'Notifications';
      header.appendChild(title);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'parallx-notification-center-clear';
      clearBtn.textContent = 'Clear All';
      clearBtn.title = 'Clear all notifications';
      clearBtn.addEventListener('click', () => {
        notifService.dismissAll();
        notifService.clearHistory();
        hideCenter();
      });
      header.appendChild(clearBtn);
      panel.appendChild(header);

      // List
      const list = document.createElement('div');
      list.className = 'parallx-notification-center-list';

      const history = notifService.history;
      if (history.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'parallx-notification-center-empty';
        empty.textContent = 'No notifications';
        list.appendChild(empty);
      } else {
        for (const notif of history) {
          const row = document.createElement('div');
          row.className = `parallx-notification-center-item parallx-notification-center-item-${notif.severity}`;

          const icon = document.createElement('span');
          icon.className = 'parallx-notification-center-icon';
          icon.textContent = notif.severity === 'information' ? 'ℹ' : notif.severity === 'warning' ? '⚠' : '✕';
          row.appendChild(icon);

          const msg = document.createElement('span');
          msg.className = 'parallx-notification-center-message';
          msg.textContent = notif.message;
          row.appendChild(msg);

          if (notif.source) {
            const src = document.createElement('span');
            src.className = 'parallx-notification-center-source';
            src.textContent = notif.source;
            row.appendChild(src);
          }

          list.appendChild(row);
        }
      }
      panel.appendChild(list);

      overlay.appendChild(panel);
      this._container.appendChild(overlay);
      centerOverlay = overlay;

      // Close on Escape
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          hideCenter();
          document.removeEventListener('keydown', onKey);
        }
      };
      document.addEventListener('keydown', onKey);
    };

    // Register the toggle command
    const commandService = this._services.get(ICommandService) as any;
    if (commandService?.registerCommand) {
      commandService.registerCommand('workbench.action.toggleNotificationCenter', () => showCenter());
    }
  }

  /** Tracked status bar entry accessors for dynamic updates. */
  private _statusBarAccessors: {
    branch?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    errors?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
  } = {};

  // ════════════════════════════════════════════════════════════════════════
  // Layout view containers
  // ════════════════════════════════════════════════════════════════════════

  private _layoutViewContainers(): void {
    if (this._sidebar.visible && this._sidebar.width > 0) {
      const headerH = 35;
      const sidebarW = this._sidebar.width;
      const sidebarH = this._sidebar.height - headerH;
      // Layout the active sidebar container (built-in or contributed)
      if (this._activeSidebarContainerId) {
        const active =
          this._builtinSidebarContainers.get(this._activeSidebarContainerId) ??
          this._contributedSidebarContainers.get(this._activeSidebarContainerId);
        active?.layout(sidebarW, sidebarH, Orientation.Vertical);
      } else {
        this._sidebarContainer.layout(sidebarW, sidebarH, Orientation.Vertical);
      }
    }
    if (this._panel.visible && this._panel.height > 0) {
      this._panelContainer.layout(this._panel.width, this._panel.height, Orientation.Horizontal);
      // Layout any contributed panel containers
      for (const vc of this._contributedPanelContainers.values()) {
        vc.layout(this._panel.width, this._panel.height, Orientation.Horizontal);
      }
    }
    if (this._auxBarVisible && this._auxiliaryBar.width > 0) {
      const auxHeaderH = 35;
      this._auxBarContainer?.layout(this._auxiliaryBar.width, this._auxiliaryBar.height - auxHeaderH, Orientation.Vertical);
      for (const vc of this._contributedAuxBarContainers.values()) {
        vc.layout(this._auxiliaryBar.width, this._auxiliaryBar.height - auxHeaderH, Orientation.Vertical);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Drag-and-Drop
  // ════════════════════════════════════════════════════════════════════════

  private _setupDragAndDrop(): DragAndDropController {
    const dnd = new DragAndDropController();

    dnd.registerTarget(this._sidebar.id, this._sidebar.element);
    dnd.registerTarget(this._editor.id, this._editor.element);
    dnd.registerTarget(this._panel.id, this._panel.element);
    dnd.registerTarget(this._auxiliaryBar.id, this._auxiliaryBar.element);

    for (const vc of this._builtinSidebarContainers.values()) {
      this._makeTabsDraggable(dnd, vc, this._sidebar.id);
    }
    this._makeTabsDraggable(dnd, this._panelContainer, this._panel.id);
    this._makeTabsDraggable(dnd, this._auxBarContainer, this._auxiliaryBar.id);

    dnd.onDropCompleted((result: DropResult) => {
      console.log('Drop completed:', result);
    });

    return dnd;
  }

  private _makeTabsDraggable(dnd: DragAndDropController, container: ViewContainer, partId: string): void {
    const tabBar = container.element.querySelector('.view-container-tabs');
    if (!tabBar) return;

    const wireExisting = () => {
      const tabs = tabBar.querySelectorAll('.view-tab');
      tabs.forEach((tab) => {
        const el = tab as HTMLElement;
        if (el.draggable) return;
        const viewId = el.dataset.viewId;
        if (!viewId) return;
        dnd.makeDraggable(el, { viewId, sourcePartId: partId });
      });
    };

    const observer = new MutationObserver(() => wireExisting());
    observer.observe(tabBar, { childList: true });
    this._tabObservers.push(observer);
    wireExisting();
  }

  // ── State helper ──

  private _setState(state: WorkbenchState): void {
    this._state = state;
    this._onDidChangeState.fire(state);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Workspace switch helpers
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Tear down workspace-specific content (views, containers, DnD)
   * while keeping the structural layout (grids, parts elements) intact.
   */
  private _teardownWorkspaceContent(): void {
    // 0. Disconnect tab MutationObservers
    for (const obs of this._tabObservers) obs.disconnect();
    this._tabObservers = [];

    // 0b. Clear view contribution event listeners (H7)
    this._viewContribListeners.clear();

    // 0c. Clear view contribution processor's internal maps so stale refs don't persist (M6)
    if (this._viewContribution) {
      for (const toolId of this._viewContribution.getContributedToolIds()) {
        this._viewContribution.removeContributions(toolId);
      }
    }

    // 1. Dispose DnD controller
    this._dndController?.dispose();

    // 2. Dispose view containers (which dispose their child views)
    for (const vc of this._builtinSidebarContainers.values()) vc.dispose();
    this._builtinSidebarContainers.clear();
    this._panelContainer?.dispose();
    this._auxBarContainer?.dispose();

    // 2b. Dispose contributed containers (Cap 6)
    for (const vc of this._contributedSidebarContainers.values()) vc.dispose();
    this._contributedSidebarContainers.clear();
    for (const vc of this._contributedPanelContainers.values()) vc.dispose();
    this._contributedPanelContainers.clear();
    for (const vc of this._contributedAuxBarContainers.values()) vc.dispose();
    this._contributedAuxBarContainers.clear();
    this._activeSidebarContainerId = undefined;
    this._sidebarHeaderLabel = undefined;

    // 3. Clear view container mount points in parts
    const sidebarViews = this._sidebar.element.querySelector('.sidebar-views') as HTMLElement;
    if (sidebarViews) sidebarViews.innerHTML = '';

    const panelViews = this._panel.element.querySelector('.panel-views') as HTMLElement;
    if (panelViews) panelViews.innerHTML = '';

    const auxBarPart = this._auxiliaryBar as unknown as AuxiliaryBarPart;
    const auxViewSlot = auxBarPart.viewContainerSlot;
    if (auxViewSlot) auxViewSlot.innerHTML = '';
    const auxHeaderSlot = auxBarPart.headerSlot;
    if (auxHeaderSlot) auxHeaderSlot.innerHTML = '';

    // 4. Clear activity bar icons (the Part structure stays, only icons are removed)
    for (const icon of this._activityBarPart.getIcons()) {
      this._activityBarPart.removeIcon(icon.id);
    }

    // 5. Dispose the view manager (disposes all remaining view instances)
    this._viewManager?.dispose();

    // 6. Dispose the workspace saver (cancel pending debounce)
    this._workspaceSaver?.dispose();
    this._workspaceSaver = new WorkspaceSaver(this._storage);

    // 7. Reset aux bar visibility tracking
    if (this._auxBarVisible) {
      try { this._hGrid.removeView(this._auxiliaryBar.id); } catch { /* ok */ }
      this._auxiliaryBar.setVisible(false);
      this._secondaryActivityBarEl.classList.add('hidden');
      this._auxBarVisible = false;
    }

    console.log('[Workbench] Torn down workspace content');
  }

  /**
   * Rebuild workspace-specific content after a switch.
   * Re-runs the same logic as Phase 3 (_initializeParts) but without
   * rebuilding the structural layout, titlebar, or status bar.
   */
  private _rebuildWorkspaceContent(): void {
    // 1. View system — register ALL descriptors, then create containers
    this._viewManager = new ViewManager();
    this._viewManager.registerMany(allPlaceholderViewDescriptors);
    this._viewManager.registerMany(allAuxiliaryBarViewDescriptors);

    this._sidebarContainer = this._setupSidebarViews();
    this._panelContainer = this._setupPanelViews();
    this._auxBarContainer = this._setupAuxBarViews();

    // 2. Aux bar toggle button
    this._addAuxBarToggle();

    // 3. DnD
    this._dndController = this._setupDragAndDrop();

    // 4. Layout view containers
    this._layoutViewContainers();

    // 5. Re-wire view contribution events (Cap 6)
    if (this._viewContribution) {
      // Update the ViewContribution's ViewManager reference to the new one
      // and re-register all existing view descriptors into the new ViewManager
      this._viewContribution.updateViewManager(this._viewManager);
      this._wireViewContributionEvents();

      // Replay view contributions for all already-registered tools so
      // contributed containers and views are re-created in the new DOM.
      const registry = this._services.get(IToolRegistryService) as unknown as ToolRegistry;
      if (registry) {
        for (const entry of registry.getAll()) {
          // Only replay container/view additions — the processor tracks
          // what it already knows and fires onDidAddContainer/onDidAddView
          // for items that need DOM re-creation.
          const contributes = entry.description.manifest.contributes;
          if (contributes?.viewContainers || contributes?.views) {
            // Remove then re-process to rebuild DOM via events
            this._viewContribution.removeContributions(entry.description.manifest.id);
            this._viewContribution.processContributions(entry.description);
          }
        }
      }
    }

    console.log('[Workbench] Rebuilt workspace content');
  }

  /**
   * Show a fade overlay during workspace switch.
   */
  private _showTransitionOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.classList.add('workspace-transition-overlay');
    overlay.textContent = 'Switching workspace…';
    this._container.appendChild(overlay);

    // Trigger fade-in
    requestAnimationFrame(() => { overlay.classList.add('visible'); });

    return overlay;
  }

  /**
   * Remove the transition overlay with a fade-out.
   */
  private _removeTransitionOverlay(overlay: HTMLElement): void {
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    // Safety fallback
    setTimeout(() => { if (overlay.parentElement) overlay.remove(); }, 300);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RecentWorkspaces — manages the persisted list of recent workspaces
// ════════════════════════════════════════════════════════════════════════════

/**
 * Manages a capped, ordered list of recently accessed workspaces.
 * Stored in global (non-workspace-specific) storage.
 */
export class RecentWorkspaces {
  private _maxSize: number;

  constructor(
    private readonly _storage: IStorage,
    maxSize = DEFAULT_MAX_RECENT_WORKSPACES,
  ) {
    this._maxSize = maxSize;
  }

  /**
   * Get all recent workspace entries, sorted by lastAccessedAt descending.
   */
  async getAll(): Promise<readonly RecentWorkspaceEntry[]> {
    try {
      const json = await this._storage.get(RECENT_WORKSPACES_KEY);
      if (!json) return [];

      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];

      return parsed as RecentWorkspaceEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Add (or update) a workspace in the recent list.
   * Moves it to the top and trims the list to maxSize.
   */
  async add(workspace: Workspace): Promise<void> {
    const list = await this._getList();

    // Remove existing entry with same ID
    const filtered = list.filter(e => e.identity.id !== workspace.id);

    // Prepend current workspace
    workspace.touch();
    const entry: RecentWorkspaceEntry = {
      identity: workspace.identity,
      metadata: workspace.metadata,
    };
    filtered.unshift(entry);

    // Trim to max
    const trimmed = filtered.slice(0, this._maxSize);
    await this._saveList(trimmed);
  }

  /**
   * Remove a workspace from the recent list.
   */
  async remove(workspaceId: string): Promise<void> {
    const list = await this._getList();
    const filtered = list.filter(e => e.identity.id !== workspaceId);
    await this._saveList(filtered);
  }

  /**
   * Clear the entire recent list.
   */
  async clear(): Promise<void> {
    await this._storage.delete(RECENT_WORKSPACES_KEY);
  }

  /**
   * Get the number of recent entries.
   */
  async count(): Promise<number> {
    const list = await this._getList();
    return list.length;
  }

  private async _getList(): Promise<RecentWorkspaceEntry[]> {
    try {
      const json = await this._storage.get(RECENT_WORKSPACES_KEY);
      if (!json) return [];
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async _saveList(list: RecentWorkspaceEntry[]): Promise<void> {
    await this._storage.set(RECENT_WORKSPACES_KEY, JSON.stringify(list));
  }
}
