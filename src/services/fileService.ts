// fileService.ts — Filesystem service backed by Electron IPC
//
// Implements IFileService by delegating to `window.parallxElectron.fs.*`
// and `window.parallxElectron.dialog.*`. Provides event aggregation,
// error normalization, and watcher lifecycle management.
//
// VS Code reference:
//   src/vs/platform/files/common/fileService.ts — FileService
//   src/vs/platform/files/node/diskFileSystemProvider.ts — Node.js operations

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { URI } from '../platform/uri.js';
import {
  FileType,
  FileChangeType,
  FileOperationError,
  FileOperationErrorCode,
  type FileStat,
  type FileContent,
  type FileEntry,
  type FileChangeEvent,
  type FileDeleteOptions,
  type OpenFileOptions,
  type OpenFolderOptions,
  type SaveFileOptions,
  type MessageBoxOptions,
  type MessageBoxResult,
} from '../platform/fileTypes.js';
import type { IFileService } from './serviceTypes.js';

// ── Electron bridge shape ──────────────────────────────────────────────────

/** Subset of window.parallxElectron.fs we use. */
interface ElectronFsBridge {
  readFile(path: string, encoding?: string): Promise<any>;
  writeFile(path: string, content: string, encoding?: string): Promise<any>;
  stat(path: string): Promise<any>;
  readdir(path: string): Promise<any>;
  exists(path: string): Promise<boolean>;
  rename(oldPath: string, newPath: string): Promise<any>;
  delete(path: string, options?: { useTrash?: boolean; recursive?: boolean }): Promise<any>;
  mkdir(path: string): Promise<any>;
  copy(source: string, destination: string): Promise<any>;
  watch(path: string, options?: { recursive?: boolean }): Promise<any>;
  unwatch(watchId: string): Promise<any>;
  onDidChange(callback: (payload: any) => void): () => void;
}

interface ElectronDialogBridge {
  openFile(options?: any): Promise<string[] | null>;
  openFolder(options?: any): Promise<string[] | null>;
  saveFile(options?: any): Promise<string | null>;
  showMessageBox(options: any): Promise<{ response: number; checkboxChecked: boolean }>;
}

function getElectronFs(): ElectronFsBridge {
  const api = (window as any).parallxElectron;
  if (!api?.fs) {
    throw new FileOperationError(
      'Filesystem not available — Electron bridge not detected',
      FileOperationErrorCode.FILE_UNAVAILABLE,
    );
  }
  return api.fs;
}

function getElectronDialog(): ElectronDialogBridge {
  const api = (window as any).parallxElectron;
  if (!api?.dialog) {
    throw new FileOperationError(
      'Dialog API not available — Electron bridge not detected',
      FileOperationErrorCode.FILE_UNAVAILABLE,
    );
  }
  return api.dialog;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseFileType(type: string): FileType {
  switch (type) {
    case 'directory': return FileType.Directory;
    case 'symlink': return FileType.SymbolicLink;
    case 'file': return FileType.File;
    default: return FileType.Unknown;
  }
}

function throwIfError(result: any, uri: URI): void {
  if (result?.error) {
    const e = result.error;
    throw new FileOperationError(e.message || 'Unknown error', e.code || FileOperationErrorCode.FILE_UNKNOWN, uri);
  }
}

// ── Simple LRU Cache ───────────────────────────────────────────────────────

class LRUCache<K, V> {
  private readonly _map = new Map<K, V>();
  constructor(private readonly _max: number) {}

  get(key: K): V | undefined {
    const v = this._map.get(key);
    if (v !== undefined) {
      // Move to end (most recently used)
      this._map.delete(key);
      this._map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    this._map.delete(key);
    this._map.set(key, value);
    if (this._map.size > this._max) {
      // Evict oldest
      const first = this._map.keys().next().value;
      if (first !== undefined) this._map.delete(first);
    }
  }

  delete(key: K): void {
    this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FileService
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renderer-side filesystem service.
 *
 * Delegates all operations to `window.parallxElectron.fs.*` via structured IPC.
 * Provides:
 *  - Consistent URI-based interface (no raw paths in consumers)
 *  - Error normalization into FileOperationError
 *  - File change events via onDidFileChange
 *  - Watcher lifecycle management (auto-cleanup on dispose)
 *  - Simple LRU content cache (invalidated on change events)
 */
export class FileService extends Disposable implements IFileService {
  // ── Events ──
  private readonly _onDidFileChange = this._register(new Emitter<FileChangeEvent[]>());
  readonly onDidFileChange: Event<FileChangeEvent[]> = this._onDidFileChange.event;

  // ── Watchers ──
  private readonly _watchers = new Map<string, { watchId: string; uri: URI }>();
  private _changeListenerDispose: (() => void) | null = null;

  // ── Cache ──
  private readonly _contentCache = new LRUCache<string, FileContent>(20);
  private _boundaryChecker: ((uri: URI, operation: string) => void) | undefined;

  constructor() {
    super();

    // Subscribe to the global file change push channel
    try {
      const fs = getElectronFs();
      this._changeListenerDispose = fs.onDidChange((payload: any) => {
        this._handleChangePayload(payload);
      });
    } catch {
      // No Electron bridge — browser-only mode, no watcher events
    }
  }

  setBoundaryChecker(checker: ((uri: URI, operation: string) => void) | undefined): void {
    this._boundaryChecker = checker;
  }

  // ── File Operations ────────────────────────────────────────────────────

  async readFile(uri: URI): Promise<FileContent> {
    this._assertBoundary(uri, 'readFile');
    // Check cache first
    const cached = this._contentCache.get(uri.toKey());
    if (cached) return cached;

    const fs = getElectronFs();
    const result = await fs.readFile(uri.fsPath);
    throwIfError(result, uri);

    const content: FileContent = {
      content: result.content,
      encoding: result.encoding,
      size: result.size,
      mtime: result.mtime,
    };

    // Cache (only text content, not binary base64)
    if (result.encoding !== 'base64') {
      this._contentCache.set(uri.toKey(), content);
    }

    return content;
  }

  async writeFile(uri: URI, content: string): Promise<void> {
    this._assertBoundary(uri, 'writeFile');
    const fs = getElectronFs();
    const result = await fs.writeFile(uri.fsPath, content);
    throwIfError(result, uri);

    // Invalidate cache
    this._contentCache.delete(uri.toKey());
  }

  async stat(uri: URI): Promise<FileStat> {
    this._assertBoundary(uri, 'stat');
    const fs = getElectronFs();
    const result = await fs.stat(uri.fsPath);
    throwIfError(result, uri);

    return {
      type: parseFileType(result.type),
      size: result.size,
      mtime: result.mtime,
      ctime: result.ctime,
      isReadonly: result.isReadonly,
      uri,
    };
  }

  async readdir(uri: URI): Promise<FileEntry[]> {
    this._assertBoundary(uri, 'readdir');
    const fs = getElectronFs();
    const result = await fs.readdir(uri.fsPath);
    throwIfError(result, uri);

    return (result.entries as any[]).map((e: any) => ({
      name: e.name,
      uri: uri.joinPath(e.name),
      type: parseFileType(e.type),
      size: e.size,
      mtime: e.mtime,
    }));
  }

  async exists(uri: URI): Promise<boolean> {
    this._assertBoundary(uri, 'exists');
    const fs = getElectronFs();
    return fs.exists(uri.fsPath);
  }

  async rename(source: URI, target: URI): Promise<void> {
    this._assertBoundary(source, 'rename:source');
    this._assertBoundary(target, 'rename:target');
    const fs = getElectronFs();
    const result = await fs.rename(source.fsPath, target.fsPath);
    throwIfError(result, source);
    this._contentCache.delete(source.toKey());
    this._contentCache.delete(target.toKey());
  }

  async delete(uri: URI, options?: FileDeleteOptions): Promise<void> {
    this._assertBoundary(uri, 'delete');
    const fs = getElectronFs();
    const result = await fs.delete(uri.fsPath, {
      useTrash: options?.useTrash !== false,
      recursive: options?.recursive,
    });
    throwIfError(result, uri);
    this._contentCache.delete(uri.toKey());
  }

  async mkdir(uri: URI): Promise<void> {
    this._assertBoundary(uri, 'mkdir');
    const fs = getElectronFs();
    const result = await fs.mkdir(uri.fsPath);
    throwIfError(result, uri);
  }

  async copy(source: URI, target: URI): Promise<void> {
    this._assertBoundary(source, 'copy:source');
    this._assertBoundary(target, 'copy:target');
    const fs = getElectronFs();
    const result = await fs.copy(source.fsPath, target.fsPath);
    throwIfError(result, source);
  }

  // ── Watchers ───────────────────────────────────────────────────────────

  async watch(uri: URI): Promise<IDisposable> {
    this._assertBoundary(uri, 'watch');
    const fs = getElectronFs();
    const result = await fs.watch(uri.fsPath, { recursive: true });
    throwIfError(result, uri);

    const watchId = result.watchId as string;
    this._watchers.set(watchId, { watchId, uri });

    return toDisposable(() => {
      this._watchers.delete(watchId);
      fs.unwatch(watchId).catch(() => { /* ignore unwatch errors */ });
    });
  }

  // ── Dialogs ────────────────────────────────────────────────────────────

  async openFileDialog(options?: OpenFileOptions): Promise<URI[] | null> {
    const dlg = getElectronDialog();
    const paths = await dlg.openFile(options);
    if (!paths) return null;
    return paths.map((p) => URI.file(p));
  }

  async openFolderDialog(options?: OpenFolderOptions): Promise<URI[] | null> {
    const dlg = getElectronDialog();
    const paths = await dlg.openFolder(options);
    if (!paths) return null;
    return paths.map((p) => URI.file(p));
  }

  async saveFileDialog(options?: SaveFileOptions): Promise<URI | null> {
    const dlg = getElectronDialog();
    const result = await dlg.saveFile(options);
    if (!result) return null;
    return URI.file(result);
  }

  async showMessageBox(options: MessageBoxOptions): Promise<MessageBoxResult> {
    const dlg = getElectronDialog();
    return dlg.showMessageBox(options);
  }

  private _assertBoundary(uri: URI, operation: string): void {
    this._boundaryChecker?.(uri, operation);
  }

  // ── Event Handling ─────────────────────────────────────────────────────

  private _handleChangePayload(payload: any): void {
    if (payload.error) {
      // Watcher error — auto-cleanup is handled by main process
      this._watchers.delete(payload.watchId);
      return;
    }

    if (!payload.events || !Array.isArray(payload.events)) return;

    const changes: FileChangeEvent[] = [];
    for (const evt of payload.events) {
      let changeType: FileChangeType;
      switch (evt.type) {
        case 'created': changeType = FileChangeType.Created; break;
        case 'deleted': changeType = FileChangeType.Deleted; break;
        case 'changed':
        default: changeType = FileChangeType.Changed; break;
      }

      const uri = URI.file(evt.path);
      changes.push({ type: changeType, uri });

      // Invalidate cache for changed files
      this._contentCache.delete(uri.toKey());
    }

    if (changes.length > 0) {
      this._onDidFileChange.fire(changes);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  override dispose(): void {
    // Unsubscribe from change events
    if (this._changeListenerDispose) {
      this._changeListenerDispose();
      this._changeListenerDispose = null;
    }

    // Unwatch all active watchers
    try {
      const fs = getElectronFs();
      for (const [, entry] of this._watchers) {
        fs.unwatch(entry.watchId).catch(() => {});
      }
    } catch {
      // No bridge
    }
    this._watchers.clear();

    // Clear cache
    this._contentCache.clear();

    super.dispose();
  }
}
