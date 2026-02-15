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

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IPageTreeNode } from './canvasTypes.js';
import { type CanvasDataService } from './canvasDataService.js';
import { $ } from '../../ui/dom.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const INDENT_PX = 20;
const DEFAULT_PAGE_ICON = '📄';

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
  private _container: HTMLElement | null = null;
  private _treeList: HTMLElement | null = null;
  private _selectedPageId: string | null = null;
  private _expandedIds = new Set<string>();
  private _tree: IPageTreeNode[] = [];

  // ── Drag-and-drop state ──
  private _draggedPageId: string | null = null;
  private _dropIndicator: HTMLElement | null = null;
  private _dropTarget: { parentId: string | null; afterSiblingId: string | undefined } | null = null;
  private _dragOverElement: HTMLElement | null = null;

  // ── Inline rename state ──
  private _renamingPageId: string | null = null;

  constructor(
    private readonly _dataService: CanvasDataService,
    private readonly _api: CanvasSidebarApi,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // View Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  createView(container: HTMLElement): IDisposable {
    container.classList.add('canvas-tree');
    this._container = container;

    // Toolbar with + button
    const toolbar = $('div.canvas-toolbar');
    const addBtn = $('button.canvas-toolbar-btn');
    addBtn.textContent = '+';
    addBtn.title = 'New Page';
    addBtn.addEventListener('click', () => this._createPage());
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    // Tree list container
    this._treeList = $('div.canvas-tree-list');
    this._treeList.tabIndex = 0;
    this._treeList.setAttribute('role', 'tree');
    container.appendChild(this._treeList);

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
        this._container = null;
        this._treeList = null;
        for (const d of this._disposables) d.dispose();
        this._disposables.length = 0;
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Tree Rendering
  // ══════════════════════════════════════════════════════════════════════════

  private async _refreshTree(): Promise<void> {
    try {
      this._tree = await this._dataService.getPageTree();
    } catch (err) {
      console.error('[CanvasSidebar] Failed to load page tree:', err);
      this._tree = [];
    }
    this._renderTree();
  }

  private _renderTree(): void {
    if (!this._treeList) return;
    this._treeList.innerHTML = '';

    if (this._tree.length === 0) {
      const empty = $('div.canvas-empty');
      empty.textContent = 'No pages yet.';
      const btn = $('button.canvas-empty-btn');
      btn.textContent = 'Click + to create one';
      btn.addEventListener('click', () => this._createPage());
      empty.appendChild($('br'));
      empty.appendChild(btn);
      this._treeList.appendChild(empty);
      return;
    }

    for (const node of this._tree) {
      this._renderNode(this._treeList, node, 0);
    }
  }

  private _renderNode(parent: HTMLElement, node: IPageTreeNode, depth: number): void {
    const row = $('div.canvas-node');
    row.setAttribute('role', 'treeitem');
    row.setAttribute('data-page-id', node.id);
    row.style.paddingLeft = `${depth * INDENT_PX}px`;
    row.draggable = true;

    const hasChildren = node.children.length > 0;
    const isExpanded = this._expandedIds.has(node.id);

    // Chevron
    if (hasChildren) {
      const chevron = $('span.canvas-node-chevron');
      chevron.textContent = '▶';
      if (isExpanded) chevron.classList.add('canvas-node-chevron--expanded');
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleExpand(node.id);
      });
      row.appendChild(chevron);
    } else {
      row.appendChild($('span.canvas-node-spacer'));
    }

    // Icon
    const icon = $('span.canvas-node-icon');
    icon.textContent = node.icon || DEFAULT_PAGE_ICON;
    row.appendChild(icon);

    // Label
    const label = $('span.canvas-node-label');
    label.textContent = node.title;
    row.appendChild(label);

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
        this._renderNode(childrenEl, child, depth + 1);
      }
      parent.appendChild(childrenEl);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Selection & Editor Opening (Task 4.2)
  // ══════════════════════════════════════════════════════════════════════════

  private async _selectAndOpenPage(node: IPageTreeNode): Promise<void> {
    this._selectedPageId = node.id;
    this._renderTree();

    try {
      await this._api.editors.openEditor({
        typeId: 'canvas',
        title: node.title,
        icon: node.icon || DEFAULT_PAGE_ICON,
        instanceId: node.id,
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
        icon: page.icon || DEFAULT_PAGE_ICON,
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

    const input = document.createElement('input');
    input.className = 'canvas-inline-input';
    input.type = 'text';
    input.value = node.title;

    // Replace label with input
    label.style.display = 'none';
    row.appendChild(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newTitle = input.value.trim() || 'Untitled';
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
      input.removeEventListener('blur', commit);
      input.removeEventListener('keydown', onKeydown);
      if (input.parentElement) input.remove();
      label.style.display = '';
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', onKeydown);
  }

  private async _deletePage(pageId: string): Promise<void> {
    const page = await this._dataService.getPage(pageId);
    if (!page) return;

    const result = await this._api.window.showWarningMessage(
      `Delete "${page.title}"? This cannot be undone.`,
      { title: 'Delete' },
      { title: 'Cancel' },
    );
    if (result?.title !== 'Delete') return;

    try {
      await this._dataService.deletePage(pageId);
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
}
