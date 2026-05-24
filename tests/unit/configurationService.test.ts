/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { ConfigurationService } from "../../src/configuration/configurationService";
import { ConfigurationRegistry } from "../../src/configuration/configurationRegistry";

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

describe("ConfigurationService — read / default fallback", () => {
  it("getConfiguration returns explicit value over default", async () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("tool", "Tool", { "tool.x": { type: "number", default: 1 } });
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    await svc.load();
    const cfg = svc.getConfiguration("tool");
    expect(cfg.get("x")).toBe(1); // default
    await cfg.update("x", 42);
    expect(cfg.get("x")).toBe(42); // explicit beats default
  });

  it("getConfiguration falls back to caller-provided default when no schema and no explicit", () => {
    const reg = new ConfigurationRegistry();
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    expect(svc.getConfiguration("tool").get("missing", "fallback")).toBe("fallback");
    expect(svc.getConfiguration().get("absolute", 7)).toBe(7);
  });

  it("getConfiguration() without section gives absolute keys", async () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("ns", "NS", { "ns.k": { type: "string", default: "d" } });
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    expect(svc.getConfiguration().get("ns.k")).toBe("d");
  });

  it("has() is true for keys with explicit value or registered schema, false otherwise", () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("t", "T", { "t.k": { type: "string", default: "d" } });
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    const cfg = svc.getConfiguration("t");
    expect(cfg.has("k")).toBe(true);
    expect(cfg.has("other")).toBe(false);
  });
});

describe("ConfigurationService — write / events", () => {
  it("update persists JSON-encoded value to storage with the CONFIG_STORAGE_PREFIX", async () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("t", "T", { "t.k": { type: "string", default: "d" } });
    const storage = fakeStorage();
    const svc = new ConfigurationService(storage as any, reg);
    await svc.getConfiguration("t").update("k", "hello");
    expect(storage.map.get("config:t.k")).toBe(JSON.stringify("hello"));
  });

  it("update fires onDidChangeConfiguration with the affected key and matching predicate", async () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("t", "T", { "t.k": { type: "string", default: "d" } });
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    const events: any[] = [];
    svc.onDidChangeConfiguration((e) => events.push(e));
    await svc.getConfiguration("t").update("k", "v");
    const last = events[events.length - 1];
    expect(last.affectedKeys).toEqual(["t.k"]);
    expect(last.affectsConfiguration("t.k")).toBe(true);
    expect(last.affectsConfiguration("t")).toBe(true); // parent
    expect(last.affectsConfiguration("t.k.sub")).toBe(true); // child
    expect(last.affectsConfiguration("other")).toBe(false);
  });

  it("update(value=null|undefined) clears the explicit value and removes from storage", async () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("t", "T", { "t.k": { type: "number", default: 5 } });
    const storage = fakeStorage();
    const svc = new ConfigurationService(storage as any, reg);
    const cfg = svc.getConfiguration("t");
    await cfg.update("k", 9);
    expect(cfg.get("k")).toBe(9);
    await cfg.update("k", null as any);
    expect(cfg.get("k")).toBe(5); // back to default
    expect(storage.map.has("config:t.k")).toBe(false);
  });
});

describe("ConfigurationService — load", () => {
  it("load() restores prefixed entries from storage into the in-memory cache", async () => {
    const storage = fakeStorage();
    storage.map.set("config:a.b", JSON.stringify({ deep: true }));
    storage.map.set("ignore:c", "x");
    storage.map.set("config:n", JSON.stringify(7));
    const svc = new ConfigurationService(storage as any, new ConfigurationRegistry());
    await svc.load();
    expect(svc.getConfiguration().get("a.b")).toEqual({ deep: true });
    expect(svc.getConfiguration().get("n")).toBe(7);
  });

  it("load() is idempotent (second call is a no-op)", async () => {
    const storage = fakeStorage();
    storage.map.set("config:k", JSON.stringify(1));
    const svc = new ConfigurationService(storage as any, new ConfigurationRegistry());
    await svc.load();
    storage.map.set("config:k", JSON.stringify(999));
    await svc.load();
    expect(svc.getConfiguration().get("k")).toBe(1); // first load still wins
  });

  it("load() skips and warns on corrupt JSON", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = fakeStorage();
    storage.map.set("config:bad", "{not json");
    storage.map.set("config:good", JSON.stringify(42));
    const svc = new ConfigurationService(storage as any, new ConfigurationRegistry());
    await svc.load();
    expect(svc.getConfiguration().get("good")).toBe(42);
    expect(svc.getConfiguration().get("bad")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt config entry"));
    warnSpy.mockRestore();
  });
});

describe("ConfigurationService — schema delegation + registry events", () => {
  it("registerSchema/unregisterTool/getDefault/hasSchema delegate to the registry", () => {
    const reg = new ConfigurationRegistry();
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    const d = svc.registerSchema("toolA", "A", { "toolA.k": { type: "string", default: "hi" } });
    expect(svc.hasSchema("toolA.k")).toBe(true);
    expect(svc.getDefault("toolA.k")).toBe("hi");
    expect(svc.getAllSchemas().some((s) => s.key === "toolA.k")).toBe(true);
    d.dispose();
    expect(svc.hasSchema("toolA.k")).toBe(false);
  });

  it("registry schema changes fan out as configuration change events", () => {
    const reg = new ConfigurationRegistry();
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    const events: any[] = [];
    svc.onDidChangeConfiguration((e) => events.push(e));
    reg.registerProperties("t", "T", { "t.k": { type: "string", default: "d" } });
    const last = events[events.length - 1];
    expect(last.affectedKeys).toEqual(["t.k"]);
    expect(last.affectsConfiguration("t")).toBe(true);
  });

  it("update warns but still writes when value fails schema validation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reg = new ConfigurationRegistry();
    reg.registerProperties("t", "T", { "t.n": { type: "number", default: 0 } });
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    await svc.getConfiguration("t").update("n", "not-a-number" as any);
    expect(warnSpy).toHaveBeenCalled();
    expect(svc.getConfiguration("t").get("n")).toBe("not-a-number");
    warnSpy.mockRestore();
  });
});

describe("ConfigurationService — dispose", () => {
  it("clears the in-memory value cache", async () => {
    const reg = new ConfigurationRegistry();
    reg.registerProperties("t", "T", { "t.k": { type: "string", default: "d" } });
    const svc = new ConfigurationService(fakeStorage() as any, reg);
    await svc.getConfiguration("t").update("k", "v");
    expect(svc.getConfiguration("t").get("k")).toBe("v");
    svc.dispose();
    expect(svc.getConfiguration("t").get("k")).toBe("d"); // back to default
  });
});
