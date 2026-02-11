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

import { Disposable, DisposableStore, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService, ICommandService, IContextKeyService, IEditorService, IEditorGroupService, ILayoutService, IViewService, IWorkspaceService, INotificationService, IActivationEventService, IToolErrorService, IToolActivatorService, IToolRegistryService } from '../services/serviceTypes.js';
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
import { CommandPalette } from '../commands/commandPalette.js';

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

// Service facades (Capability 0 gap cleanup)
import { LayoutService } from '../services/layoutService.js';
import { ViewService } from '../services/viewService.js';
import { WorkspaceService } from '../services/workspaceService.js';

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
import * as WelcomeTool from '../built-in/welcome/main.js';
import * as OutputTool from '../built-in/output/main.js';
import * as ToolGalleryTool from '../built-in/tool-gallery/main.js';
import type { IToolManifest, IToolDescription } from '../tools/toolManifest.js';
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

    // 3. Compute initial dimensions
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    const bodyH = h - TITLE_HEIGHT - STATUS_HEIGHT;
    const sidebarW = this._sidebar.visible ? DEFAULT_SIDEBAR_WIDTH : 0;
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

    // 8. Window resize handler
    window.addEventListener('resize', this._onWindowResize);

    // 9. Command system: wire up and register built-in commands
    this._initializeCommands();

    // 10. Context system (Capability 8): context keys, focus tracking, when-clause evaluation
    this._initializeContext();
  }

  /**
   * Initialize the command system: set workbench ref, register all builtin commands,
   * and create the command palette UI.
   */
  private _commandPalette: CommandPalette | undefined;
  private _initializeCommands(): void {
    const cmdService = this._services.get(ICommandService) as CommandService;
    cmdService.setWorkbench(this);
    this._register(registerBuiltinCommands(cmdService));

    // Command Palette — overlay UI for discovering and executing commands
    this._commandPalette = new CommandPalette(cmdService, this._container);
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

    // 8. Wire the command palette's when-clause filtering
    if (this._commandPalette) {
      this._commandPalette.setContextKeyService(this._contextKeyService);
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

    // Configure the saver with live sources so subsequent saves capture real state
    this._configureSaver();

    // Track as recent + persist active workspace ID
    await this._recentWorkspaces.add(this._workspace);
    await this._workspaceLoader.setActiveWorkspaceId(this._workspace.id);

    // Update context keys for workspace state
    if (this._workbenchContext) {
      this._workbenchContext.setWorkspaceLoaded(true);
      this._workbenchContext.setWorkbenchState(
        this._workspace.path ? 'folder' : 'workspace',
      );
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

    // 2. Restore view container states (tab order + active view)
    const containerMap = new Map<string, ViewContainer>([
      ['sidebar', this._sidebarContainer],
      ['panel', this._panelContainer],
    ]);
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

    const allContainers: ViewContainer[] = [this._sidebarContainer, this._panelContainer];
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

    // Task 1.1: Clicking workspace name opens Quick Access (for now toggles command palette)
    this._register(this._titlebar.onDidClickWorkspaceName(() => {
      this.toggleCommandPalette();
    }));

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
      { commandId: 'workbench.action.toggleStatusBar', title: 'Toggle Status Bar', group: '2_appearance', order: 4 },
    ]));

    // Register dropdown items for File menu
    this._register(this._titlebar.registerMenuBarDropdownItems('file', [
      { commandId: 'workspace.new', title: 'New Workspace…', group: '1_workspace', order: 1 },
      { commandId: 'workspace.openRecent', title: 'Open Recent…', group: '1_workspace', order: 2 },
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
    const container = new ViewContainer('sidebar');
    container.hideTabBar();

    const explorerView = this._viewManager.createViewSync('view.explorer')!;
    const searchView = this._viewManager.createViewSync('view.search')!;
    container.addView(explorerView);
    container.addView(searchView);

    // Activity bar: register built-in icons via ActivityBarPart (M3 Capability 0.2)
    const views = [
      { id: 'view.explorer', icon: '📁', label: 'Explorer' },
      { id: 'view.search', icon: '🔍', label: 'Search' },
    ];

    for (const v of views) {
      this._activityBarPart.addIcon({
        id: v.id,
        icon: v.icon,
        label: v.label,
        source: 'builtin',
      });
    }

    // Wire icon click events to switch views
    // VS Code reference: ViewContainerActivityAction.run()
    // - Click inactive icon → show sidebar + switch to that container
    // - Click active icon while sidebar visible → hide sidebar
    // - Click active icon while sidebar hidden → show sidebar
    this._register(this._activityBarPart.onDidClickIcon((event) => {
      const isAlreadyActive = event.iconId === this._activityBarPart.activeIconId;

      if (isAlreadyActive) {
        // Toggle sidebar visibility (VS Code parity: click active icon toggles sidebar)
        this._toggleSidebarVisibility();
        return;
      }

      if (event.source === 'builtin') {
        // Ensure sidebar is visible
        if (!this._sidebar.visible) {
          this._toggleSidebarVisibility();
        }
        // Switch back to built-in sidebar container if a contributed one is active
        if (this._activeSidebarContainerId) {
          this._switchSidebarContainer(undefined);
        }
        container.activateView(event.iconId);
        this._activityBarPart.setActiveIcon(event.iconId);
      } else if (event.source === 'contributed') {
        // Ensure sidebar is visible
        if (!this._sidebar.visible) {
          this._toggleSidebarVisibility();
        }
        // Switch to contributed sidebar container
        this._switchSidebarContainer(event.iconId);
      }
    }));

    // Activate the first icon by default
    this._activityBarPart.setActiveIcon('view.explorer');

    // Sidebar header label
    const headerSlot = this._sidebar.element.querySelector('.sidebar-header') as HTMLElement;
    if (headerSlot) {
      const headerLabel = document.createElement('span');
      headerLabel.classList.add('sidebar-header-label');
      headerLabel.textContent = 'EXPLORER';
      headerSlot.appendChild(headerLabel);

      // Store reference for dynamic container switching (Cap 6)
      this._sidebarHeaderLabel = headerLabel;

      container.onDidChangeActiveView((viewId) => {
        if (viewId) {
          const view = container.getView(viewId);
          headerLabel.textContent = (view?.name ?? 'EXPLORER').toUpperCase();
        }
      });
    }

    // Mount into sidebar's view slot
    const sidebarContent = this._sidebar.element.querySelector('.sidebar-views') as HTMLElement;
    if (sidebarContent) {
      sidebarContent.appendChild(container.element);
    }

    // NOTE: Do not call viewManager.showView() here — it bypasses
    // ViewContainer's tab-switching logic and makes both views visible.
    // The container's addView already activated the first view (Explorer).

    return container;
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
      watermark.innerHTML = `
        <div style="text-align: center; color: rgba(255,255,255,0.25);">
          <div style="font-size: 48px; margin-bottom: 16px;">⊞</div>
          <div style="font-size: 14px;">Parallx Workbench</div>
          <div style="font-size: 12px; margin-top: 4px;">No editors open</div>
        </div>
      `;
    }
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

    console.log('[Workbench] Editor services registered (Capability 9)');
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
    for (const vc of [this._sidebarContainer, this._panelContainer, this._auxBarContainer]) {
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
   * Mirrors logic from structuralCommands.ts toggleSidebar command.
   */
  private _toggleSidebarVisibility(): void {
    if (this._sidebar.visible) {
      this._hGrid.removeView(this._sidebar.id);
      this._sidebar.setVisible(false);
    } else {
      this._sidebar.setVisible(true);
      this._hGrid.addView(this._sidebar as any, 202, 0); // index 0 = leftmost in hGrid
    }
    this._hGrid.layout();
    this._layoutViewContainers();
  }

  /**
   * Switch the active sidebar container.
   *
   * @param containerId - ID of a contributed container, or `undefined` for the built-in default.
   */
  private _switchSidebarContainer(containerId: string | undefined): void {
    if (this._activeSidebarContainerId === containerId) return;

    // Hide current active container
    if (this._activeSidebarContainerId) {
      const current = this._contributedSidebarContainers.get(this._activeSidebarContainerId);
      current?.setVisible(false);
    } else {
      this._sidebarContainer.setVisible(false);
    }

    // Show new container
    this._activeSidebarContainerId = containerId;
    if (containerId) {
      const next = this._contributedSidebarContainers.get(containerId);
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
        const info = this._viewContribution.getContainer(containerId);
        this._sidebarHeaderLabel.textContent = (info?.title ?? 'SIDEBAR').toUpperCase();
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
    sb.addEntry({ id: 'branch', text: '⎇ master', alignment: StatusBarAlignment.Left, priority: 0, tooltip: 'Current branch' });
    sb.addEntry({ id: 'errors', text: '⊘ 0  ⚠ 0', alignment: StatusBarAlignment.Left, priority: 10, tooltip: 'Errors and warnings' });
    sb.addEntry({ id: 'line-col', text: 'Ln 1, Col 1', alignment: StatusBarAlignment.Right, priority: 100 });
    sb.addEntry({ id: 'encoding', text: 'UTF-8', alignment: StatusBarAlignment.Right, priority: 90 });
  }

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
        const contributed = this._contributedSidebarContainers.get(this._activeSidebarContainerId);
        contributed?.layout(sidebarW, sidebarH, Orientation.Vertical);
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

    this._makeTabsDraggable(dnd, this._sidebarContainer, this._sidebar.id);
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
    this._sidebarContainer?.dispose();
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
