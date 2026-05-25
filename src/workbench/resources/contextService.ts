// contextService.ts — Unified workbench context (Slice A4)
//
// Composes three independent signals into one canonical workbench context:
//
//   - active workspace id           (from IWorkspaceService)
//   - active surface                (from ISurfaceRegistry)
//   - active selection              (from ISelectionService — most-recent surface)
//
// Consumers (when-clauses, commands, AI chat retrieval, extension API
// surfaces) read one snapshot or subscribe to one event instead of
// stitching three feeds.
//
// Spec: WORKBENCH_INTERACTION_MODEL.md §2.5 ContextService.
//
// Pure-additive in Slice A4: no consumer wired yet. The service is
// instantiated in workbenchServices.ts and exercised by tier-0 tests via
// minimal mocks.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import type { Resource } from './resource.js';
import type { ResourceType } from './resource.js';
import type { Surface, SurfaceKind } from './surface.js';

/**
 * Subset of ISelection used by ContextService. We keep this loose so the
 * service does not need the full selectionActionTypes import surface and
 * remains tier-0-test-friendly.
 */
export type ContextSelectionLike = object;

/** Minimal shape ContextService needs from a workspace source. */
export interface ContextWorkspaceSource {
  readonly activeWorkspace: { readonly id: string } | undefined;
  readonly onDidChangeWorkspace: Event<unknown>;
}

/** Minimal shape ContextService needs from a surface source. */
export interface ContextSurfaceSource {
  getActive(): Surface | undefined;
  readonly onDidChangeSurface: Event<unknown>;
}

/** Minimal shape ContextService needs from a selection source. */
export interface ContextSelectionSource {
  getSelection(surfaceId?: string): ContextSelectionLike | undefined;
  readonly onDidChangeSelection: Event<unknown>;
}

export interface WorkbenchContext {
  readonly workspaceId: string | undefined;
  readonly activeSurface: Surface | undefined;
  readonly activeSelection: ContextSelectionLike | undefined;
  /**
   * Derived from `activeSelection.resource` when present (Slice A7+).
   * Lets consumers react to the active resource without coupling to the
   * full ISelection shape. `undefined` when there is no selection, or when
   * the selection has no associated Resource.
   */
  readonly activeResource: Resource | undefined;
  /**
   * Derived from `activeSurface.kind` (Slice A28). Lets `when`-clause-style
   * predicates ask "is the active surface an editor / canvas / chat?"
   * without dereferencing a potentially-undefined `activeSurface`.
   * `undefined` when no surface is active.
   */
  readonly activeSurfaceKind: SurfaceKind | undefined;
  /**
   * Derived from `activeResource.type` (Slice A64). Lets `when`-clause-style
   * predicates ask "is the active resource a file / canvas-page /
   * tool-artifact?" without dereferencing the Resource discriminated
   * union. `undefined` when there is no active resource. Symmetric with
   * `activeSurfaceKind`.
   */
  readonly activeResourceType: ResourceType | undefined;
}

export interface IContextService {
  /** Snapshot the current composed context. */
  getContext(): WorkbenchContext;

  /**
   * Convenience boolean test against the current context. Equivalent to
   * `predicate(getContext())` but spelled as a `when`-clause-style query.
   * The predicate must not mutate the context.
   */
  matches(predicate: (context: WorkbenchContext) => boolean): boolean;

  /** Fires whenever the composed context changes (any underlying source fires). */
  readonly onDidChangeContext: Event<WorkbenchContext>;
}

/**
 * Composed workbench context. Subscribes to the three sources and
 * re-snapshots + fires when any of them changes. The fire is coalesced
 * (skipped when the new snapshot is reference-equal across all three
 * fields to the previous one) to avoid burning listeners on no-op events.
 */
export class ContextService extends Disposable implements IContextService {
  private readonly _onDidChangeContext = this._register(new Emitter<WorkbenchContext>());
  readonly onDidChangeContext: Event<WorkbenchContext> = this._onDidChangeContext.event;

  private _last: WorkbenchContext;

  constructor(
    private readonly _workspace: ContextWorkspaceSource,
    private readonly _surfaces: ContextSurfaceSource,
    private readonly _selection: ContextSelectionSource,
  ) {
    super();
    this._last = this._snapshot();
    this._register(this._workspace.onDidChangeWorkspace(() => this._maybeFire()));
    this._register(this._surfaces.onDidChangeSurface(() => this._maybeFire()));
    this._register(this._selection.onDidChangeSelection(() => this._maybeFire()));
  }

  getContext(): WorkbenchContext {
    // Always return a fresh snapshot — callers may have arrived between events.
    this._last = this._snapshot();
    return this._last;
  }

  matches(predicate: (context: WorkbenchContext) => boolean): boolean {
    return predicate(this.getContext());
  }

  private _snapshot(): WorkbenchContext {
    const activeSelection = this._selection.getSelection();
    const activeSurface = this._surfaces.getActive();
    const activeResource = extractResource(activeSelection);
    return {
      workspaceId: this._workspace.activeWorkspace?.id,
      activeSurface,
      activeSelection,
      activeResource,
      activeSurfaceKind: activeSurface?.kind,
      activeResourceType: activeResource?.type,
    };
  }

  private _maybeFire(): void {
    if (this.isDisposed) return;
    const next = this._snapshot();
    const prev = this._last;
    if (
      next.workspaceId === prev.workspaceId &&
      next.activeSurface === prev.activeSurface &&
      next.activeSelection === prev.activeSelection &&
      next.activeResource === prev.activeResource &&
      next.activeSurfaceKind === prev.activeSurfaceKind &&
      next.activeResourceType === prev.activeResourceType
    ) {
      return;
    }
    this._last = next;
    this._onDidChangeContext.fire(next);
  }
}

function extractResource(selection: ContextSelectionLike | undefined): Resource | undefined {
  if (!selection || typeof selection !== 'object') return undefined;
  const r = (selection as { resource?: unknown }).resource;
  if (!r || typeof r !== 'object') return undefined;
  // Duck-type: any object with a string `type` field is treated as a Resource.
  // The ResourceRegistry will reject unknown types if a consumer tries to resolve it.
  if (typeof (r as { type?: unknown }).type !== 'string') return undefined;
  return r as Resource;
}
