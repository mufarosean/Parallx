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
import { GroupDirection, EditorOpenOptions } from '../editor/editorTypes.js';
import type { IEditorInput } from '../editor/editorInput.js';
import { createEditorPaneForInput } from '../editor/editorPane.js';

const EDITOR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 200,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 150,
  maximumHeight: Number.POSITIVE_INFINITY,
};

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
  private readonly _groups = new Map<string, EditorGroupView>();
  private readonly _groupDisposables = new Map<string, DisposableStore>();
  private _activeGroupId: string | undefined;

  private _containerWidth = 0;
  private _containerHeight = 0;

  // ── Events ──

  private readonly _onDidActiveGroupChange = new Emitter<EditorGroupView>();
  readonly onDidActiveGroupChange: Event<EditorGroupView> = this._onDidActiveGroupChange.event;

  private readonly _onDidGroupCountChange = new Emitter<number>();
  readonly onDidGroupCountChange: Event<number> = this._onDidGroupCountChange.event;

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

  // ── Content creation ──

  protected override createContent(container: HTMLElement): void {
    container.classList.add('editor-content');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    // Editor group container (nested grid lives here)
    this._editorGroupContainer = document.createElement('div');
    this._editorGroupContainer.classList.add('editor-group-container');
    this._editorGroupContainer.style.flex = '1';
    this._editorGroupContainer.style.position = 'relative';
    this._editorGroupContainer.style.overflow = 'hidden';
    container.appendChild(this._editorGroupContainer);

    // Watermark (shown when no editors are open)
    this._watermark = document.createElement('div');
    this._watermark.classList.add('editor-watermark');
    this._watermark.style.position = 'absolute';
    this._watermark.style.inset = '0';
    this._watermark.style.display = 'flex';
    this._watermark.style.alignItems = 'center';
    this._watermark.style.justifyContent = 'center';
    this._watermark.style.pointerEvents = 'none';
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
  }

  // ── Group management ──

  private _createGroupView(): EditorGroupView {
    const group = new EditorGroupView(undefined, createEditorPaneForInput);
    this._groups.set(group.id, group);

    const store = new DisposableStore();

    // Focus → activate
    store.add(group.onDidFocus(() => this._setActiveGroup(group)));

    // Split request
    store.add(group.onDidRequestSplit((direction) => this.splitGroup(group.id, direction)));

    // Close-group request
    store.add(group.onDidRequestClose(() => this.removeGroup(group.id)));

    // Model changes → update watermark
    store.add(group.model.onDidChange(() => this._updateWatermark()));

    this._groupDisposables.set(group.id, store);
    this._onDidGroupCountChange.fire(this._groups.size);
    return group;
  }

  /**
   * Split an existing group in the given direction.
   */
  splitGroup(sourceGroupId: string, direction: GroupDirection): EditorGroupView | undefined {
    if (!this._grid) return undefined;
    const source = this._groups.get(sourceGroupId);
    if (!source) return undefined;

    const newGroup = this._createGroupView();

    const splitOrientation =
      (direction === GroupDirection.Left || direction === GroupDirection.Right)
        ? Orientation.Horizontal
        : Orientation.Vertical;
    const insertBefore = (direction === GroupDirection.Left || direction === GroupDirection.Up);

    try {
      this._grid.splitView(sourceGroupId, newGroup, Math.floor(
        (splitOrientation === Orientation.Horizontal ? this._containerWidth : this._containerHeight) / 2
      ), splitOrientation, insertBefore);

      // The grid creates a wrapper element for the leaf; render the group inside it
      newGroup.create(newGroup.element.parentElement ?? this._grid.element);
    } catch {
      // Fallback: add at root
      this._grid.addView(newGroup, Math.floor(this._containerHeight / 2));
      newGroup.create(newGroup.element.parentElement ?? this._grid.element);
    }

    this._setActiveGroup(newGroup);
    this._relayout();
    return newGroup;
  }

  /**
   * Remove an editor group. If it's the last group, a new empty one is created.
   */
  removeGroup(groupId: string): void {
    if (!this._grid) return;
    const group = this._groups.get(groupId);
    if (!group) return;

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
      this._watermark.style.display = visible ? 'flex' : 'none';
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
    this._onDidActiveGroupChange.dispose();
    this._onDidGroupCountChange.dispose();
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
