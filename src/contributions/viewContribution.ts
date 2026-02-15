// viewContribution.ts — processes contributes.viewContainers and contributes.views
//
// Handles declarative view and view container contributions from tool manifests.
// Creates view containers in the appropriate workbench parts and registers
// view descriptors with the ViewManager. Manages the view provider registry
// that bridges manifest declarations to runtime view content.
//
// Tasks: 6.1 (ViewContainer contribution), 6.2 (View contribution),
//        6.3 (View provider pattern)

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $,  hide, show } from '../ui/dom.js';
import type { IToolDescription } from '../tools/toolManifest.js';
import type { IContributionProcessor } from './contributionTypes.js';
import type { ViewManager } from '../views/viewManager.js';
import type { IView, ViewState } from '../views/view.js';
import { DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';

// ─── Container Location ──────────────────────────────────────────────────────

/**
 * Where a contributed container should appear in the workbench.
 */
export type ContainerLocation = 'sidebar' | 'panel' | 'auxiliaryBar';

// ─── Contributed Container ───────────────────────────────────────────────────

/**
 * A view container contributed by a tool through its manifest.
 */
export interface IContributedContainer {
  /** Unique container ID from the manifest. */
  readonly id: string;
  /** The tool that contributed this container. */
  readonly toolId: string;
  /** Human-readable title for the activity bar / tab. */
  readonly title: string;
  /** Icon identifier (emoji, CSS class, or codicon). */
  readonly icon?: string;
  /** Where the container appears: sidebar, panel, or auxiliaryBar. */
  readonly location: ContainerLocation;
  /** Ordering priority (lower = higher position). Built-ins use 0–50. */
  readonly priority: number;
}

// ─── Contributed View ────────────────────────────────────────────────────────

/**
 * A view contributed by a tool through its manifest.
 */
export interface IContributedView {
  /** Unique view ID from the manifest. */
  readonly id: string;
  /** The tool that contributed this view. */
  readonly toolId: string;
  /** Human-readable name shown in tabs and menus. */
  readonly name: string;
  /** The container this view belongs to. */
  readonly containerId: string;
  /** Icon identifier. */
  readonly icon?: string;
  /** When-clause controlling visibility. */
  readonly when?: string;
}

// ─── Tool View Provider ──────────────────────────────────────────────────────

/**
 * A view provider registered at runtime by a tool via `parallx.views.registerViewProvider()`.
 * The shell calls `resolveView()` when the view needs to be rendered.
 */
export interface IToolViewProvider {
  resolveView(viewId: string, container: HTMLElement): void | IDisposable;
}

// ─── ViewContributionProcessor ───────────────────────────────────────────────

/**
 * Processes `contributes.viewContainers` and `contributes.views` from tool manifests.
 *
 * Responsibilities:
 * - Register contributed containers and emit events for the workbench to create DOM
 * - Register contributed view descriptors in the ViewManager with placeholder factories
 * - Manage the view provider registry (runtime provider → contributed view wiring)
 * - Clean up all contributions when a tool is deactivated
 */
export class ViewContributionProcessor extends Disposable implements IContributionProcessor {

  // ── Per-tool tracking ──

  /** Tool ID → contributed containers. */
  private readonly _toolContainers = new Map<string, IContributedContainer[]>();

  /** Tool ID → contributed views. */
  private readonly _toolViews = new Map<string, IContributedView[]>();

  // ── Global registries ──

  /** Container ID → container info. */
  private readonly _containers = new Map<string, IContributedContainer>();

  /** View ID → view info. */
  private readonly _views = new Map<string, IContributedView>();

  /** View ID → runtime provider (registered by tool during activation). */
  private readonly _providers = new Map<string, IToolViewProvider>();

  /**
   * View ID → resolver function.
   * When a view element is created before its provider is registered,
   * the resolver is stored here. Calling it renders the provider's content.
   */
  private readonly _pendingResolvers = new Map<string, (provider: IToolViewProvider) => void>();

  // ── Events ──

  private readonly _onDidAddContainer = this._register(new Emitter<IContributedContainer>());
  readonly onDidAddContainer: Event<IContributedContainer> = this._onDidAddContainer.event;

  private readonly _onDidRemoveContainer = this._register(new Emitter<string>());
  readonly onDidRemoveContainer: Event<string> = this._onDidRemoveContainer.event;

  private readonly _onDidAddView = this._register(new Emitter<IContributedView>());
  readonly onDidAddView: Event<IContributedView> = this._onDidAddView.event;

  private readonly _onDidRemoveView = this._register(new Emitter<string>());
  readonly onDidRemoveView: Event<string> = this._onDidRemoveView.event;

  private readonly _onDidRegisterProvider = this._register(new Emitter<{ viewId: string }>());
  readonly onDidRegisterProvider: Event<{ viewId: string }> = this._onDidRegisterProvider.event;

  constructor(
    private _viewManager: ViewManager,
  ) {
    super();
  }

  /**
   * Update the ViewManager reference after a workspace switch.
   * Re-registers all existing view descriptors into the new ViewManager.
   */
  updateViewManager(viewManager: ViewManager): void {
    this._viewManager = viewManager;

    // Re-register all tracked view descriptors into the new ViewManager
    for (const [, views] of this._toolViews) {
      for (const v of views) {
        if (!this._viewManager.hasDescriptor(v.id)) {
          this._viewManager.register({
            id: v.id,
            name: v.name,
            icon: v.icon,
            containerId: v.containerId,
            when: v.when,
            constraints: DEFAULT_SIZE_CONSTRAINTS,
            focusOnActivate: false,
            order: 100,
            factory: () => this._createContributedView(v.id, v.name, v.icon),
          });
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // IContributionProcessor
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Process a tool's manifest contributions for viewContainers and views.
   * Safe to call for re-enable after removeContributions — all state is
   * cleaned up on remove so re-processing starts fresh.
   */
  processContributions(description: IToolDescription): void {
    const toolId = description.manifest.id;
    const contributes = description.manifest.contributes;
    if (!contributes) return;

    // Safety: if contributions for this tool already exist (e.g., double-enable
    // without disable), remove them first to avoid duplicates.
    if (this._toolContainers.has(toolId) || this._toolViews.has(toolId)) {
      console.log(`[ViewContribution] Re-processing contributions for "${toolId}" — clearing previous state`);
      this.removeContributions(toolId);
    }

    // ── Process viewContainers ──
    if (contributes.viewContainers && contributes.viewContainers.length > 0) {
      const containers: IContributedContainer[] = [];

      for (const vc of contributes.viewContainers) {
        if (this._containers.has(vc.id)) {
          console.warn(`[ViewContribution] Duplicate container ID "${vc.id}" from tool "${toolId}" — skipping.`);
          continue;
        }

        const contributed: IContributedContainer = {
          id: vc.id,
          toolId,
          title: vc.title,
          icon: vc.icon,
          location: vc.location,
          priority: 100, // tool-contributed containers sort below built-ins (0–50)
        };

        this._containers.set(vc.id, contributed);
        containers.push(contributed);
        this._onDidAddContainer.fire(contributed);
      }

      this._toolContainers.set(toolId, containers);
    }

    // ── Process views ──
    if (contributes.views && contributes.views.length > 0) {
      const views: IContributedView[] = [];

      for (const v of contributes.views) {
        const containerId = v.defaultContainerId ?? 'sidebar';

        // Warn if the container doesn't exist (not built-in AND not contributed)
        if (!this._isKnownContainer(containerId)) {
          console.warn(
            `[ViewContribution] View "${v.id}" references unknown container "${containerId}". ` +
            `It will be registered but may not display until the container is available.`,
          );
        }

        const contributed: IContributedView = {
          id: v.id,
          toolId,
          name: v.name,
          containerId,
          icon: v.icon,
          when: v.when,
        };

        this._views.set(v.id, contributed);
        views.push(contributed);

        // Register a view descriptor in ViewManager with a factory
        // that creates a contributed view (placeholder until provider registered)
        if (!this._viewManager.hasDescriptor(v.id)) {
          this._viewManager.register({
            id: v.id,
            name: v.name,
            icon: v.icon,
            containerId,
            when: v.when,
            constraints: DEFAULT_SIZE_CONSTRAINTS,
            focusOnActivate: false,
            order: 100,
            factory: () => this._createContributedView(v.id, v.name, v.icon),
          });
        }

        this._onDidAddView.fire(contributed);
      }

      this._toolViews.set(toolId, views);
    }
  }

  /**
   * Remove all contributions from a specific tool.
   */
  removeContributions(toolId: string): void {
    // Remove views first (they reference containers)
    const views = this._toolViews.get(toolId);
    if (views) {
      for (const v of views) {
        this._views.delete(v.id);
        this._providers.delete(v.id);
        this._pendingResolvers.delete(v.id);
        this._viewManager.unregister(v.id);
        this._onDidRemoveView.fire(v.id);
      }
      this._toolViews.delete(toolId);
    }

    // Remove containers
    const containers = this._toolContainers.get(toolId);
    if (containers) {
      for (const c of containers) {
        this._containers.delete(c.id);
        this._onDidRemoveContainer.fire(c.id);
      }
      this._toolContainers.delete(toolId);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // View Provider Management (Task 6.3)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Register a view provider for a contributed view.
   *
   * - If the view is already created and showing a placeholder, it resolves immediately.
   * - If the view hasn't been created yet, the provider is stored for when it is.
   * - Returns a Disposable that unregisters the provider.
   */
  registerProvider(viewId: string, provider: IToolViewProvider): IDisposable {
    this._providers.set(viewId, provider);

    // If the view's element is already created and waiting, resolve now
    const resolver = this._pendingResolvers.get(viewId);
    if (resolver) {
      resolver(provider);
      this._pendingResolvers.delete(viewId);
    }

    this._onDidRegisterProvider.fire({ viewId });

    return toDisposable(() => {
      if (this._providers.get(viewId) === provider) {
        this._providers.delete(viewId);
      }
    });
  }

  /**
   * Check if a view was declared in a tool's manifest.
   */
  hasContributedView(viewId: string): boolean {
    return this._views.has(viewId);
  }

  /**
   * Get all tool IDs that have contributed views or containers.
   */
  getContributedToolIds(): readonly string[] {
    const ids = new Set<string>();
    for (const toolId of this._toolContainers.keys()) ids.add(toolId);
    for (const toolId of this._toolViews.keys()) ids.add(toolId);
    return [...ids];
  }

  /**
   * Get the registered provider for a view.
   */
  getProvider(viewId: string): IToolViewProvider | undefined {
    return this._providers.get(viewId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Container Queries
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get all contributed containers.
   */
  getContainers(): readonly IContributedContainer[] {
    return [...this._containers.values()];
  }

  /**
   * Get contributed containers for a specific location.
   */
  getContainersForLocation(location: ContainerLocation): readonly IContributedContainer[] {
    return [...this._containers.values()]
      .filter(c => c.location === location)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get all contributed views for a container.
   */
  getViewsForContainer(containerId: string): readonly IContributedView[] {
    return [...this._views.values()].filter(v => v.containerId === containerId);
  }

  /**
   * Get a contributed container by ID.
   */
  getContainer(containerId: string): IContributedContainer | undefined {
    return this._containers.get(containerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Contributed View Factory (private)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Factory function: creates an IView for a contributed view.
   *
   * If a provider is already registered, the view renders immediately.
   * Otherwise, a placeholder is shown until `registerProvider()` is called.
   */
  private _createContributedView(viewId: string, name: string, icon?: string): IView {
    // Check if provider is already available when the factory runs
    let _provider = this._providers.get(viewId);

    let _element: HTMLElement | undefined;
    let _placeholderEl: HTMLElement | undefined;
    let _contentEl: HTMLElement | undefined;
    let _providerDisposable: IDisposable | undefined;
    let _disposed = false;
    let _resolved = false;
    let _width = 0;
    let _height = 0;

    const _onDidChangeConstraints = new Emitter<void>();
    const _onDidChangeVisibility = new Emitter<boolean>();

    // ── Resolve provider content into the view ──
    const doResolve = (provider: IToolViewProvider): void => {
      if (_resolved || _disposed) return;
      _resolved = true;

      // Remove placeholder
      if (_placeholderEl) {
        _placeholderEl.remove();
        _placeholderEl = undefined;
      }

      // Create content container
      if (_element) {
        _contentEl = $('div');
        _contentEl.className = 'tool-view-content';
        _element.appendChild(_contentEl);

        if (_width > 0 || _height > 0) {
          _contentEl.style.width = `${_width}px`;
          _contentEl.style.height = `${_height}px`;
        }

        try {
          const result = provider.resolveView(viewId, _contentEl);
          if (result && typeof (result as IDisposable).dispose === 'function') {
            _providerDisposable = result as IDisposable;
          }
        } catch (err) {
          console.error(`[ViewContribution] Error resolving view "${viewId}":`, err);
          _contentEl.textContent = `Error loading view: ${err}`;
        }
      }
    };

    // ── Build the IView object ──
    const view: IView = {
      get id() { return viewId; },
      get name() { return name; },
      get icon() { return icon; },
      get element() { return _element; },

      // Size constraints — use defaults; tools control their own layout
      get minimumWidth() { return DEFAULT_SIZE_CONSTRAINTS.minimumWidth; },
      get maximumWidth() { return DEFAULT_SIZE_CONSTRAINTS.maximumWidth; },
      get minimumHeight() { return DEFAULT_SIZE_CONSTRAINTS.minimumHeight; },
      get maximumHeight() { return DEFAULT_SIZE_CONSTRAINTS.maximumHeight; },

      onDidChangeConstraints: _onDidChangeConstraints.event,
      onDidChangeVisibility: _onDidChangeVisibility.event,

      createElement(container: HTMLElement): void {
        if (_disposed) return;

        _element = $('div');
        _element.className = `view view-${viewId} contributed-view`;
        _element.setAttribute('data-view-id', viewId);
        hide(_element); // hidden until setVisible(true)
        container.appendChild(_element);

        if (_provider) {
          // Provider already registered — resolve immediately
          doResolve(_provider);
        } else {
          // Show placeholder until provider registers
          _placeholderEl = $('div');
          _placeholderEl.className = 'contributed-view-placeholder';

          const nameEl = $('div');
          nameEl.textContent = name;
          nameEl.className = 'contributed-view-placeholder__name';
          _placeholderEl.appendChild(nameEl);

          const msgEl = $('div');
          msgEl.textContent = 'Waiting for view provider\u2026';
          msgEl.className = 'contributed-view-placeholder__msg';
          _placeholderEl.appendChild(msgEl);

          _element.appendChild(_placeholderEl);
        }
      },

      setVisible(visible: boolean): void {
        if (_element) {
          visible ? show(_element) : hide(_element);
        }
        _onDidChangeVisibility.fire(visible);
      },

      focus(): void {
        _element?.focus();
      },

      layout(width: number, height: number): void {
        _width = width;
        _height = height;
        if (_element) {
          _element.style.width = `${width}px`;
          _element.style.height = `${height}px`;
        }
        if (_contentEl) {
          _contentEl.style.width = `${width}px`;
          _contentEl.style.height = `${height}px`;
        }
      },

      saveState(): ViewState {
        return {};
      },

      restoreState(_state: ViewState): void {
        // Tool views manage their own state through the Memento API
      },

      dispose(): void {
        if (_disposed) return;
        _disposed = true;
        _providerDisposable?.dispose();
        _onDidChangeConstraints.dispose();
        _onDidChangeVisibility.dispose();
        _element?.remove();
        _element = undefined;
      },
    };

    // If provider not yet available, register a pending resolver
    // so registerProvider() can trigger immediate rendering
    if (!_provider) {
      this._pendingResolvers.set(viewId, (provider: IToolViewProvider) => {
        _provider = provider;
        if (_element && !_resolved) {
          doResolve(provider);
        }
      });
    }

    return view;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Check if a container ID is known (either a built-in part or a contributed container).
   */
  private _isKnownContainer(containerId: string): boolean {
    // Built-in part IDs
    const builtinIds = new Set([
      'sidebar',
      'panel',
      'auxiliaryBar',
      'workbench.parts.sidebar',
      'workbench.parts.panel',
      'workbench.parts.auxiliarybar',
    ]);
    return builtinIds.has(containerId) || this._containers.has(containerId);
  }
}
