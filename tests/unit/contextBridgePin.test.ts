// contextBridgePin.test.ts — pin ContextBridge tool-scoped context-key surface.

import { describe, it, expect, vi } from "vitest";
import { ContextBridge } from "../../src/api/bridges/contextBridge";

function makeService() {
  const values = new Map<string, any>();
  const keys = new Map<string, { defaultValue: any; scopeId?: string }>();
  const scopes = new Set<string>();
  const service: any = {
    createScope: vi.fn((id: string) => {
      scopes.add(id);
      return { dispose: () => scopes.delete(id) };
    }),
    createKey: vi.fn((name: string, defaultValue: any, scopeId?: string) => {
      keys.set(name, { defaultValue, scopeId });
      values.set(name, defaultValue);
      return {
        get: () => values.get(name),
        set: (v: any) => { values.set(name, v); },
        reset: () => { values.set(name, defaultValue); },
      };
    }),
    getContextValue: vi.fn((name: string, _scopeId?: string) => values.get(name)),
  };
  return { service, values, keys, scopes };
}

describe("ContextBridge", () => {
  it("constructor creates a tool-scoped context scope", () => {
    const { service, scopes } = makeService();
    new ContextBridge("tool.foo", service, []);
    expect(service.createScope).toHaveBeenCalledWith("tool:tool.foo");
    expect(scopes.has("tool:tool.foo")).toBe(true);
  });

  it("createContextKey prefixes the key with the tool id", () => {
    const { service, keys } = makeService();
    const b = new ContextBridge("tool.foo", service, []);
    const k = b.createContextKey("ready", false);
    expect(k.key).toBe("tool.foo.ready");
    expect(keys.has("tool.foo.ready")).toBe(true);
    expect(keys.get("tool.foo.ready")?.scopeId).toBe("tool:tool.foo");
    expect(keys.get("tool.foo.ready")?.defaultValue).toBe(false);
  });

  it("get/set/reset round-trip through the underlying handle", () => {
    const { service } = makeService();
    const b = new ContextBridge("tool.foo", service, []);
    const k = b.createContextKey<number>("count", 0);
    expect(k.get()).toBe(0);
    k.set(42);
    expect(k.get()).toBe(42);
    k.reset();
    expect(k.get()).toBe(0);
  });

  it("getContextValue delegates to the service with the tool scope", () => {
    const { service } = makeService();
    const b = new ContextBridge("tool.foo", service, []);
    b.createContextKey("flag", true);
    b.getContextValue("tool.foo.flag");
    expect(service.getContextValue).toHaveBeenCalledWith("tool.foo.flag", "tool:tool.foo");
  });

  it("dispose resets every key and disposes the scope", () => {
    const { service, values, scopes } = makeService();
    const b = new ContextBridge("tool.foo", service, []);
    const k = b.createContextKey("v", "a");
    k.set("b");
    expect(values.get("tool.foo.v")).toBe("b");
    b.dispose();
    expect(values.get("tool.foo.v")).toBe("a");
    expect(scopes.has("tool:tool.foo")).toBe(false);
  });

  it("after dispose, createContextKey and getContextValue throw", () => {
    const { service } = makeService();
    const b = new ContextBridge("tool.foo", service, []);
    b.dispose();
    expect(() => b.createContextKey("k", 0)).toThrow(/tool.foo/);
    expect(() => b.getContextValue("k")).toThrow(/tool.foo/);
  });
});
