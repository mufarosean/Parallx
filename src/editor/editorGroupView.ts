// editorGroupView.ts — editor group UI rendering
//
// Renders a single editor group: a tab bar at the top and the active
// editor pane below. Integrates with EditorGroupModel for state and
// implements IGridView so the editor part grid can size it.
//
// Tab bar: delegates to `ui/TabBar` for rendering, DnD, scrolling,
// and events. EditorGroupView maps the model to `ITabBarItem[]` and
// wires TabBar events back to the model.

import { Disposable, DisposableStore, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { EditorGroupModel, EditorModelChangeEvent } from './editorGroupModel.js';
import { EditorPane, PlaceholderEditorPane } from './editorPane.js';
import type { IEditorInput } from './editorInput.js';
import type { IGridView } from '../layout/gridView.js';
import { Orientation } from '../layout/layoutTypes.js';
import {
  EditorGroupChangeKind,
  EditorOpenOptions,
  EDITOR_TAB_DRAG_TYPE,
  EditorTabDragData,
  GroupDirection,
} from './editorTypes.js';
import { BreadcrumbsBar } from './breadcrumbsBar.js';
import { URI } from '../platform/uri.js';
import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';
import { TabBar, type ITabBarItem } from '../ui/tabBar.js';
import { $ } from '../ui/dom.js';

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
  private _tabs!: TabBar;
  private _ribbonContainer!: HTMLElement;
  private _breadcrumbsBar!: BreadcrumbsBar;
  private _ribbonDisposable: IDisposable | undefined;
  private _paneContainer!: HTMLElement;
  private _emptyMessage!: HTMLElement;
  private _workspaceFolders: readonly { uri: URI; name: string }[] = [];

  private _activePane: EditorPane | undefined;
  /** Sequence counter for "latest-wins" active editor rendering. */
  private _showActiveEditorSeq = 0;

  /** The currently active editor pane (if any). */
  get activePane(): EditorPane | undefined { return this._activePane; }
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

  /**
   * Fires after the active pane has been fully swapped (after async setInput).
   * Consumers can safely read `activePane` when this fires.
   */
  private readonly _onDidActivePaneChange = this._register(new Emitter<EditorPane | undefined>());
  readonly onDidActivePaneChange: Event<EditorPane | undefined> = this._onDidActivePaneChange.event;

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

    // Layout pane: subtract tab bar height and ribbon height
    const ribbonH = this._getRibbonHeight();
    const paneH = Math.max(0, height - TAB_HEIGHT - ribbonH);
    if (this._paneContainer) {
      this._paneContainer.style.height = `${paneH}px`;
    }
    this._activePane?.layout(width, paneH);
  }

  /**
   * Current ribbon height: custom ribbon uses offsetHeight (auto-sized),
   * default breadcrumbs uses the BreadcrumbsBar's known effective height,
   * hidden ribbon returns 0.
   */
  private _getRibbonHeight(): number {
    if (!this._ribbonContainer || this._ribbonContainer.classList.contains('hidden')) {
      return 0;
    }
    // Custom ribbon is sized by its content
    if (this._ribbonDisposable) {
      return this._ribbonContainer.offsetHeight || 0;
    }
    // Default breadcrumbs bar
    return this._breadcrumbsBar?.effectiveHeight ?? 0;
  }

  // ─── Create ────────────────────────────────────────────────────────────

  /**
   * Build the DOM structure for this group (called eagerly from constructor).
   */
  private _createElement(): void {
    this._element = $('div');
    this._element.classList.add('editor-group');
    this._element.setAttribute('data-editor-group-id', this.model.id);
    this._element.tabIndex = -1;

    // Focus tracking
    this._element.addEventListener('focusin', () => this._onDidFocus.fire());

    // Tab bar — delegates to ui/TabBar component
    const tabBarHost = $('div');
    tabBarHost.classList.add('editor-tab-bar');
    tabBarHost.style.height = `${TAB_HEIGHT}px`;
    tabBarHost.style.minHeight = `${TAB_HEIGHT}px`;
    this._element.appendChild(tabBarHost);

    this._tabs = this._register(new TabBar(tabBarHost, {
      reorderable: true,
      dragType: EDITOR_TAB_DRAG_TYPE,
      scrollable: true,
      showActions: true,
      dragDataFactory: (id) => {
        const idx = this.model.editors.findIndex(e => e.id === id);
        const data: EditorTabDragData = {
          sourceGroupId: this.model.id,
          editorIndex: idx >= 0 ? idx : 0,
          inputId: id,
        };
        return JSON.stringify(data);
      },
    }));

    // Wire TabBar events → model
    this._register(this._tabs.onDidSelect((id) => {
      const idx = this.model.editors.findIndex(e => e.id === id);
      if (idx >= 0) this.model.setActive(idx);
    }));

    this._register(this._tabs.onDidClose((id) => {
      const idx = this.model.editors.findIndex(e => e.id === id);
      if (idx >= 0) this.model.closeEditor(idx);
    }));

    this._register(this._tabs.onDidDoubleClick((id) => {
      const idx = this.model.editors.findIndex(e => e.id === id);
      if (idx >= 0 && !this.model.isPinned(idx)) {
        this.model.pin(idx);
      }
    }));

    this._register(this._tabs.onDidMiddleClick((id) => {
      const idx = this.model.editors.findIndex(e => e.id === id);
      if (idx >= 0) this.model.closeEditor(idx);
    }));

    this._register(this._tabs.onDidContextMenu(({ id, event }) => {
      const idx = this.model.editors.findIndex(e => e.id === id);
      if (idx >= 0) this._showTabContextMenu(this.model.editors[idx], idx, event);
    }));

    this._register(this._tabs.onDidReorder(({ fromId, targetId, position }) => {
      const sourceIdx = this.model.editors.findIndex(e => e.id === fromId);
      const targetIdx = this.model.editors.findIndex(e => e.id === targetId);
      if (sourceIdx < 0 || targetIdx < 0) return;
      let dropIdx = position === 'before' ? targetIdx : targetIdx + 1;
      if (sourceIdx < dropIdx) dropIdx--;
      if (dropIdx < 0) dropIdx = 0;
      if (dropIdx >= this.model.count) dropIdx = this.model.count - 1;
      this.model.moveEditor(sourceIdx, dropIdx);
    }));

    this._register(this._tabs.onDidExternalDrop(({ event, targetId, position }) => {
      const raw = event.dataTransfer?.getData(EDITOR_TAB_DRAG_TYPE);
      if (!raw) return;
      try {
        const data: EditorTabDragData = JSON.parse(raw);
        let dropIndex: number;
        if (targetId) {
          const targetIdx = this.model.editors.findIndex(e => e.id === targetId);
          dropIndex = position === 'before' ? targetIdx : targetIdx + 1;
        } else {
          dropIndex = this.model.count;
        }
        if (dropIndex < 0) dropIndex = this.model.count;

        if (data.sourceGroupId === this.model.id) {
          // Same group (dropped from outside current set — shouldn't normally happen)
          const sourceIdx = this.model.editors.findIndex(ed => ed.id === data.inputId);
          if (sourceIdx >= 0) {
            let targetDrop = dropIndex;
            if (sourceIdx < targetDrop) targetDrop--;
            if (targetDrop < 0) targetDrop = 0;
            if (targetDrop >= this.model.count) targetDrop = this.model.count - 1;
            this.model.moveEditor(sourceIdx, targetDrop);
          }
        } else {
          this._onDidRequestCrossGroupDrop.fire({
            sourceGroupId: data.sourceGroupId,
            inputId: data.inputId,
            dropIndex,
          });
        }
      } catch { /* ignore bad data */ }
    }));

    // Unified ribbon container — between tab bar and pane.
    // Each editor type populates this: file editors get breadcrumbs,
    // canvas gets its own ribbon (breadcrumbs + timestamp + star + menu).
    this._ribbonContainer = $('div');
    this._ribbonContainer.classList.add('editor-ribbon');
    this._element.appendChild(this._ribbonContainer);

    // Default content: file-path breadcrumbs (hidden when custom ribbon is active)
    this._breadcrumbsBar = this._register(new BreadcrumbsBar(this._ribbonContainer));

    // When a breadcrumb segment is clicked, reveal it in Explorer
    this._register(this._breadcrumbsBar.onDidSelectSegment((segment) => {
      this._onDidRequestRevealInExplorer.fire(segment.uri);
    }));

    // Pane container
    this._paneContainer = $('div');
    this._paneContainer.classList.add('editor-pane-container');
    this._element.appendChild(this._paneContainer);

    // Empty message (hidden when watermark is visible at the EditorPart level)
    this._emptyMessage = $('div');
    this._emptyMessage.classList.add('editor-group-empty');
    this._paneContainer.appendChild(this._emptyMessage);

    this._renderTabs();
    this._updateRibbon(this.model.activeEditor);
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
    this._workspaceFolders = folders;
    this._breadcrumbsBar?.setWorkspaceFolders(folders);
    this._updateRibbon(this.model.activeEditor);
  }

  // ─── Ribbon ────────────────────────────────────────────────────────────

  /**
   * Update the ribbon to reflect the currently active editor.
   *
   * If the editor's tool provider implements `createRibbon()`, the ribbon
   * container is handed to the provider for custom content. Otherwise the
   * default file-path BreadcrumbsBar fills the ribbon.
   *
   * Called on EditorActive model change, setWorkspaceFolders, and after
   * the pane is swapped in _showActiveEditor.
   */
  private _updateRibbon(input: IEditorInput | undefined): void {
    // Dispose previous custom ribbon content
    if (this._ribbonDisposable) {
      this._ribbonDisposable.dispose();
      this._ribbonDisposable = undefined;
    }

    if (!input) {
      this._breadcrumbsBar.hide();
      this._ribbonContainer.classList.add('hidden');
      this.layout(this._width, this._height, Orientation.Horizontal);
      return;
    }

    // Check if the editor's provider offers a custom ribbon
    const provider = (input as any).provider;
    if (provider && typeof provider.createRibbon === 'function') {
      // Hide default breadcrumbs
      this._breadcrumbsBar.hide();
      // Provider fills the ribbon container
      this._ribbonDisposable = provider.createRibbon(this._ribbonContainer, input);
      this._ribbonContainer.classList.remove('hidden');
      this.layout(this._width, this._height, Orientation.Horizontal);
      return;
    }

    // Default: file-path breadcrumbs
    const changed = this._breadcrumbsBar.update(input);
    if (this._breadcrumbsBar.isVisible) {
      this._ribbonContainer.classList.remove('hidden');
    } else {
      this._ribbonContainer.classList.add('hidden');
    }
    if (changed) {
      this.layout(this._width, this._height, Orientation.Horizontal);
    }
  }

  // ─── Model Change Handler ──────────────────────────────────────────────

  private async _onModelChange(e: EditorModelChangeEvent): Promise<void> {
    switch (e.kind) {
      case EditorGroupChangeKind.EditorOpen: {
        // Subscribe to label changes so tab updates when name changes
        const editor = this.model.editors[this.model.editors.length - 1];
        if (editor) {
          this._register(editor.onDidChangeLabel(() => this._renderTabs()));
        }
        this._renderTabs();
        break;
      }
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
        this._updateRibbon(this.model.activeEditor); // Hide ribbon when last editor closes
        break;
      case EditorGroupChangeKind.EditorActive:
        this._renderTabs();
        await this._showActiveEditor();
        break;
    }
    this._updateEmptyState();
  }

  // ─── Tab Rendering ─────────────────────────────────────────────────────

  private _renderTabs(): void {
    if (!this._tabs) return;

    const editors = this.model.editors;
    const activeIdx = this.model.activeIndex;

    // Map model editors → ITabBarItem[]
    const items: ITabBarItem[] = editors.map((editor, i) => ({
      id: editor.id,
      label: editor.name,
      tooltip: editor.description || editor.name,
      italic: this.model.isPreview(i),
      stickyContent: this.model.isSticky(i) ? '📌 ' : undefined,
      decorations: {
        dirty: editor.isDirty,
        pinned: this.model.isSticky(i),
      },
    }));

    this._tabs.setItems(items);

    // Set active tab
    const activeEditor = editors[activeIdx];
    if (activeEditor) {
      this._tabs.setActive(activeEditor.id);
      this._tabs.scrollToActive();
    }

    // Rebuild toolbar in the actions slot
    const actionsSlot = this._tabs.getActionsContainer();
    if (actionsSlot) {
      actionsSlot.innerHTML = '';
      this._populateToolbar(actionsSlot);
    }
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
  private _showTabContextMenu(editor: IEditorInput, _index: number, e: MouseEvent): void {
    const currentIdx = this.model.editors.indexOf(editor);
    if (currentIdx < 0) return;

    const editorCount = this.model.count;
    const isLast = currentIdx === editorCount - 1;
    const uri: URI | undefined = editor.uri;

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
    for (const folder of this._workspaceFolders) {
      const folderPath = folder.uri.fsPath;
      if (fsPath.startsWith(folderPath)) {
        let relative = fsPath.substring(folderPath.length);
        if (relative.startsWith('/') || relative.startsWith('\\')) {
          relative = relative.substring(1);
        }
        return relative;
      }
    }
    return fsPath;
  }

  private _populateToolbar(slot: HTMLElement): void {
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
        slot.appendChild(previewBtn);
      }
    }

    // Split button — SVG matching VS Code's split-editor codicon
    const splitBtn = this._createToolbarButton(
      `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 13H9V2h5v12zM2 2h6v12H2V2z"/></svg>`,
      'Split Editor Right',
      () => { this._onDidRequestSplit.fire(GroupDirection.Right); },
      true
    );
    slot.appendChild(splitBtn);
  }

  private _createToolbarButton(content: string, title: string, onClick: () => void, isSvg = false): HTMLElement {
    const btn = $('button');
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

    if (!activeInput) {
      this._onDidActivePaneChange.fire(undefined);
      return;
    }

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

    // Update ribbon for the new editor THEN layout
    this._updateRibbon(activeInput);

    // Layout
    const ribbonH = this._getRibbonHeight();
    const paneH = Math.max(0, this._height - TAB_HEIGHT - ribbonH);
    pane.layout(this._width, paneH);

    this._activePane = pane;
    this._onDidActivePaneChange.fire(pane);
  }

  private _updateEmptyState(): void {
    if (this._emptyMessage) {
      this._emptyMessage.classList.toggle('hidden', !this.model.isEmpty);
    }
  }

  // ─── Dispose ───────────────────────────────────────────────────────────

  override dispose(): void {
    if (this._ribbonDisposable) {
      this._ribbonDisposable.dispose();
      this._ribbonDisposable = undefined;
    }
    this._paneDisposables.clear();
    this._activePane = undefined;
    super.dispose();
  }
}
