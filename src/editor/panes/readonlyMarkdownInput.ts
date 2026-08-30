// readonlyMarkdownInput.ts — EditorInput for in-memory read-only markdown
//
// Displays content that exists only in memory (not backed by a file) as
// rendered markdown.  Used by the session-memory viewer and any future
// feature that needs to show computed/fetched markdown in the editor area.
//
// The MarkdownEditorPane reads `.content` and `.onDidChangeContent` directly
// — no file resolution needed.

import { EditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { Emitter, Event } from '../../platform/events.js';
import { URI } from '../../platform/uri.js';

// ─── Counter ─────────────────────────────────────────────────────────────────

let _readonlyCounter = 1;

// ─── ReadonlyMarkdownInput ───────────────────────────────────────────────────

export class ReadonlyMarkdownInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.readonlyMarkdown';

  private readonly _uri: URI;
  private readonly _name: string;
  private _content: string;

  private readonly _onDidChangeContent = this._register(new Emitter<string>());
  readonly onDidChangeContent: Event<string> = this._onDidChangeContent.event;

  // ── Factory ──

  static create(content: string, name: string): ReadonlyMarkdownInput {
    return new ReadonlyMarkdownInput(content, name);
  }

  private constructor(content: string, name: string) {
    const n = _readonlyCounter++;
    const id = `readonly-md-${n}`;
    super(id);
    this._name = name;
    this._content = content;
    this._uri = URI.parse(`parallx-readonly-md://${id}`);
  }

  // ── IEditorInput implementations ──

  get typeId(): string { return ReadonlyMarkdownInput.TYPE_ID; }
  get name(): string { return this._name; }
  get description(): string { return ''; }
  get uri(): URI { return this._uri; }
  get content(): string { return this._content; }

  /** Read-only — never dirty. */
  get isDirty(): boolean { return false; }

  /** Update content (triggers re-render in MarkdownEditorPane). */
  updateContent(newContent: string): void {
    if (this._content === newContent) return;
    this._content = newContent;
    this._onDidChangeContent.fire(newContent);
  }

  /** No save — content is transient. */
  async save(): Promise<URI | undefined> { return undefined; }

  /** No revert — content is transient. */
  async revert(): Promise<void> {}

  /** Close without prompting. */
  override async confirmClose(): Promise<boolean> { return true; }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this._name,
      pinned: false,
      sticky: false,
      data: { content: this._content },
    };
  }
}
