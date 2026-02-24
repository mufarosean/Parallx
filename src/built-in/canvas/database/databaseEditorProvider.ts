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
import type {
  IDatabaseDataService,
  IDatabase,
  IDatabaseView,
  IDatabaseProperty,
  IDatabaseRow,
} from './databaseTypes.js';
import { $ } from '../../../ui/dom.js';
import { ViewTabBar } from './views/viewTabBar.js';
import { TableView } from './views/tableView.js';

import './database.css';

// ─── Types ───────────────────────────────────────────────────────────────────

export type OpenEditorFn = (options: {
  typeId: string;
  title: string;
  icon?: string;
  instanceId?: string;
}) => Promise<void>;

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
  private _contentContainer: HTMLElement | null = null;
  private _emptyState: HTMLElement | null = null;

  // ── Sub-components ──
  private _viewTabBar: ViewTabBar | null = null;
  private _activeView: TableView | null = null;
  private readonly _viewDisposables = this._register(new DisposableStore());

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

    switch (view.type) {
      case 'table': {
        const tableView = new TableView(
          this._contentContainer,
          this._dataService,
          this._databaseId,
          view,
          this._properties,
          this._rows,
          this._openEditor,
        );
        this._viewDisposables.add(tableView);
        this._activeView = tableView;
        break;
      }
      // Board, List, Gallery, Calendar, Timeline — future phases
      default: {
        const placeholder = $('div.database-view-placeholder');
        placeholder.textContent = `${view.type} view — coming soon`;
        this._contentContainer.appendChild(placeholder);
        break;
      }
    }
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
    this._activeView = null;
    this._viewTabBar = null;

    if (this._wrapper) {
      this._wrapper.remove();
      this._wrapper = null;
    }

    super.dispose();
  }
}
