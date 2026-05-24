/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceSaver } from "../../src/workspace/workspaceSaver";

let warnSpy: any, errSpy: any, logSpy: any;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.useFakeTimers();
});
afterEach(() => {
  warnSpy.mockRestore(); errSpy.mockRestore(); logSpy.mockRestore();
  vi.useRealTimers();
});

function makeStorage() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    _store: store,
  };
}

function makeSources(over: any = {}) {
  const touch = vi.fn();
  return {
    workspace: {
      identity: { id: "w1", name: "MyWs" },
      metadata: { name: "MyWs" },
      touch,
      serializeFolders: vi.fn(() => [{ uri: "file:///a" }]),
    },
    containerWidth: 100, containerHeight: 100,
    parts: [],
    viewContainers: [],
    viewManager: {
      saveAllStates: vi.fn(),
      getDescriptors: () => [],
      getSavedState: () => undefined,
    },
    layoutSerializer: vi.fn(() => ({ version: 1, grid: {} } as any)),
    contextProvider: vi.fn(() => ({ activePartId: undefined } as any)),
    editorProvider: undefined,
    ...over,
  };
}

describe("WorkspaceSaver — save()", () => {
  it("warns and does nothing when sources are not configured", async () => {
    const s = makeStorage();
    const saver = new WorkspaceSaver(s as any);
    await saver.save();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No sources configured"));
    expect(s.set).not.toHaveBeenCalled();
  });

  it("serializes WorkspaceState and writes it under the 'workbench' key", async () => {
    const s = makeStorage();
    const sources = makeSources();
    const saver = new WorkspaceSaver(s as any);
    saver.setSources(sources as any);
    await saver.save();
    expect(s.set).toHaveBeenCalledTimes(1);
    const [key, json] = s.set.mock.calls[0];
    expect(key).toBe("workbench");
    const parsed = JSON.parse(json as string);
    expect(parsed.identity.id).toBe("w1");
    expect(parsed.folders).toEqual([{ uri: "file:///a" }]);
    expect(parsed.version).toBeGreaterThan(0);
    expect(sources.workspace.touch).toHaveBeenCalled();
  });

  it("collectState includes editors from editorProvider or a default snapshot", () => {
    const s = makeStorage();
    const provided = { activeEditorId: "ed-1" } as any;
    const sources1 = makeSources({ editorProvider: vi.fn(() => provided) });
    const saver1 = new WorkspaceSaver(s as any);
    saver1.setSources(sources1 as any);
    expect(saver1.collectState().editors).toBe(provided);

    const sources2 = makeSources({ editorProvider: undefined });
    const saver2 = new WorkspaceSaver(s as any);
    saver2.setSources(sources2 as any);
    expect(saver2.collectState().editors).toEqual(expect.any(Object));
  });

  it("collectState collects per-part snapshots in declaration order", () => {
    const partA = { id: "a", visible: true, width: 10, height: 20, saveState: () => ({ data: { x: 1 } }) };
    const partB = { id: "b", visible: false, width: 30, height: 40, saveState: () => ({ data: null }) };
    const s = makeStorage();
    const sources = makeSources({ parts: [partA, partB] });
    const saver = new WorkspaceSaver(s as any);
    saver.setSources(sources as any);
    const st = saver.collectState();
    expect(st.parts).toEqual([
      { partId: "a", visible: true, width: 10, height: 20, data: { x: 1 } },
      { partId: "b", visible: false, width: 30, height: 40, data: null },
    ]);
  });

  it("collectState collects per-view-container snapshots", () => {
    const c1 = {
      id: "sidebar",
      saveContainerState: () => ({
        activeViewId: "v1",
        tabOrder: ["v1", "v2"],
        hiddenTabs: ["v3"],
      }),
    };
    const c2 = {
      id: "panel",
      saveContainerState: () => ({ activeViewId: undefined, tabOrder: [], hiddenTabs: undefined }),
    };
    const s = makeStorage();
    const sources = makeSources({ viewContainers: [c1, c2] });
    const saver = new WorkspaceSaver(s as any);
    saver.setSources(sources as any);
    const st = saver.collectState();
    expect(st.viewContainers).toEqual([
      { containerId: "sidebar", activeViewId: "v1", tabOrder: ["v1", "v2"], hiddenTabs: ["v3"] },
      { containerId: "panel", activeViewId: undefined, tabOrder: [], hiddenTabs: undefined },
    ]);
  });

  it("collectState collects only views that have saved state", () => {
    const vm = {
      saveAllStates: vi.fn(),
      getDescriptors: () => [
        { id: "v1", containerId: "c" },
        { id: "v2", containerId: "c" },
      ],
      getSavedState: (id: string) => (id === "v1" ? { someState: true } : undefined),
    };
    const s = makeStorage();
    const sources = makeSources({ viewManager: vm });
    const saver = new WorkspaceSaver(s as any);
    saver.setSources(sources as any);
    const st = saver.collectState();
    expect(vm.saveAllStates).toHaveBeenCalled();
    expect(st.views).toEqual([{ viewId: "v1", containerId: "c", state: { someState: true } }]);
  });

  it("logs and swallows storage errors", async () => {
    const s: any = { set: vi.fn(async () => { throw new Error("disk full"); }) };
    const saver = new WorkspaceSaver(s);
    saver.setSources(makeSources() as any);
    await saver.save();
    expect(errSpy).toHaveBeenCalled();
    // After failure, saver remains usable (re-entrancy flag cleared).
    s.set.mockResolvedValueOnce(undefined);
    await saver.save();
    expect(s.set).toHaveBeenCalledTimes(2);
  });
});

describe("WorkspaceSaver — debounced requestSave()", () => {
  it("collapses multiple requests within the debounce window into a single save", async () => {
    const s = makeStorage();
    const saver = new WorkspaceSaver(s as any, 1000);
    saver.setSources(makeSources() as any);
    saver.requestSave();
    saver.requestSave();
    saver.requestSave();
    expect(s.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it("flushPendingSave() drains the timer and saves immediately", async () => {
    const s = makeStorage();
    const saver = new WorkspaceSaver(s as any, 5000);
    saver.setSources(makeSources() as any);
    saver.requestSave();
    expect(s.set).not.toHaveBeenCalled();
    await saver.flushPendingSave();
    expect(s.set).toHaveBeenCalledTimes(1);
    // Subsequent flush with no pending timer is a no-op.
    await saver.flushPendingSave();
    expect(s.set).toHaveBeenCalledTimes(1);
  });
});
