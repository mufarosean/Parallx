// resourceService.ts — Cross-tool resource identity (M83-W3 seed)
//
// Today, Explorer, editor groups, chat, and canvas each invent their own
// URI handling: file paths, scheme parsing, drag payload formats, "is this
// a canvas page?" detection. The result is that wiring Explorer → Canvas
// drop, chat → editor open, or canvas-block → editor preview requires
// every consumer to re-implement the same URI classification.
//
// IResourceService is the seed of a single source of truth for resource
// identity. Every surface that needs to interpret or transport a resource
// reference will eventually resolve it through this service.
//
// W3 scope (this file):
//   - Define ResourceKind, IResourceHandle, IResourceService.
//   - Provide a default implementation that classifies URIs by scheme
//     and produces stable handles.
//
// W3 follow-ups (not in this slice):
//   - Migrate Explorer→Canvas drop wiring to resolve() instead of
//     hand-rolling MIME-type and path checks.
//   - Migrate chat link-click → editor.open to a single resolve+open call.
//   - Surface getCurrentSelection() across the workbench so any tool can
//     consume "what is the user looking at right now?" without binding
//     to a specific surface (editor / explorer / canvas / chat input).
//
// Upstream parity:
//   - VS Code IFileService + ITextFileService split resource resolution
//     from data fetching. Our IResourceService occupies the "identity"
//     half: who you are, not your bytes.

import { URI } from '../platform/uri.js';
import { createServiceIdentifier } from '../platform/types.js';

// ─── Resource kinds ────────────────────────────────────────────────────────

/**
 * Coarse classification of a resource. New kinds may be added as new
 * surfaces ship; the catch-all is `'unknown'`.
 */
export type ResourceKind =
  | 'file'           // file:// URI on disk
  | 'untitled'       // untitled: editor not yet on disk
  | 'canvas-page'    // canvas-page://workspace/<pageId>
  | 'canvas-block'   // canvas-block://workspace/<pageId>#<blockId>
  | 'artifact'       // artifact://<store>/<id> — chat-emitted artifact
  | 'unknown';

// ─── Resource handle ───────────────────────────────────────────────────────

/**
 * A typed, stable reference to a resource. Two handles refer to the
 * same resource if and only if their URIs compare equal.
 *
 * Handles are immutable. They do NOT carry content; consumers call
 * IFileService / canvas data service / etc. with the URI to fetch bytes.
 */
export interface IResourceHandle {
  /** Canonical URI for this resource. */
  readonly uri: URI;

  /** Coarse kind classification — drives surface routing. */
  readonly kind: ResourceKind;

  /**
   * Display label suitable for status bar / breadcrumb / drag overlay.
   * Falls back to the URI's basename when no friendlier name is known.
   */
  readonly label: string;

  /**
   * Optional workspace folder this resource belongs to, when knowable
   * from the URI alone. Cross-tool consumers use this to scope queries
   * (e.g. "find canvas blocks linking to this file in THIS workspace").
   */
  readonly workspaceFolderPath?: string;
}

// ─── Service interface ─────────────────────────────────────────────────────

/**
 * Resolves URIs into typed resource handles and exposes the current
 * cross-tool selection.
 *
 * This is intentionally minimal in W3. Future slices will add:
 *   - subscribe(listener) for selection-change events
 *   - getCurrentSelection() returning the union of active focus across
 *     editor / explorer / canvas / chat input
 *   - Drag payload (de)serialization, replacing per-surface MIME parsing
 */
export interface IResourceService {
  /**
   * Classify a URI into a stable handle. Never throws — returns a handle
   * with kind='unknown' for unrecognized schemes.
   */
  resolve(uri: URI): IResourceHandle;

  /**
   * Parse a URI string. Returns undefined when the string is not a valid
   * URI, NOT when the resulting URI is of unknown kind.
   */
  parse(uriString: string): IResourceHandle | undefined;
}

export const IResourceService = createServiceIdentifier<IResourceService>('IResourceService');

// ─── Default implementation ────────────────────────────────────────────────

const CANVAS_PAGE_SCHEME = 'canvas-page';
const CANVAS_BLOCK_SCHEME = 'canvas-block';
const ARTIFACT_SCHEME = 'artifact';
const UNTITLED_SCHEME = 'untitled';
const FILE_SCHEME = 'file';

export class ResourceService implements IResourceService {
  resolve(uri: URI): IResourceHandle {
    const kind = classifyScheme(uri.scheme);
    const label = deriveLabel(uri, kind);
    const workspaceFolderPath = kind === 'file' ? deriveWorkspaceFolderHint(uri.fsPath) : undefined;
    return { uri, kind, label, workspaceFolderPath };
  }

  parse(uriString: string): IResourceHandle | undefined {
    if (!uriString) return undefined;
    try {
      const uri = URI.parse(uriString);
      // URI.parse is permissive and never throws; we still guard against
      // the platform returning a URI with an empty scheme so callers can
      // distinguish parse failure from a valid-but-unrecognized URI.
      if (!uri.scheme) return undefined;
      return this.resolve(uri);
    } catch {
      return undefined;
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function classifyScheme(scheme: string): ResourceKind {
  switch (scheme) {
    case FILE_SCHEME: return 'file';
    case UNTITLED_SCHEME: return 'untitled';
    case CANVAS_PAGE_SCHEME: return 'canvas-page';
    case CANVAS_BLOCK_SCHEME: return 'canvas-block';
    case ARTIFACT_SCHEME: return 'artifact';
    default: return 'unknown';
  }
}

function deriveLabel(uri: URI, kind: ResourceKind): string {
  if (kind === 'file') {
    // fsPath throws on non-file URIs; guarded by the kind check.
    const fsPath = uri.fsPath;
    if (fsPath) {
      const sep = fsPath.lastIndexOf('/') >= 0 ? '/' : '\\';
      const idx = fsPath.lastIndexOf(sep);
      const base = idx >= 0 ? fsPath.substring(idx + 1) : fsPath;
      if (base) return base;
    }
  }
  if (kind === 'untitled') {
    // untitled: URIs encode the buffer name in the path.
    if (uri.path) return trimLeadingSlash(uri.path);
  }
  if (kind === 'canvas-block') {
    // canvas-block://workspace/<pageId>#<blockId> — surface block id
    if (uri.fragment) return `block:${uri.fragment}`;
    if (uri.path) return `page:${trimLeadingSlash(uri.path)}`;
  }
  if (kind === 'canvas-page' && uri.path) {
    return `page:${trimLeadingSlash(uri.path)}`;
  }
  if (kind === 'artifact' && uri.path) {
    return `artifact:${trimLeadingSlash(uri.path)}`;
  }
  return uri.toString();
}

function deriveWorkspaceFolderHint(fsPath: string): string | undefined {
  // Best-effort hint only — the real workspace folder lookup belongs to
  // IWorkspaceService.getWorkspaceFolder. Returning undefined here keeps
  // the seed implementation honest: consumers MUST cross-reference with
  // IWorkspaceService when they need an authoritative answer.
  if (!fsPath) return undefined;
  return undefined;
}

function trimLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.substring(1) : s;
}
