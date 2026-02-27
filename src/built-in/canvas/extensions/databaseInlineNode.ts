// databaseInlineNode.ts — Inline database block extension
//
// Tiptap atom node that embeds a database view inline within a canvas page.
// Renders an inline chrome (title, collapse/expand, resize, open-as-page)
// and delegates all view engine work to DatabaseViewHost — the shared
// component used by both inline and full-page contexts.
//
// Title linking: the inline title is bidirectionally synced with
// `pages.title` via `IInlineDatabasePageAccess`. Full-page & inline
// always display the same title because they share the same page record.
//
// UI unification: the controls row (tab bar + toolbar) and content slots
// use the same CSS class names as the full-page database editor so both
// render identically. Only the inline wrapper and header are unique.
//
// Gate: imports ONLY from blockRegistry (canvas gate architecture).

import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type {
  IDatabaseDataService,
} from '../config/blockRegistry.js';
import {
  svgIcon,
  DatabaseViewHost,
} from '../config/blockRegistry.js';

// ── Local types ─────────────────────────────────────────────────────────────

type OpenEditorFn = (options: {
  typeId: string;
  title: string;
  icon?: string;
  instanceId?: string;
}) => Promise<void>;

/** Narrow page shape — only the fields this block reads. */
export interface IInlineDatabasePage {
  readonly id: string;
  readonly title: string;
}

/** Narrow change-event shape. */
export interface IInlineDatabasePageChangeEvent {
  readonly pageId: string;
  readonly page?: IInlineDatabasePage;
}

/**
 * Narrow interface for page data access. Follows the structural-typing
 * pattern used by databaseFullPageNode.ts — define only what the inline
 * node needs instead of importing the full ICanvasDataService.
 */
export interface IInlineDatabasePageAccess {
  getPage(pageId: string): Promise<IInlineDatabasePage | null>;
  updatePage(pageId: string, updates: { title?: string }): Promise<IInlineDatabasePage>;
  readonly onDidChangePage: (listener: (e: IInlineDatabasePageChangeEvent) => void) => { dispose(): void };
}

export interface DatabaseInlineOptions {
  readonly databaseDataService?: IDatabaseDataService;
  readonly pageDataService?: IInlineDatabasePageAccess;
  readonly openEditor?: OpenEditorFn;
}

// ── NodeView renderer ───────────────────────────────────────────────────────

class DatabaseInlineNodeView {
  readonly dom: HTMLElement;
  private _databaseId: string;
  private _databaseTitle: string;
  private _host: DatabaseViewHost | null = null;
  private _toolbarCollapsed = false;
  private _pageChangeDisposable: { dispose(): void } | null = null;
  private _titleEl: HTMLElement | null = null;

  constructor(
    node: ProseMirrorNode,
    private readonly _dbDataService: IDatabaseDataService,
    private readonly _pageDataService: IInlineDatabasePageAccess | undefined,
    private readonly _updateNodeAttrs?: (attrs: Record<string, unknown>) => void,
    private readonly _openEditor?: OpenEditorFn,
  ) {
    this._databaseId = node.attrs.databaseId as string;
    this._databaseTitle = (node.attrs.databaseTitle as string | undefined) ?? 'Untitled';

    // Build DOM structure — unified layout matching full-page database
    this.dom = document.createElement('div');
    this.dom.classList.add('db-host', 'db-host--inline');
    this.dom.setAttribute('data-database-id', this._databaseId);

    // ── Header row: title + action buttons ──
    const header = document.createElement('div');
    header.classList.add('db-host-inline-header');
    this.dom.appendChild(header);

    // Database title — linked to pages.title
    const titleEl = document.createElement('span');
    titleEl.classList.add('db-host-inline-title');
    titleEl.textContent = this._databaseTitle;
    titleEl.contentEditable = 'true';
    titleEl.spellcheck = false;
    this._titleEl = titleEl;
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      }
    });
    titleEl.addEventListener('blur', () => {
      const nextTitle = (titleEl.textContent ?? '').trim() || 'Untitled';
      titleEl.textContent = nextTitle;
      if (nextTitle === this._databaseTitle) return;
      this._databaseTitle = nextTitle;
      // Write to ProseMirror attr (serialization)
      this._updateNodeAttrs?.({ databaseTitle: nextTitle });
      // Write to pages.title (source of truth)
      this._pageDataService?.updatePage(this._databaseId, { title: nextTitle }).catch(err => {
        console.error('[DatabaseInlineNode] Title save failed:', err);
      });
    });
    header.appendChild(titleEl);

    // Tab bar slot (hidden in inline via CSS, but host still needs it)
    const tabBarSlot = document.createElement('div');
    tabBarSlot.classList.add('db-host-tabbar');
    header.appendChild(tabBarSlot);

    // Header actions area (collapse/expand) — left of toolbar icons
    const headerActions = document.createElement('div');
    headerActions.classList.add('db-host-inline-actions');
    header.appendChild(headerActions);

    // Open full-page button (created first so toggle handler can reference it)
    const expandBtn = document.createElement('button');
    expandBtn.classList.add('db-host-inline-expand-btn');
    expandBtn.title = 'Open as full page';
    expandBtn.innerHTML = svgIcon('open');
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openFullPage();
    });

    // Collapse/expand toolbar toggle (settings icon — always visible)
    const toolbarToggleBtn = document.createElement('button');
    toolbarToggleBtn.classList.add('db-host-inline-action-btn', 'db-host-inline-toolbar-toggle');
    toolbarToggleBtn.title = 'Hide toolbar actions';
    toolbarToggleBtn.innerHTML = svgIcon('db-expand');
    toolbarToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toolbarCollapsed = !this._toolbarCollapsed;
      toolbarToggleBtn.classList.toggle('db-host-inline-toolbar-toggle--collapsed', this._toolbarCollapsed);
      toolbarToggleBtn.title = this._toolbarCollapsed ? 'Show toolbar actions' : 'Hide toolbar actions';
      toolbarToggleBtn.innerHTML = this._toolbarCollapsed ? svgIcon('db-collapse') : svgIcon('db-expand');
      this._host?.setToolbarCollapsed(this._toolbarCollapsed);
      expandBtn.style.display = this._toolbarCollapsed ? 'none' : '';
    });
    headerActions.appendChild(toolbarToggleBtn);
    headerActions.appendChild(expandBtn);

    // Toolbar slot — sits on the same line as the title, far right
    const toolbarSlot = document.createElement('div');
    toolbarSlot.classList.add('db-host-toolbar');
    header.appendChild(toolbarSlot);

    // ── Toolbar panels (below controls row) ──
    const toolbarPanelsSlot = document.createElement('div');
    toolbarPanelsSlot.classList.add('db-host-toolbar-panels');
    this.dom.appendChild(toolbarPanelsSlot);

    // ── Content area ──
    const contentSlot = document.createElement('div');
    contentSlot.classList.add('db-host-inline-content');
    this.dom.appendChild(contentSlot);

    // ── Resize handle ──
    const resizeHandle = document.createElement('div');
    resizeHandle.classList.add('db-host-inline-resize-handle');
    this.dom.appendChild(resizeHandle);
    this._setupResize(resizeHandle);

    // ── Shared view host (same engine as full-page) ──
    this._host = new DatabaseViewHost({
      databaseId: this._databaseId,
      dataService: this._dbDataService,
      openEditor: this._openEditor,
      slots: {
        tabBar: tabBarSlot,
        toolbar: toolbarSlot,
        toolbarPanels: toolbarPanelsSlot,
        content: contentSlot,
      },
    });

    this._host.onDidFailLoad((message) => {
      contentSlot.textContent = message;
      contentSlot.classList.add('db-host-inline-error');
    });

    this._host.load().catch(err => {
      console.error('[DatabaseInlineNode] Host load failed:', err);
    });

    // ── Title sync: load from pages.title then listen for changes ──
    this._initTitleSync();
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
      this._reloadHost();
      this._initTitleSync();
    }
    // Ignore attr-level title changes — pages.title is the source of truth.
    // The node attr is kept in sync by this NodeView; external ProseMirror
    // updates (e.g. undo) will re-read from the page on next load.
    return true;
  }

  destroy(): void {
    this._pageChangeDisposable?.dispose();
    this._pageChangeDisposable = null;
    this._host?.dispose();
    this._host = null;
    this._titleEl = null;
  }

  // ── Title Sync ──────────────────────────────────────────────────────

  /**
   * Load pages.title to set the initial inline title, then listen for
   * external page-level title changes (e.g. from the full-page editor)
   * and keep the inline DOM + ProseMirror attr in sync.
   */
  private _initTitleSync(): void {
    // Clean up any previous listener
    this._pageChangeDisposable?.dispose();
    this._pageChangeDisposable = null;

    if (!this._pageDataService) return;

    // Fetch the canonical title from pages.title
    this._pageDataService.getPage(this._databaseId).then(page => {
      if (!page) return;
      const canonical = page.title || 'Untitled';
      if (canonical !== this._databaseTitle) {
        this._databaseTitle = canonical;
        if (this._titleEl && document.activeElement !== this._titleEl) {
          this._titleEl.textContent = canonical;
        }
        // Keep ProseMirror attr in sync with canonical title
        this._updateNodeAttrs?.({ databaseTitle: canonical });
      }
    }).catch(err => {
      console.error('[DatabaseInlineNode] Title fetch failed:', err);
    });

    // Listen for external page changes
    this._pageChangeDisposable = this._pageDataService.onDidChangePage(event => {
      if (event.pageId !== this._databaseId || !event.page) return;
      const canonical = event.page.title || 'Untitled';
      if (canonical === this._databaseTitle) return;
      this._databaseTitle = canonical;
      // Update DOM (only if not currently being edited by the user)
      if (this._titleEl && document.activeElement !== this._titleEl) {
        this._titleEl.textContent = canonical;
      }
      // Keep ProseMirror attr in sync
      this._updateNodeAttrs?.({ databaseTitle: canonical });
    });
  }

  // ── Host Reload (on databaseId change) ───────────────────────────────

  private _reloadHost(): void {
    this._host?.dispose();
    this._host = null;

    const tabBarSlot = this.dom.querySelector('.db-host-tabbar') as HTMLElement;
    const toolbarSlot = this.dom.querySelector('.db-host-toolbar') as HTMLElement;
    const toolbarPanelsSlot = this.dom.querySelector('.db-host-toolbar-panels') as HTMLElement;
    const contentSlot = this.dom.querySelector('.db-host-inline-content') as HTMLElement;

    if (!tabBarSlot || !toolbarSlot || !toolbarPanelsSlot || !contentSlot) return;

    // Clear previous content in all slots
    tabBarSlot.innerHTML = '';
    toolbarSlot.innerHTML = '';
    toolbarPanelsSlot.innerHTML = '';
    contentSlot.innerHTML = '';
    contentSlot.classList.remove('db-host-inline-error');

    this._host = new DatabaseViewHost({
      databaseId: this._databaseId,
      dataService: this._dbDataService,
      openEditor: this._openEditor,
      slots: {
        tabBar: tabBarSlot,
        toolbar: toolbarSlot,
        toolbarPanels: toolbarPanelsSlot,
        content: contentSlot,
      },
    });

    this._host.load().catch(err => {
      console.error('[DatabaseInlineNode] Host reload failed:', err);
    });
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
      this.dom.classList.remove('db-host-resizing');
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY;
      startHeight = this.dom.offsetHeight;
      this.dom.classList.add('db-host-resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── Full Page ───────────────────────────────────────────────────────

  private _openFullPage(): void {
    if (!this._openEditor) return;
    this._openEditor({
      typeId: 'database',
      title: this._databaseTitle,
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
      pageDataService: undefined,
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
      databaseTitle: {
        default: 'Untitled',
        parseHTML: (el) => el.getAttribute('data-database-title') ?? 'Untitled',
        renderHTML: (attrs) => ({ 'data-database-title': attrs.databaseTitle ?? 'Untitled' }),
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
    return ['div', mergeAttributes(HTMLAttributes, { class: 'db-host db-host--inline' })];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dataService = this.options.databaseDataService;
      if (!dataService) {
        const dom = document.createElement('div');
        dom.classList.add('db-host', 'db-host--inline', 'db-host-inline-error');
        dom.textContent = 'Inline database: no data service available.';
        return { dom };
      }
      const updateNodeAttrs = (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (typeof pos !== 'number') return;

        const currentNode = editor.state.doc.nodeAt(pos);
        if (!currentNode) return;

        const nextAttrs = { ...currentNode.attrs, ...attrs };
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, nextAttrs);
        editor.view.dispatch(tr);
      };

      return new DatabaseInlineNodeView(
        node,
        dataService,
        this.options.pageDataService,
        updateNodeAttrs,
        this.options.openEditor,
      );
    };
  },
});
