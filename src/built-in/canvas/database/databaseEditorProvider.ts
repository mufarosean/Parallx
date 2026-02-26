// databaseEditorProvider.ts — Database editor pane with view system
//
// Provides the editor provider registered via
// `api.editors.registerEditorProvider('database', ...)`.
// Each editor pane loads a database's schema and renders a view tab bar
// for switching between views (Table, Board, etc.) and the active view.
//
// Pattern: follows CanvasEditorProvider exactly:
//   - Provider is created in main.ts, receives DatabaseDataService
//   - createEditorPane() creates a DatabaseEditorPane per editor tab
//   - Pane lifecycle: load database → render view tab bar → render active view
//
// Dependencies: platform/ (lifecycle), editor/ (editorInput — type-only),
// ui/ (dom), databaseTypes (type-only), views/viewTabBar, views/tableView

import { Disposable, DisposableStore, type IDisposable } from '../../../platform/lifecycle.js';
import type { IEditorInput } from '../../../editor/editorInput.js';
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
} from './databaseRegistry.js';

import './database.css';

import type { OpenEditorFn } from './databaseRegistry.js';

// ─── Database Editor Provider ────────────────────────────────────────────────

export class DatabaseEditorProvider {
  private _openEditor: OpenEditorFn | undefined;

  constructor(private readonly _dataService: IDatabaseDataService) {}

  /**
   * Set the openEditor callback so panes can navigate to row pages.
   */
  setOpenEditor(fn: OpenEditorFn): void {
    this._openEditor = fn;
  }

  /**
   * Create an editor pane for a database.
   *
   * @param container — DOM element to render into
   * @param input — the ToolEditorInput (input.id === databaseId)
   */
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable {
    const databaseId = input?.id ?? '';
    const pane = new DatabaseEditorPane(
      container,
      databaseId,
      this._dataService,
      this._openEditor,
    );
    pane.init().catch(err => {
      console.error('[DatabaseEditorProvider] Pane init failed:', err);
    });
    return pane;
  }
}

// ─── Database Editor Pane ────────────────────────────────────────────────────

class DatabaseEditorPane extends Disposable {
  private _disposed = false;

  // ── Layout elements ──
  private _wrapper: HTMLElement | null = null;
  private _toolbarContainer: HTMLElement | null = null;
  private _toolbarButtonsContainer: HTMLElement | null = null;
  private _contentContainer: HTMLElement | null = null;
  private _emptyState: HTMLElement | null = null;

  // ── Sub-components ──
  private _viewTabBar: ViewTabBar | null = null;
  private _toolbar: DatabaseToolbar | null = null;
  private _activeView: TableView | BoardView | ListView | GalleryView | CalendarView | TimelineView | null = null;
  private readonly _viewDisposables = this._register(new DisposableStore());
  private readonly _toolbarDisposables = this._register(new DisposableStore());

  // ── Data ──
  private _database: IDatabase | null = null;
  private _views: IDatabaseView[] = [];
  private _properties: IDatabaseProperty[] = [];
  private _rows: IDatabaseRow[] = [];
  private _activeViewId: string | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _databaseId: string,
    private readonly _dataService: IDatabaseDataService,
    private readonly _openEditor: OpenEditorFn | undefined,
  ) {
    super();
  }

  // ─── Initialization ──────────────────────────────────────────────────

  async init(): Promise<void> {
    // Build layout skeleton
    this._wrapper = $('div.database-editor');
    this._container.appendChild(this._wrapper);

    this._toolbarContainer = $('div.database-editor-toolbar');
    this._wrapper.appendChild(this._toolbarContainer);

    // Toolbar buttons (filter/sort/group/properties) go between tabs and content
    this._toolbarButtonsContainer = $('div.database-editor-toolbar-buttons');
    this._wrapper.appendChild(this._toolbarButtonsContainer);

    this._contentContainer = $('div.database-editor-content');
    this._wrapper.appendChild(this._contentContainer);

    // Load database data
    try {
      this._database = await this._dataService.getDatabase(this._databaseId);
      if (!this._database) {
        this._showEmptyState('Database not found.');
        return;
      }

      this._views = await this._dataService.getViews(this._databaseId);
      this._properties = await this._dataService.getProperties(this._databaseId);
      this._rows = await this._dataService.getRows(this._databaseId);
    } catch (err) {
      console.error('[DatabaseEditorPane] Failed to load database:', err);
      this._showEmptyState('Failed to load database.');
      return;
    }

    // Bail if disposed during async load
    if (this._disposed) return;

    // Create view tab bar
    this._viewTabBar = new ViewTabBar(
      this._toolbarContainer!,
      this._dataService,
      this._databaseId,
    );
    this._register(this._viewTabBar);
    this._viewTabBar.setViews(this._views);

    // Listen for view selection
    this._register(this._viewTabBar.onDidSelectView(viewId => {
      this._switchView(viewId);
    }));

    // Create toolbar (filter/sort/group/properties buttons)
    this._createToolbar();

    // Listen for view creation (from tab bar "+" menu)
    this._register(this._viewTabBar.onDidCreateView(view => {
      this._views.push(view);
      this._viewTabBar!.setViews(this._views);
      this._switchView(view.id);
    }));

    // Listen for data changes from other sources
    this._register(this._dataService.onDidChangeRow(event => {
      if (event.databaseId !== this._databaseId) return;
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

    // Activate first view
    if (this._views.length > 0) {
      this._switchView(this._views[0].id);
    } else {
      this._showEmptyState('No views configured.');
    }
  }

  // ─── View Switching ──────────────────────────────────────────────────

  private _switchView(viewId: string): void {
    this._activeViewId = viewId;
    this._viewTabBar?.setActive(viewId);
    this._updateToolbar();
    this._renderActiveView();
  }

  private _renderActiveView(): void {
    // Dispose previous view
    this._viewDisposables.clear();
    this._activeView = null;

    if (this._contentContainer) {
      this._contentContainer.innerHTML = '';
    }

    if (this._emptyState) {
      this._emptyState.remove();
      this._emptyState = null;
    }

    const view = this._views.find(v => v.id === this._activeViewId);
    if (!view || !this._contentContainer) return;

    // Apply the data pipeline: filter → sort → group
    const { sortedRows, groups } = applyViewDataPipeline(
      this._rows,
      view,
      this._properties,
    );

    // Determine visible properties for this view
    const visibleProps = this._getVisibleProperties(view);

    switch (view.type) {
      case 'table': {
        const tableView = new TableView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          visibleProps,
          sortedRows,
          this._openEditor,
          groups,
        );
        this._viewDisposables.add(tableView);
        this._activeView = tableView;
        break;
      }
      case 'board': {
        const boardView = new BoardView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          visibleProps,
          sortedRows,
          this._openEditor,
          groups,
        );
        this._viewDisposables.add(boardView);
        this._activeView = boardView;
        break;
      }
      case 'list': {
        const listView = new ListView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          visibleProps,
          sortedRows,
          this._openEditor,
          groups,
        );
        this._viewDisposables.add(listView);
        this._activeView = listView;
        break;
      }
      case 'gallery': {
        const galleryView = new GalleryView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          visibleProps,
          sortedRows,
          this._openEditor,
          groups,
        );
        this._viewDisposables.add(galleryView);
        this._activeView = galleryView;
        break;
      }
      case 'calendar': {
        const calendarView = new CalendarView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          visibleProps,
          sortedRows,
          this._openEditor,
          groups,
        );
        this._viewDisposables.add(calendarView);
        this._activeView = calendarView;
        break;
      }
      case 'timeline': {
        const timelineView = new TimelineView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          visibleProps,
          sortedRows,
          this._openEditor,
          groups,
        );
        this._viewDisposables.add(timelineView);
        this._activeView = timelineView;
        break;
      }
      default: {
        const placeholder = $('div.database-view-placeholder');
        placeholder.textContent = `${view.type} view — coming soon`;
        this._contentContainer.appendChild(placeholder);
        break;
      }
    }
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────

  private _createToolbar(): void {
    const view = this._views.find(v => v.id === this._activeViewId);
    if (!view || !this._toolbarButtonsContainer) return;

    this._toolbarDisposables.clear();

    this._toolbar = new DatabaseToolbar(
      this._toolbarButtonsContainer,
      view,
      this._properties,
    );
    this._toolbarDisposables.add(this._toolbar);

    this._toolbar.onDidUpdateView(async updates => {
      if (!this._activeViewId) return;
      try {
        await this._dataService.updateView(this._activeViewId, updates);
        // Reload the view to pick up stored changes
        const updatedView = await this._dataService.getView(this._activeViewId);
        if (updatedView) {
          const idx = this._views.findIndex(v => v.id === updatedView.id);
          if (idx >= 0) this._views[idx] = updatedView;
          this._toolbar?.setView(updatedView);
        }
        this._renderActiveView();
      } catch (err) {
        console.error('[DatabaseEditorPane] Update view failed:', err);
      }
    });
  }

  private _updateToolbar(): void {
    const view = this._views.find(v => v.id === this._activeViewId);
    if (view && this._toolbar) {
      this._toolbar.setView(view);
      this._toolbar.setProperties(this._properties);
    } else if (view && this._toolbarButtonsContainer) {
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
      this._rows = await this._dataService.getRows(this._databaseId);
      this._activeView?.setRows(this._rows);
    } catch (err) {
      console.error('[DatabaseEditorPane] Failed to reload rows:', err);
    }
  }

  private async _reloadProperties(): Promise<void> {
    try {
      this._properties = await this._dataService.getProperties(this._databaseId);
      // Re-render since columns changed
      this._renderActiveView();
    } catch (err) {
      console.error('[DatabaseEditorPane] Failed to reload properties:', err);
    }
  }

  private async _reloadViews(): Promise<void> {
    try {
      this._views = await this._dataService.getViews(this._databaseId);
      this._viewTabBar?.setViews(this._views);

      // If active view was deleted, switch to first
      if (!this._views.find(v => v.id === this._activeViewId) && this._views.length > 0) {
        this._switchView(this._views[0].id);
      }
    } catch (err) {
      console.error('[DatabaseEditorPane] Failed to reload views:', err);
    }
  }

  // ─── Empty State ─────────────────────────────────────────────────────

  private _showEmptyState(message: string): void {
    if (this._emptyState) {
      this._emptyState.textContent = message;
      return;
    }
    this._emptyState = $('div.database-empty-state');
    this._emptyState.textContent = message;
    (this._contentContainer ?? this._wrapper ?? this._container).appendChild(this._emptyState);
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

    if (this._wrapper) {
      this._wrapper.remove();
      this._wrapper = null;
    }

    super.dispose();
  }
}
