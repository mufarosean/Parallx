// surfaceActivity.ts — activity keyed by surface
//
// Foundation Decision 7 (docs/FOUNDATION.md). The activity journal could only
// say "a file opened" because typed slots were the only vocabulary the layout
// had. Surfaces have identity (typeId + binding) and a lifecycle, so the
// stream gets specific for free: which surface, bound to what, for how long,
// moved next to what else.
//
// This is a TAP in the activityTaps.ts sense: a read-only observer of events
// that already fire, translated into the journal's one grammar
// (`verb object "label" [kind:key]`). It takes a plain sink function rather
// than the journal service so the surfaces layer stays free of service
// imports and the whole thing tests as a pure event-in/line-out box; the
// workbench hands it `journal.note` when the tree is mounted.
//
// NOT YET WIRED — like the tree it narrates, it waits for the mounting step.

import { Disposable } from '../platform/lifecycle.js';
import { Orientation } from '../layout/layoutTypes.js';
import { bindingId } from './surfaceTypes.js';
import type { ISurface } from './surfaceTypes.js';
import type { SurfaceRegistry } from './surfaceRegistry.js';
import type { SurfaceTree, ISurfaceMoveEvent } from './surfaceTree.js';

/** Structurally compatible with IActivityJournalService.note's argument. */
export interface ISurfaceActivityNote {
  readonly actor?: string;
  readonly verb: string;
  readonly object: string;
  readonly detail?: string;
  readonly source?: string;
  readonly ref?: string;
}

export type SurfaceActivitySink = (note: ISurfaceActivityNote) => void;

/**
 * Focus shorter than this is navigation, not work. The journal coalesces
 * repeats, but a dwell line that fires on every tab flick would still bury
 * the signal Decision 7 exists to surface.
 */
export const MIN_DWELL_MS = 20_000;

/** `2h 5m`, `12m`, `45s`. Approximate on purpose: this is narration. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `"Taylor.pdf"` when bound, `explorer` when not — same grammar as the
 *  editor tap: quoted names are documents, bare names are fixtures. */
export function surfaceObject(surface: ISurface): string {
  return surface.binding ? `"${surface.binding.label}"` : surface.typeId;
}

/** The stable identity a reader can act on: `file:/a.md`, else the type. */
export function surfaceRef(surface: ISurface): string {
  return surface.binding ? bindingId(surface.binding) : `surface:${surface.typeId}`;
}

interface TrackedSurface {
  readonly object: string;
  readonly ref: string;
  readonly openedAt: number;
}

export class SurfaceActivityTap extends Disposable {
  /**
   * What each live surface was called and when it appeared, captured at
   * creation. The registry's dispose event carries only an id and fires
   * after the tree already forgot the surface, so narrating a close needs a
   * memory of its own.
   */
  private readonly _tracked = new Map<string, TrackedSurface>();
  private _focus: { id: string; since: number } | undefined;

  constructor(
    private readonly _tree: SurfaceTree,
    registry: SurfaceRegistry,
    private readonly _sink: SurfaceActivitySink,
    private readonly _now: () => number = Date.now,
  ) {
    super();

    // Creation tracks EVERY instance (opened, restored, placeholder) so its
    // close can always be narrated; the 'opened' line itself only follows a
    // deliberate open, which is why it listens to the tree, not the registry.
    // The REQUESTED binding stands in until the surface applies its own —
    // setBinding is async, and the create event outruns it by design.
    this._register(registry.onDidCreateInstance((instance) => {
      const { surface } = instance;
      const binding = surface.binding ?? instance.requestedBinding;
      this._tracked.set(surface.id, {
        object: binding ? `"${binding.label}"` : surface.typeId,
        ref: binding ? bindingId(binding) : `surface:${surface.typeId}`,
        openedAt: this._now(),
      });
    }));

    this._register(this._tree.onDidOpenSurface((surface) => {
      const d = this._describe(surface.id);
      if (!d) return;
      this._sink({
        actor: 'user', source: 'surface', verb: 'opened',
        object: d.object, ref: d.ref,
      });
    }));

    this._register(registry.onDidDisposeInstance((id) => {
      const t = this._tracked.get(id);
      this._tracked.delete(id);
      if (this._focus?.id === id) this._flushDwell();
      // A restore closes everything as one act; per-surface closes narrated
      // through it would read as work nobody did.
      if (!t || this._tree.isRestoring) return;
      const heldFor = this._now() - t.openedAt;
      this._sink({
        actor: 'user', source: 'surface', verb: 'closed',
        object: t.object, ref: t.ref,
        ...(heldFor >= MIN_DWELL_MS ? { detail: `after ${formatDuration(heldFor)}` } : {}),
      });
    }));

    this._register(this._tree.onDidChangeActive((id) => {
      this._flushDwell();
      this._focus = id ? { id, since: this._now() } : undefined;
    }));

    this._register(this._tree.onDidMoveSurface((e) => this._narrateMove(e)));

    this._register(this._tree.onDidCaptureArrangement((name) => {
      this._sink({
        actor: 'user', source: 'surface', verb: 'saved',
        object: `arrangement "${name}"`,
      });
    }));

    this._register(this._tree.onDidRestoreArrangement(({ name, opened, placeholders }) => {
      this._sink({
        actor: 'user', source: 'surface', verb: 'switched to',
        object: `arrangement "${name}"`,
        detail: placeholders > 0
          ? `${opened} surfaces, ${placeholders} unavailable`
          : `${opened} surfaces`,
      });
    }));
  }

  /**
   * The current name and ref for a surface. The LIVE binding wins — a rename
   * since open should narrate under the new name; the creation-time record
   * only answers for surfaces the tree has already forgotten, and for the
   * async gap before a binding lands.
   */
  private _describe(id: string): { object: string; ref: string } | undefined {
    const live = this._tree.getSurface(id);
    if (live?.binding) return { object: surfaceObject(live), ref: surfaceRef(live) };
    return this._tracked.get(id)
      ?? (live ? { object: surfaceObject(live), ref: surfaceRef(live) } : undefined);
  }

  /** The "for how long" half of Decision 7: narrate a finished focus span. */
  private _flushDwell(): void {
    const focus = this._focus;
    this._focus = undefined;
    if (!focus || this._tree.isRestoring) return;
    const held = this._now() - focus.since;
    if (held < MIN_DWELL_MS) return;
    const d = this._describe(focus.id);
    if (!d) return;
    this._sink({
      actor: 'user', source: 'surface', verb: 'worked in',
      object: d.object, ref: d.ref, detail: `for ${formatDuration(held)}`,
    });
  }

  /** The "adjacent to what else" half. */
  private _narrateMove(e: ISurfaceMoveEvent): void {
    const d = this._describe(e.surfaceId);
    if (!d) return;

    let detail: string;
    if (e.kind === 'edge') {
      detail = e.orientation === Orientation.Horizontal
        ? (e.insertBefore ? 'to the left edge' : 'to the right edge')
        : (e.insertBefore ? 'to the top edge' : 'to the bottom edge');
    } else {
      const target = e.targetSurfaceId ? this._describe(e.targetSurfaceId) : undefined;
      const name = target?.object ?? 'another surface';
      detail = e.orientation === Orientation.Horizontal
        ? (e.insertBefore ? `left of ${name}` : `right of ${name}`)
        : (e.insertBefore ? `above ${name}` : `below ${name}`);
    }

    this._sink({
      actor: 'user', source: 'surface', verb: 'moved',
      object: d.object, ref: d.ref, detail,
    });
  }

  override dispose(): void {
    this._flushDwell();
    this._tracked.clear();
    super.dispose();
  }
}
