/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { BaseGridView } from "../../src/layout/gridView";
import { Orientation } from "../../src/layout/layoutTypes";

class TestView extends BaseGridView {
  layoutCount = 0;
  lastDims: { w: number; h: number; o: Orientation } | null = null;
  protected layoutContent(w: number, h: number, o: Orientation): void {
    this.layoutCount++;
    this.lastDims = { w, h, o };
  }
}

describe("BaseGridView pin", () => {
  it("constructor creates a styled DOM element with grid-view classes", () => {
    const v = new TestView("hello");
    expect(v.element.tagName).toBe("DIV");
    expect(v.element.classList.contains("grid-view")).toBe(true);
    expect(v.element.classList.contains("grid-view-hello")).toBe(true);
    expect(v.element.style.overflow).toBe("hidden");
    expect(v.element.style.position).toBe("relative");
  });

  it("layout() sets size on element and invokes layoutContent with same dims", () => {
    const v = new TestView("v");
    v.layout(200, 150, Orientation.HORIZONTAL);
    expect(v.element.style.width).toBe("200px");
    expect(v.element.style.height).toBe("150px");
    expect(v.layoutCount).toBe(1);
    expect(v.lastDims).toEqual({ w: 200, h: 150, o: Orientation.HORIZONTAL });
    expect(v.width).toBe(200);
    expect(v.height).toBe(150);
  });

  it("setVisible toggles visibility and updates DOM display", () => {
    const v = new TestView("v");
    v.setVisible(false);
    expect(v.visible).toBe(false);
    expect(v.element.style.display).toBe("none");
    v.setVisible(true);
    expect(v.visible).toBe(true);
    expect(v.element.style.display).not.toBe("none");
  });

  it("toJSON serializes id + current dims + visibility", () => {
    const v = new TestView("vid");
    v.layout(50, 60, Orientation.VERTICAL);
    expect(v.toJSON()).toEqual({ id: "vid", width: 50, height: 60, visible: true });
  });

  it("default constraints come from DEFAULT_SIZE_CONSTRAINTS", () => {
    const v = new TestView("c");
    expect(v.minimumWidth).toBeGreaterThanOrEqual(0);
    expect(v.maximumWidth).toBeGreaterThan(v.minimumWidth);
    expect(v.minimumHeight).toBeGreaterThanOrEqual(0);
    expect(v.maximumHeight).toBeGreaterThan(v.minimumHeight);
  });

  it("BaseGridView.fromJSON throws (must be overridden)", () => {
    expect(() => BaseGridView.fromJSON({})).toThrow(/must be overridden/);
  });

  it("fireConstraintsChanged emits onDidChangeConstraints to subscribers", () => {
    class V2 extends TestView {
      bump() { this.fireConstraintsChanged(); }
    }
    const v = new V2("x");
    let calls = 0;
    v.onDidChangeConstraints(() => calls++);
    v.bump();
    v.bump();
    expect(calls).toBe(2);
  });
});
