// databaseInlineNode.ts — Inline database block extension
//
// Tiptap atom node that embeds a database view inline within a canvas page.
// Renders an inline chrome (title, collapse/expand, resize, open-as-page)
// and delegates all view engine work to DatabaseViewHost — the shared
// component used by both inline and full-page contexts.
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

export interface DatabaseInlineOptions {
  readonly databaseDataService?: IDatabaseDataService;
  readonly openEditor?: OpenEditorFn;
}

// ── NodeView renderer ───────────────────────────────────────────────────────

class DatabaseInlineNodeView {
  readonly dom: HTMLElement;
  private _databaseId: string;
  private _databaseTitle: string;
  private _host: DatabaseViewHost | null = null;
  private _toolbarCollapsed = false;

  constructor(
    node: ProseMirrorNode,
    private readonly _dataService: IDatabaseDataService,
    private readonly _updateNodeAttrs?: (attrs: Record<string, unknown>) => void,
    private readonly _openEditor?: OpenEditorFn,
  ) {
    this._databaseId = node.attrs.databaseId as string;
    this._databaseTitle = (node.attrs.databaseTitle as string | undefined) ?? 'New database';

    // Build DOM structure
    this.dom = document.createElement('div');
    this.dom.classList.add('db-inline-wrapper');
    this.dom.setAttribute('data-database-id', this._databaseId);

    // Header bar (title + toolbar + view tabs + actions)
    const header = document.createElement('div');
    header.classList.add('db-inline-header');
    this.dom.appendChild(header);

    // Database title
    const titleEl = document.createElement('span');
    titleEl.classList.add('db-inline-title');
    titleEl.textContent = this._databaseTitle;
    titleEl.contentEditable = 'true';
    titleEl.spellcheck = false;
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      }
    });
    titleEl.addEventListener('blur', () => {
      const nextTitle = (titleEl.textContent ?? '').trim() || 'New database';
      titleEl.textContent = nextTitle;
      if (nextTitle === this._databaseTitle) {
        return;
      }
      this._databaseTitle = nextTitle;
      this._updateNodeAttrs?.({ databaseTitle: nextTitle });
    });
    header.appendChild(titleEl);

    // Toolbar slot (icons next to title)
    const toolbarSlot = document.createElement('div');
    toolbarSlot.classList.add('db-inline-toolbar');
    header.appendChild(toolbarSlot);

    // Tab bar slot
    const tabBarSlot = document.createElement('div');
    tabBarSlot.classList.add('db-inline-tab-bar');
    header.appendChild(tabBarSlot);

    // Header actions area
    const headerActions = document.createElement('div');
    headerActions.classList.add('db-inline-header-actions');
    header.appendChild(headerActions);

    // Collapse/expand toolbar toggle
    const toolbarToggleBtn = document.createElement('button');
    toolbarToggleBtn.classList.add('db-inline-action-btn', 'db-inline-toolbar-toggle');
    toolbarToggleBtn.title = 'Hide toolbar actions';
    toolbarToggleBtn.innerHTML = svgIcon('db-collapse');
    toolbarToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toolbarCollapsed = !this._toolbarCollapsed;
      toolbarToggleBtn.classList.toggle('db-inline-toolbar-toggle--collapsed', this._toolbarCollapsed);
      toolbarToggleBtn.title = this._toolbarCollapsed ? 'Show toolbar actions' : 'Hide toolbar actions';
      toolbarToggleBtn.innerHTML = this._toolbarCollapsed ? svgIcon('db-expand') : svgIcon('db-collapse');
      this._host?.setToolbarCollapsed(this._toolbarCollapsed);
    });
    headerActions.appendChild(toolbarToggleBtn);

    // Open full-page button
    const expandBtn = document.createElement('button');
    expandBtn.classList.add('db-inline-expand-btn');
    expandBtn.title = 'Open as full page';
    expandBtn.innerHTML = svgIcon('open');
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openFullPage();
    });
    headerActions.appendChild(expandBtn);

    // Toolbar panel container
    const toolbarPanelsSlot = document.createElement('div');
    toolbarPanelsSlot.classList.add('db-inline-toolbar-panels');
    this.dom.appendChild(toolbarPanelsSlot);

    // Content area
    const contentSlot = document.createElement('div');
    contentSlot.classList.add('db-inline-content');
    this.dom.appendChild(contentSlot);

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.classList.add('db-inline-resize-handle');
    this.dom.appendChild(resizeHandle);
    this._setupResize(resizeHandle);

    // Create the shared view host and load data
    this._host = new DatabaseViewHost({
      databaseId: this._databaseId,
      dataService: this._dataService,
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
      contentSlot.classList.add('db-inline-error');
    });

    this._host.load().catch(err => {
      console.error('[DatabaseInlineNode] Host load failed:', err);
    });
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
    const newTitle = (node.attrs.databaseTitle as string | undefined) ?? 'New database';
    if (newDbId !== this._databaseId) {
      this._databaseId = newDbId;
      this._reloadHost();
    }
    if (newTitle !== this._databaseTitle) {
      this._databaseTitle = newTitle;
      const titleEl = this.dom.querySelector('.db-inline-title');
      if (titleEl) {
        titleEl.textContent = this._databaseTitle;
      }
    }
    return true;
  }

  destroy(): void {
    this._host?.dispose();
    this._host = null;
  }

  // ── Host Reload (on databaseId change) ───────────────────────────────

  private _reloadHost(): void {
    this._host?.dispose();
    this._host = null;

    const tabBarSlot = this.dom.querySelector('.db-inline-tab-bar') as HTMLElement;
    const toolbarSlot = this.dom.querySelector('.db-inline-toolbar') as HTMLElement;
    const toolbarPanelsSlot = this.dom.querySelector('.db-inline-toolbar-panels') as HTMLElement;
    const contentSlot = this.dom.querySelector('.db-inline-content') as HTMLElement;

    if (!tabBarSlot || !toolbarSlot || !toolbarPanelsSlot || !contentSlot) return;

    // Clear previous content in all slots
    tabBarSlot.innerHTML = '';
    toolbarSlot.innerHTML = '';
    toolbarPanelsSlot.innerHTML = '';
    contentSlot.innerHTML = '';
    contentSlot.classList.remove('db-inline-error');

    this._host = new DatabaseViewHost({
      databaseId: this._databaseId,
      dataService: this._dataService,
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
      databaseTitle: {
        default: 'New database',
        parseHTML: (el) => el.getAttribute('data-database-title') ?? 'New database',
        renderHTML: (attrs) => ({ 'data-database-title': attrs.databaseTitle ?? 'New database' }),
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
    return ({ node, getPos, editor }) => {
      const dataService = this.options.databaseDataService;
      if (!dataService) {
        const dom = document.createElement('div');
        dom.classList.add('db-inline-wrapper', 'db-inline-error');
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

      return new DatabaseInlineNodeView(node, dataService, updateNodeAttrs, this.options.openEditor);
    };
  },
});
