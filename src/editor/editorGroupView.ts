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

    // Layout pane: subtract tab bar height
    const paneH = Math.max(0, height - TAB_HEIGHT);
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

    // Pane container
    this._paneContainer = document.createElement('div');
    this._paneContainer.classList.add('editor-pane-container');
    this._element.appendChild(this._paneContainer);

    // Empty message
    this._emptyMessage = document.createElement('div');
    this._emptyMessage.classList.add('editor-group-empty');
    this._emptyMessage.textContent = 'No editors open';
    this._paneContainer.appendChild(this._emptyMessage);

    this._renderTabs();
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

  // ─── Model Change Handler ──────────────────────────────────────────────

  private async _onModelChange(e: EditorModelChangeEvent): Promise<void> {
    switch (e.kind) {
      case EditorGroupChangeKind.EditorOpen:
      case EditorGroupChangeKind.EditorClose:
      case EditorGroupChangeKind.EditorMove:
      case EditorGroupChangeKind.EditorPin:
      case EditorGroupChangeKind.EditorUnpin:
      case EditorGroupChangeKind.EditorSticky:
      case EditorGroupChangeKind.EditorUnsticky:
        this._renderTabs();
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
    if (!this._tabBar) return;

    // Clear existing tabs (but keep any toolbar we might add later)
    this._tabBar.innerHTML = '';

    const editors = this.model.editors;
    const activeIdx = this.model.activeIndex;

    // Tabs container
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

    this._tabBar.appendChild(tabsWrap);

    // Group toolbar (split, close)
    const toolbar = this._createToolbar();
    this._tabBar.appendChild(toolbar);
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
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
    });

    // Drop target (reorder within group)
    tab.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes(EDITOR_TAB_DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tab.classList.add('drop-target');
      }
    });
    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drop-target');
    });
    tab.addEventListener('drop', (e) => {
      tab.classList.remove('drop-target');
      const raw = e.dataTransfer?.getData(EDITOR_TAB_DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      try {
        const data: EditorTabDragData = JSON.parse(raw);
        if (data.sourceGroupId === this.model.id) {
          // Same group: reorder — use current index of drop target
          const dropIdx = this.model.editors.indexOf(editor);
          if (dropIdx >= 0) {
            this.model.moveEditor(data.editorIndex, dropIdx);
          }
        }
        // Cross-group moves handled at editor part level
      } catch { /* ignore bad data */ }
    });

    return tab;
  }

  private _createToolbar(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.classList.add('editor-group-toolbar');

    // Split button
    const splitBtn = this._createToolbarButton('⊞', 'Split Editor Right', () => {
      this._onDidRequestSplit.fire(GroupDirection.Right);
    });
    toolbar.appendChild(splitBtn);

    // Close group button
    const closeBtn = this._createToolbarButton('✕', 'Close Group', () => {
      this._onDidRequestClose.fire();
    });
    toolbar.appendChild(closeBtn);

    return toolbar;
  }

  private _createToolbarButton(text: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = text;
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
    const paneH = Math.max(0, this._height - TAB_HEIGHT);
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
