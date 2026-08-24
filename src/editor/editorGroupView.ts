// editorGroupView.ts — editor group UI rendering
//
// Renders a single editor group: a tab bar at the top and the active
// editor pane below. Integrates with EditorGroupModel for state and
// implements IGridView so the editor part grid can size it.
//
// Tab bar: delegates to `ui/TabBar` for rendering, DnD, scrolling,
// and events. EditorGroupView maps the model to `ITabBarItem[]` and
// wires TabBar events back to the model.

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { EditorGroupModel, EditorModelChangeEvent } from './editorGroupModel.js';
import { EditorPane, PlaceholderEditorPane, type EditorPaneViewState } from './editorPane.js';
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
import { $, addDisposableListener } from '../ui/dom.js';
import { getIcon, getFileTypeIcon } from '../ui/iconRegistry.js';
import { setupTooltip } from '../ui/tooltip.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_HEIGHT = 35;
/** Gap above the tab strip so the editor floats the same distance below the
 *  title bar as the sidebar / aux cards. MUST match --px-seam (the editor
 *  `.editor-tab-bar` margin-top) in workbench.css — the pane-height calc
 *  subtracts it so the JS layout stays in step with that CSS margin (no
 *  bottom clip). */
const TAB_STRIP_TOP_GAP = 8;
/** Horizontal chrome of the `.editor-pane-container` floating card: --px-seam
 *  margin + 1px border on each side. MUST match workbench.css
 *  (`.part-workbench-parts-editor .editor-pane-container`). The pane inside is
 *  sized with explicit pixels, so JS must subtract this — otherwise every pane
 *  is 12px wider than the card and its right edge is clipped (flush-right
 *  toolbar buttons touch/vanish at the pane border). */
const PANE_CONTAINER_CHROME_X = 18;
const MIN_GROUP_WIDTH = 200;
const MIN_GROUP_HEIGHT = 120;
/** How many panes a group keeps ALIVE (hidden) for instant, stateful tab
 *  returns. Beyond the cap the least-recently-shown pane is disposed after
 *  its view state is captured, so an evicted tab still restores scroll and
 *  selection on rebuild — it just pays the rebuild. Bounds DOM/memory for
 *  users with many open tabs. */
const MAX_RETAINED_PANES = 7;

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
  /** Cached custom-ribbon height, refreshed by a ResizeObserver. Reading
   *  offsetHeight inside layout() (right after writing width/height) forced a
   *  synchronous reflow every sash-drag frame — layout thrash on heavy panes. */
  private _cachedRibbonHeight = 0;
  private _ribbonResizeObserver: ResizeObserver | undefined;
  private _paneContainer!: HTMLElement;
  private _emptyMessage!: HTMLElement;
  private _workspaceFolders: readonly { uri: URI; name: string }[] = [];

  private _activePane: EditorPane | undefined;
  /** Sequence counter for "latest-wins" active editor rendering. */
  private _showActiveEditorSeq = 0;

  /**
   * Per-input view-state cache. Retention (below) keeps recently used panes
   * ALIVE across tab switches, so this cache is the durable fallback: it
   * restores scroll/selection for panes evicted by the retention cap, and
   * for the first mount after a workspace restore.
   *
   * VS-Code-aligned: each editor input owns a view state (scroll, selection,
   * focus, etc.) that survives tab switching but is evicted when the editor
   * is actually closed. Mirrors Monaco's IEditor.saveViewState / restoreViewState.
   */
  private readonly _viewStateCache = new Map<string, EditorPaneViewState>();

  /**
   * Pane retention (M101 seamless tabs). Switching tabs used to DISPOSE the
   * outgoing pane and rebuild the incoming one from scratch — every return
   * to an open tab flashed empty, re-fetched content, and lost ephemeral
   * state the view-state contract doesn't carry (a revealed flashcard answer,
   * a finished duplicate scan, a half-loaded canvas). Panes now stay alive,
   * hidden in the pane container, and are disposed only when their tab
   * CLOSES, the group disposes, or the LRU cap evicts them. This covers
   * every editor uniformly — built-in and extension tool editors alike —
   * with zero per-editor work.
   */
  private readonly _retainedPanes = new Map<string, EditorPane>();
  /** LRU order of retained input ids — most recently shown LAST. */
  private _retainedOrder: string[] = [];

  /** The currently active editor pane (if any). */
  get activePane(): EditorPane | undefined { return this._activePane; }

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

    // Layout pane: subtract the tab strip's top gap, tab bar height, and ribbon
    const ribbonH = this._getRibbonHeight();
    const paneH = Math.max(0, height - TAB_STRIP_TOP_GAP - TAB_HEIGHT - ribbonH);
    if (this._paneContainer) {
      this._paneContainer.style.height = `${paneH}px`;
    }
    this._activePane?.layout(Math.max(0, width - PANE_CONTAINER_CHROME_X), paneH);
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
    // Custom ribbon is sized by its content — read the cached height (kept
    // fresh by _ribbonResizeObserver) instead of forcing a reflow here.
    if (this._ribbonDisposable) {
      // Seed the cache on first use (before the observer has fired).
      if (this._cachedRibbonHeight === 0) {
        this._cachedRibbonHeight = this._ribbonContainer.offsetHeight || 0;
      }
      return this._cachedRibbonHeight;
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
    this._register(addDisposableListener(this._element, 'focusin', () => this._onDidFocus.fire()));

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

    // Keep the custom-ribbon height cached off the layout hot path. The
    // observer updates it asynchronously when the ribbon's box actually
    // changes (content, or wrapping at a new width) and reflows the pane once
    // — so layout() never has to read offsetHeight (a forced reflow) per frame.
    if (typeof ResizeObserver !== 'undefined') {
      this._ribbonResizeObserver = new ResizeObserver(() => {
        if (!this._ribbonDisposable) return; // only custom ribbons measure by box
        const h = this._ribbonContainer.offsetHeight || 0;
        if (h === this._cachedRibbonHeight) return;
        this._cachedRibbonHeight = h;
        if (this._width > 0 && this._height > 0) {
          this.layout(this._width, this._height, Orientation.Horizontal);
        }
      });
      this._ribbonResizeObserver.observe(this._ribbonContainer);
      this._register({ dispose: () => { this._ribbonResizeObserver?.disconnect(); this._ribbonResizeObserver = undefined; } });
    }

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
    // Ribbon content is changing — drop the cached height so the next layout
    // re-seeds it (the observer will also refresh it once the new box settles).
    this._cachedRibbonHeight = 0;

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
        // Evict the closed input's view state — only tab *switching* keeps it,
        // an actual close should drop scroll/selection/focus. The retained
        // pane dies with the tab: close is the real teardown boundary now.
        if (e.editor) {
          this._viewStateCache.delete(e.editor.id);
          this._disposeRetainedPane(e.editor.id);
        }
        this._renderTabs();
        this._updateRibbon(this.model.activeEditor); // Hide ribbon when last editor closes
        break;
      case EditorGroupChangeKind.EditorActive:
        this._renderTabs();
        await this._showActiveEditor();
        break;
    }
    // Preview-replace removes an editor WITHOUT an EditorClose event (model
    // invariant: one preview tab, silently swapped). Close-driven disposal
    // alone would leak that editor's retained pane — alive, hidden, and
    // bound to a disposed input that a future reopen could share an id
    // with. Reconcile after every model change.
    this._pruneRetainedPanes();
    this._updateEmptyState();
  }

  /** Dispose retained panes whose input no longer exists in the model. */
  private _pruneRetainedPanes(): void {
    if (this._retainedPanes.size === 0) return;
    const live = new Set(this.model.editors.map((ed) => ed.id));
    for (const inputId of [...this._retainedPanes.keys()]) {
      if (!live.has(inputId)) this._disposeRetainedPane(inputId);
    }
  }

  // ─── Tab Rendering ─────────────────────────────────────────────────────

  private _renderTabs(): void {
    if (!this._tabs) return;

    const editors = this.model.editors;
    const activeIdx = this.model.activeIndex;

    // Map model editors → ITabBarItem[]
    const items: ITabBarItem[] = editors.map((editor, i) => {
      const extMatch = editor.name.match(/\.([a-zA-Z0-9]+)$/);
      return {
        id: editor.id,
        label: editor.name,
        // Editor-supplied icon first (canvas pages, planner, dashboards);
        // extension-derived only as the fallback — same order the Open
        // Editors view uses (2026-07-20 icon fix).
        icon: editor.iconHtml ?? (extMatch ? getFileTypeIcon(extMatch[1]) : undefined),
        tooltip: editor.description || editor.name,
        italic: this.model.isPreview(i),
        stickyContent: this.model.isSticky(i) ? 'pinned' : undefined,
        decorations: {
          dirty: editor.isDirty,
          pinned: this.model.isSticky(i),
        },
      };
    });

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
          getIcon('markdown-preview')!,
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
      getIcon('split-editor')!,
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
    setupTooltip(btn, title);
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

    // HIDE the outgoing pane — never dispose it here. Panes are retained per
    // input so returning to a tab is instant and stateful (M101 seamless
    // tabs). View state is still captured: it is the durable fallback when
    // the retention cap later evicts this pane.
    if (this._activePane) {
      const outgoingInput = this._activePane.input;
      if (outgoingInput) {
        try {
          const state = this._activePane.saveViewState();
          if (state) {
            this._viewStateCache.set(outgoingInput.id, state);
          }
        } catch (err) {
          console.warn('[EditorGroupView] saveViewState() threw:', err);
        }
      }
      this._activePane.element?.classList.add('hidden');
      this._activePane = undefined;
    }

    if (!activeInput) {
      this._onDidActivePaneChange.fire(undefined);
      return;
    }

    // Retained pane → reveal synchronously. No teardown, no async work, no
    // flicker: the DOM the user left is the DOM they come back to.
    const retained = this._retainedPanes.get(activeInput.id);
    if (retained) {
      this._touchRetained(activeInput.id);
      retained.element?.classList.remove('hidden');
      this._updateRibbon(activeInput);
      // Re-layout on reveal — the group may have been resized while this
      // pane sat hidden (hidden panes receive no layout calls).
      const ribbonH = this._getRibbonHeight();
      const paneH = Math.max(0, this._height - TAB_STRIP_TOP_GAP - TAB_HEIGHT - ribbonH);
      retained.layout(Math.max(0, this._width - PANE_CONTAINER_CHROME_X), paneH);
      this._activePane = retained;
      this._onDidActivePaneChange.fire(retained);
      return;
    }

    // First mount for this input — build a pane.
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
      // A newer _showActiveEditor() call superseded us. Dispose rather than
      // retain: the newer call may be building a pane for this SAME input,
      // and two retained panes for one id would collide.
      pane.clearInput();
      pane.dispose();
      if (pane.element) pane.element.remove();
      return;
    }

    // This call is the latest — retain the pane for instant future returns.
    this._retainedPanes.set(activeInput.id, pane);
    this._touchRetained(activeInput.id);
    this._evictRetainedOverCap(activeInput.id);

    // Update ribbon for the new editor THEN layout
    this._updateRibbon(activeInput);

    // Layout BEFORE restore so the scroll container has its final size
    // (otherwise scrollTop = N clamps against an empty viewport).
    const ribbonH = this._getRibbonHeight();
    const paneH = Math.max(0, this._height - TAB_STRIP_TOP_GAP - TAB_HEIGHT - ribbonH);
    pane.layout(Math.max(0, this._width - PANE_CONTAINER_CHROME_X), paneH);

    // Restore cached view state for this input, if any. setInput has already
    // populated the pane's DOM by this point, and layout has been applied,
    // so scrollTop / selection restores land against a settled tree.
    const cached = this._viewStateCache.get(activeInput.id);
    if (cached) {
      try {
        pane.restoreViewState(cached);
      } catch (err) {
        console.warn('[EditorGroupView] restoreViewState() threw:', err);
      }
    }

    this._activePane = pane;
    this._onDidActivePaneChange.fire(pane);
  }

  // ─── Pane Retention ────────────────────────────────────────────────────

  /** Move an input id to the most-recently-shown end of the LRU order. */
  private _touchRetained(inputId: string): void {
    const i = this._retainedOrder.indexOf(inputId);
    if (i >= 0) this._retainedOrder.splice(i, 1);
    this._retainedOrder.push(inputId);
  }

  /**
   * Dispose least-recently-shown retained panes beyond the cap. The active
   * input is never evicted. Evicted panes save their view state first, so
   * returning to an evicted tab rebuilds WITH scroll/selection restored.
   */
  private _evictRetainedOverCap(activeInputId: string): void {
    while (this._retainedOrder.length > MAX_RETAINED_PANES) {
      const victimId = this._retainedOrder.find((id) => id !== activeInputId);
      if (!victimId) return;
      const pane = this._retainedPanes.get(victimId);
      if (pane) {
        try {
          const state = pane.saveViewState();
          if (state) this._viewStateCache.set(victimId, state);
        } catch (err) {
          console.warn('[EditorGroupView] saveViewState() threw during eviction:', err);
        }
      }
      this._disposeRetainedPane(victimId);
    }
  }

  /** Dispose one retained pane (tab close, eviction, or group teardown). */
  private _disposeRetainedPane(inputId: string): void {
    const pane = this._retainedPanes.get(inputId);
    if (!pane) return;
    this._retainedPanes.delete(inputId);
    const i = this._retainedOrder.indexOf(inputId);
    if (i >= 0) this._retainedOrder.splice(i, 1);
    if (pane === this._activePane) this._activePane = undefined;
    try {
      pane.clearInput();
    } catch (err) {
      console.warn('[EditorGroupView] clearInput() threw during pane disposal:', err);
    }
    pane.dispose();
    pane.element?.remove();
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
    for (const inputId of [...this._retainedPanes.keys()]) {
      this._disposeRetainedPane(inputId);
    }
    this._activePane = undefined;
    this._viewStateCache.clear();
    super.dispose();
  }
}
