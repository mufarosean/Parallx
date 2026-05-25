// surfaceRegistry.ts — Active surface tracker (Slice A3)
//
// Tracks all currently-visible Surfaces and which one is "active" (has
// focus). Emits change events so context-aware services can react.
//
// Spec: WORKBENCH_INTERACTION_MODEL.md §2.3 Surface + §2.5 ContextService.
//
// Pure-additive: no part / editor / view registers as a Surface in this
// slice. Wiring happens in follow-up slices.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import type { Surface } from './surface.js';

export interface ISurfaceChangeEvent {
  readonly kind: 'registered' | 'updated' | 'unregistered' | 'active';
  readonly surface: Surface | undefined;
  readonly previous?: Surface | undefined;
}

export interface ISurfaceRegistry {
  /** Register a new Surface. Throws if id is already registered. */
  register(s: Surface): void;

  /** Replace an existing Surface in place (same id). Throws if no surface with the given id exists. */
  update(s: Surface): void;

  /** Remove a Surface. Returns true if one was removed. */
  unregister(id: string): boolean;

  /** All currently-registered surfaces. */
  list(): ReadonlyArray<Surface>;

  /** Lookup by id. */
  get(id: string): Surface | undefined;

  /** Set the active (focused) surface by id. Pass undefined to clear. No-op if id is unknown. */
  setActive(id: string | undefined): void;

  /** The currently active surface, if any. */
  getActive(): Surface | undefined;

  /** Subscribe to register / update / unregister / active-change events. */
  readonly onDidChangeSurface: Event<ISurfaceChangeEvent>;
}

export class SurfaceRegistry extends Disposable implements ISurfaceRegistry {
  private readonly _surfaces = new Map<string, Surface>();
  private _activeId: string | undefined;

  private readonly _onDidChangeSurface = this._register(new Emitter<ISurfaceChangeEvent>());
  readonly onDidChangeSurface: Event<ISurfaceChangeEvent> = this._onDidChangeSurface.event;

  register(s: Surface): void {
    if (this._surfaces.has(s.id)) {
      throw new Error(`[SurfaceRegistry] surface "${s.id}" already registered`);
    }
    this._surfaces.set(s.id, s);
    this._onDidChangeSurface.fire({ kind: 'registered', surface: s });
  }

  update(s: Surface): void {
    const previous = this._surfaces.get(s.id);
    if (!previous) {
      throw new Error(`[SurfaceRegistry] cannot update — surface "${s.id}" not registered`);
    }
    if (previous === s) return;
    this._surfaces.set(s.id, s);
    this._onDidChangeSurface.fire({ kind: 'updated', surface: s, previous });
    if (this._activeId === s.id) {
      // Active surface's content changed.
      this._onDidChangeSurface.fire({ kind: 'active', surface: s, previous });
    }
  }

  unregister(id: string): boolean {
    const previous = this._surfaces.get(id);
    if (!previous) return false;
    this._surfaces.delete(id);
    if (this._activeId === id) {
      this._activeId = undefined;
      this._onDidChangeSurface.fire({ kind: 'active', surface: undefined, previous });
    }
    this._onDidChangeSurface.fire({ kind: 'unregistered', surface: previous });
    return true;
  }

  list(): ReadonlyArray<Surface> {
    return Array.from(this._surfaces.values());
  }

  get(id: string): Surface | undefined {
    return this._surfaces.get(id);
  }

  setActive(id: string | undefined): void {
    if (id === this._activeId) return;
    if (id !== undefined && !this._surfaces.has(id)) {
      // Unknown id — silent no-op. Callers shouldn't have to coordinate
      // teardown vs. focus-change ordering.
      return;
    }
    const previous = this._activeId !== undefined ? this._surfaces.get(this._activeId) : undefined;
    this._activeId = id;
    const current = id !== undefined ? this._surfaces.get(id) : undefined;
    this._onDidChangeSurface.fire({ kind: 'active', surface: current, previous });
  }

  getActive(): Surface | undefined {
    return this._activeId !== undefined ? this._surfaces.get(this._activeId) : undefined;
  }

  override dispose(): void {
    this._surfaces.clear();
    this._activeId = undefined;
    super.dispose();
  }
}
