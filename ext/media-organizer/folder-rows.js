// folder-rows.js — a library folder's row menu: Rescan, Show in Folder,
// Remove From Library… (MEDIA_ORGANIZER_AUDIT 2.2).
//
// Folders had no menu, and nothing ever removed one: a folder once added was
// watched and re-imported for good. Remove From Library takes the folder and
// everything under it out of the library (its items, with their tags,
// ratings and album places) and stops it coming back: a watched root is no
// longer watched, and a folder inside one is kept out of every later scan.
// The files on disk are not touched. Adding the folder again (Add Folder…)
// brings it back.

const KEY = 'excluded_folders';
let excluded = [];

const norm = (p) => String(p || '').replace(/[\\/]+$/, '');

/** Whether `child` is `parent` or inside it (either separator; case counts except on Windows paths). */
export function moPathWithin(child, parent) {
  const windows = /^[a-zA-Z]:|\\/.test(String(child) + String(parent));
  const fold = (x) => (windows ? x.toLowerCase() : x);
  const c = fold(norm(child)), p = fold(norm(parent));
  if (!c || !p) return false;
  if (c === p) return true;
  const head = c.slice(0, p.length + 1);
  return head === p + '/' || head === p + '\\';
}

/** Whether a path lies in a folder removed from the library. */
export function moIsExcluded(path) {
  return excluded.length > 0 && excluded.some((x) => moPathWithin(path, x));
}

/** Read the removed folders (activate). */
export async function moLoadExcluded(getSetting) {
  try { const v = JSON.parse(await getSetting(KEY, '[]')); excluded = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { excluded = []; }
}

/** A folder scanned again (Add Folder…) is in the library again, and so is all under it. */
export function moUnexclude(path, setSetting) {
  const next = excluded.filter((x) => !moPathWithin(x, path));
  if (next.length === excluded.length) return;
  excluded = next;
  void Promise.resolve(setSetting(KEY, JSON.stringify(excluded))).catch(() => {});
}

function exclude(path, setSetting) {
  excluded = [...excluded.filter((x) => !moPathWithin(x, path)), norm(path)];
  return setSetting(KEY, JSON.stringify(excluded));
}

/**
 * The row's menu. `deps`: { api, open(), rescan(path), reveal(path), remove(path) }.
 */
export function moFolderMenu(deps, row, name) {
  return [
    { label: 'Open', icon: 'folder-open', handler: deps.open },
    { label: 'Rescan', icon: 'refresh-cw', title: 'Look for new, changed and removed files in this folder', handler: () => void deps.rescan(row.path) },
    { label: 'Show in Folder', icon: 'external-link', handler: () => void deps.reveal(row.path) },
    { separator: true },
    { label: 'Remove From Library…', icon: 'folder-minus', danger: true, title: 'Its items leave the library; the files on disk stay', handler: () => void moRemoveFolder(deps.removeDeps, row.path, name) },
  ];
}

/**
 * Take a folder out of the library. `d`: { api, db, roots(), stopWatching(path),
 * syncGate(), purge(paths), changed(), setSetting(key, value), sep }.
 * Returns the number of files taken out, or null when cancelled.
 */
export async function moRemoveFolder(d, folderPath, name) {
  const p = norm(folderPath);
  const rows = await d.db.all(
    `SELECT f.basename AS basename, fo.path AS folder FROM mo_files f JOIN mo_folders fo ON fo.id = f.folder_id
      WHERE fo.path = ? OR fo.path LIKE ? OR fo.path LIKE ?`, [p, p + '/%', p + '\\%']);
  const files = rows.filter((r) => moPathWithin(r.folder, p)).map((r) => norm(r.folder) + d.sep + r.basename);
  const n = files.length;
  const go = 'Remove From Library';
  const pick = await d.api.window.showWarningMessage(
    `Remove "${name}" from the library? Its ${n} ${n === 1 ? 'file leaves' : 'files leave'} the library, with their tags, ratings and album places, and the folder is no longer watched. The files on disk are not touched.`,
    { title: go }, { title: 'Cancel' });
  if (pick?.title !== go) return null;

  // Stop it coming back: a root at or under it is no longer watched; inside a root, it is kept out.
  const roots = await d.roots();
  let insideRoot = false;
  for (const r of roots) {
    if (moPathWithin(r.path, p)) {
      await d.db.run('DELETE FROM mo_scan_roots WHERE path = ?', [r.path]);
      d.stopWatching(r.path);
    } else if (moPathWithin(p, r.path)) insideRoot = true;
  }
  if (insideRoot) await exclude(p, d.setSetting);
  await d.syncGate();

  for (let i = 0; i < files.length; i += 200) await d.purge(files.slice(i, i + 200));
  // Its folder records go too: on a start with no watched roots, the roots are rebuilt from them.
  const folders = (await d.db.all('SELECT id, path FROM mo_folders WHERE path = ? OR path LIKE ? OR path LIKE ?', [p, p + '/%', p + '\\%']))
    .filter((f) => moPathWithin(f.path, p)).map((f) => f.id);
  for (let i = 0; i < folders.length; i += 200) {
    const ids = folders.slice(i, i + 200);
    try { await d.db.run(`DELETE FROM mo_folders WHERE id IN (${ids.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM mo_files f WHERE f.folder_id = mo_folders.id)`, ids); } catch { /* a folder still referenced stays; it has no items */ }
  }
  await d.changed();
  void d.api.window.showInformationMessage(`Removed "${name}" from the library (${n} ${n === 1 ? 'file' : 'files'}). The files on disk are untouched.`);
  return n;
}
