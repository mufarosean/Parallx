// workbench.ts — root shell orchestrator

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService } from '../services/serviceTypes.js';
import { LifecyclePhase, LifecycleService } from './lifecycle.js';
import { registerWorkbenchServices } from './workbenchServices.js';

/**
 * Events emitted by the workbench shell.
 */
export enum WorkbenchState {
  /** Not yet initialized */
  Created = 'created',
  /** Initialization is in progress */
  Initializing = 'initializing',
  /** Fully initialized and ready for interaction */
  Ready = 'ready',
  /** Shutting down */
  ShuttingDown = 'shuttingDown',
  /** Fully shut down */
  Disposed = 'disposed',
}

/**
 * The root workbench shell.
 *
 * This is the single entry point for the entire application.
 * It owns the service collection, lifecycle, and coordinates all
 * subsystems through a 5-phase initialization sequence:
 *
 *   1. Services — DI container is populated and core services are ready
 *   2. Layout — Grid layout system is initialized
 *   3. Parts — Structural parts (sidebar, panel, editor, etc.) are created and mounted
 *   4. WorkspaceRestore — Saved workspace state is loaded and applied
 *   5. Ready — Everything is live and interactive
 *
 * Teardown reverses this order (5→1).
 *
 * The shell itself contains no business logic — it delegates
 * entirely to services and lifecycle hooks.
 */
export class Workbench extends Disposable {
  private _state: WorkbenchState = WorkbenchState.Created;
  private readonly _services: ServiceCollection;
  private _lifecycle: LifecycleService | undefined;

  // ── Events ──

  private readonly _onDidChangeState = this._register(new Emitter<WorkbenchState>());
  /** Fired whenever the workbench transitions to a new state. */
  readonly onDidChangeState: Event<WorkbenchState> = this._onDidChangeState.event;

  private readonly _onDidInitialize = this._register(new Emitter<void>());
  /** Fired once when the workbench has completed all startup phases. */
  readonly onDidInitialize: Event<void> = this._onDidInitialize.event;

  private readonly _onWillShutdown = this._register(new Emitter<void>());
  /** Fired just before the workbench begins teardown. */
  readonly onWillShutdown: Event<void> = this._onWillShutdown.event;

  private readonly _onDidShutdown = this._register(new Emitter<void>());
  /** Fired after the workbench has completed teardown. */
  readonly onDidShutdown: Event<void> = this._onDidShutdown.event;

  /**
   * Create a workbench shell.
   *
   * @param container - The root DOM element to mount the workbench into.
   * @param services - Optional pre-configured service collection. If not
   *   provided, a new empty collection is created.
   */
  constructor(
    private readonly _container: HTMLElement,
    services?: ServiceCollection
  ) {
    super();
    this._services = services ?? new ServiceCollection();
    this._register(this._services);
  }

  // ── Public API ──

  /** Current workbench state. */
  get state(): WorkbenchState {
    return this._state;
  }

  /** The service collection (DI container) for this workbench. */
  get services(): ServiceCollection {
    return this._services;
  }

  /** The root DOM container. */
  get container(): HTMLElement {
    return this._container;
  }

  /**
   * Initialize the workbench by running all lifecycle phases in order.
   * Can only be called once.
   */
  async initialize(): Promise<void> {
    if (this._state !== WorkbenchState.Created) {
      throw new Error(`Workbench cannot be initialized from state: ${this._state}`);
    }

    this._setState(WorkbenchState.Initializing);

    // Phase 1: Register all services
    this._registerServices();

    // Get the lifecycle service for phased initialization
    this._lifecycle = this._services.get(ILifecycleService) as LifecycleService;

    // Register lifecycle hooks for remaining phases
    this._registerLifecycleHooks();

    // Execute all startup phases (1→5)
    await this._lifecycle.startup();

    // Workbench is now fully ready
    this._setState(WorkbenchState.Ready);
    this._onDidInitialize.fire();
  }

  /**
   * Shut down the workbench, tearing down all subsystems in reverse order.
   */
  async shutdown(): Promise<void> {
    if (this._state === WorkbenchState.Disposed || this._state === WorkbenchState.ShuttingDown) {
      return;
    }

    this._onWillShutdown.fire();
    this._setState(WorkbenchState.ShuttingDown);

    // Execute teardown phases (5→1)
    if (this._lifecycle) {
      await this._lifecycle.teardown();
    }

    // Dispose everything
    this.dispose();
    this._setState(WorkbenchState.Disposed);
    this._onDidShutdown.fire();
  }

  // ── Private Initialization ──

  /**
   * Phase 1: Register all services into the DI container.
   */
  private _registerServices(): void {
    registerWorkbenchServices(this._services);
  }

  /**
   * Register hooks for each lifecycle phase.
   * As capabilities are implemented, their hooks are added here.
   */
  private _registerLifecycleHooks(): void {
    const lifecycle = this._lifecycle!;

    // Phase 1: Services — already done by the time lifecycle starts
    lifecycle.onStartup(LifecyclePhase.Services, () => {
      // Services are already registered; this phase confirms readiness
    });

    // Phase 2: Layout — will be populated in Capability 2
    lifecycle.onStartup(LifecyclePhase.Layout, () => {
      this._initializeLayout();
    });

    // Phase 3: Parts — will be populated in Capability 3
    lifecycle.onStartup(LifecyclePhase.Parts, () => {
      this._initializeParts();
    });

    // Phase 4: Workspace Restore — will be populated in Capability 5
    lifecycle.onStartup(LifecyclePhase.WorkspaceRestore, () => {
      this._restoreWorkspace();
    });

    // Phase 5: Ready — final setup
    lifecycle.onStartup(LifecyclePhase.Ready, () => {
      // Mark workbench container as ready for CSS hooks
      this._container.classList.add('parallx-workbench');
      this._container.classList.add('parallx-ready');
    });

    // ── Teardown hooks (reverse order) ──

    lifecycle.onTeardown(LifecyclePhase.Ready, () => {
      this._container.classList.remove('parallx-ready');
    });

    lifecycle.onTeardown(LifecyclePhase.WorkspaceRestore, () => {
      // Save workspace state before tearing down — Capability 5
    });

    lifecycle.onTeardown(LifecyclePhase.Parts, () => {
      // Dispose parts — Capability 3
    });

    lifecycle.onTeardown(LifecyclePhase.Layout, () => {
      // Dispose layout — Capability 2
    });

    lifecycle.onTeardown(LifecyclePhase.Services, () => {
      // Final service cleanup happens via ServiceCollection.dispose()
    });
  }

  /**
   * Initialize the layout system. Placeholder for Capability 2.
   */
  private _initializeLayout(): void {
    // Will create and mount the grid layout system
  }

  /**
   * Initialize structural parts. Placeholder for Capability 3.
   */
  private _initializeParts(): void {
    // Will create and mount Titlebar, Sidebar, Panel, Editor, AuxiliaryBar, StatusBar
  }

  /**
   * Restore workspace state. Placeholder for Capability 5.
   */
  private _restoreWorkspace(): void {
    // Will load and apply saved workspace state
  }

  // ── Helpers ──

  private _setState(state: WorkbenchState): void {
    this._state = state;
    this._onDidChangeState.fire(state);
  }
}
