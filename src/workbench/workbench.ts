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

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService, ICommandService } from '../services/serviceTypes.js';
import { LifecyclePhase, LifecycleService } from './lifecycle.js';
import { registerWorkbenchServices } from './workbenchServices.js';

// Parts
import { Part } from '../parts/part.js';
import { PartRegistry } from '../parts/partRegistry.js';
import { PartId } from '../parts/partTypes.js';
import { titlebarPartDescriptor } from '../parts/titlebarPart.js';
import { sidebarPartDescriptor, SidebarPart } from '../parts/sidebarPart.js';
import { editorPartDescriptor } from '../parts/editorPart.js';
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
import { registerBuiltinCommands } from '../commands/structuralCommands.js';
import { CommandPalette } from '../commands/commandPalette.js';

// Views
import { ViewManager } from '../views/viewManager.js';
import { ViewContainer } from '../views/viewContainer.js';
import { allPlaceholderViewDescriptors, allAuxiliaryBarViewDescriptors } from '../views/placeholderViews.js';
import { AuxiliaryBarPart } from '../parts/auxiliaryBarPart.js';

// DnD
import { DragAndDropController } from '../dnd/dragAndDrop.js';
import { DropResult } from '../dnd/dndTypes.js';

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
  private _activityBarEl!: HTMLElement;
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
  private _restoredState: WorkspaceState | undefined;

  // Part refs (cached after creation)
  private _titlebar!: Part;
  private _sidebar!: Part;
  private _editor!: Part;
  private _auxiliaryBar!: Part;
  private _panel!: Part;
  private _statusBar!: Part;

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
      this._secondaryActivityBarEl.style.display = 'none';
      this._auxBarVisible = false;
    } else {
      // Show: add to hGrid at the end (right of editor column)
      this._auxiliaryBar.setVisible(true);
      this._hGrid.addView(this._auxiliaryBar, DEFAULT_AUX_BAR_WIDTH);
      this._secondaryActivityBarEl.style.display = 'flex';
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
    if (this._workspace && this._workspace.id === targetId) {
      console.log('[Workbench] Already on workspace %s — no-op', targetId);
      return;
    }

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

    this.dispose();
    this._setState(WorkbenchState.Disposed);
    this._onDidShutdown.fire();
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

    // Phase 5: Ready — CSS hooks
    lc.onStartup(LifecyclePhase.Ready, () => {
      this._container.classList.add('parallx-workbench');
      this._container.classList.add('parallx-ready');
    });

    // ── Teardown (5→1) ──

    lc.onTeardown(LifecyclePhase.Ready, () => {
      this._container.classList.remove('parallx-ready');
    });

    lc.onTeardown(LifecyclePhase.WorkspaceRestore, async () => {
      // Save current layout dimensions via persistence
      await this._saveLayoutState();
    });

    lc.onTeardown(LifecyclePhase.Parts, () => {
      this._dndController?.dispose();
      this._viewManager?.dispose();
      this._workspaceSaver?.dispose();
    });

    lc.onTeardown(LifecyclePhase.Layout, () => {
      this._hGrid?.dispose();
      this._vGrid?.dispose();
      this._partRegistry?.dispose();
      this._layoutRenderer?.dispose();
    });

    lc.onTeardown(LifecyclePhase.Services, () => {
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
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2 — Layout: create parts, build grids, assemble DOM
  // ════════════════════════════════════════════════════════════════════════

  private _initializeLayout(): void {
    // 1. Create part registry and register all standard parts
    this._partRegistry = this._register(new PartRegistry());
    this._partRegistry.registerMany([
      titlebarPartDescriptor,
      sidebarPartDescriptor,
      editorPartDescriptor,
      auxiliaryBarPartDescriptor,
      panelPartDescriptor,
      statusBarPartDescriptor,
    ]);
    this._partRegistry.createAll();

    // 2. Cache part references
    this._titlebar = this._partRegistry.requirePart(PartId.Titlebar) as Part;
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
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);

    this._titlebar.create(tempDiv);
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

    // 8. Body row: activityBar + hGrid
    this._bodyRow = document.createElement('div');
    this._bodyRow.classList.add('workbench-middle');

    this._activityBarEl = document.createElement('div');
    this._activityBarEl.classList.add('activity-bar');
    this._bodyRow.appendChild(this._activityBarEl);

    // Hide the sidebar's internal activity bar slot
    const internalActivityBar = this._sidebar.element.querySelector('.sidebar-activity-bar') as HTMLElement;
    if (internalActivityBar) {
      internalActivityBar.style.display = 'none';
    }

    this._bodyRow.appendChild(this._hGrid.element);
    this._hGrid.element.style.flex = '1 1 0';
    this._hGrid.element.style.minWidth = '0';
    this._hGrid.element.style.minHeight = '0';

    this._editorColumnAdapter.element.appendChild(this._vGrid.element);
    this._vGrid.element.style.width = '100%';
    this._vGrid.element.style.height = '100%';
    this._vGrid.element.style.minHeight = '0';

    // 9. Assemble final DOM
    this._container.appendChild(this._titlebar.element);
    this._titlebar.layout(w, TITLE_HEIGHT, Orientation.Horizontal);

    this._container.appendChild(this._bodyRow);
    this._bodyRow.style.flex = '1 1 0';
    this._bodyRow.style.minHeight = '0';

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
  }

  /**
   * Initialize the command system: set workbench ref, register all builtin commands,
   * and create the command palette UI.
   */
  private _initializeCommands(): void {
    const cmdService = this._services.get(ICommandService) as CommandService;
    cmdService.setWorkbench(this);
    this._register(registerBuiltinCommands(cmdService));

    // Command Palette — overlay UI for discovering and executing commands
    const palette = new CommandPalette(cmdService, this._container);
    this._register(palette);

    console.log(
      '[Workbench] Registered %d built-in commands, command palette ready',
      cmdService.getCommands().size,
    );
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

    // Wire auto-save on structural changes
    this._hGrid.onDidChange(() => this._workspaceSaver.requestSave());
    this._vGrid.onDidChange(() => this._workspaceSaver.requestSave());
  }

  // ════════════════════════════════════════════════════════════════════════
  // Window resize handler (arrow fn keeps `this` binding)
  // ════════════════════════════════════════════════════════════════════════

  private _onWindowResize = (): void => {
    const rw = this._container.clientWidth;
    const rh = this._container.clientHeight;
    const rbodyH = rh - TITLE_HEIGHT - STATUS_HEIGHT;

    this._titlebar.layout(rw, TITLE_HEIGHT, Orientation.Horizontal);
    this._statusBar.layout(rw, STATUS_HEIGHT, Orientation.Horizontal);

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
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';

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
        wrapper.style.display = visible ? 'flex' : 'none';
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
  // Titlebar setup
  // ════════════════════════════════════════════════════════════════════════

  private _setupTitlebar(): void {
    const el = this._titlebar.element;

    // Left: app icon + menu bar
    const leftSlot = el.querySelector('.titlebar-left') as HTMLElement;
    if (leftSlot) {
      leftSlot.classList.add('titlebar-menubar');

      const appIcon = document.createElement('span');
      appIcon.textContent = '⊞';
      appIcon.classList.add('titlebar-app-icon');
      leftSlot.appendChild(appIcon);

      const menuItems = ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'];
      for (const label of menuItems) {
        const item = document.createElement('span');
        item.textContent = label;
        item.classList.add('titlebar-menu-item');
        leftSlot.appendChild(item);
      }
    }

    // Right: window controls
    const rightSlot = el.querySelector('.titlebar-right') as HTMLElement;
    if (rightSlot) {
      const controls = document.createElement('div');
      controls.classList.add('window-controls');

      const makeBtn = (label: string, action: () => void, hoverColor?: string): HTMLElement => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.classList.add('window-control-btn');
        btn.addEventListener('click', action);
        if (hoverColor) {
          btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = hoverColor));
          btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = ''));
        }
        return btn;
      };

      const api = (window as any).parallxElectron;
      if (api) {
        controls.appendChild(makeBtn('─', () => api.minimize(), 'rgba(255,255,255,0.1)'));
        controls.appendChild(makeBtn('□', () => api.maximize(), 'rgba(255,255,255,0.1)'));
        controls.appendChild(makeBtn('✕', () => api.close(), '#e81123'));
      }

      rightSlot.appendChild(controls);
    }
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

    // Activity bar: vertical icon strip
    const views = [
      { id: 'view.explorer', icon: '📁', label: 'Explorer' },
      { id: 'view.search', icon: '🔍', label: 'Search' },
    ];

    for (const v of views) {
      const btn = document.createElement('button');
      btn.classList.add('activity-bar-item');
      btn.dataset.viewId = v.id;
      btn.title = v.label;
      btn.textContent = v.icon;
      btn.addEventListener('click', () => {
        container.activateView(v.id);
        this._activityBarEl.querySelectorAll('.activity-bar-item').forEach((el) =>
          el.classList.toggle('active', el === btn),
        );
      });
      this._activityBarEl.appendChild(btn);
    }

    this._activityBarEl.querySelector('.activity-bar-item')?.classList.add('active');

    // Sidebar header label
    const headerSlot = this._sidebar.element.querySelector('.sidebar-header') as HTMLElement;
    if (headerSlot) {
      const headerLabel = document.createElement('span');
      headerLabel.classList.add('sidebar-header-label');
      headerLabel.textContent = 'EXPLORER';
      headerSlot.appendChild(headerLabel);

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
    // Add a spacer + toggle button at the bottom of the primary activity bar
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this._activityBarEl.appendChild(spacer);

    const toggleBtn = document.createElement('button');
    toggleBtn.classList.add('activity-bar-item');
    toggleBtn.title = 'Toggle Secondary Side Bar';
    toggleBtn.textContent = '⊞';
    toggleBtn.addEventListener('click', () => {
      this.toggleAuxiliaryBar();
      toggleBtn.classList.toggle('active', this._auxBarVisible);
    });
    this._activityBarEl.appendChild(toggleBtn);
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
    this._secondaryActivityBarEl.classList.add('secondary-activity-bar');
    // Hidden by default (aux bar starts hidden)
    this._secondaryActivityBarEl.style.display = 'none';

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
      this._sidebarContainer.layout(this._sidebar.width, this._sidebar.height - headerH, Orientation.Vertical);
    }
    if (this._panel.visible && this._panel.height > 0) {
      this._panelContainer.layout(this._panel.width, this._panel.height, Orientation.Horizontal);
    }
    if (this._auxBarVisible && this._auxiliaryBar.width > 0) {
      const auxHeaderH = 35;
      this._auxBarContainer?.layout(this._auxiliaryBar.width, this._auxiliaryBar.height - auxHeaderH, Orientation.Vertical);
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
    // 1. Dispose DnD controller
    this._dndController?.dispose();

    // 2. Dispose view containers (which dispose their child views)
    this._sidebarContainer?.dispose();
    this._panelContainer?.dispose();
    this._auxBarContainer?.dispose();

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

    // 4. Clear activity bar view items (keep the structure, remove buttons)
    const activityItems = this._activityBarEl.querySelectorAll('.activity-bar-item');
    activityItems.forEach(el => el.remove());
    // Remove spacer too
    while (this._activityBarEl.firstChild) {
      this._activityBarEl.removeChild(this._activityBarEl.firstChild);
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
      this._secondaryActivityBarEl.style.display = 'none';
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

    console.log('[Workbench] Rebuilt workspace content');
  }

  /**
   * Show a fade overlay during workspace switch.
   */
  private _showTransitionOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.classList.add('workspace-transition-overlay');
    overlay.style.cssText = `
      position: absolute; inset: 0; z-index: 10000;
      background: #1e1e1e; opacity: 0;
      transition: opacity 120ms ease-in;
      pointer-events: all;
      display: flex; align-items: center; justify-content: center;
      color: rgba(255,255,255,0.5); font-size: 14px;
    `;
    overlay.textContent = 'Switching workspace…';
    this._container.appendChild(overlay);

    // Trigger fade-in
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    return overlay;
  }

  /**
   * Remove the transition overlay with a fade-out.
   */
  private _removeTransitionOverlay(overlay: HTMLElement): void {
    overlay.style.opacity = '0';
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
