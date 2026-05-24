/**
 * @vitest-environment jsdom
 *
 * Pin: LayoutRenderer — base styles, container teardown, fire-on-mount,
 * createEmptyGrid lifecycle, relayout no-op when no grid, dispose hygiene.
 *
 * Real Grid is mocked: we only verify the renderer's container/event
 * contract, not the grid math itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// jsdom lacks ResizeObserver — give it a noop stub.
(globalThis as any).ResizeObserver ??= class {
  observe() {} disconnect() {} unobserve() {}
};

class MockGrid {
  element: HTMLElement;
  disposed = false;
  resized: Array<{ w: number; h: number }> = [];
  sashInit = false;
  constructor() {
    this.element = document.createElement("div");
    this.element.classList.add("mock-grid");
  }
  initializeSashDrag() { this.sashInit = true; }
  resize(w: number, h: number) { this.resized.push({ w, h }); }
  dispose() { this.disposed = true; }
}

vi.mock("../../src/layout/grid.js", () => {
  class GridStub {
    element: HTMLElement;
    _mock: MockGrid;
    constructor(_o: any, _w: number, _h: number) {
      const g = new MockGrid();
      this.element = g.element;
      this._mock = g;
    }
    static deserialize = vi.fn();
    initializeSashDrag() { this._mock.initializeSashDrag(); }
    resize(w: number, h: number) { this._mock.resize(w, h); }
    dispose() { this._mock.dispose(); }
  }
  return { Grid: GridStub };
});
vi.mock("../../src/layout/layoutModel.js", () => ({
  createDefaultLayoutState: vi.fn(() => ({ grid: { __default: true } })),
}));

import { LayoutRenderer } from "../../src/layout/layoutRenderer";
import { Orientation } from "../../src/layout/layoutTypes";
import { Grid } from "../../src/layout/grid.js";
import { createDefaultLayoutState } from "../../src/layout/layoutModel.js";
const deserializeSpy = (Grid as any).deserialize as ReturnType<typeof vi.fn>;
const createDefaultState = createDefaultLayoutState as unknown as ReturnType<typeof vi.fn>;

describe("layout/LayoutRenderer", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    deserializeSpy.mockReset();
    createDefaultState.mockClear();
  });

  it("applies parallx-layout-container + fill-container classes on construct", () => {
    new LayoutRenderer(container);
    expect(container.classList.contains("parallx-layout-container")).toBe(true);
    expect(container.classList.contains("fill-container")).toBe(true);
  });

  it("grid getter returns undefined before any render", () => {
    const r = new LayoutRenderer(container);
    expect(r.grid).toBeUndefined();
  });

  it("createEmptyGrid mounts a grid element, applies parallx-grid-root, fires onDidLayout", () => {
    const r = new LayoutRenderer(container);
    let fired = 0;
    r.onDidLayout(() => fired++);

    const g = r.createEmptyGrid(Orientation.Vertical);
    expect(g).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).classList.contains("parallx-grid-root")).toBe(true);
    expect(r.grid).toBe(g);
    expect(fired).toBe(1);
  });

  it("createEmptyGrid called twice disposes the prior grid and replaces the DOM", () => {
    const r = new LayoutRenderer(container);
    const g1: any = r.createEmptyGrid();
    const g2: any = r.createEmptyGrid();
    expect(g1._mock.disposed).toBe(true);
    expect(r.grid).toBe(g2);
    expect(container.childElementCount).toBe(1);
  });

  it("renderDefault uses createDefaultLayoutState with current container dims", () => {
    Object.defineProperty(container, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    deserializeSpy.mockImplementation(() => new (class {
      element = document.createElement("div");
      initializeSashDrag() {} resize() {} dispose() {}
    })());

    const r = new LayoutRenderer(container);
    r.renderDefault(() => ({}) as any);
    expect(createDefaultState).toHaveBeenCalledWith(500, 400);
  });

  it("renderFromState delegates to Grid.deserialize and mounts result", () => {
    const fake = new (class {
      element = document.createElement("section");
      initializeSashDrag = vi.fn();
      resize = vi.fn();
      dispose = vi.fn();
    })();
    deserializeSpy.mockReturnValue(fake);

    const r = new LayoutRenderer(container);
    const out = r.renderFromState({ grid: { foo: 1 } } as any, () => ({}) as any);
    expect(deserializeSpy).toHaveBeenCalledTimes(1);
    expect(out).toBe(fake as any);
    expect(container.firstChild).toBe(fake.element);
    expect(fake.initializeSashDrag).toHaveBeenCalledTimes(1);
  });

  it("relayout is a no-op (no fire) when no grid is mounted", () => {
    const r = new LayoutRenderer(container);
    let fired = 0;
    r.onDidLayout(() => fired++);
    r.relayout();
    expect(fired).toBe(0);
  });

  it("relayout resizes the active grid and fires onDidLayout", () => {
    const r = new LayoutRenderer(container);
    const g: any = r.createEmptyGrid();
    g._mock.resized.length = 0;

    Object.defineProperty(container, "clientWidth", { value: 333, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 222, configurable: true });

    let fired = 0;
    r.onDidLayout(() => fired++);
    r.relayout();
    expect(g._mock.resized).toEqual([{ w: 333, h: 222 }]);
    expect(fired).toBe(1);
  });

  it("dispose tears down the grid and clears the container", () => {
    const r = new LayoutRenderer(container);
    const g: any = r.createEmptyGrid();
    r.dispose();
    expect(g._mock.disposed).toBe(true);
    expect(container.childElementCount).toBe(0);
  });
});
