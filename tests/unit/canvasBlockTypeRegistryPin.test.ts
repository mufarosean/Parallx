/**
 * Pin: CanvasBlockTypeRegistry — contributed block registration, conflict
 * detection (built-in vs other contribution), onDidChange firing, dispose
 * cleanup, getAll order, has.
 */
import { describe, it, expect, vi } from "vitest";
import { CanvasBlockTypeRegistry } from "../../src/services/canvasBlockTypeRegistry";
import { BLOCK_REGISTRY } from "../../src/built-in/canvas/config/blockRegistry";

const def = (id: string, overrides: any = {}) => ({
  id,
  name: id,
  label: id,
  icon: "block",
  source: "custom",
  kind: "leaf",
  capabilities: {},
  ...overrides,
}) as any;

describe("services/canvasBlockTypeRegistry", () => {
  it("register returns an IDisposable and getAll lists in registration order", () => {
    const reg = new CanvasBlockTypeRegistry();
    const d1 = reg.register(def("ext-block-a"));
    const d2 = reg.register(def("ext-block-b"));
    expect(typeof d1.dispose).toBe("function");
    expect(typeof d2.dispose).toBe("function");
    expect(reg.getAll().map(d => d.id)).toEqual(["ext-block-a", "ext-block-b"]);
  });

  it("has() returns true for contributed ids only — built-ins are NOT in has()", () => {
    const reg = new CanvasBlockTypeRegistry();
    reg.register(def("ext-block-a"));
    expect(reg.has("ext-block-a")).toBe(true);
    expect(reg.has("nonexistent")).toBe(false);
    // built-in ids are NOT reported as contributed
    const builtInId = [...BLOCK_REGISTRY.keys()][0];
    expect(reg.has(builtInId)).toBe(false);
  });

  it("register throws when id collides with a built-in block", () => {
    const reg = new CanvasBlockTypeRegistry();
    const builtInId = [...BLOCK_REGISTRY.keys()][0];
    expect(() => reg.register(def(builtInId))).toThrow(/built-in block/);
  });

  it("register throws on duplicate contribution id", () => {
    const reg = new CanvasBlockTypeRegistry();
    reg.register(def("ext-block-a"));
    expect(() => reg.register(def("ext-block-a"))).toThrow(/already contributed/);
  });

  it("register throws when definition.id or definition.name is missing", () => {
    const reg = new CanvasBlockTypeRegistry();
    expect(() => reg.register({} as any)).toThrow(/definition\.id is required/);
    expect(() => reg.register({ id: "x" } as any)).toThrow(/definition\.name is required.*id=x/);
  });

  it("onDidChange fires on register AND on dispose-of-disposable", () => {
    const reg = new CanvasBlockTypeRegistry();
    const fn = vi.fn();
    reg.onDidChange(fn);
    const d = reg.register(def("ext-block-a"));
    expect(fn).toHaveBeenCalledTimes(1);
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(reg.has("ext-block-a")).toBe(false);
  });

  it("disposable.dispose() removes the contribution and clears has()/getAll()", () => {
    const reg = new CanvasBlockTypeRegistry();
    const d = reg.register(def("ext-block-a"));
    reg.register(def("ext-block-b"));
    d.dispose();
    expect(reg.has("ext-block-a")).toBe(false);
    expect(reg.getAll().map(x => x.id)).toEqual(["ext-block-b"]);
  });

  it("disposing a disposable twice is a no-op (does not fire onDidChange again)", () => {
    const reg = new CanvasBlockTypeRegistry();
    const fn = vi.fn();
    const d = reg.register(def("ext-block-a"));
    reg.onDidChange(fn);
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1); // first dispose fired, second is no-op
  });

  it("after registry.dispose(), register() returns a no-op disposable and does NOT mutate state", () => {
    const reg = new CanvasBlockTypeRegistry();
    reg.dispose();
    const d = reg.register(def("ext-block-a"));
    expect(typeof d.dispose).toBe("function");
    expect(reg.has("ext-block-a")).toBe(false);
    expect(reg.getAll()).toEqual([]);
  });
});
