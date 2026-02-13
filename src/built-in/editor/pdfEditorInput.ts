// pdfEditorInput.ts — Lightweight EditorInput for PDF files
//
// Simple URI holder for PDFs. The PdfEditorPane reads the binary
// data and renders via Chromium's built-in PDF viewer.

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { URI } from '../../platform/uri.js';

export class PdfEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.pdf';

  private readonly _uri: URI;

  static create(uri: URI): PdfEditorInput {
    return new PdfEditorInput(uri);
  }

  private constructor(uri: URI) {
    super(uri.toKey());
    this._uri = uri;
  }

  get typeId(): string { return PdfEditorInput.TYPE_ID; }
  get name(): string { return this._uri.basename; }
  get description(): string { return this._uri.fsPath; }
  get uri(): URI { return this._uri; }
  get isDirty(): boolean { return false; }

  override matches(other: IEditorInput): boolean {
    return other instanceof PdfEditorInput && other._uri.equals(this._uri);
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
