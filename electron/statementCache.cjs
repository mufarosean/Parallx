// statementCache.cjs — prepared statements reused across calls.
//
// Parsing and planning a statement costs more than running most of them,
// so each open database keeps its statements by SQL text. The cache is
// bounded; the oldest statement goes when it is full, and the owner clears
// the cache when the database closes.

/** How many prepared statements a database keeps. */
const STATEMENT_CACHE_SIZE = 256;

/**
 * The prepared statement for `sql` on `db`, from `cache` (a Map by SQL
 * text) when it has one, else prepared and kept.
 */
function preparedStatement(cache, db, sql) {
  let stmt = cache.get(sql);
  if (stmt) return stmt;
  stmt = db.prepare(sql);
  if (cache.size >= STATEMENT_CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(sql, stmt);
  return stmt;
}

module.exports = { STATEMENT_CACHE_SIZE, preparedStatement };
