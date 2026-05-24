/**
 * Pin: ContextKeyService — scope creation/inheritance, key get/set/reset
 * with default, setContext / setContextInScope / getContextValue /
 * removeContext / getAllContext, createLookup, evaluate(undefined→true),
 * contextMatchesRules aggregates own keys across all scopes, onDidChangeContext
 * fires affectedKeys on set/delete, no-op on same value, scope dispose
 * removes from registry, duplicate scope warns + returns inert disposable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextKeyService } from "../../src/context/contextKey";

describe("context/contextKey/ContextKeyService", () => {
  let svc: ContextKeyService;
  beforeEach(() => { svc = new ContextKeyService(); });

  it("global scope always exists; createScope adds child; hasScope reflects state", () => {
    expect(svc.hasScope("global")).toBe(true);
    expect(svc.hasScope("part:sidebar")).toBe(false);
    const d = svc.createScope("part:sidebar");
    expect(svc.hasScope("part:sidebar")).toBe(true);
    d.dispose();
    expect(svc.hasScope("part:sidebar")).toBe(false);
  });

  it("duplicate scope id warns + returns inert disposable that does NOT remove existing scope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    svc.createScope("dup");
    const d2 = svc.createScope("dup");
    expect(warn).toHaveBeenCalled();
    d2.dispose(); // should not nuke the real scope
    expect(svc.hasScope("dup")).toBe(true);
    warn.mockRestore();
  });

  it("createKey returns defaultValue when unset, then reflects set/reset", () => {
    const k = svc.createKey<string>("foo", "default");
    expect(k.get()).toBe("default");
    k.set("hello");
    expect(k.get()).toBe("hello");
    k.reset();
    expect(k.get()).toBe("default");
  });

  it("set fires onDidChangeContext with affectedKeys=Set([key]); same-value is a no-op", () => {
    const events: any[] = [];
    svc.onDidChangeContext(e => events.push(e));
    const k = svc.createKey<number>("x", 0);
    k.set(1);
    expect(events).toHaveLength(1);
    expect(events[0].affectedKeys.has("x")).toBe(true);
    k.set(1); // no-op
    expect(events).toHaveLength(1);
    k.reset(); // delete
    expect(events).toHaveLength(2);
  });

  it("child scope inherits from parent; child's own value shadows parent", () => {
    const d = svc.createScope("child");
    svc.setContext("k", "parentV");
    expect(svc.getContextValue("k", "child")).toBe("parentV");
    svc.setContextInScope("k", "childV", "child");
    expect(svc.getContextValue("k", "child")).toBe("childV");
    expect(svc.getContextValue("k", "global")).toBe("parentV");
    d.dispose();
  });

  it("removeContext deletes the key only at that scope; getAllContext returns flat snapshot inherited from parent", () => {
    svc.createScope("c");
    svc.setContext("a", 1);
    svc.setContextInScope("b", 2, "c");
    const m = svc.getAllContext("c");
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(2);
    svc.removeContext("b", "c");
    expect(svc.getContextValue("b", "c")).toBeUndefined();
  });

  it("unknown scope falls back to global for setContextInScope/getContextValue/getAllContext/createLookup", () => {
    svc.setContextInScope("x", 7, "missing");
    expect(svc.getContextValue("x", "global")).toBe(7);
    expect(svc.createLookup("missing")("x")).toBe(7);
    expect(svc.getAllContext("missing").get("x")).toBe(7);
  });

  it("createLookup returns a function that resolves keys via the named scope (inherits parent)", () => {
    const d = svc.createScope("s");
    svc.setContext("g", "G");
    svc.setContextInScope("c", "C", "s");
    const look = svc.createLookup("s");
    expect(look("g")).toBe("G");
    expect(look("c")).toBe("C");
    expect(look("missing")).toBeUndefined();
    d.dispose();
  });

  it("evaluate(undefined|'') always returns true; evaluate(non-empty) routes through whenClause", () => {
    expect(svc.evaluate(undefined)).toBe(true);
    expect(svc.evaluate("")).toBe(true);
    svc.setContext("foo", true);
    expect(svc.evaluate("foo")).toBe(true);
    expect(svc.evaluate("!foo")).toBe(false);
  });

  it("contextMatchesRules aggregates own keys across ALL scopes (child-scope key visible in global evaluation)", () => {
    svc.createScope("tool:x");
    svc.setContextInScope("toolX.enabled", true, "tool:x");
    expect(svc.contextMatchesRules("toolX.enabled")).toBe(true);
    expect(svc.contextMatchesRules(undefined)).toBe(true);
    expect(svc.contextMatchesRules("!toolX.enabled")).toBe(false);
  });

  it("dispose() clears all scopes; subsequent hasScope returns false", () => {
    svc.createScope("a");
    expect(svc.hasScope("a")).toBe(true);
    svc.dispose();
    expect(svc.hasScope("a")).toBe(false);
    expect(svc.hasScope("global")).toBe(false);
  });
});
