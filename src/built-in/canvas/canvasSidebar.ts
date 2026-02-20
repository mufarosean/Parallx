// canvasSidebar.ts — Canvas page tree sidebar view
//
// Provides a tree view of all Canvas pages with:
//   • Expand/collapse for nested pages
//   • Click to open page in editor
//   • Inline rename (double-click or F2)
//   • Create (+) button in toolbar
//   • Delete via keyboard (Delete key)
//   • Drag-and-drop to reorder and reparent
//   • Reactive updates from CanvasDataService change events
//   • Favorites section at top (Task 10.2)
//   • Trash section at bottom (Task 10.3)
//   • Right-click context menu (Task 10.7)

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IPage, IPageTreeNode, ICanvasDataService } from './canvasTypes.js';
import { $ } from '../../ui/dom.js';
import { InputBox } from '../../ui/inputBox.js';
import { ContextMenu, type IContextMenuItem } from '../../ui/contextMenu.js';
import { createIconElement, resolvePageIcon, svgIcon } from './config/iconRegistry.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const INDENT_PX = 20;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CanvasSidebarApi {
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
    readonly openEditors: readonly { id: string; name: string; isActive: boolean }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
  commands: {
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
}

// ─── CanvasSidebar ───────────────────────────────────────────────────────────

export class CanvasSidebar {
  private readonly _disposables: IDisposable[] = [];
  private _treeList: HTMLElement | null = null;
  private _selectedPageId: string | null = null;
  private _expandedIds = new Set<string>();
  private _favExpandedIds = new Set<string>();
  private _tree: IPageTreeNode[] = [];

  // ── Favorites / Trash state ──
  private _favoritedPages: IPage[] = [];
  private _archivedPages: IPage[] = [];

  // ── Trash panel ──
  private _trashPanel: HTMLElement | null = null;
  private _trashSearchQuery = '';

  // ── Context menu ──
  private _contextMenu: ContextMenu | null = null;

  // ── Callbacks ──
  private _onExpandStateChanged: ((expandedIds: ReadonlySet<string>) => void) | null = null;

  // ── Drag-and-drop state ──
  private _draggedPageId: string | null = null;
  private _dropIndicator: HTMLElement | null = null;
  private _dropTarget: { parentId: string | null; afterSiblingId: string | undefined } | null = null;
  private _dragOverElement: HTMLElement | null = null;

  // ── Inline rename state ──
  private _renamingPageId: string | null = null;

  constructor(
    private readonly _dataService: ICanvasDataService,
    private readonly _api: CanvasSidebarApi,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // View Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  createView(container: HTMLElement): IDisposable {
    container.classList.add('canvas-tree');

    // Tree list container (toolbar is integrated into section headers)
    this._treeList = $('div.canvas-tree-list');
    this._treeList.tabIndex = 0;
    this._treeList.setAttribute('role', 'tree');
    container.appendChild(this._treeList);

    // Fixed trash button at bottom of sidebar
    const trashBtn = $('button.canvas-sidebar-trash-btn');
    const trashIcon = createIconElement('trash', 14);
    trashBtn.appendChild(trashIcon);
    const trashText = $('span');
    trashText.textContent = 'Trash';
    trashBtn.appendChild(trashText);
    trashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleTrashPanel();
    });
    container.appendChild(trashBtn);

    // Keyboard handler
    this._treeList.addEventListener('keydown', this._handleKeydown);

    // Load initial tree
    this._refreshTree();

    // Subscribe to data changes
    this._disposables.push(
      this._dataService.onDidChangePage(() => this._refreshTree()),
    );

    // Sync selection with active editor
    this._disposables.push(
      this._api.editors.onDidChangeOpenEditors(() => this._syncSelectionFromEditor()),
    );

    return {
      dispose: () => {
        this._treeList?.removeEventListener('keydown', this._handleKeydown);
        this._dismissContextMenuCleanup();
        this._dismissTrashPanel();
        this._treeList = null;
        for (const d of this._disposables) d.dispose();
        this._disposables.length = 0;
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Tree Rendering
  // ══════════════════════════════════════════════════════════════════════════

  /** Public entry point to re-fetch all data and re-render the sidebar tree. */
  refresh(): void {
    void this._refreshTree();
  }

  private async _refreshTree(): Promise<void> {
    // Don't wipe the DOM while an inline rename is in progress
    if (this._renamingPageId) return;
    try {
      const [tree, favorites, archived] = await Promise.all([
        this._dataService.getPageTree(),
        this._dataService.getFavoritedPages(),
        this._dataService.getArchivedPages(),
      ]);
      this._tree = tree;
      this._favoritedPages = favorites;
      this._archivedPages = archived;
    } catch (err) {
      console.error('[CanvasSidebar] Failed to load page tree:', err);
      this._tree = [];
      this._favoritedPages = [];
      this._archivedPages = [];
    }
    this._renderTree();
  }

  private _renderTree(): void {
    if (!this._treeList) return;
    this._treeList.innerHTML = '';

    // ── Favorites section ──
    if (this._favoritedPages.length > 0) {
      const favSection = $('div.canvas-sidebar-section.canvas-sidebar-favorites');

      const favLabel = $('div.canvas-sidebar-section-label');
      favLabel.textContent = 'FAVORITES';
      favSection.appendChild(favLabel);

      for (const page of this._favoritedPages) {
        const row = this._renderFavoriteRow(page);
        favSection.appendChild(row);

        // Render children inline under favorites (Notion-style)
        const treeNode = this._findNode(this._tree, page.id);
        if (treeNode && treeNode.children.length > 0) {
          const childrenEl = $('div.canvas-children');
          if (!this._favExpandedIds.has(page.id)) childrenEl.classList.add('canvas-children--collapsed');
          for (const child of treeNode.children) {
            this._renderNode(childrenEl, child as IPageTreeNode, 1, this._favExpandedIds);
          }
          favSection.appendChild(childrenEl);
        }
      }

      this._treeList.appendChild(favSection);

      // Separator
      const sep = $('div.canvas-sidebar-separator');
      this._treeList.appendChild(sep);
    }

    // ── Pages section header with inline + button ──
    const pagesHeader = $('div.canvas-sidebar-section-header');
    const pagesLabel = $('div.canvas-sidebar-section-label');
    pagesLabel.textContent = 'PAGES';
    pagesHeader.appendChild(pagesLabel);

    const addBtn = $('button.canvas-sidebar-add-btn');
    addBtn.title = 'New Page';
    addBtn.appendChild(createIconElement('plus', 14));
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._createPage();
    });
    pagesHeader.appendChild(addBtn);
    this._treeList.appendChild(pagesHeader);

    // ── Main tree ──
    if (this._tree.length === 0) {
      const empty = $('div.canvas-empty');
      empty.textContent = 'No pages yet.';
      const btn = $('button.canvas-empty-btn');
      btn.textContent = 'Click + to create one';
      btn.addEventListener('click', () => this._createPage());
      empty.appendChild($('br'));
      empty.appendChild(btn);
      this._treeList.appendChild(empty);
    } else {
      for (const node of this._tree) {
        this._renderNode(this._treeList, node, 0);
      }
    }

    // Update trash count badge on the bottom button
    const trashBtnEl = this._treeList.parentElement?.querySelector('.canvas-sidebar-trash-btn');
    if (trashBtnEl) {
      const existingBadge = trashBtnEl.querySelector('.canvas-sidebar-trash-badge');
      if (existingBadge) existingBadge.remove();
      if (this._archivedPages.length > 0) {
        const badge = $('span.canvas-sidebar-trash-badge');
        badge.textContent = String(this._archivedPages.length);
        trashBtnEl.appendChild(badge);
      }
    }
  }

  // ── Render a favorites row ──

  private _renderFavoriteRow(page: IPage): HTMLElement {
    const row = $('div.canvas-node.canvas-favorite-node');
    row.setAttribute('data-page-id', page.id);

    // Check if this favorite has children in the main tree
    const treeNode = this._findNode(this._tree, page.id);
    const hasChildren = treeNode ? treeNode.children.length > 0 : false;
    const isExpanded = this._favExpandedIds.has(page.id);
    if (hasChildren) {
      row.classList.add('canvas-node--has-children');
      if (isExpanded) row.classList.add('canvas-node--expanded');
    }

    // Icon area (consistent alignment with tree nodes)
    const iconArea = $('span.canvas-node-icon-area');
    const iconEl = createIconElement(resolvePageIcon(page.icon), 14);
    iconEl.classList.add('canvas-node-icon');
    iconArea.appendChild(iconEl);

    // Chevron overlay (same as tree nodes)
    if (hasChildren) {
      const chevron = $('span.canvas-node-chevron');
      chevron.innerHTML = svgIcon('chevron-right');
      const chevSvg = chevron.querySelector('svg');
      if (chevSvg) { chevSvg.setAttribute('width', '12'); chevSvg.setAttribute('height', '12'); }
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleFavExpand(page.id);
      });
      iconArea.appendChild(chevron);
    }

    row.appendChild(iconArea);

    // Label
    const label = $('span.canvas-node-label');
    label.textContent = page.title;
    row.appendChild(label);

    // Hover actions: ⋯ menu + add child page (Notion-style)
    const actions = $('div.canvas-node-actions');

    const moreBtn = $('button.canvas-node-action-btn');
    moreBtn.appendChild(createIconElement('ellipsis', 14));
    moreBtn.title = 'More actions';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showContextMenu(e, page);
    });
    actions.appendChild(moreBtn);

    const addBtn = $('button.canvas-node-action-btn');
    addBtn.appendChild(createIconElement('plus', 14));
    addBtn.title = 'Add a page inside';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._createPage(page.id);
    });
    actions.appendChild(addBtn);

    row.appendChild(actions);

    if (page.id === this._selectedPageId) {
      row.classList.add('canvas-node--selected');
    }

    // Click → open
    row.addEventListener('click', () => this._selectAndOpenPage(page));

    // Right-click → context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showContextMenu(e, page);
    });

    return row;
  }

  // ── Render a trash row ──

  private _renderTrashRow(page: IPage, container: HTMLElement): void {
    const row = $('div.canvas-node.canvas-trash-panel-node');
    row.setAttribute('data-page-id', page.id);

    // Icon area (consistent alignment)
    const iconArea = $('span.canvas-node-icon-area');
    const iconEl = createIconElement(resolvePageIcon(page.icon), 14);
    iconEl.classList.add('canvas-node-icon');
    iconArea.appendChild(iconEl);
    row.appendChild(iconArea);

    // Label + date
    const textCol = $('div.canvas-trash-panel-text');
    const label = $('span.canvas-node-label');
    label.textContent = page.title;
    textCol.appendChild(label);
    const date = $('span.canvas-trash-panel-date');
    const d = new Date(page.updatedAt);
    date.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    textCol.appendChild(date);
    row.appendChild(textCol);

    // Restore button (SVG)
    const restoreBtn = $('button.canvas-trash-restore-btn');
    restoreBtn.appendChild(createIconElement('restore', 14));
    restoreBtn.title = 'Restore';
    restoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dataService.restorePage(page.id);
    });
    row.appendChild(restoreBtn);

    // Permanent delete button (SVG)
    const deleteBtn = $('button.canvas-trash-delete-btn');
    deleteBtn.appendChild(createIconElement('close', 14));
    deleteBtn.title = 'Delete permanently';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await this._api.window.showWarningMessage(
        `Permanently delete "${page.title}"? This cannot be undone.`,
        { title: 'Delete' },
        { title: 'Cancel' },
      );
      if (result?.title === 'Delete') {
        await this._dataService.permanentlyDeletePage(page.id);
      }
    });
    row.appendChild(deleteBtn);

    container.appendChild(row);
  }

  private _renderNode(parent: HTMLElement, node: IPageTreeNode, depth: number, expandSet?: Set<string>): void {
    const exSet = expandSet ?? this._expandedIds;
    const row = $('div.canvas-node');
    row.setAttribute('role', 'treeitem');
    row.setAttribute('data-page-id', node.id);
    row.style.paddingLeft = `${8 + depth * INDENT_PX}px`;
    row.draggable = true;

    const hasChildren = node.children.length > 0;
    const isExpanded = exSet.has(node.id);

    // Notion-style: chevron overlays icon on hover / when expanded
    if (hasChildren) {
      row.classList.add('canvas-node--has-children');
      if (isExpanded) row.classList.add('canvas-node--expanded');
    }

    // Icon area — shared container so chevron can overlay the icon
    const iconArea = $('span.canvas-node-icon-area');

    // Icon (SVG) — always present
    const iconEl = createIconElement(resolvePageIcon(node.icon), 14);
    iconEl.classList.add('canvas-node-icon');
    iconArea.appendChild(iconEl);

    // Chevron (SVG) — overlays icon; CSS toggles visibility
    if (hasChildren) {
      const chevron = $('span.canvas-node-chevron');
      chevron.innerHTML = svgIcon('chevron-right');
      const chevSvg = chevron.querySelector('svg');
      if (chevSvg) { chevSvg.setAttribute('width', '12'); chevSvg.setAttribute('height', '12'); }
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        if (exSet === this._favExpandedIds) {
          this._toggleFavExpand(node.id);
        } else {
          this._toggleExpand(node.id);
        }
      });
      iconArea.appendChild(chevron);
    }

    row.appendChild(iconArea);

    // Label
    const label = $('span.canvas-node-label');
    label.textContent = node.title;
    row.appendChild(label);

    // Hover actions: ⋯ menu + add child page (Notion-style)
    const nodeActions = $('div.canvas-node-actions');

    const moreBtn = $('button.canvas-node-action-btn');
    moreBtn.appendChild(createIconElement('ellipsis', 14));
    moreBtn.title = 'More actions';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showContextMenu(e, node);
    });
    nodeActions.appendChild(moreBtn);

    const addChildBtn = $('button.canvas-node-action-btn');
    addChildBtn.appendChild(createIconElement('plus', 14));
    addChildBtn.title = 'Add a page inside';
    addChildBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._createPage(node.id);
    });
    nodeActions.appendChild(addChildBtn);

    row.appendChild(nodeActions);

    // Selected state
    if (node.id === this._selectedPageId) {
      row.classList.add('canvas-node--selected');
    }

    // ── Event handlers ──

    // Click → open in editor
    row.addEventListener('click', () => this._selectAndOpenPage(node));

    // Double-click → inline rename
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._startInlineRename(row, label, node);
    });

    // Right-click → context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showContextMenu(e, node);
    });

    // ── Drag-and-drop ──
    row.addEventListener('dragstart', (e) => this._onDragStart(e, node));
    row.addEventListener('dragover', (e) => this._onDragOver(e, row, node, depth));
    row.addEventListener('dragleave', () => this._onDragLeave(row));
    row.addEventListener('drop', (e) => this._onDrop(e, row));
    row.addEventListener('dragend', () => this._onDragEnd());

    parent.appendChild(row);

    // Children container
    if (hasChildren) {
      const childrenEl = $('div.canvas-children');
      if (!isExpanded) childrenEl.classList.add('canvas-children--collapsed');
      for (const child of node.children) {
        this._renderNode(childrenEl, child, depth + 1, exSet);
      }
      parent.appendChild(childrenEl);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Right-Click Context Menu (Task 10.7)
  // ══════════════════════════════════════════════════════════════════════════

  private _showContextMenu(e: MouseEvent, page: IPage | IPageTreeNode): void {
    this._dismissContextMenuCleanup();

    const icon = (name: string) => (el: HTMLElement) => el.appendChild(createIconElement(name, 14));

    const actions = new Map<string, () => void>();

    const items: IContextMenuItem[] = [
      {
        id: 'open', label: 'Open', group: '1_nav',
        renderIcon: icon('open'),
      },
      {
        id: 'new-subpage', label: 'New subpage', group: '1_nav',
        renderIcon: icon('new-page'),
      },
      {
        id: 'rename', label: 'Rename', group: '1_nav',
        renderIcon: icon('edit'),
      },
      {
        id: 'favorite', group: '2_edit',
        label: page.isFavorited ? 'Remove from Favorites' : 'Add to Favorites',
        renderIcon: icon(page.isFavorited ? 'star' : 'star-filled'),
      },
      {
        id: 'duplicate', label: 'Duplicate', group: '2_edit',
        renderIcon: icon('duplicate'),
      },
      {
        id: 'export-md', label: 'Export as Markdown', group: '2_edit',
        renderIcon: icon('export'),
      },
      {
        id: 'delete', label: 'Delete', group: '3_danger',
        renderIcon: icon('trash'),
        className: 'context-menu-item--danger',
      },
    ];

    actions.set('open', () => this._selectAndOpenPage(page));
    actions.set('new-subpage', () => this._createPage(page.id));
    actions.set('rename', () => {
      requestAnimationFrame(() => {
        const el = this._treeList?.querySelector(`[data-page-id="${page.id}"]`);
        if (el) {
          const label = el.querySelector('.canvas-node-label');
          const node = this._findNode(this._tree, page.id);
          if (label && node) {
            this._startInlineRename(el as HTMLElement, label as HTMLElement, node);
          }
        }
      });
    });
    actions.set('favorite', () => this._dataService.toggleFavorite(page.id));
    actions.set('duplicate', async () => {
      try {
        const newPage = await this._dataService.duplicatePage(page.id);
        this._selectAndOpenPage(newPage);
      } catch (err) {
        console.error('[CanvasSidebar] Duplicate failed:', err);
      }
    });
    actions.set('export-md', async () => {
      try {
        const fullPage = await this._dataService.getPage(page.id);
        if (!fullPage) return;

        const { tiptapJsonToMarkdown } = await import('./markdownExport.js');
        let doc: unknown = null;
        try { doc = JSON.parse(fullPage.content); } catch { /* empty */ }

        const markdown = tiptapJsonToMarkdown(doc, fullPage.title);
        const safeName = fullPage.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100).trim() || 'Untitled';

        const electron = (window as any).parallxElectron;
        if (!electron?.dialog?.saveFile || !electron?.fs?.writeFile) return;

        const filePath = await electron.dialog.saveFile({
          filters: [{ name: 'Markdown', extensions: ['md'] }],
          defaultName: `${safeName}.md`,
        });
        if (filePath) {
          await electron.fs.writeFile(filePath, markdown, 'utf-8');
        }
      } catch (err) {
        console.error('[CanvasSidebar] Export failed:', err);
      }
    });
    actions.set('delete', () => this._deletePage(page.id));

    this._contextMenu = ContextMenu.show({
      items,
      anchor: { x: e.clientX, y: e.clientY },
      className: 'canvas-context-menu',
    });

    this._contextMenu.onDidSelect(({ item }) => {
      const action = actions.get(item.id);
      if (action) action();
    });

    this._contextMenu.onDidDismiss(() => {
      this._contextMenu = null;
    });
  }

  private _dismissContextMenuCleanup(): void {
    if (this._contextMenu) {
      this._contextMenu.dismiss();
      this._contextMenu = null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Trash Panel — Fixed bottom popup with search & date sorting
  // ══════════════════════════════════════════════════════════════════════════

  private _toggleTrashPanel(): void {
    if (this._trashPanel) {
      this._dismissTrashPanel();
    } else {
      this._showTrashPanel();
    }
  }

  private _showTrashPanel(): void {
    this._dismissTrashPanel();

    this._trashPanel = $('div.canvas-trash-panel');

    // Header
    const header = $('div.canvas-trash-panel-header');
    const title = $('span.canvas-trash-panel-title');
    title.textContent = 'Trash';
    header.appendChild(title);

    if (this._archivedPages.length > 0) {
      const emptyBtn = $('button.canvas-trash-panel-empty-btn');
      emptyBtn.textContent = 'Empty Trash';
      emptyBtn.addEventListener('click', async () => {
        const result = await this._api.window.showWarningMessage(
          `Permanently delete ${this._archivedPages.length} page(s) from trash? This cannot be undone.`,
          { title: 'Delete All' },
          { title: 'Cancel' },
        );
        if (result?.title === 'Delete All') {
          for (const p of this._archivedPages) {
            await this._dataService.permanentlyDeletePage(p.id);
          }
        }
      });
      header.appendChild(emptyBtn);
    }

    const closeBtn = $('button.canvas-trash-panel-close');
    closeBtn.appendChild(createIconElement('close', 14));
    closeBtn.addEventListener('click', () => this._dismissTrashPanel());
    header.appendChild(closeBtn);
    this._trashPanel.appendChild(header);

    // Search
    const searchRow = $('div.canvas-trash-panel-search');
    const searchIcon = createIconElement('search', 14);
    searchRow.appendChild(searchIcon);
    const searchBox = new InputBox(searchRow, {
      placeholder: 'Search trash...',
      value: this._trashSearchQuery,
    });
    searchBox.inputElement.classList.add('canvas-trash-panel-search-input');
    this._trashPanel.appendChild(searchRow);

    // List
    const list = $('div.canvas-trash-panel-list');
    this._trashPanel.appendChild(list);

    const renderList = (query: string) => {
      list.innerHTML = '';
      const q = query.toLowerCase();
      const filtered = this._archivedPages.filter(p =>
        !q || p.title.toLowerCase().includes(q),
      );
      if (filtered.length === 0) {
        const empty = $('div.canvas-trash-panel-empty');
        empty.textContent = q ? 'No matching pages in trash.' : 'Trash is empty.';
        list.appendChild(empty);
      } else {
        for (const page of filtered) {
          this._renderTrashRow(page, list);
        }
      }
    };

    renderList(this._trashSearchQuery);

    searchBox.onDidChange((value) => {
      this._trashSearchQuery = value.trim();
      renderList(this._trashSearchQuery);
    });

    // Position above the trash button
    const trashBtn = this._treeList?.parentElement?.querySelector('.canvas-sidebar-trash-btn');
    if (trashBtn) {
      const rect = trashBtn.getBoundingClientRect();
      const sidebarRect = this._treeList!.parentElement!.getBoundingClientRect();
      this._trashPanel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      this._trashPanel.style.left = `${sidebarRect.left}px`;
      this._trashPanel.style.width = `${Math.max(sidebarRect.width, 280)}px`;
    }

    document.body.appendChild(this._trashPanel);
    setTimeout(() => searchBox.focus(), 50);

    // Dismiss on click outside
    setTimeout(() => {
      document.addEventListener('mousedown', this._handleTrashOutsideClick);
      document.addEventListener('keydown', this._handleTrashEscape);
    }, 0);
  }

  private readonly _handleTrashOutsideClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (this._trashPanel?.contains(target)) return;
    // Don't dismiss if clicking the trash button itself (toggle handles it)
    const trashBtn = this._treeList?.parentElement?.querySelector('.canvas-sidebar-trash-btn');
    if (trashBtn?.contains(target)) return;
    this._dismissTrashPanel();
  };

  private readonly _handleTrashEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._dismissTrashPanel();
  };

  private _dismissTrashPanel(): void {
    if (this._trashPanel) {
      this._trashPanel.remove();
      this._trashPanel = null;
    }
    document.removeEventListener('mousedown', this._handleTrashOutsideClick);
    document.removeEventListener('keydown', this._handleTrashEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Selection & Editor Opening (Task 4.2)
  // ══════════════════════════════════════════════════════════════════════════

  private async _selectAndOpenPage(page: IPage | IPageTreeNode): Promise<void> {
    this._selectedPageId = page.id;
    this._renderTree();

    try {
      await this._api.editors.openEditor({
        typeId: 'canvas',
        title: page.title,
        icon: page.icon || undefined,
        instanceId: page.id,
      });
    } catch (err) {
      console.error('[CanvasSidebar] Failed to open page:', err);
    }
  }

  private _syncSelectionFromEditor(): void {
    const editors = this._api.editors.openEditors;
    const active = editors.find(e => e.isActive);
    if (!active) return;

    // Editor IDs for canvas pages are formatted as "parallx.canvas:canvas:<pageId>"
    // or just the instanceId which is the pageId
    const pageId = this._extractPageIdFromEditorId(active.id);
    if (pageId && pageId !== this._selectedPageId) {
      this._selectedPageId = pageId;
      this._renderTree();
    }
  }

  private _extractPageIdFromEditorId(editorId: string): string | null {
    // The instanceId passed to openEditor is the pageId directly
    // The editor system wraps it: "toolId:typeId:instanceId"
    // Format: "parallx.canvas:canvas:<pageId>"
    const parts = editorId.split(':');
    if (parts.length >= 3 && parts[1] === 'canvas') {
      return parts.slice(2).join(':'); // rejoin in case UUID contains colons
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Create / Rename / Delete (Task 4.3)
  // ══════════════════════════════════════════════════════════════════════════

  private async _createPage(parentId?: string | null): Promise<void> {
    try {
      const page = await this._dataService.createPage(parentId);
      // Data change event will refresh tree; select the new page
      this._selectedPageId = page.id;
      // Open in editor
      await this._api.editors.openEditor({
        typeId: 'canvas',
        title: page.title,
        icon: page.icon || undefined,
        instanceId: page.id,
      });
      // After tree refreshes, start inline rename on the new page
      requestAnimationFrame(() => {
        const el = this._treeList?.querySelector(`[data-page-id="${page.id}"]`);
        if (el) {
          const label = el.querySelector('.canvas-node-label');
          if (label) {
            const node = this._findNode(this._tree, page.id);
            if (node) this._startInlineRename(el as HTMLElement, label as HTMLElement, node);
          }
        }
      });
    } catch (err) {
      console.error('[CanvasSidebar] Failed to create page:', err);
    }
  }

  private _startInlineRename(row: HTMLElement, label: HTMLElement, node: IPageTreeNode): void {
    if (this._renamingPageId) return; // already renaming
    this._renamingPageId = node.id;

    const renameBox = new InputBox(row, { value: node.title });
    renameBox.inputElement.classList.add('canvas-inline-input');

    // Replace label with input
    label.style.display = 'none';
    renameBox.focus();
    renameBox.select();

    const commit = async () => {
      const newTitle = renameBox.value.trim() || 'Untitled';
      cleanup();
      if (newTitle !== node.title) {
        try {
          await this._dataService.updatePage(node.id, { title: newTitle });
        } catch (err) {
          console.error('[CanvasSidebar] Rename failed:', err);
        }
      }
    };

    const cancel = () => {
      cleanup();
    };

    const cleanup = () => {
      this._renamingPageId = null;
      renameBox.inputElement.removeEventListener('blur', commit);
      renameBox.element.remove();
      renameBox.dispose();
      label.style.display = '';
    };

    renameBox.onDidSubmit(() => commit());
    renameBox.onDidCancel(() => cancel());
    renameBox.inputElement.addEventListener('blur', commit);
  }

  private async _deletePage(pageId: string): Promise<void> {
    const page = await this._dataService.getPage(pageId);
    if (!page) return;

    const result = await this._api.window.showWarningMessage(
      `Move "${page.title}" to trash?`,
      { title: 'Move to Trash' },
      { title: 'Cancel' },
    );
    if (result?.title !== 'Move to Trash') return;

    try {
      await this._dataService.archivePage(pageId);
      if (this._selectedPageId === pageId) {
        this._selectedPageId = null;
      }
    } catch (err) {
      console.error('[CanvasSidebar] Delete failed:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Expand / Collapse
  // ══════════════════════════════════════════════════════════════════════════

  private _toggleExpand(pageId: string): void {
    if (this._expandedIds.has(pageId)) {
      this._expandedIds.delete(pageId);
    } else {
      this._expandedIds.add(pageId);
    }
    this._renderTree();
    // Notify listener for persistence (Task 6.2)
    this._onExpandStateChanged?.(this._expandedIds);
  }

  private _toggleFavExpand(pageId: string): void {
    if (this._favExpandedIds.has(pageId)) {
      this._favExpandedIds.delete(pageId);
    } else {
      this._favExpandedIds.add(pageId);
    }
    this._renderTree();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Drag-and-Drop (Task 4.4)
  // ══════════════════════════════════════════════════════════════════════════

  private _onDragStart(e: DragEvent, node: IPageTreeNode): void {
    this._draggedPageId = node.id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    }
  }

  private _onDragOver(e: DragEvent, row: HTMLElement, node: IPageTreeNode, _depth: number): void {
    if (!this._draggedPageId || this._draggedPageId === node.id) return;

    // Prevent dropping onto own descendants
    if (this._isDescendant(this._tree, this._draggedPageId, node.id)) return;

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const zone = y / rect.height;

    // Clear previous indicators
    this._clearDropIndicators();

    if (zone < 0.25) {
      // Top quarter → insert before this node
      this._showDropLine(row, 'before');
      this._dropTarget = {
        parentId: node.parentId,
        afterSiblingId: this._getPreviousSiblingId(node),
      };
    } else if (zone > 0.75) {
      // Bottom quarter → insert after this node
      this._showDropLine(row, 'after');
      this._dropTarget = {
        parentId: node.parentId,
        afterSiblingId: node.id,
      };
    } else {
      // Middle → reparent as child
      row.classList.add('canvas-node--drag-over-reparent');
      this._dragOverElement = row;
      this._dropTarget = {
        parentId: node.id,
        afterSiblingId: undefined,
      };
    }
  }

  private _onDragLeave(row: HTMLElement): void {
    row.classList.remove('canvas-node--drag-over-reparent');
  }

  private _onDrop(e: DragEvent, row: HTMLElement): void {
    e.preventDefault();
    row.classList.remove('canvas-node--drag-over-reparent');
    this._clearDropIndicators();

    if (!this._draggedPageId || !this._dropTarget) return;

    const pageId = this._draggedPageId;
    const { parentId, afterSiblingId } = this._dropTarget;

    this._draggedPageId = null;
    this._dropTarget = null;

    this._dataService.movePage(pageId, parentId, afterSiblingId).catch((err) => {
      console.error('[CanvasSidebar] Move failed:', err);
    });
  }

  private _onDragEnd(): void {
    this._draggedPageId = null;
    this._dropTarget = null;
    this._clearDropIndicators();
  }

  private _showDropLine(row: HTMLElement, position: 'before' | 'after'): void {
    this._removeDropIndicator();
    const indicator = $('div.canvas-drop-indicator');
    this._dropIndicator = indicator;
    if (position === 'before') {
      row.parentElement?.insertBefore(indicator, row);
    } else {
      row.parentElement?.insertBefore(indicator, row.nextSibling);
    }
  }

  private _clearDropIndicators(): void {
    if (this._dragOverElement) {
      this._dragOverElement.classList.remove('canvas-node--drag-over-reparent');
      this._dragOverElement = null;
    }
    this._removeDropIndicator();
  }

  private _removeDropIndicator(): void {
    if (this._dropIndicator) {
      this._dropIndicator.remove();
      this._dropIndicator = null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Keyboard Handler
  // ══════════════════════════════════════════════════════════════════════════

  private readonly _handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Delete' && this._selectedPageId) {
      e.preventDefault();
      this._deletePage(this._selectedPageId);
    } else if (e.key === 'F2' && this._selectedPageId) {
      e.preventDefault();
      const el = this._treeList?.querySelector(`[data-page-id="${this._selectedPageId}"]`);
      if (el) {
        const label = el.querySelector('.canvas-node-label');
        const node = this._findNode(this._tree, this._selectedPageId);
        if (label && node) {
          this._startInlineRename(el as HTMLElement, label as HTMLElement, node);
        }
      }
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Tree Helpers
  // ══════════════════════════════════════════════════════════════════════════

  private _findNode(tree: IPageTreeNode[], pageId: string): IPageTreeNode | null {
    for (const node of tree) {
      if (node.id === pageId) return node;
      const found = this._findNode(node.children as IPageTreeNode[], pageId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Check if `potentialDescendantId` is a descendant of `ancestorId`.
   */
  private _isDescendant(tree: IPageTreeNode[], ancestorId: string, potentialDescendantId: string): boolean {
    const ancestor = this._findNode(tree, ancestorId);
    if (!ancestor) return false;
    return this._findNode(ancestor.children as IPageTreeNode[], potentialDescendantId) !== null;
  }

  /**
   * Get the ID of the previous sibling of a node, or undefined if it's the first.
   */
  private _getPreviousSiblingId(node: IPageTreeNode): string | undefined {
    const siblings = node.parentId
      ? (this._findNode(this._tree, node.parentId)?.children ?? [])
      : this._tree;
    const idx = siblings.findIndex(s => s.id === node.id);
    return idx > 0 ? siblings[idx - 1].id : undefined;
  }

  // ── Expanded state accessors (for persistence in Cap 6) ──

  get expandedIds(): ReadonlySet<string> {
    return this._expandedIds;
  }

  setExpandedIds(ids: Iterable<string>): void {
    this._expandedIds = new Set(ids);
    this._renderTree();
  }

  get selectedPageId(): string | null {
    return this._selectedPageId;
  }

  setSelectedPage(pageId: string | null): void {
    this._selectedPageId = pageId;
    this._renderTree();
  }

  /**
   * Register a callback that fires whenever expanded node IDs change.
   * Used by main.ts to persist expand state to workspace memento (Task 6.2).
   */
  set onExpandStateChanged(cb: ((expandedIds: ReadonlySet<string>) => void) | null) {
    this._onExpandStateChanged = cb;
  }
}
