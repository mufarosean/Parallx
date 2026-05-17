// canvasSidebar.ts — Canvas page tree sidebar view
//
// Provides a tree view of all Canvas pages with:
//   • Expand/collapse for nested pages
//   • Click to open page in editor
//   • Page options popup for rename/icon changes (double-click or F2)
//   • Create (+) button in toolbar
//   • Delete via keyboard (Delete key)
//   • Drag-and-drop to reorder and reparent
//   • Reactive updates from CanvasDataService change events
//   • Favorites section at top (Task 10.2)
//   • Trash section at bottom (Task 10.3)
//   • Right-click page options popup (Task 10.7)

import { DisposableStore, toDisposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { doesPageChangeAffectSidebar } from './canvasTypes.js';
import type { IPage, IPageTreeNode, ICanvasDataService } from './canvasTypes.js';
import { $, layoutPopup, attachPopupDismiss } from '../../ui/dom.js';
import { InputBox } from '../../ui/inputBox.js';
import { IconPicker } from '../../ui/iconPicker.js';
import { ContextMenu } from '../../ui/contextMenu.js';
import { createIconElement, ALL_PAGE_SELECTABLE_ICONS, resolvePageIcon, svgIcon } from './config/blockRegistry.js';
import { CanvasSidebarDragState } from './canvasSidebarDragState.js';

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
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
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
  private _detachTrashDismiss: (() => void) | null = null;

  // ── Context menu ──
  private _contextMenu: ContextMenu | null = null;

  // ── Callbacks ──
  private _onExpandStateChanged: ((expandedIds: ReadonlySet<string>) => void) | null = null;

  // ── Drag-and-drop state (M77 Phase 3 + Phase 7 — extracted to
  //    CanvasSidebarDragState for separation of concerns) ──
  private readonly _dragState = new CanvasSidebarDragState();
  private _dropIndicator: HTMLElement | null = null;
  private _dragOverElement: HTMLElement | null = null;

  // ── Sidebar page options popup ──
  private _pageOptionsPopup: HTMLElement | null = null;
  private _pageOptionsPopupStore: DisposableStore | null = null;
  private _pageOptionsIconPicker: IconPicker | null = null;
  private _pageOptionsPageId: string | null = null;

  // ── Database detection (M8 Phase 2) ──
  private _refreshSeq = 0;
  private _refreshScheduled = false;

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
    this._requestRefreshTree();

    // Subscribe to data changes
    this._disposables.push(
      this._dataService.onDidChangePage((event) => {
        if (!doesPageChangeAffectSidebar(event)) {
          return;
        }
        this._requestRefreshTree();
      }),
    );

    // Sync selection with active editor
    this._disposables.push(
      this._api.editors.onDidChangeOpenEditors(() => this._syncSelectionFromEditor()),
    );

    return {
      dispose: () => {
        this._treeList?.removeEventListener('keydown', this._handleKeydown);
        this._dismissContextMenuCleanup();
        this._dismissPageOptionsPopup({ commitTitle: false });
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
    this._requestRefreshTree();
  }

  /**
   * M77 Phase 2 — convert previously-silent failure paths into visible
   * errors. Logs the full error to console (for debugging) and surfaces
   * a brief message to the user via `api.window.showErrorMessage`. The
   * notification is fire-and-forget; if it itself fails we already have
   * the console log.
   */
  private _surfaceError(operation: string, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[CanvasSidebar] ${operation} failed:`, err);
    try {
      void this._api.window.showErrorMessage(`${operation} failed: ${detail}`);
    } catch {
      /* notification API itself failed — nothing more we can do */
    }
  }

  private _requestRefreshTree(): void {
    // Never rebuild the tree DOM mid-drag or mid-drop async work —
    // `_renderTree` wipes `treeList.innerHTML`, destroying the dragged
    // row and cancelling the browser drag, OR replacing the tree the
    // drop's compensating refresh-on-failure handler is about to read.
    if (this._dragState.isUnsafeToRebuild()) {
      this._dragState.noteSuppressedRefresh();
      return;
    }
    if (this._refreshScheduled) return;
    this._refreshScheduled = true;
    queueMicrotask(() => {
      this._refreshScheduled = false;
      void this._refreshTree();
    });
  }

  /**
   * M77 Phase 3 — process any refreshes that arrived while drag/drop
   * suppressed the tree DOM rebuild. Called from drop's finally and
   * from _onDragEnd as a belt-and-suspenders fallback. Coalesces — a
   * single refresh covers any number of suppressed requests.
   */
  private _drainDeferredRefreshes(): void {
    if (this._dragState.isUnsafeToRebuild()) return;
    if (this._dragState.drainSuppressedRefreshes()) {
      this._requestRefreshTree();
    }
  }

  private async _refreshTree(): Promise<void> {
    const refreshSeq = ++this._refreshSeq;

    const applyIfLatest = (fn: () => void): void => {
      if (refreshSeq !== this._refreshSeq) return;
      fn();
    };

    try {
      const [tree, favorites, archived] = await Promise.all([
        this._dataService.getPageTree(),
        this._dataService.getFavoritedPages(),
        this._dataService.getArchivedPages(),
      ]);

      applyIfLatest(() => {
        this._tree = tree;
        this._favoritedPages = favorites;
        this._archivedPages = archived;
      });
    } catch (err) {
      if (refreshSeq !== this._refreshSeq) return;
      console.error('[CanvasSidebar] Failed to load page tree:', err);
      return;
    }
    if (refreshSeq !== this._refreshSeq) return;
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
    const hasChildren = (treeNode ? treeNode.children.length : 0) > 0;
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
      this._showPageOptionsPopup(page, moreBtn.getBoundingClientRect());
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
    row.addEventListener('click', () => {
      this._selectAndOpenPage(page);
    });

    // Right-click → context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showPageOptionsPopup(page, { x: e.clientX, y: e.clientY });
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

    // Icon — pages get their resolved icon
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
      this._showPageOptionsPopup(node, moreBtn.getBoundingClientRect());
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
    row.addEventListener('click', () => {
      this._selectAndOpenPage(node);
    });

    // Double-click → page options popup focused on the title
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._showPageOptionsPopup(node, row.getBoundingClientRect(), { focusTitle: true, selectTitle: true });
    });

    // Right-click → page options popup
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showPageOptionsPopup(node, { x: e.clientX, y: e.clientY });
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
  // Sidebar Page Options Popup
  // ══════════════════════════════════════════════════════════════════════════

  private _showPageOptionsPopup(
    page: IPage | IPageTreeNode,
    anchor: DOMRect | { x: number; y: number },
    options?: { focusTitle?: boolean; selectTitle?: boolean },
  ): void {
    this._dismissContextMenuCleanup();
    if (this._pageOptionsPopup && this._pageOptionsPageId === page.id) {
      if (options?.focusTitle) {
        const existingInput = this._pageOptionsPopup.querySelector('input') as HTMLInputElement | null;
        existingInput?.focus();
        if (existingInput && options.selectTitle) {
          existingInput.select();
        }
        return;
      }
      this._dismissPageOptionsPopup({ commitTitle: false });
      return;
    }
    this._dismissPageOptionsPopup({ commitTitle: false });

    const popupStore = new DisposableStore();
    const popup = $('div.canvas-sidebar-page-menu');
    popup.setAttribute('data-page-id', page.id);
    const header = $('div.canvas-sidebar-page-menu__header');
    const iconButton = $('button.canvas-sidebar-page-menu__icon-btn') as HTMLButtonElement;
    iconButton.type = 'button';
    let currentIcon = page.icon;
    iconButton.title = currentIcon ? 'Change icon' : 'Add icon';
    const renderIconButton = (iconId: string | null | undefined) => {
      const resolvedIcon = resolvePageIcon(iconId);
      iconButton.innerHTML = '';
      iconButton.appendChild(createIconElement(resolvedIcon, 16));
      iconButton.classList.toggle('canvas-sidebar-page-menu__icon-btn--empty', !iconId);
      iconButton.title = iconId ? 'Change icon' : 'Add icon';
    };
    renderIconButton(currentIcon);
    header.appendChild(iconButton);

    const titleWrap = $('div.canvas-sidebar-page-menu__title');
    const titleInput = popupStore.add(new InputBox(titleWrap, {
      value: page.title,
      placeholder: 'Untitled',
      ariaLabel: 'Page title',
    }));
    titleInput.inputElement.classList.add('canvas-sidebar-page-menu__title-input');
    titleInput.inputElement.spellcheck = true;
    header.appendChild(titleWrap);
    popup.appendChild(header);
    popup.appendChild($('div.canvas-sidebar-page-menu__divider'));

    const addAction = (config: { id: string; label: string; iconId: string; danger?: boolean; action: () => void | Promise<void> }) => {
      const actionBtn = $('button.canvas-sidebar-page-menu__action') as HTMLButtonElement;
      actionBtn.type = 'button';
      actionBtn.appendChild(createIconElement(config.iconId, 14));
      const text = $('span.canvas-sidebar-page-menu__action-label');
      text.textContent = config.label;
      actionBtn.appendChild(text);
      if (config.danger) actionBtn.classList.add('canvas-sidebar-page-menu__action--danger');
      actionBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await commitTitleChange();
        this._dismissPageOptionsPopup({ commitTitle: false });
        await config.action();
      });
      popup.appendChild(actionBtn);
    };

    let lastCommittedTitle = page.title;
    const commitTitleChange = async (): Promise<void> => {
      const nextTitle = titleInput.value.trim() || 'Untitled';
      if (nextTitle === lastCommittedTitle) return;
      try {
        await this._dataService.updatePage(page.id, { title: nextTitle });
        lastCommittedTitle = nextTitle;
      } catch (err) {
        console.error('[CanvasSidebar] Rename failed:', err);
      }
    };

    titleInput.onDidSubmit(() => {
      void commitTitleChange().finally(() => {
        this._dismissPageOptionsPopup({ commitTitle: false });
      });
    });
    titleInput.onDidCancel(() => {
      this._dismissPageOptionsPopup({ commitTitle: false });
    });

    addAction({
      id: 'open',
      label: 'Open',
      iconId: 'open',
      action: () => this._selectAndOpenPage(page),
    });
    addAction({
      id: 'new-subpage',
      label: 'New subpage',
      iconId: 'new-page',
      action: () => this._createPage(page.id),
    });
    addAction({
      id: 'favorite',
      label: page.isFavorited ? 'Remove from Favorites' : 'Add to Favorites',
      iconId: page.isFavorited ? 'star-filled' : 'star',
      action: async () => {
        await this._dataService.toggleFavorite(page.id);
      },
    });
    addAction({
      id: 'duplicate',
      label: 'Duplicate',
      iconId: 'duplicate',
      action: async () => {
        try {
          const newPage = await this._dataService.duplicatePage(page.id);
          this._selectAndOpenPage(newPage);
        } catch (err) {
          console.error('[CanvasSidebar] Duplicate failed:', err);
        }
      },
    });
    addAction({
      id: 'export-md',
      label: 'Export as Markdown',
      iconId: 'export',
      action: async () => {
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
      },
    });
    addAction({
      id: 'delete',
      label: 'Delete',
      iconId: 'trash',
      danger: true,
      action: () => this._deletePage(page.id),
    });

    document.body.appendChild(popup);
    layoutPopup(popup, anchor, { position: 'below', gap: 4 });

    this._pageOptionsPopup = popup;
    this._pageOptionsPopupStore = popupStore;
    this._pageOptionsPageId = page.id;

    const openIconPicker = () => {
      this._pageOptionsIconPicker?.dismiss();
      this._pageOptionsIconPicker = new IconPicker(document.body, {
        anchor: iconButton,
        icons: ALL_PAGE_SELECTABLE_ICONS,
        renderIcon: (iconId) => svgIcon(iconId),
        showSearch: true,
        showRemove: !!currentIcon,
        iconSize: 20,
      });
      this._pageOptionsIconPicker.onDidSelectIcon((iconId) => {
        currentIcon = iconId;
        renderIconButton(iconId);
        void this._dataService.updatePage(page.id, { icon: iconId });
      });
      this._pageOptionsIconPicker.onDidRemoveIcon(() => {
        currentIcon = null;
        renderIconButton(null);
        void this._dataService.updatePage(page.id, { icon: null });
      });
      this._pageOptionsIconPicker.onDidDismiss(() => {
        this._pageOptionsIconPicker = null;
      });
    };

    iconButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openIconPicker();
    });

    popupStore.add(toDisposable(() => {
      this._pageOptionsIconPicker?.dismiss();
      this._pageOptionsIconPicker = null;
      popup.remove();
    }));

    const detachDismiss = attachPopupDismiss(
      popup,
      () => this._dismissPageOptionsPopup({ commitTitle: true }),
      {
        isDismissable: (event) => {
          // While the icon-picker subpopup is open, treat clicks inside it as "inside".
          const target = event.target as Node | null;
          const picker = this._pageOptionsIconPicker?.element;
          return !(picker && target && picker.contains(target));
        },
        onEscape: () => this._dismissPageOptionsPopup({ commitTitle: false }),
      },
    );
    popupStore.add(toDisposable(detachDismiss));

    if (options?.focusTitle) {
      setTimeout(() => {
        titleInput.focus();
        if (options.selectTitle) {
          titleInput.select();
        }
      }, 0);
    }
  }

  private _dismissPageOptionsPopup(options?: { commitTitle?: boolean }): void {
    const popup = this._pageOptionsPopup;
    const popupStore = this._pageOptionsPopupStore;
    if (!popup || !popupStore) return;

    this._pageOptionsPopup = null;
    this._pageOptionsPopupStore = null;
    this._pageOptionsPageId = null;

    if (options?.commitTitle) {
      const input = popup.querySelector('input') as HTMLInputElement | null;
      const pageId = popup.getAttribute('data-page-id');
      if (input && pageId) {
        const nextTitle = input.value.trim() || 'Untitled';
        const node = this._findNode(this._tree, pageId) ?? this._favoritedPages.find(page => page.id === pageId) ?? null;
        if (node && nextTitle !== node.title) {
          void this._dataService.updatePage(pageId, { title: nextTitle }).catch((err) => {
            this._surfaceError('Rename', err);
          });
        }
      }
    }

    popupStore.dispose();
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

    // Dismiss on click outside (panel + trash button both treated as "inside")
    const trashBtnEl = this._treeList?.parentElement?.querySelector(
      '.canvas-sidebar-trash-btn',
    ) as HTMLElement | null;
    const roots: HTMLElement[] = [this._trashPanel];
    if (trashBtnEl) roots.push(trashBtnEl);
    this._detachTrashDismiss = attachPopupDismiss(roots, () => this._dismissTrashPanel());
  }

  private _dismissTrashPanel(): void {
    if (this._trashPanel) {
      this._trashPanel.remove();
      this._trashPanel = null;
    }
    this._detachTrashDismiss?.();
    this._detachTrashDismiss = null;
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
    // Format: "parallx.canvas:canvas:<pageId>" or "parallx.canvas:database:<pageId>"
    const parts = editorId.split(':');
    if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
      return parts.slice(2).join(':'); // rejoin in case UUID contains colons
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Create / Rename / Delete (Task 4.3)
  // ══════════════════════════════════════════════════════════════════════════

  private async _createPage(parentId?: string | null): Promise<void> {
    let page: IPage | null = null;
    try {
      // M77 Phase 1 — atomic page create + parent-block append. Replaces
      // the prior two-step `createPage` + `ensurePageBlockOnParent` flow
      // that left an orphan page on partial failure.
      page = await this._dataService.createChildPageWithBlock({
        parentId: parentId ?? null,
      });

      const createdPage = page;

      // Data change event will refresh tree; select the new page
      this._selectedPageId = createdPage.id;
      // Open in editor
      await this._api.editors.openEditor({
        typeId: 'canvas',
        title: createdPage.title,
        icon: createdPage.icon || undefined,
        instanceId: createdPage.id,
      });
      // Force-await the tree refresh so the new row is actually in the DOM before we
      // open the rename popup. The previous `requestAnimationFrame` raced the async
      // `_refreshTree` DB roundtrips, so `querySelector` returned null and the popup
      // (with auto-focused title) never opened.
      await this._refreshTree();
      const el = this._treeList?.querySelector(`[data-page-id="${createdPage.id}"]`);
      if (el) {
        const node = this._findNode(this._tree, createdPage.id);
        const pageRef = node ?? this._favoritedPages.find(page => page.id === createdPage.id) ?? null;
        if (pageRef) {
          this._showPageOptionsPopup(pageRef, (el as HTMLElement).getBoundingClientRect(), {
            focusTitle: true,
            selectTitle: true,
          });
        }
      }
    } catch (err) {
      // The atomic createChildPageWithBlock means we don't usually need
      // a rollback — if the transaction failed, neither the page nor
      // the parent block was written. But for any post-create failure
      // (editor open, tree refresh, popup) we still delete the orphan.
      if (page) {
        try { await this._dataService.deletePage(page.id); } catch { /* best-effort rollback */ }
      }
      this._surfaceError('Create page', err);
    }
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
    // M77 Phase 3/7 — start drag state with a frozen snapshot of the tree
    // so ancestry checks and drop-target validation can't be invalidated
    // by a concurrent DB event firing mid-drag.
    this._dragState.start(node.id, this._tree);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    }
  }

  private _onDragOver(e: DragEvent, row: HTMLElement, node: IPageTreeNode, _depth: number): void {
    const draggedPageId = this._dragState.getDraggedPageId();
    if (!draggedPageId || draggedPageId === node.id) return;

    // Prevent dropping onto own descendants. Uses the drag-time snapshot
    // (M77 Phase 3) so concurrent DB changes can't invalidate the check.
    if (this._dragState.isDescendantInSnapshot(draggedPageId, node.id)) return;

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
      this._dragState.setDropTarget({
        parentId: node.parentId,
        afterSiblingId: this._getPreviousSiblingId(node),
      });
    } else if (zone > 0.75) {
      // Bottom quarter → insert after this node
      this._showDropLine(row, 'after');
      this._dragState.setDropTarget({
        parentId: node.parentId,
        afterSiblingId: node.id,
      });
    } else {
      // Middle → reparent as child
      row.classList.add('canvas-node--drag-over-reparent');
      this._dragOverElement = row;
      this._dragState.setDropTarget({
        parentId: node.id,
        afterSiblingId: undefined,
      });
    }
  }

  private _onDragLeave(row: HTMLElement): void {
    row.classList.remove('canvas-node--drag-over-reparent');
  }

  private _onDrop(e: DragEvent, row: HTMLElement): void {
    e.preventDefault();
    row.classList.remove('canvas-node--drag-over-reparent');
    this._clearDropIndicators();

    const draggedPageId = this._dragState.getDraggedPageId();
    const dropTarget = this._dragState.getDropTarget();
    if (!draggedPageId || !dropTarget) return;

    const pageId = draggedPageId;
    const { parentId: newParentId, afterSiblingId } = dropTarget;

    // M77 Phase 3 — read the old parent from the drag-time snapshot so
    // a concurrent DB event can't shift our view of where the page used
    // to be. The data service will read the canonical previous parent
    // from the DB anyway, but having a snapshot-consistent old parent
    // matters for any UI logic that wants to know.
    const oldParentId = this._dragState.getOldParentId(pageId);

    this._dragState.end();
    // Mark drop-in-flight so refreshes fired by the move's own DB events
    // are deferred until the async work completes.
    this._dragState.beginDrop();

    this._performDrop(pageId, oldParentId, newParentId, afterSiblingId)
      .catch((err) => {
        this._surfaceError('Move', err);
        // Force a tree refresh so the sidebar drops back to the real DB
        // state rather than showing the user's failed drop position.
        this._dragState.noteSuppressedRefresh();
      })
      .finally(() => {
        this._dragState.finishDrop();
        this._drainDeferredRefreshes();
      });
  }

  /**
   * Perform the drop: atomically move the page and sync pageBlock content
   * so old/new parents stay in sync with the DB hierarchy in one
   * transaction (M77 Phase 1).
   *
   * The `oldParentId` parameter is accepted only for legacy callsites;
   * `movePageWithBlocks` reads the actual previous parent from the DB so
   * a stale sidebar tree can't cause a removal on the wrong parent.
   */
  private async _performDrop(
    pageId: string,
    _oldParentId: string | null,
    newParentId: string | null,
    afterSiblingId: string | undefined,
  ): Promise<void> {
    await this._dataService.movePageWithBlocks({
      pageId,
      newParentId,
      afterSiblingId,
    });
  }

  private _onDragEnd(): void {
    this._dragState.end();
    this._clearDropIndicators();
    // Belt-and-suspenders: if dragend fires without a drop (e.g. ESC,
    // drop outside the sidebar), the drop-in-flight flag stays false
    // and the deferred refresh fires here. If a drop is in flight, its
    // .finally will drain refreshes when it completes.
    this._drainDeferredRefreshes();
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
        const node = this._findNode(this._tree, this._selectedPageId)
          ?? this._favoritedPages.find(page => page.id === this._selectedPageId)
          ?? null;
        if (node) {
          this._showPageOptionsPopup(node, (el as HTMLElement).getBoundingClientRect(), {
            focusTitle: true,
            selectTitle: true,
          });
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
