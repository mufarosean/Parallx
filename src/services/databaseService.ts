// databaseService.ts — renderer-side wrapper for database IPC operations
//
// Provides a typed interface over window.parallxElectron.database.* IPC calls.
// Manages database open/close lifecycle tied to workspace folders.
//
// This runs in the renderer process; all actual SQLite operations happen
// in the main process via IPC.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IDatabaseService } from './serviceTypes.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result from a SQL mutation (INSERT/UPDATE/DELETE). */
export interface DatabaseRunResult {
  changes: number;
  lastInsertRowid: number;
}

/** A single operation within a batched transaction. */
export interface TransactionOp {
  type: 'run' | 'get' | 'all';
  sql: string;
  params?: unknown[];
}

/** IPC error shape from the main process. */
interface DatabaseIpcError {
  code: string;
  message: string;
}

/** The database bridge exposed by preload.cjs. */
interface DatabaseBridge {
  open(workspacePath: string, migrationsDir?: string): Promise<{ error: DatabaseIpcError | null; dbPath?: string }>;
  migrate(migrationsDir: string): Promise<{ error: DatabaseIpcError | null }>;
  close(): Promise<{ error: DatabaseIpcError | null }>;
  run(sql: string, params?: unknown[]): Promise<{ error: DatabaseIpcError | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: DatabaseIpcError | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: DatabaseIpcError | null; rows?: Record<string, unknown>[] }>;
  isOpen(): Promise<{ isOpen: boolean }>;
  runTransaction(operations: TransactionOp[]): Promise<{ error: DatabaseIpcError | null; results?: unknown[] }>;
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
export class DatabaseService extends Disposable implements IDatabaseService {
  private _isOpen = false;
  private _dbPath: string | null = null;
  /** Mutex: if non-null, an open operation is already in progress. */
  private _openPromise: Promise<void> | null = null;

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
    // If already opening, reuse the pending promise (mutex)
    if (this._openPromise) {
      return this._openPromise;
    }

    this._openPromise = this._doOpenForWorkspace(workspacePath, migrationsDir);
    try {
      await this._openPromise;
    } finally {
      this._openPromise = null;
    }
  }

  private async _doOpenForWorkspace(workspacePath: string, migrationsDir?: string): Promise<void> {
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
   * Run migrations from a directory on the currently-open database.
   * Safe to call multiple times — already-applied migrations are skipped.
   *
   * @param migrationsDir — absolute path to the directory containing *.sql files
   */
  async migrate(migrationsDir: string): Promise<void> {
    this._ensureOpen();
    const result = await this._bridge.migrate(migrationsDir);
    if (result.error) {
      throw new Error(`[DatabaseService] Migration failed: ${result.error.message}`);
    }
    console.log(`[DatabaseService] Migrations applied from: ${migrationsDir}`);
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

  /**
   * Execute multiple operations inside a single IMMEDIATE transaction.
   * Returns an array of results in the same order as operations.
   *
   * Each result's shape depends on the op type:
   * - 'run' → `{ changes, lastInsertRowid }`
   * - 'get' → `{ row }` (or `{ row: null }`)
   * - 'all' → `{ rows }`
   */
  async runTransaction(operations: TransactionOp[]): Promise<unknown[]> {
    this._ensureOpen();
    const result = await this._bridge.runTransaction(operations);
    if (result.error) {
      throw new Error(`[DatabaseService] Transaction error: ${result.error.message}`);
    }
    return result.results ?? [];
  }

  // ── Internal ──

  private _ensureOpen(): void {
    if (!this._isOpen) {
      throw new Error('[DatabaseService] No database is open. Call openForWorkspace() first.');
    }
  }

  override dispose(): void {
    // Prevent post-dispose queries by clearing state immediately
    const wasOpen = this._isOpen;
    this._isOpen = false;
    this._dbPath = null;
    this._openPromise = null;

    // Best-effort close on dispose (fire-and-forget)
    if (wasOpen) {
      this._bridge.close().catch(err =>
        console.error('[DatabaseService] Error closing on dispose:', err),
      );
    }
    super.dispose();
  }
}
