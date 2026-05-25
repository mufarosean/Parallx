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
import type { Surface, SurfaceKind } from './surface.js';
import type { Resource } from './resource.js';
import { resourceEquals, resourceWorkspaceId } from './resource.js';

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

  /**
   * All currently-registered surfaces whose `kind` matches the given
   * value. Insertion order preserved. Returns a fresh snapshot.
   */
  listByKind(kind: SurfaceKind): ReadonlyArray<Surface>;

  /**
   * All currently-registered surfaces whose `resource` is structurally
   * equal to the given Resource. Insertion order. Fresh snapshot.
   * Surfaces without a resource are never matched.
   *
   * Equality uses {@link resourceEquals} — file path + workspaceId,
   * canvas pageId + blockId + workspaceId, chat sessionId + turnId
   * + workspaceId, tool toolId + artifactId + workspaceId, external
   * uri. `hash` on FileResource is metadata and NOT part of identity.
   */
  findByResource(resource: Resource): ReadonlyArray<Surface>;

  /**
   * All currently-registered surfaces whose backing resource has
   * `workspaceId === workspaceId`. Surfaces with no resource, or whose
   * resource is `external` (no workspace scope), are never matched.
   * Insertion order. Fresh snapshot. Empty `workspaceId` → empty array.
   *
   * Query counterpart for workspace-scoped surface enumeration. Useful
   * for workspace-switch teardown and per-workspace surface inventories.
   */
  listByWorkspace(workspaceId: string): ReadonlyArray<Surface>;

  /**
   * Snapshot of distinct `SurfaceKind` values across every registered
   * surface, in first-insertion order (the order each kind first
   * appeared in the registry). Fresh array. Empty registry → empty
   * array. Inventory query for diagnostics and per-kind enumeration
   * loops. Symmetric with `IToolArtifactStore.toolIds()` (A37).
   */
  kinds(): readonly SurfaceKind[];

  /** Lookup by id. */
  get(id: string): Surface | undefined;

  /**
   * Snapshot of every currently-registered surface id, in registration
   * order. Fresh array. Empty registry → empty array. Cheap inventory
   * query that avoids materializing full `list()` records when callers
   * only need the keys. Symmetric with `ISelectionService.surfaceIds()`.
   */
  ids(): readonly string[];

  /**
   * Number of currently-registered surfaces whose `kind === kind`.
   * Cheap O(n) count that avoids the allocation of `listByKind(kind)`
   * when callers only need the length. Empty/undefined `kind` returns 0.
   */
  countByKind(kind: SurfaceKind): number;

  /**
   * Number of currently-registered surfaces whose backing resource has
   * `workspaceId === workspaceId`. Surfaces without a resource or whose
   * resource is external are never counted. Empty/undefined `workspaceId`
   * returns 0. Allocation-free counterpart to `listByWorkspace(id).length`.
   */
  countByWorkspace(workspaceId: string): number;

  /**
   * `true` iff at least one currently-registered surface has
   * `kind === kind`. Cheap O(n) existence check that short-circuits
   * on the first hit. Empty/undefined `kind` returns `false`.
   * Symmetric with `IToolArtifactStore.hasTool` (A50).
   */
  hasKind(kind: SurfaceKind): boolean;

  /**
   * `true` iff at least one currently-registered surface's backing
   * resource has `workspaceId === workspaceId`. Surfaces without a
   * resource or whose resource is external are never matched.
   * Empty/undefined `workspaceId` returns `false`. Short-circuits.
   */
  hasWorkspace(workspaceId: string): boolean;

  /**
   * Number of currently-registered surfaces. Cheap accessor that
   * avoids materializing `list()` just to read its length. Symmetric
   * with `IToolArtifactStore.size` (A12) and `ISelectionService.size`
   * (A42).
   */
  readonly size: number;

  /**
   * `true` iff a surface with the given id is currently registered.
   * Guard counterpart to `get` for callers that only need existence.
   */
  has(id: string): boolean;

  /** Set the active (focused) surface by id. Pass undefined to clear. No-op if id is unknown. */
  setActive(id: string | undefined): void;

  /** The currently active surface, if any. */
  getActive(): Surface | undefined;

  /**
   * Id of the currently active surface, or `undefined` if none is
   * active. Cheap accessor that avoids the Map lookup `getActive()`
   * performs when callers only need the id (when-clauses, telemetry,
   * status bars). `getActiveId() === undefined` iff `getActive() === undefined`.
   */
  getActiveId(): string | undefined;

  /**
   * Unregister every surface. If a surface was active, first fires an
   * `'active'` event with `surface: undefined`. Then fires one
   * `'unregistered'` event per surface in insertion order. Returns the
   * ids that were removed, in the order events fired. Empty registry
   * → empty array, no events. Idempotent. Symmetric with
   * `ISelectionService.clearAll()` (A29) and
   * `IToolArtifactStore.clear()` (A30).
   *
   * Designed for workspace switches and test teardown.
   */
  clear(): readonly string[];

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

  listByKind(kind: SurfaceKind): ReadonlyArray<Surface> {
    const out: Surface[] = [];
    for (const s of this._surfaces.values()) {
      if (s.kind === kind) out.push(s);
    }
    return out;
  }

  findByResource(resource: Resource): ReadonlyArray<Surface> {
    const out: Surface[] = [];
    for (const s of this._surfaces.values()) {
      if (s.resource && resourceEquals(s.resource, resource)) out.push(s);
    }
    return out;
  }

  listByWorkspace(workspaceId: string): ReadonlyArray<Surface> {
    if (!workspaceId) return [];
    const out: Surface[] = [];
    for (const s of this._surfaces.values()) {
      if (s.resource && resourceWorkspaceId(s.resource) === workspaceId) {
        out.push(s);
      }
    }
    return out;
  }

  kinds(): readonly SurfaceKind[] {
    const seen = new Set<SurfaceKind>();
    const out: SurfaceKind[] = [];
    for (const s of this._surfaces.values()) {
      if (!seen.has(s.kind)) {
        seen.add(s.kind);
        out.push(s.kind);
      }
    }
    return out;
  }

  get(id: string): Surface | undefined {
    return this._surfaces.get(id);
  }

  get size(): number {
    return this._surfaces.size;
  }

  ids(): readonly string[] {
    return Array.from(this._surfaces.keys());
  }

  countByKind(kind: SurfaceKind): number {
    if (!kind) return 0;
    let n = 0;
    for (const s of this._surfaces.values()) {
      if (s.kind === kind) n++;
    }
    return n;
  }

  countByWorkspace(workspaceId: string): number {
    if (!workspaceId) return 0;
    let n = 0;
    for (const s of this._surfaces.values()) {
      if (s.resource && resourceWorkspaceId(s.resource) === workspaceId) {
        n++;
      }
    }
    return n;
  }

  hasKind(kind: SurfaceKind): boolean {
    if (!kind) return false;
    for (const s of this._surfaces.values()) {
      if (s.kind === kind) return true;
    }
    return false;
  }

  hasWorkspace(workspaceId: string): boolean {
    if (!workspaceId) return false;
    for (const s of this._surfaces.values()) {
      if (s.resource && resourceWorkspaceId(s.resource) === workspaceId) {
        return true;
      }
    }
    return false;
  }

  has(id: string): boolean {
    return this._surfaces.has(id);
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

  getActiveId(): string | undefined {
    return this._activeId;
  }

  clear(): readonly string[] {
    if (this._surfaces.size === 0) return [];
    const ids = Array.from(this._surfaces.keys());
    const previousActive = this._activeId !== undefined ? this._surfaces.get(this._activeId) : undefined;
    const hadActive = this._activeId !== undefined;
    this._activeId = undefined;
    if (hadActive) {
      this._onDidChangeSurface.fire({ kind: 'active', surface: undefined, previous: previousActive });
    }
    const victims: Surface[] = [];
    for (const id of ids) {
      const s = this._surfaces.get(id);
      if (s) victims.push(s);
    }
    this._surfaces.clear();
    for (const s of victims) {
      this._onDidChangeSurface.fire({ kind: 'unregistered', surface: s });
    }
    return ids;
  }

  override dispose(): void {
    this._surfaces.clear();
    this._activeId = undefined;
    super.dispose();
  }
}
