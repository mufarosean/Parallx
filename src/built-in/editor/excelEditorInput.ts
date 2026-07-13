// excelEditorInput.ts — Lightweight EditorInput for spreadsheet files.
//
// A simple URI holder for Excel/ODS/CSV workbooks. ExcelEditorPane asks the
// Electron document bridge for per-sheet rows and renders them as a read-only
// grid. The plain-text extraction path (indexing) stays separate.

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { URI } from '../../platform/uri.js';

export class ExcelEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.excel';

  private readonly _uri: URI;

  activeSheet = 0;

  static create(uri: URI, activeSheet = 0): ExcelEditorInput {
    const input = new ExcelEditorInput(uri);
    input.activeSheet = activeSheet;
    return input;
  }

  private constructor(uri: URI) {
    super(uri.toKey());
    this._uri = uri;
  }

  get typeId(): string { return ExcelEditorInput.TYPE_ID; }
  get name(): string { return this._uri.basename; }
  get description(): string { return this._uri.fsPath; }
  get uri(): URI { return this._uri; }
  get isDirty(): boolean { return false; } // read-only viewer

  override matches(other: IEditorInput): boolean {
    return other instanceof ExcelEditorInput && other._uri.equals(this._uri);
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
        activeSheet: this.activeSheet,
      },
    };
  }
}
