/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/terminal/main.ts activate() — invariant guards.
 *
 * Pins:
 *   - registers exactly one view: 'view.terminal' with name='Terminal', icon='terminal'
 *   - registers exactly two commands: 'terminal.clear' and 'terminal.restart'
 *   - subscriptions length === 3 (view + 2 commands)
 *   - createView attaches toolbar + output + input-line to the container
 *   - clear button + 'terminal.clear' command both empty the output element
 *   - createView dispose removes the terminal root from the container
 *   - dispose path tolerates absent parallxElectron bridge (no throw)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { activate, deactivate } from "../../src/built-in/terminal/main";

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
  };

  return { api, viewRegs, cmdRegs };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get() { return undefined; }, update() {} },
    workspaceState: { get() { return undefined; }, update() {} },
    toolPath: "/tmp/terminal",
    toolUri: "file:///tmp/terminal",
    environmentVariableCollection: {},
  } as any;
}

describe("built-in/terminal activate — registrations", () => {
  beforeEach(() => {
    deactivate();
    delete (globalThis as any).parallxElectron;
  });

  it("registers exactly one view: 'view.terminal' with name='Terminal' and icon='terminal'", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());
    expect(viewRegs.length).toBe(1);
    expect(viewRegs[0].id).toBe("view.terminal");
    expect(viewRegs[0].options.name).toBe("Terminal");
    expect(viewRegs[0].options.icon).toBe("terminal");
  });

  it("registers exactly two commands: 'terminal.clear' and 'terminal.restart'", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    const ids = cmdRegs.map((r) => r.id).sort();
    expect(ids).toEqual(["terminal.clear", "terminal.restart"]);
  });

  it("pushes exactly 3 subscriptions (view + 2 commands)", () => {
    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(3);
  });
});

describe("built-in/terminal — createView DOM scaffold", () => {
  beforeEach(() => {
    deactivate();
    delete (globalThis as any).parallxElectron;
  });

  it("attaches toolbar, output area, and input line to the container", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    expect(container.querySelector(".parallx-terminal")).toBeTruthy();
    expect(container.querySelector(".parallx-terminal-toolbar")).toBeTruthy();
    expect(container.querySelector(".parallx-terminal-output")).toBeTruthy();
    expect(container.querySelector(".parallx-terminal-input-line")).toBeTruthy();
    expect(container.querySelector(".parallx-terminal-input")).toBeTruthy();

    view.dispose();
  });

  it("dispose removes the terminal root from the container (no throw without bridge)", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);
    expect(container.querySelector(".parallx-terminal")).toBeTruthy();

    expect(() => view.dispose()).not.toThrow();
    expect(container.querySelector(".parallx-terminal")).toBeNull();
  });
});

describe("built-in/terminal — clear behavior", () => {
  beforeEach(() => {
    deactivate();
    delete (globalThis as any).parallxElectron;
  });

  it("'terminal.clear' command empties the output element", () => {
    const { api, viewRegs, cmdRegs } = makeApi();
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    const output = container.querySelector(".parallx-terminal-output") as HTMLElement;
    // Seeded with the welcome row — non-empty
    expect(output.textContent && output.textContent.length > 0).toBe(true);

    const clearCmd = cmdRegs.find((r) => r.id === "terminal.clear")!;
    clearCmd.handler();

    expect(output.textContent).toBe("");

    view.dispose();
  });

  it("clear toolbar button also empties the output element", () => {
    const { api, viewRegs } = makeApi();
    activate(api as any, makeContext());

    const container = document.createElement("div");
    const view = viewRegs[0].provider.createView(container);

    const output = container.querySelector(".parallx-terminal-output") as HTMLElement;
    const clearBtn = container.querySelector(".parallx-terminal-toolbar-btn") as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    clearBtn.click();

    expect(output.textContent).toBe("");

    view.dispose();
  });
});

describe("built-in/terminal — module-level deactivate", () => {
  beforeEach(() => {
    delete (globalThis as any).parallxElectron;
  });

  it("deactivate() does not throw when called repeatedly without a bridge", () => {
    expect(() => deactivate()).not.toThrow();
    expect(() => deactivate()).not.toThrow();
  });
});
