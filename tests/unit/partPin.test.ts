/** @vitest-environment jsdom */
/**
 * Pin tests for src/parts/part.ts — `Part` abstract base lifecycle.
 *
 * Pins:
 *   - element/contentElement throw before create().
 *   - create() builds `.part.part-<id-sanitized>[role=region][data-part-id=<id>]`,
 *     adds `.hidden` when constructed not visible, mounts `.part-content`, and
 *     calls createContent exactly once.
 *   - create() with hasTitleArea=true also mounts `.part-title` and calls createTitleArea.
 *   - create() is idempotent.
 *   - mount() before create calls create; after create just re-appends.
 *   - layout sets element width/height styles, calls layoutContent, fires onDidChangeSize on change.
 *   - setVisible toggles `.hidden` (inverse) + fires onDidChangeVisibility, no-op when unchanged.
 *   - saveState returns the documented shape and includes savePartData().
 *   - restoreState calls setVisible when needed and restorePartData when data present.
 *   - id with dots is sanitized into class name with hyphens.
 */
import { describe, it, expect, vi } from "vitest";
import { Part } from "../../src/parts/part";
import { PartPosition } from "../../src/parts/partTypes";
import { Orientation } from "../../src/layout/layoutTypes";

class TestPart extends Part {
  contentCalls = 0;
  titleCalls = 0;
  layoutCalls: Array<{ w: number; h: number }> = [];
  hasTitle = false;
  savedData: any = undefined;
  restoredData: any[] = [];
  constructor(opts?: { id?: string; visible?: boolean; hasTitle?: boolean }) {
    super(opts?.id ?? "test", "Test", PartPosition.Left, undefined, opts?.visible ?? true);
    this.hasTitle = !!opts?.hasTitle;
  }
  protected override get hasTitleArea(): boolean { return this.hasTitle; }
  protected override createTitleArea(c: HTMLElement): void {
    this.titleCalls++;
    const s = document.createElement("span"); s.className = "title-inner"; c.appendChild(s);
  }
  protected createContent(c: HTMLElement): void {
    this.contentCalls++;
    const s = document.createElement("span"); s.className = "content-inner"; c.appendChild(s);
  }
  protected override layoutContent(w: number, h: number): void { this.layoutCalls.push({ w, h }); }
  protected override savePartData() { return this.savedData; }
  protected override restorePartData(d: Record<string, unknown>): void { this.restoredData.push(d); }
}

describe("parts/Part — pre-create access throws", () => {
  it("element throws if accessed before create()", () => {
    const p = new TestPart();
    expect(() => p.element).toThrow(/has not been created/);
    expect(() => p.contentElement).toThrow(/has not been created/);
  });
});

describe("parts/Part — create()", () => {
  it("builds the expected DOM structure with role+aria+data-part-id", () => {
    const p = new TestPart({ id: "my.part" });
    const host = document.createElement("div");
    p.create(host);

    const el = host.querySelector(".part") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains("part-my-part")).toBe(true); // dots sanitized
    expect(el.getAttribute("role")).toBe("region");
    expect(el.getAttribute("aria-label")).toBe("Test");
    expect(el.getAttribute("data-part-id")).toBe("my.part");
    expect(el.classList.contains("hidden")).toBe(false);

    const content = el.querySelector(".part-content") as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.querySelector(".content-inner")).toBeTruthy();
    expect(p.contentCalls).toBe(1);
    expect(p.element).toBe(el);
    expect(p.contentElement).toBe(content);
  });

  it("adds `.hidden` when defaultVisible=false", () => {
    const p = new TestPart({ visible: false });
    const host = document.createElement("div");
    p.create(host);
    expect(p.element.classList.contains("hidden")).toBe(true);
  });

  it("mounts `.part-title` and calls createTitleArea when hasTitleArea=true", () => {
    const p = new TestPart({ hasTitle: true });
    const host = document.createElement("div");
    p.create(host);
    const title = p.element.querySelector(".part-title") as HTMLElement;
    expect(title).toBeTruthy();
    expect(title.querySelector(".title-inner")).toBeTruthy();
    expect(p.titleCalls).toBe(1);
  });

  it("is idempotent — second create() does not rebuild content", () => {
    const p = new TestPart();
    const host = document.createElement("div");
    p.create(host);
    p.create(host);
    expect(p.contentCalls).toBe(1);
  });
});

describe("parts/Part — mount()", () => {
  it("mount() before create() calls create()", () => {
    const p = new TestPart();
    const host = document.createElement("div");
    p.mount(host);
    expect(p.contentCalls).toBe(1);
    expect(host.contains(p.element)).toBe(true);
  });

  it("mount() after create() re-appends without rebuilding", () => {
    const p = new TestPart();
    const host1 = document.createElement("div");
    const host2 = document.createElement("div");
    p.create(host1);
    p.mount(host2);
    expect(p.contentCalls).toBe(1);
    expect(host1.contains(p.element)).toBe(false);
    expect(host2.contains(p.element)).toBe(true);
  });
});

describe("parts/Part — layout + visibility + state", () => {
  it("layout sets width/height styles, calls layoutContent, fires onDidChangeSize on change", () => {
    const p = new TestPart();
    const host = document.createElement("div");
    p.create(host);
    const sizes: Array<{ width: number; height: number }> = [];
    p.onDidChangeSize(d => sizes.push(d));

    p.layout(100, 200, Orientation.HORIZONTAL);
    expect(p.element.style.width).toBe("100px");
    expect(p.element.style.height).toBe("200px");
    expect(p.layoutCalls).toEqual([{ w: 100, h: 200 }]);
    expect(sizes).toEqual([{ width: 100, height: 200 }]);

    // Same dimensions — onDidChangeSize must not fire
    p.layout(100, 200, Orientation.HORIZONTAL);
    expect(sizes.length).toBe(1);
  });

  it("setVisible toggles `.hidden` inversely and fires onDidChangeVisibility; no-op when unchanged", () => {
    const p = new TestPart();
    const host = document.createElement("div");
    p.create(host);
    const events: boolean[] = [];
    p.onDidChangeVisibility(v => events.push(v));

    p.setVisible(false);
    expect(p.visible).toBe(false);
    expect(p.element.classList.contains("hidden")).toBe(true);
    expect(events).toEqual([false]);

    p.setVisible(false);
    expect(events).toEqual([false]);

    p.setVisible(true);
    expect(p.element.classList.contains("hidden")).toBe(false);
    expect(events).toEqual([false, true]);
  });

  it("saveState returns the documented shape with savePartData()", () => {
    const p = new TestPart();
    const host = document.createElement("div");
    p.create(host);
    p.savedData = { foo: 1 };
    p.layout(50, 60, Orientation.VERTICAL);

    const state = p.saveState();
    expect(state.id).toBe("test");
    expect(state.visible).toBe(true);
    expect(state.width).toBe(50);
    expect(state.height).toBe(60);
    expect(state.position).toBe(PartPosition.Left);
    expect(state.data).toEqual({ foo: 1 });
  });

  it("restoreState calls setVisible when value differs and restorePartData when data present", () => {
    const p = new TestPart({ visible: true });
    const host = document.createElement("div");
    p.create(host);
    const visEvents: boolean[] = [];
    p.onDidChangeVisibility(v => visEvents.push(v));

    p.restoreState({
      id: "test",
      visible: false,
      width: 0,
      height: 0,
      position: PartPosition.Right,
      data: { hello: "world" },
    });
    expect(visEvents).toEqual([false]);
    expect(p.position).toBe(PartPosition.Right);
    expect(p.restoredData).toEqual([{ hello: "world" }]);
  });
});
