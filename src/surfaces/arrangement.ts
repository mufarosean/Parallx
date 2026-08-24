// arrangement.ts — a shape of the app, saved
//
// Foundation Decision 5 (docs/FOUNDATION.md). This is the piece that makes
// Parallx sandbox software rather than a well-built workbench.
//
// An arrangement owns three things: the tree (what is where, at what size),
// the surfaces in it, and their BINDINGS (what each is pointed at). The third
// is the whole difference. Layout alone is a saved window position. Layout
// plus bindings is a working context — "Study" is not "flashcards on the
// right", it is "flashcards on the right showing the Exam 7 deck, next to
// Taylor's paper at the page I stopped on".
//
// Notion felt limitless because a structure could be captured, shared and
// adopted. Parallx's equivalent is not a page template; it is this. The
// student's Parallx and the programmer's Parallx are one install in two
// arrangements, and either can be exported and handed to someone else.
//
// Everything here is pure. No DOM, no grid instance, no registry — capture
// takes a serialised grid plus a lookup, resolve returns a plan for the caller
// to execute. That is what lets the hard part be tested without a workbench.

import { Orientation, SizingMode } from '../layout/layoutTypes.js';
import type { SerializedGrid, SerializedGridNode } from '../layout/layoutModel.js';
import { SerializedNodeType } from '../layout/layoutModel.js';
import type { ISurface, ISurfaceBinding, ISurfaceDescriptor, SurfaceState } from './surfaceTypes.js';

/**
 * Bumped when the stored shape changes incompatibly. An arrangement outlives
 * the release that wrote it — it can be exported, shared, and loaded into a
 * newer Parallx — so the version is on the file, not implied by the app.
 */
export const ARRANGEMENT_VERSION = 1;

// ─── Stored shape ────────────────────────────────────────────────────────────

export interface ArrangementLeaf {
  readonly type: 'leaf';
  readonly size: number;
  readonly sizingMode: SizingMode;
  /**
   * WHAT the surface is, never WHICH instance it was. Instance ids are
   * runtime identity and do not survive a restart, let alone being handed to
   * someone else's machine.
   */
  readonly typeId: string;
  readonly binding?: ISurfaceBinding;
  readonly state?: SurfaceState;
}

export interface ArrangementBranch {
  readonly type: 'branch';
  readonly orientation: Orientation;
  readonly size: number;
  readonly sizingMode: SizingMode;
  readonly children: readonly ArrangementNode[];
}

export type ArrangementNode = ArrangementBranch | ArrangementLeaf;

export interface Arrangement {
  readonly version: number;
  readonly id: string;
  /** Shown in the switcher. Title Case. */
  readonly name: string;
  /** Registry icon id. */
  readonly icon?: string;
  readonly rootOrientation: Orientation;
  readonly root: ArrangementBranch;
}

// ─── Capture ─────────────────────────────────────────────────────────────────

/** Resolve a live grid view id to the surface it hosts. */
export type SurfaceLookup = (viewId: string) => ISurface | undefined;

/**
 * Turn the live layout into a saved arrangement.
 *
 * Leaves whose view is not a surface are DROPPED rather than stored as
 * unknown: a half-captured arrangement that restores into a tree with holes in
 * it is worse than one that restores a little smaller. The drop is visible in
 * the result rather than silent (see `capturedCount` / `droppedCount`).
 */
export function captureArrangement(
  grid: SerializedGrid,
  meta: { id: string; name: string; icon?: string },
  lookup: SurfaceLookup,
): { arrangement: Arrangement; capturedCount: number; droppedCount: number } {
  let captured = 0;
  let dropped = 0;

  const walk = (node: SerializedGridNode): ArrangementNode | undefined => {
    if (node.type === SerializedNodeType.Leaf) {
      const surface = lookup(node.viewId);
      if (!surface) { dropped++; return undefined; }
      captured++;
      const binding = surface.binding;
      const state = surface.saveState();
      return {
        type: 'leaf',
        size: node.size,
        sizingMode: node.sizingMode,
        typeId: surface.typeId,
        ...(binding ? { binding } : {}),
        ...(state && Object.keys(state).length > 0 ? { state } : {}),
      };
    }

    const children = node.children
      .map(walk)
      .filter((n): n is ArrangementNode => n !== undefined);
    // A branch that lost every child is not a layout, it is a hole. A branch
    // down to one child is no longer a split, so it collapses — the same
    // canonical-tree rule the grid itself keeps.
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return {
      type: 'branch',
      orientation: node.orientation,
      size: node.size,
      sizingMode: node.sizingMode,
      children,
    };
  };

  const rootNode = walk(grid.root);
  const root: ArrangementBranch = rootNode && rootNode.type === 'branch'
    ? rootNode
    : {
      type: 'branch',
      orientation: grid.orientation,
      size: 0,
      sizingMode: SizingMode.Pixel,
      children: rootNode ? [rootNode] : [],
    };

  return {
    arrangement: {
      version: ARRANGEMENT_VERSION,
      id: meta.id,
      name: meta.name,
      ...(meta.icon ? { icon: meta.icon } : {}),
      rootOrientation: grid.orientation,
      root,
    },
    capturedCount: captured,
    droppedCount: dropped,
  };
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

/**
 * A leaf that cannot be built, and why.
 *
 * FOUNDATION.md's third open question, answered: a surface whose extension is
 * gone degrades to a NAMED placeholder that explains itself. Never a blank
 * pane, and never a load failure that takes the whole arrangement down —
 * losing your entire layout because one extension was uninstalled is the
 * failure mode that makes people stop trusting saved layouts.
 */
export interface UnavailableLeaf {
  readonly typeId: string;
  readonly binding?: ISurfaceBinding;
  readonly reason: 'unknown-type';
  /** What to show in the placeholder. */
  readonly label: string;
}

export interface ResolvedLeaf {
  readonly kind: 'surface' | 'placeholder';
  readonly size: number;
  readonly sizingMode: SizingMode;
  readonly typeId: string;
  readonly binding?: ISurfaceBinding;
  readonly state?: SurfaceState;
  readonly descriptor?: ISurfaceDescriptor;
  readonly unavailable?: UnavailableLeaf;
}

export interface ResolvedBranch {
  readonly kind: 'branch';
  readonly orientation: Orientation;
  readonly size: number;
  readonly sizingMode: SizingMode;
  readonly children: readonly ResolvedNode[];
}

export type ResolvedNode = ResolvedBranch | ResolvedLeaf;

export interface ResolvedArrangement {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly rootOrientation: Orientation;
  readonly root: ResolvedBranch;
  /** Every leaf that could not be built. Empty on a clean restore. */
  readonly unavailable: readonly UnavailableLeaf[];
}

/**
 * Plan the restore. Pure: decides what CAN be built and what cannot, and
 * leaves the building to the caller.
 *
 * Nothing is instantiated here on purpose. Resolution has to be answerable
 * before anything is torn down, so switching arrangements can report "3 of
 * these will not open" without having already dismantled the current one.
 */
export function resolveArrangement(
  arrangement: Arrangement,
  getDescriptor: (typeId: string) => ISurfaceDescriptor | undefined,
): ResolvedArrangement {
  const unavailable: UnavailableLeaf[] = [];

  const walk = (node: ArrangementNode): ResolvedNode => {
    if (node.type === 'leaf') {
      const descriptor = getDescriptor(node.typeId);
      if (descriptor) {
        return {
          kind: 'surface',
          size: node.size,
          sizingMode: node.sizingMode,
          typeId: node.typeId,
          ...(node.binding ? { binding: node.binding } : {}),
          ...(node.state ? { state: node.state } : {}),
          descriptor,
        };
      }
      const miss: UnavailableLeaf = {
        typeId: node.typeId,
        ...(node.binding ? { binding: node.binding } : {}),
        reason: 'unknown-type',
        // The binding's label when there is one: "Taylor.pdf" tells you what
        // is missing far better than "canvas.page" does.
        label: node.binding?.label ?? node.typeId,
      };
      unavailable.push(miss);
      return {
        kind: 'placeholder',
        size: node.size,
        sizingMode: node.sizingMode,
        typeId: node.typeId,
        ...(node.binding ? { binding: node.binding } : {}),
        unavailable: miss,
      };
    }

    return {
      kind: 'branch',
      orientation: node.orientation,
      size: node.size,
      sizingMode: node.sizingMode,
      children: node.children.map(walk),
    };
  };

  const root = walk(arrangement.root) as ResolvedBranch;
  return {
    id: arrangement.id,
    name: arrangement.name,
    ...(arrangement.icon ? { icon: arrangement.icon } : {}),
    rootOrientation: arrangement.rootOrientation,
    root,
    unavailable,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Accept an arrangement from disk or from someone else's machine.
 *
 * Arrangements are shareable, so this parses untrusted JSON: anything
 * malformed returns undefined rather than throwing into the workbench's
 * startup path. A layout that will not load must cost you that layout, never
 * the app.
 */
export function parseArrangement(raw: unknown): Arrangement | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  if (typeof a['id'] !== 'string' || typeof a['name'] !== 'string') return undefined;
  if (typeof a['version'] !== 'number' || a['version'] > ARRANGEMENT_VERSION) return undefined;

  const root = parseNode(a['root']);
  if (!root || root.type !== 'branch') return undefined;

  const orientation = a['rootOrientation'] === Orientation.Vertical
    ? Orientation.Vertical
    : Orientation.Horizontal;

  return {
    version: a['version'] as number,
    id: a['id'] as string,
    name: a['name'] as string,
    ...(typeof a['icon'] === 'string' ? { icon: a['icon'] as string } : {}),
    rootOrientation: orientation,
    root,
  };
}

function parseNode(raw: unknown): ArrangementNode | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = raw as Record<string, unknown>;
  const size = typeof n['size'] === 'number' ? n['size'] : 0;
  const sizingMode = n['sizingMode'] === SizingMode.Proportional
    ? SizingMode.Proportional
    : SizingMode.Pixel;

  if (n['type'] === 'leaf') {
    if (typeof n['typeId'] !== 'string') return undefined;
    return {
      type: 'leaf',
      size,
      sizingMode,
      typeId: n['typeId'] as string,
      ...(parseBinding(n['binding']) ? { binding: parseBinding(n['binding']) } : {}),
      ...(n['state'] && typeof n['state'] === 'object'
        ? { state: n['state'] as SurfaceState }
        : {}),
    };
  }

  if (n['type'] === 'branch') {
    const rawChildren = Array.isArray(n['children']) ? n['children'] : [];
    const children = rawChildren
      .map(parseNode)
      .filter((c): c is ArrangementNode => c !== undefined);
    // A branch with nothing usable in it is dropped by the caller's filter.
    if (children.length === 0) return undefined;
    return {
      type: 'branch',
      orientation: n['orientation'] === Orientation.Vertical
        ? Orientation.Vertical
        : Orientation.Horizontal,
      size,
      sizingMode,
      children,
    };
  }

  return undefined;
}

function parseBinding(raw: unknown): ISurfaceBinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  if (typeof b['kind'] !== 'string' || typeof b['key'] !== 'string') return undefined;
  return {
    kind: b['kind'] as string,
    key: b['key'] as string,
    label: typeof b['label'] === 'string' ? (b['label'] as string) : (b['key'] as string),
    ...(typeof b['icon'] === 'string' ? { icon: b['icon'] as string } : {}),
    ...(typeof b['description'] === 'string' ? { description: b['description'] as string } : {}),
  };
}

/** Every surface type an arrangement needs. Drives "this needs extension X". */
export function requiredTypeIds(arrangement: Arrangement): readonly string[] {
  const ids = new Set<string>();
  const walk = (node: ArrangementNode): void => {
    if (node.type === 'leaf') { ids.add(node.typeId); return; }
    for (const child of node.children) walk(child);
  };
  walk(arrangement.root);
  return [...ids];
}
