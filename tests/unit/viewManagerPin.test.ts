// viewManagerPin.test.ts — pin ViewManager lifecycle, lookups, visibility, save state.

import { describe, it, expect, vi } from "vitest";
import { ViewManager, ViewLifecyclePhase } from "../../src/views/viewManager";
import type { IView, ViewState } from "../../src/views/viewTypes";
import type { IViewDescriptor } from "../../src/views/viewDescriptor";

function fakeView(id: string, state: ViewState = {}): IView {
  const v: any = {
    id,
    name: id,
    element: undefined,
    minimumWidth: 0,
    maximumWidth: 1e9,
    minimumHeight: 0,
    maximumHeight: 1e9,
    onDidChangeConstraints: () => ({ dispose: () => {} }),
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    createElement: vi.fn(),
    setVisible: vi.fn(),
    layout: vi.fn(),
    focus: vi.fn(),
    saveState: vi.fn(() => state),
    restoreState: vi.fn(),
    dispose: vi.fn(),
  };
  return v;
}

function descriptor(id: string, opts: Partial<IViewDescriptor> & { factory?: () => IView | Promise<IView> } = {}): IViewDescriptor {
  return {
    id,
    name: id,
    containerId: "ctr",
    order: opts.order ?? 0,
    factory: opts.factory ?? (() => fakeView(id)),
    ...opts,
  } as any;
}

describe("ViewManager — register", () => {
  it("registers a descriptor and fires onDidRegister + Registered lifecycle", () => {
    const m = new ViewManager();
    const reg = vi.fn();
    const life = vi.fn();
    m.onDidRegister(reg);
    m.onDidLifecycle(life);
    const d = descriptor("v1");
    m.register(d);
    expect(reg).toHaveBeenCalledWith(d);
    expect(life).toHaveBeenCalledWith(expect.objectContaining({ viewId: "v1", phase: ViewLifecyclePhase.Registered }));
    expect(m.hasDescriptor("v1")).toBe(true);
  });

  it("throws on duplicate id", () => {
    const m = new ViewManager();
    m.register(descriptor("v1"));
    expect(() => m.register(descriptor("v1"))).toThrow(/already registered/);
  });

  it("registerMany registers all", () => {
    const m = new ViewManager();
    m.registerMany([descriptor("a"), descriptor("b")]);
    expect(m.hasDescriptor("a")).toBe(true);
    expect(m.hasDescriptor("b")).toBe(true);
  });

  it("getDescriptorsForContainer filters and sorts by order ascending", () => {
    const m = new ViewManager();
    m.register(descriptor("z", { order: 30, containerId: "x" } as any));
    m.register(descriptor("a", { order: 10, containerId: "x" } as any));
    m.register(descriptor("m", { order: 20, containerId: "x" } as any));
    m.register(descriptor("other", { order: 0, containerId: "y" } as any));
    const ids = m.getDescriptorsForContainer("x").map(d => d.id);
    expect(ids).toEqual(["a", "m", "z"]);
  });
});

describe("ViewManager — create / lookup", () => {
  it("createView is lazy and idempotent (single instance per id)", async () => {
    const m = new ViewManager();
    const fac = vi.fn(() => fakeView("v"));
    m.register(descriptor("v", { factory: fac }));
    const a = await m.createView("v");
    const b = await m.createView("v");
    expect(a).toBe(b);
    expect(fac).toHaveBeenCalledTimes(1);
    expect(m.isCreated("v")).toBe(true);
  });

  it("createView throws if descriptor missing", async () => {
    const m = new ViewManager();
    await expect(m.createView("missing")).rejects.toThrow(/No descriptor/);
  });

  it("createView restores saved state on create", async () => {
    const m = new ViewManager();
    const v1 = fakeView("v", { x: 1 });
    m.register(descriptor("v", { factory: () => v1 }));
    await m.createView("v");
    m.disposeView("v");
    const v2 = fakeView("v");
    // re-register isn't needed (still registered); just re-create
    (m as any)._descriptors.get("v").factory = () => v2;
    await m.createView("v");
    expect(v2.restoreState).toHaveBeenCalledWith({ x: 1 });
  });

  it("createViewSync throws on async factory", () => {
    const m = new ViewManager();
    m.register(descriptor("v", { factory: () => Promise.resolve(fakeView("v")) }));
    expect(() => m.createViewSync("v")).toThrow(/async factory/);
  });

  it("createViewSync throws if descriptor missing", () => {
    const m = new ViewManager();
    expect(() => m.createViewSync("missing")).toThrow(/No descriptor/);
  });

  it("getView returns undefined before creation, instance after", async () => {
    const m = new ViewManager();
    m.register(descriptor("v"));
    expect(m.getView("v")).toBeUndefined();
    await m.createView("v");
    expect(m.getView("v")).toBeDefined();
  });
});

describe("ViewManager — visibility + focus", () => {
  it("showView marks visible, fires Visible lifecycle, calls view.setVisible(true)", async () => {
    const m = new ViewManager();
    const v = fakeView("v");
    m.register(descriptor("v", { factory: () => v }));
    await m.createView("v");
    const life = vi.fn();
    m.onDidLifecycle(life);
    m.showView("v");
    expect(v.setVisible).toHaveBeenCalledWith(true);
    expect(m.isVisible("v")).toBe(true);
    expect(life).toHaveBeenCalledWith(expect.objectContaining({ viewId: "v", phase: ViewLifecyclePhase.Visible }));
  });

  it("showView is a no-op when view not yet created", () => {
    const m = new ViewManager();
    m.register(descriptor("v"));
    m.showView("v");
    expect(m.isVisible("v")).toBe(false);
  });

  it("hideView un-marks visibility and fires Hidden lifecycle; clears active when matching", async () => {
    const m = new ViewManager();
    const v = fakeView("v");
    m.register(descriptor("v", { factory: () => v }));
    await m.createView("v");
    m.showView("v");
    m.focusView("v");
    expect(m.activeViewId).toBe("v");
    m.hideView("v");
    expect(v.setVisible).toHaveBeenLastCalledWith(false);
    expect(m.isVisible("v")).toBe(false);
    expect(m.activeViewId).toBeUndefined();
  });

  it("focusView sets active, calls focus(), fires Focused + active change", async () => {
    const m = new ViewManager();
    const v = fakeView("v");
    m.register(descriptor("v", { factory: () => v }));
    await m.createView("v");
    const active = vi.fn();
    m.onDidChangeActiveView(active);
    m.focusView("v");
    expect(v.focus).toHaveBeenCalled();
    expect(m.activeViewId).toBe("v");
    expect(active).toHaveBeenCalledWith("v");
  });

  it("focusView is a no-op for uncreated view", () => {
    const m = new ViewManager();
    m.register(descriptor("v"));
    m.focusView("v");
    expect(m.activeViewId).toBeUndefined();
  });
});

describe("ViewManager — state + dispose", () => {
  it("saveViewState captures view.saveState() into saved map", async () => {
    const m = new ViewManager();
    const v = fakeView("v", { tab: 2 });
    m.register(descriptor("v", { factory: () => v }));
    await m.createView("v");
    m.saveViewState("v");
    expect(m.getSavedState("v")).toEqual({ tab: 2 });
  });

  it("saveAllStates saves every created view", async () => {
    const m = new ViewManager();
    const a = fakeView("a", { x: 1 });
    const b = fakeView("b", { y: 2 });
    m.register(descriptor("a", { factory: () => a }));
    m.register(descriptor("b", { factory: () => b }));
    await m.createView("a");
    await m.createView("b");
    m.saveAllStates();
    expect(m.getSavedState("a")).toEqual({ x: 1 });
    expect(m.getSavedState("b")).toEqual({ y: 2 });
  });

  it("disposeView saves state, disposes the view, removes from instances", async () => {
    const m = new ViewManager();
    const v = fakeView("v", { z: 9 });
    m.register(descriptor("v", { factory: () => v }));
    await m.createView("v");
    m.showView("v");
    m.disposeView("v");
    expect(v.dispose).toHaveBeenCalled();
    expect(m.isCreated("v")).toBe(false);
    expect(m.isVisible("v")).toBe(false);
    expect(m.getSavedState("v")).toEqual({ z: 9 });
  });

  it("unregister removes descriptor and disposes existing view", async () => {
    const m = new ViewManager();
    const v = fakeView("v");
    m.register(descriptor("v", { factory: () => v }));
    await m.createView("v");
    m.unregister("v");
    expect(m.hasDescriptor("v")).toBe(false);
    expect(v.dispose).toHaveBeenCalled();
    expect(m.getSavedState("v")).toBeUndefined();
  });

  it("unregister of unknown id is a no-op", () => {
    const m = new ViewManager();
    expect(() => m.unregister("missing")).not.toThrow();
  });
});
