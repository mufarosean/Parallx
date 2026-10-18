// sandboxFrameBridge.cjs — parallx-frame://, where AI-written HTML runs.
//
// The dashboard's Live widget and chat's mini-apps run model-written HTML in
// an iframe sandboxed without same-origin (src/ui/sandboxedHtml.ts). Its
// document used to be a blob: URL, but Chromium gives a blob: (or srcdoc,
// or data:) document the policy of the page that made it, and the window's
// policy allows no inline script: the app's own script never ran. A
// document served from this scheme is its own: it carries only the strict
// policy below (no network, no files), sent as a header and repeated in
// the document's <meta>.
//
// The renderer registers a document and gets its URL back. Documents are
// kept in memory, the newest 200 (a frame moved in the page reloads its
// URL, so one is not dropped after its first load).

const { randomUUID } = require('node:crypto');

const SCHEME = 'parallx-frame';
const KEEP = 200;
const MAX_BYTES = 4 * 1024 * 1024;

/** Keep in step with SANDBOX_CSP in src/ui/sandboxedHtml.ts (a test checks). */
const SANDBOX_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const SANDBOX_FRAME_SCHEME_SPEC = { scheme: SCHEME, privileges: { standard: true, secure: true } };

const _docs = new Map();

function setupSandboxFrameBridge(ipcMain, protocol) {
  ipcMain.handle('sandboxFrame:register', (_event, html) => {
    const text = String(html ?? '');
    if (Buffer.byteLength(text) > MAX_BYTES) return { error: 'The app is too large to show.' };
    const id = randomUUID();
    _docs.set(id, text);
    while (_docs.size > KEEP) _docs.delete(_docs.keys().next().value);
    return { url: `${SCHEME}://frame/${id}` };
  });

  protocol.handle(SCHEME, (request) => {
    const id = new URL(request.url).pathname.replace(/^\/+/, '');
    const html = _docs.get(id);
    if (html === undefined) return new Response('', { status: 404 });
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': SANDBOX_CSP,
        'Cache-Control': 'no-store',
      },
    });
  });
}

module.exports = { SCHEME, SANDBOX_CSP, SANDBOX_FRAME_SCHEME_SPEC, setupSandboxFrameBridge };
