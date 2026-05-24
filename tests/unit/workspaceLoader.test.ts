/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceLoader } from "../../src/workspace/workspaceLoader";

let warnSpy: any, errSpy: any, logSpy: any;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore(); errSpy.mockRestore(); logSpy.mockRestore();
});

function makeStorage(initial: Record<string, string | null> = {}) {
  return {
    get: vi.fn(async (k: string) => initial[k] ?? null),
  };
}

const validState = (over: any = {}) => ({
  version: 2,
  identity: { id: "ws-1" },
  metadata: {},
  layout: { version: 1, grid: {} },
  parts: [],
  viewContainers: [],
  views: [],
  editors: {},
  context: {},
  folders: [],
  ...over,
});

describe("WorkspaceLoader.load", () => {
  it("returns undefined when storage has no 'workbench' entry", async () => {
    const l = new WorkspaceLoader(makeStorage() as any);
    expect(await l.load()).toBeUndefined();
  });

  it("returns undefined and logs an error when JSON is malformed", async () => {
    const l = new WorkspaceLoader(makeStorage({ workbench: "{not-json" }) as any);
    expect(await l.load()).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns undefined when parsed value is not an object", async () => {
    const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify("string") }) as any);
    expect(await l.load()).toBeUndefined();
  });

  it("returns undefined when version is not a number", async () => {
    const bad = { ...validState(), version: "2" };
    const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(bad) }) as any);
    expect(await l.load()).toBeUndefined();
  });

  it("returns undefined when version is from the future", async () => {
    const bad = { ...validState(), version: 999 };
    const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(bad) }) as any);
    expect(await l.load()).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns undefined when identity.id is missing or empty", async () => {
    for (const bad of [
      { ...validState(), identity: {} },
      { ...validState(), identity: { id: "" } },
      { ...validState(), identity: null },
    ]) {
      const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(bad) }) as any);
      expect(await l.load()).toBeUndefined();
    }
  });

  it("returns undefined when layout shape is invalid", async () => {
    for (const bad of [
      { ...validState(), layout: null },
      { ...validState(), layout: { version: "1", grid: {} } },
      { ...validState(), layout: { version: 1, grid: null } },
    ]) {
      const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(bad) }) as any);
      expect(await l.load()).toBeUndefined();
    }
  });

  it("returns undefined when parts/viewContainers/views are not arrays", async () => {
    for (const key of ["parts", "viewContainers", "views"] as const) {
      const bad = { ...validState(), [key]: {} };
      const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(bad) }) as any);
      expect(await l.load()).toBeUndefined();
    }
  });

  it("returns undefined when editors or context are not objects", async () => {
    for (const bad of [
      { ...validState(), editors: null },
      { ...validState(), context: "not-obj" },
    ]) {
      const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(bad) }) as any);
      expect(await l.load()).toBeUndefined();
    }
  });

  it("loads a valid v2 state without modification", async () => {
    const state = validState({ identity: { id: "x" } });
    const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(state) }) as any);
    const got = await l.load();
    expect(got).toBeDefined();
    expect(got!.version).toBe(2);
    expect(got!.identity.id).toBe("x");
  });

  it("migrates v1 → v2 by adding an empty folders array", async () => {
    const v1: any = validState({ version: 1 });
    delete v1.folders;
    const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(v1) }) as any);
    const got = await l.load();
    expect(got).toBeDefined();
    expect(got!.version).toBe(2);
    expect(got!.folders).toEqual([]);
  });

  it("preserves an existing folders array during migration", async () => {
    const v1: any = validState({ version: 1, folders: [{ uri: "file:///a" }] });
    const l = new WorkspaceLoader(makeStorage({ workbench: JSON.stringify(v1) }) as any);
    const got = await l.load();
    expect(got!.folders).toEqual([{ uri: "file:///a" }]);
  });
});
