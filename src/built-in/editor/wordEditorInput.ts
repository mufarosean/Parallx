// wordEditorInput.ts — Lightweight EditorInput for Word (.docx) files.
//
// A simple URI holder. WordEditorPane asks the Electron document bridge for
// rendered HTML (mammoth) and displays it as a safe, read-only document view.
// The plain-text extraction path (indexing) stays separate.

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { URI } from '../../platform/uri.js';

export class WordEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.word';

  private readonly _uri: URI;

  scrollTop = 0;
  fontScale = 1;

  static create(uri: URI, scrollTop = 0, fontScale = 1): WordEditorInput {
    const input = new WordEditorInput(uri);
    input.scrollTop = scrollTop;
    input.fontScale = fontScale;
    return input;
  }

  private constructor(uri: URI) {
    super(uri.toKey());
    this._uri = uri;
  }

  get typeId(): string { return WordEditorInput.TYPE_ID; }
  get name(): string { return this._uri.basename; }
  get description(): string { return this._uri.fsPath; }
  get uri(): URI { return this._uri; }
  get isDirty(): boolean { return false; } // read-only viewer

  override matches(other: IEditorInput): boolean {
    return other instanceof WordEditorInput && other._uri.equals(this._uri);
  }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this.name,
      description: this.description,
      pinned: false,
      sticky: false,
      data: {
        uri: this._uri.toString(),
        scrollTop: this.scrollTop,
        fontScale: this.fontScale,
      },
    };
  }
}
