// fileBackedStorage.ts — File-backed IStorage implementations (M53)
//
// Replaces localStorage with JSON files persisted through the Electron IPC
// bridge. Two classes: FileBackedGlobalStorage (app-level settings) and
// FileBackedWorkspaceStorage (per-workspace state in .parallx/).

import { Emitter, Event } from './events.js';
import { IDisposable } from './lifecycle.js';
import { IStorage, StorageErrorKind } from './storage.js';

// ─── Bridge type ─────────────────────────────────────────────────────────────

/**
 * Minimal bridge to the Electron main process storage IPC handlers.
 * Matches the shape exposed by `window.parallxElectron.storage`.
 */
export interface IStorageBridge {
  readJson(filePath: string): Promise<{ data: unknown | null; error?: undefined } | { error: string; data?: undefined }>;
  writeJson(filePath: string, data: unknown): Promise<{ error: null } | { error: string }>;
  exists(filePath: string): Promise<boolean>;
}

// ─── FileBackedGlobalStorage ─────────────────────────────────────────────────

/**
 * File-backed global (app-level) storage.
 * Persists a flat key-value map as a JSON file via the IPC bridge.
 * Lazy-loads on first access, serializes writes to prevent races.
 */
export class FileBackedGlobalStorage implements IStorage, IDisposable {
  private _cache: Map<string, string> | undefined;
  private _loading: Promise<void> | undefined;
  private _writeQueue: Promise<void> = Promise.resolve();

  private readonly _onDidError = new Emitter<{ readonly kind: StorageErrorKind; readonly key: string; readonly message: string }>();
  readonly onDidError: Event<{ readonly kind: StorageErrorKind; readonly key: string; readonly message: string }> = this._onDidError.event;

  constructor(
    private readonly _bridge: IStorageBridge,
    private readonly _filePath: string,
  ) {}

  // ── Lazy load ──

  private _ensureLoaded(): Promise<void> {
    if (this._cache) return Promise.resolve();
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        const result = await this._bridge.readJson(this._filePath);
        if (result.error) {
          console.warn(`[FileBackedGlobalStorage] Read error: ${result.error}`);
          this._cache = new Map();
          this._onDidError.fire({ kind: StorageErrorKind.Unknown, key: '', message: result.error });
          return;
        }
        if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
          this._cache = new Map<string, string>();
          for (const [k, v] of Object.entries(result.data as Record<string, unknown>)) {
            if (typeof v === 'string') {
              this._cache.set(k, v);
            }
          }
        } else {
          this._cache = new Map();
        }
      } catch (err) {
        console.warn(`[FileBackedGlobalStorage] Load failed:`, err);
        this._cache = new Map();
      } finally {
        this._loading = undefined;
      }
    })();

    return this._loading;
  }

  // ── Serialized write ──

  private _flush(): void {
    this._writeQueue = this._writeQueue.then(async () => {
      if (!this._cache) return;
      const snapshot = new Map(this._cache);
      const obj: Record<string, string> = {};
      for (const [k, v] of this._cache) {
        obj[k] = v;
      }
      const result = await this._bridge.writeJson(this._filePath, obj);
      if (result.error) {
        console.warn(`[FileBackedGlobalStorage] Write error: ${result.error}`);
        this._onDidError.fire({ kind: StorageErrorKind.Unknown, key: '', message: result.error });
        this._cache = snapshot;
      }
    });
  }

  // ── IStorage ──

  async get(key: string): Promise<string | undefined> {
    await this._ensureLoaded();
    return this._cache!.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this._ensureLoaded();
    this._cache!.set(key, value);
    this._flush();
  }

  async delete(key: string): Promise<void> {
    await this._ensureLoaded();
    this._cache!.delete(key);
    this._flush();
  }

  async has(key: string): Promise<boolean> {
    await this._ensureLoaded();
    return this._cache!.has(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    await this._ensureLoaded();
    const all = [...this._cache!.keys()];
    return prefix ? all.filter(k => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> {
    await this._ensureLoaded();
    this._cache!.clear();
    this._flush();
  }

  dispose(): void {
    this._onDidError.dispose();
  }
}

// ─── FileBackedWorkspaceStorage ──────────────────────────────────────────────

/**
 * File-backed workspace storage.
 * Persists a flat key-value map as a JSON file inside the workspace's
 * .parallx/ directory. Uses a `{ version: 1, ...data }` envelope on disk.
 */
export class FileBackedWorkspaceStorage implements IStorage, IDisposable {
  private _cache: Map<string, string> | undefined;
  private _loading: Promise<void> | undefined;
  private _writeQueue: Promise<void> = Promise.resolve();

  private readonly _onDidError = new Emitter<{ readonly kind: StorageErrorKind; readonly key: string; readonly message: string }>();
  readonly onDidError: Event<{ readonly kind: StorageErrorKind; readonly key: string; readonly message: string }> = this._onDidError.event;

  constructor(
    private readonly _bridge: IStorageBridge,
    private readonly _filePath: string,
  ) {}

  // ── Lazy load ──

  private _ensureLoaded(): Promise<void> {
    if (this._cache) return Promise.resolve();
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        const result = await this._bridge.readJson(this._filePath);
        if (result.error) {
          console.warn(`[FileBackedWorkspaceStorage] Read error: ${result.error}`);
          this._cache = new Map();
          this._onDidError.fire({ kind: StorageErrorKind.Unknown, key: '', message: result.error });
          return;
        }
        if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
          this._cache = new Map<string, string>();
          const raw = result.data as Record<string, unknown>;
          for (const [k, v] of Object.entries(raw)) {
            // Skip the version envelope key
            if (k === 'version') continue;
            if (typeof v === 'string') {
              this._cache.set(k, v);
            }
          }
        } else {
          this._cache = new Map();
        }
      } catch (err) {
        console.warn(`[FileBackedWorkspaceStorage] Load failed:`, err);
        this._cache = new Map();
      } finally {
        this._loading = undefined;
      }
    })();

    return this._loading;
  }

  // ── Serialized write ──

  private _flush(): void {
    this._writeQueue = this._writeQueue.then(async () => {
      if (!this._cache) return;
      const snapshot = new Map(this._cache);
      const obj: Record<string, unknown> = { version: 1 };
      for (const [k, v] of this._cache) {
        obj[k] = v;
      }
      const result = await this._bridge.writeJson(this._filePath, obj);
      if (result.error) {
        console.warn(`[FileBackedWorkspaceStorage] Write error: ${result.error}`);
        this._onDidError.fire({ kind: StorageErrorKind.Unknown, key: '', message: result.error });
        this._cache = snapshot;
      }
    });
  }

  // ── IStorage ──

  async get(key: string): Promise<string | undefined> {
    await this._ensureLoaded();
    return this._cache!.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this._ensureLoaded();
    this._cache!.set(key, value);
    this._flush();
  }

  async delete(key: string): Promise<void> {
    await this._ensureLoaded();
    this._cache!.delete(key);
    this._flush();
  }

  async has(key: string): Promise<boolean> {
    await this._ensureLoaded();
    return this._cache!.has(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    await this._ensureLoaded();
    const all = [...this._cache!.keys()];
    return prefix ? all.filter(k => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> {
    await this._ensureLoaded();
    this._cache!.clear();
    this._flush();
  }

  dispose(): void {
    this._onDidError.dispose();
  }
}
