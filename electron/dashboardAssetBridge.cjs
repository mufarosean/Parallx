// dashboardAssetBridge.cjs — file-backed asset store + parallx-asset:// protocol
// for dashboard image/GIF widgets.
//
// Why this exists: the dashboard's per-widget `cached_output` column is a small
// TEXT cache (256 KB, loaded in bulk on every dashboard open) meant for AI
// markdown. Cramming base64 images there capped uploads and flattened GIFs.
// Instead, uploads are written to disk here and referenced by id; the widget
// stores only a tiny `asset:<id>` string and renders `parallx-asset://asset/<id>`.
// The protocol streams the file straight from disk, so an animated GIF of ANY
// size loads (the user owns any resulting lag).
//
// Safety: ids are `<uuid>.<ext>` only (no path traversal), and every read/write
// is confined to data/dashboard-assets.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { randomUUID } = require('node:crypto');

const SCHEME = 'parallx-asset';

const MIME_TO_EXT = {
  'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/apng': 'apng', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
};
const EXT_TO_MIME = {
  gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', apng: 'image/apng', svg: 'image/svg+xml', bmp: 'image/bmp',
  avif: 'image/avif', ico: 'image/x-icon',
};

// <uuid>.<ext> — the only shape we ever write or serve.
const ID_RE = /^[a-f0-9-]{20,}\.[a-z0-9]{1,5}$/i;

let _dir = null;

/** Register the scheme as privileged. MUST run before app 'ready'. */
function registerDashboardAssetScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

/** Wire the file store IPC + the protocol handler. Call after app 'ready'. */
function setupDashboardAssetBridge(ipcMain, protocol, appRoot) {
  _dir = path.join(appRoot, 'data', 'dashboard-assets');
  fsSync.mkdirSync(_dir, { recursive: true });

  ipcMain.handle('dashboardAsset:save', async (_event, bytes, mime) => {
    try {
      const ext = MIME_TO_EXT[String(mime || '').toLowerCase()] || 'bin';
      const id = `${randomUUID()}.${ext}`;
      await fs.writeFile(path.join(_dir, id), Buffer.from(bytes));
      return { id };
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboardAsset:delete', async (_event, id) => {
    if (typeof id === 'string' && ID_RE.test(id)) {
      try { await fs.unlink(path.join(_dir, id)); } catch { /* already gone */ }
    }
    return { ok: true };
  });

  protocol.handle(SCHEME, async (request) => {
    try {
      // parallx-asset://asset/<id>
      const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
      if (!_dir || !ID_RE.test(id)) return new Response(null, { status: 400 });
      const data = await fs.readFile(path.join(_dir, id));
      const ext = id.split('.').pop().toLowerCase();
      return new Response(data, {
        headers: {
          'Content-Type': EXT_TO_MIME[ext] || 'application/octet-stream',
          // id → content is 1:1 (a new upload gets a new id), so cache hard.
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

module.exports = { SCHEME, registerDashboardAssetScheme, setupDashboardAssetBridge };
