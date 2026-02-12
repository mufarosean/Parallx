// uri.ts — URI class for resource identification
//
// All resources in Parallx are identified by URI objects. In M4 all URIs
// use the `file://` scheme, but the abstraction exists from day one so
// consumers never assume local filesystem.
//
// VS Code reference: src/vs/base/common/uri.ts — URI class

const _EMPTY = '';

/**
 * Uniform Resource Identifier — the canonical way to identify any resource.
 *
 * Immutable value type. Create via static factories: `URI.file()`, `URI.parse()`, `URI.from()`.
 */
export class URI {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  private constructor(
    scheme: string,
    authority: string,
    path: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  // ── Static Factories ─────────────────────────────────────────────────────

  /**
   * Create a `file://` URI from a local filesystem path.
   *
   * Normalises path separators to forward slashes and ensures a leading `/`.
   */
  static file(fsPath: string): URI {
    let path = fsPath.replace(/\\/g, '/');
    // Ensure leading slash (Windows paths like C:/foo → /C:/foo)
    if (path.length > 0 && path.charCodeAt(0) !== 0x2F /* / */) {
      path = '/' + path;
    }
    return new URI('file', _EMPTY, path, _EMPTY, _EMPTY);
  }

  /**
   * Create a URI from explicit components. Missing components default to `''`.
   */
  static from(components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): URI {
    return new URI(
      components.scheme,
      components.authority ?? _EMPTY,
      components.path ?? _EMPTY,
      components.query ?? _EMPTY,
      components.fragment ?? _EMPTY,
    );
  }

  /**
   * Parse a URI string into a URI object.
   *
   * Supports `file:///path`, `untitled:Untitled-1`, `scheme://authority/path?query#fragment`.
   */
  static parse(value: string): URI {
    // Quick path for file:// URIs (common case)
    if (value.startsWith('file:///')) {
      return new URI('file', _EMPTY, decodeURIComponent(value.slice(7)), _EMPTY, _EMPTY);
    }
    if (value.startsWith('file://')) {
      // file://authority/path
      const rest = value.slice(7);
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        return new URI('file', rest, '/', _EMPTY, _EMPTY);
      }
      return new URI('file', rest.slice(0, slashIdx), decodeURIComponent(rest.slice(slashIdx)), _EMPTY, _EMPTY);
    }

    // Generic URI parser
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (!match) {
      // Fallback: treat as an opaque path under the 'unknown' scheme
      return new URI('unknown', _EMPTY, value, _EMPTY, _EMPTY);
    }
    return new URI(
      match[1],
      match[2] ?? _EMPTY,
      decodeURIComponent(match[3] ?? _EMPTY),
      match[4] ?? _EMPTY,
      match[5] ?? _EMPTY,
    );
  }

  /**
   * Revive a plain JSON object (e.g. from workspace persistence) into a URI instance.
   */
  static revive(data: { scheme: string; authority?: string; path: string; query?: string; fragment?: string }): URI {
    return new URI(
      data.scheme,
      data.authority ?? _EMPTY,
      data.path,
      data.query ?? _EMPTY,
      data.fragment ?? _EMPTY,
    );
  }

  // ── Instance Methods ─────────────────────────────────────────────────────

  /**
   * For `file://` URIs, returns the local filesystem path.
   * On Windows, strips the leading slash for drive-letter paths (e.g., `/C:/foo` → `C:/foo`).
   */
  get fsPath(): string {
    if (this.scheme !== 'file') {
      throw new Error(`Cannot get fsPath for non-file URI (scheme: ${this.scheme})`);
    }
    let p = this.path;
    // Windows: /C:/foo → C:/foo
    if (p.length >= 3 && p.charCodeAt(0) === 0x2F && p.charCodeAt(2) === 0x3A) {
      p = p.slice(1);
    }
    return p;
  }

  /**
   * Return a new URI with some components replaced.
   */
  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): URI {
    return new URI(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  /**
   * Serialise to the standard URI string format.
   */
  toString(): string {
    let result = this.scheme + ':';
    if (this.authority || this.scheme === 'file') {
      result += '//' + this.authority;
    }
    result += encodeURIPath(this.path);
    if (this.query) {
      result += '?' + this.query;
    }
    if (this.fragment) {
      result += '#' + this.fragment;
    }
    return result;
  }

  /**
   * Serialise to a plain JSON object (for persistence).
   */
  toJSON(): { scheme: string; authority: string; path: string; query: string; fragment: string } {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }

  // ── Comparison ───────────────────────────────────────────────────────────

  /**
   * Check structural equality between two URIs.
   */
  equals(other: URI | undefined | null): boolean {
    if (!other) return false;
    return (
      this.scheme === other.scheme &&
      this.authority === other.authority &&
      this.path === other.path &&
      this.query === other.query &&
      this.fragment === other.fragment
    );
  }

  /**
   * Returns a string key suitable for use in Maps/Sets.
   */
  toKey(): string {
    return this.toString().toLowerCase();
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  /**
   * Get the basename (filename) from the URI path.
   */
  get basename(): string {
    const idx = this.path.lastIndexOf('/');
    return idx >= 0 ? this.path.slice(idx + 1) : this.path;
  }

  /**
   * Get the file extension (including the dot), or empty string.
   */
  get extname(): string {
    const name = this.basename;
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx) : _EMPTY;
  }

  /**
   * Get the parent directory path as a new URI, or undefined if already at root.
   */
  get dirname(): URI | undefined {
    const idx = this.path.lastIndexOf('/');
    if (idx <= 0) return undefined;
    return this.with({ path: this.path.slice(0, idx) });
  }

  /**
   * Create a child URI by appending a path segment.
   */
  joinPath(...segments: string[]): URI {
    let p = this.path;
    for (const seg of segments) {
      if (!p.endsWith('/')) p += '/';
      p += seg.replace(/\\/g, '/');
    }
    return this.with({ path: p });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Encode a URI path, preserving `/` and `:` but encoding other special chars.
 */
function encodeURIPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9/:.@_~!$&'()*+,;=-]/g, (ch) => {
    return '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
  });
}

/**
 * Utility: compare two URIs for use in sorting.
 */
export function uriCompare(a: URI, b: URI): number {
  return a.toKey() < b.toKey() ? -1 : a.toKey() > b.toKey() ? 1 : 0;
}

/**
 * Map keyed by URI (uses toKey() for hashing).
 */
export class URIMap<T> {
  private readonly _map = new Map<string, { uri: URI; value: T }>();

  get size(): number {
    return this._map.size;
  }

  get(uri: URI): T | undefined {
    return this._map.get(uri.toKey())?.value;
  }

  has(uri: URI): boolean {
    return this._map.has(uri.toKey());
  }

  set(uri: URI, value: T): void {
    this._map.set(uri.toKey(), { uri, value });
  }

  delete(uri: URI): boolean {
    return this._map.delete(uri.toKey());
  }

  values(): IterableIterator<T> {
    return mapIter(this._map.values(), (e) => e.value);
  }

  entries(): IterableIterator<[URI, T]> {
    return mapIter(this._map.values(), (e) => [e.uri, e.value] as [URI, T]);
  }

  forEach(fn: (value: T, uri: URI) => void): void {
    for (const { uri, value } of this._map.values()) {
      fn(value, uri);
    }
  }

  clear(): void {
    this._map.clear();
  }
}

function* mapIter<A, B>(iter: IterableIterator<A>, fn: (a: A) => B): IterableIterator<B> {
  for (const item of iter) {
    yield fn(item);
  }
}
