/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextKeyService } from "../../src/context/contextKey";

let warnSpy: any;
beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe("ContextKeyService — keys and global scope", () => {
  it("createKey returns a handle that reads default and writes to its scope", () => {
    const svc = new ContextKeyService();
    const k = svc.createKey<boolean>("flag", false);
    expect(k.get()).toBe(false);
    k.set(true);
    expect(k.get()).toBe(true);
    expect(svc.getContextValue("flag")).toBe(true);
    k.reset();
    expect(k.get()).toBe(false);
    expect(svc.getContextValue("flag")).toBeUndefined();
  });

  it("setContext / getContextValue / removeContext on global scope", () => {
    const svc = new ContextKeyService();
    svc.setContext("foo", "bar");
    expect(svc.getContextValue("foo")).toBe("bar");
    svc.removeContext("foo");
    expect(svc.getContextValue("foo")).toBeUndefined();
  });

  it("onDidChangeContext fires for set, no-op for redundant set, fires on delete", () => {
    const svc = new ContextKeyService();
    const fired = vi.fn();
    svc.onDidChangeContext(fired);
    svc.setContext("k", 1);
    svc.setContext("k", 1); // same value → no fire
    svc.setContext("k", 2);
    svc.removeContext("k");
    svc.removeContext("k"); // no-op
    const affected = fired.mock.calls.map((c) => [...c[0].affectedKeys]);
    expect(affected).toEqual([["k"], ["k"], ["k"]]);
  });
});

describe("ContextKeyService — child scopes + inheritance", () => {
  it("child scope inherits parent values until overridden", () => {
    const svc = new ContextKeyService();
    svc.createScope("part:sidebar", "global");
    svc.setContext("vis", true);
    expect(svc.getContextValue("vis", "part:sidebar")).toBe(true);
    svc.setContextInScope("vis", false, "part:sidebar");
    expect(svc.getContextValue("vis", "part:sidebar")).toBe(false);
    expect(svc.getContextValue("vis")).toBe(true);
  });

  it("createScope warns + returns no-op disposable on duplicate", () => {
    const svc = new ContextKeyService();
    svc.createScope("x");
    const d = svc.createScope("x");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Scope already exists: x"));
    d.dispose(); // no-op
  });

  it("disposing a child scope removes it from hasScope", () => {
    const svc = new ContextKeyService();
    const d = svc.createScope("temp");
    expect(svc.hasScope("temp")).toBe(true);
    d.dispose();
    expect(svc.hasScope("temp")).toBe(false);
  });

  it("getAllContext returns merged keys from a scope and its ancestors", () => {
    const svc = new ContextKeyService();
    svc.createScope("c", "global");
    svc.setContext("a", 1);
    svc.setContextInScope("b", 2, "c");
    const all = svc.getAllContext("c");
    expect(all.get("a")).toBe(1);
    expect(all.get("b")).toBe(2);
    // global-only view does not see child-scoped 'b'
    expect(svc.getAllContext("global").has("b")).toBe(false);
  });
});

describe("ContextKeyService — evaluate / contextMatchesRules", () => {
  it("evaluate returns true for empty expressions", () => {
    const svc = new ContextKeyService();
    expect(svc.evaluate(undefined)).toBe(true);
    expect(svc.evaluate("")).toBe(true);
  });

  it("evaluate uses the scope's lookup including parent values", () => {
    const svc = new ContextKeyService();
    svc.createScope("v");
    svc.setContext("a", true); // global
    svc.setContextInScope("b", true, "v");
    expect(svc.evaluate("a && b", "v")).toBe(true);
    expect(svc.evaluate("a && b")).toBe(false); // global can't see 'b'
  });

  it("contextMatchesRules aggregates own keys across ALL scopes", () => {
    const svc = new ContextKeyService();
    svc.createScope("tool:x");
    svc.setContextInScope("toolEnabled", true, "tool:x");
    expect(svc.contextMatchesRules("toolEnabled")).toBe(true);
    expect(svc.evaluate("toolEnabled")).toBe(false); // global scope alone doesn't see child key
  });

  it("contextMatchesRules returns true for empty whenClause", () => {
    const svc = new ContextKeyService();
    expect(svc.contextMatchesRules(undefined)).toBe(true);
    expect(svc.contextMatchesRules("")).toBe(true);
  });
});

describe("ContextKeyService — dispose", () => {
  it("clears all scopes", () => {
    const svc = new ContextKeyService();
    svc.createScope("a");
    svc.dispose();
    expect(svc.hasScope("a")).toBe(false);
    expect(svc.hasScope("global")).toBe(false);
  });
});
