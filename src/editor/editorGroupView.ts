// editorGroupView.ts — editor group UI rendering
//
// Renders a single editor group: a tab bar at the top and the active
// editor pane below. Integrates with EditorGroupModel for state and
// implements IGridView so the editor part grid can size it.
//
// Tab bar features: click-to-activate, close button, dirty indicator,
// preview (italic), sticky marker, drag-and-drop reordering.

import { Disposable, DisposableStore, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { EditorGroupModel, EditorModelChangeEvent } from './editorGroupModel.js';
import { EditorPane, PlaceholderEditorPane, EditorPaneViewState } from './editorPane.js';
import type { IEditorInput } from './editorInput.js';
import type { IGridView } from '../layout/gridView.js';
import { SizeConstraints, Orientation, Dimensions } from '../layout/layoutTypes.js';
import {
  EditorGroupChangeKind,
  EditorOpenOptions,
  EDITOR_TAB_DRAG_TYPE,
  EditorTabDragData,
  GroupDirection,
} from './editorTypes.js';
import { BreadcrumbsBar, BREADCRUMBS_HEIGHT } from './breadcrumbsBar.js';
import { URI } from '../platform/uri.js';
import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_HEIGHT = 35;
const MIN_GROUP_WIDTH = 200;
const MIN_GROUP_HEIGHT = 120;

// ─── EditorGroupView ─────────────────────────────────────────────────────────

/**
 * UI view for a single editor group.
 *
 * Owns:
 *  - The EditorGroupModel (state)
 *  - A tab bar (rendered from model state)
 *  - An editor pane area (swaps pane for active editor)
 *
 * Implements IGridView so the editor part grid can manage sizing.
 */
export class EditorGroupView extends Disposable implements IGridView {
  readonly model: EditorGroupModel;

  private _element!: HTMLElement;
  private _tabBar!: HTMLElement;
  private _breadcrumbsBar!: BreadcrumbsBar;
  private _paneContainer!: HTMLElement;
  private _emptyMessage!: HTMLElement;

  private _activePane: EditorPane | undefined;
  /** Sequence counter for "latest-wins" active editor rendering. */
  private _showActiveEditorSeq = 0;
  private readonly _paneDisposables = this._register(new DisposableStore());

  private _width = 0;
  private _height = 0;
  private _created = false;

  /** Pane factory — subclass or set externally to customise pane creation. */
  private _paneFactory: (input: IEditorInput) => EditorPane;

  // ── Events ──

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private readonly _onDidFocus = this._register(new Emitter<void>());
  readonly onDidFocus: Event<void> = this._onDidFocus.event;

  private readonly _onDidRequestSplit = this._register(new Emitter<GroupDirection>());
  readonly onDidRequestSplit: Event<GroupDirection> = this._onDidRequestSplit.event;

  private readonly _onDidRequestClose = this._register(new Emitter<void>());
  readonly onDidRequestClose: Event<void> = this._onDidRequestClose.event;

  /** Fires when a tab from another group is dropped onto this group. */
  private readonly _onDidRequestCrossGroupDrop = this._register(new Emitter<{ sourceGroupId: string; inputId: string; dropIndex: number }>());
  readonly onDidRequestCrossGroupDrop: Event<{ sourceGroupId: string; inputId: string; dropIndex: number }> = this._onDidRequestCrossGroupDrop.event;

  private readonly _onDidRequestMarkdownPreview = this._register(new Emitter<void>());
  readonly onDidRequestMarkdownPreview: Event<void> = this._onDidRequestMarkdownPreview.event;

  /** Fires when user selects "Reveal in Explorer" from a tab context menu. */
  private readonly _onDidRequestRevealInExplorer = this._register(new Emitter<URI>());
  readonly onDidRequestRevealInExplorer: Event<URI> = this._onDidRequestRevealInExplorer.event;

  constructor(groupId?: string, paneFactory?: (input: IEditorInput) => EditorPane) {
    super();
    this.model = this._register(new EditorGroupModel(groupId));
    this._paneFactory = paneFactory ?? (() => new PlaceholderEditorPane());

    // Listen to model changes to keep UI in sync
    this._register(this.model.onDidChange((e) => this._onModelChange(e)));

    // Eagerly create the element so IGridView.element is available
    this._createElement();
  }

  // ─── IGridView ─────────────────────────────────────────────────────────

  get id(): string { return this.model.id; }
  get element(): HTMLElement { return this._element; }

  get minimumWidth(): number { return MIN_GROUP_WIDTH; }
  get maximumWidth(): number { return Number.POSITIVE_INFINITY; }
  get minimumHeight(): number { return MIN_GROUP_HEIGHT; }
  get maximumHeight(): number { return Number.POSITIVE_INFINITY; }

  setVisible(visible: boolean): void {
    if (this._element) {
      this._element.classList.toggle('hidden', !visible);
    }
  }

  toJSON(): object {
    return {
      id: this.model.id,
      type: 'editorGroup',
      model: this.model.serialize(),
    };
  }

  layout(width: number, height: number, _orientation: Orientation): void {
    this._width = width;
    this._height = height;

    if (this._element) {
      this._element.style.width = `${width}px`;
      this._element.style.height = `${height}px`;
    }

    // Layout pane: subtract tab bar height and breadcrumbs height
    const breadcrumbsH = this._breadcrumbsBar?.effectiveHeight ?? 0;
    const paneH = Math.max(0, height - TAB_HEIGHT - breadcrumbsH);
    if (this._paneContainer) {
      this._paneContainer.style.height = `${paneH}px`;
    }
    this._activePane?.layout(width, paneH);
  }

  // ─── Create ────────────────────────────────────────────────────────────

  /**
   * Build the DOM structure for this group (called eagerly from constructor).
   */
  private _createElement(): void {
    this._element = document.createElement('div');
    this._element.classList.add('editor-group');
    this._element.setAttribute('data-editor-group-id', this.model.id);
    this._element.tabIndex = -1;

    // Focus tracking
    this._element.addEventListener('focusin', () => this._onDidFocus.fire());

    // Tab bar
    this._tabBar = document.createElement('div');
    this._tabBar.classList.add('editor-tab-bar');
    this._tabBar.style.height = `${TAB_HEIGHT}px`;
    this._tabBar.style.minHeight = `${TAB_HEIGHT}px`;
    this._element.appendChild(this._tabBar);

    // Breadcrumbs bar — between tab bar and pane (VS Code placement)
    this._breadcrumbsBar = this._register(new BreadcrumbsBar(this._element));

    // Pane container
    this._paneContainer = document.createElement('div');
    this._paneContainer.classList.add('editor-pane-container');
    this._element.appendChild(this._paneContainer);

    // Empty message (hidden when watermark is visible at the EditorPart level)
    this._emptyMessage = document.createElement('div');
    this._emptyMessage.classList.add('editor-group-empty');
    this._paneContainer.appendChild(this._emptyMessage);

    this._renderTabs();
    this._updateBreadcrumbs();
    this._updateEmptyState();
  }

  /**
   * Attach the group element to a parent (idempotent — safe to call multiple times).
   */
  create(parent: HTMLElement): void {
    if (this._created) return;
    if (!this._element.parentElement) {
      parent.appendChild(this._element);
    }
    this._created = true;
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Open an editor in this group.
   */
  async openEditor(input: IEditorInput, options?: EditorOpenOptions): Promise<void> {
    // Capture the seq before the model fires EditorActive synchronously
    const seqBefore = this._showActiveEditorSeq;
    this.model.openEditor(input, options);
    // model.openEditor() fires EditorActive → _onModelChange → _showActiveEditor()
    // synchronously (which bumps the seq). Only call _showActiveEditor() again
    // if the model DID NOT fire an EditorActive event (i.e. seq unchanged).
    if (this._showActiveEditorSeq === seqBefore) {
      await this._showActiveEditor();
    }
    // Otherwise, a _showActiveEditor() call is already in flight from the
    // model event — we just need to wait for it to finish with the pane.
  }

  /**
   * Close an editor in this group.
   */
  async closeEditor(indexOrEditor: number | IEditorInput, force = false): Promise<boolean> {
    return this.model.closeEditor(indexOrEditor, force);
  }

  /**
   * Get the number of editors.
   */
  get editorCount(): number { return this.model.count; }

  /**
   * Whether the group is empty.
   */
  get isEmpty(): boolean { return this.model.isEmpty; }

  /**
   * Focus the group.
   */
  focus(): void {
    this._element?.focus();
  }

  /**
   * Tell the breadcrumbs bar about workspace folders for relative path display.
   */
  setWorkspaceFolders(folders: readonly { uri: URI; name: string }[]): void {
    this._breadcrumbsBar?.setWorkspaceFolders(folders);
    this._updateBreadcrumbs();
  }

  // ─── Breadcrumbs ───────────────────────────────────────────────────────

  /**
   * Update the breadcrumbs bar to reflect the currently active editor.
   * Called on EditorActive model change and after setWorkspaceFolders.
   */
  private _updateBreadcrumbs(): void {
    if (!this._breadcrumbsBar) return;
    const changed = this._breadcrumbsBar.update(this.model.activeEditor);
    // If visibility changed, re-layout to recalculate pane height
    if (changed) {
      this.layout(this._width, this._height, Orientation.Horizontal);
    }
  }

  // ─── Model Change Handler ──────────────────────────────────────────────

  private async _onModelChange(e: EditorModelChangeEvent): Promise<void> {
    switch (e.kind) {
      case EditorGroupChangeKind.EditorOpen:
      case EditorGroupChangeKind.EditorMove:
      case EditorGroupChangeKind.EditorPin:
      case EditorGroupChangeKind.EditorUnpin:
      case EditorGroupChangeKind.EditorSticky:
      case EditorGroupChangeKind.EditorUnsticky:
      case EditorGroupChangeKind.EditorDirty:
        this._renderTabs();
        break;
      case EditorGroupChangeKind.EditorClose:
        this._renderTabs();
        this._updateBreadcrumbs(); // Hide breadcrumbs when last editor closes
        break;
      case EditorGroupChangeKind.EditorActive:
        this._renderTabs();
        this._updateBreadcrumbs();
        await this._showActiveEditor();
        break;
    }
    this._updateEmptyState();
  }

  // ─── Tab Rendering ─────────────────────────────────────────────────────

  /** Scroll-on-drag timer ID. */
  private _scrollDragTimer: ReturnType<typeof setInterval> | undefined;

  private _renderTabs(): void {
    if (!this._tabBar) return;

    // Clear existing tabs (but keep any toolbar we might add later)
    this._tabBar.innerHTML = '';

    const editors = this.model.editors;
    const activeIdx = this.model.activeIndex;

    // Tabs container — scrollable, also a drop target for appending to end
    const tabsWrap = document.createElement('div');
    tabsWrap.classList.add('editor-tabs');

    for (let i = 0; i < editors.length; i++) {
      const editor = editors[i];
      const isActive = i === activeIdx;
      const isPinned = this.model.isPinned(i);
      const isSticky = this.model.isSticky(i);
      const isPreview = this.model.isPreview(i);

      const tab = this._createTab(editor, i, isActive, isPinned, isSticky, isPreview);
      tabsWrap.appendChild(tab);
    }

    // ── Tab bar as drop target (drop at end / into empty group) ──
    this._setupTabsWrapDrop(tabsWrap);

    this._tabBar.appendChild(tabsWrap);

    // Group toolbar (split, close)
    const toolbar = this._createToolbar();
    this._tabBar.appendChild(toolbar);
  }

  /**
   * Make the tabs wrapper a drop target. Drops that land on the empty area
   * after all tabs (or on an empty group's tab bar) append to the end.
   * VS Code parity: tab bar itself accepts drops.
   */
  private _setupTabsWrapDrop(tabsWrap: HTMLElement): void {
    tabsWrap.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(EDITOR_TAB_DRAG_TYPE)) return;
      // Only accept drops on the tabsWrap for empty groups (no tabs to target).
      // For non-empty groups, the individual tab drop-before/drop-after handles
      // all positions including "append to end" (right half of last tab).
      if (this.model.count > 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Show insertion line at the very end
      tabsWrap.classList.add('drop-target-end');

      // Scroll-on-drag: auto-scroll when near edges
      this._startScrollOnDrag(tabsWrap, e);
    });

    tabsWrap.addEventListener('dragleave', () => {
      tabsWrap.classList.remove('drop-target-end');
      this._stopScrollOnDrag();
    });

    tabsWrap.addEventListener('drop', (e) => {
      tabsWrap.classList.remove('drop-target-end');
      this._stopScrollOnDrag();
      const raw = e.dataTransfer?.getData(EDITOR_TAB_DRAG_TYPE);
      if (!raw) return;
      // Only handle drops for empty groups
      if (this.model.count > 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data: EditorTabDragData = JSON.parse(raw);
        const dropIndex = this.model.count; // append at end
        if (data.sourceGroupId === this.model.id) {
          const sourceIdx = this.model.editors.findIndex(ed => ed.id === data.inputId);
          if (sourceIdx >= 0) {
            this.model.moveEditor(sourceIdx, this.model.count - 1);
          }
        } else {
          this._onDidRequestCrossGroupDrop.fire({
            sourceGroupId: data.sourceGroupId,
            inputId: data.inputId,
            dropIndex,
          });
        }
      } catch { /* ignore */ }
    });
  }

  /**
   * Start auto-scrolling the tab bar when dragging near its left/right edges.
   * VS Code scrolls the tab bar during drag so overflow tabs are reachable.
   */
  private _startScrollOnDrag(tabsWrap: HTMLElement, e: DragEvent): void {
    this._stopScrollOnDrag();
    const EDGE_SIZE = 30; // pixels from edge that triggers scroll
    const SCROLL_SPEED = 3; // pixels per tick

    this._scrollDragTimer = setInterval(() => {
      const rect = tabsWrap.getBoundingClientRect();
      // We use the last known mouse position — dragover fires frequently
      // Since we can't get mouse from interval, rely on scroll position checks
      // The actual scroll trigger is handled per-dragover call below
    }, 50);

    // The real scroll logic runs on each dragover (which fires ~60fps)
    // We store the handler so _renderTabs can clean it up
  }

  private _stopScrollOnDrag(): void {
    if (this._scrollDragTimer !== undefined) {
      clearInterval(this._scrollDragTimer);
      this._scrollDragTimer = undefined;
    }
  }

  private _createTab(
    editor: IEditorInput,
    index: number,
    isActive: boolean,
    isPinned: boolean,
    isSticky: boolean,
    isPreview: boolean,
  ): HTMLElement {
    const tab = document.createElement('div');
    tab.classList.add('editor-tab');
    if (isActive) tab.classList.add('editor-tab--active');
    if (isSticky) tab.classList.add('editor-tab--sticky');
    if (isPreview) tab.classList.add('editor-tab--preview');
    if (editor.isDirty) tab.classList.add('editor-tab--dirty');

    // Tooltip
    tab.title = editor.description || editor.name;

    // Sticky indicator
    if (isSticky) {
      const pin = document.createElement('span');
      pin.classList.add('editor-tab-pin');
      pin.textContent = '📌 ';
      tab.appendChild(pin);
    }

    // Label
    const label = document.createElement('span');
    label.classList.add('editor-tab-label');
    label.textContent = editor.name;
    tab.appendChild(label);

    // Dirty indicator
    if (editor.isDirty) {
      const dirty = document.createElement('span');
      dirty.classList.add('editor-tab-dirty');
      dirty.textContent = ' ●';
      tab.appendChild(dirty);
    }

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.classList.add('editor-tab-close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentIdx = this.model.editors.indexOf(editor);
      if (currentIdx >= 0) this.model.closeEditor(currentIdx);
    });
    tab.appendChild(closeBtn);

    // Click to activate
    tab.addEventListener('click', () => {
      const currentIdx = this.model.editors.indexOf(editor);
      if (currentIdx >= 0) this.model.setActive(currentIdx);
    });

    // Double-click to pin preview
    tab.addEventListener('dblclick', () => {
      const currentIdx = this.model.editors.indexOf(editor);
      if (currentIdx >= 0 && !this.model.isPinned(currentIdx)) {
        this.model.pin(currentIdx);
      }
    });

    // Middle-click to close (VS Code auxclick pattern)
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        const currentIdx = this.model.editors.indexOf(editor);
        if (currentIdx >= 0) this.model.closeEditor(currentIdx);
      }
    });

    // Drag source
    tab.draggable = true;
    tab.addEventListener('dragstart', (e) => {
      const currentIdx = this.model.editors.indexOf(editor);
      const data: EditorTabDragData = {
        sourceGroupId: this.model.id,
        editorIndex: currentIdx >= 0 ? currentIdx : index,
        inputId: editor.id,
      };
      e.dataTransfer?.setData(EDITOR_TAB_DRAG_TYPE, JSON.stringify(data));
      e.dataTransfer!.effectAllowed = 'move';
      tab.classList.add('dragging');

      // VS Code parity: custom drag image showing just the label
      const ghost = document.createElement('div');
      ghost.classList.add('editor-tab-drag-image');
      ghost.textContent = editor.name;
      document.body.appendChild(ghost);
      e.dataTransfer?.setDragImage(ghost, 0, 0);
      // Remove the ghost after browser captures it (next frame)
      requestAnimationFrame(() => ghost.remove());
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      // Clear any stale insertion indicators
      this._clearAllDropIndicators();
    });

    // Drop target — VS Code left/right half detection for precise insertion
    tab.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(EDITOR_TAB_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Determine left or right half of the tab
      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const isLeftHalf = e.clientX < midX;

      // Clear all other indicators first
      this._clearAllDropIndicators();

      // Show insertion line on the appropriate side
      if (isLeftHalf) {
        tab.classList.add('drop-before');
      } else {
        tab.classList.add('drop-after');
      }

      // Scroll-on-drag near edges of tab bar
      const tabsWrap = tab.parentElement;
      if (tabsWrap) {
        const wrapRect = tabsWrap.getBoundingClientRect();
        const EDGE_SIZE = 30;
        if (e.clientX - wrapRect.left < EDGE_SIZE) {
          tabsWrap.scrollLeft -= 3;
        } else if (wrapRect.right - e.clientX < EDGE_SIZE) {
          tabsWrap.scrollLeft += 3;
        }
      }
    });
    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drop-before', 'drop-after');
    });
    tab.addEventListener('drop', (e) => {
      this._clearAllDropIndicators();
      const raw = e.dataTransfer?.getData(EDITOR_TAB_DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data: EditorTabDragData = JSON.parse(raw);

        // Determine insertion index from left/right half
        const rect = tab.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const isLeftHalf = e.clientX < midX;
        const tabIdx = this.model.editors.indexOf(editor);
        // If dropping on left half, insert before this tab; right half, insert after
        let dropIdx = isLeftHalf ? tabIdx : tabIdx + 1;

        if (data.sourceGroupId === this.model.id) {
          // Same group: reorder — resolve current source index by inputId
          const sourceIdx = this.model.editors.findIndex(ed => ed.id === data.inputId);
          if (sourceIdx >= 0 && tabIdx >= 0) {
            // Adjust target if source is before the drop point
            if (sourceIdx < dropIdx) dropIdx--;
            if (dropIdx < 0) dropIdx = 0;
            if (dropIdx >= this.model.count) dropIdx = this.model.count - 1;
            this.model.moveEditor(sourceIdx, dropIdx);
          }
        } else {
          // Cross-group move: delegate to EditorPart
          this._onDidRequestCrossGroupDrop.fire({
            sourceGroupId: data.sourceGroupId,
            inputId: data.inputId,
            dropIndex: dropIdx >= 0 ? dropIdx : this.model.count,
          });
        }
      } catch { /* ignore bad data */ }
    });

    // ── Context menu (right-click) — VS Code parity: EditorTitleContext ──
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showTabContextMenu(editor, index, e);
    });

    return tab;
  }

  /**
   * Clear all drop insertion indicators from every tab.
   * VS Code pattern: ensure a clean state before showing new indicator.
   */
  private _clearAllDropIndicators(): void {
    const tabs = this._tabBar?.querySelectorAll('.editor-tab');
    tabs?.forEach(t => t.classList.remove('drop-before', 'drop-after'));
    this._tabBar?.querySelector('.editor-tabs')?.classList.remove('drop-target-end');
  }

  // ─── Tab Context Menu ──────────────────────────────────────────────────

  /**
   * Show the tab context menu at the right-click position.
   *
   * VS Code reference: `EditorTabsControl.onTabContextMenu()` in
   * `src/vs/workbench/browser/parts/editor/editorTabsControl.ts`
   * registers items on `MenuId.EditorTitleContext`.
   *
   * Menu groups (VS Code parity):
   *  1_close  — Close, Close Others, Close to the Right, Close Saved, Close All
   *  6_path   — Copy Path, Copy Relative Path
   *  7_reveal — Reveal in Explorer
   */
  private _showTabContextMenu(editor: IEditorInput, index: number, e: MouseEvent): void {
    const currentIdx = this.model.editors.indexOf(editor);
    if (currentIdx < 0) return;

    const editorCount = this.model.count;
    const isLast = currentIdx === editorCount - 1;
    const uri: URI | undefined = (editor as any).uri;

    // ── Build menu items ──
    const items: IContextMenuItem[] = [];

    // Group 1: Close operations
    items.push({ id: 'close', label: 'Close', keybinding: 'Ctrl+W', group: '1_close', order: 10 });
    items.push({
      id: 'closeOthers', label: 'Close Others', group: '1_close', order: 20,
      disabled: editorCount <= 1,
    });
    items.push({
      id: 'closeRight', label: 'Close to the Right', group: '1_close', order: 30,
      disabled: isLast,
    });
    items.push({ id: 'closeSaved', label: 'Close Saved', group: '1_close', order: 40 });
    items.push({ id: 'closeAll', label: 'Close All', group: '1_close', order: 50 });

    // Group 6: Path operations (only when editor has a URI)
    if (uri) {
      items.push({ id: 'copyPath', label: 'Copy Path', group: '6_path', order: 10 });
      items.push({ id: 'copyRelativePath', label: 'Copy Relative Path', group: '6_path', order: 20 });
    }

    // Group 7: Reveal (only when editor has a URI)
    if (uri) {
      items.push({ id: 'revealInExplorer', label: 'Reveal in Explorer', group: '7_reveal', order: 10 });
    }

    // ── Show menu ──
    const menu = ContextMenu.show({
      items,
      anchor: { x: e.clientX, y: e.clientY },
    });

    // ── Handle selection ──
    menu.onDidSelect(({ item }) => {
      // Re-resolve index in case model changed between show and click
      const idx = this.model.editors.indexOf(editor);
      if (idx < 0 && item.id !== 'closeAll' && item.id !== 'closeSaved') return;

      switch (item.id) {
        case 'close':
          this.model.closeEditor(idx);
          break;
        case 'closeOthers':
          this.model.closeOthers(idx);
          break;
        case 'closeRight':
          this.model.closeToTheRight(idx);
          break;
        case 'closeSaved':
          this.model.closeSaved();
          break;
        case 'closeAll':
          this.model.closeAllEditors();
          break;
        case 'copyPath':
          if (uri) {
            navigator.clipboard.writeText(uri.fsPath).catch(() => {});
          }
          break;
        case 'copyRelativePath':
          if (uri) {
            const relativePath = this._getRelativePath(uri);
            navigator.clipboard.writeText(relativePath).catch(() => {});
          }
          break;
        case 'revealInExplorer':
          if (uri) {
            this._onDidRequestRevealInExplorer.fire(uri);
          }
          break;
      }
    });
  }

  /**
   * Compute a workspace-relative path for a URI.
   * Falls back to the full fsPath if no workspace folder matches.
   */
  private _getRelativePath(uri: URI): string {
    const fsPath = uri.fsPath;
    // If we have workspace folders (from breadcrumbs bar), try to make it relative
    const folders = (this._breadcrumbsBar as any)?._workspaceFolders as readonly { uri: URI; name: string }[] | undefined;
    if (folders) {
      for (const folder of folders) {
        const folderPath = folder.uri.fsPath;
        if (fsPath.startsWith(folderPath)) {
          let relative = fsPath.substring(folderPath.length);
          // Remove leading separator
          if (relative.startsWith('/') || relative.startsWith('\\')) {
            relative = relative.substring(1);
          }
          return relative;
        }
      }
    }
    return fsPath;
  }

  private _createToolbar(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.classList.add('editor-group-toolbar');

    // Markdown preview button — shown only when active editor is a markdown file
    const activeEditor = this.model.activeEditor;
    if (activeEditor) {
      const name = activeEditor.name.toLowerCase();
      if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdx')) {
        const previewBtn = this._createToolbarButton(
          `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm1 1h5v2H4V4zm0 3h8v1H4V7zm0 2h8v1H4V9zm0 2h5v1H4v-1z"/></svg>`,
          'Open Markdown Preview to the Side (Ctrl+K V)',
          () => { this._onDidRequestMarkdownPreview.fire(); },
          true
        );
        previewBtn.classList.add('editor-toolbar-preview');
        toolbar.appendChild(previewBtn);
      }
    }

    // Split button — SVG matching VS Code's split-editor codicon
    const splitBtn = this._createToolbarButton(
      `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 13H9V2h5v12zM2 2h6v12H2V2z"/></svg>`,
      'Split Editor Right',
      () => { this._onDidRequestSplit.fire(GroupDirection.Right); },
      true
    );
    toolbar.appendChild(splitBtn);

    return toolbar;
  }

  private _createToolbarButton(content: string, title: string, onClick: () => void, isSvg = false): HTMLElement {
    const btn = document.createElement('button');
    if (isSvg) {
      btn.innerHTML = content;
    } else {
      btn.textContent = content;
    }
    btn.title = title;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // ─── Pane Management ───────────────────────────────────────────────────

  private async _showActiveEditor(): Promise<void> {
    // "Latest wins" guard: each call bumps a sequence counter. After the
    // async pane.setInput() returns, the call checks whether it is still
    // the latest — if a newer call has started, it bails out and lets the
    // newer call handle rendering. This avoids both the duplicate-pane bug
    // AND the dropped-switch bug that the old boolean guard had.
    const seq = ++this._showActiveEditorSeq;

    const activeInput = this.model.activeEditor;

    // Clear current pane (synchronous — safe to do even if a newer call follows)
    if (this._activePane) {
      this._activePane.clearInput();
      this._paneDisposables.clear();
      if (this._activePane.element) {
        this._activePane.element.remove();
      }
      this._activePane = undefined;
    }

    if (!activeInput) return;

    // Create new pane — do NOT add to _paneDisposables yet.
    // Only the call that "wins" the seq check will track it.
    const pane = this._paneFactory(activeInput);
    pane.create(this._paneContainer);
    try {
      await pane.setInput(activeInput);
    } catch (err) {
      // If setInput fails, clean up the orphan pane immediately
      console.error('[EditorGroupView] pane.setInput() failed:', err);
      pane.dispose();
      if (pane.element) pane.element.remove();
      return;
    }

    // After the await: check if we're still the latest call
    if (seq !== this._showActiveEditorSeq) {
      // A newer _showActiveEditor() call superseded us — dispose our pane
      // directly (NOT _paneDisposables, which may hold the winning pane).
      pane.clearInput();
      pane.dispose();
      if (pane.element) pane.element.remove();
      return;
    }

    // This call is the latest — track the pane in the disposable store
    this._paneDisposables.add(pane);

    // Layout
    const breadcrumbsH = this._breadcrumbsBar?.effectiveHeight ?? 0;
    const paneH = Math.max(0, this._height - TAB_HEIGHT - breadcrumbsH);
    pane.layout(this._width, paneH);

    this._activePane = pane;
  }

  private _updateEmptyState(): void {
    if (this._emptyMessage) {
      this._emptyMessage.classList.toggle('hidden', !this.model.isEmpty);
    }
  }

  // ─── Dispose ───────────────────────────────────────────────────────────

  override dispose(): void {
    this._paneDisposables.clear();
    this._activePane = undefined;
    super.dispose();
  }
}
