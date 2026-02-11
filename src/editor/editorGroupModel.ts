// editorGroupModel.ts — editor group state management
//
// Manages the ordered list of editors within a single editor group.
// Tracks active editor, preview editor, sticky editors, pinned state,
// and provides methods for adding, removing, reordering, and serializing.
//
// This is a pure state model with no DOM — the EditorGroupView consumes
// events from this model to render the tab UI.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IEditorInput } from './editorInput.js';
import type { EditorOpenOptions, SerializedEditorGroup, SerializedEditorEntry } from './editorTypes.js';
import { EditorActivation, EditorGroupChangeKind } from './editorTypes.js';

// ─── Editor Entry ────────────────────────────────────────────────────────────

/**
 * Internal entry tracking an editor's state within the group.
 */
interface EditorEntry {
  readonly input: IEditorInput;
  pinned: boolean;
  sticky: boolean;
}

// ─── Model Events ────────────────────────────────────────────────────────────

export interface EditorModelChangeEvent {
  readonly kind: EditorGroupChangeKind;
  readonly editorIndex: number;
  readonly editor?: IEditorInput;
}

// ─── EditorGroupModel ────────────────────────────────────────────────────────

let _nextGroupId = 1;

/**
 * State model for a single editor group.
 *
 * Invariants:
 *  - At most one preview editor (the last non-pinned editor opened).
 *  - Sticky editors always sort to the beginning.
 *  - Active editor index is always valid (or -1 when empty).
 *  - Preview-open replaces the current preview editor.
 */
export class EditorGroupModel extends Disposable {
  readonly id: string;

  private readonly _editors: EditorEntry[] = [];
  private _activeIndex = -1;
  private _previewIndex = -1;

  // ── Events ──

  private readonly _onDidChange = this._register(new Emitter<EditorModelChangeEvent>());
  readonly onDidChange: Event<EditorModelChangeEvent> = this._onDidChange.event;

  constructor(id?: string) {
    super();
    this.id = id ?? `editor-group-${_nextGroupId++}`;
  }

  // ─── Getters ───────────────────────────────────────────────────────────

  /** Number of editors in the group. */
  get count(): number { return this._editors.length; }

  /** Whether the group is empty (no open editors). */
  get isEmpty(): boolean { return this._editors.length === 0; }

  /** The currently active editor, or undefined if empty. */
  get activeEditor(): IEditorInput | undefined {
    return this._activeIndex >= 0 ? this._editors[this._activeIndex]?.input : undefined;
  }

  /** Index of the currently active editor (-1 if empty). */
  get activeIndex(): number { return this._activeIndex; }

  /** The current preview (non-pinned) editor, or undefined. */
  get previewEditor(): IEditorInput | undefined {
    return this._previewIndex >= 0 ? this._editors[this._previewIndex]?.input : undefined;
  }

  /** Ordered list of editor inputs. */
  get editors(): readonly IEditorInput[] {
    return this._editors.map(e => e.input);
  }

  /** Number of sticky editors. */
  get stickyCount(): number {
    return this._editors.filter(e => e.sticky).length;
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  /** Get the editor at a given index. */
  getEditorAt(index: number): IEditorInput | undefined {
    return this._editors[index]?.input;
  }

  /** Find the index of an editor by identity. Returns -1 if not found. */
  indexOf(editor: IEditorInput): number {
    return this._editors.findIndex(e => e.input.matches(editor));
  }

  /** Check if an editor is open in this group. */
  contains(editor: IEditorInput): boolean {
    return this.indexOf(editor) >= 0;
  }

  /** Whether the editor at a given index is pinned. */
  isPinned(indexOrEditor: number | IEditorInput): boolean {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    return idx >= 0 ? (this._editors[idx]?.pinned ?? false) : false;
  }

  /** Whether the editor at a given index is sticky. */
  isSticky(indexOrEditor: number | IEditorInput): boolean {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    return idx >= 0 ? (this._editors[idx]?.sticky ?? false) : false;
  }

  /** Whether the editor at a given index is the preview editor. */
  isPreview(indexOrEditor: number | IEditorInput): boolean {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    return idx === this._previewIndex;
  }

  // ─── Open (add) ────────────────────────────────────────────────────────

  /**
   * Open an editor in this group.
   *
   * Behavior:
   *  - If the editor already exists, activate it (and optionally pin).
   *  - If `pinned` is false (default), this is a preview open — replaces
   *    the current preview editor.
   *  - If `sticky` is true, insert at end of sticky range.
   *  - Returns the final index of the editor.
   */
  openEditor(input: IEditorInput, options: EditorOpenOptions = {}): number {
    const pinned = options.pinned ?? false;
    const sticky = options.sticky ?? false;
    const activation = options.activation ?? EditorActivation.Activate;

    // Already exists?
    const existing = this.indexOf(input);
    if (existing >= 0) {
      // Optionally re-pin
      if (pinned && !this._editors[existing].pinned) {
        this._pin(existing);
      }
      if (activation === EditorActivation.Activate) {
        this._setActive(existing);
      }
      return existing;
    }

    // Preview open: close current preview first
    if (!pinned && this._previewIndex >= 0) {
      this._closeAt(this._previewIndex, true);
    }

    // Build entry
    const entry: EditorEntry = { input, pinned, sticky };

    // Determine insertion index
    let insertAt: number;
    if (options.index !== undefined) {
      insertAt = Math.max(0, Math.min(this._editors.length, options.index));
    } else if (sticky) {
      insertAt = this.stickyCount; // end of sticky range
    } else {
      insertAt = this._editors.length; // end
    }

    this._editors.splice(insertAt, 0, entry);
    this._fixupIndicesAfterInsert(insertAt);

    if (!pinned) {
      this._previewIndex = insertAt;
    }

    if (activation === EditorActivation.Activate) {
      this._setActive(insertAt);
    }

    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorOpen, editorIndex: insertAt, editor: input });

    return insertAt;
  }

  // ─── Close ─────────────────────────────────────────────────────────────

  /**
   * Close the editor at the given index.
   * Returns true if closed, false if vetoed.
   */
  async closeEditor(indexOrEditor: number | IEditorInput, force = false): Promise<boolean> {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    if (idx < 0 || idx >= this._editors.length) return false;

    const entry = this._editors[idx];
    if (!force && entry.input.isDirty) {
      const allowed = await entry.input.confirmClose();
      if (!allowed) return false;
    }

    this._closeAt(idx, false);
    return true;
  }

  /**
   * Close all editors in the group.
   */
  async closeAllEditors(force = false): Promise<boolean> {
    // Close from end to start so indices stay stable
    for (let i = this._editors.length - 1; i >= 0; i--) {
      const ok = await this.closeEditor(i, force);
      if (!ok) return false;
    }
    return true;
  }

  // ─── Pin / Unpin ───────────────────────────────────────────────────────

  pin(indexOrEditor: number | IEditorInput): void {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    if (idx >= 0) this._pin(idx);
  }

  unpin(indexOrEditor: number | IEditorInput): void {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    if (idx < 0 || idx >= this._editors.length) return;
    const entry = this._editors[idx];
    if (!entry.pinned) return;

    entry.pinned = false;

    // Clear existing preview (if any), and make this the new preview
    if (this._previewIndex >= 0 && this._previewIndex !== idx) {
      // Close old preview
      this._closeAt(this._previewIndex, true);
      // Recalculate idx since it may have shifted
      const newIdx = this._editors.findIndex(e => e.input === entry.input);
      this._previewIndex = newIdx;
    } else {
      this._previewIndex = idx;
    }

    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorUnpin, editorIndex: idx, editor: entry.input });
  }

  // ─── Sticky ────────────────────────────────────────────────────────────

  stick(indexOrEditor: number | IEditorInput): void {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    if (idx < 0 || idx >= this._editors.length) return;
    const entry = this._editors[idx];
    if (entry.sticky) return;

    entry.sticky = true;
    // Pin implicitly
    if (!entry.pinned) {
      entry.pinned = true;
      if (this._previewIndex === idx) this._previewIndex = -1;
    }

    // Move to end of sticky range
    const stickyEnd = this.stickyCount; // count now includes this one
    if (idx !== stickyEnd - 1) {
      this._moveEditor(idx, stickyEnd - 1);
    }

    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorSticky, editorIndex: this.indexOf(entry.input), editor: entry.input });
  }

  unstick(indexOrEditor: number | IEditorInput): void {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    if (idx < 0 || idx >= this._editors.length) return;
    const entry = this._editors[idx];
    if (!entry.sticky) return;

    entry.sticky = false;

    // Move right past the end of the remaining sticky range
    const stickyEnd = this.stickyCount;
    if (idx < stickyEnd) {
      this._moveEditor(idx, stickyEnd);
    }

    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorUnsticky, editorIndex: this.indexOf(entry.input), editor: entry.input });
  }

  // ─── Activate ──────────────────────────────────────────────────────────

  setActive(indexOrEditor: number | IEditorInput): void {
    const idx = typeof indexOrEditor === 'number' ? indexOrEditor : this.indexOf(indexOrEditor);
    if (idx >= 0) this._setActive(idx);
  }

  // ─── Reorder ───────────────────────────────────────────────────────────

  /**
   * Move an editor from one index to another within this group.
   */
  moveEditor(from: number, to: number): void {
    if (from < 0 || from >= this._editors.length) return;
    if (to < 0 || to >= this._editors.length) return;
    if (from === to) return;

    this._moveEditor(from, to);
    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorMove, editorIndex: to });
  }

  // ─── Serialization ─────────────────────────────────────────────────────

  serialize(): SerializedEditorGroup {
    return {
      id: this.id,
      editors: this._editors.map(e => ({
        ...e.input.serialize(),
        pinned: e.pinned,
        sticky: e.sticky,
      })),
      activeEditorIndex: this._activeIndex,
      previewEditorIndex: this._previewIndex,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private _setActive(index: number): void {
    if (index < 0 || index >= this._editors.length) return;
    if (this._activeIndex === index) return;
    this._activeIndex = index;
    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorActive, editorIndex: index, editor: this._editors[index].input });
  }

  private _pin(index: number): void {
    const entry = this._editors[index];
    if (!entry || entry.pinned) return;
    entry.pinned = true;
    if (this._previewIndex === index) {
      this._previewIndex = -1;
    }
    this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorPin, editorIndex: index, editor: entry.input });
  }

  private _closeAt(index: number, isPreviewReplace: boolean): void {
    const entry = this._editors[index];
    if (!entry) return;

    const wasActive = this._activeIndex === index;

    this._editors.splice(index, 1);

    // Fix indices
    if (this._previewIndex === index) {
      this._previewIndex = -1;
    } else if (this._previewIndex > index) {
      this._previewIndex--;
    }

    // Fix active index
    if (this._editors.length === 0) {
      this._activeIndex = -1;
    } else if (this._activeIndex === index) {
      // Activate nearest: prefer the one after, then before
      this._activeIndex = Math.min(index, this._editors.length - 1);
    } else if (this._activeIndex > index) {
      this._activeIndex--;
    }

    if (!isPreviewReplace) {
      this._onDidChange.fire({ kind: EditorGroupChangeKind.EditorClose, editorIndex: index, editor: entry.input });

      // If the closed editor was active, notify about the new active editor
      if (wasActive && this._activeIndex >= 0) {
        this._onDidChange.fire({
          kind: EditorGroupChangeKind.EditorActive,
          editorIndex: this._activeIndex,
          editor: this._editors[this._activeIndex]?.input,
        });
      }
    }
  }

  private _moveEditor(from: number, to: number): void {
    const [entry] = this._editors.splice(from, 1);
    this._editors.splice(to, 0, entry);

    // Fix active index
    if (this._activeIndex === from) {
      this._activeIndex = to;
    } else if (from < this._activeIndex && to >= this._activeIndex) {
      this._activeIndex--;
    } else if (from > this._activeIndex && to <= this._activeIndex) {
      this._activeIndex++;
    }

    // Fix preview index
    if (this._previewIndex === from) {
      this._previewIndex = to;
    } else if (from < this._previewIndex && to >= this._previewIndex) {
      this._previewIndex--;
    } else if (from > this._previewIndex && to <= this._previewIndex) {
      this._previewIndex++;
    }
  }

  private _fixupIndicesAfterInsert(insertedAt: number): void {
    if (this._activeIndex >= insertedAt && this._activeIndex >= 0) {
      this._activeIndex++;
    }
    if (this._previewIndex >= insertedAt && this._previewIndex >= 0) {
      // Only shift if it wasn't being set to insertedAt
      if (this._previewIndex !== insertedAt) {
        this._previewIndex++;
      }
    }
  }

  // ─── Dispose ───────────────────────────────────────────────────────────

  override dispose(): void {
    this._editors.length = 0;
    this._activeIndex = -1;
    this._previewIndex = -1;
    super.dispose();
  }
}
