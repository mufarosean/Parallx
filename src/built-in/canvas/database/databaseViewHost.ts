// databaseViewHost.ts — Shared database view engine
//
// Owns the full lifecycle of rendering a database: loading data, creating
// ViewTabBar + DatabaseToolbar, switching views, and reacting to data
// changes. Both databaseEditorProvider (full-page) and databaseInlineNode
// (inline) delegate to this single component — the only difference is the
// DOM slots they provide.
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom),
// databaseRegistry (gate import — this file is a databaseRegistry child)

import { Disposable, DisposableStore } from '../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../platform/events.js';
import { $ } from '../../../ui/dom.js';
import {
  ViewTabBar,
  TableView,
  BoardView,
  ListView,
  GalleryView,
  CalendarView,
  TimelineView,
  DatabaseToolbar,
  applyViewDataPipeline,
  type IDatabaseDataService,
  type IDatabase,
  type IDatabaseView,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IRowGroup,
  type OpenEditorFn,
} from './databaseRegistry.js';

// ─── Public types ────────────────────────────────────────────────────────────

/** Slots the host renders into. Consumers supply the containers. */
export interface DatabaseViewHostSlots {
  /** Where the ViewTabBar is created. */
  readonly tabBar: HTMLElement;
  /** Where the DatabaseToolbar buttons are created. */
  readonly toolbar: HTMLElement;
  /** Where toolbar panels (filter, sort, group, properties) are appended. */
  readonly toolbarPanels: HTMLElement;
  /** Where the active view (table, board, etc.) is rendered. */
  readonly content: HTMLElement;
}

export interface DatabaseViewHostOptions {
  readonly databaseId: string;
  readonly dataService: IDatabaseDataService;
  readonly slots: DatabaseViewHostSlots;
  readonly openEditor?: OpenEditorFn;
  /** If provided, toolbar shows an "Open as full page" button (inline context). */
  readonly onOpenFullPage?: () => void;
}

/** Managed view shape — setRows/setProperties/dispose. */
interface IManagedView {
  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void;
  setProperties(properties: IDatabaseProperty[]): void;
  dispose(): void;
}

// ─── DatabaseViewHost ────────────────────────────────────────────────────────

export class DatabaseViewHost extends Disposable {
  private _disposed = false;

  // ── Configuration ──
  private readonly _databaseId: string;
  private readonly _dataService: IDatabaseDataService;
  private readonly _slots: DatabaseViewHostSlots;
  private readonly _openEditor: OpenEditorFn | undefined;
  private readonly _onOpenFullPage: (() => void) | undefined;

  // ── Sub-components ──
  private _viewTabBar: ViewTabBar | null = null;
  private _toolbar: DatabaseToolbar | null = null;
  private _activeView: IManagedView | null = null;
  private readonly _viewDisposables = this._register(new DisposableStore());
  private readonly _toolbarDisposables = this._register(new DisposableStore());

  // ── Data ──
  private _database: IDatabase | null = null;
  private _views: IDatabaseView[] = [];
  private _properties: IDatabaseProperty[] = [];
  private _rows: IDatabaseRow[] = [];
  private _activeViewId: string | null = null;
  private _sourceDbId: string | null = null;
  private _toolbarCollapsed = false;

  // ── Events ──
  private readonly _onDidLoad = this._register(new Emitter<IDatabase>());
  readonly onDidLoad: Event<IDatabase> = this._onDidLoad.event;

  private readonly _onDidFailLoad = this._register(new Emitter<string>());
  readonly onDidFailLoad: Event<string> = this._onDidFailLoad.event;

  private readonly _onDidChangeViews = this._register(new Emitter<number>());
  /** Fires with the current view count whenever views are loaded or reloaded. */
  readonly onDidChangeViews: Event<number> = this._onDidChangeViews.event;

  constructor(options: DatabaseViewHostOptions) {
    super();
    this._databaseId = options.databaseId;
    this._dataService = options.dataService;
    this._slots = options.slots;
    this._openEditor = options.openEditor;
    this._onOpenFullPage = options.onOpenFullPage;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /** Kick off async data load and initial render. */
  async load(): Promise<void> {
    try {
      this._database = await this._dataService.getDatabase(this._databaseId);
      if (!this._database || this._disposed) {
        this._onDidFailLoad.fire('Database not found.');
        return;
      }

      this._views = await this._dataService.getViews(this._databaseId);
      this._properties = await this._dataService.getProperties(this._databaseId);

      // For linked views, load rows from the source database
      const firstView = this._views[0];
      this._sourceDbId = firstView?.config?.sourceDatabaseId ?? this._databaseId;
      this._rows = await this._dataService.getRows(this._sourceDbId);
    } catch (err) {
      console.error('[DatabaseViewHost] Failed to load database:', err);
      this._onDidFailLoad.fire('Failed to load database.');
      return;
    }

    if (this._disposed) return;

    this._onDidLoad.fire(this._database!);

    // ── ViewTabBar ──
    this._viewTabBar = new ViewTabBar(
      this._slots.tabBar,
      this._dataService,
      this._databaseId,
    );
    this._register(this._viewTabBar);
    this._viewTabBar.setViews(this._views);

    this._register(this._viewTabBar.onDidSelectView(viewId => {
      this._switchView(viewId);
    }));

    this._register(this._viewTabBar.onDidCreateView(view => {
      this._views.push(view);
      this._viewTabBar!.setViews(this._views);
      this._switchView(view.id);
    }));

    // ── Toolbar ──
    this._createToolbar();

    // ── Data change listeners ──
    const sourceDbId = this._sourceDbId!;

    this._register(this._dataService.onDidChangeRow(event => {
      if (event.databaseId !== this._databaseId && event.databaseId !== sourceDbId) return;
      this._reloadRows();
    }));

    this._register(this._dataService.onDidChangeProperty(event => {
      if (event.databaseId !== this._databaseId) return;
      this._reloadProperties();
    }));

    this._register(this._dataService.onDidChangeView(event => {
      if (event.databaseId !== this._databaseId) return;
      this._reloadViews();
    }));

    // ── Notify view count ──
    this._onDidChangeViews.fire(this._views.length);

    // ── Activate first view ──
    if (this._views.length > 0) {
      this._switchView(this._views[0].id);
    }
  }

  /** Toggle toolbar collapsed state (inline context uses this). */
  setToolbarCollapsed(collapsed: boolean): void {
    this._toolbarCollapsed = collapsed;
    this._toolbar?.setCollapsed(collapsed);
  }

  /** Get the currently active view ID. */
  get activeViewId(): string | null {
    return this._activeViewId;
  }

  /** Get the database record (available after load completes). */
  get database(): IDatabase | null {
    return this._database;
  }

  // ─── View Switching ──────────────────────────────────────────────────

  private _switchView(viewId: string): void {
    this._activeViewId = viewId;
    this._viewTabBar?.setActive(viewId);
    this._updateToolbar();
    this._renderActiveView();
  }

  private _renderActiveView(): void {
    this._viewDisposables.clear();
    this._activeView = null;
    this._slots.content.innerHTML = '';

    const view = this._views.find(v => v.id === this._activeViewId);
    if (!view) return;

    // Determine source database for linked views
    const dbId = view.config?.sourceDatabaseId ?? this._databaseId;

    // Apply the data pipeline: filter → sort → group
    const { sortedRows, groups } = applyViewDataPipeline(
      this._rows,
      view,
      this._properties,
    );

    const visibleProps = this._getVisibleProperties(view);
    const viewInstance = this._createView(view.type, dbId, view, visibleProps, sortedRows, groups);

    if (viewInstance) {
      this._viewDisposables.add(viewInstance);
      this._activeView = viewInstance;
    }
  }

  private _createView(
    type: string,
    databaseId: string,
    view: IDatabaseView,
    properties: IDatabaseProperty[],
    rows: IDatabaseRow[],
    groups?: IRowGroup[],
  ): IManagedView | null {
    const container = this._slots.content;
    const openEditor = this._openEditor;

    switch (type) {
      case 'table':
        return new TableView(container, this._dataService, databaseId, view, properties, rows, openEditor, groups);
      case 'board':
        return new BoardView(container, this._dataService, databaseId, view, properties, rows, openEditor, groups);
      case 'list':
        return new ListView(container, this._dataService, databaseId, view, properties, rows, openEditor, groups);
      case 'gallery':
        return new GalleryView(container, this._dataService, databaseId, view, properties, rows, openEditor, groups);
      case 'calendar':
        return new CalendarView(container, this._dataService, databaseId, view, properties, rows, openEditor, groups);
      case 'timeline':
        return new TimelineView(container, this._dataService, databaseId, view, properties, rows, openEditor, groups);
      default: {
        const placeholder = $('div.db-view-placeholder');
        placeholder.textContent = `${type} view — coming soon`;
        container.appendChild(placeholder);
        return null;
      }
    }
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────

  private _createToolbar(): void {
    const view = this._views.find(v => v.id === this._activeViewId);
    if (!view) return;

    this._toolbarDisposables.clear();
    this._slots.toolbar.innerHTML = '';
    this._slots.toolbarPanels.innerHTML = '';

    this._toolbar = new DatabaseToolbar(
      this._slots.toolbar,
      view,
      this._properties,
      this._slots.toolbarPanels,
      this._onOpenFullPage,
    );
    this._toolbarDisposables.add(this._toolbar);
    this._toolbar.setCollapsed(this._toolbarCollapsed);

    this._toolbarDisposables.add(
      this._toolbar.onDidUpdateView(async updates => {
        if (!this._activeViewId) return;
        try {
          await this._dataService.updateView(this._activeViewId, updates);
          const updatedView = await this._dataService.getView(this._activeViewId);
          if (updatedView) {
            const idx = this._views.findIndex(v => v.id === updatedView.id);
            if (idx >= 0) this._views[idx] = updatedView;
            this._toolbar?.setView(updatedView);
          }
          this._renderActiveView();
        } catch (err) {
          console.error('[DatabaseViewHost] Update view failed:', err);
        }
      }),
    );

    this._toolbarDisposables.add(
      this._toolbar.onDidRequestNewRow(async () => {
        if (!this._database) return;
        try {
          await this._dataService.addRow(this._database.id);
        } catch (err) {
          console.error('[DatabaseViewHost] Add row failed:', err);
        }
      }),
    );
  }

  private _updateToolbar(): void {
    const view = this._views.find(v => v.id === this._activeViewId);
    if (view && this._toolbar) {
      this._toolbar.setView(view);
      this._toolbar.setProperties(this._properties);
    } else if (view) {
      this._createToolbar();
    }
  }

  // ─── Visible Properties ──────────────────────────────────────────────

  private _getVisibleProperties(view: IDatabaseView): IDatabaseProperty[] {
    const visibleIds = view.config.visibleProperties;
    if (!visibleIds || visibleIds.length === 0) return this._properties;

    const ordered: IDatabaseProperty[] = [];
    for (const id of visibleIds) {
      const prop = this._properties.find(p => p.id === id);
      if (prop) ordered.push(prop);
    }
    // Always include title even if not in list
    if (!ordered.some(p => p.type === 'title')) {
      const titleProp = this._properties.find(p => p.type === 'title');
      if (titleProp) ordered.unshift(titleProp);
    }
    return ordered;
  }

  // ─── Data Reload ─────────────────────────────────────────────────────

  private async _reloadRows(): Promise<void> {
    try {
      const dbId = this._sourceDbId ?? this._databaseId;
      this._rows = await this._dataService.getRows(dbId);
      const view = this._views.find(v => v.id === this._activeViewId);
      if (view) {
        const { sortedRows, groups } = applyViewDataPipeline(
          this._rows, view, this._properties,
        );
        this._activeView?.setRows(sortedRows, groups);
      }
    } catch (err) {
      console.error('[DatabaseViewHost] Failed to reload rows:', err);
    }
  }

  private async _reloadProperties(): Promise<void> {
    try {
      this._properties = await this._dataService.getProperties(this._databaseId);
      // Re-render since columns changed
      this._renderActiveView();
    } catch (err) {
      console.error('[DatabaseViewHost] Failed to reload properties:', err);
    }
  }

  private async _reloadViews(): Promise<void> {
    try {
      this._views = await this._dataService.getViews(this._databaseId);
      this._viewTabBar?.setViews(this._views);
      this._onDidChangeViews.fire(this._views.length);

      // If active view was deleted, switch to first
      if (!this._views.find(v => v.id === this._activeViewId) && this._views.length > 0) {
        this._switchView(this._views[0].id);
      }
    } catch (err) {
      console.error('[DatabaseViewHost] Failed to reload views:', err);
    }
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._viewDisposables.clear();
    this._toolbarDisposables.clear();
    this._activeView = null;
    this._viewTabBar = null;
    this._toolbar = null;

    super.dispose();
  }
}
