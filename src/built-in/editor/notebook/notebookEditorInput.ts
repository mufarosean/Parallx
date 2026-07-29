// notebookEditorInput.ts — the `.ipynb` document as an editor input (M96)
//
// Owns the parsed document and the dirty flag. Deliberately NOT backed by
// TextFileModel like FileEditorInput: that model tracks a string, and a
// notebook's identity is a structure. Routing it through text would mean
// re-serialising on every keystroke to detect dirtiness, and any external
// reload would arrive as a wholesale string swap that discards cell identity —
// and with it, which cell is running, which is selected, and where the caret
// is.

import { EditorInput, type IEditorInput } from '../../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../../editor/editorTypes.js';
import { URI } from '../../../platform/uri.js';
import { Emitter, type Event } from '../../../platform/events.js';
import type { IFileService } from '../../../services/serviceTypes.js';
import {
  parseNotebook,
  serialiseNotebook,
  createEmptyNotebook,
  NotebookParseError,
  type NotebookDocument,
} from './notebookModel.js';

export class NotebookEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.notebook';

  private _document: NotebookDocument | undefined;
  private _loadError: string | undefined;
  private _relativePath: string | undefined;

  private readonly _onDidChangeDocument = this._register(new Emitter<void>());
  /** Fires when cells are added, removed, or reordered — not on every keystroke. */
  readonly onDidChangeDocument: Event<void> = this._onDidChangeDocument.event;

  static create(uri: URI, fileService: IFileService, relativePath?: string): NotebookEditorInput {
    return new NotebookEditorInput(uri, fileService, relativePath);
  }

  private constructor(
    private readonly _uri: URI,
    private readonly _fileService: IFileService,
    relativePath?: string,
  ) {
    super(_uri.toKey());
    this._relativePath = relativePath;
  }

  get typeId(): string { return NotebookEditorInput.TYPE_ID; }
  get name(): string { return this._uri.basename; }
  get description(): string { return this._relativePath ?? this._uri.fsPath; }
  get uri(): URI { return this._uri; }

  get document(): NotebookDocument | undefined { return this._document; }
  get loadError(): string | undefined { return this._loadError; }

  /** Read and parse from disk. Idempotent — a second call returns the loaded doc. */
  async resolve(): Promise<NotebookDocument | undefined> {
    if (this._document || this._loadError) return this._document;
    try {
      const { content } = await this._fileService.readFile(this._uri);
      // An empty file is a new notebook, not a parse error: `New File` +
      // rename to `.ipynb` is a normal way to start one.
      this._document = content.trim() === '' ? createEmptyNotebook() : parseNotebook(content);
    } catch (err) {
      this._loadError = err instanceof NotebookParseError
        ? err.message
        : `Could not open the notebook: ${(err as Error).message}`;
    }
    return this._document;
  }

  /**
   * Mark modified. Callers mutate the document in place — it is a live model
   * shared with the pane, and copying it per edit would break the cell
   * identity the pane relies on for DOM reuse.
   */
  markDirty(structural = false): void {
    this.setDirty(true);
    if (structural) this._onDidChangeDocument.fire();
  }

  async save(): Promise<void> {
    if (!this._document) return;
    await this._fileService.writeFile(this._uri, serialiseNotebook(this._document));
    this.setDirty(false);
  }

  override matches(other: IEditorInput): boolean {
    return other instanceof NotebookEditorInput && other._uri.equals(this._uri);
  }

  /**
   * A dirty notebook must not close silently — outputs from a long run are
   * expensive to reproduce.
   */
  override async confirmClose(): Promise<boolean> {
    if (!this.isDirty) return true;
    const result = await this._fileService.showMessageBox({
      type: 'warning',
      message: `Save changes to ${this.name}?`,
      detail: 'Your edits and cell outputs will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (result.response === 0) { await this.save(); return true; }
    if (result.response === 1) return true;
    return false;
  }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this.name,
      description: this.description,
      pinned: false,
      sticky: false,
      data: { uri: this._uri.toString(), relativePath: this._relativePath },
    };
  }
}
