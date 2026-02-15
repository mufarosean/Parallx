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
import { Emitter, Event } from '../platform/events.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { URI } from '../platform/uri.js';
import { ILifecycleService, ICommandService, IContextKeyService, IEditorService, IEditorGroupService, ILayoutService, IViewService, IWorkspaceService, INotificationService, IActivationEventService, IToolErrorService, IToolActivatorService, IToolRegistryService, IWindowService, IFileService, ITextFileModelManager, IThemeService, IKeybindingService } from '../services/serviceTypes.js';
import { LifecyclePhase, LifecycleService } from './lifecycle.js';
import { registerWorkbenchServices, registerConfigurationServices } from './workbenchServices.js';

// Layout base class (VS Code: Layout → Workbench extends Layout)
import {
  Layout,
} from './layout.js';

// Parts
import { Part } from '../parts/part.js';
import { PartId } from '../parts/partTypes.js';
import { EditorPart } from '../parts/editorPart.js';
import { StatusBarPart, StatusBarAlignment } from '../parts/statusBarPart.js';

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
import { formatKeybindingForDisplay } from '../contributions/keybindingContribution.js';
import type { MenuContributionProcessor } from '../contributions/menuContribution.js';

// Keybinding Service (M3 Capability 0.3)
import type { KeybindingService } from '../services/keybindingService.js';

// View Contribution (M2 Capability 6)
import { ViewContributionProcessor } from '../contributions/viewContribution.js';
import type { IContributedContainer, IContributedView } from '../contributions/viewContribution.js';

// Built-in Tools (M2 Capability 7)
import * as ExplorerTool from '../built-in/explorer/main.js';
import * as SearchTool from '../built-in/search/main.js';
import * as WelcomeTool from '../built-in/welcome/main.js';
import * as OutputTool from '../built-in/output/main.js';
import * as ToolGalleryTool from '../built-in/tool-gallery/main.js';
import * as FileEditorTool from '../built-in/editor/main.js';
import type { IToolManifest, IToolDescription } from '../tools/toolManifest.js';
import {
  EXPLORER_MANIFEST,
  SEARCH_MANIFEST,
  TEXT_EDITOR_MANIFEST,
  WELCOME_MANIFEST,
  OUTPUT_MANIFEST,
  TOOL_GALLERY_MANIFEST,
} from '../tools/builtinManifests.js';

// File Editor Resolver (M4 Capability 4)
import { registerEditorPaneFactory } from '../editor/editorPane.js';
import { setFileEditorResolver } from '../api/bridges/editorsBridge.js';
import { GroupDirection } from '../editor/editorTypes.js';
import { FileEditorInput } from '../built-in/editor/fileEditorInput.js';
import { UntitledEditorInput } from '../built-in/editor/untitledEditorInput.js';
import { TextEditorPane } from '../built-in/editor/textEditorPane.js';

// Format Readers (EditorResolverService)
import { EditorResolverService, EditorResolverPriority } from '../services/editorResolverService.js';
import { MarkdownEditorPane } from '../built-in/editor/markdownEditorPane.js';
import { MarkdownPreviewInput } from '../built-in/editor/markdownPreviewInput.js';
import { ImageEditorInput } from '../built-in/editor/imageEditorInput.js';
import { ImageEditorPane } from '../built-in/editor/imageEditorPane.js';
import { PdfEditorInput } from '../built-in/editor/pdfEditorInput.js';
import { PdfEditorPane } from '../built-in/editor/pdfEditorPane.js';

// Keybindings & Settings Editor (QoL)
import { KeybindingsEditorInput } from '../built-in/editor/keybindingsEditorInput.js';
import { KeybindingsEditorPane } from '../built-in/editor/keybindingsEditorPane.js';
import { SettingsEditorInput } from '../built-in/editor/settingsEditorInput.js';
import { SettingsEditorPane } from '../built-in/editor/settingsEditorPane.js';

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
  private _saverListeners: IDisposable[] = [];
  private _restoredState: WorkspaceState | undefined;

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
  /** Map of contributed container IDs → built-in container view IDs (redirect targets). */
  private _containerRedirects = new Map<string, string>();
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
        const uri = (await import('../platform/uri.js')).URI.parse(folderUri);
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

    // 4c. Manage gear icon in activity bar (bottom) — VS Code parity
    this._addManageGearIcon();

    // 5. DnD between parts
    this._dndController = this._setupDragAndDrop();

    // 6. Layout view containers + wire grid sash handlers (from Layout base)
    this._layoutViewContainers();
    this._wireGridHandlers();

    // 7. Window resize handler
    window.addEventListener('resize', this._onWindowResize);

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
    const panelSnap = state.parts.find(p => p.partId === PartId.Panel);
    if (panelSnap?.height && panelSnap.height > 0) {
      this._lastPanelHeight = panelSnap.height;
      if (this._panel.visible) {
        const currentHeight = this._vGrid.getViewSize(this._panel.id);
        if (currentHeight !== undefined && currentHeight !== panelSnap.height) {
          const delta = panelSnap.height - currentHeight;
          this._vGrid.resizeSash(this._vGrid.root, 0, delta);
          this._vGrid.layout();
        }
      }
    }

    // 1d. Restore auxiliary bar width — always remember the saved width so
    //     that toggleAuxiliaryBar() uses it when the user re-shows the bar.
    //     Only resize the live grid when the aux bar is currently visible.
    const auxBarSnap = state.parts.find(p => p.partId === PartId.AuxiliaryBar);
    if (auxBarSnap?.width && auxBarSnap.width > 0) {
      this._lastAuxBarWidth = auxBarSnap.width;
      if (this._auxBarVisible) {
        // Aux bar is the last child in hGrid; its sash is at index childCount - 2
        const auxSashIndex = this._hGrid.root.childCount - 2;
        const currentWidth = this._hGrid.getViewSize(this._auxiliaryBar.id);
        if (currentWidth !== undefined && currentWidth !== auxBarSnap.width) {
          const delta = auxBarSnap.width - currentWidth;
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
      { commandId: 'workbench.action.toggleMaximizedPanel', title: 'Maximize Panel', group: '2_appearance', order: 2.5 },
      { commandId: 'workbench.action.toggleAuxiliaryBar', title: 'Toggle Auxiliary Bar', group: '2_appearance', order: 3 },
      { commandId: 'workbench.action.toggleStatusbarVisibility', title: 'Toggle Status Bar', group: '2_appearance', order: 4 },
      { commandId: 'workbench.action.toggleZenMode', title: 'Zen Mode', group: '2_appearance', order: 5 },
      { commandId: 'editor.toggleWordWrap', title: 'Word Wrap', group: '3_editor', order: 1, when: 'activeEditor' },
    ]));

    // Register dropdown items for File menu
    this._register(this._titlebar.registerMenuBarDropdownItems('file', [
      { commandId: 'file.newTextFile', title: 'New Text File', group: '1_new', order: 1 },
      { commandId: 'file.openFile', title: 'Open File…', group: '2_open', order: 1 },
      { commandId: 'workspace.openFolder', title: 'Open Folder…', group: '2_open', order: 2 },
      { commandId: 'workspace.openRecent', title: 'Open Recent…', group: '2_open', order: 3 },
      { commandId: 'workspace.addFolderToWorkspace', title: 'Add Folder to Workspace…', group: '3_workspace', order: 1 },
      { commandId: 'workspace.saveAs', title: 'Save Workspace As…', group: '3_workspace', order: 2 },
      { commandId: 'workspace.duplicateWorkspace', title: 'Duplicate Workspace', group: '3_workspace', order: 3 },
      { commandId: 'file.save', title: 'Save', group: '4_save', order: 1, when: 'activeEditor' },
      { commandId: 'file.saveAs', title: 'Save As…', group: '4_save', order: 2, when: 'activeEditor' },
      { commandId: 'file.saveAll', title: 'Save All', group: '4_save', order: 3, when: 'activeEditor' },
      { commandId: 'file.revert', title: 'Revert File', group: '5_close', order: 1, when: 'activeEditorIsDirty' },
      { commandId: 'workbench.action.closeActiveEditor', title: 'Close Editor', group: '5_close', order: 2, when: 'activeEditor' },
      { commandId: 'workspace.closeFolder', title: 'Close Folder', group: '5_close', order: 3, when: 'workspaceFolderCount > 0' },
      { commandId: 'workspace.closeWindow', title: 'Close Window', group: '5_close', order: 4 },
    ]));

    // Register dropdown items for Edit menu
    this._register(this._titlebar.registerMenuBarDropdownItems('edit', [
      { commandId: 'edit.undo', title: 'Undo', group: '1_undo', order: 1, when: 'activeEditor' },
      { commandId: 'edit.redo', title: 'Redo', group: '1_undo', order: 2, when: 'activeEditor' },
      { commandId: 'edit.cut', title: 'Cut', group: '2_clipboard', order: 1, when: 'activeEditor' },
      { commandId: 'edit.copy', title: 'Copy', group: '2_clipboard', order: 2, when: 'activeEditor' },
      { commandId: 'edit.paste', title: 'Paste', group: '2_clipboard', order: 3, when: 'activeEditor' },
      { commandId: 'edit.find', title: 'Find', group: '3_find', order: 1, when: 'activeEditor' },
      { commandId: 'edit.replace', title: 'Replace', group: '3_find', order: 2, when: 'activeEditor' },
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

    // VS Code codicon-style SVG icons (24x24 viewBox, stroke-based, minimalist)
    const codiconExplorer = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.5 0H8.5L7 1.5V6H2.5L1 7.5V22.5699L2.5 24H14.5699L16 22.5699V18H20.7L22 16.5699V4.5L17.5 0ZM17.5 2.12L19.88 4.5H17.5V2.12ZM14.5 22.5H2.5V7.5H7V16.5699L8.5 18H14.5V22.5ZM20.5 16.5H8.5V1.5H16V6H20.5V16.5Z" fill="currentColor"/></svg>';
    const codiconSearch = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 1C11.524 1 8.5 4.024 8.5 7.75C8.5 9.247 9.012 10.622 9.873 11.72L1.939 19.655L3.0 20.716L10.934 12.781C12.06 13.7 13.49 14.25 15.05 14.25C18.776 14.25 21.8 11.226 21.8 7.5C21.8 3.774 18.776 0.75 15.05 0.75C15.117 0.75 15.183 0.753 15.25 0.757V1ZM15.25 2.5C17.873 2.5 20 4.627 20 7.25C20 9.873 17.873 12 15.25 12C12.627 12 10.5 9.873 10.5 7.25C10.5 4.627 12.627 2.5 15.25 2.5Z" fill="currentColor"/></svg>';
    const views = [
      { id: 'view.explorer', icon: codiconExplorer, label: 'Explorer', isSvg: true },
      { id: 'view.search', icon: codiconSearch, label: 'Search', isSvg: true },
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
        isSvg: v.isSvg ?? false,
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
          { id: 'hide', label: `Hide ${icon?.label ?? 'View'}`, group: '1_visibility', keybinding: this._keybindingHint('hide') },
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
      const headerLabel = $('span');
      headerLabel.classList.add('sidebar-header-label');
      headerLabel.textContent = 'EXPLORER';
      headerSlot.appendChild(headerLabel);

      // Actions toolbar on the right (VS Code: `.title-actions` inside `.composite.title`)
      const actionsContainer = $('div');
      actionsContainer.classList.add('sidebar-header-actions');

      // "More actions" button (ellipsis)
      const moreBtn = $('button');
      moreBtn.classList.add('sidebar-header-action-btn');
      moreBtn.title = 'More Actions…';
      moreBtn.setAttribute('aria-label', 'More Actions…');
      moreBtn.textContent = '⋯';
      moreBtn.addEventListener('click', (_e) => {
        const rect = moreBtn.getBoundingClientRect();
        ContextMenu.show({
          items: [
            { id: 'collapse-all', label: 'Collapse All', group: '1_actions', keybinding: this._keybindingHint('collapse-all') },
            { id: 'refresh', label: 'Refresh', group: '1_actions', keybinding: this._keybindingHint('refresh') },
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
        // No unsaved changes — flush layout state and proceed to close
        await this._workspaceSaver.flushPendingSave();
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

    const panelContent = this._panel.element.querySelector('.panel-views') as HTMLElement;
    if (panelContent) {
      panelContent.appendChild(container.element);
    }

    // Double-click panel tab bar to maximize/restore
    // VS Code parity: double-clicking the panel title bar toggles maximized state.
    const tabBar = container.element.querySelector('.view-container-tabs') as HTMLElement;
    if (tabBar) {
      tabBar.addEventListener('dblclick', (e) => {
        // Only respond to clicks on the tab bar itself or its empty space,
        // not on individual tab buttons (which may have their own dblclick).
        const target = e.target as HTMLElement;
        if (target === tabBar || target.classList.contains('view-container-tabs')) {
          this.toggleMaximizedPanel();
        }
      });
    }

    // NOTE: Do not call viewManager.showView() here — the container
    // already activated the first view (Terminal) via addView.

    return container;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Manage gear icon (VS Code: global-activity "Manage" button)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Adds a gear icon to the activity bar bottom section that opens a
   * settings/manage menu — mirrors VS Code's "Manage" gear icon.
   *
   * VS Code reference: src/vs/workbench/browser/parts/activitybar/activitybarActions.ts
   *   → GlobalActivityActionViewItem
   */
  private _addManageGearIcon(): void {
    const bottomSection = this._activityBarPart.contentElement.querySelector('.activity-bar-bottom');
    if (!bottomSection) return;

    const gearBtn = $('button');
    gearBtn.classList.add('activity-bar-item', 'activity-bar-manage-gear');
    gearBtn.dataset.iconId = 'manage-gear';
    gearBtn.title = 'Manage';

    // Use VS Code's codicon gear SVG (16×16 viewBox for proper sizing)
    const iconLabel = $('span');
    iconLabel.classList.add('activity-bar-icon-label');
    iconLabel.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.54 11.81L13.12 ' +
      '11.03L13.56 10.05L15.18 9.72L15.18 7.28L13.56 6.95L13.12 5.97L14.54 ' +
      '4.19L12.81 2.46L11.03 3.88L10.05 3.44L9.72 1.82L7.28 1.82L6.95 ' +
      '3.44L5.97 3.88L4.19 2.46L2.46 4.19L3.88 5.97L3.44 6.95L1.82 7.28' +
      'L1.82 9.72L3.44 10.05L3.88 11.03L2.46 12.81L4.19 14.54L5.97 13.12' +
      'L6.95 13.56L7.28 15.18L9.72 15.18L10.05 13.56L11.03 13.12L12.81 ' +
      '14.54L14.54 11.81ZM8.5 11C9.88 11 11 9.88 11 8.5C11 7.12 9.88 6 ' +
      '8.5 6C7.12 6 6 7.12 6 8.5C6 9.88 7.12 11 8.5 11Z" fill="currentColor"/></svg>';
    gearBtn.appendChild(iconLabel);

    // Toggle: click opens menu, click again closes it
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._manageMenu) {
        // Menu is open — dismiss it
        this._manageMenu.dismiss();
        return;
      }
      // Guard: if the menu was *just* dismissed (by the outside-click mousedown
      // hitting this same button), skip re-opening. The mousedown fires before
      // click, so dismiss() runs first and nulls _manageMenu; without this
      // guard the click handler would immediately reopen the menu.
      if (Date.now() - this._manageMenuDismissedAt < 300) {
        return;
      }
      this._showManageMenu(gearBtn);
    });

    bottomSection.appendChild(gearBtn);
  }

  /** Tracks the currently-open manage menu so we can toggle it. */
  private _manageMenu: ContextMenu | null = null;
  /** Timestamp of the last manage-menu dismiss (used to defeat the mousedown/click race). */
  private _manageMenuDismissedAt = 0;

  /**
   * Show the Manage menu anchored above the gear icon (opens upward like VS Code).
   */
  private _showManageMenu(anchor: HTMLElement): void {
    const cmdService = this._services.get(ICommandService) as CommandService;
    const rect = anchor.getBoundingClientRect();

    const items: import('../ui/contextMenu.js').IContextMenuItem[] = [
      {
        id: 'workbench.action.showCommands',
        label: 'Command Palette...',
        keybinding: this._keybindingHint('workbench.action.showCommands'),
        group: '1_commands',
      },
      {
        id: 'manage.profiles',
        label: 'Profiles',
        group: '2_preferences',
        disabled: true,
      },
      {
        id: 'workbench.action.openSettings',
        label: 'Settings',
        keybinding: this._keybindingHint('workbench.action.openSettings'),
        group: '2_preferences',
      },
      {
        id: 'manage.extensions',
        label: 'Extensions',
        keybinding: 'Ctrl+Shift+X',
        group: '2_preferences',
        disabled: true,
      },
      {
        id: 'workbench.action.openKeybindings',
        label: 'Keyboard Shortcuts',
        keybinding: this._keybindingHint('workbench.action.openKeybindings'),
        group: '2_preferences',
      },
      {
        id: 'manage.tasks',
        label: 'Tasks',
        group: '2_preferences',
        disabled: true,
      },
      {
        id: 'manage.themes',
        label: 'Themes',
        group: '3_themes',
        submenu: [
          { id: 'workbench.action.selectTheme', label: 'Color Theme', keybinding: 'Ctrl+T', group: '1_themes' },
          { id: 'workbench.action.selectIconTheme', label: 'File Icon Theme', group: '1_themes', disabled: true },
          { id: 'workbench.action.selectProductIconTheme', label: 'Product Icon Theme', group: '1_themes', disabled: true },
        ],
      },
      {
        id: 'manage.checkUpdates',
        label: 'Check for Updates...',
        group: '4_updates',
        disabled: true,
      },
    ];

    // Anchor above the gear icon (VS Code pattern: menu opens upward)
    // We estimate a max height and position accordingly; viewport clamp handles overflows
    const estimatedMenuHeight = items.length * 28 + 24; // rough: items + separators
    const y = Math.max(8, rect.top - estimatedMenuHeight);

    const ctxMenu = ContextMenu.show({
      items,
      anchor: { x: rect.right + 4, y },
    });

    // Track the menu for toggle behavior
    this._manageMenu = ctxMenu;
    anchor.classList.add('active');
    ctxMenu.onDidDismiss(() => {
      this._manageMenuDismissedAt = Date.now();
      this._manageMenu = null;
      anchor.classList.remove('active');
    });

    ctxMenu.onDidSelect(({ item }) => {
      if (item.disabled) return;

      // Handle theme commands specially
      if (item.id === 'workbench.action.selectTheme') {
        this.selectColorTheme();
        return;
      }

      // Execute via command service for registered commands
      cmdService.executeCommand(item.id).catch(err => {
        console.error(`[Workbench] Manage menu action error:`, err);
      });
    });
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
      const editorUri = editor.uri?.toString();
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
    // Adapter satisfies LayoutHost without `as any` on the Workbench's protected members
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    layoutService.setHost({
      get container() { return self._container; },
      get _hGrid() { return self._hGrid; },
      get _vGrid() { return self._vGrid; },
      _layoutViewContainers: () => this._layoutViewContainers(),
      isPartVisible: (partId: string) => this.isPartVisible(partId),
      setPartHidden: (hidden: boolean, partId: string) => this.setPartHidden(hidden, partId),
    });
    this._register(layoutService);
    this._services.registerInstance(ILayoutService, layoutService);

    // View service — placeholder for M2 tool API surface
    const viewService = new ViewService();
    this._register(viewService);
    this._services.registerInstance(IViewService, viewService);

    // Workspace service — delegates to workbench workspace operations
    const workspaceService = new WorkspaceService();
    workspaceService.setHost({
      get workspace() { return self._workspace; },
      get _workspaceSaver() { return self._workspaceSaver; },
      createWorkspace: (name: string, path?: string, switchTo?: boolean) => self.createWorkspace(name, path, switchTo),
      switchWorkspace: (id: string) => self.switchWorkspace(id),
      getRecentWorkspaces: () => self.getRecentWorkspaces(),
      removeRecentWorkspace: (id: string) => self.removeRecentWorkspace(id),
      get onDidSwitchWorkspace() { return self.onDidSwitchWorkspace; },
    });
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
      notificationService.attach(this._container);
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
      notificationService: notificationService!,
      workbenchContainer: this._container,
      configurationService: this._configService,
      commandContributionProcessor: commandContribution,
      viewContributionProcessor: this._viewContribution,
      badgeHost: this._activityBarPart,
      statusBarPart: this._statusBar as unknown as StatusBarPart,
      themeService: this._services.has(IThemeService) ? this._services.get(IThemeService) : undefined,
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
    this._services.registerInstance(IToolActivatorService, this._toolActivator);

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
    this._titlebar.setCommandExecutor(this._services.get(ICommandService));

    // Wire context key evaluator for menu when-clause graying (M4)
    if (this._contextKeyService) {
      this._titlebar.setContextKeyEvaluator(this._contextKeyService);
    }

    // ── Wire file editor resolver (M4 Capability 4) ──
    this._initFileEditorResolver();

    // ── Wire file picker into Quick Access (M4 Capability 6) ──
    this._initQuickAccessFilePicker();

    // ── Register and activate built-in tools (M2 Capability 7) ──
    await this._registerAndActivateBuiltinTools(registry, activationEvents);

    // Fire startup finished — triggers * and onStartupFinished activation events
    activationEvents.fireStartupFinished();

    // ── Unsaved changes guard (QoL) ──
    this._wireUnsavedChangesGuard();

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
  private _initFileEditorResolver(): void {
    // ── 1. EditorResolverService ──
    const resolver = new EditorResolverService();
    this._register(resolver);

    const textFileModelManager = this._services.get(ITextFileModelManager);
    const fileService = this._services.get(IFileService);

    // Helper: compute workspace-relative path for tab description
    const getRelativePath = (uri: URI): string | undefined => {
      const workspaceService = this._services.has(IWorkspaceService)
        ? this._services.get(IWorkspaceService)
        : undefined;
      if (workspaceService?.folders) {
        for (const folder of workspaceService.folders) {
          const folderUri = typeof folder.uri === 'string' ? URI.parse(folder.uri) : folder.uri;
          const folderPath = folderUri.fsPath;
          if (uri.fsPath.startsWith(folderPath)) {
            return uri.fsPath.substring(folderPath.length + 1).replace(/\\/g, '/');
          }
        }
      }
      return undefined;
    };

    // ── Register built-in format readers (priority-sorted) ──

    // Markdown: opens in text editor by default (editable). Preview is
    // triggered via the "Markdown: Open Preview to the Side" command which
    // creates a MarkdownPreviewInput in a split group.
    // (No special resolver entry for .md — the wildcard text fallback handles it.)

    // Image viewer
    this._register(resolver.registerEditor({
      id: ImageEditorInput.TYPE_ID,
      name: 'Image Viewer',
      extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif'],
      priority: EditorResolverPriority.Default,
      createInput: (uri) => ImageEditorInput.create(uri),
      createPane: () => new ImageEditorPane(),
    }));

    // PDF viewer
    this._register(resolver.registerEditor({
      id: PdfEditorInput.TYPE_ID,
      name: 'PDF Viewer',
      extensions: ['.pdf'],
      priority: EditorResolverPriority.Default,
      createInput: (uri) => PdfEditorInput.create(uri),
      createPane: () => new PdfEditorPane(),
    }));

    // Text editor (fallback — matches everything)
    this._register(resolver.registerEditor({
      id: FileEditorInput.TYPE_ID,
      name: 'Text Editor',
      extensions: ['.*'],
      priority: EditorResolverPriority.Builtin,
      createInput: (uri) => FileEditorInput.create(uri, textFileModelManager, fileService, getRelativePath(uri)),
      createPane: () => new TextEditorPane(),
    }));

    // ── 2. Pane factory (routes input → pane) ──
    const services = this._services;
    const paneFactoryDisposable = registerEditorPaneFactory((input) => {
      // MarkdownPreviewInput → rendered preview pane
      if (input instanceof MarkdownPreviewInput) return new MarkdownEditorPane();

      // Image / PDF inputs → their dedicated panes
      if (input instanceof ImageEditorInput) return new ImageEditorPane();
      if (input instanceof PdfEditorInput) return new PdfEditorPane();

      // Keybindings viewer (QoL)
      if (input instanceof KeybindingsEditorInput) {
        const kbService = services.has(IKeybindingService)
          ? (services.get(IKeybindingService) as unknown as KeybindingService)
          : undefined;
        return new KeybindingsEditorPane(() => kbService?.getAllKeybindings() ?? []);
      }

      // Settings editor (QoL)
      if (input instanceof SettingsEditorInput) {
        return new SettingsEditorPane(services);
      }

      // FileEditorInput → always text editor (markdown is edited as text;
      // preview is opened separately via command)
      if (input instanceof FileEditorInput) return new TextEditorPane();

      // UntitledEditorInput → always text
      if (input instanceof UntitledEditorInput) return new TextEditorPane();

      return null;
    });
    this._register(paneFactoryDisposable);

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
        uri = URI.file(uriString);
      }

      // Deduplication: check if already open
      const existingInput = this._findOpenEditorInput(uri);
      if (existingInput) return existingInput;

      // Consult the EditorResolverService for the right input
      const resolution = resolver.resolve(uri);
      if (resolution) return resolution.input;

      // Absolute fallback — plain FileEditorInput
      return FileEditorInput.create(uri, textFileModelManager, fileService, getRelativePath(uri));
    });

    console.log('[Workbench] File editor resolver wired with format readers');

    // ── 4. Markdown preview toolbar button handler ──
    // When the user clicks the preview icon in the tab toolbar, open a
    // MarkdownPreviewInput in a split-right group (same as the command).
    const editorPart = this._editor as EditorPart;
    this._register(editorPart.onDidRequestMarkdownPreview((sourceGroup) => {
      const activeEditor = sourceGroup.model.activeEditor;
      if (!(activeEditor instanceof FileEditorInput)) return;

      const newGroup = editorPart.splitGroup(sourceGroup.id, GroupDirection.Right);
      if (!newGroup) return;

      // Close the duplicated text editor from split
      if (newGroup.model.count > 0) {
        newGroup.model.closeEditor(0, true);
      }

      const previewInput = MarkdownPreviewInput.create(activeEditor);
      newGroup.openEditor(previewInput, { pinned: true });
    }));

    // ── 5. Tab context menu: Reveal in Explorer ──
    // When the user selects "Reveal in Explorer" from a tab context menu,
    // execute the explorer.revealInExplorer command with the URI.
    this._register(editorPart.onDidRequestRevealInExplorer((uri) => {
      const cmdService = this._services.get(ICommandService) as CommandService;
      cmdService?.executeCommand('explorer.revealInExplorer', uri.toString());
    }));
  }

  /**
   * Find an already-open editor by URI across all editor groups.
   * Checks FileEditorInput, ImageEditorInput, and PdfEditorInput.
   */
  private _findOpenEditorInput(uri: URI): IEditorInput | undefined {
    const editorPart = this._editor as EditorPart;
    for (const group of editorPart.groups) {
      for (const editor of group.model.editors) {
        if (editor instanceof FileEditorInput && editor.uri.equals(uri)) {
          return editor;
        }
        if (editor instanceof ImageEditorInput && editor.uri.equals(uri)) {
          return editor;
        }
        if (editor instanceof PdfEditorInput && editor.uri.equals(uri)) {
          return editor;
        }
      }
    }
    return undefined;
  }

  /**
   * Wire the file picker delegate into the Quick Access widget (M4 Cap 6).
   * When Ctrl+P is pressed with workspace folders open, the user sees
   * workspace files matching their query, sorted by recency and fuzzy score.
   */
  private _initQuickAccessFilePicker(): void {
    if (!this._commandPalette) return;

    const fileService = this._services.has(IFileService)
      ? this._services.get(IFileService)
      : undefined;
    const workspaceService = this._services.has(IWorkspaceService)
      ? this._services.get(IWorkspaceService)
      : undefined;
    const editorService = this._services.has(IEditorService)
      ? this._services.get(IEditorService)
      : undefined;

    if (!fileService || !workspaceService) {
      console.warn('[Workbench] File picker not wired — missing fileService or workspaceService');
      return;
    }

    // Build delegate using minimal shapes to avoid leaking service internals
    this._commandPalette.setFilePickerDelegate(
      {
        getWorkspaceFolders: () => {
          return (workspaceService.folders ?? []).map((f: any) => ({
            uri: f.uri.toString(),
            name: f.name,
          }));
        },
        readDirectory: async (dirUri: string) => {
          const uri = URI.parse(dirUri);
          const entries: any[] = await fileService.readdir(uri);
          return entries.map((e: any) => ({
            name: e.name,
            uri: e.uri.toString(),
            type: e.type as number,
          }));
        },
        onDidChangeFolders: (listener: () => void) => {
          return workspaceService.onDidChangeFolders(listener);
        },
      },
      // openFileEditor callback — reuses the existing file editor resolver
      async (uriString: string) => {
        try {
          const uri = URI.parse(uriString);
          const textFileModelManager = this._services.get(ITextFileModelManager);
          // Deduplicate — reuse existing input if same file is already open
          const existing = this._findOpenEditorInput(uri);
          const input = existing ?? FileEditorInput.create(
            uri, textFileModelManager, fileService, undefined,
          );
          if (editorService) {
            await editorService.openEditor(input, { pinned: true });
          }
        } catch (err) {
          console.error('[QuickAccess] Failed to open file:', uriString, err);
        }
      },
    );

    console.log('[Workbench] Quick Access file picker wired');
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
      // If the view lives in a built-in sidebar container (as a placeholder),
      // replace the placeholder content with the real tool view content.
      this._replaceBuiltinPlaceholderIfNeeded(viewId);
    }));
  }

  /**
   * When a tool registers a view provider for a view that already exists in
   * a built-in sidebar container (as a placeholder), replace the placeholder
   * content with the real tool view content.
   */
  private _replaceBuiltinPlaceholderIfNeeded(viewId: string): void {
    // Find the built-in sidebar container that holds this view
    for (const [_id, vc] of this._builtinSidebarContainers) {
      const existingView = vc.getView(viewId);
      if (!existingView) continue;

      // Found the placeholder view in a built-in container.
      // Get the provider from the ViewContributionProcessor.
      const provider = this._viewContribution.getProvider(viewId);
      if (!provider) return;

      // Get the section body element where the placeholder is rendered
      const sectionEl = vc.element.querySelector(`[data-view-id="${viewId}"] .view-section-body`) as HTMLElement;
      if (!sectionEl) return;

      // Clear the placeholder content
      sectionEl.innerHTML = '';

      // Create a content wrapper for the real tool view
      const contentEl = $('div');
      contentEl.className = 'tool-view-content fill-container-scroll';
      sectionEl.appendChild(contentEl);

      // Resolve the real tool view into the container
      try {
        provider.resolveView(viewId, contentEl);
        console.log(`[Workbench] Replaced placeholder for "${viewId}" with real tool view`);
      } catch (err) {
        console.error(`[Workbench] Failed to resolve tool view for "${viewId}":`, err);
      }
      return;
    }
  }

  /**
   * Handle a tool contributing a new view container.
   * Creates the ViewContainer DOM and adds an activity bar / panel tab icon.
   *
   * VS Code parity: If a contributed sidebar container's title matches a
   * built-in sidebar container's view name (e.g. both are "Explorer"),
   * skip creating the duplicate container and icon. The container's views
   * will be redirected to the built-in container by _onToolViewAdded.
   */
  private _onToolContainerAdded(info: IContributedContainer): void {
    // ── Skip duplicate sidebar containers that overlap with built-ins ──
    if (info.location === 'sidebar') {
      for (const [builtinViewId, builtinVc] of this._builtinSidebarContainers) {
        const views = builtinVc.getViews();
        const matchesTitle = views.some(
          (v) => v.name.toLowerCase() === info.title.toLowerCase(),
        );
        if (matchesTitle) {
          // Record a redirect: views targeting this contributed container
          // will be added to the built-in container instead.
          this._containerRedirects.set(info.id, builtinViewId);
          console.log(
            `[Workbench] Skipped duplicate sidebar container "${info.id}" — ` +
            `redirecting views to built-in "${builtinViewId}"`,
          );
          return;
        }
      }
    }

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
    // Check if this container was redirected (no real container was created)
    if (this._containerRedirects.has(containerId)) {
      this._containerRedirects.delete(containerId);
      return;
    }

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
    let containerId = info.containerId;

    // If this view already exists in a built-in sidebar container (as a placeholder),
    // skip adding it to the contributed container. The placeholder will be replaced
    // when the tool registers its view provider (via onDidRegisterProvider).
    for (const [_id, vc] of this._builtinSidebarContainers) {
      if (vc.getView(info.id)) {
        console.log(`[Workbench] View "${info.id}" already in built-in container — skipping contributed add`);
        return;
      }
    }

    // If the target container was redirected to a built-in container,
    // add this view to the built-in container instead.
    const redirectTarget = this._containerRedirects.get(containerId);
    if (redirectTarget) {
      const builtinVc = this._builtinSidebarContainers.get(redirectTarget);
      if (builtinVc) {
        console.log(`[Workbench] Redirecting view "${info.id}" to built-in container "${redirectTarget}"`);
        this._addViewToContainer(info, builtinVc);
        return;
      }
    }

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
    // Map known icon identifiers to SVG codicons
    const svgIcon = this._resolveCodiconSvg(info.icon);
    this._activityBarPart.addIcon({
      id: info.id,
      icon: svgIcon ?? info.icon ?? info.title.charAt(0).toUpperCase(),
      isSvg: svgIcon !== undefined,
      label: info.title,
      source: 'contributed',
    });
  }

  /**
   * Resolve an icon identifier to a codicon SVG string.
   * Known icons get proper SVG; unknown return undefined (falls back to text).
   */
  private _resolveCodiconSvg(icon?: string): string | undefined {
    // Map emoji or codicon names to SVG paths
    const codiconMap: Record<string, string> = {
      // Extensions / puzzle piece
      '🧩': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7H16V4.5C16 3.12 14.88 2 13.5 2C12.12 2 11 3.12 11 4.5V7H6.5C5.67 7 5 7.67 5 8.5V13H7.5C8.88 13 10 14.12 10 15.5C10 16.88 8.88 18 7.5 18H5V22.5C5 23.33 5.67 24 6.5 24H11V21.5C11 20.12 12.12 19 13.5 19C14.88 19 16 20.12 16 21.5V24H20.5C21.33 24 22 23.33 22 22.5V18H19.5C18.12 18 17 16.88 17 15.5C17 14.12 18.12 13 19.5 13H22V8.5C22 7.67 21.33 7 20.5 7Z" fill="currentColor"/></svg>',
      'codicon-extensions': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7H16V4.5C16 3.12 14.88 2 13.5 2C12.12 2 11 3.12 11 4.5V7H6.5C5.67 7 5 7.67 5 8.5V13H7.5C8.88 13 10 14.12 10 15.5C10 16.88 8.88 18 7.5 18H5V22.5C5 23.33 5.67 24 6.5 24H11V21.5C11 20.12 12.12 19 13.5 19C14.88 19 16 20.12 16 21.5V24H20.5C21.33 24 22 23.33 22 22.5V18H19.5C18.12 18 17 16.88 17 15.5C17 14.12 18.12 13 19.5 13H22V8.5C22 7.67 21.33 7 20.5 7Z" fill="currentColor"/></svg>',
      // Settings gear
      '⚙️': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.85 8.75L18.01 8.07L19 6.54L17.46 5L15.93 5.99L15.25 4.15H13.25L12.57 5.99L11.04 5L9.5 6.54L10.49 8.07L8.65 8.75V10.75L10.49 11.43L9.5 12.96L11.04 14.5L12.57 13.51L13.25 15.35H15.25L15.93 13.51L17.46 14.5L19 12.96L18.01 11.43L19.85 10.75V8.75ZM14.25 12.5C13.01 12.5 12 11.49 12 10.25C12 9.01 13.01 8 14.25 8C15.49 8 16.5 9.01 16.5 10.25C16.5 11.49 15.49 12.5 14.25 12.5Z" fill="currentColor"/></svg>',
    };
    return icon ? codiconMap[icon] : undefined;
  }

  /**
   * Remove an activity bar icon for a deactivated tool container.
   */
  private _removeContributedActivityBarIcon(containerId: string): void {
    this._activityBarPart.removeIcon(containerId);
  }

  /**
   * Programmatically switch to a specific sidebar view and ensure sidebar is visible.
   * Used by commands like `workbench.view.search` (Ctrl+Shift+F).
   *
   * VS Code reference: ViewsService.openView()
   */
  showSidebarView(viewId: string): void {
    // Ensure sidebar is visible
    if (!this._sidebar.visible) {
      this.toggleSidebar();
    }
    // Switch to the requested container (builtin containers use viewId as key)
    if (this._builtinSidebarContainers.has(viewId) || this._contributedSidebarContainers.has(viewId)) {
      this._switchSidebarContainer(viewId);
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
    const commandService = this._services.get(ICommandService);
    if (commandService) {
      sb.setCommandExecutor((cmdId: string) => {
        commandService.executeCommand(cmdId);
      });
    }

    // ── Left-aligned entries ──

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

    // ── Right-aligned editor indicators (VS Code parity) ──
    // Order from left to right in the right section:
    //   Cursor Position | Indentation | Encoding | EOL | Language
    // Higher priority = further right (row-reverse), so language = lowest priority.

    const cursorAccessor = sb.addEntry({
      id: 'status.editor.selection',
      text: 'Ln 1, Col 1',
      alignment: StatusBarAlignment.Right,
      priority: 100,
      tooltip: 'Go to Line/Column (Ctrl+G)',
      command: 'workbench.action.gotoLine',
      name: 'Cursor Position',
    });

    const indentAccessor = sb.addEntry({
      id: 'status.editor.indentation',
      text: 'Spaces: 2',
      alignment: StatusBarAlignment.Right,
      priority: 80,
      tooltip: 'Indentation Settings',
      name: 'Indentation',
    });

    const encodingAccessor = sb.addEntry({
      id: 'status.editor.encoding',
      text: 'UTF-8',
      alignment: StatusBarAlignment.Right,
      priority: 70,
      tooltip: 'Select Encoding',
      name: 'Encoding',
    });

    const eolAccessor = sb.addEntry({
      id: 'status.editor.eol',
      text: 'LF',
      alignment: StatusBarAlignment.Right,
      priority: 60,
      tooltip: 'End of Line Sequence',
      name: 'End of Line',
    });

    const languageAccessor = sb.addEntry({
      id: 'status.editor.language',
      text: 'Plain Text',
      alignment: StatusBarAlignment.Right,
      priority: 50,
      tooltip: 'Select Language Mode',
      name: 'Language',
    });

    // Track accessors for dynamic updates
    this._statusBarAccessors = {
      branch: branchAccessor,
      errors: errorsAccessor,
      cursor: cursorAccessor,
      indent: indentAccessor,
      encoding: encodingAccessor,
      eol: eolAccessor,
      language: languageAccessor,
    };

    // ── Wire active editor → status bar indicators ──
    this._wireEditorStatusBarTracking();

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
            keybinding: this._keybindingHint('workbench.action.toggleStatusbarVisibility'),
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

  // ── Extension → Language display name map ──
  private static readonly EXT_TO_LANGUAGE: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript React',
    '.js': 'JavaScript', '.jsx': 'JavaScript React',
    '.json': 'JSON', '.jsonc': 'JSON with Comments',
    '.md': 'Markdown', '.markdown': 'Markdown',
    '.html': 'HTML', '.htm': 'HTML',
    '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less',
    '.py': 'Python', '.rb': 'Ruby', '.rs': 'Rust',
    '.go': 'Go', '.java': 'Java', '.c': 'C', '.cpp': 'C++', '.h': 'C',
    '.cs': 'C#', '.swift': 'Swift', '.kt': 'Kotlin',
    '.sh': 'Shell Script', '.bash': 'Shell Script', '.zsh': 'Shell Script',
    '.ps1': 'PowerShell', '.bat': 'Batch',
    '.xml': 'XML', '.svg': 'XML', '.yaml': 'YAML', '.yml': 'YAML',
    '.toml': 'TOML', '.ini': 'INI', '.cfg': 'INI',
    '.sql': 'SQL',
    '.r': 'R', '.R': 'R',
    '.lua': 'Lua', '.php': 'PHP', '.pl': 'Perl',
    '.txt': 'Plain Text', '.log': 'Log',
    '.dockerfile': 'Dockerfile',
    '.gitignore': 'Ignore', '.env': 'Properties',
  };

  /** Resolve a filename to a display language name. */
  private _getLanguageFromFileName(name: string): string {
    const lower = name.toLowerCase();
    // Exact filename matches
    if (lower === 'dockerfile') return 'Dockerfile';
    if (lower === 'makefile') return 'Makefile';
    if (lower === '.gitignore') return 'Ignore';
    if (lower === '.env') return 'Properties';

    const dotIdx = name.lastIndexOf('.');
    if (dotIdx >= 0) {
      const ext = name.substring(dotIdx).toLowerCase();
      return (this.constructor as typeof Workbench).EXT_TO_LANGUAGE[ext] ?? 'Plain Text';
    }
    return 'Plain Text';
  }

  /**
   * Wire active editor changes to update cursor position, language,
   * encoding, indentation, and EOL status bar indicators.
   *
   * VS Code parity: `EditorStatus` contribution in
   * `src/vs/workbench/browser/parts/editor/editorStatus.ts`.
   */
  private _wireEditorStatusBarTracking(): void {
    const editorService = this._services.has(IEditorService)
      ? this._services.get(IEditorService) as import('../services/editorService.js').EditorService
      : undefined;
    if (!editorService) return;

    const editorPart = this._editor as EditorPart;
    const acc = this._statusBarAccessors;

    /** Disposable for the cursor-position listener on the current TextEditorPane. */
    let cursorSub: IDisposable | undefined;

    // ── Language indicator updates (immediate — file name is available right away) ──
    const updateLanguage = (editor: IEditorInput | undefined) => {
      if (!editor) {
        acc.language?.update({ text: '' });
        return;
      }
      const lang = this._getLanguageFromFileName(editor.name ?? '');
      acc.language?.update({ text: lang, tooltip: `${lang} — Select Language Mode` });
    };

    // Fire on initial active editor and on every editor switch
    updateLanguage(editorService.activeEditor);
    this._register(editorService.onDidActiveEditorChange(updateLanguage));

    // ── Pane-dependent indicators (cursor, encoding, eol, indent) ──
    // These require the pane to be fully created. EditorGroupView fires
    // onDidActivePaneChange AFTER the async pane.setInput() completes,
    // so the pane is ready at that point.
    const updatePaneIndicators = (pane: import('../editor/editorPane.js').EditorPane | undefined) => {
      // Tear down previous cursor listener
      cursorSub?.dispose();
      cursorSub = undefined;

      if (pane instanceof TextEditorPane) {
        // Text editor — show all indicators
        acc.encoding?.update({ text: 'UTF-8' });
        acc.indent?.update({ text: 'Spaces: 2' });
        acc.cursor?.update({
          text: `Ln ${pane.cursorLine}, Col ${pane.cursorCol}`,
        });
        acc.eol?.update({ text: pane.eolLabel });

        // Live cursor position tracking
        cursorSub = pane.onDidChangeCursorPosition(({ line, col }) => {
          acc.cursor?.update({ text: `Ln ${line}, Col ${col}` });
        });
      } else {
        // No pane or non-text editor (image, markdown preview, etc.)
        acc.cursor?.update({ text: '' });
        acc.eol?.update({ text: '' });
        acc.indent?.update({ text: '' });
        acc.encoding?.update({ text: '' });
      }
    };

    // Listen to the reliable pane-ready signal from EditorPart
    this._register(editorPart.onDidActivePaneChange(updatePaneIndicators));

    // Fire once for the initial active pane (if any)
    updatePaneIndicators(editorPart.activeGroup?.activePane);

    // Clean up cursor sub on dispose
    this._register(toDisposable(() => cursorSub?.dispose()));
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

      const overlay = $('div');
      overlay.className = 'parallx-notification-center-overlay';
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hideCenter();
      });

      const panel = $('div');
      panel.className = 'parallx-notification-center';

      // Header
      const header = $('div');
      header.className = 'parallx-notification-center-header';
      const title = $('span');
      title.textContent = 'Notifications';
      header.appendChild(title);

      const clearBtn = $('button');
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
      const list = $('div');
      list.className = 'parallx-notification-center-list';

      const history = notifService.history;
      if (history.length === 0) {
        const empty = $('div');
        empty.className = 'parallx-notification-center-empty';
        empty.textContent = 'No notifications';
        list.appendChild(empty);
      } else {
        for (const notif of history) {
          const row = $('div');
          row.className = `parallx-notification-center-item parallx-notification-center-item-${notif.severity}`;

          const icon = $('span');
          icon.className = 'parallx-notification-center-icon';
          icon.textContent = notif.severity === 'information' ? 'ℹ' : notif.severity === 'warning' ? '⚠' : '✕';
          row.appendChild(icon);

          const msg = $('span');
          msg.className = 'parallx-notification-center-message';
          msg.textContent = notif.message;
          row.appendChild(msg);

          if (notif.source) {
            const src = $('span');
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
    const commandService = this._services.get(ICommandService);
    if (commandService?.registerCommand) {
      commandService.registerCommand({
        id: 'workbench.action.toggleNotificationCenter',
        title: 'Toggle Notification Center',
        handler: () => showCenter(),
      });
    }
  }

  /** Tracked status bar entry accessors for dynamic updates. */
  private _statusBarAccessors: {
    branch?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    errors?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    cursor?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    indent?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    encoding?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    eol?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
    language?: import('../parts/statusBarPart.js').StatusBarEntryAccessor;
  } = {};

  // ════════════════════════════════════════════════════════════════════════
  // Layout view containers
  // ════════════════════════════════════════════════════════════════════════

  protected override _layoutViewContainers(): void {
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

    // 2b. Manage gear icon
    this._addManageGearIcon();

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
    setTimeout(() => { if (overlay.parentElement) overlay.remove(); }, 300);
  }
}
