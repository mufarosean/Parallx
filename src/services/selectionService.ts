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
      this._perSurface.set(surfaceId, selection);
      this._mostRecentSurfaceId = surfaceId;
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

  hasAnySelection(): boolean {
    return this._perSurface.size > 0;
  }

  override dispose(): void {
    this._perSurface.clear();
    this._mostRecentSurfaceId = undefined;
    super.dispose();
  }
}
