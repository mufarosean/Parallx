// editorInput.ts — abstract editor input
//
// Represents a document or resource that can be opened in an editor.
// EditorInput is the "model identity" of an editor — it carries metadata
// (name, description, type, dirty state) and can serialize itself for
// persistence. Concrete inputs extend this class for specific resource
// types (files, diffs, etc.).

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { SerializedEditorEntry } from './editorTypes.js';

// ─── IEditorInput ────────────────────────────────────────────────────────────

/**
 * Public contract for editor inputs.
 */
export interface IEditorInput extends IDisposable {
  /** Globally unique identifier for this input instance. */
  readonly id: string;

  /** Type identifier for editor resolution (e.g. 'text', 'diff', 'welcome'). */
  readonly typeId: string;

  /** Display name shown in the editor tab. */
  readonly name: string;

  /** Optional description (e.g. file path) shown in tooltip. */
  readonly description: string;

  /** Whether this input has unsaved changes. */
  readonly isDirty: boolean;

  /** Fires when the dirty state changes. */
  readonly onDidChangeDirty: Event<boolean>;

  /** Fires when display properties (name, description) change. */
  readonly onDidChangeLabel: Event<void>;

  /** Fires when this input is about to be disposed. */
  readonly onWillDispose: Event<void>;

  /**
   * Whether two inputs represent the same resource.
   * Default: compare by id.
   */
  matches(other: IEditorInput): boolean;

  /**
   * Attempt to confirm close when dirty.
   * Return true to allow close, false to veto.
   */
  confirmClose(): Promise<boolean>;

  /**
   * Serialize this input for persistence.
   */
  serialize(): SerializedEditorEntry;
}

// ─── EditorInput (abstract base) ─────────────────────────────────────────────

let _nextInputId = 1;

/**
 * Abstract base class for editor inputs.
 *
 * Subclasses must implement `typeId`, `name`, `description`, and `serialize()`.
 * They may also override `confirmClose()` to add save prompts.
 */
export abstract class EditorInput extends Disposable implements IEditorInput {
  readonly id: string;

  // ── Dirty state ──

  private _isDirty = false;

  private readonly _onDidChangeDirty = this._register(new Emitter<boolean>());
  readonly onDidChangeDirty: Event<boolean> = this._onDidChangeDirty.event;

  private readonly _onDidChangeLabel = this._register(new Emitter<void>());
  readonly onDidChangeLabel: Event<void> = this._onDidChangeLabel.event;

  private readonly _onWillDispose = this._register(new Emitter<void>());
  readonly onWillDispose: Event<void> = this._onWillDispose.event;

  constructor(id?: string) {
    super();
    this.id = id ?? `editor-input-${_nextInputId++}`;
  }

  // ── Abstract ──

  abstract get typeId(): string;
  abstract get name(): string;
  abstract get description(): string;
  abstract serialize(): SerializedEditorEntry;

  // ── Dirty ──

  get isDirty(): boolean {
    return this._isDirty;
  }

  protected setDirty(dirty: boolean): void {
    if (this._isDirty === dirty) return;
    this._isDirty = dirty;
    this._onDidChangeDirty.fire(dirty);
  }

  // ── Label change ──

  protected fireLabelChange(): void {
    this._onDidChangeLabel.fire();
  }

  // ── Identity ──

  matches(other: IEditorInput): boolean {
    return this.id === other.id;
  }

  // ── Close confirmation ──

  async confirmClose(): Promise<boolean> {
    // Default: always allow close (no dirty veto).
    // Concrete inputs override this to show save dialogs.
    return true;
  }

  // ── Dispose ──

  override dispose(): void {
    this._onWillDispose.fire();
    super.dispose();
  }
}

// ─── PlaceholderEditorInput ──────────────────────────────────────────────────

/**
 * Simple concrete editor input for development and testing.
 * Represents a named placeholder document.
 */
export class PlaceholderEditorInput extends EditorInput {
  readonly typeId = 'placeholder';

  constructor(
    private readonly _name: string,
    private readonly _description: string = '',
    id?: string,
  ) {
    super(id);
  }

  get name(): string { return this._name; }
  get description(): string { return this._description; }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this._name,
      description: this._description,
      pinned: false,
      sticky: false,
    };
  }
}
