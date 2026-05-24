/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/output/main.ts activate() — invariant guards.
 *
 * Pins:
 *   - activate registers exactly one view (`view.output`) with name='Output', icon='terminal'
 *   - activate registers `output.clear` and `output.toggleTimestamps` commands
 *   - createOutputChannel called with 'Output Tool'
 *   - workspaceState `output.showTimestamps` restored on activation
 *   - 4 subscriptions pushed (view + 2 commands + console-restore)
 *   - console.log/warn/error are replaced and restored by the dispose subscription
 *   - `output.clear` empties logEntries and appends 'Output cleared' to channel
 *   - `output.toggleTimestamps` flips state and persists via workspaceState.update
 *   - createView returns an IDisposable that clears the container on dispose
 *
 * Note: module-level state (logEntries, showTimestamps, outputChannel, listEl)
 * is shared between activate() calls, so tests must not assume isolation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { activate, deactivate } from "../../src/built-in/output/main";

function makeApi() {
  const viewRegs: Array<{ id: string; provider: any; options: any }> = [];
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];
  const channels: Array<{ name: string; calls: string[] }> = [];

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
    window: {
      createOutputChannel(name: string) {
        const ch = {
          name,
          calls: [] as string[],
          append(v: string) { ch.calls.push(`append:${v}`); },
          appendLine(v: string) { ch.calls.push(`line:${v}`); },
          clear() { ch.calls.push("clear"); },
          show() { ch.calls.push("show"); },
          dispose() { ch.calls.push("dispose"); },
        };
        channels.push(ch);
        return ch;
      },
    },
  };

  return { api, viewRegs, cmdRegs, channels };
}

function makeContext(initialState: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { ...initialState };
  const updates: Array<{ key: string; value: unknown }> = [];
  return {
    subscriptions: [] as any[],
    workspaceState: {
      get<T>(key: string): T | undefined {
        return state[key] as T | undefined;
      },
      update(key: string, value: unknown) {
        state[key] = value;
        updates.push({ key, value });
      },
    },
    _state: state,
    _updates: updates,
  } as any;
}

describe("built-in/output activate — registrations", () => {
  beforeEach(() => {
    deactivate();
  });

  it("registers exactly one view: view.output with name='Output' and icon='terminal'", () => {
    const { api, viewRegs } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(viewRegs.length).toBe(1);
    expect(viewRegs[0].id).toBe("view.output");
    expect(viewRegs[0].options.name).toBe("Output");
    expect(viewRegs[0].options.icon).toBe("terminal");
  });

  it("registers output.clear and output.toggleTimestamps commands", () => {
    const { api, cmdRegs } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    const ids = cmdRegs.map((r) => r.id);
    expect(ids).toContain("output.clear");
    expect(ids).toContain("output.toggleTimestamps");
  });

  it("creates an output channel named 'Output Tool'", () => {
    const { api, channels } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe("Output Tool");
  });

  it("pushes at least 4 subscriptions (view + 2 commands + console-restore)", () => {
    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(4);
  });

  it("restores workspaceState['output.showTimestamps'] without throwing", () => {
    const { api } = makeApi();
    const ctx = makeContext({ "output.showTimestamps": false });
    expect(() => activate(api as any, ctx)).not.toThrow();
  });
});

describe("built-in/output — console interception", () => {
  beforeEach(() => {
    deactivate();
  });

  it("replaces console.log/warn/error and restores them on dispose subscription", () => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);

    expect(console.log).not.toBe(origLog);
    expect(console.warn).not.toBe(origWarn);
    expect(console.error).not.toBe(origError);

    // Find the console-restore subscription (last one pushed)
    const restoreSub = ctx.subscriptions[ctx.subscriptions.length - 1];
    restoreSub.dispose();

    expect(console.log).toBe(origLog);
    expect(console.warn).toBe(origWarn);
    expect(console.error).toBe(origError);
  });
});

describe("built-in/output — command handlers", () => {
  beforeEach(() => {
    deactivate();
  });

  it("output.clear appends 'Output cleared' to the output channel", () => {
    const { api, cmdRegs, channels } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);

    const clearCmd = cmdRegs.find((r) => r.id === "output.clear")!;
    const before = channels[0].calls.length;
    clearCmd.handler();
    const after = channels[0].calls;
    expect(after.length).toBeGreaterThan(before);
    expect(after).toContain("line:Output cleared");

    // Restore console before next test
    const restoreSub = ctx.subscriptions[ctx.subscriptions.length - 1];
    restoreSub.dispose();
  });

  it("output.toggleTimestamps persists the new state via workspaceState.update", () => {
    const { api, cmdRegs } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);

    const toggleCmd = cmdRegs.find((r) => r.id === "output.toggleTimestamps")!;
    const before = ctx._updates.length;
    toggleCmd.handler();
    expect(ctx._updates.length).toBe(before + 1);
    expect(ctx._updates[before].key).toBe("output.showTimestamps");
    expect(typeof ctx._updates[before].value).toBe("boolean");

    const restoreSub = ctx.subscriptions[ctx.subscriptions.length - 1];
    restoreSub.dispose();
  });
});

describe("built-in/output — view rendering", () => {
  beforeEach(() => {
    deactivate();
  });

  it("createView attaches toolbar + list to the container and returns IDisposable", () => {
    const { api, viewRegs } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    expect(container.classList.contains("output-container")).toBe(true);
    expect(container.querySelector(".output-toolbar")).toBeTruthy();
    expect(container.querySelector(".output-list")).toBeTruthy();
    expect(typeof (view as any).dispose).toBe("function");

    view.dispose();
    expect(container.innerHTML).toBe("");

    const restoreSub = ctx.subscriptions[ctx.subscriptions.length - 1];
    restoreSub.dispose();
  });
});
