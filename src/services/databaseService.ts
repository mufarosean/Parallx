// databaseService.ts — renderer-side wrapper for database IPC operations
//
// Provides a typed interface over window.parallxElectron.database.* IPC calls.
// Manages database open/close lifecycle tied to workspace folders.
//
// This runs in the renderer process; all actual SQLite operations happen
// in the main process via IPC.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result from a SQL mutation (INSERT/UPDATE/DELETE). */
export interface DatabaseRunResult {
  changes: number;
  lastInsertRowid: number;
}

/** IPC error shape from the main process. */
interface DatabaseIpcError {
  code: string;
  message: string;
}

/** The database bridge exposed by preload.cjs. */
interface DatabaseBridge {
  open(workspacePath: string, migrationsDir?: string): Promise<{ error: DatabaseIpcError | null; dbPath?: string }>;
  close(): Promise<{ error: DatabaseIpcError | null }>;
  run(sql: string, params?: unknown[]): Promise<{ error: DatabaseIpcError | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: DatabaseIpcError | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: DatabaseIpcError | null; rows?: Record<string, unknown>[] }>;
  isOpen(): Promise<{ isOpen: boolean }>;
}

// ─── DatabaseService ─────────────────────────────────────────────────────────

/**
 * Renderer-side database service wrapping IPC calls to the main process.
 *
 * Usage:
 *   const db = new DatabaseService();
 *   await db.openForWorkspace('/path/to/workspace', '/path/to/migrations');
 *   const rows = await db.all('SELECT * FROM pages');
 *   await db.close();
 */
export class DatabaseService extends Disposable {
  private _isOpen = false;
  private _dbPath: string | null = null;

  private readonly _onDidOpen = this._register(new Emitter<string>());
  readonly onDidOpen: Event<string> = this._onDidOpen.event;

  private readonly _onDidClose = this._register(new Emitter<void>());
  readonly onDidClose: Event<void> = this._onDidClose.event;

  // ── Bridge accessor ──

  private get _bridge(): DatabaseBridge {
    const electron = (window as any).parallxElectron;
    if (!electron?.database) {
      throw new Error('[DatabaseService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ── Lifecycle ──

  /**
   * Open the database for a workspace folder.
   * Path: `<workspacePath>/.parallx/data.db`
   *
   * @param workspacePath — absolute path to the workspace root folder
   * @param migrationsDir — optional absolute path to the migrations directory
   */
  async openForWorkspace(workspacePath: string, migrationsDir?: string): Promise<void> {
    // Close any previously open database first
    if (this._isOpen) {
      await this.close();
    }

    const result = await this._bridge.open(workspacePath, migrationsDir);
    if (result.error) {
      throw new Error(`[DatabaseService] Failed to open database: ${result.error.message}`);
    }

    this._isOpen = true;
    this._dbPath = result.dbPath ?? null;
    console.log(`[DatabaseService] Database opened: ${this._dbPath}`);
    this._onDidOpen.fire(this._dbPath!);
  }

  /**
   * Close the current database.
   */
  async close(): Promise<void> {
    if (!this._isOpen) return;

    const result = await this._bridge.close();
    if (result.error) {
      console.error(`[DatabaseService] Failed to close database: ${result.error.message}`);
    }

    this._isOpen = false;
    this._dbPath = null;
    this._onDidClose.fire();
  }

  /**
   * Whether a database is currently open.
   */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * The path to the currently open database file.
   */
  get currentPath(): string | null {
    return this._dbPath;
  }

  // ── Query methods ──

  /**
   * Execute a SQL mutation (INSERT, UPDATE, DELETE, CREATE, etc.).
   */
  async run(sql: string, params: unknown[] = []): Promise<DatabaseRunResult> {
    this._ensureOpen();
    const result = await this._bridge.run(sql, params);
    if (result.error) {
      throw new Error(`[DatabaseService] SQL error: ${result.error.message}`);
    }
    return {
      changes: result.changes!,
      lastInsertRowid: result.lastInsertRowid!,
    };
  }

  /**
   * Fetch a single row. Returns null if no match.
   */
  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    this._ensureOpen();
    const result = await this._bridge.get(sql, params);
    if (result.error) {
      throw new Error(`[DatabaseService] SQL error: ${result.error.message}`);
    }
    return (result.row as T) ?? null;
  }

  /**
   * Fetch all matching rows.
   */
  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    this._ensureOpen();
    const result = await this._bridge.all(sql, params);
    if (result.error) {
      throw new Error(`[DatabaseService] SQL error: ${result.error.message}`);
    }
    return (result.rows as T[]) ?? [];
  }

  // ── Internal ──

  private _ensureOpen(): void {
    if (!this._isOpen) {
      throw new Error('[DatabaseService] No database is open. Call openForWorkspace() first.');
    }
  }

  override dispose(): void {
    // Best-effort close on dispose (fire-and-forget)
    if (this._isOpen) {
      this.close().catch(err =>
        console.error('[DatabaseService] Error closing on dispose:', err),
      );
    }
    super.dispose();
  }
}
