// databaseInlineNode.ts — Inline database block extension
//
// Tiptap atom node that embeds a database view inline within a canvas page.
// Renders a compact database view with a view tab bar for switching.
// Supports both owned databases and linked views (sourceDatabaseId).
//
// Gate: imports ONLY from blockRegistry (canvas gate architecture).

import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type {
  IDatabaseDataService,
  IDatabaseView,
  IDatabaseProperty,
  IDatabaseRow,
  IRowGroup,
} from '../config/blockRegistry.js';
import {
  svgIcon,
  TableView,
  BoardView,
  ListView,
  GalleryView,
  CalendarView,
  TimelineView,
  ViewTabBar,
  DatabaseToolbar,
  applyViewDataPipeline,
} from '../config/blockRegistry.js';

// ── Local types ─────────────────────────────────────────────────────────────

type OpenEditorFn = (options: {
  typeId: string;
  title: string;
  icon?: string;
  instanceId?: string;
}) => Promise<void>;

export interface DatabaseInlineOptions {
  readonly databaseDataService?: IDatabaseDataService;
  readonly openEditor?: OpenEditorFn;
}

// ── View interface (shared shape for setRows / setProperties) ───────────────

interface IManagedView {
  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void;
  setProperties(properties: IDatabaseProperty[]): void;
  dispose(): void;
}

// ── NodeView renderer ───────────────────────────────────────────────────────

class DatabaseInlineNodeView {
  readonly dom: HTMLElement;
  private _contentDom: HTMLElement | null = null;
  private _databaseId: string;
  private _activeViewId: string | null = null;
  private _views: IDatabaseView[] = [];
  private _properties: IDatabaseProperty[] = [];
  private _rows: IDatabaseRow[] = [];
  private _activeView: IManagedView | null = null;
  private _viewTabBar: ViewTabBar | null = null;
  private _toolbar: DatabaseToolbar | null = null;
  private _disposed = false;
  private readonly _disposables: Array<{ dispose(): void }> = [];

  constructor(
    _node: ProseMirrorNode,
    private readonly _dataService: IDatabaseDataService,
    private readonly _openEditor?: OpenEditorFn,
  ) {
    this._databaseId = _node.attrs.databaseId as string;

    // Build DOM structure
    this.dom = document.createElement('div');
    this.dom.classList.add('db-inline-wrapper');
    this.dom.setAttribute('data-database-id', this._databaseId);

    // Header bar (view tabs + expand button)
    const header = document.createElement('div');
    header.classList.add('db-inline-header');
    this.dom.appendChild(header);

    // Tab bar container
    const tabBarContainer = document.createElement('div');
    tabBarContainer.classList.add('db-inline-tab-bar');
    header.appendChild(tabBarContainer);

    // Open full-page button
    const expandBtn = document.createElement('button');
    expandBtn.classList.add('db-inline-expand-btn');
    expandBtn.title = 'Open as full page';
    expandBtn.innerHTML = svgIcon('expand');
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openFullPage();
    });
    header.appendChild(expandBtn);

    // Toolbar container
    const toolbarContainer = document.createElement('div');
    toolbarContainer.classList.add('db-inline-toolbar');
    this.dom.appendChild(toolbarContainer);

    // Content area
    this._contentDom = document.createElement('div');
    this._contentDom.classList.add('db-inline-content');
    this.dom.appendChild(this._contentDom);

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.classList.add('db-inline-resize-handle');
    this.dom.appendChild(resizeHandle);
    this._setupResize(resizeHandle);

    // Load data
    this._loadDatabase(tabBarContainer, toolbarContainer);
  }

  /** Prevent ProseMirror from handling events inside the NodeView. */
  stopEvent(): boolean {
    return true;
  }

  /** This is an atom node — no content DOM. */
  get contentDOM(): null {
    return null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== 'databaseInline') return false;
    const newDbId = node.attrs.databaseId as string;
    if (newDbId !== this._databaseId) {
      this._databaseId = newDbId;
      this._reloadAll();
    }
    return true;
  }

  destroy(): void {
    this._disposed = true;
    this._activeView?.dispose();
    this._activeView = null;
    this._viewTabBar?.dispose();
    this._viewTabBar = null;
    this._toolbar?.dispose();
    this._toolbar = null;
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
  }

  // ── Data Loading ────────────────────────────────────────────────────

  private async _loadDatabase(
    tabBarContainer: HTMLElement,
    toolbarContainer: HTMLElement,
  ): Promise<void> {
    try {
      const db = await this._dataService.getDatabase(this._databaseId);
      if (!db || this._disposed) return;

      this._views = await this._dataService.getViews(this._databaseId);
      this._properties = await this._dataService.getProperties(this._databaseId);

      // For linked views, load rows from the source database
      const firstView = this._views[0];
      const sourceDbId = firstView?.config?.sourceDatabaseId ?? this._databaseId;
      this._rows = await this._dataService.getRows(sourceDbId);

      // Create view tab bar
      this._viewTabBar = new ViewTabBar(
        tabBarContainer,
        this._dataService,
        this._databaseId,
      );
      this._viewTabBar.setViews(this._views);

      this._disposables.push(
        this._viewTabBar.onDidSelectView((viewId) => {
          this._switchView(viewId, toolbarContainer);
        }),
      );

      this._disposables.push(
        this._viewTabBar.onDidCreateView((newView) => {
          this._views.push(newView);
          this._viewTabBar?.setViews(this._views);
          this._switchView(newView.id, toolbarContainer);
        }),
      );

      // Listen for data changes
      this._disposables.push(
        this._dataService.onDidChangeRow((event) => {
          if (event.databaseId !== this._databaseId && event.databaseId !== sourceDbId) return;
          this._reloadRows(sourceDbId);
        }),
      );

      this._disposables.push(
        this._dataService.onDidChangeProperty((event) => {
          if (event.databaseId !== this._databaseId) return;
          this._reloadProperties();
        }),
      );

      this._disposables.push(
        this._dataService.onDidChangeView((event) => {
          if (event.databaseId !== this._databaseId) return;
          this._reloadViews(toolbarContainer);
        }),
      );

      // Activate first view
      if (this._views.length > 0) {
        this._switchView(this._views[0].id, toolbarContainer);
      }
    } catch (err) {
      console.error('[DatabaseInlineNode] Failed to load database:', err);
      if (this._contentDom) {
        this._contentDom.textContent = 'Failed to load database.';
        this._contentDom.classList.add('db-inline-error');
      }
    }
  }

  // ── View Switching ──────────────────────────────────────────────────

  private _switchView(viewId: string, toolbarContainer: HTMLElement): void {
    this._activeViewId = viewId;
    this._viewTabBar?.setActive(viewId);
    this._updateToolbar(toolbarContainer);
    this._renderActiveView();
  }

  private _renderActiveView(): void {
    // Dispose previous
    this._activeView?.dispose();
    this._activeView = null;

    if (this._contentDom) {
      this._contentDom.innerHTML = '';
    }

    const view = this._views.find(v => v.id === this._activeViewId);
    if (!view || !this._contentDom) return;

    // Determine source database for linked views
    const sourceDbId = view.config?.sourceDatabaseId ?? this._databaseId;

    // Apply data pipeline
    const { sortedRows, groups } = applyViewDataPipeline(
      this._rows,
      view,
      this._properties,
    );

    const visibleProps = this._getVisibleProperties(view);

    const viewInstance = this._createView(
      view.type,
      this._contentDom,
      sourceDbId,
      view,
      visibleProps,
      sortedRows,
      groups,
    );

    if (viewInstance) {
      this._activeView = viewInstance;
    }
  }

  private _createView(
    type: string,
    container: HTMLElement,
    databaseId: string,
    view: IDatabaseView,
    properties: IDatabaseProperty[],
    rows: IDatabaseRow[],
    groups?: IRowGroup[],
  ): IManagedView | null {
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
      default:
        container.textContent = `${type} view — coming soon`;
        return null;
    }
  }

  // ── Toolbar ─────────────────────────────────────────────────────────

  private _updateToolbar(toolbarContainer: HTMLElement): void {
    this._toolbar?.dispose();
    this._toolbar = null;

    const view = this._views.find(v => v.id === this._activeViewId);
    if (!view) return;

    toolbarContainer.innerHTML = '';
    this._toolbar = new DatabaseToolbar(toolbarContainer, view, this._properties);

    this._disposables.push(
      this._toolbar.onDidUpdateView(async (updates) => {
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
          console.error('[DatabaseInlineNode] Update view failed:', err);
        }
      }),
    );
  }

  // ── Visible Properties ──────────────────────────────────────────────

  private _getVisibleProperties(view: IDatabaseView): IDatabaseProperty[] {
    const visibleIds = view.config.visibleProperties;
    if (!visibleIds || visibleIds.length === 0) return this._properties;

    const ordered: IDatabaseProperty[] = [];
    for (const id of visibleIds) {
      const prop = this._properties.find(p => p.id === id);
      if (prop) ordered.push(prop);
    }
    // Always include title
    if (!ordered.some(p => p.type === 'title')) {
      const titleProp = this._properties.find(p => p.type === 'title');
      if (titleProp) ordered.unshift(titleProp);
    }
    return ordered;
  }

  // ── Data Reload ─────────────────────────────────────────────────────

  private async _reloadRows(sourceDbId?: string): Promise<void> {
    try {
      const dbId = sourceDbId ?? this._databaseId;
      this._rows = await this._dataService.getRows(dbId);
      const view = this._views.find(v => v.id === this._activeViewId);
      if (view) {
        const { sortedRows, groups } = applyViewDataPipeline(
          this._rows, view, this._properties,
        );
        this._activeView?.setRows(sortedRows, groups);
      }
    } catch (err) {
      console.error('[DatabaseInlineNode] Failed to reload rows:', err);
    }
  }

  private async _reloadProperties(): Promise<void> {
    try {
      this._properties = await this._dataService.getProperties(this._databaseId);
      this._activeView?.setProperties(this._properties);
    } catch (err) {
      console.error('[DatabaseInlineNode] Failed to reload properties:', err);
    }
  }

  private async _reloadViews(toolbarContainer?: HTMLElement): Promise<void> {
    try {
      this._views = await this._dataService.getViews(this._databaseId);
      this._viewTabBar?.setViews(this._views);
      if (this._activeViewId && toolbarContainer) {
        this._switchView(this._activeViewId, toolbarContainer);
      }
    } catch (err) {
      console.error('[DatabaseInlineNode] Failed to reload views:', err);
    }
  }

  private async _reloadAll(): Promise<void> {
    const tabBarContainer = this.dom.querySelector('.db-inline-tab-bar') as HTMLElement;
    const toolbarContainer = this.dom.querySelector('.db-inline-toolbar') as HTMLElement;
    if (tabBarContainer && toolbarContainer) {
      tabBarContainer.innerHTML = '';
      toolbarContainer.innerHTML = '';
      this._viewTabBar?.dispose();
      this._viewTabBar = null;
      this._toolbar?.dispose();
      this._toolbar = null;
      this._activeView?.dispose();
      this._activeView = null;
      await this._loadDatabase(tabBarContainer, toolbarContainer);
    }
  }

  // ── Resize ──────────────────────────────────────────────────────────

  private _setupResize(handle: HTMLElement): void {
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startY;
      const newHeight = Math.max(120, startHeight + delta);
      this.dom.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.dom.classList.remove('db-inline-resizing');
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY;
      startHeight = this.dom.offsetHeight;
      this.dom.classList.add('db-inline-resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── Full Page ───────────────────────────────────────────────────────

  private _openFullPage(): void {
    if (!this._openEditor) return;
    this._openEditor({
      typeId: 'database',
      title: 'Database',
      instanceId: this._databaseId,
    }).catch(err => {
      console.error('[DatabaseInlineNode] Failed to open full page:', err);
    });
  }
}

// ── Tiptap Extension ────────────────────────────────────────────────────────

export const DatabaseInline = Node.create<DatabaseInlineOptions>({
  name: 'databaseInline',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return {
      databaseDataService: undefined,
      openEditor: undefined,
    };
  },

  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (attrs) => ({ 'data-database-id': attrs.databaseId }),
      },
      viewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-view-id'),
        renderHTML: (attrs) => attrs.viewId ? { 'data-view-id': attrs.viewId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-database-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'db-inline-wrapper' })];
  },

  addNodeView() {
    return ({ node }) => {
      const dataService = this.options.databaseDataService;
      if (!dataService) {
        const dom = document.createElement('div');
        dom.classList.add('db-inline-wrapper', 'db-inline-error');
        dom.textContent = 'Inline database: no data service available.';
        return { dom };
      }
      return new DatabaseInlineNodeView(node, dataService, this.options.openEditor);
    };
  },
});
