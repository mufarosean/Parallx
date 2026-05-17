// canvasSidebarDragState.ts — drag-and-drop state machine for the canvas
// sidebar (M77 Phase 7).
//
// Extracted from canvasSidebar.ts to give the drag lifecycle its own
// surface. The sidebar holds one instance and delegates state queries
// (is a drag active? is a drop async-in-flight? what was the original
// parent of the dragged page?) and mutations (start drag, set drop
// target, end drag) here.
//
// The class is dependency-free — it doesn't know about the DOM, the
// data service, or the API. Pure state + a small set of helpers. That
// makes it trivially unit-testable in isolation and keeps the sidebar
// file focused on rendering + event wiring.
//
// Behavioural invariants the class enforces:
//   - "unsafe to rebuild the tree DOM" = drag in progress OR drop async
//     work still in flight. Both must clear before a deferred refresh
//     can fire.
//   - The tree snapshot taken at dragstart is frozen for the duration
//     of the drag and drop. Ancestry checks and old-parent lookups
//     use the snapshot, never the live tree, so concurrent DB events
//     can't shift the user's reference frame mid-drag.
//   - Deferred refreshes are coalesced: any number of suppressed
//     requests fire exactly one refresh when it's safe to do so.

export interface DropTarget {
  readonly parentId: string | null;
  readonly afterSiblingId: string | undefined;
}

/**
 * Minimal tree-shape input the snapshot helper needs. The sidebar's
 * IPageTreeNode satisfies this; tests can pass a simpler shape.
 */
export interface TreeNodeShape {
  readonly id: string;
  readonly children?: readonly TreeNodeShape[];
}

export class CanvasSidebarDragState {
  private _draggedPageId: string | null = null;
  private _dropTarget: DropTarget | null = null;
  /** Frozen (id -> parentId|null) map captured at dragstart. */
  private _snapshot: Map<string, string | null> | null = null;
  /** True while a drop's async work is in flight (after dragend, before resolve). */
  private _dropInFlight = false;
  /** Count of refresh requests that arrived while unsafe to rebuild. */
  private _suppressedRefreshes = 0;

  /**
   * Begin a drag. Captures the tree shape so ancestry checks during the
   * drag are immune to concurrent DB events.
   */
  start(pageId: string, tree: readonly TreeNodeShape[]): void {
    this._draggedPageId = pageId;
    this._snapshot = this._captureSnapshot(tree);
  }

  /**
   * Clear synchronous drag state (dragged page id, target, snapshot).
   * Does NOT clear `_dropInFlight` — that's owned by the drop async
   * lifecycle and is cleared via `finishDrop()`.
   */
  end(): void {
    this._draggedPageId = null;
    this._dropTarget = null;
    this._snapshot = null;
  }

  /** Mark the drop's async work as started (call before awaiting). */
  beginDrop(): void {
    this._dropInFlight = true;
  }

  /** Mark the drop's async work as finished (call in the .finally). */
  finishDrop(): void {
    this._dropInFlight = false;
  }

  getDraggedPageId(): string | null {
    return this._draggedPageId;
  }

  setDropTarget(target: DropTarget | null): void {
    this._dropTarget = target;
  }

  getDropTarget(): DropTarget | null {
    return this._dropTarget;
  }

  /**
   * True while the tree DOM must NOT be rebuilt. Combines the drag
   * (sync) and drop (async) phases — both close before a refresh can
   * fire safely.
   */
  isUnsafeToRebuild(): boolean {
    return this._draggedPageId !== null || this._dropInFlight;
  }

  /** Increment the deferred-refresh counter when a refresh is suppressed. */
  noteSuppressedRefresh(): void {
    this._suppressedRefreshes += 1;
  }

  /**
   * Reset the deferred-refresh counter and return whether any refreshes
   * were suppressed. Use the boolean to decide whether to fire one
   * refresh now that we're past the unsafe window.
   */
  drainSuppressedRefreshes(): boolean {
    const had = this._suppressedRefreshes > 0;
    this._suppressedRefreshes = 0;
    return had;
  }

  /**
   * Look up the dragged page's pre-drag parent. Uses the frozen
   * snapshot so even if the live tree has changed during drag, the
   * answer reflects the user's reference frame at dragstart.
   */
  getOldParentId(pageId: string): string | null {
    return this._snapshot?.get(pageId) ?? null;
  }

  /**
   * Ancestry check against the drag-time snapshot. True when
   * candidateId is rootId itself or any descendant of rootId per the
   * snapshot. Cycle-safe via a seen-set guard.
   */
  isDescendantInSnapshot(rootId: string, candidateId: string): boolean {
    if (!this._snapshot) return false;
    let cur: string | null | undefined = candidateId;
    const seen = new Set<string>();
    while (cur !== null && cur !== undefined) {
      if (seen.has(cur)) return false;
      seen.add(cur);
      if (cur === rootId) return true;
      cur = this._snapshot.get(cur) ?? null;
    }
    return false;
  }

  private _captureSnapshot(tree: readonly TreeNodeShape[]): Map<string, string | null> {
    const snap = new Map<string, string | null>();
    const walk = (nodes: readonly TreeNodeShape[], parentId: string | null): void => {
      for (const n of nodes) {
        snap.set(n.id, parentId);
        if (n.children && n.children.length > 0) walk(n.children, n.id);
      }
    };
    walk(tree, null);
    return snap;
  }
}
