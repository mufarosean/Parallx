// fileEditorInput.ts — EditorInput for files on disk
//
// Represents a file resource that can be opened in an editor.
// Uses TextFileModel for content management, dirty state, save/revert.
//
// VS Code reference:
//   src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { Emitter, Event } from '../../platform/events.js';
import { URI } from '../../platform/uri.js';
import type { TextFileModel } from '../../services/textFileModelManager.js';
import type { ITextFileModelManager, IFileService } from '../../services/serviceTypes.js';

// ─── FileEditorInput ─────────────────────────────────────────────────────────

export class FileEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.file';

  private _uri: URI;
  private _model: TextFileModel | null = null;

  private readonly _onDidChangeContent = this._register(new Emitter<string>());
  readonly onDidChangeContent: Event<string> = this._onDidChangeContent.event;

  // Service references
  private readonly _textFileModelManager: ITextFileModelManager;
  private readonly _fileService: IFileService;

  // Optional workspace-relative path for description
  private _relativePath: string | undefined;

  // ── Factory ──

  static create(
    uri: URI,
    textFileModelManager: ITextFileModelManager,
    fileService: IFileService,
    relativePath?: string,
  ): FileEditorInput {
    return new FileEditorInput(uri, textFileModelManager, fileService, relativePath);
  }

  private constructor(
    uri: URI,
    textFileModelManager: ITextFileModelManager,
    fileService: IFileService,
    relativePath?: string,
  ) {
    // Use URI key as input ID for deduplication
    super(uri.toKey());
    this._uri = uri;
    this._textFileModelManager = textFileModelManager;
    this._fileService = fileService;
    this._relativePath = relativePath;
  }

  // ── Abstract implementations ──

  get typeId(): string {
    return FileEditorInput.TYPE_ID;
  }

  get name(): string {
    return this._uri.basename;
  }

  get description(): string {
    return this._relativePath ?? this._uri.fsPath;
  }

  get uri(): URI {
    return this._uri;
  }

  get isDirty(): boolean {
    return this._model?.isDirty ?? false;
  }

  get content(): string {
    return this._model?.content ?? '';
  }

  // ── Resolve (lazy load) ──

  async resolve(): Promise<TextFileModel> {
    if (this._model && !this._model.isDisposed) {
      return this._model;
    }

    const model = await this._textFileModelManager.resolve(this._uri);
    this._model = model;

    // Wire model events to input events
    this._register(model.onDidChangeDirty((dirty) => {
      this.setDirty(dirty);
    }));

    this._register(model.onDidChangeContent(() => {
      this._onDidChangeContent.fire(model.content);
    }));

    // Initially sync dirty state
    this.setDirty(model.isDirty);

    return model;
  }

  // ── Content Update ──

  updateContent(newContent: string): void {
    this._model?.updateContent(newContent);
  }

  // ── Save ──

  async save(): Promise<void> {
    if (!this._model) return;
    await this._model.save();
  }

  async saveAs(targetUri: URI): Promise<FileEditorInput | undefined> {
    // Write current content to the new URI
    await this._fileService.writeFile(targetUri, this.content);

    // Update this input's URI to point to the new location
    this._uri = targetUri;
    this._relativePath = undefined; // will be recalculated if needed

    // Re-resolve from the new location
    if (this._model) {
      this._model.release();
      this._model = null;
    }
    await this.resolve();

    this.fireLabelChange();
    return this;
  }

  // ── Revert ──

  async revert(): Promise<void> {
    if (!this._model) return;
    await this._model.revert();
  }

  // ── Close Confirmation ──

  override async confirmClose(): Promise<boolean> {
    if (!this.isDirty) return true;

    const electron = (globalThis as any).parallxElectron;
    if (electron?.dialog?.showMessageBox) {
      const result = await electron.dialog.showMessageBox({
        type: 'warning',
        message: `Do you want to save the changes you made to ${this.name}?`,
        detail: 'Your changes will be lost if you don\'t save them.',
        buttons: ['Save', 'Don\'t Save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });

      if (result.response === 0) {
        // Save
        await this.save();
        return true;
      } else if (result.response === 1) {
        // Don't Save
        return true;
      } else {
        // Cancel
        return false;
      }
    }

    // Fallback: always allow close
    return true;
  }

  // ── Identity ──

  override matches(other: IEditorInput): boolean {
    if (other instanceof FileEditorInput) {
      return this._uri.equals(other._uri);
    }
    return super.matches(other);
  }

  // ── Serialization ──

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this.name,
      description: this.description,
      pinned: true,
      sticky: false,
      data: { uri: this._uri.toString() },
    };
  }

  // ── Dispose ──

  override dispose(): void {
    if (this._model) {
      this._model.release();
      this._model = null;
    }
    super.dispose();
  }
}
