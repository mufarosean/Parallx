// electron/migrationRunner.cjs
// M86-W4 — Migration framework wrapper.
//
// Wraps the historic single-transaction migration model in a small runner
// that understands an optional first-line header:
//
//   -- @parallx:migration { "id": "021", "chunked": true, "batchSize": 500 }
//
// Header fields (all optional):
//   id           — string label for logging only
//   chunked      — boolean. When true, the SQL is split on lines matching
//                  `-- @parallx:chunk` and each chunk runs in its own
//                  transaction. Between chunks we yield via setImmediate so
//                  the SQLite write lock is released and concurrent writers
//                  (e.g. watcher INSERTs) can interleave. This is the M64
//                  pattern documented in /memories/debugging.md.
//   batchSize    — informational. Authors are expected to keep each chunk
//                  reasonably small (~500 rows); the runner does not split
//                  further. Default 500 (used only in logs).
//   blocksWriters — informational. Defaults true; chunked migrations should
//                  set this false to advertise that they yield.
//
// When no header is present we behave exactly like the historic loop: one
// transaction, blocking, atomic. No migration changes behavior unless its
// author opts in by adding a header.

'use strict';

const DEFAULT_HEADER = Object.freeze({
  id: null,
  chunked: false,
  batchSize: 500,
  blocksWriters: true,
});

/**
 * Parse the optional first-line @parallx:migration header.
 *
 * @param {string} sql
 * @returns {{ id: string|null, chunked: boolean, batchSize: number, blocksWriters: boolean }}
 */
function parseHeader(sql) {
  if (typeof sql !== 'string' || sql.length === 0) {
    return { ...DEFAULT_HEADER };
  }
  // Strip a UTF-8 BOM if present, then look at the first non-empty line.
  const text = sql.charCodeAt(0) === 0xfeff ? sql.slice(1) : sql;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const match = firstLine.match(/^\s*--\s*@parallx:migration\s+(\{.*\})\s*$/);
  if (!match) {
    return { ...DEFAULT_HEADER };
  }
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { ...DEFAULT_HEADER };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULT_HEADER };
  }
  return {
    id: typeof parsed.id === 'string' ? parsed.id : null,
    chunked: parsed.chunked === true,
    batchSize: Number.isFinite(parsed.batchSize) ? Number(parsed.batchSize) : 500,
    blocksWriters: parsed.blocksWriters !== false,
  };
}

/**
 * Split SQL into chunks delimited by lines matching `-- @parallx:chunk`.
 * The header line (if any) is preserved on the first chunk; SQLite ignores
 * single-line comments so this is harmless.
 *
 * @param {string} sql
 * @returns {string[]}
 */
function splitChunks(sql) {
  const lines = sql.split(/\r?\n/);
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if (/^\s*--\s*@parallx:chunk\b/.test(line)) {
      if (current.length > 0) {
        chunks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }
  // Drop empty/whitespace-only chunks so authors can put `-- @parallx:chunk`
  // at the top or bottom without creating empty transactions.
  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Apply one migration file to a better-sqlite3 database.
 *
 * @param {object} args
 * @param {import('better-sqlite3').Database} args.db
 * @param {string} args.name        — migration filename, e.g. "021_foo.sql"
 * @param {string} args.sql         — file contents
 * @param {(name: string) => void} [args.recordApplied] — called inside the
 *        final transaction to mark the migration as applied. Defaults to a
 *        no-op so unit tests can drive the runner without the `_migrations`
 *        table.
 * @param {{ log: Function, warn: Function, error: Function }} [args.logger]
 * @returns {Promise<{ header: object, chunkCount: number }>}
 */
async function applyMigration({ db, name, sql, recordApplied, logger }) {
  const log = logger || console;
  const header = parseHeader(sql);
  const markApplied = typeof recordApplied === 'function' ? recordApplied : () => {};

  if (!header.chunked) {
    // Historic path: single transaction, atomic.
    const tx = db.transaction(() => {
      db.exec(sql);
      markApplied(name);
    });
    tx();
    return { header, chunkCount: 1 };
  }

  // Chunked path: one transaction per chunk, yield between. The migration
  // record is written in the FINAL chunk's transaction so a crash mid-way
  // leaves the migration "not applied" and replays cleanly on next boot.
  const chunks = splitChunks(sql);
  if (chunks.length === 0) {
    // Nothing to do but still record applied so we don't re-read every boot.
    const tx = db.transaction(() => markApplied(name));
    tx();
    return { header, chunkCount: 0 };
  }

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const chunkSql = chunks[i];
    const tx = db.transaction(() => {
      db.exec(chunkSql);
      if (isLast) markApplied(name);
    });
    tx();
    if (!isLast) {
      // Release the SQLite write lock so concurrent writers can interleave.
      // setImmediate is sufficient — it yields back to the event loop without
      // adding measurable latency. See /memories/debugging.md "M64 FTS
      // cold-start rebuild" for the underlying lesson.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  log.log(
    `[migrationRunner] ${name}: applied ${chunks.length} chunk(s)` +
      (header.id ? ` (id=${header.id})` : ''),
  );
  return { header, chunkCount: chunks.length };
}

module.exports = { parseHeader, splitChunks, applyMigration, DEFAULT_HEADER };
