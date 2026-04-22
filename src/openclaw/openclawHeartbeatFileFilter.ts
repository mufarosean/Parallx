/**
 * HeartbeatFileFilter — decides whether a file-change event should wake
 * the heartbeat. Applied at the event-source boundary in chat/main.ts
 * before `heartbeatRunner.pushEvent`.
 *
 * Scope: file-change events only. `index-complete` and `workspace-change`
 * events are not filtered — they're coarse and always worth a check.
 *
 * The filter is two-part:
 *   1. **Include allowlist** by extension (e.g. `.ts`, `.md`). Empty = allow all.
 *   2. **Exclude denylist** by minimal glob (e.g. `**​/node_modules/**`).
 *      Exclude always wins over include.
 *
 * Globs support `**` (any path segments), `*` (any chars except `/`),
 * `?` (single char). Matching is case-insensitive so Windows paths work.
 */

/**
 * Convert a minimal glob to a RegExp. Exported for testing.
 */
export function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (glob[i] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^$|()[]{}\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function getExtension(path: string): string {
  const idx = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx < 0 || idx < slash) return '';
  return path.slice(idx).toLowerCase();
}

function normalizePath(path: string): string {
  // Strip file:// scheme and Windows drive letters / backslashes so globs
  // behave consistently. Accepts both file:///C:/foo/bar and plain paths.
  let p = path;
  if (p.startsWith('file://')) {
    try { p = decodeURIComponent(new URL(p).pathname); }
    catch { p = p.replace(/^file:\/+/, '/'); }
  }
  p = p.replace(/\\/g, '/');
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // /C:/foo → C:/foo
  return p;
}

/**
 * @returns true if the file-change event should be forwarded to the
 *   heartbeat; false if it should be dropped.
 */
export function shouldHeartbeatAcceptPath(
  rawPath: string,
  includeExtensions: readonly string[],
  excludeGlobs: readonly string[],
): boolean {
  const path = normalizePath(rawPath);

  // Exclude wins.
  for (const glob of excludeGlobs) {
    if (globToRegex(glob).test(path)) return false;
  }

  // Empty include list = accept all (minus excludes).
  if (includeExtensions.length === 0) return true;

  const ext = getExtension(path);
  if (!ext) return false;
  // Normalize include extensions (lowercase, ensure leading dot).
  for (const raw of includeExtensions) {
    const norm = raw.startsWith('.') ? raw.toLowerCase() : '.' + raw.toLowerCase();
    if (ext === norm) return true;
  }
  return false;
}
