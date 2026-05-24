/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/indexing-log/main.ts activate() — invariant guards.
 *
 * Pins (with no services registered):
 *   - registers exactly one view: 'view.indexingLog'
 *   - registers exactly two commands: 'indexingLog.clear', 'indexingLog.toggleErrorFilter'
 *   - subscriptions length === 4 (rebind timer cleanup + view + 2 commands)
 *   - clear command does not throw
 *   - toggleErrorFilter command does not throw
 *   - schedules a polling rebind timer (1000ms)
 *   - createView attaches `.indexing-log-container` and a header to the container
 *   - deactivate() does not throw
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { activate, deactivate } from "../../src/built-in/indexing-log/main";

function makeApi() {
  const viewRegs: Array<{ id: string; provider: any; options: any }> = [];
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];

  const api = {
    views: {
      registerViewProvider(id: string, provider: any, options: any) {
        viewRegs.push({ id, provider, options });
        return { dispose() {} };
      },
    },
    commands: {
      registerCommand(id: string, handler: (...a: unknown[]) => unknown) {
        cmdRegs.push({ id, handler });
        return { dispose() {} };
      },
    },
    services: {
      has(_id: any) { return false; },
      get<T>(_id: any): T { throw new Error("service not registered"); },
    },
  };

  return { api, viewRegs, cmdRegs };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get() { return undefined; }, update() {} },
    workspaceState: { get() { return undefined; }, update() {} },
    toolPath: "/tmp/il",
    toolUri: "file:///tmp/il",
    environmentVariableCollection: {},
  } as any;
}

describe("built-in/indexing-log activate — without services", () => {
  beforeEach(() => {
    deactivate();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    deactivate();
  });

  it("registers exactly one view: 'view.indexingLog'", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());
    expect(viewRegs.length).toBe(1);
    expect(viewRegs[0].id).toBe("view.indexingLog");
  });

  it("registers exactly two commands: clear + toggleErrorFilter", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const ids = cmdRegs.map((r) => r.id).sort();
    expect(ids).toEqual(["indexingLog.clear", "indexingLog.toggleErrorFilter"]);
  });

  it("pushes exactly 4 subscriptions (rebind cleanup + view + 2 commands)", () => {
    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(4);
  });

  it("'indexingLog.clear' handler does not throw", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "indexingLog.clear")!;
    expect(() => cmd.handler()).not.toThrow();
  });

  it("'indexingLog.toggleErrorFilter' handler does not throw", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "indexingLog.toggleErrorFilter")!;
    expect(() => cmd.handler()).not.toThrow();
  });

  it("createView attaches `.indexing-log-container` and a header element", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    expect(container.classList.contains("indexing-log-container")).toBe(true);
    expect(container.querySelector(".indexing-log-header")).toBeTruthy();

    view.dispose();
  });

  it("schedules a polling rebind timer (advancing 1000ms re-queries services.has)", () => {
    const { api } = makeApi();
    const hasSpy = vi.spyOn(api.services, "has");
    activate(api as any, makeContext());
    const before = hasSpy.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(hasSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("deactivate() does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
