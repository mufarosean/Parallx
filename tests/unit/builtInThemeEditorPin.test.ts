/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/theme-editor/main.ts activate() — invariant guards.
 *
 * Pins:
 *   - registers exactly one editor provider with typeId='parallx.theme-editor'
 *   - registers exactly one command: 'theme-editor.open'
 *   - subscriptions length === 2
 *   - 'theme-editor.open' opens editor with the correct typeId/title/icon
 *   - deactivate() does not throw
 */
import { describe, it, expect } from "vitest";
import { activate, deactivate } from "../../src/built-in/theme-editor/main";

function makeApi() {
  const editorRegs: Array<{ typeId: string; provider: any }> = [];
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];
  const opens: Array<{ typeId: string; title: string; icon?: string }> = [];

  const api = {
    editors: {
      registerEditorProvider(typeId: string, provider: any) {
        editorRegs.push({ typeId, provider });
        return { dispose() {} };
      },
      async openEditor(opts: { typeId: string; title: string; icon?: string }) {
        opens.push(opts);
      },
    },
    commands: {
      registerCommand(id: string, handler: (...a: unknown[]) => unknown) {
        cmdRegs.push({ id, handler });
        return { dispose() {} };
      },
      async executeCommand<T>() { return undefined as unknown as T; },
    },
    services: {
      get<T>(_id: any): T { return ({} as unknown) as T; },
      has(_id: any) { return true; },
    },
  };

  return { api, editorRegs, cmdRegs, opens };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get() { return undefined; }, update() {} },
    workspaceState: { get() { return undefined; }, update() {} },
    toolPath: "/tmp/t",
    toolUri: "file:///tmp/t",
    environmentVariableCollection: {},
  } as any;
}

describe("built-in/theme-editor activate", () => {
  it("registers exactly one editor provider with typeId='parallx.theme-editor'", () => {
    const { api, editorRegs } = makeApi();
    activate(api as any, makeContext());
    expect(editorRegs.length).toBe(1);
    expect(editorRegs[0].typeId).toBe("parallx.theme-editor");
  });

  it("registers exactly one command: 'theme-editor.open'", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext());
    expect(cmdRegs.length).toBe(1);
    expect(cmdRegs[0].id).toBe("theme-editor.open");
  });

  it("pushes exactly 2 subscriptions (provider + command)", () => {
    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(2);
  });

  it("'theme-editor.open' opens editor with typeId='parallx.theme-editor', title='Theme Editor', icon='palette'", () => {
    const { api, cmdRegs, opens } = makeApi();
    activate(api as any, makeContext());
    cmdRegs[0].handler();
    expect(opens.length).toBe(1);
    expect(opens[0].typeId).toBe("parallx.theme-editor");
    expect(opens[0].title).toBe("Theme Editor");
    expect(opens[0].icon).toBe("palette");
  });

  it("deactivate() does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
