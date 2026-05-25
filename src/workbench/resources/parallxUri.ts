// parallxUri.ts — Canonical URI scheme for Resource (Slice A1)
//
// Format: parallx://<type>:<id>[?query]
//   parallx://file:<encoded-path>?workspace=<uuid>&hash=<hash>
//   parallx://canvas-page:<uuid>?workspace=<uuid>&block=<uuid>
//   parallx://chat-session:<uuid>?workspace=<uuid>&turn=<uuid>
//   parallx://tool-artifact:<toolId>/<artifactId>?workspace=<uuid>
//
// Any non-parallx scheme is treated as an ExternalResource pass-through.
//
// Legacy alias: parallx.canvas:canvas:<uuid> is accepted and parses to
// a CanvasPageResource. See SYSTEM_ATLAS §4.1 (bridge #3) and
// WORKBENCH_INTERACTION_MODEL.md §2.2 migration story.
//
// This module is intentionally consumer-free: no service depends on it
// in this slice. It's verified by tests/unit/workbench/resources/parallxUri.tier0.test.ts.

import type {
  Resource,
  FileResource,
  CanvasPageResource,
  ChatSessionResource,
  ToolArtifactResource,
  ExternalResource,
  ResourceType,
} from './resource.js';

const PARALLX_PREFIX = 'parallx://';
const LEGACY_CANVAS_PREFIX = 'parallx.canvas:canvas:';

const KNOWN_TYPES: ReadonlySet<string> = new Set<ResourceType>([
  'file', 'canvas-page', 'chat-session', 'tool-artifact', 'external',
]);

// ─── parse ───────────────────────────────────────────────────────────────────

/**
 * Parse a URI string into a Resource. Returns null for malformed Parallx URIs.
 *
 * Acceptance rules:
 *   - `parallx://<type>:<id>[?query]` → typed Resource of that type.
 *   - `parallx.canvas:canvas:<uuid>` → CanvasPageResource (legacy alias).
 *   - Any other `<scheme>:...` → ExternalResource pass-through.
 *   - Empty / non-string / malformed parallx URIs → null.
 */
export function parse(uri: string): Resource | null {
  if (typeof uri !== 'string' || uri.length === 0) return null;

  // Legacy canvas alias takes precedence (its prefix doesn't match parallx://).
  if (uri.startsWith(LEGACY_CANVAS_PREFIX)) {
    const pageId = uri.slice(LEGACY_CANVAS_PREFIX.length);
    if (!pageId) return null;
    return { type: 'canvas-page', pageId };
  }

  if (uri.startsWith(PARALLX_PREFIX)) {
    return parseParallx(uri.slice(PARALLX_PREFIX.length));
  }

  // External: must have a scheme separator.
  const schemeEnd = uri.indexOf(':');
  if (schemeEnd <= 0) return null;
  const scheme = uri.slice(0, schemeEnd);
  return { type: 'external', scheme, uri };
}

function parseParallx(rest: string): Resource | null {
  // Split off optional query string.
  let body = rest;
  let queryStr = '';
  const qIdx = rest.indexOf('?');
  if (qIdx >= 0) {
    body = rest.slice(0, qIdx);
    queryStr = rest.slice(qIdx + 1);
  }

  // Body shape: <type>:<id...>
  const typeEnd = body.indexOf(':');
  if (typeEnd <= 0) return null;
  const type = body.slice(0, typeEnd);
  const idPart = body.slice(typeEnd + 1);
  if (!idPart) return null;
  if (!KNOWN_TYPES.has(type)) return null;

  const query = parseQuery(queryStr);

  switch (type as ResourceType) {
    case 'file': {
      const path = safeDecode(idPart);
      if (!path) return null;
      const r: FileResource = {
        type: 'file',
        path,
        ...(query.hash ? { hash: query.hash } : {}),
        ...(query.workspace ? { workspaceId: query.workspace } : {}),
      };
      return r;
    }
    case 'canvas-page': {
      const r: CanvasPageResource = {
        type: 'canvas-page',
        pageId: idPart,
        ...(query.block ? { blockId: query.block } : {}),
        ...(query.workspace ? { workspaceId: query.workspace } : {}),
      };
      return r;
    }
    case 'chat-session': {
      const r: ChatSessionResource = {
        type: 'chat-session',
        sessionId: idPart,
        ...(query.turn ? { turnId: query.turn } : {}),
        ...(query.workspace ? { workspaceId: query.workspace } : {}),
      };
      return r;
    }
    case 'tool-artifact': {
      const slash = idPart.indexOf('/');
      if (slash <= 0 || slash === idPart.length - 1) return null;
      const toolId = safeDecode(idPart.slice(0, slash));
      const artifactId = safeDecode(idPart.slice(slash + 1));
      if (!toolId || !artifactId) return null;
      const r: ToolArtifactResource = {
        type: 'tool-artifact',
        toolId,
        artifactId,
        ...(query.workspace ? { workspaceId: query.workspace } : {}),
      };
      return r;
    }
    case 'external': {
      // parallx://external:<encoded-uri> wrapper (uncommon; mostly callers pass raw external).
      const inner = safeDecode(idPart);
      if (!inner) return null;
      const schemeEnd = inner.indexOf(':');
      if (schemeEnd <= 0) return null;
      const r: ExternalResource = {
        type: 'external',
        scheme: inner.slice(0, schemeEnd),
        uri: inner,
      };
      return r;
    }
    default:
      return null;
  }
}

// ─── serialize ───────────────────────────────────────────────────────────────

/**
 * Serialize a Resource back into a canonical URI string.
 * External resources serialize to their raw `uri` field.
 */
export function serialize(resource: Resource): string {
  switch (resource.type) {
    case 'file': {
      const id = encodeURIComponent(resource.path);
      const q = buildQuery({ workspace: resource.workspaceId, hash: resource.hash });
      return `parallx://file:${id}${q}`;
    }
    case 'canvas-page': {
      const q = buildQuery({ workspace: resource.workspaceId, block: resource.blockId });
      return `parallx://canvas-page:${resource.pageId}${q}`;
    }
    case 'chat-session': {
      const q = buildQuery({ workspace: resource.workspaceId, turn: resource.turnId });
      return `parallx://chat-session:${resource.sessionId}${q}`;
    }
    case 'tool-artifact': {
      const id = `${encodeURIComponent(resource.toolId)}/${encodeURIComponent(resource.artifactId)}`;
      const q = buildQuery({ workspace: resource.workspaceId });
      return `parallx://tool-artifact:${id}${q}`;
    }
    case 'external':
      return resource.uri;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseQuery(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = safeDecode(pair.slice(0, eq));
    const v = safeDecode(pair.slice(eq + 1));
    if (k) out[k] = v;
  }
  return out;
}

function buildQuery(parts: Record<string, string | undefined>): string {
  const segs: string[] = [];
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === '') continue;
    segs.push(`${k}=${encodeURIComponent(v)}`);
  }
  return segs.length === 0 ? '' : `?${segs.join('&')}`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

// ─── identity ────────────────────────────────────────────────────────────────

/** Two resources are equal iff their canonical URI serialization matches. */
export function equals(a: Resource, b: Resource): boolean {
  return serialize(a) === serialize(b);
}
