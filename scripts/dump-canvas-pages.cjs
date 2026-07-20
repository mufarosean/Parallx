// dump-canvas-pages.cjs — dump canvas pages from a COPIED workspace DB into
// the JSON fixture consumed by tests/unit/canvasRealPages.battery.test.ts.
//
// SAFETY CONTRACT: always run against a COPY of <workspace>/.parallx/data.db
// (copy data.db + data.db-wal + data.db-shm together). Never point this at a
// live workspace. The fixture holds personal note content — keep it OUTSIDE
// the repo and point PARALLX_REAL_PAGES_FIXTURE at it.
//
// Usage (Electron ABI required for better-sqlite3):
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
//     scripts/dump-canvas-pages.cjs <copied-data.db> <out-fixture.json>
const path = require('path');
const fs = require('fs');

const [, , dbArg, outArg] = process.argv;
if (!dbArg || !outArg) {
  console.error('usage: dump-canvas-pages.cjs <copied-data.db> <out-fixture.json>');
  process.exit(1);
}
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const db = new Database(path.resolve(dbArg));

const rows = db.prepare(
  `SELECT id, parent_id, title, content, content_schema_version,
          LENGTH(content) AS content_len, is_archived
     FROM pages ORDER BY LENGTH(content) DESC`,
).all();

const pages = [];
let parsed = 0, unparsed = 0, empty = 0;
for (const row of rows) {
  if (!row.content) { empty++; continue; }
  try {
    pages.push({
      id: row.id, title: row.title, schemaVersion: row.content_schema_version,
      archived: !!row.is_archived, contentLen: row.content_len,
      doc: JSON.parse(row.content),
    });
    parsed++;
  } catch { unparsed++; }
}
fs.writeFileSync(path.resolve(outArg), JSON.stringify({ dumpedAt: new Date().toISOString(), pages }));
console.log(JSON.stringify({ totalRows: rows.length, parsed, unparsed, empty }));
db.close();
