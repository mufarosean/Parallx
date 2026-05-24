/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolRegistry, ToolState } from "../../src/tools/toolRegistry";
import type { IToolDescription } from "../../src/tools/toolManifest";

function desc(id: string, contributes?: any): IToolDescription {
  return {
    manifest: { id, name: id, version: "1.0.0", contributes } as any,
    toolPath: `/tools/${id}`,
    isBuiltin: false,
  };
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); });

describe("ToolRegistry — registration", () => {
  it("register stores the description in Registered state and fires onDidRegisterTool", () => {
    const reg = new ToolRegistry();
    const events: any[] = [];
    reg.onDidRegisterTool((e) => events.push(e));
    const d = desc("t");
    reg.register(d);
    expect(reg.has("t")).toBe(true);
    expect(reg.count).toBe(1);
    expect(reg.getById("t")).toEqual({ description: d, state: ToolState.Registered });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ toolId: "t", description: d });
  });

  it("register throws on duplicate IDs without firing a second event", () => {
    const reg = new ToolRegistry();
    reg.register(desc("dup"));
    const events: any[] = [];
    reg.onDidRegisterTool((e) => events.push(e));
    expect(() => reg.register(desc("dup"))).toThrow(/Duplicate tool ID/);
    expect(events).toHaveLength(0);
  });
});

describe("ToolRegistry — setToolState", () => {
  it("fires onDidChangeToolState with previous and new state on legal transition", () => {
    const reg = new ToolRegistry();
    reg.register(desc("t"));
    const events: any[] = [];
    reg.onDidChangeToolState((e) => events.push(e));
    reg.setToolState("t", ToolState.Activating);
    expect(events).toEqual([{ toolId: "t", previousState: ToolState.Registered, newState: ToolState.Activating }]);
  });

  it("rejects illegal transitions with a descriptive error", () => {
    const reg = new ToolRegistry();
    reg.register(desc("t"));
    expect(() => reg.setToolState("t", ToolState.Activated)).toThrow(/Invalid state transition/);
  });

  it("rejects transitions for unknown tool IDs", () => {
    const reg = new ToolRegistry();
    expect(() => reg.setToolState("nope", ToolState.Activated)).toThrow(/Tool not found/);
  });

  it("Disposed is terminal — no transition out of it is allowed", () => {
    const reg = new ToolRegistry();
    reg.register(desc("t"));
    reg.setToolState("t", ToolState.Disposed);
    expect(() => reg.setToolState("t", ToolState.Registered)).toThrow(/Invalid state transition/);
  });

  it("walks the full happy-path lifecycle Registered → Activating → Activated → Deactivating → Deactivated → Activating → Activated → Disposed", () => {
    const reg = new ToolRegistry();
    reg.register(desc("t"));
    const path = [
      ToolState.Activating,
      ToolState.Activated,
      ToolState.Deactivating,
      ToolState.Deactivated,
      ToolState.Activating,
      ToolState.Activated,
      ToolState.Disposed,
    ];
    for (const s of path) reg.setToolState("t", s);
    expect(reg.getById("t")?.state).toBe(ToolState.Disposed);
  });
});

describe("ToolRegistry — queries", () => {
  it("getAll returns all entries; getByState filters by lifecycle state", () => {
    const reg = new ToolRegistry();
    reg.register(desc("a"));
    reg.register(desc("b"));
    reg.setToolState("a", ToolState.Activating);
    expect(reg.getAll()).toHaveLength(2);
    expect(reg.getByState(ToolState.Activating).map((e) => e.description.manifest.id)).toEqual(["a"]);
    expect(reg.getByState(ToolState.Registered).map((e) => e.description.manifest.id)).toEqual(["b"]);
  });

  it("getById returns undefined for unknown IDs", () => {
    const reg = new ToolRegistry();
    expect(reg.getById("missing")).toBeUndefined();
  });

  it("getContributorsOf considers non-empty arrays and non-empty record objects only", () => {
    const reg = new ToolRegistry();
    reg.register(desc("withViews", { views: [{ id: "v1" }] }));
    reg.register(desc("emptyViews", { views: [] }));
    reg.register(desc("noContrib"));
    reg.register(desc("withMenus", { menus: { "menu/x": [{ command: "c" }] } }));
    reg.register(desc("emptyMenus", { menus: {} }));
    expect(reg.getContributorsOf("views" as any).map((e) => e.description.manifest.id)).toEqual(["withViews"]);
    expect(reg.getContributorsOf("menus" as any).map((e) => e.description.manifest.id)).toEqual(["withMenus"]);
  });
});

describe("ToolRegistry — unregister and dispose", () => {
  it("unregister force-transitions a non-disposed tool through Disposed and removes it", () => {
    const reg = new ToolRegistry();
    reg.register(desc("t"));
    const events: any[] = [];
    reg.onDidChangeToolState((e) => events.push(e));
    reg.unregister("t");
    expect(reg.has("t")).toBe(false);
    expect(events.map((e) => e.newState)).toEqual([ToolState.Disposed]);
  });

  it("unregister is a no-op for unknown IDs", () => {
    const reg = new ToolRegistry();
    expect(() => reg.unregister("nope")).not.toThrow();
  });

  it("dispose() clears all entries", () => {
    const reg = new ToolRegistry();
    reg.register(desc("a"));
    reg.register(desc("b"));
    reg.dispose();
    expect(reg.count).toBe(0);
  });
});
