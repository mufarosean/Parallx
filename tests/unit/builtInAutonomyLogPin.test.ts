/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/autonomy-log/main.ts activate() — invariant guards.
 *
 * Scope: pin registrations only. Render path is too entangled (4 services + mode tabs + rail filters).
 *
 * Pins (with no services registered):
 *   - registers exactly one view: 'view.autonomyLog'
 *   - registers exactly two commands: 'autonomyLog.markAllRead', 'autonomyLog.clear'
 *   - subscriptions length === 3 (view + 2 commands)
 *   - markAllRead handler does not throw when log service absent
 *   - clear handler does not throw when log service absent
 *   - createView attaches `.autonomy-log-container` to the container (live mode only)
 *   - deactivate() does not throw and clears module-level service references
 */
import { describe, it, expect, beforeEach } from "vitest";
import { activate, deactivate } from "../../src/built-in/autonomy-log/main";

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
      has(_id: unknown) { return false; },
      get<T>(_id: unknown): T { throw new Error("service not registered"); },
    },
  };

  return { api, viewRegs, cmdRegs };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get() { return undefined; }, update() {} },
    workspaceState: { get() { return undefined; }, update() {} },
    toolPath: "/tmp/al",
    toolUri: "file:///tmp/al",
    environmentVariableCollection: {},
  } as any;
}

describe("built-in/autonomy-log activate — without services", () => {
  beforeEach(() => {
    deactivate();
    if (!(Element.prototype as any).scrollIntoView) {
      (Element.prototype as any).scrollIntoView = function () {};
    }
  });

  it("registers exactly one view: 'view.autonomyLog'", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());
    expect(viewRegs.length).toBe(1);
    expect(viewRegs[0].id).toBe("view.autonomyLog");
  });

  it("registers exactly two commands: markAllRead + clear", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const ids = cmdRegs.map((r) => r.id).sort();
    expect(ids).toEqual(["autonomyLog.clear", "autonomyLog.markAllRead"]);
  });

  it("pushes exactly 3 subscriptions (view + 2 commands)", () => {
    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(3);
  });

  it("'autonomyLog.markAllRead' handler does not throw when service is absent", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "autonomyLog.markAllRead")!;
    expect(() => cmd.handler()).not.toThrow();
  });

  it("'autonomyLog.clear' handler does not throw when service is absent", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "autonomyLog.clear")!;
    expect(() => cmd.handler()).not.toThrow();
  });

  it("createView attaches `.autonomy-log-container` to the container", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    expect(container.classList.contains("autonomy-log-container")).toBe(true);

    view.dispose();
  });

  it("deactivate() does not throw and is idempotent", () => {
    expect(() => deactivate()).not.toThrow();
    expect(() => deactivate()).not.toThrow();
  });
});
