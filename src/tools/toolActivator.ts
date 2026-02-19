// toolActivator.ts — tool activation and deactivation
//
// Manages the full lifecycle of tool activation:
//   1. Load the tool's entry-point module
//   2. Create a ToolContext with subscriptions, memento, toolPath
//   3. Create a scoped API object via the API factory
//   4. Call tool.activate(api, context) wrapped in error isolation
//   5. Track the activated tool for later deactivation
//
// Deactivation reverses the process:
//   1. Call tool.deactivate() (if exported, wrapped in try/catch)
//   2. Dispose all subscriptions
//   3. Clean up contributed entities (commands, views, context keys)
//   4. Clear module references for GC

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { ToolRegistry, ToolState } from './toolRegistry.js';
import { ToolModuleLoader } from './toolModuleLoader.js';
import type { ToolModule, ToolContext, ActivateFunction, DeactivateFunction } from './toolTypes.js';
import type { Memento } from '../configuration/configurationTypes.js';
import { ToolErrorService } from './toolErrorIsolation.js';
import { ActivationEventService } from './activationEventService.js';
import { createToolApi, ApiFactoryDependencies } from '../api/apiFactory.js';
import type { IToolDescription } from './toolManifest.js';
import { createToolMementos } from '../configuration/toolMemento.js';
import type { ActivatedTool, ToolActivationEvent, ToolStorageDependencies } from './toolTypes.js';
export type { ActivatedTool, ToolActivationEvent, ToolStorageDependencies } from './toolTypes.js';

// ─── Placeholder Memento ─────────────────────────────────────────────────────

/**
 * In-memory fallback Memento used when no persistent storage is available.
 */
class InMemoryMemento implements Memento {
  private readonly _data = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this._data.has(key)) {
      return this._data.get(key) as T;
    }
    return defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this._data.delete(key);
    } else {
      this._data.set(key, value);
    }
  }

  keys(): readonly string[] {
    return [...this._data.keys()];
  }
}

// ─── ToolActivator ───────────────────────────────────────────────────────────

/**
 * Manages tool activation and deactivation.
 *
 * The activator coordinates with:
 * - ToolRegistry for state transitions
 * - ToolModuleLoader for dynamic import()
 * - ToolErrorService for error isolation
 * - ActivationEventService for dedup marking
 * - API Factory for scoped API creation
 */
export class ToolActivator extends Disposable {

  /** Map of tool ID → activated tool record. */
  private readonly _activatedTools = new Map<string, ActivatedTool>();

  /** In-flight activation promises (prevents concurrent activation). */
  private readonly _activating = new Map<string, Promise<boolean>>();

  /** The module loader instance. */
  private readonly _loader = new ToolModuleLoader();

  // ── Events ──

  private readonly _onDidActivate = this._register(new Emitter<ToolActivationEvent>());
  /** Fires after a tool has been activated (success or failure). */
  readonly onDidActivate: Event<ToolActivationEvent> = this._onDidActivate.event;

  private readonly _onDidDeactivate = this._register(new Emitter<ToolActivationEvent>());
  /** Fires after a tool has been deactivated. */
  readonly onDidDeactivate: Event<ToolActivationEvent> = this._onDidDeactivate.event;

  constructor(
    private readonly _registry: ToolRegistry,
    private readonly _errorService: ToolErrorService,
    private readonly _activationEvents: ActivationEventService,
    private readonly _apiFactoryDeps: ApiFactoryDependencies,
    private readonly _storageDeps?: ToolStorageDependencies,
  ) {
    super();

    // Listen for force-deactivation signals from error service
    this._register(this._errorService.onWillForceDeactivate((toolId) => {
      console.error(`[ToolActivator] Force-deactivating tool "${toolId}" due to excessive errors`);
      this.deactivate(toolId).catch(err => {
        console.error(`[ToolActivator] Error during force-deactivation of "${toolId}":`, err);
      });
    }));
  }

  // ── Activation ──

  /**
   * Activate a tool by ID.
   *
   * Flow:
   * 1. Validate the tool is in the registry and in a valid state
   * 2. Transition to `Activating`
   * 3. Load the tool's entry module
   * 4. Create a ToolContext with subscriptions, memento, etc.
   * 5. Create a scoped API via the factory
   * 6. Call activate(api, context)
   * 7. Transition to `Activated` (or `Deactivated` on failure)
   */
  async activate(toolId: string): Promise<boolean> {
    // Guard against concurrent activation of the same tool
    const inFlight = this._activating.get(toolId);
    if (inFlight) {
      console.warn(`[ToolActivator] Activation already in flight for "${toolId}" — awaiting`);
      return inFlight;
    }

    const promise = this._doActivate(toolId);
    this._activating.set(toolId, promise);
    try {
      return await promise;
    } finally {
      this._activating.delete(toolId);
    }
  }

  private async _doActivate(toolId: string): Promise<boolean> {
    const startTime = performance.now();

    // 1. Lookup and validate
    const entry = this._registry.getById(toolId);
    if (!entry) {
      console.error(`[ToolActivator] Cannot activate unknown tool: "${toolId}"`);
      return false;
    }

    if (this._activatedTools.has(toolId)) {
      console.warn(`[ToolActivator] Tool "${toolId}" is already activated`);
      return true;
    }

    // Check state is valid for activation
    if (entry.state !== ToolState.Registered && entry.state !== ToolState.Deactivated) {
      console.error(`[ToolActivator] Cannot activate tool "${toolId}" in state: ${entry.state}`);
      return false;
    }

    // 2. Transition to Activating
    try {
      this._registry.setToolState(toolId, ToolState.Activating);
    } catch (err) {
      console.error(`[ToolActivator] State transition failed for "${toolId}":`, err);
      return false;
    }

    // 3. Load the module
    const loadResult = await this._loader.loadModule(entry.description);
    if (!loadResult.success) {
      const duration = performance.now() - startTime;
      this._errorService.recordError(toolId, new Error(loadResult.error), 'module-load');
      this._safeSetState(toolId, ToolState.Deactivated);
      this._onDidActivate.fire({ toolId, success: false, durationMs: duration, error: loadResult.error });
      return false;
    }

    const toolModule = loadResult.module;

    // 4. Create ToolContext
    const context = await this._createToolContext(entry.description);

    // 5. Create scoped API
    const { api, dispose: disposeApi } = createToolApi(entry.description, this._apiFactoryDeps);

    // 6. Call activate(api, context)
    try {
      const activateResult = toolModule.activate(api, context);
      // Handle async activation
      if (activateResult instanceof Promise) {
        await activateResult;
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._errorService.recordError(toolId, err, 'activation');
      // Clean up the API
      disposeApi();
      this._safeSetState(toolId, ToolState.Deactivated);
      this._onDidActivate.fire({ toolId, success: false, durationMs: duration, error: errorMsg });
      return false;
    }

    const duration = performance.now() - startTime;

    // 7. Record the activated tool
    const activated: ActivatedTool = {
      description: entry.description,
      module: toolModule,
      context,
      api,
      disposeApi,
      activatedAt: Date.now(),
      activationDurationMs: duration,
    };

    this._activatedTools.set(toolId, activated);

    // Transition to Activated
    this._safeSetState(toolId, ToolState.Activated);

    // Mark as activated in the event service (prevents re-activation)
    this._activationEvents.markActivated(toolId);

    console.log(`[ToolActivator] Tool "${toolId}" activated in ${duration.toFixed(1)}ms`);
    this._onDidActivate.fire({ toolId, success: true, durationMs: duration });

    return true;
  }

  // ── Built-in Activation ──

  /**
   * Activate a built-in tool using a pre-imported module.
   *
   * Built-in tools are bundled with the renderer — they can't be loaded
   * via dynamic import() in an IIFE bundle. This method is identical to
   * `activate()` except it skips the ToolModuleLoader step.
   *
   * @param toolId The tool's ID (must be registered in the registry).
   * @param moduleExports An object with `activate` (required) and optional `deactivate`.
   */
  async activateBuiltin(
    toolId: string,
    moduleExports: { activate: ActivateFunction; deactivate?: DeactivateFunction },
  ): Promise<boolean> {
    const startTime = performance.now();

    const entry = this._registry.getById(toolId);
    if (!entry) {
      console.error(`[ToolActivator] Cannot activate unknown built-in tool: "${toolId}"`);
      return false;
    }

    if (this._activatedTools.has(toolId)) {
      console.warn(`[ToolActivator] Built-in tool "${toolId}" is already activated`);
      return true;
    }

    if (entry.state !== ToolState.Registered && entry.state !== ToolState.Deactivated) {
      console.error(`[ToolActivator] Cannot activate built-in tool "${toolId}" in state: ${entry.state}`);
      return false;
    }

    this._safeSetState(toolId, ToolState.Activating);

    // Wrap module exports as ToolModule (skip module loader)
    const toolModule: ToolModule = {
      activate: moduleExports.activate,
      deactivate: moduleExports.deactivate,
      rawModule: moduleExports as unknown as Record<string, unknown>,
    };

    const context = await this._createToolContext(entry.description);
    const { api, dispose: disposeApi } = createToolApi(entry.description, this._apiFactoryDeps);

    try {
      const activateResult = toolModule.activate(api, context);
      if (activateResult instanceof Promise) {
        await activateResult;
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._errorService.recordError(toolId, err, 'activation');
      disposeApi();
      this._safeSetState(toolId, ToolState.Deactivated);
      this._onDidActivate.fire({ toolId, success: false, durationMs: duration, error: errorMsg });
      return false;
    }

    const duration = performance.now() - startTime;

    this._activatedTools.set(toolId, {
      description: entry.description,
      module: toolModule,
      context,
      api,
      disposeApi,
      activatedAt: Date.now(),
      activationDurationMs: duration,
    });

    this._safeSetState(toolId, ToolState.Activated);
    this._activationEvents.markActivated(toolId);

    console.log(`[ToolActivator] Built-in tool "${toolId}" activated in ${duration.toFixed(1)}ms`);
    this._onDidActivate.fire({ toolId, success: true, durationMs: duration });

    return true;
  }

  // ── Deactivation ──

  /**
   * Deactivate a tool by ID.
   *
   * Flow:
   * 1. Look up the activated tool record
   * 2. Transition to `Deactivating`
   * 3. Call deactivate() if exported (wrapped in try/catch)
   * 4. Dispose all subscriptions
   * 5. Dispose the API bridges
   * 6. Transition to `Deactivated`
   * 7. Clear references for GC
   */
  async deactivate(toolId: string): Promise<boolean> {
    const startTime = performance.now();
    const activated = this._activatedTools.get(toolId);

    if (!activated) {
      console.warn(`[ToolActivator] Tool "${toolId}" is not activated — nothing to deactivate`);
      return false;
    }

    // 2. Transition to Deactivating
    this._safeSetState(toolId, ToolState.Deactivating);

    const errors: string[] = [];

    // 3. Call deactivate() if available
    if (activated.module.deactivate) {
      try {
        const result = activated.module.deactivate();
        if (result instanceof Promise) {
          await result;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`deactivate() threw: ${msg}`);
        this._errorService.recordError(toolId, err, 'deactivation');
        // Continue with disposal — deactivation is tolerant
      }
    }

    // 4. Dispose all subscriptions
    const subs = activated.context.subscriptions;
    for (let i = subs.length - 1; i >= 0; i--) {
      try {
        subs[i].dispose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`subscription dispose error: ${msg}`);
      }
    }
    subs.length = 0;

    // 5. Dispose the API bridges
    try {
      activated.disposeApi();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`API dispose error: ${msg}`);
    }

    // 6. Transition to Deactivated
    this._safeSetState(toolId, ToolState.Deactivated);

    // 7. Clear references
    this._activatedTools.delete(toolId);
    this._activationEvents.clearActivated(toolId);

    const duration = performance.now() - startTime;

    if (errors.length > 0) {
      console.warn(
        `[ToolActivator] Tool "${toolId}" deactivated with ${errors.length} error(s):`,
        errors.join('; '),
      );
    } else {
      console.log(`[ToolActivator] Tool "${toolId}" deactivated in ${duration.toFixed(1)}ms`);
    }

    this._onDidDeactivate.fire({
      toolId,
      success: errors.length === 0,
      durationMs: duration,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    });

    return true;
  }

  // ── Deactivate All ──

  /**
   * Deactivate all activated tools. Used during shell teardown.
   */
  async deactivateAll(): Promise<void> {
    const toolIds = [...this._activatedTools.keys()];
    for (const toolId of toolIds) {
      await this.deactivate(toolId);
    }
  }

  // ── Queries ──

  /**
   * Get the activated tool record for a tool.
   */
  getActivated(toolId: string): ActivatedTool | undefined {
    return this._activatedTools.get(toolId);
  }

  /**
   * Get all activated tool IDs.
   */
  getActivatedToolIds(): readonly string[] {
    return [...this._activatedTools.keys()];
  }

  /**
   * Check if a tool is currently activated.
   */
  isActivated(toolId: string): boolean {
    return this._activatedTools.has(toolId);
  }

  // ── Internal ──

  /**
   * Create a ToolContext for a tool.
   * Uses persistent ToolMemento when storage is available, otherwise InMemoryMemento.
   */
  private async _createToolContext(description: IToolDescription): Promise<ToolContext> {
    let globalState: Memento;
    let workspaceState: Memento;

    if (this._storageDeps) {
      const mementos = createToolMementos(
        this._storageDeps.globalStorage,
        this._storageDeps.workspaceStorage,
        description.manifest.id,
        this._storageDeps.workspaceIdProvider,
      );
      // Load persisted data into cache
      await mementos.globalState.load();
      await mementos.workspaceState.load();
      globalState = mementos.globalState;
      workspaceState = mementos.workspaceState;

      // Register configuration schemas from manifest if available
      if (this._storageDeps.configRegistry && description.manifest.contributes?.configuration) {
        for (const config of description.manifest.contributes.configuration) {
          this._storageDeps.configRegistry.registerFromManifest(
            description.manifest.id,
            [config],
          );
        }
      }
    } else {
      globalState = new InMemoryMemento();
      workspaceState = new InMemoryMemento();
    }

    return {
      subscriptions: [],
      globalState,
      workspaceState,
      toolPath: description.toolPath,
      toolUri: `file:///${description.toolPath.replace(/\\/g, '/')}`,  
      environmentVariableCollection: {},
    };
  }

  /**
   * Safely set tool state, catching any transition errors.
   */
  private _safeSetState(toolId: string, state: ToolState): void {
    try {
      this._registry.setToolState(toolId, state);
    } catch (err) {
      console.error(`[ToolActivator] Failed to set state ${state} for "${toolId}":`, err);
    }
  }

  // ── Disposal ──

  /**
   * Async disposal: properly awaits all tool deactivations before
   * synchronous cleanup. The workbench shutdown path should call
   * this instead of relying on the synchronous `dispose()`.
   */
  async disposeAsync(): Promise<void> {
    await this.deactivateAll();
    this.dispose();
  }

  override dispose(): void {
    // Synchronous-only cleanup. If disposeAsync() (or deactivateAll()) was
    // called first, the map is already empty and this is a no-op loop.
    // If dispose() is called directly (abnormal teardown), we do best-effort
    // synchronous cleanup without awaiting async deactivate handlers.
    for (const [toolId, activated] of this._activatedTools) {
      for (const sub of activated.context.subscriptions) {
        try { sub.dispose(); } catch { /* best effort */ }
      }
      try { activated.disposeApi(); } catch { /* best effort */ }
      this._safeSetState(toolId, ToolState.Deactivated);
    }
    this._activatedTools.clear();

    super.dispose();
  }
}
