// batches.js — work in batches: id lists for SQL, bounded concurrency.
//
// Every db.* call is a renderer→main→worker round-trip; the per-row loops
// the purge paths used before cost thousands of sequential round-trips for
// a large delete and visibly churned the renderer event loop. These helpers
// collapse each cleanup into a handful of IN-list statements. IN lists are
// chunked well under SQLite's parameter limit.

/** How many ids one IN list carries. */
export const SQL_ID_CHUNK = 500;

/** `arr` cut into pieces of `size`. */
export function sqlChunks(arr, size = SQL_ID_CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** "?,?,?" with one mark per element. */
export function qMarks(arr) {
  return arr.map(() => '?').join(',');
}

/** Run `fn(item, index)` over items with at most `limit` in flight. */
export async function mapBounded(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}
