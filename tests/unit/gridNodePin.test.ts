/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { GridBranchNode, GridLeafNode, GridNodeType } from "../../src/layout/gridNode.js";
import { Orientation, SizingMode } from "../../src/layout/layoutTypes.js";
import type { IGridView } from "../../src/layout/gridView.js";
import { Emitter } from "../../src/platform/events.js";

function makeView(id: string): IGridView {
  const el = document.createElement("div");
  el.id = id;
  const emitter = new Emitter<void>();
  return {
    element: el,
    id,
    minimumWidth: 10,
    maximumWidth: Number.POSITIVE_INFINITY,
    minimumHeight: 10,
    maximumHeight: Number.POSITIVE_INFINITY,
    layout: () => {},
    setVisible: () => {},
    toJSON: () => ({ id }),
    onDidChangeConstraints: emitter.event,
    dispose: () => emitter.dispose(),
    _emitter: emitter,
  } as unknown as IGridView;
}

describe("GridBranchNode pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("constructor sets type/orientation/size; element has grid-branch + flex styles", () => {
    const b = new GridBranchNode(Orientation.Horizontal, 100);
    expect(b.type).toBe(GridNodeType.Branch);
    expect(b.orientation).toBe(Orientation.Horizontal);
    expect(b.size).toBe(100);
    expect(b.sizingMode).toBe(SizingMode.Pixel);
    expect(b.element.classList.contains("grid-branch")).toBe(true);
    expect(b.element.style.display).toBe("flex");
    expect(b.element.style.flexDirection).toBe("row");
  });

  it("vertical orientation sets flexDirection column", () => {
    const b = new GridBranchNode(Orientation.Vertical);
    expect(b.element.style.flexDirection).toBe("column");
  });

  it("addChild appends to children, inserts sash between siblings, fires onDidChange", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    const a = new GridLeafNode(makeView("a"));
    const c = new GridLeafNode(makeView("b"));
    let changes = 0;
    b.onDidChange(() => changes++);
    b.addChild(a);
    b.addChild(c);
    expect(b.childCount).toBe(2);
    expect(b.sashes.length).toBe(1);
    expect(b.element.children.length).toBe(3); // a, sash, c
    expect(changes).toBe(2);
  });

  it("removeChild removes child, rebuilds DOM, returns removed node", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    const a = new GridLeafNode(makeView("a"));
    const c = new GridLeafNode(makeView("b"));
    b.addChild(a);
    b.addChild(c);
    const r = b.removeChild(0);
    expect(r).toBe(a);
    expect(b.childCount).toBe(1);
    expect(b.sashes.length).toBe(0);
  });

  it("indexOfChild and getChild round-trip", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    const a = new GridLeafNode(makeView("a"));
    const c = new GridLeafNode(makeView("b"));
    b.addChild(a);
    b.addChild(c);
    expect(b.getChild(0)).toBe(a);
    expect(b.indexOfChild(c)).toBe(1);
  });

  it("addChild at specific index inserts in the middle", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    const a = new GridLeafNode(makeView("a"));
    const c = new GridLeafNode(makeView("c"));
    const mid = new GridLeafNode(makeView("mid"));
    b.addChild(a);
    b.addChild(c);
    b.addChild(mid, 1);
    expect(b.getChild(1)).toBe(mid);
  });

  it("horizontal sash uses col-resize cursor and 4px width", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    b.addChild(new GridLeafNode(makeView("a")));
    b.addChild(new GridLeafNode(makeView("b")));
    const sash = b.sashes[0];
    expect(sash.style.cursor).toBe("col-resize");
    expect(sash.style.width).toBe("4px");
    expect(sash.classList.contains("grid-sash-vertical")).toBe(true);
    expect(sash.dataset.sashIndex).toBe("0");
  });

  it("vertical sash uses row-resize cursor and 4px height", () => {
    const b = new GridBranchNode(Orientation.Vertical);
    b.addChild(new GridLeafNode(makeView("a")));
    b.addChild(new GridLeafNode(makeView("b")));
    const sash = b.sashes[0];
    expect(sash.style.cursor).toBe("row-resize");
    expect(sash.style.height).toBe("4px");
    expect(sash.classList.contains("grid-sash-horizontal")).toBe(true);
  });

  it("getChildSizes returns leaf cachedSize / branch size", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    const a = new GridLeafNode(makeView("a"));
    a.cachedSize = 50;
    const inner = new GridBranchNode(Orientation.Vertical, 80);
    b.addChild(a);
    b.addChild(inner);
    expect(b.getChildSizes()).toEqual([50, 80]);
  });

  it("serialize() produces nested SerializedBranchNode with children", () => {
    const b = new GridBranchNode(Orientation.Horizontal, 200, SizingMode.Proportional);
    const a = new GridLeafNode(makeView("a"));
    a.cachedSize = 70;
    b.addChild(a);
    const s = b.serialize();
    expect(s.orientation).toBe(Orientation.Horizontal);
    expect(s.size).toBe(200);
    expect(s.sizingMode).toBe(SizingMode.Proportional);
    expect(s.children.length).toBe(1);
  });

  it("child constraint changes propagate to onDidChangeConstraints on branch", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    const v = makeView("a") as unknown as IGridView & { _emitter: Emitter<void> };
    const leaf = new GridLeafNode(v);
    b.addChild(leaf);
    let fired = 0;
    b.onDidChangeConstraints(() => fired++);
    v._emitter.fire();
    expect(fired).toBe(1);
  });

  it("dispose() clears sashes and listeners", () => {
    const b = new GridBranchNode(Orientation.Horizontal);
    b.addChild(new GridLeafNode(makeView("a")));
    b.addChild(new GridLeafNode(makeView("b")));
    b.dispose();
    expect(b.sashes.length).toBe(0);
  });
});

describe("GridLeafNode pin", () => {
  it("type, view, id, element passthrough", () => {
    const v = makeView("foo");
    const leaf = new GridLeafNode(v);
    expect(leaf.type).toBe(GridNodeType.Leaf);
    expect(leaf.view).toBe(v);
    expect(leaf.id).toBe("foo");
    expect(leaf.element).toBe(v.element);
  });

  it("cachedSize getter/setter", () => {
    const leaf = new GridLeafNode(makeView("a"));
    expect(leaf.cachedSize).toBe(0);
    leaf.cachedSize = 120;
    expect(leaf.cachedSize).toBe(120);
  });

  it("constraint getters delegate to the view", () => {
    const leaf = new GridLeafNode(makeView("a"));
    expect(leaf.minimumWidth).toBe(10);
    expect(leaf.maximumWidth).toBe(Number.POSITIVE_INFINITY);
  });

  it("snap delegates to view.snap (falsy → false)", () => {
    const leaf = new GridLeafNode(makeView("a"));
    expect(leaf.snap).toBe(false);
  });

  it("serialize emits Leaf type with view id and cachedSize", () => {
    const leaf = new GridLeafNode(makeView("x"), SizingMode.Proportional);
    leaf.cachedSize = 42;
    const s = leaf.serialize();
    expect(s.viewId).toBe("x");
    expect(s.size).toBe(42);
    expect(s.sizingMode).toBe(SizingMode.Proportional);
  });

  it("view constraint changes propagate via onDidChangeConstraints", () => {
    const v = makeView("a") as unknown as IGridView & { _emitter: Emitter<void> };
    const leaf = new GridLeafNode(v);
    let fired = 0;
    leaf.onDidChangeConstraints(() => fired++);
    v._emitter.fire();
    expect(fired).toBe(1);
  });
});
