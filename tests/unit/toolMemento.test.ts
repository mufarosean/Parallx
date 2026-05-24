/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { ToolMemento, createToolMementos } from "../../src/configuration/toolMemento";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    async get(k: string) { return map.get(k); },
    async set(k: string, v: string) { map.set(k, v); },
    async delete(k: string) { map.delete(k); },
    async has(k: string) { return map.has(k); },
    async keys(prefix?: string) {
      return [...map.keys()].filter((k) => !prefix || k.startsWith(prefix));
    },
    async clear() { map.clear(); },
  };
}

describe("ToolMemento — read/write/delete on global scope", () => {
  it("returns undefined for unknown keys and the provided default otherwise", async () => {
    const m = new ToolMemento(fakeStorage() as any, "t", "global");
    await m.load();
    expect(m.get("missing")).toBeUndefined();
    expect(m.get("missing", "fallback")).toBe("fallback");
  });

  it("update persists JSON and get reads it back from the cache", async () => {
    const s = fakeStorage();
    const m = new ToolMemento(s as any, "t", "global");
    await m.load();
    await m.update("k", { hi: 1 });
    expect(m.get<any>("k")).toEqual({ hi: 1 });
    expect(s.map.get("tool-global:t/k")).toBe(JSON.stringify({ hi: 1 }));
  });

  it("update(value=undefined) deletes the entry from cache and storage", async () => {
    const s = fakeStorage();
    const m = new ToolMemento(s as any, "t", "global");
    await m.load();
    await m.update("k", "v");
    await m.update("k", undefined);
    expect(m.get("k")).toBeUndefined();
    expect(s.map.has("tool-global:t/k")).toBe(false);
  });

  it("update throws a descriptive error for non-JSON-serializable values", async () => {
    const m = new ToolMemento(fakeStorage() as any, "t", "global");
    await m.load();
    const cyc: any = {};
    cyc.self = cyc;
    await expect(m.update("bad", cyc)).rejects.toThrow(/not JSON-serializable/);
  });

  it("keys() returns the cached keys for this tool without the namespace prefix", async () => {
    const m = new ToolMemento(fakeStorage() as any, "t", "global");
    await m.load();
    await m.update("a", 1);
    await m.update("b", 2);
    expect([...m.keys()].sort()).toEqual(["a", "b"]);
  });
});

describe("ToolMemento — load / flush / clear", () => {
  it("load() restores values written by a prior session into the cache", async () => {
    const s = fakeStorage();
    s.map.set("tool-global:t/x", JSON.stringify(123));
    const m = new ToolMemento(s as any, "t", "global");
    await m.load();
    expect(m.get<number>("x")).toBe(123);
  });

  it("load() is idempotent — second call does not re-read storage", async () => {
    const s = fakeStorage();
    s.map.set("tool-global:t/x", JSON.stringify(1));
    const m = new ToolMemento(s as any, "t", "global");
    await m.load();
    s.map.set("tool-global:t/x", JSON.stringify(999));
    await m.load();
    expect(m.get<number>("x")).toBe(1);
  });

  it("load() warns and skips entries with corrupt JSON", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = fakeStorage();
    s.map.set("tool-global:t/bad", "{not json");
    s.map.set("tool-global:t/good", JSON.stringify(2));
    const m = new ToolMemento(s as any, "t", "global");
    await m.load();
    expect(m.get<number>("good")).toBe(2);
    expect(m.get("bad")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipping corrupt entry"));
    warn.mockRestore();
  });

  it("clear() removes every key for this tool from cache and storage", async () => {
    const s = fakeStorage();
    const m = new ToolMemento(s as any, "t", "global");
    const other = new ToolMemento(s as any, "other", "global");
    await m.load();
    await other.load();
    await m.update("a", 1);
    await other.update("a", 1);
    await m.clear();
    expect(m.get("a")).toBeUndefined();
    expect(s.map.has("tool-global:t/a")).toBe(false);
    expect(other.get<number>("a")).toBe(1); // unaffected
  });

  it("flush() rewrites the entire cache back into storage", async () => {
    const s = fakeStorage();
    const m = new ToolMemento(s as any, "t", "global");
    await m.load();
    await m.update("k", { v: 1 });
    s.map.delete("tool-global:t/k");
    await m.flush();
    expect(s.map.get("tool-global:t/k")).toBe(JSON.stringify({ v: 1 }));
  });
});

describe("ToolMemento — namespace prefixes", () => {
  it("global scope uses tool-global:<toolId>/ prefix", async () => {
    const s = fakeStorage();
    const m = new ToolMemento(s as any, "myTool", "global");
    await m.load();
    await m.update("k", 1);
    expect([...s.map.keys()][0]).toBe("tool-global:myTool/k");
  });

  it("workspace scope uses tool-ws:<toolId>:<workspaceId>/ prefix and falls back to __default__", async () => {
    const s = fakeStorage();
    const m1 = new ToolMemento(s as any, "t", "workspace");
    await m1.load();
    await m1.update("k", 1);
    expect([...s.map.keys()][0]).toBe("tool-ws:t:__default__/k");

    const s2 = fakeStorage();
    const m2 = new ToolMemento(s2 as any, "t", "workspace", () => "ws-9");
    await m2.load();
    await m2.update("k", 1);
    expect([...s2.map.keys()][0]).toBe("tool-ws:t:ws-9/k");
  });
});

describe("ToolMemento — quota enforcement", () => {
  it("update rejects values that would exceed the 10MB hard quota", async () => {
    const m = new ToolMemento(fakeStorage() as any, "t", "global");
    await m.load();
    const huge = "x".repeat(10 * 1024 * 1024 + 100);
    await expect(m.update("k", huge)).rejects.toThrow(/quota exceeded/i);
  });

  it("update warns the first time the 5MB soft threshold is crossed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = new ToolMemento(fakeStorage() as any, "t", "global");
    await m.load();
    const big = "x".repeat(6 * 1024 * 1024);
    await m.update("k", big);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("warning threshold"));
    warn.mockRestore();
  });
});

describe("createToolMementos", () => {
  it("returns a globalState + workspaceState pair scoped to the same tool", async () => {
    const s = fakeStorage();
    const { globalState, workspaceState } = createToolMementos(s as any, s as any, "tool", () => "ws-1");
    await globalState.load();
    await workspaceState.load();
    await globalState.update("k", "g");
    await workspaceState.update("k", "w");
    expect(globalState.get<string>("k")).toBe("g");
    expect(workspaceState.get<string>("k")).toBe("w");
    expect([...s.map.keys()].sort()).toEqual(["tool-global:tool/k", "tool-ws:tool:ws-1/k"]);
  });
});
