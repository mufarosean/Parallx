// cover-source.js — Atelier's photos as page covers: the Atelier tab in the
// canvas's cover picker (api.canvas.registerCoverSource). A cover links the
// photo's own file over parallx-media://, so nothing is copied into the page
// and its size is not capped. A format Chromium cannot draw (HEIC, RAW, TIFF)
// links the display copy Atelier already makes for it.

const SHOWABLE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/** The parallx-media URL for a local file. */
export function moCoverMediaUrl(filePath) {
  return 'parallx-media://file/' + encodeURIComponent(String(filePath));
}

/**
 * deps: { db, thumbnailPath(id) → path | null, resolvePath(id) → path | null,
 * displayCopy(path) → path | null }.
 */
export function moCoverSource(deps) {
  const showable = async (p) => {
    if (!p) return null;
    if (SHOWABLE_RE.test(p)) return p;
    const copy = await deps.displayCopy(p).catch(() => null);
    return copy && SHOWABLE_RE.test(copy) ? copy : null;
  };
  return {
    id: 'parallx-community.media-organizer.photos',
    label: 'Atelier',
    async search(query) {
      const t = String(query || '').trim();
      const rows = await deps.db.all(
        `SELECT p.id, COALESCE(NULLIF(p.title, ''), f.basename) AS title FROM mo_photos p
           JOIN mo_files f ON f.id = (SELECT file_id FROM mo_photos_files WHERE photo_id = p.id ORDER BY is_primary DESC LIMIT 1)
          WHERE p.deleted_at IS NULL AND (? = '' OR p.title LIKE ? OR f.basename LIKE ?)
          ORDER BY p.id DESC LIMIT 48`,
        [t, `%${t}%`, `%${t}%`],
      ).catch(() => []);
      return (rows || []).map((r) => ({ id: String(r.id), title: r.title || 'Photo' }));
    },
    async thumbnail(id) {
      const p = await showable(await deps.thumbnailPath(Number(id)));
      return p ? moCoverMediaUrl(p) : undefined;
    },
    async coverUrl(id) {
      const p = await showable(await deps.resolvePath(Number(id)));
      return p ? moCoverMediaUrl(p) : undefined;
    },
  };
}
