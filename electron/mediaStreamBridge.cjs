// mediaStreamBridge.cjs — parallx-media:// streams local video and audio.
//
// Why this exists: the renderer reads files through fs:readFile, which sends
// the whole file over IPC as base64 and refuses anything over 512 MB. A
// two-hour painting session is gigabytes, so it could not even be previewed.
// This scheme serves the file from disk in pieces (HTTP Range requests), so a
// <video> seeks anywhere in a long file and only the bytes it plays are read.
//
// Safety: only paths the fs bridge would let the renderer read (the caller
// passes that check in), only media file types, read-only. Responses carry
// Access-Control-Allow-Origin so a <video crossOrigin="anonymous"> can still
// be drawn to a canvas without tainting it.
//
// URL shape: parallx-media://file/<encodeURIComponent(absolute path)>

const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const SCHEME = 'parallx-media';

const MEDIA_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
  '.ogv': 'video/ogg', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.ts': 'video/mp2t', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
};

/** The URL for an absolute file path. */
function mediaUrlFor(absPath) {
  return `${SCHEME}://file/${encodeURIComponent(String(absPath))}`;
}

/** The absolute path a request URL names, or null when it names none. */
function pathFromMediaUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== 'file') return null;
  let p;
  try { p = decodeURIComponent(u.pathname.replace(/^\/+/, '')); } catch { return null; }
  if (!p || p.includes('\0') || !path.isAbsolute(p)) return null;
  return path.resolve(p);
}

/**
 * Parse a Range header against a file size. Returns null for no (usable)
 * range, 'unsatisfiable' when the range lies outside the file, or the
 * inclusive byte span. Only single ranges are served (what media elements
 * ask for); a multi-range request gets the first range.
 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*([^,]*)/i.exec(String(header));
  if (!m) return null;
  const spec = m[1].trim();
  const mm = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!mm || (mm[1] === '' && mm[2] === '')) return null;
  let start, end;
  if (mm[1] === '') {
    const suffix = parseInt(mm[2], 10);
    if (!(suffix > 0)) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(mm[1], 10);
    end = mm[2] === '' ? size - 1 : Math.min(parseInt(mm[2], 10), size - 1);
  }
  if (!(size > 0) || start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** The scheme's privileges. Electron honours only the LAST call to
 *  registerSchemesAsPrivileged, so main.cjs registers every scheme in one. */
const MEDIA_SCHEME_SPEC = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
};

/**
 * Wire the protocol handler. Call after app 'ready'.
 * @param {Electron.Protocol} protocol
 * @param {(absPath: string) => boolean} isAllowed  the fs bridge's read check
 */
function setupMediaStreamBridge(protocol, isAllowed) {
  protocol.handle(SCHEME, async (request) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
    const filePath = pathFromMediaUrl(request.url);
    const mime = filePath ? MEDIA_MIME[path.extname(filePath).toLowerCase()] : null;
    if (!filePath || !mime) return new Response(null, { status: 400, headers: cors });
    if (!isAllowed(filePath)) return new Response(null, { status: 403, headers: cors });
    let stat;
    try { stat = await fs.promises.stat(filePath); } catch { return new Response(null, { status: 404, headers: cors }); }
    if (!stat.isFile()) return new Response(null, { status: 404, headers: cors });
    const size = stat.size;
    const base = { ...cors, 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    const head = request.method === 'HEAD';
    if (!range) {
      const body = head || size === 0 ? null : Readable.toWeb(fs.createReadStream(filePath));
      return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
    }
    const { start, end } = range;
    const body = head ? null : Readable.toWeb(fs.createReadStream(filePath, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
    });
  });
}

module.exports = { SCHEME, MEDIA_MIME, mediaUrlFor, pathFromMediaUrl, parseRange, MEDIA_SCHEME_SPEC, setupMediaStreamBridge };
