// viewManager.ts — view lifecycle + placement
import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IView, ViewState } from './view.js';
import { IViewDescriptor } from './viewDescriptor.js';

// ─── Lifecycle Events ────────────────────────────────────────────────────────

export enum ViewLifecyclePhase {
  Registered = 'registered',
  Created = 'created',
  Visible = 'visible',
  Hidden = 'hidden',
  Focused = 'focused',
  Disposed = 'disposed',
}

export interface ViewLifecycleEvent {
  readonly viewId: string;
  readonly phase: ViewLifecyclePhase;
}

// ─── ViewManager ─────────────────────────────────────────────────────────────

/**
 * Singleton service that manages the lifecycle and placement of all views.
 *
 * Responsibilities:
 * - Registers view descriptors and creates views lazily from them.
 * - Tracks view lifecycle transitions and emits events.
 * - Coordinates view placement into parts / view containers.
 * - Tracks active and visible views.
 * - Handles view disposal and cleanup.
 * - Provides view lookup by ID.
 */
export class ViewManager extends Disposable {

  /** Registered descriptors. */
  private readonly _descriptors = new Map<string, IViewDescriptor>();

  /** Created view instances (populated lazily). */
  private readonly _views = new Map<string, IView>();

  /** Saved states for views (survives dispose → re-create cycles). */
  private readonly _savedStates = new Map<string, ViewState>();

  /** Set of currently visible view IDs. */
  private readonly _visibleViews = new Set<string>();

  /** The currently focused view ID. */
  private _activeViewId: string | undefined;

  // ── Events ──

  private readonly _onDidRegister = this._register(new Emitter<IViewDescriptor>());
  readonly onDidRegister: Event<IViewDescriptor> = this._onDidRegister.event;

  private readonly _onDidLifecycle = this._register(new Emitter<ViewLifecycleEvent>());
  /** Fires on every lifecycle transition (registered, created, visible, hidden, focused, disposed). */
  readonly onDidLifecycle: Event<ViewLifecycleEvent> = this._onDidLifecycle.event;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  // ── Registration ──

  /**
   * Register a view descriptor. The view will be created lazily.
   */
  register(descriptor: IViewDescriptor): void {
    if (this._descriptors.has(descriptor.id)) {
      throw new Error(`View "${descriptor.id}" is already registered.`);
    }
    this._descriptors.set(descriptor.id, descriptor);
    this._onDidRegister.fire(descriptor);
    this._fireLifecycle(descriptor.id, ViewLifecyclePhase.Registered);
  }

  /**
   * Register multiple descriptors.
   */
  registerMany(descriptors: readonly IViewDescriptor[]): void {
    for (const d of descriptors) {
      this.register(d);
    }
  }

  /**
   * Check if a descriptor is registered.
   */
  hasDescriptor(viewId: string): boolean {
    return this._descriptors.has(viewId);
  }

  /**
   * Unregister a view descriptor by ID.
   * If the view has been created, it is disposed first.
   */
  unregister(viewId: string): void {
    if (!this._descriptors.has(viewId)) return;
    if (this._views.has(viewId)) {
      this.disposeView(viewId);
    }
    this._descriptors.delete(viewId);
    this._savedStates.delete(viewId);
  }

  /**
   * Get a descriptor by ID.
   */
  getDescriptor(viewId: string): IViewDescriptor | undefined {
    return this._descriptors.get(viewId);
  }

  /**
   * Get all registered descriptors.
   */
  getDescriptors(): readonly IViewDescriptor[] {
    return [...this._descriptors.values()];
  }

  /**
   * Get descriptors for a specific container.
   */
  getDescriptorsForContainer(containerId: string): readonly IViewDescriptor[] {
    return [...this._descriptors.values()]
      .filter(d => d.containerId === containerId)
      .sort((a, b) => a.order - b.order);
  }

  // ── Creation ──

  /**
   * Create a view from its registered descriptor.
   * If already created, returns the existing instance.
   * Supports async factories (lazy loading).
   */
  async createView(viewId: string): Promise<IView> {
    // Return existing
    const existing = this._views.get(viewId);
    if (existing) return existing;

    const descriptor = this._descriptors.get(viewId);
    if (!descriptor) {
      throw new Error(`No descriptor registered for view "${viewId}".`);
    }

    const view = await descriptor.factory();
    this._views.set(viewId, view);
    this._fireLifecycle(viewId, ViewLifecyclePhase.Created);

    // Restore saved state if available
    const saved = this._savedStates.get(viewId);
    if (saved) {
      view.restoreState(saved);
    }

    return view;
  }

  /**
   * Create a view synchronously (throws if factory is async).
   */
  createViewSync(viewId: string): IView {
    const existing = this._views.get(viewId);
    if (existing) return existing;

    const descriptor = this._descriptors.get(viewId);
    if (!descriptor) {
      throw new Error(`No descriptor registered for view "${viewId}".`);
    }

    const result = descriptor.factory();
    if (result instanceof Promise) {
      throw new Error(`View "${viewId}" has an async factory. Use createView() instead.`);
    }

    this._views.set(viewId, result);
    this._fireLifecycle(viewId, ViewLifecyclePhase.Created);

    const saved = this._savedStates.get(viewId);
    if (saved) {
      result.restoreState(saved);
    }

    return result;
  }

  // ── Lookup ──

  /**
   * Get a created view instance by ID (undefined if not yet created).
   */
  getView(viewId: string): IView | undefined {
    return this._views.get(viewId);
  }

  /**
   * Get all created view instances.
   */
  getViews(): readonly IView[] {
    return [...this._views.values()];
  }

  /**
   * Check if a view has been created.
   */
  isCreated(viewId: string): boolean {
    return this._views.has(viewId);
  }

  // ── Visibility ──

  /**
   * Show a view (mark as visible, fire event).
   */
  showView(viewId: string): void {
    const view = this._views.get(viewId);
    if (!view) return;

    view.setVisible(true);
    this._visibleViews.add(viewId);
    this._fireLifecycle(viewId, ViewLifecyclePhase.Visible);
  }

  /**
   * Hide a view (without disposing it).
   */
  hideView(viewId: string): void {
    const view = this._views.get(viewId);
    if (!view) return;

    view.setVisible(false);
    this._visibleViews.delete(viewId);
    this._fireLifecycle(viewId, ViewLifecyclePhase.Hidden);

    // If this was the active view, clear active
    if (this._activeViewId === viewId) {
      this._setActiveView(undefined);
    }
  }

  /**
   * Get all visible view IDs.
   */
  getVisibleViewIds(): readonly string[] {
    return [...this._visibleViews];
  }

  /**
   * Check if a view is currently visible.
   */
  isVisible(viewId: string): boolean {
    return this._visibleViews.has(viewId);
  }

  // ── Focus / Active ──

  /**
   * Focus a view and mark it as the active view.
   */
  focusView(viewId: string): void {
    const view = this._views.get(viewId);
    if (!view) return;

    view.focus();
    this._setActiveView(viewId);
    this._fireLifecycle(viewId, ViewLifecyclePhase.Focused);
  }

  /**
   * The currently active (focused) view ID.
   */
  get activeViewId(): string | undefined {
    return this._activeViewId;
  }

  // ── State ──

  /**
   * Save state for a specific view.
   */
  saveViewState(viewId: string): void {
    const view = this._views.get(viewId);
    if (view) {
      this._savedStates.set(viewId, view.saveState());
    }
  }

  /**
   * Save state for all created views.
   */
  saveAllStates(): void {
    for (const [id, view] of this._views) {
      this._savedStates.set(id, view.saveState());
    }
  }

  /**
   * Get saved state for a view (even if the view is disposed).
   */
  getSavedState(viewId: string): ViewState | undefined {
    return this._savedStates.get(viewId);
  }

  // ── Disposal ──

  /**
   * Dispose a single view. Its state is saved before disposal
   * so it can be restored if re-created.
   */
  disposeView(viewId: string): void {
    const view = this._views.get(viewId);
    if (!view) return;

    // Save state before disposing
    this._savedStates.set(viewId, view.saveState());

    // Clean up tracking
    this._visibleViews.delete(viewId);
    if (this._activeViewId === viewId) {
      this._setActiveView(undefined);
    }

    view.dispose();
    this._views.delete(viewId);
    this._fireLifecycle(viewId, ViewLifecyclePhase.Disposed);
  }

  /**
   * Dispose all views (typically at shutdown).
   */
  override dispose(): void {
    this.saveAllStates();
    for (const view of this._views.values()) {
      view.dispose();
    }
    this._views.clear();
    this._visibleViews.clear();
    this._descriptors.clear();
    super.dispose();
  }

  // ── Internals ──

  private _setActiveView(viewId: string | undefined): void {
    if (this._activeViewId !== viewId) {
      this._activeViewId = viewId;
      this._onDidChangeActiveView.fire(viewId);
    }
  }

  private _fireLifecycle(viewId: string, phase: ViewLifecyclePhase): void {
    this._onDidLifecycle.fire({ viewId, phase });
  }
}