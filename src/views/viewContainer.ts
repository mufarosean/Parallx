// viewContainer.ts — container that hosts multiple views with tabbed UI

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS, Orientation } from '../layout/layoutTypes.js';
import { IGridView } from '../layout/gridView.js';
import { IView, ViewState } from './view.js';

// ─── Tab State ───────────────────────────────────────────────────────────────

export interface TabInfo {
  readonly viewId: string;
  readonly name: string;
  readonly icon?: string;
}

export interface ViewContainerState {
  readonly activeViewId: string | undefined;
  readonly tabOrder: readonly string[];
}

// ─── ViewContainer ───────────────────────────────────────────────────────────

/**
 * A container that hosts multiple views via a tabbed interface.
 *
 * The container itself implements `IGridView` so it can participate in
 * the grid layout system. Only one view is active (visible) at a time;
 * non-active views are hidden but not disposed.
 *
 * Size constraints are delegated to the **active** view — when the active
 * view changes, the container fires `onDidChangeConstraints` so the grid
 * can revalidate.
 */
export class ViewContainer extends Disposable implements IGridView {

  // ── DOM ──

  private readonly _element: HTMLElement;
  private readonly _tabBar: HTMLElement;
  private readonly _contentArea: HTMLElement;

  // ── State ──

  private readonly _views: Map<string, IView> = new Map();
  private readonly _tabElements: Map<string, HTMLElement> = new Map();
  private _tabOrder: string[] = [];
  private _activeViewId: string | undefined;

  private _width = 0;
  private _height = 0;
  private _visible = true;
  private _tabBarHeight = 35;

  // ── Events ──

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  private readonly _onDidAddView = this._register(new Emitter<IView>());
  readonly onDidAddView: Event<IView> = this._onDidAddView.event;

  private readonly _onDidRemoveView = this._register(new Emitter<string>());
  readonly onDidRemoveView: Event<string> = this._onDidRemoveView.event;

  constructor(readonly id: string) {
    super();

    // Root element
    this._element = document.createElement('div');
    this._element.classList.add('view-container', `view-container-${id}`);
    this._element.style.display = 'flex';
    this._element.style.flexDirection = 'column';
    this._element.style.overflow = 'hidden';
    this._element.style.position = 'relative';

    // Tab bar
    this._tabBar = document.createElement('div');
    this._tabBar.classList.add('view-container-tabs');
    this._tabBar.style.display = 'flex';
    this._tabBar.style.alignItems = 'center';
    this._tabBar.style.height = `${this._tabBarHeight}px`;
    this._tabBar.style.flexShrink = '0';
    this._tabBar.style.overflowX = 'auto';
    this._tabBar.style.overflowY = 'hidden';
    this._element.appendChild(this._tabBar);

    // Content area
    this._contentArea = document.createElement('div');
    this._contentArea.classList.add('view-container-content');
    this._contentArea.style.flex = '1';
    this._contentArea.style.overflow = 'hidden';
    this._contentArea.style.position = 'relative';
    this._element.appendChild(this._contentArea);
  }

  // ── IGridView ──

  get element(): HTMLElement { return this._element; }

  get minimumWidth(): number {
    return this._getActiveView()?.minimumWidth ?? 0;
  }
  get maximumWidth(): number {
    return this._getActiveView()?.maximumWidth ?? Number.POSITIVE_INFINITY;
  }
  get minimumHeight(): number {
    return (this._getActiveView()?.minimumHeight ?? 0) + this._tabBarHeight;
  }
  get maximumHeight(): number {
    const viewMax = this._getActiveView()?.maximumHeight ?? Number.POSITIVE_INFINITY;
    return viewMax === Number.POSITIVE_INFINITY ? viewMax : viewMax + this._tabBarHeight;
  }

  layout(width: number, height: number, _orientation: Orientation): void {
    this._width = width;
    this._height = height;

    this._element.style.width = `${width}px`;
    this._element.style.height = `${height}px`;

    // Layout the active view within the content area
    const contentH = height - this._tabBarHeight;
    const active = this._getActiveView();
    if (active) {
      active.layout(width, contentH);
    }
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this._element.style.display = visible ? 'flex' : 'none';
  }

  toJSON(): object {
    return {
      id: this.id,
      activeViewId: this._activeViewId,
      tabOrder: [...this._tabOrder],
    };
  }

  // ── View management ──

  /**
   * Add a view to this container.
   * Its DOM is created inside the content area but hidden until activated.
   */
  addView(view: IView, index?: number): void {
    if (this._views.has(view.id)) return;

    this._views.set(view.id, view);

    // Create the view element inside the content area
    view.createElement(this._contentArea);
    view.setVisible(false);

    // Insert into tab order
    if (index !== undefined && index >= 0 && index <= this._tabOrder.length) {
      this._tabOrder.splice(index, 0, view.id);
    } else {
      this._tabOrder.push(view.id);
    }

    // Create tab
    this._createTab(view);

    // Listen for constraint changes from the view
    if (view.onDidChangeConstraints) {
      this._register(view.onDidChangeConstraints(() => {
        if (this._activeViewId === view.id) {
          this._onDidChangeConstraints.fire();
        }
      }));
    }

    this._onDidAddView.fire(view);

    // If no active view, activate this one
    if (this._activeViewId === undefined) {
      this.activateView(view.id);
    }
  }

  /**
   * Remove a view from this container.
   */
  removeView(viewId: string): IView | undefined {
    const view = this._views.get(viewId);
    if (!view) return undefined;

    // Save state before removal
    view.setVisible(false);
    view.element?.remove();

    // Remove tab
    const tab = this._tabElements.get(viewId);
    tab?.remove();
    this._tabElements.delete(viewId);

    // Remove from tracking
    this._views.delete(viewId);
    this._tabOrder = this._tabOrder.filter(id => id !== viewId);

    this._onDidRemoveView.fire(viewId);

    // If active view was removed, activate the next one
    if (this._activeViewId === viewId) {
      const nextId = this._tabOrder[0];
      if (nextId) {
        this.activateView(nextId);
      } else {
        this._activeViewId = undefined;
        this._onDidChangeActiveView.fire(undefined);
      }
    }

    return view;
  }

  /**
   * Activate (show) a specific view, hiding the previous one.
   */
  activateView(viewId: string): void {
    if (this._activeViewId === viewId) return;

    // Hide current
    if (this._activeViewId) {
      const current = this._views.get(this._activeViewId);
      current?.setVisible(false);
      this._tabElements.get(this._activeViewId)?.classList.remove('tab-active');
    }

    // Show new
    const next = this._views.get(viewId);
    if (!next) return;

    next.setVisible(true);
    const contentH = this._height - this._tabBarHeight;
    next.layout(this._width, contentH);

    this._activeViewId = viewId;
    this._tabElements.get(viewId)?.classList.add('tab-active');

    this._onDidChangeActiveView.fire(viewId);
    this._onDidChangeConstraints.fire(); // constraints may differ
  }

  /**
   * Get the active view's ID.
   */
  get activeViewId(): string | undefined { return this._activeViewId; }

  /**
   * Get a view by ID.
   */
  getView(viewId: string): IView | undefined { return this._views.get(viewId); }

  /**
   * Get all views in tab order.
   */
  getViews(): readonly IView[] {
    return this._tabOrder
      .map(id => this._views.get(id))
      .filter((v): v is IView => v !== undefined);
  }

  /**
   * Get tab info for display.
   */
  getTabs(): readonly TabInfo[] {
    return this._tabOrder.map(id => {
      const view = this._views.get(id)!;
      return { viewId: id, name: view.name, icon: view.icon };
    });
  }

  /**
   * Reorder tabs.
   */
  reorderTabs(newOrder: readonly string[]): void {
    this._tabOrder = [...newOrder];
    this._rebuildTabBar();
  }

  // ── State persistence ──

  saveContainerState(): ViewContainerState {
    return {
      activeViewId: this._activeViewId,
      tabOrder: [...this._tabOrder],
    };
  }

  restoreContainerState(state: ViewContainerState): void {
    if (state.tabOrder.length > 0) {
      this._tabOrder = state.tabOrder.filter(id => this._views.has(id));
      this._rebuildTabBar();
    }
    if (state.activeViewId && this._views.has(state.activeViewId)) {
      this.activateView(state.activeViewId);
    }
  }

  // ── Tab DOM ──

  private _createTab(view: IView): void {
    const tab = document.createElement('div');
    tab.classList.add('view-tab');
    tab.dataset.viewId = view.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.style.display = 'flex';
    tab.style.alignItems = 'center';
    tab.style.padding = '0 12px';
    tab.style.cursor = 'pointer';
    tab.style.whiteSpace = 'nowrap';
    tab.style.height = '100%';
    tab.style.userSelect = 'none';
    tab.style.fontSize = '13px';

    // Icon
    if (view.icon) {
      const iconEl = document.createElement('span');
      iconEl.classList.add('view-tab-icon', view.icon);
      iconEl.style.marginRight = '6px';
      tab.appendChild(iconEl);
    }

    // Label
    const label = document.createElement('span');
    label.classList.add('view-tab-label');
    label.textContent = view.name;
    tab.appendChild(label);

    // Click to activate
    tab.addEventListener('click', () => this.activateView(view.id));

    // Drag-and-drop reordering
    tab.draggable = true;
    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', view.id);
      tab.classList.add('tab-dragging');
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('tab-dragging');
    });
    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      tab.classList.add('tab-drop-target');
    });
    tab.addEventListener('dragleave', () => {
      tab.classList.remove('tab-drop-target');
    });
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('tab-drop-target');
      const draggedId = e.dataTransfer?.getData('text/plain');
      if (draggedId && draggedId !== view.id) {
        this._moveTab(draggedId, view.id);
      }
    });

    this._tabElements.set(view.id, tab);
    this._tabBar.appendChild(tab);
  }

  private _moveTab(fromId: string, beforeId: string): void {
    const fromIdx = this._tabOrder.indexOf(fromId);
    const toIdx = this._tabOrder.indexOf(beforeId);
    if (fromIdx < 0 || toIdx < 0) return;

    this._tabOrder.splice(fromIdx, 1);
    const insertIdx = this._tabOrder.indexOf(beforeId);
    this._tabOrder.splice(insertIdx, 0, fromId);

    this._rebuildTabBar();
  }

  private _rebuildTabBar(): void {
    // Remove all tabs from DOM
    while (this._tabBar.firstChild) {
      this._tabBar.removeChild(this._tabBar.firstChild);
    }
    // Re-append in order
    for (const id of this._tabOrder) {
      const tab = this._tabElements.get(id);
      if (tab) {
        this._tabBar.appendChild(tab);
      }
    }
  }

  // ── Helpers ──

  private _getActiveView(): IView | undefined {
    return this._activeViewId ? this._views.get(this._activeViewId) : undefined;
  }

  override dispose(): void {
    for (const view of this._views.values()) {
      view.dispose();
    }
    this._views.clear();
    this._tabElements.clear();
    this._tabOrder = [];
    super.dispose();
  }
}
