/** @vitest-environment jsdom */
/**
 * Pin tests for src/tools/toolActivator.ts.
 *
 * Pins:
 *   - Constructor wires onWillForceDeactivate from ToolErrorService → deactivate().
 *   - activate('unknown') returns false.
 *   - activate() is guarded against concurrent re-entry — second call returns same promise.
 *   - activateBuiltin('unknown') returns false.
 *   - activateBuiltin success path: calls module.activate(api, context), records
 *     ActivatedTool, transitions registry to Activated, fires onDidActivate(success).
 *   - activateBuiltin error path: caller-thrown error → state Deactivated, fires
 *     onDidActivate(success=false, error message), and disposes the API.
 *   - deactivate('unknown') returns false.
 *   - deactivate: calls module.deactivate(), disposes context.subscriptions in
 *     reverse order, disposes api, removes from activated map, fires onDidDeactivate.
 *   - deactivateAll iterates every activated id.
 *   - getActivated/getActivatedToolIds/isActivated reflect current state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const disposeApiSpy = vi.fn();
vi.mock("../../src/api/apiFactory", () => ({
  createToolApi: vi.fn(() => ({ api: { __fake: true }, dispose: disposeApiSpy })),
}));

import { ToolActivator } from "../../src/tools/toolActivator";
import { ToolRegistry, ToolState } from "../../src/tools/toolRegistry";
import { ToolErrorService } from "../../src/tools/toolErrorIsolation";
import { ActivationEventService } from "../../src/tools/activationEventService";
import type { IToolDescription } from "../../src/tools/toolManifest";

function makeDescription(id: string): IToolDescription {
  return {
    manifest: {
      manifestVersion: 1,
      id,
      name: id,
      version: "0.0.1",
      publisher: "test",
      main: "./main.js",
      activationEvents: ["*"],
      engines: { parallx: "*" } as any,
    } as any,
    toolPath: `C:/fake/${id}`,
    isBuiltin: true,
  };
}

function makeActivator() {
  const registry = new ToolRegistry();
  const errorService = new ToolErrorService();
  const events = new ActivationEventService();
  const apiDeps: any = {
    services: {} as any,
    viewManager: {} as any,
    toolRegistry: registry,
    notificationService: {} as any,
    workbenchContainer: undefined,
  };
  const activator = new ToolActivator(registry, errorService, events, apiDeps);
  return { activator, registry, errorService, events };
}

beforeEach(() => {
  disposeApiSpy.mockClear();
});

describe("tools/toolActivator — construction & queries", () => {
  it("constructs with no activated tools", () => {
    const { activator } = makeActivator();
    expect(activator.getActivatedToolIds()).toEqual([]);
    expect(activator.isActivated("x")).toBe(false);
    expect(activator.getActivated("x")).toBeUndefined();
  });

  it("exposes onDidActivate and onDidDeactivate events", () => {
    const { activator } = makeActivator();
    expect(typeof activator.onDidActivate).toBe("function");
    expect(typeof activator.onDidDeactivate).toBe("function");
  });
});

describe("tools/toolActivator — activate() guards", () => {
  it("activate('unknown') returns false", async () => {
    const { activator } = makeActivator();
    expect(await activator.activate("not-registered")).toBe(false);
  });

  it("activateBuiltin('unknown') returns false", async () => {
    const { activator } = makeActivator();
    const res = await activator.activateBuiltin("not-registered", { activate: vi.fn() });
    expect(res).toBe(false);
  });

  it("concurrent activate() calls dedupe — second call awaits the in-flight promise", async () => {
    const { activator, registry } = makeActivator();
    registry.register(makeDescription("dupe"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = activator.activate("dupe");
    const b = activator.activate("dupe");
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    // Second call should have hit the "already in flight" guard
    const guarded = warn.mock.calls.some(c => String(c[0]).includes("already in flight"));
    expect(guarded).toBe(true);
    warn.mockRestore();
  });
});

describe("tools/toolActivator — activateBuiltin success path", () => {
  it("calls module.activate, records ActivatedTool, fires onDidActivate(success)", async () => {
    const { activator, registry } = makeActivator();
    const desc = makeDescription("good");
    registry.register(desc);
    const events: any[] = [];
    activator.onDidActivate(e => events.push(e));
    const activate = vi.fn();
    const res = await activator.activateBuiltin("good", { activate });
    expect(res).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    const call = activate.mock.calls[0];
    expect(call[0]).toEqual({ __fake: true });
    expect(call[1]).toHaveProperty("subscriptions");
    expect(activator.isActivated("good")).toBe(true);
    expect(activator.getActivated("good")).toBeTruthy();
    expect(registry.getById("good")!.state).toBe(ToolState.Activated);
    expect(events.length).toBe(1);
    expect(events[0].toolId).toBe("good");
    expect(events[0].success).toBe(true);
  });

  it("activating an already-activated tool returns true without re-invoking activate()", async () => {
    const { activator, registry } = makeActivator();
    registry.register(makeDescription("again"));
    const activate = vi.fn();
    await activator.activateBuiltin("again", { activate });
    activate.mockClear();
    const res = await activator.activateBuiltin("again", { activate });
    expect(res).toBe(true);
    expect(activate).not.toHaveBeenCalled();
  });
});

describe("tools/toolActivator — activateBuiltin error path", () => {
  it("caller throw → state Deactivated, disposes api, fires onDidActivate(success=false)", async () => {
    const { activator, registry } = makeActivator();
    registry.register(makeDescription("bad"));
    const events: any[] = [];
    activator.onDidActivate(e => events.push(e));
    const res = await activator.activateBuiltin("bad", { activate: () => { throw new Error("boom"); } });
    expect(res).toBe(false);
    expect(activator.isActivated("bad")).toBe(false);
    expect(disposeApiSpy).toHaveBeenCalled();
    expect(registry.getById("bad")!.state).toBe(ToolState.Deactivated);
    expect(events[0].success).toBe(false);
    expect(events[0].error).toMatch(/boom/);
  });
});

describe("tools/toolActivator — deactivate()", () => {
  it("deactivate('unknown') returns false", async () => {
    const { activator } = makeActivator();
    expect(await activator.deactivate("missing")).toBe(false);
  });

  it("calls module.deactivate, disposes subscriptions in reverse, disposes api, fires event", async () => {
    const { activator, registry } = makeActivator();
    registry.register(makeDescription("d1"));
    const disposeOrder: number[] = [];
    const deactivate = vi.fn();
    let ctx: any;
    await activator.activateBuiltin("d1", {
      activate: (_api, context) => {
        ctx = context;
        context.subscriptions.push({ dispose: () => disposeOrder.push(1) });
        context.subscriptions.push({ dispose: () => disposeOrder.push(2) });
        context.subscriptions.push({ dispose: () => disposeOrder.push(3) });
      },
      deactivate,
    });
    disposeApiSpy.mockClear();
    const fired: any[] = [];
    activator.onDidDeactivate(e => fired.push(e));
    const res = await activator.deactivate("d1");
    expect(res).toBe(true);
    expect(deactivate).toHaveBeenCalled();
    expect(disposeOrder).toEqual([3, 2, 1]); // reverse order
    expect(disposeApiSpy).toHaveBeenCalled();
    expect(activator.isActivated("d1")).toBe(false);
    expect(registry.getById("d1")!.state).toBe(ToolState.Deactivated);
    expect(fired.length).toBe(1);
    expect(fired[0].toolId).toBe("d1");
    expect(ctx.subscriptions.length).toBe(0);
  });

  it("deactivateAll iterates every activated tool", async () => {
    const { activator, registry } = makeActivator();
    registry.register(makeDescription("a1"));
    registry.register(makeDescription("a2"));
    await activator.activateBuiltin("a1", { activate: vi.fn() });
    await activator.activateBuiltin("a2", { activate: vi.fn() });
    expect(activator.getActivatedToolIds().sort()).toEqual(["a1", "a2"]);
    await activator.deactivateAll();
    expect(activator.getActivatedToolIds()).toEqual([]);
  });
});
