import { describe, it, expect } from "vitest";
import {
  NamespacedStorage,
  NamespacedSyncStorage,
  InMemoryStorage,
} from "../../src/platform/storage";

describe("InMemoryStorage — async", () => {
  it("set/get round-trips a string value", async () => {
    const s = new InMemoryStorage();
    await s.set("a", "1");
    expect(await s.get("a")).toBe("1");
  });

  it("get returns undefined for missing keys", async () => {
    const s = new InMemoryStorage();
    expect(await s.get("nope")).toBeUndefined();
  });

  it("delete removes the key; has reflects the change", async () => {
    const s = new InMemoryStorage();
    await s.set("a", "1");
    expect(await s.has("a")).toBe(true);
    await s.delete("a");
    expect(await s.has("a")).toBe(false);
    expect(await s.get("a")).toBeUndefined();
  });

  it("keys(prefix) filters; keys() returns all", async () => {
    const s = new InMemoryStorage();
    await s.set("ns:a", "1");
    await s.set("ns:b", "2");
    await s.set("other:c", "3");
    expect((await s.keys("ns:")).sort()).toEqual(["ns:a", "ns:b"]);
    expect((await s.keys()).sort()).toEqual(["ns:a", "ns:b", "other:c"]);
  });

  it("clear() removes every entry", async () => {
    const s = new InMemoryStorage();
    await s.set("a", "1");
    await s.set("b", "2");
    await s.clear();
    expect(await s.keys()).toEqual([]);
  });
});

describe("InMemoryStorage — sync", () => {
  it("sync API shares the same backing store as async", async () => {
    const s = new InMemoryStorage();
    s.setSync("a", "1");
    expect(await s.get("a")).toBe("1");
    await s.set("b", "2");
    expect(s.getSync("b")).toBe("2");
  });

  it("hasSync/deleteSync/clearSync mirror the async behaviour", () => {
    const s = new InMemoryStorage();
    s.setSync("a", "1");
    expect(s.hasSync("a")).toBe(true);
    s.deleteSync("a");
    expect(s.hasSync("a")).toBe(false);
    s.setSync("b", "2");
    s.clearSync();
    expect(s.keysSync()).toEqual([]);
  });

  it("keysSync(prefix) filters by prefix", () => {
    const s = new InMemoryStorage();
    s.setSync("ns:a", "1");
    s.setSync("ns:b", "2");
    s.setSync("zz", "3");
    expect(s.keysSync("ns:").sort()).toEqual(["ns:a", "ns:b"]);
  });
});

describe("NamespacedStorage", () => {
  it("set/get prefixes keys with '<namespace>:' on the inner store", async () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedStorage(inner, "tool");
    await ns.set("k", "v");
    expect(await inner.get("tool:k")).toBe("v");
    expect(await ns.get("k")).toBe("v");
  });

  it("delete and has operate on the prefixed key only", async () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedStorage(inner, "tool");
    await ns.set("k", "v");
    await inner.set("other:k", "x");
    await ns.delete("k");
    expect(await ns.has("k")).toBe(false);
    expect(await inner.get("other:k")).toBe("x"); // outside namespace untouched
  });

  it("keys() returns un-prefixed names within the namespace", async () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedStorage(inner, "tool");
    await ns.set("a", "1");
    await ns.set("b", "2");
    await inner.set("other:c", "3");
    expect((await ns.keys()).sort()).toEqual(["a", "b"]);
  });

  it("keys(prefix) scopes further within the namespace", async () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedStorage(inner, "tool");
    await ns.set("pfx:a", "1");
    await ns.set("pfx:b", "2");
    await ns.set("other", "3");
    expect((await ns.keys("pfx:")).sort()).toEqual(["pfx:a", "pfx:b"]);
  });

  it("clear() removes only the namespace's entries", async () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedStorage(inner, "tool");
    await ns.set("a", "1");
    await inner.set("other:b", "2");
    await ns.clear();
    expect(await ns.keys()).toEqual([]);
    expect(await inner.get("other:b")).toBe("2");
  });

  it("onDidError is delegated to the inner store", () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedStorage(inner, "tool");
    // InMemoryStorage doesn't expose onDidError → propagation is undefined.
    expect(ns.onDidError).toBe(inner.onDidError);
  });
});

describe("NamespacedSyncStorage", () => {
  it("prefixes sync set/get and filters keysSync to the namespace", () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedSyncStorage(inner, "tool");
    ns.setSync("a", "1");
    expect(inner.getSync("tool:a")).toBe("1");
    expect(ns.getSync("a")).toBe("1");
    inner.setSync("other:b", "2");
    expect(ns.keysSync()).toEqual(["a"]);
  });

  it("clearSync removes only namespace entries", () => {
    const inner = new InMemoryStorage();
    const ns = new NamespacedSyncStorage(inner, "tool");
    ns.setSync("a", "1");
    inner.setSync("other:b", "2");
    ns.clearSync();
    expect(ns.keysSync()).toEqual([]);
    expect(inner.getSync("other:b")).toBe("2");
  });
});
