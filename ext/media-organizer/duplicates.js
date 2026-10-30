// duplicates.js — the Duplicate Finder: one page, opened from the sidebar's
// Duplicates row (MEDIA_ORGANIZER_AUDIT 3.1 and step 4).
//
// There used to be two things called Duplicates: a library view of
// byte-identical files, and a dialog behind the page's ⋯ menu that showed the
// same groups plus look-alikes, but only once a separate palette command had
// built the hashes. Now there is one page with two tabs:
//   Exact       files that are byte for byte the same (md5);
//   Look-alike  photos whose pictures are nearly the same (a 64-bit
//               difference hash, Hamming distance 8 or less). Opening the tab
//               reads the photos not yet hashed, with progress and Stop.
// In each group, Keep Only This removes the others through the library's own
// Delete (to Trash, or for good after asking, as the Delete setting says).
// Every action is a command (media-organizer.duplicates.*).

import { moEl } from './dom.js';

/** Bits two photos may differ by and still look alike. */
export const MO_LOOKALIKE_MAX = 8;
/** Groups drawn at most per tab; the rest are counted. */
const MAX_GROUPS = 200;

let deps = null;
let lastTab = 'exact';
const pages = new Set();
/** Building the look-alike hashes; one run for every open page. */
const job = { running: false, stop: false, stopped: false, done: 0, total: 0, noTool: false, failed: new Set() }; // stopped: by Stop, until Continue

// ── Pure parts (tests/unit/moDuplicates.test.ts) ──

/** Byte-identical rows ({ hash, type, id, size, ... }) as groups of two or more items, the most space to free first. */
export function moGroupExact(rows) {
  const byHash = new Map();
  for (const r of rows || []) {
    if (r == null || r.hash == null) continue;
    let g = byHash.get(r.hash);
    if (!g) byHash.set(r.hash, (g = new Map()));
    const key = `${r.type}:${r.id}`;
    if (!g.has(key)) g.set(key, r);
  }
  const groups = [...byHash.values()].map((g) => [...g.values()]).filter((g) => g.length > 1);
  const freed = (g) => (g.length - 1) * (Number(g[0].size) || 0);
  return groups.sort((a, b) => freed(b) - freed(a) || b.length - a.length);
}

/** A 64-bit hash (BigInt) as two 32-bit halves, which compare far faster than BigInts. */
export function moHashParts(big) {
  const b = BigInt.asUintN(64, BigInt(big));
  return { hi: Number(b >> 32n), lo: Number(b & 0xffffffffn) };
}

function popcount32(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Bits that differ between two hashes given as { hi, lo }. */
export function moHashDistance(a, b) {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

/**
 * Look-alike groups from rows with { hi, lo } (and an optional md5): each
 * group is a seed and every later row within `max` bits of it. A group whose
 * members are all one file's copies is left to the Exact tab.
 */
export function moGroupLookAlikes(rows, max = MO_LOOKALIKE_MAX) {
  const list = rows || [];
  const taken = new Uint8Array(list.length);
  const groups = [];
  for (let i = 0; i < list.length; i++) {
    if (taken[i]) continue;
    const group = [list[i]];
    taken[i] = 1;
    for (let j = i + 1; j < list.length; j++) {
      if (!taken[j] && moHashDistance(list[i], list[j]) <= max) { group.push(list[j]); taken[j] = 1; }
    }
    if (group.length < 2) continue;
    if (new Set(group.map((r, k) => r.md5 ?? `#${k}`)).size < 2) continue;
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length);
}

/** A file size for a person: 2.4 MB, 812 KB. */
export function moSizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
}

// ── Queries ──

const DUP_MD5 = `SELECT value FROM mo_fingerprints WHERE type = 'md5' GROUP BY value HAVING COUNT(DISTINCT file_id) > 1`;
const NOT_GIF = `LOWER(f.basename) NOT LIKE '%.gif'`;

/** How many items (photos and videos, not in Trash) have a byte-identical copy: the sidebar row's count. */
export async function moDuplicateCount(db) {
  const r = await db.get(`SELECT
    (SELECT COUNT(DISTINCT pf.photo_id) FROM mo_photos_files pf JOIN mo_photos p ON p.id = pf.photo_id AND p.deleted_at IS NULL
      JOIN mo_fingerprints fp ON fp.file_id = pf.file_id AND fp.type = 'md5' WHERE fp.value IN (${DUP_MD5}))
  + (SELECT COUNT(DISTINCT vf.video_id) FROM mo_videos_files vf JOIN mo_videos v ON v.id = vf.video_id AND v.deleted_at IS NULL
      JOIN mo_fingerprints fp ON fp.file_id = vf.file_id AND fp.type = 'md5' WHERE fp.value IN (${DUP_MD5})) AS n`);
  return (r && Number(r.n)) || 0;
}

async function exactGroups(db) {
  const part = (type, table, link, col) => `SELECT fp.value AS hash, '${type}' AS type, x.id AS id, COALESCE(NULLIF(x.title, ''), f.basename) AS name, f.size AS size, fo.path AS folder
      FROM mo_fingerprints fp JOIN mo_files f ON f.id = fp.file_id LEFT JOIN mo_folders fo ON fo.id = f.folder_id
      JOIN ${link} l ON l.file_id = f.id JOIN ${table} x ON x.id = l.${col} AND x.deleted_at IS NULL
     WHERE fp.type = 'md5' AND fp.value IN (${DUP_MD5})`;
  const rows = await db.all(`${part('photo', 'mo_photos', 'mo_photos_files', 'photo_id')} UNION ALL ${part('video', 'mo_videos', 'mo_videos_files', 'video_id')} ORDER BY id`);
  return moGroupExact(rows);
}

const PRIMARY_PHOTO = `FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id AND pf.is_primary = 1 JOIN mo_files f ON f.id = pf.file_id`;

async function lookAlikeGroups(db) {
  const rows = await db.all(`SELECT 'photo' AS type, p.id AS id, COALESCE(NULLIF(p.title, ''), f.basename) AS name, f.size AS size, fo.path AS folder, imf.phash AS phash,
      (SELECT value FROM mo_fingerprints WHERE file_id = pf.file_id AND type = 'md5' LIMIT 1) AS md5
    ${PRIMARY_PHOTO} LEFT JOIN mo_folders fo ON fo.id = f.folder_id JOIN mo_image_files imf ON imf.file_id = pf.file_id
    WHERE p.deleted_at IS NULL AND imf.phash IS NOT NULL AND ${NOT_GIF} ORDER BY p.id`);
  return moGroupLookAlikes(rows.map((r) => Object.assign(r, moHashParts(deps.fromSqlite(r.phash)))));
}

async function unhashed(db) {
  const rows = await db.all(`SELECT pf.file_id AS file_id, fo.path AS folder, f.basename AS basename
    ${PRIMARY_PHOTO} JOIN mo_folders fo ON fo.id = f.folder_id LEFT JOIN mo_image_files imf ON imf.file_id = pf.file_id
    WHERE p.deleted_at IS NULL AND imf.phash IS NULL AND ${NOT_GIF}`);
  return rows.filter((r) => !job.failed.has(r.file_id));
}

// ── Building the hashes ──

const notify = (what) => { for (const pg of pages) pg[what](); };

async function buildHashes() {
  if (job.running || !deps) return;
  Object.assign(job, { running: true, stop: false, stopped: false, done: 0, total: 0 });
  try {
    job.noTool = !(await deps.hashReady());
    if (job.noTool) return;
    const rows = await unhashed(deps.db);
    job.total = rows.length;
    notify('reload');
    for (const r of rows) {
      if (job.stop || !pages.size) break;
      const sep = /\\/.test(r.folder) ? '\\' : deps.sep;
      const hash = await deps.phash(String(r.folder).replace(/[\\/]+$/, '') + sep + r.basename).catch(() => null);
      if (hash == null) job.failed.add(r.file_id);
      else {
        await deps.db.run('INSERT OR IGNORE INTO mo_image_files (file_id) VALUES (?)', [r.file_id]);
        await deps.db.run('UPDATE mo_image_files SET phash = ? WHERE file_id = ?', [deps.toSqlite(hash), r.file_id]);
      }
      job.done++;
      notify('progress');
    }
  } catch (err) {
    console.warn('[MediaOrganizer] look-alike hashes:', err && err.message);
  } finally {
    job.running = false;
    notify('reload');
  }
}

/** The page's commands. d: { db, thumb(img, type, id), open(type, id), remove(keys, done), deleteToTrash(), hashReady(), phash(path), toSqlite, fromSqlite, sep } */
export function moDuplicatesActivate(api, d) {
  deps = d;
  const acts = {
    open: (type, id) => d.open(type, id),
    keep: (keep, others) => {
      if (!Array.isArray(others) || !others.length) return;
      d.remove(others.filter((k) => k !== keep), () => notify('reload'));
    },
    hash: () => void buildHashes(),
    stop: () => { if (job.running) { job.stop = true; job.stopped = true; } },
  };
  const subs = Object.entries(acts).map(([k, fn]) => api.commands.registerCommand(`media-organizer.duplicates.${k}`, fn));
  // Anything deleted, restored or rescanned elsewhere changes the groups.
  let soon = 0;
  const changed = () => { if (!pages.size) return; clearTimeout(soon); soon = setTimeout(() => notify('reload'), 600); };
  document.addEventListener('mo:refresh-grid', changed);
  subs.push({ dispose: () => { clearTimeout(soon); document.removeEventListener('mo:refresh-grid', changed); job.stop = true; } });
  return subs;
}

/** Open the Duplicate Finder (the sidebar row, and Find Duplicates in the palette). */
export function moOpenDuplicates(api) {
  return api.editors.openEditor({ typeId: 'media-organizer-grid', title: 'Duplicates', icon: 'copy', instanceId: 'duplicates' });
}

// ── The page ──

export function moRenderDuplicates(container, api) {
  const ui = api.ui;
  const root = moEl('div', 'mo-practice-setup mo-dupf');
  container.appendChild(root);
  let disposed = false;
  let seq = 0;
  let tab = lastTab;
  job.noTool = false; // ffmpeg may have been set up since
  ui.createPageHeader(root, { title: 'Duplicates', subtitle: 'Copies of the same file, and photos that look alike.' });
  const tabs = ui.createTabs(root, {
    id: 'media-organizer.duplicates.tabs',
    label: 'Kind of duplicate',
    reorderable: false,
    items: [
      { id: 'exact', label: 'Exact', closable: false, tooltip: 'Files that are byte for byte the same' },
      { id: 'lookalike', label: 'Look-alike', closable: false, tooltip: 'Photos whose pictures are nearly the same' },
    ],
    active: tab,
    onSelect: (id) => { if (id !== tab) show(id); },
  });
  tabs.element.classList.add('mo-dupf-tabs');
  const panel = moEl('div', 'mo-dupf-panel', { role: 'tabpanel', tabindex: '-1' });
  root.appendChild(panel);
  let progressText = null;

  function show(id) {
    tab = lastTab = id;
    if (id === 'lookalike') job.noTool = false;
    if (tabs.bar) tabs.bar.setActive(id);
    void load();
  }

  function note(text) { panel.appendChild(moEl('p', 'mo-dupf-note', { textContent: text })); }

  async function load() {
    const mine = ++seq;
    panel.setAttribute('aria-label', tab === 'exact' ? 'Exact' : 'Look-alike');
    progressText = null;
    try {
      if (tab === 'lookalike') {
        if (job.noTool) return paint(mine, () => ui.createEmptyState(panel, { icon: 'copy', headline: 'Look-alikes need ffmpeg', hint: 'Atelier reads each photo with ffmpeg to compare them, and could not find it. Set it up, then open this tab again.' }));
        if (!job.running && !job.stopped && (await unhashed(deps.db)).length) void buildHashes(); // on demand: only what is not read yet
        if (job.running) return paint(mine, () => progressRow());
        const missing = await unhashed(deps.db);
        const groups = await lookAlikeGroups(deps.db);
        paint(mine, () => {
          if (missing.length) {
            const row = moEl('div', 'mo-dupf-progress');
            row.appendChild(moEl('span', null, { textContent: `${missing.length} photo${missing.length === 1 ? ' is' : 's are'} not compared yet.` }));
            ui.createButton(row, { id: 'media-organizer.duplicates.hash', label: 'Continue', icon: 'play', size: 'sm', command: 'media-organizer.duplicates.hash', title: 'Read the rest of the photos to compare them' });
            panel.appendChild(row);
          }
          renderGroups(groups, 'lookalike');
        });
      } else {
        const groups = await exactGroups(deps.db);
        paint(mine, () => renderGroups(groups, 'exact'));
      }
    } catch (err) {
      paint(mine, () => note('Could not read the duplicates: ' + ((err && err.message) || err)));
    }
  }

  function paint(mine, draw) {
    if (mine !== seq || disposed) return;
    const had = panel.contains(document.activeElement) && document.activeElement.getAttribute('data-px-id');
    panel.replaceChildren();
    draw();
    if (had) { const el = panel.querySelector(`[data-px-id="${CSS.escape(had)}"]`); if (el) el.focus(); else panel.focus(); }
  }

  function progressRow() {
    const row = moEl('div', 'mo-dupf-progress');
    progressText = moEl('span', null, { role: 'status', 'aria-live': 'polite' });
    row.appendChild(progressText);
    ui.createButton(row, { id: 'media-organizer.duplicates.stop', label: 'Stop', icon: 'circle-stop', size: 'sm', command: 'media-organizer.duplicates.stop', title: 'Stop reading; what is read so far is kept' });
    panel.appendChild(row);
    note('Each photo is read once to make a small fingerprint of its picture, kept for next time. GIFs and videos are not compared.');
    setProgress();
  }

  function setProgress() {
    if (progressText) progressText.textContent = job.total ? `Reading photos to compare: ${job.done} of ${job.total}` : 'Getting ready to compare photos\u2026';
  }

  function renderGroups(groups, tab) {
    const exact = tab === 'exact';
    if (!groups.length) {
      ui.createEmptyState(panel, exact
        ? { icon: 'copy', headline: 'No exact copies', hint: 'No two files in the library are byte for byte the same.' }
        : { icon: 'images', headline: 'No look-alikes', hint: 'No two photos in the library look nearly the same.' });
      return;
    }
    const items = groups.reduce((n, g) => n + g.length, 0);
    note(exact
      ? `${groups.length} group${groups.length === 1 ? '' : 's'} of copies, ${items} files. Keep one in each and remove the rest.`
      : `${groups.length} group${groups.length === 1 ? '' : 's'} of look-alike photos, ${items} photos.`);
    const toTrash = deps.deleteToTrash();
    const list = moEl('div', 'mo-dupf-groups', { role: 'list', 'aria-label': exact ? 'Groups of copies' : 'Groups of look-alike photos' });
    for (const g of groups.slice(0, MAX_GROUPS)) {
      const head = exact ? `${g.length} copies, ${moSizeText(g[0].size)} each` : `${g.length} look-alike photos`;
      const card = moEl('section', 'mo-dupf-group', { role: 'listitem', 'aria-label': `${head}: ${g[0].name}` });
      card.appendChild(moEl('div', 'mo-dupf-group-head', { textContent: head }));
      const keys = g.map((it) => `${it.type}:${it.id}`);
      for (const it of g) {
        const key = `${it.type}:${it.id}`;
        const row = moEl('div', 'mo-dupf-row');
        const img = moEl('img', 'mo-dupf-thumb', { alt: '' });
        deps.thumb(img, it.type, it.id);
        const text = moEl('div', 'mo-dupf-text');
        text.append(moEl('span', 'mo-dupf-name', { textContent: it.name }), moEl('span', 'mo-dupf-meta', { textContent: `${moSizeText(it.size)} · ${it.folder || 'No folder'}`, title: it.folder || '' }));
        const actions = moEl('div', 'mo-dupf-actions');
        const slug = `${it.type}-${it.id}`;
        ui.createIconButton(actions, { id: `media-organizer.duplicates.open.${slug}`, icon: 'external-link', title: `Open ${it.name}`, size: 'sm', command: 'media-organizer.duplicates.open', args: [it.type, it.id] });
        ui.createButton(actions, {
          id: `media-organizer.duplicates.keep.${slug}`,
          label: toTrash ? 'Keep Only This' : 'Keep Only This…',
          icon: 'check',
          size: 'sm',
          title: toTrash ? `Keep ${it.name} and move the others in this group to Trash` : `Keep ${it.name} and delete the others in this group (asks first)`,
          command: 'media-organizer.duplicates.keep',
          args: [key, keys],
        });
        row.append(img, text, actions);
        card.appendChild(row);
      }
      list.appendChild(card);
    }
    panel.appendChild(list);
    if (groups.length > MAX_GROUPS) note(`Showing the first ${MAX_GROUPS} of ${groups.length} groups. Keep one in some of them and the rest show here.`);
  }

  const page = { reload: () => void load(), progress: () => setProgress() };
  pages.add(page);
  void load();
  return {
    dispose() {
      disposed = true;
      pages.delete(page);
      if (!pages.size) job.stop = true;
      tabs.dispose();
      container.replaceChildren();
    },
  };
}
