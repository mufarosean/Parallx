// folder-albums.js — one album per folder on disk. A scan gives every folder
// with media an album of its own (folder_id set). Two albums could stand for
// the same folder: libraries from before the scan guarded against two
// creations at once, and the same folder recorded twice in different
// spellings (D:\Gallery and d:/gallery are one folder on Windows). Both
// showed as the folder's name twice in Collections. The sweep merges them
// into the oldest, keeping every photo, video, tag and child album; the
// lookup finds a folder's album by the folder's real path, so a second is
// never made.

// A folder path as the system compares it: one separator, no trailing one, and on Windows any case.
export function moFolderKey(path, isWindows) {
  const p = String(path || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return isWindows ? p.toLowerCase() : p;
}

// The album of the folder at path, made by any spelling of that path, or null.
export async function moFindFolderAlbum(db, path, isWindows) {
  const key = moFolderKey(path, isWindows);
  const rows = await db.all('SELECT a.id, f.path FROM mo_albums a JOIN mo_folders f ON f.id = a.folder_id WHERE a.folder_id IS NOT NULL ORDER BY a.id');
  const hit = rows.find((r) => moFolderKey(r.path, isWindows) === key);
  return hit ? hit.id : null;
}

// Merges every group of albums that stand for one folder into its oldest. Returns how many were merged away.
export async function moMergeDuplicateFolderAlbums(db, isWindows) {
  const rows = await db.all('SELECT a.id, f.path FROM mo_albums a JOIN mo_folders f ON f.id = a.folder_id WHERE a.folder_id IS NOT NULL ORDER BY a.id');
  const keep = new Map();
  const ops = [];
  let merged = 0;
  for (const r of rows) {
    const k = moFolderKey(r.path, isWindows);
    if (!keep.has(k)) { keep.set(k, r.id); continue; }
    const to = keep.get(k), from = r.id;
    for (const [table, col] of [['mo_albums_photos', 'photo_id'], ['mo_albums_videos', 'video_id']]) {
      ops.push({ type: 'run', sql: `INSERT OR IGNORE INTO ${table} (album_id, ${col}, position) SELECT ?, ${col}, position FROM ${table} WHERE album_id = ?`, params: [to, from] });
    }
    ops.push({ type: 'run', sql: 'INSERT OR IGNORE INTO mo_albums_tags (album_id, tag_id) SELECT ?, tag_id FROM mo_albums_tags WHERE album_id = ?', params: [to, from] });
    ops.push({ type: 'run', sql: 'UPDATE mo_albums SET parent_album_id = ? WHERE parent_album_id = ? AND id <> ?', params: [to, from, to] });
    ops.push({ type: 'run', sql: 'DELETE FROM mo_albums WHERE id = ?', params: [from] });
    merged++;
  }
  if (ops.length) await db.transaction(ops);
  return merged;
}
