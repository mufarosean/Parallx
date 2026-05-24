// workspaceGraphBridgePin.test.ts — pin workspace-graph bridge registry behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkspaceGraphBridge,
  getRegisteredGraphProviders,
  onWorkspaceGraphDidChange,
  type GraphProvider,
} from "../../src/api/bridges/workspaceGraphBridge";

function provider(id: string, nodes: any[] = [], edges: any[] = []): GraphProvider {
  return { id, snapshot: () => ({ nodes, edges }) };
}

beforeEach(() => {
  // Drain the module-global registry by disposing any leftover providers from
  // prior tests in the same vitest process.
  for (const p of getRegisteredGraphProviders()) {
    // Simulate a "purge" by registering+disposing a bridge that owns this id.
    const b = new WorkspaceGraphBridge("__cleanup", []);
    const d = b.registerProvider({ id: p.id, snapshot: () => ({ nodes: [], edges: [] }) });
    d.dispose();
    b.dispose();
  }
});

describe("WorkspaceGraphBridge", () => {
  it("registerProvider adds to the global registry and fires change", () => {
    const listener = vi.fn();
    const offD = onWorkspaceGraphDidChange(listener);
    const b = new WorkspaceGraphBridge("tool.a", []);
    b.registerProvider(provider("budget"));
    expect(getRegisteredGraphProviders().some(p => p.id === "budget")).toBe(true);
    expect(listener).toHaveBeenCalled();
    offD.dispose();
    b.dispose();
  });

  it("registerProvider rejects missing id", () => {
    const b = new WorkspaceGraphBridge("tool.a", []);
    expect(() => b.registerProvider({} as any)).toThrow(/provider\.id/);
  });

  it("disposing the returned token removes the provider and fires change", () => {
    const listener = vi.fn();
    const offD = onWorkspaceGraphDidChange(listener);
    const b = new WorkspaceGraphBridge("tool.a", []);
    const d = b.registerProvider(provider("media"));
    listener.mockClear();
    d.dispose();
    expect(getRegisteredGraphProviders().some(p => p.id === "media")).toBe(false);
    expect(listener).toHaveBeenCalled();
    offD.dispose();
    b.dispose();
  });

  it("notifyChange fires global listeners", () => {
    const listener = vi.fn();
    const offD = onWorkspaceGraphDidChange(listener);
    const b = new WorkspaceGraphBridge("tool.a", []);
    listener.mockClear();
    b.notifyChange();
    expect(listener).toHaveBeenCalledTimes(1);
    offD.dispose();
    b.dispose();
  });

  it("onDidChange subscription is added to tool subscriptions for cleanup", () => {
    const subs: any[] = [];
    const b = new WorkspaceGraphBridge("tool.a", subs);
    const d = b.onDidChange(() => {});
    expect(subs).toContain(d);
    b.dispose();
  });

  it("getAll returns all registered providers", () => {
    const b = new WorkspaceGraphBridge("tool.a", []);
    b.registerProvider(provider("p1"));
    b.registerProvider(provider("p2"));
    const ids = b.getAll().map(p => p.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    b.dispose();
  });

  it("dispose removes all providers owned by the tool", () => {
    const b = new WorkspaceGraphBridge("tool.a", []);
    b.registerProvider(provider("p1"));
    b.registerProvider(provider("p2"));
    b.dispose();
    expect(getRegisteredGraphProviders().some(p => p.id === "p1")).toBe(false);
    expect(getRegisteredGraphProviders().some(p => p.id === "p2")).toBe(false);
  });

  it("dispose does NOT remove providers owned by a different tool", () => {
    const a = new WorkspaceGraphBridge("tool.a", []);
    const b = new WorkspaceGraphBridge("tool.b", []);
    a.registerProvider(provider("shared-a"));
    b.registerProvider(provider("shared-b"));
    a.dispose();
    expect(getRegisteredGraphProviders().some(p => p.id === "shared-b")).toBe(true);
    expect(getRegisteredGraphProviders().some(p => p.id === "shared-a")).toBe(false);
    b.dispose();
  });

  it("after dispose, registerProvider / notifyChange / onDidChange / getAll throw", () => {
    const b = new WorkspaceGraphBridge("tool.x", []);
    b.dispose();
    expect(() => b.registerProvider(provider("x"))).toThrow(/tool.x/);
    expect(() => b.notifyChange()).toThrow(/tool.x/);
    expect(() => b.onDidChange(() => {})).toThrow(/tool.x/);
    expect(() => b.getAll()).toThrow(/tool.x/);
  });

  it("re-registering the same id replaces the previous entry (no double-listing)", () => {
    const b = new WorkspaceGraphBridge("tool.a", []);
    b.registerProvider(provider("dup"));
    b.registerProvider(provider("dup"));
    expect(getRegisteredGraphProviders().filter(p => p.id === "dup").length).toBe(1);
    b.dispose();
  });
});
