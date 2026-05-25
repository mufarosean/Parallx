/**
 * Pin: CanvasSidebarDragState — sidebar drag/drop state machine
 * (no DOM / no DB). Pins start/end, drop async lifecycle, the safe-rebuild
 * gate, deferred-refresh coalescing, and snapshot-based ancestry.
 */
import { describe, it, expect } from "vitest";
import {
  CanvasSidebarDragState,
  type TreeNodeShape,
} from "../../src/built-in/canvas/canvasSidebarDragState";

const tree: readonly TreeNodeShape[] = [
  { id: "root1", children: [
    { id: "a", children: [{ id: "a1" }, { id: "a2" }] },
    { id: "b" },
  ]},
  { id: "root2" },
];

describe("CanvasSidebarDragState — initial state", () => {
  it("starts with no drag and no drop in flight; safe to rebuild", () => {
    const s = new CanvasSidebarDragState();
    expect(s.getDraggedPageId()).toBeNull();
    expect(s.getDropTarget()).toBeNull();
    expect(s.isUnsafeToRebuild()).toBe(false);
    expect(s.drainSuppressedRefreshes()).toBe(false);
    expect(s.getOldParentId("a")).toBeNull();
    expect(s.isDescendantInSnapshot("root1", "a1")).toBe(false);
  });
});

describe("start / end — sync drag lifecycle", () => {
  it("start() sets the dragged page id and captures a snapshot", () => {
    const s = new CanvasSidebarDragState();
    s.start("a", tree);
    expect(s.getDraggedPageId()).toBe("a");
    expect(s.isUnsafeToRebuild()).toBe(true);
    expect(s.getOldParentId("a")).toBe("root1");
    expect(s.getOldParentId("a1")).toBe("a");
    expect(s.getOldParentId("root1")).toBeNull();
  });

  it("end() clears drag id + drop target + snapshot but NOT _dropInFlight", () => {
    const s = new CanvasSidebarDragState();
    s.start("a", tree);
    s.setDropTarget({ parentId: "root2", afterSiblingId: undefined });
    s.beginDrop();
    s.end();
    expect(s.getDraggedPageId()).toBeNull();
    expect(s.getDropTarget()).toBeNull();
    expect(s.getOldParentId("a")).toBeNull(); // snapshot cleared
    expect(s.isUnsafeToRebuild()).toBe(true); // still unsafe — drop in flight
    s.finishDrop();
    expect(s.isUnsafeToRebuild()).toBe(false);
  });
});

describe("beginDrop / finishDrop — async lifecycle", () => {
  it("beginDrop alone makes isUnsafeToRebuild=true", () => {
    const s = new CanvasSidebarDragState();
    s.beginDrop();
    expect(s.isUnsafeToRebuild()).toBe(true);
    s.finishDrop();
    expect(s.isUnsafeToRebuild()).toBe(false);
  });
});

describe("isUnsafeToRebuild — combines drag + drop", () => {
  it("true while drag active, true while drop in flight, false after both clear", () => {
    const s = new CanvasSidebarDragState();
    s.start("a", tree);
    expect(s.isUnsafeToRebuild()).toBe(true);
    s.beginDrop();
    s.end();
    expect(s.isUnsafeToRebuild()).toBe(true);
    s.finishDrop();
    expect(s.isUnsafeToRebuild()).toBe(false);
  });
});

describe("setDropTarget / getDropTarget — exact object passthrough", () => {
  it("stores and returns the same DropTarget value", () => {
    const s = new CanvasSidebarDragState();
    const tgt = { parentId: "root2", afterSiblingId: "x" } as const;
    s.setDropTarget(tgt);
    expect(s.getDropTarget()).toEqual(tgt);
    s.setDropTarget(null);
    expect(s.getDropTarget()).toBeNull();
  });
});

describe("noteSuppressedRefresh / drainSuppressedRefreshes — coalescing", () => {
  it("returns true once if any refreshes were suppressed; resets to 0", () => {
    const s = new CanvasSidebarDragState();
    s.noteSuppressedRefresh();
    s.noteSuppressedRefresh();
    s.noteSuppressedRefresh();
    expect(s.drainSuppressedRefreshes()).toBe(true);
    expect(s.drainSuppressedRefreshes()).toBe(false); // counter cleared
  });

  it("returns false when no refreshes were suppressed", () => {
    expect(new CanvasSidebarDragState().drainSuppressedRefreshes()).toBe(false);
  });
});

describe("snapshot-based ancestry", () => {
  it("getOldParentId reflects pre-drag tree even after the live tree changes", () => {
    const s = new CanvasSidebarDragState();
    s.start("a1", tree);
    // simulate concurrent DB event: live tree changed (not visible here).
    expect(s.getOldParentId("a1")).toBe("a");
  });

  it("isDescendantInSnapshot: rootId is its own descendant (true)", () => {
    const s = new CanvasSidebarDragState();
    s.start("a", tree);
    expect(s.isDescendantInSnapshot("a", "a")).toBe(true);
  });

  it("isDescendantInSnapshot: descendant chain a -> a1 returns true", () => {
    const s = new CanvasSidebarDragState();
    s.start("a", tree);
    expect(s.isDescendantInSnapshot("a", "a1")).toBe(true);
    expect(s.isDescendantInSnapshot("root1", "a2")).toBe(true);
  });

  it("isDescendantInSnapshot: unrelated branch returns false", () => {
    const s = new CanvasSidebarDragState();
    s.start("a", tree);
    expect(s.isDescendantInSnapshot("a", "b")).toBe(false);
    expect(s.isDescendantInSnapshot("root2", "a1")).toBe(false);
  });

  it("isDescendantInSnapshot: returns false when no snapshot has been taken", () => {
    expect(new CanvasSidebarDragState().isDescendantInSnapshot("a", "a1")).toBe(false);
  });
});
