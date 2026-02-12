// viewContainer.ts — container that hosts multiple views with tabbed UI

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS, Orientation } from '../layout/layoutTypes.js';
import { IGridView } from '../layout/gridView.js';
import { IView, ViewState } from './view.js';

// ─── Tab State ───────────────────────────────────────────────────────────────

export type ViewContainerMode = 'tabbed' | 'stacked';

export interface TabInfo {
  readonly viewId: string;
  readonly name: string;
  readonly icon?: string;
}

export interface ViewContainerState {
  readonly activeViewId: string | undefined;
  readonly tabOrder: readonly string[];
  readonly collapsedSections?: readonly string[];
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
  private readonly _viewDisposables: Map<string, IDisposable> = new Map();
  private readonly _tabElements: Map<string, HTMLElement> = new Map();
  private _tabOrder: string[] = [];
  private _activeViewId: string | undefined;

  private _width = 0;
  private _height = 0;
  private _visible = true;
  private _tabBarHeight = 35;

  // ── Stacked mode ──

  private _mode: ViewContainerMode = 'tabbed';
  private _collapsedSections = new Set<string>();
  private _sectionElements = new Map<string, { wrapper: HTMLElement; header: HTMLElement; body: HTMLElement; actionsSlot: HTMLElement }>();
  private _sectionSashes: HTMLElement[] = [];
  private _sectionSashDragState: { sashIndex: number; startY: number } | null = null;

  static readonly SECTION_HEADER_HEIGHT = 22;
  static readonly SECTION_SASH_HEIGHT = 4;

  // ── Events ──

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  private readonly _onDidAddView = this._register(new Emitter<IView>());
  readonly onDidAddView: Event<IView> = this._onDidAddView.event;

  private readonly _onDidRemoveView = this._register(new Emitter<string>());
  readonly onDidRemoveView: Event<string> = this._onDidRemoveView.event;

  /** Fires when a section header is right-clicked. Consumers can show a context menu. */
  private readonly _onDidContextMenuSection = this._register(new Emitter<{ viewId: string; x: number; y: number; event: MouseEvent }>());
  readonly onDidContextMenuSection: Event<{ viewId: string; x: number; y: number; event: MouseEvent }> = this._onDidContextMenuSection.event;

  /** Fires when a stacked section is created. Consumers can render actions into the provided slot. */
  private readonly _onDidCreateSection = this._register(new Emitter<{ viewId: string; actionsSlot: HTMLElement }>());
  readonly onDidCreateSection: Event<{ viewId: string; actionsSlot: HTMLElement }> = this._onDidCreateSection.event;

  constructor(readonly id: string) {
    super();

    // Root element
    this._element = document.createElement('div');
    this._element.classList.add('view-container', `view-container-${id}`);

    // Tab bar
    this._tabBar = document.createElement('div');
    this._tabBar.classList.add('view-container-tabs');
    this._tabBar.style.height = `${this._tabBarHeight}px`;
    this._tabBar.setAttribute('role', 'tablist');
    this._tabBar.setAttribute('aria-orientation', 'horizontal');
    this._element.appendChild(this._tabBar);

    // Keyboard navigation for tabs (VS Code parity: ArrowLeft/Right, Home/End)
    this._tabBar.addEventListener('keydown', (e) => {
      const tabs = Array.from(this._tabBar.querySelectorAll<HTMLElement>('.view-tab'));
      if (tabs.length === 0) return;

      const focused = document.activeElement as HTMLElement;
      const currentIdx = tabs.indexOf(focused);
      if (currentIdx < 0) return;

      let nextIdx = -1;
      switch (e.key) {
        case 'ArrowRight':
          nextIdx = (currentIdx + 1) % tabs.length;
          break;
        case 'ArrowLeft':
          nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = tabs.length - 1;
          break;
        case 'Enter':
        case ' ': {
          const viewId = focused.dataset.viewId;
          if (viewId) this.activateView(viewId);
          e.preventDefault();
          return;
        }
        default:
          return;
      }

      if (nextIdx >= 0) {
        e.preventDefault();
        tabs[nextIdx].focus();
        const viewId = tabs[nextIdx].dataset.viewId;
        if (viewId) this.activateView(viewId);
      }
    });

    // Content area
    this._contentArea = document.createElement('div');
    this._contentArea.classList.add('view-container-content');
    this._element.appendChild(this._contentArea);
  }

  // ── IGridView ──

  get element(): HTMLElement { return this._element; }

  /**
   * Hide the built-in tab bar (e.g. when an external activity bar controls switching).
   */
  hideTabBar(): void {
    this._tabBar.classList.add('hidden');
    this._tabBarHeight = 0;
  }

  /**
   * Set the container's display mode.
   *
   * - `'tabbed'` (default) — one view visible at a time, controlled by tab bar or external switcher.
   * - `'stacked'` — all views visible simultaneously with collapsible section headers.
   *   Matches VS Code's ViewPaneContainer pattern for sidebar view containers.
   */
  setMode(mode: ViewContainerMode): void {
    if (this._mode === mode) return;
    this._mode = mode;

    if (mode === 'stacked') {
      // Hide tab bar in stacked mode
      this._tabBar.classList.add('hidden');
      this._tabBarHeight = 0;

      // Rebuild: convert all existing views to stacked sections
      for (const viewId of this._tabOrder) {
        const view = this._views.get(viewId);
        if (!view) continue;
        // Remove view element from content area (addView already created it there)
        view.element?.remove();
        // Create section wrapper
        this._createSection(view);
      }
      // Show all views
      for (const view of this._views.values()) {
        view.setVisible(true);
      }
      this._rebuildSectionSashes();
      this._updateStackedHeaders();
    }
  }

  get mode(): ViewContainerMode { return this._mode; }

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

    if (this._mode === 'stacked') {
      this._layoutStacked();
    } else {
      // Layout the active view within the content area
      const contentH = height - this._tabBarHeight;
      const active = this._getActiveView();
      if (active) {
        active.layout(width, contentH);
      }
    }
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this._element.classList.toggle('hidden', !visible);
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

    // Insert into tab order
    if (index !== undefined && index >= 0 && index <= this._tabOrder.length) {
      this._tabOrder.splice(index, 0, view.id);
    } else {
      this._tabOrder.push(view.id);
    }

    if (this._mode === 'stacked') {
      // Stacked mode: create section wrapper and show view immediately
      this._createSection(view);
      view.setVisible(true);
      this._rebuildSectionSashes();
      this._updateStackedHeaders();
    } else {
      // Tabbed mode: create view element hidden, create tab
      view.createElement(this._contentArea);
      view.setVisible(false);
      this._createTab(view);
    }

    // Listen for constraint changes from the view
    if (view.onDidChangeConstraints) {
      const constraintDisposable = view.onDidChangeConstraints(() => {
        if (this._mode === 'stacked' || this._activeViewId === view.id) {
          this._onDidChangeConstraints.fire();
        }
      });
      this._viewDisposables.set(view.id, constraintDisposable);
    }

    this._onDidAddView.fire(view);

    // If no active view, activate this one
    if (this._activeViewId === undefined) {
      if (this._mode === 'stacked') {
        this._activeViewId = view.id;
      } else {
        this.activateView(view.id);
      }
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

    if (this._mode === 'stacked') {
      // Remove section DOM
      this._removeSection(viewId);
    } else {
      // Remove view element and tab
      view.element?.remove();
      const tab = this._tabElements.get(viewId);
      tab?.remove();
      this._tabElements.delete(viewId);
    }

    // Dispose per-view listener
    this._viewDisposables.get(viewId)?.dispose();
    this._viewDisposables.delete(viewId);

    // Remove from tracking
    this._views.delete(viewId);
    this._tabOrder = this._tabOrder.filter(id => id !== viewId);
    this._collapsedSections.delete(viewId);

    this._onDidRemoveView.fire(viewId);

    // If active view was removed, activate the next one
    if (this._activeViewId === viewId) {
      const nextId = this._tabOrder[0];
      if (nextId) {
        if (this._mode === 'stacked') {
          this._activeViewId = nextId;
        } else {
          this.activateView(nextId);
        }
      } else {
        this._activeViewId = undefined;
        this._onDidChangeActiveView.fire(undefined);
      }
    }

    if (this._mode === 'stacked') {
      this._rebuildSectionSashes();
      this._updateStackedHeaders();
    }

    return view;
  }

  /**
   * Activate (show) a specific view, hiding the previous one.
   */
  activateView(viewId: string): void {
    if (this._activeViewId === viewId && this._mode !== 'stacked') return;

    if (this._mode === 'stacked') {
      // In stacked mode, "activate" means ensure the section is expanded + focused
      if (this._collapsedSections.has(viewId)) {
        this.toggleSectionCollapse(viewId);
      }
      this._activeViewId = viewId;
      this._onDidChangeActiveView.fire(viewId);
      // Scroll section into view
      const section = this._sectionElements.get(viewId);
      section?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    // Hide current
    if (this._activeViewId) {
      const current = this._views.get(this._activeViewId);
      current?.setVisible(false);
      const prevTab = this._tabElements.get(this._activeViewId);
      prevTab?.classList.remove('tab-active');
      prevTab?.setAttribute('aria-selected', 'false');
      prevTab?.setAttribute('tabindex', '-1');
    }

    // Show new
    const next = this._views.get(viewId);
    if (!next) return;

    next.setVisible(true);
    const contentH = this._height - this._tabBarHeight;
    next.layout(this._width, contentH);

    this._activeViewId = viewId;
    const nextTab = this._tabElements.get(viewId);
    nextTab?.classList.add('tab-active');
    nextTab?.setAttribute('aria-selected', 'true');
    nextTab?.setAttribute('tabindex', '0');

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
      collapsedSections: this._mode === 'stacked' ? [...this._collapsedSections] : undefined,
    };
  }

  restoreContainerState(state: ViewContainerState): void {
    if (state.tabOrder.length > 0) {
      this._tabOrder = state.tabOrder.filter(id => this._views.has(id));
      if (this._mode !== 'stacked') {
        this._rebuildTabBar();
      }
    }
    if (state.collapsedSections && this._mode === 'stacked') {
      for (const viewId of state.collapsedSections) {
        if (this._views.has(viewId) && !this._collapsedSections.has(viewId)) {
          this.toggleSectionCollapse(viewId);
        }
      }
    }
    if (state.activeViewId && this._views.has(state.activeViewId)) {
      this.activateView(state.activeViewId);
    }
  }

  // ── Stacked Mode: Section Management ──

  /**
   * Toggle collapse state of a section in stacked mode.
   */
  toggleSectionCollapse(viewId: string): void {
    if (this._mode !== 'stacked') return;

    const section = this._sectionElements.get(viewId);
    const view = this._views.get(viewId);
    if (!section || !view) return;

    if (this._collapsedSections.has(viewId)) {
      // Expand
      this._collapsedSections.delete(viewId);
      section.body.style.display = '';
      section.header.setAttribute('aria-expanded', 'true');
      section.wrapper.classList.remove('collapsed');
      const chevron = section.header.querySelector('.view-section-chevron') as HTMLElement | null;
      if (chevron) chevron.textContent = '▾';
      view.setVisible(true);
    } else {
      // Collapse
      this._collapsedSections.add(viewId);
      section.body.style.display = 'none';
      section.header.setAttribute('aria-expanded', 'false');
      section.wrapper.classList.add('collapsed');
      const chevron = section.header.querySelector('.view-section-chevron') as HTMLElement | null;
      if (chevron) chevron.textContent = '▸';
      view.setVisible(false);
    }

    this._layoutStacked();
  }

  /**
   * Create a section wrapper for a view in stacked mode.
   */
  private _createSection(view: IView): void {
    const wrapper = document.createElement('div');
    wrapper.classList.add('view-section');
    wrapper.dataset.viewId = view.id;

    // Header
    const header = document.createElement('div');
    header.classList.add('view-section-header');
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'true');

    const chevron = document.createElement('span');
    chevron.classList.add('view-section-chevron');
    chevron.textContent = '▾';
    header.appendChild(chevron);

    const title = document.createElement('span');
    title.classList.add('view-section-title');
    title.textContent = view.name;
    header.appendChild(title);

    // Actions slot — consumers (workbench) can render action buttons here
    const actionsSlot = document.createElement('div');
    actionsSlot.classList.add('view-section-actions');
    header.appendChild(actionsSlot);

    wrapper.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.classList.add('view-section-body');
    wrapper.appendChild(body);

    // Mount the view inside the body
    view.createElement(body);

    // Click header toggles collapse
    header.addEventListener('click', () => this.toggleSectionCollapse(view.id));

    // Keyboard: Enter/Space toggles collapse
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleSectionCollapse(view.id);
      }
    });

    // Right-click context menu
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._onDidContextMenuSection.fire({ viewId: view.id, x: e.clientX, y: e.clientY, event: e });
    });

    this._sectionElements.set(view.id, { wrapper, header, body, actionsSlot });
    this._onDidCreateSection.fire({ viewId: view.id, actionsSlot });
    this._contentArea.appendChild(wrapper);
  }

  /**
   * Remove a section from stacked mode DOM.
   */
  private _removeSection(viewId: string): void {
    const section = this._sectionElements.get(viewId);
    if (section) {
      section.wrapper.remove();
      this._sectionElements.delete(viewId);
    }
  }

  /**
   * Rebuild section sashes (resize handles between stacked sections).
   */
  private _rebuildSectionSashes(): void {
    // Remove old sashes
    for (const sash of this._sectionSashes) sash.remove();
    this._sectionSashes = [];

    if (this._mode !== 'stacked') return;

    // Insert sashes between adjacent sections
    const sections = this._tabOrder
      .map(id => this._sectionElements.get(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    for (let i = 0; i < sections.length - 1; i++) {
      const sash = document.createElement('div');
      sash.classList.add('view-section-sash');
      sash.dataset.sashIndex = String(i);

      sash.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._onSectionSashMouseDown(i, e.clientY);
      });

      // Insert sash after section[i] in the content area
      sections[i].wrapper.after(sash);
      this._sectionSashes.push(sash);
    }
  }

  /**
   * Handle mousedown on a section sash for vertical resize between stacked sections.
   */
  private _onSectionSashMouseDown(sashIndex: number, startY: number): void {
    this._sectionSashDragState = { sashIndex, startY };

    const expandedIds = this._tabOrder.filter(id => !this._collapsedSections.has(id));
    if (expandedIds.length < 2) return;

    // Find which two expanded sections this sash is between
    const aboveId = expandedIds[sashIndex];
    const belowId = expandedIds[sashIndex + 1];
    if (!aboveId || !belowId) return;

    const aboveBody = this._sectionElements.get(aboveId)?.body;
    const belowBody = this._sectionElements.get(belowId)?.body;
    if (!aboveBody || !belowBody) return;

    let aboveH = aboveBody.offsetHeight;
    let belowH = belowBody.offsetHeight;

    const onMouseMove = (e: MouseEvent): void => {
      const delta = e.clientY - startY;
      startY = e.clientY;

      const newAbove = Math.max(22, aboveH + delta);
      const newBelow = Math.max(22, belowH - delta);

      aboveBody.style.height = `${newAbove}px`;
      belowBody.style.height = `${newBelow}px`;

      aboveH = newAbove;
      belowH = newBelow;

      // Layout views within resized sections
      const aboveView = this._views.get(aboveId);
      const belowView = this._views.get(belowId);
      aboveView?.layout(this._width, newAbove);
      belowView?.layout(this._width, newBelow);
    };

    const onMouseUp = (): void => {
      this._sectionSashDragState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  /**
   * Hide/show section headers based on the number of views.
   * VS Code parity: when container has only one view, the section header is hidden
   * and the view fills the entire content area.
   */
  private _updateStackedHeaders(): void {
    const singleView = this._views.size <= 1;
    for (const [, section] of this._sectionElements) {
      section.header.classList.toggle('hidden', singleView);
    }
    // Also hide sashes when single view
    for (const sash of this._sectionSashes) {
      sash.classList.toggle('hidden', singleView);
    }
  }

  /**
   * Distribute heights among stacked sections.
   */
  private _layoutStacked(): void {
    if (this._mode !== 'stacked') return;

    const totalH = this._height;
    const singleView = this._views.size <= 1;
    const headerH = singleView ? 0 : ViewContainer.SECTION_HEADER_HEIGHT;
    const sashH = ViewContainer.SECTION_SASH_HEIGHT;

    const viewIds = this._tabOrder.filter(id => this._views.has(id));
    const expandedIds = viewIds.filter(id => !this._collapsedSections.has(id));
    const collapsedIds = viewIds.filter(id => this._collapsedSections.has(id));

    // Space used by all section headers + collapsed sections + sashes
    const headerSpace = viewIds.length * headerH;
    const sashSpace = Math.max(0, viewIds.length - 1) * sashH;
    const availableForBodies = Math.max(0, totalH - headerSpace - sashSpace);

    // Split body space equally among expanded sections
    const expandedCount = expandedIds.length;
    const perSectionBodyH = expandedCount > 0 ? Math.floor(availableForBodies / expandedCount) : 0;

    for (const viewId of viewIds) {
      const section = this._sectionElements.get(viewId);
      const view = this._views.get(viewId);
      if (!section || !view) continue;

      if (!section.header.classList.contains('hidden')) {
        section.header.style.height = `${headerH}px`;
      }

      if (this._collapsedSections.has(viewId)) {
        section.body.style.height = '0px';
        section.body.style.display = 'none';
      } else {
        section.body.style.display = '';
        section.body.style.height = `${perSectionBodyH}px`;
        view.layout(this._width, perSectionBodyH);
      }
    }
  }

  // ── Tab DOM ──

  private _createTab(view: IView): void {
    const tab = document.createElement('div');
    tab.classList.add('view-tab');
    tab.dataset.viewId = view.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');

    // Icon
    if (view.icon) {
      const iconEl = document.createElement('span');
      iconEl.classList.add('view-tab-icon', view.icon);
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
    for (const d of this._viewDisposables.values()) {
      d.dispose();
    }
    this._viewDisposables.clear();
    for (const view of this._views.values()) {
      view.dispose();
    }
    this._views.clear();
    this._tabElements.clear();
    this._sectionElements.clear();
    this._sectionSashes = [];
    this._collapsedSections.clear();
    this._tabOrder = [];
    super.dispose();
  }
}
