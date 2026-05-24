/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/contributions/viewContribution.css", () => ({}));

import { ViewContributionProcessor } from "../../src/contributions/viewContribution";

let warnSpy: any, logSpy: any;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); logSpy.mockRestore(); });

function makeViewManager() {
  const registered = new Map<string, any>();
  return {
    register: vi.fn((d: any) => { registered.set(d.id, d); }),
    unregister: vi.fn((id: string) => { registered.delete(id); }),
    hasDescriptor: vi.fn((id: string) => registered.has(id)),
    _registered: registered,
  };
}

function toolDesc(id: string, contributes: any): any {
  return { manifest: { id, contributes } };
}

describe("ViewContributionProcessor — processContributions (containers)", () => {
  it("is a no-op for manifests with no contributes section", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions({ manifest: { id: "t" } } as any);
    expect(p.getContainers()).toEqual([]);
    expect(vm.register).not.toHaveBeenCalled();
  });

  it("registers viewContainers and fires onDidAddContainer for each", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    const added = vi.fn();
    p.onDidAddContainer(added);
    p.processContributions(toolDesc("tool-A", {
      viewContainers: [
        { id: "c1", title: "C1", location: "sidebar" },
        { id: "c2", title: "C2", location: "panel", icon: "💎" },
      ],
    }));
    expect(p.getContainers()).toHaveLength(2);
    expect(added).toHaveBeenCalledTimes(2);
    const c1 = p.getContainer("c1")!;
    expect(c1.location).toBe("sidebar");
    expect(c1.priority).toBe(100);
    expect(c1.toolId).toBe("tool-A");
  });

  it("skips duplicate container IDs and warns", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions(toolDesc("a", { viewContainers: [{ id: "c1", title: "A", location: "sidebar" }] }));
    p.processContributions(toolDesc("b", { viewContainers: [{ id: "c1", title: "B", location: "sidebar" }] }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate container ID "c1"'));
    expect(p.getContainer("c1")!.toolId).toBe("a");
  });

  it("filters containers by location and sorts by priority", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions(toolDesc("a", {
      viewContainers: [
        { id: "x", title: "X", location: "sidebar" },
        { id: "y", title: "Y", location: "panel" },
        { id: "z", title: "Z", location: "sidebar" },
      ],
    }));
    expect(p.getContainersForLocation("sidebar").map((c) => c.id)).toEqual(["x", "z"]);
    expect(p.getContainersForLocation("panel").map((c) => c.id)).toEqual(["y"]);
    expect(p.getContainersForLocation("auxiliaryBar")).toEqual([]);
  });
});

describe("ViewContributionProcessor — processContributions (views)", () => {
  it("registers views in the ViewManager with order=100 and DEFAULT_SIZE_CONSTRAINTS", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    const added = vi.fn();
    p.onDidAddView(added);
    p.processContributions(toolDesc("tool-A", {
      viewContainers: [{ id: "ctr", title: "C", location: "sidebar" }],
      views: [
        { id: "v1", name: "V1", defaultContainerId: "ctr", icon: "📄" },
      ],
    }));
    expect(vm.register).toHaveBeenCalledTimes(1);
    const call = vm.register.mock.calls[0][0];
    expect(call.id).toBe("v1");
    expect(call.name).toBe("V1");
    expect(call.containerId).toBe("ctr");
    expect(call.order).toBe(100);
    expect(typeof call.factory).toBe("function");
    expect(added).toHaveBeenCalledTimes(1);
    expect(p.hasContributedView("v1")).toBe(true);
  });

  it("defaults defaultContainerId to 'sidebar' when missing", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions(toolDesc("tool-A", {
      viewContainers: [{ id: "sidebar", title: "S", location: "sidebar" }],
      views: [{ id: "v1", name: "V1" }],
    }));
    const view = p.getViewsForContainer("sidebar");
    expect(view).toHaveLength(1);
    expect(view[0].id).toBe("v1");
  });

  it("warns when a view references an unknown container but still registers it", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions(toolDesc("tool-A", {
      views: [{ id: "v1", name: "V1", defaultContainerId: "ghost" }],
    }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown container "ghost"'));
    expect(p.hasContributedView("v1")).toBe(true);
  });
});

describe("ViewContributionProcessor — removeContributions", () => {
  it("removes views, unregisters them in the ViewManager, and fires onDidRemoveView", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    const removedView = vi.fn();
    const removedContainer = vi.fn();
    p.onDidRemoveView(removedView);
    p.onDidRemoveContainer(removedContainer);
    p.processContributions(toolDesc("tool-A", {
      viewContainers: [{ id: "ctr", title: "C", location: "sidebar" }],
      views: [{ id: "v1", name: "V1", defaultContainerId: "ctr" }],
    }));
    p.removeContributions("tool-A");
    expect(removedView).toHaveBeenCalledWith("v1");
    expect(removedContainer).toHaveBeenCalledWith("ctr");
    expect(vm.unregister).toHaveBeenCalledWith("v1");
    expect(p.hasContributedView("v1")).toBe(false);
    expect(p.getContainer("ctr")).toBeUndefined();
  });

  it("is a no-op for an unknown toolId", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.removeContributions("never-registered");
    expect(vm.unregister).not.toHaveBeenCalled();
  });

  it("re-processing the same tool clears prior contributions first", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions(toolDesc("a", { viewContainers: [{ id: "c1", title: "A1", location: "sidebar" }] }));
    p.processContributions(toolDesc("a", { viewContainers: [{ id: "c1", title: "A2", location: "sidebar" }] }));
    expect(p.getContainer("c1")!.title).toBe("A2");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Re-processing contributions"));
  });
});

describe("ViewContributionProcessor — provider registry", () => {
  it("registerProvider stores the provider and returns a Disposable", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    const provider = { resolveView: vi.fn() };
    const fired = vi.fn();
    p.onDidRegisterProvider(fired);
    const d = p.registerProvider("v1", provider as any);
    expect(p.getProvider("v1")).toBe(provider);
    expect(fired).toHaveBeenCalledWith({ viewId: "v1" });
    d.dispose();
    expect(p.getProvider("v1")).toBeUndefined();
  });

  it("dispose only clears the provider when it is still the same instance", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    const a = { resolveView: vi.fn() };
    const b = { resolveView: vi.fn() };
    const dA = p.registerProvider("v1", a as any);
    p.registerProvider("v1", b as any); // overrides A
    dA.dispose(); // does NOT clear B
    expect(p.getProvider("v1")).toBe(b);
  });

  it("getContributedToolIds returns the union of tools with containers or views", () => {
    const vm = makeViewManager();
    const p = new ViewContributionProcessor(vm as any);
    p.processContributions(toolDesc("a", { viewContainers: [{ id: "c1", title: "T", location: "sidebar" }] }));
    p.processContributions(toolDesc("b", { views: [{ id: "v1", name: "V" }] }));
    expect([...p.getContributedToolIds()].sort()).toEqual(["a", "b"]);
  });
});
