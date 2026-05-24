import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FileBackedGlobalStorage,
  FileBackedWorkspaceStorage,
  type IStorageBridge,
} from "../../src/platform/fileBackedStorage";

function makeBridge(initial: Record<string, unknown> | null = null) {
  const state: { data: unknown } = { data: initial };
  const writes: unknown[] = [];
  const bridge: IStorageBridge & { writes: unknown[]; failNextWrite?: string; failRead?: string } = {
    async readJson(_path: string) {
      if (bridge.failRead) return { error: bridge.failRead };
      return { data: state.data };
    },
    async writeJson(_path: string, data: unknown) {
      if (bridge.failNextWrite) {
        const err = bridge.failNextWrite;
        bridge.failNextWrite = undefined;
        return { error: err };
      }
      writes.push(data);
      state.data = data;
      return { error: null };
    },
    async exists(_path: string) {
      return state.data !== null;
    },
    writes,
  };
  return bridge;
}

async function flush(store: FileBackedGlobalStorage | FileBackedWorkspaceStorage) {
  // Wait several microtasks for _writeQueue to drain.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  // The write itself is a microtask off a then(), so a few more.
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  void store;
}

describe("FileBackedGlobalStorage", () => {
  let bridge: ReturnType<typeof makeBridge>;
  let store: FileBackedGlobalStorage;

  beforeEach(() => {
    bridge = makeBridge();
    store = new FileBackedGlobalStorage(bridge, "/global.json");
  });

  it("returns undefined for missing keys on a fresh load", async () => {
    expect(await store.get("missing")).toBeUndefined();
  });

  it("set/get round-trips through cache", async () => {
    await store.set("k", "v");
    expect(await store.get("k")).toBe("v");
  });

  it("set persists via bridge.writeJson", async () => {
    await store.set("k", "v");
    await flush(store);
    expect(bridge.writes).toHaveLength(1);
    expect(bridge.writes[0]).toEqual({ k: "v" });
  });

  it("loads existing data on first access", async () => {
    bridge = makeBridge({ a: "1", b: "2", num: 99 });
    store = new FileBackedGlobalStorage(bridge, "/g.json");
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBe("2");
    // Non-string values are filtered out
    expect(await store.get("num")).toBeUndefined();
  });

  it("ignores array payloads (treats as empty)", async () => {
    bridge = makeBridge([] as any);
    store = new FileBackedGlobalStorage(bridge, "/g.json");
    expect((await store.keys()).length).toBe(0);
  });

  it("read error fires onDidError and treats cache as empty", async () => {
    bridge = makeBridge();
    bridge.failRead = "EACCES";
    store = new FileBackedGlobalStorage(bridge, "/g.json");
    const errors: any[] = [];
    store.onDidError(e => errors.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await store.get("x")).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("EACCES");
    warn.mockRestore();
  });

  it("delete removes and persists", async () => {
    await store.set("k", "v");
    await flush(store);
    await store.delete("k");
    await flush(store);
    expect(await store.get("k")).toBeUndefined();
    expect(bridge.writes[bridge.writes.length - 1]).toEqual({});
  });

  it("has returns boolean for present/absent keys", async () => {
    await store.set("k", "v");
    expect(await store.has("k")).toBe(true);
    expect(await store.has("missing")).toBe(false);
  });

  it("keys returns all keys, or filtered by prefix", async () => {
    await store.set("a:1", "x");
    await store.set("a:2", "y");
    await store.set("b:3", "z");
    expect((await store.keys()).sort()).toEqual(["a:1", "a:2", "b:3"]);
    expect((await store.keys("a:")).sort()).toEqual(["a:1", "a:2"]);
  });

  it("clear empties the cache and persists", async () => {
    await store.set("k", "v");
    await flush(store);
    await store.clear();
    await flush(store);
    expect(await store.has("k")).toBe(false);
    expect(bridge.writes[bridge.writes.length - 1]).toEqual({});
  });

  it("write error fires onDidError; in-memory cache reflects the attempted set (snapshot semantics)", async () => {
    await store.set("a", "1");
    await flush(store);
    bridge.failNextWrite = "EIO";
    const errors: any[] = [];
    store.onDidError(e => errors.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.set("b", "2");
    await flush(store);
    // Snapshot is captured inside the flush callback, after the set already
    // mutated the live cache, so the "rollback" restores the post-set state.
    // The observable contract: onDidError fires, in-memory get still returns
    // the just-set value, and the failed write does not appear in writes[].
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBe("2");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("EIO");
    expect(bridge.writes).toHaveLength(1); // only the first successful write
    warn.mockRestore();
  });

  it("dispose disposes the error emitter (no-throw on second dispose)", () => {
    store.dispose();
    expect(() => store.dispose()).not.toThrow();
  });

  it("serializes concurrent writes", async () => {
    // Issue many writes; the bridge.writes order must reflect the insertion sequence.
    await store.set("k1", "1");
    await store.set("k2", "2");
    await store.set("k3", "3");
    await flush(store);
    // Each flush queues a write. Order is preserved.
    const last = bridge.writes[bridge.writes.length - 1] as Record<string, string>;
    expect(last).toEqual({ k1: "1", k2: "2", k3: "3" });
  });
});

describe("FileBackedWorkspaceStorage", () => {
  let bridge: ReturnType<typeof makeBridge>;
  let store: FileBackedWorkspaceStorage;

  beforeEach(() => {
    bridge = makeBridge();
    store = new FileBackedWorkspaceStorage(bridge, "/.parallx/ws.json");
  });

  it("envelope wraps writes with { version: 1, ... }", async () => {
    await store.set("k", "v");
    await flush(store);
    expect(bridge.writes[0]).toEqual({ version: 1, k: "v" });
  });

  it("strips the version key when loading existing data", async () => {
    bridge = makeBridge({ version: 1, a: "1", b: "2" });
    store = new FileBackedWorkspaceStorage(bridge, "/.parallx/ws.json");
    expect(await store.get("version")).toBeUndefined();
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBe("2");
  });

  it("ignores non-string values on load", async () => {
    bridge = makeBridge({ version: 1, num: 99, arr: [1, 2], ok: "yes" });
    store = new FileBackedWorkspaceStorage(bridge, "/ws.json");
    expect(await store.get("num")).toBeUndefined();
    expect(await store.get("arr")).toBeUndefined();
    expect(await store.get("ok")).toBe("yes");
  });

  it("array payload treated as empty", async () => {
    bridge = makeBridge([] as any);
    store = new FileBackedWorkspaceStorage(bridge, "/ws.json");
    expect((await store.keys()).length).toBe(0);
  });

  it("read error fires onDidError and treats cache as empty", async () => {
    bridge = makeBridge();
    bridge.failRead = "ENOENT";
    store = new FileBackedWorkspaceStorage(bridge, "/ws.json");
    const errors: any[] = [];
    store.onDidError(e => errors.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await store.get("x")).toBeUndefined();
    expect(errors).toHaveLength(1);
    warn.mockRestore();
  });

  it("clear preserves version envelope on next write", async () => {
    await store.set("k", "v");
    await flush(store);
    await store.clear();
    await flush(store);
    expect(bridge.writes[bridge.writes.length - 1]).toEqual({ version: 1 });
  });

  it("write error fires onDidError; in-memory cache reflects the attempted set", async () => {
    await store.set("a", "1");
    await flush(store);
    bridge.failNextWrite = "EIO";
    const errors: any[] = [];
    store.onDidError(e => errors.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.set("b", "2");
    await flush(store);
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBe("2");
    expect(errors).toHaveLength(1);
    warn.mockRestore();
  });

  it("dispose is idempotent", () => {
    store.dispose();
    expect(() => store.dispose()).not.toThrow();
  });
});
