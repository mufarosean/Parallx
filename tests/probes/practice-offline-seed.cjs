// Adds a scan root that is not on disk (an unplugged drive) with one file to
// a seeded Media Organizer database, so practice-probe.mjs can check that the
// startup sweep keeps the rows and the sidebar marks the folder offline.
//
// better-sqlite3 is built for Electron: run with ELECTRON_RUN_AS_NODE=1.
//   electron practice-offline-seed.cjs <dbPath>

'use strict';
const Database = require('better-sqlite3');

const [dbPath] = process.argv.slice(2);
const db = new Database(dbPath);
const root = process.platform === 'win32' ? 'Q:\\parallx-offline-root' : '/parallx-offline-root';
const now = new Date().toISOString();
const f = db.prepare('INSERT INTO mo_folders (path, parent_folder_id, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(root, now, now);
const file = db.prepare('INSERT INTO mo_files (basename, size, mod_time, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('gone.jpg', 1234, now, f.lastInsertRowid, now, now);
// A real file on an unplugged drive has its photo entity; without one the
// stale-trash cleanup would drop the bare file row at startup.
const photo = db.prepare('INSERT INTO mo_photos (title, created_at, updated_at) VALUES (?, ?, ?)').run('gone', now, now);
db.prepare('INSERT INTO mo_photos_files (photo_id, file_id, is_primary) VALUES (?, ?, 1)').run(photo.lastInsertRowid, file.lastInsertRowid);
console.log(`offline root seeded: ${root}`);
