// selectionService.ts — state-shaped "current selection changed" broadcast (M81 Slice A)
//
// Sits alongside (not replacing) `SelectionActionDispatcher`. The dispatcher
// is action-shaped (routes named actions like "add-to-chat" to handlers);
// `SelectionService` is state-shaped — it tracks the most recent selection
// per surface and emits an event that context keys, when-clause consumers,
// and future surfaces can subscribe to without coupling to the dispatcher's
// handler-registration API.
//
// See `docs/Parallx_Milestone_81.md` §4 and the audit at
// `docs/research/M81_SLICE_A_AUDIT.md` for the rescope rationale: the new
// service is purely additive; all existing `SelectionActionDispatcher`
// callers keep working unchanged, and the dispatcher publishes through this
// service as an additional broadcast channel.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type {
  ISelectionService,
  ISelectionChangeEvent,
} from './serviceTypes.js';
import type { ISelection } from './selectionActionTypes.js';
import { resourceEquals, resourceFromSelectionSource, resourceWorkspaceId } from '../workbench/resources/resource.js';
import type { Resource } from '../workbench/resources/resource.js';

export class SelectionService extends Disposable implements ISelectionService {
  private readonly _perSurface = new Map<string, ISelection>();
  private _mostRecentSurfaceId: string | undefined;

  private readonly _onDidChangeSelection = this._register(new Emitter<ISelectionChangeEvent>());
  readonly onDidChangeSelection: Event<ISelectionChangeEvent> = this._onDidChangeSelection.event;

  setSelection(surfaceId: string, selection: ISelection | undefined): void {
    if (this.isDisposed) {
      return;
    }
    const previous = this._perSurface.get(surfaceId);

    // Skip no-op writes: same identity (cheap reference check) is treated as no
    // change. Callers are expected to construct fresh `ISelection` objects on
    // real changes; we deliberately do NOT deep-compare contents.
    if (previous === selection) {
      return;
    }

    if (selection === undefined) {
      if (previous === undefined) {
        return;
      }
      this._perSurface.delete(surfaceId);
      if (this._mostRecentSurfaceId === surfaceId) {
        // The most recent surface just cleared — fall back to whichever surface
        // still has a selection (insertion order = most-recently-set first
        // remaining). If none, leave undefined.
        this._mostRecentSurfaceId = undefined;
        for (const id of this._perSurface.keys()) {
          this._mostRecentSurfaceId = id;
        }
      }
    } else {
      // Auto-populate `selection.resource` from `source.filePath` (Slice A7)
      // if the caller didn't supply one. Pure-additive: existing callers
      // keep working unchanged; downstream consumers (chat retrieval,
      // when-clauses, link resolution) get a stable cross-tool identity
      // for free.
      let stored = selection;
      if (stored.resource === undefined) {
        const derived = resourceFromSelectionSource(stored.source);
        if (derived !== undefined) {
          stored = { ...stored, resource: derived };
        }
      }
      this._perSurface.set(surfaceId, stored);
      this._mostRecentSurfaceId = surfaceId;
      selection = stored;
    }

    this._onDidChangeSelection.fire({
      surfaceId,
      selection,
      previous,
    });
  }

  getSelection(surfaceId?: string): ISelection | undefined {
    if (surfaceId === undefined) {
      if (this._mostRecentSurfaceId === undefined) {
        return undefined;
      }
      return this._perSurface.get(this._mostRecentSurfaceId);
    }
    return this._perSurface.get(surfaceId);
  }

  mostRecentSurfaceId(): string | undefined {
    return this._mostRecentSurfaceId;
  }

  mostRecentResource(): Resource | undefined {
    return this.getSelection()?.resource;
  }

  mostRecentWorkspaceId(): string | undefined {
    const r = this.getSelection()?.resource;
    return r ? resourceWorkspaceId(r) : undefined;
  }

  hasAnySelection(): boolean {
    return this._perSurface.size > 0;
  }

  get size(): number {
    return this._perSurface.size;
  }

  hasSelection(surfaceId: string): boolean {
    return this._perSurface.has(surfaceId);
  }

  surfaceIds(): readonly string[] {
    return Array.from(this._perSurface.keys());
  }

  entries(): ReadonlyArray<{ readonly surfaceId: string; readonly selection: ISelection }> {
    const out: Array<{ surfaceId: string; selection: ISelection }> = [];
    for (const [surfaceId, selection] of this._perSurface) {
      out.push({ surfaceId, selection });
    }
    return out;
  }

  entriesByWorkspace(workspaceId: string): ReadonlyArray<{ readonly surfaceId: string; readonly selection: ISelection }> {
    if (!workspaceId) return [];
    const out: Array<{ surfaceId: string; selection: ISelection }> = [];
    for (const [surfaceId, selection] of this._perSurface) {
      const r = selection.resource;
      if (r && resourceWorkspaceId(r) === workspaceId) {
        out.push({ surfaceId, selection });
      }
    }
    return out;
  }

  surfaceIdsByWorkspace(workspaceId: string): readonly string[] {
    if (!workspaceId) return [];
    const out: string[] = [];
    for (const [surfaceId, selection] of this._perSurface) {
      const r = selection.resource;
      if (r && resourceWorkspaceId(r) === workspaceId) {
        out.push(surfaceId);
      }
    }
    return out;
  }

  findByResource(resource: Resource): ReadonlyArray<{ readonly surfaceId: string; readonly selection: ISelection }> {
    const out: Array<{ surfaceId: string; selection: ISelection }> = [];
    for (const [surfaceId, selection] of this._perSurface) {
      const r = selection.resource;
      if (r && resourceEquals(r, resource)) {
        out.push({ surfaceId, selection });
      }
    }
    return out;
  }

  workspaceIds(): readonly string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const selection of this._perSurface.values()) {
      const r = selection.resource;
      if (!r) continue;
      const wid = resourceWorkspaceId(r);
      if (wid && !seen.has(wid)) {
        seen.add(wid);
        out.push(wid);
      }
    }
    return out;
  }

  countByWorkspace(workspaceId: string): number {
    if (!workspaceId) return 0;
    let n = 0;
    for (const selection of this._perSurface.values()) {
      const r = selection.resource;
      if (r && resourceWorkspaceId(r) === workspaceId) n++;
    }
    return n;
  }

  hasWorkspace(workspaceId: string): boolean {
    if (!workspaceId) return false;
    for (const selection of this._perSurface.values()) {
      const r = selection.resource;
      if (r && resourceWorkspaceId(r) === workspaceId) return true;
    }
    return false;
  }

  clearAll(): readonly string[] {
    if (this._perSurface.size === 0) return [];
    const ids = Array.from(this._perSurface.keys());
    const previousMap = new Map(this._perSurface);
    this._perSurface.clear();
    this._mostRecentSurfaceId = undefined;
    for (const id of ids) {
      this._onDidChangeSelection.fire({
        surfaceId: id,
        selection: undefined,
        previous: previousMap.get(id),
      });
    }
    return ids;
  }

  override dispose(): void {
    this._perSurface.clear();
    this._mostRecentSurfaceId = undefined;
    super.dispose();
  }
}
