// colour-study-picture.js — the picture on a Colour Study sheet: where its
// colours are read from (the original photo, up to 4,096 px on its long
// side, never the smaller copy on screen), the loupe that shows the pixels
// under the pointer, and the library browser Choose Picture opens (newest
// first, a page at a time, searched by tags, folders, titles and file names).

import { moEl } from './dom.js';

const MAX_SOURCE = 4096;
export const MO_SAMPLE_SIZES = [[1, 'Point'], [5, '5 px'], [15, '15 px']];
const LOUPE_PX = 21; // source pixels across the loupe

/** Reads colours from a picture at its own resolution. */
export function moPictureSampler() {
  let ctx = null, w = 0, h = 0, seq = 0;
  return {
    /** Load the picture to read from; resolves to whether it loaded. */
    async load(url) {
      const mine = ++seq;
      ctx = null;
      if (!url) return false;
      const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
      if (!im || mine !== seq) return false;
      const k = Math.min(1, MAX_SOURCE / Math.max(im.naturalWidth, im.naturalHeight));
      const c = moEl('canvas');
      c.width = w = Math.max(1, Math.round(im.naturalWidth * k)); c.height = h = Math.max(1, Math.round(im.naturalHeight * k));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(im, 0, 0, w, h);
      ctx = g;
      return true;
    },
    ready: () => !!ctx,
    size: () => ({ w, h }),
    /** The colour at (u, v), 0..1 across the picture: one pixel, or the mean of a size × size square. */
    sample(u, v, size = 1) {
      if (!ctx) return null;
      const n = Math.max(1, Math.min(31, Math.round(size))), half = Math.floor(n / 2);
      const cx = Math.min(w - 1, Math.max(0, Math.floor(u * w))), cy = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
      const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half), x1 = Math.min(w, cx - half + n), y1 = Math.min(h, cy - half + n);
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let r = 0, g = 0, b = 0, k = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
      return k ? [r / k, g / k, b / k].map(Math.round) : null;
    },
    /** Draws the pixels round (u, v) into the loupe's canvas, the sample's square marked. */
    loupe(canvas, u, v, size = 1) {
      if (!ctx) return;
      const cx = Math.floor(u * w), cy = Math.floor(v * h), half = Math.floor(LOUPE_PX / 2);
      const out = canvas.getContext('2d'), cell = canvas.width / LOUPE_PX;
      out.imageSmoothingEnabled = false;
      out.clearRect(0, 0, canvas.width, canvas.height);
      out.drawImage(ctx.canvas, cx - half, cy - half, LOUPE_PX, LOUPE_PX, 0, 0, canvas.width, canvas.height);
      const n = Math.max(1, Math.round(size)), at = (half - Math.floor(n / 2)) * cell;
      out.lineWidth = 2; out.strokeStyle = 'white'; out.strokeRect(at, at, n * cell, n * cell);
      out.lineWidth = 1; out.strokeStyle = 'black'; out.strokeRect(at - 1.5, at - 1.5, n * cell + 3, n * cell + 3);
    },
  };
}

/**
 * The library's photos for Choose Picture: newest first with no words, else matched in the library's
 * search index (tags, folders, titles, details, file names). `db`: Atelier's database.
 */
export async function moBrowsePhotos(db, text, offset = 0, limit = 48) {
  const base = `SELECT p.id, COALESCE(NULLIF(p.title, ''), f.basename) AS title FROM mo_photos p
    JOIN mo_files f ON f.id = (SELECT file_id FROM mo_photos_files WHERE photo_id = p.id ORDER BY is_primary DESC LIMIT 1)
    WHERE p.deleted_at IS NULL`;
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return db.all(`${base} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
  const match = words.map((w) => `"${w}"*`).join(' ');
  try {
    return await db.all(`${base} AND p.id IN (SELECT rowid FROM mo_photos_fts WHERE mo_photos_fts MATCH ?) ORDER BY p.id DESC LIMIT ? OFFSET ?`, [match, limit, offset]);
  } catch {
    const like = `%${words.join(' ')}%`;
    return db.all(`${base} AND (p.title LIKE ? OR f.basename LIKE ?) ORDER BY p.id DESC LIMIT ? OFFSET ?`, [like, like, limit, offset]);
  }
}
