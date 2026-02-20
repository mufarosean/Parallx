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

import { DisposableStore, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { addDisposableListener } from '../ui/dom.js';
import { Emitter, Event } from '../platform/events.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { URI } from '../platform/uri.js';
import { ILifecycleService, ICommandService, IContextKeyService, IEditorService, IEditorGroupService, INotificationService, IActivationEventService, IToolErrorService, IToolActivatorService, IToolRegistryService, IToolEnablementService, IWindowService, IFileService, ITextFileModelManager, IThemeService, IKeybindingService } from '../services/serviceTypes.js';
import { LifecyclePhase, LifecycleService } from './lifecycle.js';
import { registerWorkbenchServices, registerConfigurationServices } from './workbenchServices.js';

// Layout base class (VS Code: Layout → Workbench extends Layout)
import {
  Layout,
  PART_HEADER_HEIGHT_PX,
} from './layout.js';

// Parts
import { Part } from '../parts/part.js';
import { PartId } from '../parts/partTypes.js';
import { EditorPart } from '../parts/editorPart.js';
import { StatusBarPart } from '../parts/statusBarPart.js';

// Layout
import { Orientation } from '../layout/layoutTypes.js';
import { LayoutRenderer } from '../layout/layoutRenderer.js';

// Storage + Persistence
import { LocalStorage, NamespacedStorage, IStorage } from '../platform/storage.js';

// Workspace
import { Workspace } from '../workspace/workspace.js';
import { RecentWorkspaces } from '../workspace/recentWorkspaces.js';
import { WorkspaceLoader } from '../workspace/workspaceLoader.js';
import { WorkspaceSaver } from '../workspace/workspaceSaver.js';
import {
  WorkspaceState,
  createDefaultEditorSnapshot,
  workspaceStorageKey,
} from '../workspace/workspaceTypes.js';
import { createDefaultLayoutState } from '../layout/layoutModel.js';

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

// Service facades (Capability 0 gap cleanup)
import { registerFacadeServices } from './workbenchFacadeFactory.js';
import type { FacadeFactoryHost } from './workbenchFacadeFactory.js';
import { WindowService } from '../services/windowService.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { EditableContextMenu } from '../contributions/editableContextMenu.js';

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

// Tool Scanner — external tool discovery (M6 Capability 0)
import { ToolScanner } from '../tools/toolScanner.js';

// Configuration (M2 Capability 4)
import type { ConfigurationService } from '../configuration/configurationService.js';
import type { ConfigurationRegistry } from '../configuration/configurationRegistry.js';

// Tool Enablement (M6 Capability 0)
import { ToolEnablementService } from '../tools/toolEnablementService.js';

// Database Service (M6 Capability 1)
import { DatabaseService } from '../services/databaseService.js';
import { IDatabaseService } from '../services/serviceTypes.js';

// Contribution Processors (M2 Capability 5)
import { registerContributionProcessors, registerViewContributionProcessor } from './workbenchServices.js';
import { formatKeybindingForDisplay } from '../contributions/keybindingContribution.js';
import type { MenuContributionProcessor } from '../contributions/menuContribution.js';

// Keybinding Service (M3 Capability 0.3)
import type { KeybindingService } from '../services/keybindingService.js';

// View Contribution (M2 Capability 6)
import { ViewContributionProcessor } from '../contributions/viewContribution.js';

// Contribution handler (D.1 extraction)
import { WorkbenchContributionHandler } from './workbenchContributionHandler.js';

// Built-in Tools (M2 Capability 7)
import * as ExplorerTool from '../built-in/explorer/main.js';
import * as SearchTool from '../built-in/search/main.js';
import * as WelcomeTool from '../built-in/welcome/main.js';
import * as OutputTool from '../built-in/output/main.js';
import * as ToolGalleryTool from '../built-in/tool-gallery/main.js';
import * as FileEditorTool from '../built-in/editor/main.js';
import * as CanvasTool from '../built-in/canvas/main.js';
import type { IToolManifest, IToolDescription } from '../tools/toolManifest.js';
import {
  EXPLORER_MANIFEST,
  SEARCH_MANIFEST,
  TEXT_EDITOR_MANIFEST,
  WELCOME_MANIFEST,
  OUTPUT_MANIFEST,
  TOOL_GALLERY_MANIFEST,
  CANVAS_MANIFEST,
} from '../tools/builtinManifests.js';

// File Editor Resolver (M4 Capability 4)
import { initFileEditorSetup } from './workbenchFileEditorSetup.js';


// Theme System (M5 Capability 1–3)
import { colorRegistry } from '../theme/colorRegistry.js';
import '../theme/workbenchColors.js'; // side-effect: registers all color tokens
import { ThemeService } from '../services/themeService.js';
import {
  findThemeById,
  resolveTheme,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
} from '../theme/themeCatalog.js';
import { showColorThemePicker } from './workbenchThemePicker.js';
import { setupEditorWatermark, updateWatermarkKeybindings } from './workbenchWatermark.js';
import { $ } from '../ui/dom.js';

// Extracted modules (Fix 2.1 — decompose workbench.ts)
import { MenuBuilder } from './menuBuilder.js';
import { StatusBarController } from './statusBarController.js';

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
 *
 * VS Code alignment: extends Layout which owns the grid system, part
 * references, and layout-mutation methods (toggle sidebar/panel/etc).
 * Workbench adds service wiring, tool registration, and lifecycle.
 */
export class Workbench extends Layout {
  private _state: WorkbenchState = WorkbenchState.Created;
  private readonly _services: ServiceCollection;
  private _lifecycle: LifecycleService | undefined;

  // ── Subsystem instances ──

  // Extracted controllers (Fix 2.1)
  private _menuBuilder!: MenuBuilder;
  private _statusBarController!: StatusBarController;

  // Contribution handler (D.1 extraction — owns container maps, contribution events)
  private _contributionHandler!: WorkbenchContributionHandler;

  private _viewManager!: ViewManager;
  private _dndController!: DragAndDropController;
  private _sidebarContainer!: ViewContainer;
  private _panelContainer!: ViewContainer;
  private _auxBarContainer!: ViewContainer;
  private _secondaryActivityBarEl!: HTMLElement;

  // Storage + Persistence
  private _storage!: IStorage;
  private _layoutRenderer!: LayoutRenderer;

  // Workspace
  private _workspace!: Workspace;
  private _switching = false;
  private _workspaceLoader!: WorkspaceLoader;
  private _workspaceSaver!: WorkspaceSaver;
  private _saverListeners = this._register(new DisposableStore());
  private _restoredState: WorkspaceState | undefined;

  // Context (Capability 8)
  private _contextKeyService!: ContextKeyService;
  private _focusTracker!: FocusTracker;
  private _workbenchContext!: WorkbenchContextManager;

  // Tool Lifecycle (M2 Capability 3)
  private _toolActivator!: ToolActivator;

  // Tool Enablement (M6 Capability 0)
  private _toolEnablementService!: ToolEnablementService;
  /** Cached built-in tool modules for re-activation after disable→enable. */
  private readonly _builtinModules = new Map<string, { activate: Function; deactivate?: Function }>();

  // Database Service (M6 Capability 1)
  private _databaseService!: DatabaseService;

  // Configuration (M2 Capability 4)
  private _configService!: ConfigurationService;
  private _configRegistry!: ConfigurationRegistry;
  private _globalStorage!: IStorage;

  // Contribution Processors (M2 Capability 5)
  private _menuContribution!: MenuContributionProcessor;

  // View Contribution (M2 Capability 6)
  private _viewContribution!: ViewContributionProcessor;

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

  // Active file watchers for workspace folders (M4 — file watcher → tree refresh)
  private readonly _folderWatchers = new Map<string, IDisposable>();

  constructor(
    container: HTMLElement,
    services?: ServiceCollection,
  ) {
    super(container);
    this._services = services ?? new ServiceCollection();
    this._register(this._services);
  }

  // ── Public API ──

  get state(): WorkbenchState { return this._state; }
  get services(): ServiceCollection { return this._services; }

  /**
   * Toggle visibility of the auxiliary bar (secondary sidebar).
   * Overrides Layout to handle secondary activity bar element + content setup.
   */
  override toggleAuxiliaryBar(): void {
    super.toggleAuxiliaryBar();

    // Secondary activity bar element visibility
    if (this._auxBarVisible) {
      this._secondaryActivityBarEl.classList.remove('hidden');
      // Ensure the aux bar content is populated
      if (!this._auxBarContainer) {
        this._auxBarContainer = this._setupAuxBarViews();
      }
    } else {
      this._secondaryActivityBarEl.classList.add('hidden');
    }
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

  /**
   * Open Quick Access in go-to-line mode (':' prefix).
   * VS Code parity: `workbench.action.gotoLine` (Ctrl+G).
   */
  showGoToLine(): void {
    if (this._commandPalette) {
      this._commandPalette.show(':');
    }
  }

  /**
   * Show a quick pick for selecting the active color theme.
   * Delegates to the extracted workbenchThemePicker module.
   */
  selectColorTheme(): void {
    const themeService = this._services.get(IThemeService) as ThemeService | undefined;
    if (!themeService) return;
    showColorThemePicker(this._container, themeService);
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
   *
   * @param cloneState  When provided, the new workspace is persisted with
   *                    this state (identity/metadata overwritten) instead of
   *                    a blank default.  Used by "Save As" and "Duplicate".
   */
  async createWorkspace(
    name: string,
    path?: string,
    switchTo = true,
    cloneState?: import('../workspace/workspaceTypes.js').WorkspaceState,
  ): Promise<Workspace> {
    const ws = Workspace.create(name, path);

    // Persist it immediately so it has an entry in storage.
    // If a cloneState was provided, stamp it with the new identity;
    // otherwise create a blank default state.
    let state: import('../workspace/workspaceTypes.js').WorkspaceState;
    if (cloneState) {
      state = {
        ...cloneState,
        identity: ws.identity,
        metadata: ws.metadata,
      };
    } else {
      state = ws.createDefaultState(
        this._container.clientWidth,
        this._container.clientHeight,
      );
    }
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
    if (this._switching) {
      console.warn('[Workbench] Workspace switch already in progress — ignoring');
      return;
    }
    if (this._workspace && this._workspace.id === targetId) {
      console.log('[Workbench] Already on workspace %s — no-op', targetId);
      return;
    }

    this._switching = true;
    console.log('[Workbench] Switching workspace → %s', targetId);
    const overlay = this._showTransitionOverlay();

    try {
      // 1. Save current workspace
      await this._workspaceSaver.save();

      // 1b. Save view providers BEFORE teardown. removeContributions() in
      //     teardown deletes _providers, but tools don't re-activate after a
      //     switch — their registerViewProvider() call was one-time during
      //     initial activation. We must preserve and re-apply them.
      const savedProviders = this._viewContribution
        ? this._viewContribution.getProviders()
        : new Map();

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
      this._rebuildWorkspaceContent(savedProviders);

      // 5. Apply restored state
      this._applyRestoredState();

      // 5b. Fire workspace-switch event BEFORE restoring folders.
      //     WorkspaceService._bindFolderEvents must subscribe to the new
      //     workspace's onDidChangeFolders BEFORE restoreFolders fires it,
      //     otherwise the Explorer never learns about restored folders.
      this._onDidSwitchWorkspace.fire(this._workspace);

      // 5c. Now restore workspace folders — the event flows through
      //     WorkspaceService → WorkspaceBridge → Explorer → rebuildTree().
      if (this._restoredState?.folders) {
        this._workspace.restoreFolders(this._restoredState.folders);
      }

      // 6. Re-configure the saver for the new workspace
      this._configureSaver();

      // 7. Update recent workspaces and active ID
      await this._recentWorkspaces.add(this._workspace);
      await this._workspaceLoader.setActiveWorkspaceId(this._workspace.id);

      console.log('[Workbench] Switched to workspace "%s"', this._workspace.name);
    } catch (err) {
      console.error('[Workbench] Workspace switch failed:', err);
    } finally {
      this._switching = false;
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

  /**
   * Push current workspace folders to the editor part so breadcrumbs
   * can display workspace-relative paths.
   */
  private _updateEditorBreadcrumbs(): void {
    if (!this._editor || !this._workspace) return;
    const editorPart = this._editor as EditorPart;
    const folders = this._workspace.folders.map(f => ({ uri: f.uri, name: f.name }));
    editorPart.setWorkspaceFolders(folders);
  }

  /**
   * Start file watchers for all workspace folders.
   * When folders change (added/removed), update watchers accordingly.
   * File change events flow through IFileService.onDidFileChange.
   */
  private _startWorkspaceFolderWatchers(): void {
    if (!this._services.has(IFileService)) return;
    const fileService = this._services.get(IFileService);

    // Watch each current folder
    const watchFolder = async (folderUri: string) => {
      if (this._folderWatchers.has(folderUri)) return;
      try {
        const uri = URI.parse(folderUri);
        const disposable = await fileService.watch(uri);
        this._folderWatchers.set(folderUri, disposable);
        console.log('[Workbench] Started file watcher for:', folderUri);
      } catch (err) {
        console.warn('[Workbench] Failed to start file watcher for:', folderUri, err);
      }
    };

    const unwatchFolder = (folderUri: string) => {
      const d = this._folderWatchers.get(folderUri);
      if (d) {
        d.dispose();
        this._folderWatchers.delete(folderUri);
      }
    };

    // Watch existing folders
    for (const folder of this._workspace.folders) {
      watchFolder(folder.uri.toString());
    }

    // React to folder additions/removals
    this._register(this._workspace.onDidChangeFolders((e: any) => {
      if (e.added) {
        for (const f of e.added) {
          watchFolder(typeof f.uri === 'string' ? f.uri : f.uri.toString());
        }
      }
      if (e.removed) {
        for (const f of e.removed) {
          unwatchFolder(typeof f.uri === 'string' ? f.uri : f.uri.toString());
        }
      }
    }));

    // Cleanup all watchers on dispose
    this._register({ dispose: () => {
      for (const d of this._folderWatchers.values()) {
        d.dispose();
      }
      this._folderWatchers.clear();
    }});
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

    // Window resize listener cleaned up by _register(addDisposableListener(...))

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

      // Universal right-click context menu for all editable text surfaces
      this._register(new EditableContextMenu());

      // Initialize tool activator and fire startup finished
      await this._initializeToolLifecycle();
    });

    // ── Teardown (5→1) ──

    lc.onTeardown(LifecyclePhase.Ready, async () => {
      this._container.classList.remove('parallx-ready');
      // Async disposal: awaits all tool deactivations before synchronous cleanup
      if (this._toolActivator) {
        await this._toolActivator.disposeAsync();
      }
      // Close the database cleanly
      if (this._databaseService?.isOpen) {
        await this._databaseService.close();
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
    // (handled by WorkspaceSaver — LayoutPersistence not needed directly)

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

    // ── Theme Service (M5 Capability 3) ──
    // Must be applied before layout rendering to avoid flash of unstyled content.
    // workbenchColors.ts import above ensures all tokens are registered.
    // Restore persisted theme or fall back to Dark Modern.
    const persistedThemeId = localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
    const themeEntry = findThemeById(persistedThemeId) ?? findThemeById(DEFAULT_THEME_ID)!;
    const themeData = resolveTheme(themeEntry, colorRegistry);
    const themeService = this._register(new ThemeService(colorRegistry, themeData));
    themeService.applyTheme(themeData);
    this._services.registerInstance(IThemeService, themeService);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2 — Layout: delegated to base class (Layout._initializeLayout)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Hook called by Layout._initializeLayout() after parts are registered
   * but before Part.create().  Injects IWindowService into the titlebar.
   */
  protected override _onBeforePartsCreated(): void {
    this._titlebar.setWindowService(this._services.get(IWindowService));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 3 — Parts: populate content, views, DnD, status bar
  // ════════════════════════════════════════════════════════════════════════

  private _initializeParts(): void {
    // 0. Create extracted controllers
    this._menuBuilder = this._register(new MenuBuilder({
      titlebar: this._titlebar,
      activityBarPart: this._activityBarPart,
      services: this._services,
      selectColorTheme: () => this.selectColorTheme(),
    }));
    this._statusBarController = this._register(new StatusBarController({
      statusBar: this._statusBar as unknown as StatusBarPart,
      editorPart: this._editor as EditorPart,
      services: this._services,
      container: this._container,
      keybindingHint: (cmd) => this._keybindingHint(cmd),
      toggleStatusBar: () => this.toggleStatusBar(),
      getWorkspace: () => this._workspace,
      getWorkbenchContext: () => this._workbenchContext,
    }));

    // Contribution handler (D.1 extraction — view container/contribution event management)
    this._contributionHandler = this._register(new WorkbenchContributionHandler({
      sidebar: this._sidebar,
      panel: this._panel,
      auxiliaryBar: this._auxiliaryBar,
      activityBarPart: this._activityBarPart,
      toggleSidebar: () => this.toggleSidebar(),
      layoutViewContainers: () => this._layoutViewContainers(),
    }));
    this._contributionHandler.setWorkbenchContext(this._workbenchContext);

    // 1. Titlebar: app icon + menu bar + window controls
    this._setupTitlebar();

    // 2. View system — register ALL descriptors before creating any views
    this._viewManager = new ViewManager();
    this._viewManager.registerMany(allPlaceholderViewDescriptors);
    this._viewManager.registerMany(allAuxiliaryBarViewDescriptors);

    this._sidebarContainer = this._setupSidebarViews();
    this._panelContainer = this._setupPanelViews();
    this._auxBarContainer = this._setupAuxBarViews();

    // Wire generic containers + view manager into contribution handler
    this._contributionHandler.setViewManager(this._viewManager);
    this._contributionHandler.setGenericContainers(this._sidebarContainer, this._panelContainer, this._auxBarContainer);
    this._contributionHandler.panelViewsSlot = this._panel.element.querySelector('.panel-views') as HTMLElement;

    // 2b. Secondary activity bar (right edge, for aux bar views)
    this._setupSecondaryActivityBar();

    // 3. Editor watermark
    this._setupEditorWatermark();

    // 3b. Register editor services (EditorPart exists after Phase 2)
    this._registerEditorServices();

    // 3c. Register facade services (grids, ViewManager, workspace exist)
    this._registerFacadeServices();

    // 4. Status bar entries
    this._statusBarController.setupStatusBar();

    // 4c. Manage gear icon in activity bar (bottom) — VS Code parity
    this._menuBuilder.addManageGearIcon();

    // 5. DnD between parts
    this._dndController = this._setupDragAndDrop();

    // 6. Layout view containers + wire grid sash handlers (from Layout base)
    this._layoutViewContainers();
    this._wireGridHandlers();

    // 7. Window resize handler
    this._register(addDisposableListener(window, 'resize', this._onWindowResize));

    // 8. Command system: wire up and register built-in commands
    this._initializeCommands();

    // 9. Context system (Capability 8): context keys, focus tracking, when-clause evaluation
    this._initializeContext();

    // 9b. Subscribe to Layout events for context key updates
    this._register(this.onDidChangeZenMode((active) => {
      this._workbenchContext.setZenMode(active);
    }));
    this._register(this.onDidChangePanelMaximized((maximized) => {
      this._workbenchContext.setPanelMaximized(maximized);
    }));
    this._register(this.onDidChangePartVisibility(({ partId }) => {
      if (partId === PartId.StatusBar) {
        this._workspaceSaver?.requestSave();
      }
    }));

    // 10. Wire view/title actions and context menus to stacked containers
    for (const vc of this._contributionHandler.builtinSidebarContainers.values()) {
      this._wireSectionMenus(vc as ViewContainer);
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

    // Wire editor group service for Go to Line provider
    const editorGroupSvc = this._services.get(IEditorGroupService);
    if (editorGroupSvc && this._commandPalette) {
      this._commandPalette.setEditorGroupService(editorGroupSvc);
    }

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

    // Persist the initial state so there is always a storage entry for the
    // active workspace. Without this, first-launch windows (or test-mode with
    // cleared localStorage) have an activeWorkspaceId but no matching state blob.
    await this._workspaceSaver.save();

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
        this._statusBarController.updateWindowTitle();
        // Update breadcrumbs in editor groups
        this._updateEditorBreadcrumbs();
      }));
    }

    // Push workspace folders to editor part for breadcrumbs
    this._updateEditorBreadcrumbs();

    // Start file watchers for workspace folders (M4 — file watcher → tree refresh)
    this._startWorkspaceFolderWatchers();

    // Load persisted configuration values (Cap 4)
    if (this._configService) {
      await this._configService.load();
    }

    // Phase 4 may have replaced this._workspace with a deserialized object.
    // Fire onDidSwitchWorkspace so that the WorkspaceService (and any other
    // listener) re-binds its event subscriptions to the live workspace.
    this._onDidSwitchWorkspace.fire(this._workspace);
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

    // 1. Restore part visibility and sizes.
    // Parts that live inside grids (sidebar, panel, aux bar) must use
    // their toggle methods — not bare setVisible() — so the grid adds
    // or removes the view correctly. A bare setVisible() only flips the
    // CSS class and leaves the grid allocating space for a hidden part,
    // causing the editor not to fill the full height when the panel was
    // hidden at save-time.
    for (const partSnap of state.parts) {
      const part = this._partRegistry.getPart(partSnap.partId) as Part | undefined;
      if (!part) continue;

      // Restore visibility — use toggle methods for grid-managed parts
      if (part.visible !== partSnap.visible) {
        switch (partSnap.partId) {
          case PartId.AuxiliaryBar:
            this.toggleAuxiliaryBar();
            break;
          case PartId.Panel:
            this.togglePanel();
            break;
          case PartId.Sidebar:
            // Sidebar toggle has animation; skip it during restore.
            // Directly remove from grid + set invisible.
            if (part.visible && !partSnap.visible) {
              this._hGrid.removeView(this._sidebar.id);
              part.setVisible(false);
              this._hGrid.layout();
            } else if (!part.visible && partSnap.visible) {
              part.setVisible(true);
              this._hGrid.addView(this._sidebar as any, this._lastSidebarWidth, 0);
              this._hGrid.layout();
            }
            break;
          case PartId.StatusBar:
            this.toggleStatusBar();
            break;
          default:
            part.setVisible(partSnap.visible);
            break;
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

    // 1b. Restore sidebar width — always remember the saved width so that
    //     toggleSidebar() uses it when the user re-shows the sidebar.
    //     Only resize the live grid when the sidebar is currently visible.
    const sidebarSnap = state.parts.find(p => p.partId === PartId.Sidebar);
    if (sidebarSnap?.width && sidebarSnap.width > 0) {
      this._lastSidebarWidth = sidebarSnap.width;
      if (this._sidebar.visible) {
        const currentWidth = this._hGrid.getViewSize(this._sidebar.id);
        if (currentWidth !== undefined && currentWidth !== sidebarSnap.width) {
          const delta = sidebarSnap.width - currentWidth;
          this._hGrid.resizeSash(this._hGrid.root, 0, delta);
          this._hGrid.layout();
        }
      }
    }

    // 1c. Restore panel height — always remember the saved height so that
    //     togglePanel() uses it when the user re-shows the panel.
    //     Only resize the live grid when the panel is currently visible.
    //     Panel is childB (index 1, below the editor). resizeSash positive
    //     delta grows childA (editor), so to grow the panel we negate.
    const panelSnap = state.parts.find(p => p.partId === PartId.Panel);
    if (panelSnap?.height && panelSnap.height > 0) {
      this._lastPanelHeight = panelSnap.height;
      if (this._panel.visible) {
        const currentHeight = this._vGrid.getViewSize(this._panel.id);
        if (currentHeight !== undefined && currentHeight !== panelSnap.height) {
          const delta = currentHeight - panelSnap.height;
          this._vGrid.resizeSash(this._vGrid.root, 0, delta);
          this._vGrid.layout();
        }
      }
    }

    // 1d. Restore auxiliary bar width — always remember the saved width so
    //     that toggleAuxiliaryBar() uses it when the user re-shows the bar.
    //     Only resize the live grid when the aux bar is currently visible.
    //     Aux bar is childB (right of its sash). resizeSash positive delta
    //     grows childA (editor column), so to grow the aux bar we negate.
    const auxBarSnap = state.parts.find(p => p.partId === PartId.AuxiliaryBar);
    if (auxBarSnap?.width && auxBarSnap.width > 0) {
      this._lastAuxBarWidth = auxBarSnap.width;
      if (this._auxBarVisible) {
        // Aux bar is the last child in hGrid; its sash is at index childCount - 2
        const auxSashIndex = this._hGrid.root.childCount - 2;
        const currentWidth = this._hGrid.getViewSize(this._auxiliaryBar.id);
        if (currentWidth !== undefined && currentWidth !== auxBarSnap.width) {
          const delta = currentWidth - auxBarSnap.width;
          this._hGrid.resizeSash(this._hGrid.root, auxSashIndex, delta);
          this._hGrid.layout();
        }
      }
    }

    // 2. Restore view container states (tab order + active view)
    const containerMap = new Map<string, ViewContainer>([
      ['sidebar', this._sidebarContainer],
      ['panel', this._panelContainer],
    ]);
    // Also include all built-in sidebar containers by their IDs
    for (const [id, vc] of this._contributionHandler.builtinSidebarContainers) {
      containerMap.set(id, vc as ViewContainer);
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

    const allContainers: ViewContainer[] = [...this._contributionHandler.builtinSidebarContainers.values() as IterableIterator<ViewContainer>, this._panelContainer];
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
    this._saverListeners.clear();
    this._saverListeners.add(this._hGrid.onDidChange(() => this._workspaceSaver.requestSave()));
    this._saverListeners.add(this._vGrid.onDidChange(() => this._workspaceSaver.requestSave()));
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
    this._menuBuilder.registerDefaultMenuBarItems();

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
    // ─────────────────────────────────────────────────────────────────────

    const codiconExplorer = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.5 0H8.5L7 1.5V6H2.5L1 7.5V22.5699L2.5 24H14.5699L16 22.5699V18H20.7L22 16.5699V4.5L17.5 0ZM17.5 2.12L19.88 4.5H17.5V2.12ZM14.5 22.5H2.5V7.5H7V16.5699L8.5 18H14.5V22.5ZM20.5 16.5H8.5V1.5H16V6H20.5V16.5Z" fill="currentColor"/></svg>';
    const codiconSearch = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 1C11.524 1 8.5 4.024 8.5 7.75C8.5 9.247 9.012 10.622 9.873 11.72L1.939 19.655L3.0 20.716L10.934 12.781C12.06 13.7 13.49 14.25 15.05 14.25C18.776 14.25 21.8 11.226 21.8 7.5C21.8 3.774 18.776 0.75 15.05 0.75C15.117 0.75 15.183 0.753 15.25 0.757V1ZM15.25 2.5C17.873 2.5 20 4.627 20 7.25C20 9.873 17.873 12 15.25 12C12.627 12 10.5 9.873 10.5 7.25C10.5 4.627 12.627 2.5 15.25 2.5Z" fill="currentColor"/></svg>';
    const views = [
      { id: 'view.explorer', icon: codiconExplorer, label: 'Explorer', isSvg: true },
      { id: 'view.search', icon: codiconSearch, label: 'Search', isSvg: true },
    ];

    // Cache sidebar views slot in contribution handler
    this._contributionHandler.sidebarViewsSlot = this._sidebar.element.querySelector('.sidebar-views') as HTMLElement;
    const sidebarContent = this._contributionHandler.sidebarViewsSlot;

    for (const v of views) {
      const vc = new ViewContainer(`sidebar.${v.id}`);
      vc.setMode('stacked');

      const view = this._viewManager.createViewSync(v.id)!;
      vc.addView(view);

      this._contributionHandler.registerBuiltinSidebarContainer(v.id, vc);

      this._activityBarPart.addIcon({
        id: v.id,
        icon: v.icon,
        label: v.label,
        isSvg: v.isSvg ?? false,
        source: 'builtin',
      });

      if (sidebarContent) {
        sidebarContent.appendChild(vc.element);
      }
    }

    const defaultContainer = this._contributionHandler.builtinSidebarContainers.get('view.explorer')! as ViewContainer;

    for (const [id, vc] of this._contributionHandler.builtinSidebarContainers) {
      if (id !== 'view.explorer') {
        (vc as ViewContainer).setVisible(false);
      }
    }

    // Wire icon click events — delegate container switching to handler
    this._register(this._activityBarPart.onDidClickIcon((event) => {
      const isAlreadyActive = event.iconId === this._activityBarPart.activeIconId;

      if (isAlreadyActive) {
        this.toggleSidebar();
        return;
      }

      if (!this._sidebar.visible) {
        this.toggleSidebar();
      }

      this._contributionHandler.switchSidebarContainer(event.iconId);
    }));

    // P2.7: Activity bar icon context menu
    this._register(this._activityBarPart.onDidContextMenuIcon((event) => {
      const icon = this._activityBarPart.getIcons().find((i) => i.id === event.iconId);
      ContextMenu.show({
        items: [
          { id: 'hide', label: `Hide ${icon?.label ?? 'View'}`, group: '1_visibility', keybinding: this._keybindingHint('hide') },
        ],
        anchor: { x: event.x, y: event.y },
      });
    }));

    this._activityBarPart.setActiveIcon('view.explorer');
    this._contributionHandler.setActiveSidebarContainerId('view.explorer');
    this._workbenchContext?.setActiveViewContainer('view.explorer');

    // Sidebar header label + toolbar
    this._contributionHandler.sidebarHeaderSlot = this._sidebar.element.querySelector('.sidebar-header') as HTMLElement;
    const headerSlot = this._contributionHandler.sidebarHeaderSlot;
    if (headerSlot) {
      const headerLabel = $('span');
      headerLabel.classList.add('sidebar-header-label');
      headerLabel.textContent = 'EXPLORER';
      headerSlot.appendChild(headerLabel);

      const actionsContainer = $('div');
      actionsContainer.classList.add('sidebar-header-actions');

      const moreBtn = $('button');
      moreBtn.classList.add('sidebar-header-action-btn');
      moreBtn.title = 'More Actions…';
      moreBtn.setAttribute('aria-label', 'More Actions…');
      moreBtn.textContent = '⋯';
      this._register(addDisposableListener(moreBtn, 'click', (_e) => {
        const rect = moreBtn.getBoundingClientRect();
        ContextMenu.show({
          items: [
            { id: 'collapse-all', label: 'Collapse All', group: '1_actions', keybinding: this._keybindingHint('collapse-all') },
            { id: 'refresh', label: 'Refresh', group: '1_actions', keybinding: this._keybindingHint('refresh') },
          ],
          anchor: { x: rect.left, y: rect.bottom + 2 },
        });
      }));
      actionsContainer.appendChild(moreBtn);
      headerSlot.appendChild(actionsContainer);

      this._contributionHandler.sidebarHeaderLabel = headerLabel;
    }

    return defaultContainer;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Keybinding hint helper (QoL — keyboard shortcut hints in context menus)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Look up the keybinding for a commandId and return a display-formatted
   * string, or undefined if no keybinding is registered.
   */
  private _keybindingHint(commandId: string): string | undefined {
    const kbService = this._services.has(IKeybindingService)
      ? (this._services.get(IKeybindingService) as unknown as KeybindingService)
      : undefined;
    if (!kbService) return undefined;
    const raw = kbService.lookupKeybinding(commandId);
    if (!raw) return undefined;
    return formatKeybindingForDisplay(raw);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Unsaved changes guard (QoL — prompt before window close)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Wire the Electron `lifecycle:beforeClose` IPC to check for dirty editors
   * and show a save dialog before allowing the window to close.
   */
  private _wireUnsavedChangesGuard(): void {
    const electron = (window as any).parallxElectron as {
      onBeforeClose?: (cb: () => void) => void;
      confirmClose?: () => void;
      dialog?: { showMessageBox: (opts: any) => Promise<{ response: number }> };
    } | undefined;

    if (!electron?.onBeforeClose || !electron?.confirmClose) return;

    electron.onBeforeClose(async () => {
      // Collect dirty models
      const tfm = this._services.has(ITextFileModelManager)
        ? this._services.get(ITextFileModelManager)
        : undefined;
      const dirtyModels: { name: string; isDirty: boolean; save: () => Promise<void> }[] = [];
      if (tfm?.models) {
        for (const model of tfm.models) {
          if (model.isDirty && !model.isDisposed) {
            dirtyModels.push({ name: model.uri.basename, isDirty: model.isDirty, save: () => model.save() });
          }
        }
      }

      if (dirtyModels.length === 0) {
        // No unsaved changes — flush layout state, deactivate tools, and proceed to close
        await this._workspaceSaver.flushPendingSave();
        // Deactivate all tools so they can flush pending data (e.g. Canvas auto-save)
        if (this._toolActivator) {
          await this._toolActivator.deactivateAll();
        }
        electron.confirmClose!();
        return;
      }

      // Show native save dialog
      const fileList = dirtyModels.map((m) => m.name).join(', ');
      const result = await electron.dialog?.showMessageBox({
        type: 'warning',
        title: 'Unsaved Changes',
        message: `You have ${dirtyModels.length} unsaved file${dirtyModels.length > 1 ? 's' : ''}.`,
        detail: `${fileList}\n\nDo you want to save your changes before closing?`,
        buttons: ['Save All', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });

      if (!result || result.response === 2) {
        // Cancel — veto close (do nothing)
        return;
      }

      if (result.response === 0) {
        // Save All
        try {
          await tfm!.saveAll();
        } catch (err) {
          console.error('[Workbench] Error saving files before close:', err);
          // If save fails, don't close — let user fix and try again
          return;
        }
      }

      // "Don't Save" (response === 1) or "Save All" succeeded
      // Flush any pending layout save before closing
      await this._workspaceSaver.flushPendingSave();
      // Deactivate all tools so they can flush pending data (e.g. Canvas auto-save)
      if (this._toolActivator) {
        await this._toolActivator.deactivateAll();
      }
      electron.confirmClose!();
    });
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
      const actionsSlot = container.getSectionActionsSlot(viewId);
      if (actionsSlot) {
        this._menuContribution.renderViewTitleActions(viewId, actionsSlot);
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
        items.push({ id: action.commandId, label: cmd.title, keybinding: this._keybindingHint(action.commandId) });
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

    // Cache panel views slot (note: also set in _initializeParts via contributionHandler)
    const panelViewsSlot = this._panel.element.querySelector('.panel-views') as HTMLElement;
    const panelContent = panelViewsSlot;
    if (panelContent) {
      panelContent.appendChild(container.element);
    }

    // Double-click panel tab bar to maximize/restore
    // VS Code parity: double-clicking the panel title bar toggles maximized state.
    const tabBar = container.element.querySelector('.view-container-tabs') as HTMLElement;
    if (tabBar) {
      this._register(addDisposableListener(tabBar, 'dblclick', (e) => {
        // Only respond to clicks on the tab bar itself or its empty space,
        // not on individual tab buttons (which may have their own dblclick).
        const target = e.target as HTMLElement;
        if (target === tabBar || target.classList.contains('view-container-tabs')) {
          this.toggleMaximizedPanel();
        }
      }));
    }

    // NOTE: Do not call viewManager.showView() here — the container
    // already activated the first view (Terminal) via addView.

    return container;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Auxiliary bar views
  // ════════════════════════════════════════════════════════════════════════

  private _setupAuxBarViews(): ViewContainer {
    const container = new ViewContainer('auxiliaryBar');
    // Hide the built-in tab bar — the Part already has its own title area.
    // Without this, a 35px empty tab bar renders below the header.
    container.hideTabBar();

    // Mount into aux bar's view slot
    const auxBarPart = this._auxiliaryBar as unknown as AuxiliaryBarPart;
    const viewSlot = auxBarPart.viewContainerSlot;
    if (viewSlot) {
      viewSlot.appendChild(container.element);
    }

    // Header label — updates when extensions register and activate views
    const headerSlot = auxBarPart.headerSlot;
    if (headerSlot) {
      const headerLabel = $('span');
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
    this._secondaryActivityBarEl = $('div');
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
    setupEditorWatermark(this._editor.element);
  }

  /** Update watermark shortcuts from live keybinding service. */
  private _updateWatermarkKeybindings(keybindingService: { lookupKeybinding(commandId: string): string | undefined }): void {
    updateWatermarkKeybindings(this._editor.element, keybindingService);
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
      this._statusBarController.updateWindowTitle(editor);
    });

    console.log('[Workbench] Editor services registered (Capability 9)');
  }

  /**
   * Register facade services (Capability 0 gap cleanup).
   * Delegated to workbenchFacadeFactory.ts (D.2 extraction).
   */
  private _registerFacadeServices(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const host: FacadeFactoryHost = {
      get container() { return self._container; },
      get _hGrid() { return self._hGrid; },
      get _vGrid() { return self._vGrid; },
      get workspace() { return self._workspace; },
      get _workspaceSaver() { return self._workspaceSaver; },
      _layoutViewContainers: () => this._layoutViewContainers(),
      isPartVisible: (partId: string) => this.isPartVisible(partId),
      setPartHidden: (hidden: boolean, partId: string) => this.setPartHidden(hidden, partId),
      onDidChangePartVisibility: this.onDidChangePartVisibility,
      createWorkspace: (name, path, switchTo) => this.createWorkspace(name, path, switchTo),
      switchWorkspace: (id) => this.switchWorkspace(id),
      getRecentWorkspaces: () => this.getRecentWorkspaces(),
      removeRecentWorkspace: (id) => this.removeRecentWorkspace(id),
      onDidSwitchWorkspace: this.onDidSwitchWorkspace,
    };
    for (const d of registerFacadeServices({ services: this._services, host, commandPalette: this._commandPalette })) {
      this._register(d);
    }
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
      ? this._services.get(INotificationService)
      : undefined;

    // Register contribution processors (M2 Capability 5)
    const { commandContribution, keybindingContribution, menuContribution, keybindingService } =
      registerContributionProcessors(this._services);
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
    this._contributionHandler.setViewContribution(this._viewContribution);
    this._contributionHandler.wireViewContributionEvents();

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
      notificationService: notificationService!,
      workbenchContainer: this._container,
      configurationService: this._configService,
      commandContributionProcessor: commandContribution,
      viewContributionProcessor: this._viewContribution,
      badgeHost: this._activityBarPart,
      statusBarPart: this._statusBar as unknown as StatusBarPart,
      themeService: this._services.has(IThemeService) ? this._services.get(IThemeService) : undefined,
      toolEnablementService: undefined as any, // Placeholder — set after enablement service is created
    };

    // Storage dependencies for persistent tool mementos (Cap 4)
    const storageDeps: ToolStorageDependencies = {
      globalStorage: this._globalStorage,
      workspaceStorage: this._storage,
      configRegistry: this._configRegistry,
      workspaceIdProvider: () => this._workspace?.id,
    };

    // ── Tool Enablement Service (M6 Capability 0) ──
    this._toolEnablementService = this._register(
      new ToolEnablementService(this._storage, registry),
    );
    await this._toolEnablementService.load();
    this._services.registerInstance(IToolEnablementService, this._toolEnablementService);

    // Wire enablement service into API factory deps (created before enablement service)
    (apiFactoryDeps as any).toolEnablementService = this._toolEnablementService;

    // ── Database Service (M6 Capability 1) ──
    this._databaseService = this._register(new DatabaseService());
    this._services.registerInstance(IDatabaseService, this._databaseService);
    // Open database for current workspace if a folder is open
    await this._openDatabaseForWorkspace();
    // React to workspace folder changes (open/close database)
    this._register(this._workspace.onDidChangeFolders(() => {
      this._openDatabaseForWorkspace();
    }));

    // Create and register the activator
    this._toolActivator = this._register(
      new ToolActivator(registry, errorService, activationEvents, apiFactoryDeps, storageDeps),
    );
    this._services.registerInstance(IToolActivatorService, this._toolActivator);

    // Wire activation events to the activator
    this._register(activationEvents.onDidRequestActivation(async (request) => {
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

    // ── Tool Enable/Disable Orchestration (M6 Capability 0) ──
    this._register(this._toolEnablementService.onDidChangeEnablement(async (e) => {
      const { toolId, newState } = e;
      const entry = registry.getById(toolId);
      if (!entry) return;

      if (newState === 'EnabledGlobally') {
        // ── ENABLE: re-process contributions, then activate ──
        console.log(`[Workbench] Enabling tool "${toolId}" — re-processing contributions and activating`);
        commandContribution.processContributions(entry.description);
        keybindingContribution.processContributions(entry.description);
        menuContribution.processContributions(entry.description);
        this._viewContribution.processContributions(entry.description);

        // Re-register activation events
        activationEvents.registerToolEvents(toolId, entry.description.manifest.activationEvents);

        // Activate: use cached module for built-ins, otherwise standard activate
        const builtinModule = this._builtinModules.get(toolId);
        if (builtinModule) {
          await this._toolActivator.activateBuiltin(toolId, builtinModule as any);
        } else {
          await this._toolActivator.activate(toolId);
        }
      } else {
        // ── DISABLE: deactivate (contributions cleaned by onDidDeactivate) ──
        console.log(`[Workbench] Disabling tool "${toolId}" — deactivating`);
        await this._toolActivator.deactivate(toolId);
        // Also clear activation tracking so re-enable starts fresh
        activationEvents.clearActivated(toolId);
      }
    }));

    // Wire contribution processors into the command palette for display
    if (this._commandPalette) {
      this._commandPalette.setMenuContribution(menuContribution);
      this._commandPalette.setKeybindingContribution(keybindingContribution);
    }

    // Wire keybinding lookup and command executor into TitlebarPart (M3 Capability 1)
    this._titlebar.setKeybindingLookup(keybindingService);
    this._titlebar.setCommandExecutor(this._services.get(ICommandService));

    // Wire context key evaluator for menu when-clause graying (M4)
    if (this._contextKeyService) {
      this._titlebar.setContextKeyEvaluator(this._contextKeyService);
    }

    // ── Wire file editor resolver (M4 Capability 4) ──
    this._initFileEditorResolver();

    // ── Register and activate built-in tools (M2 Capability 7) ──
    await this._registerAndActivateBuiltinTools(registry, activationEvents);

    // ── Discover and register external tools (M6 Capability 0) ──
    // Scans ~/.parallx/tools/ for user-installed tools with parallx-manifest.json.
    // External tools are registered in the ToolRegistry and their activation events
    // are wired up. Tools with `*` events are activated immediately. Tools with
    // `onStartupFinished` will activate when fireStartupFinished() is called below.
    // Tools with `onCommand:` / `onView:` activate lazily when those events fire.
    await this._discoverAndRegisterExternalTools(registry, activationEvents);

    // Fire startup finished — triggers * and onStartupFinished activation events
    activationEvents.fireStartupFinished();

    // ── Wire tool install/uninstall callbacks for the API (M6 Package Install) ──
    // These callbacks are invoked by api.tools.installFromFile() and api.tools.uninstall()
    // to handle registration, contribution processing, and activation without restart.
    (apiFactoryDeps as any).onToolInstalled = async (toolPath: string, manifest: any) => {
      const description: IToolDescription = {
        manifest,
        toolPath,
        isBuiltin: false,
      };

      // Register in the ToolRegistry (contributions auto-processed via onDidRegisterTool)
      registry.register(description);

      // Wire activation events
      activationEvents.registerToolEvents(manifest.id, manifest.activationEvents ?? []);

      // Activate immediately (user just chose to install — they want it active)
      activationEvents.markActivated(manifest.id);
      const success = await this._toolActivator.activate(manifest.id);
      if (!success) {
        console.error(`[Workbench] Failed to activate newly installed tool "${manifest.id}"`);
      } else {
        console.log(`[Workbench] Hot-installed and activated tool "${manifest.name}" (${manifest.id})`);
      }

      return { toolId: manifest.id };
    };

    (apiFactoryDeps as any).onToolUninstalled = async (toolId: string) => {
      // Deactivate the tool if active
      if (this._toolActivator.isActivated(toolId)) {
        await this._toolActivator.deactivate(toolId);
      }

      // Clear activation tracking
      activationEvents.clearActivated(toolId);

      // Unregister from the ToolRegistry (cleans up contributions via onDidDeactivate)
      registry.unregister(toolId);

      console.log(`[Workbench] Uninstalled and unregistered tool "${toolId}"`);
    };

    // ── Unsaved changes guard (QoL) ──
    this._wireUnsavedChangesGuard();

    console.log('[Workbench] Tool lifecycle initialized (with contribution processors)');
  }

  /**
   * Open (or re-open) the database for the current workspace.
   * Uses the first folder's filesystem path as the workspace root.
   * If no folders are open, closes any open database.
   *
   * Migration files are resolved from the app's built-in canvas tool
   * directory. This is called during Phase 5 init and on folder changes.
   */
  private async _openDatabaseForWorkspace(): Promise<void> {
    const folders = this._workspace.folders;
    if (folders.length === 0) {
      // No folder open — close database if open
      if (this._databaseService.isOpen) {
        await this._databaseService.close();
        console.log('[Workbench] Database closed (no workspace folder)');
      }
      return;
    }

    // Use the first folder's path as the workspace root for the database
    const firstFolder = folders[0];
    const folderPath = firstFolder.uri.fsPath;

    // Resolve the migrations directory — bundled with the app
    // Canvas migrations live in src/built-in/canvas/migrations/ at dev time.
    // At runtime, we need the absolute path. We'll use the electron IPC
    // to resolve the app path plus relative migrations path.
    // For now, migrations are passed as undefined — they'll be wired
    // when Canvas tool activates and provides its migration path.
    try {
      await this._databaseService.openForWorkspace(folderPath);
      console.log('[Workbench] Database opened for workspace folder: %s', folderPath);
    } catch (err) {
      console.error('[Workbench] Failed to open database for workspace:', err);
    }
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
   * This connects four things:
   *  1. An EditorResolverService with built-in format reader registrations
   *  2. A pane factory that routes inputs to the correct EditorPane
   *  3. A URI resolver that creates the correct EditorInput via the resolver
   *  4. Exposes the resolver via setFileEditorResolver() so EditorsBridge.openFileEditor() works
   *
   * Built-in format readers:
   *  - Markdown (.md, .markdown) → MarkdownEditorPane (rendered preview)
   *  - Images (.png, .jpg, .gif, .svg, .webp, .bmp, .ico, .avif) → ImageEditorPane
   *  - PDF (.pdf) → PdfEditorPane
   *  - Text (fallback .*) → TextEditorPane
   *
   * Must be called AFTER services are registered but BEFORE built-in tools activate.
   */
  /**
   * Wire the file editor resolver (D.3 — delegated to workbenchFileEditorSetup.ts).
   */
  private _initFileEditorResolver(): void {
    this._register(initFileEditorSetup({
      services: this._services,
      editorPart: this._editor as EditorPart,
      commandPalette: this._commandPalette,
    }));
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
      { manifest: EXPLORER_MANIFEST, module: ExplorerTool },
      { manifest: SEARCH_MANIFEST, module: SearchTool },
      { manifest: TEXT_EDITOR_MANIFEST, module: FileEditorTool },
      { manifest: WELCOME_MANIFEST, module: WelcomeTool },
      { manifest: OUTPUT_MANIFEST, module: OutputTool },
      { manifest: TOOL_GALLERY_MANIFEST, module: ToolGalleryTool },
      { manifest: CANVAS_MANIFEST, module: CanvasTool },
    ];

    const activationPromises: Promise<void>[] = [];

    for (const { manifest, module } of builtins) {
      const description: IToolDescription = {
        manifest,
        toolPath: `built-in/${manifest.id}`,
        isBuiltin: true,
      };

      // Cache the module for re-activation after disable→enable (M6)
      this._builtinModules.set(manifest.id, module as { activate: Function; deactivate?: Function });

      try {
        registry.register(description);
        // Register activation events so the system knows about them
        activationEvents.registerToolEvents(manifest.id, manifest.activationEvents);

        // Check enablement — disabled tools are registered but NOT activated
        if (!this._toolEnablementService.isEnabled(manifest.id)) {
          console.log(`[Workbench] Skipping activation for disabled tool "${manifest.id}"`);
          continue;
        }

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

  /**
   * Discover external tools from the user's tools directory (~/.parallx/tools/)
   * and register them in the ToolRegistry.
   *
   * This follows VS Code's extension discovery pattern:
   * 1. Scan directories for manifests (parallx-manifest.json)
   * 2. Validate each manifest
   * 3. Register in the registry (starts in Registered state)
   * 4. Wire activation events — lazy activation via onCommand:/onView:
   * 5. Tools with `*` activation events are activated eagerly
   *
   * Called after built-in tool registration and before fireStartupFinished().
   * The ActivationEventService handles `onStartupFinished` tools automatically
   * when fireStartupFinished() is called.
   *
   * VS Code reference: ExtensionService._scanAndHandleExtensions()
   */
  private async _discoverAndRegisterExternalTools(
    registry: ToolRegistry,
    activationEvents: ActivationEventService,
  ): Promise<void> {
    const scanner = new ToolScanner();

    let scanResult;
    try {
      scanResult = await scanner.scanDefaults();
    } catch (err) {
      console.error('[Workbench] External tool scanning failed:', err);
      return;
    }

    // Log directory-level errors (non-fatal — e.g. builtin dir doesn't exist in dev)
    for (const dirErr of scanResult.directoryErrors) {
      console.warn(`[Workbench] Tool scan directory error: ${dirErr.directory} — ${dirErr.error}`);
    }

    // Log individual tool scan failures
    for (const failure of scanResult.failures) {
      console.warn(
        `[Workbench] Tool scan failure at "${failure.toolPath}": ${failure.reason}`,
        failure.validationErrors?.map(e => `  ${e.path}: ${e.message}`).join('\n') ?? '',
      );
    }

    if (scanResult.tools.length === 0) {
      console.log('[Workbench] No external tools discovered');
      return;
    }

    console.log(`[Workbench] Discovered ${scanResult.tools.length} external tool(s)`);

    const eagerActivationPromises: Promise<void>[] = [];

    for (const toolDesc of scanResult.tools) {
      const toolId = toolDesc.manifest.id;

      // Skip tools already registered (prevents duplicates with built-ins)
      if (registry.getById(toolId)) {
        console.warn(`[Workbench] Skipping external tool "${toolId}" — already registered (duplicate ID)`);
        continue;
      }

      try {
        // Register the tool in the registry (Registered state)
        registry.register(toolDesc);

        // Register activation events so the system knows when to activate
        activationEvents.registerToolEvents(toolId, toolDesc.manifest.activationEvents);

        // Check enablement — disabled tools are registered but NOT activated
        if (!this._toolEnablementService.isEnabled(toolId)) {
          console.log(`[Workbench] External tool "${toolId}" registered but disabled — skipping activation`);
          continue;
        }

        // Eager activation for tools with `*` activation event
        // (onStartupFinished tools will be activated by fireStartupFinished() later)
        const hasEagerEvent = toolDesc.manifest.activationEvents.includes('*');
        if (hasEagerEvent) {
          activationEvents.markActivated(toolId);
          eagerActivationPromises.push(
            this._toolActivator.activate(toolId).then(
              (success) => {
                if (!success) {
                  console.error(`[Workbench] Failed to activate external tool "${toolId}"`);
                }
              },
              (err) => {
                console.error(`[Workbench] Error activating external tool "${toolId}":`, err);
              },
            ),
          );
        }

        console.log(`[Workbench] Registered external tool "${toolId}" (${toolDesc.manifest.name})`);
      } catch (err) {
        console.error(`[Workbench] Failed to register external tool "${toolId}":`, err);
      }
    }

    // Wait for eager activations to complete
    if (eagerActivationPromises.length > 0) {
      await Promise.allSettled(eagerActivationPromises);
      console.log(`[Workbench] ${eagerActivationPromises.length} eager external tool(s) activated`);
    }
  }

  /**
   * Programmatically switch to a specific sidebar view and ensure sidebar is visible.
   * Used by commands like `workbench.view.search` (Ctrl+Shift+F).
   */
  showSidebarView(viewId: string): void {
    this._contributionHandler.showSidebarView(viewId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Layout view containers
  // ════════════════════════════════════════════════════════════════════════

  protected override _layoutViewContainers(): void {
    // Layout the builtin panel + aux bar containers (always)
    if (this._panel.visible && this._panel.height > 0) {
      this._panelContainer.layout(this._panel.width, this._panel.height, Orientation.Horizontal);
    }
    if (this._auxBarVisible && this._auxiliaryBar.width > 0) {
      this._auxBarContainer?.layout(this._auxiliaryBar.width, this._auxiliaryBar.height - PART_HEADER_HEIGHT_PX, Orientation.Vertical);
    }

    // Delegate sidebar switching + contributed container layout to handler
    this._contributionHandler.layoutContainers(
      { visible: this._sidebar.visible, width: this._sidebar.width, height: this._sidebar.height },
      { visible: this._panel.visible, width: this._panel.width, height: this._panel.height },
      { visible: this._auxBarVisible, width: this._auxiliaryBar.width, height: this._auxiliaryBar.height },
      PART_HEADER_HEIGHT_PX,
      { horizontal: Orientation.Horizontal, vertical: Orientation.Vertical },
      this._sidebarContainer,
    );
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

    for (const vc of this._contributionHandler.builtinSidebarContainers.values()) {
      this._makeTabsDraggable(dnd, vc as ViewContainer, this._sidebar.id);
    }
    this._makeTabsDraggable(dnd, this._panelContainer, this._panel.id);
    this._makeTabsDraggable(dnd, this._auxBarContainer, this._auxiliaryBar.id);

    dnd.onDidDropComplete((result: DropResult) => {
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
    this._contributionHandler.tabObservers.push(observer);
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
    // 0. Tear down contribution handler state (tab observers, view contrib listeners,
    //    builtin + contributed containers, container redirects)
    this._contributionHandler.teardown();

    // 1. Dispose DnD controller
    this._dndController?.dispose();

    // 2. Dispose generic view containers (builtin sidebar containers were disposed by handler)
    this._panelContainer?.dispose();
    this._auxBarContainer?.dispose();

    // 3. Clear view container mount points in parts
    if (this._contributionHandler.sidebarViewsSlot) this._contributionHandler.sidebarViewsSlot.innerHTML = '';
    if (this._contributionHandler.sidebarHeaderSlot) this._contributionHandler.sidebarHeaderSlot.innerHTML = '';
    if (this._contributionHandler.panelViewsSlot) this._contributionHandler.panelViewsSlot.innerHTML = '';

    const auxBarPart = this._auxiliaryBar as unknown as AuxiliaryBarPart;
    const auxViewSlot = auxBarPart.viewContainerSlot;
    if (auxViewSlot) auxViewSlot.innerHTML = '';
    const auxHeaderSlot = auxBarPart.headerSlot;
    if (auxHeaderSlot) auxHeaderSlot.innerHTML = '';

    // 4. Clear activity bar icons (the Part structure stays, only icons are removed)
    for (const icon of this._activityBarPart.getIcons()) {
      this._activityBarPart.removeIcon(icon.id);
    }

    // 4b. Clear manage gear icon (not tracked by addIcon/removeIcon)
    const bottomSection = this._activityBarPart.contentElement.querySelector('.activity-bar-bottom');
    const gearBtn = bottomSection?.querySelector('.activity-bar-manage-gear');
    gearBtn?.remove();

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
   *
   * @param savedProviders View providers saved before teardown. Tools don't
   *   re-activate after a switch, so we must re-register their providers
   *   to replace placeholder stubs with real views.
   */
  private _rebuildWorkspaceContent(
    savedProviders: ReadonlyMap<string, import('../contributions/viewContribution.js').IToolViewProvider> = new Map(),
  ): void {
    // 1. View system — register ALL descriptors, then create containers
    this._viewManager = new ViewManager();
    this._viewManager.registerMany(allPlaceholderViewDescriptors);
    this._viewManager.registerMany(allAuxiliaryBarViewDescriptors);

    this._sidebarContainer = this._setupSidebarViews();
    this._panelContainer = this._setupPanelViews();
    this._auxBarContainer = this._setupAuxBarViews();

    // Wire new containers + view manager into contribution handler
    this._contributionHandler.setViewManager(this._viewManager);
    this._contributionHandler.setGenericContainers(this._sidebarContainer, this._panelContainer, this._auxBarContainer);
    this._contributionHandler.panelViewsSlot = this._panel.element.querySelector('.panel-views') as HTMLElement;

    // 2b. Manage gear icon
    this._menuBuilder.addManageGearIcon();

    // 3. DnD
    this._dndController = this._setupDragAndDrop();

    // 4. Layout view containers
    this._layoutViewContainers();

    // 5. Re-wire view contribution events (Cap 6)
    if (this._viewContribution) {
      this._viewContribution.updateViewManager(this._viewManager);
      this._contributionHandler.setViewContribution(this._viewContribution);
      this._contributionHandler.wireViewContributionEvents();

      // Replay view contributions for all already-registered tools so
      // contributed containers and views are re-created in the new DOM.
      //
      // Providers were already saved in switchWorkspace() BEFORE teardown
      // (which clears them) and passed in as the savedProviders parameter.

      const registry = this._services.get(IToolRegistryService) as unknown as ToolRegistry;
      if (registry) {
        for (const entry of registry.getAll()) {
          const contributes = entry.description.manifest.contributes;
          if (contributes?.viewContainers || contributes?.views) {
            // Remove then re-process to rebuild DOM via events
            this._viewContribution.removeContributions(entry.description.manifest.id);
            this._viewContribution.processContributions(entry.description);
          }
        }
      }

      // Re-register saved providers — this triggers onDidRegisterProvider
      // for each, which replaces placeholder view content with real tool views
      for (const [viewId, provider] of savedProviders) {
        this._viewContribution.registerProvider(viewId, provider);
      }
    }

    console.log('[Workbench] Rebuilt workspace content');
  }

  /**
   * Show a fade overlay during workspace switch.
   */
  private _showTransitionOverlay(): HTMLElement {
    const overlay = $('div');
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
    const TRANSITION_FALLBACK_MS = 300;
    setTimeout(() => { if (overlay.parentElement) overlay.remove(); }, TRANSITION_FALLBACK_MS);
  }
}
