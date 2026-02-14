// editorPart.ts — main content area (hosts editor groups)
//
// The editor part manages a nested Grid of EditorGroupViews.
// It supports splitting/merging groups, focus tracking, and
// relaying layout to the inner grid. The watermark is shown
// only when the first (and only) group has zero editors.

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints, Orientation } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { DisposableStore } from '../platform/lifecycle.js';
import { Grid } from '../layout/grid.js';
import { EditorGroupView } from '../editor/editorGroupView.js';
import { GroupDirection, EditorOpenOptions, EditorActivation, EditorGroupChangeKind } from '../editor/editorTypes.js';
import type { IEditorInput } from '../editor/editorInput.js';
import { createEditorPaneForInput } from '../editor/editorPane.js';
import { EditorDropTarget } from '../editor/editorDropTarget.js';
import { URI } from '../platform/uri.js';

const EDITOR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 200,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 150,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/** Soft limit on the number of visible editor groups. Matches VS Code default. */
const MAX_EDITOR_GROUPS_SOFT_LIMIT = 3;

/**
 * Editor part — the central content area that hosts editor groups.
 *
 * Owns:
 *  - A nested Grid of EditorGroupView instances
 *  - Active-group tracking
 *  - Watermark shown when no editors are open
 */
export class EditorPart extends Part {

  private _editorGroupContainer: HTMLElement | undefined;
  private _watermark: HTMLElement | undefined;

  private _grid: Grid | undefined;
  private _dropTarget: EditorDropTarget | undefined;
  private readonly _groups = new Map<string, EditorGroupView>();
  private readonly _groupDisposables = new Map<string, DisposableStore>();
  private _activeGroupId: string | undefined;

  private _containerWidth = 0;
  private _containerHeight = 0;

  // ── Events ──

  private readonly _onDidActiveGroupChange = this._register(new Emitter<EditorGroupView>());
  readonly onDidActiveGroupChange: Event<EditorGroupView> = this._onDidActiveGroupChange.event;

  private readonly _onDidGroupCountChange = this._register(new Emitter<number>());
  readonly onDidGroupCountChange: Event<number> = this._onDidGroupCountChange.event;

  /** Fires when a group's toolbar "Open Markdown Preview" button is clicked. */
  private readonly _onDidRequestMarkdownPreview = this._register(new Emitter<EditorGroupView>());
  readonly onDidRequestMarkdownPreview: Event<EditorGroupView> = this._onDidRequestMarkdownPreview.event;

  /** Fires when "Reveal in Explorer" is selected from a tab context menu. */
  private readonly _onDidRequestRevealInExplorer = this._register(new Emitter<URI>());
  readonly onDidRequestRevealInExplorer: Event<URI> = this._onDidRequestRevealInExplorer.event;

  constructor() {
    super(
      PartId.Editor,
      'Editor',
      PartPosition.Center,
      EDITOR_CONSTRAINTS,
      true, // always visible
    );
  }

  // ── Accessors ──

  /** Container for the editor group grid. */
  get editorGroupContainer(): HTMLElement | undefined { return this._editorGroupContainer; }

  /** Watermark element shown when no editors are open. */
  get watermark(): HTMLElement | undefined { return this._watermark; }

  /** All editor group views. */
  get groups(): EditorGroupView[] { return [...this._groups.values()]; }

  /** Number of groups. */
  get groupCount(): number { return this._groups.size; }

  /** Active editor group. */
  get activeGroup(): EditorGroupView | undefined {
    return this._activeGroupId ? this._groups.get(this._activeGroupId) : undefined;
  }

  /** The inner grid. */
  get grid(): Grid | undefined { return this._grid; }

  /**
   * Update all editor groups with the current workspace folders.
   * Enables the breadcrumbs bar to show workspace-relative paths.
   */
  setWorkspaceFolders(folders: readonly { uri: URI; name: string }[]): void {
    for (const group of this._groups.values()) {
      group.setWorkspaceFolders(folders);
    }
    // Store for newly created groups
    this._workspaceFolders = [...folders];
  }

  private _workspaceFolders: { uri: URI; name: string }[] = [];

  // ── Content creation ──

  protected override createContent(container: HTMLElement): void {
    container.classList.add('editor-content');

    // Editor group container (nested grid lives here)
    this._editorGroupContainer = document.createElement('div');
    this._editorGroupContainer.classList.add('editor-group-container');
    container.appendChild(this._editorGroupContainer);

    // Watermark (shown when no editors are open)
    this._watermark = document.createElement('div');
    this._watermark.classList.add('editor-watermark');
    this._editorGroupContainer.appendChild(this._watermark);

    // Initialise grid with a single default group
    this._initGrid();
  }

  // ── Grid initialisation ──

  private _initGrid(): void {
    if (!this._editorGroupContainer) return;

    const w = this._containerWidth || this._editorGroupContainer.offsetWidth || 800;
    const h = this._containerHeight || this._editorGroupContainer.offsetHeight || 600;

    this._grid = new Grid(Orientation.Horizontal, w, h);
    this._editorGroupContainer.appendChild(this._grid.element);

    // Create the first group
    const first = this._createGroupView();
    this._grid.addView(first, h);  // Grid adds first.element to its branch DOM
    first.create(first.element.parentElement ?? this._grid.element);
    this._setActiveGroup(first);

    this._grid.layout();
    this._updateWatermark();

    // Enable sash drag resizing between editor groups
    this._grid.initializeSashDrag();

    // Set up the drop target for drag-to-edge split creation
    this._setupDropTarget();
  }

  // ── Drop target for drag-to-edge splits ──

  private _setupDropTarget(): void {
    if (!this._editorGroupContainer) return;

    this._dropTarget = this._register(new EditorDropTarget(this._editorGroupContainer));

    this._register(this._dropTarget.onDidDrop((event) => {
      const { data, targetGroupId, splitDirection } = event;

      // Find the source group and editor — resolve by inputId for VS Code parity
      const sourceGroup = this._groups.get(data.sourceGroupId);
      if (!sourceGroup) return;

      const sourceIdx = sourceGroup.model.editors.findIndex(e => e.id === data.inputId);
      if (sourceIdx < 0) return;
      const sourceEditor = sourceGroup.model.editors[sourceIdx];

      const targetGroup = this._groups.get(targetGroupId);
      if (!targetGroup) return;

      if (splitDirection) {
        // Create a new split group and move the editor there
        const newGroup = this.splitGroup(targetGroup.id, splitDirection);
        if (newGroup) {
          newGroup.openEditor(sourceEditor, { pinned: true });
          // Close from source group (force — this is a move)
          sourceGroup.model.closeEditor(sourceIdx, true);

          // Auto-close empty source group (not if it's the last)
          if (sourceGroup.isEmpty && this._groups.size > 1) {
            this.removeGroup(sourceGroup.id);
          }
        }
      } else {
        // Center drop — merge into existing group (same as cross-group tab drop)
        if (data.sourceGroupId !== targetGroupId) {
          targetGroup.openEditor(sourceEditor, { pinned: true });
          sourceGroup.model.closeEditor(sourceIdx, true);
          this._setActiveGroup(targetGroup);

          if (sourceGroup.isEmpty && this._groups.size > 1) {
            this.removeGroup(sourceGroup.id);
          }
        }
      }
    }));
  }

  // ── Group management ──

  private _createGroupView(): EditorGroupView {
    const group = new EditorGroupView(undefined, createEditorPaneForInput);
    this._groups.set(group.id, group);

    // Pass workspace folders for breadcrumbs
    if (this._workspaceFolders.length > 0) {
      group.setWorkspaceFolders(this._workspaceFolders);
    }

    const store = new DisposableStore();

    // Focus → activate
    store.add(group.onDidFocus(() => this._setActiveGroup(group)));

    // Split request
    store.add(group.onDidRequestSplit((direction) => this.splitGroup(group.id, direction)));

    // Markdown preview request
    store.add(group.onDidRequestMarkdownPreview(() => this._onDidRequestMarkdownPreview.fire(group)));

    // Reveal in Explorer request (from tab context menu)
    store.add(group.onDidRequestRevealInExplorer((uri) => this._onDidRequestRevealInExplorer.fire(uri)));

    // Close-group request
    store.add(group.onDidRequestClose(() => this.removeGroup(group.id)));

    // Cross-group tab drop: move editor from source group to this group.
    // VS Code parity: resolve by inputId, not stale editorIndex.
    store.add(group.onDidRequestCrossGroupDrop((data) => {
      const sourceGroup = this._groups.get(data.sourceGroupId);
      if (!sourceGroup) return;

      // Resolve the editor by inputId — the editorIndex captured at dragstart
      // can be stale if tabs were reordered after the drag started.
      const sourceIdx = sourceGroup.model.editors.findIndex(e => e.id === data.inputId);
      if (sourceIdx < 0) return;
      const sourceEditor = sourceGroup.model.editors[sourceIdx];

      // Open the editor in this group at the drop position, pinned
      group.openEditor(sourceEditor, { pinned: true, index: data.dropIndex });

      // Close from source group (force close — it's a move, not a real close)
      sourceGroup.model.closeEditor(sourceIdx, true);

      // Activate the target group
      this._setActiveGroup(group);

      // Auto-close empty source group if it's not the last group
      if (sourceGroup.isEmpty && this._groups.size > 1) {
        this.removeGroup(sourceGroup.id);
      }
    }));

    // Model changes → update watermark + auto-close empty groups
    // VS Code's `workbench.editor.closeEmptyGroups` defaults to TRUE, so when
    // the last editor in a non-last group is closed, the group is removed
    // automatically and remaining groups resize to fill the space.
    store.add(group.model.onDidChange((e) => {
      this._updateWatermark();

      // Auto-close: when last editor is closed and there is at least one other group
      if (
        e.kind === EditorGroupChangeKind.EditorClose &&
        group.model.isEmpty &&
        this._groups.size > 1
      ) {
        // Defer removal to after the current event cycle completes so that any
        // in-flight tab-render or pane-update in the group view finishes first.
        queueMicrotask(() => this.removeGroup(group.id));
      }
    }));

    this._groupDisposables.set(group.id, store);
    this._onDidGroupCountChange.fire(this._groups.size);
    return group;
  }

  /**
   * Split an existing group in the given direction.
   *
   * Follows VS Code's addGroup() pattern:
   * 1. Determine split orientation & direction from GroupDirection
   * 2. Compute size from the SOURCE view's current size (not the container)
   * 3. Insert new group into grid beside the source
   * 4. Copy the active editor from source into the new group (VS Code parity)
   * 5. Activate the new group (it now shows the same editor)
   */
  splitGroup(sourceGroupId: string, direction: GroupDirection): EditorGroupView | undefined {
    if (!this._grid) return undefined;
    const source = this._groups.get(sourceGroupId);
    if (!source) return undefined;

    // 3-group soft limit: warn but allow creation
    if (this._groups.size >= MAX_EDITOR_GROUPS_SOFT_LIMIT) {
      console.warn(
        `[EditorPart] Creating group #${this._groups.size + 1} exceeds the soft limit of ${MAX_EDITOR_GROUPS_SOFT_LIMIT} visible groups.`,
      );
    }

    const newGroup = this._createGroupView();

    const splitOrientation =
      (direction === GroupDirection.Left || direction === GroupDirection.Right)
        ? Orientation.Horizontal
        : Orientation.Vertical;
    const insertBefore = (direction === GroupDirection.Left || direction === GroupDirection.Up);

    // VS Code parity: size the new view at half the SOURCE view's current size,
    // not half the entire container. This ensures correct proportions when
    // splitting a group that's already smaller than the full container.
    const sourceSize = this._grid.getViewSize(sourceGroupId);
    const fallbackSize = splitOrientation === Orientation.Horizontal
      ? this._containerWidth
      : this._containerHeight;
    const splitSize = Math.floor((sourceSize ?? fallbackSize) / 2);

    try {
      this._grid.splitView(sourceGroupId, newGroup, splitSize, splitOrientation, insertBefore);

      // The grid creates a wrapper element for the leaf; render the group inside it
      newGroup.create(newGroup.element.parentElement ?? this._grid.element);
    } catch {
      // Fallback: add at root
      this._grid.addView(newGroup, Math.floor(this._containerHeight / 2));
      newGroup.create(newGroup.element.parentElement ?? this._grid.element);
    }

    // VS Code parity: copy the active editor from the source group into the
    // new split so the user sees the same file on both sides (like VS Code's
    // "Split Editor Right"). Without this, the new group shows an empty watermark.
    const activeEditor = source.model.activeEditor;
    if (activeEditor) {
      // Open in new group as pinned (same as VS Code split behaviour)
      newGroup.openEditor(activeEditor, { pinned: true });
    }

    this._setActiveGroup(newGroup);
    this._relayout();
    return newGroup;
  }

  /**
   * Remove an editor group. If it's the last group, a new empty one is created.
   *
   * VS Code parity: if the group has editors, they are merged into the most
   * recently active remaining group before removal.
   */
  removeGroup(groupId: string): void {
    if (!this._grid) return;
    const group = this._groups.get(groupId);
    if (!group) return;

    // If group has editors, merge them into the target group first (VS Code parity)
    if (!group.isEmpty && this._groups.size > 1) {
      // Find the best target: the most recently activated group that isn't this one
      const target = this._findMergeTarget(groupId);
      if (target) {
        this.mergeGroup(groupId, target.id);
        return; // mergeGroup removes the source if it becomes empty
      }
    }

    this._grid.removeView(groupId);
    this._groups.delete(groupId);
    this._groupDisposables.get(groupId)?.dispose();
    this._groupDisposables.delete(groupId);
    group.dispose();

    // Ensure at least one group
    if (this._groups.size === 0) {
      const newGroup = this._createGroupView();
      this._grid.addView(newGroup, this._containerHeight || 600);
      newGroup.create(newGroup.element.parentElement ?? this._grid.element);
      this._setActiveGroup(newGroup);
    } else if (this._activeGroupId === groupId) {
      // Activate the first remaining group
      const first = this._groups.values().next().value as EditorGroupView;
      this._setActiveGroup(first);
    }

    this._onDidGroupCountChange.fire(this._groups.size);
    this._relayout();
    this._updateWatermark();
  }

  /**
   * Add a group adjacent to the given reference group (VS Code naming for splitGroup).
   *
   * This is the canonical VS Code API name; internally delegates to splitGroup.
   */
  addGroup(referenceGroupId: string, direction: GroupDirection): EditorGroupView | undefined {
    return this.splitGroup(referenceGroupId, direction);
  }

  /**
   * Merge one group's editors into another group.
   *
   * VS Code parity: moves all editors from source into target, then removes
   * the now-empty source group.
   */
  mergeGroup(sourceGroupId: string, targetGroupId: string): void {
    const source = this._groups.get(sourceGroupId);
    const target = this._groups.get(targetGroupId);
    if (!source || !target || sourceGroupId === targetGroupId) return;

    // Move all editors from source to target
    for (const editor of source.model.editors) {
      target.openEditor(editor, { pinned: true, preserveFocus: true, activation: EditorActivation.Restore });
    }

    // Close all editors in source (force — they've been moved)
    while (source.model.count > 0) {
      source.model.closeEditor(0, true);
    }

    // Remove the now-empty source group
    if (source.isEmpty && this._groups.size > 1) {
      this._removeEmptyGroup(sourceGroupId);
    }
  }

  /**
   * Find a group adjacent to the given source in the specified direction.
   *
   * VS Code parity: EditorPart.findGroup({ direction }, source)
   * Currently a simplified version that works for the common case.
   */
  findGroup(direction: GroupDirection, sourceGroupId?: string): EditorGroupView | undefined {
    const groups = this.groups;
    if (groups.length <= 1) return undefined;

    const sourceId = sourceGroupId ?? this._activeGroupId;
    const sourceIndex = groups.findIndex(g => g.id === sourceId);
    if (sourceIndex < 0) return undefined;

    // Simplified: for horizontal splits (Left/Right), navigate prev/next in group order
    // For vertical splits (Up/Down), same — we use grid appearance order
    switch (direction) {
      case GroupDirection.Left:
      case GroupDirection.Up:
        return sourceIndex > 0 ? groups[sourceIndex - 1] : undefined;
      case GroupDirection.Right:
      case GroupDirection.Down:
        return sourceIndex < groups.length - 1 ? groups[sourceIndex + 1] : undefined;
    }
  }

  /**
   * Find the best merge target for a group being removed.
   */
  private _findMergeTarget(excludeGroupId: string): EditorGroupView | undefined {
    // Prefer the active group if it's not the one being removed
    if (this._activeGroupId && this._activeGroupId !== excludeGroupId) {
      return this._groups.get(this._activeGroupId);
    }
    // Otherwise use the first available group
    for (const [id, group] of this._groups) {
      if (id !== excludeGroupId) return group;
    }
    return undefined;
  }

  /**
   * Remove an empty group without merging.
   * Used internally after editors have already been moved elsewhere.
   */
  private _removeEmptyGroup(groupId: string): void {
    if (!this._grid) return;
    const group = this._groups.get(groupId);
    if (!group) return;

    this._grid.removeView(groupId);
    this._groups.delete(groupId);
    this._groupDisposables.get(groupId)?.dispose();
    this._groupDisposables.delete(groupId);
    group.dispose();

    if (this._groups.size === 0) {
      const newGroup = this._createGroupView();
      this._grid.addView(newGroup, this._containerHeight || 600);
      newGroup.create(newGroup.element.parentElement ?? this._grid.element);
      this._setActiveGroup(newGroup);
    } else if (this._activeGroupId === groupId) {
      const first = this._groups.values().next().value as EditorGroupView;
      this._setActiveGroup(first);
    }

    this._onDidGroupCountChange.fire(this._groups.size);
    this._relayout();
    this._updateWatermark();
  }

  /**
   * Open an editor in the active group (or a specific group).
   */
  async openEditor(input: IEditorInput, options?: EditorOpenOptions, groupId?: string): Promise<void> {
    const group = groupId ? this._groups.get(groupId) : this.activeGroup;
    if (!group) return;
    await group.openEditor(input, options);
    this._updateWatermark();
  }

  /**
   * Get a group by ID.
   */
  getGroup(groupId: string): EditorGroupView | undefined {
    return this._groups.get(groupId);
  }

  // ── Active group ──

  private _setActiveGroup(group: EditorGroupView): void {
    if (this._activeGroupId === group.id) return;
    this._activeGroupId = group.id;
    this._onDidActiveGroupChange.fire(group);

    // Visual: dim inactive, highlight active
    for (const [id, g] of this._groups) {
      if (g.element) {
        g.element.classList.toggle('editor-group--active', id === group.id);
      }
    }
  }

  /**
   * Activate a group by ID.
   */
  activateGroup(groupId: string): void {
    const group = this._groups.get(groupId);
    if (group) this._setActiveGroup(group);
  }

  // ── Watermark ──

  /** Show or hide the watermark. */
  setWatermarkVisible(visible: boolean): void {
    if (this._watermark) {
      this._watermark.classList.toggle('hidden', !visible);
    }
  }

  private _updateWatermark(): void {
    // Watermark visible only when there's a single group that is empty
    const show = this._groups.size <= 1 && (this.activeGroup?.isEmpty ?? true);
    this.setWatermarkVisible(show);
  }

  // ── Layout ──

  protected override layoutContent(width: number, height: number): void {
    this._containerWidth = width;
    this._containerHeight = height;

    if (this._editorGroupContainer) {
      this._editorGroupContainer.style.width = `${width}px`;
      this._editorGroupContainer.style.height = `${height}px`;
    }

    this._grid?.resize(width, height);
  }

  private _relayout(): void {
    if (this._containerWidth && this._containerHeight) {
      this._grid?.resize(this._containerWidth, this._containerHeight);
    }
  }

  // ── Serialization ──

  serializeGroups(): { groups: ReturnType<EditorGroupView['model']['serialize']>[]; activeGroupId?: string } {
    const groups = [...this._groups.values()].map(g => g.model.serialize());
    return { groups, activeGroupId: this._activeGroupId };
  }

  // ── Dispose ──

  override dispose(): void {
    for (const [, store] of this._groupDisposables) {
      store.dispose();
    }
    this._groupDisposables.clear();
    for (const [, group] of this._groups) {
      group.dispose();
    }
    this._groups.clear();
    this._grid?.dispose();
    // Emitters now registered via this._register() — disposed by super.dispose()
    super.dispose();
  }
}

export const editorPartDescriptor: PartDescriptor = {
  id: PartId.Editor,
  name: 'Editor',
  position: PartPosition.Center,
  defaultVisible: true,
  constraints: EDITOR_CONSTRAINTS,
  factory: () => new EditorPart(),
};
