// textFileModelManager.ts — Text file model manager
//
// Sits between IFileService (raw bytes) and editors (text panes).
// Manages per-URI text models with dirty state, content, and lifecycle.
// Multiple editors viewing the same file share one TextFileModel.
//
// VS Code reference:
//   src/vs/workbench/services/textfile/common/textFileService.ts
//   src/vs/workbench/services/textfile/common/textFileEditorModel.ts

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { URI, URIMap } from '../platform/uri.js';
import { FileChangeType, type FileChangeEvent } from '../platform/fileTypes.js';
import type { IFileService } from './serviceTypes.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TextFileModel
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory model wrapping a text resource.
 *
 * Tracks content, dirty state, and external conflict state.
 * Owned by TextFileModelManager — do not create directly.
 */
export class TextFileModel {
  readonly uri: URI;

  private _content: string = '';
  private _savedContent: string = '';
  private _isDirty: boolean = false;
  private _isConflicted: boolean = false;
  private _mtime: number = 0;
  private _refCount: number = 0;
  private _disposed: boolean = false;

  // ── Events ──
  private readonly _onDidChangeContent = new Emitter<void>();
  readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

  private readonly _onDidChangeDirty = new Emitter<boolean>();
  readonly onDidChangeDirty: Event<boolean> = this._onDidChangeDirty.event;

  private readonly _onDidChangeConflicted = new Emitter<boolean>();
  readonly onDidChangeConflicted: Event<boolean> = this._onDidChangeConflicted.event;

  private readonly _onDidDispose = new Emitter<void>();
  readonly onDidDispose: Event<void> = this._onDidDispose.event;

  constructor(
    uri: URI,
    private readonly _fileService: IFileService,
    private readonly _onModelDisposed: (uri: URI) => void,
  ) {
    this.uri = uri;
  }

  // ── Properties ──

  get content(): string {
    return this._content;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  get isConflicted(): boolean {
    return this._isConflicted;
  }

  get mtime(): number {
    return this._mtime;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  // ── Ref counting ──

  addRef(): void {
    this._refCount++;
  }

  release(): void {
    this._refCount--;
    if (this._refCount <= 0) {
      this.dispose();
    }
  }

  get refCount(): number {
    return this._refCount;
  }

  // ── Load / Resolve ──

  /**
   * Load content from disk. Sets content, clears dirty, updates mtime.
   */
  async resolve(): Promise<void> {
    const fc = await this._fileService.readFile(this.uri);
    this._content = fc.content;
    this._savedContent = fc.content;
    this._mtime = fc.mtime;

    const wasDirty = this._isDirty;
    this._isDirty = false;

    if (wasDirty) {
      this._onDidChangeDirty.fire(false);
    }

    this._onDidChangeContent.fire();
  }

  // ── Content Update ──

  /**
   * Set new content (from user editing). Updates dirty state.
   */
  updateContent(newContent: string): void {
    if (this._disposed) return;
    if (this._content === newContent) return;

    this._content = newContent;
    const nowDirty = this._content !== this._savedContent;

    if (nowDirty !== this._isDirty) {
      this._isDirty = nowDirty;
      this._onDidChangeDirty.fire(this._isDirty);
    }

    this._onDidChangeContent.fire();
  }

  // ── Save ──

  /**
   * Write current content to disk. Clears dirty and conflict state.
   */
  async save(): Promise<void> {
    if (this._disposed) return;

    await this._fileService.writeFile(this.uri, this._content);

    // Read fresh stat to get new mtime
    try {
      const stat = await this._fileService.stat(this.uri);
      this._mtime = stat.mtime;
    } catch {
      // stat may fail; keep previous mtime
    }

    this._savedContent = this._content;

    if (this._isDirty) {
      this._isDirty = false;
      this._onDidChangeDirty.fire(false);
    }

    if (this._isConflicted) {
      this._isConflicted = false;
      this._onDidChangeConflicted.fire(false);
    }
  }

  // ── Revert ──

  /**
   * Reload from disk, discarding local changes.
   */
  async revert(): Promise<void> {
    if (this._disposed) return;

    await this.resolve();

    if (this._isConflicted) {
      this._isConflicted = false;
      this._onDidChangeConflicted.fire(false);
    }
  }

  // ── External Change Notification ──

  /**
   * Called by the manager when a file change event is received.
   */
  handleExternalChange(): void {
    if (this._disposed) return;

    if (this._isDirty) {
      // File changed on disk while we have unsaved changes → conflict
      if (!this._isConflicted) {
        this._isConflicted = true;
        this._onDidChangeConflicted.fire(true);
      }
    } else {
      // Not dirty — silently reload from disk
      this.resolve().catch(() => {
        // Resolve failures are non-fatal for external changes
      });
    }
  }

  // ── Dispose ──

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._onModelDisposed(this.uri);
    this._onDidDispose.fire();
    this._onDidChangeContent.dispose();
    this._onDidChangeDirty.dispose();
    this._onDidChangeConflicted.dispose();
    this._onDidDispose.dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TextFileModelManager
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Central manager for text file models.
 *
 * - One model per URI (shared across editors)
 * - Ref-counted: first resolve() creates, last release() destroys
 * - Listens to IFileService.onDidFileChange to handle external modifications
 * - Provides saveAll() for "Save All" command
 */
export class TextFileModelManager extends Disposable {
  private readonly _models = new URIMap<TextFileModel>();
  private readonly _fileService: IFileService;

  // ── Events ──
  private readonly _onDidCreate = this._register(new Emitter<TextFileModel>());
  readonly onDidCreate: Event<TextFileModel> = this._onDidCreate.event;

  private readonly _onDidDispose = this._register(new Emitter<URI>());
  readonly onDidDispose: Event<URI> = this._onDidDispose.event;

  constructor(fileService: IFileService) {
    super();
    this._fileService = fileService;

    // Listen for file changes to update managed models
    this._register(fileService.onDidFileChange((events) => {
      this._handleFileChanges(events);
    }));
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Get or create a TextFileModel for the given URI.
   * Increments ref count. Caller must call model.release() when done.
   */
  async resolve(uri: URI): Promise<TextFileModel> {
    let model = this._models.get(uri);

    if (model && !model.isDisposed) {
      model.addRef();
      return model;
    }

    // Create new model
    model = new TextFileModel(uri, this._fileService, (disposedUri) => {
      this._models.delete(disposedUri);
      this._onDidDispose.fire(disposedUri);
    });

    this._models.set(uri, model);
    model.addRef();

    // Load content from disk
    await model.resolve();

    this._onDidCreate.fire(model);
    return model;
  }

  /**
   * Get an existing model without loading. Returns undefined if not tracked.
   */
  get(uri: URI): TextFileModel | undefined {
    const model = this._models.get(uri);
    return model && !model.isDisposed ? model : undefined;
  }

  /**
   * All currently managed models.
   */
  get models(): readonly TextFileModel[] {
    const result: TextFileModel[] = [];
    this._models.forEach((model) => {
      if (!model.isDisposed) {
        result.push(model);
      }
    });
    return result;
  }

  /**
   * Save all dirty models.
   */
  async saveAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    this._models.forEach((model) => {
      if (model.isDirty && !model.isDisposed) {
        promises.push(model.save());
      }
    });
    await Promise.all(promises);
  }

  // ── File Change Handling ───────────────────────────────────────────────

  private _handleFileChanges(events: FileChangeEvent[]): void {
    for (const event of events) {
      const model = this._models.get(event.uri);
      if (!model || model.isDisposed) continue;

      if (event.type === FileChangeType.Changed || event.type === FileChangeType.Created) {
        model.handleExternalChange();
      } else if (event.type === FileChangeType.Deleted) {
        // File was deleted — mark as conflicted if dirty, else dispose
        if (model.isDirty) {
          model.handleExternalChange();
        } else {
          model.dispose();
        }
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  override dispose(): void {
    this._models.forEach((model) => {
      if (!model.isDisposed) {
        model.dispose();
      }
    });
    this._models.clear();
    super.dispose();
  }
}
