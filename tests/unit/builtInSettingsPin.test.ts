/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/settings/main.ts activate() — invariant guards.
 *
 * Pins:
 *   - registers exactly four commands:
 *       settings.open, workspace.exportConfig, workspace.importConfig, workspace.resetConfig
 *   - subscriptions length === 4
 *   - 'settings.open' is a safe no-op when ISettingsRegistryService is absent
 *   - 'workspace.exportConfig' is a safe no-op when registry is absent
 *   - 'workspace.importConfig' is a safe no-op when registry is absent
 *   - 'workspace.resetConfig' is a safe no-op when registry is absent
 *   - deactivate() does not throw
 */
import { describe, it, expect } from "vitest";
import { activate, deactivate } from "../../src/built-in/settings/main";

function makeApi(hasRegistry: boolean) {
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];

  const api = {
    commands: {
      registerCommand(id: string, handler: (...a: unknown[]) => unknown) {
        cmdRegs.push({ id, handler });
        return { dispose() {} };
      },
      async executeCommand<T>() { return undefined as unknown as T; },
    },
    services: {
      has(_id: any) { return hasRegistry; },
      get<T>(_id: any): T { return ({} as unknown) as T; },
    },
  };

  return { api, cmdRegs };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get() { return undefined; }, update() {} },
    workspaceState: { get() { return undefined; }, update() {} },
    toolPath: "/tmp/s",
    toolUri: "file:///tmp/s",
    environmentVariableCollection: {},
  } as any;
}

describe("built-in/settings activate", () => {
  it("registers exactly four commands", () => {
    const { api, cmdRegs } = makeApi(false);
    activate(api as any, makeContext());
    const ids = cmdRegs.map((r) => r.id).sort();
    expect(ids).toEqual([
      "settings.open",
      "workspace.exportConfig",
      "workspace.importConfig",
      "workspace.resetConfig",
    ]);
  });

  it("pushes exactly 4 subscriptions", () => {
    const { api } = makeApi(false);
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(4);
  });

  it("'settings.open' is a safe no-op when ISettingsRegistryService is absent", () => {
    const { api, cmdRegs } = makeApi(false);
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "settings.open")!;
    expect(() => cmd.handler()).not.toThrow();
  });

  it("'workspace.exportConfig' is a safe no-op when registry is absent", async () => {
    const { api, cmdRegs } = makeApi(false);
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "workspace.exportConfig")!;
    await expect(cmd.handler()).resolves.toBeUndefined();
  });

  it("'workspace.importConfig' is a safe no-op when registry is absent", async () => {
    const { api, cmdRegs } = makeApi(false);
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "workspace.importConfig")!;
    await expect(cmd.handler()).resolves.toBeUndefined();
  });

  it("'workspace.resetConfig' is a safe no-op when registry is absent", async () => {
    const { api, cmdRegs } = makeApi(false);
    activate(api as any, makeContext());
    const cmd = cmdRegs.find((r) => r.id === "workspace.resetConfig")!;
    await expect(cmd.handler()).resolves.toBeUndefined();
  });

  it("deactivate() does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
