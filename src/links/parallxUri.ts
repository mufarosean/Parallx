// parallxUri.ts — pure parse + mint helpers for `parallx://` URIs.
//
// The canonical link format for Milestone 66. Every cite-able resource in
// Parallx is addressable via a `parallx://` URI of the shape:
//
//     parallx://<segment>/<kind>[/<id>...][?<param>=<value>...]
//
// where `<segment>` is the owning extension's segment (e.g. `canvas`,
// `media-organizer`) and `<kind>` is the resource type (e.g. `page`,
// `photo`). This module is intentionally dependency-free so it can be
// imported from any layer — services, bridges, renderers, tests, or
// the chat markdown renderer running in a worker.

const SCHEME = 'parallx:';

/** Parsed shape of a `parallx://` URI. Stable contract for handlers. */
export interface ParsedLink {
  /** Original input, trimmed. */
  readonly raw: string;
  /** Owning segment, e.g. `canvas`, `media-organizer`. Lower-case preserved as supplied. */
  readonly segment: string;
  /** Path segments after the segment, decoded. e.g. for `parallx://canvas/page/abc`, pathSegments = ['page', 'abc']. */
  readonly pathSegments: readonly string[];
  /** Query parameters. */
  readonly params: Readonly<Record<string, string>>;
  /** First path segment — by convention the resource kind (`page`, `photo`, ...). */
  readonly kind: string | undefined;
}

/** Returns null for any input that does not parse as a valid `parallx://` URI. Never throws. */
export function parseParallxUri(uri: string): ParsedLink | null {
  if (typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith('parallx://')) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== SCHEME) return null;

  // For `parallx://canvas/page/abc`, host = 'canvas', pathname = '/page/abc'.
  const segment = decodeURIComponent(u.host);
  if (!segment) return null;

  const pathSegments = u.pathname
    .split('/')
    .filter(p => p.length > 0)
    .map(p => {
      try { return decodeURIComponent(p); } catch { return p; }
    });

  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });

  return {
    raw: trimmed,
    segment,
    pathSegments,
    params,
    kind: pathSegments[0],
  };
}

/**
 * Mint a properly-encoded `parallx://` URI.
 *
 * @param segment  Owning extension segment (e.g. `canvas`).
 * @param path     Path under the segment, either a string `'page/abc'` or array `['page', 'abc']`.
 * @param params   Optional query parameters. `null`/`undefined` values are skipped.
 */
export function mintParallxUri(
  segment: string,
  path: string | readonly string[],
  params?: Readonly<Record<string, string | number | undefined | null>>,
): string {
  if (!segment || typeof segment !== 'string') {
    throw new Error('mintParallxUri: segment is required');
  }
  const parts = Array.isArray(path) ? path : String(path).split('/');
  const encPath = parts
    .filter(p => p !== '' && p != null)
    .map(p => encodeURIComponent(String(p)))
    .join('/');

  let uri = `parallx://${encodeURIComponent(segment)}`;
  if (encPath) uri += '/' + encPath;

  if (params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      usp.set(k, String(v));
    }
    const q = usp.toString();
    if (q) uri += '?' + q;
  }
  return uri;
}

/** Cheap predicate: does this string start with the `parallx://` scheme? */
export function isParallxUri(s: unknown): s is string {
  return typeof s === 'string' && s.trim().toLowerCase().startsWith('parallx://');
}
