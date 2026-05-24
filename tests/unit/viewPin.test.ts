/** @vitest-environment jsdom */
/**
 * Pin tests for src/views/view.ts — `View` abstract base lifecycle.
 *
 * Pins:
 *   - createElement builds `.view.view-<id>[data-view-id=<id>]`, appends to container,
 *     calls `createViewContent` exactly once, and is idempotent (re-mounts existing element).
 *   - setVisible toggles `.visible` class on the element and fires onDidChangeVisibility once.
 *   - setVisible no-op when value unchanged.
 *   - layout(w, h) sets element width/height styles and calls protected `layoutContent(w, h)`.
 *   - focus() delegates to element.focus().
 *   - saveState/restoreState delegate to protected `saveViewState`/`restoreViewState`.
 *   - Default size constraints come from DEFAULT_SIZE_CONSTRAINTS when not overridden.
 *   - fireConstraintsChanged fires onDidChangeConstraints.
 */
import { describe, it, expect, vi } from "vitest";
import { View, DEFAULT_SIZE_CONSTRAINTS } from "../../src/views/view";

class TestView extends View {
  createCalls = 0;
  layoutCalls: Array<{ w: number; h: number }> = [];
  saved: any = { foo: "bar" };
  restored: any[] = [];
  protected createViewContent(container: HTMLElement): void {
    this.createCalls++;
    const inner = document.createElement("span");
    inner.className = "test-inner";
    container.appendChild(inner);
  }
  protected override layoutContent(width: number, height: number): void {
    this.layoutCalls.push({ w: width, h: height });
  }
  protected override saveViewState() { return this.saved; }
  protected override restoreViewState(state: any): void { this.restored.push(state); }
  public fireConstraints(): void { (this as any).fireConstraintsChanged(); }
}

describe("views/View — createElement", () => {
  it("creates `.view.view-<id>[data-view-id=<id>]` and calls createViewContent once", () => {
    const v = new TestView("foo", "Foo");
    const host = document.createElement("div");
    v.createElement(host);

    const el = host.querySelector(".view") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains("view-foo")).toBe(true);
    expect(el.getAttribute("data-view-id")).toBe("foo");
    expect(el.querySelector(".test-inner")).toBeTruthy();
    expect(v.createCalls).toBe(1);
    expect(v.element).toBe(el);
  });

  it("is idempotent — second call re-appends existing element without re-building", () => {
    const v = new TestView("foo", "Foo");
    const host1 = document.createElement("div");
    const host2 = document.createElement("div");
    v.createElement(host1);
    const el = v.element!;

    v.createElement(host2);

    expect(v.createCalls).toBe(1);
    expect(host1.contains(el)).toBe(false);
    expect(host2.contains(el)).toBe(true);
  });
});

describe("views/View — visibility", () => {
  it("setVisible toggles `.visible` class and fires onDidChangeVisibility", () => {
    const v = new TestView("v", "V");
    const host = document.createElement("div");
    v.createElement(host);
    const fired: boolean[] = [];
    v.onDidChangeVisibility(b => fired.push(b));

    v.setVisible(true);
    expect(v.visible).toBe(true);
    expect(v.element!.classList.contains("visible")).toBe(true);
    expect(fired).toEqual([true]);

    v.setVisible(false);
    expect(v.element!.classList.contains("visible")).toBe(false);
    expect(fired).toEqual([true, false]);
  });

  it("setVisible is a no-op when value unchanged", () => {
    const v = new TestView("v", "V");
    const fired: boolean[] = [];
    v.onDidChangeVisibility(b => fired.push(b));
    v.setVisible(false);
    expect(fired).toEqual([]);
  });
});

describe("views/View — layout + focus + state", () => {
  it("layout sets element width/height and calls layoutContent", () => {
    const v = new TestView("v", "V");
    const host = document.createElement("div");
    v.createElement(host);

    v.layout(320, 240);
    expect(v.width).toBe(320);
    expect(v.height).toBe(240);
    expect(v.element!.style.width).toBe("320px");
    expect(v.element!.style.height).toBe("240px");
    expect(v.layoutCalls).toEqual([{ w: 320, h: 240 }]);
  });

  it("focus delegates to element.focus()", () => {
    const v = new TestView("v", "V");
    const host = document.createElement("div");
    v.createElement(host);
    const spy = vi.spyOn(v.element!, "focus");
    v.focus();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("saveState returns saveViewState; restoreState delegates to restoreViewState", () => {
    const v = new TestView("v", "V");
    expect(v.saveState()).toBe(v.saved);
    v.restoreState({ hello: "world" });
    expect(v.restored).toEqual([{ hello: "world" }]);
  });
});

describe("views/View — constraints", () => {
  it("defaults come from DEFAULT_SIZE_CONSTRAINTS", () => {
    const v = new TestView("v", "V");
    expect(v.minimumWidth).toBe(DEFAULT_SIZE_CONSTRAINTS.minimumWidth);
    expect(v.maximumWidth).toBe(DEFAULT_SIZE_CONSTRAINTS.maximumWidth);
    expect(v.minimumHeight).toBe(DEFAULT_SIZE_CONSTRAINTS.minimumHeight);
    expect(v.maximumHeight).toBe(DEFAULT_SIZE_CONSTRAINTS.maximumHeight);
  });

  it("fireConstraintsChanged fires onDidChangeConstraints", () => {
    const v = new TestView("v", "V");
    let fired = 0;
    v.onDidChangeConstraints(() => fired++);
    v.fireConstraints();
    expect(fired).toBe(1);
  });
});
