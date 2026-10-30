// imageStore.ts — a picture put on a page is kept as a file, not inside the page.
//
// A pasted, dropped or uploaded picture went into the page as a base64 data
// URL: a 3 MB screenshot made a 4 MB page, saved whole on every keystroke,
// carried in every revision and loaded with every page list. It is now
// written once to the workspace's `.parallx/media/<sha-256>.<ext>` (the same
// picture twice is one file) and the page keeps a short
// `parallx-media://workspace/…` link, which the app serves from the open
// workspace, so it moves with the folder. When there is no workspace folder,
// or the write fails, or the picture is an SVG (it can carry script, so the
// media scheme does not serve it), the data URL is kept as before: nothing
// is lost. Pages written before keep their data URLs and still show.

export const MEDIA_DIR = '.parallx/media';

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
};

/** A data URL's type and base64 body, for the picture types the store keeps; null otherwise. */
export function parseImageDataUrl(src: string): { mime: string; ext: string; base64: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = EXT[mime];
  return ext ? { mime, ext, base64: m[2].replace(/\s+/g, '') } : null;
}

/** The link a page keeps for a file at `relPath` within the workspace. */
export function workspaceMediaSrc(relPath: string): string {
  return `parallx-media://workspace/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}

async function sha256Hex(base64: string): Promise<string> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where the store writes: the open workspace's folder, and the file bridge. */
export interface IImageStoreHost {
  workspaceRoot(): string | undefined;
  exists(absPath: string): Promise<boolean>;
  /** Writes the bytes; false when it could not. */
  writeBase64(absPath: string, base64: string): Promise<boolean>;
}

let _host: IImageStoreHost | null = null;

/** Canvas sets this on activation; until then (and in tests) pictures stay data URLs. */
export function setImageStoreHost(host: IImageStoreHost | null): void {
  _host = host;
}

/** The host over the Electron file bridge, writing under `root()`. */
export function electronImageStoreHost(root: () => string | undefined): IImageStoreHost | null {
  const fs = (globalThis as { parallxElectron?: { fs?: {
    exists?(p: string): Promise<boolean>;
    writeFile?(p: string, c: string, e: string): Promise<{ error?: unknown } | undefined>;
  } } }).parallxElectron?.fs;
  if (!fs?.exists || !fs.writeFile) return null;
  return {
    workspaceRoot: root,
    exists: (p) => fs.exists!(p).catch(() => false),
    writeBase64: async (p, b64) => !(await fs.writeFile!(p, b64, 'base64').catch((e) => ({ error: e })))?.error,
  };
}

/** The src to put on the page for `src`: a stored file's link, or `src` itself when it is not a data URL the store keeps. */
export async function storeImageSrc(src: string, host: IImageStoreHost | null = _host): Promise<string> {
  const data = parseImageDataUrl(src);
  const root = host?.workspaceRoot()?.replace(/[\\/]+$/, '');
  if (!data || !host || !root) return src;
  try {
    const rel = `${MEDIA_DIR}/${await sha256Hex(data.base64)}.${data.ext}`;
    const abs = `${root}/${rel}`;
    if (!(await host.exists(abs)) && !(await host.writeBase64(abs, data.base64))) return src;
    return workspaceMediaSrc(rel);
  } catch {
    return src; // kept in the page, as before
  }
}
