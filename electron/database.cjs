// electron/database.cjs — SQLite database manager for the Electron main process
//
// Manages the lifecycle of a per-workspace SQLite database:
//   - open(dbPath)  → open or create database, enable WAL + foreign keys
//   - close()       → close the current database cleanly
//   - migrate(dir)  → apply *.sql migration files in order
//   - run/get/all   → execute SQL with parameter binding
//
// The database file lives at <workspacePath>/.parallx/data.db.
// Migrations are tracked in a `_migrations` table so each is applied once.
//
// This module runs only in the Electron main process (CommonJS).

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── DatabaseManager ─────────────────────────────────────────────────────────

class DatabaseManager {
  /** @type {import('better-sqlite3').Database | null} */
  _db = null;

  /** @type {string | null} */
  _dbPath = null;

  // ── Open / Close ──

  /**
   * Open (or create) a SQLite database at the given path.
   * Enables WAL mode and foreign key enforcement.
   *
   * @param {string} dbPath — absolute path to the database file
   */
  open(dbPath) {
    if (this._db) {
      this.close();
    }

    // Ensure the parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._db = new Database(dbPath);
    this._dbPath = dbPath;

    // WAL mode for better concurrent read performance
    this._db.pragma('journal_mode = WAL');

    // Enforce foreign key constraints
    this._db.pragma('foreign_keys = ON');

    console.log(`[DatabaseManager] Opened database: ${dbPath}`);
  }

  /**
   * Close the current database cleanly.
   */
  close() {
    if (this._db) {
      try {
        this._db.close();
        console.log(`[DatabaseManager] Closed database: ${this._dbPath}`);
      } catch (err) {
        console.error(`[DatabaseManager] Error closing database:`, err.message);
      }
      this._db = null;
      this._dbPath = null;
    }
  }

  /**
   * Whether a database is currently open.
   * @returns {boolean}
   */
  get isOpen() {
    return this._db !== null;
  }

  /**
   * The path to the currently open database.
   * @returns {string | null}
   */
  get currentPath() {
    return this._dbPath;
  }

  // ── Migrations ──

  /**
   * Apply SQL migration files from a directory.
   *
   * Reads all `*.sql` files, sorts them lexicographically, and applies
   * any that haven't been recorded in the `_migrations` table yet.
   * Each migration runs inside a transaction for atomicity.
   *
   * @param {string} migrationsDir — directory containing *.sql files
   */
  migrate(migrationsDir) {
    this._ensureOpen();

    // Create the migrations tracking table if it doesn't exist
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Read migration files
    let files;
    try {
      files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort(); // lexicographic: 001_xxx.sql, 002_xxx.sql, ...
    } catch (err) {
      console.warn(`[DatabaseManager] Cannot read migrations directory "${migrationsDir}":`, err.message);
      return;
    }

    if (files.length === 0) {
      console.log('[DatabaseManager] No migration files found');
      return;
    }

    // Get already-applied migrations
    const applied = new Set(
      this._db.prepare('SELECT name FROM _migrations').all().map(r => r.name),
    );

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const runMigration = this._db.transaction(() => {
        this._db.exec(sql);
        this._db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      });

      try {
        runMigration();
        appliedCount++;
        console.log(`[DatabaseManager] Applied migration: ${file}`);
      } catch (err) {
        console.error(`[DatabaseManager] Migration "${file}" failed:`, err.message);
        throw err; // Fail fast — don't skip broken migrations
      }
    }

    if (appliedCount > 0) {
      console.log(`[DatabaseManager] ${appliedCount} migration(s) applied`);
    } else {
      console.log('[DatabaseManager] All migrations already applied');
    }
  }

  // ── Query Methods ──

  /**
   * Execute a SQL statement with optional parameters.
   * Use for INSERT, UPDATE, DELETE, CREATE, etc.
   *
   * @param {string} sql — SQL statement
   * @param {any[]} [params] — bound parameters
   * @returns {{ changes: number, lastInsertRowid: number | bigint }}
   */
  run(sql, params = []) {
    this._ensureOpen();
    return this._db.prepare(sql).run(...params);
  }

  /**
   * Fetch a single row. Returns undefined if no match.
   *
   * @param {string} sql — SQL query
   * @param {any[]} [params] — bound parameters
   * @returns {object | undefined}
   */
  get(sql, params = []) {
    this._ensureOpen();
    return this._db.prepare(sql).get(...params);
  }

  /**
   * Fetch all matching rows.
   *
   * @param {string} sql — SQL query
   * @param {any[]} [params] — bound parameters
   * @returns {object[]}
   */
  all(sql, params = []) {
    this._ensureOpen();
    return this._db.prepare(sql).all(...params);
  }

  // ── Internal ──

  /**
   * Throw if no database is open.
   */
  _ensureOpen() {
    if (!this._db) {
      throw new Error('[DatabaseManager] No database is open. Call open(dbPath) first.');
    }
  }
}

// Export a singleton instance (main process is single-threaded)
const databaseManager = new DatabaseManager();

module.exports = { DatabaseManager, databaseManager };
