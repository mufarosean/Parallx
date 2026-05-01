// imagePathResolver.ts — Resolve local image paths to data URLs.
//
// Canvas's CSP forbids `file://` in `img-src`, so absolute filesystem paths
// (or `file://` URLs) must be inlined as base64 data URLs. This is the same
// pipeline the Upload tab uses; centralized here so the Embed link tab and
// the drag-drop plugin share one implementation.

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const MAX_BASE64_LEN = Math.floor(5 * 1024 * 1024 * 1.37); // ~5 MB raw
const PATH_RX = /^(?:[a-zA-Z]:[\\/]|[\\/]|file:\/\/)/;

/** True if `value` looks like a local filesystem path or a `file://` URL. */
export function looksLikeLocalPath(value: string): boolean {
  return PATH_RX.test(value);
}

/** Strip `file://` prefix and decode percent-escapes. Returns the OS path. */
export function fileUrlToPath(input: string): string {
  let p = input;
  if (p.startsWith('file:///')) {
    p = p.slice(8);
    try { p = decodeURIComponent(p); } catch { /* keep raw */ }
    if (!/^[a-zA-Z]:/.test(p) && !p.startsWith('/')) p = '/' + p;
  } else if (p.startsWith('file://')) {
    p = p.slice(7);
    try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  }
  return p;
}

/** True if the path's extension matches a supported image format. */
export function hasImageExtension(path: string): boolean {
  const m = path.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  if (!m) return false;
  return IMAGE_EXTS.has(m[1]!.toLowerCase());
}

function extToMime(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'svg') return 'image/svg+xml';
  return `image/${e}`;
}

/**
 * Read a local image file and return a base64 data URL.
 *
 * Returns `{ dataUrl }` on success or `{ error }` with a user-facing message.
 * Caller is responsible for surfacing the error (toast, inline label, etc.).
 */
export async function readLocalImageAsDataUrl(
  rawPath: string,
): Promise<{ dataUrl?: string; error?: string }> {
  const electron = (window as any).parallxElectron;
  if (!electron?.fs?.readFile) {
    return { error: 'Local files unavailable in this build.' };
  }
  const filePath = fileUrlToPath(rawPath.trim());
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (!IMAGE_EXTS.has(ext)) {
    return { error: 'Unsupported image format.' };
  }
  try {
    const result = await electron.fs.readFile(filePath, 'base64');
    if (result?.error) {
      // fs:readFile returns `{ error: { code, message, path } }`, not a string.
      const msg = typeof result.error === 'string'
        ? result.error
        : (result.error?.message || result.error?.code || 'unknown error');
      return { error: `Could not read file: ${msg}` };
    }
    if (!result?.content) return { error: 'File is empty or unreadable.' };
    // Main process auto-detects binary and returns base64 regardless of the
    // encoding param. If a non-binary text file is requested with `'base64'`
    // we'd get utf-8 back — guard with the returned encoding.
    if (result.encoding !== 'base64') {
      return { error: 'File is not a recognized binary image.' };
    }
    if (typeof result.content === 'string' && result.content.length > MAX_BASE64_LEN) {
      return { error: 'Image is too large (max 5 MB).' };
    }
    const mime = extToMime(ext);
    return { dataUrl: `data:${mime};base64,${result.content}` };
  } catch (err) {
    return { error: `Read failed: ${(err as Error)?.message ?? 'unknown error'}` };
  }
}
