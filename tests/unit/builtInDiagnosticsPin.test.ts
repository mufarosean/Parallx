/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/diagnostics/main.ts activate() — invariant guards.
 *
 * Pins (with no diagnostics service registered → no startup async, no timer):
 *   - registers exactly one view: 'view.diagnostics'
 *   - registers exactly one command: 'diagnostics.runChecks'
 *   - subscriptions length === 2 (view + command) when service absent
 *   - command handler is a no-op (no throw) when service absent
 *   - createView attaches header + status + list to the container
 *   - empty-state message rendered when no results
 *
 * Pins (with diagnostics service registered):
 *   - subscribes to onDidChange (subscription count === 3)
 *   - runChecks invoked on activate (auto-run on startup)
 *   - 30s auto-refresh timer is scheduled
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { activate, deactivate } from "../../src/built-in/diagnostics/main";

function makeApi(opts: { hasService?: boolean; runResults?: any[] } = {}) {
  const viewRegs: Array<{ id: string; provider: any; options: any }> = [];
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];
  const service = {
    runChecks: vi.fn(async () => opts.runResults ?? []),
    onDidChange: vi.fn((cb: (r: any[]) => void) => {
      service._cb = cb;
      return { dispose() {} };
    }),
    _cb: undefined as any,
  };

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
      has(_id: any) { return opts.hasService === true; },
      get<T>(_id: any): T { return service as unknown as T; },
    },
  };

  return { api, viewRegs, cmdRegs, service };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get() { return undefined; }, update() {} },
    workspaceState: { get() { return undefined; }, update() {} },
    toolPath: "/tmp/d",
    toolUri: "file:///tmp/d",
    environmentVariableCollection: {},
  } as any;
}

describe("built-in/diagnostics activate — without service", () => {
  beforeEach(() => deactivate());

  it("registers exactly one view: 'view.diagnostics'", () => {
    const { api, viewRegs } = makeApi({ hasService: false });
    activate(api as any, makeContext());
    expect(viewRegs.length).toBe(1);
    expect(viewRegs[0].id).toBe("view.diagnostics");
  });

  it("registers exactly one command: 'diagnostics.runChecks'", () => {
    const { api, cmdRegs } = makeApi({ hasService: false });
    activate(api as any, makeContext());
    expect(cmdRegs.length).toBe(1);
    expect(cmdRegs[0].id).toBe("diagnostics.runChecks");
  });

  it("pushes exactly 2 subscriptions (view + command) when service is absent", () => {
    const { api } = makeApi({ hasService: false });
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(2);
  });

  it("command handler is a safe no-op when service is absent", async () => {
    const { api, cmdRegs } = makeApi({ hasService: false });
    activate(api as any, makeContext());
    await expect(cmdRegs[0].handler()).resolves.toBeUndefined();
  });
});

describe("built-in/diagnostics — createView DOM scaffold", () => {
  beforeEach(() => deactivate());

  it("attaches header, status, and list containers and shows empty message when no results", () => {
    const { api, viewRegs } = makeApi({ hasService: false });
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    expect(container.classList.contains("diagnostics-container")).toBe(true);
    expect(container.querySelector(".diagnostics-header")).toBeTruthy();
    expect(container.querySelector(".diagnostics-status")).toBeTruthy();
    expect(container.querySelector(".diagnostics-list")).toBeTruthy();
    expect(container.querySelector(".diagnostics-empty")).toBeTruthy();

    view.dispose();
  });
});

describe("built-in/diagnostics activate — with service", () => {
  beforeEach(() => {
    deactivate();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    deactivate();
  });

  it("subscribes to onDidChange and pushes 3 subscriptions total", () => {
    const { api, service } = makeApi({ hasService: true });
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(service.onDidChange).toHaveBeenCalledTimes(1);
    expect(ctx.subscriptions.length).toBe(3);
  });

  it("calls runChecks() on activate (startup auto-run)", () => {
    const { api, service } = makeApi({ hasService: true });
    activate(api as any, makeContext());
    // startup auto-run + auto-refresh timer share the same fn; ≥1 immediate call
    expect(service.runChecks).toHaveBeenCalled();
  });

  it("schedules a 30s auto-refresh timer that calls runChecks again", () => {
    const { api, service } = makeApi({ hasService: true });
    activate(api as any, makeContext());
    const before = service.runChecks.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(service.runChecks.mock.calls.length).toBeGreaterThan(before);
  });

  it("'diagnostics.runChecks' command invokes service.runChecks", async () => {
    const { api, cmdRegs, service } = makeApi({ hasService: true });
    activate(api as any, makeContext());
    const before = service.runChecks.mock.calls.length;
    await cmdRegs[0].handler();
    expect(service.runChecks.mock.calls.length).toBe(before + 1);
  });
});
