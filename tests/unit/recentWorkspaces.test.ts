/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { RecentWorkspaces } from "../../src/workspace/recentWorkspaces";

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    _store: store,
  };
}

function makeWs(id: string, path = `/path/${id}`): any {
  return {
    id,
    identity: { id, path: undefined },
    folders: [{ uri: { fsPath: path } }],
    metadata: { name: id },
    touch: vi.fn(),
  };
}

describe("RecentWorkspaces", () => {
  it("getAll() returns [] when storage is empty", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    expect(await r.getAll()).toEqual([]);
  });

  it("getAll() returns [] when stored JSON is malformed", async () => {
    const s = makeStorage({ recentWorkspaces: "not-json" });
    const r = new RecentWorkspaces(s as any);
    expect(await r.getAll()).toEqual([]);
  });

  it("getAll() returns [] when stored value is not an array", async () => {
    const s = makeStorage({ recentWorkspaces: JSON.stringify({}) });
    const r = new RecentWorkspaces(s as any);
    expect(await r.getAll()).toEqual([]);
  });

  it("add() prepends the workspace and calls touch()", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    const ws = makeWs("a");
    await r.add(ws);
    expect(ws.touch).toHaveBeenCalled();
    const all = await r.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].identity.id).toBe("a");
    expect(all[0].identity.path).toBe("/path/a");
  });

  it("add() moves an existing workspace to the front", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    await r.add(makeWs("a"));
    await r.add(makeWs("b"));
    await r.add(makeWs("a"));
    const all = await r.getAll();
    expect(all.map((e) => e.identity.id)).toEqual(["a", "b"]);
  });

  it("add() trims to maxSize (most recent kept)", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any, 3);
    await r.add(makeWs("a"));
    await r.add(makeWs("b"));
    await r.add(makeWs("c"));
    await r.add(makeWs("d"));
    const all = await r.getAll();
    expect(all.map((e) => e.identity.id)).toEqual(["d", "c", "b"]);
  });

  it("add() preserves an explicit identity.path over the folder fallback", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    const ws = makeWs("a", "/folder");
    ws.identity.path = "/explicit";
    await r.add(ws);
    const [first] = await r.getAll();
    expect(first.identity.path).toBe("/explicit");
  });

  it("remove() drops the matching id", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    await r.add(makeWs("a"));
    await r.add(makeWs("b"));
    await r.remove("a");
    expect((await r.getAll()).map((e) => e.identity.id)).toEqual(["b"]);
  });

  it("remove() is a no-op for an unknown id", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    await r.add(makeWs("a"));
    await r.remove("missing");
    expect((await r.getAll()).map((e) => e.identity.id)).toEqual(["a"]);
  });

  it("clear() removes the storage key", async () => {
    const s = makeStorage({ recentWorkspaces: JSON.stringify([{ identity: { id: "a" } }]) });
    const r = new RecentWorkspaces(s as any);
    await r.clear();
    expect(s.delete).toHaveBeenCalledWith("recentWorkspaces");
    expect(await r.getAll()).toEqual([]);
  });

  it("count() returns the current list length", async () => {
    const s = makeStorage();
    const r = new RecentWorkspaces(s as any);
    expect(await r.count()).toBe(0);
    await r.add(makeWs("a"));
    await r.add(makeWs("b"));
    expect(await r.count()).toBe(2);
  });
});
