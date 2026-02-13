// markdownPreviewInput.ts — EditorInput for Markdown live preview
//
// A read-only input that wraps a FileEditorInput. The MarkdownEditorPane
// renders the source file's content as formatted HTML and live-updates
// when the source changes (via onDidChangeContent from the underlying
// TextFileModel).
//
// VS Code reference:
//   src/vs/workbench/contrib/markdown/browser/previewEditorInput.ts

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { Event } from '../../platform/events.js';
import { URI } from '../../platform/uri.js';
import type { FileEditorInput } from './fileEditorInput.js';

// ─── MarkdownPreviewInput ────────────────────────────────────────────────────

export class MarkdownPreviewInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.markdownPreview';

  private readonly _sourceInput: FileEditorInput;

  // ── Factory ──

  static create(sourceInput: FileEditorInput): MarkdownPreviewInput {
    return new MarkdownPreviewInput(sourceInput);
  }

  private constructor(sourceInput: FileEditorInput) {
    // Unique ID per source URI + preview suffix
    super(sourceInput.uri.toKey() + '#preview');
    this._sourceInput = sourceInput;
  }

  // ── IEditorInput implementations ──

  get typeId(): string {
    return MarkdownPreviewInput.TYPE_ID;
  }

  get name(): string {
    return `Preview ${this._sourceInput.name}`;
  }

  get description(): string {
    return this._sourceInput.description;
  }

  /** Preview is always read-only — never dirty. */
  get isDirty(): boolean {
    return false;
  }

  /** The source file URI. */
  get uri(): URI {
    return this._sourceInput.uri;
  }

  /** The underlying FileEditorInput. */
  get sourceInput(): FileEditorInput {
    return this._sourceInput;
  }

  /** Forward content access to the source. */
  get content(): string {
    return this._sourceInput.content;
  }

  /** Forward content-change events. */
  get onDidChangeContent(): Event<string> {
    return this._sourceInput.onDidChangeContent;
  }

  /** Forward resolve to the source. */
  async resolve(): ReturnType<FileEditorInput['resolve']> {
    return this._sourceInput.resolve();
  }

  /** A preview input matches another if it has the same source URI. */
  matches(other: IEditorInput): boolean {
    if (other instanceof MarkdownPreviewInput) {
      return this._sourceInput.uri.equals(other._sourceInput.uri);
    }
    return false;
  }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: MarkdownPreviewInput.TYPE_ID,
      name: this.name,
      description: this.description,
      pinned: true,
      sticky: false,
      data: { uri: this._sourceInput.uri.toString() },
    };
  }
}
