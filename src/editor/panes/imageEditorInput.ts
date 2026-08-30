// imageEditorInput.ts — Lightweight EditorInput for image files
//
// Unlike FileEditorInput (which uses TextFileModel for text content),
// ImageEditorInput is a simple URI holder. The ImageEditorPane reads
// the binary data directly via the file system IPC.
//
// VS Code reference:
//   src/vs/workbench/contrib/files/browser/editors/binaryFileEditor.ts

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { URI } from '../../platform/uri.js';

export class ImageEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.image';

  private readonly _uri: URI;

  static create(uri: URI): ImageEditorInput {
    return new ImageEditorInput(uri);
  }

  private constructor(uri: URI) {
    super(uri.toKey()); // deduplication by URI
    this._uri = uri;
  }

  get typeId(): string { return ImageEditorInput.TYPE_ID; }
  get name(): string { return this._uri.basename; }
  get description(): string { return this._uri.fsPath; }
  get uri(): URI { return this._uri; }
  get isDirty(): boolean { return false; } // images are read-only

  override matches(other: IEditorInput): boolean {
    return other instanceof ImageEditorInput && other._uri.equals(this._uri);
  }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this.name,
      description: this.description,
      pinned: false,
      sticky: false,
      data: { uri: this._uri.toString() },
    };
  }
}
