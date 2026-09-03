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

/** A short stable hash so two different pasted images never dedupe into one tab. */
function hashOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 97) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export class ImageEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.image';
  /** Scheme of an in-memory image (a pasted chat attachment). */
  static readonly DATA_SCHEME = 'parallx-image';

  private readonly _uri: URI;
  private readonly _dataUrl: string | undefined;

  static create(uri: URI): ImageEditorInput {
    return new ImageEditorInput(uri);
  }

  /**
   * An image that exists only in memory: a pasted chat attachment has no
   * file behind it. Opens like any image; after a restart the tab can only
   * say the image is gone (serialize() never carries the bytes).
   */
  static createFromData(name: string, mimeType: string, base64: string): ImageEditorInput {
    const safe = name.replace(/[\\/]+/g, '_') || 'image';
    const uri = URI.parse(`${ImageEditorInput.DATA_SCHEME}:///${encodeURIComponent(safe)}#${hashOf(base64)}`);
    return new ImageEditorInput(uri, `data:${mimeType};base64,${base64}`);
  }

  private constructor(uri: URI, dataUrl?: string) {
    super(uri.toKey()); // deduplication by URI
    this._uri = uri;
    this._dataUrl = dataUrl;
  }

  get typeId(): string { return ImageEditorInput.TYPE_ID; }
  get name(): string { return decodeURIComponent(this._uri.basename); }
  get description(): string { return this._dataUrl ? 'Pasted image' : this._uri.fsPath; }
  get uri(): URI { return this._uri; }
  /** Present for in-memory images; the pane shows it directly. */
  get dataUrl(): string | undefined { return this._dataUrl; }
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
