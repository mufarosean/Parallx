// surface.ts — Canonical Surface type (Slice A3)
//
// A Surface is a visible place where work happens: Explorer, an editor,
// Canvas, chat, a panel, a sidebar, a modal, or an extension view. This
// type names the surface and describes what it currently shows so that
// context-aware services (selection, commands, when-clauses, AI chat,
// retrieval) can talk to "the active surface" without coupling to part /
// editor / view internals.
//
// Spec: WORKBENCH_INTERACTION_MODEL.md §2.3 Surface.
//
// Pure-additive in Slice A3 — no part / editor / view registers as a
// Surface yet. The registry is exercised by tier-0 tests only.

import type { Resource } from './resource.js';

/**
 * Stable identifiers for built-in surface kinds. Extensions may use
 * `extension-view` with their own `extensionId`/`viewId` qualifiers in
 * the `id` field. We keep this open via the union with `string` so
 * non-built-in surfaces can self-identify.
 */
export type SurfaceKind =
  | 'explorer'
  | 'editor'
  | 'canvas'
  | 'chat'
  | 'panel'
  | 'sidebar'
  | 'modal'
  | 'extension-view'
  | (string & {});

/**
 * One surface entry. `id` is unique workbench-wide. `kind` describes the
 * category. `displayName` is user-facing. `resource` is the resource the
 * surface is currently showing, if any (an editor showing a file; canvas
 * showing a page; chat showing a session).
 *
 * `metadata` is an open bag for surface-kind-specific facts (e.g. an
 * editor's `editorId`, a panel's `viewId`). Surfaces that need stronger
 * typing can narrow this in their own modules.
 */
export interface Surface {
  readonly id: string;
  readonly kind: SurfaceKind;
  readonly displayName: string;
  readonly resource?: Resource;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Constructor helper. Returns a frozen Surface. */
export function surface(
  id: string,
  kind: SurfaceKind,
  displayName: string,
  resource?: Resource,
  metadata?: Readonly<Record<string, unknown>>,
): Surface {
  const s: Surface = { id, kind, displayName, resource, metadata };
  return Object.freeze(s);
}
