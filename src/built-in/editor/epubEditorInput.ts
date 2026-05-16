// epubEditorInput.ts - Lightweight EditorInput for EPUB files
//
// Simple URI holder for EPUBs. The EpubEditorPane asks the Electron document
// extraction bridge for plain text and renders it as a safe reader view.

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { URI } from '../../platform/uri.js';

export class EpubEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.epub';

  private readonly _uri: URI;

  scrollTop = 0;
  fontScale = 1;

  static create(uri: URI, scrollTop = 0, fontScale = 1): EpubEditorInput {
    const input = new EpubEditorInput(uri);
    input.scrollTop = scrollTop;
    input.fontScale = fontScale;
    return input;
  }

  private constructor(uri: URI) {
    super(uri.toKey());
    this._uri = uri;
  }

  get typeId(): string { return EpubEditorInput.TYPE_ID; }
  get name(): string { return this._uri.basename; }
  get description(): string { return this._uri.fsPath; }
  get uri(): URI { return this._uri; }
  get isDirty(): boolean { return false; }

  override matches(other: IEditorInput): boolean {
    return other instanceof EpubEditorInput && other._uri.equals(this._uri);
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
