/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { Grid } from "../../src/layout/grid";
import { BaseGridView } from "../../src/layout/gridView";
import { Orientation, SizingMode } from "../../src/layout/layoutTypes";
import { SerializedNodeType } from "../../src/layout/layoutModel";

class TView extends BaseGridView {
  protected layoutContent(): void { /* no-op */ }
}

describe("Grid pin", () => {
  it("addView registers the view, fires 'add' event, and exposes it via hasView/getView", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    const events: any[] = [];
    g.onDidChange(e => events.push(e));
    const v = new TView("v1");
    g.addView(v, 200);
    expect(g.hasView("v1")).toBe(true);
    expect(g.getView("v1")).toBe(v);
    expect(events[0]).toEqual({ type: "add", viewId: "v1" });
  });

  it("getViewSize returns the cached size of the added view (or undefined for unknown)", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    g.addView(new TView("a"), 300);
    expect(g.getViewSize("a")).toBe(300);
    expect(g.getViewSize("missing")).toBeUndefined();
  });

  it("removeView removes from registry, fires 'remove', and returns the view", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    const v = new TView("v");
    g.addView(v, 100);
    const events: any[] = [];
    g.onDidChange(e => events.push(e));
    const removed = g.removeView("v");
    expect(removed).toBe(v);
    expect(g.hasView("v")).toBe(false);
    expect(events.some(e => e.type === "remove" && e.viewId === "v")).toBe(true);
  });

  it("removeView returns undefined for a view that isn't present", () => {
    const g = new Grid(Orientation.Vertical, 100, 100);
    expect(g.removeView("nope")).toBeUndefined();
  });

  it("layout() distributes width across two horizontal views and updates element styles", () => {
    const g = new Grid(Orientation.Horizontal, 600, 400);
    const a = new TView("a");
    const b = new TView("b");
    g.addView(a, 200);
    g.addView(b, 400);
    g.layout();
    // Width totals to 600
    const wA = parseInt(a.element.style.width, 10);
    const wB = parseInt(b.element.style.width, 10);
    expect(wA + wB).toBe(600);
  });

  it("serialize captures orientation, dimensions, and a branch root", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    g.addView(new TView("x"), 200);
    const ser = g.serialize();
    expect(ser.orientation).toBe(Orientation.Horizontal);
    expect(ser.width).toBe(800);
    expect(ser.height).toBe(600);
    expect(ser.root.type).toBe(SerializedNodeType.Branch);
    expect(ser.root.orientation).toBe(Orientation.Horizontal);
    expect(ser.root.children.length).toBe(1);
    const leaf = ser.root.children[0] as any;
    expect(leaf.type).toBe(SerializedNodeType.Leaf);
    expect(leaf.viewId).toBe("x");
  });

  it("Grid.deserialize round-trips a serialized grid via a viewFactory", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    g.addView(new TView("x"), 200);
    g.addView(new TView("y"), 300);
    const ser = g.serialize();
    const g2 = Grid.deserialize(ser, (id) => new TView(id));
    expect(g2.hasView("x")).toBe(true);
    expect(g2.hasView("y")).toBe(true);
    const ser2 = g2.serialize();
    expect(ser2.orientation).toBe(ser.orientation);
    expect((ser2.root.children[0] as any).viewId).toBe("x");
    expect((ser2.root.children[1] as any).viewId).toBe("y");
  });

  it("splitView with same orientation inserts as sibling at the expected index", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    g.addView(new TView("a"), 400);
    g.splitView("a", new TView("b"), 100, Orientation.Horizontal, false);
    expect(g.hasView("a")).toBe(true);
    expect(g.hasView("b")).toBe(true);
    // total of both sizes should equal original (400)
    const sa = g.getViewSize("a")!;
    const sb = g.getViewSize("b")!;
    expect(sa + sb).toBe(400);
  });

  it("splitView throws for an unknown existing view", () => {
    const g = new Grid(Orientation.Horizontal, 800, 600);
    expect(() => g.splitView("missing", new TView("b"), 100, Orientation.Horizontal)).toThrow(/View not found/);
  });

  it("root branch uses the constructor orientation; SizingMode constants stay stable", () => {
    const g = new Grid(Orientation.Vertical, 100, 200);
    expect(g.root.orientation).toBe(Orientation.Vertical);
    // SizingMode pinning
    expect(SizingMode.Pixel).toBeDefined();
    expect(SizingMode.Proportional).toBeDefined();
  });
});
