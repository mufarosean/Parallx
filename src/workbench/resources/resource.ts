// resource.ts — Unified Resource primitive (Slice A1)
//
// A stable identity for any piece of cross-tool content: files, canvas
// pages, chat sessions, tool artifacts, external URIs.
//
// Spec: docs/architecture/WORKBENCH_INTERACTION_MODEL.md §2.2
// Atlas weakness #1: docs/architecture/SYSTEM_ATLAS.md §12 (each feature
// invents its own ID scheme today; this is the canonical replacement).
//
// This module is INTENTIONALLY pure type + small constructor helpers.
// No consumers are migrated in this slice; the registry, link resolver
// integration, and selection service all land in later slices.

export type ResourceType =
  | 'file'
  | 'canvas-page'
  | 'chat-session'
  | 'tool-artifact'
  | 'external';

/** Absolute file path on the host filesystem. */
export interface FileResource {
  readonly type: 'file';
  readonly path: string;
  readonly hash?: string;
  readonly workspaceId?: string;
}

/** A canvas page (optionally a specific block inside it). */
export interface CanvasPageResource {
  readonly type: 'canvas-page';
  readonly pageId: string;
  readonly blockId?: string;
  readonly workspaceId?: string;
}

/** A chat session (optionally a specific turn inside it). */
export interface ChatSessionResource {
  readonly type: 'chat-session';
  readonly sessionId: string;
  readonly turnId?: string;
  readonly workspaceId?: string;
}

/** A tool-produced artifact identified by tool + artifact id. */
export interface ToolArtifactResource {
  readonly type: 'tool-artifact';
  readonly toolId: string;
  readonly artifactId: string;
  readonly workspaceId?: string;
}

/** Any non-Parallx URI (http, https, mailto, custom scheme, etc.). */
export interface ExternalResource {
  readonly type: 'external';
  readonly scheme: string;
  readonly uri: string;
}

export type Resource =
  | FileResource
  | CanvasPageResource
  | ChatSessionResource
  | ToolArtifactResource
  | ExternalResource;

// ─── Constructor helpers ─────────────────────────────────────────────────────
// Pure, no side effects. Useful for callers who want to build a Resource
// without remembering the exact field layout.

export function fileResource(path: string, opts?: { hash?: string; workspaceId?: string }): FileResource {
  return { type: 'file', path, hash: opts?.hash, workspaceId: opts?.workspaceId };
}

export function canvasPageResource(pageId: string, opts?: { blockId?: string; workspaceId?: string }): CanvasPageResource {
  return { type: 'canvas-page', pageId, blockId: opts?.blockId, workspaceId: opts?.workspaceId };
}

export function chatSessionResource(sessionId: string, opts?: { turnId?: string; workspaceId?: string }): ChatSessionResource {
  return { type: 'chat-session', sessionId, turnId: opts?.turnId, workspaceId: opts?.workspaceId };
}

export function toolArtifactResource(toolId: string, artifactId: string, opts?: { workspaceId?: string }): ToolArtifactResource {
  return { type: 'tool-artifact', toolId, artifactId, workspaceId: opts?.workspaceId };
}

export function externalResource(uri: string): ExternalResource {
  const idx = uri.indexOf(':');
  const scheme = idx > 0 ? uri.slice(0, idx) : '';
  return { type: 'external', scheme, uri };
}

// ─── Convenience adapters ────────────────────────────────────────────────────

/**
 * Build a Resource from a selection source (Slice A5). Selection adapters
 * carry `{ filePath, pageNumber? }` — this maps them to a `FileResource`
 * so future selection events can flow as Resources end-to-end without
 * each call-site re-implementing the conversion.
 *
 * Returns undefined when filePath is missing/blank.
 */
export function resourceFromSelectionSource(source: { filePath?: string; pageNumber?: number; workspaceId?: string }): Resource | undefined {
  const p = source?.filePath;
  if (!p || typeof p !== 'string') return undefined;
  return fileResource(p, { workspaceId: source.workspaceId });
}

/**
 * Structural equality for Resources. Compares by `type` plus the
 * type-specific identity fields:
 *   - file          → `path`
 *   - canvas-page   → `pageId` + `blockId`
 *   - chat-session  → `sessionId` + `turnId`
 *   - tool-artifact → `toolId` + `artifactId`
 *   - external      → `uri`
 *
 * `workspaceId` is part of identity for the four workspace-scoped kinds
 * (file, canvas-page, chat-session, tool-artifact) — a Resource pointing
 * at the same path in a different workspace is NOT the same Resource.
 * `hash` on FileResource is metadata, NOT identity.
 *
 * Useful for "is this resource open in any surface", de-duplicating
 * artifact lists, and active-resource change detection without relying
 * on object reference identity.
 */
export function resourceEquals(a: Resource | undefined, b: Resource | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'file':
      return a.path === (b as FileResource).path && a.workspaceId === (b as FileResource).workspaceId;
    case 'canvas-page': {
      const bb = b as CanvasPageResource;
      return a.pageId === bb.pageId && a.blockId === bb.blockId && a.workspaceId === bb.workspaceId;
    }
    case 'chat-session': {
      const bb = b as ChatSessionResource;
      return a.sessionId === bb.sessionId && a.turnId === bb.turnId && a.workspaceId === bb.workspaceId;
    }
    case 'tool-artifact': {
      const bb = b as ToolArtifactResource;
      return a.toolId === bb.toolId && a.artifactId === bb.artifactId && a.workspaceId === bb.workspaceId;
    }
    case 'external':
      return a.uri === (b as ExternalResource).uri;
  }
}
