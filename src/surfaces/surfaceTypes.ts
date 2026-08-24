// surfaceTypes.ts — the one citizen
//
// Foundation Decision 2 (docs/FOUNDATION.md). Parallx had four separate
// contracts for "a thing that renders", each with its own API, lifecycle, and
// a hardcoded home:
//
//   IView          sidebar / panel   — has title, icon, state; no binding
//   IEditorPane    editor area only  — has a binding (EditorInput); no title
//   dashboard widget  dashboard grid — its own API entirely
//   status bar item   status bar     — its own API entirely
//
// Regions were typed slots rather than containers, so nothing could move. A
// Surface is the union of what those contracts already needed, minus the one
// thing none of them should ever have had: knowledge of where it lives.
//
// THE INVARIANT: a surface does not know its position. It cannot read its
// region, cannot branch on "am I in the sidebar", and renders identically
// wherever it is placed. Everything else in the foundation rests on this, and
// it is the first thing that will be violated under deadline pressure — if a
// drag-to-edge feature ever needs a special case, this invariant broke.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { SizeConstraints } from '../layout/layoutTypes.js';

// ─── Binding ─────────────────────────────────────────────────────────────────

/**
 * What a surface is pointed at.
 *
 * Generalised from `IEditorInput`, which already modelled exactly this for the
 * editor area alone. Layout without bindings is a saved window position;
 * layout WITH bindings is a working context, which is what makes an
 * arrangement worth naming and sharing (Decision 5).
 *
 * `kind` + `key` must be stable across restarts: they are what an arrangement
 * persists, and what it resolves against on load.
 */
export interface ISurfaceBinding {
  /** Namespace of the thing bound to: 'file', 'page', 'deck', 'folder', … */
  readonly kind: string;
  /** Stable identity within `kind`. A path, a uuid, a deck id. */
  readonly key: string;
  /** What to show in the tab. */
  readonly label: string;
  /** Registry icon id. Never an emoji, never a raw glyph. */
  readonly icon?: string;
  /** Longer identification for tooltips: a full path, a deck's deck. */
  readonly description?: string;
}

/** Two bindings address the same thing. */
export function bindingsEqual(
  a: ISurfaceBinding | undefined,
  b: ISurfaceBinding | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.key === b.key;
}

/** Stable string form, for arrangement persistence and activity keying. */
export function bindingId(binding: ISurfaceBinding | undefined): string {
  return binding ? `${binding.kind}:${binding.key}` : '';
}

// ─── State ───────────────────────────────────────────────────────────────────

/** Whatever a surface needs to come back looking the same. */
export type SurfaceState = Record<string, unknown>;

// ─── The surface ─────────────────────────────────────────────────────────────

export interface ISurface extends IDisposable {
  /**
   * Instance id, unique per live surface. Two surfaces of the same type bound
   * to different decks have different instance ids.
   */
  readonly id: string;

  /** Which kind of surface this is — the registered type. */
  readonly typeId: string;

  /** Shown on the tab. Derived from the binding when there is one. */
  readonly title: string;

  /** Registry icon id. */
  readonly icon?: string;

  /** What this surface is pointed at, if anything. */
  readonly binding: ISurfaceBinding | undefined;

  /** Root element. Available after `create`. */
  readonly element: HTMLElement | undefined;

  // ── Size hints ──
  //
  // Hints, never positions. A surface may say it wants at least 240px of
  // width; it may not say it belongs on the left.

  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;

  // ── Lifecycle ──

  /** Build DOM into `container`. Called once. */
  create(container: HTMLElement): void;

  /**
   * Point this surface at something. Resolves when the content is ready.
   * A surface with no binding concept may ignore it.
   */
  setBinding(binding: ISurfaceBinding | undefined): Promise<void>;

  /** Dimensions changed. */
  layout(width: number, height: number): void;

  /**
   * Show or hide WITHOUT disposing.
   *
   * A hidden surface keeps running — this is what makes relocation and tab
   * retention (M101) possible, and it is why the grid's move path never
   * disposes.
   */
  setVisible(visible: boolean): void;

  /** Take keyboard focus. */
  focus(): void;

  // ── State ──

  saveState(): SurfaceState;
  restoreState(state: SurfaceState): void;

  // ── Events ──

  /** Title or icon changed — the tab needs repainting. */
  readonly onDidChangeTitle: Event<void>;
  /** Size hints changed; the grid revalidates. */
  readonly onDidChangeConstraints: Event<void>;
  readonly onDidChangeVisibility: Event<boolean>;
}

// ─── Placement (a hint, never a constraint) ──────────────────────────────────

/**
 * Where a surface would PREFER to open the first time, before the user has
 * expressed an opinion.
 *
 * This is the only remnant of the old typed slots, and it is deliberately
 * advisory. The user moves a surface and their arrangement wins forever
 * after; an extension cannot pin itself anywhere.
 */
export enum SurfacePlacement {
  /** The large area. Documents, editors, readers. */
  Center = 'center',
  /** A narrow companion strip. Trees, outlines, lists. */
  Side = 'side',
  /** A short wide strip. Terminals, logs, problems. */
  Bottom = 'bottom',
}

/**
 * Declarative registration. Describes a surface before one exists, so menus,
 * palettes and arrangements can name it without instantiating it.
 */
export interface ISurfaceDescriptor {
  /** Stable type id, namespaced: 'canvas.page', 'flashcards.study'. */
  readonly typeId: string;

  /** Human name for menus and the palette. Title Case. */
  readonly name: string;

  /** Registry icon id. */
  readonly icon?: string;

  /** Preferred first placement. Advisory (see SurfacePlacement). */
  readonly placement: SurfacePlacement;

  /** Default size hints for a new instance. */
  readonly constraints: SizeConstraints;

  /**
   * Binding kinds this surface can be pointed at. Empty means it takes no
   * binding (a settings hub, a graph of everything).
   *
   * An arrangement uses this to decide what it can restore into what.
   */
  readonly bindingKinds: readonly string[];

  /**
   * How many live instances may exist. 'many' is the default and the one that
   * makes side-by-side work; 'single' is for surfaces where a second copy is
   * meaningless rather than merely unusual.
   */
  readonly instances?: 'single' | 'many';

  /** Context-key expression gating availability. */
  readonly when?: string;

  /** Build a live surface. */
  create(instanceId: string): ISurface;
}
