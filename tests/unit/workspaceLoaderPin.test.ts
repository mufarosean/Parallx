/**
 * Pin: WorkspaceLoader.load — undefined when key empty, validates shape
 * (version + identity.id + metadata + layout + arrays parts/viewContainers/views
 * + objects editors/context), discards future-version state, swallows JSON
 * parse + storage errors, returns migrated state at current schema version,
 * v1 → v2 adds folders=[].
 */
import { describe, it, expect, vi } from "vitest";
import { WorkspaceLoader } from "../../src/workspace/workspaceLoader";
import { WORKSPACE_STATE_VERSION } from "../../src/workspace/workspaceTypes";

function makeStorage(initial?: string | null) {
  return {
    get: vi.fn().mockResolvedValue(initial ?? null),
    set: vi.fn(),
    delete: vi.fn(),
  } as any;
}
function validState(overrides: any = {}) {
  return {
    version: WORKSPACE_STATE_VERSION,
    identity: { id: "ws-1" },
    metadata: {},
    layout: { version: 1, grid: {} },
    parts: [],
    viewContainers: [],
    views: [],
    editors: {},
    context: {},
    ...overrides,
  };
}

describe("workspace/workspaceLoader/WorkspaceLoader", () => {
  it("WORKSPACE_STATE_VERSION is the current pinned version (2)", () => {
    expect(WORKSPACE_STATE_VERSION).toBe(2);
  });

  it("reads from the 'workbench' storage key", async () => {
    const s = makeStorage(JSON.stringify(validState()));
    await new WorkspaceLoader(s).load();
    expect(s.get).toHaveBeenCalledWith("workbench");
  });

  it("returns undefined when storage returns null/undefined/empty", async () => {
    for (const v of [null, undefined as any, ""]) {
      const s = makeStorage(v);
      expect(await new WorkspaceLoader(s).load()).toBeUndefined();
    }
  });

  it("returns undefined when JSON parse fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await new WorkspaceLoader(makeStorage("{not-json")).load();
    expect(r).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns undefined when storage.get throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = { get: vi.fn().mockRejectedValue(new Error("boom")) } as any;
    expect(await new WorkspaceLoader(s).load()).toBeUndefined();
    errSpy.mockRestore();
  });

  it("discards state when version is non-numeric", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await new WorkspaceLoader(makeStorage(JSON.stringify(validState({ version: "x" })))).load();
    expect(r).toBeUndefined();
    warn.mockRestore();
  });

  it("discards state whose version is in the future", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await new WorkspaceLoader(makeStorage(JSON.stringify(validState({ version: WORKSPACE_STATE_VERSION + 1 })))).load();
    expect(r).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects: missing identity, identity.id empty, missing metadata, missing layout/grid, parts/views non-array, editors/context non-object", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cases = [
      validState({ identity: null }),
      validState({ identity: { id: "" } }),
      validState({ metadata: null }),
      validState({ layout: null }),
      validState({ layout: { version: 1 } /* missing grid */ }),
      validState({ layout: { version: "x", grid: {} } }),
      validState({ parts: "x" }),
      validState({ viewContainers: "x" }),
      validState({ views: "x" }),
      validState({ editors: null }),
      validState({ context: null }),
    ];
    for (const c of cases) {
      const r = await new WorkspaceLoader(makeStorage(JSON.stringify(c))).load();
      expect(r).toBeUndefined();
    }
    warn.mockRestore();
    log.mockRestore();
  });

  it("returns valid state unchanged when version === WORKSPACE_STATE_VERSION (folders preserved)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const state = validState({ folders: [{ id: "f1" }] });
    const r = await new WorkspaceLoader(makeStorage(JSON.stringify(state))).load();
    expect(r?.version).toBe(WORKSPACE_STATE_VERSION);
    expect((r as any).folders).toEqual([{ id: "f1" }]);
    log.mockRestore();
  });

  it("v1 → v2 migration: adds folders=[] when missing and updates version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const v1 = validState({ version: 1 });
    delete (v1 as any).folders;
    const r = await new WorkspaceLoader(makeStorage(JSON.stringify(v1))).load();
    expect(r?.version).toBe(WORKSPACE_STATE_VERSION);
    expect((r as any).folders).toEqual([]);
    log.mockRestore();
  });

  it("v1 → v2 migration: preserves folders when already present", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const v1 = validState({ version: 1, folders: [{ id: "f1" }] });
    const r = await new WorkspaceLoader(makeStorage(JSON.stringify(v1))).load();
    expect(r?.version).toBe(WORKSPACE_STATE_VERSION);
    expect((r as any).folders).toEqual([{ id: "f1" }]);
    log.mockRestore();
  });
});
